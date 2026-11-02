// Pure logic of the repair board (Kanban): which cards, in which column, and why "Finish" is refused. No React.
import { REPAIR_STAGES, isOffRepairHold, type RepairStage } from "@hagel/shared";

export { REPAIR_STAGES };
export type { RepairStage };

export interface BoardVehicle {
  statut: string; statutMotif?: unknown; stationId?: string | null; repairStage?: string | null;
  repair?: { todos?: { done: boolean }[]; finishBlockers?: string[]; autoStartedOn?: string | null } | null;
}

/**
 * The car is on the board: in the repair flow (a stage is set) or at least in repair / finished; returned cars leave the board,
 * and so do the cars on hold for an appointment or for the insurer / customer approval.
 */
export const onBoard = (v: BoardVehicle) => v.statut !== "rendu" && !isOffRepairHold(v.statut, v.statutMotif) && (v.repairStage != null || v.statut === "reparatur" || v.statut === "fertig");

/** Column of a card: the stored stage, else "Bereit" (or "Finish" for a finished car whose stage was never set). */
export const stageOf = (v: BoardVehicle): RepairStage => (REPAIR_STAGES as readonly string[]).includes(v.repairStage ?? "") ? (v.repairStage as RepairStage) : v.statut === "fertig" ? "finish" : "bereit";

/** cards of one station, by column */
export function boardOf<T extends BoardVehicle>(vehicles: T[], stationId: string): Record<RepairStage, T[]> {
  const out = Object.fromEntries(REPAIR_STAGES.map((s) => [s, [] as T[]])) as Record<RepairStage, T[]>;
  for (const v of vehicles) if (v.stationId === stationId && onBoard(v)) out[stageOf(v)].push(v);
  return out;
}

export const todosOpen = (v: BoardVehicle): number => (v.repair?.todos ?? []).filter((t) => !t.done).length;

export const stageIndex = (s: RepairStage) => REPAIR_STAGES.indexOf(s);
/** the neighbouring column (‹ ›), null at the ends */
export const neighbour = (s: RepairStage, delta: -1 | 1): RepairStage | null => REPAIR_STAGES[stageIndex(s) + delta] ?? null;

/**
 * Can this card go to that column? Only "Finish" has conditions, and they are the SERVER's (the reasons come with the card): open to-dos,
 * unconfirmed checks, a stage without a photo, nobody assigned. The server decides again; this just avoids a pointless round trip.
 */
export function moveCheck(v: BoardVehicle, target: RepairStage): { ok: boolean; reasons: string[] } {
  if (target !== "finish" || stageOf(v) === "finish") return { ok: true, reasons: [] };
  const reasons = v.repair?.finishBlockers ?? [];
  return { ok: reasons.length === 0, reasons };
}

/** "Termin heute": the car arrived by itself because its repair appointment is today (the day is in the station's time zone) */
export const arrivedToday = (v: BoardVehicle, today: string) => v.repair?.autoStartedOn === today;

/** translation keys of the Finish blockers (`todos_open`, `check:pdr`, `photos:pdr`, `no_technician` …) */
export function blockerKey(code: string): string {
  if (code === "todos_open") return "v5BlkTodos";
  if (code === "no_technician") return "v5BlkTech";
  if (code.startsWith("check:")) return "v5BlkCheck_" + code.slice(6);
  if (code.startsWith("photos:")) return "v5BlkPhoto";
  return code;
}

/**
 * V5: the customer has not signed the drop-off yet. Only cars that ENTERED the board after V5 (repairEnteredAt is set by the server at that
 * moment) are concerned: cars that were already in repair on go-live day show nothing. Returned cars are done.
 */
export const dropOffDue = (v: { statut: string; repairStage?: string | null; repairEnteredAt?: string | null; dropOffSignedAt?: string | null }): boolean =>
  v.statut !== "rendu" && v.repairStage != null && !!v.repairEnteredAt && !v.dropOffSignedAt;
