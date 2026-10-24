import { PANEL_MAP, SIZES, getDents } from "@hagel/calc";
import type { CalcResult, EsResult, Land, Panel, SharesResult } from "@hagel/calc";
import { eur, fmtDateL, h1, hA, num } from "./format";
import type { DocVehicle, VehicleStatus } from "./types";

const DE = {
  kva: "Kostenvoranschlag", kunde: "Kunde", kz: "Kennzeichen", fin: "FIN", modell: "Modell", datum: "Leistungsdatum", zustand: "Zustand",
  rein: "Reine Dellentechnik (Instandsetzung)", reinLang: "Reine Dellentechnik (Instandsetzung, ohne Nebenpositionen)",
  bauteil: "Bauteil", dellen: "Dellen", aw: "AW", scan: "Scanergebnis", summe: "Summe Dellentechnik",
  finish: "Finish", ruest: "Rüstzeit", greif: "Über Greifzone", hohl: "Hohlraumkonservierung", verbr: "Verbringung", gesamt: "Gesamt",
  awnetto: "AW-Leistung netto", material: "Material (Kleber/Hohlraum)", netto: "Netto gesamt",
  mwst: "zzgl. 19 % MwSt", brutto: "Brutto gesamt", fotos: "Fotos", notiz: "Notiz / Ersatzteile",
  sonder: "Sonderposition Dellen > 85 mm", sonderS: "Sonderposition > 85 mm", alu: "Alu", kleber: "Kleber", demont: "De-/Remontage (pauschal)",
  erneuern: "Erneuern", ptp: "Vordrücken zur Lackierung", manuell: "manuell", foto: "Foto", datei: "Kostenvoranschlag",
  // v2 additions
  versicherung: "Versicherung", schaden: "Schadennummer",
  fotobericht: "Fotobericht Reparatur", fotoberichtDatei: "Fotobericht",
  phBesichtigung: "Besichtigung", phReparatur: "Während der Reparatur", phFertig: "Nach der Reparatur",
  separat: "separat",
  teile: "Folgende Teile sind zu ersetzen:", methode: "Berechnungsmethode",
};
type TxtTable = typeof DE;
const ES: TxtTable = {
  kva: "Presupuesto", kunde: "Cliente", kz: "Matrícula", fin: "VIN", modell: "Modelo", datum: "Fecha del servicio", zustand: "Estado",
  rein: "Técnica de abolladuras (reparación)", reinLang: "Técnica de abolladuras (reparación, sin partidas accesorias)",
  bauteil: "Pieza", dellen: "Abolladuras", aw: "UT", scan: "Resultado del escaneo", summe: "Total técnica de abolladuras",
  finish: "Acabado", ruest: "Tiempo de preparación", greif: "Zona elevada", hohl: "Protección de cavidades", verbr: "Traslado", gesamt: "Total",
  awnetto: "Mano de obra neta", material: "Material (adhesivo/cavidades)", netto: "Base imponible",
  mwst: "más 21 % IVA", brutto: "Total con IVA", fotos: "Fotos", notiz: "Nota / Recambios",
  sonder: "Posición especial abolladuras > 85 mm", sonderS: "Posición especial > 85 mm", alu: "Alu", kleber: "Adhesivo", demont: "Desmontaje y montaje",
  erneuern: "Sustituir", ptp: "Desabollado previo a pintura (Push to Paint)", manuell: "manual", foto: "Foto", datei: "Presupuesto",
  versicherung: "Aseguradora", schaden: "N.º de siniestro",
  fotobericht: "Informe fotográfico de reparación", fotoberichtDatei: "Informe-fotografico",
  phBesichtigung: "Inspección", phReparatur: "Durante la reparación", phFertig: "Después de la reparación",
  separat: "aparte",
  teile: "Piezas a sustituir:", methode: "Método de cálculo",
};

