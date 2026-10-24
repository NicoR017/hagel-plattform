// UI v3, phase 2: calculation methods (frozen versions), repair board rules, comments, technician planning, repair calendar, recipients.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { PERMISSIONS, SYSTEM_ROLES } from "@hagel/shared";
import { buildReport } from "../src/scripts/integrity";
import { bookableDay, runDueBookings, todayIn } from "../src/repair";
import { recipientsFor } from "../src/reports";
import { calcMethods, insurerMethods, insurers, photos, repairBookings, repairEvents, reportSends, stations, technicians, users, vehicleStatusHistory, vehicles } from "../src/schema";
import { JPEG, call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx;
let A: string, B: string, CARRO: string; // A = hall (current place), B = another hall, CARRO = carrosserie (customer only)
let assessor: string, chefA: string, tech: string, carro: string, insurerTok: string, techUserId: string, techRowId: string, insurerId: string;

const hdr = (o: Record<string, unknown> = {}) => ({ land: "ES", kennzeichen: "1234 ABC", modell: "Seat Leon", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69, ...o });
const panels = () => ({ haube: dentsPanel("haube", { "20": 12, "30": 6 }) });
const create = (id: string, extra: Record<string, unknown> = {}, header: Record<string, unknown> = {}) =>
  op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, header: hdr(header), panels: panels(), shares: {}, statut: "besichtigung", ...extra } });
const ok = async (token: string, ops: unknown[]) => {
  const r = await push(c, token, ops);
  expect(r.status).toBe(200);
  return r.body.results as { status: string; code?: string; message?: string }[];
};
const one = async (token: string, o: unknown) => (await ok(token, [o]))[0];
const vrow = async (id: string) => (await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0];
const pulled = async (token: string, id: string) => ((await pull(c, token, c.orgES)).vehicles as any[]).find((v) => v.id === id);
const newVehicle = async (extra: Record<string, unknown> = {}, header: Record<string, unknown> = {}) => { const id = uuid(); expect((await one(assessor, create(id, extra, header))).status).toBe("ok"); return id; };

/** n-th working day after today (Mo-Fr) */
function workday(n: number): string {
  const d = new Date(todayIn("Europe/Madrid") + "T12:00:00Z");
  for (let k = 0; k < n; ) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) k++; }
  return d.toISOString().slice(0, 10);
}
const book = (vehicleId: string, date: string, extra: Record<string, unknown> = {}) =>
  op("booking.create", { vehicleId, booking: { id: uuid(), date, time: "08:30", phone: "+34 612 345 678", email: "kunde@example.test", ...extra } });

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  CARRO = st.find((s) => s.type === "carrosserie").id;
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  B = st.find((s) => s.type === "hall" && s.name !== "Nave Test A").id;
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { commission_pct: 10, report_emails: ["taller@example.test"] } });
  await call(c, "PUT", `/admin/stations/${A}`, { token: c.superToken, org: c.orgES, body: { repairs_per_day: 2 } });
  [insurerId] = (await c.h.db.insert(insurers).values({ orgId: c.orgES, name: "Allianz", reportEmails: ["siniestros@allianz.test"], sendReports: true, reportsToSend: "both" }).returning()).map((i) => i.id);
  assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  chefA = await inviteAndAccept(c, c.orgES, "chefa@example.test", { role_id: c.roleId.chef_site, station_id: A });
  tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: A });
  techUserId = (await c.h.db.select().from(users).where(eq(users.email, "tech@example.test")))[0].id;
  await c.h.db.delete(technicians); // the invitation created a record of its own
  techRowId = (await c.h.db.insert(technicians).values({ orgId: c.orgES, name: "Test Tech", userId: techUserId, kind: "pdr" }).returning())[0].id;
  carro = await inviteAndAccept(c, c.orgES, "carro@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
  insurerTok = await inviteAndAccept(c, c.orgES, "ins@example.test", { role_id: c.roleId.assureur, scope_insurer_id: insurerId });
});
afterAll(async () => { await c.h.close(); });

describe("permissions", () => {
  it("every new permission exists and the default roles carry them as designed", () => {
    for (const p of ["reparatur.board", "reparatur.endabnahme", "termine.buchen", "methoden.gerer", "wochenbericht.voir", "kommentare.schreiben"]) expect(PERMISSIONS).toContain(p);
    const has = (k: string, p: string) => (SYSTEM_ROLES.find((r) => r.key === k)!.permissions as string[]).includes(p);
    expect(has("org_admin", "reparatur.endabnahme")).toBe(true);
    expect(has("chef_site", "reparatur.endabnahme")).toBe(true);
    expect(has("chef_site", "methoden.gerer")).toBe(false);
    expect(has("aufnehmer", "termine.buchen")).toBe(true);
    expect(has("aufnehmer", "reparatur.endabnahme")).toBe(false);
    expect(has("technicien", "reparatur.board")).toBe(true);
    expect(has("technicien", "reparatur.endabnahme")).toBe(false);
    expect(has("technicien", "methoden.gerer")).toBe(false);
    for (const k of ["carrosserie", "assureur"]) for (const p of ["reparatur.board", "termine.buchen", "kommentare.schreiben", "reparatur.endabnahme"]) expect(has(k, p)).toBe(false);
  });
  it("the roles seeded for the test organisations got them (same defaults as new organisations)", async () => {
    const p = await pull(c, tech, c.orgES);
    expect(p.refs.me.permissions).toEqual(expect.arrayContaining(["reparatur.board", "termine.buchen", "kommentare.schreiben"]));
    expect(p.refs.me.permissions).not.toContain("reparatur.endabnahme");
  });
});

