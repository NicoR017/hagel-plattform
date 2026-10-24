import { useEffect, useState } from "react";
import { api, httpFetch } from "../api";
import { fmtDateTime, t, type Key } from "../i18n";
import type { LocalVehicle } from "../sync/db";
import { signHandover } from "../sync/mutations";
import { shareOrDownload } from "../field/docs";
import { useField } from "../field/store";
import { toast } from "../field/toast";
import { Dialog, Field } from "../field/ui";
import { SignaturePad, type Strokes } from "./SignaturePad";

export interface HandoverRow {
  id: string; kind: "drop_off" | "pick_up"; customerName: string; customerEmail: string | null; remarks: string; signedAt: string; signedBy: string; station: string;
  mailStatus: "sent" | "failed" | null; mailError: string | null; replaced: boolean; hasReceipt: boolean; sendReceipt: boolean;
}

/** The signatures of one car with the customer's data: station staff only (the server answers 404 to everybody else; offline = nothing). */
export function useHandovers(vehicleId: string, enabled: boolean, stamp: unknown) {
  const [rows, setRows] = useState<HandoverRow[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !navigator.onLine) { setRows(null); return; }
    let live = true;
    api<HandoverRow[]>("GET", `/vehicles/${vehicleId}/handovers`).then((r) => live && setRows(r)).catch(() => live && setRows(null));
    return () => { live = false; };
  }, [vehicleId, enabled, stamp, tick]);
  return { rows, reload: () => setTick((n) => n + 1) };
}

/** Download the signed receipt (PDF). */
export async function downloadReceipt(id: string, fileHint: string) {
  const r = await httpFetch("GET", `/handovers/${id}/receipt`, undefined, { blob: true });
  if (r.status !== 200 || !r.blob) { toast(t("hoReceiptFailed"), 5000); return; }
  await shareOrDownload(r.blob, `${fileHint}.pdf`, "application/pdf");
}

/**
 * D17 (the car is left) / D18 (the car is taken back): the customer writes his name, may leave an e-mail and remarks (existing damage), and signs
 * with the finger. Date and time are set automatically. Not blocking: "Later" closes it and the card keeps the button. Works offline.
 */
export function HandoverDialog({ v, kind, onClose, onSigned }: { v: LocalVehicle; kind: "drop_off" | "pick_up"; onClose: () => void; onSigned?: () => void }) {
  const f = useField();
  const x = v as Record<string, unknown>;
  const booking = (v.repair as { booking?: { email?: string } | null } | null | undefined)?.booking;
  const [name, setName] = useState("");
  const [email, setEmail] = useState(String(booking?.email || x.kundeEmail || ""));
  const [send, setSend] = useState(true);
  const [remarks, setRemarks] = useState("");
  const [strokes, setStrokes] = useState<Strokes>([]);
  const [busy, setBusy] = useState(false);
  const station = f.refs?.stations.find((s) => s.id === v.stationId)?.name ?? "";
  const now = new Date();

  // pick-up: the name (and e-mail) of the drop-off come back (station staff, online); nothing to do when that is not possible
  useEffect(() => {
    if (kind !== "pick_up" || !navigator.onLine) return;
    let live = true;
    api<HandoverRow[]>("GET", `/vehicles/${v.id}/handovers`).then((r) => {
      const d = r.filter((h) => h.kind === "drop_off" && !h.replaced).at(-1);
      if (live && d) { setName((n) => n || d.customerName); setEmail((m) => m || d.customerEmail || ""); }
    }).catch(() => undefined);
    return () => { live = false; };
  }, [kind, v.id]);

  const okMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const valid = !!name.trim() && strokes.length > 0 && (!email.trim() || okMail);
  const sentence = t((kind === "drop_off" ? "hoConfirmDrop" : "hoConfirmPick") as Key)
    .replace("{name}", name.trim() || "…").replace("{date}", now.toLocaleDateString(undefined)).replace("{time}", now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }))
    .replace("{station}", station || "—").replace("{user}", f.refs?.me.name || "—");

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await signHandover(f.mut, v.id, {
        id: crypto.randomUUID(), kind, customerName: name.trim(), customerEmail: email.trim() || null, remarks: remarks.trim(), signedAt: new Date().toISOString(),
        signature: strokes, sendReceipt: send && !!email.trim() && okMail,
      });
      toast(navigator.onLine ? t("hoSaved") : t("hoSavedOffline"), 5000);
      onSigned?.();
      onClose();
    } catch (e) { toast((e as Error).message, 6000); setBusy(false); }
  };

  return (
    <Dialog title={t(kind === "drop_off" ? "hoTitleDrop" : "hoTitlePick")} onClose={onClose}>
      <div className="muted" style={{ marginBottom: 10 }}>
        <b style={{ color: "#14233B" }}>{String(x.kennzeichen || "—")}</b> · {String(x.modell || "")} · {station}
      </div>
      <Field label={`${t("hoName")} *`}><input className="inp" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("hoEmail")}><input className="inp" type="email" value={email} autoComplete="email" placeholder="name@example.com" onChange={(e) => setEmail(e.target.value)} /></Field>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, margin: "-4px 0 12px" }}>
        <input type="checkbox" style={{ width: 22, height: 22, minHeight: 0, marginTop: 1 }} checked={send && !!email.trim()} disabled={!email.trim()} onChange={(e) => setSend(e.target.checked)} />
        <span>{t("hoSend")}</span>
      </label>
      {!!email.trim() && !okMail && <div className="err" style={{ marginBottom: 8 }}>{t("hoBadEmail")}</div>}
      <Field label={t("hoRemarks")}><textarea className="inp" rows={3} value={remarks} maxLength={2000} onChange={(e) => setRemarks(e.target.value)} /></Field>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <b style={{ fontSize: 14 }}>{t("hoSignHere")} *</b>
        <button type="button" className="chip" disabled={!strokes.length} onClick={() => setStrokes([])}>{t("hoClear")}</button>
      </div>
      <SignaturePad value={strokes} onChange={setStrokes} label={t("hoSignHere")} />
      <p className="muted" style={{ fontSize: 13, margin: "10px 0" }}>{sentence}</p>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" className="pbtn sec" style={{ flex: "0 0 38%" }} onClick={onClose}>{t("hoLater")}</button>
        <button type="button" className="pbtn" style={{ flex: 1 }} disabled={!valid || busy} onClick={() => void save()}>{t("hoSave")}</button>
      </div>
    </Dialog>
  );
}

/** "signed on 24.10.2026 18:03" */
export const signedOn = (iso: string) => t("hoSignedOn").replace("{at}", fmtDateTime(iso));
