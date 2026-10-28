import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DiskStorage, storageFromEnv } from "../src/storage";

const dir = mkdtempSync(join(tmpdir(), "hagel-disk-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("file storage on a disk (hosts without an object store)", () => {
  it("keeps bytes and content type, survives a new instance, deletes", async () => {
    const s = new DiskStorage(dir);
    await s.put("photos/org/veh/ph1.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
    const again = new DiskStorage(dir);
    expect(await again.get("photos/org/veh/ph1.jpg")).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
    await again.delete("photos/org/veh/ph1.jpg");
    expect(await again.get("photos/org/veh/ph1.jpg")).toBeNull();
    expect(await again.get("photos/none.jpg")).toBeNull();
  });
  it("a key can never leave the folder", async () => {
    const s = new DiskStorage(dir);
    await expect(s.put("../escape.txt", new Uint8Array([1]), "text/plain")).rejects.toThrow();
    await expect(s.get("../../etc/passwd")).rejects.toThrow();
  });
  it("STORAGE_DIR selects it when no S3 settings exist", () => {
    expect(storageFromEnv({ STORAGE_DIR: dir })).toBeInstanceOf(DiskStorage);
  });
});
