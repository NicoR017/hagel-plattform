import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { JPEG, PDF, call, inviteAndAccept, op, pull, push, setup, tick, uuid, type Ctx } from "./helpers";
import { recipientsFor } from "../src/reports";
import { imageInfo } from "../src/routes_master";
import { reportMail } from "../src/mails";
import { reportSends, technicians, users, vehicleAssignments } from "../src/schema";

let c: Ctx, A: string, CARRO: string, B: string, assessor: string, chefA: string, tech: string, carro: string, admin: string;
let techUserId: string;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0x2c, 0, 0, 0, 0x64, 8, 6, 0, 0, 0, 0, 0, 0]);

const header = (o: Record<string, unknown> = {}) => ({ land: "ES", kennzeichen: "1234 ABC", fin: "VF1ABCDEF12345678", modell: "Seat Leon", kunde: "Carrosserie Test Talavera", leistungsdatum: "2026-10-19", stundensatz: 69, ...o });
const createOp = (id: string, o: Record<string, unknown> = {}) =>
  op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, header: header(), panels: { haube: { key: "haube", dents: { "20": 30, "40": 10 } } }, shares: { techName: "Luis Secreto", techPct: 55 }, ...o } });
const byId = (l: any[], id: string) => l.find((x) => x.id === id);

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id; B = st.find((s) => s.type === "hall" && s.name === "Nave PDR Madrid").id;
  CARRO = st.find((s) => s.type === "carrosserie").id;
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { commission_pct: 20, report_emails: ["Taller@Example.test", "taller2@example.test"] } });
  admin = await inviteAndAccept(c, c.orgES, "admin@example.test", { role_id: c.roleId.org_admin });
  assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  chefA = await inviteAndAccept(c, c.orgES, "chefa@example.test", { role_id: c.roleId.chef_site, station_id: A });
  tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: A });
  // an invited technician now gets a technician record by himself (v4); these tests are about the plain role, so start without it
  await c.h.db.delete(technicians);
  techUserId = (await c.h.db.select().from(users).where(eq(users.email, "tech@example.test")))[0].id;
  carro = await inviteAndAccept(c, c.orgES, "carro@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
});
afterAll(async () => { await c.h.close(); });

describe("recipient rules (pure)", () => {
  const ins = (o: Partial<{ sendReports: boolean; reportsToSend: string; reportEmails: string[] }> = {}) => ({ sendReports: true, reportsToSend: "both", reportEmails: ["ins@x.test"], ...o });
  it("the carrosserie always receives; the insurer only when it wants this kind of report", () => {
    const base = { carrosserieEmails: ["Body@X.test", " body@x.test "], insurer: null };
    expect(recipientsFor(base, "kva")).toEqual(["body@x.test"]); // case + duplicates
    expect(recipientsFor({ ...base, insurer: ins() }, "kva")).toEqual(["body@x.test", "ins@x.test"]);
    expect(recipientsFor({ ...base, insurer: ins() }, "reparation")).toEqual(["body@x.test", "ins@x.test"]);
    expect(recipientsFor({ ...base, insurer: ins({ reportsToSend: "kva" }) }, "reparation")).toEqual(["body@x.test"]);
    expect(recipientsFor({ ...base, insurer: ins({ reportsToSend: "reparation" }) }, "kva")).toEqual(["body@x.test"]);
    expect(recipientsFor({ ...base, insurer: ins({ sendReports: false }) }, "kva")).toEqual(["body@x.test"]);
    expect(recipientsFor({ carrosserieEmails: [], insurer: ins() }, "kva")).toEqual(["ins@x.test"]);
    expect(recipientsFor({ carrosserieEmails: [], insurer: null }, "kva")).toEqual([]);
  });
  it("mail texts: German / Spanish, only the vehicle is identified (never amounts or internal names)", () => {
    const info = { plate: "1234 ABC", model: "Seat Leon", vin: "VF1", hasScan: true, senderName: "Ana" };
    const es = reportMail("es", "kva", info), de = reportMail("de", "kva", info), rr = reportMail("es", "reparation", info);
    expect(es.subject).toBe("Presupuesto daños por granizo – Seat Leon · 1234 ABC");
    expect(es.text).toContain("informe del escáner Colibri");
    expect(de.subject).toBe("Kostenvoranschlag Hagelschaden – Seat Leon · 1234 ABC");
    expect(de.text).toContain("Colibri-Scanbericht");
    expect(rr.subject).toContain("Informe fotográfico");
    expect(reportMail("de", "reparation", info).subject).toBe("Fotobericht Reparatur – Seat Leon · 1234 ABC");
    for (const m of [es, de, rr]) expect(m.text).not.toMatch(/€|EUR|%/);
  });
});

