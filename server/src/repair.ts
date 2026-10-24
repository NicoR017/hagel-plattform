// UI v3 repair flow on the server: board stages, to-dos, checks, comments, technician planning, repair calendar (bookings) and the
// daily job that moves due bookings into "Bereit". Every rule is enforced HERE, not only in the UI.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { computeVehicle, type CalcVehicle } from "@hagel/calc";
import { NEXT_AFTER_STEP, ROLE_REPAIR_STEPS, type ClientRepair, type Op, type RoleRepairStep } from "@hagel/shared";
import { audit } from "./audit";
import type { Db } from "./db";
import type { Mailer } from "./email";
import { bookingMail } from "./mails";
import { effectivePermissions, fieldProfile, roleRepairSteps, type Principal, type VehicleRef } from "./permissions";
import { loadMethodMap, methodOf } from "./methods";
import { autoRepairReport } from "./repair_report";
import type { Storage } from "./storage";
import { recipientsForStation } from "./reports";
import {
  photos, repairAppointments, repairBookings, repairChecks, repairEvents, repairTodos, reportSends, stations, technicians, users, vehicleAssignments,
  vehicleComments, vehicleMoves, vehicleStatusHistory, vehicles,
} from "./schema";
import { Reject, calcSettings, flatten, loadOrgSettings, lockVehicle, need, nextSeq, type OpOutcome, type Tx, type VehicleRow } from "./sync";

/** stages that need at least one photo before the vehicle may reach "Finish" */
const PHOTO_STAGES = ["demontage", "pdr", "remontage"] as const;
const BOOKABLE = ["arrive", "besichtigung", "attente"] as const;

// ------------------------------------------------------------------ technician / headliner rules

/** the ONLY moves of the field profile: a technician takes a car from Disassembly into PDR; a headliner also from Reassembly to At body shop (never Finish) */
export const FIELD_MOVES: Record<"pdr" | "headliner", readonly (readonly [string, string])[]> = {
  pdr: [["demontage", "pdr"]],
  headliner: [["demontage", "pdr"], ["remontage", "bodyshop"]],
};

/**
 * The moves of a field profile. When his role(s) list repair steps (v5), each step lets him take the car out of that step into the next one
 * (Disassembly -> PDR, PDR -> Reassembly, Reassembly -> At body shop); without steps the rule of his technician record applies (FIELD_MOVES).
 */
export function fieldMovesOf(u: Principal, orgId: string, kind: "pdr" | "headliner"): [string, string][] {
  const steps = roleRepairSteps(u, orgId).filter((s): s is RoleRepairStep => (ROLE_REPAIR_STEPS as readonly string[]).includes(s));
  return steps.length ? ROLE_REPAIR_STEPS.filter((s) => steps.includes(s)).map((s) => [s, NEXT_AFTER_STEP[s]] as [string, string]) : FIELD_MOVES[kind].map(([a, b]) => [a, b] as [string, string]);
}

/** is this car his: assigned to his account for his kind of work (PDR / removal-refit), or his name in the split */
async function isHisCar(tx: Tx, row: VehicleRow, u: Principal, fp: { name: string; kind: "pdr" | "headliner" }, from?: string): Promise<boolean> {
  // by role steps: the PDR step is PDR work, disassembly / reassembly are removal-refit work; otherwise by the kind of his record
  const roleSteps = roleRepairSteps(u, row.orgId).length > 0;
  const removal = roleSteps && from ? from !== "pdr" : fp.kind === "headliner";
  const [a] = await tx.select().from(vehicleAssignments).where(and(eq(vehicleAssignments.vehicleId, row.id), eq(vehicleAssignments.userId, u.id), eq(vehicleAssignments.type, removal ? "demontage" : "pdr")));
  if (a) return true;
  const sh = (row.shares ?? {}) as Record<string, unknown>;
  const me = fp.name.trim().toLowerCase();
  return String(removal ? sh.demTechName ?? "" : sh.techName ?? "").trim().toLowerCase() === me;
}

/** The technician / headliner moves HIS car, from one of his steps to the next one, after taking a photo of that step himself. */
async function checkFieldMove(tx: Tx, row: VehicleRow, u: Principal, fp: { name: string; kind: "pdr" | "headliner" }, from: string, to: string) {
  if (!fieldMovesOf(u, row.orgId, fp.kind).some(([a, b]) => a === from && b === to)) throw new Reject("move_not_allowed");
  if (!(await isHisCar(tx, row, u, fp, from))) throw new Reject("not_your_vehicle");
  const mine = await tx.select({ id: photos.id }).from(photos).where(and(eq(photos.vehicleId, row.id), isNull(photos.deletedAt), eq(photos.repairStage, from), eq(photos.takenBy, u.id))).limit(1);
  if (!mine.length) throw new Reject("photo_required");
}

