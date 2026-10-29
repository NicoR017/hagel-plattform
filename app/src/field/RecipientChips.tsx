import { useState } from "react";
import { t } from "../i18n";
import { addRecipients, MAX_RECIPIENTS, type RecipientChip, type RecipientError } from "../recipients";

/** State of the editable recipient list: chips, the text being typed and the last error. `commit` adds the typed text and returns the final list. */
export function useRecipientEditor(defaults: RecipientChip[] | null) {
  const [custom, setCustom] = useState<RecipientChip[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<RecipientError>(null);
  const list = custom ?? defaults ?? [];
  const pending = addRecipients(list, draft);
  const take = (text: string, base: RecipientChip[]) => {
    const r = addRecipients(base, text);
    setCustom(r.list); setDraft(r.rest); setError(r.error);
    return r;
  };
  return {
    list, draft, error,
    type: (text: string) => { if (/[\s,;]/.test(text)) take(text, list); else { setDraft(text); setError(null); } },
    add: () => { if (draft.trim()) take(draft, list); },
    remove: (email: string) => { setCustom(list.filter((x) => x.email !== email)); setError(null); },
    reset: () => { setCustom(null); setDraft(""); setError(null); },
    /** the list to send: the chips plus the valid typed text; null if something typed is invalid or over the limit */
    commit: (): RecipientChip[] | null => (pending.rest ? null : pending.list),
    blocked: pending.rest !== "" || pending.list.length === 0,
    changed: custom !== null,
  };
}

/** Chips with a remove button and a free input (Enter, comma, semicolon, space or leaving the field adds). */
export function RecipientChips({ ed }: { ed: ReturnType<typeof useRecipientEditor> }) {
  const src = (s?: string) => (s === "bodyshop" ? t("v10SrcBodyshop") : s === "insurer" ? t("v10SrcInsurer") : "");
  return (
    <div className="rcpt">
      <div className="chips">
        {ed.list.map((r) => (
          <span key={r.email} className="pill">
            <span>{r.email}{r.source && <small className="rcpt-src"> {src(r.source)}{r.name ? ` · ${r.name}` : ""}</small>}</span>
            <button type="button" aria-label={`${t("delete")} ${r.email}`} onClick={() => ed.remove(r.email)}>✕</button>
          </span>
        ))}
      </div>
      <input className={ed.error === "bad" ? "rcpt-bad" : ""} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" value={ed.draft} placeholder={t("v10AddPlaceholder")}
        aria-invalid={ed.error === "bad"} onChange={(e) => ed.type(e.target.value)} onBlur={ed.add} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ed.add(); } }} />
      {ed.error === "bad" && <div className="rcpt-err">{t("v10BadEmail")}</div>}
      {ed.error === "max" && <div className="rcpt-err">{t("v10MaxRecipients").replace("{n}", String(MAX_RECIPIENTS))}</div>}
      {ed.list.length === 0 && !ed.draft.trim() && <div className="rcpt-err">{t("v10NeedOne")}</div>}
    </div>
  );
}
