import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign as signDetached } from 'node:crypto'
import test from 'node:test'

import {
  checkArtifactIntegrity,
  checkUpdaterHealth,
  runMaintenanceChecksCli,
} from '../release/maintenance-checks.mjs'

const emptyManifest = {
  schemaVersion: 1,
  manifestKind: 'release-planning',
  platforms: ['darwin-arm64', 'win32-x64'],
  targets: [],
  externalDependencies: [{
    id: 'profile-agent-packaged-certification',
    parentIssue: { number: 520, url: 'https://github.com/limweili/eido/issues/520' },
    issue: { number: 528, url: 'https://github.com/limweili/eido/issues/528' },
    state: 'unresolved',
    targetSha: null,
    certificationSetId: null,
    evidence: [],
  }],
}

// Test-only signing key; production maintenance runs verify against the
// public key compiled into the app.
const signer = generateKeyPairSync('ed25519')
const otherSigner = generateKeyPairSync('ed25519')
const spki = signer.publicKey.export({ format: 'der', type: 'spki' })
const publicKeyHex = Buffer.from(spki.subarray(spki.byteLength - 32)).toString('hex')
const updateZipBytes = Buffer.from('certified macOS update ZIP')
const updateZipSha256 = createHash('sha256').update(updateZipBytes).digest('hex')
const updateZipSha512 = createHash('sha512').update(updateZipBytes).digest('base64')

// A published feed document in the shipped client schema (2, signed).
function feedDocument(overrides = {}) {
  return {
    schemaVersion: 2,
    version: '1.2.3',
    sourceSha: 'a'.repeat(40),
    publishedAt: '2026-07-22T00:00:00.000Z',
    downloadPageUrl: 'https://eido.so',
    platforms: {
      'darwin-arm64': {
        artifactName: 'Eido-1.2.3-darwin-arm64.dmg',
        sha256: 'b'.repeat(64),
        updateArtifact: {
          artifactName: 'Eido-1.2.3-arm64.zip',
          sha256: updateZipSha256,
          sha512: updateZipSha512,
          bytes: updateZipBytes.byteLength,
        },
      },
      'win32-x64': {
        artifactName: 'Eido-1.2.3-win32-x64.exe',
        sha256: 'c'.repeat(64),
      },
    },
    ...overrides,
  }
}

// Serves the three feed assets a shipped client fetches, signed and
// checksummed over the exact manifest bytes.
function signedFeedFetch(document, { fetched, signWith = signer } = {}) {
  const manifestBytes = Buffer.from(JSON.stringify(document))
  const checksum = createHash('sha256').update(manifestBytes).digest('hex')
  const signature = signDetached(null, manifestBytes, signWith.privateKey).toString('base64')
  return async (url) => {
    fetched?.push(url)
    if (url.endsWith('/eido-update.json.sha256')) {
      return new Response(`${checksum}  eido-update.json\n`, { status: 200 })
    }
    if (url.endsWith('/eido-update.json.sig')) {
      return new Response(`${signature}\n`, { status: 200 })
    }
    if (url.endsWith('/latest-mac.yml')) {
      const update = document.platforms['darwin-arm64'].updateArtifact
      return new Response([
        `version: ${document.version}`,
        'files:',
        `  - url: ${update?.artifactName ?? 'missing.zip'}`,
        `    sha512: ${update?.sha512 ?? 'missing'}`,
        `    size: ${String(update?.bytes ?? 0)}`,
        `path: ${update?.artifactName ?? 'missing.zip'}`,
        `sha512: ${update?.sha512 ?? 'missing'}`,
        '',
      ].join('\n'), { status: 200 })
    }
    if (url.endsWith('.zip')) return new Response(updateZipBytes, { status: 200 })
    return new Response(manifestBytes, { status: 200 })
  }
}

function liveManifest() {
  const manifest = structuredClone(emptyManifest)
  manifest.targets.push({
    version: '1.2.3',
    sourceSha: 'a'.repeat(40),
    status: 'promotable',
    promotable: true,
    platformEvidence: [
      { platform: 'darwin-arm64', digest: `sha256:${'b'.repeat(64)}` },
      { platform: 'win32-x64', digest: `sha256:${'c'.repeat(64)}` },
    ],
  })
  return manifest
}

