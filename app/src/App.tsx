import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, getAuth, getOrg, setAuth, setOrg } from "./api";
import { LANG_LIST, getLang, hasStoredLang, isLangValue, setLang, t, useLang } from "./i18n";
import { AuditPage, RolesPage, SitesPage, UsersPage, OrgsPage } from "./admin";
import { CampaignsPage, CompaniesPage, InsurersPage, TechniciansPage } from "./admin2";
import { FieldProvider, useField } from "./field/store";
import { List } from "./field/List";
import { VehicleScreen } from "./field/VehicleScreen";
import { Toasts } from "./field/toast";
import { useRoute } from "./field/route";
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
  return <div key={lang}>{page}</div>;
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
  return <div className="center"><div className="card"><div className="row"><h2 className="grow" style={{ margin: 0 }}>{t("appName")}</h2><LangSwitch /></div>{children}</div></div>;
}

function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Center>
      <p>{t("loginIntro")}</p>
      <label>{t("email")}</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      {err && <div className="err">{err}</div>}
      {sent && <div className="ok">{t("linkSent")}</div>}
      <p><button className="btn" onClick={async () => {
        try { await api("POST", "/auth/request-link", { email }); setSent(true); setErr(""); } catch (e) { setErr((e as Error).message); }
      }}>{t("sendLink")}</button></p>
    </Center>
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
  const [err, setErr] = useState("");
  return (
    <Center>
      <h3>{t("inviteTitle")}</h3>
      <p>{t("inviteIntro")}</p>
      <label>{t("name")}</label>
      <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      {err && <div className="err">{err}</div>}
      <p><button className="btn" disabled={!name.trim()} onClick={async () => {
        try { setAuth(await api("POST", "/auth/accept-invite", { token, name, language: getLang() })); location.replace("/"); } catch (e) { setErr((e as Error).message); }
      }}>{t("createAccount")}</button></p>
    </Center>
  );
}


type AdminTab = "users" | "roles" | "sites" | "insurers" | "campaigns" | "letterheads" | "technicians" | "audit" | "orgs";

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
  if (route.page === "vehicle") return <VehicleScreen id={route.id} tab={route.tab} />;
  if (route.page === "admin") return <AdminShell me={me} org={org} onOrg={onOrg} />;
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
  const perms = new Set(me.grants.filter((g) => g.orgId === org && g.stationId === null).flatMap((g) => g.permissions));
  const has = (p: string) => me.user.isSuperadmin || perms.has(p);
  const tabs: { k: AdminTab; label: string; show: boolean }[] = [
    { k: "users", label: t("users"), show: has("utilisateurs.gerer") },
    { k: "roles", label: t("roles"), show: has("roles.gerer") },
    { k: "sites", label: t("sites"), show: true },
    { k: "insurers", label: t("insurers"), show: has("assurances.gerer") },
    { k: "campaigns", label: t("campaigns"), show: has("campagnes.gerer") },
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
        <a href="#/" style={{ color: "#fff", textDecoration: "none", fontWeight: 700 }}>‹ {t("vehicles")}</a>
        <b>{t("appName")}</b>
        <select value={org} onChange={(e) => onOrg(e.target.value)} aria-label={t("org")}>
          {me.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <LangSwitch signedIn />
        <span>{me.user.name || me.user.email}</span>
        <button onClick={async () => { try { await api("POST", "/me/logout"); } catch { /* already gone */ } setAuth(null); location.replace("/"); }}>{t("logout")}</button>
      </header>
      <nav>{visible.map((x) => <button key={x.k} className={current === x.k ? "on" : ""} onClick={() => setTab(x.k)}>{x.label}</button>)}</nav>
      <main key={org}>
        {current === "users" && <UsersPage canManage={has("utilisateurs.gerer")} />}
        {current === "roles" && <RolesPage />}
        {current === "sites" && <SitesPage canManage={has("stations.gerer")} />}
        {current === "insurers" && <InsurersPage />}
        {current === "campaigns" && <CampaignsPage />}
        {current === "letterheads" && <CompaniesPage />}
        {current === "technicians" && <TechniciansPage canUsers={has("utilisateurs.gerer")} />}
        {current === "audit" && <AuditPage />}
        {current === "orgs" && <OrgsPage />}
        {!current && <p>{t("forbidden")}</p>}
      </main>
    </>
  );
}
