# Production release

Status: the production release/update lane and founder-confirmed macOS/Windows
canaries are complete. The canonical Friends Alpha product record remains
tracked by [#448](https://github.com/limweili/eido/issues/448); founder-owned
sharing remains [#695](https://github.com/limweili/eido/issues/695).

> **Reconciliation — 2026-07-22.** Several documents preserve superseded research
> as historical evidence; their dated banners identify the current framing. The
> precedence order is stated with the live-graph rule below.

This track defines how Eido becomes a local-first Electron application for an
all-or-nothing Apple Silicon macOS and Windows x64 Friends Alpha. It also records
the production evidence, persistence, migration, signing, updater, and autonomous
release-operation decisions behind that plan.

## Reading order

1. `01-electron-reference-projects.md` — production desktop precedents and
   failure modes.
2. `02-storage-migration-recovery.md` — durable local persistence and the Alpha
   v1 compatibility floor.
3. `03-autonomous-release-operations.md` — release state machine, SOPs, and
   founder-coaching boundary.
4. `04-adversarial-synthesis-and-spec.md` — historical source-grounded release
   synthesis, reconciled to the canonical #448 issue body.
5. `05-ticket-fanout.md` — historical pre-r2 ticket fan-out; use #448's
   Execution fan-out map for current work.
6. `06-cross-epic-dependency-contract.md` — reconciled historical hand-off and
   the live #520/#528 certification dependency contract.
7. `07-tldraw-macos-artifact-forensics.md` — exact macOS DMG/app/update,
   signing, notarization, and hardening evidence from tldraw offline `v1.10.0`.
8. `08-tldraw-windows-artifact-forensics.md` — exact Windows NSIS/update,
   Authenticode, persistence, and packaged-security evidence.
9. `09-tldraw-source-release-pipeline.md` — current versus historical source,
   CI, update-channel, and SQLite/archive behavior.
10. `10-tldraw-offline-benchmark-synthesis.md` — #448 comparison and historical
    persistence reasoning, annotated with the resolved SQLite decision.
11. `12-sqlite-friends-alpha-amendment-draft.md` — tracker amendment history and
    its repository-doc reconciliation note.
12. `13-windows-code-signing-provider-shortlist.md` — current primary-source
    comparison of eligible cloud/HSM Windows signing paths for an Australian
    organization using GitHub-hosted runners, with DigiCert first, SSL.com as
    fallback, and Microsoft Artifact Signing geographically excluded.
13. `14-cloudflare-pages-preview-branch-controls.md` — current branch-control
    policy for keeping `main` production delivery while stopping automatic
    feature-branch previews, including GitHub-check and public-preview caveats.
14. `15-macos-0.1.7-to-0.1.8-update-incident.md` — historical field diagnosis of
    the shutdown-handshake failure that stopped before the detached macOS swap.
15. `16-standard-macos-updater-architecture.md` — primary-source comparison of
    Electron/Squirrel, electron-updater, Sparkle, and the bespoke DMG swap,
    with the accepted standard-helper ownership boundary and its now-complete
    first installed field proof.
16. `17-macos-0.1.17-to-0.1.18-field-proof.md` — the dated, updater-only record
    of the successful macOS consent-click → Squirrel replacement → automatic
    relaunch proof and the founder-confirmed Windows follow-up.

The standalone SQLite Profile Authority specification and ticket DAG live under
`research/06-sqlite-profile-authority/`.

The live native GitHub blocked-by graph is executable truth. Where it conflicts
with this track, precedence is: (1) that live graph, (2) the canonical #448 issue
body (spec v2), then (3) these documents. These documents explain the decisions,
ownership, and fail-closed behavior; agents must re-derive live tracker state
before beginning a blocked ticket or producing a candidate.
