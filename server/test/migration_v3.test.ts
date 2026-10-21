// Migrations 0010+ on a database in the PRE-v3 shape, seeded with the 22 real golden vehicles: nothing is lost, no amount moves, backfills are right.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { ES_MATRIX_DEFAULT, computeVehicle, r2, type CalcVehicle } from "@hagel/calc";
import golden from "../../fixtures/golden_cases_v20.json";
import { migrationsFolder } from "../src/db";
import { loadMethodMap, methodOf } from "../src/methods";
import { buildReport } from "../src/scripts/integrity";
import * as schema from "../src/schema";
import { calcSettings, flatten, loadOrgSettings } from "../src/sync";

type Case = { case: string; input: CalcVehicle & { id: string }; expected: Record<string, any> };
const cases = (golden as unknown as { cases: Case[] }).cases;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG_DE = uid(1), ORG_ES = uid(2), ST_DE = uid(11), ST_ES = uid(12);

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query<T>(sql, params)).rows;

/** the migrations folder as it was before v3: 0000..0009 only */
function preV3Folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "hagel-pre-v3-"));
  mkdirSync(join(dir, "meta"));
  for (const f of readdirSync(migrationsFolder).filter((x) => x.endsWith(".sql") && Number(x.slice(0, 4)) <= 9)) copyFileSync(join(migrationsFolder, f), join(dir, f));
  const j = JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"));
  j.entries = j.entries.filter((e: { idx: number }) => e.idx <= 9);
  writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify(j));
  return dir;
}

const STATUS_CYCLE = [["reparatur", null], ["fertig", null], ["attente", "reparatur"], ["besichtigung", null], ["rendu", null], ["arrive", null], ["attente", "besichtigung"], ["reparatur", null]] as const;
const beforeHeaders = new Map<string, string>();
const beforeCounts: Record<string, number> = {};

