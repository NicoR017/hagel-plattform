import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { LocalDb } from "../src/sync/db";
import { SyncEngine, type Http } from "../src/sync/engine";
import { colibriBadge } from "../src/sync/colibriImport";
import { syncAzure } from "../../server/src/azure_sync";
import { call, inviteAndAccept, setup, type Ctx } from "../../server/test/helpers";

const PDF = new Uint8Array(readFileSync(new URL("../../fixtures/real/colibri_en_9547LPV.pdf", import.meta.url)));
let c: Ctx, A: string, CARRO: string, n = 0;
const tokens: Record<string, string> = {};

function phone(token: string) {
  const db = new LocalDb(`p5-${++n}`);
  const http: Http = async (method, path, body, init) => {
    const r = await call(c, method, path, { token, org: init?.org ?? c.orgES, body, raw: undefined });
    return { status: r.status, data: r.body, blob: init?.blob ? new Blob([r.bytes], { type: r.headers.get("content-type") ?? "" }) : undefined };
  };
  return { db, engine: new SyncEngine({ db, http }) };
}

beforeAll(async () => {
  c = await setup();
  const az = c.az;
  az.add("Tenants", { PartitionKey: "TenantA", RowKey: "TenantA" });
  az.add("BusinessCustomers", { PartitionKey: "x", RowKey: "bc-1", BusinessCustomer: "Carrosserie Talavera" });
  az.add("Insurance", { PartitionKey: "x", RowKey: "ins-1", Insurance: "Allianz" });
  az.add("BusinessCustomersInsurance", { PartitionKey: "x", RowKey: "l-1", BusinessCustomerInsurance: "Talavera - Allianz", BusinessCustomerId: "bc-1", InsuranceId: "ins-1" });
  await call(c, "PUT", `/admin/orgs/${c.orgES}/tenants`, { token: c.superToken, body: { tenants: ["TenantA"] } });
  const sts = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  CARRO = sts.find((s) => s.type === "carrosserie").id; // the customer, mapped by its Colibri business customer
  A = sts.find((s) => s.type === "hall" && s.name === "Nave Test A").id; // the place, mapped by the scan's Location alias
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { azure_tenant: "TenantA", azure_business_customer_id: "bc-1", country: "ES" } });
  await call(c, "PUT", `/admin/stations/${A}`, { token: c.superToken, org: c.orgES, body: { azure_tenant: "TenantA", azure_location_aliases: ["Nave Test A"], country: "ES" } });
  az.add("AllScanResults", { PartitionKey: "20261019-1627", RowKey: "9547 LPV", Tenant: "TenantA", Location: "Nave Test A", BusinessCustomer: "Talavera - Allianz", LicensePlate: "9547 LPV", DentsTotalNumber: 618, ScanDateTime: "2026-10-19T16:27:00Z", ScanFailed: false, urlPdf: "allscans/20261019-1627.pdf", ClaimNumber: "X-1" });
  az.putBlob("allscans", "20261019-1627.pdf", PDF);
  const jpg = new Uint8Array(await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#456" } }).jpeg().toBuffer());
  az.putBlob("scan-color-pictures", "20261019-1627_Overview_Pictures_FRONT-0.jpg", jpg);
  az.putBlob("scan-color-pictures", "20261019-1627_Overview_Pictures_BACK-0.jpg", jpg);
  await syncAzure(c.h.db, az);
  tokens.importer = await inviteAndAccept(c, c.orgES, "importer@example.test", { role_id: c.roleId.aufnehmer });
  tokens.viewer = await inviteAndAccept(c, c.orgES, "viewer@example.test", { role_id: c.roleId.chef_site, station_id: A });
});
afterAll(async () => { await c.h.close(); });

describe("scan badge", () => {
  it("OK only when imported = report total = Azure's DentsTotalNumber and nothing unknown", () => {
    const m = (o: Record<string, unknown>) => ({ colibri: { imported: 618, reportTotal: 618, rowSum: 618, unknown: [], ...o } } as never);
    expect(colibriBadge(m({}))).toBe("ok");
    expect(colibriBadge(m({ azureTotal: 618 }))).toBe("ok");
    expect(colibriBadge(m({ azureTotal: 600 }))).toBe("check");
    expect(colibriBadge(m({ reportTotal: 620 }))).toBe("check");
    expect(colibriBadge(m({ unknown: ["x (1)"] }))).toBe("check");
    expect(colibriBadge({ colibri: null } as never)).toBeNull();
  });
});

describe("imported scan reaches the phones", () => {
  it("vehicle, Colibri photos (cached on demand) and the PDF arrive through the normal sync; the checklist of required views is covered by Colibri photos", async () => {
    const r = (await call(c, "POST", "/azure/scans/import", { token: tokens.importer, org: c.orgES, body: { keys: [{ partitionKey: "20261019-1627", rowKey: "9547 LPV" }] } })).body.results[0];
    expect(r).toMatchObject({ status: "imported", photos: 2, check: { ok: true, imported: 618 } });
    const p = phone(tokens.viewer);
    await p.engine.syncNow(c.orgES);
    const v = (await p.db.vehicles.get(r.vehicleId))!;
    expect(v).toMatchObject({ kennzeichen: "9547 LPV", statut: "besichtigung", stationId: A, clientStationId: CARRO, claimNumber: "X-1" });
    expect(colibriBadge(v)).toBe("ok");
    const ph = await p.db.photos.where("vehicleId").equals(r.vehicleId).toArray();
    expect(ph.map((x) => x.label).sort()).toEqual(["Heckansicht", "Vorderansicht"]);
    expect(ph.every((x) => x.source === "colibri" && x.hasFile && x.phase === "besichtigung")).toBe(true);
    const blob = await p.engine.ensurePhotoBlob(ph[0].id);
    expect(blob!.size).toBeGreaterThan(500);
    const scan = await p.engine.ensureScanBlob(r.vehicleId);
    expect(scan!.size).toBe(PDF.length);
  });
});
