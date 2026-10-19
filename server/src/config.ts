export interface Config {
  databaseUrl: string | null;
  appUrl: string;
  sessionSecret: string;
  emailApiKey: string | null;
  emailFrom: string;
  port: number;
  accessTtlSec: number;
  refreshTtlDays: number;
  inviteTtlHours: number;
  loginTtlMinutes: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const secret = env.SESSION_SECRET ?? "";
  if (env.NODE_ENV === "production" && secret.length < 32) throw new Error("SESSION_SECRET must be set (>= 32 chars) in production");
  return {
    databaseUrl: env.DATABASE_URL ?? null,
    appUrl: (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    sessionSecret: secret || "dev-only-secret-dev-only-secret-dev-only",
    emailApiKey: env.EMAIL_API_KEY ?? null,
    emailFrom: env.EMAIL_FROM ?? "PDR Hagel <noreply@pdr-team.de>",
    port: Number(env.PORT ?? 3000),
    accessTtlSec: 15 * 60,
    refreshTtlDays: 90,
    inviteTtlHours: 48,
    loginTtlMinutes: 20,
  };
}
