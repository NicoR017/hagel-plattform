import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** Private file storage (photos, Colibri PDFs). Files are only ever served through authenticated API routes. */
export interface Storage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export class MemoryStorage implements Storage {
  files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, bytes: Uint8Array, contentType: string) { this.files.set(key, { bytes: new Uint8Array(bytes), contentType }); }
  async get(key: string) { return this.files.get(key) ?? null; }
  async delete(key: string) { this.files.delete(key); }
}

/** Files on a (persistent) disk: for hosts without an object store. Keys stay inside `dir`; the content type sits in a `.type` file next to the bytes. */
export class DiskStorage implements Storage {
  private root: string;
  constructor(dir: string) { this.root = resolve(dir); }
  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error("invalid storage key");
    return p;
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
    await writeFile(p + ".type", contentType);
  }
  async get(key: string) {
    const p = this.path(key);
    try { return { bytes: new Uint8Array(await readFile(p)), contentType: (await readFile(p + ".type", "utf8").catch(() => "application/octet-stream")) }; }
    catch { return null; }
  }
  async delete(key: string) { const p = this.path(key); await rm(p, { force: true }); await rm(p + ".type", { force: true }); }
}

export interface S3Env { S3_ENDPOINT?: string; S3_REGION?: string; S3_BUCKET: string; S3_ACCESS_KEY_ID: string; S3_SECRET_ACCESS_KEY: string }

export class S3Storage implements Storage {
  private s3: S3Client;
  constructor(private env: S3Env) {
    this.s3 = new S3Client({
      region: env.S3_REGION ?? "auto", endpoint: env.S3_ENDPOINT, forcePathStyle: !!env.S3_ENDPOINT,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: bytes, ContentType: contentType }));
  }
  async get(key: string) {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      const bytes = await r.Body!.transformToByteArray();
      return { bytes, contentType: r.ContentType ?? "application/octet-stream" };
    } catch (e) {
      if ((e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }
  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
  }
}

export function storageFromEnv(env: Record<string, string | undefined> = process.env): Storage {
  if (env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    return new S3Storage({ S3_ENDPOINT: env.S3_ENDPOINT, S3_REGION: env.S3_REGION, S3_BUCKET: env.S3_BUCKET, S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY });
  }
  if (env.STORAGE_DIR) { console.log(`[storage] files on disk: ${env.STORAGE_DIR}`); return new DiskStorage(env.STORAGE_DIR); }
  console.warn("[storage] S3_* not set: using in-memory storage (files are lost on restart)");
  return new MemoryStorage();
}
