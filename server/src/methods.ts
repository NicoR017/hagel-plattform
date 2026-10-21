// Calculation methods: versioned parameters per organisation, resolution for a vehicle, admin routes.
//
// A method has an engine (aw = BVAT, matrix = Spain) and numbered versions. Every change of the parameters is a NEW version; a vehicle
// stores (method_id, method_version) and keeps computing with exactly that version, so an estimate can never change afterwards.
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { systemMethodDef, type CalcMethodDef, type EsMatrix } from "@hagel/calc";
import { insurerMethodsInput, methodInput, methodParamsFor, type ClientMethod, type Permission } from "@hagel/shared";
import { audit } from "./audit";
import { HttpError } from "./auth";
import type { Db } from "./db";
import type { Env } from "./env";
import type { Hub } from "./hub";
import { calcMethodVersions, calcMethods, insurerMethods, insurers, vehicles } from "./schema";

/** `${methodId}:${version}` -> definition */
export type MethodMap = Map<string, CalcMethodDef>;
export const methodKey = (id: string, version: number) => `${id}:${version}`;

export async function loadMethodMap(db: Pick<Db, "select">, orgId: string): Promise<MethodMap> {
  const rows = await db.select({ id: calcMethods.id, engine: calcMethods.engine, version: calcMethodVersions.version, params: calcMethodVersions.params })
    .from(calcMethodVersions).innerJoin(calcMethods, eq(calcMethods.id, calcMethodVersions.methodId)).where(eq(calcMethods.orgId, orgId));
  return new Map(rows.map((r) => [methodKey(r.id, r.version), { engine: r.engine, params: r.params } as CalcMethodDef]));
}

/** The method frozen on a vehicle; null for a vehicle without one (historical behaviour). */
export const methodOf = (map: MethodMap | undefined, v: { methodId: string | null; methodVersion: number | null }): CalcMethodDef | null =>
  map && v.methodId && v.methodVersion ? map.get(methodKey(v.methodId, v.methodVersion)) ?? null : null;

/** System methods of a fresh organisation (the migration does the same for existing ones). Idempotent. */
export async function seedMethods(db: Db, orgId: string, esMatrix: EsMatrix | null = null) {
  for (const [engine, country, name] of [["aw", "DE", "BVAT 2025 (System)"], ["matrix", "ES", "PDR Team Matrix (System)"]] as const) {
    const [have] = await db.select().from(calcMethods).where(and(eq(calcMethods.orgId, orgId), eq(calcMethods.isSystem, true), eq(calcMethods.country, country)));
    if (have) continue;
    const [m] = await db.insert(calcMethods).values({ orgId, name, engine, country, isSystem: true, currentVersion: 1 }).returning();
    await db.insert(calcMethodVersions).values({ methodId: m.id, version: 1, params: systemMethodDef(engine, esMatrix).params as never });
  }
}

/** Current system method of a country: what a new vehicle is frozen on when nothing else was chosen. */
export async function systemMethodFor(db: Pick<Db, "select">, orgId: string, country: "DE" | "ES"): Promise<{ id: string; version: number } | null> {
  const [m] = await db.select().from(calcMethods).where(and(eq(calcMethods.orgId, orgId), eq(calcMethods.isSystem, true), eq(calcMethods.country, country)));
  return m ? { id: m.id, version: m.currentVersion } : null;
}

/** Method of an insurer for a country (insurer mapping), else the system method. */
export async function methodForInsurer(db: Pick<Db, "select">, orgId: string, insurerId: string | null, country: "DE" | "ES"): Promise<{ id: string; version: number } | null> {
  if (insurerId) {
    const [im] = await db.select().from(insurerMethods).where(and(eq(insurerMethods.insurerId, insurerId), eq(insurerMethods.country, country)));
    if (im) {
      const [m] = await db.select().from(calcMethods).where(and(eq(calcMethods.id, im.methodId), eq(calcMethods.orgId, orgId), isNull(calcMethods.archivedAt)));
      if (m && m.country === country) return { id: m.id, version: m.currentVersion };
    }
  }
  return systemMethodFor(db, orgId, country);
}

