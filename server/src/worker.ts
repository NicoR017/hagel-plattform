// Background worker (separate Railway service, same codebase): nightly database backup and the Azure -> database mirror.
import { azureFromEnv } from "./azure";
import { syncAzure } from "./azure_sync";
import { runBackup, type BackupEnv } from "./backup";
import { createDb } from "./db";

const env = process.env;
const backupEnv = (): BackupEnv | null =>
  env.DATABASE_URL && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
    ? { DATABASE_URL: env.DATABASE_URL, S3_BUCKET: env.S3_BUCKET, S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY, S3_ENDPOINT: env.S3_ENDPOINT, S3_REGION: env.S3_REGION }
    : null;

async function backup() {
  // staging is rebuilt from production whenever needed: it never writes backups (and never into the production bucket)
  if (env.APP_ENV === "staging") return console.log("[backup] skipped: APP_ENV=staging");
  const e = backupEnv();
  if (!e) return console.warn("[backup] skipped: DATABASE_URL / S3_* not set");
  try { console.log("[backup] done", await runBackup(e)); } catch (err) { console.error("[backup] FAILED", err); }
}

/** Runs `fn` every day at hh:mm UTC. */
function daily(hh: number, mm: number, fn: () => Promise<void>) {
  const next = () => { const d = new Date(); d.setUTCHours(hh, mm, 0, 0); if (d <= new Date()) d.setUTCDate(d.getUTCDate() + 1); return d.getTime() - Date.now(); };
  const loop = () => setTimeout(async () => { await fn(); loop(); }, next());
  loop();
}

console.log("worker started");
daily(2, 30, backup);
if (env.BACKUP_ON_START === "1") void backup();

// Azure mirror: every few minutes, never overlapping, never fatal (the next run simply retries).
const az = azureFromEnv();
if (!az) console.warn("[azure] AZURE_STORAGE_SAS not set: Colibri import from Azure is disabled");
else if (env.DATABASE_URL) {
  console.log("[azure] SAS expires:", az.expiresAt?.()?.toISOString() ?? "unknown");
  const minutes = Math.max(1, Number(env.AZURE_SYNC_MINUTES ?? 3));
  const h = await createDb(env.DATABASE_URL, { migrate: false }); // the API owns the migrations
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { const s = await syncAzure(h.db, az, { initialDays: Number(env.AZURE_INITIAL_DAYS ?? 30) }); console.log("[azure] sync ok", JSON.stringify(s)); }
    catch (e) { console.error("[azure] sync FAILED", (e as Error).message); }
    finally { running = false; }
  };
  void tick();
  setInterval(() => void tick(), minutes * 60_000);
}
