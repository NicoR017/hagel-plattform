import { t } from "../i18n";

export type OccLevel = "none" | "ok" | "warn" | "full" | "over";
/** present / capacity: green < 80 %, orange >= 80 %, red when full, red flashing when over capacity. No capacity = no indicator. */
export function occLevel(present: number, capacity: number): OccLevel {
  if (!capacity || capacity <= 0) return "none";
  if (present > capacity) return "over";
  if (present === capacity) return "full";
  return present / capacity >= 0.8 ? "warn" : "ok";
}
export const levelClass = (l: OccLevel) => (l === "none" || l === "ok" ? "" : l);

export function Occ({ present, capacity, onClick }: { present: number; capacity: number; onClick?: () => void }) {
  const lvl = occLevel(present, capacity);
  const text = capacity ? `${present} / ${capacity}` : `${present}`;
  const title = lvl === "over" ? t("over") : lvl === "full" ? t("full") : t("occupancy");
  return <span className={"occ " + levelClass(lvl)} title={title} onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>{text}{lvl === "over" ? " ⚠" : ""}</span>;
}

export function OccBar({ present, capacity }: { present: number; capacity: number }) {
  const lvl = occLevel(present, capacity);
  const pct = capacity ? Math.min(100, Math.round((present / capacity) * 100)) : 0;
  return <div className={"occbar " + levelClass(lvl)} role="progressbar" aria-valuenow={present} aria-valuemax={capacity || undefined}><i style={{ width: pct + "%" }} /></div>;
}
