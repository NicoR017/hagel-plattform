import { useState } from "react";
import { getLang, t } from "../../shared/i18n";
import type { LocalVehicle } from "../../shared/sync/db";
import { addPart, removePart, updatePart } from "../../shared/sync/mutations";
import { useField } from "../../shared/store";
import { catalogOfZone, catalogPartName, landLang, nameIn, partsOfVehicle } from "./partsLogic";

/**
 * Element sheet, tab "Parts to replace": the catalogue parts of this zone as a checklist with a quantity (names in the user's language, the Spanish name
 * under it on a Spanish car), plus "Other part …" free text. No price: the parts are ordered and billed through the body shop. Every tick is saved at once
 * (a part operation, works offline); it does not depend on the "Save" of the dents.
 */
export function PartsTab({ v, zone, readOnly }: { v: LocalVehicle; zone: string; readOnly?: boolean }) {
  const f = useField();
  const [draft, setDraft] = useState("");
  const refs = f.refs?.parts;
  const edit = !readOnly && f.can("vehicules.modifier") && f.can("pieces.voir");
  const lang = landLang(v as { land?: unknown });
  const mine = partsOfVehicle(v as { parts?: never }).filter((p) => p.zoneKey === zone);
  const forZone = catalogOfZone(refs, zone);
  const byCatalog = new Map(mine.filter((p) => p.catalogId).map((p) => [p.catalogId!, p]));
  const replaced = mine.find((p) => p.source === "replace");
  const free = mine.filter((p) => !p.catalogId && p.source !== "replace");
  const showEs = lang === "es";
  return (
    <div>
      {replaced && (
        <div style={{ background: "#fbecea", borderRadius: 10, padding: "8px 12px", margin: "12px 0", fontSize: 13, color: "var(--brick)" }}>
          <b>🔩 {replaced.name}</b>
          <div style={{ fontSize: 12 }}>{t("f2ReplaceNote")}</div>
        </div>
      )}
      {!forZone.length && !free.length && <div className="muted" style={{ margin: "14px 0", fontSize: 13 }}>{t("f2PartsNone")}</div>}
      <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {forZone.map((c) => {
          const on = byCatalog.get(c.id);
          return (
            <li key={c.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "8px 10px", background: on ? "#EAF2FF" : "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, fontWeight: 600 }}>
                  <input type="checkbox" style={{ width: 24, height: 24, minHeight: 0 }} disabled={!edit} checked={!!on}
                    onChange={(e) => { if (e.target.checked) void addPart(f.mut, v.id, { zoneKey: zone, catalogId: c.id, name: catalogPartName(c, v as { land?: unknown }) }); else if (on) void removePart(f.mut, v.id, on.id); }} />
                  <span>{nameIn(c.names, getLang())}
                    {showEs && c.names.es && <span className="muted" style={{ display: "block", fontWeight: 400, fontSize: 12 }}>{t("f2PartsSpanishName").replace("{name}", c.names.es)}</span>}
                  </span>
                </label>
                {on && <Qty value={on.qty} disabled={!edit} onChange={(n) => void updatePart(f.mut, v.id, on.id, { qty: n })} />}
              </div>
              {on && edit && <input className="inp" style={{ marginTop: 6 }} placeholder={t("f2PartsOem")} defaultValue={on.oemRef ?? ""} maxLength={60}
                onBlur={(e) => { const x = e.target.value.trim() || null; if (x !== (on.oemRef ?? null)) void updatePart(f.mut, v.id, on.id, { oemRef: x }); }} />}
              {on && !edit && on.oemRef && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>OEM {on.oemRef}</div>}
            </li>
          );
        })}
        {free.map((p) => (
          <li key={p.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "8px 10px", background: "#FDF0E1", display: "flex", alignItems: "center", gap: 10, minHeight: 44 }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{p.name} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· {t("f2PartsFree")}</span></span>
            <Qty value={p.qty} disabled={!edit} onChange={(n) => void updatePart(f.mut, v.id, p.id, { qty: n })} />
            {edit && <button className="chip" style={{ minHeight: 40, minWidth: 44 }} aria-label={`${t("f2Remove")}: ${p.name}`} onClick={() => void removePart(f.mut, v.id, p.id)}>✕</button>}
          </li>
        ))}
      </ul>
      {edit && (
        <form style={{ display: "flex", gap: 8, marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); const s = draft.trim(); if (s) { void addPart(f.mut, v.id, { zoneKey: zone, catalogId: null, name: s }); setDraft(""); } }}>
          <input className="inp" style={{ flex: 1 }} value={draft} maxLength={120} placeholder={`${t("f2PartsOther")} (${t("f2PartsOtherPh")})`} onChange={(e) => setDraft(e.target.value)} />
          <button className="chip on" type="submit" disabled={!draft.trim()} style={{ minWidth: 100, minHeight: 44 }}>{t("f2PartsAdd")}</button>
        </form>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{t("f2BoxHint")}</div>
    </div>
  );
}

function Qty({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} aria-label={t("f2PartsQty")}>
      <button className="mini" disabled={disabled || value <= 1} aria-label="−" onClick={() => onChange(Math.max(1, value - 1))}>−</button>
      <b style={{ minWidth: 24, textAlign: "center" }}>{value}</b>
      <button className="mini" disabled={disabled || value >= 99} aria-label="+" onClick={() => onChange(Math.min(99, value + 1))}>+</button>
    </span>
  );
}
