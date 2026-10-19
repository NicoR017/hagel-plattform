/** One i18n file. UI language: German (Spanish to be added as a second dictionary). */
const de = {
  appName: "PDR Hagel",
  email: "E-Mail", name: "Name", login: "Anmelden", logout: "Abmelden", save: "Speichern", edit: "Bearbeiten", cancel: "Abbrechen", delete: "Löschen",
  loginIntro: "Wir senden Ihnen einen Anmelde-Link per E-Mail.", sendLink: "Link senden", linkSent: "Falls ein Konto existiert, wurde ein Link gesendet.",
  verifying: "Anmeldung läuft …", linkInvalid: "Link ungültig oder abgelaufen.",
  inviteTitle: "Konto erstellen", inviteIntro: "Bitte geben Sie Ihren Namen ein.", createAccount: "Konto erstellen",
  users: "Benutzer", roles: "Rollen", sites: "Werkstätten", audit: "Protokoll", orgs: "Organisationen",
  invite: "Einladen", invitations: "Offene Einladungen", resend: "Erneut senden", revoke: "Zurückziehen",
  deactivate: "Deaktivieren", reactivate: "Reaktivieren", signOutEverywhere: "Alle Sitzungen abmelden",
  role: "Rolle", site: "Werkstatt", allSites: "Alle Werkstätten", scope: "Bereich", expires: "Läuft ab", status: "Status",
  permissions: "Berechtigungen", description: "Beschreibung", newRole: "Neue Rolle", system: "Standard",
  type: "Typ", capacity: "Plätze", country: "Land", address: "Adresse", tenant: "Tenant", commission: "Provision %",
  reportEmails: "Berichts-E-Mails (Komma)", newSite: "Neue Werkstatt", active: "Aktiv", inactive: "Inaktiv",
  carrosserie: "Carrosserie", hall: "Halle", parc: "Parkplatz/Logistik",
  scopeAssigne: "Nur zugewiesene Fahrzeuge", scopeStation: "Alle Fahrzeuge der Werkstatt", scopeCampagne: "Fahrzeuge einer Kampagne",
  scopeClient: "Fahrzeuge dieser Carrosserie (Kunde)", scopeAssurance: "Fahrzeuge einer Versicherung",
  clientStation: "Carrosserie (Kunde)", error: "Fehler", loading: "Lädt …", noData: "Keine Einträge", synced: "Synchron",
  org: "Organisation", sessions: "Sitzungen", me: "Mein Konto", forbidden: "Keine Berechtigung",
} as const;
export type Key = keyof typeof de;
export const t = (k: Key): string => de[k];
export const permissionLabel = (p: string) => p;
