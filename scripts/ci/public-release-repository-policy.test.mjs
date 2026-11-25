import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  applyPublicReleaseRepository,
  createGhPublicReleaseRepositoryClient,
  loadPublicReleasePolicy,
  loadPublicReleaseTemplate,
  planPublicReleaseRepository,
  runPublicReleaseRepositoryCli,
  verifyPublicReleaseRepository,
} from '../release/public-release-repository.mjs'

function validSnapshot(policy, ownerObservedAt = new Date().toISOString()) {
  return {
    repository: {
      fullName: 'limweili/eido-releases',
      visibility: 'public',
      defaultBranch: 'main',
      description:
        'Public Eido desktop releases. Free GPL-3.0-only software; corresponding source at github.com/limweili/eido.',
      archived: false,
      features: {
        issues: true,
        projects: false,
        wiki: false,
        discussions: false,
      },
      mergePolicy: {
        allowSquashMerge: true,
        allowMergeCommit: false,
        allowRebaseMerge: false,
        deleteBranchOnMerge: true,
      },
    },
    template: {
      paths: [...policy.template.allowedPaths],
      sha256: structuredClone(policy.template.sha256),
      commitSha: '1111111111111111111111111111111111111111',
    },
    content: {
      releases: [],
      tags: [],
    },
    repositorySecrets: [],
    immutableReleases: {
      enabled: true,
      enforcedByOwner: false,
    },
    actions: {
      enabled: true,
      allowedActions: 'selected',
      shaPinningRequired: true,
      githubOwnedAllowed: true,
      verifiedAllowed: false,
      patternsAllowed: [],
      defaultWorkflowPermissions: 'read',
      canApprovePullRequestReviews: false,
      retentionDays: 90,
    },
    mainRuleset: structuredClone(policy.mainRuleset),
    promotionEnvironment: {
      name: 'release-promotion',
      preventSelfReview: false,
      requiredReviewers: ['limweili'],
      protectedBranches: true,
      customBranchPolicies: false,
      secrets: [],
    },
    sourceEnvironment: {
      repository: 'limweili/eido',
      name: 'release-publish',
      protection: {
        ...structuredClone(policy.sourceEnvironment.protection),
        allowedBranches: policy.sourceEnvironment.protection.allowedBranches.map(
          (name) => ({ name, type: 'branch' }),
        ),
      },
      variables: {
        EIDO_RELEASE_APP_ID: '123456',
        EIDO_RELEASE_REPOSITORY: 'limweili/eido-releases',
      },
      secrets: ['EIDO_RELEASE_APP_PRIVATE_KEY'],
    },
    sourceSecretBoundary: {
      repositorySecrets: [],
      environments: {
        'release-publish': ['EIDO_RELEASE_APP_PRIVATE_KEY'],
        preview: [],
      },
    },
    githubApp: {
      id: 123456,
      slug: 'eido-release-publisher-limweili',
      repositorySelection: 'selected',
      repositories: ['limweili/eido-releases'],
      permissions: {
        contents: 'write',
        metadata: 'read',
      },
      events: [],
      tokenProbe: {
        repository: 'limweili/eido-releases',
        permissions: { contents: 'read', metadata: 'read' },
        sourceRepositoryWriteDenied: true,
        expiresAt: '2026-07-17T12:00:00Z',
      },
    },
    privateVulnerabilityReporting: {
      enabled: true,
    },
    ownerEvidence: {
      schemaVersion: 1,
      target: 'limweili/eido-releases',
      observedAt: ownerObservedAt,
      observer: 'limweili',
      evidence: {
        kind: 'github-environment-settings-capture',
        control: 'promotionEnvironmentAdminBypassDisabled',
        settingsUrl:
          'https://github.com/limweili/eido-releases/settings/environments/release-promotion',
        captureUrl:
          'https://github.com/user-attachments/assets/11111111-1111-1111-1111-111111111111',
      },
      controls: {
        promotionEnvironmentAdminBypassDisabled: true,
      },
    },
  }
}

test('the committed policy names the only repositories and credential boundary', async () => {
  const policy = await loadPublicReleasePolicy()

  assert.equal(policy.schemaVersion, 1)
  assert.equal(policy.repository.fullName, 'limweili/eido-releases')
  assert.equal(policy.repository.visibility, 'public')
  assert.equal(policy.sourceEnvironment.repository, 'limweili/eido')
  assert.equal(policy.sourceEnvironment.name, 'release-publish')
  assert.deepEqual(policy.sourceEnvironment.requiredSecrets, [
    'EIDO_RELEASE_APP_PRIVATE_KEY',
  ])
  assert.deepEqual(policy.sourceEnvironment.protection, {
    protectedBranches: false,
    customBranchPolicies: true,
    allowedBranches: ['main'],
  })
  assert.equal(policy.githubApp.slug, 'eido-release-publisher-limweili')
  assert.deepEqual(policy.githubApp.repositories, ['limweili/eido-releases'])
  assert.deepEqual(policy.githubApp.permissions, {
    contents: 'write',
    metadata: 'read',
  })
  assert.deepEqual(policy.githubApp.forbiddenRepositories, ['limweili/eido'])
  assert.equal(policy.actions.shaPinningRequired, true)
  assert.equal(policy.content.requireNoReleases, false)
  assert.equal(policy.content.requireNoTags, false)
  assert.equal(policy.immutableReleases.enabled, true)
  assert.deepEqual(policy.ownerEvidence, {
    promotionEnvironmentAdminBypassDisabled: {
      required: true,
      observer: 'limweili',
      settingsUrl:
        'https://github.com/limweili/eido-releases/settings/environments/release-promotion',
      evidenceKind: 'github-environment-settings-capture',
      control: 'promotionEnvironmentAdminBypassDisabled',
      captureUrlPrefix: 'https://github.com/user-attachments/assets/',
      maxAgeHours: 24,
      maxFutureSkewMinutes: 5,
    },
  })
  assert.deepEqual(Object.keys(policy.template.sha256).sort(), [
    '.github/ISSUE_TEMPLATE/config.yml',
    '.nojekyll',
    'LICENSE',
    'README.md',
    'RELEASE_POLICY.md',
    'SECURITY.md',
    'SOURCE_AND_LICENSE_NOTICE.md',
    'SUPPORT.md',
    'index.html',
  ])
  for (const digest of Object.values(policy.template.sha256)) {
    assert.match(digest, /^[0-9a-f]{64}$/)
  }
})

