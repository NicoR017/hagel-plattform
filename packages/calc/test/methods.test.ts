import { describe, expect, it } from "vitest";
import golden from "../../../fixtures/golden_cases_v20.json";
import { DEFAULT_SETTINGS, ES_MATRIX_DEFAULT, computeVehicle, r2, systemMethodDef, type CalcMethodDef, type CalcVehicle, type EsMatrix } from "../src";

type Case = { case: string; input: CalcVehicle & { id: string }; expected: Record<string, any> };
const cases = (golden as unknown as { cases: Case[] }).cases;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe("calculation methods", () => {
  it("system methods (as stored in the database, after a JSON round trip) reproduce every golden case to the cent", () => {
    const aw = clone(systemMethodDef("aw")), es = clone(systemMethodDef("matrix", clone(ES_MATRIX_DEFAULT)));
    for (const c of cases) {
      const m = c.input.land === "ES" ? es : aw;
      const r = computeVehicle(c.input, DEFAULT_SETTINGS, m), plain = computeVehicle(c.input);
      expect(r2(r.netto), c.case).toBe(c.expected.netto);
      expect(r2(r.brutto), c.case).toBe(c.expected.brutto);
      expect(r, c.case).toEqual(plain);
    }
  });
  it("a matrix method without its own table (null) uses the built-in one, NOT the live organisation settings (that is what freezes it)", () => {
    for (const c of cases.filter((x) => x.input.land === "ES")) expect(computeVehicle(c.input, DEFAULT_SETTINGS, systemMethodDef("matrix"))).toEqual(computeVehicle(c.input));
    const edited = clone(ES_MATRIX_DEFAULT) as EsMatrix;
    edited.knots = edited.knots.map(([b, h]) => [b, h + 3] as [number, number]);
    const es = cases.find((x) => x.input.land === "ES")!;
    const live = { ...DEFAULT_SETTINGS, esMatrix: edited };
    expect(computeVehicle(es.input, live).netto).not.toBe(computeVehicle(es.input).netto); // without a method the live settings apply (historical)
    expect(computeVehicle(es.input, live, systemMethodDef("matrix"))).toEqual(computeVehicle(es.input)); // with a method they do not
  });
  it("a copied DE method with other parameters changes the result; the vehicle keeps using the version it was frozen with", () => {
    const de = cases.find((c) => c.input.land === "DE" && Object.values(c.input.panels ?? {}).some((p) => p.kleber))!;
    const v1 = systemMethodDef("aw");
    const v2 = clone(v1) as Extract<CalcMethodDef, { engine: "aw" }>;
    v2.params.kleberFactor = 1.4; v2.params.vat = 0.2; v2.params.extras["10"].ruest = 8;
    const a = computeVehicle(de.input, DEFAULT_SETTINGS, v1), b = computeVehicle(de.input, DEFAULT_SETTINGS, v2);
    expect(r2(a.netto)).toBe(de.expected.netto);
    expect(b.netto).not.toBe(a.netto);
    expect(b.vat).toBe(0.2);
    expect(b.ruestAW).toBe(8);
  });
  it("an A–F Spanish matrix (cap 24 h) can be a method of its own", () => {
    const es = cases.find((c) => c.input.land === "ES" && computeVehicle(c.input).es!.bollos > 600)!;
    const af = clone(ES_MATRIX_DEFAULT) as EsMatrix;
    af.categories = af.categories.filter((c) => c.cat !== "G").map((c) => (c.cat === "F" ? { ...c, to: null, cap_h: 24 } : c));
    af.knots = [[25, 6], [50, 9], [100, 15], [200, 20], [400, 23], [600, 24]];
    const r = computeVehicle(es.input, DEFAULT_SETTINGS, { engine: "matrix", params: { esMatrix: af } });
    expect(r.es!.H.h).toBeLessThanOrEqual(24);
    expect(r.es!.H.h).toBeLessThan(computeVehicle(es.input).es!.H.h);
  });
  it("an engine that does not fit the vehicle's country is ignored (old behaviour)", () => {
    const de = cases.find((c) => c.input.land === "DE")!, es = cases.find((c) => c.input.land === "ES")!;
    expect(computeVehicle(de.input, DEFAULT_SETTINGS, systemMethodDef("matrix"))).toEqual(computeVehicle(de.input));
    expect(computeVehicle(es.input, DEFAULT_SETTINGS, systemMethodDef("aw"))).toEqual(computeVehicle(es.input));
  });
});
