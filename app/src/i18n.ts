/**
 * One i18n file. UI languages: German (default) and English. The whole UI is always in ONE language:
 * every visible string goes through t(); a test checks that both dictionaries have the same keys.
 * Spanish can be added later as a third dictionary.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_LANG, LANGS, isLang, type Lang } from "@hagel/shared";

const de = {
  appName: "PDR Hagel",
  language: "Sprache",
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
  "e.role": "Rolle", "e.station": "Werkstatt",
  // system roles
  "r.org_admin": "Admin der Organisation", "r.chef_site": "Werkstattleiter", "r.aufnehmer": "Aufnehmer / Gutachter", "r.technicien": "Techniker",
  "r.freelance": "Freelancer", "r.carrosserie": "Carrosserie", "r.assureur": "Versicherer",
  "rd.org_admin": "Alles innerhalb der Organisation", "rd.chef_site": "Verwaltet Fahrzeuge und Team einer Werkstatt", "rd.aufnehmer": "Erfasst und kalkuliert Fahrzeuge",
  "rd.technicien": "Seine zugewiesenen Fahrzeuge, ohne Preise", "rd.freelance": "Fahrzeuge einer Kampagne, zeitlich begrenzter Zugriff",
  "rd.carrosserie": "Externes Konto: seine Fahrzeuge, wo auch immer sie stehen", "rd.assureur": "Externes Konto: Akten seiner Versicherung, ohne interne Aufteilung",
  // permissions
  "p.vehicules.voir": "Fahrzeuge ansehen", "p.vehicules.creer": "Fahrzeuge anlegen", "p.vehicules.modifier": "Fahrzeuge bearbeiten", "p.vehicules.supprimer": "Fahrzeuge löschen",
  "p.vehicules.assigner": "Fahrzeuge zuweisen", "p.vehicules.deplacer": "Fahrzeuge verschieben", "p.vehicules.changer_statut": "Status ändern",
  "p.prix.voir": "Preise ansehen", "p.repartition_interne.voir": "Interne Aufteilung ansehen", "p.ma_part.voir": "Eigenen Anteil ansehen", "p.ma_commission.voir": "Eigene Provision ansehen",
  "p.commission.modifier": "Provision ändern", "p.kva.envoyer": "KVA senden", "p.rapport_reparation.envoyer": "Reparaturbericht senden",
  "p.photos.ajouter": "Fotos hinzufügen", "p.photos.supprimer": "Fotos löschen", "p.colibri.importer": "Colibri importieren", "p.export.excel": "Excel-Export",
  "p.assurances.gerer": "Versicherungen verwalten", "p.campagnes.gerer": "Kampagnen verwalten", "p.stations.gerer": "Werkstätten verwalten", "p.parametres.gerer": "Einstellungen verwalten",
  "p.utilisateurs.gerer": "Benutzer verwalten", "p.roles.gerer": "Rollen verwalten", "p.audit.voir": "Protokoll ansehen", "p.dashboard.voir": "Dashboard ansehen",
} as const;

export type Key = keyof typeof de;

const en: Record<Key, string> = {
  appName: "PDR Hagel",
  language: "Language",
  email: "E-mail", name: "Name", login: "Sign in", logout: "Sign out", save: "Save", edit: "Edit", cancel: "Cancel", delete: "Delete",
  loginIntro: "We will send you a sign-in link by e-mail.", sendLink: "Send link", linkSent: "If an account exists, a link has been sent.",
  verifying: "Signing you in …", linkInvalid: "Link invalid or expired.",
  inviteTitle: "Create account", inviteIntro: "Please enter your name.", createAccount: "Create account",
  users: "Users", roles: "Roles", sites: "Sites", audit: "Audit log", orgs: "Organisations",
  invite: "Invite", invitations: "Pending invitations", resend: "Resend", revoke: "Revoke",
  deactivate: "Deactivate", reactivate: "Reactivate", signOutEverywhere: "Sign out everywhere",
  role: "Role", site: "Site", allSites: "All sites", scope: "Scope", expires: "Expires", status: "Status",
  permissions: "Permissions", description: "Description", newRole: "New role", system: "Default",
  type: "Type", capacity: "Places", country: "Country", address: "Address", tenant: "Tenant", commission: "Commission %",
  reportEmails: "Report e-mails (comma)", newSite: "New site", active: "Active", inactive: "Inactive",
  carrosserie: "Body shop (carrosserie)", hall: "Hall", parc: "Yard / logistics",
  scopeAssigne: "Assigned vehicles only", scopeStation: "All vehicles of the site", scopeCampagne: "Vehicles of a campaign",
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
  "e.role": "Role", "e.station": "Site",
  "r.org_admin": "Organisation admin", "r.chef_site": "Site manager", "r.aufnehmer": "Assessor / expert", "r.technicien": "Technician",
  "r.freelance": "Freelancer", "r.carrosserie": "Body shop", "r.assureur": "Insurer",
  "rd.org_admin": "Everything within the organisation", "rd.chef_site": "Manages the vehicles and team of one site", "rd.aufnehmer": "Records and prices vehicles",
  "rd.technicien": "Only their assigned vehicles, no prices", "rd.freelance": "Vehicles of one campaign, time-limited access",
  "rd.carrosserie": "External account: its vehicles, wherever they are", "rd.assureur": "External account: its insurer's files, without the internal split",
  "p.vehicules.voir": "View vehicles", "p.vehicules.creer": "Create vehicles", "p.vehicules.modifier": "Edit vehicles", "p.vehicules.supprimer": "Delete vehicles",
  "p.vehicules.assigner": "Assign vehicles", "p.vehicules.deplacer": "Move vehicles", "p.vehicules.changer_statut": "Change status",
  "p.prix.voir": "View prices", "p.repartition_interne.voir": "View internal split", "p.ma_part.voir": "View own share", "p.ma_commission.voir": "View own commission",
  "p.commission.modifier": "Change commission", "p.kva.envoyer": "Send estimate (KVA)", "p.rapport_reparation.envoyer": "Send repair report",
  "p.photos.ajouter": "Add photos", "p.photos.supprimer": "Delete photos", "p.colibri.importer": "Import Colibri", "p.export.excel": "Excel export",
  "p.assurances.gerer": "Manage insurers", "p.campagnes.gerer": "Manage campaigns", "p.stations.gerer": "Manage sites", "p.parametres.gerer": "Manage settings",
  "p.utilisateurs.gerer": "Manage users", "p.roles.gerer": "Manage roles", "p.audit.voir": "View audit log", "p.dashboard.voir": "View dashboard",
};

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
