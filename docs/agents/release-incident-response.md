# Release incident response

This is the active operating contract for standing release
maintenance and defects found after an Eido release is public. One principle
governs every response: **ship a forward hotfix; never roll back or mutate a
published release.** A final release may already have written a newer friend
data format, so moving an installation backwards is not a safe recovery action.

## Authority and boundaries

- [`maintenance-checks.mjs`](../../scripts/release/maintenance-checks.mjs)
  owns updater-health and public-artifact-integrity verdicts. The
  [`Weekly maintenance`](../../.github/workflows/maintenance.yml) workflow keeps
  them available only through `workflow_dispatch`; its schedule runs the
  dependency vulnerability audit without running this deferred release job. A
  nonzero manual result is fail-closed evidence for the investigation that
  requested it, not an ambient #448 gate.
- [`promote-release.mjs`](../../scripts/release/promote-release.mjs) owns final
  release verification and immutability. `abort` against a final release
  returns `BLOCK` with `final-release-is-immutable` and touches nothing. No
  rollback, asset replacement, release edit, or other published-byte mutation
  path exists in this tooling by design.
- [`desktop-release-captain.md`](desktop-release-captain.md) owns the active
  Plan → Seal → Certify → Publish release path, and owns recall. A hotfix is
  another run of that path, not a privileged incident-only publication path.
- Certificate-expiry maintenance is not yet automated. Since #696 there is a
  real macOS Developer ID certificate and an Apple notarization key that both
  expire, and an Ed25519 update-signing key with no expiry but a single point of
  failure. Nothing in this SOP watches any of them; an expiry surfaces as a red
  certification run, not as an alert. Windows has no certificate by decision.

The `session-control` skill owns agent and model selection.
The founder is not the release operator. Escalate only the founder boundaries
already named by [`release-profile.md`](release-profile.md).

## Get a current read

Start from the private source repository and preserve the first failing output:

```sh
git rev-parse HEAD
git status --short
node scripts/release/release-planning.mjs validate \
  --manifest release/planning/manifest.json
node scripts/release/maintenance-checks.mjs run \
  --repository limweili/eido-releases \
  --manifest release/planning/manifest.json \
  --policy release/public-repository/policy.json \
  --json
gh run list --workflow "Weekly maintenance" --branch main --limit 10
```

When deliberately dispatched, `PASS` means every expected live release
verified, or that both checks reported
the explicit non-alert `SKIP` / `no-live-release` state because no target has
ever become promotable and the public repository confirms no release
exists. An unplanned public release is `BLOCK`, not a skip. `BLOCK`, a provider
error, malformed output, missing evidence, or an unreadable check is an
incident signal for that manual investigation. An undispatched check creates
no release gate; a deliberately requested release re-derives current artifact
integrity before promotion.

## SOP 1: Classify without mutating

1. Re-run **Get a current read** at current `main`. Record the exact check,
   reason, expected version, source SHA, workflow run, and time.
2. `updater-health` checks the well-known `eido-update.json` and detached
   checksum through the installed updater's own allowlist, which since #976
   permits only the Eido-owned feed hostname `updates.eido.so`. It blocks on
   fetch, redirect, size, checksum, client-required JSON shape, trusted
   download-page URL, locked platform, or planned version, SHA, and
   platform-digest mismatch.
3. `public-artifact-integrity` delegates each expected live target to the
   Captain's existing `promote-release.mjs verify` path. It blocks unless the
   final, non-draft, non-prerelease release still matches the sealed platform
   digests recorded in planning evidence. It reads the retired public
   `limweili/eido-releases` repository, so for releases published after the move
   to Cloudflare R2 it reports only its non-alert `no-live-release` state. That
   is expected and is not evidence about the live feed; `updater-health` and the
   Captain's live-feed verification are.
4. Before promotion, investigate a red or required-but-missing manual run. Do
   not edit a public release to make the
   check green. If the fault is transient, rerun the same read-only command and
   retain both outcomes; if published bytes or metadata are defective, continue
   to SOP 2.

The release checks are manual-only through `workflow_dispatch`. The containing
workflow retains its weekly (`43 16 * * 0`) dependency vulnerability audit, but
the scheduled event skips this release job. Repository permissions remain
`contents: read`; a deliberately dispatched job going red is the alert, with no
external pager or webhook implied.

## SOP 2: Ship the forward hotfix

Take a fresh SemVer strictly greater than the defective version and bind it to
the fixed source SHA. Version selection follows
[SOP 1: Plan](desktop-release-captain.md#sop-1-plan) unchanged: plain
`MAJOR.MINOR.PATCH`, chosen by the Captain's deterministic rule. There is no
founder confirmation to wait for, in an incident or otherwise. Then run the
ordinary Captain sequence again:

1. [SOP 1: Plan](desktop-release-captain.md#sop-1-plan) declares the fresh
   version only after its new platform bytes are sealed.
2. [SOP 2: Seal](desktop-release-captain.md#sop-2-seal) freezes a new complete
   candidate pair. Never reuse, replace, or rebuild the prior release's assets.
3. [SOP 3: Certify](desktop-release-captain.md#sop-3-certify) binds new evidence
   to the fixed SHA and exact new candidate digests.
4. [SOP 4: Publish](desktop-release-captain.md#sop-4-publish) publishes the new
   version to the update feed and verifies the live result. Never replace a
   published artifact's bytes or run any downgrade path.

Publishing a higher version does not stop anyone already running the defective
one. When the defect warrants halting a running app, follow
[SOP 5: Recall a published release](desktop-release-captain.md#sop-5-recall-a-published-release)
after the fixed version is live. That is the one sanctioned way to repoint the
update metadata, and it adds a field to a newly signed manifest rather than
mutating a published release.

Accept only a green publication run whose live-feed verification passed for the
new version. Re-run the maintenance command before resolving the incident. If
the new candidate fails before publication, use the Captain's
[fail-closed abort](desktop-release-captain.md#sop-6-abort-fail-closed); if a
defect is found after publication, repeat this SOP with another greater version.

## SOP 3: Prove the invariant in a disposable repository

Generate a new incident proof transcript with:

```sh
node scripts/release/prove-incident-hotfix.mjs
```

The harness refuses to use `limweili/eido-releases` as a proof target. It uses
a disposable GitHub repository only when authenticated scopes guarantee both
creation and deletion, otherwise a disposable local bare repository. It runs
real planning and promotion CLIs for an initial release and a strictly greater
hotfix, re-fetches the original tag metadata and asset bytes before and after
the hotfix, requires their byte snapshot to remain identical, and proves an
attempted abort of the original final release returns
`final-release-is-immutable`. Cleanup runs even after failure, and the full
argv/exit/stdout/stderr transcript records the backend and verdict of every
leg.
