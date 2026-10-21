import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { REPAIR_STAGES, STATUSES } from "@hagel/shared";
import { buildTechnicianWorkbook, eur, generateTechnicianWorksheets, techPdfFileName, techWorkbookFileName, type TechSheetData } from "@hagel/documents";
import { api } from "../api";
import { getLang, t } from "../i18n";
import { go } from "./route";
import { Occ, OccBar } from "./occupancy";
import { openFilteredList } from "./dashFilter";
import { holdReasonLabel, statusLabel } from "./Dialogs";
import { shareOrDownload } from "./docs";
import { useField } from "./store";
import { toast } from "./toast";
import { Dialog } from "./ui";

interface Ids { n: number; ids: string[] }
interface Row { id: string; name: string; net: number; n: number; ids: string[] }
interface Dash {
  generatedAt: string; vehicles: number; delayDays: Record<string, number>;
  kpis: { present: Ids; arrivalsToday: Ids; departuresToday: Ids; delayed: Ids; finished: Ids; fullSites: { id: string; name: string; present: number; capacity: number }[] };
  sites: { id: string; name: string; type: string; capacity: number; present: number; presentIds: string[]; byStatus: Record<string, Ids>; arrivalsToday: Ids; departuresToday: Ids; byStage?: Record<string, Ids>; repairsToday?: { booked: number; capacity: number } }[];
  durations: { avgArrivalToReturnedDays: number | null; avgRepairDays: number | null; returnedSamples: number; repairSamples: number };
  delayed: { id: string; plate: string; statut: string; motif: string | null; days: number; stationName: string; thresholdDays: number }[];
  hold: { reason: string; n: number; ids: string[] }[];
  technicians: { key: string; name: string; assigned: Ids; inProgress: Ids; finished: Ids; sites: { id: string; name: string }[]; noRoleOnSite: Ids }[];
  revenue: null | {
    total: number; n: number; ids: string[];
    bySite: Row[]; byClient: Row[]; byInsurer: Row[]; byMonth: { month: string; net: number; n: number; ids: string[] }[];
    split: null | { technicians: number; commissions: number; rest: number; n: number };
  };
}

const STATUS_COLOR: Record<string, string> = { arrive: "#8aa0c0", besichtigung: "#5b8fd6", attente: "#e0a02c", reparatur: "#7b5bd6", fertig: "#5e8c63", rendu: "#cfd6df" };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
type Period = "today" | "week" | "lastWeek" | "month" | "all" | "custom";
function periodRange(p: Period, now = new Date()): { from: string; to: string } {
  if (p === "today") return { from: iso(now), to: iso(now) };
  if (p === "week") return { from: iso(monday(now)), to: iso(addDays(monday(now), 6)) };
  if (p === "lastWeek") return { from: iso(addDays(monday(now), -7)), to: iso(addDays(monday(now), -1)) };
  if (p === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  return { from: "", to: "" };
}
const fmtDay = (s: string) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "…");

/** A number that opens the vehicle list filtered by the vehicles behind it. */
function N({ v, ids, label }: { v: number; ids: string[]; label: string }) {
  if (!v) return <span className="muted">0</span>;
  return <a href="#" onClick={(e) => { e.preventDefault(); openFilteredList({ ids, label }); }} style={{ fontWeight: 700 }}>{v}</a>;
}

function Tile({ label, value, ids, tone = "", sub }: { label: string; value: ReactNode; ids?: string[]; tone?: "" | "bad" | "good" | "warn"; sub?: ReactNode }) {
  const clickable = !!ids && ids.length > 0;
  const color = tone === "bad" ? "var(--brick)" : tone === "good" ? "var(--greenDk)" : tone === "warn" ? "#8a5a00" : "var(--navy)";
  return (
    <div role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
      onClick={() => clickable && openFilteredList({ ids: ids!, label })} onKeyDown={(e) => { if (clickable && e.key === "Enter") openFilteredList({ ids: ids!, label }); }}
      style={{ background: "#fff", borderRadius: 14, padding: "12px 14px", boxShadow: "0 1px 6px rgba(20,35,63,.06)", cursor: clickable ? "pointer" : "default", borderLeft: `5px solid ${color}` }}>
      <div style={{ fontSize: 12, color: "var(--sub)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em" }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--sub)" }}>{sub}</div>}
    </div>
  );
}

