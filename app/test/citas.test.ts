import { describe, expect, it } from "vitest";
import { hrefOf, parentRoute, parseRoute } from "../src/field/route";
import { addDays, dayIn, normPlate } from "../src/v3/citas";

describe("PDR Citas screens", () => {
  it("the start-from-appointment route survives a round trip, ids with odd characters included", () => {
    const r = { page: "citas" as const, stationId: "11111111-1111-4111-8111-111111111111", date: "2026-10-23", appointmentId: "appt/42 x" };
    expect(parseRoute(hrefOf(r))).toEqual(r);
    expect(parseRoute("#/s/abc/citas/not-a-date/x")).toEqual({ page: "mode", stationId: "abc" });
  });
  it("goes back to the station", () => {
    expect(parentRoute({ page: "citas", stationId: "s1", date: "2026-10-23", appointmentId: "a" })).toEqual({ page: "mode", stationId: "s1" });
  });
  it("steps the day and finds the day in the time zone of the station", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayIn("2026-10-19T22:30:00Z", "Europe/Madrid")).toBe("2026-10-20");
    expect(dayIn("2026-10-19T22:30:00Z", "UTC")).toBe("2026-10-19");
  });
  it("compares plates like the server", () => {
    expect(normPlate("9547 lpv")).toBe(normPlate("9547-LPV"));
    expect(normPlate("1234 ÁBC")).toBe("1234ABC");
  });
});
