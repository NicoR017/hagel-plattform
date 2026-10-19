import { spawn } from "node:child_process";
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface BackupEnv {
  DATABASE_URL: string; S3_ENDPOINT?: string; S3_REGION?: string; S3_BUCKET: string; S3_ACCESS_KEY_ID: string; S3_SECRET_ACCESS_KEY: string;
}

export const s3From = (e: BackupEnv) =>
  new S3Client({
    region: e.S3_REGION ?? "auto", endpoint: e.S3_ENDPOINT, forcePathStyle: !!e.S3_ENDPOINT,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
  });

/** pg_dump (custom format) -> bucket `backups/hagel-YYYYMMDD-HHMM.dump`; prunes dumps older than `keepDays`. */
export async function runBackup(e: BackupEnv, keepDays = 30, now = new Date()): Promise<{ key: string; bytes: number; pruned: number }> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const p = spawn("pg_dump", ["--format=custom", "--no-owner", "--dbname", e.DATABASE_URL]);
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    let stderr = "";
    p.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 500)}`))));
  });
  const body = Buffer.concat(chunks);
  if (body.length < 1000) throw new Error("pg_dump output suspiciously small");
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  const key = `backups/hagel-${stamp}.dump`;
  const s3 = s3From(e);
  await s3.send(new PutObjectCommand({ Bucket: e.S3_BUCKET, Key: key, Body: body }));
  const list = await s3.send(new ListObjectsV2Command({ Bucket: e.S3_BUCKET, Prefix: "backups/" }));
  const old = (list.Contents ?? []).filter((o) => o.Key && o.LastModified && now.getTime() - o.LastModified.getTime() > keepDays * 86400_000);
  if (old.length) await s3.send(new DeleteObjectsCommand({ Bucket: e.S3_BUCKET, Delete: { Objects: old.map((o) => ({ Key: o.Key! })) } }));
  return { key, bytes: body.length, pruned: old.length };
}
