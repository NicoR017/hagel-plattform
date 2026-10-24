import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { generateHandoverReceipt, type DocVehicle, type HandoverDoc } from "@hagel/documents";
import { HttpError } from "./auth";
import type { Db } from "./db";
import type { Env } from "./env";
import type { Mailer } from "./email";
import { handoverMail } from "./mails";
import { can, fieldProfile, type Principal } from "./permissions";
import { letterheadOf } from "./repair_report";
import { insurers, stations, users, vehicleAssignments, vehicleHandovers, vehicles } from "./schema";
import type { Storage } from "./storage";
import { flatten, refOf } from "./sync";

type HandoverRow = typeof vehicleHandovers.$inferSelect;
type VehicleRow = typeof vehicles.$inferSelect;

/** Customer data (name, e-mail, signature) is for the staff of the station, never for technician / headliner profiles and never for the external accounts. */
export function mayReadHandover(u: Principal, row: VehicleRow, assigneeIds: string[]): boolean {
  const ref = refOf(row, assigneeIds);
  return can(u, "vehicules.voir", ref) && can(u, "vehicules.creer", ref) && !fieldProfile(u, row.orgId);
}
export function maySignHandover(u: Principal, row: VehicleRow, assigneeIds: string[]): boolean {
  return can(u, "vehicules.changer_statut", refOf(row, assigneeIds)) && !fieldProfile(u, row.orgId);
}

const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The receipt PDF of one signature (language of the vehicle's country, letterhead of the vehicle). */
export async function buildHandoverReceipt(deps: { db: Db; storage: Storage }, h: HandoverRow): Promise<{ bytes: Uint8Array; filename: string; lang: "de" | "es" }> {
  const { db, storage } = deps;
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, h.vehicleId));
  if (!row) throw new HttpError(404, "vehicle_not_found");
  const flat = flatten(row, [], null) as Record<string, unknown>;
  const land: "DE" | "ES" = flat.land === "ES" ? "ES" : "DE";
  const [st] = h.stationId ? await db.select().from(stations).where(eq(stations.id, h.stationId)) : [];
  const [client] = row.clientStationId ? await db.select().from(stations).where(eq(stations.id, row.clientStationId)) : [];
  const [ins] = row.insurerId ? await db.select().from(insurers).where(eq(insurers.id, row.insurerId)) : [];
  const [by] = h.signedBy ? await db.select().from(users).where(eq(users.id, h.signedBy)) : [];
  const doc = { ...flat, id: row.id, land, status: row.statut, stationName: st?.name ?? "", insurerName: ins?.name ?? "", kunde: client?.name ?? String(flat.kunde ?? "") } as unknown as DocVehicle;
  const hd: HandoverDoc = {
    kind: h.kind as HandoverDoc["kind"], customerName: h.customerName, customerEmail: h.customerEmail, remarks: h.remarks, signedAt: h.signedAt.toISOString(),
    receivedBy: by?.name || by?.email || "", stationName: st?.name ?? "", stationAddress: st?.address ?? "", strokes: h.signature as HandoverDoc["strokes"],
  };
  const bytes = await generateHandoverReceipt(doc, hd, { letterhead: await letterheadOf(db, storage, row), timeZone: land === "ES" ? "Europe/Madrid" : "Europe/Berlin" });
  const plate = fileSafe(String(flat.kennzeichen ?? "")) || "vehicle";
  const word = land === "ES" ? (h.kind === "drop_off" ? "Recepcion" : "Devolucion") : (h.kind === "drop_off" ? "Annahme" : "Rueckgabe");
  return { bytes, filename: `${land === "ES" ? "Comprobante" : "Uebergabe"}_${word}_${plate}.pdf`, lang: land === "ES" ? "es" : "de" };
}

/** Store the receipt with the vehicle's documents and e-mail it to the customer when asked. Never throws: a failure is shown on the signature (and can be sent again). */
export async function finishHandover(deps: { db: Db; storage: Storage; mailer?: Mailer }, handoverId: string): Promise<void> {
  const { db, storage } = deps;
  const [h] = await db.select().from(vehicleHandovers).where(eq(vehicleHandovers.id, handoverId));
  if (!h) return;
  try {
    const pdf = await buildHandoverReceipt(deps, h);
    const key = `handover/${(await db.select({ o: vehicles.orgId }).from(vehicles).where(eq(vehicles.id, h.vehicleId)))[0]?.o}/${h.vehicleId}/${h.id}.pdf`;
    await storage.put(key, pdf.bytes, "application/pdf");
    await db.update(vehicleHandovers).set({ receiptPdfKey: key }).where(eq(vehicleHandovers.id, h.id));
  } catch (e) {
    await db.update(vehicleHandovers).set({ mailStatus: h.sendReceipt ? "failed" : null, mailError: h.sendReceipt ? String((e as Error).message).slice(0, 300) : null }).where(eq(vehicleHandovers.id, h.id));
    return;
  }
  if (h.sendReceipt && h.customerEmail) await sendHandoverMail(deps, h.id);
}

