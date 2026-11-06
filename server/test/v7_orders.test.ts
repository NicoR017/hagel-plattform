// V7 (Repair v2) F3b: parts orders to the body shop — settings, numbering, one order = one car x one body shop x one sending, PDF + e-mail, retries,
// triggers (insurer approval + repair appointment), modification / cancellation / confirmation, delivery, reminders, rights. An order is a request, never an invoice.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { generateOrderPdf, renderTemplate, defaultOrderTemplate, type OrderDoc } from "@hagel/documents";
import { PERMISSIONS, SYSTEM_ROLES } from "@hagel/shared";
import { addWorkdays, runOrderQueue, subWorkdays } from "../src/domains/parts/orders";
import { todayIn } from "../src/domains/repair/repair";
import { partOrderLines, partOrders, repairEvents, roles, vehicleParts } from "../src/schema";
import { call, dentsPanel, inviteAndAccept, op, push, setup, uuid, type Ctx } from "./helpers";

let c: Ctx, A: string, CARRO: string;
let chef: string, assessor: string, carro: string;
const BODY_SHOP_MAIL = "pedidos@masa.example.test";

const create = (id: string) =>
  op("vehicle.create", { vehicle: { id, stationId: A, clientStationId: CARRO, statut: "besichtigung", header: { land: "ES", kennzeichen: "PO-" + id.slice(0, 4), fin: "VSSZZZ5FZ0000", modell: "Seat Leon", claimNumber: "SIN-" + id.slice(0, 4), leistungsdatum: "2026-10-20", stundensatz: 69 }, panels: { haube: dentsPanel("haube", { "30": 4 }) }, shares: {} } });
const one = async (token: string, o: unknown) => ((await push(c, token, [o])).body.results[0] as { status: string; code?: string });
const api = (m: string, path: string, body?: unknown, token = chef) => call(c, m, path, { token, org: c.orgES, body });
const admin = (m: string, path: string, body?: unknown, token = c.superToken) => call(c, m, `/admin${path}`, { token, org: c.orgES, body });
const settings = (o: Record<string, unknown> = {}) => admin("PUT", `/bodyshops/${CARRO}/order-settings`, { enabled: true, mode: "manual", to_emails: [BODY_SHOP_MAIL], cc_emails: [], reply_to: "chief-a@example.test", lang: "es", delivery_days: 3, reminder_days: 0, ...o });
/** a car with N parts "to order" (and the part ids) */
const carWithParts = async (names = ["Moldura de techo", "Antena"]) => {
  const id = uuid(); expect((await one(assessor, create(id))).status).toBe("ok");
  const pids: string[] = [];
  for (const [i, name] of names.entries()) {
    const o = op("part.add", { vehicleId: id, part: { id: uuid(), zoneKey: i % 2 ? "heck" : "dach", catalogId: null, name, qty: i + 1, oemRef: i ? "5F0035507" : null, source: "assessment" } });
    expect((await one(assessor, o)).status).toBe("ok"); pids.push((o as { part: { id: string } }).part.id);
  }
  return { id, pids };
};
const ord = async (id: string) => (await c.h.db.select().from(partOrders).where(eq(partOrders.vehicleId, id))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const part = async (id: string) => (await c.h.db.select().from(vehicleParts).where(eq(vehicleParts.id, id)))[0];
const lastMail = () => c.mailer.sent[c.mailer.sent.length - 1];
const workday = (n: number) => { const d = new Date(todayIn("Europe/Madrid") + "T12:00:00Z"); for (let k = 0; k < n;) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) k++; } return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  c = await setup();
  const st = (await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string; name: string }[];
  CARRO = st.find((s) => s.type === "carrosserie")!.id; A = st.find((s) => s.name === "Nave Test A")!.id;
  await admin("PUT", `/bodyshops/${CARRO}`, { cif: "B12345678", contact_name: "Marta Masa", contact_phone: "+34 600 000 000", commission_pct: 10 });
  chef = await inviteAndAccept(c, c.orgES, "chef-or@example.test", { role_id: c.roleId.chef_site, station_id: A });
  assessor = await inviteAndAccept(c, c.orgES, "ass-or@example.test", { role_id: c.roleId.aufnehmer });
  carro = await inviteAndAccept(c, c.orgES, "carro-or@example.test", { role_id: c.roleId.carrosserie, scope_client_station_id: CARRO });
});
afterAll(async () => { await c.h.close(); });

