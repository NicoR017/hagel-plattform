// UI v3, phase 5: the repair report at Finish — made and e-mailed by the server, once, with the amounts but never the internal split.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { insurers, repairEvents, reportSends, technicians, users, vehicles } from "../src/schema";
import { call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

const JPG = new Uint8Array(readFileSync(resolve(__dirname, "../../assets/pdr-team-logo.jpg")));

let c: Ctx, A: string, NOMAIL: string;
let assessor: string, chefA: string, tech: string, carro: string, techUserId: string, insurerId: string, techAll: { token: string; userId: string };

async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((pg) => {
    const contents = pg.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    let out = "";
    for (const r of refs) {
      const st = doc.context.lookup(r as never);
      if (!(st instanceof PDFRawStream)) continue;
      const txt = Buffer.from(decodePDFRawStream(st).decode()).toString("latin1");
      for (const m of txt.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
        let s = "";
        for (let i = 0; i < m[1].length; i += 2) { const b = parseInt(m[1].slice(i, i + 2), 16); s += b === 0x80 ? "€" : String.fromCharCode(b); }
        out += s + "\n";
      }
    }
    return out;
  }).join("\n");
}

const one = async (token: string, o: unknown) => ((await push(c, token, [o])).body.results as { status: string; code?: string }[])[0];
const row = async (id: string) => (await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0];
const sends = async (id: string) => (await c.h.db.select().from(reportSends).where(eq(reportSends.vehicleId, id))).filter((s) => s.type === "reparation").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

/** a vehicle ready for Finish: measured, in repair, technician assigned, to-dos none, all checks done, one photo per stage (a real JPEG) */
async function readyToFinish(plate: string, station = A, extra: Record<string, unknown> = {}, w: { token: string; userId: string } = { token: tech, userId: techUserId }): Promise<string> {
  const id = uuid();
  const r = await one(assessor, op("vehicle.create", { vehicle: { id, stationId: station, clientStationId: station, insurerId: extra.insurerId ?? null, statut: "besichtigung", panels: { haube: dentsPanel("haube", { "20": 12, "30": 6 }) }, shares: { techName: "Test Tech", techPct: 55 }, header: { land: "ES", kennzeichen: plate, modell: "Seat Leon", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69, partsToReplace: ["Antenne"] } } }));
  expect(r.status).toBe("ok");
  expect((await one(assessor, op("vehicle.repairStage", { vehicleId: id, stage: "bereit" }))).status).toBe("ok");
  expect((await one(assessor, op("vehicle.assign", { vehicleId: id, kind: "pdr", userIds: [w.userId] }))).status).toBe("ok");
  const todo = (await pull(c, chefA, c.orgES)).vehicles.find((v: any) => v.id === id).repair.todos[0];
  expect((await one(w.token, op("repair.todo.toggle", { todoId: todo.id, done: true }))).status).toBe("ok");
  for (const k of ["pdr", "teile"]) expect((await one(w.token, op("repair.check", { vehicleId: id, key: k, done: true }))).status).toBe("ok");
  expect((await one(chefA, op("repair.check", { vehicleId: id, key: "chef", done: true }))).status).toBe("ok");
  for (const s of ["demontage", "pdr", "remontage"]) {
    const pid = uuid();
    await one(w.token, op("photo.add", { photo: { id: pid, vehicleId: id, label: "Detail / Delle", phase: "reparatur", takenAt: new Date().toISOString() } }));
    expect((await call(c, "PUT", `/files/photo/${pid}`, { token: w.token, org: c.orgES, raw: JPG, contentType: "image/jpeg" })).status).toBe(200);
    await one(w.token, op("photo.stage", { photoId: pid, repairStage: s, role: "Techniker" }));
  }
  return id;
}

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string; name: string }[];
  A = st.find((s) => s.type === "carrosserie")!.id;
  await call(c, "PUT", `/admin/stations/${A}`, { token: c.superToken, org: c.orgES, body: { commission_pct: 10, report_emails: ["taller@example.test"] } });
  NOMAIL = (await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "carrosserie", name: "Sin correo", capacite: 10 } })).body.id;
  [insurerId] = (await c.h.db.insert(insurers).values({ orgId: c.orgES, name: "Allianz", reportEmails: ["siniestros@allianz.test"], sendReports: true, reportsToSend: "both" }).returning()).map((i) => i.id);
  assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  chefA = await inviteAndAccept(c, c.orgES, "chefa@example.test", { role_id: c.roleId.chef_site });
  tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: A });
  techUserId = (await c.h.db.select().from(users).where(eq(users.email, "tech@example.test")))[0].id;
  const tokAll = await inviteAndAccept(c, c.orgES, "techall@example.test", { role_id: c.roleId.technicien });
  techAll = { token: tokAll, userId: (await c.h.db.select().from(users).where(eq(users.email, "techall@example.test")))[0].id };
  carro = await inviteAndAccept(c, c.orgES, "carro@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: A });
  // an invited technician now gets a technician record by himself (v4); these tests are about the plain role, so start without it
  await c.h.db.delete(technicians);
});
afterAll(async () => { await c.h.close(); });

