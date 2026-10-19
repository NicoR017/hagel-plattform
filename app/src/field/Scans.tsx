import { useEffect, useState } from "react";
import { api } from "../api";
import { fmtDateTime, t } from "../i18n";
import { useField } from "./store";
import { toast } from "./toast";
import { Dialog } from "./ui";

interface Scan {
  partitionKey: string; rowKey: string; scanDateTime: string | null; plate: string; brand: string; model: string; colibriNumber: string; businessCustomer: string;
  claimNumber: string; location: string; dentsTotal: number | null; stationName: string; clientName: string; insurerName: string; warnings: string[]; importable: boolean;
}
interface Result { partitionKey: string; rowKey: string; status: string; vehicleId?: string; message?: string; check?: { imported: number; total: number | null; azureTotal: number | null; ok: boolean }; photos?: number }

const keyOf = (s: { partitionKey: string; rowKey: string }) => `${s.partitionKey}|${s.rowKey}`;

/** "Scans verfügbar": scans of the user's sites that were not imported yet (online only). Imported vehicles then arrive through the normal sync. */
export function ScansDialog({ onClose }: { onClose: () => void }) {
  const f = useField();
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);

  const load = async () => {
    try {
      const l = await api<Scan[]>("GET", "/azure/scans");
      setScans(l); setErr("");
    } catch (e) { setErr((e as Error).message); setScans([]); }
  };
  useEffect(() => { void load(); }, []);

  const importable = (scans ?? []).filter((s) => s.importable);
  const run = async (list: Scan[]) => {
    if (!list.length) return;
    setBusy(true);
    try {
      const r = await api<{ results: Result[] }>("POST", "/azure/scans/import", { keys: list.map((s) => ({ partitionKey: s.partitionKey, rowKey: s.rowKey })) });
      setResults(r.results);
      setSel(new Set());
      void f.engine.syncNow(f.orgId);
      await load();
      const ok = r.results.filter((x) => x.status === "imported").length;
      toast(`${ok} / ${list.length} ${t("imported")}`);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const statusText = (r: Result) => r.status === "imported" ? `✓ ${t("imported")}${r.photos ? ` · ${r.photos} ${t("photosWord")}` : ""}${r.check && !r.check.ok ? ` · ⚠ ${t("scanCheck")} (${r.check.imported} ≠ ${r.check.azureTotal ?? r.check.total})` : ""}`
    : r.status === "already" ? t("alreadyImported") : r.status === "pdf_missing" ? `⚠ ${t("pdfMissing")}` : r.status === "pdf_unreadable" ? `⚠ ${t("colibriUnknown")}`
      : r.status === "not_allowed" ? t("forbidden") : r.status === "unmapped" ? t("needsMapping") : r.status === "not_found" ? t("noData") : `✗ ${r.message ?? r.status}`;

  return (
    <Dialog title={t("scansAvailable")} onClose={onClose}>
      {err && <div className="notice err">{err}</div>}
      {scans === null && <div className="muted">{t("loading")}</div>}
      {scans && !scans.length && !err && <div className="muted" style={{ padding: "16px 0" }}>{t("noScansWaiting")}</div>}
      {scans && scans.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button className="seg" onClick={() => setSel(sel.size === importable.length ? new Set() : new Set(importable.map(keyOf)))}>{sel.size === importable.length && sel.size > 0 ? t("none") : t("all")}</button>
            <button className="seg on" disabled={busy || !sel.size} onClick={() => void run(importable.filter((s) => sel.has(keyOf(s))))}>{busy ? t("importing") : `${t("importSelected")} (${sel.size})`}</button>
          </div>
          {scans.map((s) => (
            <div key={keyOf(s)} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "8px 10px", marginBottom: 8, opacity: s.importable ? 1 : 0.7 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="checkbox" style={{ width: 24, height: 24 }} disabled={!s.importable || busy} checked={sel.has(keyOf(s))}
                  onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(keyOf(s)) : n.delete(keyOf(s)); setSel(n); }} />
                <div style={{ flex: 1 }}>
                  <div className="row"><b style={{ fontSize: 17 }}>{s.plate || "—"}</b><span className="muted" style={{ fontSize: 12 }}>{s.scanDateTime ? fmtDateTime(s.scanDateTime) : ""}</span></div>
                  <div className="muted" style={{ fontSize: 12 }}>{[s.brand.split("-")[0], s.model].filter(Boolean).join(" ")}{s.colibriNumber ? ` · #${s.colibriNumber}` : ""}{s.dentsTotal != null ? ` · ${s.dentsTotal} ${t("dentsWord")}` : ""}</div>
                  <div style={{ fontSize: 12 }}>{s.clientName || s.businessCustomer}{s.insurerName ? ` · ${s.insurerName}` : ""}{s.claimNumber ? ` · ${s.claimNumber}` : ""}{s.stationName ? ` → 📍 ${s.stationName}` : ""}</div>
                  {s.warnings.map((w) => <div key={w} style={{ fontSize: 12, color: "var(--brick)" }}>⚠ {t(("w." + w) as never)}</div>)}
                </div>
              </label>
            </div>
          ))}
          {importable.length > 1 && <button className="pbtn" disabled={busy} onClick={() => void run(importable)}>{busy ? t("importing") : `${t("importAll")} (${importable.length})`}</button>}
        </>
      )}
      {results && (
        <div className="notice warn" style={{ marginTop: 12 }}>
          {results.map((r) => <div key={keyOf(r)}>{r.partitionKey}: {statusText(r)}</div>)}
        </div>
      )}
    </Dialog>
  );
}
