import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeVehicle, type CalcVehicle } from "@hagel/calc";
import golden from "../../fixtures/golden_cases_v20.json";
import { LocalDb } from "../src/sync/db";
import { SyncEngine, type Http } from "../src/sync/engine";
import { createVehicle, type MutCtx } from "../src/sync/mutations";
import { applyColibriToVehicle, colibriBadge, readColibriFile } from "../src/sync/colibriImport";
import { parseBackup, planImport, runImport, type OldBackup } from "../src/sync/backup";
import { buildOldFormatBackup } from "../src/sync/exportBackup";
import { findPlate, findVIN } from "../src/field/ocrText";
import { uuid5 } from "../src/sync/uuid";
import { call, inviteAndAccept, setup, type Ctx } from "../../server/test/helpers";

let c: Ctx, A: string, B: string, P: string, n = 0;
interface Phone { db: LocalDb; engine: SyncEngine; ctx: MutCtx; token: string }
function phone(token: string): Phone {
  const db = new LocalDb(`imp-${++n}`);
  const http: Http = async (method, path, body, init) => {
    const raw = init?.raw ? new Uint8Array(await (init.raw as Blob).arrayBuffer()) : undefined;
    const r = await call(c, method, path, { token, org: init?.org ?? c.orgES, body: raw ? undefined : body, raw, contentType: init?.contentType });
    return { status: r.status, data: r.body, blob: init?.blob ? new Blob([r.bytes], { type: r.headers.get("content-type") ?? "" }) : undefined };
  };
  const engine = new SyncEngine({ db, http });
  return { db, engine, token, ctx: { engine, db, orgId: c.orgES } };
}
const sync = (p: Phone) => p.engine.syncNow(c.orgES);
const tokens: Record<string, string> = {};

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "carrosserie").id; // the customer
  P = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id; B = st.find((s) => s.type === "hall" && s.name === "Nave PDR Madrid").id; // places
  tokens.admin = await inviteAndAccept(c, c.orgES, "admin@example.test", { role_id: c.roleId.org_admin });
  tokens.assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  tokens.tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: P });
});
afterAll(async () => { await c.h.close(); });

// ------------------------------------------------------------------ Colibri import with the REAL report
describe("Colibri import (real PDF, 618 dents)", () => {
  const file = new URL("../../fixtures/real/colibri_en_9547LPV.pdf", import.meta.url);
  it("fills the vehicle like v20, shows Scan ✓, uploads the PDF, another phone can download it", async () => {
    const buf = readFileSync(file);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const pa = phone(tokens.assessor), pb = phone(tokens.admin);
    await sync(pa); await sync(pb);
    const id = await createVehicle(pa.ctx, { stationId: P, clientStationId: A });
    const res = await readColibriFile(bytes);
    expect(res).toBeTruthy();
    const v = (await pa.db.vehicles.get(id))!;
    const r = await applyColibriToVehicle(pa.ctx, v, res!, { name: "scan.pdf", bytes });
    expect(r).toMatchObject({ ok: true, imported: 618, total: 618, match: true, panels: 12, plate: "9547 LPV" });
    const local = (await pa.db.vehicles.get(id))!;
    expect(local.kennzeichen).toBe("9547 LPV");
    expect(local.leistungsdatum).toBe("2026-10-19");
    expect((local.panels.dachholm_l as any).kleber).toBe(true);
    expect(colibriBadge(local)).toBe("ok");
    await sync(pa); await sync(pa);
    expect(await pa.db.uploads.count()).toBe(0);
    await sync(pb);
    const remote = (await pb.db.vehicles.get(id))!;
    expect(remote.panels.dach).toBeTruthy();
    expect(Object.keys(remote.panels).length).toBe(12);
    const scan = await pb.engine.ensureScanBlob(id);
    expect(scan!.size).toBe(buf.length);
    // the same numbers on both phones, and the engine agrees with the 22-case calculation rules
    expect(computeVehicle(remote as unknown as CalcVehicle).dents).toBe(618);
  });
  it("a PDF that is not a Colibri report is refused (nothing changes)", async () => {
    const junk = new TextEncoder().encode("%PDF-1.4 nothing here").buffer as ArrayBuffer;
    expect(await readColibriFile(junk)).toBeNull();
  });
});

