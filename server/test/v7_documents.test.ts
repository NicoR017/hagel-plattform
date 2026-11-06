// V7 (Repair v2) F5: imported documents (versions, files checked), what is missing, the repair dossier to the insurer, billing information, CSV "Finished vehicles".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { PERMISSIONS, SYSTEM_ROLES } from "@hagel/shared";
import { buildFinishedCsv } from "@hagel/documents";
import { repairEvents, vehicleDocuments, vehicles } from "../src/schema";
import { JPEG, PDF, call, dentsPanel, inviteAndAccept, op, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, CARRO: string, INS: string;
let chef: string, assessor: string, carro: string;

const create = (id: string) =>
  op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, insurerId: INS, statut: "besichtigung", header: { land: "ES", kennzeichen: "DO-" + id.slice(0, 4), modell: "Seat Leon", claimNumber: "SIN-1", leistungsdatum: "2026-10-20", stundensatz: 69 }, panels: { haube: dentsPanel("haube", { "30": 4 }) }, shares: {} } });
const one = async (token: string, o: unknown) => ((await push(c, token, [o])).body.results[0] as { status: string; code?: string });
const api = (m: string, path: string, body?: unknown, token = chef) => call(c, m, path, { token, org: c.orgES, body });
const car = async () => { const id = uuid(); expect((await one(assessor, create(id))).status).toBe("ok"); return id; };
const upload = (docId: string, bytes: Uint8Array, token = chef) => call(c, "PUT", `/documents/${docId}/file`, { token, org: c.orgES, raw: bytes, contentType: "application/octet-stream" });
/** register + upload a document */
const addDoc = async (vid: string, body: Record<string, unknown>, bytes: Uint8Array = PDF) => {
  const r = await api("POST", `/vehicles/${vid}/documents`, body);
  expect(r.status).toBe(201);
  expect((await upload(r.body.id, bytes)).status).toBe(200);
  return r.body as { id: string; version: number };
};
const sentOrder = async (vid: string) => {
  await call(c, "PUT", `/admin/bodyshops/${CARRO}/order-settings`, { token: c.superToken, org: c.orgES, body: { enabled: true, mode: "manual", to_emails: ["pedidos@masa.example.test"], lang: "es" } });
  expect((await one(assessor, op("part.add", { vehicleId: vid, part: { id: uuid(), zoneKey: "dach", catalogId: null, name: "Antena", qty: 1, oemRef: null, source: "assessment" } }))).status).toBe("ok");
  expect((await api("POST", `/vehicles/${vid}/orders`, { kind: "main", send: true })).body.status).toBe("sent");
};

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string; name: string }[];
  CARRO = st.find((s) => s.type === "carrosserie")!.id; A = st.find((s) => s.name === "Nave Test A")!.id;
  INS = (await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Allianz Test", report_emails: ["siniestros@allianz.example.test"], send_reports: true, reports_to_send: "both" } })).body.id;
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { report_emails: ["taller@masa.example.test"], commission_pct: 10 } });
  chef = await inviteAndAccept(c, c.orgES, "chef-do@example.test", { role_id: c.roleId.chef_site, station_id: A });
  assessor = await inviteAndAccept(c, c.orgES, "ass-do@example.test", { role_id: c.roleId.aufnehmer });
  carro = await inviteAndAccept(c, c.orgES, "carro-do@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
});
afterAll(async () => { await c.h.close(); });

describe("permissions", () => {
  it("documents.importer, dossier.envoyer, facturation.voir: manager and station chief; nobody on the field or outside", () => {
    for (const p of ["documents.importer", "dossier.envoyer", "facturation.voir"]) expect(PERMISSIONS).toContain(p);
    const sr = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.key, r.permissions]));
    for (const p of ["documents.importer", "dossier.envoyer", "facturation.voir"]) {
      for (const k of ["org_admin", "chef_site"]) expect(sr[k]).toContain(p);
      for (const k of ["aufnehmer", "technicien", "freelance", "carrosserie", "assureur"]) expect(sr[k]).not.toContain(p);
    }
  });
});

