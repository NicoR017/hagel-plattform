import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runDiskBackup } from "../src/backup_disk";

const dir = mkdtempSync(join(tmpdir(), "hagel-bk-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const big = Buffer.alloc(5000, 7);
const deps = { dump: async () => big, check: async () => 184 };

describe("nightly backup on a disk", () => {
  it("writes hagel-YYYYMMDD-HHMM.dump, nothing half written stays behind", async () => {
    const r = await runDiskBackup("postgres://x", dir, 30, new Date("2026-10-22T02:30:00Z"), deps);
    expect(r).toMatchObject({ file: "hagel-20261022-0230.dump", bytes: 5000, entries: 184, pruned: 0 });
    expect(readdirSync(dir)).toEqual(["hagel-20261022-0230.dump"]);
    expect(statSync(join(dir, r.file)).size).toBe(5000);
  });

  it("refuses a suspiciously small dump or an unreadable archive, and keeps what it had", async () => {
    const at = new Date("2026-10-23T02:30:00Z");
    await expect(runDiskBackup("postgres://x", dir, 30, at, { dump: async () => Buffer.alloc(10), check: async () => 184 })).rejects.toThrow(/small/);
    await expect(runDiskBackup("postgres://x", dir, 30, at, { dump: async () => big, check: async () => { throw new Error("not an archive"); } })).rejects.toThrow(/archive/);
    await expect(runDiskBackup("postgres://x", dir, 30, at, { dump: async () => big, check: async () => 3 })).rejects.toThrow(/entries/);
    expect(readdirSync(dir)).toEqual(["hagel-20261022-0230.dump"]);
  });

  it("removes backups older than the retention, but the 3 newest always stay", async () => {
    const old = (d: string, name: string, daysAgo: number) => { const p = join(d, name); writeFileSync(p, big); const t = new Date(Date.now() - daysAgo * 86400_000); utimesSync(p, t, t); };
    old(dir, "hagel-20250101-0230.dump", 400); old(dir, "hagel-20250102-0230.dump", 399); old(dir, "hagel-20250103-0230.dump", 398);
    const r = await runDiskBackup("postgres://x", dir, 30, new Date(), deps);
    expect(r.pruned).toBe(2); // 3 newest stay (the new one, the one of the first test, 20250103); the two older ones are past 30 days and go
    expect(readdirSync(dir).filter((f) => f.endsWith(".dump")).sort()).toEqual([r.file, "hagel-20250103-0230.dump", "hagel-20261022-0230.dump"].sort());
    expect(readdirSync(dir)).toContain(r.file);
  });

  it("with only old files, the 3 newest stay even beyond the retention", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "hagel-bk2-"));
    for (const n of ["hagel-20240101-0230.dump", "hagel-20240102-0230.dump", "hagel-20240103-0230.dump", "hagel-20240104-0230.dump"]) {
      const p = join(dir2, n); writeFileSync(p, big); const t = new Date("2024-01-05"); utimesSync(p, t, t);
    }
    const r = await runDiskBackup("postgres://x", dir2, 30, new Date("2024-06-01T02:30:00Z"), deps);
    expect(readdirSync(dir2).sort()).toEqual(["hagel-20240103-0230.dump", "hagel-20240104-0230.dump", "hagel-20240601-0230.dump"]);
    expect(r.pruned).toBe(2);
    rmSync(dir2, { recursive: true, force: true });
  });
});
