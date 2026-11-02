import { isV3Op, type ClientPhoto, type ClientVehicle, type Op, type OpResult, type PullResponse, type PushResponse } from "@hagel/shared";
import { cursorKey, epochKey, refsKey, type LocalDb, type LocalPhoto, type LocalVehicle, type OutboxRow } from "./db";
import { applyOpLocal, rebuild, vehicleIdOfOp } from "./ops";

export interface HttpResult<T = any> { status: number; data: T; blob?: Blob }
export interface HttpInit { org?: string; raw?: Blob | Uint8Array; contentType?: string; blob?: boolean; headers?: Record<string, string> }
/** Never throws for HTTP error statuses (returns them); throws only when the network is unreachable. */
export type Http = (method: string, path: string, body?: unknown, init?: HttpInit) => Promise<HttpResult>;

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  pendingOps: number;
  pendingUploads: number;
  signedOut: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface EngineDeps {
  db: LocalDb;
  http: Http;
  now?: () => number;
}

const BATCH = 50;
type Listener = (s: SyncStatus) => void;

export class SyncEngine {
  private db: LocalDb;
  private http: Http;
  private now: () => number;
  private listeners = new Set<Listener>();
  private busy: Promise<void> | null = null;
  private again = false;
  /** outbox rows currently being sent: never edited by coalescing */
  private inflight = new Set<number>();
  private st: SyncStatus = { online: true, syncing: false, pendingOps: 0, pendingUploads: 0, signedOut: false, lastSyncAt: null, lastError: null };
  /** called with a human-relevant notice (vehicle no longer accessible, op rejected, …) */
  onNotice?: (n: { kind: "gone" | "rejected" | "warning"; vehicleId?: string; code?: string; message?: string }) => void;
  onData?: () => void;

  constructor(d: EngineDeps) { this.db = d.db; this.http = d.http; this.now = d.now ?? Date.now; }

  get status() { return this.st; }
  subscribe(l: Listener) { this.listeners.add(l); l(this.st); return () => { this.listeners.delete(l); }; }
  private set(p: Partial<SyncStatus>) { this.st = { ...this.st, ...p }; this.listeners.forEach((l) => l(this.st)); }

  async refreshCounts() {
    this.set({ pendingOps: await this.db.outbox.count(), pendingUploads: await this.db.uploads.count() });
  }

  // ------------------------------------------------------------ local edits

  /** Optimistic local update + queue for the server. */
  async enqueue(op: Op, orgId: string, vehicleIdIn?: string): Promise<void> {
    const vehicleId = vehicleIdIn ?? vehicleIdOfOp(op)!;
    await this.db.transaction("rw", [this.db.outbox, this.db.vehicles, this.db.serverVehicles, this.db.photos, this.db.uploads, this.db.blobs, this.db.issues, this.db.meta], async () => {
      if (!(await this.coalesce(op, vehicleId))) await this.db.outbox.add({ orgId, op, vehicleId, createdAt: this.now() });
      if (op.type === "vehicle.delete") {
        await this.purgeVehicleLocal(vehicleId);
      } else if (!op.type.startsWith("photo.")) {
        await this.rebuildVehicle(vehicleId);
      }
    });
    await this.refreshCounts();
    this.onData?.();
  }

  /**
   * Typing in a field would otherwise queue one op per keystroke: merge into the previous UNSENT op of the same kind.
   * (header+header, shares+shares, same panel key). The newest time stamp wins, so last-writer-wins stays correct.
   */
  private async coalesce(op: Op, vehicleId: string): Promise<boolean> {
    if (op.type !== "vehicle.header" && op.type !== "vehicle.shares" && op.type !== "vehicle.panel") return false;
    const last = await this.db.outbox.where("vehicleId").equals(vehicleId).last();
    if (!last || (last.id != null && this.inflight.has(last.id))) return false;
    const p = last.op;
    if (p.type !== op.type) return false;
    let merged: Op | null = null;
    if (op.type === "vehicle.header" && p.type === "vehicle.header") merged = { ...p, at: op.at, fields: { ...p.fields, ...op.fields } };
    else if (op.type === "vehicle.shares" && p.type === "vehicle.shares") merged = { ...p, at: op.at, fields: { ...p.fields, ...op.fields } };
    else if (op.type === "vehicle.panel" && p.type === "vehicle.panel" && p.key === op.key) merged = { ...p, at: op.at, panel: op.panel };
    if (!merged) return false;
    await this.db.outbox.update(last.id!, { op: merged });
    return true;
  }

