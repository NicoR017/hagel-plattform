import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export interface DbHandle { db: Db; close: () => Promise<void>; kind: "pg" | "pglite" }

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Postgres when a URL is given (Railway), otherwise an in-memory Postgres (PGlite) for tests and local dev. */
export async function createDb(url?: string | null): Promise<DbHandle> {
  if (url) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return { db, kind: "pg", close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const client = new PGlite();
  const lite = drizzleLite(client, { schema });
  await migrateLite(lite, { migrationsFolder });
  return { db: lite as unknown as Db, kind: "pglite", close: () => client.close() };
}