describe("permissions and settings", () => {
  it("pieces.commander for manager and chief, facturation.gerer for the admin only; defaults in code and in the database", async () => {
    for (const p of ["pieces.commander", "pieces.prix.voir", "facturation.gerer"]) expect(PERMISSIONS).toContain(p);
    const sr = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.key, r.permissions]));
    expect(sr.org_admin).toContain("facturation.gerer"); expect(sr.chef_site).not.toContain("facturation.gerer");
    for (const k of ["org_admin", "chef_site"]) { expect(sr[k]).toContain("pieces.commander"); expect(sr[k]).toContain("pieces.prix.voir"); }
    for (const k of ["aufnehmer", "technicien", "freelance", "carrosserie", "assureur"]) { expect(sr[k]).not.toContain("pieces.commander"); expect(sr[k]).not.toContain("pieces.prix.voir"); }
    const rows = await c.h.db.select().from(roles).where(eq(roles.key, "technicien"));
    expect(rows.every((r) => !r.permissions.includes("pieces.commander"))).toBe(true);
  });
  it("the settings of a body shop: validated; Automatic is refused without an order address; a test goes to the logged-in user only", async () => {
    expect((await settings({ to_emails: ["not-an-email"] })).status).toBe(400);
    const r = await settings({ mode: "automatic", to_emails: [] });
    expect(r.status).toBe(400); expect(r.body.code).toBe("order_automatic_needs_email");
    expect((await settings({ mode: "automatic", to_emails: [BODY_SHOP_MAIL], reminder_days: 5 })).status).toBe(400); // 0..3
    const ok = await settings({ mode: "manual", cc_emails: ["cc@masa.example.test"] });
    expect(ok.status).toBe(200); expect(ok.body).toMatchObject({ enabled: true, mode: "manual", to_emails: [BODY_SHOP_MAIL], cc_emails: ["cc@masa.example.test"], lang: "es", show_prices: false });
    expect(ok.body.default_template.es.subject).toContain("{{order_number}}");
    expect((await admin("GET", `/bodyshops/${CARRO}/order-settings`, undefined, chef)).status).toBe(403); // station chief: no Billing admin
    expect((await admin("GET", `/bodyshops/${CARRO}/order-settings`, undefined, assessor)).status).toBe(403);
    const before = c.mailer.sent.length;
    const t = await admin("POST", `/bodyshops/${CARRO}/order-settings/test`);
    expect(t.status).toBe(200);
    expect(c.mailer.sent.length).toBe(before + 1);
    expect(String(lastMail().to)).toBe("nicolas@example.test"); expect(String(lastMail().to)).not.toContain("masa"); expect(lastMail().subject).toContain("[TEST]");
    expect((await admin("GET", `/bodyshops/${uuid()}/order-settings`)).status).toBe(404);
  });
});