test('no live release skips both checks without contacting a provider', async () => {
  let fetchCalls = 0
  let verificationCalls = 0
  const updater = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: emptyManifest,
    inspectReleasePresence: async () => false,
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('must not fetch')
    },
  })
  const artifacts = await checkArtifactIntegrity({
    repository: 'limweili/eido-releases',
    manifest: emptyManifest,
    inspectReleasePresence: async () => false,
    runPromotion: async () => {
      verificationCalls += 1
      throw new Error('must not verify')
    },
  })

  assert.equal(fetchCalls, 0)
  assert.equal(verificationCalls, 0)
  assert.deepEqual(updater, {
    check: 'updater-health',
    verdict: 'SKIP',
    status: 'skipped',
    reason: 'no-live-release',
    checkedVersions: [],
  })
  assert.deepEqual(artifacts, {
    check: 'public-artifact-integrity',
    verdict: 'SKIP',
    status: 'skipped',
    reason: 'no-live-release',
    checkedVersions: [],
  })
})

test('updater health accepts a signed, checksum-verified schema-2 feed for both release platforms', async () => {
  const fetched = []
  const result = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    fetchImpl: signedFeedFetch(feedDocument(), { fetched }),
    feedPublicKeyHex: publicKeyHex,
  })

  assert.equal(result.verdict, 'PASS')
  assert.equal(result.status, 'healthy')
  assert.deepEqual(result.checkedVersions, ['1.2.3'])
  assert.equal(result.published.version, '1.2.3')
  assert.equal(result.published.sourceSha, 'a'.repeat(40))
  assert.deepEqual(result.published.platforms, ['darwin-arm64', 'win32-x64'])
  // The signature asset is fetched and checked like a shipped client would.
  assert.deepEqual(fetched.sort(), [
    'https://updates.eido.so/Eido-1.2.3-arm64.zip',
    'https://updates.eido.so/eido-update.json',
    'https://updates.eido.so/eido-update.json.sha256',
    'https://updates.eido.so/eido-update.json.sig',
    'https://updates.eido.so/latest-mac.yml',
  ])
})

test('updater health rejects a feed signed by the wrong key: an unsigned feed cannot look healthy', async () => {
  const result = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    fetchImpl: signedFeedFetch(feedDocument(), { signWith: otherSigner }),
    feedPublicKeyHex: publicKeyHex,
  })

  assert.equal(result.verdict, 'BLOCK')
  assert.equal(result.reason, 'update-signature-mismatch')
})

test('updater health rejects the retired unsigned schema 1 the shipped client refuses', async () => {
  const result = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    fetchImpl: signedFeedFetch(feedDocument({ schemaVersion: 1 })),
    feedPublicKeyHex: publicKeyHex,
  })

  assert.equal(result.verdict, 'BLOCK')
  assert.equal(result.reason, 'update-metadata-malformed')
})

test('updater health rejects a published artifact without its installer extension', async () => {
  const result = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    fetchImpl: signedFeedFetch(feedDocument({
      platforms: {
        'darwin-arm64': { artifactName: 'Eido-1.2.3-darwin-arm64.zip', sha256: 'b'.repeat(64) },
        'win32-x64': { artifactName: 'Eido-1.2.3-win32-x64.exe', sha256: 'c'.repeat(64) },
      },
    })),
    feedPublicKeyHex: publicKeyHex,
  })

  assert.equal(result.verdict, 'BLOCK')
  assert.equal(result.reason, 'update-metadata-malformed')
})

test('updater health fails closed when the published checksum does not match the signed bytes', async () => {
  const manifestBytes = Buffer.from(JSON.stringify(feedDocument()))
  const signature = signDetached(null, manifestBytes, signer.privateKey).toString('base64')
  const result = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    fetchImpl: async (url) => {
      if (url.endsWith('/eido-update.json.sha256')) {
        return new Response(`${'0'.repeat(64)}  eido-update.json\n`, { status: 200 })
      }
      if (url.endsWith('/eido-update.json.sig')) {
        return new Response(`${signature}\n`, { status: 200 })
      }
      return new Response(manifestBytes, { status: 200 })
    },
    feedPublicKeyHex: publicKeyHex,
  })

  assert.equal(result.verdict, 'BLOCK')
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'update-checksum-mismatch')
  assert.deepEqual(result.checkedVersions, ['1.2.3'])
})

