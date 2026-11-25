# Production Electron release references: adversarial review for Eido

Research date: 2026-07-16 (Australia/Sydney)

## Scope and method

This note tests the proposed “Electron shell around Eido’s existing browser UI, local persistence, and automatic updates from GitHub Releases” against four mature Electron applications and the current platform documentation. Only primary sources are used: upstream project repositories and issue trackers, Electron/electron-builder documentation, and GitHub documentation.

The upstream repositories were inspected at these exact revisions:

| Project | Revision inspected | Why it is relevant |
| --- | --- | --- |
| VS Code | [`ecf367b`](https://github.com/microsoft/vscode/commit/ecf367b2f20d54f697cef6075cb9c72b22c3c1b6) | Mature, high-volume, cross-platform desktop release pipeline with separate stable/Insiders qualities and custom platform updaters. |
| Joplin | [`54b8e69`](https://github.com/laurent22/joplin/commit/54b8e697509b399dc83ffd2d77841d950299fb70) | Local-first notes app; closest data-risk analogue; uses electron-builder and electron-updater. |
| Signal Desktop | [`286ac81`](https://github.com/signalapp/Signal-Desktop/commit/286ac81b7d07005757124eebad2cea3d7e26224a) | Security-sensitive Electron app with signed update manifests, differential/full fallback, and packaged artifact tests. |
| Element Desktop | [`6c40c56`](https://github.com/element-hq/element-web/commit/6c40c56845fe0319ee86346372f9b9b32d84d6bf) | Especially close architectural analogue: an Electron wrapper around an existing browser application. |

## Executive verdict

The plan is **practical for a friends-only Alpha only after tightening its scope and release contract**.

The sound part is the product shape: keep the React/Vite renderer, put privileged persistence and update operations in Electron’s main process, expose a narrow typed preload API, and let the application run without Eido-owned servers. Element proves that a web application can remain the product core while Electron supplies desktop packaging, local storage access, native integration, and updates.

The unsafe part would be treating packaging and GitHub Releases as the complete release system. The mature projects consistently add machinery that a minimal tutorial omits:

- a platform-specific build on the target operating system;
- signing and notarization that fail the release when absent;
- verification of the signed output, not just a successful build command;
- a real update state machine that serializes checks and survives partial or repeated operations;
- packaged-app smoke tests on every supported platform;
- separate release qualities or channels;
- explicit operating-system compatibility checks;
- bounded cleanup of downloaded installers;
- a way to stop promotion before users see a bad release.

For a solo-founder Alpha, the feasible version is therefore:

1. **Ship Apple Silicon macOS and Windows x64 together on day one.** Build and verify the native lanes independently, but publish neither target until both installer-to-update paths and both real-device canaries are green. Do not promise Intel macOS, Windows ARM64, or Linux in the initial release.
2. **electron-builder + electron-updater is a credible choice**, because Joplin uses both and Signal/Element use electron-builder. However, Signal and Element replaced the simplistic updater path with project-owned state machines. Eido should keep electron-updater behind a small Eido-owned update module rather than expose it directly to the renderer.
3. **Use a public binary release repository only if “friends-only” means invitation/discovery, not access control.** Public release assets are public. A truly private updater requires credentials on every client or an authenticated distribution service, which conflicts with the desired low-operations model.
4. **Stage before publication, not by mutating a published release.** Build and sign a candidate for an exact commit, test the actual packaged artifact, manually canary that same artifact, then publish it as an immutable GitHub release. For the first small cohort, this is simpler and safer than percentage rollout metadata.
5. **Automatic update means intermittently online.** Eido can be fully offline-capable at runtime, but update discovery and download inherently require GitHub connectivity. A permanently disconnected computer needs a manual installer update path.

## What the reference projects actually do

### 1. Element Desktop: the closest wrapper architecture

Element’s desktop package explicitly describes itself as a wrapper around Element Web. Its build fetches or receives a webapp artifact, packages it into `webapp.asar`, and wraps it with Electron ([desktop README](https://github.com/element-hq/element-web/blob/6c40c56845fe0319ee86346372f9b9b32d84d6bf/apps/desktop/README.md), [prepare workflow](https://github.com/element-hq/element-web/blob/6c40c56845fe0319ee86346372f9b9b32d84d6bf/.github/workflows/build_desktop_prepare.yaml)). That validates Eido’s proposed seam: the browser renderer can remain recognizable while the desktop shell owns privileged capabilities.

Element’s shell is materially more restrictive than a tutorial wrapper:

- it acquires a single-instance lock;
- globally enables the renderer sandbox;
- creates the main window with `nodeIntegration: false` and `contextIsolation: true`;
- serves packaged content from a custom `vector:` protocol rather than `file://`;
- normalizes and bounds-checks requested paths before returning a packaged file;
- flips Electron fuses including `runAsNode: false`, ASAR integrity validation, and “only load from ASAR.”

The evidence is in [electron-main.ts](https://github.com/element-hq/element-web/blob/6c40c56845fe0319ee86346372f9b9b32d84d6bf/apps/desktop/src/electron-main.ts) and [electron-builder.ts](https://github.com/element-hq/element-web/blob/6c40c56845fe0319ee86346372f9b9b32d84d6bf/apps/desktop/electron-builder.ts). Eido should follow this shape, with its preload bridge exposing intent-level persistence commands rather than raw filesystem or IPC primitives.

Element has separate stable and nightly variants and static update destinations. Its updater supports macOS and Windows but explicitly returns without enabling auto-update on Linux. It also contains a workaround to avoid repeated checks after an update is already downloaded and a macOS guard for a Squirrel state that can prevent restart ([updater.ts](https://github.com/element-hq/element-web/blob/6c40c56845fe0319ee86346372f9b9b32d84d6bf/apps/desktop/src/updater.ts)). This workaround exists because “downloaded successfully” does not imply “the application will restart successfully.” The first-party issue, [“macOS desktop app doesn't restart after updating”](https://github.com/element-hq/element-web/issues/12433), was reported intermittently over years.

Its CI is the strongest directly reusable pattern for Eido:

- prepare one renderer artifact;
- fan out macOS, Windows, and Linux packaging jobs;
- sign in protected environments;
- verify macOS output with `codesign` and `spctl` and Windows output with `signtool`;
- download the packaged artifact into a separate test job and run Playwright against the real executable;
- deploy only after required platform jobs finish.

See [the deployment orchestrator](https://github.com/element-hq/element-web/blob/6c40c56845fe0319ee86346372f9b9b32d84d6bf/.github/workflows/build_desktop_and_deploy.yaml), [macOS workflow](https://github.com/element-hq/element-web/blob/6c40c56845fe0319ee86346372f9b9b32d84d6bf/.github/workflows/build_desktop_macos.yaml), [Windows workflow](https://github.com/element-hq/element-web/blob/6c40c56845fe0319ee86346372f9b9b32d84d6bf/.github/workflows/build_desktop_windows.yaml), and [packaged test workflow](https://github.com/element-hq/element-web/blob/6c40c56845fe0319ee86346372f9b9b32d84d6bf/.github/workflows/build_desktop_test.yaml).

**Lesson for Eido:** the wrapper architecture is proven; the important unit of release testing is the signed executable, not the Vite `dist` directory.

### 2. Joplin: electron-builder is credible, but not sufficient by itself

Joplin’s desktop application currently uses Electron, electron-builder, and electron-updater. Its builder configuration produces NSIS and portable Windows packages, DMG/PKG/ZIP macOS packages, and AppImage/DEB Linux packages, with ASAR packaging and platform signing hooks ([desktop package configuration](https://github.com/laurent22/joplin/blob/54b8e697509b399dc83ffd2d77841d950299fb70/packages/app-desktop/package.json)). This is strong evidence that electron-builder is not merely a prototype choice for a local-first desktop application.

Its updater is not just `checkForUpdatesAndNotify()`. Joplin:

- polls a release index every 12 hours;
- distinguishes normal and prerelease updates;
- maps platform and CPU architecture to exact metadata assets;
- prevents concurrent update checks;
- uses a generic feed after resolving the selected release;
- automatically downloads but does not automatically install on quit;
- asks the user before calling `quitAndInstall`.

See [AutoUpdaterService.ts](https://github.com/laurent22/joplin/blob/54b8e697509b399dc83ffd2d77841d950299fb70/packages/app-desktop/services/autoUpdater/AutoUpdaterService.ts) and its documented [prerelease opt-in](https://github.com/laurent22/joplin/blob/54b8e697509b399dc83ffd2d77841d950299fb70/readme/about/prereleases.md).

Joplin also exposes a production anti-pattern that Eido should deliberately reject. Its macOS notarization hook exits successfully when Apple credentials are missing; it logs a warning and skips notarization ([notarizeMacApp.ts](https://github.com/laurent22/joplin/blob/54b8e697509b399dc83ffd2d77841d950299fb70/packages/app-desktop/tools/notarizeMacApp.ts)). That is tolerable for local or non-release builds, but a production release workflow must distinguish modes and **fail closed** when a release-signing prerequisite is absent.

Joplin’s [Ubuntu 24.04 AppImage failure](https://github.com/laurent22/joplin/issues/10332) demonstrates another operational truth: Linux packaging is not “one more target.” An OS hardening change prevented the AppImage from launching unless users or installers performed additional setup or disabled Chromium’s sandbox. Electron itself states that its built-in auto-updater does not support Linux. Initial Eido Linux support would therefore add installer format, sandbox, distribution, and update-policy decisions disproportionate to a friends Alpha.

**Lesson for Eido:** electron-builder lowers packaging effort but does not supply release policy, fail-closed signing, packaged validation, or a universally reliable updater.

### 3. Signal Desktop: treat the updater as a security-critical subsystem

Signal uses electron-builder for packaging but owns a substantial updater implementation rather than relying on a two-line integration ([package configuration](https://github.com/signalapp/Signal-Desktop/blob/286ac81b7d07005757124eebad2cea3d7e26224a/package.json), [updater entry point](https://github.com/signalapp/Signal-Desktop/blob/286ac81b7d07005757124eebad2cea3d7e26224a/ts/updater/index.main.ts)). Its design includes:

- distinct production, alpha, beta, staging, and ad-hoc version preparation;
- platform-specific install adapters;
- an update state machine with a single active download;
- randomized polling/delay behavior to avoid every client updating at once;
- OS and glibc minimum-version fields in update metadata;
- SHA-512 integrity checks plus a separate signature over the update hash and version;
- differential download with a full-package fallback;
- retry limits and explicit “cannot update” UI states;
- cleanup of old installer files.

See [common.main.ts](https://github.com/signalapp/Signal-Desktop/blob/286ac81b7d07005757124eebad2cea3d7e26224a/ts/updater/common.main.ts), [signature.node.ts](https://github.com/signalapp/Signal-Desktop/blob/286ac81b7d07005757124eebad2cea3d7e26224a/ts/updater/signature.node.ts), and [differential.main.ts](https://github.com/signalapp/Signal-Desktop/blob/286ac81b7d07005757124eebad2cea3d7e26224a/ts/updater/differential.main.ts).

Signal’s cleanup code directly references a real failure: old Windows installers accumulated in the user-data directory. The first-party report measured hundreds of megabytes after several updates ([Signal issue #2369](https://github.com/signalapp/Signal-Desktop/issues/2369); current cleanup in [windows.main.ts](https://github.com/signalapp/Signal-Desktop/blob/286ac81b7d07005757124eebad2cea3d7e26224a/ts/updater/windows.main.ts)). Eido therefore needs a bounded update-cache policy from its first automatic update, even with only a few users.

Signal launches the packaged application with Playwright and checks that the actual production ASAR contains required configuration and opens a visible window with the expected title ([test-release.mjs](https://github.com/signalapp/Signal-Desktop/blob/286ac81b7d07005757124eebad2cea3d7e26224a/scripts/test-release.mjs)). It also flips security fuses after packaging ([fuse-electron.mjs](https://github.com/signalapp/Signal-Desktop/blob/286ac81b7d07005757124eebad2cea3d7e26224a/scripts/fuse-electron.mjs)).

Signal illustrates a useful warning about copying mature code blindly: its main window currently has `nodeIntegration: false` and context isolation in production, but leaves the main renderer unsandboxed while sandboxing many secondary windows ([main.main.ts](https://github.com/signalapp/Signal-Desktop/blob/286ac81b7d07005757124eebad2cea3d7e26224a/app/main.main.ts)). This is a project-specific exception for a complex existing application, not a baseline for a new wrapper. Eido’s simpler renderer should remain sandboxed.

**Lesson for Eido:** platform code signing is necessary but not the whole trust boundary. Update metadata, concurrency, integrity, cache cleanup, OS support, and failure UI still belong to the application.

### 4. VS Code: release quality is an explicit product dimension

VS Code uses a custom packaging and update system rather than electron-builder. The public source repository distinguishes Code - OSS from Microsoft’s product distribution, and the project documents monthly stable releases plus daily Insiders builds ([README](https://github.com/microsoft/vscode/blob/ecf367b2f20d54f697cef6075cb9c72b22c3c1b6/README.md)). Its update URL includes platform, release quality, and the exact current commit. Platform services then diverge:

- macOS uses Electron’s autoUpdater and a signed feed;
- Windows downloads to a temporary path, verifies an advertised SHA-256, atomically promotes the download, and coordinates an Inno Setup process and mutexes;
- Linux checks for availability but routes users to the appropriate download rather than assuming one self-update mechanism.

See [abstractUpdateService.ts](https://github.com/microsoft/vscode/blob/ecf367b2f20d54f697cef6075cb9c72b22c3c1b6/src/vs/platform/update/electron-main/abstractUpdateService.ts), [updateService.darwin.ts](https://github.com/microsoft/vscode/blob/ecf367b2f20d54f697cef6075cb9c72b22c3c1b6/src/vs/platform/update/electron-main/updateService.darwin.ts), [updateService.win32.ts](https://github.com/microsoft/vscode/blob/ecf367b2f20d54f697cef6075cb9c72b22c3c1b6/src/vs/platform/update/electron-main/updateService.win32.ts), and [updateService.linux.ts](https://github.com/microsoft/vscode/blob/ecf367b2f20d54f697cef6075cb9c72b22c3c1b6/src/vs/platform/update/electron-main/updateService.linux.ts).

Its release jobs are platform-specific, can run Electron/browser/smoke tests, publish SBOM metadata with artifacts, sign and notarize, then verify the signed application can actually start ([macOS pipeline](https://github.com/microsoft/vscode/blob/ecf367b2f20d54f697cef6075cb9c72b22c3c1b6/build/azure-pipelines/darwin/steps/product-build-darwin-compile.yml), [Windows pipeline](https://github.com/microsoft/vscode/blob/ecf367b2f20d54f697cef6075cb9c72b22c3c1b6/build/azure-pipelines/win32/steps/product-build-win32-compile.yml), [Linux pipeline](https://github.com/microsoft/vscode/blob/ecf367b2f20d54f697cef6075cb9c72b22c3c1b6/build/azure-pipelines/linux/steps/product-build-linux-compile.yml)). Eido does not need this scale, but it needs the same ordering: package, sign, verify, exercise, then promote.

VS Code also suffered an updater compatibility failure where an older macOS installation received an incompatible release. The eventual correction was server-side and depended on accurately communicating the client OS version ([issue #204034](https://github.com/microsoft/vscode/issues/204034); current request headers in [abstractUpdateService.ts](https://github.com/microsoft/vscode/blob/ecf367b2f20d54f697cef6075cb9c72b22c3c1b6/src/vs/platform/update/electron-main/abstractUpdateService.ts)). Eido’s static GitHub feed will not have a smart compatibility server, so the application must enforce minimum supported OS/architecture before accepting an update and must retain a manual compatible installer.

**Lesson for Eido:** version alone is not enough to select an update. Channel, platform, architecture, current version, and minimum OS are release inputs.

## Cross-project invariants Eido should adopt

### Security boundary

Electron’s own checklist recommends context isolation, process sandboxing, a restrictive CSP, limiting navigation and new windows, validating every IPC sender, avoiding raw `file://`, using a custom protocol, and reviewing fuses ([Electron security guide](https://www.electronjs.org/docs/latest/tutorial/security), [fuses guide](https://www.electronjs.org/docs/latest/tutorial/fuses), [process model](https://www.electronjs.org/docs/latest/tutorial/process-model)).

For Eido, that means:

- renderer: the existing web UI, no Node.js access;
- preload: a small, typed, intent-level API such as inspect/load/commit/export/restore/update-status; never expose `ipcRenderer`, filesystem paths, or arbitrary channels;
- main process: persistence engine, update engine, dialogs, and OS key storage;
- custom `eido:` application protocol with path traversal tests;
- `nodeIntegration: false`, `contextIsolation: true`, sandbox enabled;
- navigation, popups, external URLs, and IPC senders allowlisted;
- `runAsNode` and Node CLI flags disabled; ASAR-only loading and ASAR integrity enabled where supported.

This is also a deep module seam: Electron is an adapter to the persistence and release interfaces, not a place for Board semantics. That keeps the desktop shell neutral to the renderer performance architecture being developed elsewhere.

### External performance-epic boundary

The active [#410 performance epic](https://github.com/limweili/eido/issues/410)
owns renderer evidence and selection. [#409](https://github.com/limweili/eido/issues/409)
turns that decision into a production sequence and packaged-performance gates;
closing #409 does not mean that implementation exists. Contracts, persistence,
Electron security, signing, updater foundations, release service, website, and
founder coaching may proceed independently. Packaged renderer approval and both
sealed candidates wait for every release-blocking production slice generated by
#409 to land on the exact candidate SHA. A prototype branch or enabled experiment
flag is never a substitute.

The #410 comparison workflows currently pin Node 20. The release program's Node
22.12+ transition is blocked by [#408](https://github.com/limweili/eido/issues/408),
the last measurement lane downstream of the candidate comparison. Package,
lockfile, Node-configuration, and shared-workflow changes must not land before
that protected evidence boundary closes.

### Signing is a gate, not a best effort

Electron states that distributed applications should be signed; macOS distribution requires signing and notarization, and macOS automatic updating requires a signed app ([code-signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing), [autoUpdater reference](https://www.electronjs.org/docs/latest/api/auto-updater/)).

Release mode must therefore fail when credentials are absent or verification fails. The gate should verify:

- expected bundle/application ID and version;
- macOS signature, hardened runtime, notarization/Gatekeeper assessment, and stapling/offline validity;
- Windows Authenticode publisher and installer signature for the required day-one Windows x64 target;
- expected Electron fuses after signing;
- SHA-256 digest and exact Git commit recorded in a release manifest;
- launch of the signed package from a clean temporary user-data directory.

Local developer builds may remain unsigned, but must be visibly and mechanically distinct from release candidates.

### The updater needs an Eido-owned state machine

Electron warns that duplicate `checkForUpdates()` calls can download the same update twice, that Squirrel.Windows holds a first-run lock, and that `before-quit` is not emitted in the normal way during `quitAndInstall()` ([autoUpdater reference](https://www.electronjs.org/docs/latest/api/auto-updater/)). Element and Signal contain project-owned guards for these cases.

The Eido updater should expose a small state model: `idle -> checking -> available -> downloading -> ready -> installing`, with terminal/recoverable `unsupported`, `offline`, and `error` states. It should:

- permit only one check/download/install operation at a time;
- back off after network or feed failure;
- never install until persistence reports all pending writes flushed and a pre-update recovery point exists;
- download automatically if desired, but require an explicit restart/install action for Alpha;
- skip incompatible OS/architecture releases;
- retain only the current and immediately previous installer cache, or a tested byte cap;
- record enough local state to explain the last update attempt without telemetry;
- provide “copy diagnostics” and “open manual download” recovery actions.

electron-builder’s updater adds Linux targets, metadata generation, signature validation, staged rollout fields, and GitHub Releases support ([electron-builder auto-update documentation](https://www.electron.build/docs/features/auto-update/)). That is useful implementation leverage, but its API and metadata format are dependencies to pin and contract-test.

### Test the transition, not just each endpoint

Every release candidate should exercise at least these packaged scenarios on its target OS:

1. clean install and first launch;
2. launch with an existing representative save;
3. edit, flush, quit, relaunch, and verify persistence;
4. install/update from the previous supported version to the candidate;
5. update while offline, then reconnect and retry;
6. update download failure and retry;
7. candidate launch after update with the same save;
8. incompatible or corrupted update metadata is rejected;
9. a second application instance is rejected/focused without a second writer;
10. signature, notarization, fuse, version, commit, and digest verification.

A Vite build or unpacked Electron launch cannot cover installer registration, code-signing identity, updater metadata, permissions, Squirrel/NSIS behavior, or migration timing.

## Adversarial failure table

| How the plan can fail | Evidence from production | Required correction for Eido |
| --- | --- | --- |
| “Friends-only” binaries are accidentally treated as access controlled. | GitHub’s release API and assets can be fetched without authentication when the repository is public ([GitHub Releases API](https://docs.github.com/en/rest/releases/releases), [asset API](https://docs.github.com/en/rest/releases/assets)). electron-builder warns that its private GitHub updater is not suitable for general client distribution because a token is needed on user machines ([docs](https://www.electron.build/docs/features/auto-update/)). | Decide explicitly: public, invitation-only discovery versus real access control. For low operations, use a public binary repo and assume anyone with the URL can download it. Do not embed a GitHub token in Eido. |
| A private source repo cannot publish to a separate public release repo with its default Actions token. | GitHub documents that `GITHUB_TOKEN` is limited to the repository containing the workflow ([GitHub token documentation](https://docs.github.com/en/enterprise-cloud%40latest/actions/concepts/security/github_token)). | Provision a narrowly scoped GitHub App installation token or fine-grained PAT for the release repo, store it in a protected release environment, rotate it, and add a credential-expiry incident SOP. This is a one-time founder identity/permission step, not something agents can invent. |
| A percentage rollout conflicts with immutable release assets. | electron-builder implements percentage rollout by editing channel YAML; a bad staged release requires a higher replacement version. GitHub immutable releases prevent asset modification after publication ([electron-builder staged rollout](https://www.electron.build/docs/features/auto-update/), [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)). | For the small Alpha, do not use percentage rollout. Canary the exact candidate before publication, then publish an immutable release. Add cohort percentages later only with a separate mutable static feed or a purpose-built service. |
| Publishing a release before all platform artifacts are present creates a partially installable/updateable version. | Mature workflows stage artifacts and deploy after platform jobs; GitHub recommends draft-first publication for immutable releases ([GitHub guidance](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)). | Create a draft, attach all required artifacts and update metadata, verify the manifest, then publish once. The publication action is the promotion boundary. |
| Missing signing secrets silently produce an unsigned “release.” | Joplin’s current notarization hook warns and returns when credentials are absent. Electron warns unsigned apps trigger OS barriers and macOS auto-update requires signing. | Release-mode preflight and post-build verification must both fail closed. Unsigned output must never be uploadable by the promotion job. |
| An update downloads but never restarts, or repeated polling corrupts updater state. | Element’s multi-year macOS restart issue and current workaround; Electron warns repeated checks duplicate downloads. | Serialize updater operations, stop polling once an update is downloaded, test previous-to-candidate update on the packaged artifact, and provide manual relaunch/download recovery. |
| A valid release bricks unsupported operating systems. | VS Code issue #204034; current VS Code feed requests include OS information. Signal and Element carry minimum OS logic. | Declare supported OS versions, encode them in update metadata or app checks, reject incompatible updates, and test the oldest supported OS on a real hosted runner when available. |
| Update caches grow forever. | Signal issue #2369 and explicit cleanup logic. | Bound updater caches by count and bytes; verify cleanup in update tests. Do not mix update installers with save backups. |
| Linux becomes an unplanned support product. | Electron built-in updater excludes Linux; Joplin’s AppImage broke under Ubuntu 24.04 AppArmor; Element disables Linux auto-update. | Exclude Linux from Friends Alpha. Reconsider only with a selected package channel and a separate distribution/update support plan. |
| The browser renderer gains filesystem privileges through a convenient preload bridge. | Electron warns against exposing raw IPC/Node APIs. Element uses a custom protocol and sandbox; VS Code uses a sandboxed preload boundary. | Define and schema-validate a narrow persistence API, validate IPC senders, and test that arbitrary paths/channels are unreachable. |
| Electron itself becomes an unowned maintenance burden. | Electron ships a major on an eight-week cadence and supports only the latest three stable majors ([release policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)). | Add a recurring agent-owned Electron maintenance lane: monthly patch review, supported-major check, security/advisory triage, packaged smoke update, and a founder-facing exception only when OS support or behavior changes. |
| “Rollback” is assumed to be a button. | electron-builder’s staged rollout documentation says a pulled release must be superseded with a higher version for already-updated users. None of the reference projects treats updater downgrade as universal rollback. | Define rollback as halt promotion + publish a forward hotfix. Never auto-downgrade across a data migration. Preserve the previous installer and a pre-migration save recovery point for manual recovery. |

## Recommended Friends Alpha release shape

### Distribution model

- Keep the source repository private initially if desired.
- Publish signed binaries and update metadata to a separate public `eido-releases` repository.
- Describe this honestly as a **private/source-available Friends Alpha with public binary distribution**, not open source, unless an OSI license and corresponding source are actually published.
- Treat the link as unlisted/invitation-only discovery, not security.
- Use SemVer prereleases such as `0.1.0-alpha.1`. Alpha installations follow prereleases; no stable `latest` feed is promised yet.

This avoids placing a reusable GitHub credential on friends’ computers. It also acknowledges that Electron binaries can be inspected; keeping source private is friction, not a secrecy boundary.

### Candidate-to-release process

```text
main commit with required CI green
        |
        v
create candidate record (version + exact SHA)
        |
        v
#409 sequence + all release-blocking production slices land
        |
        v
build the selected production renderer once, fan out target-OS packaging
        |
        v
sign/notarize -> verify signature/fuses/digests
        |
        v
packaged clean-install + previous-version update tests
        |
        v
draft release + complete manifest (not public updater feed)
        |
        v
manual canary of the exact signed artifact
        |
        +---- failure ----> quarantine candidate; no publication
        |
        v
publish immutable Alpha release
        |
        v
agents monitor opt-in diagnostics / founder reports; forward hotfix if needed
```

“Build once” means do not rebuild a candidate after tests; each operating system still produces its own signed artifact. The release manifest binds every artifact to the same source commit and records its digest, toolchain, platform, architecture, signing identity, and test result. It also records #410/#409, every required or optional/deferred production issue and reason, each required merge SHA/evidence URL, the #408 toolchain handoff, and the exact performance-fixture version.

### Initial platform matrix

1. **Apple Silicon macOS** is a required day-one target with Developer ID signing, notarization, stapling, install/update tests, and a real-device canary.
2. **Windows x64** is an equally required day-one target with Authenticode signing, NSIS install/update tests, publisher/SmartScreen validation, and a real-device canary.
3. **Intel macOS, Windows ARM64, and Linux are deferred.** A manual archive is not equivalent to a supported install and automatic-update contract.

This matrix prevents “cross-platform” from becoming partially tested products. Element and VS Code invest separate workflows and test runners for each platform; Eido intentionally accepts the slower of its two required lanes as the release pace-setter.

## Release-plan changes this research requires

The implementation specification should make these non-negotiable:

1. The desktop shell serves only packaged local content through a custom protocol and keeps all renderers sandboxed.
2. Persistence and update capabilities are deep main-process modules behind narrow typed preload interfaces.
3. The application enforces a single writer with `requestSingleInstanceLock` plus persistence-level revision checks.
4. Production signing is fail-closed and post-build verified.
5. A release candidate is an exact source SHA plus immutable artifact digests, not “whatever main contains when the workflow runs.”
6. Actual signed packages are smoke-tested on each supported OS, including previous-version update.
7. Canary happens before publication; publication is atomic from the cohort’s perspective.
8. Public GitHub Releases are acknowledged as public and require cross-repository credentials when source is private.
9. Automatic install waits for save flush and a verified pre-update recovery point.
10. Rollback is forward repair plus explicit data recovery, not silent binary downgrade.
11. Update caches and logs have retention limits.
12. Electron security maintenance is a recurring release responsibility, not a one-time dependency addition.
13. Release preflight fails when #409's generated production issues are absent, unresolved, stale, or missing native blocker links; planning completion alone is never production evidence.
14. The Node/toolchain transition cannot mutate #410's comparison environment before #408 closes, and affected CI/performance contracts are rerun after it lands.
15. The sealed candidate contains the selected implemented production renderer, not merely a successful prototype.
16. Both required platform lanes and both named real-device canaries join before publication.
17. Intel macOS, Windows ARM64, and Linux remain explicitly unsupported until their packaging and update contracts are separately approved.

## Final feasibility judgment

**Electron is the right pragmatic delivery form for Eido’s stated constraints.** A PWA would preserve browser purity but cannot reliably own a normal filesystem save, OS key storage, signed automatic updates, or the recovery operations Eido needs without browser-specific permission friction. A native rewrite would discard the existing application and multiply implementation cost. Electron keeps the web renderer while giving a controlled, testable native boundary.

**GitHub Releases is adequate static infrastructure for a small Alpha**, provided the team accepts public binaries and a GitHub dependency. It eliminates Eido-owned servers; it does not eliminate hosted infrastructure, signing accounts, release credentials, or maintenance.

**The release should not claim to be bulletproof.** No local-only design can recover a dead disk without another copy, and no updater can guarantee rollback across arbitrary schema migrations. The defensible claim is narrower: Eido can make every release reproducible, signed, tested against representative data, recoverable from interrupted writes and failed migrations, and promotable without requiring the founder to operate technical release machinery. That is realistic for a solo founder with agent-operated CI; tutorial-grade packaging is not.
