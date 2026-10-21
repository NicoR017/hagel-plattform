import { useState } from "react";
import { t } from "../i18n";
import type { LocalVehicle } from "../sync/db";
import { setParts } from "../sync/mutations";
import { useField } from "./store";

/** quick picks, by the vehicle's country (the label is stored as typed, no price is attached) */
const QUICK = {
  DE: ["Zierleiste Dach li", "Dachreling", "Emblem Heckklappe", "Antenne", "Clips Verkleidung"],
  ES: ["Moldura techo izq.", "Barras de techo", "Emblema portón", "Antena", "Clips de revestimiento"],
} as const;

/** "Zu ersetzende Teile": labels entered one by one, plus quick picks; printed on the KVA, no price. */
export function PartsBox({ v }: { v: LocalVehicle }) {
  const f = useField();
  const [draft, setDraft] = useState("");
  const parts: string[] = Array.isArray((v as Record<string, unknown>).partsToReplace) ? ((v as Record<string, unknown>).partsToReplace as string[]) : [];
  const land: "DE" | "ES" = (v as Record<string, unknown>).land === "ES" ? "ES" : "DE";
  const edit = f.can("vehicules.modifier");
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
