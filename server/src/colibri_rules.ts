// Pure rules for Colibri scanners (no database): dates, time zones, which station a scanner stood in on a given day.

export interface DeviceRow { id: string; orgId: string; tenant: string; number: string }
export interface AssignmentRow { deviceId: string; stationId: string; validFrom: string; validTo: string | null }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: unknown): s is string => typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
export const addDays = (iso: string, n: number): string => new Date(Date.parse(iso + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** Time zone of the country of the organisation that owns the scanner: Spain = Madrid, everything else = Berlin. */
export const tzOfOrgCountry = (country: string) => (country === "ES" ? "Europe/Madrid" : "Europe/Berlin");
/** The local calendar day (YYYY-MM-DD) of an instant: the day a scan belongs to when a scanner is moved by date. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
/** The assignment of a device that is valid on a local day (valid_from <= day <= valid_to, an open one has no end). */
export const assignmentAt = (as: AssignmentRow[], deviceId: string, day: string): AssignmentRow | undefined =>
  as.find((a) => a.deviceId === deviceId && a.validFrom <= day && (a.validTo === null || a.validTo >= day));

