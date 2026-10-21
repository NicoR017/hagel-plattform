import type { CalcMethodDef, CalcVehicle, Land } from "@hagel/calc";

export type VehicleStatus = "arrive" | "besichtigung" | "attente" | "reparatur" | "fertig" | "rendu";
export type PhotoPhase = "besichtigung" | "reparatur" | "fertig";

export interface ColibriInfo {
  imported?: number | null;
  reportTotal?: number | null;
  rowSum?: number | null;
  unknown?: string[];
}

/** Mirrors the v20 vehicle JSON (+ v2 fields). */
export interface DocVehicle extends CalcVehicle {
  id: string;
  land: Land;
  kennzeichen?: string;
  fin?: string;
  modell?: string;
  /** v2: the customer is a carrosserie (name). */
  kunde?: string;
  kundeEmail?: string;
  /** YYYY-MM-DD */
  leistungsdatum?: string;
  notiz?: string;
  zustand?: string[];
  techName?: string;
  techPct?: number | null;
  demTechName?: string;
  demTechPct?: number | null;
  /** v2: carrosserie commission snapshot. */
  werkPct?: number | null;
  werkMode?: "pct" | "staffel" | null;
  status?: VehicleStatus | string;
  colibri?: ColibriInfo | null;
  /** Truthy when a Colibri scan PDF is attached (mail text mentions it). */
  colibriFile?: unknown;
  stationName?: string;
  insurerName?: string;
  claimNumber?: string;
  /** labels of the parts to replace (no prices): printed in a box on the KVA, in the text KVA and in the photo report header */
  partsToReplace?: string[];
  /** name of the calculation method, printed small on the KVA (the caller leaves out brand names the letterhead must not show) */
  methodName?: string;
  /** the calculation method frozen on the vehicle (spreadsheet totals use it, like the screen does) */
  method?: CalcMethodDef | null;
}

export interface DocPhoto {
  label: string;
  /** JPEG bytes */
  bytes: Uint8Array;
  inPdf: boolean;
  phase?: PhotoPhase;
  /** ISO timestamp, shown in the repair photo report */
  takenAt?: string;
}

export interface LetterheadLogo { bytes: Uint8Array; kind: "jpg" | "png"; width: number; height: number }

export interface Letterhead {
  name: string;
  logo?: LetterheadLogo;
  address?: string;
  taxId?: string;
  email?: string;
  footer?: string;
}

export interface KvaOptions {
  letterhead?: Letterhead | null;
  photos?: DocPhoto[];
  /** Injected clock (PDF metadata). Default: new Date() */
  now?: Date;
}

export interface RepairReportOptions {
  letterhead?: Letterhead | null;
  photos: DocPhoto[];
  /** the estimate's amounts (net, VAT, gross), printed under the header: for insurers and body shops. Never the internal split. */
  amounts?: { netto: number; mwst: number; brutto: number };
  now?: Date;
  /** IANA zone used to render `takenAt`; default Europe/Madrid (ES) / Europe/Berlin (DE) */
  timeZone?: string;
}

export interface XlsxColumns { prices: boolean; internalSplit: boolean }
export interface ExportVehicle extends DocVehicle {}
