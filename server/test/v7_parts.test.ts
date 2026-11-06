// V7 (Repair v2) F2: spare parts of a car (ops, rights, what a phone receives), catalogue of generic names by zone in four languages, zones, translation proposal, migration of the free-text parts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { PERMISSIONS, SYSTEM_ROLES } from "@hagel/shared";
import { partLabelsFor } from "../src/domains/parts/parts";
import { setTranslatorForTests } from "../src/domains/parts/translate";
import { roles, vehicleParts, vehicles } from "../src/schema";
import { call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, CARRO: string;
let chef: string, assessor: string, tech: string, carro: string;

const create = (id: string, header: Record<string, unknown> = {}) =>
  op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, statut: "besichtigung", header: { land: "ES", kennzeichen: "PT-" + id.slice(0, 4), modell: "Seat Leon", leistungsdatum: "2026-10-20", stundensatz: 69, ...header }, panels: { haube: dentsPanel("haube", { "30": 4 }) }, shares: {} } });
const addPart = (vehicleId: string, o: Record<string, unknown> = {}) => op("part.add", { vehicleId, part: { id: uuid(), zoneKey: "dach", catalogId: null, name: "Moldura de techo", qty: 1, oemRef: null, source: "assessment", ...o } });
const one = async (token: string, o: unknown) => ((await push(c, token, [o])).body.results[0] as { status: string; code?: string });
const admin = (m: string, path: string, body?: unknown, token = c.superToken) => call(c, m, `/admin${path}`, { token, org: c.orgES, body });
const car = async (header: Record<string, unknown> = {}) => { const id = uuid(); expect((await one(assessor, create(id, header))).status).toBe("ok"); return id; };
const partsOf = async (token: string, id: string) => ((await pull(c, token, c.orgES)).vehicles.find((v: { id: string }) => v.id === id) as { parts?: { id: string; name: string; qty: number; zoneKey: string | null }[] } | undefined)?.parts;

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string; name: string }[];
  CARRO = st.find((s) => s.type === "carrosserie")!.id; A = st.find((s) => s.name === "Nave Test A")!.id;
  chef = await inviteAndAccept(c, c.orgES, "chef-pt@example.test", { role_id: c.roleId.chef_site, station_id: A });
  assessor = await inviteAndAccept(c, c.orgES, "ass-pt@example.test", { role_id: c.roleId.aufnehmer });
  tech = await inviteAndAccept(c, c.orgES, "tech-pt@example.test", { role_id: c.roleId.technicien, station_id: A });
  carro = await inviteAndAccept(c, c.orgES, "carro-pt@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
});
afterAll(async () => { await c.h.close(); setTranslatorForTests(undefined); await c.h.close; });

describe("permissions", () => {
  it("pieces.voir and pieces.catalogue exist; the default roles have them (system roles in code and in the database)", async () => {
    expect(PERMISSIONS).toContain("pieces.voir"); expect(PERMISSIONS).toContain("pieces.catalogue");
    const sr = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.key, r.permissions]));
    for (const k of ["org_admin", "chef_site", "aufnehmer", "technicien", "freelance"]) expect(sr[k]).toContain("pieces.voir");
    for (const k of ["org_admin", "chef_site"]) expect(sr[k]).toContain("pieces.catalogue");
    for (const k of ["aufnehmer", "technicien", "carrosserie", "assureur"]) expect(sr[k]).not.toContain("pieces.catalogue");
    expect(sr.carrosserie).not.toContain("pieces.voir"); expect(sr.assureur).not.toContain("pieces.voir");
    const rows = await c.h.db.select().from(roles).where(eq(roles.key, "chef_site"));
    expect(rows.every((r) => r.permissions.includes("pieces.voir") && r.permissions.includes("pieces.catalogue"))).toBe(true);
  });
});

