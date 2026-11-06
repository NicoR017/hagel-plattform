// Parts orders to the body shop (Repair v2, F3b). PDR Team España cannot order in its own name yet: the body shop orders, pays and is refunded by the insurer.
// The app therefore sends a REQUEST ("Solicitud de pedido de piezas", number PED-YYYY-NNNNN, no VAT, no total, no IBAN, no prices by default),
// a "Modificación" or an "Anulación" — never an invoice. The PDF that was sent is a FROZEN snapshot. Nothing sent is ever deleted.
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  ZONE_NAMES, type PartLang,
} from "@hagel/shared";
import {
  ORDER_VARS, defaultOrderTemplate, generateOrderPdf, orderKindLabel, renderTemplate, REMINDER_PREFIX, type OrderDoc, type OrderKind, type OrderLang,
} from "@hagel/documents";
import { audit } from "../../audit";
import type { Db } from "../../db";
import type { Mailer } from "../../email";
import type { Storage } from "../../storage";
import { letterheadOf } from "../repair/report";
import { replyToFor } from "../reports/reply_to";
import { flatten, nextSeq, type VehicleRow } from "../vehicles/sync";
import {
  bodyShopOrderSettings, insurers, orgCounters, partOrderLines, partOrders, partZones, repairBookings, repairEvents, stations, users, vehicleParts, vehicles,
} from "../../schema";

export type OrderRow = typeof partOrders.$inferSelect;
export type SettingsRow = typeof bodyShopOrderSettings.$inferSelect;
export interface OrderDeps { db: Db; storage: Storage; mailer?: Mailer }
export class OrderError extends Error { constructor(public code: string, public status: 400 | 403 | 404 | 409 = 400) { super(code); } }

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MIN = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (s: string) => EMAIL_RE.test(s.trim());

// ------------------------------------------------------------------ working days

const toDate = (ymd: string) => new Date(ymd + "T12:00:00Z");
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
export function addWorkdays(ymd: string, n: number): string {
  const d = toDate(ymd);
  for (let k = 0; k < n;) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) k++; }
  return ymdOf(d);
}
export function subWorkdays(ymd: string, n: number): string {
  const d = toDate(ymd);
  for (let k = 0; k < n;) { d.setUTCDate(d.getUTCDate() - 1); if (d.getUTCDay() % 6 !== 0) k++; }
  return ymdOf(d);
}
const todayMadrid = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });

// ------------------------------------------------------------------ settings

export async function loadSettings(db: Pick<Db, "select">, stationId: string | null): Promise<SettingsRow | null> {
  if (!stationId) return null;
  const [s] = await db.select().from(bodyShopOrderSettings).where(eq(bodyShopOrderSettings.stationId, stationId));
  return s ?? null;
}
const langOf = (s: SettingsRow | null): OrderLang => (s && ["es", "de", "en", "fr"].includes(s.lang) ? (s.lang as OrderLang) : "es");

// ------------------------------------------------------------------ numbering

