// V5: body shops are customers, not places. Every vehicle that still STANDS in a body shop (vehicles.station_id -> a "carrosserie")
// is moved to the station "Chapauto" of the same organisation. The customer (client_station_id) never changes.
//
//   DATABASE_URL=... npm run v5:move-bodyshop-vehicles -w @hagel/server                          DRY RUN: prints the list, writes nothing
//   DATABASE_URL=... npm run v5:move-bodyshop-vehicles -w @hagel/server -- --apply --confirm-backup   does it (one transaction)
//
// It stops (exit 1, nothing written) when something is not clear: no "Chapauto", several, or one that is itself a body shop or inactive,
// or anything else still placed in a body shop (role assignment as station, pending invitation, repair booking, Citas link, campaign).
// Re-running it is harmless: once nothing stands in a body shop any more the list is empty.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { audit } from "../audit";
import { createDb, type Db } from "../db";
import { campaignStations, citasLinks, invitations, organizations, repairBookings, roleAssignments, stations, vehicleMoves, vehicles } from "../schema";
import { nextSeq } from "../sync";

export const TARGET_STATION_NAME = "chapauto";
export const MOVE_NOTE = "moved to Chapauto – body shops are no longer stations";

/** lower case, accents and extra spaces ignored */
export const normName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export interface MoveItem { vehicleId: string; orgId: string; plate: string; fromStationId: string; fromName: string; toStationId: string; toName: string; statut: string; repairStage: string | null; deleted: boolean }
export interface MovePlan { items: MoveItem[]; problems: string[] }

export async function planBodyshopMove(db: Db): Promise<MovePlan> {
  const problems: string[] = [];
  const items: MoveItem[] = [];
  // explicit columns: the dry run also works on a database that does not have the V5 migration yet
  const cols = { id: stations.id, orgId: stations.orgId, name: stations.name, type: stations.type, active: stations.active };
  const shops = await db.select(cols).from(stations).where(eq(stations.type, "carrosserie"));
  const shopIds = shops.map((s) => s.id);
  if (!shopIds.length) return { items, problems };
  const rows = await db.select().from(vehicles).where(inArray(vehicles.stationId, shopIds));
  const orgs = new Map((await db.select().from(organizations)).map((o) => [o.id, o.name]));
  const all = await db.select(cols).from(stations);

  for (const orgId of [...new Set(rows.map((r) => r.orgId))]) {
    const orgName = orgs.get(orgId) ?? orgId;
    const cands = all.filter((s) => s.orgId === orgId && normName(s.name) === TARGET_STATION_NAME);
    if (cands.length === 0) { problems.push(`${orgName}: no station named "Chapauto" (vehicles stand in a body shop): ask Nicolas, do not create one`); continue; }
    if (cands.length > 1) { problems.push(`${orgName}: ${cands.length} stations named "Chapauto" (${cands.map((c) => c.id).join(", ")}): ask Nicolas which one`); continue; }
    const target = cands[0];
    if (target.type === "carrosserie") { problems.push(`${orgName}: "Chapauto" is itself a body shop: ask Nicolas`); continue; }
    if (!target.active) { problems.push(`${orgName}: "Chapauto" is inactive: ask Nicolas`); continue; }
    for (const v of rows.filter((r) => r.orgId === orgId)) {
      const from = shops.find((s) => s.id === v.stationId)!;
      items.push({
        vehicleId: v.id, orgId, plate: String((v.header as Record<string, unknown>).kennzeichen ?? ""), fromStationId: from.id, fromName: from.name,
        toStationId: target.id, toName: target.name, statut: v.statut, repairStage: v.repairStage, deleted: !!v.deletedAt,
      });
    }
  }

  // anything else placed in a body shop: nothing is moved automatically, Nicolas decides
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const asStation = await count(db.select({ n: sql<number>`count(*)::int` }).from(roleAssignments).where(inArray(roleAssignments.stationId, shopIds)));
  if (asStation) problems.push(`${asStation} role assignment(s) have a body shop as STATION`);
  const invites = await count(db.select({ n: sql<number>`count(*)::int` }).from(invitations).where(and(inArray(invitations.stationId, shopIds), isNull(invitations.usedAt))));
  if (invites) problems.push(`${invites} pending invitation(s) have a body shop as station`);
  const bookings = await count(db.select({ n: sql<number>`count(*)::int` }).from(repairBookings).where(sql`${repairBookings.stationId} in ${shopIds} or ${repairBookings.originStationId} in ${shopIds}`));
  if (bookings) problems.push(`${bookings} repair booking(s) have a body shop as place or origin`);
  const citas = await count(db.select({ n: sql<number>`count(*)::int` }).from(citasLinks).where(inArray(citasLinks.stationId, shopIds)));
  if (citas) problems.push(`${citas} Citas link(s) point to a body shop`);
  const camps = await count(db.select({ n: sql<number>`count(*)::int` }).from(campaignStations).where(inArray(campaignStations.stationId, shopIds)));
  if (camps) problems.push(`${camps} campaign(s) list a body shop as station`);
  return { items, problems };
}

/** Moves the vehicles of a plan in ONE transaction: new place, history (vehicle_moves) and audit entry per vehicle, new sync sequence so the phones pick it up. */
export async function applyBodyshopMove(db: Db, plan: MovePlan): Promise<number> {
  if (plan.problems.length) throw new Error("the plan has open problems: nothing was written");
  if (!plan.items.length) return 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7001)`); // same lock as every sync write: sequence order = commit order
    for (const it of plan.items) {
      const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, it.vehicleId)).for("update");
      if (!v || v.stationId !== it.fromStationId) continue; // changed since the plan was made: leave it
      const seq = await nextSeq(tx);
      const stamps = { ...((v.groupAt ?? {}) as Record<string, number>), site: Date.now() };
      await tx.update(vehicles).set({ stationId: it.toStationId, seq, groupAt: stamps, updatedAt: new Date() }).where(eq(vehicles.id, v.id));
      await tx.insert(vehicleMoves).values({ vehicleId: v.id, fromStationId: it.fromStationId, toStationId: it.toStationId, userId: null, note: MOVE_NOTE });
      await audit(tx as unknown as Db, {
        orgId: v.orgId, userId: null, action: "v5.move_bodyshop_vehicle", entity: "vehicle", entityId: v.id,
        before: { stationId: it.fromStationId, station: it.fromName }, after: { stationId: it.toStationId, station: it.toName, note: MOVE_NOTE },
      });
    }
  });
  return plan.items.length;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required"); process.exit(2); }
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--confirm-backup")) { console.error("--apply needs --confirm-backup (a full backup was taken and checked)"); process.exit(2); }
  const { db, close } = await createDb(url, { migrate: false });
  const plan = await planBodyshopMove(db);
  console.log(`${plan.items.length} vehicle(s) stand in a body shop:`);
  for (const it of plan.items) console.log(`  ${it.plate || "(no plate)"}\t${it.fromName} -> ${it.toName}\t${it.statut}${it.repairStage ? " / " + it.repairStage : ""}${it.deleted ? "\t(deleted)" : ""}`);
  for (const p of plan.problems) console.log(`PROBLEM: ${p}`);
  if (plan.problems.length) { await close(); process.exit(1); }
  if (!apply) { console.log("Dry run: nothing written. Add --apply --confirm-backup to move them."); await close(); return; }
  console.log(`moved: ${await applyBodyshopMove(db, plan)}`);
  await close();
}

if (process.argv[1] && /v5_move_bodyshop_vehicles/.test(process.argv[1])) void main();