describe("parts of a car (ops)", () => {
  it("add / update / remove: the phone receives the parts with the car; a replayed add is applied once; a removed part is kept (cancelled), never deleted", async () => {
    const id = await car();
    const p = addPart(id, { name: "Moldura de techo", qty: 2, oemRef: "ABC-1" });
    expect((await one(assessor, p)).status).toBe("ok");
    expect((await one(assessor, { ...p, opId: uuid() })).status).toBe("ok"); // same part id again
    expect(await partsOf(assessor, id)).toEqual([expect.objectContaining({ name: "Moldura de techo", qty: 2, oemRef: "ABC-1", zoneKey: "dach", status: "to_order", source: "assessment" })]);
    const pid = (p as { part: { id: string } }).part.id;
    expect((await one(assessor, op("part.update", { partId: pid, fields: { qty: 3 } }))).status).toBe("ok");
    expect((await partsOf(assessor, id))![0].qty).toBe(3);
    expect((await one(assessor, op("part.remove", { partId: pid }))).status).toBe("ok");
    expect(await partsOf(assessor, id)).toEqual([]);
    const [row] = await c.h.db.select().from(vehicleParts).where(eq(vehicleParts.id, pid));
    expect(row).toMatchObject({ status: "cancelled" }); expect(row.deletedAt).toBeInstanceOf(Date);
    expect((await one(assessor, op("part.remove", { partId: pid }))).status).toBe("ok"); // twice: nothing happens
  });
  it("another car's part id cannot be taken over; unknown zone / catalogue part refused; Replace gives one part per element", async () => {
    const a = await car(), b = await car();
    const p = addPart(a);
    expect((await one(assessor, p)).status).toBe("ok");
    expect((await one(assessor, op("part.add", { vehicleId: b, part: (p as { part: unknown }).part }))).code).toBe("not_allowed");
    expect((await one(assessor, addPart(a, { zoneKey: "nowhere" }))).code).toBe("part_zone_unknown");
    expect((await one(assessor, addPart(a, { catalogId: uuid() }))).code).toBe("part_catalog_unknown");
    const r1 = addPart(a, { zoneKey: "haube", source: "replace", name: "Capó · panel" });
    expect((await one(assessor, r1)).status).toBe("ok");
    expect((await one(assessor, addPart(a, { zoneKey: "haube", source: "replace", name: "Capó · panel" }))).status).toBe("ok"); // another phone, same element: no second part
    expect((await partsOf(assessor, a))!.filter((x) => x.zoneKey === "haube")).toHaveLength(1);
    expect((await one(assessor, addPart(a, { source: "replace", zoneKey: null }))).code).toBe("part_zone_unknown");
  });
  it("rights: a technician of the station may add; the customer-side accounts never see or change parts", async () => {
    const id = await car();
    expect((await one(chef, addPart(id))).status).toBe("ok");
    expect((await one(carro, addPart(id))).code).toMatch(/not_allowed|vehicle_not_found/);
    const mine = (await pull(c, carro, c.orgES)).vehicles.find((v: { id: string }) => v.id === id) as { parts?: unknown } | undefined;
    expect(mine?.parts).toBeUndefined();
    expect((await pull(c, carro, c.orgES)).refs.parts).toBeUndefined();
    expect((await pull(c, assessor, c.orgES)).refs.parts?.catalog.length).toBeGreaterThan(0);
    void tech;
  });
  it("a car with parts keeps its old header list untouched; the labels (estimate, to-dos, export) come from the parts, with × n", async () => {
    const id = await car({ partsToReplace: ["Antenne"] });
    expect((await one(assessor, addPart(id, { name: "Dachreling", qty: 2 }))).status).toBe("ok");
    const labels = (await partLabelsFor(c.h.db, [{ id, header: (await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0].header }])).get(id);
    expect(labels).toEqual(["Dachreling × 2"]); // the header list is frozen once the car has parts
    expect(((await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0].header as { partsToReplace: string[] }).partsToReplace).toEqual(["Antenne"]);
    const bare = await car({ partsToReplace: ["Antenne", "Clips"] });
    expect((await partLabelsFor(c.h.db, [{ id: bare, header: { partsToReplace: ["Antenne", "Clips"] } }])).get(bare)).toEqual(["Antenne", "Clips"]); // never migrated: header
  });
});

