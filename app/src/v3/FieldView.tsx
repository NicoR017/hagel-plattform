import { isPlace } from "../field/places";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PANEL_MAP, type Panel } from "@hagel/calc";
import { eur } from "@hagel/documents";
import { t, tOr } from "../i18n";
import type { LocalVehicle } from "../sync/db";
import { addPhoto, setRepairStage, tagPhoto, toggleTodo } from "../sync/mutations";
import { CarSvg } from "../field/CarSvg";
import { UNDO_MS } from "../field/Dialogs";
import { downscale } from "../field/images";
import { go, type Route } from "../field/route";
import { useField, usePhotos, useVehicle, useVehicles } from "../field/store";
import { toast } from "../field/toast";
import { Dialog } from "../field/ui";
import { REPAIR_STAGES, stageOf } from "./boardLogic";
import { alsoRemoval, countKinds, fieldPanels, hasStepPhoto, isActive, isFinished, isMine, nextStep, tally, type FieldKind, type FieldPanel, type FieldVehicle, type Intervention } from "./fieldLogic";
import { stageLabel } from "./RepairBoard";
import { typeLabel } from "./Stations";
import type { Key } from "../i18n";

/** colours by intervention: green PDR, orange push to paint, red replace (grey = removal/refit, blue = spare part) */
const KIND: Record<Intervention, { bg: string; fg: string; fill: string; stroke: string; label: Key }> = {
  pdr: { bg: "#E4EEE5", fg: "#2F5535", fill: "#86b08a", stroke: "#5e8c63", label: "fvPdr" },
  ptp: { bg: "#FDF0E1", fg: "#8A4A06", fill: "#F0A64B", stroke: "#C9781A", label: "fvPtp" },
  replace: { bg: "#FBE4E1", fg: "#8F1D14", fill: "#E0796D", stroke: "#A23B2E", label: "fvReplace" },
};
const GREY = { bg: "#EEF0F3", fg: "#3B4555" }, BLUE = { bg: "#E3ECFD", fg: "#1D4FB8" };
const panelName = (k: string) => tOr("pn." + k, PANEL_MAP[k]?.de ?? k);
const panelShort = (k: string) => tOr("ps." + k, PANEL_MAP[k]?.short ?? k);
const plateOf = (v: LocalVehicle) => String((v as Record<string, unknown>).kennzeichen || "—");
const modelOf = (v: LocalVehicle) => String((v as Record<string, unknown>).modell || "");
const asField = (v: LocalVehicle) => v as unknown as FieldVehicle;

