// V5 phase 2: Colibri scanners. The station of a scan is the station its scanner stood in on the day of the scan.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { mapScan, loadMappingContext, syncAzure } from "../src/azure_sync";
import { addDays, assignmentAt, isIsoDate, localDay } from "../src/colibri_rules";
import { assignDevice, unassignDevice } from "../src/colibri_devices";
import { auditLog, colibriDeviceAssignments, colibriDevices, roles, stations, vehicles } from "../src/schema";
import { call, inviteAndAccept, setup, type Ctx } from "./helpers";

const PDF = new Uint8Array(readFileSync(new URL("../../fixtures/real/colibri_en_9547LPV.pdf", import.meta.url)));
let c: Ctx, H1: string, H2: string, H3: string, CARRO: string, OTHER_TENANT_HALL: string;
let admin: string, chef1: string, chef2: string, assessor: string, tech: string, deAdmin: string;
let n = 0;

const scan = (o: Record<string, unknown> = {}) => {
  n++;
  const pk = `2026101${(n % 9) + 1}-${String(1000 + n)}`;
  return { PartitionKey: pk, RowKey: `P${n}`, Tenant: "TenantA", Location: "Somewhere", ColibriNumber: "COLIBRI-001", BusinessCustomer: "Taller V5 - Allianz",
    ScanDateTime: "2026-10-14T10:00:00Z", LicensePlate: `V5-${n}`, VIN: "", CarBrand: "SEAT", CarModel: "LEON", CarBuildYear: "2020", Country: "ES", Language: "ENGLISH GB",
    CalculationMethod: "GERMANY", DentsTotalNumber: 618, ScanFailed: false, ErrorMessage: "", urlPdf: `https://x/allscans/${pk}.pdf`, ...o };
};
const plates = (r: { body: unknown }) => (r.body as { plate: string }[]).map((x) => x.plate).sort();
const scansOf = (token: string, org = c.orgES) => call(c, "GET", "/azure/scans", { token, org });
const dev = (token: string, method: string, path: string, body?: unknown, org = c.orgES) => call(c, method, `/admin/colibri/devices${path}`, { token, org, ...(body ? { body } : {}) });
let devId: Record<string, string> = {};

beforeAll(async () => {
  c = await setup();
  const az = c.az;
  az.add("Tenants", { PartitionKey: "TenantA", RowKey: "TenantA" });
  az.add("Tenants", { PartitionKey: "TenantB", RowKey: "TenantB" });
  az.add("BusinessCustomers", { PartitionKey: "x", RowKey: "bc-1", BusinessCustomer: "Taller V5" });
  az.add("Insurance", { PartitionKey: "x", RowKey: "ins-1", Insurance: "Allianz" });
  az.add("BusinessCustomersInsurance", { PartitionKey: "x", RowKey: "l-1", BusinessCustomerInsurance: "Taller V5 - Allianz", BusinessCustomerId: "bc-1", InsuranceId: "ins-1" });
  await call(c, "PUT", `/admin/orgs/${c.orgES}/tenants`, { token: c.superToken, body: { tenants: ["TenantA"] } });
  await call(c, "PUT", `/admin/orgs/${c.orgDE}/tenants`, { token: c.superToken, body: { tenants: ["TenantB"] } });
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string; name: string }[];
  CARRO = st.find((s) => s.type === "carrosserie")!.id; H1 = st.find((s) => s.name === "Nave Test A")!.id; H2 = st.find((s) => s.name === "Nave PDR Madrid")!.id;
  for (const h of [H1, H2]) await call(c, "PUT", `/admin/stations/${h}`, { token: c.superToken, org: c.orgES, body: { azure_tenant: "TenantA" } });
  H3 = (await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "hall", name: "Nave Tres", azure_tenant: "TenantA" } })).body.id;
  OTHER_TENANT_HALL = (await call(c, "POST", "/admin/stations", { token: c.superToken, org: c.orgES, body: { type: "hall", name: "Nave otro tenant", azure_tenant: "TenantA" } })).body.id;
  await c.h.db.update(stations).set({ azureTenant: "TenantZ" }).where(eq(stations.id, OTHER_TENANT_HALL)); // a station of another Colibri tenant (set directly: TenantZ is not the organisation's)
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { azure_tenant: "TenantA", azure_business_customer_id: "bc-1" } });
  await syncAzure(c.h.db, az); // mirrors the customer / insurer tables
  admin = await inviteAndAccept(c, c.orgES, "admin-sc@example.test", { role_id: c.roleId.org_admin });
  chef1 = await inviteAndAccept(c, c.orgES, "chef1-sc@example.test", { role_id: c.roleId.chef_site, station_id: H1 });
  chef2 = await inviteAndAccept(c, c.orgES, "chef2-sc@example.test", { role_id: c.roleId.chef_site, station_id: H2 });
  assessor = await inviteAndAccept(c, c.orgES, "ass-sc@example.test", { role_id: c.roleId.aufnehmer });
  tech = await inviteAndAccept(c, c.orgES, "tech-sc@example.test", { role_id: c.roleId.technicien, station_id: H1 });
  const rolesDE = (await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgDE })).body as { key: string; id: string }[];
  deAdmin = await inviteAndAccept(c, c.orgDE, "de-sc@example.test", { role_id: rolesDE.find((r) => r.key === "org_admin")!.id });
});
afterAll(async () => { await c.h.close(); });

