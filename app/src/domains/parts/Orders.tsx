import { useCallback, useEffect, useMemo, useState } from "react";
import { PART_RETURN_REASONS } from "@hagel/shared";
import { api, httpFetch } from "../../api";
import { shareOrDownload } from "../../shared/docs";
import { fmtDateTime, t } from "../../shared/i18n";
import type { LocalVehicle } from "../../shared/sync/db";
import { go } from "../../shared/route";
import { useField } from "../../shared/store";
import { toast } from "../../shared/toast";
import { Dialog, Field } from "../../shared/ui";
import { partsOfVehicle } from "../vehicles/partsLogic";
import { STATUS_COLOR, createOrderApi, dmy, kindText, loadCarOrders, openPdfBase64, orderAction, previewOrder, reasonText, recordApproval, statusText, type CarOrdersData, type OrderPreview, type OrderView } from "./orderApi";

const errText = (e: unknown) => (e as Error).message || String(e);
export const OrderPill = ({ s }: { s: string }) => <span className="badge" style={{ background: (STATUS_COLOR[s] ?? STATUS_COLOR.draft).bg, color: (STATUS_COLOR[s] ?? STATUS_COLOR.draft).fg, fontSize: 11 }}>{statusText(s)}</span>;

async function downloadOrderPdf(o: OrderView) {
  const r = await httpFetch("GET", `/parts/orders/${o.id}/pdf`, undefined, { blob: true });
  if (r.status !== 200 || !r.blob) { toast(t("hoReceiptFailed"), 5000); return; }
  await shareOrDownload(r.blob, `${o.number}.pdf`, "application/pdf");
}

