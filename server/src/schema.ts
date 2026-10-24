import { sql } from "drizzle-orm";
import {
  bigint, boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  country: text("country").notNull().default("DE"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  language: text("language").notNull().default("de"),
  /** invited | active | disabled */
  status: text("status").notNull().default("active"),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  /** scrypt hash (`scrypt$N$salt$hash`); null = no password yet (magic link only) */
  passwordHash: text("password_hash"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable("memberships", {
  userId: uuid("user_id").notNull().references(() => users.id),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  createdAt: createdAt(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.orgId] }) }));

export const roles = pgTable("roles", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  key: text("key"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  scope: text("scope").notNull(),
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({ byOrg: index("roles_org_idx").on(t.orgId) }));

/** SITE = carrosserie / taller / Werkstatt / station. */
export const stations = pgTable("stations", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  type: text("type").notNull(),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  country: text("country").notNull().default("DE"),
  capacite: integer("capacite").notNull().default(0),
  azureTenant: text("azure_tenant"),
  azureLocationAliases: text("azure_location_aliases").array().notNull().default(sql`'{}'::text[]`),
  azureBusinessCustomerId: text("azure_business_customer_id"),
  /** every BusinessCustomer whose links this site takes scans for (azure_business_customer_id mirrors the first one) */
  azureBcIds: text("azure_bc_ids").array().notNull().default(sql`'{}'::text[]`),
  /** individual BusinessCustomersInsurance links taken in addition (for customers not taken as a whole) */
  azureLinkIds: text("azure_link_ids").array().notNull().default(sql`'{}'::text[]`),
  reportEmails: text("report_emails").array().notNull().default(sql`'{}'::text[]`),
  commissionMode: text("commission_mode").notNull().default("pct"),
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  active: boolean("active").notNull().default(true),
  /** repair places per working day (repair calendar) */
  repairsPerDay: integer("repairs_per_day").notNull().default(3),
  /** automatic insurer report e-mails the admin removed for this station */
  excludedInsurerEmails: text("excluded_insurer_emails").array().notNull().default(sql`'{}'::text[]`),
  /** id of the PDR Citas location whose appointments are shown on this station (null = not linked) */
  /** body shops (customers) only: who to call there */
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  citasLocationId: text("citas_location_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({ byOrg: index("stations_org_idx").on(t.orgId) }));

export const orgTenants = pgTable("org_tenants", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  azureTenant: text("azure_tenant").notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.orgId, t.azureTenant] }) }));

export const insurers = pgTable("insurers", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  reportEmails: text("report_emails").array().notNull().default(sql`'{}'::text[]`),
  sendReports: boolean("send_reports").notNull().default(false),
  reportsToSend: text("reports_to_send").notNull().default("both"),
  azureInsuranceId: text("azure_insurance_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const stationInsurers = pgTable("station_insurers", {
  stationId: uuid("station_id").notNull().references(() => stations.id),
  insurerId: uuid("insurer_id").notNull().references(() => insurers.id),
  azureLinkId: text("azure_link_id"),
  azureLinkNames: text("azure_link_names").array().notNull().default(sql`'{}'::text[]`),
}, (t) => ({ pk: primaryKey({ columns: [t.stationId, t.insurerId] }) }));

export const campaigns = pgTable("campaigns", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  country: text("country").notNull().default("DE"),
  start: text("start"),
  end: text("end"),
  createdAt: createdAt(),
});

export const roleAssignments = pgTable("role_assignments", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  /** NULL = all sites of the organisation */
  stationId: uuid("station_id").references(() => stations.id),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  scopeClientStationId: uuid("scope_client_station_id").references(() => stations.id),
  scopeInsurerId: uuid("scope_insurer_id").references(() => insurers.id),
  scopeCampaignId: uuid("scope_campaign_id").references(() => campaigns.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => ({ byUser: index("ra_user_idx").on(t.userId) }));

export const invitations = pgTable("invitations", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  email: text("email").notNull(),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  stationId: uuid("station_id").references(() => stations.id),
  scopeClientStationId: uuid("scope_client_station_id"),
  scopeInsurerId: uuid("scope_insurer_id"),
  scopeCampaignId: uuid("scope_campaign_id"),
  assignmentExpiresAt: timestamp("assignment_expires_at", { withTimezone: true }),
  language: text("language").notNull().default("de"),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  invitedBy: uuid("invited_by").references(() => users.id),
  createdAt: createdAt(),
});

