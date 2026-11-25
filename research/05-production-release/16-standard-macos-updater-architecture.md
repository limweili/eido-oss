# Standard macOS updater architecture after the 0.1.9/0.1.10 field failures

Status: recommendation recorded 2026-08-21 after the 0.1.9-to-0.1.10 field
exercise and implemented in the 0.1.11 bootstrap release. The 0.1.11-to-0.1.12
installed exercise confirmed that the standard updater remained safely
unarmed when Eido's Profile terminal drain failed, and supplied the exact
utility-join diagnosis recorded below. The first installed acceptance proof
then completed on 2026-08-21: certified 0.1.17 updated to certified 0.1.18
after one consent click, with automatic replacement and relaunch. The dated
field record is in `17-macos-0.1.17-to-0.1.18-field-proof.md`. Full disposable
Profile-content preservation and interruption testing remain separate open
acceptance work, not claims made by that click/relaunch proof.

## Executive decision

Retire Eido's detached `/bin/sh` DMG swap as the macOS installation and
relaunch engine. Keep Eido's signed release policy, consent UI, recall rules,
diagnostics, and Profile drain, but give bundle replacement, rollback, and
relaunch to Electron's supported Squirrel.Mac path. In this repository the
least disruptive supported route is the `electron-updater` `MacUpdater` that
matches the pinned `electron-builder` release; it downloads and verifies the
update archive, then hands it to Electron's built-in `autoUpdater`, which is
Squirrel.Mac on macOS.

This is a change in ownership, not a request for another patch to the shell
script:

| Concern | Owner after the change |
| --- | --- |
| Signed feed, release recall, blocked/minimum versions, user consent | Eido |
| Download progress and certified archive checksum | `electron-updater`, cross-checked against Eido's signed manifest |
| Profile admission stop, GUI checkpoint, SQLite flush, utility join | Eido |
| Waiting for the old app, replacing the bundle, restoring on failure, relaunching | Electron/Squirrel.Mac ShipIt |
| Post-launch version reconciliation and person-visible failure | Eido |

Do not adopt Sparkle 2 as the immediate repair. Sparkle is the stronger
general-purpose native alternative and confirms the same architectural
lessons, but adding its framework, helpers, native bridge, custom user driver,
signing, and release feed to an Electron application is a much larger change
than using the supported updater already embedded in Electron. Reconsider
Sparkle only if Squirrel cannot pass the acceptance matrix below.

## What the live attempt proves—and what it does not

The 0.1.9-to-0.1.10 attempt did **not** reach the detached shell, bundle move,
or relaunch. Its durable attempt state stopped in Eido's full Profile drain,
and there was no swap diary. Replacing the shell with Squirrel would not fix
that observed stop: both installers need Eido to finish quiescing and flushing
its Profile before the running application may disappear.

There are therefore two independent obligations:

1. **Eido persistence phase:** establish a recoverable flushed baseline, hold
   later renderer commits, then atomically freeze and join the exact final
   checkpoint before raw native staging. Failure here keeps the old app
   installed and must never call an updater.
2. **Platform install phase:** after a `flushed` receipt and joined utility,
   give a natively staged archive to the updater and let its signed helper own
   app termination, bundle replacement/restoration, and relaunch.

The first incident (0.1.7-to-0.1.8) identified a close-response race that was
already fixed in 0.1.9. The later 0.1.9-to-0.1.10 log used the same broad
`drain-failed` label but cannot identify whether AI harness, Agent broker, live
gateway, renderer checkpoint, or Profile utility initiated it. The replacement
therefore uses named substages and a recoverable preflight rather than claiming
the earlier cause recurred. The official updater evidence changes phase 2's
design; it does not excuse or conceal persistence failure.

