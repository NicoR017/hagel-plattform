import type { AzureSource, TableRow } from "./azure";

/** In-memory Azure for tests and local development. Supports the one filter the sync uses: Timestamp ge datetime'…'. */
export class FakeAzure implements AzureSource {
  tables: Record<string, TableRow[]> = {};
  blobs = new Map<string, Uint8Array>();
  failTable: string | null = null;
  calls: string[] = [];

  add(table: string, row: TableRow) {
    const rows = (this.tables[table] ??= []);
    const i = rows.findIndex((r) => r.PartitionKey === row.PartitionKey && r.RowKey === row.RowKey);
    const withTs = { Timestamp: new Date().toISOString(), ...row };
    if (i >= 0) rows[i] = withTs; else rows.push(withTs);
  }
  putBlob(container: string, name: string, bytes: Uint8Array) { this.blobs.set(`${container}/${name}`, bytes); }

  async *queryTable(table: string, opts: { filter?: string } = {}): AsyncGenerator<TableRow> {
    this.calls.push(`table:${table}:${opts.filter ?? ""}`);
    if (this.failTable === table) throw new Error(`Azure table ${table}: HTTP 500`);
    const m = /Timestamp ge datetime'([^']+)'/.exec(opts.filter ?? "");
    const since = m ? Date.parse(m[1]) : 0;
    for (const r of this.tables[table] ?? []) if (!since || Date.parse(String(r.Timestamp ?? 0)) >= since) yield r;
  }
  async listBlobs(container: string, prefix: string): Promise<string[]> {
    this.calls.push(`list:${container}:${prefix}`);
    return [...this.blobs.keys()].filter((k) => k.startsWith(`${container}/${prefix}`)).map((k) => k.slice(container.length + 1)).sort();
  }
  async getBlob(container: string, name: string): Promise<Uint8Array | null> {
    this.calls.push(`blob:${container}/${name}`);
    return this.blobs.get(`${container}/${name}`) ?? null;
  }
}
