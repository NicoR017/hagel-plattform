// Data integrity report (READ-ONLY: SELECT statements only). Run it before and after a migration or a deploy and compare.
//
//   DATABASE_URL=... npm run integrity                       print the report
//   DATABASE_URL=... npm run integrity -- --out before.json  also save it
//   DATABASE_URL=... npm run integrity -- --compare before.json   print only the differences (exit 1 if any)
//
// Only the `stable` part is compared: tables that exist today. Tables added later are listed under `added`, never compared.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { computeVehicle, type CalcVehicle } from "@hagel/calc";
import { createDb } from "../db";
import { organizations, stations, vehicles } from "../schema";
import { loadMethodMap, methodOf } from "../methods";
import { calcSettings, flatten, loadOrgSettings } from "../sync";

const r2 = (x: number) => Math.round(x * 100) / 100;

async function count(db: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, table: string, where = ""): Promise<number> {
  const res = (await db.execute(sql.raw(`select count(*)::int as n from "${table}" ${where}`))) as { rows: { n: number }[] };
  return res.rows[0].n;
}

export async function buildReport(db: Awaited<ReturnType<typeof createDb>>["db"]) {
  const orgs = await db.select().from(organizations);
  const stName = new Map((await db.select().from(stations)).map((s) => [s.id, s.name]));

  const stable: Record<string, unknown> = {};
  const perOrg: Record<string, unknown> = {};
  const digest = createHash("sha256");
  for (const o of orgs.sort((a, b) => a.name.localeCompare(b.name))) {
    const rows = await db.select().from(vehicles).where(eq(vehicles.orgId, o.id));
    const settings = calcSettings(await loadOrgSettings(db, o.id));
    const methods = await loadMethodMap(db, o.id);
    const byStation: Record<string, number> = {}, byStatus: Record<string, number> = {};
    let live = 0, deleted = 0, net = 0, gross = 0, withShares = 0;
    for (const r of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
      if (r.deletedAt) { deleted++; continue; }
      live++;
      const st = stName.get(r.stationId ?? "") ?? "(none)";
      byStation[st] = (byStation[st] ?? 0) + 1;
      byStatus[r.statut] = (byStatus[r.statut] ?? 0) + 1;
      if (r.shares && Object.keys(r.shares as object).length) withShares++;
      const c = computeVehicle(flatten(r, [], null) as unknown as CalcVehicle, settings, methodOf(methods, r));
      net = r2(net + c.netto); gross = r2(gross + c.brutto);
      digest.update(`${r.id}:${c.netto.toFixed(2)}\n`);
    }
    perOrg[o.name] = { vehiclesLive: live, vehiclesDeleted: deleted, byStation, byStatus, vehiclesWithShares: withShares, netTotal: net, grossTotal: gross };
  }
  stable.perOrg = perOrg;
  stable.netDigest = digest.digest("hex");

  const photosAll = await count(db, "photos"), photosDel = await count(db, "photos", "where deleted_at is not null");
  const photosNoFile = await count(db, "photos", "where file_key is null and deleted_at is null");
  stable.photos = { total: photosAll, deleted: photosDel, liveWithoutFile: photosNoFile };
  const tables = [
    "organizations", "users", "memberships", "roles", "role_assignments", "stations", "insurers", "station_insurers", "campaigns", "companies", "technicians",
    "vehicle_assignments", "vehicle_status_history", "vehicle_moves", "report_sends", "audit_log", "colibri_scans", "sync_ops", "sessions",
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = await count(db, t);
  stable.counts = counts;
  stable.scansByStatus = Object.fromEntries(
    ((await db.execute(sql`select import_status as s, count(*)::int as n from colibri_scans group by 1 order by 1`)) as unknown as { rows: { s: string; n: number }[] }).rows.map((r) => [r.s, r.n]),
  );
  stable.usersByStatus = Object.fromEntries(
    ((await db.execute(sql`select status as s, count(*)::int as n from users group by 1 order by 1`)) as unknown as { rows: { s: string; n: number }[] }).rows.map((r) => [r.s, r.n]),
  );

  // tables that appear with later migrations (informational only)
  const known = new Set([...tables, "photos", "vehicles", "org_settings", "org_tenants", "campaign_stations", "invitations", "login_tokens",
    "azure_tenants", "azure_business_customers", "azure_insurances", "azure_bc_insurance_links", "azure_sync_runs", "azure_sync_state", "__drizzle_migrations"]);
  const all = ((await db.execute(sql`select table_name as t from information_schema.tables where table_schema in ('public','drizzle') order by 1`)) as unknown as { rows: { t: string }[] }).rows.map((r) => r.t);
  const added: Record<string, number> = {};
  for (const t of all) if (!known.has(t)) added[t] = await count(db, t);
  const live = await db.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(and(isNull(vehicles.deletedAt)));
  return { generatedAt: new Date().toISOString(), vehiclesLiveTotal: live[0].n, stable, added };
}

function diff(a: unknown, b: unknown, path = ""): string[] {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return a === b ? [] : [`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`];
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  return [...keys].flatMap((k) => diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`));
}

if (process.argv[1] && /integrity\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required (this script never uses the in-memory database)"); process.exit(2); }
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const h = await createDb(url, { migrate: false });
  try {
    const rep = await buildReport(h.db);
    const out = arg("--out"), cmp = arg("--compare");
    if (out) writeFileSync(out, JSON.stringify(rep, null, 2));
    if (cmp) {
      const before = JSON.parse(readFileSync(cmp, "utf8")) as typeof rep;
      const d = diff(before.stable, rep.stable);
      console.log(d.length ? `DIFFERENCES (${d.length}):\n${d.join("\n")}` : "IDENTICAL: stable integrity numbers are unchanged");
      console.log("added tables:", JSON.stringify(rep.added));
      process.exitCode = d.length ? 1 : 0;
    } else console.log(JSON.stringify(rep, null, 2));
  } finally { await h.close(); }
}
