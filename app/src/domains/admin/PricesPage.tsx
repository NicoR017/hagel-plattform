import { useState } from "react";
import { api } from "../../api";
import { BackupImport } from "../../shared/BackupImport";
import { shareOrDownload } from "../../shared/docs";
import { t } from "../../shared/i18n";
import { useField } from "../../shared/store";
import { buildOldFormatBackup } from "../../shared/sync/exportBackup";
import { toast } from "../../shared/toast";
import { Field, NumInput, Seg } from "../../shared/ui";
import { Card } from "./shared";

/** Organisation rates and Teiler, plus backup import/export (was the old settings popup). */
export function PricesPage() {
  const f = useField();
  const s = f.refs?.settings;
  const [rateDE, setRateDE] = useState(s?.rateDE ?? 83);
  const [rateES, setRateES] = useState(s?.rateES ?? 69);
  const [teiler, setTeiler] = useState<10 | 12>((s?.defaultTeiler as 10 | 12) ?? 10);
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api("PUT", "/admin/settings", { rateDE, rateES, defaultTeiler: teiler });
      toast(t("saved"));
      void f.engine.syncNow(f.orgId);
    } catch (e) {
      toast((e as Error).message);
    }
    setBusy(false);
  };

  const exportBackup = async () => {
    setBusy(true);
    try {
      const r = await buildOldFormatBackup(f.db, f.orgId, f.refs, false);
      await shareOrDownload(new Blob([r.json], { type: "application/json" }), `Hagel-Sicherung_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.json`, "application/json");
      toast(`${r.vehicles} ${t("vehiclesWord")} · ${r.photos} ${t("photosWord")}`);
    } catch (e) {
      toast((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <>
      <Card title={t("v6MenuPrices")}>
        <p className="muted" style={{ marginTop: 0 }}>{t("v6PricesHint")}</p>
        <Field label={t("rateDE")}><NumInput value={rateDE} onChange={setRateDE} max={1000} /></Field>
        <Field label={t("rateES")}><NumInput value={rateES} onChange={setRateES} max={1000} /></Field>
        <Field label={t("teiler")}><Seg value={teiler} options={[{ value: 10, label: "10" }, { value: 12, label: "12" }]} onChange={setTeiler} /></Field>
        <p><button className="btn" disabled={busy} onClick={() => void save()}>{t("save")}</button></p>
      </Card>
      <Card title={t("exportBackup")}>
        <p className="row">
          <button className="btn sec" disabled={busy} onClick={() => setBackup(true)}>{t("importOldBackup")}</button>
          <button className="btn sec" disabled={busy} onClick={() => void exportBackup()}>💾 {t("exportBackup")}</button>
        </p>
      </Card>
      {backup && <BackupImport onClose={() => setBackup(false)} />}
    </>
  );
}
