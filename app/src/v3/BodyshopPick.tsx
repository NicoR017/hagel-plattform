// "At Bodyshop": which body shop of the tenant has the car. A drop-down with the carrosserie sites of the car's Colibri tenant.
import { t } from "../i18n";
import type { LocalVehicle } from "../sync/db";
import { setBodyshop } from "../sync/mutations";
import { useField } from "../field/store";

/** body shops a car can go to: the carrosserie sites of the same tenant as the car's own site (a site without tenant: all) */
export function useBodyshops(v: Pick<LocalVehicle, "stationId" | "bodyshopId">) {
  const f = useField();
  const own = f.refs?.stations.find((s) => s.id === v.stationId);
  const list = (f.refs?.bodyshops ?? []).filter((b) => !b.azureTenant || !own?.azureTenant || b.azureTenant === own.azureTenant);
  const current = (f.refs?.bodyshops ?? []).find((b) => b.id === v.bodyshopId) ?? null;
  return { list, current };
}

export function BodyshopPick({ v, disabled, compact }: { v: LocalVehicle; disabled?: boolean; compact?: boolean }) {
  const f = useField();
  const { list, current } = useBodyshops(v);
  // a chosen shop that is no longer offered (deactivated, other tenant) stays visible
  const opts = current && !list.some((b) => b.id === current.id) ? [current, ...list] : list;
  return (
    <label className="bspick" style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: compact ? 11 : 13 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <span className="muted">{t("v5BodyshopWhere")}</span>
      <select value={v.bodyshopId ?? ""} disabled={disabled || !opts.length} aria-label={t("v5BodyshopWhere")} style={{ minHeight: compact ? 36 : 44, borderRadius: 8, border: "1px solid #DDE2EA", padding: "0 8px", font: "inherit", background: "#fff", color: "#1A2433", width: "100%" }}
        draggable={false} onChange={(e) => void setBodyshop(f.mut, v.id, e.target.value || null)}>
        <option value="">{opts.length ? t("v5BodyshopPick") : t("v5BodyshopNone")}</option>
        {opts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  );
}
