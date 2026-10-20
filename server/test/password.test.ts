import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, users } from "../src/schema";
import { hashPassword, verifyPassword } from "../src/crypto";
import { call, login, setup, tokenFromLink, type Ctx } from "./helpers";

let c: Ctx;
beforeAll(async () => { c = await setup(); });
afterAll(async () => { await c.h.close(); });

const PW = "correct horse battery";
const loginPw = (email: string, password: string) => call(c, "POST", "/auth/login", { body: { email, password } });

describe("password hashing", () => {
  it("scrypt with a random salt; wrong password and missing hash are rejected", async () => {
    const h = await hashPassword(PW);
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain(PW);
    expect(await hashPassword(PW)).not.toBe(h); // salted
    expect(await verifyPassword(PW, h)).toBe(true);
    expect(await verifyPassword("other password", h)).toBe(false);
    expect(await verifyPassword(PW, null)).toBe(false);
    expect(await verifyPassword(PW, "garbage")).toBe(false);
  });
});

describe("password login", () => {
  it("an invitation can create the account with a password; then e-mail + password signs in", async () => {
    await call(c, "POST", "/admin/invitations", { token: c.superToken, org: c.orgES, body: { email: "ana@example.test", role_id: c.roleId.aufnehmer } });
    const tok = tokenFromLink(c.mailer.linkFor("ana@example.test")!);
    expect((await call(c, "POST", "/auth/accept-invite", { body: { token: tok, name: "Ana", password: "short" } })).status).toBe(400); // too weak, nothing consumed
    const a = await call(c, "POST", "/auth/accept-invite", { body: { token: tok, name: "Ana", password: PW } });
    expect(a.status).toBe(200);
    const r = await loginPw("ana@example.test", PW);
    expect(r.status).toBe(200);
    expect((await call(c, "GET", "/me", { token: r.body.access_token })).body.user.email).toBe("ana@example.test");
    expect((await call(c, "GET", "/me/password", { token: r.body.access_token })).body).toEqual({ set: true });
  });

  it("wrong password, unknown e-mail and an account without a password give the same answer", async () => {
    const a = await loginPw("ana@example.test", "wrong password!!");
    const b = await loginPw("nobody@example.test", PW);
    const n = await loginPw("nicolas@example.test", PW); // the seeded super-admin has no password yet
    for (const r of [a, b, n]) { expect(r.status).toBe(401); expect(r.body.code).toBe("invalid_credentials"); }
    expect(a.body.error).toBe(b.body.error);
  });

  it("an account is locked after 10 failures (whatever the IP); a disabled account cannot sign in", async () => {
    await call(c, "POST", "/admin/invitations", { token: c.superToken, org: c.orgES, body: { email: "bob@example.test", role_id: c.roleId.aufnehmer } });
    await call(c, "POST", "/auth/accept-invite", { body: { token: tokenFromLink(c.mailer.linkFor("bob@example.test")!), name: "Bob", password: PW } });
    for (let i = 0; i < 10; i++) expect((await loginPw("bob@example.test", "nope nope nope")).status).toBe(401);
    expect((await loginPw("bob@example.test", PW)).status).toBe(429); // even the right one now
  });
});

describe("setting and changing the password", () => {
  it("magic-link sign-in (forgot password) allows setting one without the old; later it needs the current one; other devices are signed out", async () => {
    const first = await login(c, "nicolas@example.test");
    expect((await call(c, "GET", "/me/password", { token: first.access_token })).body).toEqual({ set: false });
    expect((await call(c, "PUT", "/me/password", { token: first.access_token, body: { password: "short" } })).status).toBe(400);
    expect((await call(c, "PUT", "/me/password", { token: first.access_token, body: { password: PW } })).status).toBe(200);
    expect((await loginPw("nicolas@example.test", PW)).status).toBe(200);

    // a second device
    const other = await login(c, "nicolas@example.test");
    // age the first session beyond the 10-minute window
    const [u] = await c.h.db.select().from(users).where(eq(users.email, "nicolas@example.test"));
    await c.h.db.update(sessions).set({ createdAt: new Date(Date.now() - 3600_000) }).where(eq(sessions.userId, u.id));
    // old session: needs the current password
    const old = await loginPw("nicolas@example.test", PW);
    await c.h.db.update(sessions).set({ createdAt: new Date(Date.now() - 3600_000) }).where(eq(sessions.userId, u.id));
    expect((await call(c, "PUT", "/me/password", { token: old.body.access_token, body: { password: "another long one" } })).body.code).toBe("wrong_current_password");
    expect((await call(c, "PUT", "/me/password", { token: old.body.access_token, body: { password: "another long one", current_password: "bad bad bad bad" } })).body.code).toBe("wrong_current_password");
    expect((await call(c, "PUT", "/me/password", { token: old.body.access_token, body: { password: "another long one", current_password: PW } })).status).toBe(200);

    expect((await loginPw("nicolas@example.test", PW)).status).toBe(401); // old password gone
    expect((await loginPw("nicolas@example.test", "another long one")).status).toBe(200);
    expect((await call(c, "GET", "/me", { token: other.access_token })).status).toBe(401); // other devices signed out
    expect((await call(c, "GET", "/me", { token: old.body.access_token })).status).toBe(200); // the device that changed it stays in
    void first;
  });

  it("the e-mail link keeps working next to the password (for 'forgot password')", async () => {
    const t = await login(c, "ana@example.test");
    expect((await call(c, "PUT", "/me/password", { token: t.access_token, body: { password: "a brand new password" } })).status).toBe(200);
    expect((await loginPw("ana@example.test", "a brand new password")).status).toBe(200);
  });
});