// ------------------------------------------------------------------ old backup import (migration)
const cases = (golden as unknown as { cases: { case: string; input: any }[] }).cases;
function fakeBackup(): OldBackup {
  const vehicles = cases.filter((x) => x.case.endsWith("_ES") || x.case.endsWith("_DE")).slice(0, 8).map((x, i) => ({
    ...x.input, id: `old${i}${x.case.slice(-2)}`, kennzeichen: `PLATE ${i}`, fin: "", modell: `Model ${i}`, kunde: i % 2 ? "Carrosserie Test Talavera" : "Unknown Shop",
    kundeEmail: "a@b.test", leistungsdatum: "2026-10-1" + (i % 9), zustand: ["Trocken", "Sauber"], notiz: `note ${i}`, techName: "Luis", techPct: 55, demTechPct: 80, werkPct: 20, werkMode: "pct",
    status: i % 3 === 0 ? "reparatur" : undefined, createdAt: 1_760_000_000_000 + i, images: i < 3 ? [{ id: `img${i}a`, label: "Vorderansicht" }, { id: `img${i}b`, label: "Dach" }] : [],
  }));
  const jpegB64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  const images: Record<string, string> = {};
  vehicles.forEach((v) => (v.images ?? []).forEach((im: any) => { images[im.id] = `data:image/jpeg;base64,${jpegB64}`; }));
  const scans = { [vehicles[0].id]: { name: "scan.pdf", b64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64") } };
  (vehicles[0] as any).colibri = { imported: 523, reportTotal: 523, rowSum: 523, unknown: [] };
  (vehicles[0] as any).colibriFile = { name: "scan.pdf" };
  return { app: "hes-hagel", version: "v20", created: "2026-10-18T10:00:00Z", vehicles, customers: [], settings: {}, images, scans };
}

describe("old backup import", () => {
  const backup = fakeBackup();
  it("rejects files that are not a v20 backup", () => {
    expect(parseBackup("not json")).toBeNull();
    expect(parseBackup(JSON.stringify({ app: "other", vehicles: [] }))).toBeNull();
    expect(parseBackup(JSON.stringify(backup))).toBeTruthy();
  });
  it("deterministic ids: same old vehicle → same new id, different vehicles differ", async () => {
    expect(await uuid5("vehicle:abc")).toBe(await uuid5("vehicle:abc"));
    expect(await uuid5("vehicle:abc")).not.toBe(await uuid5("vehicle:abd"));
    expect(await uuid5("vehicle:abc")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  let net = 0;
  it("imports vehicles, photos and the scan; every net price equals the old app's (to the cent); customers are matched", async () => {
    const p = phone(tokens.admin);
    await sync(p);
    const refs: any = await p.db.getMeta(`refs:${c.orgES}`);
    const plan = await planImport(backup, refs, new Set(), { rateDE: 83, rateES: 69, defaultTeiler: 10, vatDE: 0.19, esMatrix: (await import("@hagel/calc")).ES_MATRIX_DEFAULT });
    expect(plan.items.length).toBe(8);
    expect(plan.photos).toBe(6);
    expect(plan.scans).toBe(1);
    expect(plan.unmatched).toEqual(["Unknown Shop"]);
    expect(plan.items.filter((i) => i.matched).length).toBe(4);
    net = plan.netSum;
    const res = await runImport(p.ctx, backup, plan, { stationId: B, fallbackClientId: A, replaceNewer: false }, true);
    expect(res).toMatchObject({ created: 8, photos: 6, scans: 1, failed: [] });
    await sync(p); await sync(p); await sync(p);
    expect(await p.db.outbox.count()).toBe(0);
    expect(await p.db.uploads.count()).toBe(0);
    const importedIds = new Set(plan.items.map((i) => i.newId));
    const vs = (await p.db.vehicles.toArray()).filter((v) => importedIds.has(v.id));
    expect(vs.length).toBe(8);
    const after = vs.reduce((a, v) => a + computeVehicle(v as unknown as CalcVehicle).netto, 0);
    expect(after).toBeCloseTo(net, 2);
    // per vehicle
    for (const it of plan.items) {
      const v = vs.find((x) => x.id === it.newId)!;
      expect(computeVehicle(v as unknown as CalcVehicle).netto).toBeCloseTo(it.net, 2);
      expect(v.stationId).toBe(B);
      expect(v.clientStationId).toBe(it.clientStationId ?? A);
    }
    const first = vs.find((v) => v.id === plan.items[0].newId)!;
    expect(first.statut).toBe("reparatur"); // v20 "reparatur" folder
    expect(first).toMatchObject({ kennzeichen: "PLATE 0", techName: "Luis", techPct: 55, werkPct: 20 });
    expect((await p.db.photos.toArray()).length).toBe(6);
    expect((await p.db.photos.toArray()).every((x) => x.hasFile)).toBe(true);
  });
  it("importing the same file again (or from another phone) creates no duplicates", async () => {
    const p2 = phone(tokens.assessor);
    await sync(p2);
    const refs: any = await p2.db.getMeta(`refs:${c.orgES}`);
    const existing = new Set((await p2.db.vehicles.toArray()).map((v) => v.id));
    const plan = await planImport(backup, refs, existing, { rateDE: 83, rateES: 69, defaultTeiler: 10, vatDE: 0.19, esMatrix: (await import("@hagel/calc")).ES_MATRIX_DEFAULT });
    expect(plan.items.every((i) => i.duplicate)).toBe(true);
    const res = await runImport(p2.ctx, backup, plan, { stationId: B, fallbackClientId: A, replaceNewer: false }, false);
    expect(res).toMatchObject({ created: 0, skipped: 8 });
    await sync(p2);
    const server = (await call(c, "GET", "/sync/pull?since=0&limit=500", { token: c.superToken, org: c.orgES })).body;
    const old = server.vehicles.filter((v: any) => String(v.kennzeichen).startsWith("PLATE"));
    expect(old.length).toBe(8);
  });
  it("technicians cannot import (no create right): everything is refused and cleaned up locally", async () => {
    const p = phone(tokens.tech);
    await sync(p);
    const small: OldBackup = { ...backup, vehicles: [{ ...backup.vehicles[1], id: "zz-tech" }], images: {}, scans: {} };
    const plan = await planImport(small, await p.db.getMeta(`refs:${c.orgES}`), new Set(), { rateDE: 83, rateES: 69, defaultTeiler: 10, vatDE: 0.19, esMatrix: (await import("@hagel/calc")).ES_MATRIX_DEFAULT });
    await runImport(p.ctx, small, plan, { stationId: P, fallbackClientId: A, replaceNewer: false }, false);
    await sync(p);
    expect((await p.db.vehicles.toArray()).some((v) => v.kennzeichen === "PLATE 1")).toBe(false);
    expect((await p.db.issues.toArray()).some((i) => i.opType === "vehicle.create")).toBe(true);
  });
});

describe("export in the old format", () => {
  it("what the phone holds can be written as a v20-compatible file and re-read by the importer (same count, same net prices)", async () => {
    const p = phone(tokens.admin);
    await sync(p);
    const refs: any = await p.db.getMeta(`refs:${c.orgES}`);
    const out = await buildOldFormatBackup(p.db, c.orgES, refs, true);
    const parsed = parseBackup(out.json)!;
    expect(parsed).toBeTruthy();
    expect(parsed.vehicles.length).toBe(out.vehicles);
    expect(parsed.vehicles.length).toBeGreaterThanOrEqual(8);
    const calc = { rateDE: 83, rateES: 69, defaultTeiler: 10, vatDE: 0.19, esMatrix: (await import("@hagel/calc")).ES_MATRIX_DEFAULT };
    const plan = await planImport(parsed, refs, new Set(), calc);
    const direct = (await p.db.vehicles.toArray()).reduce((a, v) => a + computeVehicle(v as unknown as CalcVehicle).netto, 0);
    expect(plan.netSum).toBeCloseTo(direct, 2);
    expect(parsed.vehicles.every((v: any) => ["besichtigung", "reparatur"].includes(v.status))).toBe(true);
    expect(Object.keys(parsed.images ?? {}).length).toBe(out.photos);
  });
  it("a technician's export contains no prices or split fields (only what the phone holds)", async () => {
    const pa = phone(tokens.assessor), pt = phone(tokens.tech);
    await sync(pa);
    const refsA: any = await pa.db.getMeta(`refs:${c.orgES}`);
    const id = (await pa.db.vehicles.toArray()).find((v) => v.stationId === P)!.id;
    const techId = (await call(c, "GET", "/admin/users", { token: c.superToken, org: c.orgES })).body.find((u: any) => u.email === "tech@example.test").id;
    const { assignVehicle } = await import("../src/sync/mutations");
    await assignVehicle(pa.ctx, id, "pdr", [techId]);
    await sync(pa); await sync(pt);
    const refsT: any = await pt.db.getMeta(`refs:${c.orgES}`);
    const out = await buildOldFormatBackup(pt.db, c.orgES, refsT, false);
    const txt = out.json;
    expect(out.vehicles).toBe(1);
    for (const k of ["stundensatz", "techName", "techPct", "werkPct", "demontageEur", "bigEur", "netto"]) expect(txt).not.toContain(`"${k}"`);
    void refsA;
  });
});

describe("offline text recognition fallback", () => {
  it("finds a VIN (O/Q/I cleaned) and plates (DE / ES)", () => {
    expect(findVIN("VIN: WVWZZZ1JZXW000001\nfoo")).toBe("WVWZZZ1JZXW000001");
    expect(findVIN("wvw zzz1jzxw0o0qi1")).toBe("WVWZZZ1JZXW000011");
    expect(findVIN("nothing")).toBe("");
    expect(findPlate("xx 1234 BCD yy")).toBe("1234 BCD");
    expect(findPlate("KEL-LE 700")).toBe("KEL-LE 700");
    expect(findPlate("M AB 1234")).toBe("M-AB 1234");
    expect(findPlate("hello")).toBe("");
  });
});
