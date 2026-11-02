import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import sharp from "sharp";

export interface ShrinkStep { maxEdge: number; quality: number }
/** From gentle to strong: the first step that makes the mail fit is used. */
export const SHRINK_LADDER: ShrinkStep[] = [{ maxEdge: 1600, quality: 75 }, { maxEdge: 1200, quality: 65 }, { maxEdge: 900, quality: 55 }, { maxEdge: 700, quality: 45 }];

/**
 * Re-encodes the JPEG photos inside a PDF (smaller edge, lower quality). The page layout, text and signatures are untouched. Only images
 * stored as plain JPEG (what `embedJpg` writes) are changed; anything else, and any image that would not get smaller, stays as it is.
 */
export async function shrinkPdfImages(bytes: Uint8Array, step: ShrinkStep): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.get(PDFName.of("Subtype")) !== PDFName.of("Image") || d.get(PDFName.of("Filter")) !== PDFName.of("DCTDecode")) continue;
    if (d.get(PDFName.of("ColorSpace")) === PDFName.of("DeviceCMYK")) continue;
    let out: { data: Buffer; info: { width: number; height: number } };
    try {
      // no rotate(): the PDF shows the raw pixels, the EXIF orientation was never applied there
      out = await sharp(Buffer.from(obj.contents)).resize({ width: step.maxEdge, height: step.maxEdge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: step.quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    } catch { continue; } // unreadable image: keep the original
    if (out.data.length >= obj.contents.length) continue;
    const dict = d.clone();
    dict.set(PDFName.of("Width"), PDFNumber.of(out.info.width));
    dict.set(PDFName.of("Height"), PDFNumber.of(out.info.height));
    dict.set(PDFName.of("Length"), PDFNumber.of(out.data.length));
    doc.context.assign(ref, PDFRawStream.of(dict, new Uint8Array(out.data)));
  }
  return doc.save();
}
