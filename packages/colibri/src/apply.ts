import { colibriDate, type ColibriParse } from "./parse";

export interface VehiclePanel {
  key: string;
  dents: Record<string, number>;
  big: number;
  bigEur: number;
  alu: boolean;
  kleber: boolean;
  method: string;
  finish: boolean;
  [k: string]: unknown;
}
export interface ColibriMeta {
  method: string; kunde: string; sprache: string; at: string;
  imported: number; reportTotal: number | null; rowSum: number; unknown: string[];
}
export interface ColibriVehicle {
  kennzeichen?: string;
  fin?: string;
  modell?: string;
  leistungsdatum?: string;
  panels: Record<string, Partial<VehiclePanel>>;
  colibri?: ColibriMeta;
  [k: string]: unknown;
}

export const PANEL_KEYS = [
  "haube", "dach", "dachholm_l", "dachholm_r", "heck", "heck_u", "kfl_vl", "tuer_vl", "tuer_hl", "sw_hl",
  "kfl_vr", "tuer_vr", "tuer_hr", "sw_hr",
];

export function titleCase(s: string): string {
  return String(s || "").toLowerCase().replace(/(^|[\s-])([a-zäöü])/g, (_a, b, c) => b + c.toUpperCase());
}

/** v20 apply rules (pure: returns a new vehicle). `now` is injectable for tests. */
export function applyColibri<V extends ColibriVehicle>(v: V, res: ColibriParse, now: Date = new Date()): V & ColibriVehicle {
  const h = res.head || {};
  const out: V & ColibriVehicle = { ...v, panels: { ...v.panels } };
  if (h.kennzeichen) out.kennzeichen = h.kennzeichen.toUpperCase();
  if (h.fin) {
    const f = h.fin.toUpperCase().replace(/\s/g, "");
    if (/^[A-Z0-9]{11,17}$/.test(f)) out.fin = f;
  }
  const marke = (h.marke || "").split("-")[0], modell = h.modell || "";
  if (marke || modell) out.modell = (titleCase(marke) + " " + titleCase(modell)).trim();
  const dt = colibriDate(h.datum);
  if (dt) out.leistungsdatum = dt;
  Object.keys(res.panels).forEach((key) => {
    if (!PANEL_KEYS.includes(key)) return;
    const src = res.panels[key];
    const old = (out.panels[key] || {}) as Partial<VehiclePanel>;
    const np: VehiclePanel = {
      key,
      dents: src.dents,
      big: src.big || 0,
      bigEur: old.bigEur || 0,
      alu: !!old.alu,
      kleber: key === "dachholm_l" || key === "dachholm_r" ? true : !!old.kleber,
      method: old.method || "sanft",
      finish: old.finish !== undefined ? old.finish : true,
    };
    const tot = Object.values(src.dents).reduce((a, b) => a + b, 0);
    if (tot > 0 || np.big > 0) out.panels[key] = np;
    else delete out.panels[key];
  });
  out.colibri = {
    method: h.method || "", kunde: h.kunde || "", sprache: h.sprache || "", at: now.toISOString(),
    imported: res.imported || 0, reportTotal: res.reportTotal, rowSum: res.rowSum || 0, unknown: res.unknown || [],
  };
  return out;
}

/** "Scan ✓" when the imported count equals the report total and nothing was unknown. */
export function scanCheck(c: ColibriMeta, dentsTotalNumber?: number | null): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (c.reportTotal != null && c.imported !== c.reportTotal) reasons.push(`imported ${c.imported} ≠ report ${c.reportTotal}`);
  if (c.reportTotal == null) reasons.push("no report total found");
  if (c.unknown.length) reasons.push(`${c.unknown.length} unknown component(s)`);
  if (dentsTotalNumber != null && c.imported !== dentsTotalNumber) reasons.push(`imported ${c.imported} ≠ DentsTotalNumber ${dentsTotalNumber}`);
  return { ok: reasons.length === 0, reasons };
}