describe("import a document", () => {
  it("a parts invoice needs its number and amount; the file is checked by content; a new import is a NEW VERSION (the old one stays); one per car", async () => {
    const id = await car();
    expect((await api("POST", `/vehicles/${id}/documents`, { type: "parts_invoice" })).body.code).toBe("document_type_invalid"); // no number / amount
    expect((await api("POST", `/vehicles/${id}/documents`, { type: "parts_invoice", number: "F-1", amountHt: 100 }, assessor)).status).toBe(403);
    expect((await api("POST", `/vehicles/${id}/documents`, { type: "parts_invoice", number: "F-1", amountHt: 100 }, carro)).status).toBe(403);
    const d1 = await api("POST", `/vehicles/${id}/documents`, { type: "parts_invoice", number: "F-1", amountHt: 412.5 });
    expect(d1.body).toMatchObject({ category: "parts", version: 1, hasFile: false, inDossier: true });
    expect((await upload(d1.body.id, new TextEncoder().encode("not a pdf"))).body.code).toBe("document_file_invalid"); // a text file named like a PDF
    expect((await upload(d1.body.id, new Uint8Array(0))).status).toBe(400);
    expect((await upload(d1.body.id, PDF, assessor)).status).toBe(403);
    expect((await upload(d1.body.id, PDF)).status).toBe(200);
    expect((await upload(d1.body.id, PDF)).status).toBe(409); // a file is never overwritten
    const d2 = await addDoc(id, { type: "parts_invoice", number: "F-1b", amountHt: 430 }, JPEG);
    expect(d2.version).toBe(2);
    const list = (await api("GET", `/vehicles/${id}/documents`)).body;
    expect(list.documents.map((d: { number: string; version: number; latest: boolean }) => [d.number, d.version, d.latest])).toEqual([["F-1b", 2, true], ["F-1", 1, false]]); // both kept
    expect((await call(c, "GET", `/documents/${d1.body.id}/file`, { token: chef, org: c.orgES })).status).toBe(200); // the old version is still there
    const dl = await call(c, "GET", `/documents/${d2.id}/file`, { token: chef, org: c.orgES });
    expect(dl.headers.get("content-type")).toBe("image/jpeg"); expect(dl.headers.get("content-disposition")).toContain("F-1b");
    expect((await call(c, "GET", `/documents/${d2.id}/file`, { token: assessor, org: c.orgES })).status).toBe(403);
    expect((await c.h.db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, id))).length).toBe(2);
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).map((e) => e.type)).toEqual(expect.arrayContaining(["document_added", "document_new_version"]));
  });
  it("a paint invoice needs a painter (one per painter and car); other documents are free; the numbers stay text; other cars' orders cannot be linked", async () => {
    const id = await car();
    expect((await api("POST", `/vehicles/${id}/documents`, { type: "paint_invoice", number: "P-1", amountHt: 90 })).body.code).toBe("document_type_invalid"); // no painter
    const p1 = await addDoc(id, { type: "paint_invoice", number: "P-1", amountHt: 90, partnerId: CARRO });
    const p2 = await addDoc(id, { type: "paint_invoice", number: "P-2", amountHt: 95, partnerId: CARRO });
    expect([p1.version, p2.version]).toEqual([1, 2]);
    const o1 = await addDoc(id, { type: "insurer_doc", title: "Autorización" });
    const o2 = await addDoc(id, { type: "insurer_doc", title: "Autorización 2" });
    expect([o1.version, o2.version]).toEqual([1, 1]); // free documents are not versions of each other
    expect((await api("POST", `/vehicles/${id}/documents`, { type: "other", orderIds: [uuid()] })).body.code).toBe("document_type_invalid");
    expect((await api("POST", `/vehicles/${uuid()}/documents`, { type: "other" })).status).toBe(404);
  });
  it("what is missing: a parts invoice once parts were ordered; a paint invoice once a painter has the car", async () => {
    const id = await car();
    expect((await api("GET", `/vehicles/${id}/documents`)).body.missing).toEqual([]);
    await sentOrder(id);
    expect((await api("GET", `/vehicles/${id}/documents`)).body.missing).toEqual([{ key: "parts_invoice", type: "parts_invoice" }]);
    await addDoc(id, { type: "parts_invoice", number: "F-9", amountHt: 100 });
    expect((await api("GET", `/vehicles/${id}/documents`)).body.missing).toEqual([]);
  });
});

