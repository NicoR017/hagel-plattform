// Verwaltung in the new interface: left menu + content, like the vehicle detail. The existing screens (users, roles, stations, insurers,
// letterheads, Azure, audit, organisations) are reused inside it; new here: overview, calculation methods, weekly report.
import { isPlace } from "../field/places";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { computeVehicle, DEFAULT_AW_PARAMS, DEFAULT_SETTINGS, ES_MATRIX_DEFAULT, type CalcMethodDef, type CalcVehicle, type EsMatrix } from "@hagel/calc";
import { generateTechnicianWorksheets, techPdfFileName, eur, type TechSheetData } from "@hagel/documents";
import type { ClientMethod } from "@hagel/shared";
import { api } from "../api";
import { act, AuditPage, Card, Err, OrgsPage, RolesPage, SitesPage, UsersPage, useLoad } from "../admin";
import { AzurePage, CompaniesPage, InsurersPage, TechniciansPage } from "../admin2";
import { SettingsDialog } from "../field/Dialogs";
import { shareOrDownload } from "../field/docs";
import { hrefOf, type Route } from "../field/route";
import { toast } from "../field/toast";
import { confirmDialog } from "../field/ui";
import { fmtDateTime, getLang, locale, t, tOr, type Key } from "../i18n";
import { Shell3 } from "./Shell3";
import { BodyShopsPage } from "./BodyShops";

interface Me {
  user: { id: string; email: string; name: string; isSuperadmin: boolean };
  organizations: { id: string; name: string }[];
  grants: { orgId: string; stationId: string | null; permissions: string[] }[];
}

type Section = "overview" | "users" | "roles" | "sites" | "bodyshops" | "insurers" | "methods" | "technicians" | "weekly" | "letterheads" | "prices" | "azure" | "audit" | "orgs";

/** Map of the old tab names (bookmarks) to the new sections */
const ALIAS: Record<string, Section> = { users: "users", roles: "roles", sites: "sites", azure: "azure", insurers: "insurers", letterheads: "letterheads", technicians: "technicians", audit: "audit", orgs: "orgs" };

export function Admin3({ me, org, onOrg, route }: { me: Me; org: string; onOrg: (id: string) => void; route: Route }) {
  const perms = new Set(me.grants.filter((g) => g.orgId === org && g.stationId === null).flatMap((g) => g.permissions));
  const has = (p: string) => me.user.isSuperadmin || perms.has(p);
  // org-wide data managed from one site (a station manager has the right through his station's grant)
  const hasAny = (p: string) => me.user.isSuperadmin || me.grants.some((g) => g.orgId === org && g.permissions.includes(p));
  // "sites" and the prices are open to every manager of something; the rest follows its permission
  const groups: { title: Key; items: { k: Section; label: string; show: boolean }[] }[] = [
    { title: "v6MenuOverview", items: [{ k: "overview", label: t("v6MenuOverview"), show: true }] },
    { title: "v6MenuPeople", items: [
      { k: "users", label: t("users"), show: has("utilisateurs.gerer") },
      { k: "roles", label: t("roles"), show: has("roles.gerer") },
    ] },
    { title: "v6MenuStructure", items: [
      { k: "sites", label: t("sites"), show: true },
      { k: "bodyshops", label: t("v8BodyShops"), show: hasAny("bodyshops.gerer") },
      { k: "insurers", label: t("insurers"), show: has("assurances.gerer") },
      { k: "letterheads", label: t("letterheads"), show: has("parametres.gerer") },
    ] },
    { title: "v6MenuCalc", items: [
      { k: "methods", label: t("v6MenuMethods"), show: has("methoden.gerer") },
      { k: "prices", label: t("v6MenuPrices"), show: has("parametres.gerer") },
    ] },
    { title: "v6MenuWork", items: [
      { k: "technicians", label: t("v6MenuTech"), show: has("parametres.gerer") },
      { k: "weekly", label: t("v6MenuWeekly"), show: has("wochenbericht.voir") },
    ] },
    { title: "v6MenuSystem", items: [
      { k: "azure", label: t("v6MenuAzure"), show: has("stations.gerer") },
      { k: "audit", label: t("audit"), show: has("audit.voir") },
      { k: "orgs", label: t("orgs"), show: me.user.isSuperadmin },
    ] },
  ];
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
    case "bodyshops": body = <BodyShopsPage canManage={hasAny("bodyshops.gerer")} canInsurers={hasAny("assurances.gerer") || hasAny("bodyshops.gerer")} />; break;
    case "insurers": body = <InsurersPage canMethods={has("methoden.gerer")} />; break;
    case "letterheads": body = <CompaniesPage />; break;
    case "methods": body = <MethodsPage />; break;
    case "prices": body = <PricesPage />; break;
    case "technicians": body = <TechniciansPage canUsers={has("utilisateurs.gerer")} />; break;
    case "weekly": body = <WeeklyPage />; break;
    case "azure": body = <AzurePage />; break;
    case "audit": body = <AuditPage />; break;
    case "orgs": body = <OrgsPage />; break;
    default: body = <Overview has={has} open={open} />;
  }
  return (
    <Shell3 user={me.user} orgs={me.organizations} org={org} onOrg={onOrg} route={route} crumbs={[{ label: t("v3Stations"), to: { page: "list" } }, { label: t("v6AdminTitle") }]}>
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
    </Shell3>
  );
}

