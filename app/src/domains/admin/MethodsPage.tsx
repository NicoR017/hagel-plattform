import { useEffect, useMemo, useState } from "react";
import { computeVehicle, DEFAULT_AW_PARAMS, DEFAULT_SETTINGS, ES_MATRIX_DEFAULT, type CalcMethodDef, type CalcVehicle, type EsMatrix } from "@hagel/calc";
import { eur } from "@hagel/documents";
import type { ClientMethod } from "@hagel/shared";
import { api } from "../../api";
import { locale, t } from "../../shared/i18n";
import { toast } from "../../shared/toast";
import { confirmDialog } from "../../shared/ui";
import { act, Card, Err, useLoad } from "./shared";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? 0 : Number(v));

function Num({ label, value, onChange, disabled, step }: { label: string; value: number; onChange: (n: number) => void; disabled?: boolean; step?: number }) {
  return <div><label>{label}</label><input type="number" step={step ?? "any"} value={value} disabled={disabled} onChange={(e) => onChange(num(e.target.value))} /></div>;
}

function AwEditor({ p, set, ro }: { p: Json; set: (p: Json) => void; ro: boolean }) {
  const up = (path: (string | number)[], v: number) => { const n = clone(p); let o = n; for (const k of path.slice(0, -1)) o = o[k]; o[path[path.length - 1]] = v; set(n); };
  const ex = (cls: "10" | "12") => (["ruest", "greif", "finishPer", "finishCap", "hohl", "verbr"] as const).map((k) => {
    const label = { ruest: t("v6MRuest"), greif: t("v6MGreif"), finishPer: t("v6MFinishPer"), finishCap: t("v6MFinishCap"), hohl: t("v6MHohl"), verbr: t("v6MVerbr") }[k];
    return <Num key={k} label={`${label}`} value={p.extras[cls][k]} disabled={ro} onChange={(v) => up(["extras", cls, k], v)} />;
  });
  return (
    <>
      <div className="mgrid">
        <Num label={t("v6MVat")} value={p.vat} step={0.01} disabled={ro} onChange={(v) => up(["vat"], v)} />
        <Num label={t("v6MAlu")} value={p.aluFactor} step={0.05} disabled={ro} onChange={(v) => up(["aluFactor"], v)} />
        <Num label={t("v6MKleber")} value={p.kleberFactor} step={0.05} disabled={ro} onChange={(v) => up(["kleberFactor"], v)} />
        <Num label={t("v6MPtp")} value={p.ptpFactor} step={0.05} disabled={ro} onChange={(v) => up(["ptpFactor"], v)} />
      </div>
      <h4>{t("v6MExtras")} 10</h4><div className="mgrid">{ex("10")}</div>
      <h4>{t("v6MExtras")} 12</h4><div className="mgrid">{ex("12")}</div>
      <h4>{t("v6MKleberMat")}</h4>
      <div className="mgrid">
        <Num label={t("v6MUpTo2")} value={p.kleberMaterial.upTo2} disabled={ro} onChange={(v) => up(["kleberMaterial", "upTo2"], v)} />
        <Num label={t("v6MUpTo5")} value={p.kleberMaterial.upTo5} disabled={ro} onChange={(v) => up(["kleberMaterial", "upTo5"], v)} />
        <Num label={t("v6MMore")} value={p.kleberMaterial.more} disabled={ro} onChange={(v) => up(["kleberMaterial", "more"], v)} />
        <Num label={t("v6MHohlMat")} value={p.hohlraumMaterial} disabled={ro} onChange={(v) => up(["hohlraumMaterial"], v)} />
      </div>
    </>
  );
}

