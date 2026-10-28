import { DEFAULT_AW_PARAMS, DEFAULT_DEMONTAGE_EUR, DEFAULT_SETTINGS, ES_MATRIX_DEFAULT } from "./config";
import { panelBollos, panelRepairAW, panelStats } from "./bvat";
import { adjustmentLabels, esCat, esHours, esKickback } from "./es";
import type {
  AwParams, CalcMethodDef, CalcPanel, CalcResult, CalcVehicle, EsAdjustment, GlassLine, Land, Settings, SharesDefaults, SharesInput, SharesResult,
} from "./types";

export const r2 = (x: number) => Math.round(x * 100) / 100;

export function vehicleLand(v: CalcVehicle): Land { return v.land || "DE"; }
export function vatOf(v: CalcVehicle, s: Settings = DEFAULT_SETTINGS): number {
  return vehicleLand(v) === "ES" ? s.esMatrix.vat : s.vatDE;
}
export function vehicleSettings(v: CalcVehicle, s: Settings = DEFAULT_SETTINGS) {
  return {
    teiler: v.teiler ? v.teiler : s.defaultTeiler || 10,
    stundensatz: v.stundensatz != null ? v.stundensatz : vehicleLand(v) === "ES" ? s.rateES : s.rateDE,
  };
}

function demEurOf(v: CalcVehicle): number {
  return v.demontage ? Math.max(0, +(v.demontageEur != null ? v.demontageEur : DEFAULT_DEMONTAGE_EUR) || 0) : 0;
}

export const GLASS = [
  { k: "ws" as const, de: "Windschutzscheibe erneuern", es: "Sustituir parabrisas" },
  { k: "rs" as const, de: "Heckscheibe erneuern", es: "Sustituir luna trasera" },
];
export function glassList(v: CalcVehicle): GlassLine[] {
  const g = v.glass || {};
  return GLASS.filter((x) => g[x.k] && g[x.k]!.on).map((x) => ({ ...x, eur: Math.max(0, +(g[x.k]!.eur || 0)) }));
}

function activePanels(v: CalcVehicle, teiler: number | null, aw: AwParams = DEFAULT_AW_PARAMS): CalcPanel[] {
  return Object.values(v.panels || {})
    .map((p) => ({
      ...p,
      ...panelStats(p),
      ...panelBollos(p),
      repair: teiler == null ? 0 : panelRepairAW(p, teiler, aw),
    }))
    .filter((p) => p.total > 0 || (p.big || 0) > 0);
}

export function computeDE(v: CalcVehicle, s: Settings = DEFAULT_SETTINGS, aw: AwParams = DEFAULT_AW_PARAMS): CalcResult {
  const vs = vehicleSettings(v, s);
  const t = aw.extras[String(vs.teiler === 12 ? 12 : 10)], euroPerAW = vs.stundensatz / vs.teiler;
  const panels = activePanels(v, vs.teiler, aw);
  const repairAW = panels.reduce((a, p) => a + p.repair, 0);
  const finishN = panels.filter((p) => p.finish && p.method !== "erneuern" && p.total > 0).length;
  const finishAW = Math.min(t.finishPer * finishN, t.finishCap);
  const ruestAW = panels.length > 0 ? t.ruest : 0;
  const greifAW = v.greifzone ? t.greif : 0, hohlAW = v.hohlraum ? t.hohl : 0, verbrAW = v.verbringung ? t.verbr : 0;
  const totalAW = repairAW + finishAW + ruestAW + greifAW + hohlAW + verbrAW;
  const awNetto = totalAW * euroPerAW;
  const kleberN = panels.filter((p) => p.kleber).length;
  const km = aw.kleberMaterial;
  const kleberMat = kleberN === 0 ? 0 : kleberN <= 2 ? km.upTo2 : kleberN <= 5 ? km.upTo5 : km.more;
  const hohlMat = v.hohlraum ? aw.hohlraumMaterial : 0;
  const bigCount = panels.reduce((a, p) => a + (p.big || 0), 0);
  const bigEur = panels.reduce((a, p) => a + (+(p.bigEur || 0)), 0);
  const demEur = demEurOf(v);
  const dents = panels.reduce((a, p) => a + p.total, 0);
  const avg = dents ? Math.round(panels.reduce((a, p) => a + p.avgX * p.total, 0) / dents) : 0;
  return withGlass({
    land: "DE", panels, repairAW, finishAW, ruestAW, greifAW, hohlAW, verbrAW, totalAW, awNetto,
    repairEur: repairAW * euroPerAW, kleberMat, hohlMat, bigCount, bigEur, demEur,
    netto: awNetto + kleberMat + hohlMat + bigEur + demEur, vat: aw === DEFAULT_AW_PARAMS ? vatOf(v, s) : aw.vat, euroPerAW, dents, avg,
    panelCount: panels.length, kleberN, glass: [], glassEur: 0, brutto: 0,
  }, v);
}

