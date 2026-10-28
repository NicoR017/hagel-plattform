import { useEffect, useMemo, useRef, useState } from "react";
import { locale, t } from "../i18n";
import { go, hrefOf } from "../field/route";
import { addDays, carName, customerName, linkedStations, useCitasDay, useCitasMonth, useOnline, type Appt } from "./citas";

const addMonths = (m: string, n: number): string => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthTitle = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "long", year: "numeric", timeZone: "UTC" });
const dayTitle = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
/** weekday names, Monday first */
const weekdays = () => Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i, 12)).toLocaleDateString(locale(), { weekday: "short", timeZone: "UTC" }));
const HOURS = Array.from({ length: 12 }, (_, i) => 7 + i); // 07:00 – 18:00

/**
 * Month calendar of the appointments of a station's PDR Citas location: each day shows how many appointments it has;
 * a tap on a day lists them by hour; a tap on an appointment starts (or reopens) the expertise. Online only.
 */
export function CitasCalendar({ stationId, month: m0, date: d0 }: { stationId: string; month?: string; date?: string }) {
  const online = useOnline();
  const [month, setMonth] = useState<string | undefined>(m0 ?? d0?.slice(0, 7));
  const [date, setDate] = useState<string | undefined>(d0);
  const { data, error, loading, refresh } = useCitasMonth(stationId, month, online);
  const today = data?.today;
  const mon = month ?? data?.month ?? today?.slice(0, 7);
  const selected = date ?? (today && mon === today.slice(0, 7) ? today : undefined);
  const dayData = useCitasDay(stationId, selected, online && !!selected && !!data?.linked);
  const dayRef = useRef<HTMLElement>(null);

  // the address follows the month and the day (so "back" and a reload come back to the same place)
  useEffect(() => { if (mon) history.replaceState(null, "", hrefOf({ page: "calendar", stationId, month: mon, date: selected })); }, [stationId, mon, selected]);
  if (data?.linked) linkedStations.add(stationId);

  const cells = useMemo(() => {
    if (!mon) return [] as (string | null)[];
    const [y, mo] = mon.split("-").map(Number);
    const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; // Monday first
    const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return [...Array<null>(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${mon}-${String(i + 1).padStart(2, "0")}`)];
  }, [mon]);

  const pickDay = (d: string) => {
    setDate(d);
    if (window.innerWidth < 900) setTimeout(() => dayRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 50);
  };
  const gotoToday = () => { if (!today) return; setMonth(today.slice(0, 7)); setDate(today); };
  const open = (a: Appt) => {
    if (a.vehicleId) go({ page: "expertise", id: a.vehicleId, step: "basis", ctx: { stationId, mode: "kalk" } });
    else go({ page: "citas", stationId, date: a.date, appointmentId: a.id });
  };
  const badge = (a: Appt) => a.vehicleId ? { text: t("ciStarted"), bg: "#E4EEE5", fg: "#2F5535" }
    : a.status === "cancel_requested" ? { text: t("ciCancelReq"), bg: "#FDF0E1", fg: "#8A4A06" }
      : today && a.date < today ? { text: t("ciNoExpertise"), bg: "#EEF0F3", fg: "#6B7585" } : { text: t("ciUpcoming"), bg: "#EEF0F3", fg: "#3B4555" };

  const byHour = useMemo(() => {
    const m = new Map<number, Appt[]>();
    for (const a of dayData.data?.appointments ?? []) { const h = Number(a.time.slice(0, 2)); m.set(h, [...(m.get(h) ?? []), a]); }
    for (const l of m.values()) l.sort((a, b) => a.time.localeCompare(b.time));
    return m;
  }, [dayData.data]);
  const hours = [...new Set([...HOURS, ...byHour.keys()])].sort((a, b) => a - b);

  if (!online) return <main style={{ maxWidth: 1100 }}><h1 style={{ fontSize: 24 }}>{t("ciCalTitle")}</h1><p className="empty">{t("ciOnlineOnly")}</p></main>;
  if (data && (!data.configured || !data.linked)) return <main style={{ maxWidth: 1100 }}><h1 style={{ fontSize: 24 }}>{t("ciCalTitle")}</h1><p className="empty">{t("ciNotLinked")}</p></main>;

  return (
    <main style={{ maxWidth: 1100 }}>
      <h1 style={{ fontSize: 24 }}>{t("ciCalTitle")}</h1>
      <div className="ccal">
        <section className="panel citas" aria-label={mon ? monthTitle(mon) : t("ciCalTitle")}>
          <div className="chead">
            <h2 style={{ textTransform: "capitalize" }}>{mon ? monthTitle(mon) : "…"}</h2>
            <div className="cnav">
              <button className="btn icon" aria-label={t("ciPrevMonth")} disabled={!mon} onClick={() => { if (mon) { setMonth(addMonths(mon, -1)); setDate(undefined); } }}>‹</button>
              <button className="btn" disabled={!today} onClick={gotoToday}>{t("ciToday")}</button>
              <button className="btn icon" aria-label={t("ciNextMonth")} disabled={!mon} onClick={() => { if (mon) { setMonth(addMonths(mon, 1)); setDate(undefined); } }}>›</button>
              <button className="btn icon" aria-label={t("ciRefresh")} title={t("ciRefresh")} disabled={loading} onClick={() => void refresh()}>↻</button>
            </div>
          </div>
          {error === "down" && <p className="muted" style={{ margin: 0 }}>{t("ciUnreachable")} <button className="btn" onClick={() => void refresh()}>{t("ciRetry")}</button></p>}
          {error === "rate" && <p className="muted" style={{ margin: 0 }}>{t("ciRateLimited")} <button className="btn" onClick={() => void refresh()}>{t("ciRetry")}</button></p>}
          {!error && !data && <p className="muted" style={{ margin: 0 }}>{t("loading")}</p>}
          <div className="cgrid" role="grid" aria-busy={loading}>
            {weekdays().map((w, i) => <span key={w} className={"cwd" + (i > 4 ? " we" : "")} role="columnheader">{w}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={"p" + i} className="cday pad" aria-hidden="true" />;
              const n = data?.days[d], we = (i % 7) > 4;
              return (
                <button key={d} className={"cday" + (we ? " we" : "") + (d === today ? " today" : "") + (d === selected ? " sel" : "")} aria-pressed={d === selected}
                  aria-label={`${dayTitle(d)}${n != null ? ` · ${t("ciApptCount").replace("{n}", String(n))}` : ""}`} onClick={() => pickDay(d)}>
                  <span className="dn">{Number(d.slice(8))}</span>
                  <span className={"cn" + (n ? " has" : "")}>{n ?? ""}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel citas" ref={dayRef} aria-live="polite">
          {!selected && <p className="muted" style={{ margin: 0 }}>{t("ciPickDay")}</p>}
          {selected && (
            <>
              <div className="chead">
                <h2>{t("ciDayTitle").replace("{d}", dayTitle(selected))}</h2>
                <div className="cnav">
                  <button className="btn icon" aria-label={t("ciPrevDay")} onClick={() => pickDay(addDays(selected, -1))}>‹</button>
                  <button className="btn icon" aria-label={t("ciNextDay")} onClick={() => pickDay(addDays(selected, 1))}>›</button>
                </div>
              </div>
              {dayData.err && <p className="muted" style={{ margin: 0 }}>{t("ciUnreachable")}</p>}
              {!dayData.err && dayData.data && !dayData.data.appointments.length && <p className="muted" style={{ margin: 0 }}>{t("ciNone")}</p>}
              {!dayData.err && !!dayData.data?.appointments.length && (
                <div className="chours">
                  {hours.map((h) => {
                    const list = byHour.get(h) ?? [], label = `${String(h).padStart(2, "0")}:00`;
                    if (!list.length) return <div key={h} className="chour empty"><span>{label}</span></div>;
                    return (
                      <div key={h} className="chour">
                        <span className="hl">{label}</span>
                        <div className="rows">
                          {list.map((a) => {
                            const b = badge(a);
                            return (
                              <button key={a.id} className="crow" onClick={() => open(a)}>
                                <b className="ctime">{a.time}</b>
                                <span className="c" style={{ flex: "1 1 150px" }}>
                                  <b style={{ fontSize: 16 }}>{a.vehicle.license_plate || "—"}</b>
                                  <span className="muted" style={{ fontSize: 12 }}>{carName(a)}</span>
                                </span>
                                <span className="c" style={{ flex: "1 1 150px", fontSize: 13 }}>
                                  <span>{customerName(a)}</span>
                                  <span className="muted" style={{ fontSize: 12 }}>{[a.insurance_name, a.case_number].filter(Boolean).join(" · ")}</span>
                                </span>
                                <span className="badge" style={{ background: b.bg, color: b.fg }}>{b.text}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
