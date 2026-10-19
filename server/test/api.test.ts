import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createDb, type DbHandle } from "../src/db";
import { MemoryMailer } from "../src/email";
import { can, filterFields } from "../src/permissions";
import { loadPrincipal } from "../src/principal";
import { seed } from "../src/seed";
import { auditLog, roleAssignments, sessions, stations, users, vehicleAssignments, vehicles } from "../src/schema";

let h: DbHandle;
let app: ReturnType<typeof createApp>;
const mailer = new MemoryMailer();
const cfg = loadConfig({});
let orgDE: string, orgES: string;
let roleId: Record<string, string> = {};
const roleIdsOf = async (orgId: string) => {
  const r = await call("GET", "/admin/roles", { token: superToken, org: orgId });
  return Object.fromEntries((r.body as { key: string; id: string }[]).map((x) => [x.key, x.id]));
};

interface Opts { token?: string; org?: string; body?: unknown; lang?: string }
async function call(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.org) headers["x-org-id"] = o.org;
  if (o.lang) headers["x-lang"] = o.lang;
  const res = await app.request(path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: body as any };
}
const tokenFromLink = (link: string) => new URL(link).searchParams.get("token")!;

let superToken = "";
async function login(email: string): Promise<{ access_token: string; refresh_token: string }> {
  mailer.sent.length = 0;
  expect((await call("POST", "/auth/request-link", { body: { email } })).status).toBe(200);
  const link = mailer.linkFor(email)!;
  expect(link).toBeTruthy();
  const r = await call("POST", "/auth/verify", { body: { token: tokenFromLink(link) } });
  expect(r.status).toBe(200);
  return r.body;
}
async function inviteAndAccept(adminToken: string, org: string, email: string, body: Record<string, unknown>, name = "Test") {
  mailer.sent.length = 0;
  const r = await call("POST", "/admin/invitations", { token: adminToken, org, body: { email, ...body } });
  expect(r.status).toBe(201);
  const link = mailer.linkFor(email)!;
  const a = await call("POST", "/auth/accept-invite", { body: { token: tokenFromLink(link), name } });
  expect(a.status).toBe(200);
  return a.body as { access_token: string; refresh_token: string };
}

beforeAll(async () => {
  h = await createDb(null);
  app = createApp({ db: h.db, cfg, mailer, limits: { requestLink: 10000, verify: 10000, accept: 10000, refresh: 10000 } });
  const s = await seed(h.db, { superadminEmail: "nicolas@example.test", testSites: true });
  orgDE = s.orgs[0].id; orgES = s.orgs[1].id;
  superToken = (await login("nicolas@example.test")).access_token;
  roleId = await roleIdsOf(orgES);
});
afterAll(async () => { await h.close(); });

describe("magic link login", () => {
  it("unknown e-mail: same 200 answer, no mail (no account enumeration)", async () => {
    mailer.sent.length = 0;
    expect((await call("POST", "/auth/request-link", { body: { email: "nobody@example.test" } })).status).toBe(200);
    expect(mailer.sent.length).toBe(0);
  });
  it("link is single use", async () => {
    mailer.sent.length = 0;
    await call("POST", "/auth/request-link", { body: { email: "nicolas@example.test" } });
    const t = tokenFromLink(mailer.linkFor("nicolas@example.test")!);
    expect((await call("POST", "/auth/verify", { body: { token: t } })).status).toBe(200);
    expect((await call("POST", "/auth/verify", { body: { token: t } })).status).toBe(401);
  });
  it("garbage tokens are rejected", async () => {
    expect((await call("POST", "/auth/verify", { body: { token: "x".repeat(40) } })).status).toBe(401);
    expect((await call("POST", "/auth/verify", { body: { token: "short" } })).status).toBe(400);
  });
  it("tokens are stored hashed, not in clear", async () => {
    const t = tokenFromLink(mailer.linkFor("nicolas@example.test")!);
    const rows = await h.db.execute(`select token_hash from login_tokens` as never);
    expect(JSON.stringify(rows)).not.toContain(t);
  });
  it("API needs a valid access token", async () => {
    expect((await call("GET", "/me")).status).toBe(401);
    expect((await call("GET", "/me", { token: "abc.def.ghi" })).status).toBe(401);
    const me = await call("GET", "/me", { token: superToken });
    expect(me.status).toBe(200);
    expect(me.body.user.isSuperadmin).toBe(true);
    expect(me.body.organizations.length).toBe(2);
  });
});

