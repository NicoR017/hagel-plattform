import { useEffect, useState } from "react";

export interface ToastAction { label: string; run: () => void | Promise<void> }
type Toast = { id: number; msg: string; action?: ToastAction };
let items: Toast[] = [];
let nextId = 1;
const subs = new Set<() => void>();

/** A message that disappears after `ms`; with `action` it carries a button (e.g. "Rückgängig"). */
export function toast(msg: string, ms = 3500, action?: ToastAction) {
  const id = nextId++;
  items = [...items, { id, msg, action }];
  subs.forEach((f) => f());
  setTimeout(() => { items = items.filter((t) => t.id !== id); subs.forEach((f) => f()); }, ms);
}

export function Toasts() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const drop = (id: number) => { items = items.filter((x) => x.id !== id); subs.forEach((f) => f()); };
  return (
    <>
      {items.map((t) => (
        <div key={t.id} className="toastbox" role="status">
          {t.msg}
          {t.action && <button className="toastact" onClick={() => { const a = t.action!; drop(t.id); void a.run(); }}>{t.action.label}</button>}
        </div>
      ))}
    </>
  );
}
