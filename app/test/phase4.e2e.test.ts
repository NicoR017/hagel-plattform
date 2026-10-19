import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDb, type Refs } from "../src/sync/db";
import { SyncEngine, type Http } from "../src/sync/engine";
import { createVehicle, sendReport, setHeader, type MutCtx } from "../src/sync/mutations";
import { letterheadFor, toDoc } from "../src/field/docs";
import { call, inviteAndAccept, setup, type Ctx } from "../../server/test/helpers";

let c: Ctx, A: string, n = 0, ins: string;
interface Phone { db: LocalDb; engine: SyncEngine; ctx: MutCtx; online: boolean; token: string }
function phone(token: string): Phone {
  const db = new LocalDb(`p4-${++n}`);
  const p = { db, online: true, token } as Phone;
  const http: Http = async (method, path, body, init) => {
    if (!p.online) throw new TypeError("offline");
    const raw = init?.raw ? new Uint8Array(await (init.raw as Blob).arrayBuffer()) : undefined;
    const r = await call(c, method, path, { token: p.token, org: init?.org ?? c.orgES, body: raw ? undefined : body, raw, contentType: init?.contentType });
    return { status: r.status, data: r.body, blob: init?.blob ? new Blob([r.bytes], { type: r.headers.get("content-type") ?? "" }) : undefined };
  };
  p.engine = new SyncEngine({ db, http });
  p.ctx = { engine: p.engine, db, orgId: c.orgES };
  return p;
}
const sync = (p: Phone) => p.engine.syncNow(c.orgES);
const refsOf = (p: Phone) => p.db.getMeta<Refs>(`refs:${c.orgES}`) as Promise<Refs>;
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
const tokens: Record<string, string> = {};

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "carrosserie").id;
  await call(c, "PUT", `/admin/stations/${A}`, { token: c.superToken, org: c.orgES, body: { report_emails: ["taller@example.test"], commission_pct: 20 } });
  ins = (await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Mutua", report_emails: ["mutua@example.test"], send_reports: true, reports_to_send: "both" } })).body.id;
  await call(c, "PUT", `/admin/stations/${A}/insurers`, { token: c.superToken, org: c.orgES, body: { insurer_ids: [ins] } });
  await call(c, "POST", "/admin/campaigns", { token: c.superToken, org: c.orgES, body: { name: "Camp 1", country: "ES", station_ids: [A] } });
  await call(c, "POST", "/admin/technicians", { token: c.superToken, org: c.orgES, body: { name: "Luis", default_pct_pdr: 55, default_pct_demontage: 80 } });
  tokens.assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  tokens.tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: A });
});
afterAll(async () => { await c.h.close(); });

describe("master data on the phone", () => {
  it("insurers, links, campaigns, letterheads and technicians arrive with the first pull; new vehicles default to the PDR letterhead", async () => {
    const p = phone(tokens.assessor);
    await sync(p);
    const refs = await refsOf(p);
    expect(refs.insurers.map((i) => i.name)).toEqual(["Mutua"]);
    expect(refs.stationInsurers).toEqual([{ stationId: A, insurerId: ins }]);
    expect(refs.campaigns.map((x) => x.name)).toEqual(["Camp 1"]);
    expect(refs.companies.map((x) => x.name).sort()).toEqual(["Neutral (ohne Logo)", "PDR Team GmbH"]);
    expect(refs.technicians).toEqual([expect.objectContaining({ name: "Luis", defaultPctPdr: 55, defaultPctDemontage: 80 })]);
    const id = await createVehicle(p.ctx, { stationId: A });
    const v = (await p.db.vehicles.get(id))!;
    expect((v as any).companyId).toBe(refs.companies.find((x) => x.name === "PDR Team GmbH")!.id);
    await setHeader(p.ctx, id, { insurerId: ins, campaignId: refs.campaigns[0].id, claimNumber: "SIN-1" });
    await sync(p);
    expect(await p.db.vehicles.get(id)).toMatchObject({ insurerId: ins, claimNumber: "SIN-1" });
  });
  it("a technician's phone gets no technician list", async () => {
    const p = phone(tokens.tech);
    await sync(p);
    expect((await refsOf(p)).technicians).toEqual([]);
  });
  it("letterhead for the PDF: chosen company with its logo from the server (cached), neutral = no logo, legacy flag still works", async () => {
    const p = phone(tokens.assessor);
    await sync(p);
    const refs = await refsOf(p);
    const pdr = refs.companies.find((x) => x.name === "PDR Team GmbH")!, neutral = refs.companies.find((x) => x.name.startsWith("Neutral"))!;
    const id = await createVehicle(p.ctx, { stationId: A });
    const v = (await p.db.vehicles.get(id))!;
    const lh = await letterheadFor({ ...v, companyId: pdr.id } as any, refs, p.db, p.engine);
    expect(lh?.name).toBe("PDR Team GmbH");
    expect(lh?.logo).toMatchObject({ kind: "jpg", width: 1000, height: 276 });
    expect(lh!.logo!.bytes.length).toBeGreaterThan(1000);
    expect(await p.db.blobs.get(`logo:${pdr.id}`)).toBeTruthy(); // cached for offline use
    p.online = false;
    expect((await letterheadFor({ ...v, companyId: pdr.id } as any, refs, p.db, p.engine))?.logo).toBeTruthy(); // works offline from the cache
    expect((await letterheadFor({ ...v, companyId: neutral.id } as any, refs, p.db, p.engine))?.logo).toBeUndefined();
    expect(await letterheadFor({ ...v, companyId: undefined, logo: "none" } as any, refs, p.db, p.engine)).toBeNull();
    expect(toDoc({ ...v, insurerId: ins } as any, refs).insurerName).toBe("Mutua");
  });
});

