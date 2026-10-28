// v4, phase 4: the technician / headliner profile. Every rule is checked on the server: own cars, the only allowed moves,
// the photo of the current step before moving, no status change, only the own earnings, no prices.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { photos, technicians, users, vehicles } from "../src/schema";
import { call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx;
let A: string, CARRO: string; // A = hall (place), CARRO = carrosserie (customer)
let assessor: string, chef: string, tech: string, tech2: string, head: string, admin: string;
let techUser: string, tech2User: string, headUser: string;

const hdr = (o: Record<string, unknown> = {}) => ({ land: "ES", kennzeichen: "1234 ABC", modell: "Seat Leon", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69, demontage: true, demontageEur: 100, ...o });
const ok = async (token: string, ops: unknown[]) => { const r = await push(c, token, ops); expect(r.status).toBe(200); return r.body.results as { status: string; code?: string }[]; };
const one = async (token: string, o: unknown) => (await ok(token, [o]))[0];
const stageOf = async (id: string) => (await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0].repairStage;

/** a car in repair, at `stage`, PDR technician "Test Tech" (account assigned), removal/refit "Test Head" (account assigned for demontage) */
async function car(stage: string, o: { assignTech?: boolean; assignHead?: boolean } = {}) {
  const id = uuid();
  await ok(assessor, [op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, header: hdr(), panels: { haube: dentsPanel("haube", { "20": 12, "30": 6 }) },
    shares: { techName: "Test Tech", techPct: 50, demTechName: "Test Head", demTechPct: 80 }, statut: "besichtigung" } })]);
  expect((await one(assessor, op("vehicle.repairStage", { vehicleId: id, stage: "bereit" }))).status).toBe("ok");
  if (o.assignTech !== false) await one(assessor, op("vehicle.assign", { vehicleId: id, kind: "pdr", userIds: [techUser] }));
  if (o.assignHead !== false) await one(assessor, op("vehicle.assign", { vehicleId: id, kind: "demontage", userIds: [headUser] }));
  for (const s of ["demontage", "pdr", "remontage", "bodyshop"]) {
    if (stage === "bereit") break;
    expect((await one(assessor, op("vehicle.repairStage", { vehicleId: id, stage: s }))).status).toBe("ok");
    if (s === stage) break;
  }
  return id;
}
/** a photo taken by `token` for the board step `stage` */
async function photo(token: string, vehicleId: string, stage: string | null) {
  const pid = uuid();
  expect((await one(token, op("photo.add", { photo: { id: pid, vehicleId, label: "Detail", phase: "reparatur", takenAt: new Date().toISOString() } }))).status).toBe("ok");
  if (stage) expect((await one(token, op("photo.stage", { photoId: pid, repairStage: stage, role: "Techniker" }))).status).toBe("ok");
  return pid;
}
const move = (token: string, id: string, stage: string) => one(token, op("vehicle.repairStage", { vehicleId: id, stage }));

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  CARRO = st.find((s) => s.type === "carrosserie").id;
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { commission_pct: 10 } });
  admin = await inviteAndAccept(c, c.orgES, "admin@example.test", { role_id: c.roleId.org_admin });
  assessor = await inviteAndAccept(c, c.orgES, "assessor@example.test", { role_id: c.roleId.aufnehmer });
  chef = await inviteAndAccept(c, c.orgES, "chef@example.test", { role_id: c.roleId.chef_site, station_id: A });
  tech = await inviteAndAccept(c, c.orgES, "tech@example.test", { role_id: c.roleId.technicien, station_id: A });
  tech2 = await inviteAndAccept(c, c.orgES, "tech2@example.test", { role_id: c.roleId.technicien, station_id: A });
  head = await inviteAndAccept(c, c.orgES, "head@example.test", { role_id: c.roleId.technicien, station_id: A });
  const uid = async (e: string) => (await c.h.db.select().from(users).where(eq(users.email, e)))[0].id;
  techUser = await uid("tech@example.test"); tech2User = await uid("tech2@example.test"); headUser = await uid("head@example.test");
  await c.h.db.delete(technicians); // the invitations created technician records of their own; this file sets up its own
  await c.h.db.insert(technicians).values([
    { orgId: c.orgES, name: "Test Tech", userId: techUser, kind: "pdr" },
    { orgId: c.orgES, name: "Other Tech", userId: tech2User, kind: "pdr" },
    { orgId: c.orgES, name: "Test Head", userId: headUser, kind: "headliner" },
  ]);
});
afterAll(async () => { await c.h.close(); });

