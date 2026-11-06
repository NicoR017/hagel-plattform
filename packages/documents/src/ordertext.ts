// Parts order to a body shop (F3b): labels of the PDF, default e-mail templates, template rendering. The order is a REQUEST, never an invoice.
export type OrderLang = "es" | "de" | "en" | "fr";
export const ORDER_LANGS: OrderLang[] = ["es", "de", "en", "fr"];
export type OrderKind = "main" | "complement" | "modification" | "cancellation";

export interface OrderLine { n: number; zone: string; designation: string; oem: string; qty: number; observations?: string }
export interface OrderDoc {
  number: string; kind: OrderKind; /** reason of a complementary order / modification / cancellation */ reason?: string | null; parentNumber?: string | null;
  /** ISO instant */ date: string; lang: OrderLang;
  to: { name: string; cif?: string; address?: string; contact?: string };
  vehicle: { plate: string; vin: string; makeModel: string; insurer: string; claim: string; expertNo?: string };
  delivery: { address: string; date: string | null; contact?: string };
  lines: OrderLine[]; observations?: string;
}

export interface OrderLabels {
  title: string; titleModification: string; titleCancellation: string; number: string; date: string; type: string;
  kindMain: string; kindComplement: string; kindModification: string; kindCancellation: string; reason: string; replaces: string;
  recipient: string; cif: string; address: string; contact: string; vehicle: string; plate: string; vin: string; makeModel: string; insurer: string; claim: string; expert: string;
  delivery: string; deliverAt: string; wantedDate: string; onSite: string;
  parts: string; colN: string; colZone: string; colDesignation: string; colOem: string; colQty: string; colObs: string; oemTbd: string; observations: string;
  footer1: string; footer2: string; reasonLabels: Record<string, string>;
}

