import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { insurers, stations, vehicles } from "./schema";

export type ReportType = "kva" | "reparation";

export interface RecipientSources {
  /** report e-mails of the customer carrosserie (always receives the reports) */
  carrosserieEmails: readonly string[];
  insurer: { sendReports: boolean; reportsToSend: string; reportEmails: readonly string[] } | null;
}

/** Customer carrosserie always; the insurer only if it wants reports and wants this kind of report. De-duplicated, lower-case. */
export function recipientsFor(src: RecipientSources, type: ReportType): string[] {
  const out = new Set<string>();
  for (const e of src.carrosserieEmails) if (e.trim()) out.add(e.trim().toLowerCase());
  const i = src.insurer;
  if (i && i.sendReports && (i.reportsToSend === "both" || i.reportsToSend === type)) for (const e of i.reportEmails) if (e.trim()) out.add(e.trim().toLowerCase());
  return [...out];
}

export async function recipientsOfVehicle(db: Pick<Db, "select">, v: Pick<typeof vehicles.$inferSelect, "orgId" | "clientStationId" | "insurerId">, type: ReportType): Promise<string[]> {
  let carrosserieEmails: string[] = [];
  if (v.clientStationId) {
    const [s] = await db.select().from(stations).where(and(eq(stations.id, v.clientStationId), eq(stations.orgId, v.orgId)));
    if (s && s.type === "carrosserie") carrosserieEmails = s.reportEmails;
  }
  let insurer: RecipientSources["insurer"] = null;
  if (v.insurerId) {
    const [i] = await db.select().from(insurers).where(and(eq(insurers.id, v.insurerId), eq(insurers.orgId, v.orgId)));
    if (i) insurer = { sendReports: i.sendReports, reportsToSend: i.reportsToSend, reportEmails: i.reportEmails };
  }
  return recipientsFor({ carrosserieEmails, insurer }, type);
}
