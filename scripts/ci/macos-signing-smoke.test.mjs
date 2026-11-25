import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createDmgSigningArguments,
  createMacosSigningSmokeConfig,
  signMacosSmokeDmg,
} from '../../release/signing-smoke/macos-builder.mjs'
import addProfileMcpSeaEntry, {
  MAC_STANDALONE_BINARIES,
} from '../electron/profile-mcp-sea-after-pack.mjs'
import {
  MACOS_SIGNING_SMOKE_ENVIRONMENT_CONTRACT,
  MACOS_SIGNING_SMOKE_MANIFEST,
  assertAcceptedNotarytoolResult,
  assertCertificateIdentity,
  assertMacosSigningSmokeManifest,
  assertStableArtifactHash,
  createDmgNotarizationArguments,
  createOfflineLaunchEnvironment,
  normalizedFailureEvidence,
  parseCodeSignature,
  parseDmgSignature,
  profileProofRootPrefix,
  validateMacosSigningEnvironment,
} from '../release-signing/macos-smoke.mjs'

test('the smoke owns the founder-provisioned environment name contract', () => {
  assert.deepEqual(Object.values(MACOS_SIGNING_SMOKE_ENVIRONMENT_CONTRACT.secrets), [
    'EIDO_MACOS_CSC_LINK',
    'EIDO_MACOS_CSC_KEY_PASSWORD',
    'EIDO_MACOS_NOTARIZATION_API_KEY_BASE64',
  ])
  assert.deepEqual(Object.values(MACOS_SIGNING_SMOKE_ENVIRONMENT_CONTRACT.variables), [
    'EIDO_MACOS_NOTARIZATION_API_KEY_ID',
    'EIDO_MACOS_NOTARIZATION_API_ISSUER',
    'EIDO_MACOS_EXPECTED_TEAM_ID',
    'EIDO_MACOS_EXPECTED_AUTHORITY',
  ])
})

