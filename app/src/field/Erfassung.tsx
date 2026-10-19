import { useMemo, useState } from "react";
import { computeShares, computeVehicle, vehicleSettings, type CalcVehicle, type Panel } from "@hagel/calc";
import { eur, esFormula, esRange, h1, hA, num } from "@hagel/documents";
import { t } from "../i18n";
import type { LocalVehicle } from "../sync/db";
import { setHeader, setPanel } from "../sync/mutations";
import { CarSvg } from "./CarSvg";
import { GlassDialog, PanelDialog, panelName } from "./Panel";
import { useField } from "./store";

export function Erfassung({ v }: { v: LocalVehicle }) {
  const f = useField();
  const [panel, setPanelKey] = useState<string | null>(null);
  const [glass, setGlass] = useState<"ws" | "rs" | null>(null);
  const cv = v as unknown as CalcVehicle & { glass?: Record<string, { on?: boolean; eur?: number }> };
  const c = useMemo(() => computeVehicle(cv, f.calc), [v, f.calc]); // eslint-disable-line react-hooks/exhaustive-deps
  const vs = vehicleSettings(cv, f.calc);
  const prices = f.can("prix.voir"), split = f.can("repartition_interne.voir");
  const e = c.es;
  const editable = f.can("vehicules.modifier");
  const a = split ? computeShares(v as never, c) : null;
  const pmap = (v.panels ?? {}) as Record<string, Panel>;

  return (
    <div style={{ padding: "14px 14px 8px" }}>
      <CarSvg panels={pmap} glass={cv.glass} onPanel={(k) => editable && setPanelKey(k)} onGlass={(k) => editable && f.can("prix.voir") && setGlass(k)} />
      {e && e.bollos > 0 && (
        <div style={{ background: "var(--bg)", borderRadius: 14, padding: "12px 14px", marginTop: 10, fontSize: 13, lineHeight: 1.55 }}>
          <div className="row"><b style={{ fontSize: 15 }}>{e.bollos} Bollos → {t("cat")} {e.cat.cat}</b>{prices && <b style={{ fontSize: 15, color: "var(--greenDk)" }}>{eur(e.matrixEur)}</b>}</div>
          <div className="muted">{e.small} {t("upTo30")} + {e.large} {t("over30")} × 2 · {t("cat")} {e.cat.cat} = {esRange(e.cat)} Bollos, {t("cap")} {h1(e.cat.cap_h)}</div>
          {prices && <div className="muted">{esFormula(e, "de")}</div>}
          {e.adj.map((x, i) => <div key={i} className="row"><span>{x.de}</span><span>{x.h > 0 ? "+" : "−"} {hA(Math.abs(x.h))}{prices ? ` · ${x.h > 0 ? "+" : "−"}${eur(Math.abs(x.h * e.rate))}` : ""}</span></div>)}
          {a && <div className="muted" style={{ marginTop: 4 }}>{t("internal")}: {a.techName || t("technician")} {num(a.techPct, 1)} % = {eur(a.techEur)}{a.demTechEur ? ` · De/Re ${a.demTechName} ${eur(a.demTechEur)}` : ""} · {t("commissionWord")} {eur(a.werkEur)} · PDR {eur(a.rest)}</div>}
        </div>
      )}
      {c.glass.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {c.glass.map((g) => <div key={g.k} className="row" style={{ background: "#fbecea", borderRadius: 10, padding: "8px 12px", marginBottom: 6, color: "var(--brick)", fontWeight: 700, fontSize: 13 }}><span>🔧 {g.k === "ws" ? t("glassWsLine") : t("glassRsLine")}</span><span>{g.eur > 0 ? eur(g.eur) : t("amountOpen")}</span></div>)}
        </div>
      )}
      <div className="summary">
        <span>{prices ? `⚠ ${eur(c.netto)}` : "⚠"}</span><span style={{ fontSize: 13 }}>≡ {c.panelCount}</span><span style={{ fontSize: 13 }}>{c.dents} {t("dentsWord")} · Ø {c.avg}</span>
      </div>
      {c.panels.length === 0 && <div style={{ textAlign: "center", color: "var(--sub)", padding: "16px 0 26px" }}>{t("tapPanelHint")}</div>}
      {c.panels.map((p) => (
        <div key={p.key} className="panelcard" role="button" tabIndex={0} onClick={() => editable && setPanelKey(p.key)}>
          <div className="row"><span style={{ fontWeight: 800, fontSize: 16, textTransform: "uppercase" }}>{panelName(p.key)}</span></div>
          <div style={{ height: 1, background: "var(--line)", margin: "8px 0" }} />
          <div className="row">
            <div>{e ? <><div style={{ fontWeight: 700 }}>{p.bollos} Bollos</div><div className="muted" style={{ fontSize: 12 }}>{p.small} + {p.large}×2</div></>
              : <><div style={{ fontWeight: 700 }}>AW {num(p.repair)}</div>{prices && <div style={{ color: "var(--greenDk)", fontWeight: 700 }}>{eur(p.repair * c.euroPerAW)}</div>}</>}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {p.alu && <span className="badge">Alu</span>}{p.kleber && p.method !== "erneuern" && <span className="badge">{t("glueBadge")}</span>}
              {p.method === "ptp" && <span className="badge">PTP −40%</span>}{p.method === "erneuern" && <span className="badge">{t("m.erneuern")}</span>}
            </div>
            <div style={{ fontWeight: 700 }}>{p.total} <span className="muted">· Ø {p.avgClass}</span>{(p.big || 0) > 0 && <div style={{ fontSize: 11, color: "var(--brick)", fontWeight: 700 }}>+{p.big} &gt; 85 mm</div>}</div>
          </div>
        </div>
      ))}
      {panel && (
        <PanelDialog panelKey={panel} panel={pmap[panel]} land={cv.land === "ES" ? "ES" : "DE"} teiler={vs.teiler} rate={vs.stundensatz} canPrice={prices}
          onSave={(p) => void setPanel(f.mut, v.id, panel, p as Record<string, unknown> | null)} onClose={() => setPanelKey(null)} />
      )}
      {glass && (
        <GlassDialog k={glass} value={cv.glass?.[glass]} onClose={() => setGlass(null)}
          onSave={(g) => void setHeader(f.mut, v.id, { glass: { ...(cv.glass ?? {}), [glass]: g } })} />
      )}
    </div>
  );
}
