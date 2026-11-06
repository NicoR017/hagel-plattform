// V7 F3a: pure helpers of the Parts board.
import { describe, expect, it } from "vitest";
import { setLang } from "../src/shared/i18n";
import { blockerKey } from "../src/domains/repair/boardLogic";
import { COLUMNS, carPartsState, deliveredOf, matchesRow, missingCount, partsCsv, rowsOf } from "../src/domains/parts/partsBoardLogic";

const part = (status: string, o: Record<string, unknown> = {}) => ({ id: "p" + Math.random(), zoneKey: "dach", catalogId: null, name: "Antena", qty: 1, oemRef: null, source: "assessment", status, ...o });
const car = (parts: unknown[], o: Record<string, unknown> = {}) => ({ id: "v" + Math.random(), kennzeichen: "1234 ABC", modell: "Seat Leon", stationId: "s1", parts, ...o }) as never;

describe("state of a car's parts", () => {
  it("none / order to send / waiting / ready for reassembly / all installed", () => {
    expect(carPartsState([])).toBe("none");
    expect(carPartsState([part("to_order"), part("to_order")] as never)).toBe("to_order");
    expect(carPartsState([part("to_order"), part("delivered")] as never)).toBe("waiting");
    expect(carPartsState([part("ordered"), part("delivered")] as never)).toBe("waiting");
    expect(carPartsState([part("delivered"), part("installed")] as never)).toBe("ready");
    expect(carPartsState([part("installed"), part("installed")] as never)).toBe("installed");
  });
  it("the badge counts the parts that arrived (delivered or installed) out of all", () => {
    const ps = [part("delivered"), part("installed"), part("ordered"), part("to_order")] as never[];
    expect(deliveredOf(ps)).toEqual({ d: 2, n: 4 }); expect(missingCount(ps)).toBe(2);
  });
  it("the board has the five columns in order; Finish tells why a part holds the car back", () => {
    expect([...COLUMNS]).toEqual(["to_order", "order_sent", "ordered", "delivered", "installed"]);
    expect(blockerKey("parts_not_installed")).toBe("f3BlkParts");
  });
});

describe("rows, search, export", () => {
  it("one row per part of the cars; search by part, zone, plate and model (any order); cancelled parts are not rows", () => {
    const vs = [car([part("to_order", { name: "Dachreling" }), part("cancelled", { name: "Fuera" })]), car([part("delivered", { name: "Emblema", zoneKey: "heck" })], { kennzeichen: "9999 ZZZ", modell: "Kia" })];
    const rows = rowsOf(vs);
    expect(rows.map((r) => r.p.name)).toEqual(["Dachreling", "Emblema"]);
    expect(rows.filter((r) => matchesRow(r, "9999 emblema", [])).length).toBe(1);
    expect(rows.filter((r) => matchesRow(r, "seat reling", [])).length).toBe(1);
    expect(rows.filter((r) => matchesRow(r, "", [])).length).toBe(2);
    expect(rows.filter((r) => matchesRow(r, "nothing", [])).length).toBe(0);
  });
  it("the CSV opens in Excel (semicolon, BOM), quotes what needs it, and has no price column", () => {
    setLang("en");
    const csv = partsCsv(rowsOf([car([part("delivered", { name: 'Barra "techo"; izq.', qty: 2, oemRef: "A-1", deliveredAt: "2026-11-05T10:00:00Z" })])]), () => "Nave A", []);
    const [head, line] = csv.split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(head).toContain("Status"); expect(head.toLowerCase()).not.toMatch(/price|preis|prix|precio/);
    expect(line).toContain('"Barra ""techo""; izq."'); expect(line).toContain("2026-11-05"); expect(line).toContain("Nave A");
    setLang("de");
  });
});
