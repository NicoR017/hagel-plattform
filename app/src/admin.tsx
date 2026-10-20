import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LANG_LIST, getLang } from "./i18n";
import { PERMISSIONS, SCOPES, SYSTEM_ROLES, type Lang } from "@hagel/shared";
import { api, getOrg } from "./api";
import { fmtDateTime, t, tOr, type Key } from "./i18n";

const scopeLabel = (s: string) => t(("scope" + s.charAt(0).toUpperCase() + s.slice(1)) as Key);
/** Default roles are shown translated; a role an admin renamed or created keeps its own name. */
const isDefaultName = (key: string | null | undefined, name: string) => !!key && SYSTEM_ROLES.find((r) => r.key === key)?.name === name;
const roleLabel = (key: string | null | undefined, name: string) => (isDefaultName(key, name) ? tOr("r." + key, name) : name);
const roleDesc = (key: string | null | undefined, name: string, desc: string) => (isDefaultName(key, name) ? tOr("rd." + key, desc) : desc);

export function useLoad<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const reload = useCallback(async () => {
    try { setData(await api<T>("GET", path)); setErr(""); } catch (e) { setErr((e as Error).message); }
  }, [path]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload, ...deps]);
  return { data, err, reload };
}

export function Err({ msg }: { msg: string }) { return msg ? <div className="err">{msg}</div> : null; }
export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return <div className="card">{(title || actions) && <div className="row"><h3 className="grow" style={{ margin: 0 }}>{title}</h3>{actions}</div>}{children}</div>;
}

export async function act(fn: () => Promise<unknown>, setErr: (m: string) => void, done?: () => void) {
  try { await fn(); setErr(""); done?.(); } catch (e) { setErr((e as Error).message); }
}

// ---------------- Users ----------------
interface UserRow { id: string; email: string; name: string; status: string; isSuperadmin: boolean; assignments: { id: string; stationId: string | null; roleId: string; roleName: string; roleKey: string | null; scope: string; expiresAt: string | null }[] }
interface Station { id: string; type: string; name: string; capacite: number; country: string; azureTenant: string | null; active: boolean; commissionPct: string; reportEmails: string[]; address: string }
interface RoleLite { id: string; name: string; key: string | null; scope: string }