describe("pure rules", () => {
  it("local day of an instant: the day a scan belongs to", () => {
    expect(localDay(new Date("2026-10-14T22:30:00Z"), "Europe/Madrid")).toBe("2026-10-15"); // 00:30 in Madrid (UTC+2 until 25 Oct)
    expect(localDay(new Date("2026-10-14T21:30:00Z"), "Europe/Madrid")).toBe("2026-10-14");
    expect(localDay(new Date("2026-12-31T23:30:00Z"), "Europe/Berlin")).toBe("2027-01-01");
  });
  it("dates", () => {
    expect(isIsoDate("2026-10-23")).toBe(true); expect(isIsoDate("2026-02-30")).toBe(false); expect(isIsoDate("23.10.2026")).toBe(false);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28"); expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("assignment valid on a day: both ends included, open ones have no end", () => {
    const as = [{ deviceId: "d", stationId: "A", validFrom: "2026-10-01", validTo: "2026-10-15" }, { deviceId: "d", stationId: "B", validFrom: "2026-10-16", validTo: null }];
    expect(assignmentAt(as, "d", "2026-09-30")).toBeUndefined();
    expect(assignmentAt(as, "d", "2026-10-01")?.stationId).toBe("A");
    expect(assignmentAt(as, "d", "2026-10-15")?.stationId).toBe("A");
    expect(assignmentAt(as, "d", "2026-10-16")?.stationId).toBe("B");
    expect(assignmentAt(as, "d", "2030-01-01")?.stationId).toBe("B");
    expect(assignmentAt(as, "other", "2026-10-16")).toBeUndefined();
  });
});

