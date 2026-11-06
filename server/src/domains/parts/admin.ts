// Admin routes of the parts catalogue (mounted under /admin): parts with a name in four languages, zones, automatic translation, free-text parts typed by experts.
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { DEFAULT_ZONE_KEYS, type Permission } from "@hagel/shared";
import { audit } from "../../audit";
import type { Db } from "../../db";
import type { Env } from "../../env";
import type { Hub } from "../../hub";
import { HttpError } from "../auth/auth";
import { partCatalog, partCatalogZones, partZones, vehicleParts, vehicles } from "../../schema";
import { namesOf, seedStarterCatalogue } from "./parts";
import { getTranslator } from "./translate";

interface Deps { db: Db; hub: Hub; require: (p: Permission) => MiddlewareHandler<Env>; validationHook: (r: { success: boolean }, c: Context) => Response | undefined }

const name = z.string().trim().max(120);
const namesInput = z.object({ de: name, en: name, fr: name, es: name });
const zoneKey = z.string().trim().regex(/^[a-z0-9_]{2,40}$/);
const catalogInput = z.object({ names: namesInput, zone_keys: z.array(zoneKey).max(60).default([]), translation_validated: z.boolean().default(false) });
const zoneInput = z.object({ group: z.enum(["exterior", "interior"]), names: namesInput });