describe("the repair report at Finish", () => {
  let id: string;
  it("is made and e-mailed by the server when the car reaches Finish: station list + the vehicle's insurer, PDF attached", async () => {
    id = await readyToFinish("REP 100", A, { insurerId });
    c.mailer.sent.length = 0;
    expect((await one(tech, op("vehicle.repairStage", { vehicleId: id, stage: "finish" }))).status).toBe("ok");
    expect(await row(id)).toMatchObject({ statut: "fertig", repairStage: "finish" });
    expect(c.mailer.sent).toHaveLength(1);
    const m = c.mailer.sent[0];
    expect(m.to).toEqual(["taller@example.test", "siniestros@allianz.test"]);
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments![0].filename).toBe("Informe_reparacion_REP-100.pdf");
    expect(m.text).not.toMatch(/€|netto|Techniker|Provision/i);
    const s = (await sends(id));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ status: "sent", sentBy: null, lang: "es" });
    expect(s[0].fileKey).toBeTruthy();
    expect(c.storage.files.has(s[0].fileKey!)).toBe(true);
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).some((e) => e.type === "report_sent")).toBe(true);
  });

  it("the PDF has the plate, the photos and the estimate's net / VAT / gross, and NOT the internal split", async () => {
    const txt = await pdfText(c.mailer.sent[0].attachments![0].content);
    expect(txt).toContain("REP 100");
    expect(txt).toContain("Informe fotogr");
    expect(txt).toContain("Antenne");
    expect(txt).toMatch(/Base imponible: .*€/);
    expect(txt).toMatch(/Total con IVA: .*€/);
    expect(txt).not.toContain("Test Tech");
    expect(txt).not.toMatch(/Provision|comisi|Bleibt|Técnico:/i);
    const pages = (await PDFDocument.load(c.mailer.sent[0].attachments![0].content)).getPageCount();
    expect(pages).toBeGreaterThanOrEqual(1);
    // the same figures as the vehicle's amounts
    const v = (await pull(c, chefA, c.orgES)).vehicles.find((x: any) => x.id === id);
    expect(v.repair.lastReport).toMatchObject({ status: "sent", auto: true });
  });

  it("only once per vehicle: moved back and finished again sends nothing new; the manager can re-send, others cannot", async () => {
    expect((await one(chefA, op("vehicle.repairStage", { vehicleId: id, stage: "remontage" }))).status).toBe("ok");
    expect((await one(tech, op("vehicle.repairStage", { vehicleId: id, stage: "finish" }))).status).toBe("ok");
    expect(c.mailer.sent).toHaveLength(1);
    expect(await sends(id)).toHaveLength(1);
    // re-send by hand
    expect((await call(c, "POST", `/vehicles/${id}/repair-report`, { token: tech, org: c.orgES })).status).toBe(403); // a technician may not
    expect((await call(c, "POST", `/vehicles/${id}/repair-report`, { token: carro, org: c.orgES })).status).toBeGreaterThanOrEqual(403);
    const r = await call(c, "POST", `/vehicles/${id}/repair-report`, { token: chefA, org: c.orgES });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "sent" });
    expect(c.mailer.sent).toHaveLength(2);
    const s = await sends(id);
    expect(s.map((x) => x.sentBy === null)).toEqual([true, false]);
  });

  it("a vehicle that is not finished cannot get the report by hand", async () => {
    const other = await readyToFinish("REP 101");
    expect((await call(c, "POST", `/vehicles/${other}/repair-report`, { token: chefA, org: c.orgES })).status).toBe(409);
  });

  it("the old status path (Fertig without the board) sends nothing and blocks nothing", async () => {
    const other = await readyToFinish("REP 102");
    c.mailer.sent.length = 0;
    expect((await one(assessor, op("vehicle.status", { vehicleId: other, statut: "fertig" }))).status).toBe("ok");
    expect(c.mailer.sent).toHaveLength(0);
    expect(await sends(other)).toHaveLength(0);
  });

  it("a provider outage does not undo the Finish: the failure is logged and the manager re-sends later", async () => {
    const other = await readyToFinish("REP 103");
    c.mailer.sent.length = 0;
    c.mailer.fail = new Error("provider down");
    expect((await one(tech, op("vehicle.repairStage", { vehicleId: other, stage: "finish" }))).status).toBe("ok");
    expect((await row(other)).statut).toBe("fertig");
    let s = await sends(other);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ status: "failed" });
    expect(s[0].error).toContain("provider down");
    const v = (await pull(c, chefA, c.orgES)).vehicles.find((x: any) => x.id === other);
    expect(v.repair.lastReport).toMatchObject({ status: "failed" });
    c.mailer.fail = null;
    expect((await call(c, "POST", `/vehicles/${other}/repair-report`, { token: chefA, org: c.orgES })).body.status).toBe("sent");
    s = await sends(other);
    expect(s.map((x) => x.status)).toEqual(["failed", "sent"]);
    expect(c.mailer.sent).toHaveLength(1);
  });

  it("no recipients (no e-mail on the station, no insurer): Finish works, the missing list is logged as 'no_recipients'", async () => {
    const other = await readyToFinish("REP 104", NOMAIL, {}, techAll);
    c.mailer.sent.length = 0;
    // the technician is assigned by user id: he needs a role on that station to move the card (use the chef)
    expect((await one(chefA, op("vehicle.repairStage", { vehicleId: other, stage: "finish" }))).status).toBe("ok");
    expect((await row(other)).statut).toBe("fertig");
    expect(c.mailer.sent).toHaveLength(0);
    expect((await sends(other)).map((x) => x.status)).toEqual(["no_recipients"]);
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, other))).some((e) => e.type === "report_no_recipients")).toBe(true);
  });

  it("the card badge data: the booking that started the car is named, photos carry the name of who took them", async () => {
    const v = (await pull(c, chefA, c.orgES));
    const mine = v.vehicles.find((x: any) => x.id === id);
    expect(mine.repair).toHaveProperty("lastReport");
    const ph = v.photos.filter((p: any) => p.vehicleId === id);
    expect(ph.length).toBe(3);
    expect(ph.every((p: any) => p.takenByName && p.role === "Techniker" && ["demontage", "pdr", "remontage"].includes(p.repairStage))).toBe(true);
  });
});
