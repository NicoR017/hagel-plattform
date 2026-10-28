// Verwaltung (phase 6): the week picker agrees with the server's week ranges.
import { describe, expect, it } from "vitest";
import { isoWeekOf } from "../src/v3/Admin3";

describe("calendar week of the weekly report", () => {
  it("ISO weeks, also across the year boundary", () => {
    expect(isoWeekOf(new Date(2026, 9, 21))).toBe("2026-W43");
    expect(isoWeekOf(new Date(2026, 9, 19))).toBe("2026-W43"); // Monday
    expect(isoWeekOf(new Date(2026, 9, 25))).toBe("2026-W43"); // Sunday
    expect(isoWeekOf(new Date(2026, 9, 26))).toBe("2026-W44");
    expect(isoWeekOf(new Date(2025, 11, 29))).toBe("2026-W01");
    expect(isoWeekOf(new Date(2027, 0, 3))).toBe("2026-W53");
    expect(isoWeekOf(new Date(2027, 0, 4))).toBe("2027-W01");
  });
});
