# Rebuild v2: PDR Hail Calculation Platform ("Hagel-Kalk"), multi-tenant, on Railway

> This file replaces nothing: the original `PROMPT.md` stays as the reference. This v2 prompt keeps **every feature and every calculation rule of the original** (sections 5 and 6 below are carried over from it) and changes the architecture, the account and role system, and adds carrosseries/insurers, the Azure Colibri import, platforms and a dashboard. When this file and the original disagree, **this file wins**. When this file and `reference/index_v20.html` disagree on a v20 behaviour detail, the v20 code wins unless this file explicitly changes it.

You are rebuilding an existing, production-used mobile PWA for hail-damage (PDR, paintless dent repair) estimation as a proper multi-user, multi-organisation platform. The current app works, but it is one 217 KB `index.html` with all data stored only on each phone. The new version must keep **every existing feature and every calculation result**, and add a central server, accounts and configurable roles, carrosserie/insurer management, automatic import of Colibri scans from Azure, platform (location) management and a dashboard.

**People**
- **Nicolas** is the developer and the platform **super-admin**. He drives the build. Report to him in **French**, explain technical decisions briefly, ask before irreversible choices.
- **Luca** and the field team (assessors, technicians) are the business users who test each phase on their phones.
- UI language: **German** (with the i18n file ready for Spanish UI later). Customer documents: **German or Spanish** depending on the vehicle's country. Never mix languages inside a document.
- Never lose data.

**Terminology (important).** Carrosserie (FR), taller (ES), Werkstatt (DE), station (EN) and "plateforme" all mean **the same thing**: a physical **site** where vehicles are kept and repaired. In this document it is called a **site**; in code `station`; in the UI **"Werkstatt"** (DE), **"Taller"** (ES), **"Carrosserie"** (FR), **"Station"** (EN) via i18n. A site has a `type`:
- `carrosserie`: a body shop. It is **also the customer**: it hands over cars, earns a commission, receives reports, works with several insurers, and corresponds to a Colibri **BusinessCustomer** in Azure.
- `hall` / `parc`: a PDR Team hall or a logistics yard. Has a capacity but no commission and no reports.
Each vehicle has two site references: **`station_id` = where it is now** and **`client_station_id` = the carrosserie that handed it over (the customer)**. The customer never changes when the vehicle is moved.

## 0. Material in this folder (read first)

| Path | What it is |
|---|---|
| `PROMPT.md` | Original rebuild prompt (v1). Kept for reference; superseded by this file. |
| `reference/index_v20.html` | Complete current app (v20). **Source of truth for behaviour** (see rule above). |
| `reference/sw.js`, `reference/manifest.webmanifest` | Current service worker and manifest |
| `data/bvat_aw_table_2025.json` | German BVAT 2025 AW table (Teiler 10 and 12, horizontal and vertical panels) |
| `data/es_matrix.json` | Spain matrix (A–G, hour knots, kickback, adjustments) |
| `data/panels.json` | The 14 body panels: keys, German and Spanish labels, orientation |
| `data/colibri_vocabulary.json` | Multilingual word lists for the Colibri scan-report parser |
| `fixtures/golden_cases_v20.json` | 22 anonymised real cases with exact expected results from v20. **The new calculation engine must match these to the cent.** |
| `assets/` | PDR Team logo (JPEG, 1000×276), app icons |

Ask Nicolas for real Colibri PDF samples (DE and ES) to build parser fixtures.

## 1. Business context

- Companies: PDR Team GmbH (Germany), PDR Team Spain, and possibly other organisations later (the platform is **multi-organisation**). Hail campaigns in Germany and Spain.
- **The main customer is the carrosserie (site of type `carrosserie`).** It hands over the cars and receives the reports (estimate/KVA and repair report). It earns a **commission**. A carrosserie works with **several insurers** (Allianz, Caser, Mutua, Württembergische …). Depending on the insurer, reports must also be sent to the insurer.
- Vehicles are scanned with a **Colibri hail scanner**. Every scan is stored by the Colibri system in **Azure** (table + PDF report + overview photos). The new platform imports scans directly from Azure, so the assessor no longer has to fetch PDFs or retake overview photos.
- Vehicles sit on **sites** (mostly carrosseries, sometimes a PDR Team hall or a logistics yard). Sites have a limited number of places. Vehicles can be moved between sites; the customer (original carrosserie) stays the same.
- Several assessors and technicians work **at the same time on different phones**, often offline in halls. Insurers also want **photos during repair**.
- Two calculation systems:
  - **DE: BVAT 2025** (AW-based, 83 €/h by default, Teiler 10 or 12, 19 % MwSt)
  - **ES: PDR Team matrix** (bollo-based hours, 69 €/h by default, 21 % IVA)
- Customer documents (KVA / Presupuesto) must never show internal splits (technician pay, carrosserie commission, PDR margin).

## 2. Target architecture (Railway)

All services run on **Railway** (Nicolas already hosts three sites there), region **EU West**.

