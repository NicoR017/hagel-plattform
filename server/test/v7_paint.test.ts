// V7 (Repair v2) F4: paint jobs (from the "push to paint" elements), partner body shops, scheduling, customer appointments (confirmation + reminder),
// the car leaving for the painter (driver, history, station unchanged), done, rights.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { PERMISSIONS, SYSTEM_ROLES } from "@hagel/shared";
import { runPaintReminders } from "../src/domains/paint/paint";
import { todayIn } from "../src/domains/repair/repair";
import { paintJobs, repairEvents, roles, stations, vehicleMoves, vehicles } from "../src/schema";
import { call, dentsPanel, driverAt, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, CARRO: string, B: string;
let chef: string, assessor: string, carro: string;

const create = (id: string, panels: Record<string, unknown> = {}) =>
  op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, statut: "besichtigung", header: { land: "ES", kennzeichen: "PA-" + id.slice(0, 4), modell: "Seat Leon", kundeEmail: "kunde@example.test", leistungsdatum: "2026-10-20", stundensatz: 69 }, panels: { haube: dentsPanel("haube", { "30": 4 }), ...panels }, shares: {} } });
const panel = (vehicleId: string, key: string, method: string) => op("vehicle.panel", { vehicleId, key, panel: dentsPanel(key, { "30": 3 }, { method }) });
const one = async (token: string, o: unknown) => ((await push(c, token, [o])).body.results[0] as { status: string; code?: string });
const api = (m: string, path: string, body?: unknown, token = chef) => call(c, m, path, { token, org: c.orgES, body });
const jobs = async (vehicleId: string) => (await c.h.db.select().from(paintJobs).where(eq(paintJobs.vehicleId, vehicleId))).filter((j) => !j.deletedAt);
const car = async () => { const id = uuid(); expect((await one(assessor, create(id))).status).toBe("ok"); return id; };
const day = (n: number) => { const d = new Date(todayIn("Europe/Madrid") + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** a car with one paint job (the roof is "push to paint"), the body shop is a paint partner */
const carWithJob = async () => { const id = await car(); expect((await one(assessor, panel(id, "dach", "ptp"))).status).toBe("ok"); return { id, job: (await jobs(id))[0] }; };
const handover = (vehicleId: string, consent: boolean) => op("vehicle.handover", { vehicleId, handover: { id: uuid(), kind: "drop_off", customerName: "Marta", customerEmail: null, remarks: "", signedAt: new Date().toISOString(), signature: [[[10, 10], [100, 60]]], sendReceipt: false, moveConsent: consent, moveConsentText: "ok" } });

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string; name: string }[];
  CARRO = st.find((s) => s.type === "carrosserie")!.id; A = st.find((s) => s.name === "Nave Test A")!.id; B = st.find((s) => s.type === "hall" && s.name !== "Nave Test A")!.id;
  chef = await inviteAndAccept(c, c.orgES, "chef-pa@example.test", { role_id: c.roleId.chef_site, station_id: A });
  assessor = await inviteAndAccept(c, c.orgES, "ass-pa@example.test", { role_id: c.roleId.aufnehmer });
  carro = await inviteAndAccept(c, c.orgES, "carro-pa@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
  expect((await call(c, "PUT", `/admin/bodyshops/${CARRO}/paint-partner`, { token: c.superToken, org: c.orgES, body: { paint_partner: true } })).status).toBe(200);
});
afterAll(async () => { await c.h.close(); });

describe("permission and partner flag", () => {
  it("peinture.gerer for the manager and the station chief (code and database); the paint-partner flag is set by the body shop managers only", async () => {
    expect(PERMISSIONS).toContain("peinture.gerer");
    const sr = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.key, r.permissions]));
    for (const k of ["org_admin", "chef_site"]) expect(sr[k]).toContain("peinture.gerer");
    for (const k of ["aufnehmer", "technicien", "freelance", "carrosserie", "assureur"]) expect(sr[k]).not.toContain("peinture.gerer");
    expect((await c.h.db.select().from(roles).where(eq(roles.key, "chef_site"))).every((r) => r.permissions.includes("peinture.gerer"))).toBe(true);
    expect((await c.h.db.select().from(stations).where(eq(stations.id, CARRO)))[0].paintPartner).toBe(true);
    expect((await call(c, "PUT", `/admin/bodyshops/${CARRO}/paint-partner`, { token: assessor, org: c.orgES, body: { paint_partner: false } })).status).toBe(403);
    expect((await call(c, "PUT", `/admin/bodyshops/${uuid()}/paint-partner`, { token: c.superToken, org: c.orgES, body: { paint_partner: true } })).status).toBe(404);
    const refs = (await pull(c, chef, c.orgES)).refs;
    expect(refs.bodyshops.find((b: { id: string }) => b.id === CARRO)).toMatchObject({ paintPartner: true });
  });
});

