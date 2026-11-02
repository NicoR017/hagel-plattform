/**
 * Domain API for the external hail-scan catalog (today: Azure Tables + blobs).
 * Sync and import talk only to this port — swap the adapter to change the source.
 */

export interface CatalogTenant {
  name: string;
}

export interface CatalogBusinessCustomer {
  id: string;
  name: string;
  partitionKey: string;
}

export interface CatalogInsurance {
  id: string;
  name: string;
  partitionKey: string;
}

export interface CatalogCustomerInsuranceLink {
  id: string;
  name: string;
  businessCustomerId: string;
  insuranceId: string;
  partitionKey: string;
}

/** One external scan, independent of Azure table column names. */
export interface CatalogScan {
  partitionKey: string;
  rowKey: string;
  tenant: string;
  location: string;
  colibriNumber: string;
  businessCustomer: string;
  claimNumber: string;
  scanDateTime: Date | null;
  plate: string;
  vin: string;
  brand: string;
  model: string;
  buildYear: string;
  country: string;
  language: string;
  calculationMethod: string;
  dentsTotal: number | null;
  scanFailed: boolean;
  errorMessage: string;
  urlPdf: string;
  /** Source row timestamp when known (used for incremental sync). */
  timestamp: Date | null;
  raw: Record<string, unknown>;
}

export interface ScanCatalog {
  listTenants(): AsyncGenerator<CatalogTenant>;
  listBusinessCustomers(): AsyncGenerator<CatalogBusinessCustomer>;
  listInsurances(): AsyncGenerator<CatalogInsurance>;
  listCustomerInsuranceLinks(): AsyncGenerator<CatalogCustomerInsuranceLink>;
  /** Scans with timestamp >= since (inclusive). */
  listScansSince(since: Date): AsyncGenerator<CatalogScan>;
  getScanPdf(scan: Pick<CatalogScan, "urlPdf" | "partitionKey">): Promise<Uint8Array | null>;
  listScanPictureNames(scan: Pick<CatalogScan, "partitionKey" | "urlPdf">, stems: string[]): Promise<string[]>;
  getScanPicture(name: string): Promise<Uint8Array | null>;
  expiresAt?(): Date | null;
}
