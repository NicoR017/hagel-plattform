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
import { REPAIR_STAGES, STATUSES } from "./permissions";

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
  /** labels of parts to replace (printed on the KVA, no price) */
  partsToReplace: z.array(z.string().trim().min(1).max(80)).max(40),
  companyId: z.string().max(80).nullable(),
  logo: z.enum(["pdr", "none"]),
  // links (stored as columns)
  clientStationId: uuidStr.nullable(),
  insurerId: uuidStr.nullable(),
  campaignId: uuidStr.nullable(),
  /** calculation method frozen on the vehicle (stored as columns; both together) */
  methodId: uuidStr.nullable(),
  methodVersion: z.number().int().min(1).nullable(),
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

export const REPAIR_CHECKS = ["pdr", "teile", "chef"] as const;
export type RepairCheck = (typeof REPAIR_CHECKS)[number];
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const appointmentInput = z.object({
  id: uuidStr, technicianId: uuidStr, date: ymd, durationMin: z.number().int().min(5).max(1440), note: z.string().max(300).default(""),
}).strict();
const bookingInput = z.object({
  id: uuidStr, date: ymd, time: hhmm,
  phone: z.string().trim().min(6).max(40).regex(/^[+\d][\d\s().\/-]{4,}$/),
  email: z.string().trim().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
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
  /** Ask the server to e-mail a report (the PDF is uploaded separately to /files/report/:id). */
  // ---- UI v3 (see V3_OP_TYPES)
  z.object({ ...base, type: z.literal("vehicle.repairStage"), vehicleId: uuidStr, stage: z.enum(REPAIR_STAGES) }),
  z.object({ ...base, type: z.literal("repair.todo.add"), vehicleId: uuidStr, todo: z.object({ id: uuidStr, text: z.string().trim().min(1).max(200) }).strict() }),
  z.object({ ...base, type: z.literal("repair.todo.toggle"), todoId: uuidStr, done: z.boolean() }),
  z.object({ ...base, type: z.literal("repair.todo.delete"), todoId: uuidStr }),
  z.object({ ...base, type: z.literal("photo.stage"), photoId: uuidStr, repairStage: z.enum(REPAIR_STAGES).nullable(), role: z.string().trim().max(40).nullable() }),
  z.object({ ...base, type: z.literal("repair.check"), vehicleId: uuidStr, key: z.enum(REPAIR_CHECKS), done: z.boolean() }),
  z.object({ ...base, type: z.literal("vehicle.comment"), vehicleId: uuidStr, comment: z.object({ id: uuidStr, text: z.string().max(2000) }).strict() }),
  z.object({ ...base, type: z.literal("appointment.add"), vehicleId: uuidStr, appointment: appointmentInput }),
  z.object({ ...base, type: z.literal("appointment.update"), appointmentId: uuidStr, fields: appointmentInput.omit({ id: true }).partial().strict() }),
  z.object({ ...base, type: z.literal("appointment.delete"), appointmentId: uuidStr }),
  z.object({ ...base, type: z.literal("booking.create"), vehicleId: uuidStr, booking: bookingInput }),
  z.object({ ...base, type: z.literal("booking.move"), bookingId: uuidStr, date: ymd, time: hhmm }),
  z.object({ ...base, type: z.literal("booking.cancel"), bookingId: uuidStr }),
  z.object({ ...base, type: z.literal("report.send"), vehicleId: uuidStr, report: z.object({ id: uuidStr, type: z.enum(["kva", "reparation"]), lang: z.enum(["de", "es"]) }).strict() }),
]);
export type Op = z.infer<typeof opSchema>;

/** Every op type this version understands. The server answers 409 `unsupported_op` (nothing applied) for any other type. */
export const KNOWN_OP_TYPES: readonly string[] = opSchema.options.map((o) => o.shape.type.value);
/**
 * Op types added after the first release (UI v3). A client sends them in batches of their own, never mixed with the older
 * types, and keeps them queued (instead of dropping them) when the server does not know them yet (rollback, partial deploy).
 */
export const V3_OP_TYPES: readonly string[] = [
  "vehicle.repairStage", "photo.stage", "repair.todo.add", "repair.todo.toggle", "repair.todo.delete", "repair.check", "vehicle.comment",
  "appointment.add", "appointment.update", "appointment.delete", "booking.create", "booking.move", "booking.cancel",
];
export const isV3Op = (type: string): boolean => V3_OP_TYPES.includes(type);

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
  /** repair board column (null = not in the repair flow) */
  repairStage?: string | null;
  /** frozen calculation method (null = historical behaviour) */
  methodId?: string | null;
  methodVersion?: number | null;
  /** repair data, only for users who may see it (see ClientRepair) */
  repair?: ClientRepair;
  updatedAt: string;
  updatedBy: string | null;
  seq: number;
  /** server stamps (ms) so the client can resolve conflicts */
  groupAt: Record<string, number>;
  panelsAt: Record<string, number>;
}