export function computeES(v: CalcVehicle, s: Settings = DEFAULT_SETTINGS): CalcResult {
  const m = s.esMatrix;
  const rate = +vehicleSettings(v, s).stundensatz || 0;
  const panels = activePanels(v, null);
  const small = panels.reduce((a, p) => a + p.small, 0);
  const large = panels.reduce((a, p) => a + p.large, 0);
  const bollos = small + 2 * large;
  const cat = esCat(m, bollos), H = esHours(m, bollos);
  const adj: EsAdjustment[] = [];
  for (const p of panels.filter((p) => p.method === "erneuern")) {
    adj.push({ ...adjustmentLabels("erneuern", p.key, m), h: m.adjustments.erneuern_per_panel_h });
  }
  const kShare = m.adjustments.kleber_share_pct / 100, pShare = Math.abs(m.adjustments.ptp_share_pct) / 100;
  for (const p of panels.filter((p) => p.kleber && p.method !== "erneuern" && p.bollos > 0 && bollos > 0)) {
    const h = Math.round(((H.h * p.bollos) / bollos) * kShare * 100) / 100;
    if (h > 0) adj.push({ ...adjustmentLabels("kleber", p.key, m), h, kleber: true, key: p.key });
  }
  for (const p of panels.filter((p) => p.method === "ptp" && p.bollos > 0 && bollos > 0)) {
    const h = -Math.round(((H.h * p.bollos) / bollos) * (p.kleber ? 1.3 : 1) * pShare * 100) / 100;
    if (h < 0) adj.push({ ...adjustmentLabels("ptp", p.key, m), h, ptp: true, key: p.key });
  }
  if (panels.some((p) => p.alu && p.method !== "erneuern")) {
    adj.push({ de: "Aluminiumteile", es: "Piezas de aluminio", h: m.adjustments.alu_per_vehicle_h });
  }
  const adjH = adj.reduce((a, x) => a + x.h, 0);
  const totH = bollos > 0 ? Math.max(0, H.h + adjH) : 0;
  const matrixEur = H.h * rate, awNetto = totH * rate;
  const demEur = demEurOf(v);
  const sumTotal = panels.reduce((a, p) => a + p.total, 0);
  const bigCount = panels.reduce((a, p) => a + (+(p.big || 0)), 0);
  const dents = sumTotal + bigCount;
  const avg = dents ? Math.round(panels.reduce((a, p) => a + p.avgX * p.total, 0) / Math.max(1, sumTotal)) : 0;
  return withGlass({
    land: "ES",
    es: { small, large, bollos, cat, H, adj, adjH, totH, rate, matrixEur, cap: cat.cap_h * rate, kb: bollos > 0 ? esKickback(m, H.h) : 0 },
    panels, repairAW: H.h, finishAW: 0, ruestAW: 0, greifAW: 0, hohlAW: 0, verbrAW: 0, totalAW: totH, awNetto,
    repairEur: matrixEur, kleberMat: 0, hohlMat: 0, bigCount, bigEur: 0,
    demEur, netto: awNetto + demEur, vat: vatOf(v, s), euroPerAW: rate, dents, avg, panelCount: panels.length, kleberN: 0,
    glass: [], glassEur: 0, brutto: 0,
  }, v);
}

function withGlass(c: CalcResult, v: CalcVehicle): CalcResult {
  c.glass = glassList(v);
  c.glassEur = c.glass.reduce((a, x) => a + x.eur, 0);
  c.netto += c.glassEur;
  c.brutto = c.netto * (1 + c.vat);
  return c;
}

/**
 * `method` = the (versioned) calculation method frozen on the vehicle. Without a method, or with one whose engine does not
 * fit the vehicle's country, the historical behaviour applies (organisation settings + built-in tables).
 */
export function computeVehicle(v: CalcVehicle, s: Settings = DEFAULT_SETTINGS, method?: CalcMethodDef | null): CalcResult {
  if (vehicleLand(v) === "ES") {
    // a Spanish method brings its own matrix (null = the built-in one), never the live organisation settings: that is what freezes an estimate
    if (method?.engine === "matrix") return computeES(v, { ...s, esMatrix: method.params.esMatrix ?? ES_MATRIX_DEFAULT });
    return computeES(v, s);
  }
  return method?.engine === "aw" ? computeDE(v, s, method.params) : computeDE(v, s);
}

export const SHARES_DEFAULTS: SharesDefaults = { techPct: 50, werkPct: 25, werkMode: "pct", demTechPct: 100 };

/**
 * Internal split (never on the customer document).
 * `werkPct` / `werkMode` is the carrosserie commission (snapshotted from the customer site in v2).
 */
export function computeShares(
  v: SharesInput,
  c: Pick<CalcResult, "netto" | "glassEur" | "demEur" | "es">,
  d: SharesDefaults = SHARES_DEFAULTS,
): SharesResult {
  const techPct = v.techPct != null ? +v.techPct : d.techPct;
  const werkMode = v.werkMode || d.werkMode;
  const werkPct = v.werkPct != null ? +v.werkPct : d.werkPct;
  const demTechPct = v.demTechPct != null ? +v.demTechPct : d.demTechPct;
  const demEur = c.demEur || 0;
  const basis = Math.max(0, c.netto - (c.glassEur || 0));
  const pdrBasis = Math.max(0, basis - demEur);
  const werkEur = werkMode === "staffel" ? (c.es ? c.es.kb : 0) : (basis * werkPct) / 100;
  const techEur = (pdrBasis * techPct) / 100;
  const demTechEur = (demEur * demTechPct) / 100;
  return {
    basis, pdrBasis, demEur, werkMode,
    werkPct: werkMode === "staffel" ? (basis ? (werkEur / basis) * 100 : 0) : werkPct,
    werkEur, techName: v.techName || "", techPct, techEur,
    demTechName: demEur > 0 ? v.demTechName || v.techName || "" : "", demTechPct, demTechEur,
    rest: basis - werkEur - techEur - demTechEur,
  };
}
