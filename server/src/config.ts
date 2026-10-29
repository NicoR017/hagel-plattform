export interface Config {
  databaseUrl: string | null;
  appUrl: string;
  sessionSecret: string;
  emailApiKey: string | null;
  emailFrom: string;
  /** Microsoft Graph credentials (all three or none) */
  graphTenantId: string | null;
  graphClientId: string | null;
  graphClientSecret: string | null;
  /** graph if GRAPH_* are set, else resend if EMAIL_API_KEY is set, else console */
  emailProvider: EmailProvider;
  port: number;
  accessTtlSec: number;
  refreshTtlDays: number;
  inviteTtlHours: number;
  loginTtlMinutes: number;
  /** production | staging | development: staging shows a banner and never sends real e-mails */
  appEnv: AppEnv;
  /** off = nothing is sent (logged only); redirect = every mail goes to `mailRedirectTo`; live = real recipients */
  mailMode: MailMode;
  mailRedirectTo: string | null;
  /** new UI is the default (users can still open `?ui=legacy`) */
  uiV3Default: boolean;
  /** PDR Citas (read-only API). Both must be set, otherwise the feature is hidden. The key never leaves the server. */
  citasApiUrl: string | null;
  citasApiKey: string | null;
}

export type AppEnv = "production" | "staging" | "development";
export type MailMode = "off" | "redirect" | "live";
export type EmailProvider = "graph" | "resend" | "console";

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const secret = env.SESSION_SECRET ?? "";
  if (env.NODE_ENV === "production" && secret.length < 32) throw new Error("SESSION_SECRET must be set (>= 32 chars) in production");
  const appEnv: AppEnv = env.APP_ENV === "staging" ? "staging" : env.APP_ENV === "production" || env.NODE_ENV === "production" ? "production" : "development";
  if (env.MAIL_MODE && !["off", "redirect", "live"].includes(env.MAIL_MODE)) throw new Error("MAIL_MODE must be off, redirect or live");
  // unset: staging is silent (never real recipients by accident), everything else behaves as before (live)
  const mailMode = (env.MAIL_MODE as MailMode | undefined) ?? (appEnv === "staging" ? "off" : "live");
  const mailRedirectTo = env.MAIL_REDIRECT_TO?.trim() || null;
  if (mailMode === "redirect" && !mailRedirectTo) throw new Error("MAIL_MODE=redirect needs MAIL_REDIRECT_TO");
  if (appEnv === "staging" && mailMode === "live") throw new Error("APP_ENV=staging must not use MAIL_MODE=live");
  const graph = [env.GRAPH_TENANT_ID, env.GRAPH_CLIENT_ID, env.GRAPH_CLIENT_SECRET].map((v) => v?.trim() || null);
  const graphSet = graph.filter(Boolean).length;
  if (graphSet > 0 && graphSet < 3) throw new Error("GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET must be set together");
  if (graphSet === 3 && !env.EMAIL_FROM?.trim()) throw new Error("GRAPH_* needs EMAIL_FROM (the shared mailbox address)");
  const emailProvider: EmailProvider = graphSet === 3 ? "graph" : env.EMAIL_API_KEY ? "resend" : "console";
  return {
    databaseUrl: env.DATABASE_URL ?? null,
    appUrl: (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    sessionSecret: secret || "dev-only-secret-dev-only-secret-dev-only",
    emailApiKey: env.EMAIL_API_KEY ?? null,
    emailFrom: env.EMAIL_FROM?.trim() || "PDR Hagel <noreply@pdr-team.de>",
    graphTenantId: graph[0], graphClientId: graph[1], graphClientSecret: graph[2], emailProvider,
    port: Number(env.PORT ?? 3000),
    accessTtlSec: 15 * 60,
    refreshTtlDays: 90,
    inviteTtlHours: 48,
    loginTtlMinutes: 20,
    appEnv, mailMode, mailRedirectTo,
    uiV3Default: (env.UI_V3_DEFAULT ?? "true") !== "false",
    // the base address of the site; the path of the API is added by the client (pasting the full API address works too)
    citasApiUrl: env.CITAS_API_URL?.trim().replace(/\/+$/, "").replace(/\/api\/v1\/external$/, "") || null,
    citasApiKey: env.CITAS_API_KEY?.trim() || null,
  };
}