/** Labels the cells of every table of the section with their column name (CSS shows them as cards on a phone); the calculation grids (`mtab`) stay tables. */
function stackTables(root: HTMLElement) {
  root.querySelectorAll("table").forEach((tb) => {
    if (tb.classList.contains("mtab")) return;
    tb.classList.add("stack");
    const heads = Array.from(tb.querySelectorAll("thead th")).map((th) => (th.textContent ?? "").trim());
    tb.querySelectorAll("tr").forEach((tr) => {
      if (tr.parentElement?.tagName === "THEAD") return;
      let col = 0;
      Array.from(tr.children).forEach((c, i, all) => {
        const el = c as HTMLElement, span = Number(el.getAttribute("colspan") ?? 1);
        if (span > 1) el.classList.add("wide");
        else if (heads[col] && el.getAttribute("data-label") !== heads[col]) el.setAttribute("data-label", heads[col]);
        if (i === all.length - 1 && i > 0 && el.querySelector("button, a.btn")) el.classList.add("act");
        col += span;
      });
    });
  });
}

// ------------------------------------------------------------------ overview
function useMaybe<T>(path: string, allowed: boolean) { return useLoad<T>(allowed ? path : ""); }

function Overview({ has, open }: { has: (p: string) => boolean; open: (k: Section) => void }) {
  const users = useMaybe<{ status: string }[]>("/admin/users", has("utilisateurs.gerer"));
  const invs = useMaybe<unknown[]>("/admin/invitations", has("utilisateurs.gerer"));
  const sites = useLoad<{ id: string; capacite: number; present?: number; type: string }[]>("/admin/stations");
  const roles = useMaybe<{ isSystem: boolean }[]>("/admin/roles", has("roles.gerer"));
  const az = useMaybe<{ configured: boolean; unmappedCustomers: unknown[]; unmappedLocations: unknown[]; lastRuns: { ok: boolean | null; at: string }[] }>("/admin/azure/status", has("stations.gerer"));
  const log = useMaybe<{ id: string; at: string; action: string; entity: string }[]>("/admin/audit?limit=8", has("audit.voir"));
  const full = (sites.data ?? []).filter((s) => isPlace(s) && s.capacite > 0 && (s.present ?? 0) >= s.capacite).length;
  const lastRun = az.data?.lastRuns?.[0];
  const azState = !az.data ? "…" : !az.data.configured ? t("v6AzureOff") : lastRun && lastRun.ok === false ? t("v6AzureErr") : t("v6AzureOk");
  const cards: { k: Section; show: boolean; title: string; big: ReactNode; sub: string }[] = [
    { k: "users", show: has("utilisateurs.gerer"), title: t("v6KpiUsers"), big: (users.data ?? []).filter((u) => u.status === "active").length, sub: `${invs.data?.length ?? 0} ${t("v6KpiInvites")}` },
    { k: "azure", show: has("stations.gerer"), title: t("v6KpiAzure"), big: azState, sub: `${(az.data?.unmappedCustomers.length ?? 0) + (az.data?.unmappedLocations.length ?? 0)} ${t("v6KpiAzureOpen")}` },
    { k: "sites", show: true, title: t("v6KpiStations"), big: sites.data?.filter(isPlace).length ?? "…", sub: `${full} ${t("v6KpiFull")}` },
    { k: "roles", show: has("roles.gerer"), title: t("v6KpiRoles"), big: roles.data?.length ?? "…", sub: t("v6KpiRolesSub") },
  ];
  return (
    <>
      <div className="kpis">
        {cards.filter((c) => c.show).map((c) => (
          <button key={c.k} className="kpi" onClick={() => open(c.k)}><small>{c.title}</small><b>{c.big}</b><span>{c.sub}</span></button>
        ))}
      </div>
      {has("audit.voir") && (
        <Card title={t("v6LastAudit")} actions={<button className="btn sec" onClick={() => open("audit")}>{t("audit")}</button>}>
          <Err msg={log.err} />
          <table><tbody>{(log.data ?? []).map((e) => <tr key={e.id}><td>{fmtDateTime(e.at)}</td><td>{tOr("a." + e.action, e.action)}</td><td>{tOr("e." + e.entity, e.entity)}</td></tr>)}</tbody></table>
        </Card>
      )}
    </>
  );
}