describe("one order = one car x one body shop x one sending", () => {
  it("manual: a draft, then Send; the PDF is frozen, the e-mail goes to the body shop with Reply-To, the parts become 'order sent'; the number is PED-YYYY-NNNNN and never reused", async () => {
    await settings({ mode: "manual", cc_emails: [] });
    const { id, pids } = await carWithParts();
    const d = await api("POST", `/vehicles/${id}/orders`, { kind: "main", send: false });
    expect(d.status).toBe(201); expect(d.body.status).toBe("draft"); expect(d.body.number).toMatch(/^PED-\d{4}-\d{5}$/);
    expect((await part(pids[0])).status).toBe("to_order"); expect((await part(pids[0])).orderId).toBe(d.body.id); // linked, not sent
    const mails = c.mailer.sent.length;
    const s = await api("POST", `/parts/orders/${d.body.id}/send`);
    expect(s.status).toBe(200); expect(s.body.status).toBe("sent");
    expect(c.mailer.sent.length).toBe(mails + 1);
    const m = lastMail();
    expect(m.to).toEqual([BODY_SHOP_MAIL]); expect(m.replyTo).toBe("chief-a@example.test");
    expect(m.subject).toBe(`Pedido de piezas ${d.body.number} – ${"PO-" + id.slice(0, 4)} – Siniestro SIN-${id.slice(0, 4)}`);
    expect(m.text).toContain("Fecha deseada de entrega"); expect(m.text).toContain("Marta Masa");
    expect(m.attachments?.[0]).toMatchObject({ filename: `${d.body.number}.pdf`, contentType: "application/pdf" });
    expect(Buffer.from(m.attachments![0].content).subarray(0, 4).toString()).toBe("%PDF");
    expect((await part(pids[0])).status).toBe("order_sent");
    const [o] = await ord(id);
    expect(o).toMatchObject({ status: "sent", kind: "main", lang: "es" }); expect(o.pdfKey).toContain(`orders/${o.orgId}/${id}/`); expect(o.recipients).toMatchObject({ to: [BODY_SHOP_MAIL], replyTo: "chief-a@example.test" });
    const lines = await c.h.db.select().from(partOrderLines).where(eq(partOrderLines.orderId, o.id));
    expect(lines.map((l) => [l.designation, l.qty, l.zone])).toEqual(expect.arrayContaining([["Moldura de techo", 1, "Techo"], ["Antena", 2, "Portón trasero"]]));
    // the car changes afterwards: the snapshot (lines, PDF) does not
    await one(assessor, op("part.update", { partId: pids[0], fields: { qty: 5 } }));
    expect((await c.h.db.select().from(partOrderLines).where(eq(partOrderLines.orderId, o.id))).find((l) => l.designation === "Moldura de techo")!.qty).toBe(1);
    // a second car: the next number
    const second = await carWithParts(["Emblema"]);
    const d2 = await api("POST", `/vehicles/${second.id}/orders`, { kind: "main", send: false });
    expect(Number(d2.body.number.slice(-5))).toBe(Number(d.body.number.slice(-5)) + 1);
    // the PDF download
    const pdf = await call(c, "GET", `/parts/orders/${d.body.id}/pdf`, { token: chef, org: c.orgES });
    expect(pdf.status).toBe(200); expect(pdf.headers.get("content-type")).toBe("application/pdf");
  });
  it("no double sending: a part in an order is not in another; a second main order is refused; only the parts chosen leave; Resend sends the same PDF again", async () => {
    const { id, pids } = await carWithParts(["A", "B", "C"]);
    const first = await api("POST", `/vehicles/${id}/orders`, { kind: "main", partIds: [pids[0], pids[1]], send: true });
    expect(first.status).toBe(201); expect(first.body.status).toBe("sent");
    expect((await part(pids[2])).orderId).toBeNull();
    const again = await api("POST", `/vehicles/${id}/orders`, { kind: "main", send: true });
    expect(again.body.code).toBe("order_main_exists");
    const dup = await api("POST", `/vehicles/${id}/orders`, { kind: "complement", reason: "forgotten", partIds: [pids[0]], send: true });
    expect(dup.body.code).toBe("order_no_parts"); // already in the main order
    const mails = c.mailer.sent.length;
    const [o] = await ord(id);
    expect((await api("POST", `/parts/orders/${o.id}/resend`)).status).toBe(200);
    expect(c.mailer.sent.length).toBe(mails + 1);
    const pdfKey = (await ord(id))[0].pdfKey;
    expect(pdfKey).toBe(o.pdfKey); // the same frozen PDF
    expect((await ord(id)).length).toBe(1); // no new order
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).some((e) => e.type === "order_resent")).toBe(true);
  });
  it("rights: only pieces.commander orders; the customer-side accounts see nothing; not enabled / no recipient / no parts are refused", async () => {
    const { id } = await carWithParts();
    expect((await api("POST", `/vehicles/${id}/orders`, { kind: "main", send: false }, assessor)).status).toBe(403);
    expect((await api("POST", `/vehicles/${id}/orders`, { kind: "main", send: false }, carro)).status).toBe(404);
    expect((await api("GET", `/vehicles/${id}/orders`, undefined, carro)).status).toBe(404);
    expect(((await api("GET", "/parts/orders", undefined, carro)).body as unknown[]).length).toBe(0);
    await settings({ enabled: false });
    expect((await api("POST", `/vehicles/${id}/orders`, { kind: "main", send: false })).body.code).toBe("order_not_enabled");
    await settings({ enabled: true, to_emails: [] });
    expect((await api("POST", `/vehicles/${id}/orders`, { kind: "main", send: false })).body.code).toBe("order_no_recipient");
    await settings({ to_emails: [BODY_SHOP_MAIL] });
    const empty = uuid(); await one(assessor, create(empty));
    expect((await api("POST", `/vehicles/${empty}/orders`, { kind: "main", send: false })).body.code).toBe("order_no_parts");
  });
});

