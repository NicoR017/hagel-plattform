import { useState } from "react";
import { t } from "../../shared/i18n";
import type { LocalVehicle } from "../../shared/sync/db";
import { addPart, removePart, setParts } from "../../shared/sync/mutations";
import { useField } from "../../shared/store";
import { hasPartsList, partsOfVehicle, zoneLabel } from "./partsLogic";

/** quick picks of the OLD list (cars of a user without the parts list: no right to see parts / older server), by the vehicle's country */
const QUICK = {
  DE: ["Zierleiste Dach li", "Dachreling", "Emblem Heckklappe", "Antenne", "Clips Verkleidung"],
  ES: ["Moldura techo izq.", "Barras de techo", "Emblema portón", "Antena", "Clips de revestimiento"],
} as const;

/**
 * "Spare parts" of the car: every part with its zone and quantity, parts added without a zone, no price (the parts are ordered and billed through the body shop).
 * The parts of a zone are chosen in the element sheet (tab "Parts to replace"). Without the parts list (no right / older server) the old free-text list is shown.
 */
export function PartsBox({ v, readOnly }: { v: LocalVehicle; readOnly?: boolean }) {
  const f = useField();
  const [draft, setDraft] = useState("");
  const edit = f.can("vehicules.modifier") && !readOnly;
  if (!hasPartsList(v as { parts?: never })) return <OldPartsBox v={v} edit={edit} />;
  const parts = partsOfVehicle(v as { parts?: never });
  const custom = f.refs?.parts?.zones ?? [];
  const canEdit = edit && f.can("pieces.voir");
  return (
    <div className="partsbox" style={{ marginTop: 14, background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ fontWeight: 800 }}>🔩 {t("f2BoxTitle")}{parts.length > 0 && <span className="muted" style={{ fontWeight: 400 }}> · {t("f2PartsOf").replace("{n}", String(parts.length))}</span>}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("f2BoxHint")}</div>
      {!parts.length && <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>{t("f2BoxNone")}</div>}
      {parts.length > 0 && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {parts.map((p) => (
            <li key={p.id} className="row" style={{ background: p.source === "replace" ? "#fbecea" : "#EAF2FF", borderRadius: 10, padding: "6px 8px 6px 12px", fontWeight: 600, gap: 8 }}>
              <span style={{ flex: 1 }}>{p.name}{p.qty > 1 ? ` × ${p.qty}` : ""}<span className="muted" style={{ display: "block", fontWeight: 400, fontSize: 12 }}>{p.zoneKey ? zoneLabel(p.zoneKey, custom) : t("f2BoxZone")}{p.oemRef ? ` · OEM ${p.oemRef}` : ""}</span></span>
              {canEdit && p.source !== "replace" && <button className="chip" style={{ minHeight: 40, minWidth: 44 }} aria-label={`${t("f2Remove")}: ${p.name}`} onClick={() => void removePart(f.mut, v.id, p.id)}>✕</button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form style={{ display: "flex", gap: 8, marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); const s = draft.trim(); if (s) { void addPart(f.mut, v.id, { zoneKey: null, catalogId: null, name: s, source: "manual" }); setDraft(""); } }}>
          <input className="inp" style={{ flex: 1 }} value={draft} maxLength={120} placeholder={t("f2BoxAddPh")} onChange={(e) => setDraft(e.target.value)} />
          <button className="chip on" type="submit" disabled={!draft.trim()} style={{ minWidth: 100, minHeight: 44 }}>{t("f2PartsAdd")}</button>
        </form>
      )}
    </div>
  );
}

/** the former box ("Zu ersetzende Teile": labels typed one by one, in the vehicle header) */
function OldPartsBox({ v, edit }: { v: LocalVehicle; edit: boolean }) {
  const f = useField();
  const [draft, setDraft] = useState("");
  const parts: string[] = Array.isArray((v as Record<string, unknown>).partsToReplace) ? ((v as Record<string, unknown>).partsToReplace as string[]) : [];
  const land: "DE" | "ES" = (v as Record<string, unknown>).land === "ES" ? "ES" : "DE";
  const has = (p: string) => parts.some((x) => x.toLowerCase() === p.toLowerCase());
  const save = (next: string[]) => { if (edit) void setParts(f.mut, v.id, next); };
  const add = (p: string) => { const s = p.trim(); if (s && !has(s) && parts.length < 40) save([...parts, s.slice(0, 80)]); };
  return (
    <div className="partsbox" style={{ marginTop: 14, background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ fontWeight: 800 }}>🔩 {t("v4PartsTitle")}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("v4PartsHint")}</div>
      {parts.length > 0 && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {parts.map((p) => (
            <li key={p} className="row" style={{ background: "#FDF0E1", borderRadius: 10, padding: "6px 8px 6px 12px", color: "#8A4A06", fontWeight: 600 }}>
              <span>{p}</span>
              {edit && <button className="chip" style={{ minHeight: 36, padding: "4px 10px" }} aria-label={`${t("delete")}: ${p}`} onClick={() => save(parts.filter((x) => x !== p))}>✕</button>}
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <>
          <form style={{ display: "flex", gap: 8, marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); add(draft); setDraft(""); }}>
            <input className="inp" style={{ flex: 1 }} value={draft} maxLength={80} placeholder={t("v4PartsPlaceholder")} onChange={(e) => setDraft(e.target.value)} />
            <button className="chip on" type="submit" disabled={!draft.trim()} style={{ minWidth: 110 }}>{t("v4Add")}</button>
          </form>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {QUICK[land].filter((q) => !has(q)).map((q) => <button key={q} className="chip" style={{ minHeight: 36, padding: "6px 10px" }} onClick={() => add(q)}>+ {q}</button>)}
          </div>
        </>
      )}
    </div>
  );
}
