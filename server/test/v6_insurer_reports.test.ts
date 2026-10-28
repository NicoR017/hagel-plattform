// V6 phase 1, automatic insurer reports: the rights (server side), the set-up (validation, scope, soft delete), the periods and the figures.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { PERMISSIONS, SYSTEM_ROLES } from "@hagel/shared";
import { computeInsurerKpis, lastCompletePeriod } from "../src/insurer_reports";
import { auditLog, colibriScans, insurers, repairBookings, roles, vehicleStatusHistory, vehicles } from "../src/schema";
import { call, inviteAndAccept, setup, type Ctx } from "./helpers";

let c: Ctx;
let HALL: string, CARRO: string, CARRO2: string, allianz: string, mapfre: string;
let chef: string, assessor: string, tech: string, bodyshopAcc: string;

const KEY = (k: string) => SYSTEM_ROLES.find((r) => r.key === k)!;
const sup = (m: string, p: string, body?: unknown) => call(c, m, p, { token: c.superToken, org: c.orgES, body });
const valid = (o: Record<string, unknown> = {}) => ({ name: "Allianz weekly", language: "es", insurer_ids: [allianz], to_emails: ["siniestros@allianz.test"], ...o });

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  HALL = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  CARRO = st.find((s) => s.type === "carrosserie").id;
  CARRO2 = (await sup("POST", "/admin/bodyshops", { name: "Taller Dos", country: "ES" })).body.id;
  [allianz, mapfre] = (await c.h.db.insert(insurers).values([{ orgId: c.orgES, name: "Allianz" }, { orgId: c.orgES, name: "Mapfre" }]).returning()).map((i) => i.id);
  chef = await inviteAndAccept(c, c.orgES, "chef@example.test", { role_id: c.roleId.chef_site, station_id: HALL });
  assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: HALL });
  bodyshopAcc = await inviteAndAccept(c, c.orgES, "taller@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
});
afterAll(async () => { await c.h.close(); });

