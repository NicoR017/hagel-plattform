import { useEffect, useState } from "react";
import { api } from "../../api";
import { eur } from "@hagel/documents";
import { t } from "../../shared/i18n";
import type { LocalVehicle } from "../../shared/sync/db";

interface Billing {
  viaBodyShop: boolean; bodyShop: string | null; commissionPct: number | null; assessmentNet: number;
  partsInvoice: { number: string | null; amountHt: number | null; version: number } | null; paintInvoices: { number: string | null; amountHt: number | null; partner: string }[]; bodyShopBillsInsurer: number | null;
}
const money = (n: number | null | undefined) => (n == null ? "—" : eur(n));

/** Tab "Billing" (R12): INFORMATION only. Our invoice to the body shop is not made here: the Swiss system issues it from the CSV export "Finished vehicles". */
export function CarBilling({ v }: { v: LocalVehicle }) {
  const [b, setB] = useState<Billing | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { if (navigator.onLine) api<Billing>("GET", `/vehicles/${v.id}/billing`).then(setB).catch((e) => setErr((e as Error).message)); }, [v.id]);
  const row = (label: string, value: string, hint?: string) => <div className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}><span>{label}{hint && <span className="muted" style={{ display: "block", fontSize: 12 }}>{hint}</span>}</span><b>{value}</b></div>;
  return (
    <section className="panel" style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 4px" }}>💶 {t("f6BillTitle")}</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{t("f6BillHint")}</p>
      {err && <div className="err">{err}</div>}
      {!b && !err && <p className="muted">{navigator.onLine ? t("loading") : t("v4HistOnline")}</p>}
      {b && (
        <>
          {row(t("f6BillBody"), b.bodyShop ?? "—")}
          {row(t("f6BillVia"), b.viaBodyShop ? t("f6Yes") : t("f6No"))}
          {row(t("f6BillCommission"), b.commissionPct == null ? "—" : `${b.commissionPct} %`)}
          {row(t("f6BillAssessment"), money(b.assessmentNet))}
          {row(t("f6BillPartsInvoice"), b.partsInvoice ? `${money(b.partsInvoice.amountHt)} · ${b.partsInvoice.number ?? ""}` : "—", b.partsInvoice ? undefined : t("f6BillNoInvoice"))}
          {b.paintInvoices.map((p, i) => <div key={i}>{row(`${t("f6BillPaintInvoices")} · ${p.partner}`, `${money(p.amountHt)} · ${p.number ?? ""}`)}</div>)}
          {row(t("f6BillBilled"), money(b.bodyShopBillsInsurer))}
        </>
      )}
    </section>
  );
}
