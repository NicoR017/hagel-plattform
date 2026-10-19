import vocab from "./colibri_vocabulary.json";
import type { TextItem } from "./pdf";

export const SIZES = [10, 20, 30, 40, 50, 60, 70, 80] as const;
export const SIZES_IMP = [10, 20, 30, 40, 50, 60, 70, 80, 100] as const;

const CW = vocab.component_words as Record<string, string[]>;
const HEADKEYS = vocab.header_keys as Record<string, string[]>;
const TOTALW = vocab.total_words as string[];
const HEAD: Record<string, string> = {};
Object.keys(HEADKEYS).forEach((k) => HEADKEYS[k].forEach((w) => (HEAD[w] = k)));

export function normComp(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Component name (any of DE/EN/ES/FR/IT/PT/NL) -> panel key, or null. */
export function colibriKey(raw: string): string | null {
  const t = normComp(raw).split(" ").filter(Boolean);
  if (!t.length) return null;
  const has = (k: string) => t.some((w) => CW[k].includes(w));
  const side = has("left") ? "l" : has("right") ? "r" : null;
  const rear = has("rear"), quarter = t.includes("quarter") || t.includes("seitenwand");
  if (has("spar")) return side ? "dachholm_" + side : null;
  if (has("trunk")) return has("lower") ? "heck_u" : "heck";
  if (has("door") && !has("trunk")) {
    if (!side) return null;
    return "tuer_" + (rear ? "h" : "v") + side;
  }
  if (has("hood")) return "haube";
  if (has("roof")) return "dach";
  if (has("fender")) {
    if (!side) return null;
    return rear || quarter ? "sw_h" + side : "kfl_v" + side;
  }
  return null;
}

export interface ColibriPanel { dents: Record<string, number>; big: number }
export interface ColibriParse {
  panels: Record<string, ColibriPanel>;
  head: Partial<Record<"kennzeichen" | "fin" | "datum" | "marke" | "modell" | "kunde" | "method" | "sprache", string>>;
  found: number;
  unknown: string[];
  rowSum: number;
  reportTotal: number | null;
  imported: number;
}

export function parseColibri(pages: TextItem[][]): ColibriParse {
  const out: ColibriParse = { panels: {}, head: {}, found: 0, unknown: [], rowSum: 0, reportTotal: null, imported: 0 };
  pages.forEach((items) => {
    // Header: label, value directly below at the same x (and not another label)
    items.forEach((it) => {
      const k = HEAD[normComp(it.s)] as keyof ColibriParse["head"] | undefined;
      if (!k || out.head[k]) return;
      let best: TextItem | null = null;
      items.forEach((o) => {
        if (o === it || Math.abs(o.x - it.x) > 4) return;
        if (o.y >= it.y || it.y - o.y > 26) return;
        if (!best || o.y > best.y) best = o;
      });
      const b = best as TextItem | null;
      if (b && !HEAD[normComp(b.s)]) out.head[k] = b.s;
    });
    // Report total ("All: 503 Ø: 30mm" / "Alle: …" / "Todos: …")
    items.forEach((it) => {
      const m = /^[^\d:]{2,14}:\s*(\d+)\s*[ØΦ∅ø]/.exec(it.s);
      if (m && out.reportTotal == null) out.reportTotal = +m[1];
    });
    // Column grid
    const cols: Record<number, number> = {};
    items.forEach((it) => {
      const z = it.s.replace(/\s/g, "").toLowerCase();
      const m = /^(10|20|30|40|50|60|70|80|100)mm$/.exec(z);
      if (m) cols[+m[1]] = it.x;
    });
    if (!Object.keys(cols).length) return;
    const minCol = Math.min(...Object.values(cols));
    const rows: Record<number, TextItem[]> = {};
    items.forEach((it) => {
      const k = Math.round(it.y);
      (rows[k] = rows[k] || []).push(it);
    });
    Object.keys(rows).forEach((k) => {
      const grp = rows[+k];
      const name = grp.filter((i) => i.x < minCol - 8).sort((a, b) => a.x - b.x).map((i) => i.s).join(" ").trim();
      if (!name) return;
      const nums = grp.filter((i) => i.x >= minCol - 8 && /^\d+$/.test(i.s));
      const dents: Record<string, number> = {};
      let big = 0, any = false, sum = 0;
      SIZES_IMP.forEach((sz) => {
        const cx = cols[sz];
        if (cx == null) return;
        const cell = nums.find((i) => Math.abs(i.x - cx) < 7);
        if (!cell) return;
        const n = parseInt(cell.s, 10);
        if (!n) return;
        any = true;
        sum += n;
        if (sz === 100) big += n;
        else dents[sz] = (dents[sz] || 0) + n;
      });
      if (!any) return;
      out.rowSum += sum;
      const key = colibriKey(name);
      if (!key) {
        out.unknown.push(name + " (" + sum + ")");
        return;
      }
      out.found++;
      const prev = out.panels[key] || { dents: {}, big: 0 };
      SIZES.forEach((sz) => {
        if (dents[sz]) prev.dents[sz] = (prev.dents[sz] || 0) + dents[sz];
      });
      prev.big += big;
      out.panels[key] = prev;
    });
  });
  out.imported = Object.values(out.panels).reduce(
    (a, p) => a + Object.values(p.dents).reduce((x, y) => x + y, 0) + (p.big || 0),
    0,
  );
  return out;
}

/** "dd.mm.yyyy" -> "yyyy-mm-dd" */
export function colibriDate(s: string | undefined): string | null {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || ""));
  if (!m) return null;
  return m[3] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0");
}
