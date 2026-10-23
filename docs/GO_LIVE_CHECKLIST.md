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
