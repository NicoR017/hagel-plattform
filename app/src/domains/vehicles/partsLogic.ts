// Spare parts of a car (F2): pure helpers shared by the element sheet, the parts box, the estimate and the admin page.
import { DEFAULT_ZONE_KEYS, EXTERIOR_ZONES, INTERIOR_ZONES, isInteriorZone, type ClientCatalogPart, type ClientCustomZone, type ClientPart, type ClientPartsRefs, type PartLang, type PartNames } from "@hagel/shared";
import { PANEL_MAP } from "@hagel/calc";
import { getLang, t, tIn, tOr } from "../../shared/i18n";

/** the language a car's documents are in: Spanish cars are Spanish, the others German */
export const landLang = (v: { land?: unknown }): PartLang => (v.land === "ES" ? "es" : "de");

/** the part names in a language (falls back to the first one that is filled in) */
export const nameIn = (n: PartNames, lang: PartLang): string => n[lang] || n.de || n.en || n.es || n.fr || "";

export const partsOfVehicle = (v: { parts?: ClientPart[] }): ClientPart[] => (Array.isArray(v.parts) ? v.parts.filter((p) => p.status !== "cancelled") : []);

/** has the car its parts list (a user without the right to see parts, or an older server, has not: then the old header list is all there is) */
export const hasPartsList = (v: { parts?: ClientPart[] }) => Array.isArray(v.parts);

/** the labels printed on the estimate: "name × 2" */
export function partLabels(v: { parts?: ClientPart[]; partsToReplace?: unknown }): string[] {
  if (hasPartsList(v)) return partsOfVehicle(v).map((p) => (p.qty > 1 ? `${p.name} × ${p.qty}` : p.name));
  return Array.isArray(v.partsToReplace) ? v.partsToReplace.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
}

/** name of a zone in the language of the user */
export function zoneLabel(key: string, custom: ClientCustomZone[] = []): string {
  const c = custom.find((z) => z.key === key);
  if (c) return nameIn(c.names, getLang());
  if (key === "ws") return t("windscreen");
  if (key === "rs") return t("rearWindow");
  if (isInteriorZone(key)) return tOr("zn." + key, key);
  return tOr("pn." + key, PANEL_MAP[key]?.de ?? key);
}

export interface ZoneItem { key: string; label: string; group: "exterior" | "interior"; custom: boolean }
/** every zone (default + added by the admin), exterior first */
export function allZones(refs: ClientPartsRefs | undefined): ZoneItem[] {
  const custom = refs?.zones ?? [];
  const mk = (key: string, group: "exterior" | "interior", isCustom: boolean): ZoneItem => ({ key, group, custom: isCustom, label: zoneLabel(key, custom) });
  return [
    ...EXTERIOR_ZONES.map((k) => mk(k, "exterior", false)), ...custom.filter((z) => z.group === "exterior").map((z) => mk(z.key, "exterior", true)),
    ...INTERIOR_ZONES.map((k) => mk(k, "interior", false)), ...custom.filter((z) => z.group === "interior").map((z) => mk(z.key, "interior", true)),
  ];
}
export const isKnownZone = (refs: ClientPartsRefs | undefined, key: string) => DEFAULT_ZONE_KEYS.includes(key) || !!refs?.zones.some((z) => z.key === key);

/** the catalogue parts of one zone */
export const catalogOfZone = (refs: ClientPartsRefs | undefined, zone: string): ClientCatalogPart[] => (refs?.catalog ?? []).filter((c) => c.zoneKeys.includes(zone));

/** name of a replaced element as the part line shows it: "Capó · panel" in the language of the car (the name is a snapshot, written when the part is added) */
export const replacePartName = (zone: string, lang: PartLang): string => {
  const base = tIn(lang, ("pn." + zone) as never) || PANEL_MAP[zone]?.de || zone;
  return `${base} · ${lang === "es" ? "panel" : "Blech"}`;
};
/** name of a catalogue part on the estimate of a car */
export const catalogPartName = (c: ClientCatalogPart, v: { land?: unknown }): string => nameIn(c.names, landLang(v));
