import { eq } from "drizzle-orm";
import { seedRoles } from "./app";
import type { Db } from "./db";
import { memberships, organizations, stations, users } from "./schema";

export interface SeedOptions { superadminEmail: string; superadminName?: string; testSites?: boolean }

/** Idempotent: organisations, super-admin, default roles, optional test sites. */
export async function seed(db: Db, o: SeedOptions) {
  const orgsWanted = [{ name: "PDR Team GmbH", country: "DE" }, { name: "PDR Team Spain", country: "ES" }];
  const orgs = [];
  for (const w of orgsWanted) {
    let [org] = await db.select().from(organizations).where(eq(organizations.name, w.name));
    if (!org) [org] = await db.insert(organizations).values(w).returning();
    orgs.push(org);
    await seedRoles(db, org.id);
  }
  const email = o.superadminEmail.trim().toLowerCase();
  let [su] = await db.select().from(users).where(eq(users.email, email));
  if (!su) [su] = await db.insert(users).values({ email, name: o.superadminName ?? "Nicolas", status: "active", isSuperadmin: true }).returning();
  else if (!su.isSuperadmin) await db.update(users).set({ isSuperadmin: true }).where(eq(users.id, su.id));
  for (const org of orgs) await db.insert(memberships).values({ userId: su.id, orgId: org.id }).onConflictDoNothing();
  if (o.testSites) {
    const existing = await db.select().from(stations).where(eq(stations.orgId, orgs[1].id));
    if (!existing.length) {
      await db.insert(stations).values([
        { orgId: orgs[1].id, type: "carrosserie", name: "Carrosserie Test Talavera", country: "ES", capacite: 40 },
        { orgId: orgs[1].id, type: "hall", name: "Nave PDR Madrid", country: "ES", capacite: 120 },
      ]);
    }
  }
  return { orgs, superadmin: su };
}
