import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { ModeMailer, makeBaseMailer, parseFrom } from "./email";
import { seed } from "./seed";
import { seedStaging } from "./scripts/seed_staging";
import { storageFromEnv } from "./storage";
import { azureFromEnv } from "./azure";
import { citasFromConfig } from "./citas";
import { runDueInsurerReports } from "./insurer_report_send";
import { FakeCitas } from "./citas_fake";

const cfg = loadConfig();
const h = await createDb(cfg.databaseUrl);
const storage = storageFromEnv();
const mailer = new ModeMailer(makeBaseMailer(cfg), cfg.mailMode, cfg.mailRedirectTo);
console.log(`env=${cfg.appEnv} mail: provider=${cfg.emailProvider} from=${parseFrom(cfg.emailFrom).address} MAIL_MODE=${cfg.mailMode}${cfg.mailRedirectTo ? " -> " + cfg.mailRedirectTo : ""}`);
if (process.env.SEED_SUPERADMIN_EMAIL) await seed(h.db, { superadminEmail: process.env.SEED_SUPERADMIN_EMAIL, testSites: process.env.SEED_TEST_SITES === "1", storage });

// staging only, and only when asked: fake vehicles and test accounts (skipped for organisations that already have vehicles)
if (cfg.appEnv === "staging" && process.env.STAGING_SEED === "1" && process.env.STAGING_TEST_PASSWORD && process.env.SEED_SUPERADMIN_EMAIL) {
  console.log("staging seed:", await seedStaging(h.db, { password: process.env.STAGING_TEST_PASSWORD, superadminEmail: process.env.SEED_SUPERADMIN_EMAIL }));
}

function demoCitas() {
  const day = (add: number) => new Date(Date.now() + add * 86400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
  console.log("citas: FAKE appointments (CITAS_FAKE=1)");
  return new FakeCitas().demo(day(0), day(1));
}

const api = createApp({
  db: h.db, cfg, mailer, storage, az: azureFromEnv(), citas: process.env.CITAS_FAKE === "1" && cfg.appEnv !== "production" ? demoCitas() : citasFromConfig(cfg),
  ocr: { apiKey: process.env.ANTHROPIC_API_KEY ?? null, model: process.env.OCR_MODEL ?? "claude-sonnet-5-5", fetch: (url, init) => fetch(url, init) },
});
// V6: the automatic insurer reports, looked at every minute. One send per report and period is claimed in the database first, so a restart or a second server never sends twice.
if (process.env.INSURER_REPORTS_SCHEDULER !== "off") {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { const r = await runDueInsurerReports({ db: h.db, storage, mailer }); if (r.sent || r.failed) console.log("[insurer-reports]", JSON.stringify(r)); }
    catch (e) { console.error("[insurer-reports] FAILED", (e as Error).message); }
    finally { busy = false; }
  };
  setInterval(() => void tick(), 60_000);
}
const root = new Hono();
root.route("/api", api);

// The API also serves the built PWA (single domain, no CORS).
const dist = fileURLToPath(new URL("../../app/dist", import.meta.url));
if (existsSync(dist)) {
  root.use("/*", serveStatic({ root: "../app/dist" }));
  root.get("*", async (c) => c.html(await readFile(dist + "/index.html", "utf8")));
}

serve({ fetch: root.fetch, port: cfg.port }, (i) => console.log(`API listening on :${i.port} (db: ${h.kind})`));
process.on("SIGTERM", async () => { await h.close(); process.exit(0); });
