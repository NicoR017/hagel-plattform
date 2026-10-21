import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { campaignInput, companyInput, insurerInput, stationInsurerInput, technicianInput, type Permission } from "@hagel/shared";
import { audit } from "./audit";
import { HttpError } from "./auth";
import type { Db } from "./db";
import type { Env } from "./env";
import type { Hub } from "./hub";
import { methodRoutes } from "./methods";
import { stationRecipientPreview } from "./reports";
import { campaignStations, campaigns, companies, insurers, stationInsurers, stations, technicians, users, memberships, vehicles } from "./schema";
import type { Storage } from "./storage";

interface Deps {
  db: Db; hub: Hub; storage: Storage;
  require: (p: Permission) => MiddlewareHandler<Env>;
  validationHook: (r: { success: boolean }, c: Context) => Response | undefined;
}

/** Image size from the file header (JPEG SOF / PNG IHDR), so the PDF layout knows the aspect ratio. */
export function imageInfo(b: Uint8Array): { kind: "jpg" | "png"; width: number; height: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { kind: "png", width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      i += 2;
      if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) continue;
      const len = (b[i] << 8) | b[i + 1];
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        return { kind: "jpg", height: (b[i + 3] << 8) | b[i + 4], width: (b[i + 5] << 8) | b[i + 6] };
      }
      i += len;
    }
  }
  return null;
}

export const logoKey = (orgId: string, id: string, kind: "jpg" | "png") => `logos/${orgId}/${id}.${kind}`;