function PricesPage() {
  const [dlg, setDlg] = useState(false);
  return (
    <Card title={t("v6MenuPrices")}>
      <p className="muted" style={{ marginTop: 0 }}>{t("v6PricesHint")}</p>
      <button className="btn" onClick={() => setDlg(true)}>{t("v6OpenSettings")}</button>
      {dlg && <SettingsDialog onClose={() => setDlg(false)} onBackup={() => setDlg(false)} />}
    </Card>
  );
}

// ------------------------------------------------------------------ calculation methods
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? 0 : Number(v));

function Num({ label, value, onChange, disabled, step }: { label: string; value: number; onChange: (n: number) => void; disabled?: boolean; step?: number }) {
  return <div><label>{label}</label><input type="number" step={step ?? "any"} value={value} disabled={disabled} onChange={(e) => onChange(num(e.target.value))} /></div>;
}

function AwEditor({ p, set, ro }: { p: Json; set: (p: Json) => void; ro: boolean }) {
  const up = (path: (string | number)[], v: number) => { const n = clone(p); let o = n; for (const k of path.slice(0, -1)) o = o[k]; o[path[path.length - 1]] = v; set(n); };
  const ex = (cls: "10" | "12") => (["ruest", "greif", "finishPer", "finishCap", "hohl", "verbr"] as const).map((k) => {
    const label = { ruest: t("v6MRuest"), greif: t("v6MGreif"), finishPer: t("v6MFinishPer"), finishCap: t("v6MFinishCap"), hohl: t("v6MHohl"), verbr: t("v6MVerbr") }[k];
    return <Num key={k} label={`${label}`} value={p.extras[cls][k]} disabled={ro} onChange={(v) => up(["extras", cls, k], v)} />;
  });
  return (
    <>
      <div className="mgrid">
        <Num label={t("v6MVat")} value={p.vat} step={0.01} disabled={ro} onChange={(v) => up(["vat"], v)} />
        <Num label={t("v6MAlu")} value={p.aluFactor} step={0.05} disabled={ro} onChange={(v) => up(["aluFactor"], v)} />
        <Num label={t("v6MKleber")} value={p.kleberFactor} step={0.05} disabled={ro} onChange={(v) => up(["kleberFactor"], v)} />
        <Num label={t("v6MPtp")} value={p.ptpFactor} step={0.05} disabled={ro} onChange={(v) => up(["ptpFactor"], v)} />
      </div>
      <h4>{t("v6MExtras")} 10</h4><div className="mgrid">{ex("10")}</div>
      <h4>{t("v6MExtras")} 12</h4><div className="mgrid">{ex("12")}</div>
      <h4>{t("v6MKleberMat")}</h4>
      <div className="mgrid">
        <Num label={t("v6MUpTo2")} value={p.kleberMaterial.upTo2} disabled={ro} onChange={(v) => up(["kleberMaterial", "upTo2"], v)} />
        <Num label={t("v6MUpTo5")} value={p.kleberMaterial.upTo5} disabled={ro} onChange={(v) => up(["kleberMaterial", "upTo5"], v)} />
        <Num label={t("v6MMore")} value={p.kleberMaterial.more} disabled={ro} onChange={(v) => up(["kleberMaterial", "more"], v)} />
        <Num label={t("v6MHohlMat")} value={p.hohlraumMaterial} disabled={ro} onChange={(v) => up(["hohlraumMaterial"], v)} />
      </div>
    </>
  );
}