describe("the three rights", () => {
  it("catalogue and defaults: the admin all three, the station manager see + send, everybody else none", () => {
    for (const p of ["rapports.voir", "rapports.envoyer", "rapports.gerer"]) expect(PERMISSIONS).toContain(p);
    expect(KEY("org_admin").permissions).toEqual(expect.arrayContaining(["rapports.voir", "rapports.envoyer", "rapports.gerer"]));
    expect(KEY("chef_site").permissions).toEqual(expect.arrayContaining(["rapports.voir", "rapports.envoyer"]));
    expect(KEY("chef_site").permissions).not.toContain("rapports.gerer");
    for (const k of ["aufnehmer", "technicien", "freelance", "carrosserie", "assureur"]) expect(KEY(k).permissions.filter((p) => p.startsWith("rapports."))).toEqual([]);
  });

  it("the seeded roles of the database carry them", async () => {
    const rows = await c.h.db.select().from(roles).where(eq(roles.isSystem, true));
    const perms = (key: string) => rows.find((r) => r.key === key)!.permissions as string[];
    expect(perms("org_admin")).toEqual(expect.arrayContaining(["rapports.voir", "rapports.envoyer", "rapports.gerer"]));
    expect(perms("chef_site")).toEqual(expect.arrayContaining(["rapports.voir", "rapports.envoyer"]));
    expect(perms("chef_site")).not.toContain("rapports.gerer");
    expect(perms("aufnehmer").some((p) => p.startsWith("rapports."))).toBe(false);
  });

  it("the migration adds them to the default roles once, and only there", async () => {
    const sqlText = readFileSync(new URL("../migrations/0022_v6_insurer_reports.sql", import.meta.url), "utf8");
    const updates = sqlText.split("--> statement-breakpoint").map((x) => x.trim()).filter((x) => /^(--[^\n]*\n)?\s*UPDATE "roles"/.test(x));
    expect(updates).toHaveLength(3);
    await c.h.db.execute(sql`update roles set permissions = array_remove(array_remove(array_remove(permissions, 'rapports.voir'), 'rapports.envoyer'), 'rapports.gerer') where is_system = true`);
    for (let i = 0; i < 2; i++) for (const u of updates) await c.h.db.execute(sql.raw(u.replace(/^--[^\n]*\n/, "")));
    const rows = await c.h.db.select().from(roles).where(eq(roles.isSystem, true));
    const perms = (key: string) => rows.find((r) => r.key === key)!.permissions as string[];
    expect(perms("org_admin").filter((p) => p.startsWith("rapports."))).toEqual(["rapports.voir", "rapports.envoyer", "rapports.gerer"]);
    expect(perms("chef_site").filter((p) => p.startsWith("rapports."))).toEqual(["rapports.voir", "rapports.envoyer"]);
    expect(perms("aufnehmer").some((p) => p.startsWith("rapports."))).toBe(false);
    expect(perms("technicien").some((p) => p.startsWith("rapports."))).toBe(false);
  });

  it("enforced on the server: who may list, who may set up", async () => {
    const list = (token: string) => call(c, "GET", "/admin/insurer-reports", { token, org: c.orgES });
    expect((await list(chef)).status).toBe(200);
    for (const token of [assessor, tech, bodyshopAcc]) expect((await list(token)).status, "list").toBe(403);
    const made = await sup("POST", "/admin/insurer-reports", valid());
    expect(made.status).toBe(201);
    const id = made.body.id as string;
    for (const token of [chef, assessor, tech, bodyshopAcc]) {
      expect((await call(c, "POST", "/admin/insurer-reports", { token, org: c.orgES, body: valid() })).status, "create").toBe(403);
      expect((await call(c, "PUT", `/admin/insurer-reports/${id}`, { token, org: c.orgES, body: { name: "x" } })).status, "change").toBe(403);
      expect((await call(c, "DELETE", `/admin/insurer-reports/${id}`, { token, org: c.orgES })).status, "delete").toBe(403);
    }
    expect((await call(c, "GET", `/admin/insurer-reports/${id}`, { token: chef, org: c.orgES })).status).toBe(200);
    expect((await call(c, "GET", `/admin/insurer-reports/${id}/kpis`, { token: chef, org: c.orgES })).status).toBe(200);
    for (const token of [assessor, tech, bodyshopAcc]) {
      expect((await call(c, "GET", `/admin/insurer-reports/${id}`, { token, org: c.orgES })).status).toBe(403);
      expect((await call(c, "GET", `/admin/insurer-reports/${id}/kpis`, { token, org: c.orgES })).status).toBe(403);
    }
    await sup("DELETE", `/admin/insurer-reports/${id}`);
  });

  it("the internal Bcc is only shown to who sets the reports up", async () => {
    const made = await sup("POST", "/admin/insurer-reports", valid({ name: "With bcc", bcc_emails: ["intern@pdr.test"] }));
    const id = made.body.id as string;
    expect((await sup("GET", `/admin/insurer-reports/${id}`)).body.bcc_emails).toEqual(["intern@pdr.test"]);
    expect((await call(c, "GET", `/admin/insurer-reports/${id}`, { token: chef, org: c.orgES })).body.bcc_emails).toEqual([]);
    const list = (await call(c, "GET", "/admin/insurer-reports", { token: chef, org: c.orgES })).body as any[];
    expect(list.find((x) => x.id === id).bcc_emails).toEqual([]);
    await sup("DELETE", `/admin/insurer-reports/${id}`);
  });
});

