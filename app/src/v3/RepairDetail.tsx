import { useRef, useState } from "react";
import { computeShares } from "@hagel/calc";
import { eur, num } from "@hagel/documents";
import { api, ApiError } from "../api";
import { fmtDateTime, t } from "../i18n";
import type { Key } from "../i18n";
import type { LocalPhoto, LocalVehicle } from "../sync/db";
import { addPhoto, addTodo, deleteTodo, setCheck, setRepairStage, tagPhoto, toggleTodo } from "../sync/mutations";
import { downscale } from "../field/images";
import { Lightbox } from "../field/Lightbox";
import { BodyshopPick } from "./BodyshopPick";
import { SharesBox } from "../field/Kva";
import { go, RTABS, type RTab } from "../field/route";
import { useField, usePhotos, usePhotoUrl, useVehicle } from "../field/store";
import { toast } from "../field/toast";
import { HandoverDialog, downloadReceipt, signedOn, useHandovers } from "./HandoverDialog";
import { statusLabel } from "../field/Dialogs";
import { REPAIR_STAGES, neighbour, stageIndex, stageOf, todosOpen, type RepairStage } from "./boardLogic";
import { blockersText, stageLabel } from "./RepairBoard";
import { Verlauf } from "./VehicleDetail";

type Repair = NonNullable<LocalVehicle["repair"]> & {
  todos: { id: string; text: string; source: string; done: boolean; doneBy: string | null; doneAt: string | null }[];
  checks: Record<string, { by: string | null; at: string } | null>;
  finishBlockers: string[]; lastReport?: { status: string; at: string; auto: boolean } | null;
};
const dm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const TAB_LABEL: Record<RTab, Key> = { uebersicht: "v5TabOverview", fotos: "v5TabPhotos", abschluss: "v5TabClosing", verlauf: "v4SecHistory" };

function Thumb({ p, onOpen }: { p: LocalPhoto; onOpen: () => void }) {
  const url = usePhotoUrl(p);
  const f = useField();
  const people = f.refs?.people ?? [];
  const who = p.takenByName || people.find((x) => x.id === p.takenBy)?.name || "";
  // automatic name: stage · role · person · time
  const name = [p.repairStage ? stageLabel(p.repairStage) : t("ph.reparatur"), p.role, who, dm(p.takenAt)].filter(Boolean).join(" · ");
  return (
    <figure>
      {url ? <img src={url} alt={name} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }} /> : <div style={{ aspectRatio: "4/3", display: "flex", alignItems: "center", justifyContent: "center", color: "#aab3c0" }}>🖼</div>}
      <figcaption>{name}</figcaption>
    </figure>
  );
}

/**
 * Detail of a car on the repair board: Übersicht (to-dos first, team and shares by permission, time), Fotos (named stage · role · person · time,
 * grouped by stage), Abschluss (checks, Finish, repair report), Verlauf.
 */
