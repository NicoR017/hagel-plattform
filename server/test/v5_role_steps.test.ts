// v5: the repair steps of a ROLE (Disassembly, PDR, Reassembly). Each step lets the account move the car out of that step into the next one;
// without steps the rule of the technician record (PDR / headliner) still applies (v4_field.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { repairAppointments, technicians, users, vehicles } from "../src/schema";
import { call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx;
let A: string, CARRO: string;
let assessor: string, pdrRole: string, remRole: string;
let pdrTok: string, remTok: string, pdrUser: string, remUser: string;

const ok = async (token: string, ops: unknown[]) => { const r = await push(c, token, ops); expect(r.status).toBe(200); return r.body.results as { status: string; code?: string }[]; };
const one = async (token: string, o: unknown) => (await ok(token, [o]))[0];
const stageOf = async (id: string) => (await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0].repairStage;
const move = (token: string, id: string, stage: string) => one(token, op("vehicle.repairStage", { vehicleId: id, stage }));

/** a car on the board at `stage`; PDR work assigned to pdrUser, removal/refit work to remUser */
async function car(stage: string) {
  const id = uuid();
  await ok(assessor, [op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, header: { land: "ES", kennzeichen: "R-" + id.slice(0, 4), modell: "Seat", leistungsdatum: "2026-10-19", stundensatz: 69, demontage: true, demontageEur: 100 },
    panels: { haube: dentsPanel("haube", { "20": 12 }) }, shares: { techName: "Role Pdr", techPct: 50, demTechName: "Role Rem", demTechPct: 80 }, statut: "besichtigung" } })]);
  await move(assessor, id, "bereit");
  await one(assessor, op("vehicle.assign", { vehicleId: id, kind: "pdr", userIds: [pdrUser] }));
  await one(assessor, op("vehicle.assign", { vehicleId: id, kind: "demontage", userIds: [remUser] }));
  for (const s of ["demontage", "pdr", "remontage", "bodyshop"]) { if (stage === "bereit") break; await move(assessor, id, s); if (s === stage) break; }
  return id;
}
async function photo(token: string, vehicleId: string, stage: string) {
  const pid = uuid();
  await one(token, op("photo.add", { photo: { id: pid, vehicleId, label: "Detail", phase: "reparatur", takenAt: new Date().toISOString() } }));
  await one(token, op("photo.stage", { photoId: pid, repairStage: stage, role: "Techniker" }));
}

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  CARRO = st.find((s) => s.type === "carrosserie").id;
  assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  const base = ((await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgES })).body as any[]).find((r) => r.id === c.roleId.technicien);
  const mk = async (name: string, steps: string[]) => {
    const r = await call(c, "POST", "/admin/roles", { token: c.superToken, org: c.orgES, body: { name, scope: base.scope, permissions: base.permissions, repair_steps: steps } });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  pdrRole = await mk("Only PDR", ["pdr"]);
  remRole = await mk("Removal and refit", ["demontage", "remontage"]);
  pdrTok = await inviteAndAccept(c, c.orgES, "pdr@example.test", { role_id: pdrRole, station_id: A });
  remTok = await inviteAndAccept(c, c.orgES, "rem@example.test", { role_id: remRole, station_id: A });
  const uid = async (e: string) => (await c.h.db.select().from(users).where(eq(users.email, e)))[0].id;
  pdrUser = await uid("pdr@example.test"); remUser = await uid("rem@example.test");
  await c.h.db.delete(technicians);
  // both records are "pdr" kind on purpose: the steps of the role decide, not the kind of the record
  await c.h.db.insert(technicians).values([
    { orgId: c.orgES, name: "Role Pdr", userId: pdrUser, kind: "pdr" },
    { orgId: c.orgES, name: "Role Rem", userId: remUser, kind: "pdr" },
  ]);
});
afterAll(async () => { await c.h.close(); });

describe("roles carry repair steps", () => {
  it("saved, listed, updated; only known steps; default empty", async () => {
    const list = (await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgES })).body as any[];
    expect(list.find((r) => r.id === pdrRole).repairSteps).toEqual(["pdr"]);
    expect(list.find((r) => r.id === remRole).repairSteps).toEqual(["demontage", "remontage"]);
    expect(list.find((r) => r.id === c.roleId.technicien).repairSteps).toEqual([]);
    const bad = await call(c, "POST", "/admin/roles", { token: c.superToken, org: c.orgES, body: { name: "X", scope: "station", permissions: [], repair_steps: ["finish"] } });
    expect(bad.status).toBe(400);
    const none = await call(c, "POST", "/admin/roles", { token: c.superToken, org: c.orgES, body: { name: "No steps", scope: "station", permissions: [] } });
    expect(none.body.repairSteps).toEqual([]);
    const put = await call(c, "PUT", `/admin/roles/${none.body.id}`, { token: c.superToken, org: c.orgES, body: { name: "No steps", scope: "station", permissions: [], repair_steps: ["pdr", "pdr", "remontage"] } });
    expect(put.body.repairSteps).toEqual(["pdr", "remontage"]);
  });
  it("only people with roles.gerer can set them", async () => {
    const r = await call(c, "POST", "/admin/roles", { token: pdrTok, org: c.orgES, body: { name: "Mine", scope: "station", permissions: [], repair_steps: ["pdr"] } });
    expect(r.status).toBe(403);
  });
  it("the phone receives the steps and the moves of the account", async () => {
    const a = (await pull(c, pdrTok, c.orgES)).refs.me.fieldView;
    expect(a.steps).toEqual(["pdr"]); expect(a.moves).toEqual([["pdr", "remontage"]]);
    const b = (await pull(c, remTok, c.orgES)).refs.me.fieldView;
    expect(b.moves).toEqual([["demontage", "pdr"], ["remontage", "bodyshop"]]);
    // a technician role without steps keeps the rule of the record
    const legacy = await inviteAndAccept(c, c.orgES, "legacy@example.test", { role_id: c.roleId.technicien, station_id: A });
    const lid = (await c.h.db.select().from(users).where(eq(users.email, "legacy@example.test")))[0].id;
    await c.h.db.insert(technicians).values({ orgId: c.orgES, name: "Legacy", userId: lid, kind: "pdr" });
    expect((await pull(c, legacy, c.orgES)).refs.me.fieldView).toMatchObject({ steps: [], moves: [["demontage", "pdr"]] });
  });
});