- **Frontend:** Vite + React + TypeScript, installable PWA (vite-plugin-pwa), mobile-first (max width ~480 px for field screens; the dashboard and admin screens use the full desktop width). Offline-first local store with **Dexie (IndexedDB)**.
- **Backend:** **Node.js + TypeScript**, **Hono** (or Fastify), **PostgreSQL** (Railway Postgres), **Drizzle ORM** with versioned migrations, **Zod** validation on every endpoint. The API also serves the built PWA (single domain, no CORS).
- **File storage:** S3-compatible bucket (Railway Bucket or Cloudflare R2): photos, Colibri PDFs, generated PDFs, letterhead logos. Files are served through short-lived signed URLs, never public.
- **Background jobs:** a worker service (same codebase, separate Railway service) for the Azure sync (every 2–5 min), photo processing, report e-mails, nightly backups.
- **E-mail:** HTTP e-mail API (Resend or Brevo; no raw SMTP). Used for magic links, invitations, and sending reports.
- **Secrets:** only in Railway environment variables: `DATABASE_URL`, `S3_*`, `AZURE_STORAGE_*` (read-only SAS or Entra ID app), `ANTHROPIC_API_KEY`, `EMAIL_API_KEY`, `APP_URL`, `SESSION_SECRET`. Never in the repo, never on phones.
- **OCR proxy:** `/api/ocr` proxies the Claude vision call for plate/FIN recognition (users never paste API keys again). Requires login; rate-limited per user.
- **Calculation engine:** pure TypeScript package `/packages/calc` with no DOM, used by app **and** server, unit-tested with Vitest against `fixtures/golden_cases_v20.json`.
- **Colibri parser:** pure TypeScript package `/packages/colibri` (v20 algorithm, see §5.3), runs in the browser (manual import) and in Node (Azure import). Same code, same tests.
- **PDF generation:** client-side with pdf-lib so it works offline (KVA, Fotobericht). Colibri PDF merge also with pdf-lib.
- **Repo layout (monorepo, pnpm workspaces):** `/app` (PWA), `/server` (API + worker), `/packages/calc`, `/packages/colibri`, `/packages/shared` (types, Zod schemas, permission catalogue, i18n keys), `/infra` (Railway config, backup script, `README_RAILWAY.md`).

### 2.1 Sync (local-first, permission-aware)
- All writes go to Dexie immediately and into an **outbox queue**; the queue is pushed (`POST /sync/push`) when online. Pull with a cursor (`GET /sync/pull?since=…`). A Server-Sent-Events (or WebSocket) channel notifies clients that new changes exist.
- **The server only sends what the user may see**: records outside the user's scope are never sent; restricted fields (prices, internal split, other people's shares) are **removed server-side** before sending. A phone must never hold data the user has no right to see.
- On push, the server re-checks every permission and rejects (with a clear message in the UI) what is not allowed.
- **Conflicts:** each vehicle has `updatedAt` + `updatedBy`. Last-writer-wins **per field group** (header, panels, shares, status, site). Photos are append-only, so they never conflict. Show "zuletzt geändert von X um HH:MM".
- Sync status always visible: synced · n pending · offline. Photos upload in the background with retry.
- If a user loses access to a vehicle (moved to another site, role changed), it is removed from the phone at the next pull, **after** any pending local changes for it were pushed or reported.

## 3. Organisations, accounts, roles and permissions

### 3.1 Organisations and super-admin
- **Multi-organisation:** every business table has `org_id`; data is strictly separated. A user can belong to several organisations (switcher in the header).
- Nicolas is **super-admin** (`is_superadmin`): sees and manages everything across organisations, cannot be deactivated or demoted from the UI. Each organisation can have its own admins.

### 3.2 Accounts
- **Login by e-mail with magic link.** An admin **invites** someone (e-mail, organisation, role, site pre-filled) → the person receives a link (valid 48 h, single use, stored as a hash) → clicks it, enters their name and creates their account → lands directly on what they may see.
- Long-lived sessions on phones (field work offline): rotating refresh token (e.g. 90 days), revocable by admins ("alle Sitzungen abmelden").
- No shared devices, no quick user switch.
- **Deactivate instead of delete** (history stays). Admins can resend invitations, deactivate, reactivate.
- **Audit log** of who changed what (before/after) for vehicles, prices, shares, roles, users, sites.

### 3.3 Permission model: role × site × scope
- **Permissions** are a fixed catalogue defined in `/packages/shared` (code), e.g.:
  `vehicules.voir · creer · modifier · supprimer · assigner · deplacer · changer_statut` · `prix.voir` · `repartition_interne.voir` · `ma_part.voir` (technician sees only own share) · `ma_commission.voir` (carrosserie sees only its commission) · `commission.modifier` · `kva.envoyer` · `rapport_reparation.envoyer` · `photos.ajouter · supprimer` · `colibri.importer` · `export.excel` · `assurances.gerer` · `campagnes.gerer` · `stations.gerer` · `parametres.gerer` · `utilisateurs.gerer` · `roles.gerer` · `audit.voir` · `dashboard.voir`
- **Roles** are bundles of permissions **created and edited by admins in the UI**, plus a **scope**:
  - `assigne`: only vehicles the user is assigned to (vehicle_assignments)
  - `station`: all vehicles currently on the site
  - `campagne`: vehicles of one campaign (freelancers, with expiry date)
  - `client`: vehicles whose customer is this carrosserie (`client_station_id`), **wherever they are now** (external carrosserie account)
  - `assurance`: vehicles of one insurer (external insurer account)
- **A user gets one role per site** (`role_assignments`: user, org, site or NULL = all sites, role, optional scope client/insurer/campaign, optional `expires_at`). Example: chief at Talavera, assessor at Madrid.
- **Resolution for every request:** current site of the vehicle (or its customer site for scope `client`) → user's role on that site → permission → scope check → field filtering. Implement this once, server-side, in a single tested module (`can(user, action, vehicle)` + `filterFields(user, vehicle)`), and reuse it for API reads, sync pull, sync push, exports and PDFs. Write exhaustive unit tests for it.
- **Default roles** (seeded, editable): Admin d'organisation · Chef de site (Werkstattleiter) · Aufnehmer/Expert · Technicien (scope `assigne`, `ma_part.voir`, no prices) · Freelance (scope `campagne`, expiry) · Carrosserie (scope `client`, sees its vehicles, progress, photos, KVA and `ma_commission.voir`) · Assureur (scope `assurance`, sees everything about its files: KVA with prices, photos of all phases, Colibri PDF; **no internal split**, see open decisions).
- The UI hides what a user cannot do, but security relies only on the server.

### 3.4 Admin screens
Users (invite, role per site, deactivate, sessions), roles (permission checklist + scope), sites (carrosseries, halls, yards), insurers, campaigns, technicians, letterheads, settings (rates, ES matrix, delay thresholds), audit log.

## 4. Data model (PostgreSQL)

