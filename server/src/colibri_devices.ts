import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { isPlaceType } from "@hagel/shared";
import { audit } from "./audit";
import { HttpError } from "./auth";
import { loadMappingContext, mapScan, newScansOfTenants, tenantsOfOrg } from "./azure_sync";
import type { Db } from "./db";
import type { Env } from "./env";
import type { Hub } from "./hub";
import { canOrg, hasOrgPermission, sitesWith } from "./permissions";
import { colibriDeviceAssignments, colibriDevices, colibriScans, stations, users } from "./schema";

import { addDays, assignmentAt, isIsoDate, localDay, tzOfOrgCountry, type AssignmentRow, type DeviceRow } from "./colibri_rules";
export { addDays, assignmentAt, isIsoDate, localDay, tzOfOrgCountry, type AssignmentRow, type DeviceRow };

// ------------------------------------------------------------------ moving a scanner

export interface AssignResult { assignmentId: string; closed: { id: string; validTo: string }[]; superseded: { id: string; stationId: string; validFrom: string; validTo: string | null }[]; unchanged: boolean }

/**
 * "From <day> on, the scanner stands in <station>." The open assignment is closed the day before. A date in the past is a correction:
 * assignments that start on or after that day are replaced (listed in the audit entry), one that covers it is cut the day before.
 * Never two assignments for the same day.
 */
export async function assignDevice(db: Db, o: { orgId: string; deviceId: string; stationId: string; from: string; userId: string | null }): Promise<AssignResult> {
  return db.transaction(async (tx) => {
    const [dev] = await tx.select().from(colibriDevices).where(and(eq(colibriDevices.id, o.deviceId), eq(colibriDevices.orgId, o.orgId))).for("update");
    if (!dev) throw new HttpError(404, "device_not_found");
    const [st] = await tx.select().from(stations).where(and(eq(stations.id, o.stationId), eq(stations.orgId, o.orgId)));
    if (!st) throw new HttpError(404, "station_not_found");
    if (!isPlaceType(st.type)) throw new HttpError(400, "station_not_a_place");
    if (!st.active) throw new HttpError(400, "station_unknown");
    if (st.azureTenant && dev.tenant && st.azureTenant !== dev.tenant) throw new HttpError(400, "tenant_not_allowed");
    const all = await tx.select().from(colibriDeviceAssignments).where(eq(colibriDeviceAssignments.deviceId, dev.id)).orderBy(asc(colibriDeviceAssignments.validFrom));
    const covering = all.find((a) => a.validFrom <= o.from && (a.validTo === null || a.validTo >= o.from));
    if (covering && covering.stationId === o.stationId && covering.validTo === null) return { assignmentId: covering.id, closed: [], superseded: [], unchanged: true };
    const superseded = all.filter((a) => a.validFrom >= o.from);
    for (const a of superseded) await tx.delete(colibriDeviceAssignments).where(eq(colibriDeviceAssignments.id, a.id));
    const closed: { id: string; validTo: string }[] = [];
    for (const a of all.filter((x) => x.validFrom < o.from && (x.validTo === null || x.validTo >= o.from))) {
      const validTo = addDays(o.from, -1);
      await tx.update(colibriDeviceAssignments).set({ validTo }).where(eq(colibriDeviceAssignments.id, a.id));
      closed.push({ id: a.id, validTo });
    }
    const [created] = await tx.insert(colibriDeviceAssignments).values({ deviceId: dev.id, stationId: o.stationId, validFrom: o.from, validTo: null, createdBy: o.userId }).returning();
    await audit(tx as unknown as Db, {
      orgId: o.orgId, userId: o.userId, action: "colibri.assign", entity: "colibri_device", entityId: dev.id,
      before: { assignments: all.map((a) => ({ stationId: a.stationId, from: a.validFrom, to: a.validTo })) },
      after: { number: dev.number, tenant: dev.tenant, stationId: o.stationId, station: st.name, from: o.from, closed, superseded: superseded.map((a) => ({ stationId: a.stationId, from: a.validFrom, to: a.validTo })) },
    });
    return { assignmentId: created.id, closed, superseded: superseded.map((a) => ({ id: a.id, stationId: a.stationId, validFrom: a.validFrom, validTo: a.validTo })), unchanged: false };
  });
}

