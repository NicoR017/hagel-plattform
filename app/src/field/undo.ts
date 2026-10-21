import type { LocalDb } from "../sync/db";
import { moveVehicle, setStatus, type MutCtx } from "../sync/mutations";

/** What a vehicle looked like before a status change / move, so "Rückgängig" can restore it with a second (logged) operation. */
export interface Snapshot { id: string; statut: string | null; motif: string | null; stationId: string | null }

export async function snapshotVehicles(db: LocalDb, ids: string[]): Promise<Snapshot[]> {
  return Promise.all(ids.map(async (id) => {
    const v = await db.vehicles.get(id);
    return { id, statut: v?.statut ?? null, motif: (v?.statutMotif as string | null | undefined) ?? null, stationId: (v?.stationId as string | null | undefined) ?? null };
  }));
}

/** Back to the previous status ("Wartet" keeps its reason). Vehicles that already have the status are left alone. */
export async function undoStatus(c: MutCtx, before: Snapshot[], appliedStatut: string): Promise<void> {
  for (const p of before) if (p.statut && p.statut !== appliedStatut) await setStatus(c, p.id, p.statut, p.statut === "attente" ? p.motif || "Sonstiges" : undefined);
}

/** Back to the previous station; the note says it was an undo. */
export async function undoMove(c: MutCtx, before: Snapshot[], movedTo: string, note: string): Promise<void> {
  for (const p of before) if (p.stationId && p.stationId !== movedTo) await moveVehicle(c, p.id, p.stationId, note);
}
