/**
 * Sync protocol (local-first). Types + Zod schemas shared by app and server.
 *
 * Push: the client sends an ordered list of operations (each with a unique `opId`, so retries are idempotent).
 * Conflicts: last-writer-wins per field group (header, shares, status, site) and per PANEL KEY; an operation
 * whose `at` is older than the server's stamp for that group is answered with `conflict` + the server version.
 * Photos are append-only (add / update label-phase / delete), so they never conflict.
 * Pull: cursor based (`since` = last seen change number); the server only sends what the user may see, with
 * restricted fields removed, plus ids of vehicles that left the user's scope (`gone`).
 */
import { z } from "zod";
import { STATUSES } from "./permissions";

export const uuidStr = z.string().uuid();
const iso = z.string().datetime();

export const PHOTO_PHASES = ["besichtigung", "reparatur", "fertig"] as const;
export type PhotoPhase = (typeof PHOTO_PHASES)[number];

/** Header fields (v20 names). Everything optional: a header op carries only the changed fields. */
export const headerFields = z.object({
  land: z.enum(["DE", "ES"]),
  kennzeichen: z.string().max(40),
  fin: z.string().max(40),
  modell: z.string().max(120),
  kunde: z.string().max(160), // snapshot of the customer carrosserie name
  kundeEmail: z.string().max(254),
  leistungsdatum: z.string().max(10),
  teiler: z.number().int().min(10).max(12),
  stundensatz: z.number().min(0).max(1000),
  notiz: z.string().max(5000),
  zustand: z.array(z.string().max(40)).max(20),
  greifzone: z.boolean(),
  hohlraum: z.boolean(),
  verbringung: z.boolean(),
  demontage: z.boolean(),
  demontageEur: z.number().min(0).max(100000),
  glass: z.record(z.string(), z.object({ on: z.boolean().optional(), eur: z.number().min(0).max(100000).optional() })),
  claimNumber: z.string().max(80),
  companyId: z.string().max(80).nullable(),
  logo: z.enum(["pdr", "none"]),
  // links (stored as columns)
  clientStationId: uuidStr.nullable(),
  insurerId: uuidStr.nullable(),
  campaignId: uuidStr.nullable(),
}).partial().strict();
export type HeaderFields = z.infer<typeof headerFields>;
/** Header fields only users with `prix.voir` may write. */
export const PRICE_HEADER_FIELDS = ["stundensatz", "demontageEur", "glass"] as const;

export const sharesFields = z.object({
  techName: z.string().max(120),
  techPct: z.number().min(0).max(100),
  demTechName: z.string().max(120),
  demTechPct: z.number().min(0).max(100),
}).partial().strict();
/** Commission snapshot (taken from the customer carrosserie; editable only with `commission.modifier`). */
export const commissionFields = z.object({
  werkPct: z.number().min(0).max(100),
  werkMode: z.enum(["pct", "staffel"]),
}).partial().strict();

export const panelSchema = z.object({
  key: z.string().max(30),
  dents: z.record(z.string(), z.number().int().min(0).max(100000)),
  big: z.number().int().min(0).max(100000).optional(),
  bigEur: z.number().min(0).max(100000).optional(),
  alu: z.boolean().optional(),
  kleber: z.boolean().optional(),
  method: z.enum(["sanft", "ptp", "erneuern"]).optional(),
  finish: z.boolean().optional(),
  awManual: z.boolean().optional(),
  baseAW: z.number().nullable().optional(),
}).strict();

export const colibriMeta = z.object({
  method: z.string(), kunde: z.string(), sprache: z.string(), at: z.string(),
  imported: z.number(), reportTotal: z.number().nullable(), rowSum: z.number(), unknown: z.array(z.string()),
}).strict();

const base = { opId: uuidStr, at: iso };

export const photoInput = z.object({
  id: uuidStr, vehicleId: uuidStr, label: z.string().max(80), phase: z.enum(PHOTO_PHASES),
  source: z.enum(["app", "colibri"]).default("app"), inPdf: z.boolean().default(true),
  takenAt: iso, sort: z.number().int().default(0),
  colibriPosition: z.string().max(40).nullable().default(null), colibriIndex: z.number().int().nullable().default(null),
}).strict();

export const opSchema = z.discriminatedUnion("type", [
  z.object({
    ...base, type: z.literal("vehicle.create"),
    vehicle: z.object({
      id: uuidStr, stationId: uuidStr, clientStationId: uuidStr.nullable().default(null),
      campaignId: uuidStr.nullable().default(null), insurerId: uuidStr.nullable().default(null),
      header: headerFields, panels: z.record(z.string(), panelSchema).default({}), shares: sharesFields.default({}),
      statut: z.enum(STATUSES).default("arrive"),
    }).strict(),
  }),
  z.object({ ...base, type: z.literal("vehicle.header"), vehicleId: uuidStr, fields: headerFields }),
  z.object({ ...base, type: z.literal("vehicle.panel"), vehicleId: uuidStr, key: z.string().max(30), panel: panelSchema.nullable() }),
  z.object({ ...base, type: z.literal("vehicle.shares"), vehicleId: uuidStr, fields: sharesFields.merge(commissionFields) }),
  z.object({ ...base, type: z.literal("vehicle.status"), vehicleId: uuidStr, statut: z.enum(STATUSES), motif: z.string().max(300).optional() }),
  z.object({ ...base, type: z.literal("vehicle.move"), vehicleId: uuidStr, toStationId: uuidStr, note: z.string().max(300).optional() }),
  z.object({ ...base, type: z.literal("vehicle.delete"), vehicleId: uuidStr }),
  z.object({ ...base, type: z.literal("vehicle.assign"), vehicleId: uuidStr, kind: z.enum(["pdr", "demontage"]), userIds: z.array(uuidStr).max(20) }),
  z.object({
    ...base, type: z.literal("vehicle.colibri"), vehicleId: uuidStr, colibri: colibriMeta,
    file: z.object({ name: z.string().max(200), size: z.number().int().min(0) }).nullable(),
  }),
  z.object({ ...base, type: z.literal("photo.add"), photo: photoInput }),
  z.object({
    ...base, type: z.literal("photo.update"), photoId: uuidStr,
    fields: z.object({ label: z.string().max(80), phase: z.enum(PHOTO_PHASES), inPdf: z.boolean(), sort: z.number().int() }).partial().strict(),
  }),
  z.object({ ...base, type: z.literal("photo.delete"), photoId: uuidStr }),
]);
export type Op = z.infer<typeof opSchema>;