  async rebuildVehicle(id: string) {
    const server = (await this.db.serverVehicles.get(id)) ?? null;
    const pending = (await this.db.outbox.where("vehicleId").equals(id).sortBy("id")) as OutboxRow[];
    const v = rebuild(server, pending.filter((p) => p.op.type !== "vehicle.delete").map((p) => ({ op: p.op, orgId: p.orgId })));
    if (pending.some((p) => p.op.type === "vehicle.delete")) { await this.purgeVehicleLocal(id); return; }
    if (v) await this.db.vehicles.put(v); else await this.db.vehicles.delete(id);
  }

  private async purgeVehicleLocal(id: string) {
    await this.db.vehicles.delete(id);
    await this.db.serverVehicles.delete(id);
    const ph = await this.db.photos.where("vehicleId").equals(id).toArray();
    await this.db.photos.bulkDelete(ph.map((p) => p.id));
    await this.db.blobs.bulkDelete([...ph.map((p) => `photo:${p.id}`), `scan:${id}`]);
    await this.db.uploads.bulkDelete([...ph.map((p) => `photo:${p.id}`), `scan:${id}`]);
  }

  // ------------------------------------------------------------ push

  async flush(): Promise<void> {
    for (;;) {
      let rows = await this.db.outbox.orderBy("id").limit(BATCH).toArray();
      if (!rows.length) break;
      // newer op types travel in batches of their own, so an older server can never block (or drop) the older ops queued before them
      const firstOther = rows.findIndex((r) => isV3Op(r.op.type) !== isV3Op(rows[0].op.type));
      if (firstOther > 0) rows = rows.slice(0, firstOther);
      let res: Awaited<ReturnType<Http>>;
      rows.forEach((r) => this.inflight.add(r.id!));
      try {
        res = await this.http("POST", "/sync/push", { ops: rows.map((r) => r.op) });
      } catch (e) { rows.forEach((r) => this.inflight.delete(r.id!)); this.set({ online: false, lastError: (e as Error).message }); return; }
      rows.forEach((r) => this.inflight.delete(r.id!));
      if (res.status === 401) { this.set({ signedOut: true }); return; }
      if (res.status >= 500 || res.status === 429) { this.set({ lastError: `HTTP ${res.status}` }); return; }
      // the server does not know this op type yet (409), or rejects the whole batch because it is older than the app (400 on a v3 batch): keep it queued
      if ((res.status === 409 && res.data?.code === "unsupported_op") || (res.status === 400 && isV3Op(rows[0].op.type))) { this.set({ lastError: `HTTP ${res.status}` }); return; }
      if (res.status !== 200) {
        // the whole batch is malformed (400): isolate by dropping the first op so the queue cannot block forever
        const bad = rows[0];
        await this.addIssue(bad.orgId, bad.op.type, "invalid_input", String(res.data?.error ?? res.status), bad.vehicleId);
        await this.dropOpAndDependents(bad);
        continue;
      }
      this.set({ online: true, lastError: null });
      const { results } = res.data as PushResponse;
      const touched = new Set<string>();
      for (let i = 0; i < rows.length; i++) await this.applyResult(rows[i], results.find((r) => r.opId === rows[i].op.opId), touched);
      for (const id of touched) await this.rebuildVehicle(id);
      await this.refreshCounts();
      this.onData?.();
    }
  }

