import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { memberships, organizations, roleAssignments, roles, users } from "./schema";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** where the replies go: the person's own e-mail, or the shared contact address of the organisation */
export type ReplyMode = "contact" | "own";

export interface ReplyToInfo {
  /** the address to put in Reply-To (undefined: none, as for a system send without a contact address) */
  address: string | undefined;
  /** why: "own" = the sender's e-mail, "contact" = the contact address of the organisation */
  source: "own" | "contact" | "none";
}

/**
 * Reply-To of the reports and receipts a person sends.
 * - the person's own setting wins: "own" -> his e-mail, "contact" -> the contact address of the organisation;
 * - otherwise the roles: if any live role of the person in this organisation asks for the contact address -> contact address;
 * - otherwise (and whenever the organisation has no contact address) his own e-mail, as before.
 * No person (a send made by the system): the contact address if the organisation has one, else nothing, as before.
 */
export async function replyToInfo(db: Pick<Db, "select">, userId: string | null, orgId: string, now = new Date()): Promise<ReplyToInfo> {
  const [org] = await db.select({ c: organizations.contactEmail }).from(organizations).where(eq(organizations.id, orgId));
  const contact = org?.c && EMAIL_RE.test(org.c.trim()) ? org.c.trim().toLowerCase() : null;
  if (!userId) return contact ? { address: contact, source: "contact" } : { address: undefined, source: "none" };
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const own: ReplyToInfo = u?.email ? { address: u.email, source: "own" } : { address: undefined, source: "none" };
  const [m] = await db.select({ mode: memberships.replyMode }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
  let wantContact: boolean;
  if (m?.mode === "own") wantContact = false;
  else if (m?.mode === "contact") wantContact = true;
  else {
    const held = await db.select({ flag: roles.replyFromContact, exp: roleAssignments.expiresAt }).from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId)).where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.orgId, orgId)));
    wantContact = held.some((h) => h.flag && (!h.exp || h.exp > now));
  }
  return wantContact && contact ? { address: contact, source: "contact" } : own;
}

export const replyToFor = async (db: Pick<Db, "select">, userId: string | null, orgId: string) => (await replyToInfo(db, userId, orgId)).address;
