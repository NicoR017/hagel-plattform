import { isPlace } from "./places";
import { useMemo, useRef, useState } from "react";
import { STATUSES } from "@hagel/shared";
import { buildXlsx, eur, fmtDate, h1, num, xlsxFileName } from "@hagel/documents";
import { t } from "../i18n";
import { applyColibriToVehicle, colibriBadge, readColibriFile } from "../sync/colibriImport";
import { createVehicle, getPrefs } from "../sync/mutations";
import { go, useRoute } from "./route";
import { Occ } from "./occupancy";
import { readDashFilter } from "./dashFilter";
import { shareOrDownload, toDoc } from "./docs";
import { AssignDialog, MoveDialog, SettingsDialog, SharesDialog, StatusDialog, statusLabel } from "./Dialogs";
import { BackupImport } from "./BackupImport";
import { ScansDialog } from "./Scans";
import { useField, useVehicles } from "./store";
import { toast } from "./toast";

const today = () => new Date().toISOString().slice(0, 10);

function SyncBadge() {
  const { status } = useField();
  const n = status.pendingOps + status.pendingUploads;
  const cls = !status.online ? "off" : n || status.syncing ? "pend" : "ok";
  const label = !status.online ? t("offline") : n ? `${n} ${t("pending")}` : status.syncing ? t("syncing") : t("synced");
  return <span className={"syncbadge " + cls} aria-live="polite">{label}</span>;
}