/** Admin routes for insurers, campaigns, letterheads and technicians (mounted under /admin by app.ts). */
export function masterRoutes({ db, hub, storage, require, validationHook }: Deps) {
  const r = new Hono<Env>();
  const org = (c: Context<Env>) => c.get("orgId");
  const who = (c: Context<Env>) => c.get("principal").id;
  const touch = (orgId: string) => hub.publish(orgId, 0); // refs are part of every pull: tell the phones

  // ------------------------------------------------------------ insurers
  r.get("/insurers", require("assurances.gerer"), async (c) => {
    const rows = await db.select().from(insurers).where(eq(insurers.orgId, org(c))).orderBy(asc(insurers.name));
    const links = await db.select().from(stationInsurers).innerJoin(stations, eq(stations.id, stationInsurers.stationId)).where(eq(stations.orgId, org(c)));
    return c.json(rows.map((i) => ({ ...i, stationIds: links.filter((l) => l.station_insurers.insurerId === i.id).map((l) => l.station_insurers.stationId) })));
  });
  r.post("/insurers", require("assurances.gerer"), zValidator("json", insurerInput, validationHook), async (c) => {
    const b = c.req.valid("json");
    const [i] = await db.insert(insurers).values({ orgId: org(c), name: b.name, reportEmails: b.report_emails, sendReports: b.send_reports, reportsToSend: b.reports_to_send, azureInsuranceId: b.azure_insurance_id }).returning();
    await audit(db, { orgId: org(c), userId: who(c), action: "create", entity: "insurer", entityId: i.id, after: i });
    touch(org(c));
    return c.json(i, 201);
  });
  r.put("/insurers/:id", require("assurances.gerer"), zValidator("json", insurerInput.partial(), validationHook), async (c) => {
    const id = c.req.param("id") ?? "", b = c.req.valid("json");
    const [before] = await db.select().from(insurers).where(and(eq(insurers.id, id), eq(insurers.orgId, org(c))));
    if (!before) throw new HttpError(404, "insurer_not_found");
    const set: Partial<typeof insurers.$inferInsert> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name;
    if (b.report_emails !== undefined) set.reportEmails = b.report_emails;
    if (b.send_reports !== undefined) set.sendReports = b.send_reports;
    if (b.reports_to_send !== undefined) set.reportsToSend = b.reports_to_send;
    if (b.azure_insurance_id !== undefined) set.azureInsuranceId = b.azure_insurance_id;
    const [i] = await db.update(insurers).set(set).where(eq(insurers.id, id)).returning();
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "insurer", entityId: id, before, after: i });
    touch(org(c));
    return c.json(i);
  });
  r.delete("/insurers/:id", require("assurances.gerer"), async (c) => {
    const id = c.req.param("id") ?? "";
    const [before] = await db.select().from(insurers).where(and(eq(insurers.id, id), eq(insurers.orgId, org(c))));
    if (!before) throw new HttpError(404, "insurer_not_found");
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(eq(vehicles.insurerId, id));
    if (n) throw new HttpError(409, "role_in_use"); // vehicles still point to it
    await db.delete(stationInsurers).where(eq(stationInsurers.insurerId, id));
    await db.delete(insurers).where(eq(insurers.id, id));
    await audit(db, { orgId: org(c), userId: who(c), action: "delete", entity: "insurer", entityId: id, before });
    touch(org(c));
    return c.json({ ok: true });
  });
  /** Which insurers work with this carrosserie (replaces the whole list). */
  r.put("/stations/:id/insurers", require("assurances.gerer"), zValidator("json", stationInsurerInput, validationHook), async (c) => {
    const sid = c.req.param("id") ?? "", ids = [...new Set(c.req.valid("json").insurer_ids)];
    const [st] = await db.select().from(stations).where(and(eq(stations.id, sid), eq(stations.orgId, org(c))));
    if (!st) throw new HttpError(404, "station_not_found");
    if (ids.length) {
      const ok = await db.select({ id: insurers.id }).from(insurers).where(and(eq(insurers.orgId, org(c)), inArray(insurers.id, ids)));
      if (ok.length !== ids.length) throw new HttpError(404, "insurer_not_found");
    }
    const before = (await db.select().from(stationInsurers).where(eq(stationInsurers.stationId, sid))).map((l) => l.insurerId);
    await db.transaction(async (tx) => {
      await tx.delete(stationInsurers).where(eq(stationInsurers.stationId, sid));
      if (ids.length) await tx.insert(stationInsurers).values(ids.map((insurerId) => ({ stationId: sid, insurerId })));
    });
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "station_insurers", entityId: sid, before, after: ids });
    touch(org(c));
    return c.json({ insurer_ids: ids });
  });
  r.get("/stations/:id/insurers", require("assurances.gerer"), async (c) =>
    c.json((await db.select().from(stationInsurers).where(eq(stationInsurers.stationId, c.req.param("id") ?? ""))).map((l) => l.insurerId)));

  // ------------------------------------------------------------ campaigns
  const campaignRows = async (orgId: string) => {
    const rows = await db.select().from(campaigns).where(eq(campaigns.orgId, orgId)).orderBy(asc(campaigns.name));
    const links = await db.select().from(campaignStations);
    return rows.map((cp) => ({ ...cp, stationIds: links.filter((l) => l.campaignId === cp.id).map((l) => l.stationId) }));
  };
  /** Validate BEFORE writing anything, so a refused request leaves no half-created campaign behind. */
  const checkStations = async (orgId: string, ids: string[]) => {
    const uniq = [...new Set(ids)];
    if (uniq.length) {
      const ok = await db.select({ id: stations.id }).from(stations).where(and(eq(stations.orgId, orgId), inArray(stations.id, uniq)));
      if (ok.length !== uniq.length) throw new HttpError(400, "station_wrong_org");
    }
    return uniq;
  };
  const setCampaignStations = async (orgId: string, campaignId: string, ids: string[]) => {
    const uniq = await checkStations(orgId, ids);
    await db.delete(campaignStations).where(eq(campaignStations.campaignId, campaignId));
    if (uniq.length) await db.insert(campaignStations).values(uniq.map((stationId) => ({ campaignId, stationId })));
  };
  r.get("/campaigns", require("campagnes.gerer"), async (c) => c.json(await campaignRows(org(c))));
  r.post("/campaigns", require("campagnes.gerer"), zValidator("json", campaignInput, validationHook), async (c) => {
    const b = c.req.valid("json");
    await checkStations(org(c), b.station_ids);
    const [cp] = await db.insert(campaigns).values({ orgId: org(c), name: b.name, country: b.country, start: b.start, end: b.end }).returning();
    await setCampaignStations(org(c), cp.id, b.station_ids);
    await audit(db, { orgId: org(c), userId: who(c), action: "create", entity: "campaign", entityId: cp.id, after: { ...cp, stationIds: b.station_ids } });
    touch(org(c));
    return c.json({ ...cp, stationIds: b.station_ids }, 201);
  });
  r.put("/campaigns/:id", require("campagnes.gerer"), zValidator("json", campaignInput.partial(), validationHook), async (c) => {
    const id = c.req.param("id") ?? "", b = c.req.valid("json");
    const [before] = await db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.orgId, org(c))));
    if (!before) throw new HttpError(404, "campaign_not_found");
    if (b.station_ids !== undefined) await checkStations(org(c), b.station_ids);
    const set: Partial<typeof campaigns.$inferInsert> = {};
    if (b.name !== undefined) set.name = b.name;
    if (b.country !== undefined) set.country = b.country;
    if (b.start !== undefined) set.start = b.start;
    if (b.end !== undefined) set.end = b.end;
    if (Object.keys(set).length) await db.update(campaigns).set(set).where(eq(campaigns.id, id));
    if (b.station_ids !== undefined) await setCampaignStations(org(c), id, b.station_ids);
    const after = (await campaignRows(org(c))).find((x) => x.id === id);
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "campaign", entityId: id, before, after });
    touch(org(c));
    return c.json(after);
  });
  r.delete("/campaigns/:id", require("campagnes.gerer"), async (c) => {
    const id = c.req.param("id") ?? "";
    const [before] = await db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.orgId, org(c))));
    if (!before) throw new HttpError(404, "campaign_not_found");
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(eq(vehicles.campaignId, id));
    if (n) throw new HttpError(409, "role_in_use");
    await db.delete(campaignStations).where(eq(campaignStations.campaignId, id));
    await db.delete(campaigns).where(eq(campaigns.id, id));
    await audit(db, { orgId: org(c), userId: who(c), action: "delete", entity: "campaign", entityId: id, before });
    touch(org(c));
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ letterheads
  r.get("/companies", require("parametres.gerer"), async (c) => c.json(await db.select().from(companies).where(eq(companies.orgId, org(c))).orderBy(asc(companies.name))));
  r.post("/companies", require("parametres.gerer"), zValidator("json", companyInput, validationHook), async (c) => {
    const b = c.req.valid("json");
    const [co] = await db.insert(companies).values({ orgId: org(c), name: b.name, address: b.address, taxId: b.tax_id, email: b.email, footer: b.footer, active: b.active }).returning();
    await audit(db, { orgId: org(c), userId: who(c), action: "create", entity: "company", entityId: co.id, after: co });
    touch(org(c));
    return c.json(co, 201);
  });
  r.put("/companies/:id", require("parametres.gerer"), zValidator("json", companyInput.partial(), validationHook), async (c) => {
    const id = c.req.param("id") ?? "", b = c.req.valid("json");
    const [before] = await db.select().from(companies).where(and(eq(companies.id, id), eq(companies.orgId, org(c))));
    if (!before) throw new HttpError(404, "company_not_found");
    const set: Partial<typeof companies.$inferInsert> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name;
    if (b.address !== undefined) set.address = b.address;
    if (b.tax_id !== undefined) set.taxId = b.tax_id;
    if (b.email !== undefined) set.email = b.email;
    if (b.footer !== undefined) set.footer = b.footer;
    if (b.active !== undefined) set.active = b.active;
    const [co] = await db.update(companies).set(set).where(eq(companies.id, id)).returning();
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "company", entityId: id, before, after: co });
    touch(org(c));
    return c.json(co);
  });
  /** Logo upload (JPEG or PNG, max 1 MB). Raw body. */
  r.put("/companies/:id/logo", require("parametres.gerer"), async (c) => {
    const id = c.req.param("id") ?? "";
    const [co] = await db.select().from(companies).where(and(eq(companies.id, id), eq(companies.orgId, org(c))));
    if (!co) throw new HttpError(404, "company_not_found");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > 1024 * 1024) throw new HttpError(400, "file_too_large");
    const info = imageInfo(bytes);
    if (!info || !info.width || !info.height) throw new HttpError(400, "file_type");
    if (co.logoKey && co.logoKey !== logoKey(org(c), id, info.kind)) await storage.delete(co.logoKey).catch(() => undefined);
    const key = logoKey(org(c), id, info.kind);
    await storage.put(key, bytes, info.kind === "png" ? "image/png" : "image/jpeg");
    await db.update(companies).set({ logoKey: key, logoMeta: info as never, updatedAt: new Date() }).where(eq(companies.id, id));
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "company_logo", entityId: id, after: info });
    touch(org(c));
    return c.json({ ok: true, logo: info });
  });
  r.delete("/companies/:id/logo", require("parametres.gerer"), async (c) => {
    const id = c.req.param("id") ?? "";
    const [co] = await db.select().from(companies).where(and(eq(companies.id, id), eq(companies.orgId, org(c))));
    if (!co) throw new HttpError(404, "company_not_found");
    if (co.logoKey) await storage.delete(co.logoKey).catch(() => undefined);
    await db.update(companies).set({ logoKey: null, logoMeta: null, updatedAt: new Date() }).where(eq(companies.id, id));
    touch(org(c));
    return c.json({ ok: true });
  });
  /** Any member of the organisation may download a letterhead logo (needed to build PDFs offline). */
  r.get("/companies/:id/logo", async (c) => {
    const [co] = await db.select().from(companies).where(and(eq(companies.id, c.req.param("id") ?? ""), eq(companies.orgId, org(c))));
    const f = co?.logoKey ? await storage.get(co.logoKey) : null;
    if (!f) throw new HttpError(404, "company_not_found");
    return new Response(f.bytes as BodyInit, { headers: { "content-type": f.contentType, "cache-control": "private, max-age=86400" } });
  });

  // ------------------------------------------------------------ technicians
  r.get("/technicians", require("parametres.gerer"), async (c) => c.json(await db.select().from(technicians).where(eq(technicians.orgId, org(c))).orderBy(asc(technicians.name))));
  const checkUser = async (orgId: string, userId: string | null) => {
    if (!userId) return;
    const [m] = await db.select({ u: users.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
    if (!m) throw new HttpError(404, "user_not_found");
  };
  r.post("/technicians", require("parametres.gerer"), zValidator("json", technicianInput, validationHook), async (c) => {
    const b = c.req.valid("json");
    await checkUser(org(c), b.user_id);
    const [t] = await db.insert(technicians).values({ orgId: org(c), name: b.name, userId: b.user_id, defaultPctPdr: String(b.default_pct_pdr), defaultPctDemontage: String(b.default_pct_demontage), kind: b.kind, email: b.email, active: b.active }).returning();
    await audit(db, { orgId: org(c), userId: who(c), action: "create", entity: "technician", entityId: t.id, after: t });
    touch(org(c));
    return c.json(t, 201);
  });
  r.put("/technicians/:id", require("parametres.gerer"), zValidator("json", technicianInput.partial(), validationHook), async (c) => {
    const id = c.req.param("id") ?? "", b = c.req.valid("json");
    const [before] = await db.select().from(technicians).where(and(eq(technicians.id, id), eq(technicians.orgId, org(c))));
    if (!before) throw new HttpError(404, "technician_not_found");
    if (b.user_id !== undefined) await checkUser(org(c), b.user_id);
    const set: Partial<typeof technicians.$inferInsert> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name;
    if (b.user_id !== undefined) set.userId = b.user_id;
    // changing a technician's default does NOT change vehicles that already carry their own copy of the percentage
    if (b.default_pct_pdr !== undefined) set.defaultPctPdr = String(b.default_pct_pdr);
    if (b.default_pct_demontage !== undefined) set.defaultPctDemontage = String(b.default_pct_demontage);
    if (b.kind !== undefined) set.kind = b.kind;
    if (b.email !== undefined) set.email = b.email;
    if (b.active !== undefined) set.active = b.active;
    const [t] = await db.update(technicians).set(set).where(eq(technicians.id, id)).returning();
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "technician", entityId: id, before, after: t });
    touch(org(c));
    return c.json(t);
  });

  // ------------------------------------------------------------ station recipients (pre-filled list) and calculation methods
  r.get("/stations/:id/recipients", require("stations.gerer"), async (c) => {
    const p = await stationRecipientPreview(db, c.req.param("id") ?? "", org(c));
    if (!p) throw new HttpError(404, "station_not_found");
    return c.json(p);
  });
  r.route("/", methodRoutes({ db, hub, require, validationHook }));

  return r;
}
