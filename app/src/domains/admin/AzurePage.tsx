import { useEffect, useState } from "react";
import { api } from "../../api";
import { act, Card, Err, useLoad } from "./shared";
import { fmtDateTime, t, tOr } from "../../shared/i18n";

interface Station { id: string; type: string; name: string; active: boolean }
interface AzStatus {
  configured: boolean; sasExpiresAt?: string | null; tenants: string[]; scansMirrored: number; waiting: { importable: number; blocked: number };
  lastRuns: { at: string; finishedAt: string | null; ok: boolean | null; error: string | null; stats: Record<string, number> | null }[];
  unmappedCustomers: { name: string; tenant: string; scans: number }[]; scannersWithoutStation: { tenant: string; number: string; scans: number }[];
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
      {!!d?.scannersWithoutStation?.length && (
        <Card title={t("v8ScannersNoStation")} actions={<a className="btn sec" href="#/admin/scanners">{t("v8OpenScanners")}</a>}>
          <p className="muted" style={{ marginTop: 0 }}>{t("v8ScannersNoStationHint")}</p>
          {d.scannersWithoutStation.map((u) => (
            <div key={u.tenant + u.number} className="row" style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
              <div className="grow"><b>{u.number || "—"}</b><div style={{ fontSize: 12, color: "var(--sub)" }}>{u.tenant} · {u.scans} {t("scansWord")}</div></div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
