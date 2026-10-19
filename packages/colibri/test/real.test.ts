import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { applyColibri, colibriPages, parseColibri, scanCheck } from "../src";

const file = new URL("../../../fixtures/real/colibri_en_9547LPV.pdf", import.meta.url);

describe.skipIf(!existsSync(file))("real Colibri PDF (EN, Germany method, 2026-10-19)", () => {
  it("parses to the report total with no unknown rows", async () => {
    const res = parseColibri(await colibriPages(readFileSync(file)));
    expect(res.reportTotal).toBe(618);
    expect(res.imported).toBe(618);
    expect(res.rowSum).toBe(618);
    expect(res.unknown).toEqual([]);
    expect(res.found).toBe(12);
    expect(res.head.kennzeichen).toBe("9547 LPV");
    expect(res.head.datum).toBe("19.10.2026 16:27");
    expect(res.head.kunde).toBe("Allianz-Allianz");
    expect(res.head.method).toBe("GERMANY");
    expect(res.panels.dach.dents).toEqual({ 10: 23, 20: 162, 30: 130, 40: 61, 50: 33, 60: 16, 70: 6, 80: 1 });
    expect(Object.keys(res.panels).sort()).toEqual(
      ["dach", "dachholm_l", "dachholm_r", "haube", "heck", "kfl_vl", "kfl_vr", "sw_hl", "sw_hr", "tuer_hr", "tuer_vl", "tuer_vr"],
    );
  });
  it("apply + scanCheck", async () => {
    const res = parseColibri(await colibriPages(readFileSync(file)));
    const v = applyColibri({ panels: {} }, res, new Date("2026-10-19T00:00:00Z"));
    expect(v.kennzeichen).toBe("9547 LPV");
    expect(v.leistungsdatum).toBe("2026-10-19");
    expect(v.panels.dachholm_l.kleber).toBe(true);
    expect(scanCheck(v.colibri!, 618).ok).toBe(true);
  });
});
