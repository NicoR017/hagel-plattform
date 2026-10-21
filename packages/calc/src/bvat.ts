import { BVAT_TABLE, DEFAULT_AW_PARAMS, PANEL_MAP, SIZES } from "./config";
import type { AwParams, Dents, Orientation, Panel, PanelBollos, PanelStats } from "./types";

export function getDents(p: Panel | undefined): Dents {
  return p && p.dents ? p.dents : {};
}

export function panelStats(p: Panel): PanelStats {
  const d = getDents(p);
  let total = 0, w = 0;
  for (const s of SIZES) { const n = d[String(s)] || 0; total += n; w += s * n; }
  const avgX = total ? w / total : 0;
  const avgClass = total ? Math.min(80, Math.max(10, Math.ceil(avgX / 10) * 10)) : 0;
  return { total, avgX, avgClass };
}

/** ≤30 mm = 1 bollo; >30 mm (40–80 and >85 mm) = 2 bollos. */
export function panelBollos(p: Panel): PanelBollos {
  const d = getDents(p);
  let small = 0, large = 0;
  for (const sz of SIZES) { const n = +(d[String(sz)] || 0); if (sz <= 30) small += n; else large += n; }
  large += +(p.big || 0);
  return { small, large, bollos: small + 2 * large };
}

export function lookupAW(teiler: number, orient: Orientation, count: number, sizeClass: number): number {
  const tbl = BVAT_TABLE[String(teiler)]?.[orient];
  const idx = (SIZES as readonly number[]).indexOf(sizeClass);
  if (!tbl || idx < 0 || count <= 0) return 0;
  const keys = Object.keys(tbl).map(Number).sort((a, b) => a - b);
  const val = (k: number) => { const r = tbl[String(k)]; return idx < r.length ? r[idx] : r[r.length - 1]; };
  if (count <= keys[0]) return val(keys[0]);
  if (count >= keys[keys.length - 1]) return val(keys[keys.length - 1]);
  let lo = keys[0], hi = keys[keys.length - 1];
  for (const k of keys) if (k <= count) lo = k;
  for (let i = keys.length - 1; i >= 0; i--) if (keys[i] >= count) hi = keys[i];
  if (lo === hi) return val(lo);
  const vl = val(lo), vh = val(hi);
  return Math.round(vl + ((vh - vl) * (count - lo)) / (hi - lo));
}

export function panelBaseAW(p: Panel, teiler: number): number {
  const st = panelStats(p);
  if (!st.total) return 0;
  if (p.awManual && p.baseAW != null) return p.baseAW;
  return lookupAW(teiler, PANEL_MAP[p.key].orientation, st.total, st.avgClass);
}

export function panelRepairAW(p: Panel, teiler: number, aw_: AwParams = DEFAULT_AW_PARAMS): number {
  const st = panelStats(p);
  if (!st.total || p.method === "erneuern") return 0;
  let aw = panelBaseAW(p, teiler);
  if (p.alu) aw *= aw_.aluFactor;
  if (p.kleber) aw *= aw_.kleberFactor;
  if (p.method === "ptp") aw *= aw_.ptpFactor;
  return Math.round(aw * 100) / 100;
}