// ------------------------------------------------------------------ dates (station time zone)

export const tzOfCountry = (country: string) => (country === "ES" ? "Europe/Madrid" : "Europe/Berlin");
/** YYYY-MM-DD of `now` in a time zone */
export const todayIn = (tz: string, now = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const weekday = (ymd: string) => new Date(ymd + "T12:00:00Z").getUTCDay(); // 0 = Sunday
/** a working day inside the booking range: today .. 31 December of next year, no weekend */
export function bookableDay(ymd: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || Number.isNaN(Date.parse(ymd))) return false;
  const last = `${Number(today.slice(0, 4)) + 1}-12-31`;
  const dow = weekday(ymd);
  return ymd >= today && ymd <= last && dow !== 0 && dow !== 6;
}

// ------------------------------------------------------------------ helpers

async function event(tx: Tx, vehicleId: string, userId: string | null, type: string, payload: Record<string, unknown> = {}) {
  await tx.insert(repairEvents).values({ vehicleId, userId, type, payload: payload as never });
}

/** The vehicle changed in a way the phones must pull (todos, checks, comments… travel inside the vehicle): new change number. */
async function touchVehicle(tx: Tx, u: Principal | null, row: VehicleRow, set: Partial<typeof vehicles.$inferInsert> = {}): Promise<OpOutcome> {
  const seq = await nextSeq(tx);
  await tx.update(vehicles).set({ ...set, seq, ...(u ? { updatedBy: u.id } : {}), updatedAt: new Date() }).where(eq(vehicles.id, row.id));
  return { status: "ok", orgId: row.orgId, seq, vehicleId: row.id };
}

/** "Zu ersetzende Teile" of the expertise become to-dos when the vehicle enters the board (once per label). */
export async function partsToTodos(tx: Tx, row: VehicleRow, userId: string | null) {
  const parts = ((row.header as Record<string, unknown>).partsToReplace as unknown[] | undefined)?.filter((x): x is string => typeof x === "string" && !!x.trim()) ?? [];
  if (!parts.length) return;
  const have = await tx.select().from(repairTodos).where(and(eq(repairTodos.vehicleId, row.id), eq(repairTodos.source, "part")));
  const haveText = new Set(have.map((t) => t.text));
  let sort = have.length;
  for (const p of parts) {
    const text = p.trim();
    if (haveText.has(text)) continue;
    await tx.insert(repairTodos).values({ id: crypto.randomUUID(), vehicleId: row.id, text, source: "part", createdBy: userId, sort: sort++ });
    haveText.add(text);
  }
}

/** Why "Finish" is refused right now (empty = allowed). */
export async function finishBlockers(db: Pick<Db, "select">, vehicleId: string): Promise<string[]> {
  const out: string[] = [];
  const todos = await db.select().from(repairTodos).where(and(eq(repairTodos.vehicleId, vehicleId), isNull(repairTodos.deletedAt), isNull(repairTodos.doneAt)));
  if (todos.length) out.push("todos_open");
  const checks = await db.select().from(repairChecks).where(eq(repairChecks.vehicleId, vehicleId));
  for (const k of ["pdr", "teile", "chef"]) if (!checks.some((c) => c.key === k && c.doneAt)) out.push(`check:${k}`);
  const ph = await db.select({ stage: photos.repairStage }).from(photos).where(and(eq(photos.vehicleId, vehicleId), isNull(photos.deletedAt)));
  for (const s of PHOTO_STAGES) if (!ph.some((p) => p.stage === s)) out.push(`photos:${s}`);
  const [tech] = await db.select().from(vehicleAssignments).where(and(eq(vehicleAssignments.vehicleId, vehicleId), eq(vehicleAssignments.type, "pdr"))).limit(1);
  // somebody works on it: an assigned PDR technician, or a technician named in the split (a technician without an account cannot be assigned)
  const [veh] = await db.select({ shares: vehicles.shares }).from(vehicles).where(eq(vehicles.id, vehicleId));
  const named = String(((veh?.shares ?? {}) as Record<string, unknown>).techName ?? "").trim();
  if (!tech && !named) out.push("no_technician");
  return out;
}

async function bookedCount(tx: Tx, stationId: string, date: string, exceptId?: string): Promise<number> {
  const rows = await tx.select({ id: repairBookings.id }).from(repairBookings)
    .where(and(eq(repairBookings.stationId, stationId), eq(repairBookings.date, date), inArray(repairBookings.status, ["booked", "started"])));
  return rows.filter((r) => r.id !== exceptId).length;
}

