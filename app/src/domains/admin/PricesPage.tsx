import { useState } from "react";
import { SettingsDialog } from "../../shared/Dialogs";
import { t } from "../../shared/i18n";
import { Card } from "./shared";

export function PricesPage() {
  const [dlg, setDlg] = useState(false);
  return (
    <Card title={t("v6MenuPrices")}>
      <p className="muted" style={{ marginTop: 0 }}>{t("v6PricesHint")}</p>
      <button className="btn" onClick={() => setDlg(true)}>{t("v6OpenSettings")}</button>
      {dlg && <SettingsDialog onClose={() => setDlg(false)} onBackup={() => setDlg(false)} />}
    </Card>
  );
}
