// V5 phase 4: customer signature at drop-off and pick-up (rights, offline replay, personal data, receipt, e-mail).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, repairEvents, vehicleHandovers, vehicleStatusHistory, vehicles } from "../src/schema";
import { buildRepairReportPdf } from "../src/repair_report";
import { call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, H: string, CARRO: string;
let chef: string, assessor: string, tech: string, techUser: string, carro: string, admin: string, insurer: string;
const NAME = "Marta Zúñiga Peña", EMAIL = "marta.customer@example.test";
const sig = [[[10, 10], [100, 60], [200, 20], [300, 90]], [[50, 150], [250, 150]]];

const create = (id: string, o: Record<string, unknown> = {}) =>
  op("vehicle.create", { vehicle: { id, stationId: H, clientStationId: CARRO, statut: "besichtigung", header: { land: "ES", kennzeichen: "HO-" + id.slice(0, 4), modell: "Seat Leon", leistungsdatum: "2026-10-20", stundensatz: 69 }, panels: { haube: dentsPanel("haube", { "20": 10 }) }, shares: { techName: "Ana", techPct: 50 }, ...o } });
const handover = (vehicleId: string, kind: "drop_off" | "pick_up", o: Record<string, unknown> = {}) =>
  op("vehicle.handover", { vehicleId, handover: { id: uuid(), kind, customerName: NAME, customerEmail: null, remarks: "scratch on the left door", signedAt: new Date().toISOString(), signature: sig, sendReceipt: false, ...o } });
const one = async (token: string, o: unknown) => ((await push(c, token, [o])).body.results[0] as { status: string; code?: string });
const row = async (id: string) => (await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0];
const rows = async (vehicleId: string) => c.h.db.select().from(vehicleHandovers).where(eq(vehicleHandovers.vehicleId, vehicleId));
const enterBoard = async (id: string) => expect((await one(chef, op("vehicle.repairStage", { vehicleId: id, stage: "bereit" }))).status).toBe("ok");
const get = (token: string, path: string) => call(c, "GET", path, { token, org: c.orgES });
let n = 0;
/** a fresh car, in the repair board (Ready) */
const carInBoard = async () => {
  const id = uuid(); n++;
  expect((await one(assessor, create(id))).status).toBe("ok");
  await enterBoard(id);
  return id;
};

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string; name: string }[];
  CARRO = st.find((s) => s.type === "carrosserie")!.id; H = st.find((s) => s.name === "Nave Test A")!.id;
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { commission_pct: 20 } });
  chef = await inviteAndAccept(c, c.orgES, "chef-ho@example.test", { role_id: c.roleId.chef_site, station_id: H });
  assessor = await inviteAndAccept(c, c.orgES, "ass-ho@example.test", { role_id: c.roleId.aufnehmer });
  admin = await inviteAndAccept(c, c.orgES, "admin-ho@example.test", { role_id: c.roleId.org_admin });
  tech = await inviteAndAccept(c, c.orgES, "tech-ho@example.test", { role_id: c.roleId.technicien, station_id: H });
  carro = await inviteAndAccept(c, c.orgES, "carro-ho@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
  const insId = (await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Aseg HO", report_emails: [] } })).body.id;
  insurer = await inviteAndAccept(c, c.orgES, "ins-ho@example.test", { role_id: c.roleId.assureur, scope_insurer_id: insId });
  techUser = (await c.h.db.execute((await import("drizzle-orm")).sql`select id from users where email = 'tech-ho@example.test'`) as unknown as { rows: { id: string }[] }).rows[0].id;
});
afterAll(async () => { await c.h.close(); });

describe("which cars have a drop-off to sign", () => {
  it("a car that ENTERS the board after V5 is stamped (repair_entered_at); a car that was already in repair is not", async () => {
    const id = await carInBoard();
    expect((await row(id)).repairEnteredAt).toBeInstanceOf(Date);
    expect((await row(id)).dropOffSignedAt).toBeNull();
    // a car that was in repair before V5: the migration leaves repair_entered_at NULL
    const old = uuid();
    expect((await one(assessor, create(old))).status).toBe("ok");
    await c.h.db.update(vehicles).set({ statut: "reparatur", repairStage: "bereit", repairEnteredAt: null }).where(eq(vehicles.id, old));
    const p = (await pull(c, assessor, c.orgES)).vehicles;
    expect(p.find((v: { id: string }) => v.id === id)).toMatchObject({ repairStage: "bereit", repairEnteredAt: expect.any(String), dropOffSignedAt: null });
    expect(p.find((v: { id: string }) => v.id === old)).toMatchObject({ repairStage: "bereit", repairEnteredAt: null });
  });
});