/** The appointment day is here: the vehicle enters the board in "Bereit". */
async function startBooking(tx: Tx, booking: typeof repairBookings.$inferSelect, row: VehicleRow, byUser: string | null, why: string) {
  const now = new Date();
  await tx.update(repairBookings).set({ status: "started", startedAt: now }).where(eq(repairBookings.id, booking.id));
  const stamps: Record<string, number> = { ...(row.groupAt as Record<string, number>), status: Date.now(), repairStage: Date.now() };
  const set: Partial<typeof vehicles.$inferInsert> = {};
  // the repair takes place in another station than the assessment: the car goes there now (a move, like any other, in the history)
  if (booking.stationId !== row.stationId) {
    await tx.insert(vehicleMoves).values({ vehicleId: row.id, fromStationId: row.stationId, toStationId: booking.stationId, userId: byUser, note: "repair_appointment" });
    set.stationId = booking.stationId; stamps.site = Date.now();
    await event(tx, row.id, byUser, "booking_moved_car", { from: row.stationId, to: booking.stationId });
  }
  await tx.insert(vehicleStatusHistory).values({ vehicleId: row.id, statut: "reparatur", userId: byUser });
  await partsToTodos(tx, row, byUser);
  await event(tx, row.id, byUser, "booking_started", { bookingId: booking.id, date: booking.date, why });
  return touchVehicle(tx, null, row, { ...set, statut: "reparatur", statutMotif: null, statutAvant: null, statutDepuis: now, repAt: row.repAt ?? now, repairStage: "bereit", repairEnteredAt: now, groupAt: stamps });
}

async function cancelBooking(tx: Tx, booking: typeof repairBookings.$inferSelect, byUser: string | null, reason: string) {
  await tx.update(repairBookings).set({ status: "cancelled", cancelledBy: byUser, cancelledAt: new Date(), cancelReason: reason }).where(eq(repairBookings.id, booking.id));
  await event(tx, booking.vehicleId, byUser, "booking_cancelled", { bookingId: booking.id, date: booking.date, reason });
}

// ------------------------------------------------------------------ confirmation e-mails (after commit)

interface MailCtx { db: Db; mailer: Mailer | undefined }
/** Customer + carrosserie (the station's own list; never the automatic insurer addresses). Logged in report_sends (type "termin"). */
export async function sendBookingMail(c: MailCtx, kind: "created" | "moved" | "cancelled", bookingId: string, sentBy: string | null) {
  if (!c.mailer) return;
  const [b] = await c.db.select().from(repairBookings).where(eq(repairBookings.id, bookingId));
  if (!b) return;
  const [v] = await c.db.select().from(vehicles).where(eq(vehicles.id, b.vehicleId));
  const [st] = await c.db.select().from(stations).where(eq(stations.id, b.stationId));
  if (!v || !st) return;
  const h = v.header as Record<string, unknown>;
  const lang = st.country === "ES" ? "es" : "de";
  const mail = bookingMail(lang, kind, { date: b.date, time: b.time, station: st.name, address: st.address, plate: String(h.kennzeichen ?? ""), model: String(h.modell ?? ""), claim: String(h.claimNumber ?? "") });
  const carro = (await recipientsForStation(c.db, st, v.clientStationId, "termin"));
  const recipients = [...new Set([b.customerEmail.trim().toLowerCase(), ...carro])];
  let status = "sent", error: string | null = null;
  try { await c.mailer.send({ to: recipients, subject: mail.subject, text: mail.text }); }
  catch (e) { status = "failed"; error = (e as Error).message.slice(0, 300); }
  await c.db.insert(reportSends).values({ id: crypto.randomUUID(), orgId: b.orgId, vehicleId: b.vehicleId, type: "termin", lang, recipients, status, error, sentBy, sentAt: new Date() });
}

// ------------------------------------------------------------------ ops

type RepairOp = Extract<Op, { type: "vehicle.repairStage" | "vehicle.bodyshop" | "photo.stage" | "repair.todo.add" | "repair.todo.toggle" | "repair.todo.delete" | "repair.check" | "vehicle.comment" | "appointment.add" | "appointment.update" | "appointment.delete" | "booking.create" | "booking.move" | "booking.cancel" }>;
export const isRepairOp = (op: Op): op is RepairOp =>
  /^(repair\.|appointment\.|booking\.)/.test(op.type) || op.type === "vehicle.repairStage" || op.type === "vehicle.bodyshop" || op.type === "photo.stage" || op.type === "vehicle.comment";

