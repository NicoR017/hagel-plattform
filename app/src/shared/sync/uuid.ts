export const uuid4 = (): string => crypto.randomUUID();

/**
 * Deterministic UUID v5 (SHA-1): importing the same old backup twice, or the same vehicle from two phones,
 * yields the same id, so duplicates can be detected.
 */
export async function uuid5(name: string, namespace = "6f1c3a52-7d1e-4a52-9b0a-4e3b9c6d1f10"): Promise<string> {
  const ns = namespace.replace(/-/g, "").match(/../g)!.map((h) => parseInt(h, 16));
  const data = new Uint8Array([...ns, ...new TextEncoder().encode(name)]);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
