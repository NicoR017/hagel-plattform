export const LANGS = ["de", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "de";
export const isLang = (x: unknown): x is Lang => (LANGS as readonly unknown[]).includes(x);

/** API error codes with their messages. `{x}` placeholders are filled from `params`. */
export const ERROR_MESSAGES = {
  role_not_found: { de: "Rolle nicht gefunden", en: "Role not found" },
  station_not_found: { de: "Werkstatt nicht gefunden", en: "Site not found" },
  invitation_not_found: { de: "Einladung nicht gefunden", en: "Invitation not found" },
  assignment_not_found: { de: "Zuweisung nicht gefunden", en: "Assignment not found" },
  user_not_found: { de: "Benutzer nicht gefunden", en: "User not found" },
  session_expired: { de: "Sitzung abgelaufen", en: "Session expired" },
  not_authenticated: { de: "Nicht angemeldet", en: "Not signed in" },
  account_disabled: { de: "Konto deaktiviert", en: "Account deactivated" },
  account_disabled_reactivate: { de: "Konto ist deaktiviert – bitte reaktivieren", en: "Account is deactivated – please reactivate it first" },
  too_many_requests: { de: "Zu viele Anfragen – bitte später erneut versuchen", en: "Too many requests – please try again later" },
  system_role_undeletable: { de: "Standardrollen können nicht gelöscht werden", en: "Default roles cannot be deleted" },
  role_in_use: { de: "Rolle ist noch zugewiesen", en: "Role is still assigned" },
  cannot_grant: { de: "Sie dürfen diese Rechte nicht vergeben: {missing}", en: "You are not allowed to grant these permissions: {missing}" },
  superadmin_undeactivatable: { de: "Super-Admin kann nicht deaktiviert werden", en: "The super-admin cannot be deactivated" },
  self_deactivate: { de: "Sie können sich nicht selbst deaktivieren", en: "You cannot deactivate yourself" },
  superadmin_only: { de: "Nur Super-Admin", en: "Super-admin only" },
  forbidden: { de: "Keine Berechtigung", en: "Not permitted" },
  no_access: { de: "Kein Zugriff", en: "No access" },
  link_invalid: { de: "Link ungültig oder abgelaufen", en: "Link invalid or expired" },
  invitation_invalid: { de: "Einladung ungültig oder abgelaufen", en: "Invitation invalid or expired" },
  org_header_missing: { de: "X-Org-Id fehlt", en: "X-Org-Id is missing" },
  station_wrong_org: { de: "Werkstatt gehört nicht zu dieser Organisation", en: "This site does not belong to this organisation" },
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
  station_unknown: { de: "Unbekannte Werkstatt", en: "Unknown site" },
  file_too_large: { de: "Datei zu groß", en: "File too large" },
  file_type: { de: "Dateityp nicht erlaubt", en: "File type not allowed" },
  ocr_unavailable: { de: "Texterkennung nicht verfügbar", en: "Text recognition unavailable" },
  ocr_failed: { de: "Texterkennung fehlgeschlagen", en: "Text recognition failed" },
  invalid_input: { de: "Ungültige Eingabe", en: "Invalid input" },
  internal: { de: "Interner Fehler", en: "Internal error" },
} as const;
export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function errorMessage(code: ErrorCode, lang: Lang = DEFAULT_LANG, params: Record<string, string> = {}): string {
  const m = ERROR_MESSAGES[code][lang];
  return m.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
}

/** Resolves the request language from `X-Lang`, then `Accept-Language`, else the default. */
export function pickLang(xLang?: string | null, acceptLanguage?: string | null): Lang {
  if (isLang(xLang)) return xLang;
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return isLang(first) ? first : DEFAULT_LANG;
}
