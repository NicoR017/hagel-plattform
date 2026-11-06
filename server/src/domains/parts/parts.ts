// Repair v2 (F2): spare parts of a car (ops, what a phone receives) and the catalogue of generic part names by zone, in four languages.
// Every rule is enforced HERE, not only in the UI.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DEFAULT_ZONE_KEYS, type ClientCatalogPart, type ClientCustomZone, type ClientPart, type ClientPartsRefs, type Op, type PartNames } from "@hagel/shared";
import { effectivePermissions, type Principal, type VehicleRef } from "../../permissions";
import type { Db } from "../../db";
import { partCatalog, partCatalogZones, partZones, repairEvents, vehicleParts, vehicles } from "../../schema";
import { Reject, lockVehicle, need, nextSeq, type OpOutcome, type Tx, type VehicleRow } from "../vehicles/sync";

type PartOp = Extract<Op, { type: "part.add" | "part.update" | "part.remove" }>;
export const isPartOp = (op: Op): op is PartOp => op.type === "part.add" || op.type === "part.update" || op.type === "part.remove";

type PartRow = typeof vehicleParts.$inferSelect;

async function touch(tx: Tx, u: Principal, row: VehicleRow): Promise<OpOutcome> {
  const seq = await nextSeq(tx);
  await tx.update(vehicles).set({ seq, updatedBy: u.id, updatedAt: new Date() }).where(eq(vehicles.id, row.id));
  return { status: "ok", orgId: row.orgId, seq, vehicleId: row.id };
}

/** is this zone known: a default zone (element of the schema, interior area) or an active zone added by the admin */
export async function zoneExists(db: Pick<Db, "select">, orgId: string, key: string): Promise<boolean> {
  if (DEFAULT_ZONE_KEYS.includes(key)) return true;
  const [z] = await db.select({ id: partZones.id }).from(partZones).where(and(eq(partZones.orgId, orgId), eq(partZones.key, key), eq(partZones.active, true)));
  return !!z;
}

export async function applyPartOp(tx: Tx, u: Principal, op: PartOp): Promise<OpOutcome> {
  switch (op.type) {
    case "part.add": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "vehicules.modifier", ref); need(u, "pieces.voir", ref);
      const p = op.part;
      const [dup] = await tx.select({ id: vehicleParts.id, vehicleId: vehicleParts.vehicleId }).from(vehicleParts).where(eq(vehicleParts.id, p.id));
      if (dup) { if (dup.vehicleId === row.id) return { status: "ok", orgId: row.orgId, seq: row.seq, vehicleId: row.id }; throw new Reject("not_allowed"); } // a replayed operation is applied once
      if (p.zoneKey && !(await zoneExists(tx, row.orgId, p.zoneKey))) throw new Reject("part_zone_unknown");
      if (p.catalogId) {
        const [c] = await tx.select({ id: partCatalog.id }).from(partCatalog).where(and(eq(partCatalog.id, p.catalogId), eq(partCatalog.orgId, row.orgId)));
        if (!c) throw new Reject("part_catalog_unknown");
      }
      if (p.source === "replace") {
        if (!p.zoneKey) throw new Reject("part_zone_unknown");
        // one "replaced element" part per element: a second add (another phone) is the same part
        const [have] = await tx.select({ id: vehicleParts.id }).from(vehicleParts).where(and(eq(vehicleParts.vehicleId, row.id), eq(vehicleParts.zoneKey, p.zoneKey), eq(vehicleParts.source, "replace"), isNull(vehicleParts.deletedAt)));
        if (have) return { status: "ok", orgId: row.orgId, seq: row.seq, vehicleId: row.id };
      }
      const n = (await tx.select({ n: sql<number>`count(*)::int` }).from(vehicleParts).where(and(eq(vehicleParts.vehicleId, row.id), isNull(vehicleParts.deletedAt))))[0].n;
      if (n >= 200) throw new Reject("part_limit");
      await tx.insert(vehicleParts).values({ id: p.id, vehicleId: row.id, zoneKey: p.zoneKey, catalogId: p.catalogId, name: p.name, qty: p.qty, oemRef: p.oemRef, source: p.source, createdBy: u.id });
      await tx.insert(repairEvents).values({ vehicleId: row.id, userId: u.id, type: "part_added", payload: { partId: p.id, name: p.name, zone: p.zoneKey, source: p.source } as never });
      return touch(tx, u, row);
    }
    case "part.update": {
      const { part, row } = await partOf(tx, u, op.partId);
      if (!part) return { status: "ok", orgId: row.orgId, seq: row.seq, vehicleId: row.id };
      const set: Partial<typeof vehicleParts.$inferInsert> = { updatedAt: new Date() };
      if (op.fields.qty !== undefined) set.qty = op.fields.qty;
      if (op.fields.oemRef !== undefined) set.oemRef = op.fields.oemRef;
      if (op.fields.name !== undefined && !part.catalogId) set.name = op.fields.name; // a catalogue part keeps the catalogue name
      await tx.update(vehicleParts).set(set).where(eq(vehicleParts.id, part.id));
      await tx.insert(repairEvents).values({ vehicleId: row.id, userId: u.id, type: "part_updated", payload: { partId: part.id, fields: Object.keys(op.fields) } as never });
      return touch(tx, u, row);
    }
    case "part.remove": {
      const { part, row } = await partOf(tx, u, op.partId);
      if (!part) return { status: "ok", orgId: row.orgId, seq: row.seq, vehicleId: row.id };
      // never deleted for good: kept with deleted_at and the status "cancelled" (the history keeps who and when)
      await tx.update(vehicleParts).set({ deletedAt: new Date(), status: "cancelled", updatedAt: new Date() }).where(eq(vehicleParts.id, part.id));
      await tx.insert(repairEvents).values({ vehicleId: row.id, userId: u.id, type: "part_removed", payload: { partId: part.id, name: part.name } as never });
      return touch(tx, u, row);
    }
  }
}