const workflow = readFileSync(
  new URL('../../.github/workflows/macos-signing-smoke.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n')
const manifest = JSON.parse(readFileSync(
  new URL('../../release/signing-smoke/macos-manifest.json', import.meta.url),
  'utf8',
))
const packageManifest = JSON.parse(readFileSync(
  new URL('../../package.json', import.meta.url),
  'utf8',
))

const testedSha = 'a'.repeat(40)
const expectedTeamId = 'A1B2C3D4E5'
const expectedAuthority = `Developer ID Application: Eido Smoke (${expectedTeamId})`

function validEnvironment(overrides = {}) {
  return {
    EIDO_MACOS_CSC_LINK: Buffer.from('synthetic-p12-fixture').toString('base64'),
    EIDO_MACOS_CSC_KEY_PASSWORD: 'synthetic-password',
    EIDO_MACOS_NOTARIZATION_API_KEY_BASE64: Buffer.from(
      '-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----\n',
    ).toString('base64'),
    EIDO_MACOS_NOTARIZATION_API_KEY_ID: 'A1B2C3D4E5',
    EIDO_MACOS_NOTARIZATION_API_ISSUER: '11111111-2222-3333-4444-555555555555',
    EIDO_MACOS_EXPECTED_TEAM_ID: expectedTeamId,
    EIDO_MACOS_EXPECTED_AUTHORITY: expectedAuthority,
    EIDO_MACOS_TESTED_SHA: testedSha,
    EIDO_MACOS_RUN_ID: '12345',
    EIDO_MACOS_RUN_ATTEMPT: '2',
    RUNNER_TEMP: '/tmp/eido-runner',
    ...overrides,
  }
}

test('preflight fails closed for every missing credential and expected identity field', () => {
  for (const field of [
    'EIDO_MACOS_CSC_LINK',
    'EIDO_MACOS_CSC_KEY_PASSWORD',
    'EIDO_MACOS_NOTARIZATION_API_KEY_BASE64',
    'EIDO_MACOS_NOTARIZATION_API_KEY_ID',
    'EIDO_MACOS_NOTARIZATION_API_ISSUER',
    'EIDO_MACOS_EXPECTED_TEAM_ID',
    'EIDO_MACOS_EXPECTED_AUTHORITY',
    'EIDO_MACOS_TESTED_SHA',
    'EIDO_MACOS_RUN_ID',
    'EIDO_MACOS_RUN_ATTEMPT',
    'RUNNER_TEMP',
  ]) {
    assert.throws(
      () => validateMacosSigningEnvironment(validEnvironment({ [field]: '' })),
      /macos-signing-preflight-invalid/,
      field,
    )
  }
})

test('preflight returns only public identity and fixed credential paths', () => {
  const result = validateMacosSigningEnvironment(validEnvironment())

  assert.deepEqual(result, {
    expectedTeamId,
    expectedAuthority,
    // The Electron Builder identity selector: the certificate common name
    // without its `Developer ID Application: ` prefix.
    identityQualifier: 'Eido Smoke (A1B2C3D4E5)',
    runnerTemp: '/tmp/eido-runner',
    notarizationApiKeyId: 'A1B2C3D4E5',
    notarizationApiIssuer: '11111111-2222-3333-4444-555555555555',
    testedSha,
    runId: '12345',
    runAttempt: '2',
    verificationPrefix: '/tmp/eido-runner/eido-macos-signing-verify-',
    credentialRoot: '/tmp/eido-runner/eido-macos-signing-smoke',
    certificatePath: '/tmp/eido-runner/eido-macos-signing-smoke/certificate.p12',
    certificatePemPath: '/tmp/eido-runner/eido-macos-signing-smoke/certificate.pem',
    notarizationKeyPath: '/tmp/eido-runner/eido-macos-signing-smoke/notarization-key.p8',
    entitlementsPath: '/tmp/eido-runner/eido-macos-signing-smoke/entitlements.plist',
  })
  assert.doesNotMatch(JSON.stringify(result), /synthetic-password|synthetic-p12-fixture|BEGIN PRIVATE KEY/)
})

test('preflight rejects malformed identity values without reflecting secrets', () => {
  for (const overrides of [
    { EIDO_MACOS_CSC_LINK: 'not base64' },
    { EIDO_MACOS_NOTARIZATION_API_KEY_BASE64: Buffer.from('not a private key').toString('base64') },
    { EIDO_MACOS_NOTARIZATION_API_KEY_ID: 'short' },
    { EIDO_MACOS_NOTARIZATION_API_ISSUER: 'not-a-uuid' },
    { EIDO_MACOS_EXPECTED_TEAM_ID: 'short' },
    { EIDO_MACOS_EXPECTED_AUTHORITY: 'Apple Distribution: Wrong Kind (A1B2C3D4E5)' },
    { EIDO_MACOS_EXPECTED_AUTHORITY: 'Developer ID Application: Wrong Team (Z9Y8X7W6V5)' },
    { EIDO_MACOS_TESTED_SHA: 'not-a-sha' },
  ]) {
    const secret = 'never-reflect-this-value'
    assert.throws(
      () => validateMacosSigningEnvironment(validEnvironment({
        EIDO_MACOS_CSC_KEY_PASSWORD: secret,
        ...overrides,
      })),
      (error) => error.message === 'macos-signing-preflight-invalid' && !error.message.includes(secret),
    )
  }
})

test('manifest is fixed, non-promotable, and carries no certification-set identity', () => {
  assert.deepEqual(manifest, MACOS_SIGNING_SMOKE_MANIFEST)
  assert.deepEqual(assertMacosSigningSmokeManifest(manifest), manifest)
  assert.deepEqual(manifest.profileAuthority, {
    state: 'installed',
    dataRoot: 'disposable',
    certification: 'not-certified',
  })
  assert.equal(Object.hasOwn(manifest, 'certificationSetId'), false)
  assert.throws(
    () => assertMacosSigningSmokeManifest({ ...manifest, promotable: true }),
    /macos-signing-manifest-invalid/,
  )
  assert.throws(
    () => assertMacosSigningSmokeManifest({ ...manifest, certificationSetId: 'forbidden' }),
    /macos-signing-manifest-invalid/,
  )
})

test('signature parser requires exact Developer ID authority, Team ID, runtime, timestamp, and CDHash', () => {
  const source = [
    'Executable=/Volumes/Eido/Eido.app/Contents/MacOS/Eido',
    'Identifier=dev.eido.signing-smoke.macos',
    'Format=app bundle with Mach-O thin (arm64)',
    'CodeDirectory v=20500 size=999 flags=0x10000(runtime) hashes=20+7 location=embedded',
    'CDHash=0123456789abcdef0123456789abcdef01234567',
    'Signature size=9000',
    `Authority=${expectedAuthority}`,
    'Authority=Developer ID Certification Authority',
    'Authority=Apple Root CA',
    'Timestamp=20 Jul 2026 at 1:23:45 am',
    `TeamIdentifier=${expectedTeamId}`,
  ].join('\n')

  assert.deepEqual(parseCodeSignature(source, { expectedAuthority, expectedTeamId }), {
    authority: expectedAuthority,
    teamIdentifier: expectedTeamId,
    cdHash: '0123456789abcdef0123456789abcdef01234567',
    hardenedRuntime: true,
    secureTimestamp: true,
  })

  for (const altered of [
    source.replace(expectedAuthority, `Developer ID Application: Other (${expectedTeamId})`),
    source.replace(`TeamIdentifier=${expectedTeamId}`, 'TeamIdentifier=Z9Y8X7W6V5'),
    source.replace('flags=0x10000(runtime)', 'flags=0x0(none)'),
    source.replace('Timestamp=20 Jul 2026 at 1:23:45 am\n', ''),
    source.replace('CDHash=0123456789abcdef0123456789abcdef01234567\n', ''),
  ]) {
    assert.throws(
      () => parseCodeSignature(altered, { expectedAuthority, expectedTeamId }),
      /macos-signature-invalid/,
    )
  }
})

test('DMG signature parser requires the smoke identifier, exact identity, timestamp, and CDHash', () => {
  const source = [
    'Executable=/tmp/eido-smoke.dmg',
    'Identifier=dev.eido.signing-smoke.macos.dmg',
    'Format=disk image',
    'CodeDirectory v=20200 size=555 flags=0x0(none) hashes=1+0 location=embedded',
    'CDHash=abcdef0123456789abcdef0123456789abcdef01',
    `Authority=${expectedAuthority}`,
    'Authority=Developer ID Certification Authority',
    'Authority=Apple Root CA',
    'Timestamp=20 Jul 2026 at 1:23:45 am',
    `TeamIdentifier=${expectedTeamId}`,
  ].join('\n')

  assert.deepEqual(parseDmgSignature(source, { expectedAuthority, expectedTeamId }), {
    identifier: 'dev.eido.signing-smoke.macos.dmg',
    authority: expectedAuthority,
    teamIdentifier: expectedTeamId,
    cdHash: 'abcdef0123456789abcdef0123456789abcdef01',
    secureTimestamp: true,
  })

  for (const altered of [
    source.replace('dev.eido.signing-smoke.macos.dmg', 'dev.eido.wrong'),
    source.replace(expectedAuthority, `Developer ID Application: Other (${expectedTeamId})`),
    source.replace(`TeamIdentifier=${expectedTeamId}`, 'TeamIdentifier=Z9Y8X7W6V5'),
    source.replace('Timestamp=20 Jul 2026 at 1:23:45 am\n', ''),
    source.replace('CDHash=abcdef0123456789abcdef0123456789abcdef01\n', ''),
  ]) {
    assert.throws(
      () => parseDmgSignature(altered, { expectedAuthority, expectedTeamId }),
      /macos-dmg-signature-invalid/,
    )
  }
})

test('certificate preflight requires the exact authority and Team ID from the p12 subject', () => {
  const identity = { expectedAuthority, expectedTeamId }
  assert.doesNotThrow(() => assertCertificateIdentity(
    `subject=CN=${expectedAuthority},OU=${expectedTeamId},O=Eido`,
    identity,
  ))
  assert.throws(
    () => assertCertificateIdentity(
      `subject=CN=Developer ID Application: Other (${expectedTeamId}),OU=${expectedTeamId},O=Eido`,
      identity,
    ),
    /certificate-authority-mismatch/,
  )
  assert.throws(
    () => assertCertificateIdentity(
      `subject=CN=${expectedAuthority},OU=Z9Y8X7W6V5,O=Eido`,
      identity,
    ),
    /certificate-team-mismatch/,
  )
})

test('builder config signs a hardened arm64 DMG for explicit outer notarization with no publisher', () => {
  const config = createMacosSigningSmokeConfig(validEnvironment())

  assert.equal(config.appId, manifest.appId)
  assert.equal(config.productName, manifest.productName)
  assert.equal(config.extraMetadata.version, '0.0.0')
  assert.equal(config.forceCodeSigning, true)
  assert.equal(config.afterPack, addProfileMcpSeaEntry)
  assert.equal(config.mac.identity, `Eido Smoke (${expectedTeamId})`)
  assert.deepEqual(config.mac.binaries, MAC_STANDALONE_BINARIES)
  assert.equal(config.mac.hardenedRuntime, true)
  assert.equal(config.mac.notarize, false)
  assert.equal(config.mac.entitlements, '/tmp/eido-runner/eido-macos-signing-smoke/entitlements.plist')
  assert.equal(config.mac.entitlementsInherit, config.mac.entitlements)
  assert.deepEqual(config.mac.target, [{ target: 'dmg', arch: ['arm64'] }])
  assert.equal(config.dmg.sign, false)
  assert.equal(config.dmg.writeUpdateInfo, false)
  assert.equal(typeof config.artifactBuildCompleted, 'function')
  assert.equal(config.publish, undefined)
  assert.equal(config.mac.publish, undefined)
  assert.equal(config.dmg.publish, undefined)
  assert.equal(config.directories.output, '.local/macos-signing-smoke')
  assert.equal(config.artifactName, 'eido-macos-signing-smoke-non-promotable-0.0.0-arm64.${ext}')
  assert.deepEqual(config.extraResources, [
    { from: 'electron/shell-manifest.json', to: 'shell-manifest.json' },
    { from: 'release/signing-smoke/macos-manifest.json', to: 'macos-manifest.json' },
  ])
  assert.deepEqual(config.electronFuses, {
    resetAdHocDarwinSignature: true,
    runAsNode: false,
    enableCookieEncryption: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  })
})

test('builder hook explicitly signs only the expected DMG while its temporary keychain is live', async () => {
  const dmgPath = path.resolve(
    '.local',
    'macos-signing-smoke',
    'eido-macos-signing-smoke-non-promotable-0.0.0-arm64.dmg',
  )
  const keychainFile = '/tmp/eido-runner/eido-macos-signing-smoke/builder.keychain'
  const identity = { expectedAuthority, expectedTeamId }
  const expectedArguments = [
    '--sign', expectedAuthority,
    '--timestamp',
    '--identifier', 'dev.eido.signing-smoke.macos.dmg',
    '--keychain', keychainFile,
    dmgPath,
  ]
  assert.deepEqual(createDmgSigningArguments(identity, keychainFile, dmgPath), expectedArguments)

  const invocations = []
  await signMacosSmokeDmg({
    file: dmgPath,
    target: { name: 'dmg' },
    packager: { codeSigningInfo: { value: Promise.resolve({ keychainFile }) } },
  }, identity, async (...args) => invocations.push(args))
  assert.deepEqual(invocations, [[
    '/usr/bin/codesign',
    expectedArguments,
    { timeout: 60_000, windowsHide: true },
  ]])

  await assert.rejects(
    signMacosSmokeDmg({
      file: path.join(path.dirname(dmgPath), 'other.dmg'),
      target: { name: 'dmg' },
      packager: { codeSigningInfo: { value: Promise.resolve({ keychainFile }) } },
    }, identity, async () => {}),
    /macos-dmg-signing-context-invalid/,
  )
})

test('outer DMG notarization waits for acceptance and never embeds credential values in arguments', () => {
  const identity = validateMacosSigningEnvironment(validEnvironment())
  assert.deepEqual(createDmgNotarizationArguments(identity, '/tmp/smoke.dmg'), [
    'notarytool',
    'submit',
    '/tmp/smoke.dmg',
    '--wait',
    '--output-format', 'json',
    '--key', '/tmp/eido-runner/eido-macos-signing-smoke/notarization-key.p8',
    '--key-id', 'A1B2C3D4E5',
    '--issuer', '11111111-2222-3333-4444-555555555555',
  ])
  assert.deepEqual(assertAcceptedNotarytoolResult('{"status":"Accepted","id":"public-id"}'), {
    status: 'Accepted',
  })
  assert.throws(() => assertAcceptedNotarytoolResult('{"status":"Invalid"}'), /dmg-notarization-rejected/)
  assert.throws(() => assertAcceptedNotarytoolResult('not-json'), /dmg-notarization-rejected/)
})

test('verified DMG bytes must remain identical through offline launch and cleanup', () => {
  const hash = 'a'.repeat(64)
  assert.equal(assertStableArtifactHash(hash, hash), hash)
  assert.throws(() => assertStableArtifactHash(hash, 'b'.repeat(64)), /dmg-changed-after-verification/)
})

test('failure evidence is normalized and omits diagnostic and credential material', () => {
  const result = normalizedFailureEvidence('package', validEnvironment(), new Error('never-upload-this'))
  assert.deepEqual(result, {
    schemaVersion: 1,
    evidenceKind: 'macos-signing-smoke-failure-diagnostic',
    scope: '#469',
    promotable: false,
    testedSha,
    runId: '12345',
    runAttempt: '2',
    phase: 'package',
    code: 'macos-signing-smoke-failed',
  })
  assert.doesNotMatch(JSON.stringify(result), /never-upload-this|synthetic-password|BEGIN PRIVATE KEY/)
})

test('offline launch inherits only a narrow runtime allowlist, never runner or signing credentials', () => {
  const environment = createOfflineLaunchEnvironment({
    HOME: '/Users/runner',
    PATH: '/usr/bin:/bin',
    TMPDIR: '/tmp',
    GITHUB_TOKEN: 'actions-runtime-secret',
    ACTIONS_RUNTIME_TOKEN: 'actions-internal-secret',
    CSC_KEY_PASSWORD: 'signing-secret',
    APPLE_API_KEY: '/tmp/notarization-key.p8',
    NODE_OPTIONS: '--inspect',
    ELECTRON_RUN_AS_NODE: '1',
  })

  assert.deepEqual(environment, {
    HOME: '/Users/runner',
    PATH: '/usr/bin:/bin',
    TMPDIR: '/tmp',
  })
  assert.doesNotMatch(JSON.stringify(environment), /secret|GITHUB|ACTIONS|CSC|APPLE|NODE_OPTIONS|ELECTRON_RUN_AS_NODE/)
})

test('offline launch uses one disposable installed Profile root', () => {
  const temporaryRoot = path.resolve('synthetic-profile-temp')
  const prefix = profileProofRootPrefix(temporaryRoot)
  assert.equal(path.dirname(prefix), temporaryRoot)
  assert.match(path.basename(prefix), /^eido-profile-signing-/)
})

test('workflow builds the packaged Profile proof path required by its verifier', () => {
  const rendererBuild = workflowStep('Build the current renderer and Electron boundary')

  assert.match(rendererBuild, /npm run build -- --mode desktop-proof/)
  assert.match(rendererBuild, /npm run build:electron/)
  assert.doesNotMatch(packageManifest.scripts.build, /desktop-proof/)
  assert.match(packageManifest.scripts.desktop, /npm run build -- --mode desktop-proof/)
  assert.match(packageManifest.scripts['release:package'], /npm run build -- --mode desktop-proof/)
})

test('workflow is manual exact-main only and keeps credential and artifact boundaries narrow', () => {
  assert.match(workflow, /^name: macOS signing smoke\n\non:\n  workflow_dispatch:\n/m)
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|workflow_call|schedule):/m)
  assert.doesNotMatch(workflow, /workflow_dispatch:\n\s+inputs:/)
  assert.match(workflow, /permissions:\n  contents: read\n/)
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /environment: macos-signing-smoke/)
  assert.match(workflow, /runs-on: macos-15/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false/)
  const exactMain = workflowStep('Verify the exact current main revision')
  assert.match(exactMain, /GH_TOKEN: \$\{\{ github\.token \}\}/)
  assert.match(exactMain, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/git\/ref\/heads\/main" --jq '\.object\.sha'/)
  assert.doesNotMatch(exactMain, /git ls-remote/)
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/)
  assert.match(workflow, /test "\$current_main" = "\$GITHUB_SHA"/)
  assert.match(workflow, /node-version-file: \.github\/node-version/)
  assert.match(workflow, /npx --no-install electron-builder .* --mac dmg --arm64 --publish never/)
  assert.doesNotMatch(workflow, /(?:printenv|export\s+-p|env\s*$|set\s*$)/m)

  for (const action of [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
  ]) assert.match(workflow, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  const preflight = workflowStep('Preflight the signing identity before packaging')
  const packaging = workflowStep('Build the non-promotable signed DMG')
  const notarization = workflowStep('Notarize and staple the distributed DMG')
  const cleanup = workflowStep('Remove signing credentials from the runner')
  const verification = workflowStep('Verify signing, notarization, install, offline launch, and cleanup')
  const successUpload = workflowStep('Upload verified signed smoke bytes')
  const failureUpload = workflowStep('Upload normalized failure diagnostics')

  assert.match(preflight, /EIDO_MACOS_CSC_LINK: \$\{\{ secrets\.EIDO_MACOS_CSC_LINK \}\}/)
  assert.match(preflight, /EIDO_MACOS_NOTARIZATION_API_KEY_BASE64: \$\{\{ secrets\.EIDO_MACOS_NOTARIZATION_API_KEY_BASE64 \}\}/)
  assert.match(packaging, /CSC_KEY_PASSWORD: \$\{\{ secrets\.EIDO_MACOS_CSC_KEY_PASSWORD \}\}/)
  assert.match(packaging, /APP_BUILDER_TMP_DIR: \$\{\{ runner\.temp \}\}\/eido-macos-signing-smoke/)
  assert.doesNotMatch(packaging, /EIDO_MACOS_CSC_LINK:|EIDO_MACOS_NOTARIZATION_API_KEY_BASE64:/)
  assert.doesNotMatch(packaging, /CSC_NAME:|APPLE_API_/)
  assert.match(packaging, /EIDO_MACOS_TESTED_SHA: \$\{\{ github\.sha \}\}/)
  assert.match(notarization, /node scripts\/release-signing\/macos-smoke\.mjs notarize-dmg/)
  assert.doesNotMatch(notarization, /secrets\./)
  assert.match(cleanup, /if: \$\{\{ always\(\) \}\}/)
  assert.doesNotMatch(verification, /secrets\.|CSC_|APPLE_API_|EIDO_MACOS_NOTARIZATION_/)

  for (const [before, after] of [
    ['Preflight the signing identity before packaging', 'Build the non-promotable signed DMG'],
    ['Build the non-promotable signed DMG', 'Notarize and staple the distributed DMG'],
    ['Notarize and staple the distributed DMG', 'Remove signing credentials from the runner'],
    ['Remove signing credentials from the runner', 'Verify signing, notarization, install, offline launch, and cleanup'],
    ['Verify signing, notarization, install, offline launch, and cleanup', 'Upload verified signed smoke bytes'],
  ]) assert.ok(workflow.indexOf(`      - name: ${before}\n`) < workflow.indexOf(`      - name: ${after}\n`))

  assert.match(successUpload, /if: \$\{\{ success\(\) \}\}/)
  assert.match(successUpload, /\.local\/macos-signing-smoke\/eido-macos-signing-smoke-non-promotable-0\.0\.0-arm64\.dmg/)
  assert.match(successUpload, /\.local\/macos-signing-smoke\/macos-signing-evidence\.json/)
  assert.doesNotMatch(successUpload, /failure-diagnostics/)
  assert.match(failureUpload, /if: \$\{\{ failure\(\) \}\}/)
  assert.match(failureUpload, /\.local\/macos-signing-smoke\/failure-diagnostics\.json/)
  assert.doesNotMatch(failureUpload, /\.dmg|macos-signing-evidence/)
})

function workflowStep(name) {
  const marker = `      - name: ${name}\n`
  const start = workflow.indexOf(marker)
  assert.notEqual(start, -1, `missing workflow step: ${name}`)
  const next = workflow.indexOf('\n      - name: ', start + marker.length)
  return workflow.slice(start, next === -1 ? workflow.length : next).trimEnd()
}
