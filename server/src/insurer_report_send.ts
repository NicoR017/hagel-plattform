// V6, automatic insurer reports: sending. Manual ("send now"), test (to the person only), resend of an archived PDF, and the automatic send of the
// scheduled day. Every send is a row of the history with its PDF archived; the automatic one is claimed in the database first (one per report and
// period, whatever the number of servers or restarts).
import { and, eq, isNull } from "drizzle-orm";
import { insurerReportFileName, type InsurerReportLang } from "@hagel/documents";
import { audit } from "./audit";
import { HttpError } from "./auth";
import { addDays, localDay } from "./colibri_rules";
import type { Db } from "./db";
import type { Mailer } from "./email";
import { buildInsurerReportData, buildInsurerReportPdf } from "./insurer_report_pdf";
import { renderReportMail, templateVars, type RenderedMail } from "./insurer_report_text";
import { lastCompletePeriod, nextPeriod, type Period, type ReportFrequency } from "./insurer_reports";
import { defaultLetterhead, letterheadOfCompany } from "./repair_report";
import { replyToInfo } from "./reply_to";
import { insurerReportRuns, insurerReports, users } from "./schema";
import type { Storage } from "./storage";

export interface SendDeps { db: Db; storage: Storage; mailer: Mailer }
export type ReportRow = typeof insurerReports.$inferSelect;
export type RunRow = typeof insurerReportRuns.$inferSelect;

/** an automatic send is tried at most this often, this many minutes apart; a send that stays "pending" this long was interrupted (and is not retried: it may have gone out) */
export const MAX_ATTEMPTS = 3, RETRY_AFTER_MIN = 30, STALE_PENDING_MIN = 15;
/** the day it is due, and this many days after it when the server was down: then it is still sent */
export const CATCH_UP_DAYS = 2;

/** HH:MM on the clock of a time zone */
export const localTime = (d: Date, tz: string): string => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
/** the day the report of `period` goes out: send day 1 = the first day after the period (Monday for a week, the 1st for a month or quarter) */
export const scheduledDay = (period: Period, sendDay: number): string => addDays(addDays(period.to, 1), sendDay - 1);

const lang = (r: ReportRow): InsurerReportLang => (["es", "en", "de", "fr"].includes(r.language) ? r.language : "es") as InsurerReportLang;
const minutesSince = (d: Date | null, now: Date) => (d ? (now.getTime() - d.getTime()) / 60_000 : Infinity);

/** the e-mail of a report for a period, with the figures of that day (the preview and the send use the same function) */
export async function reportMailFor(deps: Pick<SendDeps, "db" | "storage">, report: ReportRow, period: Period, o: { sender: string; now?: Date }): Promise<RenderedMail & { to: string[]; cc: string[]; bcc: string[]; company: string; filename: string }> {
  const { data, kpis } = await buildInsurerReportData(deps.db, report, period, { now: o.now, amounts: true });
  const company = (await letterheadOfCompany(deps.db, deps.storage, report.orgId, report.companyId))?.name ?? (await defaultLetterhead())?.name ?? "PDR Team GmbH";
  const mail = renderReportMail(report, lang(report), templateVars({
    lang: lang(report), frequency: report.frequency as ReportFrequency, period, projectStart: report.projectStart, insurers: data.insurers, kpis, sender: o.sender, company,
  }));
  const to = report.toEmails, cc = report.ccEmails.filter((a) => !to.includes(a)), bcc = report.bccEmails.filter((a) => !to.includes(a) && !cc.includes(a));
  return { ...mail, to, cc, bcc, company, filename: insurerReportFileName({ name: report.name, period }, lang(report)) };
}

/**
 * Where the insurer's answers go: the address set on the report, else the contact address of the organisation (the report is the company's, not the
 * person's who pressed "send"), else for a send by a person his own address; an automatic send without any of them has no Reply-To.
 */
export async function reportReplyTo(db: Db, report: ReportRow, userId: string | null): Promise<string | undefined> {
  if (report.replyTo) return report.replyTo;
  const contact = (await replyToInfo(db, null, report.orgId)).address;
  if (contact) return contact;
  return userId ? (await replyToInfo(db, userId, report.orgId)).address : undefined;
}

const fileKeyOf = (r: ReportRow, runId: string) => `insurer-reports/${r.orgId}/${r.id}/${runId}.pdf`;

/**
 * Builds (or takes the archived) PDF, e-mails it and records the result on the run. Never throws: a failure is the status of the run.
 * `test`: only to `testTo`, no copies, "[TEST]" in the subject.
 */