Keep the field names of the v20 JSON for vehicles so migration is trivial. All tables have `id` (uuid), `org_id` where relevant, `created_at`, `updated_at`, `created_by`, `updated_by`.

```
organizations         id, name, country
users                 id, email, name, language, status (invited|active|disabled), is_superadmin
memberships           user_id, org_id
invitations           id, org_id, email, role_id, station_id, token_hash, expires_at, used_at
sessions              id, user_id, refresh_hash, device, expires_at, revoked_at
roles                 id, org_id, name, description, scope, permissions[], is_system
role_assignments      user_id, org_id, station_id (NULL = all), role_id,
                      scope_client_station_id, scope_insurer_id, scope_campaign_id, expires_at
stations              SITE = carrosserie / taller / Werkstatt / station ("Werkstatt" in the DE UI)
                      id, org_id, type (carrosserie|hall|parc), name, address, country, capacite,
                      azure_tenant (required), azure_location_aliases[],
                      -- carrosserie only:
                      azure_business_customer_id, report_emails[],
                      commission_mode (pct|staffel), commission_pct
org_tenants           org_id, azure_tenant              -- tenants an organisation may use (super-admin)
azure_tenants         mirror of Azure table Tenants (name = PartitionKey = RowKey)
insurers              id, org_id, name, report_emails[], send_reports (bool),
                      reports_to_send (kva|reparation|both), azure_insurance_id
station_insurers      station_id (carrosserie), insurer_id, azure_link_id,
                      azure_link_names[] (history of link names)
technicians           id, org_id, user_id (nullable, external without account), name,
                      default_pct_pdr, default_pct_demontage
campaigns             id, org_id, name, country, start, end
campaign_stations     campaign_id, station_id
companies             letterheads: name, logo, address, tax id, e-mail, footer text
vehicles              v20 fields (see below) + org_id,
                      station_id (current site), client_station_id (customer carrosserie, never
                      changed by a move), campaign_id, insurer_id,
                      claim_number, statut, statut_motif, statut_depuis, colibri_scan_id (unique),
                      company_id, updated_by
vehicle_assignments   vehicle_id, user_id/technician_id, type (pdr|demontage)
vehicle_status_history vehicle_id, statut, motif, user_id, at
vehicle_moves         vehicle_id, from_station_id, to_station_id, user_id, at, note
photos                vehicle_id, file_key, label, phase (besichtigung|reparatur|fertig),
                      source (app|colibri), colibri_position, colibri_index, in_pdf (bool),
                      taken_at, taken_by, sort
report_sends          vehicle_id, type (kva|reparation), channel (server|share), recipients[],
                      sent_by, sent_at, status, error
colibri_scans         mirror of Azure AllScanResults rows (see §8) + import_status, vehicle_id
azure_business_customers, azure_insurances, azure_bc_insurance_links   (mirrors, read-only)
settings              per org: DE rate (83), ES rate (69), default Teiler, default shares,
                      ES matrix (editable table), delay thresholds per status
audit_log             org_id, user_id, action, entity, entity_id, before, after, at
```

**Vehicle fields (from v20):** land (`DE`|`ES`), kennzeichen, fin, modell, kunde snapshot (name, e-mail), leistungsdatum, teiler, stundensatz, notiz, zustand[] (Trocken, Nass, Sauber, Schmutzig, Gut, Mangelhaft, Ungenügend; ES output: Seco, Mojado, Limpio, Sucio, Bueno, Deficiente, Insuficiente), greifzone, hohlraum, verbringung, demontage, demontageEur, glass {ws:{on,eur}, rs:{on,eur}}, **panels** (JSONB), repAt, techName, techPct, demTechName, demTechPct, werkPct, werkMode (`pct`|`staffel`), colibri (import meta: method, kunde, sprache, at, imported, reportTotal, rowSum, unknown[]), colibriFile (file key).

**Panel object:** `{key, dents:{"10":n,"20":n,…,"80":n}, big (dents >85 mm), bigEur (DE manual amount), alu, kleber, method: "sanft"|"ptp"|"erneuern", finish (DE), awManual, baseAW}`.

Every price constant lives in `settings` or in `/packages/calc` config, never scattered in UI code.

## 5. Features to keep (complete inventory of v20) + v2 changes

### 5.1 Vehicle list (home: "Schnellkalkulationen")
- **Status filter** replaces the v20 folders: Angekommen · Besichtigung · Wartet · Reparatur · Fertig · Zurückgegeben (see §10), each with its count. Plus filters: current site, customer carrosserie, campaign, carrosserie, insurer.
- Search by FIN, plate, customer, technician name, claim number. Day filter: all days, today, or each date with vehicles.
- Summary bar: number of vehicles, total net, average net (amounts only with `prix.voir`).
- Card per vehicle: date, carrosserie / insurer, plate, model or FIN, current site, status, technician, net price (green when above 0, only with `prix.voir`), "656 Bollos · Kat. G · 21,8 h" or "582,24 AW", panel count, Colibri check badge (Scan ✓ or Scan prüfen ⚠), delete with confirmation (also deletes photos and scan; permission `vehicules.supprimer`).
- **Multi-select mode:** select all or none, change status (sets repAt when entering Reparatur), **move to another site**, set shares for the selection (bulk technician, %, De-/Re technician, %), assign technicians, and Excel export of the selection only.
- **Bulk Colibri import** from local PDFs (kept as fallback): pick several PDFs, one vehicle per report, then a result list (✓ / ⚠ count mismatch / ✗ not recognised, with unknown component names).
- **"Scans verfügbar"** (new, §8): list of Azure scans of the user's sites not yet imported; import one or all.
- FAB "+" creates a new vehicle (defaults: current site, customer = current site if it is a carrosserie else last customer, last country, today, current rates, technician default shares, zustand Trocken + Sauber, last letterhead, status Angekommen).
- **Excel export (.xlsx):** Sheet 1 "Fahrzeuge" with columns Datum, Plattform, Status, Kennzeichen, Modell, FIN, Kunde (Carrosserie), Versicherung, Schadennummer, Land, Dellen, Bollos, Kat., Stunden, €/h, Preis netto, MwSt/IVA, Brutto, Werkstatt %, Werkstatt €, Techniker Dellen, Techniker %, Techniker €, De-/Remontage €, Techniker De-/Re, De-/Re %, De-/Re Techniker €, Scheiben €, Bleibt PDR €, Scan, Notiz, plus a sum row, frozen header and autofilter. Sheet 2 "Abrechnung je Techniker": Techniker, Fahrzeuge, Dellen-€, De-/Remontagen, De-/Re-€, Gesamt auszahlen. File name "Tagesliste_<Filter>_<Datum>.xlsx". Columns the user may not see are omitted.

