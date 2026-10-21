// Rollout safety on the phone side: pending offline ops survive a server that does not know a newer op type yet, and arrive afterwards.
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDb } from "../src/sync/db";
import { SyncEngine, type Http } from "../src/sync/engine";
import { createVehicle, setHeader, setPanel, setStatus, type MutCtx } from "../src/sync/mutations";
import { call, inviteAndAccept, setup, type Ctx } from "../../server/test/helpers";

let c: Ctx, A: string, token: string;

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string }[];
  A = st.find((s) => s.type === "carrosserie")!.id;
  token = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
});
afterAll(async () => { await c.h.close(); });

describe("pending ops across a deploy", () => {
  it("3 offline ops: a server answering 409 unsupported_op (older/newer mismatch) loses nothing; once it accepts, all arrive", async () => {
    const db = new LocalDb("compat-1");
    let mode: "offline" | "unsupported" | "ok" = "offline";
    let pushes = 0;
    const http: Http = async (method, path, body, init) => {
      if (mode === "offline") throw new TypeError("offline");
      if (mode === "unsupported" && path === "/sync/push") { pushes++; return { status: 409, data: { code: "unsupported_op", error: "x" } }; }
      const raw = init?.raw ? new Uint8Array(await (init.raw as Blob).arrayBuffer()) : undefined;
      const r = await call(c, method, path, { token, org: init?.org ?? c.orgES, body: raw ? undefined : body, raw, contentType: init?.contentType });
      return { status: r.status, data: r.body, blob: init?.blob ? new Blob([r.bytes]) : undefined };
    };
    const engine = new SyncEngine({ db, http });
    const ctx: MutCtx = { engine, db, orgId: c.orgES };
    mode = "ok"; await engine.syncNow(c.orgES); mode = "offline"; // learn refs while online, then go offline

    const id = await createVehicle(ctx, { stationId: A, header: { kennzeichen: "4321 XYZ", modell: "Seat Ibiza" } });
    await setPanel(ctx, id, "haube", { key: "haube", dents: { "20": 5 } });
    await setStatus(ctx, id, "besichtigung");
    expect(await db.outbox.count()).toBe(3);

    mode = "unsupported"; await engine.syncNow(c.orgES);
    expect(pushes).toBeGreaterThan(0);
    expect(await db.outbox.count()).toBe(3); // nothing dropped, nothing issued
    expect(await db.issues.count()).toBe(0);
    expect((await db.vehicles.get(id))!.kennzeichen).toBe("4321 XYZ"); // the screen keeps working locally

    mode = "ok"; await engine.syncNow(c.orgES);
    expect(await db.outbox.count()).toBe(0);
    const v = await db.vehicles.get(id);
    expect(v).toMatchObject({ statut: "besichtigung", kennzeichen: "4321 XYZ" });
    expect(v!.panels.haube).toBeTruthy();
    expect(v!.seq).toBeGreaterThan(0);
    await setHeader(ctx, id, { modell: "Seat Leon" }); // and it keeps syncing afterwards
    await engine.syncNow(c.orgES);
    expect(await db.outbox.count()).toBe(0);
  });
});
