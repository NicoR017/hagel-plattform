import { useRef } from "react";
import type { PhotoPhase } from "@hagel/shared";
import { t, tOr } from "../i18n";
import type { LocalPhoto, LocalVehicle } from "../sync/db";
import { addPhoto, deletePhoto, photoPhaseFor, updatePhoto } from "../sync/mutations";
import { downscale } from "./images";
import { usePhotos, usePhotoUrl, useField } from "./store";
import { toast } from "./toast";
import { confirmDialog } from "./ui";

/** Stored labels stay German (the documents translate them for Spanish output); the UI shows them in the UI language. */
export const IMG_LABELS = ["Vorderansicht", "Heckansicht", "Seite links", "Seite rechts", "Dach", "Detail / Delle", "Sonstiges"] as const;
const REQUIRED = ["Vorderansicht", "Heckansicht", "Seite links", "Seite rechts", "Dach"];
const PHASES: PhotoPhase[] = ["besichtigung", "reparatur", "fertig"];
export const imgLabelText = (l: string) => tOr("img." + l, l);

function PhotoCard({ p, canEdit, canDelete }: { p: LocalPhoto; canEdit: boolean; canDelete: boolean }) {
  const f = useField();
  const url = usePhotoUrl(p);
  const opts = (IMG_LABELS as readonly string[]).includes(p.label) ? IMG_LABELS : [...IMG_LABELS, p.label as never];
  return (
    <div className="imgcard">
      <div className="ph">
        {url ? <img src={url} alt={imgLabelText(p.label)} /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--greyDk)" }}>🖼</div>}
        {canDelete && <button className="delbtn" aria-label={t("delete")} onClick={() => { if (confirmDialog(t("deletePhotoQ"))) void deletePhoto(f.mut, p.id); }}>✕</button>}
        {p._pending && <span className="badge" style={{ position: "absolute", left: 6, top: 6, background: "#9a7b1f" }}>⏳</span>}
        {p.source === "colibri" && <span className="badge" style={{ position: "absolute", left: 6, bottom: 6 }}>Colibri</span>}
      </div>
      <select className="sel" style={{ borderRadius: 0, border: "none", borderTop: "1px solid var(--line)", fontSize: 13 }} value={p.label} disabled={!canEdit} onChange={(e) => void updatePhoto(f.mut, p.id, { label: e.target.value })} aria-label={t("photoLabel")}>
        {opts.map((l) => <option key={l} value={l}>{imgLabelText(l)}</option>)}
      </select>
      <div style={{ display: "flex", gap: 6, padding: 6, alignItems: "center" }}>
        <select className="sel" style={{ fontSize: 12, padding: "6px 4px", minHeight: 40 }} value={p.phase} disabled={!canEdit} onChange={(e) => void updatePhoto(f.mut, p.id, { phase: e.target.value as PhotoPhase })} aria-label={t("photoPhase")}>
          {PHASES.map((ph) => <option key={ph} value={ph}>{t(("ph." + ph) as never)}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={p.inPdf} disabled={!canEdit} style={{ width: 22, height: 22 }} onChange={(e) => void updatePhoto(f.mut, p.id, { inPdf: e.target.checked })} />{t("inPdf")}
        </label>
      </div>
      <div className="muted" style={{ fontSize: 11, padding: "0 8px 8px" }}>{new Date(p.takenAt).toLocaleString()}</div>
    </div>
  );
}

export function Bilder({ v }: { v: LocalVehicle }) {
  const f = useField();
  const photos = usePhotos(v.id);
  const cam = useRef<HTMLInputElement>(null), gal = useRef<HTMLInputElement>(null);
  const canAdd = f.can("photos.ajouter");
  const add = async (files: FileList | null) => {
    if (!files) return;
    for (const file of [...files]) {
      if (!file.type.startsWith("image/")) continue;
      try { await addPhoto(f.mut, { vehicleId: v.id, blob: await downscale(file), label: "Foto", phase: photoPhaseFor(v) }); }
      catch { toast(t("photoFailed")); }
    }
  };
  const have = new Set(photos.map((p) => p.label));
  const done = REQUIRED.filter((r) => have.has(r)).length;
  return (
    <div style={{ padding: "18px 16px 30px" }}>
      {canAdd && (
        <>
          <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          <input ref={gal} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          <div style={{ display: "flex", gap: 10 }}>
            <button className="pbtn" style={{ marginTop: 0 }} onClick={() => cam.current?.click()}>📷 {t("takePhoto")}</button>
            <button className="pbtn sec" style={{ marginTop: 0 }} onClick={() => gal.current?.click()}>⬆ {t("fromGallery")}</button>
          </div>
        </>
      )}
      <div style={{ background: "var(--bg)", borderRadius: 12, padding: "10px 12px", marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{t("requiredViews")} ({done}/{REQUIRED.length})</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {REQUIRED.map((r) => <span key={r} className={"chip" + (have.has(r) ? " on" : "")} style={{ minHeight: 32, padding: "5px 10px" }}>{have.has(r) ? "✓ " : ""}{imgLabelText(r)}</span>)}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t("photoHint")}</div>
      </div>
      {!photos.length && <div style={{ textAlign: "center", color: "var(--sub)", padding: "30px 0" }}>🖼<p>{t("noPhotos")}</p></div>}
      {PHASES.map((ph) => {
        const list = photos.filter((p) => p.phase === ph);
        if (!list.length) return null;
        return (
          <div key={ph} style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>{t(("ph." + ph) as never)} ({list.length})</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {list.map((p) => <PhotoCard key={p.id} p={p} canEdit={canAdd} canDelete={f.can("photos.supprimer")} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
