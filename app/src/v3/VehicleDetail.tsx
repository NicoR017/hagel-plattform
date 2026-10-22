import { useEffect, useState, type ReactNode } from "react";
import { STATUSES } from "@hagel/shared";
import { api } from "../api";
import { fmtDateTime, t } from "../i18n";
import { addAppointment, addComment, deleteAppointment } from "../sync/mutations";
import type { LocalVehicle } from "../sync/db";
import { AssignDialog, MoveDialog, StatusDialog, holdReasonLabel, statusLabel } from "../field/Dialogs";
import { Basis } from "../field/Basis";
import { BookingForm } from "../field/BookingForm";
import { Bilder } from "../field/Bilder";
import { Erfassung } from "../field/Erfassung";
import { Kva, SharesBox } from "../field/Kva";
import { bookableStatus, dayLabel, todayIn, tzOfCountry } from "../field/calendar";
import { go, type Ctx, type Mode, type Tab } from "../field/route";
import { useField, usePhotos, useVehicle } from "../field/store";
import { STATUS_STYLE } from "./modes";

interface Repair { comments: { id: string; userName: string; at: string; text: string }[]; appointments: { id: string; technicianId: string; date: string; durationMin: number; note: string }[]; booking: unknown }

/** sections of the vehicle detail, by mode (Alle Fahrzeuge shows all of them) */
export function sectionsFor(mode: Mode, v: { statut: string; repairStage?: unknown }, can: (p: string) => boolean): Tab[] {
  const booking = can("termine.buchen") && bookableStatus(v);
  const kalk: Tab[] = ["basis", ...(booking ? ["termin" as Tab] : []), "erfassung", "bilder", "kva", "kommunikation", "gtmotive", "verlauf"];
  const rep: Tab[] = ["basis", "techniker", "planung", "bilder", "kva", "kommunikation", "verlauf"];
  const all: Tab[] = ["basis", ...(booking ? ["termin" as Tab] : []), "erfassung", "techniker", "planung", "bilder", "kva", "kommunikation", "gtmotive", "verlauf"];
  return mode === "kalk" ? kalk : mode === "rep" ? rep : all;
}

const SECTION_LABEL = (tab: Tab, mode: Mode) =>
  ({
    basis: t("v4SecGeneral"), termin: t("v4SecBooking"), erfassung: t("v4SecCapture"), techniker: t("v4SecTech"), planung: t("v4SecPlanning"), bilder: t("tabPhotos"),
    kva: mode === "rep" ? t("v4SecDocsRep") : t("v4SecDocs"), kommunikation: t("v4SecComm"), gtmotive: "GT Motive", verlauf: t("v4SecHistory"),
  })[tab];

function Comments({ v }: { v: LocalVehicle }) {
  const f = useField();
  const [text, setText] = useState("");
  const list = ((v.repair as Repair | undefined)?.comments ?? []);
  const [sends, setSends] = useState<{ id: string; type: string; status: string; recipients: string[]; sentAt: string | null; createdAt: string; sentBy: string | null }[]>([]);
  useEffect(() => {
    if (!f.can("kva.envoyer") && !f.can("rapport_reparation.envoyer")) return;
    api<typeof sends>("GET", `/reports?vehicleId=${v.id}`).then(setSends).catch(() => undefined);
  }, [v.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const can = f.can("kommentare.schreiben");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {can && (
        <section className="panel" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 4px" }}>💬 {t("v4Comments")}</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{t("v4CommentsHint")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {list.map((c) => <div key={c.id} className="cmt"><div className="muted" style={{ fontSize: 12 }}>{c.userName} · {fmtDateTime(c.at)}</div><div style={{ whiteSpace: "pre-wrap" }}>{c.text}</div></div>)}
            {!list.length && <div className="muted">{t("v4NoComments")}</div>}
          </div>
          <form style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) { void addComment(f.mut, v.id, text); setText(""); } }}>
            <textarea className="inp" rows={2} style={{ flex: "1 1 240px" }} value={text} maxLength={2000} placeholder={t("v4CommentPh")} onChange={(e) => setText(e.target.value)} aria-label={t("v4Comments")} />
            <button className="btn primary" type="submit" disabled={!text.trim()}>{t("v4Send")}</button>
          </form>
        </section>
      )}
      {sends.length > 0 && (
        <section className="panel" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 8px" }}>✉ {t("alreadySent")}</h3>
          {sends.map((h) => (
            <div key={h.id} style={{ fontSize: 13, borderTop: "1px solid var(--line)", padding: "8px 0" }}>
              {h.status === "sent" ? "✓" : h.status === "failed" ? "⚠" : "⏳"} {h.type} · {fmtDateTime(h.sentAt ?? h.createdAt)} · {h.sentBy ?? ""}
              <div className="muted">{h.recipients.join(", ")}</div>
            </div>
          ))}
        </section>
      )}
      {!can && !sends.length && <div className="empty">{t("forbidden")}</div>}
    </div>
  );
}

