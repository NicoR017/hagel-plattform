import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { t } from "./i18n";
import { toast } from "./field/toast";
import { readyToReload } from "./field/updateGate";
import { captureUiParam } from "./field/uiMode";
import "./style.css";

captureUiParam(); // ?ui=legacy / ?ui=v3 is remembered on this device
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

/**
 * PWA update (prompt mode): the new version is downloaded in the background and waits. It is installed and the page reloaded only when the
 * sync queue is empty and the user is on a quiet screen (no dialog, not in an assessment / repair step), so nothing in progress is lost.
 * Everything the user entered lives in IndexedDB anyway; this just avoids interrupting work.
 */
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    toast(t("appUpdated"), 6000);
    const iv = setInterval(() => { if (readyToReload()) { clearInterval(iv); void updateSW(true); } }, 2000);
  },
});
