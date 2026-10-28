import { Fragment, useEffect, useState } from "react";
import { t } from "../i18n";
import { go } from "../field/route";
import { addDays, carName, customerName, dayIn, linkedStations, useCitasDay, useOnline, type Appt } from "./citas";
import { ScrollBox } from "./ScrollBox";

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "RDV du jour": the PDR Citas appointments of the station's location. Only shown when Citas is set up and the station is linked to a location. */
export function CitasDayBlock({ stationId }: { stationId: string }) {
  const online = useOnline();
  const [date, setDate] = useState<string | undefined>(undefined);
  const { data, err, loading, refresh } = useCitasDay(stationId, date, online);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(i); }, []); // the "now" line moves with the clock
  const shown = data ? data.configured && data.linked : false;

  if (!online) return linkedStations.has(stationId) ? <section className="panel citas"><div className="chead"><h2>{t("ciBlockTitle")}</h2></div><p className="muted" style={{ margin: 0 }}>{t("ciOnlineOnly")}</p></section> : null;
  if (!shown && !(err && linkedStations.has(stationId))) return null;
  const day = data?.date ?? date;

  const open = (a: Appt) => {
    if (a.vehicleId) go({ page: "expertise", id: a.vehicleId, step: "basis", ctx: { stationId, mode: "kalk" } });
    else go({ page: "citas", stationId, date: a.date, appointmentId: a.id });
  };
  const badge = (a: Appt) => a.vehicleId ? { text: t("ciStarted"), bg: "#E4EEE5", fg: "#2F5535" }
    : a.status === "cancel_requested" ? { text: t("ciCancelReq"), bg: "#FDF0E1", fg: "#8A4A06" } : { text: t("ciUpcoming"), bg: "#EEF0F3", fg: "#3B4555" };

  return (
    <section className="panel citas">
      <div className="chead">
        <h2>{t("ciBlockTitle")}</h2>
        <div className="cnav">
          <button className="btn icon" aria-label={t("ciPrevDay")} disabled={!day} onClick={() => day && setDate(addDays(day, -1))}>‹</button>
          <button className="btn" disabled={!date} onClick={() => setDate(undefined)}>{day ? fmtDay(day) : t("ciToday")}{!date ? ` · ${t("ciToday")}` : ""}</button>
          <button className="btn icon" aria-label={t("ciNextDay")} disabled={!day} onClick={() => day && setDate(addDays(day, 1))}>›</button>
          <button className="btn" onClick={() => go({ page: "calendar", stationId })}>📅 {t("ciMonthBtn")}</button>
          <button className="btn icon" aria-label={t("ciRefresh")} title={t("ciRefresh")} disabled={loading} onClick={() => void refresh()}>↻</button>
        </div>
      </div>
      {err && <p className="muted" style={{ margin: 0 }}>{t("ciUnreachable")}</p>}
      {!err && data && !data.appointments.length && <p className="muted" style={{ margin: 0 }}>{t("ciNone")}</p>}
      {!err && !!data?.appointments.length && (() => {
        const list = data.appointments;
        const zone = data.timezone ?? "Europe/Madrid";
        const isToday = data.date === dayIn(new Date().toISOString(), zone);
        const nowT = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
        // appointments that have started: the last of them opens at the top of the box, an orange line "now" separates past and coming ones
        const past = isToday ? list.filter((a) => a.time <= nowT).length : 0;
        return (
          <>
            <div className="sbx-hint">
              <span>{list.length > 3 ? t("ciHintMany").replace("{n}", String(list.length)) : t(list.length === 1 ? "ciHintOne" : "ciHintFew").replace("{n}", String(list.length))}</span>
              {isToday && <span>{t("ciEarlierLater").replace("{a}", String(past)).replace("{b}", String(list.length - past))}</span>}
            </div>
            <ScrollBox k={`ci_${stationId}_${data.date}`} max={3} target={isToday ? Math.max(0, past - 1) : 0}>
              {list.map((a, i) => {
                const b = badge(a);
                return (
                  <Fragment key={a.id}>
                    {isToday && i === past && <div className="nowline" aria-label={t("ciNowWord")}><span>{t("ciNowAt").replace("{t}", nowT)}</span></div>}
                    <button className={"crow" + (isToday && a.time <= nowT ? " pastrow" : "")} onClick={() => open(a)}>
                      <b className="ctime">{a.time}</b>
                      <span className="c" style={{ flex: "1 1 160px" }}>
                        <b style={{ fontSize: 16 }}>{a.vehicle.license_plate || "—"}</b>
                        <span className="muted" style={{ fontSize: 12 }}>{carName(a)}</span>
                      </span>
                      <span className="c" style={{ flex: "1 1 160px", fontSize: 13 }}>
                        <span>{customerName(a)}</span>
                        <span className="muted" style={{ fontSize: 12 }}>{a.insurance_name}</span>
                      </span>
                      {!a.vehicleId && a.matchingScans > 0 && <span className="badge" style={{ background: "#E3ECFD", color: "#1D4FB8" }}>{t("ciScanFound")}</span>}
                      <span className="badge" style={{ background: b.bg, color: b.fg }}>{b.text}</span>
                    </button>
                  </Fragment>
                );
              })}
              {isToday && past === list.length && <div className="nowline"><span>{t("ciNowAt").replace("{t}", nowT)}</span></div>}
            </ScrollBox>
          </>
        );
      })()}
    </section>
  );
}