describe("calculation methods: frozen versions", () => {
  it("each organisation has its two system methods; a new vehicle is frozen on the system method of its country (version 1)", async () => {
    const ms = await c.h.db.select().from(calcMethods).where(eq(calcMethods.orgId, c.orgES));
    expect(ms.filter((m) => m.isSystem).map((m) => m.country).sort()).toEqual(["DE", "ES"]);
    const id = await newVehicle();
    const row = await vrow(id), sys = ms.find((m) => m.isSystem && m.country === "ES")!;
    expect(row.methodId).toBe(sys.id);
    expect(row.methodVersion).toBe(1);
    expect((await pulled(assessor, id)).methodId).toBe(sys.id);
  });

  it("editing the Spain matrix (old price settings) makes a NEW version: the amounts of existing vehicles do not change, new ones use it", async () => {
    const id = await newVehicle({}, { kennzeichen: "OLD 1" });
    const before = await buildReport(c.h.db);
    const m = (await call(c, "GET", "/admin/settings", { token: c.superToken, org: c.orgES })).body.esMatrix ?? null;
    const base = JSON.parse(JSON.stringify(m ?? (await import("@hagel/calc")).ES_MATRIX_DEFAULT));
    base.knots = base.knots.map(([b, h]: number[]) => [b, h + 3]); // more hours for the same bollos
    expect((await call(c, "PUT", "/admin/settings", { token: c.superToken, org: c.orgES, body: { esMatrix: base } })).status).toBe(200);
    const sys = (await c.h.db.select().from(calcMethods).where(and(eq(calcMethods.orgId, c.orgES), eq(calcMethods.country, "ES"), eq(calcMethods.isSystem, true))))[0];
    expect(sys.currentVersion).toBe(2);
    const after = await buildReport(c.h.db);
    const es = (r: typeof before) => (r.stable.perOrg as Record<string, { netTotal: number }>)["PDR Team Spain"].netTotal;
    expect(es(after)).toBe(es(before)); // frozen on version 1: nothing moved
    const fresh = await newVehicle({}, { kennzeichen: "NEW 1" });
    expect((await vrow(fresh)).methodVersion).toBe(2);
    expect((await vrow(id)).methodVersion).toBe(1);
    const again = await buildReport(c.h.db);
    expect(es(again)).toBeGreaterThan(es(before)); // the new vehicle costs more with the new matrix
  });

  it("a method can be copied, edited (= new version), mapped to an insurer; system methods are locked; archived ones fall back", async () => {
    const sys = (await c.h.db.select().from(calcMethods).where(and(eq(calcMethods.orgId, c.orgES), eq(calcMethods.country, "ES"), eq(calcMethods.isSystem, true))))[0];
    const list = (await call(c, "GET", "/admin/methods", { token: c.superToken, org: c.orgES })).body as any[];
    const sysC = list.find((m) => m.id === sys.id);
    expect(Object.keys(sysC.versions)).toEqual(["1", "2"]);
    const params = sysC.versions["2"];
    expect((await call(c, "PUT", `/admin/methods/${sys.id}`, { token: c.superToken, org: c.orgES, body: { name: "x" } })).status).toBe(409);
    const created = await call(c, "POST", "/admin/methods", { token: c.superToken, org: c.orgES, body: { name: "Matriz aseguradora", engine: "matrix", country: "ES", params, base_method_id: sys.id } });
    expect(created.status).toBe(201);
    const mid = created.body.id as string;
    // wrong engine for the country / invalid parameters are refused
    expect((await call(c, "POST", "/admin/methods", { token: c.superToken, org: c.orgES, body: { name: "bad", engine: "aw", country: "ES", params: {} } })).status).toBe(400);
    const edited = await call(c, "PUT", `/admin/methods/${mid}`, { token: c.superToken, org: c.orgES, body: { params } });
    expect(edited.body.currentVersion).toBe(2);
    expect((await call(c, "PUT", `/admin/insurers/${insurerId}/methods`, { token: c.superToken, org: c.orgES, body: { ES: mid, DE: null } })).status).toBe(200);
    expect((await c.h.db.select().from(insurerMethods)).length).toBe(1);
    // a vehicle of that insurer is frozen on the insurer's method (current version)
    const id = await newVehicle({ insurerId }, { kennzeichen: "INS 1" });
    expect(await vrow(id)).toMatchObject({ methodId: mid, methodVersion: 2 });
    // the refs carry every version, so the phone can keep computing with the frozen one
    const refs = (await pull(c, assessor, c.orgES)).refs;
    expect(refs.methods.find((m: any) => m.id === mid).versions).toHaveProperty("1");
    expect(refs.insurerMethods).toEqual([{ insurerId, country: "ES", methodId: mid }]);
    // archive: insurers fall back to the system method, the vehicle keeps its frozen version
    expect((await call(c, "POST", `/admin/methods/${mid}/archive`, { token: c.superToken, org: c.orgES })).status).toBe(200);
    expect((await c.h.db.select().from(insurerMethods)).length).toBe(0);
    expect((await vrow(id)).methodId).toBe(mid);
    const usage = await call(c, "GET", `/admin/methods/${mid}/usage`, { token: c.superToken, org: c.orgES });
    expect(usage.body.vehiclesByVersion["2"]).toBe(1);
    // roles without methoden.gerer cannot see the admin API
    expect((await call(c, "GET", "/admin/methods", { token: assessor, org: c.orgES })).status).toBe(403);
  });

  it("changing the method of a vehicle needs a privilege, and is impossible once the vehicle has been measured", async () => {
    const sys = (await c.h.db.select().from(calcMethods).where(and(eq(calcMethods.orgId, c.orgES), eq(calcMethods.country, "ES"), eq(calcMethods.isSystem, true))))[0];
    const m = (await call(c, "POST", "/admin/methods", { token: c.superToken, org: c.orgES, body: { name: "Alt", engine: "matrix", country: "ES", params: { esMatrix: null } } })).body.id as string;
    const empty = await newVehicle({ panels: {} }, { kennzeichen: "EMPTY 1" });
    const set = (vid: string, tok: string, methodId: string) => one(tok, op("vehicle.header", { vehicleId: vid, fields: { methodId } }));
    expect(await set(empty, assessor, m)).toMatchObject({ status: "rejected", code: "not_allowed" }); // aufnehmer: no commission.modifier / methoden.gerer
    expect((await set(empty, chefA, m)).status).toBe("ok"); // chef: commission.modifier
    expect(await vrow(empty)).toMatchObject({ methodId: m, methodVersion: 1 });
    const measured = await newVehicle({}, { kennzeichen: "MEAS 1" });
    expect(await set(measured, chefA, m)).toMatchObject({ status: "rejected", code: "method_locked" });
    expect((await vrow(measured)).methodId).toBe(sys.id);
    // a DE-only method on a Spanish vehicle does not fit
    const de = (await c.h.db.select().from(calcMethods).where(and(eq(calcMethods.orgId, c.orgES), eq(calcMethods.country, "DE"))))[0];
    expect((await set(empty, chefA, de.id)).status).toBe("rejected");
  });
});

