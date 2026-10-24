// Edit and delete a station (Verwaltung): deletion only when nothing that still exists depends on it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, roleAssignments, stationInsurers, stations, vehicles } from "../src/schema";
import { call, dentsPanel, inviteAndAccept, op, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, chef: string;
// a PLACE (hall) and a customer (body shop) are created through their own routes since V5
const mkStation = async (name: string) => (await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "hall", name, capacite: 5 } })).body.id as string;
const mkBodyshop = async (name: string) => (await call(c, "POST", "/admin/bodyshops", { token: c.superToken, org: c.orgES, body: { name } })).body.id as string;

beforeAll(async () => {
  c = await setup();
  A = ((await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string }[]).find((s) => s.type === "hall")!.id;
  chef = await inviteAndAccept(c, c.orgES, "chef-del@example.test", { role_id: c.roleId.chef_site, station_id: A });
});
afterAll(async () => { await c.h.close(); });

describe("station: edit and delete", () => {
  it("edit keeps working (name, capacity, repairs per day)", async () => {
    const id = await mkStation("Nave Editar");
    const r = await call(c, "PUT", `/admin/stations/${id}`, { token: c.superToken, org: c.orgES, body: { name: "Nave Editada", capacite: 12, repairs_per_day: 4 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "Nave Editada", capacite: 12, repairsPerDay: 4 });
  });

  it("an empty station is deleted with its links; the audit log keeps what it was", async () => {
    const id = await mkStation("Nave Borrar");
    const ins = (await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Aseg Del", report_emails: [], send_reports: false } })).body.id;
    await call(c, "PUT", `/admin/stations/${id}/insurers`, { token: c.superToken, org: c.orgES, body: { insurer_ids: [ins] } });
    await inviteAndAccept(c, c.orgES, "tech-del@example.test", { role_id: c.roleId.technicien, station_id: id });
    const r = await call(c, "DELETE", `/admin/stations/${id}`, { token: c.superToken, org: c.orgES });
    expect(r.status).toBe(200);
    expect(await c.h.db.select().from(stations).where(eq(stations.id, id))).toHaveLength(0);
    expect(await c.h.db.select().from(stationInsurers).where(eq(stationInsurers.stationId, id))).toHaveLength(0);
    expect(await c.h.db.select().from(roleAssignments).where(eq(roleAssignments.stationId, id))).toHaveLength(0);
    const log = (await c.h.db.select().from(auditLog).where(eq(auditLog.entityId, id))).find((a) => a.action === "delete");
    expect(log?.before).toMatchObject({ name: "Nave Borrar" });
    expect((await call(c, "DELETE", `/admin/stations/${id}`, { token: c.superToken, org: c.orgES })).status).toBe(404);
  });

  it("refused while a vehicle still stands there (or belongs to it); allowed once it is deleted", async () => {
    const id = await mkStation("Nave Ocupada");
    const client = await mkBodyshop("Taller Cliente");
    const vid = uuid();
    expect(((await push(c, c.superToken, [op("vehicle.create", { vehicle: { id: vid, stationId: id, clientStationId: client, statut: "besichtigung", panels: { haube: dentsPanel("haube", { "20": 3 }) }, header: { land: "ES", kennzeichen: "DEL 1", modell: "Seat", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69 } } })])).body.results as { status: string }[])[0].status).toBe("ok");
    const r = await call(c, "DELETE", `/admin/stations/${id}`, { token: c.superToken, org: c.orgES });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/1/);
    expect(await c.h.db.select().from(stations).where(eq(stations.id, id))).toHaveLength(1);
    await c.h.db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, vid));
    expect((await call(c, "DELETE", `/admin/stations/${id}`, { token: c.superToken, org: c.orgES })).status).toBe(200);
    const row = (await c.h.db.select().from(vehicles).where(eq(vehicles.id, vid)))[0];
    expect(row.stationId).toBeNull();
  });

  it("a car belongs to a body shop but may stand in a hall: deleting the OWNER or the PLACE is refused either way", async () => {
    const owner = await mkBodyshop("Taller Dueño");
    const hall = await mkStation("Nave Aparte");
    const vid = uuid();
    expect(((await push(c, c.superToken, [op("vehicle.create", { vehicle: { id: vid, stationId: hall, clientStationId: owner, statut: "besichtigung", panels: { haube: dentsPanel("haube", { "20": 3 }) }, header: { land: "ES", kennzeichen: "DEL 2", modell: "Seat", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69 } } })])).body.results as { status: string }[])[0].status).toBe("ok");
    const byOwner = await call(c, "DELETE", `/admin/bodyshops/${owner}`, { token: c.superToken, org: c.orgES });
    expect(byOwner.status).toBe(409);
    expect(byOwner.body.error).toMatch(/0 .*1/); // 0 stand there, 1 belongs to it
    const byPlace = await call(c, "DELETE", `/admin/stations/${hall}`, { token: c.superToken, org: c.orgES });
    expect(byPlace.status).toBe(409);
    expect(byPlace.body.error).toMatch(/1 .*0/);
  });

  it("an empty body shop is deleted through /admin/bodyshops, with its insurer links", async () => {
    const id = await mkBodyshop("Taller Cliente Borrar");
    const ins = (await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Aseg Del 2", report_emails: [], send_reports: false } })).body.id;
    await call(c, "PUT", `/admin/stations/${id}/insurers`, { token: c.superToken, org: c.orgES, body: { insurer_ids: [ins] } });
    expect((await call(c, "DELETE", `/admin/bodyshops/${id}`, { token: c.superToken, org: c.orgES })).status).toBe(200);
    expect(await c.h.db.select().from(stations).where(eq(stations.id, id))).toHaveLength(0);
    expect(await c.h.db.select().from(stationInsurers).where(eq(stationInsurers.stationId, id))).toHaveLength(0);
  });

  it("the place routes refuse a body shop (use_bodyshops): create, edit, delete", async () => {
    const id = await mkBodyshop("Taller Solo Cliente");
    const created = await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "carrosserie", name: "No" } });
    expect(created.status).toBe(400); expect(created.body.code).toBe("use_bodyshops");
    const edited = await call(c, "PUT", `/admin/stations/${id}`, { token: c.superToken, org: c.orgES, body: { name: "No" } });
    expect(edited.status).toBe(409); expect(edited.body.code).toBe("use_bodyshops");
    const del = await call(c, "DELETE", `/admin/stations/${id}`, { token: c.superToken, org: c.orgES });
    expect(del.status).toBe(409); expect(del.body.code).toBe("use_bodyshops");
    expect(await c.h.db.select().from(stations).where(eq(stations.id, id))).toHaveLength(1);
  });

  it("only people who manage stations can delete; another organisation's station is not found", async () => {
    const id = await mkStation("Nave Protegida");
    expect((await call(c, "DELETE", `/admin/stations/${id}`, { token: chef, org: c.orgES })).status).toBe(403);
    expect((await call(c, "DELETE", `/admin/stations/${id}`, { token: c.superToken, org: c.orgDE })).status).toBe(404);
    expect(await c.h.db.select().from(stations).where(eq(stations.id, id))).toHaveLength(1);
  });
});
