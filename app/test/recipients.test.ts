import { describe, expect, it } from "vitest";
import { addRecipients, hasInvalidPiece, type RecipientChip } from "../src/recipients";

const base: RecipientChip[] = [{ email: "taller@example.test", source: "bodyshop" }, { email: "mutua@example.test", source: "insurer" }];
const emails = (l: RecipientChip[]) => l.map((x) => x.email);

describe("editable recipients (send dialog)", () => {
  it("a paste of several addresses creates several chips, normalised, duplicates ignored", () => {
    const r = addRecipients(base, " A@X.de; b@y.es ,TALLER@example.test  a@x.de");
    expect(emails(r.list)).toEqual(["taller@example.test", "mutua@example.test", "a@x.de", "b@y.es"]);
    expect(r).toMatchObject({ rest: "", error: null });
  });
  it("an invalid piece stays in the field and is not added; the valid ones are", () => {
    const r = addRecipients(base, "ok@x.de nope");
    expect(emails(r.list)).toContain("ok@x.de");
    expect(r).toMatchObject({ rest: "nope", error: "bad" });
  });
  it("the 11th address is refused with the limit message", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ email: `p${i}@x.de` }));
    expect(addRecipients(ten, "more@x.de")).toMatchObject({ rest: "more@x.de", error: "max" });
    expect(addRecipients(ten, "p1@x.de")).toMatchObject({ rest: "", error: null }); // a duplicate is not an overflow
  });
  it("removing every chip leaves an empty list (the send button is then disabled); invalid typing is detected", () => {
    expect(addRecipients([], "").list).toEqual([]);
    expect(hasInvalidPiece("a@x.de bad")).toBe(true);
    expect(hasInvalidPiece("a@x.de; ")).toBe(false);
  });
});
