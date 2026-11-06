import { useState } from "react";
import { PERMISSIONS, ROLE_REPAIR_STEPS, SCOPES } from "@hagel/shared";
import { api } from "../../api";
import { t, tOr, type Key } from "../../shared/i18n";
import { confirmDialog } from "../../shared/ui";
import { act, Card, Err, useLoad } from "./shared";
import { isDefaultName, roleDesc, roleLabel, scopeLabel } from "./roleLabels";

/** the permission checklist, grouped like the maquette; anything not listed (a future permission) lands in the last group */
const GROUPS_DEF: { title: Key; keys: string[] }[] = [
  { title: "v6PermGroupVehicles", keys: ["vehicules.voir", "vehicules.creer", "vehicules.modifier", "vehicules.supprimer", "vehicules.assigner", "vehicules.deplacer", "vehicules.changer_statut", "kommentare.schreiben"] },
  { title: "v6PermGroupRepair", keys: ["reparatur.board", "reparatur.endabnahme", "termine.buchen"] },
  { title: "v6PermGroupMoney", keys: ["prix.voir", "repartition_interne.voir", "ma_part.voir", "ma_part_pct.voir", "ma_commission.voir", "commission.modifier", "methoden.gerer", "wochenbericht.voir"] },
  { title: "v6PermGroupDocs", keys: ["kva.envoyer", "rapport_reparation.envoyer", "photos.ajouter", "photos.supprimer", "export.excel"] },
  { title: "v6PermGroupDash", keys: ["colibri.importer", "dashboard.voir"] },
  { title: "v6PermGroupReports", keys: ["rapports.voir", "rapports.envoyer", "rapports.gerer"] },
  { title: "v6PermGroupParts", keys: ["pieces.voir", "pieces.commander", "pieces.reception", "pieces.installer", "pieces.prix.voir", "pieces.catalogue", "peinture.gerer", "documents.importer", "dossier.envoyer", "facturation.voir", "facturation.gerer"] },
  { title: "v6PermGroupAdmin", keys: ["assurances.gerer", "stations.gerer", "parametres.gerer", "utilisateurs.gerer", "roles.gerer", "audit.voir"] },
];
const PERM_GROUPS = (() => {
  const known = new Set(GROUPS_DEF.flatMap((g) => g.keys));
  const rest = PERMISSIONS.filter((p) => !known.has(p));
  return GROUPS_DEF.map((g, i) => ({ title: g.title, keys: (i === GROUPS_DEF.length - 1 ? [...g.keys, ...rest] : g.keys).filter((k) => (PERMISSIONS as readonly string[]).includes(k)) }));
})();
interface RoleRow { id: string; key: string | null; name: string; description: string; scope: string; permissions: string[]; repairSteps?: string[]; replyFromContact?: boolean; isSystem: boolean }

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
          <h4 style={{ margin: "14px 0 4px" }}>{t("rcTitle")}</h4>
          <label><input type="checkbox" checked={!!edit.replyFromContact} onChange={(e) => setEdit({ ...edit, replyFromContact: e.target.checked })} />
            <span>{t("rcRole")}<small style={{ display: "block", color: "var(--sub)" }}>{t("rcRoleHint")}</small></span></label>
          <Err msg={err} />
          <p className="row">
            <button className="btn" onClick={() => act(() => edit.id
              ? api("PUT", `/admin/roles/${edit.id}`, { name: edit.name, description: edit.description ?? "", scope: edit.scope, permissions: edit.permissions, repair_steps: steps, reply_from_contact: !!edit.replyFromContact })
              : api("POST", "/admin/roles", { name: edit.name, description: edit.description ?? "", scope: edit.scope, permissions: edit.permissions, repair_steps: steps, reply_from_contact: !!edit.replyFromContact }),
            setErr, () => { setEdit(null); void roles.reload(); })}>{t("save")}</button>
            <button className="btn sec" onClick={() => setEdit(null)}>{t("cancel")}</button>
          </p>
        </Card>
      )}
    </>
  );
}