describe("paint jobs come from the estimate", () => {
  it("a 'push to paint' element gets its job; another method takes an unstarted job away; a car created with it has it; by hand for any element; never twice", async () => {
    const id = await car();
    expect(await jobs(id)).toHaveLength(0);
    expect((await one(assessor, panel(id, "dach", "ptp"))).status).toBe("ok");
    expect((await one(assessor, panel(id, "dach", "ptp"))).status).toBe("ok"); // again: still one
    expect((await jobs(id)).map((j) => [j.elementKey, j.status, j.source])).toEqual([["dach", "to_paint", "ptp"]]);
    expect((await one(assessor, panel(id, "dach", "sanft"))).status).toBe("ok");
    expect(await jobs(id)).toHaveLength(0);
    expect((await c.h.db.select().from(paintJobs).where(eq(paintJobs.vehicleId, id)))[0].deletedAt).toBeInstanceOf(Date); // kept, never deleted for good
    const born = uuid();
    expect((await one(assessor, create(born, { tuer_vl: dentsPanel("tuer_vl", { "30": 2 }, { method: "ptp" }) }))).status).toBe("ok");
    expect((await jobs(born)).map((j) => j.elementKey)).toEqual(["tuer_vl"]);
    const man = await api("POST", `/vehicles/${id}/paint`, { elementKey: "kfl_vl" });
    expect(man.status).toBe(201);
    expect((await api("POST", `/vehicles/${id}/paint`, { elementKey: "kfl_vl" })).status).toBe(200);
    expect((await jobs(id)).filter((j) => j.elementKey === "kfl_vl")).toHaveLength(1);
    expect((await api("POST", `/vehicles/${id}/paint`, { elementKey: "nope" })).body.code).toBe("paint_element_invalid");
    expect((await api("POST", `/vehicles/${id}/paint`, { elementKey: "dach" }, assessor)).status).toBe(403);
    expect((await api("POST", `/vehicles/${id}/paint`, { elementKey: "dach" }, carro)).status).toBe(403);
  });
  it("the phones receive the jobs with the car (repair board users); the customer-side account does not", async () => {
    const { id } = await carWithJob();
    const mine = (await pull(c, chef, c.orgES)).vehicles.find((v: { id: string }) => v.id === id) as { paint?: { elementKey: string; status: string }[] };
    expect(mine.paint).toEqual([expect.objectContaining({ elementKey: "dach", status: "to_paint", customerAppointment: false })]);
    expect(((await pull(c, assessor, c.orgES)).vehicles.find((v: { id: string }) => v.id === id) as { paint?: unknown[] }).paint).toHaveLength(1);
    expect(((await pull(c, carro, c.orgES)).vehicles.find((v: { id: string }) => v.id === id) as { paint?: unknown } | undefined)?.paint).toBeUndefined();
  });
  it("the migration gives the paint jobs to the cars in repair that have 'push to paint' elements, once", async () => {
    const id = await car();
    await c.h.db.update(vehicles).set({ statut: "reparatur", repairStage: "bereit", panels: { dach: { key: "dach", dents: { "30": 2 }, method: "ptp" }, haube: { key: "haube", dents: { "30": 1 }, method: "sanft" } } as never }).where(eq(vehicles.id, id));
    const file = readFileSync(new URL("../migrations/0029_v7_paint.sql", import.meta.url), "utf8");
    const insert = file.split("--> statement-breakpoint").find((s) => s.includes('INSERT INTO "paint_jobs"'))!;
    await c.h.db.execute(sql.raw(insert)); await c.h.db.execute(sql.raw(insert));
    expect((await jobs(id)).map((j) => j.elementKey)).toEqual(["dach"]);
    expect(file).not.toMatch(/\bDROP\b|\bRENAME\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|ALTER COLUMN/i);
  });
});

