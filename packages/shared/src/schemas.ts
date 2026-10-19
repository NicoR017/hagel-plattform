import { z } from "zod";
import { PERMISSIONS, SCOPES, STATION_TYPES } from "./permissions";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const uuid = z.string().uuid();

export const roleInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).default(""),
  scope: z.enum(SCOPES),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
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
  report_emails: z.array(emailSchema).default([]),
  commission_mode: z.enum(["pct", "staffel"]).default("pct"),
  commission_pct: z.number().min(0).max(100).default(0),
});

export const inviteInput = z.object({
  email: emailSchema,
  role_id: uuid,
  station_id: uuid.nullable().default(null),
  scope_client_station_id: uuid.nullable().default(null),
  scope_insurer_id: uuid.nullable().default(null),
  scope_campaign_id: uuid.nullable().default(null),
  expires_at: z.string().datetime().nullable().default(null),
});

export const acceptInviteInput = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(1).max(120),
  language: z.enum(["de", "es"]).default("de"),
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