test('the public template discloses the release boundary without private material', async () => {
  const policy = await loadPublicReleasePolicy()
  const files = await loadPublicReleaseTemplate(policy)

  assert.deepEqual(
    files.map((file) => file.path),
    policy.template.allowedPaths,
  )
  assert.deepEqual(
    Object.fromEntries(files.map((file) => [file.path, file.sha256])),
    policy.template.sha256,
  )

  const contents = new Map(files.map((file) => [file.path, file.content]))
  assert.match(contents.get('README.md'), /public-but-unadvertised/i)
  assert.match(contents.get('README.md'), /not access control/i)
  assert.match(contents.get('README.md'), /macOS arm64\s+and Windows\s+x64/i)
  assert.match(contents.get('README.md'), /unsigned/i)
  assert.match(contents.get('README.md'), /SHA-256/i)
  assert.match(contents.get('README.md'), /browser.*download.*reinstall/is)
  assert.match(contents.get('README.md'), /existing updater path.*remains.*dormant/is)
  assert.match(contents.get('README.md'), /no\s+updater manifest\/checksum assets/i)
  assert.match(contents.get('README.md'), /cannot discover, download, or\s+launch/i)
  assert.match(
    contents.get('README.md'),
    /every full release.*macOS arm64.*Windows\s+x64/is,
  )
  assert.match(
    contents.get('README.md'),
    /correction.*affected platform.*higher version.*explicit release record/is,
  )
  assert.match(contents.get('RELEASE_POLICY.md'), /immutable/i)
  assert.match(contents.get('RELEASE_POLICY.md'), /never\s+reused/i)
  assert.match(contents.get('RELEASE_POLICY.md'), /unsigned/i)
  assert.match(contents.get('RELEASE_POLICY.md'), /manual.*download.*reinstall/is)
  assert.match(contents.get('RELEASE_POLICY.md'), /existing updater path.*dormant/is)
  assert.match(contents.get('RELEASE_POLICY.md'), /no\s+updater manifest\/checksum assets/i)
  assert.match(
    contents.get('RELEASE_POLICY.md'),
    /every release starts as a draft.*macOS arm64.*Windows x64/is,
  )
  assert.match(
    contents.get('RELEASE_POLICY.md'),
    /correction.*affected platform.*higher version.*explicit release record/is,
  )
  assert.match(contents.get('RELEASE_POLICY.md'), /exact public source commit and source archive/i)
  assert.match(contents.get('SOURCE_AND_LICENSE_NOTICE.md'), /GPL-3.0-only/)
  assert.match(contents.get('SOURCE_AND_LICENSE_NOTICE.md'), /https:\/\/github\.com\/limweili\/eido/)
  assert.equal(contents.get('LICENSE'), await readFile(new URL('../../LICENSE', import.meta.url), 'utf8'))
  for (const source of contents.values()) assert.doesNotMatch(source, /Eido is proprietary|source repository is private|All rights reserved/i)
  assert.match(contents.get('SECURITY.md'), /do not attach.*save/i)
  assert.match(contents.get('SUPPORT.md'), /API keys/i)

  const downloadPage = contents.get('index.html')
  assert.match(downloadPage, /<meta name="robots" content="noindex, nofollow">/)
  assert.match(downloadPage, /macOS 13\.5 or newer/i)
  assert.match(downloadPage, /Apple(?:&nbsp;| )Silicon/i)
  assert.match(downloadPage, /Windows 11 on a 64-bit \(x64\) PC/i)
  assert.match(downloadPage, /Open Anyway/)
  assert.match(downloadPage, /More info/)
  assert.match(downloadPage, /Run anyway/)
  assert.match(downloadPage, /unsigned/i)
  // The privacy and updater-dormancy detail moved off the marketing page;
  // README.md and RELEASE_POLICY.md remain the public disclosure surface
  // for the updater boundary, asserted above.
  assert.doesNotMatch(downloadPage, /updates in place/i)
  assert.doesNotMatch(downloadPage, /Update now|Remind me later/i)
  assert.match(
    downloadPage,
    /https:\/\/github\.com\/limweili\/eido-releases\/releases\/latest/,
  )
  assert.match(
    downloadPage,
    /https:\/\/api\.github\.com\/repos\/limweili\/eido-releases\/releases\/latest/,
  )
  // Self-contained page: the only URLs are the release repository (links,
  // release lookup) and the inert SVG xmlns identifier in the favicon.
  assert.doesNotMatch(
    downloadPage,
    /https?:\/\/(?!(?:api\.)?github\.com\/|www\.w3\.org\/2000\/svg)/,
  )
  assert.equal(contents.get('.nojekyll'), '')

  for (const file of files) {
    assert.doesNotMatch(file.content, /eido-v3-ideas\.json\s*\{/)
    assert.doesNotMatch(file.content, /BEGIN (?:RSA |EC )?PRIVATE KEY/)
  }
})

test('the active runbook treats alpha publications as history, not release instructions', async () => {
  const runbook = await readFile(
    new URL('../../docs/agents/public-release-repository-policy.md', import.meta.url),
    'utf8',
  )
  const section = runbook.match(
    /## Historical alpha publications\n([\s\S]*?)\n## Download page/,
  )
  assert.ok(section)
  assert.match(section[1], /not\s+current instructions/i)
  // A correction is always a higher version against a fresh certification set.
  // The founder used to confirm that name; the version is now chosen by the
  // Captain's deterministic rule, with the founder out of the loop entirely
  // (docs/agents/desktop-release-captain.md, SOP 1). What must not drift is
  // that a correction never reuses a version and never reuses old bytes.
  assert.match(section[1], /higher\s+version/i)
  assert.doesNotMatch(section[1], /founder-confirmed/i)
  assert.match(section[1], /exact-current-main packaged certification set/i)
  // The signed feed moved to Cloudflare R2 (ADR 0032, #978), so the runbook no
  // longer bans updater metadata outright -- Eido publishes exactly that. What
  // must stay banned on the GitHub release path is electron-updater's
  // auto-discovery metadata, which would form a second unsigned update channel
  // alongside the signed feed.
  assert.match(section[1], /latest\.yml/i)
  assert.match(section[1], /blockmap/i)
  assert.match(section[1], /updates\.eido\.so/i)
  assert.doesNotMatch(runbook, /One-time manual alpha\.7 publication/)
  assert.doesNotMatch(runbook, /954300987fba7d642807ddc22266602d4a0bfd8d/)
  assert.match(runbook, /does not validate release asset names, counts, or digests/i)
})

test('the public template loader normalizes checkout newlines to committed LF bytes', async () => {
  const files = await loadPublicReleaseTemplate(
    {
      template: {
        directory: 'release/public-repository/template',
        allowedPaths: ['README.md'],
      },
    },
    {
      async readTemplateFile() {
        return 'alpha\r\nbeta\r\n'
      },
    },
  )

  assert.deepEqual(files, [
    {
      path: 'README.md',
      content: 'alpha\nbeta\n',
      sha256:
        'e49c81e2d2f84e259d40e2fb8192f3bcd198b355184845d76d8f58807d0d78ee',
    },
  ])
})

test('verification returns redacted machine evidence for a compliant bootstrap', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy, '2026-07-17T11:00:00Z')
  snapshot.githubApp.tokenProbe.privateKeyValidated = true
  const result = verifyPublicReleaseRepository({
    policy,
    snapshot,
    observedAt: '2026-07-17T11:00:00.000Z',
  })

  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.violations, [])
  assert.equal(result.observedAt, '2026-07-17T11:00:00.000Z')
  assert.equal(result.evidence.repository.fullName, 'limweili/eido-releases')
  assert.equal(result.evidence.repository.visibility, 'public')
  assert.equal(result.evidence.template.commitSha, '1111111111111111111111111111111111111111')
  assert.deepEqual(result.evidence.absence, {
    releases: 0,
    tags: 0,
    unexpectedPaths: [],
  })
  assert.deepEqual(result.evidence.credentials, {
    publicRepositorySecrets: [],
    publicPromotionSecrets: [],
    sourceEnvironmentSecrets: ['EIDO_RELEASE_APP_PRIVATE_KEY'],
    secretValueRead: false,
  })
  assert.deepEqual(result.evidence.sourceEnvironment, {
    repository: 'limweili/eido',
    name: 'release-publish',
    protection: {
      protectedBranches: false,
      customBranchPolicies: true,
      allowedBranches: [{ name: 'main', type: 'branch' }],
    },
  })
  assert.deepEqual(result.evidence.sourceSecretBoundary, {
    repositorySecrets: [],
    environments: {
      'release-publish': ['EIDO_RELEASE_APP_PRIVATE_KEY'],
      preview: [],
    },
  })
  assert.deepEqual(result.evidence.githubApp.repositories, ['limweili/eido-releases'])
  assert.deepEqual(result.evidence.githubApp.tokenProbe.permissions, {
    contents: 'read',
    metadata: 'read',
  })
  assert.equal(
    result.evidence.githubApp.tokenProbe.privateKeyValidated,
    true,
  )
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY|gh[opsu]_/)
})

test('verification fails closed when the public release repository does not exist', () => {
  const result = verifyPublicReleaseRepository({
    policy: {
      repository: { fullName: 'limweili/eido-releases' },
    },
    snapshot: { repository: null },
  })

  assert.deepEqual(result, {
    schemaVersion: 1,
    verdict: 'BLOCK',
    violations: [
      {
        code: 'repository-missing',
        path: 'repository',
        expected: 'limweili/eido-releases',
        actual: null,
      },
    ],
  })
})

test('verification rejects a repository that is not public', () => {
  const result = verifyPublicReleaseRepository({
    policy: {
      repository: {
        fullName: 'limweili/eido-releases',
        visibility: 'public',
      },
    },
    snapshot: {
      repository: {
        fullName: 'limweili/eido-releases',
        visibility: 'private',
      },
    },
  })

  assert.equal(result.verdict, 'BLOCK')
  assert.deepEqual(result.violations, [
    {
      code: 'repository-visibility-mismatch',
      path: 'repository.visibility',
      expected: 'public',
      actual: 'private',
    },
  ])
})

test('verification tolerates snapshot template details when no template policy is declared', () => {
  const result = verifyPublicReleaseRepository({
    policy: {
      repository: {
        fullName: 'limweili/eido-releases',
        visibility: 'public',
      },
    },
    snapshot: {
      repository: {
        fullName: 'limweili/eido-releases',
        visibility: 'public',
      },
      template: {
        paths: ['README.md'],
        sha256: {},
        commitSha: null,
      },
    },
  })

  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.evidence.absence.unexpectedPaths, [])
})

test('verification fails closed when immutable-release evidence is absent', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  delete snapshot.immutableReleases

  const result = verifyPublicReleaseRepository({ policy, snapshot })

  assert.equal(result.verdict, 'BLOCK')
  assert.deepEqual(result.violations, [
    {
      code: 'immutable-releases-evidence-missing',
      path: 'immutableReleases',
      expected: { enabled: true },
      actual: null,
    },
  ])
})

