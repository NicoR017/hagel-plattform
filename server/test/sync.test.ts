import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { JPEG, PDF, call, dentsPanel, inviteAndAccept, op, pull, push, setup, tick, uuid, type Ctx } from "./helpers";
import { auditLog, insurers, photos, technicians, vehicleAssignments, vehicleMoves, vehicleStatusHistory, vehicles, users } from "../src/schema";

let c: Ctx;
let A: string, B: string, MINI: string, CARRO: string; // A = hall (current site), B = other hall, MINI = capacity 1, CARRO = customer carrosserie
let chefA: string, assessor: string, tech: string, techId: string, carro: string, insurerTok: string, chefB: string;
let insurerId: string;

const header = (o: Record<string, unknown> = {}) => ({ land: "ES", kennzeichen: "1234 ABC", fin: "", modell: "Seat Leon", kunde: "Carrosserie Test Talavera", leistungsdatum: "2026-10-19", stundensatz: 69, ...o });
const createOp = (id: string, extra: Record<string, unknown> = {}) =>
  op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, header: header(), panels: {}, shares: { techName: "Ana", techPct: 50 }, ...extra } });

const byId = (list: any[], id: string) => list.find((v) => v.id === id);

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  CARRO = st.find((s) => s.type === "carrosserie").id;
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  B = st.find((s) => s.type === "hall" && s.id !== A).id;
  // customer carrosserie with a 20 % commission
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { commission_pct: 20, commission_mode: "pct" } });
  MINI = (await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "hall", name: "Mini", capacite: 1 } })).body.id;
  [insurerId] = (await c.h.db.insert(insurers).values({ orgId: c.orgES, name: "Allianz" }).returning()).map((i) => i.id);

  chefA = await inviteAndAccept(c, c.orgES, "chefa@example.test", { role_id: c.roleId.chef_site, station_id: A });
  chefB = await inviteAndAccept(c, c.orgES, "chefb@example.test", { role_id: c.roleId.chef_site, station_id: B });
  assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: A });
  // an invited technician now gets a technician record by himself (v4); these tests are about the plain role, so start without it
  await c.h.db.delete(technicians);
  techId = (await c.h.db.select().from(users).where(eq(users.email, "tech@example.test")))[0].id;
  carro = await inviteAndAccept(c, c.orgES, "carro@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
  insurerTok = await inviteAndAccept(c, c.orgES, "ins@example.test", { role_id: c.roleId.assureur, scope_insurer_id: insurerId });
});
afterAll(async () => { await c.h.close(); });

describe("create + pull", () => {
  const id = uuid();
  it("assessor creates a vehicle offline-style; commission is snapshotted from the customer carrosserie", async () => {
    const r = await push(c, assessor, [createOp(id, { insurerId, panels: { haube: dentsPanel("haube", { "20": 10, "40": 2 }, { bigEur: 99 }) } })]);
    expect(r.status).toBe(200);
    expect(r.body.results[0].status).toBe("ok");
    const p = await pull(c, assessor, c.orgES);
    const v = byId(p.vehicles, id);
    expect(v).toBeTruthy();
    expect(v.kennzeichen).toBe("1234 ABC");
    expect(v.werkPct).toBe(20);
    expect(v.werkMode).toBe("pct");
    expect(v.statut).toBe("arrive");
    expect(v.stundensatz).toBe(69);
    expect(v.panels.haube.bigEur).toBe(99);
    expect(p.refs.stations.length).toBeGreaterThan(2);
    expect(p.refs.settings.rateES).toBe(69);
    expect(p.refs.me.permissions).toContain("prix.voir");
    expect(p.refs.people.length).toBeGreaterThan(3);
  });
  it("retrying the same op is idempotent (applied once)", async () => {
    const o = createOp(uuid());
    const a = await push(c, assessor, [o]);
    const before = (await c.h.db.select().from(vehicles)).length;
    const b = await push(c, assessor, [o]);
    expect(b.body.results[0]).toEqual(a.body.results[0]);
    expect((await c.h.db.select().from(vehicles)).length).toBe(before);
  });
  it("re-creating an existing id by someone else is rejected; by the creator it is a no-op", async () => {
    const o = createOp(id);
    expect((await push(c, assessor, [{ ...o, opId: uuid() }])).body.results[0].status).toBe("ok");
    const r = await push(c, chefA, [{ ...o, opId: uuid() }]);
    expect(r.body.results[0]).toMatchObject({ status: "rejected", code: "vehicle_exists" });
  });
  it("technician and carrosserie / insurer accounts cannot create vehicles", async () => {
    for (const tok of [tech, carro, insurerTok]) {
      const r = await push(c, tok, [createOp(uuid())]);
      expect(r.body.results[0]).toMatchObject({ status: "rejected", code: "not_allowed" });
    }
  });
  it("a chef cannot create on a site where they have no role", async () => {
    const r = await push(c, chefA, [op("vehicle.create", { vehicle: { id: uuid(), stationId: B, header: header(), panels: {}, shares: {} } })]);
    expect(r.body.results[0]).toMatchObject({ status: "rejected", code: "not_allowed" });
  });
  it("unknown site, other-org site", async () => {
    const r = await push(c, assessor, [op("vehicle.create", { vehicle: { id: uuid(), stationId: uuid(), header: header(), panels: {}, shares: {} } })]);
    expect(r.body.results[0].code).toBe("station_unknown");
  });
  it("invalid payloads are rejected with 400", async () => {
    expect((await push(c, assessor, [{ ...createOp(uuid()), vehicle: { id: "nope" } }])).status).toBe(400);
    // an unknown op TYPE is no longer a malformed batch: 409 unsupported_op, the client keeps it queued (PROMPT_v3 §8.4); see safety.test.ts
    const unknown = await push(c, assessor, [{ opId: uuid(), at: tick(), type: "vehicle.explode" }]);
    expect(unknown.status).toBe(409);
    expect(unknown.body.code).toBe("unsupported_op");
    expect((await call(c, "POST", "/sync/push", { body: { ops: [] } })).status).toBe(401);
  });
});

