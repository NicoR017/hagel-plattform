# Phase 0 — Analyse d'écart et plan (feature/ui-v3)

État : branche `feature/ui-v3` créée depuis `main` (7b5e9ed). Commit 1 = `ab88317` (PROMPT_v2.md modifié, PROMPT_v3_ui.md, reference/maquette-v3/). Rien n'est poussé. Aucun code applicatif écrit.
Base de référence : `npx vitest run` sur la branche = **17 fichiers, 414 tests verts** (dont calc golden 22/22).

---

## 1. Analyse d'écart fichier par fichier

Légende : **=** reste tel quel · **M** à modifier · **N** nouveau.

### packages/calc
| Fichier | | Détail |
|---|---|---|
| `src/bvat.ts`, `es.ts`, `compute.ts`, `config.ts` | M | Les constantes sont codées en dur : `teilerVals`, 1,25 / 1,30 / 0,60, matériel Kleber 10/15/20, Hohlraum 15. Il faut un type `AwParams` (nouveau) et un point d'entrée paramétré `computeVehicle(v, settings, method?)`. Sans méthode, le comportement reste identique (golden 22/22). La matrice ES est déjà pilotée par données (`EsMatrix`) → le moteur `matrix` = cet objet. |
| `src/types.ts`, `index.ts` | M | Types `CalcMethod`, `AwParams`. |
| `test/` | M/N | Golden inchangés ; nouveaux tests : méthode système = résultat actuel, méthode copiée avec paramètres changés, versionnage. |

### packages/shared
| Fichier | | Détail |
|---|---|---|
| `permissions.ts` | M | Nouvelles permissions + `SYSTEM_ROLES` (voir §4). |
| `sync.ts` | M | Nouveaux types d'opérations, nouveaux champs d'en-tête (`partsToReplace`, `method`), nouvelles collections dans `PullResponse`. Les schémas existants restent **inchangés**. |
| `schemas.ts`, `errors.ts` | M | Messages d'erreur (`unsupported_op`, `booking_full`, `finish_blocked`…). |

