// V7 F3b: helpers of the orders screens (late parts, labels, dates).
import { describe, expect, it } from "vitest";
import { setLang } from "../src/shared/i18n";
import { dmy, kindText, reasonText, statusText } from "../src/domains/parts/orderApi";
import { isLate } from "../src/domains/parts/partsBoardLogic";

const part = (status: string, expectedAt: string | null) => ({ id: "p", zoneKey: "dach", catalogId: null, name: "Antena", qty: 1, oemRef: null, source: "assessment", status, expectedAt }) as never;

describe("late parts", () => {
  it("late = the announced (else expected) day passed and the part has not arrived; never for 'to order', delivered, installed or cancelled", () => {
    expect(isLate(part("order_sent", "2026-11-05"), "2026-11-06")).toBe(true);
    expect(isLate(part("ordered", "2026-11-06"), "2026-11-06")).toBe(false); // due today: not late yet
    expect(isLate(part("ordered", "2026-11-10"), "2026-11-06")).toBe(false);
    expect(isLate(part("ordered", null), "2026-11-06")).toBe(false);
    for (const s of ["to_order", "delivered", "installed", "cancelled"]) expect(isLate(part(s, "2020-01-01"), "2026-11-06")).toBe(false);
  });
});

describe("labels", () => {
  it("statuses, kinds and reasons in the language; 'other: text' keeps the text; dates dd/mm/yyyy", () => {
    setLang("es");
    expect(statusText("send_failed")).toBe("Envío fallido"); expect(kindText("cancellation")).toBe("Anulación");
    expect(reasonText("forgotten")).toBe("Pieza olvidada"); expect(reasonText("other: golpe")).toBe("Otro motivo: golpe"); expect(reasonText(null)).toBe("");
    setLang("fr"); expect(statusText("confirmed")).toBe("Confirmée");
    setLang("de");
    expect(dmy("2026-11-06")).toBe("06/11/2026"); expect(dmy("2026-11-06T10:00:00Z")).toBe("06/11/2026"); expect(dmy(null)).toBe("—");
  });
});
