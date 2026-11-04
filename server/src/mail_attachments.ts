import { createHmac, randomUUID } from "node:crypto";
import { safeEqual } from "./crypto";
import { MAIL_INLINE_LIMIT, type Mail, type MailAttachment, type Mailer } from "./email";
import { SHRINK_LADDER, shrinkPdfImages } from "./pdf_shrink";
import type { Storage } from "./storage";

const LINK_PREFIX = "mail-links/";
const total = (a: MailAttachment[]) => a.reduce((n, x) => n + x.content.byteLength, 0);

// ---------- signed download links ----------
const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(`mail-link:${payload}`).digest("base64url");

export function makeLinkToken(secret: string, key: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ k: key, e: expiresAt })).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

/** The file behind a token, or null when the token is forged, expired, outside `mail-links/` or the file is gone. Expired files are deleted. */
export async function readLink(storage: Storage, secret: string, token: string, now = Date.now()): Promise<{ bytes: Uint8Array; contentType: string; filename: string } | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(secret, payload))) return null;
  let p: { k?: unknown; e?: unknown };
  try { p = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
  if (typeof p.k !== "string" || typeof p.e !== "number" || !p.k.startsWith(LINK_PREFIX) || p.k.includes("..")) return null;
  if (p.e < now) { await storage.delete(p.k).catch(() => undefined); return null; }
  const f = await storage.get(p.k);
  return f ? { ...f, filename: p.k.split("/").pop()! } : null;
}

export interface FitOptions { storage: Storage; appUrl: string; secret: string; limit?: number; ttlDays?: number; now?: () => number; log?: (s: string) => void }

/**
 * Keeps every mail under what Graph's plain `sendMail` accepts, without changing who calls the mailer:
 * 1. fits already: unchanged;
 * 2. else the photos inside the PDFs are re-encoded, gently first, and the first step that fits is used;
 * 3. else the largest attachments are stored privately and replaced by a signed, expiring download link in the text.
 */
export class AttachmentFitMailer implements Mailer {
  private limit: number;
  constructor(private inner: Mailer, private o: FitOptions) { this.limit = o.limit ?? MAIL_INLINE_LIMIT; }

  async send(m: Mail) {
    const atts = m.attachments ?? [];
    if (total(atts) <= this.limit) return this.inner.send(m);
    const log = this.o.log ?? ((s) => console.log(s));
    const shrunk = await this.shrink(atts);
    if (shrunk) { log(`[mail] attachments shrunk to fit (${total(atts)} -> ${total(shrunk)} bytes)`); return this.inner.send({ ...m, attachments: shrunk }); }
    return this.inner.send(await this.link(m, atts, log));
  }

  private async shrink(atts: MailAttachment[]): Promise<MailAttachment[] | null> {
    if (!atts.some((a) => a.contentType === "application/pdf")) return null;
    for (const step of SHRINK_LADDER) {
      try {
        const next = await Promise.all(atts.map(async (a) => (a.contentType === "application/pdf" ? { ...a, content: await shrinkPdfImages(a.content, step) } : a)));
        if (total(next) <= this.limit) return next;
      } catch { return null; } // a PDF we cannot read: go straight to the link
    }
    return null;
  }

  private async link(m: Mail, atts: MailAttachment[], log: (s: string) => void): Promise<Mail> {
    const now = (this.o.now ?? Date.now)();
    const expiresAt = now + (this.o.ttlDays ?? 14) * 86_400_000;
    const keep = [...atts], moved: { name: string; url: string }[] = [];
    // biggest first, until the rest fits
    for (const a of [...atts].sort((x, y) => y.content.byteLength - x.content.byteLength)) {
      if (total(keep) <= this.limit) break;
      const name = a.filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file";
      const key = `${LINK_PREFIX}${randomUUID()}/${name}`;
      await this.o.storage.put(key, a.content, a.contentType);
      keep.splice(keep.indexOf(a), 1);
      moved.push({ name: a.filename, url: `${this.o.appUrl}/api/files/${makeLinkToken(this.o.secret, key, expiresAt)}` });
    }
    log(`[mail] ${moved.length} attachment(s) sent as download link (too large to attach)`);
    const d = new Date(expiresAt);
    const de = d.toLocaleDateString("de-DE", { timeZone: "Europe/Madrid" }), es = d.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });
    const text = moved.map((x) => `${x.name}\nDownload / Descarga (DE: gültig bis ${de} · ES: válido hasta ${es}):\n${x.url}`).join("\n\n");
    const html = moved.map((x) => `<p>${esc(x.name)}<br><a href="${esc(x.url)}">Download / Descarga</a> (gültig bis ${de} · válido hasta ${es})</p>`).join("");
    return { ...m, attachments: keep.length ? keep : undefined, text: `${m.text}\n\n${text}`, html: m.html ? m.html + html : undefined };
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