### 5.2 Vehicle screen: 4 tabs (ⓘ Basis · 🚗 Erfassung · 🖼 Bilder (badge count) · 📄 KVA)

**ⓘ Basis**
- **Customer carrosserie** (`client_station_id`), **current site** (with "Verschieben" button), **status** (with motif when Wartet), **insurer** (chosen among those linked to the customer carrosserie), **claim number**, campaign.
- **Country switch:** 🇩🇪 Deutschland · BVAT / 🇪🇸 España · IVA 21 %. Switching sets the country default rate.
- **Letterhead choice** (see §7).
- **Colibri scan import** for this vehicle (local PDF). Shows the result ("Übernommen aus Colibri · METHOD", 📎 scan PDF attached when mailing).
- **Plate** with 📷 photo recognition. **FIN** with 📷 photo recognition: max 17 characters, hint "A–Z, 0–9, außer I, O, Q".
- Model, Leistungsdatum.
- **Teiler** 10 or 12 (DE only). Hourly rate, with "= x € pro AW" shown for DE. The rate is remembered per country for new vehicles.
- **Condition chips** (multi-select).
- **DE-only toggles:** Über Greifzone / Höhe ab 1,60 m · Hohlraumkonservierung (+15 € Material) · Verbringungskosten.
- **De-/Remontage toggle with amount** (default 150 €). ES has quick buttons M1 · 100 €, M2 · 150 €, M3 · 200 €.
- Notes / spare parts. "Weiter zur Erfassung →".

**🚗 Erfassung**
- **Exploded top-view car SVG** with 14 tappable panels: Haube, Dach, Dachholm li/re, Heckklappe, Heckklappe unten, Kotflügel v. li/re, Tür vorn li/re, Tür hinten li/re, Seitenwand li/re. Panels with dents turn green and show "count/avg class".
- **Glass:** windscreen and rear window are tappable. "Scheibe erneuern" on/off plus € amount, which becomes a separate KVA line (third-party service).
- ES summary box: "656 Bollos → Kat. G, € 1.794,00", the breakdown "390 bis 30 mm + 133 über 30 mm × 2", the formula line, each adjustment line with ± hours and ± €, and an internal one-liner (technician €, De/Re, workshop, PDR), only with `repartition_interne.voir`.
- Total bar (net €, panel count, dents, average size). Panel cards list: AW and € for DE, bollos for ES, plus badges Alu / Kleber / PTP −40% / Erneuern and >85 mm count.
- **Panel dialog:**
  - Header and stats: DE shows price, AW, hours; ES shows bollos. Both show dents, average size and class, plus the BVAT base AW for DE.
  - 8 size classes (10–80 mm) with −/+ and number input. **Dents >85 mm** (special position): count, plus a manual € amount in DE; in ES they count as 2 bollos.
  - Toggles: Aluminium (DE +25 % · ES +1 h per vehicle), Klebetechnik +30 % (both countries).
  - **Repair method, 3 options:** Sanft instand setzen / Vordrücken z. Lack. (PTP −40 %) / Erneuern (ES: −1 h). Each option shows an explanation text.
  - Finish toggle (DE). Manual base-AW override (DE; `awManual`/`baseAW`). Buttons: Entfernen, Speichern.
- Technicians without `prix.voir` see dents and panels but no amounts.

**🖼 Bilder**
- 📷 Kamera / ⬆ Galerie (multi). Images are downscaled to 1280 px JPEG q0.6. Delete per image (permission).
- Label per photo: Vorderansicht, Heckansicht, Seite links, Seite rechts, Dach, Detail / Delle, Sonstiges. Spanish output: Vista frontal, Vista trasera, Lateral izquierdo, Lateral derecho, Techo, Detalle / abolladura, Otros.
- **Phase per photo** (Besichtigung / Durante la reparación / Después de la reparación) with timestamp and user. Photos taken while the vehicle is in status Reparatur default to phase "reparatur", in Fertig to "fertig". Group by phase in the UI.
- **Colibri overview photos** (§8.4) appear automatically with a "Colibri" badge and their exact position.
- **Checklist of required views** (Vorderansicht, Heckansicht, Seite links, Seite rechts, Dach): views already covered by Colibri photos are ticked; the assessor only adds missing views and details.
- Per photo: "im PDF" toggle. Default: one photo per label (the first one) + all app photos.

