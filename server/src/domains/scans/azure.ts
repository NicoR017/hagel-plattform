/**
 * Read-only access to the Colibri storage account (storagecolibri): Table Storage and Blob Storage over REST with a SAS token.
 * Nothing here ever writes to Azure. The Colibri side must not be changed: we adapt to what exists.
 */
export interface TableRow { PartitionKey: string; RowKey: string; Timestamp?: string; [k: string]: unknown }

export interface AzureSource {
  /** All rows of a table (follows continuation tokens). `filter` is an OData $filter. */
  queryTable(table: string, opts?: { filter?: string }): AsyncGenerator<TableRow>;
  listBlobs(container: string, prefix: string): Promise<string[]>;
  getBlob(container: string, name: string): Promise<Uint8Array | null>;
  /** When the SAS token stops working (its `se` parameter), if known. */
  expiresAt?(): Date | null;
}

/** Expiry (`se=`) of a SAS token; null when it has none or cannot be read. */
export function sasExpiry(sas: string): Date | null {
  const m = /(?:^|[?&])se=([^&]+)/.exec(sas);
  if (!m) return null;
  const d = new Date(decodeURIComponent(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; headers: { get(n: string): string | null }; json(): Promise<unknown>; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface AzureConfig { account: string; sas: string; fetch?: FetchFn; tableEndpoint?: string; blobEndpoint?: string }

export const odataString = (s: string) => `'${s.replace(/'/g, "''")}'`;

const xmlDecode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export class AzureError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class AzureRest implements AzureSource {
  private f: FetchFn;
  private sas: string;
  private table: string;
  private blob: string;
  expiresAt(): Date | null { return sasExpiry(this.sas); }
  /** "HTTP 403" alone does not say why; an expired token is by far the most common reason. */
  private why(status: number): string {
    if (status !== 403 && status !== 401) return `HTTP ${status}`;
    const e = this.expiresAt();
    return e && e.getTime() < Date.now() ? `HTTP ${status} (SAS expired on ${e.toISOString().slice(0, 16)}Z: create a new one)` : `HTTP ${status} (SAS refused: expired, wrong permissions or wrong account)`;
  }
  constructor(c: AzureConfig) {
    this.f = c.fetch ?? ((url, init) => fetch(url, init) as never);
    this.sas = c.sas.replace(/^\?/, "");
    this.table = (c.tableEndpoint ?? `https://${c.account}.table.core.windows.net`).replace(/\/$/, "");
    this.blob = (c.blobEndpoint ?? `https://${c.account}.blob.core.windows.net`).replace(/\/$/, "");
  }

  async *queryTable(table: string, opts: { filter?: string } = {}): AsyncGenerator<TableRow> {
    let next: { pk: string; rk: string } | null = null;
    for (let page = 0; page < 10_000; page++) {
      const q = new URLSearchParams();
      if (opts.filter) q.set("$filter", opts.filter);
      if (next) { q.set("NextPartitionKey", next.pk); if (next.rk) q.set("NextRowKey", next.rk); }
      const url = `${this.table}/${encodeURIComponent(table)}()?${q.toString().replace(/\+/g, "%20")}${q.size ? "&" : ""}${this.sas}`;
      const res = await this.f(url, { headers: { Accept: "application/json;odata=nometadata", "x-ms-version": "2020-12-06", DataServiceVersion: "3.0;NetFx", MaxDataServiceVersion: "3.0;NetFx" } });
      if (res.status === 404) return; // table does not exist (yet)
      if (!res.ok) throw new AzureError(res.status, `Azure table ${table}: ${this.why(res.status)}`);
      const body = (await res.json()) as { value?: TableRow[] };
      for (const r of body.value ?? []) yield r;
      const npk = res.headers.get("x-ms-continuation-NextPartitionKey");
      if (!npk) return;
      next = { pk: npk, rk: res.headers.get("x-ms-continuation-NextRowKey") ?? "" };
    }
  }

  async listBlobs(container: string, prefix: string): Promise<string[]> {
    const names: string[] = [];
    let marker = "";
    for (let page = 0; page < 1000; page++) {
      const q = new URLSearchParams({ restype: "container", comp: "list", prefix, maxresults: "500" });
      if (marker) q.set("marker", marker);
      const res = await this.f(`${this.blob}/${encodeURIComponent(container)}?${q.toString().replace(/\+/g, "%20")}&${this.sas}`, { headers: { "x-ms-version": "2020-12-06" } });
      if (res.status === 404) return names;
      if (!res.ok) throw new AzureError(res.status, `Azure list ${container}: ${this.why(res.status)}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Blob>\s*<Name>([\s\S]*?)<\/Name>/g)) names.push(xmlDecode(m[1]));
      marker = /<NextMarker>([\s\S]*?)<\/NextMarker>/.exec(xml)?.[1] ?? "";
      if (!marker) break;
    }
    return names;
  }

  async getBlob(container: string, name: string): Promise<Uint8Array | null> {
    const path = name.split("/").map(encodeURIComponent).join("/");
    const res = await this.f(`${this.blob}/${encodeURIComponent(container)}/${path}?${this.sas}`, { headers: { "x-ms-version": "2020-12-06" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new AzureError(res.status, `Azure blob ${container}/${name}: ${this.why(res.status)}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export function azureFromEnv(env: Record<string, string | undefined> = process.env): AzureSource | null {
  if (!env.AZURE_STORAGE_SAS) return null;
  return new AzureRest({ account: env.AZURE_STORAGE_ACCOUNT ?? "storagecolibri", sas: env.AZURE_STORAGE_SAS });
}

/** Column names of AllScanResults (case-insensitive lookup: the exact casing on the real table is not known). */
export function col(row: TableRow, name: string): unknown {
  if (name in row) return row[name];
  const k = Object.keys(row).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? row[k] : undefined;
}
export const colStr = (row: TableRow, ...names: string[]): string => {
  for (const n of names) { const v = col(row, n); if (v !== undefined && v !== null && String(v) !== "") return String(v); }
  return "";
};
