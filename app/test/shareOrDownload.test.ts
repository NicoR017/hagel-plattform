// "Download" saves the file on a computer; only a phone or tablet goes through the share sheet.
import { afterEach, describe, expect, it, vi } from "vitest";
import { shareOrDownload, sharesFiles } from "../src/field/docs";

const UA = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

/** a browser that knows the share sheet for files, on the given device */
function browser(userAgent: string, o: { platform?: string; touch?: number } = {}) {
  const share = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { userAgent, platform: o.platform ?? "", maxTouchPoints: o.touch ?? 0, canShare: () => true, share });
  const clicks: { href: string; download: string }[] = [];
  vi.stubGlobal("document", { createElement: () => { const a = { href: "", download: "", click() { clicks.push({ href: a.href, download: a.download }); }, remove() {} }; return a; }, body: { appendChild() {} } });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined }));
  return { share, clicks };
}
afterEach(() => vi.unstubAllGlobals());

describe("shareOrDownload", () => {
  it("a computer (even with a share dialog and a touch screen): the file is downloaded under its name, nothing is shared", async () => {
    const b = browser(UA.windows, { platform: "Win32", touch: 10 });
    expect(await shareOrDownload(new Uint8Array([1, 2]), "Kostenvoranschlag_X.pdf", "application/pdf")).toBe(true);
    expect(b.share).not.toHaveBeenCalled();
    expect(b.clicks).toEqual([{ href: "blob:test", download: "Kostenvoranschlag_X.pdf" }]);
    expect(sharesFiles()).toBe(false);
  });
  it("a phone: the share sheet with the file, no download", async () => {
    for (const ua of [UA.android, UA.iphone]) {
      const b = browser(ua);
      expect(await shareOrDownload(new Uint8Array([1]), "a.pdf", "application/pdf", { title: "T" })).toBe(true);
      expect(b.share).toHaveBeenCalledTimes(1);
      expect(b.clicks).toHaveLength(0);
      expect(sharesFiles()).toBe(true);
    }
  });
  it("an iPad that presents itself as a Mac: also the share sheet", async () => {
    const b = browser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15", { platform: "MacIntel", touch: 5 });
    await shareOrDownload(new Uint8Array([1]), "a.pdf", "application/pdf");
    expect(b.share).toHaveBeenCalledTimes(1);
  });
  it("a real Mac: download", async () => {
    const b = browser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15", { platform: "MacIntel", touch: 0 });
    await shareOrDownload(new Uint8Array([1]), "a.pdf", "application/pdf");
    expect(b.share).not.toHaveBeenCalled();
    expect(b.clicks).toHaveLength(1);
  });
  it("a phone where the user cancels the share sheet: nothing is downloaded, false", async () => {
    const b = browser(UA.android);
    b.share.mockRejectedValueOnce(Object.assign(new Error("cancel"), { name: "AbortError" }));
    expect(await shareOrDownload(new Uint8Array([1]), "a.pdf", "application/pdf")).toBe(false);
    expect(b.clicks).toHaveLength(0);
  });
});
