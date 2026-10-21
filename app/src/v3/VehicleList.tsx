import { useMemo, useRef, useState } from "react";
import { computeVehicle, type CalcVehicle } from "@hagel/calc";
import { eur, fmtDate, h1, num } from "@hagel/documents";
import { t } from "../i18n";
import { colibriBadge } from "../sync/colibriImport";
import { createVehicle, deleteVehicle, setPrefs } from "../sync/mutations";
import type { LocalVehicle } from "../sync/db";
import { AssignDialog, MoveDialog, SharesDialog, StatusDialog, statusLabel } from "../field/Dialogs";
import { ScansDialog } from "../field/Scans";
import { go, type Mode } from "../field/route";
import { useField, useVehicles } from "../field/store";
import { toast } from "../field/toast";
import { confirmDialog } from "../field/ui";
import { bulkColibri, exportVehiclesXlsx, holdLabel, modeTitle } from "./listActions";
import { MODE_STATUSES, STATUS_STYLE, inMode, matchesChip } from "./modes";
import { useNewScans } from "./useScans";

type Dlg = null | "status" | "move" | "shares" | "assign" | "scans";

/** Third screen: the vehicles of one station in one mode, with status chips, search, multi-select and one-tap status / move. */
export function VehicleList({ stationId, mode }: { stationId: string; mode: Mode }) {
  const f = useField();
  const all = useVehicles();
  const scans = useNewScans();
  const st = f.refs?.stations.find((s) => s.id === stationId);
  const [chip, setChip] = useState("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<Dlg>(null);
  const [target, setTarget] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const bulkRef = useRef<HTMLInputElement>(null);
  const prices = f.can("prix.voir");

  const here = useMemo(() => all.filter((v) => v.stationId === stationId && inMode(v, mode)), [all, stationId, mode]);
  const rows = useMemo(() => here.map((v) => ({ v, c: computeVehicle(v as unknown as CalcVehicle, f.calc) })), [here, f.calc]);
  const sorted = useMemo(() => [...rows].sort((a, b) => String(b.v.createdAt ?? b.v.updatedAt).localeCompare(String(a.v.createdAt ?? a.v.updatedAt))), [rows]);
  const needle = q.trim().toLowerCase();
  const shown = sorted.filter(({ v }) => matchesChip(v, mode, chip) && `${v.kennzeichen ?? ""} ${v.fin ?? ""} ${v.modell ?? ""} ${v.kunde ?? ""} ${v.techName ?? ""} ${v.claimNumber ?? ""}`.toLowerCase().includes(needle));
  const chips = ["all", ...MODE_STATUSES[mode]];
  const insurerName = (id: unknown) => f.refs?.insurers.find((i) => i.id === id)?.name ?? "";
  const ctx = { stationId, mode };

  const open = (id: string, tab: "basis" | "erfassung" = "erfassung") => go({ page: "vehicle", id, tab, ctx });
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ask = (d: Exclude<Dlg, null>, ids: string[]) => { setTarget(ids); setDlg(d); };
  const selected = [...sel].filter((id) => shown.some((r) => r.v.id === id));

  const newExpertise = async () => {
    void setPrefs(f.db, { lastStationId: stationId, lastMode: mode });
    const id = await createVehicle(f.mut, { stationId });
    go({ page: "vehicle", id, tab: "basis", ctx });
  };
  const exportXlsx = async () => {
    const list: LocalVehicle[] = selected.length ? shown.filter((r) => sel.has(r.v.id)).map((r) => r.v) : shown.map((r) => r.v);
    if (!(await exportVehiclesXlsx(f, list, `${st?.name ?? ""} ${modeTitle(mode)}`.trim()))) toast(t("nothingToExport"));
  };

  return (
    <main>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22 }}>{t("v3Vehicles")} · {modeTitle(mode)}</h1>
          <p className="sub" style={{ margin: "2px 0 0", fontSize: 13 }}>{st?.name ?? ""} · {here.length} {t("v3CountVehicles")}</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {mode !== "rep" && f.can("colibri.importer") && (
            <button className="btn" onClick={() => ask("scans", [])}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
              {t("v3ColibriScans")}{scans.known ? ` (${scans.byStation.get(st?.name ?? "") ?? 0})` : ""}
            </button>
          )}
          {mode !== "rep" && f.can("vehicules.creer") && <button className="btn primary" onClick={() => void newExpertise()}>{t("v3NewExpertise")}</button>}
          <details style={{ position: "relative" }}>
            <summary className="btn" style={{ listStyle: "none" }}>⋯ {t("v3MoreActions")}</summary>
            <div className="menu" style={{ position: "absolute", right: 0, top: 48, minWidth: 260, background: "#fff", borderRadius: 12, boxShadow: "0 12px 32px rgba(10,18,35,.25)", padding: 6, zIndex: 15, display: "flex", flexDirection: "column" }}>
              {f.can("export.excel") && <button className="btn" style={{ border: "none", justifyContent: "flex-start" }} onClick={() => void exportXlsx()}>📊 {t("v3ExportExcel")}</button>}
              {f.can("colibri.importer") && <button className="btn" style={{ border: "none", justifyContent: "flex-start" }} disabled={!!busy} onClick={() => bulkRef.current?.click()}>📄 {busy || t("v3BulkColibri")}</button>}
            </div>
          </details>
          <input ref={bulkRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" style={{ display: "none" }} onChange={async (e) => {
            const files = [...(e.target.files ?? [])]; e.target.value = "";
            if (!files.length) return;
            const report = await bulkColibri(f, stationId, files, setBusy);
            window.alert(`${t("colibriImport")}\n\n${report.join("\n")}`);
          }} />
        </div>
      </div>

      {mode === "rep" && <p className="note">{t("v3RepNote")}</p>}

      <div className="toolbar">
        <label style={{ flex: "1 1 260px", display: "flex" }}>
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{t("v3Search")}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("v3SearchPh")} />
        </label>
        <div role="group" aria-label={t("v3StatusFilter")} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c) => {
            const n = c === "all" ? here.length : here.filter((v) => matchesChip(v, mode, c)).length;
            return <button key={c} className={"chip" + (chip === c ? " on" : "")} aria-pressed={chip === c} onClick={() => setChip(c)}>{c === "all" ? t("all") : statusLabel(c)} · {n}</button>;
          })}
        </div>
      </div>

      {selected.length > 0 && (
        <div className="selbar" role="region" aria-label={t("v3Selected")}>
          <b style={{ flex: "1 1 160px" }}>{selected.length} {t("v3Selected")}</b>
          {f.can("vehicules.changer_statut") && <button className="btn" onClick={() => ask("status", selected)}>{t("v3ChangeStatus")}</button>}
          {f.can("vehicules.deplacer") && <button className="btn" onClick={() => ask("move", selected)}>{t("v3MoveToOther")}</button>}
          {f.can("repartition_interne.voir") && <button className="btn" onClick={() => ask("shares", selected)}>🧑‍🔧 %</button>}
          {f.can("vehicules.assigner") && <button className="btn" onClick={() => ask("assign", selected)}>👤 {t("assigned")}</button>}
          <button className="btn ghost" onClick={() => setSel(new Set())}>{t("v3ClearSel")}</button>
        </div>
      )}

      <div className="rows">
        {shown.map(({ v, c }) => {
          const on = sel.has(v.id), style = STATUS_STYLE[v.statut] ?? STATUS_STYLE.arrive, badge = colibriBadge(v);
          const plate = String(v.kennzeichen || "—");
          return (
            <div key={v.id} className={"vrow" + (on ? " sel" : "")}>
              <label className="cb">
                <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{plate} {t("v3SelectRow")}</span>
                <input type="checkbox" checked={on} onChange={() => toggle(v.id)} />
              </label>
              <button className="open" onClick={() => open(v.id, v.kennzeichen ? "erfassung" : "basis")}>
                <span className="c" style={{ flex: "1 1 200px" }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{plate}{v._pending ? " ⏳" : ""}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{String(v.modell || v.fin || t("noFin"))} · {fmtDate(v.leistungsdatum as string)}</span>
                </span>
                <span className="c" style={{ flex: "1 1 170px", fontSize: 13 }}>
                  <span>{insurerName(v.insurerId) || String(v.kunde || f.stationName(v.clientStationId) || "—")}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{v.claimNumber ? `${t("v3Claim")} ${String(v.claimNumber)}` : f.stationName(v.clientStationId)}</span>
                </span>
                <span style={{ flex: "0 0 auto" }}><span className="badge" style={{ background: style.bg, color: style.fg }}>{holdLabel(v)}</span></span>
                <span className="c" style={{ flex: "0 1 140px", fontSize: 13 }}>
                  <span>{c.dents} {t("dentsWord")}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{c.es ? `${c.es.bollos} Bollos · ${t("cat")} ${c.es.cat.cat} · ${h1(c.es.totH)}` : `${num(c.totalAW)} AW`}</span>
                </span>
                {prices && <span style={{ flex: "0 1 110px", textAlign: "right", fontWeight: 600 }}>{c.netto > 0 ? eur(c.netto) : "—"}</span>}
                {badge && <span className="badge" style={badge === "ok" ? { background: "#E4EEE5", color: "#2F5535" } : { background: "#FBF1D9", color: "#7A5300" }}>{badge === "ok" ? t("scanOk") : t("scanCheck")}</span>}
              </button>
              <span className="acts">
                {f.can("vehicules.changer_statut") && <button className="btn" aria-label={`${t("v3ChangeStatusOf")} ${plate}`} onClick={() => ask("status", [v.id])}>{t("status")}</button>}
                {f.can("vehicules.deplacer") && <button className="btn" aria-label={`${plate} ${t("v3MoveOf")}`} onClick={() => ask("move", [v.id])}>{t("move")}</button>}
                {f.can("vehicules.supprimer") && (
                  <button className="btn" style={{ color: "#8F1D14" }} aria-label={`${t("v3Delete")} ${plate}`}
                    onClick={() => { if (confirmDialog(`${t("deleteVehicleQ")} ${plate}?`)) { void deleteVehicle(f.mut, v.id); setSel((s) => { const n = new Set(s); n.delete(v.id); return n; }); } }}>🗑</button>
                )}
              </span>
            </div>
          );
        })}
        {!shown.length && <p className="empty">{f.refs ? t("v3EmptyFilter") : t("loading")}</p>}
      </div>

      {dlg === "status" && <StatusDialog ids={target} current={target.length === 1 ? all.find((v) => v.id === target[0])?.statut : undefined} onClose={() => setDlg(null)} onDone={() => setSel(new Set())} />}
      {dlg === "move" && <MoveDialog ids={target} from={stationId} onClose={() => setDlg(null)} onDone={() => setSel(new Set())} />}
      {dlg === "shares" && <SharesDialog ids={target} onClose={() => setDlg(null)} onDone={() => setSel(new Set())} />}
      {dlg === "assign" && <AssignDialog ids={target} vehicles={all} onClose={() => setDlg(null)} onDone={() => setSel(new Set())} />}
      {dlg === "scans" && <ScansDialog onClose={() => setDlg(null)} />}
    </main>
  );
}
