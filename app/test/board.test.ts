// Repair board logic: which cards sit in which column, what "Finish" needs, the badges.
import { describe, expect, it } from "vitest";
import { REPAIR_STAGES, arrivedToday, blockerKey, boardOf, moveCheck, neighbour, onBoard, stageOf, todosOpen } from "../src/v3/boardLogic";

const S = "station-1";
const car = (o: Record<string, unknown> = {}) => ({ statut: "reparatur", stationId: S, repairStage: "bereit", ...o }) as never as Parameters<typeof stageOf>[0];

describe("columns", () => {
  it("six columns in the order of the work", () => {
    expect([...REPAIR_STAGES]).toEqual(["bereit", "demontage", "pdr", "remontage", "bodyshop", "finish"]);
  });
  it("a card sits in its stored stage; without one, in Bereit (Finish when finished)", () => {
    expect(stageOf(car({ repairStage: "pdr" }))).toBe("pdr");
    expect(stageOf(car({ repairStage: null }))).toBe("bereit");
    expect(stageOf(car({ repairStage: undefined, statut: "fertig" }))).toBe("finish");
    expect(stageOf(car({ repairStage: "nonsense" }))).toBe("bereit");
  });
  it("who is on the board: cars in repair, finished, or in the repair flow (also while waiting); not returned, not the ones in assessment", () => {
    expect(onBoard(car())).toBe(true);
    expect(onBoard(car({ statut: "fertig", repairStage: "finish" }))).toBe(true);
    expect(onBoard(car({ statut: "attente", repairStage: "pdr" }))).toBe(true);
    expect(onBoard(car({ statut: "rendu", repairStage: "finish" }))).toBe(false);
    expect(onBoard(car({ statut: "besichtigung", repairStage: null }))).toBe(false);
    expect(onBoard(car({ statut: "attente", repairStage: null }))).toBe(false);
  });
  it("waiting for an appointment or for the insurer / customer approval: off the board; waiting for parts or another reason: still on it", () => {
    expect(onBoard(car({ statut: "attente", statutMotif: "Termin", repairStage: "pdr" }))).toBe(false);
    expect(onBoard(car({ statut: "attente", statutMotif: "Freigabe", repairStage: "bereit" }))).toBe(false);
    expect(onBoard(car({ statut: "attente", statutMotif: " freigabe ", repairStage: "bereit" }))).toBe(false);
    expect(onBoard(car({ statut: "attente", statutMotif: "Teile", repairStage: "pdr" }))).toBe(true);
    expect(onBoard(car({ statut: "attente", statutMotif: "Sonstiges", repairStage: "pdr" }))).toBe(true);
    expect(onBoard(car({ statut: "reparatur", statutMotif: "Termin", repairStage: "pdr" }))).toBe(true); // the reason only counts on hold
  });
  it("board of one station: grouped by column, other stations ignored", () => {
    const list = [car({ repairStage: "bereit" }), car({ repairStage: "pdr" }), car({ repairStage: "pdr" }), car({ stationId: "other", repairStage: "pdr" }), car({ statut: "besichtigung", repairStage: null })];
    const b = boardOf(list, S);
    expect(Object.fromEntries(REPAIR_STAGES.map((s) => [s, b[s].length]))).toEqual({ bereit: 1, demontage: 0, pdr: 2, remontage: 0, bodyshop: 0, finish: 0 });
  });
  it("‹ › neighbours stop at the ends", () => {
    expect(neighbour("bereit", -1)).toBeNull();
    expect(neighbour("bereit", 1)).toBe("demontage");
    expect(neighbour("finish", 1)).toBeNull();
    expect(neighbour("finish", -1)).toBe("bodyshop");
  });
});

describe("Finish", () => {
  it("every other column is free; Finish needs what the server says (nothing open)", () => {
    const blocked = car({ repair: { finishBlockers: ["todos_open", "check:chef", "photos:pdr"] } });
    for (const s of REPAIR_STAGES.filter((x) => x !== "finish")) expect(moveCheck(blocked, s).ok).toBe(true);
    expect(moveCheck(blocked, "finish")).toEqual({ ok: false, reasons: ["todos_open", "check:chef", "photos:pdr"] });
    expect(moveCheck(car({ repair: { finishBlockers: [] } }), "finish").ok).toBe(true);
  });
  it("a car already in Finish can always 'move' there (no new check)", () => {
    expect(moveCheck(car({ repairStage: "finish", repair: { finishBlockers: ["todos_open"] } }), "finish").ok).toBe(true);
  });
  it("reasons have a translation key", () => {
    expect(blockerKey("todos_open")).toBe("v5BlkTodos");
    expect(blockerKey("no_technician")).toBe("v5BlkTech");
    expect(blockerKey("check:pdr")).toBe("v5BlkCheck_pdr");
    expect(blockerKey("check:chef")).toBe("v5BlkCheck_chef");
    expect(blockerKey("photos:remontage")).toBe("v5BlkPhoto");
  });
});

describe("badges", () => {
  it("open to-dos are counted; the card says 'Termin heute' only on the day of the appointment", () => {
    expect(todosOpen(car({ repair: { todos: [{ done: true }, { done: false }, { done: false }] } }))).toBe(2);
    expect(todosOpen(car())).toBe(0);
    expect(arrivedToday(car({ repair: { autoStartedOn: "2026-10-22" } }), "2026-10-22")).toBe(true);
    expect(arrivedToday(car({ repair: { autoStartedOn: "2026-10-22" } }), "2026-10-23")).toBe(false);
    expect(arrivedToday(car(), "2026-10-22")).toBe(false);
  });
});