test('updater health rejects signed metadata missing client-required fields', async () => {
  const document = feedDocument()
  delete document.publishedAt
  const result = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    fetchImpl: signedFeedFetch(document),
    feedPublicKeyHex: publicKeyHex,
  })

  assert.equal(result.verdict, 'BLOCK')
  assert.equal(result.reason, 'update-metadata-malformed')
})

test('updater health rejects a valid feed that still points at an older release target', async () => {
  const manifest = liveManifest()
  manifest.targets.push({
    version: '1.2.4',
    sourceSha: 'd'.repeat(40),
    status: 'promotable',
    promotable: true,
    platformEvidence: [
      { platform: 'darwin-arm64', digest: `sha256:${'e'.repeat(64)}` },
      { platform: 'win32-x64', digest: `sha256:${'f'.repeat(64)}` },
    ],
  })
  const result = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest,
    fetchImpl: signedFeedFetch(feedDocument()),
    feedPublicKeyHex: publicKeyHex,
  })

  assert.equal(result.verdict, 'BLOCK')
  assert.equal(result.reason, 'update-target-mismatch')
})

test('updater health rejects client metadata whose platform digest drifts from planning', async () => {
  const result = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    fetchImpl: signedFeedFetch(feedDocument({
      platforms: {
        'darwin-arm64': {
          artifactName: 'Eido-1.2.3-darwin-arm64.dmg',
          sha256: '9'.repeat(64),
          updateArtifact: feedDocument().platforms['darwin-arm64'].updateArtifact,
        },
        'win32-x64': { artifactName: 'Eido-1.2.3-win32-x64.exe', sha256: 'c'.repeat(64) },
      },
    })),
    feedPublicKeyHex: publicKeyHex,
  })

  assert.equal(result.verdict, 'BLOCK')
  assert.equal(result.reason, 'update-platform-evidence-mismatch')
})

test('updater health rejects stale native metadata and substituted macOS update bytes', async () => {
  const document = feedDocument()
  const fetchHealthy = signedFeedFetch(document)
  const staleMetadata = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    fetchImpl: async (url, options) => url.endsWith('/latest-mac.yml')
      ? new Response('version: 1.2.2\nfiles: []\n', { status: 200 })
      : fetchHealthy(url, options),
    feedPublicKeyHex: publicKeyHex,
  })
  assert.equal(staleMetadata.verdict, 'BLOCK')
  assert.equal(staleMetadata.reason, 'update-target-mismatch')

  const substitutedArchive = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    fetchImpl: async (url, options) => url.endsWith('.zip')
      ? new Response('substituted ZIP bytes', { status: 200 })
      : fetchHealthy(url, options),
    feedPublicKeyHex: publicKeyHex,
  })
  assert.equal(substitutedArchive.verdict, 'BLOCK')
  assert.equal(substitutedArchive.reason, 'update-platform-evidence-mismatch')
})

test('an unexpected public release fails closed instead of looking like no live release', async () => {
  let fetchCalls = 0
  let verifyCalls = 0
  const inspectReleasePresence = async () => true
  const updater = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: emptyManifest,
    inspectReleasePresence,
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('must not fetch feed assets')
    },
  })
  const artifacts = await checkArtifactIntegrity({
    repository: 'limweili/eido-releases',
    manifest: emptyManifest,
    inspectReleasePresence,
    runPromotion: async () => {
      verifyCalls += 1
      throw new Error('must not verify an unplanned version')
    },
  })

  assert.equal(fetchCalls, 0)
  assert.equal(verifyCalls, 0)
  assert.equal(updater.verdict, 'BLOCK')
  assert.equal(updater.reason, 'unplanned-public-release')
  assert.equal(artifacts.verdict, 'BLOCK')
  assert.equal(artifacts.reason, 'unplanned-public-release')
})

