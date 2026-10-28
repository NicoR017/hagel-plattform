import { useEffect, useId, useMemo, useRef, useState } from "react";
import { t } from "../i18n";

export interface PickItem {
  id: string;
  title: string;
  /** grey second line */
  sub?: string;
  /** small tag on the right */
  tag?: string;
  /** more words that are searched but not shown (e-mail, address ...) */
  search?: (string | undefined)[];
  /** lower comes first among equal matches (e.g. 0 = "works here") */
  rank?: number;
}
export interface Chosen { id: string; label: string; sub?: string }

const MAX_RESULTS = 8;
const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** every typed word (any order, case and accents ignored) must appear in the item */
export function pickFilter(items: PickItem[], q: string, taken: Set<string> = new Set()): PickItem[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  return items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => !taken.has(it.id) && (!words.length || words.every((w) => norm([it.title, it.sub, ...(it.search ?? [])].filter(Boolean).join(" ")).includes(w))))
    .sort((a, b) => (a.it.rank ?? 1) - (b.it.rank ?? 1) || a.i - b.i)
    .slice(0, MAX_RESULTS)
    .map(({ it }) => it);
}

/**
 * Search combobox (single or multiple choice): type to filter, ↑ ↓ Enter Esc, the chosen values stand in a green box with ✕.
 * `onFree` (optional) adds an entry "Use “typed text”" for names that are not in the list.
 */
export function Picker({ items, chosen, onAdd, onRemove, onFree, multi = false, placeholder, hint, disabled, id }: {
  items: PickItem[]; chosen: Chosen[]; onAdd: (item: PickItem) => void; onRemove: (id: string) => void; onFree?: (text: string) => void;
  multi?: boolean; placeholder?: string; hint?: string; disabled?: boolean; id?: string;
}) {
  const uid = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const taken = useMemo(() => new Set(chosen.map((c) => c.id)), [chosen]);
  const found = useMemo(() => pickFilter(items, q, multi ? taken : new Set()), [items, q, taken, multi]);
  const typed = q.trim();
  const freeOffer = !!onFree && typed.length > 0 && !items.some((i) => norm(i.title) === norm(typed));
  const rows = found.length + (freeOffer ? 1 : 0);
  const hideInput = !multi && chosen.length > 0;

  useEffect(() => { setAct(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (i: number) => {
    if (i < found.length) onAdd(found[i]);
    else if (freeOffer) onFree!(typed);
    setQ(""); if (!multi) setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAct((a) => (rows ? (a + 1) % rows : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setAct((a) => (rows ? (a - 1 + rows) % rows : 0)); }
    else if (e.key === "Enter") { if (open && rows) { e.preventDefault(); pick(act); } }
    else if (e.key === "Escape") { if (open) { e.stopPropagation(); setOpen(false); } }
  };
  const lb = `${uid}-lb`;

  return (
    <div className="pk" ref={box}>
      {chosen.length > 0 && (
        <div className="pk-chosen">
          {chosen.map((c) => (
            <span key={c.id} className="pk-val">
              <span><b>{c.label}</b>{c.sub ? <small>{c.sub}</small> : null}</span>
              {!disabled && <button type="button" aria-label={`${t("pkRemove")}: ${c.label}`} onClick={() => onRemove(c.id)}>✕</button>}
            </span>
          ))}
        </div>
      )}
      {!hideInput && (
        <input id={id} className="pk-in" type="search" autoComplete="off" disabled={disabled} value={q} placeholder={placeholder}
          role="combobox" aria-expanded={open} aria-controls={lb} aria-autocomplete="list" aria-activedescendant={open && rows ? `${uid}-o${act}` : undefined} aria-label={placeholder}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} />
      )}
      {!hideInput && open && (
        <ul id={lb} role="listbox" className="pk-list">
          {found.map((it, i) => (
            <li key={it.id} id={`${uid}-o${i}`} role="option" aria-selected={i === act} className={i === act ? "act" : ""}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setAct(i)} onClick={() => pick(i)}>
              <span><b>{it.title}</b>{it.sub ? <small>{it.sub}</small> : null}</span>
              {it.tag ? <em>{it.tag}</em> : null}
            </li>
          ))}
          {freeOffer && (
            <li id={`${uid}-o${found.length}`} role="option" aria-selected={act === found.length} className={"free" + (act === found.length ? " act" : "")}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setAct(found.length)} onClick={() => pick(found.length)}>
              <span><b>{t("pkUse").replace("{q}", typed)}</b></span>
            </li>
          )}
          {!rows && <li className="none" role="presentation">{typed ? t("pkNoMatch").replace("{q}", typed) : hint ?? "—"}</li>}
          {!typed && rows > 0 && hint && <li className="hint" role="presentation">{hint}</li>}
        </ul>
      )}
    </div>
  );
}