export async function applyRepairOp(deps: { db: Db; mailer?: Mailer; storage?: Storage }, tx: Tx, u: Principal, op: RepairOp, at: number): Promise<OpOutcome> {
  const db = tx as unknown as Db;
  switch (op.type) {
    case "vehicle.repairStage": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "reparatur.board", ref);
      const fp = fieldProfile(u, row.orgId);
      const inFlow = row.statut === "reparatur" || row.statut === "fertig" || (row.statut === "attente" && row.repairStage != null);
      const stamps = { ...(row.groupAt as Record<string, number>) };
      if ((stamps.repairStage ?? 0) > at) return { status: "conflict", orgId: row.orgId, seq: row.seq, vehicleId: row.id };
      stamps.repairStage = at;
      const now = new Date();
      if (!inFlow) {
        if (fp) throw new Reject("move_not_allowed"); // the field profile never puts a car into repair
        // "+ Fahrzeug in Reparatur": only assessed vehicles, straight into "Bereit"
        if (op.stage !== "bereit") throw new Reject("vehicle_not_in_repair");
        need(u, "vehicules.changer_statut", ref);
        if (row.statut !== "besichtigung" && row.statut !== "attente") throw new Reject("not_assessed");
        const settings = await loadOrgSettings(tx, row.orgId), methods = await loadMethodMap(tx, row.orgId);
        const c = computeVehicle(flatten(row, [], null) as unknown as CalcVehicle, calcSettings(settings), methodOf(methods, row));
        if (!(c.netto > 0)) throw new Reject("not_assessed");
        await tx.insert(vehicleStatusHistory).values({ vehicleId: row.id, statut: "reparatur", userId: u.id });
        await partsToTodos(tx, row, u.id);
        await event(tx, row.id, u.id, "entered_repair", { from: row.statut });
        return touchVehicle(tx, u, row, { statut: "reparatur", statutMotif: null, statutAvant: null, statutDepuis: now, repAt: row.repAt ?? now, repairStage: "bereit", repairEnteredAt: now, groupAt: { ...stamps, status: at } });
      }
      const from = row.repairStage ?? "bereit";
      if (op.stage === from && !(op.stage !== "finish" && row.statut === "fertig")) return { status: "ok", orgId: row.orgId, seq: row.seq, vehicleId: row.id };
      if (fp) await checkFieldMove(tx, row, u, fp, from, op.stage);
      const set: Partial<typeof vehicles.$inferInsert> = { repairStage: op.stage, groupAt: stamps };
      if (op.stage === "finish") {
        const blockers = await finishBlockers(tx, row.id);
        if (blockers.length) throw new Reject("finish_blocked", { reasons: blockers.join(", ") });
        Object.assign(set, { statut: "fertig", statutMotif: null, statutAvant: null, statutDepuis: now, groupAt: { ...stamps, status: at } });
        await tx.insert(vehicleStatusHistory).values({ vehicleId: row.id, statut: "fertig", userId: u.id });
        await event(tx, row.id, u.id, "finish", { from });
      } else {
        if (row.statut === "fertig") {
          Object.assign(set, { statut: "reparatur", statutDepuis: now, groupAt: { ...stamps, status: at } });
          await tx.insert(vehicleStatusHistory).values({ vehicleId: row.id, statut: "reparatur", userId: u.id });
        }
        await event(tx, row.id, u.id, "stage", { from, to: op.stage });
      }
      await audit(db, { orgId: row.orgId, userId: u.id, action: op.type, entity: "vehicle", entityId: row.id, before: { stage: from }, after: { stage: op.stage } });
      const out = await touchVehicle(tx, u, row, set);
      // "Finish": the repair report goes out by itself (once per vehicle), after the change is saved; a failure never undoes the Finish
      if (op.stage === "finish" && deps.mailer && deps.storage) { const rd = { db: deps.db, storage: deps.storage, mailer: deps.mailer }; return { ...out, after: () => autoRepairReport(rd, row.id) }; }
      return out;
    }

    /** Which body shop has the car ("At Bodyshop"): a carrosserie site of the same organisation and Colibri tenant as the car's site. null = not set. */
    case "vehicle.bodyshop": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "reparatur.board", ref);
      if (fieldProfile(u, row.orgId)) throw new Reject("not_allowed"); // not a technician's choice
      if (row.repairStage == null) throw new Reject("vehicle_not_in_repair");
      const stamps = { ...(row.groupAt as Record<string, number>) };
      if ((stamps.bodyshopId ?? 0) > at) return { status: "conflict", orgId: row.orgId, seq: row.seq, vehicleId: row.id };
      stamps.bodyshopId = at;
      let name: string | null = null;
      if (op.bodyshopId) {
        const [b] = await tx.select().from(stations).where(and(eq(stations.id, op.bodyshopId), eq(stations.orgId, row.orgId)));
        const [own] = row.stationId ? await tx.select().from(stations).where(eq(stations.id, row.stationId)) : [];
        if (!b || b.type !== "carrosserie" || !b.active) throw new Reject("bodyshop_invalid");
        // same Colibri tenant (a site without a tenant is not restricted)
        if (b.azureTenant && own?.azureTenant && b.azureTenant !== own.azureTenant) throw new Reject("bodyshop_invalid");
        name = b.name;
      }
      if (row.bodyshopId === op.bodyshopId) return { status: "ok", orgId: row.orgId, seq: row.seq, vehicleId: row.id };
      await event(tx, row.id, u.id, "bodyshop", { from: row.bodyshopId, to: op.bodyshopId, name });
      await audit(db, { orgId: row.orgId, userId: u.id, action: op.type, entity: "vehicle", entityId: row.id, before: { bodyshopId: row.bodyshopId }, after: { bodyshopId: op.bodyshopId } });
      return touchVehicle(tx, u, row, { bodyshopId: op.bodyshopId, groupAt: stamps });
    }

    case "photo.stage": {
      const [ph] = await tx.select().from(photos).where(eq(photos.id, op.photoId)).for("update");
      if (!ph || ph.deletedAt) throw new Reject("photo_not_found");
      const { row, ref } = await lockVehicle(tx, u, ph.vehicleId).catch(() => { throw new Reject("photo_not_found"); });
      need(u, "photos.ajouter", ref);
      const seq = await nextSeq(tx);
      await tx.update(photos).set({ repairStage: op.repairStage, role: op.role, seq }).where(eq(photos.id, ph.id));
      return { status: "ok", orgId: row.orgId, seq };
    }

    case "repair.todo.add": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "reparatur.board", ref);
      const [ex] = await tx.select().from(repairTodos).where(eq(repairTodos.id, op.todo.id));
      if (ex) { if (ex.vehicleId !== row.id) throw new Reject("not_allowed"); return { status: "ok", orgId: row.orgId, seq: row.seq, vehicleId: row.id }; }
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(repairTodos).where(eq(repairTodos.vehicleId, row.id));
      await tx.insert(repairTodos).values({ id: op.todo.id, vehicleId: row.id, text: op.todo.text, source: "manual", createdBy: u.id, sort: n });
      await event(tx, row.id, u.id, "todo_add", { text: op.todo.text });
      return touchVehicle(tx, u, row);
    }

    case "repair.todo.toggle":
    case "repair.todo.delete": {
      const [t] = await tx.select().from(repairTodos).where(eq(repairTodos.id, op.todoId)).for("update");
      if (!t || t.deletedAt) throw new Reject("todo_not_found");
      const { row, ref } = await lockVehicle(tx, u, t.vehicleId).catch(() => { throw new Reject("todo_not_found"); });
      need(u, "reparatur.board", ref);
      if (op.type === "repair.todo.delete") {
        await tx.update(repairTodos).set({ deletedAt: new Date() }).where(eq(repairTodos.id, t.id));
        await event(tx, row.id, u.id, "todo_delete", { text: t.text });
      } else {
        const done = op.done;
        await tx.update(repairTodos).set(done ? { doneBy: u.id, doneAt: new Date() } : { doneBy: null, doneAt: null }).where(eq(repairTodos.id, t.id));
        await event(tx, row.id, u.id, done ? "todo_done" : "todo_reopen", { text: t.text, source: t.source });
      }
      return touchVehicle(tx, u, row);
    }

    case "repair.check": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "reparatur.board", ref);
      if (op.key === "chef") need(u, "reparatur.endabnahme", ref); // Endabnahme: only the station manager
      await tx.insert(repairChecks).values({ vehicleId: row.id, key: op.key, doneBy: op.done ? u.id : null, doneAt: op.done ? new Date() : null })
        .onConflictDoUpdate({ target: [repairChecks.vehicleId, repairChecks.key], set: { doneBy: op.done ? u.id : null, doneAt: op.done ? new Date() : null } });
      await event(tx, row.id, u.id, op.done ? "check_done" : "check_reopen", { key: op.key });
      return touchVehicle(tx, u, row);
    }

    case "vehicle.comment": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "kommentare.schreiben", ref);
      const text = op.comment.text.trim();
      if (!text) throw new Reject("comment_empty");
      const [ex] = await tx.select().from(vehicleComments).where(eq(vehicleComments.id, op.comment.id));
      if (ex) { if (ex.vehicleId !== row.id) throw new Reject("not_allowed"); return { status: "ok", orgId: row.orgId, seq: row.seq, vehicleId: row.id }; }
      await tx.insert(vehicleComments).values({ id: op.comment.id, vehicleId: row.id, userId: u.id, text });
      return touchVehicle(tx, u, row);
    }

    case "appointment.add": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "vehicules.assigner", ref);
      const a = op.appointment;
      const [tech] = await tx.select().from(technicians).where(and(eq(technicians.id, a.technicianId), eq(technicians.orgId, row.orgId)));
      if (!tech) throw new Reject("technician_not_found");
      const [ex] = await tx.select().from(repairAppointments).where(eq(repairAppointments.id, a.id));
      if (ex) { if (ex.vehicleId !== row.id) throw new Reject("not_allowed"); return { status: "ok", orgId: row.orgId, seq: row.seq, vehicleId: row.id }; }
      await tx.insert(repairAppointments).values({ id: a.id, vehicleId: row.id, technicianId: a.technicianId, date: a.date, durationMin: a.durationMin, note: a.note, createdBy: u.id });
      return touchVehicle(tx, u, row);
    }
    case "appointment.update":
    case "appointment.delete": {
      const [ap] = await tx.select().from(repairAppointments).where(eq(repairAppointments.id, op.appointmentId)).for("update");
      if (!ap || ap.deletedAt) throw new Reject("appointment_not_found");
      const { row, ref } = await lockVehicle(tx, u, ap.vehicleId).catch(() => { throw new Reject("appointment_not_found"); });
      need(u, "vehicules.assigner", ref);
      if (op.type === "appointment.delete") await tx.update(repairAppointments).set({ deletedAt: new Date() }).where(eq(repairAppointments.id, ap.id));
      else {
        const f = op.fields;
        if (f.technicianId) {
          const [tech] = await tx.select().from(technicians).where(and(eq(technicians.id, f.technicianId), eq(technicians.orgId, row.orgId)));
          if (!tech) throw new Reject("technician_not_found");
        }
        const set: Partial<typeof repairAppointments.$inferInsert> = {};
        if (f.technicianId) set.technicianId = f.technicianId;
        if (f.date) set.date = f.date;
        if (f.durationMin) set.durationMin = f.durationMin;
        if (f.note !== undefined) set.note = f.note;
        if (Object.keys(set).length) await tx.update(repairAppointments).set(set).where(eq(repairAppointments.id, ap.id));
      }
      return touchVehicle(tx, u, row);
    }

    case "booking.create": {
      const { row, ref } = await lockVehicle(tx, u, op.vehicleId);
      need(u, "termine.buchen", ref);
      const b = op.booking;
      const [ex] = await tx.select().from(repairBookings).where(eq(repairBookings.id, b.id));
      if (ex) { if (ex.vehicleId !== row.id) throw new Reject("not_allowed"); return { status: "ok", orgId: row.orgId, seq: row.seq, vehicleId: row.id }; }
      if (!(BOOKABLE as readonly string[]).includes(row.statut) || row.repairStage != null || !row.stationId) throw new Reject("booking_status");
      // where the repair takes place: the station of the assessment, or another PDR hall / body shop of the organisation
      const placeId = b.stationId ?? row.stationId;
      const [open] = await tx.select().from(repairBookings).where(and(eq(repairBookings.vehicleId, row.id), eq(repairBookings.status, "booked")));
      if (open) throw new Reject("booking_exists");
      const [st] = await tx.select().from(stations).where(and(eq(stations.id, placeId), eq(stations.orgId, row.orgId))).for("update"); // serialises two assessors booking the same day
      if (!st || !st.active || (placeId !== row.stationId && st.type === "parc")) throw new Reject("station_unknown");
      if (st.type === "carrosserie") throw new Reject("station_not_a_place");
      const today = todayIn(tzOfCountry(st.country));
      if (!bookableDay(b.date, today)) throw new Reject("booking_date_invalid");
      if ((await bookedCount(tx, st.id, b.date)) >= st.repairsPerDay) throw new Reject("booking_full");
      const [created] = await tx.insert(repairBookings).values({ id: b.id, orgId: row.orgId, stationId: st.id, originStationId: row.stationId, vehicleId: row.id, date: b.date, time: b.time, customerPhone: b.phone, customerEmail: b.email.toLowerCase(), createdBy: u.id }).returning();
      await event(tx, row.id, u.id, "booking_created", { bookingId: b.id, date: b.date, time: b.time, stationId: st.id });
      await audit(db, { orgId: row.orgId, userId: u.id, action: op.type, entity: "booking", entityId: b.id, after: { date: b.date, time: b.time, vehicleId: row.id } });
      const out = b.date === today ? await startBooking(tx, created, row, u.id, "booked_for_today") : await touchVehicle(tx, u, row);
      return { ...out, after: () => sendBookingMail({ db: deps.db, mailer: deps.mailer }, "created", b.id, u.id) };
    }

    case "booking.move":
    case "booking.cancel": {
      const [bk] = await tx.select().from(repairBookings).where(eq(repairBookings.id, op.bookingId)).for("update");
      if (!bk) throw new Reject("booking_not_found");
      const { row, ref } = await lockVehicle(tx, u, bk.vehicleId).catch(() => { throw new Reject("booking_not_found"); });
      need(u, "termine.buchen", ref);
      if (bk.status !== "booked") throw new Reject("booking_not_found");
      if (op.type === "booking.cancel") {
        await cancelBooking(tx, bk, u.id, "cancelled_by_user");
        return { ...(await touchVehicle(tx, u, row)), after: () => sendBookingMail({ db: deps.db, mailer: deps.mailer }, "cancelled", bk.id, u.id) };
      }
      const [st] = await tx.select().from(stations).where(eq(stations.id, bk.stationId)).for("update");
      const today = todayIn(tzOfCountry(st.country));
      if (!bookableDay(op.date, today)) throw new Reject("booking_date_invalid");
      if (op.date !== bk.date && (await bookedCount(tx, st.id, op.date, bk.id)) >= st.repairsPerDay) throw new Reject("booking_full");
      const [moved] = await tx.update(repairBookings).set({ date: op.date, time: op.time }).where(eq(repairBookings.id, bk.id)).returning();
      await event(tx, row.id, u.id, "booking_moved", { bookingId: bk.id, from: bk.date, to: op.date, time: op.time });
      const out = op.date === today ? await startBooking(tx, moved, row, u.id, "moved_to_today") : await touchVehicle(tx, u, row);
      return { ...out, after: () => sendBookingMail({ db: deps.db, mailer: deps.mailer }, "moved", bk.id, u.id) };
    }
  }
}