function MatrixEditor({ p, set, ro }: { p: { esMatrix: EsMatrix | null }; set: (p: Json) => void; ro: boolean }) {
  const m = (p.esMatrix ?? ES_MATRIX_DEFAULT) as Json;
  const put = (fn: (n: Json) => void) => { const n = clone(m); fn(n); set({ esMatrix: n }); };
  return (
    <>
      <div className="mgrid">
        <Num label={t("v6MVat")} value={m.vat} step={0.01} disabled={ro} onChange={(v) => put((n) => { n.vat = v; })} />
      </div>
      <h4>{t("v6MCategories")}</h4>
      <table className="mtab"><thead><tr><th>{t("v6MCat")}</th><th>{t("v6MFrom")}</th><th>{t("v6MTo")}</th><th>{t("v6MCap")}</th></tr></thead>
        <tbody>{m.categories.map((c: Json, i: number) => (
          <tr key={i}>
            <td><input value={c.cat} disabled={ro} onChange={(e) => put((n) => { n.categories[i].cat = e.target.value; })} /></td>
            <td><input type="number" value={c.from} disabled={ro} onChange={(e) => put((n) => { n.categories[i].from = num(e.target.value); })} /></td>
            <td><input type="number" value={c.to ?? ""} placeholder="∞" disabled={ro} onChange={(e) => put((n) => { n.categories[i].to = e.target.value === "" ? null : num(e.target.value); })} /></td>
            <td><input type="number" step="any" value={c.cap_h} disabled={ro} onChange={(e) => put((n) => { n.categories[i].cap_h = num(e.target.value); })} /></td>
          </tr>
        ))}</tbody></table>
      <h4>{t("v6MAdj")}</h4>
      <div className="mgrid">
        <Num label={t("v6MAdjAlu")} value={m.adjustments.alu_per_vehicle_h} disabled={ro} onChange={(v) => put((n) => { n.adjustments.alu_per_vehicle_h = v; })} />
        <Num label={t("v6MAdjNew")} value={m.adjustments.erneuern_per_panel_h} disabled={ro} onChange={(v) => put((n) => { n.adjustments.erneuern_per_panel_h = v; })} />
        <Num label={t("v6MAdjKleber")} value={m.adjustments.kleber_share_pct} disabled={ro} onChange={(v) => put((n) => { n.adjustments.kleber_share_pct = v; })} />
        <Num label={t("v6MAdjPtp")} value={m.adjustments.ptp_share_pct} disabled={ro} onChange={(v) => put((n) => { n.adjustments.ptp_share_pct = v; })} />
      </div>
      <h4>{t("v6MKick")}</h4>
      <table className="mtab"><tbody>{m.kickback_eur.map((k: Json, i: number) => (
        <tr key={i}>
          <td>{k.else ? t("v6MKickElse") : `${t("v6MKickUpTo")} ${k.max_h ?? k.lt_h}`}</td>
          <td><input type="number" step="any" value={k.eur} disabled={ro} onChange={(e) => put((n) => { n.kickback_eur[i].eur = num(e.target.value); })} /></td>
        </tr>
      ))}</tbody></table>
    </>
  );
}

const SAMPLE_PANELS = { haube: { key: "haube", dents: { "20": 12, "30": 6 } } };

/** Live test: the sample vehicle computed with the parameters currently on screen (what the engine would give) */
function TestCalc({ engine, country, params }: { engine: "aw" | "matrix"; country: "DE" | "ES"; params: Json }) {
  const r = useMemo(() => {
    try {
      const v = { land: country, panels: SAMPLE_PANELS, stundensatz: country === "ES" ? DEFAULT_SETTINGS.rateES : DEFAULT_SETTINGS.rateDE } as unknown as CalcVehicle;
      return computeVehicle(v, DEFAULT_SETTINGS, { engine, params } as unknown as CalcMethodDef);
    } catch { return null; }
  }, [engine, country, params]);
  return (
    <div className="testcalc">
      <b>{t("v6MTest")}</b><div className="muted">{t("v6MTestHint")}</div>
      {r ? <div className="row" style={{ gap: 24, marginTop: 6 }}><span>{t("v6MTestAw")}: <b>{(r.es?.totH ?? r.totalAW)?.toLocaleString(locale())}</b></span><span>{t("v6MTestNet")}: <b>{eur(r.netto)}</b></span></div> : <span className="muted">—</span>}
    </div>
  );
}

interface Usage { insurers: { id: string; name: string; country: string }[]; vehiclesByVersion: Record<string, number> }

