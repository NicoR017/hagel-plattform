import { useEffect, useMemo, useRef, useState } from "react";
import type { CalcVehicle } from "@hagel/calc";
import { kvaFileName } from "@hagel/documents";
import { api, httpFetch } from "../api";
import { fmtDateTime, t, type Key } from "../i18n";
import type { LocalVehicle } from "../sync/db";
import { buildRepairReport, buildSendPdf, shareOrDownload, toDoc } from "../field/docs";
import { SendReportDialog } from "../field/SendReport";
import { useField, usePhotos } from "../field/store";
import { toast } from "../field/toast";
import { downloadReceipt, useHandovers } from "./HandoverDialog";

interface Send { id: string; type: "kva" | "reparation"; lang: string; status: string; error: string | null; recipients: string[]; sentAt: string | null; createdAt: string; sentBy: string | null; hasFile: boolean; replyTo?: string | null }
interface Doc { key: string; at: string; title: string; sub: string[]; status?: string; download?: () => Promise<void>; again?: () => void; againLabel?: Key }

const STATUS_KEY: Record<string, Key> = { sent: "dcSent", failed: "dcFailed", no_recipients: "dcNoRecipients", awaiting_file: "dcWaiting" };
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "vehicle";

/**
 * "Documents" of a vehicle: every PDF made during the case (estimates and repair reports sent from the server, customer hand-over receipts,
 * the Colibri scan) with who got it and when, plus the sending buttons. The estimate can still be sent to the customer from the Estimate tab.
 */
