import { computeVehicle, type CalcResult } from "@hagel/calc";
import { appendScanPdf, generateKvaPdf, generateRepairPhotoReport, kvaFileName, mailTexts, type DocPhoto, type DocVehicle, type Letterhead } from "@hagel/documents";
import type { LocalDb, LocalPhoto, LocalVehicle, Refs } from "../sync/db";
import type { SyncEngine } from "../sync/engine";
import type { Settings } from "@hagel/calc";

export function toDoc(v: LocalVehicle, refs: Refs | undefined): DocVehicle {
  const x = v as Record<string, any>;
  return {
    ...x, id: v.id, land: x.land === "ES" ? "ES" : "DE", status: v.statut,
    stationName: refs?.stations.find((s) => s.id === v.stationId)?.name ?? "", colibriFile: v.colibriFile,
    insurerName: refs?.insurers.find((i) => i.id === v.insurerId)?.name ?? "",
  } as DocVehicle;
}

let logoCache: Promise<Letterhead["logo"] | undefined> | null = null;
/** The PDR Team logo, bundled with the app (works offline once the app has been loaded). */
async function pdrLogo(): Promise<Letterhead["logo"] | undefined> {
  logoCache ??= (async () => {
    try {
      const r = await fetch("/pdr-team-logo.jpg");
      if (!r.ok) return undefined;
      return { bytes: new Uint8Array(await r.arrayBuffer()), kind: "jpg" as const, width: 1000, height: 276 };
    } catch { logoCache = null; return undefined; }
  })();
  return logoCache;
}

/**
 * Letterhead of a vehicle: the chosen company (name, address, tax id, e-mail, footer, logo from the server, cached on the phone).
 * Vehicles created before letterheads existed fall back to the old "PDR Team logo / without logo" switch.
 */
export async function letterheadFor(v: LocalVehicle, refs: Refs | undefined, db: LocalDb, engine: SyncEngine): Promise<Letterhead | null> {
  const x = v as Record<string, any>;
  const co = x.companyId ? refs?.companies.find((c) => c.id === x.companyId) : undefined;
  if (co) {
    let logo: Letterhead["logo"] | undefined;
    if (co.hasLogo && co.logo) {
      const blob = await engine.ensureLogoBlob(co.id, v.orgId);
      if (blob) logo = { bytes: new Uint8Array(await blob.arrayBuffer()), kind: co.logo.kind, width: co.logo.width, height: co.logo.height };
    }
    return { name: co.name, logo, address: co.address || undefined, taxId: co.taxId || undefined, email: co.email || undefined, footer: co.footer || undefined };
  }
  void db;
  if (x.logo === "none") return null;
  const logo = await pdrLogo();
  return logo ? { name: "PDR Team GmbH", logo } : null;
}

export async function photosForDoc(db: LocalDb, engine: SyncEngine, vehicleId: string, onlyInPdf: boolean): Promise<DocPhoto[]> {
  const rows: LocalPhoto[] = await db.photos.where("vehicleId").equals(vehicleId).sortBy("sort");
  const out: DocPhoto[] = [];
  for (const p of rows) {
    if (onlyInPdf && !p.inPdf) continue;
    const blob = (await db.blobs.get(`photo:${p.id}`))?.blob ?? (p.hasFile ? await engine.ensurePhotoBlob(p.id) : null);
    if (!blob) continue;
    out.push({ label: p.label, bytes: new Uint8Array(await blob.arrayBuffer()), inPdf: p.inPdf, phase: p.phase, takenAt: p.takenAt });
  }
  return out;
}

/** KVA PDF (+ the Colibri scan appended when there is one). */
export async function buildSendPdf(db: LocalDb, engine: SyncEngine, v: LocalVehicle, c: CalcResult, refs: Refs | undefined): Promise<{ bytes: Uint8Array; merged: boolean; scan: Blob | null }> {
  const doc = toDoc(v, refs);
  const kva = await generateKvaPdf(doc, c, { letterhead: await letterheadFor(v, refs, db, engine), photos: await photosForDoc(db, engine, v.id, true) });
  if (!v.colibriFile) return { bytes: kva, merged: false, scan: null };
  const scan = (await db.blobs.get(`scan:${v.id}`))?.blob ?? (await engine.ensureScanBlob(v.id));
  if (!scan) return { bytes: kva, merged: false, scan: null };
  try {
    return { bytes: await appendScanPdf(kva, new Uint8Array(await scan.arrayBuffer()), `${doc.land === "ES" ? "Presupuesto + informe Colibri " : "Kostenvoranschlag + Colibri-Scan "}${v.kennzeichen ?? ""}`), merged: true, scan };
  } catch { return { bytes: kva, merged: false, scan }; }
}

export async function buildRepairReport(db: LocalDb, engine: SyncEngine, v: LocalVehicle, refs: Refs | undefined): Promise<Uint8Array> {
  return generateRepairPhotoReport(toDoc(v, refs), { letterhead: await letterheadFor(v, refs, db, engine), photos: await photosForDoc(db, engine, v.id, false) });
}

/** Share sheet with the file when the browser supports it, otherwise a download. Returns false when the user cancelled. */
export async function shareOrDownload(bytes: Uint8Array | Blob, fileName: string, mime: string, share?: { title?: string; text?: string }): Promise<boolean> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: mime });
  const file = new File([blob], fileName, { type: mime });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: share?.title ?? fileName, text: share?.text }); return true; }
  } catch (e) { if ((e as Error)?.name === "AbortError") return false; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

export { computeVehicle, kvaFileName, mailTexts };
export type { Settings };
