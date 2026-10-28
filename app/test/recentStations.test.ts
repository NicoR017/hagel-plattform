import { describe, expect, it } from "vitest";
import { pushRecent } from "../src/sync/mutations";

describe("the stations used last", () => {
  it("latest first, no duplicates, a bounded list", () => {
    expect(pushRecent(undefined, "a")).toEqual(["a"]);
    expect(pushRecent(["a"], "b")).toEqual(["b", "a"]);
    expect(pushRecent(["b", "a"], "a")).toEqual(["a", "b"]);
    expect(pushRecent(["c", "b", "a"], "d")).toEqual(["d", "c", "b", "a"]);
    const many = Array.from({ length: 20 }, (_, i) => "s" + i).reduce<string[]>((acc, id) => pushRecent(acc, id), []);
    expect(many).toHaveLength(15);
    expect(many[0]).toBe("s19");
  });
});
