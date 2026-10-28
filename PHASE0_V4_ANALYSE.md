# Phase 0 — v4 : analyse d'écarts (aucun code écrit)

Base : `feature/ui-v3` (HEAD 96bb4d5). La branche `feature/ui-v4` sera créée à partir d'elle au démarrage de la Phase 1.
Limite : la maquette HTML n'a pas encore été relue écran par écran ; je m'appuie sur le prompt. Je la parcourrai avant la Phase 1.

## 1. Constats qui corrigent ou précisent le prompt

| # | Constat (code) | Conséquence |
|---|---|---|
| A | **`photos.user_id` n'existe pas** : la colonne est `photos.taken_by` (`schema.ts:227`). `repair_stage` et `role` existent. | §3.9 : la vérification serveur utilise `taken_by`. Pas de migration. |
| B | `repair_stage` d'une photo est posé par une **seconde op** `photo.stage` (`repair.ts:210`), pas à l'upload. Un upload sans `photo.stage` = photo sans étape. | Le contrôle serveur ne compte que les photos avec `repair_stage = étape courante` et `taken_by = user`. Hors-ligne : l'ordre « upload → photo.stage → repairStage » doit être garanti dans la file ; à vérifier en test. |
| C | Le technicien « déménageur/headliner » d'un véhicule est identifié par **un nom texte** (`shares.demTechName`) et non par une relation. `vehicle_assignments.type` ne vaut que `pdr` aujourd'hui. | §3.8 : « véhicules où il est headliner » = `demTechName` égal au nom de sa fiche technicien (normalisé), ou assignation. Fragile (homonymes, nom libre). Recommandation : ajouter à l'assignation un type `demontage` (même table, pas de migration de schéma, `type` est du texte) et le poser dans `assignVehicle` quand on choisit un headliner. À valider (Q9). |
| D | Rôle technicien : `scope = assigne`. Il voit déjà seulement ses véhicules, **sans `prix.voir`** ; `FIELD_RULES` retire les champs prix. Mais `myShare` (`permissions.ts:134`) renvoie `techEur` / `demTechEur` **sans filtre par rôle de la personne** (un technicien PDR reçoit aussi `demTechEur`). | §3.7/3.8 : il faut un champ dédié `myEarn` calculé côté serveur (`computeShares`) et **retirer** de la réponse les autres montants pour ces rôles. Test « aucun prix dans aucune réponse ». |
| E | Le rôle **Freelancer** est `scope: campagne` ; les droits de portée existent dans `permissions.ts:47/58`, `principal.ts`, `app.ts`, `auth.ts`, `sync.ts:583-620`. | Ne pas supprimer le scope `campagne` côté serveur (règle 1.3) : seulement le retirer de l'UI et migrer les rôles système. |
| F | `style.css:30` : `th/td:nth-child(n+4){display:none}` sous 640 px — confirmé, seule occurrence. | Correction §3.1 telle que décrite. |
| G | `admin2.tsx:15` contient déjà un `SearchSelect` (combobox basique : 44 px, `role=combobox`, pas de clavier, pas d'accents). | Le nouveau picker le remplace (aussi pour les usages admin existants) ; un seul composant. |
| H | Aucun e2e dans le repo (seulement vitest : `packages/*/test`, `server/test`, `app/test`). | « Tests e2e » du prompt = soit Playwright à introduire (dépendance), soit vitest + vérification manuelle navigateur. Voir Q10. |
| I | L'en-tête `Shell3` montre le bouton Administration à **tous** (`Shell3.tsx:~63`). | À masquer sans permission d'administration (§3.7). |
| J | `GET /azure/scans` ne renvoie que : scans « miens » (station mappée + `colibri.importer`), non-mappés **si admin**, ou `?all=1`. `importOne` refuse tout si `m.stationId`/`orgId` manquent (`azure_import.ts:102`), et `clientStationId` est déjà nullable dans le `ref`. | §3.4 : la liste « Nouveaux scans » = `?all=1` côté droits, + colonne station. L'import sans client passe déjà si on donne `stationOverride` (la station est forcée → `importable`) ; il manque surtout le cas « pas de station » et l'UI. Changement serveur petit. Les `no_site` restent importables avec `clientStationId = null`. |

## 2. Écarts par chantier (fichiers)

**3.1 Téléphone** — `app/src/style.css` (règle F), `v3/v3.css`, `admin.tsx`, `admin2.tsx`, `v3/Admin3.tsx` (menu → `<select>` sous 820 px, tables → cartes), `field/field.css` (tableaux KVA/dashboard ≈12 px). CSS surtout ; test visuel 390 px. Pas de serveur.

**3.2 Campagnes** — UI : `field/Basis.tsx`, `field/Dashboard.tsx`, `field/List.tsx`, `admin.tsx` (éditeur de rôles, scope `campagne`), `admin2.tsx` (`CampaignsPage`), `App.tsx` (onglet), textes i18n (6 fichiers). Serveur : **on garde** table, `campaign_id`, scope et permission ; on cache seulement l'UI. `azure_import.ts:142` attribue encore une campagne active à un import : à neutraliser (ne plus l'écrire — règle « plus écrit »). `sync.ts` / `schemas.ts` : accepter encore un `campaignId` envoyé par un vieux client (ignoré). Migration de données : rôle système `freelance` → portée `assigne` (idempotent) + liste des utilisateurs concernés.

