// V6, automatic insurer reports: the text of the e-mail. Subject and body are written by the administrator with {{variables}}; empty = the default text of the language.
import { reportDate, reportInt, reportPercent, type InsurerReportLang } from "@hagel/documents";
import type { InsurerKpiResult, Period, ReportFrequency } from "./insurer_reports";

/** the variables an e-mail text may use (the editor offers exactly these) */
export const TEMPLATE_VARS = [
  "insurer", "period", "period_short", "project_start", "inspected_period", "inspected_total", "repaired_period", "repaired_total",
  "backlog", "upcoming", "progress", "sender", "company",
] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];

const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
/** the variables of a text that do not exist (a typo would otherwise go to the insurer as it is) */
export const unknownVars = (text: string): string[] => [...new Set([...text.matchAll(VAR_RE)].map((m) => m[1]).filter((v) => !(TEMPLATE_VARS as readonly string[]).includes(v)))];
export const renderTemplate = (text: string, vars: Record<string, string>): string => text.replace(VAR_RE, (_m, v: string) => vars[v] ?? "");

const MONTHS: Record<InsurerReportLang, string> = { es: "es-ES", en: "en-GB", de: "de-DE", fr: "fr-FR" };
const QUARTER: Record<InsurerReportLang, string> = { es: "T", en: "Q", de: "Q", fr: "T" };
/** "19/10 - 25/10" for a week, "September 2026" for a month, "Q3 2026" for a quarter */
export function periodShort(lang: InsurerReportLang, frequency: ReportFrequency, p: Period): string {
  if (frequency === "week") return `${reportDate(lang, p.from).slice(0, 5)} - ${reportDate(lang, p.to).slice(0, 5)}`;
  const y = Number(p.from.slice(0, 4)), m = Number(p.from.slice(5, 7));
  if (frequency === "month") {
    const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(MONTHS[lang], { month: "long", year: "numeric", timeZone: "UTC" });
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return `${QUARTER[lang]}${Math.floor((m - 1) / 3) + 1} ${y}`;
}

export interface TemplateContext {
  lang: InsurerReportLang; frequency: ReportFrequency; period: Period; projectStart: string | null; insurers: string[];
  kpis: Pick<InsurerKpiResult, "inspected" | "repaired" | "backlog" | "upcoming" | "progress">;
  sender: string; company: string;
}
export function templateVars(c: TemplateContext): Record<TemplateVar, string> {
  const n = (x: number) => reportInt(c.lang, x);
  return {
    insurer: c.insurers.join(", "), period: `${reportDate(c.lang, c.period.from)} - ${reportDate(c.lang, c.period.to)}`, period_short: periodShort(c.lang, c.frequency, c.period),
    project_start: c.projectStart ? reportDate(c.lang, c.projectStart) : "",
    inspected_period: n(c.kpis.inspected.period), inspected_total: n(c.kpis.inspected.total), repaired_period: n(c.kpis.repaired.period), repaired_total: n(c.kpis.repaired.total),
    backlog: n(c.kpis.backlog), upcoming: n(c.kpis.upcoming), progress: reportPercent(c.lang, c.kpis.progress), sender: c.sender, company: c.company,
  };
}

/** the text used when the administrator wrote none */
export const DEFAULT_TEXTS: Record<InsurerReportLang, { subject: string; body: string }> = {
  es: {
    subject: "Informe de actividad PDR - {{insurer}} - {{period_short}}",
    body: "Estimados señores:\n\nAdjuntamos el informe de actividad de PDR Team para {{insurer}} correspondiente al periodo {{period}}.\n\nEn este periodo se han peritado {{inspected_period}} vehículos y se han reparado {{repaired_period}}. En total, desde el inicio del proyecto: {{inspected_total}} peritados y {{repaired_total}} reparados ({{progress}}). Hay {{backlog}} vehículos pendientes de cita de reparación y {{upcoming}} citas de reparación confirmadas.\n\nQuedamos a su disposición para cualquier consulta.\n\nUn saludo cordial\n{{sender}}\n{{company}}",
  },
  en: {
    subject: "PDR activity report - {{insurer}} - {{period_short}}",
    body: "Dear Sir or Madam,\n\nPlease find attached the PDR Team activity report for {{insurer}} for the period {{period}}.\n\nIn this period {{inspected_period}} vehicles were inspected and {{repaired_period}} were repaired. In total since the start of the project: {{inspected_total}} inspected and {{repaired_total}} repaired ({{progress}}). {{backlog}} vehicles are waiting for a repair appointment and {{upcoming}} repair appointments are confirmed.\n\nWe remain at your disposal for any questions.\n\nKind regards\n{{sender}}\n{{company}}",
  },
  de: {
    subject: "PDR-Aktivitätsbericht - {{insurer}} - {{period_short}}",
    body: "Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie den Aktivitätsbericht von PDR Team für {{insurer}} für den Zeitraum {{period}}.\n\nIn diesem Zeitraum wurden {{inspected_period}} Fahrzeuge begutachtet und {{repaired_period}} repariert. Insgesamt seit Projektbeginn: {{inspected_total}} begutachtet und {{repaired_total}} repariert ({{progress}}). {{backlog}} Fahrzeuge warten auf einen Reparaturtermin, {{upcoming}} Reparaturtermine sind bestätigt.\n\nFür Rückfragen stehen wir gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{{sender}}\n{{company}}",
  },
  fr: {
    subject: "Rapport d'activité PDR - {{insurer}} - {{period_short}}",
    body: "Madame, Monsieur,\n\nVeuillez trouver ci-joint le rapport d'activité de PDR Team pour {{insurer}} sur la période {{period}}.\n\nSur cette période, {{inspected_period}} véhicules ont été expertisés et {{repaired_period}} réparés. Au total depuis le début du projet : {{inspected_total}} expertisés et {{repaired_total}} réparés ({{progress}}). {{backlog}} véhicules attendent un rendez-vous de réparation et {{upcoming}} rendez-vous de réparation sont confirmés.\n\nNous restons à votre disposition pour toute question.\n\nCordialement\n{{sender}}\n{{company}}",
  },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export interface RenderedMail { subject: string; text: string; html: string }
/** subject, plain text and HTML of the e-mail: the variables filled in, the text escaped (an insurer's name can never inject markup) */
export function renderReportMail(report: { subject: string; body: string }, lang: InsurerReportLang, vars: Record<string, string>): RenderedMail {
  const d = DEFAULT_TEXTS[lang];
  const subject = renderTemplate(report.subject.trim() || d.subject, vars).replace(/\s+/g, " ").trim();
  const text = renderTemplate(report.body.trim() || d.body, vars).replace(/\n{3,}/g, "\n\n").trim();
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#16233f;line-height:1.5">${text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
  return { subject, text, html };
}
