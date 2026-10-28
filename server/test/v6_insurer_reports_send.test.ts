// V6 phase 3, automatic insurer reports: the e-mail (variables, languages), sending now / test / resend with the PDF archived,
// the history, the planning, and the automatic send: window, one per period, catch-up, retries. The copies never reach real people outside MAIL_MODE=live.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { MemoryMailer, ModeMailer, ResendMailer } from "../src/email";
import { MAX_ATTEMPTS, localTime, nextSends, runDueInsurerReports, scheduledDay } from "../src/insurer_report_send";
import { DEFAULT_TEXTS, periodShort, renderReportMail, renderTemplate, templateVars, unknownVars } from "../src/insurer_report_text";
import { nextPeriod } from "../src/insurer_reports";
import { auditLog, insurerReportRuns, insurerReports, insurers, organizations, vehicleStatusHistory, vehicles } from "../src/schema";
import { call, inviteAndAccept, setup, type Ctx } from "./helpers";

let c: Ctx;
let HALL: string, CARRO: string, allianz: string;
let chef: string, assessor: string, tech: string, bodyshopAcc: string;
const sup = (m: string, p: string, body?: unknown) => call(c, m, p, { token: c.superToken, org: c.orgES, body });
const as = (token: string, m: string, p: string, body?: unknown) => call(c, m, p, { token, org: c.orgES, body });
const valid = (o: Record<string, unknown> = {}) => ({ name: "Allianz weekly", language: "es", insurer_ids: [allianz], to_emails: ["siniestros@allianz.test"], cc_emails: ["boss@allianz.test"], bcc_emails: ["intern@pdr.test"], project_start: "2026-09-01", ...o });
const Q = "?from=2026-10-19&to=2026-10-25";
const body = { from: "2026-10-19", to: "2026-10-25" };
const PDF_HEAD = "%PDF";
/** a report created long ago: the automatic send only skips a report created after its window opened on the day */
async function oldReport(o: Record<string, unknown> = {}) {
  const made = await sup("POST", "/admin/insurer-reports", valid(o));
  expect(made.status).toBe(201);
  await c.h.db.update(insurerReports).set({ createdAt: new Date("2026-09-15T08:00:00Z") }).where(eq(insurerReports.id, made.body.id));
  return made.body.id as string;
}
const deps = () => ({ db: c.h.db, storage: c.storage, mailer: c.mailer });
const runs = async (id: string) => (await c.h.db.select().from(insurerReportRuns).where(eq(insurerReportRuns.reportId, id))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const at = (iso: string) => new Date(iso);

async function car(label: string, o: { created: string; statut: string; hist?: [string, string][] }) {
  const [v] = await c.h.db.insert(vehicles).values({
    id: crypto.randomUUID(), orgId: c.orgES, stationId: HALL, clientStationId: CARRO, insurerId: allianz, statut: o.statut, statutDepuis: new Date(o.created),
    header: { land: "ES", kennzeichen: label } as never, createdAt: new Date(o.created), updatedAt: new Date(o.created),
  }).returning();
  for (const [st, when] of o.hist ?? []) await c.h.db.insert(vehicleStatusHistory).values({ vehicleId: v.id, statut: st, at: new Date(when) });
  return v.id;
}

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  HALL = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  CARRO = st.find((s) => s.type === "carrosserie").id;
  [allianz] = (await c.h.db.insert(insurers).values({ orgId: c.orgES, name: "Allianz" }).returning()).map((i) => i.id);
  chef = await inviteAndAccept(c, c.orgES, "chef@example.test", { role_id: c.roleId.chef_site, station_id: HALL });
  assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: HALL });
  bodyshopAcc = await inviteAndAccept(c, c.orgES, "taller@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
  // 2 inspected in the week of 19 Oct, one of them repaired in it; 1 older, repaired in it
  await car("A-insp", { created: "2026-10-20T09:00:00Z", statut: "besichtigung" });
  await car("B-done", { created: "2026-10-21T09:00:00Z", statut: "fertig", hist: [["fertig", "2026-10-23T10:00:00Z"]] });
  await car("C-old", { created: "2026-10-05T09:00:00Z", statut: "fertig", hist: [["fertig", "2026-10-22T10:00:00Z"]] });
});
afterAll(async () => { await c.h.close(); });

