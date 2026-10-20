import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  acceptInviteInput, assignmentInput, inviteInput, passwordLoginInput, setPasswordInput, loginRequestInput, loginVerifyInput, refreshInput, roleInput, stationInput,
  PERMISSIONS, SYSTEM_ROLES, type Permission, errorMessage, pickLang, languageInput, settingsInput,
} from "@hagel/shared";
import { audit } from "./audit";
import {
  HttpError, acceptInvitation, authenticate, inviteUser, passwordLogin, setPassword, refreshSession, requestLogin, resendInvitation, revokeAllSessions, revokeSession, verifyLogin,
} from "./auth";
import type { Config } from "./config";
import type { Db } from "./db";
import type { Mailer } from "./email";
import type { Env } from "./env";
import { Hub } from "./hub";
import { canOrg, isMemberOfOrg, type Principal } from "./permissions";
import { syncRoutes } from "./routes_sync";
import { masterRoutes } from "./routes_master";
import { azureRoutes } from "./routes_azure";
import type { AzureSource } from "./azure";
import { seedCompanies } from "./companies_seed";
import { MemoryStorage, type Storage } from "./storage";
import type { FetchLike } from "./ocr";
import { loadPrincipal } from "./principal";
import { loadOrgSettings, visibleSettings, visibleStations } from "./sync";
import {
  auditLog, insurers, invitations, memberships, orgSettings, orgTenants, organizations, roleAssignments, roles, sessions, stations, users,
} from "./schema";

export interface Limits { requestLink: number; verify: number; accept: number; refresh: number; login: number }
export const DEFAULT_LIMITS: Limits = { requestLink: 5, verify: 20, accept: 20, refresh: 60, login: 60 };
export interface AppDeps {
  db: Db; cfg: Config; mailer: Mailer; limits?: Partial<Limits>;
  storage?: Storage; hub?: Hub; az?: AzureSource | null; ocr?: { apiKey: string | null; model: string; fetch: FetchLike };
}

/** Tiny in-memory fixed-window limiter (single instance). Replace with Redis if the API is scaled out. */
function rateLimit(max: number, windowMs: number, keyOf: (c: Context) => string): MiddlewareHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  return async (c, next) => {
    const k = keyOf(c), t = Date.now();
    const h = hits.get(k);
    if (!h || h.reset < t) hits.set(k, { n: 1, reset: t + windowMs });
    else if (++h.n > max) throw new HttpError(429, "too_many_requests");
    if (hits.size > 5000) for (const [kk, v] of hits) if (v.reset < t) hits.delete(kk);
    await next();
  };
}

/**
 * Client address behind Railway's proxy. The proxy appends the real client to X-Forwarded-For, so the LAST entry is the trustworthy one
 * (the first can be written by the client); X-Real-IP, when present, is set by the proxy as well.
 */
const ip = (c: Context) => c.req.header("x-real-ip")?.trim() || c.req.header("x-forwarded-for")?.split(",").pop()?.trim() || "local";