describe("sending a report (offline capable)", () => {
  const sentCount = () => c.mailer.sent.length;
  it("queued offline → accepted and uploaded when online → e-mailed with the PDF; the local copy of the PDF is dropped", async () => {
    const p = phone(tokens.assessor);
    await sync(p);
    const id = await createVehicle(p.ctx, { stationId: A, header: { kennzeichen: "SEND 1", modell: "Leon" } });
    await setHeader(p.ctx, id, { insurerId: ins });
    await sync(p);
    p.online = false;
    c.mailer.sent.length = 0;
    const rid = await sendReport(p.ctx, { vehicleId: id, type: "kva", lang: "es", pdf: PDF, fileName: "Presupuesto_SEND-1.pdf" });
    await sync(p);
    expect(await p.db.uploads.count()).toBe(1);
    expect(sentCount()).toBe(0);
    p.online = true;
    await sync(p);
    expect(sentCount()).toBe(1);
    expect(c.mailer.last().to).toEqual(["taller@example.test", "mutua@example.test"]);
    expect(c.mailer.last().attachments![0].filename).toBe("Presupuesto_SEND-1.pdf");
    expect(await p.db.uploads.count()).toBe(0);
    expect(await p.db.blobs.get(`report:${rid}`)).toBeUndefined();
    expect(await p.db.outbox.count()).toBe(0);
  });
  it("no recipients: the server refuses, the phone cleans up and reports it", async () => {
    const p = phone(tokens.assessor);
    await sync(p);
    // a vehicle whose customer is the hall (no report e-mails) and no insurer
    const hall = ((await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[]).find((s) => s.type === "hall").id;
    const id = await createVehicle(p.ctx, { stationId: hall, clientStationId: hall });
    await sync(p);
    c.mailer.sent.length = 0;
    const rid = await sendReport(p.ctx, { vehicleId: id, type: "kva", lang: "de", pdf: PDF, fileName: "x.pdf" });
    await sync(p);
    expect(sentCount()).toBe(0);
    expect(await p.db.uploads.count()).toBe(0);
    expect(await p.db.blobs.get(`report:${rid}`)).toBeUndefined();
    expect((await p.db.issues.toArray()).some((i) => i.opType === "report.send" && i.code === "report_no_recipients")).toBe(true);
  });
  it("provider outage: the phone keeps the PDF and retries with back-off until it works — exactly one e-mail", async () => {
    let now = Date.now();
    const p = phone(tokens.assessor);
    (p.engine as any).now = () => now;
    await sync(p);
    const id = await createVehicle(p.ctx, { stationId: A, header: { kennzeichen: "RETRY 1" } });
    await sync(p);
    c.mailer.sent.length = 0;
    c.mailer.fail = new Error("down");
    const rid = await sendReport(p.ctx, { vehicleId: id, type: "kva", lang: "es", pdf: PDF, fileName: "r.pdf" });
    await sync(p);
    expect(sentCount()).toBe(0);
    expect(await p.db.blobs.get(`report:${rid}`)).toBeTruthy();
    const up = (await p.db.uploads.get(`report:${rid}`))!;
    expect(up.tries).toBe(1);
    await sync(p); // too early: back-off
    expect((await p.db.uploads.get(`report:${rid}`))!.tries).toBe(1);
    c.mailer.fail = null;
    now += 60_000;
    await sync(p);
    expect(sentCount()).toBe(1);
    expect(await p.db.uploads.count()).toBe(0);
  });
  it("a technician cannot queue a report (refused, cleaned up)", async () => {
    const pa = phone(tokens.assessor), pt = phone(tokens.tech);
    await sync(pa);
    const id = await createVehicle(pa.ctx, { stationId: A });
    await sync(pa);
    const { assignVehicle } = await import("../src/sync/mutations");
    const techId = (await call(c, "GET", "/admin/users", { token: c.superToken, org: c.orgES })).body.find((u: any) => u.email === "tech@example.test").id;
    await assignVehicle(pa.ctx, id, "pdr", [techId]);
    await sync(pa); await sync(pt);
    c.mailer.sent.length = 0;
    const rid = await sendReport(pt.ctx, { vehicleId: id, type: "kva", lang: "es", pdf: PDF, fileName: "t.pdf" });
    await sync(pt);
    expect(sentCount()).toBe(0);
    expect(await pt.db.blobs.get(`report:${rid}`)).toBeUndefined();
    expect((await pt.db.issues.toArray()).some((i) => i.opType === "report.send")).toBe(true);
  });
});
