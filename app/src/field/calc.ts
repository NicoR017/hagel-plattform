import { computeVehicle, type CalcMethodDef, type CalcResult, type CalcVehicle, type Settings } from "@hagel/calc";
import type { ClientMethod } from "@hagel/shared";
import type { Refs } from "../sync/db";

/** The method (the exact VERSION) frozen on a vehicle, from the methods the server sent; null = historical behaviour (organisation settings). */
export function methodDefOf(refs: Pick<Refs, "methods"> | undefined, v: { methodId?: unknown; methodVersion?: unknown }): CalcMethodDef | null {
  const id = typeof v.methodId === "string" ? v.methodId : null, ver = Number(v.methodVersion);
  if (!id || !ver) return null;
  const m = refs?.methods?.find((x) => x.id === id);
  const params = m?.versions[String(ver)];
  return m && params ? ({ engine: m.engine, params } as CalcMethodDef) : null;
}

export const methodOfVehicle = (refs: Pick<Refs, "methods"> | undefined, v: { methodId?: unknown }): ClientMethod | undefined =>
  typeof v.methodId === "string" ? refs?.methods?.find((x) => x.id === v.methodId) : undefined;

/** Same numbers as the server: the vehicle is always calculated with the method version it was frozen on. */
export const calcWith = (v: unknown, settings: Settings, refs: Pick<Refs, "methods"> | undefined): CalcResult =>
  computeVehicle(v as CalcVehicle, settings, methodDefOf(refs, v as { methodId?: unknown; methodVersion?: unknown }));

/** Method of the insurer for a country (else the system method): what a new vehicle is frozen on. */
export function defaultMethodFor(refs: Pick<Refs, "methods" | "insurerMethods"> | undefined, insurerId: string | null | undefined, country: "DE" | "ES"): { id: string; version: number } | null {
  const live = (refs?.methods ?? []).filter((m) => !m.archived && m.country === country);
  const mapped = insurerId ? refs?.insurerMethods?.find((x) => x.insurerId === insurerId && x.country === country) : undefined;
  const m = (mapped && live.find((x) => x.id === mapped.methodId)) ?? live.find((x) => x.isSystem);
  return m ? { id: m.id, version: m.currentVersion } : null;
}

/** Name printed small on the KVA: without the system suffix and without the "PDR Team" brand (a neutral letterhead must not show it). */
export const printableMethodName = (m: ClientMethod | undefined): string | undefined => {
  if (!m) return undefined;
  const n = m.name.replace(/\s*\(System\)\s*$/i, "").replace(/^PDR Team\s+/i, "").trim();
  return n || undefined;
};
