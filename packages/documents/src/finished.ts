import { S, packSheets, r2, sheetName, sheetXml, techDate, type Row, type TechLang } from "./techsheet";

/**
 * One finished or returned car of a period: one row, one column per piece of information (internal document).
 * Amounts are net (HT); the gross (TTC) amounts are derived here with the car's own `vat`.
 */
export interface FinishedRow {
  id: string; station: string; statut: string; repairStart: string | null; end: string; returned: string | null;
  plate: string; vin: string; make: string; model: string; serviceDate: string; dents: number; bollos: number | null; cat: string;
  insurer: string; claim: string;
  bodyshop: string; clientCif: string; clientAddress: string; clientContact: string; clientPhone: string;
  repairShop: string; repairShopCif: string; repairShopAddress: string;
  vat: number; rate: number;
  pdrH: number; pdrBase: number; kleberH: number; kleber: number; ptpH: number; ptp: number; ptpPanels: number;
  aluH: number; alu: number; replaceH: number; replace: number; replacePanels: number; replaceList: string; partsPrice: number | null;
  other: number; dem: number; glass: number; totalH: number; total: number; check: number;
  basis: number; werkMode: string; werkPct: number; referrer: number;
  techName: string; techPct: number; technician: number; demTechName: string; demTechPct: number; headliner: number; pdr: number; shareCheck: number;
}
export interface FinishedExportData { from: string | null; to: string | null; rows: FinishedRow[] }

type L4 = readonly [string, string, string, string];
const LI = { de: 0, en: 1, fr: 2, es: 3 } as const;

const LABELS = {
  de: { all: "Alle", title: "Fertige und zurückgegebene Fahrzeuge", period: "Zeitraum", sum: "Summe", net: "netto", gross: "brutto" },
  en: { all: "All", title: "Finished and returned vehicles", period: "Period", sum: "Total", net: "net", gross: "gross" },
  fr: { all: "Toutes", title: "Véhicules terminés et rendus", period: "Période", sum: "Total", net: "HT", gross: "TTC" },
  es: { all: "Todas", title: "Vehículos terminados y entregados", period: "Periodo", sum: "Total", net: "sin IVA", gross: "con IVA" },
} as const;

const MODE: Record<string, L4> = { pct: ["%", "%", "%", "%"], staffel: ["Staffel", "Scale", "Barème", "Escala"] };

