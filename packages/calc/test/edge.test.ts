import { describe, expect, it } from "vitest";
import {
  computeDE, computeES, computeShares, computeVehicle, esHours, esKickback, esCat, lookupAW, panelStats, r2,
  ES_MATRIX_DEFAULT, DEFAULT_SETTINGS, type CalcVehicle, type Panel,
} from "../src";

const M = ES_MATRIX_DEFAULT;
/** One horizontal panel (haube) with n dents of 20 mm = n bollos. */
const esVeh = (n: number, extra: Partial<Panel> = {}, v: Partial<CalcVehicle> = {}): CalcVehicle => ({
  land: "ES", demontage: false, panels: { haube: { key: "haube", dents: { "20": n }, ...extra } }, ...v,
});

describe("ES hours / category (data-driven matrix)", () => {
  const cases: [number, number, string][] = [
    [0, 0, "A"], [1, 6, "A"], [25, 6, "A"], [26, 6.5, "B"], [50, 9, "B"], [51, 9.5, "C"], [100, 15, "C"],
    [200, 20, "D"], [400, 23, "E"], [600, 25, "F"], [601, 25.5, "G"], [999, 30, "G"], [1000, 30, "G"], [1500, 30, "G"],
  ];
  for (const [n, h, cat] of cases) {
    it(`${n} bollos -> ${h} h, cat ${cat}`, () => {
      expect(esHours(M, n).h).toBe(h);
      expect(esCat(M, n).cat).toBe(cat);
    });
  }
  it("0 bollos: no price", () => {
    const r = computeES(esVeh(0));
    expect(r.netto).toBe(0);
    expect(r.es!.bollos).toBe(0);
  });
  it("25 bollos = 6 h x 69", () => expect(r2(computeES(esVeh(25)).netto)).toBe(414));
  it("26 bollos = 6.5 h", () => expect(computeES(esVeh(26)).es!.H.h).toBe(6.5));
  it("1000 and >1000 bollos capped at 30 h", () => {
    expect(computeES(esVeh(1000)).es!.totH).toBe(30);
    expect(computeES(esVeh(1200)).es!.totH).toBe(30);
  });
  it("kickback tiers", () => {
    expect([9, 9.5, 20, 20.5, 29.5, 30].map((h) => esKickback(M, h))).toEqual([60, 120, 120, 240, 240, 320]);
  });
  it("big dents count 2 bollos, >30mm dents count 2", () => {
    const r = computeES({ land: "ES", panels: { haube: { key: "haube", dents: { "20": 2, "40": 3 }, big: 1 } } });
    expect(r.es!.small).toBe(2);
    expect(r.es!.large).toBe(4);
    expect(r.es!.bollos).toBe(10);
  });
  it("erneuern: -1 h, dents still counted", () => {
    const r = computeES(esVeh(30, { method: "erneuern" }));
    expect(r.es!.bollos).toBe(30);
    expect(r.es!.adj).toEqual([{ de: "Motorhaube ersetzt", es: "Capó sustituido", h: -1 }]);
    expect(r.es!.totH).toBe(r.es!.H.h - 1);
  });
  it("alu: +1 h once; not when erneuern", () => {
    const v: CalcVehicle = { land: "ES", panels: { haube: { key: "haube", dents: { "20": 30 }, alu: true }, dach: { key: "dach", dents: { "20": 30 }, alu: true } } };
    expect(computeES(v).es!.adj.filter((a) => a.h === 1).length).toBe(1);
    v.panels!.haube.method = "erneuern";
    v.panels!.dach.method = "erneuern";
    expect(computeES(v).es!.adj.some((a) => a.de === "Aluminiumteile")).toBe(false);
  });
  it("total hours never negative", () => {
    const v: CalcVehicle = { land: "ES", panels: { haube: { key: "haube", dents: { "20": 1 }, method: "erneuern" } } };
    expect(computeES(v).es!.totH).toBe(5);
    const w = { ...v, panels: { ...v.panels, dach: { key: "dach", dents: { "20": 1 }, method: "erneuern" as const } } };
    expect(computeES(w).es!.totH).toBeGreaterThanOrEqual(0);
  });
  it("changing the matrix changes the result (editable table)", () => {
    const s = { ...DEFAULT_SETTINGS, esMatrix: { ...M, knots: [[25, 7], ...M.knots.slice(1)] as [number, number][] } };
    expect(computeES(esVeh(10)).es!.H.h).toBe(6);
    expect(computeES(esVeh(10), s).es!.H.h).toBe(7); // first knot edited in settings -> new base hours
  });
});

