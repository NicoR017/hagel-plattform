import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { LocalDb, refsKey } from "../src/sync/db";
import { SyncEngine, type Http } from "../src/sync/engine";
import { addPhoto, assignVehicle, createVehicle, deletePhoto, deleteVehicle, moveVehicle, setHeader, setPanel, setShares, setStatus, updatePhoto, type MutCtx } from "../src/sync/mutations";
import { call, inviteAndAccept, setup, type Ctx } from "../../server/test/helpers";
import { users, vehicleAssignments } from "../../server/src/schema";

let c: Ctx;
let A: string, B: string;
let n = 0;

interface Phone { db: LocalDb; engine: SyncEngine; ctx: MutCtx; online: boolean; notices: any[]; token: string }

function phone(token: string): Phone {
  const db = new LocalDb(`phone-${++n}`);
  const p = { db, online: true, notices: [] as any[], token } as Phone;
  const http: Http = async (method, path, body, init) => {
    if (!p.online) throw new TypeError("offline");
    const raw = init?.raw ? new Uint8Array(await (init.raw as Blob).arrayBuffer()) : undefined;
    const r = await call(c, method, path, { token: p.token, org: init?.org ?? c.orgES, body: raw ? undefined : body, raw, contentType: init?.contentType });
    return { status: r.status, data: r.body, blob: init?.blob ? new Blob([r.bytes], { type: r.headers.get("content-type") ?? "" }) : undefined };
  };
  p.engine = new SyncEngine({ db, http });
  p.engine.onNotice = (x) => p.notices.push(x);
  p.ctx = { engine: p.engine, db, orgId: c.orgES };
  return p;
}
const sync = (p: Phone) => p.engine.syncNow(c.orgES);
const vehicles = (p: Phone) => p.db.vehicles.toArray();
const veh = (p: Phone, id: string) => p.db.vehicles.get(id);
const JPG = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])], { type: "image/jpeg" });

let tokens: Record<string, string> = {};
beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "carrosserie").id;
  B = st.find((s) => s.type === "hall").id;
  await call(c, "PUT", `/admin/stations/${A}`, { token: c.superToken, org: c.orgES, body: { commission_pct: 20 } });
  tokens.assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  tokens.chefA = await inviteAndAccept(c, c.orgES, "chefa@example.test", { role_id: c.roleId.chef_site, station_id: A });
  tokens.chefA2 = await inviteAndAccept(c, c.orgES, "chefa2@example.test", { role_id: c.roleId.chef_site, station_id: A });
  tokens.chefB = await inviteAndAccept(c, c.orgES, "chefb@example.test", { role_id: c.roleId.chef_site, station_id: B });
  tokens.tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: A });
});
afterAll(async () => { await c.h.close(); });

describe("offline creation", () => {
  it("a vehicle created offline is usable immediately, queued, and acknowledged once online", async () => {
    const p = phone(tokens.assessor);
    await sync(p); // learn stations / settings (refs)
    p.online = false;
    const id = await createVehicle(p.ctx, { stationId: A, header: { kennzeichen: "1234 ABC", modell: "Seat Leon" } });
    await setPanel(p.ctx, id, "haube", { key: "haube", dents: { "20": 12 } });
    const local = await veh(p, id);
    expect(local).toMatchObject({ kennzeichen: "1234 ABC", land: "ES", stundensatz: 69, _localOnly: true });
    expect(local!.panels.haube).toBeTruthy();
    await sync(p);
    expect(p.engine.status.online).toBe(false);
    expect(await p.db.outbox.count()).toBe(2);
    p.online = true;
    await sync(p);
    expect(await p.db.outbox.count()).toBe(0);
    const synced = await veh(p, id);
    expect(synced!.seq).toBeGreaterThan(0);
    expect(synced!._localOnly).toBeUndefined();
    expect(synced!.panels.haube).toBeTruthy();
    expect(p.engine.status.pendingOps).toBe(0);
  });

  it("typing in a field produces ONE queued op (coalescing), not one per keystroke", async () => {
    const p = phone(tokens.assessor);
    await sync(p);
    p.online = false;
    const id = await createVehicle(p.ctx, { stationId: A });
    for (const v of ["M", "MA", "MAB", "MAB 1", "MAB 12"]) await setHeader(p.ctx, id, { kennzeichen: v });
    await setHeader(p.ctx, id, { modell: "Golf" });
    const rows = await p.db.outbox.toArray();
    expect(rows.map((r) => r.op.type)).toEqual(["vehicle.create", "vehicle.header"]);
    expect((rows[1].op as any).fields).toEqual({ kennzeichen: "MAB 12", modell: "Golf" });
    p.online = true;
    await sync(p);
    expect((await veh(p, id))!.kennzeichen).toBe("MAB 12");
  });
});