/** "Technikerplanung": who works on this car on which day (weekly planning per technician). */
function Planung({ v }: { v: LocalVehicle }) {
  const f = useField();
  const techs = f.refs?.technicians ?? [];
  const list = ((v.repair as Repair | undefined)?.appointments ?? []);
  const station = f.refs?.stations.find((s) => s.id === v.stationId);
  const today = todayIn(tzOfCountry(station?.country ?? "DE"));
  const [tech, setTech] = useState(""), [date, setDate] = useState(today), [min, setMin] = useState(60), [note, setNote] = useState("");
  const can = f.can("vehicules.assigner");
  const name = (id: string) => techs.find((x) => x.id === id)?.name ?? "—";
  return (
    <section className="panel" style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 10px" }}>🗓 {t("v4SecPlanning")}</h3>
      {!list.length && <p className="muted">{t("v4NoPlanning")}</p>}
      {list.map((a) => (
        <div key={a.id} className="row" style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
          <span><b>{dayLabel(a.date, today, "de-DE")}</b> · {name(a.technicianId)} · {a.durationMin} min{a.note ? ` · ${a.note}` : ""}</span>
          {can && <button className="chip" aria-label={t("delete")} onClick={() => void deleteAppointment(f.mut, v.id, a.id)}>✕</button>}
        </div>
      ))}
      {can && (
        techs.length ? (
          <form style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (tech && date) { void addAppointment(f.mut, v.id, { technicianId: tech, date, durationMin: min, note }); setNote(""); } }}>
            <select className="sel" value={tech} onChange={(e) => setTech(e.target.value)} aria-label={t("technician")}><option value="">{t("technician")}</option>{techs.map((x) => <option key={x.id} value={x.id}>{x.name}{x.kind === "headliner" ? " (Headliner)" : ""}</option>)}</select>
            <input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t("v4Day")} />
            <input className="inp" type="number" min={5} max={1440} step={15} value={min} onChange={(e) => setMin(Math.max(5, Number(e.target.value) || 60))} aria-label={t("v4Duration")} />
            <input className="inp" value={note} maxLength={300} placeholder={t("v4NotePh")} onChange={(e) => setNote(e.target.value)} />
            <button className="btn primary" type="submit" disabled={!tech || !date}>{t("v4Add")}</button>
          </form>
        ) : <p className="muted" style={{ marginTop: 10 }}>{t("v4NoTechs")}</p>
      )}
    </section>
  );
}

function Techniker({ v }: { v: LocalVehicle }) {
  const f = useField();
  const all = [v];
  const [dlg, setDlg] = useState(false);
  const people = f.refs?.people ?? [];
  const names = v.assigneeIds.map((id) => people.find((p) => p.id === id)?.name ?? id);
  const c = f.calcOf(v);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section className="panel" style={{ padding: 16 }}>
        <div className="row"><h3 style={{ margin: 0 }}>🧑‍🔧 {t("v4SecTech")}</h3>{f.can("vehicules.assigner") && <button className="btn" onClick={() => setDlg(true)}>{t("assignTitle")}</button>}</div>
        <p className="muted" style={{ margin: "8px 0 0" }}>{names.length ? `${t("assigned")}: ${names.join(", ")}` : t("v4NobodyAssigned")}</p>
      </section>
      {f.can("repartition_interne.voir") ? <div className="fld embed"><SharesBox v={v} c={c} /></div> : (
        (v as Record<string, unknown>).myShare ? <section className="panel" style={{ padding: 16 }}>{t("v4YourShare")}</section> : null
      )}
      {dlg && <AssignDialog ids={[v.id]} vehicles={all} onClose={() => setDlg(false)} />}
    </div>
  );
}

