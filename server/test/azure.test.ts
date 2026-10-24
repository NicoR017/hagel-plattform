import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { AzureRest, odataString, sasExpiry } from "../src/azure";
import { parsePhotoName, pdfBlobName, photoStems, positionLabel } from "../src/azure_import";
import { mapScan, normalizeName, scanFromRow, syncAzure, type MappingContext } from "../src/azure_sync";
import { campaignStations, campaigns, colibriScans, photos, stationInsurers, stations, vehicles } from "../src/schema";
import { call, inviteAndAccept, pull, setup, uuid, type Ctx } from "./helpers";

const PDF = new Uint8Array(readFileSync(new URL("../../fixtures/real/colibri_en_9547LPV.pdf", import.meta.url)));
const PK = "20261019-1627";
const RK = "9547 LPV";
const URL_PDF = "https://storagecolibri.blob.core.windows.net/allscans/20261019-1627_9547 LPV.pdf";

let c: Ctx, A: string, HALL: string, OTHER: string, DEEA: string, DEHALL: string, ins: string;
let importer: string, chefA: string, tech: string, admin: string, deAdmin: string;

const img = async (w: number, h: number, fmt: "jpeg" | "png") => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: "#4a7" } })[fmt]().toBuffer());
const scanRow = (o: Record<string, unknown> = {}) => ({
  PartitionKey: PK, RowKey: RK, Tenant: "TenantA", Location: "Nave Madrid", ColibriNumber: "C-100", BusinessCustomer: "Carrosserie Talavera - Allianz", ClaimNumber: "SIN-1",
  ScanDateTime: "2026-10-19T16:27:00Z", LicensePlate: "9547 LPV", VIN: "", CarBrand: "VOLKSWAGEN-GROUP", CarModel: "GOLF", CarBuildYear: "2020", Country: "ES", Language: "ENGLISH GB",
  CalculationMethod: "GERMANY", DentsTotalNumber: 618, ScanFailed: false, ErrorMessage: "", urlPdf: URL_PDF, ...o,
});

beforeAll(async () => {
  c = await setup();
  const az = c.az;
  for (const t of ["TenantA", "TenantB"]) az.add("Tenants", { PartitionKey: t, RowKey: t });
  az.add("BusinessCustomers", { PartitionKey: "x", RowKey: "bc-1", BusinessCustomer: "Carrosserie Talavera" });
  az.add("BusinessCustomers", { PartitionKey: "x", RowKey: "bc-2", BusinessCustomer: "Taller Madrid" });
  az.add("Insurance", { PartitionKey: "x", RowKey: "ins-1", Insurance: "Allianz Seguros" });
  az.add("BusinessCustomersInsurance", { PartitionKey: "x", RowKey: "l-1", BusinessCustomerInsurance: "Carrosserie Talavera - Allianz", BusinessCustomerId: "bc-1", InsuranceId: "ins-1" });
  az.add("BusinessCustomersInsurance", { PartitionKey: "x", RowKey: "l-2", BusinessCustomerInsurance: "Taller Madrid - Allianz", BusinessCustomerId: "bc-2", InsuranceId: "ins-1" });

  // our records: org ES owns TenantA; org DE owns TenantB; BOTH have a carrosserie linked to the same BusinessCustomer id
  await call(c, "PUT", `/admin/orgs/${c.orgES}/tenants`, { token: c.superToken, body: { tenants: ["TenantA"] } });
  await call(c, "PUT", `/admin/orgs/${c.orgDE}/tenants`, { token: c.superToken, body: { tenants: ["TenantB"] } });
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "carrosserie").id; HALL = st.find((s) => s.type === "hall" && s.name === "Nave PDR Madrid").id; OTHER = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  await call(c, "PUT", `/admin/bodyshops/${A}`, { token: c.superToken, org: c.orgES, body: { azure_tenant: "TenantA", azure_business_customer_id: "bc-1", commission_pct: 20, country: "ES", report_emails: ["t@x.test"] } });
  await call(c, "PUT", `/admin/stations/${HALL}`, { token: c.superToken, org: c.orgES, body: { azure_tenant: "TenantA", country: "ES" } });
  DEEA = (await call(c, "POST", "/admin/bodyshops", { token: c.superToken, org: c.orgDE, body: { name: "Karosserie DE", azure_tenant: "TenantB", azure_business_customer_id: "bc-1", country: "DE" } })).body.id;
  // V5: the station of a scan = the station of its SCANNER (Colibri number) on the local day of the scan, never the Location text
  DEHALL = (await c.h.db.insert(stations).values({ orgId: c.orgDE, type: "hall", name: "Halle DE", country: "DE", capacite: 5, azureTenant: "TenantB" }).returning())[0].id;
  const dev = (org: string, tenant: string, number: string, station_id?: string) => call(c, "POST", "/admin/colibri/devices", { token: c.superToken, org, body: { tenant, number, note: "test", station_id, from: "2026-01-01" } });
  expect((await dev(c.orgES, "TenantA", "C-100", HALL)).status).toBe(201); // the main scanner stands in the hall
  expect((await dev(c.orgES, "TenantA", "C-200", OTHER)).status).toBe(201); // a second scanner stands in another hall
  expect((await dev(c.orgES, "TenantA", "C-300")).status).toBe(201); // registered, no station
  expect((await dev(c.orgDE, "TenantB", "D-1", DEHALL)).status).toBe(201);
  ins = (await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Allianz (alt)", azure_insurance_id: "ins-1" } })).body.id;
  await call(c, "POST", "/admin/campaigns", { token: c.superToken, org: c.orgES, body: { name: "Camp Oct", country: "ES", start: "2026-01-01", end: "2027-12-31", station_ids: [HALL] } });

  admin = await inviteAndAccept(c, c.orgES, "admin@example.test", { role_id: c.roleId.org_admin });
  importer = await inviteAndAccept(c, c.orgES, "importer@example.test", { role_id: c.roleId.aufnehmer });
  chefA = await inviteAndAccept(c, c.orgES, "chefa@example.test", { role_id: c.roleId.chef_site, station_id: OTHER });
  tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: OTHER });
  const rolesDE = (await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgDE })).body as any[];
  deAdmin = await inviteAndAccept(c, c.orgDE, "deadmin@example.test", { role_id: rolesDE.find((r) => r.key === "org_admin").id });

  az.add("AllScanResults", scanRow());
  az.add("AllScanResults", scanRow({ RowKey: "FAILED 1", PartitionKey: "20261019-1700", ScanFailed: "True", ErrorMessage: "scanner error" }));
  az.add("AllScanResults", scanRow({ RowKey: "OTHER TENANT", PartitionKey: "20261019-1800", Tenant: "TenantB", Location: "", ColibriNumber: "D-1", LicensePlate: "DE-AB 1", DentsTotalNumber: 5 }));
  az.add("AllScanResults", scanRow({ RowKey: "UNKNOWN SHOP", PartitionKey: "20261019-1900", BusinessCustomer: "Unknown Shop - Foo", Location: "Somewhere", ColibriNumber: "C-300", LicensePlate: "UNK 1" }));
  az.add("AllScanResults", scanRow({ RowKey: "SECOND SCANNER", PartitionKey: "20261019-2000", ColibriNumber: "C-200", LicensePlate: "OTH 1" }));
  az.putBlob("allscans", "20261019-1627_9547 LPV.pdf", PDF);
  const big = await img(3000, 2000, "jpeg"), png = await img(800, 600, "png");
  az.putBlob("scan-color-pictures", `${PK}_Overview_Pictures_FRONT_UPPER_RIGHT-0.jpg`, big);
  az.putBlob("scan-color-pictures", `${PK}_Overview_Pictures_FRONT_UPPER_RIGHT-1.jpg`, big);
  az.putBlob("scan-color-pictures", `${PK}_Overview_Pictures_BACK_BOTTOM_LEFT-0.jpg`, big);
  az.putBlob("scan-color-pictures", `${PK}_Overview_Pictures_7-0.png`, png); // numeric position 7 = LEFT, PNG
  az.putBlob("scan-color-pictures", `${PK}_Overview_Pictures_TOP_FRONT-0`, big); // no extension
  az.putBlob("scan-color-pictures", `${PK}_Overview_Pictures_BROKEN-0.jpg`, new TextEncoder().encode("not an image"));
  az.putBlob("scan-color-pictures", `20261019-9999_Overview_Pictures_FRONT-0.jpg`, big); // another scan's photo
  await syncAzure(c.h.db, az);
});
afterAll(async () => { await c.h.close(); });

