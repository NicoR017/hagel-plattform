import { r2 } from "./techsheet";

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

type Kind = "t" | "d" | "i" | "n" | "pct" | "m" | "m1";
interface Col { group: number; label: string; kind: Kind; get: (r: FinishedRow) => string | number | null }
const GROUPS: string[] = [
  "File",
  "Vehicle",
  "Insurance",
  "Customer body shop",
  "Repair body shop",
  "Invoice detail",
  "Internal split",
];
const c = (group: number, label: string, kind: Kind, get: Col["get"]): Col => ({ group, label, kind, get });
const COLS: Col[] = [
  c(0, "Station", "t", (r) => r.station),
  c(0, "Repair start", "d", (r) => r.repairStart),
  c(0, "Finished on", "d", (r) => r.end),
  c(0, "Returned on", "d", (r) => r.returned),
  c(1, "Registration", "t", (r) => r.plate),
  c(1, "VIN", "t", (r) => r.vin),
  c(1, "Make", "t", (r) => r.make),
  c(1, "Model", "t", (r) => r.model),
  c(2, "Insurance company", "t", (r) => r.insurer),
  c(2, "Claim number", "t", (r) => r.claim),
  c(3, "Name", "t", (r) => r.bodyshop),
  c(3, "Tax ID", "t", (r) => r.clientCif),
  c(3, "Address", "t", (r) => r.clientAddress),
  c(3, "Contact", "t", (r) => r.clientContact),
  c(3, "Phone", "t", (r) => r.clientPhone),
  c(4, "Name", "t", (r) => r.repairShop),
  c(4, "Tax ID", "t", (r) => r.repairShopCif),
  c(4, "Address", "t", (r) => r.repairShopAddress),
  c(5, "PDR repair (matrix) h", "n", (r) => r.pdrH),
  c(5, "PDR repair (matrix)", "m", (r) => r.pdrBase),
  c(5, "Glue technique h", "n", (r) => r.kleberH),
  c(5, "Glue technique", "m", (r) => r.kleber),
  c(5, "Push to Paint h", "n", (r) => r.ptpH),
  c(5, "Push to Paint", "m", (r) => r.ptp),
  c(5, "Push to Paint panels", "i", (r) => r.ptpPanels),
  c(5, "Aluminium h", "n", (r) => r.aluH),
  c(5, "Aluminium", "m", (r) => r.alu),
  c(5, "Part replacement labour h", "n", (r) => r.replaceH),
  c(5, "Part replacement labour", "m", (r) => r.replace),
  c(5, "Replaced panels", "i", (r) => r.replacePanels),
  c(5, "Parts to replace", "t", (r) => r.replaceList),
  c(5, "Parts price", "m", (r) => r.partsPrice),
  c(5, "Other items (AW method)", "m", (r) => r.other),
  c(5, "Dismantling / fitting", "m", (r) => r.dem),
  c(5, "Glazing", "m", (r) => r.glass),
  c(5, "Hourly rate", "m1", (r) => r.rate),
  c(5, "Total hours", "n", (r) => r.totalH),
  c(5, "Total", "m", (r) => r.total),
  c(5, "Check (total − items)", "m1", (r) => r.check),
  c(6, "Split basis", "m", (r) => r.basis),
  c(6, "Body shop commission – mode", "t", (r) => (r.werkMode === "staffel" ? "scale" : "%")),
  c(6, "Body shop commission – %", "pct", (r) => r.werkPct),
  c(6, "Body shop commission", "m", (r) => r.referrer),
  c(6, "PDR technician – name", "t", (r) => r.techName),
  c(6, "PDR technician – %", "pct", (r) => r.techPct),
  c(6, "PDR technician", "m", (r) => r.technician),
  c(6, "Dismantling technician – name", "t", (r) => r.demTechName),
  c(6, "Dismantling technician – %", "pct", (r) => r.demTechPct),
  c(6, "Dismantling technician", "m", (r) => r.headliner),
  c(6, "PDR Team share", "m", (r) => r.pdr),
  c(6, "Check (basis − shares)", "m1", (r) => r.shareCheck),
];

/** the gross (TTC) amount of a net (HT) amount of this car */
export const gross = (net: number, vat: number) => r2(net * (1 + vat));

export function finishedFileName(from: string | null, to: string | null): string {
  return `Finished_vehicles_${from ?? "all"}_${to ?? "all"}.csv`;
}

const cell = (v: string | number | null): string => {
  if (v === null || v === undefined) return "";
  const t = String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/**
 * CSV (English, comma separated, UTF-8 with BOM so Excel reads the accents): a header line, then one line per car.
 * Every amount has a net and a gross column (with the car's own VAT); dates are ISO (YYYY-MM-DD).
 */
export function buildFinishedCsv(data: FinishedExportData): string {
  type Phys = { col: Col; label: string; tax: boolean };
  const phys: Phys[] = COLS.flatMap((col): Phys[] => col.kind === "m" ? [{ col, label: `${col.label} net`, tax: false }, { col, label: `${col.label} gross`, tax: true }] : col.kind === "m1" ? [{ col, label: `${col.label} net`, tax: false }] : [{ col, label: col.label, tax: false }]);
  const value = (r: FinishedRow, p: Phys): string | number | null => {
    const v = p.col.get(r);
    return (p.col.kind === "m" || p.col.kind === "m1") && v != null && p.tax ? gross(v as number, r.vat) : v;
  };
  const lines = [phys.map((p) => `${GROUPS[p.col.group]} - ${p.label}`), ...data.rows.map((r) => phys.map((p) => value(r, p)))];
  return "\uFEFF" + lines.map((l) => l.map((v) => cell(v)).join(",")).join("\r\n") + "\r\n";
}
