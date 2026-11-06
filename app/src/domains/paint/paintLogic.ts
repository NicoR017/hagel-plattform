// Paint board (F4): pure helpers.
import { PAINT_STATUSES, type ClientPaintJob } from "@hagel/shared";
import { t, tOr, type Key } from "../../shared/i18n";
import type { LocalVehicle } from "../../shared/sync/db";
import { onBoard } from "../repair/boardLogic";

export const PAINT_COLUMNS = PAINT_STATUSES;
export interface PaintRow { v: LocalVehicle; j: ClientPaintJob }
export const paintOf = (v: LocalVehicle): ClientPaintJob[] => (Array.isArray((v as { paint?: ClientPaintJob[] }).paint) ? (v as { paint?: ClientPaintJob[] }).paint! : []);
export const hasPaintList = (v: LocalVehicle) => Array.isArray((v as { paint?: unknown }).paint);
export const rowsOfPaint = (vs: LocalVehicle[]): PaintRow[] => vs.flatMap((v) => paintOf(v).map((j) => ({ v, j })));
export const paintStatus = (s: string): string => t(`f5Col_${s}` as Key);
export const elementName = (key: string): string => tOr("pn." + key, key);
export const paintProgress = (jobs: ClientPaintJob[]) => ({ d: jobs.filter((j) => j.status === "done").length, n: jobs.length });
/** cars shown on the boards: the ones on the repair board (a job exists from the estimate on, but is of no use before the repair) */
export const inRepair = (v: LocalVehicle) => onBoard(v as never);

export const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (ymd: string, n: number) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymdOf(d); };
/** Monday of the week of a day */
export const mondayOf = (ymd: string) => { const d = new Date(ymd + "T12:00:00Z"); const k = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - k); return ymdOf(d); };
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

export function matchesPaint(r: PaintRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [elementName(r.j.elementKey), String((r.v as Record<string, unknown>).kennzeichen ?? ""), String((r.v as Record<string, unknown>).modell ?? "")].join(" ").toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w));
}
