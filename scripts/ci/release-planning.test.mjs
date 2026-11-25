import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  CERTIFICATION_DEPENDENCY_ID,
  classifyCertificationDependency,
  declareReleaseTarget,
  LOCKED_RELEASE_PLATFORMS,
  resolveCertificationDependency,
  runReleasePlanningCli,
  transitionReleaseTargetStatus,
  validateReleasePlanningManifest,
} from '../release/release-planning.mjs'

const packageManifest = JSON.parse(await readFile(
  new URL('../../package.json', import.meta.url),
  'utf8',
))
const sourceSha = 'a'.repeat(40)
const otherSourceSha = 'b'.repeat(40)
const digest = (character) => `sha256:${character.repeat(64)}`

function unresolvedDependency() {
  return {
    id: CERTIFICATION_DEPENDENCY_ID,
    parentIssue: {
      number: 520,
      url: 'https://github.com/limweili/eido/issues/520',
    },
    issue: {
      number: 528,
      url: 'https://github.com/limweili/eido/issues/528',
    },
    state: 'unresolved',
    targetSha: null,
    certificationSetId: null,
    evidence: [],
  }
}

function resolvedDependency(sha = sourceSha) {
  return {
    ...unresolvedDependency(),
    state: 'resolved',
    targetSha: sha,
    certificationSetId: 'fixture-certification-set',
    evidence: [
      { kind: 'certification-manifest', digest: digest('1') },
      { kind: 'darwin-arm64-evidence', digest: digest('2') },
      { kind: 'win32-x64-evidence', digest: digest('3') },
    ],
  }
}

function planningManifest(targets = [], dependency = unresolvedDependency()) {
  return {
    schemaVersion: 1,
    manifestKind: 'release-planning',
    platforms: [...LOCKED_RELEASE_PLATFORMS],
    targets,
    externalDependencies: dependency === null ? [] : [dependency],
  }
}

function platformEvidence(sha = sourceSha) {
  return [
    {
      platform: 'darwin-arm64',
      sourceSha: sha,
      evidenceKind: 'sealed-candidate',
      digest: digest('c'),
    },
    {
      platform: 'win32-x64',
      sourceSha: sha,
      evidenceKind: 'sealed-candidate',
      digest: digest('d'),
    },
  ]
}

function declare(overrides = {}) {
  return declareReleaseTarget({
    manifest: planningManifest(),
    version: '1.2.3-alpha.1',
    sourceSha,
    platformEvidence: platformEvidence(),
    packageManifest,
    ...overrides,
  })
}

test('an exact SHA and unique SemVer declare one idempotent dual-platform target', () => {
  const first = declare()
  assert.deepEqual(first.issues, [])
  assert.equal(first.declared, true)
  assert.equal(first.manifest.targets.length, 1)
  assert.deepEqual(first.manifest.targets[0].toolchain, {
    source: 'package.json',
    engines: {
      node: packageManifest.engines.node,
      npm: packageManifest.engines.npm,
    },
  })

  const repeated = declare({ manifest: first.manifest })
  assert.deepEqual(repeated.issues, [])
  assert.equal(repeated.declared, false)
  assert.equal(repeated.idempotent, true)
  assert.deepEqual(repeated.manifest, first.manifest)
})

test('an older package manifest can repeat its existing release declaration', () => {
  const historicalPackage = {
    packageManager: 'npm@11.6.2',
    engines: { node: '>=24 <25', npm: '>=11 <12' },
    devEngines: {
      runtime: { name: 'node', version: '>=24 <25', onFail: 'warn' },
      packageManager: { name: 'npm', version: '>=11 <12', onFail: 'warn' },
    },
    volta: { node: '24.12.0', npm: '11.6.2' },
  }
  const first = declare({ packageManifest: historicalPackage })
  assert.equal(first.declared, true)
  assert.deepEqual(first.manifest.targets[0].toolchain.volta, historicalPackage.volta)
  const repeated = declare({ manifest: first.manifest, packageManifest: historicalPackage })
  assert.equal(repeated.idempotent, true)
  assert.deepEqual(repeated.manifest, first.manifest)
})

