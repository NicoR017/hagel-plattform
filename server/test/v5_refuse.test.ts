// v5: the status "Refusé" — a car that was assessed and will not be repaired: reason, only before the repair, appointments cancelled,
// the body shop is told, and it is out of every dashboard figure (its own counter only).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { REFUSE_REASONS, parseRefuseMotif } from "@hagel/shared";
import { todayIn } from "../src/repair";
import { refusalMail } from "../src/mails";
import { insurers, repairAppointments, repairBookings, repairEvents, technicians, vehicleStatusHistory, vehicles } from "../src/schema";
import { berlinDate } from "../src/dashboard";
import { call, dentsPanel, inviteAndAccept, op, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx;
let A: string, CARRO: string, insurerId: string;
let assessor: string, tech: string;

const ok = async (token: string, ops: unknown[]) => { const r = await push(c, token, ops); expect(r.status).toBe(200); return r.body.results as { status: string; code?: string }[]; };
const one = async (token: string, o: unknown) => (await ok(token, [o]))[0];
const vrow = async (id: string) => (await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0];
const status = (id: string, statut: string, motif?: string) => one(assessor, op("vehicle.status", { vehicleId: id, statut, ...(motif !== undefined ? { motif } : {}) }));
async function car(plate: string, statut = "besichtigung") {
  const id = uuid();
  expect((await one(assessor, op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, insurerId, header: { land: "ES", kennzeichen: plate, modell: "Seat Leon", leistungsdatum: berlinDate(new Date()), stundensatz: 69 }, panels: { haube: dentsPanel("haube", { "20": 12, "30": 6 }) }, shares: {}, statut } }))).status).toBe("ok");
  return id;
}
function workday(n: number): string {
  const d = new Date(todayIn("Europe/Madrid") + "T12:00:00Z");
  for (let k = 0; k < n; ) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) k++; }
  return d.toISOString().slice(0, 10);
}
const dash = async (qs = "") => (await call(c, "GET", `/dashboard${qs}`, { token: c.superToken, org: c.orgES })).body;

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  CARRO = st.find((s) => s.type === "carrosserie").id;
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { commission_pct: 10, report_emails: ["taller@example.test"] } });
  [insurerId] = (await c.h.db.insert(insurers).values({ orgId: c.orgES, name: "Allianz", reportEmails: ["siniestros@allianz.test"], sendReports: true, reportsToSend: "both" }).returning()).map((i) => i.id);
  assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: A });
  await c.h.db.delete(technicians);
});
afterAll(async () => { await c.h.close(); });

describe("the reason of a refusal", () => {
  it("one of the reasons, with an optional comment; the motif is parsed back", () => {
    expect([...REFUSE_REASONS]).toEqual(["non_pdr", "client", "assurance", "epave"]);
    expect(parseRefuseMotif("epave")).toEqual({ key: "epave", comment: "", valid: true });
    expect(parseRefuseMotif("client: prix trop élevé: pas d'accord")).toEqual({ key: "client", comment: "prix trop élevé: pas d'accord", valid: true });
    expect(parseRefuseMotif("whatever").valid).toBe(false);
    expect(parseRefuseMotif("").valid).toBe(false);
    expect(parseRefuseMotif(undefined).valid).toBe(false);
  });
  it("refusing needs a valid reason", async () => {
    const id = await car("RF 001");
    expect((await status(id, "refuse")).code).toBe("motif_required");
    expect((await status(id, "refuse", "because")).code).toBe("motif_required");
    expect((await vrow(id)).statut).toBe("besichtigung");
    expect((await status(id, "refuse", "non_pdr")).status).toBe("ok");
    const v = await vrow(id);
    expect(v).toMatchObject({ statut: "refuse", statutMotif: "non_pdr", statutAvant: "besichtigung" });
    const h = (await c.h.db.select().from(vehicleStatusHistory).where(eq(vehicleStatusHistory.vehicleId, id))).filter((x) => x.statut === "refuse");
    expect(h).toHaveLength(1);
    expect(h[0].motif).toBe("non_pdr");
  });
  it("mail texts in the four languages: reason in words, no amounts", () => {
    const i = { plate: "1234 ABC", model: "Seat Leon", claim: "SIN-1", reason: "epave", comment: "feu" };
    expect(refusalMail("de", i).text).toContain("Totalschaden");
    expect(refusalMail("es", i).text).toContain("Siniestro total");
    expect(refusalMail("fr", i).text).toContain("Épave");
    expect(refusalMail("en", i).text).toContain("Write-off");
    for (const l of ["de", "es", "fr", "en"] as const) expect(refusalMail(l, i).text).not.toMatch(/€|EUR|%/);
  });
});