### server
| Fichier | | Détail |
|---|---|---|
| `src/schema.ts` + `migrations/0010+` | M/N | Voir §2. |
| `src/sync.ts` | M | `applyOp` : nouveaux cas ; `toClient` / `flatten` : méthode figée du véhicule, filtrage des nouvelles données ; `buildRefs` : nouvelles listes. Les cas existants ne bougent pas. |
| `src/routes_sync.ts` | M | Validation du lot **op par op** (voir risque R1) ; nouveaux endpoints `booking-calendar`, génération du rapport. |
| `src/reports.ts` | M | `recipientsFor` étendu (e-mails manuels + assureurs auto − exclusions) — voir question Q7. |
| `src/mails.ts`, `email.ts` | M | `MAIL_MODE` (décorateur autour du `Mailer`), nouveaux textes : confirmation/annulation/déplacement de rendez-vous, Reparaturbericht, Wochenbericht (DE+ES). |
| `src/config.ts`, `index.ts` | M | `MAIL_MODE`, `MAIL_REDIRECT_TO`, `APP_ENV`, `UI_V3_DEFAULT`. |
| `src/worker.ts` | M | Job « rendez-vous du jour » (00:05 heure de la station + rattrapage au boot). Le `daily()` actuel est en UTC → remplacé par un déclenchement horaire idempotent. |
| `src/dashboard.ts` | M | Colonnes du tableau par station, compteurs par mode ; montants recalculés avec la méthode figée. `buildTechSheets` : voir Q9. |
| `src/permissions.ts`, `principal.ts` | M | Nouvelles permissions dans `can()` / `FIELD_RULES`. |
| `src/routes_master.ts`, `app.ts` | M | Station : édition complète, capacité/jour, exclusions d'e-mails ; utilisateurs : suppression (désactivation douce) ; rôles : suppression avec rôle de remplacement ; méthodes ; techniciens `kind`. |
| `src/gtmotive.ts` | N | Interface vide (aucun appel API). |
| `src/repair.ts` (ou équivalent) | N | To-dos, contrôles, Finish (règles côté serveur), événements, rendez-vous, réservations. |
| `src/scripts/integrity.ts` | N | `npm run integrity` (le dossier `scripts/` n'existe pas encore). |
| `src/reports_repair.ts` | N | Génération **côté serveur** du Reparaturbericht (voir R6). |
| `test/*` | M/N | Suites existantes inchangées ; ajouts listés au §7 de PROMPT_v3. |

### infra
| Fichier | | Détail |
|---|---|---|
| `infra/README_STAGING.md` | N | Procédure staging + go-live + retour arrière. |
| `infra/scripts/staging_refresh.sh` | N | Refuse de tourner si la cible = URL de prod. |
| `infra/README_RAILWAY.md` | M | Nouvelles variables d'environnement. |

### app
| Fichier | | Détail |
|---|---|---|
| `src/field/route.ts` | M | Nouvelles routes `#/s/:station/...`, `#/expertise/...` ; anciennes routes (`#/v/:id/:tab`, `#/dashboard`, `#/admin/...`) redirigées. |
| `src/App.tsx` | M | Nouvelle coque (menu, « ‹ Zurück », bannière STAGING, drapeau `?ui=legacy`, toast de nouvelle version). |
| `src/field/List.tsx`, `VehicleScreen.tsx`, `Basis/Erfassung/Bilder/Kva/Panel.tsx`, `Scans.tsx`, `Dialogs.tsx`, `Dashboard.tsx` | M | Logique réutilisée, habillage refait. Anciens composants conservés, marqués `@deprecated`, accessibles via `?ui=legacy`. |
| `src/admin.tsx`, `admin2.tsx` | M | Nouveaux écrans de Verwaltung. |
| `src/field/*` nouveaux | N | Choix de la station / du mode, sélection multiple + barre, dialogue statut/déplacement + annulation, Expertise-Assistent (étape 0), Zu ersetzende Teile, lightbox, Kommentare, Reparaturtermin (calendrier mensuel), Technikerplanung, Verlauf, GT Motive (coquille), tableau Kanban, détail réparation. |
| `src/sync/db.ts` | M | `this.version(2)` **additive** (nouveaux stores), jamais de `delete()`. |
| `src/sync/engine.ts`, `ops.ts`, `mutations.ts` | M | Nouvelles opérations (envoyées dans des lots séparés, voir R1), prise en compte du refus `unsupported_op`. |
| `vite.config.ts` | M | Service worker : voir R3. |
| `src/i18n.ts`, `i18n_field.ts` | M | Tous les nouveaux textes (DE + EN). |
| polices | M | La maquette charge Inter depuis Google Fonts : à héberger nous-mêmes (PWA hors ligne). |

### packages/documents
| Fichier | | Détail |
|---|---|---|
| `pdf.ts`, `text.ts`, `types.ts` | M | « Zu ersetzende Teile » (encadré KVA, texte, en-tête Fotobericht), nom de la méthode en petit ; snapshots PDF à mettre à jour. |
| `pdf.ts` | N | Reparaturbericht (sans répartition interne). |
| `techsheet.ts`, `xlsx.ts` | M | Wochenbericht Techniker/Headliner. |

### packages/colibri : = (aucun changement).

---

## 2. Migrations prévues (0010+, strictement additives)

Toutes générées avec drizzle-kit, relues à la main, backfills idempotents (`WHERE nouvelle_colonne IS NULL`), testées sur une base PGlite dans l'état **pré-migration** puis sur la copie Postgres 18 de staging.

| N° | Contenu | Backfill |
|---|---|---|
| 0010 | `vehicles.repair_stage text null` ; `vehicles.method_id uuid null`, `method_version int null` ; table `calc_methods` ; table `insurer_methods` | `repair_stage` : `reparatur` → `bereit` (ou `pdr` si un technicien est assigné — Q2) ; `attente` avec `statut_avant='reparatur'` → même règle ; `fertig` → `finish` ; autres → null. Méthodes système : une ligne par organisation et pays (« BVAT 2025 (System) », « PDR Team Matrix (System) », `is_system=true`, version 1). **Pas de réécriture du JSONB `header` des véhicules existants** (voir Q5). |
| 0011 | `repair_todos`, `repair_checks`, `repair_events`, `repair_appointments`, `vehicle_comments` | aucun |
| 0012 | `stations.repairs_per_day int default 3`, `stations.excluded_insurer_emails text[] default '{}'` ; `repair_bookings` (+ index unique partiel `vehicle_id WHERE status='booked'`, index `(station_id, date)`) | stations existantes → 3 |
| 0013 | `photos.repair_stage`, `photos.role` (null) ; `technicians.kind text default 'pdr'` | techniciens existants → `pdr`. `photos.user_id` : **inutile**, `photos.taken_by` existe déjà. |
| 0014 | Permissions : ajout aux rôles existants (`UPDATE roles SET permissions = permissions || ...`, sans doublon) | voir §4 |

Notes :
- `vehicle_assignments` (type `pdr`/`demontage`) et `shares` (`demTechName`/`demTechPct`) couvrent déjà le Headliner : **pas de nouvelle colonne**.
- `partsToReplace` : dans `header` (JSONB) ; ajouté seulement quand l'utilisateur en saisit → aucun véhicule existant n'est réécrit. Justification : l'écriture LWW par groupe de champs reste identique.
- Le backfill de `repair_stage` ne doit **jamais** déclencher d'envoi de rapport (l'envoi n'est lié qu'à la *transition* vers Finish).
- Durée de création des index sur la copie staging : mesurée en phase 2.

