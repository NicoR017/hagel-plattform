import { and, eq, lt, or, sql } from "drizzle-orm";
import sharp from "sharp";
import { applyColibri, colibriPages, parseColibri, scanCheck, titleCase } from "@hagel/colibri";
import { audit } from "./audit";
import type { AzureSource } from "./azure";
import { loadMappingContext, mapScan, tenantsOfOrg, type ScanMapping } from "./azure_sync";
import type { Db } from "./db";
import type { Hub } from "./hub";
import { can, canOrg, type Principal } from "./permissions";
import { campaignStations, campaigns, colibriScans, companies, photos, stations, vehicleStatusHistory, vehicles } from "./schema";
import type { Storage } from "./storage";
import { colibriKey, loadOrgSettings, nextSeq, photoKey } from "./sync";

export const SCANS_CONTAINER = "allscans";
export const PICTURES_CONTAINER = "scan-color-pictures";

const POSITIONS = ["FRONT_UPPER_RIGHT", "FRONT_BOTTOM_RIGHT", "RIGHT", "BACK_UPPER_RIGHT", "BACK_BOTTOM_RIGHT", "BACK_UPPER_LEFT", "BACK_BOTTOM_LEFT", "LEFT", "FRONT_UPPER_LEFT", "FRONT_BOTTOM_LEFT", "FRONT", "TOP_FRONT", "TOP_BACK", "EXTRA_LEFT", "EXTRA_RIGHT"];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Blob name `<PartitionKey>_Overview_Pictures_<Position>-<n>` (the position may be the enum name or its number; any file extension). */
export function parsePhotoName(partitionKey: string, blobName: string, stems: string[] = []): { position: string; index: number } | null {
  const prefixes = [partitionKey, ...stems].map(escapeRe).join("|");
  const m = new RegExp(`^(?:${prefixes})_Overview_Pictures_([A-Za-z]+(?:_[A-Za-z]+)*|\\d+)(?:[-_](\\d+))?(?:\\.[A-Za-z0-9]+)?$`).exec(blobName);
  if (!m) return null;
  const raw = m[1];
  const position = /^\d+$/.test(raw) ? POSITIONS[Number(raw)] ?? `UNKNOWN_${raw}` : raw.toUpperCase();
  return { position, index: m[2] != null ? Number(m[2]) : 0 };
}

/** Stored labels stay German (the documents translate them for Spanish). */
export function positionLabel(position: string): string {
  if (position === "EXTRA_LEFT" || position === "LEFT") return "Seite links";
  if (position === "EXTRA_RIGHT" || position === "RIGHT") return "Seite rechts";
  if (position.startsWith("FRONT")) return "Vorderansicht";
  if (position.startsWith("BACK")) return "Heckansicht";
  if (position.startsWith("TOP")) return "Dach";
  return "Sonstiges";
}