type Kind = "t" | "d" | "i" | "n" | "pct" | "m" | "m1";
interface Col { group: number; label: L4; kind: Kind; get: (r: FinishedRow, lang: TechLang) => string | number | null }
const GROUPS: L4[] = [
  ["Vorgang", "File", "Dossier", "Expediente"],
  ["Fahrzeug", "Vehicle", "Véhicule", "Vehículo"],
  ["Versicherung", "Insurance", "Assurance", "Aseguradora"],
  ["Kunden-Karosseriebetrieb", "Customer body shop", "Carrosserie cliente", "Taller cliente"],
  ["Reparatur-Karosseriebetrieb", "Repair body shop", "Carrosserie de réparation", "Taller de reparación"],
  ["Rechnungsdetail", "Invoice detail", "Détail de la facture", "Detalle de la factura"],
  ["Interne Aufteilung", "Internal split", "Répartition interne", "Reparto interno"],
];
const c = (group: number, label: L4, kind: Kind, get: Col["get"]): Col => ({ group, label, kind, get });
const COLS: Col[] = [
  c(0, ["Station", "Station", "Station", "Estación"], "t", (r) => r.station),
  c(0, ["Reparaturbeginn", "Repair start", "Date d'entrée en réparation", "Inicio de reparación"], "d", (r) => r.repairStart),
  c(0, ["Fertig am", "Finished on", "Date de fin", "Fecha de fin"], "d", (r) => r.end),
  c(0, ["Rückgabe am", "Returned on", "Date de restitution", "Fecha de entrega"], "d", (r) => r.returned),
  c(1, ["Kennzeichen", "Registration", "Immatriculation", "Matrícula"], "t", (r) => r.plate),
  c(1, ["FIN", "VIN", "VIN", "VIN"], "t", (r) => r.vin),
  c(1, ["Marke", "Make", "Marque", "Marca"], "t", (r) => r.make),
  c(1, ["Modell", "Model", "Modèle", "Modelo"], "t", (r) => r.model),
  c(2, ["Versicherung", "Insurance company", "Assurance", "Aseguradora"], "t", (r) => r.insurer),
  c(2, ["Schadennummer", "Claim number", "N° de sinistre", "N.º de siniestro"], "t", (r) => r.claim),
  c(3, ["Name", "Name", "Nom", "Nombre"], "t", (r) => r.bodyshop),
  c(3, ["CIF", "Tax ID", "CIF", "CIF"], "t", (r) => r.clientCif),
  c(3, ["Adresse", "Address", "Adresse", "Dirección"], "t", (r) => r.clientAddress),
  c(3, ["Kontakt", "Contact", "Contact", "Contacto"], "t", (r) => r.clientContact),
  c(3, ["Telefon", "Phone", "Téléphone", "Teléfono"], "t", (r) => r.clientPhone),
  c(4, ["Name", "Name", "Nom", "Nombre"], "t", (r) => r.repairShop),
  c(4, ["CIF", "Tax ID", "CIF", "CIF"], "t", (r) => r.repairShopCif),
  c(4, ["Adresse", "Address", "Adresse", "Dirección"], "t", (r) => r.repairShopAddress),
  c(5, ["PDR-Reparatur (Matrix) Std.", "PDR repair (matrix) h", "Réparation PDR (base matrice) h", "Reparación PDR (matriz) h"], "n", (r) => r.pdrH),
  c(5, ["PDR-Reparatur (Matrix)", "PDR repair (matrix)", "Réparation PDR (base matrice)", "Reparación PDR (matriz)"], "m", (r) => r.pdrBase),
  c(5, ["Klebetechnik Std.", "Glue technique h", "Majoration colle h", "Recargo pegado h"], "n", (r) => r.kleberH),
  c(5, ["Klebetechnik", "Glue technique", "Majoration colle", "Recargo pegado"], "m", (r) => r.kleber),
  c(5, ["Push to Paint Std.", "Push to Paint h", "Push to Paint h", "Push to Paint h"], "n", (r) => r.ptpH),
  c(5, ["Push to Paint", "Push to Paint", "Push to Paint", "Push to Paint"], "m", (r) => r.ptp),
  c(5, ["Push to Paint Teile", "Push to Paint panels", "Push to Paint panneaux", "Push to Paint piezas"], "i", (r) => r.ptpPanels),
  c(5, ["Aluminium Std.", "Aluminium h", "Majoration aluminium h", "Aluminio h"], "n", (r) => r.aluH),
  c(5, ["Aluminium", "Aluminium", "Majoration aluminium", "Aluminio"], "m", (r) => r.alu),
  c(5, ["Teileersatz Arbeit Std.", "Part replacement labour h", "Remplacement de pièces – main d'œuvre h", "Sustitución de piezas – mano de obra h"], "n", (r) => r.replaceH),
  c(5, ["Teileersatz Arbeit", "Part replacement labour", "Remplacement de pièces – main d'œuvre", "Sustitución de piezas – mano de obra"], "m", (r) => r.replace),
  c(5, ["Ersatzteile Anzahl", "Replaced panels", "Remplacement panneaux", "Piezas sustituidas"], "i", (r) => r.replacePanels),
  c(5, ["Ersatzteile Liste", "Parts to replace", "Pièces à remplacer", "Piezas a sustituir"], "t", (r) => r.replaceList),
  c(5, ["Teilepreis", "Parts price", "Prix des pièces", "Precio de las piezas"], "m", (r) => r.partsPrice),
  c(5, ["Weitere Posten (AW-Methode)", "Other items (AW method)", "Autres postes (méthode AW)", "Otros conceptos (método AW)"], "m", (r) => r.other),
  c(5, ["Demontage / Montage", "Dismantling / fitting", "Démontage / montage", "Desmontaje / montaje"], "m", (r) => r.dem),
  c(5, ["Verglasung", "Glazing", "Vitrage", "Acristalamiento"], "m", (r) => r.glass),
  c(5, ["Stundensatz", "Hourly rate", "Taux horaire", "Tarifa horaria"], "m1", (r) => r.rate),
  c(5, ["Gesamt Std.", "Total hours", "Total heures", "Total horas"], "n", (r) => r.totalH),
  c(5, ["Gesamt", "Total", "Total", "Total"], "m", (r) => r.total),
  c(5, ["Kontrolle (Gesamt − Posten)", "Check (total − items)", "Contrôle (total − postes)", "Control (total − conceptos)"], "m1", (r) => r.check),
  c(6, ["Verteilungsbasis", "Split basis", "Base de répartition", "Base de reparto"], "m", (r) => r.basis),
  c(6, ["Provision Karosserie – Modus", "Body shop commission – mode", "Commission carrosserie – mode", "Comisión taller – modo"], "t", (r, l) => MODE[r.werkMode]?.[LI[l]] ?? r.werkMode),
  c(6, ["Provision Karosserie – %", "Body shop commission – %", "Commission carrosserie – %", "Comisión taller – %"], "pct", (r) => r.werkPct),
  c(6, ["Provision Karosserie", "Body shop commission", "Commission carrosserie", "Comisión taller"], "m", (r) => r.referrer),
  c(6, ["Techniker PDR – Name", "PDR technician – name", "Technicien PDR – nom", "Técnico PDR – nombre"], "t", (r) => r.techName),
  c(6, ["Techniker PDR – %", "PDR technician – %", "Technicien PDR – %", "Técnico PDR – %"], "pct", (r) => r.techPct),
  c(6, ["Techniker PDR", "PDR technician", "Technicien PDR", "Técnico PDR"], "m", (r) => r.technician),
  c(6, ["Techniker Demontage/Montage – Name", "Dismantling technician – name", "Technicien démontage/montage – nom", "Técnico desmontaje/montaje – nombre"], "t", (r) => r.demTechName),
  c(6, ["Techniker Demontage/Montage – %", "Dismantling technician – %", "Technicien démontage/montage – %", "Técnico desmontaje/montaje – %"], "pct", (r) => r.demTechPct),
  c(6, ["Techniker Demontage/Montage", "Dismantling technician", "Technicien démontage/montage", "Técnico desmontaje/montaje"], "m", (r) => r.headliner),
  c(6, ["Anteil PDR Team", "PDR Team share", "Part PDR Team", "Parte PDR Team"], "m", (r) => r.pdr),
  c(6, ["Kontrolle (Basis − Anteile)", "Check (basis − shares)", "Contrôle (base − parts)", "Control (base − partes)"], "m1", (r) => r.shareCheck),
];