  private async applyResult(row: OutboxRow, r: OpResult | undefined, touched: Set<string>) {
    if (!r) return; // not answered: keep for the next round
    await this.db.outbox.delete(row.id!);
    touched.add(row.vehicleId);
    if (r.status === "ok") {
      for (const w of r.warnings ?? []) this.onNotice?.({ kind: "warning", vehicleId: row.vehicleId, code: w }); // accepted, but worth a look (site full, other tenant)
      // The server accepted it, but its snapshot on this phone is only refreshed by the next pull: advance the snapshot by the
      // acknowledged op meanwhile, otherwise the screen would briefly fall back to an older state (or lose a just-created vehicle).
      if (row.op.type.startsWith("vehicle.") && row.op.type !== "vehicle.delete") {
        const cur = ((await this.db.serverVehicles.get(row.vehicleId)) as LocalVehicle | undefined) ?? null;
        const next = applyOpLocal(cur, row.op, row.orgId);
        if (next) { const { _localOnly: _l, _pending: _p, ...clean } = next; await this.db.serverVehicles.put(clean as ClientVehicle); }
      }
      return;
    }
    if (r.status === "conflict") {
      if (r.vehicle) await this.db.serverVehicles.put(r.vehicle as ClientVehicle);
      return;
    }
    // rejected: the server refused this change; tell the user and fall back to the server's truth
    await this.addIssue(row.orgId, row.op.type, r.code ?? "not_allowed", r.message ?? "", row.vehicleId);
    this.onNotice?.({ kind: "rejected", vehicleId: row.vehicleId, code: r.code, message: r.message });
    if (row.op.type === "photo.add") {
      const id = row.op.photo.id;
      await this.db.photos.delete(id); await this.db.blobs.delete(`photo:${id}`); await this.db.uploads.delete(`photo:${id}`);
    }
    if (row.op.type === "report.send") { const k = `report:${row.op.report.id}`; await this.db.blobs.delete(k); await this.db.uploads.delete(k); }
    if (row.op.type === "vehicle.create" || r.code === "vehicle_not_found") await this.dropOpAndDependents(row, false);
  }

  private async dropOpAndDependents(row: OutboxRow, deleteRow = true) {
    if (deleteRow) await this.db.outbox.delete(row.id!);
    const isCreate = row.op.type === "vehicle.create";
    const hasServer = !!(await this.db.serverVehicles.get(row.vehicleId));
    if (isCreate || !hasServer) {
      // the vehicle never existed on the server: drop everything we hold for it
      const rest = await this.db.outbox.where("vehicleId").equals(row.vehicleId).primaryKeys();
      await this.db.outbox.bulkDelete(rest);
      await this.purgeVehicleLocal(row.vehicleId);
    } else {
      await this.rebuildVehicle(row.vehicleId);
    }
  }

  private addIssue(orgId: string, opType: string, code: string, message: string, vehicleId?: string) {
    return this.db.issues.add({ orgId, at: this.now(), opType, code, message, vehicleId, seen: false });
  }

  // ------------------------------------------------------------ pull

  async pull(orgId: string): Promise<void> {
    let since = (await this.db.getMeta<number>(cursorKey(orgId))) ?? 0;
    let epoch = (await this.db.getMeta<string>(epochKey(orgId))) ?? null;
    const seenV = new Set<string>(), seenP = new Set<string>();
    let resetting = false;
    for (let guard = 0; guard < 1000; guard++) {
      const q = new URLSearchParams({ since: String(since) });
      if (epoch) q.set("epoch", epoch);
      let res: Awaited<ReturnType<Http>>;
      try { res = await this.http("GET", `/sync/pull?${q}`, undefined, { org: orgId }); }
      catch (e) { this.set({ online: false, lastError: (e as Error).message }); return; }
      if (res.status === 401) { this.set({ signedOut: true }); return; }
      if (res.status === 403) { await this.wipeOrg(orgId); this.set({ online: true }); return; } // lost every role in this organisation
      if (res.status !== 200) { this.set({ lastError: `HTTP ${res.status}` }); return; }
      this.set({ online: true, lastError: null });
      const p = res.data as PullResponse;
      if (p.reset) { resetting = true; since = 0; }
      await this.applyPull(orgId, p, p.reset || resetting);
      p.vehicles.forEach((v) => seenV.add(v.id));
      p.photos.forEach((x) => seenP.add(x.id));
      await this.db.setMeta(refsKey(orgId), p.refs);
      await this.db.setMeta(epochKey(orgId), p.epoch);
      await this.db.setMeta(cursorKey(orgId), p.cursor);
      since = p.cursor; epoch = p.epoch;
      if (!p.hasMore) break;
    }
    if (resetting) await this.dropUnseen(orgId, seenV, seenP);
    this.set({ lastSyncAt: this.now() });
    this.onData?.();
  }

