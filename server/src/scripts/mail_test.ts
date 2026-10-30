// npm run mail:test -- --to you@example.com [--attach none|small|large] [--reply-to a@b.c]
// Same test as POST /api/admin/mail-test, with the environment of the shell (GRAPH_*, EMAIL_*, MAIL_MODE...). Not written to the audit log (no database).
import { loadConfig } from "../config";
import { ModeMailer, makeBaseMailer } from "../email";
import { runMailTest, type TestAttachment } from "../mail_test";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const cfg = loadConfig();
const to = arg("to") ?? cfg.mailRedirectTo;
const kind = (arg("attach") ?? "none") as TestAttachment;
if (!to) { console.error("--to <address> is required"); process.exit(2); }
if (!["none", "small", "large"].includes(kind)) { console.error("--attach must be none, small or large"); process.exit(2); }

const mailer = new ModeMailer(makeBaseMailer(cfg), cfg.mailMode, cfg.mailRedirectTo);
console.log(`provider=${cfg.emailProvider} MAIL_MODE=${cfg.mailMode} to=${to} attach=${kind}`);
const r = await runMailTest(mailer, cfg.emailProvider, { to, withAttachment: kind, replyTo: arg("reply-to") });
console.log(r.ok ? `OK in ${r.ms} ms` : `FAILED in ${r.ms} ms: ${r.error}`);
process.exit(r.ok ? 0 : 1);