function MatrixEditor({ p, set, ro }: { p: { esMatrix: EsMatrix | null }; set: (p: Json) => void; ro: boolean }) {
  const m = (p.esMatrix ?? ES_MATRIX_DEFAULT) as Json;
  const put = (fn: (n: Json) => void) => { const n = clone(m); fn(n); set({ esMatrix: n }); };
  return (
    <>
      <div className="mgrid">
        <Num label={t("v6MVat")} value={m.vat} step={0.01} disabled={ro} onChange={(v) => put((n) => { n.vat = v; })} />
      </div>
      <h4>{t("v6MCategories")}</h4>
      <table className="mtab"><thead><tr><th>{t("v6MCat")}</th><th>{t("v6MFrom")}</th><th>{t("v6MTo")}</th><th>{t("v6MCap")}</th></tr></thead>
        <tbody>{m.categories.map((c: Json, i: number) => (
          <tr key={i}>
            <td><input value={c.cat} disabled={ro} onChange={(e) => put((n) => { n.categories[i].cat = e.target.value; })} /></td>
            <td><input type="number" value={c.from} disabled={ro} onChange={(e) => put((n) => { n.categories[i].from = num(e.target.value); })} /></td>
            <td><input type="number" value={c.to ?? ""} placeholder="∞" disabled={ro} onChange={(e) => put((n) => { n.categories[i].to = e.target.value === "" ? null : num(e.target.value); })} /></td>
            <td><input type="number" step="any" value={c.cap_h} disabled={ro} onChange={(e) => put((n) => { n.categories[i].cap_h = num(e.target.value); })} /></td>
          </tr>
        ))}</tbody></table>
      <h4>{t("v6MAdj")}</h4>
      <div className="mgrid">
        <Num label={t("v6MAdjAlu")} value={m.adjustments.alu_per_vehicle_h} disabled={ro} onChange={(v) => put((n) => { n.adjustments.alu_per_vehicle_h = v; })} />
        <Num label={t("v6MAdjNew")} value={m.adjustments.erneuern_per_panel_h} disabled={ro} onChange={(v) => put((n) => { n.adjustments.erneuern_per_panel_h = v; })} />
        <Num label={t("v6MAdjKleber")} value={m.adjustments.kleber_share_pct} disabled={ro} onChange={(v) => put((n) => { n.adjustments.kleber_share_pct = v; })} />
        <Num label={t("v6MAdjPtp")} value={m.adjustments.ptp_share_pct} disabled={ro} onChange={(v) => put((n) => { n.adjustments.ptp_share_pct = v; })} />
      </div>
      <h4>{t("v6MKick")}</h4>
      <table className="mtab"><tbody>{m.kickback_eur.map((k: Json, i: number) => (
        <tr key={i}>
          <td>{k.else ? t("v6MKickElse") : `${t("v6MKickUpTo")} ${k.max_h ?? k.lt_h}`}</td>
          <td><input type="number" step="any" value={k.eur} disabled={ro} onChange={(e) => put((n) => { n.kickback_eur[i].eur = num(e.target.value); })} /></td>
        </tr>
      ))}</tbody></table>
    </>
  );
}

