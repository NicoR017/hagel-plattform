import type { Lang } from "@hagel/shared";

export interface MailBody { subject: string; text: string }

/** Account e-mails in the four UI languages (de default). */
export function loginMail(lang: Lang, name: string, link: string, minutes: number): MailBody {
  const n = name || "";
  switch (lang) {
    case "en": return { subject: "Sign in to PDR Hagel", text: `Hello ${n},

Here is your sign-in link (valid for ${minutes} minutes, single use):
${link}

If you did not request this, you can ignore this e-mail.` };
    case "fr": return { subject: "Connexion à PDR Hagel", text: `Bonjour ${n},

Voici votre lien de connexion (valable ${minutes} minutes, à usage unique) :
${link}

Si vous n'en êtes pas à l'origine, vous pouvez ignorer cet e-mail.` };
    case "es": return { subject: "Acceso a PDR Hagel", text: `Hola ${n}:

Este es su enlace de acceso (válido durante ${minutes} minutos, de un solo uso):
${link}

Si no lo ha solicitado, puede ignorar este correo.` };
    default: return { subject: "Anmeldung PDR Hagel", text: `Hallo ${n},

Hier ist Ihr Anmelde-Link (${minutes} Minuten gültig, nur einmal verwendbar):
${link}

Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail.` };
  }
}

export function inviteMail(lang: Lang, orgName: string, link: string, hours: number): MailBody {
  switch (lang) {
    case "en": return { subject: `Invitation to PDR Hagel (${orgName})`, text: `You have been invited to ${orgName}.
Create your account (valid for ${hours} hours, single use):
${link}` };
    case "fr": return { subject: `Invitation à PDR Hagel (${orgName})`, text: `Vous avez été invité(e) à rejoindre ${orgName}.
Créez votre compte (valable ${hours} heures, à usage unique) :
${link}` };
    case "es": return { subject: `Invitación a PDR Hagel (${orgName})`, text: `Le han invitado a ${orgName}.
Cree su cuenta (válido durante ${hours} horas, de un solo uso):
${link}` };
    default: return { subject: `Einladung zu PDR Hagel (${orgName})`, text: `Sie wurden zu ${orgName} eingeladen.
Konto erstellen (${hours} Stunden gültig, nur einmal verwendbar):
${link}` };
  }
}

export function accessMail(lang: Lang, orgName: string, link: string): MailBody {
  switch (lang) {
    case "en": return { subject: `New access: ${orgName}`, text: `You have been given access to ${orgName}.
Sign in: ${link}` };
    case "fr": return { subject: `Nouvel accès : ${orgName}`, text: `Un accès à ${orgName} vous a été accordé.
Se connecter : ${link}` };
    case "es": return { subject: `Nuevo acceso: ${orgName}`, text: `Se le ha concedido acceso a ${orgName}.
Acceder: ${link}` };
    default: return { subject: `Neuer Zugriff: ${orgName}`, text: `Sie haben Zugriff auf ${orgName} erhalten.
Anmelden: ${link}` };
  }
}

export interface ReportMailInfo { plate: string; model: string; vin: string; hasScan: boolean; senderName: string }

/**
 * E-mail that carries a report PDF to the carrosserie / insurer. Only vehicle identification is mentioned:
 * never amounts, technician names or the commission (those are internal).
 */