export function Documents({ v }: { v: LocalVehicle }) {
  const f = useField();
  const photos = usePhotos(v.id);
  const c = useMemo(() => f.calcOf(v as unknown as CalcVehicle), [v, f.calcOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const x = v as Record<string, any>;
  const land = x.land === "ES" ? "ES" : "DE";
  const prices = f.can("prix.voir");
  const mayKva = prices && f.can("kva.envoyer"), mayRep = prices && photos.length > 0 && f.can("rapport_reparation.envoyer");
  const mayHandover = f.can("vehicules.changer_statut") && !f.refs?.me.fieldView; // customer data: station staff only
  const [sends, setSends] = useState<Send[]>([]);
  const [tick, setTick] = useState(0);
  const [dlg, setDlg] = useState<null | "kva" | "reparation">(null);
  const [busy, setBusy] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if ((!f.can("kva.envoyer") && !f.can("rapport_reparation.envoyer")) || !navigator.onLine) return;
    api<Send[]>("GET", `/reports?vehicleId=${v.id}`).then((r) => alive.current && setSends(r)).catch(() => undefined);
  }, [v.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const ho = useHandovers(v.id, mayHandover, `${String(x.dropOffSignedAt ?? "")}|${String(x.pickUpSignedAt ?? "")}|${tick}`);

  const plate = fileSafe(String(x.kennzeichen || ""));
  const saveStored = (url: string, name: string) => async () => {
    const r = await httpFetch("GET", url, undefined, { blob: true });
    if (r.status !== 200 || !r.blob) { toast(t("hoReceiptFailed"), 5000); return; }
    await shareOrDownload(r.blob, name, "application/pdf");
  };
  const guard = async (label: string, run: () => Promise<void>) => {
    setBusy(label);
    try { await run(); } catch (e) { toast(`${t("pdfFailed")}: ${(e as Error).message}`, 6000); }
    setBusy("");
  };
  const kvaNow = () => guard("kva", async () => { const r = await buildSendPdf(f.db, f.engine, v, c, f.refs); await shareOrDownload(r.bytes, kvaFileName(toDoc(v, f.refs)), "application/pdf"); });
  const repNow = () => guard("rep", async () => { await shareOrDownload(await buildRepairReport(f.db, f.engine, v, f.refs), `${land === "ES" ? "Informe_reparacion" : "Fotobericht_Reparatur"}_${plate}.pdf`, "application/pdf"); });

  const docs: Doc[] = [];
  for (const s of sends) {
    const isKva = s.type === "kva";
    docs.push({
      key: "s" + s.id, at: s.sentAt ?? s.createdAt, title: t(isKva ? "dcEstimate" : "dcRepairReport"), status: s.status,
      sub: [s.lang.toUpperCase(), s.recipients.length ? `${t("dcTo")} ${s.recipients.join(", ")}` : "", s.replyTo ? `↩ ${s.replyTo}` : "", s.sentBy ? t("hoBy").replace("{user}", s.sentBy) : "", s.error ?? ""].filter(Boolean),
      download: s.hasFile ? saveStored(`/reports/${s.id}/file`, `${isKva ? (s.lang === "es" ? "Presupuesto" : "Kostenvoranschlag") : s.lang === "es" ? "Informe_reparacion" : "Fotobericht_Reparatur"}_${plate}.pdf`) : undefined,
      again: (isKva ? mayKva : mayRep) ? () => setDlg(s.type) : undefined, againLabel: "hoResend",
    });
  }
  for (const h of ho.rows ?? []) {
    if (!h.hasReceipt) continue;
    docs.push({
      key: "h" + h.id, at: h.signedAt, title: t(h.kind === "drop_off" ? "dcReceiptDrop" : "dcReceiptPick") + (h.replaced ? ` (${t("hoReplaced")})` : ""),
      status: h.mailStatus ?? undefined,
      sub: [h.customerName, h.customerEmail ? `${t("dcTo")} ${h.customerEmail}` : "", t("hoBy").replace("{user}", h.signedBy), h.mailError ?? ""].filter(Boolean),
      download: () => downloadReceipt(h.id, `${plate}-${h.kind}`),
      again: h.replaced ? undefined : async () => {
        try { await api("POST", `/handovers/${h.id}/send`, {}); toast(t("hoResent"), 5000); } catch (e) { toast((e as Error).message, 6000); }
        ho.reload(); setTick((n) => n + 1);
      },
      againLabel: "hoResend",
    });
  }
  if (v.colibriFile) docs.push({ key: "scan", at: String(x.createdAt ?? ""), title: t("dcScan"), sub: [], download: saveStored(`/files/colibri/${v.id}`, `Colibri_${plate}.pdf`) });
  docs.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {(prices || mayKva || mayRep) && (
        <section className="panel" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 8px" }}>📄 {t("dcMake")}</h3>
          {prices && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "6px 0" }}>
              <b style={{ minWidth: 150 }}>{t("dcEstimate")}</b>
              <button className="btn" disabled={!!busy} onClick={() => void kvaNow()}>⬇ {busy === "kva" ? t("preparing") : t("dcDownload")}</button>
              {mayKva && <button className="btn primary" disabled={!!busy} onClick={() => setDlg("kva")}>✉ {t("dcSend")}</button>}
            </div>
          )}
          {prices && photos.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <b style={{ minWidth: 150 }}>{t("dcRepairReport")}</b>
              <button className="btn" disabled={!!busy} onClick={() => void repNow()}>⬇ {busy === "rep" ? t("preparing") : t("dcDownload")}</button>
              {mayRep && <button className="btn primary" disabled={!!busy} onClick={() => setDlg("reparation")}>✉ {t("dcSend")}</button>}
            </div>
          )}
        </section>
      )}
      <section className="panel" style={{ padding: 16 }}>
        <h3 style={{ margin: "0 0 8px" }}>🗂 {t("dcList")}</h3>
        {!docs.length && <div className="muted">{t("dcNone")}</div>}
        {docs.map((d, i) => (
          <div key={d.key} style={{ padding: "10px 0", borderTop: i ? "1px solid var(--line)" : undefined }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <b>{d.title}</b>
              <span className="muted" style={{ fontSize: 13 }}>{d.at ? fmtDateTime(d.at) : ""}</span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {d.status ? `${d.status === "sent" ? "✓" : "⚠"} ${t(STATUS_KEY[d.status] ?? "dcWaiting")}` : ""}{d.status && d.sub.length ? " · " : ""}{d.sub.join(" · ")}
            </div>
            {(d.download || d.again) && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {d.download && <button className="btn" onClick={() => void d.download!()}>⬇ {t("dcDownload")}</button>}
                {d.again && <button className="btn" onClick={() => void d.again!()}>✉ {t(d.againLabel ?? "hoResend")}</button>}
              </div>
            )}
          </div>
        ))}
      </section>
      {dlg && <SendReportDialog v={v} c={c} type={dlg} onClose={() => { setDlg(null); setTick((n) => n + 1); }} />}
    </div>
  );
}
