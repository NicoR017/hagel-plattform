import type { Land } from "@hagel/calc";

export const eur = (n: number | null | undefined): string =>
  "€ " + (n || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n: number | null | undefined, d = 2): string =>
  (n || 0).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
export const h1 = (n: number | null | undefined): string =>
  (n || 0).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " h";
export const hA = (n: number | null | undefined): string =>
  (n || 0).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + " h";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** v20 fmtDateL: DD.MM.YYYY (DE) / DD/MM/YYYY (ES); date-only strings are rendered in UTC so no TZ shift. */
export function fmtDateL(land: Land | undefined, s: string | null | undefined): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString(land === "ES" ? "es-ES" : "de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric", ...(DATE_ONLY.test(s) ? { timeZone: "UTC" } : {}),
    });
  } catch { return s; }
}

/** v20 fmtDate (Excel): de-DE, unpadded. */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString("de-DE", DATE_ONLY.test(s) ? { timeZone: "UTC" } : undefined);
  } catch { return s; }
}

export function fmtDateTime(land: Land | undefined, iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const tz = timeZone || (land === "ES" ? "Europe/Madrid" : "Europe/Berlin");
  return d.toLocaleString(land === "ES" ? "es-ES" : "de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
  });
}