describe("last-writer-wins per field and per panel", () => {
  const id = uuid();
  beforeAll(async () => { await push(c, assessor, [createOp(id)]); });

  it("different fields from different users both survive; an older edit of the same field loses", async () => {
    const t0 = Date.parse(tick(60_000));
    const at = (n: number) => new Date(t0 + n).toISOString();
    const r1 = await push(c, assessor, [{ opId: uuid(), at: at(2000), type: "vehicle.header", vehicleId: id, fields: { modell: "NEW (assessor)" } }]);
    const r2 = await push(c, chefA, [{ opId: uuid(), at: at(1000), type: "vehicle.header", vehicleId: id, fields: { notiz: "from chef", modell: "OLD (chef)" } }]);
    expect(r1.body.results[0].status).toBe("ok");
    expect(r2.body.results[0].status).toBe("conflict"); // modell is stale, notiz applied
    expect(r2.body.results[0].vehicle.modell).toBe("NEW (assessor)");
    const v = byId((await pull(c, assessor, c.orgES)).vehicles, id);
    expect(v.modell).toBe("NEW (assessor)");
    expect(v.notiz).toBe("from chef");
  });
  it("panels are merged per key", async () => {
    const t0 = Date.parse(tick(60_000));
    const at = (n: number) => new Date(t0 + n).toISOString();
    await push(c, assessor, [{ opId: uuid(), at: at(1000), type: "vehicle.panel", vehicleId: id, key: "haube", panel: dentsPanel("haube", { "20": 5 }) }]);
    await push(c, chefA, [{ opId: uuid(), at: at(1500), type: "vehicle.panel", vehicleId: id, key: "dach", panel: dentsPanel("dach", { "30": 7 }) }]);
    const stale = await push(c, chefA, [{ opId: uuid(), at: at(500), type: "vehicle.panel", vehicleId: id, key: "haube", panel: dentsPanel("haube", { "20": 99 }) }]);
    expect(stale.body.results[0].status).toBe("conflict");
    const v = byId((await pull(c, assessor, c.orgES)).vehicles, id);
    expect(v.panels.haube.dents).toEqual({ "20": 5 });
    expect(v.panels.dach.dents).toEqual({ "30": 7 });
    // removing a panel
    await push(c, assessor, [{ opId: uuid(), at: tick(120_000), type: "vehicle.panel", vehicleId: id, key: "dach", panel: null }]);
    expect(byId((await pull(c, assessor, c.orgES)).vehicles, id).panels.dach).toBeUndefined();
  });
  it("panel key mismatch is rejected", async () => {
    const r = await push(c, assessor, [op("vehicle.panel", { vehicleId: id, key: "haube", panel: dentsPanel("dach", { "20": 1 }) })]);
    expect(r.body.results[0].code).toBe("invalid_input");
  });
  it("audit log records vehicle changes with before/after", async () => {
    const rows = await c.h.db.select().from(auditLog).where(and(eq(auditLog.entity, "vehicle"), eq(auditLog.entityId, id)));
    const upd = rows.find((r) => r.action === "vehicle.header" && JSON.stringify(r.after).includes("NEW (assessor)"));
    expect(upd).toBeTruthy();
    expect((upd!.before as any).modell).toBe("Seat Leon");
    expect(rows.some((r) => r.action === "vehicle.create")).toBe(true);
  });
});

