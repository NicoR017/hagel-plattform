import { describe, expect, it } from "vitest";
import { ERROR_MESSAGES, LANGS, PERMISSIONS, SYSTEM_ROLES, errorMessage, pickLang } from "@hagel/shared";
import { dictionaries, getLang, setLang, t, tOr } from "../src/i18n";

describe("UI dictionaries", () => {
  const de = Object.keys(dictionaries.de).sort();
  it("de, en, fr and es have exactly the same keys", () => {
    for (const l of ["en", "fr", "es"] as const) expect(Object.keys(dictionaries[l]).sort(), l).toEqual(de);
  });
  it("French and Spanish are really translated (few strings identical to German: names and shared words only)", () => {
    for (const l of ["fr", "es"] as const) {
      const same = de.filter((k) => dictionaries[l][k as never] === dictionaries.de[k as never]);
      expect(same.length, `${l}: ${same.join(", ")}`).toBeLessThan(60);
    }
  });
  it("placeholders survive translation", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const l of ["en", "fr", "es"] as const) for (const k of de) expect(ph(dictionaries[l][k as never]), `${l}:${k}`).toBe(ph(dictionaries.de[k as never]));
  });
  it("no empty strings", () => {
    for (const l of LANGS) for (const [k, v] of Object.entries(dictionaries[l])) expect(v.trim(), `${l}:${k}`).not.toBe("");
  });
  it("every permission, default role and role description is translated", () => {
    for (const p of PERMISSIONS) expect(de).toContain("p." + p);
    for (const r of SYSTEM_ROLES) { expect(de).toContain("r." + r.key); expect(de).toContain("rd." + r.key); }
  });
  it("English strings are really English (not copies of the German ones, except names)", () => {
    const same = de.filter((k) => dictionaries.en[k as never] === dictionaries.de[k as never]);
    // identical in both languages only for proper names / words that are the same in German and English
    expect(same.sort()).toEqual(["appName", "basis", "dashboard", "e.org_tenants", "e.organization", "e.station", "finish", "fvAlu", "fvAvgSize", "fvBigDents", "fvEarnPdr", "fvInPdr", "fvMethodSanft", "fvMovedTo", "fvPdr", "name", "nsStationCol", "offline", "online", "org", "photoPhase", "pkHeadlinerTag", "pkPdrTag", "r.freelance", "scanOk", "site", "status", "syncStatus", "tenant", "v3Dashboard", "v3StationWord", "v3Tenant", "v4StepKvaEs", "v5Headliner", "v5Stage_finish", "v5Stage_pdr", "v5Team", "v5Todo", "v5ViewBoard", "v6MSystem", "v6MVersion", "v6MenuAzure", "v6MenuSystem", "v6TechHeadliner", "v6WBasis", "v6WPdrPart", "v6WPerson", "v8ScannerScans", "v8ScannerStation"]);
  });
  it("switching the language changes every string at once", () => {
    setLang("de");
    expect(t("users")).toBe("Benutzer");
    setLang("en");
    expect(getLang()).toBe("en");
    expect(t("users")).toBe("Users");
    expect(tOr("p.prix.voir", "x")).toBe("View prices");
    expect(tOr("p.unknown", "custom")).toBe("custom");
    setLang("de");
  });
});

describe("API error messages", () => {
  it("every code has a de and en message", () => {
    for (const [code, m] of Object.entries(ERROR_MESSAGES)) {
      expect(m.de.length, code).toBeGreaterThan(0);
      expect(m.en.length, code).toBeGreaterThan(0);
      expect(m.de, code).not.toBe(m.en);
    }
  });
  it("fills placeholders", () => {
    expect(errorMessage("cannot_grant", "en", { missing: "prix.voir" })).toBe("You are not allowed to grant these permissions: prix.voir");
  });
  it("picks the language from X-Lang, then Accept-Language, else German", () => {
    expect(pickLang("en", "de")).toBe("en");
    expect(pickLang(undefined, "en-GB,en;q=0.9")).toBe("en");
    expect(pickLang(null, "fr-FR")).toBe("fr");
    expect(pickLang("es", "de")).toBe("es");
    expect(pickLang(null, "it-IT")).toBe("de");
    expect(pickLang("xx", undefined)).toBe("de");
  });
});

describe("French and Spanish API messages and e-mails", () => {
  it("every error code has a French and a Spanish message with the same placeholders", () => {
    for (const code of Object.keys(ERROR_MESSAGES) as (keyof typeof ERROR_MESSAGES)[]) {
      for (const l of ["fr", "es"] as const) {
        const m = errorMessage(code, l, { missing: "X", fields: "X", reasons: "X" });
        expect(m.length, `${l}:${code}`).toBeGreaterThan(3);
        expect(m, `${l}:${code}`).not.toBe(errorMessage(code, "de", { missing: "X", fields: "X", reasons: "X" }));
      }
    }
  });
});

