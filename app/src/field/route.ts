import { useEffect, useState } from "react";

/** the four tabs of the old vehicle screen … */
export type Tab4 = "basis" | "erfassung" | "bilder" | "kva";
/** … and the sections of the new vehicle detail (basis = "Allgemeine Daten"; the old screen shows any extra one as basis) */
export type Tab = Tab4 | "termin" | "techniker" | "planung" | "kommunikation" | "gtmotive" | "verlauf";
export type Step = Tab4;
/** tabs of the repair detail (the card of the Kanban board) */
export type RTab = "uebersicht" | "fotos" | "abschluss" | "verlauf";
export const RTABS: RTab[] = ["uebersicht", "fotos", "abschluss", "verlauf"];
/** Kalkulation / Reparatur / Alle Fahrzeuge */
export type Mode = "kalk" | "rep" | "all";
export const MODES: Mode[] = ["kalk", "rep", "all"];
/** where a vehicle was opened from: its station and mode (so "‹ Zurück" returns to the same list) */
export interface Ctx { stationId: string; mode: Mode }

export type Route =
  /** home: the stations (new UI) or the old flat list (legacy UI, or when a dashboard filter is active) */
  | { page: "list"; dash?: boolean; stationId?: undefined; mode?: undefined }
  /** list of one station in one mode (new UI) */
  | { page: "list"; stationId: string; mode: Mode; dash?: undefined }
  /** station: choose Kalkulation / Reparatur / Alle Fahrzeuge */
  | { page: "mode"; stationId: string }
  | { page: "dashboard" }
  /** step 0 of the assessment assistant: pick a scan (or start without one) */
  | { page: "newexp"; stationId: string; mode: Mode }
  /** start an expertise from a PDR Citas appointment (the day is the appointment's, in the station's time zone) */
  | { page: "citas"; stationId: string; date: string; appointmentId: string }
  /** the assessment assistant: Basis · Erfassung · Bilder · KVA */
  | { page: "expertise"; id: string; step: Step; ctx?: Ctx }
  | { page: "vehicle"; id: string; tab: Tab; ctx?: Ctx }
  /** repair detail: #/s/:station/rep/r/:id/:tab */
  | { page: "repair"; id: string; tab: RTab; stationId: string }
  | { page: "admin"; tab?: string };

export const TABS: Tab[] = ["basis", "erfassung", "bilder", "kva", "termin", "techniker", "planung", "kommunikation", "gtmotive", "verlauf"];
const STEPS: Step[] = ["basis", "erfassung", "bilder", "kva"];
const isMode = (x: string | undefined): x is Mode => x === "kalk" || x === "rep" || x === "all";

/**
 * Routes. The OLD ones keep working (bookmarks): #/ · #/?f=dash · #/dashboard · #/v/:id/:tab · #/admin/:tab
 * New: #/s/:station · #/s/:station/:mode · #/s/:station/:mode/v/:id/:tab
 */
export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const p = path.split("/").filter(Boolean);
  const tabOf = (x: string | undefined): Tab => ((TABS as string[]).includes(x ?? "") ? (x as Tab) : "basis");
  const stepOf = (x: string | undefined): Step => ((STEPS as string[]).includes(x ?? "") ? (x as Step) : "basis");
  if (p[0] === "dashboard") return { page: "dashboard" };
  if (p[0] === "expertise" && p[1]) return { page: "expertise", id: p[1], step: stepOf(p[2]) };
  if (p[0] === "v" && p[1]) return { page: "vehicle", id: p[1], tab: tabOf(p[2]) };
  if (p[0] === "admin") return { page: "admin", tab: p[1] };
  if (p[0] === "s" && p[1]) {
    const stationId = p[1];
    if (p[2] === "rep" && p[3] === "r" && p[4]) return { page: "repair", id: p[4], tab: (RTABS as string[]).includes(p[5] ?? "") ? (p[5] as RTab) : "uebersicht", stationId };
    if (p[2] === "citas" && /^\d{4}-\d{2}-\d{2}$/.test(p[3] ?? "") && p[4]) return { page: "citas", stationId, date: p[3], appointmentId: decodeURIComponent(p[4]) };
    if (isMode(p[2]) && p[3] === "neu") return { page: "newexp", stationId, mode: p[2] };
    if (isMode(p[2]) && p[3] === "exp" && p[4]) return { page: "expertise", id: p[4], step: stepOf(p[5]), ctx: { stationId, mode: p[2] } };
    if (isMode(p[2]) && p[3] === "v" && p[4]) return { page: "vehicle", id: p[4], tab: tabOf(p[5]), ctx: { stationId, mode: p[2] } };
    if (isMode(p[2])) return { page: "list", stationId, mode: p[2] };
    return { page: "mode", stationId };
  }
  return { page: "list", dash: new URLSearchParams(query).get("f") === "dash" };
}

