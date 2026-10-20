import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** 256-bit URL-safe random token. Only its SHA-256 hash is ever stored. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---- passwords: scrypt (memory-hard, built into node), random salt per password ----
const N = 16384, KEYLEN = 64;
const scryptAsync = (pw: string, salt: Buffer, n: number) =>
  new Promise<Buffer>((res, rej) => scrypt(pw.normalize("NFKC"), salt, KEYLEN, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${N}$${salt.toString("base64")}$${(await scryptAsync(pw, salt, N)).toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  const [alg, n, salt, hash] = (stored ?? "").split("$");
  if (alg !== "scrypt" || !n || !salt || !hash) { await scryptAsync(pw, Buffer.alloc(16), N); return false; } // same cost whether or not a password exists
  const got = await scryptAsync(pw, Buffer.from(salt, "base64"), Number(n));
  const want = Buffer.from(hash, "base64");
  return got.length === want.length && timingSafeEqual(got, want);
}