test('verification fails closed across every declared release boundary', async (t) => {
  const policy = await loadPublicReleasePolicy()
  const cases = [
    ['repository identity', 'repository-full-name-mismatch', (snapshot) => {
      snapshot.repository.fullName = 'limweili/not-eido-releases'
    }],
    ['default branch', 'repository-default-branch-mismatch', (snapshot) => {
      snapshot.repository.defaultBranch = 'master'
    }],
    ['repository description', 'repository-description-mismatch', (snapshot) => {
      snapshot.repository.description = 'downloads'
    }],
    ['archive state', 'repository-archived-mismatch', (snapshot) => {
      snapshot.repository.archived = true
    }],
    ['repository features', 'repository-features-mismatch', (snapshot) => {
      snapshot.repository.features.wiki = true
    }],
    ['merge policy', 'repository-merge-policy-mismatch', (snapshot) => {
      snapshot.repository.mergePolicy.allowMergeCommit = true
    }],
    ['template evidence', 'template-evidence-missing', (snapshot) => {
      delete snapshot.template
    }],
    ['template paths', 'template-paths-mismatch', (snapshot) => {
      snapshot.template.paths.pop()
    }],
    ['template commit', 'template-commit-missing', (snapshot) => {
      snapshot.template.commitSha = null
    }],
    ['template content', 'template-content-mismatch', (snapshot) => {
      snapshot.template.sha256['README.md'] = '0'.repeat(64)
    }],
    ['unexpected binary', 'forbidden-content-detected', (snapshot) => {
      snapshot.template.paths.push('Eido-0.1.0.dmg')
    }],
    ['immutable releases', 'immutable-releases-mismatch', (snapshot) => {
      snapshot.immutableReleases.enabled = false
    }],
    ['Actions evidence', 'actions-evidence-missing', (snapshot) => {
      delete snapshot.actions
    }],
    ['Actions policy', 'actions-policy-mismatch', (snapshot) => {
      snapshot.actions.defaultWorkflowPermissions = 'write'
    }],
    ['main ruleset evidence', 'main-ruleset-evidence-missing', (snapshot) => {
      delete snapshot.mainRuleset
    }],
    ['main ruleset', 'main-ruleset-mismatch', (snapshot) => {
      snapshot.mainRuleset.bypassActors.push({ actorId: 1 })
    }],
    ['promotion environment evidence', 'promotion-environment-evidence-missing', (snapshot) => {
      delete snapshot.promotionEnvironment
    }],
    ['promotion environment', 'promotion-environment-mismatch', (snapshot) => {
      snapshot.promotionEnvironment.preventSelfReview = true
    }],
    ['public repository secrets', 'public-repository-secret-detected', (snapshot) => {
      snapshot.repositorySecrets.push('PRIVATE_KEY')
    }],
    ['public promotion secrets', 'public-promotion-secret-detected', (snapshot) => {
      snapshot.promotionEnvironment.secrets.push('PRIVATE_KEY')
    }],
    ['source environment evidence', 'source-environment-evidence-missing', (snapshot) => {
      delete snapshot.sourceEnvironment
    }],
    ['source environment protection evidence', 'source-environment-protection-evidence-missing', (snapshot) => {
      delete snapshot.sourceEnvironment.protection
    }],
    ['source environment protection', 'source-environment-protection-mismatch', (snapshot) => {
      snapshot.sourceEnvironment.protection.allowedBranches = [
        { name: 'feature', type: 'branch' },
      ]
    }],
    ['source environment tag masquerading as main', 'source-environment-protection-mismatch', (snapshot) => {
      snapshot.sourceEnvironment.protection.allowedBranches = [
        { name: 'main', type: 'tag' },
      ]
    }],
    ['source environment variables', 'source-environment-variables-mismatch', (snapshot) => {
      snapshot.sourceEnvironment.variables.EIDO_RELEASE_REPOSITORY = 'limweili/eido'
    }],
    ['source environment secret names', 'source-environment-secrets-mismatch', (snapshot) => {
      snapshot.sourceEnvironment.secrets = []
    }],
    ['source secret exclusivity evidence', 'source-secret-exclusivity-evidence-missing', (snapshot) => {
      delete snapshot.sourceSecretBoundary
    }],
    ['malformed source secret exclusivity evidence', 'source-secret-exclusivity-evidence-missing', (snapshot) => {
      snapshot.sourceSecretBoundary.repositorySecrets.push(null)
    }],
    ['source repository App secret', 'source-secret-outside-protected-environment', (snapshot) => {
      snapshot.sourceSecretBoundary.repositorySecrets.push(
        'EIDO_RELEASE_APP_PRIVATE_KEY',
      )
    }],
    ['alternate environment App secret', 'source-secret-outside-protected-environment', (snapshot) => {
      snapshot.sourceSecretBoundary.environments.preview.push(
        'EIDO_RELEASE_APP_PRIVATE_KEY',
      )
    }],
    ['GitHub App evidence', 'github-app-evidence-missing', (snapshot) => {
      delete snapshot.githubApp
    }],
    ['GitHub App installation boundary', 'github-app-repositories-mismatch', (snapshot) => {
      snapshot.githubApp.repositories.push('limweili/eido')
    }],
    ['GitHub App permission boundary', 'github-app-permissions-mismatch', (snapshot) => {
      snapshot.githubApp.permissions.actions = 'read'
    }],
    ['installation-token probe evidence', 'github-app-token-probe-missing', (snapshot) => {
      delete snapshot.githubApp.tokenProbe
    }],
    ['installation-token repository scope', 'github-app-token-probe-repository-mismatch', (snapshot) => {
      snapshot.githubApp.tokenProbe.repository = 'limweili/eido'
    }],
    ['installation-token permission scope', 'github-app-token-probe-permissions-mismatch', (snapshot) => {
      snapshot.githubApp.tokenProbe.permissions.actions = 'read'
    }],
    ['installation-token source write denial', 'github-app-token-probe-source-write-authority', (snapshot) => {
      snapshot.githubApp.tokenProbe.sourceRepositoryWriteDenied = false
    }],
    ['private vulnerability reporting evidence', 'private-vulnerability-reporting-evidence-missing', (snapshot) => {
      delete snapshot.privateVulnerabilityReporting
    }],
    ['private vulnerability reporting', 'private-vulnerability-reporting-mismatch', (snapshot) => {
      snapshot.privateVulnerabilityReporting.enabled = false
    }],
  ]

  for (const [name, code, mutate] of cases) {
    await t.test(name, () => {
      const snapshot = validSnapshot(policy)
      mutate(snapshot)

      const result = verifyPublicReleaseRepository({ policy, snapshot })

      assert.equal(result.verdict, 'BLOCK')
      assert.ok(
        result.violations.some((violation) => violation.code === code),
        `expected violation ${code}; received ${JSON.stringify(result.violations)}`,
      )
    })
  }
})

test('verification permits published releases and tags but not binaries in the default tree', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  snapshot.content.releases.push('v0.1.0-alpha.7')
  snapshot.content.tags.push('v0.1.0-alpha.7')

  const published = verifyPublicReleaseRepository({ policy, snapshot })
  assert.equal(published.verdict, 'PASS')

  snapshot.template.paths.push('Eido-0.1.0-alpha.7-arm64.dmg')
  const leakedIntoTree = verifyPublicReleaseRepository({ policy, snapshot })
  assert.equal(leakedIntoTree.verdict, 'BLOCK')
  assert.ok(
    leakedIntoTree.violations.some(
      (violation) => violation.code === 'forbidden-content-detected',
    ),
  )
})

test('verification requires a timestamped provider-UI envelope for the UI-only bypass control', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  delete snapshot.ownerEvidence

  const result = verifyPublicReleaseRepository({ policy, snapshot })

  assert.equal(result.verdict, 'OWNER_EVIDENCE_REQUIRED')
  assert.deepEqual(result.violations, [])
  assert.deepEqual(result.ownerEvidenceRequired, [
    {
      id: 'promotion-environment-admin-bypass-disabled',
      settingsUrl:
        'https://github.com/limweili/eido-releases/settings/environments/release-promotion',
      requiredObserver: 'limweili',
      requiredFields: [
        'observedAt',
        'observer',
        'evidence.kind',
        'evidence.control',
        'evidence.settingsUrl',
        'evidence.captureUrl',
        'controls.promotionEnvironmentAdminBypassDisabled',
      ],
      maxAgeHours: 24,
      maxFutureSkewMinutes: 5,
    },
  ])
})

test('verification accepts an installation-token permission echo that omits implicit metadata read', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  snapshot.githubApp.tokenProbe.permissions = { contents: 'read' }

  const result = verifyPublicReleaseRepository({ policy, snapshot })

  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.violations, [])
})

test('verification treats provider ruleset rule order as non-semantic', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  snapshot.mainRuleset.rules.reverse()

  const result = verifyPublicReleaseRepository({ policy, snapshot })

  assert.equal(result.verdict, 'PASS')
  assert.deepEqual(result.violations, [])
})

test('verification rejects stale and future provider-UI observations', async (t) => {
  const policy = await loadPublicReleasePolicy()
  const cases = [
    ['stale', '2026-07-16T11:59:59Z'],
    ['future', '2026-07-17T12:05:01Z'],
  ]

  for (const [name, evidenceObservedAt] of cases) {
    await t.test(name, () => {
      const snapshot = validSnapshot(policy)
      snapshot.ownerEvidence.observedAt = evidenceObservedAt

      const result = verifyPublicReleaseRepository({
        policy,
        snapshot,
        observedAt: '2026-07-17T12:00:00.000Z',
      })

      assert.equal(result.verdict, 'OWNER_EVIDENCE_REQUIRED')
      assert.deepEqual(result.violations, [])
    })
  }
})

