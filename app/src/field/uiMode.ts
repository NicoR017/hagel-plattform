import { useEffect, useState } from "react";

/**
 * Which interface is shown: the new one ("v3", default) or the previous one ("legacy"), on the same data.
 * `?ui=legacy` / `?ui=v3` in the address is remembered on this device (a field user can fall back at once, no redeploy);
 * otherwise the server default (UI_V3_DEFAULT) applies.
 */
export type UiMode = "v3" | "legacy";
const KEY = "hagel.ui";
const subs = new Set<() => void>();

const stored = (): UiMode | null => { try { const s = localStorage.getItem(KEY); return s === "legacy" || s === "v3" ? s : null; } catch { return null; } };

/** Reads (and removes) `?ui=` from the address; the choice is saved. Call once at start. */
export function captureUiParam(): void {
  const params = new URLSearchParams(location.search), q = params.get("ui");
  if (q !== "legacy" && q !== "v3") return;
  try { localStorage.setItem(KEY, q); } catch { /* storage unavailable: applies to this page load only */ }
  params.delete("ui");
  const rest = params.toString();
  history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
}

export function setUiMode(m: UiMode | null): void {
  try { m ? localStorage.setItem(KEY, m) : localStorage.removeItem(KEY); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export const resolveUi = (serverDefaultV3: boolean | undefined): UiMode => stored() ?? (serverDefaultV3 === false ? "legacy" : "v3");

export function useUiMode(serverDefaultV3: boolean | undefined): UiMode {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return resolveUi(serverDefaultV3);
}
