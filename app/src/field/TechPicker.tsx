import { useMemo } from "react";
import { t } from "../i18n";
import { Picker, type PickItem } from "./Picker";
import { useField } from "./store";

export interface TechChoice { key: string; name: string; pdr?: number; dem?: number; userId: string | null; headliner: boolean; stationIds: string[] }

/** The technicians a vehicle can be given to (from the master data; users when there is no technician list yet). */
export function useTechChoices(): TechChoice[] {
  const f = useField();
  const techs = f.refs?.technicians ?? [];
  const people = f.refs?.people ?? [];
  return useMemo(() => techs.length
    ? techs.map((tc) => ({ key: tc.id, name: tc.name, pdr: tc.defaultPctPdr, dem: tc.defaultPctDemontage, userId: tc.userId as string | null, headliner: tc.kind === "headliner", stationIds: tc.stationIds ?? [] }))
    : people.map((p) => ({ key: p.id, name: p.name, pdr: undefined, dem: undefined, userId: p.id as string | null, headliner: false, stationIds: p.stationIds ?? [] })),
  [techs, people]);
}

/** PDR technicians for the PDR work, headliners (if there are any) for de-/re-mounting */
export function offeredFor(choices: TechChoice[], kind: "pdr" | "dem"): TechChoice[] {
  return kind === "pdr" ? choices.filter((p) => !p.headliner) : choices.some((p) => p.headliner) ? choices.filter((p) => p.headliner) : choices;
}

/**
 * Technician / headliner of a vehicle (or of a selection): search picker, the people who work in the vehicle's station first.
 * Picking someone reports his default percentage; free text stays allowed (external technician).
 */
export function TechPicker({ kind, name, stationId, disabled, placeholder, id, onChange }: {
  kind: "pdr" | "dem"; name: string; stationId?: string | null; disabled?: boolean; placeholder?: string; id?: string;
  /** `tech` is the picked technician (null for a free name or when cleared); `prev` the one that was chosen before */
  onChange: (name: string, pct: number | undefined, tech: TechChoice | null, prev: TechChoice | null) => void;
}) {
  const f = useField();
  const choices = useTechChoices();
  const offered = offeredFor(choices, kind);
  const stationsById = new Map((f.refs?.stations ?? []).map((s) => [s.id, s.name]));
  const here = (c: TechChoice) => !!stationId && c.stationIds.includes(stationId);
  const items: PickItem[] = offered.map((c) => ({
    id: c.key, title: c.name, rank: here(c) ? 0 : 1, tag: here(c) ? t("pkWorksHere") : undefined,
    sub: [c.headliner ? t("pkHeadlinerTag") : t("pkPdrTag"), (kind === "pdr" ? c.pdr : c.dem) != null ? `${kind === "pdr" ? c.pdr : c.dem} %` : "", c.stationIds.map((s) => stationsById.get(s)).filter(Boolean).join(", ")].filter(Boolean).join(" · "),
  }));
  const cur = name.trim();
  const curTech = cur ? offered.find((c) => c.name.toLowerCase() === cur.toLowerCase()) ?? null : null;
  return (
    <Picker id={id} items={items} multi={false} disabled={disabled} placeholder={placeholder ?? t("pkTechPh")} hint={t("pkTechHint").replace("{n}", String(offered.length))}
      chosen={cur ? [{ id: curTech?.key ?? "free", label: cur, sub: curTech ? items.find((i) => i.id === curTech.key)?.sub : undefined }] : []}
      onAdd={(it) => { const c = offered.find((x) => x.key === it.id)!; onChange(c.name, kind === "pdr" ? c.pdr : c.dem, c, curTech); }}
      onFree={(text) => onChange(text, undefined, null, curTech)}
      onRemove={() => onChange("", undefined, null, curTech)} />
  );
}