describe("only before the repair, and back again", () => {
  it("Arrived, Assessment and On hold can be refused; Repair, Done and Returned cannot", async () => {
    for (const s of ["arrive", "besichtigung"]) expect((await status(await car(`RF ${s}`, s), "refuse", "client")).status).toBe("ok");
    const hold = await car("RF hold", "besichtigung");
    expect((await status(hold, "attente", "Teile")).status).toBe("ok");
    expect((await status(hold, "refuse", "assurance")).status).toBe("ok");
    for (const s of ["reparatur", "fertig", "rendu"]) {
      const id = await car(`RF no ${s}`, s);
      expect((await status(id, "refuse", "client")).code, s).toBe("refuse_status");
      expect((await vrow(id)).statut).toBe(s);
    }
    // a car already on the repair board (stage set) cannot be refused either
    const staged = await car("RF stage");
    await c.h.db.update(vehicles).set({ repairStage: "pdr" }).where(eq(vehicles.id, staged));
    expect((await status(staged, "refuse", "client")).code).toBe("refuse_status");
  });
  it("a refused car can get any other status again; the reason is cleared; the previous status is offered", async () => {
    const id = await car("RF back", "besichtigung");
    await status(id, "refuse", "client: pas d'accord");
    expect(await vrow(id)).toMatchObject({ statut: "refuse", statutMotif: "client: pas d'accord" });
    expect((await status(id, "refuse", "epave")).status).toBe("ok"); // the reason can be changed, the previous status stays
    expect(await vrow(id)).toMatchObject({ statutMotif: "epave", statutAvant: "besichtigung" });
    expect((await status(id, "besichtigung")).status).toBe("ok");
    expect(await vrow(id)).toMatchObject({ statut: "besichtigung", statutMotif: null, statutAvant: null });
  });
  it("a car cannot be created as refused; technicians cannot change statuses at all", async () => {
    const bad = await push(c, assessor, [op("vehicle.create", { vehicle: { id: uuid(), stationId: A, clientStationId: CARRO, header: { land: "ES", kennzeichen: "RF new", leistungsdatum: "2026-10-19", stundensatz: 69 }, panels: {}, shares: {}, statut: "refuse" } })]);
    expect(bad.status).toBe(400);
    const id = await car("RF perm");
    expect((await one(tech, op("vehicle.status", { vehicleId: id, statut: "refuse", motif: "client" }))).status).toBe("rejected");
  });
});

