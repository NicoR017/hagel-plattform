// The repair report ("Reparaturbericht" = the photo report of the repair, with the estimate's amounts) made and e-mailed by the SERVER:
// automatically when a vehicle reaches "Finish" for the first time, and again on demand (re-send by the station manager).
// Recipients: the customer carrosserie's list plus the insurer of the vehicle if it wants repair reports. The internal split is never in it.
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { computeVehicle, type CalcVehicle } from "@hagel/calc";
import { generateRepairPhotoReport, type DocPhoto, type DocVehicle, type HandoverDoc, type Letterhead } from "@hagel/documents";
import { audit } from "./audit";
import type { Db } from "./db";
import type { Mailer } from "./email";
import { reportMail } from "./mails";
import { loadMethodMap, methodOf } from "./methods";
import { recipientsOfVehicle } from "./reports";
import { replyToFor } from "./reply_to";
import { companies, insurers, photos, repairEvents, reportSends, stations, users, vehicleHandovers, vehicles } from "./schema";
import type { Storage } from "./storage";
import { calcSettings, flatten, loadOrgSettings } from "./sync";

export interface ReportDeps { db: Db; storage: Storage; mailer: Mailer }
type VehicleRow = typeof vehicles.$inferSelect;

let bundledLogo: Promise<Letterhead["logo"] | undefined> | null = null;
/** The PDR Team logo shipped with the server (vehicles from before letterheads that never chose "without logo"). */
const pdrLogo = () => (bundledLogo ??= readFile(fileURLToPath(new URL("../assets/pdr-team-logo.jpg", import.meta.url)))
  .then((b) => ({ bytes: new Uint8Array(b), kind: "jpg" as const, width: 1000, height: 276 })).catch(() => undefined));

export async function letterheadOf(db: Db, storage: Storage, row: VehicleRow): Promise<Letterhead | null> {
  const h = row.header as Record<string, unknown>;
  const id = typeof h.companyId === "string" ? h.companyId : null;
  if (id) {
    const [co] = await db.select().from(companies).where(and(eq(companies.id, id), eq(companies.orgId, row.orgId)));
    if (co) {
      let logo: Letterhead["logo"] | undefined;
      const meta = co.logoMeta as { kind: "jpg" | "png"; width: number; height: number } | null;
      if (co.logoKey && meta) { const f = await storage.get(co.logoKey); if (f) logo = { bytes: f.bytes, kind: meta.kind, width: meta.width, height: meta.height }; }
      return { name: co.name, logo, address: co.address || undefined, taxId: co.taxId || undefined, email: co.email || undefined, footer: co.footer || undefined };
    }
  }
  if (h.logo === "none") return null;
  const logo = await pdrLogo();
  return logo ? { name: "PDR Team GmbH", logo } : null;
}

/** PDF of the repair report: every photo of the vehicle by phase, the parts to replace, the estimate's amounts (net / VAT / gross). */
export async function buildRepairReportPdf(deps: Pick<ReportDeps, "db" | "storage">, row: VehicleRow, now = new Date()): Promise<{ bytes: Uint8Array; filename: string; lang: "de" | "es" }> {
  const { db, storage } = deps;
  const flat = flatten(row, [], null) as Record<string, unknown>;
  const land: "DE" | "ES" = flat.land === "ES" ? "ES" : "DE";
  const [st] = row.stationId ? await db.select().from(stations).where(eq(stations.id, row.stationId)) : [];
  const [ins] = row.insurerId ? await db.select().from(insurers).where(eq(insurers.id, row.insurerId)) : [];
  const calc = computeVehicle(flat as unknown as CalcVehicle, calcSettings(await loadOrgSettings(db, row.orgId)), methodOf(await loadMethodMap(db, row.orgId), row));
  const doc = {
    ...flat, id: row.id, land, status: row.statut, stationName: st?.name ?? "", insurerName: ins?.name ?? "",
    partsToReplace: Array.isArray(flat.partsToReplace) ? (flat.partsToReplace as string[]) : [],
  } as unknown as DocVehicle;
  const rows = await db.select().from(photos).where(and(eq(photos.vehicleId, row.id), isNull(photos.deletedAt))).orderBy(asc(photos.sort), asc(photos.takenAt));
  const list: DocPhoto[] = [];
  for (const p of rows) {
    const f = p.fileKey ? await storage.get(p.fileKey) : null;
    if (f) list.push({ label: p.label, bytes: f.bytes, inPdf: true, phase: p.phase as DocPhoto["phase"], takenAt: p.takenAt.toISOString() });
  }
  // last page: the customer's signatures at drop-off and pick-up (the newest of each, "not signed yet" when missing)
  const hs = await db.select().from(vehicleHandovers).where(and(eq(vehicleHandovers.vehicleId, row.id), isNull(vehicleHandovers.replacedBy)));
  const docOf = async (kind: "drop_off" | "pick_up"): Promise<HandoverDoc | null> => {
    const h = hs.find((x) => x.kind === kind);
    if (!h) return null;
    const [by] = h.signedBy ? await db.select().from(users).where(eq(users.id, h.signedBy)) : [];
    const [hst] = h.stationId ? await db.select().from(stations).where(eq(stations.id, h.stationId)) : [];
    return { kind, customerName: h.customerName, customerEmail: h.customerEmail, remarks: h.remarks, signedAt: h.signedAt.toISOString(), receivedBy: by?.name || by?.email || "", stationName: hst?.name ?? "", stationAddress: hst?.address ?? "", strokes: h.signature as HandoverDoc["strokes"] };
  };
  const bytes = await generateRepairPhotoReport(doc, {
    letterhead: await letterheadOf(db, storage, row), photos: list, now, handovers: { dropOff: await docOf("drop_off"), pickUp: await docOf("pick_up") },
    amounts: { netto: calc.netto, mwst: calc.brutto - calc.netto, brutto: calc.brutto },
  });
  const plate = String(flat.kennzeichen ?? "").replace(/[^A-Za-z0-9]+/g, "-");
  return { bytes, filename: `${land === "ES" ? "Informe_reparacion" : "Fotobericht_Reparatur"}_${plate}.pdf`, lang: land === "ES" ? "es" : "de" };
}