---

## 3. Nouvelles opérations de synchronisation

Existantes (inchangées) : `vehicle.create/header/panel/shares/status/move/delete/assign/colibri`, `photo.add/update/delete`, `report.send`.

Nouvelles :
`vehicle.repairStage` · `repair.todo.add` · `repair.todo.toggle` · `repair.todo.delete` · `repair.check` · `vehicle.comment` · `appointment.add/update/delete` (Technikerplanung) · `booking.create` · `booking.move` · `booking.cancel`.
Champs d'en-tête (via `vehicle.header`) : `partsToReplace`, `method` (id + version). `photo.add` : `repairStage`, `role` (optionnels).
Ajouts à `PullResponse` : tâches, contrôles, commentaires, événements, rendez-vous, réservations (filtrés par permission).
Côté serveur : opération inconnue → `409 unsupported_op` (l'opération reste en file chez le client).

## 4. Nouvelles permissions

| Permission | Donnée par la migration à… |
|---|---|
| `reparatur.board` | rôles ayant `vehicules.changer_statut` |
| `reparatur.endabnahme` | Admin d'organisation, Chef de site (+ rôles personnalisés qui ont `vehicules.assigner` ET `prix.voir` — liste fournie dans le rapport de phase 2) |
| `termine.buchen` | rôles ayant `vehicules.changer_statut` (comme demandé) |
| `methoden.gerer` | rôles ayant `parametres.gerer` |
| `wochenbericht.voir` | rôles ayant `parametres.gerer` ou `export.excel` + `repartition_interne.voir` |
| `kommentare.schreiben` (proposé) | rôles ayant `vehicules.modifier` |

Les techniciens (scope `assigne`) ont `reparatur.board` limité à leurs véhicules, pas de `endabnahme`.

---

## 5. Plan de l'environnement staging (Railway)

**Ce que je prépare** (phase 1) : `MAIL_MODE` / `APP_ENV` / bannière STAGING, nom de cookie et cache du service worker distincts, `staging_refresh.sh`, `integrity`, `README_STAGING.md`.

**Ce que tu dois faire toi-même** (accès Railway) :
1. Railway → projet existant → *Environments* → **New Environment → Duplicate from production**, nom `staging` (duplique api, worker, Postgres avec leurs propres variables et volume).
2. Dans `staging` : pour le service api **et** worker, *Settings → Source → Branch* = `feature/ui-v3` (prod reste sur `main`). Cela suppose que la branche existe sur GitHub → je ne la pousse que sur ton OK.
3. Variables staging : `APP_ENV=staging`, `MAIL_MODE=redirect`, `MAIL_REDIRECT_TO=nicolas.rasteiro@pdr-team.de`, `APP_URL=<domaine staging>`, `AZURE_SYNC_MINUTES=15`, un `SESSION_SECRET` **différent**, un `EMAIL_API_KEY` (même Resend possible), bucket staging.
4. Vérifier que `DATABASE_URL` / `S3_*` de `staging` pointent bien sur les ressources **staging** (et pas sur celles de prod : la duplication doit les remplacer).
5. Restaurer une copie de prod : `pg_dump -Fc` (ou dump de la nuit dans `backups/`) puis `staging_refresh.sh` (je te donne la commande exacte).
6. Bucket : copie des photos (option A) ou lecture seule de la prod (option B) — Q8.
7. Générer un domaine Railway pour l'api staging.
8. Azure : même SAS (lecture/liste uniquement) — rien à cliquer.

Je ne lance **aucune** commande Railway/prod.

---

## 6. Points flous ou en contradiction avec le code

**Risques techniques de transition (je propose une solution pour chacun)**

- **R1 — Lot refusé en entier.** `pushInput` est une union Zod : une opération de type inconnu fait échouer (400) **tout le lot**. Donc (a) la spec §8.4 (`409 unsupported_op`) impose de valider op par op côté serveur ; (b) pour le retour arrière, un serveur *ancien* rejetterait aussi tout lot contenant une opération v3, et ses en-têtes `.strict()` rejettent `partsToReplace` / `method`. **Solution :** le client v3 envoie les opérations nouvelles dans des lots *séparés* des opérations historiques, et laisse les nouvelles en file en cas d'erreur. Comportement du client actuel sur un 400 : à tester (engine.ts ne traite explicitement que 401/429/5xx).
- **R2 — Statut et étape.** Un vieux client ou `?ui=legacy` peut envoyer `vehicle.status = fertig` ou `reparatur` sans passer par les règles « Finish bloqué » et sans rapport automatique. **Solution proposée :** `statut` reste la vérité ; passage à `fertig` par l'ancien chemin met `repair_stage='finish'` mais **sans** envoi automatique, avec une entrée « Verlauf » ; l'envoi/blocage ne s'appliquent qu'à `vehicle.repairStage`. Voir Q3.
- **R3 — Service worker.** `registerType: autoUpdate` + `skipWaiting` + `clientsClaim` : la nouvelle version prend la main tout de suite. La spec demande « finir les envois, puis recharger avec un toast ». À changer. IndexedDB n'est jamais touché.
- **R4 — Calculs côté serveur.** Les montants sont recalculés dans `sync.ts` (`toClient`), `dashboard.ts`, `techsheet`/`xlsx` et dans l'app. La méthode figée du véhicule doit être appliquée partout, sinon des écarts apparaissent entre écran, export et tableau de bord.
- **R5 — Versionnage vs règle « ne pas réécrire le header ».** La spec demande un instantané `header.method` pour les véhicules existants **et** interdit de réécrire leur header. Contradictoire → Q5.
- **R6 — Reparaturbericht automatique.** Aujourd'hui tous les PDF sont générés **sur le téléphone** puis envoyés. L'envoi automatique à Finish exige une génération **serveur** (pdf-lib tourne sous Node, mais il faut lire les photos du stockage, logo et polices). C'est du travail nouveau, pas un simple branchement.
- **R7 — E-mails de staging.** `MAIL_MODE=redirect` s'appliquerait aussi aux liens de connexion et invitations : tes utilisateurs de test ne recevraient rien. Ils peuvent utiliser le mot de passe (déjà en place, hashes copiés avec la base). Q8.
- **R8 — Rendez-vous = données personnelles** (téléphone et e-mail du client final) : à ne pas envoyer aux téléphones des rôles sans `termine.buchen`, durée de conservation à décider (RGPD/DSGVO).
- **R9 — Capacité.** La vérification « jour plein » doit verrouiller la ligne de la station (`SELECT … FOR UPDATE`) pour que deux réservations simultanées ne dépassent pas la capacité (409 pour la seconde).
- **R10 — Dexie.** Un seul `version(1)` aujourd'hui. Les nouvelles données de réparation hors ligne exigent `version(2)` additive.

**Contradictions entre spec / maquette / code**

1. **Répartition (maquette ≠ code).** La maquette fixe 150 € de De-/Remontage et une commission Bodyshop de 10 % du **netto** ; le code calcule : base = netto − vitres, base PDR = base − De-/Re, commission sur la base (pct ou Staffel ES), valeurs par défaut techniques 50 % / 100 %. Je suivrai `packages/calc`. (Q1)
2. **Destinataires (spec ≠ code).** Aujourd'hui : carrosserie + l'assureur **du véhicule**. La spec §3.4 décrit « e-mails manuels + e-mails de **tous** les assureurs sélectionnés de la station − exclusions » : un KVA Allianz partirait aussi chez HUK. (Q7)
3. **Wochenbericht vs fiche technicien existante.** Il existe déjà une fiche hebdomadaire (PDF/Excel, `buildTechSheets`, par période, avec AW). La maquette définit le Wochenbericht par « passé en Finish dans la semaine », sur base nette − 150 €. (Q9)
4. **Headliner sans compte.** La maquette a des Headliner freelances ; le code assigne par `user_id` (`vehicle_assignments.user_id` → `users`) et les parts par nom libre. Un technicien/headliner sans compte ne peut donc pas être « assigné » ni voir « sa part ». (Q4)
5. **Méthode ES « système ».** `org_settings.esMatrix` est aujourd'hui modifiable par organisation (écran Preise) ; la spec veut une méthode système verrouillée. Faut-il copier la matrice actuelle de chaque organisation dans la méthode système v1 ? (Q5)
6. **`photos.user_id`** : déjà couvert par `taken_by`.
7. **Types de rapports.** `report_sends.type` contient `reparation` (Fotobericht, envoyé manuellement) ; la spec ajoute `reparaturbericht`. Sont-ils le même document ? (Q6)
8. **Wartet et mode.** Maquette : tout « Wartet » sauf motif « Teile » est classé en Kalkulation (donc aussi « Demontage », « Sonstiges »). Spec : « Wartet (Freigabe) » en Kalkulation, « Wartet (Teile) » en Reparatur. Le motif est du texte libre côté code.
9. **« Fahrzeug in Reparatur aufnehmen ».** « Expertisés » = maquette : statuts `besichtigung` et `attente` (hors Teile). Pas de critère sur l'existence d'un chiffrage. Faut-il exiger un KVA calculé (netto > 0) ?
10. **Rendez-vous auto → Bereit sans technicien.** À la date, le véhicule passe en Bereit sans technicien ni Headliner ; Finish est-il autorisé sans eux ?
11. **Rôle « Chef de station ».** Maquette/spec : « Chef de station » ; code : rôle système `chef_site` « Chef de site (Werkstattleiter) ». Renommer le libellé ?
12. **Fuseaux.** La spec nomme Europe/Berlin et Europe/Madrid (même décalage horaire) ; le pays d'une station n'a que DE/ES. Je les prends comme déclarées.
13. **La maquette** : `Main.dc.html` charge `./support.js`, absent du dossier, et `Mobile.dc.html` importe `Main`. **Je n'ai pas pu l'afficher** : je l'ai lue dans le code (HTML + script). Les captures de comparaison se feront sur mon implémentation. La formule DE de la maquette est volontairement simplifiée, confirmée à la lecture (racine carrée) : non reprise.
14. **Anciennes routes dans les e-mails** : les e-mails actuels ne contiennent pas de lien `#/...` (les liens de connexion sont `/login?token=`), donc seuls les favoris sont concernés.
15. `UI_V3_DEFAULT` « sans redéployer » : l'app est un fichier statique ; la valeur sera lue via un petit endpoint public et mise en cache dans Dexie.

---

## 7. Questions ouvertes (§10 de PROMPT_v3_ui.md + celles trouvées)

Voir le rapport (message final).
