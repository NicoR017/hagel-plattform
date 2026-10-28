import type { ReactNode } from "react";
import type { Key } from "../i18n";
import type { Intervention } from "./fieldLogic";

/** colours by intervention: green PDR, orange push to paint, red replace (grey = removal/refit, blue = spare part) */
export const KIND: Record<Intervention, { bg: string; fg: string; fill: string; stroke: string; label: Key }> = {
  pdr: { bg: "#E4EEE5", fg: "#2F5535", fill: "#86b08a", stroke: "#5e8c63", label: "fvPdr" },
  ptp: { bg: "#FDF0E1", fg: "#8A4A06", fill: "#F0A64B", stroke: "#C9781A", label: "fvPtp" },
  replace: { bg: "#FBE4E1", fg: "#8F1D14", fill: "#E0796D", stroke: "#A23B2E", label: "fvReplace" },
};

export const Chip = ({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) => <span className="badge" style={{ background: bg, color: fg, fontSize: 12 }}>{children}</span>;
