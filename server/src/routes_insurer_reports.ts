// V6, automatic insurer reports: set-up and figures (the sending comes with the next phase).
// Rights, all checked here: rapports.voir (list, figures), rapports.gerer (create, change, delete). rapports.envoyer is for the sending.
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { LANGS, emailSchema, isPlaceType } from "@hagel/shared";
import { audit } from "./audit";
import { HttpError } from "./auth";
import { isIsoDate, localDay } from "./colibri_rules";
import type { Db } from "./db";
import type { Env } from "./env";
import { DEFAULT_INSURER_KPIS, INSURER_KPIS, REPORT_FREQUENCIES, computeInsurerKpis, isValidTimeZone, lastCompletePeriod, type ReportFrequency } from "./insurer_reports";
import { hasOrgPermission } from "./permissions";
import { buildInsurerReportPdf } from "./insurer_report_pdf";
import { companies, insurerReportRuns, insurerReports, insurers, stations } from "./schema";
import type { Storage } from "./storage";

interface Deps {
  db: Db; storage: Storage;
  needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env>;
  validationHook: (r: { success: boolean }, c: Context) => Response | undefined;
}

const uuid = z.string().uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const unique = <T>(xs: T[]) => [...new Set(xs)];

export const reportInput = z.object({
  name: z.string().trim().min(1).max(120),
  language: z.enum(LANGS).default("es"),
  company_id: uuid.nullable().default(null),
  active: z.boolean().default(true),
  insurer_ids: z.array(uuid).min(1).max(50).transform(unique),
  bodyshop_ids: z.array(uuid).max(200).default([]).transform(unique),
  station_ids: z.array(uuid).max(200).default([]).transform(unique),
  countries: z.array(z.enum(["ES", "DE"])).max(2).default([]).transform(unique),
  project_start: z.string().refine(isIsoDate).nullable().default(null),
  frequency: z.enum(REPORT_FREQUENCIES).default("week"),
  send_day: z.number().int().min(1).max(28).default(1),
  window_from: hhmm.default("16:00"),
  window_to: hhmm.default("17:00"),
  timezone: z.string().trim().refine(isValidTimeZone, "invalid time zone").default("Europe/Madrid"),
  to_emails: z.array(emailSchema).max(30).default([]).transform(unique),
  cc_emails: z.array(emailSchema).max(30).default([]).transform(unique),
  bcc_emails: z.array(emailSchema).max(30).default([]).transform(unique),
  reply_to: emailSchema.nullable().default(null),
  subject: z.string().max(300).default(""),
  body: z.string().max(8000).default(""),
  kpis: z.array(z.enum(INSURER_KPIS)).max(INSURER_KPIS.length).default([...DEFAULT_INSURER_KPIS]).transform(unique),
  annex_vehicles: z.boolean().default(false),
  show_amounts: z.boolean().default(false),
}).superRefine((r, ctx) => {
  if (r.frequency === "week" && r.send_day > 7) ctx.addIssue({ code: "custom", path: ["send_day"], message: "weekday 1 (Monday) to 7 (Sunday)" });
  if (minutes(r.window_to) <= minutes(r.window_from)) ctx.addIssue({ code: "custom", path: ["window_to"], message: "the window must end after it starts" });
  if (r.active && !r.to_emails.length) ctx.addIssue({ code: "custom", path: ["to_emails"], message: "an active report needs at least one recipient" });
  if (!r.kpis.length) ctx.addIssue({ code: "custom", path: ["kpis"], message: "at least one figure" });
});
type ReportInput = z.infer<typeof reportInput>;

