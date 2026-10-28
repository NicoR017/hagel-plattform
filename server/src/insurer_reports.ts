// V6, automatic insurer reports: the periods and the figures. One function computes the figures, so the preview, the PDF and the e-mail always agree.
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "./db";
import { addDays, isIsoDate, localDay } from "./colibri_rules";
import { colibriScans, repairBookings, stations, vehicleStatusHistory, vehicles } from "./schema";

/** the figures a report can show, in their default order */
export const INSURER_KPIS = ["inspected", "repaired", "backlog", "upcoming", "progress", "refused"] as const;
export type InsurerKpi = (typeof INSURER_KPIS)[number];
export const DEFAULT_INSURER_KPIS: InsurerKpi[] = ["inspected", "repaired", "backlog", "upcoming", "progress"];
export const REPORT_FREQUENCIES = ["week", "month", "quarter"] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

export interface Period { from: string; to: string }

// ------------------------------------------------------------------ periods (local calendar days, inclusive)

const dow = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay(); // 0 = Sunday
const ymd = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The last COMPLETE period before `today`: the previous Monday-to-Sunday week, calendar month or calendar quarter. */
export function lastCompletePeriod(frequency: ReportFrequency, today: string): Period {
  if (frequency === "week") {
    const monday = addDays(today, -((dow(today) + 6) % 7));
    return { from: addDays(monday, -7), to: addDays(monday, -1) };
  }
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  if (frequency === "month") {
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    return { from: ymd(py, pm, 1), to: ymd(py, pm, lastDayOfMonth(py, pm)) };
  }
  const q = Math.floor((m - 1) / 3); // 0..3, the current quarter
  const py = q === 0 ? y - 1 : y, pq = q === 0 ? 3 : q - 1;
  const lastMonth = pq * 3 + 3;
  return { from: ymd(py, pq * 3 + 1, 1), to: ymd(py, lastMonth, lastDayOfMonth(py, lastMonth)) };
}

/** the period before `period` of the same frequency (periods are complete calendar weeks, months or quarters) */
export const previousPeriod = (frequency: ReportFrequency, period: Period): Period => lastCompletePeriod(frequency, period.from);

/** the `n` periods up to and including `period`, oldest first */
export function periodsUpTo(frequency: ReportFrequency, period: Period, n: number): Period[] {
  const out: Period[] = [period];
  while (out.length < n) out.unshift(previousPeriod(frequency, out[0]));
  return out;
}

export const isValidTimeZone = (tz: string): boolean => {
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return true; } catch { return false; }
};

// ------------------------------------------------------------------ the figures

export interface ReportScope {
  orgId: string;
  insurerIds: string[];
  /** empty = no narrowing */
  bodyshopIds: string[]; stationIds: string[]; countries: string[];
  /** first day counted (null = since the beginning) */
  projectStart: string | null;
  timezone: string;
}

export interface InsurerKpiResult {
  period: Period;
  projectStart: string | null;
  /** the day of the snapshot figures (backlog, upcoming appointments) */
  asOf: string;
  inspected: { period: number; total: number };
  repaired: { period: number; total: number };
  refused: { period: number; total: number };
  /** assessed, not in repair, not returned, not refused, no repair appointment */
  backlog: number;
  /** repair appointments from today on */
  upcoming: number;
  /** repaired / inspected since the project start, in percent with one decimal (null without any inspected car) */
  progress: number | null;
  /** the cars behind each figure (for the annex and for checking the numbers) */
  ids: { inspectedPeriod: string[]; inspectedTotal: string[]; repairedPeriod: string[]; repairedTotal: string[]; refusedPeriod: string[]; refusedTotal: string[]; backlog: string[]; upcoming: string[] };
}

/** one car of a report with the days its figures depend on (local days of the report) */
export interface ReportCar {
  id: string; row: typeof vehicles.$inferSelect;
  inspectedOn: string; repairedOn: string | null; refusedOn: string | null;
  /** assessed, not in repair, not returned, not refused, no repair appointment */
  backlog: boolean;
  /** day of the next repair appointment (today or later), null without one */
  appointmentOn: string | null;
}
export interface ReportFacts { today: string; cars: ReportCar[] }

/**
 * Definitions (validated by Nicolas, 28.10.2026), in the local time of the report:
 *  inspected = day of the assessment: the Colibri scan, else the creation of the vehicle (refused cars included: they were assessed)
 *  repaired  = day the car first reached "Finish" (status fertig; else returned)
 *  refused   = its own line: assessed but will not be repaired (day of the refusal); never in the backlog
 *  backlog   = assessed (inspection / on hold), not in repair, not returned, not refused, without a repair appointment (as of today)
 *  upcoming  = repair appointments from today on (as of today)
 *  progress  = repaired / inspected, both cumulative since the project start up to the end of the period
 * Only cars inspected on or after the project start take part in any figure. Deleted cars never do.
 */