describe("the e-mail text", () => {
  it("variables: the known ones are filled in, the unknown ones are found", () => {
    expect(unknownVars("Hello {{insurer}} {{ period }} {{nonsense}} {{typo_here}}")).toEqual(["nonsense", "typo_here"]);
    expect(unknownVars("no variable")).toEqual([]);
    expect(renderTemplate("A {{x}} B {{ y }} C {{z}}", { x: "1", y: "2" })).toBe("A 1 B 2 C ");
  });
  it("period_short and the variables of a context, in the language of the report", () => {
    expect(periodShort("es", "week", { from: "2026-10-19", to: "2026-10-25" })).toBe("19/10 - 25/10");
    expect(periodShort("de", "week", { from: "2026-10-19", to: "2026-10-25" })).toBe("19.10 - 25.10");
    expect(periodShort("es", "month", { from: "2026-09-01", to: "2026-09-30" })).toBe("Septiembre de 2026");
    expect(periodShort("en", "month", { from: "2026-09-01", to: "2026-09-30" })).toBe("September 2026");
    expect(periodShort("es", "quarter", { from: "2026-07-01", to: "2026-09-30" })).toBe("T3 2026");
    expect(periodShort("de", "quarter", { from: "2026-01-01", to: "2026-03-31" })).toBe("Q1 2026");
    const v = templateVars({ lang: "fr", frequency: "week", period: { from: "2026-10-19", to: "2026-10-25" }, projectStart: "2026-09-01", insurers: ["Allianz", "Mapfre"], sender: "Ana", company: "PDR Team GmbH",
      kpis: { inspected: { period: 41, total: 1318 }, repaired: { period: 29, total: 207 }, backlog: 63, upcoming: 37, progress: 65.1 } });
    expect(v).toMatchObject({ insurer: "Allianz, Mapfre", period: "19/10/2026 - 25/10/2026", project_start: "01/09/2026", inspected_period: "41", inspected_total: "1 318", repaired_total: "207", progress: "65,1 %", sender: "Ana", company: "PDR Team GmbH" });
  });
  it("empty subject and body: the default text of each language; the text is escaped in the HTML", () => {
    for (const l of ["es", "en", "de", "fr"] as const) {
      const m = renderReportMail({ subject: "", body: "" }, l, { insurer: "Allianz", period_short: "P", inspected_period: "41" });
      expect(m.subject).toBe(DEFAULT_TEXTS[l].subject.replace("{{insurer}}", "Allianz").replace("{{period_short}}", "P"));
      expect(m.text).toContain("Allianz");
      expect(m.html).toContain("<p");
    }
    const m = renderReportMail({ subject: "S {{insurer}}", body: "Hi {{insurer}}\nline two\n\n\n\nnext <b>paragraph</b> & more" }, "en", { insurer: "A<script>x</script>&Co" });
    expect(m.subject).toBe("S A<script>x</script>&Co");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("A&lt;script&gt;x&lt;/script&gt;&amp;Co");
    expect(m.html).toContain("line two");
    expect(m.html).toContain("&lt;b&gt;paragraph&lt;/b&gt; &amp; more");
    expect(m.html.match(/<p /g)).toHaveLength(2);
  });
  it("a typo in a variable is refused when the report is saved", async () => {
    expect((await sup("POST", "/admin/insurer-reports", valid({ subject: "Report {{periodo}}" }))).status).toBe(400);
    expect((await sup("POST", "/admin/insurer-reports", valid({ body: "Hello {{insurer}} {{inspected_total}} {{ progress }}" }))).status).toBe(201);
  });
});