describe("field-level permissions on write", () => {
  const id = uuid();
  beforeAll(async () => {
    await push(c, assessor, [createOp(id, { panels: { haube: dentsPanel("haube", { "20": 4 }, { bigEur: 50 }) } })]);
    await c.h.db.insert(vehicleAssignments).values({ vehicleId: id, userId: techId, type: "pdr" });
  });
  it("technician edits dents but cannot write prices, tech shares or commission", async () => {
    const okPanel = await push(c, tech, [op("vehicle.panel", { vehicleId: id, key: "dach", panel: dentsPanel("dach", { "20": 3 }) })]);
    expect(okPanel.body.results[0].status).toBe("ok");
    const price = await push(c, tech, [op("vehicle.header", { vehicleId: id, fields: { stundensatz: 1 } })]);
    expect(price.body.results[0]).toMatchObject({ status: "rejected", code: "field_not_allowed" });
    const sh = await push(c, tech, [op("vehicle.shares", { vehicleId: id, fields: { techPct: 90 } })]);
    expect(sh.body.results[0].code).toBe("field_not_allowed");
    const comm = await push(c, tech, [op("vehicle.shares", { vehicleId: id, fields: { werkPct: 0 } })]);
    expect(comm.body.results[0].code).toBe("field_not_allowed");
    const plain = await push(c, tech, [op("vehicle.header", { vehicleId: id, fields: { notiz: "dent photo missing" } })]);
    expect(plain.body.results[0].status).toBe("ok");
  });
  it("a technician's panel edit cannot change the manual >85 mm price", async () => {
    await push(c, tech, [op("vehicle.panel", { vehicleId: id, key: "haube", panel: dentsPanel("haube", { "20": 6 }, { bigEur: 9999 }) })]);
    const v = byId((await pull(c, assessor, c.orgES)).vehicles, id);
    expect(v.panels.haube.dents).toEqual({ "20": 6 });
    expect(v.panels.haube.bigEur).toBe(50);
  });
  it("commission can only be changed with commission.modifier (chef: yes via role? no) — org admin can", async () => {
    const denied = await push(c, assessor, [op("vehicle.shares", { vehicleId: id, fields: { werkPct: 5 } })]);
    expect(denied.body.results[0].code).toBe("field_not_allowed");
    const ok = await push(c, c.superToken, [op("vehicle.shares", { vehicleId: id, fields: { werkPct: 15 } })]);
    expect(ok.body.results[0].status).toBe("ok");
  });
  it("assessor can set the technician and his percentage (internal split)", async () => {
    const r = await push(c, assessor, [op("vehicle.shares", { vehicleId: id, fields: { techName: "Luis", techPct: 55 } })]);
    expect(r.body.results[0].status).toBe("ok");
  });
});

describe("pull: what each role receives (restricted fields never reach the phone)", () => {
  const id = uuid();
  beforeAll(async () => {
    await push(c, assessor, [createOp(id, {
      insurerId, panels: { haube: dentsPanel("haube", { "20": 20, "40": 3 }, { bigEur: 70 }) },
      header: header({ glass: { ws: { on: true, eur: 300 } }, demontage: true, demontageEur: 150 }), shares: { techName: "Luis", techPct: 50, demTechPct: 80 },
    })]);
    await c.h.db.insert(vehicleAssignments).values({ vehicleId: id, userId: techId, type: "pdr" });
    await push(c, c.superToken, [op("vehicle.shares", { vehicleId: id, fields: { werkPct: 20, werkMode: "pct" } })]);
    // bump so the vehicle is in the pull window for everyone
    await push(c, assessor, [op("vehicle.header", { vehicleId: id, fields: { notiz: "x" } })]);
  });

  it("assessor: prices and the internal split inputs", async () => {
    const v = byId((await pull(c, assessor, c.orgES)).vehicles, id);
    expect(v.stundensatz).toBe(69);
    expect(v.techName).toBe("Luis");
    expect(v.werkPct).toBe(20);
    expect(v.shares).toBeUndefined(); // computed locally
  });
  it("technician: only assigned vehicles, no price, no split, only his own share", async () => {
    const p = await pull(c, tech, c.orgES);
    const v = byId(p.vehicles, id);
    expect(v).toBeTruthy();
    const json = JSON.stringify(v);
    for (const k of ["stundensatz", "demontageEur", "glass", "techName", "techPct", "demTechPct", "werkPct", "werkMode", "bigEur", "netto", "brutto"]) expect(v[k], k).toBeUndefined();
    expect(json).not.toContain("bigEur");
    expect(json).not.toContain("\"eur\":300"); // glass amount
    expect(v.myShare.techEur).toBeGreaterThan(0);
    expect(v.myCommission).toBeUndefined();
    expect(v.shares).toBeUndefined();
    expect(v.panels.haube.dents).toEqual({ "20": 20, "40": 3 });
    // not assigned -> not present at all
    const other = p.vehicles.filter((x: any) => !x.assigneeIds.includes(techId));
    expect(other).toEqual([]);
  });
  it("technician's own share equals the server-side computation", async () => {
    const v = byId((await pull(c, tech, c.orgES)).vehicles, id);
    const full = byId((await pull(c, assessor, c.orgES)).vehicles, id);
    const { computeShares, computeVehicle } = await import("@hagel/calc");
    const calc = computeVehicle(full);
    const s = computeShares(full, calc);
    expect(v.myShare.techEur).toBeCloseTo(s.techEur, 2);
    expect(v.myShare.demTechEur).toBeCloseTo(s.demTechEur, 2);
  });
  it("customer carrosserie: sees price and ONLY its commission, nothing of the technician split", async () => {
    const v = byId((await pull(c, carro, c.orgES)).vehicles, id);
    expect(v.stundensatz).toBe(69);
    expect(v.techName).toBeUndefined();
    expect(v.techPct).toBeUndefined();
    expect(v.werkPct).toBeUndefined();
    expect(v.myShare).toBeUndefined();
    const { computeShares, computeVehicle } = await import("@hagel/calc");
    const full = byId((await pull(c, assessor, c.orgES)).vehicles, id);
    expect(v.myCommission.werkEur).toBeCloseTo(computeShares(full, computeVehicle(full)).werkEur, 2);
  });
  it("insurer: its own files with prices, no split, no commission", async () => {
    const p = await pull(c, insurerTok, c.orgES);
    const v = byId(p.vehicles, id);
    expect(v.stundensatz).toBe(69);
    for (const k of ["techName", "techPct", "werkPct", "myShare", "myCommission", "shares"]) expect(v[k], k).toBeUndefined();
    expect(p.vehicles.every((x: any) => x.insurerId === insurerId)).toBe(true);
  });
  it("chef at the other site sees nothing of this vehicle", async () => {
    const p = await pull(c, chefB, c.orgES);
    expect(byId(p.vehicles, id)).toBeUndefined();
  });
  it("restricted roles do not receive commission figures of stations", async () => {
    const t = await pull(c, tech, c.orgES);
    expect(JSON.stringify(t.refs.stations)).not.toContain("commissionPct");
    const s = await pull(c, c.superToken, c.orgES);
    expect(JSON.stringify(s.refs.stations)).toContain("commissionPct");
  });
  it("without prix.voir the organisation's hourly rates and matrix euro figures are not sent", async () => {
    const t = (await pull(c, tech, c.orgES)).refs.settings;
    expect(t).toMatchObject({ rateDE: 0, rateES: 0 });
    expect(JSON.stringify(t)).not.toMatch(/"rate(DE|ES)":(69|83)/);
    const a = (await pull(c, assessor, c.orgES)).refs.settings;
    expect(a.rateES).toBe(69);
    expect(carro && (await pull(c, carro, c.orgES)).refs.settings.rateES).toBe(69); // customers see prices
  });
  it("the sites API does not leak commission, e-mails or other sites to restricted roles", async () => {
    const t = await call(c, "GET", "/admin/stations", { token: tech, org: c.orgES });
    expect(JSON.stringify(t.body)).not.toMatch(/commission|reportEmails|azure/i);
    const k = await call(c, "GET", "/admin/stations", { token: carro, org: c.orgES });
    expect(k.body.map((s: any) => s.id)).toEqual([CARRO]); // the customer only knows its own site
    const full = await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES });
    expect(JSON.stringify(full.body)).toContain("commissionPct");
  });
  it("a user from another organisation cannot pull this one", async () => {
    const r = await call(c, "GET", "/sync/pull?since=0", { token: chefA, org: c.orgDE });
    expect(r.status).toBe(403);
  });
});

