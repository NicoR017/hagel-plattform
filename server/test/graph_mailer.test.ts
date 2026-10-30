import { beforeAll, describe, expect, it } from "vitest";
import { GraphMailer, ModeMailer, ResendMailer, ConsoleMailer, makeBaseMailer, parseFrom } from "../src/email";
import { loadConfig } from "../src/config";
import { call, inviteAndAccept, setup, type Ctx } from "./helpers";

interface Req { url: string; method: string; headers: Record<string, string>; body: any }
type Handler = (r: Req) => Response | undefined;

/** fetch mock: no network. `handlers` are tried first, then the defaults (token ok, everything else 202). */
function mock(handlers: Handler[] = []) {
  const reqs: Req[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const raw = init.body;
    const r: Req = { url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: typeof raw === "string" ? raw : raw };
    reqs.push(r);
    for (const h of handlers) { const x = h(r); if (x) return x; }
    if (url.includes("/oauth2/v2.0/token")) return new Response(JSON.stringify({ access_token: `tok${reqs.filter((q) => q.url.includes("/token")).length}`, expires_in: 3600 }), { status: 200 });
    return new Response(null, { status: 202 });
  }) as unknown as typeof fetch;
  return { f, reqs, sends: () => reqs.filter((r) => r.url.endsWith("/sendMail")), tokens: () => reqs.filter((r) => r.url.includes("/token")) };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const SECRET = "s3cr3t-value-xyz";
function make(m: ReturnType<typeof mock>, from = "noreplay-spain@pdr-team.com", extra: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  return new GraphMailer({ tenantId: "tenant-1", clientId: "client-1", clientSecret: SECRET, from, fetch: m.f, sleep: extra.sleep ?? (async () => {}), now: extra.now });
}
const mail = { to: "a@x.test", subject: "S", text: "T" };