export function MethodsPage() {
  const list = useLoad<ClientMethod[]>("/admin/methods");
  const [sel, setSel] = useState<string>("");
  const [ver, setVer] = useState<number>(0);
  const [draft, setDraft] = useState<Json | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const methods = (list.data ?? []).filter((m) => !m.archived);
  const m = methods.find((x) => x.id === sel) ?? methods[0];
  const usage = useLoad<Usage>(m ? `/admin/methods/${m.id}/usage` : "", [m?.id, m?.currentVersion]);
  useEffect(() => { if (m) { setVer(m.currentVersion); setDraft(null); setName(m.name); } }, [m?.id, m?.currentVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown: Json | undefined = m ? ((draft ?? (m.versions[String(ver)] as Json)) as Json) : undefined;
  const ro = !m || m.isSystem || ver !== m.currentVersion;
  const create = (body: { name: string; engine: "aw" | "matrix"; country: "DE" | "ES"; params: unknown; base_method_id: string | null }) =>
    act(async () => { const r = await api<{ id: string }>("POST", "/admin/methods", body); await list.reload(); setSel(r.id); }, setErr);
  const systemOf = (country: "DE" | "ES") => methods.find((x) => x.isSystem && x.country === country);
  return (
    <>
      <Card title={t("v6MenuMethods")} actions={<>
        <button className="btn" onClick={() => { const base = systemOf("DE"); if (base) void create({ name: `${base.name} 2`, engine: "aw", country: "DE", params: base.versions[String(base.currentVersion)], base_method_id: base.id }); }}>{t("v6MNew")} DE</button>
        <button className="btn" onClick={() => { const base = systemOf("ES"); if (base) void create({ name: `${base.name} 2`, engine: "matrix", country: "ES", params: base.versions[String(base.currentVersion)], base_method_id: base.id }); }}>{t("v6MNew")} ES</button>
      </>}>
        <Err msg={list.err || err} />
        <div className="mtabs" role="tablist">
          {methods.map((x) => <button key={x.id} role="tab" aria-selected={m?.id === x.id} className={m?.id === x.id ? "on" : ""} onClick={() => setSel(x.id)}>{x.name}{x.isSystem && <span className="pill">{t("v6MSystem")}</span>}<small>{x.country}</small></button>)}
        </div>
      </Card>
      {m && shown && (
        <Card title={m.name} actions={<span className="pill">{m.engine === "aw" ? t("v6MEngineAw") : t("v6MEngineMatrix")}</span>}>
          {m.isSystem
            ? <p className="muted" style={{ marginTop: 0 }}>{t("v6MLocked")}</p>
            : <><label>{t("v6MName")}</label><input value={name} onChange={(e) => setName(e.target.value)} /></>}
          <div className="row" style={{ marginTop: 8 }}>
            <label style={{ margin: 0 }}>{t("v6MVersion")}</label>
            <select style={{ width: "auto" }} value={ver} onChange={(e) => { setVer(Number(e.target.value)); setDraft(null); }}>
              {Object.keys(m.versions).map(Number).sort((a, b) => b - a).map((v) => <option key={v} value={v}>{v}{v === m.currentVersion ? " ●" : ""}</option>)}
            </select>
            <span className="muted">{t("v6MVersionHint")}</span>
          </div>
          {m.engine === "aw"
            ? <AwEditor p={(shown.vat != null ? shown : DEFAULT_AW_PARAMS) as Json} set={setDraft} ro={ro} />
            : <MatrixEditor p={shown as { esMatrix: EsMatrix | null }} set={setDraft} ro={ro} />}
          <TestCalc engine={m.engine} country={m.country} params={shown} />
          <Err msg={err} />
          <p className="row">
            {!m.isSystem && <button className="btn" disabled={ver !== m.currentVersion || (!draft && name === m.name)} onClick={() => act(
              () => api("PUT", `/admin/methods/${m.id}`, { name, ...(draft ? { params: draft } : {}) }), setErr, () => { setDraft(null); void list.reload(); toast(t("saved")); })}>{draft ? t("v6MSaveVersion") : t("save")}</button>}
            <button className="btn sec" onClick={() => void create({ name: `${m.name} (${t("v6MCopyOf")})`, engine: m.engine, country: m.country, params: shown, base_method_id: m.id })}>{t("v6MCopy")}</button>
            {!m.isSystem && <button className="btn danger" onClick={() => { if (confirmDialog(t("v6MArchiveQ"))) void act(() => api("POST", `/admin/methods/${m.id}/archive`), setErr, () => { setSel(""); void list.reload(); }); }}>{t("v6MArchive")}</button>}
          </p>
          <h4>{t("v6MUsedBy")}</h4>
          {usage.data?.insurers.length ? <div>{usage.data.insurers.map((i) => <span key={i.id + i.country} className="pill">{i.name} · {i.country}</span>)}</div> : <p className="muted">{t("v6MNoUse")}</p>}
          {usage.data && Object.keys(usage.data.vehiclesByVersion).length > 0 && <p className="muted">{Object.entries(usage.data.vehiclesByVersion).map(([v, n]) => `${t("v6MVersion")} ${v}: ${n} ${t("v6MVehicles")}`).join(" · ")}</p>}
        </Card>
      )}
    </>
  );
}
