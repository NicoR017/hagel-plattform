// Where a car came from in Colibri (BusinessCustomer-insurance link, location, tenant) travels with the vehicle.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { colibriScans, vehicles } from "../src/schema";
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
