import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../../api";
import { t } from "../../shared/i18n";

export function useLoad<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const reload = useCallback(async () => {
    if (!path) { setData(null); return; } // "" = nothing to load (no right to see it, or not known yet)
    try { setData(await api<T>("GET", path)); setErr(""); } catch (e) { setErr((e as Error).message); }
  }, [path]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload, ...deps]);
  return { data, err, reload };
}

export function Err({ msg }: { msg: string }) { return msg ? <div className="err">{msg}</div> : null; }
export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return <div className="card">{(title || actions) && <div className="row"><h3 className="grow" style={{ margin: 0 }}>{title}</h3>{actions}</div>}{children}</div>;
}

/** Centred pop-up for the edit forms of the administration: no scrolling down the page to reach the form. Closes with Escape, the ✕ or a click beside it. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onClose]);
  return (
    <div className="admin-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="admin-modal-box" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row" style={{ flexWrap: "nowrap" }}><h3 className="grow" style={{ margin: 0 }}>{title}</h3><button className="btn sec" style={{ width: "auto", flex: "none" }} onClick={onClose} aria-label={t("close")}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

export async function act(fn: () => Promise<unknown>, setErr: (m: string) => void, done?: () => void) {
  try { await fn(); setErr(""); done?.(); } catch (e) { setErr((e as Error).message); }
}

/** search: every word typed must appear (case and accents ignored) in one of the fields */
export const matches = (q: string, fields: (string | null | undefined)[]): boolean => {
  const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hay = norm(fields.filter(Boolean).join(" "));
  return norm(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};
