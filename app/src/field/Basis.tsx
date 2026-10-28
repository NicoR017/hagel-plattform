import { useRef, useState } from "react";
import { vehicleSettings, type CalcVehicle } from "@hagel/calc";
import { eur } from "@hagel/documents";
import type { HeaderFields } from "@hagel/shared";
import { t } from "../i18n";
import { applyColibriToVehicle, readColibriFile } from "../sync/colibriImport";
import type { LocalVehicle } from "../sync/db";
import { setHeader, setPrefs } from "../sync/mutations";
import { defaultMethodFor, methodOfVehicle } from "./calc";
import { MethodField } from "./MethodField";
import { CustomerPicker, MoveDialog, StatusDialog, holdReasonLabel, statusLabel } from "./Dialogs";
import { OcrDialog } from "./Ocr";
import { Picker, type PickItem } from "./Picker";
import { go } from "./route";
import { useField } from "./store";
import { toast } from "./toast";
import { Field, NumInput, Seg, ToggleRow } from "./ui";

const ZUST = ["Trocken", "Nass", "Sauber", "Schmutzig", "Gut", "Mangelhaft", "Ungenügend"] as const;
const ZUST_KEY: Record<string, string> = { Trocken: "z.dry", Nass: "z.wet", Sauber: "z.clean", Schmutzig: "z.dirty", Gut: "z.good", Mangelhaft: "z.poor", Ungenügend: "z.bad" };

