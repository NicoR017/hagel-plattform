import { useState } from "react";
import { PANEL_MAP } from "@hagel/calc";
import { api } from "../../api";
import { go } from "../../shared/route";
import { t } from "../../shared/i18n";
import type { LocalVehicle } from "../../shared/sync/db";
import { useField } from "../../shared/store";
import { toast } from "../../shared/toast";
import { PaintActions, usePartners } from "./PaintActions";
import { PaintPill } from "./PaintBoard";
import { elementName, paintOf, paintProgress } from "./paintLogic";

/** Tab "Paint" of a repair: the paint jobs of the car with their status, planning and the actions of the paint managers. No prices (how paint is billed is not decided). */
export function CarPaint({ v, stationId }: { v: LocalVehicle; stationId: string }) {
  const f = useField();
  const jobs = paintOf(v);
  const partners = usePartners();
  const { d, n } = paintProgress(jobs);
  const [add, setAdd] = useState("");
  const free = Object.keys(PANEL_MAP).filter((k) => !jobs.some((j) => j.elementKey === k));
  return (
    <section className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>🎨 {t("f5PaintOf")}{n > 0 && <span className="muted" style={{ fontWeight: 400 }}> · {t("f5Progress").replace("{d}", String(d)).replace("{n}", String(n))}</span>}</h3>
        {n > 0 && <button className="chip" onClick={() => go({ page: "paint", stationId, view: "element", car: v.id })}>{t("f5SwitchPaint")}</button>}
      </div>
      {n > 0 && d === n && <div role="status" style={{ background: "#E9F4EE", color: "#17663F", borderRadius: 12, padding: "10px 14px", fontWeight: 700, margin: "0 0 12px" }}>✓ {t("f5AllDone")}</div>}
      {!n && <div className="muted">{t("f5NoJobsCar")}</div>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {jobs.map((j) => (
          <li key={j.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><b>{elementName(j.elementKey)}</b><PaintPill s={j.status} /></div>
            {j.plannedDate && <div className="muted" style={{ fontSize: 12 }}>{partners.concat(f.refs?.bodyshops ?? []).find((p) => p.id === j.partnerId)?.name ?? ""} · {t("f5At").replace("{d}", j.plannedDate.split("-").reverse().join("/")).replace("{t}", j.plannedTime ?? "—")}{j.customerAppointment ? ` · 👤 ${t("f5ByCustomer")}` : ""}</div>}
            <PaintActions v={v} job={j} />
          </li>
        ))}
      </ul>
      {f.can("peinture.gerer") && free.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <select className="inp" style={{ flex: 1 }} value={add} onChange={(e) => setAdd(e.target.value)} aria-label={t("f5AddElement")}><option value="">{t("f5AddElementPh")}</option>{free.map((k) => <option key={k} value={k}>{elementName(k)}</option>)}</select>
          <button className="chip on" style={{ minHeight: 44 }} disabled={!add} onClick={async () => { try { await api("POST", `/vehicles/${v.id}/paint`, { elementKey: add }); setAdd(""); } catch (e) { toast((e as Error).message, 5000); } }}>+ {t("f5AddElement")}</button>
        </div>
      )}
    </section>
  );
}
