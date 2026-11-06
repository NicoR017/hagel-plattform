import { zValidator } from "@hono/zod-validator";
import { desc, eq, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  acceptInviteInput, passwordLoginInput, setPasswordInput, loginRequestInput, loginVerifyInput, refreshInput,
  type Permission, errorMessage, pickLang, languageInput,
} from "@hagel/shared";
import {
  HttpError, acceptInvitation, authenticate, passwordLogin, setPassword, refreshSession, requestLogin, revokeAllSessions, revokeSession, verifyLogin,
} from "./domains/auth/auth";
import type { Config } from "./config";
import type { Db } from "./db";
import type { Mailer } from "./email";
import { readLink } from "./mail_attachments";
import type { Env } from "./env";
import { Hub } from "./hub";
import { canOrg, isMemberOfOrg } from "./permissions";
import { syncRoutes } from "./domains/vehicles/routes";
import { repairRoutes } from "./domains/repair/routes";
import { orderRoutes } from "./domains/parts/orders_routes";
import { setOrderNotifier } from "./domains/parts/orders";
import { weeklyRoutes } from "./domains/reports/weekly";
import { adminRoutes } from "./domains/admin/routes";
import { azureRoutes } from "./domains/scans/routes";
import { citasRoutes } from "./domains/citas/routes";
import { insurerReportRoutes } from "./domains/reports/insurer_routes";
import type { CitasSource } from "./domains/citas/citas";
import type { AzureSource } from "./domains/scans/azure";
import { MemoryStorage, type Storage } from "./storage";
import type { FetchLike } from "./domains/scans/ocr";
import { loadPrincipal } from "./domains/auth/principal";
import { buildDashboard, buildFinishedExport, buildTechSheets } from "./domains/reports/dashboard";
import { handoverRoutes } from "./domains/repair/handover";
import { memberships, organizations, sessions, users } from "./schema";

export { seedRoles } from "./domains/admin/routes";

export interface Limits { requestLink: number; verify: number; accept: number; refresh: number; login: number }
export const DEFAULT_LIMITS: Limits = { requestLink: 5, verify: 20, accept: 20, refresh: 60, login: 60 };
export interface AppDeps {
  db: Db; cfg: Config; mailer: Mailer; limits?: Partial<Limits>;
  storage?: Storage; hub?: Hub; az?: AzureSource | null; citas?: CitasSource | null; citasNow?: () => number; ocr?: { apiKey: string | null; model: string; fetch: FetchLike };
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

export function createApp({ db, cfg, mailer, limits: lim, storage = new MemoryStorage(), hub = new Hub(), az = null, citas = null, citasNow, ocr }: AppDeps) {
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

  /** Public: which environment this is (banner) and whether the new UI is the default. No secrets. */
  app.get("/config", (c) => c.json({ appEnv: cfg.appEnv }));

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

  // Signed, expiring download of an attachment that was too large to e-mail (see mail_attachments.ts). The token is the only credential.
  app.get("/files/:token", rateLimit(L.refresh, 15 * 60_000, ip), async (c) => {
    const f = await readLink(storage, cfg.sessionSecret, c.req.param("token"));
    if (!f) return c.text("Not found", 404, { "Cache-Control": "no-store" });
    return new Response(f.bytes as BodyInit, {
      headers: { "Content-Type": f.contentType, "Content-Disposition": `attachment; filename="${f.filename}"`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
    });
  });

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

  // ---------- dashboard (scope-limited; amounts only where the user may see prices) ----------
  const mayDashboard: MiddlewareHandler<Env> = async (c, next) => {
    // any grant of this organisation with the right (a chef of site has it for his site only): the data is cut to the scope afterwards
    const u = c.get("principal"), now = new Date();
    if (!(u.isSuperadmin || u.grants.some((g) => g.orgId === c.get("orgId") && g.permissions.includes("dashboard.voir") && (!g.expiresAt || g.expiresAt > now)))) throw new HttpError(403, "forbidden");
    await next();
  };
  app.get("/dashboard", needAuth, needOrg, mayDashboard, async (c) => {
    const q = c.req.query();
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const uuidOrUndef = (x?: string) => (x && z.string().uuid().safeParse(x).success ? x : undefined);
    return c.json(await buildDashboard(db, c.get("principal"), c.get("orgId"), {
      sites: (q.sites ?? "").split(",").filter((x) => z.string().uuid().safeParse(x).success),
      campaign: uuidOrUndef(q.campaign), client: uuidOrUndef(q.client), insurer: uuidOrUndef(q.insurer),
      from: q.from && day.test(q.from) ? q.from : undefined, to: q.to && day.test(q.to) ? q.to : undefined,
    }));
  });

  app.get("/dashboard/technician-sheets", needAuth, needOrg, mayDashboard, async (c) => {
    const q = c.req.query();
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const uuidOrUndef = (x?: string) => (x && z.string().uuid().safeParse(x).success ? x : undefined);
    return c.json(await buildTechSheets(db, c.get("principal"), c.get("orgId"), {
      sites: (q.sites ?? "").split(",").filter((x) => z.string().uuid().safeParse(x).success),
      campaign: uuidOrUndef(q.campaign), client: uuidOrUndef(q.client), insurer: uuidOrUndef(q.insurer),
      from: q.from && day.test(q.from) ? q.from : undefined, to: q.to && day.test(q.to) ? q.to : undefined,
    }));
  });

  app.get("/dashboard/finished-export", needAuth, needOrg, mayDashboard, async (c) => {
    const q = c.req.query();
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const uuidOrUndef = (x?: string) => (x && z.string().uuid().safeParse(x).success ? x : undefined);
    return c.json(await buildFinishedExport(db, c.get("principal"), c.get("orgId"), {
      sites: (q.sites ?? "").split(",").filter((x) => z.string().uuid().safeParse(x).success),
      campaign: uuidOrUndef(q.campaign), client: uuidOrUndef(q.client), insurer: uuidOrUndef(q.insurer),
      from: q.from && day.test(q.from) ? q.from : undefined, to: q.to && day.test(q.to) ? q.to : undefined,
    }));
  });

  // ---------- sync, files, OCR ----------
  app.route("/", syncRoutes({ db, hub, storage, mailer, needAuth, needOrg, ocr, validationHook }));
  app.route("/", handoverRoutes({ db, storage, mailer, needAuth, needOrg, validationHook }));
  app.route("/", repairRoutes({ db, storage, mailer, needAuth, needOrg }));
  setOrderNotifier((o, s) => hub.publish(o, s));
  app.route("/", orderRoutes({ db, storage, mailer, needAuth, needOrg, validationHook }));
  app.route("/", weeklyRoutes({ db, mailer, needAuth, needOrg, validationHook }));

  app.route("/", azureRoutes({ db, hub, storage, az, needAuth, needOrg, validationHook }));
  app.route("/", insurerReportRoutes({ db, storage, mailer, needAuth, needOrg, validationHook }));
  app.route("/", citasRoutes({ db, hub, storage, az, citas, needAuth, needOrg, validationHook, now: citasNow }));

  app.route("/admin", adminRoutes({ db, cfg, mailer, hub, storage, needAuth, needOrg, require, requireSuper, validationHook }));

  return app;
}