export function UsersPage({ canManage }: { canManage: boolean }) {
  const users = useLoad<UserRow[]>("/admin/users");
  const invs = useLoad<{ id: string; email: string; roleId: string; stationId: string | null; expiresAt: string }[]>("/admin/invitations");
  const roles = useLoad<RoleLite[]>("/admin/roles-lite");
  const sites = useLoad<Station[]>("/admin/stations");
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ email: "", role_id: "", station_id: "", client: "", expires: "", language: getLang() as Lang });
  const role = roles.data?.find((r) => r.id === form.role_id);
  const reload = () => { void users.reload(); void invs.reload(); };
  const siteName = (id: string | null) => (id ? sites.data?.find((s) => s.id === id)?.name ?? "?" : t("allSites"));
  if (!canManage) return <p>{t("forbidden")}</p>;
  return (
    <>
      <Card title={t("invite")}>
        <div className="row">
          <div className="grow"><label>{t("email")}</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="grow"><label>{t("role")}</label>
            <select value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
              <option value="">—</option>{roles.data?.map((r) => <option key={r.id} value={r.id}>{roleLabel(r.key, r.name)}</option>)}
            </select></div>
          <div className="grow"><label>{t("site")}</label>
            <select value={form.station_id} onChange={(e) => setForm({ ...form, station_id: e.target.value })}>
              <option value="">{t("allSites")}</option>{sites.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          {role?.scope === "client" && (
            <div className="grow"><label>{t("clientStation")}</label>
              <select value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })}>
                <option value="">—</option>{sites.data?.filter((s) => s.type === "carrosserie").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
          )}
          <div><label>{t("expires")}</label><input type="date" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} /></div>
          <div><label>{t("invitationLanguage")}</label>
            <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Lang })}>{LANG_LIST.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></div>
        </div>
        <Err msg={err} />
        <p><button className="btn" disabled={!form.email || !form.role_id} onClick={() => act(
          () => api("POST", "/admin/invitations", {
            email: form.email, role_id: form.role_id, station_id: form.station_id || null,
            scope_client_station_id: form.client || null, language: form.language, expires_at: form.expires ? new Date(form.expires + "T23:59:59Z").toISOString() : null,
          }), setErr, () => { setForm({ email: "", role_id: "", station_id: "", client: "", expires: "", language: getLang() }); reload(); })}>{t("invite")}</button></p>
      </Card>

      {!!invs.data?.length && (
        <Card title={t("invitations")}>
          <table><tbody>{invs.data.map((i) => (
            <tr key={i.id}><td>{i.email}</td><td>{siteName(i.stationId)}</td><td>{fmtDateTime(i.expiresAt)}</td>
              <td><button className="btn sec" onClick={() => act(() => api("POST", `/admin/invitations/${i.id}/resend`), setErr)}>{t("resend")}</button>{" "}
                <button className="btn danger" onClick={() => act(() => api("DELETE", `/admin/invitations/${i.id}`), setErr, reload)}>{t("revoke")}</button></td></tr>
          ))}</tbody></table>
        </Card>
      )}

      <Card title={t("users")}>
        <Err msg={users.err} />
        <table>
          <thead><tr><th>{t("name")}</th><th>{t("email")}</th><th>{t("role")}</th><th>{t("status")}</th><th /></tr></thead>
          <tbody>{users.data?.map((u) => (
            <tr key={u.id}>
              <td>{u.name}{u.isSuperadmin && <span className="pill">{t("superAdmin")}</span>}</td>
              <td>{u.email}</td>
              <td>{u.assignments.map((a) => (
                <span key={a.id} className="pill">{roleLabel(a.roleKey, a.roleName)} · {siteName(a.stationId)}
                  <button aria-label={t("delete")} style={{ border: 0, background: "none", cursor: "pointer", marginLeft: 6 }}
                    onClick={() => act(() => api("DELETE", `/admin/assignments/${a.id}`), setErr, reload)}>✕</button></span>
              ))}</td>
              <td><span className={"pill" + (u.status === "active" ? "" : " off")}>{u.status === "active" ? t("active") : t("inactive")}</span></td>
              <td style={{ whiteSpace: "nowrap" }}>
                {!u.isSuperadmin && (u.status === "active"
                  ? <button className="btn danger" onClick={() => act(() => api("POST", `/admin/users/${u.id}/deactivate`), setErr, reload)}>{t("deactivate")}</button>
                  : <button className="btn sec" onClick={() => act(() => api("POST", `/admin/users/${u.id}/reactivate`), setErr, reload)}>{t("reactivate")}</button>)}{" "}
                <button className="btn sec" onClick={() => act(() => api("POST", `/admin/users/${u.id}/revoke-sessions`), setErr)}>{t("signOutEverywhere")}</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </>
  );
}

// ---------------- Roles ----------------
interface RoleRow { id: string; key: string | null; name: string; description: string; scope: string; permissions: string[]; isSystem: boolean }

export function RolesPage() {
  const roles = useLoad<RoleRow[]>("/admin/roles");
  const [edit, setEdit] = useState<(Partial<RoleRow> & { name: string; scope: string; permissions: string[] }) | null>(null);
  const [err, setErr] = useState("");
  return (
    <>
      <Card title={t("roles")} actions={<button className="btn" onClick={() => setEdit({ name: "", description: "", scope: "station", permissions: [] })}>{t("newRole")}</button>}>
        <Err msg={roles.err || err} />
        <table><tbody>{roles.data?.map((r) => (
          <tr key={r.id}>
            <td><b>{roleLabel(r.key, r.name)}</b>{r.isSystem && <span className="pill">{t("system")}</span>}<div style={{ color: "var(--sub)", fontSize: 13 }}>{roleDesc(r.key, r.name, r.description)}</div></td>
            <td>{scopeLabel(r.scope)}</td><td>{r.permissions.length} / {PERMISSIONS.length}</td>
            <td style={{ whiteSpace: "nowrap" }}><button className="btn sec" onClick={() => setEdit({ ...r })}>{t("permissions")}</button>{" "}
              {!r.isSystem && <button className="btn danger" onClick={() => act(() => api("DELETE", `/admin/roles/${r.id}`), setErr, roles.reload)}>{t("delete")}</button>}</td>
          </tr>
        ))}</tbody></table>
      </Card>
      {edit && (
        <Card title={edit.id ? roleLabel(edit.key, edit.name) : t("newRole")}>
          <label>{t("name")}</label><input value={isDefaultName(edit.key, edit.name) ? roleLabel(edit.key, edit.name) : edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value, key: edit.key })} />
          <label>{t("description")}</label><input value={isDefaultName(edit.key, edit.name) ? roleDesc(edit.key, edit.name, edit.description ?? "") : edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          <label>{t("scope")}</label>
          <select value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value })}>{SCOPES.map((s) => <option key={s} value={s}>{scopeLabel(s)}</option>)}</select>
          <label>{t("permissions")}</label>
          <div className="grid">{PERMISSIONS.map((p) => (
            <label key={p}><input type="checkbox" checked={edit.permissions.includes(p)}
              onChange={(e) => setEdit({ ...edit, permissions: e.target.checked ? [...edit.permissions, p] : edit.permissions.filter((x) => x !== p) })} />{tOr("p." + p, p)}</label>
          ))}</div>
          <Err msg={err} />
          <p className="row">
            <button className="btn" onClick={() => act(() => edit.id
              ? api("PUT", `/admin/roles/${edit.id}`, { name: edit.name, description: edit.description ?? "", scope: edit.scope, permissions: edit.permissions })
              : api("POST", "/admin/roles", { name: edit.name, description: edit.description ?? "", scope: edit.scope, permissions: edit.permissions }),
            setErr, () => { setEdit(null); void roles.reload(); })}>{t("save")}</button>
            <button className="btn sec" onClick={() => setEdit(null)}>{t("cancel")}</button>
          </p>
        </Card>
      )}
    </>
  );
}