const ES: OrderLabels = {
  title: "Solicitud de pedido de piezas", titleModification: "Modificación de pedido de piezas", titleCancellation: "Anulación de pedido de piezas", number: "N.º", date: "Fecha", type: "Tipo",
  kindMain: "Pedido principal", kindComplement: "Pedido complementario", kindModification: "Modificación de pedido", kindCancellation: "Anulación de pedido", reason: "Motivo", replaces: "Pedido principal",
  recipient: "Destinatario", cif: "CIF", address: "Dirección", contact: "Contacto", vehicle: "Vehículo", plate: "Matrícula", vin: "VIN", makeModel: "Marca / modelo", insurer: "Aseguradora", claim: "N.º de siniestro", expert: "N.º de peritación",
  delivery: "Entrega", deliverAt: "Entregar en", wantedDate: "Fecha deseada de entrega", onSite: "Contacto en destino",
  parts: "Piezas", colN: "N.º", colZone: "Zona / elemento", colDesignation: "Designación", colOem: "Ref. OEM", colQty: "Cant.", colObs: "Observaciones", oemTbd: "a determinar", observations: "Observaciones",
  footer1: "Documento no fiscal. Esta solicitud no es una factura.", footer2: "Por favor, confirme el pedido y la fecha de entrega respondiendo a este correo.",
  reasonLabels: { forgotten: "Pieza olvidada", wrong_ref: "Devolución: referencia errónea", damaged: "Devolución: pieza dañada", damaged_during_repair: "Daño durante la reparación", other: "Otro motivo" },
};
const DE: OrderLabels = {
  title: "Anfrage Ersatzteilbestellung", titleModification: "Änderung der Ersatzteilbestellung", titleCancellation: "Stornierung der Ersatzteilbestellung", number: "Nr.", date: "Datum", type: "Art",
  kindMain: "Hauptbestellung", kindComplement: "Zusatzbestellung", kindModification: "Bestelländerung", kindCancellation: "Bestellstornierung", reason: "Grund", replaces: "Hauptbestellung",
  recipient: "Empfänger", cif: "Steuernr. (CIF)", address: "Adresse", contact: "Kontakt", vehicle: "Fahrzeug", plate: "Kennzeichen", vin: "FIN", makeModel: "Marke / Modell", insurer: "Versicherung", claim: "Schadennummer", expert: "Gutachten-Nr.",
  delivery: "Lieferung", deliverAt: "Lieferung an", wantedDate: "Gewünschtes Lieferdatum", onSite: "Ansprechpartner vor Ort",
  parts: "Teile", colN: "Nr.", colZone: "Zone / Element", colDesignation: "Bezeichnung", colOem: "OEM-Nr.", colQty: "Menge", colObs: "Bemerkungen", oemTbd: "noch festzulegen", observations: "Bemerkungen",
  footer1: "Kein steuerliches Dokument. Diese Anfrage ist keine Rechnung.", footer2: "Bitte bestätigen Sie die Bestellung und das Lieferdatum per Antwort auf diese E-Mail.",
  reasonLabels: { forgotten: "Vergessenes Teil", wrong_ref: "Rückgabe: falsche Referenz", damaged: "Rückgabe: beschädigt", damaged_during_repair: "Schaden bei der Reparatur", other: "Anderer Grund" },
};
const EN: OrderLabels = {
  title: "Spare parts order request", titleModification: "Spare parts order modification", titleCancellation: "Spare parts order cancellation", number: "No.", date: "Date", type: "Type",
  kindMain: "Main order", kindComplement: "Additional order", kindModification: "Order modification", kindCancellation: "Order cancellation", reason: "Reason", replaces: "Main order",
  recipient: "Recipient", cif: "Tax ID (CIF)", address: "Address", contact: "Contact", vehicle: "Vehicle", plate: "Plate", vin: "VIN", makeModel: "Make / model", insurer: "Insurer", claim: "Claim no.", expert: "Assessment no.",
  delivery: "Delivery", deliverAt: "Deliver to", wantedDate: "Wanted delivery date", onSite: "Contact on site",
  parts: "Parts", colN: "No.", colZone: "Zone / element", colDesignation: "Description", colOem: "OEM ref.", colQty: "Qty", colObs: "Remarks", oemTbd: "to be determined", observations: "Remarks",
  footer1: "Non-fiscal document. This request is not an invoice.", footer2: "Please confirm the order and the delivery date by replying to this e-mail.",
  reasonLabels: { forgotten: "Forgotten part", wrong_ref: "Return: wrong reference", damaged: "Return: damaged part", damaged_during_repair: "Damaged during the repair", other: "Other reason" },
};
const FR: OrderLabels = {
  title: "Demande de commande de pièces", titleModification: "Modification de commande de pièces", titleCancellation: "Annulation de commande de pièces", number: "N°", date: "Date", type: "Type",
  kindMain: "Commande principale", kindComplement: "Commande complémentaire", kindModification: "Modification de commande", kindCancellation: "Annulation de commande", reason: "Motif", replaces: "Commande principale",
  recipient: "Destinataire", cif: "N° fiscal (CIF)", address: "Adresse", contact: "Contact", vehicle: "Véhicule", plate: "Plaque", vin: "VIN", makeModel: "Marque / modèle", insurer: "Assurance", claim: "N° de sinistre", expert: "N° d'expertise",
  delivery: "Livraison", deliverAt: "Livrer à", wantedDate: "Date de livraison souhaitée", onSite: "Contact sur place",
  parts: "Pièces", colN: "N°", colZone: "Zone / élément", colDesignation: "Désignation", colOem: "Réf. OEM", colQty: "Qté", colObs: "Remarques", oemTbd: "à déterminer", observations: "Remarques",
  footer1: "Document non fiscal. Cette demande n'est pas une facture.", footer2: "Merci de confirmer la commande et la date de livraison en répondant à cet e-mail.",
  reasonLabels: { forgotten: "Pièce oubliée", wrong_ref: "Retour : mauvaise référence", damaged: "Retour : pièce abîmée", damaged_during_repair: "Dommage pendant la réparation", other: "Autre motif" },
};
export const orderLabels = (lang: OrderLang): OrderLabels => ({ es: ES, de: DE, en: EN, fr: FR })[lang] ?? ES;
export const ORDER_REASONS = ["forgotten", "wrong_ref", "damaged", "damaged_during_repair", "other"] as const;

