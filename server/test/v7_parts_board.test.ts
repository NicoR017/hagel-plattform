// V7 (Repair v2) F3a: life of a spare part on the car — delivered (reception right), installed with a before photo (taken at disassembly) and an after photo, returned, and the Finish rule.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PERMISSIONS, SYSTEM_ROLES } from "@hagel/shared";
import { finishBlockers } from "../src/domains/repair/repair";
import { photos, repairEvents, roles, vehicleParts } from "../src/schema";
import { call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, CARRO: string;
let chef: string, assessor: string, tech: string;

const create = (id: string) =>
  op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, statut: "besichtigung", header: { land: "ES", kennzeichen: "PB-" + id.slice(0, 4), modell: "Seat Leon", leistungsdatum: "2026-10-20", stundensatz: 69 }, panels: { haube: dentsPanel("haube", { "30": 4 }) }, shares: {} } });
const addPart = (vehicleId: string, o: Record<string, unknown> = {}) => op("part.add", { vehicleId, part: { id: uuid(), zoneKey: "dach", catalogId: null, name: "Moldura de techo", qty: 1, oemRef: null, source: "assessment", ...o } });
const one = async (token: string, o: unknown) => ((await push(c, token, [o])).body.results[0] as { status: string; code?: string });
const row = async (id: string) => (await c.h.db.select().from(vehicleParts).where(eq(vehicleParts.id, id)))[0];
const photo = async (vehicleId: string, repairStage: string | null) => { const id = uuid(); await c.h.db.insert(photos).values({ id, vehicleId, label: "x", phase: "reparatur", takenAt: new Date(), repairStage }); return id; };
/** a car with one part that was delivered */
const delivered = async () => {
  const id = uuid(); expect((await one(assessor, create(id))).status).toBe("ok");
  const p = addPart(id); expect((await one(assessor, p)).status).toBe("ok");
  const pid = (p as { part: { id: string } }).part.id;
  expect((await one(chef, op("part.deliver", { partId: pid }))).status).toBe("ok");
  return { id, pid };
};

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string; name: string }[];
  CARRO = st.find((s) => s.type === "carrosserie")!.id; A = st.find((s) => s.name === "Nave Test A")!.id;
  chef = await inviteAndAccept(c, c.orgES, "chef-pb@example.test", { role_id: c.roleId.chef_site, station_id: A });
  assessor = await inviteAndAccept(c, c.orgES, "ass-pb@example.test", { role_id: c.roleId.aufnehmer });
  tech = await inviteAndAccept(c, c.orgES, "tech-pb@example.test", { role_id: c.roleId.technicien, station_id: A });
});
afterAll(async () => { await c.h.close(); });

describe("permissions", () => {
  it("reception: manager and station chief; installer: also the technician; defaults in code and in the database", async () => {
    expect(PERMISSIONS).toContain("pieces.reception"); expect(PERMISSIONS).toContain("pieces.installer");
    const sr = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.key, r.permissions]));
    expect(sr.org_admin).toContain("pieces.reception"); expect(sr.chef_site).toContain("pieces.reception");
    for (const k of ["aufnehmer", "technicien", "freelance", "carrosserie", "assureur"]) expect(sr[k]).not.toContain("pieces.reception");
    for (const k of ["org_admin", "chef_site", "technicien", "freelance"]) expect(sr[k]).toContain("pieces.installer");
    for (const k of ["aufnehmer", "carrosserie", "assureur"]) expect(sr[k]).not.toContain("pieces.installer");
    const rows = await c.h.db.select().from(roles).where(eq(roles.key, "technicien"));
    expect(rows.every((r) => r.permissions.includes("pieces.installer") && !r.permissions.includes("pieces.reception"))).toBe(true);
  });
});

describe("delivered", () => {
  it("whoever has the reception right marks it; once (twice = nothing); others are refused; who and when are kept; the history says it", async () => {
    const id = uuid(); expect((await one(assessor, create(id))).status).toBe("ok");
    const p = addPart(id); await one(assessor, p);
    const pid = (p as { part: { id: string } }).part.id;
    expect((await one(assessor, op("part.deliver", { partId: pid }))).code).toBe("not_allowed");
    expect((await one(chef, op("part.deliver", { partId: pid }))).status).toBe("ok");
    expect((await one(chef, op("part.deliver", { partId: pid }))).status).toBe("ok");
    const r = await row(pid);
    expect(r).toMatchObject({ status: "delivered" }); expect(r.deliveredAt).toBeInstanceOf(Date); expect(r.deliveredBy).not.toBeNull();
    const mine = (await pull(c, chef, c.orgES)).vehicles.find((v: { id: string }) => v.id === id) as { parts: { id: string; status: string; deliveredAt: string }[] };
    expect(mine.parts[0]).toMatchObject({ id: pid, status: "delivered", deliveredAt: expect.any(String) });
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).some((e) => e.type === "part_delivered")).toBe(true);
    expect((await one(chef, op("part.deliver", { partId: uuid() }))).code).toBe("part_not_found");
  });
});

