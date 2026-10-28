// V6, the automatic insurer report (PDF): the data it is made from, the words in the four languages and the small formatting helpers.
import type { Letterhead } from "./types";

export type InsurerReportLang = "es" | "en" | "de" | "fr";
export type InsurerReportKpi = "inspected" | "repaired" | "backlog" | "upcoming" | "progress" | "refused";

export interface InsurerReportFigures {
  inspected: { period: number; total: number };
  repaired: { period: number; total: number };
  refused: { period: number; total: number };
  backlog: number;
  upcoming: number;
  /** percent with one decimal, null without any inspected car */
  progress: number | null;
}
/** one period of the evolution chart */
export interface InsurerReportTrendPoint { from: string; to: string; inspected: number; repaired: number }
/** one car of the annex */
export interface InsurerReportRow {
  plate: string; model: string; bodyshop: string; station: string;
  /** YYYY-MM-DD */
  inspectedOn: string;
  /** vehicle status key (arrive, besichtigung, attente, reparatur, fertig, rendu, refuse) */
  status: string;
  repairedOn: string | null; refusedOn: string | null; appointmentOn: string | null;
  /** agreed net price, only when the report shows amounts */
  net?: number | null;
}
export interface InsurerReportData {
  /** name of the report; the insurers it covers */
  name: string;
  insurers: string[];
  /** YYYY-MM-DD, inclusive */
  period: { from: string; to: string };
  projectStart: string | null;
  /** the day of the snapshot figures (backlog, upcoming) */
  asOf: string;
  /** the figures shown, in this order */
  kpis: InsurerReportKpi[];
  figures: InsurerReportFigures;
  /** the evolution chart, oldest first (empty = no chart) */
  trend: InsurerReportTrendPoint[];
  /** the annex with the cars (null = no annex) */
  annex: InsurerReportRow[] | null;
  showAmounts: boolean;
}
export interface InsurerReportOptions { lang: InsurerReportLang; letterhead?: Letterhead | null; now?: Date }