/** The blob name of the report PDF from the `urlPdf` column (a full URL or just the name). */
export function pdfBlobName(urlPdf: string, partitionKey: string): string[] {
  const out: string[] = [];
  if (urlPdf) {
    try {
      const u = new URL(urlPdf);
      const parts = decodeURIComponent(u.pathname).replace(/^\//, "").split("/");
      out.push(parts[0] === SCANS_CONTAINER ? parts.slice(1).join("/") : parts.join("/"));
    } catch { out.push(urlPdf.replace(new RegExp(`^/?${SCANS_CONTAINER}/`), "")); }
  }
  out.push(`${partitionKey}.pdf`);
  return [...new Set(out.filter(Boolean))];
}

/** Possible blob-name prefixes of the photos: the PDF name without extension, and the PartitionKey (yyyyMMddHHmm) written as yyyyMMdd-HHmm. */
export function photoStems(urlPdf: string, partitionKey: string): string[] {
  const out = pdfBlobName(urlPdf, partitionKey).map((n) => (n.split("/").pop() ?? n).replace(/\.pdf$/i, ""));
  const m = /^(\d{8})(\d{4})/.exec(partitionKey);
  if (m) out.push(`${m[1]}-${m[2]}`);
  return [...new Set(out.filter(Boolean))];
}

export type ImportStatus = "imported" | "already" | "not_found" | "not_allowed" | "unmapped" | "pdf_missing" | "pdf_unreadable" | "error";
export interface ImportResult {
  partitionKey: string; rowKey: string; status: ImportStatus; vehicleId?: string; message?: string;
  check?: { imported: number; total: number | null; azureTotal: number | null; ok: boolean; unknown: string[] }; photos?: number; photoErrors?: number;
}

export interface ImportDeps { db: Db; az: AzureSource; storage: Storage; hub: Hub; now?: () => Date }

const todayIso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Imports scans as vehicles: PDF -> /packages/colibri (the v20 algorithm) -> vehicle (status "besichtigung", site, customer, insurer,
 * claim number, campaign if one is active for the site), the PDF attached, the overview photos copied (1280 px JPEG q0.6).
 * A scan is imported once: the claim is atomic and vehicles.colibri_scan_key is unique.
 */
export async function importScans(d: ImportDeps, u: Principal, keys: { partitionKey: string; rowKey: string }[], callerOrgId: string): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  const ctx = await loadMappingContext(d.db);
  const myTenants = await tenantsOfOrg(d.db, callerOrgId);
  for (const k of keys) out.push(await importOne(d, u, k, ctx, myTenants));
  return out;
}