/** PED-2026-00042: one sequence per organisation and year, never reused (a cancelled order keeps its number; gaps are possible, duplicates are not) */
export async function nextOrderNumber(db: Pick<Db, "execute">, orgId: string, now = new Date()): Promise<string> {
  const year = Number(now.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" }).slice(0, 4));
  const r = (await db.execute(sql`INSERT INTO org_counters (org_id, key, year, n) VALUES (${orgId}, 'order', ${year}, 1) ON CONFLICT (org_id, key, year) DO UPDATE SET n = org_counters.n + 1 RETURNING n`)) as unknown as { rows: { n: number }[] };
  return `PED-${year}-${String(r.rows[0].n).padStart(5, "0")}`;
}

// ------------------------------------------------------------------ context of a car (what the order says)

export async function zoneNameIn(db: Pick<Db, "select">, orgId: string, key: string | null, lang: PartLang): Promise<string> {
  if (!key) return "";
  if (ZONE_NAMES[key]) return ZONE_NAMES[key][lang] || ZONE_NAMES[key].de;
  const [z] = await db.select().from(partZones).where(and(eq(partZones.orgId, orgId), eq(partZones.key, key)));
  if (!z) return key;
  return { de: z.nameDe, en: z.nameEn, fr: z.nameFr, es: z.nameEs }[lang] || z.nameDe || z.nameEs || key;
}

export interface OrderContext {
  settings: SettingsRow; bodyShop: typeof stations.$inferSelect; station: typeof stations.$inferSelect | null; flat: Record<string, unknown>; insurer: string;
  recipients: { to: string[]; cc: string[]; replyTo: string | null };
}
export async function contextOf(db: Db, row: VehicleRow, userId: string | null): Promise<OrderContext> {
  const settings = await loadSettings(db, row.clientStationId);
  if (!settings || !settings.enabled) throw new OrderError("order_not_enabled", 409);
  const [bodyShop] = await db.select().from(stations).where(eq(stations.id, settings.stationId));
  const [station] = row.stationId ? await db.select().from(stations).where(eq(stations.id, row.stationId)) : [];
  const [ins] = row.insurerId ? await db.select().from(insurers).where(eq(insurers.id, row.insurerId)) : [];
  const replyTo = settings.replyTo?.trim() || (await replyToFor(db, userId, row.orgId)) || null;
  return {
    settings, bodyShop, station: station ?? null, flat: flatten(row, [], null) as Record<string, unknown>, insurer: ins?.name ?? "",
    recipients: { to: settings.toEmails, cc: settings.ccEmails, replyTo },
  };
}

/** the repair appointment day of the car (booked or started), if any */
export async function bookingDateOf(db: Pick<Db, "select">, vehicleId: string): Promise<string | null> {
  const bs = await db.select({ date: repairBookings.date }).from(repairBookings).where(and(eq(repairBookings.vehicleId, vehicleId), inArray(repairBookings.status, ["booked", "started"]))).orderBy(desc(repairBookings.date)).limit(1);
  return bs[0]?.date ?? null;
}
/** wanted delivery day: the repair appointment minus one working day; without an appointment: today plus the body shop's usual delay */
export async function wantedDate(db: Pick<Db, "select">, row: VehicleRow, settings: SettingsRow): Promise<string> {
  const b = await bookingDateOf(db, row.id);
  return b ? subWorkdays(b, 1) : addWorkdays(todayMadrid(), Math.max(1, settings.deliveryDays));
}

/** tells the phones to pull (set once by the app): order changes also change what the car's parts look like */
let notifier: ((orgId: string, seq: number) => void) | null = null;
export const setOrderNotifier = (fn: ((orgId: string, seq: number) => void) | null) => { notifier = fn; };
export const notifyPhones = (orgId: string, seq: number) => { if (notifier) notifier(orgId, seq); };
const touch = async (db: Db, vehicleId: string, userId: string | null) => {
  const seq = await nextSeq(db as never);
  const [v] = await db.update(vehicles).set({ seq, ...(userId ? { updatedBy: userId } : {}), updatedAt: new Date() }).where(eq(vehicles.id, vehicleId)).returning({ orgId: vehicles.orgId });
  if (v && notifier) notifier(v.orgId, seq);
};
const event = (db: Db, vehicleId: string, userId: string | null, type: string, payload: Record<string, unknown>) => db.insert(repairEvents).values({ vehicleId, userId, type, payload: payload as never });

// ------------------------------------------------------------------ eligibility and creation

/** parts that can leave now: "to order", not in any order, not removed (parts copied from the old list are never sent by themselves, only when chosen by hand) */
export async function eligibleParts(db: Db, vehicleId: string, o: { onlyAutomatic?: boolean; ids?: string[] } = {}) {
  const rows = await db.select().from(vehicleParts).where(and(eq(vehicleParts.vehicleId, vehicleId), eq(vehicleParts.status, "to_order"), isNull(vehicleParts.orderId), isNull(vehicleParts.deletedAt))).orderBy(asc(vehicleParts.createdAt));
  return rows.filter((p) => (!o.onlyAutomatic || p.source !== "migrated") && (!o.ids || o.ids.includes(p.id)));
}

export interface CreateArgs { vehicleId: string; partIds?: string[]; kind: "main" | "complement"; reason?: string | null; observations?: string; requestedDate?: string | null; userId: string | null; mode: "draft" | "send"; onlyAutomatic?: boolean }

/** One order = one car x one body shop x one sending. Only parts "to order" that are in no order yet; the lines are a snapshot. */
export async function createOrder(deps: OrderDeps, a: CreateArgs): Promise<OrderRow> {
  const { db } = deps;
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, a.vehicleId));
  if (!row || row.deletedAt) throw new OrderError("vehicle_not_found", 404);
  const ctx = await contextOf(db, row, a.userId);
  if (!ctx.recipients.to.length) throw new OrderError("order_no_recipient", 409);
  if (a.kind === "complement" && !a.reason) throw new OrderError("order_reason_required", 400);
  if (a.kind === "main") {
    const [dup] = await db.select({ id: partOrders.id }).from(partOrders).where(and(eq(partOrders.vehicleId, row.id), eq(partOrders.kind, "main"), sql`${partOrders.status} <> 'cancelled'`));
    if (dup) throw new OrderError("order_main_exists", 409);
  }
  const parts = await eligibleParts(db, row.id, { onlyAutomatic: a.onlyAutomatic, ids: a.partIds });
  if (!parts.length || (a.partIds && parts.length !== new Set(a.partIds).size)) throw new OrderError("order_no_parts", 409); // nothing to order, or a chosen part is already in an order
  const lang = langOf(ctx.settings);
  const requested = a.requestedDate ?? (await wantedDate(db, row, ctx.settings));
  const order = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const number = await nextOrderNumber(t, row.orgId);
    const [o] = await t.insert(partOrders).values({
      orgId: row.orgId, number, vehicleId: row.id, bodyShopId: ctx.bodyShop.id, kind: a.kind, reason: a.reason ?? null, status: a.mode === "send" ? "sending" : "draft",
      requestedDeliveryDate: requested, recipients: ctx.recipients as never, lang, observations: (a.observations ?? "").slice(0, 1000), createdBy: a.userId,
    }).returning();
    let n = 1;
    for (const p of parts) {
      await t.insert(partOrderLines).values({ orderId: o.id, vehiclePartId: p.id, n: n++, zone: await zoneNameIn(t, row.orgId, p.zoneKey, lang), designation: p.name, oemRef: p.oemRef ?? "", qty: p.qty });
    }
    await t.update(vehicleParts).set({ orderId: o.id, updatedAt: new Date() }).where(inArray(vehicleParts.id, parts.map((p) => p.id)));
    await event(t, row.id, a.userId, a.mode === "send" ? "order_created" : "order_draft", { orderId: o.id, number, kind: a.kind, reason: a.reason ?? null, parts: parts.length });
    await touch(t, row.id, a.userId);
    return o;
  });
  await audit(db, { orgId: row.orgId, userId: a.userId, action: "create", entity: "part_order", entityId: order.id, after: { number: order.number, kind: a.kind, parts: parts.length } });
  return order;
}

