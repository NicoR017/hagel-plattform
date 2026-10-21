import { t } from "../i18n";
import { type Route } from "../field/route";
import { useField } from "../field/store";
import { ModeChoice } from "./ModeChoice";
import { Shell3, type Crumb } from "./Shell3";
import { Stations } from "./Stations";
import { VehicleList } from "./VehicleList";
import { modeTitle } from "./listActions";
import "./v3.css";

interface Me { user: { name: string; email: string }; organizations: { id: string; name: string }[] }

/** The three new screens (stations, station modes, vehicle list). Everything else keeps its own screen and gets "‹ Zurück" from its own header. */
export function V3Routes({ me, org, onOrg, route }: { me: Me; org: string; onOrg: (id: string) => void; route: Route }) {
  const f = useField();
  const stationOf = (id: string) => f.refs?.stations.find((s) => s.id === id);
  const home: Crumb = { label: t("v3Stations"), to: { page: "list" } };
  let crumbs: Crumb[] = [home];
  let body: React.ReactNode = <Stations userName={me.user.name || me.user.email} />;
  if (route.page === "mode") {
    crumbs = [home, { label: stationOf(route.stationId)?.name ?? "…" }];
    body = <ModeChoice stationId={route.stationId} />;
  } else if (route.page === "list" && route.stationId) {
    crumbs = [home, { label: stationOf(route.stationId)?.name ?? "…", to: { page: "mode", stationId: route.stationId } }, { label: modeTitle(route.mode) }];
    body = <VehicleList key={route.stationId + route.mode} stationId={route.stationId} mode={route.mode} />;
  }
  return <Shell3 user={me.user} orgs={me.organizations} org={org} onOrg={onOrg} route={route} crumbs={crumbs}>{body}</Shell3>;
}