export function reportMail(lang: "de" | "es", type: "kva" | "reparation", i: ReportMailInfo): MailBody {
  const veh = [i.model, i.plate].filter(Boolean).join(" · ");
  if (lang === "es") {
    return type === "kva"
      ? {
          subject: `Presupuesto daños por granizo${veh ? " – " + veh : ""}`,
          text: `Estimados señores:\n\nAdjuntamos el presupuesto de reparación de daños por granizo del vehículo${veh ? " " + veh : ""}${i.vin ? ` (VIN ${i.vin})` : ""}${i.hasScan ? ", junto con el informe del escáner Colibri (en el mismo PDF)" : ""}.\n\nQuedamos a su disposición para cualquier consulta.\n\nUn saludo cordial${i.senderName ? "\n" + i.senderName : ""}`,
        }
      : {
          subject: `Informe fotográfico de reparación${veh ? " – " + veh : ""}`,
          text: `Estimados señores:\n\nAdjuntamos el informe fotográfico de la reparación del vehículo${veh ? " " + veh : ""}${i.vin ? ` (VIN ${i.vin})` : ""}.\n\nQuedamos a su disposición para cualquier consulta.\n\nUn saludo cordial${i.senderName ? "\n" + i.senderName : ""}`,
        };
  }
  return type === "kva"
    ? {
        subject: `Kostenvoranschlag Hagelschaden${veh ? " – " + veh : ""}`,
        text: `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie den Kostenvoranschlag zur Hagelschadeninstandsetzung für das Fahrzeug${veh ? " " + veh : ""}${i.vin ? ` (FIN ${i.vin})` : ""}${i.hasScan ? " inklusive Colibri-Scanbericht (in derselben PDF)" : ""}.\n\nFür Rückfragen stehe ich gerne zur Verfügung.\n\nMit freundlichen Grüßen${i.senderName ? "\n" + i.senderName : ""}`,
      }
    : {
        subject: `Fotobericht Reparatur${veh ? " – " + veh : ""}`,
        text: `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie den Fotobericht zur Reparatur des Fahrzeugs${veh ? " " + veh : ""}${i.vin ? ` (FIN ${i.vin})` : ""}.\n\nFür Rückfragen stehe ich gerne zur Verfügung.\n\nMit freundlichen Grüßen${i.senderName ? "\n" + i.senderName : ""}`,
      };
}

export interface BookingMailInfo { date: string; time: string; station: string; address: string; plate: string; model: string; claim: string }

/** Repair-calendar e-mail for the customer and the carrosserie: confirmation, new date, or cancellation (DE or ES). */
const REFUSE_WORDS: Record<Lang, Record<string, string>> = {
  de: { non_pdr: "Nicht per PDR reparierbar", client: "Der Kunde lehnt ab", assurance: "Die Versicherung lehnt ab", epave: "Totalschaden" },
  en: { non_pdr: "Not repairable with PDR", client: "The customer declines", assurance: "The insurer declines", epave: "Write-off" },
  fr: { non_pdr: "Non réparable en PDR", client: "Le client refuse", assurance: "L'assurance refuse", epave: "Épave" },
  es: { non_pdr: "No reparable con PDR", client: "El cliente rechaza", assurance: "La aseguradora rechaza", epave: "Siniestro total" },
};
/** To the body shop of a car that was assessed but will not be repaired (the reason, never amounts). */
export function refusalMail(lang: Lang, i: { plate: string; model: string; claim: string; reason: string; comment: string }): MailBody {
  const veh = [i.model, i.plate].filter(Boolean).join(" · ");
  const why = REFUSE_WORDS[lang][i.reason] ?? i.reason;
  const note = i.comment ? `\n${i.comment}` : "";
  switch (lang) {
    case "es": return { subject: `Vehículo no será reparado${veh ? " – " + veh : ""}`, text: `Estimados señores:\n\nTras la peritación, el vehículo ${veh} no será reparado.\n\nMotivo: ${why}${note}${i.claim ? `\nN.º de siniestro: ${i.claim}` : ""}\n\nUn saludo cordial` };
    case "fr": return { subject: `Véhicule non réparé${veh ? " – " + veh : ""}`, text: `Bonjour,\n\nAprès l'expertise, le véhicule ${veh} ne sera pas réparé.\n\nMotif : ${why}${note}${i.claim ? `\nN° de sinistre : ${i.claim}` : ""}\n\nCordialement` };
    case "en": return { subject: `Vehicle will not be repaired${veh ? " – " + veh : ""}`, text: `Dear Sir or Madam,\n\nAfter the assessment, the vehicle ${veh} will not be repaired.\n\nReason: ${why}${note}${i.claim ? `\nClaim number: ${i.claim}` : ""}\n\nKind regards` };
    default: return { subject: `Fahrzeug wird nicht repariert${veh ? " – " + veh : ""}`, text: `Sehr geehrte Damen und Herren,\n\nnach der Begutachtung wird das Fahrzeug ${veh} nicht repariert.\n\nGrund: ${why}${note}${i.claim ? `\nSchadennummer: ${i.claim}` : ""}\n\nMit freundlichen Grüßen` };
  }
}

