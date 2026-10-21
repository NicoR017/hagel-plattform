// Local copy of the staging environment: in-memory database, fake data, no real e-mails, no Azure, no bucket.
//   node infra/scripts/local_staging.mjs            (needs `npm run build -w @hagel/app` once)
// Super-admin: nicolas.rasteiro@pdr-team.de (or SEED_SUPERADMIN_EMAIL), same password. Opens on http://localhost:3100 ; test accounts: de.chef@staging.test, de.assessor@staging.test, de.tech@staging.test (and es.*), password below.
import { spawn } from "node:child_process";
const env = {
  ...process.env, PORT: "3100", APP_ENV: "staging", MAIL_MODE: "off", APP_URL: "http://localhost:3100", STAGING_SEED: "1",
  SEED_SUPERADMIN_EMAIL: process.env.SEED_SUPERADMIN_EMAIL ?? "nicolas.rasteiro@pdr-team.de", STAGING_TEST_PASSWORD: process.env.STAGING_TEST_PASSWORD ?? "staging-local-test-1",
};
for (const k of ["DATABASE_URL", "EMAIL_API_KEY", "AZURE_STORAGE_SAS", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT"]) delete env[k];
spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "start", "-w", "@hagel/server"], { stdio: "inherit", env, shell: process.platform === "win32" });
