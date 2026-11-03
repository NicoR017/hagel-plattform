// "On hold" sub-filter and the damage flag (red = replace, orange = push to paint) of the vehicle list.
import { describe, expect, it } from "vitest";
import { damageFlag, holdSubOf, matchesChip, matchesSub } from "../src/domains/shell/modes";
import { listHref, parseRoute } from "../src/shared/route";

const hold = (statutMotif?: string | null) => ({ statut: "attente", statutMotif, stationId: "s1" });

describe("hold sub-status", () => {
  it("the five known reasons, any case / spacing", () => {
    expect(holdSubOf(hold("Teile"))).toBe("Teile");
    expect(holdSubOf(hold(" freigabe "))).toBe("Freigabe");
    expect(holdSubOf(hold("TERMIN"))).toBe("Termin");
  });
  it("unknown free text -> other, empty / null -> none, other status -> null", () => {
    expect(holdSubOf(hold("Lackierer krank"))).toBe("other");
    expect(holdSubOf(hold(""))).toBe("none");
    expect(holdSubOf(hold(null))).toBe("none");
    expect(holdSubOf({ statut: "reparatur", statutMotif: "Teile" })).toBeNull();
  });
  it("filter applies only with the On hold chip; invalid value = no sub-filter", () => {
    expect(matchesSub(hold("Teile"), "attente", "Termin")).toBe(false);
    expect(matchesSub(hold("Teile"), "attente", "Teile")).toBe(true);
    expect(matchesSub(hold(""), "attente", "none")).toBe(true);
    expect(matchesSub(hold("Teile"), "attente", "all")).toBe(true);
    expect(matchesSub(hold("Teile"), "attente", "<script>")).toBe(true);
    expect(matchesSub(hold("Teile"), "all", "Termin")).toBe(true); // sub ignored outside On hold
    expect(matchesSub(hold("Teile"), "reparatur", "Termin")).toBe(true);
  });
  it("combines with the chip of the mode (Teile belongs to the repair side)", () => {
    expect(matchesChip(hold("Teile"), "kalk", "attente")).toBe(false);
    expect(matchesChip(hold("Teile"), "rep", "attente")).toBe(true);
    expect(matchesChip(hold("Teile"), "all", "attente")).toBe(true);
  });
});

describe("damage flag", () => {
  const p = (method: string) => ({ dents: { "20": 2 }, method });
  it("nothing special -> no flag", () => {
    expect(damageFlag({})).toBeNull();
    expect(damageFlag({ panels: { door: p("sanft") } })).toBeNull();
  });
  it("push to paint only -> ptp", () => expect(damageFlag({ panels: { door: p("sanft"), roof: p("ptp") } })).toBe("ptp"));
  it("replace only -> replace", () => expect(damageFlag({ panels: { door: p("erneuern") } })).toBe("replace"));
  it("both -> replace wins", () => expect(damageFlag({ panels: { a: p("ptp"), b: p("erneuern") } })).toBe("replace"));
});

describe("list URL", () => {
  it("round trip of chip and sub-filter", () => {
    const h = listHref({ stationId: "s1", mode: "all", chip: "attente", sub: "Teile" });
    expect(h).toBe("#/s/s1/all?st=attente&sub=Teile");
    expect(parseRoute(h)).toMatchObject({ page: "list", stationId: "s1", mode: "all", chip: "attente", sub: "Teile" });
  });
  it("no chip / all -> clean URL; sub dropped when the chip is not On hold", () => {
    expect(listHref({ stationId: "s1", mode: "all" })).toBe("#/s/s1/all");
    expect(listHref({ stationId: "s1", mode: "all", chip: "reparatur", sub: "Teile" })).toBe("#/s/s1/all?st=reparatur");
    expect(parseRoute("#/s/s1/all?st=reparatur&sub=Teile")).not.toHaveProperty("sub");
  });
});
