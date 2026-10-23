# Intégration PDR Citas

PDR Citas est le second site où les clients réservent une expertise dans un **lieu**. Hagel y lit les rendez-vous (RDV) du jour de chaque station et permet de **démarrer une expertise** depuis un RDV, avec ou sans scan Colibri. **Citas n'est jamais modifié** : la liaison RDV ↔ véhicule n'existe que dans Hagel.

## Fonctionnement en bref
1. Un gestionnaire (droit `stations.gerer`) associe une station à un **lieu Citas** (Verwaltung → Stationen → modifier → « Lieu PDR Citas »). Tous les types de station sont possibles : les RDV ont lieu dans le hall où l'expertise est faite.
2. Sur la page de la station (écran avec Kalkulation / Reparatur / Alle Fahrzeuge), le bloc **« RDV du jour »** liste les RDV du lieu (flèches ‹ › pour la veille et le lendemain, bouton ↻).
3. Un clic ouvre **« Démarrer l'expertise depuis un RDV »** : rappel du RDV, puis les scans Colibri du jour de la station. Celui dont la plaque correspond est en tête et présélectionné.
4. « Démarrer avec ce scan » ou « Démarrer sans scan » crée l'expertise (statut `besichtigung`) et l'ouvre. Un second clic sur le même RDV **rouvre la même expertise**.

## Configuration (serveur uniquement)
| Variable | Rôle |
|---|---|
| `CITAS_API_URL` | adresse de base de Citas (ex. `https://citas.example`). L'adresse complète de l'API (`…/api/v1/external`) est acceptée aussi : le suffixe est retiré |
| `CITAS_API_KEY` | clé de l'API en lecture seule, envoyée en `Authorization: Bearer` |

- Si l'une manque : fonctionnalité **masquée**, aucune erreur (`/citas/status` → `configured:false`).
- La clé ne sort jamais du serveur : ni vers le navigateur, ni dans les logs, ni dans le journal d'audit, ni dans les messages d'erreur.
- Local : `CITAS_FAKE=1` (jamais en production) sert quelques RDV de démo (lieu « Nave demo Madrid ») ; déjà actif dans `infra/scripts/local_staging.mjs`.

## Contrat Citas utilisé (lecture seule)
`GET /api/v1/external/health`, `/locations`, `/appointments?date=YYYY-MM-DD&location=<id>`, `/appointments/:id`. Erreurs : 401, 503 `api_disabled`, 400, 404, 429. Timeout de 5 s côté Hagel.

