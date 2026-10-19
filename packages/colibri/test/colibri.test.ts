import { describe, expect, it } from "vitest";
import { deflateSync, inflateSync } from "node:zlib";
import { applyColibri, colibriKey, colibriPages, parseColibri, scanCheck, type TextItem } from "../src";

/** NOTE: synthetic PDF (no real Colibri PDF available yet). Replace/add real fixtures when Nicolas provides them. */
const hex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");

function buildPdf(pages: TextItem[][], raw = false): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  pages.forEach((items, i) => {
    const content = items.map((it) => `BT 1 0 0 1 ${it.x} ${it.y} Tm <${hex(it.s)}> Tj ET`).join("\n");
    const body = raw ? deflateSync(Buffer.from(content, "latin1")).subarray(2, -4) : deflateSync(Buffer.from(content, "latin1"));
    parts.push(Buffer.from(`${i + 1} 0 obj\n<< /Length ${body.length} /Filter /FlateDecode >>\nstream\n`), body, Buffer.from("\nendstream\nendobj\n"));
  });
  parts.push(Buffer.from("%%EOF"));
  return Buffer.concat(parts);
}

const colX: Record<number, number> = { 10: 200, 20: 230, 30: 260, 40: 290, 50: 320, 60: 350, 70: 380, 80: 410, 100: 440 };

function page(opts: {
  head?: Record<string, [string, string]>;
  rows: [string, Record<number, number>][];
  total?: string;
  lang?: "de" | "es";
}): TextItem[] {
  const it: TextItem[] = [];
  let hx = 40;
  for (const [label, val] of Object.values(opts.head || {})) {
    it.push({ x: hx, y: 800, s: label }, { x: hx, y: 785, s: val });
    hx += 120;
  }
  if (opts.total) it.push({ x: 40, y: 740, s: opts.total });
  Object.entries(colX).forEach(([sz, x]) => it.push({ x, y: 700, s: `${sz}mm` }));
  it.push({ x: 480, y: 700, s: opts.lang === "es" ? "Total" : "Gesamt" });
  opts.rows.forEach(([name, cells], i) => {
    const y = 680 - i * 15;
    it.push({ x: 40, y, s: name });
    let sum = 0;
    Object.entries(cells).forEach(([sz, n]) => {
      it.push({ x: colX[+sz], y, s: String(n) });
      sum += n;
    });
    it.push({ x: 480, y, s: String(sum) });
  });
  return it;
}

const HEAD_DE = {
  k: ["Kennzeichen", "m-ab 1234"], f: ["FIN", "wvwzzz1jzxw000001"], d: ["Datum", "14.10.2026 09:30"],
  b: ["Automarke", "VOLKSWAGEN-GROUP"], m: ["Automodell", "GOLF"], c: ["Kunde", "Carrosserie X"],
  me: ["Berechnungsmethode", "PDR Team"], l: ["Sprache", "de"],
} as Record<string, [string, string]>;

describe("colibriKey (multilingual)", () => {
  const cases: [string, string | null][] = [
    ["Motorhaube", "haube"], ["Hood", "haube"], ["Capó", "haube"], ["Capot", "haube"],
    ["Dach", "dach"], ["Techo", "dach"], ["Roof", "dach"],
    ["Dachholm links", "dachholm_l"], ["Montante techo izq.", "dachholm_l"], ["Roof rail right", "dachholm_r"],
    ["Heckklappe", "heck"], ["Heckklappe unten", "heck_u"], ["Portón trasero", "heck"], ["Tailgate bottom", "heck_u"],
    ["Tür vorn links", "tuer_vl"], ["Tür hinten rechts", "tuer_hr"], ["Puerta del. izq.", "tuer_vl"], ["Rear door right", "tuer_hr"],
    ["Kotflügel vorn links", "kfl_vl"], ["Aleta del. dcha.", "kfl_vr"], ["Seitenwand rechts", "sw_hr"],
    ["Quarter panel left", "sw_hl"], ["Lateral tras. izq.", "sw_hl"],
    ["Tür", null], ["Stoßfänger", null], ["", null],
  ];
  for (const [raw, key] of cases) it(`${JSON.stringify(raw)} -> ${key}`, () => expect(colibriKey(raw)).toBe(key));
});

