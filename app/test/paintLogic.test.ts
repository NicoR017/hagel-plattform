// V7 F4: helpers of the Paint board and its calendar.
import { describe, expect, it } from "vitest";
import { setLang } from "../src/shared/i18n";
import { PAINT_COLUMNS, addDays, inRepair, matchesPaint, mondayOf, paintOf, paintProgress, paintStatus, rowsOfPaint, weekDays } from "../src/domains/paint/paintLogic";

const job = (status: string, o: Record<string, unknown> = {}) => ({ id: "j" + Math.random(), elementKey: "dach", status, source: "ptp", partnerId: null, plannedDate: null, plannedTime: null, customerAppointment: false, doneAt: null, ...o });
const car = (paint: unknown[] | undefined, o: Record<string, unknown> = {}) => ({ id: "v" + Math.random(), kennzeichen: "1234 ABC", modell: "Seat Leon", statut: "reparatur", repairStage: "pdr", paint, ...o }) as never;

describe("paint board helpers", () => {
  it("four columns in order; progress counts the done elements; cars without a paint list have none", () => {
    expect([...PAINT_COLUMNS]).toEqual(["to_paint", "scheduled", "at_body_shop", "done"]);
    expect(paintProgress([job("done"), job("scheduled"), job("done")] as never)).toEqual({ d: 2, n: 3 });
    expect(paintOf(car(undefined))).toEqual([]);
    expect(rowsOfPaint([car([job("to_paint"), job("done")]), car([job("scheduled")])]).length).toBe(3);
  });
  it("only cars on the repair board are shown; search by element, plate and model", () => {
    setLang("de");
    expect(inRepair(car([]))).toBe(true); expect(inRepair(car([], { repairStage: null, statut: "besichtigung" }))).toBe(false); expect(inRepair(car([], { statut: "rendu" }))).toBe(false);
    const rows = rowsOfPaint([car([job("to_paint")]), car([job("to_paint", { elementKey: "haube" })], { kennzeichen: "9999 ZZZ", modell: "Kia" })]);
    expect(rows.filter((r) => matchesPaint(r, "9999")).length).toBe(1); expect(rows.filter((r) => matchesPaint(r, "kia haube")).length).toBe(1); expect(rows.filter((r) => matchesPaint(r, "")).length).toBe(2);
  });
  it("labels follow the language", () => { setLang("es"); expect(paintStatus("at_body_shop")).toBe("En el taller"); setLang("fr"); expect(paintStatus("done")).toBe("Terminé"); setLang("de"); });
});

describe("calendar", () => {
  it("weeks start on Monday and have seven days", () => {
    expect(mondayOf("2026-11-06")).toBe("2026-11-02"); // Friday -> Monday
    expect(mondayOf("2026-11-08")).toBe("2026-11-02"); // Sunday -> the Monday before
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(weekDays("2026-11-02")).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});
