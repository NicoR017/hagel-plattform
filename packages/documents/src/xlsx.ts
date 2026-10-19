import { DEFAULT_SETTINGS, computeShares, computeVehicle, vehicleSettings } from "@hagel/calc";
import type { CalcResult, Settings, SharesResult } from "@hagel/calc";
import { fmtDate } from "./format";
import { statusLabel } from "./text";
import type { DocVehicle, ExportVehicle, XlsxColumns } from "./types";
import { zipStore } from "./zip";

function xesc(s: unknown): string {
  const m: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => m[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
export function colL(i: number): string {
  let s = ""; i++;
  while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

type Cellv = string | number | null | undefined;
interface Col { head: string; width: number; style: 0 | 2 | 4 | 7; sum?: boolean; group: "all" | "prices" | "split"; get: (r: RowCtx) => Cellv }
interface RowCtx { v: DocVehicle; c: CalcResult; a: SharesResult; s: Settings }

function sheetXML(cols: { head: string; width: number }[], rows: Cellv[][], fmt: (ci: number) => number, sumC: Set<number>, freezeX: number) {
  const cell = (r: number, ci: number, val: Cellv, st: number) => {
    const ref = colL(ci) + r;
    if (val === null || val === undefined || val === "") return `<c r="${ref}" s="${st || 0}"/>`;
    if (typeof val === "number") return `<c r="${ref}" s="${st || 0}"><v>${val}</v></c>`;
    return `<c r="${ref}" s="${st || 0}" t="inlineStr"><is><t xml:space="preserve">${xesc(val)}</t></is></c>`;
  };
  let sd = `<row r="1" ht="32" customHeight="1">` + cols.map((c, i) => cell(1, i, c.head, 1)).join("") + `</row>`;
  rows.forEach((r, ri) => { const rr = ri + 2; sd += `<row r="${rr}">` + r.map((v, ci) => cell(rr, ci, v, fmt(ci))).join("") + `</row>`; });
  const last = rows.length + 1, sr = last + 1;
  sd += `<row r="${sr}">` + cols.map((_c, ci) => {
    const ref = colL(ci) + sr;
    if (ci === 0) return `<c r="${ref}" s="5" t="inlineStr"><is><t>Summe (${rows.length})</t></is></c>`;
    if (sumC.has(ci)) { const f = fmt(ci); return `<c r="${ref}" s="${f === 2 ? 3 : f === 4 ? 6 : 5}"><f>SUM(${colL(ci)}2:${colL(ci)}${last})</f></c>`; }
    return `<c r="${ref}" s="5"/>`;
  }).join("") + `</row>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" xSplit="${freezeX}" topLeftCell="${colL(freezeX)}2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join("")}</cols>
<sheetData>${sd}</sheetData>${rows.length ? `<autoFilter ref="A1:${colL(cols.length - 1)}${last}"/>` : ""}</worksheet>`;
}

const p4 = (x: number) => +(x / 100).toFixed(4);
const p2 = (x: number) => +x.toFixed(2);

function scanMark(v: DocVehicle): string {
  const c = v.colibri;
  if (!c || c.imported == null) return "";
  const total = c.reportTotal != null ? c.reportTotal : c.rowSum;
  const ok = c.imported === total && !(c.unknown || []).length;
  return ok ? "✓" : "prüfen";
}

const COLS: Col[] = [
  { head: "Datum", width: 11, style: 0, group: "all", get: (r) => fmtDate(r.v.leistungsdatum) },
  { head: "Kennzeichen", width: 13, style: 0, group: "all", get: (r) => r.v.kennzeichen || "" },
  { head: "Modell", width: 18, style: 0, group: "all", get: (r) => r.v.modell || "" },
  { head: "FIN", width: 20, style: 0, group: "all", get: (r) => r.v.fin || "" },
  { head: "Kunde", width: 18, style: 0, group: "all", get: (r) => r.v.kunde || "" },
  { head: "Versicherung", width: 18, style: 0, group: "all", get: (r) => r.v.insurerName || "" },
  { head: "Schadennummer", width: 16, style: 0, group: "all", get: (r) => r.v.claimNumber || "" },
  { head: "Plattform", width: 14, style: 0, group: "all", get: (r) => r.v.stationName || "" },
  { head: "Land", width: 6, style: 0, group: "all", get: (r) => r.v.land },
  { head: "Dellen", width: 8, style: 0, sum: true, group: "all", get: (r) => r.c.dents },
  { head: "Bollos", width: 8, style: 0, sum: true, group: "all", get: (r) => (r.c.es ? r.c.es.bollos : null) },
  { head: "Kat.", width: 6, style: 0, group: "all", get: (r) => (r.c.es ? r.c.es.cat.cat : "") },
  { head: "Stunden", width: 9, style: 4, sum: true, group: "all", get: (r) => (r.c.es ? r.c.es.totH : null) },
  { head: "€/h", width: 8, style: 2, group: "all", get: (r) => vehicleSettings(r.v, r.s).stundensatz },
  { head: "Preis netto", width: 13, style: 2, sum: true, group: "prices", get: (r) => p2(r.c.netto) },
  { head: "MwSt/IVA", width: 12, style: 2, sum: true, group: "prices", get: (r) => p2(r.c.brutto - r.c.netto) },
  { head: "Brutto", width: 13, style: 2, sum: true, group: "prices", get: (r) => p2(r.c.brutto) },
  { head: "Provision %", width: 10, style: 7, group: "split", get: (r) => p4(r.a.werkPct) },
  { head: "Provision €", width: 13, style: 2, sum: true, group: "split", get: (r) => p2(r.a.werkEur) },
  { head: "Techniker Dellen", width: 16, style: 0, group: "split", get: (r) => r.a.techName },
  { head: "Techniker %", width: 10, style: 7, group: "split", get: (r) => p4(r.a.techPct) },
  { head: "Techniker €", width: 13, style: 2, sum: true, group: "split", get: (r) => p2(r.a.techEur) },
  { head: "De-/Remontage €", width: 13, style: 2, sum: true, group: "split", get: (r) => r.a.demEur || null },
  { head: "Techniker De-/Re", width: 16, style: 0, group: "split", get: (r) => (r.a.demEur ? r.a.demTechName : "") },
  { head: "De-/Re %", width: 9, style: 7, group: "split", get: (r) => (r.a.demEur ? p4(r.a.demTechPct) : null) },
  { head: "De-/Re Techniker €", width: 13, style: 2, sum: true, group: "split", get: (r) => (r.a.demEur ? p2(r.a.demTechEur) : null) },
  { head: "Scheiben €", width: 11, style: 2, sum: true, group: "prices", get: (r) => r.c.glassEur || null },
  { head: "Bleibt PDR €", width: 13, style: 2, sum: true, group: "split", get: (r) => p2(r.a.rest) },
  { head: "Status", width: 14, style: 0, group: "all", get: (r) => statusLabel(r.v.status, "DE") },
  { head: "Scan", width: 9, style: 0, group: "all", get: (r) => scanMark(r.v) },
  { head: "Notiz", width: 30, style: 0, group: "all", get: (r) => (r.v.notiz || "").replace(/\s+/g, " ").trim() },
];

export function xlsxColumnHeaders(columns: XlsxColumns): string[] {
  return COLS.filter((c) => c.group === "all" || (c.group === "prices" ? columns.prices : columns.internalSplit)).map((c) => c.head);
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16233F"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4EEE5"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="2" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="165" fontId="2" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function xlsxFileName(title: string, date?: string): string {
  const base = "Tagesliste_" + title.replace(/[^A-Za-z0-9äöüÄÖÜ.]+/g, "_") + (date ? "_" + date : "") + ".xlsx";
  return base.replace(/_+/g, "_");
}

export function buildXlsx(rows: ExportVehicle[], title: string, columns: XlsxColumns, opts: { settings?: Settings } = {}): Uint8Array {
  const s = opts.settings || DEFAULT_SETTINGS;
  const cols = COLS.filter((c) => c.group === "all" || (c.group === "prices" ? columns.prices : columns.internalSplit));
  const pay: Record<string, { fz: Set<string>; pdr: number; dem: number; nDem: number }> = {};
  const add = (n: string, k: "pdr" | "dem", e: number) => {
    n = n || "(ohne Namen)";
    const t = pay[n] = pay[n] || { fz: new Set(), pdr: 0, dem: 0, nDem: 0 };
    if (k === "pdr") t.pdr += e; else { t.dem += e; t.nDem++; }
  };
  const data = rows.map((v) => {
    const c = computeVehicle(v, s);
    const a = computeShares(v, c);
    if (columns.internalSplit) {
      if (a.techEur > 0) { add(a.techName, "pdr", a.techEur); pay[a.techName || "(ohne Namen)"].fz.add(v.id); }
      if (a.demTechEur > 0) add(a.demTechName, "dem", a.demTechEur);
    }
    const ctx: RowCtx = { v, c, a, s };
    return cols.map((col) => col.get(ctx));
  });
  const sumC = new Set<number>();
  cols.forEach((c, i) => { if (c.sum) sumC.add(i); });
  const sh1 = sheetXML(cols, data, (ci) => cols[ci].style, sumC, 2);
  const enc = new TextEncoder();
  const F = (name: string, str: string) => ({ name, data: enc.encode(str) });
  const sname = xesc(title.replace(/[\\\/\?\*\[\]:]/g, "-").slice(0, 31)) || "Fahrzeuge";
  const withSplit = columns.internalSplit;
  let sh2 = "";
  if (withSplit) {
    const C2 = [["Techniker", 20], ["Fahrzeuge Dellen", 12], ["Dellen (PDR) €", 14], ["De-/Remontagen", 12], ["De-/Remontage €", 14], ["Gesamt auszahlen €", 16]] as const;
    const rows2 = Object.keys(pay).sort((x, y) => x.localeCompare(y, "de")).map((n) => {
      const t = pay[n];
      return [n, t.fz.size, p2(t.pdr), t.nDem, p2(t.dem), p2(t.pdr + t.dem)] as Cellv[];
    });
    sh2 = sheetXML(C2.map((c) => ({ head: c[0], width: c[1] })), rows2, (ci) => (ci === 2 || ci === 4 || ci === 5 ? 2 : 0), new Set([1, 2, 3, 4, 5]), 1);
  }
  const NS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
  const ct = NS + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    (withSplit ? `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` : "") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const wb = NS + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sname}" sheetId="1" r:id="rId1"/>` +
    (withSplit ? `<sheet name="Abrechnung je Techniker" sheetId="2" r:id="rId3"/>` : "") + `</sheets></workbook>`;
  const wbRels = NS + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    (withSplit ? `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` : "") +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const files = [
    F("[Content_Types].xml", ct),
    F("_rels/.rels", NS + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    F("xl/workbook.xml", wb),
    F("xl/_rels/workbook.xml.rels", wbRels),
    F("xl/styles.xml", STYLES),
    F("xl/worksheets/sheet1.xml", sh1),
  ];
  if (withSplit) files.push(F("xl/worksheets/sheet2.xml", sh2));
  return zipStore(files);
}