// ------------------------------------------------------------------ PDF and e-mail

async function docOf(db: Db, order: OrderRow): Promise<{ doc: OrderDoc; row: VehicleRow; ctx: OrderContext }> {
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, order.vehicleId));
  const ctx = await contextOf(db, row, order.createdBy);
  const lines = await db.select().from(partOrderLines).where(eq(partOrderLines.orderId, order.id)).orderBy(asc(partOrderLines.n));
  const [parent] = order.parentOrderId ? await db.select({ number: partOrders.number }).from(partOrders).where(eq(partOrders.id, order.parentOrderId)) : [];
  const f = ctx.flat;
  const lang = order.lang as OrderLang;
  const doc: OrderDoc = {
    number: order.number, kind: order.kind as OrderKind, reason: order.reason, parentNumber: parent?.number ?? null, date: (order.sentAt ?? order.createdAt).toISOString(), lang,
    to: { name: ctx.bodyShop.name, cif: ctx.bodyShop.cif ?? undefined, address: ctx.bodyShop.address || undefined, contact: [ctx.bodyShop.contactName, ctx.bodyShop.contactPhone].filter(Boolean).join(" · ") || undefined },
    vehicle: { plate: String(f.kennzeichen ?? ""), vin: String(f.fin ?? ""), makeModel: [f.marke, f.modell].filter(Boolean).join(" "), insurer: ctx.insurer, claim: String(f.claimNumber ?? "") },
    delivery: { address: [ctx.station?.name, ctx.station?.address].filter(Boolean).join(", "), date: order.requestedDeliveryDate },
    lines: lines.map((l) => ({ n: l.n, zone: l.zone, designation: l.designation, oem: l.oemRef, qty: l.qty, observations: l.observations || undefined })), observations: order.observations || undefined,
  };
  return { doc, row, ctx };
}

