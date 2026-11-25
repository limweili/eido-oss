import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import windowsBuilderConfig, {
  windowsSigningSmokeBuildArguments,
} from '../../release/signing-smoke/windows-builder.mjs'
import {
  classifyWindowsSigningIdentityContract,
  verifyWindowsSigningSmoke,
  WINDOWS_SIGNING_IDENTITY_FIELDS,
} from '../release-signing/windows-smoke.mjs'

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..')
const publisher = 'CN=Fixture Publisher, O=Fixture Publisher, C=AU'
const certificateThumbprint = 'A'.repeat(64)

function boundManifest() {
  return {
    schemaVersion: 1,
    scope: '#470',
    artifact: {
      class: 'windows-signing-smoke',
      fileName: 'Eido-Windows-Signing-Smoke-0.0.0-x64.exe',
      platform: 'win32',
      arch: 'x64',
      target: 'nsis',
      version: '0.0.0',
      promotable: false,
      publishPolicy: 'never',
    },
    builder: {
      forceCodeSigning: true,
      verifyUpdateCodeSignature: true,
      publishArgument: 'never',
    },
    identityContract: {
      bindingStatus: 'bound',
      providerClass: 'fixture-hardware-or-cloud-hsm',
      expectedPublisher: publisher,
      expectedCertificateThumbprintSha256: certificateThumbprint,
      trustedTimestampRequired: true,
    },
    lifecycleContract: ['install', 'launch', 'offline-launch', 'uninstall'],
    smartScreenContract: {
      reporting: ['observed', 'not-measurable'],
      warningFreeRequired: false,
    },
  }
}

function validEvidence() {
  return {
    schemaVersion: 1,
    artifact: {
      class: 'windows-signing-smoke',
      fileName: 'Eido-Windows-Signing-Smoke-0.0.0-x64.exe',
      sha256: 'b'.repeat(64),
      platform: 'win32',
      arch: 'x64',
      target: 'nsis',
      version: '0.0.0',
      promotable: false,
      publishPolicy: 'never',
    },
    signer: {
      providerClass: 'fixture-hardware-or-cloud-hsm',
      authenticodeStatus: 'Valid',
      signatures: [{
        publisher,
        certificateThumbprintSha256: certificateThumbprint,
        chainStatus: 'Valid',
        timestamp: {
          status: 'Valid',
          trusted: true,
          protocol: 'rfc3161',
          authority: 'Fixture Timestamp Authority',
          signedAt: '2026-07-19T00:00:00.000Z',
        },
      }],
    },
    lifecycle: {
      install: { status: 'passed', exitCode: 0, installScope: 'per-user' },
      launch: { status: 'passed', exitCode: 0 },
      'offline-launch': {
        status: 'passed',
        exitCode: 0,
        network: 'blocked',
        outboundConnections: 0,
      },
      uninstall: {
        status: 'passed',
        exitCode: 0,
        applicationRemoved: true,
        shortcutsRemoved: true,
        runningProcesses: 0,
      },
    },
    smartScreen: {
      measurement: 'not-measurable',
      reason: 'Fixture execution cannot observe the Windows reputation UI.',
    },
  }
}

test('a bound Windows x64 NSIS smoke normalizes signed lifecycle evidence without becoming promotable', () => {
  assert.equal(classifyWindowsSigningIdentityContract(boundManifest().identityContract), 'bound')
  assert.deepEqual(WINDOWS_SIGNING_IDENTITY_FIELDS, [
    'providerClass',
    'expectedPublisher',
    'expectedCertificateThumbprintSha256',
  ])
  assert.deepEqual(verifyWindowsSigningSmoke({
    manifest: boundManifest(),
    evidence: validEvidence(),
  }), {
    schemaVersion: 1,
    scope: '#470',
    result: 'verified',
    promotable: false,
    artifact: {
      class: 'windows-signing-smoke',
      fileName: 'Eido-Windows-Signing-Smoke-0.0.0-x64.exe',
      sha256: 'b'.repeat(64),
      platform: 'win32',
      arch: 'x64',
      target: 'nsis',
      version: '0.0.0',
      publishPolicy: 'never',
    },
    signingIdentity: {
      providerClass: 'fixture-hardware-or-cloud-hsm',
      expectedPublisher: publisher,
      observedPublisher: publisher,
      expectedCertificateThumbprintSha256: certificateThumbprint,
      observedCertificateThumbprintSha256: certificateThumbprint,
      authenticodeStatus: 'Valid',
      chainStatus: 'Valid',
      trustedTimestamp: {
        status: 'Valid',
        trusted: true,
        protocol: 'rfc3161',
        authority: 'Fixture Timestamp Authority',
        signedAt: '2026-07-19T00:00:00.000Z',
      },
    },
    lifecycle: [
      { phase: 'install', status: 'passed', exitCode: 0, installScope: 'per-user' },
      { phase: 'launch', status: 'passed', exitCode: 0 },
      {
        phase: 'offline-launch',
        status: 'passed',
        exitCode: 0,
        network: 'blocked',
        outboundConnections: 0,
      },
      {
        phase: 'uninstall',
        status: 'passed',
        exitCode: 0,
        applicationRemoved: true,
        shortcutsRemoved: true,
        runningProcesses: 0,
      },
    ],
    smartScreen: {
      measurement: 'not-measurable',
      reason: 'Fixture execution cannot observe the Windows reputation UI.',
    },
  })
})