describe("the moves follow the steps of the role", () => {
  it("PDR step only: PDR -> Reassembly after his own PDR photo; nothing else", async () => {
    const id = await car("pdr");
    expect((await move(pdrTok, id, "remontage")).code).toBe("photo_required");
    await photo(pdrTok, id, "pdr");
    expect((await move(pdrTok, id, "bodyshop")).code).toBe("move_not_allowed");
    expect((await move(pdrTok, id, "remontage")).status).toBe("ok");
    expect(await stageOf(id)).toBe("remontage");
    expect((await move(pdrTok, id, "bodyshop")).code).toBe("move_not_allowed"); // Reassembly is not his step
    const d = await car("demontage");
    await photo(pdrTok, d, "demontage");
    expect((await move(pdrTok, d, "pdr")).code).toBe("move_not_allowed"); // the old technician rule does not apply any more
  });
  it("Disassembly and Reassembly steps: Disassembly -> PDR and Reassembly -> At body shop, never PDR -> Reassembly nor Finish", async () => {
    const d = await car("demontage");
    await photo(remTok, d, "demontage");
    expect((await move(remTok, d, "pdr")).status).toBe("ok");
    expect((await move(remTok, d, "remontage")).code).toBe("move_not_allowed");
    const r = await car("remontage");
    expect((await move(remTok, r, "finish")).code).toBe("move_not_allowed");
    expect((await move(remTok, r, "bodyshop")).status).toBe("ok"); // Reassembly needs no photo
  });
  it("the car must be his: PDR steps need the PDR assignment, removal-refit steps the removal assignment (or his name in the split)", async () => {
    const id = await car("pdr");
    await photo(remTok, id, "pdr");
    await call(c, "PUT", `/admin/roles/${remRole}`, { token: c.superToken, org: c.orgES, body: { name: "Removal and refit", scope: "station", permissions: (await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgES })).body.find((r: any) => r.id === remRole).permissions, repair_steps: ["demontage", "pdr", "remontage"] } });
    // he now has the PDR step too but is assigned for removal-refit only, and his name is on the removal part of the split
    expect((await move(remTok, id, "remontage")).code).toBe("not_your_vehicle");
    await call(c, "PUT", `/admin/roles/${remRole}`, { token: c.superToken, org: c.orgES, body: { name: "Removal and refit", scope: "station", permissions: (await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgES })).body.find((r: any) => r.id === remRole).permissions, repair_steps: ["demontage", "remontage"] } });
  });
  it("managers and assessors are not affected by steps", async () => {
    const id = await car("demontage");
    expect((await move(assessor, id, "remontage")).status).toBe("ok");
  });
});

describe("deleting technicians", () => {
  it("a technician record can be deleted (audited); the cars keep the name in their split", async () => {
    const t = (await call(c, "POST", "/admin/technicians", { token: c.superToken, org: c.orgES, body: { name: "To Delete", kind: "pdr" } })).body;
    const car1 = uuid();
    await ok(assessor, [op("vehicle.create", { vehicle: { id: car1, stationId: A, clientStationId: CARRO, header: { land: "ES", kennzeichen: "DEL 1", leistungsdatum: "2026-10-19", stundensatz: 69 }, panels: {}, shares: { techName: "To Delete", techPct: 50 } } })]);
    expect((await call(c, "DELETE", `/admin/technicians/${t.id}`, { token: pdrTok, org: c.orgES })).status).toBe(403);
    expect((await call(c, "DELETE", `/admin/technicians/${t.id}`, { token: c.superToken, org: c.orgES })).status).toBe(200);
    expect((await call(c, "GET", "/admin/technicians", { token: c.superToken, org: c.orgES })).body.some((x: any) => x.id === t.id)).toBe(false);
    expect((await call(c, "DELETE", `/admin/technicians/${t.id}`, { token: c.superToken, org: c.orgES })).status).toBe(404);
    const [v] = await c.h.db.select().from(vehicles).where(eq(vehicles.id, car1));
    expect((v.shares as any).techName).toBe("To Delete");
  });
  it("a technician with appointments in the repair calendar cannot be deleted (deactivate instead)", async () => {
    const t = (await call(c, "POST", "/admin/technicians", { token: c.superToken, org: c.orgES, body: { name: "Busy", kind: "pdr" } })).body;
    const car2 = await car("pdr");
    await c.h.db.insert(repairAppointments).values({ id: uuid(), vehicleId: car2, technicianId: t.id, date: "2026-11-02", durationMin: 60, note: "" });
    const r = await call(c, "DELETE", `/admin/technicians/${t.id}`, { token: c.superToken, org: c.orgES });
    expect(r.status).toBe(409);
    expect(r.body.code ?? r.body.error).toMatch(/technician_in_use|Termine/);
  });
});
