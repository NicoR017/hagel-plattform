// UI v3, phase 6: Verwaltung — delete users, delete roles with a replacement, technician e-mail, Wochenbericht, dashboard board counts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, invitations, memberships, roleAssignments, sessions, technicians, users, vehicleStatusHistory } from "../src/schema";
import { isoWeekRange } from "../src/weekly";
import { call, dentsPanel, inviteAndAccept, op, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, chef: string, assessor: string;
const S = () => c.superToken;
const org = () => c.orgES;

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: S(), org: org() })).body as { id: string; type: string }[];
  A = st.find((s) => s.type === "carrosserie")!.id;
  chef = await inviteAndAccept(c, org(), "chef6@example.test", { role_id: c.roleId.chef_site });
  assessor = await inviteAndAccept(c, org(), "assessor6@example.test", { role_id: c.roleId.aufnehmer });
});
afterAll(async () => { await c.h.close(); });

const userRow = async (email: string) => (await c.h.db.select().from(users).where(eq(users.email, email)))[0];

describe("users: edit and delete", () => {
  it("the name and language can be edited", async () => {
    const u = await userRow("assessor6@example.test");
    const r = await call(c, "PUT", `/admin/users/${u.id}`, { token: S(), org: org(), body: { name: "Ana Aufnehmer", language: "en" } });
    expect(r.status).toBe(200);
    expect(await userRow("assessor6@example.test")).toMatchObject({ name: "Ana Aufnehmer", language: "en" });
  });

  it("delete: no login, no roles, no sessions, off the list; the row stays (anonymised) for the history", async () => {
    const email = "gone6@example.test";
    const tok = await inviteAndAccept(c, org(), email, { role_id: c.roleId.technicien, station_id: A });
    const u = await userRow(email);
    await c.h.db.insert(technicians).values({ orgId: org(), name: "Gone Tech", userId: u.id });
    expect((await call(c, "GET", "/me", { token: tok })).status).toBe(200);
    const before = await call(c, "GET", "/admin/users", { token: S(), org: org() });
    expect((before.body as { id: string }[]).some((x) => x.id === u.id)).toBe(true);

    const r = await call(c, "DELETE", `/admin/users/${u.id}`, { token: S(), org: org() });
    expect(r.status).toBe(200);
    expect((await call(c, "GET", "/me", { token: tok })).status).toBe(401);
    const after = await call(c, "GET", "/admin/users", { token: S(), org: org() });
    expect((after.body as { id: string }[]).some((x) => x.id === u.id)).toBe(false);
    const row = (await c.h.db.select().from(users).where(eq(users.id, u.id)))[0];
    expect(row).toMatchObject({ status: "deleted", name: "Gelöschter Benutzer", passwordHash: null });
    expect(row.email).not.toBe(email);
    expect(await c.h.db.select().from(roleAssignments).where(eq(roleAssignments.userId, u.id))).toHaveLength(0);
    expect(await c.h.db.select().from(memberships).where(eq(memberships.userId, u.id))).toHaveLength(0);
    expect((await c.h.db.select().from(sessions).where(eq(sessions.userId, u.id))).every((s) => s.revokedAt)).toBe(true);
    expect((await c.h.db.select().from(technicians).where(eq(technicians.name, "Gone Tech")))[0].userId).toBeNull();
    const log = (await c.h.db.select().from(auditLog).where(and(eq(auditLog.entity, "user"), eq(auditLog.entityId, u.id)))).find((a) => a.action === "delete");
    expect(log).toBeTruthy();
    // the address is free again
    expect((await call(c, "POST", "/admin/invitations", { token: S(), org: org(), body: { email, role_id: c.roleId.technicien } })).status).toBe(201);
  });

  it("the super-admin and yourself cannot be deleted", async () => {
    const su = await userRow("nicolas@example.test");
    expect((await call(c, "DELETE", `/admin/users/${su.id}`, { token: S(), org: org() })).status).toBe(403);
    const me = await userRow("chef6@example.test");
    expect((await call(c, "DELETE", `/admin/users/${me.id}`, { token: chef, org: org() })).status).toBeGreaterThanOrEqual(403);
    expect((await userRow("assessor6@example.test")).status).toBe("active");
  });

  it("a user who also belongs to another organisation is only removed from this one (not anonymised)", async () => {
    const email = "both6@example.test";
    await inviteAndAccept(c, org(), email, { role_id: c.roleId.aufnehmer });
    const u = await userRow(email);
    await c.h.db.insert(memberships).values({ userId: u.id, orgId: c.orgDE });
    expect((await call(c, "DELETE", `/admin/users/${u.id}`, { token: S(), org: org() })).status).toBe(200);
    expect(await userRow(email)).toMatchObject({ status: "active", email });
    expect(await c.h.db.select().from(memberships).where(eq(memberships.userId, u.id))).toHaveLength(1);
  });
});

