import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { sign, verify } from "hono/jwt";
import { type ErrorCode, type Lang, isLang } from "@hagel/shared";
import type { Config } from "./config";
import { accessMail, inviteMail, loginMail } from "./mails";
import { hashPassword, hashToken, newToken, verifyPassword } from "./crypto";
import type { Db } from "./db";
import type { Mailer } from "./email";
import { audit } from "./audit";
import { invitations, loginTokens, memberships, organizations, roleAssignments, roles, sessions, users } from "./schema";

export class HttpError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 429 | 502, public code: ErrorCode, public params: Record<string, string> = {}) { super(code); }
}

const now = () => new Date();
const addMs = (ms: number) => new Date(Date.now() + ms);

export interface Tokens { access_token: string; refresh_token: string; expires_in: number; session_id: string }

export async function createSession(db: Db, cfg: Config, userId: string, device = ""): Promise<Tokens> {
  const refresh = newToken();
  const [s] = await db.insert(sessions).values({
    userId, refreshHash: hashToken(refresh), device, expiresAt: addMs(cfg.refreshTtlDays * 86400_000), lastUsedAt: now(),
  }).returning();
  return { access_token: await signAccess(cfg, userId, s.id), refresh_token: refresh, expires_in: cfg.accessTtlSec, session_id: s.id };
}

async function signAccess(cfg: Config, userId: string, sid: string) {
  return sign({ sub: userId, sid, exp: Math.floor(Date.now() / 1000) + cfg.accessTtlSec }, cfg.sessionSecret, "HS256");
}

/** Verifies the access token AND that the session is still alive and the user active (so revocation is immediate). */
export async function authenticate(db: Db, cfg: Config, token: string): Promise<{ userId: string; sessionId: string } | null> {
  let p: { sub?: string; sid?: string };
  try { p = (await verify(token, cfg.sessionSecret, "HS256")) as typeof p; } catch { return null; }
  if (!p.sub || !p.sid) return null;
  const [row] = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, p.sid), eq(sessions.userId, p.sub), isNull(sessions.revokedAt), gt(sessions.expiresAt, now())));
  if (!row || row.u.status !== "active") return null;
  return { userId: p.sub, sessionId: p.sid };
}

/** Rotating refresh token: the presented token is replaced; the old one stops working. */
export async function refreshSession(db: Db, cfg: Config, refreshToken: string): Promise<Tokens> {
  const h = hashToken(refreshToken);
  const [s] = await db.select().from(sessions).where(eq(sessions.refreshHash, h));
  if (!s || s.revokedAt || s.expiresAt <= now()) throw new HttpError(401, "session_expired");
  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  if (!u || u.status !== "active") throw new HttpError(401, "account_disabled");
  const next = newToken();
  const upd = await db.update(sessions)
    .set({ refreshHash: hashToken(next), lastUsedAt: now() })
    .where(and(eq(sessions.id, s.id), eq(sessions.refreshHash, h)))
    .returning();
  if (!upd.length) throw new HttpError(401, "session_expired"); // lost a race: the old token was already rotated
  return { access_token: await signAccess(cfg, s.userId, s.id), refresh_token: next, expires_in: cfg.accessTtlSec, session_id: s.id };
}

