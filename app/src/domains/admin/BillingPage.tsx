import { useState } from "react";
import { ORDER_VARS } from "@hagel/documents";
import { api } from "../../api";
import { t } from "../../shared/i18n";
import { act, Card, Err, matches, Modal, useLoad } from "./shared";

interface BodyShop { id: string; name: string; cif: string | null; address: string; contactName: string | null; commissionPct: string; active: boolean }
interface Settings {
  station_id: string; enabled: boolean; mode: "automatic" | "manual"; to_emails: string[]; cc_emails: string[]; reply_to: string | null; lang: "es" | "de" | "en" | "fr";
  show_prices: boolean; delivery_days: number; reminder_days: number; subject_template: string; body_template: string; default_template: Record<string, { subject: string; body: string }>;
}
const LANGS: { k: Settings["lang"]; label: string }[] = [{ k: "es", label: "Español" }, { k: "de", label: "Deutsch" }, { k: "en", label: "English" }, { k: "fr", label: "Français" }];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** a list of e-mail addresses as removable pills with an input (Enter / comma adds) */
function Emails({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  const [draft, setDraft] = useState("");
  const add = () => { const x = draft.trim().toLowerCase(); if (x && EMAIL.test(x) && !value.includes(x)) { onChange([...value, x]); setDraft(""); } };
  return (
    <>
      <label>{label}</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>{value.map((e) => <span key={e} className="pill">{e} <a href="#" onClick={(ev) => { ev.preventDefault(); onChange(value.filter((x) => x !== e)); }}>✕</a></span>)}</div>
      <input type="email" value={draft} placeholder={t("f4EmailAdd")} onChange={(e) => setDraft(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} />
    </>
  );
}

/** Administration → Billing → Body shop billing (permission facturation.gerer): the "Parts ordering" settings of each body shop (R13 / D30). */
export function BillingPage() {
  const list = useLoad<BodyShop[]>("/admin/bodyshops");
  const [q, setQ] = useState("");
  const [shop, setShop] = useState<BodyShop | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState(""), [note, setNote] = useState("");
  const rows = (list.data ?? []).filter((b) => matches(q, [b.name, b.cif, b.address]));
  const open = async (b: BodyShop) => { setErr(""); setNote(""); setShop(b); setS(null); try { setS(await api<Settings>("GET", `/admin/bodyshops/${b.id}/order-settings`)); } catch (e) { setErr((e as Error).message); } };
  const save = () => {
    if (!s || !shop) return;
    const { station_id: _id, default_template: _d, ...body } = s; void _id; void _d;
    void act(() => api("PUT", `/admin/bodyshops/${shop.id}/order-settings`, body), setErr, () => { setNote(t("f4Saved")); });
  };
  const tpl = s?.default_template[s.lang];

  return (
    <>
      <Card title={t("f4BillTitle")}>
        <p className="muted" style={{ marginTop: 0 }}>{t("f4BillHint")}</p>
        <Err msg={list.err} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("v8SearchBodyShops")} aria-label={t("v8SearchBodyShops")} style={{ marginBottom: 10 }} />
        <table>
          <thead><tr><th>{t("name")}</th><th>{t("v8Cif")}</th><th>{t("commission")}</th><th /></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.id}><td>{b.name}{!b.active && <span className="pill off">{t("inactive")}</span>}</td><td>{b.cif || "—"}</td><td>{Number(b.commissionPct)} %</td>
              <td style={{ whiteSpace: "nowrap" }}><button className="btn" onClick={() => void open(b)}>📨 {t("f4Ordering")}</button></td></tr>
          ))}</tbody>
        </table>
      </Card>
      {shop && (
        <Modal title={t("f4SettingsOf").replace("{name}", shop.name)} onClose={() => { setShop(null); setS(null); }}>
          {!s && <p className="muted">{t("loading")}</p>}
          {s && (
            <>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}><input type="checkbox" style={{ width: "auto" }} checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />{t("f4OrderVia")}</label>
              <label>{t("f4Mode")}</label>
              <select value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value as Settings["mode"] })}><option value="manual">{t("f4ModeManual")}</option><option value="automatic">{t("f4ModeAuto")}</option></select>
              <Emails label={t("f4EmailTo")} value={s.to_emails} onChange={(v) => setS({ ...s, to_emails: v })} />
              <Emails label={t("f4EmailCc")} value={s.cc_emails} onChange={(v) => setS({ ...s, cc_emails: v })} />
              <label>{t("f4EmailReply")}</label><input type="email" value={s.reply_to ?? ""} onChange={(e) => setS({ ...s, reply_to: e.target.value.trim() || null })} />
              <div className="muted" style={{ fontSize: 12 }}>{t("f4EmailReplyHint")}</div>
              <div className="row">
                <div className="grow"><label>{t("f4OrderLang")}</label><select value={s.lang} onChange={(e) => setS({ ...s, lang: e.target.value as Settings["lang"] })}>{LANGS.map((l) => <option key={l.k} value={l.k}>{l.label}</option>)}</select></div>
                <div className="grow"><label>{t("f4DeliveryDays")}</label><input type="number" min={0} max={30} value={s.delivery_days} onChange={(e) => setS({ ...s, delivery_days: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} /></div>
                <div className="grow"><label>{t("f4Reminder")}</label><select value={s.reminder_days} onChange={(e) => setS({ ...s, reminder_days: Number(e.target.value) })}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n ? t("f4ReminderDays").replace("{n}", String(n)) : t("f4ReminderOff")}</option>)}</select></div>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}><input type="checkbox" style={{ width: "auto" }} checked={s.show_prices} onChange={(e) => setS({ ...s, show_prices: e.target.checked })} />{t("f4ShowPrices")}</label>
              <label>{t("f4Template")}</label>
              <div className="muted" style={{ fontSize: 12 }}>{t("f4TemplateDefault")} {t("f4Vars").replace("{vars}", ORDER_VARS.map((v) => `{{${v}}}`).join(" "))}</div>
              <input value={s.subject_template} placeholder={tpl?.subject} onChange={(e) => setS({ ...s, subject_template: e.target.value })} aria-label={t("f4Subject")} />
              <textarea rows={8} value={s.body_template} placeholder={tpl?.body} onChange={(e) => setS({ ...s, body_template: e.target.value })} aria-label={t("f4Body")} />
              {note && <div className="ok" style={{ color: "var(--greenDk)" }}>{note}</div>}
              <Err msg={err} />
              <p className="row modal-actions">
                <button className="btn" onClick={save}>{t("save")}</button>
                <button className="btn sec" onClick={() => void act(async () => { const r = await api<{ sentTo: string }>("POST", `/admin/bodyshops/${shop.id}/order-settings/test`); setNote(t("f4TestSent").replace("{email}", r.sentTo)); }, setErr)}>✉ {t("f4SendTest")}</button>
                <button className="btn sec" onClick={() => { setShop(null); setS(null); }}>{t("cancel")}</button>
              </p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
