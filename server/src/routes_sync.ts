import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { KNOWN_OP_TYPES, errorMessage, ocrInput, pickLang, pushInput, type PushResponse } from "@hagel/shared";
import { HttpError } from "./auth";
import type { Db } from "./db";
import type { Env } from "./env";
import type { Hub } from "./hub";
import { recognise, type FetchLike } from "./ocr";
import { can, type Principal } from "./permissions";
import { photos, reportSends, users, vehicleAssignments, vehicles } from "./schema";
import type { Mailer } from "./email";
import { reportMail } from "./mails";
import { recipientsOfVehicle } from "./reports";
import { audit } from "./audit";
import type { Storage } from "./storage";
import { colibriKey, nextSeq, photoKey, photoToClient, processPull, processPush, refOf } from "./sync";

interface Deps {
  db: Db; hub: Hub; storage: Storage; mailer: Mailer;
  needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env>;
  ocr?: { apiKey: string | null; model: string; fetch: FetchLike };
  validationHook: (r: { success: boolean }, c: Context) => Response | undefined;
}

const MAX_PHOTO = 4 * 1024 * 1024;
const MAX_PDF = 15 * 1024 * 1024;

export function syncRoutes({ db, hub, storage, mailer, needAuth, needOrg, ocr, validationHook }: Deps) {
  const r = new Hono<Env>();

  r.post("/sync/push", needAuth, async (c) => {
    const raw = (await c.req.json().catch(() => null)) as { ops?: unknown } | null;
    // an op type this version does not know (client newer than server): refuse the batch BEFORE applying anything, the client keeps it queued
    const unknown = Array.isArray(raw?.ops) ? (raw!.ops as { type?: unknown }[]).find((o) => typeof o?.type === "string" && !KNOWN_OP_TYPES.includes(o.type)) : undefined;
    if (unknown) return c.json({ error: errorMessage("unsupported_op", pickLang(c.req.header("x-lang"), c.req.header("accept-language"))), code: "unsupported_op", opType: unknown.type }, 409);
    const parsed = pushInput.safeParse(raw);
    if (!parsed.success) return validationHook({ success: false }, c) as Response;
    const { results, touched } = await processPush({ db, hub, storage, mailer }, c.get("principal"), parsed.data.ops);
    for (const [orgId, seq] of touched) hub.publish(orgId, seq);
    return c.json({ results } satisfies PushResponse);
  });

  r.get("/sync/pull", needAuth, needOrg, zValidator("query", z.object({
    since: z.coerce.number().int().min(0).default(0), epoch: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(500).default(150),
  }), validationHook), async (c) => {
    const q = c.req.valid("query");
    return c.json(await processPull(db, c.get("principal"), c.get("orgId"), q.since, q.epoch ?? null, q.limit));
  });

  /** Server-Sent Events: "something changed, pull now". The client keeps this open while online (fetch + Authorization header). */
  r.get("/sync/events", needAuth, needOrg, (c) =>
    streamSSE(c, async (stream) => {
      let wake: (() => void) | null = null;
      let pending = false;
      const off = hub.subscribe(c.get("orgId"), () => { pending = true; wake?.(); });
      stream.onAbort(() => { off(); wake?.(); });
      await stream.writeSSE({ event: "hello", data: "ok" });
      while (!stream.aborted && !stream.closed) {
        if (!pending) await new Promise<void>((res) => { wake = res; setTimeout(res, 25_000); });
        wake = null;
        if (stream.aborted || stream.closed) break;
        if (pending) { pending = false; await stream.writeSSE({ event: "changed", data: String(Date.now()) }); }
        else await stream.writeSSE({ event: "ping", data: "1" });
      }
      off();
    }),
  );

  // ---- files (private; served only through authenticated routes) ----
  const loadPhoto = async (u: Principal, id: string, perm: "vehicules.voir" | "photos.ajouter") => {
    const [p] = await db.select().from(photos).where(eq(photos.id, id));
    if (!p || p.deletedAt) throw new HttpError(404, "photo_not_found");
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, p.vehicleId));
    if (!v || v.deletedAt) throw new HttpError(404, "photo_not_found");
    const as = await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, v.id));
    const ref = refOf(v, as.map((a) => a.userId));
    if (!can(u, "vehicules.voir", ref)) throw new HttpError(404, "photo_not_found");
    if (perm !== "vehicules.voir" && !can(u, perm, ref)) throw new HttpError(403, "forbidden");
    return { p, v, ref };
  };

  r.put("/files/photo/:id", needAuth, async (c) => {
    const { p, v } = await loadPhoto(c.get("principal"), c.req.param("id"), "photos.ajouter");
    const ct = (c.req.header("content-type") ?? "").split(";")[0].trim();
    if (ct !== "image/jpeg") throw new HttpError(400, "file_type");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > MAX_PHOTO) throw new HttpError(400, "file_too_large");
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new HttpError(400, "file_type"); // JPEG magic bytes
    const key = photoKey(v.orgId, v.id, p.id);
    await storage.put(key, bytes, "image/jpeg");
    const seq = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(7001)`);
      const s = await nextSeq(tx);
      await tx.update(photos).set({ fileKey: key, size: bytes.length, seq: s }).where(eq(photos.id, p.id));
      return s;
    });
    hub.publish(v.orgId, seq);
    return c.json({ ok: true, photo: photoToClient({ ...p, fileKey: key, seq }) });
  });

  r.get("/files/photo/:id", needAuth, async (c) => {
    const { p } = await loadPhoto(c.get("principal"), c.req.param("id"), "vehicules.voir");
    const f = p.fileKey ? await storage.get(p.fileKey) : null;
    if (!f) throw new HttpError(404, "photo_not_found");
    return new Response(f.bytes as BodyInit, { headers: { "content-type": f.contentType, "cache-control": "private, max-age=86400" } });
  });

  const vehicleFor = async (u: Principal, id: string, perm: "vehicules.voir" | "colibri.importer") => {
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    if (!v || v.deletedAt) throw new HttpError(404, "vehicle_not_found");
    const as = await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, v.id));
    const ref = refOf(v, as.map((a) => a.userId));
    if (!can(u, "vehicules.voir", ref)) throw new HttpError(404, "vehicle_not_found");
    if (perm !== "vehicules.voir" && !can(u, perm, ref)) throw new HttpError(403, "forbidden");
    return v;
  };

  r.put("/files/colibri/:vehicleId", needAuth, async (c) => {
    const v = await vehicleFor(c.get("principal"), c.req.param("vehicleId"), "colibri.importer");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > MAX_PDF) throw new HttpError(400, "file_too_large");
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new HttpError(400, "file_type");
    await storage.put(colibriKey(v.orgId, v.id), bytes, "application/pdf");
    return c.json({ ok: true });
  });

  r.get("/files/colibri/:vehicleId", needAuth, async (c) => {
    const v = await vehicleFor(c.get("principal"), c.req.param("vehicleId"), "vehicules.voir");
    const f = await storage.get(colibriKey(v.orgId, v.id));
    if (!f) throw new HttpError(404, "vehicle_not_found");
    return new Response(f.bytes as BodyInit, { headers: { "content-type": "application/pdf", "cache-control": "private, max-age=3600" } });
  });

  // ---- reports by e-mail ----
  const reportPerm = (t: string) => (t === "kva" ? "kva.envoyer" : "rapport_reparation.envoyer") as "kva.envoyer" | "rapport_reparation.envoyer";
  const REPORT_TYPES = ["kva", "reparation"];
  const reportHits = new Map<string, number[]>();

  /** Who would receive this report (preview in the app; the server recomputes it when the report is sent). */
  r.get("/reports/recipients", needAuth, async (c) => {
    const type = c.req.query("type") ?? "kva";
    if (!REPORT_TYPES.includes(type)) throw new HttpError(400, "invalid_input");
    const v = await vehicleFor(c.get("principal"), c.req.query("vehicleId") ?? "", "vehicules.voir");
    const as = await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, v.id));
    if (!can(c.get("principal"), reportPerm(type), refOf(v, as.map((a) => a.userId)))) throw new HttpError(403, "forbidden");
    return c.json({ recipients: await recipientsOfVehicle(db, v, type as "kva" | "reparation") });
  });

  /** History of what was sent for a vehicle. */
  r.get("/reports", needAuth, async (c) => {
    const v = await vehicleFor(c.get("principal"), c.req.query("vehicleId") ?? "", "vehicules.voir");
    const as = await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, v.id));
    const ref = refOf(v, as.map((a) => a.userId));
    if (!can(c.get("principal"), "kva.envoyer", ref) && !can(c.get("principal"), "rapport_reparation.envoyer", ref)) throw new HttpError(403, "forbidden");
    const rows = await db.select({ r: reportSends, name: users.name, email: users.email }).from(reportSends).leftJoin(users, eq(users.id, reportSends.sentBy)).where(eq(reportSends.vehicleId, v.id));
    return c.json(rows.map(({ r: x, name, email }) => ({ id: x.id, type: x.type, lang: x.lang, status: x.status, error: x.error, recipients: x.recipients, sentAt: x.sentAt, createdAt: x.createdAt, sentBy: name || email, hasFile: !!x.fileKey })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
  });

  /** The stored PDF of a report that was sent from the server (same permission as the history). */
  r.get("/reports/:id/file", needAuth, async (c) => {
    const [rep] = await db.select().from(reportSends).where(eq(reportSends.id, c.req.param("id")));
    if (!rep || !rep.fileKey || (rep.type !== "kva" && rep.type !== "reparation")) throw new HttpError(404, "vehicle_not_found");
    const v = await vehicleFor(c.get("principal"), rep.vehicleId, "vehicules.voir");
    const as = await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, v.id));
    if (!can(c.get("principal"), reportPerm(rep.type), refOf(v, as.map((a) => a.userId)))) throw new HttpError(404, "vehicle_not_found");
    const f = await storage.get(rep.fileKey);
    if (!f) throw new HttpError(404, "vehicle_not_found");
    return new Response(f.bytes as BodyInit, { headers: { "content-type": "application/pdf", "cache-control": "private, no-store" } });
  });

  /** The PDF of a queued report: stored, then e-mailed to the recipients computed when the op was accepted. */
  r.put("/files/report/:id", needAuth, async (c) => {
    const u = c.get("principal");
    const [rep] = await db.select().from(reportSends).where(eq(reportSends.id, c.req.param("id")));
    if (!rep || rep.sentBy !== u.id) throw new HttpError(404, "vehicle_not_found");
    const v = await vehicleFor(u, rep.vehicleId, "vehicules.voir");
    const as = await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, v.id));
    if (!can(u, reportPerm(rep.type), refOf(v, as.map((a) => a.userId)))) throw new HttpError(403, "forbidden");
    if (rep.status === "sent") return c.json({ ok: true, status: "sent" }); // retried upload: already done
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > MAX_PDF) throw new HttpError(400, "file_too_large");
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new HttpError(400, "file_type");
    const now = Date.now();
    const recent = (reportHits.get(u.id) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= 40) throw new HttpError(429, "too_many_requests");
    reportHits.set(u.id, [...recent, now]);

    const key = `reports/${v.orgId}/${v.id}/${rep.id}.pdf`;
    await storage.put(key, bytes, "application/pdf");
    const h = v.header as Record<string, string>;
    const [me] = await db.select().from(users).where(eq(users.id, u.id));
    const lang = rep.lang === "es" ? "es" : "de";
    const mail = reportMail(lang, rep.type as "kva" | "reparation", {
      plate: h.kennzeichen ?? "", model: h.modell ?? "", vin: h.fin ?? "", hasScan: rep.type === "kva" && !!v.colibriFile, senderName: me?.name ?? "",
    });
    const safe = (c.req.header("x-filename") ?? "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
    const filename = safe.toLowerCase().endsWith(".pdf") ? safe : `${rep.type === "kva" ? (lang === "es" ? "Presupuesto" : "Kostenvoranschlag") : (lang === "es" ? "Informe_reparacion" : "Fotobericht_Reparatur")}_${(h.kennzeichen ?? "Fahrzeug").replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
    try {
      await mailer.send({ to: rep.recipients, subject: mail.subject, text: mail.text, replyTo: me?.email, attachments: [{ filename, content: bytes, contentType: "application/pdf" }] });
    } catch (e) {
      await db.update(reportSends).set({ status: "failed", error: String((e as Error).message).slice(0, 300), fileKey: key }).where(eq(reportSends.id, rep.id));
      throw new HttpError(502, "report_failed");
    }
    await db.update(reportSends).set({ status: "sent", sentAt: new Date(), error: null, fileKey: key }).where(eq(reportSends.id, rep.id));
    await audit(db, { orgId: v.orgId, userId: u.id, action: "report.sent", entity: "report", entityId: rep.id, after: { type: rep.type, recipients: rep.recipients, bytes: bytes.length } });
    return c.json({ ok: true, status: "sent", recipients: rep.recipients });
  });

  // ---- OCR proxy (login required, rate limited per user) ----
  const hits = new Map<string, number[]>();
  r.post("/ocr", needAuth, zValidator("json", ocrInput, validationHook), async (c) => {
    if (!ocr?.apiKey) throw new HttpError(409, "ocr_unavailable");
    const uid = c.get("principal").id, now = Date.now();
    const recent = (hits.get(uid) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= 60) throw new HttpError(429, "too_many_requests");
    hits.set(uid, [...recent, now]);
    const b = c.req.valid("json");
    try {
      return c.json(await recognise(ocr.fetch, ocr.apiKey, ocr.model, b.image, b.mode, b.land));
    } catch {
      throw new HttpError(502, "ocr_failed");
    }
  });

  return r;
}
