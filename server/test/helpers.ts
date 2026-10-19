import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createDb, type DbHandle } from "../src/db";
import { MemoryMailer } from "../src/email";
import { Hub } from "../src/hub";
import { MemoryStorage } from "../src/storage";
import { seed } from "../src/seed";
import type { FetchLike } from "../src/ocr";

export interface Ctx {
  h: DbHandle; app: ReturnType<typeof createApp>; mailer: MemoryMailer; storage: MemoryStorage; hub: Hub;
  orgDE: string; orgES: string; roleId: Record<string, string>; superToken: string;
  ocrCalls: { body: string }[]; ocrAnswer: { current: unknown; status: number };
}

interface Opts { token?: string; org?: string; body?: unknown; lang?: string; raw?: Uint8Array; contentType?: string }

export async function setup(): Promise<Ctx> {
  const h = await createDb(process.env.TEST_DATABASE_URL ?? null);
  const mailer = new MemoryMailer();
  const storage = new MemoryStorage();
  const hub = new Hub();
  const ocrCalls: { body: string }[] = [];
  const ocrAnswer = { current: {} as unknown, status: 200 };
  const fetchMock: FetchLike = async (_url, init) => {
    ocrCalls.push({ body: init.body });
    return { ok: ocrAnswer.status === 200, status: ocrAnswer.status, json: async () => ocrAnswer.current };
  };
  const app = createApp({
    db: h.db, cfg: loadConfig({}), mailer, storage, hub,
    limits: { requestLink: 10000, verify: 10000, accept: 10000, refresh: 10000 },
    ocr: { apiKey: "test-key", model: "test-model", fetch: fetchMock },
  });
  const s = await seed(h.db, { superadminEmail: "nicolas@example.test", testSites: true, storage });
  const ctx = { h, app, mailer, storage, hub, orgDE: s.orgs[0].id, orgES: s.orgs[1].id, roleId: {}, superToken: "", ocrCalls, ocrAnswer } as Ctx;
  ctx.superToken = (await login(ctx, "nicolas@example.test")).access_token;
  ctx.roleId = Object.fromEntries(((await call(ctx, "GET", "/admin/roles", { token: ctx.superToken, org: ctx.orgES })).body as { key: string; id: string }[]).map((r) => [r.key, r.id]));
  return ctx;
}

export async function call(ctx: Ctx, method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = {};
  if (o.raw === undefined) headers["content-type"] = "application/json";
  else headers["content-type"] = o.contentType ?? "application/octet-stream";
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.org) headers["x-org-id"] = o.org;
  if (o.lang) headers["x-lang"] = o.lang;
  const body = o.raw !== undefined ? o.raw : o.body === undefined ? undefined : JSON.stringify(o.body);
  const res = await ctx.app.request(path, { method, headers, body: body as BodyInit | undefined });
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(buf);
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json, bytes: buf, headers: res.headers };
}

export const tokenFromLink = (link: string) => new URL(link).searchParams.get("token")!;

export async function login(ctx: Ctx, email: string) {
  ctx.mailer.sent.length = 0;
  await call(ctx, "POST", "/auth/request-link", { body: { email } });
  const r = await call(ctx, "POST", "/auth/verify", { body: { token: tokenFromLink(ctx.mailer.linkFor(email)!) } });
  expect(r.status).toBe(200);
  return r.body as { access_token: string; refresh_token: string };
}

export async function inviteAndAccept(ctx: Ctx, org: string, email: string, body: Record<string, unknown>): Promise<string> {
  ctx.mailer.sent.length = 0;
  const r = await call(ctx, "POST", "/admin/invitations", { token: ctx.superToken, org, body: { email, ...body } });
  expect(r.status).toBe(201);
  const a = await call(ctx, "POST", "/auth/accept-invite", { body: { token: tokenFromLink(ctx.mailer.linkFor(email)!), name: email.split("@")[0] } });
  expect(a.status).toBe(200);
  return a.body.access_token as string;
}

export const uuid = () => randomUUID();
let clock = Date.parse("2026-10-19T08:00:00Z");
/** strictly increasing client timestamps */
export const tick = (ms = 1000) => new Date((clock += ms)).toISOString();

export const op = <T extends Record<string, unknown>>(type: string, fields: T) => ({ opId: uuid(), at: tick(), type, ...fields });

export async function push(ctx: Ctx, token: string, ops: unknown[]) {
  const r = await call(ctx, "POST", "/sync/push", { token, body: { ops } });
  return r;
}
export async function pull(ctx: Ctx, token: string, org: string, since = 0, epoch?: string, limit?: number) {
  const q = new URLSearchParams({ since: String(since) });
  if (epoch) q.set("epoch", epoch);
  if (limit) q.set("limit", String(limit));
  return (await call(ctx, "GET", `/sync/pull?${q}`, { token, org })).body;
}

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
export const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

export const dentsPanel = (key: string, dents: Record<string, number>, extra: Record<string, unknown> = {}) => ({ key, dents, ...extra });
