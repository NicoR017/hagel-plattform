// "Rückgängig" after a status change or a move: a second, logged operation that restores the previous state (against the real server).
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { LocalDb } from "../src/sync/db";
import { SyncEngine, type Http } from "../src/sync/engine";
import { createVehicle, moveVehicle, setHeader, setStatus, type MutCtx } from "../src/sync/mutations";
import { snapshotVehicles, undoMove, undoStatus } from "../src/field/undo";
import { call, inviteAndAccept, setup, type Ctx } from "../../server/test/helpers";
import { vehicleMoves, vehicleStatusHistory, vehicles } from "../../server/src/schema";

let c: Ctx, A: string, B: string, db: LocalDb, engine: SyncEngine, mut: MutCtx, tokenA: string, n = 0;
const sync = () => engine.syncNow(c.orgES);
/** a phone signed in as `token` */
function phone(token: string) {
  const d = new LocalDb(`v3-undo-${++n}`);
  const http: Http = async (method, path, body, init) => {
    const raw = init?.raw ? new Uint8Array(await (init.raw as Blob).arrayBuffer()) : undefined;
    const r = await call(c, method, path, { token, org: init?.org ?? c.orgES, body: raw ? undefined : body, raw, contentType: init?.contentType });
    return { status: r.status, data: r.body, blob: init?.blob ? new Blob([r.bytes]) : undefined };
  };
  const e = new SyncEngine({ db: d, http });
  return { db: d, engine: e, mut: { engine: e, db: d, orgId: c.orgES } as MutCtx };
}
const row = async (id: string) => (await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0];
const newVehicle = async (plate: string) => { const id = await createVehicle(mut, { stationId: A, statut: "besichtigung", header: { kennzeichen: plate } }); await sync(); return id; };

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string }[];
  A = st.find((s) => s.type === "carrosserie")!.id;
  B = st.find((s) => s.type === "hall")!.id;
  // a station manager with rights on BOTH stations (organisation-wide) and one who only has station A
  const both = await inviteAndAccept(c, c.orgES, "chef@example.test", { role_id: c.roleId.chef_site });
  tokenA = await inviteAndAccept(c, c.orgES, "chefa@example.test", { role_id: c.roleId.chef_site, station_id: A });
  ({ db, engine, mut } = phone(both));
  await sync();
});
afterAll(async () => { await c.h.close(); });

describe("undo", () => {
  it("status: the previous status comes back and the history shows both changes", async () => {
    const id = await newVehicle("UNDO 1");
    const before = await snapshotVehicles(db, [id]);
    await setStatus(mut, id, "fertig"); await sync();
    expect((await row(id)).statut).toBe("fertig");
    await undoStatus(mut, before, "fertig"); await sync();
    expect((await row(id)).statut).toBe("besichtigung");
    const hist = (await c.h.db.select().from(vehicleStatusHistory).where(eq(vehicleStatusHistory.vehicleId, id))).sort((a, b) => a.at.getTime() - b.at.getTime()).map((h) => h.statut);
    expect(hist).toEqual(["besichtigung", "fertig", "besichtigung"]);
  });

  it("status: leaving 'Wartet' and undoing restores the status AND its reason", async () => {
    const id = await newVehicle("UNDO 2");
    await setStatus(mut, id, "attente", "Teile"); await sync();
    const before = await snapshotVehicles(db, [id]);
    expect(before[0]).toMatchObject({ statut: "attente", motif: "Teile" });
    await setStatus(mut, id, "reparatur"); await sync();
    expect((await row(id)).statutMotif).toBeNull();
    await undoStatus(mut, before, "reparatur"); await sync();
    expect(await row(id)).toMatchObject({ statut: "attente", statutMotif: "Teile" });
  });

  it("status of several vehicles: each one goes back to ITS OWN previous status; vehicles that already had the new status are untouched", async () => {
    const [a, b, d] = [await newVehicle("UNDO 3a"), await newVehicle("UNDO 3b"), await newVehicle("UNDO 3c")];
    await setStatus(mut, b, "reparatur"); await setStatus(mut, d, "arrive"); await sync();
    const before = await snapshotVehicles(db, [a, b, d]);
    for (const id of [a, b, d]) await setStatus(mut, id, "reparatur");
    await sync();
    await undoStatus(mut, before, "reparatur"); await sync();
    expect([(await row(a)).statut, (await row(b)).statut, (await row(d)).statut]).toEqual(["besichtigung", "reparatur", "arrive"]);
  });

  it("move: the vehicle returns to its station; both moves are logged, the customer never changes", async () => {
    const id = await newVehicle("UNDO 4");
    await setHeader(mut, id, { clientStationId: A }); await sync();
    const before = await snapshotVehicles(db, [id]);
    await moveVehicle(mut, id, B, "move test"); await sync();
    expect((await row(id)).stationId).toBe(B);
    await undoMove(mut, before, B, "Rückgängig gemacht"); await sync();
    const r = await row(id);
    expect(r.stationId).toBe(A);
    expect(r.clientStationId).toBe(A);
    const moves = (await c.h.db.select().from(vehicleMoves).where(eq(vehicleMoves.vehicleId, id))).sort((x, y) => x.at.getTime() - y.at.getTime());
    expect(moves.map((m) => [m.fromStationId, m.toStationId, m.note])).toEqual([[A, B, "move test"], [B, A, "Rückgängig gemacht"]]);
  });

  it("an undo of something already changed back by someone else does nothing harmful", async () => {
    const id = await newVehicle("UNDO 5");
    const before = await snapshotVehicles(db, [id]);
    await setStatus(mut, id, "fertig"); await sync();
    await undoStatus(mut, before, "fertig"); await sync();
    await undoStatus(mut, before, "fertig"); await sync(); // pressed twice
    expect((await row(id)).statut).toBe("besichtigung");
  });

  it("move: a manager who only has rights on the SOURCE station loses sight of the vehicle after the move, so the server refuses his undo (nothing is lost, the vehicle sits at the destination)", async () => {
    const id = await newVehicle("UNDO 6");
    const only = phone(tokenA);
    await only.engine.syncNow(c.orgES);
    const before = await snapshotVehicles(only.db, [id]);
    await moveVehicle(only.mut, id, B); await only.engine.syncNow(c.orgES);
    expect((await row(id)).stationId).toBe(B);
    await undoMove(only.mut, before, B, "Rückgängig gemacht"); await only.engine.syncNow(c.orgES);
    expect((await row(id)).stationId).toBe(B); // refused by the server
    expect((await only.db.issues.toArray()).length).toBeGreaterThan(0); // and the user is told
  });
});