export const INSURER_REPORT_LABELS = {
  es: {
    title: "Informe de actividad PDR", insurer: "Aseguradora", period: "Periodo", cumulative: "Acumulado", sinceStart: "desde el inicio del proyecto", until: "hasta el",
    asOf: "Situación a fecha de", total: "Total acumulado", of: "de",
    kpi: { inspected: "Vehículos peritados / escaneados", repaired: "Vehículos reparados", backlog: "Pendientes de cita de reparación", upcoming: "Citas de reparación confirmadas", progress: "Avance global", refused: "Peritados sin reparación" },
    trendTitle: "Evolución por periodo", trendInspected: "Peritados", trendRepaired: "Reparados", progressTitle: "Avance global del proyecto", progressText: "Reparados {r} de {i} vehículos peritados",
    annex: "Anexo: vehículos", none: "Sin vehículos en este periodo.", plate: "Matrícula", model: "Marca y modelo", bodyshop: "Taller", inspected: "Peritado el", status: "Estado", detail: "Detalle", net: "Importe neto",
    repairedOn: "Reparado el", refusedOn: "Rechazado el", appointmentOn: "Cita el", pending: "Pendiente de cita",
    generated: "Generado el", page: "Página",
    statuses: { arrive: "Llegado", besichtigung: "Peritado", attente: "En espera", reparatur: "En reparación", fertig: "Terminado", rendu: "Entregado", refuse: "Sin reparación" },
  },
  en: {
    title: "PDR activity report", insurer: "Insurer", period: "Period", cumulative: "Cumulative", sinceStart: "since the start of the project", until: "until",
    asOf: "Situation as of", total: "Cumulative total", of: "of",
    kpi: { inspected: "Vehicles inspected / scanned", repaired: "Vehicles repaired", backlog: "Waiting for a repair appointment", upcoming: "Confirmed repair appointments", progress: "Overall progress", refused: "Assessed, not repaired" },
    trendTitle: "Evolution by period", trendInspected: "Inspected", trendRepaired: "Repaired", progressTitle: "Overall progress of the project", progressText: "{r} of {i} inspected vehicles repaired",
    annex: "Annex: vehicles", none: "No vehicles in this period.", plate: "Registration", model: "Make and model", bodyshop: "Body shop", inspected: "Inspected on", status: "Status", detail: "Detail", net: "Net amount",
    repairedOn: "Repaired on", refusedOn: "Refused on", appointmentOn: "Appointment on", pending: "Waiting for appointment",
    generated: "Generated on", page: "Page",
    statuses: { arrive: "Arrived", besichtigung: "Inspected", attente: "On hold", reparatur: "In repair", fertig: "Done", rendu: "Returned", refuse: "Not repaired" },
  },
  de: {
    title: "PDR-Aktivitätsbericht", insurer: "Versicherung", period: "Zeitraum", cumulative: "Kumuliert", sinceStart: "seit Projektbeginn", until: "bis",
    asOf: "Stand", total: "Gesamt kumuliert", of: "von",
    kpi: { inspected: "Begutachtete / gescannte Fahrzeuge", repaired: "Reparierte Fahrzeuge", backlog: "Warten auf Reparaturtermin", upcoming: "Bestätigte Reparaturtermine", progress: "Gesamtfortschritt", refused: "Begutachtet, nicht repariert" },
    trendTitle: "Entwicklung je Zeitraum", trendInspected: "Begutachtet", trendRepaired: "Repariert", progressTitle: "Gesamtfortschritt des Projekts", progressText: "{r} von {i} begutachteten Fahrzeugen repariert",
    annex: "Anhang: Fahrzeuge", none: "Keine Fahrzeuge in diesem Zeitraum.", plate: "Kennzeichen", model: "Marke und Modell", bodyshop: "Body Shop", inspected: "Begutachtet am", status: "Status", detail: "Detail", net: "Nettobetrag",
    repairedOn: "Repariert am", refusedOn: "Abgelehnt am", appointmentOn: "Termin am", pending: "Wartet auf Termin",
    generated: "Erstellt am", page: "Seite",
    statuses: { arrive: "Angekommen", besichtigung: "Begutachtet", attente: "Wartet", reparatur: "In Reparatur", fertig: "Fertig", rendu: "Zurückgegeben", refuse: "Nicht repariert" },
  },
  fr: {
    title: "Rapport d'activité PDR", insurer: "Assurance", period: "Période", cumulative: "Cumul", sinceStart: "depuis le début du projet", until: "jusqu'au",
    asOf: "Situation au", total: "Total cumulé", of: "sur",
    kpi: { inspected: "Véhicules expertisés / scannés", repaired: "Véhicules réparés", backlog: "En attente d'un rendez-vous de réparation", upcoming: "Rendez-vous de réparation confirmés", progress: "Avancement global", refused: "Expertisés, non réparés" },
    trendTitle: "Évolution par période", trendInspected: "Expertisés", trendRepaired: "Réparés", progressTitle: "Avancement global du projet", progressText: "{r} véhicules réparés sur {i} expertisés",
    annex: "Annexe : véhicules", none: "Aucun véhicule sur cette période.", plate: "Immatriculation", model: "Marque et modèle", bodyshop: "Carrosserie", inspected: "Expertisé le", status: "Statut", detail: "Détail", net: "Montant net",
    repairedOn: "Réparé le", refusedOn: "Refusé le", appointmentOn: "RDV le", pending: "En attente de RDV",
    generated: "Généré le", page: "Page",
    statuses: { arrive: "Arrivé", besichtigung: "Expertisé", attente: "En attente", reparatur: "En réparation", fertig: "Terminé", rendu: "Restitué", refuse: "Non réparé" },
  },
} as const;

const LOCALE = { es: "es-ES", en: "en-GB", de: "de-DE", fr: "fr-FR" } as const;
/** the PDF font (WinAnsi) cannot draw the narrow no-break space of French / Spanish number formats */
const plain = (s: string) => s.replace(/[  ]/g, " ");

/** 2026-10-25 -> 25/10/2026 (25.10.2026 in German) */
export function reportDate(lang: InsurerReportLang, iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? "—";
  const [y, m, d] = iso.split("-");
  return lang === "de" ? `${d}.${m}.${y}` : `${d}/${m}/${y}`;
}
export const reportInt = (lang: InsurerReportLang, n: number) => plain(n.toLocaleString(LOCALE[lang], { maximumFractionDigits: 0 }));
export const reportPercent = (lang: InsurerReportLang, n: number | null) => (n == null ? "—" : plain(`${n.toLocaleString(LOCALE[lang], { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`));
export const reportMoney = (lang: InsurerReportLang, n: number) => plain(`${n.toLocaleString(LOCALE[lang], { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

export function insurerReportFileName(data: Pick<InsurerReportData, "name" | "period">, lang: InsurerReportLang): string {
  const base = { es: "Informe", en: "Report", de: "Bericht", fr: "Rapport" }[lang];
  const name = data.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "insurer";
  return `${base}_${name}_${data.period.from}_${data.period.to}.pdf`;
}