describe("roles: delete with a replacement", () => {
  let custom: string, other: string;
  it("a role nobody holds is deleted at once; a default role never", async () => {
    const mk = async (name: string) => (await call(c, "POST", "/admin/roles", { token: S(), org: org(), body: { name, description: "", scope: "station", permissions: ["vehicules.voir"] } })).body.id as string;
    const empty = await mk("Leer");
    expect((await call(c, "DELETE", `/admin/roles/${empty}`, { token: S(), org: org() })).status).toBe(200);
    expect((await call(c, "DELETE", `/admin/roles/${c.roleId.chef_site}`, { token: S(), org: org() })).status).toBe(409);
    custom = await mk("Prüfer");
    other = await mk("Prüfer 2");
  });

  it("a role that is held needs a replacement: its people and its pending invitations move over in one step", async () => {
    await inviteAndAccept(c, org(), "pruefer@example.test", { role_id: custom, station_id: A });
    expect((await call(c, "POST", "/admin/invitations", { token: S(), org: org(), body: { email: "pending6@example.test", role_id: custom } })).status).toBe(201);
    expect((await call(c, "DELETE", `/admin/roles/${custom}`, { token: S(), org: org() })).status).toBe(409);
    expect((await call(c, "DELETE", `/admin/roles/${custom}`, { token: S(), org: org(), body: { replacement_role_id: custom } })).status).toBe(400);
    expect((await call(c, "DELETE", `/admin/roles/${custom}`, { token: S(), org: org(), body: { replacement_role_id: c.roleId.carrosserie } })).status).toBe(400); // another scope
    const r = await call(c, "DELETE", `/admin/roles/${custom}`, { token: S(), org: org(), body: { replacement_role_id: other } });
    expect(r.status).toBe(200);
    expect(r.body.moved).toBe(2);
    const u = await userRow("pruefer@example.test");
    expect((await c.h.db.select().from(roleAssignments).where(eq(roleAssignments.userId, u.id)))[0].roleId).toBe(other);
    expect((await c.h.db.select().from(invitations).where(eq(invitations.email, "pending6@example.test")))[0].roleId).toBe(other);
    const roles = (await call(c, "GET", "/admin/roles", { token: S(), org: org() })).body as { id: string }[];
    expect(roles.some((x) => x.id === custom)).toBe(false);
  });
});

describe("technicians: e-mail", () => {
  it("a technician without an account has an address of its own, editable", async () => {
    const r = await call(c, "POST", "/admin/technicians", { token: S(), org: org(), body: { name: "Hans Headliner", kind: "headliner", default_pct_pdr: 80, email: "Hans@Example.test" } });
    expect(r.status).toBe(201);
    expect(r.body.email).toBe("hans@example.test");
    const u = await call(c, "PUT", `/admin/technicians/${r.body.id}`, { token: S(), org: org(), body: { email: null } });
    expect(u.body.email).toBeNull();
    expect((await call(c, "PUT", `/admin/technicians/${r.body.id}`, { token: S(), org: org(), body: { email: "nonsense" } })).status).toBe(400);
  });
});