function GtMotive() {
  return (
    <section className="panel" style={{ padding: 20 }}>
      <div className="row"><h3 style={{ margin: 0 }}>GT Motive</h3><span className="badge" style={{ background: "#FDF0E1", color: "#8A4A06" }}>{t("v4InPrep")}</span></div>
      <p className="muted">{t("v4GtText")}</p>
      <button className="btn" disabled>{t("v4GtLink")}</button>
    </section>
  );
}

const dmy = (d: unknown) => String(d ?? "").replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1");
interface Ev { at: string; kind: string; who: string; data: Record<string, unknown> }
function evText(e: Ev): string {
  const d = e.data;
  if (e.kind === "status") return `${t("status")}: ${statusLabel(String(d.statut))}${d.motif ? ` · ${holdReasonLabel(String(d.motif))}` : ""}`;
  if (e.kind === "move") return `${t("move")}: ${String(d.from ?? "—")} → ${String(d.to ?? "—")}${d.note ? ` (${String(d.note)})` : ""}`;
  if (e.kind === "send") return `✉ ${String(d.type)} → ${(d.recipients as string[] | undefined)?.join(", ") ?? ""} (${String(d.status)})`;
  const k = String(d.type);
  const map: Record<string, string> = {
    booking_moved_car: `${t("move")}: ${String(d.to ?? "")}`, bodyshop: `${t("v5Bodyshop")}: ${String(d.name ?? "—")}`, entered_repair: t("v4EvEntered"), stage: `${t("v4EvStage")} ${String(d.to ?? "")}`, finish: t("v4EvFinish"), todo_add: `${t("v4EvTodo")}: ${String(d.text ?? "")}`,
    todo_done: `${t("v4EvTodoDone")}: ${String(d.text ?? "")}`, todo_reopen: `${t("v4EvTodoOpen")}: ${String(d.text ?? "")}`, todo_delete: `${t("v4EvTodoDel")}: ${String(d.text ?? "")}`,
    check_done: `${t("v4EvCheck")}: ${String(d.key ?? "")}`, check_reopen: `${t("v4EvCheckOpen")}: ${String(d.key ?? "")}`,
    booking_created: `${t("v4EvBook")}: ${dmy(d.date)} ${String(d.time ?? "")}`, booking_moved: `${t("v4EvBookMoved")}: ${dmy(d.to)}`,
    booking_cancelled: `${t("v4EvBookCancelled")}: ${dmy(d.date)}`, booking_started: t("v4EvBookStarted"),
  };
  return map[k] ?? k;
}

export function Verlauf({ id }: { id: string }) {
  const f = useField();
  const [list, setList] = useState<Ev[] | null>(null);
  const stamp = f.status.lastSyncAt ?? 0;
  useEffect(() => { api<Ev[]>("GET", `/vehicles/${id}/verlauf`).then(setList).catch(() => setList([])); }, [id, stamp]);
  return (
    <section className="panel" style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 8px" }}>🕘 {t("v4SecHistory")}</h3>
      {list === null && <p className="muted">{t("loading")}</p>}
      {list && !list.length && <p className="muted">{f.status.online ? t("noData") : t("v4HistOnline")}</p>}
      <div className="tl">{(list ?? []).map((e, i) => <div key={i}><time>{fmtDateTime(e.at)}</time><span style={{ flex: 1 }}>{evText(e)}</span><span className="muted">{e.who}</span></div>)}</div>
    </section>
  );
}

/**
 * The vehicle detail: dark header (plate, model, claim, status, Status ändern, Verschieben, Kommentare) and a left menu whose sections depend on
 * the mode. "Allgemeine Daten" is the Basis form with the status stepper; the other sections reuse the capture, photo and KVA screens.
 */
