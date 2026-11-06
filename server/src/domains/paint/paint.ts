// Paint (Repair v2, F4): one paint job per element to paint, planned at a partner body shop; for a car that must not be moved the customer brings it
// (appointment with a confirmation e-mail and a reminder the day before). Every rule is enforced HERE.
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { PANEL_MAP } from "@hagel/calc";
import type { ClientPaintJob, ErrorCode, Permission } from "@hagel/shared";
import { audit } from "../../audit";
import type { Db } from "../../db";
import type { Mailer } from "../../email";
import type { Env } from "../../env";
import { can, effectivePermissions, type Principal, type VehicleRef } from "../../permissions";
import { HttpError } from "../auth/auth";
import { paintJobs, repairEvents, roleAssignments, stations, users, vehicleAssignments, vehicleMoves, vehicles } from "../../schema";
import { Reject, nextSeq, refOf, type Tx, type VehicleRow } from "../vehicles/sync";
import { notifyPhones } from "../parts/orders";

type JobRow = typeof paintJobs.$inferSelect;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const todayMadrid = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
const tomorrowMadrid = () => { const d = new Date(todayMadrid() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ------------------------------------------------------------------ created from the estimate ("push to paint" = method ptp)

/** an element with the method "ptp" gets its paint job; another method (or removing the element) takes an unstarted job away again. Called inside the panel operation. */
export async function syncPaintJob(tx: Tx, row: VehicleRow, key: string, ptp: boolean, userId: string | null): Promise<void> {
  const [job] = await tx.select().from(paintJobs).where(and(eq(paintJobs.vehicleId, row.id), eq(paintJobs.elementKey, key), isNull(paintJobs.deletedAt)));
  if (ptp && !job) {
    await tx.insert(paintJobs).values({ orgId: row.orgId, vehicleId: row.id, elementKey: key, source: "ptp", createdBy: userId });
    await tx.insert(repairEvents).values({ vehicleId: row.id, userId, type: "paint_added", payload: { element: key, source: "ptp" } as never });
  } else if (!ptp && job && job.source === "ptp" && job.status === "to_paint") {
    await tx.update(paintJobs).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(paintJobs.id, job.id));
    await tx.insert(repairEvents).values({ vehicleId: row.id, userId, type: "paint_removed", payload: { element: key } as never });
  }
}

/** what a phone receives: the paint jobs of each car, for the users of the repair board and the paint managers */
export async function paintFor(db: Pick<Db, "select">, u: Principal, items: { row: VehicleRow; ref: VehicleRef }[]): Promise<Map<string, ClientPaintJob[]>> {
  const out = new Map<string, ClientPaintJob[]>();
  const eligible = items.filter(({ ref }) => { const p = effectivePermissions(u, ref); return p.has("reparatur.board") || p.has("peinture.gerer"); });
  if (!eligible.length) return out;
  const rows = await db.select().from(paintJobs).where(and(inArray(paintJobs.vehicleId, eligible.map((x) => x.row.id)), isNull(paintJobs.deletedAt))).orderBy(asc(paintJobs.createdAt));
  for (const { row } of eligible) out.set(row.id, []);
  for (const j of rows) out.get(j.vehicleId)?.push({
    id: j.id, elementKey: j.elementKey, status: j.status, source: j.source, partnerId: j.partnerStationId, plannedDate: j.plannedDate, plannedTime: j.plannedTime, customerAppointment: j.customerAppointment, doneAt: j.doneAt?.toISOString() ?? null,
  });
  return out;
}

// ------------------------------------------------------------------ customer e-mails

const MAIL = {
  es: {
    subject: (plate: string) => `Cita de pintura – ${plate}`, reminder: (plate: string) => `Recordatorio: cita de pintura mañana – ${plate}`,
    body: (p: { plate: string; model: string; partner: string; address: string; date: string; time: string }) => `Hola:\n\nLe confirmamos la cita para pintar su vehículo ${p.model} – ${p.plate}.\n\nTaller: ${p.partner}${p.address ? `\nDirección: ${p.address}` : ""}\nFecha: ${p.date}${p.time ? `\nHora: ${p.time}` : ""}\n\nSi no puede acudir, por favor responda a este correo.\n\nUn saludo,\nPDR Team España`,
    rbody: (p: { plate: string; model: string; partner: string; address: string; date: string; time: string }) => `Hola:\n\nLe recordamos que mañana tiene la cita para pintar su vehículo ${p.model} – ${p.plate}.\n\nTaller: ${p.partner}${p.address ? `\nDirección: ${p.address}` : ""}\nFecha: ${p.date}${p.time ? `\nHora: ${p.time}` : ""}\n\nUn saludo,\nPDR Team España`,
  },
  de: {
    subject: (plate: string) => `Lackiertermin – ${plate}`, reminder: (plate: string) => `Erinnerung: Lackiertermin morgen – ${plate}`,
    body: (p: { plate: string; model: string; partner: string; address: string; date: string; time: string }) => `Guten Tag,\n\nwir bestätigen den Termin zur Lackierung Ihres Fahrzeugs ${p.model} – ${p.plate}.\n\nCarrosserie: ${p.partner}${p.address ? `\nAdresse: ${p.address}` : ""}\nDatum: ${p.date}${p.time ? `\nUhrzeit: ${p.time}` : ""}\n\nWenn Sie nicht kommen können, antworten Sie bitte auf diese E-Mail.\n\nFreundliche Grüße\nPDR Team`,
    rbody: (p: { plate: string; model: string; partner: string; address: string; date: string; time: string }) => `Guten Tag,\n\nwir erinnern Sie an Ihren Lackiertermin morgen für Ihr Fahrzeug ${p.model} – ${p.plate}.\n\nCarrosserie: ${p.partner}${p.address ? `\nAdresse: ${p.address}` : ""}\nDatum: ${p.date}${p.time ? `\nUhrzeit: ${p.time}` : ""}\n\nFreundliche Grüße\nPDR Team`,
  },
};
const dmy = (s: string) => s.split("-").reverse().join("/");

async function customerMail(db: Db, mailer: Mailer | undefined, job: JobRow, reminder: boolean): Promise<void> {
  if (!mailer || !job.customerEmail || !job.plannedDate) throw new Error("mail_unavailable");
  const [v] = await db.select().from(vehicles).where(eq(vehicles.id, job.vehicleId));
  const [st] = job.partnerStationId ? await db.select().from(stations).where(eq(stations.id, job.partnerStationId)) : [];
  const h = (v?.header ?? {}) as Record<string, unknown>;
  const L = h.land === "ES" ? MAIL.es : MAIL.de;
  const p = { plate: String(h.kennzeichen ?? ""), model: String(h.modell ?? ""), partner: st?.name ?? "", address: st?.address ?? "", date: dmy(job.plannedDate), time: job.plannedTime ?? "" };
  await mailer.send({ to: job.customerEmail, subject: reminder ? L.reminder(p.plate) : L.subject(p.plate), text: reminder ? L.rbody(p) : L.body(p) });
}

/** the day before a customer appointment: one reminder (claimed in the database, so a restart never sends it twice) */
export async function runPaintReminders(deps: { db: Db; mailer?: Mailer }): Promise<{ reminded: number }> {
  const { db } = deps;
  let reminded = 0;
  const due = await db.select().from(paintJobs).where(and(eq(paintJobs.customerAppointment, true), eq(paintJobs.status, "scheduled"), eq(paintJobs.plannedDate, tomorrowMadrid()), isNull(paintJobs.reminderSentAt), isNull(paintJobs.deletedAt)));
  for (const j of due) {
    const claimed = (await db.execute(sql`UPDATE paint_jobs SET reminder_sent_at = now() WHERE id = ${j.id} AND reminder_sent_at IS NULL RETURNING id`)) as unknown as { rows: unknown[] };
    if (!claimed.rows.length) continue;
    try { await customerMail(db, deps.mailer, j, true); reminded++; await db.insert(repairEvents).values({ vehicleId: j.vehicleId, userId: null, type: "paint_reminder", payload: { element: j.elementKey } as never }); }
    catch { await db.update(paintJobs).set({ reminderSentAt: null }).where(eq(paintJobs.id, j.id)); }
  }
  return { reminded };
}

// ------------------------------------------------------------------ routes

interface Deps { db: Db; mailer?: Mailer; needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env>; validationHook: (r: { success: boolean }, c: Context) => Response | undefined }

export function paintRoutes({ db, mailer, needAuth, needOrg, validationHook }: Deps) {
  const r = new Hono<Env>();
  const org = (c: Context<Env>) => c.get("orgId");
  const fail = (code: ErrorCode, status: 400 | 403 | 404 | 409 = 400): never => { throw new HttpError(status, code); };

  const loadVehicle = async (c: Context<Env>, vehicleId: string) => {
    const [row] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.orgId, org(c))));
    if (!row || row.deletedAt) throw new HttpError(404, "vehicle_not_found");
    const as = (await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, row.id))).map((a) => a.userId);
    const u = c.get("principal"), ref = refOf(row, as);
    if (!can(u, "vehicules.voir", ref)) throw new HttpError(404, "vehicle_not_found");
    if (!can(u, "peinture.gerer" as Permission, ref)) throw new HttpError(403, "forbidden");
    return { row, u, ref };
  };
  const jobOf = async (c: Context<Env>) => {
    const [j] = await db.select().from(paintJobs).where(and(eq(paintJobs.id, c.req.param("id") ?? ""), eq(paintJobs.orgId, org(c)), isNull(paintJobs.deletedAt)));
    if (!j) throw new HttpError(404, "paint_not_found");
    return { j, ...(await loadVehicle(c, j.vehicleId)) };
  };
  const partnerOf = async (c: Context<Env>, id: string) => {
    const [s] = await db.select().from(stations).where(and(eq(stations.id, id), eq(stations.orgId, org(c)), eq(stations.type, "carrosserie"), eq(stations.active, true), eq(stations.paintPartner, true)));
    if (!s) return fail("paint_partner_invalid", 400);
    return s;
  };
  const touch = async (vehicleId: string, orgId: string, userId: string) => {
    const seq = await nextSeq(db as never);
    await db.update(vehicles).set({ seq, updatedBy: userId, updatedAt: new Date() }).where(eq(vehicles.id, vehicleId));
    notifyPhones(orgId, seq);
  };
  const ev = (vehicleId: string, userId: string, type: string, payload: Record<string, unknown>) => db.insert(repairEvents).values({ vehicleId, userId, type, payload: payload as never });
  const dateOk = (d: string) => d >= todayMadrid();
  const json = async (id: string) => { const [j] = await db.select().from(paintJobs).where(eq(paintJobs.id, id)); return { id: j.id, status: j.status }; };

  /** an element added by hand (e.g. a part that is not a "push to paint" in the estimate) */
  r.post("/vehicles/:id/paint", needAuth, needOrg, zValidator("json", z.object({ elementKey: z.string().trim().min(1).max(40) }), validationHook), async (c) => {
    const { row, u } = await loadVehicle(c, c.req.param("id") ?? "");
    const key = c.req.valid("json").elementKey;
    if (!PANEL_MAP[key]) return fail("paint_element_invalid");
    const [dup] = await db.select().from(paintJobs).where(and(eq(paintJobs.vehicleId, row.id), eq(paintJobs.elementKey, key), isNull(paintJobs.deletedAt)));
    if (dup) return c.json(await json(dup.id));
    const [j] = await db.insert(paintJobs).values({ orgId: row.orgId, vehicleId: row.id, elementKey: key, source: "manual", createdBy: u.id }).returning();
    await ev(row.id, u.id, "paint_added", { element: key, source: "manual" });
    await touch(row.id, row.orgId, u.id);
    return c.json(await json(j.id), 201);
  });

  /** D26: schedule the painting at a partner body shop (the car is taken there). Not for a car that must not be moved: that is a customer appointment. */
  r.post("/paint/:id/schedule", needAuth, needOrg, zValidator("json", z.object({ partnerId: z.string().uuid(), date: ymd, time: hhmm.optional() }), validationHook), async (c) => {
    const { j, row, u } = await jobOf(c);
    const b = c.req.valid("json");
    if (j.status === "at_body_shop" || j.status === "done") return fail("paint_status_invalid", 409);
    if (row.noMove) return fail("move_forbidden", 409);
    await partnerOf(c, b.partnerId);
    if (!dateOk(b.date)) return fail("paint_date_invalid");
    await db.update(paintJobs).set({ status: "scheduled", partnerStationId: b.partnerId, plannedDate: b.date, plannedTime: b.time ?? null, customerAppointment: false, customerEmail: null, customerPhone: null, updatedAt: new Date() }).where(eq(paintJobs.id, j.id));
    await ev(row.id, u.id, "paint_scheduled", { element: j.elementKey, partner: b.partnerId, date: b.date });
    await touch(row.id, row.orgId, u.id);
    return c.json(await json(j.id));
  });

  /** D25: appointment with the customer (the car is not allowed to move): partner body shop, day, time, his e-mail; confirmation now, reminder the day before */
  r.post("/paint/:id/customer-appointment", needAuth, needOrg, zValidator("json", z.object({ partnerId: z.string().uuid(), date: ymd, time: hhmm, email: z.string().trim().toLowerCase().max(254), phone: z.string().trim().max(40).optional() }), validationHook), async (c) => {
    const { j, row, u } = await jobOf(c);
    const b = c.req.valid("json");
    if (j.status === "at_body_shop" || j.status === "done") return fail("paint_status_invalid", 409);
    await partnerOf(c, b.partnerId);
    if (!dateOk(b.date) || !EMAIL_RE.test(b.email)) return fail(!EMAIL_RE.test(b.email) ? "invalid_input" : "paint_date_invalid");
    const [upd] = await db.update(paintJobs).set({ status: "scheduled", partnerStationId: b.partnerId, plannedDate: b.date, plannedTime: b.time, customerAppointment: true, customerEmail: b.email, customerPhone: b.phone ?? null, confirmationSentAt: null, reminderSentAt: null, updatedAt: new Date() }).where(eq(paintJobs.id, j.id)).returning();
    let mailed = true;
    try { await customerMail(db, mailer, upd, false); await db.update(paintJobs).set({ confirmationSentAt: new Date() }).where(eq(paintJobs.id, j.id)); } catch { mailed = false; }
    await ev(row.id, u.id, "paint_customer_appointment", { element: j.elementKey, partner: b.partnerId, date: b.date, time: b.time, mailed });
    await touch(row.id, row.orgId, u.id);
    return c.json({ ...(await json(j.id)), mailed });
  });

  /** status steps: at the body shop (an internal move needs the driver of the departure station and is refused for a car that must not move), done, back to "to paint" */
  r.post("/paint/:id/status", needAuth, needOrg, zValidator("json", z.object({ status: z.enum(["to_paint", "at_body_shop", "done"]), driverUserId: z.string().uuid().optional() }), validationHook), async (c) => {
    const { j, row, u } = await jobOf(c);
    const { status, driverUserId } = c.req.valid("json");
    if (status === "to_paint") {
      if (j.status === "done") return fail("paint_status_invalid", 409);
      await db.update(paintJobs).set({ status: "to_paint", partnerStationId: null, plannedDate: null, plannedTime: null, customerAppointment: false, customerEmail: null, customerPhone: null, confirmationSentAt: null, reminderSentAt: null, updatedAt: new Date() }).where(eq(paintJobs.id, j.id));
    } else if (status === "at_body_shop") {
      if (j.status !== "scheduled" || !j.partnerStationId) return fail("paint_status_invalid", 409);
      let driver: string | null = null;
      if (!j.customerAppointment) {
        if (row.noMove) return fail("move_forbidden", 409);
        if (!driverUserId) return fail("driver_required", 400);
        const [ok] = row.stationId ? await db.select({ id: roleAssignments.id }).from(roleAssignments).innerJoin(users, eq(users.id, roleAssignments.userId))
          .where(and(eq(roleAssignments.userId, driverUserId), eq(roleAssignments.orgId, row.orgId), eq(roleAssignments.stationId, row.stationId), eq(users.status, "active"), sql`(${roleAssignments.expiresAt} is null or ${roleAssignments.expiresAt} > now())`)).limit(1) : [];
        if (!ok) return fail("driver_invalid", 400);
        driver = driverUserId;
        // the car leaves for the painter: a move in the history with the driver; the car's own station does not change (the body shop is not a place)
        await db.insert(vehicleMoves).values({ vehicleId: row.id, fromStationId: row.stationId, toStationId: j.partnerStationId, userId: u.id, driverUserId: driver, note: "paint" });
      }
      await db.update(paintJobs).set({ status: "at_body_shop", driverUserId: driver, updatedAt: new Date() }).where(eq(paintJobs.id, j.id));
    } else {
      if (j.status !== "at_body_shop" && !(j.status === "scheduled" && j.customerAppointment)) return fail("paint_status_invalid", 409);
      await db.update(paintJobs).set({ status: "done", doneAt: new Date(), doneBy: u.id, updatedAt: new Date() }).where(eq(paintJobs.id, j.id));
    }
    await ev(row.id, u.id, `paint_${status}`, { element: j.elementKey, ...(driverUserId && status === "at_body_shop" ? { driver: driverUserId } : {}) });
    if (status === "done") {
      // every element of the car painted: the paint step of the repair is complete (a suggestion for the board, no automatic stage change)
      const open = await db.select({ id: paintJobs.id }).from(paintJobs).where(and(eq(paintJobs.vehicleId, row.id), isNull(paintJobs.deletedAt), sql`${paintJobs.status} <> 'done'`));
      if (!open.length) await ev(row.id, u.id, "paint_all_done", {});
    }
    await touch(row.id, row.orgId, u.id);
    return c.json(await json(j.id));
  });

  /** a job that was added by hand (or whose element is no longer a "push to paint") and has not started can be removed: never deleted for good */
  r.delete("/paint/:id", needAuth, needOrg, async (c) => {
    const { j, row, u } = await jobOf(c);
    if (j.status !== "to_paint" && j.status !== "scheduled") return fail("paint_status_invalid", 409);
    await db.update(paintJobs).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(paintJobs.id, j.id));
    await ev(row.id, u.id, "paint_removed", { element: j.elementKey });
    await audit(db, { orgId: row.orgId, userId: u.id, action: "delete", entity: "paint_job", entityId: j.id, before: { element: j.elementKey, status: j.status } });
    await touch(row.id, row.orgId, u.id);
    return c.json({ ok: true });
  });

  void Reject;
  return r;
}
