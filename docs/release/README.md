# Release signing

For free/BYOK publication preparation, start with
[`Before a public release`](before-beta.md) and the
[open-source handover](../agents/open-source-handover.md).

[`macos-signing.md`](macos-signing.md) is the production lane: how every
published macOS Release is signed with Eido's Developer ID, hardened,
notarized, stapled, and verified before anything is uploaded. Read that one
first if the question is about a Release a person installs.

The remaining runbooks document isolated, non-promotable platform-signing
proofs. The corresponding build manifests live in `release/signing-smoke/`,
automation in `.github/workflows/`, and verification code in
`scripts/release-signing/`.

| Platform | Proof runbook |
| --- | --- |
| macOS arm64 | [`macos-signing-smoke.md`](macos-signing-smoke.md) |
| Windows x64 | [`windows-signing-smoke.md`](windows-signing-smoke.md) |

One founder-only procedure also lives here:
[`update-signing-key-ceremony.md`](update-signing-key-ceremony.md) generates
the Ed25519 key that signs every Update Manifest (#793, ADR 0032), including
the mandatory offline backup performed before the key is first used. That key is
used by `Desktop release publication`, not by any lane documented here; the
release path that consumes it is
[`Desktop Release Captain`](../agents/desktop-release-captain.md).

Neither smoke is a release-candidate or updater contract. Each runbook states
its own identity, evidence, cleanup, and promotion boundaries.

The founder-only identity and purchasing actions each smoke ultimately depends
on (Apple Developer enrollment, Windows Authenticode provider onboarding) are
guided by the
[Founder Setup Coach](../agents/founder-setup-coach.md), not by these runbooks.

## Current updater acceptance

The production release lane is now proven through the first installed macOS
Squirrel update: a certified 0.1.17 installation accepted one consent click and
re-launched as certified 0.1.18. The updater-only evidence is recorded in
[`17-macos-0.1.17-to-0.1.18-field-proof.md`](../../research/05-production-release/17-macos-0.1.17-to-0.1.18-field-proof.md).

The repeatable release path remains:

- macOS certification signs, notarizes, staples, and binds one human-download
  DMG to one exact Squirrel ZIP (including `latest-mac.yml`, `app-update.yml`,
  and the signed ShipIt helper); Windows certifies the NSIS EXE separately.
- Publication uploads only those certified bytes, generates the signed Eido
  manifest, publishes `latest-mac.yml` and the versioned ZIP, then verifies the
  live feed, ZIP hashes, and stable download aliases.
- macOS Eido owns signed-feed authorization and Profile quiescence; Squirrel
  owns bundle replacement and relaunch. Windows keeps its signed-manifest →
  verified NSIS → joined drain → detached launcher handoff.

The active operating procedures are
[`Desktop Release Captain`](../agents/desktop-release-captain.md),
[`Packaged certification`](../agents/packaged-certification.md),
[`macOS signing`](macos-signing.md), and
[`Release profile`](../agents/release-profile.md). The historical incident
notes are explicitly marked historical; no older DMG-swap instructions override
the current Squirrel lane.
