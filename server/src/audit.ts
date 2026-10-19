import { auditLog } from "./schema";
import type { Db } from "./db";

export interface AuditEntry {
  orgId?: string | null; userId?: string | null; action: string; entity: string; entityId?: string | null;
  before?: unknown; after?: unknown;
}
export async function audit(db: Db, e: AuditEntry) {
  await db.insert(auditLog).values({
    orgId: e.orgId ?? null, userId: e.userId ?? null, action: e.action, entity: e.entity, entityId: e.entityId ?? null,
    before: (e.before ?? null) as never, after: (e.after ?? null) as never,
  });
}
