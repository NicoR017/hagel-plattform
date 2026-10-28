// R3: a new app version is only installed when nothing is in flight.
import { describe, expect, it } from "vitest";
import { mayReload } from "../src/field/updateGate";

const base = { pending: 0, online: true, overlayOpen: false, hash: "#/" };
describe("when the page may reload into a new version", () => {
  it("quiet lists: yes", () => {
    expect(mayReload(base)).toBe(true);
    expect(mayReload({ ...base, hash: "#/s/abc/rep" })).toBe(true);
    expect(mayReload({ ...base, hash: "#/dashboard" })).toBe(true);
  });
  it("never with something waiting to be sent, online or not", () => {
    expect(mayReload({ ...base, pending: 2 })).toBe(false);
    expect(mayReload({ ...base, pending: 1, online: false })).toBe(false);
  });
  it("never with a dialog open, in an assessment, a repair step, a vehicle or the administration", () => {
    expect(mayReload({ ...base, overlayOpen: true })).toBe(false);
    for (const hash of ["#/v/123/basis", "#/s/abc/kalk/exp/123/scan", "#/s/abc/kalk/neu", "#/s/abc/rep/v/123/basis", "#/s/abc/rep/r/123/fotos", "#/admin/methods"]) expect(mayReload({ ...base, hash }), hash).toBe(false);
  });
});
