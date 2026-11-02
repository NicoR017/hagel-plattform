# E-mails via Microsoft Graph

L'api envoie ses e-mails (lien de connexion, invitations, reçus client, rapports, fiche hebdo) depuis la boîte partagée `noreplay-spain@pdr-team.com` avec `POST /users/{boîte}/sendMail` (flux *client credentials*). Seul le service **api** envoie des e-mails ; le worker n'a pas de mailer.

## Choix du fournisseur (variables seules)
| Variables présentes | Fournisseur |
|---|---|
| `GRAPH_TENANT_ID` + `GRAPH_CLIENT_ID` + `GRAPH_CLIENT_SECRET` (+ `EMAIL_FROM`) | Microsoft Graph |
| sinon `EMAIL_API_KEY` | Resend (comportement historique) |
| sinon | console (log) |

Une configuration partielle (1 ou 2 des `GRAPH_*`, ou `GRAPH_*` sans `EMAIL_FROM`) fait refuser le démarrage. `MAIL_MODE` (`off` / `redirect` / `live`) s'applique toujours par-dessus.

## 1. Côté Microsoft (à faire par l'IT)
1. **Entra ID → App registrations** : une application (ex. « PDR Hagel Mail »). Noter *Directory (tenant) ID* et *Application (client) ID*.
2. **API permissions → Microsoft Graph → Application permissions → `Mail.Send`**, puis **Grant admin consent**.
3. **Restreindre l'application à la seule boîte `noreplay-spain@pdr-team.com`** (sans cela `Mail.Send` permet d'écrire au nom de *toutes* les boîtes du tenant) : *Application Access Policy* (Exchange Online : `New-ApplicationAccessPolicy -AccessRight RestrictAccess -AppId <client id> -PolicyScopeGroupId <groupe contenant seulement la boîte> …`) ou *RBAC for Applications*. Vérifier ensuite avec `Test-ApplicationAccessPolicy` : la boîte est autorisée, une autre boîte est refusée.
4. **Certificates & secrets → New client secret** : **un secret par environnement** (un pour staging, un pour prod, sur la même application), expiration ≤ 24 mois. **Noter la date d'expiration ici : staging ____ / prod ____** et prévoir le renouvellement avant ; un secret expiré = échec d'envoi (état « échec » + « Renvoyer » dans l'application).
5. La boîte partagée garde les mails dans « Éléments envoyés » (`saveToSentItems`).

## 2. Où saisir les valeurs dans Render
Jamais dans le dépôt. Soit `infra/scripts/render_set_mail.ps1` (lit `$env:GRAPH_*` ou demande les valeurs, le secret avec une saisie masquée, puis redéploie), soit le tableau de bord Render → service **api** → *Environment* : `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `EMAIL_FROM=noreplay-spain@pdr-team.com`.
- Staging : `.\infra\scripts\render_set_mail.ps1 -Api <srv-id hagel-staging-api>` (refuse tout autre service, force `MAIL_MODE=redirect` vers `nicolas.rasteiro@pdr-team.de`).
- Production : `.\infra\scripts\render_set_mail.ps1 -Api <srv-id api prod> -Production`, uniquement le soir (≥ 20:00 Madrid) et avec l'accord de Nicolas.

## 3. Tester
- `POST /api/admin/mail-test` (super-admin, authentifié) avec `{"withAttachment":"none|small|large","replyTo":"…"}` : envoie à l'adresse du super-admin appelant, via le mailer configuré (donc staging → `MAIL_REDIRECT_TO`) ; répond `{provider, ms, ok, error?}` ; une ligne d'audit `mail_test` par envoi. `large` ≈ 5 Mo (un PDF sans photos : teste le repli par lien signé ; le mail reçu doit contenir un lien, pas de pièce jointe).
- En local : `npm run mail:test -w @hagel/server -- --to <adresse> --attach large` avec les variables du shell (pas d'audit, pas de base).

## 4. Bascule et retour arrière
- Déployer le code en prod **sans** `GRAPH_*` = la prod reste sur Resend. Vérifier le log : `provider=resend`.
- **Bascule** : poser les `GRAPH_*` + `EMAIL_FROM` sur l'api prod, redéployer, vérifier `provider=graph`, `mail-test`, puis un vrai lien de connexion.
- **Retour arrière** : supprimer les trois `GRAPH_*` de l'api prod, redéployer. Resend reprend, sans revert de code.
- Ne pas retirer `EMAIL_API_KEY` de la prod tant que Graph n'a pas tourné plusieurs jours sans erreur.

## Limites techniques
**Permission : `Mail.Send` seul, rien d'autre** (pas de `Mail.ReadWrite`). L'application n'utilise que `POST /users/{boîte}/sendMail`, jamais de brouillon.

`sendMail` accepte ~4 Mo de JSON, et les pièces jointes partent en base64 (+33 %) : le total des pièces jointes est donc plafonné à **2,5 Mo** (`MAIL_INLINE_LIMIT`). Un mail plus lourd est traité avant l'envoi, sans que les appelants changent (`AttachmentFitMailer`, `server/src/mail_attachments.ts`) :
1. **Compression** : les photos JPEG incluses dans les PDF sont ré-encodées (1600 px q75, puis 1200 / 900 / 700 px), la mise en page, les textes et les signatures restent identiques. Le premier palier qui passe sous 2,5 Mo est utilisé. Le PDF complet reste intact dans le stockage de l'application.
2. **Lien signé** si la compression ne suffit pas (ou si le PDF est illisible) : la pièce jointe est copiée en privé (`mail-links/…`) et remplacée dans le texte par un lien `…/api/files/<jeton>` valable **14 jours** (jeton signé HMAC, sans connexion ; au-delà, le fichier est supprimé à la première visite). Quiconque a le lien peut télécharger le fichier jusqu'à l'expiration : ne pas le transférer.
3. `GraphMailer` refuse en dernier recours tout envoi au-dessus de la limite avec une erreur claire (aucun appel Graph).

Erreurs 429/503 : 3 essais en respectant `Retry-After` ; 401 : nouveau jeton une fois. Les messages d'erreur ne contiennent que le statut HTTP et le code Graph (ni secret, ni jeton, ni contenu). Resend n'est pas concerné (comportement inchangé).
