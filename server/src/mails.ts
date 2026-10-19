import type { Lang } from "@hagel/shared";

export interface MailBody { subject: string; text: string }

export function loginMail(lang: Lang, name: string, link: string, minutes: number): MailBody {
  return lang === "en"
    ? {
        subject: "Sign in to PDR Hagel",
        text: `Hello ${name || ""},\n\nHere is your sign-in link (valid for ${minutes} minutes, single use):\n${link}\n\nIf you did not request this, you can ignore this e-mail.`,
      }
    : {
        subject: "Anmeldung PDR Hagel",
        text: `Hallo ${name || ""},\n\nHier ist Ihr Anmelde-Link (${minutes} Minuten gültig, nur einmal verwendbar):\n${link}\n\nWenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail.`,
      };
}

export function inviteMail(lang: Lang, orgName: string, link: string, hours: number): MailBody {
  return lang === "en"
    ? {
        subject: `Invitation to PDR Hagel (${orgName})`,
        text: `You have been invited to ${orgName}.\nCreate your account (valid for ${hours} hours, single use):\n${link}`,
      }
    : {
        subject: `Einladung zu PDR Hagel (${orgName})`,
        text: `Sie wurden zu ${orgName} eingeladen.\nKonto erstellen (${hours} Stunden gültig, nur einmal verwendbar):\n${link}`,
      };
}

export function accessMail(lang: Lang, orgName: string, link: string): MailBody {
  return lang === "en"
    ? { subject: `New access: ${orgName}`, text: `You have been given access to ${orgName}.\nSign in: ${link}` }
    : { subject: `Neuer Zugriff: ${orgName}`, text: `Sie haben Zugriff auf ${orgName} erhalten.\nAnmelden: ${link}` };
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
