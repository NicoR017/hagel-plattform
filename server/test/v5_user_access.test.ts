// v5: edit the role and the station (a place, never a body shop) of a user's assignment.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, inviteAndAccept, setup, type Ctx } from "./helpers";

let c: Ctx;
let A: string, CARRO: string;
let tok: string, techTok: string, userId: string, assignmentId: string;

const users = async () => (await call(c, "GET", "/admin/users", { token: c.superToken, org: c.orgES })).body as any[];
const put = (token: string, id: string, body: object) => call(c, "PUT", `/admin/assignments/${id}`, { token, org: c.orgES, body });

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  CARRO = st.find((s) => s.type === "carrosserie").id;
  tok = await inviteAndAccept(c, c.orgES, "edit-me@example.test", { role_id: c.roleId.aufnehmer, station_id: A });
  techTok = await inviteAndAccept(c, c.orgES, "other-tech@example.test", { role_id: c.roleId.technicien, station_id: A });
  const u = (await users()).find((x) => x.email === "edit-me@example.test");
  userId = u.id; assignmentId = u.assignments[0].id;
});
afterAll(async () => { await c.h.close(); });

describe("edit the assignment of a user", () => {
  it("changes the role and the place; no place = all places", async () => {
    const r = await put(c.superToken, assignmentId, { role_id: c.roleId.chef_site, station_id: null });
    expect(r.status).toBe(200);
    let a = (await users()).find((x) => x.id === userId).assignments;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ roleId: c.roleId.chef_site, stationId: null });
    expect((await put(c.superToken, assignmentId, { role_id: c.roleId.aufnehmer, station_id: A })).status).toBe(200);
    a = (await users()).find((x) => x.id === userId).assignments;
    expect(a[0]).toMatchObject({ roleId: c.roleId.aufnehmer, stationId: A });
  });
  it("a body shop is not a place", async () => {
    const r = await put(c.superToken, assignmentId, { role_id: c.roleId.aufnehmer, station_id: CARRO });
    expect(r.status).toBe(400);
    expect((await users()).find((x) => x.id === userId).assignments[0].stationId).toBe(A);
  });
  it("unknown role / assignment", async () => {
    expect((await put(c.superToken, assignmentId, { role_id: "00000000-0000-4000-8000-000000000000", station_id: null })).status).toBe(404);
    expect((await put(c.superToken, "00000000-0000-4000-8000-000000000000", { role_id: c.roleId.aufnehmer, station_id: null })).status).toBe(404);
  });
  it("a client role needs its body shop", async () => {
    const r = await put(c.superToken, assignmentId, { role_id: c.roleId.carrosserie, station_id: null });
    expect(r.status).toBe(400);
    const ok = await put(c.superToken, assignmentId, { role_id: c.roleId.carrosserie, station_id: null, scope_client_station_id: CARRO });
    expect(ok.status).toBe(200);
    await put(c.superToken, assignmentId, { role_id: c.roleId.aufnehmer, station_id: A });
  });
  it("only accounts that manage users can do it", async () => {
    expect((await put(techTok, assignmentId, { role_id: c.roleId.aufnehmer, station_id: null })).status).toBe(403);
    expect((await put(tok, assignmentId, { role_id: c.roleId.aufnehmer, station_id: null })).status).toBe(403);
  });
});
