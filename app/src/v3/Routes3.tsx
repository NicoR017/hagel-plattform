import { t } from "../i18n";
import { type Route } from "../field/route";
import { useField, useVehicle } from "../field/store";
import { Expertise } from "./Expertise";
import { CitasStart } from "./CitasStart";
import { ModeChoice } from "./ModeChoice";
import { NewExpertise } from "./NewExpertise";
import { Shell3, type Crumb } from "./Shell3";
import { Stations } from "./Stations";
import { VehicleDetail } from "./VehicleDetail";
import { RepairDetail } from "./RepairDetail";
import { VehicleList } from "./VehicleList";
import { NewScans } from "./NewScans";
import { CitasCalendar } from "./CitasCalendar";
import { SearchResults } from "./SearchResults";
import { modeTitle } from "./listActions";
import "./v3.css";

interface Me { user: { name: string; email: string }; organizations: { id: string; name: string }[] }

/** Every screen of the new interface: stations, station modes, vehicle lists, assessment assistant, vehicle detail. */
export function V3Routes({ me, org, onOrg, route }: { me: Me; org: string; onOrg: (id: string) => void; route: Route }) {
  const f = useField();
  const vehicleId = route.page === "vehicle" || route.page === "expertise" || route.page === "repair" ? route.id : "";
  const vehicle = useVehicle(vehicleId);
  const stationOf = (id: string) => f.refs?.stations.find((s) => s.id === id);
  const home: Crumb = { label: t("v3Stations"), to: { page: "list" } };
  const plate = String((vehicle as Record<string, unknown> | null | undefined)?.kennzeichen || "") || "…";
  const trail = (stationId: string, mode: "kalk" | "rep" | "all", last?: Crumb): Crumb[] => [
    home, { label: stationOf(stationId)?.name ?? "…", to: { page: "mode", stationId } },
    { label: modeTitle(mode), to: { page: "list", stationId, mode } }, ...(last ? [last] : []),
  ];
  let crumbs: Crumb[] = [home];
  let body: React.ReactNode = <Stations userName={me.user.name || me.user.email} />;
  if (route.page === "scans") {
    crumbs = [home, { label: t("nsTitle") }];
    body = <NewScans />;
  } else if (route.page === "search") {
    crumbs = [home, { label: t("srTitle") }];
    body = <SearchResults q={route.q} />;
  } else if (route.page === "mode") {
    crumbs = [home, { label: stationOf(route.stationId)?.name ?? "…" }];
    body = <ModeChoice stationId={route.stationId} />;
  } else if (route.page === "list" && route.stationId) {
    crumbs = trail(route.stationId, route.mode).slice(0, 3).map((c, i, a) => (i === a.length - 1 ? { label: c.label } : c));
    body = <VehicleList key={route.stationId + route.mode} stationId={route.stationId} mode={route.mode} />;
  } else if (route.page === "newexp") {
    crumbs = trail(route.stationId, route.mode, { label: t("v4NewTitle") });
    body = <NewExpertise stationId={route.stationId} mode={route.mode} />;
  } else if (route.page === "citas") {
    crumbs = [home, { label: stationOf(route.stationId)?.name ?? "…", to: { page: "mode", stationId: route.stationId } }, { label: t("ciCrumb") }];
    body = <CitasStart key={route.appointmentId} stationId={route.stationId} date={route.date} appointmentId={route.appointmentId} />;
  } else if (route.page === "calendar") {
    crumbs = [home, { label: stationOf(route.stationId)?.name ?? "…", to: { page: "mode", stationId: route.stationId } }, { label: t("ciCalTitle") }];
    body = <CitasCalendar key={route.stationId} stationId={route.stationId} month={route.month} date={route.date} />;
  } else if (route.page === "expertise") {
    const ctx = route.ctx ?? (vehicle?.stationId ? { stationId: vehicle.stationId as string, mode: "kalk" as const } : undefined);
    crumbs = ctx ? trail(ctx.stationId, ctx.mode, { label: `${t("v4Expertise")} · ${plate}` }) : [home, { label: `${t("v4Expertise")} · ${plate}` }];
    body = <Expertise id={route.id} step={route.step} ctx={route.ctx} />;
  } else if (route.page === "repair") {
    crumbs = trail(route.stationId, "rep", { label: plate });
    body = <RepairDetail id={route.id} tab={route.tab} stationId={route.stationId} />;
  } else if (route.page === "vehicle") {
    const ctx = route.ctx ?? (vehicle?.stationId ? { stationId: vehicle.stationId as string, mode: "all" as const } : undefined);
    crumbs = ctx ? trail(ctx.stationId, ctx.mode, { label: plate }) : [home, { label: plate }];
    body = <VehicleDetail id={route.id} tab={route.tab} ctx={route.ctx} />;
  }
  return <Shell3 user={me.user} orgs={me.organizations} org={org} onOrg={onOrg} route={route} crumbs={crumbs} vehicleStationId={vehicle?.stationId as string | null | undefined}>{body}</Shell3>;
}