/** Orders of one car (tab "Parts"): the insurer approval, the orders with their status and actions, "Order parts" / "Order more parts". Online (office) actions. */
export function CarOrders({ v, onChanged }: { v: LocalVehicle; onChanged?: () => void }) {
  const f = useField();
  const [data, setData] = useState<CarOrdersData | null>(null);
  const [dlg, setDlg] = useState<null | { t: "review" | "more" } | { t: "approval" } | { t: "confirm" | "modify" | "cancel"; o: OrderView }>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const stamp = f.status.lastSyncAt ?? 0;
  const reload = useCallback(async () => { try { setData(await loadCarOrders(v.id)); } catch { setData(null); } }, [v.id]);
  useEffect(() => { if (navigator.onLine) void reload(); }, [reload, stamp]);
  const may = f.can("pieces.commander");
  const toOrder = partsOfVehicle(v as { parts?: never }).filter((p) => p.status === "to_order" && !p.orderId);
  const hasMain = !!data?.orders.some((o) => o.kind === "main" && o.status !== "cancelled");
  const run = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); setErr(""); try { await fn(); await reload(); onChanged?.(); } catch (e) { setErr(errText(e)); } finally { setBusy(""); } };
  if (!data) return navigator.onLine ? null : <p className="muted">{t("v4HistOnline")}</p>;
  const closeAnd = () => { setDlg(null); void reload(); onChanged?.(); };

  return (
    <section className="panel" style={{ padding: 16, marginTop: 14 }}>
      <h3 style={{ margin: "0 0 8px" }}>📨 {t("f4Orders")}</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
        {data.approval.at
          ? <span className="badge" style={{ background: "#E3F4EA", color: "#17663F" }}>✓ {t("f4ApprovalReceived")} · {dmy(data.approval.at)}{data.approval.note ? ` · ${data.approval.note}` : ""}</span>
          : <span className="muted" style={{ fontSize: 13 }}>{t("f4ApprovalNone")}</span>}
        {may && !data.approval.at && data.ordering.enabled && <button className="chip on" style={{ minHeight: 44 }} onClick={() => setDlg({ t: "approval" })}>{t("f4RecordApproval")}</button>}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{t("f4ApprovalHint")}</div>
      {!data.ordering.enabled && <p className="note">{t("f4NotEnabled")}</p>}
      {data.ordering.enabled && !data.ordering.hasRecipient && <p className="note">{t("f4NoRecipient")}</p>}
      {may && data.ordering.enabled && data.ordering.hasRecipient && (
        <button className="chip on" style={{ minHeight: 44, marginBottom: 10 }} disabled={!toOrder.length} title={!toOrder.length ? t("f4NoPartsToOrder") : undefined} onClick={() => setDlg({ t: hasMain ? "more" : "review" })}>
          📦 {hasMain ? t("f4OrderMore") : t("f4OrderParts")}{toOrder.length ? ` (${toOrder.length})` : ""}
        </button>
      )}
      {!data.orders.length && <div className="muted">{t("f4NoOrders")}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.orders.map((o) => (
          <article key={o.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", background: o.status === "cancelled" ? "#F7F8FA" : "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <b>{o.number} <span className="muted" style={{ fontWeight: 400 }}>· {kindText(o.kind)}{o.parentNumber ? ` (${o.parentNumber})` : ""}</span></b>
              <span style={{ display: "flex", gap: 6 }}>{o.late && <span className="badge" style={{ background: "#FBE7E4", color: "#9B2C1F" }}>⏰ {t("f4Late")}</span>}<OrderPill s={o.status} /></span>
            </div>
            <div className="muted" style={{ fontSize: 12, margin: "4px 0" }}>
              {o.sentAt ? t("f4SentOn").replace("{d}", fmtDateTime(o.sentAt)) : o.status === "draft" ? t("f4DraftHint") : ""}
              {(o.announcedDate ?? o.requestedDate) ? ` · ${t("f4DueOn").replace("{d}", dmy(o.announcedDate ?? o.requestedDate))}` : ""}
              {o.reason ? ` · ${reasonText(o.reason)}` : ""} · {(o.recipients.to ?? []).join(", ")}
            </div>
            {(o.status === "send_failed" || (o.status === "sending" && o.lastError)) && <div className="err" style={{ fontSize: 12 }}>{t("f4FailedHint").replace("{e}", o.lastError ?? "")} · {t("f4Attempts").replace("{n}", String(o.attempts))}</div>}
            <ul style={{ margin: "6px 0", paddingLeft: 18, fontSize: 13 }}>{o.lines.map((l) => <li key={l.id} style={l.cancelled ? { textDecoration: "line-through", color: "#8A93A5" } : undefined}>{l.designation} × {l.qty}{l.oem ? <span className="muted"> · OEM {l.oem}</span> : null}</li>)}</ul>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button className="chip" style={{ minHeight: 40 }} onClick={() => void downloadOrderPdf(o)}>📄 {t("f4Pdf")}</button>
              {may && (o.status === "draft" || o.status === "send_failed") && <button className="chip on" style={{ minHeight: 40 }} disabled={!!busy} onClick={() => void run(o.id, () => orderAction(o.id, "send"))}>{o.status === "draft" ? t("f4Send") : t("f4Retry")}</button>}
              {may && ["sent", "confirmed", "delivered"].includes(o.status) && (o.kind === "main" || o.kind === "complement") && <button className="chip" style={{ minHeight: 40 }} disabled={!!busy} onClick={() => void run(o.id, () => orderAction(o.id, "resend"))}>✉ {t("f4Resend")}</button>}
              {may && o.status === "sent" && (o.kind === "main" || o.kind === "complement") && (
                <>
                  <button className="chip on" style={{ minHeight: 40 }} onClick={() => setDlg({ t: "confirm", o })}>✓ {t("f4Confirm")}</button>
                  <button className="chip" style={{ minHeight: 40 }} onClick={() => setDlg({ t: "modify", o })}>✎ {t("f4Modify")}</button>
                </>
              )}
              {may && (o.status === "draft" || o.status === "sent") && (o.kind === "main" || o.kind === "complement") && <button className="chip" style={{ minHeight: 40, color: "#8F1D14" }} onClick={() => setDlg({ t: "cancel", o })}>✕ {t("f4CancelBtn")}</button>}
            </div>
          </article>
        ))}
      </div>
      {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
      {dlg?.t === "review" && <ReviewDialog v={v} kind="main" onClose={() => setDlg(null)} onDone={closeAnd} />}
      {dlg?.t === "more" && <ReviewDialog v={v} kind="complement" onClose={() => setDlg(null)} onDone={closeAnd} />}
      {dlg?.t === "approval" && <ApprovalDialog v={v} onClose={() => setDlg(null)} onDone={closeAnd} />}
      {dlg?.t === "confirm" && <ConfirmDialog o={dlg.o} onClose={() => setDlg(null)} onDone={closeAnd} />}
      {dlg?.t === "modify" && <ModifyDialog v={v} o={dlg.o} onClose={() => setDlg(null)} onDone={closeAnd} />}
      {dlg?.t === "cancel" && <CancelDialog o={dlg.o} onClose={() => setDlg(null)} onDone={closeAnd} />}
    </section>
  );
}

/** D28: the insurer approved the repair; optionally the parts order leaves at once (the car is already here) */
function ApprovalDialog({ v, onClose, onDone }: { v: LocalVehicle; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(""), [now, setNow] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const n = partsOfVehicle(v as { parts?: never }).filter((p) => p.status === "to_order" && !p.orderId && p.source !== "migrated");
  return (
    <Dialog title={t("f4RecordApproval")} onClose={onClose}>
      <Field label={t("f4ApprovalNote")}><input className="inp" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
      <label style={{ display: "flex", gap: 10, alignItems: "center", margin: "6px 0" }}><input type="checkbox" style={{ width: 24, height: 24 }} checked={now} onChange={(e) => setNow(e.target.checked)} /> {t("f4SendNow")} ({n.length})</label>
      {now && <ul style={{ margin: "4px 0", paddingLeft: 18, fontSize: 13 }}>{n.map((p) => <li key={p.id}>{p.name} × {p.qty}</li>)}</ul>}
      <div className="muted" style={{ fontSize: 12 }}>{t("f4ApprovalHint")}</div>
      {err && <div className="err">{err}</div>}
      <button className="pbtn" disabled={busy} onClick={async () => { setBusy(true); try { await recordApproval(v.id, { note: note.trim() || undefined, sendOrderNow: now }); toast(t("f4Saved")); onDone(); } catch (e) { setErr(errText(e)); setBusy(false); } }}>✓ {t("save")}</button>
    </Dialog>
  );
}

/** D33 (main order) / D36 (more parts, reason required): choose the parts, see where it goes, preview the PDF and the e-mail, send or keep as a draft */
function ReviewDialog({ v, kind, onClose, onDone }: { v: LocalVehicle; kind: "main" | "complement"; onClose: () => void; onDone: () => void }) {
  const toOrder = partsOfVehicle(v as { parts?: never }).filter((p) => p.status === "to_order" && !p.orderId);
  const [sel, setSel] = useState<string[]>(toOrder.filter((p) => p.source !== "migrated").map((p) => p.id));
  const [reason, setReason] = useState<string>("forgotten"), [other, setOther] = useState("");
  const [date, setDate] = useState(""), [obs, setObs] = useState("");
  const [pv, setPv] = useState<OrderPreview | null>(null), [showMail, setShowMail] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const body = useMemo(() => ({ partIds: sel, kind, ...(kind === "complement" ? { reason } : {}), ...(date ? { requestedDate: date } : {}), observations: obs }), [sel, kind, reason, date, obs]);
  useEffect(() => {
    if (!sel.length) { setPv(null); return; }
    let live = true;
    const h = setTimeout(() => { previewOrder(v.id, body).then((p) => { if (live) { setPv(p); setErr(""); if (!date) setDate(p.requestedDate); } }).catch((e) => live && setErr(errText(e))); }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [body]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const submit = async (send: boolean) => {
    setBusy(true); setErr("");
    try {
      const r = await createOrderApi(v.id, { ...body, ...(kind === "complement" && reason === "other" && other.trim() ? { reasonText: other.trim() } : {}), send });
      toast(`${r.number} · ${r.status === "sent" ? t("f4St_sent") : r.status === "draft" ? t("f4St_draft") : r.status === "sending" ? t("f4St_sending") : r.status}`, 5000);
      onDone();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  const ok = sel.length > 0 && (kind === "main" || !!reason) && !busy;
  return (
    <Dialog title={kind === "main" ? t("f4ReviewTitle") : t("f4MoreTitle")} onClose={onClose}>
      <ul style={{ listStyle: "none", margin: "4px 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {toOrder.map((p) => (
          <li key={p.id}><label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 40 }}><input type="checkbox" style={{ width: 24, height: 24, minHeight: 0 }} checked={sel.includes(p.id)} onChange={() => toggle(p.id)} /> <span>{p.name} × {p.qty}{p.oemRef ? <span className="muted"> · OEM {p.oemRef}</span> : null}{p.source === "migrated" ? <span className="muted"> · {t("f2PartsFree")}</span> : null}</span></label></li>
        ))}
      </ul>
      {kind === "complement" && (
        <Field label={`${t("f4Reason")} *`}>
          <select className="inp" value={reason} onChange={(e) => setReason(e.target.value)}>{["forgotten", "wrong_ref", "damaged", "damaged_during_repair", "other"].map((r) => <option key={r} value={r}>{t(`f4R_${r}` as never)}</option>)}</select>
          {reason === "other" && <input className="inp" style={{ marginTop: 6 }} placeholder={t("f4OtherText")} value={other} maxLength={250} onChange={(e) => setOther(e.target.value)} />}
        </Field>
      )}
      <Field label={t("f4WantedDate")}><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={t("f4Observations")}><textarea className="inp" rows={2} value={obs} maxLength={1000} onChange={(e) => setObs(e.target.value)} /></Field>
      {pv && (
        <div style={{ background: "#F5F8FD", border: "1px solid #D6E2F8", borderRadius: 10, padding: "8px 10px", fontSize: 13, margin: "6px 0" }}>
          <b>{t("f4Recipients")}</b>: {pv.to.join(", ")}{pv.cc.length ? ` · Cc ${pv.cc.join(", ")}` : ""}{pv.replyTo ? ` · Reply-To ${pv.replyTo}` : ""}
          {showMail && <div style={{ marginTop: 6 }}><b>{pv.subject}</b><div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{pv.text}</div></div>}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button className="chip" style={{ minHeight: 44 }} disabled={!pv} onClick={() => pv && openPdfBase64(pv.pdf)}>📄 {t("f4PreviewPdf")}</button>
        <button className="chip" style={{ minHeight: 44 }} disabled={!pv} onClick={() => setShowMail((x) => !x)}>✉ {t("f4PreviewMail")}</button>
      </div>
      {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="pbtn sec" style={{ flex: "0 0 38%" }} disabled={!ok} onClick={() => void submit(false)}>{t("f4SaveDraft")}</button>
        <button className="pbtn" style={{ flex: 1 }} disabled={!ok} onClick={() => void submit(true)}>✉ {t("f4Send")}</button>
      </div>
    </Dialog>
  );
}

/** D38: the body shop confirmed (by phone / e-mail): the date they announced */
function ConfirmDialog({ o, onClose, onDone }: { o: OrderView; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(o.requestedDate ?? ""), [note, setNote] = useState(""), [err, setErr] = useState("");
  return (
    <Dialog title={`${t("f4ConfirmTitle")} · ${o.number}`} onClose={onClose}>
      <Field label={t("f4Announced")}><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={t("f4Note")}><input className="inp" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <div className="err">{err}</div>}
      <button className="pbtn" onClick={async () => { try { await orderAction(o.id, "confirm", { announced: date || null, note: note.trim() || undefined }); onDone(); } catch (e) { setErr(errText(e)); } }}>✓ {t("f4Confirm")}</button>
    </Dialog>
  );
}

/** D37 (modify): new quantities and parts added to an order that was sent and is not confirmed yet */
function ModifyDialog({ v, o, onClose, onDone }: { v: LocalVehicle; o: OrderView; onClose: () => void; onDone: () => void }) {
  const live = o.lines.filter((l) => !l.cancelled);
  const [qty, setQty] = useState<Record<string, number>>(Object.fromEntries(live.map((l) => [l.id, l.qty])));
  const free = partsOfVehicle(v as { parts?: never }).filter((p) => p.status === "to_order" && !p.orderId);
  const [add, setAdd] = useState<string[]>([]), [reason, setReason] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const changed = Object.fromEntries(live.filter((l) => qty[l.id] !== l.qty).map((l) => [l.id, qty[l.id]]));
  const ok = (Object.keys(changed).length > 0 || add.length > 0) && !!reason.trim() && !busy;
  return (
    <Dialog title={`${t("f4ModifyTitle")} · ${o.number}`} onClose={onClose}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t("f4ModifyHint")}</div>
      {live.map((l) => (
        <div key={l.id} className="row" style={{ marginBottom: 6 }}><span style={{ flex: 1 }}>{l.designation}</span>
          <input className="inp" type="number" min={1} max={99} style={{ width: 74 }} value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} /></div>
      ))}
      {free.length > 0 && <Field label={t("f4AddParts")}>{free.map((p) => <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 36 }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={add.includes(p.id)} onChange={() => setAdd((a) => (a.includes(p.id) ? a.filter((x) => x !== p.id) : [...a, p.id]))} /> {p.name} × {p.qty}</label>)}</Field>}
      <Field label={`${t("f4Reason")} *`}><input className="inp" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
      {err && <div className="err">{err}</div>}
      <button className="pbtn" disabled={!ok} onClick={async () => { setBusy(true); try { await orderAction(o.id, "modify", { qty: changed, addPartIds: add, reason: reason.trim() }); onDone(); } catch (e) { setErr(errText(e)); setBusy(false); } }}>✉ {t("f4Apply")}</button>
    </Dialog>
  );
}

/** D37 (cancel): some lines or the whole order while it is not confirmed */
function CancelDialog({ o, onClose, onDone }: { o: OrderView; onClose: () => void; onDone: () => void }) {
  const live = o.lines.filter((l) => !l.cancelled);
  const [sel, setSel] = useState<string[]>(live.map((l) => l.id)), [reason, setReason] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  return (
    <Dialog title={`${t("f4CancelTitle")} · ${o.number}`} onClose={onClose}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t("f4CancelHint")}</div>
      {live.map((l) => <label key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 38 }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={sel.includes(l.id)} onChange={() => setSel((s) => (s.includes(l.id) ? s.filter((x) => x !== l.id) : [...s, l.id]))} /> {l.designation} × {l.qty}</label>)}
      <Field label={`${t("f4Reason")} *`}><input className="inp" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
      {err && <div className="err">{err}</div>}
      <button className="pbtn danger" disabled={!sel.length || !reason.trim() || busy} onClick={async () => { setBusy(true); try { await orderAction(o.id, "cancel", { lineIds: sel.length === live.length ? undefined : sel, reason: reason.trim() }); onDone(); } catch (e) { setErr(errText(e)); setBusy(false); } }}>✕ {sel.length === live.length ? t("f4CancelWhole") : t("f4CancelBtn")}</button>
    </Dialog>
  );
}

/** R14: every order of the organisation (in the user's scope): number, car, body shop, type, status, sent, delivery, late. Filters and search. */
export function OrdersList({ stationId }: { stationId: string }) {
  const f = useField();
  const [rows, setRows] = useState<OrderView[] | null>(null);
  const [status, setStatus] = useState(""), [body, setBody] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [q, setQ] = useState(""), [late, setLate] = useState(false);
  const [err, setErr] = useState("");
  const stamp = f.status.lastSyncAt ?? 0;
  useEffect(() => {
    const p = new URLSearchParams(); if (status) p.set("status", status); if (body) p.set("bodyshop", body); if (from) p.set("from", from); if (to) p.set("to", to); if (q.trim()) p.set("q", q.trim());
    const h = setTimeout(() => { api<OrderView[]>("GET", `/parts/orders?${p.toString()}`).then((r) => { setRows(r); setErr(""); }).catch((e) => { setRows([]); setErr(errText(e)); }); }, 200);
    return () => clearTimeout(h);
  }, [status, body, from, to, q, stamp]);
  const shown = (rows ?? []).filter((o) => !late || o.late);
  const bodies = [...new Map((rows ?? []).map((o) => [o.bodyShopId, o.bodyShop])).entries()];
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("f4OrdersSearch")} aria-label={t("f4OrdersSearch")} style={{ flex: "1 1 220px" }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("f3Status")}><option value="">{t("f3AllStatus")}</option>{["draft", "sending", "sent", "confirmed", "delivered", "send_failed", "cancelled"].map((s) => <option key={s} value={s}>{statusText(s)}</option>)}</select>
        <select value={body} onChange={(e) => setBody(e.target.value)} aria-label={t("f4FilterBody")}><option value="">{t("f4FilterAllBody")}</option>{bodies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <label className="muted" style={{ fontSize: 12 }}>{t("f4FilterFrom")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="muted" style={{ fontSize: 12 }}>{t("f4FilterTo")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className={"chip" + (late ? " on" : "")} aria-pressed={late} onClick={() => setLate(!late)}>⏰ {t("f4OnlyLate")}</button>
      </div>
      {err && <div className="err">{err}</div>}
      <table>
        <thead><tr><th>{t("f4ColNumber")}</th><th>{t("f3Plate")}</th><th>{t("f4FilterBody")}</th><th>{t("f4ColType")}</th><th>{t("f4ColStatus")}</th><th>{t("f4ColSent")}</th><th>{t("f4ColDelivery")}</th></tr></thead>
        <tbody>{shown.map((o) => (
          <tr key={o.id}>
            <td><b>{o.number}</b></td>
            <td><button className="linkbtn" onClick={() => go({ page: "repair", id: o.vehicleId, tab: "teile", stationId: o.stationId || stationId })}>{o.plate || "—"}</button><div className="muted" style={{ fontSize: 12 }}>{o.claim}</div></td>
            <td>{o.bodyShop}</td><td>{kindText(o.kind)}{o.reason ? <div className="muted" style={{ fontSize: 12 }}>{reasonText(o.reason)}</div> : null}</td>
            <td><OrderPill s={o.status} />{o.late && <span className="badge" style={{ background: "#FBE7E4", color: "#9B2C1F", marginLeft: 4 }}>⏰</span>}</td>
            <td>{o.sentAt ? dmy(o.sentAt) : "—"}</td><td>{dmy(o.announcedDate ?? o.requestedDate)}</td>
          </tr>
        ))}</tbody>
      </table>
      {rows && !shown.length && <p className="muted">{t("f4NoOrders")}</p>}
    </div>
  );
}

export { PART_RETURN_REASONS };
