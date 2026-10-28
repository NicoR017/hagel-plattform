import { useEffect, useMemo, useState } from "react";
import { api, httpFetch } from "../api";
import { act, Card, Err, Modal, useLoad } from "../admin";
import { shareOrDownload } from "../field/docs";
import { toast } from "../field/toast";
import { confirmDialog } from "../field/ui";
import { fmtDateTime, getLang, t, type Key } from "../i18n";

/** V6: Administration → Automatic reports. The reports for insurers: list, editor in six sections, PDF and e-mail preview, send now / test, history. */

const KPIS = ["inspected", "repaired", "backlog", "upcoming", "progress", "refused"] as const;
const LANG_OPTIONS = ["es", "en", "de", "fr"] as const;
const VARS = ["insurer", "period", "period_short", "project_start", "inspected_period", "inspected_total", "repaired_period", "repaired_total", "backlog", "upcoming", "progress", "sender", "company"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Report {
  id: string; name: string; language: string; company_id: string | null; active: boolean;
  insurer_ids: string[]; bodyshop_ids: string[]; station_ids: string[]; countries: string[]; project_start: string | null;
  frequency: "week" | "month" | "quarter"; send_day: number; window_from: string; window_to: string; timezone: string;
  to_emails: string[]; cc_emails: string[]; bcc_emails: string[]; reply_to: string | null; subject: string; body: string;
  kpis: string[]; annex_vehicles: boolean; show_amounts: boolean;
  insurers?: string[]; nextSend?: { on: string; period: { from: string; to: string } } | null; lastRun?: { status: string; periodTo: string; at: string } | null;
}
type Draft = Omit<Report, "id"> & { id?: string };
interface Run { id: string; periodFrom: string; periodTo: string; trigger: string; status: string; recipients: string[]; error: string | null; sentAt: string | null; createdAt: string; sentBy: string; hasFile: boolean }

const niceLang = () => (LANG_OPTIONS as readonly string[]).includes(getLang()) ? getLang() : "es";
const emptyDraft = (): Draft => ({
  name: "", language: niceLang(), company_id: null, active: true, insurer_ids: [], bodyshop_ids: [], station_ids: [], countries: [], project_start: null,
  frequency: "week", send_day: 1, window_from: "16:00", window_to: "17:00", timezone: "Europe/Madrid",
  to_emails: [], cc_emails: [], bcc_emails: [], reply_to: null, subject: "", body: "", kpis: ["inspected", "repaired", "backlog", "upcoming", "progress"], annex_vehicles: false, show_amounts: false,
});
const dateOf = (iso: string) => { const [y, m, d] = iso.split("-"); return getLang() === "de" ? `${d}.${m}.${y}` : `${d}/${m}/${y}`; };
const weekday = (n: number) => new Date(Date.UTC(2026, 0, 4 + n)).toLocaleDateString(getLang(), { weekday: "long", timeZone: "UTC" });
const freqLabel = (f: string) => t(f === "week" ? "v9Week" : f === "month" ? "v9Month" : "v9Quarter");
const dayLabel = (r: Pick<Report, "frequency" | "send_day">) => (r.frequency === "week" ? weekday(r.send_day) : `${t("v9DayOfMonth")} ${r.send_day}`);
const fileName = (r: Pick<Report, "name">) => `${r.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "report"}.pdf`;
const query = (from: string, to: string) => (from || to ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : "");

export function InsurerReportsPage({ canSend, canManage }: { canSend: boolean; canManage: boolean }) {
  const list = useLoad<Report[]>("/admin/insurer-reports");
  const [edit, setEdit] = useState<Draft | null>(null);
  const [pdf, setPdf] = useState<Report | null>(null);
  const [mail, setMail] = useState<Report | null>(null);
  const [hist, setHist] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const sendNow = async (r: Report) => {
    const cc = r.cc_emails.length ? ` (Cc: ${r.cc_emails.join(", ")})` : "";
    const internal = r.bcc_emails.length ? `, ${t("v9InternalCopy")}` : "";
    if (!confirmDialog(t("v9SendQ").replace("{to}", r.to_emails.join(", ")).replace("{cc}", cc + internal))) return;
    setBusy(r.id + "send");
    try {
      const out = await api<{ run: Run }>("POST", `/admin/insurer-reports/${r.id}/send`, {});
      toast(out.run.status === "sent" ? t("v9SentOk").replace("{to}", out.run.recipients.join(", ")) : t("v9SendFailed").replace("{error}", out.run.error ?? ""), 6000);
    } catch (e) { toast(t("v9SendFailed").replace("{error}", (e as Error).message), 6000); }
    setBusy(""); void list.reload();
  };
  const test = async (r: Report) => {
    setBusy(r.id + "test");
    try {
      const out = await api<{ run: Run }>("POST", `/admin/insurer-reports/${r.id}/test`, {});
      toast(out.run.status === "sent" ? t("v9TestOk").replace("{to}", out.run.recipients.join(", ")) : t("v9SendFailed").replace("{error}", out.run.error ?? ""), 6000);
    } catch (e) { toast(t("v9SendFailed").replace("{error}", (e as Error).message), 6000); }
    setBusy(""); void list.reload();
  };

  return (
    <>
      <Card title={t("v9Reports")} actions={canManage && <button className="btn" onClick={() => setEdit(emptyDraft())}>{t("v9New")}</button>}>
        <p className="muted" style={{ marginTop: 0 }}>{t("v9ReportsHint")}</p>
        <Err msg={list.err || err} />
        {!!list.data && !list.data.length && <p className="muted">{t("v9NoReports")}</p>}
        {!!list.data?.length && (
          <table>
            <thead><tr><th>{t("name")}</th><th>{t("insurers")}</th><th>{t("v9ColSchedule")}</th><th>{t("v9ColRecipients")}</th><th>{t("v9ColLast")}</th><th>{t("v9ColNext")}</th><th /></tr></thead>
            <tbody>{list.data.map((r) => (
              <tr key={r.id}>
                <td>{r.name}{!r.active && <span className="pill off">{t("inactive")}</span>}</td>
                <td>{(r.insurers ?? []).join(", ") || "—"}</td>
                <td>{freqLabel(r.frequency)} · {dayLabel(r)} · {r.window_from}–{r.window_to}</td>
                <td>{r.to_emails.length + r.cc_emails.length}</td>
                <td>{r.lastRun ? <><span className={"pill" + (r.lastRun.status === "sent" ? "" : " off")}>{t(`v9St_${r.lastRun.status}` as Key)}</span> {fmtDateTime(r.lastRun.at)}</> : t("v9Never")}</td>
                <td>{r.nextSend ? <>{dateOf(r.nextSend.on)}<br /><span className="muted" style={{ fontSize: 12 }}>{dateOf(r.nextSend.period.from)} – {dateOf(r.nextSend.period.to)}</span></> : "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn sec" onClick={() => setPdf(r)}>{t("v9Pdf")}</button>{" "}
                  <button className="btn sec" onClick={() => setMail(r)}>{t("v9MailPreview")}</button>{" "}
                  {canSend && <><button className="btn" disabled={!!busy || !r.to_emails.length} onClick={() => void sendNow(r)}>{t("v9SendNow")}</button>{" "}
                    <button className="btn sec" disabled={!!busy} onClick={() => void test(r)}>{t("v9Test")}</button>{" "}</>}
                  <button className="btn sec" onClick={() => setHist(r)}>{t("v9History")}</button>{" "}
                  <button className="btn sec" onClick={() => setEdit({ ...r })}>{canManage ? t("edit") : t("v9View")}</button>{" "}
                  {canManage && <button className="btn danger" onClick={() => { if (confirmDialog(`${t("v9DeleteQ")}\n\n${r.name}`)) void act(() => api("DELETE", `/admin/insurer-reports/${r.id}`), setErr, list.reload); }}>{t("delete")}</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {edit && <ReportEditor draft={edit} canManage={canManage} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void list.reload(); }} />}
      {pdf && <PdfPreview report={pdf} onClose={() => setPdf(null)} />}
      {mail && <MailPreview report={mail} onClose={() => setMail(null)} />}
      {hist && <History report={hist} canSend={canSend} onClose={() => { setHist(null); void list.reload(); }} />}
    </>
  );
}

// ------------------------------------------------------------------ the editor (S44): six sections

type TabKey = "general" | "scope" | "schedule" | "recipients" | "mail" | "pdf";
const TABS: { k: TabKey; label: Key }[] = [
  { k: "general", label: "v9TabGeneral" }, { k: "scope", label: "v9TabScope" }, { k: "schedule", label: "v9TabSchedule" },
  { k: "recipients", label: "v9TabRecipients" }, { k: "mail", label: "v9TabMail" }, { k: "pdf", label: "v9TabPdf" },
];

function ReportEditor({ draft, canManage, onClose, onSaved }: { draft: Draft; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const [tab, setTab] = useState<TabKey>("general");
  const [err, setErr] = useState("");
  const set = (p: Partial<Draft>) => setF((x) => ({ ...x, ...p }));
  const insurers = useLoad<{ id: string; name: string }[]>("/admin/insurers");
  const bodyshops = useLoad<{ id: string; name: string }[]>("/admin/bodyshops");
  const stations = useLoad<{ id: string; name: string; type: string }[]>("/admin/stations");
  const companies = useLoad<{ id: string; name: string }[]>("/admin/companies");
  const ro = !canManage;
  const toggle = (key: "insurer_ids" | "bodyshop_ids" | "station_ids" | "countries", v: string) => set({ [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] } as Partial<Draft>);

  const save = () => {
    const body = {
      name: f.name, language: f.language, company_id: f.company_id, active: f.active, insurer_ids: f.insurer_ids, bodyshop_ids: f.bodyshop_ids, station_ids: f.station_ids, countries: f.countries,
      project_start: f.project_start || null, frequency: f.frequency, send_day: f.send_day, window_from: f.window_from, window_to: f.window_to, timezone: f.timezone,
      to_emails: f.to_emails, cc_emails: f.cc_emails, bcc_emails: f.bcc_emails, reply_to: f.reply_to || null, subject: f.subject, body: f.body, kpis: f.kpis, annex_vehicles: f.annex_vehicles, show_amounts: f.show_amounts,
    };
    void act(() => (f.id ? api("PUT", `/admin/insurer-reports/${f.id}`, body) : api("POST", "/admin/insurer-reports", body)), setErr, onSaved);
  };

  const check = (label: string, on: boolean, onChange: () => void) => (
    <label key={label} style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400, margin: "4px 0" }}>
      <input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={on} disabled={ro} onChange={onChange} />{label}
    </label>
  );
  const moveKpi = (i: number, d: -1 | 1) => { const k = [...f.kpis]; [k[i], k[i + d]] = [k[i + d], k[i]]; set({ kpis: k }); };

  return (
    <Modal title={f.id ? `${t("v9EditTitle")}: ${f.name}` : t("v9New")} onClose={onClose}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0" }} role="tablist">
        {TABS.map((x, i) => <button key={x.k} role="tab" aria-selected={tab === x.k} className={"btn" + (tab === x.k ? "" : " sec")} onClick={() => setTab(x.k)}>{i + 1} · {t(x.label)}</button>)}
      </div>

      {tab === "general" && (
        <>
          <label>{t("v9Name")}</label><input value={f.name} disabled={ro} onChange={(e) => set({ name: e.target.value })} />
          <label>{t("v9Language")}</label>
          <select value={f.language} disabled={ro} onChange={(e) => set({ language: e.target.value })}>{LANG_OPTIONS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select>
          <label>{t("v9Letterhead")}</label>
          <select value={f.company_id ?? ""} disabled={ro} onChange={(e) => set({ company_id: e.target.value || null })}>
            <option value="">{t("v9DefaultLetterhead")}</option>{(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ marginTop: 10 }}>{check(t("v9Active"), f.active, () => set({ active: !f.active }))}</div>
        </>
      )}

      {tab === "scope" && (
        <>
          <label>{t("v9ScopeInsurers")}</label>
          <div className="scopebox">{(insurers.data ?? []).map((i) => check(i.name, f.insurer_ids.includes(i.id), () => toggle("insurer_ids", i.id)))}</div>
          <label>{t("v9ScopeBodyshops")}</label>
          <div className="scopebox">{(bodyshops.data ?? []).map((i) => check(i.name, f.bodyshop_ids.includes(i.id), () => toggle("bodyshop_ids", i.id)))}</div>
          <label>{t("v9ScopeStations")}</label>
          <div className="scopebox">{(stations.data ?? []).filter((s) => s.type !== "carrosserie").map((i) => check(i.name, f.station_ids.includes(i.id), () => toggle("station_ids", i.id)))}</div>
          <label>{t("v9ScopeCountries")}</label>
          <div style={{ display: "flex", gap: 16 }}>{["ES", "DE"].map((c) => check(c, f.countries.includes(c), () => toggle("countries", c)))}</div>
          <label>{t("v9ProjectStart")}</label>
          <input type="date" value={f.project_start ?? ""} disabled={ro} onChange={(e) => set({ project_start: e.target.value || null })} />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t("v9ProjectStartHint")}</div>
        </>
      )}

      {tab === "schedule" && (
        <>
          <div className="row">
            <div className="grow"><label>{t("v9Frequency")}</label>
              <select value={f.frequency} disabled={ro} onChange={(e) => { const frequency = e.target.value as Draft["frequency"]; set({ frequency, send_day: frequency === "week" ? Math.min(f.send_day, 7) : f.send_day }); }}>
                {(["week", "month", "quarter"] as const).map((x) => <option key={x} value={x}>{freqLabel(x)}</option>)}
              </select></div>
            <div className="grow"><label>{t("v9SendDay")}</label>
              <select value={f.send_day} disabled={ro} onChange={(e) => set({ send_day: Number(e.target.value) })}>
                {f.frequency === "week"
                  ? [1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{weekday(d)}</option>)
                  : Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{t("v9DayOfMonth")} {d}</option>)}
              </select></div>
          </div>
          <div className="row">
            <div className="grow"><label>{t("v9Window")}: {t("v9WindowFrom")}</label><input type="time" value={f.window_from} disabled={ro} onChange={(e) => set({ window_from: e.target.value })} /></div>
            <div className="grow"><label>{t("v9WindowTo")}</label><input type="time" value={f.window_to} disabled={ro} onChange={(e) => set({ window_to: e.target.value })} /></div>
            <div className="grow"><label>{t("v9Timezone")}</label>
              <select value={f.timezone} disabled={ro} onChange={(e) => set({ timezone: e.target.value })}>
                {[...new Set(["Europe/Madrid", "Europe/Berlin", "Atlantic/Canary", "UTC", f.timezone])].map((z) => <option key={z}>{z}</option>)}
              </select></div>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>{t("v9PeriodHint")}</p>
          <label>{t("v9NextSends")}</label>
          {f.id ? <NextSends id={f.id} /> : <div className="muted" style={{ fontSize: 13 }}>{t("v9SaveFirst")}</div>}
        </>
      )}

      {tab === "recipients" && (
        <>
          <label>{t("v9To")}</label><EmailList value={f.to_emails} disabled={ro} onChange={(v) => set({ to_emails: v })} />
          <label>{t("v9Cc")}</label><EmailList value={f.cc_emails} disabled={ro} onChange={(v) => set({ cc_emails: v })} />
          <label>{t("v9Bcc")}</label><EmailList value={f.bcc_emails} disabled={ro} onChange={(v) => set({ bcc_emails: v })} />
          <label>{t("v9ReplyTo")}</label><input type="email" value={f.reply_to ?? ""} disabled={ro} onChange={(e) => set({ reply_to: e.target.value || null })} />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t("v9ReplyToHint")}</div>
        </>
      )}

      {tab === "mail" && (
        <>
          <label>{t("v9Subject")}</label><input value={f.subject} maxLength={300} disabled={ro} onChange={(e) => set({ subject: e.target.value })} />
          <label>{t("v9Body")}</label><textarea rows={10} value={f.body} maxLength={8000} disabled={ro} onChange={(e) => set({ body: e.target.value })} style={{ width: "100%" }} />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t("v9TextHint")}</div>
          <label>{t("v9Variables")}</label>
          <div className="chips">{VARS.map((v) => <button key={v} type="button" className="pill" disabled={ro} onClick={() => set({ body: `${f.body}{{${v}}}` })}>{`{{${v}}}`}</button>)}</div>
        </>
      )}

      {tab === "pdf" && (
        <>
          <label>{t("v9Figures")}</label>
          {f.kpis.map((k, i) => (
            <div key={k} className="row" style={{ gap: 6, margin: "4px 0" }}>
              <span className="grow">{check(t(`v9K_${k}` as Key), true, () => set({ kpis: f.kpis.filter((x) => x !== k) }))}</span>
              <button type="button" className="btn sec" disabled={ro || i === 0} aria-label="↑" onClick={() => moveKpi(i, -1)}>↑</button>
              <button type="button" className="btn sec" disabled={ro || i === f.kpis.length - 1} aria-label="↓" onClick={() => moveKpi(i, 1)}>↓</button>
            </div>
          ))}
          {KPIS.filter((k) => !f.kpis.includes(k)).map((k) => check(t(`v9K_${k}` as Key), false, () => set({ kpis: [...f.kpis, k] })))}
          <div style={{ marginTop: 10 }}>
            {check(t("v9AnnexVehicles"), f.annex_vehicles, () => set({ annex_vehicles: !f.annex_vehicles }))}
            {check(t("v9ShowAmounts"), f.show_amounts, () => set({ show_amounts: !f.show_amounts }))}
            <div className="muted" style={{ fontSize: 12 }}>{t("v9AmountsHint")}</div>
          </div>
        </>
      )}

      <Err msg={err} />
      <p className="row modal-actions">
        {canManage && <button className="btn" onClick={save}>{t("save")}</button>}
        <button className="btn sec" onClick={onClose}>{canManage ? t("cancel") : t("close")}</button>
      </p>
    </Modal>
  );
}

function EmailList({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const add = () => {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (!EMAIL_RE.test(v)) { setBad(true); return; }
    setBad(false); setDraft("");
    if (!value.includes(v)) onChange([...value, v]);
  };
  return (
    <>
      <div className="chips">{value.map((e) => <span key={e} className="pill">{e} {!disabled && <button type="button" aria-label={t("delete")} onClick={() => onChange(value.filter((x) => x !== e))}>✕</button>}</span>)}</div>
      {!disabled && (
        <div className="row" style={{ marginTop: 4 }}>
          <input className="grow" type="email" value={draft} placeholder="name@example.com" aria-invalid={bad} onChange={(e) => { setDraft(e.target.value); setBad(false); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} onBlur={add} />
          <button type="button" className="btn sec" onClick={add}>{t("v9AddEmail")}</button>
        </div>
      )}
    </>
  );
}

function NextSends({ id }: { id: string }) {
  const n = useLoad<{ on: string; period: { from: string; to: string } }[]>(`/admin/insurer-reports/${id}/next-sends`);
  return <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{(n.data ?? []).map((x) => <li key={x.on}>{dateOf(x.on)} <span className="muted">({dateOf(x.period.from)} – {dateOf(x.period.to)})</span></li>)}</ul>;
}

// ------------------------------------------------------------------ previews (S45, D19)

function PeriodPick({ from, to, onFrom, onTo, onGo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; onGo: () => void }) {
  return (
    <div className="row" style={{ alignItems: "flex-end" }}>
      <div><label>{t("v9PeriodFrom")}</label><input type="date" value={from} onChange={(e) => onFrom(e.target.value)} /></div>
      <div><label>{t("v9PeriodTo")}</label><input type="date" value={to} onChange={(e) => onTo(e.target.value)} /></div>
      <button className="btn sec" disabled={!!from !== !!to} onClick={onGo}>OK</button>
      <span className="muted" style={{ fontSize: 12 }}>{t("v9PeriodDefault")}</span>
    </div>
  );
}

function PdfPreview({ report, onClose }: { report: Report; onClose: () => void }) {
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [state, setState] = useState<{ url: string; blob: Blob } | null>(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let url = "", alive = true;
    setState(null); setErr("");
    void httpFetch("GET", `/admin/insurer-reports/${report.id}/pdf${query(from, to)}`, undefined, { blob: true }).then((r) => {
      if (!alive) return;
      if (r.status === 200 && r.blob) { url = URL.createObjectURL(r.blob); setState({ url, blob: r.blob }); } else setErr(String(r.data?.error ?? t("invalidInput")));
    }).catch((e) => alive && setErr((e as Error).message));
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [report.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title={`${t("v9Pdf")}: ${report.name}`} onClose={onClose}>
      <PeriodPick from={from} to={to} onFrom={setFrom} onTo={setTo} onGo={() => setTick((n) => n + 1)} />
      <Err msg={err} />
      {!state && !err && <p className="muted">{t("v9Making")}</p>}
      {state && <iframe title={t("v9Pdf")} src={state.url} style={{ width: "100%", height: "65vh", border: "1px solid var(--line)", borderRadius: 8, marginTop: 8 }} />}
      <p className="row modal-actions">
        {state && <button className="btn" onClick={() => void shareOrDownload(state.blob, fileName(report), "application/pdf")}>⬇ {t("v9Download")}</button>}
        <button className="btn sec" onClick={onClose}>{t("close")}</button>
      </p>
    </Modal>
  );
}

function MailPreview({ report, onClose }: { report: Report; onClose: () => void }) {
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [tick, setTick] = useState(0);
  const m = useLoad<{ subject: string; html: string; to: string[]; cc: string[]; bcc: string[]; replyTo: string | null; filename: string }>(`/admin/insurer-reports/${report.id}/mail-preview${query(from, to)}`, [tick]);
  const row = (label: string, v: string) => v ? <div className="row" style={{ gap: 8, alignItems: "baseline" }}><b style={{ minWidth: 110 }}>{label}</b><span>{v}</span></div> : null;
  return (
    <Modal title={`${t("v9MailPreview")}: ${report.name}`} onClose={onClose}>
      <PeriodPick from={from} to={to} onFrom={setFrom} onTo={setTo} onGo={() => setTick((n) => n + 1)} />
      <Err msg={m.err} />
      {m.data && (
        <div style={{ marginTop: 8 }}>
          {row(t("v9To"), m.data.to.join(", ")) }{row(t("v9Cc"), m.data.cc.join(", "))}{row("Bcc", m.data.bcc.join(", "))}{row(t("v9ReplyTo"), m.data.replyTo ?? "")}
          {row(t("v9Subject"), m.data.subject)}{row(t("v9Attachment"), m.data.filename)}
          <iframe title={t("v9MailPreview")} sandbox="" srcDoc={m.data.html} style={{ width: "100%", height: "40vh", border: "1px solid var(--line)", borderRadius: 8, marginTop: 8, background: "#fff" }} />
        </div>
      )}
      <p className="row modal-actions"><button className="btn sec" onClick={onClose}>{t("close")}</button></p>
    </Modal>
  );
}

// ------------------------------------------------------------------ history (S46)

function History({ report, canSend, onClose }: { report: Report; canSend: boolean; onClose: () => void }) {
  const runs = useLoad<Run[]>(`/admin/insurer-reports/${report.id}/runs`);
  const [busy, setBusy] = useState("");
  const rows = useMemo(() => runs.data ?? [], [runs.data]);
  const download = async (r: Run) => {
    const out = await httpFetch("GET", `/admin/insurer-reports/${report.id}/runs/${r.id}/pdf`, undefined, { blob: true });
    if (out.blob) await shareOrDownload(out.blob, `${fileName(report).replace(/\.pdf$/, "")}_${r.periodFrom}_${r.periodTo}.pdf`, "application/pdf");
    else toast(String(out.data?.error ?? t("invalidInput")), 5000);
  };
  const resend = async (r: Run) => {
    if (!confirmDialog(t("v9SendQ").replace("{to}", report.to_emails.join(", ")).replace("{cc}", report.cc_emails.length ? ` (Cc: ${report.cc_emails.join(", ")})` : ""))) return;
    setBusy(r.id);
    try {
      const out = await api<{ run: Run }>("POST", `/admin/insurer-reports/${report.id}/runs/${r.id}/resend`, {});
      toast(out.run.status === "sent" ? t("v9SentOk").replace("{to}", out.run.recipients.join(", ")) : t("v9SendFailed").replace("{error}", out.run.error ?? ""), 6000);
    } catch (e) { toast(t("v9SendFailed").replace("{error}", (e as Error).message), 6000); }
    setBusy(""); void runs.reload();
  };
  return (
    <Modal title={`${t("v9HistoryTitle")}: ${report.name}`} onClose={onClose}>
      <Err msg={runs.err} />
      {runs.data && !rows.length && <p className="muted">{t("v9NoHistory")}</p>}
      {!!rows.length && (
        <table>
          <thead><tr><th>{t("v9ColDate")}</th><th>{t("v9ColPeriod")}</th><th>{t("v9ColTrigger")}</th><th>{t("v9ColStatus")}</th><th>{t("v9ColRecipients")}</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtDateTime(r.sentAt ?? r.createdAt)}{r.sentBy ? <><br /><span className="muted" style={{ fontSize: 12 }}>{r.sentBy}</span></> : null}</td>
              <td>{dateOf(r.periodFrom)} – {dateOf(r.periodTo)}</td>
              <td>{t(`v9Trig_${r.trigger}` as Key)}</td>
              <td><span className={"pill" + (r.status === "sent" ? "" : " off")}>{t(`v9St_${r.status}` as Key)}</span>{r.error && <><br /><span className="muted" style={{ fontSize: 12 }}>{r.error}</span></>}</td>
              <td style={{ maxWidth: 220, overflowWrap: "anywhere" }}>{r.recipients.join(", ") || "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {r.hasFile && <button className="btn sec" onClick={() => void download(r)}>⬇ PDF</button>}{" "}
                {canSend && r.hasFile && r.trigger !== "test" && <button className="btn sec" disabled={!!busy} onClick={() => void resend(r)}>{t("v9Resend")}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="row modal-actions"><button className="btn sec" onClick={onClose}>{t("close")}</button></p>
    </Modal>
  );
}
