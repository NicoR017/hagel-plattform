// V6: the automatic insurer report (PDF): what is on it, in which language, in which order, with or without annex and amounts.
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { generateInsurerReport, insurerReportFileName, reportDate, reportMoney, reportPercent, type InsurerReportData, type InsurerReportRow } from "../src";

const NOW = new Date("2026-10-26T15:30:00Z");

/** drawn text, one entry per page (the PDF is made with the standard fonts: hex strings in the content stream) */
async function pages(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((pg) => {
    const contents = pg.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    let out = "";
    for (const r of refs) {
      const st = doc.context.lookup(r as never);
      if (!(st instanceof PDFRawStream)) continue;
      const txt = Buffer.from(decodePDFRawStream(st).decode()).toString("latin1");
      for (const m of txt.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
        let s = "";
        for (let i = 0; i < m[1].length; i += 2) { const b = parseInt(m[1].slice(i, i + 2), 16); s += b === 0x80 ? "€" : String.fromCharCode(b); }
        out += s + "\n";
      }
    }
    return out;
  });
}
const text = async (b: Uint8Array) => (await pages(b)).join("\n");

const row = (i: number, o: Partial<InsurerReportRow> = {}): InsurerReportRow => ({
  plate: `${1000 + i} KLM`, model: "Seat Leon", bodyshop: "Chapauto SL", station: "Madrid", inspectedOn: "2026-10-20", status: "fertig",
  repairedOn: null, refusedOn: null, appointmentOn: null, net: 100 + i, ...o,
});
const data = (o: Partial<InsurerReportData> = {}): InsurerReportData => ({
  name: "Allianz semanal", insurers: ["Allianz Seguros"], period: { from: "2026-10-19", to: "2026-10-25" }, projectStart: "2026-09-01", asOf: "2026-10-26",
  kpis: ["inspected", "repaired", "backlog", "upcoming", "progress"],
  figures: { inspected: { period: 41, total: 318 }, repaired: { period: 29, total: 207 }, refused: { period: 2, total: 11 }, backlog: 63, upcoming: 37, progress: 65.1 },
  trend: Array.from({ length: 8 }, (_, i) => ({ from: "2026-09-01", to: `2026-09-${String(7 + i * 3).padStart(2, "0")}`, inspected: 10 + i, repaired: 5 + i })),
  annex: null, showAmounts: false, ...o,
});

