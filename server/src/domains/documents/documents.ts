// Repair v2, F5: documents imported for a car (parts invoice of the body shop, paint invoices, insurer / customer documents …), the repair dossier sent to
// the insurer, and the billing INFORMATION of a car (read-only: our invoice to the body shop is made by the Swiss system from the CSV export).
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { computeVehicle, type CalcVehicle } from "@hagel/calc";
import type { ErrorCode, Permission } from "@hagel/shared";
import { audit } from "../../audit";
import type { Db } from "../../db";
import type { Mailer } from "../../email";
import type { Env } from "../../env";
import { can, canOrg, type Principal } from "../../permissions";
import type { Storage } from "../../storage";
import { HttpError } from "../auth/auth";
import { loadMethodMap, methodOf } from "../admin/methods";
import { buildRepairReportPdf } from "../repair/report";
import { recipientDefaultsOfVehicle } from "../reports/reports";
import { replyToFor } from "../reports/reply_to";
import { bodyShopOrderSettings, dossierSends, paintJobs, partOrders, repairEvents, reportSends, stations, users, vehicleAssignments, vehicleDocuments, vehicleHandovers, vehicles } from "../../schema";
import { calcSettings, flatten, loadOrgSettings, nextSeq, refOf, type VehicleRow } from "../vehicles/sync";

