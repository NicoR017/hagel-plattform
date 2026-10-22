import { and, eq, inArray, sql } from "drizzle-orm";
import type { AzureSource, TableRow } from "./azure";
import { colStr } from "./azure";
import type { Db } from "./db";
import {
  azureBcInsuranceLinks, azureBusinessCustomers, azureInsurances, azureSyncRuns, azureSyncState, azureTenants, colibriScans, insurers, orgTenants,
  stationInsurers, stations,
} from "./schema";

export const normalizeName = (s: unknown) => String(s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
const truthy = (v: unknown) => v === true || /^(true|1|yes)$/i.test(String(v ?? ""));
const OVERLAP_MS = 10 * 60_000;

export interface SyncStats { tenants: number; businessCustomers: number; insurances: number; links: number; scansSeen: number; scansNew: number; scansFailed: number; linked: number; renamed: number }

type Row = typeof colibriScans.$inferInsert;
export function scanFromRow(r: TableRow): Row {
  const dt = colStr(r, "ScanDateTime");
  const dents = colStr(r, "DentsTotalNumber");
  return {
    partitionKey: r.PartitionKey, rowKey: r.RowKey, tenant: colStr(r, "Tenant"), location: colStr(r, "Location"), colibriNumber: colStr(r, "ColibriNumber"),
    businessCustomer: colStr(r, "BusinessCustomer"), claimNumber: colStr(r, "ClaimNumber"), scanDateTime: dt && !Number.isNaN(Date.parse(dt)) ? new Date(dt) : null,
    plate: colStr(r, "LicensePlate"), vin: colStr(r, "VIN"), brand: colStr(r, "CarBrand"), model: colStr(r, "CarModel"), buildYear: colStr(r, "CarBuildYear"),
    country: colStr(r, "Country"), language: colStr(r, "Language"), calculationMethod: colStr(r, "CalculationMethod"),
    dentsTotal: dents !== "" && !Number.isNaN(Number(dents)) ? Math.round(Number(dents)) : null, scanFailed: truthy(r.ScanFailed ?? colStr(r, "ScanFailed")),
    errorMessage: colStr(r, "ErrorMessage"), urlPdf: colStr(r, "urlPdf", "UrlPdf"), raw: pruneRaw(r) as never,
  };
}
/** Keep the raw row for diagnostics, without gigantic fields. */
const pruneRaw = (r: TableRow) => Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v !== "string" || v.length < 500));

/**
 * One run of the Azure -> database mirror (worker every few minutes, or "sync now" in the admin).
 * Idempotent; the incremental cursor is the newest Timestamp seen (minus an overlap), so nothing is skipped.
 */
/**
 * A scan whose vehicle was deleted is available again (and the deleted vehicle gives up the scan key, which is unique): otherwise the scan stays
 * "imported" for ever and never shows up in the list of available scans. Returns how many scans were opened again.
 */
export async function reopenScansOfDeletedVehicles(db: Pick<Db, "execute">): Promise<number> {
  const r = (await db.execute(sql`
    update colibri_scans s set import_status = 'new', vehicle_id = null, imported_by = null, imported_at = null, updated_at = now()
    from vehicles v where s.vehicle_id = v.id and v.deleted_at is not null and s.import_status = 'imported' returning 1`)) as unknown as { rows: unknown[] };
  await db.execute(sql`update vehicles set colibri_scan_key = null where deleted_at is not null and colibri_scan_key is not null`);
  return r.rows.length;
}

