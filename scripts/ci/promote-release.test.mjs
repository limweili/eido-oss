import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createReleaseCandidateBody,
  runPromotionCli,
} from '../release/promote-release.mjs'

const sourceSha = 'a'.repeat(40)
const digest = (character) => `sha256:${character.repeat(64)}`

function policy() {
  return {
    schemaVersion: 1,
    repository: {
      fullName: 'limweili/eido-releases',
      defaultBranch: 'main',
    },
    template: {
      allowedPaths: ['README.md'],
      sha256: { 'README.md': 'b'.repeat(64) },
    },
  }
}

function promotableManifest() {
  return {
    schemaVersion: 1,
    manifestKind: 'release-planning',
    platforms: ['darwin-arm64', 'win32-x64'],
    targets: [
      {
        version: '1.2.3',
        sourceSha,
        evidenceKind: 'release-target',
        status: 'promotable',
        promotable: true,
        toolchain: {
          source: 'package.json',
          engines: { node: '>=24 <25', npm: '>=11 <12' },
          volta: { node: '24.12.0', npm: '11.6.2' },
        },
        platformEvidence: [
          {
            platform: 'darwin-arm64',
            sourceSha,
            evidenceKind: 'sealed-candidate',
            digest: digest('c'),
          },
          {
            platform: 'win32-x64',
            sourceSha,
            evidenceKind: 'sealed-candidate',
            digest: digest('d'),
          },
        ],
      },
    ],
    externalDependencies: [
      {
        id: 'profile-agent-packaged-certification',
        parentIssue: {
          number: 520,
          url: 'https://github.com/limweili/eido/issues/520',
        },
        issue: {
          number: 528,
          url: 'https://github.com/limweili/eido/issues/528',
        },
        state: 'resolved',
        targetSha: sourceSha,
        certificationSetId: 'proof-certification-set',
        evidence: [
          { kind: 'certification-manifest', digest: digest('e') },
        ],
      },
    ],
  }
}

async function run(argv, overrides = {}) {
  const stdout = []
  const stderr = []
  const exitCode = await runPromotionCli({
    argv,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    loadManifest: async () => promotableManifest(),
    loadPolicy: async () => policy(),
    ...overrides,
  })
  return { exitCode, stdout, stderr }
}

test('release notes offer the exact corresponding source and GPL license', () => {
  const body = createReleaseCandidateBody({ version: '1.2.3', sourceSha }, 'Fix canvas navigation.')
  assert.match(body, /Fix canvas navigation\./)
  assert.ok(body.includes(`https://github.com/limweili/eido/tree/${sourceSha}`))
  assert.ok(body.includes(`https://github.com/limweili/eido/archive/${sourceSha}.tar.gz`))
  assert.ok(body.includes(`https://github.com/limweili/eido/blob/${sourceSha}/LICENSE`))
  assert.match(body, /GNU GPL version 3 only/)
})

test('a malformed public-repository policy fails closed, not silently open', async () => {
  let clientCreated = false
  const repository = 'limweili/eido-promotion-proof'
  const result = await run([
    'promote',
    '--repository',
    repository,
    '--confirm',
    repository,
    '--version',
    '1.2.3',
    '--json',
  ], {
    // A policy missing repository.fullName/defaultBranch must not silently
    // disable the real-public-repository refusal guard (fail-open bug):
    // it must hard-fail before any backend/client work happens at all.
    loadPolicy: async () => ({ schemaVersion: 1, template: policy().template }),
    clientFactory() {
      clientCreated = true
      throw new Error('provider access must not occur')
    },
  })

  assert.equal(result.exitCode, 2)
  assert.equal(clientCreated, false)
  assert.deepEqual(JSON.parse(result.stdout.join('\n')), {
    schemaVersion: 1,
    verdict: 'BLOCK',
    action: 'promote',
    target: repository,
    version: '1.2.3',
    reason: 'release-public-repository-policy-invalid',
    issues: [
      { code: 'policy-repository-full-name-missing' },
      { code: 'policy-repository-default-branch-missing' },
    ],
  })
})

test('proof mode refuses the real public repository before reading provider state', async () => {
  let clientCreated = false
  const disguisedRealRepository = 'LimWeiLi/Eido-Releases'
  const result = await run([
    'promote',
    '--repository',
    disguisedRealRepository,
    '--confirm',
    disguisedRealRepository,
    '--version',
    '1.2.3',
    '--proof',
    '--json',
  ], {
    clientFactory() {
      clientCreated = true
      throw new Error('provider access must not occur')
    },
  })

  assert.equal(result.exitCode, 2)
  assert.equal(clientCreated, false)
  assert.deepEqual(JSON.parse(result.stdout.join('\n')), {
    schemaVersion: 1,
    verdict: 'BLOCK',
    action: 'promote',
    target: disguisedRealRepository,
    version: '1.2.3',
    reason: 'real-public-repository-forbidden-in-proof-mode',
  })
})