test('normalized timestamp evidence drops unknown provider fields', () => {
  const evidence = validEvidence()
  evidence.signer.signatures[0].timestamp.providerCredential = 'must-not-escape'
  evidence.signer.signatures[0].timestamp.providerDiagnostic = { requestId: 'private-request' }

  const normalized = verifyWindowsSigningSmoke({
    manifest: boundManifest(),
    evidence,
  })

  assert.deepEqual(normalized.signingIdentity.trustedTimestamp, {
    status: 'Valid',
    trusted: true,
    protocol: 'rfc3161',
    authority: 'Fixture Timestamp Authority',
    signedAt: '2026-07-19T00:00:00.000Z',
  })
  assert.equal('providerCredential' in normalized.signingIdentity.trustedTimestamp, false)
  assert.equal('providerDiagnostic' in normalized.signingIdentity.trustedTimestamp, false)
})

test('signer verification fails closed for a missing, wrong, or ambiguous signer', async (context) => {
  const cases = [
    {
      name: 'missing signer',
      mutate: (evidence) => { evidence.signer.signatures = [] },
      message: /exactly one signer/,
    },
    {
      name: 'wrong signer',
      mutate: (evidence) => {
        evidence.signer.signatures[0].certificateThumbprintSha256 = 'C'.repeat(64)
      },
      message: /certificate thumbprint did not match/,
    },
    {
      name: 'ambiguous signer',
      mutate: (evidence) => { evidence.signer.signatures.push(structuredClone(evidence.signer.signatures[0])) },
      message: /exactly one signer/,
    },
  ]

  for (const fixture of cases) {
    await context.test(fixture.name, () => {
      const evidence = validEvidence()
      fixture.mutate(evidence)
      assert.throws(
        () => verifyWindowsSigningSmoke({ manifest: boundManifest(), evidence }),
        fixture.message,
      )
    })
  }
})

test('signature trust fails closed for an invalid chain, absent timestamp, or publisher mismatch', async (context) => {
  const cases = [
    {
      name: 'invalid certificate chain',
      mutate: (evidence) => { evidence.signer.signatures[0].chainStatus = 'UntrustedRoot' },
      message: /certificate chain was not valid/,
    },
    {
      name: 'absent trusted timestamp',
      mutate: (evidence) => { evidence.signer.signatures[0].timestamp = null },
      message: /trusted timestamp evidence is invalid/,
    },
    {
      name: 'publisher mismatch',
      mutate: (evidence) => { evidence.signer.signatures[0].publisher = 'CN=Different Publisher' },
      message: /publisher did not match/,
    },
  ]

  for (const fixture of cases) {
    await context.test(fixture.name, () => {
      const evidence = validEvidence()
      fixture.mutate(evidence)
      assert.throws(
        () => verifyWindowsSigningSmoke({ manifest: boundManifest(), evidence }),
        fixture.message,
      )
    })
  }
})

test('artifact verification rejects invalid installer identity, publishing, or accidental promotability', async (context) => {
  const cases = [
    {
      name: 'invalid installer identity',
      mutate: (_manifest, evidence) => { evidence.artifact.fileName = 'Eido.exe' },
      message: /artifact identity did not match/,
    },
    {
      name: 'enabled publishing',
      mutate: (_manifest, evidence) => { evidence.artifact.publishPolicy = 'always' },
      message: /publishing policy must be never/,
    },
    {
      name: 'promotable evidence',
      mutate: (_manifest, evidence) => { evidence.artifact.promotable = true },
      message: /must remain non-promotable/,
    },
    {
      name: 'promotable manifest',
      mutate: (manifest) => { manifest.artifact.promotable = true },
      message: /must remain non-promotable/,
    },
  ]

  for (const fixture of cases) {
    await context.test(fixture.name, () => {
      const manifest = boundManifest()
      const evidence = validEvidence()
      fixture.mutate(manifest, evidence)
      assert.throws(() => verifyWindowsSigningSmoke({ manifest, evidence }), fixture.message)
    })
  }
})

