export interface TextItem { x: number; y: number; s: string }
export type Inflate = (bytes: Uint8Array) => Promise<Uint8Array | null>;

export function bin2str(u8: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH) as unknown as number[]);
  return s;
}

/** Default inflate: Web DecompressionStream (browser and Node >= 18). Tries zlib-wrapped, then raw deflate. */
export const inflateAny: Inflate = async (bytes) => {
  for (const fmt of ["deflate", "deflate-raw"] as const) {
    try {
      const ds = new DecompressionStream(fmt);
      const st = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(st).arrayBuffer());
    } catch {
      /* try next format */
    }
  }
  return null;
};

/** Declared /Length of the stream whose keyword starts at `streamIdx` (direct value or indirect `n g R`). */
function streamLength(s: string, streamIdx: number): number | null {
  const dictStart = s.lastIndexOf("obj", streamIdx);
  const dict = s.slice(dictStart, streamIdx + 1);
  const ref = /\/Length\s+(\d+)\s+(\d+)\s+R/.exec(dict);
  if (ref) {
    const o = new RegExp("(?:^|[^\\d])" + ref[1] + "\\s+" + ref[2] + "\\s+obj\\s*(\\d+)").exec(s);
    return o ? parseInt(o[1], 10) : null;
  }
  const d = /\/Length\s+(\d+)/.exec(dict);
  return d ? parseInt(d[1], 10) : null;
}

/**
 * Reads the original Colibri PDF: inflates every content stream and extracts
 * `1 0 0 1 x y Tm <hex> Tj` text items with coordinates (one array per page stream).
 */
export async function colibriPages(buf: ArrayBuffer | Uint8Array, inflate: Inflate = inflateAny): Promise<TextItem[][]> {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const s = bin2str(u8);
  const pages: TextItem[][] = [];
  const re = /[^d]stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const st = m.index + m[0].length;
    let en = s.indexOf("endstream", st);
    if (en < 0) continue;
    // Exact length from the stream dictionary (/Length n or /Length n 0 R): the compressed
    // data may itself end with 0x0A/0x0D/0x20 (Adler-32 byte), so never trim blindly.
    const len = streamLength(s, m.index);
    if (len != null && st + len <= en) en = st + len;
    else if (u8[en - 1] === 10) en -= u8[en - 2] === 13 ? 2 : 1; // only the EOL before endstream
    else if (u8[en - 1] === 13) en--;
    const inf = await inflate(u8.subarray(st, en));
    if (!inf) continue;
    const txt = bin2str(inf);
    if (txt.indexOf(" Tm") < 0 || txt.indexOf("Tj") < 0) continue;
    const items: TextItem[] = [];
    const tre = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\s*<([0-9A-Fa-f]+)>\s*Tj/g;
    let t: RegExpExecArray | null;
    while ((t = tre.exec(txt))) {
      const hex = t[3];
      let out = "";
      for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
      const val = out.replace(/\s+/g, " ").trim();
      if (val) items.push({ x: parseFloat(t[1]), y: parseFloat(t[2]), s: val });
    }
    if (items.length) pages.push(items);
  }
  return pages;
}