## Points d'accès Hagel (proxy ; le navigateur n'appelle jamais Citas)
| Route | Droit | Rôle |
|---|---|---|
| `GET /api/citas/status` | `stations.gerer` | `{configured, ok, locations?, error?}` (health puis locations) |
| `GET /api/citas/locations` | `stations.gerer` | lieux Citas (menu du formulaire station) |
| `GET /api/citas/appointments?station_id=&date=` | `vehicules.voir` sur la station | RDV du jour (défaut : aujourd'hui dans le fuseau du lieu), cache 60 s par lieu et jour (`&refresh=1` le saute), `502 citas_unreachable` si Citas est en panne |
| `POST /api/citas/appointments/:id/start` | `vehicules.creer` sur la station (+ `colibri.importer` avec un scan) | démarre l'expertise |

Chaque RDV renvoyé est enrichi de `vehicleId`/`vehicleStatut` (expertise déjà démarrée), `insurerId` (assurance Hagel retrouvée par nom) et `matchingScans` (scans du jour de la station avec la même plaque).

### Correspondances
- **Plaques** : majuscules, lettres et chiffres seulement (« 9547 lpv » = « 9547-LPV »).
- **Assurances** : majuscules, sans accents, espaces, tirets ni ponctuation. Un « ñ » compte aussi comme « NI » (« Mutua Madrileña » = « MUTUA-MADRILENIA »). Pas de correspondance → `insurerId: null`.

### Démarrage (`start`)
1. Relit le RDV chez Citas **sans cache** ; refuse s'il est `cancelled` ou s'il n'appartient pas au lieu de la station.
2. **Idempotent** : si un lien existe vers un véhicule non supprimé → `status: "already"` et le même `vehicleId`. Si le véhicule a été supprimé, le RDV peut redémarrer. Deux clics simultanés ne créent qu'une expertise.
3. **Avec scan** : réutilise l'import Colibri existant (PDF, photos, panneaux), en imposant la station. Les données du scan l'emportent ; le RDV ne complète que les champs vides (plaque, VIN, modèle, n° de sinistre, nom/téléphone/e-mail du client, assurance si le scan n'en a pas donné).
4. **Sans scan** : crée le véhicule en `besichtigung` avec les données du RDV, par le même chemin que la synchronisation (mêmes contrôles de droits).
5. Écrit le lien (`citas_links`) et une entrée d'audit `citas.start`. Réponse : `{status: "imported"|"created"|"already", vehicleId}`.

**Choix de conception (offline-first)** : tout est fait côté serveur, puis le client lance `syncNow`. Le lien RDV ↔ véhicule est ainsi atomique et idempotent. Contrepartie : démarrer depuis un RDV demande une connexion (le bloc l'indique : « Disponible en ligne uniquement »).

## Données
- Migration `0015_citas.sql`, **additive** : colonne `stations.citas_location_id` (null = non liée) et table `citas_links` (`org_id`, `appointment_id` unique par organisation, `location_id`, `vehicle_id`, `station_id`, `created_by`, `created_at`). Aucune donnée existante n'est modifiée ; elle s'applique au démarrage de l'API.
- Nouveaux champs d'en-tête véhicule : `kundeName`, `kundeTel` (le nom et le téléphone du client du RDV ; `kunde` reste le nom de la carrosserie cliente). Aucun écran ne les affiche encore.
- Supprimer une station supprime ses liens Citas.

## Exploitation
- **Contrôler la connexion** : Verwaltung → Colibri / Azure → carte « PDR Citas » → « Verbindung testen ».
- Messages : « Der Schlüssel wird abgelehnt » (401 : clé fausse ou révoquée), « Die Schnittstelle ist bei Citas ausgeschaltet » (503), « Citas antwortet nicht » (réseau, timeout ou erreur serveur).
- Si Citas est en panne, seul le bloc affiche un message ; le reste de l'application n'est pas touché.
- Retour arrière : retirer `CITAS_API_URL` ou `CITAS_API_KEY` masque tout. La colonne et la table restent sans effet.

## Tests
`server/test/citas.test.ts` (configuration absente, client HTTP, proxy, cache, permissions, normalisations, démarrage avec/sans scan, idempotence, RDV annulé) et `app/test/citas.test.ts` (route, jours, plaques). Fake : `server/src/citas_fake.ts`.

---

# Checklist de test manuel (preprod)

Prérequis : `CITAS_API_URL` / `CITAS_API_KEY` posées sur la preprod ; compte gestionnaire ; au moins un lieu actif côté Citas.

**A. Connexion**
- [ ] Verwaltung → Colibri / Azure : la carte « PDR Citas » affiche « Verbunden : N Standorte ».
- [ ] « Verbindung testen » répond de nouveau OK.
- [ ] Sans variables (ou avec une mauvaise clé) : message clair, le reste de l'admin fonctionne.

**B. Lier une station**
- [ ] Verwaltung → Stationen → modifier une **halle** : le menu « Lieu PDR Citas » liste les lieux ; choisir le lieu de test, enregistrer.
- [ ] Rouvrir le formulaire : le lieu est conservé. Choisir « — aucun — » puis enregistrer : le bloc disparaît de la station.
- [ ] Un utilisateur sans droit `stations.gerer` ne voit pas ce menu.

**C. Voir les RDV**
- [ ] Prendre un RDV de test sur Citas (lieu lié, aujourd'hui, plaque et assurance connues, n° de sinistre).
- [ ] Page de la station : le bloc affiche le RDV (heure, plaque, marque/modèle, client, assurance, badge « À venir »).
- [ ] ‹ et › montrent la veille et le lendemain ; ↻ recharge ; « aucun RDV » est affiché pour un jour vide.
- [ ] Demander l'annulation du RDV côté Citas, puis ↻ : badge « Annulation demandée » (orange). Un RDV annulé disparaît.
- [ ] Avec un scan Colibri du jour de la station et la même plaque : pastille « Scan trouvé ».
- [ ] Une station non liée, ou un utilisateur sans accès à la station : pas de bloc / accès refusé.

**D. Démarrer sans scan**
- [ ] Clic sur le RDV → écran « Démarrer l'expertise » : récapitulatif correct.
- [ ] « Démarrer sans scan » : l'expertise s'ouvre (Basis) avec plaque, modèle, n° de sinistre, assurance et station du RDV ; statut Besichtigung.
- [ ] Retour à la station : le RDV porte le badge vert « Expertise démarrée » ; un clic rouvre **la même** expertise.
- [ ] Double-clic rapide sur le bouton : une seule expertise.

**E. Démarrer avec scan**
- [ ] Un second RDV + un scan Colibri du jour : le scan de même plaque est en tête et présélectionné.
- [ ] « Démarrer avec ce scan » : expertise avec panneaux, photos et PDF du scan ; les champs vides sont complétés par le RDV (nom, téléphone, e-mail) ; plaque et n° de sinistre du scan conservés.
- [ ] Choisir un scan d'une autre plaque : confirmation avant de démarrer.
- [ ] Case « Alle Scans zeigen » : les scans d'autres stations et d'autres jours apparaissent.
- [ ] Le scan utilisé n'apparaît plus dans la liste des nouveaux scans.

**F. Cas limites**
- [ ] Annuler un RDV côté Citas **après** l'affichage de la liste, puis cliquer « Démarrer » : refus (RDV annulé).
- [ ] Supprimer l'expertise créée : le RDV peut être démarré de nouveau.
- [ ] Couper le réseau de l'appareil : le bloc indique « Disponible en ligne uniquement ».
- [ ] Éteindre l'API Citas (ou fausse clé) : message court dans le bloc, le reste de la page marche.
- [ ] Tablette et téléphone : zones tactiles confortables, pas de défilement horizontal.
- [ ] Langues DE / FR / ES : textes du bloc, de l'écran de démarrage et de l'admin traduits.
