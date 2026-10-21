import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { getLang, t } from "../i18n";
import type { LocalVehicle } from "../sync/db";
import { cancelBooking, createBooking, moveBooking } from "../sync/mutations";
import {
  TIME_SLOTS, bookableStatus, dayLabel, dayState, missingBooking, monthBounds, monthCells, monthKey, monthRange, shiftMonth, todayIn, tzOfCountry, validEmail, validPhone,
} from "./calendar";
import { useField } from "./store";
import { toast } from "./toast";
import { confirmDialog } from "./ui";

interface CalDay { booked: number; bookings?: { id: string; vehicleId: string; plate: string; time: string; status: string }[] }
interface Cal { repairsPerDay: number; days: Record<string, CalDay> }

const loc = () => (getLang() === "de" ? "de-DE" : "en-GB");

/**
 * "Reparaturtermin buchen": classic month calendar over the current and the next year (free places per day from the station's capacity),
 * time, customer phone and e-mail (all required). Used at the end of the expertise and in the vehicle detail.
 * The booking itself is a normal operation; the server decides (full day, status) and the screen shows the answer after the sync.
 */
export function BookingForm({ v, onDone }: { v: LocalVehicle; onDone?: () => void }) {
  const f = useField();
  const station = f.refs?.stations.find((s) => s.id === v.stationId);
  const tz = tzOfCountry(station?.country ?? "DE");
  const today = todayIn(tz);
  const booking = (v.repair as { booking?: { id: string; date: string; time: string; phone: string; email: string; createdBy: string | null } | null } | undefined)?.booking ?? null;
  const [moving, setMoving] = useState(false);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(String((v as Record<string, unknown>).kundeEmail ?? ""));
  const [cal, setCal] = useState<Cal | null>(null);
  const [calErr, setCalErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [y, m0] = month.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n));
  const capacity = cal?.repairsPerDay ?? station?.repairsPerDay ?? 3;

  const load = useCallback(async () => {
    if (!station) return;
    const r = monthRange(y, m0);
    try { setCal(await api<Cal>("GET", `/stations/${station.id}/booking-calendar?from=${r.from}&to=${r.to}`)); setCalErr(""); }
    catch (e) { setCal(null); setCalErr((e as Error).message); }
  }, [station?.id, y, m0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load, booking?.id, booking?.date]);

  const info = (d: string) => dayState(d, today, capacity, cal?.days[d]?.booked ?? 0);
  const sel = day && info(day).selectable ? day : null;
  const missing = missingBooking({ day: sel, time, phone, email });
  const names: Record<string, string> = { day: t("v4Day"), time: t("v4Time"), phone: t("v4Phone"), email: t("email") };
  const cells = useMemo(() => monthCells(y, m0), [y, m0]);
  const bounds = monthBounds(today);
  const monthName = (i: number, style: "long" | "short") => new Intl.DateTimeFormat(loc(), { month: style, timeZone: "UTC" }).format(new Date(Date.UTC(2026, i, 1)));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(loc(), { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 19 + i))).replace(/\.$/, ""));

  if (!f.can("termine.buchen")) return null;
  if (!bookableStatus(v as { statut: string; repairStage?: unknown })) return <div className="notice warn">{t("v4BookStatus")}</div>;
  if (!f.status.online) return <div className="notice warn">{t("v4BookOnline")}</div>;

  /** run an operation, wait for the server's answer (sync), and tell the user what happened */
  const run = async (op: () => Promise<void>, okMsg: string) => {
    setBusy(true);
    const since = Date.now();
    await op();
    await f.engine.syncNow(f.orgId);
    const bad = (await f.db.issues.where("orgId").equals(f.orgId).toArray()).filter((i) => i.at >= since - 1000 && i.opType.startsWith("booking."));
    setBusy(false);
    await load();
    if (bad.length) { toast(bad[0].code === "booking_full" ? t("v4BookFull") : bad[0].message || t("noticeRejected"), 6000); return false; }
    toast(okMsg, 5000);
    return true;
  };

  const submit = async () => {
    if (!sel || missing.length) return;
    const ok = await (moving && booking
      ? run(() => moveBooking(f.mut, v.id, booking.id, sel, time), t("v4BookMoved"))
      : run(() => createBooking(f.mut, v.id, { date: sel, time, phone: phone.trim(), email: email.trim() }), t("v4BookDone")));
    if (ok) { setMoving(false); setDay(null); onDone?.(); }
  };

  if (booking && !moving) {
    return (
      <div className="bk">
        <div className="bk-card">
          <div className="muted" style={{ fontSize: 12 }}>{t("v4BookedFor")}</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{dayLabel(booking.date, today, loc())} · {booking.time} {t("v4Clock")}</div>
          <div style={{ marginTop: 6, fontSize: 14 }}>
            <a href={`tel:${booking.phone.replace(/[^+\d]/g, "")}`} style={{ fontWeight: 700 }}>📞 {t("v4CallCustomer")}: {booking.phone}</a><br />
            ✉ {booking.email}{booking.createdBy ? <span className="muted"> · {t("v4BookedBy")} {booking.createdBy}</span> : null}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t("v4BookHint")}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="chip" onClick={() => { setMoving(true); setMonth(booking.date.slice(0, 7)); setDay(null); setTime(booking.time); setPhone(booking.phone); setEmail(booking.email); }}>{t("v4Move")}</button>
            <button className="chip" style={{ color: "var(--brick)" }} disabled={busy} onClick={() => { if (confirmDialog(t("v4CancelQ"))) void run(() => cancelBooking(f.mut, v.id, booking.id), t("v4BookCancelled")); }}>{t("v4Cancel")}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bk">
      <div className="bk-nav">
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="chip" aria-label={t("v4PrevYear")} onClick={() => setMonth(shiftMonth(month, -12, today))}>«</button>
          <button className="chip" aria-label={t("v4PrevMonth")} onClick={() => setMonth(shiftMonth(month, -1, today))}>‹</button>
        </div>
        <b style={{ flex: 1, textAlign: "center", textTransform: "capitalize" }}>{monthName(m0, "long")} {y}</b>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="chip" onClick={() => setMonth(today.slice(0, 7))}>{t("today")}</button>
          <button className="chip" aria-label={t("v4NextMonth")} onClick={() => setMonth(shiftMonth(month, 1, today))}>›</button>
          <button className="chip" aria-label={t("v4NextYear")} onClick={() => setMonth(shiftMonth(month, 12, today))}>»</button>
        </div>
      </div>
      <div className="bk-months" role="group" aria-label={t("v4Months")}>
        {Array.from({ length: 12 }, (_, i) => {
          const k = monthKey(y, i);
          return <button key={k} className={"chip" + (k === month ? " on" : "")} disabled={k < bounds.min || k > bounds.max} onClick={() => setMonth(k)}>{monthName(i, "short")}</button>;
        })}
      </div>
      <div className="bk-grid" role="grid" aria-label={`${monthName(m0, "long")} ${y}`}>
        {weekdays.map((w) => <div key={w} className="bk-wd">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const s = info(d), on = d === day, shut = s.closed || s.past;
          const cls = "bk-day" + (on ? " on" : shut ? " shut" : s.full ? " full" : s.few ? " few" : " ok") + (d === today ? " today" : "");
          return (
            <button key={d} className={cls} disabled={!s.selectable} aria-pressed={on}
              aria-label={`${dayLabel(d, today, loc())}${shut ? ` ${t("v4Closed")}` : s.full ? ` ${t("v4Full")}` : `, ${s.free} / ${capacity} ${t("v4Free")}`}`}
              onClick={() => setDay(d)}>
              <span>{Number(d.slice(8))}</span>
              <small>{shut ? "" : s.full ? t("v4Full") : `${s.free} ${t("v4Free")}`}</small>
            </button>
          );
        })}
      </div>
      {calErr && <div className="notice warn">{calErr}</div>}
      <div className="bk-sub">
        <b>{day ? `${dayLabel(day, today, loc())}${info(day).closed ? ` · ${t("v4Closed")}` : info(day).past ? ` · ${t("v4Past")}` : ` · ${cal?.days[day]?.booked ?? 0} / ${capacity}`}` : t("v4PickDay")}</b>
        {day && (cal?.days[day]?.bookings ?? []).map((b) => <div key={b.id} className="muted" style={{ fontSize: 13 }}>{b.plate} · {b.time} {t("v4Clock")}</div>)}
        {day && cal && (cal.days[day]?.booked ?? 0) > (cal.days[day]?.bookings?.length ?? 0) && <div className="muted" style={{ fontSize: 13 }}>{(cal.days[day]?.booked ?? 0) - (cal.days[day]?.bookings?.length ?? 0)} {t("v4Others")}</div>}
      </div>
      <div className="bk-form">
        <label>{t("v4Time")}
          <select className="sel" value={time} onChange={(e) => setTime(e.target.value)}>
            <option value="">{t("v4PickTime")}</option>
            {TIME_SLOTS.map((s) => <option key={s} value={s}>{s} {t("v4Clock")}</option>)}
          </select>
        </label>
        {!moving && (
          <>
            <label>{t("v4Phone")}<input className="inp" type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+34 612 345 678" aria-invalid={!!phone && !validPhone(phone)} /></label>
            <label>{t("email")}<input className="inp" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kunde@example.com" aria-invalid={!!email && !validEmail(email)} /></label>
          </>
        )}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>{t("v4BookHint")}</div>
      <button className="pbtn green" disabled={busy || missing.length > 0} onClick={() => void submit()}>{busy ? t("preparing") : moving ? t("v4MoveBooking") : t("v4BookNow")}</button>
      {missing.length > 0 && <div className="muted" style={{ fontSize: 13, textAlign: "center", marginTop: 6 }}>{t("v4Missing")}: {missing.map((k) => names[k]).join(", ")}</div>}
      {moving && <button className="pbtn sec" onClick={() => setMoving(false)}>{t("cancel")}</button>}
    </div>
  );
}