const Section = ({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) => (
  <section style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", marginBottom: 14, boxShadow: "0 1px 6px rgba(20,35,63,.06)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>{right}
    </div>
    {children}
  </section>
);

function StatusBar({ byStatus }: { byStatus: Record<string, Ids> }) {
  const total = STATUSES.reduce((a, s) => a + byStatus[s].n, 0);
  if (!total) return <div className="occbar" />;
  return (
    <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "#e6e9ee", margin: "8px 0" }}>
      {STATUSES.filter((s) => byStatus[s].n).map((s) => <i key={s} title={`${statusLabel(s)}: ${byStatus[s].n}`} style={{ width: `${(byStatus[s].n / total) * 100}%`, background: STATUS_COLOR[s] }} />)}
    </div>
  );
}

function Bars({ rows, title, money }: { rows: Row[]; title: string; money: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.net));
  return (
    <div>
      <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>{title}</h3>
      {rows.map((r) => (
        <div key={r.id} style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}><span>{r.name}</span><span><b>{money(r.net)}</b> (<N v={r.n} ids={r.ids} label={`${title} · ${r.name}`} />)</span></div>
          <div style={{ height: 6, borderRadius: 3, background: "#e6e9ee" }}><div style={{ height: "100%", width: `${(r.net / max) * 100}%`, borderRadius: 3, background: "#5b8fd6" }} /></div>
        </div>
      ))}
    </div>
  );
}

