import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, isNull, or, sql, isNotNull, ne } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  assignmentInput, bodyshopInput, inviteInput, placeInput, roleInput,
  PERMISSIONS, SYSTEM_ROLES, type Permission, languageInput, settingsInput,
} from "@hagel/shared";
import { audit } from "../../audit";
import {
  HttpError, inviteUser, resendInvitation, revokeAllSessions,
} from "../auth/auth";
import type { Config } from "../../config";
import type { Db } from "../../db";
import type { Mailer } from "../../email";
import { runMailTest } from "../reports/mail_test";
import type { Env } from "../../env";
import type { Hub } from "../../hub";
import { canOrg, hasOrgPermission, type Principal } from "../../permissions";
import { bumpSystemMatrix, seedMethods } from "./methods";
import { masterRoutes } from "./master_routes";
import { partsAdminRoutes } from "../parts/admin";
import { seedCompanies } from "./companies_seed";
import type { Storage } from "../../storage";
import { loadOrgSettings, occupancyOf, visibleSettings, visibleStations } from "../vehicles/sync";
import {
  auditLog, campaignStations, citasLinks, insurers, invitations, repairBookings, stationInsurers, vehicles, memberships, orgSettings, orgTenants, organizations, roleAssignments, roles, stations, technicians, users,
} from "../../schema";

export interface AdminRouteDeps {
  db: Db; cfg: Config; mailer: Mailer; hub: Hub; storage: Storage;
  needAuth: MiddlewareHandler<Env>;
  needOrg: MiddlewareHandler<Env>;
  require: (perm: Permission) => MiddlewareHandler<Env>;
  requireSuper: MiddlewareHandler<Env>;
  validationHook: (r: { success: boolean }, c: Context) => Response | undefined;
}

