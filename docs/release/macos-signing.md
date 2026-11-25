# macOS release signing

Every macOS Release Eido publishes is signed with the Developer ID Application
identity, built under the hardened runtime, notarized by Apple, and stapled. A
person opening Eido for the first time is not told it came from an unidentified
developer.

This is issue #696, under spec #975. The identity itself was provisioned and
proven end to end under #469; this document describes how the production lane
uses it. The proof-only lane is `docs/release/macos-signing-smoke.md`.

## Where it happens

Signing lives inside the packaged certification lane
(`.github/workflows/packaged-certification.yml`), because that lane already
produces the exact bytes that get published and already verifies them. Adding a
separate signing lane would have created a second artifact and a second thing to
keep in step.

The macOS leg is its own job, `certify-macos`, rather than one arm of a matrix:

| | `certify-macos` | `certify-windows` |
| --- | --- | --- |
| Environment | `macos-signing-smoke` (carries the identity) | none |
| Job limit | 360 minutes | 45 minutes |
| Signing | Developer ID, hardened, notarized, stapled | none, by decision |

The split exists so the identity is not merely unused by the Windows leg but
unreachable from it. Their shared steps are asserted identical by
`scripts/ci/packaged-certification.test.mjs`, which is what stops the split from
turning into drift.

## The steps, in order

1. **Preflight.** `node scripts/release-signing/macos-release.mjs preflight`
   decodes the certificate and notarization key into one private, fixed
   runner-temporary directory, proves the certificate is readable, unexpired,
   and the expected authority and Team ID, and writes the entitlements. Any
   missing or mismatched value fails before native spend.
2. **Package.** `npm run release:package` builds and signs the app, its
   framework, Squirrel `ShipIt`, and both standalone binaries under the hardened
   runtime. The builder's `afterSign` hook notarizes and staples `Eido.app`, then
   uses `ditto` to construct the Squirrel ZIP from that final app before the DMG
   is built and signed through the still-open temporary keychain.
3. **Notarize the DMG.** `macos-release.mjs notarize-dmg` re-verifies the DMG's
   signature, submits it to Apple, waits for `Accepted`, staples the ticket, and
   proves the signature did not change.
4. **Cleanup.** `macos-release.mjs cleanup` removes every byte of credential
   material. It runs with `always()`, before the packaged app is ever launched
   and before anything is uploaded.
5. **Certify.** `npm run release:certify` runs the full installed journey and,
   as part of it, verifies the sealed DMG's authority, Team ID, secure
   timestamp, staple, and Gatekeeper acceptance. It separately extracts the
   updater ZIP, verifies its app staple, Gatekeeper result, package identity,
   nested signatures (including `ShipIt`), and exact app-tree parity with the
   DMG installation, then binds both artifacts into one digest-addressed
   platform evidence packet.
6. **Upload.** Only after cleanup and certification have both passed.

## How publication uses this

`Desktop release publication` runs on Linux, where `codesign`, `spctl`, and
`stapler` do not exist, so it cannot re-inspect the signature itself. It does
not need to: `scripts/release/verify-certified-artifacts.mjs` reads the evidence
packet step 5 wrote, requires the Developer ID authority, Team ID, hardened
runtime, secure timestamp, stapled notarization, and Gatekeeper acceptance it
records, and proves the DMG and updater ZIP in hand hash and size exactly as
certified (including the ZIP's SHA-512 used by Squirrel metadata).
Evidence older than schemaVersion 2 predates that gate and is refused outright.
The release path is [`Desktop Release Captain`](../agents/desktop-release-captain.md).

## Credential boundary

Inherited unchanged from the signing smoke, and shared with it in code
(`scripts/release-signing/macos-identity.mjs`):

- Credential material exists only between preflight and cleanup.
- It lives only under `$RUNNER_TEMP/eido-macos-release-signing`, created `0700`
  with `0600` files. Electron Builder's temporary keychain is confined to the
  same directory via `APP_BUILDER_TMP_DIR`.
- The certificate password reaches `openssl` through the environment, never
  through argv.
- Only two steps name a secret: preflight and packaging. A test asserts that
  list, so a third step cannot quietly join it.
- Failures name a stable code, never a command transcript, path, or credential.

## Environment configuration

The lane binds to the `macos-signing-smoke` GitHub Environment, which already
holds the identity. Names and contracts are in
`docs/release/macos-signing-smoke.md`. Configure that environment to allow only
the `main` branch.

The environment's name is now inaccurate, since it serves the production lane
too. It can be renamed in GitHub without re-entering any secret; renaming also
requires changing the `environment:` line in `packaged-certification.yml` and
`macos-signing-smoke.yml`.

## Timeouts

Apple publishes no completion guarantee for notarization, so both numbers come
from measurement. The queue was measured at 74 to 99 minutes on the first
submissions from this Team ID (2026-08-18, #469).

- **Notarization wait: 150 minutes.** About 50% above the slowest observed
  queue. A queue that varies fourfold between measurements and has no published
  ceiling needs headroom, not a value inside the measured band.
- **Job limit: 360 minutes.** Two independently bounded 150-minute waits cover
  the app submission before archive construction and the outer-DMG submission;
  the remaining hour covers packaging, cleanup, and certification. The limit
  must exceed both possible waits so a late notarization fails with a readable
  error rather than a killed job.

Both live at `MACOS_NOTARIZATION_WAIT_MINUTES` and
`MACOS_RELEASE_JOB_TIMEOUT_MINUTES` in `scripts/release-signing/macos-release.mjs`,
with the full rationale at the constants. A test asserts the workflow's job limit
matches the constant and that both exceed the measured maximum.

## Entitlements

One entitlement, `com.apple.security.cs.allow-jit`, because Chromium's
JavaScript engine writes executable pages. The hardened runtime denies
capabilities the app previously got for free, so every entitlement is a hole in
that protection. This set was proven sufficient end to end by the signing smoke.
Do not widen it to make a signing failure go away: a missing entitlement is a
crash with a specific name, and the fix is to name that capability.

## Windows

Windows artifacts stay unsigned. This is a funded decision recorded in spec
#975, not an omission: Eido does not buy an Authenticode certificate, and users
accept one SmartScreen warning at first install. It is made visible rather than
left silent: the builder config, the workflow, the certification gate (which
fails just as hard on an unexpectedly signed Windows artifact as on a broken
signature), and `site/index.html`, which tells a Windows visitor what warning to
expect and how to get past it before they download.

## What only a real dispatch can prove

The configuration is asserted by tests. The lane itself is the authoritative
check (ADR 0028), and it cannot run outside GitHub Actions with the real
identity. Until a real dispatch:

- that Electron Builder accepts this identity and entitlements against the
  production app, embedded Squirrel helper, and two standalone binaries;
- that Apple accepts the production bundle ID `dev.eido.app`, as opposed to the
  smoke's `dev.eido.signing-smoke.macos`;
- that Apple accepts both the app and outer-DMG submissions and that the
  stapled app survives `ditto` archive/extraction with the certified tree;
- that the certification journey (install, launch, uninstall, reinstall)
  behaves identically on a hardened, signed app;
- that each 150-minute wait is enough for this Team ID's steady-state queue.