describe("REST client (SAS, OData, paging, XML)", () => {
  const mk = (handler: (url: string, init?: any) => any) => new AzureRest({ account: "acct", sas: "?sv=2020&sig=abc", fetch: async (url, init) => handler(url, init) as never });
  const resp = (body: unknown, o: { status?: number; headers?: Record<string, string>; text?: string; bytes?: Uint8Array } = {}) => ({
    ok: (o.status ?? 200) < 400, status: o.status ?? 200, headers: { get: (n: string) => o.headers?.[n] ?? null },
    json: async () => body, text: async () => o.text ?? "", arrayBuffer: async () => (o.bytes ?? new Uint8Array()).buffer,
  });
  it("queries a table with the SAS, the filter, and follows continuation tokens", async () => {
    const urls: string[] = [];
    const az = mk((url) => {
      urls.push(url);
      return url.includes("NextPartitionKey")
        ? resp({ value: [{ PartitionKey: "p", RowKey: "2" }] })
        : resp({ value: [{ PartitionKey: "p", RowKey: "1" }] }, { headers: { "x-ms-continuation-NextPartitionKey": "p", "x-ms-continuation-NextRowKey": "1" } });
    });
    const rows = [];
    for await (const r of az.queryTable("AllScanResults", { filter: `Timestamp ge datetime'2026-10-19T00:00:00.000Z'` })) rows.push(r.RowKey);
    expect(rows).toEqual(["1", "2"]);
    expect(urls[0]).toContain("https://acct.table.core.windows.net/AllScanResults()?");
    expect(urls[0]).toContain("%24filter=Timestamp%20ge%20datetime%272026-10-19T00%3A00%3A00.000Z%27");
    expect(urls[0]).toContain("sv=2020&sig=abc");
    expect(urls[1]).toContain("NextPartitionKey=p");
    expect(urls[1]).toContain("NextRowKey=1");
  });
  it("is read-only: only GET requests are ever issued", async () => {
    const methods: string[] = [];
    const az = new AzureRest({ account: "a", sas: "sig=1", fetch: async (_u, init) => { methods.push((init as any)?.method ?? "GET"); return resp({ value: [] }, { text: "<x/>" }) as never; } });
    for await (const _ of az.queryTable("T")) void _;
    await az.listBlobs("c", "p"); await az.getBlob("c", "n");
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });
  it("missing table / blob = empty / null; other errors throw with the status", async () => {
    const az404 = mk(() => resp({}, { status: 404 }));
    const none = []; for await (const r of az404.queryTable("Nope")) none.push(r);
    expect(none).toEqual([]);
    expect(await az404.getBlob("c", "n")).toBeNull();
    expect(await az404.listBlobs("c", "p")).toEqual([]);
    const az500 = mk(() => resp({}, { status: 500 }));
    await expect((async () => { for await (const _ of az500.queryTable("T")) void _; })()).rejects.toThrow("HTTP 500");
    await expect(az500.getBlob("c", "n")).rejects.toThrow("HTTP 500");
  });
  it("lists blobs with a prefix (XML names decoded, marker paging) and encodes blob paths", async () => {
    const calls: string[] = [];
    const az = mk((url) => {
      calls.push(url);
      return url.includes("marker=M2")
        ? resp({}, { text: "<EnumerationResults><Blobs><Blob><Name>b-2.jpg</Name></Blob></Blobs><NextMarker/></EnumerationResults>" })
        : resp({}, { text: "<EnumerationResults><Blobs><Blob><Name>a &amp; b 1.jpg</Name></Blob></Blobs><NextMarker>M2</NextMarker></EnumerationResults>" });
    });
    expect(await az.listBlobs("scan-color-pictures", "2026 10")).toEqual(["a & b 1.jpg", "b-2.jpg"]);
    expect(calls[0]).toContain("prefix=2026%2010");
    expect(calls[0]).toContain("comp=list");
    const bytes = new Uint8Array([1, 2, 3]);
    let seen = "";
    const az2 = mk((url) => { seen = url; return resp({}, { bytes }); });
    expect([...(await az2.getBlob("allscans", "a b/c#d.pdf"))!]).toEqual([1, 2, 3]);
    expect(seen).toContain("/allscans/a%20b/c%23d.pdf?");
  });
  it("a 403 says why: expired SAS (with its date) or refused token; the expiry is exposed", async () => {
    const denied = (sas: string) => new AzureRest({ account: "acct", sas, fetch: async () => resp({}, { status: 403 }) as never });
    const past = "?sv=2020&se=2020-01-02T03%3A04%3A05Z&sig=abc", future = `?sv=2020&se=${encodeURIComponent(new Date(Date.now() + 86_400_000 * 30).toISOString())}&sig=abc`;
    await expect(denied(past).queryTable("Tenants").next()).rejects.toThrow(/403 \(SAS expired on 2020-01-02T03:04Z/);
    await expect(denied(future).queryTable("Tenants").next()).rejects.toThrow(/403 \(SAS refused/);
    await expect(denied("?sv=2020&sig=abc").listBlobs("c", "p")).rejects.toThrow(/403 \(SAS refused/);
    expect(denied(past).expiresAt()?.toISOString()).toBe("2020-01-02T03:04:05.000Z");
    expect(denied("?sv=2020&sig=abc").expiresAt()).toBeNull();
    expect(sasExpiry("sv=1&se=garbage")).toBeNull();
  });
  it("escapes quotes in OData strings", () => expect(odataString("O'Neil")).toBe("'O''Neil'"));
});

describe("pure helpers", () => {
  it("photo names: enum names, numeric positions, any extension, no extension; other scans and junk are ignored", () => {
    expect(parsePhotoName(PK, `${PK}_Overview_Pictures_FRONT_UPPER_RIGHT-1.jpg`)).toEqual({ position: "FRONT_UPPER_RIGHT", index: 1 });
    expect(parsePhotoName(PK, `${PK}_Overview_Pictures_7-0.png`)).toEqual({ position: "LEFT", index: 0 });
    expect(parsePhotoName(PK, `${PK}_Overview_Pictures_0-3`)).toEqual({ position: "FRONT_UPPER_RIGHT", index: 3 });
    expect(parsePhotoName(PK, `${PK}_Overview_Pictures_EXTRA_LEFT-0.jpeg`)).toEqual({ position: "EXTRA_LEFT", index: 0 });
    // current Colibri naming (seen on storagecolibri): mixed case, number after an underscore or none
    const K = "2026101518033949BRJ";
    expect(parsePhotoName(K, `${K}_Overview_Pictures_Back_Upper_Left.jpg`)).toEqual({ position: "BACK_UPPER_LEFT", index: 0 });
    expect(parsePhotoName(K, `${K}_Overview_Pictures_Left_3.jpg`)).toEqual({ position: "LEFT", index: 3 });
    expect(parsePhotoName(K, `${K}_Overview_Pictures_Extra_Left_6.jpg`)).toEqual({ position: "EXTRA_LEFT", index: 6 });
    expect(parsePhotoName(K, `${K}_Overview_Pictures_Top_Front.jpg`)).toEqual({ position: "TOP_FRONT", index: 0 });
    // real-world naming: PartitionKey 202610191627, files named after the PDF `20261019-1627_9547 LPV.pdf`
    const stems = photoStems("https://storagecolibri.blob.core.windows.net/allscans/20261019-1627_9547%20LPV.pdf", "202610191627");
    expect(stems).toEqual(["20261019-1627_9547 LPV", "202610191627", "20261019-1627"]);
    expect(parsePhotoName("202610191627", "20261019-1627_9547 LPV_Overview_Pictures_FRONT-0.jpg", stems)).toEqual({ position: "FRONT", index: 0 });
    expect(parsePhotoName("202610191627", "20261019-1627_Overview_Pictures_BACK-1.jpg", stems)).toEqual({ position: "BACK", index: 1 });
    expect(parsePhotoName("202610191627", "20261019-1700_Overview_Pictures_BACK-1.jpg", stems)).toBeNull();
    expect(parsePhotoName(PK, `20261019-9999_Overview_Pictures_FRONT-0.jpg`)).toBeNull();
    expect(parsePhotoName(PK, `${PK}_Other_FRONT-0.jpg`)).toBeNull();
    expect(parsePhotoName("a.b", "aXb_Overview_Pictures_FRONT-0")).toBeNull(); // the key is matched literally, not as a regex
  });
  it("labels", () => {
    const l = (p: string) => positionLabel(p);
    expect([l("FRONT"), l("FRONT_UPPER_RIGHT"), l("BACK_UPPER_LEFT"), l("LEFT"), l("EXTRA_LEFT"), l("RIGHT"), l("EXTRA_RIGHT"), l("TOP_BACK"), l("WHATEVER")])
      .toEqual(["Vorderansicht", "Vorderansicht", "Heckansicht", "Seite links", "Seite links", "Seite rechts", "Seite rechts", "Dach", "Sonstiges"]);
  });
  it("report blob name from the url column (full URL, container path, bare name, fallback)", () => {
    expect(pdfBlobName(URL_PDF, PK)[0]).toBe("20261019-1627_9547 LPV.pdf");
    expect(pdfBlobName("https://x.blob.core.windows.net/allscans/a%20b.pdf", PK)[0]).toBe("a b.pdf");
    expect(pdfBlobName("allscans/x.pdf", PK)[0]).toBe("x.pdf");
    expect(pdfBlobName("", PK)).toEqual([`${PK}.pdf`]);
  });
  it("names are compared normalised (case, spaces, unicode form)", () => {
    expect(normalizeName("  Carrosserie   TALAVERA - Allianz ")).toBe("carrosserie talavera - allianz");
    expect(normalizeName("Café")).toBe(normalizeName("Café"));
  });
  it("scan rows are read case-insensitively; failed flag from 'True'", () => {
    const s = scanFromRow({ PartitionKey: "p", RowKey: "r", tenant: "T", licenseplate: "X 1", ScanFailed: "True", DentsTotalNumber: "12" } as never);
    expect(s).toMatchObject({ tenant: "T", plate: "X 1", scanFailed: true, dentsTotal: 12 });
  });
});

describe("sync (mirrors, incremental, reconcile)", () => {
  it("copies the small tables and the scans; failed scans are stored but flagged", async () => {
    const scans = await c.h.db.select().from(colibriScans);
    expect(scans.length).toBe(5);
    expect(scans.find((s) => s.rowKey === "FAILED 1")).toMatchObject({ scanFailed: true, errorMessage: "scanner error" });
    expect(scans.find((s) => s.rowKey === RK)).toMatchObject({ tenant: "TenantA", dentsTotal: 618, plate: "9547 LPV", importStatus: "new", claimNumber: "SIN-1" });
  });
  it("Azure is master for names and links: linked records take the Azure name; station_insurers follows the link table with its history", async () => {
    expect((await c.h.db.select().from(stations).where(eq(stations.id, A)))[0].name).toBe("Carrosserie Talavera");
    const [i] = (await call(c, "GET", "/admin/insurers", { token: c.superToken, org: c.orgES })).body.filter((x: any) => x.id === ins);
    expect(i.name).toBe("Allianz Seguros");
    const links = await c.h.db.select().from(stationInsurers).where(eq(stationInsurers.stationId, A));
    expect(links.length).toBe(1);
    expect(links[0]).toMatchObject({ insurerId: ins, azureLinkId: "l-1", azureLinkNames: ["Carrosserie Talavera - Allianz"] });
  });
  it("is idempotent and incremental: a second run sees nothing new, a changed row is updated, our import state is never reset", async () => {
    const before = (await c.h.db.select().from(colibriScans)).length;
    const s1 = await syncAzure(c.h.db, c.az);
    expect(s1.scansNew).toBe(0);
    expect((await c.h.db.select().from(colibriScans)).length).toBe(before);
    c.az.calls.length = 0;
    await syncAzure(c.h.db, c.az);
    expect(c.az.calls.find((x) => x.startsWith("table:AllScanResults"))).toMatch(/Timestamp ge datetime'/); // incremental filter
    c.az.add("AllScanResults", scanRow({ PartitionKey: "20261020-0900", RowKey: "NEW 1", LicensePlate: "NEW 1" }));
    expect((await syncAzure(c.h.db, c.az)).scansNew).toBe(1);
    await c.h.db.update(colibriScans).set({ importStatus: "ignored" }).where(eq(colibriScans.rowKey, "NEW 1"));
    c.az.add("AllScanResults", scanRow({ PartitionKey: "20261020-0900", RowKey: "NEW 1", LicensePlate: "NEW 1b" }));
    await syncAzure(c.h.db, c.az);
    expect((await c.h.db.select().from(colibriScans).where(eq(colibriScans.rowKey, "NEW 1")))[0]).toMatchObject({ plate: "NEW 1b", importStatus: "ignored" });
    await c.h.db.delete(colibriScans).where(eq(colibriScans.rowKey, "NEW 1"));
    c.az.tables.AllScanResults = c.az.tables.AllScanResults.filter((r) => r.RowKey !== "NEW 1"); // keep the fake in step
  });
  it("a failing table records a failed run and throws; the next run recovers", async () => {
    c.az.failTable = "AllScanResults";
    await expect(syncAzure(c.h.db, c.az)).rejects.toThrow("HTTP 500");
    const status = (await call(c, "GET", "/admin/azure/status", { token: admin, org: c.orgES })).body;
    expect(status.lastRuns[0]).toMatchObject({ ok: false });
    expect(status.lastRuns[0].error).toContain("HTTP 500");
    c.az.failTable = null;
    await syncAzure(c.h.db, c.az);
    expect((await call(c, "GET", "/admin/azure/status", { token: admin, org: c.orgES })).body.lastRuns[0].ok).toBe(true);
  });
});

describe("mapping rules (tenant isolation is a hard rule)", () => {
  let ctx: MappingContext;
  beforeAll(async () => {
    const { loadMappingContext } = await import("../src/azure_sync");
    ctx = await loadMappingContext(c.h.db);
  });
  const row = (o: Record<string, unknown> = {}) => ({ tenant: "TenantA", location: "Nave Madrid", colibriNumber: "C-100", scanDateTime: new Date("2026-10-19T16:27:00Z"), businessCustomer: "Carrosserie Talavera - Allianz", scanFailed: false, ...o }) as never;
  it("customer by link name -> BusinessCustomerId -> carrosserie of the SAME tenant; station by scanner and day; insurer by InsuranceId", () => {
    const m = mapScan(row(), ctx);
    expect(m).toMatchObject({ orgId: c.orgES, clientStationId: A, stationId: HALL, insurerId: ins, importable: true, warnings: [] });
  });
  it("the Location text no longer decides the station: another or empty Location with the same scanner gives the same station", () => {
    expect(mapScan(row({ location: "" }), ctx)).toMatchObject({ stationId: HALL, clientStationId: A });
    expect(mapScan(row({ location: "Somewhere else" }), ctx)).toMatchObject({ stationId: HALL, clientStationId: A });
    // and the Location text alone never gives a station (its old alias "Nave Madrid" is gone anyway)
    expect(mapScan(row({ colibriNumber: "C-999" }), ctx)).toMatchObject({ stationId: null });
  });
  it("scanner_unknown: no device registered for tenant+number (or no number at all); the customer link still maps", () => {
    const m = mapScan(row({ colibriNumber: "C-999" }), ctx);
    expect(m).toMatchObject({ orgId: null, stationId: null, clientStationId: A, importable: false });
    expect(m.warnings).toContain("scanner_unknown");
    expect(mapScan(row({ colibriNumber: "" }), ctx).warnings).toContain("scanner_unknown");
  });
  it("scanner_no_station: device registered but no assignment on the LOCAL day of the scan (Europe/Madrid for ES)", () => {
    const noStation = mapScan(row({ colibriNumber: "C-300" }), ctx);
    expect(noStation).toMatchObject({ stationId: null, importable: false });
    expect(noStation.warnings).toContain("scanner_no_station");
    expect(noStation.warnings).not.toContain("scanner_unknown");
    // assignment valid from 2026-01-01: 2025-12-31T23:30Z is already 2026-01-01 in Madrid (inside), 22:30Z is still 31 December (outside)
    expect(mapScan(row({ scanDateTime: new Date("2025-12-31T23:30:00Z") }), ctx)).toMatchObject({ stationId: HALL, warnings: [] });
    const before = mapScan(row({ scanDateTime: new Date("2025-12-31T22:30:00Z") }), ctx);
    expect(before.stationId).toBeNull();
    expect(before.warnings).toContain("scanner_no_station");
    expect(mapScan(row({ scanDateTime: null }), ctx).stationId).toBeNull();
  });
  it("two scanners, two halls: the scanner decides", () => {
    expect(mapScan(row({ colibriNumber: "C-200" }), ctx)).toMatchObject({ stationId: OTHER, orgId: c.orgES, clientStationId: A });
  });
  it("name normalisation: case and spaces do not matter", () => {
    expect(mapScan(row({ businessCustomer: "  CARROSSERIE talavera  -  allianz" }), ctx).clientStationId).toBe(A);
  });
  it("the same names in ANOTHER tenant never map to this tenant's sites (and vice versa)", () => {
    const b = mapScan(row({ tenant: "TenantB", colibriNumber: "D-1" }), ctx);
    expect(b.orgId).toBe(c.orgDE);
    expect(b.stationId).toBe(DEHALL);
    expect(b.clientStationId).toBe(DEEA);
    const none = mapScan(row({ tenant: "TenantZ" }), ctx);
    expect(none).toMatchObject({ orgId: null, clientStationId: null, importable: false });
    expect(none.warnings).toContain("tenant_mismatch");
    expect(mapScan(row({ tenant: "" }), ctx).importable).toBe(false);
  });
  it("a site takes every link of its customers (several allowed) plus individually ticked links", () => {
    const mod = (patch: Record<string, unknown>) => ({ ...ctx, stations: ctx.stations.map((s) => (s.id === A ? { ...s, ...patch } : s)) });
    expect(mapScan(row(), mod({})).clientStationId).toBe(A); // bc-1 set through the legacy field
    const two = mod({ azureBcIds: ["bc-1", "bc-2"] }); // two customers on ONE site
    expect(mapScan(row(), two).clientStationId).toBe(A);
    expect(mapScan(row({ businessCustomer: "Taller Madrid - Allianz" }), two).clientStationId).toBe(A);
    // no customer taken as a whole, only one link: the other link of the same customer is not taken
    const onlyLink = mod({ azureBcIds: [], azureLinkIds: ["l-2"] });
    expect(mapScan(row({ businessCustomer: "Taller Madrid - Allianz" }), onlyLink).clientStationId).toBe(A);
    const m = mapScan(row(), onlyLink);
    expect(m.clientStationId).toBeNull();
    expect(m.warnings).toContain("tenant_mismatch"); // only the other tenant's site takes it
  });
  it("a scanner of another tenant with the same number is never used", () => {
    const m = mapScan(row({ tenant: "TenantB", colibriNumber: "C-100" }), ctx);
    expect(m.stationId).toBeNull();
    expect(m.warnings).toContain("scanner_unknown");
  });
  it("unknown customer: no_link warning (the station still comes from the scanner); failed scans are not importable", () => {
    expect(mapScan(row({ businessCustomer: "Unknown Shop - Foo" }), ctx)).toMatchObject({ orgId: c.orgES, stationId: HALL, importable: true, warnings: ["no_link"] });
    expect(mapScan(row({ businessCustomer: "Unknown Shop - Foo", colibriNumber: "C-999" }), ctx)).toMatchObject({ orgId: null, importable: false, warnings: ["no_link", "scanner_unknown"] });
    expect(mapScan(row({ scanFailed: true }), ctx)).toMatchObject({ importable: false });
    expect(mapScan(row({ businessCustomer: "Taller Madrid - Allianz" }), ctx).warnings).toContain("no_site"); // link known, no site of ours
  });
});

describe("list of available scans (who sees what)", () => {
  it("an importer sees the scans of the scanners standing in a station where he may import; nobody sees other tenants' scans", async () => {
    const l = (await call(c, "GET", "/azure/scans", { token: importer, org: c.orgES })).body as any[];
    expect(l.map((s) => s.plate).sort()).toEqual(["9547 LPV", "OTH 1"]);
    expect(l.find((s) => s.plate === "9547 LPV")).toMatchObject({ importable: true, withoutStation: false, stationName: "Nave PDR Madrid", clientName: "Carrosserie Talavera", insurerName: "Allianz Seguros", claimNumber: "SIN-1", dentsTotal: 618, warnings: [] });
    expect(l.find((s) => s.plate === "OTH 1")).toMatchObject({ importable: true, stationName: "Nave Test A" }); // the second scanner stands in the other hall
    expect(l.some((s) => s.tenant === "TenantB")).toBe(false);
  });
  it("roles without colibri.importer see nothing; a scanner without station is for administrators only", async () => {
    expect((await call(c, "GET", "/azure/scans", { token: tech, org: c.orgES })).body).toEqual([]);
    const adminList = (await call(c, "GET", "/azure/scans", { token: admin, org: c.orgES })).body as any[];
    expect(adminList.map((s) => s.plate).sort()).toEqual(["9547 LPV", "OTH 1", "UNK 1"]);
    expect(adminList.find((s) => s.plate === "UNK 1")).toMatchObject({ withoutStation: true, stationId: null, importable: true, warnings: expect.arrayContaining(["no_link", "scanner_no_station"]) });
    expect((await call(c, "GET", "/azure/scans", { token: importer, org: c.orgES })).body.some((s: any) => s.plate === "UNK 1")).toBe(false);
  });
  it("a chef of another hall cannot see the scan of the scanner standing in the hall; he sees the one of his own hall's scanner", async () => {
    const l = (await call(c, "GET", "/azure/scans", { token: chefA, org: c.orgES })).body as any[];
    expect(l.find((s) => s.plate === "9547 LPV")).toBeUndefined();
    expect(l.find((s) => s.plate === "UNK 1")).toBeUndefined();
    expect(l.map((s) => s.plate)).toEqual(["OTH 1"]);
  });
  it("the other organisation sees ITS tenant's scan only", async () => {
    const l = (await call(c, "GET", "/azure/scans", { token: deAdmin, org: c.orgDE })).body as any[];
    expect(l.map((s) => s.plate)).toEqual(["DE-AB 1"]);
    expect(l[0]).toMatchObject({ stationName: "Halle DE", importable: true });
    expect((await call(c, "GET", "/azure/scans", { token: deAdmin, org: c.orgES })).status).toBe(403);
  });
});

describe("import", () => {
  const key = { partitionKey: PK, rowKey: RK };
  const doImport = (token: string, keys = [key], org = c.orgES) => call(c, "POST", "/azure/scans/import", { token, org, body: { keys } });
  let vehicleId = "";

  it("refused for users who may not import / may not create on the target site", async () => {
    expect((await doImport(tech)).body.results[0].status).toBe("not_allowed");
    expect((await doImport(chefA)).body.results[0].status).toBe("not_allowed"); // chef of site A has no right on the hall the scan lands on
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.colibriScanKey, `${PK}|${RK}`))).length).toBe(0);
  });

  it("the importer creates the vehicle: PDF read with the v20 algorithm, site/customer/insurer/claim set, no campaign (v4), status 'besichtigung'", async () => {
    const r = (await doImport(importer)).body.results[0];
    expect(r).toMatchObject({ status: "imported", photos: 5, photoErrors: 1 });
    expect(r.check).toMatchObject({ imported: 618, total: 618, azureTotal: 618, ok: true });
    vehicleId = r.vehicleId;
    const p = await pull(c, importer, c.orgES);
    const v = p.vehicles.find((x: any) => x.id === vehicleId);
    expect(v).toMatchObject({
      kennzeichen: "9547 LPV", land: "ES", statut: "besichtigung", stationId: HALL, clientStationId: A, insurerId: ins, claimNumber: "SIN-1", kunde: "Carrosserie Talavera",
      leistungsdatum: "2026-10-19", werkPct: 20, werkMode: "pct", stundensatz: 69,
    });
    expect(Object.keys(v.panels).length).toBe(12);
    expect(v.panels.dachholm_l.kleber).toBe(true);
    expect(v.colibri).toMatchObject({ imported: 618, reportTotal: 618, azureTotal: 618 });
    expect(v.colibriFile).toMatchObject({ name: `${PK}.pdf` });
    expect(v.campaignId).toBeNull(); // campaigns are no longer written (v4)
    expect(v.companyId).toBeTruthy();
    // like every vehicle it is frozen on a calculation method (the system method of Spain, version 1)
    expect(v.methodId).toBeTruthy();
    expect(v.methodVersion).toBe(1);
    const scan = (await c.h.db.select().from(colibriScans).where(and(eq(colibriScans.partitionKey, PK), eq(colibriScans.rowKey, RK))))[0];
    expect(scan).toMatchObject({ importStatus: "imported", vehicleId });
  });

  it("the PDF is attached and the photos are copied: 1280 px JPEG, phase 'besichtigung', source 'colibri', position/index kept, in_pdf only for the first of each label", async () => {
    const dl = await call(c, "GET", `/files/colibri/${vehicleId}`, { token: importer });
    expect(dl.status).toBe(200);
    expect(dl.bytes.length).toBe(PDF.length);
    const rows = await c.h.db.select().from(photos).where(eq(photos.vehicleId, vehicleId));
    expect(rows.length).toBe(5);
    expect(rows.every((p) => p.source === "colibri" && p.phase === "besichtigung" && !!p.fileKey)).toBe(true);
    const by = (pos: string, i: number) => rows.find((p) => p.colibriPosition === pos && p.colibriIndex === i)!;
    expect(by("FRONT_UPPER_RIGHT", 0)).toMatchObject({ label: "Vorderansicht", inPdf: true });
    expect(by("FRONT_UPPER_RIGHT", 1)).toMatchObject({ label: "Vorderansicht", inPdf: false }); // several photos per angle: only the first goes into the PDF
    expect(by("BACK_BOTTOM_LEFT", 0)).toMatchObject({ label: "Heckansicht", inPdf: true });
    expect(by("LEFT", 0)).toMatchObject({ label: "Seite links", inPdf: true });
    expect(by("TOP_FRONT", 0)).toMatchObject({ label: "Dach", inPdf: true });
    const pull1 = await pull(c, importer, c.orgES);
    expect(pull1.photos.filter((p: any) => p.vehicleId === vehicleId).length).toBe(5);
    const file = await call(c, "GET", `/files/photo/${by("FRONT_UPPER_RIGHT", 0).id}`, { token: importer });
    const meta = await sharp(Buffer.from(file.bytes)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(1280);
    const small = await call(c, "GET", `/files/photo/${by("LEFT", 0).id}`, { token: importer });
    expect((await sharp(Buffer.from(small.bytes)).metadata()).format).toBe("jpeg"); // the PNG was converted
    expect(c.storage.files.size).toBeGreaterThan(5);
  });

  it("a scan is imported ONCE: re-importing (also two at the same time) creates no second vehicle", async () => {
    expect((await doImport(importer)).body.results[0]).toMatchObject({ status: "already", vehicleId });
    const rk2 = "20261021-0800", pk2 = "20261021-0800";
    c.az.add("AllScanResults", scanRow({ PartitionKey: pk2, RowKey: rk2, LicensePlate: "RACE 1", Location: "" }));
    c.az.putBlob("allscans", `${pk2}.pdf`, PDF);
    await syncAzure(c.h.db, c.az);
    const k = { partitionKey: pk2, rowKey: rk2 };
    const both = await Promise.all([doImport(importer, [k]), doImport(importer, [k])]);
    const statuses = both.map((x) => x.body.results[0].status).sort();
    expect(statuses).toEqual(["already", "imported"]);
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.colibriScanKey, `${pk2}|${rk2}`))).length).toBe(1);
  });

  it("not importable: unmapped customer, failed scan, other tenant, unknown key", async () => {
    const unk = { partitionKey: "20261019-1900", rowKey: "UNKNOWN SHOP" };
    expect((await doImport(admin, [unk])).body.results[0].status).toBe("unmapped"); // scanner without station: an admin must pass station_id
    expect((await doImport(importer, [unk])).body.results[0].status).toBe("not_found"); // a non-admin: a scan without station does not exist for him
    expect((await doImport(admin, [{ partitionKey: "20261019-1700", rowKey: "FAILED 1" }])).body.results[0].status).toBe("unmapped");
    expect((await doImport(admin, [{ partitionKey: "20261019-1800", rowKey: "OTHER TENANT" }])).body.results[0].status).toBe("not_found"); // another tenant: it does not exist for this organisation
    expect((await doImport(admin, [{ partitionKey: "nope", rowKey: "nope" }])).body.results[0].status).toBe("not_found");
    // the organisation that owns that tenant imports it (it lands in ITS hall with ITS body shop as customer, never in org ES)
    const de = (await doImport(deAdmin, [{ partitionKey: "20261019-1800", rowKey: "OTHER TENANT" }], c.orgDE)).body.results[0];
    expect(de.status).toBe("imported");
    const [dv] = await c.h.db.select().from(vehicles).where(eq(vehicles.id, de.vehicleId));
    expect(dv).toMatchObject({ orgId: c.orgDE, stationId: DEHALL, clientStationId: DEEA }); // the car stands in the hall of its scanner, the customer is the body shop
  });

  it("missing or unreadable PDF: the scan goes back to 'new' (retry later), nothing is created", async () => {
    c.az.add("AllScanResults", scanRow({ PartitionKey: "20261022-0900", RowKey: "NOPDF", LicensePlate: "NOPDF", Location: "", urlPdf: "" }));
    c.az.add("AllScanResults", scanRow({ PartitionKey: "20261022-1000", RowKey: "BADPDF", LicensePlate: "BADPDF", Location: "", urlPdf: "" }));
    c.az.putBlob("allscans", "20261022-1000.pdf", new TextEncoder().encode("%PDF-1.4 garbage"));
    await syncAzure(c.h.db, c.az);
    expect((await doImport(importer, [{ partitionKey: "20261022-0900", rowKey: "NOPDF" }])).body.results[0].status).toBe("pdf_missing");
    expect((await doImport(importer, [{ partitionKey: "20261022-1000", rowKey: "BADPDF" }])).body.results[0].status).toBe("pdf_unreadable");
    for (const rk of ["NOPDF", "BADPDF"]) expect((await c.h.db.select().from(colibriScans).where(eq(colibriScans.rowKey, rk)))[0].importStatus).toBe("new");
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.colibriScanKey, "20261022-0900|NOPDF"))).length).toBe(0);
    // the PDF appears later: the same scan can now be imported
    c.az.putBlob("allscans", "20261022-0900.pdf", PDF);
    expect((await doImport(importer, [{ partitionKey: "20261022-0900", rowKey: "NOPDF" }])).body.results[0].status).toBe("imported");
  });

  it("a crashed import ('importing' for more than 10 minutes) can be taken over; a fresh one cannot", async () => {
    c.az.add("AllScanResults", scanRow({ PartitionKey: "20261023-0900", RowKey: "STALE", LicensePlate: "STALE", Location: "" }));
    c.az.putBlob("allscans", "20261023-0900.pdf", PDF);
    await syncAzure(c.h.db, c.az);
    const k = { partitionKey: "20261023-0900", rowKey: "STALE" };
    await c.h.db.update(colibriScans).set({ importStatus: "importing", updatedAt: new Date() }).where(eq(colibriScans.rowKey, "STALE"));
    expect((await doImport(importer, [k])).body.results[0].status).toBe("already");
    await c.h.db.update(colibriScans).set({ updatedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(colibriScans.rowKey, "STALE"));
    expect((await doImport(importer, [k])).body.results[0].status).toBe("imported");
  });

  it("a count mismatch with Azure's DentsTotalNumber is flagged in the result (the app shows 'Scan prüfen')", async () => {
    c.az.add("AllScanResults", scanRow({ PartitionKey: "20261024-0900", RowKey: "MISMATCH", LicensePlate: "MISMATCH", Location: "", DentsTotalNumber: 999 }));
    c.az.putBlob("allscans", "20261024-0900.pdf", PDF);
    await syncAzure(c.h.db, c.az);
    const r = (await doImport(importer, [{ partitionKey: "20261024-0900", rowKey: "MISMATCH" }])).body.results[0];
    expect(r.check).toMatchObject({ imported: 618, azureTotal: 999, ok: false });
    const v = (await pull(c, importer, c.orgES)).vehicles.find((x: any) => x.id === r.vehicleId);
    expect(v.colibri).toMatchObject({ imported: 618, azureTotal: 999 });
  });

  it("the list no longer offers imported scans; the import is in the audit log", async () => {
    const l = (await call(c, "GET", "/azure/scans", { token: importer, org: c.orgES })).body as any[];
    expect(l.some((s) => s.plate === "9547 LPV")).toBe(false);
    const log = (await call(c, "GET", "/admin/audit?limit=500", { token: admin, org: c.orgES })).body as any[];
    expect(log.some((e) => e.action === "azure.import" && e.entityId === vehicleId)).toBe(true);
  });

  it("without any Azure configuration the import answers 409 (clear message)", async () => {
    const { createApp } = await import("../src/app");
    const { loadConfig } = await import("../src/config");
    const app = createApp({ db: c.h.db, cfg: loadConfig({}), mailer: c.mailer, storage: c.storage, hub: c.hub });
    const res = await app.request("/azure/scans/import", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${importer}`, "x-org-id": c.orgES, "x-lang": "en" }, body: JSON.stringify({ keys: [{ partitionKey: "a", rowKey: "b" }] }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Azure connection is not configured");
  });
});

describe("administration: status, mapping, pickers", () => {
  it("status page: configured, tenants of the organisation, runs, what is waiting, what needs a mapping", async () => {
    const s = (await call(c, "GET", "/admin/azure/status", { token: admin, org: c.orgES })).body;
    expect(s.configured).toBe(true);
    expect(s.tenants).toEqual(["TenantA"]);
    expect(s.lastRuns.length).toBeGreaterThan(0);
    expect(s.unmappedCustomers).toEqual([{ name: "Unknown Shop - Foo", tenant: "TenantA", scans: 1 }]);
    expect(s.unmappedLocations).toBeUndefined(); // V5: locations are no longer mapped, scanners are
    expect(s.scannersWithoutStation).toEqual([{ tenant: "TenantA", number: "C-300", scans: 1 }]);
    expect(JSON.stringify(s)).not.toContain("TenantB");
    expect((await call(c, "GET", "/admin/azure/status", { token: importer, org: c.orgES })).status).toBe(403);
  });

  it("pickers: business customers / insurances for site-insurer forms; tenants limited to the organisation", async () => {
    expect((await call(c, "GET", "/admin/azure/business-customers", { token: admin, org: c.orgES })).body.map((b: any) => b.name)).toEqual(["Carrosserie Talavera", "Taller Madrid"]);
    expect((await call(c, "GET", "/admin/azure/insurances", { token: admin, org: c.orgES })).body.map((b: any) => b.name)).toEqual(["Allianz Seguros"]);
    expect((await call(c, "GET", "/admin/azure/tenants", { token: admin, org: c.orgES })).body).toEqual(["TenantA"]);
    expect((await call(c, "GET", "/admin/azure/tenants", { token: deAdmin, org: c.orgDE })).body).toEqual(["TenantB"]);
    expect((await call(c, "GET", "/admin/azure/tenants", { token: c.superToken, org: c.orgES })).body).toEqual(["TenantA", "TenantB"]);
    expect((await call(c, "GET", "/admin/azure/tenants", { token: importer, org: c.orgES })).status).toBe(403);
  });

  it("a site can be linked to several customers through the API; the single legacy field still works and mirrors the first", async () => {
    const mk = await call(c, "POST", "/admin/bodyshops", { token: admin, org: c.orgES, body: { name: "Multi", azure_tenant: "TenantA", azure_business_customer_ids: ["bc-1", "bc-2"], azure_link_ids: ["l-9"], country: "ES" } });
    expect(mk.status).toBe(201);
    expect(mk.body).toMatchObject({ azureBcIds: ["bc-1", "bc-2"], azureBusinessCustomerId: "bc-1", azureLinkIds: ["l-9"] });
    const legacy = await call(c, "PUT", `/admin/bodyshops/${mk.body.id}`, { token: admin, org: c.orgES, body: { azure_business_customer_id: "bc-2" } });
    expect(legacy.body).toMatchObject({ azureBcIds: ["bc-2"], azureBusinessCustomerId: "bc-2" });
    const clear = await call(c, "PUT", `/admin/bodyshops/${mk.body.id}`, { token: admin, org: c.orgES, body: { azure_business_customer_ids: [], azure_business_customer_id: null } });
    expect(clear.body).toMatchObject({ azureBcIds: [], azureBusinessCustomerId: null });
    await call(c, "PUT", `/admin/bodyshops/${mk.body.id}`, { token: admin, org: c.orgES, body: { active: false } });
  });

  it("mapping a customer: create a new carrosserie from the Azure name, or link an existing one; tenant must belong to the organisation", async () => {
    const mk = await call(c, "POST", "/admin/azure/map-customer", { token: admin, org: c.orgES, body: { link_name: "taller madrid - allianz", tenant: "TenantA" } });
    expect(mk.status).toBe(201);
    expect(mk.body).toMatchObject({ name: "Taller Madrid", type: "carrosserie", azureTenant: "TenantA", azureBusinessCustomerId: "bc-2" });
    expect((await call(c, "POST", "/admin/azure/map-customer", { token: admin, org: c.orgES, body: { link_name: "Taller Madrid - Allianz", tenant: "TenantB" } })).status).toBe(400); // not this organisation's tenant
    expect((await call(c, "POST", "/admin/azure/map-customer", { token: admin, org: c.orgES, body: { link_name: "Does not exist", tenant: "TenantA" } })).status).toBe(404);
    expect((await call(c, "POST", "/admin/azure/map-customer", { token: importer, org: c.orgES, body: { link_name: "Taller Madrid - Allianz", tenant: "TenantA" } })).status).toBe(403);
    // the insurer is linked automatically (names come from Azure)
    expect((await c.h.db.select().from(stationInsurers).where(eq(stationInsurers.stationId, mk.body.id))).length).toBe(1);
    // now a scan of that customer maps to the new site
    c.az.add("AllScanResults", scanRow({ PartitionKey: "20261025-0900", RowKey: "TM", BusinessCustomer: "Taller Madrid - Allianz", Location: "", LicensePlate: "TM 1" }));
    await syncAzure(c.h.db, c.az);
    const l = (await call(c, "GET", "/azure/scans", { token: admin, org: c.orgES })).body as any[];
    expect(l.find((s) => s.plate === "TM 1")).toMatchObject({ clientName: "Taller Madrid", importable: true });
  });

  it("mapping a location: only to a site of the same tenant and organisation; remembered as an alias", async () => {
    const ok = await call(c, "POST", "/admin/azure/map-location", { token: admin, org: c.orgES, body: { location: "Somewhere", tenant: "TenantA", station_id: HALL } });
    expect(ok.status).toBe(200);
    expect(ok.body.azureLocationAliases).toContain("Somewhere");
    expect((await call(c, "POST", "/admin/azure/map-location", { token: admin, org: c.orgES, body: { location: "X", tenant: "TenantB", station_id: HALL } })).status).toBe(400);
    expect((await call(c, "POST", "/admin/azure/map-location", { token: admin, org: c.orgES, body: { location: "X", tenant: "TenantA", station_id: DEEA } })).status).toBe(404); // other organisation's site
    expect((await call(c, "POST", "/admin/azure/map-location", { token: admin, org: c.orgES, body: { location: "X", tenant: "TenantA", station_id: uuid() } })).status).toBe(404);
  });

  it("manual sync from the admin (rate limited, needs the right)", async () => {
    c.az.add("AllScanResults", scanRow({ PartitionKey: "20261026-0900", RowKey: "MANUAL", LicensePlate: "MANUAL 1" }));
    const r = await call(c, "POST", "/admin/azure/sync", { token: admin, org: c.orgES });
    expect(r.status).toBe(200);
    expect(r.body.scansSeen).toBeGreaterThan(0);
    expect((await call(c, "POST", "/admin/azure/sync", { token: admin, org: c.orgES })).status).toBe(429);
    expect((await call(c, "POST", "/admin/azure/sync", { token: importer, org: c.orgES })).status).toBe(403);
  });

  it("campaigns / sites tables untouched by imports of other organisations (sanity)", async () => {
    expect((await c.h.db.select().from(campaigns)).length).toBe(1);
    expect((await c.h.db.select().from(campaignStations)).length).toBe(1);
  });
});

describe("load a scan into the station the user is in", () => {
  const key = { partitionKey: PK, rowKey: RK };
  let other = "";
  it("a vehicle deleted (wrong station) gives the scan back; it is offered again at the station of its scanner; ?all=1 widens nothing", async () => {
    const scan0 = (await c.h.db.select().from(colibriScans).where(and(eq(colibriScans.partitionKey, PK), eq(colibriScans.rowKey, RK))))[0];
    expect(scan0.importStatus).toBe("imported");
    const vid = scan0.vehicleId!;
    const { push: pushOps, op } = await import("./helpers");
    expect(((await pushOps(c, c.superToken, [op("vehicle.delete", { vehicleId: vid })])).body.results as { status: string }[])[0].status).toBe("ok");
    const after = (await c.h.db.select().from(colibriScans).where(and(eq(colibriScans.partitionKey, PK), eq(colibriScans.rowKey, RK))))[0];
    expect(after).toMatchObject({ importStatus: "new", vehicleId: null });
    [other] = (await c.h.db.insert(stations).values({ orgId: c.orgES, type: "hall", name: "Talauto Test", country: "ES", capacite: 10, azureTenant: scan0.tenant }).returning()).map((s) => s.id);
    const normal = (await call(c, "GET", "/azure/scans", { token: importer, org: c.orgES })).body as { rowKey: string; stationId: string }[];
    expect(normal.find((s) => s.rowKey === RK)?.stationId).toBe(HALL); // the station of its scanner
    const all = (await call(c, "GET", "/azure/scans?all=1", { token: importer, org: c.orgES })).body as { rowKey: string; importable: boolean }[];
    expect(all.find((s) => s.rowKey === RK)?.importable).toBe(true);
    expect(all.map((s) => s.rowKey).sort()).toEqual(normal.map((s) => s.rowKey).sort()); // ?all=1 no longer widens anything
  });

  it("imported with station_id: a non-admin cannot move a scan to another station; an administrator can, the car still belongs to the customer of its BusinessCustomer link", async () => {
    expect((await call(c, "POST", "/azure/scans/import", { token: importer, org: c.orgES, body: { keys: [key], station_id: other } })).body.results[0].status).toBe("not_allowed");
    const r = (await call(c, "POST", "/azure/scans/import", { token: admin, org: c.orgES, body: { keys: [key], station_id: other } })).body.results[0];
    expect(r.status).toBe("imported");
    const v = (await pull(c, admin, c.orgES)).vehicles.find((x: any) => x.id === r.vehicleId);
    expect(v).toMatchObject({ stationId: other, clientStationId: A, kennzeichen: "9547 LPV" });
  });

  it("not into a station of another tenant or organisation, nor a station the user may not import into", async () => {
    const [{ id: dev }] = await c.h.db.insert(stations).values({ orgId: c.orgDE, type: "hall", name: "Halle DE", country: "DE", capacite: 5 }).returning();
    await c.h.db.update(colibriScans).set({ importStatus: "new", vehicleId: null }).where(and(eq(colibriScans.partitionKey, PK), eq(colibriScans.rowKey, RK)));
    const wrongOrg = (await call(c, "POST", "/azure/scans/import", { token: importer, org: c.orgES, body: { keys: [key], station_id: dev } })).body.results[0];
    expect(wrongOrg.status).toBe("unmapped");
    const unknown = (await call(c, "POST", "/azure/scans/import", { token: importer, org: c.orgES, body: { keys: [key], station_id: uuid() } })).body.results[0];
    expect(unknown.status).toBe("unmapped");
    const notAllowed = (await call(c, "POST", "/azure/scans/import", { token: tech, org: c.orgES, body: { keys: [key], station_id: other } })).body.results[0];
    expect(notAllowed.status).toBe("not_allowed");
  });

  it("v4: a scan of a scanner without station is listed for the administrator only and can be loaded by him into a chosen station, without a customer; a non-admin gets not_found", async () => {
    const none = (await call(c, "GET", "/azure/scans?all=1", { token: importer, org: c.orgES })).body as { rowKey: string }[];
    expect(none.find((x) => x.rowKey === "UNKNOWN SHOP")).toBeUndefined();
    expect((await call(c, "POST", "/azure/scans/import", { token: importer, org: c.orgES, body: { keys: [{ partitionKey: "20261019-1900", rowKey: "UNKNOWN SHOP" }], station_id: other } })).body.results[0].status).toBe("not_found");
    const all = (await call(c, "GET", "/azure/scans", { token: admin, org: c.orgES })).body as { rowKey: string; stationId: string | null; importable: boolean; withoutStation: boolean; warnings: string[] }[];
    const unk = all.find((x) => x.rowKey === "UNKNOWN SHOP");
    expect(unk).toMatchObject({ importable: true, withoutStation: true, stationId: null });
    expect(unk!.warnings).toContain("no_link");
    const r = (await call(c, "POST", "/azure/scans/import", { token: admin, org: c.orgES, body: { keys: [{ partitionKey: "20261019-1900", rowKey: "UNKNOWN SHOP" }], station_id: other } })).body.results[0];
    expect(r.status).toBe("imported");
    const v = (await pull(c, admin, c.orgES)).vehicles.find((x: any) => x.id === r.vehicleId);
    expect(v).toMatchObject({ stationId: other, clientStationId: null, statut: "besichtigung" });
    expect(v.campaignId ?? null).toBeNull();
    // a technician (no importer right) still cannot take it
    const nope = (await call(c, "POST", "/azure/scans/import", { token: tech, org: c.orgES, body: { keys: [{ partitionKey: "20261019-1900", rowKey: "UNKNOWN SHOP" }], station_id: other } })).body.results[0];
    expect(["already", "not_allowed"]).toContain(nope.status);
  });
});
