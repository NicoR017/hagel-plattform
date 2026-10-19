import { useEffect, useMemo, useRef, useState } from "react";
import { computeShares, computeVehicle, type CalcResult, type CalcVehicle } from "@hagel/calc";
import { dentBreak, docText, eur, esFormula, esLines, fmtDateL, h1, kvaFileName, kvaPlainText, mailTexts, num, plabel, zustStr } from "@hagel/documents";
import { t } from "../i18n";
import { colibriBadge } from "../sync/colibriImport";
import type { LocalVehicle } from "../sync/db";
import { setShares, setStatus } from "../sync/mutations";
import { buildRepairReport, buildSendPdf, shareOrDownload, toDoc } from "./docs";
import { StatusDialog } from "./Dialogs";
import { usePhotos, usePhotoUrl, useField } from "./store";
import { toast } from "./toast";
import { NumInput } from "./ui";
import type { LocalPhoto } from "../sync/db";

function Thumb({ p, land }: { p: LocalPhoto; land: "DE" | "ES" }) {
  const url = usePhotoUrl(p);
  if (!url) return null;
  return <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }}><img src={url} alt={p.label} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }} /><div style={{ fontSize: 10, color: "var(--sub)", padding: "3px 4px", textAlign: "center" }}>{land === "ES" ? p.label : p.label}</div></div>;
}

/** Internal split (technician / commission). Never part of the customer document. */
function SharesBox({ v, c }: { v: LocalVehicle; c: CalcResult }) {
  const f = useField();
  const a = computeShares(v as never, c);
  const x = v as Record<string, any>;
  const canEdit = f.can("vehicules.modifier");
  const people = f.refs?.people ?? [];
  const sec = (s: string) => <div style={{ marginTop: 14, fontSize: 13, fontWeight: 700, color: "var(--navy)" }}>{s}</div>;
  const line = (l: string, val: string) => <div className="row" style={{ marginTop: 6 }}><span className="muted" style={{ fontSize: 13 }}>{l}</span><b>{val}</b></div>;
  const pcts = (cur: number, vals: number[], on: (n: number) => void) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
      {vals.map((n) => <button key={n} className={"chip" + (cur === n ? " on" : "")} disabled={!canEdit} onClick={() => on(n)}>{n}</button>)}
      <NumInput value={cur} onChange={on} max={100} style={{ width: 84 }} /> %
    </div>
  );
  const names = (cur: string, on: (s: string) => void, id: string) => (
    <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {people.map((p) => <button key={p.id} className={"chip" + (cur.toLowerCase() === p.name.toLowerCase() ? " on" : "")} disabled={!canEdit} onClick={() => on(cur.toLowerCase() === p.name.toLowerCase() ? "" : p.name)}>{p.name}</button>)}
      </div>
      <input id={id} className="inp" style={{ marginTop: 6, fontWeight: 700 }} disabled={!canEdit} placeholder={t("techNameHint")} value={cur} onChange={(e) => on(e.target.value)} />
    </>
  );
  return (
    <div style={{ marginTop: 14, background: "#fff", border: "1px dashed var(--navy)", borderRadius: 14, padding: "12px 14px" }}>
      <div className="row"><b>{t("splitTitle")}</b><span className="muted" style={{ fontSize: 12 }}>{t("netWord")} {eur(a.basis)}</span></div>
      {sec(`🧑‍🔧 ${t("techPdr")} · ${t("basis")} ${eur(a.pdrBasis)}`)}
      {names(a.techName, (s) => void setShares(f.mut, v.id, { techName: s }), "tnIn")}
      {pcts(a.techPct, [40, 45, 50, 55, 60], (n) => void setShares(f.mut, v.id, { techPct: n }))}
      {line(`${a.techName || t("technician")} · ${num(a.techPct, 1)} %`, eur(a.techEur))}
      {a.demEur > 0 ? (
        <>
          {sec(`🔩 ${t("techDem")} · ${eur(a.demEur)}`)}
          {names(x.demTechName ?? "", (s) => void setShares(f.mut, v.id, { demTechName: s }), "dnIn")}
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{x.demTechName ? "" : t("emptyIsSame")}</div>
          {pcts(a.demTechPct, [50, 70, 80, 100], (n) => void setShares(f.mut, v.id, { demTechPct: n }))}
          {line(`${a.demTechName || t("technician")} · ${num(a.demTechPct, 1)} % ${t("ofDem")}`, eur(a.demTechEur))}
        </>
      ) : <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>{t("demHintShares")}</div>}
      {sec(`🏭 ${t("commissionTitle")}`)}
      <div className="muted" style={{ fontSize: 11 }}>{t("commissionHint")}</div>
      {line(`${f.stationName(v.clientStationId) || t("customer")} · ${num(a.werkPct, 1)} %${a.werkMode === "staffel" ? " (Staffel)" : ""}`, eur(a.werkEur))}
      <div style={{ height: 1, background: "var(--line)", margin: "10px 0 4px" }} />
      <div className="row"><b>{t("remainsPdr")}</b><b style={{ fontSize: 17, color: a.rest >= 0 ? "var(--greenDk)" : "var(--brick)" }}>{eur(a.rest)} · {num(a.basis ? (a.rest / a.basis) * 100 : 0, 1)} %</b></div>
    </div>
  );
}

