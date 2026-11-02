# CLAUDE.md – rules for working on hagel-plattform

You work for **Nicolas Rasteiro** (PDR-Team), the owner of this app. **Talk to him in French.** The app runs in production on Render from the current **release branch** (`release/N`, since 2026-11-02; `release/1` is the first; `main` is no longer what production runs), with a staging environment on Render (`hagel-staging-api`, `hagel-staging-worker`, `hagel-staging-db`). See `infra/README_STAGING.md`, `docs/SAUVEGARDE_RENDER.md`, `docs/GO_LIVE_CHECKLIST.md`.

The most important rule of all: **never lose data** (assessments, vehicles, photos, estimates, history).

---

## Feature workflow (mandatory for every feature, change or fix)

Every feature goes through these 6 steps, in this order. Do not skip any step and do not merge two features into one branch.

**Release branches.** Production runs a `release/N` branch. A feature branch is merged into the current release branch (not into `main`) once Nicolas has validated it; the release is then tested as a whole on staging and deployed to production. When Nicolas says "new release", create `release/N+1` from the **production release branch** (what production really runs), not from `main`. Below, "release" means the release branch being prepared. Nicolas may also ask for changes directly on the release branch (no new feature branch): then steps 1 and 5 are replaced by "commit on the release branch". Always check `git rev-list --left-right --count origin/main...release/N` before a production deploy: if `main` has commits the release lacks (e.g. a hotfix merged there), merge `origin/main` into the release first, otherwise the deploy silently reverts them.

### 1. One branch per feature, from the release branch
- `git fetch origin`, `git switch release/N`, `git pull --ff-only`, then `git switch -c feature/<short-name>` (bug fix: `fix/<short-name>`).
- **Never commit on `main`.** Never build a feature on top of another feature branch that is not merged yet. If it really depends on one, ask Nicolas first.
- Small, clear commits. Migrations are **additive only** (no `DROP`, no `RENAME`, no type change, no deleting rows) so that the previous version keeps working on the new schema.

### 2. Tests before staging
Run everything and fix until green:
- unit and e2e tests
- golden calculation tests (22/22)
- the i18n test (DE/EN/FR/ES complete)
- `npm run integrity` on the staging copy, before and after the migrations

### 3. Deploy to staging and let Nicolas test
- Push the branch, then deploy **that branch** to the staging services only (`hagel-staging-api` + `hagel-staging-worker`; autoDeploy is off, so switch the branch and run a manual deploy). **Never touch the production services.**
- Only one feature is on staging at a time. If another branch is being tested there, ask Nicolas before replacing it.
- Staging never sends real e-mails (`MAIL_MODE=off` or `redirect`) and never writes to Azure.
- Send Nicolas (in French):
  - the staging URL;
  - what changed;
  - **a short test list**: which screens, which profile, what to check;
  - the known limits.
- Then **wait**.

### 4. Nicolas validates on staging
- If he reports problems: fix them on the same branch, then go back to step 2.
- Go on only after he clearly says the feature is OK (« validé », « ok pour la PR »…).

### 5. Pull request to the release branch
- Before opening it:
  - update the branch on the latest release branch (rebase or merge) and make sure `main` has nothing the release lacks (see above);
  - re-run the tests;
  - redeploy to staging if the release branch or `main` changed meaningfully.
- Open the PR with `gh pr create --base release/N`. The description (in French) contains:
  - goal and summary;
  - screens / files changed;
  - **migrations** and their effect on existing data;
  - test results;
  - the date Nicolas validated it on staging;
  - risks;
  - **rollback plan**;
  - the production steps.
- **Do not merge.** Nicolas reviews and approves the PR on GitHub.

### 6. Production deploy – in the evening, when nobody uses the app
- Only after Nicolas has approved the PR **and** said to go live.
- Only **in the evening, from 20:00 Spain time (Europe/Madrid)**, unless Nicolas gives another time. Production services (`hagel-api` srv-dbd4db3rjlhs73d3mtig, `hagel-worker` srv-dbd4dc29lscs73e6pi40) have autoDeploy off and track the production release branch: a new release is deployed by switching their branch to `release/N` and running a manual deploy of both services. Merging a feature into the release branch does not deploy anything, but still wait for that window before switching/deploying production.
- Steps:
  1. **Back up production first:** `pg_dump -Fc` (see `docs/SAUVEGARDE_RENDER.md`) and check it with `pg_restore --list`.
  2. Write down the current production deploy / commit, so it can be redeployed.
  3. Run `npm run integrity` on production (read-only) and save the result.
  4. Merge the PR into the release branch (merge commit), merge `origin/main` into it if needed, then switch the production services to the release branch and deploy them (API first, then worker).
  5. Check:
     - health check (`/api/health`);
     - migrations applied;
     - `npm run integrity` compared with step 3 (identical, apart from added tables);
     - a quick smoke test of the changed screens.
- If anything is wrong, **roll back immediately**: redeploy the previous version (the schema stays compatible thanks to the additive migrations). Restore the backup only if data was damaged, and only with Nicolas's OK.
- Report to Nicolas (in French): what is in production, the checks done, anything to watch. Then delete the feature branch (local and remote).

### Urgent fixes
Even an urgent production bug follows the same path: branch from the production release branch, then staging, then a PR into the release branch. Only Nicolas can decide to shorten the test on staging or to deploy outside the evening window, and he must say so explicitly.

---

## Other rules
- No secrets in the repo, no production data in tests or fixtures.
- Permissions are checked on the server, never only by hiding a button.
- If something is unclear or two instructions contradict each other: **ask Nicolas before deciding.**
- Long specs live in `PROMPT_v*.md`. The clickable mockup is `reference/maquette-etat-actuel/maquette-etat-actuel.html`; use it as the visual reference only, never copy its code.