describe("drop-off signature", () => {
  it("is stored with the vehicle; only a summary (time) travels with the vehicle, never the name, e-mail or drawing", async () => {
    const id = await carInBoard();
    const h = handover(id, "drop_off", { customerEmail: EMAIL });
    expect((await one(assessor, h)).status).toBe("ok");
    const [r] = await rows(id);
    expect(r).toMatchObject({ kind: "drop_off", customerName: NAME, customerEmail: EMAIL, stationId: H, replacedBy: null });
    expect(r.signature).toEqual(sig);
    expect((await row(id)).dropOffSignedAt?.getTime()).toBe(r.signedAt.getTime());
    // every profile that can see the car gets the summary and nothing personal
    for (const t of [assessor, chef, admin, tech, carro, insurer, c.superToken]) {
      const body = JSON.stringify((await pull(c, t, c.orgES)).vehicles.filter((v: { id: string }) => v.id === id));
      expect(body, "personal data in the synced vehicle").not.toMatch(/Zúñiga|marta\.customer|scratch on the left|"signature"/);
    }
    const mine = (await pull(c, assessor, c.orgES)).vehicles.find((v: { id: string }) => v.id === id);
    expect(mine.dropOffSignedAt).toBe(r.signedAt.toISOString());
    // history: an event without personal data; the audit log keeps the reference only
    const ev = (await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).find((e) => e.type === "handover_signed")!;
    expect(ev.payload).toEqual({ kind: "drop_off", handoverId: r.id });
    const audits = JSON.stringify(await c.h.db.select().from(auditLog).where(eq(auditLog.entityId, id)));
    expect(audits).toContain(r.id); expect(audits).not.toMatch(/Zúñiga|marta\.customer|scratch/);
  });

  it("a replayed offline operation is applied once (same operation, or the same hand-over id again)", async () => {
    const id = await carInBoard();
    const h = handover(id, "drop_off");
    expect((await one(assessor, h)).status).toBe("ok");
    expect((await one(assessor, h)).status).toBe("ok");                                                  // same opId
    const again = { ...h, opId: uuid() };                                                                // a new op that carries the same hand-over
    expect((await one(assessor, again)).status).toBe("ok");
    expect(await rows(id)).toHaveLength(1);
    // the id of a hand-over of another car cannot be reused
    const other = await carInBoard();
    expect((await one(assessor, op("vehicle.handover", { vehicleId: other, handover: { ...(h as { handover: object }).handover } }))).code).toBe("not_allowed");
  });

  it("signing again never edits: the new row replaces the previous one, which stays in the database", async () => {
    const id = await carInBoard();
    const a = handover(id, "drop_off"), b = handover(id, "drop_off", { customerName: "Otro Nombre" });
    await one(assessor, a); await one(assessor, b);
    const list = await rows(id);
    expect(list).toHaveLength(2);
    const first = list.find((x) => x.id === (a as { handover: { id: string } }).handover.id)!;
    expect(first.replacedBy).toBe((b as { handover: { id: string } }).handover.id);
    expect(first.customerName).toBe(NAME);                                                               // untouched
    const api = (await get(assessor, `/vehicles/${id}/handovers`)).body as { id: string; replaced: boolean }[];
    expect(api.map((x) => [x.id, x.replaced])).toEqual([[first.id, true], [(b as { handover: { id: string } }).handover.id, false]]);
  });

  it("who may sign: station staff yes; technician / headliner, the body shop and the insurer no", async () => {
    const id = await carInBoard();
    expect((await one(tech, handover(id, "drop_off"))).status).toBe("rejected");
    expect((await one(carro, handover(id, "drop_off"))).status).toBe("rejected");
    expect((await one(insurer, handover(id, "drop_off"))).status).toBe("rejected");
    expect(await rows(id)).toHaveLength(0);
    for (const t of [chef, admin]) expect((await one(t, handover(id, "drop_off"))).status).toBe("ok");
  });

  it("input is validated: no drawing, no name, a bad e-mail", async () => {
    const id = await carInBoard();
    const bad = async (o: Record<string, unknown>) => (await push(c, assessor, [handover(id, "drop_off", o)])).status;
    expect(await bad({ signature: [] })).toBe(400);
    expect(await bad({ customerName: "  " })).toBe(400);
    expect(await bad({ customerEmail: "not-an-email" })).toBe(400);
    expect(await bad({ signature: [[[1, 1]], ...Array.from({ length: 70 }, () => [[1, 1]])] })).toBe(400);   // too many strokes
    expect(await rows(id)).toHaveLength(0);
    expect(await bad({ customerEmail: "" })).toBe(200);                                                  // empty = none
  });

  it("a phone clock far in the future is not trusted", async () => {
    const id = await carInBoard();
    await one(assessor, handover(id, "drop_off", { signedAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }));
    expect((await rows(id))[0].signedAt.getTime()).toBeLessThan(Date.now() + 60_000);
  });
});

