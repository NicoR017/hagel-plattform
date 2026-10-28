import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { unzipSync, strFromU8 } from "fflate";
import { computeShares, computeVehicle, r2, type CalcVehicle } from "@hagel/calc";
import golden from "../../../fixtures/golden_cases_v20.json";
import {
  appendScanPdf, buildFinishedWorkbook, finishedFileName, buildTechnicianWorkbook, buildXlsx, dentBreak, generateTechnicianWorksheets, techPdfFileName, techWorkbookFileName, docText, eur, esFormula, esLines, fmtDateL, generateKvaPdf, generateRepairPhotoReport, generateHandoverReceipt,
  h1, hA, kvaFileName, kvaPlainText, mailTexts, num, winAnsi, xlsxColumnHeaders, xlsxFileName,
  type DocPhoto, type DocVehicle, type HandoverDoc, type Letterhead,
} from "../src";

type Case = { case: string; input: CalcVehicle & { id: string; land: "DE" | "ES" }; expected: Record<string, any> };
const cases = (golden as unknown as { cases: Case[] }).cases;
const byName = (n: string) => cases.find((c) => c.case === n)!;
const NOW = new Date("2026-10-19T10:00:00Z");

const ROOT = resolve(__dirname, "../../..");
const jpg = new Uint8Array(readFileSync(resolve(ROOT, "assets/pdr-team-logo.jpg")));
const png = new Uint8Array(readFileSync(resolve(ROOT, "assets/icon-192.png")));

async function logoOf(bytes: Uint8Array, kind: "jpg" | "png") {
  const d = await PDFDocument.create();
  const im = kind === "jpg" ? await d.embedJpg(bytes) : await d.embedPng(bytes);
  return { bytes, kind, width: im.width, height: im.height };
}

function mkVehicle(name: string, extra: Partial<DocVehicle> = {}): DocVehicle {
  const c = byName(name);
  return {
    ...(c.input as any), land: c.input.land, kennzeichen: "1234-ABC", fin: "VF1ABCDEF12345678", modell: "Renault Clio",
    kunde: "Carrosserie Garcia", leistungsdatum: "2026-10-19", zustand: ["Trocken", "Sauber"], ...extra,
  };
}

/** Extract drawn text (all pages) from the content streams of a pdf-lib generated file. */
async function pdfTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((pg) => {
    const contents = pg.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    let out = "";
    for (const r of refs) {
      const st = doc.context.lookup(r as any);
      if (!(st instanceof PDFRawStream)) continue;
      const txt = Buffer.from(decodePDFRawStream(st).decode()).toString("latin1");
      for (const m of txt.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
        const hex = m[1];
        let s = "";
        for (let i = 0; i < hex.length; i += 2) {
          const b = parseInt(hex.slice(i, i + 2), 16);
          s += b === 0x80 ? "€" : String.fromCharCode(b);
        }
        out += s + "\n";
      }
    }
    return out;
  });
}
const allText = async (b: Uint8Array) => (await pdfTexts(b)).join("\n");

describe("formatters", () => {
  it("eur / num / h1 / hA like v20 (de-DE)", () => {
    expect(eur(1794)).toBe("€ 1.794,00");
    expect(eur(0)).toBe("€ 0,00");
    expect(eur(undefined)).toBe("€ 0,00");
    expect(eur(1234567.891)).toBe("€ 1.234.567,89");
    expect(num(12.345)).toBe("12,35");
    expect(num(3, 0)).toBe("3");
    expect(h1(26)).toBe("26,0 h");
    expect(h1(21.78)).toBe("21,8 h");
    expect(hA(0.73)).toBe("0,73 h");
    expect(hA(3.5)).toBe("3,5 h");
  });
  it("dates", () => {
    expect(fmtDateL("DE", "2026-10-19")).toBe("19.10.2026");
    expect(fmtDateL("ES", "2026-10-19")).toBe("19/10/2026");
    expect(fmtDateL("DE", "")).toBe("—");
  });
  it("winAnsi maps v20 chars and never leaves unencodable ones", () => {
    expect(winAnsi("a – b × c → d ≥ e • f − g")).toBe("a - b x c » d > e - f - g");
    expect(winAnsi("€ Ø ü")).toBe("€ Ø ü");
    expect(winAnsi("日本")).toBe("??");
  });
  it("dentBreak", () => {
    expect(dentBreak({ key: "x", dents: { "20": 3, "30": 2 } })).toBe("3×20  ·  2×30 mm");
    expect(dentBreak({ key: "x", dents: { "20": 3 } })).toBe("");
  });
  it("file name + mail texts", () => {
    const v = mkVehicle("case1_ES");
    expect(kvaFileName(v, NOW)).toBe("Presupuesto_1234-ABC_2026-10-19.pdf");
    expect(kvaFileName({ ...v, kennzeichen: "", leistungsdatum: undefined }, NOW)).toBe("Presupuesto_Vehiculo_2026-10-19.pdf");
    expect(mailTexts(v).subject).toBe("Presupuesto daños por granizo – Renault Clio · 1234-ABC");
    expect(mailTexts({ ...v, land: "DE", colibriFile: "x" }).body).toContain("Colibri-Scanbericht");
    expect(docText("ES").kva).toBe("Presupuesto");
  });
});