**3.3 Picker** — nouveau composant (`app/src/field/Picker.tsx`) ; usages : `Kva.tsx` `SharesBox` (l.24-70, puces + champ libre), `Dialogs.tsx` `SharesDialog` (l.102), `AssignDialog` (l.131), `MoveDialog` (l.63), `Basis.tsx` (assureur, aujourd'hui limité aux assureurs liés). Données déjà dans le store (`f.refs.technicians`, utilisateurs, stations) ; le `stations` de technicien (« works here ») n'est **pas** dans `refs.technicians` (`sync.ts:646` n'envoie pas les stations) : petit ajout au payload. Les stations d'un technicien : à vérifier où elles sont stockées (admin « Technicians »).

**3.4 Nouveaux scans** — `v3/Stations.tsx` (tuile cliquable), nouvelle page + route (`Routes3.tsx`, `field/route.ts`), réutilise `v3/ScanList.tsx`, `useScans.ts`, `scanSort.ts`. Serveur : `routes_azure.ts` (`/azure/scans` : renvoyer la station et accepter « sans station »), `azure_import.ts` (station imposée ou dernière station de l'utilisateur ; client nul). Tests : `server/test/azure.test.ts`.

**3.5 Recherche globale** — `Shell3.tsx` (champ), nouvelle page résultats. Analyse du cas données : la synchro (`sync.ts:509-540`) envoie à l'appareil tous les véhicules **visibles** par l'utilisateur (filtrés par portée) → un admin/chef de station a déjà tout en local ; un technicien aussi ses véhicules. Donc **recherche locale suffit** pour la plupart. Cas où un endpoint serveur serait utile : véhicules *rendus* anciens si la synchro les omet (à vérifier : filtre sur `rendu` dans la synchro) et grosse volumétrie. Je propose : local d'abord, pas d'endpoint en Phase 2 sauf si la vérif montre des véhicules non synchronisés.

**3.6 Calendrier Citas** — `routes_citas.ts` (nouvelle route `/citas/calendar`, boucle sur `dayOf` avec cache 60 s, concurrence limitée à ~5, limite 120 req/min → un mois ≈ 30 appels, donc un premier affichage = 25 % de la limite ; cache plus long pour les mois passés), `citas.ts` (`CitasSource` : isoler « compter un mois » dans **une seule fonction**), `citas_fake.ts`, UI `v3/CitasDay.tsx` + nouvelle page. Attention : plusieurs utilisateurs ouvrant le calendrier en même temps → cache partagé côté serveur obligatoire.

**3.7 / 3.8 Technicien / Headliner** — nouvelles routes UI (`v3/` : 3 écrans + 2 dialogues par rôle, `CarSvg.tsx` à colorer par intervention), détection du rôle : `technicians.user_id` + `kind` (suffisant, **aucune migration**) → exposé dans le payload de synchro (`me.technician = {id, kind, stationIds}`). Serveur `repair.ts` : dans `vehicle.repairStage`, branche « principal technicien/headliner » : transitions autorisées uniquement (voir Q5/Q6), véhicule à lui, photo présente (§3.9), refus des autres ops (`vehicle.bodyshop`, `status`, …) pour ce profil. `permissions.ts` : `myEarn` + suppression de tout montant. Tests par rôle dans `server/test/v3_repair.test.ts` (+ nouveau fichier).

**3.9 Photo avant déplacement** — serveur (voir B), UI : bouton photo existant (`Bilder.tsx`, `tagPhoto`).

## 3. Migrations prévues (toutes additives / idempotentes)
1. `0016_v4_freelance_scope.sql` : `UPDATE roles SET scope='assigne'` pour la clé système `freelance` uniquement (+ la liste des utilisateurs concernés produite par un script de rapport, pas par la migration). Aucune suppression. À la place d'un UPDATE, alternative sans réécriture : ne rien changer en base et traiter `campagne` comme `assigne` dans le code — **plus sûr pour la compatibilité arrière (ancienne version)**. Je recommande cette alternative (Q3 bis).
2. Optionnel : aucun changement de schéma pour la recherche, le calendrier, le technicien. Un type d'assignation `demontage` (Q9) est de la donnée, pas du schéma.
`npm run integrity` avant/après sur la copie de staging : mêmes chiffres.

## 4. Plan de tests
- Golden `packages/calc` 22/22 inchangé (aucun fichier calc touché).
- Serveur : permissions par rôle (technicien, headliner, chef de station, admin, externe), refus d'opérations interdites, véhicule d'un autre, photo manquante/d'un autre utilisateur/supprimée/d'une autre étape, absence de montants dans les réponses, import sans client/sans station, route calendrier (cache, limite, état injoignable), anciens clients envoyant une campagne.
- i18n : test existant vert, 4 langues.
- UI : captures bureau + 390 px (liste S17-S29, S13, S16, S10, D02-D04, S14d).

## 5. Réponses proposées aux questions du §6 + nouvelles questions

| Q | Ma recommandation |
|---|---|
| 1 S08/D05 : scans sans client aussi bloquants ? | **Oui**, même règle partout (une seule règle d'import). |
| 2 Scan sans station | **Demander** via le picker de stations (pas de choix silencieux) ; pré-sélectionner la dernière station de l'utilisateur. |
| 3 Freelancer | « Véhicules assignés » + accès à durée limitée ; **sans modifier la ligne de rôle en base** (traiter `campagne` comme `assigne` dans le code, liste des utilisateurs concernés dans le rapport). |
| 4 Calendrier | **(a)** appels jour par jour, une seule fonction à remplacer pour passer à **(b)**. |
| 5 Sens du déplacement du technicien | **À confirmer** : l'ordre du tableau est Ready → Disassembly → PDR → Reassembly → Body shop → Finish. « PDR → Disassembly » va **en arrière**. Je pense que vous voulez **Disassembly → PDR** (le technicien PDR commence son travail) ou **PDR → Reassembly** (il a fini). Lequel ? Je ne devine pas. |
| 6 Headliner | Disassembly → PDR et Reassembly → At body shop, comme proposé. |
| 7 Photo pour le chef de station | **Non**, seulement technicien et headliner. |
| 8 Recherche pour comptes externes | **Oui**, limitée à leurs véhicules (déjà garanti par la synchro). |
| 9 (nouveau) Headliner d'un véhicule | Poser une assignation de type `demontage` quand un headliner est choisi, au lieu de comparer des noms texte ? **Oui**, avec rattrapage idempotent des véhicules existants par nom. |
| 10 (nouveau) Tests e2e | Introduire Playwright, ou vitest + vérification manuelle dans le navigateur intégré ? Je recommande la 2e (pas de nouvelle dépendance). |
| 11 (nouveau) Écran technicien : dernière station / « mes stations » | Stations de la fiche technicien (admin) **plus** stations de ses véhicules : OK ? |

## 6. Risques
- Calendrier : limite 120 req/min de Citas partagée avec les autres utilisateurs.
- Technicien hors-ligne : si la photo n'est pas encore envoyée, le serveur refusera le déplacement ; il faut un message clair et l'ordre de la file.
- `demTechName` texte libre : voir C.
- Les captures de la maquette (S01…S38) n'ont pas été comparées au code existant pour les écrans S17-S29 — ce sera fait en Phase 1.