const SAMPLE_PANELS = { haube: { key: "haube", dents: { "20": 12, "30": 6 } } };

/** Live test: the sample vehicle computed with the parameters currently on screen (what the engine would give) */
function TestCalc({ engine, country, params }: { engine: "aw" | "matrix"; country: "DE" | "ES"; params: Json }) {
  const r = useMemo(() => {
    try {
      const v = { land: country, panels: SAMPLE_PANELS, stundensatz: country === "ES" ? DEFAULT_SETTINGS.rateES : DEFAULT_SETTINGS.rateDE } as unknown as CalcVehicle;
      return computeVehicle(v, DEFAULT_SETTINGS, { engine, params } as unknown as CalcMethodDef);
    } catch { return null; }
  }, [engine, country, params]);
  return (
    <div className="testcalc">
      <b>{t("v6MTest")}</b><div className="muted">{t("v6MTestHint")}</div>
      {r ? <div className="row" style={{ gap: 24, marginTop: 6 }}><span>{t("v6MTestAw")}: <b>{(r.es?.totH ?? r.totalAW)?.toLocaleString(locale())}</b></span><span>{t("v6MTestNet")}: <b>{eur(r.netto)}</b></span></div> : <span className="muted">—</span>}
    </div>
  );
}

interface Usage { insurers: { id: string; name: string; country: string }[]; vehiclesByVersion: Record<string, number> }