describe("pick-up signature", () => {
  it("hands the car back: status Returned (with history), the pick-up time on the vehicle", async () => {
    const id = await carInBoard();
    expect((await one(assessor, handover(id, "pick_up"))).status).toBe("ok");
    const v = await row(id);
    expect(v.statut).toBe("rendu"); expect(v.pickUpSignedAt).toBeInstanceOf(Date);
    const hist = await c.h.db.select().from(vehicleStatusHistory).where(and(eq(vehicleStatusHistory.vehicleId, id), eq(vehicleStatusHistory.statut, "rendu")));
    expect(hist).toHaveLength(1);
    // signing it again later does not add a second "Returned" entry
    expect((await one(assessor, handover(id, "pick_up", { customerName: "Segunda" }))).status).toBe("ok");
    expect(await c.h.db.select().from(vehicleStatusHistory).where(and(eq(vehicleStatusHistory.vehicleId, id), eq(vehicleStatusHistory.statut, "rendu")))).toHaveLength(1);
  });
});

describe("the customer's data stays with the staff", () => {
  let id: string, hid: string;
  beforeAll(async () => {
    id = await carInBoard();
    const h = handover(id, "drop_off", { customerEmail: EMAIL });
    hid = (h as { handover: { id: string } }).handover.id;
    await one(assessor, h);
  });

  it("details and receipt: station staff and administrators; for a technician, the body shop and the insurer the data does not exist", async () => {
    for (const t of [assessor, chef, admin, c.superToken]) {
      const r = await get(t, `/vehicles/${id}/handovers`);
      expect(r.status).toBe(200);
      expect(r.body[0]).toMatchObject({ customerName: NAME, customerEmail: EMAIL, remarks: "scratch on the left door", kind: "drop_off", signedBy: expect.any(String), station: "Nave Test A" });
      expect(r.body[0].signature).toEqual(sig);
      const pdf = await get(t, `/handovers/${hid}/receipt`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("content-type")).toBe("application/pdf");
      expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe("%PDF-");
    }
    for (const t of [tech, carro, insurer]) {
      expect((await get(t, `/vehicles/${id}/handovers`)).status).toBe(404);
      expect((await get(t, `/handovers/${hid}/receipt`)).status).toBe(404);
      expect((await call(c, "POST", `/handovers/${hid}/send`, { token: t, org: c.orgES, body: {} })).status).toBe(404);
    }
    // another organisation never reaches it
    const rolesDE = (await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgDE })).body as { key: string; id: string }[];
    const deAdmin = await inviteAndAccept(c, c.orgDE, "de-ho@example.test", { role_id: rolesDE.find((r) => r.key === "org_admin")!.id });
    expect((await call(c, "GET", `/vehicles/${id}/handovers`, { token: deAdmin, org: c.orgDE })).status).toBe(404);
    expect((await call(c, "GET", `/handovers/${hid}/receipt`, { token: deAdmin, org: c.orgDE })).status).toBe(404);
    expect((await call(c, "GET", `/handovers/${hid}/receipt`, {})).status).toBe(401);
  });

  it("the weekly export for the technician and the Excel sheets carry no customer data", async () => {
    const r = await call(c, "GET", "/dashboard/technician-sheets", { token: admin, org: c.orgES });
    expect(JSON.stringify(r.body)).not.toMatch(/Zúñiga|marta\.customer/);
  });
});