describe("who gets the field interface", () => {
  it("only an account linked to a technician record that does not see the internal split", async () => {
    const view = async (t: string) => (await pull(c, t, c.orgES)).refs.me.fieldView;
    expect(await view(tech)).toMatchObject({ kind: "pdr", name: "Test Tech" });
    expect(await view(head)).toMatchObject({ kind: "headliner", name: "Test Head" });
    expect(await view(chef)).toBeNull();
    expect(await view(assessor)).toBeNull();
    expect(await view(admin)).toBeNull();
    expect(await view(c.superToken)).toBeNull();
  });
});

describe("moves", () => {
  it("the technician takes HIS car from Disassembly into PDR, after a photo of the Disassembly step taken by himself", async () => {
    const id = await car("demontage");
    expect((await move(tech, id, "pdr")).code).toBe("photo_required"); // no photo at all
    await photo(assessor, id, "demontage"); // somebody else's photo does not count
    expect((await move(tech, id, "pdr")).code).toBe("photo_required");
    await photo(tech, id, "pdr"); // his photo, but of another step
    expect((await move(tech, id, "pdr")).code).toBe("photo_required");
    await photo(tech, id, null); // his photo without a step
    expect((await move(tech, id, "pdr")).code).toBe("photo_required");
    expect(await stageOf(id)).toBe("demontage");
    const mine = await photo(tech, id, "demontage");
    expect((await move(tech, id, "pdr")).status).toBe("ok");
    expect(await stageOf(id)).toBe("pdr");
    // a deleted photo does not count
    const id2 = await car("demontage");
    const p2 = await photo(tech, id2, "demontage");
    await one(tech, op("photo.delete", { photoId: p2 })).catch(() => undefined);
    await c.h.db.update(photos).set({ deletedAt: new Date() }).where(eq(photos.id, p2));
    expect((await move(tech, id2, "pdr")).code).toBe("photo_required");
    expect(mine).toBeTruthy();
  });

  it("no other move for the technician: not backwards, not forward, not into repair, not to Finish", async () => {
    const id = await car("pdr");
    await photo(tech, id, "pdr");
    for (const to of ["demontage", "bereit", "remontage", "bodyshop", "finish"]) expect((await move(tech, id, to)).code, to).toBe("move_not_allowed");
    const fresh = uuid();
    await ok(assessor, [op("vehicle.create", { vehicle: { id: fresh, stationId: A, clientStationId: CARRO, header: hdr(), panels: {}, shares: {}, statut: "besichtigung" } })]);
    await one(assessor, op("vehicle.assign", { vehicleId: fresh, kind: "pdr", userIds: [techUser] }));
    expect((await move(tech, fresh, "bereit")).code).toBe("move_not_allowed"); // never puts a car into repair
    expect(await stageOf(id)).toBe("pdr");
  });

  it("not on a car that is not his (another technician's), even with a photo of his own", async () => {
    const id = await car("demontage", { assignTech: false });
    await one(assessor, op("vehicle.assign", { vehicleId: id, kind: "pdr", userIds: [tech2User] }));
    await c.h.db.update(vehicles).set({ shares: { techName: "Other Tech", techPct: 50, demTechName: "Test Head", demTechPct: 80 } as never }).where(eq(vehicles.id, id));
    // tech cannot even see it (scope: assigned cars only), so the move is refused whatever the photo says
    const r = await move(tech, id, "pdr");
    expect(r.status).toBe("rejected");
    expect(await stageOf(id)).toBe("demontage");
  });

  it("the headliner: Disassembly → PDR and Reassembly → At body shop, Disassembly needs his own photo, Reassembly none; never Finish, never PDR → Reassembly", async () => {
    const id = await car("demontage");
    expect((await move(head, id, "pdr")).code).toBe("photo_required");
    await photo(head, id, "demontage");
    expect((await move(head, id, "pdr")).status).toBe("ok");
    expect((await move(head, id, "remontage")).code).toBe("move_not_allowed"); // PDR → Reassembly is not his
    expect((await move(c.superToken, id, "remontage")).status).toBe("ok"); // a manager moves it on
    expect((await move(head, id, "finish")).code).toBe("move_not_allowed");
    expect((await move(head, id, "bodyshop")).status).toBe("ok"); // Reassembly needs no photo
    expect(await stageOf(id)).toBe("bodyshop");
    expect((await move(head, id, "finish")).code).toBe("move_not_allowed");
  });

  it("a headliner needs a removal/refit assignment (or his name in the split), a PDR assignment is not enough", async () => {
    const id = await car("demontage", { assignHead: false });
    await c.h.db.update(vehicles).set({ shares: { techName: "Test Tech", techPct: 50, demTechName: "", demTechPct: 80 } as never }).where(eq(vehicles.id, id));
    await one(assessor, op("vehicle.assign", { vehicleId: id, kind: "pdr", userIds: [techUser, headUser] }));
    await photo(head, id, "demontage");
    expect((await move(head, id, "pdr")).code).toBe("not_your_vehicle");
  });

  it("managers are not affected: any move, no photo needed", async () => {
    const id = await car("bereit");
    for (const s of ["pdr", "bereit", "remontage", "demontage"]) expect((await move(chef, id, s)).status, s).toBe("ok");
    expect((await move(assessor, id, "bodyshop")).status).toBe("ok");
  });

  it("the technician cannot change a status (Fertig would skip the Finish checks) nor choose the body shop", async () => {
    const id = await car("pdr");
    expect((await one(tech, op("vehicle.status", { vehicleId: id, statut: "fertig" }))).code).toBe("not_allowed");
    expect((await one(tech, op("vehicle.bodyshop", { vehicleId: id, bodyshopId: null }))).code).toBe("not_allowed");
    expect((await c.h.db.select().from(vehicles).where(eq(vehicles.id, id)))[0].statut).toBe("reparatur");
    expect((await one(chef, op("vehicle.status", { vehicleId: id, statut: "attente", motif: "Teile" }))).status).toBe("ok");
  });

  it("he can still tick to-dos and add photos", async () => {
    const id = await car("pdr");
    const todo = uuid();
    expect((await one(tech, op("repair.todo.add", { vehicleId: id, todo: { id: todo, text: "Haube prüfen" } }))).status).toBe("ok");
    expect((await one(tech, op("repair.todo.toggle", { todoId: todo, done: true }))).status).toBe("ok");
  });
});