describe("insurers and links", () => {
  let insId: string, ins2: string;
  it("only roles with assurances.gerer manage insurers; input is validated", async () => {
    const r = await call(c, "POST", "/admin/insurers", { token: admin, org: c.orgES, body: { name: "Allianz", report_emails: ["claims@allianz.test"], send_reports: true, reports_to_send: "both" } });
    expect(r.status).toBe(201);
    insId = r.body.id;
    ins2 = (await call(c, "POST", "/admin/insurers", { token: admin, org: c.orgES, body: { name: "Caser" } })).body.id;
    expect((await call(c, "POST", "/admin/insurers", { token: assessor, org: c.orgES, body: { name: "X" } })).status).toBe(403);
    expect((await call(c, "POST", "/admin/insurers", { token: admin, org: c.orgES, body: { name: "" } })).status).toBe(400);
    expect((await call(c, "POST", "/admin/insurers", { token: admin, org: c.orgES, body: { name: "Y", report_emails: ["not-mail"] } })).status).toBe(400);
    expect((await call(c, "PUT", `/admin/insurers/${ins2}`, { token: admin, org: c.orgES, body: { name: "Caser Seguros" } })).body.name).toBe("Caser Seguros");
    expect((await call(c, "GET", "/admin/insurers", { token: admin, org: c.orgES })).body.length).toBeGreaterThanOrEqual(2);
    expect((await call(c, "GET", "/admin/insurers", { token: tech, org: c.orgES })).status).toBe(403);
  });
  it("links insurers to a carrosserie; the phones receive the links; unknown ids refused", async () => {
    const r = await call(c, "PUT", `/admin/stations/${A}/insurers`, { token: admin, org: c.orgES, body: { insurer_ids: [insId] } });
    expect(r.body.insurer_ids).toEqual([insId]);
    const p = await pull(c, assessor, c.orgES);
    expect(p.refs.insurers.map((i: any) => i.name).sort()).toEqual(["Allianz", "Caser Seguros"]);
    expect(p.refs.stationInsurers).toEqual([{ stationId: A, insurerId: insId }]);
    expect(JSON.stringify(p.refs.insurers)).not.toMatch(/claims@|report/i); // e-mails never go to the phones
    expect((await call(c, "PUT", `/admin/stations/${A}/insurers`, { token: admin, org: c.orgES, body: { insurer_ids: [uuid()] } })).status).toBe(404);
    expect((await call(c, "PUT", `/admin/stations/${A}/insurers`, { token: assessor, org: c.orgES, body: { insurer_ids: [] } })).status).toBe(403);
  });
  it("an insurer in use cannot be deleted; an unused one can", async () => {
    const vid = uuid();
    await push(c, assessor, [createOp(vid, { insurerId: insId })]);
    expect((await call(c, "DELETE", `/admin/insurers/${insId}`, { token: admin, org: c.orgES })).status).toBe(409);
    expect((await call(c, "DELETE", `/admin/insurers/${ins2}`, { token: admin, org: c.orgES })).status).toBe(200);
  });
  it("another organisation cannot touch these insurers", async () => {
    expect((await call(c, "PUT", `/admin/insurers/${insId}`, { token: c.superToken, org: c.orgDE, body: { name: "hijack" } })).status).toBe(404);
  });
  it("customer carrosserie accounts only receive their own insurers", async () => {
    const vid = uuid();
    await push(c, assessor, [createOp(vid, { insurerId: insId })]);
    const p = await pull(c, carro, c.orgES);
    expect(p.refs.insurers.map((i: any) => i.id)).toEqual([insId]);
    expect(p.refs.stationInsurers.every((l: any) => l.stationId === A)).toBe(true);
  });
});