/** the frozen PDF of an order (made once, then reused for every resend / reminder) */
export async function pdfOf(deps: OrderDeps, order: OrderRow): Promise<Uint8Array> {
  if (order.pdfKey) { const f = await deps.storage.get(order.pdfKey); if (f) return f.bytes; }
  const { doc, row } = await docOf(deps.db, order);
  const bytes = await generateOrderPdf(doc, { letterhead: await letterheadOf(deps.db, deps.storage, row) });
  const key = `orders/${order.orgId}/${order.vehicleId}/${order.id}.pdf`;
  await deps.storage.put(key, bytes, "application/pdf");
  await deps.db.update(partOrders).set({ pdfKey: key, updatedAt: new Date() }).where(eq(partOrders.id, order.id));
  return bytes;
}

export const orderFileName = (o: OrderRow) => `${o.number}.pdf`;

/** subject and text of the e-mail, from the template of the body shop (or the default one in its language) */
export async function mailOf(db: Db, order: OrderRow, reminder = false): Promise<{ subject: string; text: string; to: string[]; cc: string[]; replyTo?: string }> {
  const { doc, row, ctx } = await docOf(db, order);
  const lang = order.lang as OrderLang;
  const def = defaultOrderTemplate(lang);
  const [by] = order.createdBy ? await db.select().from(users).where(eq(users.id, order.createdBy)) : [];
  const vars: Record<(typeof ORDER_VARS)[number], string> = {
    order_number: order.number, order_type: orderKindLabel(doc.kind, lang), plate: doc.vehicle.plate, make_model: doc.vehicle.makeModel, claim_number: doc.vehicle.claim, insurer: doc.vehicle.insurer,
    delivery_address: doc.delivery.address, delivery_date: order.requestedDeliveryDate ? order.requestedDeliveryDate.split("-").reverse().join("/") : "—", parts_count: String(doc.lines.length),
    body_shop_contact: ctx.bodyShop.contactName || ctx.bodyShop.name, sender: by?.name || by?.email || "PDR Team", station: ctx.station?.name ?? "",
  };
  void row;
  const rc = order.recipients as { to?: string[]; cc?: string[]; replyTo?: string | null };
  return {
    subject: (reminder ? REMINDER_PREFIX[lang] : "") + renderTemplate(ctx.settings.subjectTemplate.trim() || def.subject, vars),
    text: renderTemplate(ctx.settings.bodyTemplate.trim() || def.body, vars),
    to: rc.to ?? [], cc: rc.cc ?? [], ...(rc.replyTo ? { replyTo: rc.replyTo } : {}),
  };
}

async function deliver(deps: OrderDeps, order: OrderRow, reminder = false): Promise<void> {
  if (!deps.mailer) throw new Error("mail_unavailable");
  const m = await mailOf(deps.db, order, reminder);
  if (!m.to.length) throw new Error("no_recipient");
  const bytes = await pdfOf(deps, order);
  await deps.mailer.send({ to: m.to, cc: m.cc.length ? m.cc : undefined, replyTo: m.replyTo, subject: m.subject, text: m.text, attachments: [{ filename: orderFileName(order), content: bytes, contentType: "application/pdf" }] });
}