describe("DE BVAT", () => {
  const haube = (dents: Record<string, number>, extra: Partial<Panel> = {}): CalcVehicle => ({
    land: "DE", teiler: 10, stundensatz: 83, panels: { haube: { key: "haube", dents, finish: true, ...extra } },
  });
  it("lookupAW interpolates with Math.round and clamps", () => {
    expect(lookupAW(10, "waagrecht", 1, 10)).toBe(5);
    expect(lookupAW(10, "waagrecht", 11, 10)).toBe(12 + Math.round(((13 - 12) * 1) / 3));
    expect(lookupAW(10, "waagrecht", 500, 80)).toBe(453);
    expect(lookupAW(10, "waagrecht", 0, 10)).toBe(0);
    expect(lookupAW(10, "senkrecht", 80, 10)).toBe(35); // last key row
    expect(lookupAW(10, "waagrecht", 190, 80)).toBe(432);
    expect(lookupAW(10, "waagrecht", 170, 80)).toBe(390); // short row (7 values): index 7 falls back to last value
  });
  it("panelStats class clamp", () => {
    expect(panelStats({ key: "haube", dents: { "80": 3 } })).toMatchObject({ total: 3, avgClass: 80 });
    expect(panelStats({ key: "haube", dents: { "10": 1, "20": 1 } })).toMatchObject({ avgX: 15, avgClass: 20 });
    expect(panelStats({ key: "haube" })).toMatchObject({ total: 0, avgClass: 0 });
  });
  it("empty vehicle: no Rüstzeit, net 0", () => {
    const r = computeDE({ land: "DE", panels: {} });
    expect(r.netto).toBe(0);
    expect(r.ruestAW).toBe(0);
  });
  it("Teiler 12 constants and €/AW", () => {
    const r = computeDE({ ...haube({ "20": 5 }), teiler: 12, greifzone: true, hohlraum: true, verbringung: true });
    expect([r.ruestAW, r.greifAW, r.hohlAW, r.verbrAW, r.finishAW]).toEqual([7, 11, 5, 18, 3.5]);
    expect(r.euroPerAW).toBeCloseTo(83 / 12, 10);
    expect(r.hohlMat).toBe(15);
  });
  it("manual base AW override", () => {
    const r = computeDE(haube({ "20": 5 }, { awManual: true, baseAW: 40 }));
    expect(r.repairAW).toBe(40);
  });
  it("alu x1.25, kleber x1.3, ptp x0.6, erneuern 0", () => {
    const base = computeDE(haube({ "20": 5 })).repairAW;
    expect(computeDE(haube({ "20": 5 }, { alu: true })).repairAW).toBe(r2(base * 1.25));
    expect(computeDE(haube({ "20": 5 }, { kleber: true })).repairAW).toBe(r2(base * 1.3));
    expect(computeDE(haube({ "20": 5 }, { method: "ptp" })).repairAW).toBe(r2(base * 0.6));
    const e = computeDE(haube({ "20": 5 }, { method: "erneuern" }));
    expect(e.repairAW).toBe(0);
    expect(e.finishAW).toBe(0);
  });
  it("finish capped; kleber material tiers", () => {
    const keys = ["haube", "dach", "heck", "heck_u", "kfl_vl", "kfl_vr", "tuer_vl"];
    const panels = Object.fromEntries(keys.map((k) => [k, { key: k, dents: { "20": 2 }, finish: true, kleber: true } as Panel]));
    const r = computeDE({ land: "DE", panels });
    expect(r.finishAW).toBe(13);
    expect(r.kleberMat).toBe(20);
    const tiers = [1, 2, 3, 5, 6].map((n) => computeDE({ land: "DE", panels: Object.fromEntries(keys.slice(0, n).map((k) => [k, { key: k, dents: { "20": 1 }, kleber: true } as Panel])) }).kleberMat);
    expect(tiers).toEqual([10, 10, 15, 15, 20]);
  });
  it("big dents: manual amount only (no AW)", () => {
    const r = computeDE({ land: "DE", panels: { haube: { key: "haube", dents: {}, big: 2, bigEur: 300 } } });
    expect(r.bigEur).toBe(300);
    expect(r.bigCount).toBe(2);
    expect(r.netto).toBe(300 + r.ruestAW * r.euroPerAW);
  });
  it("19% VAT, glass and demontage default 150", () => {
    const r = computeVehicle({ ...haube({ "20": 5 }), demontage: true, glass: { ws: { on: true, eur: 400 }, rs: { on: false, eur: 50 } } });
    expect(r.demEur).toBe(150);
    expect(r.glassEur).toBe(400);
    expect(r.brutto).toBeCloseTo(r.netto * 1.19, 8);
  });
});

describe("shares", () => {
  const c = { netto: 1000, glassEur: 100, demEur: 150, es: undefined };
  it("pct mode", () => {
    const s = computeShares({ techPct: 50, werkPct: 20, werkMode: "pct", demTechPct: 100, techName: "Ana" }, c);
    expect(s.basis).toBe(900);
    expect(s.pdrBasis).toBe(750);
    expect(s.werkEur).toBe(180);
    expect(s.techEur).toBe(375);
    expect(s.demTechEur).toBe(150);
    expect(s.rest).toBe(900 - 180 - 375 - 150);
    expect(s.demTechName).toBe("Ana");
  });
  it("staffel uses the ES kickback", () => {
    const r = computeES(esVeh(100));
    const s = computeShares({ werkMode: "staffel" }, r);
    expect(s.werkEur).toBe(r.es!.kb);
  });
  it("defaults apply when fields are null", () => {
    const s = computeShares({}, { netto: 100, glassEur: 0, demEur: 0, es: undefined });
    expect([s.techPct, s.werkPct, s.werkEur, s.techEur]).toEqual([50, 25, 25, 50]);
  });
});