describe("the repair dossier", () => {
  it("D40: the checklist (ready / missing), the insurer as recipient and the body shop in Cc; ONE e-mail with every selected document; it may leave with documents missing and says so", async () => {
    const id = await car();
    await sentOrder(id);
    const inv = await addDoc(id, { type: "insurer_doc", title: "Autorización", inDossier: true });
    const cl = (await api("GET", `/vehicles/${id}/dossier`)).body;
    expect(cl.recipients).toEqual({ to: ["siniestros@allianz.example.test"], cc: ["taller@masa.example.test"] });
    expect(cl.items.find((i: { key: string }) => i.key === "repairReport").ready).toBe(true);
    expect(cl.items.find((i: { key: string }) => i.key === "estimate").ready).toBe(false);
    expect(cl.items.find((i: { key: string }) => i.key === "missing:parts_invoice")).toMatchObject({ ready: false });
    expect(cl.items.find((i: { key: string }) => i.key === `doc:${inv.id}`)).toMatchObject({ ready: true });
    const before = c.mailer.sent.length;
    const r = await api("POST", `/vehicles/${id}/dossier/send`, { to: cl.recipients.to, cc: cl.recipients.cc, include: { repairReport: true, estimate: false, receipts: true, documentIds: [inv.id] }, note: "Quedamos atentos" });
    expect(r.status).toBe(200); expect(r.body.status).toBe("sent"); expect(r.body.missing).toEqual(["parts_invoice"]);
    expect(c.mailer.sent.length).toBe(before + 1); // one e-mail
    const m = c.mailer.sent[c.mailer.sent.length - 1];
    expect(m.to).toEqual(["siniestros@allianz.example.test"]); expect(m.cc).toEqual(["taller@masa.example.test"]);
    expect(m.attachments!.length).toBe(2); expect(m.attachments!.map((a) => a.contentType)).toEqual(["application/pdf", "application/pdf"]);
    expect(m.subject).toContain("Expediente de reparación"); expect(m.text).toContain("Factura de piezas del taller"); expect(m.text).toContain("Pendientes"); expect(m.text).toContain("Quedamos atentos");
    expect(Buffer.from(m.attachments![0].content).subarray(0, 4).toString()).toBe("%PDF");
    const hist = (await api("GET", `/vehicles/${id}/documents`)).body.dossiers;
    expect(hist).toHaveLength(1); expect(hist[0]).toMatchObject({ status: "sent", missing: ["parts_invoice"] });
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).some((e) => e.type === "dossier_sent")).toBe(true);
  });
  it("rights and validation: dossier.envoyer only; at least one valid recipient; nothing selected = nothing sent; another car's document is not attached; a provider outage is a failed send, kept in the history", async () => {
    const id = await car(), other = await car();
    const foreign = await addDoc(other, { type: "other", title: "x" });
    const body = { to: ["a@example.test"], cc: [], include: { repairReport: true, estimate: false, receipts: false, documentIds: [] } };
    expect((await api("POST", `/vehicles/${id}/dossier/send`, body, assessor)).status).toBe(403);
    expect((await api("GET", `/vehicles/${id}/dossier`, undefined, assessor)).status).toBe(403);
    expect((await api("POST", `/vehicles/${id}/dossier/send`, { ...body, to: [] })).body.code).toBe("dossier_no_recipient");
    expect((await api("POST", `/vehicles/${id}/dossier/send`, { ...body, to: ["nope"] })).body.code).toBe("dossier_no_recipient");
    expect((await api("POST", `/vehicles/${id}/dossier/send`, { ...body, include: { repairReport: false, estimate: false, receipts: false, documentIds: [foreign.id] } })).body.code).toBe("dossier_nothing");
    const n = c.mailer.sent.length;
    c.mailer.fail = new Error("graph down");
    const f = await api("POST", `/vehicles/${id}/dossier/send`, body);
    c.mailer.fail = null;
    expect(f.status).toBe(502); expect(f.body.code).toBe("dossier_send_failed"); expect(c.mailer.sent.length).toBe(n);
    expect((await api("GET", `/vehicles/${id}/documents`)).body.dossiers[0]).toMatchObject({ status: "failed" });
    expect((await api("POST", `/vehicles/${id}/dossier/send`, body)).status).toBe(200); // and it can be sent again
  });
});

