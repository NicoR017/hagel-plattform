// Verwaltung: left menu + content. Each section lives in its own page file under domains/admin/.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { hrefOf, type Route } from "../../shared/route";
import { t } from "../../shared/i18n";
import { AppShell } from "../shell/AppShell";
import { BodyShopsPage } from "./BodyShops";
import { PartsCatalogPage } from "./PartsPage";
import { BillingPage } from "./BillingPage";
import { InsurerReportsPage } from "../reports/InsurerReports";
import { ColibriDevicesPage } from "../scans/ColibriDevices";
import { ALIAS, menuGroups, type Section } from "./menu";
import { stackTables } from "./stackTables";
import { Overview } from "./Overview";
import { UsersPage } from "./UsersPage";
import { RolesPage } from "./RolesPage";
import { SitesPage } from "./SitesPage";
import { InsurersPage } from "./InsurersPage";
import { CompaniesPage } from "./CompaniesPage";
import { MethodsPage } from "./MethodsPage";
import { PricesPage } from "./PricesPage";
import { TechniciansPage } from "./TechniciansPage";
import { WeeklyPage } from "./WeeklyPage";
import { AzurePage } from "./AzurePage";
import { AuditPage } from "./AuditPage";
import { OrgsPage } from "./OrgsPage";

export { isoWeekOf } from "./WeeklyPage";

interface Me {
  user: { id: string; email: string; name: string; isSuperadmin: boolean };
  organizations: { id: string; name: string }[];
  grants: { orgId: string; stationId: string | null; permissions: string[] }[];
}

export function AdminApp({ me, org, onOrg, route }: { me: Me; org: string; onOrg: (id: string) => void; route: Route }) {
  const perms = new Set(me.grants.filter((g) => g.orgId === org && g.stationId === null).flatMap((g) => g.permissions));
  const has = (p: string) => me.user.isSuperadmin || perms.has(p);
  // org-wide data managed from one site (a station manager has the right through his station's grant)
  const hasAny = (p: string) => me.user.isSuperadmin || me.grants.some((g) => g.orgId === org && g.permissions.includes(p));
  const groups = menuGroups(has, hasAny, me.user.isSuperadmin);
  const visible = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show) })).filter((g) => g.items.length);
  const all = visible.flatMap((g) => g.items.map((i) => i.k));
  const wanted = route.page === "admin" && route.tab ? ALIAS[route.tab] ?? (route.tab as Section) : "overview";
  const [cur, setCur] = useState<Section>(wanted);
  useEffect(() => { setCur(wanted); }, [wanted]);
  const current: Section = all.includes(cur) ? cur : "overview";
  // on a phone the menu is a row you scroll: keep the open section in view
  useEffect(() => { document.querySelector(".admmenu button.on")?.scrollIntoView?.({ inline: "center", block: "nearest" }); }, [current]);
  // phone: every table of the section becomes a list of cards (the column name goes in front of each value)
  const body$ = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = body$.current;
    if (!root) return;
    const run = () => stackTables(root);
    run();
    const mo = new MutationObserver(run);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [org, current]);
  const open = (k: Section) => { setCur(k); history.replaceState(null, "", hrefOf({ page: "admin", tab: k === "overview" ? undefined : k })); };

  let body: ReactNode;
  switch (current) {
    case "users": body = <UsersPage canManage={has("utilisateurs.gerer")} />; break;
    case "roles": body = <RolesPage />; break;
    case "sites": body = <SitesPage canManage={has("stations.gerer")} canInsurers={has("assurances.gerer")} />; break;
    case "scanners": body = <ColibriDevicesPage />; break;
    case "bodyshops": body = <BodyShopsPage canManage={hasAny("bodyshops.gerer")} canInsurers={hasAny("assurances.gerer") || hasAny("bodyshops.gerer")} />; break;
    case "insurers": body = <InsurersPage canMethods={has("methoden.gerer")} />; break;
    case "letterheads": body = <CompaniesPage />; break;
    case "methods": body = <MethodsPage />; break;
    case "prices": body = <PricesPage />; break;
    case "technicians": body = <TechniciansPage canUsers={has("utilisateurs.gerer")} />; break;
    case "weekly": body = <WeeklyPage />; break;
    case "reports": body = <InsurerReportsPage canSend={hasAny("rapports.envoyer")} canManage={hasAny("rapports.gerer")} />; break;
    case "parts": body = <PartsCatalogPage />; break;
    case "billing": body = <BillingPage />; break;
    case "azure": body = <AzurePage />; break;
    case "audit": body = <AuditPage />; break;
    case "orgs": body = <OrgsPage />; break;
    default: body = <Overview has={has} open={open} />;
  }
  return (
    <AppShell user={me.user} orgs={me.organizations} org={org} onOrg={onOrg} route={route} crumbs={[{ label: t("v3Stations"), to: { page: "list" } }, { label: t("v6AdminTitle") }]}>
      <div className="adm">
        <select className="admsel" aria-label={t("v7AdminSection")} value={current} onChange={(e) => open(e.target.value as Section)}>
          {visible.map((g) => <optgroup key={g.title} label={t(g.title)}>{g.items.map((i) => <option key={i.k} value={i.k}>{i.label}</option>)}</optgroup>)}
        </select>
        <aside className="admmenu" aria-label={t("v6AdminTitle")}>
          {visible.map((g) => (
            <div key={g.title} className="grp">
              <small>{t(g.title)}</small>
              {g.items.map((i) => <button key={i.k} className={current === i.k ? "on" : ""} aria-current={current === i.k ? "page" : undefined} onClick={() => open(i.k)}>{i.label}</button>)}
            </div>
          ))}
        </aside>
        <div className="admbody" key={org + current} ref={body$}>{body}</div>
      </div>
    </AppShell>
  );
}

export type { Route };
