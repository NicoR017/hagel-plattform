import { sql } from "drizzle-orm";
import {
  boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid,
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
  reportEmails: text("report_emails").array().notNull().default(sql`'{}'::text[]`),
  commissionMode: text("commission_mode").notNull().default("pct"),
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  active: boolean("active").notNull().default(true),
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

/** Skeleton: only the columns the permission module needs; phase 3 adds the v20 fields via migration. */
export const vehicles = pgTable("vehicles", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  stationId: uuid("station_id").references(() => stations.id),
  clientStationId: uuid("client_station_id").references(() => stations.id),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  insurerId: uuid("insurer_id").references(() => insurers.id),
  statut: text("statut").notNull().default("arrive"),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").references(() => users.id),
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({ byOrgStation: index("veh_org_station_idx").on(t.orgId, t.stationId) }));

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

