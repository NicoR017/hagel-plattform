import { useEffect, useState } from "react";
import type { CalcResult } from "@hagel/calc";
import { kvaFileName } from "@hagel/documents";
import { api } from "../api";
import { fmtDateTime, t } from "../i18n";
import type { LocalVehicle } from "../sync/db";
import { sendReport } from "../sync/mutations";
import { buildRepairReport, buildSendPdf, toDoc } from "./docs";
import { useField } from "./store";
import { toast } from "./toast";
import { Dialog } from "./ui";

interface Hist { id: string; type: string; status: string; error: string | null; recipients: string[]; sentAt: string | null; createdAt: string; sentBy: string | null }

/**
 * "Senden": the server e-mails the PDF to the customer carrosserie (always) and to the insurer (if it wants this kind of report).
 * The PDF is built here (offline capable) and queued; recipients are computed by the server when it accepts the request.
 */
export function SendReportDialog({ v, c, type, onClose }: { v: LocalVehicle; c: CalcResult; type: "kva" | "reparation"; onClose: () => void }) {
  const f = useField();
  const [rec, setRec] = useState<string[] | null | "offline">(null);
  const [hist, setHist] = useState<Hist[]>([]);
  const [busy, setBusy] = useState(false);
  const land: "DE" | "ES" = (v as Record<string, unknown>).land === "ES" ? "ES" : "DE";

  useEffect(() => {
    let live = true;
    api<{ recipients: string[] }>("GET", `/reports/recipients?vehicleId=${v.id}&type=${type}`).then((r) => live && setRec(r.recipients)).catch(() => live && setRec("offline"));
    api<Hist[]>("GET", `/reports?vehicleId=${v.id}`).then((h) => live && setHist(h.filter((x) => x.type === type))).catch(() => undefined);
    return () => { live = false; };
  }, [v.id, type]);

  const none = Array.isArray(rec) && rec.length === 0;
  const send = async () => {
    setBusy(true);
    try {
      const doc = toDoc(v, f.refs);
      const pdf = type === "kva" ? (await buildSendPdf(f.db, f.engine, v, c, f.refs)).bytes : await buildRepairReport(f.db, f.engine, v, f.refs);
      const name = type === "kva" ? kvaFileName(doc) : `${land === "ES" ? "Informe_reparacion" : "Fotobericht_Reparatur"}_${String((v as Record<string, unknown>).kennzeichen || "").replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
      await sendReport(f.mut, { vehicleId: v.id, type, lang: land === "ES" ? "es" : "de", pdf, fileName: name });
      toast(f.status.online ? t("reportQueuedOnline") : t("reportQueuedOffline"), 5000);
      onClose();
    } catch (e) { toast(`${t("pdfFailed")}: ${(e as Error).message}`); setBusy(false); }
  };

  return (
    <Dialog title={type === "kva" ? t("sendKvaTitle") : t("sendRepairTitle")} onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--sub)" }}>{t("recipientsLabel")}</div>
      <div style={{ background: "var(--bg)", borderRadius: 12, padding: "10px 12px", marginTop: 6, fontSize: 14, minHeight: 44 }}>
        {rec === null ? t("loading") : rec === "offline" ? t("recipientsOffline") : none ? <b style={{ color: "var(--brick)" }}>{t("noRecipients")}</b> : rec.map((r) => <div key={r}>✉ {r}</div>)}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{type === "kva" ? t("sendKvaHint") : t("sendRepairHint")}</div>
      <button className="pbtn green" disabled={busy || none} onClick={() => void send()}>{busy ? t("preparing") : `✉️ ${t("sendNow")}`}</button>
      {hist.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{t("alreadySent")}</div>
          {hist.map((h) => (
            <div key={h.id} style={{ fontSize: 12, borderTop: "1px solid var(--line)", padding: "6px 0" }}>
              {h.status === "sent" ? "✓" : h.status === "failed" ? "⚠" : "⏳"} {fmtDateTime(h.sentAt ?? h.createdAt)} · {h.sentBy ?? ""}
              <div className="muted">{h.recipients.join(", ")}{h.status === "failed" ? ` — ${t("failedWord")}` : h.status === "awaiting_file" ? ` — ${t("waitingWord")}` : ""}</div>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
