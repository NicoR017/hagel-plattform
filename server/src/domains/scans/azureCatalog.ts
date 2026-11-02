import type { AzureSource, TableRow } from "./azure";
import { colStr } from "./azure";
import { pdfBlobName, PICTURES_CONTAINER, SCANS_CONTAINER } from "./blobs";
import type {
  CatalogBusinessCustomer,
  CatalogCustomerInsuranceLink,
  CatalogInsurance,
  CatalogScan,
  CatalogTenant,
  ScanCatalog,
} from "./catalog";

const truthy = (v: unknown) => v === true || /^(true|1|yes)$/i.test(String(v ?? ""));

const pruneRaw = (r: TableRow) =>
  Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v !== "string" || v.length < 500));

function scanFromAzureRow(r: TableRow): CatalogScan {
  const dt = colStr(r, "ScanDateTime");
  const dents = colStr(r, "DentsTotalNumber");
  const ts = Date.parse(String(r.Timestamp ?? ""));
  return {
    partitionKey: r.PartitionKey,
    rowKey: r.RowKey,
    tenant: colStr(r, "Tenant"),
    location: colStr(r, "Location"),
    colibriNumber: colStr(r, "ColibriNumber"),
    businessCustomer: colStr(r, "BusinessCustomer"),
    claimNumber: colStr(r, "ClaimNumber"),
    scanDateTime: dt && !Number.isNaN(Date.parse(dt)) ? new Date(dt) : null,
    plate: colStr(r, "LicensePlate"),
    vin: colStr(r, "VIN"),
    brand: colStr(r, "CarBrand"),
    model: colStr(r, "CarModel"),
    buildYear: colStr(r, "CarBuildYear"),
    country: colStr(r, "Country"),
    language: colStr(r, "Language"),
    calculationMethod: colStr(r, "CalculationMethod"),
    dentsTotal: dents !== "" && !Number.isNaN(Number(dents)) ? Math.round(Number(dents)) : null,
    scanFailed: truthy(r.ScanFailed ?? colStr(r, "ScanFailed")),
    errorMessage: colStr(r, "ErrorMessage"),
    urlPdf: colStr(r, "urlPdf", "UrlPdf"),
    timestamp: Number.isNaN(ts) ? null : new Date(ts),
    raw: pruneRaw(r),
  };
}

/** Azure Tables + blobs behind the ScanCatalog port. */
export function azureCatalog(az: AzureSource): ScanCatalog {
  return {
    async *listTenants(): AsyncGenerator<CatalogTenant> {
      for await (const r of az.queryTable("Tenants")) {
        const name = r.RowKey || r.PartitionKey;
        if (name) yield { name };
      }
    },

    async *listBusinessCustomers(): AsyncGenerator<CatalogBusinessCustomer> {
      for await (const r of az.queryTable("BusinessCustomers")) {
        yield {
          id: r.RowKey,
          name: colStr(r, "BusinessCustomer", "Name"),
          partitionKey: r.PartitionKey,
        };
      }
    },

    async *listInsurances(): AsyncGenerator<CatalogInsurance> {
      for await (const r of az.queryTable("Insurance")) {
        yield {
          id: r.RowKey,
          name: colStr(r, "Insurance", "Name"),
          partitionKey: r.PartitionKey,
        };
      }
    },

    async *listCustomerInsuranceLinks(): AsyncGenerator<CatalogCustomerInsuranceLink> {
      for await (const r of az.queryTable("BusinessCustomersInsurance")) {
        yield {
          id: r.RowKey,
          name: colStr(r, "BusinessCustomerInsurance", "Name"),
          businessCustomerId: colStr(r, "BusinessCustomerId"),
          insuranceId: colStr(r, "InsuranceId"),
          partitionKey: r.PartitionKey,
        };
      }
    },

    async *listScansSince(since: Date): AsyncGenerator<CatalogScan> {
      const filter = `Timestamp ge datetime'${since.toISOString()}'`;
      for await (const r of az.queryTable("AllScanResults", { filter })) {
        yield scanFromAzureRow(r);
      }
    },

    async getScanPdf(scan) {
      for (const name of pdfBlobName(scan.urlPdf, scan.partitionKey)) {
        const bytes = await az.getBlob(SCANS_CONTAINER, name);
        if (bytes) return bytes;
      }
      return null;
    },

    async listScanPictureNames(scan, stems) {
      const prefixes = [scan.partitionKey, ...stems.map((s) => s.split("_")[0])];
      const names = new Set<string>();
      for (const prefix of prefixes) {
        for (const n of await az.listBlobs(PICTURES_CONTAINER, prefix)) names.add(n);
      }
      return [...names];
    },

    getScanPicture(name) {
      return az.getBlob(PICTURES_CONTAINER, name);
    },

    expiresAt: az.expiresAt?.bind(az),
  };
}
