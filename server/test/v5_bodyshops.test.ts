// V5 phase 1: body shops are customers, never places. Server rules, /admin/bodyshops, permission, migration and the Chapauto move script.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { SYSTEM_ROLES } from "@hagel/shared";
import { auditLog, insurers, roleAssignments, roles, stationInsurers, stations, vehicleMoves, vehicles } from "../src/schema";
import { MOVE_NOTE, applyBodyshopMove, normName, planBodyshopMove } from "../src/scripts/v5_move_bodyshop_vehicles";
import { call, dentsPanel, inviteAndAccept, op, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, HALL: string, HALL2: string, CARRO: string;
let chef: string, assessor: string, tech: string;
const create = (id: string, o: Record<string, unknown> = {}) =>
  op("vehicle.create", { vehicle: { id, stationId: HALL, clientStationId: CARRO, header: { land: "ES", kennzeichen: "V5-" + id.slice(0, 4), leistungsdatum: "2026-10-19", stundensatz: 69 }, panels: { haube: dentsPanel("haube", { "20": 5 }) }, shares: { techName: "Ana", techPct: 50 }, ...o } });
const res = async (token: string, ...ops: unknown[]) => (await push(c, token, ops)).body.results as { status: string; code?: string }[];

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string; name: string }[];
  CARRO = st.find((s) => s.type === "carrosserie")!.id;
  HALL = st.find((s) => s.name === "Nave Test A")!.id;
  HALL2 = st.find((s) => s.name === "Nave PDR Madrid")!.id;
  chef = await inviteAndAccept(c, c.orgES, "chef-v5@example.test", { role_id: c.roleId.chef_site, station_id: HALL });
  assessor = await inviteAndAccept(c, c.orgES, "ass-v5@example.test", { role_id: c.roleId.aufnehmer });
  tech = await inviteAndAccept(c, c.orgES, "tech-v5@example.test", { role_id: c.roleId.technicien, station_id: HALL });
});
afterAll(async () => { await c.h.close(); });

describe("a body shop is never a place", () => {
  it("a vehicle cannot be created at, or moved to, a body shop", async () => {
    expect((await res(c.superToken, create(uuid(), { stationId: CARRO })))[0]).toMatchObject({ status: "rejected", code: "station_not_a_place" });
    const id = uuid();
    expect((await res(c.superToken, create(id)))[0].status).toBe("ok");
    expect((await res(c.superToken, op("vehicle.move", { vehicleId: id, toStationId: CARRO })))[0]).toMatchObject({ status: "rejected", code: "station_not_a_place" });
    expect((await res(c.superToken, op("vehicle.move", { vehicleId: id, toStationId: HALL2 })))[0].status).toBe("ok");
  });

  it("the customer must be a body shop; an unchanged old value stays editable", async () => {
    expect((await res(c.superToken, create(uuid(), { clientStationId: HALL })))[0]).toMatchObject({ status: "rejected", code: "client_not_bodyshop" });
    const id = uuid();
    expect((await res(c.superToken, create(id)))[0].status).toBe("ok");
    expect((await res(c.superToken, op("vehicle.header", { vehicleId: id, fields: { clientStationId: HALL } })))[0]).toMatchObject({ status: "rejected", code: "client_not_bodyshop" });
    // a car whose customer is a hall since before V5 (legacy row): re-sending the same customer is not an error, a header edit works
    await c.h.db.update(vehicles).set({ clientStationId: HALL }).where(eq(vehicles.id, id));
    expect((await res(c.superToken, op("vehicle.header", { vehicleId: id, fields: { notiz: "still editable" } })))[0].status).toBe("ok");
    expect((await res(c.superToken, op("vehicle.header", { vehicleId: id, fields: { clientStationId: HALL } })))[0].status).toBe("ok");
    expect((await res(c.superToken, op("vehicle.header", { vehicleId: id, fields: { clientStationId: CARRO } })))[0].status).toBe("ok"); // and it can be fixed
  });

  it("role assignments and invitations: the station is a place, the client scope a body shop", async () => {
    const roleBodyshop = (await call(c, "POST", "/admin/roles", { token: c.superToken, org: c.orgES, body: { name: "V5 customer", scope: "client", permissions: ["vehicules.voir"] } })).body.id;
    const inv = (b: Record<string, unknown>) => call(c, "POST", "/admin/invitations", { token: c.superToken, org: c.orgES, body: { email: `x${uuid().slice(0, 6)}@example.test`, ...b } });
    expect((await inv({ role_id: c.roleId.chef_site, station_id: CARRO })).body.code).toBe("station_not_a_place");
    expect((await inv({ role_id: c.roleId.chef_site, station_id: HALL })).status).toBe(201);
    expect((await inv({ role_id: roleBodyshop, scope_client_station_id: HALL })).body.code).toBe("client_not_bodyshop");
    expect((await inv({ role_id: roleBodyshop, scope_client_station_id: CARRO })).status).toBe(201);
  });

  it("campaigns only list places", async () => {
    const r = await call(c, "POST", "/admin/campaigns", { token: c.superToken, org: c.orgES, body: { name: "V5 c", country: "ES", station_ids: [CARRO] } });
    expect(r.status).toBe(400); expect(r.body.code).toBe("station_not_a_place");
  });

  it("the sync pull offers body shops as customers but never as repair places", async () => {
    const r = await call(c, "GET", "/sync/pull?since=0", { token: c.superToken, org: c.orgES });
    expect(r.body.refs.stations.some((s: { id: string }) => s.id === CARRO)).toBe(true);
    expect(r.body.refs.repairLocations.every((s: { id: string }) => s.id !== CARRO)).toBe(true);
  });
});