/** Strings of the handover receipt (customer signature at drop-off / pick-up) and of the last page of the photo report. */
const HANDOVER_DE = {
  titleDrop: "Übergabebestätigung – Fahrzeugannahme", titlePick: "Übergabebestätigung – Fahrzeugrückgabe",
  vehicle: "Fahrzeug", plate: "Kennzeichen", vin: "FIN", claim: "Schadennummer", insurer: "Versicherung", bodyShop: "Carrosserie",
  dateTime: "Datum / Uhrzeit", customer: "Kunde", email: "E-Mail", place: "Ort", remarks: "Bemerkungen / Vorschäden",
  receivedByDrop: "Entgegengenommen von", receivedByPick: "Übergeben von", signature: "Unterschrift",
  sentenceDrop: "Mit meiner Unterschrift bestätige ich, {name}, dass ich das Fahrzeug am {date} um {time} Uhr in {station} abgegeben habe. Entgegengenommen von {user}.",
  sentencePick: "Mit meiner Unterschrift bestätige ich, {name}, dass ich das Fahrzeug am {date} um {time} Uhr in {station} zurückerhalten habe. Übergeben von {user}.",
  signaturesTitle: "Unterschriften des Kunden", blockDrop: "Fahrzeugannahme", blockPick: "Fahrzeugrückgabe", unsigned: "noch nicht unterschrieben",
};
const HANDOVER_ES: typeof HANDOVER_DE = {
  titleDrop: "Comprobante de entrega – Recepción del vehículo", titlePick: "Comprobante de entrega – Devolución del vehículo",
  vehicle: "Vehículo", plate: "Matrícula", vin: "VIN", claim: "N.º de siniestro", insurer: "Aseguradora", bodyShop: "Taller",
  dateTime: "Fecha / hora", customer: "Cliente", email: "Correo", place: "Lugar", remarks: "Observaciones / daños previos",
  receivedByDrop: "Recibido por", receivedByPick: "Entregado por", signature: "Firma",
  sentenceDrop: "Con mi firma, {name}, confirmo que he entregado el vehículo el {date} a las {time} en {station}. Recibido por {user}.",
  sentencePick: "Con mi firma, {name}, confirmo que he recogido el vehículo el {date} a las {time} en {station}. Entregado por {user}.",
  signaturesTitle: "Firmas del cliente", blockDrop: "Recepción del vehículo", blockPick: "Devolución del vehículo", unsigned: "aún sin firmar",
};
export const handoverText = (land: Land | undefined) => (land === "ES" ? HANDOVER_ES : HANDOVER_DE);

export const TXT: Record<Land, TxtTable> = { DE, ES };
/** cleaned list of the parts to replace */
export const partsOf = (v: Pick<DocVehicle, "partsToReplace">): string[] => (v.partsToReplace ?? []).map((p) => String(p).trim()).filter(Boolean);
export const docText = (land: Land | undefined): TxtTable => TXT[land === "ES" ? "ES" : "DE"];
const TX = (v: DocVehicle) => docText(v.land);

export const IMG_ES: Record<string, string> = {
  "Vorderansicht": "Vista frontal", "Heckansicht": "Vista trasera", "Seite links": "Lateral izquierdo", "Seite rechts": "Lateral derecho",
  "Dach": "Techo", "Detail / Delle": "Detalle / abolladura", "Sonstiges": "Otros", "Foto": "Foto",
};
export const imgLabel = (land: Land | undefined, l: string): string => (land === "ES" ? IMG_ES[l] || l : l);

export const ZUST_ES: Record<string, string> = {
  Trocken: "Seco", Nass: "Mojado", Sauber: "Limpio", Schmutzig: "Sucio", Gut: "Bueno", Mangelhaft: "Deficiente", "Ungenügend": "Insuficiente",
};
export function zustStr(v: Pick<DocVehicle, "land" | "zustand">): string {
  const z = v.zustand || [];
  if (!z.length) return "—";
  return v.land === "ES" ? z.map((x) => ZUST_ES[x] || x).join(", ") : z.join(", ");
}

export function plabel(land: Land | undefined, key: string): string {
  const p = PANEL_MAP[key];
  if (!p) return key;
  return land === "ES" ? p.es || p.de : p.de;
}

