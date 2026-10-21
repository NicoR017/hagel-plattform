import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { ConsoleMailer, ModeMailer, ResendMailer } from "./email";
import { seed } from "./seed";
import { storageFromEnv } from "./storage";
import { azureFromEnv } from "./azure";

const cfg = loadConfig();
const h = await createDb(cfg.databaseUrl);
const storage = storageFromEnv();
const mailer = new ModeMailer(cfg.emailApiKey ? new ResendMailer(cfg.emailApiKey, cfg.emailFrom) : new ConsoleMailer(), cfg.mailMode, cfg.mailRedirectTo);
console.log(`env=${cfg.appEnv} mail=${cfg.mailMode}${cfg.mailRedirectTo ? " -> " + cfg.mailRedirectTo : ""}`);
if (process.env.SEED_SUPERADMIN_EMAIL) await seed(h.db, { superadminEmail: process.env.SEED_SUPERADMIN_EMAIL, testSites: process.env.SEED_TEST_SITES === "1", storage });

const api = createApp({
  db: h.db, cfg, mailer, storage, az: azureFromEnv(),
  ocr: { apiKey: process.env.ANTHROPIC_API_KEY ?? null, model: process.env.OCR_MODEL ?? "claude-sonnet-5-5", fetch: (url, init) => fetch(url, init) },
});
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
