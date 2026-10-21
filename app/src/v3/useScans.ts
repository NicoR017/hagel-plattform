import { useEffect, useState } from "react";
import { api } from "../api";
import { useField } from "../field/store";

interface ScanRow { stationName: string; importable: boolean }

/** Importable Colibri scans per station name (online only; empty when offline or without the right). Refreshed when the sync finishes. */
export function useNewScans(): { byStation: Map<string, number>; total: number; known: boolean } {
  const f = useField();
  const [rows, setRows] = useState<ScanRow[] | null>(null);
  const allowed = f.can("colibri.importer");
  const stamp = f.status.lastSyncAt ?? 0;
  useEffect(() => {
    if (!allowed) { setRows(null); return; }
    let live = true;
    api<ScanRow[]>("GET", "/azure/scans").then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows(null); });
    return () => { live = false; };
  }, [allowed, f.orgId, stamp]);
  const byStation = new Map<string, number>();
  for (const r of rows ?? []) if (r.importable) byStation.set(r.stationName, (byStation.get(r.stationName) ?? 0) + 1);
  return { byStation, total: [...byStation.values()].reduce((a, b) => a + b, 0), known: rows !== null };
}
