import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, getAuth, getOrg, setAuth, setOrg } from "./api";
import { LANG_LIST, getLang, hasStoredLang, isLangValue, setLang, t, useLang } from "./i18n";
import { Admin3 } from "./v3/Admin3";
import { Shell3 } from "./v3/Shell3";
import { AuditPage, RolesPage, SitesPage, UsersPage, OrgsPage } from "./admin";
import { AzurePage, CompaniesPage, InsurersPage, TechniciansPage } from "./admin2";
import { FieldProvider, useField } from "./field/store";
import { List } from "./field/List";
import { VehicleScreen } from "./field/VehicleScreen";
import { Dashboard } from "./field/Dashboard";
import { Toasts } from "./field/toast";
import { useRoute } from "./field/route";
import { useUiMode } from "./field/uiMode";
import { V3Routes } from "./v3/Routes3";
import { EnvBanner, useAppConfig } from "./env";
import "./field/field.css";

interface Me {
  user: { id: string; email: string; name: string; language: string; isSuperadmin: boolean };
  organizations: { id: string; name: string }[];
  grants: { orgId: string; stationId: string | null; permissions: string[] }[];
}

const params = new URLSearchParams(location.search);

export function App() {
  const lang = useLang(); // the whole tree is re-created when the language changes: one language everywhere
  const path = location.pathname;
  let page: ReactNode;
  if (path === "/login" && params.get("token")) page = <VerifyLogin token={params.get("token")!} />;
  else if (path === "/invite" && params.get("token")) page = <AcceptInvite token={params.get("token")!} />;
  else page = getAuth() ? <Shell /> : <LoginPage />;
  return <div key={lang}><EnvBanner />{page}</div>;
}

/** DE | EN switch. When signed in, the choice is also saved on the account (used for e-mails). */
function LangSwitch({ signedIn }: { signedIn?: boolean }) {
  const lang = useLang();
  return (
    <span className="langsw" role="group" aria-label={t("language")}>
      {LANG_LIST.map((l) => (
        <button key={l} className={l === lang ? "on" : ""} aria-pressed={l === lang} onClick={() => {
          setLang(l);
          if (signedIn) void api("PUT", "/me/language", { language: l }).catch(() => undefined);
        }}>{l.toUpperCase()}</button>
      ))}
    </span>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <div className="center"><div className="card"><div className="row"><div className="grow"><img src="/pdr-logo-white.png" alt={t("appName")} style={{ display: "block", height: 34, width: "auto", background: "#16233f", padding: "8px 14px", borderRadius: 10 }} /></div><LangSwitch /></div>{children}</div></div>;
}

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const signIn = async () => {
    try { setAuth(await api("POST", "/auth/login", { email: email.trim(), password, device: navigator.userAgent.slice(0, 120) })); location.replace("/"); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Center>
      <form onSubmit={(e) => { e.preventDefault(); void signIn(); }}>
        <p>{t("loginIntro")}</p>
        <label>{t("email")}</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <label>{t("password")}</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {err && <div className="err">{err}</div>}
        {sent && <div className="ok">{t("linkSent")}</div>}
        <p><button className="btn" type="submit" disabled={!email.trim() || !password}>{t("login")}</button></p>
      </form>
      <p style={{ fontSize: 13 }}>
        <a href="#" onClick={async (e) => {
          e.preventDefault();
          try { await api("POST", "/auth/request-link", { email: email.trim() }); setSent(true); setErr(""); } catch (x) { setErr((x as Error).message); }
        }}>{t("forgotPassword")}</a>
      </p>
      <p style={{ fontSize: 12, opacity: 0.7 }}>{t("firstLoginHint")}</p>
    </Center>
  );
}

/** Set (no password yet / fresh sign-in) or change the password. Other devices are signed out afterwards. */
function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  useEffect(() => { api<{ set: boolean }>("GET", "/me/password").then((r) => setIsSet(r.set)).catch(() => setIsSet(false)); }, []);
  const save = async () => {
    if (pw.length < 10) { setErr(t("passwordShort")); return; }
    if (pw !== pw2) { setErr(t("passwordMismatch")); return; }
    try {
      await api("PUT", "/me/password", { password: pw, ...(cur ? { current_password: cur } : {}) });
      setOk(true); setErr("");
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 50, overflowY: "auto" }}>
     <div className="center">
      <form className="card" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h3>{isSet ? t("passwordChange") : t("passwordSet")}</h3>
        {isSet && <><label>{t("passwordCurrent")}</label><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></>}
        <label>{t("passwordNew")}</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <label>{t("passwordConfirm")}</label>
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        {err && <div className="err">{err}</div>}
        {ok && <div className="ok" style={{ fontWeight: 700, padding: "8px 0" }}>✓ {t("passwordSaved")}</div>}
        <p>
          {!ok && <button className="btn" type="submit">{t("save")}</button>}{" "}
          <button className="btn" type="button" onClick={onClose}>{ok ? "OK" : t("cancel")}</button>
        </p>
      </form>
     </div>
    </div>
  );
}