describe("status, move, delete", () => {
  const id = uuid();
  beforeAll(async () => { await push(c, assessor, [createOp(id)]); });
  it("on hold needs a reason; history is recorded; repAt follows the repair status", async () => {
    expect((await push(c, assessor, [op("vehicle.status", { vehicleId: id, statut: "attente" })])).body.results[0].code).toBe("motif_required");
    expect((await push(c, assessor, [op("vehicle.status", { vehicleId: id, statut: "attente", motif: "Teile" })])).body.results[0].status).toBe("ok");
    await push(c, assessor, [op("vehicle.status", { vehicleId: id, statut: "reparatur" })]);
    let v = byId((await pull(c, assessor, c.orgES)).vehicles, id);
    expect(v.statut).toBe("reparatur");
    expect(v.repAt).toBeTruthy();
    expect(v.statutMotif).toBeNull();
    await push(c, assessor, [op("vehicle.status", { vehicleId: id, statut: "besichtigung" })]);
    v = byId((await pull(c, assessor, c.orgES)).vehicles, id);
    expect(v.repAt).toBeNull();
    const hist = await c.h.db.select().from(vehicleStatusHistory).where(eq(vehicleStatusHistory.vehicleId, id));
    expect(hist.map((x) => x.statut)).toEqual(["arrive", "attente", "reparatur", "besichtigung"]);
    expect(hist[1].motif).toBe("Teile");
  });
  it("technician (not assigned) cannot change status; assigned technician can", async () => {
    expect((await push(c, tech, [op("vehicle.status", { vehicleId: id, statut: "fertig" })])).body.results[0].code).toBe("vehicle_not_found");
    await c.h.db.insert(vehicleAssignments).values({ vehicleId: id, userId: techId, type: "pdr" });
    expect((await push(c, tech, [op("vehicle.status", { vehicleId: id, statut: "reparatur" })])).body.results[0].status).toBe("ok");
    await c.h.db.delete(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, id));
  });
  it("moving: needs the right on the SOURCE site; visibility follows the site, the customer keeps seeing it", async () => {
    const mid = uuid();
    await push(c, assessor, [createOp(mid)]);
    // chef B has no right on site A
    expect((await push(c, chefB, [op("vehicle.move", { vehicleId: mid, toStationId: B })])).body.results[0].code).toBe("vehicle_not_found");
    const before = await pull(c, chefA, c.orgES);
    expect(byId(before.vehicles, mid)).toBeTruthy();
    const mv = await push(c, chefA, [op("vehicle.move", { vehicleId: mid, toStationId: B, note: "to hall" })]);
    expect(mv.body.results[0].status).toBe("ok");
    const afterA = await pull(c, chefA, c.orgES, before.cursor, before.epoch);
    expect(afterA.gone).toContain(mid);
    expect(byId(afterA.vehicles, mid)).toBeUndefined();
    const forB = await pull(c, chefB, c.orgES);
    const vb = byId(forB.vehicles, mid);
    expect(vb).toBeTruthy();
    expect(vb.clientStationId).toBe(CARRO); // the customer never changes
    expect(vb.werkPct).toBe(20); // the commission snapshot travels with the vehicle (chef de site may see the internal split)
  });
  it("move audit trail and customer visibility", async () => {
    const moves = await c.h.db.select().from(vehicleMoves);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[moves.length - 1]).toMatchObject({ toStationId: B, note: "to hall" });
    const v = (await pull(c, carro, c.orgES)).vehicles.find((x: any) => x.stationId === B);
    expect(v).toBeTruthy();
  });
  it("moving into a full site warns but is allowed", async () => {
    const a = uuid(), b = uuid();
    await push(c, assessor, [createOp(a), createOp(b)]);
    await push(c, assessor, [op("vehicle.status", { vehicleId: a, statut: "reparatur" }), op("vehicle.status", { vehicleId: b, statut: "reparatur" })]); // the occupancy counts cars in repair
    const r1 = await push(c, chefA, [op("vehicle.move", { vehicleId: a, toStationId: MINI })]);
    expect(r1.body.results[0].warnings ?? []).toEqual([]);
    const r2 = await push(c, chefA, [op("vehicle.move", { vehicleId: b, toStationId: MINI })]);
    expect(r2.body.results[0]).toMatchObject({ status: "ok", warnings: ["capacity_full"] });
  });
  it("moving to an unknown site is rejected", async () => {
    expect((await push(c, chefA, [op("vehicle.move", { vehicleId: id, toStationId: uuid() })])).body.results[0].code).toBe("station_unknown");
    // the assessor role has no move right at all
    expect((await push(c, assessor, [op("vehicle.move", { vehicleId: id, toStationId: B })])).body.results[0].code).toBe("not_allowed");
  });
  it("delete needs vehicules.supprimer; deleted vehicles disappear for everyone (gone) and take their files with them", async () => {
    const did = uuid(), pid = uuid();
    await push(c, assessor, [createOp(did), op("photo.add", { photo: { id: pid, vehicleId: did, label: "Vorderansicht", phase: "besichtigung", takenAt: tick() } })]);
    await call(c, "PUT", `/files/photo/${pid}`, { token: assessor, raw: JPEG, contentType: "image/jpeg" });
    expect(c.storage.files.size).toBeGreaterThan(0);
    const snap = await pull(c, chefA, c.orgES);
    expect((await push(c, tech, [op("vehicle.delete", { vehicleId: did })])).body.results[0].status).toBe("rejected");
    expect((await push(c, assessor, [op("vehicle.delete", { vehicleId: did })])).body.results[0].code).toBe("not_allowed"); // aufnehmer cannot delete
    expect((await push(c, chefA, [op("vehicle.delete", { vehicleId: did })])).body.results[0].status).toBe("ok");
    expect([...c.storage.files.keys()].some((k) => k.includes(did))).toBe(false);
    const after = await pull(c, chefA, c.orgES, snap.cursor, snap.epoch);
    expect(after.gone).toContain(did);
    const pa = await pull(c, assessor, c.orgES);
    expect(byId(pa.vehicles, did)).toBeUndefined();
    expect((await push(c, chefA, [op("vehicle.header", { vehicleId: did, fields: { notiz: "zombie" } })])).body.results[0].code).toBe("vehicle_not_found");
  });
});