// ------------------------------------------------------------------ the daily job

/**
 * Moves every due booking (date reached in the station's time zone) into "Bereit". Idempotent: a booking is handled once; a vehicle that is
 * meanwhile in repair / returned / deleted / on another station is left alone and the booking is cancelled with the reason in the log.
 * Run at boot (catch-up after a downtime) and every few minutes by the worker.
 */
export async function runDueBookings(db: Db, now = new Date(), notify?: (orgId: string, seq: number) => void): Promise<{ started: number; cancelled: number }> {
  const open = await db.select({ b: repairBookings, country: stations.country }).from(repairBookings).innerJoin(stations, eq(stations.id, repairBookings.stationId)).where(eq(repairBookings.status, "booked"));
  const due = open.filter((x) => x.b.date <= todayIn(tzOfCountry(x.country), now));
  let started = 0, cancelled = 0;
  for (const { b } of due.sort((x, y) => x.b.date.localeCompare(y.b.date))) {
    const res = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(7001)`);
      const [cur] = await tx.select().from(repairBookings).where(eq(repairBookings.id, b.id)).for("update");
      if (!cur || cur.status !== "booked") return null;
      const [row] = await tx.select().from(vehicles).where(eq(vehicles.id, cur.vehicleId)).for("update");
      const ok = row && !row.deletedAt && (row.stationId === cur.stationId || row.stationId === (cur.originStationId ?? cur.stationId)) && (BOOKABLE as readonly string[]).includes(row.statut) && row.repairStage == null;
      if (!ok) {
        await cancelBooking(tx, cur, null, row ? (row.deletedAt ? "vehicle_deleted" : !(row.stationId === cur.stationId || row.stationId === (cur.originStationId ?? cur.stationId)) ? "vehicle_moved" : `vehicle_status_${row.statut}`) : "vehicle_missing");
        return { kind: "cancelled" as const, out: null };
      }
      return { kind: "started" as const, out: await startBooking(tx, cur, row, null, "appointment_day") };
    });
    if (!res) continue;
    if (res.kind === "started") { started++; if (res.out) notify?.(res.out.orgId, res.out.seq); } else cancelled++;
  }
  return { started, cancelled };
}

// ------------------------------------------------------------------ what a phone receives

/** Repair data of a set of vehicles, filtered by what each user may see (comments and bookings are internal / personal data). */
export async function repairDataFor(db: Pick<Db, "select">, u: Principal, items: { row: VehicleRow; ref: VehicleRef }[]): Promise<Map<string, ClientRepair>> {
  const out = new Map<string, ClientRepair>();
  const eligible = items.filter(({ ref }) => { const p = effectivePermissions(u, ref); return p.has("reparatur.board") || p.has("kommentare.schreiben") || p.has("termine.buchen"); });
  if (!eligible.length) return out;
  const ids = eligible.map((x) => x.row.id);
  const [todos, checks, comments, appts, bookings, started, reports] = await Promise.all([
    db.select().from(repairTodos).where(and(inArray(repairTodos.vehicleId, ids), isNull(repairTodos.deletedAt))).orderBy(asc(repairTodos.sort), asc(repairTodos.createdAt)),
    db.select().from(repairChecks).where(inArray(repairChecks.vehicleId, ids)),
    db.select().from(vehicleComments).where(and(inArray(vehicleComments.vehicleId, ids), isNull(vehicleComments.deletedAt))).orderBy(asc(vehicleComments.at)),
    db.select().from(repairAppointments).where(and(inArray(repairAppointments.vehicleId, ids), isNull(repairAppointments.deletedAt))).orderBy(asc(repairAppointments.date)),
    db.select().from(repairBookings).where(and(inArray(repairBookings.vehicleId, ids), eq(repairBookings.status, "booked"))),
    db.select().from(repairBookings).where(and(inArray(repairBookings.vehicleId, ids), eq(repairBookings.status, "started"))).orderBy(asc(repairBookings.date)),
    db.select().from(reportSends).where(and(inArray(reportSends.vehicleId, ids), eq(reportSends.type, "reparation"))).orderBy(asc(reportSends.createdAt)),
  ]);
  const uids = [...new Set([...todos.flatMap((t) => [t.doneBy, t.createdBy]), ...checks.map((c) => c.doneBy), ...comments.map((c) => c.userId), ...bookings.map((b) => b.createdBy)].filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (uids.length) for (const r of await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, uids))) names.set(r.id, r.name || r.email);
  for (const { row, ref } of eligible) {
    const p = effectivePermissions(u, ref);
    const board = p.has("reparatur.board");
    const blockers = board && (row.repairStage != null) ? await finishBlockers(db, row.id) : [];
    const bk = p.has("termine.buchen") ? bookings.find((b) => b.vehicleId === row.id) : undefined;
    out.set(row.id, {
      todos: board ? todos.filter((t) => t.vehicleId === row.id).map((t) => ({
        id: t.id, text: t.text, source: t.source as "manual" | "part", done: !!t.doneAt, doneBy: t.doneBy ? names.get(t.doneBy) ?? null : null,
        doneAt: t.doneAt?.toISOString() ?? null, createdBy: t.createdBy ? names.get(t.createdBy) ?? null : null, createdAt: t.createdAt.toISOString(), sort: t.sort,
      })) : [],
      checks: board ? Object.fromEntries(["pdr", "teile", "chef"].map((k) => { const c = checks.find((x) => x.vehicleId === row.id && x.key === k); return [k, c?.doneAt ? { by: c.doneBy ? names.get(c.doneBy) ?? null : null, at: c.doneAt.toISOString() } : null]; })) : {},
      finishBlockers: blockers,
      comments: p.has("kommentare.schreiben") ? comments.filter((c) => c.vehicleId === row.id).map((c) => ({ id: c.id, userId: c.userId, userName: c.userId ? names.get(c.userId) ?? "" : "", at: c.at.toISOString(), text: c.text })) : [],
      appointments: board ? appts.filter((a) => a.vehicleId === row.id).map((a) => ({ id: a.id, technicianId: a.technicianId, date: a.date, durationMin: a.durationMin, note: a.note })) : [],
      autoStartedOn: board ? ([...started].reverse().find((s) => s.vehicleId === row.id)?.date ?? null) : null,
      lastReport: board ? (() => { const r = [...reports].reverse().find((x) => x.vehicleId === row.id); return r ? { status: r.status, at: (r.sentAt ?? r.createdAt).toISOString(), auto: r.sentBy == null } : null; })() : null,
      booking: bk ? { id: bk.id, stationId: bk.stationId, date: bk.date, time: bk.time, status: bk.status, phone: bk.customerPhone, email: bk.customerEmail, createdBy: bk.createdBy ? names.get(bk.createdBy) ?? null : null, createdAt: bk.createdAt.toISOString() } : null,
    });
  }
  return out;
}

