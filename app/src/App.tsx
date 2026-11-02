import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, getAuth, getOrg, setAuth, setOrg } from "./api";
import { LANG_LIST, getLang, hasStoredLang, isLangValue, setLang, t, useLang } from "./i18n";
import { Admin3 } from "./v3/Admin3";
import { Shell3 } from "./v3/Shell3";
import { FieldProvider, useField } from "./field/store";
import { List } from "./field/List";
import { Dashboard } from "./field/Dashboard";
import { Toasts } from "./field/toast";
import { useRoute, type Route } from "./field/route";
import { V3Routes } from "./v3/Routes3";
import { EnvBanner } from "./env";
import "./field/field.css";

interface Me {
  user: { id: string; email: string; name: string; language: string; isSuperadmin: boolean };
  organizations: { id: string; name: string }[];
  grants: { orgId: string; stationId: string | null; permissions: string[] }[];
}

const params = new URLSearchParams(location.search);

export function App() {
  const lang = useLang();
  const path = location.pathname;
  let page: ReactNode;
  if (path === "/login" && params.get("token")) page = <VerifyLogin token={params.get("token")!} />;
  else if (path === "/invite" && params.get("token")) page = <AcceptInvite token={params.get("token")!} />;
  else page = getAuth() ? <Shell /> : <LoginPage />;
  return <div key={lang}><EnvBanner />{page}</div>;
}

function LangSwitch() {
  const lang = useLang();
  return (
    <span className="langsw" role="group" aria-label={t("language")}>
      {LANG_LIST.map((l) => (
        <button key={l} className={l === lang ? "on" : ""} aria-pressed={l === lang} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

function Center({ children }: { children: ReactNode }) {
  return (
    <div className="center">
      <div className="card">
        <div className="row">
          <div className="grow">
            <img
              src="/pdr-logo-white.png"
              alt={t("appName")}
              style={{ display: "block", height: 34, width: "auto", background: "#16233f", padding: "8px 14px", borderRadius: 10 }}
            />
          </div>
          <LangSwitch />
        </div>
        {children}
      </div>
    </div>
  );
}

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  const signIn = async () => {
    try {
      setAuth(await api("POST", "/auth/login", { email: email.trim(), password, device: navigator.userAgent.slice(0, 120) }));
      location.replace("/");
    } catch (e) {
      setErr((e as Error).message);
    }
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
        <a
          href="#"
          onClick={async (e) => {
            e.preventDefault();
            try {
              await api("POST", "/auth/request-link", { email: email.trim() });
              setSent(true);
              setErr("");
            } catch (x) {
              setErr((x as Error).message);
            }
          }}
        >
          {t("forgotPassword")}
        </a>
      </p>
      <p style={{ fontSize: 12, opacity: 0.7 }}>{t("firstLoginHint")}</p>
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
      <p>
        <button
          className="btn"
          disabled={!name.trim() || pw.length < 10}
          onClick={async () => {
            if (pw !== pw2) { setErr(t("passwordMismatch")); return; }
            try {
              setAuth(await api("POST", "/auth/accept-invite", { token, name, password: pw, language: getLang() }));
              location.replace("/");
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          {t("createAccount")}
        </button>
      </p>
    </Center>
  );
}

function Shell() {
  const [me, setMe] = useState<Me | null>(null);
  const [org, setOrgState] = useState<string | null>(getOrg());
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const m = await api<Me>("GET", "/me");
      if (hasStoredLang()) {
        if (m.user.language !== getLang()) void api("PUT", "/me/language", { language: getLang() }).catch(() => undefined);
      } else if (isLangValue(m.user.language)) {
        setLang(m.user.language);
      }
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
      <AppRoutes me={me} org={org} onOrg={(id) => { setOrg(id); setOrgState(id); }} />
      <Toasts />
    </FieldProvider>
  );
}

/** Technicians / headliners stay on the field screens only. */
function routeForUser(route: Route, fieldView: boolean): Route {
  if (!fieldView) return route;
  if (route.page === "admin" || route.page === "dashboard" || route.page === "scans" || route.page === "calendar") {
    return { page: "list" };
  }
  return route;
}

function AppRoutes({ me, org, onOrg }: { me: Me; org: string; onOrg: (id: string) => void }) {
  const rawRoute = useRoute();
  const f = useField();
  const fieldView = !!f.refs?.me.fieldView;
  const route = routeForUser(rawRoute, fieldView);
  const shell = {
    user: me.user,
    orgs: me.organizations,
    org,
    onOrg,
    route,
  };

  if (route.page === "dashboard") {
    return (
      <Shell3 {...shell} crumbs={[{ label: t("v3Stations"), to: { page: "list" } }, { label: t("dashboard") }]}>
        <Dashboard embedded />
      </Shell3>
    );
  }

  if (route.page === "admin") {
    return <Admin3 me={me} org={org} onOrg={onOrg} route={route} />;
  }

  // Dashboard KPI click: filtered vehicle list (same data, current shell)
  if (route.page === "list" && route.dash) {
    return (
      <Shell3 {...shell} crumbs={[{ label: t("v3Stations"), to: { page: "list" } }, { label: t("filterActive") }]}>
        <List embedded />
      </Shell3>
    );
  }

  return <V3Routes me={me} org={org} onOrg={onOrg} route={route} />;
}
