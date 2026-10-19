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
    const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: auth!.refresh_token }) });
    if (!r.ok) { setAuth(null); return false; }
    setAuth(await r.json());
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = any>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = `Bearer ${auth.access_token}`;
  if (orgId) headers["x-org-id"] = orgId;
  const r = await fetch("/api" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 && retry && auth && (await refresh())) return api(method, path, body, false);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (data as any).error ?? `HTTP ${r.status}`);
  return data as T;
}
