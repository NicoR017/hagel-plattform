import { useEffect, useState } from "react";

type Toast = { id: number; msg: string };
let items: Toast[] = [];
let nextId = 1;
const subs = new Set<() => void>();

export function toast(msg: string, ms = 3500) {
  const id = nextId++;
  items = [...items, { id, msg }];
  subs.forEach((f) => f());
  setTimeout(() => { items = items.filter((t) => t.id !== id); subs.forEach((f) => f()); }, ms);
}

export function Toasts() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return <>{items.map((t) => <div key={t.id} className="toastbox" role="status">{t.msg}</div>)}</>;
}