export async function loadReportFacts(db: Db, scope: ReportScope, now = new Date()): Promise<ReportFacts> {
  const tz = scope.timezone;
  const today = localDay(now, tz);
  const day = (d: Date | null | undefined) => (d ? localDay(d, tz) : null);

  const stationRows = await db.select({ id: stations.id, country: stations.country }).from(stations).where(eq(stations.orgId, scope.orgId));
  const stationCountry = new Map(stationRows.map((s) => [s.id, s.country]));

  const all = scope.insurerIds.length
    ? await db.select().from(vehicles).where(and(eq(vehicles.orgId, scope.orgId), isNull(vehicles.deletedAt), inArray(vehicles.insurerId, scope.insurerIds)))
    : [];
  const rows = all.filter((v) => {
    if (scope.bodyshopIds.length && !(v.clientStationId && scope.bodyshopIds.includes(v.clientStationId))) return false;
    if (scope.stationIds.length && !(v.stationId && scope.stationIds.includes(v.stationId))) return false;
    if (scope.countries.length) {
      const land = String((v.header as Record<string, unknown>)?.land ?? "") || (v.stationId ? stationCountry.get(v.stationId) ?? "" : "");
      if (!scope.countries.includes(land)) return false;
    }
    return true;
  });

  // the day of the assessment: the Colibri scan the car came from, else the creation of the vehicle
  const keys = rows.map((v) => v.colibriScanKey).filter((k): k is string => !!k);
  const scanAt = new Map<string, Date>();
  if (keys.length) {
    const pks = [...new Set(keys.map((k) => k.split("|")[0]))];
    for (const s of await db.select({ pk: colibriScans.partitionKey, rk: colibriScans.rowKey, at: colibriScans.scanDateTime }).from(colibriScans).where(inArray(colibriScans.partitionKey, pks))) {
      if (s.at) scanAt.set(`${s.pk}|${s.rk}`, s.at);
    }
  }

  const ids = rows.map((v) => v.id);
  const hist = ids.length ? await db.select().from(vehicleStatusHistory).where(and(inArray(vehicleStatusHistory.vehicleId, ids), inArray(vehicleStatusHistory.statut, ["fertig", "rendu", "refuse"]))) : [];
  const firstAt = (id: string, st: string) => hist.filter((h) => h.vehicleId === id && h.statut === st).map((h) => h.at).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const booked = ids.length ? await db.select().from(repairBookings).where(and(inArray(repairBookings.vehicleId, ids), eq(repairBookings.status, "booked"))) : [];
  const hasBooking = new Set(booked.map((b) => b.vehicleId));

  const cars: ReportCar[] = [];
  for (const v of rows) {
    const inspectedOn = day(scanAt.get(v.colibriScanKey ?? "") ?? v.createdAt);
    if (!inspectedOn || (scope.projectStart && inspectedOn < scope.projectStart)) continue; // before the project: not part of any figure
    const car: ReportCar = { id: v.id, row: v, inspectedOn, repairedOn: null, refusedOn: null, backlog: false, appointmentOn: null };
    if (v.statut === "refuse") car.refusedOn = day(firstAt(v.id, "refuse") ?? v.statutDepuis ?? v.updatedAt);
    else if (v.statut === "fertig" || v.statut === "rendu") car.repairedOn = day(firstAt(v.id, "fertig") ?? firstAt(v.id, "rendu") ?? v.statutDepuis ?? v.updatedAt);
    else if ((v.statut === "besichtigung" || v.statut === "attente") && v.repairStage == null && !hasBooking.has(v.id)) car.backlog = true;
    car.appointmentOn = booked.filter((b) => b.vehicleId === v.id && b.date >= today).map((b) => b.date).sort()[0] ?? null;
    cars.push(car);
  }
  return { today, cars };
}

/** The figures of one period from the facts (the trend of a report is several periods from the same facts). */
export function kpisFromFacts(facts: ReportFacts, scope: Pick<ReportScope, "projectStart">, period: Period): InsurerKpiResult {
  const out: InsurerKpiResult = {
    period, projectStart: scope.projectStart, asOf: facts.today,
    inspected: { period: 0, total: 0 }, repaired: { period: 0, total: 0 }, refused: { period: 0, total: 0 }, backlog: 0, upcoming: 0, progress: null,
    ids: { inspectedPeriod: [], inspectedTotal: [], repairedPeriod: [], repairedTotal: [], refusedPeriod: [], refusedTotal: [], backlog: [], upcoming: [] },
  };
  const inPeriod = (d: string | null) => !!d && d >= period.from && d <= period.to;
  const upTo = (d: string | null) => !!d && d <= period.to;
  for (const car of facts.cars) {
    if (upTo(car.inspectedOn)) { out.ids.inspectedTotal.push(car.id); if (inPeriod(car.inspectedOn)) out.ids.inspectedPeriod.push(car.id); }
    if (upTo(car.refusedOn)) { out.ids.refusedTotal.push(car.id); if (inPeriod(car.refusedOn)) out.ids.refusedPeriod.push(car.id); }
    if (upTo(car.repairedOn)) { out.ids.repairedTotal.push(car.id); if (inPeriod(car.repairedOn)) out.ids.repairedPeriod.push(car.id); }
    if (car.backlog) out.ids.backlog.push(car.id);
    if (car.appointmentOn) out.ids.upcoming.push(car.id);
  }
  out.inspected = { period: out.ids.inspectedPeriod.length, total: out.ids.inspectedTotal.length };
  out.repaired = { period: out.ids.repairedPeriod.length, total: out.ids.repairedTotal.length };
  out.refused = { period: out.ids.refusedPeriod.length, total: out.ids.refusedTotal.length };
  out.backlog = out.ids.backlog.length;
  out.upcoming = out.ids.upcoming.length;
  out.progress = out.inspected.total > 0 ? Math.round((out.repaired.total / out.inspected.total) * 1000) / 10 : null;
  return out;
}

export async function computeInsurerKpis(db: Db, scope: ReportScope, period: Period, now = new Date()): Promise<InsurerKpiResult> {
  return kpisFromFacts(await loadReportFacts(db, scope, now), scope, period);
}

export { isIsoDate };
