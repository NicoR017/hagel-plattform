# Rebuild: PDR Hail Calculation Platform ("Hagel-Kalk"), from scratch

You are rebuilding an existing, production-used mobile PWA for hail-damage (PDR, paintless dent repair) estimation as a proper multi-user platform. The current app works, but it is one 217 KB `index.html` with all data stored only on each phone. Every user sees only their own vehicles. The new version must keep **every existing feature and every calculation result**, and add a central server, users and roles, a cleaner codebase and better management.

The user (Luca) is not a programmer. Work autonomously, explain decisions in plain German, keep the UI in German (customer documents in German or Spanish), and never lose data.

## 0. Material in this folder (read first)

| Path | What it is |
|---|---|
| `reference/index_v20.html` | Complete current app (v20). **Source of truth for behaviour.** When this prompt and the code disagree on a detail, the code wins, unless this prompt explicitly says to change it. |
| `reference/sw.js`, `reference/manifest.webmanifest` | Current service worker and manifest |
| `data/bvat_aw_table_2025.json` | German BVAT 2025 AW table (Teiler 10 and 12, horizontal and vertical panels) |
| `data/es_matrix.json` | Spain matrix (A–G, hour knots, kickback, adjustments) |
| `data/panels.json` | The 14 body panels: keys, German and Spanish labels, orientation |
| `data/colibri_vocabulary.json` | Multilingual word lists for the Colibri scan-report parser |
| `fixtures/golden_cases_v20.json` | 22 anonymised real cases with exact expected results from v20. **The new calculation engine must match these to the cent.** |
| `assets/` | PDR Team logo (JPEG, 1000×276), app icons |

## 1. Business context

- Company: PDR Team GmbH (Germany) and PDR Team Spain. Hail campaigns in Germany and Spain, with work for insurers (e.g. Allianz, Caser, Mutua), body shops (talleres), fleets and logistics yards.
- On site, vehicles are scanned with a **Colibri hail scanner**, which produces a PDF report of dents per panel and size class. Then an assessor (Aufnehmer) creates a quick estimate (KVA / Presupuesto) on the phone, takes photos and sends a PDF to the customer or insurer.
- Several assessors (e.g. Luca, Jürgen in Spain, technicians) work **at the same time on different phones**, often offline in halls. The insurer also wants **photos during repair**. That is why all data has to be on one central system.
- Two calculation systems:
  - **DE: BVAT 2025** (AW-based, 83 €/h by default, Teiler 10 or 12, 19 % MwSt)
  - **ES: PDR Team matrix** (bollo-based hours, 69 €/h by default, 21 % IVA)
- The KVA must never show internal splits (technician pay, workshop kickback, PDR margin).

## 2. Target architecture

- **Frontend:** Vite + React + TypeScript, installable PWA (vite-plugin-pwa), mobile-first (max width ~480 px, also usable on desktop). Offline-first local store with **Dexie (IndexedDB)**.
- **Backend:** **PocketBase** (single binary: SQLite, file storage, auth, realtime) on an **IONOS VPS (Ubuntu 24.04, Germany)**, with **Caddy** in front (automatic HTTPS). Subdomain to be decided (e.g. `hagel.pdr-team.de`). Frontend static files are served from the same domain.
- **Sync:** Local-first. All writes go to Dexie immediately and are queued, and the queue is pushed to PocketBase when online. PocketBase realtime subscriptions pull changes from other users. Photos upload in the background with retry. Show a clear sync status: synced, n pending, offline.
- **Conflicts:** Each vehicle record has `updated` plus `updatedBy`. Use last-writer-wins per field group (header, panels, shares, status). Photos are append-only, so they never conflict. Show "zuletzt geändert von X um HH:MM" on the vehicle.
- **Calculation engine:** Pure TypeScript package `/packages/calc` with no DOM, used by the app and unit-tested with Vitest against `fixtures/golden_cases_v20.json`.
- **PDF:** Generated client-side (pdf-lib is fine) so it works offline. Colibri PDF merge also uses pdf-lib.
- **Repo layout:** `/app` (PWA), `/packages/calc`, `/server` (PocketBase migrations in JS, hooks, collection rules), `/infra` (install script, Caddyfile, systemd units, nightly backup script, README for the server admin "Nikolas").
- **Secrets:** The Anthropic API key moves **off the phones** into a server-side PocketBase hook, `/api/ocr`, that proxies the vision call. Users never paste API keys again.

