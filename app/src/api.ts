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

/** Transport for the sync engine: returns HTTP errors instead of throwing, throws only when the network is unreachable. */
export async function httpFetch(method: string, path: string, body?: unknown, init: { org?: string; raw?: Blob | Uint8Array; contentType?: string; blob?: boolean } = {}, retry = true): Promise<{ status: number; data: any; blob?: Blob }> {
  const headers: Record<string, string> = { "x-lang": getLang() };
  if (init.raw !== undefined) headers["content-type"] = init.contentType ?? "application/octet-stream";
  else headers["content-type"] = "application/json";
  if (auth) headers.authorization = `Bearer ${auth.access_token}`;
  const org = init.org ?? orgId;
  if (org) headers["x-org-id"] = org;
  const r = await fetch("/api" + path, { method, headers, body: init.raw !== undefined ? (init.raw as BodyInit) : body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 && retry && auth && (await refresh())) return httpFetch(method, path, body, init, false);
  if (init.blob && r.ok) return { status: r.status, data: null, blob: await r.blob() };
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

/** Server-Sent Events over fetch (EventSource cannot send the Authorization header). Calls `onChanged` for every "changed" event; reconnects with backoff. */
export function startEvents(org: string, onChanged: () => void): () => void {
  const ctl = new AbortController();
  let stopped = false;
  (async () => {
    let wait = 1000;
    while (!stopped) {
      try {
        const r = await fetch("/api/sync/events", { headers: { authorization: `Bearer ${auth?.access_token ?? ""}`, "x-org-id": org }, signal: ctl.signal });
        if (r.status === 401 && (await refresh())) continue;
        if (!r.ok || !r.body) throw new Error(String(r.status));
        wait = 1000;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            if (/^event: changed$/m.test(block)) onChanged();
          }
        }
      } catch { /* offline or aborted */ }
      if (stopped) break;
      await new Promise((res) => setTimeout(res, wait));
      wait = Math.min(30000, wait * 2);
    }
  })();
  return () => { stopped = true; ctl.abort(); };
}
