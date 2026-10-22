import { SCAN_SORTS, loadScanSort, saveScanSort, sortScans, type ScanSort } from "./scanSort";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { fmtDateTime, t } from "../i18n";
import { applyColibriToVehicle, readColibriFile } from "../sync/colibriImport";
import { createVehicle, setPrefs } from "../sync/mutations";
import { go, type Mode } from "../field/route";
import { useField } from "../field/store";
import { toast } from "../field/toast";

interface Scan {
  partitionKey: string; rowKey: string; scanDateTime: string | null; plate: string; brand: string; model: string; colibriNumber: string; businessCustomer: string;
  claimNumber: string; dentsTotal: number | null; stationId: string | null; stationName: string; insurerName: string; warnings: string[]; importable: boolean;
}
interface ImportResult { status: string; vehicleId?: string; message?: string; check?: { ok: boolean } }

/** Step 0 of the assessment: take over a new scan of this station, import a Colibri PDF by hand, or start without a scan. */
export function NewExpertise({ stationId, mode }: { stationId: string; mode: Mode }) {
  const f = useField();
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [sortBy, setSortBy] = useState<ScanSort>(loadScanSort());
  const [allStations, setAllStations] = useState(false); // also the scans mapped to another station: they are loaded into THIS one
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const pdf = useRef<HTMLInputElement>(null);
  const ctx = { stationId, mode };
  const canScan = f.can("colibri.importer");

  useEffect(() => {
    if (!canScan) { setScans([]); return; }
    let live = true;
    api<Scan[]>("GET", allStations ? "/azure/scans?all=1" : "/azure/scans").then((r) => live && setScans(allStations ? r : r.filter((s) => s.stationId === stationId))).catch((e) => { if (live) { setScans([]); setErr((e as Error).message); } });
    return () => { live = false; };
  }, [canScan, stationId, allStations]);

  const open = (id: string) => { void setPrefs(f.db, { lastStationId: stationId, lastMode: mode }); go({ page: "expertise", id, step: "basis", ctx }); };

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

      {canScan && (
        <section className="panel" style={{ padding: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>☁ {t("v4NewScans")}</h2>
          {scans === null && <p className="muted">{t("loading")}</p>}
          {scans && !scans.length && <p className="empty">{err || t("v4NoScans")}</p>}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 6 }}><input type="checkbox" style={{ width: 20, height: 20, minHeight: 0 }} checked={allStations} onChange={(e) => { setScans(null); setAllStations(e.target.checked); }} />{t("v6ScanAllStations")}</label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 8 }}>{t("v6ScanSort")}
            <select className="sel" style={{ width: "auto", minHeight: 40 }} value={sortBy} onChange={(e) => { const v = e.target.value as ScanSort; setSortBy(v); saveScanSort(v); }}>
              {SCAN_SORTS.map((k) => <option key={k} value={k}>{t(("v6ScanSort_" + k) as never)}</option>)}
            </select></label>
          <div className="rows">
            {sortScans(scans ?? [], sortBy).map((s) => (
              <div key={s.partitionKey + s.rowKey} className="vrow" style={{ padding: 12 }}>
                <span className="c" style={{ flex: "1 1 200px" }}>
                  <b style={{ fontSize: 16 }}>{s.plate || "—"}</b>
                  <span className="muted" style={{ fontSize: 12 }}>{[s.brand, s.model].filter(Boolean).join(" ")} · {s.scanDateTime ? fmtDateTime(s.scanDateTime) : ""}</span>
                </span>
                <span className="c" style={{ flex: "1 1 200px", fontSize: 13 }}>
                  <span>{s.businessCustomer}{s.stationId !== stationId ? <span className="muted" style={{ fontSize: 11 }}> · {t("v6ScanOtherStation")} {s.stationName || t("v6ScanUnassigned")}</span> : null}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{s.colibriNumber}{s.insurerName ? ` · ${s.insurerName}` : ""}{s.dentsTotal != null ? ` · ${s.dentsTotal} ${t("dentsWord")}` : ""}</span>
                </span>
                <span className="badge" style={s.warnings.length ? { background: "#FBF1D9", color: "#7A5300" } : { background: "#E4EEE5", color: "#2F5535" }}>{s.warnings.length ? t("scanCheck") : t("scanOk")}</span>
                <button className="btn primary" disabled={!!busy || !s.importable} onClick={() => void take(s)}>{busy === s.partitionKey ? t("preparing") : t("accept")}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {canScan && (
          <>
            <button className="btn" disabled={!!busy} onClick={() => pdf.current?.click()}>📄 {busy === "pdf" ? t("preparing") : t("v4ManualPdf")}</button>
            <input ref={pdf} type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) void fromPdf(fl); }} />
          </>
        )}
        {f.can("vehicules.creer") && <button className="btn" disabled={!!busy} onClick={() => void without()}>✍ {t("v4NoScan")}</button>}
      </section>
    </main>
  );
}
