// Load check on a synthetic copy of the size of production x several: run with PERF=1 (skipped otherwise, it takes a while on the in-memory database).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vehicles, vehicleStatusHistory } from "../src/schema";
import { call, pull, setup, uuid, type Ctx } from "./helpers";

const N = Number(process.env.PERF_N ?? 3000);
let c: Ctx, A: string;

describe.skipIf(!process.env.PERF)("performance with many vehicles", () => {
  beforeAll(async () => {
    c = await setup();
    A = ((await call(c, "GET", "/admin/stations", { token: c.superToken, org: c.orgES })).body as { id: string; type: string }[]).find((s) => s.type === "carrosserie")!.id;
    const statuts = ["arrive", "besichtigung", "attente", "reparatur", "fertig", "rendu"];
    for (let i = 0; i < N; i += 500) {
      const rows = Array.from({ length: Math.min(500, N - i) }, (_, k) => ({
        id: uuid(), orgId: c.orgES, stationId: A, clientStationId: A, statut: statuts[(i + k) % 6], seq: i + k + 10,
        header: { land: "ES", kennzeichen: `PF ${i + k}`, modell: "Seat Leon", leistungsdatum: "2026-10-19", stundensatz: 69 },
        panels: { haube: { key: "haube", dents: { "20": 6 + (k % 7), "30": 3 } }, dach: { key: "dach", dents: { "20": 4, "40": 2 } } },
      }));
      const inserted = await c.h.db.insert(vehicles).values(rows as never).returning({ id: vehicles.id, statut: vehicles.statut });
      await c.h.db.insert(vehicleStatusHistory).values(inserted.filter((r) => r.statut === "fertig" || r.statut === "rendu").map((r) => ({ vehicleId: r.id, statut: "fertig", at: new Date() })));
    }
  }, 600_000);
  afterAll(async () => { await c?.h.close(); });

  const time = async <T,>(label: string, fn: () => Promise<T>) => { const t0 = performance.now(); const r = await fn(); const ms = Math.round(performance.now() - t0); console.log(`PERF ${label}: ${ms} ms`); return { r, ms }; };

  it("pull of everything, paged", async () => {
    let since = 0, n = 0, pages = 0;
    const { ms } = await time(`pull ${N} vehicles`, async () => {
      for (;;) {
        const p = await pull(c, c.superToken, c.orgES, since, undefined, 500);
        n += p.vehicles.length; pages++; since = p.cursor ?? p.nextSince ?? since;
        if (!p.hasMore && !p.more) break;
        if (pages > 50) break;
      }
    });
    expect(n).toBeGreaterThanOrEqual(N);
    expect(ms).toBeLessThan(120_000);
  }, 300_000);

  it("dashboard and weekly report", async () => {
    const d = await time("dashboard", () => call(c, "GET", "/dashboard", { token: c.superToken, org: c.orgES }));
    expect(d.r.status).toBe(200);
    const w = await time("weekly report", () => call(c, "GET", "/weekly-report?week=2026-W43", { token: c.superToken, org: c.orgES }));
    expect(w.r.status).toBe(200);
    expect(d.ms).toBeLessThan(60_000);
  }, 300_000);
});