async function partOf(tx: Tx, u: Principal, partId: string): Promise<{ part: PartRow | null; row: VehicleRow; ref: VehicleRef }> {
  const [p] = await tx.select().from(vehicleParts).where(eq(vehicleParts.id, partId));
  if (!p) throw new Reject("part_not_found");
  const { row, ref } = await lockVehicle(tx, u, p.vehicleId).catch(() => { throw new Reject("part_not_found"); });
  need(u, "vehicules.modifier", ref); need(u, "pieces.voir", ref);
  return { part: p.deletedAt ? null : p, row, ref };
}

/** The parts of a set of cars, for the users who may see parts (a customer-side account never does). */
export async function partsFor(db: Pick<Db, "select">, u: Principal, items: { row: VehicleRow; ref: VehicleRef }[]): Promise<Map<string, ClientPart[]>> {
  const out = new Map<string, ClientPart[]>();
  const eligible = items.filter(({ ref }) => effectivePermissions(u, ref).has("pieces.voir"));
  if (!eligible.length) return out;
  const ids = eligible.map((x) => x.row.id);
  const rows = await db.select().from(vehicleParts).where(and(inArray(vehicleParts.vehicleId, ids), isNull(vehicleParts.deletedAt))).orderBy(asc(vehicleParts.createdAt));
  for (const { row } of eligible) out.set(row.id, []);
  for (const r of rows) out.get(r.vehicleId)?.push({ id: r.id, zoneKey: r.zoneKey, catalogId: r.catalogId, name: r.name, qty: r.qty, oemRef: r.oemRef, source: r.source, status: r.status });
  return out;
}

/**
 * The parts of cars as labels (printed on the estimate / reports, to-dos of the repair board, export): the parts of the car, with "× n" when the quantity is more than one.
 * A car that has ANY part row (even a removed one) uses its parts only: the old header list "partsToReplace" is then frozen (kept for a rollback), never read again.
 * A car without part rows (not migrated yet / created by an older app) falls back to the header list.
 */