describe("routes: stations are places, body shops have their own", () => {
  const sup = (m: string, p: string, body?: unknown) => call(c, m, p, { token: c.superToken, org: c.orgES, ...(body ? { body } : {}) });

  it("the station routes refuse a body shop and say where to go", async () => {
    expect((await sup("POST", "/admin/stations", { type: "carrosserie", name: "X" })).body.code).toBe("use_bodyshops");
    expect((await sup("POST", "/admin/stations", { type: "hall", name: "Nave V5 route", capacite: 7 })).status).toBe(201);
    expect((await sup("PUT", `/admin/stations/${CARRO}`, { name: "renamed" })).body.code).toBe("use_bodyshops");
    expect((await sup("DELETE", `/admin/stations/${CARRO}`)).body.code).toBe("use_bodyshops");
    expect((await sup("POST", `/admin/stations/${CARRO}/active`, { active: false })).body.code).toBe("use_bodyshops");
    // and the other way round
    expect((await sup("PUT", `/admin/bodyshops/${HALL}`, { name: "renamed" })).body.code).toBe("use_stations");
    expect((await sup("DELETE", `/admin/bodyshops/${HALL}`)).body.code).toBe("use_stations");
  });

  it("create, edit, list with counts, deactivate, delete a body shop", async () => {
    const mk = await sup("POST", "/admin/bodyshops", { name: "Taller V5", address: "Calle 1", country: "ES", commission_pct: 25, contact_name: "Marta", contact_phone: "600 000 000", report_emails: ["a@taller.test"] });
    expect(mk.status).toBe(201);
    expect(mk.body).toMatchObject({ type: "carrosserie", name: "Taller V5", capacite: 0, contactName: "Marta", contactPhone: "600 000 000", reportEmails: ["a@taller.test"] });
    const id = mk.body.id as string;
    expect((await sup("PUT", `/admin/bodyshops/${id}`, { commission_pct: 30, contact_name: null })).body).toMatchObject({ commissionPct: "30.00", contactName: null, contactPhone: "600 000 000" });
    // CIF: optional, kept upper-case without spaces, not touched by an edit that does not send it, removable
    expect(mk.body.cif).toBeNull();
    expect((await sup("PUT", `/admin/bodyshops/${id}`, { cif: " b 12345678 " })).body.cif).toBe("B12345678");
    expect((await sup("PUT", `/admin/bodyshops/${id}`, { contact_name: "Marta" })).body.cif).toBe("B12345678");
    expect(((await sup("GET", "/admin/bodyshops")).body as { id: string; cif: string | null }[]).find((b) => b.id === id)!.cif).toBe("B12345678");
    expect((await sup("PUT", `/admin/bodyshops/${id}`, { cif: "x".repeat(21) })).status).toBe(400);
    expect((await sup("PUT", `/admin/bodyshops/${id}`, { cif: "" })).body.cif).toBeNull();
    // a car of this customer: counted open and in total; the shop cannot be deleted while a car belongs to it
    const vid = uuid();
    expect((await res(c.superToken, create(vid, { clientStationId: id })))[0].status).toBe("ok");
    const row = ((await sup("GET", "/admin/bodyshops")).body as { id: string; openVehicles: number; totalVehicles: number }[]).find((b) => b.id === id)!;
    expect(row).toMatchObject({ openVehicles: 1, totalVehicles: 1 });
    expect((await sup("DELETE", `/admin/bodyshops/${id}`)).body.code).toBe("station_in_use");
    expect((await sup("POST", `/admin/bodyshops/${id}/active`, { active: false })).body.active).toBe(false);
    expect((await sup("POST", `/admin/bodyshops/${id}/active`, { active: true })).body.active).toBe(true);
    const empty = (await sup("POST", "/admin/bodyshops", { name: "Taller vacío" })).body.id as string;
    expect((await sup("DELETE", `/admin/bodyshops/${empty}`)).status).toBe(200);
    const log = await c.h.db.select().from(auditLog).where(eq(auditLog.entityId, empty));
    expect(log.map((l) => `${l.entity}:${l.action}`)).toEqual(expect.arrayContaining(["bodyshop:create", "bodyshop:delete"]));
  });

  it("the list of body shops carries the external accounts (role Body shop)", async () => {
    const role = (await sup("POST", "/admin/roles", { name: "V5 Body shop acc", scope: "client", permissions: ["vehicules.voir"] })).body.id;
    await inviteAndAccept(c, c.orgES, "taller-acc@example.test", { role_id: role, scope_client_station_id: CARRO });
    const row = ((await sup("GET", "/admin/bodyshops")).body as { id: string; accounts: { email: string }[] }[]).find((b) => b.id === CARRO)!;
    expect(row.accounts.map((a) => a.email)).toContain("taller-acc@example.test");
  });
});