describe("receipt PDF and e-mail", () => {
  it("with the box ticked the receipt is stored with the vehicle and sent to the customer with the PDF attached (language of the vehicle's country)", async () => {
    const id = await carInBoard();
    c.mailer.sent.length = 0;
    const h = handover(id, "drop_off", { customerEmail: EMAIL, sendReceipt: true });
    expect((await one(assessor, h)).status).toBe("ok");
    const [r] = await rows(id);
    expect(r.mailStatus).toBe("sent"); expect(r.mailedAt).toBeInstanceOf(Date); expect(r.receiptPdfKey).toMatch(/^handover\/.+\.pdf$/);
    expect((await c.storage.get(r.receiptPdfKey!))?.bytes.length).toBeGreaterThan(500);
    const m = c.mailer.sent.find((x) => x.to === EMAIL)!;
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments![0].filename).toMatch(/^Comprobante_Recepcion_HO-/);                              // Spanish car -> Spanish document
    expect(m.replyTo).toBe("ass-ho@example.test");
    expect(m.subject + m.text).not.toMatch(/€|Ana|%/);                                                   // never amounts, technician or commission
  });

  it("without the box ticked nothing is mailed; the receipt is still stored", async () => {
    const id = await carInBoard();
    c.mailer.sent.length = 0;
    await one(assessor, handover(id, "drop_off", { customerEmail: EMAIL, sendReceipt: false }));
    expect(c.mailer.sent.filter((x) => x.to === EMAIL)).toHaveLength(0);
    const [r] = await rows(id);
    expect(r.mailStatus).toBeNull(); expect(r.receiptPdfKey).toBeTruthy();
  });

  it("a mail failure is kept on the signature and can be sent again (also to a corrected address)", async () => {
    const id = await carInBoard();
    c.mailer.fail = new Error("provider down");
    const h = handover(id, "pick_up", { customerEmail: EMAIL, sendReceipt: true });
    expect((await one(assessor, h)).status).toBe("ok");                                                  // the signature itself is saved
    let [r] = await rows(id);
    expect(r).toMatchObject({ mailStatus: "failed" }); expect(r.mailError).toContain("provider down");
    expect((await row(id)).statut).toBe("rendu");
    c.mailer.fail = null;
    const again = await call(c, "POST", `/handovers/${r.id}/send`, { token: assessor, org: c.orgES, body: { email: "corrected@example.test" } });
    expect(again.body).toMatchObject({ status: "sent" });
    [r] = await rows(id);
    expect(r).toMatchObject({ mailStatus: "sent", customerEmail: "corrected@example.test", mailError: null });
    expect(c.mailer.last().to).toBe("corrected@example.test");
    // no e-mail at all: a clear failure, not a crash
    const id2 = await carInBoard();
    await one(assessor, handover(id2, "drop_off"));
    const [r2] = await rows(id2);
    expect((await call(c, "POST", `/handovers/${r2.id}/send`, { token: assessor, org: c.orgES, body: {} })).body).toMatchObject({ status: "failed", error: "no_email" });
  });

  it("a German car gets the German receipt", async () => {
    const id = uuid();
    expect((await one(assessor, create(id, { header: { land: "DE", kennzeichen: "DE-HO 1", modell: "VW Golf", leistungsdatum: "2026-10-20", stundensatz: 83 } }))).status).toBe("ok");
    await enterBoard(id);
    c.mailer.sent.length = 0;
    await one(assessor, handover(id, "drop_off", { customerEmail: EMAIL, sendReceipt: true }));
    expect(c.mailer.sent.find((x) => x.to === EMAIL)!.attachments![0].filename).toMatch(/^Uebergabe_Annahme_DE-HO-1/);
  });

  it("the repair photo report gets the signatures page (and still builds with none)", async () => {
    const id = await carInBoard();
    const without = await buildRepairReportPdf({ db: c.h.db, storage: c.storage }, await row(id));
    await one(assessor, handover(id, "drop_off")); await one(assessor, handover(id, "pick_up", { customerName: "Pick Up Person" }));
    const withSig = await buildRepairReportPdf({ db: c.h.db, storage: c.storage }, await row(id));
    expect(withSig.bytes.length).toBeGreaterThan(without.bytes.length);                                   // the drawings are in it
    expect(new TextDecoder().decode(withSig.bytes.slice(0, 5))).toBe("%PDF-");
  });
});