**📄 KVA (Kostenvoranschlag / Presupuesto)**
- DE layout: customer bar (carrosserie; insurer and claim number if set); plate, FIN, model, date and condition; green box "Reine Dellentechnik: x AW = €". Table with Bauteil (+Alu, +Kleber, (Vordrücken zur Lackierung), (Erneuern)) and a sub-line of size breakdown "3×10 · 8×20 …", columns Dellen, Ø mm, AW, EUR. Then Summe Dellentechnik, Sonderposition >85 mm, Finish, Rüstzeit, Greifzone, Hohlraum, Verbringung, GESAMT; AW-Leistung netto, Sonderposition, Material (Kleber/Hohlraum), De-/Remontage, glass, Netto, 19 % MwSt, Brutto; notes; photos.
- ES layout: entirely in Spanish. Table with Pieza (+Adhesivo, (Desabollado previo a pintura (Push to Paint)), (Sustituir)), columns Abolladuras, Ø mm, Bollos; TOTAL "(390 + 133 × 2)"; note "Bollos: hasta 30 mm = 1, más de 30 mm = 2. Categoría G (> 600 bollos), tope 30,0 h = € 2.070,00", the formula line, lines from `esLines` (Reparación PDR · categoría … h × €/h; each adjustment; Desmontaje y montaje; glass), Base imponible, más 21 % IVA, Total con IVA.
- **Internal split box** (never in the KVA; only with `repartition_interne.voir`): technician PDR (name chips plus free text, % chips 40/45/50/55/60 plus free %, base = net − glass − De/Re); De-/Remontage technician (blank = same as PDR; % chips 50/70/80/100); carrosserie commission (from the carrosserie record, **read-only on the vehicle**, see §6.4); "Bleibt PDR Team: € · %".
  - **Technician share:** default from the technician record, copied to the vehicle when assigned, **editable per vehicle** (`commission.modifier`, audited). Changing a technician's default later does not change existing vehicles.
  - **Carrosserie commission:** fixed on the customer carrosserie site (pct or ES Staffel), **snapshotted** on the vehicle at calculation time so past settlements never change.
  - A technician with `ma_part.voir` sees only his own amount; a carrosserie with `ma_commission.voir` sees only its commission.
- Actions:
  - ✉️ **Senden** (new default): the server e-mails the PDF (KVA + Colibri scan PDF appended) to the computed recipients: the carrosserie always, plus the insurer if `send_reports` and the insurer's `reports_to_send` includes this report type. Subject and body in DE or ES. Recorded in `report_sends`. Offline: queued and sent when online.
  - ✉️ **Über Handy teilen** (fallback, v20 behaviour): share sheet with subject and body, copies the e-mail to the clipboard with a toast; fallback download + `mailto:`.
  - 📄 **PDF speichern / teilen**.
  - Status buttons (e.g. 🔧 In Reparatur / zurück).
  - 📋 **Als Text kopieren** (plain-text KVA in DE or ES).
- PDF details: A4; logo top right (or none); dark title bar "Kostenvoranschlag" / "Presupuesto" with date; header data; green summary box; table with zebra rows and size-breakdown sub-lines; a red sub-line "Vordrücken zur Lackierung − 40 %" / "Desabollado previo a pintura (Push to Paint) − 40 %" under PTP panels; totals; notes; a photo page in a 2-column grid with labels (photos with `in_pdf`). File name "Kostenvoranschlag_<plate>_<date>.pdf" / "Presupuesto_…".
- **"Fotobericht Reparatur" PDF** for carrosseries and insurers: vehicle header plus photos grouped by phase, with date and time captions, in ES or DE, with the chosen letterhead. Sent with the same recipient rules (report type `reparacion`).

### 5.3 Colibri scan-report reading (keep the v20 algorithm exactly; see `reference/index_v20.html`, `colibriPages` / `parseColibri` / `colibriKey` / `applyColibri`)
- Reads the original Colibri PDF (not photos): inflates content streams (DecompressionStream deflate / deflate-raw; in Node use zlib) and extracts `1 0 0 1 x y Tm <hex> Tj` text with coordinates.
- Header values (plate, FIN, date, brand, model, customer, calculation method, language) come from the item directly below each label at the same x, using multilingual label lists.
- Report total comes from "All: 503 Ø: 30mm"-style text. Size columns come from "10mm … 80mm, 100mm", plus the total column.
- Each table row maps a component name to a panel key with multilingual word lists (DE/EN/ES/FR/IT/PT/NL): side, front/rear, upper/lower; door + rear → tuer_h*, fender + rear/quarter → sw_h*, spar → dachholm_*, trunk + lower → heck_u. The 100 mm column becomes `big`.
- Apply rules: overwrite plate, FIN, model (Title Case brand + model) and date. Panels get the imported dents; keep existing alu, bigEur, method and finish. **Dachholm panels automatically get kleber = true.**
- Verification: imported count vs report total, plus unknown rows, gives the "Scan ✓" or "Scan prüfen ⚠" badge and an alert. The original PDF is stored as `colibriFile`.
- **No other report formats** are added (e.g. reports with coin-size columns Dime/Nickel/Quarter/HalfDollar simply end as "Scan prüfen ⚠", as in v20). Do **not** read the `.sr9` scan-result files.
- Package it as `/packages/colibri` with fixtures from real PDFs (ask Nicolas).

### 5.4 Photo recognition (plate / FIN)
- Primary: Claude vision via the server proxy `/api/ocr`. Prompts are in the reference (`aiPrompt`): DE and ES plate formats; FIN exactly 17 characters with no I/O/Q; returns JSON `{wert, sicher, hinweis}`; then FIN cleanup O→0, Q→0, I→1.
- Fallback (offline): Tesseract.js OCR with the `findVIN` / `findPlate` regexes.
- Dialog: take or choose a photo → recognised value is editable → confidence note → "Übernehmen".

### 5.5 Sites (carrosseries) and insurers
- Replaces the v20 customer list: the customer of a vehicle is always a **carrosserie site**. Picker with search, recently used first, limited to sites of the user's organisation and tenant(s).
- Site record (UI "Werkstatt"): type, name, address, country, capacity, tenant (required at creation), location aliases; for type carrosserie: Azure BusinessCustomer, report e-mails, commission (pct or Staffel), linked insurers.
- Insurer record: name, report e-mails, "Berichte erhalten" on/off, which reports (KVA / Reparatur / both).
- BusinessCustomer/insurer names and their links come from Azure (§8.3) and are read-only; business fields are edited in the app. Sites and insurers not in Azure can be created manually.
- Migration: v20 customers are matched to existing carrosserie sites or created as carrosserie sites (admin review list).

