import { useMemo, useState } from "react";
import { eur } from "@hagel/documents";
import { t } from "../i18n";
import { go } from "../field/route";
import { statusLabel } from "../field/Dialogs";
import { useField, useVehicles } from "../field/store";
import { onBoard, stageOf } from "./boardLogic";
import { useSearchNames } from "./GlobalSearch";
import { STATUS_STYLE } from "./modes";
import { routeOfHit, searchVehicles, type SearchVehicle } from "./search";
import { typeLabel } from "./Stations";

/** Results of the global search: every station and status, chips per status and per station, the net amount only with `prix.voir`. */
export function SearchResults({ q }: { q: string }) {
  const f = useField();
  const vehicles = useVehicles();
  const names = useSearchNames();
  const [status, setStatus] = useState("all");
  const [station, setStation] = useState("all");
  const term = q.trim();
  const hits = useMemo(() => searchVehicles(vehicles as unknown as SearchVehicle[], term, names), [vehicles, term, names]);
  const byStatus = useMemo(() => { const m = new Map<string, number>(); for (const v of hits) m.set(v.statut, (m.get(v.statut) ?? 0) + 1); return m; }, [hits]);
  const afterStatus = hits.filter((v) => status === "all" || v.statut === status);
  const byStation = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of hits.filter((x) => status === "all" || x.statut === status)) m.set(v.stationId ?? "", (m.get(v.stationId ?? "") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => names.station(a[0]).localeCompare(names.station(b[0]), "de"));
  }, [hits, status, names]);
  const shown = afterStatus.filter((v) => station === "all" || (v.stationId ?? "") === station);
  const prices = f.can("prix.voir");
  const stationOf = (id?: string | null) => f.refs?.stations.find((s) => s.id === id);

  return (
    <main style={{ maxWidth: 980 }}>
      <div>
        <h1 style={{ fontSize: 24 }}>{t("srTitle")}</h1>
        <p className="sub" style={{ margin: "2px 0 0" }}>„{term}“ · {hits.length}</p>
      </div>
      {hits.length > 0 && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="group" aria-label={t("srAllStatus")}>
            <button className={"chip" + (status === "all" ? " on" : "")} onClick={() => { setStatus("all"); setStation("all"); }}>{t("srAllStatus")} ({hits.length})</button>
            {[...byStatus.entries()].map(([s, n]) => <button key={s} className={"chip" + (status === s ? " on" : "")} onClick={() => { setStatus(s); setStation("all"); }}>{statusLabel(s)} ({n})</button>)}
          </div>
          {byStation.length > 1 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="group" aria-label={t("srAllStations")}>
              <button className={"chip" + (station === "all" ? " on" : "")} onClick={() => setStation("all")}>{t("srAllStations")} ({afterStatus.length})</button>
              {byStation.map(([id, n]) => <button key={id} className={"chip" + (station === id ? " on" : "")} onClick={() => setStation(id)}>{names.station(id) || "—"} ({n})</button>)}
            </div>
          )}
        </>
      )}
      {!hits.length && <p className="empty">{t("srNone").replace("{q}", term)}</p>}
      <div className="rows">
        {shown.map((v) => {
          const x = v as Record<string, unknown>, st = STATUS_STYLE[v.statut] ?? STATUS_STYLE.arrive, s = stationOf(v.stationId);
          const step = onBoard(v) ? stageOf(v) : null;
          const net = prices ? f.calcOf(v as never).netto : null;
          return (
            <button key={v.id} className="vrow" style={{ width: "100%", textAlign: "left", padding: 12 }} onClick={() => go(routeOfHit(v))}>
              <span className="c" style={{ flex: "1 1 190px" }}>
                <b style={{ fontSize: 16, whiteSpace: "nowrap" }}>{String(x.kennzeichen || "—")}</b>
                <span className="muted" style={{ fontSize: 12 }}>{String(x.modell ?? "")}</span>
              </span>
              <span className="c" style={{ flex: "1 1 200px", fontSize: 13 }}>
                <span>📍 {names.station(v.stationId) || "—"}{s ? <span className="muted" style={{ fontSize: 12 }}> · {typeLabel(s.type)}{step ? ` · ${t(("v5Stage_" + step) as never)}` : ""}</span> : null}</span>
                <span className="muted" style={{ fontSize: 12 }}>{[String(x.kunde ?? "") || names.station(v.clientStationId), names.insurer(v.insurerId), String(x.claimNumber ?? "")].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="badge" style={{ background: st.bg, color: st.fg }}>{statusLabel(v.statut)}</span>
              {net != null && <span style={{ minWidth: 90, textAlign: "right", fontWeight: 600 }} title={t("srNet")}>{eur(net)}</span>}
            </button>
          );
        })}
      </div>
    </main>
  );
}
