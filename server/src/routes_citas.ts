import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Op } from "@hagel/shared";
import { audit } from "./audit";
import { HttpError } from "./auth";
import type { AzureSource } from "./azure";
import { importScans } from "./azure_import";
import { loadMappingContext, mapScan, newScansOfTenants, tenantsOfOrg } from "./azure_sync";
import { CitasError, dayInZone, normalizePlate, sameInsurer, zoneOfCountry, type CitasAppointment, type CitasDay, type CitasSource } from "./citas";
import type { Db } from "./db";
import type { Env } from "./env";
import type { Hub } from "./hub";
import { canOrg } from "./permissions";
import { citasLinks, companies, insurers, stations, vehicles } from "./schema";
import type { Storage } from "./storage";
import { loadOrgSettings, processPush } from "./sync";

interface Deps {
  db: Db; hub: Hub; storage: Storage; az: AzureSource | null; citas: CitasSource | null;
  needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env>;
  validationHook: (r: { success: boolean }, c: Context) => Response | undefined;
  /** clock of the cache (tests) */
  now?: () => number;
}

const CACHE_MS = 60_000;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const startInput = z.object({
  station_id: z.string().uuid(),
  scan: z.object({ partitionKey: z.string().min(1).max(300), rowKey: z.string().max(300) }).optional(),
});

const gone = (e: unknown): never => {
  if (e instanceof CitasError) throw new HttpError(e.kind === "not_found" ? 404 : 502, e.kind === "not_found" ? "appointment_not_found" : "citas_unreachable");
  throw e;
};