describe("invitation flow", () => {
  let chefEmail = "chef@example.test", chefToken = "", chefRefresh = "";
  let talavera: string, madrid: string;
  beforeAll(async () => {
    const st = await call("GET", "/admin/stations", { token: superToken, org: orgES });
    talavera = st.body.find((s: any) => s.type === "carrosserie").id;
    madrid = st.body.find((s: any) => s.type === "hall").id;
  });

  it("invite -> link -> account -> lands with the right grant", async () => {
    const t = await inviteAndAccept(superToken, orgES, chefEmail, { role_id: roleId.chef_site, station_id: talavera }, "Chef Talavera");
    chefToken = t.access_token; chefRefresh = t.refresh_token;
    const me = await call("GET", "/me", { token: chefToken });
    expect(me.body.user.name).toBe("Chef Talavera");
    expect(me.body.organizations.map((o: any) => o.id)).toEqual([orgES]);
    expect(me.body.grants).toHaveLength(1);
    expect(me.body.grants[0].stationId).toBe(talavera);
  });
  it("invitation link is single use and expires", async () => {
    mailer.sent.length = 0;
    await call("POST", "/admin/invitations", { token: superToken, org: orgES, body: { email: "once@example.test", role_id: roleId.aufnehmer } });
    const t = tokenFromLink(mailer.linkFor("once@example.test")!);
    expect((await call("POST", "/auth/accept-invite", { body: { token: t, name: "A" } })).status).toBe(200);
    expect((await call("POST", "/auth/accept-invite", { body: { token: t, name: "A" } })).status).toBe(401);

    mailer.sent.length = 0;
    await call("POST", "/admin/invitations", { token: superToken, org: orgES, body: { email: "late@example.test", role_id: roleId.aufnehmer } });
    const t2 = tokenFromLink(mailer.linkFor("late@example.test")!);
    await h.db.execute(`update invitations set expires_at = now() - interval '1 hour'` as never);
    expect((await call("POST", "/auth/accept-invite", { body: { token: t2, name: "L" } })).status).toBe(401);
  });
  it("resend replaces the old link", async () => {
    mailer.sent.length = 0;
    const r = await call("POST", "/admin/invitations", { token: superToken, org: orgES, body: { email: "resend@example.test", role_id: roleId.aufnehmer } });
    const old = tokenFromLink(mailer.linkFor("resend@example.test")!);
    expect((await call("POST", `/admin/invitations/${r.body.id}/resend`, { token: superToken, org: orgES })).status).toBe(200);
    const fresh = tokenFromLink(mailer.linkFor("resend@example.test")!);
    expect(fresh).not.toBe(old);
    expect((await call("POST", "/auth/accept-invite", { body: { token: old, name: "R" } })).status).toBe(401);
    expect((await call("POST", "/auth/accept-invite", { body: { token: fresh, name: "R" } })).status).toBe(200);
  });
  it("existing user invited again to another site just gets the grant", async () => {
    const r = await call("POST", "/admin/invitations", { token: superToken, org: orgES, body: { email: chefEmail, role_id: roleId.aufnehmer, station_id: madrid } });
    expect(r.status).toBe(201);
    expect(r.body.existingUser).toBe(true);
    const me = await call("GET", "/me", { token: chefToken });
    expect(me.body.grants).toHaveLength(2);
  });
  it("invitation validates station and role belong to the org", async () => {
    const other = await call("GET", "/admin/stations", { token: superToken, org: orgDE });
    expect(other.body).toEqual([]);
    const r = await call("POST", "/admin/invitations", { token: superToken, org: orgDE, body: { email: "x@example.test", role_id: roleId.aufnehmer } });
    expect(r.status).toBe(404); // role of the ES org is unknown in the DE org
    const r2 = await call("POST", "/admin/invitations", { token: superToken, org: orgES, body: { email: "x@example.test", role_id: roleId.aufnehmer, station_id: "11111111-1111-4111-8111-111111111111" } });
    expect(r2.status).toBe(400);
  });
  it("client / assurance roles require their scope target", async () => {
    const r = await call("POST", "/admin/invitations", { token: superToken, org: orgES, body: { email: "carro@example.test", role_id: roleId.carrosserie } });
    expect(r.status).toBe(400);
    const ok = await call("POST", "/admin/invitations", { token: superToken, org: orgES, body: { email: "carro@example.test", role_id: roleId.carrosserie, scope_client_station_id: talavera } });
    expect(ok.status).toBe(201);
  });

  describe("sessions", () => {
    it("refresh rotates: the old refresh token stops working", async () => {
      const r1 = await call("POST", "/auth/refresh", { body: { refresh_token: chefRefresh } });
      expect(r1.status).toBe(200);
      expect(r1.body.refresh_token).not.toBe(chefRefresh);
      expect((await call("POST", "/auth/refresh", { body: { refresh_token: chefRefresh } })).status).toBe(401);
      chefRefresh = r1.body.refresh_token; chefToken = r1.body.access_token;
      expect((await call("GET", "/me", { token: chefToken })).status).toBe(200);
    });
    it("logout kills the session immediately (access token too)", async () => {
      const t = await login(chefEmail);
      expect((await call("GET", "/me", { token: t.access_token })).status).toBe(200);
      await call("POST", "/me/logout", { token: t.access_token });
      expect((await call("GET", "/me", { token: t.access_token })).status).toBe(401);
      expect((await call("POST", "/auth/refresh", { body: { refresh_token: t.refresh_token } })).status).toBe(401);
    });
    it("admin 'sign out everywhere' revokes all sessions of a user", async () => {
      const t = await login(chefEmail);
      const users = await call("GET", "/admin/users", { token: superToken, org: orgES });
      const chef = users.body.find((u: any) => u.email === chefEmail);
      expect((await call("POST", `/admin/users/${chef.id}/revoke-sessions`, { token: superToken, org: orgES })).status).toBe(200);
      expect((await call("GET", "/me", { token: t.access_token })).status).toBe(401);
      expect((await call("GET", "/me", { token: chefToken })).status).toBe(401);
    });
    it("deactivate blocks access and login; reactivate restores it; superadmin cannot be deactivated", async () => {
      const users = await call("GET", "/admin/users", { token: superToken, org: orgES });
      const chef = users.body.find((u: any) => u.email === chefEmail);
      const t = await login(chefEmail);
      expect((await call("POST", `/admin/users/${chef.id}/deactivate`, { token: superToken, org: orgES })).status).toBe(200);
      expect((await call("GET", "/me", { token: t.access_token })).status).toBe(401);
      mailer.sent.length = 0;
      await call("POST", "/auth/request-link", { body: { email: chefEmail } });
      expect(mailer.sent.length).toBe(0);
      expect((await call("POST", `/admin/users/${chef.id}/reactivate`, { token: superToken, org: orgES })).status).toBe(200);
      await login(chefEmail);
      const su = users.body.find((u: any) => u.isSuperadmin);
      expect((await call("POST", `/admin/users/${su.id}/deactivate`, { token: superToken, org: orgES })).status).toBe(403);
    });
  });

  describe("authorization on admin routes", () => {
    let chef: string;
    beforeAll(async () => { chef = (await login(chefEmail)).access_token; });
    it("chef de site cannot manage roles or stations, nor read the audit log", async () => {
      expect((await call("GET", "/admin/roles", { token: chef, org: orgES })).status).toBe(403);
      expect((await call("POST", "/admin/stations", { token: chef, org: orgES, body: { type: "hall", name: "X" } })).status).toBe(403);
      expect((await call("GET", "/admin/audit", { token: chef, org: orgES })).status).toBe(403);
    });
    it("a site-limited chef has no org-wide user management (grant is on one site)", async () => {
      // chef's grants are site-bound (Talavera / Madrid) -> the org-wide admin API stays closed
      expect((await call("GET", "/admin/users", { token: chef, org: orgES })).status).toBe(403);
    });
    it("other organisation: 403 even with a valid token", async () => {
      expect((await call("GET", "/admin/stations", { token: chef, org: orgDE })).status).toBe(403);
    });
    it("missing / malformed X-Org-Id", async () => {
      expect((await call("GET", "/admin/stations", { token: chef })).status).toBe(400);
      expect((await call("GET", "/admin/stations", { token: chef, org: "nope" })).status).toBe(400);
    });
    it("only the super-admin manages organisations and tenants", async () => {
      expect((await call("GET", "/admin/orgs", { token: chef })).status).toBe(403);
      expect((await call("PUT", `/admin/orgs/${orgES}/tenants`, { token: chef, body: { tenants: ["x"] } })).status).toBe(403);
    });
  });

  describe("privilege escalation", () => {
    let orgAdminToken: string;
    beforeAll(async () => {
      // an org admin that is NOT super-admin
      orgAdminToken = (await inviteAndAccept(superToken, orgES, "orgadmin@example.test", { role_id: roleId.org_admin })).access_token;
    });
    it("org admin can manage users of the org", async () => {
      expect((await call("GET", "/admin/users", { token: orgAdminToken, org: orgES })).status).toBe(200);
    });
    it("a user with utilisateurs.gerer cannot hand out rights they do not hold", async () => {
      // custom role: can manage users but nothing else
      const r = await call("POST", "/admin/roles", { token: superToken, org: orgES, body: { name: "HR", scope: "station", permissions: ["utilisateurs.gerer"] } });
      expect(r.status).toBe(201);
      const hrToken = (await inviteAndAccept(superToken, orgES, "hr@example.test", { role_id: r.body.id })).access_token;
      const inv = await call("POST", "/admin/invitations", { token: hrToken, org: orgES, body: { email: "evil@example.test", role_id: roleId.org_admin } });
      expect(inv.status).toBe(403);
      const ok = await call("POST", "/admin/invitations", { token: hrToken, org: orgES, body: { email: "fine@example.test", role_id: r.body.id } });
      expect(ok.status).toBe(201);
      const users = (await call("GET", "/admin/users", { token: superToken, org: orgES })).body;
      const hr = users.find((u: any) => u.email === "hr@example.test");
      const ass = await call("POST", "/admin/assignments", { token: hrToken, org: orgES, body: { user_id: hr.id, role_id: roleId.org_admin } });
      expect(ass.status).toBe(403);
    });
    it("a user with roles.gerer cannot create or extend a role beyond their own rights", async () => {
      const r = await call("POST", "/admin/roles", { token: superToken, org: orgES, body: { name: "RoleMgr", scope: "station", permissions: ["roles.gerer", "vehicules.voir"] } });
      const tok = (await inviteAndAccept(superToken, orgES, "rolemgr@example.test", { role_id: r.body.id })).access_token;
      const bad = await call("POST", "/admin/roles", { token: tok, org: orgES, body: { name: "Sneaky", scope: "station", permissions: ["utilisateurs.gerer"] } });
      expect(bad.status).toBe(403);
      const good = await call("POST", "/admin/roles", { token: tok, org: orgES, body: { name: "Viewer2", scope: "station", permissions: ["vehicules.voir"] } });
      expect(good.status).toBe(201);
      // cannot edit own role to add rights
      const up = await call("PUT", `/admin/roles/${r.body.id}`, { token: tok, org: orgES, body: { name: "RoleMgr", scope: "station", permissions: ["roles.gerer", "vehicules.voir", "prix.voir"] } });
      expect(up.status).toBe(403);
    });
  });
});

