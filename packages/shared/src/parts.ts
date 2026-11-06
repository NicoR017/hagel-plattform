/** Repair v2 (F2): spare parts of a car and the catalogue of generic part names by zone, in four languages. */
export const PART_SOURCES = ["assessment", "replace", "manual", "migrated"] as const;
export type PartSource = (typeof PART_SOURCES)[number];
/** status of a part (F3 adds the ordering steps); F2 only knows the first and "cancelled" */
export const PART_STATUSES = ["to_order", "cancelled"] as const;

/** Default zones = the elements of the car schema (exterior) and the interior areas; the admin can add more (stored). Names of the default ones are in the app dictionaries (`pn.<key>` / `zn.<key>`). */
export const EXTERIOR_ZONES = ["haube", "dach", "dachholm_l", "dachholm_r", "heck", "heck_u", "kfl_vl", "tuer_vl", "tuer_hl", "sw_hl", "kfl_vr", "tuer_vr", "tuer_hr", "sw_hr", "ws", "rs"] as const;
export const INTERIOR_ZONES = ["int_himmel", "int_verkleidung", "int_saeulen", "int_sonstige"] as const;
export const DEFAULT_ZONE_KEYS: readonly string[] = [...EXTERIOR_ZONES, ...INTERIOR_ZONES];
export const isInteriorZone = (k: string) => (INTERIOR_ZONES as readonly string[]).includes(k);

export interface PartNames { de: string; en: string; fr: string; es: string }
export type PartLang = keyof PartNames;
export interface ClientPart {
  id: string;
  /** zone (schema element) the part belongs to; null = not placed (older free-text parts) */
  zoneKey: string | null;
  catalogId: string | null;
  /** the name as written on the estimate (language of the car's country); free text when catalogId is null */
  name: string;
  qty: number;
  oemRef: string | null;
  source: string;
  status: string;
}
export interface ClientCatalogPart { id: string; names: PartNames; zoneKeys: string[]; validated: boolean }
export interface ClientCustomZone { key: string; group: "exterior" | "interior"; names: PartNames }
export interface ClientPartsRefs { zones: ClientCustomZone[]; catalog: ClientCatalogPart[] }
