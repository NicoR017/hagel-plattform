// Fake data for the STAGING environment only (no production data). Idempotent: does nothing for an organisation that already has vehicles.
//
//   APP_ENV=staging DATABASE_URL=<staging url> STAGING_TEST_PASSWORD=<10+ chars> SEED_SUPERADMIN_EMAIL=... npm run seed:staging -w @hagel/server
//
// Refuses to run unless APP_ENV=staging, and refuses a database that already holds more than a handful of real-looking users.
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../db";
import { hashPassword } from "../crypto";
import { seed } from "../seed";
import { systemMethodFor } from "../methods";
import { nextSeq } from "../sync";
import { insurers, memberships, organizations, roleAssignments, roles, stationInsurers, stations, technicians, users, vehicleAssignments, vehicles, vehicleStatusHistory } from "../schema";

const PEOPLE = [
  { key: "chef", email: "chef@staging.test", name: "Test Chef", role: "chef_site" },
  { key: "assessor", email: "assessor@staging.test", name: "Test Aufnehmer", role: "aufnehmer" },
  { key: "tech", email: "tech@staging.test", name: "Test Techniker", role: "technicien" },
];
const MODELS = ["VW Golf", "BMW 320d", "Audi A4", "Seat León", "Toyota C-HR", "Renault Captur", "Kia Sportage", "Skoda Octavia"];
const STATUSES = ["arrive", "besichtigung", "besichtigung", "attente", "reparatur", "reparatur", "fertig", "rendu"] as const;
const PANELS = ["haube", "dach", "tuer_vl", "kfl_vr", "heck"];

export async function seedStaging(db: Db, o: { password: string; superadminEmail: string }) {
  const { orgs, superadmin } = await seed(db, { superadminEmail: o.superadminEmail, testSites: true });
  const pwHash = await hashPassword(o.password);
  // the super-admin can sign in with the test password too (staging has no real mail to send a magic link)
  if (!superadmin.passwordHash) await db.update(users).set({ passwordHash: pwHash }).where(eq(users.id, superadmin.id));
  const summary: Record<string, number> = {};
  for (const org of orgs) {
    const country = org.country as "DE" | "ES";
    if ((await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.orgId, org.id)).limit(1)).length) { summary[org.name] = 0; continue; }
    let sts = await db.select().from(stations).where(eq(stations.orgId, org.id));
    if (!sts.length) {
      sts = await db.insert(stations).values([
        { orgId: org.id, type: "carrosserie", name: "Karosserie Teststadt", country, capacite: 30, commissionMode: "pct", commissionPct: "10" },
        { orgId: org.id, type: "hall", name: "PDR Halle Test", country, capacite: 60 },
      ]).returning();
    }
    const site = sts.find((s) => s.type === "carrosserie") ?? sts[0];
    // one fake insurer (receives reports, fake address) linked to the carrosserie: shows the automatic recipient of the station list
    const [fakeIns] = await db.insert(insurers).values({ orgId: org.id, name: "Test Versicherung", reportEmails: ["schaden@versicherung.staging.test"], sendReports: true, reportsToSend: "both" }).returning();
    await db.insert(stationInsurers).values({ stationId: site.id, insurerId: fakeIns.id });
    const roleRows = await db.select().from(roles).where(eq(roles.orgId, org.id));
    const people: Record<string, string> = {};
    for (const p of PEOPLE) {
      const email = `${country.toLowerCase()}.${p.email}`;
      let [u] = await db.select().from(users).where(eq(users.email, email));
      if (!u) [u] = await db.insert(users).values({ email, name: `${p.name} ${country}`, status: "active", passwordHash: pwHash }).returning();
      await db.insert(memberships).values({ userId: u.id, orgId: org.id }).onConflictDoNothing();
      const role = roleRows.find((r) => r.key === p.role);
      if (role) await db.insert(roleAssignments).values({ userId: u.id, orgId: org.id, stationId: site.id, roleId: role.id });
      people[p.key] = u.id;
    }
    // one PDR technician (with his account) and one headliner (without account), with default shares
    await db.insert(technicians).values([
      { orgId: org.id, name: "Test Techniker", userId: people.tech, kind: "pdr", defaultPctPdr: "50", defaultPctDemontage: "100" },
      { orgId: org.id, name: "Test Headliner", userId: null, kind: "headliner", email: "headliner@staging.test", defaultPctPdr: "50", defaultPctDemontage: "80" },
    ]);
    const method = await systemMethodFor(db, org.id, country);
    for (let i = 0; i < 16; i++) {
      const statut = STATUSES[i % STATUSES.length];
      const id = crypto.randomUUID();
      const panels = Object.fromEntries(PANELS.slice(0, 2 + (i % 4)).map((k) => [k, { key: k, dents: { "20": 4 + (i % 7), "30": 2 + (i % 3), "40": i % 3 } }]));
      await db.insert(vehicles).values({
        id, orgId: org.id, stationId: site.id, clientStationId: site.id, statut, statutDepuis: new Date(), seq: await nextSeq(db),
        repAt: statut === "reparatur" || statut === "fertig" ? new Date() : null,
        header: { land: country, kennzeichen: country === "ES" ? `${1000 + i} TST` : `TS-T ${100 + i}`, modell: MODELS[i % MODELS.length], kunde: site.name, leistungsdatum: "2026-10-20", teiler: 10, stundensatz: country === "ES" ? 69 : 83 },
        panels, panelsAt: {}, shares: { techName: "Test Techniker", techPct: 50, werkPct: 10, werkMode: "pct" }, groupAt: {},
        methodId: method?.id ?? null, methodVersion: method?.version ?? null,
      });
      await db.insert(vehicleStatusHistory).values({ vehicleId: id, statut });
      if (statut === "reparatur" || statut === "fertig") await db.insert(vehicleAssignments).values({ vehicleId: id, userId: people.tech, type: "pdr" });
    }
    summary[org.name] = 16;
  }
  return summary;
}

if (process.argv[1] && /seed_staging\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const { DATABASE_URL: url, APP_ENV, STAGING_TEST_PASSWORD: pw, SEED_SUPERADMIN_EMAIL: su } = process.env;
  if (APP_ENV !== "staging") { console.error("Refused: APP_ENV must be 'staging'"); process.exit(2); }
  if (!url || !pw || pw.length < 10 || !su) { console.error("DATABASE_URL, SEED_SUPERADMIN_EMAIL and STAGING_TEST_PASSWORD (>= 10 chars) are required"); process.exit(2); }
  const h = await createDb(url);
  try {
    const realUsers = (await h.db.select().from(users).where(eq(users.status, "active"))).filter((u) => !u.email.endsWith("@staging.test") && !u.isSuperadmin).length;
    if (realUsers > 3) { console.error(`Refused: ${realUsers} non-test users in this database — it looks like a copy of production data, fake data is not needed.`); process.exit(2); }
    console.log("seeded vehicles per organisation:", await seedStaging(h.db, { password: pw, superadminEmail: su }));
  } finally { await h.close(); }
}
