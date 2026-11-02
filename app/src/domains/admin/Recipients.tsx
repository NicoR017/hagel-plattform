import { useState } from "react";
import { api } from "../../api";
import { t } from "../../shared/i18n";
import { EMAIL_RE } from "../reports/recipients";
import { act, Err, useLoad } from "./shared";

/**
 * The report recipients of a carrosserie: manual addresses (chips, added one by one) plus the automatic ones of the insurers selected for the
 * station ("automatisch · Allianz"), each removable on its own (kept as an exclusion). The real send still goes by the vehicle's insurer.
 */
export function Recipients({ stationId, emails, excluded, canInsurers, onChange }: { stationId?: string; emails: string[]; excluded: string[]; canInsurers: boolean; onChange: (emails: string[], excluded: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState("");
  const prev = useLoad<{ auto: { insurerId: string; insurer: string; email: string }[] }>(stationId ? `/admin/stations/${stationId}/recipients` : "", [stationId, tick]);
  const ins = useLoad<{ id: string; name: string; stationIds: string[] }[]>(canInsurers && stationId ? "/admin/insurers" : "", [tick]);
  const lc = (x: string) => x.trim().toLowerCase();
  const exc = new Set(excluded.map(lc));
  const add = () => {
    const v = lc(draft);
    if (!v) return;
    if (!EMAIL_RE.test(v)) { setBad(true); return; }
    setBad(false); setDraft("");
    if (!emails.map(lc).includes(v)) onChange([...emails, v], excluded);
  };
  const link = async (insurerId: string, on: boolean) => {
    if (!stationId) return;
    const ids = (ins.data ?? []).filter((i) => i.stationIds.includes(stationId) && i.id !== insurerId).map((i) => i.id);
    if (on) ids.push(insurerId);
    await act(() => api("PUT", `/admin/stations/${stationId}/insurers`, { insurer_ids: ids }), setErr, () => setTick((n) => n + 1));
  };
  const auto = prev.data?.auto ?? [];
  const none = !emails.length && !auto.some((a) => !exc.has(a.email));
  return (
    <>
      <label>{t("v6Recipients")}</label>
      <div className="chips">
        {emails.map((e) => <span key={e} className="pill">{e} <button type="button" aria-label={t("delete")} onClick={() => onChange(emails.filter((x) => x !== e), excluded)}>✕</button></span>)}
        {auto.map((a) => exc.has(a.email)
          ? <span key={a.email} className="pill off" style={{ textDecoration: "line-through" }}>{a.email} <button type="button" style={{ textDecoration: "none" }} onClick={() => onChange(emails, excluded.filter((x) => lc(x) !== a.email))}>{t("v6RestoreAuto")}</button></span>
          : <span key={a.email} className="pill auto">{a.email} · {t("v6Automatic")} · {a.insurer} <button type="button" aria-label={t("delete")} onClick={() => onChange(emails, [...excluded, a.email])}>✕</button></span>)}
      </div>
      <div className="row">
        <input style={{ flex: 1, minWidth: 180 }} type="email" value={draft} placeholder="name@example.com" onChange={(e) => { setDraft(e.target.value); setBad(false); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn sec" onClick={add}>{t("v6AddRecipient")}</button>
      </div>
      {bad && <div className="err">{t("v6BadEmail")}</div>}
      {none && <div className="warn">{t("v6NoRecipients")}</div>}
      <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("v6RecipientsHint")}</div>
      {canInsurers && (
        <>
          <label>{t("v6StationInsurers")}</label>
          {!stationId ? <div className="muted">{t("v6SaveFirst")}</div> : (
            <div className="grid">{(ins.data ?? []).map((i) => (
              <label key={i.id}><input type="checkbox" checked={i.stationIds.includes(stationId)} onChange={(e) => void link(i.id, e.target.checked)} />{i.name}</label>
            ))}</div>
          )}
          <Err msg={err} />
        </>
      )}
    </>
  );
}