describe("Wochenbericht", () => {
  it("ISO weeks: Monday to Sunday, also around the new year", () => {
    expect(isoWeekRange("2026-W43")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(isoWeekRange("2026-W01")).toEqual({ from: "2025-12-29", to: "2026-01-04" });
    expect(isoWeekRange("2027-W01")).toEqual({ from: "2027-01-04", to: "2027-01-10" });
    expect(isoWeekRange("2020-W53")).toEqual({ from: "2020-12-28", to: "2021-01-03" });
  });

  const thisWeek = () => {
    const d = new Date(), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const y = t.getUTCFullYear(), w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
    return `${y}-W${String(w).padStart(2, "0")}`;
  };
  let vid: string;

  it("lists the cars that reached Finish in the week with basis and amount, per person; the total to invoice is the sum", async () => {
    vid = uuid();
    const r = ((await push(c, assessor, [op("vehicle.create", { vehicle: { id: vid, stationId: A, clientStationId: A, statut: "reparatur", panels: { haube: dentsPanel("haube", { "20": 12, "30": 6 }) }, shares: { techName: "Wochen Tech", techPct: 50 }, header: { land: "ES", kennzeichen: "WK 1", modell: "Seat Leon", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69 } } })])).body.results as { status: string }[])[0];
    expect(r.status).toBe("ok");
    await c.h.db.insert(vehicleStatusHistory).values({ vehicleId: vid, statut: "fertig", at: new Date() });
    const res = await call(c, "GET", `/weekly-report?week=${thisWeek()}`, { token: S(), org: org() });
    expect(res.status).toBe(200);
    const sheet = res.body.sheets.find((s: any) => s.technician === "Wochen Tech");
    expect(sheet).toBeTruthy();
    expect(sheet.vehicles).toHaveLength(1);
    expect(sheet.vehicles[0]).toMatchObject({ plate: "WK 1" });
    expect(sheet.vehicles[0].eur).toBeGreaterThan(0);
    expect(sheet.totals).toMatchObject({ n: 1, eur: sheet.vehicles[0].eur });
    const other = await call(c, "GET", `/weekly-report?week=2024-W10`, { token: S(), org: org() });
    expect(other.body.sheets).toHaveLength(0);
  });

  it("only people with the right to see the weekly report get it", async () => {
    expect((await call(c, "GET", `/weekly-report?week=${thisWeek()}`, { token: assessor, org: org() })).status).toBe(403);
    expect((await call(c, "POST", `/weekly-report/send`, { token: assessor, org: org(), body: { week: thisWeek(), technician: "Wochen Tech", email: "x@example.test" } })).status).toBe(403);
    expect((await call(c, "GET", `/weekly-report?week=nonsense`, { token: S(), org: org() })).status).toBe(400);
  });

  it("PDF erzeugen & senden: to the person's address (or the one typed), PDF attached, in the audit log; no address = refused", async () => {
    await c.h.db.insert(technicians).values({ orgId: org(), name: "Wochen Tech", email: "wochen@example.test" });
    c.mailer.sent.length = 0;
    const r = await call(c, "POST", `/weekly-report/send`, { token: S(), org: org(), body: { week: thisWeek(), technician: "Wochen Tech" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ to: "wochen@example.test", vehicles: 1 });
    expect(c.mailer.sent).toHaveLength(1);
    expect(c.mailer.sent[0].to).toBe("wochen@example.test");
    expect(c.mailer.sent[0].attachments![0].filename).toMatch(/\.pdf$/);
    expect(Buffer.from(c.mailer.sent[0].attachments![0].content).subarray(0, 4).toString()).toBe("%PDF");
    expect((await c.h.db.select().from(auditLog).where(eq(auditLog.action, "send_weekly_report"))).length).toBe(1);
    // the typed address wins
    const o = await call(c, "POST", `/weekly-report/send`, { token: S(), org: org(), body: { week: thisWeek(), technician: "Wochen Tech", email: "other@example.test" } });
    expect(o.body.to).toBe("other@example.test");
    // nothing to send
    expect((await call(c, "POST", `/weekly-report/send`, { token: S(), org: org(), body: { week: "2024-W10", technician: "Wochen Tech" } })).status).toBe(404);
    await c.h.db.update(technicians).set({ email: null }).where(eq(technicians.name, "Wochen Tech"));
    expect((await call(c, "POST", `/weekly-report/send`, { token: S(), org: org(), body: { week: thisWeek(), technician: "Wochen Tech" } })).status).toBe(400);
  });
});

describe("dashboard: the repair board per station", () => {
  it("counts per column and the repairs booked today against the capacity", async () => {
    const d = (await call(c, "GET", "/dashboard", { token: S(), org: org() })).body;
    const site = d.sites.find((s: any) => s.id === A);
    expect(Object.keys(site.byStage)).toEqual(["bereit", "demontage", "pdr", "remontage", "bodyshop", "finish"]);
    expect(site.byStage.bereit.n + site.byStage.finish.n).toBeGreaterThanOrEqual(1);
    expect(site.repairsToday).toMatchObject({ booked: 0 });
    expect(site.repairsToday.capacity).toBeGreaterThan(0);
  });
});
