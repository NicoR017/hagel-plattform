import { useEffect, useState } from "react";
import { api } from "../api";
import { fmtDateTime, t } from "../i18n";

export interface Scan {
  partitionKey: string; rowKey: string; scanDateTime: string | null; plate: string; brand: string; model: string; colibriNumber: string; businessCustomer: string;
  claimNumber: string; dentsTotal: number | null; stationId: string | null; stationName: string; insurerName: string; warnings: string[]; importable: boolean;
}

/** The Colibri scans waiting for import: those mapped to this station, or every one of the organisation (`all`: they are loaded into THIS station). */
export function useStationScans(stationId: string, enabled: boolean, all: boolean): { scans: Scan[] | null; err: string } {
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!enabled) { setScans([]); return; }
    let live = true;
    setScans(null);
    api<Scan[]>("GET", all ? "/azure/scans?all=1" : "/azure/scans").then((r) => live && setScans(all ? r : r.filter((s) => s.stationId === stationId))).catch((e) => { if (live) { setScans([]); setErr((e as Error).message); } });
    return () => { live = false; };
  }, [enabled, stationId, all]);
  return { scans, err };
}

/** What a row of the scan list shows: plate and time, customer and details, and the "Scan ✓ / prüfen ⚠" badge. */
export function ScanInfo({ s, stationId }: { s: Scan; stationId: string }) {
  return (
    <>
      <span className="c" style={{ flex: "1 1 200px" }}>
        <b style={{ fontSize: 16 }}>{s.plate || "—"}</b>
        <span className="muted" style={{ fontSize: 12 }}>{[s.brand, s.model].filter(Boolean).join(" ")} · {s.scanDateTime ? fmtDateTime(s.scanDateTime) : ""}</span>
      </span>
      <span className="c" style={{ flex: "1 1 200px", fontSize: 13 }}>
        <span>{s.businessCustomer}{s.stationId !== stationId ? <span className="muted" style={{ fontSize: 11 }}> · {t("v6ScanOtherStation")} {s.stationName || t("v6ScanUnassigned")}</span> : null}</span>
        <span className="muted" style={{ fontSize: 12 }}>{s.colibriNumber}{s.insurerName ? ` · ${s.insurerName}` : ""}{s.dentsTotal != null ? ` · ${s.dentsTotal} ${t("dentsWord")}` : ""}</span>
      </span>
      <span className="badge" style={s.warnings.length ? { background: "#FBF1D9", color: "#7A5300" } : { background: "#E4EEE5", color: "#2F5535" }}>{s.warnings.length ? t("scanCheck") : t("scanOk")}</span>
    </>
  );
}