test('verification requires canonical UTC provider-UI timestamps', async (t) => {
  const policy = await loadPublicReleasePolicy()
  for (const observedAt of [
    '2026-07-17T11:00:00+00:00',
    '2026-07-17 11:00:00Z',
    '2026-02-30T11:00:00Z',
  ]) {
    await t.test(observedAt, () => {
      const snapshot = validSnapshot(policy, observedAt)
      const result = verifyPublicReleaseRepository({
        policy,
        snapshot,
        observedAt: '2026-07-17T12:00:00.000Z',
      })

      assert.equal(result.verdict, 'OWNER_EVIDENCE_REQUIRED')
    })
  }
})

test('verification rejects provider-UI evidence not bound to the exact control', async (t) => {
  const policy = await loadPublicReleasePolicy()
  const cases = [
    ['control', (evidence) => {
      evidence.evidence.control = 'someOtherControl'
    }],
    ['settings URL', (evidence) => {
      evidence.evidence.settingsUrl =
        'https://github.com/limweili/eido-releases/settings/environments/preview'
    }],
    ['evidence kind', (evidence) => {
      evidence.evidence.kind = 'generic-screenshot'
    }],
    ['capture URL form', (evidence) => {
      evidence.evidence.captureUrl =
        'https://github.com/limweili/eido-releases/issues/1'
    }],
    ['extra evidence field', (evidence) => {
      evidence.evidence.caption = 'looks good'
    }],
    ['extra control field', (evidence) => {
      evidence.controls.someOtherControl = true
    }],
  ]

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const snapshot = validSnapshot(policy)
      snapshot.ownerEvidence.evidence = {
        kind: 'github-environment-settings-capture',
        control: 'promotionEnvironmentAdminBypassDisabled',
        settingsUrl:
          'https://github.com/limweili/eido-releases/settings/environments/release-promotion',
        captureUrl:
          'https://github.com/user-attachments/assets/11111111-1111-1111-1111-111111111111',
      }
      mutate(snapshot.ownerEvidence)

      const result = verifyPublicReleaseRepository({
        policy,
        snapshot,
        observedAt: '2026-07-17T12:00:00.000Z',
      })

      assert.equal(result.verdict, 'OWNER_EVIDENCE_REQUIRED')
      assert.deepEqual(result.violations, [])
    })
  }
})

test('planning a missing repository yields an idempotent bootstrap and a bounded owner action', async () => {
  const policy = await loadPublicReleasePolicy()
  const plan = planPublicReleaseRepository({
    policy,
    snapshot: { repository: null },
  })

  assert.equal(plan.verdict, 'READY')
  assert.equal(plan.target, 'limweili/eido-releases')
  assert.deepEqual(
    plan.mutations.map((mutation) => mutation.id),
    [
      'create-public-repository',
      'configure-repository-settings',
      'write-public-template',
      'enable-immutable-releases',
      'configure-actions-policy',
      'configure-main-ruleset',
      'configure-promotion-environment',
      'enable-private-vulnerability-reporting',
      'configure-source-environment',
      'set-source-release-repository-variable',
    ],
  )
  assert.deepEqual(plan.ownerActions.map((action) => action.id), [
    'register-public-only-github-app',
    'disable-promotion-admin-bypass',
  ])
  assert.deepEqual(plan.ownerActions[0].repositories, [
    'limweili/eido-releases',
  ])
  assert.equal(
    plan.ownerActions[1].settingsUrl,
    'https://github.com/limweili/eido-releases/settings/environments/release-promotion',
  )
  assert.doesNotMatch(JSON.stringify(plan), /PRIVATE KEY|gh[opsu]_/)
})

test('planning and applying a compliant repository are no-ops', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  const calls = []
  const client = {
    async applyMutation(mutation) {
      calls.push(mutation.id)
    },
  }

  const plan = planPublicReleaseRepository({ policy, snapshot })
  const result = await applyPublicReleaseRepository({
    policy,
    snapshot,
    client,
    confirmRepository: 'limweili/eido-releases',
  })

  assert.deepEqual(plan, {
    schemaVersion: 1,
    verdict: 'CONVERGED',
    target: 'limweili/eido-releases',
    mutations: [],
    ownerActions: [],
    violations: [],
  })
  assert.equal(result.verdict, 'CONVERGED')
  assert.deepEqual(result.applied, [])
  assert.deepEqual(calls, [])
})

test('confirmed apply rewrites an existing source App key after probing the stdin key', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  snapshot.githubApp.tokenProbe.privateKeyValidated = true
  const calls = []

  const result = await applyPublicReleaseRepository({
    policy,
    snapshot,
    client: {
      async applyMutation(mutation) {
        calls.push(mutation.id)
      },
    },
    confirmRepository: 'limweili/eido-releases',
  })

  assert.equal(result.verdict, 'APPLIED')
  assert.deepEqual(result.applied, ['set-source-app-private-key'])
  assert.deepEqual(calls, ['set-source-app-private-key'])
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY|gh[opsu]_/)
})

test('apply requires an exact repository confirmation before making changes', async () => {
  const policy = await loadPublicReleasePolicy()
  const calls = []

  const result = await applyPublicReleaseRepository({
    policy,
    snapshot: { repository: null },
    client: {
      async applyMutation(mutation) {
        calls.push(mutation.id)
      },
    },
    confirmRepository: 'limweili/eido',
  })

  assert.deepEqual(result, {
    schemaVersion: 1,
    verdict: 'BLOCK',
    target: 'limweili/eido-releases',
    applied: [],
    reason: 'repository-confirmation-mismatch',
  })
  assert.deepEqual(calls, [])
})

test('planning resumes safe configuration drift and ignores expected release records', async () => {
  const policy = await loadPublicReleasePolicy()
  const resumable = validSnapshot(policy)
  delete resumable.immutableReleases
  delete resumable.actions
  delete resumable.mainRuleset

  const resumePlan = planPublicReleaseRepository({
    policy,
    snapshot: resumable,
  })

  assert.equal(resumePlan.verdict, 'READY')
  assert.deepEqual(
    resumePlan.mutations.map((mutation) => mutation.id),
    [
      'enable-immutable-releases',
      'configure-actions-policy',
      'configure-main-ruleset',
    ],
  )

  const published = validSnapshot(policy)
  published.content.releases.push('v0.1.0-alpha.7')
  published.content.tags.push('v0.1.0-alpha.7')
  const publishedPlan = planPublicReleaseRepository({
    policy,
    snapshot: published,
  })

  assert.equal(publishedPlan.verdict, 'CONVERGED')
  assert.deepEqual(publishedPlan.mutations, [])
})

test('planning blocks direct template convergence behind any active pull-request ruleset', async () => {
  const policy = await loadPublicReleasePolicy()
  for (const bypassActors of [
    [],
    [{ actorId: 1, actorType: 'RepositoryRole', bypassMode: 'always' }],
  ]) {
    const snapshot = validSnapshot(policy)
    snapshot.mainRuleset.bypassActors = bypassActors
    snapshot.template.sha256['README.md'] = '0'.repeat(64)

    const plan = planPublicReleaseRepository({ policy, snapshot })

    assert.equal(plan.verdict, 'BLOCK')
    assert.deepEqual(plan.mutations, [])
    assert.ok(
      plan.violations.some(
        (violation) => violation.code === 'template-content-mismatch',
      ),
    )
  }
})

test('applying safe drift reports applied when no owner action remains', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  delete snapshot.immutableReleases
  const calls = []

  const result = await applyPublicReleaseRepository({
    policy,
    snapshot,
    client: {
      async applyMutation(mutation) {
        calls.push(mutation.id)
      },
    },
    confirmRepository: 'limweili/eido-releases',
  })

  assert.equal(result.verdict, 'APPLIED')
  assert.deepEqual(result.applied, ['enable-immutable-releases'])
  assert.deepEqual(result.ownerActions, [])
  assert.deepEqual(calls, ['enable-immutable-releases'])
})

test('apply executes only the declarative automatic bootstrap and stops for the owner', async () => {
  const policy = await loadPublicReleasePolicy()
  const calls = []
  const result = await applyPublicReleaseRepository({
    policy,
    snapshot: { repository: null },
    client: {
      async applyMutation(mutation) {
        calls.push({ ...mutation })
      },
    },
    confirmRepository: 'limweili/eido-releases',
  })

  assert.equal(result.verdict, 'OWNER_ACTION_REQUIRED')
  assert.deepEqual(
    calls.map((call) => call.id),
    result.applied,
  )
  assert.deepEqual(result.ownerActions.map((action) => action.id), [
    'register-public-only-github-app',
    'disable-promotion-admin-bypass',
  ])
  assert.equal(calls.some((call) => call.method.includes('GithubApp')), false)
})

