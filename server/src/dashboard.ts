import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { computeShares, computeVehicle, type CalcVehicle } from "@hagel/calc";
import { REPAIR_STAGES, STATUSES, isOffRepairHold } from "@hagel/shared";
import type { Db } from "./db";
import { effectivePermissions, type Principal } from "./permissions";
import { insurers, repairBookings, roleAssignments, stations, users, vehicleAssignments, vehicleMoves, vehicleStatusHistory, vehicles } from "./schema";
import { loadMethodMap, methodOf } from "./methods";
import { calcSettings, flatten, loadOrgSettings, occupancyOf, refOf } from "./sync";

export interface DashboardFilters { sites?: string[]; campaign?: string; client?: string; insurer?: string; from?: string; to?: string }

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const avg = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Start of the current calendar day in Europe/Berlin (also right for Spain: same time zone offset). */
export function berlinDayStart(now: Date): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((p) => [p.type, p.value]));
  const sinceMidnight = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return new Date(now.getTime() - sinceMidnight - now.getMilliseconds());
}

/** Calendar date (YYYY-MM-DD) of an instant in Europe/Berlin (same offset as Spain). */
export const berlinDate = (d: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const dateOf = (v: { header: unknown; createdAt: Date }): string => {
  const d = String((v.header as Record<string, unknown>)?.leistungsdatum ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : v.createdAt.toISOString().slice(0, 10);
};

/**
 * Everything the dashboard shows, limited to the vehicles `u` may see. Amounts only for vehicles where `u` may see prices,
 * the internal split only where `u` may see it. Every aggregate carries the vehicle ids behind it ("every number is clickable").
 */
export async function buildDashboard(db: Db, u: Principal, orgId: string, f: DashboardFilters, now = new Date()) {
  const settings = await loadOrgSettings(db, orgId);
  const delayDays = settings.delayDays ?? {};
  const allRows = await db.select().from(vehicles).where(and(eq(vehicles.orgId, orgId), isNull(vehicles.deletedAt)));
  const assign = await db.select().from(vehicleAssignments).where(inArray(vehicleAssignments.vehicleId, db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.orgId, orgId))));
  const assignees = new Map<string, string[]>();
  for (const a of assign) assignees.set(a.vehicleId, [...(assignees.get(a.vehicleId) ?? []), a.userId]);

  const siteSet = f.sites?.length ? new Set(f.sites) : null;
  const filteredRows = allRows.filter((r) => {
    const ref = refOf(r, assignees.get(r.id) ?? []);
    if (!effectivePermissions(u, ref).has("vehicules.voir")) return false;
    if (siteSet && !(r.stationId && siteSet.has(r.stationId))) return false;
    if (f.campaign && r.campaignId !== f.campaign) return false;
    if (f.client && r.clientStationId !== f.client) return false;
    if (f.insurer && r.insurerId !== f.insurer) return false;
    return true;
  });
  // refused cars (assessed, never repaired) are out of every figure: only their own counter below knows them
  const rows = filteredRows.filter((r) => r.statut !== "refuse");
  const refusedRows = filteredRows.filter((r) => r.statut === "refuse");
  const ids = rows.map((r) => r.id);
  const inPeriod = (d: Date | string) => {
    const day = typeof d === "string" ? d.slice(0, 10) : berlinDate(d);
    return (!f.from || day >= f.from) && (!f.to || day <= f.to);
  };

  const history = ids.length ? await db.select().from(vehicleStatusHistory).where(inArray(vehicleStatusHistory.vehicleId, ids)).orderBy(asc(vehicleStatusHistory.at)) : [];
  const moves = ids.length ? await db.select().from(vehicleMoves).where(inArray(vehicleMoves.vehicleId, ids)).orderBy(asc(vehicleMoves.at)) : [];
  const histBy = new Map<string, typeof history>();
  for (const h of history) histBy.set(h.vehicleId, [...(histBy.get(h.vehicleId) ?? []), h]);

  const allStations = await db.select().from(stations).where(eq(stations.orgId, orgId)).orderBy(asc(stations.name));
  const stName = new Map(allStations.map((s) => [s.id, s.name]));
  const today = berlinDayStart(now);
  const todayYmd = berlinDate(now);
  const bookedToday = await db.select({ stationId: repairBookings.stationId }).from(repairBookings)
    .where(and(eq(repairBookings.date, todayYmd), inArray(repairBookings.status, ["booked", "started"]), inArray(repairBookings.stationId, allStations.map((s) => s.id))));

  // ---- 1. sites
  const present = await occupancyOf(db, orgId, allStations.map((s) => s.id));
  const sitesOut = allStations
    .filter((s) => s.type !== "carrosserie" || s.capacite > 0 || rows.some((r) => r.stationId === s.id))
    .filter((s) => !siteSet || siteSet.has(s.id))
    .map((s) => {
      const here = rows.filter((r) => r.stationId === s.id);
      const presentHere = here.filter((r) => r.statut === "reparatur"); // occupancy = cars in repair
      const byStatus: Record<string, { n: number; ids: string[] }> = Object.fromEntries(STATUSES.map((st) => [st, { n: 0, ids: [] as string[] }]));
      for (const r of here) { byStatus[r.statut].n++; byStatus[r.statut].ids.push(r.id); }
      const arrIds = new Set<string>(), depIds = new Set<string>();
      for (const m of moves) {
        if (m.at < today) continue;
        if (m.toStationId === s.id) arrIds.add(m.vehicleId);
        if (m.fromStationId === s.id) depIds.add(m.vehicleId);
      }
      for (const r of rows) {
        // a car created today arrived at the site it was created on, even if it was moved since
        const firstMove = moves.find((m) => m.vehicleId === r.id);
        if (r.createdAt >= today && (firstMove ? firstMove.fromStationId : r.stationId) === s.id) arrIds.add(r.id);
        if (r.stationId === s.id && (histBy.get(r.id) ?? []).some((h) => h.statut === "rendu" && h.at >= today)) depIds.add(r.id);
      }
      // the repair board of the site: who stands in which column (cars in repair or finished, or in the repair flow; returned cars and cars on hold for an appointment / an approval leave)
      const byStage: Record<string, { n: number; ids: string[] }> = Object.fromEntries(REPAIR_STAGES.map((x) => [x, { n: 0, ids: [] as string[] }]));
      for (const r of here) {
        if (r.statut === "rendu" || isOffRepairHold(r.statut, r.statutMotif) || !(r.repairStage != null || r.statut === "reparatur" || r.statut === "fertig")) continue;
        const stage = (REPAIR_STAGES as readonly string[]).includes(r.repairStage ?? "") ? r.repairStage! : r.statut === "fertig" ? "finish" : "bereit";
        byStage[stage].n++; byStage[stage].ids.push(r.id);
      }
      const booked = bookedToday.filter((b) => b.stationId === s.id).length;
      return {
        id: s.id, name: s.name, type: s.type, capacity: s.capacite, byStage, repairsToday: { booked, capacity: s.repairsPerDay },
        // the occupancy of the whole site (also vehicles this user may not see) is what matters for the capacity; the lists only hold visible ones
        present: present[s.id] ?? 0, visiblePresent: presentHere.length, presentIds: presentHere.map((r) => r.id),
        byStatus, arrivalsToday: { n: arrIds.size, ids: [...arrIds] }, departuresToday: { n: depIds.size, ids: [...depIds] },
      };
    });

  // ---- 2. durations, delays, hold reasons
  const toReturned: number[] = [], repairTimes: number[] = [];
  for (const r of rows) {
    const h = histBy.get(r.id) ?? [];
    const rendu = [...h].reverse().find((x) => x.statut === "rendu");
    if (rendu && inPeriod(rendu.at)) toReturned.push((rendu.at.getTime() - r.createdAt.getTime()) / DAY);
    const start = h.find((x) => x.statut === "reparatur");
    const end = start ? h.find((x) => x.at > start.at && (x.statut === "fertig" || x.statut === "rendu")) : undefined;
    if (start && end && inPeriod(end.at)) repairTimes.push((end.at.getTime() - start.at.getTime()) / DAY);
  }
  const delayed = rows
    .filter((r) => r.statut !== "rendu" && r.statutDepuis && delayDays[r.statut] != null)
    .map((r) => ({ r, days: (now.getTime() - r.statutDepuis!.getTime()) / DAY }))
    .filter((x) => x.days > delayDays[x.r.statut])
    .sort((a, b) => b.days - a.days)
    .map(({ r, days }) => ({
      id: r.id, plate: String((r.header as Record<string, unknown>).kennzeichen ?? ""), statut: r.statut, motif: r.statutMotif, days: Math.floor(days),
      stationId: r.stationId, stationName: r.stationId ? stName.get(r.stationId) ?? "" : "", thresholdDays: delayDays[r.statut],
    }));
  const holdMap = new Map<string, string[]>();
  for (const r of rows) if (r.statut === "attente") holdMap.set(r.statutMotif || "—", [...(holdMap.get(r.statutMotif || "—") ?? []), r.id]);
  const hold = [...holdMap].map(([reason, vs]) => ({ reason, n: vs.length, ids: vs })).sort((a, b) => b.n - a.n);

  // ---- 3. technicians
  const userIds = [...new Set(rows.flatMap((r) => assignees.get(r.id) ?? []))];
  const people = userIds.length ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds)) : [];
  const roles = userIds.length ? await db.select().from(roleAssignments).where(and(eq(roleAssignments.orgId, orgId), inArray(roleAssignments.userId, userIds))) : [];
  const roleSites = (uid: string) => roles.filter((x) => x.userId === uid && (!x.expiresAt || x.expiresAt > now));
  const techs = new Map<string, { key: string; name: string; assigned: string[]; inProgress: string[]; finished: string[]; siteIds: Set<string>; noRoleOnSite: string[] }>();
  const techOf = (key: string, name: string) => { if (!techs.has(key)) techs.set(key, { key, name, assigned: [], inProgress: [], finished: [], siteIds: new Set(), noRoleOnSite: [] }); return techs.get(key)!; };
  for (const r of rows) {
    const keys: [string, string][] = (assignees.get(r.id) ?? []).map((uid) => [uid, people.find((p) => p.id === uid)?.name || people.find((p) => p.id === uid)?.email || uid]);
    const techName = String((r.header as Record<string, unknown>).techName ?? "") || String((r.shares as Record<string, unknown>)?.techName ?? "");
    if (!keys.length && techName) keys.push([`name:${techName}`, techName]);
    for (const [key, name] of keys) {
      const t = techOf(key, name);
      const finishedAt = (histBy.get(r.id) ?? []).filter((h) => h.statut === "fertig" || h.statut === "rendu").map((h) => h.at)[0];
      if (r.statut !== "rendu") t.assigned.push(r.id);
      if (r.statut === "reparatur") t.inProgress.push(r.id);
      if (finishedAt && inPeriod(finishedAt)) t.finished.push(r.id);
      if (r.stationId && r.statut !== "rendu") {
        t.siteIds.add(r.stationId);
        if (!key.startsWith("name:") && !roleSites(key).some((x) => x.stationId === null || x.stationId === r.stationId)) t.noRoleOnSite.push(r.id);
      }
    }
  }
  const techOut = [...techs.values()].map((t) => ({
    key: t.key, name: t.name, assigned: { n: t.assigned.length, ids: t.assigned }, inProgress: { n: t.inProgress.length, ids: t.inProgress },
    finished: { n: t.finished.length, ids: t.finished }, sites: [...t.siteIds].map((id) => ({ id, name: stName.get(id) ?? "" })),
    noRoleOnSite: { n: t.noRoleOnSite.length, ids: t.noRoleOnSite },
  })).sort((a, b) => a.name.localeCompare(b.name));

  // ---- 4. revenue (only vehicles whose prices this user may see)
  const calcs = calcSettings(settings);
  const methods = await loadMethodMap(db, orgId);
  type Agg = { net: number; ids: string[] };
  const bump = (m: Map<string, Agg>, key: string, net: number, id: string) => { const a = m.get(key) ?? { net: 0, ids: [] }; a.net = round2(a.net + net); a.ids.push(id); m.set(key, a); };
  const bySite = new Map<string, Agg>(), byClient = new Map<string, Agg>(), byInsurer = new Map<string, Agg>(), byMonth = new Map<string, Agg>();
  let total = 0, seen = 0;
  const split = { technicians: 0, commissions: 0, rest: 0, seen: 0 };
  const revIds: string[] = [];
  for (const r of rows) {
    const ref = refOf(r, assignees.get(r.id) ?? []);
    const eff = effectivePermissions(u, ref);
    if (!eff.has("prix.voir")) continue;
    const d = dateOf(r);
    if (!inPeriod(d)) continue;
    const flat = flatten(r, assignees.get(r.id) ?? [], null);
    const calc = computeVehicle(flat as unknown as CalcVehicle, calcs, methodOf(methods, r));
    if (!calc.netto) continue;
    seen++; total = round2(total + calc.netto); revIds.push(r.id);
    bump(bySite, r.stationId ?? "", calc.netto, r.id); bump(byClient, r.clientStationId ?? "", calc.netto, r.id);
    bump(byInsurer, r.insurerId ?? "", calc.netto, r.id); bump(byMonth, d.slice(0, 7), calc.netto, r.id);
    if (eff.has("repartition_interne.voir")) {
      const sh = computeShares(flat as never, calc);
      split.technicians = round2(split.technicians + sh.techEur + sh.demTechEur); split.commissions = round2(split.commissions + sh.werkEur);
      split.rest = round2(split.rest + sh.rest); split.seen++;
    }
  }
  const named = (m: Map<string, Agg>, names: (id: string) => string) => [...m].map(([id, a]) => ({ id, name: id ? names(id) : "—", net: a.net, n: a.ids.length, ids: a.ids })).sort((a, b) => b.net - a.net);
  const insurerRows = await db.select().from(insurers).where(eq(insurers.orgId, orgId));
  const insName = new Map(insurerRows.map((i) => [i.id, i.name]));
  const revenue = seen === 0 && !rows.some((r) => effectivePermissions(u, refOf(r, assignees.get(r.id) ?? [])).has("prix.voir")) ? null : {
    total, n: seen, ids: revIds,
    bySite: named(bySite, (id) => stName.get(id) ?? "—"), byClient: named(byClient, (id) => stName.get(id) ?? "—"),
    byInsurer: named(byInsurer, (id) => insName.get(id) ?? "—"),
    byMonth: [...byMonth].map(([month, a]) => ({ month, net: a.net, n: a.ids.length, ids: a.ids })).sort((a, b) => a.month.localeCompare(b.month)),
    split: split.seen ? { technicians: split.technicians, commissions: split.commissions, rest: split.rest, n: split.seen } : null,
  };

  // ---- 5. body shops x insurers (v5 2.3): the vehicles of the period, grouped by (body shop, insurer) = the Colibri "business customer - insurance" link
  type LinkRow = {
    key: string; clientId: string | null; clientName: string; insurerId: string | null; insurerName: string;
    vehicles: Ids; waiting: Ids; repair: Ids; finished: Ids; avgDays: number | null; net?: number;
  };
  type Ids = { n: number; ids: string[] };
  const linkVehicles = rows.filter((r) => inPeriod(dateOf(r)));
  const mayNet = (r: (typeof rows)[number]) => effectivePermissions(u, refOf(r, assignees.get(r.id) ?? [])).has("prix.voir");
  const anyNet = linkVehicles.some(mayNet); // without the price permission the key `net` does not exist at all
  const netOf = new Map<string, number>();
  if (anyNet) {
    for (const r of linkVehicles) {
      if (!mayNet(r)) continue;
      const calc = computeVehicle(flatten(r, assignees.get(r.id) ?? [], null) as unknown as CalcVehicle, calcs, methodOf(methods, r));
      netOf.set(r.id, calc.netto || 0);
    }
  }
  const groupLinks = (keyOf: (r: (typeof rows)[number]) => { clientId: string | null; insurerId: string | null }): LinkRow[] => {
    const g = new Map<string, { clientId: string | null; insurerId: string | null; rs: typeof rows }>();
    for (const r of linkVehicles) {
      const k = keyOf(r), key = `${k.clientId ?? ""}|${k.insurerId ?? ""}`;
      if (!g.has(key)) g.set(key, { ...k, rs: [] });
      g.get(key)!.rs.push(r);
    }
    const ids = (xs: typeof rows): Ids => ({ n: xs.length, ids: xs.map((x) => x.id) });
    return [...g].map(([key, { clientId, insurerId, rs }]) => {
      const days = rs.flatMap((r) => {
        const back = [...(histBy.get(r.id) ?? [])].reverse().find((h) => h.statut === "rendu");
        return back ? [(back.at.getTime() - r.createdAt.getTime()) / DAY] : [];
      });
      const row: LinkRow = {
        key, clientId, clientName: clientId ? stName.get(clientId) ?? "" : "", insurerId, insurerName: insurerId ? insName.get(insurerId) ?? "" : "",
        vehicles: ids(rs), waiting: ids(rs.filter((r) => r.statut === "arrive" || r.statut === "besichtigung" || r.statut === "attente")),
        repair: ids(rs.filter((r) => r.statut === "reparatur")), finished: ids(rs.filter((r) => r.statut === "fertig" || r.statut === "rendu")), avgDays: avg(days),
      };
      if (anyNet) row.net = round2(rs.reduce((a, r) => a + (netOf.get(r.id) ?? 0), 0));
      return row;
    }).sort((a, b) => b.vehicles.n - a.vehicles.n || (a.clientName + a.insurerName).localeCompare(b.clientName + b.insurerName));
  };
  const linkTable = {
    byLink: groupLinks((r) => ({ clientId: r.clientStationId, insurerId: r.insurerId })),
    byClient: groupLinks((r) => ({ clientId: r.clientStationId, insurerId: null })),
    byInsurer: groupLinks((r) => ({ clientId: null, insurerId: r.insurerId })),
  };

  // cars that became "fertig" (or were handed back directly) in the period
  const finishedIds = rows.filter((r) => {
    const e = (histBy.get(r.id) ?? []).find((h) => h.statut === "fertig" || h.statut === "rendu");
    return !!e && inPeriod(e.at);
  }).map((r) => r.id);
  const uniq = (xs: string[]) => [...new Set(xs)];
  const arrIds = uniq(sitesOut.flatMap((x) => x.arrivalsToday.ids)), depIds = uniq(sitesOut.flatMap((x) => x.departuresToday.ids));
  const kpis = {
    present: { n: sitesOut.reduce((a, x) => a + x.visiblePresent, 0), ids: sitesOut.flatMap((x) => x.presentIds) },
    arrivalsToday: { n: arrIds.length, ids: arrIds },
    departuresToday: { n: depIds.length, ids: depIds },
    delayed: { n: delayed.length, ids: delayed.map((d) => d.id) },
    finished: { n: finishedIds.length, ids: finishedIds },
    refused: (() => { const ids = refusedRows.filter((r) => inPeriod(r.statutDepuis ?? r.updatedAt)).map((r) => r.id); return { n: ids.length, ids }; })(),
    fullSites: sitesOut.filter((x) => x.capacity > 0 && x.present >= x.capacity).map((x) => ({ id: x.id, name: x.name, present: x.present, capacity: x.capacity })),
  };

  return {
    generatedAt: now.toISOString(), vehicles: rows.length, delayDays, kpis,
    sites: sitesOut,
    durations: { avgArrivalToReturnedDays: avg(toReturned), avgRepairDays: avg(repairTimes), returnedSamples: toReturned.length, repairSamples: repairTimes.length },
    delayed, hold, technicians: techOut, revenue, linkTable,
  };
}

