// V7 (Repair v2) F1: the customer's consent to move the car (drop-off signature), "do not move", and the driver of a move.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { handoverInput } from "@hagel/shared";
import { bookableDay, todayIn } from "../src/domains/repair/repair";
import { buildHandoverReceipt } from "../src/domains/repair/handover";
import { roleAssignments, vehicleHandovers, vehicleMoves, vehicles } from "../src/schema";
import { call, dentsPanel, driverAt, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";
import { sql } from "drizzle-orm";

let c: Ctx, A: string, B: string, PARC: string, CARRO: string;
let chef: string, assessor: string, techUser: string;
const TEXT = "Autorizo a PDR Team a trasladar mi vehículo a otra estación de PDR Team o a un taller colaborador (pintura) durante la reparación.";
const sig = [[[10, 10], [100, 60], [200, 20], [300, 90]]];

const create = (id: string) =>
  op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, statut: "besichtigung", header: { land: "ES", kennzeichen: "MV-" + id.slice(0, 4), modell: "Seat Leon", leistungsdatum: "2026-10-20", stundensatz: 69 }, panels: { haube: dentsPanel("haube", { "30": 4 }) }, shares: {} } });
const handover = (vehicleId: string, o: Record<string, unknown> = {}) =>
  op("vehicle.handover", { vehicleId, handover: { id: uuid(), kind: "drop_off", customerName: "Marta Zúñiga", customerEmail: null, remarks: "", signedAt: new Date().toISOString(), signature: sig, sendReceipt: false, ...o } });
const one = async (token: string, o: unknown) => ((await push(c, token, [o])).body.results[0] as { status: string; code?: string });
const row = async (id: string) => (await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0];
const move = (vehicleId: string, to: string, extra: Record<string, unknown> = {}) => op("vehicle.move", { vehicleId, toStationId: to, ...extra });
const car = async () => { const id = uuid(); expect((await one(assessor, create(id))).status).toBe("ok"); return id; };
/** a car whose customer refused the move, left at A */
const carNoMove = async () => { const id = await car(); expect((await one(chef, handover(id, { moveConsent: false, moveConsentText: TEXT }))).status).toBe("ok"); expect((await row(id)).noMove).toBe(true); return id; };
const workday = (n: number) => { const d = new Date(todayIn("Europe/Madrid") + "T12:00:00Z"); for (let k = 0; k < n;) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) k++; } return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string; name: string }[];
  CARRO = st.find((s) => s.type === "carrosserie")!.id;
  A = st.find((s) => s.name === "Nave Test A")!.id;
  B = st.find((s) => s.type === "hall" && s.name !== "Nave Test A")!.id;
  PARC = (await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "parc", name: "Parking A", capacite: 0 } })).body.id;
  chef = await inviteAndAccept(c, c.orgES, "chef-mv@example.test", { role_id: c.roleId.chef_site, station_id: A });
  assessor = await inviteAndAccept(c, c.orgES, "ass-mv@example.test", { role_id: c.roleId.aufnehmer });
  await inviteAndAccept(c, c.orgES, "tech-mv@example.test", { role_id: c.roleId.technicien, station_id: A });
  techUser = ((await c.h.db.execute(sql`select id from users where email = 'tech-mv@example.test'`)) as unknown as { rows: { id: string }[] }).rows[0].id;
});
afterAll(async () => { await c.h.close(); });

describe("consent on the drop-off signature", () => {
  it("not ticked = do not move; the choice, the date and the exact text are kept, and the pull carries the flag", async () => {
    const id = await carNoMove();
    const [h] = await c.h.db.select().from(vehicleHandovers).where(eq(vehicleHandovers.vehicleId, id));
    expect(h).toMatchObject({ kind: "drop_off", moveConsent: false, moveConsentText: TEXT });
    expect(h.signedAt).toBeInstanceOf(Date);
    expect((await pull(c, chef, c.orgES)).vehicles.find((v: { id: string }) => v.id === id)).toMatchObject({ noMove: true });
  });
  it("ticked = the car may move; a newer drop-off replaces the previous answer; an older app (no answer) leaves the flag alone", async () => {
    const id = await carNoMove();
    expect((await one(chef, handover(id, { moveConsent: true, moveConsentText: TEXT }))).status).toBe("ok");
    expect((await row(id)).noMove).toBe(false);
    expect((await one(chef, handover(id, { moveConsent: false, moveConsentText: TEXT }))).status).toBe("ok");
    expect((await row(id)).noMove).toBe(true);
    expect((await one(chef, handover(id))).status).toBe("ok"); // no answer sent
    expect((await row(id)).noMove).toBe(true);
  });
  it("a pick-up never changes the flag; a car never signed is movable as before", async () => {
    const id = await carNoMove();
    expect((await one(chef, handover(id, { kind: "pick_up", moveConsent: true, moveConsentText: TEXT }))).status).toBe("ok");
    expect((await row(id)).noMove).toBe(true);
    expect((await row(await car())).noMove).toBe(false);
  });
  it("the answer and its text come together (schema)", () => {
    const base = { id: uuid(), kind: "drop_off", customerName: "X", signedAt: new Date().toISOString(), signature: sig };
    expect(handoverInput.safeParse({ ...base, moveConsent: true }).success).toBe(false);
    expect(handoverInput.safeParse({ ...base, moveConsentText: TEXT }).success).toBe(false);
    expect(handoverInput.safeParse({ ...base, moveConsent: false, moveConsentText: TEXT }).success).toBe(true);
    expect(handoverInput.safeParse(base).success).toBe(true);
  });
  it("the receipt PDF is built with the consent (yes or no); the signatures list tells the answer", async () => {
    const id = await carNoMove();
    const [h] = await c.h.db.select().from(vehicleHandovers).where(eq(vehicleHandovers.vehicleId, id));
    const pdf = await buildHandoverReceipt({ db: c.h.db, storage: c.storage }, h);
    expect(Buffer.from(pdf.bytes).subarray(0, 4).toString()).toBe("%PDF");
    const list = await call(c, "GET", `/vehicles/${id}/handovers`, { token: chef, org: c.orgES });
    expect(list.body[0]).toMatchObject({ moveConsent: false, moveConsentText: TEXT });
  });
});

