import { useMemo, useState } from "react";
import { api } from "../../api";
import { go } from "../../shared/route";
import { t, type Key } from "../../shared/i18n";
import { useField, useVehicles } from "../../shared/store";
import { toast } from "../../shared/toast";
import { PANEL_MAP } from "@hagel/calc";
import { PaintActions, usePartners } from "./PaintActions";
import { PAINT_COLUMNS, addDays, elementName, inRepair, matchesPaint, mondayOf, paintOf, paintProgress, paintStatus, rowsOfPaint, ymdOf, weekDays, type PaintRow } from "./paintLogic";
import { plateOf } from "../parts/partsBoardLogic";

export type PaintView = "element" | "car" | "calendar";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
const COLOR: Record<string, { bg: string; fg: string }> = { to_paint: { bg: "#EEF1F6", fg: "#46526A" }, scheduled: { bg: "#E3ECFD", fg: "#1D4FB8" }, at_body_shop: { bg: "#FDF0E1", fg: "#8A4A06" }, done: { bg: "#E3F4EA", fg: "#17663F" } };
export const PaintPill = ({ s }: { s: string }) => <span className="badge" style={{ background: (COLOR[s] ?? COLOR.to_paint).bg, color: (COLOR[s] ?? COLOR.to_paint).fg, fontSize: 11 }}>{paintStatus(s)}</span>;

/**
 * Repair → Paint board: one card per element to paint in the columns To paint · Scheduled · At body shop · Done; views By element, By car and the weekly calendar of the
 * partner body shops; filtered on one car when a car is chosen (with a switch to the Parts board of the same car).
 */
export function PaintBoard({ stationId, view, car }: { stationId: string; view: PaintView; car?: string }) {
  const f = useField();
  const all = useVehicles();
  const [q, setQ] = useState("");
  const st = f.refs?.stations.find((s) => s.id === stationId);
  const scope = useMemo(() => all.filter((v) => (view === "calendar" || v.stationId === stationId) && (!car || v.id === car) && inRepair(v)), [all, stationId, view, car]);
  const rows = useMemo(() => rowsOfPaint(scope).filter((r) => matchesPaint(r, q)), [scope, q]);
  const carV = car ? all.find((v) => v.id === car) : undefined;
  const to = (o: { view?: PaintView; car?: string | null }) => go({ page: "paint", stationId, view: o.view ?? view, ...(o.car === null ? {} : { car: o.car ?? car }) });
  const views: { k: PaintView; label: Key }[] = [{ k: "element", label: "f5ByElement" }, { k: "car", label: "f5ByCar" }, { k: "calendar", label: "f5Calendar" }];
  return (
    <main>
      <h1 style={{ fontSize: 22 }}>🎨 {t("f5PaintTitle")}</h1>
      <p className="sub" style={{ margin: "2px 0 10px", fontSize: 13 }}>{view === "calendar" ? t("f5Calendar") : st?.name ?? ""} · {t("f5Count").replace("{n}", String(rows.length))}</p>
      <div role="group" aria-label={t("f3ViewLabel")} style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0" }}>
        <button className="chip" onClick={() => go({ page: "list", stationId, mode: "rep" })}>{t("v5ViewBoard")}</button>
        <button className="chip" onClick={() => go({ page: "parts", stationId, view: "part", ...(car ? { car } : {}) })}>🔩 {t("f3ViewParts")}</button>
        {views.map((x) => <button key={x.k} className={"chip" + (view === x.k ? " on" : "")} aria-pressed={view === x.k} onClick={() => to({ view: x.k })}>{t(x.label)}</button>)}
      </div>
      {carV && (
        <div role="status" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between", background: "#F3EEFB", border: "1px solid #D9CCF2", borderRadius: 12, padding: "10px 14px", margin: "0 0 10px" }}>
          <b>🎨 {t("f5CarBanner").replace("{plate}", plateOf(carV))} <span className="muted" style={{ fontWeight: 400 }}>· {String((carV as Record<string, unknown>).modell ?? "")}</span></b>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="chip" onClick={() => go({ page: "parts", stationId, view: "part", car: carV.id })}>🔩 {t("f5SwitchParts")}</button>
            <button className="chip" onClick={() => go({ page: "repair", id: carV.id, tab: "lack", stationId })}>{t("f3OpenRepair")}</button>
            <button className="chip" onClick={() => to({ car: null })}>{t("f3AllCars")}</button>
          </span>
        </div>
      )}
      {view !== "calendar" && <div className="toolbar" style={{ marginBottom: 10 }}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("f5Search")} aria-label={t("f5Search")} style={{ flex: "1 1 240px" }} /></div>}

      {view === "element" && (
        <div className="board" style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(230px, 1fr)", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
          {PAINT_COLUMNS.map((col) => {
            const list = rows.filter((r) => r.j.status === col);
            return (
              <section key={col} className="col3" aria-label={paintStatus(col)}>
                <div className="colhd"><b>{paintStatus(col)}</b><span>{list.length}</span></div>
                {list.map((r) => <PaintCard key={r.j.id} r={r} stationId={stationId} />)}
                {!list.length && <span className="muted dropzone">—</span>}
              </section>
            );
          })}
        </div>
      )}
      {view === "car" && <PaintByCar scope={scope} stationId={stationId} q={q} />}
      {view === "calendar" && <PaintCalendar rows={rows} />}
      {view !== "calendar" && !rows.length && <p className="muted" style={{ marginTop: 14 }}>{car ? t("f5NoJobsCar") : t("f5NoJobs")}</p>}
    </main>
  );
}

