import { useEffect, useState } from "react";
import { api, httpFetch } from "./api";
import { act, Card, Err, matches, useLoad } from "./admin";
import { fmtDateTime, t, tOr } from "./i18n";

interface Station { id: string; type: string; name: string; active: boolean }
interface Insurer { id: string; name: string; reportEmails: string[]; sendReports: boolean; reportsToSend: string; stationIds: string[] }

const emails = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Searchable multi-select: the chosen ones as chips, a search field that opens a short scrolling list of the others. For long lists
 * (an insurer works with many body shops): nothing but the chosen ones is on screen until you search.
 */
function SearchSelect({ options, selected, placeholder, onToggle }: { options: { id: string; name: string }[]; selected: string[]; placeholder: string; onToggle: (id: string, on: boolean) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const chosen = options.filter((o) => selected.includes(o.id));
  const found = options.filter((o) => !selected.includes(o.id) && matches(q, [o.name])).slice(0, 60);
  return (
    <div style={{ position: "relative" }}>
      <div className="chips">
        {chosen.map((o) => <span key={o.id} className="pill">{o.name} <button type="button" aria-label={t("delete")} onClick={() => onToggle(o.id, false)}>✕</button></span>)}
        {!chosen.length && <span className="muted" style={{ fontSize: 13 }}>—</span>}
      </div>
      <input type="search" value={q} placeholder={placeholder} aria-label={placeholder} role="combobox" aria-expanded={open}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && (
        <div role="listbox" style={{ position: "absolute", left: 0, right: 0, zIndex: 20, maxHeight: 240, overflowY: "auto", background: "#fff", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "0 8px 24px rgba(10,18,35,.15)", marginTop: 2 }}>
          {found.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => { onToggle(o.id, true); setQ(""); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", minHeight: 44, border: 0, borderBottom: "1px solid #EEF1F5", background: "#fff", font: "inherit", cursor: "pointer" }}>{o.name}</button>
          ))}
          {!found.length && <div className="muted" style={{ padding: 12, fontSize: 13 }}>{q ? t("noData") : "—"}</div>}
        </div>
      )}
    </div>
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

// ---------------------------------------------------------------- campaigns
interface Campaign { id: string; name: string; country: string; start: string | null; end: string | null; stationIds: string[] }
export function CampaignsPage() {
  const list = useLoad<Campaign[]>("/admin/campaigns");
  const sites = useLoad<Station[]>("/admin/stations");
  const [f, setF] = useState<{ id?: string; name: string; country: string; start: string; end: string; stationIds: string[] } | null>(null);
  const [err, setErr] = useState("");
  return (
    <>
      <Card title={t("campaigns")} actions={<button className="btn" onClick={() => setF({ name: "", country: "ES", start: "", end: "", stationIds: [] })}>{t("newCampaign")}</button>}>
        <Err msg={list.err || err} />
        <table><tbody>{(list.data ?? []).map((cp) => (
          <tr key={cp.id}>
            <td><b>{cp.name}</b><div style={{ color: "var(--sub)", fontSize: 13 }}>{cp.country} · {cp.start ?? "…"} → {cp.end ?? "…"}</div></td>
            <td>{cp.stationIds.map((id) => <span key={id} className="pill">{sites.data?.find((s) => s.id === id)?.name ?? "?"}</span>)}</td>
            <td style={{ whiteSpace: "nowrap" }}>
              <button className="btn sec" onClick={() => setF({ id: cp.id, name: cp.name, country: cp.country, start: cp.start ?? "", end: cp.end ?? "", stationIds: cp.stationIds })}>{t("edit")}</button>{" "}
              <button className="btn danger" onClick={() => { if (window.confirm(`${t("delete")}: ${cp.name}?`)) void act(() => api("DELETE", `/admin/campaigns/${cp.id}`), setErr, list.reload); }}>{t("delete")}</button>
            </td>
          </tr>
        ))}</tbody></table>
        {!list.data?.length && <p className="muted">{t("noData")}</p>}
      </Card>
      {f && (
        <Card title={f.id ? f.name : t("newCampaign")}>
          <label>{t("name")}</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Talavera Allianz Okt 2026" />
          <div className="row">
            <div className="grow"><label>{t("country")}</label><select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option>DE</option><option>ES</option></select></div>
            <div className="grow"><label>{t("from")}</label><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
            <div className="grow"><label>{t("to")}</label><input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
          </div>
          <label>{t("sites")}</label>
          <div className="grid">{(sites.data ?? []).filter((s) => s.active).map((s) => (
            <label key={s.id}><input type="checkbox" checked={f.stationIds.includes(s.id)} onChange={(e) => setF({ ...f, stationIds: e.target.checked ? [...f.stationIds, s.id] : f.stationIds.filter((x) => x !== s.id) })} />{s.name}</label>
          ))}</div>
          <Err msg={err} />
          <p className="row">
            <button className="btn" onClick={() => {
              const body = { name: f.name, country: f.country, start: f.start || null, end: f.end || null, station_ids: f.stationIds };
              void act(() => (f.id ? api("PUT", `/admin/campaigns/${f.id}`, body) : api("POST", "/admin/campaigns", body)), setErr, () => { setF(null); void list.reload(); });
            }}>{t("save")}</button>
            <button className="btn sec" onClick={() => setF(null)}>{t("cancel")}</button>
          </p>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- letterheads
interface Company { id: string; name: string; address: string; taxId: string; email: string; footer: string; logoKey: string | null; active: boolean }

function LogoPreview({ id, version }: { id: string; version: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null, live = true;
    if (!version) { setUrl(null); return; }
    httpFetch("GET", `/admin/companies/${id}/logo`, undefined, { blob: true }).then((r) => { if (live && r.blob) { u = URL.createObjectURL(r.blob); setUrl(u); } }).catch(() => undefined);
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [id, version]);
  return url ? <img src={url} alt="logo" style={{ maxHeight: 60, maxWidth: 200, display: "block", background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: 4 }} /> : <span className="muted">{t("noLogo")}</span>;
}

export function CompaniesPage() {
  const list = useLoad<Company[]>("/admin/companies");
  const [f, setF] = useState<{ id?: string; name: string; address: string; taxId: string; email: string; footer: string; active: boolean } | null>(null);
  const [err, setErr] = useState("");
  const upload = async (id: string, file: File) => {
    const r = await httpFetch("PUT", `/admin/companies/${id}/logo`, undefined, { raw: file, contentType: file.type });
    if (r.status !== 200) setErr(String(r.data?.error ?? r.status)); else { setErr(""); await list.reload(); }
  };
  return (
    <>
      <Card title={t("letterheads")} actions={<button className="btn" onClick={() => setF({ name: "", address: "", taxId: "", email: "", footer: "", active: true })}>{t("newLetterhead")}</button>}>
        <p className="muted" style={{ marginTop: 0 }}>{t("letterheadAdminHint")}</p>
        <Err msg={list.err || err} />
        {(list.data ?? []).map((co) => (
          <div key={co.id} className="row" style={{ borderTop: "1px solid var(--line)", padding: "10px 0", alignItems: "flex-start" }}>
            <div className="grow">
              <b>{co.name}</b>{!co.active && <span className="pill off">{t("inactive")}</span>}
              <div style={{ color: "var(--sub)", fontSize: 13, whiteSpace: "pre-line" }}>{[co.address, co.taxId, co.email].filter(Boolean).join("\n")}</div>
            </div>
            <div style={{ minWidth: 160 }}><LogoPreview id={co.id} version={co.logoKey} /></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="btn sec" style={{ display: "inline-flex", alignItems: "center", cursor: "pointer", margin: 0 }}>{t("uploadLogo")}
                <input type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) void upload(co.id, fl); }} /></label>
              {co.logoKey && <button className="btn danger" onClick={() => void act(() => api("DELETE", `/admin/companies/${co.id}/logo`), setErr, list.reload)}>{t("removeLogo")}</button>}
              <button className="btn sec" onClick={() => setF({ id: co.id, name: co.name, address: co.address, taxId: co.taxId, email: co.email, footer: co.footer, active: co.active })}>{t("edit")}</button>
            </div>
          </div>
        ))}
      </Card>
      {f && (
        <Card title={f.id ? f.name : t("newLetterhead")}>
          <label>{t("name")}</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <label>{t("address")}</label><textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          <div className="row">
            <div className="grow"><label>{t("taxId")}</label><input value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} /></div>
            <div className="grow"><label>{t("email")}</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          </div>
          <label>{t("footerText")}</label><textarea rows={2} value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} />
          <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}><input type="checkbox" style={{ width: 22, height: 22, minHeight: 0 }} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t("active")}</label>
          <Err msg={err} />
          <p className="row">
            <button className="btn" onClick={() => {
              const body = { name: f.name, address: f.address, tax_id: f.taxId, email: f.email, footer: f.footer, active: f.active };
              void act(() => (f.id ? api("PUT", `/admin/companies/${f.id}`, body) : api("POST", "/admin/companies", body)), setErr, () => { setF(null); void list.reload(); });
            }}>{t("save")}</button>
            <button className="btn sec" onClick={() => setF(null)}>{t("cancel")}</button>
          </p>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- technicians
interface Tech { id: string; name: string; userId: string | null; defaultPctPdr: string; defaultPctDemontage: string; kind?: string; email?: string | null; active: boolean }
interface UserLite { id: string; name: string; email: string }
export function TechniciansPage({ canUsers }: { canUsers: boolean }) {
  const list = useLoad<Tech[]>("/admin/technicians");
  const users = useLoad<UserLite[]>(canUsers ? "/admin/users" : "");
  const [f, setF] = useState<{ id?: string; name: string; userId: string; pdr: number; dem: number; kind: string; email: string; active: boolean } | null>(null);
  const [err, setErr] = useState("");
  return (
    <>
      <Card title={t("technicians")} actions={<button className="btn" onClick={() => setF({ name: "", userId: "", pdr: 50, dem: 100, kind: "pdr", email: "", active: true })}>{t("newTechnician")}</button>}>
        <p className="muted" style={{ marginTop: 0 }}>{t("technicianAdminHint")}</p>
        <Err msg={list.err || err} />
        <table>
          <thead><tr><th>{t("name")}</th><th>{t("v6TechKind")}</th><th>{t("pctPdr")}</th><th>{t("pctDem")}</th><th>{t("account")}</th><th>{t("email")}</th><th /></tr></thead>
          <tbody>{(list.data ?? []).map((x) => (
            <tr key={x.id}>
              <td>{x.name}{!x.active && <span className="pill off">{t("inactive")}</span>}</td><td>{x.kind === "headliner" ? t("v6TechHeadliner") : t("v6TechPdr")}</td><td>{Number(x.defaultPctPdr)} %</td><td>{Number(x.defaultPctDemontage)} %</td>
              <td>{x.userId ? users.data?.find((u) => u.id === x.userId)?.email ?? t("v6TechAccount") : t("v6TechNoAccount")}</td>
              <td>{x.email ?? "—"}</td>
              <td><button className="btn sec" onClick={() => setF({ id: x.id, name: x.name, userId: x.userId ?? "", pdr: Number(x.defaultPctPdr), dem: Number(x.defaultPctDemontage), kind: x.kind ?? "pdr", email: x.email ?? "", active: x.active })}>{t("edit")}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      {f && (
        <Card title={f.id ? f.name : t("newTechnician")}>
          <label>{t("name")}</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <label>{t("v6TechKind")}</label>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="pdr">{t("v6TechPdr")}</option><option value="headliner">{t("v6TechHeadliner")}</option></select>
          <label>{t("v6TechEmail")}</label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          {canUsers && <><label>{t("account")}</label>
            <select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">{t("external")}</option>{(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select></>}
          <div className="row">
            <div className="grow"><label>{t("pctPdr")}</label><input type="number" min={0} max={100} value={f.pdr} onChange={(e) => setF({ ...f, pdr: Number(e.target.value) })} /></div>
            <div className="grow"><label>{t("pctDem")}</label><input type="number" min={0} max={100} value={f.dem} onChange={(e) => setF({ ...f, dem: Number(e.target.value) })} /></div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}><input type="checkbox" style={{ width: 22, height: 22, minHeight: 0 }} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t("active")}</label>
          <Err msg={err} />
          <p className="row">
            <button className="btn" onClick={() => {
              const body = { name: f.name, user_id: f.userId || null, default_pct_pdr: f.pdr, default_pct_demontage: f.dem, kind: f.kind, email: f.email.trim() || null, active: f.active };
              void act(() => (f.id ? api("PUT", `/admin/technicians/${f.id}`, body) : api("POST", "/admin/technicians", body)), setErr, () => { setF(null); void list.reload(); });
            }}>{t("save")}</button>
            <button className="btn sec" onClick={() => setF(null)}>{t("cancel")}</button>
          </p>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Azure / Colibri
interface AzStatus {
  configured: boolean; sasExpiresAt?: string | null; tenants: string[]; scansMirrored: number; waiting: { importable: number; blocked: number };
  lastRuns: { at: string; finishedAt: string | null; ok: boolean | null; error: string | null; stats: Record<string, number> | null }[];
  unmappedCustomers: { name: string; tenant: string; scans: number }[]; unmappedLocations: { location: string; tenant: string; scans: number }[];
}
/** Connection to PDR Citas (appointments): status, and a button that tests it (health, then locations). */
function CitasCard() {
  const [st, setSt] = useState<{ configured: boolean; ok: boolean; locations?: number; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const test = async () => {
    setBusy(true); setErr("");
    try { setSt(await api("GET", "/citas/status")); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  useEffect(() => { void test(); }, []);
  return (
    <Card title={t("ciAdminTitle")} actions={<button className="btn" disabled={busy || st?.configured === false} onClick={() => void test()}>{t("ciTest")}</button>}>
      <Err msg={err} />
      {st && (!st.configured ? <p className="muted">{t("ciNotConfigured")}</p>
        : st.ok ? <p><span className="ok">✓ {t("ciConnected").replace("{n}", String(st.locations ?? 0))}</span></p>
        : <p><span className="err">{t("ciFailed")}: {tOr("ciErr_" + (st.error ?? "unreachable"), t("ciErr_unreachable"))}</span></p>)}
    </Card>
  );
}

export function AzurePage() {
  const st = useLoad<AzStatus>("/admin/azure/status");
  const sites = useLoad<(Station & { azureTenant: string | null; type: string })[]>("/admin/stations");
  const [err, setErr] = useState("");
  const [pick, setPick] = useState<Record<string, string>>({});
  const carros = (sites.data ?? []).filter((x) => x.type === "carrosserie" && x.active);
  const halls = (sites.data ?? []).filter((x) => x.type !== "carrosserie" && x.active);
  const d = st.data;
  return (
    <>
      <Card title={t("azureTitle")} actions={<button className="btn" disabled={!d?.configured} onClick={() => void act(() => api("POST", "/admin/azure/sync"), setErr, () => { void st.reload(); })}>{t("syncNow")}</button>}>
        <Err msg={st.err || err} />
        {d && (
          <>
            <p>{d.configured ? <span className="ok">✓ {t("azureConfigured")}</span> : <span className="err">{t("azureNotConfigured")}</span>}</p>
            {d.configured && d.sasExpiresAt && (() => {
              const days = Math.floor((new Date(d.sasExpiresAt).getTime() - Date.now()) / 86_400_000);
              const text = `${t("sasExpires")}: ${fmtDateTime(d.sasExpiresAt)}`;
              return days < 0 ? <p className="err">⚠ {t("sasExpired")} ({text})</p> : days < 14 ? <p style={{ color: "var(--brick)" }}>⚠ {text} ({days} {t("daysShort")})</p> : <p className="muted">{text}</p>;
            })()}
            <p style={{ margin: "4px 0" }}>{t("tenant")}: {d.tenants.length ? d.tenants.map((x) => <span key={x} className="pill">{x}</span>) : <span className="muted">{t("noTenants")}</span>}</p>
            <p style={{ margin: "4px 0" }}>{d.scansMirrored} {t("scansMirrored")} · {d.waiting.importable} {t("scansImportable")} · {d.waiting.blocked} {t("scansBlocked")}</p>
            <table>
              <thead><tr><th>{t("time")}</th><th>{t("status")}</th><th>{t("azureStats")}</th></tr></thead>
              <tbody>{d.lastRuns.map((r, i) => (
                <tr key={i}><td>{fmtDateTime(r.at)}</td><td>{r.ok === null ? "…" : r.ok ? <span className="ok">OK</span> : <span className="err">{r.error}</span>}</td>
                  <td style={{ fontSize: 12 }}>{r.stats ? `${r.stats.scansSeen} / +${r.stats.scansNew}` : ""}</td></tr>
              ))}</tbody>
            </table>
          </>
        )}
      </Card>
      <CitasCard />
      {!!d?.unmappedCustomers.length && (
        <Card title={t("unmappedCustomers")}>
          <p className="muted" style={{ marginTop: 0 }}>{t("unmappedCustomersHint")}</p>
          {d.unmappedCustomers.map((u) => {
            const k = `${u.tenant}|${u.name}`;
            return (
              <div key={k} className="row" style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
                <div className="grow"><b>{u.name}</b><div style={{ fontSize: 12, color: "var(--sub)" }}>{u.tenant} · {u.scans} {t("scansWord")}</div></div>
                <select style={{ maxWidth: 220 }} value={pick[k] ?? ""} onChange={(e) => setPick({ ...pick, [k]: e.target.value })}>
                  <option value="">{t("createNewSite")}</option>{carros.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <button className="btn" onClick={() => void act(() => api("POST", "/admin/azure/map-customer", { link_name: u.name, tenant: u.tenant, station_id: pick[k] || null }), setErr, () => { void st.reload(); void sites.reload(); })}>{pick[k] ? t("linkSite") : t("createSite")}</button>
              </div>
            );
          })}
        </Card>
      )}
      {!!d?.unmappedLocations.length && (
        <Card title={t("unmappedLocations")}>
          <p className="muted" style={{ marginTop: 0 }}>{t("unmappedLocationsHint")}</p>
          {d.unmappedLocations.map((u) => {
            const k = `L|${u.tenant}|${u.location}`;
            const ok = halls.filter((h) => h.azureTenant === u.tenant);
            return (
              <div key={k} className="row" style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
                <div className="grow"><b>{u.location}</b><div style={{ fontSize: 12, color: "var(--sub)" }}>{u.tenant} · {u.scans} {t("scansWord")}</div></div>
                <select style={{ maxWidth: 220 }} value={pick[k] ?? ""} onChange={(e) => setPick({ ...pick, [k]: e.target.value })}>
                  <option value="">—</option>{ok.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <button className="btn" disabled={!pick[k]} onClick={() => void act(() => api("POST", "/admin/azure/map-location", { location: u.location, tenant: u.tenant, station_id: pick[k] }), setErr, () => void st.reload())}>{t("mapLocation")}</button>
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}
