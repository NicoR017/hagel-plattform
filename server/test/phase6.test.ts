import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, vehicleAssignments, vehicles, users } from "../src/schema";
import { call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx;
let A: string, B: string, MINI: string;
let chefA: string, chefB: string, tech: string, techId: string, assessor: string;

const mk = (id: string, o: Record<string, unknown> = {}, h: Record<string, unknown> = {}) =>
  op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: A, header: { land: "ES", kennzeichen: "P-" + id.slice(0, 4), leistungsdatum: "2026-10-19", stundensatz: 69, ...h }, panels: { haube: dentsPanel("haube", { "20": 10, "40": 2 }) }, shares: { techName: "Ana", techPct: 50 }, ...o } });
const dash = (token: string, q = "") => call(c, "GET", `/dashboard${q}`, { token, org: c.orgES });
const status = (token: string, id: string, statut: string, motif?: string) => push(c, token, [op("vehicle.status", { vehicleId: id, statut, ...(motif ? { motif } : {}) })]);

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "carrosserie").id; B = st.find((s) => s.type === "hall").id;
  await call(c, "PUT", `/admin/orgs/${c.orgES}/tenants`, { token: c.superToken, body: { tenants: ["T1", "T2"] } });
  await call(c, "PUT", `/admin/stations/${A}`, { token: c.superToken, org: c.orgES, body: { azure_tenant: "T1", capacite: 10 } });
  await call(c, "PUT", `/admin/stations/${B}`, { token: c.superToken, org: c.orgES, body: { azure_tenant: "T2", capacite: 10 } });
  MINI = (await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "hall", name: "Mini", capacite: 1, azure_tenant: "T1" } })).body.id;
  chefA = await inviteAndAccept(c, c.orgES, "chefa@example.test", { role_id: c.roleId.chef_site, station_id: A });
  chefB = await inviteAndAccept(c, c.orgES, "chefb@example.test", { role_id: c.roleId.chef_site, station_id: B });
  assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: A });
  techId = (await c.h.db.select().from(users).where(eq(users.email, "tech@example.test")))[0].id;
});
afterAll(async () => { await c.h.close(); });

const ids: Record<string, string> = {};
describe("occupancy", () => {
  it("present = every status but 'rendu'; the pull carries it for the visible sites", async () => {
    for (const k of ["a", "b", "c", "d"]) ids[k] = uuid();
    expect((await push(c, assessor, [mk(ids.a), mk(ids.b), mk(ids.c), mk(ids.d)])).body.results.every((r: any) => r.status === "ok")).toBe(true);
    await status(assessor, ids.b, "reparatur"); await status(assessor, ids.c, "attente", "Teile"); await status(assessor, ids.d, "rendu");
    const p = await pull(c, assessor, c.orgES);
    expect(p.refs.occupancy[A]).toBe(3);
    expect(p.refs.occupancy[B]).toBe(0);
    expect(p.refs.stations.find((s: any) => s.id === A).azureTenant).toBe("T1");
    // leaving 'on hold' can return to the status before: the client gets it
    expect(p.vehicles.find((v: any) => v.id === ids.c)).toMatchObject({ statut: "attente", statutAvant: "arrive" });
    const adm = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
    expect(adm.find((s) => s.id === A)).toMatchObject({ present: 3, capacite: 10 });
  });
  it("a site the user may not see is not in the occupancy", async () => {
    const p = await pull(c, tech, c.orgES);
    expect(Object.keys(p.refs.occupancy)).not.toContain(MINI);
  });
});

describe("moves", () => {
  it("into a full site: warning, not a block (audited); into another tenant: warning", async () => {
    const r1 = await push(c, c.superToken, [op("vehicle.move", { vehicleId: ids.a, toStationId: MINI })]);
    expect(r1.body.results[0]).toMatchObject({ status: "ok" });
    expect(r1.body.results[0].warnings ?? []).toEqual([]); // MINI was empty
    const r2 = await push(c, c.superToken, [op("vehicle.move", { vehicleId: ids.b, toStationId: MINI })]);
    expect(r2.body.results[0].status).toBe("ok");
    expect(r2.body.results[0].warnings).toEqual(["capacity_full"]);
    const r3 = await push(c, c.superToken, [op("vehicle.move", { vehicleId: ids.b, toStationId: B })]); // T1 -> T2
    expect(r3.body.results[0].warnings).toEqual(["tenant_differs"]);
    const log = (await c.h.db.select().from(auditLog)).filter((x) => x.action === "vehicle.move" || (x.entity === "vehicle" && JSON.stringify(x.after).includes("warnings")));
    expect(log.some((x) => JSON.stringify(x.after).includes("capacity_full"))).toBe(true);
    expect(log.some((x) => JSON.stringify(x.after).includes("tenant_differs"))).toBe(true);
  });
  it("the customer does not change with a move, and the occupancy follows", async () => {
    const [v] = await c.h.db.select().from(vehicles).where(eq(vehicles.id, ids.b));
    expect(v.stationId).toBe(B); expect(v.clientStationId).toBe(A);
    const p = await pull(c, assessor, c.orgES);
    expect(p.refs.occupancy[B]).toBe(1); expect(p.refs.occupancy[MINI]).toBe(1); expect(p.refs.occupancy[A]).toBe(1);
  });
});