async function deliver(deps: SendDeps, report: ReportRow, run: RunRow, o: { userId: string | null; sender: string; now: Date; testTo?: string; archived?: Uint8Array }): Promise<RunRow> {
  const { db, storage, mailer } = deps;
  const period = { from: run.periodFrom, to: run.periodTo };
  try {
    let bytes = o.archived, filename = insurerReportFileName({ name: report.name, period }, lang(report));
    let kpisSnapshot: unknown = run.kpis;
    if (!bytes) {
      const built = await buildInsurerReportPdf({ db, storage }, report, period, { now: o.now, amounts: true });
      bytes = built.bytes; filename = built.filename;
      const k = built.kpis;
      kpisSnapshot = { period: k.period, asOf: k.asOf, inspected: k.inspected, repaired: k.repaired, refused: k.refused, backlog: k.backlog, upcoming: k.upcoming, progress: k.progress };
      await storage.put(fileKeyOf(report, run.id), bytes, "application/pdf");
    }
    const fileKey = o.archived ? run.fileKey : fileKeyOf(report, run.id);
    const mail = await reportMailFor(deps, report, period, { sender: o.sender, now: o.now });
    const test = !!o.testTo;
    const to = test ? [o.testTo!] : mail.to, cc = test ? [] : mail.cc, bcc = test ? [] : mail.bcc;
    if (!to.length) throw new Error("no recipients");
    const replyTo = await reportReplyTo(db, report, o.userId);
    await mailer.send({
      to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined, replyTo,
      subject: test ? `[TEST] ${mail.subject}` : mail.subject, text: mail.text, html: mail.html,
      attachments: [{ filename, content: bytes, contentType: "application/pdf" }],
    });
    const [done] = await db.update(insurerReportRuns).set({ status: "sent", sentAt: new Date(), recipients: [...to, ...cc], fileKey, kpis: kpisSnapshot as never, error: null }).where(eq(insurerReportRuns.id, run.id)).returning();
    await audit(db, { orgId: report.orgId, userId: o.userId, action: test ? "send_test" : "send", entity: "insurer_report", entityId: report.id, after: { run: run.id, trigger: run.trigger, period, to, cc, bcc } });
    return done;
  } catch (e) {
    const [failed] = await db.update(insurerReportRuns).set({ status: "failed", error: String((e as Error)?.message ?? e).slice(0, 500) }).where(eq(insurerReportRuns.id, run.id)).returning();
    await audit(db, { orgId: report.orgId, userId: o.userId, action: "send_failed", entity: "insurer_report", entityId: report.id, after: { run: run.id, trigger: run.trigger, period, error: failed.error } });
    return failed;
  }
}

async function nameOf(db: Db, userId: string): Promise<string> {
  const [u] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  return u?.name || u?.email || "PDR Team";
}

async function startRun(db: Db, report: ReportRow, period: Period, trigger: "manual" | "test", userId: string): Promise<RunRow> {
  const [run] = await db.insert(insurerReportRuns).values({ reportId: report.id, orgId: report.orgId, periodFrom: period.from, periodTo: period.to, trigger, status: "pending", sentBy: userId, attempts: 1, lastAttemptAt: new Date() }).returning();
  return run;
}

/** "Send now": the configured recipients (and the internal copy), the last complete period unless one is given */
export async function sendInsurerReportNow(deps: SendDeps, report: ReportRow, period: Period, userId: string, now = new Date()): Promise<RunRow> {
  if (!report.toEmails.length) throw new HttpError(400, "invalid_input");
  const run = await startRun(deps.db, report, period, "manual", userId);
  return deliver(deps, report, run, { userId, sender: await nameOf(deps.db, userId), now });
}

/** "Test": the e-mail and the PDF to the person who asks, nobody else */
export async function sendInsurerReportTest(deps: SendDeps, report: ReportRow, period: Period, userId: string, email: string, now = new Date()): Promise<RunRow> {
  const run = await startRun(deps.db, report, period, "test", userId);
  return deliver(deps, report, run, { userId, sender: await nameOf(deps.db, userId), now, testTo: email });
}