type DocRow = typeof vehicleDocuments.$inferSelect;
export const DOC_TYPES = ["parts_invoice", "paint_invoice", "insurer_doc", "customer_doc", "photos", "other"] as const;
const CATEGORY: Record<(typeof DOC_TYPES)[number], string> = { parts_invoice: "parts", paint_invoice: "paint", insurer_doc: "other", customer_doc: "other", photos: "repair", other: "other" };
const MAX_FILE = 15 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** what the file really is (not what the client says): PDF, JPEG or PNG */
export function sniff(b: Uint8Array): { ext: "pdf" | "jpg" | "png"; type: string } | null {
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { ext: "pdf", type: "application/pdf" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", type: "image/png" };
  return null;
}

interface Deps { db: Db; storage: Storage; mailer?: Mailer; needAuth: MiddlewareHandler<Env>; needOrg: MiddlewareHandler<Env>; validationHook: (r: { success: boolean }, c: Context) => Response | undefined }

const docInput = z.object({
  type: z.enum(DOC_TYPES), title: z.string().trim().max(160).optional(), number: z.string().trim().max(60).optional(), amountHt: z.number().min(0).max(10_000_000).optional(),
  partnerId: z.string().uuid().optional(), orderIds: z.array(z.string().uuid()).max(50).optional(), paintJobIds: z.array(z.string().uuid()).max(50).optional(),
  inDossier: z.boolean().optional(),
});

export function documentRoutes({ db, storage, mailer, needAuth, needOrg, validationHook }: Deps) {
  const r = new Hono<Env>();
  const org = (c: Context<Env>) => c.get("orgId");
  const fail = (code: ErrorCode, status: 400 | 403 | 404 | 409 | 502 = 400): never => { throw new HttpError(status, code); };

  const load = async (c: Context<Env>, vehicleId: string, perm: Permission | Permission[]) => {
    const [row] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.orgId, org(c))));
    if (!row || row.deletedAt) throw new HttpError(404, "vehicle_not_found");
    const as = (await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.vehicleId, row.id))).map((a) => a.userId);
    const u = c.get("principal"), ref = refOf(row, as);
    if (!can(u, "vehicules.voir", ref)) throw new HttpError(404, "vehicle_not_found");
    const perms = Array.isArray(perm) ? perm : [perm];
    if (!perms.some((p) => can(u, p, ref))) throw new HttpError(403, "forbidden");
    return { row, u, ref };
  };
  const touch = async (row: VehicleRow, userId: string) => {
    const seq = await nextSeq(db as never);
    await db.update(vehicles).set({ seq, updatedBy: userId, updatedAt: new Date() }).where(eq(vehicles.id, row.id));
  };
  const ev = (vehicleId: string, userId: string | null, type: string, payload: Record<string, unknown>) => db.insert(repairEvents).values({ vehicleId, userId, type, payload: payload as never });
  const shape = (d: DocRow) => ({ id: d.id, category: d.category, type: d.type, title: d.title, number: d.number, amountHt: d.amountHt === null ? null : Number(d.amountHt), partnerId: d.partnerStationId, orderIds: d.orderIds, paintJobIds: d.paintJobIds, inDossier: d.inDossier, version: d.version, supersedesId: d.supersedesId, hasFile: !!d.fileKey, size: d.size, contentType: d.contentType, createdAt: d.createdAt, createdBy: d.createdBy });

  /** what is expected for this car and not there yet */
  const missingOf = async (row: VehicleRow, docs: DocRow[]): Promise<{ key: string; type: string; partnerId?: string }[]> => {
    const out: { key: string; type: string; partnerId?: string }[] = [];
    const live = docs.filter((d) => d.fileKey);
    const orders = await db.select({ status: partOrders.status, kind: partOrders.kind }).from(partOrders).where(eq(partOrders.vehicleId, row.id));
    if (orders.some((o) => (o.kind === "main" || o.kind === "complement") && o.status !== "cancelled") && !live.some((d) => d.type === "parts_invoice" && !docs.some((x) => x.supersedesId === d.id))) out.push({ key: "parts_invoice", type: "parts_invoice" });
    const pj = await db.select({ partner: paintJobs.partnerStationId, status: paintJobs.status }).from(paintJobs).where(and(eq(paintJobs.vehicleId, row.id), isNull(paintJobs.deletedAt)));
    for (const p of new Set(pj.filter((j) => j.partner && (j.status === "at_body_shop" || j.status === "done")).map((j) => j.partner!))) {
      if (!live.some((d) => d.type === "paint_invoice" && d.partnerStationId === p && !docs.some((x) => x.supersedesId === d.id))) out.push({ key: `paint_invoice:${p}`, type: "paint_invoice", partnerId: p });
    }
    return out;
  };

  /** the documents of a car by category, with what is generated by the app and what is missing */
  r.get("/vehicles/:id/documents", needAuth, needOrg, async (c) => {
    const { row } = await load(c, c.req.param("id") ?? "", ["documents.importer", "dossier.envoyer", "facturation.voir"]);
    const docs = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, row.id)).orderBy(desc(vehicleDocuments.createdAt));
    const hs = await db.select().from(vehicleHandovers).where(and(eq(vehicleHandovers.vehicleId, row.id), isNull(vehicleHandovers.replacedBy)));
    const sends = await db.select().from(reportSends).where(eq(reportSends.vehicleId, row.id)).orderBy(desc(reportSends.createdAt));
    const orders = await db.select().from(partOrders).where(eq(partOrders.vehicleId, row.id)).orderBy(partOrders.createdAt);
    const sts = new Map((await db.select().from(stations).where(eq(stations.orgId, row.orgId))).map((s) => [s.id, s.name]));
    const dossiers = await db.select().from(dossierSends).where(eq(dossierSends.vehicleId, row.id)).orderBy(desc(dossierSends.sentAt));
    return c.json({
      documents: docs.map((d) => ({ ...shape(d), partnerName: d.partnerStationId ? sts.get(d.partnerStationId) ?? "" : "", latest: !docs.some((x) => x.supersedesId === d.id) })),
      generated: {
        receipts: hs.map((h) => ({ id: h.id, kind: h.kind, signedAt: h.signedAt, hasReceipt: !!h.receiptPdfKey })),
        reports: sends.filter((s) => s.status === "sent").map((s) => ({ id: s.id, type: s.type, at: s.sentAt ?? s.createdAt, hasFile: !!s.fileKey })),
        orders: orders.map((o) => ({ id: o.id, number: o.number, kind: o.kind, status: o.status, hasPdf: !!o.pdfKey })),
      },
      missing: await missingOf(row, docs), dossiers: dossiers.map((d) => ({ id: d.id, to: d.toEmails, cc: d.ccEmails, status: d.status, at: d.sentAt, included: d.included, missing: d.missing })),
    });
  });

  /** D39: register a document (data first, then the file): a parts invoice (one per car) or a paint invoice (one per painter and car) replaces the previous one as a NEW VERSION */
  r.post("/vehicles/:id/documents", needAuth, needOrg, zValidator("json", docInput, validationHook), async (c) => {
    const { row, u } = await load(c, c.req.param("id") ?? "", "documents.importer");
    const b = c.req.valid("json");
    if (b.type === "paint_invoice" && !b.partnerId) return fail("document_type_invalid");
    if (b.partnerId) { const [p] = await db.select({ id: stations.id }).from(stations).where(and(eq(stations.id, b.partnerId), eq(stations.orgId, row.orgId), eq(stations.type, "carrosserie"))); if (!p) return fail("document_type_invalid"); }
    if (b.orderIds?.length) { const ok = await db.select({ id: partOrders.id }).from(partOrders).where(and(eq(partOrders.vehicleId, row.id), inArray(partOrders.id, b.orderIds))); if (ok.length !== b.orderIds.length) return fail("document_type_invalid"); }
    if (b.paintJobIds?.length) { const ok = await db.select({ id: paintJobs.id }).from(paintJobs).where(and(eq(paintJobs.vehicleId, row.id), inArray(paintJobs.id, b.paintJobIds))); if (ok.length !== b.paintJobIds.length) return fail("document_type_invalid"); }
    if ((b.type === "parts_invoice" || b.type === "paint_invoice") && (!b.number || b.amountHt === undefined)) return fail("document_type_invalid"); // number and amount excl. VAT
    const same = (b.type === "parts_invoice" || b.type === "paint_invoice")
      ? (await db.select().from(vehicleDocuments).where(and(eq(vehicleDocuments.vehicleId, row.id), eq(vehicleDocuments.type, b.type)))).filter((d) => (b.type === "parts_invoice" || d.partnerStationId === b.partnerId))
      : [];
    const last = same.filter((d) => !same.some((x) => x.supersedesId === d.id)).sort((a, b2) => b2.version - a.version)[0];
    const [d] = await db.insert(vehicleDocuments).values({
      orgId: row.orgId, vehicleId: row.id, category: CATEGORY[b.type], type: b.type, title: b.title ?? "", number: b.number ?? null, amountHt: b.amountHt === undefined ? null : String(b.amountHt),
      partnerStationId: b.partnerId ?? null, orderIds: b.orderIds ?? [], paintJobIds: b.paintJobIds ?? [], inDossier: b.inDossier ?? (b.type === "parts_invoice" || b.type === "paint_invoice"),
      version: last ? last.version + 1 : 1, supersedesId: last?.id ?? null, createdBy: u.id,
    }).returning();
    await ev(row.id, u.id, last ? "document_new_version" : "document_added", { documentId: d.id, type: b.type, number: b.number ?? null, version: d.version });
    await audit(db, { orgId: row.orgId, userId: u.id, action: "create", entity: "vehicle_document", entityId: d.id, after: { type: b.type, number: b.number ?? null, version: d.version } });
    return c.json(shape(d), 201);
  });

  /** the file of a registered document (PDF, JPG or PNG, at most 15 MB; the content is checked, not the name) */
  r.put("/documents/:id/file", needAuth, needOrg, async (c) => {
    const [d] = await db.select().from(vehicleDocuments).where(and(eq(vehicleDocuments.id, c.req.param("id") ?? ""), eq(vehicleDocuments.orgId, org(c))));
    if (!d) return fail("document_not_found", 404);
    const { row, u } = await load(c, d.vehicleId, "documents.importer");
    if (d.fileKey) return fail("document_file_invalid", 409); // a file is never overwritten: import a new version
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind || bytes.length > MAX_FILE) return fail("document_file_invalid");
    const key = `documents/${row.orgId}/${row.id}/${d.id}.${kind.ext}`;
    await storage.put(key, bytes, kind.type);
    await db.update(vehicleDocuments).set({ fileKey: key, contentType: kind.type, size: bytes.length }).where(eq(vehicleDocuments.id, d.id));
    await touch(row, u.id);
    return c.json({ ok: true, size: bytes.length });
  });

  r.get("/documents/:id/file", needAuth, needOrg, async (c) => {
    const [d] = await db.select().from(vehicleDocuments).where(and(eq(vehicleDocuments.id, c.req.param("id") ?? ""), eq(vehicleDocuments.orgId, org(c))));
    if (!d || !d.fileKey) return fail("document_not_found", 404);
    await load(c, d.vehicleId, ["documents.importer", "dossier.envoyer", "facturation.voir"]);
    const f = await storage.get(d.fileKey);
    if (!f) return fail("document_not_found", 404);
    const ext = d.fileKey.split(".").pop();
    return new Response(Buffer.from(f.bytes), { headers: { "content-type": d.contentType ?? "application/octet-stream", "content-disposition": `attachment; filename="${(d.number || d.title || d.type).replace(/[^A-Za-z0-9._-]+/g, "_")}.${ext}"`, "cache-control": "private, no-store" } });
  });

  // ------------------------------------------------------------------ repair dossier

  /** the checklist (ready / missing) and the recipients proposed: the insurer, the body shop in Cc */
  const dossierItems = async (row: VehicleRow) => {
    const docs = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, row.id));
    const latest = docs.filter((d) => d.fileKey && !docs.some((x) => x.supersedesId === d.id));
    const hs = await db.select().from(vehicleHandovers).where(and(eq(vehicleHandovers.vehicleId, row.id), isNull(vehicleHandovers.replacedBy)));
    const kva = (await db.select().from(reportSends).where(and(eq(reportSends.vehicleId, row.id), eq(reportSends.type, "kva"), eq(reportSends.status, "sent"))).orderBy(desc(reportSends.createdAt)))[0];
    const miss = await missingOf(row, docs);
    const items: { key: string; kind: string; ready: boolean; label: string; documentId?: string; number?: string | null }[] = [
      { key: "repairReport", kind: "report", ready: true, label: "repair_report" },
      { key: "estimate", kind: "estimate", ready: !!kva?.fileKey, label: "estimate" },
      { key: "receipts", kind: "receipts", ready: hs.some((h) => !!h.receiptPdfKey), label: "receipts" },
      ...latest.map((d) => ({ key: `doc:${d.id}`, kind: d.type, ready: true, label: d.type, documentId: d.id, number: d.number })),
      ...miss.map((m) => ({ key: `missing:${m.key}`, kind: m.type, ready: false, label: m.type })),
    ];
    const rec = await recipientDefaultsOfVehicle(db, row, "kva");
    return { items, recipients: { to: rec.filter((x) => x.source === "insurer").map((x) => x.email), cc: rec.filter((x) => x.source === "bodyshop").map((x) => x.email) }, kva, missing: miss, hs, latest };
  };

  r.get("/vehicles/:id/dossier", needAuth, needOrg, async (c) => {
    const { row } = await load(c, c.req.param("id") ?? "", "dossier.envoyer");
    const d = await dossierItems(row);
    return c.json({ items: d.items, recipients: d.recipients, lang: (row.header as Record<string, unknown>).land === "ES" ? "es" : "de" });
  });

  const sendInput = z.object({
    to: z.array(z.string().trim().toLowerCase().max(200)).max(10), cc: z.array(z.string().trim().toLowerCase().max(200)).max(10).default([]),
    include: z.object({ repairReport: z.boolean().default(true), estimate: z.boolean().default(false), receipts: z.boolean().default(true), documentIds: z.array(z.string().uuid()).max(30).default([]) }),
    note: z.string().trim().max(500).optional(),
  });

  /** D40: ONE e-mail to the insurer with every document of the repair; it may leave with documents still missing (the e-mail says what follows) */
  r.post("/vehicles/:id/dossier/send", needAuth, needOrg, zValidator("json", sendInput, validationHook), async (c) => {
    const { row, u } = await load(c, c.req.param("id") ?? "", "dossier.envoyer");
    const b = c.req.valid("json");
    const to = [...new Set(b.to)], cc = [...new Set(b.cc)].filter((x) => !to.includes(x));
    if (!to.length || [...to, ...cc].some((e) => !EMAIL_RE.test(e))) return fail("dossier_no_recipient");
    const info = await dossierItems(row);
    const atts: { filename: string; content: Uint8Array; contentType: string }[] = [], included: string[] = [];
    const plate = String((row.header as Record<string, unknown>).kennzeichen ?? "").replace(/[^A-Za-z0-9]+/g, "") || "vehicle";
    const lang = (row.header as Record<string, unknown>).land === "ES" ? "es" : "de";
    if (b.include.repairReport) { const pdf = await buildRepairReportPdf({ db, storage }, row); atts.push({ filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" }); included.push("repair_report"); }
    if (b.include.estimate && info.kva?.fileKey) { const f = await storage.get(info.kva.fileKey); if (f) { atts.push({ filename: `${lang === "es" ? "Presupuesto" : "Kostenvoranschlag"}_${plate}.pdf`, content: f.bytes, contentType: "application/pdf" }); included.push("estimate"); } }
    if (b.include.receipts) for (const h of info.hs) if (h.receiptPdfKey) { const f = await storage.get(h.receiptPdfKey); if (f) { atts.push({ filename: `${h.kind === "drop_off" ? (lang === "es" ? "Recepcion" : "Annahme") : (lang === "es" ? "Devolucion" : "Rueckgabe")}_${plate}.pdf`, content: f.bytes, contentType: "application/pdf" }); included.push(`receipt:${h.kind}`); } }
    for (const id of b.include.documentIds) {
      const d = info.latest.find((x) => x.id === id);
      if (!d?.fileKey) continue; // only the current version of a document of this car
      const f = await storage.get(d.fileKey); if (!f) continue;
      atts.push({ filename: `${(d.number || d.title || d.type).replace(/[^A-Za-z0-9._-]+/g, "_")}.${d.fileKey.split(".").pop()}`, content: f.bytes, contentType: d.contentType ?? "application/octet-stream" }); included.push(`doc:${d.type}${d.number ? ":" + d.number : ""}`);
    }
    if (!atts.length) return fail("dossier_nothing");
    const missing = info.missing.map((m) => m.type);
    const [me] = await db.select().from(users).where(eq(users.id, u.id));
    const h = row.header as Record<string, string>;
    const T = lang === "es"
      ? { subject: `Expediente de reparación – ${[h.modell, h.kennzeichen].filter(Boolean).join(" · ")}`, intro: "Estimados señores:\n\nAdjuntamos el expediente de reparación del vehículo", att: "Documentos adjuntos:", miss: "Pendientes de enviar (se remitirán en cuanto los recibamos):", names: { repair_report: "Informe fotográfico de la reparación", estimate: "Presupuesto", parts_invoice: "Factura de piezas del taller", paint_invoice: "Factura de pintura", receipts: "Comprobantes de entrega y devolución" }, bye: "Un saludo" }
      : { subject: `Reparaturdossier – ${[h.modell, h.kennzeichen].filter(Boolean).join(" · ")}`, intro: "Sehr geehrte Damen und Herren,\n\nanbei das Reparaturdossier des Fahrzeugs", att: "Beigefügte Unterlagen:", miss: "Noch ausstehend (folgt, sobald vorhanden):", names: { repair_report: "Foto-Reparaturbericht", estimate: "Kostenvoranschlag", parts_invoice: "Teilerechnung der Carrosserie", paint_invoice: "Lackierrechnung", receipts: "Übergabebestätigungen" }, bye: "Freundliche Grüße" };
    const nm = (k: string) => (T.names as Record<string, string>)[k.split(":")[0].replace(/^receipt$/, "receipts")] ?? k;
    const text = `${T.intro} ${[h.modell, h.kennzeichen].filter(Boolean).join(" · ")}${h.claimNumber ? ` (${lang === "es" ? "siniestro" : "Schaden"} ${h.claimNumber})` : ""}.\n\n${T.att}\n${atts.map((a) => "- " + a.filename).join("\n")}\n${missing.length ? `\n${T.miss}\n${missing.map((m) => "- " + nm(m)).join("\n")}\n` : ""}${b.note ? `\n${b.note}\n` : ""}\n${T.bye}\n${me?.name ?? ""}`;
    let status = "sent", error: string | null = null;
    try { await mailer!.send({ to: to, cc: cc.length ? cc : undefined, replyTo: await replyToFor(db, u.id, row.orgId), subject: T.subject, text, attachments: atts }); }
    catch (e) { status = "failed"; error = String((e as Error).message).slice(0, 300); }
    const [s] = await db.insert(dossierSends).values({ orgId: row.orgId, vehicleId: row.id, toEmails: to, ccEmails: cc, status, error, included: included as never, missing: missing as never, note: b.note ?? null, sentBy: u.id }).returning();
    await ev(row.id, u.id, status === "sent" ? "dossier_sent" : "dossier_failed", { sendId: s.id, to, included, missing, ...(error ? { error } : {}) });
    await audit(db, { orgId: row.orgId, userId: u.id, action: "dossier.send", entity: "vehicle", entityId: row.id, after: { to, cc, included, missing, status } });
    await touch(row, u.id);
    if (status === "failed") return fail("dossier_send_failed", 502);
    return c.json({ id: s.id, status, included, missing });
  });

  // ------------------------------------------------------------------ billing information (read-only)

  /** R12: for a car billed via a body shop: our assessment amount (PDR + paint, without parts), the body shop parts invoice, what the body shop bills the insurer. Information only. */
  r.get("/vehicles/:id/billing", needAuth, needOrg, async (c) => {
    const { row, u, ref } = await load(c, c.req.param("id") ?? "", "facturation.voir");
    if (!can(u, "prix.voir", ref)) throw new HttpError(403, "forbidden");
    const calc = computeVehicle(flatten(row, [], null) as unknown as CalcVehicle, calcSettings(await loadOrgSettings(db, row.orgId)), methodOf(await loadMethodMap(db, row.orgId), row));
    const docs = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, row.id));
    const cur = (type: string) => docs.filter((d) => d.type === type && !docs.some((x) => x.supersedesId === d.id));
    const parts = cur("parts_invoice")[0];
    const paint = cur("paint_invoice");
    const [set] = row.clientStationId ? await db.select().from(bodyShopOrderSettings).where(eq(bodyShopOrderSettings.stationId, row.clientStationId)) : [];
    const [bs] = row.clientStationId ? await db.select().from(stations).where(eq(stations.id, row.clientStationId)) : [];
    const sts = new Map((await db.select().from(stations).where(eq(stations.orgId, row.orgId))).map((s) => [s.id, s.name]));
    const assessment = Math.round(calc.netto * 100) / 100;
    const partsAmt = parts?.amountHt == null ? null : Number(parts.amountHt);
    return c.json({
      viaBodyShop: !!set?.enabled, bodyShop: bs?.name ?? null, commissionPct: bs ? Number(bs.commissionPct) : null,
      assessmentNet: assessment,
      partsInvoice: parts ? { id: parts.id, number: parts.number, amountHt: partsAmt, version: parts.version } : null,
      paintInvoices: paint.map((p) => ({ id: p.id, number: p.number, amountHt: p.amountHt == null ? null : Number(p.amountHt), partner: p.partnerStationId ? sts.get(p.partnerStationId) ?? "" : "" })),
      bodyShopBillsInsurer: partsAmt == null ? null : Math.round((assessment + partsAmt) * 100) / 100,
    });
  });

  void canOrg; void ne; void sql;
  return r;
}
export type { Principal };