async function logEvent(db: Db, vehicleId: string, userId: string | null, type: string, payload: Record<string, unknown>) {
  await db.insert(repairEvents).values({ vehicleId, userId, type, payload: payload as never });
}

/**
 * Build, store and e-mail the repair report. `by` = null for the automatic one. The result is logged in `report_sends` (and the history of the
 * vehicle) in every case, so a missing recipient list or a provider outage is visible and the station manager can re-send.
 */
export async function sendRepairReport(deps: ReportDeps, vehicleId: string, by: string | null): Promise<{ id: string; status: "sent" | "failed" | "no_recipients"; recipients: string[]; error?: string }> {
  const { db, storage, mailer } = deps;
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
  if (!row || row.deletedAt) throw new Error("vehicle_not_found");
  const recipients = await recipientsOfVehicle(db, row, "reparation");
  const id = crypto.randomUUID();
  const h = row.header as Record<string, string>;
  const lang = h.land === "ES" ? "es" : "de";
  if (!recipients.length) {
    await db.insert(reportSends).values({ id, orgId: row.orgId, vehicleId, type: "reparation", lang, recipients: [], status: "no_recipients", sentBy: by, sentAt: new Date() });
    await logEvent(db, vehicleId, by, "report_no_recipients", {});
    return { id, status: "no_recipients", recipients: [] };
  }
  let key: string | null = null, replyTo: string | undefined;
  try {
    const pdf = await buildRepairReportPdf(deps, row);
    key = `reports/${row.orgId}/${vehicleId}/${id}.pdf`;
    await storage.put(key, pdf.bytes, "application/pdf");
    const [me] = by ? await db.select().from(users).where(eq(users.id, by)) : [];
    replyTo = await replyToFor(db, by, row.orgId); // the contact address of the organisation or the sender's own e-mail (see reply_to.ts)
    const mail = reportMail(pdf.lang, "reparation", { plate: h.kennzeichen ?? "", model: h.modell ?? "", vin: h.fin ?? "", hasScan: false, senderName: me?.name ?? "" });
    await mailer.send({ to: recipients, subject: mail.subject, text: mail.text, replyTo, attachments: [{ filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" }] });
  } catch (e) {
    const error = String((e as Error).message).slice(0, 300);
    await db.insert(reportSends).values({ id, orgId: row.orgId, vehicleId, type: "reparation", lang, recipients, status: "failed", error, fileKey: key, sentBy: by, sentAt: new Date(), replyTo: replyTo ?? null });
    await logEvent(db, vehicleId, by, "report_failed", { error });
    return { id, status: "failed", recipients, error };
  }
  await db.insert(reportSends).values({ id, orgId: row.orgId, vehicleId, type: "reparation", lang, recipients, status: "sent", fileKey: key, sentBy: by, sentAt: new Date(), replyTo: replyTo ?? null });
  await logEvent(db, vehicleId, by, by ? "report_resent" : "report_sent", { recipients: recipients.length });
  await audit(db, { orgId: row.orgId, userId: by, action: by ? "report.resent" : "report.auto_sent", entity: "report", entityId: id, after: { type: "reparation", recipients } });
  return { id, status: "sent", recipients };
}

/** At the FIRST Finish of a vehicle: send once. A second Finish (moved back and finished again) does not send again; the manager re-sends by hand. */
export async function autoRepairReport(deps: ReportDeps, vehicleId: string): Promise<void> {
  const [prior] = await deps.db.select({ id: reportSends.id }).from(reportSends)
    .where(and(eq(reportSends.vehicleId, vehicleId), eq(reportSends.type, "reparation"), isNull(reportSends.sentBy))).orderBy(desc(reportSends.createdAt)).limit(1);
  if (prior) return;
  await sendRepairReport(deps, vehicleId, null);
}
