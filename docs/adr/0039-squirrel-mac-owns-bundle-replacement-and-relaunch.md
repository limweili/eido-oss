# Squirrel.Mac owns macOS bundle replacement and relaunch

Status: accepted

ADR 0032 established Eido's signed update authority and chose a custom DMG
swap for the macOS last mile. Two field failures showed that Eido must keep its
Profile drain explicit, but primary-source review also showed that a detached
shell cannot safely reproduce the signed helper, launchd, rollback, running-app
and relaunch behavior already maintained by Electron's Squirrel.Mac runtime.

## Decision

This ADR supersedes only ADR 0032 decision 5 and its rejection of
`electron-updater`. ADR 0032 decisions 0–4 and 6 remain accepted.

Eido keeps authority over its Ed25519-signed manifest, freshness, recall,
consent UI, diagnostics, and the full joined Profile drain. On macOS,
`electron-updater` 6.8.9 (the version from electron-builder 26.15.3) and
Electron's native Squirrel.Mac updater own bundle replacement, restoration,
process termination, and relaunch.

The safe boundary has three ownership states:

1. With `autoDownload` and `autoInstallOnAppQuit` disabled, Eido cross-checks
   exactly one provider ZIP entry and the downloaded ZIP against the signed
   manifest's version, basename, byte count, SHA-256, and SHA-512 while the app
   remains fully live.
2. After consent, Eido synchronously claims quit ownership, reversibly pauses
   external and renderer Agent admission, joins already accepted mutations,
   and establishes a flushed baseline while later renderer commits are held.
   It then freezes renderer mutation, captures the final state, closes the
   remaining producers, and accepts only the Profile receipt correlated to
   that final checkpoint. Graceful utility close remains preferred; after that
   exact receipt exists, a bounded forced utility join that reports a clean
   exit is also terminally safe because no writer or unflushed mutation
   remains. A non-clean or failed join still blocks staging. A failure before
   raw native staging may recover or
   relaunch the intact old app because Squirrel is still definitely unarmed.
3. Only after the terminal receipt, Eido asks raw Electron `autoUpdater` to
   stage the cached ZIP through electron-updater's authenticated loopback
   proxy. A bounded threshold changes the UI to “still preparing” but does not
   cancel the long-lived readiness listener. After raw staging begins, any
   timeout or error is potentially armed: Eido keeps the quiesced process alive
   and never calls ordinary quit, `app.exit()`, or `app.relaunch()`. Native
   `before-quit-for-update` is the sole special-quit commit; after native
   `update-downloaded`, Eido calls `MacUpdater.quitAndInstall()` exactly once.

The release lane continues to ship a DMG for people and additionally ships one
arm64 ZIP plus `latest-mac.yml`. The app is signed, notarized, and stapled before
both containers are constructed. Certification binds the DMG and ZIP to the
same source, version, signed app tree, immutable sizes and digests; publication
copies only those explicitly verified bytes. Eido's signed manifest remains
the authorization source. Provider metadata is necessary transport metadata,
not a second release authority.

## Consequences

- Crossing from the custom engine requires one manual bootstrap install. The
  installed old version always owns the update attempt.
- A failed terminal Profile join leaves native Squirrel unstaged, so fail-closed
  cleanup may relaunch the intact old bundle. Once raw staging is invoked,
  timeout, error, renderer failure, and Profile failure all retain the process;
  none may schedule a competing relaunch or ordinary exit.
- An update-owned forced utility join after the exact terminal receipt is not
  an unexpected authority loss. It must not recursively enter the shell-fatal
  observer; explicit close failure, receipt mismatch, or failed process join
  remains terminal.
- Windows keeps its existing signed-manifest, verified NSIS, joined-drain and
  `app.exit` handoff unchanged.
- The custom macOS swap and DMG verifier are no longer production dependencies.
  The first post-bootstrap installed field proof completed on 0.1.17 → 0.1.18;
  the old modules remain only as compatibility/cleanup history until a separate
  removal change is authorized.
- Sparkle remains the fallback only if Squirrel cannot pass the installed
  two-release acceptance matrix.

## Not chosen

- Further hardening the detached shell swap, because that would continue
  reimplementing native update lifecycle and security behavior.
- Staging Squirrel before the final Profile join, because a later failure exit could
  install an update without flushed Profile evidence.
- Adopting Sparkle immediately, because Electron already embeds the narrower
  supported updater required here.
