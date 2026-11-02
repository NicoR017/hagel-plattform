import { useState } from "react";
import { Picker } from "../../shared/Picker";
import { api } from "../../api";
import { act, Card, Err, matches, useLoad } from "./shared";
import { t } from "../../shared/i18n";

interface Station { id: string; type: string; name: string; active: boolean }
interface Insurer { id: string; name: string; reportEmails: string[]; sendReports: boolean; reportsToSend: string; stationIds: string[] }

const emails = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Searchable multi-select: the chosen ones as chips, a search field that opens a short scrolling list of the others. For long lists
 * (an insurer works with many body shops): nothing but the chosen ones is on screen until you search.
 */
function SearchSelect({ options, selected, placeholder, onToggle }: { options: { id: string; name: string }[]; selected: string[]; placeholder: string; onToggle: (id: string, on: boolean) => void }) {
  return (
    <Picker multi placeholder={placeholder} items={options.map((o) => ({ id: o.id, title: o.name }))}
      chosen={options.filter((o) => selected.includes(o.id)).map((o) => ({ id: o.id, label: o.name }))}
      onAdd={(it) => onToggle(it.id, true)} onRemove={(id) => onToggle(id, false)} />
  );
}

// ---------------------------------------------------------------- insurers
/** the calculation method of an insurer per country (— Standard — = the system method of the country) */
function InsurerMethods({ insurerId, methods }: { insurerId: string; methods: { id: string; name: string; country: string; archived: boolean }[] }) {
  const cur = useLoad<{ DE: string | null; ES: string | null }>(`/admin/insurers/${insurerId}/methods`);
  const [err, setErr] = useState("");
  const set = (country: "DE" | "ES", id: string) => act(() => api("PUT", `/admin/insurers/${insurerId}/methods`, { ...(cur.data ?? { DE: null, ES: null }), [country]: id || null }), setErr, cur.reload);
  return (
    <div className="row" style={{ marginTop: 6 }}>
      {(["DE", "ES"] as const).map((c) => (
        <div key={c} style={{ minWidth: 200 }}>
          <label style={{ margin: 0 }}>{c === "DE" ? t("v6MethodDE") : t("v6MethodES")}</label>
          <select value={cur.data?.[c] ?? ""} onChange={(e) => void set(c, e.target.value)}>
            <option value="">{t("v6MethodStandard")}</option>
            {methods.filter((m) => m.country === c && !m.archived).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      ))}
      <Err msg={cur.err || err} />
    </div>
  );
}

export function InsurersPage({ canMethods = false }: { canMethods?: boolean }) {
  const methods = useLoad<{ id: string; name: string; country: string; archived: boolean; isSystem: boolean }[]>(canMethods ? "/admin/methods" : "");
  const list = useLoad<Insurer[]>("/admin/insurers");
  const [q, setQ] = useState("");
  const sites = useLoad<Station[]>("/admin/stations");
  const [f, setF] = useState<{ id?: string; name: string; emails: string; send: boolean; which: string; azure: string } | null>(null);
  const azIns = useLoad<{ id: string; name: string }[]>("/admin/azure/insurances");
  const [err, setErr] = useState("");
  const carros = (sites.data ?? []).filter((s) => s.type === "carrosserie" && s.active);
  const toggleLink = (insurerId: string, stationId: string, on: boolean) => {
    // the API replaces the whole list of a carrosserie: rebuild it from what we know
    const ids = (list.data ?? []).filter((i) => i.stationIds.includes(stationId) && i.id !== insurerId).map((i) => i.id);
    if (on) ids.push(insurerId);
    void act(() => api("PUT", `/admin/stations/${stationId}/insurers`, { insurer_ids: ids }), setErr, list.reload);
  };
  return (
    <>
      <Card title={t("insurers")} actions={<button className="btn" onClick={() => setF({ name: "", emails: "", send: false, which: "both", azure: "" })}>{t("newInsurer")}</button>}>
        <Err msg={list.err || err} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("v6SearchInsurers")} aria-label={t("v6SearchInsurers")} style={{ marginBottom: 10 }} />
        {(list.data ?? []).filter((i) => matches(q, [i.name, ...i.reportEmails])).map((i) => (
          <div key={i.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
            <div className="row">
              <b className="grow">{i.name}</b>
              {i.sendReports ? <span className="pill">{t("getsReports")}: {t(("rep." + i.reportsToSend) as never)}</span> : <span className="pill off">{t("noReports")}</span>}
              <button className="btn sec" onClick={() => setF({ id: i.id, name: i.name, emails: i.reportEmails.join(", "), send: i.sendReports, which: i.reportsToSend, azure: (i as unknown as { azureInsuranceId?: string | null }).azureInsuranceId ?? "" })}>{t("edit")}</button>
              <button className="btn danger" onClick={() => { if (window.confirm(`${t("delete")}: ${i.name}?`)) void act(() => api("DELETE", `/admin/insurers/${i.id}`), setErr, list.reload); }}>{t("delete")}</button>
            </div>
            <div style={{ color: "var(--sub)", fontSize: 13, marginTop: 4 }}>{i.reportEmails.join(", ") || "—"}</div>
            {canMethods && methods.data && <InsurerMethods insurerId={i.id} methods={methods.data} />}
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{t("worksWith")}: <b>{i.stationIds.filter((id) => carros.some((s) => s.id === id)).length}</b> / {carros.length} · {t("v6WorksWithHint")}</div>
          </div>
        ))}
        {!list.data?.length && <p className="muted">{t("noData")}</p>}
      </Card>
      {f && (
        <Card title={f.id ? f.name : t("newInsurer")}>
          <label>{t("azureInsurance")}</label>
          <select value={f.azure} onChange={(e) => { const a = azIns.data?.find((x) => x.id === e.target.value); setF({ ...f, azure: e.target.value, name: a && !f.name ? a.name : f.name }); }}>
            <option value="">— {t("notLinked")} —</option>{(azIns.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {f.azure && <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("azureNameMaster")}</div>}
          <label>{t("name")}</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <label>{t("reportEmails")}</label><input value={f.emails} onChange={(e) => setF({ ...f, emails: e.target.value })} />
          <label>{t("worksWith")}</label>
          {f.id
            ? <SearchSelect options={carros.map((s) => ({ id: s.id, name: s.name }))} selected={list.data?.find((x) => x.id === f.id)?.stationIds ?? []} placeholder={t("v6SearchStations")} onToggle={(sid, on) => toggleLink(f.id!, sid, on)} />
            : <div className="muted" style={{ fontSize: 13 }}>{t("v6SaveFirstInsurer")}</div>}
          <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}><input type="checkbox" style={{ width: 22, height: 22, minHeight: 0 }} checked={f.send} onChange={(e) => setF({ ...f, send: e.target.checked })} />{t("getsReports")}</label>
          {f.send && <><label>{t("whichReports")}</label>
            <select value={f.which} onChange={(e) => setF({ ...f, which: e.target.value })}>{["kva", "reparation", "both"].map((w) => <option key={w} value={w}>{t(("rep." + w) as never)}</option>)}</select></>}
          <Err msg={err} />
          <p className="row">
            <button className="btn" onClick={() => {
              const body = { name: f.name, report_emails: emails(f.emails), send_reports: f.send, reports_to_send: f.which, azure_insurance_id: f.azure || null };
              void act(() => (f.id ? api("PUT", `/admin/insurers/${f.id}`, body) : api("POST", "/admin/insurers", body)), setErr, () => { setF(null); void list.reload(); });
            }}>{t("save")}</button>
            <button className="btn sec" onClick={() => setF(null)}>{t("cancel")}</button>
          </p>
        </Card>
      )}
    </>
  );
}