export async function partLabelsFor(db: Pick<Db, "select">, cars: { id: string; header: unknown }[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const rows = cars.length ? await db.select({ vehicleId: vehicleParts.vehicleId, name: vehicleParts.name, qty: vehicleParts.qty, deletedAt: vehicleParts.deletedAt }).from(vehicleParts).where(inArray(vehicleParts.vehicleId, cars.map((c) => c.id))).orderBy(asc(vehicleParts.createdAt)) : [];
  for (const c of cars) {
    const mine = rows.filter((r) => r.vehicleId === c.id);
    if (mine.length) out.set(c.id, mine.filter((r) => !r.deletedAt).map((r) => (r.qty > 1 ? `${r.name} × ${r.qty}` : r.name)));
    else {
      const h = (c.header as Record<string, unknown> | null)?.partsToReplace;
      out.set(c.id, Array.isArray(h) ? h.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
    }
  }
  return out;
}

// ------------------------------------------------------------------ catalogue

export const namesOf = (r: { nameDe: string; nameEn: string; nameFr: string; nameEs: string }): PartNames => ({ de: r.nameDe, en: r.nameEn, fr: r.nameFr, es: r.nameEs });

/** A small starter catalogue (first use only: when the organisation has no catalogue row at all, active or not). The admin edits it freely. */
const STARTER: { n: PartNames; z: string[] }[] = [
  { n: { de: "Zierleiste Dach", en: "Roof trim strip", fr: "Baguette de toit", es: "Moldura de techo" }, z: ["dach", "dachholm_l", "dachholm_r"] },
  { n: { de: "Dachreling", en: "Roof rails", fr: "Barres de toit", es: "Barras de techo" }, z: ["dach", "dachholm_l", "dachholm_r"] },
  { n: { de: "Antenne", en: "Antenna", fr: "Antenne", es: "Antena" }, z: ["dach", "heck"] },
  { n: { de: "Emblem", en: "Badge", fr: "Emblème", es: "Emblema" }, z: ["haube", "heck", "heck_u"] },
  { n: { de: "Außenspiegel", en: "Door mirror", fr: "Rétroviseur extérieur", es: "Retrovisor exterior" }, z: ["tuer_vl", "tuer_vr"] },
  { n: { de: "Türdichtung", en: "Door seal", fr: "Joint de porte", es: "Junta de puerta" }, z: ["tuer_vl", "tuer_hl", "tuer_vr", "tuer_hr"] },
  { n: { de: "Seitenschutzleiste", en: "Side moulding", fr: "Baguette latérale", es: "Moldura lateral" }, z: ["tuer_vl", "tuer_hl", "tuer_vr", "tuer_hr", "kfl_vl", "kfl_vr"] },
  { n: { de: "Clips Verkleidung", en: "Trim clips", fr: "Clips de garniture", es: "Clips de revestimiento" }, z: ["int_verkleidung", "int_saeulen", "int_himmel"] },
  { n: { de: "Dachhimmel", en: "Headliner", fr: "Ciel de toit", es: "Techo interior" }, z: ["int_himmel"] },
  { n: { de: "Haltegriff", en: "Grab handle", fr: "Poignée de maintien", es: "Asa de sujeción" }, z: ["int_himmel"] },
  { n: { de: "Säulenverkleidung", en: "Pillar trim", fr: "Garniture de montant", es: "Revestimiento de pilar" }, z: ["int_saeulen"] },
  { n: { de: "Heckklappen-Dichtung", en: "Tailgate seal", fr: "Joint de hayon", es: "Junta del portón" }, z: ["heck", "heck_u"] },
];

export async function seedStarterCatalogue(db: Db, orgId: string): Promise<void> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(partCatalog).where(eq(partCatalog.orgId, orgId));
  if (n > 0) return;
  for (const s of STARTER) {
    const [c] = await db.insert(partCatalog).values({ orgId, nameDe: s.n.de, nameEn: s.n.en, nameFr: s.n.fr, nameEs: s.n.es, translationValidated: true }).returning();
    await db.insert(partCatalogZones).values(s.z.map((zoneKey) => ({ catalogId: c.id, zoneKey })));
  }
}

/** The catalogue as a phone needs it (active parts and zones). */
export async function catalogueRefs(db: Db, orgId: string): Promise<ClientPartsRefs> {
  await seedStarterCatalogue(db, orgId);
  const zs = await db.select().from(partZones).where(and(eq(partZones.orgId, orgId), eq(partZones.active, true))).orderBy(asc(partZones.sort), asc(partZones.createdAt));
  const cs = await db.select().from(partCatalog).where(and(eq(partCatalog.orgId, orgId), eq(partCatalog.active, true))).orderBy(asc(partCatalog.nameDe));
  const links = cs.length ? await db.select().from(partCatalogZones).where(inArray(partCatalogZones.catalogId, cs.map((c) => c.id))) : [];
  const zones: ClientCustomZone[] = zs.map((z) => ({ key: z.key, group: z.group === "interior" ? "interior" : "exterior", names: namesOf(z) }));
  const catalog: ClientCatalogPart[] = cs.map((c) => ({ id: c.id, names: namesOf(c), zoneKeys: links.filter((l) => l.catalogId === c.id).map((l) => l.zoneKey), validated: c.translationValidated }));
  return { zones, catalog };
}