beforeAll(async () => {
  client = new PGlite();
  const lite = drizzle(client, { schema });
  db = lite;
  await migrate(lite, { migrationsFolder: preV3Folder() });
  // the pre-v3 schema has none of the new tables / columns
  expect((await q("select count(*)::int as n from information_schema.tables where table_name in ('calc_methods','repair_todos','repair_bookings')"))[0]).toEqual({ n: 0 });
  expect((await q("select count(*)::int as n from information_schema.columns where table_name = 'vehicles' and column_name in ('repair_stage','method_id')"))[0]).toEqual({ n: 0 });

  await q(`insert into organizations (id, name, country) values ($1, 'PDR Team GmbH', 'DE'), ($2, 'PDR Team Spain', 'ES')`, [ORG_DE, ORG_ES]);
  await q(`insert into stations (id, org_id, type, name, country, capacite) values ($1, $3, 'carrosserie', 'Huber', 'DE', 40), ($2, $4, 'carrosserie', 'Garcia', 'ES', 40)`, [ST_DE, ST_ES, ORG_DE, ORG_ES]);
  // Spain's organisation had customised (here: explicitly stored) its matrix; Germany never touched the settings
  await q(`insert into org_settings (org_id, settings) values ($1, $2::jsonb)`, [ORG_ES, JSON.stringify({ rateDE: 83, rateES: 69, defaultTeiler: 10, esMatrix: ES_MATRIX_DEFAULT })]);
  // roles as they exist in production today (old permission lists)
  const old = {
    org_admin: ["vehicules.voir", "vehicules.creer", "vehicules.modifier", "vehicules.supprimer", "vehicules.assigner", "vehicules.deplacer", "vehicules.changer_statut", "prix.voir", "repartition_interne.voir", "ma_part.voir", "ma_commission.voir", "commission.modifier", "kva.envoyer", "rapport_reparation.envoyer", "photos.ajouter", "photos.supprimer", "colibri.importer", "export.excel", "assurances.gerer", "campagnes.gerer", "stations.gerer", "parametres.gerer", "utilisateurs.gerer", "roles.gerer", "audit.voir", "dashboard.voir"],
    chef_site: ["vehicules.voir", "vehicules.modifier", "vehicules.assigner", "vehicules.deplacer", "vehicules.changer_statut", "prix.voir", "repartition_interne.voir", "commission.modifier", "export.excel", "dashboard.voir"],
    technicien: ["vehicules.voir", "vehicules.modifier", "vehicules.changer_statut", "ma_part.voir", "photos.ajouter"],
    carrosserie: ["vehicules.voir", "prix.voir", "ma_commission.voir"],
    custom_viewer: ["vehicules.voir"],
    custom_planner: ["vehicules.voir", "vehicules.assigner", "prix.voir", "export.excel", "repartition_interne.voir"],
  } as Record<string, string[]>;
  for (const [i, [key, perms]] of Object.entries(old).entries()) {
    const system = !key.startsWith("custom");
    await q(`insert into roles (id, org_id, key, name, scope, permissions, is_system) values ($1, $2, $3, $4, 'station', $5::text[], $6)`,
      [uid(100 + i), ORG_ES, system ? key : null, key === "chef_site" ? "Chef de site (Werkstattleiter)" : key, perms, system]);
  }
  // the 22 golden vehicles, spread over the statuses (DE cases in the German organisation)
  for (const [i, c] of cases.entries()) {
    const { id: _id, panels, ...header } = c.input as CalcVehicle & { id: string; panels: object };
    const [statut, avant] = STATUS_CYCLE[i % STATUS_CYCLE.length];
    const org = c.input.land === "ES" ? ORG_ES : ORG_DE, st = c.input.land === "ES" ? ST_ES : ST_DE;
    await q(`insert into vehicles (id, org_id, station_id, client_station_id, statut, statut_avant, header, panels, seq) values ($1, $2, $3, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [uid(1000 + i), org, st, statut, avant, JSON.stringify({ land: c.input.land, ...header, kennzeichen: `T-${i}` }), JSON.stringify(panels), i + 1]);
  }
  await q(`insert into photos (id, vehicle_id, label, phase) values ($1, $2, 'Dach', 'besichtigung')`, [uid(5000), uid(1000)]);
  for (const r of await q<{ id: string; header: unknown }>("select id, header from vehicles")) beforeHeaders.set(r.id, JSON.stringify(r.header));
  for (const t of ["organizations", "stations", "vehicles", "photos", "roles", "org_settings"]) beforeCounts[t] = (await q<{ n: number }>(`select count(*)::int as n from ${t}`))[0].n;
  // ---- the full migration, exactly as the API runs it at boot
  await migrate(lite, { migrationsFolder });
}, 120_000);
afterAll(async () => { await client.close(); });

describe("migrations 0010+ on a pre-v3 database", () => {
  it("no row of the old tables disappears and no existing header is rewritten", async () => {
    for (const [t, n] of Object.entries(beforeCounts)) expect((await q<{ n: number }>(`select count(*)::int as n from ${t}`))[0].n, t).toBe(n);
    for (const r of await q<{ id: string; header: unknown }>("select id, header from vehicles")) expect(JSON.stringify(r.header)).toBe(beforeHeaders.get(r.id));
    expect(beforeHeaders.size).toBe(22);
  });

  it("the migration SQL is additive only: no DROP, RENAME, type change or DELETE", () => {
    for (const f of ["0010_v3_schema.sql", "0011_v3_backfill.sql", "0012_technician_email.sql"]) {
      const sql = readFileSync(join(migrationsFolder, f), "utf8").replace(/--.*$/gm, "");
      expect(sql, f).not.toMatch(/\bDROP\b|\bRENAME\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|ALTER\s+COLUMN|SET\s+NOT\s+NULL/i);
    }
  });

  it("every one of the 22 golden vehicles keeps exactly its v20 amount (frozen on version 1 of the system method)", async () => {
    for (const org of [ORG_DE, ORG_ES]) {
      const settings = calcSettings(await loadOrgSettings(db as never, org));
      const methods = await loadMethodMap(db as never, org);
      const rows = await db.select().from(schema.vehicles).where((await import("drizzle-orm")).eq(schema.vehicles.orgId, org));
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        const c = cases[Number(r.id.slice(-4)) - 1000];
        expect(r.methodVersion, c.case).toBe(1);
        const calc = computeVehicle(flatten(r, [], null) as unknown as CalcVehicle, settings, methodOf(methods, r));
        expect(r2(calc.netto), c.case).toBe(c.expected.netto);
        expect(r2(calc.brutto), c.case).toBe(c.expected.brutto);
      }
    }
    const rep = await buildReport(db as never);
    expect(rep.vehiclesLiveTotal).toBe(22);
    const expectedNet = (land: string) => r2(cases.filter((c) => c.input.land === land).reduce((a, c) => a + c.expected.netto, 0));
    const per = rep.stable.perOrg as Record<string, { netTotal: number }>;
    expect(per["PDR Team Spain"].netTotal).toBe(expectedNet("ES"));
    expect(per["PDR Team GmbH"].netTotal).toBe(expectedNet("DE"));
  });

  it("system methods: one DE and one ES per organisation, version 1; Spain's is a copy of the matrix the organisation had", async () => {
    const ms = await q<{ org_id: string; country: string; engine: string; is_system: boolean; current_version: number; name: string }>("select * from calc_methods order by org_id, country");
    expect(ms.map((m) => [m.org_id === ORG_DE ? "DE-org" : "ES-org", m.country, m.engine, m.is_system, m.current_version])).toEqual([
      ["DE-org", "DE", "aw", true, 1], ["DE-org", "ES", "matrix", true, 1], ["ES-org", "DE", "aw", true, 1], ["ES-org", "ES", "matrix", true, 1],
    ]);
    const params = async (org: string, country: string) => (await q<{ params: any }>("select v.params from calc_method_versions v join calc_methods m on m.id = v.method_id where m.org_id = $1 and m.country = $2 and v.version = 1", [org, country]))[0].params;
    expect((await params(ORG_ES, "ES")).esMatrix).toEqual(JSON.parse(JSON.stringify(ES_MATRIX_DEFAULT)));
    expect((await params(ORG_DE, "ES")).esMatrix).toBeNull(); // never customised: the built-in matrix
    const aw = await params(ORG_DE, "DE");
    expect(aw).toMatchObject({ vat: 0.19, aluFactor: 1.25, kleberFactor: 1.3, ptpFactor: 0.6, hohlraumMaterial: 15 });
    expect(aw.extras["12"]).toMatchObject({ ruest: 7, greif: 11, finishPer: 3.5, finishCap: 16, hohl: 5, verbr: 18 });
  });

  it("repair_stage backfill: reparatur / attente-from-reparatur -> bereit, fertig -> finish, everything else untouched", async () => {
    const rows = await q<{ id: string; statut: string; statut_avant: string | null; repair_stage: string | null }>("select id, statut, statut_avant, repair_stage from vehicles");
    for (const r of rows) {
      const expected = r.statut === "reparatur" || (r.statut === "attente" && r.statut_avant === "reparatur") ? "bereit" : r.statut === "fertig" ? "finish" : null;
      expect(r.repair_stage, `${r.statut}/${r.statut_avant}`).toBe(expected);
    }
    expect(new Set(rows.map((r) => r.repair_stage))).toEqual(new Set(["bereit", "finish", null]));
  });

  it("new permissions are appended to the roles that have the nearest existing one; nobody loses anything; chef is renamed", async () => {
    const perms = async (key: string) => (await q<{ permissions: string[] }>("select permissions from roles where key = $1 or (key is null and name = $1)", [key]))[0].permissions;
    const admin = await perms("org_admin");
    for (const p of ["reparatur.board", "termine.buchen", "kommentare.schreiben", "methoden.gerer", "wochenbericht.voir", "reparatur.endabnahme"]) expect(admin).toContain(p);
    const chef = await perms("chef_site");
    expect(chef).toEqual(expect.arrayContaining(["reparatur.board", "termine.buchen", "kommentare.schreiben", "reparatur.endabnahme"]));
    expect(chef).not.toContain("methoden.gerer");
    expect(chef).toContain("commission.modifier"); // old permissions are still there
    const tech = await perms("technicien");
    expect(tech).toEqual(expect.arrayContaining(["reparatur.board", "termine.buchen", "kommentare.schreiben"]));
    expect(tech).not.toContain("reparatur.endabnahme");
    expect(await perms("carrosserie")).toEqual(["vehicules.voir", "prix.voir", "ma_commission.voir"]); // external roles gain nothing
    expect(await perms("custom_viewer")).toEqual(["vehicules.voir"]);
    // a custom role with assigner + prix.voir gets the Endabnahme; export + split gets the weekly report
    const planner = await perms("custom_planner");
    expect(planner).toEqual(expect.arrayContaining(["reparatur.endabnahme", "wochenbericht.voir"]));
    expect(planner).not.toContain("reparatur.board");
    expect((await q<{ name: string }>("select name from roles where key = 'chef_site'"))[0].name).toBe("Chef de station (Stationsleiter)");
    for (const key of ["org_admin", "chef_site", "technicien"]) { const p = await perms(key); expect(new Set(p).size, key).toBe(p.length); } // no duplicates
  });

  it("the backfills are idempotent: running them again changes nothing", async () => {
    const snapshot = async () => JSON.stringify([
      await q("select * from calc_methods order by id"), await q("select * from calc_method_versions order by method_id, version"),
      await q("select id, repair_stage, method_id, method_version from vehicles order by id"), await q("select id, permissions, name from roles order by id"),
    ]);
    const before = await snapshot();
    const sql = readFileSync(join(migrationsFolder, "0011_v3_backfill.sql"), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) await client.exec(stmt);
    expect(await snapshot()).toBe(before);
  });

  it("new columns have defaults: a row written the OLD way (no new column named) still works on the new schema", async () => {
    await q(`insert into vehicles (id, org_id, station_id, statut, header, panels) values ($1, $2, $3, 'arrive', '{}'::jsonb, '{}'::jsonb)`, [uid(9000), ORG_ES, ST_ES]);
    await q(`insert into stations (id, org_id, type, name) values ($1, $2, 'hall', 'Old-style hall')`, [uid(9001), ORG_ES]);
    await q(`insert into technicians (id, org_id, name) values ($1, $2, 'Old tech')`, [uid(9002), ORG_ES]);
    expect((await q<any>("select repair_stage, method_id from vehicles where id = $1", [uid(9000)]))[0]).toEqual({ repair_stage: null, method_id: null });
    expect((await q<any>("select repairs_per_day, excluded_insurer_emails from stations where id = $1", [uid(9001)]))[0]).toEqual({ repairs_per_day: 3, excluded_insurer_emails: [] });
    expect((await q<any>("select kind from technicians where id = $1", [uid(9002)]))[0].kind).toBe("pdr");
  });
});
