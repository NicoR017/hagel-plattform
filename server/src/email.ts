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

/** Dev: prints the mail (including links) to the log. Never used when EMAIL_API_KEY is set. */
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
