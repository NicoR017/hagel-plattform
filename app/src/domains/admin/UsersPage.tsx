import { useState } from "react";
import { LANG_LIST, getLang } from "../../shared/i18n";
import type { Lang } from "@hagel/shared";
import { api } from "../../api";
import { fmtDateTime, t } from "../../shared/i18n";
import { confirmDialog } from "../../shared/ui";
import { act, Card, Err, useLoad } from "./shared";
import { roleLabel } from "./roleLabels";

interface UserRow { id: string; email: string; name: string; status: string; isSuperadmin: boolean; replyMode?: string | null; assignments: { id: string; stationId: string | null; roleId: string; roleName: string; roleKey: string | null; scope: string; expiresAt: string | null }[] }
interface Station { id: string; type: string; name: string; capacite: number; present?: number; country: string; azureTenant: string | null; active: boolean; commissionPct: string; reportEmails: string[]; excludedInsurerEmails?: string[]; repairsPerDay?: number; address: string }
interface RoleLite { id: string; name: string; key: string | null; scope: string }

/** role + place of each assignment of a user (edit in place) and a row to add one; the place is never a body shop */
type AssignDraft = Record<string, { role: string; station: string }>;
type AssignAdd = { role: string; station: string; client: string };
const EMPTY_ADD: AssignAdd = { role: "", station: "", client: "" };
/** the changes of the edit form are only kept in the draft: the Save button of the form writes them all */
function AssignmentsEditor({ user, roles, places, bodyShops, setErr, reload, draft, setDraft, add, setAdd }: {
  user?: UserRow; roles: RoleLite[]; places: Station[]; bodyShops: Station[]; setErr: (m: string) => void; reload: () => void;
  draft: AssignDraft; setDraft: (d: AssignDraft) => void; add: AssignAdd; setAdd: (a: AssignAdd) => void;
}) {
  if (!user) return null;
  const addRole = roles.find((r) => r.id === add.role);
  const cur = (a: UserRow["assignments"][number]) => draft[a.id] ?? { role: a.roleId, station: a.stationId ?? "" };
  const placeOpts = (selected: string) => (
    <>
      <option value="">{t("allSites")}</option>
      {places.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      {selected && !places.some((s) => s.id === selected) && <option value={selected}>?</option>}
    </>
  );
  return (
    <div style={{ marginBottom: 12 }}>
      {user.assignments.map((a) => {
        const d = cur(a);
        return (
          <div className="row" key={a.id} style={{ alignItems: "flex-end", marginBottom: 6 }}>
            <div className="grow"><label>{t("role")}</label>
              <select value={d.role} onChange={(e) => setDraft({ ...draft, [a.id]: { ...d, role: e.target.value } })}>
                {roles.map((r) => <option key={r.id} value={r.id}>{roleLabel(r.key, r.name)}</option>)}
              </select></div>
            <div className="grow"><label>{t("site")}</label>
              <select value={d.station} onChange={(e) => setDraft({ ...draft, [a.id]: { ...d, station: e.target.value } })}>{placeOpts(d.station)}</select></div>
            <button className="btn danger" onClick={() => act(() => api("DELETE", `/admin/assignments/${a.id}`), setErr, reload)}>{t("delete")}</button>
          </div>
        );
      })}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="grow"><label>{t("uaAddRole")}</label>
          <select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>
            <option value="">—</option>{roles.map((r) => <option key={r.id} value={r.id}>{roleLabel(r.key, r.name)}</option>)}
          </select></div>
        <div className="grow"><label>{t("site")}</label>
          <select value={add.station} onChange={(e) => setAdd({ ...add, station: e.target.value })}>{placeOpts("")}</select></div>
        {addRole?.scope === "client" && (
          <div className="grow"><label>{t("clientStation")}</label>
            <select value={add.client} onChange={(e) => setAdd({ ...add, client: e.target.value })}>
              <option value="">—</option>{bodyShops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
        )}
      </div>
    </div>
  );
}

export function UsersPage({ canManage }: { canManage: boolean }) {
  const users = useLoad<UserRow[]>("/admin/users");
  const invs = useLoad<{ id: string; email: string; roleId: string; stationId: string | null; expiresAt: string }[]>("/admin/invitations");
  const roles = useLoad<RoleLite[]>("/admin/roles-lite");
  const sites = useLoad<Station[]>("/admin/stations");
  const [err, setErr] = useState("");
  const [editU, setEditU] = useState<{ id: string; name: string; language: string; replyMode: string } | null>(null);
  const [draft, setDraft] = useState<AssignDraft>({});
  const [addA, setAddA] = useState<AssignAdd>(EMPTY_ADD);
  const openEdit = (u: { id: string; name: string; language: string; replyMode: string }) => { setDraft({}); setAddA(EMPTY_ADD); setErr(""); setEditU(u); };
  /** one Save for the whole form: name + language, then every changed role/place, then the added role */
  const saveEdit = async (u: { id: string; name: string; language: string; replyMode: string }) => {
    try {
      await api("PUT", `/admin/users/${u.id}`, { name: u.name.trim(), language: u.language, reply_mode: u.replyMode === "contact" || u.replyMode === "own" ? u.replyMode : null });
      const row = users.data?.find((x) => x.id === u.id);
      for (const a of row?.assignments ?? []) {
        const d = draft[a.id];
        if (d && (d.role !== a.roleId || d.station !== (a.stationId ?? ""))) await api("PUT", `/admin/assignments/${a.id}`, { role_id: d.role, station_id: d.station || null });
      }
      if (addA.role) await api("POST", "/admin/assignments", { user_id: u.id, role_id: addA.role, station_id: addA.station || null, scope_client_station_id: addA.client || null });
      setErr(""); setEditU(null); setDraft({}); setAddA(EMPTY_ADD); reload();
    } catch (e) { setErr((e as Error).message); reload(); }
  };
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
              <option value="">{t("allSites")}</option>{sites.data?.filter((s) => s.type !== "carrosserie").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
          <label>{t("rcUser")}</label>
          <select value={editU.replyMode} onChange={(e) => setEditU({ ...editU, replyMode: e.target.value })}>
            <option value="">{t("rcFollowRole")}</option><option value="contact">{t("rcContact")}</option><option value="own">{t("rcOwn")}</option>
          </select>
          <div className="muted" style={{ fontSize: 12, margin: "2px 0 10px" }}>{t("rcUserHint")}</div>
          <h4 style={{ marginBottom: 4 }}>{t("uaAccess")}</h4>
          <p className="muted" style={{ marginTop: 0 }}>{t("uaPlaceHint")}</p>
          <AssignmentsEditor user={users.data?.find((x) => x.id === editU.id)} roles={roles.data ?? []} places={(sites.data ?? []).filter((s) => s.type !== "carrosserie")}
            bodyShops={(sites.data ?? []).filter((s) => s.type === "carrosserie")} setErr={setErr} reload={reload} draft={draft} setDraft={setDraft} add={addA} setAdd={setAddA} />
          <Err msg={err} />
          <p className="row"><button className="btn" disabled={!editU.name.trim()} onClick={() => void saveEdit(editU)}>{t("save")}</button>
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
                <button className="btn sec" onClick={() => openEdit({ id: u.id, name: u.name, language: (u as unknown as { language?: string }).language ?? getLang(), replyMode: u.replyMode ?? "" })}>{t("v6Edit")}</button>{" "}
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