function VerifyLogin({ token }: { token: string }) {
  const [err, setErr] = useState("");
  useEffect(() => {
    api("POST", "/auth/verify", { token, device: navigator.userAgent.slice(0, 120) })
      .then((a) => { setAuth(a); location.replace("/"); })
      .catch(() => setErr(t("linkInvalid")));
  }, [token]);
  return <Center>{err ? <div className="err">{err}</div> : <p>{t("verifying")}</p>}</Center>;
}

function AcceptInvite({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  return (
    <Center>
      <h3>{t("inviteTitle")}</h3>
      <p>{t("inviteIntro")}</p>
      <label>{t("name")}</label>
      <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      <label>{t("passwordNew")}</label>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      <label>{t("passwordConfirm")}</label>
      <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      {err && <div className="err">{err}</div>}
      <p><button className="btn" disabled={!name.trim() || pw.length < 10} onClick={async () => {
        if (pw !== pw2) { setErr(t("passwordMismatch")); return; }
        try { setAuth(await api("POST", "/auth/accept-invite", { token, name, password: pw, language: getLang() })); location.replace("/"); } catch (e) { setErr((e as Error).message); }
      }}>{t("createAccount")}</button></p>
    </Center>
  );
}


type AdminTab = "users" | "roles" | "sites" | "azure" | "insurers" | "letterheads" | "technicians" | "audit" | "orgs";

function Shell() {
  const [me, setMe] = useState<Me | null>(null);
  const [org, setOrgState] = useState<string | null>(getOrg());
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const m = await api<Me>("GET", "/me");
      // language: a choice made on this device wins (and is saved on the account); otherwise adopt the account's language
      if (hasStoredLang()) { if (m.user.language !== getLang()) void api("PUT", "/me/language", { language: getLang() }).catch(() => undefined); }
      else if (isLangValue(m.user.language)) setLang(m.user.language);
      setMe(m);
      const cur = m.organizations.find((o) => o.id === getOrg()) ?? m.organizations[0];
      if (cur) { setOrg(cur.id); setOrgState(cur.id); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setAuth(null); location.replace("/"); }
      else setErr((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (err) return <Center><div className="err">{err}</div></Center>;
  if (!me || !org) return <Center><p>{t("loading")}</p></Center>;
  return (
    <FieldProvider userId={me.user.id} orgId={org} key={org}>
      <Routes me={me} org={org} onOrg={(id) => { setOrg(id); setOrgState(id); }} />
      <Toasts />
    </FieldProvider>
  );
}

function Routes({ me, org, onOrg }: { me: Me; org: string; onOrg: (id: string) => void }) {
  const route = useRoute();
  const f = useField();
  const cfg = useAppConfig();
  const ui = useUiMode(cfg?.uiV3Default);
  if (route.page === "vehicle" && ui === "legacy") return <VehicleScreen id={route.id} tab={route.tab} ctx={route.ctx} backTo={{ page: "list" }} />;
  if (route.page === "dashboard") {
    return ui === "v3"
      ? <Shell3 user={me.user} orgs={me.organizations} org={org} onOrg={onOrg} route={route} crumbs={[{ label: t("v3Stations"), to: { page: "list" } }, { label: t("dashboard") }]}><Dashboard embedded /></Shell3>
      : <Dashboard />;
  }
  if (route.page === "admin") return ui === "v3" ? <Admin3 me={me} org={org} onOrg={onOrg} route={route} /> : <AdminShell me={me} org={org} onOrg={onOrg} />;
  // the old flat list stays reachable: in the old interface, and for the filtered list opened from the dashboard
  if (ui === "v3" && !(route.page === "list" && route.dash)) return <V3Routes me={me} org={org} onOrg={onOrg} route={route} />;
  const orgSwitch = me.organizations.length > 1 ? (
    <select value={org} onChange={(e) => onOrg(e.target.value)} aria-label={t("org")} style={{ minHeight: 44, borderRadius: 10, border: "none", padding: "0 8px", fontWeight: 700 }}>
      {me.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  ) : null;
  void f;
  return <List userName={me.user.name || me.user.email} orgSwitch={orgSwitch} />;
}

function AdminShell({ me, org, onOrg }: { me: Me; org: string; onOrg: (id: string) => void }) {
  const [tab, setTab] = useState<AdminTab>("users");
  const [pwOpen, setPwOpen] = useState(false);
  const perms = new Set(me.grants.filter((g) => g.orgId === org && g.stationId === null).flatMap((g) => g.permissions));
  const has = (p: string) => me.user.isSuperadmin || perms.has(p);
  const tabs: { k: AdminTab; label: string; show: boolean }[] = [
    { k: "users", label: t("users"), show: has("utilisateurs.gerer") },
    { k: "roles", label: t("roles"), show: has("roles.gerer") },
    { k: "sites", label: t("sites"), show: true },
    { k: "azure", label: "Azure", show: has("stations.gerer") },
    { k: "insurers", label: t("insurers"), show: has("assurances.gerer") },
    { k: "letterheads", label: t("letterheads"), show: has("parametres.gerer") },
    { k: "technicians", label: t("technicians"), show: has("parametres.gerer") },
    { k: "audit", label: t("audit"), show: has("audit.voir") },
    { k: "orgs", label: t("orgs"), show: me.user.isSuperadmin },
  ];
  const visible = tabs.filter((x) => x.show);
  const current = visible.some((x) => x.k === tab) ? tab : visible[0]?.k;
  return (
    <>
      <header>
        <a href="#/" style={{ color: "#fff", textDecoration: "none", fontWeight: 700, minHeight: 44, display: "inline-flex", alignItems: "center" }}>‹ {t("back")}</a>
        <b>{t("appName")}</b>
        <select value={org} onChange={(e) => onOrg(e.target.value)} aria-label={t("org")}>
          {me.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <LangSwitch signedIn />
        <span>{me.user.name || me.user.email}</span>
        <button onClick={() => setPwOpen(true)}>{t("password")}</button>
        <button onClick={async () => { try { await api("POST", "/me/logout"); } catch { /* already gone */ } setAuth(null); location.replace("/"); }}>{t("logout")}</button>
      </header>
      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
      <nav>{visible.map((x) => <button key={x.k} className={current === x.k ? "on" : ""} onClick={() => setTab(x.k)}>{x.label}</button>)}</nav>
      <main key={org}>
        {current === "users" && <UsersPage canManage={has("utilisateurs.gerer")} />}
        {current === "roles" && <RolesPage />}
        {current === "sites" && <SitesPage canManage={has("stations.gerer")} />}
        {current === "azure" && <AzurePage />}
        {current === "insurers" && <InsurersPage />}
        {current === "letterheads" && <CompaniesPage />}
        {current === "technicians" && <TechniciansPage canUsers={has("utilisateurs.gerer")} />}
        {current === "audit" && <AuditPage />}
        {current === "orgs" && <OrgsPage />}
        {!current && <p>{t("forbidden")}</p>}
      </main>
    </>
  );
}
