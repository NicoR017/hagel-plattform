# Checklist de mise en production : nouvelle interface (branche `feature/ui-v3`)

À exécuter par **Nicolas**. Rien n'a été poussé, fusionné ni déployé par l'assistant. Procédure détaillée et retour arrière : `infra/README_STAGING.md` §5.

## A. Prérequis (staging)
- [ ] Environnement Railway `staging` créé (Postgres, services, bucket), `APP_ENV=staging`, `MAIL_MODE=redirect` vers Nicolas, Azure en lecture seule.
- [ ] Copie de la production restaurée en staging (lecture seule côté prod) ; `npm run integrity -- --compare avant.json` → **IDENTICAL**.
- [ ] Migrations 0010, 0011, 0012 passées sur la copie sans erreur (additives : aucun DROP / RENAME / suppression de ligne).
- [ ] Les 22 golden tests : 22/22 ; les montants des véhicules existants n'ont pas bougé (somme `netto` identique à l'intégrité).
- [ ] 1–2 utilisateurs de terrain ont travaillé 2–3 jours sur téléphone et bureau.
- [ ] Anciennes PWA (téléphones qui n'ont pas encore la nouvelle version) testées contre le serveur staging : synchronisation OK.
- [ ] Un téléphone hors ligne avec des opérations en attente se synchronise après la mise à jour (rien perdu).
- [ ] Scans Azure reçus et importés ; PDF KVA et rapport de réparation corrects en DE et ES ; e-mails uniquement redirigés.
- [ ] Rapport de réparation automatique reçu à Finish (redirect) ; renvoi par le chef testé ; pas de répartition interne dans le PDF.
- [ ] Wochenbericht : totaux = somme des véhicules de la semaine ; envoi PDF reçu.

## B. Décisions à prendre
- [ ] `UI_V3_DEFAULT` : `true` dès la mise en ligne, ou `false` d'abord (la nouvelle interface reste accessible avec `?ui=v3`) puis `true` après une journée de vérification.
- [ ] Questions encore ouvertes : moment où l'estimation est figée ; annulation d'un déplacement pour un chef limité à la station d'origine ; une photo par étape (Demontage, PDR, Remontage) exigée à Finish ; montants net/TVA/brut dans le rapport envoyé à tous les destinataires ; nom du technicien libre vs choisi dans la liste (Wochenbericht).

## C. Juste avant la fusion
1. [ ] Prévenir les utilisateurs : fenêtre de ~10 minutes le soir, rester en ligne pour que les opérations hors ligne partent.
2. [ ] **Sauvegarde manuelle de la prod** : `pg_dump -Fc` vers `backups/pre-v3-AAAAMMJJ.dump` **et** snapshot Railway ; vérifier (`pg_restore --list` au minimum, idéalement restauration en staging + `npm run integrity`).
3. [ ] Noter l'ID du déploiement / commit de production actuel (pour « Redeploy »).
4. [ ] `npm run integrity > avant-prod.json` contre la prod (lecture seule).
5. [ ] Variables de production posées **avant** la fusion : `APP_ENV=production`, `MAIL_MODE=live`, `UI_V3_DEFAULT=<décision B>`.

## D. Fusion et déploiement
1. [ ] PR `feature/ui-v3` → `main` (liste des migrations 0010–0012, variables, cette checklist). **Nicolas fusionne.**
2. [ ] Railway déploie ; les migrations passent au démarrage ; pas d'erreur dans les logs.
3. [ ] `npm run integrity -- --compare avant-prod.json` contre la prod → IDENTICAL (hors tables ajoutées).
4. [ ] Test rapide : connexion, liste des stations, ouvrir un véhicule, PDF KVA, tableau de réparation, une synchro depuis un téléphone.
5. [ ] Un utilisateur sur l'ancienne PWA : il continue de travailler, la mise à jour arrive quand sa file d'envoi est vide et qu'il est sur un écran calme (pas de dialogue, pas dans une expertise).

## E. Retour arrière
- **Interface seulement** : `UI_V3_DEFAULT=false` ou `?ui=legacy`. Pas de redéploiement.
- **Serveur** : « Redeploy » du déploiement précédent. Les migrations étant additives, l'ancien code tourne sur le nouveau schéma. Les clients v3 gardent leurs nouvelles opérations en file.
- **Données** (dernier recours) : restaurer le dump `pre-v3` dans une **nouvelle** base et changer `DATABASE_URL`. Les écritures faites après la sauvegarde sont perdues : décision de Nicolas uniquement.

## F. Après la mise en ligne (J+1, J+7)
- [ ] Journal d'audit et logs : pas d'erreur `unsupported_op` répétée, pas d'envoi de rapport en « failed ».
- [ ] Capacité du calendrier de réparation et envoi des rappels : un jour réel passé sans accroc.
- [ ] Retirer `?ui=legacy` seulement après plusieurs semaines sans retour de ce côté.

---

# Ajouts v4 (branche `feature/ui-v4`, créée depuis `feature/ui-v3`)

La v4 **n'ajoute aucune migration** (`git diff feature/ui-v3 -- server/migrations server/src/schema.ts` est vide) : le schéma de la base est celui de la v3, l'ancien code tourne donc sur la même base. Elle se fusionne **après** `feature/ui-v3` (ou avec elle) ; si `feature/ui-v3` est fusionnée avant, rebaser `feature/ui-v4` sur `main`.

## G. Prérequis v4 (staging)
- [ ] `feature/ui-v4` déployée sur le staging Render (`hagel-staging-api` et `hagel-staging-worker`, branche changée de `feature/ui-v3` à `feature/ui-v4`, jamais sur les services de production).
- [ ] `render_integrity.ps1 -Compare` après le déploiement → **IDENTICAL** (avant : `netDigest` `dc6fa5b7…`, 12 véhicules vivants, net 20 872,17 € en Espagne ; aucune table ajoutée par la v4).
- [ ] Golden 22/22 et suite complète verte (658 tests au dernier passage).
- [ ] Les quatre langues complètes (test i18n vert) ; dates dans la langue de l'utilisateur.
- [ ] **Rôle Freelancer** : lancer `npm run freelancers -w @hagel/server` contre la copie de la prod (lecture seule) et noter les comptes : ils voient désormais leurs véhicules assignés en plus de leur ancienne campagne ; l'accès limité dans le temps est conservé. Les nouveaux véhicules n'ont plus de campagne.
- [ ] Inviter une personne avec le rôle Technicien (choix PDR ou Headliner dans le formulaire) : elle apparaît **tout de suite** dans « Techniciens & headliners » (e-mail renseigné, sans compte) ; à l'acceptation la même fiche est liée au compte et prend son vrai nom (jamais de doublon : une fiche existante avec le même e-mail est reprise).
- [ ] Technicien et headliner : fiches **Techniciens et headliners** liées à un compte (champ Compte) ; le compte a le rôle Technicien. Sans cette liaison, le compte garde l'interface habituelle.

## H. Décisions v4 à valider
- [ ] Un technicien ou headliner lié à une fiche **ne peut plus changer un statut ni choisir la carrosserie** (sinon « Fertig » contournait les contrôles de Finish). Ligne à retirer dans `sync.ts` (`vehicle.status`) et `repair.ts` (`vehicle.bodyshop`) si ce n'est pas voulu.
- [ ] Déplacements : technicien Démontage → PDR ; headliner Démontage → PDR et Remontage → At Bodyshop. Rien d'autre.
- [ ] Photo de l'étape courante prise par lui-même, obligatoire avant ces déplacements (pas pour le chef de station).
- [ ] « Annuler » après un déplacement : le déplacement n'est envoyé qu'après 6 secondes sans annulation (le serveur refuse les retours en arrière du profil terrain).
- [ ] Calendrier PDR Citas : appels jour par jour (≈ 31 par mois, budget de 90 requêtes par minute) ; demander à l'équipe Citas une route par période (`from`/`to`) pour passer à l'option (b) : une seule fonction à changer (`monthCounts`).
- [ ] La recherche assureur ne cherche pas par e-mail (les e-mails d'assureurs ne sont pas envoyés aux téléphones).

## I. Liste de tests manuels pour Nicolas (staging, à faire sur téléphone)
Comptes : un compte **technicien** (fiche pdr) et un compte **headliner** (fiche headliner), créés par Nicolas ; 2–3 jours d'usage réel.

Téléphone (390 px), tous profils :
- [ ] Administration : le sélecteur de section en haut, tableaux en cartes ; tous les boutons (Modifier / Désactiver / Supprimer) atteignables ; montants du rapport hebdomadaire visibles.
- [ ] Estimation et tableau de bord : toutes les colonnes visibles, pas de défilement latéral.
- [ ] Recherche assureur, technicien, personnes et station de destination : clavier, accents, « travaille ici », « complète », « autre tenant ».
- [ ] Plus aucune campagne dans l'interface (Généralités, filtres, rôles).
- [ ] Champ de recherche d'en-tête : « 7731kbr » trouve « 7731 KBR » ; véhicules rendus compris ; un clic ouvre le détail réparation ou la fiche.
- [ ] Nouveaux scans : ligne d'un scan sans carrosserie et sans station → choix de la station → l'expertise s'ouvre sur Généralités.
- [ ] Calendrier PDR Citas : mois, jour par heure, démarrage d'une expertise depuis un rendez-vous, état « PDR Citas injoignable ».

Technicien :
- [ ] Il ne voit ni Administration, ni tableau de bord, ni scans, ni prix ; sa liste ne contient que ses voitures.
- [ ] « Tu gagnes » = seulement sa part (PDR %), jamais net ni brut.
- [ ] Voiture en Démontage : sans photo, bouton grisé + encadré orange ; après la photo : « Passer à PDR » ; Annuler dans les 6 secondes ; le déplacement arrive.
- [ ] Hors ligne : photo puis déplacement ; après reconnexion, accepté ou refus affiché clairement.
- [ ] Il ne peut déplacer aucune autre voiture, ni vers une autre colonne (le serveur refuse).

Headliner :
- [ ] Seulement ses voitures (Aus-/Einbau) ; pièces à poser (barrées une fois faites) ; pièces remplacées en rouge sur le schéma.
- [ ] Déplacements Démontage → PDR et Remontage → At Bodyshop, chacun après sa photo ; jamais vers Finish.

## J. Retour arrière v4
- Redéployer la branche précédente sur le service concerné (aucune migration à défaire).
- Les téléphones gardent leurs opérations en file ; un serveur plus ancien répond `409 unsupported_op` pour les opérations qu'il ne connaît pas.

---

# Ajouts v5 (branche `feature/ui-v5`, créée depuis la v4) : v4 + v5 en production le lundi

La v5 **ajoute 3 migrations**, toutes additives (aucun DROP / RENAME / suppression de ligne), dans cet ordre, au démarrage du serveur :
- `0016_v5_bodyshops` : colonnes `contact_name` / `contact_phone` sur les stations, permission `bodyshops.gerer` ajoutée aux rôles qui avaient `stations.gerer`.
- `0017_v5_colibri_devices` : tables `colibri_devices` et `colibri_device_assignments`, permission `colibri.geraete` (mêmes rôles).
- `0018_v5_handovers` : table `vehicle_handovers` et trois colonnes sur `vehicles` (`repair_entered_at`, `drop_off_signed_at`, `pick_up_signed_at`).

Une quatrième étape **n'est pas une migration** et se lance à la main : le script `v5:move-bodyshop-vehicles` (voitures qui se trouvent dans une carrosserie → « Chapauto »). Par défaut il ne fait qu'un essai à blanc.

## K. Prérequis v5 (staging)
- [ ] `feature/ui-v5` déployée sur `hagel-staging-api` et `hagel-staging-worker` (jamais sur les services de production). **Nicolas décide du push de la branche.**
- [ ] Avant : `render_integrity.ps1 -Out avant-v5-staging.json` (staging, lecture seule). Après les migrations : `render_integrity.ps1 -Compare avant-v5-staging.json` → **IDENTICAL** ; les tables ajoutées par la v5 sont listées sous `added`.
- [ ] Essai à blanc sur la copie de la production : `npm run v5:move-bodyshop-vehicles -w @hagel/server` (DATABASE_URL du staging). Attendu sur la copie du 22/10 : 6 voitures (1 vivante « 0137 KKG », 5 supprimées), « Chapauto » unique et active. Si le script s'arrête avec des problèmes (Chapauto absente, en double, inactive ou carrosserie), rien n'est écrit : corriger puis relancer.
- [ ] Puis, sur le staging seulement : `--apply --confirm-backup`, ensuite `render_integrity.ps1 -Compare avant-v5-staging.json -AfterV5Move` → **IDENTICAL** : seuls `byStation`, `counts.vehicle_moves` et `counts.audit_log` bougent (affichés comme « EXPECTED » : un mouvement et une ligne d'audit par voiture) ; montants (`netDigest`, `netTotal`), nombre de véhicules, photos, utilisateurs, scans restent identiques.
- [ ] Golden 22/22 et suite complète verte (744 tests au dernier passage, 3 ignorés).
- [ ] Quatre langues complètes (test i18n vert).
- [ ] Test hors ligne : un téléphone signe un dépôt en mode avion, se reconnecte → la signature arrive une seule fois, le reçu PDF est créé. Un ancien téléphone (v4) garde ses opérations en file (rien de perdu).
- [ ] E-mail du reçu client : en `MAIL_MODE=redirect`, reçu chez Nicolas ; en cas d'échec, l'état « échec » et le bouton « Renvoyer » apparaissent dans la fiche du véhicule.

## L. Décisions v5 déjà validées par Nicolas
- Signature : permission `vehicules.changer_statut` réutilisée ; dépôt « à signer » seulement pour les voitures qui entrent au tableau **après** la mise en ligne (les voitures déjà en réparation n'affichent rien).
- Signature enregistrée sous forme de dessin vectoriel ; nom, e-mail et signature du client jamais visibles pour les profils technicien / headliner, jamais dans la synchronisation du véhicule, jamais dans l'Excel ; le journal d'audit ne garde qu'une référence.
- Fuseaux : organisation ES = Europe/Madrid, sinon Europe/Berlin (affectation des scanners par jour).
- Ordre de priorité si le temps manque : 2.1 + migration, 2.2, 2.5 + 2.6, 2.4, 2.3.

## M. Juste avant la fusion (en plus de C)
1. [ ] **Sauvegarde manuelle de la production** (`pg_dump -Fc`, voir `docs/SAUVEGARDE_RENDER.md`) **et** de la sauvegarde nocturne de la veille ; vérifier `pg_restore --list`. **Test de restauration** : restaurer ce dump dans le staging (`infra/scripts/render_restore.ps1 -Dump <fichier> -DbId <id staging> -ExpectName hagel-staging-db`) puis `render_integrity.ps1` : mêmes chiffres que la production. (Nécessite Docker Desktop ou `pg_restore` installé sur le poste.)
2. [ ] Rejouer **sur la production, en lecture seule**, `infra/scripts/v5_dryrun.sql` (voitures en carrosserie, scanners vus dans les scans, scans par future station) et comparer à `PHASE0_V5_ANALYSE.md`.
3. [ ] `render_integrity.ps1 -Out avant-v5-prod.json` contre la production (garde-fou : le script refuse toute autre base que celle nommée).
4. [ ] Noter l'ID du déploiement de production actuel (v3/v4) pour « Rollback ».
5. [ ] Prévenir les utilisateurs : fenêtre de ~10 minutes, rester en ligne.

## N. Ordre le jour J
1. [ ] Fusion de `feature/ui-v5` dans `main` (**Nicolas fusionne**) → Render déploie → migrations 0016, 0017, 0018 au démarrage ; vérifier les logs.
2. [ ] `render_integrity.ps1 -Compare avant-v5-prod.json` → IDENTICAL (hors tables ajoutées).
3. [ ] Essai à blanc du script de déplacement sur la production, puis `--apply --confirm-backup` **seulement si** Nicolas valide la liste affichée.
4. [ ] `render_integrity.ps1 -Compare avant-v5-prod.json -AfterV5Move` → IDENTICAL (hors lignes « EXPECTED »).
5. [ ] Test rapide : connexion, stations, tableau de réparation, signature d'un dépôt de test, reçu PDF, tableau de bord « Carrosseries × assurances ».

## O. À faire juste après la mise en ligne (Nicolas)
- [ ] **Affecter les scanners Colibri aux stations** (menu Scanners Colibri, S40) : tant qu'un scanner n'est pas affecté, ses scans apparaissent « sans station » (visibles seulement des administrateurs). Proposition Espagne : COLIBRI-028 → Chapauto ; l'Allemagne n'a pas encore de stations.
- [ ] Contrôler la liste des **Carrosseries** (S39) : contacts, commissions, comptes externes ; aucune carrosserie ne doit rester choisie comme lieu.
- [ ] Contrôler **Chapauto** (station de type parc ou hall, active) et les voitures déplacées (historique du véhicule : note « moved to Chapauto – body shops are no longer stations »).
- [ ] Vérifier que les chefs de station ont bien le droit « Scanners Colibri » / « Carrosseries » voulu (rôles personnalisés : à cocher à la main).

## P. Retour arrière v5
- **Code** : « Rollback » vers le déploiement précédent sur Render. Les migrations étant additives, l'ancien code tourne sur le nouveau schéma (colonnes et tables ignorées). Les voitures déplacées vers Chapauto y restent (retour possible voiture par voiture via l'historique des déplacements).
- **Téléphones** : les opérations `vehicle.handover` en file restent en file sur un serveur plus ancien (réponse `409 unsupported_op`) et partent après la remise à niveau : aucune signature perdue.
- **Données** (dernier recours) : restaurer le dump pré-v5 dans une **nouvelle** base et changer `DATABASE_URL` ; les écritures postérieures à la sauvegarde sont perdues : décision de Nicolas uniquement.
- Les reçus déjà envoyés par e-mail aux clients ne se rappellent pas.
