import { useState } from "react";
import { api } from "../api";
import { act, Card, Err, matches, useLoad } from "../admin";
import { confirmDialog } from "../field/ui";
import { t } from "../i18n";

interface Hist { id: string; stationId: string; station: string; from: string; to: string | null; by: string }
interface Device {
  id: string; tenant: string; number: string; note: string; scans: number; waiting: number; waitingWithoutStation: number;
  station: { id: string; name: string; since: string } | null; upcoming: { id: string; name: string; from: string } | null; history: Hist[];
}
interface Data {
  today: string; canAdd: boolean; canDelete: boolean; myStationIds: "all" | string[]; devices: Device[];
  seen: { tenant: string; number: string; scans: number; lastScan: string | null }[]; tenants: string[];
  stations: { id: string; name: string; tenant: string | null }[];
}
const fmtDay = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "—");

/** S40: Administration → Colibri scanners. Which station each scanner stands in, from which date; the scans of a scanner belong to that station. */
export function ColibriDevicesPage() {
  const data = useLoad<Data>("/admin/colibri/devices");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);           // device whose assign form is open
  const [hist, setHist] = useState<string | null>(null);           // device whose history is open
  const [form, setForm] = useState({ station: "", from: "", note: "" });
  const [add, setAdd] = useState<{ number: string; tenant: string; station: string; from: string; note: string } | null>(null);
  const d = data.data;
  const reload = () => void data.reload();

  const rows = (d?.devices ?? []).filter((x) => matches(q, [x.number, x.tenant, x.note, x.station?.name]));
  const noStationTotal = (d?.devices ?? []).reduce((a, x) => a + x.waitingWithoutStation, 0);
  const stationsFor = (dev: Device) => (d?.stations ?? []).filter((s) => !s.tenant || !dev.tenant || s.tenant === dev.tenant);

  return (
    <>
      <Card title={t("v8Scanners")} actions={d?.canAdd && <button className="btn" onClick={() => setAdd({ number: "", tenant: d.tenants[0] ?? "", station: "", from: "", note: "" })}>{t("v8AddScanner")}</button>}>
        <p className="muted" style={{ marginTop: 0 }}>{t("v8ScannersHint")}</p>
        <Err msg={data.err || err} />
        {noStationTotal > 0 && <div className="warn" style={{ margin: "6px 0 10px" }}>⚠ {t("v8WaitingNoStation").replace("{n}", String(noStationTotal))}</div>}

        {!!d?.seen.length && (
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, marginBottom: 12 }}>
            <b>{t("v8SeenInScans")}</b>
            <p className="muted" style={{ margin: "2px 0 8px", fontSize: 12 }}>{t("v8SeenHint")}</p>
            {d.seen.map((s) => (
              <div key={s.tenant + s.number} className="row" style={{ borderTop: "1px solid var(--line)", padding: "6px 0", alignItems: "center" }}>
                <div className="grow"><b>{s.number}</b> <span className="muted" style={{ fontSize: 12 }}>{s.tenant} · {t("v8SeenRow").replace("{n}", String(s.scans)).replace("{date}", fmtDay(s.lastScan ? new Date(s.lastScan).toISOString().slice(0, 10) : null))}</span></div>
                <button className="btn sec" onClick={() => void act(() => api("POST", "/admin/colibri/devices", { tenant: s.tenant, number: s.number }), setErr, reload)}>{t("v8Add")}</button>
              </div>
            ))}
          </div>
        )}

        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("v8SearchScanners")} aria-label={t("v8SearchScanners")} style={{ marginBottom: 10 }} />
        <table>
          <thead><tr><th>{t("v8ScannerNumber")}</th><th>{t("tenant")}</th><th>{t("v8ScannerStation")}</th><th>{t("v8ScannerSince")}</th><th>{t("v8ScannerScans")}</th><th /></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.id}>
              <td><b>{x.number}</b>{x.note && <div className="muted" style={{ fontSize: 12 }}>{x.note}</div>}</td>
              <td>{x.tenant || "—"}</td>
              <td>{x.station ? x.station.name : <span style={{ color: "var(--brick)" }}>{x.upcoming ? `${t("v8From")} ${fmtDay(x.upcoming.from)}: ${x.upcoming.name}` : t("v8NoStation")}</span>}</td>
              <td>{x.station ? fmtDay(x.station.since) : "—"}</td>
              <td>{x.scans}{x.waitingWithoutStation > 0 && <div style={{ color: "var(--brick)", fontSize: 12 }}>⚠ {t("v8WaitingNoStation").replace("{n}", String(x.waitingWithoutStation))}</div>}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="btn sec" onClick={() => { setOpen(open === x.id ? null : x.id); setForm({ station: "", from: "", note: x.note }); }}>{x.station ? t("v8Move") : t("v8Assign")}</button>{" "}
                <button className="btn sec" onClick={() => setHist(hist === x.id ? null : x.id)}>{t("v8History")}</button>
                {d?.canDelete && <>{" "}<button className="btn danger" onClick={() => { if (confirmDialog(`${t("v8DeleteScannerQ")}\n\n${x.number}`)) void act(() => api("DELETE", `/admin/colibri/devices/${x.id}`), setErr, reload); }}>{t("delete")}</button></>}
              </td>
            </tr>
          ))}</tbody>
        </table>
        {d && !rows.length && <p className="muted">{t("v8ScannersEmpty")}</p>}
        {open && rows.find((x) => x.id === open) && (() => {
          const x = rows.find((y) => y.id === open)!;
          return (
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginTop: 12 }}>
              <b>{x.number}</b> · {x.station ? t("v8Move") : t("v8Assign")}
              <label>{t("v8ScannerStation")}</label>
              <select value={form.station} onChange={(e) => setForm({ ...form, station: e.target.value })}>
                <option value="">—</option>{stationsFor(x).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <label>{t("v8FromDate")}</label>
              <input type="date" value={form.from || d!.today} onChange={(e) => setForm({ ...form, from: e.target.value })} />
              {(form.from || d!.today) < d!.today && <div className="warn" style={{ marginTop: 4 }}>{t("v8PastDateHint")}</div>}
              <p className="row">
                <button className="btn" disabled={!form.station} onClick={() => void act(() => api("POST", `/admin/colibri/devices/${x.id}/assign`, { station_id: form.station, from: form.from || d!.today }), setErr, () => { setOpen(null); reload(); })}>{t("save")}</button>
                {x.station && <button className="btn danger" onClick={() => void act(() => api("POST", `/admin/colibri/devices/${x.id}/unassign`, { to: form.from ? form.from : d!.today }), setErr, () => { setOpen(null); reload(); })}>{t("v8Release")}</button>}
                <button className="btn sec" onClick={() => setOpen(null)}>{t("cancel")}</button>
              </p>
            </div>
          );
        })()}
        {hist && rows.find((x) => x.id === hist) && (() => {
          const x = rows.find((y) => y.id === hist)!;
          return (
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginTop: 12, fontSize: 13 }}>
              <b>{x.number}</b> · {t("v8History")}
              {x.history.length === 0 ? <div className="muted">—</div> : x.history.map((h) => (
                <div key={h.id}>{h.station} · {fmtDay(h.from)} → {h.to ? fmtDay(h.to) : t("v8Today")}{h.by ? <span className="muted"> · {h.by}</span> : null}</div>
              ))}
            </div>
          );
        })()}
      </Card>

      {add && d && (
        <Card title={t("v8AddScanner")}>
          <div className="row">
            <div className="grow"><label>{t("v8ScannerNumber")}</label><input value={add.number} onChange={(e) => setAdd({ ...add, number: e.target.value })} placeholder="COLIBRI-012" /></div>
            <div className="grow"><label>{t("tenant")}</label><select value={add.tenant} onChange={(e) => setAdd({ ...add, tenant: e.target.value })}>{d.tenants.map((x) => <option key={x}>{x}</option>)}</select></div>
          </div>
          <div className="row">
            <div className="grow"><label>{t("v8ScannerStation")}</label><select value={add.station} onChange={(e) => setAdd({ ...add, station: e.target.value })}><option value="">{t("v8NoStation")}</option>{d.stations.filter((s) => !s.tenant || s.tenant === add.tenant).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label>{t("v8FromDate")}</label><input type="date" value={add.from || d.today} onChange={(e) => setAdd({ ...add, from: e.target.value })} /></div>
          </div>
          <label>{t("v8Note")}</label><input value={add.note} onChange={(e) => setAdd({ ...add, note: e.target.value })} />
          <Err msg={err} />
          <p className="row">
            <button className="btn" disabled={!add.number.trim()} onClick={() => void act(() => api("POST", "/admin/colibri/devices", { tenant: add.tenant, number: add.number, note: add.note, station_id: add.station || null, from: add.station ? add.from || d.today : null }), setErr, () => { setAdd(null); reload(); })}>{t("save")}</button>
            <button className="btn sec" onClick={() => setAdd(null)}>{t("cancel")}</button>
          </p>
        </Card>
      )}
    </>
  );
}

/** S20: the scanners that stand in a station (read only: they are managed in "Colibri scanners"). */
export function StationScanners({ stationId }: { stationId: string }) {
  const data = useLoad<Data>("/admin/colibri/devices");
  const mine = (data.data?.devices ?? []).filter((x) => x.station?.id === stationId);
  if (!data.data) return null;
  return (
    <>
      <label>{t("v8StationScanners")}</label>
      <div className="chips">{mine.length ? mine.map((x) => <span key={x.id} className="pill">{x.number} · {t("v8From")} {fmtDay(x.station!.since)}</span>) : <span className="muted">—</span>}</div>
      <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("v8StationScannersHint")}</div>
    </>
  );
}