/** Matrix parameters carry prices: users who may not see prices get the structure without them (like the organisation settings). */
function maskParams(engine: string, params: unknown, mayPrice: boolean): unknown {
  if (mayPrice || engine !== "matrix") return params;
  const m = (params as { esMatrix: Record<string, unknown> | null }).esMatrix;
  return { esMatrix: m ? { ...m, rate_eur_per_h: 0, kickback_eur: [{ else: true, eur: 0 }] } : null };
}

export async function clientMethods(db: Db, orgId: string, mayPrice: boolean): Promise<ClientMethod[]> {
  const ms = await db.select().from(calcMethods).where(eq(calcMethods.orgId, orgId)).orderBy(asc(calcMethods.name));
  if (!ms.length) return [];
  const vs = await db.select().from(calcMethodVersions).where(inArray(calcMethodVersions.methodId, ms.map((m) => m.id)));
  return ms.map((m) => ({
    id: m.id, name: m.name, engine: m.engine as "aw" | "matrix", country: m.country as "DE" | "ES", isSystem: m.isSystem, currentVersion: m.currentVersion, archived: !!m.archivedAt,
    versions: Object.fromEntries(vs.filter((v) => v.methodId === m.id).map((v) => [String(v.version), maskParams(m.engine, v.params, mayPrice)])),
  }));
}

/** New version of the system Spain method when the organisation's matrix is edited in the (old) price settings: old vehicles stay on their version. */
export async function bumpSystemMatrix(db: Db, orgId: string, esMatrix: EsMatrix | null, userId: string | null) {
  const [m] = await db.select().from(calcMethods).where(and(eq(calcMethods.orgId, orgId), eq(calcMethods.isSystem, true), eq(calcMethods.country, "ES")));
  if (!m) return;
  const [cur] = await db.select().from(calcMethodVersions).where(and(eq(calcMethodVersions.methodId, m.id), eq(calcMethodVersions.version, m.currentVersion)));
  if (cur && JSON.stringify((cur.params as { esMatrix: unknown }).esMatrix ?? null) === JSON.stringify(esMatrix ?? null)) return;
  const version = m.currentVersion + 1;
  await db.insert(calcMethodVersions).values({ methodId: m.id, version, params: { esMatrix } as never, createdBy: userId });
  await db.update(calcMethods).set({ currentVersion: version, updatedAt: new Date() }).where(eq(calcMethods.id, m.id));
}

interface Deps {
  db: Db; hub: Hub;
  require: (p: Permission) => MiddlewareHandler<Env>;
  validationHook: (r: { success: boolean }, c: Context) => Response | undefined;
}