describe("send now, test, resend, history", () => {
  let id: string;
  beforeAll(async () => { id = (await sup("POST", "/admin/insurer-reports", valid({ name: "Allianz send", subject: "Week {{period_short}}: {{inspected_period}} inspected, {{repaired_period}} repaired ({{progress}})", body: "Dear {{insurer}},\n\nTotal {{inspected_total}} / {{repaired_total}}.\n\n{{sender}}" }))).body.id; });

  it("the e-mail: configured recipients, the internal copy, the PDF attached, the figures in the text, archived and in the history", async () => {
    c.mailer.sent.length = 0;
    const r = await sup("POST", `/admin/insurer-reports/${id}/send`, body);
    expect(r.status).toBe(200);
    expect(r.body.run).toMatchObject({ status: "sent", trigger: "manual", periodFrom: "2026-10-19", periodTo: "2026-10-25", recipients: ["siniestros@allianz.test", "boss@allianz.test"], hasFile: true });
    expect(c.mailer.sent).toHaveLength(1);
    const m = c.mailer.last();
    expect(m.to).toEqual(["siniestros@allianz.test"]);
    expect(m.cc).toEqual(["boss@allianz.test"]);
    expect(m.bcc).toEqual(["intern@pdr.test"]);
    expect(m.subject).toBe("Week 19/10 - 25/10: 2 inspected, 2 repaired (66,7 %)"); // 2 repaired of 3 inspected since the project start
    expect(m.text).toContain("Dear Allianz,");
    expect(m.text).toContain("Total 3 / 2.");
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments![0].filename).toBe("Informe_Allianz-send_2026-10-19_2026-10-25.pdf");
    expect(Buffer.from(m.attachments![0].content.subarray(0, 4)).toString()).toBe(PDF_HEAD);
    // archived, and the same bytes come back from the history
    const hist = (await sup("GET", `/admin/insurer-reports/${id}/runs`)).body as any[];
    expect(hist).toHaveLength(1);
    const file = await sup("GET", `/admin/insurer-reports/${id}/runs/${hist[0].id}/pdf`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.compare(Buffer.from(file.bytes), Buffer.from(m.attachments![0].content))).toBe(0);
    expect((await c.h.db.select().from(auditLog).where(eq(auditLog.action, "send"))).some((a) => a.entityId === id)).toBe(true);
  });

  it("the reply goes to the report's address, else to the contact address of the organisation", async () => {
    await sup("PUT", `/admin/insurer-reports/${id}`, { reply_to: "answers@pdr.test" });
    c.mailer.sent.length = 0;
    await sup("POST", `/admin/insurer-reports/${id}/send`, body);
    expect(c.mailer.last().replyTo).toBe("answers@pdr.test");
    await sup("PUT", `/admin/insurer-reports/${id}`, { reply_to: null });
    await c.h.db.update(organizations).set({ contactEmail: "contact-spain@pdr.test" }).where(eq(organizations.id, c.orgES));
    await sup("POST", `/admin/insurer-reports/${id}/send`, body);
    expect(c.mailer.last().replyTo).toBe("contact-spain@pdr.test");
    await c.h.db.update(organizations).set({ contactEmail: null }).where(eq(organizations.id, c.orgES));
    // nothing set anywhere: a send by a person keeps his own address, so that the answers do not go to the no-reply sender
    await sup("POST", `/admin/insurer-reports/${id}/send`, body);
    expect(c.mailer.last().replyTo).toBe("nicolas@example.test");
  });

  it("the last complete period by default; a bad period is refused; a report without recipient cannot be sent", async () => {
    c.mailer.sent.length = 0;
    const r = await sup("POST", `/admin/insurer-reports/${id}/send`, {});
    expect(r.body.run.status).toBe("sent");
    expect(r.body.run.periodTo >= "2026-01-01" && r.body.run.periodFrom < r.body.run.periodTo).toBe(true);
    expect((await sup("POST", `/admin/insurer-reports/${id}/send`, { from: "2026-10-25", to: "2026-10-19" })).status).toBe(400);
    const draft = (await sup("POST", "/admin/insurer-reports", valid({ name: "Draft", active: false, to_emails: [] }))).body.id;
    expect((await sup("POST", `/admin/insurer-reports/${draft}/send`, body)).status).toBe(400);
  });

  it("test: only to the person who asks, no copies, [TEST] in the subject", async () => {
    c.mailer.sent.length = 0;
    const r = await as(chef, "POST", `/admin/insurer-reports/${id}/test`, body);
    expect(r.status).toBe(200);
    expect(r.body.run).toMatchObject({ status: "sent", trigger: "test", recipients: ["chef@example.test"] });
    const m = c.mailer.last();
    expect(m.to).toEqual(["chef@example.test"]);
    expect(m.cc).toBeUndefined();
    expect(m.bcc).toBeUndefined();
    expect(m.subject.startsWith("[TEST] ")).toBe(true);
    expect(m.attachments).toHaveLength(1);
    expect(c.mailer.sent.flatMap((x) => [x.to, x.cc, x.bcc].flat()).filter(Boolean)).toEqual(["chef@example.test"]);
  });

  it("resend: the same archived PDF to the configured recipients, a new line of the history; a test cannot be resent", async () => {
    const hist = (await sup("GET", `/admin/insurer-reports/${id}/runs`)).body as any[];
    const original = hist.find((h) => h.trigger === "manual" && h.status === "sent");
    const orig = await sup("GET", `/admin/insurer-reports/${id}/runs/${original.id}/pdf`);
    c.mailer.sent.length = 0;
    const r = await as(chef, "POST", `/admin/insurer-reports/${id}/runs/${original.id}/resend`);
    expect(r.status).toBe(200);
    expect(r.body.run).toMatchObject({ status: "sent", trigger: "manual", periodFrom: original.periodFrom, periodTo: original.periodTo });
    expect(r.body.run.id).not.toBe(original.id);
    expect(Buffer.compare(Buffer.from(c.mailer.last().attachments![0].content), Buffer.from(orig.bytes))).toBe(0);
    expect(c.mailer.last().to).toEqual(["siniestros@allianz.test"]);
    const test = hist.find((h) => h.trigger === "test");
    expect((await sup("POST", `/admin/insurer-reports/${id}/runs/${test.id}/resend`)).status).toBe(400);
    expect((await sup("POST", `/admin/insurer-reports/${id}/runs/00000000-0000-4000-8000-000000000000/resend`)).status).toBe(404);
  });

  it("a mail that cannot be sent is a failed line of the history with the reason, not a crash", async () => {
    c.mailer.fail = new Error("provider down");
    const r = await sup("POST", `/admin/insurer-reports/${id}/send`, body);
    c.mailer.fail = null;
    expect(r.status).toBe(200);
    expect(r.body.run).toMatchObject({ status: "failed", error: "provider down" });
    expect((await c.h.db.select().from(auditLog).where(eq(auditLog.action, "send_failed"))).length).toBeGreaterThan(0);
  });

  it("the history and the rights: who sees what, who sends", async () => {
    for (const token of [assessor, tech, bodyshopAcc]) {
      for (const [m, p] of [["GET", `/runs`], ["GET", `/mail-preview`], ["GET", `/next-sends`], ["POST", `/send`], ["POST", `/test`]] as const) expect((await as(token, m, `/admin/insurer-reports/${id}${p}`, m === "POST" ? body : undefined)).status, `${m} ${p}`).toBe(403);
    }
    const hist = (await sup("GET", `/admin/insurer-reports/${id}/runs`)).body as any[];
    expect((await as(chef, "GET", `/admin/insurer-reports/${id}/runs`)).status).toBe(200);
    expect((await as(assessor, "GET", `/admin/insurer-reports/${id}/runs/${hist[0].id}/pdf`)).status).toBe(403);
    expect(hist.map((h) => h.trigger)).toEqual(expect.arrayContaining(["manual", "test"]));
    expect(hist.every((h) => !("bcc" in h))).toBe(true);
    // the internal copy is not on the history, and the e-mail preview shows it only to who sets the reports up
    const mine = (await sup("GET", `/admin/insurer-reports/${id}/mail-preview${Q}`)).body;
    expect(mine.bcc).toEqual(["intern@pdr.test"]);
    const theirs = (await as(chef, "GET", `/admin/insurer-reports/${id}/mail-preview${Q}`)).body;
    expect(theirs.bcc).toEqual([]);
    expect(theirs).toMatchObject({ to: ["siniestros@allianz.test"], cc: ["boss@allianz.test"], filename: "Informe_Allianz-send_2026-10-19_2026-10-25.pdf" });
    expect(theirs.subject).toContain("inspected");
    expect(theirs.html).toContain("<p");
  });
});

