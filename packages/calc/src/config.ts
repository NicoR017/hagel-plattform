import type { EsMatrix, Orientation, Settings } from "./types";
import bvat from "./data/bvat_aw_table_2025.json";
import esMatrixJson from "./data/es_matrix.json";
import panelsJson from "./data/panels.json";

export const SIZES = [10, 20, 30, 40, 50, 60, 70, 80] as const;

export interface PanelDef { key: string; de: string; es: string; short: string; orientation: Orientation }
export const PANELS: PanelDef[] = panelsJson as PanelDef[];
export const PANEL_MAP: Record<string, PanelDef> = Object.fromEntries(PANELS.map((p) => [p.key, p]));

export type AwTable = Record<string, Record<string, Record<string, number[]>>>;
export const BVAT_TABLE: AwTable = (bvat as { table: AwTable }).table;

export const ES_MATRIX_DEFAULT: EsMatrix = esMatrixJson as unknown as EsMatrix;

export interface TeilerVals { ruest: number; greif: number; finishPer: number; finishCap: number; hohl: number; verbr: number }
export function teilerVals(teiler: number): TeilerVals {
  return teiler === 12
    ? { ruest: 7, greif: 11, finishPer: 3.5, finishCap: 16, hohl: 5, verbr: 18 }
    : { ruest: 6, greif: 9, finishPer: 2.5, finishCap: 13, hohl: 4, verbr: 15 };
}

export const DEFAULT_SETTINGS: Settings = {
  rateDE: 83,
  rateES: 69,
  defaultTeiler: 10,
  vatDE: 0.19,
  esMatrix: ES_MATRIX_DEFAULT,
};

export const DEFAULT_DEMONTAGE_EUR = 150;
