// Wochenbericht: what one technician / headliner is paid for the cars that reached Finish in a calendar week. Replaces the old technician sheet.
import { zValidator } from "@hono/zod-validator";
import { and, eq, sql } from "drizzle-orm";
import { generateTechnicianWorksheets, techPdfFileName, type TechSheetData } from "@hagel/documents";
import { emailSchema } from "@hagel/shared";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { audit } from "./audit";
import { HttpError } from "./auth";
import { buildTechSheets, type TechSheet } from "./dashboard";
import type { Db } from "./db";
import type { Mailer } from "./email";
import type { Env } from "./env";
import { effectivePermissions } from "./permissions";
import { technicians, users } from "./schema";

interface Deps { db: Db; mailer: Mailer; needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env>; validationHook: (r: { success: boolean }, c: Context) => Response | undefined }

const weekInput = z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/);

/** Monday and Sunday (YYYY-MM-DD) of an ISO week "2026-W43". */
export function isoWeekRange(week: string): { from: string; to: string } {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = Date.UTC(y, 0, 4);
  const mondayW1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000;
  const monday = mondayW1 + (w - 1) * 7 * 86_400_000;
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: day(monday), to: day(monday + 6 * 86_400_000) };
}

export function weeklyRoutes({ db, mailer, needAuth, needOrg, validationHook }: Deps) {
  const r = new Hono<Env>();
  const may: MiddlewareHandler<Env> = async (c, next) => {
    const u = c.get("principal"), now = new Date();
    if (!(u.isSuperadmin || u.grants.some((g) => g.orgId === c.get("orgId") && g.permissions.includes("wochenbericht.voir") && (!g.expiresAt || g.expiresAt > now)))) throw new HttpError(403, "forbidden");
    await next();
  };

  const sheetsOf = async (c: Context<Env>, week: string, technician: string | undefined) => {
    const { from, to } = isoWeekRange(week);
    const all = await buildTechSheets(db, c.get("principal"), c.get("orgId"), { from, to });
    const sheets = technician ? all.sheets.filter((s) => s.technician.toLowerCase() === technician.toLowerCase()) : all.sheets;
    return { week, from, to, sheets };
  };

  /** the week's sheets (all people, or one) and the people with the address the report would go to */
  r.get("/weekly-report", needAuth, needOrg, may, zValidator("query", z.object({ week: weekInput, technician: z.string().max(120).optional() }), validationHook), async (c) => {
    const q = c.req.valid("query");
    const out = await sheetsOf(c, q.week, q.technician);
    const people = await db.select({ t: technicians, email: users.email }).from(technicians).leftJoin(users, eq(users.id, technicians.userId)).where(eq(technicians.orgId, c.get("orgId")));
    return c.json({ ...out, people: people.map(({ t, email }) => ({ id: t.id, name: t.name, kind: t.kind, active: t.active, email: t.email ?? email ?? null })) });
  });

  /** Build the PDF of one person's week and e-mail it (to the person's address; `email` overrides). Logged in the audit trail. */
  r.post("/weekly-report/send", needAuth, needOrg, may, zValidator("json", z.object({ week: weekInput, technician: z.string().trim().min(1).max(120), email: emailSchema.optional(), lang: z.enum(["de", "en"]).default("de") }), validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId"), u = c.get("principal");
    const { from, to, sheets } = await sheetsOf(c, b.week, b.technician);
    const sheet: TechSheet | undefined = sheets[0];
    if (!sheet) throw new HttpError(404, "weekly_report_empty");
    const [tech] = await db.select({ t: technicians, email: users.email }).from(technicians).leftJoin(users, eq(users.id, technicians.userId))
      .where(and(eq(technicians.orgId, orgId), sql`lower(${technicians.name}) = ${b.technician.toLowerCase()}`));
    const to_ = b.email ?? tech?.t.email ?? tech?.email ?? null;
    if (!to_) throw new HttpError(400, "no_recipient");
    const data: TechSheetData[] = [{ technician: sheet.technician, sites: sheet.sites, vehicles: sheet.vehicles, totals: sheet.totals }];
    const pdf = await generateTechnicianWorksheets({ from, to, sheets: data }, b.lang);
    const [me] = await db.select().from(users).where(eq(users.id, u.id));
    const de = b.lang === "de";
    await mailer.send({
      to: to_, replyTo: me?.email,
      subject: de ? `Wochenbericht ${b.week} – ${sheet.technician}` : `Weekly report ${b.week} – ${sheet.technician}`,
      text: de
        ? `Hallo ${sheet.technician},\n\nanbei dein Wochenbericht für ${b.week} (${from} bis ${to}): ${sheet.totals.n} Fahrzeuge.\n\nViele Grüße${me?.name ? "\n" + me.name : ""}`
        : `Hello ${sheet.technician},\n\nattached is your weekly report for ${b.week} (${from} to ${to}): ${sheet.totals.n} vehicles.\n\nBest regards${me?.name ? "\n" + me.name : ""}`,
      attachments: [{ filename: techPdfFileName(from, to, b.lang), content: pdf, contentType: "application/pdf" }],
    });
    await audit(db, { orgId, userId: u.id, action: "send_weekly_report", entity: "technician", entityId: tech?.t.id ?? null, after: { week: b.week, technician: sheet.technician, to: to_, vehicles: sheet.totals.n, eur: sheet.totals.eur } });
    return c.json({ ok: true, to: to_, vehicles: sheet.totals.n, eur: sheet.totals.eur });
  });

  return r;
}