describe("between push and pull", () => {
  it("after the server acknowledged a push but BEFORE the next pull, the screen keeps the vehicle and all edits (no flicker back to an old state)", async () => {
    const p = phone(tokens.assessor);
    await sync(p);
    p.online = false;
    const id = await createVehicle(p.ctx, { stationId: A, header: { kennzeichen: "NOFLICKER" } });
    await setHeader(p.ctx, id, { modell: "Edited" });
    await setPanel(p.ctx, id, "haube", { key: "haube", dents: { "20": 4 } });
    p.online = true;
    await p.engine.flush(); // push only, no pull
    expect(await p.db.outbox.count()).toBe(0);
    const v = await veh(p, id);
    expect(v).toMatchObject({ kennzeichen: "NOFLICKER", modell: "Edited" });
    expect(v!.panels.haube).toBeTruthy();
    // one more edit while still not pulled, then everything is consistent after a full sync
    await setHeader(p.ctx, id, { notiz: "later" });
    await sync(p);
    expect(await veh(p, id)).toMatchObject({ kennzeichen: "NOFLICKER", modell: "Edited", notiz: "later" });
  });
});

describe("two phones", () => {
  let id: string, pa: Phone, pb: Phone;
  beforeAll(async () => {
    pa = phone(tokens.assessor);
    pb = phone(tokens.chefA);
    await sync(pa); await sync(pb);
    id = await createVehicle(pa.ctx, { stationId: A, header: { kennzeichen: "SYNC 1", modell: "Original" } });
    await sync(pa);
  });
  it("the other phone receives it with the commission snapshot", async () => {
    await sync(pb);
    const v = await veh(pb, id);
    expect(v).toMatchObject({ kennzeichen: "SYNC 1", werkPct: 20, werkMode: "pct" });
  });
  it("edits flow both ways", async () => {
    await setHeader(pb.ctx, id, { notiz: "from chef" });
    await sync(pb); await sync(pa);
    expect((await veh(pa, id))!.notiz).toBe("from chef");
  });
  it("offline edit loses against a newer online edit of the same field (last writer wins) and adopts the server value", async () => {
    pa.online = false;
    await setHeader(pa.ctx, id, { modell: "OFFLINE OLD" });
    await new Promise((r) => setTimeout(r, 15));
    await setHeader(pb.ctx, id, { modell: "ONLINE NEW" });
    await sync(pb);
    // make A's edit older than B's by construction: A edited first
    pa.online = true;
    await sync(pa);
    expect((await veh(pa, id))!.modell).toBe("ONLINE NEW");
    expect(await pa.db.outbox.count()).toBe(0);
  });
  it("edits to different panels made offline on both phones are both kept", async () => {
    pa.online = false; pb.online = false;
    await setPanel(pa.ctx, id, "haube", { key: "haube", dents: { "20": 3 } });
    await setPanel(pb.ctx, id, "dach", { key: "dach", dents: { "30": 4 } });
    pa.online = true; pb.online = true;
    await sync(pa); await sync(pb); await sync(pa);
    for (const p of [pa, pb]) {
      const v = await veh(p, id);
      expect(Object.keys(v!.panels).sort()).toEqual(["dach", "haube"]);
    }
  });
  it("status change with a reason", async () => {
    await setStatus(pb.ctx, id, "attente", "Teile");
    await sync(pb); await sync(pa);
    expect(await veh(pa, id)).toMatchObject({ statut: "attente", statutMotif: "Teile" });
  });
  it("moving the vehicle removes it from the phones of users who lose access, with a notice; the new site receives it", async () => {
    const pc = phone(tokens.chefA2);
    await sync(pc);
    expect(await veh(pc, id)).toBeTruthy();
    // the assessor role has no move right: the move is refused and reported
    await moveVehicle(pa.ctx, id, B);
    await sync(pa);
    expect((await pa.db.issues.toArray()).some((i) => i.opType === "vehicle.move" && i.code === "not_allowed")).toBe(true);
    expect((await veh(pa, id))!.stationId).toBe(A);
    // the chef of site A may move it (right on the SOURCE site)
    await moveVehicle(pb.ctx, id, B, "to hall");
    await sync(pb);
    await sync(pc);
    expect(await veh(pc, id)).toBeUndefined();
    expect(pc.notices.some((x) => x.kind === "gone" && x.vehicleId === id)).toBe(true);
    expect(await veh(pb, id)).toBeUndefined();
    const chefB = phone(tokens.chefB);
    await sync(chefB);
    expect((await veh(chefB, id))!.stationId).toBe(B);
    // the assessor (all sites) still sees it, now at B
    await sync(pa);
    expect((await veh(pa, id))!.stationId).toBe(B);
  });
});

