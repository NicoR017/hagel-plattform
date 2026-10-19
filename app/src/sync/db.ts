import Dexie, { type Table } from "dexie";
import type { ClientPhoto, ClientVehicle, Op, PullResponse } from "@hagel/shared";

/** Local (offline) view of a vehicle = last server snapshot + pending local operations replayed on top. */
export type LocalVehicle = ClientVehicle & { _pending?: number; _localOnly?: boolean };
export type LocalPhoto = ClientPhoto & { orgId: string; _pending?: boolean };

export interface OutboxRow {
  id?: number;
  orgId: string;
  op: Op;
  /** vehicle the op concerns (for rebuilds) */
  vehicleId: string;
  /** extra info only needed locally, e.g. the organisation of a vehicle being created */
  createdAt: number;
}
export interface BlobRow { key: string; blob: Blob; type: string; size: number; name?: string }
export interface UploadRow { key: string; kind: "photo" | "scan" | "report"; refId: string; vehicleId: string; orgId: string; tries: number; nextTry: number }
export interface IssueRow { id?: number; orgId: string; at: number; opType: string; code: string; message: string; vehicleId?: string; seen: boolean }
export interface MetaRow { key: string; value: unknown }

export class LocalDb extends Dexie {
  vehicles!: Table<LocalVehicle, string>;
  serverVehicles!: Table<ClientVehicle, string>;
  photos!: Table<LocalPhoto, string>;
  blobs!: Table<BlobRow, string>;
  outbox!: Table<OutboxRow, number>;
  uploads!: Table<UploadRow, string>;
  issues!: Table<IssueRow, number>;
  meta!: Table<MetaRow, string>;

  constructor(name = "hagel") {
    super(name);
    this.version(1).stores({
      vehicles: "id, orgId, statut, stationId, clientStationId, leistungsdatum",
      serverVehicles: "id, orgId",
      photos: "id, vehicleId, orgId",
      blobs: "key",
      outbox: "++id, orgId, vehicleId",
      uploads: "key, orgId",
      issues: "++id, orgId, seen",
      meta: "key",
    });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }
  setMeta(key: string, value: unknown) { return this.meta.put({ key, value }); }
}

export type Refs = PullResponse["refs"];
export const refsKey = (org: string) => `refs:${org}`;
export const cursorKey = (org: string) => `cursor:${org}`;
export const epochKey = (org: string) => `epoch:${org}`;
