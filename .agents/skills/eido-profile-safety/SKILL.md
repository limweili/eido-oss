---
name: eido-profile-safety
description: Protect private Eido Profile data and storage compatibility during development, testing, migration, recovery, or incident response. Use when Codex changes Profile, SQLite, blob, ownership, or migration code; creates storage fixtures or packaged persistence proofs; inspects or recovers an installed SQLite Profile; works with legacy browser-development data through EIDO_DATA_FILE; or removes private Profile data from Git/GitHub. Do not use for normal app startup or unrelated feature and UI work.
---

# Eido Profile Safety

Treat this skill as a development and incident-response guardrail. It is not a
runtime hook: normal app startup relies on Eido's implemented ownership,
compatibility, hydration, and recovery protections.

## Required Reading

Read `docs/foundations/persistence-layer.md` before taking storage actions. For
installed-path or compatibility work, also read
`docs/adr/0025-sqlite-profile-authority-blobs-and-portable-exports.md` and
`docs/adr/0029-electron-main-installs-one-profile-authority.md`. If storage code
changed or docs may drift, run `docs-sync` after implementation.

## Invariants

- Treat the installed SQLite Profile as private user data, not source code.
- Keep packaged authority beneath the platform app-data root at
  `Eido/profiles/default/eido-profile.sqlite`; Electron main and its utility
  owner control that path.
- Never commit real Profiles, WAL/SHM files, blobs, Portable Exports, recovery
  artifacts, legacy browser JSON, or local copies.
- Use disposable synthetic Profile roots for packaged tests and smoke proofs.
  Use disposable `EIDO_DATA_FILE` paths for browser-development tests and
  experiments.
- Treat the pre-Alpha `~/.eido/eido-v3-ideas.json` format as legacy
  browser-development data, not the packaged authority or an implicit SQLite
  migration boundary.
- Run migrations on copies first. Preserve cards, connections, outputs, runs,
  intent logs, assets, and metadata unless the user approves data loss.

## Workflow

1. For browser storage development or preview involving persisted data:
   - Use synthetic data or an explicit disposable `EIDO_DATA_FILE`.
   - Build and start the Vite server normally. Verify `/api/eido/status` only
     when the selected disposable path matters to the task.
   - Skip private-data preflight, backup, and Git scanning when the data is
     disposable.
2. For packaged Profile changes, migrations, or recovery:
   - Never point tests or development experiments at the installed Profile.
   - Use synthetic fixtures and the disposable-root `npm run desktop:smoke`
     proof for the packaged boundary.
   - Before an explicitly authorized destructive or format-changing write to
     real data, stop the owning Eido process and make a recoverable backup.
   - Add or update scrubbed fixtures for every supported storage shape.
   - Run migrations and compatibility tests against a copy, never the installed
     Profile.
   - Never use private Profile or legacy browser data as a committed test
     fixture.
3. For suspected missing boards:
   - Treat the symptom as a data-loss incident.
   - Inspect the installed Profile, owner sidecar, recovery points, blob store,
     and backups without opening the Profile through a second writer.
   - Recover into a separate copy first. Promote it only after validating
     logical records, hydration, and blob closure.
4. For Git/GitHub exposure:
   - Do not commit or push more private data.
   - Identify paths and commits, rewrite history with `git filter-repo` or BFG
     after coordination, force-push the repaired refs, and ask GitHub Support to
     remove cached or dangling sensitive data.

## Validation

For packaged Profile work, use focused native tests and `npm run desktop:smoke`
in proportion to the changed boundary. For browser storage work, verify
`/api/eido/status` only when an explicit disposable `EIDO_DATA_FILE` is part of
the task.

Before committing storage-related work, verify that no private Eido data is
tracked:

- `git ls-files | rg -i '(^|/)(eido-profile\.(sqlite3?|db)(-(wal|shm))?|eido-v3-ideas[^/]*\.json|eido-idea[^/]*\.json|recovered-board[^/]*\.json)$'`
  returns no matches.

Do not declare recovery or migration complete until the installed owner can
reopen, validate, and hydrate the expected Profile from the intended authority.