// ------------------------------------------------------------------ sending (claimed in the database: a restart or a second server never sends twice)

/** one attempt for an order that waits to be sent. Returns the new status. Three failed attempts = "send_failed" (the station chief sees it and can retry). */
export async function attemptSend(deps: OrderDeps, orderId: string): Promise<string> {
  const { db } = deps;
  const claimed = (await db.execute(sql`UPDATE part_orders SET attempts = attempts + 1, last_attempt_at = now(), updated_at = now()
    WHERE id = ${orderId} AND status = 'sending' AND attempts < ${MAX_ATTEMPTS} AND (last_attempt_at IS NULL OR last_attempt_at < now() - make_interval(mins => ${RETRY_AFTER_MIN}))
    RETURNING id`)) as unknown as { rows: { id: string }[] };
  if (!claimed.rows.length) return (await db.select({ s: partOrders.status }).from(partOrders).where(eq(partOrders.id, orderId)))[0]?.s ?? "unknown";
  const [order] = await db.select().from(partOrders).where(eq(partOrders.id, orderId));
  try {
    await deliver(deps, order);
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 300);
    const failed = order.attempts >= MAX_ATTEMPTS;
    await db.update(partOrders).set({ lastError: msg, status: failed ? "send_failed" : "sending", updatedAt: new Date() }).where(eq(partOrders.id, orderId));
    await event(db, order.vehicleId, null, failed ? "order_send_failed" : "order_send_retry", { orderId, number: order.number, error: msg, attempt: order.attempts });
    return failed ? "send_failed" : "sending";
  }
  await markSent(db, order);
  return "sent";
}

async function markSent(db: Db, order: OrderRow) {
  const now = new Date();
  await db.update(partOrders).set({ status: "sent", sentAt: now, lastError: null, updatedAt: now }).where(eq(partOrders.id, order.id));
  if (order.kind === "main" || order.kind === "complement") {
    // the parts of the order: "order sent" (automatic), with the wanted day as the expected one until the body shop announces its own
    await db.update(vehicleParts).set({ status: "order_sent", expectedAt: order.requestedDeliveryDate, updatedAt: now }).where(and(eq(vehicleParts.orderId, order.id), eq(vehicleParts.status, "to_order")));
  }
  await event(db, order.vehicleId, order.createdBy, "order_sent", { orderId: order.id, number: order.number, kind: order.kind, to: (order.recipients as { to?: string[] }).to ?? [] });
  await touch(db, order.vehicleId, null);
}

/** "Send" of a draft, "Retry" of a failed one: back to "sending", the worker (or this call) sends it */
export async function queueSend(deps: OrderDeps, orderId: string, userId: string | null): Promise<string> {
  const { db } = deps;
  const [o] = await db.select().from(partOrders).where(eq(partOrders.id, orderId));
  if (!o) throw new OrderError("order_not_found", 404);
  if (o.status !== "draft" && o.status !== "send_failed") throw new OrderError("order_not_sendable", 409);
  await db.update(partOrders).set({ status: "sending", attempts: 0, lastAttemptAt: null, lastError: null, updatedAt: new Date() }).where(eq(partOrders.id, orderId));
  await event(db, o.vehicleId, userId, "order_queued", { orderId, number: o.number });
  return attemptSend(deps, orderId);
}

/** "Resend": the SAME frozen PDF goes out again (no new order, no second set of parts) */
export async function resend(deps: OrderDeps, orderId: string, userId: string | null): Promise<void> {
  const { db } = deps;
  const [o] = await db.select().from(partOrders).where(eq(partOrders.id, orderId));
  if (!o) throw new OrderError("order_not_found", 404);
  if (!["sent", "confirmed", "delivered"].includes(o.status)) throw new OrderError("order_not_sendable", 409);
  try { await deliver(deps, o); } catch (e) { throw new OrderError("order_send_failed", 409); }
  await event(db, o.vehicleId, userId, "order_resent", { orderId, number: o.number });
}

