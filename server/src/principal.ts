import { and, eq } from "drizzle-orm";
import type { Scope } from "@hagel/shared";
import type { Db } from "./db";
import type { Principal } from "./permissions";
import { roleAssignments, roles, technicians, users } from "./schema";

export async function loadPrincipal(db: Db, userId: string): Promise<Principal | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) return null;
  const rows = await db
    .select({ a: roleAssignments, r: roles })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roleAssignments.userId, userId)));
  const techs = await db.select().from(technicians).where(and(eq(technicians.userId, userId), eq(technicians.active, true)));
  return {
    id: u.id,
    technicians: techs.map((x) => ({ orgId: x.orgId, id: x.id, name: x.name, kind: x.kind === "headliner" ? "headliner" as const : "pdr" as const })),
    isSuperadmin: u.isSuperadmin,
    status: u.status as Principal["status"],
    grants: rows.map(({ a, r }) => ({
      orgId: a.orgId, stationId: a.stationId, scope: r.scope as Scope, permissions: r.permissions,
      scopeClientStationId: a.scopeClientStationId, scopeInsurerId: a.scopeInsurerId, scopeCampaignId: a.scopeCampaignId,
      expiresAt: a.expiresAt,
    })),
  };
}
