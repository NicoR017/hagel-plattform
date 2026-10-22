import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { audit } from "./audit";
import { HttpError } from "./auth";
import type { AzureSource } from "./azure";
import { importScans } from "./azure_import";
import { loadMappingContext, mapScan, newScansOfTenants, normalizeName, reconcileLinks, syncAzure, tenantsOfOrg } from "./azure_sync";
import type { Db } from "./db";
import type { Env } from "./env";
import type { Hub } from "./hub";
import { canOrg } from "./permissions";
import { azureBcInsuranceLinks, azureBusinessCustomers, azureInsurances, azureSyncRuns, azureTenants, colibriScans, organizations, stations } from "./schema";
import type { Storage } from "./storage";

interface Deps {
  db: Db; hub: Hub; storage: Storage; az: AzureSource | null;
  needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env>;
  validationHook: (r: { success: boolean }, c: Context) => Response | undefined;
}

const keyInput = z.object({ station_id: z.string().uuid().optional(), keys: z.array(z.object({ partitionKey: z.string().min(1).max(300), rowKey: z.string().max(300) })).min(1).max(50) });

export function azureRoutes({ db, hub, storage, az, needAuth, needOrg, validationHook }: Deps) {
  const r = new Hono<Env>();
  let lastManualSync = 0;

  /** Scans waiting for import that point to a site where the user may import (and, for admins, the ones that still need a mapping). */
  r.get("/azure/scans", needAuth, needOrg, async (c) => {
    const u = c.get("principal"), orgId = c.get("orgId");
    const tenants = await tenantsOfOrg(db, orgId);
    const rows = await newScansOfTenants(db, tenants);
    const ctx = await loadMappingContext(db);
    const isAdmin = canOrg(u, "stations.gerer", orgId);
    const insName = new Map(ctx.insurers.map((i) => [i.id, i.name]));
    const stName = new Map(ctx.stations.map((s) => [s.id, s.name]));
    // ?all=1: also the scans mapped to another station (or to none) of the organisation: they can be loaded into the station the user is in
    const everywhere = c.req.query("all") === "1" && canOrg(u, "colibri.importer", orgId);
    const out = [];
    for (const s of rows) {
      const m = mapScan(s, ctx);
      const mine = m.orgId === orgId && m.stationId && canOrg(u, "colibri.importer", orgId, m.stationId);
      const adminUnmapped = !m.orgId && isAdmin; // only visible to admins of an organisation that owns this tenant
      const elsewhere = everywhere && !mine && (m.orgId === orgId || !m.orgId);
      if (!mine && !adminUnmapped && !elsewhere) continue;
      out.push({
        partitionKey: s.partitionKey, rowKey: s.rowKey, scanDateTime: s.scanDateTime, plate: s.plate, brand: s.brand, model: s.model, colibriNumber: s.colibriNumber,
        businessCustomer: s.businessCustomer, claimNumber: s.claimNumber, location: s.location, dentsTotal: s.dentsTotal, tenant: s.tenant,
        stationId: m.stationId, stationName: m.stationId ? stName.get(m.stationId) ?? "" : "", clientName: m.clientStationId ? stName.get(m.clientStationId) ?? "" : "",
        insurerName: m.insurerId ? insName.get(m.insurerId) ?? "" : "", warnings: m.warnings, importable: (m.importable && !!mine) || (elsewhere && !s.scanFailed),
      });
    }
    // newest first, by the real time (a Date compared as text is not chronological)
    const at = (x: { scanDateTime: Date | string | null; partitionKey: string }) => (x.scanDateTime ? new Date(x.scanDateTime).getTime() : 0);
    out.sort((a, b) => at(b) - at(a) || b.partitionKey.localeCompare(a.partitionKey));
    return c.json(out.slice(0, 300));
  });

  r.post("/azure/scans/import", needAuth, needOrg, zValidator("json", keyInput, validationHook), async (c) => {
    if (!az) throw new HttpError(409, "azure_unavailable");
    const body = c.req.valid("json");
    const results = await importScans({ db, az, storage, hub }, c.get("principal"), body.keys, c.get("orgId"), body.station_id ?? null);
    return c.json({ results });
  });

  // ------------------------------------------------------------------ admin: status, pickers, mapping
  const manage: MiddlewareHandler<Env> = async (c, next) => {
    if (!canOrg(c.get("principal"), "stations.gerer", c.get("orgId"))) throw new HttpError(403, "forbidden");
    await next();
  };

  r.get("/admin/azure/status", needAuth, needOrg, manage, async (c) => {
    const orgId = c.get("orgId");
    const tenants = await tenantsOfOrg(db, orgId);
    const runs = await db.select().from(azureSyncRuns).orderBy(desc(azureSyncRuns.startedAt)).limit(10);
    const ctx = await loadMappingContext(db);
    const rows = await newScansOfTenants(db, tenants);
    const unmappedCustomers = new Map<string, { name: string; tenant: string; scans: number }>();
    const unmappedLocations = new Map<string, { location: string; tenant: string; scans: number }>();
    let importable = 0, blocked = 0;
    for (const s of rows) {
      const m = mapScan(s, ctx);
      if (m.importable) importable++; else blocked++;
      if (m.warnings.includes("no_link") || m.warnings.includes("no_site") || m.warnings.includes("tenant_mismatch")) {
        const k = `${s.tenant}|${normalizeName(s.businessCustomer)}`;
        const e = unmappedCustomers.get(k) ?? { name: s.businessCustomer, tenant: s.tenant, scans: 0 };
        e.scans++; unmappedCustomers.set(k, e);
      }
      if (m.warnings.includes("location_unmapped")) {
        const k = `${s.tenant}|${normalizeName(s.location)}`;
        const e = unmappedLocations.get(k) ?? { location: s.location, tenant: s.tenant, scans: 0 };
        e.scans++; unmappedLocations.set(k, e);
      }
    }
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(colibriScans);
    return c.json({
      configured: !!az, sasExpiresAt: az?.expiresAt?.()?.toISOString() ?? null, tenants, lastRuns: runs.map((x) => ({ at: x.startedAt, finishedAt: x.finishedAt, ok: x.ok, error: x.error, stats: x.stats })),
      scansMirrored: n, waiting: { importable, blocked }, unmappedCustomers: [...unmappedCustomers.values()].filter((e) => e.name), unmappedLocations: [...unmappedLocations.values()],
    });
  });

  /** Mirrors for the pickers of the site / insurer forms (names are read-only: Azure is master). */
  // The scans carry the BusinessCustomersInsurance name ("<customer>-<insurance>"), so the customers on offer are those that appear in that
  // table, each with the link names a scan can carry.
  r.get("/admin/azure/business-customers", needAuth, needOrg, manage, async (c) => {
    const links = await db.select().from(azureBcInsuranceLinks);
    const byBc = new Map<string, { id: string; name: string }[]>();
    for (const l of links) if (l.businessCustomerId) byBc.set(l.businessCustomerId, [...(byBc.get(l.businessCustomerId) ?? []), { id: l.id, name: l.name }]);
    const bcs = await db.select().from(azureBusinessCustomers).orderBy(azureBusinessCustomers.name);
    return c.json(bcs.filter((b) => byBc.has(b.id)).map((b) => ({ ...b, links: (byBc.get(b.id) ?? []).sort((a, z) => a.name.localeCompare(z.name)) })));
  });
  r.get("/admin/azure/insurances", needAuth, needOrg, manage, async (c) => c.json(await db.select().from(azureInsurances).orderBy(azureInsurances.name)));
  r.get("/admin/azure/tenants", needAuth, needOrg, async (c) => {
    const u = c.get("principal"), orgId = c.get("orgId");
    if (u.isSuperadmin) return c.json((await db.select().from(azureTenants).orderBy(azureTenants.name)).map((t) => t.name));
    if (!canOrg(u, "stations.gerer", orgId)) throw new HttpError(403, "forbidden");
    return c.json(await tenantsOfOrg(db, orgId)); // an organisation only ever sees its own tenants
  });

  r.post("/admin/azure/sync", needAuth, needOrg, manage, async (c) => {
    if (!az) throw new HttpError(409, "azure_unavailable");
    if (Date.now() - lastManualSync < 30_000) throw new HttpError(429, "too_many_requests");
    lastManualSync = Date.now();
    try { return c.json(await syncAzure(db, az)); } catch { throw new HttpError(502, "azure_failed"); }
  });

  /** Link a scan's customer to a carrosserie of this organisation: an existing one, or a new one created from the Azure name. */
  r.post("/admin/azure/map-customer", needAuth, needOrg, manage, zValidator("json", z.object({
    link_name: z.string().min(1).max(300), tenant: z.string().min(1).max(120), station_id: z.string().uuid().nullable().default(null),
  }), validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId"), u = c.get("principal");
    if (!(await tenantsOfOrg(db, orgId)).includes(b.tenant)) throw new HttpError(400, "tenant_not_allowed");
    const norm = normalizeName(b.link_name);
    const link = (await db.select().from(azureBcInsuranceLinks)).find((l) => normalizeName(l.name) === norm);
    if (!link) throw new HttpError(404, "azure_link_unknown");
    const [bc] = await db.select().from(azureBusinessCustomers).where(eq(azureBusinessCustomers.id, link.businessCustomerId));
    let station;
    if (b.station_id) {
      const [s] = await db.select().from(stations).where(and(eq(stations.id, b.station_id), eq(stations.orgId, orgId)));
      if (!s) throw new HttpError(404, "station_not_found");
      if (s.azureTenant && s.azureTenant !== b.tenant) throw new HttpError(400, "tenant_not_allowed");
      [station] = await db.update(stations).set({ azureBusinessCustomerId: s.azureBusinessCustomerId ?? link.businessCustomerId, azureBcIds: [...new Set([...s.azureBcIds, link.businessCustomerId])], azureTenant: b.tenant, type: "carrosserie", updatedAt: new Date() }).where(eq(stations.id, s.id)).returning();
    } else {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
      [station] = await db.insert(stations).values({ orgId, type: "carrosserie", name: bc?.name || b.link_name, country: org.country, azureTenant: b.tenant, azureBusinessCustomerId: link.businessCustomerId, azureBcIds: [link.businessCustomerId] }).returning();
    }
    await reconcileLinks(db);
    await audit(db, { orgId, userId: u.id, action: "azure.map_customer", entity: "station", entityId: station.id, after: { linkName: b.link_name, tenant: b.tenant, businessCustomerId: link.businessCustomerId } });
    hub.publish(orgId, 0);
    return c.json(station, 201);
  });

  /** Remember that a free-text Colibri Location means this hall / yard (alias), once. */
  r.post("/admin/azure/map-location", needAuth, needOrg, manage, zValidator("json", z.object({
    location: z.string().min(1).max(200), tenant: z.string().min(1).max(120), station_id: z.string().uuid(),
  }), validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId");
    if (!(await tenantsOfOrg(db, orgId)).includes(b.tenant)) throw new HttpError(400, "tenant_not_allowed");
    const [s] = await db.select().from(stations).where(and(eq(stations.id, b.station_id), eq(stations.orgId, orgId)));
    if (!s) throw new HttpError(404, "station_not_found");
    if (s.azureTenant !== b.tenant) throw new HttpError(400, "tenant_not_allowed"); // a site only answers for its own tenant
    const aliases = [...new Set([...s.azureLocationAliases, b.location.trim()])];
    const [out] = await db.update(stations).set({ azureLocationAliases: aliases, updatedAt: new Date() }).where(eq(stations.id, s.id)).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "azure.map_location", entity: "station", entityId: s.id, after: { location: b.location, tenant: b.tenant } });
    return c.json(out);
  });

  return r;
}