describe("campaigns", () => {
  let camp: string;
  it("create / update / link sites; refs and vehicle link; delete only when unused", async () => {
    const r = await call(c, "POST", "/admin/campaigns", { token: admin, org: c.orgES, body: { name: "Talavera Allianz Okt 2026", country: "ES", start: "2026-10-01", end: "2026-10-31", station_ids: [A, B] } });
    expect(r.status).toBe(201);
    camp = r.body.id;
    expect((await call(c, "PUT", `/admin/campaigns/${camp}`, { token: admin, org: c.orgES, body: { station_ids: [A] } })).body.stationIds).toEqual([A]);
    expect((await call(c, "POST", "/admin/campaigns", { token: admin, org: c.orgES, body: { name: "X", station_ids: [uuid()] } })).status).toBe(400);
    expect((await call(c, "POST", "/admin/campaigns", { token: assessor, org: c.orgES, body: { name: "X" } })).status).toBe(403);
    const p = await pull(c, assessor, c.orgES);
    expect(p.refs.campaigns).toEqual([{ id: camp, name: "Talavera Allianz Okt 2026", country: "ES", start: "2026-10-01", end: "2026-10-31", stationIds: [A] }]);
    const vid = uuid();
    await push(c, assessor, [createOp(vid)]);
    expect((await push(c, assessor, [op("vehicle.header", { vehicleId: vid, fields: { campaignId: camp } })])).body.results[0].status).toBe("ok");
    expect(byId((await pull(c, assessor, c.orgES)).vehicles, vid).campaignId).toBe(camp);
    expect((await call(c, "DELETE", `/admin/campaigns/${camp}`, { token: admin, org: c.orgES })).status).toBe(409);
    const empty = (await call(c, "POST", "/admin/campaigns", { token: admin, org: c.orgES, body: { name: "empty" } })).body.id;
    expect((await call(c, "DELETE", `/admin/campaigns/${empty}`, { token: admin, org: c.orgES })).status).toBe(200);
  });
  it("freelancers with a campaign role see only that campaign's vehicles and campaign", async () => {
    const free = await inviteAndAccept(c, c.orgES, "free@example.test", { role_id: c.roleId.freelance, scope_campaign_id: camp, expires_at: new Date(Date.now() + 86400_000).toISOString() });
    const p = await pull(c, free, c.orgES);
    expect(p.vehicles.length).toBeGreaterThan(0);
    expect(p.vehicles.every((v: any) => v.campaignId === camp)).toBe(true);
    expect(p.refs.campaigns.map((x: any) => x.id)).toEqual([camp]);
  });
});