export const STATUS_LABEL_DE: Record<VehicleStatus, string> = {
  arrive: "Angekommen", besichtigung: "Besichtigung", attente: "Wartet", reparatur: "Reparatur", fertig: "Fertig", rendu: "Zurückgegeben",
};
export const STATUS_LABEL_ES: Record<VehicleStatus, string> = {
  arrive: "Llegado", besichtigung: "Inspección", attente: "En espera", reparatur: "Reparación", fertig: "Terminado", rendu: "Entregado",
};
export const statusLabel = (s: string | undefined, land: Land = "DE"): string => {
  const t: Record<string, string> = land === "ES" ? STATUS_LABEL_ES : STATUS_LABEL_DE;
  return (s && t[s]) || s || "";
};

export function kvaFileName(v: DocVehicle, now: Date = new Date()): string {
  const fallback = v.land === "ES" ? "Vehiculo" : "Fahrzeug";
  return TX(v).datei + "_" + (v.kennzeichen || fallback).replace(/[^A-Za-z0-9]+/g, "-") + "_" + (v.leistungsdatum || now.toISOString().slice(0, 10)) + ".pdf";
}

export function dentBreak(p: Panel): string {
  const d = getDents(p);
  const parts = SIZES.filter((s) => d[String(s)]).map((s) => d[String(s)] + "×" + s);
  return parts.length > 1 ? parts.join("  ·  ") + " mm" : "";
}

export function esRange(c: EsResult["cat"]): string {
  return c.to ? c.from + "–" + c.to : "> " + (c.from - 1);
}

export function esFormula(e: EsResult, lang: "es" | "de" = "es"): string {
  const r = eur(e.rate) + "/h";
  if (!e.bollos) return "";
  if (!e.H.seg) return (lang === "es" ? "Categoría A: 6,0 h fijas" : "Kategorie A: 6,0 h fix") + " × " + r + " = " + eur(e.matrixEur);
  if (e.bollos >= 1000) return (lang === "es" ? "≥ 1.000 bollos: 30,0 h (tope G)" : "ab 1.000 Bollos: 30,0 h (Deckel G)") + " × " + r + " = " + eur(e.matrixEur);
  const [b0, h0, b1, hh] = e.H.seg, per = (hh - h0) / (b1 - b0);
  return h1(h0) + " + " + (e.bollos - b0) + " × " + per.toLocaleString("de-DE", { maximumFractionDigits: 4 }) + " h = " +
    e.H.raw.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " h → " + h1(e.H.h) + " × " + r + " = " + eur(e.matrixEur);
}

export interface EsLine { l: string; v: number; open?: boolean }
/** Shared ES lines (app, PDF, text). Requires an ES result. */
export function esLines(_v: Pick<DocVehicle, "land">, c: CalcResult): EsLine[] {
  const e = c.es!, L: EsLine[] = [];
  L.push({ l: "Reparación PDR · categoría " + e.cat.cat + " (" + esRange(e.cat) + " bollos) · " + h1(e.H.h) + " × " + eur(e.rate) + "/h", v: e.matrixEur });
  e.adj.forEach((x) => L.push({ l: x.es + " (" + (x.h > 0 ? "+" : "−") + hA(Math.abs(x.h)) + ")", v: x.h * e.rate }));
  if (c.demEur > 0) L.push({ l: "Desmontaje y montaje", v: c.demEur });
  c.glass.forEach((g) => L.push({ l: g.es, v: g.eur, open: !(g.eur > 0) }));
  return L;
}

