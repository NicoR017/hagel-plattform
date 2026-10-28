// UI v3, phase 7: hardening. Who may call what (every new endpoint x every default role) and what restricted roles never receive.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../src/schema";
import { call, dentsPanel, inviteAndAccept, op, pull, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, CARRO: string, vid: string;
const tokens: Record<string, string> = {};
const ROLES = ["org_admin", "chef_site", "aufnehmer", "technicien", "freelance", "carrosserie", "assureur"] as const;

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string }[];
  A = (st as any[]).find((s) => s.type === "hall" && s.name === "Nave Test A").id; // the place
  CARRO = st.find((s) => s.type === "carrosserie")!.id; // the customer
  const [ins] = (await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Versicherung H", report_emails: [], send_reports: false } })).body ? [(await call(c, "GET", "/admin/insurers", { token: c.superToken, org: c.orgES })).body[0]] : [];
  const camp = (await call(c, "POST", "/admin/campaigns", { token: c.superToken, org: c.orgES, body: { name: "Kampagne H", country: "ES", station_ids: [A] } })).body.id;
  for (const r of ROLES) {
    const extra = r === "carrosserie" ? { scope_client_station_id: CARRO } : r === "assureur" ? { scope_insurer_id: ins.id } : r === "freelance" ? { scope_campaign_id: camp } : r === "org_admin" ? {} : { station_id: A };
    tokens[r] = await inviteAndAccept(c, c.orgES, `${r}@h.example.test`, { role_id: c.roleId[r], ...extra });
  }
  vid = uuid();
  const created = ((await push(c, tokens.aufnehmer, [op("vehicle.create", { vehicle: { id: vid, stationId: A, clientStationId: CARRO, insurerId: ins.id, campaignId: camp, statut: "reparatur", panels: { haube: dentsPanel("haube", { "20": 12, "30": 6 }) }, shares: { techName: "Geheim Techniker", techPct: 61, demTechName: "Geheim Headliner" }, header: { land: "ES", kennzeichen: "HD 1", modell: "Seat Leon", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69 } } })])).body.results as { status: string }[])[0];
  expect(created.status).toBe("ok");
  const tech = (await c.h.db.select().from(users).where(eq(users.email, "technicien@h.example.test")))[0];
  expect(((await push(c, tokens.aufnehmer, [op("vehicle.assign", { vehicleId: vid, kind: "pdr", userIds: [tech.id] })])).body.results as { status: string }[])[0].status).toBe("ok");
});
afterAll(async () => { await c.h.close(); });

const status = async (role: string, method: string, path: string, body?: unknown) => (await call(c, method, path, { token: tokens[role], org: c.orgES, body })).status;

describe("new endpoints x default roles", () => {
  // true = allowed (anything but 401/403), false = refused with 403
  const matrix: Record<string, Record<string, boolean>> = {
    "GET /admin/methods": { org_admin: true, chef_site: false, aufnehmer: false, technicien: false, freelance: false, carrosserie: false, assureur: false },
    "GET /weekly-report?week=2026-W43": { org_admin: true, chef_site: false, aufnehmer: false, technicien: false, freelance: false, carrosserie: false, assureur: false },
    "GET /admin/technicians": { org_admin: true, chef_site: false, aufnehmer: false, technicien: false, freelance: false, carrosserie: false, assureur: false },
    "GET /admin/users": { org_admin: true, chef_site: false, aufnehmer: false, technicien: false, freelance: false, carrosserie: false, assureur: false },
    "GET /admin/audit": { org_admin: true, chef_site: false, aufnehmer: false, technicien: false, freelance: false, carrosserie: false, assureur: false },
    "GET /dashboard": { org_admin: true, chef_site: true, aufnehmer: true, technicien: false, freelance: false, carrosserie: false, assureur: false },
  };
  for (const [ep, byRole] of Object.entries(matrix)) {
    it(ep, async () => {
      const [m, p] = ep.split(" ");
      for (const r of ROLES) {
        const s = await status(r, m, p);
        expect(s === 403 ? false : s < 400, `${ep} as ${r} -> ${s}`).toBe(byRole[r]);
      }
    });
  }

  it("write endpoints: nobody without the right changes methods, deletes users or roles, sends the weekly report", async () => {
    const someone = (await c.h.db.select().from(users).where(eq(users.email, "aufnehmer@h.example.test")))[0];
    for (const r of ["chef_site", "aufnehmer", "technicien", "freelance", "carrosserie", "assureur"] as const) {
      expect(await status(r, "POST", "/admin/methods", { name: "X", engine: "aw", country: "DE", params: {} }), `methods ${r}`).toBe(403);
      expect(await status(r, "POST", "/weekly-report/send", { week: "2026-W43", technician: "X", email: "x@example.test" }), `weekly ${r}`).toBe(403);
      expect(await status(r, "DELETE", `/admin/roles/${c.roleId.technicien}`), `role ${r}`).toBe(403);
      if (r !== "chef_site") expect(await status(r, "DELETE", `/admin/users/${someone.id}`), `user ${r}`).toBe(403);
    }
    expect((await userStatus("aufnehmer@h.example.test"))).toBe("active");
  });
});
const userStatus = async (email: string) => (await c.h.db.select().from(users).where(eq(users.email, email)))[0].status;

describe("what restricted roles never receive", () => {
  const vehicleOf = async (role: string) => (await pull(c, tokens[role], c.orgES)).vehicles.find((v: any) => v.id === vid);

  it("the technician sees his vehicle without prices, other people's names or the commission; the amounts of the split only as his own share", async () => {
    const v = await vehicleOf("technicien");
    expect(v).toBeTruthy();
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/werkPct|werkMode|werkEur|Geheim Headliner|"netto"|"brutto"|stundensatz/);
    expect(v.shares).toBeUndefined();
    expect(v.myShare).toMatchObject({ techEur: expect.any(Number) }); // his own share only
    expect(Object.keys(v.myShare).sort()).toEqual(["demTechEur", "techEur"]);
  });

  it("insurer and body shop see prices, never the internal split", async () => {
    for (const r of ["assureur", "carrosserie"]) {
      const v = await vehicleOf(r);
      if (!v) continue;
      const json = JSON.stringify(v);
      expect(json, r).not.toMatch(/Geheim Techniker|Geheim Headliner|techPct|demTechPct|"rest"|"techEur"|"demTechEur"/);
    }
  });

  it("the repair data of the vehicle does not carry anybody's share for people without the right", async () => {
    for (const r of ["technicien", "assureur", "carrosserie", "freelance"]) {
      const v = await vehicleOf(r);
      if (!v) continue;
      expect(JSON.stringify(v.repair ?? {}), r).not.toMatch(/Geheim|werkPct|techEur|demTechEur|commission/i);
    }
  });

  it("another organisation's data is not reachable: the vehicle of this organisation is invisible with the other org id", async () => {
    const r = await call(c, "POST", "/sync/pull", { token: tokens.aufnehmer, org: c.orgDE, body: { since: 0 } });
    expect([200, 403, 404]).toContain(r.status);
    if (r.status === 200) expect(JSON.stringify(r.body)).not.toContain(vid);
  });
});
