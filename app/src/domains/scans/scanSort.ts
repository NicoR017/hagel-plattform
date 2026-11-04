// Order of the available Colibri scans: the newest first by default, and the user can choose another order (remembered on the device).
export type ScanSort = "new" | "old" | "plate" | "customer";
export const SCAN_SORTS: readonly ScanSort[] = ["new", "old", "plate", "customer"];
const STORE = "hagel.scanSort";

export const loadScanSort = (): ScanSort => { try { const s = localStorage.getItem(STORE); return (SCAN_SORTS as readonly string[]).includes(s ?? "") ? (s as ScanSort) : "new"; } catch { return "new"; } };
export const saveScanSort = (s: ScanSort) => { try { localStorage.setItem(STORE, s); } catch { /* ignore */ } };

interface S { partitionKey: string; scanDateTime: string | null; plate: string; businessCustomer: string }
/** time of a scan: its date, else the one in the key (yyyyMMddHHmm + plate); 0 when neither is usable */
const timeOf = (s: S): number => {
  const d = s.scanDateTime ? Date.parse(s.scanDateTime) : NaN;
  if (!Number.isNaN(d)) return d;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s.partitionKey);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : 0;
};

export function sortScans<T extends S>(list: readonly T[], by: ScanSort): T[] {
  const byTime = (a: T, b: T) => timeOf(b) - timeOf(a) || b.partitionKey.localeCompare(a.partitionKey);
  const out = [...list];
  switch (by) {
    case "old": return out.sort((a, b) => byTime(b, a));
    case "plate": return out.sort((a, b) => a.plate.localeCompare(b.plate, "de", { numeric: true }) || byTime(a, b));
    case "customer": return out.sort((a, b) => a.businessCustomer.localeCompare(b.businessCustomer, "de") || byTime(a, b));
    default: return out.sort(byTime);
  }
}