export function RepairDetail({ id, tab, stationId }: { id: string; tab: RTab; stationId: string }) {
  const f = useField();
  const v = useVehicle(id);
  const photos = usePhotos(id);
  const [draft, setDraft] = useState("");
  const [lb, setLb] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const cam = useRef<HTMLInputElement>(null), gal = useRef<HTMLInputElement>(null);
  const [sign, setSign] = useState<"drop_off" | "pick_up" | null>(null);
  // customer data: station staff only (technician / headliner never), read online from the server
  const mayHandover = f.can("vehicules.changer_statut") && !f.refs?.me.fieldView;
  const hv = v ? (v as Record<string, unknown>) : {};
  const ho = useHandovers(id, mayHandover && !!v, `${String(hv.dropOffSignedAt ?? "")}|${String(hv.pickUpSignedAt ?? "")}`);
  if (v === undefined) return <main><p className="muted">{t("loading")}</p></main>;
  if (v === null) return <main><div className="empty">{t("vehicleNotFoundHint")}</div></main>;

  const x = v as Record<string, unknown>;
  const rep = (v.repair ?? { todos: [], checks: {}, finishBlockers: [] }) as Repair;
  const stage = stageOf(v);
  const may = f.can("reparatur.board"), chief = f.can("reparatur.endabnahme");
  const calc = f.calcOf(v);
  const sh = f.can("repartition_interne.voir") ? computeShares(v as never, calc) : null;
  const mine = (v as Record<string, { techEur?: number; demTechEur?: number }>).myShare;
  const people = f.refs?.people ?? [];
  const names = v.assigneeIds.map((i) => people.find((p) => p.id === i)?.name).filter(Boolean) as string[];
  const open = todosOpen(v);
  const goTab = (tb: RTab) => go({ page: "repair", id, tab: tb, stationId });
  const sinceDays = v.repAt ? Math.max(0, Math.floor((Date.now() - Date.parse(String(v.repAt))) / 86_400_000)) : null;

  /** who am I on this car (printed in the photo name) */
  const meId = f.refs?.me.id;
  const myTech = (f.refs?.technicians ?? []).find((q) => q.userId === meId);
  const role = myTech?.kind === "headliner" ? "Headliner" : v.assigneeIds.includes(meId ?? "") ? "Techniker" : chief ? "Chef de station" : "Team";

  const take = async (files: FileList | null) => {
    if (!files) return;
    for (const file of [...files]) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const pid = await addPhoto(f.mut, { vehicleId: id, blob: await downscale(file), label: "Detail / Delle", phase: "reparatur" });
        await tagPhoto(f.mut, id, pid, stage === "finish" ? "pdr" : stage, role);
      } catch { toast(t("photoFailed")); }
    }
  };
  const finish = async () => {
    if (rep.finishBlockers.length) { toast(`${t("v5FinishNo")} – ${blockersText(rep.finishBlockers)}`, 8000); return; }
    await setRepairStage(f.mut, id, "finish");
  };
  const resend = async () => {
    setBusy(true);
    try {
      const r = await api<{ status: string }>("POST", `/vehicles/${id}/repair-report`);
      toast(r.status === "sent" ? t("v5ReportSent") : r.status === "no_recipients" ? t("noRecipients") : t("v5ReportFailed"), 6000);
    } catch (e) { toast(e instanceof ApiError && e.status === 502 ? t("v5ReportFailed") : (e as Error).message, 6000); }
    await f.engine.syncNow(f.orgId);
    setBusy(false);
  };
  const reportLine = rep.lastReport
    ? `${rep.lastReport.status === "sent" ? "✓ " + t("v5ReportSent") : rep.lastReport.status === "no_recipients" ? "⚠ " + t("noRecipients") : "⚠ " + t("v5ReportFailed")} · ${fmtDateTime(rep.lastReport.at)}${rep.lastReport.auto ? ` · ${t("v5Automatic")}` : ""}`
    : t("v5ReportAuto");

  const prev = neighbour(stage, -1), next = neighbour(stage, 1);
  const byStage = REPAIR_STAGES.map((s) => ({ s, list: photos.filter((p) => (p.repairStage ?? "") === s) })).filter((g) => g.list.length);
  const untagged = photos.filter((p) => !p.repairStage);
  const ordered = [...byStage.flatMap((g) => g.list), ...untagged];
  const manual: { key: "pdr" | "teile" | "chef"; label: string; sub: string; allowed: boolean }[] = [
    { key: "pdr", label: t("v5ChkPdr"), sub: t("technician"), allowed: may },
    { key: "teile", label: t("v5ChkParts"), sub: "Headliner / Techniker", allowed: may },
    { key: "chef", label: t("v5ChkChef"), sub: chief ? t("v5ChkChefYou") : t("v5ChkChefOnly"), allowed: chief },
  ];
  const missingPhotos = rep.finishBlockers.filter((b) => b.startsWith("photos:")).map((b) => stageLabel(b.slice(7)));

  return (
    <>
      <div className="vd-band">
        <div style={{ minWidth: 0 }}>
          <h1>{String(x.kennzeichen || "—")}</h1>
          <div style={{ color: "#B9C4D6", fontSize: 13 }}>{[x.modell, f.refs?.insurers.find((i) => i.id === v.insurerId)?.name, x.claimNumber ? `${t("v3Claim")} ${String(x.claimNumber)}` : ""].filter(Boolean).join(" · ")}</div>
        </div>
        <span className="badge" style={{ background: "#E2F3F6", color: "#0B5F73" }}>{statusLabel(v.statut)}</span>
        <button className="btn" style={{ marginLeft: "auto", background: "transparent", color: "#fff", borderColor: "#4A5E80" }} onClick={() => go({ page: "vehicle", id, tab: "basis", ctx: { stationId, mode: "rep" } })}>{t("v5VehicleData")}</button>
      </div>
      <div className="rd">
        <div className="stages" aria-label={t("v5Stage")}>
          {may && <button className="chip" disabled={!prev} aria-label={t("v5OneBack")} onClick={() => prev && void setRepairStage(f.mut, id, prev)}>‹</button>}
          {REPAIR_STAGES.map((s) => <span key={s} className={s === stage ? "on" : stageIndex(s) < stageIndex(stage) ? "done" : ""}>{stageLabel(s)}</span>)}
          {may && <button className="chip" disabled={!next || next === "finish"} aria-label={t("v5OneForward")} onClick={() => next && next !== "finish" && void setRepairStage(f.mut, id, next)}>›</button>}
        </div>
        <div className="rd-tabs" role="tablist">
          {RTABS.map((tb) => <button key={tb} role="tab" aria-selected={tab === tb} className={tab === tb ? "on" : ""} onClick={() => goTab(tb)}>{t(TAB_LABEL[tb])}{tb === "uebersicht" && open > 0 ? ` (${open})` : ""}{tb === "fotos" && photos.length ? ` (${photos.length})` : ""}</button>)}
        </div>

        {tab === "uebersicht" && (
          <>
            {mayHandover && (
              <section className="panel" style={{ padding: 16 }}>
                <h3 style={{ margin: "0 0 8px" }}>✍ {t("hoBlock")}</h3>
                {(["drop_off", "pick_up"] as const).map((k) => {
                  const cur = ho.rows?.filter((h) => h.kind === k && !h.replaced).at(-1);
                  const at = k === "drop_off" ? hv.dropOffSignedAt : hv.pickUpSignedAt;
                  return (
                    <div key={k} style={{ padding: "8px 0", borderTop: k === "pick_up" ? "1px solid #E4E8EF" : undefined }}>
                      <b>{t(k === "drop_off" ? "hoDropOff" : "hoPickUp")}</b>{" "}
                      {cur ? <span>{cur.customerName} · {signedOn(cur.signedAt)} · {t("hoBy").replace("{user}", cur.signedBy)}</span>
                        : at ? <span>{signedOn(String(at))}</span> : <span className="muted">{t("hoNone")}</span>}
                      {cur && <div className="muted" style={{ fontSize: 12 }}>{cur.mailStatus === "sent" ? `✓ ${t("hoMailSent")}` : cur.mailStatus === "failed" ? `⚠ ${t("hoMailFailed")}` : t("hoMailNone")}{cur.remarks ? ` · ${cur.remarks}` : ""}</div>}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                        {(k === "drop_off" || stage === "finish" || v.statut === "rendu") && <button className="btn" onClick={() => setSign(k)}>{at ? t("hoSignAgain") : t("hoSign")}</button>}
                        {cur?.hasReceipt && <button className="btn" onClick={() => void downloadReceipt(cur.id, `${String(x.kennzeichen || "recibo")}-${k}`)}>📄 {t("hoReceipt")}</button>}
                        {cur && (
                          <button className="btn" disabled={busy} onClick={async () => {
                            setBusy(true);
                            try { await api("POST", `/handovers/${cur.id}/send`, {}); toast(t("hoResent"), 5000); ho.reload(); } catch (e) { toast((e as Error).message, 6000); }
                            setBusy(false);
                          }}>✉ {t("hoResend")}</button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!ho.rows && <p className="muted" style={{ fontSize: 12 }}>{t("hoDetailsOnline")}</p>}
              </section>
            )}
            <section className="panel" style={{ padding: 16 }}>
              <h3 style={{ margin: "0 0 8px" }}>📍 {t("v5Origin")}</h3>
              <dl className="origin">
                <dt>{t("v5BcLink")}</dt><dd>{v.colibriSource?.businessCustomer || "—"}</dd>
                <dt>{t("v5Insurer")}</dt><dd>{f.refs?.insurers.find((i) => i.id === v.insurerId)?.name || "—"}</dd>
                <dt>{t("v5Customer")}</dt><dd>{f.refs?.stations.find((s) => s.id === v.clientStationId)?.name || String(x.kunde || "—")}</dd>
                <dt>{t("v5Standing")}</dt><dd>{(() => { const s = f.refs?.stations.find((z) => z.id === v.stationId); return s ? `${s.name} (${t(s.type as Key)})` : "—"; })()}</dd>
                <dt>{t("v5ColibriSite")}</dt><dd>{v.colibriSource ? [v.colibriSource.location, v.colibriSource.tenant].filter(Boolean).join(" · ") || "—" : t("v5NotFromScan")}</dd>
                {!!x.claimNumber && <><dt>{t("v5Claim")}</dt><dd>{String(x.claimNumber)}</dd></>}
              </dl>
            </section>
            <section className="panel" style={{ padding: 16 }}>
              <h3 style={{ margin: "0 0 4px" }}>✅ {t("v5Todos")}</h3>
              {!rep.todos.length && <p className="muted">{t("v5NoTodos")}</p>}
              {rep.todos.map((td) => (
                <div key={td.id} className={"todo" + (td.done ? " done" : "")}>
                  <input type="checkbox" checked={td.done} disabled={!may} aria-label={td.text} onChange={(e) => void toggleTodo(f.mut, id, td.id, e.target.checked)} />
                  <span style={{ flex: 1 }}>
                    <span className="tx">{td.source === "part" && <b style={{ color: "#8A4A06" }}>{t("v5Part")}: </b>}{td.text}</span>
                    {td.done && <span className="muted" style={{ display: "block", fontSize: 12 }}>{t("v5DoneBy")} {td.doneBy ?? ""} · {dm(td.doneAt)}</span>}
                  </span>
                  <span className="badge" style={td.done ? { background: "#E3F4EA", color: "#17663F" } : { background: "#FBF1D9", color: "#7A5300" }}>{td.done ? t("v5Done") : t("v5ToDo")}</span>
                  {may && <button className="chip" style={{ minHeight: 36 }} aria-label={t("delete")} onClick={() => void deleteTodo(f.mut, id, td.id)}>✕</button>}
                </div>
              ))}
              {may && (
                <form style={{ display: "flex", gap: 8, marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { void addTodo(f.mut, id, draft); setDraft(""); } }}>
                  <input className="inp" style={{ flex: 1 }} value={draft} maxLength={200} placeholder={t("v5TodoPh")} onChange={(e) => setDraft(e.target.value)} aria-label={t("v5Todos")} />
                  <button className="btn primary" type="submit" disabled={!draft.trim()}>{t("v4Add")}</button>
                </form>
              )}
            </section>
            {(stage === "bodyshop" || v.bodyshopId) && (
              <section className="panel" style={{ padding: 16 }}>
                <h3 style={{ margin: "0 0 8px" }}>🏭 {t("v5Bodyshop")}</h3>
                <BodyshopPick v={v} disabled={!may} />
              </section>
            )}
            <section className="panel" style={{ padding: 16 }}>
              <h3 style={{ margin: "0 0 8px" }}>🧑‍🔧 {t("v5Team")}</h3>
              <div>{names.length ? names.join(", ") : String(x.techName || "") || <span className="muted">{t("v4NobodyAssigned")}</span>}{x.demTechName ? ` · Headliner ${String(x.demTechName)}` : ""}</div>
              {/* who works on it and their share: pick the technician and the headliner here, and change a share away from the default */}
              {sh && may && <div className="fld embed"><SharesBox v={v} c={calc} /></div>}
              {sh && !may && (
                <div style={{ marginTop: 10, fontSize: 14 }}>
                  <div className="row"><span>{t("v5Net")}</span><b>{eur(calc.netto)}</b></div>
                  <div className="row"><span className="muted">{t("v5TechPdr")} {sh.techName} ({num(sh.techPct, 1)} %)</span><span>{eur(sh.techEur)}</span></div>
                  {sh.demEur > 0 && <div className="row"><span className="muted">{t("v5Headliner")} {sh.demTechName} ({num(sh.demTechPct, 1)} %)</span><span>{eur(sh.demTechEur)}</span></div>}
                  <div className="row"><span className="muted">{t("v5Bodyshop")} ({num(sh.werkPct, 1)} %)</span><span>{eur(sh.werkEur)}</span></div>
                  <div className="row" style={{ fontWeight: 800 }}><span>{t("v5RemainsPdr")}</span><span>{eur(sh.rest)}</span></div>
                </div>
              )}
              {!sh && mine && <div style={{ marginTop: 10 }}>{t("v5YourShare")}: <b>{eur((mine.techEur ?? 0) + (mine.demTechEur ?? 0))}</b></div>}
            </section>
            <section className="panel" style={{ padding: 16 }}>
              <h3 style={{ margin: "0 0 4px" }}>⏱ {t("v5Time")}</h3>
              <div>{sinceDays === null ? "—" : `${t("v5InRepairSince")} ${dm(String(v.repAt)).split(",")[0]} · ${sinceDays} ${t("v5Days")}`}</div>
            </section>
          </>
        )}

        {tab === "fotos" && (
          <section className="panel" style={{ padding: 16 }}>
            {f.can("photos.ajouter") && (
              <>
                <input ref={cam} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { void take(e.target.files); e.target.value = ""; }} />
                <input ref={gal} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { void take(e.target.files); e.target.value = ""; }} />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                  <button className="btn primary" onClick={() => cam.current?.click()}>📷 {t("takePhoto")} · {stageLabel(stage)}</button>
                  <button className="btn" onClick={() => gal.current?.click()}>⬆ {t("fromGallery")}</button>
                </div>
              </>
            )}
            {!photos.length && <p className="empty">{t("noPhotos")}</p>}
            {byStage.map((g) => (
              <div key={g.s} style={{ marginBottom: 16 }}>
                <h3 style={{ margin: "0 0 8px" }}>{stageLabel(g.s)} ({g.list.length})</h3>
                <div className="photogrid">{g.list.map((p) => <Thumb key={p.id} p={p} onOpen={() => setLb(ordered.findIndex((q) => q.id === p.id))} />)}</div>
              </div>
            ))}
            {untagged.length > 0 && (
              <div><h3 style={{ margin: "0 0 8px" }}>{t("v5OtherPhotos")} ({untagged.length})</h3>
                <div className="photogrid">{untagged.map((p) => <Thumb key={p.id} p={p} onOpen={() => setLb(ordered.findIndex((q) => q.id === p.id))} />)}</div></div>
            )}
            {lb !== null && <Lightbox photos={ordered} index={Math.min(lb, ordered.length - 1)} onIndex={setLb} onClose={() => setLb(null)} canEdit={f.can("photos.ajouter")} canDelete={f.can("photos.supprimer")} />}
          </section>
        )}

        {tab === "abschluss" && (
          <section className="panel" style={{ padding: 16 }}>
            <h3 style={{ margin: "0 0 4px" }}>{t("v5Checks")}</h3>
            <div className="chk">
              <span className={"ok" + (missingPhotos.length === 0 ? " on" : "")}>{missingPhotos.length === 0 ? "✓" : ""}</span>
              <span style={{ flex: 1 }}><b>{t("v5ChkPhotos")}</b><span className="muted" style={{ display: "block", fontSize: 12 }}>{missingPhotos.length ? `${t("v5Missing")}: ${missingPhotos.join(", ")}` : t("v5Automatic")}</span></span>
            </div>
            {manual.map((m) => {
              const c = rep.checks[m.key];
              return (
                <div key={m.key} className="chk">
                  <span className={"ok" + (c ? " on" : "")}>{c ? "✓" : ""}</span>
                  <span style={{ flex: 1 }}><b>{m.label}</b><span className="muted" style={{ display: "block", fontSize: 12 }}>{c ? `${t("v5ConfirmedBy")} ${c.by ?? ""} · ${dm(c.at)}` : m.sub}</span></span>
                  <button className={"chip" + (c ? " on" : "")} disabled={!m.allowed} onClick={() => void setCheck(f.mut, id, m.key, !c)}>{c ? t("v5Withdraw") : t("v5Confirm")}</button>
                </div>
              );
            })}
            {open > 0 && <p className="note" style={{ marginTop: 12 }}>{t("v5BlkTodos")}: {open}</p>}
            {stage !== "finish" ? (
              <>
                {rep.finishBlockers.length > 0 && <p className="note" style={{ marginTop: 12 }}>{t("v5FinishNo")} – {blockersText(rep.finishBlockers)}</p>}
                {may && <button className="btn primary" style={{ marginTop: 14 }} onClick={() => void finish()}>{t("v5Finish")}</button>}
              </>
            ) : (
              <>
                <div style={{ marginTop: 14, background: "#E9F4EE", borderRadius: 12, padding: "12px 14px" }}>
                  <b>{t("v5ReportTitle")}</b>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{reportLine}</div>
                  {(chief || f.can("rapport_reparation.envoyer")) && <button className="btn" style={{ marginTop: 10 }} disabled={busy} onClick={() => void resend()}>✉ {busy ? t("preparing") : t("v5Resend")}</button>}
                </div>
                {mayHandover && v.statut === "fertig" && (
                  <button className="btn primary" style={{ marginTop: 14 }} onClick={() => setSign("pick_up")}>{t("v5Handover")}</button>
                )}
              </>
            )}
          </section>
        )}

        {tab === "verlauf" && <Verlauf id={id} />}
      </div>
      {sign && <HandoverDialog v={v} kind={sign} onClose={() => setSign(null)} onSigned={() => { ho.reload(); if (sign === "pick_up") go({ page: "list", stationId, mode: "rep" }); }} />}
    </>
  );
}
