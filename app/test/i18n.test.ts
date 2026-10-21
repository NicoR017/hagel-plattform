import { describe, expect, it } from "vitest";
import { ERROR_MESSAGES, LANGS, PERMISSIONS, SYSTEM_ROLES, errorMessage, pickLang } from "@hagel/shared";
import { dictionaries, getLang, setLang, t, tOr } from "../src/i18n";

describe("UI dictionaries", () => {
  const de = Object.keys(dictionaries.de).sort();
  it("de and en have exactly the same keys", () => {
    expect(Object.keys(dictionaries.en).sort()).toEqual(de);
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
    expect(same.sort()).toEqual(["appName", "basis", "dashboard", "e.org_tenants", "e.organization", "e.station", "finish", "name", "offline", "online", "org", "photoPhase", "r.freelance", "scanOk", "site", "status", "syncStatus", "tenant", "v3Dashboard", "v3StationWord", "v3Tenant"]);
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
    expect(pickLang(null, "fr-FR")).toBe("de");
    expect(pickLang("xx", undefined)).toBe("de");
  });
});
