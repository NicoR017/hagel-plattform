// Phase 4 on the phone: frozen method at creation, parts to replace, repair to-dos / comments (also offline), repair calendar, photo tags.
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ES_MATRIX_DEFAULT } from "@hagel/calc";
import { LocalDb } from "../src/sync/db";
import { SyncEngine, type Http } from "../src/sync/engine";
import {
  addComment, addPhoto, addTodo, cancelBooking, createBooking, createVehicle, moveBooking, setCheck, setHeader, setParts, setPanel, setRepairStage, tagPhoto, toggleTodo, type MutCtx,
} from "../src/sync/mutations";
import { calcWith, defaultMethodFor, methodDefOf } from "../src/field/calc";
import { todayIn } from "../src/field/calendar";
import { call, inviteAndAccept, setup, type Ctx } from "../../server/test/helpers";
import { repairBookings, repairTodos, vehicles } from "../../server/src/schema";

let c: Ctx, A: string, db: LocalDb, engine: SyncEngine, mut: MutCtx, online = true;
const sync = () => engine.syncNow(c.orgES);
const local = async (id: string) => (await db.vehicles.get(id)) as Record<string, any>;
const srv = async (id: string) => (await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0];
const JPG = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])], { type: "image/jpeg" });
const workday = (n: number) => { const d = new Date(todayIn("Europe/Madrid") + "T12:00:00Z"); for (let k = 0; k < n; ) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) k++; } return d.toISOString().slice(0, 10); };
const measured = async (plate: string) => {
  const id = await createVehicle(mut, { stationId: A, statut: "besichtigung", header: { kennzeichen: plate, land: "ES" } });
  await setPanel(mut, id, "haube", { key: "haube", dents: { "20": 12, "30": 6 } });
  await sync();
  return id;
};

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string }[];
  const st2 = st as { id: string; type: string; name: string }[];
  A = st2.find((s) => s.type === "hall" && s.name === "Nave Test A")!.id; // a PLACE
  const CARRO = st2.find((s) => s.type === "carrosserie")!.id; // the customer
  await call(c, "PUT", `/admin/stations/${A}`, { token: c.superToken, org: c.orgES, body: { repairs_per_day: 1 } });
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { report_emails: ["taller@example.test"] } });
  const token = await inviteAndAccept(c, c.orgES, "chef@example.test", { role_id: c.roleId.chef_site });
  db = new LocalDb("v4-phone");
  const http: Http = async (method, path, body, init) => {
    if (!online) throw new TypeError("offline");
    const raw = init?.raw ? new Uint8Array(await (init.raw as Blob).arrayBuffer()) : undefined;
    const r = await call(c, method, path, { token, org: init?.org ?? c.orgES, body: raw ? undefined : body, raw, contentType: init?.contentType });
    return { status: r.status, data: r.body, blob: init?.blob ? new Blob([r.bytes]) : undefined };
  };
  engine = new SyncEngine({ db, http });
  mut = { engine, db, orgId: c.orgES };
  await sync();
});
afterAll(async () => { await c.h.close(); });

describe("calculation method on the phone", () => {
  it("a new vehicle is frozen on a method at creation (the phone knows the methods), and the phone and the server agree on the amount", async () => {
    const id = await measured("V4 METH 1");
    const v = await local(id), row = await srv(id);
    expect(v.methodId).toBeTruthy();
    expect(v.methodId).toBe(row.methodId);
    expect(v.methodVersion).toBe(row.methodVersion);
    const refs = await db.getMeta<any>(`refs:${c.orgES}`);
    expect(defaultMethodFor(refs, null, "ES")).toEqual({ id: row.methodId, version: 1 });
    expect(methodDefOf(refs, v)?.engine).toBe("matrix");
    const net = calcWith(v, { rateDE: 83, rateES: 69, defaultTeiler: 10, vatDE: 0.19, esMatrix: ES_MATRIX_DEFAULT }, refs).netto;
    expect(net).toBeGreaterThan(0);
  });
});

