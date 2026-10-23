/**
 * THE permission module. Pure functions, no DB access: reused for API reads, sync pull/push, exports and PDFs.
 *
 * Resolution: vehicle's current site (or its customer site for scope `client`)
 *   -> user's role assignment on that site -> permission -> scope check -> field filtering.
 */
import { FIELD_RULES, PERMISSIONS, type Permission, type Scope } from "@hagel/shared";

export interface Grant {
  orgId: string;
  /** null = all sites of the org */
  stationId: string | null;
  scope: Scope;
  permissions: readonly string[];
  scopeClientStationId?: string | null;
  scopeInsurerId?: string | null;
  scopeCampaignId?: string | null;
  expiresAt?: Date | null;
}

export interface Principal {
  id: string;
  isSuperadmin: boolean;
  status: "active" | "disabled" | "invited";
  grants: Grant[];
}

export interface VehicleRef {
  id: string;
  orgId: string;
  stationId: string | null;
  clientStationId: string | null;
  campaignId?: string | null;
  insurerId?: string | null;
  /** user ids assigned to this vehicle (vehicle_assignments) */
  assigneeIds: readonly string[];
}

export type Action = Permission;

const live = (g: Grant, now: Date) => !g.expiresAt || g.expiresAt.getTime() > now.getTime();

function scopeMatches(g: Grant, u: Principal, v: VehicleRef): boolean {
  switch (g.scope) {
    case "assigne": return v.assigneeIds.includes(u.id);
    case "station": return true; // site match is checked by the caller
    // campaigns are no longer used (v4): a car that is assigned to the user counts like for "assigne"; the old campaign link keeps working for existing accounts
    case "campagne": return v.assigneeIds.includes(u.id) || (!!g.scopeCampaignId && v.campaignId === g.scopeCampaignId);
    case "client": return !!g.scopeClientStationId && v.clientStationId === g.scopeClientStationId;
    case "assurance": return !!g.scopeInsurerId && v.insurerId === g.scopeInsurerId;
  }
}

/** Does this grant cover this vehicle (org, site / client site, scope)? */
function grantCoversVehicle(g: Grant, u: Principal, v: VehicleRef): boolean {
  if (g.orgId !== v.orgId) return false;
  // client / assurance / campagne scopes are about the file, wherever it currently is.
  // Site-bound scopes (station, assigne) follow the vehicle's CURRENT site.
  const siteIndependent = g.scope === "client" || g.scope === "assurance" || g.scope === "campagne";
  if (!siteIndependent && g.stationId !== null && g.stationId !== v.stationId) return false;
  return scopeMatches(g, u, v);
}

export function grantsFor(u: Principal, v: VehicleRef, now = new Date()): Grant[] {
  if (u.status !== "active") return [];
  return u.grants.filter((g) => live(g, now) && grantCoversVehicle(g, u, v));
}

/** can(user, action, vehicle) */
export function can(u: Principal, action: Action, v: VehicleRef, now = new Date()): boolean {
  if (u.status !== "active") return false;
  if (u.isSuperadmin) return true;
  return grantsFor(u, v, now).some((g) => g.permissions.includes(action));
}

/**
 * Org-level / site-level actions that are not about one vehicle (users, roles, sites, settings…).
 * With a `stationId`, an org-wide grant or a grant on that site qualifies; without, only an org-wide grant does.
 */
export function canOrg(u: Principal, action: Action, orgId: string, stationId: string | null = null, now = new Date()): boolean {
  if (u.status !== "active") return false;
  if (u.isSuperadmin) return true;
  return u.grants.some(
    (g) =>
      live(g, now) && g.orgId === orgId && g.permissions.includes(action) &&
      (g.stationId === null || (stationId !== null && g.stationId === stationId)),
  );
}

export function isMemberOfOrg(u: Principal, orgId: string): boolean {
  return u.isSuperadmin || u.grants.some((g) => g.orgId === orgId);
}

/** Union of the permissions of every grant that covers this vehicle (superadmin: everything). */
export function effectivePermissions(u: Principal, v: VehicleRef, now = new Date()): Set<string> {
  const perms = new Set<string>();
  if (u.status !== "active") return perms;
  if (u.isSuperadmin) { PERMISSIONS.forEach((p) => perms.add(p)); return perms; }
  grantsFor(u, v, now).forEach((g) => g.permissions.forEach((p) => perms.add(p)));
  return perms;
}

/**
 * Field filtering: effective permissions on THIS vehicle are the union over covering grants.
 * Restricted fields are removed (not blanked) so they never reach the phone.
 * `data.shares` (full internal split) needs `repartition_interne.voir`; otherwise a technician with `ma_part.voir`
 * gets only `myShare`, and a carrosserie with `ma_commission.voir` only `myCommission`.
 */
export function filterFields<T extends Record<string, unknown>>(u: Principal, v: VehicleRef, data: T, now = new Date()): Partial<T> | null {
  if (!can(u, "vehicules.voir", v, now)) return null;
  const perms = new Set<string>();
  if (u.isSuperadmin) FIELD_RULES.forEach((r) => perms.add(r.permission));
  else grantsFor(u, v, now).forEach((g) => g.permissions.forEach((p) => perms.add(p)));
  const out: Record<string, unknown> = { ...data };
  for (const rule of FIELD_RULES) {
    if (perms.has(rule.permission)) continue;
    for (const f of rule.fields) delete out[f];
  }
  if (!perms.has("prix.voir")) {
    delete out.netto;
    delete out.brutto;
    // nested price fields: the manual amount of dents > 85 mm lives inside each panel
    if (out.panels && typeof out.panels === "object") {
      out.panels = Object.fromEntries(
        Object.entries(out.panels as Record<string, Record<string, unknown>>).map(([k, p]) => {
          const { bigEur: _drop, ...rest } = p;
          return [k, rest];
        }),
      );
    }
  }
  const shares = data.shares && typeof data.shares === "object" ? (data.shares as Record<string, unknown>) : null;
  if (!perms.has("repartition_interne.voir")) {
    delete out.shares;
    if (shares && perms.has("ma_part.voir")) out.myShare = { techEur: shares.techEur, demTechEur: shares.demTechEur };
    if (shares && perms.has("ma_commission.voir")) out.myCommission = { werkEur: shares.werkEur };
  }
  return out as Partial<T>;
}

/** Sites on which the user may act with `action` (null = all sites). Used to build SQL scopes. */
export function sitesWith(u: Principal, action: Action, orgId: string, now = new Date()): "all" | string[] {
  if (u.isSuperadmin) return "all";
  const ids = new Set<string>();
  for (const g of u.grants) {
    if (!live(g, now) || g.orgId !== orgId || !g.permissions.includes(action)) continue;
    if (g.stationId === null) return "all";
    ids.add(g.stationId);
  }
  return [...ids];
}
