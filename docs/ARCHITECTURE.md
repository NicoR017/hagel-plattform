# Frontend architecture map

One UI. Find a bug by **domain**, not by version (`v3`, `field`, …).

```
app/src/
  App.tsx                 # auth shell + top-level route dispatch
  main.tsx
  api.ts / env.tsx        # HTTP client, public /config banner

  shared/                 # used by every domain
    sync/                 # IndexedDB, outbox, sync engine, mutations
    store.tsx             # FieldProvider / useField / live queries
    route.ts              # hash router
    ui.tsx, toast.tsx, Dialogs.tsx, Picker.tsx, …
    i18n/                 # all languages (one place)
    calc.ts, docs.ts, images.ts, …

  domains/
    vehicles/             # lists, detail, panels, photos, basis, capture
    expertise/            # assessment assistant, KVA, OCR
    repair/               # board, detail, handover, signature
    citas/                # PDR Citas calendar & start
    scans/                # Colibri scans, devices, import UI
    admin/                # users, roles, stations, methods, Azure admin
    reports/              # dashboard, insurer reports, send report
    shell/                # AppShell chrome, AppRoutes, search
```

## Rules

1. **English** folder and file names.
2. A screen lives in the domain it belongs to; shared widgets go in `shared/`.
3. Domains may import `shared/` and other domains sparingly; `shared/` never imports `domains/`.
4. Prefer short functions (one job each) when touching a file.

## Backend

```
server/src/
  app.ts / index.ts / worker.ts   # composition root (wire domains, no business CRUD)
  schema.ts, db.ts, permissions.ts, storage.ts, …

  domains/
    auth/        # login, sessions, invitations, principal
    vehicles/    # sync push/pull, photos, OCR entry
    expertise/   # (logic lives with vehicles sync today)
    repair/      # board ops, handover, repair report PDF
    citas/       # PDR Citas calendar source + routes
    scans/       # Colibri mirror/import, devices, ScanCatalog
      catalog.ts / azureCatalog.ts / blobs.ts
    admin/       # org CRUD, roles, stations, methods, letterheads
    reports/     # dashboard, insurer reports, mails, weekly
```

`syncAzure` and `importScans` talk to `ScanCatalog`. To use another source later, add an adapter that implements the same port.

Bug → open `server/src/domains/<domain>/`. Infrastructure (DB, mail, storage, hub) stays at `server/src/` root.
