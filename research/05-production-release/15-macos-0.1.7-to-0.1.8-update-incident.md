# macOS 0.1.7 to 0.1.8 update incident

Status: historical incident record. Diagnosed from the founder's field attempt
on 2026-08-20; the ordering race was reproduced and repaired in the accompanying
source changes. The later bespoke-updater failure and its repair are recorded in
`16-standard-macos-updater-architecture.md`; the first successful installed
Squirrel field proof is recorded in `17-macos-0.1.17-to-0.1.18-field-proof.md`.

## Executive finding

The certified 0.1.8 DMG downloaded, verified, and staged. The detached macOS app
swap never started. Eido 0.1.7 exited with status 1 while its installed Profile
utility was closing during the `Saving your work` stage, leaving the update
journal at `staged`. The next manual launch correctly found that incomplete
attempt and showed the native manual-download fallback.

The strongest explanation is a close-response/exit ordering race at the Profile
utility boundary. The utility posts its successful `close` response and then
calls `process.exit()` from `setImmediate`. Electron's `parentPort.postMessage()`
returns no delivery acknowledgement. If the main process receives the utility
`exit` event before the queued close response, `profileUtilityClient` classifies
the intentional exit as `early-exit`. The installed host forwards that terminal
loss to `failClosed`, which exits Eido with status 1 before the update handoff can
record `drained`, start the swap, or write its swap diary.

Confidence: **high** for the stopped boundary and race shape; **moderate-high**
that message/exit ordering is the initiating mechanism. A repair should first
turn the exact ordering into a deterministic integration test.

## Field timeline (AEST)

| Time | Evidence |
| --- | --- |
| 22:13:23 | A fresh per-attempt DMG staging root was created. |
| 22:13:29-31 | The verified `Eido.app` was promoted under the staging root. |
| 22:13:35 | The update surface showed `Checking`. |
| 22:13:49 | The update surface showed `Saving your work`. |
| 22:13:52.759 | The Node utility process that owns the installed Profile exited. |
| 22:13:52.874 | macOS launchd recorded the Eido main process exiting via `exit(1)`. |
| 22:16:17 | The founder manually launched the still-installed 0.1.7 app. |
| 22:16:20 | The durable updater log recorded `EIDO_UPDATE_DID_NOT_COMPLETE: stopped at staged for 0.1.8`. |
| 22:16:30 | The native `Eido could not update itself` dialog was visible. |

## What the artifacts prove

- `/Applications/Eido.app` remained version 0.1.7. The installed bundle was not
  replaced or partially overwritten.
- The update journal's last durable stage was `staged`, not `drained` or
  `handoff_started`.
- No `eido-update-swap.log` exists. A launched 0.1.7 swap shell opens that diary
  before the old app exits, so its absence is strong evidence that the swap was
  never spawned.
- The staging directory had one `.discarded-*` suffix from the failed attempt's
  cleanup and acquired another during the next launch's startup sweep. This is
  consistent with the drain rejecting while the independent fatal path raced
  the updater's own failure reporting.
- macOS recorded no Eido crash report. It recorded an explicit `exit(1)`, which
  matches `main.ts`'s `failClosed` path rather than the updater's successful
  `app.exit(0)` handoff.
- The manually reopened 0.1.7 app and its Profile helper are running. No Profile
  contents were inspected, and there is no observed evidence of Profile
  corruption. That is not a substitute for a content-level integrity proof.

## Source path that permits the race

1. `profileUtilityEntry.ts` calls `parentPort.postMessage(response)` and schedules
   `process.exit(exitCode)` with `setImmediate`.
2. Electron documents `parentPort.postMessage()` as a void send operation and
   documents `UtilityProcess` `message` and `exit` as separate events; it does
   not document a delivery acknowledgement or a guarantee that a queued message
   is observed before process exit ([parentPort](https://www.electronjs.org/docs/latest/api/parent-port),
   [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)).
3. `profileUtilityClient.ts` sets `expectedExit = true` only after it receives
   and correlates the successful close response. An earlier `exit` event becomes
   `ProfileUtilityClientError('early-exit', ...)`.
4. `installedProfileHost.ts` forwards unexpected terminal loss to `main.ts`.
5. `main.ts` calls `failClosed`, ultimately `app.exit(1)`.
6. `updateInstallHandoff.ts` cannot advance from `staged` to `drained` until the
   joined Profile shutdown returns its flushed receipt, so the swap is never
   launched.

The 0.1.7 and 0.1.8 release source trees are identical across these lifecycle
files. Installing 0.1.8 manually does not itself remove this defect for the next
update.

## Ruled out or materially weakened

- **Bad release artifact, checksum, signature, or notarization:** staging was
  reached only after those gates passed.
- **Detached swap failure:** no handoff stage and no swap diary; the app exited
  before that boundary.
- **macOS application crash:** no diagnostic report, and launchd recorded an
  explicit status-1 exit.
- **Cloudflare preview settings:** update assets were fetched from the signed
  production release path; preview branch controls are unrelated.
- **The screenshot action as root cause:** screen reconfiguration happened near
  the exit, but the renderer child remained alive until main exited. It is not
  evidence of a renderer crash.

## Repair and acceptance boundary

Do not fix this by delaying `process.exit()` for an arbitrary number of
milliseconds. The protocol needs an acknowledged shutdown boundary.

A two-phase protocol now removes the ordering assumption:

1. The utility closes SQLite and sends the successful close response, but does
   not immediately exit.
2. Main receives and correlates that response, thereby owning proof that the
   Profile is flushed and closed.
3. Main marks the exit as expected and sends a correlated
   `close-acknowledgement` message.
4. Only that acknowledgement permits the now-idle utility to exit cleanly; main
   then joins the exit through the existing lifecycle boundary.

The client regression was first observed red because no acknowledgement was
sent. It is green with a transport that emits `exit` synchronously from the
acknowledgement send, proving expected-exit state is armed before the child can
leave. The entry test independently proves that a successful close response no
longer exits until its matching acknowledgement arrives. The focused utility,
host, router, and update-coordinator suite passed 99 tests, and
`npm run desktop:smoke` exercised the actual packaged utility process against a
disposable Profile root with both launches reporting `logicalClose: true` and
`utilityJoined: true`.

The remaining acceptance boundary at the time of this incident was:

- the macOS update flow reaches `handoff_started`, writes `EIDO_SWAP_*` evidence,
  replaces the bundle, and relaunches the target version; and
- the full test suite remains green.

Do not rerun this historical proof against the founder's real Profile. Use the
repository's disposable packaged-proof boundary for development. Because the
updater that performs an installation is the already-running version, a manual
bootstrap was required before the first Squirrel-enabled installed proof. That
bootstrap and the subsequent 0.1.17 to 0.1.18 automatic relaunch are now
complete; the old 0.1.9 to 0.1.10 sentence is historical, not current acceptance
guidance.
