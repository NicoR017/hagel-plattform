import { describe, expect, it } from "vitest";
import { GraphMailer, MAIL_INLINE_LIMIT } from "../src/email";
import { buildMime, encodeWords } from "../src/mime";
import { loadConfig } from "../src/config";

const from = { name: "PDR Hagel", address: "noreply-spain@pdr-team.com" };
const b64d = (s: string) => Buffer.from(s.replace(/\r\n/g, ""), "base64");
/** the base64 payload that follows the blank line after `header` in a MIME part */
const partAfter = (mime: string, header: RegExp) => { const m = mime.match(new RegExp(header.source + "[^]*?\\r\\n\\r\\n([^-]*)", "i")); return m ? m[m.length - 1] : ""; };

describe("buildMime", () => {
  const pdf = new Uint8Array(200_000).map((_, i) => (i * 7) % 256);
  const mime = buildMime(from, {
    to: ["a@x.test", "b@x.test"], cc: ["c@x.test"], bcc: ["d@x.test"], replyTo: "r@x.test", subject: "Informe 0742 GCK – größer", text: "Hola ñ", html: "<p>Hola ñ</p>",
    attachments: [{ filename: "Informe ñ.pdf", contentType: "application/pdf", content: pdf }],
  });
  it("has the headers, with the non-ascii subject encoded", () => {
    const head = mime.split("\r\n\r\n")[0];
    expect(head).toContain('From: "PDR Hagel" <noreply-spain@pdr-team.com>');
    expect(head).toContain("To: a@x.test, b@x.test");
    expect(head).toContain("Cc: c@x.test");
    expect(head).toContain("Bcc: d@x.test");
    expect(head).toContain("Reply-To: r@x.test");
    expect(head).toMatch(/^Subject: =\?UTF-8\?B\?/m);
    expect(head).toContain("MIME-Version: 1.0");
    expect(mime).not.toMatch(/[^\r]\n/); // only CRLF line ends
  });
  it("subject decodes back and every line is short", () => {
    const subj = mime.match(/^Subject: (.*)$/m)![1];
    const text = subj.split(" ").map((w) => b64d(w.replace(/^=\?UTF-8\?B\?|\?=$/g, "")).toString()).join("");
    expect(text).toBe("Informe 0742 GCK – größer");
    expect(Math.max(...mime.split("\r\n").map((l) => l.length))).toBeLessThanOrEqual(110);
  });
  it("carries text, html and the exact attachment bytes", () => {
    expect(b64d(partAfter(mime, /Content-Type: text\/plain; charset=utf-8/)).toString()).toBe("Hola ñ");
    expect(b64d(partAfter(mime, /Content-Type: text\/html; charset=utf-8/)).toString()).toBe("<p>Hola ñ</p>");
    expect(mime).toContain("Content-Disposition: attachment; filename=");
    expect(Buffer.compare(b64d(partAfter(mime, /Content-Type: application\/pdf; name=/)), Buffer.from(pdf))).toBe(0);
  });
  it("refuses header injection through subject or addresses", () => {
    const m = buildMime(from, { to: "a@x.test\r\nBcc: evil@x.test", subject: "hi\r\nBcc: evil2@x.test", text: "t" });
    expect(m.split("\r\n\r\n")[0]).not.toMatch(/^Bcc:/m);
  });
  it("plain ascii stays readable; long unicode is split in short words", () => {
    expect(encodeWords("Plain subject")).toBe("Plain subject");
    const long = encodeWords("ñ".repeat(100));
    expect(long.split(" ").every((w) => w.length <= 75)).toBe(true);
  });
});

describe("GraphMailer MIME path", () => {
  const ok = () => { const reqs: { url: string; headers: Record<string, string>; body: string }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      reqs.push({ url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body as string });
      return url.includes("/token") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })) : new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    return { f, sends: () => reqs.filter((r) => r.url.endsWith("/sendMail")) }; };
  const big = (n: number) => ({ to: "a@x.test", subject: "S", text: "T", attachments: [{ filename: "r.pdf", contentType: "application/pdf", content: new Uint8Array(n).fill(5) }] });
  const mk = (f: typeof fetch, maxBytes?: number) => new GraphMailer({ tenantId: "t", clientId: "c", clientSecret: "s", from: "noreply-spain@pdr-team.com", fetch: f, maxBytes });

  it("above the JSON limit and under the configured max: one sendMail, text/plain base64 MIME, Mail.Send only", async () => {
    const m = ok();
    await mk(m.f, 8 * 1024 * 1024).send(big(5 * 1024 * 1024));
    expect(m.sends()).toHaveLength(1);
    const s = m.sends()[0];
    expect(s.url).toBe("https://graph.microsoft.com/v1.0/users/noreply-spain%40pdr-team.com/sendMail");
    expect(s.headers["Content-Type"]).toBe("text/plain");
    const mime = Buffer.from(s.body, "base64").toString("latin1");
    expect(mime.startsWith("From: ")).toBe(true);
    expect(mime).toContain("To: a@x.test");
  });
  it("at or below the JSON limit it still uses the JSON form", async () => {
    const m = ok();
    await mk(m.f, 8 * 1024 * 1024).send(big(MAIL_INLINE_LIMIT));
    expect(m.sends()[0].headers["Content-Type"]).toBe("application/json");
  });
  it("over the configured max: refused before any call", async () => {
    const m = ok();
    await expect(mk(m.f, 8 * 1024 * 1024).send(big(8 * 1024 * 1024 + 1))).rejects.toThrow("too large");
    expect(m.sends()).toHaveLength(0);
  });
});

describe("MAIL_MAX_ATTACHMENT_MB", () => {
  it("default 2.5, bounded 2.5..25", () => {
    expect(loadConfig({}).mailMaxAttachmentBytes).toBe(2.5 * 1024 * 1024);
    expect(loadConfig({ MAIL_MAX_ATTACHMENT_MB: "8" }).mailMaxAttachmentBytes).toBe(8 * 1024 * 1024);
    for (const v of ["1", "30", "abc"]) expect(() => loadConfig({ MAIL_MAX_ATTACHMENT_MB: v })).toThrow("MAIL_MAX_ATTACHMENT_MB");
  });
});
