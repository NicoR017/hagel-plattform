// v4: a person invited with the Technician role is in the list of technicians (Verwaltung) straight away, as a PDR technician or a headliner.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, inviteAndAccept, setup, tokenFromLink, type Ctx } from "./helpers";

let c: Ctx;
const list = async () => (await call(c, "GET", "/admin/technicians", { token: c.superToken, org: c.orgES })).body as { id: string; name: string; email: string | null; userId: string | null; kind: string; active: boolean }[];
const invite = (email: string, role: string, extra: Record<string, unknown> = {}) => call(c, "POST", "/admin/invitations", { token: c.superToken, org: c.orgES, body: { email, role_id: c.roleId[role], ...extra } });
const accept = async (email: string, name: string) => (await call(c, "POST", "/auth/accept-invite", { body: { token: tokenFromLink(c.mailer.linkFor(email)!), name } })).status;

beforeAll(async () => { c = await setup(); });
afterAll(async () => { await c.h.close(); });

describe("invited technician", () => {
  it("is in the technicians list at once (before accepting), as a PDR technician by default, with his e-mail", async () => {
    const before = (await list()).length;
    expect((await invite("anna.tech@example.test", "technicien")).status).toBe(201);
    const now = await list();
    expect(now).toHaveLength(before + 1);
    expect(now.find((t) => t.email === "anna.tech@example.test")).toMatchObject({ kind: "pdr", userId: null, name: "anna.tech", active: true });
  });

  it("accepting links the same record to the account and gives it the real name (no duplicate)", async () => {
    const n = (await list()).length;
    expect(await accept("anna.tech@example.test", "Anna Techniker")).toBe(200);
    const now = await list();
    expect(now).toHaveLength(n);
    const t = now.find((x) => x.email === "anna.tech@example.test")!;
    expect(t.name).toBe("Anna Techniker");
    expect(t.userId).toBeTruthy();
  });

  it("a headliner invitation puts him in the list as a headliner", async () => {
    expect((await invite("hans.head@example.test", "technicien", { technician_kind: "headliner" })).status).toBe(201);
    expect((await list()).find((t) => t.email === "hans.head@example.test")).toMatchObject({ kind: "headliner", userId: null });
    expect(await accept("hans.head@example.test", "Hans Headliner")).toBe(200);
    expect((await list()).find((t) => t.email === "hans.head@example.test")).toMatchObject({ kind: "headliner", name: "Hans Headliner" });
  });

  it("other roles do not create a technician; an existing record with the same e-mail is reused", async () => {
    const n = (await list()).length;
    expect((await invite("chef.x@example.test", "chef_site")).status).toBe(201);
    expect((await list()).length).toBe(n);
    // somebody who already is in the list (e.g. an external technician with this e-mail) is not duplicated
    const created = await call(c, "POST", "/admin/technicians", { token: c.superToken, org: c.orgES, body: { name: "Pedro Externo", email: "pedro@example.test", kind: "pdr", default_pct_pdr: 50, default_pct_demontage: 100 } });
    expect(created.status).toBe(201);
    expect((await invite("pedro@example.test", "technicien")).status).toBe(201);
    const pedro = (await list()).filter((t) => t.email === "pedro@example.test");
    expect(pedro).toHaveLength(1);
    expect(await accept("pedro@example.test", "Pedro")).toBe(200);
    const after = (await list()).filter((t) => t.email === "pedro@example.test");
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe("Pedro Externo"); // the name chosen by the manager stays
    expect(after[0].userId).toBeTruthy();
  });

  it("an existing account that is given the Technician role is linked at once", async () => {
    await inviteAndAccept(c, c.orgES, "maria.x@example.test", { role_id: c.roleId.aufnehmer });
    const n = (await list()).length;
    expect((await invite("maria.x@example.test", "technicien", { technician_kind: "headliner" })).status).toBe(201);
    const t = (await list()).filter((x) => x.email === "maria.x@example.test");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: "headliner" });
    expect(t[0].userId).toBeTruthy();
    expect((await list()).length).toBe(n + 1);
  });
});