export function bookingMail(lang: "de" | "es", kind: "created" | "moved" | "cancelled", i: BookingMailInfo): MailBody {
  const [y, m, d] = i.date.split("-");
  const date = lang === "es" ? `${d}/${m}/${y}` : `${d}.${m}.${y}`;
  const veh = [i.model, i.plate].filter(Boolean).join(" · ");
  const place = [i.station, i.address].filter(Boolean).join(", ");
  if (lang === "es") {
    const head = { created: "Cita de reparación confirmada", moved: "Cita de reparación modificada", cancelled: "Cita de reparación cancelada" }[kind];
    const body = kind === "cancelled"
      ? `La cita de reparación del ${date} a las ${i.time} h ha sido cancelada.`
      : `${kind === "moved" ? "La cita se ha trasladado." : "Su cita de reparación está confirmada."}\n\nFecha: ${date}\nHora: ${i.time} h\nTaller: ${place}`;
    return { subject: `${head}${veh ? " – " + veh : ""}`, text: `Estimados señores:\n\n${body}\n\nVehículo: ${veh}${i.claim ? `\nN.º de siniestro: ${i.claim}` : ""}\n\nUn saludo cordial` };
  }
  const head = { created: "Reparaturtermin bestätigt", moved: "Reparaturtermin geändert", cancelled: "Reparaturtermin storniert" }[kind];
  const body = kind === "cancelled"
    ? `Der Reparaturtermin am ${date} um ${i.time} Uhr wurde storniert.`
    : `${kind === "moved" ? "Der Termin wurde verschoben." : "Ihr Reparaturtermin ist bestätigt."}\n\nDatum: ${date}\nUhrzeit: ${i.time} Uhr\nStation: ${place}`;
  return { subject: `${head}${veh ? " – " + veh : ""}`, text: `Sehr geehrte Damen und Herren,\n\n${body}\n\nFahrzeug: ${veh}${i.claim ? `\nSchadennummer: ${i.claim}` : ""}\n\nMit freundlichen Grüßen` };
}

export interface HandoverMailInfo { plate: string; model: string; stationName: string; customerName: string; senderName: string }

/** E-mail that carries the signed handover receipt (PDF) to the customer. Only vehicle and place: never prices, technicians or commission. */
export function handoverMail(lang: Lang | "es", kind: "drop_off" | "pick_up", i: HandoverMailInfo): MailBody {
  const veh = [i.model, i.plate].filter(Boolean).join(" · ");
  const drop = kind === "drop_off";
  const vs = veh ? " – " + veh : "";
  const sig = (s: string) => (i.senderName ? "\n" + s + "\n" + i.senderName : "\n" + s);
  const n = i.customerName || "";
  switch (lang) {
    case "en": return {
      subject: `Handover confirmation – ${drop ? "vehicle drop-off" : "vehicle pick-up"}${vs}`,
      text: `Dear ${n || "customer"},\n\nattached you will find the signed confirmation (PDF) that you ${drop ? "handed over" : "picked up"} the vehicle ${veh} ${drop ? "at" : "from"} ${i.stationName}.\n\nPlease keep it for your records.\n${sig("Kind regards")}`,
    };
    case "fr": return {
      subject: `Confirmation de remise – ${drop ? "dépôt du véhicule" : "restitution du véhicule"}${vs}`,
      text: `Bonjour ${n},\n\nvous trouverez ci-joint la confirmation signée (PDF) ${drop ? "du dépôt" : "de la restitution"} du véhicule ${veh} à ${i.stationName}.\n\nVeuillez la conserver.\n${sig("Cordialement")}`,
    };
    case "es": return {
      subject: `Comprobante de entrega – ${drop ? "recepción del vehículo" : "devolución del vehículo"}${vs}`,
      text: `Estimado/a ${n}:\n\nadjuntamos el comprobante firmado (PDF) de ${drop ? "la entrega" : "la recogida"} del vehículo ${veh} en ${i.stationName}.\n\nLe rogamos que lo conserve.\n${sig("Un saludo cordial")}`,
    };
    default: return {
      subject: `Übergabebestätigung ${drop ? "Fahrzeugannahme" : "Fahrzeugrückgabe"}${vs}`,
      text: `Guten Tag ${n},\n\nanbei erhalten Sie die unterschriebene Bestätigung (PDF) über die ${drop ? "Abgabe" : "Rückgabe"} des Fahrzeugs ${veh} in ${i.stationName}.\n\nBitte bewahren Sie sie für Ihre Unterlagen auf.\n${sig("Mit freundlichen Grüßen")}`,
    };
  }
}
