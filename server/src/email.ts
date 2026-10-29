import type { Config } from "./config";

export interface MailAttachment { filename: string; content: Uint8Array; contentType: string }
export interface Mail {
  to: string | string[]; subject: string; text: string; html?: string;
  /** copies (the insurer reports: a visible Cc, and an internal Bcc) */
  cc?: string[]; bcc?: string[];
  /** replies go to the person who sent the report, not to the no-reply sender */
  replyTo?: string;
  attachments?: MailAttachment[];
}
export interface Mailer { send(m: Mail): Promise<void> }

/** Dev: prints the mail (including links) to the log. Used when neither GRAPH_* nor EMAIL_API_KEY is set. */
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
        ...(m.cc?.length ? { cc: m.cc } : {}), ...(m.bcc?.length ? { bcc: m.bcc } : {}),
        ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) } : {}),
      }),
    });
    if (!res.ok) throw new Error(`E-mail provider error ${res.status}`);
  }
}

export interface GraphOptions {
  tenantId: string; clientId: string; clientSecret: string;
  /** EMAIL_FROM: `address` or `Name <address>`; the mailbox that sends is the address */
  from: string;
  fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number;
}

/** Above this total attachment size sendMail (~4 MB of JSON) is too small: a draft + upload sessions are used instead. */
const GRAPH_INLINE_LIMIT = 3 * 1024 * 1024;
/** upload session chunks must be multiples of 320 KiB */
const GRAPH_CHUNK = 320 * 1024 * 9;
const GRAPH_MAX_TRIES = 3;

/** Splits `Name <a@b.c>` (or a bare address) into name and address. */
export function parseFrom(from: string): { name: string | null; address: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^<>\s]+)>\s*$/);
  return m ? { name: m[1].trim() || null, address: m[2] } : { name: null, address: from.trim() };
}

/** Microsoft Graph (client credentials, `Mail.Send` application permission): POST /users/{from}/sendMail. No SDK, plain fetch. */
export class GraphMailer implements Mailer {
  readonly from: { name: string | null; address: string };
  private token: { value: string; expiresAt: number } | null = null;
  private tokenInflight: Promise<string> | null = null;
  private doFetch: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  constructor(private o: GraphOptions) {
    this.from = parseFrom(o.from);
    this.doFetch = o.fetch ?? ((...a) => fetch(...a));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  private getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return Promise.resolve(this.token.value);
    // one token request in flight, shared by parallel sends
    this.tokenInflight ??= this.fetchToken().finally(() => { this.tokenInflight = null; });
    return this.tokenInflight;
  }