// ---------------- Sites ----------------
const emptySite = { type: "carrosserie", name: "", address: "", country: "ES", capacite: 0, azure_tenant: "", commission_pct: 0, report_emails: "", azure_bc: "", links: [] as string[], aliases: "" };

export function SitesPage({ canManage }: { canManage: boolean }) {
  const sites = useLoad<Station[]>("/admin/stations");
  const tenants = useLoad<string[]>("/admin/tenants");
  const azBc = useLoad<{ id: string; name: string; links?: { id: string; name: string }[] }[]>(canManage ? "/admin/azure/business-customers" : "/me/none");
  const [f, setF] = useState<(typeof emptySite & { id?: string }) | null>(null);
  const [err, setErr] = useState("");
  const typeLabel = (x: string) => t(x as Key);
  return (
    <>
      <Card title={t("sites")} actions={canManage && <button className="btn" onClick={() => setF({ ...emptySite })}>{t("newSite")}</button>}>
        <Err msg={sites.err} />
        <table>
          <thead><tr><th>{t("name")}</th><th>{t("type")}</th><th>{t("capacity")}</th><th>{t("country")}</th><th>{t("tenant")}</th><th /></tr></thead>
          <tbody>{sites.data?.map((s) => (
            <tr key={s.id}>
              <td>{s.name}{!s.active && <span className="pill off">{t("inactive")}</span>}</td><td>{typeLabel(s.type)}</td><td>{s.capacite}</td><td>{s.country}</td><td>{s.azureTenant ?? "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>{canManage && <>
                <button className="btn sec" onClick={() => setF({ id: s.id, type: s.type, name: s.name, address: s.address, country: s.country, capacite: s.capacite, azure_tenant: s.azureTenant ?? "", commission_pct: Number(s.commissionPct), report_emails: s.reportEmails.join(", "), azure_bc: (s as unknown as { azureBusinessCustomerId?: string | null }).azureBusinessCustomerId ?? "", links: (s as unknown as { azureLinkIds?: string[] }).azureLinkIds ?? [], aliases: ((s as unknown as { azureLocationAliases?: string[] }).azureLocationAliases ?? []).join(", ") })}>{t("edit")}</button>{" "}
                <button className="btn danger" onClick={() => act(() => api("POST", `/admin/stations/${s.id}/active`, { active: !s.active }), setErr, sites.reload)}>{s.active ? t("deactivate") : t("reactivate")}</button></>}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      {f && (
        <Card title={f.id ? f.name : t("newSite")}>
          <div className="row">
            <div className="grow"><label>{t("type")}</label><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {["carrosserie", "hall", "parc"].map((x) => <option key={x} value={x}>{typeLabel(x)}</option>)}</select></div>
            <div className="grow"><label>{t("name")}</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><label>{t("capacity")}</label><input type="number" min={0} value={f.capacite} onChange={(e) => setF({ ...f, capacite: Number(e.target.value) })} /></div>
            <div><label>{t("country")}</label><select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option>DE</option><option>ES</option></select></div>
          </div>
          <label>{t("address")}</label><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          <label>{t("tenant")}</label>
          {tenants.data?.length
            ? <select value={f.azure_tenant} onChange={(e) => setF({ ...f, azure_tenant: e.target.value })}><option value="">—</option>{tenants.data.map((x) => <option key={x}>{x}</option>)}</select>
            : <input value={f.azure_tenant} onChange={(e) => setF({ ...f, azure_tenant: e.target.value })} placeholder={t("tenantHint")} />}
          {f.type === "carrosserie" && <>
            <label>{t("commission")}</label><input type="number" min={0} max={100} value={f.commission_pct} onChange={(e) => setF({ ...f, commission_pct: Number(e.target.value) })} />
            <label>{t("reportEmails")}</label><input value={f.report_emails} onChange={(e) => setF({ ...f, report_emails: e.target.value })} />
            <label>{t("azureCustomer")}</label>
            <select value={f.azure_bc} onChange={(e) => setF({ ...f, azure_bc: e.target.value })}>
              <option value="">— {t("notLinked")} —</option>{(azBc.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}{b.links?.length ? ` (${b.links.map((l) => l.name).join(", ")})` : ""}</option>)}
            </select>
            {f.azure_bc && <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("azureNameMaster")}</div>}
            {f.azure_bc && (azBc.data?.find((b) => b.id === f.azure_bc)?.links ?? []).length > 0 && <>
              <label>{t("azureLinksOnly")}</label>
              {azBc.data!.find((b) => b.id === f.azure_bc)!.links!.map((l) => (
                <label key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={f.links.includes(l.id)}
                    onChange={(e) => setF({ ...f, links: e.target.checked ? [...f.links, l.id] : f.links.filter((x) => x !== l.id) })} />{l.name}
                </label>
              ))}
              <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("azureLinksHint")}</div>
            </>}
          </>}
          {f.type !== "carrosserie" && <>
            <label>{t("locationAliases")}</label><input value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} />
            <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("locationAliasesHint")}</div>
          </>}
          <Err msg={err} />
          <p className="row"><button className="btn" onClick={() => {
            const body = { type: f.type, name: f.name, address: f.address, country: f.country, capacite: f.capacite, azure_tenant: f.azure_tenant || null,
              commission_pct: f.commission_pct, report_emails: f.report_emails.split(",").map((x) => x.trim()).filter(Boolean),
              azure_business_customer_id: f.type === "carrosserie" ? f.azure_bc || null : null, azure_link_ids: f.type === "carrosserie" && f.azure_bc ? f.links : [], azure_location_aliases: f.aliases.split(",").map((x) => x.trim()).filter(Boolean) };
            void act(() => (f.id ? api("PUT", `/admin/stations/${f.id}`, body) : api("POST", "/admin/stations", body)), setErr, () => { setF(null); void sites.reload(); });
          }}>{t("save")}</button><button className="btn sec" onClick={() => setF(null)}>{t("cancel")}</button></p>
        </Card>
      )}
    </>
  );
}

