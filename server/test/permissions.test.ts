import { describe, expect, it } from "vitest";
import { PERMISSIONS, SYSTEM_ROLES, type Permission } from "@hagel/shared";
import { can, canOrg, filterFields, grantsFor, sitesWith, type Grant, type Principal, type VehicleRef } from "../src/permissions";

const ORG = "org-1", ORG2 = "org-2";
const TAL = "site-talavera", MAD = "site-madrid", CAR = "carro-1", CAR2 = "carro-2";
const INS = "ins-allianz", INS2 = "ins-caser", CAMP = "camp-1";
const role = (k: string) => SYSTEM_ROLES.find((r) => r.key === k)!;

const grant = (roleKey: string, o: Partial<Grant> = {}): Grant => ({
  orgId: ORG, stationId: null, scope: role(roleKey).scope, permissions: role(roleKey).permissions, ...o,
});
const user = (id: string, grants: Grant[], o: Partial<Principal> = {}): Principal => ({ id, isSuperadmin: false, status: "active", grants, ...o });
const veh = (o: Partial<VehicleRef> = {}): VehicleRef => ({
  id: "v1", orgId: ORG, stationId: TAL, clientStationId: CAR, campaignId: CAMP, insurerId: INS, assigneeIds: [], ...o,
});

describe("can(): site resolution", () => {
  it("chef at Talavera acts on Talavera vehicles only", () => {
    const u = user("u", [grant("chef_site", { stationId: TAL })]);
    expect(can(u, "vehicules.modifier", veh())).toBe(true);
    expect(can(u, "vehicules.modifier", veh({ stationId: MAD }))).toBe(false);
  });
  it("different role per site: chief at Talavera, assessor at Madrid", () => {
    const u = user("u", [grant("chef_site", { stationId: TAL }), grant("aufnehmer", { stationId: MAD })]);
    expect(can(u, "vehicules.supprimer", veh())).toBe(true);
    expect(can(u, "vehicules.supprimer", veh({ stationId: MAD }))).toBe(false);
    expect(can(u, "vehicules.modifier", veh({ stationId: MAD }))).toBe(true);
  });
  it("NULL station = all sites of the organisation, but not other organisations", () => {
    const u = user("u", [grant("aufnehmer")]);
    expect(can(u, "vehicules.voir", veh({ stationId: MAD }))).toBe(true);
    expect(can(u, "vehicules.voir", veh({ orgId: ORG2 }))).toBe(false);
  });
  it("moving a vehicle changes visibility for site-bound scopes", () => {
    const u = user("u", [grant("chef_site", { stationId: TAL })]);
    expect(can(u, "vehicules.voir", veh())).toBe(true);
    expect(can(u, "vehicules.voir", veh({ stationId: MAD }))).toBe(false);
  });
  it("vehicle without a site is not visible to a site-bound grant", () => {
    const u = user("u", [grant("chef_site", { stationId: TAL })]);
    expect(can(u, "vehicules.voir", veh({ stationId: null }))).toBe(false);
  });
});

describe("scopes", () => {
  it("assigne: only assigned vehicles, and only on the site", () => {
    const u = user("tech", [grant("technicien", { stationId: TAL })]);
    expect(can(u, "vehicules.voir", veh())).toBe(false);
    expect(can(u, "vehicules.voir", veh({ assigneeIds: ["tech"] }))).toBe(true);
    expect(can(u, "vehicules.voir", veh({ assigneeIds: ["tech"], stationId: MAD }))).toBe(false); // moved: flagged, no access
  });
  it("campagne: vehicles of that campaign wherever they are; freelance expiry", () => {
    const g = grant("freelance", { scopeCampaignId: CAMP, expiresAt: new Date("2026-11-01") });
    const u = user("f", [g]);
    const now = new Date("2026-10-19");
    expect(can(u, "vehicules.voir", veh({ stationId: MAD }), now)).toBe(true);
    expect(can(u, "vehicules.voir", veh({ campaignId: "other" }), now)).toBe(false);
    expect(can(u, "vehicules.voir", veh({ campaignId: null }), now)).toBe(false);
    expect(can(u, "vehicules.voir", veh(), new Date("2026-11-02"))).toBe(false);
  });
  it("campagne without a campaign id never matches", () => {
    expect(can(user("f", [grant("freelance")]), "vehicules.voir", veh({ campaignId: null }))).toBe(false);
  });
  it("client: customer carrosserie sees its cars wherever they are now", () => {
    const u = user("c", [grant("carrosserie", { scopeClientStationId: CAR })]);
    expect(can(u, "vehicules.voir", veh({ stationId: MAD }))).toBe(true);
    expect(can(u, "vehicules.voir", veh({ clientStationId: CAR2 }))).toBe(false);
    expect(can(u, "vehicules.modifier", veh())).toBe(false);
    expect(can(u, "prix.voir", veh())).toBe(true);
  });
  it("assurance: only its insurer's files", () => {
    const u = user("i", [grant("assureur", { scopeInsurerId: INS })]);
    expect(can(u, "vehicules.voir", veh())).toBe(true);
    expect(can(u, "vehicules.voir", veh({ insurerId: INS2 }))).toBe(false);
    expect(can(u, "vehicules.voir", veh({ insurerId: null }))).toBe(false);
    expect(can(u, "repartition_interne.voir", veh())).toBe(false);
  });
  it("client/assurance scope without a scope id never matches", () => {
    expect(can(user("c", [grant("carrosserie")]), "vehicules.voir", veh())).toBe(false);
    expect(can(user("i", [grant("assureur")]), "vehicules.voir", veh())).toBe(false);
  });
});

