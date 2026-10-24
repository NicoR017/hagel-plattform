// The repair appointment can be booked for another place than the one of the assessment: capacity of THAT place counts, the car is moved there on the day.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { repairBookings, repairEvents, stations, vehicleMoves, vehicles } from "../src/schema";
import { runDueBookings, todayIn } from "../src/repair";
import { call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, B: string, CARRO: string, PARC: string, assessor: string, chefA: string;
const one = async (token: string, o: unknown) => ((await push(c, token, [o])).body.results as { status: string; code?: string }[])[0];
function workday(n: number): string {
  const d = new Date(todayIn("Europe/Madrid") + "T12:00:00Z");
  for (let k = 0; k < n; ) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) k++; }
  return d.toISOString().slice(0, 10);
}
const car = async (plate: string) => {
  const id = uuid();
  expect((await one(assessor, op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, statut: "besichtigung", panels: { haube: dentsPanel("haube", { "20": 10, "30": 4 }) }, header: { land: "ES", kennzeichen: plate, modell: "Seat", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69 } } }))).status).toBe("ok");
  return id;
};
const book = (vehicleId: string, date: string, stationId?: string) => op("booking.create", { vehicleId, booking: { id: uuid(), date, time: "08:30", phone: "+34 612 345 678", email: "kunde@example.test", ...(stationId ? { stationId } : {}) } });
const bookingOf = async (vehicleId: string) => (await c.h.db.select().from(repairBookings).where(eq(repairBookings.vehicleId, vehicleId)))[0];

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string }[];
  const halls = (st as any[]).filter((s) => s.type === "hall");
  A = halls.find((s) => s.name === "Nave Test A").id;
  B = halls.find((s) => s.name !== "Nave Test A").id;
  CARRO = st.find((s) => s.type === "carrosserie")!.id; // customer only, never a place
  PARC = (await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "parc", name: "Parking", capacite: 20 } })).body.id;
  await call(c, "PUT", `/admin/stations/${A}`, { token: c.superToken, org: c.orgES, body: { repairs_per_day: 3 } });
  await call(c, "PUT", `/admin/stations/${B}`, { token: c.superToken, org: c.orgES, body: { repairs_per_day: 1 } });
  assessor = await inviteAndAccept(c, c.orgES, "assessor-bp@example.test", { role_id: c.roleId.aufnehmer });
  chefA = await inviteAndAccept(c, c.orgES, "chef-bp@example.test", { role_id: c.roleId.chef_site, station_id: A });
});
afterAll(async () => { await c.h.close(); });

describe("repair appointment at another place", () => {
  it("the choices travel with the data for the people who book (halls only: not car parks, not body shops)", async () => {
    const p = await pull(c, assessor, c.orgES);
    const ids = p.refs.repairLocations.map((x: { id: string }) => x.id);
    expect(ids).toEqual(expect.arrayContaining([A, B]));
    expect(ids).not.toContain(PARC);
    expect(ids).not.toContain(CARRO);
  });

  it("booked for another hall: that hall's capacity counts, the origin is remembered, the car stays where it is until the day", async () => {
    const day = workday(5);
    const id = await car("BP 1");
    expect((await one(assessor, book(id, day, B))).status).toBe("ok");
    expect(await bookingOf(id)).toMatchObject({ stationId: B, originStationId: A, status: "booked" });
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0].stationId).toBe(A);
    // the hall takes one repair per day: a second car for the same hall and day is refused, while the own station still has room
    const id2 = await car("BP 2");
    expect(await one(assessor, book(id2, day, B))).toMatchObject({ status: "rejected", code: "booking_full" });
    expect((await one(assessor, book(id2, day))).status).toBe("ok");
  });

  it("not a car park, not an unknown or foreign place; a booking without a place still means the station of the car", async () => {
    const id = await car("BP 3");
    expect(await one(assessor, book(id, workday(6), PARC))).toMatchObject({ status: "rejected", code: "station_unknown" });
    expect(await one(assessor, book(id, workday(6), uuid()))).toMatchObject({ status: "rejected", code: "station_unknown" });
    expect((await one(assessor, book(id, workday(6)))).status).toBe("ok");
    expect(await bookingOf(id)).toMatchObject({ stationId: A });
  });

  it("a station chef limited to one station can see the calendar of the other place to choose a day", async () => {
    const r = await call(c, "GET", `/stations/${B}/booking-calendar?from=${workday(1)}&to=${workday(10)}`, { token: chefA, org: c.orgES });
    expect(r.status).toBe(200);
    expect(r.body.repairsPerDay).toBe(1);
  });

  it("on the day the car is moved to the repair place (history written) and goes into 'Bereit' there", async () => {
    const day = workday(8);
    const id = await car("BP 4");
    expect((await one(assessor, book(id, day, B))).status).toBe("ok");
    const res = await runDueBookings(c.h.db, new Date(day + "T05:00:00Z"));
    expect(res.started).toBeGreaterThanOrEqual(1);
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0]).toMatchObject({ stationId: B, statut: "reparatur", repairStage: "bereit" });
    expect((await c.h.db.select().from(vehicleMoves).where(eq(vehicleMoves.vehicleId, id)))[0]).toMatchObject({ fromStationId: A, toStationId: B });
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).some((e) => e.type === "booking_moved_car")).toBe(true);
    const v = (await pull(c, assessor, c.orgES)).vehicles.find((x: any) => x.id === id);
    expect(v.stationId).toBe(B);
  });

  it("a car moved somewhere else by hand in the meantime is left alone and the booking is cancelled", async () => {
    const day = workday(9);
    const id = await car("BP 5");
    expect((await one(assessor, book(id, day, B))).status).toBe("ok");
    await c.h.db.update(vehicles).set({ stationId: PARC }).where(eq(vehicles.id, id));
    await runDueBookings(c.h.db, new Date(day + "T05:00:00Z"));
    expect((await bookingOf(id))).toMatchObject({ status: "cancelled", cancelReason: "vehicle_moved" });
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0]).toMatchObject({ stationId: PARC, repairStage: null });
  });

  it("booked for the day itself at another place: the car goes there at once", async () => {
    const today = todayIn("Europe/Madrid");
    const dow = new Date(today + "T12:00:00Z").getUTCDay();
    if (dow % 6 === 0) return; // weekend: no booking for today
    await c.h.db.update(stations).set({ repairsPerDay: 5 }).where(eq(stations.id, B));
    const id = await car("BP 6");
    expect((await one(assessor, book(id, today, B))).status).toBe("ok");
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0]).toMatchObject({ stationId: B, repairStage: "bereit" });
  });
});
