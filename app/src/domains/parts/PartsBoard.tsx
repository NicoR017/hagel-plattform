import { useMemo, useState } from "react";
import { go } from "../../shared/route";
import { shareOrDownload } from "../../shared/docs";
import { t, type Key } from "../../shared/i18n";
import { useField, useVehicles } from "../../shared/store";
import { allZones, zoneLabel } from "../vehicles/partsLogic";
import { StatusPill } from "./CarParts";
import { PartActions } from "./PartActions";
import { COLUMNS, carPartsState, deliveredOf, matchesRow, partsCsv, plateOf, rowsOf, statusLabel, type PartRow } from "./partsBoardLogic";
import { partsOfVehicle } from "../vehicles/partsLogic";

export type PartsView = "part" | "car" | "all";

/**
 * Repair → Parts board: one card per part in the columns To order · Order sent · Ordered · Delivered · Installed; views By part, By car and All parts
 * (every station of the user), filtered on one car when a car is chosen. No prices: the parts are ordered and billed through the body shop.
 */
export function PartsBoard({ stationId, view, car }: { stationId: string; view: PartsView; car?: string }) {
  const f = useField();
  const all = useVehicles();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [zone, setZone] = useState("all");
  const custom = f.refs?.parts?.zones ?? [];
  const st = f.refs?.stations.find((s) => s.id === stationId);
  const scope = useMemo(() => all.filter((v) => (view === "all" || v.stationId === stationId) && (!car || v.id === car)), [all, stationId, view, car]);
  const rows = useMemo(() => rowsOf(scope).filter((r) => matchesRow(r, q, custom)), [scope, q, custom]); // eslint-disable-line react-hooks/exhaustive-deps
  const carV = car ? all.find((v) => v.id === car) : undefined;
  const to = (o: { view?: PartsView; car?: string | null }) => go({ page: "parts", stationId, view: o.view ?? view, ...(o.car === null ? {} : { car: o.car ?? car }) });
  const stationName = (id: string | null) => f.refs?.stations.find((s) => s.id === id)?.name ?? "";
  const exportCsv = async () => {
    const list = (view === "all" ? rows.filter((r) => (status === "all" || r.p.status === status) && (zone === "all" || r.p.zoneKey === zone)) : rows);
    await shareOrDownload(new Blob([partsCsv(list, stationName, custom)], { type: "text/csv;charset=utf-8" }), `parts_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv");
  };
  const views: { k: PartsView; label: Key }[] = [{ k: "part", label: "f3ByPart" }, { k: "car", label: "f3ByCar" }, { k: "all", label: "f3AllParts" }];

  return (
    <main>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22 }}>🔩 {t("f3PartsTitle")}</h1>
          <p className="sub" style={{ margin: "2px 0 0", fontSize: 13 }}>{view === "all" ? t("f3AllParts") : st?.name ?? ""} · {t("f3Count").replace("{n}", String(rows.length))}</p>
        </div>
        {f.can("export.excel") && <button className="btn" onClick={() => void exportCsv()}>📊 {t("f3ExportParts")}</button>}
      </div>

      <div role="group" aria-label={t("f3ViewLabel")} style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0" }}>
        <button className="chip" onClick={() => go({ page: "list", stationId, mode: "rep" })}>{t("v5ViewBoard")}</button>
        {views.map((x) => <button key={x.k} className={"chip" + (view === x.k ? " on" : "")} aria-pressed={view === x.k} onClick={() => to({ view: x.k })}>{t(x.label)}</button>)}
      </div>

      {carV && (
        <div role="status" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between", background: "#EAF2FF", border: "1px solid #C9DBF8", borderRadius: 12, padding: "10px 14px", margin: "0 0 10px" }}>
          <b>🚗 {t("f3CarBanner").replace("{plate}", plateOf(carV))} <span className="muted" style={{ fontWeight: 400 }}>· {String((carV as Record<string, unknown>).modell ?? "")}</span></b>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="chip" onClick={() => go({ page: "repair", id: carV.id, tab: "teile", stationId })}>{t("f3OpenRepair")}</button>
            <button className="chip" onClick={() => to({ car: null })}>{t("f3AllCars")}</button>
          </span>
        </div>
      )}

      <div className="toolbar" style={{ marginBottom: 10 }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("f3Search")} aria-label={t("f3Search")} style={{ flex: "1 1 240px" }} />
        {view === "all" && (
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("f3Status")}><option value="all">{t("f3AllStatus")}</option>{COLUMNS.map((c) => <option key={c} value={c}>{statusLabel(c)}</option>)}</select>
            <select value={zone} onChange={(e) => setZone(e.target.value)} aria-label={t("f3Zone")}><option value="all">{t("f3AllZones")}</option>{allZones(f.refs?.parts).map((z) => <option key={z.key} value={z.key}>{z.label}</option>)}</select>
          </>
        )}
      </div>

      {view === "part" && (
        <div className="board" style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(230px, 1fr)", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
          {COLUMNS.map((col) => {
            const list = rows.filter((r) => r.p.status === col);
            return (
              <section key={col} className="col3" aria-label={statusLabel(col)}>
                <div className="colhd"><b>{statusLabel(col)}</b><span>{list.length}</span></div>
                {list.map((r) => <PartCard key={r.p.id} r={r} stationId={stationId} />)}
                {!list.length && <span className="muted dropzone">—</span>}
              </section>
            );
          })}
        </div>
      )}

      {view === "car" && <ByCar rows={rows} scope={scope} stationId={stationId} />}

      {view === "all" && (
        <table>
          <thead><tr><th>{t("f3Plate")}</th><th>Part</th><th>{t("f3Zone")}</th><th>{t("f3Qty")}</th><th>{t("f3Status")}</th><th /></tr></thead>
          <tbody>{rows.filter((r) => (status === "all" || r.p.status === status) && (zone === "all" || r.p.zoneKey === zone)).map((r) => (
            <tr key={r.p.id}>
              <td><button className="linkbtn" onClick={() => go({ page: "repair", id: r.v.id, tab: "teile", stationId: (r.v.stationId as string) || stationId })}>{plateOf(r.v)}</button><div className="muted" style={{ fontSize: 12 }}>{stationName(r.v.stationId as string | null)}</div></td>
              <td>{r.p.name}{r.p.oemRef ? <span className="muted"> · OEM {r.p.oemRef}</span> : null}</td>
              <td>{r.p.zoneKey ? zoneLabel(r.p.zoneKey, custom) : "—"}</td>
              <td>{r.p.qty}</td>
              <td><StatusPill s={r.p.status} /></td>
              <td><PartActions v={r.v} p={r.p} compact /></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {!rows.length && <p className="muted" style={{ marginTop: 14 }}>{t("f3NoParts")}</p>}
    </main>
  );
}

function PartCard({ r, stationId }: { r: PartRow; stationId: string }) {
  const f = useField();
  const custom = f.refs?.parts?.zones ?? [];
  return (
    <div className="card3" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button className="open" onClick={() => go({ page: "parts", stationId, view: "part", car: r.v.id })}>
        <b>{r.p.name}{r.p.qty > 1 ? ` × ${r.p.qty}` : ""}</b>
        <span className="muted" style={{ fontSize: 12 }}>{r.p.zoneKey ? zoneLabel(r.p.zoneKey, custom) : t("f2BoxZone")}</span>
        <span style={{ fontSize: 13 }}>🚗 {plateOf(r.v)} <span className="muted">{String((r.v as Record<string, unknown>).modell ?? "")}</span></span>
        {(r.p.returnCount ?? 0) > 0 && <span className="badge" style={{ background: "#FBE7E4", color: "#9B2C1F", fontSize: 11, alignSelf: "flex-start" }}>↩ {t("f3ReturnedTimes").replace("{n}", String(r.p.returnCount))}</span>}
      </button>
      <PartActions v={r.v} p={r.p} compact />
    </div>
  );
}

/** one row per car: its parts and where they stand, and the way into the board filtered on that car */
function ByCar({ scope, stationId }: { rows: PartRow[]; scope: ReturnType<typeof useVehicles>; stationId: string }) {
  const cars = scope.filter((v) => partsOfVehicle(v as { parts?: never }).length > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {cars.map((v) => {
        const parts = partsOfVehicle(v as { parts?: never });
        const state = carPartsState(parts), { d, n } = deliveredOf(parts);
        return (
          <section key={v.id} className="panel" style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <b>🚗 {plateOf(v)} <span className="muted" style={{ fontWeight: 400 }}>{String((v as Record<string, unknown>).modell ?? "")}</span></b>
              <span><span className="badge" style={{ background: state === "ready" || state === "installed" ? "#E3F4EA" : "#FDF0E1", color: state === "ready" || state === "installed" ? "#17663F" : "#8A4A06" }}>{t(`f3CarState_${state}` as Key)}</span> <span className="muted">{t("f3OfTotal").replace("{d}", String(d)).replace("{n}", String(n))}</span></span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>{parts.map((p) => <span key={p.id} className="pill">{p.name} · {statusLabel(p.status)}</span>)}</div>
            <button className="chip" onClick={() => go({ page: "parts", stationId, view: "part", car: v.id })}>{t("f3PartsPartsBoard")}</button>
          </section>
        );
      })}
    </div>
  );
}