describe("dashboard", () => {
  it("needs dashboard.voir; technicians and carrosserie accounts have none", async () => {
    expect((await dash(tech)).status).toBe(403);
    expect((await dash(chefA)).status).toBe(200);
  });

  it("site cards: occupancy, status counts, arrivals / departures today (moves included)", async () => {
    const d = (await dash(c.superToken)).body;
    const s = (id: string) => d.sites.find((x: any) => x.id === id);
    expect(s(A)).toMatchObject({ capacity: 10, present: 1 });
    expect(s(MINI)).toMatchObject({ capacity: 1, present: 1 });
    expect(s(B).present).toBe(1);
    // vehicles were created today at A; two of them left by a move; one arrived at B and one at MINI
    expect(s(A).arrivalsToday.n).toBe(4); expect(s(A).departuresToday.n).toBe(3); // a, b (moved) and d (rendu today)
    expect(s(MINI).arrivalsToday.n).toBe(2); expect(s(MINI).departuresToday.n).toBe(1); expect(s(B).arrivalsToday.n).toBe(1); // MINI: a and b came, b left again
    expect(s(A).byStatus.rendu.n + s(B).byStatus.reparatur.n).toBeGreaterThan(0);
    expect(s(A).presentIds.length).toBe(1);
  });

  it("scope: a chef of site B sees only the vehicles of B; filters narrow the data", async () => {
    const b = (await dash(chefB)).body;
    expect(b.vehicles).toBe(1);
    expect(b.sites.map((x: any) => x.id)).toContain(B);
    const all = (await dash(c.superToken)).body;
    expect(all.vehicles).toBe(4);
    expect((await dash(c.superToken, `?sites=${B}`)).body.vehicles).toBe(1);
    expect((await dash(c.superToken, `?client=${A}&sites=${A}`)).body.vehicles).toBe(2); // c (attente) and d (rendu)
    expect((await dash(c.superToken, `?insurer=${uuid()}`)).body.vehicles).toBe(0);
  });

  it("delays by status threshold and 'Wartet' grouped by reason", async () => {
    await c.h.db.update(vehicles).set({ statutDepuis: new Date(Date.now() - 10 * 86_400_000) }).where(eq(vehicles.id, ids.c));
    const put = await call(c, "PUT", "/admin/settings", { token: c.superToken, org: c.orgES, body: { delayDays: { attente: 3, reparatur: 5 } } });
    expect(put.status).toBe(200);
    expect((await call(c, "PUT", "/admin/settings", { token: chefA, org: c.orgES, body: { delayDays: { attente: 1 } } })).status).toBe(403);
    const d = (await dash(c.superToken)).body;
    expect(d.delayed.map((x: any) => x.id)).toEqual([ids.c]);
    expect(d.delayed[0]).toMatchObject({ statut: "attente", motif: "Teile", days: 10, thresholdDays: 3 });
    expect(d.hold).toEqual([{ reason: "Teile", n: 1, ids: [ids.c] }]);
    // b has just entered 'reparatur': not delayed yet
    expect(d.delayed.some((x: any) => x.id === ids.b)).toBe(false);
  });

  it("durations from the status history", async () => {
    const d = (await dash(c.superToken)).body;
    expect(d.durations.returnedSamples).toBe(1); // d was returned
    expect(d.durations.avgArrivalToReturnedDays).toBeGreaterThanOrEqual(0);
  });

  it("technicians: assigned / in progress / finished; flagged when the technician has no role on the vehicle's site", async () => {
    await push(c, assessor, [op("vehicle.assign", { vehicleId: ids.b, userIds: [techId], kind: "pdr" })]);
    const rows = await c.h.db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, ids.b));
    expect(rows.length).toBe(1);
    const t = (await dash(c.superToken)).body.technicians.find((x: any) => x.key === techId);
    expect(t.name).toBe("tech");
    expect(t.assigned.ids).toEqual([ids.b]); expect(t.inProgress.ids).toEqual([ids.b]);
    // the technician only has a role on site A, the car is on B now
    expect(t.noRoleOnSite.ids).toEqual([ids.b]);
    expect(t.sites.map((x: any) => x.id)).toEqual([B]);
  });

  it("revenue: only with prix.voir; the internal split only with repartition_interne.voir", async () => {
    const sup = (await dash(c.superToken)).body.revenue;
    expect(sup.total).toBeGreaterThan(0);
    expect(sup.n).toBe(4);
    expect(sup.bySite.reduce((a: number, x: any) => a + x.net, 0)).toBeCloseTo(sup.total, 1);
    expect(sup.byClient[0].name).not.toBe("—");
    expect(sup.byMonth).toHaveLength(1);
    expect(sup.byMonth[0].month).toBe("2026-10");
    expect(sup.split).toMatchObject({ n: 4 });
    expect(sup.split.technicians + sup.split.commissions + sup.split.rest).toBeCloseTo(sup.total, 1);
    // a role with dashboard.voir but without prices
    const noPrice = await call(c, "POST", "/admin/roles", { token: c.superToken, org: c.orgES, body: { name: "Dash only", scope: "station", permissions: ["vehicules.voir", "dashboard.voir"] } });
    expect(noPrice.status).toBe(201);
    const tok = await inviteAndAccept(c, c.orgES, "dashonly@example.test", { role_id: noPrice.body.id });
    const d = (await dash(tok)).body;
    expect(d.vehicles).toBe(4);
    expect(d.revenue).toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/"net"/);
  });

  it("period filter limits the revenue and the finished counts", async () => {
    expect((await dash(c.superToken, "?from=2027-01-01")).body.revenue.n).toBe(0);
    expect((await dash(c.superToken, "?from=2026-10-01&to=2026-10-31")).body.revenue.n).toBe(4);
  });
});