describe("GraphMailer token", () => {
  it("asks once and reuses the token", async () => {
    const m = mock(), g = make(m);
    await g.send(mail); await g.send(mail);
    expect(m.tokens()).toHaveLength(1);
    const t = m.tokens()[0];
    expect(t.url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    const p = new URLSearchParams(t.body);
    expect(Object.fromEntries(p)).toEqual({ client_id: "client-1", client_secret: SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
    expect(m.sends()[0].headers.Authorization).toBe("Bearer tok1");
  });
  it("renews after expiry (expires_in - 5 min)", async () => {
    let t = 0;
    const m = mock(), g = make(m, undefined, { now: () => t });
    await g.send(mail);
    t = 3600_000 - 301_000; await g.send(mail);
    expect(m.tokens()).toHaveLength(1);
    t = 3600_000 - 299_000; await g.send(mail);
    expect(m.tokens()).toHaveLength(2);
    expect(m.sends()[2].headers.Authorization).toBe("Bearer tok2");
  });
  it("parallel sends share one token request", async () => {
    const m = mock(), g = make(m);
    await Promise.all([g.send(mail), g.send(mail), g.send(mail)]);
    expect(m.tokens()).toHaveLength(1);
    expect(m.sends()).toHaveLength(3);
  });
});

describe("GraphMailer sendMail body", () => {
  it("several recipients, html, cc/bcc, replyTo, attachment in base64", async () => {
    const m = mock(), g = make(m);
    await g.send({
      to: ["a@x.test", "b@x.test"], cc: ["c@x.test"], bcc: ["d@x.test"], subject: "Sub", text: "plain", html: "<p>h</p>", replyTo: "r@x.test",
      attachments: [{ filename: "r.pdf", contentType: "application/pdf", content: new Uint8Array([1, 2, 3, 250]) }],
    });
    const s = m.sends()[0];
    expect(s.url).toBe("https://graph.microsoft.com/v1.0/users/noreplay-spain%40pdr-team.com/sendMail");
    expect(s.method).toBe("POST");
    expect(JSON.parse(s.body)).toEqual({
      saveToSentItems: true,
      message: {
        subject: "Sub", body: { contentType: "HTML", content: "<p>h</p>" },
        toRecipients: [{ emailAddress: { address: "a@x.test" } }, { emailAddress: { address: "b@x.test" } }],
        ccRecipients: [{ emailAddress: { address: "c@x.test" } }], bccRecipients: [{ emailAddress: { address: "d@x.test" } }],
        replyTo: [{ emailAddress: { address: "r@x.test" } }],
        attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: "r.pdf", contentType: "application/pdf", contentBytes: Buffer.from([1, 2, 3, 250]).toString("base64") }],
      },
    });
  });
  it("text body when there is no html; single string recipient", async () => {
    const m = mock(), g = make(m);
    await g.send(mail);
    expect(JSON.parse(m.sends()[0].body).message).toEqual({ subject: "S", body: { contentType: "Text", content: "T" }, toRecipients: [{ emailAddress: { address: "a@x.test" } }] });
  });
  it("`Name <address>` uses the address in the URL and the name in from", async () => {
    expect(parseFrom('PDR Hagel <noreplay-spain@pdr-team.com>')).toEqual({ name: "PDR Hagel", address: "noreplay-spain@pdr-team.com" });
    expect(parseFrom("plain@x.test")).toEqual({ name: null, address: "plain@x.test" });
    const m = mock(), g = make(m, "PDR Hagel <noreplay-spain@pdr-team.com>");
    await g.send(mail);
    expect(m.sends()[0].url).toBe("https://graph.microsoft.com/v1.0/users/noreplay-spain%40pdr-team.com/sendMail");
    expect(JSON.parse(m.sends()[0].body).message.from).toEqual({ emailAddress: { name: "PDR Hagel", address: "noreplay-spain@pdr-team.com" } });
  });
});

describe("GraphMailer large attachments", () => {
  it("> 3 MB: draft, small attachment inline, big one by upload session in 320 KiB multiples, then send", async () => {
    const big = new Uint8Array(5 * 1024 * 1024).fill(7), small = new Uint8Array(1000).fill(1);
    const m = mock([
      (r) => (r.url.endsWith("/messages") && r.method === "POST" ? json(201, { id: "AAMk=/x" }) : undefined),
      (r) => (r.url.endsWith("/attachments") ? json(201, {}) : undefined),
      (r) => (r.url.endsWith("/createUploadSession") ? json(200, { uploadUrl: "https://upload.test/session1" }) : undefined),
      (r) => (r.url === "https://upload.test/session1" ? json(200, {}) : undefined),
    ]);
    await make(m).send({ ...mail, attachments: [{ filename: "s.txt", contentType: "text/plain", content: small }, { filename: "big.pdf", contentType: "application/pdf", content: big }] });
    const calls = m.reqs.filter((r) => !r.url.includes("/token")).map((r) => `${r.method} ${r.url.replace("https://graph.microsoft.com/v1.0/users/noreplay-spain%40pdr-team.com", "")}`);
    const puts = m.reqs.filter((r) => r.method === "PUT");
    expect(calls.filter((c) => !c.startsWith("PUT"))).toEqual([
      "POST /messages", "POST /messages/AAMk%3D%2Fx/attachments", "POST /messages/AAMk%3D%2Fx/attachments/createUploadSession", "POST /messages/AAMk%3D%2Fx/send",
    ]);
    expect(m.reqs.some((r) => r.url.endsWith("/sendMail"))).toBe(false);
    expect(JSON.parse(m.reqs.find((r) => r.url.endsWith("/createUploadSession"))!.body)).toEqual({ AttachmentItem: { attachmentType: "file", name: "big.pdf", size: big.length, contentType: "application/pdf" } });
    const total = big.length, chunk = 320 * 1024 * 9;
    expect(puts.length).toBe(Math.ceil(total / chunk));
    puts.forEach((p, i) => {
      const start = i * chunk, end = Math.min(start + chunk, total) - 1;
      expect(p.headers["Content-Range"]).toBe(`bytes ${start}-${end}/${total}`);
      expect(p.headers.Authorization).toBeUndefined();
      if (i < puts.length - 1) expect((end - start + 1) % (320 * 1024)).toBe(0);
    });
  });
  it("deletes the draft when the upload fails", async () => {
    const m = mock([
      (r) => (r.url.endsWith("/messages") && r.method === "POST" ? json(201, { id: "D1" }) : undefined),
      (r) => (r.url.endsWith("/createUploadSession") ? json(403, { error: { code: "ErrorAccessDenied" } }) : undefined),
      (r) => (r.method === "DELETE" ? new Response(null, { status: 204 }) : undefined),
    ]);
    const big = new Uint8Array(4 * 1024 * 1024);
    await expect(make(m).send({ ...mail, attachments: [{ filename: "b.pdf", contentType: "application/pdf", content: big }] })).rejects.toThrow("403 ErrorAccessDenied");
    expect(m.reqs.some((r) => r.method === "DELETE" && r.url.endsWith("/messages/D1"))).toBe(true);
  });
});

describe("GraphMailer errors and retries", () => {
  it("429 + Retry-After: waits, retries, succeeds", async () => {
    let n = 0; const waits: number[] = [];
    const m = mock([(r) => (r.url.endsWith("/sendMail") && ++n === 1 ? json(429, {}, { "Retry-After": "7" }) : undefined)]);
    await make(m, undefined, { sleep: async (ms) => { waits.push(ms); } }).send(mail);
    expect(m.sends()).toHaveLength(2);
    expect(waits).toEqual([7000]);
  });
  it("gives up after 3 tries", async () => {
    const m = mock([(r) => (r.url.endsWith("/sendMail") ? json(503, { error: { code: "ServiceUnavailable" } }) : undefined)]);
    await expect(make(m).send(mail)).rejects.toThrow("Graph sendMail error 503 ServiceUnavailable");
    expect(m.sends()).toHaveLength(3);
  });
  it("401: new token once, then retry", async () => {
    let n = 0;
    const m = mock([(r) => (r.url.endsWith("/sendMail") && ++n === 1 ? json(401, { error: { code: "InvalidAuthenticationToken" } }) : undefined)]);
    await make(m).send(mail);
    expect(m.tokens()).toHaveLength(2);
    expect(m.sends().map((s) => s.headers.Authorization)).toEqual(["Bearer tok1", "Bearer tok2"]);
  });
  it("401 twice: error, no loop", async () => {
    const m = mock([(r) => (r.url.endsWith("/sendMail") ? json(401, { error: { code: "InvalidAuthenticationToken" } }) : undefined)]);
    await expect(make(m).send(mail)).rejects.toThrow("401");
    expect(m.sends()).toHaveLength(2);
  });
  it("400: error with status and code only, no secret", async () => {
    const m = mock([(r) => (r.url.endsWith("/sendMail") ? json(400, { error: { code: "ErrorInvalidRecipients", message: `bad ${SECRET}` } }) : undefined)]);
    const e = await make(m).send(mail).catch((x: Error) => x);
    expect((e as Error).message).toBe("Graph sendMail error 400 ErrorInvalidRecipients");
    expect(m.sends()).toHaveLength(1);
  });
  it("wrong secret: token error without secret", async () => {
    const m = mock([(r) => (r.url.includes("/token") ? json(401, { error: "invalid_client", error_description: `AADSTS7000215 ${SECRET}` }) : undefined)]);
    const e = (await make(m).send(mail).catch((x: Error) => x)) as Error;
    expect(e.message).toBe("Graph token error 401 invalid_client");
    expect(e.message).not.toContain(SECRET);
  });
});

describe("provider selection (loadConfig)", () => {
  const G = { GRAPH_TENANT_ID: "t", GRAPH_CLIENT_ID: "c", GRAPH_CLIENT_SECRET: "s", EMAIL_FROM: "noreplay-spain@pdr-team.com" };
  it("graph / resend / console", () => {
    expect(loadConfig({ ...G, EMAIL_API_KEY: "re_x" }).emailProvider).toBe("graph");
    expect(loadConfig({ EMAIL_API_KEY: "re_x" }).emailProvider).toBe("resend");
    expect(loadConfig({}).emailProvider).toBe("console");
    expect(loadConfig({ GRAPH_TENANT_ID: " ", EMAIL_API_KEY: "re_x" }).emailProvider).toBe("resend");
  });
  it("partial GRAPH_* or missing EMAIL_FROM is a startup error", () => {
    expect(() => loadConfig({ GRAPH_TENANT_ID: "t", GRAPH_CLIENT_ID: "c" })).toThrow("together");
    expect(() => loadConfig({ GRAPH_TENANT_ID: "t", GRAPH_CLIENT_ID: "c", GRAPH_CLIENT_SECRET: "s" })).toThrow("EMAIL_FROM");
  });
  it("existing mail rules unchanged", () => {
    expect(() => loadConfig({ ...G, APP_ENV: "staging", MAIL_MODE: "live" })).toThrow("staging");
    expect(() => loadConfig({ ...G, MAIL_MODE: "redirect" })).toThrow("MAIL_REDIRECT_TO");
  });
  it("without GRAPH_* the mailer is exactly the former one", () => {
    expect(makeBaseMailer(loadConfig({ EMAIL_API_KEY: "re_x" }))).toBeInstanceOf(ResendMailer);
    expect(makeBaseMailer(loadConfig({}))).toBeInstanceOf(ConsoleMailer);
    expect(makeBaseMailer(loadConfig(G))).toBeInstanceOf(GraphMailer);
  });
  it("ModeMailer redirect still wraps Graph (staging goes to MAIL_REDIRECT_TO)", async () => {
    const m = mock();
    await new ModeMailer(make(m), "redirect", "me@x.test").send({ ...mail, cc: ["c@x.test"] });
    const msg = JSON.parse(m.sends()[0].body).message;
    expect(msg.toRecipients).toEqual([{ emailAddress: { address: "me@x.test" } }]);
    expect(msg.ccRecipients).toBeUndefined();
    expect(msg.subject).toMatch(/^\[STAGING → /);
  });
});

describe("POST /admin/mail-test", () => {
  let c: Ctx;
  beforeAll(async () => { c = await setup(); });
  it("super-admin: sends to own address, audited", async () => {
    c.mailer.sent.length = 0;
    const r = await call(c, "POST", "/admin/mail-test", { token: c.superToken, body: { withAttachment: "small", replyTo: "Rep@x.test" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ provider: "console", ok: true });
    const m = c.mailer.last();
    expect(m.to).toBe("nicolas@example.test");
    expect(m.replyTo).toBe("rep@x.test");
    expect(m.attachments![0].content.length).toBeGreaterThan(90_000);
    expect(new TextDecoder().decode(m.attachments![0].content.subarray(0, 8))).toBe("%PDF-1.4");
  });
  it("large attachment is about 5 MB", async () => {
    await call(c, "POST", "/admin/mail-test", { token: c.superToken, body: { withAttachment: "large" } });
    expect(c.mailer.last().attachments![0].content.length).toBeGreaterThan(5_000_000 - 1000);
  });
  it("reports a provider failure instead of crashing", async () => {
    c.mailer.fail = new Error("Graph sendMail error 403 ErrorAccessDenied");
    const r = await call(c, "POST", "/admin/mail-test", { token: c.superToken, body: {} });
    c.mailer.fail = null;
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, error: "Graph sendMail error 403 ErrorAccessDenied" });
  });
  it("refused for anyone who is not super-admin", async () => {
    const t = await inviteAndAccept(c, c.orgES, "plain-mt@example.test", { role_id: c.roleId.aufnehmer });
    const a = await inviteAndAccept(c, c.orgES, "admin-mt@example.test", { role_id: c.roleId.org_admin });
    c.mailer.sent.length = 0;
    for (const token of [t, a]) expect((await call(c, "POST", "/admin/mail-test", { token, org: c.orgES, body: {} })).status).toBe(403);
    expect((await call(c, "POST", "/admin/mail-test", { body: {} })).status).toBe(401);
    expect(c.mailer.sent).toHaveLength(0);
  });
});
