import { randomUUID } from "node:crypto";
import type { Mail } from "./email";

const CRLF = "\r\n";
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim(); // header values must never contain a line break
const b64 = (b: Uint8Array | string) => Buffer.from(b).toString("base64");
const wrap76 = (s: string) => s.replace(/(.{76})/g, `$1${CRLF}`).replace(/(\r\n)+$/, "");

/** RFC 2047 encoded words (UTF-8, base64), split on character boundaries so each word stays short. */
export function encodeWords(s: string): string {
  s = oneLine(s);
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words: string[] = [];
  let cur = "";
  for (const ch of s) {
    if (Buffer.byteLength(cur + ch) > 42) { words.push(cur); cur = ""; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${b64(w)}?=`).join(" ");
}
const quoted = (s: string) => `"${encodeWords(s).replace(/(["\\])/g, "\\$1")}"`;
const textPart = (type: string, body: string) =>
  [`Content-Type: ${type}; charset=utf-8`, "Content-Transfer-Encoding: base64", "", wrap76(b64(body))].join(CRLF);

/**
 * A complete RFC 5322 message: text (+ html) and the attachments, everything base64. Used when the attachments are too big for the JSON form of
 * Graph's sendMail; the MIME form is posted to the same operation, so it needs the same Mail.Send permission only.
 */
export function buildMime(from: { name: string | null; address: string }, m: Mail): string {
  const outer = `=_mixed_${randomUUID()}`, inner = `=_alt_${randomUUID()}`;
  const list = (x: string[]) => x.map(oneLine).join(", ");
  const head = [
    `From: ${from.name ? `${quoted(from.name)} <${from.address}>` : from.address}`,
    `To: ${list(Array.isArray(m.to) ? m.to : [m.to])}`,
    ...(m.cc?.length ? [`Cc: ${list(m.cc)}`] : []),
    ...(m.bcc?.length ? [`Bcc: ${list(m.bcc)}`] : []),
    ...(m.replyTo ? [`Reply-To: ${oneLine(m.replyTo)}`] : []),
    `Subject: ${encodeWords(m.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${outer}"`,
  ];
  const body = m.html
    ? [`Content-Type: multipart/alternative; boundary="${inner}"`, "", `--${inner}`, textPart("text/plain", m.text), `--${inner}`, textPart("text/html", m.html), `--${inner}--`].join(CRLF)
    : textPart("text/plain", m.text);
  const parts = [`--${outer}`, body];
  for (const a of m.attachments ?? []) {
    const name = quoted(a.filename);
    parts.push(`--${outer}`, [`Content-Type: ${oneLine(a.contentType)}; name=${name}`, `Content-Disposition: attachment; filename=${name}`, "Content-Transfer-Encoding: base64", "", wrap76(b64(a.content))].join(CRLF));
  }
  parts.push(`--${outer}--`, "");
  return head.join(CRLF) + CRLF + CRLF + parts.join(CRLF);
}
