import { isPlace } from "../../shared/places";
import type { ReactNode } from "react";
import { fmtDateTime, t, tOr } from "../../shared/i18n";
import { Card, Err, useLoad } from "./shared";
import type { Section } from "./menu";

function useMaybe<T>(path: string, allowed: boolean) { return useLoad<T>(allowed ? path : ""); }

export function Overview({ has, open }: { has: (p: string) => boolean; open: (k: Section) => void }) {
  const users = useMaybe<{ status: string }[]>("/admin/users", has("utilisateurs.gerer"));
  const invs = useMaybe<unknown[]>("/admin/invitations", has("utilisateurs.gerer"));
  const sites = useLoad<{ id: string; capacite: number; present?: number; type: string }[]>("/admin/stations");
  const roles = useMaybe<{ isSystem: boolean }[]>("/admin/roles", has("roles.gerer"));
  const az = useMaybe<{ configured: boolean; unmappedCustomers: unknown[]; scannersWithoutStation: unknown[]; lastRuns: { ok: boolean | null; at: string }[] }>("/admin/azure/status", has("stations.gerer"));
  const log = useMaybe<{ id: string; at: string; action: string; entity: string }[]>("/admin/audit?limit=8", has("audit.voir"));
  const full = (sites.data ?? []).filter((s) => isPlace(s) && s.capacite > 0 && (s.present ?? 0) >= s.capacite).length;
  const lastRun = az.data?.lastRuns?.[0];
  const azState = !az.data ? "…" : !az.data.configured ? t("v6AzureOff") : lastRun && lastRun.ok === false ? t("v6AzureErr") : t("v6AzureOk");
  const cards: { k: Section; show: boolean; title: string; big: ReactNode; sub: string }[] = [
    { k: "users", show: has("utilisateurs.gerer"), title: t("v6KpiUsers"), big: (users.data ?? []).filter((u) => u.status === "active").length, sub: `${invs.data?.length ?? 0} ${t("v6KpiInvites")}` },
    { k: "azure", show: has("stations.gerer"), title: t("v6KpiAzure"), big: azState, sub: `${(az.data?.unmappedCustomers.length ?? 0) + (az.data?.scannersWithoutStation?.length ?? 0)} ${t("v6KpiAzureOpen")}` },
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
