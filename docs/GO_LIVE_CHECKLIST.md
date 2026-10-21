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
