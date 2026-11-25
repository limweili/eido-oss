# macOS 0.1.17 → 0.1.18 installed updater field proof

Status: **PASS**, recorded 2026-08-21 after the first Squirrel-enabled
in-place update was exercised on the founder's Apple Silicon Mac. This note is
an updater/release record only. No Profile contents, canvas content, database,
WAL, blob, or private app-data path was inspected.

## Acceptance claim

One consent click in an installed 0.1.17 caused Eido to save and drain its
runtime, hand the verified update to native Squirrel, quit, replace the app,
and automatically relaunch as 0.1.18 without a second user action.

## Release identities

| Item | Value |
| --- | --- |
| Old installed version | 0.1.17, manually bootstrapped from the certified 0.1.17 DMG |
| New installed version | 0.1.18, confirmed in `/Applications/Eido.app` and Finder Info |
| 0.1.18 source | `19392f35cb2a27fdeade2bc529ba97b0e2e73543` |
| Certification | [run 32437532065](https://github.com/limweili/eido/actions/runs/32437532065), set `eido-cert-v2-32437532065-1` |
| Publication | [run 32438193702](https://github.com/limweili/eido/actions/runs/32438193702) — green live verification |
| DMG SHA-256 | `39133770efd17b83dba07d8f00bc0ea2e64e4b2494855fc2457048e8028b0ffd` |
| Updater ZIP SHA-256 | `7c1333ec8341f9bfc8a4803eb3bb1d87d8031ad5235e538d79b217159c9a1f17` |
| Windows EXE SHA-256 | `61f97a7971a69f48ed31962dbdc1674cdf9c1c79b49b48d7a34345134330c1ef` |

## Observed sequence

The user clicked **Update now** once at 2026-08-21 02:38:25Z. The updater log
then recorded the following durable order:

1. The main-owned update surface cleared the handled 0.1.18 prompt and pulled
   revision 2 with no remaining surface.
2. Renderer preflight established a checkpoint and became ready.
3. Terminal seal, Agent broker, AI harness, live gateway, and Profile utility
   close/join completed; the terminal Profile drain completed.
4. Native staging started at 02:38:38Z and reported ready at 02:38:40Z.
5. The old process exited; Squirrel replaced the bundle and relaunched Eido.
6. A different process came up as 0.1.18 (PID 13103 in the captured updater
   record), with one visible native window.
7. `eido-update.log` recorded `EIDO_UPDATE_COMPLETED: now running 0.1.18`
   at 02:38:50Z. The attempt journal was absent/reconciled.

The legacy custom swap diary was absent, as expected: the production macOS
last mile is now Electron's Squirrel.Mac/ShipIt path, not the retired detached
DMG shell.

## Independent package checks

- The installed app passed deep/strict code-signature verification and
  Gatekeeper assessment.
- The app and embedded ShipIt helper carried the same Developer ID Team ID
  `5NKAWT8L78`.
- The signed-feed, paired DMG+ZIP certification, ZIP metadata, app-tree
  equality, and live publication checks passed before the click.

## What this proves

This closes the end-user acceptance criterion for the first consent-click
Squirrel path: **prompt → Profile-safe drain → native staging → quit → bundle
replacement → automatic relaunch on the new version**.

It also proves that the durable update-surface repair survived the installed
bootstrap boundary well enough for the user to receive and act on the 0.1.18
prompt.

## Windows follow-up

The founder subsequently confirmed the installed Windows x64 N-to-N+1 update
and restart path manually, and accepted the Windows human canary. The live
distribution source for both platforms is now the immutable Cloudflare
R2-backed `updates.eido.so` path; GitHub Releases and GitHub Pages are not part
of the current release contract. This closes the Windows field-update and
human-canary tickets (#692 and #743) on founder evidence.

## What this does not prove

- It is not a content-level Profile preservation proof; the validation avoided
  private Profile data by design.
- It is not an interruption/power-loss matrix, standard-user authorization
  matrix, renamed/translocated app matrix, or offline-reopen proof.
- It is one Apple Silicon field run, not a claim about every supported macOS
  installation shape.

The update and human-canary tickets #691, #692, #741, and #743 are now closed
on founder-confirmed field evidence. The mature release-operations epic #740
is closed; #448 remains the canonical Friends Alpha product record and #695
remains the founder-owned decision to share a friend-facing link.