describe("set-up", () => {
  it("create with defaults, read, change a part, delete (soft) with an audit entry each time", async () => {
    const made = await sup("POST", "/admin/insurer-reports", valid({ project_start: "2026-09-01", countries: ["ES"], bodyshop_ids: [CARRO], station_ids: [HALL] }));
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: "Allianz weekly", language: "es", active: true, frequency: "week", send_day: 1, window_from: "16:00", window_to: "17:00", timezone: "Europe/Madrid", kpis: ["inspected", "repaired", "backlog", "upcoming", "progress"], annex_vehicles: false, show_amounts: false, project_start: "2026-09-01" });
    const id = made.body.id as string;
    const put = await sup("PUT", `/admin/insurer-reports/${id}`, { frequency: "month", send_day: 3, kpis: ["progress", "inspected", "refused"], subject: "Report {{period}}" });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ frequency: "month", send_day: 3, kpis: ["progress", "inspected", "refused"], subject: "Report {{period}}", name: "Allianz weekly", insurer_ids: [allianz], bodyshop_ids: [CARRO], station_ids: [HALL], to_emails: ["siniestros@allianz.test"] });
    const list = (await sup("GET", "/admin/insurer-reports")).body as any[];
    expect(list.find((x) => x.id === id)).toMatchObject({ name: "Allianz weekly", insurers: ["Allianz"], lastRun: null });
    expect((await sup("DELETE", `/admin/insurer-reports/${id}`)).status).toBe(200);
    expect(((await sup("GET", "/admin/insurer-reports")).body as any[]).some((x) => x.id === id)).toBe(false);
    expect((await sup("GET", `/admin/insurer-reports/${id}`)).status).toBe(404);
    expect((await c.h.db.select().from(auditLog).where(eq(auditLog.entityId, id))).map((a) => a.action).sort()).toEqual(["create", "delete", "update"]);
  });

  it("refused: no insurer, an insurer or place of another kind, bad values", async () => {
    const bad = async (o: Record<string, unknown>, label: string) => expect((await sup("POST", "/admin/insurer-reports", valid(o))).status, label).toBe(400);
    await bad({ insurer_ids: [] }, "no insurer");
    await bad({ insurer_ids: ["2ba80353-e42c-437e-ba20-3c3ee2f9e32a"] }, "unknown insurer");
    await bad({ bodyshop_ids: [HALL] }, "a hall is not a body shop");
    await bad({ station_ids: [CARRO] }, "a body shop is not a place");
    await bad({ countries: ["FR"] }, "country");
    await bad({ window_from: "17:00", window_to: "16:00" }, "window backwards");
    await bad({ window_from: "25:00" }, "time");
    await bad({ frequency: "week", send_day: 8 }, "weekday 8");
    await bad({ frequency: "year" }, "frequency");
    await bad({ timezone: "Mars/Olympus" }, "time zone");
    await bad({ to_emails: [] }, "active without recipient");
    await bad({ to_emails: ["not-an-email"] }, "address");
    await bad({ kpis: [] }, "no figure");
    await bad({ kpis: ["inspected", "money"] }, "unknown figure");
    await bad({ project_start: "2026-13-40" }, "date");
    await bad({ name: "" }, "name");
    expect((await sup("POST", "/admin/insurer-reports", valid({ active: false, to_emails: [] }))).status, "a draft needs no recipient").toBe(201);
  });

  it("an insurer of another organisation cannot be used, and another organisation's report is not found", async () => {
    const [other] = await c.h.db.insert(insurers).values({ orgId: c.orgDE, name: "Other org insurer" }).returning();
    expect((await sup("POST", "/admin/insurer-reports", valid({ insurer_ids: [other.id] }))).status).toBe(400);
    const made = await sup("POST", "/admin/insurer-reports", valid({ name: "ES only" }));
    expect((await call(c, "GET", `/admin/insurer-reports/${made.body.id}`, { token: c.superToken, org: c.orgDE })).status).toBe(404);
    expect((await call(c, "PUT", `/admin/insurer-reports/${made.body.id}`, { token: c.superToken, org: c.orgDE, body: { name: "x" } })).status).toBe(404);
    expect((await call(c, "DELETE", `/admin/insurer-reports/${made.body.id}`, { token: c.superToken, org: c.orgDE })).status).toBe(404);
    await sup("DELETE", `/admin/insurer-reports/${made.body.id}`);
  });

  it("a change that breaks a rule is refused as a whole (an active report loses its recipients, a weekday outside the week)", async () => {
    const made = await sup("POST", "/admin/insurer-reports", valid({ name: "Rules" }));
    const id = made.body.id as string;
    expect((await sup("PUT", `/admin/insurer-reports/${id}`, { to_emails: [] })).status).toBe(400);
    expect((await sup("PUT", `/admin/insurer-reports/${id}`, { send_day: 9 })).status).toBe(400);
    expect((await sup("PUT", `/admin/insurer-reports/${id}`, { frequency: "month", send_day: 9 })).status).toBe(200);
    expect((await sup("PUT", `/admin/insurer-reports/${id}`, { frequency: "week" })).status, "day 9 is no weekday").toBe(400);
    expect((await sup("PUT", `/admin/insurer-reports/${id}`, { active: false, to_emails: [] })).status).toBe(200);
    expect((await sup("GET", `/admin/insurer-reports/${id}`)).body).toMatchObject({ frequency: "month", send_day: 9, active: false, to_emails: [] });
    await sup("DELETE", `/admin/insurer-reports/${id}`);
  });
});

