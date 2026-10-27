import type { Config } from "./config";

export interface MailAttachment { filename: string; content: Uint8Array; contentType: string }
export interface Mail {
  to: string | string[]; subject: string; text: string; html?: string;
  /** replies go to the person who sent the report, not to the no-reply sender */
  replyTo?: string;
  attachments?: MailAttachment[];
}
export interface Mailer { send(m: Mail): Promise<void> }

/** Dev: prints the mail (including links) to the log. Only used when neither Graph nor Resend is configured. */
export class ConsoleMailer implements Mailer {
  async send(m: Mail) { console.log(`[mail] to=${m.to} subject=${m.subject}\n${m.text}\n`); }
}

/** Tests: keeps mails in memory. */
export class MemoryMailer implements Mailer {
  sent: Mail[] = [];
  /** simulate a provider outage */
  fail: Error | null = null;
  async send(m: Mail) { if (this.fail) throw this.fail; this.sent.push(m); }
  last() { return this.sent[this.sent.length - 1]; }
  /** First URL in the last mail to `to` */
  linkFor(to: string): string | undefined {
    const m = [...this.sent].reverse().find((x) => x.to === to);
    return m?.text.match(/https?:\/\/\S+/)?.[0];
  }
}

/** Resend HTTP API (no raw SMTP). */
export class ResendMailer implements Mailer {
  constructor(private apiKey: string, private from: string) {}
  async send(m: Mail) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from, to: Array.isArray(m.to) ? m.to : [m.to], subject: m.subject, text: m.text, html: m.html,
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) } : {}),
      }),
    });
    if (!res.ok) throw new Error(`E-mail provider error ${res.status}`);
  }
}

/** `Name <address>` (the Resend format) or a bare address. */
export function parseSender(from: string): { name: string | null; address: string } {
  const m = from.trim().match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  return m ? { name: m[1].trim() || null, address: m[2].trim() } : { name: null, address: from.trim() };
}

export interface GraphOptions {
  tenantId: string; clientId: string; clientSecret: string;
  /** EMAIL_FROM: the mailbox the mails are sent from (a shared mailbox the app has been given access to) */
  from: string;
  /** tests: replace the network, the clock and the waiting */
  fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>;
}

/** above this many bytes of attachments the one-shot sendMail request (about 4 MB of JSON) is too big: draft + upload sessions */
const GRAPH_INLINE_LIMIT = 3_000_000;
/** upload session chunks: a multiple of 320 KiB, below the 4 MB limit of one request */
const GRAPH_CHUNK = 320 * 1024 * 10;
const GRAPH_TRIES = 3;

/**
 * Microsoft Graph (client credentials, application permission Mail.Send): POST /users/{from}/sendMail.
 * Needs no library: fetch is enough. The secret and the token never appear in an error or a log.
 */
