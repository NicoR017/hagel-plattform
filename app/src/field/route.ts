import { useEffect, useState } from "react";

export type Tab = "basis" | "erfassung" | "bilder" | "kva";
export type Route =
  | { page: "list" }
  | { page: "vehicle"; id: string; tab: Tab }
  | { page: "admin"; tab?: string };

const TABS: Tab[] = ["basis", "erfassung", "bilder", "kva"];

export function parseRoute(hash: string): Route {
  const p = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (p[0] === "v" && p[1]) return { page: "vehicle", id: p[1], tab: (TABS as string[]).includes(p[2]) ? (p[2] as Tab) : "basis" };
  if (p[0] === "admin") return { page: "admin", tab: p[1] };
  return { page: "list" };
}
export const hrefOf = (r: Route): string =>
  r.page === "vehicle" ? `#/v/${r.id}/${r.tab}` : r.page === "admin" ? `#/admin${r.tab ? "/" + r.tab : ""}` : "#/";
export const go = (r: Route) => { location.hash = hrefOf(r); };

export function useRoute(): Route {
  const [r, setR] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const f = () => setR(parseRoute(location.hash));
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return r;
}
