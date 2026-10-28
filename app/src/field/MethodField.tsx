import { ES_MATRIX_DEFAULT, type EsMatrix } from "@hagel/calc";
import type { ClientMethod } from "@hagel/shared";
import { t } from "../i18n";
import type { LocalVehicle } from "../sync/db";
import { setMethod } from "../sync/mutations";
import { methodOfVehicle } from "./calc";
import { useField } from "./store";
import { Field } from "./ui";

/** one line about the parameters of a method version (no prices: those stay with `prix.voir`) */
export function methodSummary(m: ClientMethod, version: number): string {
  const p = m.versions[String(version)] as Record<string, unknown> | undefined;
  if (!p) return "";
  if (m.engine === "aw") {
    const a = p as { vat: number; aluFactor: number; kleberFactor: number; ptpFactor: number };
    return `MwSt ${Math.round(a.vat * 100)} % · Alu +${Math.round((a.aluFactor - 1) * 100)} % · Kleber +${Math.round((a.kleberFactor - 1) * 100)} % · PTP −${Math.round((1 - a.ptpFactor) * 100)} %`;
  }
  const mx = ((p as { esMatrix: EsMatrix | null }).esMatrix ?? ES_MATRIX_DEFAULT);
  const cats = mx.categories.map((c) => c.cat);
  return `${cats[0]}–${cats[cats.length - 1]} · max ${Math.max(...mx.categories.map((c) => c.cap_h))} h · IVA ${Math.round(mx.vat * 100)} %`;
}

/** The calculation method of the vehicle: where it comes from (insurer / standard / chosen), what it is, and (with permission) how to change it. */
export function MethodField({ v }: { v: LocalVehicle }) {
  const f = useField();
  const methods = f.refs?.methods ?? [];
  if (!methods.length) return null; // an older server: nothing to show
  const x = v as Record<string, unknown>;
  const land: "DE" | "ES" = x.land === "ES" ? "ES" : "DE";
  const cur = methodOfVehicle(f.refs, v);
  const version = Number(x.methodVersion) || cur?.currentVersion || 1;
  const mapped = f.refs?.insurerMethods?.find((i) => i.insurerId === v.insurerId && i.country === land);
  const insurer = f.refs?.insurers.find((i) => i.id === v.insurerId)?.name;
  const source = !cur ? t("v4MethodStd") : mapped && mapped.methodId === cur.id ? `${t("v4MethodAuto")} ${insurer ?? ""}`.trim() : cur.isSystem ? t("v4MethodStd") : t("v4MethodManual");
  const may = f.can("commission.modifier") || f.can("methoden.gerer");
  const locked = Object.keys((v.panels ?? {}) as object).length > 0;
  const options = methods.filter((m) => !m.archived && m.country === land);
  return (
    <Field label={t("v4Method")} hint={locked ? t("v4MethodLocked") : undefined}>
      <div style={{ background: "var(--bg)", borderRadius: 12, padding: "10px 12px" }}>
        <div className="row"><b>{cur ? `${cur.name} · v${version}` : t("v4MethodNone")}</b><span className="badge" style={{ background: "#E4EEE5", color: "#2F5535" }}>{source}</span></div>
        {cur && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{methodSummary(cur, version)}</div>}
      </div>
      {may && !locked && options.length > 1 && (
        <select className="sel" style={{ marginTop: 8 }} value={cur?.id ?? ""} aria-label={t("v4Method")}
          onChange={(e) => { const m = options.find((o) => o.id === e.target.value); if (m) void setMethod(f.mut, v.id, m.id, m.currentVersion); }}>
          {!cur && <option value="">—</option>}
          {options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      )}
    </Field>
  );
}
