import { useState } from "react";
import type { ClientPaintJob } from "@hagel/shared";
import { api } from "../../api";
import { t } from "../../shared/i18n";
import type { LocalVehicle } from "../../shared/sync/db";
import { useField } from "../../shared/store";
import { toast } from "../../shared/toast";
import { Dialog, Field } from "../../shared/ui";

const errText = (e: unknown) => (e as Error).message || String(e);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });

/** the partner body shops that paint for us (the flag is set in Administration → Body shops) */
export function usePartners() {
  const f = useField();
  return (f.refs?.bodyshops ?? []).filter((b) => b.paintPartner);
}

/** buttons of one paint job for the paint managers (the server checks the right again); read-only for everybody else */
export function PaintActions({ v, job }: { v: LocalVehicle; job: ClientPaintJob }) {
  const f = useField();
  const [dlg, setDlg] = useState<null | "schedule" | "customer" | "body">(null);
  const noMove = !!(v as { noMove?: boolean }).noMove;
  if (!f.can("peinture.gerer")) return null;
  const post = async (path: string, body?: unknown) => { try { await api("POST", path, body ?? {}); } catch (e) { toast(errText(e), 5000); } };
  const sty = { minHeight: 44, padding: "6px 12px" } as const;
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {(job.status === "to_paint" || job.status === "scheduled") && !noMove && <button className="chip on" style={sty} onClick={() => setDlg("schedule")}>📅 {t("f5Schedule")}</button>}
      {(job.status === "to_paint" || job.status === "scheduled") && <button className={"chip" + (noMove ? " on" : "")} style={sty} onClick={() => setDlg("customer")}>👤 {t("f5CustomerAppt")}</button>}
      {job.status === "scheduled" && !job.customerAppointment && <button className="chip on" style={sty} onClick={() => setDlg("body")}>🚚 {t("f5AtBodyShop")}</button>}
      {job.status === "scheduled" && job.customerAppointment && <button className="chip on" style={sty} onClick={() => void post(`/paint/${job.id}/status`, { status: "done" })}>🎨 {t("f5Done")}</button>}
      {job.status === "at_body_shop" && <button className="chip on" style={sty} onClick={() => void post(`/paint/${job.id}/status`, { status: "done" })}>🎨 {t("f5Done")}</button>}
      {(job.status === "scheduled" || job.status === "at_body_shop") && <button className="chip" style={sty} onClick={() => void post(`/paint/${job.id}/status`, { status: "to_paint" })}>↩ {t("f5BackToPaint")}</button>}
      {(job.status === "to_paint" || job.status === "scheduled") && <button className="chip" style={{ ...sty, color: "#8F1D14" }} aria-label={t("f5Remove")} onClick={() => { void api("DELETE", `/paint/${job.id}`).catch((e) => toast(errText(e), 5000)); }}>✕</button>}
      {dlg === "schedule" && <ScheduleDialog job={job} customer={false} onClose={() => setDlg(null)} />}
      {dlg === "customer" && <ScheduleDialog job={job} customer v={v} onClose={() => setDlg(null)} />}
      {dlg === "body" && <BodyShopDialog v={v} job={job} onClose={() => setDlg(null)} />}
    </span>
  );
}

/** D26 (schedule at a partner body shop) / D25 (appointment with the customer: his e-mail, confirmation now, reminder the day before) */
export function ScheduleDialog({ job, customer, v, onClose }: { job: ClientPaintJob; customer: boolean; v?: LocalVehicle; onClose: () => void }) {
  const partners = usePartners();
  const [partner, setPartner] = useState(job.partnerId ?? partners[0]?.id ?? "");
  const [date, setDate] = useState(job.plannedDate ?? today()), [time, setTime] = useState(job.plannedTime ?? "09:00");
  const [email, setEmail] = useState(String((v as Record<string, unknown> | undefined)?.kundeEmail ?? "")), [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const ok = !!partner && !!date && (!customer || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !!time)) && !busy;
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      if (customer) {
        const r = await api<{ mailed: boolean }>("POST", `/paint/${job.id}/customer-appointment`, { partnerId: partner, date, time, email: email.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) });
        toast(r.mailed ? t("f5Mailed") : t("f5NotMailed"), 5000);
      } else await api("POST", `/paint/${job.id}/schedule`, { partnerId: partner, date, ...(time ? { time } : {}) });
      onClose();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Dialog title={customer ? t("f5CustomerTitle") : t("f5ScheduleTitle")} onClose={onClose}>
      {customer && <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{t("f5CustomerHint")}</div>}
      <Field label={`${t("f5Partner")} *`}>
        {partners.length ? <select className="inp" value={partner} onChange={(e) => setPartner(e.target.value)}><option value="">{t("f5PartnerPh")}</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          : <div className="muted" style={{ color: "var(--brick)", fontSize: 13 }}>{t("f5NoPartner")}</div>}
      </Field>
      <div className="row" style={{ gap: 8 }}>
        <div className="grow"><Field label={`${t("f5Date")} *`}><input className="inp" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
        <div className="grow"><Field label={customer ? `${t("f5Time")} *` : t("f5Time")}><input className="inp" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field></div>
      </div>
      {customer && (
        <>
          <Field label={`${t("f5CustomerEmail")} *`}><input className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label={t("f5CustomerPhone")}><input className="inp" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </>
      )}
      {err && <div className="err">{err}</div>}
      <button className="pbtn" disabled={!ok} onClick={() => void submit()}>✓ {t("save")}</button>
    </Dialog>
  );
}

/** the car leaves for the painter: the driver is chosen among the people of the car's station (no free name) */
function BodyShopDialog({ v, job, onClose }: { v: LocalVehicle; job: ClientPaintJob; onClose: () => void }) {
  const f = useField();
  const drivers = (f.refs?.drivers ?? []).filter((d) => !!v.stationId && d.stationIds.includes(v.stationId as string));
  const [driver, setDriver] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  return (
    <Dialog title={t("f5AtBodyShopTitle")} onClose={onClose}>
      <Field label={`${t("f1Driver")} *`}>
        <select className="inp" value={driver} onChange={(e) => setDriver(e.target.value)}><option value="">{drivers.length ? t("f1DriverPh") : t("f1DriverNone")}</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t("f1DriverHint").replace("{n}", String(drivers.length))}</div>
      </Field>
      {err && <div className="err">{err}</div>}
      <button className="pbtn" disabled={!driver || busy} onClick={async () => { setBusy(true); try { await api("POST", `/paint/${job.id}/status`, { status: "at_body_shop", driverUserId: driver }); onClose(); } catch (e) { setErr(errText(e)); setBusy(false); } }}>🚚 {t("f5AtBodyShop")}</button>
    </Dialog>
  );
}
