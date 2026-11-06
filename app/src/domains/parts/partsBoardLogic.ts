// Parts board (F3a): pure helpers — rows from the cars, the state of a car's parts, the CSV for Excel.
import { PART_BOARD_COLUMNS, type ClientPart, type ClientCustomZone } from "@hagel/shared";
import { t, type Key } from "../../shared/i18n";
import type { LocalVehicle } from "../../shared/sync/db";
import { partsOfVehicle, zoneLabel } from "../vehicles/partsLogic";

export interface PartRow { v: LocalVehicle; p: ClientPart }
export const plateOf = (v: LocalVehicle) => String((v as Record<string, unknown>).kennzeichen ?? "") || "—";
export const rowsOf = (vs: LocalVehicle[]): PartRow[] => vs.flatMap((v) => partsOfVehicle(v as { parts?: never }).map((p) => ({ v, p })));
export const statusLabel = (s: string): string => t(`f3Col_${s}` as Key);
export const COLUMNS = PART_BOARD_COLUMNS;
/** late: the announced (else expected) delivery day passed and the part has not arrived (Madrid day) */
export const isLate = (p: ClientPart, today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" })): boolean =>
  !!p.expectedAt && p.expectedAt < today && !["delivered", "installed", "cancelled", "to_order"].includes(p.status);

/** where a car stands with its parts: nothing / order to send / waiting for parts / all delivered (ready for reassembly) / all installed */
export type CarPartsState = "none" | "to_order" | "waiting" | "ready" | "installed";
export function carPartsState(parts: ClientPart[]): CarPartsState {
  if (!parts.length) return "none";
  if (parts.every((p) => p.status === "installed")) return "installed";
  if (parts.every((p) => p.status === "delivered" || p.status === "installed")) return "ready";
  if (parts.every((p) => p.status === "to_order")) return "to_order";
  return "waiting";
}
/** parts that arrived (delivered or installed) out of all the parts: the badge "🔩 2/5" */
export const deliveredOf = (parts: ClientPart[]) => ({ d: parts.filter((p) => p.status === "delivered" || p.status === "installed").length, n: parts.length });
export const missingCount = (parts: ClientPart[]) => parts.filter((p) => p.status !== "delivered" && p.status !== "installed").length;

/** search over part, zone, plate, model */
export function matchesRow(r: PartRow, q: string, custom: ClientCustomZone[]): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [r.p.name, r.p.oemRef, r.p.zoneKey ? zoneLabel(r.p.zoneKey, custom) : "", plateOf(r.v), String((r.v as Record<string, unknown>).modell ?? "")].join(" ").toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w));
}

const csvCell = (x: unknown) => { const s = String(x ?? ""); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** the parts as a CSV that Excel opens (semicolon, UTF-8 with BOM); no price: parts are ordered and billed by the body shop */
export function partsCsv(rows: PartRow[], stationName: (id: string | null) => string, custom: ClientCustomZone[]): string {
  const head = [t("f3Plate"), t("f3Zone"), "Part", t("f3Qty"), "OEM", t("f3Status"), t("f3Col_delivered"), t("f3Col_installed"), "Station"];
  const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : "");
  const lines = rows.map((r) => [plateOf(r.v), r.p.zoneKey ? zoneLabel(r.p.zoneKey, custom) : "", r.p.name, r.p.qty, r.p.oemRef ?? "", statusLabel(r.p.status), day(r.p.deliveredAt), day(r.p.installedAt), stationName(r.v.stationId as string | null)].map(csvCell).join(";"));
  return "﻿" + [head.map(csvCell).join(";"), ...lines].join("\r\n");
}
