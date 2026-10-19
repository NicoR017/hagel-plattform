import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, getAuth, getOrg, setAuth, setOrg } from "./api";
import { t } from "./i18n";
import { AuditPage, RolesPage, SitesPage, UsersPage, OrgsPage } from "./admin";

interface Me {
  user: { id: string; email: string; name: string; isSuperadmin: boolean };
  organizations: { id: string; name: string }[];
  grants: { orgId: string; stationId: string | null; permissions: string[] }[];
}

const params = new URLSearchParams(location.search);

export function App() {
  const path = location.pathname;
  if (path === "/login" && params.get("token")) return <VerifyLogin token={params.get("token")!} />;
  if (path === "/invite" && params.get("token")) return <AcceptInvite token={params.get("token")!} />;
  return getAuth() ? <Shell /> : <LoginPage />;
}

function Center({ children }: { children: ReactNode }) {
  return <div className="center"><div className="card"><h2>{t("appName")}</h2>{children}</div></div>;
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
        try { setAuth(await api("POST", "/auth/accept-invite", { token, name })); location.replace("/"); } catch (e) { setErr((e as Error).message); }
      }}>{t("createAccount")}</button></p>
    </Center>
  );
}

type Tab = "users" | "roles" | "sites" | "audit" | "orgs";

function Shell() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("users");
  const [org, setOrgState] = useState<string | null>(getOrg());
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const m = await api<Me>("GET", "/me");
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

  const perms = new Set(me.grants.filter((g) => g.orgId === org && g.stationId === null).flatMap((g) => g.permissions));
  const has = (p: string) => me.user.isSuperadmin || perms.has(p);
  const tabs: { k: Tab; label: string; show: boolean }[] = [
    { k: "users", label: t("users"), show: has("utilisateurs.gerer") },
    { k: "roles", label: t("roles"), show: has("roles.gerer") },
    { k: "sites", label: t("sites"), show: true },
    { k: "audit", label: t("audit"), show: has("audit.voir") },
    { k: "orgs", label: t("orgs"), show: me.user.isSuperadmin },
  ];
  const visible = tabs.filter((x) => x.show);
  const current = visible.some((x) => x.k === tab) ? tab : visible[0]?.k;

  return (
    <>
      <header>
        <b>{t("appName")}</b>
        <select value={org} onChange={(e) => { setOrg(e.target.value); setOrgState(e.target.value); }} aria-label={t("org")}>
          {me.organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <span>{me.user.name || me.user.email}</span>
        <button onClick={async () => { try { await api("POST", "/me/logout"); } catch { /* already gone */ } setAuth(null); location.replace("/"); }}>{t("logout")}</button>
      </header>
      <nav>{visible.map((x) => <button key={x.k} className={current === x.k ? "on" : ""} onClick={() => setTab(x.k)}>{x.label}</button>)}</nav>
      <main key={org}>
        {current === "users" && <UsersPage canManage={has("utilisateurs.gerer")} />}
        {current === "roles" && <RolesPage />}
        {current === "sites" && <SitesPage canManage={has("stations.gerer")} />}
        {current === "audit" && <AuditPage />}
        {current === "orgs" && <OrgsPage />}
        {!current && <p>{t("forbidden")}</p>}
      </main>
    </>
  );
}
