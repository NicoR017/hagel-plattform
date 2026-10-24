import { StationScanners } from "./v3/ColibriDevices";
import { isPlace } from "./field/places";
import { Occ } from "./field/occupancy";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LANG_LIST, getLang } from "./i18n";
import { PERMISSIONS, ROLE_REPAIR_STEPS, SCOPES, SYSTEM_ROLES, type Lang } from "@hagel/shared";
import { api, getOrg } from "./api";
import { fmtDateTime, t, tOr, type Key } from "./i18n";
import { confirmDialog } from "./field/ui";

const scopeLabel = (s: string) => t(("scope" + s.charAt(0).toUpperCase() + s.slice(1)) as Key);
/** Default roles are shown translated; a role an admin renamed or created keeps its own name. */
const isDefaultName = (key: string | null | undefined, name: string) => !!key && SYSTEM_ROLES.find((r) => r.key === key)?.name === name;
const roleLabel = (key: string | null | undefined, name: string) => (isDefaultName(key, name) ? tOr("r." + key, name) : name);
const roleDesc = (key: string | null | undefined, name: string, desc: string) => (isDefaultName(key, name) ? tOr("rd." + key, desc) : desc);

export function useLoad<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const reload = useCallback(async () => {
    if (!path) { setData(null); return; } // "" = nothing to load (no right to see it, or not known yet)
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
interface Station { id: string; type: string; name: string; capacite: number; present?: number; country: string; azureTenant: string | null; active: boolean; commissionPct: string; reportEmails: string[]; excludedInsurerEmails?: string[]; repairsPerDay?: number; address: string }
interface RoleLite { id: string; name: string; key: string | null; scope: string }

export function UsersPage({ canManage }: { canManage: boolean }) {
  const users = useLoad<UserRow[]>("/admin/users");
  const invs = useLoad<{ id: string; email: string; roleId: string; stationId: string | null; expiresAt: string }[]>("/admin/invitations");
  const roles = useLoad<RoleLite[]>("/admin/roles-lite");
  const sites = useLoad<Station[]>("/admin/stations");
  const [err, setErr] = useState("");
  const [editU, setEditU] = useState<{ id: string; name: string; language: string } | null>(null);
  const [form, setForm] = useState({ email: "", role_id: "", station_id: "", client: "", expires: "", language: getLang() as Lang, kind: "pdr" });
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
          {role?.key === "technicien" && (
            <div className="grow"><label>{t("v6TechKind")}</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="pdr">{t("v6TechPdr")}</option><option value="headliner">{t("v6TechHeadliner")}</option>
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
            scope_client_station_id: form.client || null, language: form.language, ...(role?.key === "technicien" ? { technician_kind: form.kind } : {}), expires_at: form.expires ? new Date(form.expires + "T23:59:59Z").toISOString() : null,
          }), setErr, () => { setForm({ email: "", role_id: "", station_id: "", client: "", expires: "", language: getLang(), kind: "pdr" }); reload(); })}>{t("invite")}</button></p>
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

      {editU && (
        <Card title={t("v6EditUser")}>
          <label>{t("name")}</label><input value={editU.name} onChange={(e) => setEditU({ ...editU, name: e.target.value })} />
          <label>{t("invitationLanguage")}</label>
          <select value={editU.language} onChange={(e) => setEditU({ ...editU, language: e.target.value })}>{LANG_LIST.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select>
          <Err msg={err} />
          <p className="row"><button className="btn" disabled={!editU.name.trim()} onClick={() => act(() => api("PUT", `/admin/users/${editU.id}`, { name: editU.name.trim(), language: editU.language }), setErr, () => { setEditU(null); reload(); })}>{t("save")}</button>
            <button className="btn sec" onClick={() => setEditU(null)}>{t("cancel")}</button></p>
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
              <td><span className={"pill" + (u.status === "active" ? "" : " off")}>{u.status === "active" ? t("active") : u.status === "invited" ? t("v6Invited") : t("inactive")}</span></td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="btn sec" onClick={() => setEditU({ id: u.id, name: u.name, language: (u as unknown as { language?: string }).language ?? getLang() })}>{t("v6Edit")}</button>{" "}
                {!u.isSuperadmin && (u.status === "active"
                  ? <button className="btn danger" onClick={() => act(() => api("POST", `/admin/users/${u.id}/deactivate`), setErr, reload)}>{t("deactivate")}</button>
                  : <button className="btn sec" onClick={() => act(() => api("POST", `/admin/users/${u.id}/reactivate`), setErr, reload)}>{t("reactivate")}</button>)}{" "}
                <button className="btn sec" onClick={() => act(() => api("POST", `/admin/users/${u.id}/revoke-sessions`), setErr)}>{t("signOutEverywhere")}</button>{" "}
                {!u.isSuperadmin && <button className="btn danger" onClick={() => { if (confirmDialog(t("v6DeleteUserQ"))) void act(() => api("DELETE", `/admin/users/${u.id}`), setErr, reload); }}>{t("v6DeleteUser")}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </>
  );
}

// ---------------- Roles ----------------
/** the permission checklist, grouped like the maquette; anything not listed (a future permission) lands in the last group */
const GROUPS_DEF: { title: Key; keys: string[] }[] = [
  { title: "v6PermGroupVehicles", keys: ["vehicules.voir", "vehicules.creer", "vehicules.modifier", "vehicules.supprimer", "vehicules.assigner", "vehicules.deplacer", "vehicules.changer_statut", "kommentare.schreiben"] },
  { title: "v6PermGroupRepair", keys: ["reparatur.board", "reparatur.endabnahme", "termine.buchen"] },
  { title: "v6PermGroupMoney", keys: ["prix.voir", "repartition_interne.voir", "ma_part.voir", "ma_commission.voir", "commission.modifier", "methoden.gerer", "wochenbericht.voir"] },
  { title: "v6PermGroupDocs", keys: ["kva.envoyer", "rapport_reparation.envoyer", "photos.ajouter", "photos.supprimer", "export.excel"] },
  { title: "v6PermGroupDash", keys: ["colibri.importer", "dashboard.voir"] },
  { title: "v6PermGroupAdmin", keys: ["assurances.gerer", "stations.gerer", "parametres.gerer", "utilisateurs.gerer", "roles.gerer", "audit.voir"] },
];
const PERM_GROUPS = (() => {
  const known = new Set(GROUPS_DEF.flatMap((g) => g.keys));
  const rest = PERMISSIONS.filter((p) => !known.has(p));
  return GROUPS_DEF.map((g, i) => ({ title: g.title, keys: (i === GROUPS_DEF.length - 1 ? [...g.keys, ...rest] : g.keys).filter((k) => (PERMISSIONS as readonly string[]).includes(k)) }));
})();
interface RoleRow { id: string; key: string | null; name: string; description: string; scope: string; permissions: string[]; repairSteps?: string[]; isSystem: boolean }

export function RolesPage() {
  const roles = useLoad<RoleRow[]>("/admin/roles");
  const [edit, setEdit] = useState<(Partial<RoleRow> & { name: string; scope: string; permissions: string[] }) | null>(null);
  const steps = edit?.repairSteps ?? [];
  const [err, setErr] = useState("");
  const [del, setDel] = useState<{ role: RoleRow; replacement: string; members: number } | null>(null);
  const startDelete = async (r: RoleRow) => {
    try {
      const users = await api<{ assignments: { roleId: string }[] }[]>("GET", "/admin/users");
      const members = users.reduce((n, u) => n + u.assignments.filter((a) => a.roleId === r.id).length, 0);
      if (!members && !confirmDialog(t("v6DeleteRoleQ"))) return;
      if (!members) { await act(() => api("DELETE", `/admin/roles/${r.id}`), setErr, roles.reload); return; }
      setDel({ role: r, replacement: "", members });
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <>
      <Card title={t("roles")} actions={<button className="btn" onClick={() => setEdit({ name: "", description: "", scope: "station", permissions: [] })}>{t("newRole")}</button>}>
        <Err msg={roles.err || err} />
        <table><tbody>{roles.data?.map((r) => (
          <tr key={r.id}>
            <td><b>{roleLabel(r.key, r.name)}</b>{r.isSystem && <span className="pill">{t("system")}</span>}<div style={{ color: "var(--sub)", fontSize: 13 }}>{roleDesc(r.key, r.name, r.description)}</div></td>
            <td>{scopeLabel(r.scope)}</td><td>{r.permissions.length} / {PERMISSIONS.length}</td>
            <td style={{ whiteSpace: "nowrap" }}><button className="btn sec" onClick={() => setEdit({ ...r })}>{t("permissions")}</button>{" "}
              <button className="btn danger" onClick={() => void startDelete(r)}>{t("v6DeleteRole")}</button></td>
          </tr>
        ))}</tbody></table>
      </Card>
      {del && (
        <Card title={`${t("v6DeleteRole")}: ${roleLabel(del.role.key, del.role.name)}`}>
          <p className="muted" style={{ marginTop: 0 }}>{t("v6DeleteRoleUsed")} ({del.members} {t("v6RoleMembers")})</p>
          <label>{t("v6Replacement")}</label>
          <select value={del.replacement} onChange={(e) => setDel({ ...del, replacement: e.target.value })}>
            <option value="">—</option>
            {(roles.data ?? []).filter((x) => x.id !== del.role.id && x.scope === del.role.scope).map((x) => <option key={x.id} value={x.id}>{roleLabel(x.key, x.name)}</option>)}
          </select>
          <Err msg={err} />
          <p className="row"><button className="btn danger" disabled={!del.replacement} onClick={() => act(() => api("DELETE", `/admin/roles/${del.role.id}`, { replacement_role_id: del.replacement }), setErr, () => { setDel(null); void roles.reload(); })}>{t("v6DeleteRoleGo")}</button>
            <button className="btn sec" onClick={() => setDel(null)}>{t("cancel")}</button></p>
        </Card>
      )}
      {edit && (
        <Card title={edit.id ? roleLabel(edit.key, edit.name) : t("newRole")}>
          <label>{t("name")}</label><input value={isDefaultName(edit.key, edit.name) ? roleLabel(edit.key, edit.name) : edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value, key: edit.key })} />
          <label>{t("description")}</label><input value={isDefaultName(edit.key, edit.name) ? roleDesc(edit.key, edit.name, edit.description ?? "") : edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          <label>{t("scope")}</label>
          <select value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value })}>{SCOPES.filter((s) => s !== "campagne" || edit.scope === "campagne").map((s) => <option key={s} value={s}>{scopeLabel(s)}</option>)}</select>
          <label>{t("permissions")}</label>
          {PERM_GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 8 }}>
              <h4 style={{ margin: "10px 0 4px" }}>{t(g.title)}</h4>
              <div className="grid">{g.keys.map((p) => (
                <label key={p}><input type="checkbox" checked={edit.permissions.includes(p)}
                  onChange={(e) => setEdit({ ...edit, permissions: e.target.checked ? [...edit.permissions, p] : edit.permissions.filter((x) => x !== p) })} />
                  <span>{tOr("p." + p, p)}<small style={{ display: "block", color: "var(--sub)" }}>{p}</small></span></label>
              ))}</div>
            </div>
          ))}
          <h4 style={{ margin: "14px 0 4px" }}>{t("rsTitle")}</h4>
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>{t("rsHint")}</div>
          <div className="grid">{ROLE_REPAIR_STEPS.map((s) => (
            <label key={s}><input type="checkbox" checked={steps.includes(s)}
              onChange={(e) => setEdit({ ...edit, repairSteps: e.target.checked ? [...steps, s] : steps.filter((x) => x !== s) })} />
              <span>{t(("rs_" + s) as never)}<small style={{ display: "block", color: "var(--sub)" }}>{t(("rsMove_" + s) as never)}</small></span></label>
          ))}</div>
          <Err msg={err} />
          <p className="row">
            <button className="btn" onClick={() => act(() => edit.id
              ? api("PUT", `/admin/roles/${edit.id}`, { name: edit.name, description: edit.description ?? "", scope: edit.scope, permissions: edit.permissions, repair_steps: steps })
              : api("POST", "/admin/roles", { name: edit.name, description: edit.description ?? "", scope: edit.scope, permissions: edit.permissions, repair_steps: steps }),
            setErr, () => { setEdit(null); void roles.reload(); })}>{t("save")}</button>
            <button className="btn sec" onClick={() => setEdit(null)}>{t("cancel")}</button>
          </p>
        </Card>
      )}
    </>
  );
}

