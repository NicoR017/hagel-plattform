import { eur, h1, num } from "@hagel/documents";
import { t } from "../i18n";
import { Basis } from "../field/Basis";
import { BookingForm } from "../field/BookingForm";
import { Bilder } from "../field/Bilder";
import { Erfassung } from "../field/Erfassung";
import { Kva } from "../field/Kva";
import { colibriBadge } from "../sync/colibriImport";
import { go, type Ctx, type Step } from "../field/route";
import { useField, usePhotos, useVehicle } from "../field/store";

const STEPS: Step[] = ["basis", "erfassung", "bilder", "kva"];

/**
 * The assessment assistant (the v20 workflow, in the v20 look): a dark header with plate, model and customer link, a step bar
 * 1 Basis · 2 Erfassung · 3 Bilder · 4 KVA (all freely clickable), and a sticky bottom bar with the live net / AW / bollos.
 */
export function Expertise({ id, step, ctx }: { id: string; step: Step; ctx?: Ctx }) {
  const f = useField();
  const v = useVehicle(id);
  const photos = usePhotos(id);
  const labels: Record<Step, string> = { basis: t("v4StepBasis"), erfassung: t("v4StepCapture"), bilder: t("v4StepPhotos"), kva: ((v as Record<string, unknown> | null | undefined)?.land === "ES") ? t("v4StepKvaEs") : t("v4StepKva") };
  const toList = () => go(ctx ? { page: "list", stationId: ctx.stationId, mode: ctx.mode } : { page: "list" });
  const goStep = (s: Step) => go({ page: "expertise", id, step: s, ctx });

  if (v === undefined || (v === null && f.status.syncing)) return <main><p className="muted">{t("loading")}</p></main>;
  if (v === null) return <main><div className="empty">{t("vehicleNotFoundHint")}</div></main>;

  const x = v as Record<string, unknown>;
  const c = f.calcOf(v);
  const prices = f.can("prix.voir");
  const badge = colibriBadge(v);
  const i = STEPS.indexOf(step);
  const first = i === 0, last = i === STEPS.length - 1;

  return (
    <div className="exp">
      <div className="exp-hd">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "baseline" }}>
          <b style={{ fontSize: 20 }}>{String(x.kennzeichen || "—")}</b>
          <span>{String(x.modell || "")}</span>
          <span style={{ color: "#B9C4D6", fontSize: 13 }}>{String(x.kunde || f.stationName(v.clientStationId) || "")}{v.insurerId ? ` · ${f.refs?.insurers.find((q) => q.id === v.insurerId)?.name ?? ""}` : ""}</span>
          {badge && <span className="badge" style={badge === "ok" ? { background: "#E4EEE5", color: "#2F5535" } : { background: "#FBF1D9", color: "#7A5300" }}>{badge === "ok" ? t("scanOk") : t("scanCheck")}</span>}
        </div>
        <div className="exp-steps" role="tablist" aria-label={t("v4Steps")}>
          {STEPS.map((s, k) => (
            <button key={s} role="tab" aria-selected={s === step} className={s === step ? "on" : ""} onClick={() => goStep(s)}>
              <i>{k + 1}</i>{labels[s]}{s === "bilder" && photos.length > 0 ? ` (${photos.length})` : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="exp-body">
        <div className="fld embed" style={{ background: "#fff", borderRadius: 14, border: "1px solid var(--line)" }}>
          {step === "basis" && <Basis v={v} />}
          {step === "erfassung" && (
            <>
              <Erfassung v={v} />
              <div style={{ padding: "0 14px 16px" }}><button className="pbtn" onClick={() => goStep("bilder")}>{t("v4StepPhotos")} →</button></div>
            </>
          )}
          {step === "bilder" && <Bilder v={v} />}
          {step === "kva" && <Kva v={v} technicians={false} beforeActions={f.can("termine.buchen") ? <section className="panel" style={{ padding: 14, marginTop: 16 }}><h3 style={{ margin: "0 0 8px" }}>📅 {t("v4BookTitle")}</h3><BookingForm v={v} /></section> : undefined} />}
        </div>
      </div>

      <div className="exp-bar">
        <div className="exp-sum">
          {prices && <b style={{ fontSize: 20 }}>{eur(c.netto)}</b>}
          <span style={{ fontSize: 12, color: "#B9C4D6" }}>{c.es ? `${c.es.bollos} Bollos · ${t("cat")} ${c.es.cat.cat} · ${h1(c.es.totH)}` : `${num(c.totalAW)} AW`} · {c.panelCount} {t("panelsWord")}</span>
        </div>
        <button className="btn" onClick={() => (first ? toList() : goStep(STEPS[i - 1]))}>‹ {first ? t("v4ToList") : t("back")}</button>
        <button className="btn primary" onClick={() => (last ? toList() : goStep(STEPS[i + 1]))}>{last ? t("v4Done") : t("v4Next")} ›</button>
      </div>
    </div>
  );
}
