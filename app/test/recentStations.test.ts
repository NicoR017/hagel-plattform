import { describe, expect, it } from "vitest";
import { pushRecent } from "../src/sync/mutations";

describe("the 3 stations used last", () => {
  it("latest first, no duplicates, at most 3", () => {
    expect(pushRecent(undefined, "a")).toEqual(["a"]);
    expect(pushRecent(["a"], "b")).toEqual(["b", "a"]);
    expect(pushRecent(["b", "a"], "a")).toEqual(["a", "b"]);
    expect(pushRecent(["c", "b", "a"], "d")).toEqual(["d", "c", "b"]);
  });
});
