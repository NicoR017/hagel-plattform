import { describe, expect, it } from "vitest";
import { pickFilter, type PickItem } from "../src/field/Picker";

const items: PickItem[] = [
  { id: "1", title: "José Ñandú", sub: "PDR · 50 %", rank: 1 },
  { id: "2", title: "Marta Gil", sub: "PDR · Madrid", rank: 0 },
  { id: "3", title: "Ana Pérez", sub: "Headliner · Madrid" },
  ...Array.from({ length: 12 }, (_, i): PickItem => ({ id: `x${i}`, title: `Extra ${i}` })),
];

describe("pickFilter", () => {
  it("ignores case and accents, words in any order", () => {
    expect(pickFilter(items, "JOSE nandu").map((i) => i.id)).toEqual(["1"]);
    expect(pickFilter(items, "madrid headliner").map((i) => i.id)).toEqual(["3"]);
    expect(pickFilter(items, "perez ana").map((i) => i.id)).toEqual(["3"]);
  });
  it("puts rank 0 first, shows at most 8, hides the already chosen", () => {
    expect(pickFilter(items, "").map((i) => i.id)[0]).toBe("2");
    expect(pickFilter(items, "")).toHaveLength(8);
    expect(pickFilter(items, "madrid", new Set(["2"])).map((i) => i.id)).toEqual(["3"]);
  });
  it("no match gives an empty list", () => { expect(pickFilter(items, "zzz")).toEqual([]); });
});