### 5.6 Settings, backup, PWA
- Settings per organisation: default rates DE and ES, Teiler, "x € pro AW", ES matrix (admin-editable table), delay thresholds per status, technicians, letterheads.
- Keep **JSON export/import** compatible with the old format (`{app:"hes-hagel", version, created, vehicles[], customers[], settings{}, images{id: dataURL}, scans{vehicleId:{name,b64}}}`), for migration and as an offline safety net (export limited to what the user may see).
- PWA: network-first for index.html, cache-first for assets, auto-update with a "App aktualisiert auf vX – alle Daten sind erhalten" toast. Reload only when on the list screen with no open dialog. Request `navigator.storage.persist()`.

## 6. Calculation rules (must match v20 exactly; verify with golden cases)

### 6.1 Common
- Dent size classes are 10, 20, 30, 40, 50, 60, 70, 80 mm. Per panel: total = Σn, avgX = Σ(size·n)/total, avgClass = clamp(ceil(avgX/10)·10, 10, 80).
- Net = calculation + De-/Remontage + glass amounts. Gross = net × (1 + VAT), with VAT 19 % for DE and 21 % for ES.

### 6.2 DE: BVAT 2025
- Base AW = lookup(teiler, orientation, total, avgClass) from `bvat_aw_table_2025.json`, using linear interpolation between count keys and `Math.round`. A manual override is used if `awManual`.
- Panel AW = base × 1.25 (alu) × 1.30 (kleber) × 0.60 (ptp). Erneuern gives 0. Round to 0.01.
- Finish = finishPer × number of panels with finish, not erneuern and dents > 0, capped at finishCap.
- Teiler 10: Rüstzeit 6, Greifzone 9, finishPer 2.5, finishCap 13, Hohlraum 4, Verbringung 15. Teiler 12: 7, 11, 3.5, 16, 5, 18.
- Rüstzeit applies when there is at least one panel.
- € per AW = rate / teiler. AW-Netto = total AW × € per AW.
- Kleber material: 0 panels = 0 €, 1–2 = 10 €, 3–5 = 15 €, more = 20 €. Hohlraum material 15 €. Big dents (>85 mm) are added at their manual amounts.

### 6.3 ES: PDR Team matrix
- Bollos per panel: dents ≤30 mm count 1; >30 mm (40–80, plus big) count 2. Vehicle bollos = Σ.
- Base hours H: ≤25 bollos = 6 h. Between knots (25,6), (50,9), (100,15), (200,20), (400,23), (600,25), (1000,30) interpolate linearly and **round up to 0.5 h**. ≥1000 bollos = 30 h.
- Category by bollos: A 1–25 (cap 6 h), B 26–50 (9), C 51–100 (15), D 101–200 (20), E 201–400 (23), F 401–600 (25), G 601+ (30).
- Adjustments, in hours, applied in this order:
  1. **Erneuern:** −1 h per panel ("Capó sustituido" for the hood, otherwise "Pieza sustituida / a pintura: …"). The panel's dents still count toward bollos.
  2. **Klebetechnik:** +0.30 × H × panelBollos / totalBollos, rounded to 0.01 h ("Técnica de adhesivo (+30 %): …"). Not applied to erneuern panels.
  3. **PTP:** −0.40 × H × panelBollos / totalBollos × (1.30 if kleber), rounded to 0.01 h ("Desabollado previo a pintura (Push to Paint, −40 %): …").
  4. **Aluminium:** +1 h once per vehicle if any alu panel is not erneuern.
- Total hours = max(0, H + Σadj). Net = total hours × rate + De/Re + glass.
- Kickback (customer carrosserie "Staffel"), based on H: ≤9 h → 60 €, ≤20 h → 120 €, <30 h → 240 €, otherwise 320 €.
- Make the matrix data-driven (admin-editable table in settings). See open decisions (A–G vs A–F).

### 6.4 Internal split (shares)
- Basis = net − glass. PDR basis = basis − De/Re.
- Carrosserie € = basis × commission % (mode pct) or the kickback (mode staffel, ES only). Mode and % come from the customer carrosserie site (`client_station_id`), snapshotted on the vehicle.
- Technician € = PDR basis × technician %. De/Re technician € = De/Re € × De/Re %.
- Remaining PDR = basis − carrosserie − technician − De/Re technician.

## 7. Letterheads and campaigns
- **Companies / letterheads (Briefkopf):** replaces the v20 "logo: PDR Team / none" switch. Table of issuing companies (name, logo, address, tax ID, e-mail, footer text). Seed "PDR Team GmbH" (with logo) and "Neutral (ohne Logo)". Each vehicle chooses one; default = the user's last choice. With "Neutral", the PDF shows no logo and no "PDR Team" anywhere (the ES box title becomes just "Matriz").
- **Campaigns / Einsätze:** group vehicles by campaign (e.g. "Talavera Allianz Okt 2026") with country, dates, sites. Filter in the list and dashboard. Freelancer access can be limited to a campaign.

## 8. Automatic Colibri import from Azure

The Colibri system (owned by the Colibri team, Nicolas is part of it) stores every scan in Azure. **Nothing may be changed on the Colibri side** (release cycle ~3 weeks): the platform adapts to what exists. Access is **read-only**, server-side only (SAS limited to the tables and containers below, or an Entra ID app with Reader roles).

### 8.1 Sources (storage account `storagecolibri`)
- Table **`AllScanResults`**: one row per scan. Useful columns: PartitionKey (date+time of the scan, also the key for photos), RowKey, Tenant, Location (free text), ColibriNumber, BusinessCustomer (**name of the carrosserie–insurer link**), ClaimNumber, ScanDateTime, LicensePlate, VIN, CarBrand, CarModel, CarBuildYear, Country, Language, CalculationMethod, DentsTotalNumber, ScanFailed, ErrorMessage, urlPdf, urlScanResult (ignored).
- Table **`Tenants`**: list of Colibri tenants; **PartitionKey = RowKey = tenant name** (the same value as `AllScanResults.Tenant`).
- Tables **`BusinessCustomers`**, **`Insurance`**, **`BusinessCustomersInsurance`**: rule: **the ID is always the RowKey (GUID); the name is in the text field** (`BusinessCustomer`, `Insurance`, `BusinessCustomerInsurance`). The link table also holds `BusinessCustomerId` and `InsuranceId`.
- Container **`allscans`**: PDF reports (`urlPdf`).
- Container **`scan-color-pictures`**: overview photos (§8.4).