describe("moving a scanner", () => {
  const mk = async (number: string, station?: string, from?: string) => {
    const r = await dev(c.superToken, "POST", "", { tenant: "TenantA", number, ...(station ? { station_id: station, from: from ?? "2026-10-01" } : {}) });
    expect(r.status).toBe(201);
    devId[number] = r.body.id;
    return r.body.id as string;
  };
  const hist = async (id: string) => (await c.h.db.select().from(colibriDeviceAssignments).where(eq(colibriDeviceAssignments.deviceId, id))).sort((a, b) => a.validFrom.localeCompare(b.validFrom));

  it("moving closes the open assignment the day before; the old scans stay with the old station (Toledo until the 15th, Madrid from the 16th)", async () => {
    const id = await mk("COLIBRI-001", H1, "2026-10-01");
    await assignDevice(c.h.db, { orgId: c.orgES, deviceId: id, stationId: H2, from: "2026-10-16", userId: null });
    const h = await hist(id);
    expect(h.map((x) => [x.stationId, x.validFrom, x.validTo])).toEqual([[H1, "2026-10-01", "2026-10-15"], [H2, "2026-10-16", null]]);
  });

  it("assigning the same station again changes nothing", async () => {
    const id = devId["COLIBRI-001"];
    const r = await assignDevice(c.h.db, { orgId: c.orgES, deviceId: id, stationId: H2, from: "2026-10-20", userId: null });
    expect(r.unchanged).toBe(true);
    expect(await hist(id)).toHaveLength(2);
  });

  it("a date in the past is a correction: later assignments are replaced (and listed in the audit), one that covers it is cut the day before", async () => {
    const id = await mk("COLIBRI-002", H1, "2026-10-01");
    await assignDevice(c.h.db, { orgId: c.orgES, deviceId: id, stationId: H2, from: "2026-10-10", userId: null });
    const r = await assignDevice(c.h.db, { orgId: c.orgES, deviceId: id, stationId: H3, from: "2026-10-05", userId: null });
    expect(r.superseded).toHaveLength(1);
    expect((await hist(id)).map((x) => [x.stationId, x.validFrom, x.validTo])).toEqual([[H1, "2026-10-01", "2026-10-04"], [H3, "2026-10-05", null]]);
    const log = (await c.h.db.select().from(auditLog).where(eq(auditLog.entityId, id))).filter((a) => a.action === "colibri.assign");
    expect(log).toHaveLength(3);
    expect(JSON.stringify(log[2].after)).toContain("superseded");
  });

  it("never two open assignments for one scanner (database rule), and a scanner can be released", async () => {
    const id = devId["COLIBRI-001"];
    await expect(c.h.db.insert(colibriDeviceAssignments).values({ deviceId: id, stationId: H1, validFrom: "2027-01-01", validTo: null })).rejects.toThrow();
    expect(await unassignDevice(c.h.db, { orgId: c.orgES, deviceId: id, to: "2026-10-31", userId: null })).toBe(true);
    expect((await hist(id)).at(-1)).toMatchObject({ stationId: H2, validTo: "2026-10-31" });
    expect(await unassignDevice(c.h.db, { orgId: c.orgES, deviceId: id, to: "2026-11-30", userId: null })).toBe(false); // nothing open any more
    await assignDevice(c.h.db, { orgId: c.orgES, deviceId: id, stationId: H2, from: "2026-11-01", userId: null }); // put back for the next tests
  });

  it("only into a PLACE of the organisation with the scanner's tenant", async () => {
    const id = devId["COLIBRI-001"];
    expect((await dev(c.superToken, "POST", `/${id}/assign`, { station_id: CARRO })).body.code).toBe("station_not_a_place");
    expect((await dev(c.superToken, "POST", `/${id}/assign`, { station_id: OTHER_TENANT_HALL })).body.code).toBe("tenant_not_allowed");
    expect((await dev(c.superToken, "POST", `/${id}/assign`, { station_id: H2, from: "2026-13-01" })).status).toBe(400);
  });
});

describe("the station of a scan follows the scanner and the local day", () => {
  it("scans before / on the boundary / after a move go to the right station; a scan with no assignment that day has none", async () => {
    // scanner COLIBRI-001: H1 until 2026-10-15, H2 from 2026-10-16 (see above; released 31/10, back from 01/11)
    const ctx = await loadMappingContext(c.h.db);
    const at = (iso: string, o: Record<string, unknown> = {}) => mapScan({ tenant: "TenantA", businessCustomer: "Taller V5 - Allianz", scanFailed: false, colibriNumber: "COLIBRI-001", scanDateTime: new Date(iso), ...o }, ctx);
    expect(at("2026-10-14T10:00:00Z").stationId).toBe(H1);
    expect(at("2026-10-14T22:30:00Z").stationId).toBe(H1);  // 00:30 on the 15th in Madrid: still the 15th, still H1
    expect(at("2026-10-15T21:59:00Z").stationId).toBe(H1);  // 23:59 on the 15th
    expect(at("2026-10-15T22:00:00Z").stationId).toBe(H2);  // 00:00 on the 16th
    expect(at("2026-10-20T10:00:00Z").stationId).toBe(H2);
    const gap = at("2026-11-10T10:00:00Z");                 // after the release (31/10) and before... back on 01/11, so H2 again
    expect(gap.stationId).toBe(H2);
    expect(at("2026-09-01T10:00:00Z")).toMatchObject({ stationId: null, importable: false });
    expect(at("2026-09-01T10:00:00Z").warnings).toContain("scanner_no_station");
    const unknown = at("2026-10-14T10:00:00Z", { colibriNumber: "COLIBRI-999" });
    expect(unknown.stationId).toBeNull(); expect(unknown.warnings).toContain("scanner_unknown");
    expect(at("2026-10-14T10:00:00Z", { colibriNumber: "" }).warnings).toContain("scanner_unknown");
    // the Location text plays no role any more
    expect(at("2026-10-14T10:00:00Z", { location: "Nave Tres" } as never).stationId).toBe(H1);
    // the customer still comes from the BusinessCustomer link
    expect(at("2026-10-14T10:00:00Z").clientStationId).toBe(CARRO);
  });

  it("the same number in another tenant is another scanner", async () => {
    const ctx = await loadMappingContext(c.h.db);
    const m = mapScan({ tenant: "TenantB", businessCustomer: "", scanFailed: false, colibriNumber: "COLIBRI-001", scanDateTime: new Date("2026-10-14T10:00:00Z") }, ctx);
    expect(m.stationId).toBeNull();
    expect(m.tenantOrgIds).toEqual([c.orgDE]);
  });
});

