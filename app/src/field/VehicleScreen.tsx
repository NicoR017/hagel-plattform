import { t } from "../i18n";
import { Basis } from "./Basis";
import { Bilder } from "./Bilder";
import { Erfassung } from "./Erfassung";
import { Kva } from "./Kva";
import { go, type Ctx, type Route, type Tab } from "./route";
import { useField, usePhotos, useVehicle } from "./store";

const TITLES: Record<Tab, Parameters<typeof t>[0]> = { basis: "tabBasis", erfassung: "tabCapture", bilder: "tabPhotos", kva: "tabKva" };
const ICONS: Record<Tab, string> = { basis: "ⓘ", erfassung: "🚗", bilder: "🖼", kva: "📄" };

export function VehicleScreen({ id, tab, ctx, backTo }: { id: string; tab: Tab; ctx?: Ctx; backTo?: Route }) {
  const f = useField();
  const v = useVehicle(id);
  const photos = usePhotos(id);
  const back = () => go(backTo ?? { page: "list" });
  if (v === undefined) return <div className="fld"><div className="hdr"><div className="top"><button className="backpill" onClick={back} aria-label={t("back")}>‹ {t("back")}</button></div><h1>{t("loading")}</h1></div></div>;
  if (v === null) {
    return (
      <div className="fld"><div className="hdr"><div className="top"><button className="backpill" onClick={back} aria-label={t("back")}>‹ {t("back")}</button></div><h1>{t("vehicleNotFound")}</h1></div>
        <div className="body" style={{ padding: 20 }}>{t("vehicleNotFoundHint")}</div></div>
    );
  }
  const pending = f.status.pendingOps + f.status.pendingUploads;
  return (
    <div className="fld">
      <div className="hdr">
        <div className="top">
          <button className="backpill" onClick={back} aria-label={t("back")}>‹ {t("back")}</button>
          <span className={"syncbadge " + (!f.status.online ? "off" : pending ? "pend" : "ok")}>{!f.status.online ? t("offline") : pending ? `${pending} ${t("pending")}` : t("synced")}</span>
        </div>
        <h1>{t(TITLES[tab])}</h1>
        <div className="sub">🚗 {String((v as Record<string, unknown>).kennzeichen || "—")}{(v as { _localOnly?: boolean })._localOnly ? " · ⏳" : ""}</div>
      </div>
      <div className="body">
        {tab === "basis" && <Basis v={v} />}
        {tab === "erfassung" && <Erfassung v={v} />}
        {tab === "bilder" && <Bilder v={v} />}
        {tab === "kva" && <Kva v={v} />}
      </div>
      <div className="tabbar" role="tablist">
        {(["basis", "erfassung", "bilder", "kva"] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} aria-label={t(TITLES[k])} className={"tab" + (tab === k ? " on" : "")} onClick={() => go({ page: "vehicle", id, tab: k, ctx })}>
            {ICONS[k]}{k === "bilder" && photos.length > 0 && <span className="bdg">{photos.length}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