// ------------------------------------------------------------------ main order trigger

/**
 * The main order starts when the insurer approval is recorded AND the repair appointment is booked (or when "send parts order now" is asked at the approval).
 * Automatic: it leaves at once; manual validation: a draft waits for a person. Parts copied from the old list are never sent by this trigger.
 */
export async function maybeCreateMainOrder(deps: OrderDeps, vehicleId: string, userId: string | null, o: { force?: boolean } = {}): Promise<OrderRow | null> {
  const { db } = deps;
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
  if (!row || row.deletedAt || !row.insurerApprovedAt) return null;
  const settings = await loadSettings(db, row.clientStationId);
  if (!settings || !settings.enabled || !settings.toEmails.length) return null;
  if (!o.force && !(await bookingDateOf(db, vehicleId))) return null;
  const [dup] = await db.select({ id: partOrders.id }).from(partOrders).where(and(eq(partOrders.vehicleId, vehicleId), eq(partOrders.kind, "main"), sql`${partOrders.status} <> 'cancelled'`));
  if (dup) return null;
  if (!(await eligibleParts(db, vehicleId, { onlyAutomatic: true })).length) return null;
  const order = await createOrder(deps, { vehicleId, kind: "main", userId, mode: settings.mode === "automatic" || o.force ? "send" : "draft", onlyAutomatic: true });
  if (order.status === "sending") await attemptSend(deps, order.id);
  return (await db.select().from(partOrders).where(eq(partOrders.id, order.id)))[0];
}

// ------------------------------------------------------------------ modification, cancellation, confirmation

async function childOrder(db: Db, parent: OrderRow, kind: "modification" | "cancellation", reason: string | null, userId: string | null, lines: { part: typeof vehicleParts.$inferSelect; qty: number }[]): Promise<OrderRow> {
  const lang = parent.lang as OrderLang;
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const number = await nextOrderNumber(t, parent.orgId);
    const [o] = await t.insert(partOrders).values({
      orgId: parent.orgId, number, vehicleId: parent.vehicleId, bodyShopId: parent.bodyShopId, kind, parentOrderId: parent.id, reason, status: "sending",
      requestedDeliveryDate: parent.requestedDeliveryDate, recipients: parent.recipients as never, lang, createdBy: userId,
    }).returning();
    let n = 1;
    for (const l of lines) await t.insert(partOrderLines).values({ orderId: o.id, vehiclePartId: l.part.id, n: n++, zone: await zoneNameIn(t, parent.orgId, l.part.zoneKey, lang), designation: l.part.name, oemRef: l.part.oemRef ?? "", qty: l.qty });
    return o;
  });
}