## 3. Users, roles, companies

- Roles:
  - **admin**: everything, user management, prices and settings.
  - **assessor**: creates and edits vehicles, sees prices, sends KVAs.
  - **technician**: sees assigned vehicles, adds repair photos and dents. Sees **no prices and no internal splits** (confirm with Luca).
- **Companies / letterheads (Briefkopf):** Replaces the current "logo: PDR Team / none" switch. A table of issuing companies (name, logo, address, tax ID, e-mail, footer text). Seed it with "PDR Team GmbH" (with logo) and "Neutral (ohne Logo)". Each vehicle chooses one, and the default is the user's last choice. With "Neutral", the PDF shows no logo and no "PDR Team" anywhere (the ES box title becomes just "Matriz").
- **Campaigns / Einsätze** (new): Group vehicles by campaign (e.g. "Talavera Allianz Okt 2026"), with location, country and default customer. The vehicle list filters by campaign.
- Data scope: all users of the organisation see all campaigns (confirm). Audit log of who changed what.

## 4. Data model (PocketBase collections)

Keep the field names of the current JSON so migration is trivial:

- `vehicles`: id, campaign, land (`DE`|`ES`), kennzeichen, fin, modell, kunde (relation to customers plus a snapshot of name and e-mail), leistungsdatum, teiler, stundensatz, notiz, zustand[] (Trocken, Nass, Sauber, Schmutzig, Gut, Mangelhaft, Ungenügend; ES output: Seco, Mojado, Limpio, Sucio, Bueno, Deficiente, Insuficiente), greifzone, hohlraum, verbringung, demontage, demontageEur, glass {ws:{on,eur}, rs:{on,eur}}, **panels** (JSON, see below), status (`besichtigung`|`reparatur`|new: `fertig`), repAt, techName, techPct, demTechName, demTechPct, werkPct, werkMode (`pct`|`staffel`), company (letterhead), colibri (import meta: method, kunde, sprache, at, imported, reportTotal, rowSum, unknown[]), colibriFile (file field), createdBy, updatedBy, created, updated.
- Panel object: `{key, dents:{"10":n,"20":n,…,"80":n}, big (dents >85 mm), bigEur (DE manual amount), alu, kleber, method: "sanft"|"ptp"|"erneuern", finish (DE), awManual, baseAW}`.
- `photos`: vehicle, file (JPEG, client-downscaled to max 1280 px, quality 0.6), label, **phase** (`besichtigung` | `reparatur` | `fertig`), takenAt, takenBy, sort.
- `customers`: name, email, adresse, lastUsed. Seed "Allianz".
- `technicians`: name, default pct PDR, default pct De-/Remontage (replaces settings.techs / techPctBy).
- `companies`: letterheads as above.
- `settings` (org-wide): DE rate (83), ES rate (69), default Teiler, default shares. Every price constant lives here or in `/packages/calc` config, never scattered in UI code.

## 5. Features to keep (complete inventory of v20)

### 5.1 Vehicle list (home: "Schnellkalkulationen")
- **Folders:** 🔍 Besichtigung (n) and 🔧 Reparatur (n), plus new: ✅ Fertig.
- Search by FIN, plate, customer, technician name. Day filter: all days, today, or each date with vehicles.
- Summary bar: number of vehicles, total net, average net.
- Card per vehicle: date, customer, plate, model or FIN, technician, net price (green when above 0), "656 Bollos · Kat. G · 21,8 h" or "582,24 AW", panel count, Colibri check badge (Scan ✓ or Scan prüfen ⚠), delete with confirmation (also deletes photos and scan).
- **Multi-select mode:** select all or none, move selection to Reparatur and back (sets repAt), set shares for the selection (bulk technician, %, De-/Re technician, %, workshop % or Staffel), and Excel export of the selection only.
- **Bulk Colibri import:** pick several PDFs, one vehicle per report, then show a result list (✓ / ⚠ count mismatch / ✗ not recognised, with unknown component names).
- FAB "+" creates a new vehicle (defaults: last country, last customer or Allianz, today, current rates, default shares, zustand Trocken + Sauber, last letterhead).
- **Excel export (.xlsx):** Sheet 1 "Fahrzeuge" with columns Datum, Kennzeichen, Modell, FIN, Kunde, Land, Dellen, Bollos, Kat., Stunden, €/h, Preis netto, MwSt/IVA, Brutto, Werkstatt %, Werkstatt €, Techniker Dellen, Techniker %, Techniker €, De-/Remontage €, Techniker De-/Re, De-/Re %, De-/Re Techniker €, Scheiben €, Bleibt PDR €, Ordner, Scan, Notiz, plus a sum row, frozen header and autofilter. Sheet 2 "Abrechnung je Techniker": Techniker, Fahrzeuge, Dellen-€, De-/Remontagen, De-/Re-€, Gesamt auszahlen. File name "Tagesliste_<Ordner>_<Datum>.xlsx".