describe("letterheads", () => {
  it("each organisation is seeded with 'PDR Team GmbH' (with logo) and 'Neutral (ohne Logo)'", async () => {
    const rows = (await call(c, "GET", "/admin/companies", { token: admin, org: c.orgES })).body as any[];
    expect(rows.map((r) => r.name).sort()).toEqual(["Neutral (ohne Logo)", "PDR Team GmbH"]);
    const pdr = rows.find((r) => r.name === "PDR Team GmbH");
    expect(pdr.logoMeta).toMatchObject({ kind: "jpg", width: 1000, height: 276 });
    const dl = await call(c, "GET", `/admin/companies/${pdr.id}/logo`, { token: tech, org: c.orgES });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("image/jpeg");
    const p = await pull(c, tech, c.orgES);
    expect(p.refs.companies.find((x: any) => x.name === "PDR Team GmbH")).toMatchObject({ hasLogo: true, logo: { kind: "jpg", width: 1000, height: 276 } });
    expect(p.refs.companies.find((x: any) => x.name.startsWith("Neutral")).hasLogo).toBe(false);
  });
  it("create, edit, upload / replace / delete a logo (validated); other organisations are separate", async () => {
    const co = (await call(c, "POST", "/admin/companies", { token: admin, org: c.orgES, body: { name: "Taller X", address: "Calle 1", tax_id: "ES123", email: "x@x.test", footer: "Taller X S.L." } })).body;
    expect(co.name).toBe("Taller X");
    expect((await call(c, "PUT", `/admin/companies/${co.id}/logo`, { token: admin, org: c.orgES, raw: PNG, contentType: "image/png" })).body.logo).toEqual({ kind: "png", width: 300, height: 100 });
    expect((await call(c, "PUT", `/admin/companies/${co.id}/logo`, { token: admin, org: c.orgES, raw: JPEG, contentType: "image/jpeg" })).status).toBe(400); // not a real image header (no size)
    expect((await call(c, "PUT", `/admin/companies/${co.id}/logo`, { token: admin, org: c.orgES, raw: new TextEncoder().encode("<svg onload=alert(1)>"), contentType: "image/svg+xml" })).status).toBe(400);
    const big = new Uint8Array(1024 * 1024 + 1); big.set(PNG);
    expect((await call(c, "PUT", `/admin/companies/${co.id}/logo`, { token: admin, org: c.orgES, raw: big, contentType: "image/png" })).status).toBe(400);
    expect((await call(c, "PUT", `/admin/companies/${co.id}/logo`, { token: tech, org: c.orgES, raw: PNG, contentType: "image/png" })).status).toBe(403);
    expect((await call(c, "GET", `/admin/companies/${co.id}/logo`, { token: admin, org: c.orgES })).headers.get("content-type")).toBe("image/png");
    expect((await call(c, "DELETE", `/admin/companies/${co.id}/logo`, { token: admin, org: c.orgES })).status).toBe(200);
    expect((await call(c, "GET", `/admin/companies/${co.id}/logo`, { token: admin, org: c.orgES })).status).toBe(404);
    expect((await call(c, "PUT", `/admin/companies/${co.id}`, { token: admin, org: c.orgES, body: { active: false } })).body.active).toBe(false);
    expect((await pull(c, assessor, c.orgES)).refs.companies.some((x: any) => x.id === co.id)).toBe(false); // inactive letterheads are not offered
    expect((await call(c, "PUT", `/admin/companies/${co.id}`, { token: c.superToken, org: c.orgDE, body: { name: "hijack" } })).status).toBe(404);
  });
  it("image header parser", () => {
    expect(imageInfo(PNG)).toEqual({ kind: "png", width: 300, height: 100 });
    expect(imageInfo(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("technicians (master data)", () => {
  it("CRUD with defaults; restricted roles never receive the list; changing a default leaves vehicles alone", async () => {
    const t = (await call(c, "POST", "/admin/technicians", { token: admin, org: c.orgES, body: { name: "Luis", default_pct_pdr: 55, default_pct_demontage: 80 } })).body;
    expect(t).toMatchObject({ name: "Luis", defaultPctPdr: "55.00", defaultPctDemontage: "80.00" });
    const linked = (await call(c, "POST", "/admin/technicians", { token: admin, org: c.orgES, body: { name: "Ana", user_id: techUserId } })).body;
    expect(linked.userId).toBe(techUserId);
    expect((await call(c, "POST", "/admin/technicians", { token: admin, org: c.orgES, body: { name: "Ghost", user_id: uuid() } })).status).toBe(404);
    expect((await call(c, "POST", "/admin/technicians", { token: assessor, org: c.orgES, body: { name: "No" } })).status).toBe(403);
    expect((await call(c, "POST", "/admin/technicians", { token: admin, org: c.orgES, body: { name: "x", default_pct_pdr: 150 } })).status).toBe(400);
    const full = await pull(c, assessor, c.orgES);
    expect(full.refs.technicians.map((x: any) => x.name).sort()).toEqual(["Ana", "Luis"]);
    expect(full.refs.technicians.find((x: any) => x.name === "Luis")).toMatchObject({ defaultPctPdr: 55, defaultPctDemontage: 80 });
    for (const tok of [tech, carro]) expect((await pull(c, tok, c.orgES)).refs.technicians).toEqual([]);
    const vid = uuid();
    await push(c, assessor, [createOp(vid)]);
    await call(c, "PUT", `/admin/technicians/${t.id}`, { token: admin, org: c.orgES, body: { default_pct_pdr: 40 } });
    expect(byId((await pull(c, assessor, c.orgES)).vehicles, vid).techPct).toBe(55); // vehicle keeps its own copy
    await call(c, "PUT", `/admin/technicians/${t.id}`, { token: admin, org: c.orgES, body: { active: false } });
    expect((await pull(c, assessor, c.orgES)).refs.technicians.map((x: any) => x.name)).toEqual(["Ana"]);
  });
});

describe("report sending by e-mail", () => {
  let vid: string, insId: string;
  const reportOp = (id: string, vehicleId: string, type = "kva", lang = "es") => op("report.send", { vehicleId, report: { id, type, lang } });
  beforeAll(async () => {
    insId = (await call(c, "POST", "/admin/insurers", { token: admin, org: c.orgES, body: { name: "Mutua", report_emails: ["mutua@example.test"], send_reports: true, reports_to_send: "kva" } })).body.id;
    await call(c, "PUT", `/admin/stations/${A}/insurers`, { token: admin, org: c.orgES, body: { insurer_ids: [insId] } });
    vid = uuid();
    await push(c, assessor, [createOp(vid, { insurerId: insId })]);
    await push(c, assessor, [op("vehicle.header", { vehicleId: vid, fields: { claimNumber: "SIN-77" } })]);
  });

  it("preview of the recipients follows the rules (kva → body shop + insurer, repair report → body shop only)", async () => {
    const k = await call(c, "GET", `/reports/recipients?vehicleId=${vid}&type=kva`, { token: assessor });
    expect(k.body.recipients).toEqual(["taller@example.test", "taller2@example.test", "mutua@example.test"]);
    expect((await call(c, "GET", `/reports/recipients?vehicleId=${vid}&type=reparation`, { token: assessor })).body.recipients).toEqual(["taller@example.test", "taller2@example.test"]);
    expect((await call(c, "GET", `/reports/recipients?vehicleId=${vid}&type=nope`, { token: assessor })).status).toBe(400);
    expect((await call(c, "GET", `/reports/recipients?vehicleId=${vid}&type=kva`, { token: tech })).status).toBe(404); // not assigned: cannot even see the vehicle
    expect((await call(c, "GET", `/reports/recipients?vehicleId=${vid}&type=kva`, { token: carro })).status).toBe(403); // customer has no right to send
  });

  it("queue op + PDF upload → one e-mail with the PDF to the right people; reply-to is the sender; history shows it", async () => {
    const rid = uuid();
    expect((await push(c, assessor, [reportOp(rid, vid)])).body.results[0].status).toBe("ok");
    expect(c.mailer.sent.filter((m) => String(m.subject).includes("Presupuesto")).length).toBe(0); // nothing sent before the file arrives
    c.mailer.sent.length = 0;
    const up = await call(c, "PUT", `/files/report/${rid}`, { token: assessor, raw: PDF, contentType: "application/pdf" });
    expect(up.status).toBe(200);
    expect(c.mailer.sent.length).toBe(1);
    const m = c.mailer.last();
    expect(m.to).toEqual(["taller@example.test", "taller2@example.test", "mutua@example.test"]);
    expect(m.subject).toBe("Presupuesto daños por granizo – Seat Leon · 1234 ABC");
    expect(m.replyTo).toBe("assessor@example.test");
    expect(m.attachments![0]).toMatchObject({ contentType: "application/pdf", filename: "Presupuesto_1234-ABC.pdf" });
    expect([...m.attachments![0].content]).toEqual([...PDF]);
    // internal data never in the mail
    const blob = JSON.stringify({ s: m.subject, t: m.text });
    expect(blob).not.toMatch(/Luis Secreto|Secreto|55|20 ?%|€/);
    const hist = await call(c, "GET", `/reports?vehicleId=${vid}`, { token: assessor });
    expect(hist.body[0]).toMatchObject({ id: rid, type: "kva", status: "sent", sentBy: "assessor" });
    expect(hist.body[0].recipients.length).toBe(3);
    expect(hist.body[0]).toMatchObject({ lang: "es", hasFile: true });
    // Documents tab: the stored PDF can be downloaded by the people who may send it, nobody else
    const dl = await call(c, "GET", `/reports/${rid}/file`, { token: assessor });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect([...dl.bytes]).toEqual([...PDF]);
    expect((await call(c, "GET", `/reports/${rid}/file`, { token: carro })).status).toBe(404);
    expect((await call(c, "GET", `/reports/${rid}/file`, { token: tech })).status).toBe(404);
    expect((await call(c, "GET", `/reports/${uuid()}/file`, { token: assessor })).status).toBe(404);
    expect((await call(c, "GET", `/reports/${rid}/file`, {})).status).toBe(401);
    // the same upload again does not send twice
    c.mailer.sent.length = 0;
    expect((await call(c, "PUT", `/files/report/${rid}`, { token: assessor, raw: PDF, contentType: "application/pdf" })).body.status).toBe("sent");
    expect(c.mailer.sent.length).toBe(0);
  });

  it("repair photo report goes to the body shop only (insurer wants kva only); German text for a German report", async () => {
    c.mailer.sent.length = 0;
    const rid = uuid();
    await push(c, assessor, [reportOp(rid, vid, "reparation", "de")]);
    await call(c, "PUT", `/files/report/${rid}`, { token: assessor, raw: PDF, contentType: "application/pdf" });
    expect(c.mailer.last().to).toEqual(["taller@example.test", "taller2@example.test"]);
    expect(c.mailer.last().subject).toBe("Fotobericht Reparatur – Seat Leon · 1234 ABC");
    expect(c.mailer.last().attachments![0].filename).toBe("Fotobericht_Reparatur_1234-ABC.pdf");
  });

  it("the op is idempotent; a retried op keeps the same row", async () => {
    const rid = uuid();
    const o = reportOp(rid, vid);
    await push(c, assessor, [o]);
    expect((await push(c, assessor, [o])).body.results[0].status).toBe("ok");
    expect((await push(c, assessor, [{ ...o, opId: uuid() }])).body.results[0].status).toBe("ok"); // same report id again
    expect((await c.h.db.select().from(reportSends).where(eq(reportSends.id, rid))).length).toBe(1);
    // somebody else cannot reuse the id
    expect((await push(c, chefA, [{ ...o, opId: uuid() }])).body.results[0].status).toBe("rejected");
  });

  it("rights: technician / customer / assessor without the right are refused; no recipients is refused with a clear code", async () => {
    await c.h.db.insert(vehicleAssignments).values({ vehicleId: vid, userId: techUserId, type: "pdr" });
    expect((await push(c, tech, [reportOp(uuid(), vid)])).body.results[0]).toMatchObject({ status: "rejected", code: "not_allowed" });
    expect((await push(c, carro, [reportOp(uuid(), vid)])).body.results[0]).toMatchObject({ status: "rejected", code: "not_allowed" });
    // a vehicle whose customer has no report e-mail and no insurer
    const bare = uuid();
    const noMail = (await call(c, "POST", "/admin/bodyshops", { token: admin, org: c.orgES, body: { name: "No Mail Taller" } })).body.id; // a body shop without report e-mails
    await push(c, assessor, [createOp(bare, { clientStationId: noMail })]);
    const r = await push(c, assessor, [reportOp(uuid(), bare)]);
    expect(r.body.results[0]).toMatchObject({ status: "rejected", code: "report_no_recipients" });
    expect(r.body.results[0].message).toContain("No recipients");
  });

  it("upload rules: only the sender, only PDFs, size limit; unknown id", async () => {
    const rid = uuid();
    await push(c, assessor, [reportOp(rid, vid)]);
    expect((await call(c, "PUT", `/files/report/${rid}`, { token: chefA, raw: PDF, contentType: "application/pdf" })).status).toBe(404);
    expect((await call(c, "PUT", `/files/report/${rid}`, { token: assessor, raw: new TextEncoder().encode("not a pdf"), contentType: "application/pdf" })).status).toBe(400);
    const big = new Uint8Array(15 * 1024 * 1024 + 10); big.set(PDF);
    expect((await call(c, "PUT", `/files/report/${rid}`, { token: assessor, raw: big, contentType: "application/pdf" })).status).toBe(400);
    expect((await call(c, "PUT", `/files/report/${uuid()}`, { token: assessor, raw: PDF, contentType: "application/pdf" })).status).toBe(404);
    expect((await call(c, "PUT", `/files/report/${rid}`, { raw: PDF, contentType: "application/pdf" })).status).toBe(401);
  });

  it("provider outage → 502 and status 'failed'; the retry after recovery sends exactly once", async () => {
    const rid = uuid();
    await push(c, assessor, [reportOp(rid, vid)]);
    c.mailer.fail = new Error("provider down");
    const bad = await call(c, "PUT", `/files/report/${rid}`, { token: assessor, raw: PDF, contentType: "application/pdf", lang: "en" });
    expect(bad.status).toBe(502);
    expect(bad.body.error).toBe("The e-mail could not be sent");
    expect((await c.h.db.select().from(reportSends).where(eq(reportSends.id, rid)))[0]).toMatchObject({ status: "failed" });
    c.mailer.fail = null;
    c.mailer.sent.length = 0;
    expect((await call(c, "PUT", `/files/report/${rid}`, { token: assessor, raw: PDF, contentType: "application/pdf" })).status).toBe(200);
    expect(c.mailer.sent.length).toBe(1);
    expect((await c.h.db.select().from(reportSends).where(eq(reportSends.id, rid)))[0]).toMatchObject({ status: "sent", error: null });
  });

  it("the history is visible only to people who may send reports", async () => {
    expect((await call(c, "GET", `/reports?vehicleId=${vid}`, { token: carro })).status).toBe(403);
    expect((await call(c, "GET", `/reports?vehicleId=${vid}`, { token: assessor })).status).toBe(200);
    expect((await call(c, "GET", `/reports?vehicleId=${uuid()}`, { token: assessor })).status).toBe(404);
  });

  it("recipients are fixed when the op is accepted: changing the insurer later does not redirect a queued report", async () => {
    const rid = uuid();
    await push(c, assessor, [reportOp(rid, vid)]);
    await call(c, "PUT", `/admin/insurers/${insId}`, { token: admin, org: c.orgES, body: { report_emails: ["other@example.test"] } });
    c.mailer.sent.length = 0;
    await call(c, "PUT", `/files/report/${rid}`, { token: assessor, raw: PDF, contentType: "application/pdf" });
    expect(c.mailer.last().to).toContain("mutua@example.test");
    expect(c.mailer.last().to).not.toContain("other@example.test");
    void tick;
  });
});