/** The scanner stops standing anywhere after `to` (included): its later scans have no station. */
export async function unassignDevice(db: Db, o: { orgId: string; deviceId: string; to: string; userId: string | null }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [dev] = await tx.select().from(colibriDevices).where(and(eq(colibriDevices.id, o.deviceId), eq(colibriDevices.orgId, o.orgId))).for("update");
    if (!dev) throw new HttpError(404, "device_not_found");
    const [open] = await tx.select().from(colibriDeviceAssignments).where(and(eq(colibriDeviceAssignments.deviceId, dev.id), isNull(colibriDeviceAssignments.validTo)));
    if (!open) return false;
    if (o.to < open.validFrom) throw new HttpError(400, "invalid_input");
    await tx.update(colibriDeviceAssignments).set({ validTo: o.to }).where(eq(colibriDeviceAssignments.id, open.id));
    await audit(tx as unknown as Db, { orgId: o.orgId, userId: o.userId, action: "colibri.unassign", entity: "colibri_device", entityId: dev.id, before: { stationId: open.stationId, from: open.validFrom, to: null }, after: { number: dev.number, to: o.to } });
    return true;
  });
}

// ------------------------------------------------------------------ routes (Administration → Colibri scanners, S40)

interface Deps {
  db: Db; hub: Hub;
  needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env>;
  validationHook: (r: { success: boolean }, c: Context) => Response | undefined;
}

const deviceInput = z.object({
  tenant: z.string().trim().max(120).default(""),
  number: z.string().trim().min(1).max(60),
  note: z.string().max(300).default(""),
  station_id: z.string().uuid().nullable().default(null),
  from: z.string().refine(isIsoDate).nullable().default(null),
});
const assignInput = z.object({ station_id: z.string().uuid(), from: z.string().refine(isIsoDate).nullable().default(null) });
const unassignInput = z.object({ to: z.string().refine(isIsoDate).nullable().default(null) });