describe("the copies are never sent outside MAIL_MODE=live", () => {
  const mail = { to: "siniestros@allianz.test", cc: ["boss@allianz.test"], bcc: ["intern@pdr.test"], subject: "Report", text: "Hello", attachments: [{ filename: "r.pdf", content: new Uint8Array([1]), contentType: "application/pdf" }] };
  it("redirect: one address, the copies listed in the subject and at the top, not sent; off: nothing; live: unchanged", async () => {
    const inner = new MemoryMailer();
    await new ModeMailer(inner, "redirect", "nicolas@pdr.test").send(mail);
    const m = inner.last();
    expect(m.to).toBe("nicolas@pdr.test");
    expect(m.cc).toBeUndefined();
    expect(m.bcc).toBeUndefined();
    expect(m.subject).toBe("[STAGING → siniestros@allianz.test · Cc: boss@allianz.test · Bcc: intern@pdr.test] Report");
    expect(m.text).toContain("Cc: boss@allianz.test");
    expect(m.text).toContain("Bcc: intern@pdr.test");
    expect(m.attachments).toHaveLength(1);
    const off = new MemoryMailer();
    await new ModeMailer(off, "off", null).send(mail);
    expect(off.sent).toHaveLength(0);
    const live = new MemoryMailer();
    await new ModeMailer(live, "live", null).send(mail);
    expect(live.last()).toMatchObject({ to: "siniestros@allianz.test", cc: ["boss@allianz.test"], bcc: ["intern@pdr.test"] });
  });
});