  private async fetchToken(): Promise<string> {
    const res = await this.doFetch(`https://login.microsoftonline.com/${encodeURIComponent(this.o.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.o.clientId, client_secret: this.o.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }).toString(),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !j.access_token) throw new Error(`Graph token error ${res.status} ${j.error ?? "unknown"}`);
    this.token = { value: j.access_token, expiresAt: this.now() + Math.max(0, (j.expires_in ?? 3600) - 300) * 1000 };
    return j.access_token;
  }

  /** One Graph call with the retry rules: 401 -> new token once, 429/503 -> Retry-After, 3 tries. Errors carry status + Graph code only. */
  private async call(op: string, url: string, init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array; auth?: boolean }, ok: number[]): Promise<Response> {
    let renewed = false;
    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = { ...init.headers };
      if (init.auth !== false) headers.Authorization = `Bearer ${await this.getToken()}`;
      const res = await this.doFetch(url, { method: init.method, headers, body: init.body as BodyInit | undefined });
      if (ok.includes(res.status)) return res;
      if (res.status === 401 && init.auth !== false && !renewed) { renewed = true; this.token = null; attempt--; continue; }
      if ((res.status === 429 || res.status === 503) && attempt < GRAPH_MAX_TRIES) {
        const ra = Number(res.headers.get("retry-after"));
        await this.sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra : 2 ** attempt, 60) * 1000);
        continue;
      }
      const j = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
      throw new Error(`Graph ${op} error ${res.status} ${j.error?.code ?? "unknown"}`);
    }
  }

  private message(m: Mail) {
    const addr = (a: string) => ({ emailAddress: { address: a } });
    const list = (x: string | string[]) => (Array.isArray(x) ? x : [x]).map(addr);
    return {
      subject: m.subject,
      body: m.html ? { contentType: "HTML", content: m.html } : { contentType: "Text", content: m.text },
      toRecipients: list(m.to),
      ...(m.cc?.length ? { ccRecipients: list(m.cc) } : {}),
      ...(m.bcc?.length ? { bccRecipients: list(m.bcc) } : {}),
      ...(m.replyTo ? { replyTo: [addr(m.replyTo)] } : {}),
      // the display name only ever goes with the mailbox address itself
      ...(this.from.name ? { from: { emailAddress: { name: this.from.name, address: this.from.address } } } : {}),
    };
  }

  private fileAttachment(a: MailAttachment) {
    return { "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType, contentBytes: Buffer.from(a.content).toString("base64") };
  }

  async send(m: Mail) {
    const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.from.address)}`;
    const json = { "Content-Type": "application/json" };
    const atts = m.attachments ?? [];
    if (atts.reduce((n, a) => n + a.content.byteLength, 0) <= GRAPH_INLINE_LIMIT) {
      const msg = { ...this.message(m), ...(atts.length ? { attachments: atts.map((a) => this.fileAttachment(a)) } : {}) };
      await this.call("sendMail", `${base}/sendMail`, { method: "POST", headers: json, body: JSON.stringify({ message: msg, saveToSentItems: true }) }, [202]);
      return;
    }
    // big attachments: draft, attach (upload session above 3 MB), send
    const draft = (await (await this.call("createDraft", `${base}/messages`, { method: "POST", headers: json, body: JSON.stringify(this.message(m)) }, [201])).json()) as { id: string };
    const id = encodeURIComponent(draft.id);
    try {
      for (const a of atts) {
        if (a.content.byteLength <= GRAPH_INLINE_LIMIT) {
          await this.call("addAttachment", `${base}/messages/${id}/attachments`, { method: "POST", headers: json, body: JSON.stringify(this.fileAttachment(a)) }, [201]);
          continue;
        }
        const total = a.content.byteLength;
        const s = (await (await this.call("uploadSession", `${base}/messages/${id}/attachments/createUploadSession`, {
          method: "POST", headers: json, body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: a.filename, size: total, contentType: a.contentType } }),
        }, [200, 201])).json()) as { uploadUrl: string };
        for (let start = 0; start < total; start += GRAPH_CHUNK) {
          const chunk = a.content.subarray(start, Math.min(start + GRAPH_CHUNK, total));
          // the upload URL is pre-authorised: no bearer token
          await this.call("uploadChunk", s.uploadUrl, {
            method: "PUT", auth: false, body: chunk,
            headers: { "Content-Type": "application/octet-stream", "Content-Length": String(chunk.byteLength), "Content-Range": `bytes ${start}-${start + chunk.byteLength - 1}/${total}` },
          }, [200, 201, 204]);
        }
      }
      await this.call("sendDraft", `${base}/messages/${id}/send`, { method: "POST" }, [202]);
    } catch (e) {
      // do not leave a half-built draft in the shared mailbox
      await this.call("deleteDraft", `${base}/messages/${id}`, { method: "DELETE" }, [204]).catch(() => undefined);
      throw e;
    }
  }
}

/** The provider is chosen by the environment only: GRAPH_* -> Graph, else EMAIL_API_KEY -> Resend, else console. */
export function makeBaseMailer(cfg: Pick<Config, "emailProvider" | "emailApiKey" | "emailFrom" | "graphTenantId" | "graphClientId" | "graphClientSecret">): Mailer {
  if (cfg.emailProvider === "graph") return new GraphMailer({ tenantId: cfg.graphTenantId!, clientId: cfg.graphClientId!, clientSecret: cfg.graphClientSecret!, from: cfg.emailFrom });
  if (cfg.emailProvider === "resend") return new ResendMailer(cfg.emailApiKey!, cfg.emailFrom);
  return new ConsoleMailer();
}

/**
 * Mail safety switch (MAIL_MODE). `off` only logs, `redirect` sends everything to one address with the original
 * recipients in the subject and at the top of the body, `live` passes the mail through unchanged.
 */
export class ModeMailer implements Mailer {
  constructor(private inner: Mailer, private mode: "off" | "redirect" | "live", private redirectTo: string | null) {}
  async send(m: Mail) {
    if (this.mode === "live") return this.inner.send(m);
    // the copies are part of "who it was meant for": they are listed, and never sent in a mode that does not reach real people
    const orig = [(Array.isArray(m.to) ? m.to : [m.to]).join(", "), m.cc?.length ? `Cc: ${m.cc.join(", ")}` : "", m.bcc?.length ? `Bcc: ${m.bcc.join(", ")}` : ""].filter(Boolean).join(" · ");
    if (this.mode === "off") { console.log(`[mail:off] not sent: to=${orig} subject=${m.subject}`); return; }
    if (!this.redirectTo) throw new Error("MAIL_REDIRECT_TO missing");
    return this.inner.send({
      ...m, to: this.redirectTo, cc: undefined, bcc: undefined, subject: `[STAGING → ${orig}] ${m.subject}`,
      text: `[STAGING] Original recipients: ${orig}

${m.text}`,
      html: m.html ? `<p><b>[STAGING] Original recipients: ${orig.replace(/</g, "&lt;")}</b></p>${m.html}` : undefined,
    });
  }
}