// ---------------- Audit ----------------
export function AuditPage() {
  const log = useLoad<{ id: string; at: string; action: string; entity: string; entityId: string | null; userId: string | null; before: unknown; after: unknown }[]>("/admin/audit?limit=200");
  return (
    <Card title={t("audit")}>
      <Err msg={log.err} />
      <table>
        <thead><tr><th>{t("time")}</th><th>{t("action")}</th><th>{t("object")}</th><th>{t("beforeAfter")}</th></tr></thead>
        <tbody>{log.data?.map((e) => (
          <tr key={e.id}><td>{fmtDateTime(e.at)}</td><td>{tOr("a." + e.action, e.action)}</td><td>{tOr("e." + e.entity, e.entity)}</td>
            <td style={{ fontSize: 12, wordBreak: "break-all" }}>{e.before ? JSON.stringify(e.before).slice(0, 160) : ""}{e.before && e.after ? " → " : ""}{e.after ? JSON.stringify(e.after).slice(0, 160) : ""}</td></tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

// ---------------- Organisations (super-admin) ----------------
export function OrgsPage() {
  const orgs = useLoad<{ id: string; name: string; country: string }[]>("/admin/orgs");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("DE");
  const [tenants, setTenants] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
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
            <td><button className="btn sec" onClick={() => act(() => api("PUT", `/admin/orgs/${o.id}/tenants`, { tenants: (tenants[o.id] ?? "").split(",").map((x) => x.trim()).filter(Boolean) }), setErr)}>{t("save")}</button></td></tr>
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
