// UI v3: routes (old links keep working), "Zurück" one level up, which vehicles each mode shows, the legacy switch.
import { describe, expect, it } from "vitest";
import { hrefOf, parentRoute, parseRoute, type Route } from "../src/field/route";
import { resolveUi, setUiMode } from "../src/field/uiMode";
import { MODE_STATUSES, inMode, matchesChip, stationCounts } from "../src/v3/modes";

const S = "11111111-1111-4111-8111-111111111111", V = "22222222-2222-4222-8222-222222222222";

describe("routes", () => {
  it("old links still resolve exactly as before", () => {
    expect(parseRoute("")).toEqual({ page: "list", dash: false });
    expect(parseRoute("#/")).toEqual({ page: "list", dash: false });
    expect(parseRoute("#/?f=dash")).toEqual({ page: "list", dash: true });
    expect(parseRoute("#/dashboard")).toEqual({ page: "dashboard" });
    expect(parseRoute(`#/v/${V}/kva`)).toEqual({ page: "vehicle", id: V, tab: "kva" });
    expect(parseRoute(`#/v/${V}`)).toEqual({ page: "vehicle", id: V, tab: "basis" });
    expect(parseRoute(`#/v/${V}/nonsense`)).toEqual({ page: "vehicle", id: V, tab: "basis" });
    expect(parseRoute("#/admin")).toEqual({ page: "admin", tab: undefined });
    expect(parseRoute("#/admin/users")).toEqual({ page: "admin", tab: "users" });
  });
  it("new routes round-trip", () => {
    const routes: Route[] = [
      { page: "mode", stationId: S },
      { page: "list", stationId: S, mode: "kalk" }, { page: "list", stationId: S, mode: "rep" }, { page: "list", stationId: S, mode: "all" },
      { page: "vehicle", id: V, tab: "erfassung", ctx: { stationId: S, mode: "rep" } },
      { page: "vehicle", id: V, tab: "basis" }, { page: "dashboard" }, { page: "admin", tab: "roles" },
    ];
    for (const r of routes) expect(parseRoute(hrefOf(r))).toEqual(r);
    expect(hrefOf({ page: "list", stationId: S, mode: "kalk" })).toBe(`#/s/${S}/kalk`);
    expect(hrefOf({ page: "vehicle", id: V, tab: "kva", ctx: { stationId: S, mode: "all" } })).toBe(`#/s/${S}/all/v/${V}/kva`);
  });
  it("an unknown mode falls back to the station's mode choice", () => {
    expect(parseRoute(`#/s/${S}/whatever`)).toEqual({ page: "mode", stationId: S });
  });
});

describe("‹ Zurück = one level up", () => {
  it("vehicle → its list → station modes → stations; nothing above the stations", () => {
    const v: Route = { page: "vehicle", id: V, tab: "basis", ctx: { stationId: S, mode: "rep" } };
    const list = parentRoute(v)!;
    expect(list).toEqual({ page: "list", stationId: S, mode: "rep" });
    const modes = parentRoute(list)!;
    expect(modes).toEqual({ page: "mode", stationId: S });
    expect(parentRoute(modes)).toEqual({ page: "list" });
    expect(parentRoute({ page: "list" })).toBeNull();
  });
  it("dashboard and administration go back to the stations; an old vehicle link to the 'all vehicles' list of its station", () => {
    expect(parentRoute({ page: "dashboard" })).toEqual({ page: "list" });
    expect(parentRoute({ page: "admin" })).toEqual({ page: "list" });
    expect(parentRoute({ page: "vehicle", id: V, tab: "basis" }, S)).toEqual({ page: "list", stationId: S, mode: "all" });
    expect(parentRoute({ page: "vehicle", id: V, tab: "basis" })).toEqual({ page: "list" });
  });
});

describe("modes", () => {
  const v = (statut: string, statutMotif?: string) => ({ statut, statutMotif, stationId: S });
  it("Kalkulation = Angekommen, Besichtigung, Wartet (not for parts); Reparatur = Reparatur, Fertig, Wartet (Teile); Alle = everything", () => {
    const all = ["arrive", "besichtigung", "reparatur", "fertig", "rendu"].map((s) => v(s));
    expect(all.filter((x) => inMode(x, "kalk")).map((x) => x.statut)).toEqual(["arrive", "besichtigung"]);
    expect(all.filter((x) => inMode(x, "rep")).map((x) => x.statut)).toEqual(["reparatur", "fertig"]);
    expect(all.filter((x) => inMode(x, "all"))).toHaveLength(5);
    expect(inMode(v("attente", "Freigabe"), "kalk")).toBe(true);
    expect(inMode(v("attente", "Freigabe"), "rep")).toBe(false);
    expect(inMode(v("attente", "Teile"), "rep")).toBe(true);
    expect(inMode(v("attente", "Teile"), "kalk")).toBe(false);
    expect(inMode(v("attente", " teile "), "rep")).toBe(true); // the reason is free text: tolerate case and spaces
    expect(inMode(v("attente"), "kalk")).toBe(true);
  });
  it("status chips: one per status of the mode; 'Wartet' is split by reason", () => {
    expect(MODE_STATUSES.kalk).toEqual(["arrive", "besichtigung", "attente"]);
    expect(MODE_STATUSES.rep).toEqual(["reparatur", "attente", "fertig"]);
    expect(MODE_STATUSES.all).toHaveLength(6);
    expect(matchesChip(v("attente", "Teile"), "rep", "attente")).toBe(true);
    expect(matchesChip(v("attente", "Teile"), "kalk", "attente")).toBe(false);
    expect(matchesChip(v("besichtigung"), "kalk", "all")).toBe(true);
    expect(matchesChip(v("besichtigung"), "kalk", "arrive")).toBe(false);
  });
  it("station card numbers: present = every status but Zurückgegeben; counts are per station", () => {
    const list = [v("arrive"), v("besichtigung"), v("reparatur"), v("reparatur"), v("attente", "Teile"), v("fertig"), v("rendu"), { statut: "arrive", stationId: "other" }];
    expect(stationCounts(list, S)).toEqual({ kalk: 2, rep: 2, wait: 1, present: 6 });
    expect(stationCounts(list, "other")).toEqual({ kalk: 1, rep: 0, wait: 0, present: 1 });
    expect(stationCounts([], S)).toEqual({ kalk: 0, rep: 0, wait: 0, present: 0 });
  });
});

describe("legacy switch", () => {
  it("without a stored choice the server default decides; absent server answer = new interface", () => {
    setUiMode(null);
    expect(resolveUi(undefined)).toBe("v3");
    expect(resolveUi(true)).toBe("v3");
    expect(resolveUi(false)).toBe("legacy");
  });
  it("storage that is unavailable never breaks it", () => {
    expect(() => setUiMode("legacy")).not.toThrow();
    expect(resolveUi(true)).toBe("v3"); // (node: no localStorage) falls back to the default
  });
});
