# CLAUDE.md – rules for working on hagel-plattform

You work for **Nicolas Rasteiro** (PDR-Team), the owner of this app. **Talk to him in French.** The app runs in production on Render (`main`), with a staging environment on Render (`hagel-staging-api`, `hagel-staging-worker`, `hagel-staging-db`). See `infra/README_STAGING.md`, `docs/SAUVEGARDE_RENDER.md`, `docs/GO_LIVE_CHECKLIST.md`.

The most important rule of all: **never lose data** (assessments, vehicles, photos, estimates, history).

---

## Feature workflow (mandatory for every feature, change or fix)

Every feature goes through these 6 steps, in this order. Do not skip any step and do not merge two features into one branch.

### 1. One branch per feature, from `main`
- `git fetch origin`, `git switch main`, `git pull --ff-only`, then `git switch -c feature/<short-name>` (bug fix: `fix/<short-name>`).
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

### 5. Pull request to `main`
- Before opening it:
  - update the branch on the latest `main` (rebase or merge);
  - re-run the tests;
  - redeploy to staging if `main` changed meaningfully.
- Open the PR with `gh pr create --base main`. The description (in French) contains:
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
- Only **in the evening, from 20:00 Spain time (Europe/Madrid)**, unless Nicolas gives another time. If production deploys automatically from `main`, merging = deploying, so the merge itself waits for that window too.
- Steps:
  1. **Back up production first:** `pg_dump -Fc` (see `docs/SAUVEGARDE_RENDER.md`) and check it with `pg_restore --list`.
  2. Write down the current production deploy / commit, so it can be redeployed.
  3. Run `npm run integrity` on production (read-only) and save the result.
  4. Merge the PR (merge commit), then deploy production.
  5. Check:
     - health check (`/api/health`);
     - migrations applied;
     - `npm run integrity` compared with step 3 (identical, apart from added tables);
     - a quick smoke test of the changed screens.
- If anything is wrong, **roll back immediately**: redeploy the previous version (the schema stays compatible thanks to the additive migrations). Restore the backup only if data was damaged, and only with Nicolas's OK.
- Report to Nicolas (in French): what is in production, the checks done, anything to watch. Then delete the feature branch (local and remote).

### Urgent fixes
Even an urgent production bug follows the same path: branch from `main`, then staging, then a PR. Only Nicolas can decide to shorten the test on staging or to deploy outside the evening window, and he must say so explicitly.

---

## Other rules
- No secrets in the repo, no production data in tests or fixtures.
- Permissions are checked on the server, never only by hiding a button.
- If something is unclear or two instructions contradict each other: **ask Nicolas before deciding.**
- Long specs live in `PROMPT_v*.md`. The clickable mockup is `reference/maquette-etat-actuel/maquette-etat-actuel.html`; use it as the visual reference only, never copy its code.
