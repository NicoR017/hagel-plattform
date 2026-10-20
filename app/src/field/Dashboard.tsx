import { useCallback, useEffect, useState, type ReactNode } from "react";
import { STATUSES } from "@hagel/shared";
import { eur } from "@hagel/documents";
import { api } from "../api";
import { t } from "../i18n";
import { go } from "./route";
import { Occ, OccBar } from "./occupancy";
import { openFilteredList } from "./dashFilter";
import { holdReasonLabel, statusLabel } from "./Dialogs";
import { useField } from "./store";

interface Ids { n: number; ids: string[] }
interface Dash {
  generatedAt: string; vehicles: number; delayDays: Record<string, number>;
  sites: { id: string; name: string; type: string; capacity: number; present: number; presentIds: string[]; byStatus: Record<string, Ids>; arrivalsToday: Ids; departuresToday: Ids }[];
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
interface Row { id: string; name: string; net: number; n: number; ids: string[] }

/** A number that opens the vehicle list filtered by the vehicles behind it. */
function N({ v, ids, label }: { v: number; ids: string[]; label: string }) {
  if (!v) return <span className="muted">0</span>;
  return <a href="#" onClick={(e) => { e.preventDefault(); openFilteredList({ ids, label }); }} style={{ fontWeight: 700 }}>{v}</a>;
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section style={{ background: "#fff", borderRadius: 14, padding: "12px 14px", marginBottom: 14, boxShadow: "0 1px 6px rgba(20,35,63,.06)" }}>
    <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>{title}</h2>{children}
  </section>
);

export function Dashboard() {
  const f = useField();
  const [data, setData] = useState<Dash | null>(null);
  const [err, setErr] = useState("");
  const [site, setSite] = useState(""), [campaign, setCampaign] = useState(""), [client, setClient] = useState(""), [insurer, setInsurer] = useState("");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [thr, setThr] = useState<Record<string, number> | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (site) q.set("sites", site);
    if (campaign) q.set("campaign", campaign);
    if (client) q.set("client", client);
    if (insurer) q.set("insurer", insurer);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    try { setData(await api<Dash>("GET", `/dashboard${q.size ? "?" + q : ""}`)); setErr(""); }
    catch (e) { setErr(f.status.online ? (e as Error).message : t("dashOnline")); }
  }, [site, campaign, client, insurer, from, to, f.status.online]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (data && !thr) setThr(data.delayDays); }, [data, thr]);

  const refs = f.refs;
  const stations = refs?.stations ?? [];
  const money = (n: number) => eur(n);

  return (
    <div className="fld wide">
      <div className="hdr">
        <div className="top"><a className="iconbtn" href="#/" style={{ textDecoration: "none" }} aria-label={t("vehicles")}>‹</a></div>
        <h1>{t("dashboard")}</h1>
      </div>
      <div className="sheet">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <select className="sel" style={{ width: "auto" }} value={site} onChange={(e) => setSite(e.target.value)}><option value="">{t("allSites")}</option>{stations.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="sel" style={{ width: "auto" }} value={client} onChange={(e) => setClient(e.target.value)}><option value="">{t("allClients")}</option>{stations.filter((s) => s.type === "carrosserie").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="sel" style={{ width: "auto" }} value={insurer} onChange={(e) => setInsurer(e.target.value)}><option value="">{t("allInsurers")}</option>{(refs?.insurers ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <select className="sel" style={{ width: "auto" }} value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">{t("allCampaigns")}</option>{(refs?.campaigns ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <label style={{ display: "flex", gap: 4, alignItems: "center" }}>{t("periodFrom")}<input className="inp" type="date" style={{ width: "auto", minHeight: 40 }} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={{ display: "flex", gap: 4, alignItems: "center" }}>{t("periodTo")}<input className="inp" type="date" style={{ width: "auto", minHeight: 40 }} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {err && <div className="err">{err}</div>}
        {!data && !err && <p>{t("loading")}</p>}
        {data && (
          <>
            <Section title={t("dashSites")}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 10 }}>
                {data.sites.map((s) => (
                  <div key={s.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><b>{s.name}</b><Occ present={s.present} capacity={s.capacity} /></div>
                    {s.capacity > 0 && <OccBar present={s.present} capacity={s.capacity} />}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 13 }}>
                      {STATUSES.map((st) => <span key={st}>{statusLabel(st)}: <N v={s.byStatus[st].n} ids={s.byStatus[st].ids} label={`${s.name} · ${statusLabel(st)}`} /></span>)}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 6 }}>
                      {t("presentN")}: <N v={s.presentIds.length} ids={s.presentIds} label={`${s.name} · ${t("presentN")}`} />
                      {" · "}{t("arrivalsToday")}: <N v={s.arrivalsToday.n} ids={s.arrivalsToday.ids} label={`${s.name} · ${t("arrivalsToday")}`} />
                      {" · "}{t("departuresToday")}: <N v={s.departuresToday.n} ids={s.departuresToday.ids} label={`${s.name} · ${t("departuresToday")}`} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title={t("dashDurations")}>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 8 }}>
                <div>{t("avgToReturned")}: <b>{data.durations.avgArrivalToReturnedDays ?? "—"}</b> {t("daysShort")} <span className="muted">({data.durations.returnedSamples})</span></div>
                <div>{t("avgRepair")}: <b>{data.durations.avgRepairDays ?? "—"}</b> {t("daysShort")} <span className="muted">({data.durations.repairSamples})</span></div>
              </div>
              <h3 style={{ margin: "8px 0 4px", fontSize: 15 }}>{t("delayedVehicles")} ({data.delayed.length})</h3>
              {data.delayed.length === 0 ? <div className="muted">{t("noneDash")}</div> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}><tbody>
                  {data.delayed.map((d) => (
                    <tr key={d.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td><a href={`#/v/${d.id}/basis`}><b>{d.plate || "—"}</b></a></td><td>{d.stationName}</td>
                      <td>{statusLabel(d.statut)}{d.motif ? ` · ${holdReasonLabel(d.motif)}` : ""}</td>
                      <td style={{ color: "var(--brick)" }}>{t("sinceDays").replace("{n}", String(d.days)).replace("{max}", String(d.thresholdDays))}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
              <h3 style={{ margin: "10px 0 4px", fontSize: 15 }}>{t("holdByReason")}</h3>
              {data.hold.length === 0 ? <div className="muted">{t("noneDash")}</div> : data.hold.map((h) => (
                <div key={h.reason}>{holdReasonLabel(h.reason)}: <N v={h.n} ids={h.ids} label={`${statusLabel("attente")} · ${holdReasonLabel(h.reason)}`} /></div>
              ))}
              {f.can("parametres.gerer") && thr && (
                <details style={{ marginTop: 10 }}>
                  <summary>{t("delayThresholds")}</summary>
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

            <Section title={t("dashTech")}>
              {data.technicians.length === 0 ? <div className="muted">{t("noneDash")}</div> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ textAlign: "left" }}><th>{t("name")}</th><th>{t("assignedN")}</th><th>{t("inProgressN")}</th><th>{t("finishedN")}</th><th>{t("sites")}</th></tr></thead>
                  <tbody>{data.technicians.map((x) => (
                    <tr key={x.key} style={{ borderTop: "1px solid var(--line)" }}>
                      <td>{x.name}</td>
                      <td><N v={x.assigned.n} ids={x.assigned.ids} label={`${x.name} · ${t("assignedN")}`} /></td>
                      <td><N v={x.inProgress.n} ids={x.inProgress.ids} label={`${x.name} · ${t("inProgressN")}`} /></td>
                      <td><N v={x.finished.n} ids={x.finished.ids} label={`${x.name} · ${t("finishedN")}`} /></td>
                      <td>{x.sites.map((s) => s.name).join(", ") || "—"}
                        {x.noRoleOnSite.n > 0 && <div style={{ color: "var(--brick)", fontSize: 12 }}>⚠ <N v={x.noRoleOnSite.n} ids={x.noRoleOnSite.ids} label={`${x.name} · ${t("noRoleOnSite")}`} /> {t("noRoleOnSite")}</div>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </Section>

            {data.revenue && (
              <Section title={t("dashRevenue")}>
                <div style={{ fontSize: 18, marginBottom: 8 }}>{t("revTotal")}: <b>{money(data.revenue.total)}</b> <span className="muted" style={{ fontSize: 13 }}>(<N v={data.revenue.n} ids={data.revenue.ids} label={t("dashRevenue")} /> {t("vehiclesCount")})</span></div>
                {data.revenue.split && (
                  <div style={{ marginBottom: 8, fontSize: 14 }}>
                    {t("splitTech")}: <b>{money(data.revenue.split.technicians)}</b> · {t("splitComm")}: <b>{money(data.revenue.split.commissions)}</b> · {t("splitRest")}: <b>{money(data.revenue.split.rest)}</b>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14 }}>
                  {([[t("revBySite"), data.revenue.bySite], [t("revByClient"), data.revenue.byClient], [t("revByInsurer"), data.revenue.byInsurer], [t("revByMonth"), data.revenue.byMonth.map((m) => ({ id: m.month, name: m.month, net: m.net, n: m.n, ids: m.ids }))]] as [string, Row[]][]).map(([title, rows]) => (
                    <div key={title}>
                      <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{title}</h3>
                      {rows.map((r) => <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{r.name}</span><span><b>{money(r.net)}</b> (<N v={r.n} ids={r.ids} label={`${title} · ${r.name}`} />)</span></div>)}
                    </div>
                  ))}
                </div>
              </Section>
            )}
            <button className="chip" onClick={() => go({ page: "list" })}>‹ {t("vehicles")}</button>
          </>
        )}
      </div>
    </div>
  );
}