describe("weekly technician sheets (pay per technician)", () => {
  const today = new Date().toISOString().slice(0, 10);
  const sheets = (token: string, q = "") => call(c, "GET", `/dashboard/technician-sheets${q}`, { token, org: c.orgES });

  it("cars that became 'fertig' in the period are listed per technician with the technician's share", async () => {
    expect((await status(assessor, ids.b, "fertig")).body.results[0].status).toBe("ok");
    const r = (await sheets(c.superToken, `?from=${today}&to=${today}`)).body;
    expect(r.sheets.map((s: any) => s.technician)).toContain("Ana");
    const ana = r.sheets.find((s: any) => s.technician === "Ana");
    const v = ana.vehicles.find((x: any) => x.id === ids.b);
    expect(v).toMatchObject({ end: today, plate: expect.stringMatching(/^P-/) });
    expect(v.start).toBe(today); // it went through 'reparatur' today
    expect(v.pdrEur).toBeGreaterThan(0);
    expect(v.eur).toBeCloseTo(v.pdrEur + v.demEur, 2);
    expect(ana.totals.n).toBe(ana.vehicles.length);
    expect(ana.totals.eur).toBeCloseTo(ana.vehicles.reduce((a: number, x: any) => a + x.eur, 0), 2);
  });

  it("the period decides: other weeks give nothing", async () => {
    expect((await sheets(c.superToken, "?from=2020-01-01&to=2020-01-07")).body.sheets).toEqual([]);
    expect((await sheets(c.superToken, `?from=${today}`)).body.sheets.length).toBeGreaterThan(0);
  });

  it("filters by site; rights: no internal split = nothing, no dashboard right = 403", async () => {
    expect((await sheets(c.superToken, `?from=${today}&to=${today}&sites=${A}`)).body.sheets.some((s: any) => s.vehicles.some((x: any) => x.id === ids.b))).toBe(false); // it is on site B
    expect((await sheets(c.superToken, `?from=${today}&to=${today}&sites=${B}`)).body.sheets.some((s: any) => s.vehicles.some((x: any) => x.id === ids.b))).toBe(true);
    const role = (await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgES })).body.find((x: any) => x.name === "Dash only");
    const tok = await inviteAndAccept(c, c.orgES, "dashonly2@example.test", { role_id: role.id });
    expect((await sheets(tok)).body.sheets).toEqual([]); // sees the dashboard, but not what technicians are paid
    expect((await sheets(tech)).status).toBe(403);
    // a chef of site A has the split, but only for his own site: the car on B is not in his sheet
    const a = (await sheets(chefA, `?from=${today}&to=${today}`)).body.sheets;
    expect(a.some((s: any) => s.vehicles.some((x: any) => x.id === ids.b))).toBe(false);
  });

  it("the dashboard answers with the headline numbers (kpis) used by the tiles", async () => {
    const k = (await dash(c.superToken, `?from=${today}&to=${today}`)).body.kpis;
    expect(k.finished.ids).toContain(ids.b);
    expect(k.present.n).toBeGreaterThan(0);
    expect(k.fullSites.every((s: any) => s.present >= s.capacity)).toBe(true);
    expect(k.delayed.ids).toEqual([ids.c]);
  });
});