describe("insurer report PDF", () => {
  it("one page with the figures, the period and the date of the snapshot (Spanish)", async () => {
    const b = await generateInsurerReport(data(), { lang: "es", now: NOW });
    expect(Buffer.from(b.subarray(0, 4)).toString()).toBe("%PDF");
    const p = await pages(b);
    expect(p).toHaveLength(1);
    const t = p[0];
    for (const x of ["Informe de actividad PDR", "Aseguradora: ", "Allianz Seguros", "Periodo: 19/10/2026 - 25/10/2026", "desde el inicio del proyecto (01/09/2026) hasta el 25/10/2026", "Situación a fecha de 26/10/2026",
      "Vehículos peritados / escaneados", "Vehículos reparados", "Pendientes de cita de reparación", "Citas de reparación confirmadas", "Avance global", "Total acumulado: 318", "Total acumulado: 207",
      "41", "29", "63", "37", "65,1 %", "207 de 318", "Evolución por periodo", "Peritados", "Reparados", "Avance global del proyecto", "Reparados 207 de 318 vehículos peritados (65,1 %)",
      "Generado el 26/10/2026", "Página 1 / 1"]) expect(t, x).toContain(x);
    expect(t).not.toContain("Peritados sin reparación"); // the refused line was not asked for
    expect(t).not.toContain("Anexo");
  });

  it("only the figures asked for, in the order asked for", async () => {
    const t = await text(await generateInsurerReport(data({ kpis: ["progress", "refused", "inspected"] }), { lang: "es", now: NOW }));
    const at = (s: string) => t.indexOf(s);
    expect(at("Avance global\n")).toBeGreaterThan(-1);
    expect(at("Avance global\n")).toBeLessThan(at("Peritados sin reparación"));
    expect(at("Peritados sin reparación")).toBeLessThan(at("Vehículos peritados / escaneados"));
    expect(t).not.toContain("Vehículos reparados");
    expect(t).not.toContain("Pendientes de cita");
    expect(t).toContain("Total acumulado: 11"); // the refused line
  });

  it("the four languages: words, dates and numbers", async () => {
    const en = await text(await generateInsurerReport(data(), { lang: "en", now: NOW }));
    for (const x of ["PDR activity report", "Insurer: ", "Period: 19/10/2026 - 25/10/2026", "since the start of the project", "Waiting for a repair appointment", "Overall progress", "65.1 %", "Page 1 / 1"]) expect(en, x).toContain(x);
    const de = await text(await generateInsurerReport(data(), { lang: "de", now: NOW }));
    for (const x of ["PDR-Aktivitätsbericht", "Versicherung: ", "Zeitraum: 19.10.2026 - 25.10.2026", "seit Projektbeginn", "Warten auf Reparaturtermin", "Gesamtfortschritt", "65,1 %", "Seite 1 / 1", "Stand 26.10.2026"]) expect(de, x).toContain(x);
    const fr = await text(await generateInsurerReport(data(), { lang: "fr", now: NOW }));
    for (const x of ["Rapport d'activité PDR", "Assurance: ", "Période: 19/10/2026 - 25/10/2026", "depuis le début du projet", "En attente d'un rendez-vous de réparation", "Avancement global", "65,1 %", "Situation au 26/10/2026", "207 véhicules réparés sur 318 expertisés"]) expect(fr, x).toContain(x);
  });

  it("thousands in the language of the report (no character the font cannot draw)", async () => {
    const big = data({ figures: { ...data().figures, inspected: { period: 1234, total: 12345 }, repaired: { period: 5, total: 6789 } } });
    expect(await text(await generateInsurerReport(big, { lang: "es", now: NOW }))).toContain("12.345");
    expect(await text(await generateInsurerReport(big, { lang: "en", now: NOW }))).toContain("12,345");
    const fr = await text(await generateInsurerReport(big, { lang: "fr", now: NOW }));
    expect(fr).toContain("12 345");
    expect(fr).not.toContain("?"); // a narrow no-break space would have become a question mark
  });

  it("no percentage without an inspected car; no chart without a trend", async () => {
    const t = await text(await generateInsurerReport(data({ trend: [], figures: { ...data().figures, inspected: { period: 0, total: 0 }, repaired: { period: 0, total: 0 }, progress: null } }), { lang: "es", now: NOW }));
    expect(t).toMatch(/^-$/m); // the dash of the font in place of a percentage
    expect(t).not.toContain("Evolución por periodo");
    expect(t).toContain("Reparados 0 de 0 vehículos peritados");
  });

  it("annex: the cars with their status and detail, header repeated on every page, amounts only when asked", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(i, i % 4 === 0 ? { status: "fertig", repairedOn: "2026-10-23" } : i % 4 === 1 ? { status: "refuse", refusedOn: "2026-10-22" } : i % 4 === 2 ? { status: "attente", appointmentOn: "2026-11-03" } : { status: "besichtigung" }));
    const p = await pages(await generateInsurerReport(data({ annex: rows }), { lang: "es", now: NOW }));
    expect(p.length).toBeGreaterThanOrEqual(4); // the summary + at least 3 pages of annex
    const annex = p.slice(1);
    expect(annex.every((pg) => pg.includes("Matrícula") && pg.includes("Estado"))).toBe(true);
    expect(p[1]).toContain("Anexo: vehículos");
    expect(p[1]).not.toContain("Importe neto");
    expect(p[1]).not.toContain("€");
    const all = p.join("\n");
    for (const x of ["1000 KLM", "1119 KLM", "Reparado el 23/10/2026", "Rechazado el 22/10/2026", "Cita el 03/11/2026", "Terminado", "Sin reparación", "En espera", "Peritado", "Página 4 / "]) expect(all, x).toContain(x);
    expect(all.match(/1119 KLM/g)).toHaveLength(1); // every car exactly once
    const withMoney = await pages(await generateInsurerReport(data({ annex: rows.slice(0, 5), showAmounts: true }), { lang: "es", now: NOW }));
    expect(withMoney[1]).toContain("Importe neto");
    expect(withMoney[1]).toContain(reportMoney("es", 100));
    expect(withMoney[1]).toContain("104,00 €");
  });

  it("an empty annex says so; a car without a price shows a dash", async () => {
    expect(await text(await generateInsurerReport(data({ annex: [] }), { lang: "es", now: NOW }))).toContain("Sin vehículos en este periodo.");
    const t = await text(await generateInsurerReport(data({ annex: [row(1, { net: null })], showAmounts: true }), { lang: "en", now: NOW }));
    expect(t).toContain("Net amount");
    expect(t).toContain("1001 KLM");
  });

  it("text the font cannot draw never stops the report", async () => {
    const odd = row(1, { plate: "ΑΒΓ 123", model: "Škoda Octavia “RS” – 日本", bodyshop: "Taller ñandú" });
    const b = await generateInsurerReport(data({ name: "Åland", insurers: ["Ærø"], annex: [odd] }), { lang: "es", now: NOW });
    expect(Buffer.from(b.subarray(0, 4)).toString()).toBe("%PDF");
    expect(await text(b)).toContain("Taller ñandú");
  });

  it("file name and formatting helpers", () => {
    expect(insurerReportFileName({ name: "Allianz España – semanal", period: { from: "2026-10-19", to: "2026-10-25" } }, "es")).toBe("Informe_Allianz-Espana-semanal_2026-10-19_2026-10-25.pdf");
    expect(insurerReportFileName({ name: "x", period: { from: "2026-10-19", to: "2026-10-25" } }, "de")).toBe("Bericht_x_2026-10-19_2026-10-25.pdf");
    expect(reportDate("de", "2026-10-25")).toBe("25.10.2026");
    expect(reportDate("es", "2026-10-25")).toBe("25/10/2026");
    expect(reportDate("es", null)).toBe("—");
    expect(reportPercent("en", 5)).toBe("5.0 %");
    expect(reportPercent("es", null)).toBe("—");
  });
});
