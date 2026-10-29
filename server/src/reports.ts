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
  return recipientsWithSource(src, type).map((r) => r.email);
}

export interface RecipientDefault { email: string; source: "bodyshop" | "insurer"; name?: string }

/** Same list as `recipientsFor`, each address with where it comes from (an address in both lists counts as the carrosserie's). */
export function recipientsWithSource(src: RecipientSources, type: ReportType, names: { bodyshop?: string; insurer?: string } = {}): RecipientDefault[] {
  const out = new Map<string, RecipientDefault>();
  const put = (e: string, source: RecipientDefault["source"]) => { const k = clean(e); if (!out.has(k)) out.set(k, { email: k, source, ...(names[source] ? { name: names[source] } : {}) }); };
  for (const e of src.carrosserieEmails) if (e.trim()) put(e, "bodyshop");
  const i = src.insurer;
  if (type !== "termin" && i && i.sendReports && (i.reportsToSend === "both" || i.reportsToSend === type)) {
    const excluded = new Set((src.excludedInsurerEmails ?? []).map(clean));
    const manual = new Set(src.carrosserieEmails.map(clean));
    for (const e of i.reportEmails) if (e.trim() && (!excluded.has(clean(e)) || manual.has(clean(e)))) put(e, "insurer");
  }
  return [...out.values()];
}

async function sourcesOfVehicle(db: Pick<Db, "select">, v: Pick<typeof vehicles.$inferSelect, "orgId" | "clientStationId" | "insurerId">) {
  let carrosserieEmails: string[] = [], excludedInsurerEmails: string[] = [], bodyshop: string | undefined, insurerName: string | undefined;
  if (v.clientStationId) {
    const [s] = await db.select().from(stations).where(and(eq(stations.id, v.clientStationId), eq(stations.orgId, v.orgId)));
    if (s && s.type === "carrosserie") { carrosserieEmails = s.reportEmails; excludedInsurerEmails = s.excludedInsurerEmails; bodyshop = s.name; }
  }
  let insurer: RecipientSources["insurer"] = null;
  if (v.insurerId) {
    const [i] = await db.select().from(insurers).where(and(eq(insurers.id, v.insurerId), eq(insurers.orgId, v.orgId)));
    if (i) { insurer = { sendReports: i.sendReports, reportsToSend: i.reportsToSend, reportEmails: i.reportEmails }; insurerName = i.name; }
  }
  return { src: { carrosserieEmails, insurer, excludedInsurerEmails } as RecipientSources, names: { bodyshop, insurer: insurerName } };
}

export async function recipientsOfVehicle(db: Pick<Db, "select">, v: Pick<typeof vehicles.$inferSelect, "orgId" | "clientStationId" | "insurerId">, type: ReportType): Promise<string[]> {
  const { src } = await sourcesOfVehicle(db, v);
  return recipientsFor(src, type);
}

/** The default recipients of a vehicle with their source (for the editable list of the send dialog). */
export async function recipientDefaultsOfVehicle(db: Pick<Db, "select">, v: Pick<typeof vehicles.$inferSelect, "orgId" | "clientStationId" | "insurerId">, type: ReportType): Promise<RecipientDefault[]> {
  const { src, names } = await sourcesOfVehicle(db, v);
  return recipientsWithSource(src, type, names);
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