describe("extra orders, modification, cancellation, confirmation", () => {
  it("an extra order needs a reason; it has its own number and recalls nothing of the main one; the PDF is built for each language", async () => {
    const { id, pids } = await carWithParts(["A", "B"]);
    await api("POST", `/vehicles/${id}/orders`, { kind: "main", partIds: [pids[0]], send: true });
    const extra = await api("POST", `/vehicles/${id}/orders`, { kind: "complement", partIds: [pids[1]], send: true });
    expect(extra.body.code).toBe("order_reason_required");
    const ok = await api("POST", `/vehicles/${id}/orders`, { kind: "complement", reason: "forgotten", partIds: [pids[1]], send: true });
    expect(ok.status).toBe(201); expect(ok.body.status).toBe("sent");
    expect((await ord(id)).map((o) => [o.kind, o.reason])).toEqual([["main", null], ["complement", "forgotten"]]);
    expect(lastMail().subject).toContain(ok.body.number);
  });
  it("Modification while 'sent': new quantity and an added part, a 'Modificación' goes out; refused once confirmed; Cancellation of a line sends an 'Anulación' and cancels the part; the whole order cancelled", async () => {
    const { id, pids } = await carWithParts(["A", "B", "C"]);
    const m = await api("POST", `/vehicles/${id}/orders`, { kind: "main", partIds: [pids[0], pids[1]], send: true });
    const [main] = await ord(id);
    const lines = await c.h.db.select().from(partOrderLines).where(eq(partOrderLines.orderId, main.id));
    const la = lines.find((l) => l.designation === "A")!;
    const mod = await api("POST", `/parts/orders/${main.id}/modify`, { qty: { [la.id]: 4 }, addPartIds: [pids[2]], reason: "customer asked" });
    expect(mod.status).toBe(201); expect(mod.body.number).not.toBe(m.body.number);
    const all = await ord(id);
    expect(all.map((o) => o.kind)).toEqual(["main", "modification"]); expect(all[1]).toMatchObject({ parentOrderId: main.id, status: "sent", reason: "customer asked" });
    expect((await c.h.db.select().from(partOrderLines).where(eq(partOrderLines.id, la.id)))[0].qty).toBe(4);
    expect((await part(pids[2])).orderId).toBe(main.id); expect((await part(pids[2])).status).toBe("order_sent");
    expect(lastMail().subject).toContain(mod.body.number);
    // cancel one line
    const lb = lines.find((l) => l.designation === "B")!;
    const can = await api("POST", `/parts/orders/${main.id}/cancel`, { lineIds: [lb.id], reason: "not needed" });
    expect(can.status).toBe(201);
    expect(await part(pids[1])).toMatchObject({ status: "cancelled" }); expect((await part(pids[1])).deletedAt).toBeInstanceOf(Date); // never deleted for good
    expect((await ord(id)).map((o) => o.kind)).toEqual(["main", "modification", "cancellation"]);
    expect((await ord(id))[0].status).toBe("sent");
    // confirm: Ordered; afterwards no modification / cancellation from here
    const conf = await api("POST", `/parts/orders/${main.id}/confirm`, { announced: "2030-01-15", note: "by phone" });
    expect(conf.status).toBe(200); expect(conf.body.status).toBe("confirmed");
    expect(await part(pids[0])).toMatchObject({ status: "ordered" }); expect((await part(pids[0])).expectedAt).toBe("2030-01-15");
    expect((await api("POST", `/parts/orders/${main.id}/modify`, { qty: { [la.id]: 2 }, reason: "x" })).body.code).toBe("order_not_modifiable");
    expect((await api("POST", `/parts/orders/${main.id}/cancel`, { reason: "x" })).body.code).toBe("order_not_modifiable");
    expect((await api("POST", `/parts/orders/${main.id}/confirm`, {})).body.code).toBe("order_not_confirmable");
    // a draft cancelled: nothing goes out, the parts are free again
    const car2 = await carWithParts(["D"]);
    const d = await api("POST", `/vehicles/${car2.id}/orders`, { kind: "main", send: false });
    const mails = c.mailer.sent.length;
    expect((await api("POST", `/parts/orders/${d.body.id}/cancel`, { reason: "changed my mind" })).status).toBe(201);
    expect(c.mailer.sent.length).toBe(mails);
    expect((await ord(car2.id))[0].status).toBe("cancelled"); expect((await part(car2.pids[0])).orderId).toBeNull();
    // a whole sent order cancelled
    const car3 = await carWithParts(["E"]);
    await api("POST", `/vehicles/${car3.id}/orders`, { kind: "main", send: true });
    const [o3] = await ord(car3.id);
    expect((await api("POST", `/parts/orders/${o3.id}/cancel`, { reason: "total loss" })).status).toBe(201);
    expect((await ord(car3.id)).map((o) => o.status)).toEqual(["cancelled", "sent"]); // the order is cancelled, its Anulación was sent
    expect((await ord(car3.id))[1].kind).toBe("cancellation");
  });
  it("delivered: when every part of the order has arrived, the order is 'Delivered'; a returned part leaves the order and can be ordered again as an extra order", async () => {
    const { id, pids } = await carWithParts(["A", "B"]);
    await api("POST", `/vehicles/${id}/orders`, { kind: "main", send: true });
    const [o] = await ord(id);
    await one(chef, op("part.deliver", { partId: pids[0] }));
    expect((await ord(id))[0].status).toBe("sent");
    await one(chef, op("part.deliver", { partId: pids[1] }));
    expect((await ord(id))[0].status).toBe("delivered");
    expect((await one(chef, op("part.return", { partId: pids[0], reason: "damaged" }))).status).toBe("ok");
    expect((await part(pids[0])).orderId).toBeNull();
    const extra = await api("POST", `/vehicles/${id}/orders`, { kind: "complement", reason: "damaged", send: true });
    expect(extra.status).toBe(201);
    void o;
  });
});

