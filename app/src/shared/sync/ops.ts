import type { ClientRepair, ClientVehicle, Op } from "@hagel/shared";
import type { LocalVehicle } from "./db";

const LINKS = ["clientStationId", "insurerId", "campaignId"] as const;

const EMPTY_REPAIR: ClientRepair = { todos: [], checks: {}, finishBlockers: [], comments: [], appointments: [], booking: null };
function withRepair(v: LocalVehicle, at: string, f: (r: ClientRepair) => ClientRepair): LocalVehicle {
  return { ...v, repair: f({ ...EMPTY_REPAIR, ...((v.repair as ClientRepair | undefined) ?? {}) }), updatedAt: at };
}

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
        ...v, statut: op.statut, statutMotif: op.statut === "attente" || op.statut === "refuse" ? (op.motif ?? "").trim() : null, statutDepuis: at, updatedAt: at,
      };
      if (op.statut === "reparatur") n.repAt = at;
      else if (op.statut === "arrive" || op.statut === "besichtigung") n.repAt = null;
      return n;
    }
    case "vehicle.move": return v ? { ...v, stationId: op.toStationId, updatedAt: at } : v;
    case "vehicle.handover": {
      if (!v) return v;
      const n: LocalVehicle = op.handover.kind === "drop_off" ? { ...v, dropOffSignedAt: op.handover.signedAt, updatedAt: at } : { ...v, pickUpSignedAt: op.handover.signedAt, updatedAt: at };
      if (op.handover.kind === "pick_up" && v.statut !== "rendu") { n.statut = "rendu"; n.statutMotif = null; n.statutDepuis = at; } // handing the car back = Returned
      return n;
    }
    case "vehicle.delete": return null;
    case "vehicle.repairStage": {
      if (!v) return v;
      const n: LocalVehicle = { ...v, repairStage: op.stage, updatedAt: at };
      if (op.stage === "finish") { n.statut = "fertig"; n.statutDepuis = at; }
      else if (v.statut === "fertig") { n.statut = "reparatur"; n.statutDepuis = at; }
      else if (v.statut !== "reparatur" && v.statut !== "attente") { n.statut = "reparatur"; n.statutDepuis = at; n.repAt = (v.repAt as string | null) ?? at; if (v.repairStage == null) n.repairEnteredAt = at; }
      return n;
    }
    case "vehicle.bodyshop": return v ? { ...v, bodyshopId: op.bodyshopId, updatedAt: at } : v;
    case "repair.todo.add": return v ? withRepair(v, at, (r) => ({ ...r, todos: [...r.todos, { id: op.todo.id, text: op.todo.text, source: "manual", done: false, doneBy: null, doneAt: null, createdBy: null, createdAt: at, sort: r.todos.length }] })) : v;
    case "repair.todo.toggle": return v ? withRepair(v, at, (r) => ({ ...r, todos: r.todos.map((x) => (x.id === op.todoId ? { ...x, done: op.done, doneAt: op.done ? at : null, doneBy: op.done ? "…" : null } : x)) })) : v;
    case "repair.todo.delete": return v ? withRepair(v, at, (r) => ({ ...r, todos: r.todos.filter((x) => x.id !== op.todoId) })) : v;
    case "repair.check": return v ? withRepair(v, at, (r) => ({ ...r, checks: { ...r.checks, [op.key]: op.done ? { by: "…", at } : null } })) : v;
    case "vehicle.comment": return v ? withRepair(v, at, (r) => ({ ...r, comments: [...r.comments, { id: op.comment.id, userId: null, userName: "…", at, text: op.comment.text.trim() }] })) : v;
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
