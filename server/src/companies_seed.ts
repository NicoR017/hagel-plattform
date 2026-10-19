import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import type { Db } from "./db";
import { imageInfo, logoKey } from "./routes_master";
import { companies } from "./schema";
import type { Storage } from "./storage";

/** Default letterheads of an organisation: "PDR Team GmbH" (with logo) and "Neutral (ohne Logo)". Idempotent: only when there is none. */
export async function seedCompanies(db: Db, storage: Storage, orgId: string) {
  const existing = await db.select().from(companies).where(eq(companies.orgId, orgId));
  if (existing.length) return;
  const [pdr] = await db.insert(companies).values({ orgId, name: "PDR Team GmbH" }).returning();
  await db.insert(companies).values({ orgId, name: "Neutral (ohne Logo)" });
  try {
    const bytes = new Uint8Array(await readFile(new URL("../assets/pdr-team-logo.jpg", import.meta.url)));
    const info = imageInfo(bytes)!;
    const key = logoKey(orgId, pdr.id, info.kind);
    await storage.put(key, bytes, "image/jpeg");
    await db.update(companies).set({ logoKey: key, logoMeta: info as never }).where(eq(companies.id, pdr.id));
  } catch (e) {
    console.warn("[seed] could not store the default logo", e);
  }
}
