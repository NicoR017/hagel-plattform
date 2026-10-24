import { describe, expect, it } from "vitest";
import { handoverMail } from "../src/mails";

const info = { plate: "1234-ABC", model: "Renault Clio", stationName: "Taller Sur", customerName: "Ana López", senderName: "Marta" };

describe("handoverMail", () => {
  for (const kind of ["drop_off", "pick_up"] as const) {
    it(`${kind}: four languages, vehicle and place, distinct, no price`, () => {
      const mails = (["de", "en", "fr", "es"] as const).map((l) => handoverMail(l, kind, info));
      for (const m of mails) {
        expect(m.subject.length).toBeGreaterThan(5);
        expect(m.text.length).toBeGreaterThan(40);
        for (const s of ["1234-ABC", "Renault Clio", "Taller Sur"]) expect(m.subject + "\n" + m.text).toContain(s);
        expect(m.text).toContain("Marta");
        expect(m.subject + m.text).not.toContain("€");
      }
      expect(new Set(mails.map((m) => m.subject)).size).toBe(4);
      expect(new Set(mails.map((m) => m.text)).size).toBe(4);
    });
  }
  it("drop-off and pick-up differ; works without sender / model", () => {
    expect(handoverMail("de", "drop_off", info).subject).toContain("Fahrzeugannahme");
    expect(handoverMail("de", "pick_up", info).subject).toContain("Fahrzeugrückgabe");
    const m = handoverMail("es", "pick_up", { ...info, model: "", senderName: "" });
    expect(m.text).not.toContain("undefined");
    expect(m.text).toContain("1234-ABC");
  });
});
