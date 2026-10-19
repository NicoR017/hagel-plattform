import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { t } from "./i18n";
import { toast } from "./field/toast";
import "./style.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

/**
 * PWA update: the new version is downloaded in the background; the page is reloaded only when the user is on the list
 * with no dialog open, so nothing in progress is ever lost (all data lives in IndexedDB and in the sync queue anyway).
 */
registerSW({
  immediate: true,
  onNeedRefresh() {
    toast(t("appUpdated"), 6000);
    const iv = setInterval(() => {
      const onList = !location.hash || location.hash === "#/" || location.hash === "#";
      if (onList && !document.querySelector(".overlay")) { clearInterval(iv); location.reload(); }
    }, 2000);
  },
});