describe("who sees which scans (server side)", () => {
  beforeAll(async () => {
    const az = c.az;
    // COLIBRI-001 -> H1 until 15/10, H2 afterwards; COLIBRI-002 -> H3 from 05/10 (H1 before); COLIBRI-003 has no station; COLIBRI-004 unknown; TenantB scanner for the other organisation
    await dev(c.superToken, "POST", "", { tenant: "TenantA", number: "COLIBRI-003" });
    az.add("AllScanResults", scan({ ColibriNumber: "COLIBRI-001", ScanDateTime: "2026-10-14T10:00:00Z", LicensePlate: "AT-H1" }));       // H1
    az.add("AllScanResults", scan({ ColibriNumber: "COLIBRI-001", ScanDateTime: "2026-10-20T10:00:00Z", LicensePlate: "AT-H2" }));       // H2
    az.add("AllScanResults", scan({ ColibriNumber: "COLIBRI-002", ScanDateTime: "2026-10-03T10:00:00Z", LicensePlate: "AT-H1B" }));      // H1 (before the correction of 05/10)
    az.add("AllScanResults", scan({ ColibriNumber: "COLIBRI-002", ScanDateTime: "2026-10-08T10:00:00Z", LicensePlate: "AT-H3" }));       // H3
    az.add("AllScanResults", scan({ ColibriNumber: "COLIBRI-003", LicensePlate: "AT-NONE" }));                                        // registered, no station
    az.add("AllScanResults", scan({ ColibriNumber: "COLIBRI-004", LicensePlate: "AT-UNKNOWN" }));                                     // not registered
    az.add("AllScanResults", scan({ ColibriNumber: "COLIBRI-001", ScanDateTime: "2026-09-01T10:00:00Z", LicensePlate: "AT-EARLY" }));    // before any assignment
    az.add("AllScanResults", scan({ ColibriNumber: "COLIBRI-001", Tenant: "TenantB", LicensePlate: "DE-1" }));
    await syncAzure(c.h.db, az);
  });

  it("a station manager sees only the scans of his station's scanners", async () => {
    expect(plates(await scansOf(chef1))).toEqual(["AT-H1", "AT-H1B"]);
    expect(plates(await scansOf(chef2))).toEqual(["AT-H2"]);
  });

  it("an org-wide assessor sees every station of the organisation, never the scans without a station", async () => {
    expect(plates(await scansOf(assessor))).toEqual(["AT-H1", "AT-H1B", "AT-H2", "AT-H3"]);
  });

  it("administrators see every station and the scans without station (flagged), and only they", async () => {
    for (const t of [admin, c.superToken]) {
      const r = await scansOf(t);
      expect(plates(r)).toEqual(["AT-EARLY", "AT-H1", "AT-H1B", "AT-H2", "AT-H3", "AT-NONE", "AT-UNKNOWN"]);
      const none = (r.body as { plate: string; withoutStation: boolean; importable: boolean; warnings: string[] }[]).find((x) => x.plate === "AT-NONE")!;
      expect(none).toMatchObject({ withoutStation: true, importable: true });
      expect(none.warnings).toContain("scanner_no_station");
      expect((r.body as { plate: string; warnings: string[] }[]).find((x) => x.plate === "AT-UNKNOWN")!.warnings).toContain("scanner_unknown");
    }
    expect(plates(await scansOf(tech))).toEqual([]); // no colibri.importer
  });

  it("the other organisation never sees these scans (tenant isolation), nor the number in its scanner list", async () => {
    expect(plates(await scansOf(deAdmin, c.orgDE))).toEqual(["DE-1"]);
    const r = await dev(deAdmin, "GET", "", undefined, c.orgDE);
    expect(r.status).toBe(200);
    expect(r.body.seen.map((s: { tenant: string; number: string }) => `${s.tenant}|${s.number}`)).toEqual(["TenantB|COLIBRI-001"]);
    expect(r.body.devices).toEqual([]);
  });

  it("importing: a scan without station is for administrators who pick the station; the scanner stays without one", async () => {
    c.az.putBlob("allscans", "p.pdf", PDF);
    const pk = (plate: string) => { const s = c.az.tables.AllScanResults.find((r) => r.LicensePlate === plate)!; return { partitionKey: s.PartitionKey, rowKey: s.RowKey }; };
    for (const r of c.az.tables.AllScanResults) r.urlPdf = "https://x/allscans/p.pdf";
    await c.h.db.execute(sql`update colibri_scans set url_pdf = 'https://x/allscans/p.pdf'`);
    const imp = (t: string, plate: string, station_id?: string, org = c.orgES) => call(c, "POST", "/azure/scans/import", { token: t, org, body: { keys: [pk(plate)], ...(station_id ? { station_id } : {}) } });
    // a station manager: not the scan of another station, and a scan without station does not exist for him
    expect((await imp(chef1, "AT-H2")).body.results[0].status).toBe("not_allowed");
    expect((await imp(chef1, "AT-NONE", H1)).body.results[0].status).toBe("not_found");
    expect((await imp(chef1, "AT-NONE")).body.results[0].status).toBe("not_found");
    // the scan of his own station imports into it
    const mine = (await imp(chef1, "AT-H1")).body.results[0];
    expect(mine.status).toBe("imported");
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, mine.vehicleId)))[0]).toMatchObject({ stationId: H1, clientStationId: CARRO });
    // the administrator starts the scan without station here (a place), never in a body shop
    expect((await imp(admin, "AT-NONE", CARRO)).body.results[0].status).toBe("unmapped");
    const here = (await imp(admin, "AT-NONE", H3)).body.results[0];
    expect(here.status).toBe("imported");
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, here.vehicleId)))[0].stationId).toBe(H3);
    const list = await dev(admin, "GET", "");
    expect(list.body.devices.find((d: { number: string }) => d.number === "COLIBRI-003").station).toBeNull(); // still without station
    // an administrator may also load a scan into another station
    expect((await imp(admin, "AT-H2", H3)).body.results[0].status).toBe("imported");
    // the other organisation cannot reach the scan at all
    expect((await imp(deAdmin, "AT-H1", undefined, c.orgDE)).body.results[0].status).toBe("not_found");
  });
});

