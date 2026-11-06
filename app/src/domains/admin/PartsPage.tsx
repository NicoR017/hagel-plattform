import { useState } from "react";
import type { PartLang, PartNames } from "@hagel/shared";
import { api } from "../../api";
import { getLang, t } from "../../shared/i18n";
import { confirmDialog } from "../../shared/ui";
import { allZones, nameIn, zoneLabel } from "../vehicles/partsLogic";
import { act, Card, Err, matches, Modal, useLoad } from "./shared";

interface CatPart { id: string; names: PartNames; zone_keys: string[]; translation_validated: boolean; active: boolean }
interface AdminZone { key: string; group: "exterior" | "interior"; names: PartNames; active: boolean }
interface Catalog { parts: CatPart[]; zones: AdminZone[] }
interface FreeText { name: string; lang: PartLang; count: number }
interface Form { id?: string; names: PartNames; zone_keys: string[]; validated: boolean }
const EMPTY: PartNames = { de: "", en: "", fr: "", es: "" };
const LANGS: PartLang[] = ["de", "en", "fr", "es"];
const LABEL: Record<PartLang, string> = { de: "Deutsch", en: "English", fr: "Français", es: "Español" };

/** Administration → Parts catalogue (permission pieces.catalogue): generic part names in four languages, by zone; zones; free-text parts typed by experts. */
export function PartsCatalogPage() {
  const cat = useLoad<Catalog>("/admin/parts/catalog");
  const free = useLoad<FreeText[]>("/admin/parts/free-text");
  const [f, setF] = useState<Form | null>(null);
  const [z, setZ] = useState<{ group: "exterior" | "interior"; names: PartNames } | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const custom = (cat.data?.zones ?? []).filter((x) => x.active).map((x) => ({ key: x.key, group: x.group, names: x.names }));
  const zones = allZones({ zones: custom, catalog: [] });
  const zlabel = (k: string) => zoneLabel(k, custom);
  const rows = (cat.data?.parts ?? []).filter((p) => matches(q, [p.names.de, p.names.en, p.names.fr, p.names.es, ...p.zone_keys.map(zlabel)]));

  const translate = async (from: PartLang) => {
    if (!f) return;
    const text = f.names[from].trim();
    if (!text) return;
    setBusy(true); setNote(""); setErr("");
    try {
      const r = await api<{ available: boolean; names: Partial<PartNames> }>("POST", "/admin/parts/translate", { lang: from, text });
      if (!r.available) { setNote(t("f2TranslateNone")); return; }
      setF((x) => (x ? { ...x, names: { ...x.names, ...r.names, [from]: x.names[from] }, validated: false } : x)); // a proposal: the admin checks it
    } catch { setErr(t("f2TranslateFailed")); } finally { setBusy(false); }
  };
  const open = (p: CatPart) => { setNote(""); setErr(""); setF({ id: p.id, names: { ...p.names }, zone_keys: [...p.zone_keys], validated: p.translation_validated }); };
  const save = () => {
    if (!f) return;
    if (!LANGS.some((l) => f.names[l].trim())) { setErr(t("f2NeedName")); return; }
    const body = { names: f.names, zone_keys: f.zone_keys, translation_validated: f.validated };
    void act(() => (f.id ? api("PUT", `/admin/parts/catalog/${f.id}`, body) : api("POST", "/admin/parts/catalog", body)), setErr, () => { setF(null); void cat.reload(); void free.reload(); });
  };
  const nameOf = (p: PartNames) => nameIn(p, getLang());

  return (
    <>
      <Card title={t("f2CatTitle")} actions={<button className="btn" onClick={() => { setNote(""); setErr(""); setF({ names: { ...EMPTY }, zone_keys: [], validated: false }); }}>{t("f2NewPart")}</button>}>
        <p className="muted" style={{ marginTop: 0 }}>{t("f2CatHint")}</p>
        <Err msg={cat.err} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("f2SearchParts")} aria-label={t("f2SearchParts")} style={{ marginBottom: 10 }} />
        <table>
          <thead><tr><th>{t("name")}</th><th>DE · EN · FR · ES</th><th>{t("f2Zones")}</th><th /></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} style={p.active ? undefined : { opacity: 0.55 }}>
              <td><b>{nameOf(p.names)}</b>{!p.active && <span className="pill off">{t("inactive")}</span>}{!p.translation_validated && <span className="pill" title={t("f2NotValidated")} style={{ marginLeft: 6 }}>⚠ {t("f2NotValidated")}</span>}</td>
              <td className="muted" style={{ fontSize: 12 }}>{LANGS.map((l) => p.names[l] || "—").join(" · ")}</td>
              <td>{p.zone_keys.map((k) => <span key={k} className="pill" style={{ marginRight: 4 }}>{zlabel(k)}</span>)}{!p.zone_keys.length && <span className="muted">{t("f2NoZone")}</span>}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="btn sec" onClick={() => open(p)}>{t("edit")}</button>{" "}
                {p.active
                  ? <button className="btn danger" onClick={() => { if (confirmDialog(`${t("f2DeactivateQ")}\n\n${nameOf(p.names)}`)) void act(() => api("DELETE", `/admin/parts/catalog/${p.id}`), setErr, cat.reload); }}>{t("deactivate")}</button>
                  : <button className="btn sec" onClick={() => void act(() => api("PUT", `/admin/parts/catalog/${p.id}`, { active: true }), setErr, cat.reload)}>{t("reactivate")}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
        <Err msg={err} />
      </Card>

      <Card title={t("f2Zones")} actions={<button className="btn sec" onClick={() => { setErr(""); setZ({ group: "exterior", names: { ...EMPTY } }); }}>{t("f2NewZone")}</button>}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {zones.map((x) => <span key={x.key} className="pill" style={x.group === "interior" ? { background: "#EEF1F6" } : undefined}>{x.group === "interior" ? "🛋 " : "🚗 "}{x.label}</span>)}
        </div>
        {(cat.data?.zones ?? []).length > 0 && (
          <table style={{ marginTop: 10 }}>
            <tbody>{(cat.data?.zones ?? []).map((x) => (
              <tr key={x.key}><td>{nameOf(x.names)}</td><td className="muted">{x.group === "interior" ? t("f2ZoneInterior") : t("f2ZoneExterior")}</td>
                <td><button className="btn sec" onClick={() => void act(() => api("PUT", `/admin/parts/zones/${x.key}`, { active: !x.active }), setErr, cat.reload)}>{x.active ? t("deactivate") : t("reactivate")}</button></td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      {(free.data ?? []).length > 0 && (
        <Card title={t("f2FreeTextTitle")}>
          <p className="muted" style={{ marginTop: 0 }}>{t("f2FreeTextHint")}</p>
          <table>
            <tbody>{(free.data ?? []).map((x) => (
              <tr key={`${x.name}|${x.lang}`}><td><b>{x.name}</b> <span className="muted">({x.lang.toUpperCase()})</span></td><td>{t("f2Times").replace("{n}", String(x.count))}</td>
                <td><button className="btn sec" onClick={() => { setNote(""); setErr(""); setF({ names: { ...EMPTY, [x.lang]: x.name }, zone_keys: [], validated: false }); }}>{t("f2AddToCat")}</button></td></tr>
            ))}</tbody>
          </table>
        </Card>
      )}

      {f && (
        <Modal title={f.id ? t("f2EditPart") : t("f2NewPart")} onClose={() => { setF(null); setErr(""); }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t("f2TranslateHint")}</div>
          {LANGS.map((l) => (
            <div key={l} className="row" style={{ alignItems: "flex-end" }}>
              <div className="grow"><label>{LABEL[l]}</label><input value={f.names[l]} maxLength={120} onChange={(e) => setF({ ...f, names: { ...f.names, [l]: e.target.value }, validated: false })} /></div>
              <button className="btn sec" type="button" disabled={busy || !f.names[l].trim()} onClick={() => void translate(l)}>{t("f2Translate")}</button>
            </div>
          ))}
          {note && <div className="muted" style={{ color: "var(--brick)", marginTop: 6 }}>{note}</div>}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400, marginTop: 10 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={f.validated} onChange={(e) => setF({ ...f, validated: e.target.checked })} />{t("f2Validated")}
          </label>
          <label>{t("f2Zones")}</label>
          {(["exterior", "interior"] as const).map((g) => (
            <div key={g} style={{ marginBottom: 6 }}>
              <div className="muted" style={{ fontSize: 12 }}>{g === "interior" ? t("f2ZoneInterior") : t("f2ZoneExterior")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {zones.filter((x) => x.group === g).map((x) => {
                  const on = f.zone_keys.includes(x.key);
                  return <button key={x.key} type="button" className={"chip" + (on ? " on" : "")} aria-pressed={on} onClick={() => setF({ ...f, zone_keys: on ? f.zone_keys.filter((k) => k !== x.key) : [...f.zone_keys, x.key] })}>{x.label}</button>;
                })}
              </div>
            </div>
          ))}
          <Err msg={err} />
          <p className="row modal-actions"><button className="btn" onClick={save}>{t("save")}</button><button className="btn sec" onClick={() => setF(null)}>{t("cancel")}</button></p>
        </Modal>
      )}
      {z && (
        <Modal title={t("f2NewZone")} onClose={() => { setZ(null); setErr(""); }}>
          <label>{t("f2ZoneGroup")}</label>
          <select value={z.group} onChange={(e) => setZ({ ...z, group: e.target.value as "exterior" | "interior" })}><option value="exterior">{t("f2ZoneExterior")}</option><option value="interior">{t("f2ZoneInterior")}</option></select>
          <label>{t("f2ZoneName")}</label>
          {LANGS.map((l) => <div key={l}><span className="muted" style={{ fontSize: 12 }}>{LABEL[l]}</span><input value={z.names[l]} maxLength={120} onChange={(e) => setZ({ ...z, names: { ...z.names, [l]: e.target.value } })} /></div>)}
          <Err msg={err} />
          <p className="row modal-actions"><button className="btn" onClick={() => {
            if (!LANGS.some((l) => z.names[l].trim())) { setErr(t("f2NeedName")); return; }
            void act(() => api("POST", "/admin/parts/zones", z), setErr, () => { setZ(null); void cat.reload(); });
          }}>{t("save")}</button><button className="btn sec" onClick={() => setZ(null)}>{t("cancel")}</button></p>
        </Modal>
      )}
    </>
  );
}