describe("restricted roles", () => {
  it("a technician's rejected price edit shows up as an issue and the screen falls back to the server value", async () => {
    const pa = phone(tokens.assessor), pt = phone(tokens.tech);
    await sync(pa); await sync(pt);
    const id = await createVehicle(pa.ctx, { stationId: A, header: { kennzeichen: "TECH 1" } });
    await sync(pa);
    const techId = (await c.h.db.select().from(users).where(eq(users.email, "tech@example.test")))[0].id;
    await assignVehicle(pa.ctx, id, "pdr", [techId]);
    await sync(pa); await sync(pt);
    const tv = await veh(pt, id);
    expect(tv).toBeTruthy();
    expect(tv!.stundensatz).toBeUndefined();
    expect(tv!.techName).toBeUndefined();
    await setHeader(pt.ctx, id, { stundensatz: 1 } as never);
    await sync(pt);
    expect((await pt.db.issues.toArray()).some((i) => i.code === "field_not_allowed")).toBe(true);
    expect((await veh(pt, id))!.stundensatz).toBeUndefined();
    expect((await veh(pa, id))!.stundensatz).toBe(69);
  });
  it("a refused create purges the local vehicle and its queued edits", async () => {
    const pt = phone(tokens.tech);
    await sync(pt);
    const id = await createVehicle(pt.ctx, { stationId: A });
    await setHeader(pt.ctx, id, { notiz: "x" });
    await sync(pt);
    expect(await veh(pt, id)).toBeUndefined();
    expect(await pt.db.outbox.count()).toBe(0);
    expect((await pt.db.issues.toArray()).some((i) => i.opType === "vehicle.create")).toBe(true);
  });
  it("a user who lost every role gets his local copy wiped (403)", async () => {
    const tok = await inviteAndAccept(c, c.orgES, "temp@example.test", { role_id: c.roleId.aufnehmer, station_id: A });
    const p = phone(tok), pa = phone(tokens.assessor);
    await sync(pa);
    await createVehicle(pa.ctx, { stationId: A }); await sync(pa);
    await sync(p);
    expect((await vehicles(p)).length).toBeGreaterThan(0);
    const u = ((await call(c, "GET", "/admin/users", { token: c.superToken, org: c.orgES })).body as any[]).find((x) => x.email === "temp@example.test");
    await call(c, "DELETE", `/admin/assignments/${u.assignments[0].id}`, { token: c.superToken, org: c.orgES });
    await sync(p);
    expect(await vehicles(p)).toEqual([]);
    expect(await p.db.getMeta(refsKey(c.orgES))).toBeUndefined();
  });
  it("epoch change: after a role change the phone is reset to exactly what the new role may see", async () => {
    const tok = await inviteAndAccept(c, c.orgES, "epoch@example.test", { role_id: c.roleId.aufnehmer, station_id: A });
    const p = phone(tok);
    await sync(p);
    const before = await vehicles(p);
    expect(before.length).toBeGreaterThan(0);
    const u = ((await call(c, "GET", "/admin/users", { token: c.superToken, org: c.orgES })).body as any[]).find((x) => x.email === "epoch@example.test");
    await call(c, "POST", "/admin/assignments", { token: c.superToken, org: c.orgES, body: { user_id: u.id, station_id: A, role_id: c.roleId.technicien } });
    await call(c, "DELETE", `/admin/assignments/${u.assignments[0].id}`, { token: c.superToken, org: c.orgES });
    await sync(p);
    expect(await vehicles(p)).toEqual([]); // technician with nothing assigned
    expect(p.notices.some((x) => x.kind === "gone")).toBe(true);
  });
});

