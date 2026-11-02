import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { loadConfig } from "../src/config";
import { MAIL_INLINE_LIMIT, MemoryMailer, type Mail } from "../src/email";
import { AttachmentFitMailer, makeLinkToken } from "../src/mail_attachments";
import { SHRINK_LADDER, shrinkPdfImages } from "../src/pdf_shrink";
import { call, setup, type Ctx } from "./helpers";

const SECRET = loadConfig({}).sessionSecret;
const mail: Mail = { to: "a@x.test", subject: "S", text: "Body", html: "<p>Body</p>" };

/** A photo report like the real one: JPEG photos embedded as they are. */
async function photoPdf(photos: number, w = 2400, h = 1600): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < photos; i++) {
    const jpg = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 110, b: 130 }, noise: { type: "gaussian", mean: 128, sigma: 14 } } }).jpeg({ quality: 92 }).toBuffer();
    const img = await doc.embedJpg(jpg);
    doc.addPage([595, 842]).drawImage(img, { x: 20, y: 300, width: 555, height: 370 });
  }
  return doc.save();
}
const att = (content: Uint8Array, filename = "r.pdf", contentType = "application/pdf") => ({ filename, contentType, content });
const sizeOf = (m: Mail) => (m.attachments ?? []).reduce((n, a) => n + a.content.byteLength, 0);

describe("shrinkPdfImages", () => {
  it("makes a photo PDF smaller, keeps page count and a valid PDF, and each step is not bigger than the one before", async () => {
    const pdf = await photoPdf(3);
    const sizes: number[] = [pdf.byteLength];
    for (const step of SHRINK_LADDER) sizes.push((await shrinkPdfImages(pdf, step)).byteLength);
    sizes.slice(1).forEach((s, i) => expect(s).toBeLessThanOrEqual(sizes[i] + 1000));
    expect(sizes[sizes.length - 1]).toBeLessThan(sizes[0] / 2);
    const out = await PDFDocument.load(await shrinkPdfImages(pdf, SHRINK_LADDER[1]));
    expect(out.getPageCount()).toBe(3);
  });
  it("leaves a PDF without photos alone (valid, same pages)", async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    const out = await PDFDocument.load(await shrinkPdfImages(await doc.save(), SHRINK_LADDER[0]));
    expect(out.getPageCount()).toBe(1);
  });
});

describe("AttachmentFitMailer", () => {
  let c: Ctx;
  beforeAll(async () => { c = await setup(); }, 120_000);
  const make = (inner: MemoryMailer, o: { limit?: number; now?: () => number } = {}) => new AttachmentFitMailer(inner, { storage: c.storage, appUrl: "https://app.test", secret: SECRET, log: () => {}, ...o });

  it("small attachments pass through untouched (same bytes, no storage)", async () => {
    const inner = new MemoryMailer(), before = c.storage.files.size;
    const bytes = new Uint8Array([1, 2, 3]);
    await make(inner).send({ ...mail, attachments: [att(bytes)] });
    expect(inner.last().attachments![0].content).toBe(bytes);
    expect(c.storage.files.size).toBe(before);
  });

  it("a PDF over the limit is sent with smaller photos instead of a link", async () => {
    const inner = new MemoryMailer(), pdf = await photoPdf(4), before = c.storage.files.size;
    const limit = Math.floor(pdf.byteLength * 0.4);
    expect(pdf.byteLength).toBeGreaterThan(limit);
    await make(inner, { limit }).send({ ...mail, attachments: [att(pdf)] });
    const sent = inner.last();
    expect(sizeOf(sent)).toBeLessThanOrEqual(limit);
    expect(sent.attachments![0].filename).toBe("r.pdf");
    expect(sent.text).toBe("Body");
    expect(c.storage.files.size).toBe(before);
    expect((await PDFDocument.load(sent.attachments![0].content)).getPageCount()).toBe(4);
  });

  it("when shrinking is not enough: private copy + signed link in text and html, attachment removed", async () => {
    const inner = new MemoryMailer(), big = new Uint8Array(MAIL_INLINE_LIMIT + 5000).fill(7);
    await make(inner).send({ ...mail, attachments: [att(big, "Informe 0742 GCK.pdf")] });
    const sent = inner.last();
    expect(sent.attachments).toBeUndefined();
    const url = sent.text.match(/https:\/\/app\.test\/api\/files\/\S+/)![0];
    expect(sent.text.startsWith("Body")).toBe(true);
    expect(sent.text).toContain("Informe 0742 GCK.pdf"); // shown as named; the download name is the safe one (below)
    expect(sent.html).toContain(`href="${url}"`);
    const r = await call(c, "GET", url.replace("https://app.test/api", ""));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="Informe_0742_GCK.pdf"');
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.bytes.byteLength).toBe(big.byteLength);
  });

  it("keeps the small attachment attached and links only the big one", async () => {
    const inner = new MemoryMailer();
    await make(inner).send({ ...mail, attachments: [att(new Uint8Array(1000), "small.txt", "text/plain"), att(new Uint8Array(MAIL_INLINE_LIMIT + 1), "big.bin", "application/octet-stream")] });
    expect(inner.last().attachments!.map((a) => a.filename)).toEqual(["small.txt"]);
    expect(inner.last().text).toContain("big.bin");
  });

  it("an unreadable 'PDF' falls back to the link, never fails the send", async () => {
    const inner = new MemoryMailer();
    await make(inner).send({ ...mail, attachments: [att(new Uint8Array(MAIL_INLINE_LIMIT + 1).fill(1))] });
    expect(inner.last().attachments).toBeUndefined();
    expect(inner.last().text).toContain("/api/files/");
  });

  it("the download route refuses forged, tampered, expired and out-of-scope tokens", async () => {
    const inner = new MemoryMailer();
    await make(inner).send({ ...mail, attachments: [att(new Uint8Array(MAIL_INLINE_LIMIT + 1).fill(2), "a.bin", "application/octet-stream")] });
    const token = inner.last().text.match(/\/api\/files\/(\S+)/)![1];
    const get = (t: string) => call(c, "GET", `/files/${t}`);
    expect((await get(token)).status).toBe(200);
    expect((await get(token.slice(0, -2) + "xx")).status).toBe(404);
    expect((await get("garbage")).status).toBe(404);
    expect((await get(makeLinkToken("another-secret-another-secret-123456", "mail-links/x/a.bin", Date.now() + 1e6))).status).toBe(404);
    // right secret but a file that is not a mail link (e.g. a stored report)
    await c.storage.put("reports/org/v/secret.pdf", new Uint8Array([9]), "application/pdf");
    expect((await get(makeLinkToken(SECRET, "reports/org/v/secret.pdf", Date.now() + 1e6))).status).toBe(404);
    expect((await get(makeLinkToken(SECRET, "mail-links/../reports/org/v/secret.pdf", Date.now() + 1e6))).status).toBe(404);
  });

  it("an expired link is refused and the file is deleted", async () => {
    const inner = new MemoryMailer();
    await make(inner, { now: () => Date.now() - 20 * 86_400_000 }).send({ ...mail, attachments: [att(new Uint8Array(MAIL_INLINE_LIMIT + 1).fill(3), "old.bin", "application/octet-stream")] });
    const token = inner.last().text.match(/\/api\/files\/(\S+)/)![1];
    const keys = () => [...c.storage.files.keys()].filter((k) => k.endsWith("/old.bin"));
    expect(keys()).toHaveLength(1);
    expect((await call(c, "GET", `/files/${token}`)).status).toBe(404);
    expect(keys()).toHaveLength(0);
  });
});
