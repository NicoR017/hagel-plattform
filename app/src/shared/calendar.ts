// Pure helpers of the repair-calendar picker (month grid, free places, form validation). No React, easy to test.

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const ymd = (y: number, m0: number, d: number) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
export const tzOfCountry = (country: string) => (country === "ES" ? "Europe/Madrid" : "Europe/Berlin");
/** YYYY-MM-DD of `now` in a time zone (the station's) */
export const todayIn = (tz: string, now = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
/** 0 = Sunday … 6 = Saturday */
export const weekdayOf = (day: string) => new Date(day + "T12:00:00Z").getUTCDay();
export const isWeekend = (day: string) => { const d = weekdayOf(day); return d === 0 || d === 6; };
export const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Cells of a month grid, Monday first: `null` = blank cell before the 1st, otherwise the day. */
export function monthCells(y: number, m0: number): (string | null)[] {
  const lead = (weekdayOf(ymd(y, m0, 1)) + 6) % 7;
  return [...Array<null>(lead).fill(null), ...Array.from({ length: daysInMonth(y, m0) }, (_, i) => ymd(y, m0, i + 1))];
}

/** first and last day to ask the server for (the visible month) */
export const monthRange = (y: number, m0: number) => ({ from: ymd(y, m0, 1), to: ymd(y, m0, daysInMonth(y, m0)) });

/** The picker covers the current year and the next one. */
export const monthBounds = (today: string) => ({ min: `${today.slice(0, 4)}-01`, max: `${Number(today.slice(0, 4)) + 1}-12` });
export const monthKey = (y: number, m0: number) => `${y}-${pad2(m0 + 1)}`;
/** move by `delta` months and clamp to the bounds (returns the same month when out of range) */
export function shiftMonth(key: string, delta: number, today: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const next = monthKey(d.getUTCFullYear(), d.getUTCMonth()), { min, max } = monthBounds(today);
  return next < min || next > max ? key : next;
}

export interface DayState { closed: boolean; past: boolean; full: boolean; few: boolean; free: number; selectable: boolean }
/** closed = weekend; past = before today; free = places left; "few" = exactly one left; only an open future day with a free place can be picked */
export function dayState(day: string, today: string, capacity: number, booked: number): DayState {
  const closed = isWeekend(day), past = day < today;
  const free = Math.max(0, capacity - booked);
  const shut = closed || past;
  return { closed, past, free, full: !shut && free === 0, few: !shut && free === 1, selectable: !shut && free > 0 };
}

/** 07:30 … 17:00 every 30 minutes */
export const TIME_SLOTS: string[] = (() => { const o: string[] = []; for (let m = 7 * 60 + 30; m <= 17 * 60; m += 30) o.push(`${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`); return o; })();

export const validEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
export const validPhone = (s: string) => s.replace(/[^0-9]/g, "").length >= 6;

/** what is still missing before the booking button works (field keys, in form order) */
export function missingBooking(f: { day?: string | null; time?: string; phone?: string; email?: string }): ("day" | "time" | "phone" | "email")[] {
  const out: ("day" | "time" | "phone" | "email")[] = [];
  if (!f.day) out.push("day");
  if (!f.time) out.push("time");
  if (!validPhone(f.phone ?? "")) out.push("phone");
  if (!validEmail(f.email ?? "")) out.push("email");
  return out;
}

/** "Mi 10.03.2027": the year is only shown for days outside the current year */
export function dayLabel(day: string, today: string, locale: string): string {
  const d = new Date(day + "T12:00:00Z");
  const wd = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(d).replace(/\.$/, "");
  const dm = `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.`;
  return `${wd} ${dm}${day.slice(0, 4) !== today.slice(0, 4) ? d.getUTCFullYear() : ""}`;
}

/** Vehicles in these statuses can be booked (not once in repair, finished or returned): same rule as the server */
export const bookableStatus = (v: { statut: string; repairStage?: unknown }) =>
  (v.statut === "arrive" || v.statut === "besichtigung" || v.statut === "attente") && v.repairStage == null;
