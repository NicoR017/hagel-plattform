import { describe, expect, it } from "vitest";
import golden from "../../../fixtures/golden_cases_v20.json";
import { computeVehicle, r2, type CalcVehicle } from "../src";

type Case = { case: string; input: CalcVehicle & { id: string }; expected: Record<string, any> };
const cases = (golden as unknown as { cases: Case[] }).cases;

describe("golden cases v20", () => {
  it("has 22 cases", () => expect(cases.length).toBe(22));
  for (const c of cases) {
    it(c.case, () => {
      const r = computeVehicle(c.input);
      const e = c.expected;
      expect(r2(r.netto)).toBe(e.netto);
      expect(r2(r.brutto)).toBe(e.brutto);
      expect(r.dents).toBe(e.dents);
      if (c.input.land === "ES") {
        const es = r.es!;
        expect(es.bollos).toBe(e.bollos);
        expect(es.small).toBe(e.small);
        expect(es.large).toBe(e.large);
        expect(es.cat.cat).toBe(e.category);
        expect(es.H.h).toBe(e.baseHours);
        expect(r2(es.totH)).toBe(e.totalHours);
        expect(r2(es.matrixEur)).toBe(e.matrixEur);
        expect(es.kb).toBe(e.kickback);
        expect(es.adj.map((a) => ({ de: a.de, h: a.h }))).toEqual(e.adjustments);
      } else {
        expect(r2(r.repairAW)).toBe(e.repairAW);
        expect(r.finishAW).toBe(e.finishAW);
        expect(r.ruestAW).toBe(e.ruestAW);
        expect(r2(r.totalAW)).toBe(e.totalAW);
        expect(r2(r.awNetto)).toBe(e.awNetto);
        expect(r.kleberMat).toBe(e.kleberMat);
        expect(r.demEur).toBe(e.demEur);
        const pa = Object.fromEntries(r.panels.map((p) => [p.key, p.repair]));
        expect(pa).toEqual(e.panelAW);
      }
    });
  }
});