// ------------------------------------------------------------------ weekly technician sheet

export interface TechSheetVehicle { id: string; plate: string; model: string; start: string | null; end: string; aw: number; pdrEur: number; demEur: number; eur: number }
export interface TechSheet { technician: string; sites: string[]; vehicles: TechSheetVehicle[]; totals: { n: number; aw: number; pdrEur: number; demEur: number; eur: number } }

/**
 * Who has to be paid how much for the cars finished in [from, to]: the technician share of the PDR work (techName) and of the
 * de-/re-mounting (demTechName) of every car that became "fertig" (or "rendu") in the period. Only cars where the user may see the
 * internal split are considered; nothing else is ever returned.
 */
export async function buildTechSheets(db: Db, u: Principal, orgId: string, f: DashboardFilters): Promise<{ from: string | null; to: string | null; sheets: TechSheet[] }> {
  const settings = await loadOrgSettings(db, orgId);
  const calcs = calcSettings(settings);
  const methods = await loadMethodMap(db, orgId);
  const allRows = await db.select().from(vehicles).where(and(eq(vehicles.orgId, orgId), isNull(vehicles.deletedAt)));
  const assign = await db.select().from(vehicleAssignments).where(inArray(vehicleAssignments.vehicleId, db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.orgId, orgId))));
  const assignees = new Map<string, string[]>();
  for (const a of assign) assignees.set(a.vehicleId, [...(assignees.get(a.vehicleId) ?? []), a.userId]);
  const siteSet = f.sites?.length ? new Set(f.sites) : null;
  const rows = allRows.filter((r) => {
    const eff = effectivePermissions(u, refOf(r, assignees.get(r.id) ?? []));
    if (r.statut === "refuse" || !eff.has("vehicules.voir") || !eff.has("repartition_interne.voir")) return false;
    if (siteSet && !(r.stationId && siteSet.has(r.stationId))) return false;
    return (!f.campaign || r.campaignId === f.campaign) && (!f.client || r.clientStationId === f.client) && (!f.insurer || r.insurerId === f.insurer);
  });
  const ids = rows.map((r) => r.id);
  const history = ids.length ? await db.select().from(vehicleStatusHistory).where(inArray(vehicleStatusHistory.vehicleId, ids)).orderBy(asc(vehicleStatusHistory.at)) : [];
  const histBy = new Map<string, typeof history>();
  for (const h of history) histBy.set(h.vehicleId, [...(histBy.get(h.vehicleId) ?? []), h]);
  const userIds = [...new Set(rows.flatMap((r) => assignees.get(r.id) ?? []))];
  const people = userIds.length ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds)) : [];
  const personName = (id: string) => people.find((p) => p.id === id)?.name || people.find((p) => p.id === id)?.email || "";
  const stationRows = await db.select().from(stations).where(eq(stations.orgId, orgId));
  const stName = new Map(stationRows.map((s) => [s.id, s.name]));

  const by = new Map<string, TechSheet>();
  const sheetOf = (name: string) => { if (!by.has(name)) by.set(name, { technician: name, sites: [], vehicles: [], totals: { n: 0, aw: 0, pdrEur: 0, demEur: 0, eur: 0 } }); return by.get(name)!; };
  for (const r of rows) {
    const h = histBy.get(r.id) ?? [];
    const end = h.find((x) => x.statut === "fertig") ?? h.find((x) => x.statut === "rendu");
    if (!end) continue;
    const endDay = berlinDate(end.at);
    if ((f.from && endDay < f.from) || (f.to && endDay > f.to)) continue;
    const start = h.find((x) => x.statut === "reparatur");
    const flat = flatten(r, assignees.get(r.id) ?? [], null);
    const calc = computeVehicle(flat as unknown as CalcVehicle, calcs, methodOf(methods, r));
    const sh = computeShares(flat as never, calc);
    const firstAssignee = (assignees.get(r.id) ?? []).map(personName).find(Boolean) ?? "";
    const pdrName = (sh.techName || firstAssignee || "—").trim();
    const demName = (sh.demTechName || sh.techName || firstAssignee || "—").trim();
    const header = r.header as Record<string, unknown>;
    const base = { id: r.id, plate: String(header.kennzeichen ?? ""), model: String(header.modell ?? ""), start: start ? berlinDate(start.at) : null, end: endDay };
    const add = (name: string, pdrEur: number, demEur: number, aw: number) => {
      if (pdrEur <= 0 && demEur <= 0) return;
      const t = sheetOf(name);
      const site = r.stationId ? stName.get(r.stationId) : "";
      if (site && !t.sites.includes(site)) t.sites.push(site);
      t.vehicles.push({ ...base, aw: round2(aw), pdrEur: round2(pdrEur), demEur: round2(demEur), eur: round2(pdrEur + demEur) });
    };
    if (pdrName === demName) add(pdrName, sh.techEur, sh.demTechEur, calc.totalAW);
    else { add(pdrName, sh.techEur, 0, calc.totalAW); add(demName, 0, sh.demTechEur, 0); }
  }
  const sum = (t: TechSheet, k: "aw" | "pdrEur" | "demEur" | "eur") => round2(t.vehicles.reduce((a, v) => a + v[k], 0));
  const sheets = [...by.values()].map((t) => {
    t.vehicles.sort((a, b) => a.end.localeCompare(b.end) || a.plate.localeCompare(b.plate));
    t.totals = { n: new Set(t.vehicles.map((v) => v.id)).size, aw: sum(t, "aw"), pdrEur: sum(t, "pdrEur"), demEur: sum(t, "demEur"), eur: sum(t, "eur") };
    return t;
  }).sort((a, b) => a.technician.localeCompare(b.technician, "de"));
  return { from: f.from ?? null, to: f.to ?? null, sheets };
}