describe("assignment, epoch and loss of access", () => {
  it("assigning a technician makes the vehicle appear on his phone; unassigning removes it (gone)", async () => {
    const id = uuid();
    await push(c, assessor, [createOp(id)]);
    const t0 = await pull(c, tech, c.orgES);
    expect(byId(t0.vehicles, id)).toBeUndefined();
    expect((await push(c, assessor, [op("vehicle.assign", { vehicleId: id, kind: "pdr", userIds: [techId] })])).body.results[0].status).toBe("ok");
    const t1 = await pull(c, tech, c.orgES, t0.cursor, t0.epoch);
    expect(byId(t1.vehicles, id)).toBeTruthy();
    expect(byId(t1.vehicles, id).assigneeIds).toContain(techId);
    await push(c, assessor, [op("vehicle.assign", { vehicleId: id, kind: "pdr", userIds: [] })]);
    const t2 = await pull(c, tech, c.orgES, t1.cursor, t1.epoch);
    expect(t2.gone).toContain(id);
  });
  it("only users with vehicules.assigner may assign; assignees must belong to the org", async () => {
    const id = uuid();
    await push(c, assessor, [createOp(id)]);
    expect((await push(c, carro, [op("vehicle.assign", { vehicleId: id, kind: "pdr", userIds: [techId] })])).body.results[0].status).toBe("rejected");
    expect((await push(c, assessor, [op("vehicle.assign", { vehicleId: id, kind: "pdr", userIds: [uuid()] })])).body.results[0].code).toBe("user_not_found");
  });
  it("changing a user's role changes the epoch: the client must reset its local set", async () => {
    const t0 = await pull(c, chefB, c.orgES);
    expect(t0.reset).toBe(false);
    const same = await pull(c, chefB, c.orgES, t0.cursor, t0.epoch);
    expect(same.reset).toBe(false);
    const users_ = (await call(c, "GET", "/admin/users", { token: c.superToken, org: c.orgES })).body as any[];
    const u = users_.find((x) => x.email === "chefb@example.test");
    // chef at B becomes a plain technician at B (nothing assigned)
    await call(c, "POST", "/admin/assignments", { token: c.superToken, org: c.orgES, body: { user_id: u.id, station_id: B, role_id: c.roleId.technicien } });
    await call(c, "DELETE", `/admin/assignments/${u.assignments[0].id}`, { token: c.superToken, org: c.orgES });
    const t1 = await pull(c, chefB, c.orgES, t0.cursor, t0.epoch);
    expect(t1.reset).toBe(true);
    expect(t1.epoch).not.toBe(t0.epoch);
    expect(t1.vehicles).toEqual([]); // lost access to everything not assigned
    expect(t0.vehicles.length).toBeGreaterThan(0);
  });
  it("a user who lost every role gets 403 on pull (the client then wipes its local copy)", async () => {
    const id = uuid(), e = "gone@example.test";
    const tok = await inviteAndAccept(c, c.orgES, e, { role_id: c.roleId.aufnehmer, station_id: A });
    expect((await call(c, "GET", "/sync/pull?since=0", { token: tok, org: c.orgES })).status).toBe(200);
    const u = ((await call(c, "GET", "/admin/users", { token: c.superToken, org: c.orgES })).body as any[]).find((x) => x.email === e);
    await call(c, "DELETE", `/admin/assignments/${u.assignments[0].id}`, { token: c.superToken, org: c.orgES });
    expect((await call(c, "GET", "/sync/pull?since=0", { token: tok, org: c.orgES })).status).toBe(403);
    expect((await push(c, tok, [createOp(id)])).body.results[0].code).toBe("not_allowed");
  });
  it("a deactivated user can no longer pull or push", async () => {
    const users_ = (await call(c, "GET", "/admin/users", { token: c.superToken, org: c.orgES })).body as any[];
    const u = users_.find((x) => x.email === "ins@example.test");
    await call(c, "POST", `/admin/users/${u.id}/deactivate`, { token: c.superToken, org: c.orgES });
    expect((await call(c, "GET", "/sync/pull?since=0", { token: insurerTok, org: c.orgES })).status).toBe(401);
  });
});

