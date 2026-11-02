import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Scroll position of every box, by key: it survives a re-render of the page (sync, refresh) and a visit to another screen and back. */
const POS = new Map<string, number>();

/**
 * A list that shows `max` rows and scrolls inside itself (no page jump). Its height is measured from the real rows, so rows of any height work.
 * The first time it is shown it opens on row `target`; afterwards the position is kept. `ensure` brings one row into view when it changes
 * (e.g. the scan that was selected). A child with class "nowline" is not a row (it only adds its own height).
 */
export function ScrollBox({ k, max = 3, target = 0, ensure, children }: { k: string; max?: number; target?: number; ensure?: number | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const rowsOf = (b: HTMLElement) => [...b.children].filter((c) => !c.classList.contains("nowline")) as HTMLElement[];

  useLayoutEffect(() => {
    const b = ref.current;
    if (!b) return;
    const rows = rowsOf(b);
    if (rows.length <= max) { b.style.maxHeight = ""; return; }
    const top = b.getBoundingClientRect().top, last = rows[max - 1].getBoundingClientRect().bottom;
    b.style.maxHeight = `${Math.ceil(last - top + 6 + (b.querySelector(".nowline") ? 22 : 0))}px`;
    const saved = POS.get(k);
    if (saved !== undefined) { if (b.scrollTop !== saved) b.scrollTop = saved; }
    else { const r = rows[target]; b.scrollTop = r ? Math.max(0, r.offsetTop - 2) : 0; POS.set(k, b.scrollTop); }
  });

  // bring the chosen row into view (only moves when it is not fully visible)
  useLayoutEffect(() => {
    const b = ref.current;
    if (!b || ensure == null || ensure < 0) return;
    const r = rowsOf(b)[ensure];
    if (!r) return;
    if (r.offsetTop < b.scrollTop) b.scrollTop = Math.max(0, r.offsetTop - 2);
    else if (r.offsetTop + r.offsetHeight > b.scrollTop + b.clientHeight) b.scrollTop = r.offsetTop + r.offsetHeight - b.clientHeight + 2;
    POS.set(k, b.scrollTop);
  }, [ensure, k]);

  return <div ref={ref} className="rows sbx" onScroll={(e) => POS.set(k, e.currentTarget.scrollTop)}>{children}</div>;
}
