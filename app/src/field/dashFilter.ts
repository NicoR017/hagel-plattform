/** "Every number is clickable": the dashboard stores the vehicle ids behind a number and opens the list filtered by them. */
const KEY = "hagel.dashFilter";
export interface DashFilter { ids: string[]; label: string }
export function setDashFilter(f: DashFilter) { try { sessionStorage.setItem(KEY, JSON.stringify(f)); } catch { /* storage unavailable */ } }
export function readDashFilter(): DashFilter | null {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as DashFilter | null; return v && Array.isArray(v.ids) ? v : null; } catch { return null; }
}
export function openFilteredList(f: DashFilter) { setDashFilter(f); location.hash = "#/?f=dash"; }
