/** Fixed permission catalogue (code). Roles are bundles of these, edited by admins in the UI. */
export const PERMISSIONS = [
  "vehicules.voir", "vehicules.creer", "vehicules.modifier", "vehicules.supprimer", "vehicules.assigner",
  "vehicules.deplacer", "vehicules.changer_statut",
  "prix.voir", "repartition_interne.voir", "ma_part.voir", "ma_part_pct.voir", "ma_commission.voir", "commission.modifier",
  "kva.envoyer", "rapport_reparation.envoyer",
  "photos.ajouter", "photos.supprimer",
  "colibri.importer", "export.excel",
  "assurances.gerer", "campagnes.gerer", "stations.gerer", "bodyshops.gerer", "colibri.geraete", "parametres.gerer",
  "utilisateurs.gerer", "roles.gerer", "audit.voir", "dashboard.voir",
  // UI v3
  "reparatur.board", "reparatur.endabnahme", "termine.buchen", "methoden.gerer", "wochenbericht.voir", "kommentare.schreiben",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const SCOPES = ["assigne", "station", "campagne", "client", "assurance"] as const;
export type Scope = (typeof SCOPES)[number];

/** Repair board columns (vehicles.repair_stage). */
export const REPAIR_STAGES = ["bereit", "demontage", "pdr", "remontage", "bodyshop", "finish"] as const;
export type RepairStage = (typeof REPAIR_STAGES)[number];
/** the repair steps a role can be given (v5): with a step the role moves the car from that step to the next one */
export const ROLE_REPAIR_STEPS = ["demontage", "pdr", "remontage"] as const;
export type RoleRepairStep = (typeof ROLE_REPAIR_STEPS)[number];
/** the steps that need a photo: before a technician moves the car out of the step, and before "Finish" (Reassembly needs none) */
export const PHOTO_REQUIRED_STAGES = ["demontage", "pdr"] as const;
export const NEXT_AFTER_STEP: Record<RoleRepairStep, RepairStage> = { demontage: "pdr", pdr: "remontage", remontage: "bodyshop" };

export const STATION_TYPES = ["carrosserie", "hall", "parc"] as const;
export type StationType = (typeof STATION_TYPES)[number];
/** A PLACE is where cars are assessed, stand and are repaired. A body shop ("carrosserie") is a CUSTOMER and never a place (V5). */
export const PLACE_TYPES = ["hall", "parc"] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];
export const isPlaceType = (t: unknown): t is PlaceType => (PLACE_TYPES as readonly unknown[]).includes(t);

export const STATUSES = ["arrive", "besichtigung", "attente", "reparatur", "fertig", "rendu", "refuse"] as const;
/** why a car is refused (assessed but not repaired); the motif of a refused car is the key, optionally followed by ": comment" */
export const REFUSE_REASONS = ["non_pdr", "client", "assurance", "epave"] as const;
/** only a car that has not entered the repair can be refused */
export const REFUSABLE_FROM = ["arrive", "besichtigung", "attente", "refuse"] as const;
export const parseRefuseMotif = (m: string | null | undefined): { key: string; comment: string; valid: boolean } => {
  const s = (m ?? "").trim(), i = s.indexOf(":");
  const key = (i < 0 ? s : s.slice(0, i)).trim(), comment = i < 0 ? "" : s.slice(i + 1).trim();
  return { key, comment, valid: (REFUSE_REASONS as readonly string[]).includes(key) };
};
export type VehicleStatus = (typeof STATUSES)[number];
/** "On hold" reasons that take the car off the repair side (board, dashboard columns): waiting for an appointment, waiting for the insurer / customer approval */
export const OFF_REPAIR_HOLDS = ["termin", "freigabe"] as const;
export const isOffRepairHold = (statut: string, motif: unknown): boolean => statut === "attente" && (OFF_REPAIR_HOLDS as readonly string[]).includes(String(motif ?? "").trim().toLowerCase());

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
    key: "chef_site", name: "Chef de station (Stationsleiter)", description: "Gère les véhicules et l'équipe d'un site", scope: "station",
    permissions: without(ALL, "roles.gerer", "parametres.gerer", "stations.gerer", "audit.voir", "methoden.gerer", "wochenbericht.voir"),
  },
  {
    key: "aufnehmer", name: "Aufnehmer / Expert", description: "Crée et chiffre les véhicules", scope: "station",
    permissions: [
      "vehicules.voir", "vehicules.creer", "vehicules.modifier", "vehicules.assigner", "vehicules.changer_statut",
      "prix.voir", "repartition_interne.voir", "kva.envoyer", "rapport_reparation.envoyer",
      "photos.ajouter", "photos.supprimer", "colibri.importer", "export.excel", "dashboard.voir",
      "reparatur.board", "termine.buchen", "kommentare.schreiben",
    ],
  },
  {
    key: "technicien", name: "Technicien", description: "Ses véhicules assignés, sans prix", scope: "assigne",
    permissions: ["vehicules.voir", "vehicules.modifier", "vehicules.changer_statut", "ma_part.voir", "photos.ajouter", "reparatur.board", "termine.buchen", "kommentare.schreiben"],
  },
  {
    key: "freelance", name: "Freelance", description: "Véhicules d'une campagne, accès à durée limitée", scope: "campagne",
    permissions: ["vehicules.voir", "vehicules.creer", "vehicules.modifier", "vehicules.changer_statut", "ma_part.voir", "photos.ajouter", "reparatur.board", "termine.buchen", "kommentare.schreiben"],
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
