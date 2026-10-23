import { CitasError, type CitasAppointment, type CitasDay, type CitasErrorKind, type CitasLocation, type CitasSource } from "./citas";

/** In-memory Citas for tests and local development (same contract as the real read-only API). */
export class FakeCitas implements CitasSource {
  locs: CitasLocation[] = [];
  appts: CitasAppointment[] = [];
  /** every call, e.g. "appointments:2026-10-23:loc-1" */
  calls: string[] = [];
  /** every call of the API fails with this kind */
  failWith: CitasErrorKind | null = null;

  addLocation(l: Partial<CitasLocation> & { id: string }): CitasLocation {
    const x: CitasLocation = { slug: l.id, name: l.id, address: "", timezone: "Europe/Madrid", active: true, ...l };
    this.locs.push(x);
    return x;
  }
  /** Adds an appointment; every part can be overridden. */
  add(o: { id: string; location?: string; date: string; time?: string; status?: CitasAppointment["status"]; plate?: string; vin?: string | null; make?: string | null; model?: string | null;
    insurance?: string; caseNumber?: string | null; first?: string; last?: string; phone?: string; email?: string }): CitasAppointment {
    const loc = this.locs.find((l) => l.id === (o.location ?? this.locs[0]?.id)) ?? { id: o.location ?? "loc", slug: o.location ?? "loc", name: o.location ?? "loc" };
    const plate = o.plate ?? "9547 LPV";
    const time = o.time ?? "10:00";
    const a: CitasAppointment = {
      id: o.id, location: { id: loc.id, slug: loc.slug, name: loc.name }, date: o.date, time, starts_at: `${o.date}T${time}:00+02:00`, duration_min: 30,
      status: o.status ?? "confirmed", customer: { first_name: o.first ?? "Ana", last_name: o.last ?? "García", phone: o.phone ?? "+34600111222", email: o.email ?? "ana@example.test" },
      vehicle: { license_plate: plate, license_plate_normalized: plate.toUpperCase().replace(/[^A-Z0-9]/g, ""), vin: o.vin ?? null, make: o.make === undefined ? "Volkswagen" : o.make, model: o.model === undefined ? "Golf" : o.model },
      insurance_name: o.insurance ?? "", case_number: o.caseNumber ?? null, created_at: `${o.date}T08:00:00Z`, updated_at: `${o.date}T08:00:00Z`,
    };
    this.appts.push(a);
    return a;
  }

  private check(call: string) {
    this.calls.push(call);
    if (this.failWith) throw new CitasError(this.failWith);
  }
  async health() { this.check("health"); return { ok: true, version: "1" }; }
  async locations() { this.check("locations"); return this.locs; }
  async appointments(o: { date: string; location: string; includeCancelled?: boolean }): Promise<CitasDay> {
    this.check(`appointments:${o.date}:${o.location}`);
    if (!this.locs.some((l) => l.id === o.location)) throw new CitasError("not_found", 404);
    return { date: o.date, generated_at: new Date().toISOString(), appointments: this.appts.filter((a) => a.date === o.date && a.location.id === o.location && (o.includeCancelled || a.status !== "cancelled")) };
  }
  async appointment(id: string) {
    this.check(`appointment:${id}`);
    const a = this.appts.find((x) => x.id === id);
    if (!a) throw new CitasError("not_found", 404);
    return a;
  }
}
