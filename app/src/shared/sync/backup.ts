import { computeVehicle, type CalcVehicle, type Settings } from "@hagel/calc";
import { PANEL_KEYS } from "@hagel/colibri";
import type { HeaderFields } from "@hagel/shared";
import type { Refs } from "./db";
import { addPhoto, createVehicle, setColibri, setHeader, setPanel, setShares, setStatus, type MutCtx } from "./mutations";
import { uuid5 } from "./uuid";

/** v20 backup file: {app:"hes-hagel", version, created, vehicles[], customers[], settings{}, images{id: dataURL}, scans{vehicleId:{name,b64}}} */
export interface OldBackup {
  app: string; version?: string; created?: string;
  vehicles: Record<string, any>[]; customers?: { name: string; email?: string }[];
  settings?: Record<string, any>; images?: Record<string, string>; scans?: Record<string, { name: string; b64: string }>;
}

export function parseBackup(text: string): OldBackup | null {
  try {
    const d = JSON.parse(text);
    return d && d.app === "hes-hagel" && Array.isArray(d.vehicles) ? (d as OldBackup) : null;
  } catch { return null; }
}

export interface ImportOptions {
  stationId: string;
  /** customer used when the old customer name matches no carrosserie */
  fallbackClientId: string | null;
  replaceNewer: boolean;
}

export interface ImportPlanItem {
  oldId: string; newId: string; plate: string; customer: string; clientStationId: string | null; matched: boolean;
  duplicate: boolean; photos: number; scan: boolean; net: number;
}
export interface ImportPlan { items: ImportPlanItem[]; photos: number; scans: number; netSum: number; unmatched: string[] }

const norm = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Old panels (v20, also very old {count,size} format) → panel objects the server accepts. */
export function convertPanels(old: Record<string, any> | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, p] of Object.entries(old ?? {})) {
    if (!PANEL_KEYS.includes(key) || !p) continue;
    let dents: Record<string, number> = {};
    if (p.dents) for (const [k, n] of Object.entries(p.dents as Record<string, number>)) { if (+n > 0 && [10, 20, 30, 40, 50, 60, 70, 80].includes(+k)) dents[String(+k)] = Math.round(+n); }
    else if (p.count) dents = { [String(p.size || 20)]: Math.round(+p.count) };
    const big = Math.max(0, Math.round(+p.big || 0));
    if (!Object.keys(dents).length && !big) continue;
    const panel: Record<string, any> = { key, dents, big, bigEur: Math.max(0, +p.bigEur || 0), alu: !!p.alu, kleber: !!p.kleber, method: ["sanft", "ptp", "erneuern"].includes(p.method) ? p.method : "sanft", finish: p.finish !== undefined ? !!p.finish : true };
    if (p.awManual) { panel.awManual = true; panel.baseAW = p.baseAW ?? null; }
    out[key] = panel;
  }
  return out;
}

export function oldHeader(v: Record<string, any>): HeaderFields {
  const h: HeaderFields = {
    land: v.land === "ES" ? "ES" : "DE", kennzeichen: String(v.kennzeichen ?? ""), fin: String(v.fin ?? ""), modell: String(v.modell ?? ""),
    kunde: String(v.kunde ?? ""), kundeEmail: String(v.kundeEmail ?? ""), leistungsdatum: String(v.leistungsdatum ?? "").slice(0, 10),
    teiler: v.teiler === 12 ? 12 : 10, notiz: String(v.notiz ?? ""), zustand: Array.isArray(v.zustand) ? v.zustand.map(String) : [],
    greifzone: !!v.greifzone, hohlraum: !!v.hohlraum, verbringung: !!v.verbringung, demontage: !!v.demontage,
    logo: v.logo === "none" ? "none" : "pdr",
  };
  if (typeof v.stundensatz === "number") h.stundensatz = v.stundensatz;
  if (v.demontage && typeof v.demontageEur === "number") h.demontageEur = v.demontageEur;
  if (v.glass && typeof v.glass === "object") {
    const g: Record<string, { on?: boolean; eur?: number }> = {};
    for (const k of ["ws", "rs"]) if (v.glass[k]) g[k] = { on: !!v.glass[k].on, eur: Math.max(0, +v.glass[k].eur || 0) };
    if (Object.keys(g).length) h.glass = g;
  }
  return h;
}