const Chip = ({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) => <span className="badge" style={{ background: bg, color: fg, fontSize: 12 }}>{children}</span>;

export function useFieldKind(): { kind: FieldKind; meId: string; name: string } | null {
  const f = useField();
  const fv = f.refs?.me.fieldView;
  return fv ? { kind: fv.kind, meId: f.refs!.me.id, name: fv.name } : null;
}

function Legend({ kind }: { kind: FieldKind }) {
  return (
    <div className="fv-legend" aria-label={t("fvLegend")}>
      {kind === "headliner"
        ? <><Chip {...GREY}>{t("fvRemoval")}</Chip><Chip {...BLUE}>{t("fvSpare")}</Chip><Chip {...KIND.replace}>{t("fvReplace")}</Chip></>
        : <>{(["pdr", "ptp", "replace"] as Intervention[]).map((k) => <Chip key={k} {...KIND[k]}>{t(KIND[k].label)}</Chip>)}</>}
    </div>
  );
}

/** "You earn €…": only his own share (PDR part and / or removal-refit part) */
function Earn({ v, big }: { v: LocalVehicle; big?: boolean }) {
  const e = asField(v).myEarn;
  if (!e || (!e.pdr && !e.dem)) return null;
  // the percentages are only there for a role with "View the percentage of the own share"
  const parts = [e.pdr?.pct != null ? t("fvEarnPdr").replace("{pct}", String(Math.round(e.pdr.pct * 10) / 10)) : "", e.dem?.pct != null ? t("fvEarnDem").replace("{pct}", String(Math.round(e.dem.pct * 10) / 10)) : ""].filter(Boolean).join(" · ");
  return (
    <div className="fv-earn" style={{ fontSize: big ? 18 : 14 }}>
      <span>{t("fvEarn")} <b style={{ fontSize: big ? 26 : 17 }}>{eur(e.eur)}</b></span>
      {parts && <small>{parts}</small>}
    </div>
  );
}

const todosOf = (v: LocalVehicle) => ((v.repair as { todos?: { id: string; text: string; source: string; done: boolean }[] } | undefined)?.todos ?? []);

/** photo of the current step + the move: the move button stays disabled until HE has taken a photo of this step */
function useFieldMove(v: LocalVehicle, kind: FieldKind) {
  const f = useField();
  const photos = usePhotos(v.id);
  const me = f.refs?.me.id ?? "";
  const stage = stageOf(v);
  const next = nextStep(kind, asField(v), f.refs?.me.fieldView?.moves);
  const has = hasStepPhoto(photos, me, v.id, stage);
  const [moving, setMoving] = useState(false);
  const role = kind === "headliner" ? "Headliner" : "Techniker";
  const take = async (files: FileList | null) => {
    if (!files) return;
    for (const file of [...files]) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const pid = await addPhoto(f.mut, { vehicleId: v.id, blob: await downscale(file), label: "Detail / Delle", phase: "reparatur" });
        await tagPhoto(f.mut, v.id, pid, stage, role);
        // the phone knows at once that HE took a photo of this step (the server's own record replaces this at the next sync)
        await f.db.photos.update(pid, { repairStage: stage, role, takenBy: me });
      } catch { toast(t("photoFailed")); }
    }
  };
  /** the move happens after the "Undo" delay: the server only allows the forward steps, so an undo has to cancel it before it is sent */
  const move = () => {
    if (!next || moving) return;
    setMoving(true);
    let undone = false;
    const timer = window.setTimeout(() => { if (!undone) void setRepairStage(f.mut, v.id, next).catch(() => undefined); setMoving(false); }, UNDO_MS);
    toast(t("fvMovedTo").replace("{plate}", plateOf(v)).replace("{next}", stageLabel(next)), UNDO_MS, { label: t("v3Undo"), run: () => { undone = true; clearTimeout(timer); setMoving(false); } });
  };
  return { stage, next, has, moving, take, move };
}

function MoveBox({ v, kind }: { v: LocalVehicle; kind: FieldKind }) {
  const m = useFieldMove(v, kind);
  const cam = useRef<HTMLInputElement>(null);
  if (!m.next) return null;
  return (
    <div className="fv-move" onClick={(e) => e.stopPropagation()}>
      <input ref={cam} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { void m.take(e.target.files); e.target.value = ""; }} />
      {!m.has && (
        <>
          <div className="fv-need">📷 {t("fvPhotoReq").replace("{step}", stageLabel(m.stage))}</div>
          <button className="btn primary" onClick={() => cam.current?.click()}>📷 {t("fvTakePhoto").replace("{step}", stageLabel(m.stage))}</button>
        </>
      )}
      {m.has && <button className="btn" style={{ minHeight: 40 }} onClick={() => cam.current?.click()}>📷 {t("fvTakePhoto").replace("{step}", stageLabel(m.stage))}</button>}
      <button className={"btn" + (m.has ? " primary" : "")} disabled={!m.has || m.moving} onClick={m.move}>
        {m.moving ? t("fvMoving") : m.has ? t("fvPhotoDone").replace("{next}", stageLabel(m.next)) : t("fvMoveTo").replace("{next}", stageLabel(m.next))}
      </button>
    </div>
  );
}

/** what he has to do, as coloured chips */
function Work({ v, kind }: { v: LocalVehicle; kind: FieldKind }) {
  const panels = fieldPanels(asField(v));
  const shown = kind === "headliner" ? panels.filter((p) => p.kind === "replace") : panels;
  const parts = sparePartsOf(v);
  return (
    <div className="fv-chips">
      {(kind === "headliner" || alsoRemoval(asField(v))) && <Chip {...GREY}>{t("fvRemoval")}</Chip>}
      {shown.map((p) => <Chip key={p.key} {...KIND[p.kind]}>{panelShort(p.key)}</Chip>)}
      {kind === "headliner" && parts.map((p) => <Chip key={p.text} {...BLUE}><span style={{ textDecoration: p.done ? "line-through" : "none" }}>{p.text}</span></Chip>)}
      {!shown.length && !parts.length && kind !== "headliner" && <span className="muted" style={{ fontSize: 12 }}>{t("fvNoWork")}</span>}
    </div>
  );
}