export async function revokeSession(db: Db, sessionId: string) {
  await db.update(sessions).set({ revokedAt: now() }).where(eq(sessions.id, sessionId));
}
export async function revokeAllSessions(db: Db, userId: string) {
  await db.update(sessions).set({ revokedAt: now() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

// ---- magic link login (existing users) ----
export async function requestLogin(db: Db, cfg: Config, mailer: Mailer, email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u || u.status !== "active") return; // same response either way: no account enumeration
  const token = newToken();
  await db.insert(loginTokens).values({ userId: u.id, tokenHash: hashToken(token), expiresAt: addMs(cfg.loginTtlMinutes * 60_000) });
  await mailer.send({ to: email, ...loginMail(isLang(u.language) ? u.language : "de", u.name, `${cfg.appUrl}/login?token=${token}`, cfg.loginTtlMinutes) });
}

export async function verifyLogin(db: Db, cfg: Config, token: string, device: string): Promise<Tokens> {
  // single use: atomically mark used
  const used = await db.update(loginTokens)
    .set({ usedAt: now() })
    .where(and(eq(loginTokens.tokenHash, hashToken(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now())))
    .returning();
  if (!used.length) throw new HttpError(401, "link_invalid");
  const [u] = await db.select().from(users).where(eq(users.id, used[0].userId));
  if (!u || u.status !== "active") throw new HttpError(401, "account_disabled");
  return createSession(db, cfg, u.id, device);
}

// ---- password login (optional; the magic link stays as account creation / "forgot password") ----
const fails = new Map<string, { n: number; reset: number }>();
const MAX_FAILS = 10, FAIL_WINDOW_MS = 15 * 60_000;

export async function passwordLogin(db: Db, cfg: Config, email: string, password: string, device: string): Promise<Tokens> {
  const t = Date.now();
  const f = fails.get(email);
  if (f && f.reset > t && f.n >= MAX_FAILS) throw new HttpError(429, "too_many_requests"); // per account, whatever the IP
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const ok = await verifyPassword(password, u?.passwordHash);
  if (!u || !ok || u.status !== "active") {
    const cur = f && f.reset > t ? f : { n: 0, reset: t + FAIL_WINDOW_MS };
    cur.n++; fails.set(email, cur);
    if (fails.size > 5000) for (const [k, v] of fails) if (v.reset < t) fails.delete(k);
    throw new HttpError(401, "invalid_credentials");
  }
  fails.delete(email);
  return createSession(db, cfg, u.id, device);
}

const FRESH_SESSION_MS = 10 * 60_000;
/** Sets or changes the password. Without the current password only within 10 minutes after signing in (e.g. via the e-mail link = "forgot password"). */
export async function setPassword(db: Db, userId: string, sessionId: string, password: string, current?: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (u.passwordHash) {
    const fresh = s && Date.now() - s.createdAt.getTime() < FRESH_SESSION_MS;
    if (!(current && (await verifyPassword(current, u.passwordHash))) && !(fresh && current === undefined)) throw new HttpError(401, "wrong_current_password");
  }
  await db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: now() }).where(eq(users.id, userId));
  // every other device has to sign in again
  await db.update(sessions).set({ revokedAt: now() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, sessionId)));
}

// ---- invitations ----
export interface InviteParams {
  orgId: string; email: string; roleId: string; stationId: string | null;
  scopeClientStationId: string | null; scopeInsurerId: string | null; scopeCampaignId: string | null;
  assignmentExpiresAt: Date | null; invitedBy: string; language: Lang;
}

export async function inviteUser(db: Db, cfg: Config, mailer: Mailer, p: InviteParams): Promise<{ id: string; existingUser: boolean }> {
  const [role] = await db.select().from(roles).where(and(eq(roles.id, p.roleId), eq(roles.orgId, p.orgId)));
  if (!role) throw new HttpError(404, "role_not_found");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, p.orgId));
  const [existing] = await db.select().from(users).where(eq(users.email, p.email));
  if (existing && existing.status === "active") {
    // already has an account: grant access directly and tell them
    await addAccess(db, existing.id, p);
    await mailer.send({ to: p.email, ...accessMail(isLang(existing.language) ? existing.language : "de", org.name, `${cfg.appUrl}/login`) });
    await audit(db, { orgId: p.orgId, userId: p.invitedBy, action: "grant_access", entity: "user", entityId: existing.id, after: { roleId: p.roleId, stationId: p.stationId } });
    return { id: existing.id, existingUser: true };
  }
  if (existing && existing.status === "disabled") throw new HttpError(409, "account_disabled_reactivate");
  const token = newToken();
  const [inv] = await db.insert(invitations).values({
    orgId: p.orgId, email: p.email, roleId: p.roleId, stationId: p.stationId,
    scopeClientStationId: p.scopeClientStationId, scopeInsurerId: p.scopeInsurerId, scopeCampaignId: p.scopeCampaignId,
    assignmentExpiresAt: p.assignmentExpiresAt, language: p.language, tokenHash: hashToken(token),
    expiresAt: addMs(cfg.inviteTtlHours * 3600_000), invitedBy: p.invitedBy,
  }).returning();
  await sendInviteMail(cfg, mailer, p.email, org.name, token, p.language);
  await audit(db, { orgId: p.orgId, userId: p.invitedBy, action: "invite", entity: "invitation", entityId: inv.id, after: { email: p.email, roleId: p.roleId, stationId: p.stationId } });
  return { id: inv.id, existingUser: false };
}