// ---------------- Sites ----------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/** search: every word typed must appear (case and accents ignored) in one of the fields */
export const matches = (q: string, fields: (string | null | undefined)[]): boolean => {
  const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hay = norm(fields.filter(Boolean).join(" "));
  return norm(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

const emptySite = { type: "hall", name: "", address: "", country: "ES", capacite: 0, azure_tenant: "", commission_pct: 0, report_emails: [] as string[], excluded: [] as string[], rpd: 3, bcs: [] as string[], links: [] as string[], bcFilter: "", aliases: "", citas: "" };

export function SitesPage({ canManage, canInsurers = true }: { canManage: boolean; canInsurers?: boolean }) {
  const sites = useLoad<Station[]>("/admin/stations");
  const tenants = useLoad<string[]>("/admin/tenants");
  const citasLocs = useLoad<{ id: string; name: string; active: boolean }[]>(canManage ? "/citas/locations" : "");
  const azBc = useLoad<{ id: string; name: string; links?: { id: string; name: string }[] }[]>(canManage ? "/admin/azure/business-customers" : "");
  const [f, setF] = useState<(typeof emptySite & { id?: string }) | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | "hall" | "parc">("all");
  const [err, setErr] = useState("");
  const typeLabel = (x: string) => t(x as Key);
  return (
    <>
      <Card title={t("sites")} actions={canManage && <button className="btn" onClick={() => setF({ ...emptySite })}>{t("newSite")}</button>}>
        <Err msg={sites.err} />
        <div className="chips" role="tablist" aria-label={t("type")} style={{ marginBottom: 8 }}>
          {([["all", t("v6CatAll")], ["hall", t("v6GroupHall")], ["parc", t("v6GroupParc")]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={cat === k} className={"chip" + (cat === k ? " on" : "")} onClick={() => setCat(k)}>
              {label} ({(sites.data ?? []).filter((s) => isPlace(s) && (k === "all" || s.type === k)).length})
            </button>
          ))}
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("v6SearchStations")} aria-label={t("v6SearchStations")} style={{ marginBottom: 10 }} />
        <table>
          <thead><tr><th>{t("name")}</th><th>{t("type")}</th><th>{t("capacity")}</th><th>{t("country")}</th><th>{t("tenant")}</th><th /></tr></thead>
          <tbody>{(sites.data ?? []).filter((s) => isPlace(s) && (cat === "all" || s.type === cat) && matches(q, [s.name, s.address, s.azureTenant, typeLabel(s.type), s.country, ...(s.reportEmails ?? [])])).map((s) => (
            <tr key={s.id}>
              <td>{s.name}{!s.active && <span className="pill off">{t("inactive")}</span>}</td><td>{typeLabel(s.type)}</td><td><Occ present={s.present ?? 0} capacity={s.capacite} /></td><td>{s.country}</td><td>{s.azureTenant ?? "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>{canManage && <>
                <button className="btn sec" onClick={() => setF({ id: s.id, type: s.type, name: s.name, address: s.address, country: s.country, capacite: s.capacite, azure_tenant: s.azureTenant ?? "", commission_pct: Number(s.commissionPct), report_emails: s.reportEmails, excluded: s.excludedInsurerEmails ?? [], rpd: s.repairsPerDay ?? 3, bcs: (s as unknown as { azureBcIds?: string[] }).azureBcIds ?? [], bcFilter: "", links: (s as unknown as { azureLinkIds?: string[] }).azureLinkIds ?? [], aliases: ((s as unknown as { azureLocationAliases?: string[] }).azureLocationAliases ?? []).join(", "), citas: (s as unknown as { citasLocationId?: string | null }).citasLocationId ?? "" })}>{t("edit")}</button>{" "}
                <button className="btn danger" onClick={() => act(() => api("POST", `/admin/stations/${s.id}/active`, { active: !s.active }), setErr, sites.reload)}>{s.active ? t("deactivate") : t("reactivate")}</button>{" "}
                <button className="btn danger" onClick={() => { if (confirmDialog(`${t("v6DeleteStationQ")}

${s.name}`)) void act(() => api("DELETE", `/admin/stations/${s.id}`), setErr, () => { setF(null); void sites.reload(); }); }}>{t("v6DeleteStation")}</button></>}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      {f && (
        <Card title={f.id ? f.name : t("newSite")}>
          <div className="row">
            <div className="grow"><label>{t("type")}</label><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {["hall", "parc"].map((x) => <option key={x} value={x}>{typeLabel(x)}</option>)}</select></div>
            <div className="grow"><label>{t("name")}</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><label>{t("capacity")}</label><input type="number" min={0} value={f.capacite} onChange={(e) => setF({ ...f, capacite: Number(e.target.value) })} /></div>
            <div><label>{t("country")}</label><select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option>DE</option><option>ES</option></select></div>
          </div>
          <label>{t("address")}</label><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          <label>{t("tenant")}</label>
          {tenants.data?.length
            ? <select value={f.azure_tenant} onChange={(e) => setF({ ...f, azure_tenant: e.target.value })}><option value="">—</option>{tenants.data.map((x) => <option key={x}>{x}</option>)}</select>
            : <input value={f.azure_tenant} onChange={(e) => setF({ ...f, azure_tenant: e.target.value })} placeholder={t("tenantHint")} />}
          <label>{t("v6RepairsPerDay")}</label><input type="number" min={0} max={50} value={f.rpd} onChange={(e) => setF({ ...f, rpd: Number(e.target.value) })} />
          {f.id && <StationScanners stationId={f.id} />}
          {canManage && (!!citasLocs.data?.length || !!f.citas) && <>
            <label>{t("ciLocation")}</label>
            <select value={f.citas} onChange={(e) => setF({ ...f, citas: e.target.value })}>
              <option value="">{t("ciNoLocation")}</option>
              {(citasLocs.data ?? []).filter((l) => l.active || l.id === f.citas).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              {!!f.citas && !(citasLocs.data ?? []).some((l) => l.id === f.citas) && <option value={f.citas}>{f.citas}</option>}
            </select>
            <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("ciLocationHint")}</div>
          </>}
          <Err msg={err} />
          <p className="row"><button className="btn" onClick={() => {
            const body = { type: f.type, name: f.name, address: f.address, country: f.country, capacite: f.capacite, azure_tenant: f.azure_tenant || null,
              repairs_per_day: f.rpd, ...(canManage ? { citas_location_id: f.citas || null } : {}) };
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