/** Admin routes (mounted under /admin): list, create (copy), new version, archive, usage, insurer mapping. */
export function methodRoutes({ db, hub, require, validationHook }: Deps) {
  const r = new Hono<Env>();
  const org = (c: Context<Env>) => c.get("orgId");
  const who = (c: Context<Env>) => c.get("principal").id;
  const own = async (c: Context<Env>, id: string) => {
    const [m] = await db.select().from(calcMethods).where(and(eq(calcMethods.id, id), eq(calcMethods.orgId, org(c))));
    if (!m) throw new HttpError(404, "method_not_found");
    return m;
  };
  const parse = (engine: "aw" | "matrix", params: unknown) => {
    const p = methodParamsFor(engine).safeParse(params);
    if (!p.success) throw new HttpError(400, "invalid_input");
    return p.data;
  };

  r.get("/methods", require("methoden.gerer"), async (c) => c.json(await clientMethods(db, org(c), true)));

  r.post("/methods", require("methoden.gerer"), zValidator("json", methodInput, validationHook), async (c) => {
    const b = c.req.valid("json");
    const params = parse(b.engine, b.params);
    if ((b.engine === "aw") !== (b.country === "DE")) throw new HttpError(400, "method_mismatch");
    if (b.base_method_id) await own(c, b.base_method_id);
    const [m] = await db.insert(calcMethods).values({ orgId: org(c), name: b.name, engine: b.engine, country: b.country, baseMethodId: b.base_method_id, createdBy: who(c) }).returning();
    await db.insert(calcMethodVersions).values({ methodId: m.id, version: 1, params: params as never, createdBy: who(c) });
    await audit(db, { orgId: org(c), userId: who(c), action: "create", entity: "calc_method", entityId: m.id, after: { name: m.name, engine: m.engine, country: m.country } });
    hub.publish(org(c), 0);
    return c.json(m, 201);
  });

  /** Rename and/or change the parameters (= a new version). System methods are locked: copy them first. */
  r.put("/methods/:id", require("methoden.gerer"), zValidator("json", methodInput.pick({ name: true, params: true }).partial(), validationHook), async (c) => {
    const m = await own(c, c.req.param("id") ?? ""), b = c.req.valid("json");
    if (m.isSystem) throw new HttpError(409, "method_system_locked");
    const set: Partial<typeof calcMethods.$inferInsert> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name;
    if (b.params !== undefined) {
      const params = parse(m.engine as "aw" | "matrix", b.params);
      set.currentVersion = m.currentVersion + 1;
      await db.insert(calcMethodVersions).values({ methodId: m.id, version: set.currentVersion, params: params as never, createdBy: who(c) });
    }
    const [n] = await db.update(calcMethods).set(set).where(eq(calcMethods.id, m.id)).returning();
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "calc_method", entityId: m.id, before: { name: m.name, version: m.currentVersion }, after: { name: n.name, version: n.currentVersion } });
    hub.publish(org(c), 0);
    return c.json(n);
  });

  /** Archive a custom method: insurers that used it fall back to the system method; vehicles keep their frozen version. */
  r.post("/methods/:id/archive", require("methoden.gerer"), async (c) => {
    const m = await own(c, c.req.param("id") ?? "");
    if (m.isSystem) throw new HttpError(409, "method_system_locked");
    await db.delete(insurerMethods).where(eq(insurerMethods.methodId, m.id));
    await db.update(calcMethods).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(calcMethods.id, m.id));
    await audit(db, { orgId: org(c), userId: who(c), action: "archive", entity: "calc_method", entityId: m.id });
    hub.publish(org(c), 0);
    return c.json({ ok: true });
  });

  r.get("/methods/:id/usage", require("methoden.gerer"), async (c) => {
    const m = await own(c, c.req.param("id") ?? "");
    const ins = await db.select({ id: insurers.id, name: insurers.name, country: insurerMethods.country }).from(insurerMethods).innerJoin(insurers, eq(insurers.id, insurerMethods.insurerId)).where(eq(insurerMethods.methodId, m.id));
    const byVersion = await db.select({ version: vehicles.methodVersion, n: sql<number>`count(*)::int` }).from(vehicles).where(and(eq(vehicles.methodId, m.id), isNull(vehicles.deletedAt))).groupBy(vehicles.methodVersion);
    return c.json({ insurers: ins, vehiclesByVersion: Object.fromEntries(byVersion.map((x) => [String(x.version), x.n])) });
  });

  /** Method of an insurer per country (null = system method). */
  r.get("/insurers/:id/methods", require("methoden.gerer"), async (c) => {
    const rows = await db.select().from(insurerMethods).innerJoin(insurers, eq(insurers.id, insurerMethods.insurerId)).where(and(eq(insurerMethods.insurerId, c.req.param("id") ?? ""), eq(insurers.orgId, org(c))));
    return c.json({ DE: rows.find((x) => x.insurer_methods.country === "DE")?.insurer_methods.methodId ?? null, ES: rows.find((x) => x.insurer_methods.country === "ES")?.insurer_methods.methodId ?? null });
  });
  r.put("/insurers/:id/methods", require("methoden.gerer"), zValidator("json", insurerMethodsInput, validationHook), async (c) => {
    const id = c.req.param("id") ?? "", b = c.req.valid("json");
    const [ins] = await db.select().from(insurers).where(and(eq(insurers.id, id), eq(insurers.orgId, org(c))));
    if (!ins) throw new HttpError(404, "insurer_not_found");
    for (const country of ["DE", "ES"] as const) {
      const mid = b[country];
      if (mid) {
        const m = await own(c, mid);
        if (m.country !== country || m.archivedAt) throw new HttpError(400, "method_mismatch");
      }
      await db.delete(insurerMethods).where(and(eq(insurerMethods.insurerId, id), eq(insurerMethods.country, country)));
      if (mid) await db.insert(insurerMethods).values({ insurerId: id, country, methodId: mid });
    }
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "insurer_methods", entityId: id, after: b });
    hub.publish(org(c), 0);
    return c.json(b);
  });

  return r;
}