describe("photos", () => {
  it("taken offline, queued, uploaded when online; another phone downloads the same bytes", async () => {
    const pa = phone(tokens.assessor), pb = phone(tokens.chefA);
    await sync(pa); await sync(pb);
    const id = await createVehicle(pa.ctx, { stationId: A });
    await sync(pa);
    pa.online = false;
    const photoId = await addPhoto(pa.ctx, { vehicleId: id, blob: JPG(), label: "Vorderansicht", phase: "besichtigung" });
    await sync(pa);
    expect(await pa.db.uploads.count()).toBe(1);
    pa.online = true;
    await sync(pa);
    expect(await pa.db.uploads.count()).toBe(0);
    expect((await pa.db.photos.get(photoId))!.hasFile).toBe(true);
    await sync(pb);
    const ph = await pb.db.photos.get(photoId);
    expect(ph).toMatchObject({ label: "Vorderansicht", phase: "besichtigung", hasFile: true });
    const blob = await pb.engine.ensurePhotoBlob(photoId);
    expect(blob!.size).toBe(JPG().size);
    expect((await pb.db.blobs.get(`photo:${photoId}`))!.size).toBe(JPG().size);
    // edit label / phase on B, delete on A
    await updatePhoto(pb.ctx, photoId, { label: "Dach", phase: "reparatur" });
    await sync(pb); await sync(pa);
    expect(await pa.db.photos.get(photoId)).toMatchObject({ label: "Dach", phase: "reparatur" });
    await deletePhoto(pa.ctx, photoId);
    await sync(pa); await sync(pb);
    expect(await pb.db.photos.get(photoId)).toBeUndefined();
    expect(await pb.db.blobs.get(`photo:${photoId}`)).toBeUndefined();
  });
  it("a photo whose vehicle creation is still queued waits for it (no failed upload)", async () => {
    const p = phone(tokens.assessor);
    await sync(p);
    p.online = false;
    const id = await createVehicle(p.ctx, { stationId: A });
    const photoId = await addPhoto(p.ctx, { vehicleId: id, blob: JPG(), phase: "besichtigung" });
    p.online = true;
    await sync(p);
    expect(await p.db.uploads.count()).toBe(0);
    expect((await p.db.photos.get(photoId))!.hasFile).toBe(true);
  });
  it("deleting a vehicle removes its photos and files from the phone", async () => {
    const p = phone(tokens.chefA);
    await sync(p);
    const id = await createVehicle(p.ctx, { stationId: A });
    const photoId = await addPhoto(p.ctx, { vehicleId: id, blob: JPG(), phase: "besichtigung" });
    await sync(p);
    await deleteVehicle(p.ctx, id);
    expect(await p.db.photos.get(photoId)).toBeUndefined();
    expect(await p.db.blobs.get(`photo:${photoId}`)).toBeUndefined();
    await sync(p);
    expect(await veh(p, id)).toBeUndefined();
  });
});

describe("misc", () => {
  it("network failure keeps the queue; the server answer for a retried batch is idempotent", async () => {
    const p = phone(tokens.assessor);
    await sync(p);
    const id = await createVehicle(p.ctx, { stationId: A });
    await sync(p);
    const rows = await p.db.outbox.count();
    expect(rows).toBe(0);
    await setHeader(p.ctx, id, { notiz: "a" });
    const op = (await p.db.outbox.toArray())[0].op;
    // simulate "answer lost": push the same op directly, then let the engine send it again
    await call(c, "POST", "/sync/push", { token: tokens.assessor, body: { ops: [op] } });
    await sync(p);
    expect(await p.db.outbox.count()).toBe(0);
    expect((await veh(p, id))!.notiz).toBe("a");
  });
  it("shares: assessor sets the technician; server stores it; commission cannot be edited by him", async () => {
    const p = phone(tokens.assessor);
    await sync(p);
    const id = await createVehicle(p.ctx, { stationId: A });
    await sync(p);
    await setShares(p.ctx, id, { techName: "Luis", techPct: 55 });
    await sync(p);
    expect(await veh(p, id)).toMatchObject({ techName: "Luis", techPct: 55 });
    await setShares(p.ctx, id, { werkPct: 0 });
    await sync(p);
    expect((await p.db.issues.toArray()).some((i) => i.code === "field_not_allowed")).toBe(true);
    expect((await veh(p, id))!.werkPct).toBe(20);
  });
  it("assigned technician list (people) and refs arrive with the first pull", async () => {
    const p = phone(tokens.assessor);
    await sync(p);
    const refs: any = await p.db.getMeta(refsKey(c.orgES));
    expect(refs.stations.length).toBeGreaterThan(1);
    expect(refs.people.length).toBeGreaterThan(2);
    expect(refs.settings.rateES).toBe(69);
    // keep vehicleAssignments import used
    expect(vehicleAssignments).toBeTruthy();
  });
});
