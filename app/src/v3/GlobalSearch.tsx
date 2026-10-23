import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { go, type Route } from "../field/route";
import { useField, useVehicles } from "../field/store";
import { STATUS_STYLE } from "./modes";
import { routeOfHit, searchVehicles, type SearchNames, type SearchVehicle } from "./search";
import { statusLabel } from "../field/Dialogs";

const MAX = 6;

/** names of stations and insurers for the search (and the results page) */
export function useSearchNames(): SearchNames {
  const f = useField();
  return useMemo(() => {
    const st = new Map((f.refs?.stations ?? []).map((s) => [s.id, s.name]));
    const ins = new Map((f.refs?.insurers ?? []).map((i) => [i.id, i.name]));
    return { station: (id) => (id ? st.get(id) ?? "" : ""), insurer: (id) => (id ? ins.get(id) ?? "" : "") };
  }, [f.refs]);
}

/**
 * Search field of the header: every vehicle on the device (= every vehicle the user may see, in every station, any status).
 * From 2 characters up to 6 suggestions; Enter or "Show all results" opens the results page.
 */
export function GlobalSearch({ route }: { route: Route }) {
  const f = useField();
  const vehicles = useVehicles();
  const names = useSearchNames();
  const [q, setQ] = useState(route.page === "search" ? route.q : "");
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (route.page === "search") setQ(route.q); }, [route]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const term = q.trim();
  const hits = useMemo(() => (term.length >= 2 ? searchVehicles(vehicles as unknown as SearchVehicle[], term, names) : []), [vehicles, term, names]);
  const shown = hits.slice(0, MAX);
  const rows = shown.length + (hits.length > 0 ? 1 : 0);

  const openHit = (v: SearchVehicle) => { setOpen(false); go(routeOfHit(v)); };
  const all = () => { setOpen(false); if (term) go({ page: "search", q: term }); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAct((a) => (rows ? (a + 1) % rows : -1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setAct((a) => (rows ? (a <= 0 ? rows - 1 : a - 1) : -1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (open && act >= 0 && act < shown.length) openHit(shown[act]); else all(); }
    else if (e.key === "Escape") { setOpen(false); }
  };
  if (!f.can("vehicules.voir")) return null;
  return (
    <div className="gsearch" ref={box}>
      <input type="search" autoComplete="off" value={q} placeholder={t("srPlaceholder")} aria-label={t("srPlaceholder")} role="combobox" aria-expanded={open && rows > 0} aria-controls="gs-list"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setAct(-1); }} onFocus={() => setOpen(true)} onKeyDown={onKey} />
      {open && term.length >= 2 && (
        <ul id="gs-list" role="listbox" className="gs-list">
          {shown.map((v, i) => {
            const x = v as Record<string, unknown>, st = STATUS_STYLE[v.statut] ?? STATUS_STYLE.arrive;
            return (
              <li key={v.id} role="option" aria-selected={i === act} className={i === act ? "act" : ""} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setAct(i)} onClick={() => openHit(v)}>
                <span className="c">
                  <b>{String(x.kennzeichen || "—")}</b>
                  <small>{[x.modell, names.insurer(v.insurerId), x.claimNumber].filter(Boolean).join(" · ")}</small>
                  <small>📍 {names.station(v.stationId) || "—"}</small>
                </span>
                <span className="badge" style={{ background: st.bg, color: st.fg }}>{statusLabel(v.statut)}</span>
              </li>
            );
          })}
          {!hits.length && <li className="none" role="presentation">{t("srNone").replace("{q}", term)}</li>}
          {hits.length > 0 && <li role="option" aria-selected={act === shown.length} className={"all" + (act === shown.length ? " act" : "")} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setAct(shown.length)} onClick={all}>{t("srShowAll").replace("{n}", String(hits.length))}</li>}
        </ul>
      )}
    </div>
  );
}
