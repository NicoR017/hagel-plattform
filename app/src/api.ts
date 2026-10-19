import { getLang, t } from "./i18n";

const KEY = "hagel.auth";
export interface Auth { access_token: string; refresh_token: string }
let auth: Auth | null = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; } })();
let orgId: string | null = (() => { try { return localStorage.getItem("hagel.org"); } catch { return null; } })();

export const setAuth = (a: Auth | null) => {
  auth = a;
  try { a ? localStorage.setItem(KEY, JSON.stringify(a)) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
};
export const getAuth = () => auth;
export const setOrg = (id: string) => { orgId = id; try { localStorage.setItem("hagel.org", id); } catch { /* ignore */ } };
export const getOrg = () => orgId;

export class ApiError extends Error { constructor(public status: number, m: string) { super(m); } }

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!auth) return false;
  refreshing ??= (async () => {
    const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "content-type": "application/json", "x-lang": getLang() }, body: JSON.stringify({ refresh_token: auth!.refresh_token }) });
    if (!r.ok) { setAuth(null); return false; }
    setAuth(await r.json());
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** Every request carries the UI language (X-Lang), so server messages come back in the same language as the UI. */
export async function api<T = any>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-lang": getLang() };
  if (auth) headers.authorization = `Bearer ${auth.access_token}`;
  if (orgId) headers["x-org-id"] = orgId;
  let r: Response;
  try {
    r = await fetch("/api" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, t("networkError"));
  }
  if (r.status === 401 && retry && auth && (await refresh())) return api(method, path, body, false);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, typeof (data as any).error === "string" ? (data as any).error : t("invalidInput"));
  return data as T;
}
