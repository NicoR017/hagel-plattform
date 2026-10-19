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
    while (en > st && (u8[en - 1] === 10 || u8[en - 1] === 13 || u8[en - 1] === 32)) en--;
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
