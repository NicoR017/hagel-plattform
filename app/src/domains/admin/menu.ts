import { t, type Key } from "../../shared/i18n";

export type Section = "overview" | "users" | "roles" | "sites" | "bodyshops" | "scanners" | "insurers" | "methods" | "technicians" | "weekly" | "reports" | "parts" | "billing" | "letterheads" | "prices" | "azure" | "audit" | "orgs";

/** Map of the old tab names (bookmarks) to the new sections */
export const ALIAS: Record<string, Section> = { users: "users", roles: "roles", sites: "sites", azure: "azure", insurers: "insurers", letterheads: "letterheads", technicians: "technicians", audit: "audit", orgs: "orgs" };

export function menuGroups(has: (p: string) => boolean, hasAny: (p: string) => boolean, isSuperadmin: boolean): { title: Key; items: { k: Section; label: string; show: boolean }[] }[] {
  return [
    { title: "v6MenuOverview", items: [{ k: "overview", label: t("v6MenuOverview"), show: true }] },
    { title: "v6MenuPeople", items: [
      { k: "users", label: t("users"), show: has("utilisateurs.gerer") },
      { k: "roles", label: t("roles"), show: has("roles.gerer") },
    ] },
    { title: "v6MenuStructure", items: [
      { k: "sites", label: t("sites"), show: true },
      { k: "bodyshops", label: t("v8BodyShops"), show: hasAny("bodyshops.gerer") },
      { k: "scanners", label: t("v8Scanners"), show: hasAny("colibri.geraete") },
      { k: "insurers", label: t("insurers"), show: has("assurances.gerer") },
      { k: "letterheads", label: t("letterheads"), show: has("parametres.gerer") },
    ] },
    { title: "v6MenuCalc", items: [
      { k: "methods", label: t("v6MenuMethods"), show: has("methoden.gerer") },
      { k: "prices", label: t("v6MenuPrices"), show: has("parametres.gerer") },
    ] },
    { title: "f4MenuBilling", items: [
      { k: "billing", label: t("f4MenuBodyShopBilling"), show: has("facturation.gerer") },
    ] },
    { title: "v6MenuWork", items: [
      { k: "technicians", label: t("v6MenuTech"), show: has("parametres.gerer") },
      { k: "weekly", label: t("v6MenuWeekly"), show: has("wochenbericht.voir") },
      { k: "reports", label: t("v9Reports"), show: hasAny("rapports.voir") },
      { k: "parts", label: t("f2MenuParts"), show: has("pieces.catalogue") },
    ] },
    { title: "v6MenuSystem", items: [
      { k: "azure", label: t("v6MenuAzure"), show: has("stations.gerer") },
      { k: "audit", label: t("audit"), show: has("audit.voir") },
      { k: "orgs", label: t("orgs"), show: isSuperadmin },
    ] },
  ];
}
