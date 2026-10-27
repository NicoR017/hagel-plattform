import { z } from "zod";
import { LANGS } from "./errors";
import { PERMISSIONS, PLACE_TYPES, ROLE_REPAIR_STEPS, SCOPES, STATION_TYPES } from "./permissions";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const uuid = z.string().uuid();

export const roleInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).default(""),
  scope: z.enum(SCOPES),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
  /** repair steps the role works on (technician / headliner accounts); empty = the rule of the technician record */
  repair_steps: z.array(z.enum(ROLE_REPAIR_STEPS)).max(ROLE_REPAIR_STEPS.length).default([]),
  /** replies to what this role's accounts send (reports, receipts) go to the contact address of the organisation; absent = unchanged */
  reply_from_contact: z.boolean().optional(),
});

export const stationInput = z.object({
  type: z.enum(STATION_TYPES),
  name: z.string().trim().min(1).max(120),
  address: z.string().max(300).default(""),
  country: z.enum(["DE", "ES"]).default("DE"),
  capacite: z.number().int().min(0).max(10000).default(0),
  azure_tenant: z.string().trim().min(1).max(120).nullable().default(null),
  azure_location_aliases: z.array(z.string().max(120)).default([]),
  azure_business_customer_id: z.string().max(80).nullable().default(null),
  azure_business_customer_ids: z.array(z.string().max(80)).max(200).default([]),
  azure_link_ids: z.array(z.string().max(120)).max(200).default([]),
  report_emails: z.array(emailSchema).default([]),
  commission_mode: z.enum(["pct", "staffel"]).default("pct"),
  commission_pct: z.number().min(0).max(100).default(0),
  /** repair places per working day (repair calendar) */
  repairs_per_day: z.number().int().min(0).max(100).default(3),
  /** automatic insurer addresses removed for this station */
  excluded_insurer_emails: z.array(emailSchema).max(100).default([]),
  /** PDR Citas location of this station (null = none) */
  citas_location_id: z.string().trim().min(1).max(80).nullable().default(null),
});

/** Places (hall / yard): no commission, no Colibri customer, no report addresses. */
export const placeInput = stationInput.extend({ type: z.enum(PLACE_TYPES) });
/** Body shops (customers): no capacity, no repair places, no Citas location. */
export const bodyshopInput = stationInput.omit({ type: true, capacite: true, repairs_per_day: true, citas_location_id: true, azure_location_aliases: true }).extend({
  contact_name: z.string().trim().max(120).nullable().default(null),
  contact_phone: z.string().trim().max(60).nullable().default(null),
  /** tax number of the body shop (CIF / NIF); kept upper-case, no spaces */
  cif: z.string().trim().max(20).transform((s) => s.replace(/\s+/g, "").toUpperCase()).nullable().default(null),
});

export const inviteInput = z.object({
  email: emailSchema,
  role_id: uuid,
  station_id: uuid.nullable().default(null),
  scope_client_station_id: uuid.nullable().default(null),
  scope_insurer_id: uuid.nullable().default(null),
  scope_campaign_id: uuid.nullable().default(null),
  expires_at: z.string().datetime().nullable().default(null),
  language: z.enum(LANGS).default("de"),
  /** only used with the Technician role: the invited person appears in the technicians list at once, as a PDR technician or a headliner */
  technician_kind: z.enum(["pdr", "headliner"]).default("pdr"),
});

export const passwordSchema = z.string().min(10).max(200);
export const passwordLoginInput = z.object({ email: emailSchema, password: z.string().min(1).max(200), device: z.string().max(200).default("") });
export const setPasswordInput = z.object({ password: passwordSchema, current_password: z.string().max(200).optional() });

export const acceptInviteInput = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema.optional(),
  name: z.string().trim().min(1).max(120),
  language: z.enum(LANGS).optional(),
});

export const assignmentInput = z.object({
  user_id: uuid,
  station_id: uuid.nullable().default(null),
  role_id: uuid,
  scope_client_station_id: uuid.nullable().default(null),
  scope_insurer_id: uuid.nullable().default(null),
  scope_campaign_id: uuid.nullable().default(null),
  expires_at: z.string().datetime().nullable().default(null),
});

export const loginRequestInput = z.object({ email: emailSchema });
export const loginVerifyInput = z.object({ token: z.string().min(20).max(200), device: z.string().max(200).default("") });
export const refreshInput = z.object({ refresh_token: z.string().min(20).max(200) });

export const languageInput = z.object({ language: z.enum(LANGS) });

export const insurerInput = z.object({
  name: z.string().trim().min(1).max(120),
  report_emails: z.array(emailSchema).max(20).default([]),
  send_reports: z.boolean().default(false),
  reports_to_send: z.enum(["kva", "reparation", "both"]).default("both"),
  azure_insurance_id: z.string().max(80).nullable().default(null),
});
export const stationInsurerInput = z.object({ insurer_ids: z.array(uuid).max(100) });
export const campaignInput = z.object({
  name: z.string().trim().min(1).max(120),
  country: z.enum(["DE", "ES"]).default("DE"),
  start: z.string().max(10).nullable().default(null),
  end: z.string().max(10).nullable().default(null),
  station_ids: z.array(uuid).max(200).default([]),
});
export const companyInput = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().max(400).default(""),
  tax_id: z.string().max(60).default(""),
  email: z.string().max(254).default(""),
  footer: z.string().max(600).default(""),
  active: z.boolean().default(true),
});
export const technicianInput = z.object({
  name: z.string().trim().min(1).max(120),
  user_id: uuid.nullable().default(null),
  default_pct_pdr: z.number().min(0).max(100).default(50),
  default_pct_demontage: z.number().min(0).max(100).default(100),
  /** pdr | headliner */
  kind: z.enum(["pdr", "headliner"]).default("pdr"),
  /** address of the weekly report; empty = the account's address */
  email: z.string().trim().toLowerCase().email().max(200).nullable().default(null),
  active: z.boolean().default(true),
});
