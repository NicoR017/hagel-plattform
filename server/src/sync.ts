import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { ES_MATRIX_DEFAULT, computeShares, computeVehicle, type CalcVehicle, type Settings } from "@hagel/calc";
import {
  DEFAULT_ORG_SETTINGS, PERMISSIONS, PRICE_HEADER_FIELDS, type ClientPhoto, type ClientStation, type ClientVehicle, type ErrorCode, type Op, type OpResult,
  type OrgSettings, type PullResponse, errorMessage,
} from "@hagel/shared";
import { audit } from "./audit";
import type { Mailer } from "./email";
import { loadMethodMap, methodForInsurer, methodOf, clientMethods, type MethodMap } from "./methods";
import { applyRepairOp, isRepairOp, partsToTodos, repairDataFor } from "./repair";
import { recipientsOfVehicle } from "./reports";
import type { Db } from "./db";
import type { Hub } from "./hub";
import { can, canOrg, effectivePermissions, filterFields, type Principal, type VehicleRef } from "./permissions";
import {
  colibriScans, calcMethods, calcMethodVersions, insurerMethods, campaignStations, campaigns, companies, insurers, memberships, orgSettings, photos, reportSends, roleAssignments, roles, stationInsurers, stations, syncOps, technicians, users, vehicleAssignments, vehicleMoves, vehicleStatusHistory, vehicles,
} from "./schema";
import type { Storage } from "./storage";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type VehicleRow = typeof vehicles.$inferSelect;
type PhotoRow = typeof photos.$inferSelect;

export interface SyncDeps { db: Db; hub: Hub; storage: Storage; mailer?: Mailer }

const HEADER_PREFIX = "h.";
const SHARES_PREFIX = "s.";
const LINK_FIELDS = ["clientStationId", "insurerId", "campaignId"] as const;
const TECH_FIELDS = ["techName", "techPct", "demTechName", "demTechPct"] as const;
const COMMISSION_FIELDS = ["werkPct", "werkMode"] as const;
const METHOD_FIELDS = ["methodId", "methodVersion"] as const;

export class Reject extends Error {
  constructor(public code: ErrorCode, public params: Record<string, string> = {}) { super(code); }
}

const num = (x: unknown) => Number(x);
export async function nextSeq(tx: Pick<Db, "execute">): Promise<number> {
  const r = (await tx.execute(sql`select nextval('change_seq')::bigint as n`)) as unknown as { rows: { n: string | number }[] };
  return num(r.rows[0].n);
}

export async function loadOrgSettings(db: Pick<Db, "select">, orgId: string): Promise<OrgSettings> {
  const [r] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId));
  return { ...DEFAULT_ORG_SETTINGS, ...((r?.settings as Partial<OrgSettings>) ?? {}) };
}
export const calcSettings = (s: OrgSettings): Settings => ({
  rateDE: s.rateDE, rateES: s.rateES, defaultTeiler: s.defaultTeiler, vatDE: 0.19, esMatrix: (s.esMatrix as Settings["esMatrix"]) ?? ES_MATRIX_DEFAULT,
});

async function assigneesOf(db: Pick<Db, "select">, ids: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (!ids.length) return m;
  const rows = await db.select().from(vehicleAssignments).where(inArray(vehicleAssignments.vehicleId, ids));
  for (const r of rows) m.set(r.vehicleId, [...(m.get(r.vehicleId) ?? []), r.userId]);
  return m;
}

export const refOf = (r: VehicleRow, assigneeIds: string[]): VehicleRef => ({
  id: r.id, orgId: r.orgId, stationId: r.stationId, clientStationId: r.clientStationId, campaignId: r.campaignId, insurerId: r.insurerId, assigneeIds,
});

/** Full (unfiltered) flat vehicle in v20 shape + server metadata. */
export function flatten(r: VehicleRow, assigneeIds: string[], updatedByName: string | null): ClientVehicle {
  const shares = (r.shares ?? {}) as Record<string, unknown>;
  return {
    ...(r.header as Record<string, unknown>),
    ...shares,
    id: r.id, orgId: r.orgId, stationId: r.stationId, clientStationId: r.clientStationId, campaignId: r.campaignId, insurerId: r.insurerId,
    repairStage: r.repairStage, bodyshopId: r.bodyshopId, methodId: r.methodId, methodVersion: r.methodVersion,
    statut: r.statut, statutAvant: r.statutAvant, statutMotif: r.statutMotif, statutDepuis: r.statutDepuis?.toISOString() ?? null, repAt: r.repAt?.toISOString() ?? null,
    panels: (r.panels ?? {}) as Record<string, unknown>, colibri: r.colibri ?? null,
    colibriFile: (r.colibriFile as ClientVehicle["colibriFile"]) ?? null,
    assigneeIds, updatedAt: r.updatedAt.toISOString(), updatedBy: updatedByName, seq: r.seq,
    groupAt: (r.groupAt ?? {}) as Record<string, number>, panelsAt: (r.panelsAt ?? {}) as Record<string, number>,
    createdAt: r.createdAt.toISOString(),
  } as ClientVehicle;
}

/** What `u` may see of `r`: null when the vehicle is not visible; restricted fields are removed server-side. */
export function toClient(u: Principal, r: VehicleRow, assigneeIds: string[], names: Map<string, string>, s: OrgSettings, methods?: MethodMap): ClientVehicle | null {
  const ref = refOf(r, assigneeIds);
  if (!can(u, "vehicules.voir", ref)) return null;
  const flat = flatten(r, assigneeIds, r.updatedBy ? names.get(r.updatedBy) ?? null : null);
  // amounts of the internal split are computed here so that restricted roles can receive ONLY their own share
  const calc = computeVehicle(flat as unknown as CalcVehicle, calcSettings(s), methodOf(methods, r));
  const withShares = { ...flat, shares: computeShares(flat as never, calc) };
  const out = filterFields(u, ref, withShares as Record<string, unknown>) as Record<string, unknown> | null;
  if (!out) return null;
  // users with the full split recompute it locally: do not send the duplicate
  if (effectivePermissions(u, ref).has("repartition_interne.voir")) delete out.shares;
  // everyone else must not even learn which share fields exist: the per-field timestamps of the split ("s.techPct" ...) stay on the server
  else if (out.groupAt) out.groupAt = Object.fromEntries(Object.entries(out.groupAt as Record<string, number>).filter(([k]) => !k.startsWith(SHARES_PREFIX)));
  // same for header fields the role does not receive (e.g. the hourly rate of a technician)
  if (out.groupAt) out.groupAt = Object.fromEntries(Object.entries(out.groupAt as Record<string, number>).filter(([k]) => !k.startsWith("h.") || k.slice(2) in out));
  return out as ClientVehicle;
}

