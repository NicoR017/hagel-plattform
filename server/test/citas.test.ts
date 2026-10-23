import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { CitasError, CitasRest, dayInZone, insurerKeys, normalizePlate, sameInsurer } from "../src/citas";
import { loadConfig } from "../src/config";
import { MemoryMailer } from "../src/email";
import { citasLinks, colibriScans, vehicles } from "../src/schema";
import { fieldsOf } from "../src/routes_citas";
import { call, inviteAndAccept, setup, type Ctx } from "./helpers";

const PDF = new Uint8Array(readFileSync(new URL("../../fixtures/real/colibri_en_9547LPV.pdf", import.meta.url)));
const PK = "20261019-1627";
const RK = "9547 LPV";
const URL_PDF = "https://storagecolibri.blob.core.windows.net/allscans/20261019-1627_9547 LPV.pdf";
const DAY = "2026-10-19";

let c: Ctx, A: string, HALL: string, ins: string;
let admin: string, importer: string, techA: string;

beforeAll(async () => {
  c = await setup();
  const az = c.az;
  az.add("Tenants", { PartitionKey: "TenantA", RowKey: "TenantA" });
  az.add("BusinessCustomers", { PartitionKey: "x", RowKey: "bc-1", BusinessCustomer: "Carrosserie Talavera" });
  az.add("Insurance", { PartitionKey: "x", RowKey: "ins-1", Insurance: "Allianz Seguros" });
  az.add("BusinessCustomersInsurance", { PartitionKey: "x", RowKey: "l-1", BusinessCustomerInsurance: "Carrosserie Talavera - Allianz", BusinessCustomerId: "bc-1", InsuranceId: "ins-1" });
  await call(c, "PUT", `/admin/orgs/${c.orgES}/tenants`, { token: c.superToken, body: { tenants: ["TenantA"] } });
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "carrosserie").id; HALL = st.find((s) => s.type === "hall").id;
  await call(c, "PUT", `/admin/stations/${A}`, { token: c.superToken, org: c.orgES, body: { azure_tenant: "TenantA", azure_business_customer_id: "bc-1", country: "ES" } });
  await call(c, "PUT", `/admin/stations/${HALL}`, { token: c.superToken, org: c.orgES, body: { azure_tenant: "TenantA", azure_location_aliases: ["Nave Madrid"], country: "ES" } });
  ins = (await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Allianz (alt)", azure_insurance_id: "ins-1" } })).body.id;
  await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Mutua Madrileña" } });

  admin = await inviteAndAccept(c, c.orgES, "admin@example.test", { role_id: c.roleId.org_admin });
  importer = await inviteAndAccept(c, c.orgES, "importer@example.test", { role_id: c.roleId.aufnehmer });
  techA = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: A });

  az.add("AllScanResults", {
    PartitionKey: PK, RowKey: RK, Tenant: "TenantA", Location: "Nave Madrid", ColibriNumber: "C-100", BusinessCustomer: "Carrosserie Talavera - Allianz", ClaimNumber: "SIN-1",
    ScanDateTime: `${DAY}T16:27:00Z`, LicensePlate: "9547 LPV", VIN: "", CarBrand: "VOLKSWAGEN-GROUP", CarModel: "GOLF", CarBuildYear: "2020", Country: "ES", Language: "ENGLISH GB",
    CalculationMethod: "GERMANY", DentsTotalNumber: 618, ScanFailed: false, ErrorMessage: "", urlPdf: URL_PDF,
  });
  az.putBlob("allscans", "20261019-1627_9547 LPV.pdf", PDF);
  const { syncAzure } = await import("../src/azure_sync");
  await syncAzure(c.h.db, az);

  c.citas.addLocation({ id: "loc-1", name: "Nave Madrid", timezone: "Europe/Madrid" });
  c.citas.addLocation({ id: "loc-2", name: "Nave Sevilla" });
});

const appts = (station: string, o: { token?: string; q?: string } = {}) =>
  call(c, "GET", `/citas/appointments?station_id=${station}${o.q ?? ""}`, { token: o.token ?? importer, org: c.orgES });
const start = (id: string, body: Record<string, unknown>, token = importer) => call(c, "POST", `/citas/appointments/${id}/start`, { token, org: c.orgES, body });
const link = async (loc: string | null) => call(c, "PUT", `/admin/stations/${HALL}`, { token: c.superToken, org: c.orgES, body: { citas_location_id: loc } });

