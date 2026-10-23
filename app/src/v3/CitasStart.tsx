import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { go } from "../field/route";
import { useField } from "../field/store";
import { toast } from "../field/toast";
import { confirmDialog } from "../field/ui";
import { setPrefs } from "../sync/mutations";
import { carName, customerName, dayIn, normPlate, useCitasDay, useOnline, type Appt } from "./citas";
import { ScanInfo, useStationScans, type Scan } from "./ScanList";

const scanTime = (s: Scan) => { const d = s.scanDateTime ? Date.parse(s.scanDateTime) : NaN; return Number.isNaN(d) ? 0 : d; };
const keyOf = (s: Scan) => `${s.partitionKey}|${s.rowKey}`;

/** Start an expertise from a PDR Citas appointment: the appointment, then the scans of that day (the one with the same plate first and preselected). */
export function CitasStart({ stationId, date, appointmentId }: { stationId: string; date: string; appointmentId: string }) {
  const f = useField();
  const online = useOnline();
  const { data, err } = useCitasDay(stationId, date, online);
  const appt: Appt | undefined = data?.appointments.find((a) => a.id === appointmentId);
  const canScan = f.can("colibri.importer");
  const [all, setAll] = useState(false); // every scan of the organisation, any day (they are loaded into THIS station)
  const { scans, err: scanErr } = useStationScans(stationId, canScan, all);
  const [sel, setSel] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState("");

  const plate = appt ? normPlate(appt.vehicle.license_plate_normalized || appt.vehicle.license_plate) : "";
  const list = useMemo(() => {
    const zone = data?.timezone ?? "Europe/Madrid";
    const day = (scans ?? []).filter((s) => all || (s.scanDateTime ? dayIn(s.scanDateTime, zone) === date : false));
    const isMatch = (s: Scan) => !!plate && normPlate(s.plate) === plate;
    return day.sort((a, b) => Number(isMatch(b)) - Number(isMatch(a)) || scanTime(a) - scanTime(b));
  }, [scans, all, data?.timezone, date, plate]);

  // the scan with the same plate is preselected (until the user chooses something else)
  useEffect(() => {
    if (touched) return;
    const m = list.find((s) => s.importable && !!plate && normPlate(s.plate) === plate);
    setSel(m ? keyOf(m) : null);
  }, [list, plate, touched]);

  const open = (id: string) => { void setPrefs(f.db, { lastStationId: stationId, lastMode: "kalk" }); go({ page: "expertise", id, step: "basis", ctx: { stationId, mode: "kalk" } }); };

  const start = async (scan?: Scan) => {
    if (!appt) return;
    if (scan && normPlate(scan.plate) !== plate && !confirmDialog(t("ciPlateMismatch").replace("{scan}", scan.plate || "—").replace("{appt}", appt.vehicle.license_plate))) return;
    setBusy(scan ? "scan" : "none");
    try {
      const r = await api<{ status: string; vehicleId: string }>("POST", `/citas/appointments/${encodeURIComponent(appt.id)}/start`, { station_id: stationId, ...(scan ? { scan: { partitionKey: scan.partitionKey, rowKey: scan.rowKey } } : {}) });
      void f.engine.syncNow(f.orgId);
      open(r.vehicleId);
      return;
    } catch (e) { toast((e as Error).message, 6000); }
    setBusy("");
  };

  const chosen = list.find((s) => keyOf(s) === sel);
  const row = (l: string, v: string) => v ? <span><span className="l">{l}</span><b>{v}</b></span> : null;

  return (
    <main style={{ maxWidth: 820 }}>
      <div>
        <h1 style={{ fontSize: 22 }}>{t("ciStartTitle")}</h1>
        <p className="sub" style={{ margin: "2px 0 0" }}>{f.stationName(stationId)}</p>
      </div>

      {!online && <p className="empty">{t("ciOnlineOnly")}</p>}
      {online && !data && !err && <p className="muted">{t("loading")}</p>}
      {online && err && <p className="empty">{t("ciUnreachable")}</p>}
      {online && data && !appt && <p className="empty">{t("ciNotFound")}</p>}

      {appt && (
        <>
          <section className="panel cappt">
            {row(t("ciAppointment"), `${date} · ${appt.time}`)}
            {row(t("ciVehicle"), [appt.vehicle.license_plate, carName(appt)].filter(Boolean).join(" · "))}
            {row(t("ciCustomer"), [customerName(appt), appt.customer.phone].filter(Boolean).join(" · "))}
            {row(t("ciInsurance"), appt.insurance_name)}
            {row(t("ciCase"), appt.case_number ?? "")}
          </section>

          {appt.vehicleId ? (
            <section className="panel" style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <span style={{ flex: "1 1 240px" }}>{t("ciAlready")}</span>
              <button className="btn primary" onClick={() => open(appt.vehicleId!)}>{t("ciOpen")}</button>
            </section>
          ) : (
            <>
              {canScan && (
                <section className="panel" style={{ padding: 16 }}>
                  <h2 style={{ fontSize: 16, marginBottom: 10 }}>☁ {t("ciScansOfDay")}</h2>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 8 }}>
                    <input type="checkbox" style={{ width: 20, height: 20, minHeight: 0 }} checked={all} onChange={(e) => { setAll(e.target.checked); setTouched(false); }} />{t("ciAllScans")}
                  </label>
                  {scans === null && <p className="muted">{t("loading")}</p>}
                  {scans && !list.length && <p className="empty">{scanErr || t("ciNoScansDay")}</p>}
                  <div className="rows">
                    {list.map((s) => {
                      const match = !!plate && normPlate(s.plate) === plate;
                      return (
                        <div key={keyOf(s)} className={"vrow" + (sel === keyOf(s) ? " sel" : "")} style={{ padding: 12 }}>
                          <label className="cb"><input type="radio" name="citas-scan" disabled={!s.importable} checked={sel === keyOf(s)} onChange={() => { setSel(keyOf(s)); setTouched(true); }} /></label>
                          <ScanInfo s={s} stationId={stationId} />
                          {match && <span className="badge" style={{ background: "#E3ECFD", color: "#1D4FB8" }}>{t("ciMatch")}</span>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
              <section className="cactions">
                {canScan && <button className="btn primary" disabled={!!busy || !chosen?.importable} onClick={() => chosen && void start(chosen)}>{busy === "scan" ? t("ciStarting") : t("ciStartWith")}</button>}
                {f.can("vehicules.creer") && <button className="btn" disabled={!!busy} onClick={() => void start()}>{busy === "none" ? t("ciStarting") : t("ciStartWithout")}</button>}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