describe("text output (golden cases)", () => {
  const picks = ["case1_ES", "case3_ES", "case7_ES", "case2_DE", "case5_DE", "case9_DE", "case11_DE"];
  for (const n of picks) {
    it(n, () => {
      const g = byName(n), v = mkVehicle(n), c = computeVehicle(v);
      const t = kvaPlainText(v, c);
      expect(t).toContain(eur(g.expected.netto));
      expect(t).toContain(eur(g.expected.brutto));
      expect(t).toContain("1234-ABC");
      expect(t).toContain("Carrosserie Garcia");
      if (v.land === "ES") {
        expect(t.startsWith("PRESUPUESTO")).toBe(true);
        expect(t).toContain("categoría " + g.expected.category);
        expect(t).toContain(eur(g.expected.matrixEur));
        expect(esFormula(c.es!)).toContain(eur(g.expected.matrixEur));
        expect(esLines(v, c)[0].v).toBe(c.es!.matrixEur);
      } else {
        expect(t.startsWith("KOSTENVORANSCHLAG")).toBe(true);
        expect(t).toContain(num(g.expected.repairAW) + " AW");
      }
    });
  }
  it("insurer + claim number appear when present", () => {
    const v = mkVehicle("case1_ES", { insurerName: "Mapfre", claimNumber: "SIN-998877" });
    const t = kvaPlainText(v, computeVehicle(v));
    expect(t).toContain("Aseguradora: Mapfre");
    expect(t).toContain("N.º de siniestro: SIN-998877");
    const d = mkVehicle("case1_DE", { insurerName: "Allianz", claimNumber: "S-1" });
    expect(kvaPlainText(d, computeVehicle(d))).toContain("Versicherung: Allianz   Schadennummer: S-1");
  });
  it("no internal split in the text copy", () => {
    const v = mkVehicle("case1_ES", { techName: "Hans Geheim", techPct: 37, werkPct: 13, werkMode: "pct", demTechName: "Dem Techniker" });
    const c = computeVehicle(v);
    const a = computeShares(v, c);
    const t = kvaPlainText(v, c, a);
    expect(t).not.toContain("Hans Geheim");
    for (const s of [eur(a.techEur), eur(a.werkEur), eur(a.rest)]) expect(t).not.toContain(s);
    expect(t).not.toMatch(/Provision|comisi|Techniker|Bleibt/i);
  });
});

const photos = (n: number, inPdf = true): DocPhoto[] =>
  Array.from({ length: n }, (_, i) => ({ label: i % 2 ? "Vorderansicht" : "Foto", bytes: jpg, inPdf }));