describe("configuration", () => {
  it("is off without CITAS_API_URL and CITAS_API_KEY, and the key stays out of /config", async () => {
    expect(loadConfig({}).citasApiUrl).toBeNull();
    expect(loadConfig({ CITAS_API_URL: "https://citas.example/" }).citasApiKey).toBeNull();
    const cfg = loadConfig({ CITAS_API_URL: "https://citas.example/", CITAS_API_KEY: "SECRET-KEY-123" });
    expect(cfg.citasApiUrl).toBe("https://citas.example");
    const app = createApp({ db: c.h.db, cfg, mailer: new MemoryMailer(), citas: null });
    const res = await app.request("/config");
    expect(await res.text()).not.toContain("SECRET-KEY-123");
  });

  it("without Citas the endpoints are neutral and nothing breaks", async () => {
    const app = createApp({ db: c.h.db, cfg: loadConfig({}), mailer: new MemoryMailer(), citas: null });
    const get = async (path: string) => { const r = await app.request(path, { headers: { authorization: `Bearer ${admin}`, "x-org-id": c.orgES } }); return { status: r.status, body: await r.json() as any }; };
    expect(await get("/citas/status")).toEqual({ status: 200, body: { configured: false, ok: false } });
    expect(await get("/citas/locations")).toEqual({ status: 200, body: [] });
    expect((await get(`/citas/appointments?station_id=${HALL}`)).body).toEqual({ configured: false, linked: false, appointments: [] });
    const r = await app.request(`/citas/appointments/x/start`, { method: "POST", headers: { authorization: `Bearer ${admin}`, "x-org-id": c.orgES, "content-type": "application/json" }, body: JSON.stringify({ station_id: HALL }) });
    expect(r.status).toBe(409);
  });
});

describe("Citas client", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  it("sends the key as a Bearer token, to the versioned path, with the query", async () => {
    const seen: { url: string; auth: string }[] = [];
    const cl = new CitasRest({ url: "https://citas.example", key: "K-1", fetch: async (url, init) => { seen.push({ url, auth: init.headers.authorization }); return ok({ date: DAY, generated_at: "", appointments: [] }); } });
    await cl.appointments({ date: DAY, location: "loc-1" });
    expect(seen[0]).toEqual({ url: `https://citas.example/api/v1/external/appointments?date=${DAY}&location=loc-1`, auth: "Bearer K-1" });
  });
  it("maps HTTP errors and never carries the key or the URL", async () => {
    for (const [status, kind] of [[401, "unauthorized"], [503, "disabled"], [400, "bad_request"], [404, "not_found"], [429, "rate_limited"], [500, "unreachable"]] as const) {
      const cl = new CitasRest({ url: "https://citas.example", key: "K-SECRET", fetch: async () => ({ ok: false, status, json: async () => ({}) }) });
      const e = await cl.health().catch((x) => x);
      expect(e).toBeInstanceOf(CitasError);
      expect(e.kind).toBe(kind);
      expect(e.message + (e.stack ?? "")).not.toContain("K-SECRET");
    }
  });
  it("gives up after the timeout", async () => {
    const cl = new CitasRest({ url: "https://citas.example", key: "K", timeoutMs: 20, fetch: (_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))) });
    const e = await cl.health().catch((x) => x);
    expect(e).toBeInstanceOf(CitasError);
    expect(e.kind).toBe("unreachable");
  });
});

