import { SCAN_SORTS, loadScanSort, saveScanSort, sortScans, type ScanSort } from "../scans/scanSort";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { t } from "../../shared/i18n";
import { applyColibriToVehicle, readColibriFile } from "../../shared/sync/colibriImport";
import { createVehicle, setPrefs } from "../../shared/sync/mutations";
import { go, type Mode } from "../../shared/route";
import { useField } from "../../shared/store";
import { toast } from "../../shared/toast";
import { ScanInfo, useStationScans, type Scan } from "../scans/ScanList";

interface ImportResult { status: string; vehicleId?: string; message?: string; check?: { ok: boolean } }

/** Scrollable scan list: rows drift slightly against the scroll (parallax) so the stack feels deep. */
function ParallaxScanList({ scans, stationId, sortBy, busy, onTake }: {
  scans: Scan[]; stationId: string; sortBy: ScanSort; busy: string; onTake: (s: Scan) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const paint = () => {
    const el = box.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    el.querySelectorAll<HTMLElement>("[data-parallax]").forEach((row) => {
      const c = row.offsetTop + row.offsetHeight / 2;
      const d = (c - mid) / Math.max(el.clientHeight, 1);
      const y = Math.max(-22, Math.min(22, -d * 18));
      const s = 1 - Math.min(0.05, Math.abs(d) * 0.05);
      row.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
    });
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let raf = 0;
    const bump = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); };
    el.addEventListener("scroll", bump, { passive: true });
    const ro = new ResizeObserver(bump);
    ro.observe(el);
    bump();
    return () => { el.removeEventListener("scroll", bump); ro.disconnect(); cancelAnimationFrame(raf); };
  }, [scans, sortBy]);

  return (
    <div ref={box} className="newxp-scans" role="list">
      <div className="rows newxp-stack">
        {sortScans(scans, sortBy).map((s) => (
          <div key={s.partitionKey + s.rowKey} className="vrow" data-parallax role="listitem" style={{ padding: 12 }}>
            <ScanInfo s={s} stationId={stationId} />
            <button className="btn primary" disabled={!!busy || !s.importable} onClick={() => onTake(s)}>{busy === s.partitionKey ? t("preparing") : t("accept")}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Step 0 of the assessment: take over a new scan of this station, import a Colibri PDF by hand, or start without a scan. */
export function NewExpertise({ stationId, mode }: { stationId: string; mode: Mode }) {
  const f = useField();
  const [sortBy, setSortBy] = useState<ScanSort>(loadScanSort());
  const [allStations, setAllStations] = useState(false); // also the scans mapped to another station: they are loaded into THIS one
  const [busy, setBusy] = useState("");
  const pdf = useRef<HTMLInputElement>(null);
  const canScan = f.can("colibri.importer");

  const { scans, err } = useStationScans(stationId, canScan, allStations);

  const open = (id: string) => { void setPrefs(f.db, { lastStationId: stationId, lastMode: mode }); go({ page: "expertise", id, step: "basis", ctx: { stationId, mode } }); };

  const take = async (s: Scan) => {
    setBusy(s.partitionKey);
    try {
      const r = await api<{ results: ImportResult[] }>("POST", "/azure/scans/import", { keys: [{ partitionKey: s.partitionKey, rowKey: s.rowKey }], station_id: stationId });
      const res = r.results[0];
      if (res?.vehicleId && (res.status === "imported" || res.status === "already")) { void f.engine.syncNow(f.orgId); open(res.vehicleId); return; }
      toast(res?.message || res?.status || t("pdfFailed"), 6000);
    } catch (e) { toast((e as Error).message, 6000); }
    setBusy("");
  };

  const fromPdf = async (file: File) => {
    setBusy("pdf");
    try {
      const bytes = await file.arrayBuffer();
      const res = await readColibriFile(bytes);
      if (!res) { toast(t("colibriUnknownLong"), 7000); setBusy(""); return; }
      const id = await createVehicle(f.mut, { stationId, statut: "besichtigung" });
      const v = (await f.db.vehicles.get(id))!;
      await applyColibriToVehicle(f.mut, v, res, { name: file.name, bytes });
      open(id);
    } catch (e) { toast(`${t("readError")}: ${(e as Error).message}`, 6000); setBusy(""); }
  };

  const without = async () => { setBusy("none"); open(await createVehicle(f.mut, { stationId })); };

  return (
    <main style={{ maxWidth: 820 }}>
      <div>
        <h1 style={{ fontSize: 22 }}>{t("v4NewTitle")}</h1>
        <p className="sub" style={{ margin: "2px 0 0" }}>{f.stationName(stationId)} · {t("v4Step0")}</p>
      </div>

      {/* PDF / without a scan stay above the list so you never scroll past every scan to reach them */}
      <section style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {canScan && (
          <>
            <button className="btn" disabled={!!busy} onClick={() => pdf.current?.click()}>📄 {busy === "pdf" ? t("preparing") : t("v4ManualPdf")}</button>
            <input ref={pdf} type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) void fromPdf(fl); }} />
          </>
        )}
        {f.can("vehicules.creer") && <button className="btn" disabled={!!busy} onClick={() => void without()}>✍ {t("v4NoScan")}</button>}
      </section>

      {canScan && (
        <section className="panel" style={{ padding: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>☁ {t("v4NewScans")}</h2>
          {scans === null && <p className="muted">{t("loading")}</p>}
          {scans && !scans.length && <p className="empty">{err || t("v4NoScans")}</p>}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 6 }}><input type="checkbox" style={{ width: 20, height: 20, minHeight: 0 }} checked={allStations} onChange={(e) => setAllStations(e.target.checked)} />{t("v6ScanAllStations")}</label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 8 }}>{t("v6ScanSort")}
            <select className="sel" style={{ width: "auto", minHeight: 40 }} value={sortBy} onChange={(e) => { const v = e.target.value as ScanSort; setSortBy(v); saveScanSort(v); }}>
              {SCAN_SORTS.map((k) => <option key={k} value={k}>{t(("v6ScanSort_" + k) as never)}</option>)}
            </select></label>
          {!!scans?.length && (
            <ParallaxScanList scans={scans} stationId={stationId} sortBy={sortBy} busy={busy} onTake={(s) => void take(s)} />
          )}
        </section>
      )}
    </main>
  );
}
