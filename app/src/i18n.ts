/**
 * One i18n file. UI languages: German (default) and English. The whole UI is always in ONE language:
 * every visible string goes through t(); a test checks that both dictionaries have the same keys.
 * Spanish can be added later as a third dictionary.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_LANG, LANGS, isLang, type Lang } from "@hagel/shared";
import { deField, enField } from "./i18n_field";
import { deV3, enV3 } from "./i18n_v3";

const deBase = {
  appName: "PDR Hagel",
  language: "Sprache",
  email: "E-Mail", name: "Name", login: "Anmelden", logout: "Abmelden", save: "Speichern", edit: "Bearbeiten", cancel: "Abbrechen", delete: "Löschen",
  loginIntro: "Melden Sie sich mit E-Mail und Passwort an.", sendLink: "Link senden", linkSent: "Falls ein Konto existiert, wurde ein Link gesendet.",
  password: "Passwort", passwordNew: "Neues Passwort (mind. 10 Zeichen)", passwordConfirm: "Passwort wiederholen", passwordCurrent: "Aktuelles Passwort",
  periodToday: "Heute", periodWeek: "Diese Woche", periodLastWeek: "Letzte Woche", periodMonth: "Dieser Monat", periodAll: "Alles", periodCustom: "Zeitraum anpassen", filtersLabel: "Filter",
  kpiPresent: "Anwesend", kpiDelayed: "Verzögert", kpiNet: "Netto im Zeitraum", attention: "Achtung", siteFullMsg: "{name} ist voll ({n}/{cap})", allGood: "Alles im grünen Bereich.",
  exportTech: "Technikerabrechnung", exportChoose: "Format wählen", exportPdf: "PDF – Worksheet je Techniker (zum Drucken und Unterschreiben)", exportExcel: "Excel – Übersicht und eine Seite je Techniker (bearbeitbar)", exportTechHint: "Fahrzeuge, die im Zeitraum fertig wurden, und der Betrag je Techniker: eine Seite je Techniker wie das Worksheet.",
  exportBusy: "Wird erstellt …", exportEmpty: "Keine fertigen Fahrzeuge im Zeitraum.", exportNoRight: "Dafür fehlt das Recht auf die interne Aufteilung.", periodShown: "Zeitraum",
  sasExpires: "Azure-Zugriffstoken (SAS) gültig bis", sasExpired: "Das Azure-Zugriffstoken ist abgelaufen: ein neues erstellen und in Railway eintragen",
  afterMove: "nach der Verschiebung", occupancy: "Belegung", full: "voll", over: "überbelegt",
  "w.capacity_full": "Zielort ist voll – trotzdem verschoben.", "w.tenant_differs": "Zielort gehört zu einem anderen Tenant – trotzdem verschoben.",
  moveFullWarn: "Dieser Standort ist voll. Das Fahrzeug kann trotzdem verschoben werden.", moveTenantWarn: "Anderer Tenant als der aktuelle Standort.",
  dashboard: "Dashboard", dashSites: "Standorte", dashDurations: "Dauer und Verzögerungen", dashTech: "Techniker", dashRevenue: "Umsatz",
  arrivalsToday: "Ankünfte heute", departuresToday: "Abgänge heute", avgToReturned: "Ø Ankunft → Zurückgegeben", avgRepair: "Ø Reparaturdauer",
  daysShort: "Tage", delayedVehicles: "Verzögerte Fahrzeuge", holdByReason: "Wartet nach Grund", noneDash: "Keine.", sinceDays: "seit {n} T (Grenze {max})",
  assignedN: "Zugewiesen", inProgressN: "In Arbeit", finishedN: "Fertig im Zeitraum", noRoleOnSite: "ohne Rolle am Standort",
  revTotal: "Netto gesamt", revBySite: "Nach Standort", revByClient: "Nach Carrosserie", revByInsurer: "Nach Versicherung", revByMonth: "Nach Monat",
  splitTech: "Anteil Techniker", splitComm: "Provision Carrosserien", splitRest: "Rest PDR",
  periodFrom: "Von", periodTo: "Bis", allCampaigns: "Alle Kampagnen", allClients: "Alle Carrosserien", allInsurers: "Alle Versicherungen",
  delayThresholds: "Verzögerung ab (Tage pro Status)", dashOnline: "Das Dashboard braucht eine Internetverbindung.", filterActive: "Filter aus dem Dashboard", clearFilter: "Filter entfernen",
  vehiclesCount: "Fahrzeuge", presentN: "anwesend",
  azureLinksOnly: "Nur diese Verknüpfungen (Kunde-Versicherung)", azureFilter: "Verknüpfung suchen (Kunde-Versicherung) …", azureAll: "alle", azureNoMore: "Keine weiteren Verknüpfungen.", azureLinksHint: "Beliebig viele Verknüpfungen (Kunde-Versicherung) wählbar; Scans mit einem dieser Namen gehören zu diesem Standort.",
  passwordShort: "Das Passwort muss mindestens 10 Zeichen lang sein.",
  passwordMismatch: "Die Passwörter stimmen nicht überein.", passwordChange: "Passwort ändern", passwordSet: "Passwort setzen", passwordSaved: "Passwort gespeichert. Andere Geräte wurden abgemeldet.",
  forgotPassword: "Passwort vergessen / noch keins? Link per E-Mail senden", firstLoginHint: "Beim ersten Mal: Link per E-Mail anfordern, anmelden und dann unter „Passwort“ ein Passwort setzen.",
  verifying: "Anmeldung läuft …", linkInvalid: "Link ungültig oder abgelaufen.",
  inviteTitle: "Konto erstellen", inviteIntro: "Bitte geben Sie Ihren Namen ein.", createAccount: "Konto erstellen",
  users: "Benutzer", roles: "Rollen", sites: "Stationen", audit: "Protokoll", orgs: "Organisationen",
  invite: "Einladen", invitations: "Offene Einladungen", resend: "Erneut senden", revoke: "Zurückziehen",
  deactivate: "Deaktivieren", reactivate: "Reaktivieren", signOutEverywhere: "Alle Sitzungen abmelden",
  role: "Rolle", site: "Station", allSites: "Alle Stationen", scope: "Bereich", expires: "Läuft ab", status: "Status",
  permissions: "Berechtigungen", description: "Beschreibung", newRole: "Neue Rolle", system: "Standard",
  type: "Typ", capacity: "Plätze", country: "Land", address: "Adresse", tenant: "Tenant", commission: "Provision %",
  reportEmails: "Berichts-E-Mails (Komma)", newSite: "Neue Station", active: "Aktiv", inactive: "Inaktiv",
  carrosserie: "Carrosserie", hall: "Halle", parc: "Parkplatz/Logistik",
  scopeAssigne: "Nur zugewiesene Fahrzeuge", scopeStation: "Alle Fahrzeuge der Station", scopeCampagne: "Fahrzeuge einer Kampagne",
  scopeClient: "Fahrzeuge dieser Carrosserie (Kunde)", scopeAssurance: "Fahrzeuge einer Versicherung",
  clientStation: "Carrosserie (Kunde)", loading: "Lädt …", forbidden: "Keine Berechtigung",
  org: "Organisation", superAdmin: "Super-Admin", current: "aktiv", invalidInput: "Ungültige Eingabe", networkError: "Server nicht erreichbar",
  invitationLanguage: "Sprache der Einladung",
  tenantsComma: "Azure-Tenants (Komma)", tenantHint: "(Super-Admin weist Tenants zu)",
  time: "Zeit", action: "Aktion", object: "Objekt", beforeAfter: "Vorher → Nachher",
  // audit actions / entities
  "a.create": "Erstellt", "a.update": "Geändert", "a.delete": "Gelöscht", "a.invite": "Eingeladen", "a.grant_access": "Zugriff erteilt",
  "a.accept_invitation": "Einladung angenommen", "a.revoke": "Zurückgezogen", "a.deactivate": "Deaktiviert", "a.reactivate": "Reaktiviert",
  "a.revoke_sessions": "Sitzungen beendet", "a.assign_role": "Rolle zugewiesen", "a.unassign_role": "Rolle entzogen",
  "e.organization": "Organisation", "e.org_tenants": "Tenants", "e.invitation": "Einladung", "e.user": "Benutzer", "e.role_assignment": "Rollenzuweisung",
  "e.role": "Rolle", "e.station": "Station",
  // system roles
  "r.org_admin": "Admin der Organisation", "r.chef_site": "Stationsleiter", "r.aufnehmer": "Aufnehmer / Gutachter", "r.technicien": "Techniker",
  "r.freelance": "Freelancer", "r.carrosserie": "Carrosserie", "r.assureur": "Versicherer",
  "rd.org_admin": "Alles innerhalb der Organisation", "rd.chef_site": "Verwaltet Fahrzeuge und Team einer Station", "rd.aufnehmer": "Erfasst und kalkuliert Fahrzeuge",
  "rd.technicien": "Seine zugewiesenen Fahrzeuge, ohne Preise", "rd.freelance": "Fahrzeuge einer Kampagne, zeitlich begrenzter Zugriff",
  "rd.carrosserie": "Externes Konto: seine Fahrzeuge, wo auch immer sie stehen", "rd.assureur": "Externes Konto: Akten seiner Versicherung, ohne interne Aufteilung",
  // permissions
  "p.vehicules.voir": "Fahrzeuge ansehen", "p.vehicules.creer": "Fahrzeuge anlegen", "p.vehicules.modifier": "Fahrzeuge bearbeiten", "p.vehicules.supprimer": "Fahrzeuge löschen",
  "p.vehicules.assigner": "Fahrzeuge zuweisen", "p.vehicules.deplacer": "Fahrzeuge verschieben", "p.vehicules.changer_statut": "Status ändern",
  "p.prix.voir": "Preise ansehen", "p.repartition_interne.voir": "Interne Aufteilung ansehen", "p.ma_part.voir": "Eigenen Anteil ansehen", "p.ma_commission.voir": "Eigene Provision ansehen",
  "p.commission.modifier": "Provision ändern", "p.kva.envoyer": "KVA senden", "p.rapport_reparation.envoyer": "Reparaturbericht senden",
  "p.photos.ajouter": "Fotos hinzufügen", "p.photos.supprimer": "Fotos löschen", "p.colibri.importer": "Colibri importieren", "p.export.excel": "Excel-Export",
  "p.assurances.gerer": "Versicherungen verwalten", "p.campagnes.gerer": "Kampagnen verwalten", "p.stations.gerer": "Stationen verwalten", "p.parametres.gerer": "Einstellungen verwalten",
  "p.utilisateurs.gerer": "Benutzer verwalten", "p.roles.gerer": "Rollen verwalten", "p.audit.voir": "Protokoll ansehen", "p.dashboard.voir": "Dashboard ansehen",
  "p.reparatur.board": "Reparatur-Board bedienen", "p.reparatur.endabnahme": "Endabnahme (Chef de station)", "p.termine.buchen": "Reparaturtermine buchen", "p.methoden.gerer": "Berechnungsmethoden verwalten", "p.wochenbericht.voir": "Wochenbericht ansehen", "p.kommentare.schreiben": "Kommentare lesen und schreiben",
} as const;

const de = { ...deBase, ...deField, ...deV3 };
export type Key = keyof typeof de;

const enBase: Record<keyof typeof deBase, string> = {
  appName: "PDR Hagel",
  language: "Language",
  email: "E-mail", name: "Name", login: "Sign in", logout: "Sign out", save: "Save", edit: "Edit", cancel: "Cancel", delete: "Delete",
  loginIntro: "Sign in with your e-mail and password.", sendLink: "Send link", linkSent: "If an account exists, a link has been sent.",
  password: "Password", passwordNew: "New password (min. 10 characters)", passwordConfirm: "Repeat password", passwordCurrent: "Current password",
  periodToday: "Today", periodWeek: "This week", periodLastWeek: "Last week", periodMonth: "This month", periodAll: "All time", periodCustom: "Custom period", filtersLabel: "Filters",
  kpiPresent: "Present", kpiDelayed: "Delayed", kpiNet: "Net in period", attention: "Attention", siteFullMsg: "{name} is full ({n}/{cap})", allGood: "All good.",
  exportTech: "Technician pay", exportChoose: "Choose a format", exportPdf: "PDF – worksheet per technician (to print and sign)", exportExcel: "Excel – overview and one sheet per technician (editable)", exportTechHint: "Vehicles finished in the period and the amount per technician: one sheet per technician, like the worksheet.",
  exportBusy: "Creating …", exportEmpty: "No finished vehicles in this period.", exportNoRight: "You need the right to see the internal split for this.", periodShown: "Period",
  sasExpires: "Azure access token (SAS) valid until", sasExpired: "The Azure access token has expired: create a new one and set it in Railway",
  afterMove: "after the move", occupancy: "Occupancy", full: "full", over: "over capacity",
  "w.capacity_full": "Destination is full – moved anyway.", "w.tenant_differs": "Destination belongs to another tenant – moved anyway.",
  moveFullWarn: "This station is full. The vehicle can still be moved.", moveTenantWarn: "Different tenant than the current station.",
  dashboard: "Dashboard", dashSites: "Stations", dashDurations: "Durations and delays", dashTech: "Technicians", dashRevenue: "Revenue",
  arrivalsToday: "Arrivals today", departuresToday: "Departures today", avgToReturned: "Avg. arrival → returned", avgRepair: "Avg. repair time",
  daysShort: "days", delayedVehicles: "Delayed vehicles", holdByReason: "On hold by reason", noneDash: "None.", sinceDays: "for {n} d (limit {max})",
  assignedN: "Assigned", inProgressN: "In progress", finishedN: "Finished in period", noRoleOnSite: "without a role on the station",
  revTotal: "Net total", revBySite: "By station", revByClient: "By carrosserie", revByInsurer: "By insurer", revByMonth: "By month",
  splitTech: "Technician shares", splitComm: "Carrosserie commissions", splitRest: "Remaining PDR",
  periodFrom: "From", periodTo: "To", allCampaigns: "All campaigns", allClients: "All carrosseries", allInsurers: "All insurers",
  delayThresholds: "Delay after (days per status)", dashOnline: "The dashboard needs an internet connection.", filterActive: "Filter from the dashboard", clearFilter: "Clear filter",
  vehiclesCount: "Vehicles", presentN: "present",
  azureLinksOnly: "Only these links (customer-insurance)", azureFilter: "Search link (customer-insurance) …", azureAll: "all", azureNoMore: "No more links.", azureLinksHint: "Pick as many links (customer-insurance) as you like; scans carrying one of these names belong to this station.",
  passwordShort: "The password must be at least 10 characters long.",
  passwordMismatch: "The passwords do not match.", passwordChange: "Change password", passwordSet: "Set password", passwordSaved: "Password saved. Other devices were signed out.",
  forgotPassword: "Forgot your password / no password yet? E-mail me a link", firstLoginHint: "First time: request a link by e-mail, sign in, then set a password under “Password”.",
  verifying: "Signing you in …", linkInvalid: "Link invalid or expired.",
  inviteTitle: "Create account", inviteIntro: "Please enter your name.", createAccount: "Create account",
  users: "Users", roles: "Roles", sites: "Stations", audit: "Audit log", orgs: "Organisations",
  invite: "Invite", invitations: "Pending invitations", resend: "Resend", revoke: "Revoke",
  deactivate: "Deactivate", reactivate: "Reactivate", signOutEverywhere: "Sign out everywhere",
  role: "Role", site: "Station", allSites: "All stations", scope: "Scope", expires: "Expires", status: "Status",
  permissions: "Permissions", description: "Description", newRole: "New role", system: "Default",
  type: "Type", capacity: "Places", country: "Country", address: "Address", tenant: "Tenant", commission: "Commission %",
  reportEmails: "Report e-mails (comma)", newSite: "New station", active: "Active", inactive: "Inactive",
  carrosserie: "Body shop (carrosserie)", hall: "Hall", parc: "Yard / logistics",
  scopeAssigne: "Assigned vehicles only", scopeStation: "All vehicles of the station", scopeCampagne: "Vehicles of a campaign",
  scopeClient: "Vehicles of this body shop (customer)", scopeAssurance: "Vehicles of an insurer",
  clientStation: "Body shop (customer)", loading: "Loading …", forbidden: "Not permitted",
  org: "Organisation", superAdmin: "Super-admin", current: "current", invalidInput: "Invalid input", networkError: "Server unreachable",
  invitationLanguage: "Invitation language",
  tenantsComma: "Azure tenants (comma)", tenantHint: "(the super-admin assigns tenants)",
  time: "Time", action: "Action", object: "Object", beforeAfter: "Before → after",
  "a.create": "Created", "a.update": "Changed", "a.delete": "Deleted", "a.invite": "Invited", "a.grant_access": "Access granted",
  "a.accept_invitation": "Invitation accepted", "a.revoke": "Revoked", "a.deactivate": "Deactivated", "a.reactivate": "Reactivated",
  "a.revoke_sessions": "Sessions ended", "a.assign_role": "Role assigned", "a.unassign_role": "Role removed",
  "e.organization": "Organisation", "e.org_tenants": "Tenants", "e.invitation": "Invitation", "e.user": "User", "e.role_assignment": "Role assignment",
  "e.role": "Role", "e.station": "Station",
  "r.org_admin": "Organisation admin", "r.chef_site": "Station manager", "r.aufnehmer": "Assessor / expert", "r.technicien": "Technician",
  "r.freelance": "Freelancer", "r.carrosserie": "Body shop", "r.assureur": "Insurer",
  "rd.org_admin": "Everything within the organisation", "rd.chef_site": "Manages the vehicles and team of one station", "rd.aufnehmer": "Records and prices vehicles",
  "rd.technicien": "Only their assigned vehicles, no prices", "rd.freelance": "Vehicles of one campaign, time-limited access",
  "rd.carrosserie": "External account: its vehicles, wherever they are", "rd.assureur": "External account: its insurer's files, without the internal split",
  "p.vehicules.voir": "View vehicles", "p.vehicules.creer": "Create vehicles", "p.vehicules.modifier": "Edit vehicles", "p.vehicules.supprimer": "Delete vehicles",
  "p.vehicules.assigner": "Assign vehicles", "p.vehicules.deplacer": "Move vehicles", "p.vehicules.changer_statut": "Change status",
  "p.prix.voir": "View prices", "p.repartition_interne.voir": "View internal split", "p.ma_part.voir": "View own share", "p.ma_commission.voir": "View own commission",
  "p.commission.modifier": "Change commission", "p.kva.envoyer": "Send estimate (KVA)", "p.rapport_reparation.envoyer": "Send repair report",
  "p.photos.ajouter": "Add photos", "p.photos.supprimer": "Delete photos", "p.colibri.importer": "Import Colibri", "p.export.excel": "Excel export",
  "p.assurances.gerer": "Manage insurers", "p.campagnes.gerer": "Manage campaigns", "p.stations.gerer": "Manage stations", "p.parametres.gerer": "Manage settings",
  "p.utilisateurs.gerer": "Manage users", "p.roles.gerer": "Manage roles", "p.audit.voir": "View audit log", "p.dashboard.voir": "View dashboard",
  "p.reparatur.board": "Use the repair board", "p.reparatur.endabnahme": "Final acceptance (station manager)", "p.termine.buchen": "Book repair appointments", "p.methoden.gerer": "Manage calculation methods", "p.wochenbericht.voir": "View the weekly report", "p.kommentare.schreiben": "Read and write comments",
};

const en: Record<Key, string> = { ...enBase, ...enField, ...enV3 };

export const dictionaries: Record<Lang, Record<Key, string>> = { de, en };

// ---- current language (module state, subscribable) ----
const STORE = "hagel.lang";
function initial(): Lang {
  try {
    const s = localStorage.getItem(STORE);
    if (isLang(s)) return s;
  } catch { /* storage unavailable */ }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en") ? "en" : DEFAULT_LANG;
}
let current: Lang = initial();
const listeners = new Set<() => void>();

export const getLang = (): Lang => current;
export const hasStoredLang = (): boolean => { try { return isLang(localStorage.getItem(STORE)); } catch { return false; } };
export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try { localStorage.setItem(STORE, l); } catch { /* ignore */ }
  if (typeof document !== "undefined") document.documentElement.lang = l;
  listeners.forEach((f) => f());
}
export const LANG_LIST = LANGS;
export const isLangValue = isLang;
/** Re-renders the calling component when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, getLang, getLang);
}

export const t = (k: Key): string => dictionaries[current][k];
/** Translated label if the key exists, otherwise the fallback (e.g. a custom, admin-defined name). */
export function tOr(k: string, fallback: string): string {
  const d = dictionaries[current] as Record<string, string>;
  return d[k] ?? fallback;
}
export const locale = () => (current === "en" ? "en-GB" : "de-DE");
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(locale());
if (typeof document !== "undefined") document.documentElement.lang = current;
