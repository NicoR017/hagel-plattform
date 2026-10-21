import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { t } from "../i18n";
import { go } from "../field/route";
import { useField, useVehicles } from "../field/store";
import { getPrefs } from "../sync/mutations";
import { occLevel } from "../field/occupancy";
import { inMode, stationCounts } from "./modes";
import { useNewScans } from "./useScans";

export const typeLabel = (type: string) => (type === "hall" ? t("v3TypeHall") : type === "parc" ? t("v3TypeParc") : t("v3TypeCarrosserie"));
export const occColor = (present: number, capacity: number) => {
  const l = occLevel(present, capacity);
  return l === "full" || l === "over" ? "#B42318" : l === "warn" ? "#B45309" : "#1E7B4C";
};

export function OccLine({ present, capacity }: { present: number; capacity: number }) {
  const pct = capacity ? Math.min(100, Math.round((present / capacity) * 100)) : 0;
  const col = occColor(present, capacity);
  const full = capacity > 0 && present >= capacity;
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span className="muted">{t("v3Occupancy")}</span>
        <span style={{ fontWeight: 600, color: col }}>{capacity ? `${present} / ${capacity} ${t("v3Places")}` : String(present)}{full ? ` · ${t("full")}` : ""}</span>
      </span>
      {capacity > 0 && <span className="bar"><i style={{ width: pct + "%", background: col }} /></span>}
    </span>
  );
}

/** First screen: the stations of the user, with occupancy and counts. The user picks the one he works in today. */
export function Stations({ userName }: { userName: string }) {
  const f = useField();
  const vehicles = useVehicles();
  const scans = useNewScans();
  const prefs = useLiveQuery(() => getPrefs(f.db), [f.db]);
  const [q, setQ] = useState("");
  const list = useMemo(() => (f.refs?.stations ?? []).filter((s) => s.active), [f.refs]);
  const last = prefs?.lastStationId ?? null;
  const lastStation = list.find((s) => s.id === last);

  // a user with exactly one station goes straight in (once per session, so "Station wechseln" does not bounce him back)
  useEffect(() => {
    if (list.length !== 1) return;
    let seen = false;
    try { seen = sessionStorage.getItem("hagel.v3.autoStation") === "1"; sessionStorage.setItem("hagel.v3.autoStation", "1"); } catch { /* ignore */ }
    if (!seen) go({ page: "mode", stationId: list[0].id });
  }, [list]);

  const needle = q.trim().toLowerCase();
  const shown = list.filter((s) => !needle || `${s.name} ${s.address ?? ""} ${s.azureTenant ?? ""}`.toLowerCase().includes(needle));
  const first = userName.split(/[\s@]/)[0];
  const present = list.reduce((a, s) => a + (f.refs?.occupancy?.[s.id] ?? 0), 0);
  const kalk = vehicles.filter((v) => list.some((s) => s.id === v.stationId) && inMode(v, "kalk")).length;
  const rep = vehicles.filter((v) => v.statut === "reparatur" && list.some((s) => s.id === v.stationId)).length;

  return (
    <main>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>{t("v3Hello")} {first}</h1>
          <p className="sub" style={{ margin: "4px 0 0" }}>{t("v3PickStation")}</p>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#5B6576", flex: "0 1 320px", minWidth: 200 }}>
          {t("v3SearchStation")}
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("v3SearchStationPh")} />
        </label>
      </div>

      {lastStation && !needle && (
        <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => go({ page: "mode", stationId: lastStation.id })}>
          {t("v3ContinueIn")} {lastStation.name} →
        </button>
      )}

      <section aria-label={t("v3Overview")} className="kpis">
        <div className="kpi"><div className="l">{t("v3KpiPresent")}</div><div className="n">{present}</div></div>
        <div className="kpi"><div className="l">{t("v3KpiCalc")}</div><div className="n">{kalk}</div></div>
        <div className="kpi"><div className="l">{t("v3KpiRep")}</div><div className="n">{rep}</div></div>
        {scans.known && <div className="kpi"><div className="l">{t("v3KpiScans")}</div><div className="n">{scans.total}</div></div>}
      </section>

      <section aria-label={t("v3Stations")} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600 }}>{t("v3MyStations")}</h2>
        {!shown.length && <p className="empty">{f.refs ? t("v3NoStations") : t("loading")}</p>}
        <div className="stgrid">
          {shown.map((s) => {
            const c = stationCounts(vehicles, s.id);
            return (
              <button key={s.id} className={"stcard" + (s.id === last ? " last" : "")} onClick={() => go({ page: "mode", stationId: s.id })}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{[s.address, s.azureTenant ? `${t("v3Tenant")} ${s.azureTenant}` : ""].filter(Boolean).join(" · ") || "—"}</span>
                  </span>
                  <span className="badge" style={{ background: "#EEF0F3", color: "#3B4555" }}>{typeLabel(s.type)}</span>
                </span>
                <OccLine present={f.refs?.occupancy?.[s.id] ?? c.present} capacity={s.capacite} />
                <span className="three">
                  <span><b>{c.kalk}</b>{t("v3ModeKalk")}</span>
                  <span><b>{c.rep}</b>{t("v3ModeRep")}</span>
                  <span><b>{scans.byStation.get(s.name) ?? (scans.known ? 0 : "–")}</b>{t("v3NewScans")}</span>
                </span>
                {s.id === last && <span className="badge" style={{ position: "absolute", top: -10, right: 12, background: "#1D4FB8", color: "#fff" }}>{t("v3LastUsed")}</span>}
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