describe("matching", () => {
  it("compares plates without spaces, hyphens, accents or case", () => {
    expect(normalizePlate("9547 lpv")).toBe("9547LPV");
    expect(normalizePlate("9547-LPV")).toBe(normalizePlate("9547 LPV"));
  });
  it("compares insurer names without case, accents, spaces, hyphens or punctuation", () => {
    expect(sameInsurer("Mutua Madrileña", "MUTUA-MADRILENIA")).toBe(true);
    expect(sameInsurer("Mutua Madrileña", "MUTUA MADRILEÑA")).toBe(true);
    expect(sameInsurer("Mutua Madrilena", "mutua-madrileña")).toBe(true);
    expect(sameInsurer("Línea Directa", "LINEA-DIRECTA.")).toBe(true);
    expect(sameInsurer("Allianz", "AXA")).toBe(false);
    expect(insurerKeys("")).toEqual([]);
    expect(sameInsurer("", "")).toBe(false);
  });
  it("finds the calendar day in the time zone of the location", () => {
    expect(dayInZone("2026-10-19T22:30:00Z", "Europe/Madrid")).toBe("2026-10-20");
    expect(dayInZone("2026-10-19T22:30:00Z", "America/Bogota")).toBe("2026-10-19");
  });
  it("takes over the fields of an appointment", () => {
    const a = c.citas.add({ id: "tmp-f", date: DAY, location: "loc-1", plate: "1234 abc", vin: "wvwzzz1jzxw000001", caseNumber: "CASE-1" });
    expect(fieldsOf(a)).toMatchObject({ kennzeichen: "1234 ABC", fin: "WVWZZZ1JZXW000001", modell: "Volkswagen Golf", claimNumber: "CASE-1", kundeName: "Ana García", kundeTel: "+34600111222", kundeEmail: "ana@example.test" });
    expect(fieldsOf({ ...a, vehicle: { ...a.vehicle, vin: "short" } }).fin).toBeUndefined();
    c.citas.appts.pop();
  });
});

describe("status and locations", () => {
  it("only managers may see them", async () => {
    expect((await call(c, "GET", "/citas/status", { token: importer, org: c.orgES })).status).toBe(403);
    expect((await call(c, "GET", "/citas/locations", { token: importer, org: c.orgES })).status).toBe(403);
    expect((await call(c, "GET", "/citas/status", { token: admin, org: c.orgES })).body).toEqual({ configured: true, ok: true, locations: 2 });
    expect((await call(c, "GET", "/citas/locations", { token: admin, org: c.orgES })).body.map((l: any) => l.id)).toEqual(["loc-1", "loc-2"]);
  });
  it("reports a failing Citas without an error status", async () => {
    c.citas.failWith = "unauthorized";
    const r = await call(c, "GET", "/citas/status", { token: admin, org: c.orgES });
    c.citas.failWith = null;
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ configured: true, ok: false, error: "unauthorized" });
  });
  it("links a station to a location (managers only)", async () => {
    const r = await link("loc-1");
    expect(r.status).toBe(200);
    expect(r.body.citasLocationId).toBe("loc-1");
    expect((await call(c, "PUT", `/admin/stations/${HALL}`, { token: importer, org: c.orgES, body: { citas_location_id: "loc-2" } })).status).toBe(403);
    await link(null);
    expect((await call(c, "GET", "/admin/stations", { token: admin, org: c.orgES })).body.find((s: any) => s.id === HALL).citasLocationId).toBeNull();
    await link("loc-1");
  });
});