const toRow = (b: ReportInput) => ({
  name: b.name, language: b.language, companyId: b.company_id, active: b.active, insurerIds: b.insurer_ids, bodyshopIds: b.bodyshop_ids, stationIds: b.station_ids, countries: b.countries,
  projectStart: b.project_start, frequency: b.frequency, sendDay: b.send_day, windowFrom: b.window_from, windowTo: b.window_to, timezone: b.timezone,
  toEmails: b.to_emails, ccEmails: b.cc_emails, bccEmails: b.bcc_emails, replyTo: b.reply_to, subject: b.subject, body: b.body,
  kpis: b.kpis, annexVehicles: b.annex_vehicles, showAmounts: b.show_amounts,
});
const fromRow = (r: typeof insurerReports.$inferSelect): Record<string, unknown> => ({
  name: r.name, language: r.language, company_id: r.companyId, active: r.active, insurer_ids: r.insurerIds, bodyshop_ids: r.bodyshopIds, station_ids: r.stationIds, countries: r.countries,
  project_start: r.projectStart, frequency: r.frequency, send_day: r.sendDay, window_from: r.windowFrom, window_to: r.windowTo, timezone: r.timezone,
  to_emails: r.toEmails, cc_emails: r.ccEmails, bcc_emails: r.bccEmails, reply_to: r.replyTo, subject: r.subject, body: r.body,
  kpis: r.kpis, annex_vehicles: r.annexVehicles, show_amounts: r.showAmounts,
});

