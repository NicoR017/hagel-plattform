import type { Config } from "./config";
import type { Mailer, Mail } from "./email";

export type TestAttachment = "none" | "small" | "large";
const SIZES: Record<Exclude<TestAttachment, "none">, number> = { small: 100 * 1024, large: 5 * 1024 * 1024 };

/** A valid one-page PDF padded (inside a stream) to about `size` bytes; the padding is not compressible by the mail chain. */
export function makeTestPdf(size: number): Uint8Array {
  const head = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    + "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
    + "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n";
  const page = "BT /F1 14 Tf 20 50 Td (PDR Hagel mail test) Tj ET";
  const pad = Math.max(0, size - head.length - 400);
  // a second, unused stream object carries the padding
  const body = `4 0 obj<</Length ${page.length}>>stream\n${page}\nendstream\nendobj\n6 0 obj<</Length ${pad}>>stream\n`;
  const tail = "\nendstream\nendobj\ntrailer<</Root 1 0 R/Size 7>>\n%%EOF\n";
  const enc = new TextEncoder();
  const [a, b, c] = [enc.encode(head + body), new Uint8Array(pad), enc.encode(tail)];
  for (let i = 0; i < pad; i++) b[i] = (i * 2654435761) >>> 24; // cheap deterministic noise
  const out = new Uint8Array(a.length + pad + c.length);
  out.set(a); out.set(b, a.length); out.set(c, a.length + pad);
  return out;
}

export interface MailTestResult { provider: Config["emailProvider"]; ms: number; ok: boolean; error?: string }

/** Sends one test mail through `mailer` (normally the ModeMailer, so staging redirects it) and reports the outcome. */
export async function runMailTest(mailer: Mailer, provider: Config["emailProvider"], o: { to: string; withAttachment?: TestAttachment; replyTo?: string }): Promise<MailTestResult> {
  const kind = o.withAttachment ?? "none";
  const mail: Mail = {
    to: o.to, subject: `PDR Hagel mail test (${provider}, attachment: ${kind})`,
    text: `Test e-mail sent via ${provider} at ${new Date().toISOString()}.`,
    html: `<p>Test e-mail sent via <b>${provider}</b> at ${new Date().toISOString()}.</p>`,
    ...(o.replyTo ? { replyTo: o.replyTo } : {}),
    ...(kind !== "none" ? { attachments: [{ filename: `mail-test-${kind}.pdf`, contentType: "application/pdf", content: makeTestPdf(SIZES[kind]) }] } : {}),
  };
  const t0 = Date.now();
  try { await mailer.send(mail); return { provider, ms: Date.now() - t0, ok: true }; }
  catch (e) { return { provider, ms: Date.now() - t0, ok: false, error: (e as Error).message }; }
}