describe("periods", () => {
  it("week: the previous Monday-to-Sunday, whatever the day of today", () => {
    expect(lastCompletePeriod("week", "2026-10-28")).toEqual({ from: "2026-10-19", to: "2026-10-25" }); // Wednesday
    expect(lastCompletePeriod("week", "2026-10-26")).toEqual({ from: "2026-10-19", to: "2026-10-25" }); // Monday
    expect(lastCompletePeriod("week", "2026-11-01")).toEqual({ from: "2026-10-19", to: "2026-10-25" }); // Sunday
    expect(lastCompletePeriod("week", "2026-01-01")).toEqual({ from: "2025-12-22", to: "2025-12-28" }); // across the year
  });
  it("month: the previous calendar month", () => {
    expect(lastCompletePeriod("month", "2026-10-28")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(lastCompletePeriod("month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(lastCompletePeriod("month", "2026-03-01")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(lastCompletePeriod("month", "2028-03-05")).toEqual({ from: "2028-02-01", to: "2028-02-29" }); // leap year
  });
  it("quarter: the previous calendar quarter", () => {
    expect(lastCompletePeriod("quarter", "2026-10-28")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(lastCompletePeriod("quarter", "2026-04-01")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(lastCompletePeriod("quarter", "2026-01-10")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(lastCompletePeriod("quarter", "2026-12-31")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });
});

describe("the figures", () => {
  const NOW = new Date("2026-10-26T14:00:00Z"); // Monday 26 October in Madrid
  const PERIOD = { from: "2026-10-19", to: "2026-10-25" };
  const scope = (o: Record<string, unknown> = {}) => ({ orgId: "", insurerIds: [allianz], bodyshopIds: [] as string[], stationIds: [] as string[], countries: [] as string[], projectStart: "2026-09-01", timezone: "Europe/Madrid", ...o });
  const car: Record<string, string> = {};

  async function mk(label: string, o: { insurer?: string; created: string; statut: string; scan?: string; land?: string; client?: string; station?: string; deleted?: boolean; stage?: string | null; hist?: [string, string][]; booking?: string }) {
    const [v] = await c.h.db.insert(vehicles).values({
      id: crypto.randomUUID(), orgId: c.orgES, stationId: o.station ?? HALL, clientStationId: o.client ?? CARRO, insurerId: o.insurer ?? allianz, statut: o.statut,
      statutDepuis: new Date(o.created), repairStage: o.stage ?? null, header: { land: o.land ?? "ES", kennzeichen: label } as never,
      createdAt: new Date(o.created), updatedAt: new Date(o.created), deletedAt: o.deleted ? new Date(o.created) : null,
      colibriScanKey: o.scan ? `pk-${label}|rk-${label}` : null,
    }).returning();
    car[label] = v.id;
    if (o.scan) await c.h.db.insert(colibriScans).values({ partitionKey: `pk-${label}`, rowKey: `rk-${label}`, scanDateTime: new Date(o.scan), plate: label });
    for (const [st, at] of o.hist ?? []) await c.h.db.insert(vehicleStatusHistory).values({ vehicleId: v.id, statut: st, at: new Date(at) });
    if (o.booking) await c.h.db.insert(repairBookings).values({ id: crypto.randomUUID(), orgId: c.orgES, stationId: HALL, vehicleId: v.id, date: o.booking, status: "booked", time: "09:00", customerPhone: "600", customerEmail: "a@b.test" });
    return v.id;
  }
  const names = (ids: string[]) => ids.map((id) => Object.entries(car).find(([, v]) => v === id)![0]).sort();

  beforeAll(async () => {
    await mk("c1-in-repair", { created: "2026-10-10T08:00:00Z", scan: "2026-10-20T09:00:00Z", statut: "reparatur", stage: "pdr" });
    await mk("c2-finished", { created: "2026-10-21T09:00:00Z", statut: "fertig", hist: [["fertig", "2026-10-23T10:00:00Z"]] });
    await mk("c3-older-finished-now", { created: "2026-10-01T08:00:00Z", scan: "2026-10-05T09:00:00Z", statut: "fertig", hist: [["fertig", "2026-10-22T10:00:00Z"]] });
    await mk("c4-before-project", { created: "2026-08-15T08:00:00Z", statut: "fertig", hist: [["fertig", "2026-10-21T10:00:00Z"]] });
    await mk("c5-backlog", { created: "2026-10-22T09:00:00Z", statut: "besichtigung" });
    await mk("c6-waiting-booked", { created: "2026-10-22T09:00:00Z", statut: "attente", booking: "2026-11-03" });
    await mk("c7-refused", { created: "2026-10-22T09:00:00Z", statut: "refuse", hist: [["refuse", "2026-10-24T10:00:00Z"]] });
    await mk("c8-other-insurer", { insurer: mapfre, created: "2026-10-22T09:00:00Z", statut: "besichtigung" });
    await mk("c9-deleted", { created: "2026-10-22T09:00:00Z", statut: "besichtigung", deleted: true });
    await mk("c10-just-arrived", { created: "2026-10-23T09:00:00Z", statut: "arrive" });
    await mk("c11-returned-earlier", { created: "2026-10-01T09:00:00Z", statut: "rendu", hist: [["fertig", "2026-10-12T10:00:00Z"], ["rendu", "2026-10-13T10:00:00Z"]] });
    // scanned on the evening of the 18th UTC = 00:30 on the 19th in Madrid: it belongs to the week of the 19th
    await mk("c12-scanned-after-midnight", { created: "2026-10-10T08:00:00Z", scan: "2026-10-18T22:30:00Z", statut: "reparatur", stage: "bereit" });
    await mk("c13-past-booking", { created: "2026-10-22T09:00:00Z", statut: "besichtigung", booking: "2026-10-20" });
  });

  it("inspected, repaired, refused, backlog, upcoming and progress, by the validated definitions", async () => {
    const k = await computeInsurerKpis(c.h.db, scope({ orgId: c.orgES }), PERIOD, NOW);
    expect(k.asOf).toBe("2026-10-26");
    expect(names(k.ids.inspectedPeriod)).toEqual(["c1-in-repair", "c10-just-arrived", "c12-scanned-after-midnight", "c13-past-booking", "c2-finished", "c5-backlog", "c6-waiting-booked", "c7-refused"]);
    expect(names(k.ids.inspectedTotal)).toEqual([...names(k.ids.inspectedPeriod), "c11-returned-earlier", "c3-older-finished-now"].sort());
    expect(k.inspected).toEqual({ period: 8, total: 10 });
    expect(names(k.ids.repairedPeriod)).toEqual(["c2-finished", "c3-older-finished-now"]);
    expect(names(k.ids.repairedTotal)).toEqual(["c11-returned-earlier", "c2-finished", "c3-older-finished-now"]);
    expect(k.repaired).toEqual({ period: 2, total: 3 });
    expect(k.refused).toEqual({ period: 1, total: 1 });
    expect(names(k.ids.backlog)).toEqual(["c5-backlog"]); // the booked one, the one in repair, the just arrived, the refused one are not
    expect(k.backlog).toBe(1);
    expect(names(k.ids.upcoming)).toEqual(["c6-waiting-booked"]); // a booking of the 20th is behind us
    expect(k.upcoming).toBe(1);
    expect(k.progress).toBe(30); // 3 repaired / 10 inspected
    // never: before the project start, another insurer, deleted
    const every = new Set(Object.values(k.ids).flat());
    for (const x of ["c4-before-project", "c8-other-insurer", "c9-deleted"]) expect(every.has(car[x]), x).toBe(false);
  });

  it("the cumulative figures stop at the end of the period, the project start cuts the beginning", async () => {
    const earlier = await computeInsurerKpis(c.h.db, scope({ orgId: c.orgES }), { from: "2026-10-05", to: "2026-10-11" }, NOW);
    expect(names(earlier.ids.inspectedPeriod)).toEqual(["c3-older-finished-now"]);
    expect(earlier.inspected).toEqual({ period: 1, total: 2 }); // c11 (1 Oct) before it, nothing after
    expect(earlier.repaired).toEqual({ period: 0, total: 0 });
    const noStart = await computeInsurerKpis(c.h.db, scope({ orgId: c.orgES, projectStart: null }), PERIOD, NOW);
    expect(noStart.inspected.total).toBe(11); // c4 (August) joins
    expect(noStart.repaired.total).toBe(4);
    const later = await computeInsurerKpis(c.h.db, scope({ orgId: c.orgES, projectStart: "2026-10-20" }), PERIOD, NOW);
    expect(later.inspected.total).toBe(7); // c1 (20 Oct) up to c13; c3, c11 and c12 (19 Oct) are before the start
  });

  it("no inspected car: no percentage", async () => {
    const k = await computeInsurerKpis(c.h.db, scope({ orgId: c.orgES, insurerIds: [] }), PERIOD, NOW);
    expect(k).toMatchObject({ inspected: { period: 0, total: 0 }, progress: null, backlog: 0, upcoming: 0 });
  });

  it("narrowed by body shop, by place and by country", async () => {
    const other = await mk("c14-other-bodyshop", { created: "2026-10-22T09:00:00Z", statut: "besichtigung", client: CARRO2 });
    const german = await mk("c15-german", { created: "2026-10-22T09:00:00Z", statut: "besichtigung", land: "DE" });
    const base = await computeInsurerKpis(c.h.db, scope({ orgId: c.orgES }), PERIOD, NOW);
    expect(base.ids.inspectedPeriod).toEqual(expect.arrayContaining([other, german]));
    const shop = await computeInsurerKpis(c.h.db, scope({ orgId: c.orgES, bodyshopIds: [CARRO2] }), PERIOD, NOW);
    expect(names(shop.ids.inspectedPeriod)).toEqual(["c14-other-bodyshop"]);
    const spain = await computeInsurerKpis(c.h.db, scope({ orgId: c.orgES, countries: ["ES"] }), PERIOD, NOW);
    expect(spain.ids.inspectedPeriod).not.toContain(german);
    expect(spain.ids.inspectedPeriod).toContain(other);
    const de = await computeInsurerKpis(c.h.db, scope({ orgId: c.orgES, countries: ["DE"] }), PERIOD, NOW);
    expect(names(de.ids.inspectedPeriod)).toEqual(["c15-german"]);
    const place = await computeInsurerKpis(c.h.db, scope({ orgId: c.orgES, stationIds: [CARRO] }), PERIOD, NOW);
    expect(place.inspected.total).toBe(0); // no car stands in that place
    const here = await computeInsurerKpis(c.h.db, scope({ orgId: c.orgES, stationIds: [HALL] }), PERIOD, NOW);
    expect(here.inspected.total).toBe(base.inspected.total);
    await c.h.db.delete(vehicles).where(eq(vehicles.id, other)); await c.h.db.delete(vehicles).where(eq(vehicles.id, german));
  });

  it("the route gives the figures of the last complete period; the cars behind them only on request", async () => {
    const made = await sup("POST", "/admin/insurer-reports", valid({ name: "Figures", project_start: "2026-09-01" }));
    const id = made.body.id as string;
    const k = await sup("GET", `/admin/insurer-reports/${id}/kpis`);
    expect(k.status).toBe(200);
    expect(k.body).toMatchObject({ period: lastCompletePeriod("week", k.body.asOf), projectStart: "2026-09-01" });
    expect(k.body).not.toHaveProperty("ids");
    expect(Object.keys(k.body)).toEqual(expect.arrayContaining(["inspected", "repaired", "refused", "backlog", "upcoming", "progress"]));
    const given = await sup("GET", `/admin/insurer-reports/${id}/kpis?from=2026-10-19&to=2026-10-25&ids=1`);
    expect(given.body.period).toEqual(PERIOD);
    expect(given.body.inspected.period).toBe(8);
    expect(given.body.ids.inspectedPeriod).toHaveLength(8);
    expect((await sup("GET", `/admin/insurer-reports/${id}/kpis?from=2026-10-25&to=2026-10-19`)).status).toBe(400);
    expect((await sup("GET", `/admin/insurer-reports/${id}/kpis?from=nonsense&to=2026-10-19`)).status).toBe(400);
    await sup("DELETE", `/admin/insurer-reports/${id}`);
  });
});