describe("repair board: stages, to-dos, checks, Finish rules (server side)", () => {
  let id: string;
  const stage = (vid: string, tok: string, s: string) => one(tok, op("vehicle.repairStage", { vehicleId: vid, stage: s }));
  const refresh = () => pulled(chefA, id);

  beforeAll(async () => {
    id = await newVehicle({}, { kennzeichen: "BOARD 1", partsToReplace: ["Zierleiste Dach", "Antenne"] });
  });

  it("only assessed vehicles enter the board, straight into 'Bereit'; 'Zu ersetzende Teile' become to-dos", async () => {
    const fresh = await newVehicle({ statut: "arrive", panels: {} }, { kennzeichen: "ARR 1" });
    expect(await stage(fresh, assessor, "bereit")).toMatchObject({ status: "rejected", code: "not_assessed" });
    expect(await stage(id, assessor, "pdr")).toMatchObject({ status: "rejected", code: "vehicle_not_in_repair" });
    expect((await stage(id, assessor, "bereit")).status).toBe("ok");
    const row = await vrow(id);
    expect(row).toMatchObject({ statut: "reparatur", repairStage: "bereit" });
    expect(row.repAt).not.toBeNull();
    const v = await refresh();
    expect(v.repair.todos.map((t: any) => [t.text, t.source, t.done])).toEqual([["Zierleiste Dach", "part", false], ["Antenne", "part", false]]);
    expect((await c.h.db.select().from(vehicleStatusHistory).where(eq(vehicleStatusHistory.vehicleId, id))).map((h) => h.statut)).toContain("reparatur");
    // entering twice changes nothing (no duplicate to-dos)
    await stage(id, assessor, "bereit");
    expect((await refresh()).repair.todos).toHaveLength(2);
  });

  it("the station manager moves the car along (a linked technician only makes his own moves, see v4_field); 'Finish' is refused with the reasons while anything is open", async () => {
    await one(assessor, op("vehicle.assign", { vehicleId: id, kind: "pdr", userIds: [techUserId] }));
    expect((await stage(id, chefA, "pdr")).status).toBe("ok");
    expect((await vrow(id)).repairStage).toBe("pdr");
    const r = await stage(id, chefA, "finish");
    expect(r.status).toBe("rejected");
    expect(r.code).toBe("finish_blocked");
    for (const reason of ["todos_open", "check:pdr", "check:teile", "check:chef", "photos:demontage", "photos:pdr", "photos:remontage"]) expect(r.message).toContain(reason);
    expect((await vrow(id)).statut).toBe("reparatur");
    expect((await refresh()).repair.finishBlockers).toContain("todos_open");
  });

  it("to-dos: add, toggle (who/when), delete; checks: Endabnahme only for the station manager", async () => {
    const t1 = uuid();
    expect((await one(tech, op("repair.todo.add", { vehicleId: id, todo: { id: t1, text: "Kunde informieren" } }))).status).toBe("ok");
    expect((await one(tech, op("repair.todo.add", { vehicleId: id, todo: { id: t1, text: "Kunde informieren" } }))).status).toBe("ok"); // idempotent
    let v = await refresh();
    expect(v.repair.todos).toHaveLength(3);
    for (const t of v.repair.todos) expect((await one(tech, op("repair.todo.toggle", { todoId: t.id, done: true }))).status).toBe("ok");
    v = await refresh();
    expect(v.repair.todos.every((t: any) => t.done && t.doneBy && t.doneAt)).toBe(true);
    expect((await one(tech, op("repair.todo.toggle", { todoId: t1, done: false }))).status).toBe("ok");
    expect((await one(tech, op("repair.todo.delete", { todoId: t1 }))).status).toBe("ok");
    expect((await refresh()).repair.todos).toHaveLength(2);
    expect(await one(tech, op("repair.todo.toggle", { todoId: uuid(), done: true }))).toMatchObject({ code: "todo_not_found" });

    expect((await one(tech, op("repair.check", { vehicleId: id, key: "pdr", done: true }))).status).toBe("ok");
    expect((await one(tech, op("repair.check", { vehicleId: id, key: "teile", done: true }))).status).toBe("ok");
    expect(await one(tech, op("repair.check", { vehicleId: id, key: "chef", done: true }))).toMatchObject({ status: "rejected", code: "not_allowed" });
    expect(await one(assessor, op("repair.check", { vehicleId: id, key: "chef", done: true }))).toMatchObject({ code: "not_allowed" });
    expect((await one(chefA, op("repair.check", { vehicleId: id, key: "chef", done: true }))).status).toBe("ok");
    v = await refresh();
    expect(v.repair.checks.chef.by).toBeTruthy();
    expect(v.repair.finishBlockers.sort()).toEqual(["photos:demontage", "photos:pdr", "photos:remontage"]);
  });

  it("photos tagged with the stage and the role complete the automatic check; then 'Finish' works and the car is 'Fertig'", async () => {
    for (const s of ["demontage", "pdr", "remontage"]) {
      const pid = uuid();
      expect((await one(tech, op("photo.add", { photo: { id: pid, vehicleId: id, label: "Detail / Delle", phase: "reparatur", takenAt: new Date().toISOString() } }))).status).toBe("ok");
      expect((await one(tech, op("photo.stage", { photoId: pid, repairStage: s, role: "Techniker" }))).status).toBe("ok");
    }
    const ph = await c.h.db.select().from(photos).where(eq(photos.vehicleId, id));
    expect(ph.map((p) => p.repairStage).sort()).toEqual(["demontage", "pdr", "remontage"]);
    expect((await pull(c, chefA, c.orgES)).photos.find((p: any) => p.vehicleId === id).role).toBe("Techniker");
    expect((await refresh()).repair.finishBlockers).toEqual([]);
    expect((await stage(id, chefA, "finish")).status).toBe("ok");
    expect(await vrow(id)).toMatchObject({ statut: "fertig", repairStage: "finish" });
    const ev = await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id));
    expect(ev.filter((e) => e.type === "finish")).toHaveLength(1);
    // asking again is a no-op (no second finish event: the future automatic report is sent once per Finish)
    await stage(id, chefA, "finish");
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).filter((e) => e.type === "finish")).toHaveLength(1);
    // back from Finish: the car is in repair again
    expect((await stage(id, chefA, "remontage")).status).toBe("ok");
    expect(await vrow(id)).toMatchObject({ statut: "reparatur", repairStage: "remontage" });
  });

  it("the older status path keeps the column consistent (and never blocks or reports): fertig -> finish, reparatur -> bereit, back to Besichtigung -> none", async () => {
    const v = await newVehicle({}, { kennzeichen: "LEGACY 1" });
    expect((await one(assessor, op("vehicle.status", { vehicleId: v, statut: "reparatur" }))).status).toBe("ok");
    expect((await vrow(v)).repairStage).toBe("bereit");
    expect((await one(assessor, op("vehicle.status", { vehicleId: v, statut: "fertig" }))).status).toBe("ok");
    expect(await vrow(v)).toMatchObject({ statut: "fertig", repairStage: "finish" });
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, v))).filter((e) => e.type === "finish")).toHaveLength(0);
    expect((await one(assessor, op("vehicle.status", { vehicleId: v, statut: "besichtigung" }))).status).toBe("ok");
    expect((await vrow(v)).repairStage).toBeNull();
  });

  it("repair data and comments never reach carrosserie / insurer accounts; vehicles outside a technician's scope stay invisible", async () => {
    await one(assessor, op("vehicle.comment", { vehicleId: id, comment: { id: uuid(), text: "  Kunde ruft zurück  " } }));
    expect(await one(assessor, op("vehicle.comment", { vehicleId: id, comment: { id: uuid(), text: "   " } }))).toMatchObject({ code: "comment_empty" });
    const mine = await refresh();
    expect(mine.repair.comments.map((x: any) => x.text)).toEqual(["Kunde ruft zurück"]);
    const asCarro = await pulled(carro, id);
    expect(asCarro).toBeTruthy();
    expect(asCarro.repair).toBeUndefined();
    expect(JSON.stringify(asCarro)).not.toContain("Kunde ruft zurück");
    const insVehicle = await newVehicle({ insurerId }, { kennzeichen: "INS 2" });
    expect((await pulled(insurerTok, insVehicle)).repair).toBeUndefined();
    expect(await one(carro, op("vehicle.comment", { vehicleId: id, comment: { id: uuid(), text: "x" } }))).toMatchObject({ status: "rejected" });
    expect(await one(carro, op("repair.todo.add", { vehicleId: id, todo: { id: uuid(), text: "x" } }))).toMatchObject({ status: "rejected" });
  });

  it("technician planning (appointments) and the merged Verlauf", async () => {
    const aid = uuid(), day = workday(3);
    expect((await one(assessor, op("appointment.add", { vehicleId: id, appointment: { id: aid, technicianId: techRowId, date: day, durationMin: 90, note: "Dach" } }))).status).toBe("ok");
    expect(await one(assessor, op("appointment.add", { vehicleId: id, appointment: { id: uuid(), technicianId: uuid(), date: day, durationMin: 30, note: "" } }))).toMatchObject({ code: "technician_not_found" });
    expect(await one(tech, op("appointment.add", { vehicleId: id, appointment: { id: uuid(), technicianId: techRowId, date: day, durationMin: 30, note: "" } }))).toMatchObject({ code: "not_allowed" });
    expect((await one(assessor, op("appointment.update", { appointmentId: aid, fields: { durationMin: 120 } }))).status).toBe("ok");
    expect((await refresh()).repair.appointments).toEqual([{ id: aid, technicianId: techRowId, date: day, durationMin: 120, note: "Dach" }]);
    expect((await one(assessor, op("appointment.delete", { appointmentId: aid }))).status).toBe("ok");
    expect((await refresh()).repair.appointments).toEqual([]);

    const log = (await call(c, "GET", `/vehicles/${id}/verlauf`, { token: chefA, org: c.orgES })).body as { kind: string; data: any }[];
    const kinds = new Set(log.map((x) => x.kind));
    expect(kinds.has("status")).toBe(true);
    expect(kinds.has("repair")).toBe(true);
    expect(log.some((x) => x.kind === "repair" && x.data.type === "finish")).toBe(true);
    // the carrosserie sees the status history only (no repair events)
    const ext = (await call(c, "GET", `/vehicles/${id}/verlauf`, { token: carro, org: c.orgES })).body as { kind: string }[];
    expect(ext.every((x) => x.kind === "status" || x.kind === "move")).toBe(true);
  });
});