test('promotion refuses an already-final version without mutating the repository', async () => {
  let publishCalls = 0
  const repository = 'limweili/eido-promotion-proof'
  const result = await run([
    'promote',
    '--repository',
    repository,
    '--confirm',
    repository,
    '--version',
    '1.2.3',
    '--proof',
    '--json',
  ], {
    clientFactory() {
      return {
        async inspect() {
          return {
            repository: { fullName: repository, defaultBranch: 'main' },
            template: { valid: true, issues: [] },
            releases: [
              {
                id: 17,
                tagName: 'v1.2.3',
                draft: false,
                prerelease: false,
              },
            ],
          }
        },
        async publish() {
          publishCalls += 1
        },
      }
    },
  })

  assert.equal(result.exitCode, 1)
  assert.equal(publishCalls, 0)
  assert.deepEqual(JSON.parse(result.stdout.join('\n')), {
    schemaVersion: 1,
    verdict: 'BLOCK',
    action: 'promote',
    target: repository,
    version: '1.2.3',
    reason: 'release-already-final',
    release: {
      id: 17,
      tagName: 'v1.2.3',
      draft: false,
      prerelease: false,
    },
  })
})

test('legacy verification remains available for the real paired macOS release lane', async () => {
  const historical = structuredClone(promotableManifest())
  const target = historical.targets[0]
  target.version = '0.1.0-alpha.8'
  target.sourceSha = '9'.repeat(40)
  for (const evidence of target.platformEvidence) evidence.sourceSha = target.sourceSha
  let inspectCalls = 0
  const result = await run([
    'verify',
    '--repository',
    'limweili/eido-releases',
    '--version',
    target.version,
    '--json',
  ], {
    loadManifest: async () => historical,
    clientFactory() {
      return {
        async inspect() {
          inspectCalls += 1
          return {
            repository: {
              fullName: 'limweili/eido-releases',
              defaultBranch: 'main',
            },
            template: { valid: true, issues: [] },
            releases: [
              {
                id: 18,
                tagName: `v${target.version}`,
                draft: false,
                prerelease: false,
                body: createReleaseCandidateBody(target),
                assets: [
                  {
                    id: 41,
                    name: 'Eido.dmg',
                    digest: digest('c'),
                    size: 1,
                  },
                  {
                    id: 42,
                    name: 'Eido.exe',
                    digest: digest('d'),
                    size: 1,
                  },
                ],
              },
            ],
          }
        },
      }
    },
  })

  assert.equal(result.exitCode, 0)
  assert.equal(inspectCalls, 1)
  assert.deepEqual(JSON.parse(result.stdout.join('\n')), {
    schemaVersion: 1,
    verdict: 'PASS',
    action: 'verify',
    target: 'limweili/eido-releases',
    version: target.version,
    release: {
      id: 18,
      tagName: `v${target.version}`,
      draft: false,
      prerelease: false,
    },
  })
})

test('legacy promotion still refuses the real paired macOS release lane', async () => {
  let clientCreated = false
  const repository = 'limweili/eido-releases'
  const result = await run([
    'promote',
    '--repository',
    repository,
    '--confirm',
    repository,
    '--version',
    '1.2.3',
    '--json',
  ], {
    clientFactory() {
      clientCreated = true
      throw new Error('legacy provider access must not occur')
    },
  })

  assert.equal(result.exitCode, 1)
  assert.equal(clientCreated, false)
  assert.equal(
    JSON.parse(result.stdout.join('\n')).reason,
    'legacy-promotion-does-not-support-paired-macos-artifacts',
  )
})

