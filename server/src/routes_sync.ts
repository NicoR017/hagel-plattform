import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ocrInput, pushInput, type PushResponse } from "@hagel/shared";
import { HttpError } from "./auth";
import type { Db } from "./db";
import type { Env } from "./env";
import type { Hub } from "./hub";
import { recognise, type FetchLike } from "./ocr";
import { can, type Principal } from "./permissions";
import { photos, vehicleAssignments, vehicles } from "./schema";
import type { Storage } from "./storage";
import { colibriKey, nextSeq, photoKey, photoToClient, processPull, processPush, refOf } from "./sync";

interface Deps {
  db: Db; hub: Hub; storage: Storage;
  needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env>;
  ocr?: { apiKey: string | null; model: string; fetch: FetchLike };
  validationHook: (r: { success: boolean }, c: Context) => Response | undefined;
}

const MAX_PHOTO = 4 * 1024 * 1024;
const MAX_PDF = 15 * 1024 * 1024;

export function syncRoutes({ db, hub, storage, needAuth, needOrg, ocr, validationHook }: Deps) {
  const r = new Hono<Env>();

  r.post("/sync/push", needAuth, zValidator("json", pushInput, validationHook), async (c) => {
    const { results, touched } = await processPush({ db, hub, storage }, c.get("principal"), c.req.valid("json").ops);
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
