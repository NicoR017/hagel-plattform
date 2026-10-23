import { describe, expect, it } from "vitest";
import { alsoRemoval, countKinds, fieldPanels, hasStepPhoto, interventionOf, isMine, nextStep, tally, type FieldVehicle } from "../src/v3/fieldLogic";

const v = (o: Partial<FieldVehicle> = {}): FieldVehicle => ({ id: "1", statut: "reparatur", repairStage: "demontage", myAssign: ["pdr"], ...o });

describe("field logic", () => {
  it("colours a panel by what is done to it", () => {
    expect(interventionOf({ dents: { "20": 3 } })).toBe("pdr");
    expect(interventionOf({ dents: { "20": 3 }, method: "ptp" })).toBe("ptp");
    expect(interventionOf({ method: "erneuern" })).toBe("replace");
    expect(interventionOf({ dents: { "20": 3 }, method: "erneuern" })).toBe("replace");
    expect(interventionOf({ dents: {} })).toBeNull();
    expect(interventionOf(undefined)).toBeNull();
  });
  it("lists only the panels with something to do, with dents, size class, alu and glue", () => {
    const list = fieldPanels({ panels: { haube: { key: "haube", dents: { "20": 2, "30": 2 }, alu: true }, dach: { key: "dach", dents: { "10": 1 }, method: "ptp", kleber: true }, tuer_vl: { key: "tuer_vl", method: "erneuern" }, heck: { key: "heck" } } });
    expect(list.map((p) => [p.key, p.kind])).toEqual([["haube", "pdr"], ["dach", "ptp"], ["tuer_vl", "replace"]]);
    expect(list[0]).toMatchObject({ dents: 4, avgX: 25, avgClass: 30, alu: true, glue: false, sizes: [["20", 2], ["30", 2]] });
    expect(list[1].glue).toBe(true);
    expect(countKinds(list)).toEqual({ pdr: 1, ptp: 1, replace: 1 });
  });
  it("his cars: assigned for his kind of work, or his earnings on it", () => {
    expect(isMine(v(), "pdr")).toBe(true);
    expect(isMine(v(), "headliner")).toBe(false);
    expect(isMine(v({ myAssign: ["demontage"] }), "headliner")).toBe(true);
    expect(isMine(v({ myAssign: [], myEarn: { pdr: null, dem: { eur: 10, pct: 80 }, eur: 10 } }), "headliner")).toBe(true);
    expect(alsoRemoval(v({ myEarn: { pdr: { eur: 5, pct: 50 }, dem: { eur: 10, pct: 100 }, eur: 15 } }))).toBe(true);
  });
  it("the only moves: technician Disassembly to PDR, headliner also Reassembly to At body shop, nothing for a finished or unstarted car", () => {
    expect(nextStep("pdr", v())).toBe("pdr");
    expect(nextStep("pdr", v({ repairStage: "pdr" }))).toBeNull();
    expect(nextStep("pdr", v({ repairStage: "remontage" }))).toBeNull();
    expect(nextStep("headliner", v({ repairStage: "demontage" }))).toBe("pdr");
    expect(nextStep("headliner", v({ repairStage: "remontage" }))).toBe("bodyshop");
    expect(nextStep("headliner", v({ repairStage: "bodyshop" }))).toBeNull();
    expect(nextStep("pdr", v({ statut: "fertig", repairStage: "finish" }))).toBeNull();
    expect(nextStep("pdr", v({ statut: "besichtigung", repairStage: null }))).toBeNull();
  });
  it("the photo must be mine, of the current step, and not deleted", () => {
    const p = [{ vehicleId: "1", takenBy: "me", repairStage: "demontage" }];
    expect(hasStepPhoto(p, "me", "1", "demontage")).toBe(true);
    expect(hasStepPhoto(p, "me", "1", "pdr")).toBe(false);
    expect(hasStepPhoto(p, "other", "1", "demontage")).toBe(false);
    expect(hasStepPhoto(p, "me", "2", "demontage")).toBe(false);
    expect(hasStepPhoto([{ ...p[0], deleted: true }], "me", "1", "demontage")).toBe(false);
  });
  it("station card numbers", () => {
    const list = [v({ id: "a", repairStage: "bereit" }), v({ id: "b", repairStage: "demontage" }), v({ id: "c", repairStage: "pdr" }), v({ id: "d", statut: "fertig", repairStage: "finish" }),
      v({ id: "e", myAssign: [], repairStage: "pdr" }), v({ id: "f", statut: "rendu", repairStage: "finish" }), v({ id: "g", myAssign: ["demontage"], repairStage: "remontage" })];
    expect(tally(list, "pdr")).toMatchObject({ toDo: 2, inPdr: 1, finished: 1, total: 3 });
    expect(tally(list, "headliner")).toMatchObject({ toRefit: 1, toRemove: 0, total: 1 });
  });
});
