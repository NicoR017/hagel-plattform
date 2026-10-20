/** YYYY-MM-DD -> DD.MM.YYYY, like on the paper worksheet. */
const fmtDate = (s: string): string => (/^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : s);
import { zipStore } from "./zip";

/** One technician's finished cars of a period and what he is paid for them (internal document, DE or EN). */
export interface TechSheetData {
  technician: string; sites: string[];
  vehicles: { plate: string; model: string; start: string | null; end: string; aw: number; pdrEur: number; demEur: number; eur: number }[];
  totals: { n: number; aw: number; pdrEur: number; demEur: number; eur: number };
}

export const TECH_LABELS = {
  de: {
    overview: "Übersicht", title: "PDR Technician Worksheet", tech: "Techniker", site: "Standort", period: "Zeitraum", start: "Arbeitsbeginn", end: "Arbeitsende", plate: "Kennzeichen", model: "Modell",
    aw: "AW", pdr: "PDR-Vergütung", dem: "Demontage-Vergütung", pay: "Vergütungsbetrag", summary: "Zusammenfassung", cars: "Fahrzeuge repariert", totalAw: "Gesamt AW",
    totalPdr: "Gesamt PDR-Vergütung", totalDem: "Gesamt Demontage-Vergütung", total: "Gesamt Vergütung", date: "Datum", signSite: "Unterschrift des Standortleiters", signTech: "Unterschrift des Technikers",
    ovCars: "Fahrzeuge", ovPdr: "PDR €", ovDem: "Demontage €", ovTotal: "Gesamt €", sum: "Summe", none: "Keine Fahrzeuge in diesem Zeitraum.",
  },
  en: {
    overview: "Overview", title: "PDR Technician Worksheet", tech: "Technician", site: "Site", period: "Period", start: "Work started", end: "Work finished", plate: "Plate", model: "Model",
    aw: "AW", pdr: "PDR pay", dem: "De-/re-mounting pay", pay: "Amount", summary: "Summary", cars: "Vehicles repaired", totalAw: "Total AW",
    totalPdr: "Total PDR pay", totalDem: "Total de-/re-mounting pay", total: "Total pay", date: "Date", signSite: "Signature of the site manager", signTech: "Signature of the technician",
    ovCars: "Vehicles", ovPdr: "PDR €", ovDem: "De-/re-mounting €", ovTotal: "Total €", sum: "Total", none: "No vehicles in this period.",
  },
} as const;
const L = TECH_LABELS;