describe("parts to replace and the repair data of the vehicle", () => {
  let id: string;
  beforeAll(async () => { id = await measured("V4 REP 1"); });

  it("the parts are stored in the vehicle header, in order; entering the repair makes them to-dos", async () => {
    await setParts(mut, id, ["Zierleiste Dach li", "Antenne"]); await sync();
    expect((await srv(id)).header).toMatchObject({ partsToReplace: ["Zierleiste Dach li", "Antenne"] });
    await setRepairStage(mut, id, "bereit"); await sync();
    const v = await local(id);
    expect(v).toMatchObject({ statut: "reparatur", repairStage: "bereit" });
    expect(v.repair.todos.map((t: any) => [t.text, t.source, t.done])).toEqual([["Zierleiste Dach li", "part", false], ["Antenne", "part", false]]);
  });

  it("to-dos, checks and comments work offline (shown at once), and arrive when the phone is back online", async () => {
    await addTodo(mut, id, "Kunde anrufen"); await sync();
    const todo = (await local(id)).repair.todos.find((t: any) => t.text === "Kunde anrufen");
    online = false;
    await toggleTodo(mut, id, todo.id, true);
    await setCheck(mut, id, "pdr", true);
    await addComment(mut, id, "  Fotos folgen  ");
    await sync();
    let v = await local(id);
    expect(v.repair.todos.find((t: any) => t.id === todo.id).done).toBe(true); // visible immediately
    expect(v.repair.checks.pdr).toBeTruthy();
    expect(v.repair.comments.map((x: any) => x.text)).toEqual(["Fotos folgen"]);
    expect((await c.h.db.select().from(repairTodos).where(eq(repairTodos.id, todo.id)))[0].doneAt).toBeNull(); // the server has not heard yet
    online = true;
    await sync();
    expect((await c.h.db.select().from(repairTodos).where(eq(repairTodos.id, todo.id)))[0].doneAt).not.toBeNull();
    v = await local(id);
    expect(v.repair.comments[0]).toMatchObject({ text: "Fotos folgen" });
    expect(v.repair.comments[0].userName).not.toBe("…"); // the server's name replaced the placeholder
    expect(await db.outbox.count()).toBe(0);
  });

  it("Finish refused by the server: the phone falls back to the truth and says why (nothing lost)", async () => {
    await setRepairStage(mut, id, "finish"); await sync();
    const v = await local(id);
    expect(v.statut).toBe("reparatur");
    expect(v.repair.finishBlockers.length).toBeGreaterThan(0);
    const issue = (await db.issues.toArray()).find((i) => i.opType === "vehicle.repairStage");
    expect(issue?.code).toBe("finish_blocked");
  });

  it("a photo can be tagged with the repair stage and the role of the person", async () => {
    const photoId = await addPhoto(mut, { vehicleId: id, blob: JPG(), label: "Detail / Delle", phase: "reparatur" });
    await sync();
    await tagPhoto(mut, id, photoId, "pdr", "Techniker"); await sync();
    const p = (await db.photos.get(photoId))!;
    expect(p).toMatchObject({ repairStage: "pdr", role: "Techniker" });
  });
});

describe("repair calendar from the phone", () => {
  it("book, see it on the vehicle, move it, cancel it; a full day is refused with a clear reason", async () => {
    const [a, b] = [await measured("V4 BOOK 1"), await measured("V4 BOOK 2")];
    const day = workday(7), day2 = workday(8);
    await createBooking(mut, a, { date: day, time: "09:00", phone: "+34 612 345 678", email: "kunde@example.test" }); await sync();
    let v = await local(a);
    expect(v.repair.booking).toMatchObject({ date: day, time: "09:00", status: "booked" });
    expect(v.statut).toBe("besichtigung"); // stays in assessment until the day
    // capacity is 1 per day: the second car cannot take that day
    await createBooking(mut, b, { date: day, time: "10:00", phone: "+34 600 000 000", email: "otro@example.test" }); await sync();
    expect((await local(b)).repair.booking ?? null).toBeNull();
    expect((await db.issues.toArray()).some((i) => i.opType === "booking.create" && i.code === "booking_full")).toBe(true);
    // move the first one: the day frees up
    await moveBooking(mut, a, v.repair.booking.id, day2, "11:30"); await sync();
    v = await local(a);
    expect(v.repair.booking).toMatchObject({ date: day2, time: "11:30" });
    await createBooking(mut, b, { date: day, time: "10:00", phone: "+34 600 000 000", email: "otro@example.test" }); await sync();
    expect((await local(b)).repair.booking).toMatchObject({ date: day });
    await cancelBooking(mut, a, v.repair.booking.id); await sync();
    expect((await local(a)).repair.booking).toBeNull();
    expect((await c.h.db.select().from(repairBookings).where(eq(repairBookings.vehicleId, a))).map((x) => x.status)).toEqual(["cancelled"]);
  });
});

describe("header edits stay in the old shape", () => {
  it("a plain header edit still produces the old op (no new keys unless used)", async () => {
    const id = await measured("V4 OLD 1");
    await setHeader(mut, id, { modell: "Seat Leon" });
    const op = (await db.outbox.toArray()).find((o) => o.vehicleId === id)?.op as { fields?: Record<string, unknown> } | undefined;
    expect(Object.keys(op?.fields ?? {})).toEqual(["modell"]);
    await sync();
  });
});
