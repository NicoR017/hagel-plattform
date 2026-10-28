import { useCallback, useEffect, useMemo, useState } from "react";
import { computeShares } from "@hagel/calc";
import { eur } from "@hagel/documents";
import { api } from "../api";
import { t } from "../i18n";
import type { Key } from "../i18n";
import type { LocalVehicle } from "../sync/db";
import { assignVehicle, cancelBooking, setRepairStage, setShares } from "../sync/mutations";
import { dayLabel, todayIn, tzOfCountry } from "../field/calendar";
import { UNDO_MS } from "../field/Dialogs";
import { go } from "../field/route";
import { useField, useVehicles } from "../field/store";
import { toast } from "../field/toast";
import { Dialog, Field, confirmDialog } from "../field/ui";
import { REPAIR_STAGES, arrivedToday, blockerKey, boardOf, dropOffDue, moveCheck, neighbour, stageOf, todosOpen, type RepairStage } from "./boardLogic";
import { HandoverDialog } from "./HandoverDialog";
import { holdLabel } from "./listActions";
import { BodyshopPick } from "./BodyshopPick";

export const stageLabel = (s: string) => t(`v5Stage_${s}` as Key);
/** "Finish is not possible: …" in words */
export function blockersText(codes: string[]): string {
  return codes.map((c) => (c.startsWith("photos:") ? `${t("v5BlkPhoto")} ${stageLabel(c.slice(7))}` : t(blockerKey(c) as Key))).join(", ");
}

interface PlannedRow { id: string; vehicleId: string; date: string; time: string; plate: string }
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Strip above the board: the repair appointments of the next weeks (cancel / reschedule) and how full today is. */
function Planned({ stationId }: { stationId: string }) {
  const f = useField();
  const st = f.refs?.stations.find((s) => s.id === stationId);
  const vehicles = useVehicles();
  const today = todayIn(tzOfCountry(st?.country ?? "DE"));
  const [rows, setRows] = useState<PlannedRow[]>([]);
  const [todayN, setTodayN] = useState<number | null>(null);
  const stamp = f.status.lastSyncAt ?? 0;
  const load = useCallback(async () => {
    try {
      const r = await api<{ days: Record<string, { booked: number; bookings?: { id: string; vehicleId: string; plate: string; time: string; status: string }[] }> }>("GET", `/stations/${stationId}/booking-calendar?from=${today}&to=${addDays(today, 90)}`);
      setTodayN(r.days[today]?.booked ?? 0);
      setRows(Object.entries(r.days).flatMap(([date, d]) => (d.bookings ?? []).filter((b) => b.status === "booked" && date > today).map((b) => ({ id: b.id, vehicleId: b.vehicleId, date, time: b.time, plate: b.plate }))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
    } catch { setRows([]); setTodayN(null); }
  }, [stationId, today]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load, stamp]);
  const cap = st?.repairsPerDay ?? 3;
  const may = f.can("termine.buchen");
  return (
    <section className="panel" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }} aria-label={t("v5Planned")}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "6px 12px", alignItems: "baseline" }}>
        <b style={{ color: "#14233B" }}>{t("v5Planned")}</b>
        {todayN !== null && <span className="muted" style={{ fontSize: 12 }}>{t("v5TodayBooked")}: {todayN} / {cap} {t("v5Repairs")}</span>}
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
        {rows.map((r) => {
          const v = vehicles.find((x) => x.id === r.vehicleId);
          return (
            <div key={r.id} style={{ flex: "0 0 auto", minWidth: 220, display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderRadius: 10, background: "#F5F8FD", border: "1px solid #D6E2F8" }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b style={{ color: "#1D4FB8", fontSize: 13 }}>{dayLabel(r.date, today, "de-DE")} · {r.time}</b><b style={{ color: "#14233B" }}>{r.plate}</b></span>
              <span className="muted" style={{ fontSize: 12 }}>{[v?.modell, f.refs?.insurers.find((i) => i.id === v?.insurerId)?.name].filter(Boolean).join(" · ")}</span>
              {may && (
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="chip" style={{ minHeight: 36, padding: "4px 10px" }} onClick={() => go({ page: "vehicle", id: r.vehicleId, tab: "termin", ctx: { stationId, mode: "kalk" } })}>{t("v4Move")}</button>
                  <button className="chip" style={{ minHeight: 36, padding: "4px 10px", color: "#8F1D14" }} onClick={() => { if (confirmDialog(t("v4CancelQ"))) { void cancelBooking(f.mut, r.vehicleId, r.id).then(() => f.engine.syncNow(f.orgId)).then(load); } }}>{t("v4Cancel")}</button>
                </span>
              )}
            </div>
          );
        })}
        {!rows.length && <span className="muted" style={{ fontSize: 12 }}>{t("v5NoPlanned")}</span>}
      </div>
    </section>
  );
}

