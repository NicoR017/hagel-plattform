import type { Mode } from "../field/route";

export interface ModeVehicle { statut: string; statutMotif?: string | null; stationId?: string | null }

/** "Wartet" because of parts belongs to the repair side, every other reason (approval, …) to the assessment side. */
const holdsForParts = (v: ModeVehicle) => v.statut === "attente" && String(v.statutMotif ?? "").trim().toLowerCase() === "teile";

/**
 * Which vehicles each mode shows:
 *  Kalkulation = Angekommen, Besichtigung, Wartet (Freigabe …), Abgelehnt (assessed, will not be repaired)
 *  Reparatur   = Reparatur, Wartet (Teile), Fertig
 *  Alle Fahrzeuge = everything, including Zurückgegeben
 */
export function inMode(v: ModeVehicle, mode: Mode): boolean {
  if (mode === "all") return true;
  if (mode === "kalk") return v.statut === "arrive" || v.statut === "besichtigung" || v.statut === "refuse" || (v.statut === "attente" && !holdsForParts(v));
  return v.statut === "reparatur" || v.statut === "fertig" || holdsForParts(v);
}

/** status filter chips of each mode (the "all" chip is always first) */
export const MODE_STATUSES: Record<Mode, string[]> = {
  kalk: ["arrive", "besichtigung", "attente", "refuse"],
  rep: ["reparatur", "attente", "fertig"],
  all: ["arrive", "besichtigung", "attente", "reparatur", "fertig", "rendu", "refuse"],
};

/** does a vehicle of this mode match a status chip? ("attente" is split by reason between the two modes) */
export const matchesChip = (v: ModeVehicle, mode: Mode, chip: string) => chip === "all" || (v.statut === chip && inMode(v, mode));

export interface StationCounts { kalk: number; rep: number; wait: number; present: number }
/** numbers on a station card (deleted vehicles are not on the phone): present = every status but "Zurückgegeben" (the occupancy itself is `rep`: cars in repair) */
export function stationCounts(vehicles: ModeVehicle[], stationId: string): StationCounts {
  const here = vehicles.filter((v) => v.stationId === stationId);
  return {
    kalk: here.filter((v) => inMode(v, "kalk") && v.statut !== "refuse").length,
    rep: here.filter((v) => v.statut === "reparatur").length,
    wait: here.filter((v) => v.statut === "attente").length,
    present: here.filter((v) => v.statut !== "rendu" && v.statut !== "refuse").length,
  };
}

export const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  arrive: { bg: "#EEF0F3", fg: "#3B4555" },
  besichtigung: { bg: "#E3ECFD", fg: "#1D4FB8" },
  attente: { bg: "#FDF0E1", fg: "#8A4A06" },
  reparatur: { bg: "#E2F3F6", fg: "#0B5F73" },
  fertig: { bg: "#E3F4EA", fg: "#17663F" },
  rendu: { bg: "#EEF0F3", fg: "#3B4555" },
  refuse: { bg: "#FBE9E7", fg: "#8F1D14" },
};
