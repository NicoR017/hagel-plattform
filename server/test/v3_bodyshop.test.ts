// "At Bodyshop": the car is assigned to a body shop (carrosserie site) of the tenant.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { repairEvents, stations } from "../src/schema";
import { call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, B: string, OTHER_TENANT: string, HALL: string, chef: string, aufnehmer: string, carro: string, vid: string;
const one = async (token: string, o: unknown) => ((await push(c, token, [o])).body.results as { status: string; code?: string }[])[0];

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string }[];
  A = st.find((s) => s.type === "carrosserie")!.id;
  HALL = st.find((s) => s.type === "hall")!.id;
  B = (await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "carrosserie", name: "Taller Dos", capacite: 10 } })).body.id;
  OTHER_TENANT = (await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "carrosserie", name: "Taller Otro", capacite: 10 } })).body.id;
  // A and B share a tenant, the third one is in another tenant
  await c.h.db.update(stations).set({ azureTenant: "tenant-1" }).where(eq(stations.id, A));
  await c.h.db.update(stations).set({ azureTenant: "tenant-1" }).where(eq(stations.id, B));
  await c.h.db.update(stations).set({ azureTenant: "tenant-2" }).where(eq(stations.id, OTHER_TENANT));
  chef = await inviteAndAccept(c, c.orgES, "chef-bs@example.test", { role_id: c.roleId.chef_site, station_id: A });
  aufnehmer = await inviteAndAccept(c, c.orgES, "auf-bs@example.test", { role_id: c.roleId.aufnehmer });
  carro = await inviteAndAccept(c, c.orgES, "carro-bs@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: A });
  vid = uuid();
  expect((await one(aufnehmer, op("vehicle.create", { vehicle: { id: vid, stationId: A, clientStationId: A, statut: "besichtigung", panels: { haube: dentsPanel("haube", { "20": 12 }) }, header: { land: "ES", kennzeichen: "BS 1", modell: "Seat", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69 } } }))).status).toBe("ok");
});
afterAll(async () => { await c.h.close(); });

describe("body shop of a car", () => {
  it("only a car in the repair flow can be given a body shop", async () => {
    const r = await one(chef, op("vehicle.bodyshop", { vehicleId: vid, bodyshopId: B }));
    expect(r.status).toBe("rejected");
    expect(r.code).toBe("vehicle_not_in_repair");
  });

  it("the choices travel with the data: carrosserie sites (names, tenant) for users of the repair board", async () => {
    expect((await one(chef, op("vehicle.repairStage", { vehicleId: vid, stage: "bereit" }))).status).toBe("ok");
    const p = await pull(c, chef, c.orgES);
    const ids = p.refs.bodyshops.map((b: { id: string }) => b.id);
    expect(ids).toEqual(expect.arrayContaining([A, B, OTHER_TENANT]));
    expect(ids).not.toContain(HALL);
    const pc = await pull(c, carro, c.orgES);
    expect(pc.refs.bodyshops).toEqual([]); // the external body shop account has no repair board
  });

  it("set, pulled back on the vehicle, logged in the history; clearing works", async () => {
    expect((await one(chef, op("vehicle.repairStage", { vehicleId: vid, stage: "bodyshop" }))).status).toBe("ok");
    expect((await one(chef, op("vehicle.bodyshop", { vehicleId: vid, bodyshopId: B }))).status).toBe("ok");
    expect((await pull(c, chef, c.orgES)).vehicles.find((v: any) => v.id === vid).bodyshopId).toBe(B);
    const ev = (await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, vid))).filter((e) => e.type === "bodyshop");
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ to: B, name: "Taller Dos" });
    // same value again: no new event
    expect((await one(chef, op("vehicle.bodyshop", { vehicleId: vid, bodyshopId: B }))).status).toBe("ok");
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, vid))).filter((e) => e.type === "bodyshop")).toHaveLength(1);
    expect((await one(chef, op("vehicle.bodyshop", { vehicleId: vid, bodyshopId: null }))).status).toBe("ok");
    expect((await pull(c, chef, c.orgES)).vehicles.find((v: any) => v.id === vid).bodyshopId).toBeNull();
  });

  it("only a carrosserie site of the same tenant: not a hall, not another tenant, not an unknown id", async () => {
    for (const bad of [HALL, OTHER_TENANT, uuid()]) {
      const r = await one(chef, op("vehicle.bodyshop", { vehicleId: vid, bodyshopId: bad }));
      expect(r.status, bad).toBe("rejected");
      expect(r.code, bad).toBe("bodyshop_invalid");
    }
  });

  it("without the right to move cards on the board nothing changes", async () => {
    const r = await one(carro, op("vehicle.bodyshop", { vehicleId: vid, bodyshopId: B }));
    expect(["rejected", "forbidden"]).toContain(r.status);
    expect((await pull(c, chef, c.orgES)).vehicles.find((v: any) => v.id === vid).bodyshopId).toBeNull();
  });
});
