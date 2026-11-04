import { useEffect, useState } from "react";
import { api, getOrg } from "../../api";
import { t } from "../../shared/i18n";
import { act, Card, Err, useLoad } from "./shared";

export function OrgsPage() {
  const orgs = useLoad<{ id: string; name: string; country: string; contactEmail?: string | null }[]>("/admin/orgs");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("DE");
  const [tenants, setTenants] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  useEffect(() => { setContacts(Object.fromEntries((orgs.data ?? []).map((o) => [o.id, o.contactEmail ?? ""]))); }, [orgs.data]);
  useEffect(() => {
    orgs.data?.forEach((o) => api<string[]>("GET", `/admin/orgs/${o.id}/tenants`).then((tt) => setTenants((p) => ({ ...p, [o.id]: tt.join(", ") }))).catch(() => undefined));
  }, [orgs.data]);
  return (
    <>
      <Card title={t("orgs")}>
        <Err msg={orgs.err || err} />
        <table><tbody>{orgs.data?.map((o) => (
          <tr key={o.id}><td><b>{o.name}</b> ({o.country}){getOrg() === o.id && <span className="pill">{t("current")}</span>}</td>
            <td style={{ minWidth: 260 }}><label>{t("tenantsComma")}</label>
              <input value={tenants[o.id] ?? ""} onChange={(e) => setTenants({ ...tenants, [o.id]: e.target.value })} /></td>
            <td style={{ minWidth: 260 }}><label>{t("rcOrgContact")}</label>
              <input type="email" placeholder="contact-spain@pdr-team.com" value={contacts[o.id] ?? ""} onChange={(e) => setContacts({ ...contacts, [o.id]: e.target.value })} /></td>
            <td><button className="btn sec" onClick={() => act(async () => {
              await api("PUT", `/admin/orgs/${o.id}/tenants`, { tenants: (tenants[o.id] ?? "").split(",").map((x) => x.trim()).filter(Boolean) });
              await api("PUT", `/admin/orgs/${o.id}/contact`, { contact_email: (contacts[o.id] ?? "").trim() || null });
            }, setErr, () => void orgs.reload())}>{t("save")}</button></td></tr>
        ))}</tbody></table>
      </Card>
      <Card title={t("org")}>
        <div className="row"><div className="grow"><label>{t("name")}</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label>{t("country")}</label><select value={country} onChange={(e) => setCountry(e.target.value)}><option>DE</option><option>ES</option></select></div></div>
        <p><button className="btn" disabled={!name.trim()} onClick={() => act(() => api("POST", "/admin/orgs", { name, country }), setErr, () => { setName(""); void orgs.reload(); })}>{t("save")}</button></p>
      </Card>
    </>
  );
}