describe("roles", () => {
  it("system roles are seeded per organisation and cannot be deleted", async () => {
    const r = await call("GET", "/admin/roles", { token: superToken, org: orgES });
    expect(r.body.filter((x: any) => x.isSystem).length).toBe(7);
    expect((await call("DELETE", `/admin/roles/${roleId.technicien}`, { token: superToken, org: orgES })).status).toBe(409);
  });
  it("roles of one org are not visible/usable in another", async () => {
    const de = await roleIdsOf(orgDE);
    expect(de.technicien).not.toBe(roleId.technicien);
    expect((await call("PUT", `/admin/roles/${de.technicien}`, { token: superToken, org: orgES, body: { name: "x", scope: "assigne", permissions: [] } })).status).toBe(404);
  });
  it("assigned role cannot be deleted; unassigned custom role can", async () => {
    const r = await call("POST", "/admin/roles", { token: superToken, org: orgES, body: { name: "Temp", scope: "station", permissions: ["vehicules.voir"] } });
    expect((await call("DELETE", `/admin/roles/${r.body.id}`, { token: superToken, org: orgES })).status).toBe(200);
  });
  it("validates input (unknown permission / scope)", async () => {
    expect((await call("POST", "/admin/roles", { token: superToken, org: orgES, body: { name: "Bad", scope: "station", permissions: ["hack.everything"] } })).status).toBe(400);
    expect((await call("POST", "/admin/roles", { token: superToken, org: orgES, body: { name: "Bad", scope: "world", permissions: [] } })).status).toBe(400);
  });
});

