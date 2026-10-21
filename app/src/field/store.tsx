import { reportSyncState } from "./updateGate";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Settings } from "@hagel/calc";
import { httpFetch, startEvents } from "../api";
import { t } from "../i18n";
import { LocalDb, refsKey, type LocalPhoto, type LocalVehicle, type Refs } from "../sync/db";
import { SyncEngine, type SyncStatus } from "../sync/engine";
import { calcSettingsOf, type MutCtx } from "../sync/mutations";
import { calcWith } from "./calc";
import type { CalcResult } from "@hagel/calc";
import { toast } from "./toast";

export interface FieldCtx {
  db: LocalDb;
  engine: SyncEngine;
  orgId: string;
  refs: Refs | undefined;
  status: SyncStatus;
  calc: Settings;
  /** amounts of a vehicle, with the method version frozen on it (same numbers as the server) */
  calcOf: (v: unknown) => CalcResult;
  mut: MutCtx;
  can: (permission: string) => boolean;
  stationName: (id: string | null | undefined) => string;
}
const Ctx = createContext<FieldCtx | null>(null);
export const useField = () => { const c = useContext(Ctx); if (!c) throw new Error("FieldProvider missing"); return c; };

const sessions = new Map<string, { db: LocalDb; engine: SyncEngine }>();
/** One local database per user on this phone (no mixing of data between accounts). */
function sessionFor(userId: string) {
  let s = sessions.get(userId);
  if (!s) {
    const db = new LocalDb(`hagel-${userId}`);
    s = { db, engine: new SyncEngine({ db, http: httpFetch }) };
    sessions.set(userId, s);
  }
  return s;
}

export function FieldProvider({ userId, orgId, children }: { userId: string; orgId: string; children: ReactNode }) {
  const { db, engine } = useMemo(() => sessionFor(userId), [userId]);
  const [status, setStatus] = useState<SyncStatus>(engine.status);
  const refs = useLiveQuery(() => db.getMeta<Refs>(refsKey(orgId)), [orgId, db]);

  useEffect(() => engine.subscribe((st) => { reportSyncState(st); setStatus(st); }), [engine]);
  useEffect(() => {
    engine.onNotice = (n) => {
      if (n.kind === "gone") toast(t("noticeGone"), 6000);
      else if (n.kind === "warning") toast(`⚠ ${t(("w." + n.code) as never)}`, 7000);
      else if (n.kind === "rejected") toast(`${t("noticeRejected")}${n.message ? `: ${n.message}` : ""}`, 6000);
    };
    return () => { engine.onNotice = undefined; };
  }, [engine]);

  const syncing = useRef(false);
  useEffect(() => {
    const run = () => { if (syncing.current) return; syncing.current = true; engine.syncNow(orgId).finally(() => { syncing.current = false; }); };
    run();
    const stopEvents = startEvents(orgId, () => void engine.syncNow(orgId));
    const onOnline = () => { engine.resetSignedOut(); void engine.syncNow(orgId); };
    const onVisible = () => { if (document.visibilityState === "visible") void engine.syncNow(orgId); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const iv = setInterval(() => void engine.syncNow(orgId), 60_000);
    // ask the browser not to evict the offline data
    void navigator.storage?.persist?.().catch(() => undefined);
    return () => { stopEvents(); window.removeEventListener("online", onOnline); document.removeEventListener("visibilitychange", onVisible); clearInterval(iv); };
  }, [engine, orgId]);

  const value = useMemo<FieldCtx>(() => {
    const perms = new Set(refs?.me.permissions ?? []);
    const calc = calcSettingsOf(refs?.settings);
    return {
      db, engine, orgId, refs, status, calc, calcOf: (v) => calcWith(v, calc, refs), mut: { engine, db, orgId },
      can: (p) => perms.has(p),
      stationName: (id) => (id ? refs?.stations.find((s) => s.id === id)?.name ?? "" : ""),
    };
  }, [db, engine, orgId, refs, status]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVehicles(): LocalVehicle[] {
  const { db, orgId } = useField();
  return useLiveQuery(() => db.vehicles.where("orgId").equals(orgId).toArray(), [db, orgId]) ?? [];
}
export function useVehicle(id: string): LocalVehicle | null | undefined {
  const { db } = useField();
  return useLiveQuery(async () => (await db.vehicles.get(id)) ?? null, [db, id]);
}
export function usePhotos(vehicleId: string): LocalPhoto[] {
  const { db } = useField();
  return useLiveQuery(() => db.photos.where("vehicleId").equals(vehicleId).sortBy("sort"), [db, vehicleId]) ?? [];
}
export function useIssues() {
  const { db, orgId } = useField();
  return useLiveQuery(() => db.issues.where("orgId").equals(orgId).filter((i) => !i.seen).toArray(), [db, orgId]) ?? [];
}

/** Object URL for a locally stored photo; downloads it once from the server when missing. */
export function usePhotoUrl(photo: Pick<LocalPhoto, "id" | "hasFile"> | undefined): string | null {
  const { db, engine } = useField();
  const blob = useLiveQuery(async () => (photo ? (await db.blobs.get(`photo:${photo.id}`))?.blob ?? null : null), [db, photo?.id]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (photo && blob === null && photo.hasFile) void engine.ensurePhotoBlob(photo.id);
  }, [photo?.id, photo?.hasFile, blob, engine]);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
