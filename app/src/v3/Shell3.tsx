import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, setAuth } from "../api";
import { LANG_LIST, setLang, t, useLang } from "../i18n";
import { BackupImport } from "../field/BackupImport";
import { SettingsDialog } from "../field/Dialogs";
import { go, hrefOf, parentRoute, type Route } from "../field/route";
import { useField } from "../field/store";
import { setUiMode } from "../field/uiMode";

export interface Crumb { label: string; to?: Route }
interface OrgRef { id: string; name: string }

function initials(name: string): string {
  const p = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}

/** Header of the new interface: "‹ Zurück" (one level up, every screen but the stations), logo, breadcrumb (secondary), sync, menu. */
export function Shell3({ user, orgs, org, onOrg, route, crumbs, vehicleStationId, children }: {
  user: { name: string; email: string }; orgs: OrgRef[]; org: string; onOrg: (id: string) => void;
  route: Route; crumbs: Crumb[]; vehicleStationId?: string | null; children: ReactNode;
}) {
  const f = useField();
  const lang = useLang();
  const [menu, setMenu] = useState(false);
  const [dlg, setDlg] = useState<null | "settings" | "backup">(null);
  const box = useRef<HTMLDivElement>(null);
  const parent = parentRoute(route, vehicleStationId);
  const pending = f.status.pendingOps + f.status.pendingUploads;
  const syncCls = !f.status.online ? "off" : pending || f.status.syncing ? "pend" : "";
  const syncText = !f.status.online ? t("offline") : pending ? `${pending} ${t("pending")}` : f.status.syncing ? t("syncing") : t("synced");
  const name = user.name || user.email;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  return (
    <div className="v3">
      <header className="hd">
        {parent && (
          <button className="back" onClick={() => go(parent)} aria-label={t("back")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            {t("back")}
          </button>
        )}
        <button className="logo" onClick={() => go({ page: "list" })}>
          <img src="/pdr-logo-white.png" alt="PDR Team · Hagel-Kalk" />
        </button>
        <nav aria-label={t("v3Breadcrumbs")}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "contents" }}>
              {i > 0 && <span aria-hidden="true">›</span>}
              {c.to && i < crumbs.length - 1 ? <button onClick={() => go(c.to!)}>{c.label}</button> : <span className="cur">{c.label}</span>}
            </span>
          ))}
        </nav>
        <div className="right" ref={box}>
          <span className={"syncpill " + syncCls} aria-live="polite"><i />{syncText}</span>
          {orgs.length > 1 && (
            <select className="tool" style={{ color: "#14233B", background: "#fff" }} value={org} onChange={(e) => onOrg(e.target.value)} aria-label={t("org")}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <a className="tool" href={hrefOf({ page: "admin" })} style={{ textDecoration: "none" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
            <span className="t">{t("v3Admin")}</span>
          </a>
          <button className="avatar" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu} aria-label={`${t("v3Menu")}: ${name}`}>{initials(name)}</button>
          {menu && (
            <div className="menu" role="menu">
              <div style={{ padding: "8px 14px", fontSize: 12, color: "#5B6576" }}>{t("v3SignedInAs")}<br /><b style={{ color: "#1A2433", fontSize: 14 }}>{name}</b></div>
              <hr />
              <div className="langrow" role="group" aria-label={t("language")}>
                <span>🌐 {t("language")}</span>
                <span className="opts">
                  {LANG_LIST.map((l) => (
                    <button key={l} role="menuitemradio" aria-checked={l === lang} className={l === lang ? "on" : ""}
                      onClick={() => { setLang(l); void api("PUT", "/me/language", { language: l }).catch(() => undefined); }}>{l.toUpperCase()}</button>
                  ))}
                </span>
              </div>
              <hr />
              {f.can("dashboard.voir") && <a role="menuitem" href={hrefOf({ page: "dashboard" })} onClick={() => setMenu(false)}>📊 {t("v3Dashboard")}</a>}
              <button role="menuitem" onClick={() => { setMenu(false); setDlg("settings"); }}>⚙ {t("v3Settings")}</button>
              <button role="menuitem" onClick={() => { setMenu(false); setUiMode("legacy"); }}>↩ {t("v3OldView")}</button>
              <hr />
              <button role="menuitem" onClick={async () => { try { await api("POST", "/me/logout"); } catch { /* already gone */ } setAuth(null); location.replace("/"); }}>⏻ {t("v3Logout")}</button>
            </div>
          )}
        </div>
      </header>
      {children}
      {dlg === "settings" && <SettingsDialog onClose={() => setDlg(null)} onBackup={() => setDlg("backup")} />}
      {dlg === "backup" && <BackupImport onClose={() => setDlg(null)} />}
    </div>
  );
}