describe("repair calendar: bookings", () => {
  it("date rules: working days from today to the end of next year", () => {
    expect(bookableDay("2026-10-21", "2026-10-21")).toBe(true);
    expect(bookableDay("2026-10-20", "2026-10-21")).toBe(false); // past
    expect(bookableDay("2026-10-24", "2026-10-21")).toBe(false); // Saturday
    expect(bookableDay("2026-10-25", "2026-10-21")).toBe(false); // Sunday
    expect(bookableDay("2027-12-31", "2026-10-21")).toBe(true);
    expect(bookableDay("2028-01-03", "2026-10-21")).toBe(false); // out of range
    expect(bookableDay("nope", "2026-10-21")).toBe(false);
  });
  it("station time zone around midnight", () => {
    expect(todayIn("Europe/Berlin", new Date("2026-10-20T21:30:00Z"))).toBe("2026-10-20");
    expect(todayIn("Europe/Berlin", new Date("2026-10-20T22:30:00Z"))).toBe("2026-10-21");
    expect(todayIn("Europe/Madrid", new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("books a day: e-mails to the customer and the carrosserie (never the insurer), logged as 'termin'; the vehicle stays in Besichtigung", async () => {
    const id = await newVehicle({ insurerId }, { kennzeichen: "BOOK 1", claimNumber: "CL-77" });
    c.mailer.sent.length = 0;
    const day = workday(5);
    const bid = uuid();
    expect((await one(assessor, op("booking.create", { vehicleId: id, booking: { id: bid, date: day, time: "09:00", phone: "+34 612 345 678", email: "Kunde@Example.test" } }))).status).toBe("ok");
    expect(await vrow(id)).toMatchObject({ statut: "besichtigung", repairStage: null });
    expect(c.mailer.sent).toHaveLength(1);
    const m = c.mailer.sent[0];
    expect(m.to).toEqual(["kunde@example.test", "taller@example.test"]);
    expect(JSON.stringify(m)).not.toContain("allianz");
    expect(m.text).toContain("BOOK 1");
    expect(m.text).toContain("CL-77");
    expect(m.text).toContain(day.split("-").reverse().join("/")); // Spanish station: dd/mm/yyyy
    const sends = await c.h.db.select().from(reportSends).where(eq(reportSends.vehicleId, id));
    expect(sends.map((s) => [s.type, s.status])).toEqual([["termin", "sent"]]);
    const v = await pulled(assessor, id);
    expect(v.repair.booking).toMatchObject({ date: day, time: "09:00", phone: "+34 612 345 678", email: "kunde@example.test", status: "booked" });
    // customer phone / e-mail are personal data: not for roles that cannot book (carrosserie / insurer)
    expect((await pulled(carro, id)).repair).toBeUndefined();
    // a second booking for the same vehicle is refused (move it instead)
    expect(await one(assessor, book(id, workday(6)))).toMatchObject({ code: "booking_exists" });
    // move: update mail; cancel: cancellation mail; the place is free again
    c.mailer.sent.length = 0;
    const day2 = workday(6);
    expect((await one(assessor, op("booking.move", { bookingId: bid, date: day2, time: "10:30" }))).status).toBe("ok");
    expect(c.mailer.sent[0].subject).toMatch(/modificada/);
    expect((await one(assessor, op("booking.cancel", { bookingId: bid }))).status).toBe("ok");
    expect(c.mailer.sent[1].subject).toMatch(/cancelada/);
    expect((await c.h.db.select().from(repairBookings).where(eq(repairBookings.id, bid)))[0]).toMatchObject({ status: "cancelled", cancelReason: "cancelled_by_user" });
    expect((await pulled(assessor, id)).repair.booking).toBeNull();
    expect((await one(assessor, book(id, day2))).status).toBe("ok"); // can book again after a cancellation
  });

  it("capacity per station: a full day is refused; two assessors booking the last place at the same moment: exactly one wins", async () => {
    const day = workday(9); // capacity 2
    const [v1, v2, v3, v4] = [await newVehicle({}, { kennzeichen: "CAP 1" }), await newVehicle({}, { kennzeichen: "CAP 2" }), await newVehicle({}, { kennzeichen: "CAP 3" }), await newVehicle({}, { kennzeichen: "CAP 4" })];
    expect((await one(assessor, book(v1, day))).status).toBe("ok");
    const [r3, r4] = await Promise.all([push(c, assessor, [book(v2, day)]), push(c, chefA, [book(v3, day)])]);
    const results = [r3.body.results[0], r4.body.results[0]];
    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ code: "booking_full" });
    expect(await one(assessor, book(v4, day))).toMatchObject({ code: "booking_full" });
    // the calendar says so, and only people who may book see the plates
    const cal = (await call(c, "GET", `/stations/${A}/booking-calendar?from=${day}&to=${day}`, { token: assessor, org: c.orgES })).body;
    expect(cal.repairsPerDay).toBe(2);
    expect(cal.days[day].booked).toBe(2);
    expect(cal.days[day].bookings.map((b: any) => b.plate).sort()).toHaveLength(2);
    expect((await call(c, "GET", `/stations/${A}/booking-calendar?from=${day}&to=${day}`, { token: carro, org: c.orgES })).status).toBe(403);
    // raising the capacity opens the day again
    await call(c, "PUT", `/admin/stations/${A}`, { token: c.superToken, org: c.orgES, body: { repairs_per_day: 3 } });
    expect((await one(assessor, book(v4, day))).status).toBe("ok");
    await call(c, "PUT", `/admin/stations/${A}`, { token: c.superToken, org: c.orgES, body: { repairs_per_day: 2 } });
  });

  it("invalid days and statuses are refused", async () => {
    const id = await newVehicle({}, { kennzeichen: "BAD 1" });
    const sat = (() => { const d = new Date(todayIn("Europe/Madrid") + "T12:00:00Z"); while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    expect(await one(assessor, book(id, sat))).toMatchObject({ code: "booking_date_invalid" });
    expect(await one(assessor, book(id, "2020-01-06"))).toMatchObject({ code: "booking_date_invalid" });
    // a malformed booking (phone / e-mail / time) never reaches the rules: the whole batch is a 400, as for every other malformed op
    for (const bad of [{ phone: "123" }, { email: "nope" }, { time: "25:00" }]) expect((await push(c, assessor, [book(id, workday(2), bad)])).status).toBe(400);
  });
  it("a vehicle in repair, fertig or returned cannot be booked; roles without the permission are refused", async () => {
    const inRepair = await newVehicle({}, { kennzeichen: "REP 9" });
    await one(assessor, op("vehicle.repairStage", { vehicleId: inRepair, stage: "bereit" }));
    expect(await one(assessor, book(inRepair, workday(4)))).toMatchObject({ code: "booking_status" });
    const rendu = await newVehicle({ statut: "rendu" }, { kennzeichen: "REN 9" });
    expect(await one(assessor, book(rendu, workday(4)))).toMatchObject({ code: "booking_status" });
    const plain = await newVehicle({}, { kennzeichen: "PERM 9" });
    expect(await one(carro, book(plain, workday(4)))).toMatchObject({ status: "rejected" });
  });

  it("the daily job moves due bookings into 'Bereit' (parts become to-dos, history written), only once, and catches up after a downtime", async () => {
    const id = await newVehicle({}, { kennzeichen: "JOB 1", partsToReplace: ["Emblem"] });
    const day = workday(12);
    const bid = uuid();
    expect((await one(assessor, op("booking.create", { vehicleId: id, booking: { id: bid, date: day, time: "08:30", phone: "+34 600 000 000", email: "j@example.test" } }))).status).toBe("ok");
    // the evening before (Madrid time): nothing happens
    const first = await runDueBookings(c.h.db, new Date(day + "T00:00:00Z")); // 01:00/02:00 local time of that day: due (older leftovers of earlier tests are due too)
    expect(first.started).toBeGreaterThanOrEqual(1);
    expect(first.cancelled).toBe(0);
    const row = await vrow(id);
    expect(row).toMatchObject({ statut: "reparatur", repairStage: "bereit" });
    expect((await c.h.db.select().from(repairBookings).where(eq(repairBookings.id, bid)))[0]).toMatchObject({ status: "started" });
    const v = await pulled(chefA, id);
    expect(v.repair.todos.map((t: any) => t.text)).toEqual(["Emblem"]);
    expect(v.repair.booking).toBeNull();
    expect(v.repair.autoStartedOn).toBe(day); // the card says "Termin heute" on that day
    const ev = await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id));
    expect(ev.find((e) => e.type === "booking_started")).toMatchObject({ userId: null });
    // idempotent
    expect(await runDueBookings(c.h.db, new Date(day + "T05:00:00Z"))).toEqual({ started: 0, cancelled: 0 });
    // the vehicle shows up with a new change number: the phones pull it
    expect((await pull(c, tech, c.orgES)).vehicles.length).toBeGreaterThan(0);
  });

  it("exactly at midnight local time: not due at 21:30 UTC the evening before, due at 22:30 UTC (Berlin/Madrid summer time)", async () => {
    const id = await newVehicle({}, { kennzeichen: "MID 1" });
    const day = workday(15);
    await one(assessor, book(id, day));
    const prev = new Date(new Date(day + "T00:00:00Z").getTime() - 86_400_000); // previous day
    const before = new Date(prev.toISOString().slice(0, 10) + "T21:30:00Z");
    const after = new Date(prev.toISOString().slice(0, 10) + "T22:30:00Z");
    // CEST (UTC+2) applies until 25 Oct 2026, CET (UTC+1) after: pick the instant for the right offset
    const summer = day < "2026-10-25";
    const off = summer ? 2 : 1;
    const justBefore = new Date(new Date(day + "T00:00:00Z").getTime() - off * 3600_000 - 60_000);
    const justAfter = new Date(new Date(day + "T00:00:00Z").getTime() - off * 3600_000 + 60_000);
    void before; void after;
    expect(await runDueBookings(c.h.db, justBefore)).toEqual({ started: 0, cancelled: 0 });
    expect((await vrow(id)).repairStage).toBeNull();
    expect((await runDueBookings(c.h.db, justAfter)).started).toBeGreaterThanOrEqual(1);
    expect((await vrow(id)).repairStage).toBe("bereit");
  });

  it("a vehicle that is no longer eligible (moved to another station, deleted, already in repair) is left alone; the booking is cancelled with the reason", async () => {
    const moved = await newVehicle({}, { kennzeichen: "GONE 1" }), inRepair = await newVehicle({}, { kennzeichen: "GONE 2" }), deleted = await newVehicle({}, { kennzeichen: "GONE 3" });
    const days = [workday(18), workday(19), workday(20)], day = days[2];
    const ids: string[] = [moved, inRepair, deleted];
    for (const [i, v] of ids.entries()) expect((await one(assessor, book(v, days[i]))).status).toBe("ok");
    expect((await one(chefA, op("vehicle.move", { vehicleId: moved, toStationId: B }))).status).toBe("ok");
    await c.h.db.update(vehicles).set({ statut: "reparatur", repairStage: "pdr" }).where(eq(vehicles.id, inRepair)); // e.g. started by hand meanwhile
    expect((await one(chefA, op("vehicle.delete", { vehicleId: deleted }))).status).toBe("ok");
    const res = await runDueBookings(c.h.db, new Date(day + "T12:00:00Z"));
    expect(res.cancelled).toBe(3);
    const rows = await c.h.db.select().from(repairBookings).where(eq(repairBookings.status, "cancelled"));
    const reasons = Object.fromEntries(rows.filter((r) => ids.includes(r.vehicleId)).map((r) => [r.vehicleId, r.cancelReason]));
    expect(reasons).toEqual({ [moved]: "vehicle_moved", [inRepair]: "vehicle_status_reparatur", [deleted]: "vehicle_deleted" });
    expect((await vrow(inRepair)).repairStage).toBe("pdr"); // untouched
    expect((await vrow(moved)).repairStage).toBeNull();
  });

  it.runIf(new Date(todayIn("Europe/Madrid") + "T12:00:00Z").getUTCDay() % 6 !== 0)("a booking for today moves the vehicle immediately", async () => {
    const id = await newVehicle({}, { kennzeichen: "TODAY 1" });
    expect((await one(assessor, book(id, todayIn("Europe/Madrid")))).status).toBe("ok");
    expect(await vrow(id)).toMatchObject({ statut: "reparatur", repairStage: "bereit" });
  });
});

describe("recipients", () => {
  const ins = { sendReports: true, reportsToSend: "both", reportEmails: ["a@ins.test", "b@ins.test"] };
  it("the vehicle's insurer is added; an address removed on the station is excluded, a manually entered one never", () => {
    expect(recipientsFor({ carrosserieEmails: ["Taller@x.test"], insurer: ins }, "kva")).toEqual(["taller@x.test", "a@ins.test", "b@ins.test"]);
    expect(recipientsFor({ carrosserieEmails: ["taller@x.test"], insurer: ins, excludedInsurerEmails: ["A@ins.test"] }, "kva")).toEqual(["taller@x.test", "b@ins.test"]);
    expect(recipientsFor({ carrosserieEmails: ["a@ins.test"], insurer: ins, excludedInsurerEmails: ["a@ins.test"] }, "reparation")).toEqual(["a@ins.test", "b@ins.test"]);
    expect(recipientsFor({ carrosserieEmails: ["t@x.test"], insurer: { ...ins, reportsToSend: "kva" } }, "reparation")).toEqual(["t@x.test"]);
    expect(recipientsFor({ carrosserieEmails: ["t@x.test"], insurer: ins }, "termin")).toEqual(["t@x.test"]);
  });
  it("the admin preview pre-fills the list from the insurers selected on the station, flagging removed ones", async () => {
    await c.h.db.execute(await import("drizzle-orm").then(({ sql }) => sql`insert into station_insurers (station_id, insurer_id) values (${CARRO}, ${insurerId}) on conflict do nothing`));
    let p = (await call(c, "GET", `/admin/stations/${CARRO}/recipients`, { token: c.superToken, org: c.orgES })).body;
    expect(p.manual).toEqual(["taller@example.test"]);
    expect(p.auto).toEqual([{ insurerId, insurer: "Allianz", email: "siniestros@allianz.test", excluded: false }]);
    expect(p.effective).toEqual(["taller@example.test", "siniestros@allianz.test"]);
    await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { excluded_insurer_emails: ["siniestros@allianz.test"] } });
    p = (await call(c, "GET", `/admin/stations/${CARRO}/recipients`, { token: c.superToken, org: c.orgES })).body;
    expect(p.auto[0].excluded).toBe(true);
    expect(p.effective).toEqual(["taller@example.test"]);
    // the real send for a vehicle of that insurer honours the exclusion
    const id = await newVehicle({ insurerId });
    const r = await call(c, "GET", `/reports/recipients?vehicleId=${id}&type=kva`, { token: assessor, org: c.orgES });
    expect(r.body.recipients ?? r.body).toEqual(expect.arrayContaining(["taller@example.test"]));
    expect(JSON.stringify(r.body)).not.toContain("allianz");
    await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { excluded_insurer_emails: [] } });
  });
  it("technician kind (pdr / headliner) is stored and sent to people who may see the split", async () => {
    const t = await call(c, "POST", "/admin/technicians", { token: c.superToken, org: c.orgES, body: { name: "Hans Headliner", kind: "headliner", default_pct_demontage: 80 } });
    expect(t.status).toBe(201);
    expect(t.body.kind).toBe("headliner");
    const refs = (await pull(c, assessor, c.orgES)).refs;
    expect(refs.technicians.find((x: any) => x.name === "Hans Headliner").kind).toBe("headliner");
    expect((await pull(c, tech, c.orgES)).refs.technicians).toEqual([]); // technicians never get the list
    void JPEG; void stations;
  });
});