describe("installed", () => {
  it("needs a delivered part, a before photo taken at disassembly and a different after photo of the same car; a part removed / of another car is refused", async () => {
    const id = uuid(); expect((await one(assessor, create(id))).status).toBe("ok");
    const p = addPart(id); await one(assessor, p);
    const pid = (p as { part: { id: string } }).part.id;
    const demo = await photo(id, "demontage"), after = await photo(id, "remontage"), other = await photo(id, null);
    expect((await one(chef, op("part.install", { partId: pid, photoBeforeId: demo, photoAfterId: after }))).code).toBe("part_not_delivered"); // not delivered yet
    await one(chef, op("part.deliver", { partId: pid }));
    expect((await one(chef, op("part.install", { partId: pid, photoBeforeId: other, photoAfterId: after }))).code).toBe("part_photos_required"); // the "before" is not a disassembly photo
    expect((await one(chef, op("part.install", { partId: pid, photoBeforeId: demo, photoAfterId: demo }))).code).toBe("part_photos_required"); // the same photo twice
    expect((await one(chef, op("part.install", { partId: pid, photoBeforeId: demo, photoAfterId: uuid() }))).code).toBe("part_photos_required"); // unknown photo
    const otherCar = uuid(); await one(assessor, create(otherCar));
    const foreign = await photo(otherCar, "demontage");
    expect((await one(chef, op("part.install", { partId: pid, photoBeforeId: foreign, photoAfterId: after }))).code).toBe("part_photos_required"); // a photo of ANOTHER car
    expect((await row(pid)).status).toBe("delivered");
    expect((await one(chef, op("part.install", { partId: pid, photoBeforeId: demo, photoAfterId: after }))).status).toBe("ok");
    expect(await row(pid)).toMatchObject({ status: "installed", photoBeforeId: demo, photoAfterId: after });
    expect((await one(chef, op("part.install", { partId: pid, photoBeforeId: demo, photoAfterId: after }))).status).toBe("ok"); // twice
  });
  it("an assessor has no installer right; a technician who does not have the car does not even see it; installed and delivered parts cannot be removed", async () => {
    const { id, pid } = await delivered();
    const demo = await photo(id, "demontage"), after = await photo(id, "remontage");
    expect((await one(assessor, op("part.install", { partId: pid, photoBeforeId: demo, photoAfterId: after }))).code).toBe("not_allowed");
    expect((await one(tech, op("part.install", { partId: pid, photoBeforeId: demo, photoAfterId: after }))).code).toBe("part_not_found"); // not his car: the car does not exist for him
    expect((await one(assessor, op("part.remove", { partId: pid }))).code).toBe("part_locked");
    expect((await row(pid)).status).toBe("delivered");
  });
});

describe("returned", () => {
  it("a delivered or installed part goes back to 'to order' with a counter and the reason in the history; not before it arrived", async () => {
    const { id, pid } = await delivered();
    const demo = await photo(id, "demontage"), after = await photo(id, "remontage");
    await one(chef, op("part.install", { partId: pid, photoBeforeId: demo, photoAfterId: after }));
    expect((await one(assessor, op("part.return", { partId: pid, reason: "damaged" }))).code).toBe("not_allowed");
    expect((await one(chef, op("part.return", { partId: pid, reason: "damaged", note: "cracked" }))).status).toBe("ok");
    const r = await row(pid);
    expect(r).toMatchObject({ status: "to_order", returnCount: 1, deliveredAt: null, installedAt: null, photoBeforeId: null, photoAfterId: null });
    const ev = (await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).find((e) => e.type === "part_returned");
    expect(ev?.payload).toMatchObject({ reason: "damaged", note: "cracked" });
    expect((await one(chef, op("part.return", { partId: pid, reason: "other" }))).code).toBe("part_not_returnable"); // back to "to order": nothing to return
    expect((await one(chef, op("part.deliver", { partId: pid }))).status).toBe("ok"); // the new one arrives
  });
});

describe("Finish", () => {
  it("a part that was delivered (ordered) holds the car back until it is installed; a part never ordered does not", async () => {
    const id = uuid(); expect((await one(assessor, create(id))).status).toBe("ok");
    const p = addPart(id); await one(assessor, p);
    const pid = (p as { part: { id: string } }).part.id;
    expect(await finishBlockers(c.h.db, id)).not.toContain("parts_not_installed"); // still "to order"
    await one(chef, op("part.deliver", { partId: pid }));
    expect(await finishBlockers(c.h.db, id)).toContain("parts_not_installed");
    await one(chef, op("part.install", { partId: pid, photoBeforeId: await photo(id, "demontage"), photoAfterId: await photo(id, "remontage") }));
    expect(await finishBlockers(c.h.db, id)).not.toContain("parts_not_installed");
  });
});
