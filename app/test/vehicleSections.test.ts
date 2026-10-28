import { describe, expect, it } from "vitest";
import { sectionsFor } from "../src/v3/VehicleDetail";

describe("sections of the vehicle detail", () => {
  const all = (p: string) => p === "termine.buchen";
  const none = () => false;
  it("the repair appointment is in every mode, whatever the status, for accounts that may book", () => {
    for (const mode of ["kalk", "rep", "all"] as const) {
      for (const statut of ["arrive", "besichtigung", "attente", "reparatur", "fertig", "rendu"]) {
        expect(sectionsFor(mode, { statut }, all), `${mode}/${statut}`).toContain("termin");
        expect(sectionsFor(mode, { statut, repairStage: "pdr" }, all), `${mode}/${statut}/stage`).toContain("termin");
      }
    }
  });
  it("and absent for accounts without the booking right", () => {
    for (const mode of ["kalk", "rep", "all"] as const) expect(sectionsFor(mode, { statut: "arrive" }, none)).not.toContain("termin");
  });
  it("sits right after the general data", () => {
    for (const mode of ["kalk", "rep", "all"] as const) expect(sectionsFor(mode, { statut: "rendu" }, all).slice(0, 2)).toEqual(["basis", "termin"]);
  });
});