describe("do not move: only the parking next to the station", () => {
  it("another station is refused by the server (superadmin too); the parking is allowed without a driver; back to the station of the drop-off is allowed", async () => {
    const id = await carNoMove();
    expect(await one(c.superToken, move(id, B, { driverUserId: await driverAt(c, A) }))).toMatchObject({ status: "rejected", code: "move_forbidden" });
    expect(await one(chef, move(id, B, { driverUserId: await driverAt(c, A) }))).toMatchObject({ status: "rejected", code: "move_forbidden" });
    expect((await row(id)).stationId).toBe(A);
    expect((await one(chef, move(id, PARC))).status).toBe("ok"); // station -> parking: nobody to name
    expect(await one(c.superToken, move(id, B, { driverUserId: await driverAt(c, A) }))).toMatchObject({ status: "rejected", code: "move_forbidden" }); // from the parking to ANOTHER station: still refused
    expect((await one(c.superToken, move(id, A))).status).toBe("ok"); // back where the customer left it
    expect((await row(id)).stationId).toBe(A);
  });
  it("a repair appointment in another station would move the car: refused; in its own station it is fine", async () => {
    const id = await carNoMove();
    const day = workday(20);
    const bk = (extra: Record<string, unknown>) => op("booking.create", { vehicleId: id, booking: { id: uuid(), date: day, time: "08:30", phone: "+34 612 345 678", email: "kunde@example.test", ...extra } });
    expect(bookableDay(day, todayIn("Europe/Madrid"))).toBe(true);
    expect(await one(chef, bk({ stationId: B }))).toMatchObject({ status: "rejected", code: "move_forbidden" });
    expect((await one(chef, bk({}))).status).toBe("ok");
  });
  it("a car that may move is not blocked", async () => {
    const id = await car();
    expect((await one(chef, handover(id, { moveConsent: true, moveConsentText: TEXT }))).status).toBe("ok");
    expect((await one(chef, move(id, B, { driverUserId: await driverAt(c, A) }))).status).toBe("ok");
  });
});

describe("driver of a move", () => {
  it("between two stations a driver of the departure station is required; none / a stranger / a person of another station is refused", async () => {
    const id = await car();
    expect(await one(chef, move(id, B))).toMatchObject({ status: "rejected", code: "driver_required" });
    expect(await one(chef, move(id, B, { driverUserId: uuid() }))).toMatchObject({ status: "rejected", code: "driver_invalid" });
    const atB = await driverAt(c, B);
    expect(await one(chef, move(id, B, { driverUserId: atB }))).toMatchObject({ status: "rejected", code: "driver_invalid" }); // works at B, not at the departure station A
    expect((await row(id)).stationId).toBe(A);
  });
  it("a valid driver: the move is made, vehicle_moves keeps who clicked and who drove", async () => {
    const id = await car();
    const driver = await driverAt(c, A);
    expect((await one(chef, move(id, B, { driverUserId: driver, note: "to B" }))).status).toBe("ok");
    const [m] = (await c.h.db.select().from(vehicleMoves).where(eq(vehicleMoves.vehicleId, id)));
    expect(m).toMatchObject({ fromStationId: A, toStationId: B, driverUserId: driver, note: "to B" });
    expect(m.userId).not.toBeNull();
  });
  it("station <-> parking: no driver needed, none stored", async () => {
    const id = await car();
    expect((await one(chef, move(id, PARC))).status).toBe("ok");
    expect((await one(c.superToken, move(id, A))).status).toBe("ok"); // (the chef of A no longer sees a car standing in the parking site)
    const ms = await c.h.db.select().from(vehicleMoves).where(eq(vehicleMoves.vehicleId, id));
    expect(ms.length).toBe(2);
    expect(ms.every((m) => m.driverUserId === null)).toBe(true);
  });
  it("an expired assignment or a disabled user is not a driver", async () => {
    const id = await car();
    const driver = techUser; // a person who only drives (not the chef who clicks)
    await c.h.db.execute(sql`update users set status = 'disabled' where id = ${driver}`);
    expect(await one(chef, move(id, B, { driverUserId: driver }))).toMatchObject({ status: "rejected", code: "driver_invalid" });
    await c.h.db.execute(sql`update users set status = 'active' where id = ${driver}`);
    await c.h.db.update(roleAssignments).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(roleAssignments.userId, driver));
    expect(await one(chef, move(id, B, { driverUserId: driver }))).toMatchObject({ status: "rejected", code: "driver_invalid" });
    await c.h.db.update(roleAssignments).set({ expiresAt: null }).where(eq(roleAssignments.userId, driver));
    expect((await one(chef, move(id, B, { driverUserId: driver }))).status).toBe("ok");
  });
  it("the pull lists the possible drivers (name + stations) only for people who move cars; a customer-side account gets none", async () => {
    const chefRefs = (await pull(c, chef, c.orgES)).refs;
    expect(chefRefs.drivers.length).toBeGreaterThan(0);
    const d = chefRefs.drivers.find((x: { stationIds: string[] }) => x.stationIds.includes(A));
    expect(d).toMatchObject({ id: expect.any(String), name: expect.any(String) });
    const carro = await inviteAndAccept(c, c.orgES, "carro-mv@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
    expect((await pull(c, carro, c.orgES)).refs.drivers).toEqual([]);
  });
});
