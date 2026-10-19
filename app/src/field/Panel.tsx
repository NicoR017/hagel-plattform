import { useState } from "react";
import { PANEL_MAP, SIZES, lookupAW, panelBollos, panelRepairAW, panelStats, teilerVals, type Panel } from "@hagel/calc";
import { eur, num } from "@hagel/documents";
import { t, tOr } from "../i18n";
import { Dialog, Field, NumInput, ToggleRow } from "./ui";

export const panelName = (key: string) => tOr("pn." + key, PANEL_MAP[key]?.de ?? key);

type Draft = Required<Pick<Panel, "dents" | "alu" | "kleber" | "method" | "finish" | "awManual" | "big" | "bigEur">> & { baseAW: number | null; key: string };

export function PanelDialog({ panelKey, panel, land, teiler, rate, canPrice, onSave, onClose }: {
  panelKey: string; panel: Panel | undefined; land: "DE" | "ES"; teiler: number; rate: number; canPrice: boolean;
  onSave: (p: Panel | null) => void; onClose: () => void;
}) {
  const ES = land === "ES";
  const [d, setD] = useState<Draft>({
    key: panelKey, dents: { ...(panel?.dents ?? {}) }, alu: !!panel?.alu, kleber: !!panel?.kleber, method: panel?.method ?? "sanft", finish: panel?.finish ?? true,
    awManual: !!panel?.awManual, baseAW: panel?.baseAW ?? null, big: panel?.big ?? 0, bigEur: panel?.bigEur ?? 0,
  });
  const def = PANEL_MAP[panelKey];
  const st = panelStats(d);
  const baseAuto = lookupAW(teiler, def.orientation, st.total, st.avgClass);
  const base = d.awManual && d.baseAW != null ? d.baseAW : baseAuto;
  const rep = panelRepairAW({ ...d, awManual: true, baseAW: base }, teiler);
  const euroPerAW = rate / teiler;
  const tv = teilerVals(teiler);
  const bol = panelBollos(d);
  const setN = (s: number, n: number) => setD((x) => ({ ...x, dents: { ...x.dents, [String(s)]: Math.max(0, n) } }));
  const finish = () => {
    const dents = Object.fromEntries(Object.entries(d.dents).filter(([, n]) => (n ?? 0) > 0)) as Record<string, number>;
    if (!Object.keys(dents).length && !d.big) { onSave(null); return; }
    const p: Panel = { key: panelKey, dents, big: d.big, bigEur: d.bigEur, alu: d.alu, kleber: d.kleber, method: d.method, finish: d.finish };
    if (d.awManual) { p.awManual = true; p.baseAW = d.baseAW ?? baseAuto; }
    onSave(p);
  };
  const stat = (a: string, b: string) => <div>{a}: <b style={{ color: "var(--text)" }}>{b}</b></div>;
  return (
    <Dialog title={<span style={{ textTransform: "uppercase" }}>{panelName(panelKey)}<div style={{ fontSize: 12, color: "var(--sub)", fontWeight: 400, textTransform: "none" }}>{def.orientation === "waagrecht" ? t("horizontalPanel") : t("verticalPanel")}</div></span>} onClose={() => { finish(); onClose(); }}>
      <div style={{ display: "flex", background: "var(--bg)", borderRadius: 14, padding: 16, marginTop: 8 }}>
        <div style={{ flex: 1, paddingRight: 14 }}>
          {ES ? (
            <>
              <div className="row" style={{ marginBottom: 9 }}><span className="muted">Bollos</span><b style={{ fontSize: 17 }}>{bol.bollos}</b></div>
              <div style={{ fontSize: 12, color: "var(--sub)", lineHeight: 1.5 }}>{t("bollosHint")}</div>
            </>
          ) : (
            <>
              {canPrice && <div className="row" style={{ marginBottom: 9 }}><span className="muted">{t("price")}</span><b style={{ fontSize: 17 }}>{eur(rep * euroPerAW)}</b></div>}
              <div className="row" style={{ marginBottom: 9 }}><span className="muted">AW</span><b style={{ fontSize: 17 }}>{num(rep)}</b></div>
              <div className="row"><span className="muted">{t("hours")}</span><b style={{ fontSize: 17 }}>{num(rep / teiler)}</b></div>
            </>
          )}
        </div>
        <div style={{ width: 1, background: "var(--line)" }} />
        <div style={{ flex: 1, paddingLeft: 14, fontSize: 13, color: "var(--sub)", lineHeight: 1.9 }}>
          {stat(t("dentsWord"), String(st.total))}{stat(t("avgSize"), `${num(st.avgX, 1)} mm`)}{stat(t("sizeClass"), `${st.avgClass || "—"} mm`)}
          {!ES && stat("BVAT-AW", num(baseAuto))}
        </div>
      </div>
      <div style={{ fontSize: 13, color: "var(--sub)", margin: "16px 0 8px" }}>{t("dentsPerClass")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {SIZES.map((s) => (
          <div key={s} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid var(--line)", borderRadius: 10, padding: "5px 6px" }}>
            <span style={{ fontWeight: 700, width: 30, textAlign: "center" }}>{s}</span>
            <button className="mini" aria-label={`${s} −`} onClick={() => setN(s, (d.dents[String(s)] ?? 0) - 1)}>−</button>
            <input aria-label={`${s} mm`} value={d.dents[String(s)] ?? 0} inputMode="numeric" style={{ width: 38, textAlign: "center", fontWeight: 800, border: "none", outline: "none", fontSize: 16 }}
              onChange={(e) => setN(s, parseInt(e.target.value) || 0)} />
            <button className="mini" aria-label={`${s} +`} onClick={() => setN(s, (d.dents[String(s)] ?? 0) + 1)}>+</button>
          </div>
        ))}
      </div>
      <div style={{ border: "1px dashed var(--brick)", borderRadius: 12, padding: "10px 12px", marginTop: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{t("bigDents")}</div>
        <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 8 }}>{ES ? t("bigHintES") : t("bigHintDE")}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="mini" onClick={() => setD((x) => ({ ...x, big: Math.max(0, x.big - 1) }))}>−</button>
          <input value={d.big} inputMode="numeric" aria-label={t("bigDents")} style={{ width: 46, textAlign: "center", fontWeight: 800, border: "1px solid var(--line)", borderRadius: 8, padding: 5 }}
            onChange={(e) => setD((x) => ({ ...x, big: Math.max(0, parseInt(e.target.value) || 0) }))} />
          <button className="mini" onClick={() => setD((x) => ({ ...x, big: x.big + 1 }))}>+</button>
          {!ES && canPrice && <NumInput value={d.bigEur || null} placeholder={t("amountEur")} onChange={(n) => setD((x) => ({ ...x, bigEur: n }))} style={{ flex: 1 }} />}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className={"seg" + (d.alu ? " on" : "")} onClick={() => setD((x) => ({ ...x, alu: !x.alu }))}>{ES ? t("aluEs") : t("aluDe")}</button>
        <button className={"seg" + (d.kleber ? " on" : "")} onClick={() => setD((x) => ({ ...x, kleber: !x.kleber }))}>{t("glue")}</button>
      </div>
      <div style={{ fontSize: 13, color: "var(--sub)", margin: "16px 0 6px" }}>{t("repairMethod")}</div>
      <div style={{ display: "flex", gap: 8 }}>
        {(["sanft", "ptp", "erneuern"] as const).map((m) => (
          <button key={m} className={"seg" + (d.method === m ? " on" : "")} style={{ lineHeight: 1.25 }} onClick={() => setD((x) => ({ ...x, method: m }))}>{t(("m." + m) as never)}{m === "erneuern" && ES ? " (−1 h)" : ""}</button>
        ))}
      </div>
      {d.method === "ptp" && <div style={{ color: "var(--brick)", fontSize: 12, marginTop: 6 }}>{ES ? t("ptpHintES") : t("ptpHintDE")}</div>}
      {!ES && (
        <>
          <ToggleRow label={`${t("finish")} (+${num(d.method !== "erneuern" && d.finish ? tv.finishPer : 0, 1)} AW)`} on={d.finish} onChange={(v) => setD((x) => ({ ...x, finish: v }))} />
          <ToggleRow label={t("manualAw")} on={d.awManual} onChange={(v) => setD((x) => ({ ...x, awManual: v, baseAW: v ? (x.baseAW ?? baseAuto) : x.baseAW }))} />
          {d.awManual && <Field label={t("manualAwValue")}><NumInput value={d.baseAW ?? baseAuto} onChange={(n) => setD((x) => ({ ...x, baseAW: n }))} max={2000} /></Field>}
        </>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="pbtn danger" style={{ width: "auto", padding: "15px 18px", marginTop: 0 }} onClick={() => { onSave(null); onClose(); }}>{t("remove")}</button>
        <button className="pbtn" style={{ marginTop: 0 }} onClick={() => { finish(); onClose(); }}>✓ {t("save")}</button>
      </div>
    </Dialog>
  );
}

export function GlassDialog({ k, value, onSave, onClose }: { k: "ws" | "rs"; value?: { on?: boolean; eur?: number }; onSave: (v: { on: boolean; eur: number }) => void; onClose: () => void }) {
  const [d, setD] = useState({ on: !!value?.on, eur: value?.eur ?? 0 });
  const save = () => { onSave(d); onClose(); };
  return (
    <Dialog title={k === "ws" ? t("windscreen") : t("rearWindow")} onClose={save}>
      <ToggleRow label={t("glassReplace")} on={d.on} onChange={(on) => setD((x) => ({ ...x, on }))} />
      <Field label={t("glassAmount")}>
        <NumInput value={d.eur || null} placeholder="450" onChange={(n) => setD({ on: n > 0 ? true : d.on, eur: n })} max={100000} />
      </Field>
      <button className="pbtn" onClick={save}>✓ {t("save")}</button>
    </Dialog>
  );
}
