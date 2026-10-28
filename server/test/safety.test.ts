// Phase 1 safety net: MAIL_MODE, APP_ENV, public /config, integrity report, sync backward compatibility.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KNOWN_OP_TYPES, V3_OP_TYPES, isV3Op, opSchema } from "@hagel/shared";
import { loadConfig } from "../src/config";
import { MemoryMailer, ModeMailer } from "../src/email";
import { buildReport } from "../src/scripts/integrity";
import { createDb } from "../src/db";
import { seedStaging } from "../src/scripts/seed_staging";
import { users, vehicles } from "../src/schema";
import { call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

describe("config: APP_ENV and MAIL_MODE", () => {
  it("production / unset keeps today's behaviour (live mail, new UI default)", () => {
    expect(loadConfig({}).mailMode).toBe("live");
    expect(loadConfig({ NODE_ENV: "production", SESSION_SECRET: "x".repeat(40) })).toMatchObject({ appEnv: "production", mailMode: "live", uiV3Default: true });
    expect(loadConfig({ UI_V3_DEFAULT: "false" }).uiV3Default).toBe(false);
  });
  it("staging without MAIL_MODE is silent (off), never live", () => {
    expect(loadConfig({ APP_ENV: "staging" })).toMatchObject({ appEnv: "staging", mailMode: "off" });
    expect(() => loadConfig({ APP_ENV: "staging", MAIL_MODE: "live" })).toThrow(/staging/);
  });
  it("redirect needs a target; unknown modes are refused at boot", () => {
    expect(() => loadConfig({ APP_ENV: "staging", MAIL_MODE: "redirect" })).toThrow(/MAIL_REDIRECT_TO/);
    expect(loadConfig({ APP_ENV: "staging", MAIL_MODE: "redirect", MAIL_REDIRECT_TO: "n@x.test" })).toMatchObject({ mailMode: "redirect", mailRedirectTo: "n@x.test" });
    expect(() => loadConfig({ MAIL_MODE: "maybe" })).toThrow(/MAIL_MODE/);
  });
});

describe("ModeMailer", () => {
  const mail = { to: ["a@carro.test", "b@insurer.test"], subject: "KVA", text: "Hello", attachments: [{ filename: "k.pdf", content: new Uint8Array([1]), contentType: "application/pdf" }] };
  it("live passes the mail through unchanged", async () => {
    const inner = new MemoryMailer();
    await new ModeMailer(inner, "live", null).send(mail);
    expect(inner.sent).toEqual([mail]);
  });
  it("off sends nothing", async () => {
    const inner = new MemoryMailer();
    await new ModeMailer(inner, "off", null).send(mail);
    expect(inner.sent).toHaveLength(0);
  });
  it("redirect sends ONE mail to the redirect address, original recipients in subject and body, attachment kept", async () => {
    const inner = new MemoryMailer();
    await new ModeMailer(inner, "redirect", "nicolas@pdr.test").send(mail);
    expect(inner.sent).toHaveLength(1);
    const m = inner.sent[0];
    expect(m.to).toBe("nicolas@pdr.test");
    expect(m.subject).toBe("[STAGING → a@carro.test, b@insurer.test] KVA");
    expect(m.text).toContain("a@carro.test, b@insurer.test");
    expect(m.text).toContain("Hello");
    expect(m.attachments).toHaveLength(1);
  });
});

describe("old op shapes and the public config", () => {
  let c: Ctx, st: string, cust: string, assessor: string;
  beforeAll(async () => {
    c = await setup();
    const sts = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string }[];
    st = sts.find((s) => s.type === "hall")!.id; // a place
    cust = sts.find((s) => s.type === "carrosserie")!.id; // the customer
    assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  });
  afterAll(async () => { await c.h.close(); });

  it("GET /config is public and carries no secret", async () => {
    const r = await call(c, "GET", "/config");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ appEnv: "development", uiV3Default: true });
  });

  it("every op type of the first release still parses with its original shape (contract fixtures)", () => {
    const id = uuid(), ph = uuid(), at = "2026-10-19T08:00:00.000Z";
    const base = { opId: uuid(), at };
    const fixtures: Record<string, unknown> = {
      "vehicle.create": { vehicle: { id, stationId: uuid(), header: { land: "ES", kennzeichen: "1" }, panels: { haube: dentsPanel("haube", { "20": 1 }) }, shares: { techPct: 50 } } },
      "vehicle.header": { vehicleId: id, fields: { modell: "X", glass: { ws: { on: true, eur: 100 } } } },
      "vehicle.panel": { vehicleId: id, key: "haube", panel: dentsPanel("haube", { "30": 2 }, { alu: true, method: "ptp" }) },
      "vehicle.shares": { vehicleId: id, fields: { techName: "Ana", techPct: 45, werkPct: 10, werkMode: "pct" } },
      "vehicle.status": { vehicleId: id, statut: "attente", motif: "Teile" },
      "vehicle.move": { vehicleId: id, toStationId: uuid(), note: "n" },
      "vehicle.delete": { vehicleId: id },
      "vehicle.assign": { vehicleId: id, kind: "pdr", userIds: [uuid()] },
      "vehicle.colibri": { vehicleId: id, colibri: { method: "m", kunde: "k", sprache: "de", at, imported: 1, reportTotal: 1, rowSum: 1, unknown: [] }, file: { name: "a.pdf", size: 3 } },
      "photo.add": { photo: { id: ph, vehicleId: id, label: "Dach", phase: "besichtigung", takenAt: at } },
      "photo.update": { photoId: ph, fields: { label: "Heck", inPdf: false } },
      "photo.delete": { photoId: ph },
      "report.send": { vehicleId: id, report: { id: uuid(), type: "kva", lang: "de" } },
    };
    // the fixture list must cover every type of the FIRST release; types added later are listed in V3_OP_TYPES
    expect(Object.keys(fixtures).sort()).toEqual(KNOWN_OP_TYPES.filter((t) => !V3_OP_TYPES.includes(t)).sort());
    for (const t of V3_OP_TYPES) expect(KNOWN_OP_TYPES).toContain(t);
    for (const [type, body] of Object.entries(fixtures)) {
      const r = opSchema.safeParse({ ...base, type, ...(body as object) });
      expect(r.success, `${type}: ${JSON.stringify(r.success ? "" : r.error.issues)}`).toBe(true);
    }
  });

  it("an op type this server does not know: 409 unsupported_op, NOTHING of the batch is applied (the client keeps it queued)", async () => {
    const id = uuid();
    const known = op("vehicle.create", { vehicle: { id, stationId: st, clientStationId: cust, header: { land: "ES", kennzeichen: "9999 ZZZ" }, panels: {}, shares: {} } });
    const future = op("vehicle.teleport", { vehicleId: id, to: "mars" });
    const r = await push(c, assessor, [known, future]);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "unsupported_op", opType: "vehicle.teleport" });
    expect((await c.h.db.select().from(vehicles)).find((v) => v.id === id)).toBeUndefined();
    // the same batch without the unknown op still works: nothing was poisoned
    expect((await push(c, assessor, [known])).body.results[0].status).toBe("ok");
  });

  it("a malformed batch is still a 400 (as before)", async () => {
    expect((await push(c, assessor, [{ type: "vehicle.status", opId: "nope" }])).status).toBe(400);
    expect((await call(c, "POST", "/sync/push", { token: assessor, body: { nothing: true } })).status).toBe(400);
  });

  it("new fields are invisible to old clients: a pull still has the same vehicle keys and no unknown op types are advertised", async () => {
    const p = await pull(c, assessor, c.orgES);
    expect(p.vehicles.length).toBeGreaterThan(0);
    for (const k of ["id", "statut", "panels", "groupAt", "panelsAt", "seq"]) expect(p.vehicles[0]).toHaveProperty(k);
    expect(isV3Op("vehicle.status")).toBe(false);
  });

  it("the integrity report is read-only, deterministic, and its net digest changes when a vehicle changes", async () => {
    const before = await buildReport(c.h.db);
    const again = await buildReport(c.h.db);
    expect(again.stable).toEqual(before.stable);
    const id = uuid();
    await push(c, assessor, [
      op("vehicle.create", { vehicle: { id, stationId: st, clientStationId: cust, header: { land: "ES", kennzeichen: "7777 QQQ", stundensatz: 69 }, panels: { haube: dentsPanel("haube", { "20": 30 }) }, shares: {} } }),
    ]);
    const after = await buildReport(c.h.db);
    expect(after.stable.netDigest).not.toBe(before.stable.netDigest);
    const org = (after.stable.perOrg as Record<string, { vehiclesLive: number; netTotal: number }>);
    const total = Object.values(org).reduce((a, o) => a + o.vehiclesLive, 0);
    expect(total).toBe(after.vehiclesLiveTotal);
    expect(Object.values(org).reduce((a, o) => a + o.netTotal, 0)).toBeGreaterThan(0);
  });
});

describe("staging fake data", () => {
  it("seeds fake vehicles and test users once (idempotent), visible in the integrity report", async () => {
    const h = await createDb(null);
    try {
      const a = await seedStaging(h.db, { password: "a-test-password-1", superadminEmail: "boss@staging.test" });
      expect(Object.values(a)).toEqual([16, 16]);
      const b = await seedStaging(h.db, { password: "a-test-password-1", superadminEmail: "boss@staging.test" });
      expect(Object.values(b)).toEqual([0, 0]);
      expect((await h.db.select().from(users).where(eq(users.email, "boss@staging.test")))[0].passwordHash).toBeTruthy();
      const rep = await buildReport(h.db);
      expect(rep.vehiclesLiveTotal).toBe(32);
      expect((await h.db.select().from(users)).length).toBe(7); // super-admin + 3 people per organisation
      expect(Object.values(rep.stable.perOrg as Record<string, { netTotal: number }>).every((o) => o.netTotal > 0)).toBe(true);
    } finally { await h.close(); }
  });
});
