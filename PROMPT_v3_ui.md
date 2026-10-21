# PROMPT v3 — New UI + new features on the existing `hagel-plattform` app (safe rollout: branch → staging → production)

> **Who you are working for:** Nicolas Rasteiro (PDR-Team GmbH), main admin. **Report to him in French**, stop after every phase and wait for his OK.
> **What this is:** an *evolution* of the app that is **already in production** on Railway (repo `https://github.com/NicoR017/hagel-plattform`, branch `main`, phases 1–6 of `PROMPT_v2.md` delivered). It is **not** a rebuild. People use the app every day: **no downtime, no data loss, nothing touches production until Nicolas says so.**

---

## 0. Read first (in this order)

1. **This file** — rules and plan.
2. `PROMPT_v2.md` — the functional spec. The sections that are **new or changed since the current `main`** are listed in §5 below; everything else is already implemented and must keep working.
3. `reference/maquette-v3/Main.dc.html` — the **clickable mockup** ("Hagel-Kalk – Maquette UI", desktop 1440 px; `Mobile.dc.html` = same screens at 390 px). It is a single HTML file: the markup is the UI, and the `<script type="text/x-dc">` block (`class Component extends DCLogic`) contains the mock data and all the screen logic (`expView`, `adminView`, `repView`, `methodFor`, `catTable`, `expCalc`, `repDefault`…). Use it as the **visual and behavioural reference** (layout, labels, flows, dialogs, empty states). Do **not** copy its code or its numbers: all amounts come from `packages/calc` (the mockup's DE formula is simplified on purpose).
4. The existing code, before writing anything: `server/src/schema.ts`, `server/migrations/*` + `meta/_journal.json`, `server/src/db.ts` (migrations run at boot via `createDb()`), `server/src/sync.ts`, `packages/shared/src/{permissions,sync}.ts`, `app/src/App.tsx`, `app/src/field/*`, `app/src/admin.tsx`, `app/src/admin2.tsx`, `server/src/reports.ts`, `packages/documents/src/{pdf,techsheet}.ts`, `infra/README_RAILWAY.md`, all tests.

Write a short **gap analysis** (existing vs. target, file by file) as your first deliverable (Phase 0) before changing any code.

---

## 1. Absolute rules (data safety and production)

1. **Never** commit to `main`, push to `main`, merge into `main`, open a release, or run anything against the production database / production Railway environment. Only Nicolas merges, after staging validation (§8).
2. All work happens on the branch **`feature/ui-v3`** (created from the current `main`). Small, meaningful commits. Push the branch to `origin` only when Nicolas confirms the remote is OK.
3. **Database migrations are strictly additive and backward compatible** (§3). The production data (vehicles, photos, shares, KVA, status history, moves, scans, users, roles, stations, insurers, audit) must survive unchanged.
4. **Staging never sends real e-mails and never writes to Azure** (§2).
5. No secret in the repo (env vars only). No production data in the repo or in test fixtures.
6. `packages/calc` stays bit-identical in results: the **22 golden cases must stay 22/22** and existing vehicles must keep exactly the same amounts. New calculation methods (§5.6) are *added on top*; the current DE BVAT 2025 / ES matrix behaviour becomes the locked **system method**.
7. If anything in the spec or mockup is unclear or contradicts the existing code: **ask Nicolas before deciding** (he said so explicitly).

---

## 2. Staging ("preprod") environment on Railway

Goal: a full copy of production that Nicolas and 1–2 field users can test for days without any risk.

Write `infra/README_STAGING.md` with the exact steps (Railway dashboard clicks and/or `railway` CLI commands), and the scripts below. **Nicolas performs the steps that need his Railway access**; you prepare everything and tell him exactly what to click.

1. In the existing Railway project, create a new **environment `staging`** (Railway "Environments": it duplicates the services — api, worker, Postgres — with their own variables and volumes). Deploy branch **`feature/ui-v3`** to it (prod stays on `main`).
2. **Separate Postgres** for staging, initialised from a **copy of production**:
   - take a fresh `pg_dump -Fc` of production (or reuse last night's dump in the bucket `backups/`, see `README_RAILWAY.md`);
   - `pg_restore --no-owner --no-acl --clean --if-exists` into the **staging** database;
   - then the new migrations (0010+) run automatically on staging boot. This is the real test that they work on production data.
   - script: `infra/scripts/staging_refresh.sh` (dump prod → restore staging → anonymise e-mails optional → print row counts). It must refuse to run if the target `DATABASE_URL` equals the production one.
3. **Separate bucket / prefix** for staging (photos, PDFs). Option A: copy the prod bucket objects once (`aws s3 sync`) so photos display. Option B: a read-only fallback to the prod bucket for reads + writes to the staging bucket. Choose A unless the volume is too large; ask Nicolas.
4. **E-mails disabled:** new env var `MAIL_MODE=off|redirect|live` (default `live` only if unset in prod). Staging: `MAIL_MODE=redirect` + `MAIL_REDIRECT_TO=nicolas.rasteiro@pdr-team.de` → every mail goes to Nicolas with the original recipients in the subject/body. Log every would-be send in `report_sends` with a `staging` flag.
5. **Azure read-only:** staging uses the same SAS (read/list only) so new scans appear, but the worker must never write/delete anything in Azure (it already only reads — verify). Set a different `AZURE_SYNC_MINUTES` (e.g. 15) to limit load.
6. Different `APP_URL` / magic-link base URL, cookie name and service-worker scope/cache name, so a phone with the prod PWA installed and the staging PWA open in the browser never mixes local IndexedDB (Dexie) data. Show a **visible "STAGING" banner** (env `APP_ENV=staging`).
7. Backups of staging are not needed (it can be refreshed from prod any time).

---

## 3. Database rules (zero data loss)

- New migrations are numbered **0010, 0011, …**, generated with drizzle-kit from `schema.ts` and **reviewed by hand**. Allowed: `CREATE TABLE`, `ADD COLUMN` (nullable or with a default), `CREATE INDEX` (`CONCURRENTLY` is not possible inside Drizzle's transaction — acceptable at our size, but say how long it takes on the staging copy), new enum values via text columns + Zod (we use text, keep it so), idempotent backfills (`UPDATE … WHERE new_col IS NULL`).
- **Forbidden:** `DROP TABLE`, `DROP COLUMN`, `RENAME`, changing a column type, `NOT NULL` on an existing column without a default, deleting rows, rewriting JSONB `header`/`panels`/`shares` of existing vehicles. If something becomes obsolete (e.g. the old repair wizard data), it stays in place and is simply no longer written; a cleanup migration can come months later, separately.
- The **old app version must keep working on the new schema** (this is what makes rollback possible, §8.4): old code ignores new tables/columns; new columns have defaults.
- Every backfill is in SQL in the migration (deterministic) and covered by a test that runs all migrations on a DB seeded with the **pre-migration** shape (use the PGlite helper in `server/test/helpers.ts`, plus once on the real Postgres 18 staging copy).
- Write a check script `server/src/scripts/integrity.ts` (`npm run integrity`) printing: number of vehicles (by org/station/status, deleted or not), photos, sum of net amounts per org (recomputed with `packages/calc`), number of shares, scans, users, roles. Run it **before and after** migrations on staging; the numbers must be identical (new tables aside). Include the output in your phase report.

Expected new schema (adapt names to the existing conventions; check `PROMPT_v2.md` §4):

| Change | Backfill |
|---|---|
| `vehicles.repair_stage text null` (bereit\|demontage\|pdr\|remontage\|bodyshop\|finish) | `statut='reparatur'` → `'bereit'` (or `'pdr'` if a technician is assigned — ask Nicolas), `statut='fertig'` → `'finish'`, others null |
| `vehicles.parts_to_replace` → stored in `header` JSONB key `partsToReplace: string[]` (so sync/LWW stays the same) **or** new column; justify the choice | none (empty) |
| `vehicles.method_id`, `method_version` (null) + method snapshot in `header.method` | existing vehicles: system method of their country, version 1 |
| `calc_methods` (id, org_id, name, engine aw\|matrix, country, base_method_id, params JSONB, is_system, version, created_at, created_by, archived_at) | seed per org: "BVAT 2025 (System)" DE and "PDR Team Matrix (System)" ES, `is_system=true`, params = current settings |
| `insurer_methods` (insurer_id, country, method_id) | none (fallback = system method) |
| `stations.excluded_insurer_emails text[] default '{}'` | none |
| `repair_todos` (id, vehicle_id, text, source manual\|part, created_by/at, done_by/at, sort, seq, deleted_at) | none; parts from `partsToReplace` become todos when the vehicle enters the board |
| `repair_checks` (vehicle_id, key, done_by, done_at) | none |
| `repair_events` (id, vehicle_id, user_id, at, type, payload JSONB) | none (history before v3 stays in `vehicle_status_history` / `vehicle_moves` and is shown merged in Verlauf) |
| `repair_appointments` (id, vehicle_id, technician_id, date, duration_min, note) | none |
| `stations.repairs_per_day int default 3` (capacity of the repair calendar) | existing stations → 3 (Nicolas adjusts in Verwaltung) |
| `repair_bookings` (id, org_id, station_id, vehicle_id, date, status booked\|cancelled\|started, time (HH:MM), customer_phone, customer_email, created_by/at, cancelled_by/at, started_at, seq) — unique (vehicle_id) where status='booked' | none |
| `vehicle_comments` (id, vehicle_id, user_id, at, text, deleted_at) | none |
| `photos.repair_stage`, `photos.role`, `photos.user_id` (null) | none |
| `technicians.kind text default 'pdr'` (pdr\|headliner) + `default_pct` reuse of existing `default_pct_pdr` / `default_pct_demontage` | existing rows → `pdr` |
| `vehicle_assignments`: role column if needed for headliner (check existing table first) | existing → `pdr` |
| `report_sends.type` gets new values `reparaturbericht`, `wochenbericht` (text) | none |
| new permissions (`reparatur.board`, `reparatur.endabnahme`, `methoden.gerer`, `wochenbericht.voir`, …) added to `PERMISSIONS`; **existing roles get them by a data migration** so nobody loses access | add to system roles as in `permissions.ts`; for custom roles, map from the nearest existing permission and list them in the report |

---

## 4. Sync and offline clients (critical during rollout)

- Phones have the current PWA with local Dexie data and pending ops. After the deploy, **old clients must keep syncing** with the new server until they update: every existing op type (`vehicle.create/header/panel/shares/status/move/delete/assign/colibri`, `photo.add/update/delete`, `report.send`) keeps exactly its current schema and behaviour.
- New op types (e.g. `vehicle.repairStage`, `repair.todo.add/toggle/delete`, `repair.check`, `vehicle.comment`, `appointment.*`) are **added**; the server accepts them, old clients never send them. New fields are sent to old clients only inside structures they already tolerate (check the client parser: unknown keys must be ignored, not crash).
- The service worker must **update cleanly**: on new version, finish pending pushes, then reload (show "Neue Version — wird geladen" toast). Never clear IndexedDB on update. Test: old client with 3 pending offline ops → deploy new version → ops arrive, nothing lost, then the client updates.
- If the Dexie schema changes, use a Dexie version upgrade (additive), never `delete()` the DB.

---

## 5. What to build (gap between current `main` and the mockup / `PROMPT_v2.md`)

Keep all existing features (v20 parity, Azure import, reports, dashboard, admin). Re-skin and re-organise them along the new navigation; add what is new.

### 5.1 Shell and navigation (`PROMPT_v2.md` §5.0)
- Term **"Station"** everywhere in the UI (DB stays `stations`).
- Flow: **Dashboard/Stationen** → **Station: mode choice** (3 cards Kalkulation / Reparatur / Alle Fahrzeuge with counts, "Station wechseln", default station remembered) → **list / board** → **detail**.
- **"‹ Zurück" button top-left** on every screen except the dashboard, one level up, mapped to browser/Android back. Breadcrumb secondary.
- New routes in `app/src/field/route.ts` (e.g. `#/s/:stationId`, `#/s/:stationId/:mode`, `#/s/:stationId/:mode/v/:id/:section`, `#/s/:stationId/rep/v/:id/:tab`, `#/expertise/:id/:step`). **Old hash routes (`#/v/:id/:tab`, `#/dashboard`, `#/admin/...`) must still resolve** (redirect) so bookmarks and links in sent e-mails keep working.
- Desktop: fixed left menu, back-office look; phone (≥ 360 px): same screens, side menu stacked above content. Touch targets ≥ 44 px.

### 5.2 Vehicle lists, status and moves
- List filtered by mode (Kalkulation / Reparatur / Alle Fahrzeuge incl. Zurückgegeben), status chips, search, "Colibri-Scans (n)", "+ Fahrzeug" / "+ Neue Expertise".
- Per row "Status" and "Verschieben"; checkboxes + sticky bar for **multi-select** (status change, move to another station); status dialog (Wartet needs a reason), move dialog (occupancy, warning if full, note); **toast with "Rückgängig" (~5 s)**. All through the existing ops `vehicle.status` / `vehicle.move` (undo = a second op, logged).

### 5.3 Expertise-Assistent (v20 look)
- Step 0 "Scan wählen" (station's new Azure scans → "Übernehmen", manual PDF import, "Ohne Scan starten"), then Basis · Erfassung · Bilder · KVA as free steps, dark header, sticky bottom bar with live net / AW / Bollos. Reuse the existing `Basis.tsx`, `Erfassung.tsx`, `Panel.tsx`, `Bilder.tsx`, `Kva.tsx` logic; restyle (navy #16233f, green #5e8c63 / #e4eee5).
- **Zu ersetzende Teile** (labels + quick picks) in Erfassung → printed in KVA PDF / text KVA / Fotobericht (update `packages/documents`, add tests and update PDF snapshots).
- **Lightbox** for photos (full screen, prev/next, label edit, in PDF yes/no, delete with permission) in the assistant and in the vehicle's Bilder.
- Calculation method shown in Basis, chosen automatically from the insurer (§5.6), overridable with permission.

### 5.4 Vehicle detail
- Dark header (plate, model, claim, status badge, Status ändern, Verschieben, Kommentare) + left section menu depending on mode (Allgemeine Daten · Erfassung · PDR-Techniker · Reparaturtermine · Bilder · KVA & Dokumente · Kommunikation · GT Motive · Verlauf).
- **Kommentare** (internal, never in documents), **Reparaturtermine** (weekly planning per technician), **Verlauf** (status history + moves + sends + imports + repair events merged).
- **GT Motive:** UI shell only + an empty `gtmotive` integration interface on the server (no API calls).

### 5.5 Reparatur (Kanban) — `PROMPT_v2.md` §5.0 point 5
- Board **Bereit · Demontage · PDR · Remontage · At Bodyshop · Finish**, drag & drop + ‹ › buttons, cards (plate, bodyshop, insurer, model, technician, headliner, Wartet badge, to-do badge).
- "+ Fahrzeug in Reparatur": only **assessed** vehicles of the station not yet in repair; choose PDR technician + headliner; live remainder (Netto − technician share − headliner share − bodyshop commission = remaining PDR Team, amount and %; numbers from `packages/calc` + existing shares logic).
- Repair detail: **Übersicht** (to-dos first incl. parts To do/Done with who/when, team with shares filtered by permission, time), **Fotos** (auto name "Stage · Rolle · Person · Zeit", grouped by stage), **Abschluss** (auto check: photos for every completed stage; manual checks PDR / Teile & De-/Remontage / **Endabnahme Chef de station**), **Verlauf**.
- Moving to **Finish** is refused server-side too (not only in the UI) while to-dos or checks are open.
- **At Finish: Reparaturbericht PDF generated and sent automatically** to the station's effective recipient list and to the insurer (KVA amounts net/VAT/gross, **never the internal split**), logged in `report_sends`. Staging: redirected (§2.4). Must be idempotent (one send per Finish; re-send button for the chef).
- Mapping to statuses: on the board `statut` = `reparatur` (or `attente`), Finish → `fertig`, handover → `rendu` (card leaves).

### 5.5b Repair calendar (booking at the end of the expertise) — new, see mockup step KVA → "Reparaturtermin buchen" and board strip "Geplante Reparaturtermine"
- **Who / where:** staff book in the app, no customer self-service in this version. Two entry points with the same form:
  1. at the end of the expertise (KVA step of the Expertise-Assistent);
  2. in the **vehicle detail**, side-menu section **"Reparaturtermin"** (second item, after Allgemeine Daten), available in Kalkulation and Alle Fahrzeuge **for the statuses Angekommen, Besichtigung and Wartet** (hidden for `reparatur`, `fertig` and `rendu`; the API refuses a booking for those statuses too). If a booking exists, the section shows it (day, time, phone, e-mail, booked by) with **Verschieben** and **Stornieren**; otherwise the booking form.
- **Form fields (all required):** day, time (select, 07:30–17:00 every 30 min), customer phone, customer e-mail (validated).
- **Day picker = classic month calendar** (Mo–So grid) covering the whole year: ‹ › month navigation, « » year navigation, month chips Jan–Dez, "Heute" button; range = current year and next year. Each working day shows its free places from the station capacity ("3 frei", amber when 1 place left, red "voll"); weekends and past days are greyed and not selectable; today has a blue outline. Under the calendar, the selected day lists its bookings (plate · time). Dates outside the current year are displayed with the year (Mi 10.03.2027). API: `GET /stations/:id/booking-calendar?from=YYYY-MM-01&to=YYYY-MM-31` returns per day capacity, booked count and (with permission) the bookings.
- **Phone number:** only stored so staff can call the customer (shown as a "Kunde anrufen" `tel:` link on the booking). No SMS, never sent anywhere. The button stays disabled and shows "Noch fehlt: …" until everything is filled.
- **The technician is not linked to the booking** (no technician field); he is assigned later on the board. The existing per-technician weekly planning section is renamed **"Technikerplanung"** to avoid confusion.
- **Capacity per station:** `stations.repairs_per_day` (edited in Verwaltung → Station: "Reparaturen pro Tag"). Booked count per day = bookings with status `booked` or `started` for that station and date. Server-side check: refuse a booking on a full day (race condition between two assessors → 409 with message, client refreshes the calendar).
- **Booking effect:** the vehicle **stays in `besichtigung`** (or Wartet Freigabe) with a badge "Termin <Tag dd.mm.>" in lists, detail and dashboard. **On the appointment day it moves automatically** to `statut='reparatur'` + `repair_stage='bereit'`: worker job every day at 00:05 (station time zone: Europe/Berlin for DE, Europe/Madrid for ES) **and** on boot (catch-up), idempotent; booking status → `started`; written to `vehicle_status_history` and `repair_events` (user "System", "Reparaturtermin erreicht → automatisch in Bereit"); the vehicle's `partsToReplace` become to-dos as for a manual add. Booking for today → moved immediately. If the vehicle is meanwhile in another status (already in repair, rendu, deleted, moved to another station) the job does nothing and marks the booking `cancelled` with a reason in the log.
- **Confirmation e-mails** (through `MAIL_MODE`, logged in `report_sends` type `termin`): to the **customer** (e-mail of the booking form) and to the **carrosserie** (the station's effective recipient list, §3.4, **without** the automatic insurer addresses). Content DE or ES by country: date and time, station name and address, plate, model, claim number. Rescheduling or cancelling sends an update / cancellation e-mail.
- **Board:** strip "Geplante Reparaturtermine" above the Kanban (future bookings of the station, date, plate, model, insurer, booked by, actions Verschieben / Stornieren) + "Heute: x / N Reparaturen gebucht". Cards that arrived automatically show "Termin heute".
- "Ohne Termin sofort in Reparatur" stays possible (existing "+ Fahrzeug in Reparatur" flow).
- New sync op types `booking.create`, `booking.move`, `booking.cancel`; permission `termine.buchen` (given by data migration to roles that have `vehicules.changer_statut`).
- Tests: capacity (full day refused, concurrent bookings), daily job (moves only due bookings, idempotent, time zone around midnight, catch-up after downtime), cancellation/reschedule e-mails, no insurer address in the confirmation.

### 5.6 Calculation methods per insurer (`PROMPT_v2.md` §6.5)
- `calc_methods` with engines `aw` (DE BVAT-like: table, Teiler, rate, surcharges) and `matrix` (ES: categories, prices, adjustments); system methods locked (duplicate to edit); **versioning**: every change = new version; a vehicle stores `method_id` + `method_version` + snapshot → **existing estimates never change**.
- `insurer_methods` (per insurer and country); resolution: vehicle override → insurer method → system method of the country.
- `packages/calc` gets a parameterised entry point; the system method with its default params must produce exactly the current results (golden 22/22 + a new test: every vehicle of the staging copy recomputed with the system method = stored net amount; report differences).

### 5.7 Verwaltung (admin) — `PROMPT_v2.md` §3.4
- Users: edit, **delete** (soft delete / deactivate, sessions revoked, history kept).
- Roles: edit, **delete** with choice of a replacement role for its members (system roles not deletable).
- Stations: **edit** everything (type, tenant, address, capacity, Azure links, commission), **several report e-mails**, selected insurers → their report e-mail **added automatically** ("automatisch · <insurer>"), removable individually (→ `excluded_insurer_emails`). Effective recipients computed server-side in `reports.ts` (`recipientsFor` extended + tests).
- Versicherungen: method per country (§5.6). Berechnungsmethoden screen.
- **Techniker & Headliner** (kind, default %, stations, e-mail, account or not) + **Wochenbericht**: person + calendar week → vehicles that reached **Finish** that week with basis and amount and total to invoice to PDR Team → "PDF erzeugen & senden" (reuse/extend `packages/documents/src/techsheet.ts`).
- Existing screens (Preise, Azure, Kampagnen, Firmen, Audit, Orgs) keep working, restyled.

### 5.8 Dashboard
- Restyle to the mockup; keep existing data/permissions (`dashboard.ts`); add counts per mode and the repair board stages per station.

### 5.9 i18n
- All new texts in the i18n file (UI DE + EN as today; documents DE and ES). Use the mockup labels.

---

## 6. Feature flag and coexistence

- Keep the **current UI available** behind `?ui=legacy` (or a user setting) for the first weeks after go-live, using the same data. New UI is the default. This allows a field user to fall back instantly if something blocks him, without any rollback.
- Env `UI_V3_DEFAULT=true|false` to switch the default without redeploying code (prod can go live with `false`, then `true` after a first day of checks if Nicolas prefers).
- Do not delete old components in this branch; mark them `@deprecated`.

---

## 7. Tests (must be green before every phase report)

- Existing suites unchanged and green: `npm test` (calc golden 22/22 + edge, colibri incl. real PDF, documents, server api/azure/password/permissions/phase4/phase6/sync).
- New: repair calendar (§5.5b), migrations on pre-v3 seeded DB (§3), integrity before/after, sync backward-compat (old op shapes, old client with pending ops), recipients with automatic insurer e-mails and exclusions, Finish blocked server-side, Reparaturbericht content (no internal split), Wochenbericht totals, method versioning (old vehicles unchanged), permissions of every new permission × role, technician/headliner never receive other shares in API responses.
- Playwright e2e on the staging URL (or local): login → station → Kalkulation → Expertise from a scan → KVA PDF; Reparatur board → drag to each column → Finish blocked → complete → report "sent" (redirect mode); multi-select move + undo; phone viewport 390 px.
- `npm run typecheck` + full `tsc -b` clean.

---

## 8. Go-live procedure (write it in `infra/README_STAGING.md`, Nicolas executes it)

### 8.1 Staging validation (before any merge)
Checklist signed by Nicolas: integrity numbers identical; 1–2 field users worked on staging ≥ 2–3 days on phone and desktop; Azure scans arrive; PDFs correct (DE and ES); e-mails only redirected; old PWA client tested against staging server.

### 8.2 Before merging
1. Freeze: tell users a 10-minute window (evening), ask them to be online so pending offline ops are pushed.
2. **Manual backup of production**: `pg_dump -Fc` to the bucket (`backups/pre-v3-YYYYMMDD.dump`) **and** a Railway Postgres backup/snapshot; verify the dump by restoring it into the staging DB (`pg_restore --list` at minimum, a full restore preferably) and running `npm run integrity`.
3. Note the current production deployment ID / commit (`7b5e9ed` or later) for rollback.

### 8.3 Merge and deploy
PR `feature/ui-v3` → `main` (description lists migrations 0010+, new env vars, checklist). Nicolas merges. Railway deploys; migrations run at boot. Set new env vars in prod first (`MAIL_MODE=live`, `APP_ENV=production`, `UI_V3_DEFAULT`). Run `npm run integrity` against prod and compare with the pre-merge numbers. Smoke test (login, list, open a vehicle, KVA PDF, board).

### 8.4 Rollback plan
- **UI problem only:** set `UI_V3_DEFAULT=false` / users use `?ui=legacy`. No redeploy.
- **Server problem:** Railway "Redeploy" of the previous deployment (old code). Because migrations are additive, the old code runs on the new schema; data written by v3 in new tables simply waits. Old clients still work; v3 clients that send new op types get a clean error and keep the ops queued (implement this: unknown op type → `409 unsupported_op`, client keeps it).
- **Data corruption (last resort):** restore `pre-v3` dump into a **new** Postgres, switch `DATABASE_URL`; writes made after the backup are lost → only with Nicolas's decision.

---

## 9. Work plan (stop after each phase, report in French, wait for OK)

0. **Gap analysis + plan** (no code): file-by-file list of what exists, what changes, what is new; list of migrations; open questions (§10). Create branch `feature/ui-v3`; commit `PROMPT_v2.md` (currently modified, not committed), this file and `reference/maquette-v3/` as the first commit.
1. **Staging + safety net:** `MAIL_MODE`, `APP_ENV` banner, staging scripts, `integrity` script, `README_STAGING.md`, sync backward-compat tests. Nicolas creates the Railway staging environment and restores a prod copy; you verify counts.
2. **Schema 0010+ and server:** migrations + backfills, new tables/permissions, sync op types, recipients, method versioning in `packages/calc` (golden 22/22), APIs for repair/todos/checks/comments/appointments. Tests. Deploy to staging, integrity identical.
3. **New shell + navigation + lists** (stations, modes, lists, status/move/multi-select/undo, Zurück, old-route redirects, legacy flag).
4. **Expertise-Assistent + vehicle detail** (v20 look, parts to replace, lightbox, Kommentare, Reparaturtermine, Verlauf, GT Motive shell) + document updates.
5. **Reparatur board** (Kanban, detail, photos naming, checks, Finish rules, Reparaturbericht automatic send) **+ repair calendar** (§5.5b: booking in KVA step, capacity per station, daily auto-move to Bereit, confirmation e-mails).
6. **Verwaltung** (users/roles delete, stations edit with recipients, methods, insurers, Techniker & Headliner, Wochenbericht) + dashboard restyle.
7. **Hardening on staging:** e2e, phone tests, performance on the prod copy, field test with users, fixes. Then hand over the go-live checklist (§8). **You do not merge.**

Each report: what was done, tests output (counts), integrity numbers when relevant, screenshots (desktop + 390 px) of the new screens, what Nicolas must do/decide, risks.

---

## 10. Open questions to ask Nicolas (before the phase that needs them)

1. Shares in repair: technician = % of (Netto − De-/Remontage amount)? Headliner = % of the De-/Remontage amount (150 € in the mockup)? Bodyshop commission = station's commission (DE 10 %, ES Staffel ≈ 120 €)? (Phase 2/5)
2. Backfill of `repair_stage` for vehicles currently in `reparatur`: all to "Bereit", or "PDR" when a technician is assigned? (Phase 2)
3. Spain matrix A–G or A–F; Klebetechnik material lump sum in ES? (Phase 2, keep data-driven)
4. Is the internal split hidden from insurers in every document (assumed yes)? One PDF per recipient or the same PDF for all? (Phase 5)
5. Staging bucket: copy prod photos (A) or read-through (B)? Staging domain name? (Phase 1)
6. Go-live with new UI default immediately or `UI_V3_DEFAULT=false` first? (Phase 7)
