// Global vehicle search (header field + results page): pure logic, no React. Works on the vehicles that are on the device, which are
// exactly the ones the user may see (the server only sends those), every station and every status, returned vehicles included.
import { onBoard } from "./boardLogic";
import type { Route } from "../field/route";

export interface SearchVehicle {
  id: string; statut: string; stationId?: string | null; clientStationId?: string | null; insurerId?: string | null; repairStage?: string | null;
  updatedAt?: string | null; [k: string]: unknown;
}
export interface SearchNames { station(id: string | null | undefined): string; insurer(id: string | null | undefined): string }

const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** plate / VIN / claim without spaces, hyphens or any other separator: "7731 KBR", "7731-kbr" and "7731kbr" are the same */
export const compact = (x: unknown) => fold(String(x ?? "")).replace(/[^a-z0-9]/g, "");
const str = (x: unknown) => String(x ?? "");

/** everything a search may hit, lower case and without accents; plate, VIN and claim number also in their compact form */
export function haystack(v: SearchVehicle, n: SearchNames): string {
  const src = (v.colibriSource ?? null) as { businessCustomer?: string } | null;
  const text = [v.kennzeichen, v.fin, v.claimNumber, v.modell, n.insurer(v.insurerId), v.kunde, n.station(v.clientStationId), n.station(v.stationId), v.techName, v.demTechName, src?.businessCustomer].map(str).join(" ");
  return `${fold(text)} ${compact(v.kennzeichen)} ${compact(v.fin)} ${compact(v.claimNumber)}`;
}

/** every word typed must be found (any order); a word that is a plate written with spaces or hyphens still finds it */
export function searchVehicles<T extends SearchVehicle>(list: readonly T[], q: string, n: SearchNames): T[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const whole = compact(q);
  const hits = list.filter((v) => {
    const h = haystack(v, n);
    return words.every((w) => h.includes(w) || (compact(w).length >= 2 && h.includes(compact(w)))) || (whole.length >= 3 && [compact(v.kennzeichen), compact(v.fin), compact(v.claimNumber)].some((c) => c.includes(whole)));
  });
  const starts = (v: T) => (compact(v.kennzeichen).startsWith(whole) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b) || str(b.updatedAt).localeCompare(str(a.updatedAt)));
}

/** where a tap on a result goes: the repair detail when the car is on the repair board, else the vehicle detail in the "all vehicles" context of its own station */
export function routeOfHit(v: SearchVehicle): Route {
  if (v.stationId && onBoard(v)) return { page: "repair", id: v.id, tab: "uebersicht", stationId: v.stationId };
  return v.stationId ? { page: "vehicle", id: v.id, tab: "basis", ctx: { stationId: v.stationId, mode: "all" } } : { page: "vehicle", id: v.id, tab: "basis" };
}