/** `embedded`: inside the new interface (its own header above); without it the old full-page header */
export function Dashboard({ embedded = false }: { embedded?: boolean }) {
  const f = useField();
  const [data, setData] = useState<Dash | null>(null);
  const [err, setErr] = useState("");
  const [site, setSite] = useState(""), [campaign, setCampaign] = useState(""), [client, setClient] = useState(""), [insurer, setInsurer] = useState("");
  const [period, setPeriod] = useState<Period>("week");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [thr, setThr] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [choose, setChoose] = useState(false);

  const range = useMemo(() => (period === "custom" ? custom : periodRange(period)), [period, custom]);
  const query = useCallback(() => {
    const q = new URLSearchParams();
    if (site) q.set("sites", site);
    if (campaign) q.set("campaign", campaign);
    if (client) q.set("client", client);
    if (insurer) q.set("insurer", insurer);
    if (range.from) q.set("from", range.from);
    if (range.to) q.set("to", range.to);
    return q.size ? "?" + q : "";
  }, [site, campaign, client, insurer, range]);

  const load = useCallback(async () => {
    try { setData(await api<Dash>("GET", `/dashboard${query()}`)); setErr(""); }
    catch (e) { setErr(f.status.online ? (e as Error).message : t("dashOnline")); }
  }, [query, f.status.online]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (data && !thr) setThr(data.delayDays); }, [data, thr]);

  const exportTech = async (kind: "pdf" | "xlsx") => {
    setChoose(false);
    setBusy(true);
    try {
      const d = await api<{ from: string | null; to: string | null; sheets: TechSheetData[] }>("GET", `/dashboard/technician-sheets${query()}`);
      if (!d.sheets.length) { toast(t("exportEmpty")); return; }
      const lang = getLang();
      if (kind === "pdf") await shareOrDownload(await generateTechnicianWorksheets(d, lang), techPdfFileName(d.from, d.to, lang), "application/pdf");
      else await shareOrDownload(buildTechnicianWorkbook(d, lang), techWorkbookFileName(d.from, d.to, lang), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  const refs = f.refs;
  const stations = refs?.stations ?? [];
  const money = (n: number) => eur(n);
  const attention = data ? [
    ...data.kpis.fullSites.map((s) => ({ key: "full" + s.id, text: t("siteFullMsg").replace("{name}", s.name).replace("{n}", String(s.present)).replace("{cap}", String(s.capacity)) })),
    ...(data.kpis.delayed.n ? [{ key: "delayed", text: `${t("kpiDelayed")}: ${data.kpis.delayed.n}` }] : []),
    ...data.technicians.filter((x) => x.noRoleOnSite.n).map((x) => ({ key: "role" + x.key, text: `${x.name}: ${x.noRoleOnSite.n} ${t("noRoleOnSite")}` })),
  ] : [];
  const chip = (p: Period, label: string) => <button key={p} className={"chip" + (period === p ? " on" : "")} style={{ whiteSpace: "nowrap" }} onClick={() => setPeriod(p)}>{label}</button>;
  const sel = (value: string, set: (v: string) => void, all: string, opts: { id: string; name: string }[]) => (
    <select className="sel" style={{ width: "auto", minHeight: 40 }} value={value} onChange={(e) => set(e.target.value)}><option value="">{all}</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
  );

  return (
    <div className={"fld wide" + (embedded ? " dashv3" : "")}>
      {embedded ? (
        <div className="dashtitle">
          <h1>{t("dashboard")}</h1>
          <div className="sub">{t("periodShown")}: {range.from || range.to ? `${fmtDay(range.from)} – ${fmtDay(range.to)}` : t("periodAll")}</div>
        </div>
      ) : (
        <div className="hdr">
          <div className="top"><a className="iconbtn" href="#/" style={{ textDecoration: "none" }} aria-label={t("vehicles")}>‹</a></div>
          <h1>{t("dashboard")}</h1>
          <div className="sub">{t("periodShown")}: {range.from || range.to ? `${fmtDay(range.from)} – ${fmtDay(range.to)}` : t("periodAll")}</div>
        </div>
      )}
      <div className="sheet">
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8 }}>
          {chip("today", t("periodToday"))}{chip("week", t("periodWeek"))}{chip("lastWeek", t("periodLastWeek"))}{chip("month", t("periodMonth"))}{chip("all", t("periodAll"))}{chip("custom", t("periodCustom"))}
        </div>
        {period === "custom" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <label style={{ display: "flex", gap: 4, alignItems: "center" }}>{t("periodFrom")}<input className="inp" type="date" style={{ width: "auto", minHeight: 40 }} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
            <label style={{ display: "flex", gap: 4, alignItems: "center" }}>{t("periodTo")}<input className="inp" type="date" style={{ width: "auto", minHeight: 40 }} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
          </div>
        )}
        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>{t("filtersLabel")}{site || client || insurer || campaign ? " •" : ""}</summary>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {sel(site, setSite, t("allSites"), stations.filter((s) => s.active))}
            {sel(client, setClient, t("allClients"), stations.filter((s) => s.type === "carrosserie"))}
            {sel(insurer, setInsurer, t("allInsurers"), refs?.insurers ?? [])}
            {sel(campaign, setCampaign, t("allCampaigns"), refs?.campaigns ?? [])}
          </div>
        </details>
        {err && <div className="err">{err}</div>}
        {!data && !err && <p>{t("loading")}</p>}
        {data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
              <Tile label={t("kpiPresent")} value={data.kpis.present.n} ids={data.kpis.present.ids} />
              <Tile label={t("arrivalsToday")} value={data.kpis.arrivalsToday.n} ids={data.kpis.arrivalsToday.ids} />
              <Tile label={t("departuresToday")} value={data.kpis.departuresToday.n} ids={data.kpis.departuresToday.ids} />
              <Tile label={t("kpiDelayed")} value={data.kpis.delayed.n} ids={data.kpis.delayed.ids} tone={data.kpis.delayed.n ? "bad" : "good"} />
              <Tile label={t("finishedN")} value={data.kpis.finished.n} ids={data.kpis.finished.ids} tone="good" />
              {data.revenue && <Tile label={t("kpiNet")} value={money(data.revenue.total)} ids={data.revenue.ids} sub={`${data.revenue.n} ${t("vehiclesCount")}`} />}
            </div>

            <Section title={t("attention")}>
              {attention.length === 0 ? <div style={{ color: "var(--greenDk)", fontWeight: 700 }}>✓ {t("allGood")}</div> : attention.map((a) => <div key={a.key} style={{ color: "var(--brick)", padding: "2px 0" }}>⚠ {a.text}</div>)}
            </Section>

            <Section title={t("dashSites")}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
                {data.sites.map((s) => (
                  <div key={s.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><b>{s.name}</b><Occ present={s.present} capacity={s.capacity} /></div>
                    {s.capacity > 0 && <OccBar present={s.present} capacity={s.capacity} />}
                    <StatusBar byStatus={s.byStatus} />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 13 }}>
                      {STATUSES.filter((st) => s.byStatus[st].n).map((st) => (
                        <span key={st} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <i style={{ width: 9, height: 9, borderRadius: 5, background: STATUS_COLOR[st], display: "inline-block" }} />{statusLabel(st)} <N v={s.byStatus[st].n} ids={s.byStatus[st].ids} label={`${s.name} · ${statusLabel(st)}`} />
                        </span>
                      ))}
                    </div>
                    {s.byStage && REPAIR_STAGES.some((st) => s.byStage![st]?.n) && (
                      <div className="stagechips" aria-label={t("v6DashBoard")}>
                        {REPAIR_STAGES.map((st) => <span key={st} className={s.byStage![st].n ? "on" : ""} title={`${t(("v5Stage_" + st) as never)}: ${s.byStage![st].n}`}>{t(("v5Stage_" + st) as never)} <N v={s.byStage![st].n} ids={s.byStage![st].ids} label={`${s.name} · ${t(("v5Stage_" + st) as never)}`} /></span>)}
                      </div>
                    )}
                    {s.repairsToday && s.repairsToday.capacity > 0 && <div style={{ fontSize: 13, marginTop: 6 }}>{t("v6DashToday")}: <b>{s.repairsToday.booked} / {s.repairsToday.capacity}</b></div>}
                    <div style={{ fontSize: 13, marginTop: 6, color: "var(--sub)" }}>
                      {t("arrivalsToday")}: <N v={s.arrivalsToday.n} ids={s.arrivalsToday.ids} label={`${s.name} · ${t("arrivalsToday")}`} />
                      {" · "}{t("departuresToday")}: <N v={s.departuresToday.n} ids={s.departuresToday.ids} label={`${s.name} · ${t("departuresToday")}`} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title={t("dashTech")} right={embedded ? (f.can("wochenbericht.voir") ? (
              // in the new interface the weekly report (Verwaltung) replaces the old technician sheet and its Excel
              <a className="chip on" href="#/admin/weekly" style={{ minHeight: 40, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>{t("v6MenuWeekly")}</a>
            ) : undefined) : f.can("repartition_interne.voir") ? (
              <button className="chip on" disabled={busy} onClick={() => setChoose(true)} style={{ minHeight: 40 }}>{busy ? t("exportBusy") : `📥 ${t("exportTech")}`}</button>
            ) : undefined}>
              {!embedded && f.can("repartition_interne.voir") && <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t("exportTechHint")}</div>}
              {data.technicians.length === 0 ? <div className="muted">{t("noneDash")}</div> : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ textAlign: "left" }}><th>{t("name")}</th><th>{t("assignedN")}</th><th>{t("inProgressN")}</th><th>{t("finishedN")}</th><th>{t("sites")}</th></tr></thead>
                    <tbody>{data.technicians.map((x) => (
                      <tr key={x.key} style={{ borderTop: "1px solid var(--line)" }}>
                        <td><b>{x.name}</b></td>
                        <td><N v={x.assigned.n} ids={x.assigned.ids} label={`${x.name} · ${t("assignedN")}`} /></td>
                        <td><N v={x.inProgress.n} ids={x.inProgress.ids} label={`${x.name} · ${t("inProgressN")}`} /></td>
                        <td><N v={x.finished.n} ids={x.finished.ids} label={`${x.name} · ${t("finishedN")}`} /></td>
                        <td>{x.sites.map((s) => s.name).join(", ") || "—"}
                          {x.noRoleOnSite.n > 0 && <div style={{ color: "var(--brick)", fontSize: 12 }}>⚠ <N v={x.noRoleOnSite.n} ids={x.noRoleOnSite.ids} label={`${x.name} · ${t("noRoleOnSite")}`} /> {t("noRoleOnSite")}</div>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title={t("dashDurations")}>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 8 }}>
                <div>{t("avgToReturned")}: <b>{data.durations.avgArrivalToReturnedDays ?? "—"}</b> {t("daysShort")} <span className="muted">({data.durations.returnedSamples})</span></div>
                <div>{t("avgRepair")}: <b>{data.durations.avgRepairDays ?? "—"}</b> {t("daysShort")} <span className="muted">({data.durations.repairSamples})</span></div>
              </div>
              <h3 style={{ margin: "8px 0 4px", fontSize: 15 }}>{t("delayedVehicles")} ({data.delayed.length})</h3>
              {data.delayed.length === 0 ? <div className="muted">{t("noneDash")}</div> : (
                <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><tbody>
                  {data.delayed.map((d) => (
                    <tr key={d.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td><a href={`#/v/${d.id}/basis`}><b>{d.plate || "—"}</b></a></td><td>{d.stationName}</td>
                      <td>{statusLabel(d.statut)}{d.motif ? ` · ${holdReasonLabel(d.motif)}` : ""}</td>
                      <td style={{ color: "var(--brick)" }}>{t("sinceDays").replace("{n}", String(d.days)).replace("{max}", String(d.thresholdDays))}</td>
                    </tr>
                  ))}
                </tbody></table></div>
              )}
              <h3 style={{ margin: "10px 0 4px", fontSize: 15 }}>{t("holdByReason")}</h3>
              {data.hold.length === 0 ? <div className="muted">{t("noneDash")}</div> : data.hold.map((h) => (
                <div key={h.reason}>{holdReasonLabel(h.reason)}: <N v={h.n} ids={h.ids} label={`${statusLabel("attente")} · ${holdReasonLabel(h.reason)}`} /></div>
              ))}
              {f.can("parametres.gerer") && thr && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer" }}>{t("delayThresholds")}</summary>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                    {STATUSES.filter((s) => s !== "rendu").map((s) => (
                      <label key={s} style={{ display: "flex", gap: 4, alignItems: "center" }}>{statusLabel(s)}
                        <input className="inp" type="number" min={0} max={365} style={{ width: 70, minHeight: 36 }} value={thr[s] ?? ""} placeholder="—"
                          onChange={(e) => { const next = { ...thr }; if (e.target.value === "") delete next[s]; else next[s] = Number(e.target.value); setThr(next); }}
                          onBlur={async () => { try { await api("PUT", "/admin/settings", { delayDays: thr }); void load(); } catch (x) { setErr((x as Error).message); } }} />
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </Section>

            {data.revenue && (
              <Section title={t("dashRevenue")}>
                <div style={{ fontSize: 18, marginBottom: 8 }}>{t("revTotal")}: <b>{money(data.revenue.total)}</b></div>
                {data.revenue.split && (
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 10, fontSize: 14 }}>
                    <span>{t("splitTech")}: <b>{money(data.revenue.split.technicians)}</b></span><span>{t("splitComm")}: <b>{money(data.revenue.split.commissions)}</b></span><span>{t("splitRest")}: <b>{money(data.revenue.split.rest)}</b></span>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
                  <Bars title={t("revBySite")} rows={data.revenue.bySite} money={money} />
                  <Bars title={t("revByClient")} rows={data.revenue.byClient} money={money} />
                  <Bars title={t("revByInsurer")} rows={data.revenue.byInsurer} money={money} />
                  <Bars title={t("revByMonth")} rows={data.revenue.byMonth.map((m) => ({ id: m.month, name: m.month, net: m.net, n: m.n, ids: m.ids }))} money={money} />
                </div>
              </Section>
            )}
            <button className="chip" onClick={() => go({ page: "list" })}>‹ {t("back")}</button>
            {choose && (
              <Dialog title={t("exportTech")} onClose={() => setChoose(false)}>
                <div className="muted" style={{ marginBottom: 8 }}>{t("exportChoose")} · {fmtDay(range.from)} – {fmtDay(range.to)}</div>
                <button className="pbtn" onClick={() => void exportTech("pdf")}>📄 {t("exportPdf")}</button>
                <button className="pbtn sec" onClick={() => void exportTech("xlsx")}>📊 {t("exportExcel")}</button>
              </Dialog>
            )}
          </>
        )}
      </div>
    </div>
  );
}
