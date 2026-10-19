import { PANEL_MAP } from "./config";
import type { EsAdjustment, EsCategory, EsHours, EsMatrix } from "./types";

export function esCat(m: EsMatrix, n: number): EsCategory {
  for (const c of m.categories) if (c.to === null || n <= c.to) return c;
  return m.categories[m.categories.length - 1];
}

/** Base hours from bollos: interpolate between knots, round UP to 0.5 h. */
export function esHours(m: EsMatrix, n: number): EsHours {
  const kn = m.knots;
  const first = kn[0], last = kn[kn.length - 1];
  if (n <= 0) return { h: 0, raw: 0, seg: null };
  if (n <= first[0]) return { h: first[1], raw: first[1], seg: null };
  if (n >= last[0]) return { h: last[1], raw: last[1], seg: [kn[kn.length - 2][0], kn[kn.length - 2][1], last[0], last[1]] };
  for (let i = 1; i < kn.length; i++) {
    const [b0, h0] = kn[i - 1], [b1, h1] = kn[i];
    if (n <= b1) {
      const raw = h0 + ((n - b0) / (b1 - b0)) * (h1 - h0);
      return { h: Math.ceil(raw * 2 - 1e-9) / 2, raw, seg: [b0, h0, b1, h1] };
    }
  }
  return { h: last[1], raw: last[1], seg: null };
}

export function esKickback(m: EsMatrix, h: number): number {
  for (const r of m.kickback_eur) {
    if (r.max_h !== undefined && h <= r.max_h) return r.eur;
    if (r.lt_h !== undefined && h < r.lt_h) return r.eur;
    if (r.else) return r.eur;
  }
  return 0;
}

const labelDe = (key: string) => PANEL_MAP[key].de;
const labelEs = (key: string) => PANEL_MAP[key].es || PANEL_MAP[key].de;

export function adjustmentLabels(kind: "erneuern" | "kleber" | "ptp", key: string, m: EsMatrix): Pick<EsAdjustment, "de" | "es"> {
  const kp = Math.abs(m.adjustments.kleber_share_pct), pp = Math.abs(m.adjustments.ptp_share_pct);
  if (kind === "erneuern") {
    return key === "haube"
      ? { de: "Motorhaube ersetzt", es: "Capó sustituido" }
      : { de: "Ersetzt/Lackierung: " + labelDe(key), es: "Pieza sustituida / a pintura: " + labelEs(key) };
  }
  if (kind === "kleber") {
    return { de: `Klebetechnik (+${kp} %): ` + labelDe(key), es: `Técnica de adhesivo (+${kp} %): ` + labelEs(key) };
  }
  return {
    de: `Vordrücken zur Lackierung (−${pp} %): ` + labelDe(key),
    es: `Desabollado previo a pintura (Push to Paint, −${pp} %): ` + labelEs(key),
  };
}