describe("schedule painting at a partner body shop", () => {
  it("only a partner body shop, not in the past; the car must be movable; scheduled again later is fine; not once it is at the body shop", async () => {
    const { id, job } = await carWithJob();
    expect((await api("POST", `/paint/${job.id}/schedule`, { partnerId: A, date: day(3) })).body.code).toBe("paint_partner_invalid"); // a hall
    expect((await api("POST", `/paint/${job.id}/schedule`, { partnerId: CARRO, date: day(-1) })).body.code).toBe("paint_date_invalid");
    expect((await api("POST", `/paint/${job.id}/schedule`, { partnerId: CARRO, date: day(3), time: "9:00" })).status).toBe(400); // bad time
    expect((await api("POST", `/paint/${job.id}/schedule`, { partnerId: CARRO, date: day(3), time: "09:30" }, assessor)).status).toBe(403);
    const r = await api("POST", `/paint/${job.id}/schedule`, { partnerId: CARRO, date: day(3), time: "09:30" });
    expect(r.status).toBe(200); expect(r.body.status).toBe("scheduled");
    expect((await jobs(id))[0]).toMatchObject({ status: "scheduled", partnerStationId: CARRO, plannedDate: day(3), plannedTime: "09:30", customerAppointment: false });
    expect((await api("POST", `/paint/${job.id}/schedule`, { partnerId: CARRO, date: day(5) })).status).toBe(200);
    // a car that must not move cannot be scheduled for a pick-up
    const nm = await carWithJob();
    expect((await one(chef, handover(nm.id, false))).status).toBe("ok");
    expect((await api("POST", `/paint/${nm.job.id}/schedule`, { partnerId: CARRO, date: day(3) })).body.code).toBe("move_forbidden");
  });
});

describe("customer appointment (the car does not move)", () => {
  it("D25: partner, day, time and the customer's e-mail; the confirmation goes out at once, one reminder the day before, never twice", async () => {
    const { id, job } = await carWithJob();
    expect((await one(chef, handover(id, false))).status).toBe("ok");
    expect((await api("POST", `/paint/${job.id}/customer-appointment`, { partnerId: CARRO, date: day(4), time: "10:00", email: "bad" })).status).toBe(400);
    const before = c.mailer.sent.length;
    const r = await api("POST", `/paint/${job.id}/customer-appointment`, { partnerId: CARRO, date: day(4), time: "10:00", email: "Kunde@Example.test", phone: "+34 600 000 000" });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ status: "scheduled", mailed: true });
    expect(c.mailer.sent.length).toBe(before + 1);
    const m = c.mailer.sent[c.mailer.sent.length - 1];
    expect(m.to).toBe("kunde@example.test"); expect(m.subject).toContain("PA-" + id.slice(0, 4)); expect(m.text).toContain(day(4).split("-").reverse().join("/")); expect(m.text).toContain("10:00");
    const j = (await jobs(id))[0];
    expect(j).toMatchObject({ customerAppointment: true, customerEmail: "kunde@example.test" }); expect(j.confirmationSentAt).toBeInstanceOf(Date);
    // the day before
    expect((await runPaintReminders({ db: c.h.db, mailer: c.mailer })).reminded).toBe(0);
    await c.h.db.update(paintJobs).set({ plannedDate: day(1) }).where(eq(paintJobs.id, job.id));
    const n = c.mailer.sent.length;
    expect((await runPaintReminders({ db: c.h.db, mailer: c.mailer })).reminded).toBe(1);
    expect(c.mailer.sent.length).toBe(n + 1); expect(c.mailer.sent[n].subject.startsWith("Recordatorio")).toBe(true);
    expect((await runPaintReminders({ db: c.h.db, mailer: c.mailer })).reminded).toBe(0);
    // no mail provider: the appointment stands, the person is told ("mailed": false)
    const other = await carWithJob();
    c.mailer.fail = new Error("down");
    const f = await api("POST", `/paint/${other.job.id}/customer-appointment`, { partnerId: CARRO, date: day(4), time: "11:00", email: "x@example.test" });
    c.mailer.fail = null;
    expect(f.body).toMatchObject({ status: "scheduled", mailed: false });
  });
});