export function insurerReportRoutes({ db, storage, needAuth, needOrg, validationHook }: Deps) {
  const r = new Hono<Env>();
  const org = (c: Context<Env>) => c.get("orgId");
  const who = (c: Context<Env>) => c.get("principal").id;
  const need = (permission: "rapports.voir" | "rapports.gerer"): MiddlewareHandler<Env> => async (c, next) => {
    if (!hasOrgPermission(c.get("principal"), permission, org(c))) throw new HttpError(403, "forbidden");
    await next();
  };

  async function reportOf(c: Context<Env>) {
    const [row] = await db.select().from(insurerReports).where(and(eq(insurerReports.id, c.req.param("id") ?? ""), eq(insurerReports.orgId, org(c)), isNull(insurerReports.deletedAt)));
    if (!row) throw new HttpError(404, "invalid_input");
    return row;
  }
  /** the insurers, body shops and places of a report must belong to the organisation (and be what they say) */
  async function checkScope(orgId: string, b: ReportInput) {
    const ins = await db.select({ id: insurers.id }).from(insurers).where(and(eq(insurers.orgId, orgId), inArray(insurers.id, b.insurer_ids)));
    if (ins.length !== b.insurer_ids.length) throw new HttpError(400, "invalid_input");
    if (b.company_id) {
      const [co] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, b.company_id), eq(companies.orgId, orgId)));
      if (!co) throw new HttpError(400, "invalid_input");
    }
    const sts = [...b.bodyshop_ids, ...b.station_ids];
    if (!sts.length) return;
    const rows = await db.select({ id: stations.id, type: stations.type }).from(stations).where(and(eq(stations.orgId, orgId), inArray(stations.id, sts)));
    const type = new Map(rows.map((s) => [s.id, s.type]));
    if (b.bodyshop_ids.some((id) => type.get(id) !== "carrosserie") || b.station_ids.some((id) => !isPlaceType(type.get(id)))) throw new HttpError(400, "invalid_input");
  }
  /** the whole input again, after a partial change: the rules that look at several fields */
  const merged = (before: typeof insurerReports.$inferSelect, patch: Record<string, unknown>): ReportInput => {
    const p = reportInput.safeParse({ ...fromRow(before), ...patch });
    if (!p.success) throw new HttpError(400, "invalid_input");
    return p.data;
  };

  r.get("/admin/insurer-reports", needAuth, needOrg, need("rapports.voir"), async (c) => {
    const rows = await db.select().from(insurerReports).where(and(eq(insurerReports.orgId, org(c)), isNull(insurerReports.deletedAt))).orderBy(insurerReports.name);
    const runs = rows.length ? await db.select().from(insurerReportRuns).where(inArray(insurerReportRuns.reportId, rows.map((x) => x.id))).orderBy(desc(insurerReportRuns.createdAt)) : [];
    const names = new Map((await db.select({ id: insurers.id, name: insurers.name }).from(insurers).where(eq(insurers.orgId, org(c)))).map((i) => [i.id, i.name]));
    const mayManage = hasOrgPermission(c.get("principal"), "rapports.gerer", org(c));
    return c.json(rows.map((x) => ({
      id: x.id, ...fromRow(x), insurers: x.insurerIds.map((id) => names.get(id) ?? ""),
      // the Bcc stays internal: only who may set the reports up sees it
      ...(mayManage ? {} : { bcc_emails: [] }),
      lastRun: runs.find((u) => u.reportId === x.id) ? { status: runs.find((u) => u.reportId === x.id)!.status, periodTo: runs.find((u) => u.reportId === x.id)!.periodTo, at: runs.find((u) => u.reportId === x.id)!.createdAt } : null,
    })));
  });

  r.get("/admin/insurer-reports/:id", needAuth, needOrg, need("rapports.voir"), async (c) => {
    const x = await reportOf(c);
    const mayManage = hasOrgPermission(c.get("principal"), "rapports.gerer", org(c));
    return c.json({ id: x.id, ...fromRow(x), ...(mayManage ? {} : { bcc_emails: [] }) });
  });

  r.post("/admin/insurer-reports", needAuth, needOrg, need("rapports.gerer"), zValidator("json", reportInput, validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = org(c);
    await checkScope(orgId, b);
    const [x] = await db.insert(insurerReports).values({ orgId, createdBy: who(c), ...toRow(b) }).returning();
    await audit(db, { orgId, userId: who(c), action: "create", entity: "insurer_report", entityId: x.id, after: fromRow(x) });
    return c.json({ id: x.id, ...fromRow(x) }, 201);
  });

  r.put("/admin/insurer-reports/:id", needAuth, needOrg, need("rapports.gerer"), async (c) => {
    const before = await reportOf(c);
    const patch = await c.req.json().catch(() => null);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new HttpError(400, "invalid_input");
    const b = merged(before, patch as Record<string, unknown>);
    await checkScope(org(c), b);
    const [x] = await db.update(insurerReports).set({ ...toRow(b), updatedAt: new Date() }).where(eq(insurerReports.id, before.id)).returning();
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "insurer_report", entityId: x.id, before: fromRow(before), after: fromRow(x) });
    return c.json({ id: x.id, ...fromRow(x) });
  });

  /** soft delete: the report stops, its history of sends stays */
  r.delete("/admin/insurer-reports/:id", needAuth, needOrg, need("rapports.gerer"), async (c) => {
    const before = await reportOf(c);
    await db.update(insurerReports).set({ deletedAt: new Date(), active: false, updatedAt: new Date() }).where(eq(insurerReports.id, before.id));
    await audit(db, { orgId: org(c), userId: who(c), action: "delete", entity: "insurer_report", entityId: before.id, before: fromRow(before) });
    return c.json({ ok: true });
  });

  /** the figures of a report: `from` and `to` (local days) or, by default, the last complete period of its frequency */
  r.get("/admin/insurer-reports/:id/kpis", needAuth, needOrg, need("rapports.voir"), async (c) => {
    const x = await reportOf(c);
    const q = c.req.query();
    const today = localDay(new Date(), x.timezone);
    const period = q.from || q.to ? { from: q.from ?? "", to: q.to ?? "" } : lastCompletePeriod(x.frequency as ReportFrequency, today);
    if (!isIsoDate(period.from) || !isIsoDate(period.to) || period.from > period.to) throw new HttpError(400, "invalid_input");
    const k = await computeInsurerKpis(db, { orgId: org(c), insurerIds: x.insurerIds, bodyshopIds: x.bodyshopIds, stationIds: x.stationIds, countries: x.countries, projectStart: x.projectStart, timezone: x.timezone }, period);
    const { ids, ...figures } = k;
    return c.json(q.ids === "1" ? { ...figures, ids } : figures);
  });

  /**
   * The PDF of a report for a period (the last complete one by default), for the preview. The amounts of the annex are in it only when the report
   * shows amounts AND the person may see prices.
   */
  r.get("/admin/insurer-reports/:id/pdf", needAuth, needOrg, need("rapports.voir"), async (c) => {
    const x = await reportOf(c);
    const q = c.req.query();
    const today = localDay(new Date(), x.timezone);
    const period = q.from || q.to ? { from: q.from ?? "", to: q.to ?? "" } : lastCompletePeriod(x.frequency as ReportFrequency, today);
    if (!isIsoDate(period.from) || !isIsoDate(period.to) || period.from > period.to) throw new HttpError(400, "invalid_input");
    const out = await buildInsurerReportPdf({ db, storage }, x, period, { amounts: hasOrgPermission(c.get("principal"), "prix.voir", org(c)) });
    return new Response(Buffer.from(out.bytes), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${out.filename}"`, "Cache-Control": "no-store" } });
  });

  return r;
}