test('planning resumes post-registration credential wiring only with a proven App key', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  snapshot.githubApp.tokenProbe.privateKeyValidated = true
  delete snapshot.sourceEnvironment.variables.EIDO_RELEASE_APP_ID
  snapshot.sourceEnvironment.secrets = []

  const plan = planPublicReleaseRepository({ policy, snapshot })

  assert.equal(plan.verdict, 'READY')
  assert.deepEqual(
    plan.mutations.map((mutation) => mutation.id),
    ['set-source-app-id-variable', 'set-source-app-private-key'],
  )
  assert.equal(
    plan.mutations.find(
      (mutation) => mutation.id === 'set-source-app-private-key',
    ).requires,
    'private-key-stdin',
  )
})

test('planning never writes the source App key from an unvalidated token probe', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  snapshot.sourceEnvironment.secrets = []

  const plan = planPublicReleaseRepository({ policy, snapshot })

  assert.equal(plan.verdict, 'OWNER_ACTION_REQUIRED')
  assert.equal(
    plan.mutations.some(
      (mutation) => mutation.id === 'set-source-app-private-key',
    ),
    false,
  )
  assert.deepEqual(plan.ownerActions.map((action) => action.id), [
    'provide-github-app-private-key-via-stdin',
  ])
})

test('planning resumes an interrupted bootstrap when the source environment is absent', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  snapshot.githubApp.tokenProbe.privateKeyValidated = true
  delete snapshot.sourceEnvironment
  snapshot.sourceSecretBoundary.environments = {}

  const plan = planPublicReleaseRepository({ policy, snapshot })

  assert.equal(plan.verdict, 'READY')
  assert.deepEqual(
    plan.mutations.map((mutation) => mutation.id),
    [
      'configure-source-environment',
      'set-source-release-repository-variable',
      'set-source-app-id-variable',
      'set-source-app-private-key',
    ],
  )
})

test('planning repairs source environment protection drift', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  snapshot.sourceEnvironment.protection.allowedBranches = [
    { name: 'main', type: 'tag' },
  ]

  const plan = planPublicReleaseRepository({ policy, snapshot })

  assert.equal(plan.verdict, 'READY')
  assert.deepEqual(
    plan.mutations.map((mutation) => mutation.id),
    ['configure-source-environment'],
  )
})

test('the GitHub adapter sends bounded repository mutations through injected commands', async () => {
  const policy = await loadPublicReleasePolicy()
  const calls = []
  const client = createGhPublicReleaseRepositoryClient({
    async runGh(args, options = {}) {
      calls.push({ args, options })
      if (args[2] === 'GET' && args[3] === 'user') {
        return JSON.stringify({ login: 'limweili' })
      }
      return args.includes('user/repos')
        ? JSON.stringify({ full_name: 'limweili/eido-releases' })
        : ''
    },
  })

  await client.applyMutation(
    { id: 'create-public-repository', method: 'createPublicRepository' },
    { policy },
  )
  await client.applyMutation(
    { id: 'enable-immutable-releases', method: 'enableImmutableReleases' },
    { policy },
  )

  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0].args.slice(0, 4), [
    'api',
    '--method',
    'GET',
    'user',
  ])
  assert.deepEqual(calls[1].args.slice(0, 4), [
    'api',
    '--method',
    'POST',
    'user/repos',
  ])
  assert.deepEqual(JSON.parse(calls[1].options.input), {
    name: 'eido-releases',
    description:
      'Public Eido desktop releases. Free GPL-3.0-only software; corresponding source at github.com/limweili/eido.',
    private: false,
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    has_discussions: false,
    auto_init: true,
  })
  assert.deepEqual(calls[2].args.slice(0, 4), [
    'api',
    '--method',
    'PUT',
    'repos/limweili/eido-releases/immutable-releases',
  ])
  assert.doesNotMatch(JSON.stringify(calls), /PRIVATE KEY|gh[opsu]_/)
})

test('the GitHub adapter refuses repository creation for a different authenticated owner', async () => {
  const policy = await loadPublicReleasePolicy()
  const calls = []
  const client = createGhPublicReleaseRepositoryClient({
    async runGh(args) {
      const call = `${args[2]} ${args[3]}`
      calls.push(call)
      if (call === 'GET user') {
        return JSON.stringify({ login: 'not-limweili' })
      }
      return JSON.stringify({ full_name: 'not-limweili/eido-releases' })
    },
  })

  await assert.rejects(
    client.applyMutation(
      {
        id: 'create-public-repository',
        method: 'createPublicRepository',
      },
      { policy },
    ),
    /Authenticated GitHub owner does not match limweili/,
  )
  assert.deepEqual(calls, ['GET user'])
})

test('the GitHub adapter treats a missing target repository as an empty snapshot', async () => {
  const policy = await loadPublicReleasePolicy()
  const client = createGhPublicReleaseRepositoryClient({
    async runGh() {
      const error = new Error('HTTP 404: Not Found')
      error.statusCode = 404
      throw error
    },
  })

  assert.deepEqual(await client.snapshot(policy), { repository: null })
})

test('the GitHub adapter rejects truncated recursive tree evidence', async () => {
  const policy = await loadPublicReleasePolicy()
  const client = createGhPublicReleaseRepositoryClient({
    async runGh(args) {
      const path = args[3]
      if (path === 'repos/limweili/eido-releases') {
        return JSON.stringify({
          full_name: 'limweili/eido-releases',
          default_branch: 'main',
        })
      }
      if (path === 'repos/limweili/eido-releases/git/trees/main?recursive=1') {
        return JSON.stringify({ truncated: true, tree: [] })
      }
      if (
        path === 'repos/limweili/eido-releases/releases?per_page=100' ||
        path === 'repos/limweili/eido-releases/tags?per_page=100' ||
        path === 'repos/limweili/eido-releases/rulesets'
      ) {
        return JSON.stringify([])
      }
      if (path === 'user/installations?per_page=100') {
        return JSON.stringify({ total_count: 0, installations: [] })
      }
      return JSON.stringify({})
    },
  })

  await assert.rejects(
    () => client.snapshot(policy),
    /recursive tree evidence was truncated/,
  )
})

test('the GitHub adapter implements every automatic bootstrap mutation without touching App credentials', async () => {
  const policy = await loadPublicReleasePolicy()
  const calls = []
  let initializedDefaultBranch = 'master'
  const client = createGhPublicReleaseRepositoryClient({
    async runGh(args, options = {}) {
      const path = args[3]
      const method = args[2]
      calls.push({ method, path, options })
      if (method === 'GET' && path.includes('/contents/')) {
        const error = new Error('HTTP 404: Not Found')
        error.statusCode = 404
        throw error
      }
      if (
        method === 'GET' &&
        path === 'repos/limweili/eido-releases/rulesets'
      ) {
        return JSON.stringify([])
      }
      if (
        method === 'GET' &&
        path ===
          'repos/limweili/eido/environments/release-publish/deployment-branch-policies?per_page=100'
      ) {
        return JSON.stringify({ total_count: 0, branch_policies: [] })
      }
      if (method === 'GET' && path === 'user') {
        return JSON.stringify({ login: 'limweili' })
      }
      if (
        method === 'GET' &&
        path === 'repos/limweili/eido/environments/release-publish'
      ) {
        const error = new Error('HTTP 404: Not Found')
        error.statusCode = 404
        throw error
      }
      if (path === 'users/limweili') return JSON.stringify({ id: 1 })
      if (path === 'user/repos') {
        return JSON.stringify({
          full_name: 'limweili/eido-releases',
          default_branch: initializedDefaultBranch,
        })
      }
      if (method === 'GET' && path === 'repos/limweili/eido-releases') {
        return JSON.stringify({ default_branch: initializedDefaultBranch })
      }
      if (
        method === 'POST' &&
        path === 'repos/limweili/eido-releases/branches/master/rename'
      ) {
        assert.deepEqual(JSON.parse(options.input), { new_name: 'main' })
        initializedDefaultBranch = 'main'
        return JSON.stringify({ name: 'main' })
      }
      return ''
    },
  })
  const plan = planPublicReleaseRepository({
    policy,
    snapshot: { repository: null },
  })

  for (const mutation of plan.mutations) {
    await client.applyMutation(mutation, { policy })
  }

  const endpoints = calls.map((call) => `${call.method} ${call.path}`)
  assert.ok(endpoints.includes('POST user/repos'))
  assert.ok(
    endpoints.includes(
      'PUT repos/limweili/eido-releases/immutable-releases',
    ),
  )
  assert.ok(
    endpoints.includes(
      'PUT repos/limweili/eido-releases/actions/permissions/artifact-and-log-retention',
    ),
  )
  assert.ok(endpoints.includes('POST repos/limweili/eido-releases/rulesets'))
  assert.ok(
    endpoints.includes(
      'PUT repos/limweili/eido-releases/environments/release-promotion',
    ),
  )
  assert.ok(
    endpoints.includes(
      'PUT repos/limweili/eido-releases/private-vulnerability-reporting',
    ),
  )
  assert.ok(
    endpoints.includes('PUT repos/limweili/eido/environments/release-publish'),
  )
  const sourceEnvironmentPut = calls.find(
    (call) =>
      call.method === 'PUT' &&
      call.path === 'repos/limweili/eido/environments/release-publish',
  )
  assert.deepEqual(JSON.parse(sourceEnvironmentPut.options.input), {
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  })
  assert.ok(
    endpoints.includes(
      'POST repos/limweili/eido/environments/release-publish/deployment-branch-policies',
    ),
  )
  assert.ok(
    endpoints.some((endpoint) =>
      endpoint.includes('/environments/release-publish/variables'),
    ),
  )
  const renameDefaultBranch = endpoints.indexOf(
    'POST repos/limweili/eido-releases/branches/master/rename',
  )
  const firstTemplateWrite = endpoints.findIndex((endpoint) =>
    endpoint.startsWith('PUT repos/limweili/eido-releases/contents/'),
  )
  assert.notEqual(renameDefaultBranch, -1)
  assert.ok(renameDefaultBranch < firstTemplateWrite)
  assert.equal(endpoints.some((endpoint) => endpoint.includes('/apps/')), false)
  assert.equal(endpoints.some((endpoint) => endpoint.includes('/secrets/')), false)
})

