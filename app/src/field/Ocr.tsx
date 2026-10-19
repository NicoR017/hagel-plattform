import { useRef, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { Dialog } from "./ui";
import { blobToBase64, downscale, prepForOcr } from "./images";
import { findPlate, findVIN } from "./ocrText";

/** Plate / VIN from a photo: Claude vision through the server (key stays on the server); offline fallback = Tesseract + regexes. */
export function OcrDialog({ mode, land, onUse, onClose }: { mode: "kz" | "fin"; land: "DE" | "ES"; onUse: (v: string) => void; onClose: () => void }) {
  const isFin = mode === "fin";
  const [busy, setBusy] = useState("");
  const [val, setVal] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const run = async (file: File) => {
    setBusy(t("readingImage")); setVal(""); setNote(""); setTried(true);
    try {
      const small = await downscale(file, 1400, 0.85);
      const r = await api<{ wert: string; sicher: string; hinweis: string }>("POST", "/ocr", { image: await blobToBase64(small), mode, land });
      setVal(r.wert);
      setNote(r.sicher === "hoch" ? "" : `${r.sicher === "niedrig" ? t("uncertain") + " " : ""}${r.hinweis}`);
    } catch (e) {
      try {
        setBusy(t("secondTry"));
        const { default: Tesseract } = await import("tesseract.js");
        const src = await prepForOcr(file);
        const res = await Tesseract.recognize(src, "eng");
        const txt = res.data.text ?? "";
        setVal(isFin ? findVIN(txt) : findPlate(txt));
        setNote(`${t("aiUnavailable")} (${(e as Error).message})`);
      } catch (e2) { setNote((e2 as Error).message); }
    }
    setBusy("");
  };

  return (
    <Dialog title={isFin ? t("ocrVinTitle") : t("ocrPlateTitle")} onClose={onClose}>
      <div className="muted" style={{ fontSize: 12 }}>{isFin ? t("ocrVinHint") : t("ocrPlateHint")}</div>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) void run(fl); }} />
      <button className="pbtn" onClick={() => input.current?.click()} disabled={!!busy}>📷 {t("takeOrChoose")}</button>
      {busy && <div style={{ textAlign: "center", padding: "14px 0" }} className="muted">{busy}</div>}
      {val && (
        <div style={{ marginTop: 14, background: "var(--greenBg)", border: "1px solid var(--greenDk)", borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: "var(--greenDk)", fontWeight: 700, marginBottom: 6 }}>{t("recognisedCheck")}</div>
          <input className="inp" value={val} onChange={(e) => setVal(e.target.value.toUpperCase())} style={{ fontWeight: 800, letterSpacing: 0.5 }} />
          {note && <div style={{ fontSize: 12, color: "var(--brick)", marginTop: 6 }}>{note}</div>}
          {isFin && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{val.replace(/\s/g, "").length === 17 ? `17 ${t("chars")} ✓` : `${val.replace(/\s/g, "").length} ${t("chars")} – ${t("vinHas17")}`}</div>}
          <button className="pbtn" style={{ background: "var(--greenDk)" }} onClick={() => { onUse(val.trim()); onClose(); }}>✓ {t("accept")}</button>
        </div>
      )}
      {!busy && !val && tried && <div style={{ marginTop: 12, color: "var(--brick)", fontSize: 13 }}>{note || t("ocrNothing")}</div>}
    </Dialog>
  );
}
