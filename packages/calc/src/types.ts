export type Land = "DE" | "ES";
export type Method = "sanft" | "ptp" | "erneuern";
export type Orientation = "waagrecht" | "senkrecht";
export type Dents = Partial<Record<string, number>>;

export interface Panel {
  key: string;
  dents?: Dents;
  big?: number;
  bigEur?: number;
  alu?: boolean;
  kleber?: boolean;
  method?: Method;
  finish?: boolean;
  awManual?: boolean;
  baseAW?: number | null;
}

export interface GlassItem { on?: boolean; eur?: number }

export interface CalcVehicle {
  land?: Land;
  teiler?: number;
  stundensatz?: number | null;
  panels?: Record<string, Panel>;
  demontage?: boolean;
  demontageEur?: number | null;
  glass?: { ws?: GlassItem; rs?: GlassItem };
  greifzone?: boolean;
  hohlraum?: boolean;
  verbringung?: boolean;
}

export interface PanelStats { total: number; avgX: number; avgClass: number }
export interface PanelBollos { small: number; large: number; bollos: number }

export interface EsCategory { cat: string; from: number; to: number | null; cap_h: number }
export interface EsKickbackRule { max_h?: number; lt_h?: number; else?: boolean; eur: number }
export interface EsMatrix {
  rate_eur_per_h: number;
  knots: [number, number][];
  categories: EsCategory[];
  kickback_eur: EsKickbackRule[];
  adjustments: {
    alu_per_vehicle_h: number;
    erneuern_per_panel_h: number;
    kleber_share_pct: number;
    ptp_share_pct: number;
  };
  demontage_presets_eur: Record<string, number>;
  vat: number;
}

export interface EsAdjustment {
  de: string;
  es: string;
  h: number;
  kleber?: boolean;
  ptp?: boolean;
  key?: string;
}

export interface EsHours { h: number; raw: number; seg: [number, number, number, number] | null }

export interface EsResult {
  small: number;
  large: number;
  bollos: number;
  cat: EsCategory;
  H: EsHours;
  adj: EsAdjustment[];
  adjH: number;
  totH: number;
  rate: number;
  matrixEur: number;
  cap: number;
  kb: number;
}

export interface CalcPanel extends Panel, PanelStats, PanelBollos { repair: number }

export interface GlassLine { k: "ws" | "rs"; de: string; es: string; eur: number }

export interface CalcResult {
  land: Land;
  es?: EsResult;
  panels: CalcPanel[];
  repairAW: number;
  finishAW: number;
  ruestAW: number;
  greifAW: number;
  hohlAW: number;
  verbrAW: number;
  totalAW: number;
  awNetto: number;
  repairEur: number;
  kleberMat: number;
  hohlMat: number;
  bigCount: number;
  bigEur: number;
  demEur: number;
  glass: GlassLine[];
  glassEur: number;
  netto: number;
  brutto: number;
  vat: number;
  euroPerAW: number;
  dents: number;
  avg: number;
  panelCount: number;
  kleberN: number;
}

export interface Settings {
  rateDE: number;
  rateES: number;
  defaultTeiler: number;
  vatDE: number;
  esMatrix: EsMatrix;
}

export interface SharesInput {
  techPct?: number | null;
  werkMode?: "pct" | "staffel" | null;
  werkPct?: number | null;
  demTechPct?: number | null;
  techName?: string;
  demTechName?: string;
}
export interface SharesDefaults { techPct: number; werkPct: number; werkMode: "pct" | "staffel"; demTechPct: number }
export interface SharesResult {
  basis: number; pdrBasis: number; demEur: number; werkMode: "pct" | "staffel"; werkPct: number; werkEur: number;
  techName: string; techPct: number; techEur: number;
  demTechName: string; demTechPct: number; demTechEur: number; rest: number;
}

/** Parameters of the `aw` (BVAT) engine. */
export interface AwParams {
  vat: number;
  /** multipliers applied to the panel AW: aluminium, Klebetechnik, Push-to-Paint */
  aluFactor: number;
  kleberFactor: number;
  ptpFactor: number;
  /** fixed extras per Teiler (key "10" / "12") */
  extras: Record<string, { ruest: number; greif: number; finishPer: number; finishCap: number; hohl: number; verbr: number }>;
  /** Kleber material lump sum by number of glued panels (1-2, 3-5, more) */
  kleberMaterial: { upTo2: number; upTo5: number; more: number };
  hohlraumMaterial: number;
}

/** A calculation method (one version of it): engine + parameters. Nothing else is programmable. */
export type CalcMethodDef =
  | { engine: "aw"; params: AwParams }
  | { engine: "matrix"; params: { esMatrix: EsMatrix | null } };
