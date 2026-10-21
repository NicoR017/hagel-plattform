import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { insurers, stationInsurers, stations, vehicles } from "./schema";

/** kva / reparation: reports for the carrosserie and (by its rules) the insurer. termin: repair-calendar e-mails, never to an insurer. */
export type ReportType = "kva" | "reparation" | "termin";

export interface RecipientSources {
  /** report e-mails of the customer carrosserie (always receives the reports) */
  carrosserieEmails: readonly string[];
  insurer: { sendReports: boolean; reportsToSend: string; reportEmails: readonly string[] } | null;
  /** automatic insurer addresses the admin removed for this station (never removes a manually entered address) */
  excludedInsurerEmails?: readonly string[];
}

const clean = (e: string) => e.trim().toLowerCase();

/**
 * The carrosserie always; the insurer OF THE VEHICLE only if it wants reports and wants this kind of report, minus the addresses excluded on
 * the station. De-duplicated, lower-case. (The insurers selected on a station only PRE-FILL its list in the admin screen: see `stationRecipientPreview`.)
 */
export function recipientsFor(src: RecipientSources, type: ReportType): string[] {
  const out = new Set<string>();
  for (const e of src.carrosserieEmails) if (e.trim()) out.add(clean(e));
  const i = src.insurer;
  if (type !== "termin" && i && i.sendReports && (i.reportsToSend === "both" || i.reportsToSend === type)) {
    const excluded = new Set((src.excludedInsurerEmails ?? []).map(clean));
    const manual = new Set(src.carrosserieEmails.map(clean));
    for (const e of i.reportEmails) if (e.trim() && (!excluded.has(clean(e)) || manual.has(clean(e)))) out.add(clean(e));
  }
  return [...out];
}

export async function recipientsOfVehicle(db: Pick<Db, "select">, v: Pick<typeof vehicles.$inferSelect, "orgId" | "clientStationId" | "insurerId">, type: ReportType): Promise<string[]> {
  let carrosserieEmails: string[] = [], excludedInsurerEmails: string[] = [];
  if (v.clientStationId) {
    const [s] = await db.select().from(stations).where(and(eq(stations.id, v.clientStationId), eq(stations.orgId, v.orgId)));
    if (s && s.type === "carrosserie") { carrosserieEmails = s.reportEmails; excludedInsurerEmails = s.excludedInsurerEmails; }
  }
  let insurer: RecipientSources["insurer"] = null;
  if (v.insurerId) {
    const [i] = await db.select().from(insurers).where(and(eq(insurers.id, v.insurerId), eq(insurers.orgId, v.orgId)));
    if (i) insurer = { sendReports: i.sendReports, reportsToSend: i.reportsToSend, reportEmails: i.reportEmails };
  }
  return recipientsFor({ carrosserieEmails, insurer, excludedInsurerEmails }, type);
}

/** Recipients of the carrosserie where the repair happens (its own list; the customer carrosserie's if the current station has none). */
export async function recipientsForStation(db: Pick<Db, "select">, station: typeof stations.$inferSelect, clientStationId: string | null, type: ReportType): Promise<string[]> {
  let emails = station.type === "carrosserie" ? station.reportEmails : [];
  if (!emails.length && clientStationId && clientStationId !== station.id) {
    const [c] = await db.select().from(stations).where(and(eq(stations.id, clientStationId), eq(stations.orgId, station.orgId)));
    if (c && c.type === "carrosserie") emails = c.reportEmails;
  }
  return recipientsFor({ carrosserieEmails: emails, insurer: null }, type);
}

/**
 * What the admin screen shows for a station: the manual addresses, and the automatic ones of the insurers selected on the station
 * (only insurers that receive reports), each flagged when removed. Used to pre-fill the list; the real send still goes by the vehicle's insurer.
 */
export async function stationRecipientPreview(db: Pick<Db, "select">, stationId: string, orgId: string) {
  const [s] = await db.select().from(stations).where(and(eq(stations.id, stationId), eq(stations.orgId, orgId)));
  if (!s) return null;
  const links = await db.select({ i: insurers }).from(stationInsurers).innerJoin(insurers, eq(insurers.id, stationInsurers.insurerId)).where(eq(stationInsurers.stationId, stationId));
  const excluded = new Set(s.excludedInsurerEmails.map(clean));
  const auto = links.filter((l) => l.i.sendReports).flatMap((l) => l.i.reportEmails.filter((e) => e.trim()).map((e) => ({ insurerId: l.i.id, insurer: l.i.name, email: clean(e), excluded: excluded.has(clean(e)) })));
  const manual = s.reportEmails.map(clean);
  const effective = [...new Set([...manual, ...auto.filter((a) => !a.excluded).map((a) => a.email)])];
  return { manual, auto, effective };
}
