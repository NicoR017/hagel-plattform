import { useState } from "react";
import { api } from "../api";
import { act, Card, Err, matches, Modal, Recipients, useLoad } from "../admin";
import { confirmDialog } from "../field/ui";
import { t } from "../i18n";

interface BodyShop {
  id: string; name: string; address: string; country: string; azureTenant: string | null; active: boolean;
  commissionPct: string; reportEmails: string[]; excludedInsurerEmails: string[]; contactName: string | null; contactPhone: string | null; cif: string | null;
  azureBcIds: string[]; azureLinkIds: string[]; openVehicles: number; totalVehicles: number; insurerIds: string[]; accounts: { email: string; name: string }[];
}
interface Form {
  id?: string; name: string; address: string; country: string; azure_tenant: string; contact_name: string; contact_phone: string; cif: string; commission_pct: number;
  report_emails: string[]; excluded: string[]; bcs: string[]; links: string[]; bcFilter: string; accounts: { email: string; name: string }[];
}
const empty: Form = { name: "", address: "", country: "ES", azure_tenant: "", contact_name: "", contact_phone: "", cif: "", commission_pct: 0, report_emails: [], excluded: [], bcs: [], links: [], bcFilter: "", accounts: [] };

/** S39: Administration → Body shops. A body shop is a CUSTOMER (it sends us cars and gets the reports); it is never a place where a car stands. */
export function BodyShopsPage({ canManage = true, canInsurers = true }: { canManage?: boolean; canInsurers?: boolean }) {
  const list = useLoad<BodyShop[]>("/admin/bodyshops");
  const tenants = useLoad<string[]>("/admin/tenants");
  const insurers = useLoad<{ id: string; name: string }[]>(canInsurers ? "/admin/insurers" : "");
  const azBc = useLoad<{ id: string; name: string; links?: { id: string; name: string }[] }[]>(canManage ? "/admin/azure/business-customers" : "");
  const [f, setF] = useState<Form | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const names = (b: BodyShop) => (azBc.data ?? []).filter((x) => b.azureBcIds.includes(x.id) || (x.links ?? []).some((l) => b.azureLinkIds.includes(l.id))).map((x) => x.name);
  const insNames = (b: BodyShop) => (insurers.data ?? []).filter((i) => b.insurerIds.includes(i.id)).map((i) => i.name);
  const edit = (b: BodyShop) => setF({
    id: b.id, name: b.name, address: b.address, country: b.country, azure_tenant: b.azureTenant ?? "", contact_name: b.contactName ?? "", contact_phone: b.contactPhone ?? "", cif: b.cif ?? "",
    commission_pct: Number(b.commissionPct), report_emails: b.reportEmails, excluded: b.excludedInsurerEmails, bcs: b.azureBcIds, links: b.azureLinkIds, bcFilter: "", accounts: b.accounts,
  });
  const rows = (list.data ?? []).filter((b) => matches(q, [b.name, b.cif, b.address, b.azureTenant, b.country, ...names(b), ...insNames(b)]));

  return (
    <>
      <Card title={t("v8BodyShops")} actions={canManage && <button className="btn" onClick={() => setF({ ...empty })}>{t("v8NewBodyShop")}</button>}>
        <p className="muted" style={{ marginTop: 0 }}>{t("v8BodyShopsHint")}</p>
        <Err msg={list.err} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("v8SearchBodyShops")} aria-label={t("v8SearchBodyShops")} style={{ marginBottom: 10 }} />
        <table>
          <thead><tr><th>{t("name")}</th><th>{t("v8Cif")}</th><th>{t("address")}</th><th>{t("country")} · {t("tenant")}</th><th>{t("commission")}</th><th>{t("insurers")}</th><th>{t("v8Vehicles")}</th><th /></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.id}>
              <td>{b.name}{!b.active && <span className="pill off">{t("inactive")}</span>}</td>
              <td>{b.cif || "—"}</td>
              <td>{b.address || "—"}</td>
              <td>{b.country}{b.azureTenant ? ` · ${b.azureTenant}` : ""}</td>
              <td>{Number(b.commissionPct)} %</td>
              <td>{insNames(b).join(", ") || "—"}</td>
              <td>{b.openVehicles} / {b.totalVehicles}</td>
              <td style={{ whiteSpace: "nowrap" }}>{canManage && <>
                <button className="btn sec" onClick={() => edit(b)}>{t("edit")}</button>{" "}
                <button className="btn danger" onClick={() => act(() => api("POST", `/admin/bodyshops/${b.id}/active`, { active: !b.active }), setErr, list.reload)}>{b.active ? t("deactivate") : t("reactivate")}</button>{" "}
                <button className="btn danger" onClick={() => { if (confirmDialog(`${t("v8DeleteBodyShopQ")}\n\n${b.name}`)) void act(() => api("DELETE", `/admin/bodyshops/${b.id}`), setErr, () => { setF(null); void list.reload(); }); }}>{t("delete")}</button></>}</td>
            </tr>
          ))}</tbody>
        </table>
        <Err msg={err} />
      </Card>
      {f && (
        <Modal title={f.id ? f.name : t("v8NewBodyShop")} onClose={() => { setF(null); setErr(""); }}>
          <div className="row">
            <div className="grow"><label>{t("name")}</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><label>{t("country")}</label><select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option>DE</option><option>ES</option></select></div>
            <div><label>{t("commission")}</label><input type="number" min={0} max={100} value={f.commission_pct} onChange={(e) => setF({ ...f, commission_pct: Number(e.target.value) })} /></div>
          </div>
          <label>{t("address")}</label><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          <label>{t("tenant")}</label>
          {tenants.data?.length
            ? <select value={f.azure_tenant} onChange={(e) => setF({ ...f, azure_tenant: e.target.value })}><option value="">—</option>{tenants.data.map((x) => <option key={x}>{x}</option>)}</select>
            : <input value={f.azure_tenant} onChange={(e) => setF({ ...f, azure_tenant: e.target.value })} placeholder={t("tenantHint")} />}
          <div className="row">
            <div className="grow"><label>{t("v8ContactName")}</label><input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></div>
            <div className="grow"><label>{t("v8ContactPhone")}</label><input type="tel" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></div>
            <div className="grow"><label>{t("v8Cif")}</label><input value={f.cif} maxLength={20} onChange={(e) => setF({ ...f, cif: e.target.value.toUpperCase() })} placeholder="B12345678" /></div>
          </div>
          {/* report recipients + the insurers this body shop works with (same component as before, now for body shops only) */}
          <Recipients stationId={f.id} emails={f.report_emails} excluded={f.excluded} canInsurers={canInsurers} onChange={(emails, excluded) => setF({ ...f, report_emails: emails, excluded })} />
          <label>{t("azureCustomer")}</label>
          {(() => {
            const all = (azBc.data ?? []).flatMap((b) => (b.links ?? []).map((l) => ({ id: l.id, name: l.name, bcId: b.id })));
            const qq = f.bcFilter.trim().toLowerCase();
            const picked = all.filter((l) => f.links.includes(l.id));
            const whole = (azBc.data ?? []).filter((b) => f.bcs.includes(b.id));
            const free = all.filter((l) => !f.links.includes(l.id) && !f.bcs.includes(l.bcId) && (!qq || l.name.toLowerCase().includes(qq)));
            return <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0" }}>
                {whole.map((b) => <span key={b.id} className="pill">{b.name} ({t("azureAll")}) <a href="#" onClick={(e) => { e.preventDefault(); setF({ ...f, bcs: f.bcs.filter((x) => x !== b.id) }); }}>✕</a></span>)}
                {picked.map((l) => <span key={l.id} className="pill">{l.name} <a href="#" onClick={(e) => { e.preventDefault(); setF({ ...f, links: f.links.filter((x) => x !== l.id) }); }}>✕</a></span>)}
                {!whole.length && !picked.length && <span style={{ fontSize: 12, color: "var(--sub)" }}>— {t("notLinked")} —</span>}
              </div>
              <input value={f.bcFilter} onChange={(e) => setF({ ...f, bcFilter: e.target.value })} placeholder={t("azureFilter")} />
              <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 6, marginTop: 4 }}>
                {free.slice(0, 200).map((l) => (
                  <label key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>
                    <input type="checkbox" style={{ width: "auto" }} checked={false} onChange={() => setF({ ...f, links: [...f.links, l.id] })} />{l.name}
                  </label>
                ))}
                {!free.length && <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("azureNoMore")}</span>}
              </div>
            </>;
          })()}
          <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("azureLinksHint")}</div>
          {f.id && <>
            <label>{t("v8ExternalAccounts")}</label>
            <div className="chips">{f.accounts.length ? f.accounts.map((a) => <span key={a.email} className="pill">{a.name || a.email} · {a.email}</span>) : <span className="muted">—</span>}</div>
            <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("v8ExternalAccountsHint")}</div>
          </>}
          <Err msg={err} />
          <p className="row modal-actions"><button className="btn" onClick={() => {
            const body = {
              name: f.name, address: f.address, country: f.country, azure_tenant: f.azure_tenant || null, contact_name: f.contact_name || null, contact_phone: f.contact_phone || null, cif: f.cif.trim() || null,
              commission_pct: f.commission_pct, report_emails: f.report_emails, excluded_insurer_emails: f.excluded, azure_business_customer_ids: f.bcs, azure_link_ids: f.links,
            };
            void act(() => (f.id ? api("PUT", `/admin/bodyshops/${f.id}`, body) : api("POST", "/admin/bodyshops", body)), setErr, () => { setF(null); void list.reload(); });
          }}>{t("save")}</button><button className="btn sec" onClick={() => setF(null)}>{t("cancel")}</button></p>
        </Modal>
      )}
    </>
  );
}
