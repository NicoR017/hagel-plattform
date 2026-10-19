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
  console.warn("[storage] S3_* not set: using in-memory storage (files are lost on restart)");
  return new MemoryStorage();
}
