import { useEffect, useState } from "react";
import type { LocalVehicle } from "../sync/db";
import { assignVehicle, moveVehicle, setShares, setStatus } from "../sync/mutations";
import { LANG_LIST, getLang, setLang, t, tOr } from "../i18n";
import { api } from "../api";
import { buildOldFormatBackup } from "../sync/exportBackup";
import { shareOrDownload } from "./docs";
import { Dialog, Field, NumInput, Seg } from "./ui";
import { useField, useIssues, useVehicle } from "./store";
import { toast } from "./toast";
import { Occ } from "./occupancy";
import type { Key } from "../i18n";
import { STATUSES } from "@hagel/shared";

export const statusLabel = (s: string) => t(("st." + s) as Key);
export const HOLD_REASONS = ["Teile", "Freigabe", "Demontage", "Sonstiges"] as const;
export const holdReasonLabel = (r: string) => tOr("hold." + r, r);

/** Change status of one or many vehicles. "On hold" requires a reason. */
export function StatusDialog({ ids, current, onClose, onDone }: { ids: string[]; current?: string; onClose: () => void; onDone?: () => void }) {
  const f = useField();
  const [statut, setSt] = useState(current ?? "besichtigung");
  // leaving 'on hold' offers the status the car had before (the server remembers it)
  const before = useVehicle(ids[0] ?? "");
  const prev = current === "attente" && ids.length === 1 ? ((before?.statutAvant as string | null | undefined) ?? null) : null;
  useEffect(() => { if (prev) setSt(prev); }, [prev]);
  const [reason, setReason] = useState<string>("Teile");
  const [other, setOther] = useState("");
  const motif = statut === "attente" ? (reason === "Sonstiges" ? other.trim() : reason) : "";
  const valid = statut !== "attente" || !!motif;
  return (
    <Dialog title={t("changeStatus")} onClose={onClose}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {STATUSES.map((s) => <button key={s} className={"chip" + (s === statut ? " on" : "")} onClick={() => setSt(s)}>{s === prev ? "↩ " : ""}{statusLabel(s)}</button>)}
      </div>
      {statut === "attente" && (
        <div style={{ marginTop: 14 }}>
          <Field label={t("holdReason")}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {HOLD_REASONS.map((r) => <button key={r} className={"chip" + (r === reason ? " on" : "")} onClick={() => setReason(r)}>{holdReasonLabel(r)}</button>)}
            </div>
          </Field>
          {reason === "Sonstiges" && <input className="inp" value={other} placeholder={t("holdOther")} onChange={(e) => setOther(e.target.value)} />}
        </div>
      )}
      <button className="pbtn" disabled={!valid} onClick={async () => {
        for (const id of ids) await setStatus(f.mut, id, statut, motif || undefined);
        toast(`${ids.length} → ${statusLabel(statut)}`);
        onDone?.(); onClose();
      }}>{t("apply")}</button>
    </Dialog>
  );
}