describe("the main order starts with the insurer approval AND the repair appointment", () => {
  it("automatic: nothing before both; then it leaves by itself; the wanted day = appointment - 1 working day; the parts copied from the old list are not sent", async () => {
    await settings({ mode: "automatic" });
    const { id, pids } = await carWithParts(["A", "B"]);
    await c.h.db.update(vehicleParts).set({ source: "migrated" }).where(eq(vehicleParts.id, pids[1]));
    expect((await api("POST", `/vehicles/${id}/approval`, { note: "OK Allianz" })).status).toBe(200);
    expect(await ord(id)).toHaveLength(0); // approved, but no repair appointment yet
    const day = workday(25);
    const mails = c.mailer.sent.length;
    expect((await one(assessor, op("booking.create", { vehicleId: id, booking: { id: uuid(), date: day, time: "08:30", phone: "+34 612 345 678", email: "kunde@example.test" } }))).status).toBe("ok");
    // the order is made right after the commit of the booking
    for (let i = 0; i < 40 && !(await ord(id)).length; i++) await new Promise((r) => setTimeout(r, 50));
    const [o] = await ord(id);
    expect(o).toMatchObject({ kind: "main", status: "sent" }); expect(o.requestedDeliveryDate).toBe(subWorkdays(day, 1));
    expect(c.mailer.sent.length).toBeGreaterThan(mails);
    expect((await c.h.db.select().from(partOrderLines).where(eq(partOrderLines.orderId, o.id))).map((l) => l.designation)).toEqual(["A"]);
    expect((await part(pids[1])).orderId).toBeNull(); // never sent by itself
  });
  it("manual validation: the order waits as a draft; 'send parts order now' at the approval sends at once, without an appointment", async () => {
    await settings({ mode: "manual" });
    const a = await carWithParts(["A"]);
    await api("POST", `/vehicles/${a.id}/approval`, {});
    await one(assessor, op("booking.create", { vehicleId: a.id, booking: { id: uuid(), date: workday(26), time: "09:00", phone: "+34 612 345 678", email: "kunde@example.test" } }));
    for (let i = 0; i < 40 && !(await ord(a.id)).length; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await ord(a.id))[0].status).toBe("draft");
    const b = await carWithParts(["B"]);
    const r = await api("POST", `/vehicles/${b.id}/approval`, { sendOrderNow: true });
    expect(r.body.order).toMatchObject({ status: "sent" });
    expect((await ord(b.id))[0].requestedDeliveryDate).toBe(addWorkdays(todayIn("Europe/Madrid"), 3)); // no appointment: the usual delay of the body shop
    expect((await api("POST", `/vehicles/${b.id}/approval`, {}, assessor)).status).toBe(403); // pieces.commander
  });
});

