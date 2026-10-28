// V6, automatic insurer reports: the data of one report for one period, and its PDF. The preview, the manual send and the automatic send all come through here.
import { eq } from "drizzle-orm";
import { computeVehicle, type CalcVehicle } from "@hagel/calc";
import { generateInsurerReport, insurerReportFileName, type InsurerReportData, type InsurerReportKpi, type InsurerReportLang, type InsurerReportRow } from "@hagel/documents";
import type { Db } from "./db";
import { INSURER_KPIS, kpisFromFacts, loadReportFacts, periodsUpTo, type InsurerKpiResult, type Period, type ReportFrequency, type ReportScope } from "./insurer_reports";
import { loadMethodMap, methodOf } from "./methods";
import { defaultLetterhead, letterheadOfCompany } from "./repair_report";
import { insurerReports, insurers, stations } from "./schema";
import type { Storage } from "./storage";
import { calcSettings, flatten, loadOrgSettings } from "./sync";

type Report = typeof insurerReports.$inferSelect;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** periods shown in the evolution chart */
export const TREND_PERIODS = 8;

export const scopeOf = (r: Report): ReportScope => ({
  orgId: r.orgId, insurerIds: r.insurerIds, bodyshopIds: r.bodyshopIds, stationIds: r.stationIds, countries: r.countries, projectStart: r.projectStart, timezone: r.timezone,
});

/**
 * What the report says for `period`. `amounts`: the net price of every car of the annex, only when the report shows amounts and the caller may
 * give them out (the internal split is never part of it).
 */
export async function buildInsurerReportData(db: Db, report: Report, period: Period, opts: { now?: Date; amounts?: boolean } = {}): Promise<{ data: InsurerReportData; kpis: InsurerKpiResult }> {
  const scope = scopeOf(report);
  const facts = await loadReportFacts(db, scope, opts.now);
  const kpis = kpisFromFacts(facts, scope, period);
  const frequency = report.frequency as ReportFrequency;
  const trend = periodsUpTo(frequency, period, TREND_PERIODS).map((p) => {
    const k = kpisFromFacts(facts, scope, p);
    return { from: p.from, to: p.to, inspected: k.inspected.period, repaired: k.repaired.period };
  });

  const insurerNames = new Map((await db.select({ id: insurers.id, name: insurers.name }).from(insurers).where(eq(insurers.orgId, report.orgId))).map((i) => [i.id, i.name]));
  const showAmounts = report.showAmounts && !!opts.amounts;

  let annex: InsurerReportRow[] | null = null;
  if (report.annexVehicles) {
    // the cars behind the figures of the report: inspected, repaired or refused in the period, waiting for an appointment, with an appointment to come
    const ids = new Set([...kpis.ids.inspectedPeriod, ...kpis.ids.repairedPeriod, ...kpis.ids.refusedPeriod, ...kpis.ids.backlog, ...kpis.ids.upcoming]);
    const stationName = new Map((await db.select({ id: stations.id, name: stations.name }).from(stations).where(eq(stations.orgId, report.orgId))).map((s) => [s.id, s.name]));
    const calcs = showAmounts ? calcSettings(await loadOrgSettings(db, report.orgId)) : null;
    const methods = showAmounts ? await loadMethodMap(db, report.orgId) : null;
    annex = facts.cars.filter((c) => ids.has(c.id)).map((c): InsurerReportRow => {
      const h = c.row.header as Record<string, unknown>;
      const row: InsurerReportRow = {
        plate: String(h.kennzeichen ?? ""), model: String(h.modell ?? ""),
        bodyshop: (c.row.clientStationId ? stationName.get(c.row.clientStationId) : "") || String(h.kunde ?? ""),
        station: c.row.stationId ? stationName.get(c.row.stationId) ?? "" : "",
        inspectedOn: c.inspectedOn, status: c.row.statut, repairedOn: c.repairedOn, refusedOn: c.refusedOn, appointmentOn: c.appointmentOn,
      };
      if (showAmounts && calcs && methods) {
        const flat = flatten(c.row, [], null);
        row.net = round2(computeVehicle(flat as unknown as CalcVehicle, calcs, methodOf(methods, c.row)).netto);
      }
      return row;
    }).sort((a, b) => a.inspectedOn.localeCompare(b.inspectedOn) || a.plate.localeCompare(b.plate));
  }

  const kpiList = (report.kpis as string[]).filter((k): k is InsurerReportKpi => (INSURER_KPIS as readonly string[]).includes(k));
  const data: InsurerReportData = {
    name: report.name, insurers: report.insurerIds.map((id) => insurerNames.get(id) ?? "").filter(Boolean),
    period, projectStart: report.projectStart, asOf: kpis.asOf, kpis: kpiList,
    figures: { inspected: kpis.inspected, repaired: kpis.repaired, refused: kpis.refused, backlog: kpis.backlog, upcoming: kpis.upcoming, progress: kpis.progress },
    trend, annex, showAmounts,
  };
  return { data, kpis };
}

/** The PDF of a report for a period, with the letterhead of its company (else the PDR Team logo). */
export async function buildInsurerReportPdf(deps: { db: Db; storage: Storage }, report: Report, period: Period, opts: { now?: Date; amounts?: boolean } = {}): Promise<{ bytes: Uint8Array; filename: string; data: InsurerReportData; kpis: InsurerKpiResult }> {
  const { data, kpis } = await buildInsurerReportData(deps.db, report, period, opts);
  const lang = (["es", "en", "de", "fr"].includes(report.language) ? report.language : "es") as InsurerReportLang;
  const letterhead = (await letterheadOfCompany(deps.db, deps.storage, report.orgId, report.companyId)) ?? (await defaultLetterhead());
  const bytes = await generateInsurerReport(data, { lang, letterhead, now: opts.now });
  return { bytes, filename: insurerReportFileName(data, lang), data, kpis };
}