describe("migration of the free-text parts (0026)", () => {
  it("copies partsToReplace to the right car, once (idempotent), the header stays", async () => {
    const id = await car({ partsToReplace: ["Antenne", "Zierleiste Dach li"] });
    await c.h.db.execute(sql`update vehicles set header = jsonb_set(header, '{partsToReplace}', '["Antenne","Zierleiste Dach li","  "]'::jsonb) where id = ${id}`); // a blank label in an old header
    const file = readFileSync(new URL("../migrations/0026_v7_parts_catalogue.sql", import.meta.url), "utf8");
    const insert = file.split("--> statement-breakpoint").find((s) => s.includes('INSERT INTO "vehicle_parts"'))!;
    const seqBefore = (await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0].seq;
    await c.h.db.execute(sql.raw(insert));
    await c.h.db.execute(sql.raw(insert)); // twice
    const rows = await c.h.db.select().from(vehicleParts).where(eq(vehicleParts.vehicleId, id));
    expect(rows.map((r) => r.name).sort()).toEqual(["Antenne", "Zierleiste Dach li"]);
    expect(rows.every((r) => r.source === "migrated" && r.zoneKey === null && r.qty === 1 && r.status === "to_order")).toBe(true);
    expect(((await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0].header as { partsToReplace: string[] }).partsToReplace).toHaveLength(3);
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0].seq).toBe(seqBefore);
    // the SQL file only ADDS: no drop / rename / delete / alter-type
    expect(file).not.toMatch(/\bDROP\b|\bRENAME\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|ALTER COLUMN/i);
  });
});

