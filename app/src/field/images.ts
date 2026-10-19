/** Downscale an image file to a JPEG (browser only). Photos: max 1280 px, quality 0.6 (v20 behaviour). */
export function downscale(file: Blob, max = 1280, quality = 0.6): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d")!.drawImage(img, 0, 0, w, h);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });
}

export const blobToBase64 = (b: Blob): Promise<string> =>
  new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

/** Grayscale + contrast stretch before Tesseract (v20 prepImage). */
export function prepForOcr(file: Blob, maxW = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const sc = Math.min(1, maxW / img.width), w = Math.round(img.width * sc), h = Math.round(img.height * sc);
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const cx = cv.getContext("2d")!; cx.drawImage(img, 0, 0, w, h);
      const d = cx.getImageData(0, 0, w, h), a = d.data;
      let mn = 255, mx = 0;
      for (let i = 0; i < a.length; i += 4) { const g = (a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114) | 0; a[i] = a[i + 1] = a[i + 2] = g; if (g < mn) mn = g; if (g > mx) mx = g; }
      const rng = Math.max(1, mx - mn);
      for (let i = 0; i < a.length; i += 4) { const g = Math.max(0, Math.min(255, (((a[i] - mn) * 255) / rng) | 0)); a[i] = a[i + 1] = a[i + 2] = g; }
      cx.putImageData(d, 0, 0);
      resolve(cv.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });
}
