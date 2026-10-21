import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import type { CalcResult, Land } from "@hagel/calc";
import { eur, fmtDateL, fmtDateTime, h1, num } from "./format";
import { dentBreak, docText, esFormula, esLines, esRange, imgLabel, partsOf, plabel, zustStr } from "./text";
import type { DocPhoto, DocVehicle, KvaOptions, Letterhead, PhotoPhase, RepairReportOptions } from "./types";
import { TECH_LABELS, techDate, type TechSheetData } from "./techsheet";

const W = 595.28, H = 841.89, L = 42, R = 553;

/** v20 strlit mapping, then restricted to what the standard font can encode (never throws). */
const MAP: Record<number, number> = {
  0x20AC: 128, 0x2013: 45, 0x2014: 45, 0x2018: 39, 0x2019: 39, 0x201C: 34, 0x201D: 34, 0x00D7: 120,
  0x2022: 45, 0x2212: 45, 0x2192: 187, 0x2265: 62, 0x00B7: 183,
};
export function winAnsi(s: string, charset?: Set<number>): string {
  s = String(s ?? "");
  let o = "";
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i);
    if (MAP[code] !== undefined) code = MAP[code];
    if (code > 255) code = 63;
    if (code === 9 || code === 10 || code === 13) code = 32;
    let ch: string;
    if (code === 128) ch = "€";
    else if (code < 32 || (code >= 127 && code <= 159)) ch = "?";
    else ch = String.fromCharCode(code);
    if (charset && !charset.has(ch.codePointAt(0)!)) ch = "?";
    o += ch;
  }
  return o;
}

export function wrapText(str: string, maxChars: number): string[] {
  const out: string[] = [];
  String(str).split(/\n/).forEach((par) => {
    const words = par.split(/\s+/);
    let cur = "";
    words.forEach((w) => {
      if (cur && (cur + " " + w).length > maxChars) { out.push(cur); cur = w; } else cur = cur ? cur + " " + w : w;
    });
    out.push(cur);
  });
  return out;
}

type RGB = [number, number, number];

class Canvas {
  doc!: PDFDocument;
  page!: PDFPage;
  f1!: PDFFont;
  f2!: PDFFont;
  charset = new Set<number>();
  fillC: RGB = [0, 0, 0];
  strokeC: RGB = [0, 0, 0];
  y = 0;

  static async create(now: Date): Promise<Canvas> {
    const c = new Canvas();
    c.doc = await PDFDocument.create();
    c.doc.setCreationDate(now);
    c.doc.setModificationDate(now);
    c.doc.setProducer("@hagel/documents");
    c.doc.setCreator("@hagel/documents");
    c.f1 = await c.doc.embedFont(StandardFonts.Helvetica);
    c.f2 = await c.doc.embedFont(StandardFonts.HelveticaBold);
    c.charset = new Set(c.f1.getCharacterSet());
    c.np();
    return c;
  }
  np() { this.page = this.doc.addPage([W, H]); }
  top() { this.y = H - 50; }
  rgbc(r: number, g: number, b: number) { this.fillC = [r, g, b]; }
  RG(r: number, g: number, b: number) { this.strokeC = [r, g, b]; }
  black() { this.rgbc(0, 0, 0); }
  rect(x: number, yy: number, w: number, h: number) {
    this.page.drawRectangle({ x, y: yy, width: w, height: h, color: rgb(...(this.fillC.map((v) => v / 255) as RGB)) });
  }
  line(x1: number, y1: number, x2: number, y2: number, wd = 0.6) {
    this.page.drawLine({
      start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: wd,
      color: rgb(...(this.strokeC.map((v) => v / 255) as RGB)),
    });
  }
  T(x: number, yy: number, str: string, size: number, bold = false) {
    this.page.drawText(winAnsi(str, this.charset), {
      x, y: yy, size, font: bold ? this.f2 : this.f1, color: rgb(...(this.fillC.map((v) => v / 255) as RGB)),
    });
  }
  widthOf(str: string, size: number, bold = false) {
    return (bold ? this.f2 : this.f1).widthOfTextAtSize(winAnsi(str, this.charset), size);
  }
}

function hasLetterheadText(lh: Letterhead | null | undefined) {
  return !!lh && !!(lh.address || lh.taxId || lh.email);
}