/** (Re)send the signed receipt by e-mail to the customer. Result and error are kept on the row. */
export async function sendHandoverMail(deps: { db: Db; storage: Storage; mailer?: Mailer }, handoverId: string, email?: string): Promise<{ status: "sent" | "failed"; error?: string }> {
  const { db } = deps;
  const [h0] = await db.select().from(vehicleHandovers).where(eq(vehicleHandovers.id, handoverId));
  if (!h0) throw new HttpError(404, "handover_not_found");
  if (email) await db.update(vehicleHandovers).set({ customerEmail: email }).where(eq(vehicleHandovers.id, h0.id));
  const [h] = await db.select().from(vehicleHandovers).where(eq(vehicleHandovers.id, handoverId));
  const fail = async (error: string) => {
    await db.update(vehicleHandovers).set({ mailStatus: "failed", mailError: error.slice(0, 300) }).where(eq(vehicleHandovers.id, h.id));
    return { status: "failed" as const, error };
  };
  if (!h.customerEmail) return fail("no_email");
  if (!deps.mailer) return fail("mail_unavailable");
  try {
    const pdf = await buildHandoverReceipt(deps, h);
    const [row] = await db.select().from(vehicles).where(eq(vehicles.id, h.vehicleId));
    const flat = flatten(row, [], null) as Record<string, string>;
    const [st] = h.stationId ? await db.select().from(stations).where(eq(stations.id, h.stationId)) : [];
    const [me] = h.signedBy ? await db.select().from(users).where(eq(users.id, h.signedBy)) : [];
    const mail = handoverMail(pdf.lang, h.kind as "drop_off" | "pick_up", { plate: flat.kennzeichen ?? "", model: flat.modell ?? "", stationName: st?.name ?? "", customerName: h.customerName, senderName: me?.name ?? "" });
    await deps.mailer.send({ to: h.customerEmail, subject: mail.subject, text: mail.text, replyTo: me?.email, attachments: [{ filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" }] });
  } catch (e) { return fail(String((e as Error).message)); }
  await db.update(vehicleHandovers).set({ mailStatus: "sent", mailError: null, mailedAt: new Date() }).where(eq(vehicleHandovers.id, h.id));
  return { status: "sent" };
}

// ------------------------------------------------------------------ routes

interface Deps { db: Db; storage: Storage; mailer?: Mailer; needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env>; validationHook: (r: { success: boolean }, c: Context) => Response | undefined }

export function handoverRoutes({ db, storage, mailer, needAuth, needOrg, validationHook }: Deps) {
  const r = new Hono<Env>();
  const load = async (c: Context<Env>, vehicleId: string) => {
    const [row] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.orgId, c.get("orgId"))));
    if (!row || row.deletedAt) throw new HttpError(404, "vehicle_not_found");
    const as = (await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, row.id))).map((a) => a.userId);
    return { row, as };
  };
  /** the signatures of one vehicle (staff only: customer data) */
  r.get("/vehicles/:id/handovers", needAuth, needOrg, async (c) => {
    const { row, as } = await load(c, c.req.param("id") ?? "");
    if (!mayReadHandover(c.get("principal"), row, as)) throw new HttpError(404, "vehicle_not_found"); // for the others the data does not exist
    const rows = await db.select().from(vehicleHandovers).where(eq(vehicleHandovers.vehicleId, row.id)).orderBy(asc(vehicleHandovers.signedAt));
    const ids = [...new Set(rows.map((x) => x.signedBy).filter((x): x is string => !!x))];
    const people = ids.length ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids)) : [];
    const sts = new Map((await db.select().from(stations).where(eq(stations.orgId, row.orgId))).map((s) => [s.id, s.name]));
    return c.json(rows.map((x) => ({
      id: x.id, kind: x.kind, customerName: x.customerName, customerEmail: x.customerEmail, remarks: x.remarks, signedAt: x.signedAt, receivedAt: x.receivedAt,
      signedBy: people.find((p) => p.id === x.signedBy)?.name || people.find((p) => p.id === x.signedBy)?.email || "", station: x.stationId ? sts.get(x.stationId) ?? "" : "",
      signature: x.signature, sendReceipt: x.sendReceipt, mailStatus: x.mailStatus, mailError: x.mailError, mailedAt: x.mailedAt, replaced: !!x.replacedBy, hasReceipt: !!x.receiptPdfKey,
    })));
  });

  const handoverOf = async (c: Context<Env>) => {
    const [h] = await db.select().from(vehicleHandovers).where(eq(vehicleHandovers.id, c.req.param("id") ?? ""));
    if (!h) throw new HttpError(404, "handover_not_found");
    const { row, as } = await load(c, h.vehicleId);
    return { h, row, as };
  };
  /** the signed receipt as PDF (built again when the stored copy is missing) */
  r.get("/handovers/:id/receipt", needAuth, needOrg, async (c) => {
    const { h, row, as } = await handoverOf(c);
    if (!mayReadHandover(c.get("principal"), row, as)) throw new HttpError(404, "handover_not_found");
    const stored = h.receiptPdfKey ? await storage.get(h.receiptPdfKey) : null;
    const pdf = await buildHandoverReceipt({ db, storage }, h);
    const bytes = stored?.bytes ?? pdf.bytes;
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${pdf.filename}"`, "cache-control": "private, no-store" } });
  });
  /** "Send again": the receipt goes to the customer's e-mail (optionally corrected) */
  r.post("/handovers/:id/send", needAuth, needOrg, zValidator("json", z.object({ email: z.string().trim().email().max(254).optional() }), validationHook), async (c) => {
    const { h, row, as } = await handoverOf(c);
    const u = c.get("principal");
    if (!mayReadHandover(u, row, as) || !maySignHandover(u, row, as)) throw new HttpError(404, "handover_not_found");
    return c.json(await sendHandoverMail({ db, storage, mailer }, h.id, c.req.valid("json").email));
  });
  return r;
}
