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
