// The recipients of a report can be edited in the send dialog: the op may carry the final list; without it the server computes it as before.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PDF, call, inviteAndAccept, op, push, setup, uuid, type Ctx } from "./helpers";
import { auditLog, reportSends } from "../src/schema";

let c: Ctx;
let A: string, CARRO: string, insId: string;
let sender: string, noRight: string, vid: string;

const header = { land: "ES", kennzeichen: "8888 EDT", fin: "VF1ABCDEF12345678", modell: "Seat Leon", kunde: "Taller", leistungsdatum: "2026-10-19", stundensatz: 69 };
const send = (token: string, recipients?: unknown, type = "kva") => {
  const id = uuid();
  return push(c, token, [op("report.send", { vehicleId: vid, report: { id, type, lang: "es", ...(recipients === undefined ? {} : { recipients }) } })]).then((r) => ({ id, r }));
};
const stored = async (id: string) => (await c.h.db.select().from(reportSends).where(eq(reportSends.id, id)))[0];
const DEFAULTS = ["taller@example.test", "mutua@example.test"];

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as any[];
  A = st.find((s) => s.type === "hall" && s.name === "Nave Test A").id;
  CARRO = st.find((s) => s.type === "carrosserie").id;
  await call(c, "PUT", `/admin/bodyshops/${CARRO}`, { token: c.superToken, org: c.orgES, body: { report_emails: ["taller@example.test"] } });
  insId = (await call(c, "POST", "/admin/insurers", { token: c.superToken, org: c.orgES, body: { name: "Mutua", report_emails: ["mutua@example.test"], send_reports: true, reports_to_send: "both" } })).body.id;
  sender = await inviteAndAccept(c, c.orgES, "sender@example.test", { role_id: c.roleId.aufnehmer });
  noRight = await inviteAndAccept(c, c.orgES, "carro2@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
  vid = uuid();
  expect((await push(c, sender, [op("vehicle.create", { vehicle: { id: vid, stationId: A, clientStationId: CARRO, insurerId: insId, header, panels: { haube: { key: "haube", dents: { "20": 10 } } }, shares: {} } })])).body.results[0].status).toBe("ok");
});
afterAll(async () => { await c.h.close(); });

describe("editable recipients of a report", () => {
  it("GET /reports/recipients keeps `recipients` and adds `defaults` with the source", async () => {
    const b = (await call(c, "GET", `/reports/recipients?vehicleId=${vid}&type=kva`, { token: sender })).body;
    expect(b.recipients).toEqual(DEFAULTS);
    expect(b.defaults).toEqual([expect.objectContaining({ email: "taller@example.test", source: "bodyshop" }), expect.objectContaining({ email: "mutua@example.test", source: "insurer", name: "Mutua" })]);
  });
  it("an op without `recipients` behaves exactly as before", async () => {
    const { id, r } = await send(sender);
    expect(r.body.results[0].status).toBe("ok");
    expect((await stored(id)).recipients).toEqual(DEFAULTS);
  });
  it("a removed address is neither stored nor mailed", async () => {
    const { id, r } = await send(sender, ["taller@example.test"]);
    expect(r.body.results[0].status).toBe("ok");
    expect((await stored(id)).recipients).toEqual(["taller@example.test"]);
    c.mailer.sent.length = 0;
    expect((await call(c, "PUT", `/files/report/${id}`, { token: sender, raw: PDF, contentType: "application/pdf" })).status).toBe(200);
    expect(c.mailer.last().to).toEqual(["taller@example.test"]);
  });
  it("an added address is present; duplicates and capitals are normalised", async () => {
    const { id, r } = await send(sender, [" Taller@Example.Test ", "extra@example.test", "EXTRA@example.test"]);
    expect(r.body.results[0].status).toBe("ok");
    expect((await stored(id)).recipients).toEqual(["taller@example.test", "extra@example.test"]);
    c.mailer.sent.length = 0;
    await call(c, "PUT", `/files/report/${id}`, { token: sender, raw: PDF, contentType: "application/pdf" });
    expect(c.mailer.last().to).toEqual(["taller@example.test", "extra@example.test"]);
  });
  it("invalid address, empty list and 11 addresses are rejected", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `p${i}@example.test`);
    for (const bad of [["not-an-email"], [], eleven]) {
      const { id, r } = await send(sender, bad);
      expect(r.status === 400 || r.body.results?.[0]?.status !== "ok").toBe(true); // refused by the schema or by the server
      expect(await stored(id)).toBeUndefined();
    }
    expect((await send(sender, eleven.slice(0, 10))).r.body.results[0].status).toBe("ok");
  });
  it("without the right to send the op is rejected, even with `recipients`", async () => {
    const { id, r } = await send(noRight, ["x@example.test"]);
    expect(r.status === 400 || r.body.results?.[0]?.status !== "ok").toBe(true);
    expect(await stored(id)).toBeUndefined();
  });
  it("the audit records the final list, the defaults and whether it was customised", async () => {
    const a = await send(sender), b = await send(sender, ["only@example.test"]);
    const rows = await c.h.db.select().from(auditLog).where(eq(auditLog.action, "report.send"));
    const after = (id: string) => rows.find((x) => x.entityId === id)!.after as any;
    expect(after(a.id)).toMatchObject({ recipients: DEFAULTS, defaultRecipients: DEFAULTS, customized: false });
    expect(after(b.id)).toMatchObject({ recipients: ["only@example.test"], defaultRecipients: DEFAULTS, customized: true });
  });
});
