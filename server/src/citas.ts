/**
 * Read-only access to the PDR Citas appointment API (a second site where customers book an expertise at a location).
 * Nothing here ever writes to Citas; the API key stays on the server (never logged, never in an error message).
 */
export interface CitasLocation { id: string; slug: string; name: string; address: string; timezone: string; active: boolean }

export type CitasStatus = "confirmed" | "cancel_requested" | "cancelled";
export interface CitasAppointment {
  id: string;
  location: { id: string; slug: string; name: string };
  date: string;
  time: string;
  starts_at: string;
  duration_min: number;
  status: CitasStatus;
  customer: { first_name: string; last_name: string; phone: string; email: string };
  vehicle: { license_plate: string; license_plate_normalized: string; vin: string | null; make: string | null; model: string | null };
  insurance_name: string;
  case_number: string | null;
  created_at: string;
  updated_at: string;
}
export interface CitasDay { date: string; generated_at: string; appointments: CitasAppointment[] }

export interface CitasSource {
  health(): Promise<{ ok: boolean; version?: string }>;
  locations(): Promise<CitasLocation[]>;
  appointments(o: { date: string; location: string; includeCancelled?: boolean }): Promise<CitasDay>;
  appointment(id: string): Promise<CitasAppointment>;
}

/** What went wrong, without any detail that could leak the URL or the key. */
export type CitasErrorKind = "unauthorized" | "disabled" | "bad_request" | "not_found" | "rate_limited" | "unreachable";
export class CitasError extends Error {
  constructor(public kind: CitasErrorKind, public httpStatus?: number) { super(`citas_${kind}`); }
}

type FetchFn = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export interface CitasConfig { url: string; key: string; fetch?: FetchFn; timeoutMs?: number }

export class CitasRest implements CitasSource {
  private f: FetchFn;
  private timeoutMs: number;
  constructor(private cfg: CitasConfig) {
    this.f = cfg.fetch ?? ((u, i) => fetch(u, i));
    this.timeoutMs = cfg.timeoutMs ?? 5000;
  }

  private async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const q = new URLSearchParams(query).toString();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.f(`${this.cfg.url}/api/v1/external/${path}${q ? "?" + q : ""}`, { headers: { authorization: `Bearer ${this.cfg.key}`, accept: "application/json" }, signal: ctl.signal });
      if (!res.ok) {
        const kind: CitasErrorKind = res.status === 401 ? "unauthorized" : res.status === 503 ? "disabled" : res.status === 400 ? "bad_request" : res.status === 404 ? "not_found" : res.status === 429 ? "rate_limited" : "unreachable";
        throw new CitasError(kind, res.status);
      }
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof CitasError) throw e;
      throw new CitasError("unreachable"); // network error, timeout (abort) or a body that is not JSON
    } finally { clearTimeout(timer); }
  }

  health() { return this.get<{ ok: boolean; version?: string }>("health"); }
  locations() { return this.get<CitasLocation[]>("locations"); }
  appointments(o: { date: string; location: string; includeCancelled?: boolean }) {
    return this.get<CitasDay>("appointments", { date: o.date, location: o.location, ...(o.includeCancelled ? { include_cancelled: "1" } : {}) });
  }
  appointment(id: string) { return this.get<CitasAppointment>(`appointments/${encodeURIComponent(id)}`); }
}

/** null when CITAS_API_URL or CITAS_API_KEY is missing: the feature is then simply hidden. */
export function citasFromConfig(cfg: { citasApiUrl: string | null; citasApiKey: string | null }): CitasSource | null {
  return cfg.citasApiUrl && cfg.citasApiKey ? new CitasRest({ url: cfg.citasApiUrl, key: cfg.citasApiKey }) : null;
}

// ------------------------------------------------------------------ matching helpers

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Licence plate as compared between Citas and Colibri: upper case, letters and digits only ("9547 LPV" = "9547-lpv"). */
export const normalizePlate = (s: unknown) => strip(String(s ?? "")).toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Keys an insurer name is compared by: upper case, no accents, spaces, hyphens or punctuation. Citas writes "ñ" as "NI" in some names
 * ("MUTUA-MADRILENIA" for "Mutua Madrileña"), so a name with a "ñ" has both spellings; two names match when they share a key.
 */
export function insurerKeys(name: unknown): string[] {
  const raw = String(name ?? "").normalize("NFC").toUpperCase();
  const clean = (s: string) => strip(s).replace(/[^A-Z0-9]/g, "");
  const keys = new Set([clean(raw), clean(raw.replace(/Ñ/g, "NI"))]);
  keys.delete("");
  return [...keys];
}
export const sameInsurer = (a: unknown, b: unknown) => { const kb = insurerKeys(b); return insurerKeys(a).some((k) => kb.includes(k)); };

/** Calendar day (YYYY-MM-DD) of an instant in a time zone; falls back to Europe/Madrid for an unknown zone. */
export function dayInZone(at: Date | number | string, timeZone: string): string {
  const d = new Date(at);
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
  catch { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
}
export const zoneOfCountry = (country: string) => (country === "ES" ? "Europe/Madrid" : "Europe/Berlin");