/** Org admin + super-admin CRUD, mounted at /admin. */
export function adminRoutes({ db, cfg, mailer, hub, storage, needAuth, needOrg, require, requireSuper, validationHook }: AdminRouteDeps) {
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

  // ---------- admin ----------
  const admin = new Hono<Env>();
  admin.use("*", needAuth);

  // test mail through the configured mailer (so MAIL_MODE applies); always addressed to the calling super-admin
  admin.post("/mail-test", requireSuper, zValidator("json", z.object({ withAttachment: z.enum(["none", "small", "large", "xlarge"]).default("none"), replyTo: z.string().trim().toLowerCase().email().max(200).optional() }), validationHook), async (c) => {
    const b = c.req.valid("json"), p = c.get("principal");
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, p.id));
    const r = await runMailTest(mailer, cfg.emailProvider, { to: u.email, withAttachment: b.withAttachment, replyTo: b.replyTo });
    await audit(db, { userId: p.id, action: "mail_test", entity: "mail", after: { provider: r.provider, attachment: b.withAttachment, replyTo: b.replyTo ?? null, ok: r.ok, ms: r.ms, error: r.error ?? null } });
    return c.json(r);
  });

  // organisations (super-admin)
  admin.get("/orgs", requireSuper, async (c) => c.json(await db.select().from(organizations)));
  admin.post("/orgs", requireSuper, zValidator("json", z.object({ name: z.string().trim().min(1).max(120), country: z.enum(["DE", "ES"]).default("DE") }), validationHook), async (c) => {
    const b = c.req.valid("json");
    const [o] = await db.insert(organizations).values(b).returning();
    await seedRoles(db, o.id);
    await seedMethods(db, o.id);
    await seedCompanies(db, storage, o.id);
    await audit(db, { orgId: o.id, userId: c.get("principal").id, action: "create", entity: "organization", entityId: o.id, after: o });
    return c.json(o, 201);
  });
  admin.put("/orgs/:id/contact", requireSuper, zValidator("json", z.object({ contact_email: z.string().trim().toLowerCase().email().max(200).nullable() }), validationHook), async (c) => {
    const orgId = c.req.param("id") ?? "";
    const [o0] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!o0) throw new HttpError(400, "invalid_input");
    const [o] = await db.update(organizations).set({ contactEmail: c.req.valid("json").contact_email, updatedAt: new Date() }).where(eq(organizations.id, orgId)).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "update", entity: "organization", entityId: orgId, before: { contactEmail: o0.contactEmail }, after: { contactEmail: o.contactEmail } });
    return c.json({ contactEmail: o.contactEmail });
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
      .select({ u: users, a: roleAssignments, r: roles, m: memberships.replyMode })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(roleAssignments, and(eq(roleAssignments.userId, users.id), eq(roleAssignments.orgId, orgId)))
      .leftJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(eq(memberships.orgId, orgId));
    const byUser = new Map<string, { id: string; email: string; name: string; status: string; isSuperadmin: boolean; replyMode: string | null; assignments: unknown[] }>();
    for (const { u, a, r, m } of rows) {
      const e = byUser.get(u.id) ?? { id: u.id, email: u.email, name: u.name, status: u.status, isSuperadmin: u.isSuperadmin, replyMode: m, assignments: [] };
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
      assignmentExpiresAt: b.expires_at ? new Date(b.expires_at) : null, invitedBy: p.id, language: b.language, technicianKind: b.technician_kind,
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
  org.put("/users/:id", require("utilisateurs.gerer"), zValidator("json", z.object({ name: z.string().trim().min(1).max(120).optional(), language: languageInput.shape.language.optional(), reply_mode: z.enum(["contact", "own"]).nullable().optional() }), validationHook), async (c) => {
    const orgId = c.get("orgId"), b = c.req.valid("json");
    const u = await memberOrFail(c.req.param("id") ?? "", orgId);
    if (u.status === "deleted") throw new HttpError(404, "user_not_found");
    const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name;
    if (b.language !== undefined) set.language = b.language;
    const [n] = await db.update(users).set(set).where(eq(users.id, u.id)).returning();
    let replyChange: { before: string | null; after: string | null } | null = null;
    if (b.reply_mode !== undefined) {
      const [m0] = await db.select({ mode: memberships.replyMode }).from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.orgId, orgId)));
      if ((m0?.mode ?? null) !== b.reply_mode) {
        await db.update(memberships).set({ replyMode: b.reply_mode }).where(and(eq(memberships.userId, u.id), eq(memberships.orgId, orgId)));
        replyChange = { before: m0?.mode ?? null, after: b.reply_mode };
      }
    }
    await audit(db, { orgId, userId: c.get("principal").id, action: "update", entity: "user", entityId: u.id, before: { name: u.name, language: u.language, ...(replyChange ? { replyMode: replyChange.before } : {}) }, after: { name: n.name, language: n.language, ...(replyChange ? { replyMode: replyChange.after } : {}) } });
    return c.json({ ok: true });
  });
  /**
   * Delete a user: gone from the organisation (no more roles, no login, sessions revoked, pending invitations withdrawn). The row stays
   * (anonymised when it was the user's only organisation) because vehicles, history and the audit log point at it: they then read "Gelöschter Benutzer".
   */
  org.delete("/users/:id", require("utilisateurs.gerer"), async (c) => {
    const orgId = c.get("orgId"), p = c.get("principal");
    const u = await memberOrFail(c.req.param("id") ?? "", orgId);
    if (u.isSuperadmin) throw new HttpError(403, "superadmin_undeletable");
    if (u.id === p.id) throw new HttpError(403, "self_delete");
    const held = await db.select({ r: roles }).from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId)).where(and(eq(roleAssignments.userId, u.id), eq(roleAssignments.orgId, orgId)));
    for (const { r } of held) assertCanGrant(p, orgId, r.permissions); // you cannot remove someone who holds more than you could give
    const email = u.email;
    await db.transaction(async (tx) => {
      await tx.delete(roleAssignments).where(and(eq(roleAssignments.userId, u.id), eq(roleAssignments.orgId, orgId)));
      await tx.delete(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.orgId, orgId)));
      await tx.delete(invitations).where(and(eq(invitations.orgId, orgId), eq(invitations.email, email), sql`${invitations.usedAt} is null`));
      await tx.update(technicians).set({ userId: null, updatedAt: new Date() }).where(and(eq(technicians.orgId, orgId), eq(technicians.userId, u.id)));
      const [other] = await tx.select({ n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.userId, u.id));
      if (!other.n) await tx.update(users).set({ status: "deleted", email: `deleted-${u.id}@deleted.invalid`, name: "Gelöschter Benutzer", passwordHash: null, updatedAt: new Date() }).where(eq(users.id, u.id));
    });
    await revokeAllSessions(db, u.id);
    await audit(db, { orgId, userId: p.id, action: "delete", entity: "user", entityId: u.id, before: { email, name: u.name, roles: held.map((x) => x.r.name) } });
    return c.json({ ok: true });
  });
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
  // change the role and/or the station of an assignment. The station is a place (hall), never a body shop: with a place the account sees every
  // car that is at this place whatever its body shop; no place = all places.
  org.put("/assignments/:id", require("utilisateurs.gerer"), zValidator("json", z.object({
    role_id: z.string().uuid(), station_id: z.string().uuid().nullable().default(null),
    scope_client_station_id: z.string().uuid().nullable().optional(), scope_insurer_id: z.string().uuid().nullable().optional(), scope_campaign_id: z.string().uuid().nullable().optional(),
  }), validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId"), p = c.get("principal");
    const [cur] = await db.select({ a: roleAssignments, r: roles }).from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.id, c.req.param("id") ?? ""), eq(roleAssignments.orgId, orgId)));
    if (!cur) throw new HttpError(404, "assignment_not_found");
    const [role] = await db.select().from(roles).where(and(eq(roles.id, b.role_id), eq(roles.orgId, orgId)));
    if (!role) throw new HttpError(404, "role_not_found");
    assertCanGrant(p, orgId, cur.r.permissions); // you cannot change what you could not remove...
    assertCanGrant(p, orgId, role.permissions); // ...nor give a role you could not give
    if (b.station_id) await assertStationInOrg(b.station_id, orgId);
    const scopes = {
      scope_client_station_id: b.scope_client_station_id === undefined ? cur.a.scopeClientStationId : b.scope_client_station_id,
      scope_insurer_id: b.scope_insurer_id === undefined ? cur.a.scopeInsurerId : b.scope_insurer_id,
      scope_campaign_id: b.scope_campaign_id === undefined ? cur.a.scopeCampaignId : b.scope_campaign_id,
    };
    await assertScopeFields(role.scope, scopes, orgId);
    const [a] = await db.update(roleAssignments).set({
      roleId: role.id, stationId: b.station_id, scopeClientStationId: scopes.scope_client_station_id, scopeInsurerId: scopes.scope_insurer_id, scopeCampaignId: scopes.scope_campaign_id,
    }).where(eq(roleAssignments.id, cur.a.id)).returning();
    await audit(db, { orgId, userId: p.id, action: "update_assignment", entity: "role_assignment", entityId: a.id, before: cur.a, after: a });
    return c.json(a);
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
    const [r] = await db.insert(roles).values({ orgId, name: b.name, description: b.description, scope: b.scope, permissions: [...new Set(b.permissions)], repairSteps: [...new Set(b.repair_steps)], replyFromContact: b.reply_from_contact ?? false }).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "create", entity: "role", entityId: r.id, after: r });
    return c.json(r, 201);
  });
  org.put("/roles/:id", require("roles.gerer"), zValidator("json", roleInput, validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId");
    const [before] = await db.select().from(roles).where(and(eq(roles.id, (c.req.param("id") ?? "")), eq(roles.orgId, orgId)));
    if (!before) throw new HttpError(404, "role_not_found");
    // changing a role changes everyone who has it: may add only what you hold; may remove only what you could grant
    assertCanGrant(c.get("principal"), orgId, [...new Set([...b.permissions, ...before.permissions])]);
    const [r] = await db.update(roles).set({ name: b.name, description: b.description, scope: b.scope, permissions: [...new Set(b.permissions)], repairSteps: [...new Set(b.repair_steps)], ...(b.reply_from_contact !== undefined ? { replyFromContact: b.reply_from_contact } : {}), updatedAt: new Date() }).where(eq(roles.id, before.id)).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "update", entity: "role", entityId: r.id, before, after: r });
    return c.json(r);
  });
  /**
   * Delete a role. A role that people hold can only go together with a replacement role that takes over their assignments (and the
   * pending invitations); default roles stay.
   */
  org.delete("/roles/:id", require("roles.gerer"), async (c) => {
    const orgId = c.get("orgId"), p = c.get("principal");
    // the body is optional (a role nobody holds needs none)
    const parsed = z.object({ replacement_role_id: z.string().uuid().nullable().default(null) }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "invalid_input");
    const b = parsed.data;
    const [r] = await db.select().from(roles).where(and(eq(roles.id, c.req.param("id") ?? ""), eq(roles.orgId, orgId)));
    if (!r) throw new HttpError(404, "role_not_found");
    // default roles can go too (they are only created with a new organisation, never re-created); the organisation must keep one role that manages roles
    if (r.permissions.includes("roles.gerer")) {
      const others = (await db.select({ p: roles.permissions }).from(roles).where(and(eq(roles.orgId, orgId), ne(roles.id, r.id)))).filter((x) => x.p.includes("roles.gerer"));
      if (!others.length) throw new HttpError(409, "role_last_admin");
    }
    const used = await db.select({ n: sql<number>`count(*)::int` }).from(roleAssignments).where(eq(roleAssignments.roleId, r.id));
    const inv = await db.select({ n: sql<number>`count(*)::int` }).from(invitations).where(and(eq(invitations.roleId, r.id), sql`${invitations.usedAt} is null`));
    let moved = 0;
    if (used[0].n || inv[0].n) {
      if (!b.replacement_role_id) throw new HttpError(409, "role_in_use");
      const [rep] = await db.select().from(roles).where(and(eq(roles.id, b.replacement_role_id), eq(roles.orgId, orgId)));
      if (!rep || rep.id === r.id || rep.scope !== r.scope) throw new HttpError(400, "replacement_invalid");
      assertCanGrant(p, orgId, rep.permissions);
      await db.transaction(async (tx) => {
        await tx.update(roleAssignments).set({ roleId: rep.id }).where(eq(roleAssignments.roleId, r.id));
        await tx.update(invitations).set({ roleId: rep.id }).where(eq(invitations.roleId, r.id)); // also the accepted ones: they still point at the role
        await tx.delete(roles).where(eq(roles.id, r.id));
      });
      moved = used[0].n + inv[0].n;
    } else {
      // nobody holds it and nothing waits for it: only accepted invitations may still point at it, they go with it
      await db.transaction(async (tx) => { await tx.delete(invitations).where(eq(invitations.roleId, r.id)); await tx.delete(roles).where(eq(roles.id, r.id)); });
    }
    await audit(db, { orgId, userId: p.id, action: "delete", entity: "role", entityId: r.id, before: r, after: { replacementRoleId: b.replacement_role_id, moved } });
    return c.json({ ok: true, moved });
  });

  // stations (sites)
  org.get("/stations", async (c) => {
    // managers get everything; other members only the sites they may know, without commission / report e-mails / Azure ids
    const orgId = c.get("orgId"), u = c.get("principal");
    if (canOrg(u, "stations.gerer", orgId)) {
      const all = await db.select().from(stations).where(eq(stations.orgId, orgId)).orderBy(stations.name);
      const occ = await occupancyOf(db, orgId, all.map((x) => x.id));
      return c.json(all.map((x) => ({ ...x, present: occ[x.id] ?? 0 })));
    }
    const vis = await visibleStations(db, u, orgId);
    const occ = await occupancyOf(db, orgId, vis.map((x) => x.id));
    return c.json(vis.map((x) => ({ id: x.id, type: x.type, name: x.name, country: x.country, capacite: x.capacite, active: x.active, present: occ[x.id] ?? 0 })));
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
  // Stations = places (workshop / yard). Body shops are customers and have their own routes below (/bodyshops).
  org.post("/stations", require("stations.gerer"), async (c, next) => {
    // a clear answer for old clients that still try to create a body shop here
    const raw = await c.req.raw.clone().json().catch(() => ({} as { type?: string }));
    if ((raw as { type?: string }).type === "carrosserie") throw new HttpError(400, "use_bodyshops");
    await next();
  }, zValidator("json", placeInput, validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId");
    await checkTenant(orgId, b.azure_tenant, true);
    const [s] = await db.insert(stations).values({
      orgId, type: b.type, name: b.name, address: b.address, country: b.country, capacite: b.capacite, azureTenant: b.azure_tenant,
      azureLocationAliases: b.azure_location_aliases, repairsPerDay: b.repairs_per_day, citasLocationId: b.citas_location_id,
    }).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "create", entity: "station", entityId: s.id, after: s });
    return c.json(s, 201);
  });
  org.put("/stations/:id", require("stations.gerer"), zValidator("json", placeInput.partial(), validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId");
    const [before] = await db.select().from(stations).where(and(eq(stations.id, (c.req.param("id") ?? "")), eq(stations.orgId, orgId)));
    if (!before) throw new HttpError(404, "station_not_found");
    if (before.type === "carrosserie") throw new HttpError(409, "use_bodyshops");
    if (b.azure_tenant !== undefined && b.azure_tenant !== before.azureTenant) await checkTenant(orgId, b.azure_tenant, true);
    const set: Partial<typeof stations.$inferInsert> = { updatedAt: new Date() };
    if (b.type !== undefined) set.type = b.type;
    if (b.name !== undefined) set.name = b.name;
    if (b.address !== undefined) set.address = b.address;
    if (b.country !== undefined) set.country = b.country;
    if (b.capacite !== undefined) set.capacite = b.capacite;
    if (b.azure_tenant !== undefined) set.azureTenant = b.azure_tenant;
    if (b.azure_location_aliases !== undefined) set.azureLocationAliases = b.azure_location_aliases;
    if (b.citas_location_id !== undefined) set.citasLocationId = b.citas_location_id;
    if (b.repairs_per_day !== undefined) set.repairsPerDay = b.repairs_per_day;
    const [s] = await db.update(stations).set(set).where(eq(stations.id, before.id)).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "update", entity: "station", entityId: s.id, before, after: s });
    return c.json(s);
  });

  // ---------------------------------------------------------------- body shops (customers, V5)
  const mayBodyshops: MiddlewareHandler<Env> = async (c, next) => {
    // org-wide data: a station manager (grant bound to his station) has the right too
    if (!hasOrgPermission(c.get("principal"), "bodyshops.gerer", c.get("orgId"))) throw new HttpError(403, "forbidden");
    await next();
  };
  const bodyshopOf = async (id: string, orgId: string) => {
    const [s] = await db.select().from(stations).where(and(eq(stations.id, id), eq(stations.orgId, orgId)));
    if (!s) throw new HttpError(404, "station_not_found");
    if (s.type !== "carrosserie") throw new HttpError(409, "use_stations");
    return s;
  };
  org.get("/bodyshops", mayBodyshops, async (c) => {
    const orgId = c.get("orgId");
    const rows = await db.select().from(stations).where(and(eq(stations.orgId, orgId), eq(stations.type, "carrosserie"))).orderBy(stations.name);
    const counts = await db.select({ id: vehicles.clientStationId, open: sql<number>`count(*) filter (where ${vehicles.statut} <> 'rendu')::int`, total: sql<number>`count(*)::int` })
      .from(vehicles).where(and(eq(vehicles.orgId, orgId), isNull(vehicles.deletedAt))).groupBy(vehicles.clientStationId);
    const links = await db.select().from(stationInsurers).where(inArray(stationInsurers.stationId, rows.map((r) => r.id).concat(["00000000-0000-0000-0000-000000000000"])));
    const accounts = await db.select({ email: users.email, name: users.name, client: roleAssignments.scopeClientStationId }).from(roleAssignments)
      .innerJoin(users, eq(users.id, roleAssignments.userId)).where(and(eq(roleAssignments.orgId, orgId), isNotNull(roleAssignments.scopeClientStationId)));
    return c.json(rows.map((s) => ({
      ...s, openVehicles: counts.find((x) => x.id === s.id)?.open ?? 0, totalVehicles: counts.find((x) => x.id === s.id)?.total ?? 0,
      insurerIds: links.filter((l) => l.stationId === s.id).map((l) => l.insurerId),
      accounts: accounts.filter((a) => a.client === s.id).map((a) => ({ email: a.email, name: a.name })),
    })));
  });
  org.post("/bodyshops", mayBodyshops, zValidator("json", bodyshopInput, validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId");
    await checkTenant(orgId, b.azure_tenant, true);
    const [s] = await db.insert(stations).values({
      orgId, type: "carrosserie", name: b.name, address: b.address, country: b.country, azureTenant: b.azure_tenant,
      azureBusinessCustomerId: bcIdsOf(b)[0] ?? null, azureBcIds: bcIdsOf(b), azureLinkIds: b.azure_link_ids,
      reportEmails: b.report_emails, commissionMode: b.commission_mode, commissionPct: String(b.commission_pct),
      excludedInsurerEmails: b.excluded_insurer_emails, contactName: b.contact_name, contactPhone: b.contact_phone, cif: b.cif || null,
    }).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "create", entity: "bodyshop", entityId: s.id, after: s });
    hub.publish(orgId, 0);
    return c.json(s, 201);
  });
  org.put("/bodyshops/:id", mayBodyshops, zValidator("json", bodyshopInput.partial(), validationHook), async (c) => {
    const b = c.req.valid("json"), orgId = c.get("orgId");
    const before = await bodyshopOf(c.req.param("id") ?? "", orgId);
    if (b.azure_tenant !== undefined && b.azure_tenant !== before.azureTenant) await checkTenant(orgId, b.azure_tenant, true);
    const set: Partial<typeof stations.$inferInsert> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name;
    if (b.address !== undefined) set.address = b.address;
    if (b.country !== undefined) set.country = b.country;
    if (b.azure_tenant !== undefined) set.azureTenant = b.azure_tenant;
    if (b.azure_business_customer_ids !== undefined || b.azure_business_customer_id !== undefined) {
      const ids = bcIdsOf(b);
      set.azureBcIds = ids; set.azureBusinessCustomerId = ids[0] ?? null;
    }
    if (b.azure_link_ids !== undefined) set.azureLinkIds = b.azure_link_ids;
    if (b.report_emails !== undefined) set.reportEmails = b.report_emails;
    if (b.commission_mode !== undefined) set.commissionMode = b.commission_mode;
    if (b.commission_pct !== undefined) set.commissionPct = String(b.commission_pct);
    if (b.excluded_insurer_emails !== undefined) set.excludedInsurerEmails = b.excluded_insurer_emails;
    if (b.contact_name !== undefined) set.contactName = b.contact_name;
    if (b.contact_phone !== undefined) set.contactPhone = b.contact_phone;
    if (b.cif !== undefined) set.cif = b.cif || null;
    const [s] = await db.update(stations).set(set).where(eq(stations.id, before.id)).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: "update", entity: "bodyshop", entityId: s.id, before, after: s });
    hub.publish(orgId, 0);
    return c.json(s);
  });
  org.post("/bodyshops/:id/active", mayBodyshops, zValidator("json", z.object({ active: z.boolean() }), validationHook), async (c) => {
    const orgId = c.get("orgId");
    const b = await bodyshopOf(c.req.param("id") ?? "", orgId);
    const [s] = await db.update(stations).set({ active: c.req.valid("json").active, updatedAt: new Date() }).where(eq(stations.id, b.id)).returning();
    await audit(db, { orgId, userId: c.get("principal").id, action: s.active ? "reactivate" : "deactivate", entity: "bodyshop", entityId: s.id });
    hub.publish(orgId, 0);
    return c.json(s);
  });
  org.delete("/bodyshops/:id", mayBodyshops, async (c) => {
    const b = await bodyshopOf(c.req.param("id") ?? "", c.get("orgId"));
    return deleteStation(c, b);
  });
  /**
   * Delete a station for good. Refused while any vehicle that still exists stands there, belongs to it as customer, or is assigned to it as
   * body shop, and while repair appointments are open there: move or return the cars first (or just deactivate the station).
   * Links that only make sense with the station go with it (insurers, campaigns, roles tied to it, open invitations); deleted vehicles lose the reference.
   */
  org.delete("/stations/:id", require("stations.gerer"), async (c) => {
    const [s] = await db.select().from(stations).where(and(eq(stations.id, c.req.param("id") ?? ""), eq(stations.orgId, c.get("orgId"))));
    if (!s) throw new HttpError(404, "station_not_found");
    if (s.type === "carrosserie") throw new HttpError(409, "use_bodyshops");
    return deleteStation(c, s);
  });
  async function deleteStation(c: Context<Env>, s: typeof stations.$inferSelect) {
    const orgId = c.get("orgId"), p = c.get("principal");
    // a car BELONGS to a body shop (customer) and STANDS in a hall, a car park or a body shop: both ties count
    const count = async (cond: ReturnType<typeof eq>) => (await db.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(and(cond, isNull(vehicles.deletedAt))))[0].n;
    const standing = await count(eq(vehicles.stationId, s.id));
    const owned = await count(eq(vehicles.clientStationId, s.id));
    const repairing = await count(eq(vehicles.bodyshopId, s.id));
    if (standing || owned || repairing) throw new HttpError(409, "station_in_use", { n: String(standing), m: String(owned), k: String(repairing) });
    const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(repairBookings).where(and(eq(repairBookings.stationId, s.id), inArray(repairBookings.status, ["booked", "started"])));
    if (open.n) throw new HttpError(409, "station_has_bookings", { n: String(open.n) });
    await db.transaction(async (tx) => {
      await tx.update(vehicles).set({ stationId: null }).where(eq(vehicles.stationId, s.id));
      await tx.update(vehicles).set({ clientStationId: null }).where(eq(vehicles.clientStationId, s.id));
      await tx.update(vehicles).set({ bodyshopId: null }).where(eq(vehicles.bodyshopId, s.id));
      await tx.update(repairBookings).set({ originStationId: null }).where(eq(repairBookings.originStationId, s.id));
      await tx.delete(citasLinks).where(eq(citasLinks.stationId, s.id));
      await tx.delete(repairBookings).where(eq(repairBookings.stationId, s.id));
      await tx.delete(stationInsurers).where(eq(stationInsurers.stationId, s.id));
      await tx.delete(campaignStations).where(eq(campaignStations.stationId, s.id));
      await tx.delete(roleAssignments).where(and(eq(roleAssignments.orgId, orgId), or(eq(roleAssignments.stationId, s.id), eq(roleAssignments.scopeClientStationId, s.id))));
      await tx.delete(invitations).where(and(eq(invitations.orgId, orgId), eq(invitations.stationId, s.id)));
      await tx.delete(stations).where(eq(stations.id, s.id));
    });
    await audit(db, { orgId, userId: p.id, action: "delete", entity: s.type === "carrosserie" ? "bodyshop" : "station", entityId: s.id, before: s });
    hub.publish(orgId, 0);
    return c.json({ ok: true });
  }
  org.post("/stations/:id/active", require("stations.gerer"), zValidator("json", z.object({ active: z.boolean() }), validationHook), async (c) => {
    const orgId = c.get("orgId");
    const [cur] = await db.select().from(stations).where(and(eq(stations.id, (c.req.param("id") ?? "")), eq(stations.orgId, orgId)));
    if (!cur) throw new HttpError(404, "station_not_found");
    if (cur.type === "carrosserie") throw new HttpError(409, "use_bodyshops");
    const [s] = await db.update(stations).set({ active: c.req.valid("json").active, updatedAt: new Date() }).where(eq(stations.id, cur.id)).returning();
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
    // an edited Spain matrix becomes a NEW version of the system method: vehicles already frozen on an older version keep their amounts
    if (b.esMatrix !== undefined) await bumpSystemMatrix(db, orgId, (b.esMatrix as never) ?? null, c.get("principal").id);
    await audit(db, { orgId, userId: c.get("principal").id, action: "update", entity: "settings", before, after: next });
    hub.publish(orgId, 0);
    return c.json(next);
  });

  org.get("/permissions", (c) => c.json({ permissions: PERMISSIONS }));

  org.route("/", masterRoutes({ db, hub, storage, require, validationHook }));
  org.route("/", partsAdminRoutes({ db, hub, require, validationHook }));
  admin.route("/", org);

  async function assertStationInOrg(stationId: string, orgId: string, kind: "place" | "bodyshop" = "place") {
    const [s] = await db.select({ id: stations.id, type: stations.type }).from(stations).where(and(eq(stations.id, stationId), eq(stations.orgId, orgId)));
    if (!s) throw new HttpError(400, "station_wrong_org");
    if (kind === "place" && s.type === "carrosserie") throw new HttpError(400, "station_not_a_place");
    if (kind === "bodyshop" && s.type !== "carrosserie") throw new HttpError(400, "client_not_bodyshop");
  }
  /** Scope ids must exist in this org and be present when the role's scope needs them. */
  async function assertScopeFields(scope: string, b: { scope_client_station_id: string | null; scope_insurer_id: string | null; scope_campaign_id: string | null }, orgId: string) {
    if (scope === "client") {
      if (!b.scope_client_station_id) throw new HttpError(400, "client_required");
      await assertStationInOrg(b.scope_client_station_id, orgId, "bodyshop");
    }
    if (scope === "assurance") {
      if (!b.scope_insurer_id) throw new HttpError(400, "insurer_required");
      const [i] = await db.select({ id: insurers.id }).from(insurers).where(and(eq(insurers.id, b.scope_insurer_id), eq(insurers.orgId, orgId)));
      if (!i) throw new HttpError(400, "insurer_wrong_org");
    }
    if (scope === "campagne" && !b.scope_campaign_id) throw new HttpError(400, "campaign_required");
  }

  return admin;
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
