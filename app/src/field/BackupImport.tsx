import { isPlace } from "./places";
import { useRef, useState } from "react";
import { api } from "../api";
import { eur } from "@hagel/documents";
import { computeVehicle, type CalcVehicle } from "@hagel/calc";
import { t } from "../i18n";
import { parseBackup, planImport, runImport, type ImportPlan, type ImportResult, type OldBackup } from "../sync/backup";
import { Dialog, Field, ToggleRow } from "./ui";
import { useField } from "./store";

/** "Alte Sicherung importieren": reads a v20 JSON backup, creates the vehicles / photos / scans through the normal queue, verifies the totals. */
export function BackupImport({ onClose }: { onClose: () => void }) {
  const f = useField();
  const sites = (f.refs?.stations ?? []).filter((s) => s.active && isPlace(s));
  const [backup, setBackup] = useState<OldBackup | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [err, setErr] = useState("");
  const [stationId, setStationId] = useState(sites[0]?.id ?? "");
  const [fallback, setFallback] = useState("");
  const [replace, setReplace] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<(ImportResult & { netAfter: number }) | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = async (file: File) => {
    setErr(""); setPlan(null); setResult(null);
    const b = parseBackup(await file.text());
    if (!b) { setErr(t("backupInvalid")); return; }
    setBackup(b);
    const existing = new Set((await f.db.vehicles.toArray()).map((v) => v.id));
    setPlan(await planImport(b, f.refs, existing, f.calc));
  };

  /** Old customers that match no carrosserie site: create them (needs stations.gerer) so that their cars keep their customer. */
  const createMissing = async () => {
    if (!plan || !backup) return;
    setErr("");
    const land = (f.refs?.stations.find((x) => x.id === stationId)?.country ?? "ES");
    for (const name of plan.unmatched) {
      try { await api("POST", "/admin/bodyshops", { name, country: land === "DE" ? "DE" : "ES" }); }
      catch (e) { setErr(`${name}: ${(e as Error).message}`); return; }
    }
    await f.engine.syncNow(f.orgId);
    const refs = await f.db.getMeta<NonNullable<typeof f.refs>>(`refs:${f.orgId}`);
    const existing = new Set((await f.db.vehicles.toArray()).map((v) => v.id));
    setPlan(await planImport(backup, refs, existing, f.calc));
  };

  const run = async () => {
    if (!backup || !plan) return;
    setProgress("…");
    const r = await runImport(f.mut, backup, plan, { stationId, fallbackClientId: fallback || null, replaceNewer: replace }, f.can("commission.modifier"), (i, n) => setProgress(`${i} / ${n}`));
    // verification: net total of what is now on this phone for the imported vehicles
    const ids = new Set(plan.items.map((i) => i.newId));
    const now = (await f.db.vehicles.toArray()).filter((v) => ids.has(v.id));
    const netAfter = now.reduce((a, v) => a + computeVehicle(v as unknown as CalcVehicle, f.calc).netto, 0);
    setProgress("");
    setResult({ ...r, netAfter });
    void f.engine.syncNow(f.orgId);
  };

  const todo = plan ? plan.items.filter((i) => !i.duplicate).length : 0;
  const dups = plan ? plan.items.filter((i) => i.duplicate) : [];
  return (
    <Dialog title={t("importOldBackup")} onClose={onClose}>
      <p className="muted" style={{ fontSize: 13 }}>{t("backupIntro")}</p>
      <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) void load(fl); }} />
      <button className="pbtn sec" onClick={() => input.current?.click()}>📂 {t("chooseBackup")}</button>
      {err && <div className="notice err">{err}</div>}
      {plan && backup && !result && (
        <>
          <div className="notice warn" style={{ marginTop: 12 }}>
            <b>{plan.items.length}</b> {t("vehiclesWord")} · <b>{plan.photos}</b> {t("photosWord")} · <b>{plan.scans}</b> {t("scansWord")}<br />
            {t("netTotalOld")}: <b>{eur(plan.netSum)}</b>
            {!!dups.length && <div>{dups.length} {t("alreadyPresent")}: {dups.slice(0, 8).map((d) => d.plate || d.oldId).join(", ")}</div>}
          </div>
          <Field label={t("importToSite")}>
            <select className="sel" value={stationId} onChange={(e) => setStationId(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </Field>
          {!!plan.unmatched.length && (
            <Field label={`${t("unmatchedCustomers")}: ${plan.unmatched.join(", ")}`}>
              {f.can("stations.gerer") && <button className="pbtn sec" style={{ marginTop: 0, marginBottom: 8 }} onClick={() => void createMissing()}>＋ {t("createMissingCarrosseries")} ({plan.unmatched.length})</button>}
              <select className="sel" value={fallback} onChange={(e) => setFallback(e.target.value)}>
                <option value="">— {t("noCustomer")} —</option>
                {sites.filter((s) => s.type === "carrosserie").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <ToggleRow label={t("replaceNewer")} on={replace} onChange={setReplace} />
          <button className="pbtn" disabled={!stationId || !!progress || (!todo && !replace)} onClick={() => void run()}>{progress ? `${t("importing")} ${progress}` : `${t("importNow")} (${todo})`}</button>
        </>
      )}
      {result && plan && (
        <div className="notice warn" style={{ marginTop: 12 }}>
          <b>{t("importDone")}</b><br />
          {result.created} {t("created")} · {result.updated} {t("updatedWord")} · {result.skipped} {t("skipped")} · {result.photos} {t("photosWord")} · {result.scans} {t("scansWord")}<br />
          {t("netTotalOld")}: {eur(plan.netSum)} → {t("netTotalNow")}: {eur(result.netAfter)}
          {Math.abs(plan.netSum - result.netAfter) < 0.005 && !result.skipped ? " ✓" : ""}
          {!!result.failed.length && <div className="err" style={{ color: "var(--brick)" }}>{result.failed.join("; ")}</div>}
          <div style={{ fontSize: 12, marginTop: 6 }}>{t("importSyncHint")}</div>
        </div>
      )}
    </Dialog>
  );
}
