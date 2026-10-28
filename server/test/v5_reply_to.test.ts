// v5: where the replies to the reports go: the contact address of the organisation (by role, with an exception per person) or the sender's own e-mail.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PDF, call, inviteAndAccept, op, push, setup, uuid, type Ctx } from "./helpers";
import { replyToInfo } from "../src/reply_to";
import { reportSends, users } from "../src/schema";

let c: Ctx;
let A: string, CARRO: string;
let plain: string, viaRole: string, plainId: string, viaRoleId: string, contactRole: string;
let vid: string;
const CONTACT = "contact-spain@example.test";

const header = { land: "ES", kennzeichen: "7777 RPL", fin: "VF1ABCDEF12345678", modell: "Seat Leon", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69 };
const uid = async (email: string) => (await c.h.db.select().from(users).where(eq(users.email, email)))[0].id;
const setContact = (v: string | null) => call(c, "PUT", `/admin/orgs/${c.orgES}/contact`, { token: c.superToken, org: c.orgES, body: { contact_email: v } });
const setMode = (id: string, mode: string | null) => call(c, "PUT", `/admin/users/${id}`, { token: c.superToken, org: c.orgES, body: { reply_mode: mode } });
/** send the estimate as `token` and return the Reply-To of the mail that went out */
async function sendAs(token: string) {
  const rid = uuid();
  expect((await push(c, token, [op("report.send", { vehicleId: vid, report: { id: rid, type: "kva", lang: "es" } })])).body.results[0].status).toBe("ok");
  c.mailer.sent.length = 0;
  expect((await call(c, "PUT", `/files/report/${rid}`, { token, raw: PDF, contentType: "application/pdf" })).status).toBe(200);
  return { replyTo: c.mailer.last().replyTo, rid };
}
const preview = async (token: string) => (await call(c, "GET", `/reports/recipients?vehicleId=${vid}&type=kva`, { token })).body;

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  CARRO = st.find((s) => s.type === "carrosserie").id;
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { report_emails: ["taller@example.test"] } });
  plain = await inviteAndAccept(c, c.orgES, "plain@example.test", { role_id: c.roleId.aufnehmer });
  const base = ((await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgES })).body as any[]).find((r) => r.id === c.roleId.aufnehmer);
  const made = await call(c, "POST", "/admin/roles", { token: c.superToken, org: c.orgES, body: { name: "Expert contact", scope: base.scope, permissions: base.permissions, reply_from_contact: true } });
  expect(made.status).toBe(201);
  contactRole = made.body.id;
  viaRole = await inviteAndAccept(c, c.orgES, "viarole@example.test", { role_id: contactRole });
  plainId = await uid("plain@example.test"); viaRoleId = await uid("viarole@example.test");
  vid = uuid();
  await push(c, plain, [op("vehicle.create", { vehicle: { id: vid, stationId: A, clientStationId: CARRO, header, panels: { haube: { key: "haube", dents: { "20": 10 } } }, shares: {} } })]);
});
afterAll(async () => { await c.h.close(); });

describe("reply-to of the reports", () => {
  it("nothing configured: the sender's own e-mail, as before (preview and mail)", async () => {
    expect((await preview(plain)).replyTo).toBe("plain@example.test");
    expect((await sendAs(plain)).replyTo).toBe("plain@example.test");
    expect((await sendAs(viaRole)).replyTo).toBe("viarole@example.test"); // the role asks for the contact address but the organisation has none yet
  });
  it("only a super-admin sets the contact address; it must be an e-mail", async () => {
    expect((await call(c, "PUT", `/admin/orgs/${c.orgES}/contact`, { token: plain, org: c.orgES, body: { contact_email: CONTACT } })).status).toBeGreaterThanOrEqual(403);
    expect((await setContact("not-an-email")).status).toBe(400);
    const ok = await setContact(" Contact-Spain@Example.Test ");
    expect(ok.status).toBe(200);
    expect(ok.body.contactEmail).toBe(CONTACT);
    expect(((await call(c, "GET", "/admin/orgs", { token: c.superToken, org: c.orgES })).body as any[]).find((o) => o.id === c.orgES).contactEmail).toBe(CONTACT);
  });
  it("a role set to the contact address: replies go there; the others keep their own e-mail", async () => {
    expect((await preview(viaRole)).replyTo).toBe(CONTACT);
    const r = await sendAs(viaRole);
    expect(r.replyTo).toBe(CONTACT);
    expect((await sendAs(plain)).replyTo).toBe("plain@example.test");
    const [row] = await c.h.db.select().from(reportSends).where(eq(reportSends.id, r.rid));
    expect(row.replyTo).toBe(CONTACT); // kept in the history of the vehicle
    const hist = (await call(c, "GET", `/reports?vehicleId=${vid}`, { token: viaRole })).body as any[];
    expect(hist.find((h) => h.id === r.rid).replyTo).toBe(CONTACT);
  });
  it("the exception of a person wins over the role, both ways; null follows the role again", async () => {
    expect((await setMode(viaRoleId, "own")).status).toBe(200);
    expect((await sendAs(viaRole)).replyTo).toBe("viarole@example.test");
    expect((await setMode(plainId, "contact")).status).toBe(200);
    expect((await preview(plain)).replyTo).toBe(CONTACT);
    expect((await sendAs(plain)).replyTo).toBe(CONTACT);
    const list = (await call(c, "GET", "/admin/users", { token: c.superToken, org: c.orgES })).body as any[];
    expect(list.find((u) => u.id === plainId).replyMode).toBe("contact");
    expect(list.find((u) => u.id === viaRoleId).replyMode).toBe("own");
    expect((await setMode(viaRoleId, null)).status).toBe(200);
    expect((await setMode(plainId, null)).status).toBe(200);
    expect((await sendAs(viaRole)).replyTo).toBe(CONTACT);
    expect((await sendAs(plain)).replyTo).toBe("plain@example.test");
    expect((await setMode(plainId, "somebody")).status).toBe(400);
  });
  it("no contact address: back to the sender's own e-mail whatever the settings", async () => {
    await setMode(plainId, "contact");
    expect((await setContact(null)).status).toBe(200);
    expect((await sendAs(viaRole)).replyTo).toBe("viarole@example.test");
    expect((await sendAs(plain)).replyTo).toBe("plain@example.test");
    await setMode(plainId, null);
    await setContact(CONTACT);
  });
  it("the flag of a role is kept when the role is saved by a client that does not send it", async () => {
    const roles = (await call(c, "GET", "/admin/roles", { token: c.superToken, org: c.orgES })).body as any[];
    const r = roles.find((x) => x.id === contactRole);
    expect(r.replyFromContact).toBe(true);
    const put = await call(c, "PUT", `/admin/roles/${contactRole}`, { token: c.superToken, org: c.orgES, body: { name: r.name, scope: r.scope, permissions: r.permissions } });
    expect(put.status).toBe(200);
    expect(put.body.replyFromContact).toBe(true);
  });
  it("a send made by the system (no person) goes to the contact address when there is one, else nothing", async () => {
    expect(await replyToInfo(c.h.db, null, c.orgES)).toEqual({ address: CONTACT, source: "contact" });
    await setContact(null);
    expect(await replyToInfo(c.h.db, null, c.orgES)).toEqual({ address: undefined, source: "none" });
    await setContact(CONTACT);
  });
});
