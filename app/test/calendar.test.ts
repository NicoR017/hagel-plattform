// The pure parts of the repair-calendar picker.
import { describe, expect, it } from "vitest";
import {
  TIME_SLOTS, bookableStatus, dayLabel, dayState, isWeekend, missingBooking, monthBounds, monthCells, monthRange, shiftMonth, todayIn, validEmail, validPhone,
} from "../src/field/calendar";

describe("month grid", () => {
  it("Monday first, blanks before the 1st, every day of the month", () => {
    const oct = monthCells(2026, 9); // 1 Oct 2026 is a Thursday
    expect(oct.slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(oct.filter(Boolean)).toHaveLength(31);
    expect(oct[oct.length - 1]).toBe("2026-10-31");
    const feb = monthCells(2028, 1); // leap year
    expect(feb.filter(Boolean)).toHaveLength(29);
    expect(monthCells(2026, 5)[0]).toBe("2026-06-01"); // 1 Jun 2026 is a Monday: no blank
    expect(monthRange(2026, 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("weekends", () => {
    expect(isWeekend("2026-10-24")).toBe(true);
    expect(isWeekend("2026-10-25")).toBe(true);
    expect(isWeekend("2026-10-26")).toBe(false);
  });
});

describe("navigation covers this year and the next one", () => {
  const today = "2026-10-21";
  it("bounds, month and year steps, clamped", () => {
    expect(monthBounds(today)).toEqual({ min: "2026-01", max: "2027-12" });
    expect(shiftMonth("2026-10", 1, today)).toBe("2026-11");
    expect(shiftMonth("2026-12", 1, today)).toBe("2027-01");
    expect(shiftMonth("2026-10", 12, today)).toBe("2027-10");
    expect(shiftMonth("2027-10", 12, today)).toBe("2027-10"); // beyond next year: stays
    expect(shiftMonth("2026-01", -1, today)).toBe("2026-01"); // before this year: stays
    expect(shiftMonth("2026-03", -12, today)).toBe("2026-03");
  });
});

describe("a day", () => {
  const today = "2026-10-21";
  it("free places, 'few' when one is left, 'full', weekends and past days are shut", () => {
    expect(dayState("2026-10-22", today, 3, 0)).toMatchObject({ free: 3, selectable: true, few: false, full: false });
    expect(dayState("2026-10-22", today, 3, 2)).toMatchObject({ free: 1, selectable: true, few: true });
    expect(dayState("2026-10-22", today, 3, 3)).toMatchObject({ free: 0, selectable: false, full: true });
    expect(dayState("2026-10-22", today, 3, 7)).toMatchObject({ free: 0, full: true }); // over-booked data never shows negative places
    expect(dayState("2026-10-24", today, 3, 0)).toMatchObject({ closed: true, selectable: false, full: false });
    expect(dayState("2026-10-20", today, 3, 0)).toMatchObject({ past: true, selectable: false });
    expect(dayState("2026-10-21", today, 3, 0).selectable).toBe(true); // today itself can be booked
  });
  it("labels: the year only for days outside the current year", () => {
    expect(dayLabel("2026-10-26", today, "de-DE")).toBe("Mo 26.10.");
    expect(dayLabel("2027-03-10", today, "de-DE")).toBe("Mi 10.03.2027");
  });
  it("station time zone: Madrid is already on the next day when UTC is not", () => {
    expect(todayIn("Europe/Madrid", new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(todayIn("Europe/Berlin", new Date("2026-06-30T21:59:00Z"))).toBe("2026-06-30");
    expect(todayIn("Europe/Berlin", new Date("2026-06-30T22:00:00Z"))).toBe("2026-07-01");
  });
});

describe("the form", () => {
  it("time slots 07:30–17:00 every 30 minutes", () => {
    expect(TIME_SLOTS[0]).toBe("07:30");
    expect(TIME_SLOTS[TIME_SLOTS.length - 1]).toBe("17:00");
    expect(TIME_SLOTS).toHaveLength(20);
    expect(new Set(TIME_SLOTS).size).toBe(20);
  });
  it("everything is required; the button says what is still missing", () => {
    expect(missingBooking({})).toEqual(["day", "time", "phone", "email"]);
    expect(missingBooking({ day: "2026-10-22", time: "09:00", phone: "+34 612 345 678", email: "a@b.co" })).toEqual([]);
    expect(missingBooking({ day: "2026-10-22", time: "09:00", phone: "12", email: "a@b.co" })).toEqual(["phone"]);
    expect(missingBooking({ day: "2026-10-22", time: "", phone: "+49 171 2345678", email: "nope" })).toEqual(["time", "email"]);
    expect(validEmail(" x@y.de ")).toBe(true);
    expect(validEmail("x@y")).toBe(false);
    expect(validPhone("(0171) 23 45 67")).toBe(true);
  });
  it("bookable only in Angekommen, Besichtigung, Wartet and not once in the repair flow (like the server)", () => {
    for (const s of ["arrive", "besichtigung", "attente"]) expect(bookableStatus({ statut: s })).toBe(true);
    for (const s of ["reparatur", "fertig", "rendu"]) expect(bookableStatus({ statut: s })).toBe(false);
    expect(bookableStatus({ statut: "attente", repairStage: "pdr" })).toBe(false);
  });
});