export async function syncAzure(db: Db, az: AzureSource, o: { now?: () => Date; initialDays?: number } = {}): Promise<SyncStats> {
  const now = o.now ?? (() => new Date());
  await reopenScansOfDeletedVehicles(db).catch(() => undefined); // never blocks the mirror
  const [run] = await db.insert(azureSyncRuns).values({ startedAt: now() }).returning();
  const stats: SyncStats = { tenants: 0, businessCustomers: 0, insurances: 0, links: 0, scansSeen: 0, scansNew: 0, scansFailed: 0, linked: 0, renamed: 0 };
  try {
    for await (const r of az.queryTable("Tenants")) {
      const name = r.RowKey || r.PartitionKey;
      if (!name) continue;
      await db.insert(azureTenants).values({ name }).onConflictDoUpdate({ target: azureTenants.name, set: { seenAt: now() } });
      stats.tenants++;
    }
    for await (const r of az.queryTable("BusinessCustomers")) {
      const name = colStr(r, "BusinessCustomer", "Name");
      await db.insert(azureBusinessCustomers).values({ id: r.RowKey, name, partitionKey: r.PartitionKey }).onConflictDoUpdate({ target: azureBusinessCustomers.id, set: { name, partitionKey: r.PartitionKey, seenAt: now() } });
      stats.businessCustomers++;
    }
    for await (const r of az.queryTable("Insurance")) {
      const name = colStr(r, "Insurance", "Name");
      await db.insert(azureInsurances).values({ id: r.RowKey, name, partitionKey: r.PartitionKey }).onConflictDoUpdate({ target: azureInsurances.id, set: { name, partitionKey: r.PartitionKey, seenAt: now() } });
      stats.insurances++;
    }
    for await (const r of az.queryTable("BusinessCustomersInsurance")) {
      const v = { id: r.RowKey, name: colStr(r, "BusinessCustomerInsurance", "Name"), businessCustomerId: colStr(r, "BusinessCustomerId"), insuranceId: colStr(r, "InsuranceId"), partitionKey: r.PartitionKey };
      await db.insert(azureBcInsuranceLinks).values(v).onConflictDoUpdate({ target: azureBcInsuranceLinks.id, set: { ...v, seenAt: now() } });
      stats.links++;
    }

    // scans: incremental by the table's own Timestamp
    const [st] = await db.select().from(azureSyncState).where(eq(azureSyncState.key, "scans_cursor"));
    const since = st ? new Date(Date.parse((st.value as { at: string }).at) - OVERLAP_MS) : new Date(now().getTime() - (o.initialDays ?? 30) * 86400_000);
    let newest = st ? Date.parse((st.value as { at: string }).at) : 0;
    for await (const r of az.queryTable("AllScanResults", { filter: `Timestamp ge datetime'${since.toISOString()}'` })) {
      stats.scansSeen++;
      const row = scanFromRow(r);
      const ts = Date.parse(String(r.Timestamp ?? ""));
      if (!Number.isNaN(ts) && ts > newest) newest = ts;
      if (row.scanFailed) stats.scansFailed++;
      const ex = await db.select({ s: colibriScans.importStatus }).from(colibriScans).where(and(eq(colibriScans.partitionKey, row.partitionKey), eq(colibriScans.rowKey, row.rowKey)));
      if (!ex.length) stats.scansNew++;
      // never touch our own import state when the Azure row is re-read
      const { partitionKey: _p, rowKey: _r, ...upd } = row;
      await db.insert(colibriScans).values(row).onConflictDoUpdate({ target: [colibriScans.partitionKey, colibriScans.rowKey], set: { ...upd, updatedAt: now() } });
    }
    if (newest) await db.insert(azureSyncState).values({ key: "scans_cursor", value: { at: new Date(newest).toISOString() } as never }).onConflictDoUpdate({ target: azureSyncState.key, set: { value: { at: new Date(newest).toISOString() } as never } });

    const rec = await reconcileLinks(db);
    stats.linked = rec.linked; stats.renamed = rec.renamed;
    await db.update(azureSyncRuns).set({ finishedAt: now(), ok: true, stats: stats as never }).where(eq(azureSyncRuns.id, run.id));
    return stats;
  } catch (e) {
    await db.update(azureSyncRuns).set({ finishedAt: now(), ok: false, error: String((e as Error).message).slice(0, 500), stats: stats as never }).where(eq(azureSyncRuns.id, run.id));
    throw e;
  }
}

/**
 * Azure is master for names and links of linked records: a carrosserie linked to a BusinessCustomer takes its name, an insurer linked to an
 * Insurance takes its name, and station_insurers follows BusinessCustomersInsurance (keeping the history of link names).
 */
export async function reconcileLinks(db: Db): Promise<{ linked: number; renamed: number }> {
  let linked = 0, renamed = 0;
  const bcs = new Map((await db.select().from(azureBusinessCustomers)).map((b) => [b.id, b]));
  const ins = new Map((await db.select().from(azureInsurances)).map((i) => [i.id, i]));
  const links = await db.select().from(azureBcInsuranceLinks);
  const sts = (await db.select().from(stations)).filter((s) => s.azureBcIds.length || s.azureLinkIds.length);
  const ours = (await db.select().from(insurers)).filter((i) => i.azureInsuranceId);
  for (const s of sts.filter((x) => x.azureBcIds.length === 1 && !x.azureLinkIds.length)) { // the name follows Azure only when the site is exactly one customer
    const b = bcs.get(s.azureBcIds[0]);
    if (b && b.name && b.name !== s.name) { await db.update(stations).set({ name: b.name, updatedAt: new Date() }).where(eq(stations.id, s.id)); renamed++; }
  }
  for (const i of ours) {
    const a = ins.get(i.azureInsuranceId!);
    if (a && a.name && a.name !== i.name) { await db.update(insurers).set({ name: a.name, updatedAt: new Date() }).where(eq(insurers.id, i.id)); renamed++; }
  }
  for (const l of links) {
    for (const s of sts.filter((x) => siteTakesLink(x, l))) {
      for (const i of ours.filter((x) => x.azureInsuranceId === l.insuranceId && x.orgId === s.orgId)) {
        const [ex] = await db.select().from(stationInsurers).where(and(eq(stationInsurers.stationId, s.id), eq(stationInsurers.insurerId, i.id)));
        const names = [...new Set([...(ex?.azureLinkNames ?? []), l.name].filter(Boolean))];
        if (!ex) { await db.insert(stationInsurers).values({ stationId: s.id, insurerId: i.id, azureLinkId: l.id, azureLinkNames: names }); linked++; }
        else if (ex.azureLinkId !== l.id || names.length !== ex.azureLinkNames.length) await db.update(stationInsurers).set({ azureLinkId: l.id, azureLinkNames: names }).where(and(eq(stationInsurers.stationId, s.id), eq(stationInsurers.insurerId, i.id)));
      }
    }
  }
  return { linked, renamed };
}