export interface ClientRepair {
  todos: { id: string; text: string; source: "manual" | "part"; done: boolean; doneBy: string | null; doneAt: string | null; createdBy: string | null; createdAt: string; sort: number }[];
  /** manual checks: who confirmed and when (null = open) */
  checks: Record<string, { by: string | null; at: string } | null>;
  /** why "Finish" is refused right now (empty = allowed): todos_open, check:pdr, check:teile, check:chef, photos:<stage>, no_technician */
  finishBlockers: string[];
  comments: { id: string; userId: string | null; userName: string; at: string; text: string }[];
  appointments: { id: string; technicianId: string; date: string; durationMin: number; note: string }[];
  booking: { id: string; date: string; time: string; status: string; phone: string; email: string; createdBy: string | null; createdAt: string } | null;
  /** day of the repair booking that moved this car into "Bereit" by itself (card badge "Termin heute") */
  autoStartedOn?: string | null;
  /** the last repair report sent for this vehicle (automatic or re-sent) */
  lastReport?: { status: string; at: string; auto: boolean } | null;
}

export interface ClientMethod {
  id: string; name: string; engine: "aw" | "matrix"; country: "DE" | "ES"; isSystem: boolean; currentVersion: number; archived: boolean;
  /** every version's parameters ("1" -> params): a vehicle keeps computing with the version it was frozen on */
  versions: Record<string, unknown>;
}

export interface ClientPhoto {
  id: string; vehicleId: string; label: string; phase: PhotoPhase; source: string; inPdf: boolean;
  takenAt: string; takenBy: string | null; sort: number; hasFile: boolean;
  colibriPosition: string | null; colibriIndex: number | null; deleted: boolean; seq: number;
  /** repair stage the photo belongs to and the role of the person who took it (UI v3) */
  repairStage?: string | null; role?: string | null; takenByName?: string | null;
}

export interface ClientStation {
  id: string; type: string; name: string; country: string; capacite: number;
  /** Colibri tenant of the site: moving a car to a site of another tenant shows a warning */
  azureTenant?: string | null;
  commissionMode?: string; commissionPct?: number; active: boolean;
  /** repair places per day (repair calendar) */
  repairsPerDay?: number;
  address?: string;
}
export interface OrgSettings {
  rateDE: number; rateES: number; defaultTeiler: number;
  /** editable Spain matrix (see packages/calc EsMatrix); absent = built-in default */
  esMatrix?: unknown;
  /** a vehicle is "delayed" when it stays in a status for more than N days (status -> days; absent = never delayed) */
  delayDays?: Record<string, number>;
}
export const DEFAULT_DELAY_DAYS: Record<string, number> = { attente: 3, reparatur: 5 };
export const DEFAULT_ORG_SETTINGS: OrgSettings = { rateDE: 83, rateES: 69, defaultTeiler: 10, delayDays: DEFAULT_DELAY_DAYS };

export interface ClientInsurer { id: string; name: string }
export interface ClientCampaign { id: string; name: string; country: string; start: string | null; end: string | null; stationIds: string[] }
export interface ClientCompany { id: string; name: string; address: string; taxId: string; email: string; footer: string; hasLogo: boolean; logo: { kind: "jpg" | "png"; width: number; height: number } | null }
export interface ClientTechnician { id: string; name: string; userId: string | null; defaultPctPdr: number; defaultPctDemontage: number; kind?: "pdr" | "headliner" }

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
    /** vehicles physically present per site (every status but `rendu`), for the sites the user can see */
    occupancy: Record<string, number>;
    settings: OrgSettings;
    me: { id: string; name: string; language: string; permissions: string[] };
    /** users that can be assigned (id, name) — only for users with `vehicules.assigner` */
    people: { id: string; name: string }[];
    insurers: ClientInsurer[];
    /** which insurers work with which carrosserie (pickers on a vehicle only offer the linked ones) */
    stationInsurers: { stationId: string; insurerId: string }[];
    campaigns: ClientCampaign[];
    companies: ClientCompany[];
    /** only for users who may see the internal split */
    technicians: ClientTechnician[];
    /** calculation methods (all versions) and which insurer uses which; absent for old servers */
    methods?: ClientMethod[];
    insurerMethods?: { insurerId: string; country: string; methodId: string }[];
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
  delayDays: z.record(z.enum(STATUSES), z.number().int().min(0).max(365)),
  esMatrix: esMatrixSchema.nullable().optional(),
}).partial();
export const ocrInput = z.object({
  image: z.string().min(100).max(8_000_000), // base64 JPEG
  mode: z.enum(["kz", "fin"]),
  land: z.enum(["DE", "ES"]).default("DE"),
});