/** Draws logo / name / contact lines top right; returns the y of the title bar top. */
async function drawLetterhead(cv: Canvas, lh: Letterhead | null | undefined): Promise<number> {
  if (!lh) return H - 40;
  let top = H - 26, drew = false;
  let logoImg: PDFImage | null = null;
  if (lh.logo && lh.logo.bytes && lh.logo.bytes.length) {
    try { logoImg = lh.logo.kind === "png" ? await cv.doc.embedPng(lh.logo.bytes) : await cv.doc.embedJpg(lh.logo.bytes); } catch { logoImg = null; }
  }
  if (logoImg) {
    const ratio = lh.logo!.height / lh.logo!.width || logoImg.height / logoImg.width;
    let lw = 150, lhh = lw * ratio;
    if (lhh > 70) { lhh = 70; lw = lhh / ratio; }
    cv.page.drawImage(logoImg, { x: R - lw, y: H - 26 - lhh, width: lw, height: lhh });
    top -= lhh; drew = true;
  } else if (lh.name && lh.name.trim()) {
    cv.black(); cv.rgbc(22, 35, 63);
    const w = cv.widthOf(lh.name, 13, true);
    cv.T(R - w, top - 13, lh.name, 13, true);
    top -= 17; drew = true;
  }
  const lines = [lh.address, lh.taxId, lh.email].filter((x): x is string => !!x && !!x.trim())
    .flatMap((x) => x.split(/\n/)).map((x) => x.trim()).filter(Boolean);
  if (lines.length) {
    cv.rgbc(110, 120, 140);
    top -= 3;
    for (const ln of lines) { const w = cv.widthOf(ln, 8); cv.T(R - w, top - 8, ln, 8); top -= 10; }
    drew = true;
  }
  cv.black();
  return drew ? top - 14 : H - 40;
}

function drawFooters(cv: Canvas, lh: Letterhead | null | undefined) {
  const f = lh && lh.footer ? lh.footer.trim() : "";
  if (!f) return;
  const lines: string[] = [];
  for (const par of f.split(/\n/)) {
    let cur = "";
    for (const w of par.split(/\s+/)) {
      const t = cur ? cur + " " + w : w;
      if (cur && cv.widthOf(t, 8) > R - L) { lines.push(cur); cur = w; } else cur = t;
    }
    lines.push(cur);
  }
  const ls = lines.slice(0, 3);
  cv.doc.getPages().forEach((pg) => {
    cv.page = pg;
    cv.rgbc(110, 120, 140);
    ls.forEach((ln, i) => cv.T(L, 22 + (ls.length - 1 - i) * 10, ln, 8));
    cv.black();
  });
}

interface Cell { img: PDFImage; label: string; sub?: string }

async function embedPhotos(cv: Canvas, photos: DocPhoto[]): Promise<{ p: DocPhoto; img: PDFImage }[]> {
  const out: { p: DocPhoto; img: PDFImage }[] = [];
  for (const p of photos) {
    try { out.push({ p, img: await cv.doc.embedJpg(p.bytes) }); } catch { /* skip unreadable photo (as v20) */ }
  }
  return out;
}

/** 2-column photo grid, same coordinates as v20. Page header repeated via `head`. */
function photoGrid(cv: Canvas, cells: Cell[], head: () => void, rowH: number) {
  const gap = 14, cellW = (R - L - gap) / 2, boxH = 150;
  let col = 0;
  cells.forEach((cell) => {
    if (col === 0 && cv.y - rowH < 60) { cv.np(); head(); }
    const info = { w: cell.img.width, h: cell.img.height };
    const x = col === 0 ? L : L + cellW + gap;
    const scale = Math.min(cellW / info.w, boxH / info.h);
    const dw = info.w * scale, dh = info.h * scale, ix = x + (cellW - dw) / 2, iy = cv.y - dh;
    cv.page.drawImage(cell.img, { x: ix, y: iy, width: dw, height: dh });
    cv.rgbc(90, 95, 105); cv.T(x, iy - 12, cell.label, 9);
    if (cell.sub) cv.T(x, iy - 23, cell.sub, 8);
    cv.black();
    if (col === 1) { cv.y -= rowH; col = 0; } else col = 1;
  });
  if (col === 1) cv.y -= rowH;
}