describe("appointments and e-mails", () => {
  it("the repair appointment and the technician appointments are cancelled; the body shop is told; the insurer is not", async () => {
    const id = await car("RF book");
    const bid = uuid();
    expect((await one(assessor, op("booking.create", { vehicleId: id, booking: { id: bid, date: workday(4), time: "08:30", phone: "+34 612 345 678", email: "kunde@example.test" } }))).status).toBe("ok");
    const techRow = (await c.h.db.insert(technicians).values({ orgId: c.orgES, name: "Test Tech", kind: "pdr" }).returning())[0];
    const apId = uuid();
    await c.h.db.insert(repairAppointments).values({ id: apId, vehicleId: id, technicianId: techRow.id, date: workday(5), durationMin: 60, note: "" });
    c.mailer.sent.length = 0;
    expect((await status(id, "refuse", "assurance: pas de prise en charge")).status).toBe("ok");
    expect((await c.h.db.select().from(repairBookings).where(eq(repairBookings.id, bid)))[0]).toMatchObject({ status: "cancelled", cancelReason: "vehicle_refused" });
    expect((await c.h.db.select().from(repairAppointments).where(eq(repairAppointments.id, apId)))[0].deletedAt).not.toBeNull();
    const to = (m: { to: string | string[] }) => ([] as string[]).concat(m.to);
    const cancel = c.mailer.sent.find((m) => /storniert|cancelada/i.test(String(m.subject)));
    expect(cancel).toBeTruthy();
    expect(to(cancel!)).toContain("kunde@example.test");
    const refusal = c.mailer.sent.find((m) => /nicht repariert|no será reparado/i.test(String(m.subject)));
    expect(refusal).toBeTruthy();
    expect(to(refusal!)).toEqual(["taller@example.test"]); // the body shop only, never the insurer or the customer
    expect(String(refusal!.text)).toContain("pas de prise en charge");
    expect(String(refusal!.text)).toContain("La aseguradora rechaza"); // the reason in words (Spanish station)
    expect(refusal!.replyTo).toBe("assessor@example.test");
    const ev = (await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).map((e) => e.type);
    expect(ev).toContain("booking_cancelled");
    expect(ev).toContain("refusal_mail_sent");
  });
  it("changing the reason of a refused car sends nothing more", async () => {
    const id = await car("RF twice");
    await status(id, "refuse", "client");
    c.mailer.sent.length = 0;
    await status(id, "refuse", "epave");
    expect(c.mailer.sent.length).toBe(0);
  });
  it("no body shop address: no e-mail, the refusal still works and is noted in the history", async () => {
    await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { report_emails: [] } });
    const id = await car("RF nomail");
    c.mailer.sent.length = 0;
    expect((await status(id, "refuse", "non_pdr")).status).toBe("ok");
    expect(c.mailer.sent.filter((m) => /nicht repariert|no será reparado/i.test(String(m.subject)))).toHaveLength(0);
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).map((e) => e.type)).toContain("refusal_mail_no_recipients");
    await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { report_emails: ["taller@example.test"] } });
  });
});

describe("dashboard", () => {
  it("a refused car is out of every figure; only the Refused counter knows it", async () => {
    const before = await dash();
    const live = await car("RF dash live");
    const gone = await car("RF dash gone");
    const mid = await dash();
    expect(mid.vehicles).toBe(before.vehicles + 2);
    await status(gone, "refuse", "epave");
    const after = await dash();
    expect(after.vehicles).toBe(before.vehicles + 1); // the live one counts, the refused one does not
    expect(after.kpis.refused.ids).toContain(gone);
    expect(after.kpis.refused.ids).not.toContain(live);
    expect(after.kpis.refused.n).toBeGreaterThanOrEqual(1);
    // nowhere else: not in the stations, the link table, the revenue, the technician or the other counters
    const everywhere = JSON.stringify({ sites: after.sites, linkTable: after.linkTable, revenue: after.revenue, technicians: after.technicians, kpis: { ...after.kpis, refused: null }, delayed: after.delayed, hold: after.hold });
    expect(everywhere).not.toContain(gone);
    expect(everywhere).toContain(live);
    expect(after.revenue.total).toBeCloseTo(mid.revenue.total - (mid.revenue.total - before.revenue.total) / 2, 0); // half of the two new (identical) cars' net is gone
    // by period: refused today, so counted today and not in the past
    const today = berlinDate(new Date());
    expect((await dash(`?from=${today}&to=${today}`)).kpis.refused.ids).toContain(gone);
    expect((await dash("?to=2000-01-01")).kpis.refused.ids).not.toContain(gone);
  });
  it("the technician sheets and the finished-cars export never contain a refused car", async () => {
    const id = await car("RF sheet", "besichtigung");
    await c.h.db.insert(vehicleStatusHistory).values({ vehicleId: id, statut: "fertig" }); // it was finished once, then reopened and refused
    await status(id, "refuse", "client");
    const sheets = (await call(c, "GET", "/dashboard/technician-sheets", { token: c.superToken, org: c.orgES })).body;
    expect(JSON.stringify(sheets)).not.toContain(id);
    const exp = (await call(c, "GET", "/dashboard/finished-export", { token: c.superToken, org: c.orgES })).body;
    expect(JSON.stringify(exp)).not.toContain(id);
  });
});