function MethodsPage() {
  const list = useLoad<ClientMethod[]>("/admin/methods");
  const [sel, setSel] = useState<string>("");
  const [ver, setVer] = useState<number>(0);
  const [draft, setDraft] = useState<Json | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const methods = (list.data ?? []).filter((m) => !m.archived);
  const m = methods.find((x) => x.id === sel) ?? methods[0];
  const usage = useLoad<Usage>(m ? `/admin/methods/${m.id}/usage` : "", [m?.id, m?.currentVersion]);
  useEffect(() => { if (m) { setVer(m.currentVersion); setDraft(null); setName(m.name); } }, [m?.id, m?.currentVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown: Json | undefined = m ? ((draft ?? (m.versions[String(ver)] as Json)) as Json) : undefined;
  const ro = !m || m.isSystem || ver !== m.currentVersion;
  const create = (body: { name: string; engine: "aw" | "matrix"; country: "DE" | "ES"; params: unknown; base_method_id: string | null }) =>
    act(async () => { const r = await api<{ id: string }>("POST", "/admin/methods", body); await list.reload(); setSel(r.id); }, setErr);
  const systemOf = (country: "DE" | "ES") => methods.find((x) => x.isSystem && x.country === country);
  return (
    <>
      <Card title={t("v6MenuMethods")} actions={<>
        <button className="btn" onClick={() => { const base = systemOf("DE"); if (base) void create({ name: `${base.name} 2`, engine: "aw", country: "DE", params: base.versions[String(base.currentVersion)], base_method_id: base.id }); }}>{t("v6MNew")} DE</button>
        <button className="btn" onClick={() => { const base = systemOf("ES"); if (base) void create({ name: `${base.name} 2`, engine: "matrix", country: "ES", params: base.versions[String(base.currentVersion)], base_method_id: base.id }); }}>{t("v6MNew")} ES</button>
      </>}>
        <Err msg={list.err || err} />
        <div className="mtabs" role="tablist">
          {methods.map((x) => <button key={x.id} role="tab" aria-selected={m?.id === x.id} className={m?.id === x.id ? "on" : ""} onClick={() => setSel(x.id)}>{x.name}{x.isSystem && <span className="pill">{t("v6MSystem")}</span>}<small>{x.country}</small></button>)}
        </div>
      </Card>
      {m && shown && (
        <Card title={m.name} actions={<span className="pill">{m.engine === "aw" ? t("v6MEngineAw") : t("v6MEngineMatrix")}</span>}>
          {m.isSystem
            ? <p className="muted" style={{ marginTop: 0 }}>{t("v6MLocked")}</p>
            : <><label>{t("v6MName")}</label><input value={name} onChange={(e) => setName(e.target.value)} /></>}
          <div className="row" style={{ marginTop: 8 }}>
            <label style={{ margin: 0 }}>{t("v6MVersion")}</label>
            <select style={{ width: "auto" }} value={ver} onChange={(e) => { setVer(Number(e.target.value)); setDraft(null); }}>
              {Object.keys(m.versions).map(Number).sort((a, b) => b - a).map((v) => <option key={v} value={v}>{v}{v === m.currentVersion ? " ●" : ""}</option>)}
            </select>
            <span className="muted">{t("v6MVersionHint")}</span>
          </div>
          {m.engine === "aw"
            ? <AwEditor p={(shown.vat != null ? shown : DEFAULT_AW_PARAMS) as Json} set={setDraft} ro={ro} />
            : <MatrixEditor p={shown as { esMatrix: EsMatrix | null }} set={setDraft} ro={ro} />}
          <TestCalc engine={m.engine} country={m.country} params={shown} />
          <Err msg={err} />
          <p className="row">
            {!m.isSystem && <button className="btn" disabled={ver !== m.currentVersion || (!draft && name === m.name)} onClick={() => act(
              () => api("PUT", `/admin/methods/${m.id}`, { name, ...(draft ? { params: draft } : {}) }), setErr, () => { setDraft(null); void list.reload(); toast(t("saved")); })}>{draft ? t("v6MSaveVersion") : t("save")}</button>}
            <button className="btn sec" onClick={() => void create({ name: `${m.name} (${t("v6MCopyOf")})`, engine: m.engine, country: m.country, params: shown, base_method_id: m.id })}>{t("v6MCopy")}</button>
            {!m.isSystem && <button className="btn danger" onClick={() => { if (confirmDialog(t("v6MArchiveQ"))) void act(() => api("POST", `/admin/methods/${m.id}/archive`), setErr, () => { setSel(""); void list.reload(); }); }}>{t("v6MArchive")}</button>}
          </p>
          <h4>{t("v6MUsedBy")}</h4>
          {usage.data?.insurers.length ? <div>{usage.data.insurers.map((i) => <span key={i.id + i.country} className="pill">{i.name} · {i.country}</span>)}</div> : <p className="muted">{t("v6MNoUse")}</p>}
          {usage.data && Object.keys(usage.data.vehiclesByVersion).length > 0 && <p className="muted">{Object.entries(usage.data.vehiclesByVersion).map(([v, n]) => `${t("v6MVersion")} ${v}: ${n} ${t("v6MVehicles")}`).join(" · ")}</p>}
        </Card>
      )}
    </>
  );
}

// ------------------------------------------------------------------ weekly report
interface WeekSheet { technician: string; sites: string[]; vehicles: { id: string; plate: string; model: string; start: string | null; end: string; aw: number; pdrEur: number; demEur: number; eur: number }[]; totals: { n: number; aw: number; pdrEur: number; demEur: number; eur: number } }
interface WeekData { week: string; from: string; to: string; sheets: WeekSheet[]; people: { id: string; name: string; kind: string; active: boolean; email: string | null }[] }

/** ISO week "2026-W43" of a date */
export function isoWeekOf(d: Date): string {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  const y = x.getUTCFullYear(), w = Math.ceil(((x.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

function WeeklyPage() {
  const [week, setWeek] = useState(isoWeekOf(new Date()));
  const [who, setWho] = useState("");
  const [to, setTo] = useState("");
  const [err, setErr] = useState("");
  const d = useLoad<WeekData>(`/weekly-report?week=${encodeURIComponent(week)}`, [week]);
  const sheets = (d.data?.sheets ?? []).filter((s) => !who || s.technician === who);
  const person = d.data?.people.find((p) => p.name.toLowerCase() === who.toLowerCase());
  const grand = sheets.reduce((a, s) => a + s.totals.eur, 0);
  const lang = getLang();
  const money = (n: number) => eur(n);
  const names = [...new Set([...(d.data?.sheets ?? []).map((s) => s.technician), ...(d.data?.people ?? []).filter((p) => p.active).map((p) => p.name)])].sort((a, b) => a.localeCompare(b, "de"));
  useEffect(() => { setTo(person?.email ?? ""); }, [who, d.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = (): TechSheetData[] => sheets.map((s) => ({ technician: s.technician, sites: s.sites, vehicles: s.vehicles, totals: s.totals }));
  return (
    <Card title={t("v6MenuWeekly")}>
      <div className="row">
        <div><label>{t("v6WWeek")}</label><input type="week" value={week} onChange={(e) => e.target.value && setWeek(e.target.value)} /></div>
        <div className="grow"><label>{t("v6WPerson")}</label>
          <select value={who} onChange={(e) => setWho(e.target.value)}><option value="">{t("v6WAll")}</option>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        {d.data && <span className="muted">{fmtDateTime(d.data.from + "T00:00:00").slice(0, 10)} – {fmtDateTime(d.data.to + "T00:00:00").slice(0, 10)}</span>}
      </div>
      <Err msg={d.err || err} />
      {d.data && !sheets.length && <p className="muted">{t("v6WNone")}</p>}
      {sheets.map((s) => (
        <div key={s.technician} className="wsheet">
          <div className="row"><h4 className="grow" style={{ margin: 0 }}>{s.technician}</h4><span className="muted">{s.sites.join(", ")}</span></div>
          <div className="tscroll"><table>
            <thead><tr><th>{t("v6WPlate")}</th><th>{t("v6WModel")}</th><th>{t("v6WFinish")}</th><th className="r">{t("v6WBasis")}</th><th className="r">{t("v6WPdrPart")}</th><th className="r">{t("v6WDemPart")}</th><th className="r">{t("v6WAmount")}</th></tr></thead>
            <tbody>{s.vehicles.map((v) => <tr key={v.id + v.eur}><td>{v.plate}</td><td>{v.model}</td><td>{v.end}</td><td className="r">{v.aw.toFixed(2)}</td><td className="r">{money(v.pdrEur)}</td><td className="r">{money(v.demEur)}</td><td className="r"><b>{money(v.eur)}</b></td></tr>)}</tbody>
            <tfoot><tr><td colSpan={3}><b>{s.totals.n} {t("v6WCars")}</b></td><td className="r"><b>{s.totals.aw.toFixed(2)}</b></td><td className="r"><b>{money(s.totals.pdrEur)}</b></td><td className="r"><b>{money(s.totals.demEur)}</b></td><td className="r"><b>{money(s.totals.eur)}</b></td></tr></tfoot>
          </table></div>
        </div>
      ))}
      {sheets.length > 0 && <p className="wtotal">{t("v6WTotal")}: <b>{money(grand)}</b></p>}
      {sheets.length > 0 && (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="grow"><label>{t("v6WSendTo")}</label><input type="email" value={to} disabled={!who} placeholder={who ? t("v6WNoEmail") : t("v6WPerson")} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="btn" disabled={!who || !to} onClick={() => act(async () => {
            const r = await api<{ to: string; vehicles: number }>("POST", "/weekly-report/send", { week, technician: who, email: to, lang });
            toast(`${t("v6WSent")} ${r.to}`);
          }, setErr)}>{t("v6WSend")}</button>
          <button className="btn sec" onClick={() => void act(async () => {
            const bytes = await generateTechnicianWorksheets({ from: d.data!.from, to: d.data!.to, sheets: data() }, lang);
            await shareOrDownload(bytes, techPdfFileName(d.data!.from, d.data!.to, lang), "application/pdf");
          }, setErr)}>{t("v6WPdf")}</button>
        </div>
      )}
    </Card>
  );
}

export type { Route };