/** "Resend": the same archived PDF to the configured recipients (a new line in the history) */
export async function resendInsurerReport(deps: SendDeps, report: ReportRow, from: RunRow, userId: string, now = new Date()): Promise<RunRow> {
  if (!report.toEmails.length || !from.fileKey) throw new HttpError(400, "invalid_input");
  const file = await deps.storage.get(from.fileKey);
  if (!file) throw new HttpError(404, "invalid_input");
  const [run] = await deps.db.insert(insurerReportRuns).values({ reportId: report.id, orgId: report.orgId, periodFrom: from.periodFrom, periodTo: from.periodTo, trigger: "manual", status: "pending", sentBy: userId, attempts: 1, lastAttemptAt: new Date(), fileKey: from.fileKey, kpis: from.kpis as never }).returning();
  return deliver(deps, report, run, { userId, sender: await nameOf(deps.db, userId), now, archived: file.bytes });
}

/**
 * The automatic send, called every minute. A report is due on its scheduled day from the start of its window (and, if the server was down, until
 * CATCH_UP_DAYS later). One automatic send per report and period: the row is claimed first (unique index), so a second server or a restart does
 * nothing. A failed send is tried again (3 times, 30 minutes apart). A report created after its window opened on that day waits for the next period.
 */
export async function runDueInsurerReports(deps: SendDeps, now = new Date()): Promise<{ sent: number; failed: number }> {
  const { db } = deps;
  const out = { sent: 0, failed: 0 };
  const reports = await db.select().from(insurerReports).where(and(eq(insurerReports.active, true), isNull(insurerReports.deletedAt)));
  for (const report of reports) {
    if (!report.toEmails.length) continue;
    const tz = report.timezone;
    const today = localDay(now, tz), time = localTime(now, tz);
    const period = lastCompletePeriod(report.frequency as ReportFrequency, today);
    const day = scheduledDay(period, report.sendDay);
    if (today < day || today > addDays(day, CATCH_UP_DAYS)) continue;
    if (today === day && time < report.windowFrom) continue;
    const made = localDay(report.createdAt, tz);
    if (made > day || (made === day && localTime(report.createdAt, tz) >= report.windowFrom)) continue;

    const [existing] = await db.select().from(insurerReportRuns).where(and(eq(insurerReportRuns.reportId, report.id), eq(insurerReportRuns.periodFrom, period.from), eq(insurerReportRuns.periodTo, period.to), eq(insurerReportRuns.trigger, "auto")));
    let run: RunRow | undefined;
    if (!existing) {
      [run] = await db.insert(insurerReportRuns).values({ reportId: report.id, orgId: report.orgId, periodFrom: period.from, periodTo: period.to, trigger: "auto", status: "pending", attempts: 1, lastAttemptAt: now }).onConflictDoNothing().returning();
    } else if (existing.status === "failed" && existing.attempts < MAX_ATTEMPTS && minutesSince(existing.lastAttemptAt, now) >= RETRY_AFTER_MIN) {
      // claimed atomically: only the one that finds it still failed retries
      [run] = await db.update(insurerReportRuns).set({ status: "pending", attempts: existing.attempts + 1, lastAttemptAt: now }).where(and(eq(insurerReportRuns.id, existing.id), eq(insurerReportRuns.status, "failed"), eq(insurerReportRuns.attempts, existing.attempts))).returning();
    } else if (existing.status === "pending" && minutesSince(existing.lastAttemptAt, now) > STALE_PENDING_MIN) {
      await db.update(insurerReportRuns).set({ status: "failed", error: "interrupted", attempts: MAX_ATTEMPTS }).where(and(eq(insurerReportRuns.id, existing.id), eq(insurerReportRuns.status, "pending")));
    }
    if (!run) continue;
    const done = await deliver(deps, report, run, { userId: null, sender: (await letterheadOfCompany(db, deps.storage, report.orgId, report.companyId))?.name ?? "PDR Team", now });
    if (done.status === "sent") out.sent++; else out.failed++;
  }
  return out;
}

/** the next sends of a report (for the planning screen): the scheduled days from today on */
export function nextSends(report: Pick<ReportRow, "frequency" | "sendDay" | "timezone" | "windowFrom">, now: Date, n = 4): { period: Period; on: string }[] {
  const tz = report.timezone, today = localDay(now, tz), time = localTime(now, tz);
  let period = lastCompletePeriod(report.frequency as ReportFrequency, today);
  const out: { period: Period; on: string }[] = [];
  while (out.length < n) {
    const on = scheduledDay(period, report.sendDay);
    // a send of today whose window has not started yet is still to come; the one of an earlier day belongs to the past
    if (on > today || (on === today && time < report.windowFrom)) out.push({ period, on });
    period = nextPeriod(report.frequency as ReportFrequency, period);
  }
  return out;
}

