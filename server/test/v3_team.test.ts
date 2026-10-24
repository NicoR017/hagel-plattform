// The technician is chosen in the repair overview: a name in the split is enough for "Finish" (a technician without an account cannot be assigned).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, dentsPanel, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, CARRO: string, vid: string;
const blockers = async () => (await pull(c, c.superToken, c.orgES)).vehicles.find((v: any) => v.id === vid).repair.finishBlockers as string[];
const one = async (o: unknown) => ((await push(c, c.superToken, [o])).body.results as { status: string }[])[0].status;

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string; name: string }[];
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A")!.id; CARRO = st.find((s) => s.type === "carrosserie")!.id;
  vid = uuid();
  expect(await one(op("vehicle.create", { vehicle: { id: vid, stationId: A, clientStationId: CARRO, statut: "besichtigung", panels: { haube: dentsPanel("haube", { "20": 8 }) }, header: { land: "ES", kennzeichen: "TM 1", modell: "Seat", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69 } } }))).toBe("ok");
  expect(await one(op("vehicle.repairStage", { vehicleId: vid, stage: "bereit" }))).toBe("ok");
});
afterAll(async () => { await c.h.close(); });

describe("technician of a repair", () => {
  it("nobody chosen: Finish needs a technician", async () => {
    expect(await blockers()).toContain("no_technician");
  });
  it("a technician named in the split (own share edited away from the default) is enough", async () => {
    expect(await one(op("vehicle.shares", { vehicleId: vid, fields: { techName: "Externer Techniker", techPct: 62 } }))).toBe("ok");
    expect(await blockers()).not.toContain("no_technician");
    const v = (await pull(c, c.superToken, c.orgES)).vehicles.find((x: any) => x.id === vid);
    expect(v.techPct).toBe(62);
  });
  it("clearing the name brings the blocker back", async () => {
    expect(await one(op("vehicle.shares", { vehicleId: vid, fields: { techName: "" } }))).toBe("ok");
    expect(await blockers()).toContain("no_technician");
  });
});