export function citasRoutes({ db, hub, storage, az, citas, needAuth, needOrg, validationHook, now = Date.now }: Deps) {
  const r = new Hono<Env>();
  const cache = new Map<string, { at: number; day: CitasDay }>();
  const zoneCache: { at: number; byId: Map<string, string> } = { at: 0, byId: new Map() };
  const busy = new Map<string, Promise<unknown>>(); // one start per appointment at a time

  const manage: MiddlewareHandler<Env> = async (c, next) => {
    if (!canOrg(c.get("principal"), "stations.gerer", c.get("orgId"))) throw new HttpError(403, "forbidden");
    await next();
  };

  /** The station of the request: it must belong to the organisation, and the user needs the right on it. */
  const stationFor = async (c: Context<Env>, id: string, perm: "vehicules.voir" | "vehicules.creer") => {
    const [s] = await db.select().from(stations).where(and(eq(stations.id, id), eq(stations.orgId, c.get("orgId"))));
    if (!s) throw new HttpError(404, "station_not_found");
    if (!canOrg(c.get("principal"), perm, s.orgId, s.id)) throw new HttpError(403, "forbidden");
    return s;
  };

  /** Time zone of a location (from Citas, cached for 10 minutes), else the one of the station's country. */
  const zoneOf = async (locationId: string, country: string) => {
    if (!citas) return zoneOfCountry(country);
    if (now() - zoneCache.at > 600_000) {
      try { zoneCache.byId = new Map((await citas.locations()).map((l) => [l.id, l.timezone])); zoneCache.at = now(); } catch { /* the country's zone is good enough */ }
    }
    return zoneCache.byId.get(locationId) || zoneOfCountry(country);
  };

  /** One day of one location: cached for 60 s (`fresh` skips the cache: the refresh button). */
  const dayOf = async (locationId: string, date: string, fresh: boolean): Promise<CitasDay> => {
    const k = `${locationId}|${date}`;
    const hit = cache.get(k);
    if (hit && !fresh && now() - hit.at < CACHE_MS) return hit.day;
    try {
      const d = await citas!.appointments({ date, location: locationId });
      cache.set(k, { at: now(), day: d });
      if (cache.size > 200) for (const [key, v] of cache) if (now() - v.at >= CACHE_MS) cache.delete(key);
      return d;
    } catch (e) { return gone(e); }
  };

  // ------------------------------------------------------------------ admin: status and locations
  r.get("/citas/status", needAuth, needOrg, manage, async (c) => {
    if (!citas) return c.json({ configured: false, ok: false });
    try {
      await citas.health();
      const locs = await citas.locations();
      return c.json({ configured: true, ok: true, locations: locs.length });
    } catch (e) { return c.json({ configured: true, ok: false, error: e instanceof CitasError ? e.kind : "unreachable" }); }
  });

  r.get("/citas/locations", needAuth, needOrg, manage, async (c) => {
    if (!citas) return c.json([]);
    try { return c.json(await citas.locations()); } catch (e) { return gone(e); }
  });

  // ------------------------------------------------------------------ the appointments of a station for a day
  r.get("/citas/appointments", needAuth, needOrg, async (c) => {
    const q = c.req.query();
    if (!z.string().uuid().safeParse(q.station_id).success || (q.date && !day.safeParse(q.date).success)) throw new HttpError(400, "invalid_input");
    const st = await stationFor(c, q.station_id, "vehicules.voir");
    if (!citas) return c.json({ configured: false, linked: false, appointments: [] });
    if (!st.citasLocationId) return c.json({ configured: true, linked: false, appointments: [] });
    const zone = await zoneOf(st.citasLocationId, st.country);
    const date = q.date || dayInZone(now(), zone);
    const d = await dayOf(st.citasLocationId, date, q.refresh === "1");
    const list = d.appointments.filter((a) => a.status !== "cancelled");
    const orgId = st.orgId;

    // an expertise already started from the appointment
    const links = list.length ? await db.select({ appt: citasLinks.appointmentId, vehicleId: vehicles.id, statut: vehicles.statut }).from(citasLinks)
      .innerJoin(vehicles, eq(vehicles.id, citasLinks.vehicleId))
      .where(and(eq(citasLinks.orgId, orgId), inArray(citasLinks.appointmentId, list.map((a) => a.id)), isNull(vehicles.deletedAt))) : [];
    const linkOf = new Map(links.map((l) => [l.appt, l]));
    const ins = await db.select({ id: insurers.id, name: insurers.name }).from(insurers).where(eq(insurers.orgId, orgId));

    // the station's scans of that day (waiting for import), by plate
    const plates = new Map<string, number>();
    const tenants = await tenantsOfOrg(db, orgId);
    if (list.length && tenants.length) {
      const ctx = await loadMappingContext(db);
      for (const s of await newScansOfTenants(db, tenants)) {
        const m = mapScan(s, ctx);
        if (m.orgId !== orgId || m.stationId !== st.id || !s.scanDateTime || dayInZone(s.scanDateTime, zone) !== date) continue;
        const p = normalizePlate(s.plate);
        if (p) plates.set(p, (plates.get(p) ?? 0) + 1);
      }
    }
    return c.json({
      configured: true, linked: true, date, timezone: zone, generatedAt: d.generated_at,
      appointments: list.map((a) => ({
        ...a,
        vehicleId: linkOf.get(a.id)?.vehicleId ?? null, vehicleStatut: linkOf.get(a.id)?.statut ?? null,
        insurerId: a.insurance_name ? ins.find((i) => sameInsurer(i.name, a.insurance_name))?.id ?? null : null,
        matchingScans: plates.get(normalizePlate(a.vehicle.license_plate_normalized || a.vehicle.license_plate)) ?? 0,
      })),
    });
  });

  // ------------------------------------------------------------------ start an expertise from an appointment
  r.post("/citas/appointments/:id/start", needAuth, needOrg, zValidator("json", startInput, validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId"), u = c.get("principal");
    const apptId = c.req.param("id") ?? "";
    if (!apptId || apptId.length > 120) throw new HttpError(400, "invalid_input");
    const st = await stationFor(c, b.station_id, "vehicules.creer");
    if (!citas) throw new HttpError(409, "citas_unavailable");
    if (!st.citasLocationId) throw new HttpError(404, "appointment_not_found");

    const lockKey = `${orgId}|${apptId}`;
    while (busy.has(lockKey)) await busy.get(lockKey)!.catch(() => undefined);
    const run = (async () => {
      // always the live appointment, never the cache
      let a: CitasAppointment;
      try { a = await citas.appointment(apptId); } catch (e) { return gone(e); }
      if (a.location.id !== st.citasLocationId) throw new HttpError(404, "appointment_not_found");
      if (a.status === "cancelled") throw new HttpError(409, "citas_cancelled");

      // idempotent: an expertise already started from this appointment is simply reopened
      const [link] = await db.select().from(citasLinks).where(and(eq(citasLinks.orgId, orgId), eq(citasLinks.appointmentId, apptId)));
      if (link) {
        const [v] = await db.select({ id: vehicles.id, deletedAt: vehicles.deletedAt }).from(vehicles).where(eq(vehicles.id, link.vehicleId));
        if (v && !v.deletedAt) return { status: "already" as const, vehicleId: v.id };
        await db.delete(citasLinks).where(eq(citasLinks.id, link.id)); // its car was deleted: the appointment can start again
      }

      const zone = await zoneOf(st.citasLocationId!, st.country);
      const fields = fieldsOf(a);
      const insurerId = a.insurance_name ? (await db.select({ id: insurers.id, name: insurers.name }).from(insurers).where(eq(insurers.orgId, orgId))).find((i) => sameInsurer(i.name, a.insurance_name))?.id ?? null : null;
      const deps = { db, hub, storage };
      let vehicleId: string, status: "imported" | "created";

      if (b.scan) {
        if (!az) throw new HttpError(409, "azure_unavailable");
        const [res] = await importScans({ db, az, storage, hub }, u, [b.scan], orgId, st.id);
        if (res.status === "not_allowed") throw new HttpError(403, "forbidden");
        if (res.status !== "imported" || !res.vehicleId) throw new HttpError(409, "scan_not_importable", { status: res.status });
        vehicleId = res.vehicleId; status = "imported";
        // the scan wins: the appointment only fills what the scan left empty
        const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
        const header = row.header as Record<string, unknown>;
        const fill: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) if (v && !String(header[k] ?? "").trim()) fill[k] = v;
        if (insurerId && !row.insurerId) fill.insurerId = insurerId;
        if (Object.keys(fill).length) await processPush(deps, u, [{ opId: crypto.randomUUID(), at: new Date().toISOString(), type: "vehicle.header", vehicleId, fields: fill } as unknown as Op]);
      } else {
        vehicleId = crypto.randomUUID(); status = "created";
        const settings = await loadOrgSettings(db, orgId);
        const land: "DE" | "ES" = st.country === "ES" ? "ES" : "DE";
        const cos = await db.select().from(companies).where(and(eq(companies.orgId, orgId), eq(companies.active, true)));
        const co = cos.find((x) => x.logoKey) ?? cos[0];
        const header = {
          land, kennzeichen: "", fin: "", modell: "", kunde: st.type === "carrosserie" ? st.name : "", kundeEmail: "", leistungsdatum: dayInZone(new Date(), zone),
          teiler: settings.defaultTeiler, stundensatz: land === "ES" ? settings.rateES : settings.rateDE, notiz: "", zustand: ["Trocken", "Sauber"],
          greifzone: false, hohlraum: false, verbringung: false, logo: "pdr", ...(co ? { companyId: co.id } : {}), ...fields,
        };
        const out = await processPush(deps, u, [{
          opId: crypto.randomUUID(), at: new Date().toISOString(), type: "vehicle.create",
          vehicle: {
            id: vehicleId, stationId: st.id, clientStationId: st.type === "carrosserie" ? st.id : null, campaignId: null, insurerId, header, panels: {},
            shares: { techName: "", techPct: 50, demTechName: "", demTechPct: 100 }, statut: "besichtigung",
          },
        } as unknown as Op]);
        if (out.results[0]?.status !== "ok") throw new HttpError(403, "not_allowed");
      }

      await db.insert(citasLinks).values({ orgId, appointmentId: apptId, locationId: a.location.id, vehicleId, stationId: st.id, createdBy: u.id }).onConflictDoNothing();
      await audit(db, { orgId, userId: u.id, action: "citas.start", entity: "vehicle", entityId: vehicleId, after: { appointment: apptId, location: a.location.id, plate: a.vehicle.license_plate, scan: b.scan ? `${b.scan.partitionKey}|${b.scan.rowKey}` : null, status } });
      hub.publish(orgId, 0);
      return { status, vehicleId };
    })();
    busy.set(lockKey, run);
    try { return c.json(await run); } finally { busy.delete(lockKey); }
  });

  return r;
}

/** What an appointment tells about the car and the customer, in the fields of the vehicle header (empty values left out). */
export function fieldsOf(a: CitasAppointment): Record<string, string> {
  const vin = (a.vehicle.vin ?? "").toUpperCase().replace(/\s/g, "");
  const out: Record<string, string> = {
    kennzeichen: a.vehicle.license_plate.trim().toUpperCase().slice(0, 40),
    fin: /^[A-Z0-9]{11,17}$/.test(vin) ? vin : "",
    modell: [a.vehicle.make, a.vehicle.model].filter(Boolean).join(" ").trim().slice(0, 120),
    claimNumber: (a.case_number ?? "").trim().slice(0, 80),
    kundeName: `${a.customer.first_name} ${a.customer.last_name}`.trim().slice(0, 160),
    kundeTel: a.customer.phone.trim().slice(0, 40),
    kundeEmail: a.customer.email.trim().slice(0, 254),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}
