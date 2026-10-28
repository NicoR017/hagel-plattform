# Phase 0 — v5 : analyse d'écarts, plan de migration, essai à blanc (aucun code applicatif écrit)

Base : `feature/ui-v4` (HEAD c2e9674, 51 commits d'avance sur `main`, V4 pas encore fusionnée). Branche `feature/ui-v5` créée en local à partir d'elle, **non poussée**.
Maquette lue (notes « V5 – à tester ») ; le code ci-dessous est celui de `feature/ui-v4`.
Essai à blanc : requêtes `SELECT` uniquement (transaction en lecture seule) sur la base **staging Render** `hagel-staging-db`, qui contient une copie de la production du 23/10 (13 véhicules vivants + 9 supprimés, 366 photos, 6 865 scans, 16 migrations appliquées). Rien n'a été écrit. Les requêtes sont dans `infra/scripts/v5_dryrun.sql` pour les rejouer sur la vraie base juste avant la mise en production.

## 1. Constats qui précisent ou corrigent le prompt

| # | Constat | Conséquence |
|---|---|---|
| A | Le prompt parle de `azure_scans` : la table s'appelle `colibri_scans` ; le numéro du scanner est `colibri_scans.colibri_number` (texte, vide possible). | Aucune migration sur cette table. |
| B | **L'hébergement a changé** (Railway en pause depuis le 22/10, Render Frankfurt). `docs/SAUVEGARDE_RENDER.md` et `infra/scripts/render_*.ps1` existent. | Question 8 (§4) : sur quel hébergement se fait la mise en production de lundi ? Les commandes de sauvegarde de la checklist en dépendent. |
| C | `vehicles.client_station_id` pointe aujourd'hui, pour 1 véhicule, vers **Chapauto (une halle)** ; et la fiche « Allianz » (type carrosserie, **inactive**) est client de 6 véhicules vivants : c'est une assurance, pas un carrossier. | Données à nettoyer par Nicolas, pas par une migration (voir §3). |
| D | Beaucoup de tests et les seeds utilisent une carrosserie comme **station** (`seed.ts`, `seed_staging.ts`, `sync.test.ts`, `azure.test.ts`, `phase6.test.ts`…). | Refuser « un carrossier comme station » côté serveur casse ces fixtures : il faut les réécrire (une halle + un carrossier). C'est le plus gros risque de la Phase 1. |
| E | `vehicles.bodyshop_id` (étape « At body shop ») existe déjà et référence une station de type carrosserie. | Reste valable ; la liste proposée devient celle des body shops. |
| F | `GET /azure/scans` coupe à **300 lignes** (`routes_azure.ts`). | La recherche de S09 « tous les scans de tous les jours » doit se faire côté serveur (paramètre `q`), pas dans le navigateur. |
| G | Aucun champ « signature / remise » n'existe (colonnes `*hand*`/`*sign*` : 0). Le seul « Hand over to the customer » est un `confirm()` + op `vehicle.status → rendu` (`RepairDetail.tsx:257`). | Nouvelle table + nouvelle op. |
| H | Docker Desktop n'est pas démarré sur ce poste : le test de restauration (`restore_in_docker.sh`) ne peut pas tourner tant qu'il n'est pas lancé à la main. | À faire avant la Phase 6. |

## 2. Écarts par chantier (fichiers, effort, risque)

**2.1 Body shops ≠ stations — effort élevé, risque moyen (surtout les tests).**
- Modèle : **option A** (même table `stations`, `type='carrosserie'` = body shop) : colonne additive `contact_name`, `contact_phone` ; pas de FK à changer.
- Serveur — refuser un body shop comme *lieu* : `sync.ts` (`vehicle.create` station, `vehicle.move` destination, l. ~312/460), `repair.ts` (`booking.create/move`, l. ~345 ; seul `parc` est refusé aujourd'hui), `routes_citas.ts` (l. 259-266 : crée un véhicule *chez* un carrossier), `app.ts` (affectation de rôle / invitation sur une station, `campaign_stations`), `routes_master.ts`. Refuser une halle/parc comme **client** pour toute *nouvelle* affectation (`assertStationOrInsurer`) sans toucher à l'existant.
- Serveur — nouvelle permission `bodyshops.gerer` (admin d'organisation + chef de station), `app.ts` station CRUD scindé en deux (stations / body shops), `dashboard.ts` (cartes de sites : déjà filtrées).
- Client — `Stations.tsx` (groupe « Body shops » à retirer de l'accueil), `admin.tsx` (S20 : types halle/parc, sans commission ni BC ; nouvelle page S39 `BodyShops`), `Dialogs.tsx` D07, `BodyshopPick.tsx`, `List.tsx`, `Dashboard.tsx`, `admin2.tsx` (assurances « Works with »), `BackupImport.tsx`, `sync/*` (stations proposées pour déplacer / créer), i18n (4 langues).
- Migration `0016` : colonnes `contact_*` + données (déplacement vers Chapauto) écrites par un script séparé `v5_move_bodyshop_vehicles` (UPDATE + historique + audit, liste avant/après), pas par la migration SQL.

**2.2 Scanners Colibri — effort élevé, risque moyen.**
- Tables `colibri_devices` + `colibri_device_assignments` (index unique partiel : une seule affectation ouverte par scanner ; chevauchement refusé en transaction).
- `azure_sync.ts` `mapScan` : la station vient de l'affectation du `colibri_number` (même tenant) valable à la date du scan (fuseau Madrid pour un tenant ES, Berlin pour DE) ; le BusinessCustomer ne donne plus que le client. `routes_azure.ts` (`/azure/scans`, import, statut), `azure_import.ts`.
- Visibilité serveur : un utilisateur voit les scans des scanners affectés à ses stations ; sans station = administrateurs seulement (+ action « Start here » avec choix de station sans modifier le scanner).
- Nouveau S40 (`bodyshops`-like) + « vus dans les scans » (filtré par `tenantsOfOrg` : isolation entre organisations conservée). Ancien « emplacements inconnus » (S27) retiré de l'interface, données conservées (0 alias en base aujourd'hui).
- Client : `NewScans.tsx`, `ScanList.tsx`, `Scans.tsx` (D05), `NewExpertise.tsx` (S08), `CitasStart.tsx` (S09).

**2.3 Dashboard — effort moyen, risque faible.** `dashboard.ts` : nouvelle agrégation par couple (body shop, assurance) du véhicule, avec bascule lien / body shop / assurance, montants seulement avec `prix.voir`, mêmes règles de portée ; `Dashboard.tsx` : renommage « carrosserie » → « body shop », nouveau tableau.

**2.4 Signature client — effort élevé, risque moyen.**
- Table `vehicle_handovers`, nouvelle op `vehicle.handover` (rejouable, sans doublon), colonne ou réglage « signable depuis » (question 5).
- **Signature : je propose le tracé vectoriel (points) dans la base**, pas une image : 2 à 8 Ko, voyage dans l'op hors ligne sans passer par le circuit d'upload des photos, et se dessine dans le PDF avec `pdf-lib` (traits), sans bibliothèque de canvas côté serveur. Contre : pas d'image brute pour un autre usage. Le journal d'audit ne contient que la référence.
- Les données personnelles (nom, e-mail, signature, remarques) ne sont **pas** dans le véhicule synchronisé : seul « signé oui/non + date » l'est (utile hors ligne) ; le détail se lit par une route dédiée avec contrôle de permission, donc invisible pour technicien / headliner et jamais exporté en Excel.
- `packages/documents` : reçu PDF (ES/DE selon le pays du véhicule, papier à en-tête du véhicule), dernière page du rapport photo ; `mails.ts` : modèle e-mail en 4 langues ; nouvel écran D17/D18 (canvas au doigt).

**2.5 / 2.6 RDV du jour et démarrage depuis un RDV — effort moyen, risque faible (surtout visuel).** `CitasDay.tsx` (64 lignes), `CitasStart.tsx` (122 lignes), recherche serveur (`q`) dans `/azure/scans`.

## 3. Essai à blanc sur la copie de staging

**Véhicules posés dans un body shop (à déplacer vers Chapauto) :**

| Plaque | Station actuelle | Statut | Étape board | Supprimé ? |
|---|---|---|---|---|
| 0137 KKG | Talleres Pedro Madroño S.L. (C.A. / ACOAT Pedro Madroño) | attente | — | non |
| 1188 JYM | Allianz | besichtigung | — | oui |
| (vide) | Allianz | arrive | — | oui |
| 2112LKD | Allianz | besichtigung | — | oui |
| 9547 LPV | Allianz | fertig | finish | oui |
| 5094 JFN | Talleres Miguel Auto S.L. | besichtigung | — | oui |

- **Chapauto** : une seule correspondance (insensible aux accents et à la casse), type **hall**, active, organisation PDR Team Spain → la règle « stop et demander » ne se déclenche pas.
- Autres éléments placés dans un body shop : affectations de rôle sur un body shop comme *station* : **0** ; invitations en attente : **0** ; réservations de réparation (lieu ou origine) : **0** ; liens Citas : **0** ; campagnes : **0** ; historique de déplacements qui mentionne un body shop : **10** lignes (conservées telles quelles).
- Intégrité de départ (staging, avant toute V5) : 13 véhicules vivants (Chapauto 11, Massa 1, Pedro Madroño 1), 9 supprimés, 366 photos, net total 23 019,45 €, empreinte `d999497f35ba…` (rapport complet sauvegardé hors dépôt ; comparaison après migration en Phase 6).
- **Body shops existants** : Allianz (inactif), Talauto (30 %, 0 véhicule client, 3 véhicules à l'étape « At body shop »), Talleres Carmovil C.B. (25 %), Talleres Miguel Auto S.L. (25 %, 4 véhicules ouverts), Talleres Pedro Madroño… (25 %, 1 véhicule).

**Scanners vus dans les scans, par organisation (tenants de l'organisation seulement) :**
- **PDR-Team ES** : 1 scanner, **COLIBRI-028** (48 scans, dont 39 en attente et 9 importés ; lieu Talavera de la Reina). Les 9 véhicules importés sont posés à Chapauto (7), Massa (1), Pedro Madroño (1).
- **PDR-Team DE** : 14 scanners (COLIBRI-015 : 598 scans, -008 : 342, -010 : 324, -026 : 316, -029 : 290, -037 : 185, -030 : 170, -040 : 62, -023 : 57, -041 : 40, -001 : 20, -001-XL : 12, -042 : 4, -016 : 3). **L'organisation DE n'a aucune station dans cette base** : ces scanners resteront « sans station » (visibles des administrateurs seulement) tant que Nicolas n'a pas créé les stations DE.
- Deux scanners ont changé de lieu en deux semaines (COLIBRI-037 : Careoss Süd puis Ingersheim ; COLIBRI-030 : Ludwigsburg puis Mutlangen) : confirme le besoin d'affectation **datée**.
- Le même numéro peut exister dans plusieurs tenants (COLIBRI-003-XL sous « » et « PDR-Team US ») : l'unicité est donc `(organisation, tenant, numéro)`.
- 4 394 scans d'autres tenants (CH 3 070, HSH 817, FR 409, PL 47, IT 27, ZA 10, US 5, sans tenant 9) n'appartiennent à aucune organisation : ils ne doivent **jamais** apparaître dans S40 ni dans les listes (déjà garanti aujourd'hui par `tenantsOfOrg`, à garder et à tester).
- Effet le jour J : tant qu'aucun scanner n'est affecté, un assesseur ne voit plus aucun scan ; l'écran S40 (« Ajouter » en un clic) est donc la première chose à faire. Pour ES, une seule affectation (COLIBRI-028) suffit.

## 4. Mes réponses aux questions du prompt (par défaut = recommandation)

1. **Body shops** : **option A** (rien à renommer en base, 0 changement de clé étrangère, la plus sûre pour lundi).
2. **Autres éléments dans un body shop** : aucun cas dans la copie de staging (voir §3). Je rejoue `v5_dryrun.sql` sur la vraie production avant la migration ; s'il apparaît un cas, je m'arrête et je liste.
3. **Fuseau** : oui, Europe/Madrid pour un tenant ES, Europe/Berlin pour un tenant DE ; pour un autre pays, le pays de l'organisation.
4. **Permission de signature** : réutiliser `vehicules.changer_statut`.
5. **Remise à signer pour les voitures déjà en réparation le jour J** : seulement celles qui entrent sur le board après la mise en production (les anciennes n'affichent rien).
6. **Ordre si le temps manque** : 1) 2.1 + migration, 2) 2.2, 3) 2.5 + 2.6, 4) 2.4, 5) 2.3. Aujourd'hui samedi 24/10 : je vise lundi pour 1 à 3 ; 2.4 (signature + PDF + e-mail + hors ligne) et 2.3 seulement si le temps reste, sinon juste après lundi. Je te le confirmerai à la fin de chaque phase.

**Questions en plus (à trancher avant la Phase 1)**
7. Déplacer **aussi les 5 véhicules supprimés** (4 chez « Allianz », 1 chez Miguel Auto) vers Chapauto ? Recommandé **oui** : plus aucune ligne ne pointe vers un body shop, et un véhicule restauré ne retomberait pas chez un carrossier. Sinon seul 0137 KKG est déplacé.
8. **Hébergement de lundi** : Render (prod `hagel-api`) ou encore Railway ? Les commandes de sauvegarde / retour arrière de la checklist en dépendent.
9. **Données à nettoyer** (par toi, après lundi ou avant) : la fiche body shop « Allianz » (inactive, c'est une assurance) ; le véhicule dont le *client* est Chapauto (halle). Je ne touche à aucun des deux (règle 1.3 : garder `client_station_id`).
10. **Scanner ES** : affecter COLIBRI-028 à **Chapauto** (7 des 9 véhicules importés y sont) ?
