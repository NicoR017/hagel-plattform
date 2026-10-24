import type { ReactNode } from "react";
import { t } from "../i18n";
import { go, type Mode } from "../field/route";
import { useField, useVehicles } from "../field/store";
import { setPrefs } from "../sync/mutations";
import { stationCounts } from "./modes";
import { OccLine, typeLabel } from "./Stations";
import { CitasDayBlock } from "./CitasDay";
import { useNewScans } from "./useScans";

const ICON: Record<Mode, ReactNode> = {
  kalk: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1D4FB8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4" /></svg>,
  rep: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0B5F73" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></svg>,
  all: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3B4555" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
};
const BG: Record<Mode, string> = { kalk: "#E3ECFD", rep: "#E2F3F6", all: "#EEF0F3" };

/** Second screen: three big cards (Kalkulation / Reparatur / Alle Fahrzeuge) with their counts. */
export function ModeChoice({ stationId }: { stationId: string }) {
  const f = useField();
  const vehicles = useVehicles();
  const scans = useNewScans();
  const st = f.refs?.stations.find((s) => s.id === stationId);
  if (!st) return <main><p className="empty">{f.refs ? t("v3NoStations") : t("loading")}</p></main>;
  const c = stationCounts(vehicles, st.id);
  const present = f.refs?.occupancy?.[st.id] ?? c.rep;
  const nScans = scans.byStation.get(st.name) ?? 0;
  const pick = (mode: Mode) => { void setPrefs(f.db, { lastStationId: st.id, lastMode: mode }); go({ page: "list", stationId: st.id, mode }); };

  const card = (mode: Mode, title: string, text: string, pills: { text: string; bg: string; fg: string }[]) => (
    <button className="modecard" onClick={() => pick(mode)}>
      <span className="ic" style={{ background: BG[mode] }}>{ICON[mode]}</span>
      <h3>{title}</h3>
      <span className="sub">{text}</span>
      <span className="pills">{pills.map((p) => <span key={p.text} style={{ background: p.bg, color: p.fg }}>{p.text}</span>)}</span>
    </button>
  );

  return (
    <main style={{ maxWidth: 1040 }}>
      <section className="panel" style={{ padding: "18px 20px", display: "flex", flexWrap: "wrap", gap: "16px 28px", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("v3StationWord")} · {typeLabel(st.type)}</span>
          <h1 style={{ fontSize: 22 }}>{st.name}</h1>
          <span className="muted" style={{ fontSize: 13 }}>{[st.address, st.azureTenant ? `${t("v3Tenant")} ${st.azureTenant}` : ""].filter(Boolean).join(" · ")}</span>
        </div>
        <div style={{ flex: "0 1 260px", minWidth: 200 }}><OccLine present={present} capacity={st.capacite} /></div>
        <button className="btn" onClick={() => { try { sessionStorage.setItem("hagel.v3.autoStation", "1"); } catch { /* ignore */ } go({ page: "list" }); }}>{t("v3SwitchStation")}</button>
      </section>

      <CitasDayBlock stationId={st.id} />

      <h2 style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>{t("v3WorkOn")}</h2>
      <div className="modes">
        {card("kalk", t("v3ModeKalk"), t("v3ModeKalkText"), [
          { text: `${c.kalk} ${t("v3Open")}`, bg: "#E3ECFD", fg: "#1D4FB8" },
          ...(scans.known ? [{ text: `${nScans} ${t("v3NewScans")}`, bg: "#EEF0F3", fg: "#3B4555" }] : []),
        ])}
        {card("rep", t("v3ModeRep"), t("v3ModeRepText"), [
          { text: `${c.rep} ${t("v3InRepair")}`, bg: "#E2F3F6", fg: "#0B5F73" },
          { text: `${c.wait} ${t("v3Waiting")}`, bg: "#FDF0E1", fg: "#8A4A06" },
        ])}
        {card("all", t("v3ModeAll"), t("v3ModeAllText"), [{ text: `${c.present} ${t("v3OnSite")}`, bg: "#EEF0F3", fg: "#3B4555" }])}
      </div>
    </main>
  );
}
