import { applyColibri, colibriPages, parseColibri, scanCheck, type ColibriParse } from "@hagel/colibri";
import type { HeaderFields } from "@hagel/shared";
import type { LocalVehicle } from "./db";
import { setColibri, setHeader, setPanel, type MutCtx } from "./mutations";

export interface ColibriSummary {
  ok: boolean;
  panels: number;
  imported: number;
  total: number | null;
  match: boolean;
  unknown: string[];
  big: number;
  plate: string;
}

/** Reads a Colibri PDF (the v20 algorithm, in /packages/colibri). */
export async function readColibriFile(buf: ArrayBuffer): Promise<ColibriParse | null> {
  const res = parseColibri(await colibriPages(buf.slice(0)));
  return res.found ? res : null;
}

/**
 * Applies a parsed report to a vehicle exactly like v20 (overwrite plate / FIN / model / date, panels get the imported dents,
 * keep alu / bigEur / method / finish, Dachholm gets glue) and queues the resulting changes.
 */
export async function applyColibriToVehicle(c: MutCtx, v: LocalVehicle, res: ColibriParse, file: { name: string; bytes: ArrayBuffer }): Promise<ColibriSummary> {
  const before = v as unknown as { panels: Record<string, any>; kennzeichen?: string; fin?: string; modell?: string; leistungsdatum?: string };
  const after = applyColibri({ panels: before.panels, kennzeichen: before.kennzeichen, fin: before.fin, modell: before.modell, leistungsdatum: before.leistungsdatum } as never, res) as unknown as typeof before & { colibri: any };

  const fields: HeaderFields = {};
  if (after.kennzeichen !== before.kennzeichen && after.kennzeichen != null) fields.kennzeichen = after.kennzeichen;
  if (after.fin !== before.fin && after.fin != null) fields.fin = after.fin;
  if (after.modell !== before.modell && after.modell != null) fields.modell = after.modell;
  if (after.leistungsdatum !== before.leistungsdatum && after.leistungsdatum != null) fields.leistungsdatum = after.leistungsdatum;
  if (Object.keys(fields).length) await setHeader(c, v.id, fields);

  for (const key of Object.keys(res.panels)) {
    const p = after.panels[key];
    if (p) await setPanel(c, v.id, key, p);
    else if (before.panels[key]) await setPanel(c, v.id, key, null);
  }

  const key = `scan:${v.id}`;
  await c.db.blobs.put({ key, blob: new Blob([file.bytes], { type: "application/pdf" }), type: "application/pdf", size: file.bytes.byteLength });
  await c.db.uploads.put({ key, kind: "scan", refId: v.id, vehicleId: v.id, orgId: c.orgId, tries: 0, nextTry: 0 });
  await setColibri(c, v.id, after.colibri, { name: file.name, size: file.bytes.byteLength });

  const chk = scanCheck(after.colibri);
  return {
    ok: true, panels: Object.keys(res.panels).length, imported: res.imported, total: res.reportTotal, match: chk.ok, unknown: res.unknown,
    big: Object.values(res.panels).reduce((a, p) => a + (p.big || 0), 0), plate: String(after.kennzeichen ?? ""),
  };
}

/** v20 "Scan ✓ / Scan prüfen ⚠" badge. */
export function colibriBadge(v: Pick<LocalVehicle, "colibri">): "ok" | "check" | null {
  const k = v.colibri as { imported?: number; reportTotal?: number | null; rowSum?: number; unknown?: string[] } | null;
  if (!k || k.imported == null) return null;
  const total = k.reportTotal != null ? k.reportTotal : k.rowSum;
  return k.imported === total && !(k.unknown ?? []).length ? "ok" : "check";
}