/** spare parts to fit: the parts to replace of the estimate (they became to-dos when the car entered the board); struck through once done */
function sparePartsOf(v: LocalVehicle): { text: string; done: boolean }[] {
  const todos = todosOf(v).filter((x) => x.source === "part");
  const header = (((v as Record<string, unknown>).partsToReplace as unknown[] | undefined) ?? []).filter((x): x is string => typeof x === "string" && !!x.trim());
  const out = todos.map((x) => ({ text: x.text, done: x.done }));
  for (const h of header) if (!out.some((o) => o.text === h.trim())) out.push({ text: h.trim(), done: false });
  return out;
}

function FieldCard({ v, kind }: { v: LocalVehicle; kind: FieldKind }) {
  const f = useField();
  const open = todosOf(v).filter((x) => !x.done && (kind !== "headliner" || x.source === "part"));
  const finished = isFinished(asField(v));
  return (
    <article className="panel fv-card" onClick={() => go({ page: "repair", id: v.id, tab: "uebersicht", stationId: v.stationId as string })} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") go({ page: "repair", id: v.id, tab: "uebersicht", stationId: v.stationId as string }); }} aria-label={plateOf(v)}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <span><b style={{ fontSize: 18 }}>{plateOf(v)}</b><br /><span className="muted" style={{ fontSize: 13 }}>{modelOf(v)}</span></span>
        <Chip {...(finished ? { bg: "#E3F4EA", fg: "#17663F" } : GREY)}>{stageLabel(stageOf(v))}</Chip>
      </div>
      <Work v={v} kind={kind} />
      {open.length > 0 && <div style={{ fontSize: 13 }}><b>{t("fvOpenTodos").replace("{n}", String(open.length))}</b> · <span className="muted">{open.slice(0, 3).map((x) => x.text).join(" · ")}{open.length > 3 ? " …" : ""}</span></div>}
      <Earn v={v} />
      {!finished && f.can("photos.ajouter") && <MoveBox v={v} kind={kind} />}
    </article>
  );
}

/** S34 / S37: his cars in one station (no mode choice, no board) */
export function FieldCars({ stationId, who }: { stationId: string; who: { kind: FieldKind; meId: string } }) {
  const all = useVehicles();
  const steps = useField().refs?.me.fieldView?.steps;
  const mine = useMemo(() => all.filter((v) => v.stationId === stationId && isMine(asField(v), who.kind, steps)), [all, stationId, who.kind, steps]);
  const order = (v: LocalVehicle) => REPAIR_STAGES.indexOf(stageOf(v));
  const active = mine.filter((v) => isActive(asField(v)) && !isFinished(asField(v))).sort((a, b) => order(a) - order(b) || plateOf(a).localeCompare(plateOf(b)));
  const finished = mine.filter((v) => isFinished(asField(v))).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const f = useField();
  return (
    <main style={{ maxWidth: 820 }}>
      <div>
        <h1 style={{ fontSize: 24 }}>{t("fvMyCars")}</h1>
        <p className="sub" style={{ margin: "2px 0 0" }}>{f.stationName(stationId)}</p>
      </div>
      <Legend kind={who.kind} />
      {!active.length && !finished.length && <p className="empty">{t("fvNoCars")}</p>}
      <div className="rows">{active.map((v) => <FieldCard key={v.id} v={v} kind={who.kind} />)}</div>
      {finished.length > 0 && (
        <>
          <h2 style={{ fontSize: 17, marginTop: 8 }}>{t("fvFinishedSection")} ({finished.length})</h2>
          <div className="rows">{finished.map((v) => <FieldCard key={v.id} v={v} kind={who.kind} />)}</div>
        </>
      )}
    </main>
  );
}

