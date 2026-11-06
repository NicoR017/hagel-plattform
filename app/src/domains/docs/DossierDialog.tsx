import { useEffect, useState } from "react";
import { api } from "../../api";
import { t, type Key } from "../../shared/i18n";
import type { LocalVehicle } from "../../shared/sync/db";
import { toast } from "../../shared/toast";
import { Dialog, Field } from "../../shared/ui";

interface Item { key: string; kind: string; ready: boolean; label: string; documentId?: string; number?: string | null }
interface Checklist { items: Item[]; recipients: { to: string[]; cc: string[] }; lang: string }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const errText = (e: unknown) => (e as Error).message || String(e);

function Emails({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  const [draft, setDraft] = useState("");
  const add = () => { const x = draft.trim().toLowerCase(); if (x && EMAIL.test(x) && !value.includes(x)) { onChange([...value, x]); setDraft(""); } };
  return (
    <Field label={label}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>{value.map((e) => <span key={e} className="pill">{e} <a href="#" onClick={(ev) => { ev.preventDefault(); onChange(value.filter((x) => x !== e)); }}>✕</a></span>)}</div>
      <input className="inp" type="email" value={draft} placeholder="name@example.com" onChange={(e) => setDraft(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} />
    </Field>
  );
}

/** D40: "Send repair dossier" — ONE e-mail to the insurer with every document of the repair; the checklist shows ready vs missing; it may leave with documents missing (the e-mail says what follows). */
export function DossierDialog({ v, onClose, onDone }: { v: LocalVehicle; onClose: () => void; onDone: () => void }) {
  const [cl, setCl] = useState<Checklist | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [to, setTo] = useState<string[]>([]), [cc, setCc] = useState<string[]>([]), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => {
    api<Checklist>("GET", `/vehicles/${v.id}/dossier`).then((c) => {
      setCl(c); setTo(c.recipients.to); setCc(c.recipients.cc);
      setSel(c.items.filter((i) => i.ready && (i.key === "repairReport" || i.key === "receipts" || i.key.startsWith("doc:"))).map((i) => i.key)); // the estimate is selectable, not pre-selected
    }).catch((e) => setErr(errText(e)));
  }, [v.id]);
  const label = (i: Item) => (i.key === "repairReport" ? t("f6ItemRepairReport") : i.key === "estimate" ? t("f6ItemEstimate") : i.key === "receipts" ? t("f6ItemReceipts") : `${t(`f6T_${i.kind}` as Key)}${i.number ? ` · ${i.number}` : ""}`);
  const toggle = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const send = async () => {
    if (!cl) return;
    if (!sel.length) { setErr(t("f6NothingSelected")); return; }
    if (!to.length) { setErr(t("f6NeedTo")); return; }
    setBusy(true); setErr("");
    try {
      const r = await api<{ missing: string[] }>("POST", `/vehicles/${v.id}/dossier/send`, {
        to, cc, note: note.trim() || undefined,
        include: { repairReport: sel.includes("repairReport"), estimate: sel.includes("estimate"), receipts: sel.includes("receipts"), documentIds: sel.filter((k) => k.startsWith("doc:")).map((k) => k.slice(4)) },
      });
      toast(r.missing.length ? `${t("f6SentOk")} ${t("f6SentMissing").replace("{list}", r.missing.map((m) => t(`f6T_${m}` as Key)).join(", "))}` : t("f6SentOk"), 7000);
      onDone();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Dialog title={t("f6DossierTitle")} onClose={onClose}>
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{t("f6DossierHint")}</div>
      {!cl && !err && <p className="muted">{t("loading")}</p>}
      {cl && (
        <>
          <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {cl.items.map((i) => (
              <li key={i.key}>
                <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 40, opacity: i.ready ? 1 : 0.6 }}>
                  <input type="checkbox" style={{ width: 24, height: 24, minHeight: 0 }} disabled={!i.ready} checked={sel.includes(i.key)} onChange={() => toggle(i.key)} />
                  <span style={{ flex: 1 }}>{label(i)}</span>
                  <span className="badge" style={{ background: i.ready ? "#E3F4EA" : "#FDF0E1", color: i.ready ? "#17663F" : "#8A4A06", fontSize: 11 }}>{i.ready ? t("f6Ready") : t("f6StillMissing")}</span>
                </label>
              </li>
            ))}
          </ul>
          <Emails label={t("f6To")} value={to} onChange={setTo} />
          <Emails label={t("f6Cc")} value={cc} onChange={setCc} />
          <Field label={t("f6Note")}><textarea className="inp" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </>
      )}
      {err && <div className="err">{err}</div>}
      <button className="pbtn" disabled={!cl || busy} onClick={() => void send()}>✉ {t("f6Send")}</button>
    </Dialog>
  );
}