export function VehicleDetail({ id, tab, ctx }: { id: string; tab: Tab; ctx?: Ctx }) {
  const f = useField();
  const v = useVehicle(id);
  const photos = usePhotos(id);
  const [dlg, setDlg] = useState<null | "status" | "move">(null);
  if (v === undefined) return <main><p className="muted">{t("loading")}</p></main>;
  if (v === null) return <main><div className="empty"><b>{t("vehicleNotFound")}</b><br />{t("vehicleNotFoundHint")}</div></main>;

  const mode: Mode = ctx?.mode ?? "all";
  const sections = sectionsFor(mode, v as { statut: string; repairStage?: unknown }, f.can);
  const cur: Tab = sections.includes(tab) ? tab : "basis";
  const x = v as Record<string, unknown>;
  const st = STATUS_STYLE[v.statut] ?? STATUS_STYLE.arrive;
  const comments = (v.repair as Repair | undefined)?.comments.length ?? 0;
  const booking = (v.repair as { booking?: { date: string } | null } | undefined)?.booking ?? null;
  const open = (t2: Tab) => go({ page: "vehicle", id, tab: t2, ctx });
  const embed = (n: ReactNode) => <div className="fld embed" style={{ background: "#fff", borderRadius: 14, border: "1px solid var(--line)" }}>{n}</div>;

  return (
    <>
      <div className="vd-band">
        <div style={{ minWidth: 0 }}>
          <h1>{String(x.kennzeichen || "—")}</h1>
          <div style={{ color: "#B9C4D6", fontSize: 13 }}>{String(x.modell || x.fin || "")}{x.claimNumber ? ` · ${t("v3Claim")} ${String(x.claimNumber)}` : ""}</div>
        </div>
        <span className="badge" style={{ background: st.bg, color: st.fg }}>{statusLabel(v.statut)}{v.statut === "attente" && v.statutMotif ? ` · ${holdReasonLabel(String(v.statutMotif))}` : ""}</span>
        {booking && <span className="badge" style={{ background: "#E3ECFD", color: "#1D4FB8" }}>{t("v4BadgeTermin")} {dayLabel(booking.date, todayIn(tzOfCountry(f.refs?.stations.find((s) => s.id === v.stationId)?.country ?? "DE")), "de-DE")}</span>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          {f.can("vehicules.changer_statut") && <button className="btn" onClick={() => setDlg("status")}>{t("v3ChangeStatus")}</button>}
          {f.can("vehicules.deplacer") && <button className="btn" onClick={() => setDlg("move")}>{t("move")}</button>}
          {f.can("kommentare.schreiben") && <button className="btn" onClick={() => open("kommunikation")}>💬 {t("v4Comments")}{comments ? ` (${comments})` : ""}</button>}
        </div>
      </div>
      <div className="vd">
        <nav className="vd-menu" aria-label={t("v4Sections")}>
          {sections.map((s) => (
            <button key={s} className={cur === s ? "on" : ""} aria-current={cur === s ? "page" : undefined} onClick={() => open(s)}>
              <span>{SECTION_LABEL(s, mode)}</span>
              {s === "bilder" && photos.length > 0 && <span className="n">{photos.length}</span>}
              {s === "kommunikation" && comments > 0 && <span className="n">{comments}</span>}
            </button>
          ))}
        </nav>
        <div className="vd-body">
          {cur === "basis" && (
            <>
              <div className="stepper" aria-label={t("status")}>{STATUSES.map((s) => <span key={s} className={s === v.statut ? "on" : ""}>{statusLabel(s)}</span>)}</div>
              {embed(<Basis v={v} />)}
            </>
          )}
          {cur === "termin" && <section className="panel" style={{ padding: 16 }}><h3 style={{ margin: "0 0 10px" }}>📅 {t("v4BookTitle")}</h3><BookingForm v={v} /></section>}
          {cur === "erfassung" && embed(
            <>
              <Erfassung v={v} />
              {f.can("vehicules.modifier") && <div style={{ padding: "0 14px 16px" }}><button className="pbtn sec" onClick={() => go({ page: "expertise", id, step: "erfassung", ctx })}>{t("v4EditInAssistant")}</button></div>}
            </>,
          )}
          {cur === "techniker" && <Techniker v={v} />}
          {cur === "planung" && <Planung v={v} />}
          {cur === "bilder" && embed(<Bilder v={v} />)}
          {cur === "kva" && embed(<Kva v={v} technicians={false} />)}
          {cur === "kommunikation" && <Comments v={v} />}
          {cur === "gtmotive" && <GtMotive />}
          {cur === "verlauf" && <Verlauf id={id} />}
        </div>
      </div>
      {dlg === "status" && <StatusDialog ids={[id]} current={v.statut} onClose={() => setDlg(null)} />}
      {dlg === "move" && <MoveDialog ids={[id]} from={v.stationId} onClose={() => setDlg(null)} />}
    </>
  );
}

