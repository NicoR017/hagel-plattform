import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit URL-safe random token. Only its SHA-256 hash is ever stored. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
