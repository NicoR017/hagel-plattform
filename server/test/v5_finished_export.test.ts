// v5: export of the finished / returned cars (dashboard): price and split, filter by station and period, rights.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { vehicles } from "../src/schema";
import { berlinDate } from "../src/dashboard";
import { call, dentsPanel, inviteAndAccept, op, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx;
let A: string, B: string, CARRO: string;
let assessor: string;
let finishedA: string, returnedB: string, openA: string;

const ok = async (token: string, ops: unknown[]) => { const r = await push(c, token, ops); expect(r.status).toBe(200); return r.body.results as { status: string }[]; };
async function car(station: string, plate: string, statut: string) {
  const id = uuid();
  await ok(assessor, [op("vehicle.create", { vehicle: { id, stationId: station, clientStationId: CARRO, header: { land: "ES", kennzeichen: plate, modell: "Seat Leon", leistungsdatum: "2026-10-19", stundensatz: 69, demontage: true, demontageEur: 100 },
    panels: { haube: dentsPanel("haube", { "20": 12 }) }, shares: { techName: "Pdr Tech", techPct: 50, demTechName: "Head Liner", demTechPct: 80 }, statut: "besichtigung" } })]);
  await c.h.db.update(vehicles).set({ statut }).where(eq(vehicles.id, id));
  return id;
}
const exp = (token: string, qs = "") => call(c, "GET", `/dashboard/finished-export${qs}`, { token, org: c.orgES });

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  B = st.find((s) => s.type === "hall" && s.name === "Nave PDR Madrid").id;
  CARRO = st.find((s) => s.type === "carrosserie").id;
  assessor = await inviteAndAccept(c, c.orgES, "exp-assessor@example.test", { role_id: c.roleId.aufnehmer });
  finishedA = await car(A, "FIN 1", "fertig");
  returnedB = await car(B, "RET 2", "rendu");
  openA = await car(A, "OPN 3", "reparatur");
});
afterAll(async () => { await c.h.close(); });

describe("finished export", () => {
  it("lists the finished and returned cars only, with the price and its split", async () => {
    const r = await exp(c.superToken);
    expect(r.status).toBe(200);
    const rows = r.body.rows as any[];
    expect(rows.map((x) => x.plate).sort()).toEqual(["FIN 1", "RET 2"]);
    expect(rows.some((x) => x.id === openA)).toBe(false);
    const x = rows.find((y) => y.id === finishedA);
    expect(x).toMatchObject({ model: "Seat Leon", station: "Nave Test A" });
    expect(x.total).toBeGreaterThan(0);
    // the PDR repair price of the assessment is a part of the agreed price; the technician's and headliner's shares are no longer exported
    expect(x.repair).toBeGreaterThan(0);
    expect(x.repair).toBeLessThanOrEqual(x.total + 0.01);
    expect(x.technician).toBeUndefined();
    expect(x.headliner).toBeUndefined();
    expect(x.referrer).toBeGreaterThanOrEqual(0);
    expect(typeof x.bodyshop).toBe("string");
  });
  it("one station at a time", async () => {
    const r = await exp(c.superToken, `?sites=${A}`);
    expect((r.body.rows as any[]).map((x) => x.plate)).toEqual(["FIN 1"]);
    const r2 = await exp(c.superToken, `?sites=${B}`);
    expect((r2.body.rows as any[]).map((x) => x.plate)).toEqual(["RET 2"]);
  });
  it("by period: the day it became finished", async () => {
    const today = berlinDate(new Date());
    expect((await exp(c.superToken, `?from=${today}&to=${today}`)).body.rows).toHaveLength(2);
    expect((await exp(c.superToken, "?from=2099-01-01")).body.rows).toHaveLength(0);
    expect((await exp(c.superToken, "?to=2000-01-01")).body.rows).toHaveLength(0);
  });
  it("needs the dashboard right; without prices, the split or the Excel export right, no row comes back", async () => {
    const tech = await inviteAndAccept(c, c.orgES, "exp-tech@example.test", { role_id: c.roleId.technicien, station_id: A });
    expect((await exp(tech)).status).toBe(403);
    const base = ((await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgES })).body as any[]).find((r) => r.id === c.roleId.chef_site);
    const perms = (drop: string[]) => base.permissions.filter((p: string) => !drop.includes(p)).concat(["dashboard.voir", "vehicules.voir", "prix.voir", "repartition_interne.voir", "export.excel"].filter((p) => !drop.includes(p) && !base.permissions.includes(p)));
    const who = async (name: string, drop: string[]) => {
      const r = await call(c, "POST", "/admin/roles", { token: c.superToken, org: c.orgES, body: { name, scope: "station", permissions: perms(drop) } });
      expect(r.status).toBe(201);
      return inviteAndAccept(c, c.orgES, `${name.replace(/\s/g, "").toLowerCase()}@example.test`, { role_id: r.body.id });
    };
    const full = await who("Exp all", []);
    expect(((await exp(full)).body.rows as any[]).length).toBe(2);
    for (const [name, drop] of [["Exp noexcel", ["export.excel"]], ["Exp noprice", ["prix.voir"]], ["Exp nosplit", ["repartition_interne.voir"]]] as const) {
      const tok = await who(name, [...drop]);
      const r = await exp(tok);
      expect(r.status, name).toBe(200);
      expect(r.body.rows, name).toEqual([]);
    }
  });
});