/** the gross (TTC) amount of a net (HT) amount of this car */
export const gross = (net: number, vat: number) => r2(net * (1 + vat));

export function finishedFileName(from: string | null, to: string | null, lang: TechLang = "de"): string {
  const base = { de: "Fertige_Fahrzeuge", en: "Finished_vehicles", fr: "Vehicules_termines", es: "Vehiculos_terminados" }[lang];
  return `${base}_${from ?? "alle"}_${to ?? "alle"}.xlsx`;
}

/** Workbook: one sheet with every car; when the cars come from several stations, one more sheet per station. */
export function buildFinishedWorkbook(data: FinishedExportData, lang: TechLang = "de"): Uint8Array {
  const l = LABELS[lang], li = LI[lang];
  const period = [data.from ? techDate(data.from) : "…", data.to ? techDate(data.to) : "…"].join(" – ");
  // physical columns: a money column becomes net + gross
  type Phys = { col: Col; label: string; tax: boolean };
  const phys: Phys[] = COLS.flatMap((col): Phys[] => col.kind === "m" ? [{ col, label: `${col.label[li]} ${l.net}`, tax: false }, { col, label: `${col.label[li]} ${l.gross}`, tax: true }] : col.kind === "m1" ? [{ col, label: `${col.label[li]} ${l.net}`, tax: false }] : [{ col, label: col.label[li], tax: false }]);
  const value = (r: FinishedRow, p: Phys): string | number | null => {
    const v = p.col.get(r, lang);
    if (p.col.kind === "m" || p.col.kind === "m1") return v == null ? null : p.tax ? gross(v as number, r.vat) : (v as number);
    if (p.col.kind === "d") return v ? techDate(String(v)) : null;
    return v;
  };
  const style = (p: Phys) => p.col.kind === "m" || p.col.kind === "m1" ? S.money : p.col.kind === "i" ? S.int : p.col.kind === "n" || p.col.kind === "pct" ? S.num : S.def;
  const summed = (p: Phys) => p.col.kind === "m" || p.col.kind === "n";
  const sheetOf = (rows: FinishedRow[], heading: string) => {
    // group band: the group name over its first column
    const band: [string | null, number][] = phys.map((p, i) => [i === 0 || p.col.group !== phys[i - 1].col.group ? GROUPS[p.col.group][li] : null, S.bold]);
    const out: Row[] = [
      { ht: 24, cells: [[`${l.title} · ${heading}`, S.title]] },
      { cells: [[l.period + ":", S.bold], [period, S.def]] },
      { cells: band },
      { ht: 54, cells: phys.map((p): [string, number] => [p.label, style(p) === S.def ? S.head : S.headRight]) },
    ];
    for (const r of rows) out.push({ cells: phys.map((p): [string | number | null, number] => [value(r, p), style(p)]) });
    out.push({ cells: phys.map((p, i): [string | number | null, number] => i === 0 ? [`${l.sum} (${rows.length})`, S.totLabel] : summed(p) ? [r2(rows.reduce((a, r) => a + (Number(value(r, p)) || 0), 0)), p.col.kind === "m" ? S.totMoney : S.totNum] : [null, S.totLabel]) });
    return sheetXml(phys.map((p) => p.col.kind === "t" || p.col.kind === "d" ? Math.max(14, Math.min(28, p.label.length + 2)) : 17), out);
  };
  const used = new Set<string>();
  const sheets = [{ name: sheetName(l.all, used), xml: sheetOf(data.rows, l.all) }];
  const stations = [...new Set(data.rows.map((r) => r.station))].sort((a, b) => a.localeCompare(b, "de"));
  if (stations.length > 1) for (const s of stations) sheets.push({ name: sheetName(s || "—", used), xml: sheetOf(data.rows.filter((r) => r.station === s), s || "—") });
  return packSheets(sheets);
}