describe("permission bodyshops.gerer", () => {
  it("is in the default roles Organisation admin and Station manager, not in the others", () => {
    const has = (k: string) => SYSTEM_ROLES.find((r) => r.key === k)!.permissions.includes("bodyshops.gerer" as never);
    expect(has("org_admin")).toBe(true); expect(has("chef_site")).toBe(true);
    for (const k of ["aufnehmer", "technicien", "freelance", "carrosserie", "assureur"]) expect(has(k), k).toBe(false);
  });

  it("a station manager (grant bound to his station) manages body shops; assessor and technician cannot; stations.gerer alone is not enough", async () => {
    const list = (t: string) => call(c, "GET", "/admin/bodyshops", { token: t, org: c.orgES });
    expect((await list(chef)).status).toBe(200);
    expect((await call(c, "POST", "/admin/bodyshops", { token: chef, org: c.orgES, body: { name: "Taller del jefe" } })).status).toBe(201);
    expect((await list(assessor)).status).toBe(403);
    expect((await list(tech)).status).toBe(403);
    expect((await call(c, "POST", "/admin/bodyshops", { token: assessor, org: c.orgES, body: { name: "no" } })).status).toBe(403);
    const onlyStations = (await call(c, "POST", "/admin/roles", { token: c.superToken, org: c.orgES, body: { name: "V5 only stations", scope: "station", permissions: ["vehicules.voir", "stations.gerer"] } })).body.id;
    const tok = await inviteAndAccept(c, c.orgES, "only-st@example.test", { role_id: onlyStations });
    expect((await list(tok)).status).toBe(403);
    expect((await call(c, "POST", "/admin/stations", { token: tok, org: c.orgES, body: { type: "hall", name: "Nave del gestor" } })).status).toBe(201);
  });

  it("linking insurers to a body shop works with bodyshops.gerer (without assurances.gerer)", async () => {
    const [ins] = await c.h.db.insert(insurers).values({ orgId: c.orgES, name: "Aseg V5" }).returning();
    const role = (await call(c, "POST", "/admin/roles", { token: c.superToken, org: c.orgES, body: { name: "V5 bodyshops only", scope: "station", permissions: ["vehicules.voir", "bodyshops.gerer"] } })).body.id;
    const tok = await inviteAndAccept(c, c.orgES, "bs-only@example.test", { role_id: role });
    expect((await call(c, "PUT", `/admin/stations/${CARRO}/insurers`, { token: tok, org: c.orgES, body: { insurer_ids: [ins.id] } })).status).toBe(200);
    expect(await c.h.db.select().from(stationInsurers).where(and(eq(stationInsurers.stationId, CARRO), eq(stationInsurers.insurerId, ins.id)))).toHaveLength(1);
    expect((await call(c, "PUT", `/admin/stations/${CARRO}/insurers`, { token: assessor, org: c.orgES, body: { insurer_ids: [] } })).status).toBe(403);
    expect((await list(tok)).status).toBe(200);
    async function list(t: string) { return call(c, "GET", `/admin/stations/${CARRO}/recipients`, { token: t, org: c.orgES }); }
  });

  it("migration 0016 appends the permission to the default roles once (idempotent), custom roles untouched", async () => {
    const stmt = sql`UPDATE "roles" SET "permissions" = array_append("permissions", 'bodyshops.gerer')
      WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('bodyshops.gerer' = ANY("permissions"))`;
    const before = await c.h.db.select().from(roles).where(eq(roles.orgId, c.orgES));
    // simulate a database from before V5: the permission is missing in the default roles
    await c.h.db.execute(sql`UPDATE "roles" SET "permissions" = array_remove("permissions", 'bodyshops.gerer') WHERE "is_system" = true`);
    await c.h.db.execute(stmt); await c.h.db.execute(stmt); // twice
    const after = await c.h.db.select().from(roles).where(eq(roles.orgId, c.orgES));
    for (const r of after) {
      if (!r.isSystem) { expect(r.permissions, r.name).toEqual(before.find((x) => x.id === r.id)!.permissions); continue; } // custom roles are never touched
      const wants = r.key === "org_admin" || r.key === "chef_site";
      expect(r.permissions.filter((p) => p === "bodyshops.gerer").length, r.name).toBe(wants ? 1 : 0);
    }
    expect(after.length).toBe(before.length);
  });
});