/** S33 / S36: the stations where he works, with the numbers of his cars */
export function FieldStations({ who, fvStations }: { who: { kind: FieldKind; meId: string }; fvStations: string[] }) {
  const f = useField();
  const all = useVehicles();
  const stations = (f.refs?.stations ?? []).filter((s) => s.active && isPlace(s));
  const steps = f.refs?.me.fieldView?.steps;
  const mineBy = (id: string) => all.filter((v) => v.stationId === id && isMine(asField(v), who.kind, steps));
  const list = stations.filter((s) => fvStations.includes(s.id) || mineBy(s.id).length > 0);
  useEffect(() => {
    if (list.length !== 1) return;
    let seen = false;
    try { seen = sessionStorage.getItem("hagel.v4.autoStation") === "1"; sessionStorage.setItem("hagel.v4.autoStation", "1"); } catch { /* ignore */ }
    if (!seen) go({ page: "mode", stationId: list[0].id });
  }, [list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 26 }}>{t("fvTitle")}</h1>
      {!list.length && <p className="empty">{f.refs ? t("fvNoStations") : t("loading")}</p>}
      <div className="stgrid">
        {list.map((s) => {
          const n = tally(mineBy(s.id) as unknown as FieldVehicle[], who.kind, steps);
          const cells = who.kind === "headliner"
            ? [[n.toRemove, t("fvToRemove")], [n.toRefit, t("fvToRefit")], [n.total, t("fvTotal")]] as const
            : [[n.toDo, t("fvToDo")], [n.inPdr, t("fvInPdr")], [n.finished, t("fvFinished")]] as const;
          return (
            <button key={s.id} className="stcard" onClick={() => go({ page: "mode", stationId: s.id })}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 16 }}>{s.name}</span>
                <Chip {...GREY}>{typeLabel(s.type)}</Chip>
              </span>
              <span className="three">{cells.map(([num, label]) => <span key={label}><b>{num}</b>{label}</span>)}</span>
            </button>
          );
        })}
      </div>
    </main>
  );
}

