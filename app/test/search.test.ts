import { describe, expect, it } from "vitest";
import { routeOfHit, searchVehicles, type SearchVehicle } from "../src/v3/search";

const names = { station: (id?: string | null) => ({ s1: "PDR Halle Madrid", s2: "Taller Norte" } as Record<string, string>)[id ?? ""] ?? "", insurer: (id?: string | null) => ({ i1: "Mapfre", i2: "AXA" } as Record<string, string>)[id ?? ""] ?? "" };
const v = (o: Partial<SearchVehicle> & { id: string }): SearchVehicle => ({ statut: "besichtigung", stationId: "s1", ...o });
const cars = [
  v({ id: "a", kennzeichen: "7731 KBR", fin: "WVWZZZ1KZAW123456", claimNumber: "SIN-2026/55", modell: "VW Golf", insurerId: "i1", updatedAt: "2026-10-01" }),
  v({ id: "b", kennzeichen: "1234-ABC", modell: "Seat León", insurerId: "i2", stationId: "s2", statut: "rendu", techName: "José Núñez", updatedAt: "2026-10-05" }),
  v({ id: "c", kennzeichen: "7731 KBX", kunde: "Taller Norte", statut: "reparatur", repairStage: "pdr", updatedAt: "2026-10-09" }),
];
const ids = (q: string) => searchVehicles(cars, q, names).map((x) => x.id);

describe("global vehicle search", () => {
  it("ignores spaces, hyphens, case and accents in the plate", () => {
    expect(ids("7731kbr")).toEqual(["a"]);
    expect(ids("7731-kbr")).toEqual(["a"]);
    expect(ids("1234abc")).toEqual(["b"]);
  });
  it("finds by VIN, claim number, model, insurer, station, technician and customer; several words must all match", () => {
    expect(ids("wvwzzz1kzaw123456")).toEqual(["a"]);
    expect(ids("sin 2026 55")).toEqual(["a"]);
    expect(ids("sin-2026/55")).toEqual(["a"]);
    expect(ids("leon")).toEqual(["b"]);
    expect(ids("axa")).toEqual(["b"]);
    expect(ids("jose nunez")).toEqual(["b"]);
    expect(ids("madrid mapfre")).toEqual(["a"]);
    expect(ids("taller norte")).toEqual(["c", "b"]);
  });
  it("returned vehicles are found too, nothing for an empty or unmatched query, plate prefix first then newest", () => {
    expect(ids("1234")).toEqual(["b", "a"]); // the 1234 of the plate, then the one inside a VIN
    expect(ids("")).toEqual([]);
    expect(ids("zzzz")).toEqual([]);
    expect(ids("7731")).toEqual(["c", "a"]);
    expect(ids("7731 kb")).toEqual(["c", "a"]);
  });
  it("a car on the repair board opens its repair detail, any other its vehicle detail in its own station", () => {
    expect(routeOfHit(cars[2])).toEqual({ page: "repair", id: "c", tab: "uebersicht", stationId: "s1" });
    expect(routeOfHit(cars[0])).toEqual({ page: "vehicle", id: "a", tab: "basis", ctx: { stationId: "s1", mode: "all" } });
    expect(routeOfHit(cars[1])).toEqual({ page: "vehicle", id: "b", tab: "basis", ctx: { stationId: "s2", mode: "all" } });
  });
});