test('verification ignores founder-owned default-branch content', async () => {
  const repository = 'limweili/eido-promotion-proof'
  const target = promotableManifest().targets[0]
  const result = await run([
    'verify',
    '--repository',
    repository,
    '--version',
    target.version,
    '--json',
  ], {
    clientFactory() {
      return {
        async inspect() {
          return {
            repository: { fullName: repository, defaultBranch: 'main' },
            template: {
              valid: false,
              issues: [{ code: 'template-content-mismatch', path: 'index.html' }],
            },
            releases: [
              {
                id: 19,
                tagName: `v${target.version}`,
                draft: false,
                prerelease: false,
                body: createReleaseCandidateBody(target),
                assets: [
                  {
                    id: 41,
                    name: 'Eido.dmg',
                    digest: digest('c'),
                    size: 1,
                  },
                  {
                    id: 42,
                    name: 'Eido.exe',
                    digest: digest('d'),
                    size: 1,
                  },
                ],
              },
            ],
          }
        },
      }
    },
  })

  assert.equal(result.exitCode, 0)
  assert.deepEqual(JSON.parse(result.stdout.join('\n')), {
    schemaVersion: 1,
    verdict: 'PASS',
    action: 'verify',
    target: repository,
    version: target.version,
    release: {
      id: 19,
      tagName: `v${target.version}`,
      draft: false,
      prerelease: false,
    },
  })
})

test('abort accepts a valid candidate without mutating the repository', async () => {
  let publishCalls = 0
  let inspectCalls = 0
  const repository = 'limweili/eido-promotion-proof'
  const target = promotableManifest().targets[0]
  const result = await run([
    'abort',
    '--repository',
    repository,
    '--version',
    target.version,
    '--proof',
    '--json',
  ], {
    clientFactory() {
      return {
        async inspect() {
          inspectCalls += 1
          return {
            repository: { fullName: repository, defaultBranch: 'main' },
            template: { valid: true, issues: [] },
            releases: [
              {
                id: 23,
                tagName: `v${target.version}`,
                draft: true,
                prerelease: true,
                body: createReleaseCandidateBody(target),
                assets: [
                  {
                    id: 31,
                    name: 'Eido.dmg',
                    digest: digest('c'),
                    size: 1,
                  },
                  {
                    id: 32,
                    name: 'Eido.exe',
                    digest: digest('d'),
                    size: 1,
                  },
                ],
              },
            ],
          }
        },
        async publish() {
          publishCalls += 1
        },
      }
    },
  })

  assert.equal(result.exitCode, 0)
  assert.equal(inspectCalls, 1)
  assert.equal(publishCalls, 0)
  assert.deepEqual(JSON.parse(result.stdout.join('\n')), {
    schemaVersion: 1,
    verdict: 'ABORTED',
    action: 'abort',
    target: repository,
    version: target.version,
    release: {
      id: 23,
      tagName: `v${target.version}`,
      draft: true,
      prerelease: true,
    },
    repositoryMutation: 'none',
  })
})

test('a future draft cannot be promoted without its exact corresponding source links', async () => {
  const repository = 'limweili/eido-promotion-proof'
  const target = promotableManifest().targets[0]
  let publishCalls = 0
  const result = await run([
    'promote', '--repository', repository, '--confirm', repository,
    '--version', target.version, '--proof', '--json',
  ], {
    clientFactory: () => ({
      async inspect() {
        return {
          repository: { fullName: repository, defaultBranch: 'main' },
          releases: [{
            id: 23,
            tagName: `v${target.version}`,
            draft: true,
            prerelease: true,
            body: createReleaseCandidateBody(target).split('\n\n')[0],
            assets: [
              { id: 31, name: 'Eido.dmg', digest: digest('c'), size: 1 },
              { id: 32, name: 'Eido.exe', digest: digest('d'), size: 1 },
            ],
          }],
        }
      },
      async publish() { publishCalls += 1 },
    }),
  })
  assert.equal(result.exitCode, 1)
  assert.equal(publishCalls, 0)
  assert.ok(JSON.parse(result.stdout.join('\n')).issues.some(({ code }) => code === 'candidate-corresponding-source-missing'))
})

test('abort still refuses a candidate whose certification dependency is stale', async () => {
  const stale = structuredClone(promotableManifest())
  const target = stale.targets[0]
  target.sourceSha = '9'.repeat(40)
  for (const evidence of target.platformEvidence) evidence.sourceSha = target.sourceSha
  let clientCreated = false
  const repository = 'limweili/eido-promotion-proof'
  const result = await run([
    'abort',
    '--repository',
    repository,
    '--version',
    target.version,
    '--proof',
    '--json',
  ], {
    loadManifest: async () => stale,
    clientFactory() {
      clientCreated = true
      throw new Error('stale mutation must fail before public artifact inspection')
    },
  })

  assert.equal(result.exitCode, 1)
  assert.equal(clientCreated, false)
  assert.deepEqual(JSON.parse(result.stdout.join('\n')), {
    schemaVersion: 1,
    verdict: 'BLOCK',
    action: 'abort',
    target: repository,
    version: target.version,
    reason: 'promotion-dependency-stale',
  })
})