export async function generateKvaPdf(v: DocVehicle, c: CalcResult, opts: KvaOptions = {}): Promise<Uint8Array> {
  const cv = await Canvas.create(opts.now || new Date());
  const lh = opts.letterhead || null;
  const X = docText(v.land);
  const land: Land = v.land === "ES" ? "ES" : "DE";
  const cols = { bt: L + 2, de: 282, oe: 352, aw: 410, eu: 470 };
  cv.top();
  cv.y = await drawLetterhead(cv, lh);
  cv.rgbc(22, 35, 63); cv.rect(L, cv.y - 30, R - L, 34);
  cv.rgbc(255, 255, 255); cv.T(L + 10, cv.y - 18, X.kva, 15, true);
  cv.T(R - 150, cv.y - 18, fmtDateL(land, v.leistungsdatum), 11);
  cv.black(); cv.y -= 54;
  cv.T(L, cv.y, X.kunde + ": " + (v.kunde || "-"), 12, true); cv.y -= 17;
  cv.T(L, cv.y, X.kz + ": " + (v.kennzeichen || "-") + "     " + X.fin + ": " + (v.fin || "-") + (v.modell ? "     " + X.modell + ": " + v.modell : ""), 11); cv.y -= 15;
  if (v.insurerName || v.claimNumber) {
    cv.T(L, cv.y, [v.insurerName ? X.versicherung + ": " + v.insurerName : "", v.claimNumber ? X.schaden + ": " + v.claimNumber : ""].filter(Boolean).join("     "), 10);
    cv.y -= 15;
  }
  cv.T(L, cv.y, X.datum + ": " + fmtDateL(land, v.leistungsdatum) + "     " + X.zustand + ": " + zustStr(v), 10); cv.y -= 26;
  if ((v.methodName || "").trim()) { cv.y += 8; cv.rgbc(120, 128, 142); cv.T(L, cv.y, X.methode + ": " + v.methodName!.trim(), 8); cv.black(); cv.y -= 18; }
  cv.rgbc(228, 238, 229); cv.rect(L, cv.y - 26, R - L, 30);
  if (c.es) {
    cv.rgbc(94, 140, 99);
    cv.T(L + 8, cv.y - 8, "Matriz: " + c.es.bollos + " bollos  -  categoría " + c.es.cat.cat + "  -  " + h1(c.es.H.h) + "   =   " + eur(c.es.matrixEur), 12, true);
  } else {
    cv.rgbc(94, 140, 99);
    cv.T(L + 8, cv.y - 8, X.rein + ": " + num(c.repairAW) + " " + X.aw + "   =   " + eur(c.repairEur), 12, true);
  }
  cv.black(); cv.y -= 46;

  const tableHeader = () => {
    cv.rgbc(10, 58, 140); cv.rect(L, cv.y - 16, R - L, 18); cv.rgbc(255, 255, 255);
    cv.T(cols.bt, cv.y - 12, X.bauteil, 10, true); cv.T(cols.de, cv.y - 12, X.dellen, 10, true);
    cv.T(cols.oe, cv.y - 12, "Ø mm", 10, true);
    if (c.es) cv.T(cols.aw, cv.y - 12, "Bollos", 10, true);
    else { cv.T(cols.aw, cv.y - 12, X.aw, 10, true); cv.T(cols.eu, cv.y - 12, "EUR", 10, true); }
    cv.black(); cv.y -= 18;
  };
  const brk = () => { if (cv.y < 70) { cv.np(); cv.top(); tableHeader(); } };
  /** "Folgende Teile sind zu ersetzen": highlighted box under the panel table (no prices) */
  const partsBox = () => {
    const parts = partsOf(v);
    if (!parts.length) return;
    const lines = parts.flatMap((p) => wrapText("- " + p, 92));
    const h = 26 + lines.length * 13;
    if (cv.y - h < 70) { cv.np(); cv.top(); }
    cv.y -= 8;
    cv.rgbc(253, 240, 225); cv.rect(L, cv.y - h + 8, R - L, h);
    cv.rgbc(138, 74, 6); cv.T(L + 8, cv.y - 8, X.teile, 10.5, true);
    cv.black(); lines.forEach((ln, i) => cv.T(L + 12, cv.y - 22 - i * 13, ln, 10));
    cv.y -= h + 6;
  };
  tableHeader();
  const row = (bauteil: string, dellen: string, oe: string, aw: string, euro: string, opt: { fill?: RGB | null; white?: boolean; bold?: boolean } = {}) => {
    brk();
    if (opt.fill) { cv.rgbc(...opt.fill); cv.rect(L, cv.y - 14, R - L, 16); }
    if (opt.white) cv.rgbc(255, 255, 255); else cv.black();
    const b = !!opt.bold;
    cv.T(cols.bt, cv.y - 11, bauteil, 9.5, b);
    if (dellen !== "") cv.T(cols.de, cv.y - 11, dellen, 9.5, b);
    if (oe !== "") cv.T(cols.oe, cv.y - 11, oe, 9.5, b);
    if (aw !== "") cv.T(cols.aw, cv.y - 11, aw, 9.5, b);
    if (euro !== "") cv.T(cols.eu, cv.y - 11, euro, 9.5, b);
    cv.black(); cv.RG(225, 229, 238); cv.line(L, cv.y - 15, R, cv.y - 15, 0.5); cv.y -= 16;
  };
  const subLines = (p: CalcResult["panels"][number]) => {
    if (p.method === "ptp") { brk(); cv.rgbc(160, 60, 50); cv.T(cols.bt + 10, cv.y - 9, X.ptp + " − 40 %", 8, true); cv.black(); cv.y -= 12; }
    const bd = dentBreak(p);
    if (bd) {
      brk();
      cv.rgbc(110, 120, 140); cv.T(cols.bt + 10, cv.y - 9, bd, 8); cv.black();
      cv.RG(232, 235, 242); cv.line(L, cv.y - 13, R, cv.y - 13, 0.4); cv.y -= 14;
    }
  };

  if (c.es) {
    const e = c.es;
    c.panels.forEach((p, i) => {
      const name = plabel(land, p.key) + (p.alu ? " (" + X.alu + ")" : "") + (p.kleber && p.method !== "erneuern" ? " +" + X.kleber : "") +
        (p.method === "ptp" ? " (PTP)" : "") + (p.method === "erneuern" ? " (" + X.erneuern + ")" : "");
      row(name, String(p.total + (+(p.big || 0))), String(p.avgClass), String(p.bollos), "", { fill: i % 2 ? [246, 248, 251] : null });
      subLines(p);
    });
    row("TOTAL  (" + e.small + " + " + e.large + " × 2)", String(c.dents), String(c.avg), String(e.bollos), "", { fill: [22, 35, 63], white: true, bold: true });
    partsBox();
    cv.y -= 10; if (cv.y < 120) { cv.np(); cv.top(); }
    cv.rgbc(110, 120, 140);
    cv.T(L, cv.y, "Bollos: hasta 30 mm = 1, más de 30 mm = 2.  Categoría " + e.cat.cat + " (" + esRange(e.cat) + " bollos), tope " + h1(e.cat.cap_h) + " = " + eur(e.cap) + ".", 8.5); cv.y -= 12;
    cv.T(L, cv.y, esFormula(e, "es").replace(/→/g, "->").replace(/≥/g, ">="), 8.5); cv.black(); cv.y -= 22;
    const tl = (l: string, val: string, bold: boolean) => { if (cv.y < 80) { cv.np(); cv.top(); } cv.T(L, cv.y, l, 10, bold); cv.T(R - 95, cv.y, val, 10, bold); cv.y -= 15; };
    esLines(v, c).forEach((x) => tl(x.l, x.open ? "aparte" : eur(x.v), false));
    cv.RG(180, 180, 180); cv.line(L, cv.y + 5, R, cv.y + 5, 0.5); cv.y -= 4;
    tl(X.netto, eur(c.netto), true); tl(X.mwst, eur(c.brutto - c.netto), false);
    cv.RG(180, 180, 180); cv.line(R - 240, cv.y + 3, R, cv.y + 3, 0.7); cv.y -= 6;
    cv.rgbc(94, 140, 99); cv.T(R - 235, cv.y - 6, X.brutto, 13, true); cv.T(R - 105, cv.y - 6, eur(c.brutto), 13, true); cv.black(); cv.y -= 30;
  } else {
    c.panels.forEach((p, i) => {
      const name = plabel(land, p.key) + (p.alu ? " (" + X.alu + ")" : "") + (p.kleber ? " +" + X.kleber : "") +
        (p.method === "ptp" ? " (PTP)" : "") + (p.method === "erneuern" ? " (" + X.erneuern + ")" : "");
      if (p.total > 0) {
        row(name, String(p.total), String(p.avgClass), num(p.repair), eur(p.repair * c.euroPerAW), { fill: i % 2 ? [246, 248, 251] : null });
        subLines(p);
      }
    });
    row(X.summe, String(c.dents), String(c.avg), num(c.repairAW), eur(c.repairEur), { fill: [238, 241, 245], bold: true });
    if (c.bigCount > 0) row(X.sonder, String(c.bigCount), ">85", c.bigEur > 0 ? "" : "?", c.bigEur > 0 ? eur(c.bigEur) : X.manuell, {});
    const neb = (l: string, aw: number) => { if (aw > 0) row(l, "", "", num(aw), eur(aw * c.euroPerAW), {}); };
    neb(X.finish, c.finishAW); neb(X.ruest, c.ruestAW); neb(X.greif, c.greifAW); neb(X.hohl, c.hohlAW); neb(X.verbr, c.verbrAW);
    row(X.gesamt.toUpperCase(), String(c.dents), String(c.avg), num(c.totalAW), eur(c.awNetto), { fill: [22, 35, 63], white: true, bold: true });
    partsBox();
    cv.y -= 14;
    const tot = (l: string, val: string, bold: boolean) => { cv.T(R - 235, cv.y, l, 10, bold); cv.T(R - 95, cv.y, val, 10, bold); cv.y -= 15; };
    tot(X.awnetto, eur(c.awNetto), false);
    if (c.bigEur > 0) tot(X.sonderS, eur(c.bigEur), false);
    if (c.kleberMat + c.hohlMat > 0) tot(X.material, eur(c.kleberMat + c.hohlMat), false);
    if (c.demEur > 0) tot(X.demont, eur(c.demEur), false);
    c.glass.forEach((g) => tot(g.de, g.eur > 0 ? eur(g.eur) : "separat", false));
    tot(X.netto, eur(c.netto), true);
    tot(X.mwst, eur(c.brutto - c.netto), false);
    cv.RG(180, 180, 180); cv.line(R - 240, cv.y + 3, R, cv.y + 3, 0.7); cv.y -= 6;
    cv.rgbc(94, 140, 99); cv.T(R - 235, cv.y - 6, X.brutto, 13, true); cv.T(R - 105, cv.y - 6, eur(c.brutto), 13, true); cv.black(); cv.y -= 30;
  }
  if ((v.notiz || "").trim()) {
    if (cv.y < 150) { cv.np(); cv.top(); }
    cv.black(); cv.T(L, cv.y, X.notiz + ":", 11, true); cv.y -= 16;
    wrapText(v.notiz!, 98).forEach((ln) => { if (cv.y < 70) { cv.np(); cv.top(); } cv.T(L, cv.y, ln, 10); cv.y -= 14; });
  }
  cv.black();

  // ---- photos (only inPdf) ----
  const emb = await embedPhotos(cv, (opts.photos || []).filter((p) => p.inPdf));
  if (emb.length) {
    cv.np();
    const head = () => { cv.black(); cv.y = H - 56; cv.T(L, cv.y, X.fotos, 14, true); cv.y -= 26; };
    head();
    photoGrid(cv, emb.map(({ p, img }) => ({ img, label: imgLabel(land, p.label) || X.foto })), head, 150 + 30);
  }
  drawFooters(cv, lh);
  cv.doc.setTitle(X.kva + " " + (v.kennzeichen || ""));
  return cv.doc.save();
}