function xesc(s: unknown): string {
  const m: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => m[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
function colL(i: number): string {
  let s = ""; i++;
  while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// cell styles (index into cellXfs below)
const S = { def: 0, title: 1, bold: 2, head: 3, money: 4, num: 5, totMoney: 6, totLabel: 7, int: 8, line: 9, headRight: 10, totNum: 11 } as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F3F3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="4"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FF16233F"/></bottom><diagonal/></border>
<border><left/><right/><top style="medium"><color rgb="FF16233F"/></top><bottom style="medium"><color rgb="FF16233F"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="2" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="right"/></xf>
<xf numFmtId="165" fontId="1" fillId="2" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

type Cell = string | number | null | undefined;
type Row = { ht?: number; cells: [Cell, number][] };

function sheetXml(widths: number[], rows: Row[]): string {
  const body = rows.map((r, ri) => {
    const rr = ri + 1;
    const cells = r.cells.map(([v, st], ci) => {
      const ref = colL(ci) + rr;
      if (v === null || v === undefined || v === "") return st ? `<c r="${ref}" s="${st}"/>` : "";
      if (typeof v === "number") return `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    }).join("");
    return `<row r="${rr}"${r.ht ? ` ht="${r.ht}" customHeight="1"` : ""}>${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${body}</sheetData><pageSetup orientation="portrait" fitToHeight="0"/></worksheet>`;
}

const sheetName = (s: string, used: Set<string>) => {
  const base = (s.replace(/[\\/?*[\]:]/g, "-").trim().slice(0, 28) || "Sheet");
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 26)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** `Abrechnung_<from>_<to>.xlsx` style name for the download. */
export function techWorkbookFileName(from: string | null, to: string | null, lang: "de" | "en" = "de"): string {
  return `${lang === "de" ? "Technikerabrechnung" : "Technician_pay"}_${from ?? "alle"}_${to ?? "alle"}.xlsx`;
}

/**
 * Workbook: one overview sheet (cars and pay per technician) and one worksheet per technician laid out like the paper "PDR Technician
 * Worksheet": header, table of finished cars, summary, signature lines.
 */
export function buildTechnicianWorkbook(data: { from: string | null; to: string | null; sheets: TechSheetData[] }, lang: "de" | "en" = "de"): Uint8Array {
  const l = L[lang];
  const period = [data.from ? fmtDate(data.from) : "…", data.to ? fmtDate(data.to) : "…"].join(" – ");
  const used = new Set<string>([l.overview.toLowerCase()]);
  const sheets: { name: string; xml: string }[] = [];

  // overview
  const ov: Row[] = [
    { ht: 24, cells: [[l.title, S.title]] },
    { cells: [[l.period + ":", S.bold], [period, S.def]] },
    { cells: [] },
    { ht: 28, cells: [[l.tech, S.head], [l.ovCars, S.headRight], [l.aw, S.headRight], [l.ovPdr, S.headRight], [l.ovDem, S.headRight], [l.ovTotal, S.headRight]] },
  ];
  for (const t of data.sheets) ov.push({ cells: [[t.technician, S.def], [t.totals.n, S.int], [t.totals.aw, S.num], [t.totals.pdrEur, S.money], [t.totals.demEur, S.money], [t.totals.eur, S.money]] });
  const sum = (k: "n" | "aw" | "pdrEur" | "demEur" | "eur") => r2(data.sheets.reduce((a, t) => a + t.totals[k], 0));
  ov.push({ cells: [[l.sum, S.totLabel], [sum("n"), S.totNum], [sum("aw"), S.totNum], [sum("pdrEur"), S.totMoney], [sum("demEur"), S.totMoney], [sum("eur"), S.totMoney]] });
  if (!data.sheets.length) ov.push({ cells: [[l.none, S.def]] });
  sheets.push({ name: l.overview, xml: sheetXml([30, 14, 12, 16, 20, 16], ov) });

  // one worksheet per technician (the paper worksheet)
  for (const t of data.sheets) {
    const rows: Row[] = [
      { ht: 26, cells: [[l.title, S.title]] },
      { cells: [[l.tech + ":", S.bold], [t.technician, S.def]] },
      { cells: [[l.site + ":", S.bold], [t.sites.join(", "), S.def]] },
      { cells: [[l.period + ":", S.bold], [period, S.def]] },
      { cells: [] },
      { ht: 28, cells: [[l.start, S.head], [l.end, S.head], [l.plate, S.head], [l.model, S.head], [l.aw, S.headRight], [l.pdr, S.headRight], [l.dem, S.headRight], [l.pay, S.headRight]] },
    ];
    for (const v of t.vehicles) rows.push({ cells: [[v.start ? fmtDate(v.start) : "", S.def], [fmtDate(v.end), S.def], [v.plate, S.def], [v.model, S.def], [v.aw, S.num], [v.pdrEur, S.money], [v.demEur, S.money], [v.eur, S.money]] });
    rows.push({ cells: [] }, { ht: 22, cells: [[l.summary, S.title]] });
    const line = (label: string, v: number, st: number, lab: number = S.def) => rows.push({ cells: [[label, lab], [null, lab], [null, lab], [null, lab], [null, lab], [null, lab], [null, lab], [v, st]] });
    line(l.cars, t.totals.n, S.int);
    line(l.totalAw, t.totals.aw, S.num);
    line(l.totalPdr, t.totals.pdrEur, S.money);
    line(l.totalDem, t.totals.demEur, S.money);
    line(l.total, t.totals.eur, S.totMoney, S.totLabel);
    rows.push({ cells: [] }, { cells: [] }, { cells: [[null, S.line], [null, S.line], [null, S.line]] }, { cells: [[l.date, S.def], [l.signSite, S.def]] });
    rows.push({ cells: [] }, { cells: [] }, { cells: [[null, S.line], [null, S.line], [null, S.line]] }, { cells: [[l.date, S.def], [l.signTech, S.def]] });
    sheets.push({ name: sheetName(t.technician, used), xml: sheetXml([14, 14, 16, 22, 10, 16, 20, 18], rows) });
  }

  const enc = new TextEncoder();
  const NS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
  const F = (name: string, str: string) => ({ name, data: enc.encode(str) });
  const ct = NS + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const wb = NS + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + `</sheets></workbook>`;
  const wbRels = NS + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zipStore([
    F("[Content_Types].xml", ct),
    F("_rels/.rels", NS + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    F("xl/workbook.xml", wb), F("xl/_rels/workbook.xml.rels", wbRels), F("xl/styles.xml", STYLES),
    ...sheets.map((s, i) => F(`xl/worksheets/sheet${i + 1}.xml`, s.xml)),
  ]);
}

export const techDate = fmtDate;
export function techPdfFileName(from: string | null, to: string | null, lang: "de" | "en" = "de"): string {
  return techWorkbookFileName(from, to, lang).replace(/\.xlsx$/, ".pdf");
}
