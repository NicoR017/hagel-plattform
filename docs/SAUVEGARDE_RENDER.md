# Sauvegarde et restauration (production sur Render)

## Ce qui est sauvegardé
- **Base de données** : chaque nuit à **02:30 UTC** (03:30 / 04:30 en Espagne et en Allemagne selon la saison), le service `hagel-worker` fait un `pg_dump` complet de `hagel-db` et l'écrit sur son disque `hagel-backups` (5 Go, monté sur `/backups`) sous le nom `hagel-AAAAMMJJ-HHMM.dump`.
- Chaque sauvegarde est **vérifiée** avant d'être gardée : taille minimale et lecture de l'archive (`pg_restore --list`). Un fichier est écrit sous un nom temporaire puis renommé : un fichier à moitié écrit ne ressemble jamais à une sauvegarde.
- **Rétention** : 30 jours (variable `BACKUP_KEEP_DAYS`), mais les 3 plus récentes restent toujours, même plus anciennes.
- En cas d'échec, la ligne `[backup] FAILED ...` apparaît dans les logs du worker (Render → hagel-worker → Logs). Une ligne `[backup] done {...}` apparaît quand tout va bien.
- **Photos et PDF** : sur le disque `hagel-files` du service `hagel-api` (`/data/files`). Ils ne sont **pas** inclus dans le `pg_dump` : voir « Fichiers » ci-dessous.

## Aller chercher une sauvegarde
```bash
ssh srv-dbd4dc29lscs73e6pi40@ssh.frankfurt.render.com 'ls -l /backups'
ssh srv-dbd4dc29lscs73e6pi40@ssh.frankfurt.render.com 'base64 -w0 /backups/hagel-AAAAMMJJ-HHMM.dump' | base64 -d > hagel.dump
```
(la clé SSH publique doit être enregistrée dans Render : Account Settings → SSH Public Keys.)

## Restaurer
1. Ouvrir l'accès de la base à son adresse IP : Render → hagel-db → Access Control (ou `PATCH /v1/postgres/<id>` avec `ipAllowList`). **La refermer ensuite.**
2. Restaurer dans une base **vide** (idéalement une nouvelle base ou le staging pour vérifier d'abord) :
   `pg_restore --no-owner --no-acl --clean --if-exists -d "<External Database URL>" hagel.dump`
   (script prêt : `infra/scripts/render_restore.ps1 -Dump <fichier> -DbId <id> -ExpectName <nom de la base>`, qui refuse toute autre base que celle nommée).
3. Redéployer `hagel-api` : les migrations manquantes passent au démarrage.
4. Contrôler : `infra/scripts/render_integrity.ps1` (avant/après), puis ouvrir l'app.

## Fichiers (photos, PDF Colibri, logos)
Le disque `hagel-files` est une volume propre à Render : le sauvegarder ailleurs de temps en temps :
```bash
ssh srv-dbd4db3rjlhs73d3mtig@ssh.frankfurt.render.com 'tar czf - -C /data/files .' > fichiers-AAAAMMJJ.tar.gz
```

## Les sauvegardes propres à Render
Les bases Render payantes ont aussi leurs sauvegardes gérées (Render → hagel-db → Recovery / Backups) : à vérifier dans le tableau de bord pour votre formule. Elles complètent, sans la remplacer, la sauvegarde nocturne ci-dessus (qui reste sous votre contrôle et vérifiable).

## Limites à connaître
- La sauvegarde nocturne est sur le **même compte Render** (autre service, autre disque) : elle protège d'une erreur de manipulation ou d'une corruption, pas de la perte du compte. Pour cela, une copie périodique hors de Render (poste, SharePoint) est recommandée : voir la commande « Aller chercher une sauvegarde ».
- Les dossiers `/backups` et `/data` ne sont pas copiés entre l'environnement staging et la production.