/** Move to another site (right on the source site is checked by the server; the customer does not change). */
export function MoveDialog({ ids, from, onClose, onDone }: { ids: string[]; from?: string | null; onClose: () => void; onDone?: () => void }) {
  const f = useField();
  const sites = (f.refs?.stations ?? []).filter((s) => s.active && s.id !== from);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const dest = sites.find((s) => s.id === to);
  const occ = f.refs?.occupancy ?? {};
  const src = (f.refs?.stations ?? []).find((s) => s.id === from);
  // the server warns when the site is already full before the move; show the same warning as soon as the move would fill it
  const full = !!dest && dest.capacite > 0 && (occ[dest.id] ?? 0) + ids.length > dest.capacite;
  const tenantDiffers = !!dest && !!src?.azureTenant && !!dest.azureTenant && src.azureTenant !== dest.azureTenant;
  return (
    <Dialog title={t("moveTitle")} onClose={onClose}>
      <Field label={t("moveTo")}>
        <select className="sel" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">—</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.capacite ? ` (${occ[s.id] ?? 0}/${s.capacite})` : ""}</option>)}
        </select>
        {dest && (
          <div style={{ marginTop: 8 }}>
            <Occ present={(occ[dest.id] ?? 0) + ids.length} capacity={dest.capacite} /> <span className="muted" style={{ fontSize: 12 }}>{t("occupancy")} {t("afterMove")}</span>
            {full && <div style={{ color: "var(--brick)", fontSize: 13, marginTop: 4 }}>⚠ {t("moveFullWarn")}</div>}
            {tenantDiffers && <div style={{ color: "var(--brick)", fontSize: 13, marginTop: 4 }}>⚠ {t("moveTenantWarn")}</div>}
          </div>
        )}
      </Field>
      <Field label={t("moveNote")}><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="muted" style={{ fontSize: 12 }}>{t("moveHint")}</div>
      <button className="pbtn" disabled={!dest} onClick={async () => {
        for (const id of ids) await moveVehicle(f.mut, id, to, note || undefined);
        toast(`${ids.length} → ${dest!.name}`);
        onDone?.(); onClose();
      }}>{t("apply")}</button>
    </Dialog>
  );
}

/** Technician + percentage for a selection (internal split, never on customer documents). */
export function SharesDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone?: () => void }) {
  const f = useField();
  const [tn, setTn] = useState(""), [tp, setTp] = useState(50), [dn, setDn] = useState(""), [dp, setDp] = useState(100);
  return (
    <Dialog title={`${t("sharesFor")} ${ids.length}`} onClose={onClose}>
      <Field label={t("techPdr")}>
        <input className="inp" value={tn} placeholder={t("nameKeep")} onChange={(e) => setTn(e.target.value)} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          {[40, 45, 50, 55, 60].map((p) => <button key={p} className={"chip" + (tp === p ? " on" : "")} onClick={() => setTp(p)}>{p}</button>)}
          <NumInput value={tp} onChange={setTp} max={100} style={{ width: 84 }} /> %
        </div>
      </Field>
      <Field label={t("techDem")}>
        <input className="inp" value={dn} placeholder={t("nameSameAsPdr")} onChange={(e) => setDn(e.target.value)} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          {[50, 70, 80, 100].map((p) => <button key={p} className={"chip" + (dp === p ? " on" : "")} onClick={() => setDp(p)}>{p}</button>)}
          <NumInput value={dp} onChange={setDp} max={100} style={{ width: 84 }} /> %
        </div>
      </Field>
      <button className="pbtn" onClick={async () => {
        for (const id of ids) await setShares(f.mut, id, { ...(tn.trim() ? { techName: tn.trim() } : {}), techPct: tp, ...(dn.trim() ? { demTechName: dn.trim() } : {}), demTechPct: dp });
        toast(`${t("sharesSet")} (${ids.length})`);
        onDone?.(); onClose();
      }}>{t("apply")}</button>
    </Dialog>
  );
}