describe("Resend carries the copies", () => {
  it("cc and bcc in the request, only when there are some", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200 }; });
    try {
      const r = new ResendMailer("key", "PDR <noreply@pdr.test>");
      await r.send({ to: "a@x.test", cc: ["b@x.test"], bcc: ["c@x.test"], subject: "S", text: "T" });
      await r.send({ to: "a@x.test", cc: [], subject: "S", text: "T" });
    } finally { vi.unstubAllGlobals(); }
    expect(bodies[0]).toMatchObject({ to: ["a@x.test"], cc: ["b@x.test"], bcc: ["c@x.test"] });
    expect(bodies[1]).not.toHaveProperty("cc");
    expect(bodies[1]).not.toHaveProperty("bcc");
  });
});

describe("planning", () => {
  it("the day a report goes out, the clock of its time zone, the next periods", () => {
    expect(scheduledDay({ from: "2026-10-19", to: "2026-10-25" }, 1)).toBe("2026-10-26"); // Monday
    expect(scheduledDay({ from: "2026-10-19", to: "2026-10-25" }, 3)).toBe("2026-10-28");
    expect(scheduledDay({ from: "2026-09-01", to: "2026-09-30" }, 3)).toBe("2026-10-03");
    expect(localTime(at("2026-10-26T15:05:00Z"), "Europe/Madrid")).toBe("16:05"); // winter time since 25 October
    expect(localTime(at("2026-10-01T15:05:00Z"), "Europe/Madrid")).toBe("17:05"); // summer time
    expect(localTime(at("2026-10-25T23:00:00Z"), "Europe/Madrid")).toBe("00:00");
    expect(nextPeriod("week", { from: "2026-10-19", to: "2026-10-25" })).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(nextPeriod("month", { from: "2026-11-01", to: "2026-11-30" })).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(nextPeriod("month", { from: "2026-12-01", to: "2026-12-31" })).toEqual({ from: "2027-01-01", to: "2027-01-31" });
    expect(nextPeriod("month", { from: "2027-01-01", to: "2027-01-31" })).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(nextPeriod("quarter", { from: "2026-07-01", to: "2026-09-30" })).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(nextPeriod("quarter", { from: "2026-10-01", to: "2026-12-31" })).toEqual({ from: "2027-01-01", to: "2027-03-31" });
  });
  it("the next sends: from today on; one of today whose window has not begun still counts", () => {
    const rep = { frequency: "week", sendDay: 1, timezone: "Europe/Madrid", windowFrom: "16:00" };
    expect(nextSends(rep, at("2026-10-28T10:00:00Z"), 3).map((x) => x.on)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(nextSends(rep, at("2026-10-26T08:00:00Z"), 2).map((x) => x.on)).toEqual(["2026-10-26", "2026-11-02"]); // Monday morning: today's still to come
    expect(nextSends(rep, at("2026-10-26T15:30:00Z"), 2).map((x) => x.on)).toEqual(["2026-11-02", "2026-11-09"]); // after 16:00 it has gone
    expect(nextSends(rep, at("2026-10-28T10:00:00Z"), 1)[0].period).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(nextSends({ ...rep, frequency: "month", sendDay: 3 }, at("2026-10-28T10:00:00Z"), 2).map((x) => [x.on, x.period.from])).toEqual([["2026-11-03", "2026-10-01"], ["2026-12-03", "2026-11-01"]]);
    expect(nextSends({ ...rep, frequency: "quarter", sendDay: 1 }, at("2026-10-28T10:00:00Z"), 2).map((x) => x.on)).toEqual(["2027-01-01", "2027-04-01"]);
  });
  it("the planning route", async () => {
    const id = (await sup("POST", "/admin/insurer-reports", valid({ name: "Planning" }))).body.id;
    const n = (await sup("GET", `/admin/insurer-reports/${id}/next-sends`)).body as any[];
    expect(n).toHaveLength(4);
    expect(n.every((x) => x.on > "2026-01-01" && x.period.from < x.period.to)).toBe(true);
    expect(n.map((x) => x.on)).toEqual([...n.map((x) => x.on)].sort());
    // the list shows the first of them; an inactive report has none
    const list = (await sup("GET", "/admin/insurer-reports")).body as any[];
    expect(list.find((x) => x.id === id).nextSend).toEqual(n[0]);
    await sup("PUT", `/admin/insurer-reports/${id}`, { active: false });
    expect(((await sup("GET", "/admin/insurer-reports")).body as any[]).find((x) => x.id === id).nextSend).toBeNull();
  });
});

describe("the automatic send", () => {
  // the reports of the tests above are not part of this: only the ones made here are active
  beforeAll(async () => { await c.h.db.update(insurerReports).set({ active: false, deletedAt: new Date() }); });

  it("not before the window, then once per report and period, whatever the number of ticks and servers", async () => {
    const id = await oldReport({ name: "Auto weekly" });
    c.mailer.sent.length = 0;
    expect(await runDueInsurerReports(deps(), at("2026-10-26T12:59:00Z"))).toEqual({ sent: 0, failed: 0 }); // 13:59 in Madrid
    expect(c.mailer.sent).toHaveLength(0);
    expect(await runDueInsurerReports(deps(), at("2026-10-26T15:00:00Z"))).toEqual({ sent: 1, failed: 0 }); // 16:00
    expect(c.mailer.sent).toHaveLength(1);
    expect(c.mailer.last().subject).toContain("19/10 - 25/10");
    const [run] = await runs(id);
    expect(run).toMatchObject({ trigger: "auto", status: "sent", periodFrom: "2026-10-19", periodTo: "2026-10-25", attempts: 1, sentBy: null });
    expect(run.recipients).toEqual(["siniestros@allianz.test", "boss@allianz.test"]);
    expect((run.kpis as any).inspected).toEqual({ period: 2, total: 3 });
    expect(await c.storage.get(run.fileKey!)).not.toBeNull();
    for (const t of ["2026-10-26T15:01:00Z", "2026-10-26T15:30:00Z", "2026-10-26T16:30:00Z", "2026-10-27T10:00:00Z"]) expect((await runDueInsurerReports(deps(), at(t))).sent).toBe(0);
    expect(c.mailer.sent).toHaveLength(1);
    expect(await runs(id)).toHaveLength(1);
    // two servers at the same minute: one send
    const id2 = await oldReport({ name: "Auto twin" });
    c.mailer.sent.length = 0;
    const both = await Promise.all([runDueInsurerReports(deps(), at("2026-10-26T15:10:00Z")), runDueInsurerReports(deps(), at("2026-10-26T15:10:00Z"))]);
    expect(both.reduce((n, x) => n + x.sent, 0)).toBe(1);
    expect(c.mailer.sent.filter((m) => m.subject.includes("19/10")).length).toBe(1);
    expect(await runs(id2)).toHaveLength(1);
    await sup("DELETE", `/admin/insurer-reports/${id}`); await sup("DELETE", `/admin/insurer-reports/${id2}`);
  });

  it("the send day (weekday): the Wednesday report waits on Monday and goes out on Wednesday", async () => {
    const wed = await oldReport({ name: "Wed", send_day: 3 });
    c.mailer.sent.length = 0;
    await runDueInsurerReports(deps(), at("2026-10-26T15:30:00Z")); // Monday
    expect(await runs(wed)).toHaveLength(0);
    await runDueInsurerReports(deps(), at("2026-10-28T15:05:00Z")); // Wednesday 16:05
    expect((await runs(wed)).map((r) => [r.status, r.periodFrom, r.periodTo])).toEqual([["sent", "2026-10-19", "2026-10-25"]]);
    await sup("DELETE", `/admin/insurer-reports/${wed}`);
  });
  it("the monthly report on the 3rd (last month), the quarterly one on the 1st (last quarter, summer time)", async () => {
    const month = await oldReport({ name: "Monthly", frequency: "month", send_day: 3 });
    await runDueInsurerReports(deps(), at("2026-11-02T15:20:00Z")); // the 2nd: not yet
    expect(await runs(month)).toHaveLength(0);
    await runDueInsurerReports(deps(), at("2026-11-03T15:20:00Z")); // 3 November, 16:20
    expect((await runs(month)).map((r) => [r.status, r.periodFrom, r.periodTo])).toEqual([["sent", "2026-10-01", "2026-10-31"]]);
    await sup("DELETE", `/admin/insurer-reports/${month}`);
    const quarter = await oldReport({ name: "Quarterly", frequency: "quarter", send_day: 1 });
    await runDueInsurerReports(deps(), at("2026-10-01T13:50:00Z")); // 15:50 on the 1st
    expect(await runs(quarter)).toHaveLength(0);
    await runDueInsurerReports(deps(), at("2026-10-01T15:20:00Z")); // 17:20 on the 1st (summer time)
    expect((await runs(quarter)).map((r) => [r.status, r.periodFrom, r.periodTo])).toEqual([["sent", "2026-07-01", "2026-09-30"]]);
    await sup("DELETE", `/admin/insurer-reports/${quarter}`);
  });

  it("the server was down: still sent on the next two days, not after; a report created after its window opened waits; inactive, deleted, without recipient: nothing", async () => {
    const late = await oldReport({ name: "Late" });
    const fresh = await sup("POST", "/admin/insurer-reports", valid({ name: "Fresh" })); // created now (real clock): after any window of the test days
    const sameDay = await oldReport({ name: "Same day" });
    await c.h.db.update(insurerReports).set({ createdAt: at("2026-10-26T15:30:00Z") }).where(eq(insurerReports.id, sameDay)); // created on Monday after 16:00
    const off = await oldReport({ name: "Off" }); await sup("PUT", `/admin/insurer-reports/${off}`, { active: false });
    const gone = await oldReport({ name: "Gone" }); await sup("DELETE", `/admin/insurer-reports/${gone}`);
    const noTo = await oldReport({ name: "No to", active: false, to_emails: [] });
    c.mailer.sent.length = 0;
    await runDueInsurerReports(deps(), at("2026-10-28T09:00:00Z")); // Wednesday morning: day 2 after Monday
    expect((await runs(late)).map((r) => r.status)).toEqual(["sent"]);
    expect((await runs(sameDay)).length).toBe(0);
    expect((await runs(fresh.body.id)).length).toBe(0);
    for (const id of [off, gone, noTo]) expect((await runs(id)).length).toBe(0);
    const tooLate = await oldReport({ name: "Too late" });
    c.mailer.sent.length = 0;
    await runDueInsurerReports(deps(), at("2026-10-29T10:00:00Z")); // Thursday: day 3, too late for the period of 19-25 October
    expect(c.mailer.sent).toHaveLength(0);
    expect((await runs(tooLate)).length).toBe(0);
    for (const id of [late, tooLate, fresh.body.id, sameDay]) await sup("DELETE", `/admin/insurer-reports/${id}`);
  });

  it("a failed send is tried again: 3 times, 30 minutes apart; then it stays failed and 'send now' is the way", async () => {
    const id = await oldReport({ name: "Retry" });
    c.mailer.sent.length = 0;
    c.mailer.fail = new Error("provider down");
    expect(await runDueInsurerReports(deps(), at("2026-10-26T15:00:00Z"))).toEqual({ sent: 0, failed: 1 });
    expect((await runs(id))[0]).toMatchObject({ status: "failed", attempts: 1, error: "provider down" });
    expect((await runDueInsurerReports(deps(), at("2026-10-26T15:10:00Z"))).failed).toBe(0); // too soon
    expect(await runDueInsurerReports(deps(), at("2026-10-26T15:31:00Z"))).toEqual({ sent: 0, failed: 1 });
    expect((await runs(id))[0]).toMatchObject({ status: "failed", attempts: 2 });
    c.mailer.fail = null;
    expect(await runDueInsurerReports(deps(), at("2026-10-26T16:02:00Z"))).toEqual({ sent: 1, failed: 0 });
    expect((await runs(id))[0]).toMatchObject({ status: "sent", attempts: 3, error: null });
    expect(await runs(id)).toHaveLength(1); // one line for the period
    expect(c.mailer.sent).toHaveLength(1);
    // the limit
    const id2 = await oldReport({ name: "Retry limit" });
    c.mailer.fail = new Error("still down");
    for (const t of ["2026-10-26T15:00:00Z", "2026-10-26T15:31:00Z", "2026-10-26T16:02:00Z", "2026-10-26T16:40:00Z", "2026-10-26T18:00:00Z"]) await runDueInsurerReports(deps(), at(t));
    expect((await runs(id2))[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    c.mailer.fail = null;
    c.mailer.sent.length = 0;
    expect((await runDueInsurerReports(deps(), at("2026-10-26T20:00:00Z"))).sent).toBe(0);
    const now = await sup("POST", `/admin/insurer-reports/${id2}/send`, body);
    expect(now.body.run.status).toBe("sent");
    for (const x of [id, id2]) await sup("DELETE", `/admin/insurer-reports/${x}`);
  });

  it("a send interrupted in the middle is not sent again by itself (it may have gone out)", async () => {
    const id = await oldReport({ name: "Interrupted" });
    await c.h.db.insert(insurerReportRuns).values({ reportId: id, orgId: c.orgES, periodFrom: "2026-10-19", periodTo: "2026-10-25", trigger: "auto", status: "pending", attempts: 1, lastAttemptAt: at("2026-10-26T15:00:00Z") });
    c.mailer.sent.length = 0;
    expect((await runDueInsurerReports(deps(), at("2026-10-26T15:05:00Z"))).sent).toBe(0); // still being sent, perhaps
    await runDueInsurerReports(deps(), at("2026-10-26T15:30:00Z"));
    expect((await runs(id))[0]).toMatchObject({ status: "failed", error: "interrupted", attempts: MAX_ATTEMPTS });
    await runDueInsurerReports(deps(), at("2026-10-26T17:00:00Z"));
    expect(c.mailer.sent).toHaveLength(0);
    await sup("DELETE", `/admin/insurer-reports/${id}`);
  });

  it("a manual send does not use up the automatic one of the period", async () => {
    const id = await oldReport({ name: "Manual then auto" });
    await sup("POST", `/admin/insurer-reports/${id}/send`, body);
    c.mailer.sent.length = 0;
    expect((await runDueInsurerReports(deps(), at("2026-10-26T15:30:00Z"))).sent).toBe(1);
    expect((await runs(id)).map((r) => r.trigger)).toEqual(["manual", "auto"]);
    await sup("DELETE", `/admin/insurer-reports/${id}`);
  });
});

describe("the migration", () => {
  it("the attempts columns exist and the unique index keeps one automatic run per report and period", async () => {
    const id = await oldReport({ name: "Unique" });
    const row = { reportId: id, orgId: c.orgES, periodFrom: "2026-10-19", periodTo: "2026-10-25", status: "sent" };
    await c.h.db.insert(insurerReportRuns).values({ ...row, trigger: "auto" });
    await expect(c.h.db.insert(insurerReportRuns).values({ ...row, trigger: "auto" })).rejects.toThrow();
    await c.h.db.insert(insurerReportRuns).values({ ...row, trigger: "manual" });
    await c.h.db.insert(insurerReportRuns).values({ ...row, trigger: "manual" });
    expect((await c.h.db.execute(sql`select count(*)::int as n from insurer_report_runs where report_id = ${id}`) as unknown as { rows: { n: number }[] }).rows[0].n).toBe(3);
    await sup("DELETE", `/admin/insurer-reports/${id}`);
  });
});