test('the GitHub adapter normalizes live API responses into verifier evidence', async () => {
  const policy = await loadPublicReleasePolicy()
  const files = await loadPublicReleaseTemplate(policy)
  const responses = new Map([
    ['GET repos/limweili/eido-releases', {
      full_name: 'limweili/eido-releases',
      visibility: 'public',
      default_branch: 'main',
      description: policy.repository.description,
      archived: false,
      has_issues: true,
      has_projects: false,
      has_wiki: false,
      has_discussions: false,
      allow_squash_merge: true,
      allow_merge_commit: false,
      allow_rebase_merge: false,
      delete_branch_on_merge: true,
    }],
    ['GET repos/limweili/eido-releases/git/trees/main?recursive=1', {
      sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      truncated: false,
      tree: files.map((file) => ({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      })),
    }],
    ['GET repos/limweili/eido-releases/commits/main', {
      sha: '1111111111111111111111111111111111111111',
    }],
    ['GET repos/limweili/eido-releases/releases?per_page=100', []],
    ['GET repos/limweili/eido-releases/tags?per_page=100', []],
    ['GET repos/limweili/eido-releases/actions/secrets?per_page=100', {
      total_count: 0,
      secrets: [],
    }],
    ['GET repos/limweili/eido-releases/immutable-releases', {
      enabled: true,
      enforced_by_owner: false,
    }],
    ['GET repos/limweili/eido-releases/actions/permissions', {
      enabled: true,
      allowed_actions: 'selected',
      sha_pinning_required: true,
    }],
    ['GET repos/limweili/eido-releases/actions/permissions/selected-actions', {
      github_owned_allowed: true,
      verified_allowed: false,
      patterns_allowed: [],
    }],
    ['GET repos/limweili/eido-releases/actions/permissions/workflow', {
      default_workflow_permissions: 'read',
      can_approve_pull_request_reviews: false,
    }],
    ['GET repos/limweili/eido-releases/actions/permissions/artifact-and-log-retention', {
      days: 90,
      maximum_allowed_days: 400,
    }],
    ['GET repos/limweili/eido-releases/rulesets', [
      { id: 7, name: 'protect-main' },
    ]],
    ['GET repos/limweili/eido-releases/rulesets/7', {
      name: 'protect-main',
      target: 'branch',
      enforcement: 'active',
      conditions: {
        ref_name: { include: ['refs/heads/main'], exclude: [] },
      },
      bypass_actors: [],
      rules: [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: true,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: true,
          },
        },
      ],
    }],
    ['GET repos/limweili/eido-releases/environments/release-promotion', {
      name: 'release-promotion',
      protection_rules: [
        {
          type: 'required_reviewers',
          prevent_self_review: false,
          reviewers: [
            { type: 'User', reviewer: { login: 'limweili' } },
          ],
        },
      ],
      deployment_branch_policy: {
        protected_branches: true,
        custom_branch_policies: false,
      },
    }],
    ['GET repos/limweili/eido-releases/environments/release-promotion/secrets?per_page=100', {
      total_count: 0,
      secrets: [],
    }],
    ['GET repos/limweili/eido/environments/release-publish', {
      name: 'release-publish',
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    }],
    ['GET repos/limweili/eido/environments/release-publish/deployment-branch-policies?per_page=100', {
      total_count: 1,
      branch_policies: [{ id: 8, name: 'main', type: 'branch' }],
    }],
    ['GET repos/limweili/eido/environments/release-publish/variables?per_page=100', {
      total_count: 2,
      variables: [
        { name: 'EIDO_RELEASE_APP_ID', value: '123456' },
        {
          name: 'EIDO_RELEASE_REPOSITORY',
          value: 'limweili/eido-releases',
        },
      ],
    }],
    ['GET repos/limweili/eido/environments/release-publish/secrets?per_page=100', {
      total_count: 1,
      secrets: [{ name: 'EIDO_RELEASE_APP_PRIVATE_KEY' }],
    }],
    ['GET repos/limweili/eido/actions/secrets?per_page=100', {
      total_count: 0,
      secrets: [],
    }],
    ['GET repos/limweili/eido/environments?per_page=100', {
      total_count: 2,
      environments: [{ name: 'release-publish' }, { name: 'preview' }],
    }],
    ['GET repos/limweili/eido/environments/preview/secrets?per_page=100', {
      total_count: 0,
      secrets: [],
    }],
    ['GET apps/eido-release-publisher-limweili', {
      id: 123456,
      slug: 'eido-release-publisher-limweili',
      node_id: 'MDM6QXBwMTIzNDU2',
      owner: { login: 'limweili', id: 1 },
      name: 'Eido Release Publisher',
      description: 'Publishes Eido release artifacts.',
      external_url: 'https://github.com/limweili/eido-releases',
      html_url: 'https://github.com/apps/eido-release-publisher-limweili',
      created_at: '2026-07-17T00:00:00Z',
      updated_at: '2026-07-17T00:00:00Z',
      permissions: { contents: 'write', metadata: 'read' },
      events: [],
    }],
    ['GET user/installations?per_page=100', {
      total_count: 1,
      installations: [
        {
          id: 9,
          app_id: 123456,
          app_slug: 'eido-release-publisher-limweili',
          repository_selection: 'selected',
        },
      ],
    }],
    ['GET user/installations/9/repositories?per_page=100', {
      total_count: 1,
      repositories: [{ full_name: 'limweili/eido-releases' }],
    }],
    ['GET repos/limweili/eido-releases/private-vulnerability-reporting', {
      enabled: true,
    }],
  ])
  for (const file of files) {
    responses.set(
      `GET repos/limweili/eido-releases/contents/${file.path}`,
      {
        sha: 'git-blob-sha',
        encoding: 'base64',
        content: Buffer.from(file.content, 'utf8').toString('base64'),
      },
    )
  }

  const client = createGhPublicReleaseRepositoryClient({
    async runGh(args) {
      const key = `${args[2]} ${args[3]}`
      assert.ok(responses.has(key), `unexpected GitHub API call: ${key}`)
      return JSON.stringify(responses.get(key))
    },
    async probeGithubAppToken() {
      return {
        repository: 'limweili/eido-releases',
        permissions: { contents: 'read', metadata: 'read' },
        sourceRepositoryWriteDenied: true,
        expiresAt: '2026-07-17T12:00:00Z',
      }
    },
  })

  const snapshot = await client.snapshot(policy)
  const incompleteVerification = verifyPublicReleaseRepository({
    policy,
    snapshot,
  })
  assert.equal(incompleteVerification.verdict, 'OWNER_EVIDENCE_REQUIRED')
  snapshot.ownerEvidence = validSnapshot(policy).ownerEvidence
  const verification = verifyPublicReleaseRepository({ policy, snapshot })

  assert.equal(
    verification.verdict,
    'PASS',
    JSON.stringify(verification.violations),
  )
  assert.deepEqual(snapshot.template.sha256, policy.template.sha256)
  assert.deepEqual(snapshot.repositorySecrets, [])
  assert.deepEqual(snapshot.githubApp.repositories, [
    'limweili/eido-releases',
  ])
  assert.equal(snapshot.githubApp.id, 123456)
  assert.deepEqual(snapshot.sourceEnvironment.secrets, [
    'EIDO_RELEASE_APP_PRIVATE_KEY',
  ])
  assert.deepEqual(snapshot.sourceSecretBoundary, {
    repositorySecrets: [],
    environments: {
      preview: [],
      'release-publish': ['EIDO_RELEASE_APP_PRIVATE_KEY'],
    },
  })

  const appPath = 'GET apps/eido-release-publisher-limweili'
  const appResponse = responses.get(appPath)
  const { events: _events, ...appWithoutEvents } = appResponse
  responses.set(appPath, appWithoutEvents)
  await assert.rejects(
    client.snapshot(policy),
    /GitHub App event evidence was incomplete or malformed/i,
  )
  responses.set(appPath, appResponse)

  const rulesetPath = 'GET repos/limweili/eido-releases/rulesets/7'
  const rulesetResponse = responses.get(rulesetPath)
  const { bypass_actors: _bypassActors, ...rulesetWithoutBypassActors } =
    rulesetResponse
  responses.set(rulesetPath, rulesetWithoutBypassActors)
  await assert.rejects(
    client.snapshot(policy),
    /ruleset bypass-actor evidence was incomplete or unavailable/i,
  )
  responses.set(rulesetPath, rulesetResponse)

  const branchPoliciesPath =
    'GET repos/limweili/eido/environments/release-publish/deployment-branch-policies?per_page=100'
  for (const malformedBranchPolicies of [
    {
      total_count: 2,
      branch_policies: [{ id: 8, name: 'main', type: 'branch' }],
    },
    {
      total_count: 1,
      branch_policies: [{ id: 8, name: 'main' }],
    },
  ]) {
    responses.set(branchPoliciesPath, malformedBranchPolicies)
    await assert.rejects(
      client.snapshot(policy),
      /source environment branch-policy evidence was incomplete or malformed/i,
    )
  }

  responses.set(branchPoliciesPath, {
    total_count: 1,
    branch_policies: [{ id: 8, name: 'main', type: 'branch' }],
  })
  for (const [path, label] of [
    [
      'GET repos/limweili/eido-releases/actions/secrets?per_page=100',
      'Public repository secret-name',
    ],
    [
      'GET repos/limweili/eido-releases/environments/release-promotion/secrets?per_page=100',
      'Public promotion environment secret-name',
    ],
  ]) {
    responses.set(path, { total_count: 1, secrets: [] })
    await assert.rejects(
      client.snapshot(policy),
      new RegExp(`${label} evidence was incomplete or malformed`, 'i'),
    )
    responses.set(path, { total_count: 0, secrets: [] })
  }

  for (const [path, malformed, valid, label] of [
    [
      'GET user/installations?per_page=100',
      {
        total_count: 2,
        installations: [
          {
            id: 9,
            app_id: 123456,
            app_slug: 'eido-release-publisher-limweili',
            repository_selection: 'selected',
          },
        ],
      },
      {
        total_count: 1,
        installations: [
          {
            id: 9,
            app_id: 123456,
            app_slug: 'eido-release-publisher-limweili',
            repository_selection: 'selected',
          },
        ],
      },
      'User installation',
    ],
    [
      'GET user/installations/9/repositories?per_page=100',
      {
        total_count: 2,
        repositories: [{ full_name: 'limweili/eido-releases' }],
      },
      {
        total_count: 1,
        repositories: [{ full_name: 'limweili/eido-releases' }],
      },
      'Installed repository',
    ],
  ]) {
    responses.set(path, malformed)
    await assert.rejects(
      client.snapshot(policy),
      new RegExp(`${label} evidence was incomplete or malformed`, 'i'),
    )
    responses.set(path, valid)
  }

  const sourceVariablesPath =
    'GET repos/limweili/eido/environments/release-publish/variables?per_page=100'
  const sourceVariables = [
    { name: 'EIDO_RELEASE_APP_ID', value: '123456' },
    {
      name: 'EIDO_RELEASE_REPOSITORY',
      value: 'limweili/eido-releases',
    },
  ]
  responses.set(sourceVariablesPath, {
    total_count: 3,
    variables: sourceVariables,
  })
  await assert.rejects(
    client.snapshot(policy),
    /Source environment variable evidence was incomplete or malformed/i,
  )
  responses.set(sourceVariablesPath, {
    total_count: 2,
    variables: sourceVariables,
  })

  responses.set(
    'GET repos/limweili/eido-releases/git/trees/main?recursive=1',
    {
      sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      truncated: false,
      tree: [
        ...files.map((file) => ({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        })),
        {
          path: 'vendor/private-source',
          mode: '160000',
          type: 'commit',
          sha: 'cccccccccccccccccccccccccccccccccccccccc',
        },
      ],
    },
  )
  await assert.rejects(
    client.snapshot(policy),
    /recursive tree contains a non-template or non-regular entry/i,
  )
})

