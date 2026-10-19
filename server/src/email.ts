export interface MailAttachment { filename: string; content: Uint8Array; contentType: string }
export interface Mail {
  to: string | string[]; subject: string; text: string; html?: string;
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
        ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) } : {}),
      }),
    });
    if (!res.ok) throw new Error(`E-mail provider error ${res.status}`);
  }
}