export function mailTexts(v: DocVehicle): { subject: string; body: string } {
  const es = v.land === "ES";
  const veh = [v.modell, v.kennzeichen].filter(Boolean).join(" · ");
  const subject = (es ? "Presupuesto daños por granizo" : "Kostenvoranschlag Hagelschaden") + (veh ? " – " + veh : "");
  const body = es
    ? "Estimados señores:\n\nAdjuntamos el presupuesto de reparación de daños por granizo del vehículo" + (veh ? " " + veh : "") + (v.fin ? " (VIN " + v.fin + ")" : "") +
      (v.colibriFile ? ", junto con el informe del escáner Colibri (en el mismo PDF)" : "") + ".\n\nQuedamos a su disposición para cualquier consulta.\n\nUn saludo cordial"
    : "Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie den Kostenvoranschlag zur Hagelschadeninstandsetzung für das Fahrzeug" + (veh ? " " + veh : "") +
      (v.fin ? " (FIN " + v.fin + ")" : "") + (v.colibriFile ? " inklusive Colibri-Scanbericht (in derselben PDF)" : "") +
      ".\n\nFür Rückfragen stehe ich gerne zur Verfügung.\n\nMit freundlichen Grüßen";
  return { subject, body };
}

/**
 * "Als Text kopieren". `_shares` is accepted for call-site compatibility but is deliberately NEVER used:
 * the customer text must not contain internal split data.
 */
export function kvaPlainText(v: DocVehicle, c: CalcResult, _shares?: SharesResult): string {
  const X = TX(v);
  const head = [X.kva.toUpperCase(),
    X.kunde + ": " + (v.kunde || "-") + "   " + X.kz + ": " + (v.kennzeichen || "-") + "   " + X.fin + ": " + (v.fin || "-") + (v.modell ? "   " + X.modell + ": " + v.modell : "")];
  if (v.insurerName || v.claimNumber) {
    head.push([v.insurerName ? X.versicherung + ": " + v.insurerName : "", v.claimNumber ? X.schaden + ": " + v.claimNumber : ""].filter(Boolean).join("   "));
  }
  let L: string[];
  if (c.es) {
    const e = c.es;
    L = head.concat([X.datum + ": " + fmtDateL(v.land, v.leistungsdatum), ""])
      .concat(c.panels.filter((p) => p.total > 0 || (p.big || 0) > 0).map((p) =>
        plabel(v.land, p.key) + ": " + (p.total + (+(p.big || 0))) + " abolladuras = " + p.bollos + " bollos" + (dentBreak(p) ? "  [" + dentBreak(p) + "]" : "")))
      .concat(["", "Total: " + e.bollos + " bollos (" + e.small + " + " + e.large + " × 2) → categoría " + e.cat.cat])
      .concat(esLines(v, c).map((x) => x.l + ": " + (x.open ? X.separat : eur(x.v))))
      .concat([X.netto + " " + eur(c.netto) + "   " + X.mwst + " " + eur(c.brutto - c.netto) + "   " + X.brutto + " " + eur(c.brutto)]);
  } else {
    L = head.concat([X.datum + ": " + fmtDateL(v.land, v.leistungsdatum) + "   " + X.zustand + ": " + zustStr(v), ""])
      .concat(c.panels.filter((p) => p.total > 0).map((p) =>
        plabel(v.land, p.key) + ": " + p.total + "x Ø" + p.avgClass + "mm = " + num(p.repair) + " " + X.aw + " = " + eur(p.repair * c.euroPerAW) + (dentBreak(p) ? "  [" + dentBreak(p) + "]" : "")))
      .concat(c.bigCount > 0 ? [X.sonder + ": " + c.bigCount + (c.bigEur > 0 ? " = " + eur(c.bigEur) : " (" + X.manuell + ")")] : [])
      .concat(["", X.rein + ": " + num(c.repairAW) + " " + X.aw + " = " + eur(c.repairEur), X.gesamt + ": " + num(c.totalAW) + " " + X.aw])
      .concat(c.demEur > 0 ? [X.demont + ": " + eur(c.demEur)] : [])
      .concat(c.glass.map((g) => g.de + ": " + (g.eur > 0 ? eur(g.eur) : "separat")))
      .concat([X.netto + " " + eur(c.netto) + "   " + X.mwst + "   " + X.brutto + " " + eur(c.brutto)]);
  }
  if ((v.notiz || "").trim()) L.push("", X.notiz + ": " + v.notiz);
  const parts = partsOf(v);
  if (parts.length) L.push("", X.teile, ...parts.map((p) => "- " + p));
  return L.join("\n");
}