/** variables of the e-mail template */
export const ORDER_VARS = ["order_number", "order_type", "plate", "make_model", "claim_number", "insurer", "delivery_address", "delivery_date", "parts_count", "body_shop_contact", "sender", "station"] as const;
export type OrderVars = Record<(typeof ORDER_VARS)[number], string>;

export interface MailTemplate { subject: string; body: string }
const TEMPLATES: Record<OrderLang, MailTemplate> = {
  es: {
    subject: "Pedido de piezas {{order_number}} – {{plate}} – Siniestro {{claim_number}}",
    body: "Hola {{body_shop_contact}}:\n\nLes enviamos adjunta la solicitud de pedido de piezas {{order_number}} ({{parts_count}} piezas) para el vehículo {{make_model}} – {{plate}}, siniestro {{claim_number}} de {{insurer}}.\n\nEntrega en: {{delivery_address}}\nFecha deseada de entrega: {{delivery_date}}\n\nPor favor, confírmennos el pedido y la fecha de entrega prevista respondiendo a este correo.\n\nUn saludo,\n{{sender}} – PDR Team España ({{station}})",
  },
  de: {
    subject: "Ersatzteilbestellung {{order_number}} – {{plate}} – Schaden {{claim_number}}",
    body: "Guten Tag {{body_shop_contact}},\n\nanbei die Anfrage zur Ersatzteilbestellung {{order_number}} ({{parts_count}} Teile) für das Fahrzeug {{make_model}} – {{plate}}, Schaden {{claim_number}} von {{insurer}}.\n\nLieferung an: {{delivery_address}}\nGewünschtes Lieferdatum: {{delivery_date}}\n\nBitte bestätigen Sie uns die Bestellung und das voraussichtliche Lieferdatum per Antwort auf diese E-Mail.\n\nFreundliche Grüße\n{{sender}} – PDR Team ({{station}})",
  },
  en: {
    subject: "Spare parts order {{order_number}} – {{plate}} – Claim {{claim_number}}",
    body: "Hello {{body_shop_contact}},\n\nPlease find attached the spare parts order request {{order_number}} ({{parts_count}} parts) for the vehicle {{make_model}} – {{plate}}, claim {{claim_number}} of {{insurer}}.\n\nDeliver to: {{delivery_address}}\nWanted delivery date: {{delivery_date}}\n\nPlease confirm the order and the expected delivery date by replying to this e-mail.\n\nKind regards,\n{{sender}} – PDR Team ({{station}})",
  },
  fr: {
    subject: "Commande de pièces {{order_number}} – {{plate}} – Sinistre {{claim_number}}",
    body: "Bonjour {{body_shop_contact}},\n\nVous trouverez ci-joint la demande de commande de pièces {{order_number}} ({{parts_count}} pièces) pour le véhicule {{make_model}} – {{plate}}, sinistre {{claim_number}} de {{insurer}}.\n\nLivraison à : {{delivery_address}}\nDate de livraison souhaitée : {{delivery_date}}\n\nMerci de nous confirmer la commande et la date de livraison prévue en répondant à cet e-mail.\n\nCordialement,\n{{sender}} – PDR Team ({{station}})",
  },
};
export const defaultOrderTemplate = (lang: OrderLang): MailTemplate => TEMPLATES[lang] ?? TEMPLATES.es;
export const REMINDER_PREFIX: Record<OrderLang, string> = { es: "Recordatorio: ", de: "Erinnerung: ", en: "Reminder: ", fr: "Rappel : " };

/** {{variable}} → value (unknown variables stay empty: a typo never prints "{{…}}" to a body shop) */
export function renderTemplate(tpl: string, vars: Partial<Record<string, string>>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
}
export const orderKindLabel = (kind: OrderKind, lang: OrderLang): string => { const l = orderLabels(lang); return { main: l.kindMain, complement: l.kindComplement, modification: l.kindModification, cancellation: l.kindCancellation }[kind]; };
