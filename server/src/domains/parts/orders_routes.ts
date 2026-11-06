// Routes of the parts orders (F3b): orders of a car / of the organisation, preview, create, send / retry / resend, modify, cancel, confirm, insurer approval;
// and the "Parts ordering" settings of each body shop (Administration → Billing). Rights are checked HERE.
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { generateOrderPdf, defaultOrderTemplate, orderKindLabel, orderLabels, renderTemplate, ORDER_REASONS, type OrderDoc, type OrderLang } from "@hagel/documents";
import type { ErrorCode, Permission } from "@hagel/shared";
import { audit } from "../../audit";
import type { Db } from "../../db";
import type { Mailer } from "../../email";
import type { Env } from "../../env";
import type { Hub } from "../../hub";
import { can, effectivePermissions, hasOrgPermission, type Principal } from "../../permissions";
import type { Storage } from "../../storage";
import { HttpError } from "../auth/auth";
import { bodyShopOrderSettings, partOrderLines, partOrders, stations, users, vehicleAssignments, vehicleParts, vehicles } from "../../schema";
import { refOf, type VehicleRow } from "../vehicles/sync";
import {
  OrderError, attemptSend, cancelOrder, confirmOrder, contextOf, createOrder, eligibleParts, isEmail, loadSettings, maybeCreateMainOrder, mailOf, modifyOrder, orderFileName, pdfOf, queueSend, resend, wantedDate, zoneNameIn, type OrderDeps, type OrderRow,
} from "./orders";

interface Deps { db: Db; storage: Storage; mailer?: Mailer; needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env>; validationHook: (r: { success: boolean }, c: Context) => Response | undefined }

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const createInput = z.object({
  partIds: z.array(z.string().uuid()).max(100).optional(), kind: z.enum(["main", "complement"]).default("complement"), reason: z.enum(ORDER_REASONS).optional(),
  reasonText: z.string().trim().max(300).optional(), observations: z.string().max(1000).optional(), requestedDate: ymd.optional(), send: z.boolean().default(true),
});

const asHttp = (e: unknown): never => {
  if (e instanceof OrderError) throw new HttpError(e.status, e.code as ErrorCode);
  throw e;
};

