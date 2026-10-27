// Microsoft Graph mailer: token cache, request format, large attachments, retries, provider choice. fetch is mocked: no network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { buildMailer, GraphMailer, parseSender } from "../src/email";

const SECRET = "s3cret-value-that-must-never-leak";
const MAILBOX = "noreplay-spain@pdr-team.com";
const SEND_URL = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/sendMail`;
const TOKEN_URL = "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token";

interface Call { url: string; method: string; headers: Record<string, string>; text: string | null; raw: unknown }
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const empty = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

/** a fake Graph: every call is recorded, `handler` can answer anything but the token request, which defaults to a good token */
function graph(handler: (c: Call, n: number) => Response | Promise<Response> | undefined = () => undefined) {
  const calls: Call[] = [];
  let tokens = 0;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const c: Call = { url: String(url), method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, text: typeof init?.body === "string" ? init.body : null, raw: init?.body };
    calls.push(c);
    if (c.url === TOKEN_URL) return json(200, { access_token: `tok${++tokens}`, expires_in: 3600 });
    return (await handler(c, calls.length)) ?? (c.url.endsWith("/sendMail") || c.url.endsWith("/send") ? empty(202) : empty(204));
  }) as typeof fetch;
  return { f, calls, tokenCalls: () => calls.filter((c) => c.url === TOKEN_URL), sends: () => calls.filter((c) => c.url === SEND_URL) };
}
function mailer(f: typeof fetch, o: { from?: string; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  return new GraphMailer({ tenantId: "tenant-1", clientId: "client-1", clientSecret: SECRET, from: o.from ?? MAILBOX, fetch: f, now: o.now, sleep: o.sleep ?? (async () => undefined) });
}
const body = (c: Call) => JSON.parse(c.text ?? "null");

afterEach(() => vi.unstubAllGlobals());

describe("token", () => {
  it("asked once with the client credentials, then reused", async () => {
    const g = graph();
    const m = mailer(g.f);
    await m.send({ to: "a@x.test", subject: "1", text: "t" });
    await m.send({ to: "a@x.test", subject: "2", text: "t" });
    expect(g.tokenCalls()).toHaveLength(1);
    const form = new URLSearchParams(g.tokenCalls()[0].text ?? "");
    expect(Object.fromEntries(form)).toEqual({ client_id: "client-1", client_secret: SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
    expect(g.tokenCalls()[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(g.sends().every((c) => c.headers.Authorization === "Bearer tok1")).toBe(true);
  });

  it("renewed 5 minutes before it expires", async () => {
    const g = graph();
    let t = 0;
    const m = mailer(g.f, { now: () => t });
    await m.send({ to: "a@x.test", subject: "1", text: "t" });
    t = (3600 - 301) * 1000; // still valid
    await m.send({ to: "a@x.test", subject: "2", text: "t" });
    expect(g.tokenCalls()).toHaveLength(1);
    t = (3600 - 299) * 1000; // inside the last 5 minutes
    await m.send({ to: "a@x.test", subject: "3", text: "t" });
    expect(g.tokenCalls()).toHaveLength(2);
    expect(g.sends()[2].headers.Authorization).toBe("Bearer tok2");
  });

  it("parallel mails share one token request", async () => {
    const g = graph();
    const slow = (async (url: string | URL | Request, init?: RequestInit) => { if (String(url) === TOKEN_URL) await new Promise((r) => setTimeout(r, 20)); return g.f(url, init); }) as typeof fetch;
    const m = mailer(slow);
    await Promise.all([1, 2, 3, 4, 5].map((i) => m.send({ to: "a@x.test", subject: String(i), text: "t" })));
    expect(g.tokenCalls()).toHaveLength(1);
    expect(g.sends()).toHaveLength(5);
  });
});

describe("request format", () => {
  it("several recipients, html body, reply-to, attachment in base64, saved to the sent items", async () => {
    const g = graph();
    await mailer(g.f).send({
      to: ["a@x.test", "b@y.test"], subject: "Estimate", text: "plain", html: "<p>rich</p>", replyTo: "expert@pdr.test",
      attachments: [{ filename: "k.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" }],
    });
    const [c] = g.sends();
    expect(c.method).toBe("POST");
    expect(c.headers["Content-Type"]).toBe("application/json");
    expect(body(c)).toEqual({
      message: {
        subject: "Estimate",
        body: { contentType: "HTML", content: "<p>rich</p>" },
        toRecipients: [{ emailAddress: { address: "a@x.test" } }, { emailAddress: { address: "b@y.test" } }],
        replyTo: [{ emailAddress: { address: "expert@pdr.test" } }],
        attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: "k.pdf", contentType: "application/pdf", contentBytes: Buffer.from([1, 2, 3]).toString("base64") }],
      },
      saveToSentItems: true,
    });
  });

  it("text body when there is no html; one recipient as a string; no reply-to, no attachment", async () => {
    const g = graph();
    await mailer(g.f).send({ to: "a@x.test", subject: "Hi", text: "plain" });
    expect(body(g.sends()[0]).message).toEqual({ subject: "Hi", body: { contentType: "Text", content: "plain" }, toRecipients: [{ emailAddress: { address: "a@x.test" } }] });
  });

  it("'Name <address>': the address is in the URL, the name goes into from on the same address", async () => {
    expect(parseSender('PDR Hagel <noreplay-spain@pdr-team.com>')).toEqual({ name: "PDR Hagel", address: MAILBOX });
    expect(parseSender('"PDR, Hagel" <noreplay-spain@pdr-team.com>')).toEqual({ name: "PDR, Hagel", address: MAILBOX });
    expect(parseSender(" noreplay-spain@pdr-team.com ")).toEqual({ name: null, address: MAILBOX });
    const g = graph();
    await mailer(g.f, { from: "PDR Hagel <noreplay-spain@pdr-team.com>" }).send({ to: "a@x.test", subject: "Hi", text: "t" });
    expect(g.sends()).toHaveLength(1); // /users/noreplay-spain%40pdr-team.com/sendMail
    expect(body(g.sends()[0]).message.from).toEqual({ emailAddress: { name: "PDR Hagel", address: MAILBOX } });
    const bare = graph();
    await mailer(bare.f).send({ to: "a@x.test", subject: "Hi", text: "t" });
    expect(body(bare.sends()[0]).message).not.toHaveProperty("from");
  });
});

describe("large attachments", () => {
  const big = new Uint8Array(4_000_000).fill(7);
  const small = new Uint8Array(1000).fill(9);
  const UPLOAD = "https://upload.example.test/session/1";
  const handler = (fail?: { send?: number }) => (c: Call) => {
    if (c.method === "POST" && c.url.endsWith("/messages")) return json(201, { id: "AAMk=" });
    if (c.url.endsWith("/attachments") && c.method === "POST") return empty(201);
    if (c.url.endsWith("/createUploadSession")) return json(201, { uploadUrl: UPLOAD });
    if (c.url === UPLOAD) return empty(200);
    if (c.url.endsWith("/send") && fail?.send) return json(fail.send, { error: { code: "ErrorSendFailed" } });
    return undefined;
  };

  it("draft, small attachment by POST, big one by upload session in chunks, then send", async () => {
    const g = graph(handler());
    await mailer(g.f).send({
      to: "a@x.test", subject: "Report", text: "t", replyTo: "expert@pdr.test",
      attachments: [{ filename: "small.pdf", content: small, contentType: "application/pdf" }, { filename: "big.pdf", content: big, contentType: "application/pdf" }],
    });
    expect(g.sends()).toHaveLength(0); // never the one-shot request
    const steps = g.calls.filter((c) => c.url !== TOKEN_URL).map((c) => `${c.method} ${c.url.replace("https://graph.microsoft.com/v1.0", "")}`);
    const base = `/users/${encodeURIComponent(MAILBOX)}/messages`;
    expect(steps).toEqual([
      `POST ${base}`,
      `POST ${base}/AAMk%3D/attachments`,
      `POST ${base}/AAMk%3D/attachments/createUploadSession`,
      `PUT ${UPLOAD}`, `PUT ${UPLOAD}`,
      `POST ${base}/AAMk%3D/send`,
    ]);
    const [draft, att, session, put1, put2] = g.calls.filter((c) => c.url !== TOKEN_URL);
    expect(body(draft)).toMatchObject({ subject: "Report", replyTo: [{ emailAddress: { address: "expert@pdr.test" } }] });
    expect(body(draft)).not.toHaveProperty("attachments");
    expect(body(att)).toMatchObject({ "@odata.type": "#microsoft.graph.fileAttachment", name: "small.pdf" });
    expect(body(session)).toEqual({ AttachmentItem: { attachmentType: "file", name: "big.pdf", size: 4_000_000, contentType: "application/pdf" } });
    expect(put1.headers["Content-Range"]).toBe("bytes 0-3276799/4000000");
    expect(put2.headers["Content-Range"]).toBe("bytes 3276800-3999999/4000000");
    expect(3_276_800 % (320 * 1024)).toBe(0); // chunks are a multiple of 320 KiB
    expect((put1.raw as Uint8Array).byteLength + (put2.raw as Uint8Array).byteLength).toBe(4_000_000);
    expect(put1.headers).not.toHaveProperty("Authorization"); // the upload URL carries its own authorisation
  });

  it("the sum counts: several attachments that are each small but together too big also use the draft", async () => {
    const g = graph(handler());
    const part = new Uint8Array(1_600_000);
    await mailer(g.f).send({ to: "a@x.test", subject: "R", text: "t", attachments: [1, 2].map((i) => ({ filename: `p${i}.pdf`, content: part, contentType: "application/pdf" })) });
    expect(g.sends()).toHaveLength(0);
    expect(g.calls.filter((c) => c.url.endsWith("/attachments"))).toHaveLength(2);
    expect(g.calls.some((c) => c.url.endsWith("/createUploadSession"))).toBe(false);
  });

  it("a failure while sending the draft is reported and the draft is deleted", async () => {
    const g = graph(handler({ send: 400 }));
    await expect(mailer(g.f).send({ to: "a@x.test", subject: "R", text: "t", attachments: [{ filename: "big.pdf", content: big, contentType: "application/pdf" }] })).rejects.toThrow("Graph error 400 ErrorSendFailed");
    expect(g.calls.at(-1)).toMatchObject({ method: "DELETE" });
  });
});

describe("errors and retries", () => {
  it("429 with Retry-After: waits that long and tries again", async () => {
    const waits: number[] = [];
    let n = 0;
    const g = graph((c) => (c.url === SEND_URL && ++n === 1 ? empty(429, { "Retry-After": "7" }) : undefined));
    await mailer(g.f, { sleep: async (ms) => { waits.push(ms); } }).send({ to: "a@x.test", subject: "R", text: "t" });
    expect(waits).toEqual([7000]);
    expect(g.sends()).toHaveLength(2);
  });

  it("503 without Retry-After backs off; gives up after 3 tries", async () => {
    const waits: number[] = [];
    const g = graph((c) => (c.url === SEND_URL ? json(503, { error: { code: "ServiceNotAvailable" } }) : undefined));
    await expect(mailer(g.f, { sleep: async (ms) => { waits.push(ms); } }).send({ to: "a@x.test", subject: "R", text: "t" })).rejects.toThrow("Graph error 503 ServiceNotAvailable");
    expect(g.sends()).toHaveLength(3);
    expect(waits).toEqual([2000, 4000]);
  });

  it("401: one new token, then the mail goes out; a second 401 is an error", async () => {
    let n = 0;
    const g = graph((c) => (c.url === SEND_URL && ++n === 1 ? json(401, { error: { code: "InvalidAuthenticationToken" } }) : undefined));
    await mailer(g.f).send({ to: "a@x.test", subject: "R", text: "t" });
    expect(g.tokenCalls()).toHaveLength(2);
    expect(g.sends().map((c) => c.headers.Authorization)).toEqual(["Bearer tok1", "Bearer tok2"]);
    const bad = graph((c) => (c.url === SEND_URL ? json(401, { error: { code: "InvalidAuthenticationToken" } }) : undefined));
    await expect(mailer(bad.f).send({ to: "a@x.test", subject: "R", text: "t" })).rejects.toThrow("Graph error 401 InvalidAuthenticationToken");
    expect(bad.sends()).toHaveLength(2);
  });

  it("400: an error with the status and the Graph code, never the secret, the token or the content", async () => {
    const g = graph((c) => (c.url === SEND_URL ? json(400, { error: { code: "ErrorInvalidRecipients", message: `bad: ${SECRET} tok1 Authorization` } }) : undefined));
    const err = await mailer(g.f).send({ to: "a@x.test", subject: "R", text: "t", attachments: [{ filename: "k.pdf", content: new Uint8Array([1]), contentType: "application/pdf" }] }).then(() => null, (e: Error) => e);
    expect(err?.message).toBe("Graph error 400 ErrorInvalidRecipients");
    expect(g.sends()).toHaveLength(1); // a 400 is not retried
  });

  it("a refused token request: the error says why, without the secret", async () => {
    const f = (async () => json(401, { error: "invalid_client", error_description: `AADSTS7000215 ${SECRET}` })) as typeof fetch;
    const err = await mailer(f).send({ to: "a@x.test", subject: "R", text: "t" }).then(() => null, (e: Error) => e);
    expect(err?.message).toBe("Graph token error 401 invalid_client");
    expect(err?.message).not.toContain(SECRET);
  });
});

describe("choice of the provider", () => {
  const cfg = (env: Record<string, string>) => loadConfig(env);
  const GRAPH = { GRAPH_TENANT_ID: "t", GRAPH_CLIENT_ID: "c", GRAPH_CLIENT_SECRET: "s" };

  it("graph when the three GRAPH_* are set, even with a Resend key", () => {
    expect(cfg({ ...GRAPH, EMAIL_API_KEY: "re_x" })).toMatchObject({ emailProvider: "graph", graphTenantId: "t", graphClientId: "c", graphClientSecret: "s" });
  });
  it("else resend with a key, else console (the log)", () => {
    expect(cfg({ EMAIL_API_KEY: "re_x" })).toMatchObject({ emailProvider: "resend", graphTenantId: null });
    expect(cfg({}).emailProvider).toBe("console");
    expect(cfg({ GRAPH_TENANT_ID: " ", GRAPH_CLIENT_ID: "", GRAPH_CLIENT_SECRET: " " }).emailProvider).toBe("console"); // empty = not set
  });
  it("only part of the GRAPH_* is an error at start-up", () => {
    expect(() => cfg({ GRAPH_TENANT_ID: "t" })).toThrow(/GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET/);
    expect(() => cfg({ GRAPH_TENANT_ID: "t", GRAPH_CLIENT_ID: "c" })).toThrow(/must all be set/);
  });
  it("EMAIL_PROVIDER forces the choice, and the forced provider must be complete", () => {
    expect(cfg({ ...GRAPH, EMAIL_API_KEY: "re_x", EMAIL_PROVIDER: "resend" }).emailProvider).toBe("resend");
    expect(cfg({ ...GRAPH, EMAIL_PROVIDER: "console" }).emailProvider).toBe("console");
    expect(() => cfg({ EMAIL_PROVIDER: "graph" })).toThrow(/needs GRAPH_/);
    expect(() => cfg({ EMAIL_PROVIDER: "resend" })).toThrow(/needs EMAIL_API_KEY/);
    expect(() => cfg({ EMAIL_PROVIDER: "smtp" })).toThrow(/graph, resend or console/);
  });
  it("the staging rule is untouched: never live", () => {
    expect(() => cfg({ ...GRAPH, APP_ENV: "staging", MAIL_MODE: "live" })).toThrow(/staging must not use MAIL_MODE=live/);
    expect(cfg({ ...GRAPH, APP_ENV: "staging" }).mailMode).toBe("off");
  });
});

describe("the MAIL_MODE switch stays in front of Graph", () => {
  const base = { emailProvider: "graph" as const, emailApiKey: null, emailFrom: `PDR Hagel <${MAILBOX}>`, graphTenantId: "tenant-1", graphClientId: "client-1", graphClientSecret: SECRET };
  it("off: nothing leaves, no call at all", async () => {
    const g = graph(); vi.stubGlobal("fetch", g.f);
    await buildMailer({ ...base, mailMode: "off", mailRedirectTo: null }).send({ to: "real@customer.test", subject: "R", text: "t" });
    expect(g.calls).toHaveLength(0);
  });
  it("redirect: only the redirect address gets it, the real recipients are in the subject", async () => {
    const g = graph(); vi.stubGlobal("fetch", g.f);
    await buildMailer({ ...base, mailMode: "redirect", mailRedirectTo: "nicolas@pdr.test" }).send({ to: ["real@customer.test"], subject: "R", text: "t" });
    const m = body(g.sends()[0]).message;
    expect(m.toRecipients).toEqual([{ emailAddress: { address: "nicolas@pdr.test" } }]);
    expect(m.subject).toBe("[STAGING → real@customer.test] R");
  });
  it("live: goes through Graph unchanged", async () => {
    const g = graph(); vi.stubGlobal("fetch", g.f);
    await buildMailer({ ...base, mailMode: "live", mailRedirectTo: null }).send({ to: "real@customer.test", subject: "R", text: "t" });
    expect(body(g.sends()[0]).message.toRecipients).toEqual([{ emailAddress: { address: "real@customer.test" } }]);
  });
});