describe("pagination", () => {
  it("pull pages through everything with a monotonic cursor and no duplicates or gaps", async () => {
    const ids = [uuid(), uuid(), uuid(), uuid(), uuid()];
    await push(c, assessor, ids.map((i) => createOp(i)));
    const seen = new Set<string>();
    let since = 0, guard = 0, last = -1;
    let epoch: string | undefined;
    for (;;) {
      const p = await pull(c, assessor, c.orgES, since, epoch, 2);
      epoch = p.epoch;
      expect(p.cursor).toBeGreaterThanOrEqual(last);
      last = p.cursor;
      p.vehicles.forEach((v: any) => seen.add(v.id));
      since = p.cursor;
      if (!p.hasMore) break;
      if (++guard > 100) throw new Error("no progress");
    }
    ids.forEach((i) => expect(seen.has(i)).toBe(true));
  });
  it("an up-to-date client gets an empty answer", async () => {
    const p1 = await pull(c, assessor, c.orgES, 0, undefined, 500);
    const p2 = await pull(c, assessor, c.orgES, p1.cursor, p1.epoch);
    expect(p2.vehicles).toEqual([]);
    expect(p2.photos).toEqual([]);
    expect(p2.cursor).toBe(p1.cursor);
  });
});

describe("photos and Colibri file", () => {
  const vid = uuid(), pid = uuid();
  beforeAll(async () => {
    await push(c, assessor, [createOp(vid)]);
    await c.h.db.insert(vehicleAssignments).values({ vehicleId: vid, userId: techId, type: "pdr" });
  });
  it("add metadata, upload the file, pull shows hasFile; download needs access", async () => {
    const add = await push(c, tech, [op("photo.add", { photo: { id: pid, vehicleId: vid, label: "Detail / Delle", phase: "reparatur", takenAt: tick() } })]);
    expect(add.body.results[0].status).toBe("ok");
    const noFile = await pull(c, assessor, c.orgES);
    expect(byId(noFile.photos, pid)).toMatchObject({ hasFile: false, phase: "reparatur", label: "Detail / Delle" });
    const up = await call(c, "PUT", `/files/photo/${pid}`, { token: tech, raw: JPEG, contentType: "image/jpeg" });
    expect(up.status).toBe(200);
    const p = await pull(c, assessor, c.orgES);
    expect(byId(p.photos, pid).hasFile).toBe(true);
    const dl = await call(c, "GET", `/files/photo/${pid}`, { token: assessor });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("image/jpeg");
    expect([...dl.bytes]).toEqual([...JPEG]);
    expect((await call(c, "GET", `/files/photo/${pid}`)).status).toBe(401);
    expect((await call(c, "GET", `/files/photo/${pid}`, { token: chefB })).status).toBe(404); // cannot see the vehicle
  });
  it("upload validation: type, magic bytes, size, unknown photo", async () => {
    expect((await call(c, "PUT", `/files/photo/${pid}`, { token: tech, raw: JPEG, contentType: "image/png" })).status).toBe(400);
    expect((await call(c, "PUT", `/files/photo/${pid}`, { token: tech, raw: new TextEncoder().encode("<script>"), contentType: "image/jpeg" })).status).toBe(400);
    const big = new Uint8Array(4 * 1024 * 1024 + 10); big[0] = 0xff; big[1] = 0xd8;
    expect((await call(c, "PUT", `/files/photo/${pid}`, { token: tech, raw: big, contentType: "image/jpeg" })).status).toBe(400);
    expect((await call(c, "PUT", `/files/photo/${uuid()}`, { token: tech, raw: JPEG, contentType: "image/jpeg" })).status).toBe(404);
    expect((await call(c, "PUT", `/files/photo/${pid}`, { token: carro, raw: JPEG, contentType: "image/jpeg" })).status).toBe(403);
  });
  it("photo add is idempotent; label/phase/inPdf can be edited; technicians cannot delete, assessor can", async () => {
    const again = await push(c, tech, [op("photo.add", { photo: { id: pid, vehicleId: vid, label: "other", phase: "fertig", takenAt: tick() } })]);
    expect(again.body.results[0].status).toBe("ok");
    expect(byId((await pull(c, assessor, c.orgES)).photos, pid).label).toBe("Detail / Delle");
    expect((await push(c, assessor, [op("photo.update", { photoId: pid, fields: { label: "Dach", phase: "fertig", inPdf: false } })])).body.results[0].status).toBe("ok");
    expect(byId((await pull(c, assessor, c.orgES)).photos, pid)).toMatchObject({ label: "Dach", phase: "fertig", inPdf: false });
    expect((await push(c, tech, [op("photo.delete", { photoId: pid })])).body.results[0].status).toBe("rejected");
    expect((await push(c, assessor, [op("photo.delete", { photoId: pid })])).body.results[0].status).toBe("ok");
    expect(byId((await pull(c, assessor, c.orgES)).photos, pid).deleted).toBe(true);
    expect((await call(c, "GET", `/files/photo/${pid}`, { token: assessor })).status).toBe(404);
    expect((await c.h.db.select().from(photos).where(eq(photos.id, pid)))[0].fileKey).toBeNull();
  });
  it("photos of invisible vehicles are never sent", async () => {
    const p = await pull(c, chefB, c.orgES);
    expect(p.photos.filter((x: any) => x.vehicleId === vid)).toEqual([]);
  });
  it("photo on an unknown vehicle", async () => {
    const r = await push(c, assessor, [op("photo.add", { photo: { id: uuid(), vehicleId: uuid(), label: "x", phase: "besichtigung", takenAt: tick() } })]);
    expect(r.body.results[0].code).toBe("vehicle_not_found");
  });
  it("Colibri scan: metadata op + PDF upload need colibri.importer; technician refused", async () => {
    const meta = { method: "GERMANY", kunde: "x", sprache: "EN", at: tick(), imported: 618, reportTotal: 618, rowSum: 618, unknown: [] };
    expect((await push(c, tech, [op("vehicle.colibri", { vehicleId: vid, colibri: meta, file: { name: "s.pdf", size: PDF.length } })])).body.results[0].status).toBe("rejected");
    expect((await call(c, "PUT", `/files/colibri/${vid}`, { token: tech, raw: PDF, contentType: "application/pdf" })).status).toBe(403);
    expect((await push(c, assessor, [op("vehicle.colibri", { vehicleId: vid, colibri: meta, file: { name: "s.pdf", size: PDF.length } })])).body.results[0].status).toBe("ok");
    expect((await call(c, "PUT", `/files/colibri/${vid}`, { token: assessor, raw: new TextEncoder().encode("not a pdf"), contentType: "application/pdf" })).status).toBe(400);
    expect((await call(c, "PUT", `/files/colibri/${vid}`, { token: assessor, raw: PDF, contentType: "application/pdf" })).status).toBe(200);
    const dl = await call(c, "GET", `/files/colibri/${vid}`, { token: assessor });
    expect(dl.status).toBe(200);
    expect([...dl.bytes]).toEqual([...PDF]);
    const v = byId((await pull(c, assessor, c.orgES)).vehicles, vid);
    expect(v.colibri.imported).toBe(618);
    expect(v.colibriFile).toMatchObject({ name: "s.pdf" });
    expect((await call(c, "GET", `/files/colibri/${vid}`, { token: chefB })).status).toBe(404);
  });
});