export function orderRoutes({ db, storage, mailer, needAuth, needOrg, validationHook }: Deps) {
  const r = new Hono<Env>();
  const deps: OrderDeps = { db, storage, mailer };
  const org = (c: Context<Env>) => c.get("orgId");

  const load = async (c: Context<Env>, vehicleId: string): Promise<{ row: VehicleRow; u: Principal; ref: ReturnType<typeof refOf> }> => {
    const [row] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.orgId, org(c))));
    if (!row || row.deletedAt) throw new HttpError(404, "vehicle_not_found");
    const as = (await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, row.id))).map((a) => a.userId);
    const u = c.get("principal"), ref = refOf(row, as);
    if (!can(u, "vehicules.voir", ref) || !can(u, "pieces.voir", ref)) throw new HttpError(404, "vehicle_not_found"); // for the others the data does not exist
    return { row, u, ref };
  };
  const need = (u: Principal, perm: Permission, ref: ReturnType<typeof refOf>) => { if (!can(u, perm, ref)) throw new HttpError(403, "forbidden"); };

  /** an order for the screens (no prices exist at all; the PDF never shows any) */
  const shape = async (orders: OrderRow[]) => {
    if (!orders.length) return [];
    const ids = orders.map((o) => o.id);
    const lines = await db.select().from(partOrderLines).where(inArray(partOrderLines.orderId, ids));
    const veh = new Map((await db.select().from(vehicles).where(inArray(vehicles.id, [...new Set(orders.map((o) => o.vehicleId))]))).map((v) => [v.id, v]));
    const sts = new Map((await db.select().from(stations).where(eq(stations.orgId, orders[0].orgId))).map((s) => [s.id, s]));
    const parents = new Map(orders.map((o) => [o.id, o.number]));
    const pids = [...new Set(lines.map((l) => l.vehiclePartId))];
    const parts = pids.length ? new Map((await db.select({ id: vehicleParts.id, status: vehicleParts.status, deletedAt: vehicleParts.deletedAt, expectedAt: vehicleParts.expectedAt }).from(vehicleParts).where(inArray(vehicleParts.id, pids))).map((p) => [p.id, p])) : new Map();
    const names = new Map((await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, [...new Set(orders.map((o) => o.createdBy).filter((x): x is string => !!x))]))).map((x) => [x.id, x.name || x.email]));
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
    return orders.map((o) => {
      const v = veh.get(o.vehicleId), f = (v?.header ?? {}) as Record<string, unknown>;
      const ls = lines.filter((l) => l.orderId === o.id).sort((a, b) => a.n - b.n).map((l) => ({ id: l.id, n: l.n, partId: l.vehiclePartId, designation: l.designation, zone: l.zone, oem: l.oemRef, qty: l.qty, status: parts.get(l.vehiclePartId)?.status ?? null, cancelled: !!parts.get(l.vehiclePartId)?.deletedAt }));
      // late: the announced (else wanted) day passed and a part of the order has not arrived
      const due = o.announcedDeliveryDate ?? o.requestedDeliveryDate;
      const late = ["sent", "confirmed"].includes(o.status) && !!due && due < today && ls.some((l) => !l.cancelled && l.status !== "delivered" && l.status !== "installed");
      return {
        id: o.id, number: o.number, vehicleId: o.vehicleId, plate: String(f.kennzeichen ?? ""), model: String(f.modell ?? ""), claim: String(f.claimNumber ?? ""), stationId: v?.stationId ?? null,
        bodyShopId: o.bodyShopId, bodyShop: sts.get(o.bodyShopId)?.name ?? "", kind: o.kind, reason: o.reason, parentNumber: o.parentOrderId ? parents.get(o.parentOrderId) ?? null : null, parentId: o.parentOrderId,
        status: o.status, requestedDate: o.requestedDeliveryDate, announcedDate: o.announcedDeliveryDate, sentAt: o.sentAt, confirmedAt: o.confirmedAt, createdAt: o.createdAt,
        recipients: o.recipients, lang: o.lang, observations: o.observations, lastError: o.lastError, attempts: o.attempts, createdBy: o.createdBy ? names.get(o.createdBy) ?? "" : "", late, lines: ls,
      };
    });
  };

  r.get("/parts/orders", needAuth, needOrg, async (c) => {
    const u = c.get("principal");
    const q = c.req.query();
    const rows = await db.select().from(partOrders).where(eq(partOrders.orgId, org(c))).orderBy(desc(partOrders.createdAt)).limit(1000);
    const ids = [...new Set(rows.map((o) => o.vehicleId))];
    const vs = ids.length ? await db.select().from(vehicles).where(inArray(vehicles.id, ids)) : [];
    const as = ids.length ? await db.select().from(vehicleAssignments).where(inArray(vehicleAssignments.vehicleId, ids)) : [];
    const visible = new Set(vs.filter((v) => { const ref = refOf(v, as.filter((a) => a.vehicleId === v.id).map((a) => a.userId)); const p = effectivePermissions(u, ref); return p.has("vehicules.voir") && p.has("pieces.voir"); }).map((v) => v.id));
    let list = await shape(rows.filter((o) => visible.has(o.vehicleId)));
    if (q.status) list = list.filter((o) => o.status === q.status);
    if (q.bodyshop) list = list.filter((o) => o.bodyShopId === q.bodyshop);
    if (q.station) list = list.filter((o) => o.stationId === q.station);
    if (q.from) list = list.filter((o) => (o.sentAt ?? o.createdAt).toISOString().slice(0, 10) >= q.from!);
    if (q.to) list = list.filter((o) => (o.sentAt ?? o.createdAt).toISOString().slice(0, 10) <= q.to!);
    if (q.q) { const s = q.q.toLowerCase(); list = list.filter((o) => [o.number, o.plate, o.claim, o.bodyShop].some((x) => x.toLowerCase().includes(s))); }
    return c.json(list);
  });

  r.get("/vehicles/:id/orders", needAuth, needOrg, async (c) => {
    const { row } = await load(c, c.req.param("id") ?? "");
    const rows = await db.select().from(partOrders).where(eq(partOrders.vehicleId, row.id)).orderBy(partOrders.createdAt);
    const settings = await loadSettings(db, row.clientStationId);
    return c.json({ orders: await shape(rows), ordering: { enabled: !!settings?.enabled, mode: settings?.mode ?? "manual", hasRecipient: !!settings?.toEmails.length, bodyShopId: row.clientStationId }, approval: { at: row.insurerApprovedAt, note: row.insurerApprovalNote } });
  });

  r.get("/parts/orders/:id/pdf", needAuth, needOrg, async (c) => {
    const [o] = await db.select().from(partOrders).where(and(eq(partOrders.id, c.req.param("id") ?? ""), eq(partOrders.orgId, org(c))));
    if (!o) throw new HttpError(404, "order_not_found");
    await load(c, o.vehicleId);
    const bytes = await pdfOf(deps, o);
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${orderFileName(o)}"`, "cache-control": "private, no-store" } });
  });

  /** what would leave: recipients, subject, text, the parts and the PDF (as base64) — nothing is saved or sent */
  r.post("/vehicles/:id/orders/preview", needAuth, needOrg, zValidator("json", createInput, validationHook), async (c) => {
    const { row, u, ref } = await load(c, c.req.param("id") ?? "");
    need(u, "pieces.commander", ref);
    const b = c.req.valid("json");
    try {
      const ctx = await contextOf(db, row, u.id);
      const parts = await eligibleParts(db, row.id, { onlyAutomatic: false, ids: b.partIds });
      const lang = (["es", "de", "en", "fr"].includes(ctx.settings.lang) ? ctx.settings.lang : "es") as OrderLang;
      const requested = b.requestedDate ?? (await wantedDate(db, row, ctx.settings));
      const f = ctx.flat;
      const doc: OrderDoc = {
        number: "PED-····-·····", kind: b.kind, reason: b.reason ?? null, date: new Date().toISOString(), lang,
        to: { name: ctx.bodyShop.name, cif: ctx.bodyShop.cif ?? undefined, address: ctx.bodyShop.address || undefined, contact: [ctx.bodyShop.contactName, ctx.bodyShop.contactPhone].filter(Boolean).join(" · ") || undefined },
        vehicle: { plate: String(f.kennzeichen ?? ""), vin: String(f.fin ?? ""), makeModel: [f.marke, f.modell].filter(Boolean).join(" "), insurer: ctx.insurer, claim: String(f.claimNumber ?? "") },
        delivery: { address: [ctx.station?.name, ctx.station?.address].filter(Boolean).join(", "), date: requested },
        lines: await Promise.all(parts.map(async (p, i) => ({ n: i + 1, zone: await zoneNameIn(db, row.orgId, p.zoneKey, lang), designation: p.name, oem: p.oemRef ?? "", qty: p.qty }))), observations: b.observations,
      };
      const def = defaultOrderTemplate(lang);
      const vars = { order_number: doc.number, order_type: orderKindLabel(b.kind, lang), plate: doc.vehicle.plate, make_model: doc.vehicle.makeModel, claim_number: doc.vehicle.claim, insurer: doc.vehicle.insurer, delivery_address: doc.delivery.address, delivery_date: requested.split("-").reverse().join("/"), parts_count: String(parts.length), body_shop_contact: ctx.bodyShop.contactName || ctx.bodyShop.name, sender: "", station: ctx.station?.name ?? "" };
      const pdf = await generateOrderPdf(doc);
      return c.json({
        subject: renderTemplate(ctx.settings.subjectTemplate.trim() || def.subject, vars), text: renderTemplate(ctx.settings.bodyTemplate.trim() || def.body, vars),
        to: ctx.recipients.to, cc: ctx.recipients.cc, replyTo: ctx.recipients.replyTo, requestedDate: requested, lang, mode: ctx.settings.mode, parts: parts.map((p) => ({ id: p.id, name: p.name, qty: p.qty })), pdf: Buffer.from(pdf).toString("base64"),
      });
    } catch (e) { return asHttp(e); }
  });

  r.post("/vehicles/:id/orders", needAuth, needOrg, zValidator("json", createInput, validationHook), async (c) => {
    const { row, u, ref } = await load(c, c.req.param("id") ?? "");
    need(u, "pieces.commander", ref);
    const b = c.req.valid("json");
    try {
      const reason = b.kind === "complement" ? (b.reason === "other" && b.reasonText ? `other: ${b.reasonText}` : b.reason) : undefined;
      const o = await createOrder(deps, { vehicleId: row.id, partIds: b.partIds, kind: b.kind, reason: reason ?? null, observations: b.observations, requestedDate: b.requestedDate ?? null, userId: u.id, mode: b.send ? "send" : "draft" });
      const status = o.status === "sending" ? await attemptSend(deps, o.id) : o.status;
      return c.json({ id: o.id, number: o.number, status }, 201);
    } catch (e) { return asHttp(e); }
  });

  const orderOf = async (c: Context<Env>, perm: Permission) => {
    const [o] = await db.select().from(partOrders).where(and(eq(partOrders.id, c.req.param("id") ?? ""), eq(partOrders.orgId, org(c))));
    if (!o) throw new HttpError(404, "order_not_found");
    const x = await load(c, o.vehicleId);
    need(x.u, perm, x.ref);
    return { o, ...x };
  };
  const done = async (c: Context<Env>, id: string) => c.json((await shape((await db.select().from(partOrders).where(eq(partOrders.id, id)))))[0]);

  r.post("/parts/orders/:id/send", needAuth, needOrg, async (c) => {
    const { o, u } = await orderOf(c, "pieces.commander");
    try { await queueSend(deps, o.id, u.id); } catch (e) { return asHttp(e); }
    return done(c, o.id);
  });
  r.post("/parts/orders/:id/resend", needAuth, needOrg, async (c) => {
    const { o, u } = await orderOf(c, "pieces.commander");
    try { await resend(deps, o.id, u.id); } catch (e) { return asHttp(e); }
    return done(c, o.id);
  });
  r.post("/parts/orders/:id/modify", needAuth, needOrg, zValidator("json", z.object({ qty: z.record(z.string().uuid(), z.number().int().min(1).max(99)).optional(), addPartIds: z.array(z.string().uuid()).max(50).optional(), reason: z.string().trim().min(1).max(300) }), validationHook), async (c) => {
    const { o, u } = await orderOf(c, "pieces.commander");
    try { const child = await modifyOrder(deps, o.id, u.id, c.req.valid("json")); return c.json({ number: child.number, id: child.id }, 201); } catch (e) { return asHttp(e); }
  });
  r.post("/parts/orders/:id/cancel", needAuth, needOrg, zValidator("json", z.object({ lineIds: z.array(z.string().uuid()).max(100).optional(), reason: z.string().trim().min(1).max(300) }), validationHook), async (c) => {
    const { o, u } = await orderOf(c, "pieces.commander");
    try { const child = await cancelOrder(deps, o.id, u.id, c.req.valid("json")); return c.json({ number: child?.number ?? null, id: child?.id ?? null }, 201); } catch (e) { return asHttp(e); }
  });
  r.post("/parts/orders/:id/confirm", needAuth, needOrg, zValidator("json", z.object({ announced: ymd.nullable().optional(), note: z.string().trim().max(300).optional() }), validationHook), async (c) => {
    const { o, u } = await orderOf(c, "pieces.commander");
    try { await confirmOrder(deps, o.id, u.id, c.req.valid("json")); } catch (e) { return asHttp(e); }
    return done(c, o.id);
  });

  /** D28: the insurer approved the repair. With the repair appointment booked, the main order starts (or at once with "send the parts order now"). */
  r.post("/vehicles/:id/approval", needAuth, needOrg, zValidator("json", z.object({ note: z.string().trim().max(300).optional(), sendOrderNow: z.boolean().default(false) }), validationHook), async (c) => {
    const { row, u, ref } = await load(c, c.req.param("id") ?? "");
    need(u, "pieces.commander", ref);
    const b = c.req.valid("json");
    const now = new Date();
    await db.update(vehicles).set({ insurerApprovedAt: row.insurerApprovedAt ?? now, insurerApprovedBy: row.insurerApprovedBy ?? u.id, insurerApprovalNote: b.note ?? row.insurerApprovalNote ?? null, updatedAt: now }).where(eq(vehicles.id, row.id));
    await audit(db, { orgId: row.orgId, userId: u.id, action: "insurer_approval", entity: "vehicle", entityId: row.id, after: { note: b.note ?? null } });
    let order: OrderRow | null = null;
    try { order = await maybeCreateMainOrder(deps, row.id, u.id, { force: b.sendOrderNow }); } catch (e) { if (!(e instanceof OrderError)) throw e; }
    const out = { approvedAt: (row.insurerApprovedAt ?? now).toISOString(), order: order ? { id: order.id, number: order.number, status: order.status } : null };
    return c.json(out);
  });

  void mailOf;
  return r;
}