describe("scan search (S09): all scans the user may see, from 2 characters", () => {
  const find = (token: string, q: string, org = c.orgES) => call(c, "GET", `/azure/scans?q=${encodeURIComponent(q)}`, { token, org });
  beforeAll(async () => {
    // two more scanners (H2 "Nave PDR Madrid", H3 "Nave Tres") and a scan each; the earlier tests imported some of the AT-* scans
    await dev(c.superToken, "POST", "", { tenant: "TenantA", number: "COLIBRI-050", station_id: H2, from: "2026-01-01" });
    await dev(c.superToken, "POST", "", { tenant: "TenantA", number: "COLIBRI-051", station_id: H3, from: "2026-01-01" });
    c.az.add("AllScanResults", scan({ ColibriNumber: "COLIBRI-050", LicensePlate: "SX-AB 123", CarBrand: "SEAT", CarModel: "IBIZA", ScanDateTime: "2026-10-20T10:00:00Z" }));
    c.az.add("AllScanResults", scan({ ColibriNumber: "COLIBRI-051", LicensePlate: "SX-CD 456", CarBrand: "RENAULT", CarModel: "CLIO", BusinessCustomer: "Otro Cliente - Mapfre", ScanDateTime: "2026-10-21T10:00:00Z" }));
    await syncAzure(c.h.db, c.az);
  });

  it("plate (case, spaces, hyphens ignored), Colibri number, station, accents, make / model, customer; several words must all match", async () => {
    for (const q of ["sx-ab 123", "SX AB 123", "sxab123", "ibiza"]) expect(plates(await find(admin, q)), q).toEqual(["SX-AB 123"]);
    expect(plates(await find(admin, "colibri 051"))).toEqual(["SX-CD 456"]);           // by scanner number
    expect(plates(await find(admin, "nave tres"))).toEqual(["AT-H3", "SX-CD 456"]);    // by station
    expect(plates(await find(admin, "MÁDRID"))).toEqual(["SX-AB 123"]);                 // accents and case: "Nave PDR Madrid"
    expect(plates(await find(admin, "renault clio sx"))).toEqual(["SX-CD 456"]);        // every word must match
    expect(plates(await find(admin, "otro cliente"))).toEqual(["SX-CD 456"]);           // BusinessCustomer
    expect(plates(await find(admin, "seat clio"))).toEqual([]);
    expect(plates(await find(admin, "zzzz"))).toEqual([]);
  });

  it("below 2 characters it is no search at all", async () => {
    const all = (await scansOf(admin)).body.length;
    expect((await find(admin, "a")).body).toHaveLength(all);
    expect((await find(admin, " ")).body).toHaveLength(all);
  });

  it("it never widens what a user may see (station manager, org-wide assessor, technician)", async () => {
    expect(plates(await find(chef1, "SX"))).toEqual([]);                  // his station H1 has none of them
    expect(plates(await find(chef2, "SX"))).toEqual(["SX-AB 123"]);       // H2
    expect(plates(await find(assessor, "SX"))).toEqual(["SX-AB 123", "SX-CD 456"]);
    expect(plates(await find(assessor, "AT-UNKNOWN"))).toEqual([]);       // no station: administrators only
    expect(plates(await find(admin, "AT-UNKNOWN"))).toEqual(["AT-UNKNOWN"]);
    expect(plates(await find(tech, "SX"))).toEqual([]);                   // no colibri.importer
  });

  it("the other organisation finds only its own tenant's scans, and nobody finds theirs", async () => {
    expect(plates(await find(deAdmin, "SX", c.orgDE))).toEqual([]);
    expect(plates(await find(deAdmin, "DE-1", c.orgDE))).toEqual(["DE-1"]);
    expect(plates(await find(admin, "DE-1"))).toEqual([]);
  });
});

