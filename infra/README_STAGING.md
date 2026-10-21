# Environnement de test (staging) et mise en production de l'UI v3

Règle d'or : **rien de ce qui est décrit ici ne touche la production** tant que Nicolas n'a pas décidé la mise en production (§5). Le staging a sa propre base, ses propres secrets, et n'envoie aucun e-mail réel.

## 1. Principe

| | Production | Staging |
|---|---|---|
| Environnement Railway | `production` | `staging` (même projet `hagel-plattform`) |
| Base Postgres | celle de prod | **une base à part** |
| Code déployé | branche `main` | branche `feature/ui-v3` (déployée à la main avec `railway up`, ou depuis GitHub quand la branche sera poussée) |
| `APP_ENV` | `production` | `staging` → bannière rouge « STAGING » sur chaque écran |
| E-mails | réels (`MAIL_MODE=live`) | `off` (rien n'est envoyé) ou `redirect` (tout part vers Nicolas, destinataires d'origine dans l'objet) |
| Azure | SAS lecture seule | pas de SAS au départ ; plus tard le même SAS (lecture/liste), jamais d'écriture |
| Photos / PDF | bucket `hagel-files` | pas de bucket au départ (mémoire, perdu au redémarrage) ; plus tard un bucket **à part** |
| Sauvegardes nocturnes | oui | non (`APP_ENV=staging` les désactive : jamais d'écriture dans le bucket de prod) |

Les téléphones : staging et production ont des adresses différentes, donc des données locales (IndexedDB, session) **séparées** par le navigateur lui-même ; une PWA de prod installée ne se mélange pas avec l'onglet staging.

## 2. Variables d'environnement (nouvelles)

| Variable | Service | Valeur |
|---|---|---|
| `APP_ENV` | api, worker | `production` ou `staging` (défaut : `production` si `NODE_ENV=production`) |
| `MAIL_MODE` | api | `live` \| `redirect` \| `off`. Non défini : `live`, sauf en staging où c'est `off`. `staging` + `live` = le serveur refuse de démarrer. |
| `MAIL_REDIRECT_TO` | api | obligatoire avec `MAIL_MODE=redirect` (ex. `nicolas.rasteiro@pdr-team.de`) |
| `UI_V3_DEFAULT` | api | `true` (défaut) ou `false` : nouvelle interface par défaut ; l'ancienne reste ouverte avec `?ui=legacy` |

Staging, jeu minimal : `APP_ENV=staging`, `MAIL_MODE=off`, `SESSION_SECRET` (nouveau, ≥ 32 car.), `APP_URL`, `DATABASE_URL` (référence au Postgres **staging**), `SEED_SUPERADMIN_EMAIL`. **Ne pas copier** `EMAIL_API_KEY`, `AZURE_STORAGE_SAS`, `S3_*` de la production.

## 3. Données de test

Données fictives (aucune donnée de prod) :

```bash
APP_ENV=staging DATABASE_URL=<url staging> SEED_SUPERADMIN_EMAIL=<ton e-mail> STAGING_TEST_PASSWORD=<10+ caractères> \
  npm run seed:staging -w @hagel/server
```

Crée 2 organisations (DE, ES), des stations, 16 véhicules par organisation dans tous les statuts, et 3 comptes de test par organisation (`de.chef@staging.test`, `de.assessor@staging.test`, `de.tech@staging.test`, idem `es.`) avec le mot de passe donné. Le script refuse de tourner sans `APP_ENV=staging` et sur une base qui contient déjà de vrais utilisateurs. Il est idempotent.

Copie de la production (plus tard, si tu le décides) : `infra/scripts/staging_refresh.sh`. La production n'est **lue** (`pg_dump`), jamais modifiée ; le script refuse de tourner si la cible = la source, si la cible est la production connue, ou si la base cible n'est pas marquée « staging ».

### Staging local (sans Railway)

```bash
npm run build -w @hagel/app          # une fois
node infra/scripts/local_staging.mjs  # http://localhost:3100, base en mémoire, données fictives, MAIL_MODE=off, sans Azure ni bucket
```

Super-admin : `nicolas.rasteiro@pdr-team.de` (même mot de passe). Autres comptes : `de.chef@`, `de.assessor@`, `de.tech@` (et `es.`) `staging.test`, mot de passe `staging-local-test-1` (ou `STAGING_TEST_PASSWORD`). Tout disparaît à l'arrêt.

## 4. Contrôle d'intégrité

```bash
DATABASE_URL=<url> npm run integrity -- --out avant.json      # rapport + sauvegarde des chiffres
# ... migration / déploiement ...
DATABASE_URL=<url> npm run integrity -- --compare avant.json  # "IDENTICAL" attendu (code retour 1 sinon)
```

Lecture seule (uniquement des `SELECT`). Donne : véhicules par organisation / station / statut (supprimés ou non), photos, partages, scans par statut, utilisateurs, rôles, audit, somme des netto par organisation recalculée avec `packages/calc`, et une empreinte (`netDigest`) de tous les montants véhicule par véhicule. Les tables créées par les nouvelles migrations sont listées à part (`added`) et ne sont pas comparées.

## 5. Mise en production (décision de Nicolas, une fois le staging validé)

### 5.1 Validation du staging
Chiffres d'intégrité identiques ; 1–2 utilisateurs de terrain ont travaillé 2–3 jours sur téléphone et bureau ; scans Azure reçus ; PDF corrects (DE et ES) ; e-mails uniquement redirigés ; ancienne PWA testée contre le serveur staging.

### 5.2 Avant la fusion
1. Prévenir les utilisateurs : fenêtre de 10 minutes le soir, être en ligne pour que les opérations hors ligne partent.
2. **Sauvegarde manuelle de la production** : `pg_dump -Fc` vers `backups/pre-v3-AAAAMMJJ.dump` **et** un snapshot Railway ; vérifier en restaurant dans la base staging puis `npm run integrity`.
3. Noter l'ID de déploiement / commit de production actuel (`7b5e9ed` ou plus récent) pour le retour arrière.

### 5.3 Fusion et déploiement
PR `feature/ui-v3` → `main` (liste des migrations 0010+, variables, checklist). **Seul Nicolas fusionne.** Poser d'abord les variables en prod (`APP_ENV=production`, `MAIL_MODE=live`, `UI_V3_DEFAULT`). Railway déploie, les migrations passent au démarrage. `npm run integrity -- --compare` contre la prod, puis test rapide (connexion, liste, un véhicule, PDF KVA, tableau).

### 5.4 Retour arrière
* **Problème d'interface** : `UI_V3_DEFAULT=false` ou `?ui=legacy`. Pas de redéploiement.
* **Problème serveur** : « Redeploy » du déploiement précédent. Les migrations sont additives, l'ancien code tourne sur le nouveau schéma. Les clients v3 gardent leurs nouvelles opérations en file (un serveur qui ne les connaît pas répond `409 unsupported_op`, un ancien serveur répond 400 sur les lots v3 : le client les garde aussi).
* **Corruption de données** (dernier recours) : restaurer le dump `pre-v3` dans une **nouvelle** base et changer `DATABASE_URL` ; les écritures faites après la sauvegarde sont perdues → décision de Nicolas uniquement.
