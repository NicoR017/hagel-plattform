import { describe, expect, it } from "vitest";
import { matches } from "../src/admin";

describe("search in the administration lists", () => {
  it("every word must appear somewhere; case and accents do not matter", () => {
    expect(matches("", ["Talleres Miguel Auto S.L."])).toBe(true);
    expect(matches("miguel auto", ["Talleres Miguel Auto S.L.", "carrosserie"])).toBe(true);
    expect(matches("MIGUEL", ["Talleres Miguel"])).toBe(true);
    expect(matches("karosserie zwei", ["Karosserie Zwei (Bodyshop)", "Madrid"])).toBe(true);
    expect(matches("zwei madrid", ["Karosserie Zwei", "Madrid"])).toBe(true);
    expect(matches("zwei berlin", ["Karosserie Zwei", "Madrid"])).toBe(false);
    expect(matches("malaga", ["Málaga Centro"])).toBe(true);
    expect(matches("allianz", [null, undefined, "AZ siniestros@allianz.es"])).toBe(true);
  });
});
