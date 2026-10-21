import { useEffect, useState } from "react";
import { t } from "./i18n";

export interface AppConfig { appEnv: "production" | "staging" | "development"; uiV3Default: boolean }
const KEY = "hagel.config";
const read = (): AppConfig | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; } };

/** Environment of the server (public endpoint). The last answer is cached, so the banner also shows offline. */
export function useAppConfig(): AppConfig | null {
  const [cfg, setCfg] = useState<AppConfig | null>(read);
  useEffect(() => {
    let live = true;
    fetch("/api/config").then((r) => (r.ok ? r.json() : null)).then((c: AppConfig | null) => {
      if (!live || !c) return;
      setCfg(c);
      try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return cfg;
}

/** Red strip on every screen of the staging environment, so nobody mistakes it for production. */
export function EnvBanner() {
  const cfg = useAppConfig();
  const staging = cfg?.appEnv === "staging";
  useEffect(() => {
    if (staging && !document.title.startsWith("STAGING")) document.title = "STAGING · " + document.title;
  }, [staging]);
  if (!staging) return null;
  return (
    <div role="status" style={{ position: "sticky", top: 0, zIndex: 1000, background: "#b42318", color: "#fff", textAlign: "center", fontWeight: 700, fontSize: 13, padding: "6px 12px" }}>
      {t("stagingBanner")}
    </div>
  );
}
