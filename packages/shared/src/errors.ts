import { ERRORS_ES, ERRORS_FR } from "./errors_fr_es";

/** UI / e-mail languages: German (default), English, French, Spanish */
export const LANGS = ["de", "en", "fr", "es"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "de";
export const isLang = (x: unknown): x is Lang => (LANGS as readonly unknown[]).includes(x);

/** API error codes with their messages. `{x}` placeholders are filled from `params`. */
export const ERROR_MESSAGES = {
  role_not_found: { de: "Rolle nicht gefunden", en: "Role not found" },
  station_not_found: { de: "Station nicht gefunden", en: "Station not found" },
  invitation_not_found: { de: "Einladung nicht gefunden", en: "Invitation not found" },
  assignment_not_found: { de: "Zuweisung nicht gefunden", en: "Assignment not found" },
  user_not_found: { de: "Benutzer nicht gefunden", en: "User not found" },
  session_expired: { de: "Sitzung abgelaufen", en: "Session expired" },
  not_authenticated: { de: "Nicht angemeldet", en: "Not signed in" },
  account_disabled: { de: "Konto deaktiviert", en: "Account deactivated" },
  account_disabled_reactivate: { de: "Konto ist deaktiviert – bitte reaktivieren", en: "Account is deactivated – please reactivate it first" },
  too_many_requests: { de: "Zu viele Anfragen – bitte später erneut versuchen", en: "Too many requests – please try again later" },
  role_last_admin: { de: "Die letzte Rolle, die Rollen verwalten darf, kann nicht gelöscht werden", en: "The last role that can manage roles cannot be deleted" },
  system_role_undeletable: { de: "Standardrollen können nicht gelöscht werden", en: "Default roles cannot be deleted" },
  role_in_use: { de: "Rolle ist noch zugewiesen", en: "Role is still assigned" },
  cannot_grant: { de: "Sie dürfen diese Rechte nicht vergeben: {missing}", en: "You are not allowed to grant these permissions: {missing}" },
  superadmin_undeactivatable: { de: "Super-Admin kann nicht deaktiviert werden", en: "The super-admin cannot be deactivated" },
  self_deactivate: { de: "Sie können sich nicht selbst deaktivieren", en: "You cannot deactivate yourself" },
  superadmin_undeletable: { de: "Super-Admin kann nicht gelöscht werden", en: "The super-admin cannot be deleted" },
  self_delete: { de: "Sie können sich nicht selbst löschen", en: "You cannot delete yourself" },
  replacement_invalid: { de: "Die Ersatzrolle ist ungültig (gleicher Sichtbarkeitsbereich nötig)", en: "The replacement role is invalid (it needs the same visibility scope)" },
  weekly_report_empty: { de: "Keine abgeschlossenen Fahrzeuge in dieser Woche", en: "No finished vehicles in this week" },
  bodyshop_invalid: { de: "Diese Karosserie kann nicht gewählt werden (andere Organisation oder anderer Tenant)", en: "This body shop cannot be chosen (other organisation or tenant)" },
  station_in_use: { de: "Die Station kann nicht gelöscht werden: {n} Fahrzeug(e) stehen dort, {m} gehören ihr als Kunde, {k} sind ihr als Karosserie zugeordnet. Zuerst verschieben oder zurückgeben (oder die Station nur deaktivieren).", en: "The station cannot be deleted: {n} vehicle(s) stand there, {m} belong to it as customer, {k} are assigned to it as body shop. Move or return them first (or just deactivate the station)." },
  station_has_bookings: { de: "Die Station hat noch {n} offene Reparaturtermine.", en: "The station still has {n} open repair appointments." },
  no_recipient: { de: "Keine E-Mail-Adresse für diese Person hinterlegt", en: "No e-mail address on file for this person" },
  superadmin_only: { de: "Nur Super-Admin", en: "Super-admin only" },
  forbidden: { de: "Keine Berechtigung", en: "Not permitted" },
  no_access: { de: "Kein Zugriff", en: "No access" },
  invalid_credentials: { de: "E-Mail oder Passwort falsch", en: "Wrong e-mail or password" },
  password_weak: { de: "Das Passwort muss mindestens 10 Zeichen lang sein", en: "The password must be at least 10 characters long" },
  wrong_current_password: { de: "Aktuelles Passwort falsch", en: "Current password is wrong" },
  link_invalid: { de: "Link ungültig oder abgelaufen", en: "Link invalid or expired" },
  invitation_invalid: { de: "Einladung ungültig oder abgelaufen", en: "Invitation invalid or expired" },
  org_header_missing: { de: "X-Org-Id fehlt", en: "X-Org-Id is missing" },
  station_wrong_org: { de: "Station gehört nicht zu dieser Organisation", en: "This station does not belong to this organisation" },
  insurer_required: { de: "Versicherung ist für diese Rolle erforderlich", en: "An insurer is required for this role" },
  insurer_wrong_org: { de: "Versicherung gehört nicht zu dieser Organisation", en: "This insurer does not belong to this organisation" },
  tenant_not_allowed: { de: "Tenant ist für diese Organisation nicht freigegeben", en: "This tenant is not enabled for this organisation" },
  tenant_required: { de: "Tenant ist erforderlich", en: "A tenant is required" },
  campaign_required: { de: "Kampagne ist für diese Rolle erforderlich", en: "A campaign is required for this role" },
  client_required: { de: "Carrosserie (Kunde) ist für diese Rolle erforderlich", en: "A carrosserie (customer) is required for this role" },
  vehicle_not_found: { de: "Fahrzeug nicht gefunden", en: "Vehicle not found" },
  photo_not_found: { de: "Foto nicht gefunden", en: "Photo not found" },
  not_allowed: { de: "Aktion nicht erlaubt", en: "Action not allowed" },
  field_not_allowed: { de: "Feld nicht erlaubt: {fields}", en: "Field not allowed: {fields}" },
  vehicle_exists: { de: "Fahrzeug existiert bereits", en: "Vehicle already exists" },
  motif_required: { de: "Für den Status „Wartet“ ist ein Grund erforderlich", en: "A reason is required for status “On hold”" },
  station_unknown: { de: "Unbekannte Station", en: "Unknown station" },
  handover_not_found: { de: "Übergabe nicht gefunden", en: "Hand-over not found" },
  device_not_found: { de: "Colibri-Scanner nicht gefunden", en: "Colibri scanner not found" },
  device_exists: { de: "Dieser Colibri-Scanner ist bereits angelegt", en: "This Colibri scanner already exists" },
  station_not_a_place: { de: "Ein Body Shop ist kein Standort: Fahrzeuge stehen nur in Hallen oder auf Plätzen", en: "A body shop is not a place: cars only stand in workshops or yards" },
  client_not_bodyshop: { de: "Als Kunde ist nur ein Body Shop möglich", en: "Only a body shop can be the customer" },
  use_bodyshops: { de: "Body Shops werden unter Verwaltung → Body Shops verwaltet", en: "Body shops are managed under Administration → Body shops" },
  use_stations: { de: "Hallen und Plätze werden unter Verwaltung → Stationen verwaltet", en: "Workshops and yards are managed under Administration → Stations" },
  file_too_large: { de: "Datei zu groß", en: "File too large" },
  file_type: { de: "Dateityp nicht erlaubt", en: "File type not allowed" },
  ocr_unavailable: { de: "Texterkennung nicht verfügbar", en: "Text recognition unavailable" },
  ocr_failed: { de: "Texterkennung fehlgeschlagen", en: "Text recognition failed" },
  report_no_recipients: { de: "Keine Empfänger hinterlegt (Carrosserie / Versicherung)", en: "No recipients configured (body shop / insurer)" },
  report_failed: { de: "E-Mail konnte nicht gesendet werden", en: "The e-mail could not be sent" },
  report_exists: { de: "Bericht wurde bereits gesendet", en: "This report was already sent" },
  insurer_not_found: { de: "Versicherung nicht gefunden", en: "Insurer not found" },
  campaign_not_found: { de: "Kampagne nicht gefunden", en: "Campaign not found" },
  company_not_found: { de: "Briefkopf nicht gefunden", en: "Letterhead not found" },
  technician_in_use: { de: "Der Techniker hat Termine im Reparaturkalender – bitte deaktivieren statt löschen", en: "The technician has appointments in the repair calendar – deactivate instead of deleting" },
  technician_not_found: { de: "Techniker nicht gefunden", en: "Technician not found" },
  azure_unavailable: { de: "Azure-Anbindung nicht konfiguriert", en: "Azure connection is not configured" },
  azure_failed: { de: "Azure-Abgleich fehlgeschlagen", en: "Azure sync failed" },
  citas_unavailable: { de: "PDR Citas ist nicht konfiguriert", en: "PDR Citas is not configured" },
  citas_unreachable: { de: "PDR Citas ist nicht erreichbar", en: "PDR Citas cannot be reached" },
  citas_cancelled: { de: "Dieser Termin wurde storniert", en: "This appointment was cancelled" },
  scan_not_importable: { de: "Dieser Scan kann nicht übernommen werden ({status})", en: "This scan cannot be taken over ({status})" },
  azure_link_unknown: { de: "Unbekannter Colibri-Kunde", en: "Unknown Colibri customer" },
  vehicle_not_in_repair: { de: "Das Fahrzeug ist nicht in Reparatur", en: "The vehicle is not in repair" },
  move_not_allowed: { de: "Diese Verschiebung ist für dich nicht erlaubt", en: "You may not make this move" },
  not_your_vehicle: { de: "Das ist nicht dein Fahrzeug", en: "This is not your vehicle" },
  photo_required: { de: "Vor dem Verschieben ist ein Foto des aktuellen Schritts nötig", en: "A photo of the current step is required before moving" },
  stage_invalid: { de: "Ungültiger Reparaturschritt", en: "Invalid repair step" },
  finish_blocked: { de: "„Finish“ nicht möglich: {reasons}", en: "“Finish” is not possible: {reasons}" },
  not_assessed: { de: "Nur expertisierte Fahrzeuge können in Reparatur aufgenommen werden", en: "Only assessed vehicles can be taken into repair" },
  todo_not_found: { de: "Aufgabe nicht gefunden", en: "To-do not found" },
  appointment_not_found: { de: "Termin nicht gefunden", en: "Appointment not found" },
  booking_not_found: { de: "Reparaturtermin nicht gefunden", en: "Repair booking not found" },
  booking_full: { de: "Dieser Tag ist voll – bitte einen anderen Tag wählen", en: "This day is full – please pick another day" },
  booking_date_invalid: { de: "Ungültiger Tag (Wochenende, Vergangenheit oder außerhalb des Zeitraums)", en: "Invalid day (weekend, past or out of range)" },
  booking_status: { de: "Für diesen Status ist keine Terminbuchung möglich", en: "A booking is not possible in this status" },
  booking_exists: { de: "Für dieses Fahrzeug besteht bereits ein Reparaturtermin", en: "This vehicle already has a repair booking" },
  method_not_found: { de: "Berechnungsmethode nicht gefunden", en: "Calculation method not found" },
  method_system_locked: { de: "Systemmethoden sind gesperrt – bitte kopieren", en: "System methods are locked – please copy them" },
  method_locked: { de: "Die Methode kann nicht mehr geändert werden: für eine neue Berechnung eine neue Expertise anlegen", en: "The method can no longer be changed: create a new assessment instead" },
  method_mismatch: { de: "Die Methode passt nicht zum Land des Fahrzeugs", en: "The method does not fit the vehicle's country" },
  comment_empty: { de: "Kommentar ist leer", en: "The comment is empty" },
  unsupported_op: { de: "Diese Server-Version kennt die Änderung noch nicht – sie bleibt gespeichert", en: "This server version does not know the change yet – it stays queued" },
  invalid_input: { de: "Ungültige Eingabe", en: "Invalid input" },
  internal: { de: "Interner Fehler", en: "Internal error" },
} as const;
export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function errorMessage(code: ErrorCode, lang: Lang = DEFAULT_LANG, params: Record<string, string> = {}): string {
  const e = ERROR_MESSAGES[code];
  const m = lang === "fr" ? ERRORS_FR[code] ?? e.en : lang === "es" ? ERRORS_ES[code] ?? e.en : e[lang];
  return m.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
}

/** Resolves the request language from `X-Lang`, then `Accept-Language`, else the default. */
export function pickLang(xLang?: string | null, acceptLanguage?: string | null): Lang {
  if (isLang(xLang)) return xLang;
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return isLang(first) ? first : DEFAULT_LANG;
}
