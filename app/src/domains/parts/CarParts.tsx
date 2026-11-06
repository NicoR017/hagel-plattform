import { go } from "../../shared/route";
import { fmtDateTime, t } from "../../shared/i18n";
import type { LocalVehicle } from "../../shared/sync/db";
import { useField } from "../../shared/store";
import { partsOfVehicle, zoneLabel } from "../vehicles/partsLogic";
import { PartActions } from "./PartActions";
import { CarOrders } from "./Orders";
import { carPartsState, deliveredOf, missingCount, statusLabel } from "./partsBoardLogic";

const COLOR: Record<string, { bg: string; fg: string }> = {
  to_order: { bg: "#EEF1F6", fg: "#46526A" }, order_sent: { bg: "#FDF0E1", fg: "#8A4A06" }, ordered: { bg: "#FBF1D9", fg: "#7A5300" },
  delivered: { bg: "#E3ECFD", fg: "#1D4FB8" }, installed: { bg: "#E3F4EA", fg: "#17663F" },
};
export const StatusPill = ({ s }: { s: string }) => <span className="badge" style={{ background: (COLOR[s] ?? COLOR.to_order).bg, color: (COLOR[s] ?? COLOR.to_order).fg, fontSize: 11 }}>{statusLabel(s)}</span>;

/** the banner of a car: waiting for parts / all delivered = ready for reassembly / all installed */
export function PartsBanner({ v }: { v: LocalVehicle }) {
  const parts = partsOfVehicle(v as { parts?: never });
  const st = carPartsState(parts);
  if (st === "none" || st === "to_order") return null;
  const ready = st === "ready" || st === "installed";
  return (
    <div role="status" style={{ background: ready ? "#E9F4EE" : "#FDF0E1", color: ready ? "#17663F" : "#8A4A06", borderRadius: 12, padding: "10px 14px", fontWeight: 700, margin: "0 0 12px" }}>
      {st === "installed" ? "✓ " + t("f3AllInstalled") : ready ? "✓ " + t("f3Ready") : "⏳ " + t("f3Waiting").replace("{n}", String(missingCount(parts)))}
    </div>
  );
}

/** Parts of one car (tab "Parts" of the repair detail): status, who delivered / installed, the actions the user may do. No prices. */
export function CarParts({ v, stationId }: { v: LocalVehicle; stationId: string }) {
  const f = useField();
  const parts = partsOfVehicle(v as { parts?: never });
  const custom = f.refs?.parts?.zones ?? [];
  const { d, n } = deliveredOf(parts);
  return (
    <section className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>🔩 {t("f3PartsOfCar")}{n > 0 && <span className="muted" style={{ fontWeight: 400 }}> · {d}/{n} {t("f3Delivered")}</span>}</h3>
        {n > 0 && <button className="chip" onClick={() => go({ page: "parts", stationId, view: "part", car: v.id })}>{t("f3PartsPartsBoard")}</button>}
      </div>
      <PartsBanner v={v} />
      {!n && <div className="muted">{t("f3NoPartsCar")}</div>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {parts.map((p) => (
          <li key={p.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <b>{p.name}{p.qty > 1 ? ` × ${p.qty}` : ""}</b><StatusPill s={p.status} />
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {p.zoneKey ? zoneLabel(p.zoneKey, custom) : t("f2BoxZone")}{p.oemRef ? ` · OEM ${p.oemRef}` : ""}
              {p.deliveredAt ? ` · ${t("f3DeliveredOn").replace("{d}", fmtDateTime(p.deliveredAt))}` : ""}{p.installedAt ? ` · ${t("f3InstalledOn").replace("{d}", fmtDateTime(p.installedAt))}` : ""}
              {(p.returnCount ?? 0) > 0 ? ` · ${t("f3ReturnedTimes").replace("{n}", String(p.returnCount))}` : ""}
            </div>
            <PartActions v={v} p={p} />
          </li>
        ))}
      </ul>
      <CarOrders v={v} />
    </section>
  );
}