### 5.2 Vehicle screen: 4 tabs (ⓘ Basis · 🚗 Erfassung · 🖼 Bilder (badge count) · 📄 KVA)

**ⓘ Basis**
- **Country switch:** 🇩🇪 Deutschland · BVAT / 🇪🇸 España · IVA 21 %. Switching sets the country default rate.
- **Letterhead / logo choice** (see §3).
- **Colibri scan import** for this vehicle. Shows the result ("Übernommen aus Colibri · METHOD", 📎 scan PDF attached when mailing).
- **Plate** with 📷 photo recognition. **FIN** with 📷 photo recognition: max 17 characters, hint "A–Z, 0–9, außer I, O, Q".
- Model, customer picker, Leistungsdatum.
- **Teiler** 10 or 12 (DE only). Hourly rate, with "= x € pro AW" shown for DE. The rate is remembered per country for new vehicles.
- **Condition chips** (multi-select).
- **DE-only toggles:** Über Greifzone / Höhe ab 1,60 m · Hohlraumkonservierung (+15 € Material) · Verbringungskosten.
- **De-/Remontage toggle with amount** (default 150 €). ES has quick buttons M1 · 100 €, M2 · 150 €, M3 · 200 €.
- Notes / spare parts. "Weiter zur Erfassung →".

**🚗 Erfassung**
- **Exploded top-view car SVG** with 14 tappable panels: Haube, Dach, Dachholm li/re, Heckklappe, Heckklappe unten, Kotflügel v. li/re, Tür vorn li/re, Tür hinten li/re, Seitenwand li/re. Panels with dents turn green and show "count/avg class".
- **Glass:** windscreen and rear window are tappable. "Scheibe erneuern" on/off plus € amount, which becomes a separate KVA line (third-party service).
- ES summary box: "656 Bollos → Kat. G, € 1.794,00", the breakdown "390 bis 30 mm + 133 über 30 mm × 2", the formula line, each adjustment line with ± hours and ± €, and an internal one-liner (technician €, De/Re, workshop, PDR).
- Total bar (net €, panel count, dents, average size). Panel cards list: AW and € for DE, bollos for ES, plus badges Alu / Kleber / PTP −40% / Erneuern and >85 mm count.
- **Panel dialog:**
  - Header and stats: DE shows price, AW, hours; ES shows bollos. Both show dents, average size and class, plus the BVAT base AW for DE.
  - 8 size classes (10–80 mm) with −/+ and number input. **Dents >85 mm** (special position): count, plus a manual € amount in DE; in ES they count as 2 bollos.
  - Toggles: Aluminium (DE +25 % · ES +1 h per vehicle), Klebetechnik +30 % (both countries).
  - **Repair method, 3 options:** Sanft instand setzen / Vordrücken z. Lack. (PTP −40 %) / Erneuern (ES: −1 h). Each option shows an explanation text.
  - Finish toggle (DE). Manual base-AW override (DE; `awManual`/`baseAW`). Buttons: Entfernen, Speichern.

**🖼 Bilder**
- 📷 Kamera / ⬆ Galerie (multi). Images are downscaled to 1280 px JPEG q0.6. Delete per image.
- Label per photo: Vorderansicht, Heckansicht, Seite links, Seite rechts, Dach, Detail / Delle, Sonstiges. The Spanish output uses Vista frontal, Vista trasera, Lateral izquierdo, Lateral derecho, Techo, Detalle / abolladura, Otros.
- **NEW: phase per photo** (Besichtigung / Durante la reparación / Después de la reparación) with timestamp and user. Photos taken while the vehicle is in status Reparatur default to phase "reparatur". Group by phase in the UI.