const when = (j: PaintRow["j"]) => (j.plannedDate ? t("f5At").replace("{d}", j.plannedDate.split("-").reverse().join("/")).replace("{t}", j.plannedTime ?? "—") : "");

function PaintCard({ r, stationId }: { r: PaintRow; stationId: string }) {
  const f = useField();
  const partner = f.refs?.bodyshops.find((b) => b.id === r.j.partnerId)?.name;
  return (
    <div className="card3" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button className="open" onClick={() => go({ page: "paint", stationId, view: "element", car: r.v.id })}>
        <b>{elementName(r.j.elementKey)}</b>
        <span style={{ fontSize: 13 }}>🚗 {plateOf(r.v)} <span className="muted">{String((r.v as Record<string, unknown>).modell ?? "")}</span></span>
        {(r.v as { noMove?: boolean }).noMove && <span className="badge" style={{ background: "#FBE7E4", color: "#9B2C1F", fontSize: 11, alignSelf: "flex-start" }}>🚫 {t("f1NoMove")}</span>}
        {r.j.status !== "to_paint" && <span className="muted" style={{ fontSize: 12 }}>{partner ?? ""} {when(r.j)}{r.j.customerAppointment ? ` · 👤 ${t("f5ByCustomer")}` : ""}</span>}
      </button>
      <PaintActions v={r.v} job={r.j} />
    </div>
  );
}

function PaintByCar({ scope, stationId, q }: { scope: ReturnType<typeof useVehicles>; stationId: string; q: string }) {
  const cars = scope.filter((v) => paintOf(v).length > 0 && (!q.trim() || plateOf(v).toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {cars.map((v) => {
        const jobs = paintOf(v), { d, n } = paintProgress(jobs);
        return (
          <section key={v.id} className="panel" style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <b>🚗 {plateOf(v)} <span className="muted" style={{ fontWeight: 400 }}>{String((v as Record<string, unknown>).modell ?? "")}</span></b>
              <span><span className="badge" style={{ background: d === n ? "#E3F4EA" : "#F3EEFB", color: d === n ? "#17663F" : "#5B3FA0" }}>{d === n ? t("f5AllDone") : t("f5Progress").replace("{d}", String(d)).replace("{n}", String(n))}</span></span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>{jobs.map((j) => <span key={j.id} className="pill">{elementName(j.elementKey)} · {paintStatus(j.status)}</span>)}</div>
            <button className="chip" onClick={() => go({ page: "paint", stationId, view: "element", car: v.id })}>{t("f5SwitchPaint")}</button>
          </section>
        );
      })}
    </div>
  );
}

/** R06: week per partner body shop; customer appointments are shown apart (the car stays where it is) */
function PaintCalendar({ rows }: { rows: PaintRow[] }) {
  const partners = usePartners();
  const [monday, setMonday] = useState(mondayOf(today()));
  const days = weekDays(monday);
  const planned = rows.filter((r) => r.j.plannedDate && r.j.status !== "to_paint");
  void api; void toast; void ymdOf; void PANEL_MAP; void addDays;
  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "0 0 10px" }}>
        <button className="chip" onClick={() => setMonday(addDays(monday, -7))}>‹ {t("f5CalPrev")}</button>
        <button className="chip" onClick={() => setMonday(mondayOf(today()))}>{t("f5CalToday")}</button>
        <button className="chip" onClick={() => setMonday(addDays(monday, 7))}>{t("f5CalNext")} ›</button>
        <b style={{ marginLeft: 8 }}>{days[0].split("-").reverse().join("/")} – {days[6].split("-").reverse().join("/")}</b>
      </div>
      {!partners.length && <p className="muted">{t("f5CalNoPartner")}</p>}
      {partners.map((p) => (
        <section key={p.id} className="panel" style={{ padding: "12px 14px", marginBottom: 12, overflowX: "auto" }}>
          <h3 style={{ margin: "0 0 8px" }}>🏭 {p.name}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(120px, 1fr))", gap: 6 }}>
            {days.map((d) => {
              const list = planned.filter((r) => r.j.partnerId === p.id && r.j.plannedDate === d);
              return (
                <div key={d} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 6, minHeight: 70, background: d === today() ? "#F5F8FD" : "#fff" }}>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "2-digit" })}</div>
                  {list.sort((a, b) => (a.j.plannedTime ?? "").localeCompare(b.j.plannedTime ?? "")).map((r) => (
                    <div key={r.j.id} title={r.j.customerAppointment ? t("f5CalCustomer") : undefined} style={{ fontSize: 12, borderRadius: 8, padding: "4px 6px", marginBottom: 4, background: r.j.customerAppointment ? "#FDF0E1" : "#E3ECFD", color: r.j.customerAppointment ? "#8A4A06" : "#1D4FB8" }}>
                      <b>{r.j.plannedTime ?? "—"}</b> {plateOf(r.v)}<br />{elementName(r.j.elementKey)}{r.j.customerAppointment ? " 👤" : ""}
                    </div>
                  ))}
                  {!list.length && <span className="muted" style={{ fontSize: 11 }}>—</span>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
