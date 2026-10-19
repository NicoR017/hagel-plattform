import type { ClientVehicle, Op } from "@hagel/shared";
import type { LocalVehicle } from "./db";

const LINKS = ["clientStationId", "insurerId", "campaignId"] as const;

/**
 * Pure replay of one operation on a local vehicle (used both for the optimistic update when the user edits
 * and to rebuild "server snapshot + pending ops"). Returns null when the vehicle is deleted.
 */
export function applyOpLocal(v: LocalVehicle | null, op: Op, orgId: string): LocalVehicle | null {
  const at = op.at;
  switch (op.type) {
    case "vehicle.create": {
      const c = op.vehicle;
      const now = Date.parse(at);
      return {
        ...(c.header as Record<string, unknown>), ...(c.shares as Record<string, unknown>),
        id: c.id, orgId, stationId: c.stationId, clientStationId: c.clientStationId, campaignId: c.campaignId, insurerId: c.insurerId,
        statut: c.statut, statutMotif: null, statutDepuis: at, repAt: c.statut === "reparatur" ? at : null,
        panels: { ...c.panels }, colibri: null, colibriFile: null, assigneeIds: [], updatedAt: at, updatedBy: null, seq: 0,
        groupAt: {}, panelsAt: {}, createdAt: new Date(now).toISOString(), _localOnly: true,
      } as LocalVehicle;
    }
    case "vehicle.header": {
      if (!v) return v;
      const n: LocalVehicle = { ...v };
      for (const [k, val] of Object.entries(op.fields)) {
        if (val === undefined) continue;
        (n as Record<string, unknown>)[k] = val;
        if ((LINKS as readonly string[]).includes(k)) (n as Record<string, unknown>)[k] = val ?? null;
      }
      n.updatedAt = at;
      return n;
    }
    case "vehicle.shares": {
      if (!v) return v;
      return { ...v, ...op.fields, updatedAt: at };
    }
    case "vehicle.panel": {
      if (!v) return v;
      const panels = { ...v.panels } as Record<string, unknown>;
      if (op.panel) panels[op.key] = op.panel; else delete panels[op.key];
      return { ...v, panels, updatedAt: at };
    }
    case "vehicle.status": {
      if (!v) return v;
      const n: LocalVehicle = {
        ...v, statut: op.statut, statutMotif: op.statut === "attente" ? (op.motif ?? "").trim() : null, statutDepuis: at, updatedAt: at,
      };
      if (op.statut === "reparatur") n.repAt = at;
      else if (op.statut === "arrive" || op.statut === "besichtigung") n.repAt = null;
      return n;
    }
    case "vehicle.move": return v ? { ...v, stationId: op.toStationId, updatedAt: at } : v;
    case "vehicle.delete": return null;
    case "vehicle.assign": return v ? { ...v, assigneeIds: op.userIds, updatedAt: at } : v;
    case "vehicle.colibri": return v ? { ...v, colibri: op.colibri, colibriFile: op.file ? { name: op.file.name, size: op.file.size } : v.colibriFile, updatedAt: at } : v;
    default: return v;
  }
}

export const vehicleIdOfOp = (op: Op): string | null =>
  op.type === "vehicle.create" ? op.vehicle.id
    : op.type === "photo.add" ? op.photo.vehicleId
      : "vehicleId" in op ? op.vehicleId : null;

/** server snapshot + pending ops → local view */
export function rebuild(server: ClientVehicle | null, pending: { op: Op; orgId: string }[]): LocalVehicle | null {
  let v: LocalVehicle | null = server ? ({ ...server } as LocalVehicle) : null;
  for (const p of pending) {
    if (p.op.type.startsWith("photo.")) continue;
    // an acknowledged vehicle (server snapshot present) ignores a stale pending create
    if (p.op.type === "vehicle.create" && v) continue;
    v = applyOpLocal(v, p.op, p.orgId);
  }
  if (v && pending.some((p) => !p.op.type.startsWith("photo."))) v._pending = pending.filter((p) => !p.op.type.startsWith("photo.")).length;
  return v;
}
