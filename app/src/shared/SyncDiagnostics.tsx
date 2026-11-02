import { useLiveQuery } from "dexie-react-hooks";
import { Dialog } from "./ui";
import { t } from "./i18n";
import { useField } from "./store";
import { toast } from "./toast";

const clock = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : "—");

/** What blocks the sync: queued changes and files with the reason of their last failed attempt, recent errors, and a log you can copy. */
export function SyncDiagnostics({ onClose }: { onClose: () => void }) {
  const f = useField();
  const { db, engine, status } = f;
  const ops = useLiveQuery(() => db.outbox.orderBy("id").toArray(), [db, status.pendingOps, status.lastError, status.syncing]) ?? [];
  const uploads = useLiveQuery(() => db.uploads.toArray(), [db, status.pendingUploads, status.lastError, status.syncing]) ?? [];
  const issues = useLiveQuery(() => db.issues.orderBy("id").reverse().limit(15).toArray(), [db, status.pendingOps, status.syncing]) ?? [];
  const plates = useLiveQuery(async () => {
    const ids = [...new Set([...ops.map((o) => o.vehicleId), ...uploads.map((u) => u.vehicleId), ...issues.flatMap((i) => (i.vehicleId ? [i.vehicleId] : []))])];
    const vs = await db.vehicles.bulkGet(ids);
    return Object.fromEntries(ids.map((id, i) => [id, String((vs[i] as { kennzeichen?: string } | undefined)?.kennzeichen ?? "")]));
  }, [db, ops.length, uploads.length, issues.length]) ?? {};
  const label = (id: string) => plates[id] || id.slice(0, 8);
  const events = engine.log;

  const hint = !status.online ? t("v10SyncHintOffline") : status.signedOut ? t("v10SyncHintAuth") : status.lastError?.startsWith("HTTP 5") ? t("v10SyncHintServer") : null;

  const text = () => [
    `Hagel sync log ${new Date().toISOString()}`,
    `online=${status.online} syncing=${status.syncing} signedOut=${status.signedOut} lastSync=${clock(status.lastSyncAt)} lastError=${status.lastError ?? "-"}`,
    `UA: ${navigator.userAgent}`,
    "", `Queued changes (${ops.length}):`,
    ...ops.map((o) => `- ${o.op.type} ${label(o.vehicleId)} created=${clock(o.createdAt)} tries=${o.tries ?? 0} lastTry=${clock(o.lastTryAt)} error=${o.lastError ?? "-"}`),
    "", `Queued files (${uploads.length}):`,
    ...uploads.map((u) => `- ${u.kind} ${label(u.vehicleId)} tries=${u.tries} next=${clock(u.nextTry)} error=${u.lastError ?? "-"}`),
    "", "Recent rejections:",
    ...issues.map((i) => `- ${clock(i.at)} ${i.opType} ${i.code} ${i.message} ${i.vehicleId ? label(i.vehicleId) : ""}`),
    "", "Events:",
    ...events.map((e) => `- ${clock(e.at)} [${e.level}] ${e.msg}`),
  ].join("\n");

  const copy = async () => {
    try { await navigator.clipboard.writeText(text()); toast(t("v10SyncCopied")); }
    catch { window.prompt(t("v10SyncCopy"), text()); }
  };

  const box = { background: "var(--bg, #f4f6f9)", borderRadius: 10, padding: "8px 10px", marginBottom: 6, fontSize: 13 } as const;
  const bad = { color: "var(--brick, #a23b2e)" } as const;
  return (
    <Dialog title={t("v10SyncTitle")} onClose={onClose}>
      <div style={{ ...box, background: status.online && !status.signedOut && !status.lastError ? "#e4eee5" : "#fdf6e3" }}>
        <div><b>{status.online ? t("online") : t("offline")}</b>{status.syncing ? ` · ${t("syncing")}` : ""}{status.signedOut ? ` · ${t("v10SyncSignedOut")}` : ""}</div>
        <div className="muted">{t("v10SyncLastOk")}: {clock(status.lastSyncAt)}</div>
        {status.lastError && <div style={{ ...bad, fontWeight: 700 }}>{t("v10SyncLastError")}: {status.lastError}</div>}
        {hint && <div className="muted" style={{ marginTop: 4 }}>💡 {hint}</div>}
      </div>

      {!ops.length && !uploads.length && <div className="muted" style={{ padding: "6px 2px" }}>{t("v10SyncNothing")}</div>}

      {ops.length > 0 && <h4 style={{ margin: "12px 0 6px" }}>{t("v10SyncOps")} ({ops.length})</h4>}
      {ops.map((o) => (
        <div key={o.id} style={box}>
          <div><b>{o.op.type}</b> · {label(o.vehicleId)}</div>
          <div className="muted">{clock(o.createdAt)}{o.tries ? ` · ${t("v10SyncTries")}: ${o.tries}` : ""}</div>
          {o.lastError ? <div style={bad}>{o.lastError}</div> : <div className="muted">{t("v10SyncWaiting")}</div>}
        </div>
      ))}

      {uploads.length > 0 && <h4 style={{ margin: "12px 0 6px" }}>{t("v10SyncUploads")} ({uploads.length})</h4>}
      {uploads.map((u) => (
        <div key={u.key} style={box}>
          <div><b>{u.kind}</b> · {label(u.vehicleId)}</div>
          <div className="muted">{t("v10SyncTries")}: {u.tries}{u.nextTry > Date.now() ? ` · ${t("v10SyncNextTry")}: ${clock(u.nextTry)}` : ""}</div>
          {u.lastError ? <div style={bad}>{u.lastError}</div> : <div className="muted">{t("v10SyncWaitingOp")}</div>}
        </div>
      ))}

      {issues.length > 0 && <h4 style={{ margin: "12px 0 6px" }}>{t("v10SyncIssues")}</h4>}
      {issues.map((i) => (
        <div key={i.id} style={box}>
          <div><b>{i.opType}</b> · {i.code}{i.vehicleId ? ` · ${label(i.vehicleId)}` : ""}</div>
          <div className="muted">{clock(i.at)}{i.message ? ` · ${i.message}` : ""}</div>
        </div>
      ))}

      {events.length > 0 && <h4 style={{ margin: "12px 0 6px" }}>{t("v10SyncLog")}</h4>}
      {[...events].reverse().slice(0, 30).map((e, i) => (
        <div key={i} className="muted" style={{ fontSize: 12, fontFamily: "monospace", wordBreak: "break-word" }}>{clock(e.at)} [{e.level}] {e.msg}</div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button className="pbtn" style={{ flex: 1, marginTop: 0 }} onClick={() => { engine.resetSignedOut(); void engine.syncNow(f.orgId); }}>{t("v10SyncRetry")}</button>
        <button className="pbtn sec" style={{ flex: 1, marginTop: 0 }} onClick={() => void copy()}>{t("v10SyncCopy")}</button>
      </div>
    </Dialog>
  );
}