export async function planImport(b: OldBackup, refs: Refs | undefined, existing: Set<string>, calc: Settings): Promise<ImportPlan> {
  const carros = (refs?.stations ?? []).filter((s) => s.type === "carrosserie");
  const items: ImportPlanItem[] = [];
  const unmatched = new Set<string>();
  for (const v of b.vehicles) {
    const m = carros.find((s) => norm(s.name) === norm(v.kunde));
    if (!m && v.kunde) unmatched.add(String(v.kunde));
    const newId = await uuid5(`vehicle:${v.id}`);
    const net = computeVehicle({ ...(v as object), land: v.land === "ES" ? "ES" : "DE", panels: convertPanels(v.panels) } as CalcVehicle, calc).netto;
    items.push({
      oldId: String(v.id), newId, plate: String(v.kennzeichen ?? ""), customer: String(v.kunde ?? ""), clientStationId: m?.id ?? null, matched: !!m,
      duplicate: existing.has(newId), photos: (v.images ?? []).filter((im: any) => b.images?.[im.id]).length, scan: !!(b.scans && b.scans[v.id]), net,
    });
  }
  return { items, photos: items.reduce((a, i) => a + i.photos, 0), scans: items.filter((i) => i.scan).length, netSum: items.reduce((a, i) => a + i.net, 0), unmatched: [...unmatched] };
}

const dataUrlToBlob = (u: string): Blob | null => {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(u);
  if (!m) return null;
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
};
const b64ToBuf = (s: string): ArrayBuffer => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

export interface ImportResult { created: number; skipped: number; updated: number; photos: number; scans: number; failed: string[] }

/** Writes the old vehicles through the normal queue (so the server checks every right), photos and scans included. */
export async function runImport(
  c: MutCtx, b: OldBackup, plan: ImportPlan, o: ImportOptions, canCommission: boolean, progress?: (i: number, n: number) => void,
): Promise<ImportResult> {
  const res: ImportResult = { created: 0, skipped: 0, updated: 0, photos: 0, scans: 0, failed: [] };
  for (let i = 0; i < plan.items.length; i++) {
    const it = plan.items[i];
    progress?.(i + 1, plan.items.length);
    const v = b.vehicles.find((x) => String(x.id) === it.oldId)!;
    try {
      const header = oldHeader(v);
      const shares = { techName: String(v.techName ?? ""), techPct: +v.techPct >= 0 ? +v.techPct : 50, demTechName: String(v.demTechName ?? ""), demTechPct: +v.demTechPct >= 0 ? +v.demTechPct : 100 };
      if (it.duplicate) {
        const existing = await c.db.vehicles.get(it.newId);
        const backupAt = Number(v.updatedAt ?? v.createdAt ?? 0);
        const existingAt = existing ? Date.parse(String(existing.updatedAt)) : 0;
        if (o.replaceNewer && backupAt > existingAt) {
          await setHeader(c, it.newId, header);
          for (const [k, p] of Object.entries(convertPanels(v.panels))) await setPanel(c, it.newId, k, p);
          await setShares(c, it.newId, shares);
          res.updated++;
        } else res.skipped++;
        continue;
      }
      await createVehicle(c, { id: it.newId, stationId: o.stationId, clientStationId: it.clientStationId ?? o.fallbackClientId, header, statut: "besichtigung" });
      for (const [k, p] of Object.entries(convertPanels(v.panels))) await setPanel(c, it.newId, k, p);
      await setShares(c, it.newId, shares);
      // v20 "workshop share" per vehicle is kept for the old settlements when the importer may edit commissions
      if (canCommission && (v.werkPct != null || v.werkMode)) await setShares(c, it.newId, { ...(v.werkMode === "staffel" ? { werkMode: "staffel" } : { werkMode: "pct" }), ...(+v.werkPct >= 0 ? { werkPct: +v.werkPct } : {}) });
      if (v.status === "reparatur") await setStatus(c, it.newId, "reparatur");
      for (const im of v.images ?? []) {
        const blob = b.images?.[im.id] ? dataUrlToBlob(b.images[im.id]) : null;
        if (!blob) continue;
        await addPhoto(c, { id: await uuid5(`image:${im.id}`), vehicleId: it.newId, blob, label: String(im.label ?? "Foto"), phase: v.status === "reparatur" ? "reparatur" : "besichtigung", takenAt: new Date(Number(v.createdAt) || Date.now()).toISOString() });
        res.photos++;
      }
      const sc = b.scans?.[v.id];
      if (sc && v.colibri) {
        const buf = b64ToBuf(sc.b64);
        await c.db.blobs.put({ key: `scan:${it.newId}`, blob: new Blob([buf], { type: "application/pdf" }), type: "application/pdf", size: buf.byteLength });
        await c.db.uploads.put({ key: `scan:${it.newId}`, kind: "scan", refId: it.newId, vehicleId: it.newId, orgId: c.orgId, tries: 0, nextTry: 0 });
        await setColibri(c, it.newId, { method: "", kunde: "", sprache: "", at: new Date().toISOString(), imported: +v.colibri.imported || 0, reportTotal: v.colibri.reportTotal ?? null, rowSum: +v.colibri.rowSum || 0, unknown: v.colibri.unknown ?? [] }, { name: sc.name, size: buf.byteLength });
        res.scans++;
      }
      res.created++;
    } catch (e) { res.failed.push(`${it.plate || it.oldId}: ${(e as Error).message}`); }
  }
  return res;
}