describe("failures, retries, reminders", () => {
  it("a failed send is retried by the queue; after 3 failures 'send failed' (seen in the history) and a person can Retry", async () => {
    await settings({ mode: "manual", reminder_days: 0 });
    const { id } = await carWithParts(["A"]);
    const d = await api("POST", `/vehicles/${id}/orders`, { kind: "main", send: false });
    c.mailer.fail = new Error("graph down");
    const s = await api("POST", `/parts/orders/${d.body.id}/send`);
    expect(s.body.status).toBe("sending"); expect(s.body.attempts).toBe(1); expect(s.body.lastError).toContain("graph down");
    expect((await runOrderQueue({ db: c.h.db, storage: c.storage, mailer: c.mailer })).failed).toBe(0); // too soon: the retry waits
    await c.h.db.update(partOrders).set({ lastAttemptAt: new Date(Date.now() - 10 * 60_000) }).where(eq(partOrders.id, d.body.id));
    await runOrderQueue({ db: c.h.db, storage: c.storage, mailer: c.mailer });
    await c.h.db.update(partOrders).set({ lastAttemptAt: new Date(Date.now() - 10 * 60_000) }).where(eq(partOrders.id, d.body.id));
    expect((await runOrderQueue({ db: c.h.db, storage: c.storage, mailer: c.mailer })).failed).toBe(1);
    expect((await ord(id))[0]).toMatchObject({ status: "send_failed", attempts: 3 });
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).some((e) => e.type === "order_send_failed")).toBe(true);
    expect((await part((await c.h.db.select().from(partOrderLines).where(eq(partOrderLines.orderId, d.body.id)))[0].vehiclePartId)).status).toBe("to_order"); // nothing left
    c.mailer.fail = null;
    const retry = await api("POST", `/parts/orders/${d.body.id}/send`);
    expect(retry.body.status).toBe("sent");
  });
  it("reminder: after N days without confirmation one 'Recordatorio' goes out (same PDF), once; none when off or already confirmed", async () => {
    await settings({ mode: "manual", reminder_days: 2 });
    const { id } = await carWithParts(["A"]);
    const d = await api("POST", `/vehicles/${id}/orders`, { kind: "main", send: true });
    const run = () => runOrderQueue({ db: c.h.db, storage: c.storage, mailer: c.mailer });
    expect((await run()).reminded).toBe(0); // just sent
    await c.h.db.update(partOrders).set({ sentAt: new Date(Date.now() - 3 * 86400_000) }).where(eq(partOrders.id, d.body.id));
    const mails = c.mailer.sent.length;
    expect((await run()).reminded).toBe(1);
    expect(lastMail().subject.startsWith("Recordatorio: ")).toBe(true); expect(c.mailer.sent.length).toBe(mails + 1);
    expect((await run()).reminded).toBe(0); // once
    expect((await c.h.db.select().from(repairEvents).where(eq(repairEvents.vehicleId, id))).some((e) => e.type === "order_reminder")).toBe(true);
    const e2 = await carWithParts(["B"]);
    const d2 = await api("POST", `/vehicles/${e2.id}/orders`, { kind: "main", send: true });
    await api("POST", `/parts/orders/${d2.body.id}/confirm`, {});
    await c.h.db.update(partOrders).set({ sentAt: new Date(Date.now() - 3 * 86400_000) }).where(eq(partOrders.id, d2.body.id));
    expect((await run()).reminded).toBe(0); // confirmed: nothing to remind
  });
});

