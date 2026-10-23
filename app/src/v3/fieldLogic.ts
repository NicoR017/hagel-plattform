// Pure logic of the field interface (technician / headliner): which cars are his, what he has to do on each panel,
// which move he may make and whether he has taken the photo that move needs. No React, no prices.
import { panelStats, type Panel } from "@hagel/calc";
import { stageOf } from "./boardLogic";

export type FieldKind = "pdr" | "headliner";
export type Intervention = "pdr" | "ptp" | "replace";

export interface FieldVehicle {
  id: string; statut: string; stationId?: string | null; repairStage?: string | null;
  panels?: Record<string, unknown>; myAssign?: ("pdr" | "demontage")[]; myEarn?: { pdr: { eur: number; pct: number } | null; dem: { eur: number; pct: number } | null; eur: number };
  [k: string]: unknown;
}

/** what is done to a panel: replaced (red), push to paint (orange), PDR (green: it has dents), nothing (grey) */
export function interventionOf(p: Partial<Panel> | undefined): Intervention | null {
  if (!p) return null;
  if (p.method === "erneuern") return "replace";
  if (p.method === "ptp") return "ptp";
  return panelStats({ key: p.key ?? "", ...p } as Panel).total > 0 ? "pdr" : null;
}

export interface FieldPanel { key: string; kind: Intervention; dents: number; avgX: number; avgClass: number; big: number; alu: boolean; glue: boolean; method: string; sizes: [string, number][] }
/** the panels that have something to do, replaced ones included */
export function fieldPanels(v: Pick<FieldVehicle, "panels">): FieldPanel[] {
  return Object.entries((v.panels ?? {}) as Record<string, Panel>).flatMap(([key, p]) => {
    const kind = interventionOf({ ...p, key });
    if (!kind) return [];
    const st = panelStats({ ...p, key });
    const sizes = Object.entries(p.dents ?? {}).filter(([, n]) => Number(n) > 0).sort((a, b) => Number(a[0]) - Number(b[0])).map(([s, n]) => [s, Number(n)] as [string, number]);
    return [{ key, kind, dents: st.total, avgX: Math.round(st.avgX), avgClass: st.avgClass, big: Number(p.big) || 0, alu: !!p.alu, glue: !!p.kleber, method: p.method ?? "sanft", sizes }];
  });
}
export const countKinds = (list: FieldPanel[]) => ({ pdr: list.filter((p) => p.kind === "pdr").length, ptp: list.filter((p) => p.kind === "ptp").length, replace: list.filter((p) => p.kind === "replace").length });

/** is it his car: assigned for his kind of work, or his earnings on it are not empty (his name is in the split) */
export function isMine(v: FieldVehicle, kind: FieldKind): boolean {
  if (kind === "headliner") return !!v.myAssign?.includes("demontage") || !!v.myEarn?.dem;
  return !!v.myAssign?.includes("pdr") || !!v.myEarn?.pdr;
}
/** also does the removal / refit (a technician whose name is on both parts) */
export const alsoRemoval = (v: FieldVehicle) => !!v.myEarn?.dem;

/** in the repair flow and not returned: shown on his station card and in his list */
export const isActive = (v: FieldVehicle) => v.statut !== "rendu" && (v.repairStage != null || v.statut === "reparatur" || v.statut === "fertig");
/** finished ("Fertig"), to follow his pay; a returned car (rendu) leaves his list */
export const isFinished = (v: FieldVehicle) => v.statut !== "rendu" && (v.statut === "fertig" || stageOf(v) === "finish");

/** the only moves (the server enforces the same table): a technician Disassembly to PDR; a headliner also Reassembly to At body shop */
export const FIELD_MOVES: Record<FieldKind, readonly (readonly [string, string])[]> = {
  pdr: [["demontage", "pdr"]],
  headliner: [["demontage", "pdr"], ["remontage", "bodyshop"]],
};
export function nextStep(kind: FieldKind, v: FieldVehicle): string | null {
  if (isFinished(v) || !isActive(v)) return null;
  const from = stageOf(v);
  return FIELD_MOVES[kind].find(([a]) => a === from)?.[1] ?? null;
}

export interface PhotoLite { vehicleId: string; takenBy: string | null; repairStage?: string | null; deleted?: boolean }
/** at least one photo of the current step taken by me (the server asks for the same before it moves the car) */
export const hasStepPhoto = (photos: readonly PhotoLite[], meId: string, vehicleId: string, stage: string) =>
  photos.some((p) => p.vehicleId === vehicleId && !p.deleted && p.takenBy === meId && p.repairStage === stage);

export interface StationTally { toDo: number; inPdr: number; finished: number; toRemove: number; toRefit: number; total: number }
/** numbers of a station card */
export function tally(list: readonly FieldVehicle[], kind: FieldKind): StationTally {
  const mine = list.filter((v) => isMine(v, kind) && (isActive(v) || isFinished(v)));
  const act = mine.filter((v) => !isFinished(v));
  const at = (s: string) => act.filter((v) => stageOf(v) === s).length;
  return {
    toDo: act.filter((v) => ["bereit", "demontage"].includes(stageOf(v))).length, inPdr: at("pdr"), finished: mine.filter(isFinished).length,
    toRemove: at("demontage"), toRefit: at("remontage"), total: act.length,
  };
}
