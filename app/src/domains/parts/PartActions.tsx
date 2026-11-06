import { useRef, useState } from "react";
import { PART_RETURN_REASONS, type ClientPart } from "@hagel/shared";
import { t, type Key } from "../../shared/i18n";
import type { LocalPhoto, LocalVehicle } from "../../shared/sync/db";
import { addPhoto, deliverPart, installPart, returnPart, tagPhoto } from "../../shared/sync/mutations";
import { downscale } from "../../shared/images";
import { useField, usePhotos, usePhotoUrl } from "../../shared/store";
import { toast } from "../../shared/toast";
import { Dialog, Field } from "../../shared/ui";

/** the buttons a part offers to the person who may use them (the server checks the rights again) */
export function PartActions({ v, p, compact }: { v: LocalVehicle; p: ClientPart; compact?: boolean }) {
  const f = useField();
  const [dlg, setDlg] = useState<"install" | "return" | null>(null);
  const reception = f.can("pieces.reception"), installer = f.can("pieces.installer");
  const canDeliver = reception && (p.status === "to_order" || p.status === "order_sent" || p.status === "ordered");
  const canInstall = installer && p.status === "delivered";
  const canReturn = (reception || installer) && (p.status === "delivered" || p.status === "installed");
  const sty = { minHeight: compact ? 40 : 44, padding: "6px 12px" } as const;
  if (!canDeliver && !canInstall && !canReturn) return null;
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {canDeliver && <button className="chip on" style={sty} onClick={() => void deliverPart(f.mut, v.id, p.id)}>📦 {t("f3MarkDelivered")}</button>}
      {canInstall && <button className="chip on" style={sty} onClick={() => setDlg("install")}>🔧 {t("f3Install")}</button>}
      {canReturn && <button className="chip" style={sty} onClick={() => setDlg("return")}>↩ {t("f3Return")}</button>}
      {dlg === "install" && <InstallDialog v={v} p={p} onClose={() => setDlg(null)} />}
      {dlg === "return" && <ReturnDialog v={v} p={p} onClose={() => setDlg(null)} />}
    </span>
  );
}

function Thumb({ ph, on, onPick }: { ph: LocalPhoto; on: boolean; onPick: () => void }) {
  const url = usePhotoUrl(ph);
  return (
    <button type="button" aria-pressed={on} onClick={onPick} style={{ width: 84, height: 64, padding: 0, borderRadius: 10, overflow: "hidden", border: on ? "3px solid #1D4FB8" : "1px solid var(--line)", background: "#EEF1F6", flex: "0 0 auto" }}>
      {url ? <img src={url} alt={ph.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span className="muted" style={{ fontSize: 11 }}>…</span>}
    </button>
  );
}

/** D22: a part is installed with two photos: the one taken at disassembly (before) and one after (taken here or chosen) — the server refuses otherwise */
export function InstallDialog({ v, p, onClose }: { v: LocalVehicle; p: ClientPart; onClose: () => void }) {
  const f = useField();
  const photos = usePhotos(v.id).filter((x) => !x.deleted);
  const demo = photos.filter((x) => x.repairStage === "demontage");
  const [before, setBefore] = useState(demo.at(-1)?.id ?? "");
  const [after, setAfter] = useState("");
  const [busy, setBusy] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const afterChoices = photos.filter((x) => x.id !== before);
  const take = async (file: File) => {
    setBusy(true);
    try {
      const blob = await downscale(file);
      const id = await addPhoto(f.mut, { vehicleId: v.id, blob, phase: "reparatur", label: p.name });
      await tagPhoto(f.mut, v.id, id, "remontage", null);
      setAfter(id);
    } catch (e) { toast((e as Error).message, 5000); } finally { setBusy(false); }
  };
  const ok = !!before && !!after && before !== after;
  return (
    <Dialog title={`${t("f3InstallTitle")} · ${p.name}`} onClose={onClose}>
      <Field label={t("f3PhotoBefore")}>
        {demo.length ? <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>{demo.map((x) => <Thumb key={x.id} ph={x} on={before === x.id} onPick={() => setBefore(x.id)} />)}</div>
          : <div className="muted" style={{ fontSize: 13, color: "var(--brick)" }}>{t("f3NoDemoPhoto")}</div>}
      </Field>
      <Field label={t("f3PhotoAfter")}>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {afterChoices.map((x) => <Thumb key={x.id} ph={x} on={after === x.id} onPick={() => setAfter(x.id)} />)}
        </div>
        <input ref={cam} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void take(file); }} />
        <button type="button" className="chip" style={{ minHeight: 44, marginTop: 6 }} disabled={busy} onClick={() => cam.current?.click()}>📷 {t("f3TakePhoto")}</button>
      </Field>
      {!ok && <div className="muted" style={{ fontSize: 12 }}>{t("f3InstallNeed")}</div>}
      <button className="pbtn" disabled={!ok || busy} onClick={async () => { await installPart(f.mut, v.id, p.id, before, after); onClose(); }}>✓ {t("f3InstallDo")}</button>
    </Dialog>
  );
}

/** D24: send a part back (wrong reference, damaged, other): it goes back to "To order" */
export function ReturnDialog({ v, p, onClose }: { v: LocalVehicle; p: ClientPart; onClose: () => void }) {
  const f = useField();
  const [reason, setReason] = useState<(typeof PART_RETURN_REASONS)[number]>("wrong_ref");
  const [note, setNote] = useState("");
  const label: Record<(typeof PART_RETURN_REASONS)[number], Key> = { wrong_ref: "f3ReasonWrong", damaged: "f3ReasonDamaged", other: "f3ReasonOther" };
  return (
    <Dialog title={`${t("f3ReturnTitle")} · ${p.name}`} onClose={onClose}>
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{t("f3ReturnHint")}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {PART_RETURN_REASONS.map((r) => <button key={r} type="button" className={"chip" + (reason === r ? " on" : "")} aria-pressed={reason === r} style={{ minHeight: 44 }} onClick={() => setReason(r)}>{t(label[r])}</button>)}
      </div>
      <Field label={t("f3ReturnNote")}><input className="inp" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
      <button className="pbtn" onClick={async () => { await returnPart(f.mut, v.id, p.id, reason, note.trim() || undefined); onClose(); }}>↩ {t("f3Return")}</button>
    </Dialog>
  );
}