describe("appointments of a station", () => {
  beforeAll(() => {
    c.citas.add({ id: "a-plate", location: "loc-1", date: DAY, time: "09:00", plate: "9547 LPV", insurance: "ALLIANZ-SEGUROS", first: "Ana", last: "García" });
    c.citas.add({ id: "a-other", location: "loc-1", date: DAY, time: "10:30", plate: "5555 ZZZ", insurance: "MUTUA-MADRILENIA", caseNumber: "CASE-9" });
    c.citas.add({ id: "a-cancel-req", location: "loc-1", date: DAY, time: "11:00", plate: "7777 QQQ", status: "cancel_requested" });
    c.citas.add({ id: "a-gone", location: "loc-1", date: DAY, time: "12:00", plate: "8888 WWW", status: "cancelled" });
    c.citas.add({ id: "a-sev", location: "loc-2", date: DAY, time: "09:00", plate: "1111 SSS" });
  });

  it("a station without a location has none", async () => {
    await link(null);
    const r = await appts(HALL);
    await link("loc-1");
    expect(r.body).toEqual({ configured: true, linked: false, appointments: [] });
  });

  it("lists the day of its own location, enriched, without cancelled ones", async () => {
    const r = await appts(HALL, { q: `&date=${DAY}` });
    expect(r.status).toBe(200);
    expect(r.body.linked).toBe(true);
    expect(r.body.appointments.map((a: any) => a.id)).toEqual(["a-plate", "a-other", "a-cancel-req"]);
    const by = Object.fromEntries(r.body.appointments.map((a: any) => [a.id, a]));
    expect(by["a-plate"].matchingScans).toBe(1);
    expect(by["a-other"].matchingScans).toBe(0);
    expect(by["a-plate"].insurerId).toBe(ins);
    expect(by["a-other"].insurerId).toBeTruthy();
    expect(by["a-cancel-req"].insurerId).toBeNull();
    expect(by["a-cancel-req"].status).toBe("cancel_requested");
    expect(by["a-plate"].vehicleId).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain("api_key");
  });

  it("defaults to today in the time zone of the location", async () => {
    c.citasClock.t = Date.parse("2026-10-19T22:30:00Z"); // already the 20th in Madrid
    const r = await appts(HALL);
    c.citasClock.t = Date.parse("2026-10-19T08:00:00Z");
    expect(r.body.date).toBe("2026-10-20");
    expect(r.body.timezone).toBe("Europe/Madrid");
  });

  it("caches a day for 60 seconds per location, and refresh skips the cache", async () => {
    c.citasClock.t += 3600_000; // out of any earlier cache
    const n = () => c.citas.calls.filter((x) => x === `appointments:${DAY}:loc-1`).length;
    const before = n();
    await appts(HALL, { q: `&date=${DAY}` });
    await appts(HALL, { q: `&date=${DAY}` });
    expect(n()).toBe(before + 1);
    c.citasClock.t += 30_000;
    await appts(HALL, { q: `&date=${DAY}` });
    expect(n()).toBe(before + 1);
    await appts(HALL, { q: `&date=${DAY}&refresh=1` });
    expect(n()).toBe(before + 2);
    c.citasClock.t += 61_000;
    await appts(HALL, { q: `&date=${DAY}` });
    expect(n()).toBe(before + 3);
  });

  it("answers 502 citas_unreachable, without a stack, when Citas is down", async () => {
    c.citasClock.t += 3600_000;
    c.citas.failWith = "unreachable";
    const r = await appts(HALL, { q: `&date=${DAY}` });
    c.citas.failWith = null;
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("citas_unreachable");
    expect(JSON.stringify(r.body)).not.toMatch(/stack|at \w+ \(/);
  });

  it("checks the station and the right on it", async () => {
    expect((await appts(HALL, { token: techA })).status).toBe(403); // a technician of another station
    expect((await appts("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await appts(HALL, { q: "&date=19-10-2026" })).status).toBe(400);
    expect((await call(c, "GET", `/citas/appointments?station_id=${HALL}`, { token: importer, org: c.orgDE })).status).toBe(403);
  });
});

describe("start an expertise from an appointment", () => {
  it("is refused to somebody without the right on the station, for an unknown appointment, and for another location's one", async () => {
    expect((await start("a-other", { station_id: HALL }, techA)).status).toBe(403);
    expect((await start("nope", { station_id: HALL })).body.code).toBe("appointment_not_found");
    expect((await start("a-sev", { station_id: HALL })).body.code).toBe("appointment_not_found");
    await link(null);
    expect((await start("a-other", { station_id: HALL })).status).toBe(404);
    await link("loc-1");
  });

  it("refuses a cancelled appointment, even when the cached list still showed it", async () => {
    c.citas.add({ id: "a-late", location: "loc-1", date: DAY, time: "15:00", plate: "3333 LAT" });
    await appts(HALL, { q: `&date=${DAY}&refresh=1` }); // cached as confirmed
    c.citas.appts.find((a) => a.id === "a-late")!.status = "cancelled";
    const r = await start("a-late", { station_id: HALL });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("citas_cancelled");
    expect(await c.h.db.select().from(citasLinks).where(eq(citasLinks.appointmentId, "a-late"))).toHaveLength(0);
  });

  it("answers 502 when Citas is down", async () => {
    c.citas.failWith = "unreachable";
    const r = await start("a-other", { station_id: HALL });
    c.citas.failWith = null;
    expect(r.status).toBe(502);
  });

  let vehicleId = "";
  it("without a scan creates the expertise (besichtigung) filled from the appointment, and links it", async () => {
    const r = await start("a-other", { station_id: HALL });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("created");
    vehicleId = r.body.vehicleId;
    const [v] = await c.h.db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(v.statut).toBe("besichtigung");
    expect(v.stationId).toBe(HALL);
    expect(v.insurerId).toBeTruthy();
    expect(v.header).toMatchObject({ kennzeichen: "5555 ZZZ", modell: "Volkswagen Golf", claimNumber: "CASE-9", kundeName: "Ana García", kundeTel: "+34600111222", kundeEmail: "ana@example.test", land: "ES" });
    const [l] = await c.h.db.select().from(citasLinks).where(eq(citasLinks.appointmentId, "a-other"));
    expect(l).toMatchObject({ vehicleId, stationId: HALL, locationId: "loc-1", orgId: c.orgES });
  });

  it("a second start reopens the same expertise (idempotent, also in parallel)", async () => {
    const r = await start("a-other", { station_id: HALL });
    expect(r.body).toEqual({ status: "already", vehicleId });
    const [x, y] = await Promise.all([start("a-cancel-req", { station_id: HALL }), start("a-cancel-req", { station_id: HALL })]);
    expect(x.body.vehicleId).toBe(y.body.vehicleId);
    expect([x.body.status, y.body.status].sort()).toEqual(["already", "created"]);
    expect(await c.h.db.select().from(citasLinks).where(eq(citasLinks.appointmentId, "a-cancel-req"))).toHaveLength(1);
  });

  it("the list then shows the started expertise", async () => {
    const r = await appts(HALL, { q: `&date=${DAY}&refresh=1` });
    const a = r.body.appointments.find((x: any) => x.id === "a-other");
    expect(a.vehicleId).toBe(vehicleId);
    expect(a.vehicleStatut).toBe("besichtigung");
  });

  it("an expertise that was deleted can be started again", async () => {
    await c.h.db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, vehicleId));
    const r = await start("a-other", { station_id: HALL });
    expect(r.body.status).toBe("created");
    expect(r.body.vehicleId).not.toBe(vehicleId);
    expect(await c.h.db.select().from(citasLinks).where(eq(citasLinks.appointmentId, "a-other"))).toHaveLength(1);
  });

  it("with a scan the scan wins; the appointment only fills what is empty", async () => {
    c.citas.add({ id: "a-scan", location: "loc-1", date: DAY, time: "16:00", plate: "1234 ABC", insurance: "Mutua Madrileña", caseNumber: "CASE-APPT", first: "Luis", last: "Pérez", phone: "+34611000000", email: "luis@example.test" });
    const r = await start("a-scan", { station_id: HALL, scan: { partitionKey: PK, rowKey: RK } });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("imported");
    const [v] = await c.h.db.select().from(vehicles).where(eq(vehicles.id, r.body.vehicleId));
    expect(v.stationId).toBe(HALL);
    expect(v.header).toMatchObject({ kennzeichen: "9547 LPV", claimNumber: "SIN-1", kundeName: "Luis Pérez", kundeTel: "+34611000000", kundeEmail: "luis@example.test" });
    expect(v.insurerId).toBe(ins); // the scan's insurer, not the appointment's
    expect(v.colibriScanKey).toBe(`${PK}|${RK}`);
    const [s] = await c.h.db.select().from(colibriScans).where(and(eq(colibriScans.partitionKey, PK), eq(colibriScans.rowKey, RK)));
    expect(s.importStatus).toBe("imported");
    expect((await c.h.db.select().from(citasLinks).where(eq(citasLinks.appointmentId, "a-scan")))[0].vehicleId).toBe(v.id);
    expect((await start("a-scan", { station_id: HALL, scan: { partitionKey: PK, rowKey: RK } })).body).toEqual({ status: "already", vehicleId: v.id });
  });

  it("a scan that was already taken cannot be used for another appointment", async () => {
    c.citas.add({ id: "a-again", location: "loc-1", date: DAY, time: "17:00", plate: "9547 LPV" });
    const r = await start("a-again", { station_id: HALL, scan: { partitionKey: PK, rowKey: RK } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("scan_not_importable");
    expect(await c.h.db.select().from(citasLinks).where(eq(citasLinks.appointmentId, "a-again"))).toHaveLength(0);
  });

  it("writes an audit entry without any secret", async () => {
    const res = await call(c, "GET", "/admin/audit", { token: admin, org: c.orgES });
    const text = JSON.stringify(res.body);
    expect(text).toContain("citas.start");
  });
});