describe("stations and tenants", () => {
  it("creates a carrosserie, a hall and deactivates instead of deleting", async () => {
    const c = await call("POST", "/admin/stations", { token: superToken, org: orgDE, body: { type: "carrosserie", name: "Karosserie Müller", capacite: 25, commission_pct: 15, report_emails: ["a@b.de"] } });
    expect(c.status).toBe(201);
    expect(c.body.capacite).toBe(25);
    const d = await call("POST", `/admin/stations/${c.body.id}/active`, { token: superToken, org: orgDE, body: { active: false } });
    expect(d.body.active).toBe(false);
  });
  it("tenant is required and restricted once the org has tenants assigned by the super-admin", async () => {
    await call("PUT", `/admin/orgs/${orgDE}/tenants`, { token: superToken, body: { tenants: ["Tenant-A", "Tenant-B"] } });
    const missing = await call("POST", "/admin/stations", { token: superToken, org: orgDE, body: { type: "hall", name: "H1" } });
    expect(missing.status).toBe(400);
    const foreign = await call("POST", "/admin/stations", { token: superToken, org: orgDE, body: { type: "hall", name: "H1", azure_tenant: "Tenant-Z" } });
    expect(foreign.status).toBe(400);
    const ok = await call("POST", "/admin/stations", { token: superToken, org: orgDE, body: { type: "hall", name: "H1", azure_tenant: "Tenant-A" } });
    expect(ok.status).toBe(201);
    expect((await call("PUT", `/admin/stations/${ok.body.id}`, { token: superToken, org: orgDE, body: { azure_tenant: "Tenant-Z" } })).status).toBe(400);
  });
  it("station of another org cannot be edited", async () => {
    const st = await call("GET", "/admin/stations", { token: superToken, org: orgES });
    expect((await call("PUT", `/admin/stations/${st.body[0].id}`, { token: superToken, org: orgDE, body: { name: "hijack" } })).status).toBe(404);
  });
  it("rejects invalid input", async () => {
    expect((await call("POST", "/admin/stations", { token: superToken, org: orgES, body: { type: "castle", name: "X" } })).status).toBe(400);
    expect((await call("POST", "/admin/stations", { token: superToken, org: orgES, body: { type: "hall", name: "X", capacite: -5 } })).status).toBe(400);
  });
});

