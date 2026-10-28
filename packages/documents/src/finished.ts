import { S, packSheets, r2, sheetName, sheetXml, techDate, type Row, type TechLang } from "./techsheet";

/** One finished or returned car of a period with how its agreed price is split (internal document). */
export interface FinishedRow {
  plate: string; model: string; insurer: string; bodyshop: string; station: string; end: string;
  total: number; technician: number; headliner: number; referrer: number; pdr: number;
}
export interface FinishedExportData { from: string | null; to: string | null; rows: FinishedRow[] }

const LABELS = {
  de: { all: "Alle", title: "Fertige und zurückgegebene Fahrzeuge", period: "Zeitraum", plate: "Kennzeichen", model: "Marke und Modell", insurer: "Versicherung", bodyshop: "Body Shop", total: "Vereinbarter Gesamtpreis (netto)", tech: "Anteil Techniker", head: "Anteil Headliner", ref: "Anteil vermittelnder Body Shop", pdr: "Verbleibt bei PDR Team", station: "Station", end: "Fertig am", sum: "Summe" },
  en: { all: "All", title: "Finished and returned vehicles", period: "Period", plate: "Vehicle registration number", model: "Vehicle make and model", insurer: "Insurance company", bodyshop: "Bodyshop", total: "Total price agreed after assessment (net)", tech: "Technician's share", head: "Headliner's share", ref: "Referring bodyshop's share", pdr: "Remaining amount for PDR Team", station: "Station", end: "Finished on", sum: "Total" },
  fr: { all: "Toutes", title: "Véhicules terminés et rendus", period: "Période", plate: "Immatriculation", model: "Marque et modèle", insurer: "Assurance", bodyshop: "Carrosserie", total: "Prix total convenu après expertise (HT)", tech: "Part du technicien", head: "Part du headliner", ref: "Part de la carrosserie apporteuse", pdr: "Reste pour PDR Team", station: "Station", end: "Terminé le", sum: "Total" },
  es: { all: "Todas", title: "Vehículos terminados y entregados", period: "Periodo", plate: "Matrícula", model: "Marca y modelo", insurer: "Aseguradora", bodyshop: "Taller", total: "Precio total acordado tras la peritación (neto)", tech: "Parte del técnico", head: "Parte del headliner", ref: "Parte del taller que remite", pdr: "Resto para PDR Team", station: "Estación", end: "Terminado el", sum: "Total" },
} as const;

export function finishedFileName(from: string | null, to: string | null, lang: TechLang = "de"): string {
  const base = { de: "Fertige_Fahrzeuge", en: "Finished_vehicles", fr: "Vehicules_termines", es: "Vehiculos_terminados" }[lang];
  return `${base}_${from ?? "alle"}_${to ?? "alle"}.xlsx`;
}

/** Workbook: one sheet with every car; when the cars come from several stations, one more sheet per station. */
export function buildFinishedWorkbook(data: FinishedExportData, lang: TechLang = "de"): Uint8Array {
  const l = LABELS[lang];
  const period = [data.from ? techDate(data.from) : "…", data.to ? techDate(data.to) : "…"].join(" – ");
  const sum = (rows: FinishedRow[], k: "total" | "technician" | "headliner" | "referrer" | "pdr") => r2(rows.reduce((a, r) => a + r[k], 0));
  const sheetOf = (rows: FinishedRow[], heading: string) => {
    const out: Row[] = [
      { ht: 24, cells: [[`${l.title} · ${heading}`, S.title]] },
      { cells: [[l.period + ":", S.bold], [period, S.def]] },
      { cells: [] },
      { ht: 42, cells: [[l.plate, S.head], [l.model, S.head], [l.insurer, S.head], [l.bodyshop, S.head], [l.total, S.headRight], [l.tech, S.headRight], [l.head, S.headRight], [l.ref, S.headRight], [l.pdr, S.headRight], [l.station, S.head], [l.end, S.head]] },
    ];
    for (const r of rows) out.push({ cells: [[r.plate, S.def], [r.model, S.def], [r.insurer, S.def], [r.bodyshop, S.def], [r.total, S.money], [r.technician, S.money], [r.headliner, S.money], [r.referrer, S.money], [r.pdr, S.money], [r.station, S.def], [techDate(r.end), S.def]] });
    out.push({ cells: [[`${l.sum} (${rows.length})`, S.totLabel], [null, S.totLabel], [null, S.totLabel], [null, S.totLabel], [sum(rows, "total"), S.totMoney], [sum(rows, "technician"), S.totMoney], [sum(rows, "headliner"), S.totMoney], [sum(rows, "referrer"), S.totMoney], [sum(rows, "pdr"), S.totMoney], [null, S.totLabel], [null, S.totLabel]] });
    return sheetXml([16, 24, 20, 24, 20, 14, 14, 18, 18, 18, 12], out);
  };
  const used = new Set<string>();
  const sheets = [{ name: sheetName(l.all, used), xml: sheetOf(data.rows, l.all) }];
  const stations = [...new Set(data.rows.map((r) => r.station))].sort((a, b) => a.localeCompare(b, "de"));
  if (stations.length > 1) for (const s of stations) sheets.push({ name: sheetName(s || "—", used), xml: sheetOf(data.rows.filter((r) => r.station === s), s || "—") });
  return packSheets(sheets);
}