export class GraphMailer implements Mailer {
  private token: { value: string; expiresAt: number } | null = null;
  private tokenRequest: Promise<string> | null = null;
  private readonly sender: { name: string | null; address: string };
  private readonly http: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(private o: GraphOptions) {
    this.sender = parseSender(o.from);
    this.http = o.fetch ?? ((...a) => fetch(...a));
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async getToken(force = false): Promise<string> {
    if (force) this.token = null;
    if (this.token && this.now() < this.token.expiresAt) return this.token.value;
    // several mails in parallel share one token request
    this.tokenRequest ??= this.fetchToken().finally(() => { this.tokenRequest = null; });
    return this.tokenRequest;
  }
  private async fetchToken(): Promise<string> {
    const res = await this.http(`https://login.microsoftonline.com/${encodeURIComponent(this.o.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.o.clientId, client_secret: this.o.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }).toString(),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !j.access_token) throw new Error(`Graph token error ${res.status}${j.error ? " " + j.error : ""}`);
    // renewed 5 minutes before it expires
    this.token = { value: j.access_token, expiresAt: this.now() + Math.max(0, (j.expires_in ?? 3600) - 300) * 1000 };
    return j.access_token;
  }

  /** one Graph call: a new token once on 401, up to 3 tries on 429 / 503 (Retry-After respected) */
  private async call(method: string, path: string, body?: unknown, okStatus: number[] = [200, 201, 202, 204]): Promise<Response> {
    let refreshed = false;
    for (let attempt = 1; ; attempt++) {
      const res = await this.http(`https://graph.microsoft.com/v1.0${path}`, {
        method,
        headers: { Authorization: `Bearer ${await this.getToken()}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (okStatus.includes(res.status)) return res;
      if (res.status === 401 && !refreshed) { refreshed = true; await this.getToken(true); attempt--; continue; }
      if ((res.status === 429 || res.status === 503) && attempt < GRAPH_TRIES) { await this.sleep(retryAfterMs(res, attempt)); continue; }
      const j = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
      throw new Error(`Graph error ${res.status}${j.error?.code ? " " + j.error.code : ""}`);
    }
  }

  private message(m: Mail) {
    return {
      subject: m.subject,
      body: m.html ? { contentType: "HTML", content: m.html } : { contentType: "Text", content: m.text },
      toRecipients: (Array.isArray(m.to) ? m.to : [m.to]).map((address) => ({ emailAddress: { address } })),
      ...(m.replyTo ? { replyTo: [{ emailAddress: { address: m.replyTo } }] } : {}),
      // the display name of EMAIL_FROM, always on the mailbox's own address (Graph refuses another sender)
      ...(this.sender.name ? { from: { emailAddress: { name: this.sender.name, address: this.sender.address } } } : {}),
    };
  }

  async send(m: Mail) {
    const user = `/users/${encodeURIComponent(this.sender.address)}`;
    const files = m.attachments ?? [];
    const attachment = (a: MailAttachment) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType, contentBytes: Buffer.from(a.content).toString("base64") });
    if (files.reduce((n, a) => n + a.content.byteLength, 0) <= GRAPH_INLINE_LIMIT) {
      await this.call("POST", `${user}/sendMail`, { message: { ...this.message(m), ...(files.length ? { attachments: files.map(attachment) } : {}) }, saveToSentItems: true }, [202]);
      return;
    }
    // too big for one request: a draft without attachments, then the attachments one by one, then send
    const draft = (await (await this.call("POST", `${user}/messages`, this.message(m), [201])).json()) as { id: string };
    const msg = `${user}/messages/${encodeURIComponent(draft.id)}`;
    try {
      for (const a of files) {
        if (a.content.byteLength <= GRAPH_INLINE_LIMIT) { await this.call("POST", `${msg}/attachments`, attachment(a), [201]); continue; }
        const session = (await (await this.call("POST", `${msg}/attachments/createUploadSession`, { AttachmentItem: { attachmentType: "file", name: a.filename, size: a.content.byteLength, contentType: a.contentType } }, [200, 201])).json()) as { uploadUrl: string };
        await this.upload(session.uploadUrl, a.content);
      }
      await this.call("POST", `${msg}/send`, undefined, [202]);
    } catch (e) {
      await this.call("DELETE", msg, undefined, [204]).catch(() => undefined); // no half-built draft left in the mailbox
      throw e;
    }
  }

  /** chunks of an upload session; the upload URL carries its own authorisation (no Authorization header) */
  private async upload(url: string, bytes: Uint8Array) {
    for (let start = 0; start < bytes.byteLength; start += GRAPH_CHUNK) {
      const end = Math.min(start + GRAPH_CHUNK, bytes.byteLength);
      for (let attempt = 1; ; attempt++) {
        const res = await this.http(url, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${start}-${end - 1}/${bytes.byteLength}` }, body: bytes.subarray(start, end) as unknown as BodyInit });
        if (res.ok) break;
        if ((res.status === 429 || res.status === 503) && attempt < GRAPH_TRIES) { await this.sleep(retryAfterMs(res, attempt)); continue; }
        throw new Error(`Graph upload error ${res.status}`);
      }
    }
  }
}

/** Retry-After in seconds (or a date), at most a minute; without it 2 s, 4 s ... */
function retryAfterMs(res: Response, attempt: number): number {
  const h = res.headers.get("Retry-After");
  const secs = h === null ? NaN : /^\d+$/.test(h.trim()) ? Number(h) : (Date.parse(h) - Date.now()) / 1000;
  return Math.min(60, Number.isFinite(secs) && secs >= 0 ? secs : 2 ** attempt) * 1000;
}

/** The mailer the configuration asks for, always behind the MAIL_MODE safety switch. */
export function buildMailer(cfg: Pick<Config, "emailProvider" | "emailApiKey" | "emailFrom" | "graphTenantId" | "graphClientId" | "graphClientSecret" | "mailMode" | "mailRedirectTo">): Mailer {
  const inner: Mailer = cfg.emailProvider === "graph" ? new GraphMailer({ tenantId: cfg.graphTenantId!, clientId: cfg.graphClientId!, clientSecret: cfg.graphClientSecret!, from: cfg.emailFrom })
    : cfg.emailProvider === "resend" ? new ResendMailer(cfg.emailApiKey!, cfg.emailFrom)
    : new ConsoleMailer();
  return new ModeMailer(inner, cfg.mailMode, cfg.mailRedirectTo);
}

/**
 * Mail safety switch (MAIL_MODE). `off` only logs, `redirect` sends everything to one address with the original
 * recipients in the subject and at the top of the body, `live` passes the mail through unchanged.
 */
export class ModeMailer implements Mailer {
  constructor(private inner: Mailer, private mode: "off" | "redirect" | "live", private redirectTo: string | null) {}
  async send(m: Mail) {
    if (this.mode === "live") return this.inner.send(m);
    const orig = (Array.isArray(m.to) ? m.to : [m.to]).join(", ");
    if (this.mode === "off") { console.log(`[mail:off] not sent: to=${orig} subject=${m.subject}`); return; }
    if (!this.redirectTo) throw new Error("MAIL_REDIRECT_TO missing");
    return this.inner.send({
      ...m, to: this.redirectTo, subject: `[STAGING → ${orig}] ${m.subject}`,
      text: `[STAGING] Original recipients: ${orig}

${m.text}`,
      html: m.html ? `<p><b>[STAGING] Original recipients: ${orig.replace(/</g, "&lt;")}</b></p>${m.html}` : undefined,
    });
  }
}