export async function appendScanPdf(kva: Uint8Array, scan: Uint8Array, title?: string): Promise<Uint8Array> {
  const out = await PDFDocument.load(kva);
  const src = await PDFDocument.load(scan, { ignoreEncryption: true });
  const pgs = await out.copyPages(src, src.getPageIndices());
  pgs.forEach((pg) => out.addPage(pg));
  if (title) out.setTitle(title);
  return out.save();
}

export async function generateRepairPhotoReport(v: DocVehicle, opts: RepairReportOptions): Promise<Uint8Array> {
  const cv = await Canvas.create(opts.now || new Date());
  const lh = opts.letterhead || null;
  const X = docText(v.land);
  const land: Land = v.land === "ES" ? "ES" : "DE";
  cv.top();
  cv.y = await drawLetterhead(cv, lh);
  cv.rgbc(22, 35, 63); cv.rect(L, cv.y - 30, R - L, 34);
  cv.rgbc(255, 255, 255); cv.T(L + 10, cv.y - 18, X.fotobericht, 15, true);
  cv.black(); cv.y -= 54;
  cv.T(L, cv.y, X.kunde + ": " + (v.kunde || "-"), 12, true); cv.y -= 17;
  cv.T(L, cv.y, X.kz + ": " + (v.kennzeichen || "-") + "     " + X.fin + ": " + (v.fin || "-") + (v.modell ? "     " + X.modell + ": " + v.modell : ""), 11); cv.y -= 15;
  if (v.insurerName || v.claimNumber) {
    cv.T(L, cv.y, [v.insurerName ? X.versicherung + ": " + v.insurerName : "", v.claimNumber ? X.schaden + ": " + v.claimNumber : ""].filter(Boolean).join("     "), 10);
    cv.y -= 15;
  }
  if (opts.amounts) {
    // amounts of the estimate (net / VAT / gross); the internal split is never part of this document
    cv.rgbc(228, 238, 229); cv.rect(L, cv.y - 8, R - L, 24);
    cv.rgbc(47, 85, 53);
    cv.T(L + 8, cv.y, X.netto + ": " + eur(opts.amounts.netto) + "     " + X.mwst + ": " + eur(opts.amounts.mwst) + "     " + X.brutto + ": " + eur(opts.amounts.brutto), 10, true);
    cv.black(); cv.y -= 26;
  }
  if (partsOf(v).length) {
    // the repair photo report names the parts to replace in its header
    cv.rgbc(138, 74, 6);
    wrapText(X.teile + " " + partsOf(v).join(", "), 100).forEach((ln) => { cv.T(L, cv.y, ln, 9.5); cv.y -= 13; });
    cv.black();
  }
  cv.y -= 14;
  const emb = await embedPhotos(cv, opts.photos || []);
  const phases: [PhotoPhase, string][] = [["besichtigung", X.phBesichtigung], ["reparatur", X.phReparatur], ["fertig", X.phFertig]];
  const rowH = 150 + 42;
  for (const [ph, title] of phases) {
    const items = emb.filter(({ p }) => (p.phase || "besichtigung") === ph);
    if (!items.length) continue;
    const head = () => { cv.black(); cv.y = H - 56; };
    if (cv.y - rowH - 30 < 60) { cv.np(); head(); }
    cv.black(); cv.T(L, cv.y, title, 12, true);
    cv.RG(225, 229, 238); cv.line(L, cv.y - 4, R, cv.y - 4, 0.6);
    cv.y -= 22;
    photoGrid(cv, items.map(({ p, img }) => ({
      img, label: imgLabel(land, p.label) || X.foto, sub: p.takenAt ? fmtDateTime(land, p.takenAt, opts.timeZone) : undefined,
    })), () => { head(); cv.T(L, cv.y, title, 12, true); cv.y -= 22; }, rowH);
    cv.y -= 6;
  }
  drawFooters(cv, lh);
  cv.doc.setTitle(X.fotobericht + " " + (v.kennzeichen || ""));
  return cv.doc.save();
}