export function createApp({ db, cfg, mailer, limits: lim, storage = new MemoryStorage(), hub = new Hub(), az = null, ocr }: AppDeps) {
  const L = { ...DEFAULT_LIMITS, ...lim };
  const app = new Hono<Env>();

  const langOf = (c: Context) => pickLang(c.req.header("x-lang"), c.req.header("accept-language"));
  app.onError((err, c) => {
    const lang = langOf(c);
    if (err instanceof HttpError) return c.json({ error: errorMessage(err.code, lang, err.params), code: err.code }, err.status);
    console.error(err);
    return c.json({ error: errorMessage("internal", lang), code: "internal" }, 500);
  });
  // schema validation failures: same shape, localized
  const validationHook = (r: { success: boolean }, c: Context) =>
    r.success ? undefined : c.json({ error: errorMessage("invalid_input", langOf(c)), code: "invalid_input" }, 400);

  app.get("/health", async (c) => {
    await db.execute(sql`select 1`);
    return c.json({ ok: true });
  });

  // ---------- auth (public) ----------
  const auth = new Hono<Env>();
  auth.post("/request-link", rateLimit(L.requestLink, 15 * 60_000, ip), zValidator("json", loginRequestInput, validationHook), async (c) => {
    await requestLogin(db, cfg, mailer, c.req.valid("json").email);
    return c.json({ ok: true }); // always the same answer
  });
  auth.post("/verify", rateLimit(L.verify, 15 * 60_000, ip), zValidator("json", loginVerifyInput, validationHook), async (c) => {
    const b = c.req.valid("json");
    return c.json(await verifyLogin(db, cfg, b.token, b.device));
  });
  auth.post("/accept-invite", rateLimit(L.accept, 15 * 60_000, ip), zValidator("json", acceptInviteInput, validationHook), async (c) => {
    const b = c.req.valid("json");
    return c.json(await acceptInvitation(db, cfg, b.token, b.name, b.language ?? "", c.req.header("user-agent") ?? "", b.password));
  });
  // per address 60 / 15 min; each account additionally locks after 10 wrong passwords (see passwordLogin)
  auth.post("/login", rateLimit(L.login, 15 * 60_000, ip), zValidator("json", passwordLoginInput, validationHook), async (c) => {
    const b = c.req.valid("json");
    return c.json(await passwordLogin(db, cfg, b.email, b.password, b.device));
  });
  auth.post("/refresh", rateLimit(L.refresh, 15 * 60_000, ip), zValidator("json", refreshInput, validationHook), async (c) => {
    return c.json(await refreshSession(db, cfg, c.req.valid("json").refresh_token));
  });
  app.route("/auth", auth);

  // ---------- authenticated ----------
  const needAuth: MiddlewareHandler<Env> = async (c, next) => {
    const h = c.req.header("authorization") ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const a = token ? await authenticate(db, cfg, token) : null;
    if (!a) throw new HttpError(401, "not_authenticated");
    const principal = await loadPrincipal(db, a.userId);
    if (!principal || principal.status !== "active") throw new HttpError(401, "not_authenticated");
    c.set("principal", principal);
    c.set("sessionId", a.sessionId);
    await next();
  };

  /** Organisation context: X-Org-Id header, must be one the user belongs to. */
  const needOrg: MiddlewareHandler<Env> = async (c, next) => {
    const orgId = c.req.header("x-org-id") ?? "";
    if (!z.string().uuid().safeParse(orgId).success) throw new HttpError(400, "org_header_missing");
    if (!isMemberOfOrg(c.get("principal"), orgId)) throw new HttpError(403, "no_access");
    c.set("orgId", orgId);
    await next();
  };

  const require = (perm: Permission): MiddlewareHandler<Env> => async (c, next) => {
    if (!canOrg(c.get("principal"), perm, c.get("orgId"))) throw new HttpError(403, "forbidden");
    await next();
  };

  const requireSuper: MiddlewareHandler<Env> = async (c, next) => {
    if (!c.get("principal").isSuperadmin) throw new HttpError(403, "superadmin_only");
    await next();
  };

  /** Org-wide permission set of a principal (used to stop privilege escalation). */
  const heldPermissions = (p: Principal, orgId: string): Set<string> => {
    if (p.isSuperadmin) return new Set(PERMISSIONS);
    const s = new Set<string>();
    p.grants.filter((g) => g.orgId === orgId && g.stationId === null && (!g.expiresAt || g.expiresAt > new Date())).forEach((g) => g.permissions.forEach((x) => s.add(x)));
    return s;
  };
  /** You may only hand out permissions you hold yourself. */
  const assertCanGrant = (p: Principal, orgId: string, perms: readonly string[]) => {
    if (p.isSuperadmin) return;
    const held = heldPermissions(p, orgId);
    const missing = perms.filter((x) => !held.has(x));
    if (missing.length) throw new HttpError(403, "cannot_grant", { missing: missing.join(", ") });
  };

  const me = new Hono<Env>();
  me.use("*", needAuth);
  me.get("/", async (c) => {
    const p = c.get("principal");
    const [u] = await db.select().from(users).where(eq(users.id, p.id));
    const orgRows = p.isSuperadmin
      ? await db.select().from(organizations)
      : await db.select({ o: organizations }).from(memberships).innerJoin(organizations, eq(organizations.id, memberships.orgId)).where(eq(memberships.userId, p.id)).then((r) => r.map((x) => x.o));
    return c.json({
      user: { id: u.id, email: u.email, name: u.name, language: u.language, isSuperadmin: u.isSuperadmin },
      organizations: orgRows.map((o) => ({ id: o.id, name: o.name, country: o.country })),
      grants: p.grants,
    });
  });
  me.get("/sessions", async (c) => {
    const rows = await db.select().from(sessions).where(eq(sessions.userId, c.get("principal").id)).orderBy(desc(sessions.createdAt));
    return c.json(rows.map((s) => ({ id: s.id, device: s.device, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, revoked: !!s.revokedAt, current: s.id === c.get("sessionId") })));
  });
  me.put("/language", zValidator("json", languageInput, validationHook), async (c) => {
    await db.update(users).set({ language: c.req.valid("json").language, updatedAt: new Date() }).where(eq(users.id, c.get("principal").id));
    return c.json({ ok: true });
  });
  me.get("/password", async (c) => {
    const [u] = await db.select({ h: users.passwordHash }).from(users).where(eq(users.id, c.get("principal").id));
    return c.json({ set: !!u?.h });
  });
  me.put("/password", rateLimit(L.verify, 15 * 60_000, ip), zValidator("json", setPasswordInput, validationHook), async (c) => {
    const b = c.req.valid("json");
    await setPassword(db, c.get("principal").id, c.get("sessionId"), b.password, b.current_password);
    return c.json({ ok: true });
  });
  me.post("/logout", async (c) => { await revokeSession(db, c.get("sessionId")); return c.json({ ok: true }); });
  me.post("/logout-all", async (c) => { await revokeAllSessions(db, c.get("principal").id); return c.json({ ok: true }); });
  app.route("/me", me);

  // ---------- sync, files, OCR ----------
  app.route("/", syncRoutes({ db, hub, storage, mailer, needAuth, needOrg, ocr, validationHook }));

  app.route("/", azureRoutes({ db, hub, storage, az, needAuth, needOrg, validationHook }));

  // ---------- admin ----------
  const admin = new Hono<Env>();
  admin.use("*", needAuth);

  // organisations (super-admin)
  admin.get("/orgs", requireSuper, async (c) => c.json(await db.select().from(organizations)));
  admin.post("/orgs", requireSuper, zValidator("json", z.object({ name: z.string().trim().min(1).max(120), country: z.enum(["DE", "ES"]).default("DE") }), validationHook), async (c) => {
    const b = c.req.valid("json");
    const [o] = await db.insert(organizations).values(b).returning();
    await seedRoles(db, o.id);
    await seedCompanies(db, storage, o.id);
    await audit(db, { orgId: o.id, userId: c.get("principal").id, action: "create", entity: "organization", entityId: o.id, after: o });
    return c.json(o, 201);
  });
  admin.get("/orgs/:id/tenants", requireSuper, async (c) => c.json((await db.select().from(orgTenants).where(eq(orgTenants.orgId, c.req.param("id")))).map((t) => t.azureTenant)));
  admin.put("/orgs/:id/tenants", requireSuper, zValidator("json", z.object({ tenants: z.array(z.string().trim().min(1).max(120)).max(200) }), validationHook), async (c) => {
    const orgId = c.req.param("id") ?? "";
    const before = (await db.select().from(orgTenants).where(eq(orgTenants.orgId, orgId))).map((t) => t.azureTenant);
    const tenants = [...new Set(c.req.valid("json").tenants)];
    await db.transaction(async (tx) => {
      await tx.delete(orgTenants).where(eq(orgTenants.orgId, orgId));
      if (tenants.length) await tx.insert(orgTenants).values(tenants.map((t) => ({ orgId, azureTenant: t })));
    });
    await audit(db, { orgId, userId: c.get("principal").id, action: "update", entity: "org_tenants", before, after: tenants });
    return c.json({ tenants });
  });

  const org = new Hono<Env>();
  org.use("*", needOrg);

  // users
  org.get("/users", require("utilisateurs.gerer"), async (c) => {
    const orgId = c.get("orgId");
    const rows = await db
      .select({ u: users, a: roleAssignments, r: roles })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(roleAssignments, and(eq(roleAssignments.userId, users.id), eq(roleAssignments.orgId, orgId)))
      .leftJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(eq(memberships.orgId, orgId));
    const byUser = new Map<string, { id: string; email: string; name: string; status: string; isSuperadmin: boolean; assignments: unknown[] }>();
    for (const { u, a, r } of rows) {
      const e = byUser.get(u.id) ?? { id: u.id, email: u.email, name: u.name, status: u.status, isSuperadmin: u.isSuperadmin, assignments: [] };
      if (a && r) e.assignments.push({ id: a.id, stationId: a.stationId, roleId: r.id, roleName: r.name, roleKey: r.key, scope: r.scope, expiresAt: a.expiresAt, scopeClientStationId: a.scopeClientStationId, scopeInsurerId: a.scopeInsurerId, scopeCampaignId: a.scopeCampaignId });
      byUser.set(u.id, e);
    }
    return c.json([...byUser.values()]);
  });

  org.get("/invitations", require("utilisateurs.gerer"), async (c) => {
    const rows = await db.select().from(invitations).where(and(eq(invitations.orgId, c.get("orgId")), sql`${invitations.usedAt} is null`)).orderBy(desc(invitations.createdAt));
    return c.json(rows.map(({ tokenHash: _t, ...r }) => r));
  });
  org.post("/invitations", require("utilisateurs.gerer"), zValidator("json", inviteInput, validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId"), p = c.get("principal");
    const [role] = await db.select().from(roles).where(and(eq(roles.id, b.role_id), eq(roles.orgId, orgId)));
    if (!role) throw new HttpError(404, "role_not_found");
    assertCanGrant(p, orgId, role.permissions);
    if (b.station_id) await assertStationInOrg(b.station_id, orgId);
    await assertScopeFields(role.scope, b, orgId);
    const r = await inviteUser(db, cfg, mailer, {
      orgId, email: b.email, roleId: b.role_id, stationId: b.station_id, scopeClientStationId: b.scope_client_station_id,
      scopeInsurerId: b.scope_insurer_id, scopeCampaignId: b.scope_campaign_id,
      assignmentExpiresAt: b.expires_at ? new Date(b.expires_at) : null, invitedBy: p.id, language: b.language,
    });
    return c.json(r, 201);
  });
  org.post("/invitations/:id/resend", require("utilisateurs.gerer"), async (c) => {
    await resendInvitation(db, cfg, mailer, c.req.param("id"), c.get("orgId"));
    return c.json({ ok: true });
  });
  org.delete("/invitations/:id", require("utilisateurs.gerer"), async (c) => {
    const orgId = c.get("orgId");
    const del = await db.delete(invitations).where(and(eq(invitations.id, c.req.param("id")), eq(invitations.orgId, orgId), sql`${invitations.usedAt} is null`)).returning();
    if (!del.length) throw new HttpError(404, "invitation_not_found");
    await audit(db, { orgId, userId: c.get("principal").id, action: "revoke", entity: "invitation", entityId: del[0].id, before: { email: del[0].email } });
    return c.json({ ok: true });
  });

  const memberOrFail = async (userId: string, orgId: string) => {
    const [row] = await db.select({ u: users }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
    if (!row) throw new HttpError(404, "user_not_found");
    return row.u;
  };
  const setStatus = (status: "disabled" | "active") => async (c: Context<Env>) => {
    const orgId = c.get("orgId"), uid = c.req.param("id") ?? "";
    const u = await memberOrFail(uid, orgId);
    if (u.isSuperadmin) throw new HttpError(403, "superadmin_undeactivatable");
    if (u.id === c.get("principal").id) throw new HttpError(403, "self_deactivate");
    await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, u.id));
    if (status === "disabled") await revokeAllSessions(db, u.id);
    await audit(db, { orgId, userId: c.get("principal").id, action: status === "disabled" ? "deactivate" : "reactivate", entity: "user", entityId: u.id, before: { status: u.status }, after: { status } });
    return c.json({ ok: true });
  };
  org.post("/users/:id/deactivate", require("utilisateurs.gerer"), setStatus("disabled"));
  org.post("/users/:id/reactivate", require("utilisateurs.gerer"), setStatus("active"));
  org.post("/users/:id/revoke-sessions", require("utilisateurs.gerer"), async (c) => {
    const u = await memberOrFail(c.req.param("id"), c.get("orgId"));
    await revokeAllSessions(db, u.id);
    await audit(db, { orgId: c.get("orgId"), userId: c.get("principal").id, action: "revoke_sessions", entity: "user", entityId: u.id });
    return c.json({ ok: true });
  });

  // role assignments
  org.post("/assignments", require("utilisateurs.gerer"), zValidator("json", assignmentInput, validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId"), p = c.get("principal");
    await memberOrFail(b.user_id, orgId);
    const [role] = await db.select().from(roles).where(and(eq(roles.id, b.role_id), eq(roles.orgId, orgId)));
    if (!role) throw new HttpError(404, "role_not_found");
    assertCanGrant(p, orgId, role.permissions);
    if (b.station_id) await assertStationInOrg(b.station_id, orgId);
    await assertScopeFields(role.scope, b, orgId);
    const [a] = await db.insert(roleAssignments).values({
      userId: b.user_id, orgId, roleId: b.role_id, stationId: b.station_id, scopeClientStationId: b.scope_client_station_id,
      scopeInsurerId: b.scope_insurer_id, scopeCampaignId: b.scope_campaign_id, expiresAt: b.expires_at ? new Date(b.expires_at) : null,
    }).returning();
    await audit(db, { orgId, userId: p.id, action: "assign_role", entity: "role_assignment", entityId: a.id, after: a });
    return c.json(a, 201);
  });
  org.delete("/assignments/:id", require("utilisateurs.gerer"), async (c) => {
    const orgId = c.get("orgId");
    const [a] = await db.select({ a: roleAssignments, r: roles }).from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.id, c.req.param("id")), eq(roleAssignments.orgId, orgId)));
    if (!a) throw new HttpError(404, "assignment_not_found");
    assertCanGrant(c.get("principal"), orgId, a.r.permissions); // you cannot strip rights you could not grant
    await db.delete(roleAssignments).where(eq(roleAssignments.id, a.a.id));
    await audit(db, { orgId, userId: c.get("principal").id, action: "unassign_role", entity: "role_assignment", entityId: a.a.id, before: a.a });
    return c.json({ ok: true });
  });

  // roles
  org.get("/roles", require("roles.gerer"), async (c) => c.json(await db.select().from(roles).where(eq(roles.orgId, c.get("orgId"))).orderBy(roles.name)));
  // role list needed by the invite dialog: readable with utilisateurs.gerer too (names only)
  org.get("/roles-lite", require("utilisateurs.gerer"), async (c) => {
    const rows = await db.select().from(roles).where(eq(roles.orgId, c.get("orgId"))).orderBy(roles.name);
    return c.json(rows.map((r) => ({ id: r.id, name: r.name, key: r.key, scope: r.scope })));
  });
  org.post("/roles", require("roles.gerer"), zValidator("json", roleInput, validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId");
    assertCanGrant(c.get("principal"), orgId, b.permissions);
    const [r] = await db.insert(roles).values({ orgId, name: b.name, description: b.description, scope: b.scope, permissions: [...new Set(b.permissions)] }).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "create", entity: "role", entityId: r.id, after: r });
    return c.json(r, 201);
  });
  org.put("/roles/:id", require("roles.gerer"), zValidator("json", roleInput, validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId");
    const [before] = await db.select().from(roles).where(and(eq(roles.id, (c.req.param("id") ?? "")), eq(roles.orgId, orgId)));
    if (!before) throw new HttpError(404, "role_not_found");
    // changing a role changes everyone who has it: may add only what you hold; may remove only what you could grant
    assertCanGrant(c.get("principal"), orgId, [...new Set([...b.permissions, ...before.permissions])]);
    const [r] = await db.update(roles).set({ name: b.name, description: b.description, scope: b.scope, permissions: [...new Set(b.permissions)], updatedAt: new Date() }).where(eq(roles.id, before.id)).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "update", entity: "role", entityId: r.id, before, after: r });
    return c.json(r);
  });
  org.delete("/roles/:id", require("roles.gerer"), async (c) => {
    const orgId = c.get("orgId");
    const [r] = await db.select().from(roles).where(and(eq(roles.id, c.req.param("id")), eq(roles.orgId, orgId)));
    if (!r) throw new HttpError(404, "role_not_found");
    if (r.isSystem) throw new HttpError(409, "system_role_undeletable");
    const used = await db.select({ n: sql<number>`count(*)::int` }).from(roleAssignments).where(eq(roleAssignments.roleId, r.id));
    const inv = await db.select({ n: sql<number>`count(*)::int` }).from(invitations).where(and(eq(invitations.roleId, r.id), sql`${invitations.usedAt} is null`));
    if (used[0].n || inv[0].n) throw new HttpError(409, "role_in_use");
    await db.delete(roles).where(eq(roles.id, r.id));
    await audit(db, { orgId, userId: c.get("principal").id, action: "delete", entity: "role", entityId: r.id, before: r });
    return c.json({ ok: true });
  });

  // stations (sites)
  org.get("/stations", async (c) => {
    // managers get everything; other members only the sites they may know, without commission / report e-mails / Azure ids
    const orgId = c.get("orgId"), u = c.get("principal");
    if (canOrg(u, "stations.gerer", orgId)) return c.json(await db.select().from(stations).where(eq(stations.orgId, orgId)).orderBy(stations.name));
    return c.json((await visibleStations(db, u, orgId)).map((x) => ({ id: x.id, type: x.type, name: x.name, country: x.country, capacite: x.capacite, active: x.active })));
  });
  const checkTenant = async (orgId: string, tenant: string | null, creating: boolean) => {
    const allowed = (await db.select().from(orgTenants).where(eq(orgTenants.orgId, orgId))).map((t) => t.azureTenant);
    // Azure tenants are only known from phase 5; until the super-admin assigns tenants to the org, a site may have none.
    if (!allowed.length) return;
    if (!tenant) { if (creating) throw new HttpError(400, "tenant_required"); return; }
    if (!allowed.includes(tenant)) throw new HttpError(400, "tenant_not_allowed");
  };
  /** Customers of a site: the list wins; the single legacy field still works (and null clears it). */
  const bcIdsOf = (b: { azure_business_customer_ids?: string[]; azure_business_customer_id?: string | null }): string[] =>
    b.azure_business_customer_ids?.length ? [...new Set(b.azure_business_customer_ids)] : b.azure_business_customer_id ? [b.azure_business_customer_id] : [];
  org.post("/stations", require("stations.gerer"), zValidator("json", stationInput, validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId");
    await checkTenant(orgId, b.azure_tenant, true);
    const [s] = await db.insert(stations).values({
      orgId, type: b.type, name: b.name, address: b.address, country: b.country, capacite: b.capacite, azureTenant: b.azure_tenant,
      azureLocationAliases: b.azure_location_aliases, azureBusinessCustomerId: b.type === "carrosserie" ? bcIdsOf(b)[0] ?? null : null, azureBcIds: b.type === "carrosserie" ? bcIdsOf(b) : [],
      azureLinkIds: b.type === "carrosserie" ? b.azure_link_ids : [],
      reportEmails: b.type === "carrosserie" ? b.report_emails : [], commissionMode: b.commission_mode, commissionPct: String(b.commission_pct),
    }).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "create", entity: "station", entityId: s.id, after: s });
    return c.json(s, 201);
  });
  org.put("/stations/:id", require("stations.gerer"), zValidator("json", stationInput.partial(), validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId");
    const [before] = await db.select().from(stations).where(and(eq(stations.id, (c.req.param("id") ?? "")), eq(stations.orgId, orgId)));
    if (!before) throw new HttpError(404, "station_not_found");
    if (b.azure_tenant !== undefined && b.azure_tenant !== before.azureTenant) await checkTenant(orgId, b.azure_tenant, true);
    const set: Partial<typeof stations.$inferInsert> = { updatedAt: new Date() };
    if (b.type !== undefined) set.type = b.type;
    if (b.name !== undefined) set.name = b.name;
    if (b.address !== undefined) set.address = b.address;
    if (b.country !== undefined) set.country = b.country;
    if (b.capacite !== undefined) set.capacite = b.capacite;
    if (b.azure_tenant !== undefined) set.azureTenant = b.azure_tenant;
    if (b.azure_location_aliases !== undefined) set.azureLocationAliases = b.azure_location_aliases;
    if (b.azure_business_customer_ids !== undefined || b.azure_business_customer_id !== undefined) {
      const ids = bcIdsOf(b);
      set.azureBcIds = ids; set.azureBusinessCustomerId = ids[0] ?? null;
    }
    if (b.azure_link_ids !== undefined) set.azureLinkIds = b.azure_link_ids;
    if (b.report_emails !== undefined) set.reportEmails = b.report_emails;
    if (b.commission_mode !== undefined) set.commissionMode = b.commission_mode;
    if (b.commission_pct !== undefined) set.commissionPct = String(b.commission_pct);
    const [s] = await db.update(stations).set(set).where(eq(stations.id, before.id)).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "update", entity: "station", entityId: s.id, before, after: s });
    return c.json(s);
  });
  org.post("/stations/:id/active", require("stations.gerer"), zValidator("json", z.object({ active: z.boolean() }), validationHook), async (c) => {
    const orgId = c.get("orgId");
    const [s] = await db.update(stations).set({ active: c.req.valid("json").active, updatedAt: new Date() }).where(and(eq(stations.id, (c.req.param("id") ?? "")), eq(stations.orgId, orgId))).returning();
    if (!s) throw new HttpError(404, "station_not_found");
    await audit(db, { orgId, userId: c.get("principal").id, action: s.active ? "reactivate" : "deactivate", entity: "station", entityId: s.id });
    return c.json(s);
  });

  org.get("/tenants", async (c) => c.json((await db.select().from(orgTenants).where(eq(orgTenants.orgId, c.get("orgId")))).map((t) => t.azureTenant)));

  // audit log
  org.get("/audit", require("audit.voir"), zValidator("query", z.object({ entity: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), validationHook), async (c) => {
    const q = c.req.valid("query"), orgId = c.get("orgId");
    const rows = await db.select().from(auditLog).where(q.entity ? and(eq(auditLog.orgId, orgId), eq(auditLog.entity, q.entity)) : eq(auditLog.orgId, orgId)).orderBy(desc(auditLog.at)).limit(q.limit);
    return c.json(rows);
  });

  // organisation settings (rates, default Teiler, editable Spain matrix)
  org.get("/settings", async (c) => c.json(visibleSettings(c.get("principal"), c.get("orgId"), await loadOrgSettings(db, c.get("orgId")))));
  org.put("/settings", require("parametres.gerer"), zValidator("json", settingsInput, validationHook), async (c) => {
    const orgId = c.get("orgId"), b = c.req.valid("json");
    const before = await loadOrgSettings(db, orgId);
    const next: Record<string, unknown> = { ...before, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
    if (b.esMatrix === null) delete next.esMatrix;
    await db.insert(orgSettings).values({ orgId, settings: next as never }).onConflictDoUpdate({ target: orgSettings.orgId, set: { settings: next as never, updatedAt: new Date() } });
    await audit(db, { orgId, userId: c.get("principal").id, action: "update", entity: "settings", before, after: next });
    hub.publish(orgId, 0);
    return c.json(next);
  });

  org.get("/permissions", (c) => c.json({ permissions: PERMISSIONS }));

  org.route("/", masterRoutes({ db, hub, storage, require, validationHook }));
  admin.route("/", org);
  app.route("/admin", admin);

  async function assertStationInOrg(stationId: string, orgId: string) {
    const [s] = await db.select({ id: stations.id }).from(stations).where(and(eq(stations.id, stationId), eq(stations.orgId, orgId)));
    if (!s) throw new HttpError(400, "station_wrong_org");
  }
  /** Scope ids must exist in this org and be present when the role's scope needs them. */
  async function assertScopeFields(scope: string, b: { scope_client_station_id: string | null; scope_insurer_id: string | null; scope_campaign_id: string | null }, orgId: string) {
    if (scope === "client") {
      if (!b.scope_client_station_id) throw new HttpError(400, "client_required");
      await assertStationInOrg(b.scope_client_station_id, orgId);
    }
    if (scope === "assurance") {
      if (!b.scope_insurer_id) throw new HttpError(400, "insurer_required");
      const [i] = await db.select({ id: insurers.id }).from(insurers).where(and(eq(insurers.id, b.scope_insurer_id), eq(insurers.orgId, orgId)));
      if (!i) throw new HttpError(400, "insurer_wrong_org");
    }
    if (scope === "campagne" && !b.scope_campaign_id) throw new HttpError(400, "campaign_required");
  }

  return app;
}

/** Inserts the default roles of an organisation (idempotent by key). */
export async function seedRoles(db: Db, orgId: string) {
  const existing = await db.select().from(roles).where(and(eq(roles.orgId, orgId), inArray(roles.key, SYSTEM_ROLES.map((r) => r.key))));
  const have = new Set(existing.map((r) => r.key));
  for (const r of SYSTEM_ROLES) {
    if (have.has(r.key)) continue;
    await db.insert(roles).values({ orgId, key: r.key, name: r.name, description: r.description, scope: r.scope, permissions: r.permissions, isSystem: true });
  }
}