describe("user state", () => {
  it("disabled / invited users can do nothing, even superadmin flag", () => {
    for (const status of ["disabled", "invited"] as const) {
      const u = user("u", [grant("org_admin")], { status, isSuperadmin: true });
      expect(can(u, "vehicules.voir", veh())).toBe(false);
      expect(canOrg(u, "utilisateurs.gerer", ORG)).toBe(false);
      expect(filterFields(u, veh(), { a: 1 })).toBeNull();
    }
  });
  it("superadmin sees every organisation", () => {
    const u = user("n", [], { isSuperadmin: true });
    expect(can(u, "vehicules.supprimer", veh({ orgId: ORG2 }))).toBe(true);
    expect(canOrg(u, "roles.gerer", ORG2)).toBe(true);
    expect(sitesWith(u, "vehicules.voir", ORG2)).toBe("all");
  });
  it("expired assignment gives nothing", () => {
    const u = user("u", [grant("aufnehmer", { expiresAt: new Date("2020-01-01") })]);
    expect(can(u, "vehicules.voir", veh())).toBe(false);
    expect(grantsFor(u, veh())).toEqual([]);
  });
});

describe("every system role x every permission (own site, own scope)", () => {
  for (const r of SYSTEM_ROLES) {
    it(`${r.key}: exactly its permissions on a covered vehicle`, () => {
      const u = user("u", [grant(r.key, { stationId: TAL, scopeClientStationId: CAR, scopeInsurerId: INS, scopeCampaignId: CAMP })]);
      const v = veh({ assigneeIds: ["u"] });
      for (const p of PERMISSIONS) expect(can(u, p as Permission, v)).toBe(r.permissions.includes(p as Permission));
    });
    it(`${r.key}: nothing on another organisation's vehicle`, () => {
      const u = user("u", [grant(r.key, { stationId: TAL, scopeClientStationId: CAR, scopeInsurerId: INS, scopeCampaignId: CAMP })]);
      for (const p of PERMISSIONS) expect(can(u, p as Permission, veh({ orgId: ORG2, assigneeIds: ["u"] }))).toBe(false);
    });
  }
  it("technician has no price / split / admin permissions by default", () => {
    const p = role("technicien").permissions;
    for (const x of ["prix.voir", "repartition_interne.voir", "utilisateurs.gerer", "vehicules.supprimer"] as Permission[]) expect(p).not.toContain(x);
  });
  it("insurer has no internal split by default", () => {
    expect(role("assureur").permissions).not.toContain("repartition_interne.voir");
  });
});

describe("canOrg()", () => {
  it("site-limited admin right cannot manage org-wide things", () => {
    const u = user("u", [grant("org_admin", { stationId: TAL })]);
    expect(canOrg(u, "utilisateurs.gerer", ORG)).toBe(false);
    expect(canOrg(u, "utilisateurs.gerer", ORG, TAL)).toBe(true);
    expect(canOrg(u, "utilisateurs.gerer", ORG, MAD)).toBe(false);
  });
  it("org-wide admin manages any site of its org, not another org", () => {
    const u = user("u", [grant("org_admin")]);
    expect(canOrg(u, "stations.gerer", ORG)).toBe(true);
    expect(canOrg(u, "stations.gerer", ORG, MAD)).toBe(true);
    expect(canOrg(u, "stations.gerer", ORG2)).toBe(false);
  });
  it("chef de site cannot manage roles", () => {
    expect(canOrg(user("u", [grant("chef_site")]), "roles.gerer", ORG)).toBe(false);
  });
});