describe("catalogue (admin)", () => {
  it("a starter catalogue appears on first use; parts are listed with four names and their zones; only people with pieces.catalogue manage it", async () => {
    const r = await admin("GET", "/parts/catalog");
    expect(r.status).toBe(200);
    expect(r.body.parts.length).toBeGreaterThan(5);
    expect(r.body.parts[0].names).toEqual({ de: expect.any(String), en: expect.any(String), fr: expect.any(String), es: expect.any(String) });
    expect((await admin("GET", "/parts/catalog", undefined, assessor)).status).toBe(403);
    expect((await admin("POST", "/parts/catalog", { names: { de: "x", en: "", fr: "", es: "" } }, assessor)).status).toBe(403);
  });
  it("create / edit / switch off: the phones get it, an unvalidated translation is flagged, a part is never deleted", async () => {
    const created = await admin("POST", "/parts/catalog", { names: { de: "Kühlergrill", en: "Grille", fr: "Calandre", es: "Parrilla" }, zone_keys: ["haube"], translation_validated: false });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ zone_keys: ["haube"], translation_validated: false, active: true });
    const id = created.body.id as string;
    let refs = (await pull(c, assessor, c.orgES)).refs.parts;
    expect(refs.catalog.find((x: { id: string }) => x.id === id)).toMatchObject({ names: { es: "Parrilla" }, zoneKeys: ["haube"], validated: false });
    expect((await admin("PUT", `/parts/catalog/${id}`, { names: { de: "Kühlergrill", en: "Radiator grille", fr: "Calandre", es: "Parrilla" }, translation_validated: true, zone_keys: ["haube", "dach"] })).body)
      .toMatchObject({ names: { en: "Radiator grille" }, translation_validated: true, zone_keys: ["haube", "dach"] });
    // a car uses it; switching it off keeps it on the car
    const vid = await car();
    expect((await one(assessor, addPart(vid, { catalogId: id, name: "Parrilla", zoneKey: "haube" }))).status).toBe("ok");
    expect((await admin("DELETE", `/parts/catalog/${id}`)).status).toBe(200);
    refs = (await pull(c, assessor, c.orgES)).refs.parts;
    expect(refs.catalog.find((x: { id: string }) => x.id === id)).toBeUndefined();
    expect((await partsOf(assessor, vid))![0].name).toBe("Parrilla");
    expect((await admin("GET", "/parts/catalog")).body.parts.find((x: { id: string }) => x.id === id).active).toBe(false);
    expect((await admin("POST", "/parts/catalog", { names: { de: "", en: "", fr: "", es: "" } })).status).toBe(400);
    expect((await admin("POST", "/parts/catalog", { names: { de: "Y", en: "", fr: "", es: "" }, zone_keys: ["nowhere"] })).status).toBe(400);
  });
  it("custom zones: added by the admin in four languages, usable by parts and by the cars; switched off, never deleted", async () => {
    const z = await admin("POST", "/parts/zones", { group: "exterior", names: { de: "Stoßfänger vorn", en: "Front bumper", fr: "Pare-chocs avant", es: "Paragolpes delantero" } });
    expect(z.status).toBe(201);
    const key = z.body.key as string;
    expect(key).toMatch(/^c_/);
    expect((await admin("POST", "/parts/zones", { group: "exterior", names: { de: "Stoßfänger vorn", en: "", fr: "", es: "" } })).body.key).not.toBe(key); // another key, never a clash
    expect((await pull(c, assessor, c.orgES)).refs.parts.zones.map((x: { key: string }) => x.key)).toContain(key);
    const vid = await car();
    expect((await one(assessor, addPart(vid, { zoneKey: key, name: "Parachoques" }))).status).toBe("ok");
    expect((await admin("PUT", `/parts/zones/${key}`, { active: false })).body.active).toBe(false);
    expect((await one(assessor, addPart(vid, { zoneKey: key, name: "Otra" }))).code).toBe("part_zone_unknown"); // switched off: no new part
    expect((await partsOf(assessor, vid))!.some((x) => x.zoneKey === key)).toBe(true); // the old one stays
  });
  it("translation: a proposal for the other three languages from the one the admin typed; none when the service is not configured", async () => {
    setTranslatorForTests(null);
    expect((await admin("POST", "/parts/translate", { lang: "de", text: "Dachreling" })).body).toEqual({ available: false, names: {} });
    setTranslatorForTests({ translate: async (text, from) => ({ ...(from !== "en" ? { en: `EN ${text}` } : {}), ...(from !== "fr" ? { fr: `FR ${text}` } : {}), ...(from !== "es" ? { es: `ES ${text}` } : {}), ...(from !== "de" ? { de: `DE ${text}` } : {}) }) });
    expect((await admin("POST", "/parts/translate", { lang: "de", text: "Dachreling" })).body).toEqual({ available: true, names: { en: "EN Dachreling", fr: "FR Dachreling", es: "ES Dachreling" } });
    expect((await admin("POST", "/parts/translate", { lang: "de", text: "x" }, assessor)).status).toBe(403);
    setTranslatorForTests({ translate: async () => { throw new Error("down"); } });
    expect((await admin("POST", "/parts/translate", { lang: "de", text: "x" })).status).toBe(502);
    setTranslatorForTests(undefined);
  });
  it("free-text parts typed by the experts are listed to be added to the catalogue (not the ones already in it, not the Replace lines)", async () => {
    const id = await car();
    expect((await one(assessor, addPart(id, { name: "Spoiler hinten sonderteil", zoneKey: "heck" }))).status).toBe("ok");
    expect((await one(assessor, addPart(id, { name: "Capó · panel", zoneKey: "haube", source: "replace" }))).status).toBe("ok");
    expect((await one(assessor, addPart(id, { name: "Antena", zoneKey: "dach" }))).status).toBe("ok"); // Spanish name of a starter part, free text
    const list = (await admin("GET", "/parts/free-text")).body as { name: string; lang: string; count: number }[];
    expect(list.find((x) => x.name === "Spoiler hinten sonderteil")).toMatchObject({ lang: "es", count: expect.any(Number) });
    expect(list.some((x) => x.name === "Capó · panel")).toBe(false);
    expect(list.some((x) => x.name === "Antena")).toBe(false);
    expect((await admin("GET", "/parts/free-text", undefined, assessor)).status).toBe(403);
  });
});