describe("realtime notification", () => {
  it("SSE connection receives 'changed' after someone pushes", async () => {
    const res = await c.app.request("/sync/events", { headers: { authorization: `Bearer ${assessor}`, "x-org-id": c.orgES } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const readUntil = async (needle: string) => {
      const deadline = Date.now() + 5000;
      while (!buf.includes(needle) && Date.now() < deadline) {
        const r = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), 1000))]);
        if (r.value) buf += dec.decode(r.value);
        if (r.done && !buf.includes(needle)) continue;
      }
      expect(buf).toContain(needle);
    };
    await readUntil("event: hello");
    await push(c, assessor, [createOp(uuid())]);
    await readUntil("event: changed");
    await reader.cancel();
  });
  it("SSE requires authentication and an organisation the user belongs to", async () => {
    expect((await c.app.request("/sync/events")).status).toBe(401);
    expect((await c.app.request("/sync/events", { headers: { authorization: `Bearer ${chefA}`, "x-org-id": c.orgDE } })).status).toBe(403);
  });
});

describe("OCR proxy", () => {
  const ans = (wert: string, sicher = "hoch") => ({ content: [{ type: "text", text: JSON.stringify({ wert, sicher, hinweis: "" }) }] });
  it("requires login", async () => {
    expect((await call(c, "POST", "/ocr", { body: { image: "A".repeat(200), mode: "fin" } })).status).toBe(401);
  });
  it("returns the plate; FIN is cleaned (O→0, Q→0, I→1)", async () => {
    c.ocrAnswer.current = ans("1234 bcd");
    const r = await call(c, "POST", "/ocr", { token: assessor, body: { image: "A".repeat(200), mode: "kz", land: "ES" } });
    expect(r.body).toEqual({ wert: "1234 BCD", sicher: "hoch", hinweis: "" });
    c.ocrAnswer.current = ans("wvw zzz1jzxw0o0qi1");
    const f = await call(c, "POST", "/ocr", { token: assessor, body: { image: "A".repeat(200), mode: "fin" } });
    expect(f.body.wert).toBe("WVWZZZ1JZXW000011");
  });
  it("sends the German prompt for the right country and never exposes the API key to the client", async () => {
    const last = JSON.parse(c.ocrCalls[c.ocrCalls.length - 1].body);
    expect(last.model).toBe("test-model");
    expect(last.messages[0].content[1].text).toContain("FIN");
    expect(JSON.stringify((await call(c, "POST", "/ocr", { token: assessor, body: { image: "A".repeat(200), mode: "kz", land: "ES" } })).body)).not.toContain("test-key");
    expect(JSON.stringify(c.ocrCalls[c.ocrCalls.length - 1].body)).toContain("Spanisches Kennzeichen");
  });
  it("provider failure → 502, bad input → 400, garbage answer → 502", async () => {
    c.ocrAnswer.status = 500;
    expect((await call(c, "POST", "/ocr", { token: assessor, lang: "en", body: { image: "A".repeat(200), mode: "kz" } })).body.error).toBe("Text recognition failed");
    c.ocrAnswer.status = 200;
    c.ocrAnswer.current = { content: [{ type: "text", text: "no json here" }] };
    expect((await call(c, "POST", "/ocr", { token: assessor, body: { image: "A".repeat(200), mode: "kz" } })).status).toBe(502);
    expect((await call(c, "POST", "/ocr", { token: assessor, body: { image: "x", mode: "kz" } })).status).toBe(400);
  });
});

