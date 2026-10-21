import { useEffect } from "react";
import type { PhotoPhase } from "@hagel/shared";
import { t } from "../i18n";
import type { LocalPhoto } from "../sync/db";
import { deletePhoto, updatePhoto } from "../sync/mutations";
import { IMG_LABELS, imgLabelText } from "./Bilder";
import { useField, usePhotoUrl } from "./store";
import { confirmDialog } from "./ui";

const PHASES: PhotoPhase[] = ["besichtigung", "reparatur", "fertig"];

/** Full-screen photo: previous / next (buttons, swipe-free arrows, keyboard), label, phase, "im PDF", delete (with permission). */
export function Lightbox({ photos, index, onIndex, onClose, canEdit, canDelete }: {
  photos: LocalPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void; canEdit: boolean; canDelete: boolean;
}) {
  const f = useField();
  const p = photos[index];
  const url = usePhotoUrl(p);
  const n = photos.length;
  const go = (d: number) => onIndex((index + d + n) % n);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && n > 1) go(1);
      else if (e.key === "ArrowLeft" && n > 1) go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  // the photo behind us was deleted: show the next one, or close when it was the last
  useEffect(() => { if (!p) { if (n) onIndex(Math.min(index, n - 1)); else onClose(); } });
  if (!p) return null;
  const opts = (IMG_LABELS as readonly string[]).includes(p.label) ? IMG_LABELS : [...IMG_LABELS, p.label as never];

  return (
    <div className="lb" role="dialog" aria-modal="true" aria-label={imgLabelText(p.label)}>
      <div className="lb-top">
        <span style={{ fontWeight: 700 }}>{index + 1} / {n}</span>
        <span className="lb-meta">{p.source === "colibri" ? `Colibri${p.colibriPosition ? ` · ${p.colibriPosition}` : ""} · ` : ""}{new Date(p.takenAt).toLocaleString()}</span>
        <button className="lb-btn" onClick={onClose} aria-label={t("close")}>✕</button>
      </div>
      <div className="lb-stage">
        {n > 1 && <button className="lb-nav lb-prev" onClick={() => go(-1)} aria-label={t("v4Prev")}>‹</button>}
        {url ? <img src={url} alt={imgLabelText(p.label)} /> : <div style={{ color: "#aab3c0", fontSize: 40 }}>🖼</div>}
        {n > 1 && <button className="lb-nav lb-next" onClick={() => go(1)} aria-label={t("v4Next")}>›</button>}
      </div>
      <div className="lb-bar">
        <select className="sel" value={p.label} disabled={!canEdit} onChange={(e) => void updatePhoto(f.mut, p.id, { label: e.target.value })} aria-label={t("photoLabel")}>
          {opts.map((l) => <option key={l} value={l}>{imgLabelText(l)}</option>)}
        </select>
        <select className="sel" value={p.phase} disabled={!canEdit} onChange={(e) => void updatePhoto(f.mut, p.id, { phase: e.target.value as PhotoPhase })} aria-label={t("photoPhase")}>
          {PHASES.map((ph) => <option key={ph} value={ph}>{t(("ph." + ph) as never)}</option>)}
        </select>
        <label className="lb-check"><input type="checkbox" checked={p.inPdf} disabled={!canEdit} onChange={(e) => void updatePhoto(f.mut, p.id, { inPdf: e.target.checked })} />{t("inPdf")}</label>
        {canDelete && <button className="lb-btn danger" onClick={() => { if (confirmDialog(t("deletePhotoQ"))) void deletePhoto(f.mut, p.id); }}>🗑 {t("delete")}</button>}
      </div>
    </div>
  );
}
