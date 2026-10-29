import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { colibriPages } from "../src";

/** zlib stream whose last byte (Adler-32) is `last`, carrying one text item. */
function streamEndingWith(last: number): Buffer {
  for (let i = 0; i < 20000; i++) {
    const pad = String.fromCharCode(33 + (i % 90)) + String.fromCharCode(33 + (Math.floor(i / 90) % 90)).repeat(1 + (i % 7));
    const content = Buffer.from(`% ${pad}\n1 0 0 1 10 20 Tm <00410042> Tj\n`, "latin1");
    const z = deflateSync(content);
    if (z[z.length - 1] === last) return z;
  }
  throw new Error("no stream found");
}

/** Minimal PDF: stream object with the given dictionary length entry; `ref` = indirect /Length object. */
function pdf(z: Buffer, ref: boolean, eol: string): Uint8Array {
  const head = ref
    ? `%PDF-1.4\n1 0 obj\n<< /Length 2 0 R /Filter /FlateDecode >>\nstream\n`
    : `%PDF-1.4\n1 0 obj\n<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`;
  const tail = `${eol}endstream\nendobj\n` + (ref ? `2 0 obj\n${z.length}\nendobj\n` : "") + "%%EOF\n";
  return new Uint8Array(Buffer.concat([Buffer.from(head, "latin1"), z, Buffer.from(tail, "latin1")]));
}

describe("colibriPages: stream length", () => {
  for (const last of [0x0d, 0x0a, 0x20]) {
    for (const ref of [false, true]) {
      it(`reads a stream whose data ends with 0x${last.toString(16)} (${ref ? "/Length n 0 R" : "/Length n"})`, async () => {
        const pages = await colibriPages(pdf(streamEndingWith(last), ref, "\n"));
        expect(pages).toHaveLength(1);
        expect(pages[0][0]).toMatchObject({ x: 10, y: 20, s: "AB" });
      });
    }
  }
  it("falls back to stripping a single EOL when /Length is missing", async () => {
    const z = streamEndingWith(0x41);
    const raw = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n", "latin1"), z, Buffer.from("\r\nendstream\nendobj\n", "latin1")]);
    const pages = await colibriPages(new Uint8Array(raw));
    expect(pages).toHaveLength(1);
  });
});
