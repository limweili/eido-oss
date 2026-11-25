# Release profile - Eido

<!-- merge-captain:conditional-gates=docs/agents/release-gates.json -->

This is the thin Eido delivery adapter. It records durable repository facts
that are difficult or unsafe to rediscover by trial and error. It does not
restate generic engineering practice, model or execution topology, current run
state, or CI/CD implementation.

When sources disagree, use the explicit goal and safety boundaries first, then
live repository and tracker state. CI/CD policy belongs to
[`devops-operating-system.md`](devops-operating-system.md); its executable
owners are the current package scripts and workflows. Repair drift at the
owner instead of copying another rule here.

## Repository and delivery identity

- Repository: `limweili/eido`; shared branch: `main`.
- Preserve unrelated work in the local production checkout. Use an isolated
  checkout when delivery work can proceed there.
- The ordinary merge convention is squash with a plain-language title ending
  in the issue reference. Deliberate stacked changes may use merge commits when
  preserving their dependency relationship is necessary.

## Stacked pull requests

Verified on 2026-08-28: `main` has no `required_pull_request_reviews`, so no
approval-dismissal setting can strip approvals from the upper layers of a
stack. Nothing needs turning off today. If required approvals are ever added to
`main`, leave **dismiss stale approvals** and **require approval of the most
recent reviewable push** off, or every partial merge will invalidate the
approvals above it.

The real per-layer cost is the required gate: `main` requires five checks
(`Required gate`, `Browser interactions`, `Native desktop proof scope`, and the
two `Native desktop proof` platform jobs), and each layer is checked against the
trunk independently. An N-layer stack pays that gate N times. Keep stacks
shallow rather than weakening the gate; `required_status_checks.strict` is
false, so layers do not additionally have to be up to date with `main`.

## Founder boundary

The founder is hands-off for delivery mechanics. Resolve repository state,
CI/CD operation, failure triage, routine conflicts, review routing, and cleanup
without making the founder a technical messenger. Escalate only a decision
about money, product behavior or architecture, private-data exposure,
irreversible loss, or unavoidable identity authority.

Only artifacts produced by the packaged-certification lane (`release:package`
via `release/packaged/production-builder.mjs`) may ever be distributed outside
the team. Local `desktop:package:dir` / desktop-proof smoke builds ship the
full unsanitized repo `package.json` and proof fixtures; they are internal
diagnostics and must never be handed to a friend or published.