/** Assign people (users of the organisation) to vehicles. Needs vehicules.assigner. */
export function AssignDialog({ ids, vehicles, onClose, onDone }: { ids: string[]; vehicles: LocalVehicle[]; onClose: () => void; onDone?: () => void }) {
  const f = useField();
  const people = f.refs?.people ?? [];
  const first = vehicles.find((v) => v.id === ids[0]);
  const [sel, setSel] = useState<string[]>(ids.length === 1 ? first?.assigneeIds ?? [] : []);
  return (
    <Dialog title={t("assignTitle")} onClose={onClose}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {people.map((p) => <button key={p.id} className={"chip" + (sel.includes(p.id) ? " on" : "")} onClick={() => setSel((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}>{p.name}</button>)}
        {!people.length && <span className="muted">{t("noData")}</span>}
      </div>
      <button className="pbtn" onClick={async () => {
        for (const id of ids) await assignVehicle(f.mut, id, "pdr", sel);
        toast(t("assigned"));
        onDone?.(); onClose();
      }}>{t("apply")}</button>
    </Dialog>
  );
}

/** Settings for the person on this phone: language, organisation defaults for admins, what is waiting to be synced. */
export function SettingsDialog({ onClose, onBackup }: { onClose: () => void; onBackup: () => void }) {
  const f = useField();
  const issues = useIssues();
  const canSettings = f.can("parametres.gerer");
  const s = f.refs?.settings;
  const [rateDE, setRateDE] = useState(s?.rateDE ?? 83), [rateES, setRateES] = useState(s?.rateES ?? 69), [teiler, setTeiler] = useState<10 | 12>((s?.defaultTeiler as 10 | 12) ?? 10);
  return (
    <Dialog title={t("settings")} onClose={onClose}>
      <Field label={t("language")}>
        <Seg value={getLang()} options={LANG_LIST.map((l) => ({ value: l, label: l.toUpperCase() }))} onChange={(l) => { setLang(l); void api("PUT", "/me/language", { language: l }).catch(() => undefined); }} />
      </Field>
      {canSettings && (
        <>
          <Field label={t("rateDE")}><NumInput value={rateDE} onChange={setRateDE} max={1000} /></Field>
          <Field label={t("rateES")}><NumInput value={rateES} onChange={setRateES} max={1000} /></Field>
          <Field label={t("teiler")}><Seg value={teiler} options={[{ value: 10, label: "10" }, { value: 12, label: "12" }]} onChange={setTeiler} /></Field>
          <button className="pbtn sec" onClick={async () => {
            try { await api("PUT", "/admin/settings", { rateDE, rateES, defaultTeiler: teiler }); toast(t("saved")); void f.engine.syncNow(f.orgId); } catch (e) { toast((e as Error).message); }
          }}>{t("save")}</button>
        </>
      )}
      <button className="pbtn sec" onClick={() => { onClose(); onBackup(); }}>{t("importOldBackup")}</button>
      <button className="pbtn sec" onClick={async () => {
        const r = await buildOldFormatBackup(f.db, f.orgId, f.refs, false);
        await shareOrDownload(new Blob([r.json], { type: "application/json" }), `Hagel-Sicherung_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.json`, "application/json");
        toast(`${r.vehicles} ${t("vehiclesWord")} · ${r.photos} ${t("photosWord")}`);
      }}>💾 {t("exportBackup")}</button>
      <div className="muted" style={{ fontSize: 12, marginTop: 14 }}>
        {t("syncStatus")}: {f.status.online ? t("online") : t("offline")} · {f.status.pendingOps + f.status.pendingUploads} {t("pending")}
        {f.status.lastSyncAt ? ` · ${new Date(f.status.lastSyncAt).toLocaleTimeString()}` : ""}
      </div>
      {!!issues.length && (
        <div className="notice err" style={{ marginTop: 10 }}>
          <b>{t("issues")}</b>
          {issues.slice(0, 6).map((i) => <div key={i.id}>{i.opType}: {i.message || i.code}</div>)}
          <button className="chip" style={{ marginTop: 8 }} onClick={() => void f.db.issues.where("orgId").equals(f.orgId).modify({ seen: true })}>{t("dismiss")}</button>
        </div>
      )}
    </Dialog>
  );
}

/** Searchable list of customer carrosseries. */
export function CustomerPicker({ value, onPick, onClose }: { value: string | null; onPick: (id: string | null) => void; onClose: () => void }) {
  const f = useField();
  const [q, setQ] = useState("");
  const list = (f.refs?.stations ?? []).filter((s) => s.type === "carrosserie" && s.active && s.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog title={t("customer")} onClose={onClose}>
      <input className="inp" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div style={{ marginTop: 10 }}>
        {list.map((s) => (
          <button key={s.id} className="kpick" style={{ marginBottom: 6, border: s.id === value ? "2px solid var(--greenDk)" : undefined }} onClick={() => { onPick(s.id); onClose(); }}>
            <b>{s.name}</b><span className="muted">{s.country}</span>
          </button>
        ))}
        {!list.length && <div className="muted">{t("noData")}</div>}
      </div>
    </Dialog>
  );
}