describe("colibri PDF reading + parsing", () => {
  const rows: [string, Record<number, number>][] = [
    ["Motorhaube", { 10: 5, 20: 78, 30: 27, 40: 18 }],
    ["Dach", { 20: 4, 100: 2 }],
    ["Dachholm links", { 10: 7, 20: 19 }],
    ["Tür hinten rechts", { 30: 3 }],
  ];
  const pg = page({ head: HEAD_DE, rows, total: "Alle: 163 Ø: 30mm" });

  for (const raw of [false, true]) {
    it(`extracts text from ${raw ? "raw-deflate" : "zlib"} streams`, async () => {
      const pages = await colibriPages(buildPdf([pg], raw));
      expect(pages.length).toBe(1);
      expect(pages[0].find((i) => i.s === "Motorhaube")).toBeTruthy();
    });
  }

  it("works with an injected zlib inflate (Node path)", async () => {
    const inflate = async (b: Uint8Array) => new Uint8Array(inflateSync(b));
    const pages = await colibriPages(buildPdf([pg]), inflate);
    expect(pages[0].length).toBe(pg.length);
  });

  it("parses header, rows, totals", async () => {
    const res = parseColibri(await colibriPages(buildPdf([pg])));
    expect(res.head.kennzeichen).toBe("m-ab 1234");
    expect(res.head.marke).toBe("VOLKSWAGEN-GROUP");
    expect(res.head.datum).toBe("14.10.2026 09:30");
    expect(res.reportTotal).toBe(163);
    expect(res.panels.haube.dents).toEqual({ 10: 5, 20: 78, 30: 27, 40: 18 });
    expect(res.panels.dach).toEqual({ dents: { 20: 4 }, big: 2 });
    expect(res.panels.tuer_hr.dents).toEqual({ 30: 3 });
    expect(res.unknown).toEqual([]);
    expect(res.imported).toBe(163);
    expect(res.rowSum).toBe(163);
  });

  it("collects unknown rows and flags mismatch", async () => {
    const p = page({ head: HEAD_DE, rows: [...rows, ["Stoßfänger", { 20: 3 }]], total: "Alle: 163 Ø: 30mm" });
    const res = parseColibri(await colibriPages(buildPdf([p])));
    expect(res.unknown).toEqual(["Stoßfänger (3)"]);
    expect(res.imported).toBe(163);
    expect(res.rowSum).toBe(166);
  });

  it("sums duplicate component rows across pages", async () => {
    const p2 = page({ rows: [["Motorhaube", { 10: 1 }]] });
    const res = parseColibri(await colibriPages(buildPdf([pg, p2])));
    expect(res.panels.haube.dents[10]).toBe(6);
  });

  it("reads an ES report", async () => {
    const p = page({
      lang: "es",
      head: { k: ["Matrícula", "1234 ABC"], f: ["Bastidor", "VF1ABCDEF12345678"], d: ["Fecha", "02.10.2026"], b: ["Marca", "RENAULT"], m: ["Modelo", "CLIO"] },
      rows: [["Capó", { 20: 10 }], ["Puerta del. izq.", { 30: 2 }]],
      total: "Todos: 12 Ø: 30mm",
    });
    const res = parseColibri(await colibriPages(buildPdf([p])));
    expect(res.head.kennzeichen).toBe("1234 ABC");
    expect(res.head.fin).toBe("VF1ABCDEF12345678");
    expect(res.reportTotal).toBe(12);
    expect(Object.keys(res.panels).sort()).toEqual(["haube", "tuer_vl"]);
  });

  it("returns nothing for a PDF without text streams", async () => {
    expect(await colibriPages(Buffer.from("%PDF-1.4\n%%EOF"))).toEqual([]);
    const res = parseColibri([]);
    expect(res.imported).toBe(0);
    expect(res.reportTotal).toBeNull();
  });
});

describe("applyColibri", () => {
  const now = new Date("2026-10-19T10:00:00Z");
  const parse = async () =>
    parseColibri(
      await colibriPages(
        buildPdf([
          page({
            head: HEAD_DE,
            total: "Alle: 21 Ø: 30mm",
            rows: [["Dachholm rechts", { 20: 10 }], ["Motorhaube", { 20: 5, 100: 1 }], ["Dach", { 30: 5 }]],
          }),
        ]),
      ),
    );

  it("overwrites header fields and keeps existing panel options", async () => {
    const v = applyColibri(
      { panels: { haube: { key: "haube", alu: true, bigEur: 120, method: "ptp", finish: false, dents: { 10: 99 } } }, kennzeichen: "OLD" },
      await parse(),
      now,
    );
    expect(v.kennzeichen).toBe("M-AB 1234");
    expect(v.fin).toBe("WVWZZZ1JZXW000001");
    expect(v.modell).toBe("Volkswagen Golf");
    expect(v.leistungsdatum).toBe("2026-10-14");
    expect(v.panels.haube).toMatchObject({ alu: true, bigEur: 120, method: "ptp", finish: false, big: 1, dents: { 20: 5 } });
    expect(v.panels.dach).toMatchObject({ method: "sanft", finish: true, kleber: false });
    expect(v.colibri).toMatchObject({ imported: 21, reportTotal: 21, unknown: [], at: now.toISOString() });
  });

  it("forces kleber on Dachholm panels", async () => {
    const v = applyColibri({ panels: {} }, await parse(), now);
    expect(v.panels.dachholm_r.kleber).toBe(true);
  });

  it("does not mutate the input vehicle", async () => {
    const input = { panels: {} as Record<string, any> };
    applyColibri(input, await parse(), now);
    expect(input.panels).toEqual({});
  });

  it("ignores an invalid FIN", () => {
    const res = parseColibri([]);
    res.head.fin = "ABC";
    expect(applyColibri({ panels: {}, fin: "KEEP" }, res, now).fin).toBe("KEEP");
  });

  it("scanCheck: ok / mismatch / unknown / DentsTotalNumber", async () => {
    const v = applyColibri({ panels: {} }, await parse(), now);
    expect(scanCheck(v.colibri!).ok).toBe(true);
    expect(scanCheck(v.colibri!, 21).ok).toBe(true);
    expect(scanCheck(v.colibri!, 25).ok).toBe(false);
    expect(scanCheck({ ...v.colibri!, reportTotal: 30 }).ok).toBe(false);
    expect(scanCheck({ ...v.colibri!, unknown: ["x (1)"] }).ok).toBe(false);
  });
});