/** Magic-link login tokens for existing users (single use, hashed). */
export const loginTokens = pgTable("login_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  refreshHash: text("refresh_hash").notNull().unique(),
  device: text("device").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => ({ byUser: index("sessions_user_idx").on(t.userId) }));

/**
 * Vehicles. v20 JSON fields are split into field groups for last-writer-wins sync:
 * header (customer snapshot, plate, rates, toggles…), panels (per-key stamps), shares (technicians + commission snapshot),
 * status and site (columns). `seq` is a global change counter used as the pull cursor.
 */
export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey(), // generated by the client (offline creation)
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  stationId: uuid("station_id").references(() => stations.id),
  clientStationId: uuid("client_station_id").references(() => stations.id),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  insurerId: uuid("insurer_id").references(() => insurers.id),
  statut: text("statut").notNull().default("arrive"),
  statutMotif: text("statut_motif"),
  statutDepuis: timestamp("statut_depuis", { withTimezone: true }),
  statutAvant: text("statut_avant"),
  repAt: timestamp("rep_at", { withTimezone: true }),
  header: jsonb("header").notNull().default(sql`'{}'::jsonb`),
  panels: jsonb("panels").notNull().default(sql`'{}'::jsonb`),
  panelsAt: jsonb("panels_at").notNull().default(sql`'{}'::jsonb`),
  shares: jsonb("shares").notNull().default(sql`'{}'::jsonb`),
  groupAt: jsonb("group_at").notNull().default(sql`'{}'::jsonb`),
  colibri: jsonb("colibri"),
  colibriFile: jsonb("colibri_file"),
  /** PartitionKey|RowKey of the Azure scan this vehicle was imported from (unique: a scan is imported once) */
  colibriScanKey: text("colibri_scan_key").unique(),
  /** repair board column: bereit | demontage | pdr | remontage | bodyshop | finish (null = not in the repair flow) */
  repairStage: text("repair_stage"),
  /** calculation method + version frozen on the vehicle (null = historical behaviour) */
  methodId: uuid("method_id").references((): AnyPgColumn => calcMethods.id),
  methodVersion: integer("method_version"),
  /** body shop (a "carrosserie" site of the tenant) that repairs the car while it stands in the "At Bodyshop" column */
  bodyshopId: uuid("bodyshop_id").references((): AnyPgColumn => stations.id),
  seq: bigint("seq", { mode: "number" }).notNull().default(0),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  byOrgStation: index("veh_org_station_idx").on(t.orgId, t.stationId),
  bySeq: index("veh_seq_idx").on(t.orgId, t.seq),
}));

export const photos = pgTable("photos", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  fileKey: text("file_key"),
  size: integer("size"),
  label: text("label").notNull().default(""),
  phase: text("phase").notNull().default("besichtigung"),
  source: text("source").notNull().default("app"),
  colibriPosition: text("colibri_position"),
  colibriIndex: integer("colibri_index"),
  inPdf: boolean("in_pdf").notNull().default(true),
  /** repair board stage the photo was taken in, and the role of the person (Techniker, Headliner, ...) */
  repairStage: text("repair_stage"),
  role: text("role"),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  takenBy: uuid("taken_by").references(() => users.id),
  sort: integer("sort").notNull().default(0),
  seq: bigint("seq", { mode: "number" }).notNull().default(0),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => ({ byVehicle: index("photos_vehicle_idx").on(t.vehicleId), bySeq: index("photos_seq_idx").on(t.seq) }));

