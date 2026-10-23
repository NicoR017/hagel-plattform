import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

/** An appointment of PDR Citas as the server hands it over (enriched with what Hagel knows about it). */
export interface Appt {
  id: string; time: string; date: string; status: "confirmed" | "cancel_requested" | "cancelled";
  customer: { first_name: string; last_name: string; phone: string; email: string };
  vehicle: { license_plate: string; license_plate_normalized: string; vin: string | null; make: string | null; model: string | null };
  insurance_name: string; case_number: string | null;
  vehicleId: string | null; vehicleStatut: string | null; insurerId: string | null; matchingScans: number;
}
export interface CitasDay { configured: boolean; linked: boolean; date?: string; timezone?: string; appointments: Appt[] }

/** Plates compare without spaces, hyphens, accents or case (the same rule as the server). */
export const normPlate = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Calendar day of an instant in a time zone (YYYY-MM-DD). */
export const dayIn = (iso: string, timeZone: string): string => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); }
  catch { return iso.slice(0, 10); }
};

export const customerName = (a: Appt) => `${a.customer.first_name} ${a.customer.last_name}`.trim();
export const carName = (a: Appt) => [a.vehicle.make, a.vehicle.model].filter(Boolean).join(" ");

/** true while the device has a network connection */
export function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return on;
}

/** Stations known to be linked to a Citas location (so that offline the block can say "online only" instead of vanishing). */
export const linkedStations = new Set<string>();

/** The appointments of a station for a day (undefined = today at the location). Online only; `refresh` skips the server's 60 s cache. */
export function useCitasDay(stationId: string, date: string | undefined, enabled: boolean) {
  const [data, setData] = useState<CitasDay | null>(null);
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (fresh: boolean) => {
    setLoading(true);
    try {
      const r = await api<CitasDay>("GET", `/citas/appointments?station_id=${stationId}${date ? `&date=${date}` : ""}${fresh ? "&refresh=1" : ""}`);
      if (r.configured && r.linked) linkedStations.add(stationId); else linkedStations.delete(stationId);
      setData(r); setErr(false);
    } catch { setErr(true); }
    setLoading(false);
  }, [stationId, date]);
  useEffect(() => { if (enabled) void load(false); }, [enabled, load]);
  return { data, err, loading, refresh: () => load(true) };
}
