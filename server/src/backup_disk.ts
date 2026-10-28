// Nightly backup on a disk, for hosts without an object store (Render): the database dump goes to a folder (a disk mounted on the worker).
import { spawn } from "node:child_process";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** pg_dump (custom format) of `databaseUrl` as bytes */
export function pgDump(databaseUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const p = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--dbname", databaseUrl]);
    let stderr = "";
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 500)}`))));
  });
}

/** `pg_restore --list` on the dump: proves the file is a readable archive (its table of contents comes out); returns the number of entries */
export function pgRestoreList(bytes: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn("pg_restore", ["--list"]);
    let out = "", err = "";
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out.split("\n").filter((l) => l && !l.startsWith(";")).length) : reject(new Error(`pg_restore --list exited ${code}: ${err.slice(0, 300)}`))));
    p.stdin.on("error", () => undefined);
    p.stdin.end(bytes);
  });
}

export interface DiskBackupDeps { dump?: (url: string) => Promise<Buffer>; check?: (bytes: Buffer) => Promise<number> }

/**
 * Dump into `dir` as `hagel-YYYYMMDD-HHMM.dump`: written under a temporary name and renamed (a half-written file never looks like a backup),
 * checked (size, readable archive), backups older than `keepDays` are removed but the 3 newest always stay.
 */
export async function runDiskBackup(databaseUrl: string, dir: string, keepDays = 30, now = new Date(), deps: DiskBackupDeps = {}): Promise<{ file: string; bytes: number; entries: number; pruned: number }> {
  const bytes = await (deps.dump ?? pgDump)(databaseUrl);
  if (bytes.length < 1000) throw new Error("pg_dump output suspiciously small");
  const entries = await (deps.check ?? pgRestoreList)(bytes);
  if (entries < 10) throw new Error(`the dump lists only ${entries} entries`);
  await mkdir(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  const file = `hagel-${stamp}.dump`;
  await writeFile(join(dir, file + ".part"), bytes);
  await rename(join(dir, file + ".part"), join(dir, file));
  const all = (await readdir(dir)).filter((f) => /^hagel-\d{8}-\d{4}\.dump$/.test(f)).sort().reverse();
  let pruned = 0;
  for (const f of all.slice(3)) {
    const st = await stat(join(dir, f));
    if (now.getTime() - st.mtime.getTime() > keepDays * 86400_000) { await rm(join(dir, f)); pruned++; }
  }
  return { file, bytes: bytes.length, entries, pruned };
}