test('release target validation reports every immutable-target failure mode distinctly', async (context) => {
  await context.test('missing platform evidence', () => {
    const result = declare({ platformEvidence: platformEvidence().slice(0, 1) })
    assert.deepEqual(result.issues.map(({ code }) => code), [
      'missing-platform-evidence',
    ])
  })

  await context.test('extra platform evidence', () => {
    const result = declare({
      platformEvidence: [
        ...platformEvidence(),
        {
          platform: 'linux-x64',
          sourceSha,
          evidenceKind: 'sealed-candidate',
          digest: digest('e'),
        },
      ],
    })
    assert.ok(result.issues.some(({ code }) => code === 'extra-platform-evidence'))
  })

  await context.test('mixed platform SHAs', () => {
    const evidence = platformEvidence()
    evidence[1].sourceSha = otherSourceSha
    const result = declare({ platformEvidence: evidence })
    assert.ok(result.issues.some(({ code }) => code === 'mixed-sha'))
  })

  await context.test('reused version against another SHA', () => {
    const first = declare()
    const reusedTarget = structuredClone(first.manifest.targets[0])
    reusedTarget.sourceSha = otherSourceSha
    reusedTarget.platformEvidence = platformEvidence(otherSourceSha)
    const validation = validateReleasePlanningManifest(planningManifest([
      first.manifest.targets[0],
      reusedTarget,
    ]))
    assert.ok(validation.issues.some(({ code }) => code === 'reused-version'))
  })

  await context.test('replaced evidence against immutable history', () => {
    const first = declare()
    const replaced = structuredClone(first.manifest)
    replaced.targets[0].platformEvidence[0].digest = digest('f')
    const validation = validateReleasePlanningManifest(replaced, {
      previousManifest: first.manifest,
    })
    assert.ok(validation.issues.some(({ code }) => code === 'replaced-evidence'))
  })
})

test('release declarations reject the proof-only zero version', () => {
  const result = declare({ version: '0.0.0' })
  assert.ok(result.issues.some(({ code }) => code === 'invalid-version'))
  assert.equal(result.declared, false)
})

test('the checked-in dependency ledger records #520/#528 as resolved against the released target', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../../release/planning/manifest.json', import.meta.url),
    'utf8',
  ))
  assert.deepEqual(validateReleasePlanningManifest(manifest), {
    valid: true,
    issues: [],
  })
  const classified = classifyCertificationDependency(manifest)
  assert.equal(classified.state, 'resolved')
  assert.deepEqual(classified.issues, [])
  assert.equal(classified.entry.targetSha, manifest.targets.at(-1).sourceSha)
  assert.ok(classified.entry.certificationSetId)
  assert.ok(classified.entry.evidence.some(
    ({ kind }) => kind === 'certification-manifest',
  ))
})

test('certification ledger classification keeps empty, stale, assumed, and malformed states distinct', () => {
  assert.equal(
    classifyCertificationDependency(planningManifest([], null)).state,
    'empty',
  )

  const stale = planningManifest([], resolvedDependency(otherSourceSha))
  assert.equal(classifyCertificationDependency(stale, sourceSha).state, 'stale')

  const assumedEntry = resolvedDependency()
  delete assumedEntry.evidence[0].digest
  assert.equal(
    classifyCertificationDependency(planningManifest([], assumedEntry), sourceSha).state,
    'manually-assumed',
  )

  const malformedEntry = unresolvedDependency()
  malformedEntry.issue.number = 520
  assert.equal(
    classifyCertificationDependency(planningManifest([], malformedEntry), sourceSha).state,
    'invalid',
  )
})

test('promotable transitions reject every non-resolved ledger state and accept real digest references', async (context) => {
  const declared = declare().manifest
  const cases = [
    {
      name: 'empty',
      manifest: { ...declared, externalDependencies: [] },
      state: 'empty',
    },
    {
      name: 'stale',
      manifest: { ...declared, externalDependencies: [resolvedDependency(otherSourceSha)] },
      state: 'stale',
    },
    {
      name: 'unresolved',
      manifest: declared,
      state: 'unresolved',
    },
    {
      name: 'manually assumed',
      manifest: {
        ...declared,
        externalDependencies: [{
          ...resolvedDependency(),
          evidence: [{ kind: 'certification-manifest' }],
        }],
      },
      state: 'manually-assumed',
    },
  ]

  for (const fixture of cases) {
    await context.test(fixture.name, () => {
      const result = transitionReleaseTargetStatus({
        manifest: fixture.manifest,
        version: '1.2.3-alpha.1',
        toStatus: 'promotable',
      })
      assert.equal(result.accepted, false)
      assert.equal(result.ledgerState, fixture.state)
      assert.deepEqual(result.issues.map(({ code }) => code), [
        `promotion-dependency-${fixture.state}`,
      ])
      assert.deepEqual(result.manifest, fixture.manifest)
    })
  }

  await context.test('resolved with digest-addressed certification evidence', () => {
    const manifest = {
      ...declared,
      externalDependencies: [resolvedDependency()],
    }
    const result = transitionReleaseTargetStatus({
      manifest,
      version: '1.2.3-alpha.1',
      toStatus: 'promotable',
    })
    assert.equal(result.accepted, true)
    assert.equal(result.ledgerState, 'resolved')
    assert.deepEqual(result.issues, [])
    assert.equal(result.manifest.targets[0].status, 'promotable')
    assert.equal(result.manifest.targets[0].promotable, true)
    assert.equal(manifest.targets[0].promotable, false)
  })
})