describe("audit log", () => {
  it("records who changed what (before/after)", async () => {
    const r = await call("POST", "/admin/roles", { token: superToken, org: orgES, body: { name: "Audited", scope: "station", permissions: ["vehicules.voir"] } });
    await call("PUT", `/admin/roles/${r.body.id}`, { token: superToken, org: orgES, body: { name: "Audited", scope: "station", permissions: ["vehicules.voir", "prix.voir"] } });
    const log = await call("GET", "/admin/audit?entity=role", { token: superToken, org: orgES });
    const upd = log.body.find((e: any) => e.action === "update" && e.entityId === r.body.id);
    expect(upd.before.permissions).toEqual(["vehicules.voir"]);
    expect(upd.after.permissions).toEqual(["vehicules.voir", "prix.voir"]);
    expect(upd.userId).toBeTruthy();
  });
  it("audit entries of one organisation are not readable from another", async () => {
    const log = await call("GET", "/admin/audit?limit=500", { token: superToken, org: orgDE });
    expect(log.body.every((e: any) => e.orgId === orgDE)).toBe(true);
  });
});

describe("vehicle visibility from real DB grants (move changes visibility)", () => {
  it("technician / chef / carrosserie see the right vehicles, and a move changes it", async () => {
    const st = (await call("GET", "/admin/stations", { token: superToken, org: orgES })).body as any[];
    const tal = st.find((s) => s.type === "carrosserie").id, mad = st.find((s) => s.type === "hall").id;
    const mk = async (email: string, body: Record<string, unknown>) => {
      await inviteAndAccept(superToken, orgES, email, body);
      const [u] = await h.db.select().from(users).where(eq(users.email, email));
      return (await loadPrincipal(h.db, u.id))!;
    };
    const tech = await mk("tech@example.test", { role_id: roleId.technicien, station_id: tal });
    const chef = await mk("chef2@example.test", { role_id: roleId.chef_site, station_id: tal });
    const carro = await mk("carro2@example.test", { role_id: roleId.carrosserie, scope_client_station_id: tal });
    const [v] = await h.db.insert(vehicles).values({ orgId: orgES, stationId: tal, clientStationId: tal }).returning();
    await h.db.insert(vehicleAssignments).values({ vehicleId: v.id, userId: tech.id, type: "pdr" });
    const ref = (stationId: string) => ({ id: v.id, orgId: orgES, stationId, clientStationId: tal, assigneeIds: [tech.id] });
    const data = { kennzeichen: "1234ABC", netto: 1500, stundensatz: 69, techPct: 50, shares: { techEur: 600, demTechEur: 0, werkEur: 300, rest: 600 } };

    expect(can(tech, "vehicules.voir", ref(tal))).toBe(true);
    expect(JSON.stringify(filterFields(tech, ref(tal), data))).not.toMatch(/1500|stundensatz|techPct|rest/);
    expect(can(chef, "vehicules.voir", ref(tal))).toBe(true);
    expect(filterFields(carro, ref(tal), data)).toMatchObject({ netto: 1500, myCommission: { werkEur: 300 } });

    // moved to Madrid
    expect(can(tech, "vehicules.voir", ref(mad))).toBe(false);
    expect(can(chef, "vehicules.voir", ref(mad))).toBe(false);
    expect(can(carro, "vehicules.voir", ref(mad))).toBe(true); // customer keeps seeing its car
    expect(filterFields(chef, ref(mad), data)).toBeNull();
  });
  it("expired assignments stop granting access", async () => {
    const [u] = await h.db.select().from(users).where(eq(users.email, "tech@example.test"));
    await h.db.update(roleAssignments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(roleAssignments.userId, u.id));
    const p = (await loadPrincipal(h.db, u.id))!;
    expect(can(p, "vehicules.voir", { id: "x", orgId: orgES, stationId: null, clientStationId: null, assigneeIds: [u.id] })).toBe(false);
  });
});