/** D15 / D16: one panel, read only */
function PanelDialog({ p, kind, onClose }: { p: FieldPanel; kind: FieldKind; onClose: () => void }) {
  const k = KIND[p.kind];
  const method = p.method === "erneuern" ? t("fvMethodErneuern") : p.method === "ptp" ? t("fvMethodPtp") : t("fvMethodSanft");
  return (
    <Dialog title={panelName(p.key)} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div><Chip bg={k.bg} fg={k.fg}>{method}</Chip></div>
        {kind !== "headliner" && p.dents > 0 && (
          <>
            <div className="muted" style={{ fontSize: 13 }}>{t("fvDentsPerClass")}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {p.sizes.map(([size, n]) => <span key={size} className="chip" style={{ cursor: "default" }}>{size} mm · <b>{n}</b></span>)}
            </div>
            <div style={{ fontSize: 14 }}>{p.dents} {t("dentsWord")} · {t("fvAvgSize").replace("{n}", String(p.avgX))}{p.big ? ` · ${t("fvBigDents").replace("{n}", String(p.big))}` : ""}</div>
          </>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {p.alu && <Chip {...GREY}>{t("fvAlu")}</Chip>}
          {p.glue && <Chip {...GREY}>{t("fvGlue")}</Chip>}
        </div>
      </div>
    </Dialog>
  );
}

/** S35 / S38: one car */
export function FieldCar({ id, who }: { id: string; who: { kind: FieldKind; meId: string } }) {
  const f = useField();
  const v = useVehicle(id);
  const [dlg, setDlg] = useState<FieldPanel | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const mv = useFieldMove((v ?? { id } as LocalVehicle) as LocalVehicle, who.kind);
  if (!v) return <main><p className="empty">{v === null ? t("noData") : t("loading")}</p></main>;
  const kind = who.kind;
  const panels = fieldPanels(asField(v));
  const shown = kind === "headliner" ? panels.filter((p) => p.kind === "replace") : panels;
  const counts = countKinds(shown);
  const tint = (k: string) => { const p = shown.find((q) => q.key === k); return p ? { fill: KIND[p.kind].fill, stroke: KIND[p.kind].stroke } : null; };
  const todos = todosOf(v).filter((q) => kind !== "headliner" || q.source === "part");
  const cur = stageOf(v);
  const parts = sparePartsOf(v);
  return (
    <main style={{ maxWidth: 980 }}>
      <section className="fv-band">
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{plateOf(v)}</div>
          <div style={{ opacity: 0.85 }}>{modelOf(v)}</div>
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {REPAIR_STAGES.map((s) => <span key={s} className={"fv-step" + (s === cur ? " on" : "")}>{stageLabel(s)}</span>)}
          </div>
        </div>
        <Earn v={v} big />
      </section>
      <Legend kind={kind} />
      <div className="fv-two">
        {(shown.length > 0 || kind !== "headliner") && (
          <section className="panel" style={{ padding: 14 }}>
            {(kind !== "headliner" || shown.length > 0) && (
              <CarSvg panels={(v.panels ?? {}) as Record<string, Panel>} glass={undefined} tint={tint} onPanel={(k) => { const p = shown.find((q) => q.key === k); if (p) setDlg(p); }} onGlass={() => undefined} />
            )}
            <div className="fv-counts">
              {(["pdr", "ptp", "replace"] as Intervention[]).filter((k) => counts[k] > 0).map((k) => <Chip key={k} {...KIND[k]}>{t(KIND[k].label)} · {counts[k]}</Chip>)}
            </div>
          </section>
        )}
        <section className="panel" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontSize: 16 }}>{kind === "headliner" ? t("fvReplacedPanels") : t("fvPanels")}</h2>
          {!shown.length && <p className="muted" style={{ margin: 0 }}>{t("fvNoWork")}</p>}
          {shown.map((p) => (
            <button key={p.key} className="fv-prow" onClick={() => setDlg(p)}>
              <span><b>{panelName(p.key)}</b>{kind !== "headliner" && p.dents > 0 ? <small>{p.dents} {t("dentsWord")} · {t("fvAvgSize").replace("{n}", String(p.avgX))}{p.alu ? ` · ${t("fvAlu")}` : ""}{p.glue ? ` · ${t("fvGlue")}` : ""}</small> : null}</span>
              <Chip {...KIND[p.kind]}>{p.method === "erneuern" ? t("fvMethodErneuern") : p.method === "ptp" ? t("fvMethodPtp") : t("fvMethodSanft")}</Chip>
            </button>
          ))}
          {kind === "headliner" && (
            <>
              <h2 style={{ fontSize: 16, marginTop: 8 }}>{t("fvPartsToFit")}</h2>
              {!parts.length && <p className="muted" style={{ margin: 0 }}>{t("fvNoTodos")}</p>}
              {parts.map((p) => <div key={p.text}><Chip {...BLUE}><span style={{ textDecoration: p.done ? "line-through" : "none" }}>{p.text}</span></Chip></div>)}
            </>
          )}
        </section>
      </div>
      <section className="panel" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: 16 }}>{t("fvTodosTitle")}</h2>
        {!todos.length && <p className="muted" style={{ margin: 0 }}>{t("fvNoTodos")}</p>}
        {todos.map((q) => (
          <label key={q.id} className="fv-todo">
            <input type="checkbox" checked={q.done} disabled={!f.can("reparatur.board")} onChange={(e) => void toggleTodo(f.mut, v.id, q.id, e.target.checked)} />
            <span style={{ textDecoration: q.done ? "line-through" : "none" }}>{q.text}</span>
          </label>
        ))}
      </section>
      {f.can("photos.ajouter") && !isFinished(asField(v)) && (
        <section className="panel" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {mv.next ? <MoveBox v={v} kind={kind} /> : (
            <>
              <input ref={cam} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { void mv.take(e.target.files); e.target.value = ""; }} />
              <button className="btn primary" onClick={() => cam.current?.click()}>📷 {t("fvTakePhoto").replace("{step}", stageLabel(cur))}</button>
            </>
          )}
        </section>
      )}
      {dlg && <PanelDialog p={dlg} kind={kind} onClose={() => setDlg(null)} />}
    </main>
  );
}

/** Where the routes of the field interface lead: stations, his cars of a station, one car. Everything else goes back to the stations. */
export function fieldBody(route: Route, who: { kind: FieldKind; meId: string; stationIds: string[] }, vehicleStation?: string | null): { body: ReactNode; crumb: string | null } {
  if (route.page === "search") return { body: null, crumb: null };
  if (route.page === "repair" || route.page === "vehicle" || route.page === "expertise") return { body: <FieldCar key={route.id} id={route.id} who={who} />, crumb: "car" };
  const stationId = "stationId" in route && route.stationId ? route.stationId : vehicleStation;
  if (stationId) return { body: <FieldCars key={stationId} stationId={stationId} who={who} />, crumb: "station" };
  return { body: <FieldStations who={who} fvStations={who.stationIds} />, crumb: null };
}