The 0.1.11-to-0.1.12 installed exercise supplied the missing substage evidence.
Renderer seal, Agent broker, AI harness, and live gateway all completed; the
attempt reached `profile-utility-close/join`, then emitted the client's own
`Profile utility termination was requested` sentinel and aborted before native
staging. The defect was a lifecycle self-conflict: after accepting the exact
final Profile receipt, the router already boundedly terminated an unresponsive
utility, while the host simultaneously reported that intentional termination
as unexpected shell-fatal authority loss and discarded the valid receipt.
The repair makes that forced join update-owned only after the exact flushed
receipt and closed admissions exist. A successful join keeps the receipt;
explicit close failure, receipt mismatch, or failed join still blocks staging.
Electron documents that `utilityProcess.kill()` terminates and reaps the child,
with completion reported by `exit`
([Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process));
SQLite transactions remain atomic across process interruption
([SQLite atomic commit](https://www.sqlite.org/atomiccommit.html)).

## The failure class the earlier repair did not remove

The current macOS path mounts a DMG, copies the app, spawns `/bin/sh` detached,
waits for Eido's PID, performs `mv`/`ditto` operations, and calls `open -n` to
relaunch ([current swap source](../../electron/macosAppSwapPort.ts)). The code
has accumulated valuable guards, logs, bounded waits, and restoration logic,
but it is still a shell process implementing an application installer.

That differs from the platform contract in two material ways.

First, Apple defines application-bundle update permission in terms of the Team
ID and signing identifier of the **process or installer package that writes the
bundle**. Signed apps from the same developer are allowed by default;
`NSUpdateSecurityPolicy` can narrow or extend that set
([Apple: `NSUpdateSecurityPolicy`](https://developer.apple.com/documentation/bundleresources/information-property-list/nsupdatesecuritypolicy)).
The process executing Eido's final `mv` is `/bin/sh`, not a nested updater
helper signed as Eido. That does not prove App Management rejected the observed
attempt—the swap diary and macOS TCC log are still needed for that claim—but it
is a structural policy mismatch and a credible unexamined failure class.

Second, a reliable self-update helper needs OS-lifecycle behavior, not only
filesystem correctness. Electron 43.2.0 carries Squirrel patches specifically
for cases Eido would otherwise have to rediscover:

- launchd can enter an "on-demand-only" mode while a macOS update is pending;
  Electron explicitly triggers ShipIt's Mach service so the installer starts
  in that state
  ([Electron's Squirrel patch](https://github.com/electron/electron/blob/v43.2.0/patches/squirrel.mac/fix_trigger_shipit_mach_service_after_smjobsubmit_to_unblock.patch));
- ShipIt rechecks immediately before bundle replacement that no matching app
  instance has appeared
  ([final-mile running-app patch](https://github.com/electron/electron/blob/v43.2.0/patches/squirrel.mac/fix_abort_installation_attempt_at_the_final_mile_if_the_app_is.patch));
- relaunch uses a helper spawn that disclaims inherited TCC responsibility on
  macOS 11 and later
  ([relaunch patch](https://github.com/electron/electron/blob/v43.2.0/patches/squirrel.mac/refactor_use_posix_spawn_instead_of_nstask_so_we_can_disclaim_the.patch));
- the target path is canonicalized and pinned before installation
  ([canonical-target patch](https://github.com/electron/electron/blob/v43.2.0/patches/squirrel.mac/fix_resolve_target_bundle_path_once_at_start_of_install.patch)); and
- incoming nested code is checked with strict code-signature validation
  ([nested-signature patch](https://github.com/electron/electron/blob/v43.2.0/patches/squirrel.mac/fix_use_kseccschecknestedcode_kseccsstrictvalidate_in_the_sec.patch)).

These are exactly the kinds of conditions a detached shell cannot infer from
"the child spawned" or "the old PID disappeared." Repairing the custom path to
parity would mean building and signing a native helper, registering and
triggering it with launchd, persisting resumable install state, handling
authorization and TCC identity, detecting every running instance, validating
nested code, restoring the prior bundle, and relaunching through macOS-native
APIs. That is a reimplementation of Squirrel or Sparkle.

## What the standard Electron path actually owns

Electron documents that its macOS `autoUpdater` is built on Squirrel.Mac and
requires a signed application. `quitAndInstall()` is called only after
`update-downloaded`; Electron emits `before-quit-for-update`, closes every
window, and lets the updater install and restart the app
([Electron 43.2 autoUpdater API](https://github.com/electron/electron/blob/v43.2.0/docs/api/auto-updater.md)).
The C++ binding shows that the special event is emitted before windows close,
and the native updater is invoked only after the window list is empty
([Electron implementation](https://github.com/electron/electron/blob/v43.2.0/shell/browser/api/electron_api_auto_updater.cc)).

Squirrel's ShipIt process persists the requested update, waits for every
matching app instance to terminate, records an owned copy of the installed
bundle, retries interrupted installation at most three times, restores the
owned bundle when aborting, and launches the target after either the install or
the restorative path
([ShipIt source pinned by Electron 43.2](https://github.com/Squirrel/Squirrel.Mac/blob/0e5d146ba13101a1302d59ea6e6e0b3cace4ae38/Squirrel/ShipIt-main.m),
[installer source](https://github.com/Squirrel/Squirrel.Mac/blob/0e5d146ba13101a1302d59ea6e6e0b3cace4ae38/Squirrel/SQRLInstaller.m)).
Electron applies the patches cited above while building that pinned source;
the raw Squirrel commit alone is therefore not the complete Electron 43.2
behavior
([Electron 43.2 dependency and patch set](https://github.com/electron/electron/tree/v43.2.0/patches/squirrel.mac)).

`electron-updater` is the electron-builder ecosystem adapter around that
native path. On macOS it selects a ZIP, downloads it with progress and checksum
metadata, exposes it through an authenticated loopback server, and calls
Electron's native updater to stage and install it
([`MacUpdater` at the matching electron-builder 26.15.3 tag](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.15.3/packages/electron-updater/src/MacUpdater.ts)).
electron-builder's official guide says the macOS ZIP target is required for
Squirrel.Mac even when a DMG is also produced
([electron-builder auto-update guide](https://www.electron.build/docs/features/auto-update/)).

One integration detail matters for Eido's Profile boundary: in the matching
`MacUpdater` source, the wrapper dispatches its public `update-downloaded` event
when the loopback server is ready, before the native Squirrel
`update-downloaded` event. Native staging before the terminal Profile join is
unsafe: once raw Squirrel staging begins, a later ordinary exit may install
without relaunch. Eido therefore verifies the wrapper-cached ZIP first with
automatic install-on-quit disabled, establishes a recoverable pause, freezes
and joins the final Profile checkpoint while Squirrel remains unarmed, and only
then starts raw staging through the loopback proxy. A bounded UI threshold does
not cancel the readiness listener; only native readiness permits
`MacUpdater.quitAndInstall()`.

## Recommended implementation boundary

### Release output

1. Continue producing the signed, notarized DMG as the human/manual installer.
2. Also produce a macOS arm64 ZIP from the **same signed application bundle**.
   The current production builder explicitly targets only DMG and disables DMG
   update metadata, so this is a real release-pipeline change
   ([production builder](../../release/packaged/production-builder.mjs)).
3. Notarize the app payload, staple its ticket to `Eido.app`, and only then
   create the update ZIP with `ditto`. Apple says a ZIP cannot itself be
   stapled: its contained items must be stapled before the distribution ZIP is
   recreated
   ([Apple: customizing notarization](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)).
   Apple also recommends `ditto` rather than `cp` because it preserves bundle
   symlinks
   ([Apple: packaging Mac software](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)).
4. Make the ZIP a separately certified release artifact with immutable size,
   SHA-256 and SHA-512, app version, bundle ID, architecture, strict
   `codesign`, Gatekeeper, notarization/staple, and ShipIt-helper signing
   evidence. Keep the DMG and ZIP identities bound to the same source SHA and
   signed app tree.
5. Generate electron-updater metadata and Eido's Ed25519-signed manifest from
   that one certified record. Eido's signed manifest remains the authorization
   source; provider metadata cannot select a different version or artifact.

### Runtime order

1. Verify Eido's signed manifest, freshness, recall, platform, version, and
   artifact identity exactly as today. Leave automatic downgrade disabled.
2. Configure the matching `electron-updater` with `autoDownload = false` and
   automatic install-on-quit disabled. Cross-check its candidate version and
   archive identity against the already verified Eido manifest before showing
   consent.
3. After `Update now`, let `electron-updater` download the ZIP and report
   progress. Treat its checksum as defense in depth; the archive must also
   match the digest authorized by Eido's signed manifest.
4. Cross-check the one provider ZIP entry and the exact cached ZIP bytes
   against Eido's signed version, basename, size, SHA-256, and SHA-512. Keep
   native Squirrel unstaged so a failed drain cannot install on a later exit.
5. Synchronously acquire update ownership before any ordinary close can start.
   Reversibly pause external and renderer Agent admission and join accepted
   mutations. Flush a baseline while retaining the renderer persistence
   barrier; later edits remain held rather than lost.
6. Still with native Squirrel unarmed, synchronously freeze renderer mutation,
   capture the final held state, close AI/broker/live-gateway producers, flush
   SQLite, and join the Profile utility. Require the native receipt to match
   the final renderer checkpoint exactly. Prefer graceful close; after that
   exact receipt, a close-acknowledgement or clean-exit timeout may use a
   bounded forced join without discarding the receipt, but only when that join
   reports a clean exit. A non-clean or failed forced join, or any
   missing/mismatched receipt, remains terminal. A failure here may relaunch
   the intact old app because raw staging has not begun.
7. Only after the flushed joined receipt, mark native staging as potentially
   armed and call raw Electron `autoUpdater.checkForUpdates()` through the
   authenticated loopback proxy. At the bounded threshold, show “still
   preparing” and keep Eido open while the same listener continues waiting.
   Any error or timeout after invocation is ambiguous and must not relaunch or
   exit the quiesced old process.
8. Call `MacUpdater.quitAndInstall()` exactly once after native readiness.
   Listen to `before-quit-for-update` as the authoritative special quit path so Eido's
   ordinary `before-quit` handler cannot start a second drain. Do **not** call
   `app.exit()`, destroy the window, spawn a shell, or call `open -n`; Electron
   and ShipIt own window close, process termination, replacement, restoration,
   and relaunch.
9. On the next launch, reconcile the attempt journal against the running app
   version. Preserve Eido's person-visible fallback if the version did not
   advance, and add bounded collection of ShipIt stdout/stderr/state rather
   than inventing a second installer diary.

Electron's lifecycle distinction is important here: `app.exit()` bypasses
`before-quit` and `will-quit`, while `app.quit()` follows the normal close
sequence; update quits have their own ordering
([Electron `app` lifecycle](https://www.electronjs.org/docs/latest/api/app)).
The Profile therefore cannot be delegated to a late generic quit handler. Its
flush remains an explicit precondition for invoking the standard updater.

## Security policy and rollback posture

- **App Management:** start with Apple's default same-Team-ID policy and prove
  that the packaged ShipIt helper is strictly signed by Eido's Developer ID
  team. Do not add a broad `NSUpdateSecurityPolicy`. Add an explicit
  `AllowProcesses` entry only if field TCC evidence shows it is required, and
  then allow only the exact Eido-team helper signing identifier
  ([Apple policy](https://developer.apple.com/documentation/bundleresources/information-property-list/nsupdatesecuritypolicy)).
- **Archive trust:** HTTPS and electron-updater hashes are not substitutes for
  Eido's signed manifest. The manifest authorizes the exact certified archive;
  Squirrel independently requires the replacement app to satisfy the running
  app's code-signing requirement.
- **Failed-install rollback:** let ShipIt restore the owned prior bundle. Do not
  maintain a second shell rollback algorithm.
- **Product downgrade:** keep `allowDowngrade` false. A release recall stops
  further delivery; recovery from a bad already-installed release should be a
  forward hotfix unless an explicitly proven Profile-compatibility plan allows
  an older binary. electron-updater defaults downgrade permission to false
  ([`MacUpdater` API](https://www.electron.build/docs/api/electron-updater.class.macupdater/)).
- **Profile location:** ShipIt replaces only the `.app` bundle. Eido's Profile
  stays under the per-user `userData`/Application Support root, outside that
  bundle; persistence safety depends on the flush/join protocol, not on copying
  Profile data during an update
  ([Electron paths](https://www.electronjs.org/docs/latest/api/app#appgetpathname)).

## ADR 0032 disposition

[ADR 0032](../../docs/adr/0032-update-delivery-is-a-signed-manifest-on-an-owned-address.md)
should be **narrowly amended by a new ADR**, not wholly superseded and not
silently edited in place. Its signed Ed25519 manifest, freshness, owned
hostname, recall, and publication decisions remain load-bearing. Its decision
5 ("macOS installs in place by swapping the app from the downloaded DMG") and
its recorded rejection of electron-updater are the parts this evidence
reverses.

The implementation change should therefore add a new ADR that:

- supersedes ADR 0032 decision 5 and the corresponding considered-option
  rationale;
- preserves ADR 0032 decisions 0–4 and 6;
- records the two-phase Eido-drain/standard-installer ownership boundary;
- keeps the signed Eido manifest as authorization while adding the ZIP and
  provider metadata required to drive Squirrel; and
- gives Squirrel/Sparkle failure against the acceptance matrix as the explicit
  future flip condition.

Once that ADR is accepted, ADR 0032's status line and the ADR index should say
that only its macOS installer mechanism is amended by the new record. Research
alone should not mutate the accepted ADR before the replacement is chosen and
implemented.

## Why Sparkle is the fallback, not the first move

Sparkle 2 validates EdDSA signatures and Apple code signing, supports DMG and
ZIP inputs, uses separate updater helpers, handles permissions, authorization,
quarantine, atomic-safe installation, and custom user interfaces
([Sparkle documentation](https://sparkle-project.org/documentation/),
[Sparkle project](https://github.com/sparkle-project/Sparkle)). Its custom UI
contract explicitly models downloaded, installing, install-on-quit, terminated,
and relaunch states, and warns that some `/Applications` installs require user
authorization
([custom user interfaces](https://sparkle-project.org/documentation/custom-user-interfaces/),
[`SPUUserDriver`](https://sparkle-project.org/documentation/api-reference/Protocols/SPUUserDriver.html)).
Recent Sparkle releases also document fixes to their isolated launchd installer
and installation timeouts
([security and reliability history](https://sparkle-project.org/documentation/security-and-reliability/)).

Those facts validate the same separation Eido needs: app-specific save/drain
before handoff, then a signed native helper owns installation and relaunch.
They do not justify embedding a second native update framework before testing
Electron's supported one. Sparkle becomes the next candidate only if a minimal
Squirrel integration cannot satisfy field proof on supported macOS versions.

## Acceptance matrix

The replacement was not considered done when a unit test said
`quitAndInstall()` was called. The first real installed boundary proof is now
complete; the broader matrix below remains the follow-up acceptance contract.

Minimum proof:

1. Package and certify a bootstrap version with the standard updater. Because
   the **installed old version** performs the update, a manual install may be
   required once to cross from the custom engine.
2. From that bootstrap version, update in place to the next certified version
   without manually opening the app after it closes.
3. Observe one old PID, one different relaunched PID, exact target version,
   strict signing, Gatekeeper acceptance, and no second instance.
4. Use only a disposable Profile fixture to prove: renderer checkpoint,
   `flushed` receipt, utility join, offline reopen, and exact logical content
   after relaunch.
5. Exercise `/Applications`, `~/Applications`, a standard-user install that
   requires authorization, a renamed app, a read-only/translocated launch,
   same and different installer accounts, a pending macOS system update, sleep
   during download, network interruption, user quit racing consent, and a
   second launch racing the handoff. Apple explicitly recommends testing fresh,
   upgrade, duplicate, different-account, and translocated distribution cases
   ([Apple distribution test matrix](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)).
6. Inject failures before drain, after native staging, during old-bundle move,
   and before relaunch. Before drain Eido must keep running; after handoff
   ShipIt must install or restore; every terminal path must be diagnosable and
   leave either the old or new complete app launchable.
7. Run the full repository suite and native packaged proof, then perform the
   two-release field update. The first consent-click/relaunch path is recorded
   as complete in the field-proof note. A manual reopen is still failure
   evidence for any future run that promises automatic relaunch.

## Bottom line

The right fix is not another wait, rename guard, or `open` variation. Eido
should keep the product-specific safety work it genuinely owns and delete the
general-purpose macOS installer it has accidentally grown. Electron/Squirrel
should own the atomic app replacement and relaunch; Eido should own the signed
release decision and prove that its Profile is closed before handing control
over.
