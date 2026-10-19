// Background worker (separate Railway service, same codebase).
// Phase 2: nightly database backup. Azure sync, photo processing and report e-mails arrive in later phases.
import { runBackup, type BackupEnv } from "./backup";

const env = process.env;
const backupEnv = (): BackupEnv | null =>
  env.DATABASE_URL && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
    ? { DATABASE_URL: env.DATABASE_URL, S3_BUCKET: env.S3_BUCKET, S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY, S3_ENDPOINT: env.S3_ENDPOINT, S3_REGION: env.S3_REGION }
    : null;

async function backup() {
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