### 8.2 Sync job (worker, every 2–5 min)
- Incremental read of `AllScanResults` by PartitionKey range (since last cursor) → mirror table `colibri_scans`. Skip `ScanFailed`.
- Full refresh (small tables) of Tenants, BusinessCustomers, Insurance, BusinessCustomersInsurance → mirror tables.
- **Tenant isolation (hard rule):**
  - The super-admin decides which tenants each organisation may use (`org_tenants`).
  - **When a site is created, the admin chooses the tenant it belongs to** (`stations.azure_tenant`, required, dropdown fed by the `Tenants` mirror, limited to the organisation's tenants). A site belongs to exactly one tenant.
  - A carrosserie site is also linked to its Azure **BusinessCustomer** (`azure_business_customer_id`), chosen among the BusinessCustomers when creating/editing the site.
  - A scan is visible to a site only if **`scan.Tenant = site.azure_tenant`** and the scan points to that site (via its BusinessCustomer link, see §8.3, or via `Location` aliases for halls/yards). A scan of another tenant can never be shown, imported or mapped, even if names are identical.
  - Location (free text) → site via `stations.azure_location_aliases`, only among sites of the scan's tenant; unknown values are mapped once by an admin; until then the scan is "nicht zugeordnet" and visible only to admins of an organisation that owns this tenant.
  - Enforce this in the permission module and in SQL (`WHERE tenant = …`), with tests.
- Idempotent, logged, with a status page for admins (last run, errors, unmapped values).

### 8.3 Customer carrosserie and insurer mapping
- Scan `BusinessCustomer` (normalised: trim, case, spaces) → row of `BusinessCustomersInsurance` by its `BusinessCustomerInsurance` name → `BusinessCustomerId` + `InsuranceId`.
- `BusinessCustomerId` → the carrosserie site with that `azure_business_customer_id` **and the same tenant as the scan** → vehicle `client_station_id` (customer) and, by default, `station_id` (current site; overridden by the Location alias if it points to a hall/yard of the same tenant).
- `InsuranceId` → vehicle `insurer_id`.
- Not found (no site linked to that BusinessCustomer, or tenant mismatch) → "zuzuordnen"/"prüfen"; the admin links it once (or creates the site), the mapping is remembered.
- Store the **Azure IDs** on our records and keep the history of link names, so a rename in Azure does not break older scans.
- Azure is master for BusinessCustomer/insurer names and their links (`station_insurers` is synced from BusinessCustomersInsurance); the app adds the business fields (capacity, commission, report e-mails, send rules).
- Pickers on a site only show insurers linked to its carrosserie, and only sites of the same tenant.

### 8.4 Colibri photos
- Blob names: `<PartitionKey>_Overview_Pictures_<Position>-<n>` (n = index; several photos per angle are possible). List with **prefix = PartitionKey** of the scan.
- Position enum (accept the name or the numeric value): FRONT_UPPER_RIGHT = 0, FRONT_BOTTOM_RIGHT, RIGHT, BACK_UPPER_RIGHT, BACK_BOTTOM_RIGHT, BACK_UPPER_LEFT, BACK_BOTTOM_LEFT, LEFT, FRONT_UPPER_LEFT, FRONT_BOTTOM_LEFT, FRONT, TOP_FRONT, TOP_BACK; plus EXTRA_LEFT and EXTRA_RIGHT.
- Label mapping: FRONT* → Vorderansicht / Vista frontal; BACK* → Heckansicht / Vista trasera; LEFT, EXTRA_LEFT → Seite links / Lateral izquierdo; RIGHT, EXTRA_RIGHT → Seite rechts / Lateral derecho; TOP_* → Dach / Techo; unknown → Sonstiges / Otros. Keep `colibri_position` and `colibri_index`.
- On import: copy into our bucket (1280 px JPEG q0.6 + key of the original), phase `besichtigung`, source `colibri`, taken_at = ScanDateTime. `in_pdf` = true only for index 0 of each label.

### 8.5 "Scans verfügbar" screen
- Lists not-yet-imported scans of the user's sites (permission `colibri.importer`), i.e. only scans with the **site's tenant** that point to the site: date/time, plate, model, carrosserie/insurer, Colibri number, mapping warnings.
- Import one or several: server downloads the PDF → `/packages/colibri` (v20 algorithm) → creates the vehicle (country from the site/organisation default, status `besichtigung`, current site, customer carrosserie, carrosserie, insurer, claim number, campaign if one is active for that site) → attaches the PDF and photos → marks the scan imported (`colibri_scan_id` unique, no duplicates).
- Report check: parsed total vs report total (v20) and vs `DentsTotalNumber` → Scan ✓ / Scan prüfen ⚠.
- Local PDF import (single and bulk, v20) stays available as fallback.

## 9. Sites and vehicle moves
- **Site = carrosserie = taller = Werkstatt = station** (one concept, UI "Werkstatt"): type (carrosserie|hall|parc), name, address, country, **capacity (number of places)**, **tenant (chosen at creation, required)**, Colibri location aliases; for carrosseries also BusinessCustomer link, report e-mails, commission and linked insurers.
- **Occupancy** = vehicles physically present (`station_id`) = all statuses except `rendu`. Indicator `present / capacity`: green < 80 %, orange ≥ 80 %, red when full, red flashing when over capacity.
- Moving or importing into a full site shows a **warning, not a block**; the action stays possible and is audited.
- **Move:** direct change of `station_id` from the vehicle or in multi-select (permission `vehicules.deplacer` on the source site; destination = sites of the same organisation; warning if the destination has another tenant). History in `vehicle_moves` (from, to, who, when, note).
- **The customer does not change:** `client_station_id`, the carrosserie commission and the report recipients stay with the carrosserie that handed over the car. The external account of that carrosserie still sees the car on its new site.
- The vehicle immediately enters the scope of the new site for internal users. Technician assignments are kept but flagged when the technician has no role on the new site, so its chief can reassign.

## 10. Vehicle lifecycle (statuses)

| Status | DE | ES | Meaning |
|---|---|---|---|
| `arrive` | Angekommen | Recibido | on the site, not yet assessed |
| `besichtigung` | Besichtigung | Peritación | assessment / KVA in progress or sent |
| `attente` | Wartet | En espera | blocked; **reason required**: Teile, Freigabe Versicherung/Kunde, Demontage, Sonstiges (text) |
| `reparatur` | Reparatur | En reparación | repair in progress (sets repAt) |
| `fertig` | Fertig | Terminado | repaired, still on the site |
| `rendu` | Zurückgegeben | Entregado | left the site, file closed (not counted in occupancy) |

- `attente` can be set from any status; leaving it returns to the previous status or a chosen one.
- Every change goes to `vehicle_status_history` (status, reason, who, when) → basis for durations.
- Colibri import → `besichtigung`; manual creation → `arrive`. Migration: v20 besichtigung → besichtigung, reparatur → reparatur.

## 11. Dashboard
Desktop-first screen, also usable on a phone. Permission `dashboard.voir`; data limited to the user's scope; amounts only with `prix.voir`; internal split only with `repartition_interne.voir`. Filters: organisation, site(s), campaign, carrosserie, insurer, period.
1. **Sites:** one card per site with occupancy bar (`present / capacity`, colour), count per status, arrivals and departures today.
2. **Durations and delays:** average time arrival → returned, average repair time; list of **delayed vehicles** (same status for more than N days; thresholds per status set by the admin, e.g. Wartet > 3 d, Reparatur > 5 d); vehicles in Wartet grouped by reason.
3. **Technicians:** per technician: assigned vehicles, in progress, finished in the period, sites.
4. **Revenue:** net per current site, per customer carrosserie, per insurer, per period; with internal-split permission: technician shares, carrosserie commissions, remaining PDR.
- Every number is clickable → filtered vehicle list.

## 12. Migration (critical: zero data loss)
1. Each phone first makes a JSON backup in the old app (Einstellungen → Sichern), and `reference/index_v20.html` stays deployed until migration is done.
2. The new app has **"Alte Sicherung importieren"** (admin): reads the old JSON, creates vehicles, photos (from base64), customers (→ carrosserie sites) and Colibri scans on the server in the chosen organisation and platform, de-duplicates by vehicle `id` (same vehicle on two phones: the newer `updatedAt`/`createdAt` wins, and a list of duplicates is shown), and reports counts.
3. Verify after import: number of vehicles, photos and the sum of net prices are the same as in the old app.

## 13. Infra deliverables (`/infra`)
- Railway setup documented in `README_RAILWAY.md`: services (api+web, worker), Postgres, bucket, environment variables, custom domain, deploy from GitHub, migrations on deploy (`drizzle-kit migrate` before start), health check endpoint.
- Backups: Railway Postgres backups **plus** a nightly `pg_dump` to the bucket (kept 30 days) and a documented restore procedure (tested once).
- Seed script: organisation(s), super-admin Nicolas, default roles, letterheads, settings (rates, ES matrix), test sites.
- Monitoring: structured logs, error tracking (e.g. Sentry, optional), sync job status page.
- Never commit secrets.

## 14. Quality bar
- TypeScript strict everywhere. Shared Zod schemas between app and server.
- Unit tests: `/packages/calc` (all 22 golden cases plus edge cases: 0, 25, 26, 1000 and >1000 bollos, Teiler 12, manual AW); `/packages/colibri` (real PDF fixtures); **permission module** (every role × scope × action, field filtering, cross-organisation isolation).
- Integration tests on the API with a test Postgres (invitation flow, sync pull/push with restricted fields, vehicle move changes visibility).
- Playwright e2e: login by magic link (test mailbox) → create vehicle → panel → KVA PDF; Azure import with mocked Azure; offline create → online sync; technician cannot see prices (also not in the network responses).
- Texts in one i18n file (DE UI, DE and ES documents). Do not mix languages inside a document.
- Accessibility: large touch targets (≥44 px), one-handed use, high contrast for sunlight.

## 15. Work plan (stop after each phase, report to Nicolas in French, wait for OK)
1. **Calc engine + Colibri parser packages** with golden and fixture tests. Must be 22/22 green.
2. **Backend foundation on Railway:** monorepo, Postgres schema + migrations, magic-link auth, organisations, users, invitations, roles, permission module (with tests), admin screens for users/roles/sites. Deployed to Railway with backups.
3. **PWA with full v20 feature parity** on top of the API, offline-first sync respecting permissions, photo phases, old-backup import. Test with 2 users with different roles and 2 sites.
4. **Carrosserie sites as customers, insurers, commissions, report sending** (server e-mail + share fallback), Fotobericht Reparatur, letterheads, campaigns, technicians.
5. **Azure Colibri import:** sync job, mapping screens, "Scans verfügbar", photos.
6. **Sites (capacity), moves, statuses and dashboard.**
7. **Migration day:** everyone imports their backup, counts are verified, the old app is retired.

## 16. Open decisions (ask Nicolas before the phase that needs them)
- Spain matrix A–G (app, max 2,070 €) or A–F (insurer presentation, max 1,656 €)? (phase 1, keep data-driven anyway)
- In ES, should the Klebetechnik material lump sum (10/15/20 €) also apply? (currently: no)
- After account creation: always log in by magic link, or allow a password as well? (default: magic link + long-lived sessions)
- Insurer accounts: confirm that the internal split stays hidden (default: hidden).
- Domain / subdomain for the app.
- Exact format of the `AllScanResults` PartitionKey / RowKey and photo file extension (check on real data in phase 5).
- Which tenants belong to which organisation (`org_tenants`) for the existing Colibri tenants.
