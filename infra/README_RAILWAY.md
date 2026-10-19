# Déploiement sur Railway (phase 2)

> État : **préparé mais pas encore déployé** — le déploiement demande ton compte Railway, ton dépôt GitHub et ton domaine. Les étapes ci-dessous sont à faire une fois (≈ 30 min).

## Architecture

| Service Railway | Rôle | Commande de démarrage |
|---|---|---|
| `api` | API + PWA (même domaine, pas de CORS) | `npm run start` (défaut du Dockerfile) |
| `worker` | Jobs de fond (sauvegarde nocturne ; plus tard sync Azure, e-mails de rapports) | `npm run worker` |
| `Postgres` | Base de données (plugin Railway, région **EU West**) | – |
| `Bucket` | Stockage S3 (sauvegardes ; plus tard photos et PDF) | – |

Le même `Dockerfile` sert les deux services ; seul le *Start Command* du `worker` change.

## 1. Première mise en place

1. Pousser le dépôt sur GitHub (jamais de secrets dedans : `.env` est dans `.gitignore`).
2. Railway → **New Project → Deploy from GitHub repo**. Région **EU West (Amsterdam)**.
3. **+ New → Database → PostgreSQL** (Railway Postgres). Activer les **backups Railway** du volume.
4. **+ New → Bucket** (ou un bucket Cloudflare R2). Noter endpoint, nom, clé d'accès, clé secrète.
5. Service `api` : variables (voir ci-dessous), **Settings → Networking → Generate Domain**, puis le domaine propre quand il sera décidé.
6. Dupliquer le service pour créer `worker` (même dépôt) et changer **Start Command** en `npm run worker`. Il n'a pas besoin de domaine public.
7. Premier démarrage : les migrations s'exécutent automatiquement au boot (`createDb` applique le dossier `server/migrations`). Avec `SEED_SUPERADMIN_EMAIL` défini, l'organisation, les rôles par défaut et le super-admin sont créés (idempotent). Ensuite : ouvrir l'URL → saisir ton e-mail → lien magique.

## 2. Variables d'environnement

| Variable | Service | Remarque |
|---|---|---|
| `DATABASE_URL` | api, worker | Référence : `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | api | ≥ 32 caractères aléatoires (`openssl rand -base64 48`). **Obligatoire en production** (le serveur refuse de démarrer sinon). |
| `APP_URL` | api | URL publique sans `/` final, ex. `https://hagel.pdr-team.de` — utilisée dans les liens des e-mails |
| `EMAIL_API_KEY`, `EMAIL_FROM` | api | Resend. Sans clé, les e-mails sont seulement écrits dans les logs (utile pour un premier test, **à ne pas laisser en production**). Le domaine d'envoi doit être vérifié chez Resend (SPF/DKIM). |
| `SEED_SUPERADMIN_EMAIL` | api | `nicolas.rasteiro@pdr-team.de` (peut être retiré après le premier démarrage) |
| `SEED_TEST_SITES` | api | `1` seulement pour tester ; crée 2 sites d'exemple en ES |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | worker | Sauvegardes. Plus tard aussi `api` (photos). |
| `BACKUP_ON_START` | worker | `1` pour lancer une sauvegarde immédiate (test) |
| `ANTHROPIC_API_KEY`, `AZURE_STORAGE_*` | api / worker | Phases 3 et 5 — pas encore utilisées |

Health check : `GET /api/health` (déjà configuré dans `railway.json`).

## 3. Sauvegardes

* **Railway Postgres** : backups du volume (à activer dans l'onglet du service Postgres).
* **`pg_dump` nocturne** : le `worker` écrit chaque nuit à 02:30 UTC `backups/hagel-AAAAMMJJ-HHMM.dump` (format custom) dans le bucket et supprime les dumps de plus de 30 jours. Logs : `[backup] done …` ou `[backup] FAILED …`.
* Test immédiat : mettre `BACKUP_ON_START=1` sur le worker, redéployer, vérifier le fichier dans le bucket, retirer la variable.

### Restauration (à répéter une fois sur une base vide avant la mise en production)

```bash
# 1. télécharger le dump depuis le bucket (aws cli compatible S3 / R2)
aws s3 cp s3://<bucket>/backups/hagel-20261019-0230.dump ./restore.dump --endpoint-url <S3_ENDPOINT>

# 2. restaurer dans une base VIDE (nouvelle base Railway ou locale) — jamais directement sur la production sans l'avoir testé ailleurs
pg_restore --no-owner --clean --if-exists --dbname "<DATABASE_URL de la base cible>" ./restore.dump

# 3. vérifier
psql "<DATABASE_URL>" -c "select count(*) from users; select count(*) from audit_log;"
```

Puis pointer `DATABASE_URL` de l'`api` sur la base restaurée et redéployer.

> **Pas encore testé** : ni le déploiement Railway, ni le dump/restore sur un vrai Postgres, ni l'envoi réel via Resend (aucun de ces comptes n'est accessible depuis ce poste, et Docker Desktop n'était pas démarré). Les tests automatiques tournent sur PGlite (vrai Postgres en WebAssembly) ; le pilote `pg` de production n'est exercé qu'au premier démarrage sur Railway.

## 4. Développement local

```bash
npm install
npm test                       # calc + colibri + permissions + API (PGlite, sans Docker)
npm run build -w @hagel/app    # compile la PWA
cd server && SEED_SUPERADMIN_EMAIL=toi@pdr-team.de npm run start   # base en mémoire si pas de DATABASE_URL ; le lien de connexion s'affiche dans la console
```