describe("the car goes to the painter, comes back, done", () => {
  it("internal: a driver of the departure station is required; the move is in the history with the driver, the car's station does not change; refused for a car that must not move", async () => {
    const { id, job } = await carWithJob();
    expect((await api("POST", `/paint/${job.id}/status`, { status: "at_body_shop" })).body.code).toBe("paint_status_invalid"); // not scheduled yet
    await api("POST", `/paint/${job.id}/schedule`, { partnerId: CARRO, date: day(2) });
    expect((await api("POST", `/paint/${job.id}/status`, { status: "at_body_shop" })).body.code).toBe("driver_required");
    expect((await api("POST", `/paint/${job.id}/status`, { status: "at_body_shop", driverUserId: uuid() })).body.code).toBe("driver_invalid");
    expect((await api("POST", `/paint/${job.id}/status`, { status: "at_body_shop", driverUserId: await driverAt(c, B) })).body.code).toBe("driver_invalid"); // works at another station
    const driver = await driverAt(c, A);
    const r = await api("POST", `/paint/${job.id}/status`, { status: "at_body_shop", driverUserId: driver });
    expect(r.status).toBe(200); expect(r.body.status).toBe("at_body_shop");
    const mv = (await c.h.db.select().from(vehicleMoves).where(eq(vehicleMoves.vehicleId, id)))[0];
    expect(mv).toMatchObject({ fromStationId: A, toStationId: CARRO, driverUserId: driver, note: "paint" });
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0].stationId).toBe(A);
    expect((await api("POST", `/paint/${job.id}/schedule`, { partnerId: CARRO, date: day(5) })).body.code).toBe("paint_status_invalid"); // already at the body shop
    expect((await api("POST", `/paint/${job.id}/status`, { status: "done" })).body.status).toBe("done");
    expect((await jobs(id))[0].doneAt).toBeInstanceOf(Date);
    const evs = (await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).map((e) => e.type);
    expect(evs).toEqual(expect.arrayContaining(["paint_scheduled", "paint_at_body_shop", "paint_done", "paint_all_done"]));
    expect((await api("POST", `/paint/${job.id}/status`, { status: "to_paint" })).body.code).toBe("paint_status_invalid"); // done stays done
  });
  it("customer appointment: no driver, no move; done straight from 'scheduled'; 'all done' only when every element is done; a car that must not move cannot be taken", async () => {
    const { id, job } = await carWithJob();
    await one(assessor, panel(id, "tuer_vl", "ptp"));
    const second = (await jobs(id)).find((j) => j.elementKey === "tuer_vl")!;
    await one(chef, handover(id, false));
    await api("POST", `/paint/${job.id}/customer-appointment`, { partnerId: CARRO, date: day(2), time: "08:00", email: "k@example.test" });
    expect((await api("POST", `/paint/${job.id}/status`, { status: "at_body_shop" })).status).toBe(200); // brought by the customer: no driver needed
    expect(await c.h.db.select().from(vehicleMoves).where(eq(vehicleMoves.vehicleId, id))).toHaveLength(0);
    await api("POST", `/paint/${job.id}/status`, { status: "done" });
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).some((e) => e.type === "paint_all_done")).toBe(false); // the door is still to do
    await api("POST", `/paint/${second.id}/customer-appointment`, { partnerId: CARRO, date: day(3), time: "08:00", email: "k@example.test" });
    expect((await api("POST", `/paint/${second.id}/status`, { status: "done" })).status).toBe(200); // scheduled -> done for a customer appointment
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).some((e) => e.type === "paint_all_done")).toBe(true);
    // internal pick-up of a no-move car is refused even when it was scheduled before the refusal
    const x = await carWithJob();
    await api("POST", `/paint/${x.job.id}/schedule`, { partnerId: CARRO, date: day(2) });
    await one(chef, handover(x.id, false));
    expect((await api("POST", `/paint/${x.job.id}/status`, { status: "at_body_shop", driverUserId: await driverAt(c, A) })).body.code).toBe("move_forbidden");
  });
  it("back to 'to paint' clears the planning; an unstarted job can be removed (kept, not deleted); not once it is at the body shop", async () => {
    const { id, job } = await carWithJob();
    await api("POST", `/paint/${job.id}/schedule`, { partnerId: CARRO, date: day(2), time: "09:00" });
    expect((await api("POST", `/paint/${job.id}/status`, { status: "to_paint" })).body.status).toBe("to_paint");
    expect((await jobs(id))[0]).toMatchObject({ partnerStationId: null, plannedDate: null, customerAppointment: false });
    expect((await api("DELETE", `/paint/${job.id}`, undefined, assessor)).status).toBe(403);
    expect((await api("DELETE", `/paint/${job.id}`)).status).toBe(200);
    expect(await jobs(id)).toHaveLength(0);
    expect((await api("DELETE", `/paint/${uuid()}`)).status).toBe(404);
  });
});