describe("billing information (read-only)", () => {
  it("our assessment amount (without parts), the parts invoice, what the body shop bills the insurer; needs facturation.voir and prices", async () => {
    const id = await car();
    const b0 = (await api("GET", `/vehicles/${id}/billing`)).body;
    expect(b0).toMatchObject({ partsInvoice: null, bodyShopBillsInsurer: null, bodyShop: expect.any(String), commissionPct: 10 });
    expect(b0.assessmentNet).toBeGreaterThan(0);
    await sentOrder(id);
    await addDoc(id, { type: "parts_invoice", number: "F-77", amountHt: 250.4 });
    await addDoc(id, { type: "paint_invoice", number: "P-77", amountHt: 120, partnerId: CARRO });
    const b = (await api("GET", `/vehicles/${id}/billing`)).body;
    expect(b).toMatchObject({ viaBodyShop: true, partsInvoice: { number: "F-77", amountHt: 250.4 } });
    expect(b.paintInvoices).toEqual([expect.objectContaining({ number: "P-77", amountHt: 120 })]);
    expect(b.bodyShopBillsInsurer).toBe(Math.round((b.assessmentNet + 250.4) * 100) / 100);
    expect((await api("GET", `/vehicles/${id}/billing`, undefined, assessor)).status).toBe(403);
    expect((await api("GET", `/vehicles/${id}/billing`, undefined, carro)).status).toBe(403);
  });
});

describe("CSV Finished vehicles", () => {
  it("the 'Parts price' column is filled with the invoice amount; 'Parts invoice' says received / missing / n/a; the new columns are in the CSV", async () => {
    const withInv = await car(), without = await car(), none = await car();
    await sentOrder(withInv); await sentOrder(without);
    await addDoc(withInv, { type: "parts_invoice", number: "F-55", amountHt: 321.5 });
    for (const v of [withInv, without, none]) await c.h.db.update(vehicles).set({ statut: "fertig", repairStage: "finish" }).where(eq(vehicles.id, v));
    await c.h.db.execute(sql`insert into vehicle_status_history (vehicle_id, statut) values (${withInv}, 'fertig'), (${without}, 'fertig'), (${none}, 'fertig')`);
    const res = await call(c, "GET", "/dashboard/finished-export", { token: c.superToken, org: c.orgES });
    expect(res.status).toBe(200);
    const rows = res.body.rows as { id: string; partsPrice: number | null; partsInvoiceNo: string; partsInvoiceStatus: string }[];
    expect(rows.find((r) => r.id === withInv)).toMatchObject({ partsPrice: 321.5, partsInvoiceNo: "F-55", partsInvoiceStatus: "received" });
    expect(rows.find((r) => r.id === without)).toMatchObject({ partsPrice: null, partsInvoiceStatus: "missing" });
    expect(rows.find((r) => r.id === none)).toMatchObject({ partsInvoiceStatus: "n/a" });
    const csv = buildFinishedCsv({ from: null, to: null, rows: rows as never });
    expect(csv).toContain("Parts invoice no."); expect(csv).toContain("Parts invoice"); expect(csv).toContain("F-55");
  });
  it("the migration is additive", () => {
    const file = readFileSync(new URL("../migrations/0030_v7_documents_dossier.sql", import.meta.url), "utf8");
    expect(file).not.toMatch(/\bDROP\b|\bRENAME\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|ALTER COLUMN/i);
  });
});
