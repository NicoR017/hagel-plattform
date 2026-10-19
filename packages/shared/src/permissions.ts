/** Fixed permission catalogue (code). Roles are bundles of these, edited by admins in the UI. */
export const PERMISSIONS = [
  "vehicules.voir", "vehicules.creer", "vehicules.modifier", "vehicules.supprimer", "vehicules.assigner",
  "vehicules.deplacer", "vehicules.changer_statut",
  "prix.voir", "repartition_interne.voir", "ma_part.voir", "ma_commission.voir", "commission.modifier",
  "kva.envoyer", "rapport_reparation.envoyer",
  "photos.ajouter", "photos.supprimer",
  "colibri.importer", "export.excel",
  "assurances.gerer", "campagnes.gerer", "stations.gerer", "parametres.gerer",
  "utilisateurs.gerer", "roles.gerer", "audit.voir", "dashboard.voir",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const SCOPES = ["assigne", "station", "campagne", "client", "assurance"] as const;
export type Scope = (typeof SCOPES)[number];

export const STATION_TYPES = ["carrosserie", "hall", "parc"] as const;
export type StationType = (typeof STATION_TYPES)[number];

export const STATUSES = ["arrive", "besichtigung", "attente", "reparatur", "fertig", "rendu"] as const;
export type VehicleStatus = (typeof STATUSES)[number];

export interface SystemRole {
  key: string;
  name: string;
  description: string;
  scope: Scope;
  permissions: Permission[];
}

const ALL = [...PERMISSIONS] as Permission[];
const without = (xs: Permission[], ...ex: Permission[]) => xs.filter((x) => !ex.includes(x));

/** Seeded, editable default roles. */
export const SYSTEM_ROLES: SystemRole[] = [
  {
    key: "org_admin", name: "Admin d'organisation", description: "Tout, dans son organisation", scope: "station",
    permissions: ALL,
  },
  {
    key: "chef_site", name: "Chef de site (Werkstattleiter)", description: "Gère les véhicules et l'équipe d'un site", scope: "station",
    permissions: without(ALL, "roles.gerer", "parametres.gerer", "stations.gerer", "audit.voir"),
  },
  {
    key: "aufnehmer", name: "Aufnehmer / Expert", description: "Crée et chiffre les véhicules", scope: "station",
    permissions: [
      "vehicules.voir", "vehicules.creer", "vehicules.modifier", "vehicules.assigner", "vehicules.changer_statut",
      "prix.voir", "repartition_interne.voir", "kva.envoyer", "rapport_reparation.envoyer",
      "photos.ajouter", "photos.supprimer", "colibri.importer", "export.excel", "dashboard.voir",
    ],
  },
  {
    key: "technicien", name: "Technicien", description: "Ses véhicules assignés, sans prix", scope: "assigne",
    permissions: ["vehicules.voir", "vehicules.modifier", "vehicules.changer_statut", "ma_part.voir", "photos.ajouter"],
  },
  {
    key: "freelance", name: "Freelance", description: "Véhicules d'une campagne, accès à durée limitée", scope: "campagne",
    permissions: ["vehicules.voir", "vehicules.creer", "vehicules.modifier", "vehicules.changer_statut", "ma_part.voir", "photos.ajouter"],
  },
  {
    key: "carrosserie", name: "Carrosserie", description: "Compte externe : ses véhicules, où qu'ils soient", scope: "client",
    permissions: ["vehicules.voir", "prix.voir", "ma_commission.voir"],
  },
  {
    key: "assureur", name: "Assureur", description: "Compte externe : les dossiers de son assurance, sans répartition interne", scope: "assurance",
    permissions: ["vehicules.voir", "prix.voir"],
  },
];

/** Fields removed from a vehicle unless the user has the matching permission. */
export const FIELD_RULES: { permission: Permission; fields: string[] }[] = [
  {
    permission: "prix.voir",
    fields: ["stundensatz", "demontageEur", "glass", "netto", "brutto", "bigEur", "panelEur"],
  },
  {
    permission: "repartition_interne.voir",
    fields: ["techName", "techPct", "demTechName", "demTechPct", "werkPct", "werkMode", "werkEur", "techEur", "demTechEur", "rest", "commission_snapshot"],
  },
];