The active distribution boundary is immutable release artifacts and signed
update manifests published directly to Cloudflare R2 (`updates.eido.so`) plus
the standalone non-executable HTML/CSS marketing and legal site on Cloudflare Pages
(`eido.so` from `site/`).
Release publishing uses the `release-publish` GitHub environment containing
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`,
plus the update-manifest signing key.
[`Desktop Release Captain`](desktop-release-captain.md) is the current
release runbook; [`Release incident response`](release-incident-response.md)
owns forward-only corrections. The public marketing/legal site lives in `site/`
and deploys automatically via Cloudflare Pages. Its two download buttons link to
stable addresses (`Eido-latest-arm64.dmg`, `Eido-latest-x64.exe`) that the
publication workflow republishes every release, so the page needs no per-release
edit and must not acquire one. Never compare or restore that content from
`release/public-repository/template/`, or make those legacy bootstrap pins a
publication gate.

Publishing to the public `limweili/eido-releases` repository is retired. No
workflow calls `promote-release.mjs`; it stays only because the incident-response
immutability proof still uses it.

The historical `0.1.0-alpha.7` and `0.1.0-alpha.8` releases remain immutable
evidence, not current instructions or authorization. Every new release uses a
plain `MAJOR.MINOR.PATCH` selected by the Captain's deterministic version rule
(the next patch above the highest already recorded, unless the founder names
one), exact-current-main packaged certification, and one signed publication to
the update feed. Publish a higher version for every correction; never mutate
published bytes or move a Profile to an older app.

## CI/CD authority

Read [`devops-operating-system.md`](devops-operating-system.md) for the required
gate, check classifications, budget, browser and performance evidence, merge
pacing, release artifacts, and local-production promotion. Treat its measured
numbers as dated evidence and its explicit decisions as current policy until a
new audit changes them.

Do not duplicate the required command's steps in a lane contract or helper.
Reuse current proof and rerun only what a relevant change invalidates. Local
browser or timing results are not authoritative merely because they are
available; use the evidence source defined by current DevOps policy.

Evidence policy first principles are ADR 0028 (risk-proportional evidence over
fixed ceremony); when a gate, SOP, or lane contract demands effort out of
proportion to the change's risk, re-derive from that ADR rather than complying
or silently skipping. The `devops-coach` delivery-health review runs on a
standing cadence - epic kickoff, epic closeout, and weekly during an active
epic - and must report harness share and evidence yield alongside the
constraint diagnosis.

Owner-authorized research, report, retro, skill, SOP, and agent-instruction
merges may use `docs-only-merge` instead of product CI when its deterministic
scope check proves the complete diff cannot affect production code, builds,
workflows, dependencies, release artifacts, public sites, or runtime data. The
specialization preserves Merge Captain's live-state and authorization contract,
uses focused exact-head validators, carries `[skip ci]` on both the PR head and
the squash commit, and verifies that no hosted runner started. Any mixed or
ambiguous diff returns to the ordinary required gate.

Do not trust a pull request gate from a rerun job or an immediate close-and-reopen
cycle without verifying its base ref. On GitHub Actions, rerunning a failed job
reuses that workflow run's original synthetic merge ref, and reopening a pull
request can fire a new run before GitHub recomputes the merge ref after main has
moved. A green check can therefore test a merge into a stale base rather than
the current main tip. Catch this by checking the checkout step's merge line or
the printed commit log to confirm the base commit matches the current main tip
before accepting the gate. If the base is stale, wait for GitHub to recompute
the merge ref or push an empty-diff refresh to trigger a fresh pull_request
event, rather than rerunning failed jobs.

## Toolchain and lockfile compatibility

`package.json` declares the supported Node and npm ranges. GitHub Actions
uses `.github/node-version` to select a maintained Node release line.
Certification records the exact Node and npm versions on each native runner
and verifies them against the package's embedded provenance.

Run local commands with any supported Node and npm versions. If the
toolchain check reports a mismatch, update the local toolchain before
changing the lockfile or evaluating a test result.

- If dependency metadata is outside the requested outcome, preserve
  `package.json` and `package-lock.json` byte-for-byte.
- If dependencies must change, keep manifest and lockfile changes together and
  use npm 11 to write the lockfile.
- Preserve the original runtime provenance of historical performance evidence;
  a toolchain transition does not retroactively rebaseline measurements.

## Private Profile safety

- The real local authority is the installed SQLite Profile beneath the platform
  app-data `Eido/profiles/default/` root. The database, WAL/SHM files, blobs,
  recovery artifacts, Portable Exports, and legacy browser JSON are private and
  never belong in Git, test artifacts, or ordinary diagnostics.
- The `eido-profile-safety` skill governs development, testing, migration,
  recovery, and incident-response work involving Profile storage, legacy
  browser-development data, and representative-data compatibility. It is not
  invoked for normal app startup or unrelated feature work.
- Use synthetic fixtures by default. Packaged work uses disposable Profile proof
  roots; browser-development tests use disposable `EIDO_DATA_FILE` paths. Real
  user data is used only when explicitly authorized and risky writes are proven
  against a recoverable copy first.
- `npm run desktop:smoke` is a Windows x64/macOS arm64, disposable-root,
  unpacked proof of the packaged Electron boundary and installed Profile. It
  reads the packaged runtime and fuses directly, requires the Windows proof
  executable to be `NotSigned` and the macOS proof to have only its required
  ad-hoc seal, and never authorizes an installer, publisher identity,
  notarization, or access to the real save. A fresh exact JSON CLI request must
  return typed `not-found` without Profile artifacts and match the exact platform
  envelope: one native CRLF then one JSON line on Windows, or the JSON line alone
  on macOS. The GUI then hydrates,
  performs one real renderer Mod action, and joins normal checkpoint/shutdown.
  A bounded CLI query observes that Card and exact revision only after its
  existing-only utility joins. Before its first navigation, the final GUI
  launch enables Electron's offline emulation on the exact window-owned
  Session, reopens the unchanged synthetic Profile, and checks that Mod and
  revision. Packaging verifies the direct macOS MCP entry or the Windows x64
  console SEA/fuse/signable envelope. Local execution records the persistent
  fixed-path MCP journey as non-authoritative. The required hosted job declares
  its ephemeral OS-user scope, requires the native `Eido` root absent and on the
  same filesystem as the already-closed synthetic Profile, then renames that
  Profile into place so its SQLite authority and owner-sidecar physical identity
  remain unchanged. It exercises the unmodified production MCP entry and removes
  only that owned root. All disposable roots are removed before the one retained
  `proof-evidence.json` artifact is written; no local save participates.
- `npm run release:package` and `npm run release:certify` belong to manual
  packaged certification. A new run produces exact-main paired evidence and
  retains the DMG, macOS updater ZIP, and NSIS installer for the confirmed
  release version. Since #696 the macOS leg also signs with Eido's Developer ID,
  hardens, notarizes and staples both the app and outer DMG, then verifies its
  own output before anything is uploaded
  ([macOS release signing](../release/macos-signing.md)). Windows stays unsigned
  by decision. It is still not an updater or promotion ceremony.
  Certification uses the fixed production Profile location only on a declared
  GitHub-hosted ephemeral OS user and refuses local/self-hosted execution. It
  produces real DMG/ZIP/NSIS candidates and a paired digest-addressed manifest; it
  never promotes the proof-only `desktop:smoke` output. See
  [Packaged certification evidence](packaged-certification.md).

## What does not belong here

Keep model selection in the `session-control` skill, current ownership and
progress in live state, tool quirks in their owning operational docs, and
one-off incidents in retrospectives. Do not maintain fixed hotspot lists,
mandatory worker counts, per-lane test recipes, or alternate CI runbooks in
this profile.