describe("filterFields()", () => {
  const data = {
    kennzeichen: "M-AB 1", stundensatz: 83, netto: 1000, brutto: 1190, techName: "Ana", techPct: 50, werkPct: 20,
    shares: { techEur: 400, demTechEur: 100, werkEur: 200, rest: 300 }, notiz: "x",
  };
  const full = (u: Principal) => filterFields(u, veh(), data) as Record<string, unknown>;

  it("aufnehmer: prices and split", () => {
    const o = full(user("a", [grant("aufnehmer", { stationId: TAL })]));
    expect(o.netto).toBe(1000);
    expect(o.shares).toBeDefined();
  });
  it("technician: no price, no split keys anywhere in the payload, only myShare", () => {
    const ok = filterFields(user("t", [grant("technicien", { stationId: TAL })]), veh({ assigneeIds: ["t"] }), data) as Record<string, unknown>;
    for (const k of ["stundensatz", "netto", "brutto", "techName", "techPct", "werkPct", "shares"]) expect(ok[k]).toBeUndefined();
    expect(ok.myShare).toEqual({ techEur: 400, demTechEur: 100 });
    expect(ok.myCommission).toBeUndefined();
    expect(ok.kennzeichen).toBe("M-AB 1");
    expect(JSON.stringify(ok)).not.toMatch(/1000|1190|83|Ana/);
  });
  it("unassigned technician gets null (not an empty object)", () => {
    expect(filterFields(user("t", [grant("technicien", { stationId: TAL })]), veh(), data)).toBeNull();
  });
  it("carrosserie: price but only its commission", () => {
    const o = filterFields(user("c", [grant("carrosserie", { scopeClientStationId: CAR })]), veh(), data) as Record<string, unknown>;
    expect(o.netto).toBe(1000);
    expect(o.shares).toBeUndefined();
    expect(o.techPct).toBeUndefined();
    expect(o.myCommission).toEqual({ werkEur: 200 });
    expect(o.myShare).toBeUndefined();
  });
  it("insurer: price, no split, no commission", () => {
    const o = filterFields(user("i", [grant("assureur", { scopeInsurerId: INS })]), veh(), data) as Record<string, unknown>;
    expect(o.netto).toBe(1000);
    expect(o.shares).toBeUndefined();
    expect(o.myCommission).toBeUndefined();
    expect(o.werkPct).toBeUndefined();
  });
  it("custom role without prix.voir and without shares permission gets neither", () => {
    const g: Grant = { orgId: ORG, stationId: TAL, scope: "station", permissions: ["vehicules.voir"] };
    const o = filterFields(user("x", [g]), veh(), data) as Record<string, unknown>;
    expect(Object.keys(o).sort()).toEqual(["kennzeichen", "notiz"]);
  });
  it("union over grants: permissions from a non-covering grant do not leak", () => {
    const u = user("u", [
      { orgId: ORG, stationId: TAL, scope: "station", permissions: ["vehicules.voir"] },
      grant("aufnehmer", { stationId: MAD }),
    ]);
    const o = filterFields(u, veh(), data) as Record<string, unknown>;
    expect(o.netto).toBeUndefined();
  });
  it("does not mutate its input", () => {
    const copy = JSON.parse(JSON.stringify(data));
    filterFields(user("t", [grant("technicien", { stationId: TAL })]), veh({ assigneeIds: ["t"] }), data);
    expect(data).toEqual(copy);
  });
});

describe("sitesWith()", () => {
  it("lists sites, or 'all' for an org-wide grant, ignoring other orgs and expired grants", () => {
    const u = user("u", [
      grant("aufnehmer", { stationId: TAL }),
      grant("aufnehmer", { stationId: MAD, expiresAt: new Date("2020-01-01") }),
      grant("aufnehmer", { orgId: ORG2 }),
    ]);
    expect(sitesWith(u, "vehicules.voir", ORG)).toEqual([TAL]);
    expect(sitesWith(u, "vehicules.voir", ORG2)).toBe("all");
    expect(sitesWith(u, "utilisateurs.gerer", ORG)).toEqual([]);
  });
});
