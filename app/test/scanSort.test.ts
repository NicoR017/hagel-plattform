import { describe, expect, it } from "vitest";
import { sortScans } from "../src/v3/scanSort";

const mk = (pk: string, plate: string, bc: string, at: string | null) => ({ partitionKey: pk, scanDateTime: at, plate, businessCustomer: bc });
const L = [
  mk("202610200900B 2", "B 2", "Zeta-Zeta", "2026-10-20T09:00:00Z"),
  mk("202610221030A 1", "A 1", "Allianz-Allianz", "2026-10-22T10:30:00Z"),
  mk("202610211200C 10", "C 10", "Mapfre-Mapfre", null), // no date: taken from the key
  mk("202610211200C 9", "C 9", "Mapfre-Mapfre", "2026-10-21T12:00:00Z"),
];
describe("available scans: order", () => {
  it("newest first by default, also with dates as text and scans without a date", () => {
    expect(sortScans(L, "new").map((s) => s.plate)).toEqual(["A 1", "C 9", "C 10", "B 2"]);
  });
  it("oldest first, by plate (numbers read as numbers), by customer", () => {
    expect(sortScans(L, "old").map((s) => s.plate)).toEqual(["B 2", "C 10", "C 9", "A 1"]);
    expect(sortScans(L, "plate").map((s) => s.plate)).toEqual(["A 1", "B 2", "C 9", "C 10"]);
    expect(sortScans(L, "customer").map((s) => s.businessCustomer)).toEqual(["Allianz-Allianz", "Mapfre-Mapfre", "Mapfre-Mapfre", "Zeta-Zeta"]);
  });
  it("does not change the list it is given", () => {
    const copy = [...L];
    sortScans(L, "plate");
    expect(L).toEqual(copy);
  });
});
