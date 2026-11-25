# Windows signing smoke scaffold

Status: provider-neutral scaffold for issue #470. No Windows publisher identity,
signing provider, signing credential, signed artifact, or SmartScreen result
exists yet. This scaffold cannot complete #470.

## Boundary

The Windows signing smoke is a native Windows x64 NSIS proof of one exact
publisher identity and one exact installer lifecycle. It is deliberately
separate from Eido release candidates and packaged-renderer evidence.

The checked-in policy is mechanically non-promotable:

- the package version is `0.0.0`;
- the app ID, product name, installer name, and output directory all say
`windows-signing-smoke`;
- `promotable` is `false` and `publishPolicy` is `never`;
- electron-builder has no publish provider and must be invoked with
  `--publish never`;
- the artifact embeds `windows-signing-smoke-manifest.json`; and
- verification always emits `promotable: false`.

It must not count as a release candidate, ticket-23 evidence, or sealed
renderer evidence. It does not add an updater or any #467/#468 consumer.

## Provider-neutral build policy

[`windows-builder.mjs`](../../release/signing-smoke/windows-builder.mjs) is a
Windows x64, NSIS-only electron-builder configuration. It requires executable
signing with `forceCodeSigning: true`, retains
`verifyUpdateCodeSignature: true`, and contains no vendor account, exported-key,
certificate-file, certificate-link, or provider-specific signing option.

Until an eligible provider is selected, a real packaging attempt is expected
to fail because signing is mandatory and no signer exists. Do not weaken
`forceCodeSigning`, add a fake signer, or add a disabled credential workflow to
make the scaffold appear runnable.

After provider selection, the native Windows lane builds the renderer and
Electron bundles with the declared repository toolchain, then invokes the
builder with the exact arguments exported by the configuration. The equivalent
explicit packaging command is:

```powershell
npm exec -- electron-builder --config release/signing-smoke/windows-builder.mjs --win nsis --x64 --publish never
```

The provider integration supplies its signer through the mechanism chosen for
that provider. This document intentionally does not prescribe credential names,
key export, a vendor SDK, or a cloud account shape.

## Publisher identity contract

[`windows-manifest.json`](../../release/signing-smoke/windows-manifest.json) is
checked in with `bindingStatus: provider-unselected` and null identity fields.
That is an explicit blocker, not a placeholder identity. The verifier rejects
the checked-in manifest.

When an eligible provider and verified Australian organization identity exist,
an identity-authorized change binds all three public, non-secret values:

| Field | Required value |
| --- | --- |
| `providerClass` | Exact provider class recorded by the selected integration, without credential material |
| `expectedPublisher` | Exact Authenticode publisher subject expected on the installer |
| `expectedCertificateThumbprintSha256` | Uppercase 64-hex SHA-256 certificate fingerprint, without separators |

The binding changes `bindingStatus` to `bound`. The trusted-timestamp
requirement remains `true`. Evidence is valid only when exactly one signer
matches the bound publisher and fingerprint, the Authenticode status and chain
are valid, and a trusted RFC 3161 timestamp is present. The expected and
observed identity are both retained in normalized output for later #467/#468
consumers.

## Native evidence input

The future credentialed Windows lane produces one JSON evidence document for
the exact installer. The scaffold does not forge or collect this evidence. The
fixture in
[`windows-signing-smoke.test.mjs`](../../scripts/ci/windows-signing-smoke.test.mjs)
is inert test data, not a certificate, credential, or signer.

The evidence contract is:

- `artifact`: exact smoke class, filename, SHA-256, `win32`, `x64`, `nsis`,
  version `0.0.0`, `promotable: false`, and `publishPolicy: never`;
- `signer`: provider class, `authenticodeStatus: Valid`, and exactly one
  signature containing publisher, SHA-256 certificate fingerprint, valid
  chain, and trusted RFC 3161 timestamp evidence;
- `lifecycle.install`: passed, exit code zero, per-user install;
- `lifecycle.launch`: passed and exit code zero;
- `lifecycle.offline-launch`: passed with network blocked and zero observed
  outbound connections;
- `lifecycle.uninstall`: passed with application and shortcuts removed and no
  remaining process; and
- `smartScreen`: either an observed result or an honest reason that the exact
  artifact was not measurable.

The verifier is intentionally fail-closed for missing, wrong, or multiple
signers; publisher or fingerprint mismatch; invalid chain; absent or invalid
timestamp; installer-identity drift; publishing; incomplete lifecycle evidence;
and accidental promotability.

Verify a native evidence file with:

```powershell
node scripts/release-signing/windows-smoke.mjs --manifest release/signing-smoke/windows-manifest.json --evidence <native-evidence.json>
```

The command prints normalized JSON on success and exits nonzero on any contract
violation. Before provider binding, it always exits nonzero because the checked-
in identity contract is unbound.

## SmartScreen truth

SmartScreen reputation is independent of a valid OV or EV signature. Record
one of these shapes for the exact installer:

- `measurement: observed`, with verdict `allowed`, `warned`, or `blocked` and a
  canonical UTC observation time; or
- `measurement: not-measurable`, with a non-empty reason.

A valid signature never implies a warning-free first download. Do not translate
`not-measurable` into success, and do not use a fixture or API response as a
substitute for an observed Windows reputation UI.

## Completion boundary

Issue #470 remains open until an eligible real provider is selected and an
exact native artifact passes signing, install, launch, offline launch,
uninstall, identity-mismatch refusal, and honest SmartScreen reporting. No
workflow should be added before provider selection because there is currently
no credentialed operation for it to perform.