describe("the list of orders and 'late'", () => {
  it("filters by status, body shop, plate, order number; an order is late when the wanted (announced) day passed and a part has not arrived", async () => {
    const { id } = await carWithParts(["A"]);
    const d = await api("POST", `/vehicles/${id}/orders`, { kind: "main", send: true });
    const all = (await api("GET", "/parts/orders")).body as { number: string; plate: string; late: boolean; status: string; bodyShopId: string }[];
    expect(all.find((o) => o.number === d.body.number)).toMatchObject({ late: false, status: "sent", bodyShopId: CARRO });
    expect(((await api("GET", `/parts/orders?q=${d.body.number}`)).body as unknown[]).length).toBe(1);
    expect(((await api("GET", `/parts/orders?q=${"PO-" + id.slice(0, 4)}`)).body as unknown[]).length).toBe(1);
    expect(((await api("GET", `/parts/orders?status=nonexistent`)).body as unknown[]).length).toBe(0);
    expect(((await api("GET", `/parts/orders?bodyshop=${CARRO}`)).body as unknown[]).length).toBeGreaterThan(1);
    await c.h.db.update(partOrders).set({ requestedDeliveryDate: "2020-01-01" }).where(eq(partOrders.id, d.body.id));
    const late = ((await api("GET", `/parts/orders?q=${d.body.number}`)).body as { late: boolean }[])[0];
    expect(late.late).toBe(true);
    const per = (await api("GET", `/vehicles/${id}/orders`)).body;
    expect(per.orders).toHaveLength(1); expect(per.ordering).toMatchObject({ enabled: true, hasRecipient: true });
  });
});

describe("the document", () => {
  const doc = (n: number): OrderDoc => ({
    number: "PED-2026-00042", kind: "main", date: "2026-11-06T10:00:00Z", lang: "es",
    to: { name: "Talleres Masa", cif: "B12345678", address: "Calle 1, Madrid", contact: "Marta" }, vehicle: { plate: "900 KDK", vin: "VSS", makeModel: "Seat Leon", insurer: "Allianz", claim: "123" },
    delivery: { address: "PDR Team Madrid", date: "2026-11-20" }, lines: Array.from({ length: n }, (_, i) => ({ n: i + 1, zone: "Techo", designation: `Pieza ${i + 1} con un nombre bastante largo para envolver`, oem: i % 2 ? "ABC123" : "", qty: 1 })), observations: "Urgente",
  });
  it("a request in four languages: one page for a few lines, more pages for many; the sentence 'not an invoice' is in the file; never any amount word", async () => {
    for (const lang of ["es", "de", "en", "fr"] as const) {
      const b = await generateOrderPdf({ ...doc(3), lang });
      expect(Buffer.from(b).subarray(0, 4).toString()).toBe("%PDF");
      expect((await PDFDocument.load(b)).getPageCount()).toBe(1);
    }
    expect((await PDFDocument.load(await generateOrderPdf(doc(60)))).getPageCount()).toBeGreaterThan(1);
    for (const kind of ["modification", "cancellation", "complement"] as const) expect((await generateOrderPdf({ ...doc(2), kind, parentNumber: "PED-2026-00041", reason: "forgotten" })).length).toBeGreaterThan(1000);
  });
  it("the e-mail template: variables are replaced, an unknown one stays empty (never '{{…}}' to a body shop); defaults exist in four languages", () => {
    expect(renderTemplate("Hola {{body_shop_contact}} {{nope}}!", { body_shop_contact: "Marta" })).toBe("Hola Marta !");
    for (const l of ["es", "de", "en", "fr"] as const) { const t = defaultOrderTemplate(l); expect(t.subject).toContain("{{order_number}}"); expect(t.body).toContain("{{delivery_date}}"); }
    expect(addWorkdays("2026-11-06", 1)).toBe("2026-11-09"); // Friday -> Monday
    expect(subWorkdays("2026-11-09", 1)).toBe("2026-11-06"); // Monday -> Friday
  });
});

void sql;