test('updater health refuses a redirect before contacting a non-GitHub host', async () => {
  const fetched = []
  const result = await checkUpdaterHealth({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    fetchImpl: async (url) => {
      fetched.push(url)
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/release-asset' },
      })
    },
  })

  assert.equal(result.verdict, 'BLOCK')
  assert.equal(result.reason, 'update-redirect-refused')
  assert.equal(fetched.length, 3)
  assert.ok(fetched.every((url) => new URL(url).hostname === 'updates.eido.so'))
})

test('artifact integrity delegates every expected live release to promotion verify', async () => {
  const calls = []
  const result = await checkArtifactIntegrity({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    manifestPath: '/proof/manifest.json',
    policyPath: '/proof/policy.json',
    runPromotion: async ({ argv, stdout }) => {
      calls.push(argv)
      stdout(JSON.stringify({
        schemaVersion: 1,
        action: 'verify',
        verdict: 'PASS',
        target: 'limweili/eido-releases',
        version: '1.2.3',
      }))
      return 0
    },
  })

  assert.equal(result.verdict, 'PASS')
  assert.equal(result.status, 'healthy')
  assert.deepEqual(result.checkedVersions, ['1.2.3'])
  assert.deepEqual(result.releases, [{ version: '1.2.3', verdict: 'PASS' }])
  assert.deepEqual(calls, [[
    'verify',
    '--repository', 'limweili/eido-releases',
    '--version', '1.2.3',
    '--manifest', '/proof/manifest.json',
    '--policy', '/proof/policy.json',
    '--json',
  ]])
})

test('artifact integrity fails closed on any non-passing verify result', async () => {
  const result = await checkArtifactIntegrity({
    repository: 'limweili/eido-releases',
    manifest: liveManifest(),
    runPromotion: async ({ stdout }) => {
      stdout(JSON.stringify({
        schemaVersion: 1,
        action: 'verify',
        verdict: 'BLOCK',
        reason: 'final-release-evidence-mismatch',
      }))
      return 1
    },
  })

  assert.equal(result.verdict, 'BLOCK')
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'public-artifact-integrity-failed')
  assert.deepEqual(result.releases, [{
    version: '1.2.3',
    verdict: 'BLOCK',
    exitCode: 1,
    reason: 'final-release-evidence-mismatch',
  }])
})

test('maintenance CLI reports the no-live-release state as a successful non-alert', async () => {
  const stdout = []
  const stderr = []
  const exitCode = await runMaintenanceChecksCli({
    argv: ['run', '--repository', 'limweili/eido-releases', '--json'],
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    loadManifest: async () => emptyManifest,
    inspectReleasePresence: async () => false,
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(stderr, [])
  const output = JSON.parse(stdout.join('\n'))
  assert.equal(output.schemaVersion, 1)
  assert.equal(output.action, 'run')
  assert.equal(output.verdict, 'PASS')
  assert.equal(output.checks.updaterHealth.reason, 'no-live-release')
  assert.equal(output.checks.artifactIntegrity.reason, 'no-live-release')
})

test('maintenance CLI exits nonzero when either standing check fails closed', async () => {
  const stdout = []
  const exitCode = await runMaintenanceChecksCli({
    argv: ['run', '--repository', 'limweili/eido-releases', '--json'],
    stdout: (line) => stdout.push(line),
    loadManifest: async () => emptyManifest,
    inspectReleasePresence: async () => false,
    updaterCheck: async () => ({
      check: 'updater-health',
      verdict: 'BLOCK',
      status: 'failed',
      reason: 'update-checksum-mismatch',
      checkedVersions: ['1.2.3'],
    }),
    artifactCheck: async () => ({
      check: 'public-artifact-integrity',
      verdict: 'PASS',
      status: 'healthy',
      checkedVersions: ['1.2.3'],
    }),
  })

  assert.equal(exitCode, 1)
  const output = JSON.parse(stdout.join('\n'))
  assert.equal(output.verdict, 'BLOCK')
  assert.equal(output.checks.updaterHealth.verdict, 'BLOCK')
  assert.equal(output.checks.artifactIntegrity.verdict, 'PASS')
})