**📄 KVA (Kostenvoranschlag / Presupuesto)**
- DE layout: customer bar; plate, FIN, model, date and condition; green box "Reine Dellentechnik: x AW = €". Table with Bauteil (+Alu, +Kleber, (Vordrücken zur Lackierung), (Erneuern)) and a sub-line of size breakdown "3×10 · 8×20 …", columns Dellen, Ø mm, AW, EUR. Then Summe Dellentechnik, Sonderposition >85 mm, Finish, Rüstzeit, Greifzone, Hohlraum, Verbringung, GESAMT; AW-Leistung netto, Sonderposition, Material (Kleber/Hohlraum), De-/Remontage, glass, Netto, 19 % MwSt, Brutto; notes; photos.
- ES layout: entirely in Spanish. Table with Pieza (+Adhesivo, (Desabollado previo a pintura (Push to Paint)), (Sustituir)), columns Abolladuras, Ø mm, Bollos; TOTAL "(390 + 133 × 2)"; note "Bollos: hasta 30 mm = 1, más de 30 mm = 2. Categoría G (> 600 bollos), tope 30,0 h = € 2.070,00", the formula line, lines from `esLines` (Reparación PDR · categoría … h × €/h; each adjustment; Desmontaje y montaje; glass), Base imponible, más 21 % IVA, Total con IVA.
- **Internal split box** (never in the KVA): technician PDR (name chips plus free text, % chips 40/45/50/55/60 plus free %, base = net − glass − De/Re); De-/Remontage technician (blank = same as PDR; % chips 50/70/80/100); workshop share (% chips 0/10/15/20/25 or "Staffel €" = ES kickback); "Bleibt PDR Team: € · %". Technician defaults are remembered per name.
- Actions:
  - ✉️ **Per E-Mail senden**: one PDF (KVA plus the Colibri scan PDF appended via pdf-lib). Opens the share sheet with subject and body in DE or ES, and copies the customer e-mail to the clipboard with a toast. Fallback: download plus `mailto:`.
  - 📄 **PDF speichern / teilen**.
  - 🔧 **In Reparatur verschieben** / back.
  - 📋 **Als Text kopieren** (plain-text KVA in DE or ES).
- PDF details: A4; logo top right (or none); dark title bar "Kostenvoranschlag" / "Presupuesto" with date; header data; green summary box; table with zebra rows and size-breakdown sub-lines; a red sub-line "Vordrücken zur Lackierung − 40 %" / "Desabollado previo a pintura (Push to Paint) − 40 %" under PTP panels; totals; notes; a photo page in a 2-column grid with labels. File name "Kostenvoranschlag_<plate>_<date>.pdf" / "Presupuesto_…".
- **NEW: "Fotobericht Reparatur" PDF** for insurers: vehicle header plus photos grouped by phase, with date and time captions, in ES or DE, with the chosen letterhead.

### 5.3 Colibri scan-report import (keep the algorithm exactly; see `reference/index_v20.html`, `colibriPages` / `parseColibri` / `colibriKey` / `applyColibri`)
- Reads the original Colibri PDF (not photos): inflates content streams (DecompressionStream deflate / deflate-raw) and extracts `1 0 0 1 x y Tm <hex> Tj` text with coordinates.
- Header values (plate, FIN, date, brand, model, customer, calculation method, language) come from the item directly below each label at the same x, using multilingual label lists.
- Report total comes from "All: 503 Ø: 30mm"-style text. Size columns come from "10mm … 80mm, 100mm", plus the total column.
- Each table row maps a component name to a panel key with multilingual word lists (DE/EN/ES/FR/IT/PT/NL): side, front/rear, upper/lower; door + rear → tuer_h*, fender + rear/quarter → sw_h*, spar → dachholm_*, trunk + lower → heck_u. The 100 mm column becomes `big`.
- Apply rules: overwrite plate, FIN, model (Title Case brand + model) and date. Panels get the imported dents; keep existing alu, bigEur, method and finish. **Dachholm panels automatically get kleber = true.**
- Verification: imported count vs report total, plus unknown rows, gives the "Scan ✓" or "Scan prüfen ⚠" badge and an alert. The original PDF is stored as `colibriFile`.