  private async applyPull(orgId: string, p: PullResponse, _reset: boolean) {
    // 1. changes the server may have made to vehicles we also edited: our pending ops go first (flush), then gone is applied
    if (p.gone.length) {
      const withPending = new Set((await this.db.outbox.where("vehicleId").anyOf(p.gone).toArray()).map((r) => r.vehicleId));
      if (withPending.size) await this.flush();
    }
    await this.db.transaction("rw", [this.db.vehicles, this.db.serverVehicles, this.db.photos, this.db.blobs, this.db.uploads, this.db.outbox, this.db.issues, this.db.meta], async () => {
      for (const v of p.vehicles) {
        await this.db.serverVehicles.put(v);
        await this.rebuildVehicle(v.id);
      }
      for (const id of p.gone) {
        const pending = await this.db.outbox.where("vehicleId").equals(id).count();
        const local = await this.db.vehicles.get(id);
        if (local?._localOnly && pending) continue; // created offline, not yet acknowledged
        if (local) this.onNotice?.({ kind: "gone", vehicleId: id });
        const rest = await this.db.outbox.where("vehicleId").equals(id).primaryKeys();
        await this.db.outbox.bulkDelete(rest);
        await this.purgeVehicleLocal(id);
      }
      for (const ph of p.photos) await this.applyPhoto(orgId, ph);
    });
    await this.refreshCounts();
  }

  private async applyPhoto(orgId: string, ph: ClientPhoto) {
    if (ph.deleted) {
      await this.db.photos.delete(ph.id); await this.db.blobs.delete(`photo:${ph.id}`); await this.db.uploads.delete(`photo:${ph.id}`);
      return;
    }
    const local = await this.db.photos.get(ph.id);
    const pendingOps = (await this.db.outbox.where("vehicleId").equals(ph.vehicleId).toArray()).filter((r) => r.op.type.startsWith("photo.") && JSON.stringify(r.op).includes(ph.id));
    const merged: LocalPhoto = pendingOps.length && local
      ? { ...local, hasFile: ph.hasFile || local.hasFile, seq: ph.seq }
      : { ...ph, orgId, _pending: false };
    await this.db.photos.put(merged);
  }

  private async dropUnseen(orgId: string, seenV: Set<string>, seenP: Set<string>) {
    const vs = await this.db.vehicles.where("orgId").equals(orgId).toArray();
    for (const v of vs) {
      if (seenV.has(v.id)) continue;
      if (v._localOnly) continue;
      if ((await this.db.outbox.where("vehicleId").equals(v.id).count()) > 0) continue;
      await this.purgeVehicleLocal(v.id);
      this.onNotice?.({ kind: "gone", vehicleId: v.id });
    }
    const ps = await this.db.photos.where("orgId").equals(orgId).toArray();
    for (const p of ps) if (!seenP.has(p.id) && !p._pending && !(await this.db.uploads.get(`photo:${p.id}`))) { await this.db.photos.delete(p.id); await this.db.blobs.delete(`photo:${p.id}`); }
  }

  /** The user has no role left in this organisation: nothing may stay on the phone. */
  async wipeOrg(orgId: string) {
    const vs = await this.db.vehicles.where("orgId").equals(orgId).toArray();
    for (const v of vs) { const rest = await this.db.outbox.where("vehicleId").equals(v.id).primaryKeys(); await this.db.outbox.bulkDelete(rest); await this.purgeVehicleLocal(v.id); }
    await this.db.meta.bulkDelete([cursorKey(orgId), epochKey(orgId), refsKey(orgId)]);
    this.onNotice?.({ kind: "gone" });
    await this.refreshCounts();
    this.onData?.();
  }

  // ------------------------------------------------------------ uploads