// ------------------------------------------------------------------ mapping of a scan to our records

export interface MappingContext {
  links: (typeof azureBcInsuranceLinks.$inferSelect)[];
  stations: (typeof stations.$inferSelect)[];
  insurers: (typeof insurers.$inferSelect)[];
}
export async function loadMappingContext(db: Db): Promise<MappingContext> {
  return {
    links: await db.select().from(azureBcInsuranceLinks),
    stations: await db.select().from(stations).where(eq(stations.active, true)),
    insurers: await db.select().from(insurers),
  };
}

/** A site takes every link of its customers, plus the individually ticked links. */
export const siteTakesLink = (s: Pick<typeof stations.$inferSelect, "azureLinkIds" | "azureBcIds">, l: Pick<typeof azureBcInsuranceLinks.$inferSelect, "id" | "businessCustomerId">) =>
  s.azureLinkIds.includes(l.id) || s.azureBcIds.includes(l.businessCustomerId);

export type ScanWarning = "no_link" | "no_site" | "tenant_mismatch" | "location_unmapped" | "no_insurer" | "scan_failed";
export interface ScanMapping {
  orgId: string | null;
  clientStationId: string | null;
  stationId: string | null;
  insurerId: string | null;
  businessCustomerId: string | null;
  insuranceId: string | null;
  warnings: ScanWarning[];
  importable: boolean;
}

/**
 * HARD RULE: a scan can only point to sites of ITS OWN tenant (scan.Tenant = site.azure_tenant), even if the names are identical.
 * Customer: scan.BusinessCustomer (normalised) -> BusinessCustomersInsurance row -> BusinessCustomerId -> carrosserie site with that
 * azure_business_customer_id AND the same tenant. Current site: the customer, unless the Location (free text) is an alias of a
 * hall / yard of the same tenant. Insurer: InsuranceId -> insurer of the same organisation.
 */
export function mapScan(scan: Pick<typeof colibriScans.$inferSelect, "tenant" | "location" | "businessCustomer" | "scanFailed">, ctx: MappingContext): ScanMapping {
  const warnings: ScanWarning[] = [];
  if (scan.scanFailed) warnings.push("scan_failed");
  const norm = normalizeName(scan.businessCustomer);
  const link = norm ? ctx.links.find((l) => normalizeName(l.name) === norm) : undefined;
  if (!link) warnings.push("no_link");
  const sameTenant = ctx.stations.filter((s) => s.azureTenant === scan.tenant && !!scan.tenant);
  let client = link ? sameTenant.find((s) => s.type === "carrosserie" && siteTakesLink(s, link)) ?? null : null;
  if (link && !client) {
    warnings.push(ctx.stations.some((s) => siteTakesLink(s, link)) ? "tenant_mismatch" : "no_site");
  }
  let current = client;
  const loc = normalizeName(scan.location);
  if (loc) {
    const alias = sameTenant.find((s) => s.type !== "carrosserie" && s.azureLocationAliases.some((a) => normalizeName(a) === loc));
    if (alias && (!client || alias.orgId === client.orgId)) current = alias;
    else if (!alias && !client) warnings.push("location_unmapped");
  }
  const orgId = current?.orgId ?? client?.orgId ?? null;
  let insurer = null as (typeof ctx.insurers)[number] | null;
  if (link && orgId) {
    insurer = ctx.insurers.find((i) => i.azureInsuranceId === link.insuranceId && i.orgId === orgId) ?? null;
    if (!insurer) warnings.push("no_insurer");
  }
  return {
    orgId, clientStationId: client?.id ?? null, stationId: current?.id ?? null, insurerId: insurer?.id ?? null,
    businessCustomerId: link?.businessCustomerId ?? null, insuranceId: link?.insuranceId ?? null, warnings,
    importable: !!current && !scan.scanFailed,
  };
}

/** Tenants an organisation may use: assigned by the super-admin plus the tenants of its own sites. */
export async function tenantsOfOrg(db: Db, orgId: string): Promise<string[]> {
  const a = (await db.select().from(orgTenants).where(eq(orgTenants.orgId, orgId))).map((t) => t.azureTenant);
  const b = (await db.select({ t: stations.azureTenant }).from(stations).where(eq(stations.orgId, orgId))).map((x) => x.t).filter((x): x is string => !!x);
  return [...new Set([...a, ...b])];
}

export async function newScansOfTenants(db: Db, tenants: string[]) {
  if (!tenants.length) return [];
  // tenant isolation in SQL: only scans of tenants this organisation may use are ever read
  return db.select().from(colibriScans).where(and(inArray(colibriScans.tenant, tenants), eq(colibriScans.importStatus, "new"), sql`${colibriScans.scanFailed} = false`));
}