### 5.4 Photo recognition (plate / FIN)
- Primary: Claude vision (server-side proxy in the new version). Prompts are in the reference (`aiPrompt`): DE and ES plate formats; FIN exactly 17 characters with no I/O/Q; returns JSON `{wert, sicher, hinweis}`; then FIN cleanup O→0, Q→0, I→1.
- Fallback: Tesseract.js OCR with the `findVIN` / `findPlate` regexes.
- Dialog: take or choose a photo → recognised value is editable → confidence note → "Übernehmen".

### 5.5 Customers
- Picker with search, recently used first, add/edit (name, e-mail for KVA sending, address/note), delete, share list as JSON, import list. On first run, customers already used on vehicles are migrated in.

### 5.6 Settings, backup, PWA
- Default rates DE and ES, Teiler, "x € pro AW", customers, technicians, letterheads, version number.
- Keep **JSON export/import** compatible with the old format (`{app:"hes-hagel", version, created, vehicles[], customers[], settings{}, images{id: dataURL}, scans{vehicleId:{name,b64}}}`), as an offline safety net and for migration.
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
- Kickback (workshop "Staffel"), based on H: ≤9 h → 60 €, ≤20 h → 120 €, <30 h → 240 €, otherwise 320 €.
- **OPEN QUESTION for Luca:** the matrix shown to insurers had categories A–F with a maximum of 1,656 €. The app uses A–G with a maximum of 2,070 €. Make the matrix data-driven (an admin-editable table) and ask which one is valid.

### 6.4 Internal split (shares)
- Basis = net − glass. PDR basis = basis − De/Re.
- Workshop € = basis × workshop % (mode pct) or the kickback (mode staffel, ES only).
- Technician € = PDR basis × technician %. De/Re technician € = De/Re € × De/Re %.
- Remaining PDR = basis − workshop − technician − De/Re technician.

## 7. Migration (critical: zero data loss)
1. Each phone first makes a JSON backup in the old app (Einstellungen → Sichern), and `reference/index_v20.html` stays deployed until migration is done.
2. The new app has **"Alte Sicherung importieren"**: it reads the old JSON, creates vehicles, photos (from base64), customers and Colibri scans on the server, de-duplicates by vehicle `id` (the same vehicle on two phones means the newer `updatedAt`/`createdAt` wins, and you show a list of duplicates), and reports counts.
3. Verify after import: number of vehicles, photos and the sum of net prices are the same as in the old app.

## 8. Infra deliverables (`/infra`)
- `install.sh` for Ubuntu 24.04: creates a user, installs PocketBase (pinned version) as a systemd service and Caddy with the domain, opens ports 22, 80 and 443 (ufw), sets up unattended-upgrades, and adds a nightly backup (PocketBase snapshot plus `pb_data` files, kept for 14 days, with optional off-site copy via rclone).
- `README_SERVER.md` for the admin: how to install, update, restore a backup and create users.
- Never commit secrets. Configure the Anthropic key as a server environment variable.

## 9. Quality bar
- TypeScript strict. Unit tests for `/packages/calc` (all 22 golden cases plus edge cases: 0, 25, 26, 1000 and >1000 bollos, Teiler 12, manual AW). Playwright e2e tests: create a vehicle → panel → KVA PDF; Colibri import with a sample PDF if Luca provides one; offline create → online sync.
- Texts are in one i18n file (DE UI, DE and ES documents). Do not mix languages inside a document.
- Accessibility: large touch targets (≥44 px), works with one hand and in sunlight (high contrast).

## 10. Work plan (stop after each phase, report to Luca in German, wait for OK)
1. **Calc engine plus golden tests** (`/packages/calc`). Must be 22/22 green.
2. **Offline PWA with full v20 feature parity** (no server yet), plus old-backup import. Luca tests on his phone next to the old app.
3. **PocketBase server, auth, roles, sync, photo phases**, plus `/infra` scripts. Test with 2 users and 2 vehicles.
4. **Repair photo report, campaigns, letterheads, technician management.**
5. **Migration day:** everyone imports their backup, counts are verified, the old app is retired.

## 11. Open decisions to ask Luca before phase 3
- Spain matrix A–G (app) or A–F (insurer presentation)?
- Can technicians see prices? Do all users see all campaigns?
- Domain and subdomain? Who administers the IONOS VPS (Nikolas)?
- Who owns the org account and data (PDR Team GmbH vs. PDR Team Spain)?
- In ES, should the Klebetechnik material lump sum (10/15/20 €) also apply? (Currently: no.)