const stampOf = (at: string) => Math.min(Date.parse(at) || 0, Date.now() + 5000);

function mergeFields(current: Record<string, unknown>, stamps: Record<string, number>, prefix: string, incoming: Record<string, unknown>, at: number) {
  const next = { ...current }, nextStamps = { ...stamps };
  const applied: string[] = [], stale: string[] = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined) continue;
    if ((stamps[prefix + k] ?? 0) > at) { stale.push(k); continue; }
    next[k] = v; nextStamps[prefix + k] = at; applied.push(k);
  }
  return { next, nextStamps, applied, stale };
}

const pick = (o: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const omit = (o: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

export const photoKey = (orgId: string, vehicleId: string, photoId: string) => `photos/${orgId}/${vehicleId}/${photoId}.jpg`;
export const colibriKey = (orgId: string, vehicleId: string) => `colibri/${orgId}/${vehicleId}.pdf`;

export interface OpOutcome { status: "ok" | "conflict"; orgId: string; seq: number; warnings?: string[]; vehicleId?: string; /** runs after the transaction committed (e-mails); a failure never undoes the change */ after?: () => Promise<void> }

export async function processPush(deps: SyncDeps, u: Principal, ops: Op[]): Promise<{ results: OpResult[]; touched: Map<string, number> }> {
  const results: OpResult[] = [];
  const touched = new Map<string, number>();
  for (const op of ops) {
    const [prev] = await deps.db.select().from(syncOps).where(eq(syncOps.opId, op.opId));
    if (prev) {
      if (prev.userId !== u.id) { results.push({ opId: op.opId, status: "rejected", code: "forbidden", message: "" }); continue; }
      results.push(prev.result as OpResult); // retried op: same answer, applied once
      continue;
    }
    let res: OpResult;
    let conflictVehicleId: string | undefined;
    try {
      const out = await deps.db.transaction(async (tx) => {
        // writers are serialised so that change numbers (seq) are assigned in commit order: pull cursors can never skip a change
        await tx.execute(sql`select pg_advisory_xact_lock(7001)`);
        return applyOp(deps, tx, u, op);
      });
      res = { opId: op.opId, status: out.status, ...(out.warnings?.length ? { warnings: out.warnings } : {}) };
      if (out.after) await out.after().catch((e) => console.error("[after-commit]", (e as Error).message));
      if (out.status === "conflict") conflictVehicleId = out.vehicleId;
      touched.set(out.orgId, Math.max(touched.get(out.orgId) ?? 0, out.seq));
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
      res = { opId: op.opId, status: "rejected", code: e.code, message: errorMessage(e.code, "en", e.params) };
    }
    await deps.db.insert(syncOps).values({ opId: op.opId, userId: u.id, result: res as never }).onConflictDoNothing();
    if (conflictVehicleId) {
      const v = await clientVehicleById(deps.db, u, conflictVehicleId);
      if (v) res = { ...res, vehicle: v };
    }
    results.push(res);
  }
  return { results, touched };
}

/** Where an imported car came from in Colibri (BusinessCustomer–insurance link, location, tenant), looked up through the scan it was created from. */
export async function attachColibriSource(db: Pick<Db, "select" | "execute">, list: ClientVehicle[]): Promise<void> {
  const ids = list.map((v) => v.id);
  if (!ids.length) return;
  const res = (await db.execute(sql`
    select v.id as id, s.business_customer as bc, s.location as location, s.tenant as tenant
    from vehicles v join colibri_scans s on (s.partition_key || '|' || s.row_key) = v.colibri_scan_key
    where v.id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)) as unknown as { rows: { id: string; bc: string; location: string; tenant: string }[] };
  const by = new Map(res.rows.map((r) => [r.id, { businessCustomer: r.bc, location: r.location, tenant: r.tenant }]));
  for (const v of list) v.colibriSource = by.get(v.id) ?? null;
}

export async function clientVehicleById(db: Db, u: Principal, id: string): Promise<ClientVehicle | null> {
  const [r] = await db.select().from(vehicles).where(eq(vehicles.id, id));
  if (!r || r.deletedAt) return null;
  const as = await assigneesOf(db, [id]);
  const names = await userNames(db, [r.updatedBy]);
  const cv = toClient(u, r, as.get(id) ?? [], names, await loadOrgSettings(db, r.orgId), await loadMethodMap(db, r.orgId));
  if (cv) await attachColibriSource(db, [cv]);
  return cv;
}

async function userNames(db: Pick<Db, "select">, ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const m = new Map<string, string>();
  if (!list.length) return m;
  for (const r of await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, list))) m.set(r.id, r.name || r.email);
  return m;
}

export async function lockVehicle(tx: Tx, u: Principal, vehicleId: string): Promise<{ row: VehicleRow; ref: VehicleRef }> {
  const [row] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)).for("update");
  if (!row || row.deletedAt) throw new Reject("vehicle_not_found");
  const as = await assigneesOf(tx, [vehicleId]);
  const ref = refOf(row, as.get(vehicleId) ?? []);
  if (!can(u, "vehicules.voir", ref)) throw new Reject("vehicle_not_found"); // do not reveal existence
  return { row, ref };
}

export const need = (u: Principal, perm: Parameters<typeof can>[1], ref: VehicleRef) => { if (!can(u, perm, ref)) throw new Reject("not_allowed"); };

async function applyOp(deps: SyncDeps, tx: Tx, u: Principal, op: Op): Promise<OpOutcome> {
  const at = stampOf(op.at);
  const db = tx as unknown as Db;
  if (isRepairOp(op)) return applyRepairOp(deps, tx, u, op, at);
  switch (op.type) {
    case "vehicle.create": return createVehicle(tx, u, op, at);

    case "vehicle.header": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "vehicules.modifier", ref);
      const perms = effectivePermissions(u, ref);
      const bad = PRICE_HEADER_FIELDS.filter((f) => f in op.fields && !perms.has("prix.voir"));
      if (bad.length) throw new Reject("field_not_allowed", { fields: bad.join(", ") });
      const links = pick(op.fields as Record<string, unknown>, LINK_FIELDS);
      const methodF = pick(op.fields as Record<string, unknown>, METHOD_FIELDS);
      const headerOnly = omit(op.fields as Record<string, unknown>, [...LINK_FIELDS, ...METHOD_FIELDS]);
      const stamps = { ...(row.groupAt as Record<string, number>) };
      const h = mergeFields(row.header as Record<string, unknown>, stamps, HEADER_PREFIX, headerOnly, at);
      const l = mergeFields({ clientStationId: row.clientStationId, insurerId: row.insurerId, campaignId: row.campaignId }, h.nextStamps, HEADER_PREFIX, links, at);
      for (const f of ["clientStationId", "insurerId"] as const) {
        const id = l.next[f] as string | null;
        if (id && l.applied.includes(f)) await assertStationOrInsurer(tx, f, id, row.orgId);
      }
      const set: Partial<typeof vehicles.$inferInsert> = { header: h.next, groupAt: l.nextStamps };
      if (l.applied.includes("clientStationId")) {
        set.clientStationId = (l.next.clientStationId as string | null) ?? null;
        set.shares = { ...(row.shares as object), ...(await commissionSnapshot(tx, set.clientStationId, row.stationId)) };
      }
      if (l.applied.includes("insurerId")) set.insurerId = (l.next.insurerId as string | null) ?? null;
      if (l.applied.includes("campaignId")) set.campaignId = (l.next.campaignId as string | null) ?? null;
      const extraApplied: string[] = [];
      if (Object.keys(methodF).length) {
        // changing the calculation method is a privilege, and impossible once the vehicle has been measured: a new calculation = a new expertise
        if (Object.keys(row.panels as object).length) throw new Reject("method_locked");
        const land = ((h.next as Record<string, unknown>).land as "DE" | "ES" | undefined) ?? "DE";
        const resolved = await resolveMethodChoice(tx, row.orgId, land, methodF.methodId as string | null | undefined, methodF.methodVersion as number | null | undefined);
        if (!resolved) throw new Reject("invalid_input");
        // choosing a method by hand is a privilege; following the insurer (or the system method of the country) is automatic and open to everyone who may edit
        const automatic = await methodForInsurer(tx, row.orgId, (l.next.insurerId as string | null) ?? null, land);
        if (!(automatic && automatic.id === resolved.id) && !perms.has("commission.modifier") && !perms.has("methoden.gerer")) throw new Reject("not_allowed");
        if ((h.nextStamps["method"] ?? 0) <= at) { set.methodId = resolved.id; set.methodVersion = resolved.version; h.nextStamps["method"] = at; extraApplied.push("method"); }
        set.groupAt = h.nextStamps;
      }
      return commit(tx, u, row, set, [...h.applied, ...l.applied, ...extraApplied], [...h.stale, ...l.stale], op.type, { before: pick(row.header as never, h.applied), after: pick(h.next, h.applied) });
    }

    case "vehicle.shares": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "vehicules.modifier", ref);
      const perms = effectivePermissions(u, ref);
      const f = op.fields as Record<string, unknown>;
      const bad = [
        ...TECH_FIELDS.filter((k) => k in f && !perms.has("repartition_interne.voir")),
        ...COMMISSION_FIELDS.filter((k) => k in f && !perms.has("commission.modifier")),
      ];
      if (bad.length) throw new Reject("field_not_allowed", { fields: bad.join(", ") });
      const m = mergeFields(row.shares as Record<string, unknown>, row.groupAt as Record<string, number>, SHARES_PREFIX, f, at);
      return commit(tx, u, row, { shares: m.next, groupAt: m.nextStamps }, m.applied, m.stale, op.type, { before: pick(row.shares as never, m.applied), after: pick(m.next, m.applied) });
    }

    case "vehicle.panel": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "vehicules.modifier", ref);
      const perms = effectivePermissions(u, ref);
      const panels = { ...(row.panels as Record<string, Record<string, unknown>>) };
      const stamps = { ...(row.panelsAt as Record<string, number>) };
      if ((stamps[op.key] ?? 0) > at) return commit(tx, u, row, {}, [], ["panel"], op.type, {}, true);
      const before = panels[op.key] ?? null;
      if (op.panel) {
        if (op.panel.key !== op.key) throw new Reject("invalid_input");
        const next: Record<string, unknown> = { ...op.panel };
        // the manual amount of dents > 85 mm is a price: keep the stored value when the user may not set prices
        if (!perms.has("prix.voir")) { if (before && "bigEur" in before) next.bigEur = before.bigEur; else delete next.bigEur; }
        panels[op.key] = next;
      } else delete panels[op.key];
      stamps[op.key] = at;
      return commit(tx, u, row, { panels, panelsAt: stamps }, ["panel"], [], op.type, { before, after: panels[op.key] ?? null });
    }

    case "vehicle.status": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "vehicules.changer_statut", ref);
      if (op.statut === "attente" && !(op.motif ?? "").trim()) throw new Reject("motif_required");
      const stamps = { ...(row.groupAt as Record<string, number>) };
      if ((stamps.status ?? 0) > at) return commit(tx, u, row, {}, [], ["status"], op.type, {}, true);
      stamps.status = at;
      const now = new Date();
      const set: Partial<typeof vehicles.$inferInsert> = {
        statut: op.statut, statutMotif: op.statut === "attente" ? (op.motif ?? "").trim() : null, statutDepuis: now, groupAt: stamps,
        statutAvant: op.statut === "attente" ? row.statut : null,
      };
      if (op.statut === "reparatur") set.repAt = now;
      else if (op.statut === "arrive" || op.statut === "besichtigung") set.repAt = null;
      // the older status path keeps the board column consistent (it never sends the automatic report nor checks the Finish rules)
      if (op.statut === "reparatur") { if (!row.repairStage || row.repairStage === "finish") set.repairStage = row.repairStage === "finish" ? "pdr" : "bereit"; await partsToTodos(tx, row, u.id); }
      else if (op.statut === "fertig") set.repairStage = "finish";
      else if (op.statut === "arrive" || op.statut === "besichtigung") set.repairStage = null;
      await tx.insert(vehicleStatusHistory).values({ vehicleId: row.id, statut: op.statut, motif: set.statutMotif ?? null, userId: u.id });
      return commit(tx, u, row, set, ["status"], [], op.type, { before: { statut: row.statut }, after: { statut: op.statut, motif: set.statutMotif } });
    }

    case "vehicle.move": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "vehicules.deplacer", ref); // right on the SOURCE site
      const [dest] = await tx.select().from(stations).where(and(eq(stations.id, op.toStationId), eq(stations.orgId, row.orgId)));
      if (!dest || !dest.active) throw new Reject("station_unknown");
      const stamps = { ...(row.groupAt as Record<string, number>) };
      if ((stamps.site ?? 0) > at) return commit(tx, u, row, {}, [], ["site"], op.type, {}, true);
      stamps.site = at;
      await tx.insert(vehicleMoves).values({ vehicleId: row.id, fromStationId: row.stationId, toStationId: dest.id, userId: u.id, note: op.note ?? null });
      const warnings: string[] = [];
      if (dest.capacite > 0) {
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(vehicles)
          .where(and(eq(vehicles.stationId, dest.id), isNull(vehicles.deletedAt), ne(vehicles.statut, "rendu")));
        if (n >= dest.capacite) warnings.push("capacity_full");
      }
      if (row.stationId && row.stationId !== dest.id) {
        const [from] = await tx.select().from(stations).where(eq(stations.id, row.stationId));
        if (from?.azureTenant && dest.azureTenant && from.azureTenant !== dest.azureTenant) warnings.push("tenant_differs");
      }
      // the customer (clientStationId), the commission snapshot and the report recipients do NOT change with a move
      const r = await commit(tx, u, row, { stationId: dest.id, groupAt: stamps }, ["site"], [], op.type, { before: { stationId: row.stationId }, after: { stationId: dest.id, note: op.note, ...(warnings.length ? { warnings } : {}) } });
      return { ...r, warnings };
    }

    case "vehicle.delete": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "vehicules.supprimer", ref);
      const seq = await nextSeq(tx);
      const ph = await tx.select().from(photos).where(and(eq(photos.vehicleId, row.id), isNull(photos.deletedAt)));
      for (const p of ph) {
        if (p.fileKey) await deps.storage.delete(p.fileKey).catch(() => undefined);
        await tx.update(photos).set({ deletedAt: new Date(), fileKey: null, seq: await nextSeq(tx) }).where(eq(photos.id, p.id));
      }
      const cf = row.colibriFile as { key?: string } | null;
      if (cf?.key) await deps.storage.delete(cf.key).catch(() => undefined);
      await tx.update(vehicles).set({ deletedAt: new Date(), seq, updatedBy: u.id, updatedAt: new Date(), colibriFile: null, colibriScanKey: null }).where(eq(vehicles.id, row.id));
      // the Colibri scan this car was made from is available again
      await tx.update(colibriScans).set({ importStatus: "new", vehicleId: null, importedBy: null, importedAt: null, updatedAt: new Date() }).where(and(eq(colibriScans.vehicleId, row.id), eq(colibriScans.importStatus, "imported")));
      await audit(db, { orgId: row.orgId, userId: u.id, action: op.type, entity: "vehicle", entityId: row.id, before: { kennzeichen: (row.header as Record<string, unknown>).kennzeichen } });
      return { status: "ok", orgId: row.orgId, seq };
    }

    case "vehicle.assign": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "vehicules.assigner", ref);
      const ids = [...new Set(op.userIds)];
      if (ids.length) {
        const ok = await tx.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, row.orgId), inArray(memberships.userId, ids)));
        if (ok.length !== ids.length) throw new Reject("user_not_found");
      }
      const before = (await assigneesOf(tx, [row.id])).get(row.id) ?? [];
      await tx.delete(vehicleAssignments).where(and(eq(vehicleAssignments.vehicleId, row.id), eq(vehicleAssignments.type, op.kind)));
      if (ids.length) await tx.insert(vehicleAssignments).values(ids.map((userId) => ({ vehicleId: row.id, userId, type: op.kind })));
      return commit(tx, u, row, {}, ["assign"], [], op.type, { before, after: ids });
    }

    case "vehicle.colibri": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "colibri.importer", ref);
      const prevFile = row.colibriFile as { key?: string } | null;
      const file = op.file ? { name: op.file.name, size: op.file.size, key: colibriKey(row.orgId, row.id) } : prevFile ?? null;
      return commit(tx, u, row, { colibri: op.colibri as never, colibriFile: file as never }, ["colibri"], [], op.type, { after: { imported: op.colibri.imported, reportTotal: op.colibri.reportTotal } });
    }

    case "report.send": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, op.report.type === "kva" ? "kva.envoyer" : "rapport_reparation.envoyer", ref);
      const [ex] = await tx.select().from(reportSends).where(eq(reportSends.id, op.report.id));
      if (ex) {
        if (ex.vehicleId !== row.id || ex.sentBy !== u.id) throw new Reject("not_allowed");
        return { status: "ok", orgId: row.orgId, seq: row.seq };
      }
      const recipients = await recipientsOfVehicle(tx, row, op.report.type);
      if (!recipients.length) throw new Reject("report_no_recipients");
      await tx.insert(reportSends).values({ id: op.report.id, orgId: row.orgId, vehicleId: row.id, type: op.report.type, lang: op.report.lang, recipients, status: "awaiting_file", sentBy: u.id });
      await audit(db, { orgId: row.orgId, userId: u.id, action: op.type, entity: "report", entityId: op.report.id, after: { vehicleId: row.id, type: op.report.type, recipients } });
      return { status: "ok", orgId: row.orgId, seq: row.seq };
    }

    case "photo.add": {
      const p = op.photo;
      const { row, ref } = await lockVehicle(tx, u, p.vehicleId);
      need(u, "photos.ajouter", ref);
      const [ex] = await tx.select().from(photos).where(eq(photos.id, p.id));
      if (ex) {
        if (ex.vehicleId !== p.vehicleId) throw new Reject("not_allowed");
        return { status: "ok", orgId: row.orgId, seq: ex.seq };
      }
      const seq = await nextSeq(tx);
      await tx.insert(photos).values({
        id: p.id, vehicleId: p.vehicleId, label: p.label, phase: p.phase, source: p.source, inPdf: p.inPdf, takenAt: new Date(p.takenAt),
        takenBy: u.id, sort: p.sort, colibriPosition: p.colibriPosition, colibriIndex: p.colibriIndex, seq,
      });
      await audit(db, { orgId: row.orgId, userId: u.id, action: op.type, entity: "photo", entityId: p.id, after: { vehicleId: p.vehicleId, label: p.label, phase: p.phase } });
      return { status: "ok", orgId: row.orgId, seq };
    }

    case "photo.update":
    case "photo.delete": {
      const [ph] = await tx.select().from(photos).where(eq(photos.id, op.photoId)).for("update");
      if (!ph || ph.deletedAt) throw new Reject("photo_not_found");
      const { row, ref } = await lockVehicle(tx, u, ph.vehicleId).catch(() => { throw new Reject("photo_not_found"); });
      const seq = await nextSeq(tx);
      if (op.type === "photo.update") {
        need(u, "photos.ajouter", ref);
        await tx.update(photos).set({ ...op.fields, seq }).where(eq(photos.id, ph.id));
        await audit(db, { orgId: row.orgId, userId: u.id, action: op.type, entity: "photo", entityId: ph.id, before: pick(ph as never, Object.keys(op.fields)), after: op.fields });
      } else {
        need(u, "photos.supprimer", ref);
        if (ph.fileKey) await deps.storage.delete(ph.fileKey).catch(() => undefined);
        await tx.update(photos).set({ deletedAt: new Date(), fileKey: null, seq }).where(eq(photos.id, ph.id));
        await audit(db, { orgId: row.orgId, userId: u.id, action: op.type, entity: "photo", entityId: ph.id, before: { vehicleId: ph.vehicleId, label: ph.label } });
      }
      return { status: "ok", orgId: row.orgId, seq };
    }
  }
}

async function assertStationOrInsurer(tx: Tx, field: "clientStationId" | "insurerId", id: string, orgId: string) {
  if (field === "clientStationId") {
    const [s] = await tx.select({ id: stations.id }).from(stations).where(and(eq(stations.id, id), eq(stations.orgId, orgId)));
    if (!s) throw new Reject("station_unknown");
  }
  // insurers are managed in phase 4; ids are accepted only if they exist in this org
  else {
    const r = (await tx.execute(sql`select 1 from insurers where id = ${id} and org_id = ${orgId}`)) as unknown as { rows: unknown[] };
    if (!r.rows.length) throw new Reject("invalid_input");
  }
}

/** A method asked for by the client: must belong to the organisation, be live, fit the country, and the version must exist (default: current). */
async function resolveMethodChoice(tx: Tx, orgId: string, land: "DE" | "ES", methodId: string | null | undefined, version: number | null | undefined) {
  if (!methodId) return null;
  const [m] = await tx.select().from(calcMethods).where(and(eq(calcMethods.id, methodId), eq(calcMethods.orgId, orgId)));
  if (!m || m.archivedAt || m.country !== land) return null;
  const v = version ?? m.currentVersion;
  const [ver] = await tx.select().from(calcMethodVersions).where(and(eq(calcMethodVersions.methodId, m.id), eq(calcMethodVersions.version, v)));
  return ver ? { id: m.id, version: v } : null;
}

/** Commission (mode + %) of the customer carrosserie, copied onto the vehicle when the customer is set. */
async function commissionSnapshot(tx: Tx, clientStationId: string | null, stationId: string | null) {
  const id = clientStationId ?? stationId;
  if (!id) return {};
  const [s] = await tx.select().from(stations).where(eq(stations.id, id));
  if (!s || s.type !== "carrosserie") return {};
  return { werkMode: s.commissionMode as "pct" | "staffel", werkPct: Number(s.commissionPct) };
}

async function createVehicle(tx: Tx, u: Principal, op: Extract<Op, { type: "vehicle.create" }>, at: number): Promise<OpOutcome> {
  const v = op.vehicle;
  const [dest] = await tx.select().from(stations).where(eq(stations.id, v.stationId));
  if (!dest) throw new Reject("station_unknown");
  const [exists] = await tx.select().from(vehicles).where(eq(vehicles.id, v.id)).for("update");
  if (exists) {
    if (exists.createdBy === u.id && exists.orgId === dest.orgId) return { status: "ok", orgId: exists.orgId, seq: exists.seq };
    throw new Reject("vehicle_exists");
  }
  const ref: VehicleRef = { id: v.id, orgId: dest.orgId, stationId: v.stationId, clientStationId: v.clientStationId, campaignId: v.campaignId, insurerId: v.insurerId, assigneeIds: [u.id] };
  if (!can(u, "vehicules.creer", ref)) throw new Reject("not_allowed");
  if (v.clientStationId) await assertStationOrInsurer(tx, "clientStationId", v.clientStationId, dest.orgId);
  if (v.insurerId) await assertStationOrInsurer(tx, "insurerId", v.insurerId, dest.orgId);
  const perms = effectivePermissions(u, ref);
  // fields the creator may not set are dropped (the server default applies), not rejected
  let header: Record<string, unknown> = { ...v.header };
  if (!perms.has("prix.voir")) header = omit(header, PRICE_HEADER_FIELDS);
  header = omit(header, [...LINK_FIELDS, ...METHOD_FIELDS]);
  // frozen calculation method: the one asked for (if valid), else the insurer's, else the system method of the country
  const land = ((header.land as "DE" | "ES" | undefined) ?? "DE");
  const asked = v.header as Record<string, unknown>;
  const chosen = (asked.methodId ? await resolveMethodChoice(tx, dest.orgId, land, asked.methodId as string, asked.methodVersion as number | undefined) : null)
    ?? await methodForInsurer(tx, dest.orgId, v.insurerId, land);
  const shares: Record<string, unknown> = perms.has("repartition_interne.voir") ? { ...v.shares } : {};
  Object.assign(shares, await commissionSnapshot(tx, v.clientStationId, v.stationId));
  const stamps: Record<string, number> = { status: at, site: at };
  for (const k of Object.keys(header)) stamps[HEADER_PREFIX + k] = at;
  for (const k of Object.keys(shares)) stamps[SHARES_PREFIX + k] = at;
  const panelsAt = Object.fromEntries(Object.keys(v.panels).map((k) => [k, at]));
  const now = new Date();
  const seq = await nextSeq(tx);
  await tx.insert(vehicles).values({
    id: v.id, orgId: dest.orgId, stationId: v.stationId, clientStationId: v.clientStationId, campaignId: v.campaignId, insurerId: v.insurerId,
    statut: v.statut, statutDepuis: now, repAt: v.statut === "reparatur" ? now : null, header: header as never, panels: v.panels as never, panelsAt,
    shares: shares as never, groupAt: stamps, seq, createdBy: u.id, updatedBy: u.id,
    methodId: chosen?.id ?? null, methodVersion: chosen?.version ?? null,
  });
  await tx.insert(vehicleStatusHistory).values({ vehicleId: v.id, statut: v.statut, userId: u.id });
  // an account that only sees the cars assigned to it (technician, freelancer) is assigned to the car it creates, or it would vanish
  if (u.grants.some((g) => g.orgId === dest.orgId && (g.scope === "assigne" || g.scope === "campagne"))) await tx.insert(vehicleAssignments).values({ vehicleId: v.id, userId: u.id, type: "pdr" }).onConflictDoNothing();
  await audit(tx as unknown as Db, { orgId: dest.orgId, userId: u.id, action: op.type, entity: "vehicle", entityId: v.id, after: { stationId: v.stationId, ...pick(header, ["kennzeichen", "land"]) } });
  const warnings: string[] = [];
  if (dest.capacite > 0) {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(and(eq(vehicles.stationId, dest.id), isNull(vehicles.deletedAt), ne(vehicles.statut, "rendu")));
    if (n > dest.capacite) warnings.push("capacity_full");
  }
  return { status: "ok", orgId: dest.orgId, seq, warnings };
}

async function commit(
  tx: Tx, u: Principal, row: VehicleRow, set: Partial<typeof vehicles.$inferInsert>, applied: string[], stale: string[], action: string,
  change: { before?: unknown; after?: unknown }, onlyStale = false,
): Promise<OpOutcome> {
  if (onlyStale || (!applied.length && stale.length)) return { status: "conflict", orgId: row.orgId, seq: row.seq, vehicleId: row.id };
  const seq = await nextSeq(tx);
  await tx.update(vehicles).set({ ...set, seq, updatedBy: u.id, updatedAt: new Date() }).where(eq(vehicles.id, row.id));
  await audit(tx as unknown as Db, { orgId: row.orgId, userId: u.id, action, entity: "vehicle", entityId: row.id, before: change.before, after: change.after });
  return { status: stale.length ? "conflict" : "ok", orgId: row.orgId, seq, vehicleId: row.id };
}

// ---------------------------------------------------------------- pull

export function epochOf(u: Principal, orgId: string): string {
  const g = u.grants.filter((x) => x.orgId === orgId).map((x) => [x.stationId, x.scope, [...x.permissions].sort(), x.scopeClientStationId, x.scopeInsurerId, x.scopeCampaignId, x.expiresAt?.toISOString() ?? null]);
  g.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify([u.status, u.isSuperadmin, g])).digest("hex").slice(0, 24);
}

export async function processPull(db: Db, u: Principal, orgId: string, sinceIn: number, clientEpoch: string | null, limit = 150): Promise<PullResponse> {
  const epoch = epochOf(u, orgId);
  const reset = clientEpoch !== null && clientEpoch !== epoch;
  const since = reset || clientEpoch === null ? 0 : sinceIn;
  const settings = await loadOrgSettings(db, orgId);
  const methods = await loadMethodMap(db, orgId);

  const vRows = await db.select().from(vehicles).where(and(eq(vehicles.orgId, orgId), gt(vehicles.seq, since))).orderBy(asc(vehicles.seq)).limit(limit + 1);
  const orgVehicleIds = db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.orgId, orgId));
  const pRows = await db.select().from(photos).where(and(gt(photos.seq, since), inArray(photos.vehicleId, orgVehicleIds))).orderBy(asc(photos.seq)).limit(limit + 1);
  const vMore = vRows.length > limit, pMore = pRows.length > limit;
  const vPage = vRows.slice(0, limit), pPage = pRows.slice(0, limit);
  const vCut = vMore ? vPage[vPage.length - 1].seq : Infinity;
  const pCut = pMore ? pPage[pPage.length - 1].seq : Infinity;
  const cut = Math.min(vCut, pCut);
  const vs = vPage.filter((r) => r.seq <= cut), ps = pPage.filter((r) => r.seq <= cut);

  const photoVehicleIds = [...new Set(ps.map((p) => p.vehicleId))];
  const extraRows = photoVehicleIds.length ? await db.select().from(vehicles).where(inArray(vehicles.id, photoVehicleIds)) : [];
  const allRows = new Map<string, VehicleRow>([...vs, ...extraRows].map((r) => [r.id, r]));
  const as = await assigneesOf(db, [...allRows.keys()]);
  const names = await userNames(db, [...allRows.values()].map((r) => r.updatedBy));
  const visible = new Map<string, boolean>();
  const outVehicles: ClientVehicle[] = [], gone: string[] = [];
  for (const r of allRows.values()) {
    const cv = r.deletedAt ? null : toClient(u, r, as.get(r.id) ?? [], names, settings, methods);
    visible.set(r.id, !!cv);
  }
  for (const r of vs) {
    const cv = r.deletedAt ? null : toClient(u, r, as.get(r.id) ?? [], names, settings, methods);
    if (cv) outVehicles.push(cv); else gone.push(r.id);
  }
  // repair data (to-dos, checks, comments, planning, booking) travels inside the vehicle, filtered by what this user may see
  const sent = new Set(outVehicles.map((x) => x.id));
  await attachColibriSource(db, outVehicles);
  const repair = await repairDataFor(db, u, vs.filter((r) => sent.has(r.id)).map((r) => ({ row: r, ref: refOf(r, as.get(r.id) ?? []) })));
  for (const cv of outVehicles) { const x = repair.get(cv.id); if (x) cv.repair = x; }
  const photoNames = await userNames(db, ps.map((p) => p.takenBy));
  const outPhotos: ClientPhoto[] = ps.filter((p) => visible.get(p.vehicleId)).map((p) => photoToClient(p, photoNames));

  const cursor = Math.max(since, ...vs.map((r) => r.seq), ...ps.map((p) => p.seq));
  return {
    epoch, reset, cursor, hasMore: vMore || pMore, vehicles: outVehicles, photos: outPhotos, gone,
    refs: await buildRefs(db, u, orgId, settings, outVehicles),
  };
}

export const photoToClient = (p: PhotoRow, names?: Map<string, string>): ClientPhoto => ({
  id: p.id, vehicleId: p.vehicleId, label: p.label, phase: p.phase as ClientPhoto["phase"], source: p.source, inPdf: p.inPdf,
  takenAt: p.takenAt.toISOString(), takenBy: p.takenBy, sort: p.sort, hasFile: !!p.fileKey, colibriPosition: p.colibriPosition,
  colibriIndex: p.colibriIndex, deleted: !!p.deletedAt, seq: p.seq, repairStage: p.repairStage, role: p.role, takenByName: p.takenBy ? names?.get(p.takenBy) ?? null : null,
});

/**
 * Without the right to see prices (in at least one grant of this organisation) the hourly rates and the matrix' euro figures
 * are not sent: hours and categories are enough to count bollos / AW on the phone.
 */
export function visibleSettings(u: Principal, orgId: string, settings: OrgSettings): OrgSettings {
  const mayPrice = u.isSuperadmin || u.grants.some((g) => g.orgId === orgId && g.permissions.includes("prix.voir"));
  if (mayPrice) return settings;
  return {
    ...settings, rateDE: 0, rateES: 0,
    ...(settings.esMatrix ? { esMatrix: { ...(settings.esMatrix as Record<string, unknown>), rate_eur_per_h: 0, kickback_eur: [{ else: true, eur: 0 }] } } : {}),
  };
}

/** Sites a user may know about: all of the organisation for internal roles, otherwise only their own sites / customers / vehicles' sites. */
export async function visibleStations(db: Db, u: Principal, orgId: string, vs: Pick<ClientVehicle, "stationId" | "clientStationId">[] = []) {
  const all = await db.select().from(stations).where(eq(stations.orgId, orgId)).orderBy(asc(stations.name));
  const orgWide = u.isSuperadmin || u.grants.some((g) => g.orgId === orgId && g.stationId === null && ["station", "assigne", "campagne"].includes(g.scope));
  if (orgWide) return all;
  const ids = new Set<string>();
  u.grants.filter((g) => g.orgId === orgId).forEach((g) => { if (g.stationId) ids.add(g.stationId); if (g.scopeClientStationId) ids.add(g.scopeClientStationId); });
  vs.forEach((v) => { if (v.stationId) ids.add(v.stationId); if (v.clientStationId) ids.add(v.clientStationId); });
  return all.filter((x) => ids.has(x.id));
}

/** Vehicles physically present per site: every status but `rendu`, deleted ones excluded. */
export async function occupancyOf(db: Pick<Db, "select">, orgId: string, stationIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = Object.fromEntries(stationIds.map((id) => [id, 0]));
  if (!stationIds.length) return out;
  const rows = await db.select({ id: vehicles.stationId, n: sql<number>`count(*)::int` }).from(vehicles)
    .where(and(eq(vehicles.orgId, orgId), isNull(vehicles.deletedAt), ne(vehicles.statut, "rendu"), inArray(vehicles.stationId, stationIds)))
    .groupBy(vehicles.stationId);
  for (const r of rows) if (r.id) out[r.id] = r.n;
  return out;
}

async function buildRefs(db: Db, u: Principal, orgId: string, settings: OrgSettings, vs: ClientVehicle[]): Promise<PullResponse["refs"]> {
  const list = await visibleStations(db, u, orgId, vs);
  const showCommission = canOrg(u, "commission.modifier", orgId) || canOrg(u, "stations.gerer", orgId);
  const st: ClientStation[] = list.map((s) => ({
    id: s.id, type: s.type, name: s.name, country: s.country, capacite: s.capacite, active: s.active, azureTenant: s.azureTenant, repairsPerDay: s.repairsPerDay, address: s.address,
    ...(showCommission ? { commissionMode: s.commissionMode, commissionPct: Number(s.commissionPct) } : {}),
  }));
  const [me] = await db.select().from(users).where(eq(users.id, u.id));
  const perms = new Set<string>();
  u.grants.filter((g) => g.orgId === orgId).forEach((g) => g.permissions.forEach((p) => perms.add(p)));
  if (u.isSuperadmin) PERMISSIONS.forEach((p) => perms.add(p));
  let people: PullResponse["refs"]["people"] = [];
  // roles and stations of the people of the organisation (sub-line of the pickers; an assignment without a station = all stations)
  const accessRows = await db.select({ userId: roleAssignments.userId, stationId: roleAssignments.stationId, role: roles.name }).from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId)).where(eq(roleAssignments.orgId, orgId));
  const access = new Map<string, { roles: Set<string>; stationIds: Set<string> }>();
  for (const r of accessRows) { const e = access.get(r.userId) ?? { roles: new Set<string>(), stationIds: new Set<string>() }; e.roles.add(r.role); if (r.stationId) e.stationIds.add(r.stationId); access.set(r.userId, e); }
  if (canOrg(u, "vehicules.assigner", orgId)) {
    const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, orgId));
    people = rows.map((r) => ({ id: r.id, name: r.name || r.email, roles: [...(access.get(r.id)?.roles ?? [])], stationIds: [...(access.get(r.id)?.stationIds ?? [])] }));
  }
  const priceSafe = visibleSettings(u, orgId, settings);
  // master data for the pickers
  const internal = u.isSuperadmin || u.grants.some((g) => g.orgId === orgId && ["station", "assigne", "campagne"].includes(g.scope));
  const myGrants = u.grants.filter((g) => g.orgId === orgId);
  const insRows = await db.select().from(insurers).where(eq(insurers.orgId, orgId)).orderBy(asc(insurers.name));
  const wantIns = new Set([...vs.map((v) => v.insurerId).filter(Boolean), ...myGrants.map((g) => g.scopeInsurerId).filter(Boolean)] as string[]);
  const linkRows = await db.select().from(stationInsurers).innerJoin(stations, eq(stations.id, stationInsurers.stationId)).where(eq(stations.orgId, orgId));
  const visibleIds = new Set(list.map((x) => x.id));
  const campRows = await db.select().from(campaigns).where(eq(campaigns.orgId, orgId)).orderBy(asc(campaigns.name));
  const campLinks = await db.select().from(campaignStations);
  const wantCamp = new Set([...vs.map((v) => v.campaignId).filter(Boolean), ...myGrants.map((g) => g.scopeCampaignId).filter(Boolean)] as string[]);
  const compRows = await db.select().from(companies).where(and(eq(companies.orgId, orgId), eq(companies.active, true))).orderBy(asc(companies.name));
  const maySplit = u.isSuperadmin || perms.has("repartition_interne.voir");
  const techRows = maySplit ? await db.select().from(technicians).where(and(eq(technicians.orgId, orgId), eq(technicians.active, true))).orderBy(asc(technicians.name)) : [];
  const occ = await occupancyOf(db, orgId, list.map((x) => x.id));
  const bodyshops = perms.has("reparatur.board")
    ? (await db.select().from(stations).where(and(eq(stations.orgId, orgId), eq(stations.type, "carrosserie"), eq(stations.active, true))).orderBy(asc(stations.name))).map((s) => ({ id: s.id, name: s.name, azureTenant: s.azureTenant }))
    : [];
  const repairLocations = perms.has("termine.buchen")
    ? (await db.select().from(stations).where(and(eq(stations.orgId, orgId), inArray(stations.type, ["hall", "carrosserie"]), eq(stations.active, true))).orderBy(asc(stations.name)))
      .map((s) => ({ id: s.id, name: s.name, type: s.type, country: s.country, repairsPerDay: s.repairsPerDay, azureTenant: s.azureTenant }))
    : [];
  return {
    stations: st, bodyshops, repairLocations, occupancy: occ, settings: priceSafe, me: { id: u.id, name: me?.name ?? "", language: me?.language ?? "de", permissions: [...perms] }, people,
    insurers: insRows.filter((i) => internal || wantIns.has(i.id)).map((i) => ({ id: i.id, name: i.name })),
    stationInsurers: linkRows.map((l) => ({ stationId: l.station_insurers.stationId, insurerId: l.station_insurers.insurerId })).filter((l) => internal || visibleIds.has(l.stationId)),
    campaigns: campRows.filter((cp) => internal || wantCamp.has(cp.id)).map((cp) => ({ id: cp.id, name: cp.name, country: cp.country, start: cp.start, end: cp.end, stationIds: campLinks.filter((l) => l.campaignId === cp.id).map((l) => l.stationId) })),
    companies: compRows.map((co) => ({ id: co.id, name: co.name, address: co.address, taxId: co.taxId, email: co.email, footer: co.footer, hasLogo: !!co.logoKey, logo: (co.logoMeta as { kind: "jpg" | "png"; width: number; height: number } | null) ?? null })),
    technicians: techRows.map((tc) => ({ id: tc.id, name: tc.name, userId: tc.userId, defaultPctPdr: Number(tc.defaultPctPdr), defaultPctDemontage: Number(tc.defaultPctDemontage), kind: (tc.kind === "headliner" ? "headliner" : "pdr") as "pdr" | "headliner", stationIds: tc.userId ? [...(access.get(tc.userId)?.stationIds ?? [])] : [] })),
    methods: await clientMethods(db, orgId, u.isSuperadmin || perms.has("prix.voir")),
    insurerMethods: (await db.select().from(insurerMethods).innerJoin(insurers, eq(insurers.id, insurerMethods.insurerId)).where(eq(insurers.orgId, orgId))).map((x) => ({ insurerId: x.insurer_methods.insurerId, country: x.insurer_methods.country, methodId: x.insurer_methods.methodId })),
  };
}