describe("Administration → Colibri scanners (S40)", () => {
  it("rights: assessor and technician cannot open it; an administrator and a station manager can", async () => {
    expect((await dev(assessor, "GET", "")).status).toBe(403);
    expect((await dev(tech, "GET", "")).status).toBe(403);
    expect((await dev(admin, "GET", "")).status).toBe(200);
    expect((await dev(chef1, "GET", "")).status).toBe(200);
  });

  it("the page lists scanners with station now, since when, scans and the waiting scans without station", async () => {
    const r = (await dev(admin, "GET", "")).body;
    const d1 = r.devices.find((d: { number: string }) => d.number === "COLIBRI-001");
    expect(d1.station).toMatchObject({ id: H2, name: "Nave PDR Madrid" });
    expect(d1.history.length).toBeGreaterThanOrEqual(2);
    expect(d1.history[0]).toMatchObject({ station: "Nave PDR Madrid" }); // newest first
    expect(r.devices.find((d: { number: string }) => d.number === "COLIBRI-003")).toMatchObject({ station: null, scans: 1 });
    expect(r.canAdd).toBe(true); expect(r.canDelete).toBe(true);
  });

  it("quick start: numbers seen in scans that are not scanners yet, with one-click add; tenants limited to the organisation", async () => {
    const seen = (await dev(admin, "GET", "")).body.seen as { tenant: string; number: string; scans: number }[];
    expect(seen.map((s) => s.number)).toContain("COLIBRI-004");
    expect(seen.every((s) => s.tenant === "TenantA")).toBe(true);
    expect((await dev(admin, "POST", "", { tenant: "TenantA", number: "COLIBRI-004" })).status).toBe(201);
    expect((await dev(admin, "POST", "", { tenant: "TenantA", number: "COLIBRI-004" })).body.code).toBe("device_exists");
    expect(((await dev(admin, "GET", "")).body.seen as { number: string }[]).map((s) => s.number)).not.toContain("COLIBRI-004");
    expect((await dev(admin, "POST", "", { tenant: "TenantB", number: "COLIBRI-777" })).body.code).toBe("tenant_not_allowed");
  });

  it("a station manager sees the scanners of his station and the free ones, can assign only to his own station, cannot add or delete", async () => {
    const mine = (await dev(chef1, "GET", "")).body;
    const nums = (mine.devices as { number: string; station: { id: string } | null }[]).map((d) => `${d.number}:${d.station?.id ?? "free"}`);
    expect(nums).toContain("COLIBRI-003:free");
    expect(nums.some((x) => x.endsWith(`:${H2}`))).toBe(false); // COLIBRI-001 stands in H2 now
    expect(mine.canAdd).toBe(false); expect(mine.canDelete).toBe(false); expect(mine.seen).toEqual([]);
    expect((mine.stations as { id: string }[]).map((s) => s.id)).toEqual([H1]);
    expect((await dev(chef1, "POST", "", { tenant: "TenantA", number: "COLIBRI-555" })).status).toBe(403);
    const free = (await c.h.db.select().from(colibriDevices).where(eq(colibriDevices.number, "COLIBRI-003")))[0].id;
    expect((await dev(chef1, "DELETE", `/${free}`)).status).toBe(403);
    expect((await dev(chef1, "POST", `/${free}/assign`, { station_id: H2, from: "2026-10-01" })).status).toBe(403); // not his station
    expect((await dev(chef1, "POST", `/${free}/assign`, { station_id: H1, from: "2026-10-01" })).status).toBe(200);
    // his scanner can no longer be taken by the manager of another station, nor moved by him into a foreign station
    expect((await dev(chef2, "POST", `/${free}/assign`, { station_id: H2 })).status).toBe(403);
    expect((await dev(chef1, "POST", `/${free}/assign`, { station_id: H2 })).status).toBe(403);
    expect((await dev(chef2, "POST", `/${free}/unassign`, {})).status).toBe(403);
    expect((await dev(chef1, "POST", `/${free}/unassign`, { to: "2026-10-31" })).status).toBe(200);
    // the scanner of another station is invisible to him and untouchable
    const other = devId["COLIBRI-001"];
    expect((await dev(chef1, "POST", `/${other}/assign`, { station_id: H1 })).status).toBe(403);
    expect((await dev(chef1, "POST", `/${other}/unassign`, {})).status).toBe(403);
  });

  it("an administrator can do everything; a scanner of another organisation does not exist for the caller", async () => {
    const id = devId["COLIBRI-002"];
    expect((await dev(admin, "PUT", `/${id}`, { note: "Toledo box" })).body.note).toBe("Toledo box");
    expect((await dev(deAdmin, "POST", `/${id}/assign`, { station_id: H1 }, c.orgDE)).status).toBe(404);
    expect((await dev(admin, "DELETE", `/${id}`)).status).toBe(200);
    expect(await c.h.db.select().from(colibriDeviceAssignments).where(eq(colibriDeviceAssignments.deviceId, id))).toHaveLength(0);
    expect((await c.h.db.select().from(auditLog).where(eq(auditLog.entityId, id))).some((a) => a.action === "delete")).toBe(true);
  });

  it("the status page lists the scanners without a station instead of unknown locations", async () => {
    const s = (await call(c, "GET", "/admin/azure/status", { token: admin, org: c.orgES })).body;
    expect(s.unmappedLocations).toBeUndefined();
    // COLIBRI-004 is a scanner without station; COLIBRI-001 has a scan from before its first assignment (01/09); COLIBRI-002 was deleted just before, its scans have no scanner any more
    expect(s.scannersWithoutStation.map((x: { number: string }) => x.number).sort()).toEqual(["COLIBRI-001", "COLIBRI-002", "COLIBRI-004"]);
    expect(s.scannersWithoutStation.every((x: { tenant: string; scans: number }) => x.tenant === "TenantA" && x.scans >= 1)).toBe(true);
  });
});

describe("permission colibri.geraete", () => {
  it("is in the default roles Organisation admin and Station manager only; the migration appends it once", async () => {
    const stmt = sql`UPDATE "roles" SET "permissions" = array_append("permissions", 'colibri.geraete')
      WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('colibri.geraete' = ANY("permissions"))`;
    await c.h.db.execute(sql`UPDATE "roles" SET "permissions" = array_remove("permissions", 'colibri.geraete') WHERE "is_system" = true`);
    await c.h.db.execute(stmt); await c.h.db.execute(stmt);
    for (const r of await c.h.db.select().from(roles).where(eq(roles.orgId, c.orgES))) {
      if (!r.isSystem) continue;
      expect(r.permissions.filter((p) => p === "colibri.geraete").length, r.name).toBe(r.key === "org_admin" || r.key === "chef_site" ? 1 : 0);
    }
  });
});