describe("script: vehicles standing in a body shop move to Chapauto", () => {
  const stand = async (plate: string, stationId: string, over: Partial<typeof vehicles.$inferInsert> = {}) => {
    const id = uuid();
    expect((await res(c.superToken, create(id, { header: { land: "ES", kennzeichen: plate, leistungsdatum: "2026-10-19", stundensatz: 69 } })))[0].status).toBe("ok");
    // the legacy situation (before V5): the car stands IN the body shop
    await c.h.db.update(vehicles).set({ stationId, ...over }).where(eq(vehicles.id, id));
    return id;
  };
  let chapauto: string;
  beforeAll(async () => { chapauto = (await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "hall", name: "ChapAuto" } })).body.id; });

  it("names are compared without case or accents", () => {
    expect(normName("  Chápauto ")).toBe("chapauto");
    expect(normName("CHAPAUTO")).toBe("chapauto");
  });

  it("dry run lists plate, old station, status and board step; apply moves, writes history + audit, keeps the customer, and is idempotent", async () => {
    const live = await stand("OLD 1", CARRO);
    const deleted = await stand("OLD 2", CARRO, { deletedAt: new Date(), statut: "fertig", repairStage: "finish" });
    const plan = await planBodyshopMove(c.h.db);
    expect(plan.problems).toEqual([]);
    expect(plan.items.map((i) => i.plate).sort()).toEqual(["OLD 1", "OLD 2"]);
    expect(plan.items.find((i) => i.plate === "OLD 2")).toMatchObject({ deleted: true, statut: "fertig", repairStage: "finish", toStationId: chapauto, fromStationId: CARRO });
    // a dry run changes nothing
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, live)))[0].stationId).toBe(CARRO);

    const seqBefore = (await c.h.db.select().from(vehicles).where(eq(vehicles.id, live)))[0].seq;
    expect(await applyBodyshopMove(c.h.db, plan)).toBe(2);
    for (const id of [live, deleted]) {
      const [v] = await c.h.db.select().from(vehicles).where(eq(vehicles.id, id));
      expect(v.stationId).toBe(chapauto);
      expect(v.clientStationId).toBe(CARRO); // the customer never changes
      const mv = await c.h.db.select().from(vehicleMoves).where(eq(vehicleMoves.vehicleId, id));
      expect(mv).toHaveLength(1);
      expect(mv[0]).toMatchObject({ fromStationId: CARRO, toStationId: chapauto, note: MOVE_NOTE, userId: null });
      const log = (await c.h.db.select().from(auditLog).where(eq(auditLog.entityId, id))).filter((a) => a.action === "v5.move_bodyshop_vehicle");
      expect(log).toHaveLength(1);
      expect(log[0].before).toMatchObject({ stationId: CARRO }); expect(log[0].after).toMatchObject({ stationId: chapauto });
    }
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, live)))[0].seq).toBeGreaterThan(seqBefore); // the phones pick the change up
    // amounts and panels are untouched
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, live)))[0].panels).toMatchObject({ haube: expect.anything() });
    // second run: nothing left to do
    const again = await planBodyshopMove(c.h.db);
    expect(again.items).toEqual([]); expect(again.problems).toEqual([]);
    expect(await applyBodyshopMove(c.h.db, again)).toBe(0);
  });

  it("the moved car shows up for the staff of Chapauto (it is on their place now)", async () => {
    const id = await stand("OLD 3", CARRO);
    await applyBodyshopMove(c.h.db, await planBodyshopMove(c.h.db));
    const chefChapauto = await inviteAndAccept(c, c.orgES, "chef-chap@example.test", { role_id: c.roleId.chef_site, station_id: chapauto });
    const pull = await call(c, "GET", "/sync/pull?since=0", { token: chefChapauto, org: c.orgES });
    expect(pull.body.vehicles.some((v: { id: string }) => v.id === id)).toBe(true);
  });

  it("stops without writing anything when it is not clear", async () => {
    await stand("OLD 4", CARRO);
    const writes = async () => (await c.h.db.select().from(vehicleMoves)).length;
    const n0 = await writes();
    // two stations named Chapauto
    const [dup] = await c.h.db.insert(stations).values({ orgId: c.orgES, type: "hall", name: "chapauto", country: "ES" }).returning();
    let plan = await planBodyshopMove(c.h.db);
    expect(plan.items).toEqual([]);
    expect(plan.problems.join(" ")).toMatch(/2 stations named "Chapauto"/);
    await expect(applyBodyshopMove(c.h.db, plan)).rejects.toThrow(/open problems/);
    await c.h.db.delete(stations).where(eq(stations.id, dup.id));
    // Chapauto is itself a body shop / inactive / missing
    await c.h.db.update(stations).set({ type: "carrosserie" }).where(eq(stations.id, chapauto));
    plan = await planBodyshopMove(c.h.db);
    expect(plan.problems.join(" ")).toMatch(/itself a body shop/);
    await c.h.db.update(stations).set({ type: "hall", active: false }).where(eq(stations.id, chapauto));
    expect((await planBodyshopMove(c.h.db)).problems.join(" ")).toMatch(/inactive/);
    await c.h.db.update(stations).set({ active: true, name: "Other name" }).where(eq(stations.id, chapauto));
    expect((await planBodyshopMove(c.h.db)).problems.join(" ")).toMatch(/no station named "Chapauto"/);
    await c.h.db.update(stations).set({ name: "Chapauto" }).where(eq(stations.id, chapauto));
    expect(await writes()).toBe(n0);
  });

  it("anything else placed in a body shop is listed (nothing is moved for it automatically)", async () => {
    const [ra] = await c.h.db.insert(roleAssignments).values({ userId: (await c.h.db.select().from((await import("../src/schema")).users).limit(1))[0].id, orgId: c.orgES, roleId: c.roleId.technicien, stationId: CARRO }).returning();
    const plan = await planBodyshopMove(c.h.db);
    expect(plan.problems.join(" ")).toMatch(/role assignment\(s\) have a body shop as STATION/);
    await c.h.db.delete(roleAssignments).where(eq(roleAssignments.id, ra.id));
    expect((await planBodyshopMove(c.h.db)).problems.join(" ")).not.toMatch(/role assignment/);
  });
});