test('the existing internal signing smoke identities can never become promotable', async () => {
  const [macosSmoke, windowsSmoke] = await Promise.all([
    readFile(new URL('../../release/signing-smoke/macos-manifest.json', import.meta.url), 'utf8'),
    readFile(new URL('../../release/signing-smoke/windows-manifest.json', import.meta.url), 'utf8'),
  ]).then((values) => values.map(JSON.parse))
  const base = declare().manifest.targets[0]

  for (const smokeManifest of [macosSmoke, windowsSmoke]) {
    const version = smokeManifest.version ?? smokeManifest.artifact.version
    const evidenceKind = smokeManifest.evidenceKind ?? smokeManifest.artifact.class
    const target = {
      ...structuredClone(base),
      version,
      evidenceKind,
      promotable: smokeManifest.promotable ?? smokeManifest.artifact.promotable,
    }
    const manifest = planningManifest([target], resolvedDependency())
    const result = transitionReleaseTargetStatus({
      manifest,
      version,
      toStatus: 'promotable',
    })
    assert.equal(result.accepted, false)
    assert.deepEqual(result.issues.map(({ code }) => code), [
      'smoke-target-non-promotable',
    ])
    assert.equal(result.manifest.targets[0].promotable, false)
  }
})

test('the read-only CLI validates the checked-in planning manifest', async () => {
  const output = []
  const errors = []
  const exitCode = await runReleasePlanningCli({
    argv: ['validate'],
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(errors, [])
  assert.equal(output.length, 1)
  const { dependencyStates, ...parsed } = JSON.parse(output[0])
  assert.deepEqual(parsed, {
    schemaVersion: 1,
    action: 'validate',
    valid: true,
    issues: [],
  })
  // The single #528 ledger entry always tracks the newest certified target,
  // so every earlier immutable target is expected to classify stale. Pin the
  // shape, not the count, so this test survives each release.
  assert.equal(dependencyStates.at(-1), 'resolved')
  assert.ok(dependencyStates.slice(0, -1).every((state) => state === 'stale'))
})

function certificationReference(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'eido-packaged-certification-set',
    certificationSetId: 'eido-cert-v1-123456789-1',
    sourceSha,
    semver: '1.2.3-alpha.1',
    manifest: {
      fileName: 'certification-manifest.json',
      sha256: digest('e'),
    },
    ...overrides,
  }
}

test('resolve-dependency binds the ledger to a declared target from a certification reference', () => {
  const declared = declare()
  assert.deepEqual(declared.issues, [])
  const resolved = resolveCertificationDependency({
    manifest: declared.manifest,
    reference: certificationReference(),
  })
  assert.deepEqual(resolved.issues, [])
  assert.equal(resolved.resolved, true)
  assert.equal(resolved.ledgerState, 'resolved')
  const entry = resolved.manifest.externalDependencies.find(
    (candidate) => candidate.id === CERTIFICATION_DEPENDENCY_ID,
  )
  assert.equal(entry.state, 'resolved')
  assert.equal(entry.targetSha, sourceSha)
  assert.equal(entry.certificationSetId, 'eido-cert-v1-123456789-1')
  assert.deepEqual(entry.evidence, [
    { kind: 'certification-manifest', digest: digest('e') },
    { kind: 'darwin-arm64-evidence', digest: digest('c') },
    { kind: 'win32-x64-evidence', digest: digest('d') },
  ])
  const promoted = transitionReleaseTargetStatus({
    manifest: resolved.manifest,
    version: '1.2.3-alpha.1',
    toStatus: 'promotable',
  })
  assert.equal(promoted.accepted, true)
})

test('resolve-dependency refuses stale, undeclared, and malformed references', () => {
  const declared = declare()
  const stale = resolveCertificationDependency({
    manifest: declared.manifest,
    reference: certificationReference({ sourceSha: otherSourceSha }),
  })
  assert.equal(stale.resolved, false)
  assert.deepEqual(stale.issues.map(({ code }) => code), ['stale-certification-reference'])

  const undeclared = resolveCertificationDependency({
    manifest: declared.manifest,
    reference: certificationReference({ semver: '9.9.9' }),
  })
  assert.equal(undeclared.resolved, false)
  assert.deepEqual(undeclared.issues.map(({ code }) => code), ['release-target-not-found'])

  const malformed = resolveCertificationDependency({
    manifest: declared.manifest,
    reference: certificationReference({ manifest: { fileName: '', sha256: 'sha256:short' } }),
  })
  assert.equal(malformed.resolved, false)
  assert.deepEqual(malformed.issues.map(({ code }) => code), ['invalid-certification-reference'])
})
