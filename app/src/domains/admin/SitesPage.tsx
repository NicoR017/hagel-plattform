import { StationScanners } from "../scans/ColibriDevices";
import { isPlace } from "../../shared/places";
import { Occ } from "../../shared/occupancy";
import { useState } from "react";
import { api } from "../../api";
import { t, type Key } from "../../shared/i18n";
import { confirmDialog } from "../../shared/ui";
import { act, Card, Err, matches, useLoad } from "./shared";

interface Station { id: string; type: string; name: string; capacite: number; present?: number; country: string; azureTenant: string | null; active: boolean; commissionPct: string; reportEmails: string[]; excludedInsurerEmails?: string[]; repairsPerDay?: number; address: string }

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
