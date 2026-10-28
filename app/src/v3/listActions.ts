import { buildXlsx, fmtDate, xlsxFileName } from "@hagel/documents";
import type { LocalVehicle } from "../sync/db";
import { t } from "../i18n";
import { applyColibriToVehicle, readColibriFile } from "../sync/colibriImport";
import { createVehicle } from "../sync/mutations";
import { shareOrDownload, toDoc } from "../field/docs";
import { statusLabel } from "../field/Dialogs";
import type { FieldCtx } from "../field/store";

const today = () => new Date().toISOString().slice(0, 10);

/** Excel list of the given vehicles (columns the user may not see are left out, like before). */
export async function exportVehiclesXlsx(f: FieldCtx, list: LocalVehicle[], title: string): Promise<boolean> {
  if (!list.length) return false;
  const bytes = buildXlsx(list.map((v) => ({ ...toDoc(v, f.refs), status: v.statut })), `${title} ${fmtDate(today())}`, { prices: f.can("prix.voir"), internalSplit: f.can("repartition_interne.voir") }, { settings: f.calc });
  await shareOrDownload(bytes, xlsxFileName(title, today()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  return true;
}

/** One vehicle per Colibri PDF (the v20 bulk import), created in `stationId`. Returns the lines of the result report. */
export async function bulkColibri(f: FieldCtx, stationId: string, files: File[], progress: (s: string) => void): Promise<string[]> {
  const report: string[] = [];
  for (let i = 0; i < files.length; i++) {
    progress(`${t("reading")} ${i + 1} / ${files.length} …`);
    try {
      const bytes = await files[i].arrayBuffer();
      const res = await readColibriFile(bytes);
      if (!res) { report.push(`✗ ${files[i].name}: ${t("colibriUnknown")}`); continue; }
      const id = await createVehicle(f.mut, { stationId, statut: "besichtigung" });
      const v = (await f.db.vehicles.get(id))!;
      const r = await applyColibriToVehicle(f.mut, v, res, { name: files[i].name, bytes });
      report.push(`${r.match ? "✓" : "⚠"} ${r.plate || files[i].name}: ${r.panels} ${t("panelsWord")}, ${r.imported} ${t("dentsWord")}${r.match ? "" : ` – ${t("reportSays")} ${r.total} – ${t("pleaseCheck")}`}${r.unknown.length ? ` – ${t("unknownWord")}: ${r.unknown.join(", ")}` : ""}`);
    } catch (e) { report.push(`✗ ${files[i].name}: ${(e as Error).message}`); }
  }
  progress("");
  return report;
}

export const modeTitle = (mode: "kalk" | "rep" | "all") => (mode === "kalk" ? t("v3ModeKalk") : mode === "rep" ? t("v3ModeRep") : t("v3ModeAll"));
export const holdLabel = (v: { statut: string; statutMotif?: unknown }) => `${statusLabel(v.statut)}${v.statut === "attente" && v.statutMotif ? ` · ${String(v.statutMotif)}` : ""}`;
