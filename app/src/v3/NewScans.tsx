import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { api } from "../api";
import { fmtDateTime, t } from "../i18n";
import { Picker, type PickItem } from "../field/Picker";
import { go } from "../field/route";
import { useField } from "../field/store";
import { toast } from "../field/toast";
import { Dialog } from "../field/ui";
import { getPrefs, setPrefs } from "../sync/mutations";
import { useOnline } from "./citas";
import type { Scan } from "./ScanList";
import { SCAN_SORTS, loadScanSort, saveScanSort, sortScans, type ScanSort } from "./scanSort";

interface ImportResult { status: string; vehicleId?: string; message?: string }
const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** the scan's customer is not a body shop of Hagel: the car starts without a customer */
const customerUnknown = (s: Scan) => s.warnings.some((w) => w === "no_link" || w === "no_site" || w === "tenant_mismatch");

/**
 * "New scans": every Colibri scan of the organisation without an assessment yet, whatever the body shop or the station
 * (scans of an unknown customer or an unmapped location included). Tap a row → the car is created and the assessment opens on "Basics".
 */
export function NewScans() {
  const f = useField();
  const online = useOnline();
  const canScan = f.can("colibri.importer");
  const prefs = useLiveQuery(() => getPrefs(f.db), [f.db]);
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<ScanSort>(loadScanSort());
  const [chip, setChip] = useState("all"); // all | none | <station id>
  const [busy, setBusy] = useState("");
  const [ask, setAsk] = useState<Scan | null>(null); // a scan that belongs to no station: which one?

  useEffect(() => {
    if (!canScan || !online) { setScans(null); return; }
    let live = true;
    api<Scan[]>("GET", "/azure/scans?all=1").then((r) => { if (live) { setScans(r); setErr(""); } }).catch((e) => { if (live) { setScans([]); setErr((e as Error).message); } });
    return () => { live = false; };
  }, [canScan, online, f.orgId]);

  const textHits = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return (scans ?? []).filter((s) => {
      const h = fold([s.plate, s.businessCustomer, s.clientName, s.insurerName, s.colibriNumber, s.brand, s.model].filter(Boolean).join(" "));
      return words.every((w) => h.includes(w));
    });
  }, [scans, q]);
  const counts = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    let none = 0;
    for (const s of textHits) { if (!s.stationId) none++; else m.set(s.stationId, { name: s.stationName, n: (m.get(s.stationId)?.n ?? 0) + 1 }); }
    return { none, stations: [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "de")) };
  }, [textHits]);
  const shown = sortScans(textHits.filter((s) => chip === "all" || (chip === "none" ? !s.stationId : s.stationId === chip)), sortBy);

  const start = async (s: Scan, stationId: string) => {
    setBusy(s.partitionKey); setAsk(null);
    try {
      const r = await api<{ results: ImportResult[] }>("POST", "/azure/scans/import", { keys: [{ partitionKey: s.partitionKey, rowKey: s.rowKey }], station_id: stationId });
      const res = r.results[0];
      if (res?.vehicleId && (res.status === "imported" || res.status === "already")) {
        void f.engine.syncNow(f.orgId);
        void setPrefs(f.db, { lastStationId: stationId, lastMode: "kalk" });
        if (customerUnknown(s)) toast(t("nsNoCustomer"), 7000);
        go({ page: "expertise", id: res.vehicleId, step: "basis", ctx: { stationId, mode: "kalk" } });
        return;
      }
      toast(res?.message || res?.status || t("nsFailed"), 6000);
    } catch (e) { toast((e as Error).message, 6000); }
    setBusy("");
  };
  const pick = (s: Scan) => { if (busy || !s.importable) return; if (s.stationId) void start(s, s.stationId); else setAsk(s); };

  if (!canScan) return <main><p className="empty">{t("forbidden")}</p></main>;
  return (
    <main style={{ maxWidth: 980 }}>
      <div>
        <h1 style={{ fontSize: 24 }}>{t("nsTitle")}</h1>
        {scans && <p className="sub" style={{ margin: "2px 0 0" }}>{t("nsCount").replace("{n}", String(textHits.length))}</p>}
      </div>
      {!online && <p className="empty">{t("nsOnlineOnly")}</p>}
      {online && (
        <>
          <div className="toolbar">
            <input type="search" style={{ flex: "1 1 260px", minHeight: 44 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("nsSearchPh")} aria-label={t("nsSearchPh")} />
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>{t("v6ScanSort")}
              <select style={{ minHeight: 44 }} value={sortBy} onChange={(e) => { const v = e.target.value as ScanSort; setSortBy(v); saveScanSort(v); }}>
                {SCAN_SORTS.map((k) => <option key={k} value={k}>{t(("v6ScanSort_" + k) as never)}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="group" aria-label={t("nsStationCol")}>
            <button className={"chip" + (chip === "all" ? " on" : "")} onClick={() => setChip("all")}>{t("nsAllStations")} ({textHits.length})</button>
            {counts.stations.map(([id, c]) => <button key={id} className={"chip" + (chip === id ? " on" : "")} onClick={() => setChip(id)}>{c.name} ({c.n})</button>)}
            {counts.none > 0 && <button className={"chip" + (chip === "none" ? " on" : "")} onClick={() => setChip("none")}>{t("nsNoStation")} ({counts.none})</button>}
          </div>
          {scans === null && <p className="muted">{t("loading")}</p>}
          {scans && !shown.length && <p className="empty">{err || t("nsEmpty")}</p>}
          <div className="rows">
            {shown.map((s) => (
              <div key={s.partitionKey + s.rowKey} className="vrow" role="button" tabIndex={0} aria-disabled={!s.importable || !!busy}
                style={{ padding: 12, cursor: s.importable ? "pointer" : "default", opacity: s.importable ? 1 : 0.65 }}
                onClick={() => pick(s)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(s); } }}>
                <span className="c" style={{ flex: "1 1 190px" }}>
                  <b style={{ fontSize: 16 }}>{s.plate || "—"}</b>
                  <span className="muted" style={{ fontSize: 12 }}>{[s.brand.split("-")[0], s.model].filter(Boolean).join(" ")} · {s.scanDateTime ? fmtDateTime(s.scanDateTime) : ""}</span>
                </span>
                <span className="c" style={{ flex: "1 1 220px", fontSize: 13 }}>
                  <span>{s.clientName || s.businessCustomer || "—"}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{s.colibriNumber}{s.insurerName ? ` · ${s.insurerName}` : ""}{s.dentsTotal != null ? ` · ${s.dentsTotal} ${t("dentsWord")}` : ""}</span>
                </span>
                <span className="c" style={{ flex: "1 1 150px", fontSize: 13 }}>
                  <span>{s.stationId ? `📍 ${s.stationName}` : <span className="muted">{t("nsNoStation")}</span>}</span>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                    <span className="badge" style={s.warnings.length ? { background: "#FBF1D9", color: "#7A5300" } : { background: "#E4EEE5", color: "#2F5535" }}>{s.warnings.length ? t("scanCheck") : t("scanOk")}</span>
                    {s.warnings.map((w) => <span key={w} className="badge" style={{ background: "#EEF0F3", color: "#3B4555" }}>{t(("w." + w) as never)}</span>)}
                  </span>
                </span>
                <span className="btn primary" aria-hidden="true">{busy === s.partitionKey ? t("preparing") : t("nsStart")}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {ask && <StationAsk scan={ask} last={prefs?.lastStationId ?? null} onGo={(id) => void start(ask, id)} onClose={() => setAsk(null)} />}
    </main>
  );
}

/** A scan that belongs to no station: choose where the car is created (the last station used is preselected). */
function StationAsk({ scan, last, onGo, onClose }: { scan: Scan; last: string | null; onGo: (stationId: string) => void; onClose: () => void }) {
  const f = useField();
  const sites = (f.refs?.stations ?? []).filter((s) => s.active && (!s.azureTenant || !scan.tenant || s.azureTenant === scan.tenant));
  const [id, setId] = useState<string>(last && sites.some((s) => s.id === last) ? last : "");
  const typeWord = (ty: string) => (ty === "hall" ? t("v3TypeHall") : ty === "parc" ? t("v3TypeParc") : t("v3TypeCarrosserie"));
  const items: PickItem[] = sites.map((s) => ({ id: s.id, title: s.name, sub: [typeWord(s.type), s.address].filter(Boolean).join(" · "), search: [typeWord(s.type), s.address], rank: s.id === last ? 0 : 1 }));
  const cur = sites.find((s) => s.id === id);
  return (
    <Dialog title={t("nsPickStation")} onClose={onClose}>
      <p className="muted" style={{ margin: "0 0 10px" }}>{scan.plate} · {scan.businessCustomer}</p>
      <Picker items={items} multi={false} placeholder={t("nsPickPh")} hint={t("pkStationHint").replace("{n}", String(sites.length))}
        chosen={cur ? [{ id: cur.id, label: cur.name, sub: items.find((i) => i.id === cur.id)?.sub }] : []} onAdd={(it) => setId(it.id)} onRemove={() => setId("")} />
      <button className="pbtn" disabled={!cur} onClick={() => onGo(id)}>{t("nsGo")}</button>
    </Dialog>
  );
}