export function List({ userName, orgSwitch }: { userName: string; orgSwitch?: React.ReactNode }) {
  const f = useField();
  const all = useVehicles();
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [day, setDay] = useState("");
  const [site, setSite] = useState("");
  const [customer, setCustomer] = useState("");
  const [insurer, setInsurer] = useState("");
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [dlg, setDlg] = useState<null | "status" | "move" | "shares" | "assign" | "settings" | "backup" | "scans">(null);
  const [busy, setBusy] = useState("");
  const bulkRef = useRef<HTMLInputElement>(null);

  const route = useRoute();
  const dashF = useMemo(() => (route.page === "list" && route.dash ? readDashFilter() : null), [route]);
  const dashIds = useMemo(() => (dashF ? new Set(dashF.ids) : null), [dashF]);
  const prices = f.can("prix.voir");
  const split = f.can("repartition_interne.voir");
  const rows = useMemo(() => all.map((v) => ({ v, c: f.calcOf(v) })), [all, f.calcOf]);
  const sorted = useMemo(() => [...rows].sort((a, b) => String(b.v.createdAt ?? b.v.updatedAt).localeCompare(String(a.v.createdAt ?? a.v.updatedAt))), [rows]);
  const q = query.toLowerCase();
  const filtered = sorted.filter(({ v }) =>
    (!dashIds || dashIds.has(v.id)) && (filter === "all" || v.statut === filter) && (!day || v.leistungsdatum === day) && (!site || v.stationId === site) && (!customer || v.clientStationId === customer) && (!insurer || v.insurerId === insurer) &&
    `${v.kennzeichen ?? ""} ${v.fin ?? ""} ${v.kunde ?? ""} ${v.techName ?? ""} ${v.demTechName ?? ""} ${v.claimNumber ?? ""}`.toLowerCase().includes(q));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((v) => v.statut === s).length]));
  const days = [...new Set(all.map((v) => v.leistungsdatum as string).filter(Boolean))].sort().reverse();
  const sumNet = filtered.reduce((a, r) => a + r.c.netto, 0);
  const allStations = f.refs?.stations ?? [];
  const sites = allStations.filter(isPlace); // places only: a body shop is a customer
  const customers = allStations.filter((s) => s.type === "carrosserie");
  const ids = sel ? [...sel] : [];
  const selected = filtered.filter((r) => sel?.has(r.v.id)).map((r) => r.v);

  const newVehicle = async () => {
    const prefs = await getPrefs(f.db);
    const stationId = site || prefs.lastStationId || sites.find((s) => s.active)?.id;
    if (!stationId) { toast(t("noSite")); return; }
    const id = await createVehicle(f.mut, { stationId });
    go({ page: "vehicle", id, tab: "basis" });
  };

  const exportXlsx = async () => {
    const list = (sel?.size ? selected : filtered.map((r) => r.v));
    if (!list.length) { toast(t("nothingToExport")); return; }
    const title = `${filter === "all" ? t("allStatuses") : statusLabel(filter)}${day ? " " + fmtDate(day) : ""}`;
    const bytes = buildXlsx(list.map((v) => ({ ...toDoc(v, f.refs), status: v.statut })), title, { prices, internalSplit: split }, { settings: f.calc });
    await shareOrDownload(bytes, xlsxFileName(title, today()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };

  const bulkColibri = async (files: File[]) => {
    const prefs = await getPrefs(f.db);
    const stationId = site || prefs.lastStationId || sites.find((s) => s.active)?.id;
    if (!stationId) { toast(t("noSite")); return; }
    const report: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(`${t("reading")} ${i + 1} / ${files.length} …`);
      try {
        const bytes = await files[i].arrayBuffer();
        const res = await readColibriFile(bytes);
        if (!res) { report.push(`✗ ${files[i].name}: ${t("colibriUnknown")}`); continue; }
        const id = await createVehicle(f.mut, { stationId, statut: "besichtigung" });
        const v = (await f.db.vehicles.get(id))!;
        const r = await applyColibriToVehicle(f.mut, v, res, { name: files[i].name, bytes });
        report.push(`${r.match ? "✓" : "⚠"} ${r.plate || files[i].name}: ${r.panels} ${t("panelsWord")}, ${r.imported} ${t("dentsWord")}${r.match ? "" : ` – ${t("reportSays")} ${r.total} – ${t("pleaseCheck")}`}${r.unknown.length ? ` – ${t("unknownWord")}: ${r.unknown.join(", ")}` : ""}`);
      } catch (e) { report.push(`✗ ${files[i].name}: ${(e as Error).message}`); }
    }
    setBusy("");
    window.alert(`${t("colibriImport")}\n\n${report.join("\n")}`);
  };

  return (
    <div className="fld">
      <div className="hdr">
        <div className="top">
          <SyncBadge />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {f.can("dashboard.voir") && <a className="iconbtn" href="#/dashboard" style={{ textDecoration: "none" }} aria-label={t("dashboard")}>📊</a>}
            <a className="iconbtn" href="#/admin" style={{ textDecoration: "none" }} aria-label={t("admin")}>👥</a>
            <button className="iconbtn" onClick={() => setDlg("settings")} aria-label={t("settings")}>⚙</button>
          </div>
        </div>
        <h1>{t("listTitle")}</h1>
        <div className="sub">{userName}{orgSwitch ? <span style={{ marginLeft: 8 }}>{orgSwitch}</span> : null}</div>
      </div>
      <div className="sheet" style={sel ? { paddingBottom: 130 } : undefined}>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6 }}>
          <button className={"chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>{t("all")} ({all.length})</button>
          {STATUSES.map((s) => <button key={s} className={"chip" + (filter === s ? " on" : "")} style={{ whiteSpace: "nowrap" }} onClick={() => setFilter(s)}>{statusLabel(s)} ({counts[s]})</button>)}
        </div>
        {dashF && (
          <div className="chip on" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0" }}>
            <span>{t("filterActive")}: {dashF.label} ({dashF.ids.length})</span>
            <button className="chip" onClick={() => go({ page: "list" })}>{t("clearFilter")} ✕</button>
          </div>
        )}
        {sites.some((s) => s.active && s.capacite > 0) && (
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6 }}>
            {sites.filter((s) => s.active && s.capacite > 0).map((s) => (
              <button key={s.id} className={"chip" + (site === s.id ? " on" : "")} style={{ whiteSpace: "nowrap" }} onClick={() => setSite(site === s.id ? "" : s.id)}>
                {s.name} <Occ present={f.refs?.occupancy?.[s.id] ?? 0} capacity={s.capacite} />
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid var(--line)", borderRadius: 16, padding: "4px 14px", marginTop: 8 }}>
          <span className="muted">🔍</span>
          <input className="inp" style={{ border: "none", padding: 0 }} placeholder={t("searchVehicles")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <select className="sel" value={day} onChange={(e) => setDay(e.target.value)} aria-label={t("day")}>
            <option value="">{t("allDays")}</option>
            <option value={today()}>{t("today")} ({fmtDate(today())})</option>
            {days.filter((d) => d !== today()).map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
          </select>
          <select className="sel" value={site} onChange={(e) => setSite(e.target.value)} aria-label={t("site")}>
            <option value="">{t("allSites")}</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {customers.length > 1 && (
          <select className="sel" style={{ marginTop: 8 }} value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label={t("customer")}>
            <option value="">{t("allCustomers")}</option>
            {customers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {(f.refs?.insurers.length ?? 0) > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {(f.refs?.insurers.length ?? 0) > 0 && (
              <select className="sel" value={insurer} onChange={(e) => setInsurer(e.target.value)} aria-label={t("insurer")}>
                <option value="">{t("allInsurers")}</option>{f.refs!.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className={"seg" + (sel ? " on" : "")} onClick={() => setSel(sel ? null : new Set())}>☑ {t("select")}</button>
          {f.can("export.excel") && <button className="seg" style={{ borderColor: "var(--greenDk)", color: "var(--greenDk)" }} onClick={() => void exportXlsx()}>📊 Excel</button>}
        </div>
        {f.can("colibri.importer") && !sel && (
          <>
            <button className="pbtn sec" disabled={!!busy} onClick={() => bulkRef.current?.click()}>
              📄 {busy || t("colibriBulk")}
              <span style={{ display: "block", fontSize: 12, fontWeight: 500, marginTop: 2 }}>{t("colibriBulkHint")}</span>
            </button>
            <button className="pbtn sec" style={{ marginTop: 10 }} onClick={() => setDlg("scans")}>☁ {t("scansAvailable")}</button>
            <input ref={bulkRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => { const fl = [...(e.target.files ?? [])]; e.target.value = ""; if (fl.length) void bulkColibri(fl); }} />
          </>
        )}
        {filtered.length > 0 && (
          <div className="summary" style={{ marginTop: 14 }}>
            <span style={{ opacity: 0.85 }}>{filtered.length} {t("vehiclesWord")}{day ? " · " + fmtDate(day) : ""}
              {prices && <span style={{ display: "block", fontSize: 12, fontWeight: 500 }}>Ø {eur(sumNet / filtered.length)} {t("netWord")}</span>}</span>
            {prices && <b>{eur(sumNet)}</b>}
          </div>
        )}
        {!filtered.length && <div style={{ textAlign: "center", color: "var(--sub)", marginTop: 50 }}>🚗<p>{all.length ? t("noMatch") : f.refs ? t("noVehicles") : t("loading")}</p></div>}
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map(({ v, c }) => {
            const on = !!sel?.has(v.id);
            const badge = colibriBadge(v);
            return (
              <div key={v.id} className="card" style={on ? { outline: "3px solid var(--greenDk)" } : undefined}>
                <div className="row" style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", fontSize: 13, color: "var(--sub)" }}>
                  <span><span style={{ background: "var(--bg)", borderRadius: 8, padding: "4px 8px" }}>{fmtDate(v.leistungsdatum as string)}</span> · {String(v.kunde || f.stationName(v.clientStationId) || "—")}</span>
                  <span>{sel ? (on ? <b style={{ color: "var(--greenDk)", fontSize: 18 }}>✔</b> : <span style={{ fontSize: 18 }}>○</span>) : <span className="badge">{statusLabel(v.statut)}</span>}</span>
                </div>
                <div className="row" style={{ padding: "12px 14px", cursor: "pointer" }} role="button" tabIndex={0}
                  onClick={() => { if (sel) { const n = new Set(sel); n.has(v.id) ? n.delete(v.id) : n.add(v.id); setSel(n); } else go({ page: "vehicle", id: v.id, tab: v.kennzeichen ? "erfassung" : "basis" }); }}>
                  <div>
                    <div style={{ fontSize: 19, fontWeight: 700 }}>{String(v.kennzeichen || "—")}</div>
                    <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>{String(v.modell || v.fin || t("noFin"))}</div>
                    <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>📍 {f.stationName(v.stationId)}{v._pending ? <b style={{ color: "#9a7b1f" }}> · ⏳</b> : null}</div>
                    {v.techName ? <div style={{ fontSize: 12, color: "var(--navy)", fontWeight: 700, marginTop: 2 }}>🧑‍🔧 {String(v.techName)}</div> : null}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {prices && <div style={{ fontSize: 18, fontWeight: 800, color: c.netto > 0 ? "var(--greenDk)" : "var(--greyDk)" }}>{eur(c.netto)}</div>}
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>
                      {c.es ? `${c.es.bollos} Bollos · ${t("cat")} ${c.es.cat.cat} · ${h1(c.es.totH)}` : `${num(c.totalAW)} AW`} · {c.panelCount} {t("panelsWord")}
                      {badge === "ok" && <b style={{ color: "var(--greenDk)" }}> · {t("scanOk")}</b>}
                      {badge === "check" && <b style={{ color: "var(--brick)" }}> · {t("scanCheck")}</b>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {sel ? (
        <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "var(--navy)", padding: "12px 14px max(14px, env(safe-area-inset-bottom))", borderRadius: "16px 16px 0 0", zIndex: 30 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="seg" style={{ flex: "0 0 auto", padding: "12px" }} onClick={() => setSel(sel.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.v.id)))}>{sel.size === filtered.length && sel.size > 0 ? t("none") : t("all")}</button>
            <button className="seg on" style={{ background: sel.size ? "var(--greenDk)" : "#3a4a6b", borderColor: "transparent" }} disabled={!sel.size || !f.can("vehicules.changer_statut")} onClick={() => setDlg("status")}>{t("status")} ({sel.size})</button>
            {f.can("vehicules.deplacer") && <button className="seg" style={{ flex: "0 0 auto", padding: "12px" }} disabled={!sel.size} onClick={() => setDlg("move")}>↔ {t("move")}</button>}
            {split && <button className="seg" style={{ flex: "0 0 auto", padding: "12px" }} disabled={!sel.size} onClick={() => setDlg("shares")}>🧑‍🔧 %</button>}
            {f.can("vehicules.assigner") && <button className="seg" style={{ flex: "0 0 auto", padding: "12px" }} disabled={!sel.size} onClick={() => setDlg("assign")}>👤</button>}
            <button className="seg" style={{ flex: "0 0 auto", padding: "12px" }} onClick={() => setSel(null)}>✕</button>
          </div>
          <div style={{ color: "#cdd6e6", fontSize: 12, textAlign: "center", marginTop: 6 }}>{t("selectHint")}</div>
        </div>
      ) : (
        f.can("vehicules.creer") && <button className="fab" onClick={() => void newVehicle()} aria-label={t("newVehicle")}>+</button>
      )}
      {dlg === "status" && <StatusDialog ids={ids} onClose={() => setDlg(null)} onDone={() => setSel(null)} />}
      {dlg === "move" && <MoveDialog ids={ids} from={selected[0]?.stationId} onClose={() => setDlg(null)} onDone={() => setSel(null)} />}
      {dlg === "shares" && <SharesDialog ids={ids} onClose={() => setDlg(null)} onDone={() => setSel(null)} />}
      {dlg === "assign" && <AssignDialog ids={ids} vehicles={all} onClose={() => setDlg(null)} onDone={() => setSel(null)} />}
      {dlg === "settings" && <SettingsDialog onClose={() => setDlg(null)} onBackup={() => setDlg("backup")} />}
      {dlg === "backup" && <BackupImport onClose={() => setDlg(null)} />}
      {dlg === "scans" && <ScansDialog onClose={() => setDlg(null)} />}
    </div>
  );
}