export const pushInput = z.object({ ops: z.array(opSchema).min(1).max(200) });
export type PushInput = z.infer<typeof pushInput>;

export type OpStatus = "ok" | "conflict" | "rejected";
export interface OpResult {
  opId: string;
  status: OpStatus;
  /** error code (see ERROR_MESSAGES) when rejected */
  code?: string;
  message?: string;
  /** server version of the vehicle after the op (already filtered for this user), sent on conflict */
  vehicle?: ClientVehicle;
  /** warnings that do not block (e.g. site over capacity) */
  warnings?: string[];
}
export interface PushResponse { results: OpResult[] }

/** What a client may hold. Restricted fields are absent (not blank) when the user has no right to them. */
export interface ClientVehicle extends Record<string, unknown> {
  id: string;
  orgId: string;
  stationId: string | null;
  clientStationId: string | null;
  campaignId: string | null;
  insurerId: string | null;
  statut: string;
  statutMotif: string | null;
  statutDepuis: string | null;
  repAt: string | null;
  panels: Record<string, unknown>;
  colibri: unknown | null;
  colibriFile: { name: string; size: number } | null;
  assigneeIds: string[];
  updatedAt: string;
  updatedBy: string | null;
  seq: number;
  /** server stamps (ms) so the client can resolve conflicts */
  groupAt: Record<string, number>;
  panelsAt: Record<string, number>;
}

export interface ClientPhoto {
  id: string; vehicleId: string; label: string; phase: PhotoPhase; source: string; inPdf: boolean;
  takenAt: string; takenBy: string | null; sort: number; hasFile: boolean;
  colibriPosition: string | null; colibriIndex: number | null; deleted: boolean; seq: number;
}

export interface ClientStation {
  id: string; type: string; name: string; country: string; capacite: number;
  commissionMode?: string; commissionPct?: number; active: boolean;
}
export interface OrgSettings {
  rateDE: number; rateES: number; defaultTeiler: number;
  /** editable Spain matrix (see packages/calc EsMatrix); absent = built-in default */
  esMatrix?: unknown;
}
export const DEFAULT_ORG_SETTINGS: OrgSettings = { rateDE: 83, rateES: 69, defaultTeiler: 10 };

export interface PullResponse {
  /** identifies the user's grants; when it changed since the last pull the client must replace its local set */
  epoch: string;
  reset: boolean;
  cursor: number;
  hasMore: boolean;
  vehicles: ClientVehicle[];
  photos: ClientPhoto[];
  /** vehicle ids that changed and are no longer visible to this user */
  gone: string[];
  refs: {
    stations: ClientStation[];
    settings: OrgSettings;
    me: { id: string; name: string; language: string; permissions: string[] };
    /** users that can be assigned (id, name) — only for users with `vehicules.assigner` */
    people: { id: string; name: string }[];
  };
}

export const esMatrixSchema = z.object({
  rate_eur_per_h: z.number().min(0).max(1000),
  knots: z.array(z.tuple([z.number().int().positive(), z.number().positive()])).min(2).max(20),
  categories: z.array(z.object({ cat: z.string().min(1).max(3), from: z.number().int().min(0), to: z.number().int().positive().nullable(), cap_h: z.number().positive() })).min(1).max(12),
  kickback_eur: z.array(z.object({ max_h: z.number().optional(), lt_h: z.number().optional(), else: z.boolean().optional(), eur: z.number().min(0) })).min(1).max(12),
  adjustments: z.object({
    alu_per_vehicle_h: z.number(), erneuern_per_panel_h: z.number(), kleber_share_pct: z.number(), ptp_share_pct: z.number(),
  }),
  demontage_presets_eur: z.record(z.string(), z.number().min(0)),
  vat: z.number().min(0).max(1),
}).passthrough();

export const settingsInput = z.object({
  rateDE: z.number().min(0).max(1000),
  rateES: z.number().min(0).max(1000),
  defaultTeiler: z.union([z.literal(10), z.literal(12)]),
  esMatrix: esMatrixSchema.nullable().optional(),
}).partial();
export const ocrInput = z.object({
  image: z.string().min(100).max(8_000_000), // base64 JPEG
  mode: z.enum(["kz", "fin"]),
  land: z.enum(["DE", "ES"]).default("DE"),
});