/** "+ Fahrzeug in Reparatur": only assessed cars of the station; the technician and the headliner are picked afterwards in the car's overview. */
function AddToRepair({ stationId, onClose, onAdded }: { stationId: string; onClose: () => void; onAdded: (id: string) => void }) {
  const f = useField();
  const all = useVehicles();
  const cands = all.filter((v) => v.stationId === stationId && v.repairStage == null && (v.statut === "besichtigung" || (v.statut === "attente" && String(v.statutMotif ?? "").toLowerCase() !== "teile")) && f.calcOf(v).netto > 0);
  const [pick, setPick] = useState<string | null>(null);
  const v = cands.find((x) => x.id === (pick ?? cands[0]?.id));
  const apply = async () => {
    if (!v) return;
    await setRepairStage(f.mut, v.id, "bereit");
    toast(`${String((v as Record<string, unknown>).kennzeichen || "")} → ${stageLabel("bereit")}`);
    onClose();
    onAdded(v.id); // the customer signs the drop-off now (D17); "Later" leaves the button on the card
  };
  return (
    <Dialog title={t("v5AddTitle")} onClose={onClose}>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{t("v5AddHint")}</div>
      {!cands.length && <div className="empty">{t("v5NoCandidates")}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
        {cands.map((c) => {
          const on = c.id === v?.id, x = c as Record<string, unknown>;
          return (
            <button key={c.id} onClick={() => setPick(c.id)} aria-pressed={on} style={{ font: "inherit", textAlign: "left", display: "flex", justifyContent: "space-between", gap: 12, padding: 12, minHeight: 44, borderRadius: 10, border: `2px solid ${on ? "#1D4FB8" : "#DDE2EA"}`, background: on ? "#E3ECFD" : "#fff", color: "#1A2433", cursor: "pointer" }}>
              <span><b>{String(x.kennzeichen || "—")}</b><br /><span className="muted" style={{ fontSize: 12 }}>{[x.modell, f.refs?.insurers.find((i) => i.id === c.insurerId)?.name, c.statut === "attente" ? holdLabel(c) : ""].filter(Boolean).join(" · ")}</span></span>
              {f.can("prix.voir") && <b>{eur(f.calcOf(c).netto)}</b>}
            </button>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{t("v5TechInOverview")}</div>
      <button className="pbtn" disabled={!v} onClick={() => void apply()}>{t("v5AddConfirm")}</button>
    </Dialog>
  );
}

/** Kanban: Bereit · Demontage · PDR · Remontage · At Bodyshop · Finish. Drag and drop, or ‹ › on the card (phones). */
export function RepairBoard({ stationId }: { stationId: string }) {
  const f = useField();
  const all = useVehicles();
  const st = f.refs?.stations.find((s) => s.id === stationId);
  const today = todayIn(tzOfCountry(st?.country ?? "DE"));
  const cols = useMemo(() => boardOf(all, stationId), [all, stationId]);
  const [add, setAdd] = useState(false);
  const [sign, setSign] = useState<{ id: string; kind: "drop_off" | "pick_up" } | null>(null);
  const mayHandover = f.can("vehicules.changer_statut") && !f.refs?.me.fieldView; // technician / headliner never handle customer data
  const [over, setOver] = useState<RepairStage | null>(null);
  const may = f.can("reparatur.board");
  const people = f.refs?.people ?? [];

  const move = async (v: LocalVehicle, to: RepairStage) => {
    const from = stageOf(v), plate = String((v as Record<string, unknown>).kennzeichen || "");
    if (from === to) return;
    const chk = moveCheck(v, to);
    if (!chk.ok) { toast(`${plate}: ${t("v5FinishNo")} – ${blockersText(chk.reasons)}`, 8000); return; }
    await setRepairStage(f.mut, v.id, to);
    toast(`${plate} → ${stageLabel(to)}`, UNDO_MS, { label: t("v3Undo"), run: async () => { await setRepairStage(f.mut, v.id, from); toast(t("v3Undone")); } });
  };
  const techOf = (v: LocalVehicle) => String((v as Record<string, unknown>).techName || v.assigneeIds.map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(", ") || "");

  return (
    <>
      <Planned stationId={stationId} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <p className="muted" style={{ margin: 0, fontSize: 13, flex: "1 1 320px" }}>{t("v5BoardHint")}</p>
        {may && f.can("vehicules.changer_statut") && <button className="btn primary" onClick={() => setAdd(true)}>{t("v5Add")}</button>}
      </div>
      <div className="board" role="list">
        {REPAIR_STAGES.map((stage) => (
          <section key={stage} className={"col" + (stage === "finish" ? " fin" : "") + (over === stage ? " over" : "")} aria-label={stageLabel(stage)}
            onDragOver={(e) => { e.preventDefault(); setOver(stage); }} onDragLeave={() => setOver((o) => (o === stage ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); const v = all.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (v && may) void move(v, stage); }}>
            <div className="colhd"><b>{stageLabel(stage)}</b><span>{cols[stage].length}</span></div>
            {cols[stage].map((v) => {
              const x = v as Record<string, unknown>, open = todosOpen(v), prev = neighbour(stage, -1), next = neighbour(stage, 1);
              return (
                <div key={v.id} className="card3" draggable={may} onDragStart={(e) => { e.dataTransfer.setData("text/plain", v.id); e.dataTransfer.effectAllowed = "move"; }}>
                  <button className="open" onClick={() => go({ page: "repair", id: v.id, tab: "uebersicht", stationId })}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                      <b style={{ fontSize: 16, color: "#14233B" }}>{String(x.kennzeichen || "—")}</b>
                      {v.statut === "attente" && <span className="badge" style={{ background: "#FDF0E1", color: "#8A4A06", fontSize: 11 }}>{holdLabel(v)}</span>}
                    </span>
                    {arrivedToday(v, today) && <span className="badge" style={{ background: "#E3ECFD", color: "#1D4FB8", fontSize: 11, alignSelf: "flex-start" }}>{t("v5TerminToday")}</span>}
                    <span style={{ fontSize: 12 }}>📍 {st?.name}{v.clientStationId && v.clientStationId !== v.stationId ? <span className="muted"> · 🏢 {f.refs?.stations.find((s) => s.id === v.clientStationId)?.name ?? String(x.kunde || "")}</span> : null}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{[f.refs?.insurers.find((i) => i.id === v.insurerId)?.name, x.modell].filter(Boolean).join(" · ")}</span>
                    {!!(v.colibriSource?.businessCustomer || x.kunde) && <span className="bcline" title={t("v5BcLink")}>🔗 {v.colibriSource?.businessCustomer || String(x.kunde)}</span>}
                    {(!!techOf(v) || !!x.demTechName) && <span className="muted" style={{ fontSize: 11 }}>{techOf(v) ? `PDR ${techOf(v)}` : ""}{x.demTechName ? ` · Headliner ${String(x.demTechName)}` : ""}</span>}
                  </button>
                  {stage === "bodyshop" && <BodyshopPick v={v} disabled={!may} compact />}
                  {dropOffDue(v) && (stage === "bereit" && mayHandover
                    ? <button className="chip" style={{ minHeight: 40, maxWidth: "100%", whiteSpace: "normal", textAlign: "left", background: "#FDF0E1", color: "#8A4A06", borderColor: "#E9C79A", fontWeight: 700 }} onClick={() => setSign({ id: v.id, kind: "drop_off" })}>{t("hoToSign")}</button>
                    : <span className="muted" style={{ fontSize: 11 }}>{t("hoNotSigned")}</span>)}
                  {stage === "finish" && mayHandover && v.statut !== "rendu" && (
                    <button className="chip" style={{ minHeight: 40, maxWidth: "100%", whiteSpace: "normal", fontWeight: 700 }} onClick={() => setSign({ id: v.id, kind: "pick_up" })}>{t("hoReturn")}</button>
                  )}
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span className="badge" style={{ background: open ? "#FBF1D9" : "#E3F4EA", color: open ? "#7A5300" : "#17663F", fontSize: 11 }}>{open ? `${t("v5Todo")}: ${open} ${t("v3Open")}` : `${t("v5Todo")} ✓`}</span>
                    {may && (
                      <span style={{ display: "flex", gap: 4 }}>
                        <button className="mv" disabled={!prev} aria-label={`${String(x.kennzeichen)} ${t("v5OneBack")}`} onClick={() => prev && void move(v, prev)}>‹</button>
                        <button className="mv" disabled={!next} aria-label={`${String(x.kennzeichen)} ${t("v5OneForward")}`} onClick={() => next && void move(v, next)}>›</button>
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            {!cols[stage].length && <span className="muted dropzone">{t("v5DropHere")}</span>}
          </section>
        ))}
      </div>
      {add && <AddToRepair stationId={stationId} onClose={() => setAdd(false)} onAdded={(id) => { if (mayHandover) setSign({ id, kind: "drop_off" }); }} />}
      {sign && (() => { const sv = all.find((x) => x.id === sign.id); return sv ? <HandoverDialog v={sv} kind={sign.kind} onClose={() => setSign(null)} /> : null; })()}
    </>
  );
}

