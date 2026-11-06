// V7 F2: pure helpers of the spare parts (labels on the estimate, zones, names in four languages).
import { describe, expect, it } from "vitest";
import { setLang } from "../src/shared/i18n";
import { allZones, catalogOfZone, hasPartsList, nameIn, partLabels, partsOfVehicle, replacePartName, zoneLabel } from "../src/domains/vehicles/partsLogic";

const part = (o: Record<string, unknown>) => ({ id: "p" + Math.random(), zoneKey: "dach", catalogId: null, name: "Antena", qty: 1, oemRef: null, source: "assessment", status: "to_order", ...o });

describe("partLabels", () => {
  it("uses the parts of the car (× n, cancelled ones left out); the old header list only when the car has no parts list", () => {
    expect(partLabels({ parts: [part({ name: "Antena" }), part({ name: "Barras", qty: 2 }), part({ name: "Fuera", status: "cancelled" })] as never, partsToReplace: ["viejo"] })).toEqual(["Antena", "Barras × 2"]);
    expect(partLabels({ parts: [] as never, partsToReplace: ["viejo"] })).toEqual([]); // an empty parts list is authoritative
    expect(partLabels({ partsToReplace: ["Antenne", " ", 3 as never] })).toEqual(["Antenne"]);
    expect(hasPartsList({ parts: [] as never })).toBe(true); expect(hasPartsList({})).toBe(false);
    expect(partsOfVehicle({ parts: [part({}), part({ status: "cancelled" })] as never })).toHaveLength(1);
  });
});

describe("zones and names", () => {
  it("default zones: exterior (elements of the schema + glass) then interior, then the zones of the admin; names follow the language", () => {
    setLang("fr");
    const zs = allZones({ zones: [{ key: "c_pare", group: "exterior", names: { de: "Stoßfänger", en: "Bumper", fr: "Pare-chocs", es: "Paragolpes" } }], catalog: [] });
    expect(zs.filter((z) => z.group === "exterior").length).toBe(16 + 1);
    expect(zs.filter((z) => z.group === "interior").length).toBe(4);
    expect(zs.find((z) => z.key === "c_pare")).toMatchObject({ custom: true, label: "Pare-chocs" });
    expect(zoneLabel("dach")).toBeTruthy();
    expect(zoneLabel("int_himmel")).toBe("Ciel de toit");
    setLang("es"); expect(zoneLabel("int_himmel")).toBe("Techo interior");
    setLang("de");
  });
  it("catalogue by zone; a name falls back to another language when one is empty; the replaced element is named in the language of the car", () => {
    const refs = { zones: [], catalog: [{ id: "a", names: { de: "Dachreling", en: "", fr: "", es: "Barras" }, zoneKeys: ["dach"], validated: true }, { id: "b", names: { de: "Antenne", en: "", fr: "", es: "" }, zoneKeys: ["heck"], validated: true }] };
    expect(catalogOfZone(refs, "dach").map((c) => c.id)).toEqual(["a"]);
    expect(nameIn(refs.catalog[1].names, "es")).toBe("Antenne");
    expect(nameIn(refs.catalog[0].names, "es")).toBe("Barras");
    expect(replacePartName("haube", "es")).toMatch(/· panel$/);
    expect(replacePartName("haube", "de")).toMatch(/· Blech$/);
    expect(replacePartName("haube", "es")).not.toBe(replacePartName("haube", "de"));
  });
});