describe("KVA PDF", () => {
  const variants: { name: string; lh: "none" | "logo" | "neutral" | "png"; ph: number }[] = [
    { name: "case2_ES", lh: "none", ph: 0 },
    { name: "case8_ES", lh: "logo", ph: 3 },
    { name: "case2_DE", lh: "neutral", ph: 0 },
    { name: "case8_DE", lh: "png", ph: 4 },
  ];
  for (const t of variants) {
    it(`${t.name} letterhead=${t.lh} photos=${t.ph}`, async () => {
      const v = mkVehicle(t.name, { insurerName: "Mapfre", claimNumber: "SIN-998877", notiz: "Kotflügel nicht beschädigt " + "x".repeat(10) });
      const c = computeVehicle(v);
      let letterhead: Letterhead | null = null;
      if (t.lh === "logo") letterhead = { name: "Carrosserie X", logo: await logoOf(jpg, "jpg"), footer: "Carrosserie X - NIF B123 - Calle 1" , taxId: "NIF B123"};
      if (t.lh === "png") letterhead = { name: "Taller Y", logo: await logoOf(png, "png") };
      if (t.lh === "neutral") letterhead = { name: "" };
      const bytes = await generateKvaPdf(v, c, { letterhead, photos: photos(t.ph), now: NOW });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(t.ph ? 2 : 1);
      const pages = await pdfTexts(bytes), txt = pages.join("\n");
      expect(txt).toContain("1234-ABC");
      expect(txt).toContain(eur(c.netto));
      expect(txt).toContain(eur(c.brutto));
      expect(txt).toContain("Carrosserie Garcia");
      expect(txt).toContain(v.land === "ES" ? "Presupuesto" : "Kostenvoranschlag");
      expect(txt).not.toContain(v.land === "ES" ? "Kostenvoranschlag" : "Presupuesto");
      expect(txt).toContain(v.land === "ES" ? "Aseguradora: Mapfre" : "Versicherung: Mapfre");
      expect(txt).toContain("SIN-998877");
      expect(txt).not.toContain("PDR Team");
      if (v.land === "ES") expect(txt).toContain("Matriz: ");
      if (t.ph) {
        expect(pages[1]).toContain("Fotos");
        if (v.land === "ES") expect(pages[1]).toContain("Vista frontal");
      }
      if (t.lh === "logo") {
        expect(txt).toContain("Carrosserie X - NIF B123");
        expect(txt).toContain("NIF B123");
      }
      if (t.lh === "none" || t.lh === "neutral") expect(txt).not.toContain("Carrosserie X");
      expect(doc.getTitle()).toContain(v.land === "ES" ? "Presupuesto" : "Kostenvoranschlag");
    });
  }
  it("deterministic with injected now", async () => {
    const v = mkVehicle("case1_DE"), c = computeVehicle(v);
    const a = await generateKvaPdf(v, c, { now: NOW });
    const b = await generateKvaPdf(v, c, { now: NOW });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
  it("only inPdf photos are placed", async () => {
    const v = mkVehicle("case1_DE"), c = computeVehicle(v);
    const bytes = await generateKvaPdf(v, c, { photos: photos(2, false), now: NOW });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("many photos paginate; broken photo is skipped", async () => {
    const v = mkVehicle("case1_DE"), c = computeVehicle(v);
    const ph = photos(14).concat([{ label: "bad", bytes: new Uint8Array([1, 2, 3]), inPdf: true }]);
    const bytes = await generateKvaPdf(v, c, { photos: ph, now: NOW });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
  });
  it("every golden case renders without throwing; PPT sub-line present", async () => {
    for (const g of cases) {
      const v = mkVehicle(g.case, { notiz: "Ü € – “quote” → ≥ 日" });
      const c = computeVehicle(v);
      const bytes = await generateKvaPdf(v, c, { now: NOW });
      const txt = await allText(bytes);
      expect(txt).toContain(eur(c.brutto));
      if (c.panels.some((p) => p.method === "ptp")) expect(txt).toContain(docText(v.land).ptp + " - 40 %");
    }
  });
  it("KVA never contains internal split data", async () => {
    for (const n of ["case1_ES", "case1_DE"]) {
      const v = mkVehicle(n, { techName: "Hans Geheim", techPct: 37, werkPct: 13, werkMode: "pct", demTechName: "Dem Techniker", demTechPct: 90, demontage: true, demontageEur: 150 });
      const c = computeVehicle(v), a = computeShares(v, c);
      const bytes = await generateKvaPdf(v, c, { now: NOW, photos: photos(1) });
      const txt = await allText(bytes);
      expect(txt).not.toContain("Hans Geheim");
      expect(txt).not.toContain("Dem Techniker");
      for (const s of [eur(a.techEur), eur(a.werkEur), eur(a.rest), eur(a.demTechEur)]) expect(txt).not.toContain(s);
      expect(txt).not.toMatch(/Provision|comisi|Techniker|Bleibt|Werkstatt/i);
      const plain = kvaPlainText(v, c, a);
      expect(plain).not.toContain("Hans Geheim");
      for (const s of [eur(a.techEur), eur(a.werkEur), eur(a.rest)]) expect(plain).not.toContain(s);
    }
  });
});

describe("merge", () => {
  it("appendScanPdf adds page counts", async () => {
    const v = mkVehicle("case1_DE"), c = computeVehicle(v);
    const kva = await generateKvaPdf(v, c, { photos: photos(1), now: NOW });
    const scanDoc = await PDFDocument.create();
    scanDoc.addPage([300, 300]); scanDoc.addPage([300, 300]); scanDoc.addPage([300, 300]);
    const scan = await scanDoc.save();
    const merged = await appendScanPdf(kva, scan, "Kostenvoranschlag + Colibri-Scan 1234-ABC");
    const d = await PDFDocument.load(merged);
    expect(d.getPageCount()).toBe(2 + 3);
    expect(d.getTitle()).toBe("Kostenvoranschlag + Colibri-Scan 1234-ABC");
    expect((await pdfTexts(merged))[0]).toContain("1234-ABC");
  });
});

describe("repair photo report", () => {
  const mk = (phase: any, label: string, takenAt?: string): DocPhoto => ({ label, bytes: jpg, inPdf: false, phase, takenAt });
  const list = [
    mk("besichtigung", "Vorderansicht", "2026-10-19T08:15:00Z"),
    mk("reparatur", "Detail / Delle", "2026-10-19T12:30:00Z"),
    mk("reparatur", "Dach", "2026-10-19T12:45:00Z"),
    mk("fertig", "Heckansicht", "2026-10-20T15:05:00Z"),
  ];
  it("ES: phases, captions, date+time, header", async () => {
    const v = mkVehicle("case1_ES", { insurerName: "Mapfre", claimNumber: "SIN-1" });
    const bytes = await generateRepairPhotoReport(v, { letterhead: null, photos: list, now: NOW });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    const t = await allText(bytes);
    expect(t).toContain("Informe fotográfico de reparación");
    for (const s of ["Inspección", "Durante la reparación", "Después de la reparación", "Vista frontal", "Detalle / abolladura", "Lateral", "1234-ABC", "VF1ABCDEF12345678", "Renault Clio", "Carrosserie Garcia", "Mapfre", "SIN-1", "19/10/2026, 10:15", "20/10/2026, 17:05"].filter((s) => s !== "Lateral"))
      expect(t).toContain(s);
    expect(t).not.toContain("PDR Team");
  });
  it("DE with letterhead footer; pagination for many photos", async () => {
    const v = mkVehicle("case1_DE");
    const many = Array.from({ length: 13 }, (_, i) => mk(i % 2 ? "reparatur" : "fertig", "Foto", "2026-10-19T08:15:00Z"));
    const bytes = await generateRepairPhotoReport(v, { letterhead: { name: "Garage Z", footer: "Garage Z Fußzeile" }, photos: list.concat(many), now: NOW });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const pages = await pdfTexts(bytes);
    const t = pages.join("\n");
    expect(t).toContain("Fotobericht Reparatur");
    expect(t).toContain("Während der Reparatur");
    expect(t).toContain("Nach der Reparatur");
    expect(t).toContain("19.10.2026, 10:15");
    expect(t).toContain("Garage Z");
    pages.forEach((p) => expect(p).toContain("Garage Z Fußzeile"));
  });
});

describe("xlsx", () => {
  const vs: DocVehicle[] = [
    mkVehicle("case1_ES", { id: "a", techName: "Anna", techPct: 50, werkPct: 20, werkMode: "pct", status: "reparatur", stationName: "Madrid", insurerName: "Mapfre", claimNumber: "S1" }),
    mkVehicle("case2_DE", { id: "b", techName: "Anna", techPct: 40, werkPct: 10, werkMode: "pct", status: "fertig", demontage: true, demTechName: "Ben", notiz: "a & <b>\n c" }),
    mkVehicle("case3_ES", { id: "c", techName: "Ben", werkMode: "staffel", status: "attente", glass: { ws: { on: true, eur: 100 } } }),
  ];
  const files = (b: Uint8Array) => unzipSync(b);
  const sheet1 = (b: Uint8Array) => strFromU8(files(b)["xl/worksheets/sheet1.xml"]);

  it("full columns: valid zip, headers, sums, status, sheet 2", () => {
    const b = buildXlsx(vs, "Tagesliste Heute", { prices: true, internalSplit: true });
    const f = files(b);
    expect(Object.keys(f).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
    const s1 = sheet1(b);
    const headers = [...s1.matchAll(/<c r="([A-Z]+)1" s="1" t="inlineStr"><is><t xml:space="preserve">([^<]*)<\/t>/g)].map((m) => m[2]);
    expect(headers).toEqual(xlsxColumnHeaders({ prices: true, internalSplit: true }));
    for (const h of ["Plattform", "Status", "Versicherung", "Schadennummer", "Provision %", "Provision €", "Preis netto", "Scheiben €", "Bleibt PDR €"]) expect(headers).toContain(h);
    expect(headers).not.toContain("Ordner");
    expect(headers).not.toContain("Werkstatt €");
    expect(s1).toContain("Reparatur"); expect(s1).toContain("Fertig"); expect(s1).toContain("Wartet");
    expect(s1).toContain("a &amp; &lt;b&gt; c");
    const nettoCol = String.fromCharCode(65 + headers.indexOf("Preis netto"));
    expect(s1).toContain(`<f>SUM(${nettoCol}2:${nettoCol}4)</f>`);
    expect(s1).toContain("Summe (3)");
    expect(s1).toContain('<pane ySplit="1" xSplit="2"');
    expect(s1).toContain(`<autoFilter ref="A1:${"AE"}4"/>`);
    const netto0 = r2(computeVehicle(vs[0]).netto);
    expect(s1).toContain(`<v>${netto0}</v>`);
    const wb = strFromU8(f["xl/workbook.xml"]);
    expect(wb).toContain("Abrechnung je Techniker");
    const s2 = strFromU8(f["xl/worksheets/sheet2.xml"]);
    expect(s2).toContain("Anna"); expect(s2).toContain("Ben");
    expect(s2).toContain("<f>SUM(C2:C3)</f>");
  });
  it("prices=false removes price columns only", () => {
    const h = xlsxColumnHeaders({ prices: false, internalSplit: true });
    for (const x of ["Preis netto", "MwSt/IVA", "Brutto", "Scheiben €"]) expect(h).not.toContain(x);
    expect(h).toContain("Provision €");
    const s1 = sheet1(buildXlsx(vs, "T", { prices: false, internalSplit: true }));
    expect(s1).not.toContain("Preis netto"); expect(s1).not.toContain("Brutto");
  });
  it("internalSplit=false removes split columns and the technician sheet", () => {
    const b = buildXlsx(vs, "T", { prices: true, internalSplit: false });
    const f = files(b);
    expect(f["xl/worksheets/sheet2.xml"]).toBeUndefined();
    expect(strFromU8(f["xl/workbook.xml"])).not.toContain("Techniker");
    expect(strFromU8(f["[Content_Types].xml"])).not.toContain("sheet2");
    const s1 = sheet1(b);
    for (const x of ["Provision", "Techniker", "De-/Re", "Bleibt PDR", "Anna", "Werkstatt"]) expect(s1).not.toContain(x);
    expect(s1).toContain("Preis netto");
  });
  it("both false: only base columns", () => {
    const h = xlsxColumnHeaders({ prices: false, internalSplit: false });
    expect(h).toEqual(["Datum", "Kennzeichen", "Modell", "FIN", "Kunde", "Versicherung", "Schadennummer", "Plattform", "Land", "Dellen", "Bollos", "Kat.", "Stunden", "€/h", "Status", "Scan", "Notiz"]);
    const b = buildXlsx(vs, "T", { prices: false, internalSplit: false });
    expect(sheet1(b)).toContain("Madrid");
  });
  it("empty list still valid", () => {
    const b = buildXlsx([], "Leer", { prices: true, internalSplit: true });
    expect(strFromU8(files(b)["xl/worksheets/sheet1.xml"])).not.toContain("autoFilter");
  });
  it("file name", () => {
    expect(xlsxFileName("Alle Fahrzeuge", "2026-10-19")).toBe("Tagesliste_Alle_Fahrzeuge_2026-10-19.xlsx");
    expect(xlsxFileName("Müller/Test")).toBe("Tagesliste_Müller_Test.xlsx");
  });
});

describe("pagination", () => {
  it("long vehicle paginates", async () => {
    const v = mkVehicle("case1_ES", { notiz: "n" }), c = computeVehicle(v);
    const pages = await pdfTexts(await generateKvaPdf(v, c, { now: NOW }));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.join(" ")).toContain(eur(c.brutto));
  });
});

describe("technician worksheet workbook", () => {
  const t = (technician: string, cars: number, base = 100) => ({
    technician, sites: ["Nave Madrid"],
    vehicles: Array.from({ length: cars }, (_, i) => ({ plate: `P-${i + 1}`, model: "Seat Leon & Co", start: "2026-10-06", end: "2026-10-1" + i, aw: 10 + i, pdrEur: base + i, demEur: i === 0 ? 20 : 0, eur: base + i + (i === 0 ? 20 : 0) })),
    totals: { n: cars, aw: 0, pdrEur: 0, demEur: 0, eur: 0 },
  });
  const data = { from: "2026-10-05", to: "2026-10-11", sheets: [t("Ana", 2), t("Ben / Jr: [x]", 1, 50), t("Ana", 1)] };
  data.sheets.forEach((s) => { s.totals = { n: s.vehicles.length, aw: s.vehicles.reduce((a, v) => a + v.aw, 0), pdrEur: s.vehicles.reduce((a, v) => a + v.pdrEur, 0), demEur: s.vehicles.reduce((a, v) => a + v.demEur, 0), eur: s.vehicles.reduce((a, v) => a + v.eur, 0) }; });
  const open = (b: Uint8Array) => unzipSync(b);

  it("one overview sheet plus one worksheet per technician, names unique and legal", () => {
    const f = open(buildTechnicianWorkbook(data, "de"));
    expect(Object.keys(f).filter((k) => k.startsWith("xl/worksheets/")).length).toBe(4);
    const wb = strFromU8(f["xl/workbook.xml"]);
    const names = [...wb.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    expect(names).toEqual(["Übersicht", "Ana", "Ben - Jr- -x-", "Ana 2"]);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });

  it("worksheet like the paper one: technician, site, period, table, summary, signature lines (German)", () => {
    const f = open(buildTechnicianWorkbook(data, "de"));
    const s = strFromU8(f["xl/worksheets/sheet2.xml"]);
    for (const w of ["PDR Technician Worksheet", "Techniker:", "Standort:", "Nave Madrid", "Zeitraum:", "05.10.2026 – 11.10.2026", "Arbeitsbeginn", "Arbeitsende", "Kennzeichen", "Vergütungsbetrag", "P-1", "P-2", "06.10.2026", "Seat Leon &amp; Co", "Zusammenfassung", "Fahrzeuge repariert", "Gesamt AW", "Gesamt Vergütung", "Unterschrift des Standortleiters", "Unterschrift des Technikers"]) expect(s).toContain(w);
    // totals as numbers: 2 cars, AW 10 + 11, pay (100 + 20) + 101
    expect(s).toContain("<v>221</v>");
    expect(s).toContain("<v>21</v>");
  });

  it("overview totals and English labels", () => {
    const f = open(buildTechnicianWorkbook(data, "en"));
    const s = strFromU8(f["xl/worksheets/sheet1.xml"]);
    expect(s).toContain("Technician"); expect(s).toContain("Total €");
    const sheet = strFromU8(f["xl/worksheets/sheet3.xml"]);
    expect(sheet).toContain("Signature of the technician"); expect(sheet).toContain("Vehicles repaired");
    const sum = data.sheets.reduce((a, x) => a + x.totals.eur, 0);
    expect(s).toContain(`<v>${Math.round(sum * 100) / 100}</v>`);
  });

  it("empty period: a readable overview, no technician sheets; file name", () => {
    const f = open(buildTechnicianWorkbook({ from: null, to: null, sheets: [] }, "de"));
    expect(Object.keys(f).filter((k) => k.startsWith("xl/worksheets/")).length).toBe(1);
    expect(strFromU8(f["xl/worksheets/sheet1.xml"])).toContain("Keine Fahrzeuge in diesem Zeitraum.");
    expect(techWorkbookFileName("2026-10-05", "2026-10-11")).toBe("Technikerabrechnung_2026-10-05_2026-10-11.xlsx");
  });
});

describe("finished vehicles workbook", () => {
  const row = (plate: string, station: string, total: number) => ({ plate, model: "Seat Leon & Co", insurer: "Allianz", bodyshop: "Chapauto", station, end: "2026-10-10", total, technician: total * 0.3, headliner: 20, referrer: total * 0.1, pdr: total * 0.5 - 20 });
  const data = { from: "2026-10-05", to: "2026-10-11", rows: [row("A-1", "Nave Madrid", 1000), row("B-2", "Nave Madrid", 500), row("C-3", "Nave Talavera", 200)] };
  const open = (b: Uint8Array) => unzipSync(b);
  it("the nine columns, one row per car, totals; one sheet per station when there are several", () => {
    const f = open(buildFinishedWorkbook(data, "en"));
    const names = [...strFromU8(f["xl/workbook.xml"]).matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    expect(names).toEqual(["All", "Nave Madrid", "Nave Talavera"]);
    const s = strFromU8(f["xl/worksheets/sheet1.xml"]);
    for (const w of ["Vehicle registration number", "Vehicle make and model", "Insurance company", "Bodyshop", "Total price agreed after assessment", "Technician&apos;s share".replace("&apos;", "'"), "Headliner&apos;s share".replace("&apos;", "'"), "Referring bodyshop&apos;s share".replace("&apos;", "'"), "Remaining amount for PDR Team", "A-1", "B-2", "C-3", "Seat Leon &amp; Co", "Allianz", "Chapauto", "10.10.2026", "05.10.2026 – 11.10.2026"]) expect(s).toContain(w);
    expect(s).toContain("<v>1700</v>"); // sum of the agreed prices
    expect(strFromU8(f["xl/worksheets/sheet2.xml"])).not.toContain("C-3");
    expect(strFromU8(f["xl/worksheets/sheet3.xml"])).toContain("C-3");
  });
  it("one station: one sheet; file name; the other languages", () => {
    const one = open(buildFinishedWorkbook({ ...data, rows: data.rows.slice(0, 2) }, "de"));
    expect(Object.keys(one).filter((k) => k.startsWith("xl/worksheets/")).length).toBe(1);
    expect(strFromU8(one["xl/worksheets/sheet1.xml"])).toContain("Kennzeichen");
    expect(strFromU8(open(buildFinishedWorkbook(data, "fr"))["xl/worksheets/sheet1.xml"])).toContain("Immatriculation");
    expect(strFromU8(open(buildFinishedWorkbook(data, "es"))["xl/worksheets/sheet1.xml"])).toContain("Matrícula");
    expect(finishedFileName("2026-10-05", "2026-10-11", "en")).toBe("Finished_vehicles_2026-10-05_2026-10-11.xlsx");
    expect(finishedFileName(null, null)).toBe("Fertige_Fahrzeuge_alle_alle.xlsx");
  });
});

describe("technician worksheet PDF", () => {
  const car = (i: number) => ({ plate: `MN-IS ${i}`, model: "Seat Leon", start: "2026-10-06", end: "2026-10-10", aw: 20.5, pdrEur: 800 + i, demEur: 0, eur: 800 + i });
  const sheet = (technician: string, n: number) => {
    const vehicles = Array.from({ length: n }, (_, i) => car(i + 1));
    return { technician, sites: ["HUK Untermeitingen"], vehicles, totals: { n, aw: 20.5 * n, pdrEur: vehicles.reduce((a, v) => a + v.pdrEur, 0), demEur: 0, eur: vehicles.reduce((a, v) => a + v.eur, 0) } };
  };
  it("one section per technician with the fields of the paper worksheet (German)", async () => {
    const b = await generateTechnicianWorksheets({ from: "2026-10-05", to: "2026-10-11", sheets: [sheet("SmartPro NRW GmbH", 4), sheet("Ana", 1)] }, "de", new Date("2026-10-16T10:00:00Z"));
    const pages = await pdfTexts(b);
    expect(pages.length).toBe(2);
    for (const w of ["PDR Technician Worksheet", "Techniker: ", "SmartPro NRW GmbH", "HUK Untermeitingen", "05.10.2026", "11.10.2026", "Arbeitsbeginn", "Arbeitsende", "Kennzeichen", "MN-IS 4", "Zusammenfassung", "Gesamt Verg", "Unterschrift des Standortleiters", "Unterschrift des Technikers"]) expect(pages[0]).toContain(w);
    expect(pages[1]).toContain("Ana");
    expect(pages[0]).not.toContain("Ana");
    expect(pages[0]).toContain("3.210,00"); // 801 + 802 + 803 + 804
  });
  it("a long table flows onto more pages, the summary stays after the last row; empty period gives a readable page", async () => {
    const long = await pdfTexts(await generateTechnicianWorksheets({ from: null, to: null, sheets: [sheet("Ben", 60)] }, "en"));
    expect(long.length).toBeGreaterThan(1);
    expect(long.join("\n")).toContain("Summary");
    expect(long[long.length - 1]).toContain("Signature of the technician");
    const none = await pdfTexts(await generateTechnicianWorksheets({ from: null, to: null, sheets: [] }, "de"));
    expect(none).toHaveLength(1); expect(none[0]).toContain("Keine Fahrzeuge in diesem Zeitraum.");
    expect(techPdfFileName("2026-10-05", "2026-10-11")).toBe("Technikerabrechnung_2026-10-05_2026-10-11.pdf");
  });
});

describe("parts to replace and the method name", () => {
  const parts = ["Zierleiste Dach li", "Antenne", "Clips Verkleidung"];
  for (const name of ["case2_DE", "case2_ES"]) {
    it(`${name}: a highlighted box names the parts (no price attached), the plain text lists them, the method name is small`, async () => {
      const v = mkVehicle(name, { partsToReplace: parts, methodName: "Allianz Spezial" });
      const c = computeVehicle(v), X = docText(v.land);
      const txt = await allText(await generateKvaPdf(v, c, { now: NOW, letterhead: { name: "" } }));
      expect(txt).toContain(X.teile);
      for (const p of parts) expect(txt).toContain("- " + p);
      expect(txt).toContain(`${X.methode}: Allianz Spezial`);
      expect(txt).not.toContain("PDR Team");
      // nothing but the label follows a part: no euro sign on those lines
      for (const p of parts) expect(txt.split("\n").find((l) => l.includes("- " + p))).not.toMatch(/€|EUR/);
      const plain = kvaPlainText(v, c);
      expect(plain).toContain(X.teile);
      for (const p of parts) expect(plain).toContain("- " + p);
    });
  }
  it("without parts or method name nothing new appears (the old documents are unchanged)", async () => {
    const v = mkVehicle("case2_DE"), c = computeVehicle(v), X = docText("DE");
    const txt = await allText(await generateKvaPdf(v, c, { now: NOW }));
    expect(txt).not.toContain(X.teile);
    expect(txt).not.toContain(X.methode);
    expect(kvaPlainText(v, c)).not.toContain(X.teile);
    expect(kvaPlainText(mkVehicle("case2_DE", { partsToReplace: ["  ", ""] }), c)).not.toContain(X.teile); // blanks are ignored
  });
  it("a long list and a long label wrap and paginate without losing a line", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `Teil Nummer ${i + 1} ${"lang ".repeat(i % 4 === 0 ? 30 : 1)}`.trim());
    for (const n of ["case1_DE", "case1_ES"]) {
      const v = mkVehicle(n, { partsToReplace: many }), c = computeVehicle(v);
      const bytes = await generateKvaPdf(v, c, { now: NOW });
      const txt = await allText(bytes);
      for (const i of [1, 17, 40]) expect(txt).toContain(`Teil Nummer ${i}`);
      expect(txt).toContain(eur(c.brutto)); // totals still there
    }
  });
  it("the repair photo report names the parts in its header", async () => {
    const v = mkVehicle("case2_ES", { partsToReplace: parts }), X = docText("ES");
    const txt = await allText(await generateRepairPhotoReport(v, { photos: photos(2), now: NOW }));
    expect(txt).toContain(X.teile);
    expect(txt).toContain("Antenne");
  });
  it("the mail text never mentions parts, amounts or the method", () => {
    const m = mailTexts(mkVehicle("case2_DE", { partsToReplace: parts, methodName: "Allianz Spezial" }));
    expect(m.subject + m.body).not.toMatch(/Antenne|Allianz Spezial/);
  });
});

describe("repair photo report with the estimate's amounts", () => {
  it("prints net / VAT / gross under the header when asked; never the internal split; absent otherwise", async () => {
    for (const n of ["case1_DE", "case1_ES"]) {
      const v = mkVehicle(n, { techName: "Hans Geheim", techPct: 37, werkPct: 13, werkMode: "pct", demTechName: "Dem Techniker", demTechPct: 90, demontage: true, demontageEur: 150 });
      const c = computeVehicle(v), a = computeShares(v, c), X = docText(v.land);
      const amounts = { netto: c.netto, mwst: c.brutto - c.netto, brutto: c.brutto };
      const txt = await allText(await generateRepairPhotoReport(v, { photos: photos(1), now: NOW, amounts }));
      expect(txt).toContain(`${X.netto}: ${eur(c.netto)}`);
      expect(txt).toContain(`${X.brutto}: ${eur(c.brutto)}`);
      expect(txt).not.toContain("Hans Geheim");
      for (const s of [eur(a.techEur), eur(a.werkEur), eur(a.rest), eur(a.demTechEur)]) expect(txt).not.toContain(s);
      expect(txt).not.toMatch(/Provision|comisi|Techniker|Bleibt/i);
      const without = await allText(await generateRepairPhotoReport(v, { photos: photos(1), now: NOW }));
      expect(without).not.toContain(X.netto + ":");
    }
  });
});

describe("handover receipt", () => {
  const norm = (s: string) => s.replace(/\s+/g, " ");
  const stroke = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [(i * 7) % 600, 100 + Math.round(80 * Math.sin(i / 5))]);
  const mkH = (kind: "drop_off" | "pick_up", extra: Partial<HandoverDoc> = {}): HandoverDoc => ({
    kind, customerName: "Ana López", customerEmail: "ana@example.com", remarks: "Kratzer links hinten", signedAt: "2026-10-19T08:15:00Z",
    receivedBy: "Marta Ruiz", stationName: "Taller Sur", stationAddress: "Calle Mayor 1, Madrid", strokes: [stroke(40), [[300, 100]]], ...extra,
  });
  it("DE drop-off: one page, texts, sentence", async () => {
    const v = mkVehicle("case1_DE", { insurerName: "Allianz", claimNumber: "SN-9" });
    const bytes = await generateHandoverReceipt(v, mkH("drop_off"), { now: NOW });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const t = norm(await allText(bytes));
    for (const s of ["Übergabebestätigung - Fahrzeugannahme", "1234-ABC", "Renault Clio", "VF1ABCDEF12345678", "SN-9", "Allianz", "Carrosserie Garcia", "Ana López", "ana@example.com",
      "Taller Sur", "Calle Mayor 1, Madrid", "Kratzer links hinten", "Marta Ruiz", "19.10.2026, 10:15", "Kennzeichen", "FIN", "Schadennummer", "Versicherung", "Datum / Uhrzeit", "Kunde", "E-Mail",
      "Ort", "Bemerkungen / Vorschäden", "Entgegengenommen von", "Unterschrift",
      "Mit meiner Unterschrift bestätige ich, Ana López, dass ich das Fahrzeug am 19.10.2026 um 10:15 Uhr in Taller Sur abgegeben habe. Entgegengenommen von Marta Ruiz."])
      expect(t).toContain(s);
  });
  it("DE pick-up variant", async () => {
    const t = norm(await allText(await generateHandoverReceipt(mkVehicle("case1_DE"), mkH("pick_up"), { now: NOW })));
    expect(t).toContain("Fahrzeugrückgabe");
    expect(t).toContain("Übergeben von");
    expect(t).toContain("zurückerhalten habe. Übergeben von Marta Ruiz.");
  });
  it("ES drop-off and pick-up with letterhead", async () => {
    const v = mkVehicle("case1_ES");
    const lh: Letterhead = { name: "Garage Z", footer: "Garage Z pie" };
    const d = await generateHandoverReceipt(v, mkH("drop_off", { remarks: "" }), { now: NOW, letterhead: lh });
    expect((await PDFDocument.load(d)).getPageCount()).toBe(1);
    const t = norm(await allText(d));
    for (const s of ["Comprobante de entrega - Recepción del vehículo", "Matrícula", "VIN", "Fecha / hora", "19/10/2026, 10:15", "Cliente", "Correo", "Lugar", "Observaciones / daños previos", "Recibido por", "Firma", "Garage Z",
      "Con mi firma, Ana López, confirmo que he entregado el vehículo el 19/10/2026 a las 10:15 en Taller Sur. Recibido por Marta Ruiz."])
      expect(t).toContain(s);
    const p = norm(await allText(await generateHandoverReceipt(v, mkH("pick_up"), { now: NOW })));
    expect(p).toContain("Devolución del vehículo");
    expect(p).toContain("he recogido el vehículo");
    expect(p).toContain("Entregado por Marta Ruiz.");
  });
  it("time zone option", async () => {
    const t = await allText(await generateHandoverReceipt(mkVehicle("case1_DE"), mkH("drop_off"), { now: NOW, timeZone: "UTC" }));
    expect(t).toContain("08:15");
  });
  it("long remarks wrap and stay on one page; unbroken words are cut", async () => {
    const remarks = ("Beule an der Tür und viele weitere Vorschäden. ".repeat(12)) + "X".repeat(300);
    const bytes = await generateHandoverReceipt(mkVehicle("case1_DE"), mkH("drop_off", { remarks }), { now: NOW });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(await allText(bytes)).toContain("Beule an der Tür");
    const c = doc.getPage(0).node.Contents() as any;
    const refs = c instanceof PDFArray ? c.asArray() : [c];
    let seen = 0;
    for (const r of refs) {
      const st = doc.context.lookup(r as any);
      if (!(st instanceof PDFRawStream)) continue;
      const s = Buffer.from(decodePDFRawStream(st).decode()).toString("latin1");
      for (const m of s.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)) { seen++; expect(+m[1]).toBeLessThan(560); expect(+m[2]).toBeGreaterThan(0); }
    }
    expect(seen).toBeGreaterThan(10);
  });
  it("weird characters never throw", async () => {
    const weird = "Ñandú Ü€ \"quote\" 'q' 😀   \t\n x";
    const bytes = await generateHandoverReceipt(mkVehicle("case1_ES", { kunde: weird }), mkH("pick_up", { customerName: weird, remarks: weird, receivedBy: weird, stationName: weird, customerEmail: weird }), { now: NOW });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("empty strokes, many points, junk points", async () => {
    const sets = [[], [[]], [stroke(5000)], [[[-5, 3], [9999, 1], [NaN, 2], [10, 10], [20, 20]], [[0, 0]]]] as [number, number][][][];
    for (const strokes of sets)
      expect((await PDFDocument.load(await generateHandoverReceipt(mkVehicle("case1_DE"), mkH("drop_off", { strokes }), { now: NOW }))).getPageCount()).toBe(1);
  });
  describe("photo report last page", () => {
    const photo: DocPhoto = { label: "Foto", bytes: jpg, inPdf: false, phase: "besichtigung", takenAt: "2026-10-19T08:15:00Z" };
    it("unchanged without handovers; one more page with them", async () => {
      const v = mkVehicle("case1_DE");
      const a = await generateRepairPhotoReport(v, { photos: [photo], now: NOW });
      const b = await generateRepairPhotoReport(v, { photos: [photo], now: NOW, handovers: { dropOff: mkH("drop_off"), pickUp: null } });
      const na = (await PDFDocument.load(a)).getPageCount();
      expect((await PDFDocument.load(b)).getPageCount()).toBe(na + 1);
      const pages = await pdfTexts(b);
      const last = norm(pages[pages.length - 1]);
      for (const s of ["Unterschriften des Kunden", "Fahrzeugannahme", "Fahrzeugrückgabe", "noch nicht unterschrieben", "Ana López", "Marta Ruiz", "19.10.2026, 10:15", "Kratzer links hinten"]) expect(last).toContain(s);
      expect(norm(pages.slice(0, -1).join(" "))).not.toContain("Unterschriften des Kunden");
      const c = await generateRepairPhotoReport(v, { photos: [photo], now: NOW, handovers: { dropOff: null, pickUp: null } });
      expect((await PDFDocument.load(c)).getPageCount()).toBe(na + 1);
      expect(norm((await pdfTexts(c)).pop()!).match(/noch nicht unterschrieben/g)).toHaveLength(2);
    });
    it("both signed (ES)", async () => {
      const v = mkVehicle("case1_ES");
      const b = await generateRepairPhotoReport(v, { photos: [photo], now: NOW, handovers: { dropOff: mkH("drop_off"), pickUp: mkH("pick_up", { customerName: "Beatriz Gil" }) } });
      const pages = await pdfTexts(b);
      const last = norm(pages[pages.length - 1]);
      for (const s of ["Firmas del cliente", "Recepción del vehículo", "Devolución del vehículo", "Ana López", "Beatriz Gil"]) expect(last).toContain(s);
      expect(last).not.toContain("aún sin firmar");
      const n = await generateRepairPhotoReport(v, { photos: [photo], now: NOW, handovers: { dropOff: null, pickUp: null } });
      expect(norm((await pdfTexts(n)).pop()!)).toContain("aún sin firmar");
    });
  });
});
