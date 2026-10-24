import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, dentsPanel, inviteAndAccept, op, push, setup, uuid, type Ctx } from "./helpers";

// v5 2.3: "Body shops x insurers" table of the dashboard (computed on the server, same scope rules, net only with prix.voir)
let c: Ctx;
let A: string, B: string, SHOP1: string, SHOP2: string, INS1: string, INS2: string;
let chefA: string, assessor: string;
const ids: Record<string, string> = {};

const mk = (id: string, client: string | null, insurer: string | null, station = A, date = "2026-10-19") =>
  op("vehicle.create", { vehicle: { id, stationId: station, clientStationId: client, insurerId: insurer, header: { land: "ES", kennzeichen: "L-" + id.slice(0, 4), leistungsdatum: date, stundensatz: 69 }, panels: { haube: dentsPanel("haube", { "20": 10 }) }, shares: {} } });
const status = (token: string, id: string, statut: string) => push(c, token, [op("vehicle.status", { vehicleId: id, statut })]);
const dash = (token: string, q = "") => call(c, "GET", `/dashboard${q}`, { token, org: c.orgES });

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  B = st.find((s) => s.type === "hall" && s.id !== A).id;
  SHOP1 = st.find((s) => s.type === "carrosserie").id;
  SHOP2 = (await call(c, "POST", "/admin/bodyshops", { token: c.superToken, org: c.orgES, body: { name: "Taller Dos" } })).body.id;
  INS1 = (await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Aseguradora Uno" } })).body.id;
  INS2 = (await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Aseguradora Dos" } })).body.id;
  chefA = await inviteAndAccept(c, c.orgES, "chefa@example.test", { role_id: c.roleId.chef_site, station_id: A });
  assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  for (const k of ["a1", "a2", "a3", "b1", "n1", "n2", "x1"]) ids[k] = uuid();
  const r = await push(c, c.superToken, [
    mk(ids.a1, SHOP1, INS1), mk(ids.a2, SHOP1, INS1), mk(ids.a3, SHOP1, INS2), mk(ids.b1, SHOP2, INS1),
    mk(ids.n1, null, INS2), mk(ids.n2, SHOP2, null), mk(ids.x1, SHOP1, INS1, B, "2026-09-01"),
  ]);
  expect(r.body.results.every((x: any) => x.status === "ok")).toBe(true);
  await status(c.superToken, ids.a2, "reparatur");
  await status(c.superToken, ids.a3, "fertig");
  await status(c.superToken, ids.b1, "attente");
  await status(c.superToken, ids.n1, "rendu");
});
afterAll(async () => { await c.h.close(); });

const link = (t: any, client: string | null, insurer: string | null) => t.byLink.find((r: any) => r.clientId === client && r.insurerId === insurer);

describe("Body shops x insurers", () => {
  it("one row per (body shop, insurer) pair of the period, with the counts per stage and clickable ids", async () => {
    const t = (await dash(c.superToken, "?from=2026-10-01&to=2026-10-31")).body.linkTable;
    expect(t.byLink).toHaveLength(5); // x1 (September) is out of the period
    const a = link(t, SHOP1, INS1);
    expect(a).toMatchObject({ clientName: expect.any(String), insurerName: "Aseguradora Uno" });
    expect(a.vehicles.n).toBe(2); expect(a.vehicles.ids.sort()).toEqual([ids.a1, ids.a2].sort());
    expect(a.waiting.ids).toEqual([ids.a1]); expect(a.repair.ids).toEqual([ids.a2]); expect(a.finished.n).toBe(0);
    expect(link(t, SHOP1, INS2).finished.ids).toEqual([ids.a3]);
    expect(link(t, SHOP2, INS1).waiting.ids).toEqual([ids.b1]); // on hold counts with the assessment
  });

  it("vehicles without body shop or insurer are grouped under null ids (the screen labels them)", async () => {
    const t = (await dash(c.superToken, "?from=2026-10-01&to=2026-10-31")).body.linkTable;
    const noShop = link(t, null, INS2), noIns = link(t, SHOP2, null);
    expect(noShop).toMatchObject({ clientName: "", vehicles: { n: 1, ids: [ids.n1] } });
    expect(noIns).toMatchObject({ insurerName: "", vehicles: { n: 1, ids: [ids.n2] } });
  });

  it("the switch: by body shop and by insurer add up the same vehicles", async () => {
    const t = (await dash(c.superToken, "?from=2026-10-01&to=2026-10-31")).body.linkTable;
    const sum = (rows: any[]) => rows.reduce((n, r) => n + r.vehicles.n, 0);
    expect(sum(t.byLink)).toBe(6); expect(sum(t.byClient)).toBe(6); expect(sum(t.byInsurer)).toBe(6);
    expect(t.byClient.find((r: any) => r.clientId === SHOP1).vehicles.n).toBe(3);
    expect(t.byInsurer.find((r: any) => r.insurerId === INS1).vehicles.n).toBe(3);
    expect(t.byClient.every((r: any) => r.insurerId === null)).toBe(true);
  });

  it("average days arrival -> returned only from returned cars; null without any", async () => {
    const t = (await dash(c.superToken, "?from=2026-10-01&to=2026-10-31")).body.linkTable;
    expect(link(t, null, INS2).avgDays).toBeGreaterThanOrEqual(0); // n1 was returned
    expect(link(t, SHOP1, INS1).avgDays).toBeNull();
  });

  it("net: present with prix.voir and equal to the revenue; the key does not exist without it", async () => {
    const d = (await dash(c.superToken, "?from=2026-10-01&to=2026-10-31")).body;
    const net = d.linkTable.byLink.reduce((n: number, r: any) => n + r.net, 0);
    expect(net).toBeCloseTo(d.revenue.total, 1);
    const role = await call(c, "POST", "/admin/roles", { token: c.superToken, org: c.orgES, body: { name: "Dash only 2", scope: "station", permissions: ["vehicules.voir", "dashboard.voir"] } });
    const tok = await inviteAndAccept(c, c.orgES, "dashonly2@example.test", { role_id: role.body.id });
    const r = await dash(tok, "?from=2026-10-01&to=2026-10-31");
    expect(r.status).toBe(200);
    expect(r.body.linkTable.byLink.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.body.linkTable)).not.toMatch(/net/i);
  });

  it("same scope rules as the rest of the dashboard: a chef sees his station only, the filters narrow it, no permission = 403", async () => {
    const t = (await dash(chefA)).body.linkTable;
    expect(t.byLink.flatMap((r: any) => r.vehicles.ids)).not.toContain(ids.x1); // x1 stands at B
    const all = (await dash(c.superToken)).body.linkTable;
    expect(all.byLink.flatMap((r: any) => r.vehicles.ids)).toContain(ids.x1);
    const f = (await dash(c.superToken, `?client=${SHOP2}`)).body.linkTable;
    expect(f.byLink.every((r: any) => r.clientId === SHOP2)).toBe(true);
    expect((await dash((await inviteAndAccept(c, c.orgES, "tech5@example.test", { role_id: c.roleId.technicien, station_id: A })))).status).toBe(403);
    expect((await call(c, "GET", "/dashboard", { token: assessor, org: c.orgES })).status).toBe(200);
  });
});