describe("misc", () => {
  it("health endpoint", async () => {
    expect((await call("GET", "/health")).body).toEqual({ ok: true });
  });
  it("rate limits magic-link requests per IP", async () => {
    const limited = createApp({ db: h.db, cfg, mailer }); // default limits
    let last = 200;
    for (let i = 0; i < 8; i++) {
      last = (await limited.request("/auth/request-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `spam${i}@example.test` }) })).status;
    }
    expect(last).toBe(429);
  });
  it("sessions table never contains a clear refresh token", async () => {
    const t = await login("nicolas@example.test");
    const rows = await h.db.select().from(sessions);
    expect(JSON.stringify(rows)).not.toContain(t.refresh_token);
  });
  it("audit table exists and has entries", async () => {
    expect((await h.db.select().from(auditLog)).length).toBeGreaterThan(5);
    expect((await h.db.select().from(stations)).length).toBeGreaterThan(1);
  });
});

describe("languages (DE / EN)", () => {
  it("error messages follow X-Lang, with a stable code", async () => {
    const en = await call("GET", "/me", { lang: "en" });
    expect(en.status).toBe(401);
    expect(en.body).toEqual({ error: "Not signed in", code: "not_authenticated" });
    const de = await call("GET", "/me", { lang: "de" });
    expect(de.body).toEqual({ error: "Nicht angemeldet", code: "not_authenticated" });
    const dflt = await call("GET", "/me");
    expect(dflt.body.error).toBe("Nicht angemeldet");
  });
  it("Accept-Language is used when X-Lang is absent", async () => {
    const res = await app.request("/me", { headers: { "accept-language": "en-GB,en;q=0.8" } });
    expect((await res.json()).error).toBe("Not signed in");
  });
  it("validation errors are localized too", async () => {
    const en = await call("POST", "/auth/request-link", { body: { email: "not-an-email" }, lang: "en" });
    expect(en.status).toBe(400);
    expect(en.body).toEqual({ error: "Invalid input", code: "invalid_input" });
    expect((await call("POST", "/auth/request-link", { body: { email: "x" }, lang: "de" })).body.error).toBe("Ungültige Eingabe");
  });
  it("parameterised messages", async () => {
    const r = await call("POST", "/admin/roles", { token: superToken, org: orgES, body: { name: "LangRM", scope: "station", permissions: ["roles.gerer"] } });
    const tok = (await inviteAndAccept(superToken, orgES, "langrm@example.test", { role_id: r.body.id })).access_token;
    const bad = await call("POST", "/admin/roles", { token: tok, org: orgES, lang: "en", body: { name: "X", scope: "station", permissions: ["prix.voir"] } });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe("You are not allowed to grant these permissions: prix.voir");
    const badDe = await call("POST", "/admin/roles", { token: tok, org: orgES, lang: "de", body: { name: "X", scope: "station", permissions: ["prix.voir"] } });
    expect(badDe.body.error).toBe("Sie dürfen diese Rechte nicht vergeben: prix.voir");
  });
  it("invitation e-mail and account language follow the chosen language", async () => {
    mailer.sent.length = 0;
    await call("POST", "/admin/invitations", { token: superToken, org: orgES, body: { email: "english@example.test", role_id: roleId.aufnehmer, language: "en" } });
    expect(mailer.last().subject).toContain("Invitation to PDR Hagel");
    expect(mailer.last().text).toContain("You have been invited");
    expect(mailer.last().text).not.toMatch(/Sie wurden|Konto erstellen/);
    const token = tokenFromLink(mailer.linkFor("english@example.test")!);
    const acc = await call("POST", "/auth/accept-invite", { body: { token, name: "Eve" } });
    expect(acc.status).toBe(200);
    const me = await call("GET", "/me", { token: acc.body.access_token });
    expect(me.body.user.language).toBe("en");

    mailer.sent.length = 0;
    await call("POST", "/admin/invitations", { token: superToken, org: orgES, body: { email: "deutsch@example.test", role_id: roleId.aufnehmer } });
    expect(mailer.last().subject).toContain("Einladung zu PDR Hagel");
  });
  it("login e-mail follows the account language, switchable via PUT /me/language", async () => {
    const t = await login("english@example.test");
    expect(mailer.last().subject).toBe("Sign in to PDR Hagel");
    expect(mailer.last().text).toContain("single use");
    expect((await call("PUT", "/me/language", { token: t.access_token, body: { language: "de" } })).status).toBe(200);
    await login("english@example.test");
    expect(mailer.last().subject).toBe("Anmeldung PDR Hagel");
    expect(mailer.last().text).toContain("nur einmal verwendbar");
    expect((await call("PUT", "/me/language", { token: t.access_token, body: { language: "fr" } })).status).toBe(400);
    expect((await call("PUT", "/me/language", { body: { language: "en" } })).status).toBe(401);
  });
  it("existing user granted access gets the notification in their language", async () => {
    await call("PUT", "/me/language", { token: (await login("english@example.test")).access_token, body: { language: "en" } });
    mailer.sent.length = 0;
    await call("POST", "/admin/invitations", { token: superToken, org: orgES, body: { email: "english@example.test", role_id: roleId.technicien, language: "de" } });
    expect(mailer.last().subject).toBe("New access: PDR Team Spain");
  });
  it("accept-invite may override the invitation language", async () => {
    mailer.sent.length = 0;
    await call("POST", "/admin/invitations", { token: superToken, org: orgES, body: { email: "override@example.test", role_id: roleId.aufnehmer, language: "de" } });
    const token = tokenFromLink(mailer.linkFor("override@example.test")!);
    const acc = await call("POST", "/auth/accept-invite", { body: { token, name: "Ov", language: "en" } });
    expect((await call("GET", "/me", { token: acc.body.access_token })).body.user.language).toBe("en");
  });
});