test('the GitHub adapter passes the App private key to gh secret set through stdin only', async () => {
  const policy = await loadPublicReleasePolicy()
  const calls = []
  const client = createGhPublicReleaseRepositoryClient({
    privateKey: 'ephemeral-private-key-test-value',
    async runGh(args, options = {}) {
      calls.push({ args, inputPresent: typeof options.input === 'string' })
      assert.equal(options.input, 'ephemeral-private-key-test-value')
      return ''
    },
  })

  await client.applyMutation(
    {
      id: 'set-source-app-private-key',
      method: 'setSourceAppPrivateKey',
      requires: 'private-key-stdin',
    },
    { policy },
  )

  assert.deepEqual(calls, [
    {
      args: [
        'secret',
        'set',
        'EIDO_RELEASE_APP_PRIVATE_KEY',
        '--env',
        'release-publish',
        '--repo',
        'limweili/eido',
      ],
      inputPresent: true,
    },
  ])
  assert.doesNotMatch(JSON.stringify(calls), /ephemeral-private-key-test-value/)
})

test('the GitHub adapter never turns a variable update failure into a create', async () => {
  const policy = await loadPublicReleasePolicy()
  const calls = []
  const variableRoot =
    'repos/limweili/eido/environments/release-publish/variables'
  const client = createGhPublicReleaseRepositoryClient({
    async runGh(args) {
      const call = `${args[2]} ${args[3]}`
      calls.push(call)
      if (call === `GET ${variableRoot}/EIDO_RELEASE_REPOSITORY`) {
        return JSON.stringify({
          name: 'EIDO_RELEASE_REPOSITORY',
          value: 'limweili/eido-releases',
        })
      }
      if (call === `PATCH ${variableRoot}/EIDO_RELEASE_REPOSITORY`) {
        const error = new Error('variable update failed')
        error.statusCode = 404
        throw error
      }
      return ''
    },
  })

  await assert.rejects(
    client.applyMutation(
      {
        id: 'set-source-release-repository-variable',
        method: 'setSourceReleaseRepositoryVariable',
      },
      { policy },
    ),
    /variable update failed/,
  )
  assert.deepEqual(calls, [
    `GET ${variableRoot}/EIDO_RELEASE_REPOSITORY`,
    `PATCH ${variableRoot}/EIDO_RELEASE_REPOSITORY`,
  ])
})

test('the GitHub adapter updates the named ruleset instead of creating a duplicate', async () => {
  const policy = await loadPublicReleasePolicy()
  const calls = []
  const client = createGhPublicReleaseRepositoryClient({
    async runGh(args) {
      calls.push(`${args[2]} ${args[3]}`)
      if (args[2] === 'GET') {
        return JSON.stringify([{ id: 7, name: 'protect-main' }])
      }
      return ''
    },
  })

  await client.applyMutation(
    { id: 'configure-main-ruleset', method: 'configureMainRuleset' },
    { policy },
  )

  assert.deepEqual(calls, [
    'GET repos/limweili/eido-releases/rulesets',
    'PUT repos/limweili/eido-releases/rulesets/7',
  ])
})

test('the GitHub adapter converges source environment branch-policy drift', async () => {
  const policy = await loadPublicReleasePolicy()
  const calls = []
  const branchPolicyRoot =
    'repos/limweili/eido/environments/release-publish/deployment-branch-policies'
  const client = createGhPublicReleaseRepositoryClient({
    async runGh(args, options = {}) {
      const call = { method: args[2], path: args[3], input: options.input }
      calls.push(call)
      if (
        call.method === 'GET' &&
        call.path ===
          'repos/limweili/eido/environments/release-publish'
      ) {
        return JSON.stringify({
          name: 'release-publish',
          protection_rules: [],
        })
      }
      if (call.method === 'GET' && call.path === `${branchPolicyRoot}?per_page=100`) {
        return JSON.stringify({
          total_count: 1,
          branch_policies: [{ id: 8, name: 'main', type: 'tag' }],
        })
      }
      return ''
    },
  })

  await client.applyMutation(
    {
      id: 'configure-source-environment',
      method: 'configureSourceEnvironment',
    },
    { policy },
  )

  assert.deepEqual(
    calls.map(({ method, path }) => `${method} ${path}`),
    [
      'GET repos/limweili/eido/environments/release-publish',
      'PUT repos/limweili/eido/environments/release-publish',
      `GET ${branchPolicyRoot}?per_page=100`,
      `DELETE ${branchPolicyRoot}/8`,
      `POST ${branchPolicyRoot}`,
    ],
  )
  assert.deepEqual(JSON.parse(calls.at(-1).input), {
    name: 'main',
    type: 'branch',
  })
})

