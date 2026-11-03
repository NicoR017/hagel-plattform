import { useEffect, useState } from "react";
import { api, httpFetch } from "../../api";
import { act, Card, Err, useLoad } from "./shared";
import { t } from "../../shared/i18n";

interface Company { id: string; name: string; address: string; taxId: string; email: string; footer: string; logoKey: string | null; active: boolean }

function LogoPreview({ id, version }: { id: string; version: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null, live = true;
    if (!version) { setUrl(null); return; }
    httpFetch("GET", `/admin/companies/${id}/logo`, undefined, { blob: true }).then((r) => { if (live && r.blob) { u = URL.createObjectURL(r.blob); setUrl(u); } }).catch(() => undefined);
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [id, version]);
  return url ? <img src={url} alt="logo" style={{ maxHeight: 60, maxWidth: 200, display: "block", background: "#fff", border: "1px solid var(--line)", borderRadius: 6, padding: 4 }} /> : <span className="muted">{t("noLogo")}</span>;
}

export function CompaniesPage() {
  const list = useLoad<Company[]>("/admin/companies");
  const [f, setF] = useState<{ id?: string; name: string; address: string; taxId: string; email: string; footer: string; active: boolean } | null>(null);
  const [err, setErr] = useState("");
  const upload = async (id: string, file: File) => {
    const r = await httpFetch("PUT", `/admin/companies/${id}/logo`, undefined, { raw: file, contentType: file.type });
    if (r.status !== 200) setErr(String(r.data?.error ?? r.status)); else { setErr(""); await list.reload(); }
  };
  return (
    <>
      <Card title={t("letterheads")} actions={<button className="btn" onClick={() => setF({ name: "", address: "", taxId: "", email: "", footer: "", active: true })}>{t("newLetterhead")}</button>}>
        <p className="muted" style={{ marginTop: 0 }}>{t("letterheadAdminHint")}</p>
        <Err msg={list.err || err} />
        {(list.data ?? []).map((co) => (
          <div key={co.id} className="row" style={{ borderTop: "1px solid var(--line)", padding: "10px 0", alignItems: "flex-start" }}>
            <div className="grow">
              <b>{co.name}</b>{!co.active && <span className="pill off">{t("inactive")}</span>}
              <div style={{ color: "var(--sub)", fontSize: 13, whiteSpace: "pre-line" }}>{[co.address, co.taxId, co.email].filter(Boolean).join("\n")}</div>
            </div>
            <div style={{ minWidth: 160 }}><LogoPreview id={co.id} version={co.logoKey} /></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="btn sec" style={{ display: "inline-flex", alignItems: "center", cursor: "pointer", margin: 0 }}>{t("uploadLogo")}
                <input type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) void upload(co.id, fl); }} /></label>
              {co.logoKey && <button className="btn danger" onClick={() => void act(() => api("DELETE", `/admin/companies/${co.id}/logo`), setErr, list.reload)}>{t("removeLogo")}</button>}
              <button className="btn sec" onClick={() => setF({ id: co.id, name: co.name, address: co.address, taxId: co.taxId, email: co.email, footer: co.footer, active: co.active })}>{t("edit")}</button>
            </div>
          </div>
        ))}
      </Card>
      {f && (
        <Card title={f.id ? f.name : t("newLetterhead")}>
          <label>{t("name")}</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <label>{t("address")}</label><textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          <div className="row">
            <div className="grow"><label>{t("taxId")}</label><input value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} /></div>
            <div className="grow"><label>{t("email")}</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          </div>
          <label>{t("footerText")}</label><textarea rows={2} value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} />
          <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}><input type="checkbox" style={{ width: 22, height: 22, minHeight: 0 }} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t("active")}</label>
          <Err msg={err} />
          <p className="row">
            <button className="btn" onClick={() => {
              const body = { name: f.name, address: f.address, tax_id: f.taxId, email: f.email, footer: f.footer, active: f.active };
              void act(() => (f.id ? api("PUT", `/admin/companies/${f.id}`, body) : api("POST", "/admin/companies", body)), setErr, () => { setF(null); void list.reload(); });
            }}>{t("save")}</button>
            <button className="btn sec" onClick={() => setF(null)}>{t("cancel")}</button>
          </p>
        </Card>
      )}
    </>
  );
}