describe("the method follows the insurer automatically (no privilege needed), a manual choice still needs one", () => {
  it("an assessor changes the insurer of an unmeasured vehicle and the insurer's method comes with it; another method is refused", async () => {
    const alt = (await call(c, "POST", "/admin/methods", { token: c.superToken, org: c.orgES, body: { name: "Matriz Allianz", engine: "matrix", country: "ES", params: { esMatrix: null } } })).body.id as string;
    await call(c, "PUT", `/admin/insurers/${insurerId}/methods`, { token: c.superToken, org: c.orgES, body: { ES: alt, DE: null } });
    const id = await newVehicle({ panels: {} }, { kennzeichen: "AUTO 1" });
    const sysId = (await vrow(id)).methodId;
    expect(sysId).not.toBe(alt);
    // the insurer changes and the method that goes with it: allowed for the assessor, because it IS the insurer's method
    expect((await one(assessor, op("vehicle.header", { vehicleId: id, fields: { insurerId, methodId: alt, methodVersion: 1 } }))).status).toBe("ok");
    expect(await vrow(id)).toMatchObject({ insurerId, methodId: alt });
    // back to no insurer: the system method again (automatic as well)
    expect((await one(assessor, op("vehicle.header", { vehicleId: id, fields: { insurerId: null, methodId: sysId } }))).status).toBe("ok");
    expect((await vrow(id)).methodId).toBe(sysId);
    // a hand-picked method that is neither the insurer's nor the system one stays a privilege
    expect(await one(assessor, op("vehicle.header", { vehicleId: id, fields: { methodId: alt } }))).toMatchObject({ status: "rejected", code: "not_allowed" });
    expect((await one(chefA, op("vehicle.header", { vehicleId: id, fields: { methodId: alt } }))).status).toBe("ok");
    await call(c, "PUT", `/admin/insurers/${insurerId}/methods`, { token: c.superToken, org: c.orgES, body: { ES: null, DE: null } });
  });
});