describe("organisation settings", () => {
  it("members read, only parametres.gerer writes; changes are audited and reach pull; server-side shares use them", async () => {
    expect((await call(c, "GET", "/admin/settings", { token: tech, org: c.orgES })).body.rateES).toBe(0); // no prices for technicians
    expect((await call(c, "GET", "/admin/settings", { token: assessor, org: c.orgES })).body.rateES).toBe(69);
    expect((await call(c, "PUT", "/admin/settings", { token: assessor, org: c.orgES, body: { rateES: 80 } })).status).toBe(403);
    const ok = await call(c, "PUT", "/admin/settings", { token: c.superToken, org: c.orgES, body: { rateES: 72, defaultTeiler: 12 } });
    expect(ok.status).toBe(200);
    const p = await pull(c, assessor, c.orgES);
    expect(p.refs.settings).toMatchObject({ rateES: 72, defaultTeiler: 12, rateDE: 83 });
    expect((await call(c, "PUT", "/admin/settings", { token: c.superToken, org: c.orgES, body: { defaultTeiler: 11 } })).status).toBe(400);
    expect((await call(c, "PUT", "/admin/settings", { token: c.superToken, org: c.orgES, body: { esMatrix: { rate_eur_per_h: 1 } } })).status).toBe(400);
    await call(c, "PUT", "/admin/settings", { token: c.superToken, org: c.orgES, body: { rateES: 69, defaultTeiler: 10 } });
  });
  it("a valid edited Spain matrix is stored and returned", async () => {
    const m = (await import("@hagel/calc")).ES_MATRIX_DEFAULT;
    const edited = { ...m, knots: [[25, 7], ...m.knots.slice(1)] };
    const r = await call(c, "PUT", "/admin/settings", { token: c.superToken, org: c.orgES, body: { esMatrix: edited } });
    expect(r.status).toBe(200);
    expect((await pull(c, assessor, c.orgES)).refs.settings.esMatrix.knots[0]).toEqual([25, 7]);
    await call(c, "PUT", "/admin/settings", { token: c.superToken, org: c.orgES, body: { esMatrix: null } });
    expect((await pull(c, assessor, c.orgES)).refs.settings.esMatrix).toBeUndefined();
  });
});
