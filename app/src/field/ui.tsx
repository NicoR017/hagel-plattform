import { useEffect, useState, type ReactNode } from "react";
import { t } from "../i18n";

/** Bottom-sheet dialog. Closing = tapping the backdrop or the ✕. */
export function Dialog({ title, onClose, children, center }: { title?: ReactNode; onClose: () => void; children: ReactNode; center?: boolean }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onClose]);
  return (
    <div className={"overlay" + (center ? " center" : "")} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="row" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{title}</div>
          <button className="iconbtn" onClick={onClose} aria-label={t("close")}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={"toggle" + (on ? " on" : "")} onClick={() => onChange(!on)}><span className="knob" /></button>;
}

export function ToggleRow({ label, on, onChange }: { label: ReactNode; on: boolean; onChange: (v: boolean) => void }) {
  return <div className="row" style={{ padding: "10px 0" }}><span style={{ fontSize: 14, paddingRight: 14 }}>{label}</span><Toggle on={on} onChange={onChange} /></div>;
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {options.map((o) => <button key={String(o.value)} type="button" className={"seg" + (o.value === value ? " on" : "")} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export const parseDec = (s: string): number | null => {
  const n = parseFloat(String(s).replace(",", "."));
  return Number.isNaN(n) ? null : n;
};

/** Text input that keeps its own draft and reports only valid numbers. */
export function NumInput({ value, onChange, min = 0, max, placeholder, step, style, id }: { value: number | null | undefined; onChange: (n: number) => void; min?: number; max?: number; placeholder?: string; step?: number; style?: React.CSSProperties; id?: string }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value).replace(".", ","));
  useEffect(() => { setDraft((d) => (parseDec(d) === value ? d : value == null ? "" : String(value).replace(".", ","))); }, [value]);
  return (
    <input id={id} className="inp" inputMode="decimal" step={step} value={draft} placeholder={placeholder} style={style}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parseDec(e.target.value);
        if (n != null) onChange(Math.min(max ?? Infinity, Math.max(min, n)));
      }} />
  );
}

export function Field({ label, children, hint }: { label?: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return <div className="field">{label && <label>{label}</label>}{children}{hint && <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 6 }}>{hint}</div>}</div>;
}

export function confirmDialog(msg: string): boolean { return window.confirm(msg); }