async function importOne(d: ImportDeps, u: Principal, k: { partitionKey: string; rowKey: string }, ctx: Awaited<ReturnType<typeof loadMappingContext>>, myTenants: string[]): Promise<ImportResult> {
  const base = { partitionKey: k.partitionKey, rowKey: k.rowKey };
  const now = d.now?.() ?? new Date();
  const [scan] = await d.db.select().from(colibriScans).where(and(eq(colibriScans.partitionKey, k.partitionKey), eq(colibriScans.rowKey, k.rowKey)));
  // a scan of a tenant the caller's organisation does not use does not exist for him (no information leaks across tenants)
  if (!scan || !myTenants.includes(scan.tenant)) return { ...base, status: "not_found" };
  if (scan.importStatus === "imported") return { ...base, status: "already", vehicleId: scan.vehicleId ?? undefined };
  const m: ScanMapping = mapScan(scan, ctx);
  // the scan must belong to the user's organisation through ITS tenant — never through a name
  if (!m.importable || !m.orgId || !m.stationId) return { ...base, status: "unmapped" };
  const orgTenants = await tenantsOfOrg(d.db, m.orgId);
  if (!scan.tenant || !orgTenants.includes(scan.tenant)) return { ...base, status: "unmapped" };
  const ref = { id: "new", orgId: m.orgId, stationId: m.stationId, clientStationId: m.clientStationId, campaignId: null, insurerId: m.insurerId, assigneeIds: [] as string[] };
  if (!can(u, "vehicules.creer", ref) || !canOrg(u, "colibri.importer", m.orgId, m.stationId)) return { ...base, status: "not_allowed" };

  // atomic claim (a crashed import is retried after 10 minutes)
  const claimed = await d.db.update(colibriScans).set({ importStatus: "importing", updatedAt: now }).where(and(
    eq(colibriScans.partitionKey, k.partitionKey), eq(colibriScans.rowKey, k.rowKey),
    or(eq(colibriScans.importStatus, "new"), and(eq(colibriScans.importStatus, "importing"), lt(colibriScans.updatedAt, new Date(now.getTime() - 10 * 60_000)))),
  )).returning();
  if (!claimed.length) { const [cur] = await d.db.select().from(colibriScans).where(and(eq(colibriScans.partitionKey, k.partitionKey), eq(colibriScans.rowKey, k.rowKey))); return { ...base, status: "already", vehicleId: cur?.vehicleId ?? undefined }; }

  const release = () => d.db.update(colibriScans).set({ importStatus: "new", updatedAt: new Date() }).where(and(eq(colibriScans.partitionKey, k.partitionKey), eq(colibriScans.rowKey, k.rowKey)));
  const stored: string[] = [];
  try {
    // 1. the report PDF
    let pdf: Uint8Array | null = null;
    for (const name of pdfBlobName(scan.urlPdf, scan.partitionKey)) { pdf = await d.az.getBlob(SCANS_CONTAINER, name); if (pdf) break; }
    if (!pdf) { await release(); return { ...base, status: "pdf_missing" }; }
    const parsed = parseColibri(await colibriPages(pdf));
    if (!parsed.found) { await release(); return { ...base, status: "pdf_unreadable" }; }

    // 2. the vehicle (v20 apply rules: overwrite plate / FIN / model / date, panels get the dents, Dachholm gets glue)
    const [station] = await d.db.select().from(stations).where(eq(stations.id, m.stationId));
    const [client] = m.clientStationId ? await d.db.select().from(stations).where(eq(stations.id, m.clientStationId)) : [null];
    const settings = await loadOrgSettings(d.db, m.orgId);
    const land: "DE" | "ES" = (station.country === "ES" ? "ES" : "DE");
    const applied = applyColibri({ panels: {} } as never, parsed, now) as unknown as { kennzeichen?: string; fin?: string; modell?: string; leistungsdatum?: string; panels: Record<string, unknown>; colibri: Record<string, unknown> };
    const vin = (applied.fin ?? scan.vin).toUpperCase().replace(/\s/g, "");
    const header: Record<string, unknown> = {
      land, kennzeichen: (applied.kennzeichen || scan.plate).toUpperCase(), fin: /^[A-Z0-9]{11,17}$/.test(vin) ? vin : "",
      modell: applied.modell || [titleCase(scan.brand.split("-")[0]), titleCase(scan.model)].join(" ").trim(),
      kunde: client?.name ?? "", kundeEmail: "", leistungsdatum: applied.leistungsdatum || (scan.scanDateTime ? todayIso(scan.scanDateTime) : todayIso(now)),
      teiler: settings.defaultTeiler, stundensatz: land === "ES" ? settings.rateES : settings.rateDE, notiz: "", zustand: ["Trocken", "Sauber"],
      greifzone: false, hohlraum: false, verbringung: false, logo: "pdr", claimNumber: scan.claimNumber,
    };
    const [co] = await d.db.select().from(companies).where(and(eq(companies.orgId, m.orgId), eq(companies.active, true)));
    const withLogo = (await d.db.select().from(companies).where(and(eq(companies.orgId, m.orgId), eq(companies.active, true)))).find((x) => x.logoKey) ?? co;
    if (withLogo) header.companyId = withLogo.id;
    // a campaign that is running for this site
    const camps = await d.db.select({ c: campaigns }).from(campaigns).innerJoin(campaignStations, eq(campaignStations.campaignId, campaigns.id)).where(and(eq(campaigns.orgId, m.orgId), eq(campaignStations.stationId, m.stationId)));
    const day = todayIso(now);
    const campaign = camps.map((x) => x.c).find((c) => (!c.start || c.start <= day) && (!c.end || c.end >= day)) ?? null;
    const check = scanCheck(applied.colibri as never, scan.dentsTotal);
    const colibriMeta = { ...applied.colibri, azureTotal: scan.dentsTotal };
    const vehicleId = crypto.randomUUID();
    const ts = now.getTime();
    const stamps: Record<string, number> = { status: ts, site: ts };
    for (const key of Object.keys(header)) stamps[`h.${key}`] = ts;
    const shares: Record<string, unknown> = { techName: "", techPct: 50, demTechName: "", demTechPct: 100 };
    if (client?.type === "carrosserie") { shares.werkMode = client.commissionMode; shares.werkPct = Number(client.commissionPct); }
    for (const key of Object.keys(shares)) stamps[`s.${key}`] = ts;
    const colibriFile = { name: `${scan.partitionKey}.pdf`, size: pdf.length, key: colibriKey(m.orgId, vehicleId) };
    await d.storage.put(colibriFile.key, pdf, "application/pdf"); stored.push(colibriFile.key);

    // 3. overview photos
    type P = { position: string; index: number; label: string; bytes: Uint8Array };
    const prepared: P[] = [];
    let photoErrors = 0;
    // real blob names start with the PDF's stem (`20261019-1627_<plate>`), the PartitionKey is the same time without the dash (`202610191627`)
    const stems = photoStems(scan.urlPdf, scan.partitionKey);
    const names = new Set<string>();
    for (const prefix of [scan.partitionKey, ...stems.map((s) => s.split("_")[0])]) for (const n of await d.az.listBlobs(PICTURES_CONTAINER, prefix)) names.add(n);
    for (const name of names) {
      const pn = parsePhotoName(scan.partitionKey, name, stems);
      if (!pn) continue;
      try {
        const raw = await d.az.getBlob(PICTURES_CONTAINER, name);
        if (!raw) { photoErrors++; continue; }
        const jpg = await sharp(raw).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer();
        prepared.push({ ...pn, label: positionLabel(pn.position), bytes: new Uint8Array(jpg) });
      } catch { photoErrors++; }
    }
    prepared.sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || a.index - b.index);
    // only the first photo (in position order) of each view goes into the PDF
    const firstOfLabel = new Map<string, P>();
    for (const p of prepared) if (!firstOfLabel.has(p.label)) firstOfLabel.set(p.label, p);
    const photoRows = prepared.map((p, i) => ({ id: crypto.randomUUID(), p, sort: i }));
    for (const r of photoRows) { const key = photoKey(m.orgId, vehicleId, r.id); await d.storage.put(key, r.p.bytes, "image/jpeg"); stored.push(key); }

    // 4. one transaction: vehicle, photos, history, the scan marked as imported
    await d.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(7001)`);
      const seq = await nextSeq(tx);
      await tx.insert(vehicles).values({
        id: vehicleId, orgId: m.orgId!, stationId: m.stationId, clientStationId: m.clientStationId, campaignId: campaign?.id ?? null, insurerId: m.insurerId,
        statut: "besichtigung", statutDepuis: now, header: header as never, panels: applied.panels as never,
        panelsAt: Object.fromEntries(Object.keys(applied.panels).map((p) => [p, ts])), shares: shares as never, groupAt: stamps, colibri: colibriMeta as never,
        colibriFile: colibriFile as never, colibriScanKey: `${scan.partitionKey}|${scan.rowKey}`, seq, createdBy: u.id, updatedBy: u.id,
      });
      await tx.insert(vehicleStatusHistory).values({ vehicleId, statut: "besichtigung", userId: u.id });
      for (const r of photoRows) {
        await tx.insert(photos).values({
          id: r.id, vehicleId, fileKey: photoKey(m.orgId!, vehicleId, r.id), size: r.p.bytes.length, label: r.p.label, phase: "besichtigung", source: "colibri",
          colibriPosition: r.p.position, colibriIndex: r.p.index, inPdf: firstOfLabel.get(r.p.label) === r.p, takenAt: scan.scanDateTime ?? now, takenBy: u.id,
          sort: r.sort, seq: await nextSeq(tx),
        });
      }
      await tx.update(colibriScans).set({ importStatus: "imported", vehicleId, importedBy: u.id, importedAt: now, updatedAt: now }).where(and(eq(colibriScans.partitionKey, k.partitionKey), eq(colibriScans.rowKey, k.rowKey)));
      await audit(tx as unknown as Db, { orgId: m.orgId, userId: u.id, action: "azure.import", entity: "vehicle", entityId: vehicleId, after: { scan: `${scan.partitionKey}|${scan.rowKey}`, plate: header.kennzeichen, photos: photoRows.length, dents: parsed.imported } });
    });
    d.hub.publish(m.orgId, 0);
    return { ...base, status: "imported", vehicleId, check: { imported: parsed.imported, total: parsed.reportTotal, azureTotal: scan.dentsTotal, ok: check.ok, unknown: parsed.unknown }, photos: photoRows.length, photoErrors };
  } catch (e) {
    for (const key of stored) await d.storage.delete(key).catch(() => undefined);
    await release();
    return { ...base, status: "error", message: String((e as Error).message).slice(0, 200) };
  }
}

