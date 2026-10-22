// Where a car came from in Colibri (BusinessCustomer-insurance link, location, tenant) travels with the vehicle.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { colibriScans, vehicles } from "../src/schema";
import { reopenScansOfDeletedVehicles } from "../src/azure_sync";
import { call, dentsPanel, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, imported: string, manual: string;
beforeAll(async () => {
  c = await setup();
  A = ((await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string }[]).find((s) => s.type === "carrosserie")!.id;
  const mk = async (plate: string) => {
    const id = uuid();
    const r = ((await push(c, c.superToken, [op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: A, statut: "besichtigung", panels: { haube: dentsPanel("haube", { "20": 4 }) }, header: { land: "ES", kennzeichen: plate, modell: "Seat", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69 } } })])).body.results as { status: string }[])[0];
    expect(r.status).toBe("ok");
    return id;
  };
  imported = await mk("OR 1"); manual = await mk("OR 2");
  await c.h.db.insert(colibriScans).values({ partitionKey: "202610221030OR1", rowKey: "undefined", tenant: "PDR-Team ES", location: "Madrid", businessCustomer: "Allianz-Allianz", plate: "OR 1" });
  await c.h.db.update(vehicles).set({ colibriScanKey: "202610221030OR1|undefined" }).where(eq(vehicles.id, imported));
});
afterAll(async () => { await c.h.close(); });

describe("origin of a car", () => {
  it("a car imported from a scan carries its BusinessCustomer link, location and tenant; a car created by hand carries none", async () => {
    const p = await pull(c, c.superToken, c.orgES);
    expect(p.vehicles.find((v: any) => v.id === imported).colibriSource).toEqual({ businessCustomer: "Allianz-Allianz", location: "Madrid", tenant: "PDR-Team ES" });
    expect(p.vehicles.find((v: any) => v.id === manual).colibriSource).toBeNull();
  });
});

describe("a scan whose vehicle was deleted is available again", () => {
  const scanOf = async (pk: string) => (await c.h.db.select().from(colibriScans).where(eq(colibriScans.partitionKey, pk)))[0];
  it("deleting the vehicle (app) opens the scan again and frees its key", async () => {
    await c.h.db.update(colibriScans).set({ importStatus: "imported", vehicleId: imported }).where(eq(colibriScans.partitionKey, "202610221030OR1"));
    const r = ((await push(c, c.superToken, [op("vehicle.delete", { vehicleId: imported })])).body.results as { status: string }[])[0];
    expect(r.status).toBe("ok");
    expect(await scanOf("202610221030OR1")).toMatchObject({ importStatus: "new", vehicleId: null });
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, imported)))[0].colibriScanKey).toBeNull();
  });
  it("a vehicle deleted by other means (earlier versions, the database) is caught up by the next mirror run", async () => {
    const id = uuid();
    await c.h.db.insert(vehicles).values({ id, orgId: c.orgES, stationId: A, statut: "besichtigung", header: {}, panels: {}, colibriScanKey: "202610221111OR3|undefined", deletedAt: new Date() } as never);
    await c.h.db.insert(colibriScans).values({ partitionKey: "202610221111OR3", rowKey: "undefined", tenant: "PDR-Team ES", plate: "OR 3", importStatus: "imported", vehicleId: id });
    expect(await reopenScansOfDeletedVehicles(c.h.db)).toBe(1);
    expect(await scanOf("202610221111OR3")).toMatchObject({ importStatus: "new", vehicleId: null });
    expect(await reopenScansOfDeletedVehicles(c.h.db)).toBe(0);
  });
});