export const hrefOf = (r: Route): string => {
  switch (r.page) {
    case "vehicle": return r.ctx ? `#/s/${r.ctx.stationId}/${r.ctx.mode}/v/${r.id}/${r.tab}` : `#/v/${r.id}/${r.tab}`;
    case "admin": return `#/admin${r.tab ? "/" + r.tab : ""}`;
    case "dashboard": return "#/dashboard";
    case "newexp": return `#/s/${r.stationId}/${r.mode}/neu`;
    case "citas": return `#/s/${r.stationId}/citas/${r.date}/${encodeURIComponent(r.appointmentId)}`;
    case "repair": return `#/s/${r.stationId}/rep/r/${r.id}/${r.tab}`;
    case "expertise": return r.ctx ? `#/s/${r.ctx.stationId}/${r.ctx.mode}/exp/${r.id}/${r.step}` : `#/expertise/${r.id}/${r.step}`;
    case "mode": return `#/s/${r.stationId}`;
    case "list": return r.stationId ? `#/s/${r.stationId}/${r.mode}` : r.dash ? "#/?f=dash" : "#/";
  }
};
export const go = (r: Route) => {
  // switching tab inside a vehicle opened from a list keeps the list it came from
  if ((r.page === "vehicle" || r.page === "expertise") && !r.ctx) { const cur = parseRoute(location.hash); if ((cur.page === "vehicle" || cur.page === "expertise") && cur.id === r.id && cur.ctx) r = { ...r, ctx: cur.ctx }; }
  location.hash = hrefOf(r);
};

/**
 * One level up (the "‹ Zurück" button): vehicle → its list → station modes → stations. The dashboard and the administration go back
 * to the stations. `null` on the stations page itself. A vehicle opened by an old link (no context) goes to the "all vehicles" list of
 * its station when `vehicleStationId` is known.
 */
export function parentRoute(r: Route, vehicleStationId?: string | null): Route | null {
  switch (r.page) {
    case "vehicle":
      if (r.ctx) return { page: "list", stationId: r.ctx.stationId, mode: r.ctx.mode };
      return vehicleStationId ? { page: "list", stationId: vehicleStationId, mode: "all" } : { page: "list" };
    case "expertise":
      if (r.ctx) return { page: "list", stationId: r.ctx.stationId, mode: r.ctx.mode };
      return vehicleStationId ? { page: "list", stationId: vehicleStationId, mode: "kalk" } : { page: "list" };
    case "newexp": return { page: "list", stationId: r.stationId, mode: r.mode };
    case "citas": return { page: "mode", stationId: r.stationId };
    case "repair": return { page: "list", stationId: r.stationId, mode: "rep" };
    case "list": return r.stationId ? { page: "mode", stationId: r.stationId } : r.dash ? { page: "list" } : null;
    case "mode": return { page: "list" };
    case "dashboard":
    case "admin": return { page: "list" };
  }
}

export function useRoute(): Route {
  const [r, setR] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const f = () => setR(parseRoute(location.hash));
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return r;
}