describe("what the field profile receives", () => {
  it("only his own earnings and no price, no total, no split, no rate", async () => {
    const id = await car("pdr");
    const mine = (await pull(c, tech, c.orgES)).vehicles.find((v: any) => v.id === id);
    expect(mine).toBeTruthy();
    expect(mine.myEarn.pdr.eur).toBeGreaterThan(0);
    expect(mine.myEarn.pdr).not.toHaveProperty("pct"); // the percentage needs its own right (ma_part_pct.voir)
    expect(mine.myEarn.dem).toBeNull(); // the removal/refit belongs to the headliner
    expect(mine.myAssign).toEqual(["pdr"]);
    expect(mine.myEarn.eur).toBe(mine.myEarn.pdr.eur);
    expect(mine.myShare.demTechEur).toBe(0);
    for (const k of ["netto", "brutto", "shares", "stundensatz", "demontageEur", "werkEur", "rest", "techEur", "demTechEur"]) expect(mine, k).not.toHaveProperty(k);
    expect(JSON.stringify(mine)).not.toMatch(/netto|brutto|bigEur|werkEur|"rest"/);
    const h = (await pull(c, head, c.orgES)).vehicles.find((v: any) => v.id === id);
    expect(h.myEarn.pdr).toBeNull();
    expect(h.myAssign).toEqual(["demontage"]);
    expect(h.myEarn.dem.eur).toBeGreaterThan(0);
    expect(h.myEarn.dem).not.toHaveProperty("pct");
    expect(JSON.stringify([mine, h])).not.toMatch(/techPct|demTechPct/);
    expect(h.myShare.techEur).toBe(0);
    // the chef and the assessor keep the full picture
    const full = (await pull(c, chef, c.orgES)).vehicles.find((v: any) => v.id === id);
    expect(full).not.toHaveProperty("myEarn");
  });

  it("a technician who does both (his name on PDR and on removal/refit) earns both", async () => {
    const id = await car("pdr");
    await c.h.db.update(vehicles).set({ shares: { techName: "Test Tech", techPct: 50, demTechName: "Test Tech", demTechPct: 100 } as never }).where(eq(vehicles.id, id));
    const mine = (await pull(c, tech, c.orgES)).vehicles.find((v: any) => v.id === id);
    expect(mine.myEarn.pdr.eur).toBeGreaterThan(0);
    expect(mine.myEarn.dem.eur).toBeGreaterThan(0);
    expect(mine.myEarn.eur).toBeCloseTo(mine.myEarn.pdr.eur + mine.myEarn.dem.eur, 2);
  });

  it("the percentages of his earnings travel only with the right \"View the percentage of the own share\", per role", async () => {
    const id = await car("pdr");
    const roles = (await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgES })).body as any[];
    const r = roles.find((x) => x.id === c.roleId.technicien);
    const put = (permissions: string[]) => call(c, "PUT", `/admin/roles/${r.id}`, { token: c.superToken, org: c.orgES, body: { name: r.name, scope: r.scope, permissions } });
    try {
      expect((await put([...r.permissions, "ma_part_pct.voir"])).status).toBe(200);
      const mine = (await pull(c, tech, c.orgES)).vehicles.find((v: any) => v.id === id);
      expect(mine.myEarn.pdr.pct).toBe(50);
      expect(mine.myEarn.pdr.eur).toBeGreaterThan(0);
      expect(mine).not.toHaveProperty("shares");
    } finally {
      expect((await put(r.permissions)).status).toBe(200);
    }
    const back = (await pull(c, tech, c.orgES)).vehicles.find((v: any) => v.id === id);
    expect(back.myEarn.pdr).not.toHaveProperty("pct");
  });

  it("he only sees his cars, and the global data stay closed (dashboard, split, admin)", async () => {
    const id = await car("pdr", { assignTech: false });
    const p = await pull(c, tech, c.orgES);
    expect(p.vehicles.find((v: any) => v.id === id)).toBeUndefined();
    expect((await call(c, "GET", "/dashboard", { token: tech, org: c.orgES })).status).toBe(403);
    expect((await call(c, "GET", "/admin/users", { token: tech, org: c.orgES })).status).toBe(403);
    expect(p.refs.technicians).toEqual([]);
  });
});

describe("the refusal is reported like any other rejected operation", () => {
  it("the code is translated in the four languages", async () => {
    const { errorMessage } = await import("@hagel/shared");
    for (const code of ["move_not_allowed", "not_your_vehicle", "photo_required"] as const) for (const l of ["de", "en", "fr", "es"] as const) expect(errorMessage(code, l).length).toBeGreaterThan(10);
  });
});