/** change a quantity / add parts to an order that was sent but not confirmed yet: a "Modificación" goes out */
export async function modifyOrder(deps: OrderDeps, orderId: string, userId: string | null, a: { qty?: Record<string, number>; addPartIds?: string[]; reason: string }): Promise<OrderRow> {
  const { db } = deps;
  const [p] = await db.select().from(partOrders).where(eq(partOrders.id, orderId));
  if (!p) throw new OrderError("order_not_found", 404);
  if ((p.kind !== "main" && p.kind !== "complement") || p.status !== "sent") throw new OrderError("order_not_modifiable", 409); // not confirmed yet (Ordered) and already sent
  if (!a.reason.trim()) throw new OrderError("order_reason_required");
  const lines = await db.select().from(partOrderLines).where(eq(partOrderLines.orderId, p.id));
  const changed: { part: typeof vehicleParts.$inferSelect; qty: number }[] = [];
  for (const [lineId, qty] of Object.entries(a.qty ?? {})) {
    const l = lines.find((x) => x.id === lineId);
    if (!l || qty === l.qty || qty < 1 || qty > 99) continue;
    const [part] = await db.select().from(vehicleParts).where(eq(vehicleParts.id, l.vehiclePartId));
    if (part && part.status === "order_sent") changed.push({ part, qty });
  }
  const added = a.addPartIds?.length ? await eligibleParts(db, p.vehicleId, { ids: a.addPartIds }) : [];
  if (!changed.length && !added.length) throw new OrderError("order_no_change", 409);
  const child = await childOrder(db, p, "modification", a.reason, userId, [...changed, ...added.map((part) => ({ part, qty: part.qty }))]);
  // the order itself follows: new quantities, added parts (they join this order and are "order sent" once the modification left)
  for (const c of changed) {
    await db.update(partOrderLines).set({ qty: c.qty }).where(and(eq(partOrderLines.orderId, p.id), eq(partOrderLines.vehiclePartId, c.part.id)));
    await db.update(vehicleParts).set({ qty: c.qty, updatedAt: new Date() }).where(eq(vehicleParts.id, c.part.id));
  }
  let n = lines.length + 1;
  for (const part of added) {
    await db.insert(partOrderLines).values({ orderId: p.id, vehiclePartId: part.id, n: n++, zone: await zoneNameIn(db, p.orgId, part.zoneKey, p.lang as PartLang), designation: part.name, oemRef: part.oemRef ?? "", qty: part.qty });
    await db.update(vehicleParts).set({ orderId: p.id, status: "order_sent", expectedAt: p.requestedDeliveryDate, updatedAt: new Date() }).where(eq(vehicleParts.id, part.id));
  }
  await event(db, p.vehicleId, userId, "order_modified", { orderId: p.id, number: p.number, modification: child.number, reason: a.reason });
  await touch(db, p.vehicleId, userId);
  await attemptSend(deps, child.id);
  return child;
}

/** cancel some lines (or the whole order) while it is not confirmed: an "Anulación" goes out, the parts are cancelled; the order itself is never deleted */
export async function cancelOrder(deps: OrderDeps, orderId: string, userId: string | null, a: { lineIds?: string[]; reason: string }): Promise<OrderRow | null> {
  const { db } = deps;
  const [p] = await db.select().from(partOrders).where(eq(partOrders.id, orderId));
  if (!p) throw new OrderError("order_not_found", 404);
  if (p.kind !== "main" && p.kind !== "complement") throw new OrderError("order_not_modifiable", 409);
  if (!a.reason.trim()) throw new OrderError("order_reason_required");
  const lines = await db.select().from(partOrderLines).where(eq(partOrderLines.orderId, p.id));
  const live = [];
  for (const l of lines) { const [part] = await db.select().from(vehicleParts).where(eq(vehicleParts.id, l.vehiclePartId)); if (part && !part.deletedAt && part.orderId === p.id) live.push({ l, part }); }
  const chosen = a.lineIds ? live.filter((x) => a.lineIds!.includes(x.l.id)) : live;
  if (!chosen.length) throw new OrderError("order_no_change", 409);
  if (p.status === "draft") {
    // never sent: no document goes out, the parts simply come back to "to order"
    await db.update(vehicleParts).set({ orderId: null, updatedAt: new Date() }).where(inArray(vehicleParts.id, chosen.map((x) => x.part.id)));
    if (chosen.length === live.length) await db.update(partOrders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(partOrders.id, p.id));
    await event(db, p.vehicleId, userId, "order_cancelled", { orderId: p.id, number: p.number, reason: a.reason, sent: false });
    await touch(db, p.vehicleId, userId);
    return null;
  }
  if (p.status !== "sent") throw new OrderError("order_not_modifiable", 409); // Confirmed (Ordered) can no longer be changed from here
  const child = await childOrder(db, p, "cancellation", a.reason, userId, chosen.map((x) => ({ part: x.part, qty: x.l.qty })));
  const now = new Date();
  await db.update(vehicleParts).set({ status: "cancelled", deletedAt: now, updatedAt: now }).where(inArray(vehicleParts.id, chosen.map((x) => x.part.id)));
  if (chosen.length === live.length) await db.update(partOrders).set({ status: "cancelled", updatedAt: now }).where(eq(partOrders.id, p.id));
  await event(db, p.vehicleId, userId, "order_cancelled", { orderId: p.id, number: p.number, cancellation: child.number, reason: a.reason, sent: true });
  await touch(db, p.vehicleId, userId);
  await attemptSend(deps, child.id);
  return child;
}