// ------------------------------------------------------------------ export of the finished / returned cars

export interface FinishedExportRow { id: string; plate: string; model: string; insurer: string; bodyshop: string; station: string; end: string; total: number; technician: number; headliner: number; referrer: number; pdr: number }

/**
 * The cars that are "fertig" or "rendu" right now and became finished in [from, to] (date of the first "fertig", else "rendu" entry in the status
 * history), with the agreed net price and its split: technician, headliner (de-/re-mounting), referring body shop (commission) and the rest for
 * PDR Team. Only cars where `u` may see prices, the internal split and export to Excel; nothing else is ever returned.
 */
export async function buildFinishedExport(db: Db, u: Principal, orgId: string, f: DashboardFilters): Promise<{ from: string | null; to: string | null; rows: FinishedExportRow[] }> {
  const settings = await loadOrgSettings(db, orgId);
  const calcs = calcSettings(settings);
  const methods = await loadMethodMap(db, orgId);
  const allRows = await db.select().from(vehicles).where(and(eq(vehicles.orgId, orgId), isNull(vehicles.deletedAt), inArray(vehicles.statut, ["fertig", "rendu"])));
  const assign = allRows.length ? await db.select().from(vehicleAssignments).where(inArray(vehicleAssignments.vehicleId, allRows.map((r) => r.id))) : [];
  const assignees = new Map<string, string[]>();
  for (const a of assign) assignees.set(a.vehicleId, [...(assignees.get(a.vehicleId) ?? []), a.userId]);
  const siteSet = f.sites?.length ? new Set(f.sites) : null;
  const rows = allRows.filter((r) => {
    const eff = effectivePermissions(u, refOf(r, assignees.get(r.id) ?? []));
    if (!eff.has("vehicules.voir") || !eff.has("prix.voir") || !eff.has("repartition_interne.voir") || !eff.has("export.excel")) return false;
    if (siteSet && !(r.stationId && siteSet.has(r.stationId))) return false;
    return (!f.campaign || r.campaignId === f.campaign) && (!f.client || r.clientStationId === f.client) && (!f.insurer || r.insurerId === f.insurer);
  });
  const ids = rows.map((r) => r.id);
  const history = ids.length ? await db.select().from(vehicleStatusHistory).where(inArray(vehicleStatusHistory.vehicleId, ids)).orderBy(asc(vehicleStatusHistory.at)) : [];
  const histBy = new Map<string, typeof history>();
  for (const h of history) histBy.set(h.vehicleId, [...(histBy.get(h.vehicleId) ?? []), h]);
  const stName = new Map((await db.select().from(stations).where(eq(stations.orgId, orgId))).map((s) => [s.id, s.name]));
  const insName = new Map((await db.select().from(insurers).where(eq(insurers.orgId, orgId))).map((i) => [i.id, i.name]));

  const out: FinishedExportRow[] = [];
  for (const r of rows) {
    const h = histBy.get(r.id) ?? [];
    const at = h.find((x) => x.statut === "fertig")?.at ?? h.find((x) => x.statut === "rendu")?.at ?? r.updatedAt;
    const end = berlinDate(at);
    if ((f.from && end < f.from) || (f.to && end > f.to)) continue;
    const flat = flatten(r, assignees.get(r.id) ?? [], null);
    const calc = computeVehicle(flat as unknown as CalcVehicle, calcs, methodOf(methods, r));
    const sh = computeShares(flat as never, calc);
    const header = r.header as Record<string, unknown>;
    out.push({
      id: r.id, plate: String(header.kennzeichen ?? ""), model: String(header.modell ?? ""),
      insurer: r.insurerId ? insName.get(r.insurerId) ?? "" : "",
      bodyshop: (r.clientStationId ? stName.get(r.clientStationId) : "") || String(header.kunde ?? ""),
      station: r.stationId ? stName.get(r.stationId) ?? "" : "", end,
      total: round2(calc.netto), technician: round2(sh.techEur), headliner: round2(sh.demTechEur), referrer: round2(sh.werkEur), pdr: round2(sh.rest),
    });
  }
  out.sort((a, b) => a.station.localeCompare(b.station, "de") || a.end.localeCompare(b.end) || a.plate.localeCompare(b.plate));
  return { from: f.from ?? null, to: f.to ?? null, rows: out };
}