  async runUploads(): Promise<void> {
    const rows = await this.db.uploads.toArray();
    for (const u of rows) {
      if (u.nextTry > this.now()) continue;
      const pendingFor = await this.db.outbox.where("vehicleId").equals(u.vehicleId).toArray();
      const waiting = u.kind === "photo"
        ? pendingFor.some((r) => r.op.type === "photo.add" && r.op.photo.id === u.refId)
        : u.kind === "report"
          ? pendingFor.some((r) => r.op.type === "vehicle.create" || (r.op.type === "report.send" && r.op.report.id === u.refId))
          : pendingFor.some((r) => r.op.type === "vehicle.create" || r.op.type === "vehicle.colibri");
      if (waiting) continue;
      const b = await this.db.blobs.get(u.key);
      if (!b) { await this.db.uploads.delete(u.key); continue; }
      let res: Awaited<ReturnType<Http>>;
      try {
        const path = u.kind === "photo" ? `/files/photo/${u.refId}` : u.kind === "report" ? `/files/report/${u.refId}` : `/files/colibri/${u.refId}`;
        res = await this.http("PUT", path, undefined, { raw: b.blob, contentType: b.type, headers: u.kind === "report" ? { "x-filename": b.name ?? "" } : undefined });
      } catch (e) { this.set({ online: false, lastError: (e as Error).message }); return; }
      if (res.status === 200) {
        await this.db.uploads.delete(u.key);
        if (u.kind === "report") await this.db.blobs.delete(u.key); // sent: the PDF is not needed on the phone any more
        if (u.kind === "photo") await this.db.photos.update(u.refId, { hasFile: true });
      } else if (res.status === 401) { this.set({ signedOut: true }); return; }
      else if (res.status === 400 || res.status === 403 || (res.status === 404 && u.kind === "report")) {
        await this.addIssue(u.orgId, `upload.${u.kind}`, res.status === 403 ? "forbidden" : "file_type", String(res.data?.error ?? ""), u.vehicleId);
        await this.db.uploads.delete(u.key);
      } else {
        const tries = u.tries + 1;
        await this.db.uploads.update(u.key, { tries, nextTry: this.now() + Math.min(300_000, 2000 * 2 ** tries) });
      }
    }
    await this.refreshCounts();
  }

  /** Downloads a photo into the local cache (so it also works offline later). */
  async ensurePhotoBlob(id: string): Promise<Blob | null> {
    const have = await this.db.blobs.get(`photo:${id}`);
    if (have) return have.blob;
    try {
      const r = await this.http("GET", `/files/photo/${id}`, undefined, { blob: true });
      if (r.status !== 200 || !r.blob) return null;
      await this.db.blobs.put({ key: `photo:${id}`, blob: r.blob, type: r.blob.type, size: r.blob.size });
      return r.blob;
    } catch { return null; }
  }
  /** Letterhead logo (cached on the phone so PDFs can be built offline). */
  async ensureLogoBlob(companyId: string, orgId: string): Promise<Blob | null> {
    const key = `logo:${companyId}`;
    const have = await this.db.blobs.get(key);
    if (have) return have.blob;
    try {
      const r = await this.http("GET", `/admin/companies/${companyId}/logo`, undefined, { blob: true, org: orgId });
      if (r.status !== 200 || !r.blob) return null;
      await this.db.blobs.put({ key, blob: r.blob, type: r.blob.type, size: r.blob.size });
      return r.blob;
    } catch { return null; }
  }
  async ensureScanBlob(vehicleId: string): Promise<Blob | null> {
    const have = await this.db.blobs.get(`scan:${vehicleId}`);
    if (have) return have.blob;
    try {
      const r = await this.http("GET", `/files/colibri/${vehicleId}`, undefined, { blob: true });
      if (r.status !== 200 || !r.blob) return null;
      await this.db.blobs.put({ key: `scan:${vehicleId}`, blob: r.blob, type: "application/pdf", size: r.blob.size });
      return r.blob;
    } catch { return null; }
  }

  // ------------------------------------------------------------ orchestration

  /** push → pull → uploads; concurrent calls are merged into one more round. */
  syncNow(orgId: string | null): Promise<void> {
    if (this.busy) { this.again = true; return this.busy; }
    this.busy = (async () => {
      this.set({ syncing: true });
      try {
        do {
          this.again = false;
          if (this.st.signedOut) break;
          await this.flush();
          if (orgId) await this.pull(orgId);
          await this.runUploads();
        } while (this.again);
      } finally {
        this.busy = null;
        this.set({ syncing: false });
        await this.refreshCounts();
      }
    })();
    return this.busy;
  }

  resetSignedOut() { this.set({ signedOut: false }); }
}