export function partsAdminRoutes({ db, hub, require, validationHook }: Deps) {
  const r = new Hono<Env>();
  const org = (c: Context<Env>) => c.get("orgId");
  const who = (c: Context<Env>) => c.get("principal").id;
  const touch = (orgId: string) => hub.publish(orgId, 0); // the catalogue travels with the refs of every pull

  const knownZone = async (orgId: string, key: string) => DEFAULT_ZONE_KEYS.includes(key) || !!(await db.select({ id: partZones.id }).from(partZones).where(and(eq(partZones.orgId, orgId), eq(partZones.key, key))))[0];
  const checkZones = async (orgId: string, keys: string[]) => { for (const k of keys) if (!(await knownZone(orgId, k))) throw new HttpError(400, "part_zone_unknown"); };
  const needNames = (n: { de: string; en: string; fr: string; es: string }) => { if (!(n.de || n.en || n.fr || n.es)) throw new HttpError(400, "part_names_required"); };

  const shape = async (orgId: string) => {
    const cs = await db.select().from(partCatalog).where(eq(partCatalog.orgId, orgId)).orderBy(asc(partCatalog.nameDe));
    const links = cs.length ? await db.select().from(partCatalogZones).where(inArray(partCatalogZones.catalogId, cs.map((c) => c.id))) : [];
    return cs.map((c) => ({ id: c.id, names: namesOf(c), zone_keys: links.filter((l) => l.catalogId === c.id).map((l) => l.zoneKey), translation_validated: c.translationValidated, active: c.active }));
  };

  r.get("/parts/catalog", require("pieces.catalogue"), async (c) => {
    await seedStarterCatalogue(db, org(c));
    const zs = await db.select().from(partZones).where(eq(partZones.orgId, org(c))).orderBy(asc(partZones.sort), asc(partZones.createdAt));
    return c.json({ parts: await shape(org(c)), zones: zs.map((z) => ({ key: z.key, group: z.group, names: namesOf(z), active: z.active })) });
  });

  r.post("/parts/catalog", require("pieces.catalogue"), zValidator("json", catalogInput, validationHook), async (c) => {
    const b = c.req.valid("json");
    needNames(b.names);
    const zk = [...new Set(b.zone_keys)];
    await checkZones(org(c), zk);
    const [row] = await db.insert(partCatalog).values({ orgId: org(c), nameDe: b.names.de, nameEn: b.names.en, nameFr: b.names.fr, nameEs: b.names.es, translationValidated: b.translation_validated }).returning();
    if (zk.length) await db.insert(partCatalogZones).values(zk.map((zoneKey) => ({ catalogId: row.id, zoneKey })));
    await audit(db, { orgId: org(c), userId: who(c), action: "create", entity: "part_catalog", entityId: row.id, after: b });
    touch(org(c));
    return c.json((await shape(org(c))).find((x) => x.id === row.id), 201);
  });

  r.put("/parts/catalog/:id", require("pieces.catalogue"), zValidator("json", catalogInput.partial().extend({ active: z.boolean().optional() }), validationHook), async (c) => {
    const id = c.req.param("id") ?? "", b = c.req.valid("json");
    const [before] = await db.select().from(partCatalog).where(and(eq(partCatalog.id, id), eq(partCatalog.orgId, org(c))));
    if (!before) throw new HttpError(404, "part_catalog_unknown");
    const set: Partial<typeof partCatalog.$inferInsert> = { updatedAt: new Date() };
    if (b.names) { needNames(b.names); Object.assign(set, { nameDe: b.names.de, nameEn: b.names.en, nameFr: b.names.fr, nameEs: b.names.es }); }
    if (b.translation_validated !== undefined) set.translationValidated = b.translation_validated;
    if (b.active !== undefined) set.active = b.active;
    await db.transaction(async (tx) => {
      await tx.update(partCatalog).set(set).where(eq(partCatalog.id, id));
      if (b.zone_keys) {
        const zk = [...new Set(b.zone_keys)];
        await checkZones(org(c), zk);
        await tx.delete(partCatalogZones).where(eq(partCatalogZones.catalogId, id));
        if (zk.length) await tx.insert(partCatalogZones).values(zk.map((zoneKey) => ({ catalogId: id, zoneKey })));
      }
    });
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "part_catalog", entityId: id, before, after: b });
    touch(org(c));
    return c.json((await shape(org(c))).find((x) => x.id === id));
  });

  // a catalogue part is never deleted (cars point to it): "delete" = switch it off (it stays on the cars that have it)
  r.delete("/parts/catalog/:id", require("pieces.catalogue"), async (c) => {
    const id = c.req.param("id") ?? "";
    const [before] = await db.select().from(partCatalog).where(and(eq(partCatalog.id, id), eq(partCatalog.orgId, org(c))));
    if (!before) throw new HttpError(404, "part_catalog_unknown");
    await db.update(partCatalog).set({ active: false, updatedAt: new Date() }).where(eq(partCatalog.id, id));
    await audit(db, { orgId: org(c), userId: who(c), action: "deactivate", entity: "part_catalog", entityId: id, before });
    touch(org(c));
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ zones added by the admin
  r.post("/parts/zones", require("pieces.catalogue"), zValidator("json", zoneInput, validationHook), async (c) => {
    const b = c.req.valid("json");
    needNames(b.names);
    const base = (b.names.de || b.names.en || b.names.fr || b.names.es).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28) || "zone";
    let key = `c_${base}`, n = 1;
    while (DEFAULT_ZONE_KEYS.includes(key) || (await db.select({ id: partZones.id }).from(partZones).where(and(eq(partZones.orgId, org(c)), eq(partZones.key, key))))[0]) key = `c_${base}_${++n}`;
    const [z] = await db.insert(partZones).values({ orgId: org(c), key, group: b.group, nameDe: b.names.de, nameEn: b.names.en, nameFr: b.names.fr, nameEs: b.names.es }).returning();
    await audit(db, { orgId: org(c), userId: who(c), action: "create", entity: "part_zone", entityId: z.id, after: b });
    touch(org(c));
    return c.json({ key: z.key, group: z.group, names: namesOf(z), active: z.active }, 201);
  });
  r.put("/parts/zones/:key", require("pieces.catalogue"), zValidator("json", zoneInput.partial().extend({ active: z.boolean().optional() }), validationHook), async (c) => {
    const key = c.req.param("key") ?? "", b = c.req.valid("json");
    const [before] = await db.select().from(partZones).where(and(eq(partZones.orgId, org(c)), eq(partZones.key, key)));
    if (!before) throw new HttpError(404, "part_zone_unknown");
    const set: Partial<typeof partZones.$inferInsert> = {};
    if (b.group) set.group = b.group;
    if (b.names) { needNames(b.names); Object.assign(set, { nameDe: b.names.de, nameEn: b.names.en, nameFr: b.names.fr, nameEs: b.names.es }); }
    if (b.active !== undefined) set.active = b.active;
    if (Object.keys(set).length) await db.update(partZones).set(set).where(eq(partZones.id, before.id));
    await audit(db, { orgId: org(c), userId: who(c), action: "update", entity: "part_zone", entityId: before.id, before, after: b });
    touch(org(c));
    const [z] = await db.select().from(partZones).where(eq(partZones.id, before.id));
    return c.json({ key: z.key, group: z.group, names: namesOf(z), active: z.active });
  });

  // ------------------------------------------------------------ automatic translation (proposal only: the admin validates or corrects)
  r.post("/parts/translate", require("pieces.catalogue"), zValidator("json", z.object({ lang: z.enum(["de", "en", "fr", "es"]), text: z.string().trim().min(1).max(120) }), validationHook), async (c) => {
    const { lang, text } = c.req.valid("json");
    const tr = getTranslator();
    if (!tr) return c.json({ available: false, names: {} });
    try { return c.json({ available: true, names: await tr.translate(text, lang) }); }
    catch { throw new HttpError(502, "translation_failed"); }
  });

  // ------------------------------------------------------------ free-text parts typed by experts ("Add to the catalogue")
  r.get("/parts/free-text", require("pieces.catalogue"), async (c) => {
    const rows = await db.select({ name: vehicleParts.name, land: sql<string>`coalesce(${vehicles.header} ->> 'land', 'DE')`, n: sql<number>`count(*)::int` })
      .from(vehicleParts).innerJoin(vehicles, eq(vehicles.id, vehicleParts.vehicleId))
      .where(and(eq(vehicles.orgId, org(c)), isNull(vehicleParts.catalogId), isNull(vehicleParts.deletedAt), sql`${vehicleParts.source} <> 'replace'`))
      .groupBy(vehicleParts.name, sql`coalesce(${vehicles.header} ->> 'land', 'DE')`).orderBy(sql`count(*) desc`, asc(vehicleParts.name)).limit(200);
    const cs = await db.select().from(partCatalog).where(eq(partCatalog.orgId, org(c)));
    const known = new Set(cs.flatMap((x) => [x.nameDe, x.nameEn, x.nameFr, x.nameEs]).filter(Boolean).map((s) => s.toLowerCase()));
    const merged = new Map<string, { name: string; lang: "de" | "es"; count: number }>();
    for (const x of rows) {
      const k = `${x.name.toLowerCase()}|${x.land}`;
      if (known.has(x.name.toLowerCase())) continue; // already in the catalogue under that name
      const e = merged.get(k); if (e) e.count += x.n; else merged.set(k, { name: x.name, lang: x.land === "ES" ? "es" : "de", count: x.n });
    }
    return c.json([...merged.values()]);
  });
  return r;
}
