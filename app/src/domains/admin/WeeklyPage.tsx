import { useEffect, useState } from "react";
import { generateTechnicianWorksheets, techPdfFileName, eur, type TechSheetData } from "@hagel/documents";
import { api } from "../../api";
import { shareOrDownload } from "../../shared/docs";
import { fmtDateTime, getLang, t } from "../../shared/i18n";
import { toast } from "../../shared/toast";
import { act, Card, Err, useLoad } from "./shared";

interface WeekSheet { technician: string; sites: string[]; vehicles: { id: string; plate: string; model: string; start: string | null; end: string; aw: number; pdrEur: number; demEur: number; eur: number }[]; totals: { n: number; aw: number; pdrEur: number; demEur: number; eur: number } }
interface WeekData { week: string; from: string; to: string; sheets: WeekSheet[]; people: { id: string; name: string; kind: string; active: boolean; email: string | null }[] }

/** ISO week "2026-W43" of a date */
export function isoWeekOf(d: Date): string {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  const y = x.getUTCFullYear(), w = Math.ceil(((x.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

export function WeeklyPage() {
  const [week, setWeek] = useState(isoWeekOf(new Date()));
  const [who, setWho] = useState("");
  const [to, setTo] = useState("");
  const [err, setErr] = useState("");
  const d = useLoad<WeekData>(`/weekly-report?week=${encodeURIComponent(week)}`, [week]);
  const sheets = (d.data?.sheets ?? []).filter((s) => !who || s.technician === who);
  const person = d.data?.people.find((p) => p.name.toLowerCase() === who.toLowerCase());
  const grand = sheets.reduce((a, s) => a + s.totals.eur, 0);
  const lang = getLang();
  const money = (n: number) => eur(n);
  const names = [...new Set([...(d.data?.sheets ?? []).map((s) => s.technician), ...(d.data?.people ?? []).filter((p) => p.active).map((p) => p.name)])].sort((a, b) => a.localeCompare(b, "de"));
  useEffect(() => { setTo(person?.email ?? ""); }, [who, d.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = (): TechSheetData[] => sheets.map((s) => ({ technician: s.technician, sites: s.sites, vehicles: s.vehicles, totals: s.totals }));
  return (
    <Card title={t("v6MenuWeekly")}>
      <div className="row">
        <div><label>{t("v6WWeek")}</label><input type="week" value={week} onChange={(e) => e.target.value && setWeek(e.target.value)} /></div>
        <div className="grow"><label>{t("v6WPerson")}</label>
          <select value={who} onChange={(e) => setWho(e.target.value)}><option value="">{t("v6WAll")}</option>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        {d.data && <span className="muted">{fmtDateTime(d.data.from + "T00:00:00").slice(0, 10)} – {fmtDateTime(d.data.to + "T00:00:00").slice(0, 10)}</span>}
      </div>
      <Err msg={d.err || err} />
      {d.data && !sheets.length && <p className="muted">{t("v6WNone")}</p>}
      {sheets.map((s) => (
        <div key={s.technician} className="wsheet">
          <div className="row"><h4 className="grow" style={{ margin: 0 }}>{s.technician}</h4><span className="muted">{s.sites.join(", ")}</span></div>
          <div className="tscroll"><table>
            <thead><tr><th>{t("v6WPlate")}</th><th>{t("v6WModel")}</th><th>{t("v6WFinish")}</th><th className="r">{t("v6WBasis")}</th><th className="r">{t("v6WPdrPart")}</th><th className="r">{t("v6WDemPart")}</th><th className="r">{t("v6WAmount")}</th></tr></thead>
            <tbody>{s.vehicles.map((v) => <tr key={v.id + v.eur}><td>{v.plate}</td><td>{v.model}</td><td>{v.end}</td><td className="r">{v.aw.toFixed(2)}</td><td className="r">{money(v.pdrEur)}</td><td className="r">{money(v.demEur)}</td><td className="r"><b>{money(v.eur)}</b></td></tr>)}</tbody>
            <tfoot><tr><td colSpan={3}><b>{s.totals.n} {t("v6WCars")}</b></td><td className="r"><b>{s.totals.aw.toFixed(2)}</b></td><td className="r"><b>{money(s.totals.pdrEur)}</b></td><td className="r"><b>{money(s.totals.demEur)}</b></td><td className="r"><b>{money(s.totals.eur)}</b></td></tr></tfoot>
          </table></div>
        </div>
      ))}
      {sheets.length > 0 && <p className="wtotal">{t("v6WTotal")}: <b>{money(grand)}</b></p>}
      {sheets.length > 0 && (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="grow"><label>{t("v6WSendTo")}</label><input type="email" value={to} disabled={!who} placeholder={who ? t("v6WNoEmail") : t("v6WPerson")} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="btn" disabled={!who || !to} onClick={() => act(async () => {
            const r = await api<{ to: string; vehicles: number }>("POST", "/weekly-report/send", { week, technician: who, email: to, lang });
            toast(`${t("v6WSent")} ${r.to}`);
          }, setErr)}>{t("v6WSend")}</button>
          <button className="btn sec" onClick={() => void act(async () => {
            const bytes = await generateTechnicianWorksheets({ from: d.data!.from, to: d.data!.to, sheets: data() }, lang);
            await shareOrDownload(bytes, techPdfFileName(d.data!.from, d.data!.to, lang), "application/pdf");
          }, setErr)}>{t("v6WPdf")}</button>
        </div>
      )}
    </Card>
  );
}