test('the NSIS lifecycle fails closed when offline launch or uninstall is incomplete', async (context) => {
  const cases = [
    {
      name: 'offline launch allowed a connection',
      mutate: (evidence) => { evidence.lifecycle['offline-launch'].outboundConnections = 1 },
      message: /offline-launch was not network-isolated/,
    },
    {
      name: 'uninstall left the application behind',
      mutate: (evidence) => { evidence.lifecycle.uninstall.applicationRemoved = false },
      message: /uninstall cleanup was incomplete/,
    },
  ]

  for (const fixture of cases) {
    await context.test(fixture.name, () => {
      const evidence = validEvidence()
      fixture.mutate(evidence)
      assert.throws(
        () => verifyWindowsSigningSmoke({ manifest: boundManifest(), evidence }),
        fixture.message,
      )
    })
  }
})

test('SmartScreen reports either an observed reputation result or an honest not-measurable reason', () => {
  const observed = validEvidence()
  observed.smartScreen = {
    measurement: 'observed',
    verdict: 'warned',
    observedAt: '2026-07-19T00:01:00.000Z',
  }
  assert.deepEqual(
    verifyWindowsSigningSmoke({ manifest: boundManifest(), evidence: observed }).smartScreen,
    observed.smartScreen,
  )

  const unsupportedClaim = validEvidence()
  unsupportedClaim.smartScreen = { measurement: 'not-measurable', reason: '' }
  assert.throws(
    () => verifyWindowsSigningSmoke({ manifest: boundManifest(), evidence: unsupportedClaim }),
    /not-measurable reason is invalid/,
  )
})

test('the checked-in builder and manifest are x64 NSIS-only, unpublished, unbound, and non-promotable', async () => {
  const manifest = JSON.parse(await readFile(
    path.join(repositoryRoot, 'release/signing-smoke/windows-manifest.json'),
    'utf8',
  ))

  assert.deepEqual(manifest, {
    ...boundManifest(),
    identityContract: {
      bindingStatus: 'provider-unselected',
      providerClass: null,
      expectedPublisher: null,
      expectedCertificateThumbprintSha256: null,
      trustedTimestampRequired: true,
    },
  })
  assert.throws(
    () => verifyWindowsSigningSmoke({ manifest, evidence: validEvidence() }),
    /provider identity contract is unbound/,
  )
  assert.equal(classifyWindowsSigningIdentityContract(manifest.identityContract), 'provider-unselected')

  assert.deepEqual(windowsSigningSmokeBuildArguments, [
    '--config',
    'release/signing-smoke/windows-builder.mjs',
    '--win',
    'nsis',
    '--x64',
    '--publish',
    'never',
  ])
  assert.equal(windowsBuilderConfig.forceCodeSigning, true)
  assert.equal(windowsBuilderConfig.extraMetadata.version, '0.0.0')
  assert.equal(windowsBuilderConfig.directories.output, '.local/windows-signing-smoke')
  assert.deepEqual(windowsBuilderConfig.win.target, [{ target: 'nsis', arch: ['x64'] }])
  assert.equal(windowsBuilderConfig.win.signExecutable, true)
  assert.deepEqual(windowsBuilderConfig.win.signExts, ['.exe'])
  assert.equal(windowsBuilderConfig.win.verifyUpdateCodeSignature, true)
  assert.equal(windowsBuilderConfig.nsis.oneClick, true)
  assert.equal(windowsBuilderConfig.nsis.perMachine, false)
  assert.equal(windowsBuilderConfig.nsis.runAfterFinish, false)
  assert.equal(Object.hasOwn(windowsBuilderConfig, 'publish'), false)
  assert.deepEqual(Object.keys(windowsBuilderConfig.win).sort(), [
    'requestedExecutionLevel',
    'signExecutable',
    'signExts',
    'target',
    'verifyUpdateCodeSignature',
  ])
})

test('the CLI emits the same normalized provider-neutral evidence contract', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'eido-windows-signing-smoke-'))
  try {
    const manifestPath = path.join(root, 'manifest.json')
    const evidencePath = path.join(root, 'evidence.json')
    await writeFile(manifestPath, JSON.stringify(boundManifest()), 'utf8')
    await writeFile(evidencePath, JSON.stringify(validEvidence()), 'utf8')

    const result = spawnSync(process.execPath, [
      path.join(repositoryRoot, 'scripts/release-signing/windows-smoke.mjs'),
      '--manifest',
      manifestPath,
      '--evidence',
      evidencePath,
    ], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    })

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(
      JSON.parse(result.stdout),
      verifyWindowsSigningSmoke({ manifest: boundManifest(), evidence: validEvidence() }),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