async function sendInviteMail(cfg: Config, mailer: Mailer, to: string, orgName: string, token: string, lang: Lang) {
  await mailer.send({ to, ...inviteMail(lang, orgName, `${cfg.appUrl}/invite?token=${token}`, cfg.inviteTtlHours) });
}

/** A new token replaces the old one (the old link stops working). */
export async function resendInvitation(db: Db, cfg: Config, mailer: Mailer, invitationId: string, orgId: string) {
  const [inv] = await db.select().from(invitations).where(and(eq(invitations.id, invitationId), eq(invitations.orgId, orgId)));
  if (!inv || inv.usedAt) throw new HttpError(404, "invitation_not_found");
  const token = newToken();
  await db.update(invitations).set({ tokenHash: hashToken(token), expiresAt: addMs(cfg.inviteTtlHours * 3600_000) }).where(eq(invitations.id, inv.id));
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  await sendInviteMail(cfg, mailer, inv.email, org.name, token, isLang(inv.language) ? inv.language : "de");
}

async function addAccess(db: Db, userId: string, p: Pick<InviteParams, "orgId" | "roleId" | "stationId" | "scopeClientStationId" | "scopeInsurerId" | "scopeCampaignId" | "assignmentExpiresAt">) {
  await db.insert(memberships).values({ userId, orgId: p.orgId }).onConflictDoNothing();
  await db.insert(roleAssignments).values({
    userId, orgId: p.orgId, roleId: p.roleId, stationId: p.stationId, scopeClientStationId: p.scopeClientStationId,
    scopeInsurerId: p.scopeInsurerId, scopeCampaignId: p.scopeCampaignId, expiresAt: p.assignmentExpiresAt,
  });
}

export async function acceptInvitation(db: Db, cfg: Config, token: string, name: string, language: string, device = "", password?: string): Promise<Tokens> {
  // single use: atomically mark used
  const claimed = await db.update(invitations)
    .set({ usedAt: now() })
    .where(and(eq(invitations.tokenHash, hashToken(token)), isNull(invitations.usedAt), gt(invitations.expiresAt, now())))
    .returning();
  if (!claimed.length) throw new HttpError(401, "invitation_invalid");
  const inv = claimed[0];
  const [existing] = await db.select().from(users).where(eq(users.email, inv.email));
  let userId: string;
  if (existing) {
    if (existing.status === "disabled") throw new HttpError(409, "account_disabled");
    userId = existing.id;
    if (password && !existing.passwordHash) await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
  } else {
    const [u] = await db.insert(users).values({
      email: inv.email, name, language: isLang(language) ? language : isLang(inv.language) ? inv.language : "de", status: "active",
      passwordHash: password ? await hashPassword(password) : null,
    }).returning();
    userId = u.id;
  }
  await addAccess(db, userId, {
    orgId: inv.orgId, roleId: inv.roleId, stationId: inv.stationId, scopeClientStationId: inv.scopeClientStationId,
    scopeInsurerId: inv.scopeInsurerId, scopeCampaignId: inv.scopeCampaignId, assignmentExpiresAt: inv.assignmentExpiresAt,
  });
  await audit(db, { orgId: inv.orgId, userId, action: "accept_invitation", entity: "user", entityId: userId, after: { email: inv.email } });
  return createSession(db, cfg, userId, device);
}