export function deviceRoutes({ db, hub, needAuth, needOrg, validationHook }: Deps) {
  const r = new Hono<Env>();
  const org = (c: Context<Env>) => c.get("orgId");
  const who = (c: Context<Env>) => c.get("principal").id;

  const may: MiddlewareHandler<Env> = async (c, next) => {
    // an administrator (grant for the whole organisation) or a station manager (grant bound to his station)
    if (!hasOrgPermission(c.get("principal"), "colibri.geraete", org(c))) throw new HttpError(403, "forbidden");
    await next();
  };
  const isAdmin = (c: Context<Env>) => canOrg(c.get("principal"), "colibri.geraete", org(c));
  const adminOnly = (c: Context<Env>) => { if (!isAdmin(c)) throw new HttpError(403, "forbidden"); };
  const myStations = (c: Context<Env>): "all" | string[] => sitesWith(c.get("principal"), "colibri.geraete", org(c));

  async function todayOf(orgId: string) {
    const [o] = await db.execute(sql`select country from organizations where id = ${orgId}`).then((x) => (x as unknown as { rows: { country: string }[] }).rows);
    return localDay(new Date(), tzOfOrgCountry(o?.country ?? "DE"));
  }
  async function deviceOf(c: Context<Env>, id: string) {
    const [d] = await db.select().from(colibriDevices).where(and(eq(colibriDevices.id, id), eq(colibriDevices.orgId, org(c))));
    if (!d) throw new HttpError(404, "device_not_found");
    return d;
  }
  /** A station manager touches only the scanners of his stations and the free ones, and only moves them into his own stations. */
  async function assertMayHandle(c: Context<Env>, deviceId: string, targetStationId: string | null) {
    const mine = myStations(c);
    if (mine === "all") return;
    const [open] = await db.select().from(colibriDeviceAssignments).where(and(eq(colibriDeviceAssignments.deviceId, deviceId), isNull(colibriDeviceAssignments.validTo)));
    if (open && !mine.includes(open.stationId)) throw new HttpError(403, "forbidden");
    if (targetStationId && !mine.includes(targetStationId)) throw new HttpError(403, "forbidden");
  }

  r.get("/admin/colibri/devices", needAuth, needOrg, may, async (c) => {
    const orgId = org(c);
    const admin = isAdmin(c), mine = myStations(c);
    const [orgRow] = (await db.execute(sql`select country from organizations where id = ${orgId}`) as unknown as { rows: { country: string }[] }).rows;
    const tz = tzOfOrgCountry(orgRow?.country ?? "DE");
    const today = localDay(new Date(), tz);
    const devs = await db.select().from(colibriDevices).where(eq(colibriDevices.orgId, orgId)).orderBy(asc(colibriDevices.tenant), asc(colibriDevices.number));
    const asg = devs.length ? await db.select().from(colibriDeviceAssignments).where(inArray(colibriDeviceAssignments.deviceId, devs.map((d) => d.id))).orderBy(asc(colibriDeviceAssignments.validFrom)) : [];
    const st = new Map((await db.select().from(stations).where(eq(stations.orgId, orgId))).map((s) => [s.id, s]));
    const people = new Map((await db.select({ id: users.id, name: users.name, email: users.email }).from(users)).map((p) => [p.id, p.name || p.email]));
    const tenants = await tenantsOfOrg(db, orgId);

    // scans per scanner (all statuses) and the waiting ones that have no station on their day
    const total = tenants.length ? await db.select({ tenant: colibriScans.tenant, number: colibriScans.colibriNumber, n: sql<number>`count(*)::int`, last: sql<string>`max(${colibriScans.scanDateTime})` })
      .from(colibriScans).where(inArray(colibriScans.tenant, tenants)).groupBy(colibriScans.tenant, colibriScans.colibriNumber) : [];
    const ctx = await loadMappingContext(db);
    const waiting = new Map<string, { waiting: number; noStation: number }>();
    for (const s of await newScansOfTenants(db, tenants)) {
      const k = `${s.tenant}|${s.colibriNumber}`;
      const e = waiting.get(k) ?? { waiting: 0, noStation: 0 };
      e.waiting++;
      if (!mapScan(s, ctx).stationId) e.noStation++;
      waiting.set(k, e);
    }

    const items = devs.map((d) => {
      const list = asg.filter((a) => a.deviceId === d.id);
      const now = assignmentAt(list, d.id, today);
      const cur = list.find((a) => a.validTo === null) ?? now;
      const key = `${d.tenant}|${d.number}`;
      const w = waiting.get(key) ?? { waiting: 0, noStation: 0 };
      return {
        id: d.id, tenant: d.tenant, number: d.number, note: d.note,
        station: now ? { id: now.stationId, name: st.get(now.stationId)?.name ?? "", since: now.validFrom } : null,
        upcoming: cur && !now ? { id: cur.stationId, name: st.get(cur.stationId)?.name ?? "", from: cur.validFrom } : null,
        scans: total.find((t) => t.tenant === d.tenant && t.number === d.number)?.n ?? 0, waiting: w.waiting, waitingWithoutStation: w.noStation,
        history: [...list].reverse().map((a) => ({ id: a.id, stationId: a.stationId, station: st.get(a.stationId)?.name ?? "", from: a.validFrom, to: a.validTo, by: a.createdBy ? people.get(a.createdBy) ?? "" : "", at: a.createdAt })),
      };
    });
    // a manager sees the scanners of his stations (now or earlier on) and the free ones
    const visible = mine === "all" ? items : items.filter((i) => !i.station || mine.includes(i.station.id));
    const known = new Set(devs.map((d) => `${d.tenant}|${d.number}`));
    const seen = admin ? total.filter((t) => t.number && !known.has(`${t.tenant}|${t.number}`)).map((t) => ({ tenant: t.tenant, number: t.number, scans: t.n, lastScan: t.last })).sort((a, b) => b.scans - a.scans) : [];
    return c.json({
      today, canAdd: admin, canDelete: admin, myStationIds: mine, devices: visible, seen, tenants: admin ? tenants : [],
      stations: [...st.values()].filter((s) => isPlaceType(s.type) && s.active && (mine === "all" || mine.includes(s.id))).map((s) => ({ id: s.id, name: s.name, tenant: s.azureTenant })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  });

  r.post("/admin/colibri/devices", needAuth, needOrg, may, zValidator("json", deviceInput, validationHook), async (c) => {
    adminOnly(c);
    const b = c.req.valid("json"), orgId = org(c);
    if (!(await tenantsOfOrg(db, orgId)).includes(b.tenant)) throw new HttpError(400, "tenant_not_allowed");
    const [dup] = await db.select().from(colibriDevices).where(and(eq(colibriDevices.orgId, orgId), eq(colibriDevices.tenant, b.tenant), eq(colibriDevices.number, b.number)));
    if (dup) throw new HttpError(409, "device_exists");
    const [d] = await db.insert(colibriDevices).values({ orgId, tenant: b.tenant, number: b.number, note: b.note, createdBy: who(c) }).returning();
    await audit(db, { orgId, userId: who(c), action: "create", entity: "colibri_device", entityId: d.id, after: d });
    let assigned: AssignResult | null = null;
    if (b.station_id) assigned = await assignDevice(db, { orgId, deviceId: d.id, stationId: b.station_id, from: b.from ?? (await todayOf(orgId)), userId: who(c) });
    hub.publish(orgId, 0);
    return c.json({ ...d, assigned }, 201);
  });

  r.put("/admin/colibri/devices/:id", needAuth, needOrg, may, zValidator("json", z.object({ note: z.string().max(300) }), validationHook), async (c) => {
    adminOnly(c);
    const before = await deviceOf(c, c.req.param("id") ?? "");
    const [d] = await db.update(colibriDevices).set({ note: c.req.valid("json").note }).where(eq(colibriDevices.id, before.id)).returning();
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "colibri_device", entityId: d.id, before, after: d });
    return c.json(d);
  });

  r.delete("/admin/colibri/devices/:id", needAuth, needOrg, may, async (c) => {
    adminOnly(c);
    const d = await deviceOf(c, c.req.param("id") ?? "");
    const hist = await db.select().from(colibriDeviceAssignments).where(eq(colibriDeviceAssignments.deviceId, d.id));
    await db.transaction(async (tx) => {
      await tx.delete(colibriDeviceAssignments).where(eq(colibriDeviceAssignments.deviceId, d.id));
      await tx.delete(colibriDevices).where(eq(colibriDevices.id, d.id));
    });
    await audit(db, { orgId: org(c), userId: who(c), action: "delete", entity: "colibri_device", entityId: d.id, before: { ...d, assignments: hist.map((a) => ({ stationId: a.stationId, from: a.validFrom, to: a.validTo })) } });
    hub.publish(org(c), 0);
    return c.json({ ok: true });
  });

  r.post("/admin/colibri/devices/:id/assign", needAuth, needOrg, may, zValidator("json", assignInput, validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = org(c);
    const d = await deviceOf(c, c.req.param("id") ?? "");
    await assertMayHandle(c, d.id, b.station_id);
    const out = await assignDevice(db, { orgId, deviceId: d.id, stationId: b.station_id, from: b.from ?? (await todayOf(orgId)), userId: who(c) });
    hub.publish(orgId, 0);
    return c.json(out);
  });

  r.post("/admin/colibri/devices/:id/unassign", needAuth, needOrg, may, zValidator("json", unassignInput, validationHook), async (c) => {
    const orgId = org(c);
    const d = await deviceOf(c, c.req.param("id") ?? "");
    await assertMayHandle(c, d.id, null);
    const done = await unassignDevice(db, { orgId, deviceId: d.id, to: c.req.valid("json").to ?? (await todayOf(orgId)), userId: who(c) });
    hub.publish(orgId, 0);
    return c.json({ ok: true, changed: done });
  });

  return r;
}