export function Basis({ v }: { v: LocalVehicle }) {
  const f = useField();
  const x = v as Record<string, any>;
  const land: "DE" | "ES" = x.land === "ES" ? "ES" : "DE";
  const vs = vehicleSettings(v as unknown as CalcVehicle, f.calc);
  const edit = f.can("vehicules.modifier"), prices = f.can("prix.voir");
  const set = (fields: HeaderFields) => { if (edit) void setHeader(f.mut, v.id, fields); };
  const [dlg, setDlg] = useState<null | "customer" | "move" | "status" | "ocr-kz" | "ocr-fin">(null);
  const [info, setInfo] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const zust: string[] = x.zustand ?? [];
  const sites = f.refs?.stations ?? [];
  const companies = f.refs?.companies ?? [];
  // legacy vehicles (before letterheads) map their old logo switch onto the seeded companies
  const currentCompany = x.companyId && companies.some((co) => co.id === x.companyId) ? x.companyId : (x.logo === "none" ? companies.find((co) => !co.hasLogo) : companies.find((co) => co.hasLogo))?.id ?? companies[0]?.id ?? "";
  const linked = new Set((f.refs?.stationInsurers ?? []).filter((l) => l.stationId === v.clientStationId).map((l) => l.insurerId));
  // every insurer can be found; the ones that work with this customer carrosserie come first
  const customerName = f.stationName(v.clientStationId) || "";
  const insurerItems: PickItem[] = (f.refs?.insurers ?? []).map((i) => ({
    id: i.id, title: i.name, rank: linked.has(i.id) ? 0 : 1,
    sub: linked.has(i.id) && customerName ? t("pkWorksWith").replace("{name}", customerName) : undefined,
  }));
  /** the method follows the insurer as long as nothing is measured and nobody chose one by hand */
  const setInsurer = (id: string | null) => {
    const cur = methodOfVehicle(f.refs, v), mapped = f.refs?.insurerMethods?.find((i) => i.insurerId === v.insurerId && i.country === land);
    const auto = !cur || cur.isSystem || mapped?.methodId === cur.id;
    const m = auto && edit && !Object.keys((v.panels ?? {}) as object).length ? defaultMethodFor(f.refs, id, land) : null;
    set({ insurerId: id, ...(m && m.id !== cur?.id ? { methodId: m.id, methodVersion: m.version } : {}) });
  };

  const importScan = async (file: File) => {
    setInfo(t("readingScan"));
    try {
      const bytes = await file.arrayBuffer();
      const res = await readColibriFile(bytes);
      if (!res) { setInfo(t("colibriUnknownLong")); return; }
      const r = await applyColibriToVehicle(f.mut, v, res, { name: file.name, bytes });
      setInfo("");
      window.alert(`${r.match ? t("colibriOk") : t("colibriWarn")}\n\n${r.panels} ${t("panelsWord")} · ${r.imported} ${t("dentsTaken")}${r.match ? ` (${t("reportTotal")}: ${r.total} ✓)` : `\n${t("reportSays")} ${r.total}!`}${r.unknown.length ? `\n${t("notRecognised")}: ${r.unknown.join(", ")}` : ""}${r.big ? `\n${r.big} ${land === "ES" ? t("bigDentsEs") : t("bigDentsDe")}` : ""}${land === "ES" ? "" : `\n\n${t("colibriGlueNote")}`}\n${t("colibriAluNote")}`);
    } catch (e) { setInfo(`${t("readError")}: ${(e as Error).message}`); }
  };

  return (
    <div style={{ padding: "20px 16px" }}>
      <Field label={t("customerCarrosserie")}>
        <button className="kpick" disabled={!edit} onClick={() => setDlg("customer")}>
          <span><b>{f.stationName(v.clientStationId) || x.kunde || t("pickCustomer")}</b></span><span style={{ color: "var(--sub)", fontSize: 18 }}>▾</span>
        </button>
      </Field>
      <Field label={t("currentSite")}>
        <div className="row">
          <b style={{ fontSize: 16 }}>📍 {f.stationName(v.stationId) || "—"}</b>
          {f.can("vehicules.deplacer") && <button className="chip" onClick={() => setDlg("move")}>↔ {t("move")}</button>}
        </div>
      </Field>
      <Field label={t("status")}>
        <div className="row">
          <b>{statusLabel(v.statut)}{v.statut === "attente" && v.statutMotif ? ` · ${holdReasonLabel(v.statutMotif)}` : ""}</b>
          {f.can("vehicules.changer_statut") && <button className="chip" onClick={() => setDlg("status")}>{t("changeStatus")}</button>}
        </div>
      </Field>
      <Field label={t("claimNumber")}><input className="inp" disabled={!edit} defaultValue={x.claimNumber ?? ""} key={`cl-${v.id}`} onChange={(e) => set({ claimNumber: e.target.value })} /></Field>

      <Field label={t("basisLand")} hint={land === "ES" ? t("landHintES") : t("landHintDE")}>
        <Seg value={land} options={[{ value: "DE", label: "🇩🇪 Deutschland · BVAT" }, { value: "ES", label: "🇪🇸 España · IVA 21 %" }]}
          onChange={(l) => {
            // another country needs another engine: while nothing is measured yet the method follows (insurer's, else the system one)
            const m = f.refs?.methods?.length && !Object.keys((v.panels ?? {}) as object).length ? defaultMethodFor(f.refs, v.insurerId, l) : null;
            set({ land: l, stundensatz: prices ? (l === "ES" ? f.calc.rateES : f.calc.rateDE) : undefined, ...(m ? { methodId: m.id, methodVersion: m.version } : {}) } as HeaderFields);
            void setPrefs(f.db, { land: l });
          }} />
      </Field>
      {(f.refs?.insurers.length ?? 0) > 0 && (
        <Field label={t("insurer")}>
          <Picker items={insurerItems} multi={false} disabled={!edit} placeholder={t("pkInsurerPh")} hint={t("pkInsurerHint").replace("{n}", String(insurerItems.length))}
            chosen={v.insurerId ? [{ id: v.insurerId, label: insurerItems.find((i) => i.id === v.insurerId)?.title ?? "—", sub: insurerItems.find((i) => i.id === v.insurerId)?.sub }] : []}
            onAdd={(it) => setInsurer(it.id)} onRemove={() => setInsurer(null)} />
        </Field>
      )}
      <MethodField v={v} />
      {companies.length > 0 ? (
        <Field label={t("letterhead")} hint={t("letterheadHint")}>
          <select className="sel" disabled={!edit} value={currentCompany} onChange={(e) => { set({ companyId: e.target.value }); void setPrefs(f.db, { lastCompanyId: e.target.value }); }}>
            {companies.map((co) => <option key={co.id} value={co.id}>{co.name}{co.hasLogo ? "" : ` (${t("noLogo")})`}</option>)}
          </select>
        </Field>
      ) : (
        <Field label={t("logoLabel")} hint={x.logo === "none" ? t("logoHintNone") : t("logoHintPdr")}>
          <Seg value={x.logo === "none" ? "none" : "pdr"} options={[{ value: "pdr", label: t("logoPdr") }, { value: "none", label: t("logoNone") }]}
            onChange={(l) => { set({ logo: l }); void setPrefs(f.db, { logo: l }); }} />
        </Field>
      )}
      {f.can("colibri.importer") && (
        <Field>
          <button className="seg" style={{ width: "100%", borderColor: "var(--navy)", fontWeight: 700 }} onClick={() => fileRef.current?.click()}>📄 {t("colibriImportBtn")}</button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) void importScan(fl); }} />
          <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 6 }}>
            {info || (v.colibri ? <>{t("fromColibri")}{(v.colibri as any).method ? ` · ${(v.colibri as any).method}` : ""}{v.colibriFile ? <><br />📎 {t("scanAttached")}</> : null}</> : t("colibriPick"))}
          </div>
        </Field>
      )}
      <Field label={t("plate")}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="inp" style={{ flex: 1 }} disabled={!edit} value={x.kennzeichen ?? ""} placeholder="KEL-LE 700" onChange={(e) => set({ kennzeichen: e.target.value.toUpperCase() })} />
          <button className="chip" style={{ width: 52, height: 48, fontSize: 20 }} disabled={!edit} onClick={() => setDlg("ocr-kz")} aria-label={t("photoRecognition")}>📷</button>
        </div>
      </Field>
      <Field label={t("vin")} hint={t("vinHint")}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="inp" style={{ flex: 1 }} maxLength={17} disabled={!edit} value={x.fin ?? ""} placeholder="17" onChange={(e) => set({ fin: e.target.value.toUpperCase() })} />
          <button className="chip" style={{ width: 52, height: 48, fontSize: 20 }} disabled={!edit} onClick={() => setDlg("ocr-fin")} aria-label={t("photoRecognition")}>📷</button>
        </div>
      </Field>
      <Field label={t("model")}><input className="inp" disabled={!edit} value={x.modell ?? ""} placeholder="VW Golf VIII" onChange={(e) => set({ modell: e.target.value })} /></Field>
      <Field label={t("serviceDate")}><input type="date" className="inp" disabled={!edit} value={x.leistungsdatum ?? ""} onChange={(e) => set({ leistungsdatum: e.target.value })} /></Field>
      {land === "DE" && (
        <Field label={t("teiler")}><Seg value={vs.teiler} options={[{ value: 10, label: t("teiler10") }, { value: 12, label: t("teiler12") }]} onChange={(n) => set({ teiler: n })} /></Field>
      )}
      {prices && (
        <Field label={land === "ES" ? t("rateMatrix") : t("rateBvat")} hint={land === "ES" ? t("rateHintES") : `${t("givesPerAw")} ${eur(vs.stundensatz / vs.teiler)}`}>
          <NumInput value={vs.stundensatz} onChange={(n) => { set({ stundensatz: n }); }} max={1000} />
        </Field>
      )}
      <Field label={t("condition")}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ZUST.map((z) => <button key={z} className={"chip" + (zust.includes(z) ? " on" : "")} disabled={!edit} onClick={() => set({ zustand: zust.includes(z) ? zust.filter((q) => q !== z) : [...zust, z] })}>{t(ZUST_KEY[z] as never)}</button>)}
        </div>
      </Field>
      {land === "DE" && (
        <>
          <ToggleRow label={t("greifzone")} on={!!x.greifzone} onChange={(on) => set({ greifzone: on })} />
          <ToggleRow label={t("hohlraum")} on={!!x.hohlraum} onChange={(on) => set({ hohlraum: on })} />
          <ToggleRow label={t("verbringung")} on={!!x.verbringung} onChange={(on) => set({ verbringung: on })} />
        </>
      )}
      <ToggleRow label={t("demontage")} on={!!x.demontage} onChange={(on) => set({ demontage: on })} />
      {x.demontage && prices && (
        <Field label={t("demAmount")} hint={`${t("demHint")} ${land === "ES" ? "21 % IVA" : "19 % MwSt"}.`}>
          <NumInput value={x.demontageEur ?? 150} onChange={(n) => set({ demontageEur: n })} max={100000} />
          {land === "ES" && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>{[["M1", 100], ["M2", 150], ["M3", 200]].map(([m, e]) => <button key={m} className={"seg" + ((x.demontageEur ?? 150) === e ? " on" : "")} onClick={() => set({ demontageEur: e as number })}>{m} · {e} €</button>)}</div>}
        </Field>
      )}
      <Field label={t("notes")}><textarea className="inp" rows={3} style={{ resize: "vertical", minHeight: 72 }} disabled={!edit} value={x.notiz ?? ""} placeholder={t("notesHint")} onChange={(e) => set({ notiz: e.target.value })} /></Field>
      <button className="pbtn" onClick={() => go({ page: "vehicle", id: v.id, tab: "erfassung" })}>{t("continueCapture")} →</button>

      {dlg === "customer" && (
        <CustomerPicker value={v.clientStationId} onClose={() => setDlg(null)}
          onPick={(id) => { const s = sites.find((q) => q.id === id); set({ clientStationId: id, kunde: s?.name ?? "" }); void setPrefs(f.db, { lastClientStationId: id }); toast(s?.name ?? ""); }} />
      )}
      {dlg === "move" && <MoveDialog ids={[v.id]} from={v.stationId} onClose={() => setDlg(null)} />}
      {dlg === "status" && <StatusDialog ids={[v.id]} current={v.statut} onClose={() => setDlg(null)} />}
      {(dlg === "ocr-kz" || dlg === "ocr-fin") && <OcrDialog mode={dlg === "ocr-fin" ? "fin" : "kz"} land={land} onClose={() => setDlg(null)} onUse={(val) => set(dlg === "ocr-fin" ? { fin: val.replace(/\s/g, "") } : { kennzeichen: val })} />}
    </div>
  );
}