export const vehicleStatusHistory = pgTable("vehicle_status_history", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  statut: text("statut").notNull(),
  motif: text("motif"),
  userId: uuid("user_id").references(() => users.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const vehicleMoves = pgTable("vehicle_moves", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  fromStationId: uuid("from_station_id"),
  toStationId: uuid("to_station_id"),
  userId: uuid("user_id").references(() => users.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});

/** Idempotency: a retried push op returns its stored result instead of being applied twice. */
export const syncOps = pgTable("sync_ops", {
  opId: uuid("op_id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  result: jsonb("result").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgSettings = pgTable("org_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id),
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  updatedAt: updatedAt(),
});

export const vehicleAssignments = pgTable("vehicle_assignments", {
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  type: text("type").notNull().default("pdr"),
}, (t) => ({ pk: primaryKey({ columns: [t.vehicleId, t.userId, t.type] }) }));

export const auditLog = pgTable("audit_log", {
  id: id(),
  orgId: uuid("org_id"),
  userId: uuid("user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byOrg: index("audit_org_idx").on(t.orgId, t.at) }));


/** Letterheads (issuing companies). The logo file lives in storage under `logoKey`. */
export const companies = pgTable("companies", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  taxId: text("tax_id").notNull().default(""),
  email: text("email").notNull().default(""),
  footer: text("footer").notNull().default(""),
  logoKey: text("logo_key"),
  logoMeta: jsonb("logo_meta"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const technicians = pgTable("technicians", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  /** NULL = external technician without an account */
  userId: uuid("user_id").references(() => users.id),
  name: text("name").notNull(),
  defaultPctPdr: numeric("default_pct_pdr", { precision: 5, scale: 2 }).notNull().default("50"),
  defaultPctDemontage: numeric("default_pct_demontage", { precision: 5, scale: 2 }).notNull().default("100"),
  /** pdr | headliner */
  kind: text("kind").notNull().default("pdr"),
  /** where the weekly report goes (a technician without an account has no other address) */
  email: text("email"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const campaignStations = pgTable("campaign_stations", {
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  stationId: uuid("station_id").notNull().references(() => stations.id),
}, (t) => ({ pk: primaryKey({ columns: [t.campaignId, t.stationId] }) }));

/** One row per report sent (or queued) by e-mail from the server. The id is chosen by the client (idempotent retries). */
export const reportSends = pgTable("report_sends", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  /** kva | reparation */
  type: text("type").notNull(),
  lang: text("lang").notNull().default("de"),
  recipients: text("recipients").array().notNull().default(sql`'{}'::text[]`),
  /** awaiting_file | sent | failed | no_recipients */
  status: text("status").notNull().default("awaiting_file"),
  error: text("error"),
  fileKey: text("file_key"),
  sentBy: uuid("sent_by").references(() => users.id),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => ({ byVehicle: index("report_sends_vehicle_idx").on(t.vehicleId) }));

// ---------------------------------------------------------------- Azure mirrors (read-only copies of the Colibri tables)
export const azureTenants = pgTable("azure_tenants", {
  name: text("name").primaryKey(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
});
export const azureBusinessCustomers = pgTable("azure_business_customers", {
  id: text("id").primaryKey(), // RowKey (GUID)
  name: text("name").notNull(),
  partitionKey: text("partition_key").notNull().default(""),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
});
export const azureInsurances = pgTable("azure_insurances", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  partitionKey: text("partition_key").notNull().default(""),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
});
/** BusinessCustomersInsurance: the link a scan names in its `BusinessCustomer` column. */
export const azureBcInsuranceLinks = pgTable("azure_bc_insurance_links", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  businessCustomerId: text("business_customer_id").notNull(),
  insuranceId: text("insurance_id").notNull(),
  partitionKey: text("partition_key").notNull().default(""),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
});
export const colibriScans = pgTable("colibri_scans", {
  partitionKey: text("partition_key").notNull(),
  rowKey: text("row_key").notNull(),
  tenant: text("tenant").notNull().default(""),
  location: text("location").notNull().default(""),
  colibriNumber: text("colibri_number").notNull().default(""),
  businessCustomer: text("business_customer").notNull().default(""),
  claimNumber: text("claim_number").notNull().default(""),
  scanDateTime: timestamp("scan_date_time", { withTimezone: true }),
  plate: text("plate").notNull().default(""),
  vin: text("vin").notNull().default(""),
  brand: text("brand").notNull().default(""),
  model: text("model").notNull().default(""),
  buildYear: text("build_year").notNull().default(""),
  country: text("country").notNull().default(""),
  language: text("language").notNull().default(""),
  calculationMethod: text("calculation_method").notNull().default(""),
  dentsTotal: integer("dents_total"),
  scanFailed: boolean("scan_failed").notNull().default(false),
  errorMessage: text("error_message").notNull().default(""),
  urlPdf: text("url_pdf").notNull().default(""),
  raw: jsonb("raw").notNull().default(sql`'{}'::jsonb`),
  /** new | imported | ignored */
  importStatus: text("import_status").notNull().default("new"),
  vehicleId: uuid("vehicle_id"),
  importedBy: uuid("imported_by"),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.partitionKey, t.rowKey] }),
  byTenant: index("colibri_scans_tenant_idx").on(t.tenant, t.importStatus),
}));
export const azureSyncRuns = pgTable("azure_sync_runs", {
  id: id(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ok: boolean("ok"),
  error: text("error"),
  stats: jsonb("stats"),
});
export const azureSyncState = pgTable("azure_sync_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

// ---------------------------------------------------------------- UI v3: calculation methods
export const calcMethods = pgTable("calc_methods", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  /** aw | matrix */
  engine: text("engine").notNull(),
  country: text("country").notNull(),
  baseMethodId: uuid("base_method_id"),
  isSystem: boolean("is_system").notNull().default(false),
  currentVersion: integer("current_version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({ byOrg: index("calc_methods_org_idx").on(t.orgId) }));

/** Every change of a method is a new version; vehicles keep computing with the version they were frozen on. */
export const calcMethodVersions = pgTable("calc_method_versions", {
  methodId: uuid("method_id").notNull().references(() => calcMethods.id),
  version: integer("version").notNull(),
  params: jsonb("params").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => ({ pk: primaryKey({ columns: [t.methodId, t.version] }) }));

export const insurerMethods = pgTable("insurer_methods", {
  insurerId: uuid("insurer_id").notNull().references(() => insurers.id),
  country: text("country").notNull(),
  methodId: uuid("method_id").notNull().references(() => calcMethods.id),
}, (t) => ({ pk: primaryKey({ columns: [t.insurerId, t.country] }) }));

// ---------------------------------------------------------------- UI v3: repair
export const repairTodos = pgTable("repair_todos", {
  id: uuid("id").primaryKey(), // chosen by the client
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  text: text("text").notNull(),
  /** manual | part (from "Zu ersetzende Teile") */
  source: text("source").notNull().default("manual"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  doneBy: uuid("done_by").references(() => users.id),
  doneAt: timestamp("done_at", { withTimezone: true }),
  sort: integer("sort").notNull().default(0),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({ byVehicle: index("repair_todos_vehicle_idx").on(t.vehicleId) }));

/** Manual quality checks (pdr, teile, chef). A row with done_at null = open. */
export const repairChecks = pgTable("repair_checks", {
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  key: text("key").notNull(),
  doneBy: uuid("done_by").references(() => users.id),
  doneAt: timestamp("done_at", { withTimezone: true }),
}, (t) => ({ pk: primaryKey({ columns: [t.vehicleId, t.key] }) }));

export const repairEvents = pgTable("repair_events", {
  id: id(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  /** null = the system (daily job, automatic report) */
  userId: uuid("user_id").references(() => users.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
}, (t) => ({ byVehicle: index("repair_events_vehicle_idx").on(t.vehicleId, t.at) }));

/** Weekly planning per technician ("Technikerplanung"). */
export const repairAppointments = pgTable("repair_appointments", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  technicianId: uuid("technician_id").notNull().references(() => technicians.id),
  date: text("date").notNull(),
  durationMin: integer("duration_min").notNull().default(60),
  note: text("note").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({ byVehicle: index("repair_appointments_vehicle_idx").on(t.vehicleId) }));

/** Repair calendar: one booking per vehicle (while booked), counted against stations.repairs_per_day. */
export const repairBookings = pgTable("repair_bookings", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  /** where the repair takes place (the station the car is moved to on the day; may differ from the one of the assessment) */
  stationId: uuid("station_id").notNull().references(() => stations.id),
  /** where the car stood when it was booked (null on older bookings: = stationId) */
  originStationId: uuid("origin_station_id").references(() => stations.id),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  date: text("date").notNull(),
  /** booked | cancelled | started */
  status: text("status").notNull().default("booked"),
  time: text("time").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerEmail: text("customer_email").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  startedAt: timestamp("started_at", { withTimezone: true }),
}, (t) => ({
  byDay: index("repair_bookings_day_idx").on(t.stationId, t.date),
  oneBooked: uniqueIndex("repair_bookings_one_booked_idx").on(t.vehicleId).where(sql`status = 'booked'`),
}));

export const vehicleComments = pgTable("vehicle_comments", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  userId: uuid("user_id").references(() => users.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  text: text("text").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({ byVehicle: index("vehicle_comments_vehicle_idx").on(t.vehicleId) }));

/** PDR Citas appointment -> vehicle: written only here, Citas itself is never modified. */
export const citasLinks = pgTable("citas_links", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  appointmentId: text("appointment_id").notNull(),
  locationId: text("location_id").notNull(),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  stationId: uuid("station_id").notNull().references(() => stations.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => ({ byAppt: uniqueIndex("citas_links_appt_uq").on(t.orgId, t.appointmentId), byVehicle: index("citas_links_vehicle_idx").on(t.vehicleId) }));