// ------------------------------------------------------------------ Administration → Billing: "Parts ordering" of a body shop

const emails = z.array(z.string().trim().toLowerCase().max(200)).max(10);
const settingsInput = z.object({
  enabled: z.boolean(), mode: z.enum(["automatic", "manual"]), to_emails: emails, cc_emails: emails, reply_to: z.string().trim().toLowerCase().max(200).nullable(),
  lang: z.enum(["es", "de", "en", "fr"]), show_prices: z.boolean(), delivery_days: z.number().int().min(0).max(30), reminder_days: z.number().int().min(0).max(3),
  subject_template: z.string().max(300), body_template: z.string().max(4000),
}).partial();

export function orderSettingsRoutes({ db, hub, storage, mailer, require, validationHook }: { db: Db; hub: Hub; storage: Storage; mailer?: Mailer; require: (p: Permission) => MiddlewareHandler<Env>; validationHook: (r: { success: boolean }, c: Context) => Response | undefined }) {
  const r = new Hono<Env>();
  const org = (c: Context<Env>) => c.get("orgId");
  const shape = (s: typeof bodyShopOrderSettings.$inferSelect | null, stationId: string) => ({
    station_id: stationId, enabled: s?.enabled ?? false, mode: s?.mode ?? "manual", to_emails: s?.toEmails ?? [], cc_emails: s?.ccEmails ?? [], reply_to: s?.replyTo ?? null, lang: s?.lang ?? "es",
    show_prices: s?.showPrices ?? false, delivery_days: s?.deliveryDays ?? 3, reminder_days: s?.reminderDays ?? 0, subject_template: s?.subjectTemplate ?? "", body_template: s?.bodyTemplate ?? "",
    default_template: Object.fromEntries((["es", "de", "en", "fr"] as OrderLang[]).map((l) => [l, defaultOrderTemplate(l)])),
  });
  const shop = async (c: Context<Env>) => {
    const [st] = await db.select().from(stations).where(and(eq(stations.id, c.req.param("id") ?? ""), eq(stations.orgId, org(c)), eq(stations.type, "carrosserie")));
    if (!st) throw new HttpError(404, "station_not_found");
    return st;
  };

  r.get("/bodyshops/:id/order-settings", require("facturation.gerer"), async (c) => { const st = await shop(c); return c.json(shape(await loadSettings(db, st.id), st.id)); });

  r.put("/bodyshops/:id/order-settings", require("facturation.gerer"), zValidator("json", settingsInput, validationHook), async (c) => {
    const st = await shop(c), b = c.req.valid("json");
    const before = await loadSettings(db, st.id);
    const next = {
      enabled: b.enabled ?? before?.enabled ?? false, mode: b.mode ?? before?.mode ?? "manual", toEmails: b.to_emails ?? before?.toEmails ?? [], ccEmails: b.cc_emails ?? before?.ccEmails ?? [],
      replyTo: b.reply_to !== undefined ? b.reply_to || null : before?.replyTo ?? null, lang: b.lang ?? before?.lang ?? "es", showPrices: b.show_prices ?? before?.showPrices ?? false,
      deliveryDays: b.delivery_days ?? before?.deliveryDays ?? 3, reminderDays: b.reminder_days ?? before?.reminderDays ?? 0,
      subjectTemplate: b.subject_template ?? before?.subjectTemplate ?? "", bodyTemplate: b.body_template ?? before?.bodyTemplate ?? "",
    };
    if ([...next.toEmails, ...next.ccEmails, ...(next.replyTo ? [next.replyTo] : [])].some((e) => !isEmail(e))) throw new HttpError(400, "invalid_input");
    // the server refuses "Automatic" without an order e-mail address
    if (next.enabled && next.mode === "automatic" && !next.toEmails.length) throw new HttpError(400, "order_automatic_needs_email");
    await db.insert(bodyShopOrderSettings).values({ stationId: st.id, orgId: org(c), ...next }).onConflictDoUpdate({ target: bodyShopOrderSettings.stationId, set: { ...next, updatedAt: new Date() } });
    await audit(db, { orgId: org(c), userId: c.get("principal").id, action: "update", entity: "body_shop_order_settings", entityId: st.id, before, after: next });
    hub.publish(org(c), 0);
    return c.json(shape(await loadSettings(db, st.id), st.id));
  });

  /** "Send test": a sample order (fictitious car) goes to the logged-in user ONLY, never to the body shop */
  r.post("/bodyshops/:id/order-settings/test", require("facturation.gerer"), async (c) => {
    const st = await shop(c), s = await loadSettings(db, st.id);
    const [me] = await db.select().from(users).where(eq(users.id, c.get("principal").id));
    if (!me?.email) throw new HttpError(400, "invalid_input");
    if (!mailer) throw new HttpError(409, "order_send_failed");
    const lang = (s && ["es", "de", "en", "fr"].includes(s.lang) ? s.lang : "es") as OrderLang;
    const L = orderLabels(lang);
    const doc: OrderDoc = {
      number: "PED-TEST-00000", kind: "main", date: new Date().toISOString(), lang,
      to: { name: st.name, cif: st.cif ?? undefined, address: st.address || undefined, contact: st.contactName ?? undefined },
      vehicle: { plate: "900 KDK", vin: "VSSZZZ5FZ00000000", makeModel: "Seat Leon", insurer: "Allianz", claim: "TEST-0001" },
      delivery: { address: "PDR Team", date: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10) },
      lines: [{ n: 1, zone: L.parts, designation: "Moldura de techo", oem: "", qty: 1 }, { n: 2, zone: L.parts, designation: "Antena", oem: "5F0035507", qty: 1 }],
    };
    const def = defaultOrderTemplate(lang);
    const vars = { order_number: doc.number, order_type: orderKindLabel("main", lang), plate: "900 KDK", make_model: "Seat Leon", claim_number: "TEST-0001", insurer: "Allianz", delivery_address: "PDR Team", delivery_date: doc.delivery.date!.split("-").reverse().join("/"), parts_count: "2", body_shop_contact: st.contactName || st.name, sender: me.name || me.email, station: "PDR Team" };
    const pdf = await generateOrderPdf(doc);
    try { await mailer.send({ to: me.email, subject: "[TEST] " + renderTemplate(s?.subjectTemplate.trim() || def.subject, vars), text: renderTemplate(s?.bodyTemplate.trim() || def.body, vars), attachments: [{ filename: "PED-TEST.pdf", content: pdf, contentType: "application/pdf" }] }); }
    catch { throw new HttpError(409, "order_send_failed"); }
    void storage;
    return c.json({ sentTo: me.email });
  });
  void hasOrgPermission;
  return r;
}
