import { useState } from "react";
import { api } from "../../api";
import { act, Card, Err, useLoad } from "./shared";
import { t } from "../../shared/i18n";
import { confirmDialog } from "../../shared/ui";

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
              <td><button className="btn sec" onClick={() => setF({ id: x.id, name: x.name, userId: x.userId ?? "", pdr: Number(x.defaultPctPdr), dem: Number(x.defaultPctDemontage), kind: x.kind ?? "pdr", email: x.email ?? "", active: x.active })}>{t("edit")}</button>{" "}
                <button className="btn danger" onClick={() => { if (confirmDialog(t("rsDeleteTechQ").replace("{name}", x.name))) void act(() => api("DELETE", `/admin/technicians/${x.id}`), setErr, () => void list.reload()); }}>{t("delete")}</button></td>
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
