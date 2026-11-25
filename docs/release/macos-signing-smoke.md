# macOS signing smoke

> Since #696 the production release lane signs and notarizes every macOS Release with this same identity. See `docs/release/macos-signing.md`. The two lanes share one credential and signature boundary (`scripts/release-signing/macos-identity.mjs`) so they cannot drift apart on what "signed" means; this smoke remains the non-promotable proof lane.

The macOS signing smoke is a manual, non-promotable proof for issue #469. It packages the current `main` revision as an Apple Silicon DMG with a smoke-only identity, then verifies the Developer ID signature, hardened runtime, secure timestamp, notarization staple, Gatekeeper acceptance, DMG copy, network-disabled launch, and cleanup.

This scaffold is not completion evidence. Issue #469 remains open until the workflow succeeds on the exact current `main` SHA with Eido's real release identity.

## Trust boundary

The workflow is intentionally separate from pull-request CI:

- It has only `workflow_dispatch`; it accepts no ref, command, or other input.
- The job runs only when the dispatched ref is `main`, checks that the checkout equals `github.sha`, and uses the read-only, step-scoped workflow token to check that `github.sha` is still the live remote `main` head before signing credentials are read.
- It uses the `macos-signing-smoke` GitHub environment. Configure that environment to allow only the `main` branch and apply the repository's required deployment reviewers.
- The token permission is `contents: read`; checkout credentials are not persisted.
- Packaging always supplies `--publish never`. Neither the builder config nor the workflow contains a publisher.
- Credential material is exposed only to preflight, signing, and outer-DMG notarization, stored below one fixed runner-temporary directory, and removed before the packaged app is launched or any artifact is uploaded. Electron Builder's temporary keychain is confined to the same directory.

## Environment configuration

Place these values in the `macos-signing-smoke` environment. The production release lane binds to the same environment, so these values serve both lanes. Values described as secrets must be GitHub environment secrets; the remaining public identity values are environment variables.

| Name | Kind | Contract |
| --- | --- | --- |
| `EIDO_MACOS_CSC_LINK` | Secret | Single-line base64 of the Developer ID Application `.p12` file. |
| `EIDO_MACOS_CSC_KEY_PASSWORD` | Secret | Password for that `.p12` file. |
| `EIDO_MACOS_NOTARIZATION_API_KEY_BASE64` | Secret | Single-line base64 of the App Store Connect API `.p8` private key. |
| `EIDO_MACOS_NOTARIZATION_API_KEY_ID` | Variable | Ten-character App Store Connect API key ID. |
| `EIDO_MACOS_NOTARIZATION_API_ISSUER` | Variable | App Store Connect issuer UUID. |
| `EIDO_MACOS_EXPECTED_TEAM_ID` | Variable | Ten-character Apple Developer Team ID. |
| `EIDO_MACOS_EXPECTED_AUTHORITY` | Variable | Exact certificate common name, in the form `Developer ID Application: Name (TEAMID)`. |

Preflight decodes the credentials into a private temporary directory, verifies that the certificate is readable and unexpired, and compares its common name and organizational unit to the expected authority and Team ID. Any missing or mismatched value fails before Electron Builder starts.

The smoke needs a Developer ID Application identity. A Developer ID Installer identity is not used for this DMG lane.

## Artifact and evidence contract

The builder uses bundle ID `dev.eido.signing-smoke.macos`, product name `Eido macOS Signing Smoke`, and version `0.0.0`. Its embedded manifest records `promotable: false` and classifies Profile authority as installed, disposable, and not certified; it deliberately has no certification-set identity. Verification launches that authority only against one explicit disposable Profile root and removes the root before any artifact upload.

On success, the workflow retains only:

- `eido-macos-signing-smoke-non-promotable-0.0.0-arm64.dmg`
- `macos-signing-evidence.json`

The signed app is placed into the DMG, then Electron Builder's still-live temporary keychain is used to sign that exact DMG with the Developer ID Application identity, a secure timestamp, and the unique `dev.eido.signing-smoke.macos.dmg` identifier. The builder's incomplete built-in DMG-signing shortcut remains disabled, and update metadata is disabled so signing cannot stale a precomputed blockmap. The final DMG—the bytes that would be distributed—is then submitted to Apple's notary service and stapled. Verification reads back the outer signature, integrity, staple, and Gatekeeper acceptance before mounting it. After credentials are removed, it runs the installed Profile's two-launch stamp/close/offline-reopen proof with Electron offline emulation on the exact window Session and independent `sandbox-exec` network denial, using the same disposable root. The evidence binds the workflow run and exact tested SHA to the certificate authority, Team ID, CDHash, hardened-runtime flag, signed outer-DMG identity and timestamp, accepted outer-DMG notarization and staple, Gatekeeper results, DMG copy, SQLite-backed offline relaunch, and verified cleanup. A before/after SHA-256 comparison also proves that the uploaded DMG did not change during launch verification. It records public identities and hashes only.

On any preflight, packaging, notarization, verification, or cleanup failure, signed or partially signed output is removed. The only uploadable failure file is `failure-diagnostics.json`, which contains a fixed phase and error code without command output, environment state, paths, or credential material.

This smoke's own notarization ceiling is 90 minutes, which sits inside the 74 to 99 minute band later measured for this Team ID: a slow-but-successful submission could still time it out. The production lane uses 150 minutes for that reason (`docs/release/macos-signing.md`). Raising the smoke's ceiling would also mean raising its job limit; it is left as built because it is a proof lane whose failure costs nothing a person sees.

This smoke cannot count as packaged-renderer, candidate, or release-promotion evidence. A successful run proves the #469 signing boundary only; later release work must consume the real publisher contract independently.
