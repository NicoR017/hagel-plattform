// Read endpoints of the repair flow: the booking calendar of a station and the merged history ("Verlauf") of a vehicle.
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { HttpError } from "./auth";
import type { Db } from "./db";
import type { Env } from "./env";
import type { Mailer } from "./email";
import type { Storage } from "./storage";
import { sendRepairReport } from "./repair_report";
import { canOrg, effectivePermissions } from "./permissions";
import { repairBookings, repairEvents, reportSends, stations, users, vehicleAssignments, vehicleMoves, vehicleStatusHistory, vehicles } from "./schema";
import { refOf } from "./sync";

interface Deps { db: Db; storage: Storage; mailer: Mailer; needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env> }

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function repairRoutes({ db, storage, mailer, needAuth, needOrg }: Deps) {
  const r = new Hono<Env>();

  /**
   * Booking calendar of a station for the picker: per day the number of booked places (booked + started); the capacity is constant per station.
   * The bookings of a day (plate, time) are only listed for users who may book. Weekends / past days are decided by the client from the date.
   */
  r.get("/stations/:id/booking-calendar", needAuth, needOrg, zValidator("query", z.object({ from: ymd, to: ymd })), async (c) => {
    const { from, to } = c.req.valid("query"), u = c.get("principal"), orgId = c.get("orgId");
    if (to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 400) throw new HttpError(400, "invalid_input");
    const [st] = await db.select().from(stations).where(and(eq(stations.id, c.req.param("id") ?? ""), eq(stations.orgId, orgId)));
    if (!st) throw new HttpError(404, "station_not_found");
    const mayBook = canOrg(u, "termine.buchen", orgId, st.id), mayBoard = canOrg(u, "reparatur.board", orgId, st.id);
    if (!mayBook && !mayBoard) throw new HttpError(403, "forbidden");
    const rows = await db.select({ b: repairBookings, plate: vehicles.header }).from(repairBookings).innerJoin(vehicles, eq(vehicles.id, repairBookings.vehicleId))
      .where(and(eq(repairBookings.stationId, st.id), inArray(repairBookings.status, ["booked", "started"])));
    const days: Record<string, { booked: number; bookings?: { id: string; vehicleId: string; plate: string; time: string; status: string }[] }> = {};
    for (const { b, plate } of rows.filter((x) => x.b.date >= from && x.b.date <= to)) {
      const d = (days[b.date] ??= { booked: 0, ...(mayBook ? { bookings: [] } : {}) });
      d.booked++;
      d.bookings?.push({ id: b.id, vehicleId: b.vehicleId, plate: String((plate as Record<string, unknown>).kennzeichen ?? ""), time: b.time, status: b.status });
    }
    for (const d of Object.values(days)) d.bookings?.sort((a, b) => a.time.localeCompare(b.time));
    return c.json({ stationId: st.id, repairsPerDay: st.repairsPerDay, country: st.country, from, to, days });
  });

  /**
   * Send the repair report again (the station manager, e.g. after a provider outage or a corrected recipient list). Only for a finished vehicle.
   * Recipients are computed by the server as for the automatic send; the answer says what happened.
   */
  r.post("/vehicles/:id/repair-report", needAuth, needOrg, async (c) => {
    const u = c.get("principal"), orgId = c.get("orgId");
    const [v] = await db.select().from(vehicles).where(and(eq(vehicles.id, c.req.param("id") ?? ""), eq(vehicles.orgId, orgId)));
    if (!v || v.deletedAt) throw new HttpError(404, "vehicle_not_found");
    const as = await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, v.id));
    const perms = effectivePermissions(u, refOf(v, as.map((a) => a.userId)));
    if (!perms.has("vehicules.voir")) throw new HttpError(404, "vehicle_not_found");
    if (!perms.has("reparatur.endabnahme") && !perms.has("rapport_reparation.envoyer")) throw new HttpError(403, "forbidden");
    if (v.statut !== "fertig" && v.statut !== "rendu") throw new HttpError(409, "not_allowed");
    const res = await sendRepairReport({ db, storage, mailer }, v.id, u.id);
    return c.json(res, res.status === "failed" ? 502 : 200);
  });

  /** Verlauf: status changes, moves, e-mails sent and repair events of one vehicle, newest first. */
  r.get("/vehicles/:id/verlauf", needAuth, needOrg, async (c) => {
    const u = c.get("principal"), orgId = c.get("orgId");
    const [v] = await db.select().from(vehicles).where(and(eq(vehicles.id, c.req.param("id") ?? ""), eq(vehicles.orgId, orgId)));
    if (!v || v.deletedAt) throw new HttpError(404, "vehicle_not_found");
    const as = await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, v.id));
    const perms = effectivePermissions(u, refOf(v, as.map((a) => a.userId)));
    if (!perms.has("vehicules.voir")) throw new HttpError(404, "vehicle_not_found");
    const [hist, moves, sends, events] = await Promise.all([
      db.select().from(vehicleStatusHistory).where(eq(vehicleStatusHistory.vehicleId, v.id)).orderBy(desc(vehicleStatusHistory.at)),
      db.select().from(vehicleMoves).where(eq(vehicleMoves.vehicleId, v.id)).orderBy(desc(vehicleMoves.at)),
      perms.has("kva.envoyer") || perms.has("rapport_reparation.envoyer") ? db.select().from(reportSends).where(eq(reportSends.vehicleId, v.id)).orderBy(desc(reportSends.createdAt)) : Promise.resolve([]),
      perms.has("reparatur.board") ? db.select().from(repairEvents).where(eq(repairEvents.vehicleId, v.id)).orderBy(desc(repairEvents.at)) : Promise.resolve([]),
    ]);
    const uids = [...new Set([...hist.map((x) => x.userId), ...moves.map((x) => x.userId), ...sends.map((x) => x.sentBy), ...events.map((x) => x.userId)].filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (uids.length) for (const x of await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, uids))) names.set(x.id, x.name || x.email);
    const sts = await db.select({ id: stations.id, name: stations.name }).from(stations).where(eq(stations.orgId, orgId));
    const stName = new Map(sts.map((s) => [s.id, s.name]));
    const who = (id: string | null) => (id ? names.get(id) ?? "" : "System");
    const out = [
      ...hist.map((x) => ({ at: x.at.toISOString(), kind: "status", who: who(x.userId), data: { statut: x.statut, motif: x.motif } })),
      ...moves.map((x) => ({ at: x.at.toISOString(), kind: "move", who: who(x.userId), data: { from: stName.get(x.fromStationId ?? "") ?? null, to: stName.get(x.toStationId ?? "") ?? null, note: x.note } })),
      ...sends.map((x) => ({ at: (x.sentAt ?? x.createdAt).toISOString(), kind: "send", who: who(x.sentBy), data: { type: x.type, status: x.status, recipients: x.recipients } })),
      ...events.map((x) => ({ at: x.at.toISOString(), kind: "repair", who: who(x.userId), data: { type: x.type, ...(x.payload as object) } })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    return c.json(out);
  });

  return r;
}