/** the body shop confirmed (entered by hand in v1): the order is "Confirmed", its parts "Ordered", with the announced delivery day */
export async function confirmOrder(deps: OrderDeps, orderId: string, userId: string | null, a: { announced?: string | null; note?: string }): Promise<OrderRow> {
  const { db } = deps;
  const [p] = await db.select().from(partOrders).where(eq(partOrders.id, orderId));
  if (!p) throw new OrderError("order_not_found", 404);
  if ((p.kind !== "main" && p.kind !== "complement") || p.status !== "sent") throw new OrderError("order_not_confirmable", 409);
  const now = new Date();
  const [o] = await db.update(partOrders).set({ status: "confirmed", confirmedAt: now, announcedDeliveryDate: a.announced ?? null, updatedAt: now }).where(eq(partOrders.id, p.id)).returning();
  await db.update(vehicleParts).set({ status: "ordered", ...(a.announced ? { expectedAt: a.announced } : {}), updatedAt: now }).where(and(eq(vehicleParts.orderId, p.id), eq(vehicleParts.status, "order_sent")));
  await event(db, p.vehicleId, userId, "order_confirmed", { orderId: p.id, number: p.number, announced: a.announced ?? null, note: a.note ?? null });
  await touch(db, p.vehicleId, userId);
  return o;
}

/** an order is "Delivered" once every part still in it arrived */
export async function refreshDelivered(db: Db, orderId: string | null): Promise<void> {
  if (!orderId) return;
  const [o] = await db.select().from(partOrders).where(eq(partOrders.id, orderId));
  if (!o || !["sent", "confirmed"].includes(o.status)) return;
  const ps = await db.select({ s: vehicleParts.status }).from(vehicleParts).where(and(eq(vehicleParts.orderId, orderId), isNull(vehicleParts.deletedAt)));
  if (ps.length && ps.every((p) => p.s === "delivered" || p.s === "installed")) await db.update(partOrders).set({ status: "delivered", updatedAt: new Date() }).where(eq(partOrders.id, orderId));
}

// ------------------------------------------------------------------ the queue (retries and reminders)

export async function runOrderQueue(deps: OrderDeps): Promise<{ sent: number; failed: number; reminded: number }> {
  const { db } = deps;
  let sent = 0, failed = 0, reminded = 0;
  const waiting = await db.select({ id: partOrders.id }).from(partOrders).where(and(eq(partOrders.status, "sending"), lt(partOrders.attempts, MAX_ATTEMPTS)));
  for (const w of waiting) { const s = await attemptSend(deps, w.id); if (s === "sent") sent++; else if (s === "send_failed") failed++; }
  // reminders: not confirmed after N days (setting of the body shop), once
  const sentOnes = await db.select().from(partOrders).where(and(eq(partOrders.status, "sent"), isNull(partOrders.reminderSentAt), sql`${partOrders.kind} in ('main','complement')`));
  for (const o of sentOnes) {
    const s = await loadSettings(db, o.bodyShopId);
    if (!s || s.reminderDays <= 0 || !o.sentAt || o.sentAt.getTime() > Date.now() - s.reminderDays * 86400_000) continue;
    const claimed = (await db.execute(sql`UPDATE part_orders SET reminder_sent_at = now() WHERE id = ${o.id} AND reminder_sent_at IS NULL AND status = 'sent' RETURNING id`)) as unknown as { rows: unknown[] };
    if (!claimed.rows.length) continue;
    try { await deliver(deps, o, true); await event(db, o.vehicleId, null, "order_reminder", { orderId: o.id, number: o.number }); reminded++; }
    catch (e) { await db.update(partOrders).set({ reminderSentAt: null }).where(eq(partOrders.id, o.id)); await event(db, o.vehicleId, null, "order_reminder_failed", { orderId: o.id, number: o.number, error: String((e as Error).message).slice(0, 200) }); }
  }
  return { sent, failed, reminded };
}