// ------------------------------------------------------------------ technician worksheets (one page per technician)

/**
 * "PDR Technician Worksheet" like the paper one: technician, site, period, table of the cars finished in the period with the amount,
 * summary and two signature lines. One section per technician (it flows to further pages when the table is long). Internal document.
 */
export async function generateTechnicianWorksheets(data: { from: string | null; to: string | null; sheets: TechSheetData[] }, lang: "de" | "en" = "de", now: Date = new Date()): Promise<Uint8Array> {
  const l = TECH_LABELS[lang];
  const cv = await Canvas.create(now);
  const money = (n: number) => `${n.toLocaleString(lang === "de" ? "de-DE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const aw = (n: number) => n.toLocaleString(lang === "de" ? "de-DE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const period = `${data.from ? techDate(data.from) : "…"} – ${data.to ? techDate(data.to) : "…"}`;
  // columns: start, end, plate, model, AW (right), amount (right)
  const X = [L, L + 78, L + 156, L + 246, L + 420, R];
  const right = (x: number, y: number, s: string, size: number, bold = false) => cv.T(x - cv.widthOf(s, size, bold), y, s, size, bold);
  const clip = (s: string, w: number, size: number) => { let t = s; while (t.length > 1 && cv.widthOf(t, size) > w) t = t.slice(0, -1); return t; };

  const header = (t: TechSheetData | null) => {
    cv.top(); cv.black();
    cv.T(L, cv.y, l.title, 20, true); cv.y -= 28;
    if (t) {
      cv.T(L, cv.y, `${l.tech}: `, 11, true); cv.T(L + cv.widthOf(`${l.tech}: `, 11, true), cv.y, t.technician, 11); cv.y -= 18;
      cv.T(L, cv.y, `${l.site}: `, 11, true); cv.T(L + cv.widthOf(`${l.site}: `, 11, true), cv.y, clip(t.sites.join(", ") || "—", 400, 11), 11); cv.y -= 18;
    }
    cv.T(L, cv.y, `${l.period}: `, 11, true); cv.T(L + cv.widthOf(`${l.period}: `, 11, true), cv.y, period, 11); cv.y -= 26;
  };
  const tableHead = () => {
    cv.rgbc(243, 243, 243); cv.rect(L, cv.y - 6, R - L, 24);
    cv.black();
    cv.T(X[0] + 4, cv.y, l.start, 9.5, true); cv.T(X[1] + 4, cv.y, l.end, 9.5, true); cv.T(X[2] + 4, cv.y, l.plate, 9.5, true); cv.T(X[3] + 4, cv.y, l.model, 9.5, true);
    right(X[4] - 4, cv.y, l.aw, 9.5, true); right(X[5] - 4, cv.y, l.pay, 9.5, true);
    cv.RG(22, 35, 63); cv.line(L, cv.y - 6, R, cv.y - 6, 1.6);
    cv.y -= 24;
  };

  if (!data.sheets.length) { header(null); cv.T(L, cv.y, l.none, 12); return cv.doc.save(); }
  data.sheets.forEach((t, idx) => {
    if (idx > 0) cv.np();
    header(t); tableHead();
    for (const v of t.vehicles) {
      if (cv.y < 120) { cv.np(); cv.top(); tableHead(); }
      cv.black();
      cv.T(X[0] + 4, cv.y, v.start ? techDate(v.start) : "—", 10); cv.T(X[1] + 4, cv.y, techDate(v.end), 10);
      cv.T(X[2] + 4, cv.y, clip(v.plate, X[3] - X[2] - 8, 10), 10); cv.T(X[3] + 4, cv.y, clip(v.model, X[4] - X[3] - 40, 10), 10);
      right(X[4] - 4, cv.y, aw(v.aw), 10); right(X[5] - 4, cv.y, money(v.eur), 10);
      cv.RG(225, 229, 238); cv.line(L, cv.y - 6, R, cv.y - 6, 0.6);
      cv.y -= 20;
    }
    if (cv.y < 300) { cv.np(); cv.top(); }
    cv.y -= 14; cv.black(); cv.T(L, cv.y, l.summary, 15, true); cv.y -= 22;
    const line = (label: string, value: string, strong = false) => {
      if (strong) { cv.rgbc(243, 243, 243); cv.rect(L, cv.y - 6, R - L, 22); cv.RG(22, 35, 63); cv.line(L, cv.y + 16, R, cv.y + 16, 1.6); cv.line(L, cv.y - 6, R, cv.y - 6, 1.6); }
      cv.black(); cv.T(L + 6, cv.y, label, 10.5, true); right(R - 6, cv.y, value, 10.5, strong);
      if (!strong) { cv.RG(225, 229, 238); cv.line(L, cv.y - 6, R, cv.y - 6, 0.6); }
      cv.y -= 22;
    };
    line(l.cars, String(t.totals.n)); line(l.totalAw, aw(t.totals.aw)); line(l.totalPdr, money(t.totals.pdrEur)); line(l.totalDem, money(t.totals.demEur)); line(l.total, money(t.totals.eur), true);
    for (const label of [l.signSite, l.signTech]) {
      cv.y -= 46; cv.black(); cv.RG(0, 0, 0); cv.line(L, cv.y, L + 360, cv.y, 1.2);
      cv.T(L, cv.y - 15, l.date, 10.5); cv.T(L + 110, cv.y - 15, label, 10.5);
    }
  });
  return cv.doc.save();
}