export function Kva({ v }: { v: LocalVehicle }) {
  const f = useField();
  const photos = usePhotos(v.id);
  const cv = v as unknown as CalcVehicle;
  const c = useMemo(() => computeVehicle(cv, f.calc), [v, f.calc]); // eslint-disable-line react-hooks/exhaustive-deps
  const x = v as Record<string, any>;
  const land: "DE" | "ES" = x.land === "ES" ? "ES" : "DE";
  const X = docText(land);
  const doc = toDoc(v, f.refs);
  const prices = f.can("prix.voir"), split = f.can("repartition_interne.voir");
  const [busy, setBusy] = useState("");
  const [statusDlg, setStatusDlg] = useState(false);
  const ready = useRef<{ key: string; p: ReturnType<typeof buildSendPdf> } | null>(null);
  const key = `${v.id}:${v.updatedAt}:${photos.length}:${photos.map((p) => p.inPdf + p.label).join()}`;

  // prepare the PDF in the background so that the share sheet opens immediately (browsers want it inside the tap)
  useEffect(() => {
    if (!prices) return;
    const h = setTimeout(() => { ready.current = { key, p: buildSendPdf(f.db, f.engine, v, c, f.refs) }; ready.current.p.catch(() => undefined); }, 400);
    return () => clearTimeout(h);
  }, [key, prices]); // eslint-disable-line react-hooks/exhaustive-deps
  const getPdf = () => (ready.current?.key === key ? ready.current.p : buildSendPdf(f.db, f.engine, v, c, f.refs));

  const e = c.es;
  const badge = colibriBadge(v);
  const k = v.colibri as { imported: number; reportTotal: number | null; rowSum: number; unknown: string[] } | null;
  const dlg = (label: string, val: string, bold?: boolean) => <div className="row" style={{ fontWeight: bold ? 800 : 400, gap: 10, marginBottom: 4 }}><span>{label}</span><span style={{ whiteSpace: "nowrap" }}>{val}</span></div>;
  const toRepair = v.statut !== "reparatur";

  const share = async (mail: boolean) => {
    setBusy(t("preparing"));
    try {
      const r = await getPdf();
      const name = kvaFileName(doc);
      if (mail) {
        const mt = mailTexts(doc), to = String(x.kundeEmail ?? "").trim();
        if (to && navigator.clipboard?.writeText) void navigator.clipboard.writeText(to).catch(() => undefined);
        toast(to ? `📋 ${to} ${t("copiedPasteTo")}` : t("noCustomerMail"), 6000);
        const ok = await shareOrDownload(r.bytes, name, "application/pdf", { title: mt.subject, text: mt.body });
        if (ok && !navigator.canShare) window.location.href = `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(mt.subject)}&body=${encodeURIComponent(mt.body)}`;
      } else await shareOrDownload(r.bytes, name, "application/pdf");
    } catch (err) { toast(`${t("pdfFailed")}: ${(err as Error).message}`); }
    setBusy("");
  };

  const rows = c.panels.filter((p) => p.total > 0 || (p.big ?? 0) > 0);
  return (
    <div style={{ padding: "16px 14px 30px" }}>
      <div style={{ background: "#0a3a8c", color: "#fff", padding: "10px 14px", borderRadius: 10, fontWeight: 800, fontSize: 18 }}>{String(x.kunde || f.stationName(v.clientStationId) || X.kunde)}</div>
      {(x.claimNumber || doc.insurerName) && <div style={{ fontSize: 12, color: "var(--sub)", margin: "8px 2px 0" }}>{x.claimNumber ? `${land === "ES" ? "N.º de siniestro" : "Schadennummer"}: ${x.claimNumber}` : ""}</div>}
      <div style={{ fontSize: 12, color: "var(--sub)", margin: "10px 2px" }}>{X.kz}: <b style={{ color: "var(--text)" }}>{x.kennzeichen || "—"}</b> · {X.fin}: {x.fin || "—"}{x.modell ? ` · ${X.modell}: ${x.modell}` : ""}<br />
        {X.datum}: {fmtDateL(land, x.leistungsdatum)}{land === "DE" ? ` · ${X.zustand}: ${zustStr(doc)}` : ""}</div>
      {badge === "check" && k && <div className="notice err">⚠ {t("scanCheck")}: {k.imported} {t("dentsTaken")}, {t("reportSays")} {k.reportTotal ?? k.rowSum}{k.unknown.length ? ` · ${t("notRecognised")}: ${k.unknown.join(", ")}` : ""}</div>}
      {(!x.modell || !x.fin) && <div className="notice warn">{t("missingFields")}: {[!x.modell ? t("model") : "", !x.fin ? t("vin") : ""].filter(Boolean).join(", ")}</div>}

      {e ? (
        <div style={{ background: "var(--greenBg)", border: "1px solid var(--greenDk)", borderRadius: 14, padding: "14px 16px", margin: "10px 0" }}>
          <div style={{ fontSize: 13, color: "var(--greenDk)", fontWeight: 700 }}>Matriz · {e.bollos} bollos ({e.small} + {e.large} × 2)</div>
          <div className="row" style={{ alignItems: "baseline", marginTop: 4 }}><span style={{ fontSize: 26, fontWeight: 800, color: "var(--greenDk)" }}>Cat. {e.cat.cat} · {h1(e.H.h)}</span>{prices && <span style={{ fontSize: 18, fontWeight: 700 }}>{eur(e.matrixEur)}</span>}</div>
          {prices && <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{esFormula(e, "es")} · tope {eur(e.cap)}</div>}
        </div>
      ) : (
        <div style={{ background: "var(--greenBg)", border: "1px solid var(--greenDk)", borderRadius: 14, padding: "14px 16px", margin: "10px 0" }}>
          <div style={{ fontSize: 13, color: "var(--greenDk)", fontWeight: 700 }}>{X.reinLang}</div>
          <div className="row" style={{ alignItems: "baseline", marginTop: 4 }}><span style={{ fontSize: 28, fontWeight: 800, color: "var(--greenDk)" }}>{num(c.repairAW)} {X.aw}</span>{prices && <span style={{ fontSize: 18, fontWeight: 700 }}>{eur(c.repairEur)}</span>}</div>
        </div>
      )}

      <table>
        <thead><tr><th>{X.bauteil}</th><th>{X.dellen}</th><th>Ø mm</th>{e ? <th>Bollos</th> : <><th>{X.aw}</th>{prices && <th>€</th>}</>}</tr></thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.key} style={{ background: i % 2 ? "#f6f8fb" : "#fff" }}>
              <td>{plabel(land, p.key)}{p.alu ? ` (${X.alu})` : ""}{p.kleber && (!e || p.method !== "erneuern") ? ` +${X.kleber}` : ""}{p.method === "ptp" ? ` (${X.ptp})` : ""}{p.method === "erneuern" ? ` (${X.erneuern})` : ""}
                {dentBreak(p) && <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 2 }}>{dentBreak(p)}</div>}</td>
              <td style={{ textAlign: "center" }}>{p.total + (e ? +(p.big || 0) : 0)}</td><td style={{ textAlign: "center" }}>{p.avgClass}</td>
              {e ? <td style={{ textAlign: "center" }}>{p.bollos}</td> : <><td style={{ textAlign: "center" }}>{num(p.repair)}</td>{prices && <td style={{ textAlign: "center" }}>{eur(p.repair * c.euroPerAW)}</td>}</>}
            </tr>
          ))}
          <tr style={{ fontWeight: 700, background: "#eef1f5" }}>
            <td>{e ? "Total" : X.summe}</td><td style={{ textAlign: "center" }}>{c.dents}</td><td style={{ textAlign: "center" }}>{c.avg}</td>
            {e ? <td style={{ textAlign: "center" }}>{e.bollos}</td> : <><td style={{ textAlign: "center" }}>{num(c.repairAW)}</td>{prices && <td style={{ textAlign: "center" }}>{eur(c.repairEur)}</td>}</>}
          </tr>
          {!e && c.bigCount > 0 && <tr style={{ color: "var(--brick)", fontWeight: 700 }}><td>{X.sonder}</td><td style={{ textAlign: "center" }}>{c.bigCount}</td><td style={{ textAlign: "center" }}>&gt;85</td><td style={{ textAlign: "center" }}>—</td>{prices && <td style={{ textAlign: "center" }}>{c.bigEur > 0 ? eur(c.bigEur) : X.manuell}</td>}</tr>}
          {!e && ([[X.finish, c.finishAW], [X.ruest, c.ruestAW], [X.greif, c.greifAW], [X.hohl, c.hohlAW], [X.verbr, c.verbrAW]] as [string, number][]).filter(([, aw]) => aw > 0).map(([l, aw]) => (
            <tr key={l}><td className="muted">{l}</td><td style={{ textAlign: "center" }}>—</td><td style={{ textAlign: "center" }}>—</td><td style={{ textAlign: "center" }}>{num(aw)}</td>{prices && <td style={{ textAlign: "center" }}>{eur(aw * c.euroPerAW)}</td>}</tr>
          ))}
          {!e && <tr style={{ background: "var(--navy)", color: "#fff", fontWeight: 800 }}><td>{X.gesamt}</td><td style={{ textAlign: "center" }}>{c.dents}</td><td style={{ textAlign: "center" }}>{c.avg}</td><td style={{ textAlign: "center" }}>{num(c.totalAW)}</td>{prices && <td style={{ textAlign: "center" }}>{eur(c.awNetto)}</td>}</tr>}
        </tbody>
      </table>

      {prices && (
        <div style={{ marginTop: 16, background: "var(--bg)", borderRadius: 14, padding: "14px 16px", fontSize: 14 }}>
          {e ? esLines(doc, c).map((l, i) => <div key={i}>{dlg(l.l, l.open ? "aparte" : eur(l.v))}</div>) : (
            <>
              {dlg(X.awnetto, eur(c.awNetto))}
              {c.bigEur > 0 && dlg(X.sonder, eur(c.bigEur))}
              {c.kleberMat + c.hohlMat > 0 && dlg(X.material, eur(c.kleberMat + c.hohlMat))}
              {c.demEur > 0 && dlg(X.demont, eur(c.demEur))}
              {c.glass.map((g) => <div key={g.k}>{dlg(g.de, g.eur > 0 ? eur(g.eur) : "separat")}</div>)}
            </>
          )}
          <div style={{ marginTop: 6 }}>{dlg(X.netto, eur(c.netto), true)}</div>
          {dlg(X.mwst, eur(c.brutto - c.netto))}
          <div style={{ height: 1, background: "var(--line)", margin: "8px 0" }} />
          <div className="row" style={{ fontSize: 20, fontWeight: 800, color: "var(--greenDk)" }}><span>{X.brutto}</span><span>{eur(c.brutto)}</span></div>
        </div>
      )}
      {split && <SharesBox v={v} c={c} />}
      {String(x.notiz ?? "").trim() && <div style={{ marginTop: 14, background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px" }}><div style={{ fontWeight: 700, marginBottom: 4 }}>{X.notiz}</div><div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{x.notiz}</div></div>}
      {photos.some((p) => p.inPdf) && (
        <div style={{ marginTop: 16 }}><h3 style={{ margin: "0 0 8px" }}>{X.fotos}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{photos.filter((p) => p.inPdf).map((p) => <Thumb key={p.id} p={p} land={land} />)}</div>
        </div>
      )}

      {prices && (
        <>
          <button className="pbtn green" disabled={!!busy} onClick={() => void share(true)}>✉️ {busy || t("shareByMail")}
            {x.kundeEmail ? <span style={{ display: "block", fontSize: 12, fontWeight: 500, opacity: 0.9, marginTop: 2 }}>{t("toWord")} {x.kundeEmail}</span> : null}
            {v.colibriFile ? <span style={{ display: "block", fontSize: 12, fontWeight: 500, opacity: 0.9, marginTop: 2 }}>📎 {t("kvaPlusScan")}</span> : null}</button>
          <button className="pbtn sec" disabled={!!busy} onClick={() => void share(false)}>📄 {t("savePdf")}</button>
        </>
      )}
      {f.can("vehicules.changer_statut") && (
        <button className="pbtn ghost" onClick={async () => { if (toRepair) { await setStatus(f.mut, v.id, "reparatur"); toast(`🔧 ${t("movedToRepair")}`); } else { setStatusDlg(true); } }}>
          {toRepair ? `🔧 ${t("moveToRepair")}` : `↩ ${t("changeStatus")}`}
        </button>
      )}
      {prices && <button className="pbtn sec" onClick={() => { const txt = kvaPlainText(doc, c); (navigator.clipboard?.writeText(txt) ?? Promise.reject()).then(() => toast(t("copiedText")), () => window.alert(txt)); }}>📋 {t("copyText")}</button>}
      {prices && photos.length > 0 && (
        <button className="pbtn sec" disabled={!!busy} onClick={async () => {
          setBusy(t("preparing"));
          try { await shareOrDownload(await buildRepairReport(f.db, f.engine, v, f.refs), `${land === "ES" ? "Informe_reparacion" : "Fotobericht_Reparatur"}_${String(x.kennzeichen || "").replace(/[^A-Za-z0-9]+/g, "-")}.pdf`, "application/pdf"); }
          catch (err) { toast(`${t("pdfFailed")}: ${(err as Error).message}`); }
          setBusy("");
        }}>📷 {t("repairReport")}</button>
      )}
      {statusDlg && <StatusDialog ids={[v.id]} current={v.statut} onClose={() => setStatusDlg(false)} />}
    </div>
  );
}
