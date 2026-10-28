// Lists the accounts that still have a role with the "campagne" scope (Freelancer). READ-ONLY (SELECT only).
// Campaigns are no longer used (v4): these accounts now also see the cars assigned to them, besides their old campaign.
//
//   DATABASE_URL=... npm run freelancers -w @hagel/server
import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { campaigns, organizations, roleAssignments, roles, users } from "../schema";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required (this script never uses the in-memory database)"); process.exit(2); }
const h = await createDb(url, { migrate: false });
const rows = await h.db
  .select({ email: users.email, name: users.name, org: organizations.name, role: roles.name, campaign: campaigns.name, expires: roleAssignments.expiresAt })
  .from(roleAssignments)
  .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
  .innerJoin(users, eq(users.id, roleAssignments.userId))
  .innerJoin(organizations, eq(organizations.id, roleAssignments.orgId))
  .leftJoin(campaigns, eq(campaigns.id, roleAssignments.scopeCampaignId))
  .where(eq(roles.scope, "campagne"));
console.log(rows.length ? rows.map((r) => `${r.email}\t${r.name}\t${r.org}\t${r.role}\tcampaign: ${r.campaign ?? "-"}\texpires: ${r.expires?.toISOString().slice(0, 10) ?? "never"}`).join("\n") : "no account with a campaign-scope role");
await h.close?.();
process.exit(0);