test('the GitHub adapter preserves existing private environment reviewer and wait controls', async () => {
  const policy = await loadPublicReleasePolicy()
  const calls = []
  const sourceRoot =
    'repos/limweili/eido/environments/release-publish'
  const client = createGhPublicReleaseRepositoryClient({
    async runGh(args, options = {}) {
      const call = { method: args[2], path: args[3], input: options.input }
      calls.push(call)
      if (call.method === 'GET' && call.path === sourceRoot) {
        return JSON.stringify({
          name: 'release-publish',
          protection_rules: [
            { id: 1, node_id: 'WAIT', type: 'wait_timer', wait_timer: 30 },
            {
              id: 2,
              node_id: 'REVIEW',
              type: 'required_reviewers',
              prevent_self_review: true,
              reviewers: [
                { type: 'User', reviewer: { id: 42, login: 'limweili' } },
              ],
            },
            { id: 3, node_id: 'BRANCH', type: 'branch_policy' },
          ],
        })
      }
      if (
        call.method === 'GET' &&
        call.path === `${sourceRoot}/deployment-branch-policies?per_page=100`
      ) {
        return JSON.stringify({
          total_count: 1,
          branch_policies: [
            { id: 8, name: 'main', type: 'branch' },
          ],
        })
      }
      return ''
    },
  })

  await client.applyMutation(
    {
      id: 'configure-source-environment',
      method: 'configureSourceEnvironment',
    },
    { policy },
  )

  const update = calls.find(
    (call) => call.method === 'PUT' && call.path === sourceRoot,
  )
  assert.deepEqual(JSON.parse(update.input), {
    wait_timer: 30,
    prevent_self_review: true,
    reviewers: [{ type: 'User', id: 42 }],
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  })
})

test('the GitHub adapter rejects incomplete private environment protection evidence before mutation', async () => {
  const policy = await loadPublicReleasePolicy()
  const calls = []
  const sourceRoot =
    'repos/limweili/eido/environments/release-publish'
  const client = createGhPublicReleaseRepositoryClient({
    async runGh(args) {
      const call = `${args[2]} ${args[3]}`
      calls.push(call)
      if (call === `GET ${sourceRoot}`) {
        return JSON.stringify({ name: 'release-publish' })
      }
      if (
        call ===
        `GET ${sourceRoot}/deployment-branch-policies?per_page=100`
      ) {
        return JSON.stringify({
          total_count: 1,
          branch_policies: [{ id: 8, name: 'main', type: 'branch' }],
        })
      }
      return ''
    },
  })

  await assert.rejects(
    client.applyMutation(
      {
        id: 'configure-source-environment',
        method: 'configureSourceEnvironment',
      },
      { policy },
    ),
    /source environment protection-rule evidence was incomplete or unsupported/i,
  )
  assert.deepEqual(calls, [`GET ${sourceRoot}`])
})

test('the installation-token probe scopes access without putting credentials in command arguments', async () => {
  const policy = await loadPublicReleasePolicy()
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const calls = []
  const client = createGhPublicReleaseRepositoryClient({
    privateKey: privateKeyPem,
    now: () => new Date('2026-07-17T11:00:00Z'),
    async runGh(args, options = {}) {
      const method = args[2]
      const path = args[3]
      calls.push({ method, path, input: options.input })
      assert.equal(typeof options.env?.GH_TOKEN, 'string')

      if (path === 'app/installations?per_page=100') {
        return JSON.stringify([
          { id: 9, account: { login: 'limweili' } },
        ])
      }
      if (path === 'app/installations/9/access_tokens') {
        assert.deepEqual(JSON.parse(options.input), {
          repositories: ['eido-releases'],
          permissions: { contents: 'read' },
        })
        return JSON.stringify({
          token: 'installation-token-value',
          expires_at: '2026-07-17T12:00:00Z',
          permissions: { contents: 'read', metadata: 'read' },
          repositories: [{ full_name: 'limweili/eido-releases' }],
        })
      }
      if (path === 'repos/limweili/eido-releases') {
        assert.equal(options.env.GH_TOKEN, 'installation-token-value')
        return JSON.stringify({ full_name: 'limweili/eido-releases' })
      }
      if (path === 'installation/repositories?per_page=100') {
        assert.equal(options.env.GH_TOKEN, 'installation-token-value')
        return JSON.stringify({
          total_count: 1,
          repositories: [{ full_name: 'limweili/eido-releases' }],
        })
      }
      throw new Error(`unexpected probe call: ${method} ${path}`)
    },
  })

  const probe = await client.probeGithubAppToken({
    policy,
    app: { id: 123456 },
  })

  assert.deepEqual(probe, {
    repository: 'limweili/eido-releases',
    permissions: { contents: 'read', metadata: 'read' },
    sourceRepositoryWriteDenied: true,
    expiresAt: '2026-07-17T12:00:00Z',
    privateKeyValidated: true,
  })
  assert.doesNotMatch(
    JSON.stringify(calls),
    /BEGIN PRIVATE KEY|installation-token-value/,
  )
})

test('verify --json emits machine evidence and a fail-closed exit code', async () => {
  const policy = await loadPublicReleasePolicy()
  const ownerObservedAt = '2030-01-01T11:00:00Z'
  const stdout = []
  const stderr = []
  const passCode = await runPublicReleaseRepositoryCli({
    argv: ['verify', '--json'],
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    now: () => new Date('2030-01-01T12:00:00Z'),
    clientFactory: () => ({
      async snapshot() {
        return validSnapshot(policy, ownerObservedAt)
      },
    }),
  })

  assert.equal(passCode, 0)
  assert.equal(JSON.parse(stdout.join('\n')).verdict, 'PASS')
  assert.deepEqual(stderr, [])

  stdout.length = 0
  const blockCode = await runPublicReleaseRepositoryCli({
    argv: ['verify', '--json'],
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    clientFactory: () => ({
      async snapshot() {
        return { repository: null }
      },
    }),
  })

  assert.equal(blockCode, 1)
  assert.equal(JSON.parse(stdout.join('\n')).verdict, 'BLOCK')
})

test('plan --json is read-only and apply requires the exact confirmation flag', async () => {
  const stdout = []
  const calls = []
  const clientFactory = () => ({
    async snapshot() {
      calls.push('snapshot')
      return { repository: null }
    },
    async applyMutation() {
      calls.push('mutation')
    },
  })

  const planCode = await runPublicReleaseRepositoryCli({
    argv: ['plan', '--json'],
    stdout: (line) => stdout.push(line),
    stderr: () => {},
    clientFactory,
  })
  assert.equal(planCode, 0)
  assert.equal(JSON.parse(stdout.join('\n')).verdict, 'READY')
  assert.deepEqual(calls, ['snapshot'])

  stdout.length = 0
  const applyCode = await runPublicReleaseRepositoryCli({
    argv: ['apply', '--json', '--confirm', 'limweili/eido'],
    stdout: (line) => stdout.push(line),
    stderr: () => {},
    clientFactory,
  })
  assert.equal(applyCode, 2)
  assert.equal(JSON.parse(stdout.join('\n')).reason, 'repository-confirmation-mismatch')
  assert.deepEqual(calls, ['snapshot', 'snapshot'])
})

test('CLI provider failures redact credential-shaped diagnostics', async () => {
  const stdout = []
  const exitCode = await runPublicReleaseRepositoryCli({
    argv: ['verify', '--json'],
    stdout: (line) => stdout.push(line),
    stderr: () => {},
    clientFactory: () => ({
      async snapshot() {
        throw new Error(
          'failed with ghp_abcdefghijklmnopqrstuvwxyz123456, github_pat_11AA22BB33CC44DD55EE66FF77GG88HH, and -----BEGIN PRIVATE KEY-----\nvalue\n-----END PRIVATE KEY-----',
        )
      },
    }),
  })

  const output = stdout.join('\n')
  assert.equal(exitCode, 2)
  assert.doesNotMatch(
    output,
    /ghp_|github_pat_|BEGIN PRIVATE KEY|\nvalue\n/,
  )
  assert.match(output, /\[REDACTED\]/)
})

test('CLI consumes the UI-only control through an explicit external acceptance envelope', async () => {
  const policy = await loadPublicReleasePolicy()
  const snapshot = validSnapshot(policy)
  const ownerEvidence = snapshot.ownerEvidence
  delete snapshot.ownerEvidence
  const stdout = []
  const clientFactory = () => ({
    async snapshot() {
      return structuredClone(snapshot)
    },
  })

  const missingCode = await runPublicReleaseRepositoryCli({
    argv: ['verify', '--json'],
    stdout: (line) => stdout.push(line),
    stderr: () => {},
    clientFactory,
  })
  assert.equal(missingCode, 3)
  assert.equal(
    JSON.parse(stdout.join('\n')).verdict,
    'OWNER_EVIDENCE_REQUIRED',
  )

  stdout.length = 0
  const completeCode = await runPublicReleaseRepositoryCli({
    argv: ['verify', '--json', '--owner-evidence', 'acceptance.json'],
    stdout: (line) => stdout.push(line),
    stderr: () => {},
    clientFactory,
    async readOwnerEvidence(path) {
      assert.equal(path, 'acceptance.json')
      return ownerEvidence
    },
  })
  assert.equal(completeCode, 0)
  assert.equal(JSON.parse(stdout.join('\n')).verdict, 'PASS')
})
