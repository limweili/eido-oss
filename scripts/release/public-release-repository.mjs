import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createHash, sign } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const DEFAULT_POLICY_URL = new URL(
  '../../release/public-repository/policy.json',
  import.meta.url,
)

function parseCanonicalUtcTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return Number.NaN
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return Number.NaN
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z')
  return new Date(parsed).toISOString() === normalized ? parsed : Number.NaN
}

export async function loadPublicReleasePolicy(policyUrl = DEFAULT_POLICY_URL) {
  return JSON.parse(await readFile(policyUrl, 'utf8'))
}

export async function loadPublicReleaseTemplate(
  policy,
  { readTemplateFile = readFile } = {},
) {
  return Promise.all(
    policy.template.allowedPaths.map(async (path) => {
      const content = (
        await readTemplateFile(
          new URL(`../../${policy.template.directory}/${path}`, import.meta.url),
          'utf8',
        )
      ).replace(/\r\n?/g, '\n')
      return {
        path,
        content,
        sha256: createHash('sha256').update(content).digest('hex'),
      }
    }),
  )
}

const BOOTSTRAP_MUTATIONS = Object.freeze([
  ['create-public-repository', 'createPublicRepository'],
  ['configure-repository-settings', 'configureRepositorySettings'],
  ['write-public-template', 'writePublicTemplate'],
  ['enable-immutable-releases', 'enableImmutableReleases'],
  ['configure-actions-policy', 'configureActionsPolicy'],
  ['configure-main-ruleset', 'configureMainRuleset'],
  ['configure-promotion-environment', 'configurePromotionEnvironment'],
  [
    'enable-private-vulnerability-reporting',
    'enablePrivateVulnerabilityReporting',
  ],
  ['configure-source-environment', 'configureSourceEnvironment'],
  [
    'set-source-release-repository-variable',
    'setSourceReleaseRepositoryVariable',
  ],
])

const CREDENTIAL_MUTATIONS = Object.freeze([
  ['set-source-app-id-variable', 'setSourceAppIdVariable'],
  [
    'set-source-app-private-key',
    'setSourceAppPrivateKey',
    'private-key-stdin',
  ],
])

function bootstrapMutations() {
  return BOOTSTRAP_MUTATIONS.map(([id, method]) => ({ id, method }))
}

function mutationById(id) {
  const entry = [...BOOTSTRAP_MUTATIONS, ...CREDENTIAL_MUTATIONS].find(
    ([candidate]) => candidate === id,
  )
  if (!entry) throw new Error(`Unknown release-repository mutation: ${id}`)
  return {
    id: entry[0],
    method: entry[1],
    ...(entry[2] ? { requires: entry[2] } : {}),
  }
}

function githubAppOwnerAction(policy) {
  return {
    id: 'register-public-only-github-app',
    reason:
      'GitHub App registration and private-key creation require an owner in GitHub settings.',
    repositories: [...policy.githubApp.repositories],
    forbiddenRepositories: [...policy.githubApp.forbiddenRepositories],
    permissions: { ...policy.githubApp.permissions },
  }
}

function promotionAdminBypassOwnerAction(policy) {
  return {
    id: 'disable-promotion-admin-bypass',
    reason:
      'GitHub exposes this environment control only in the authenticated settings UI.',
    settingsUrl:
      policy.ownerEvidence.promotionEnvironmentAdminBypassDisabled.settingsUrl,
    evidenceRequirement: {
      observer:
        policy.ownerEvidence.promotionEnvironmentAdminBypassDisabled.observer,
      observedAt: true,
      evidence: {
        kind:
          policy.ownerEvidence.promotionEnvironmentAdminBypassDisabled
            .evidenceKind,
        control:
          policy.ownerEvidence.promotionEnvironmentAdminBypassDisabled.control,
        settingsUrl:
          policy.ownerEvidence.promotionEnvironmentAdminBypassDisabled
            .settingsUrl,
        captureUrlPrefix:
          policy.ownerEvidence.promotionEnvironmentAdminBypassDisabled
            .captureUrlPrefix,
      },
      maxAgeHours:
        policy.ownerEvidence.promotionEnvironmentAdminBypassDisabled.maxAgeHours,
      maxFutureSkewMinutes:
        policy.ownerEvidence.promotionEnvironmentAdminBypassDisabled
          .maxFutureSkewMinutes,
    },
  }
}

export function createGhPublicReleaseRepositoryClient({
  runGh,
  privateKey,
  now = () => new Date(),
  probeGithubAppToken,
}) {
  async function callApi(method, path, body, runtimeOptions = {}) {
    const args = [
      'api',
      '--method',
      method,
      path,
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'X-GitHub-Api-Version: 2026-03-10',
    ]
    const options = { ...runtimeOptions }
    if (body !== undefined) options.input = JSON.stringify(body)
    if (body !== undefined) args.push('--input', '-')
    return runGh(args, options)
  }

  async function readApi(path, runtimeOptions) {
    return JSON.parse(
      await callApi('GET', path, undefined, runtimeOptions),
    )
  }

  async function readOptional(path, notFoundStatuses = [404]) {
    try {
      return await readApi(path)
    } catch (error) {
      if (notFoundStatuses.includes(error.statusCode)) return null
      throw error
    }
  }

  function completeCollection(
    response,
    key,
    label,
    isValid,
    identity,
  ) {
    const values = response?.[key]
    if (
      !Array.isArray(values) ||
      !Number.isInteger(response?.total_count) ||
      response.total_count !== values.length ||
      values.some((value) => !isValid(value)) ||
      new Set(values.map((value) => identity(value))).size !== values.length
    ) {
      throw new Error(`${label} evidence was incomplete or malformed`)
    }
    return values
  }

  function completeNamedCollection(response, key, label) {
    const values = completeCollection(
      response,
      key,
      label,
      (value) => typeof value?.name === 'string' && value.name.length > 0,
      (value) => value.name,
    )
    return values.map((value) => value.name).sort()
  }

  function completeDeploymentBranchPolicies(response) {
    const values = response?.branch_policies
    if (
      !Array.isArray(values) ||
      !Number.isInteger(response?.total_count) ||
      response.total_count !== values.length ||
      values.some(
        (value) =>
          !Number.isInteger(value?.id) ||
          typeof value?.name !== 'string' ||
          value.name.length === 0 ||
          !['branch', 'tag'].includes(value?.type),
      ) ||
      new Set(values.map((value) => value.id)).size !== values.length
    ) {
      throw new Error(
        'Source environment branch-policy evidence was incomplete or malformed',
      )
    }
    return values
      .map(({ id, name, type }) => ({ id, name, type }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.type.localeCompare(right.type) ||
          left.id - right.id,
      )
  }

  const tokenProbe =
    probeGithubAppToken ??
    (privateKey
      ? async ({ policy, app }) => {
          const issuedAt = Math.floor(now().getTime() / 1000) - 60
          const encode = (value) =>
            Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
          const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
            iat: issuedAt,
            exp: issuedAt + 9 * 60,
            iss: app.id,
          })}`
          const jwt = `${unsigned}.${sign(
            'RSA-SHA256',
            Buffer.from(unsigned, 'utf8'),
            privateKey,
          ).toString('base64url')}`
          const appAuth = { env: { GH_TOKEN: jwt } }
          const appInstallations = await readApi(
            'app/installations?per_page=100',
            appAuth,
          )
          if (!Array.isArray(appInstallations)) {
            throw new Error('GitHub App installations evidence has an unexpected shape')
          }
          const installation = appInstallations.find(
            (candidate) =>
              candidate.account?.login === policy.repository.owner,
          )
          if (!installation) {
            throw new Error(
              `GitHub App is not installed for ${policy.repository.owner}`,
            )
          }
          const access = JSON.parse(
            await callApi(
              'POST',
              `app/installations/${installation.id}/access_tokens`,
              {
                repositories: [policy.repository.name],
                permissions: { contents: 'read' },
              },
              appAuth,
            ),
          )
          const installationAuth = { env: { GH_TOKEN: access.token } }
          const targetRepository = await readApi(
            `repos/${policy.repository.fullName}`,
            installationAuth,
          )
          // Public source metadata is readable by anyone. Enumerate the
          // installation token's authorized repositories instead of treating
          // an HTTP 404 as proof that the publisher cannot mutate source.
          const authorizedRepositories = completeCollection(
            await readApi('installation/repositories?per_page=100', installationAuth),
            'repositories',
            'GitHub App token repository scope',
            (repository) => typeof repository?.full_name === 'string' && repository.full_name.length > 0,
            (repository) => repository.full_name,
          ).map((repository) => repository.full_name).sort()
          const sourceRepositoryWriteDenied =
            !authorizedRepositories.includes(policy.sourceEnvironment.repository)

          return {
            repository: targetRepository.full_name,
            permissions: { ...(access.permissions ?? {}) },
            sourceRepositoryWriteDenied,
            expiresAt: access.expires_at,
            privateKeyValidated: true,
          }
        }
      : async () => null)

  async function upsertSourceVariable(policy, name, value) {
    const environment = policy.sourceEnvironment
    const root = `repos/${environment.repository}/environments/${encodeURIComponent(environment.name)}/variables`
    let exists = true
    try {
      await callApi('GET', `${root}/${name}`)
    } catch (error) {
      if (error.statusCode !== 404) throw error
      exists = false
    }
    if (exists) {
      await callApi('PATCH', `${root}/${name}`, { name, value })
    } else {
      await callApi('POST', root, { name, value })
    }
  }

  const mutations = {
    async createPublicRepository(policy) {
      const repository = policy.repository
      const authenticatedUser = await readApi('user')
      if (authenticatedUser.login !== repository.owner) {
        throw new Error(
          `Authenticated GitHub owner does not match ${repository.owner}`,
        )
      }
      await callApi('POST', 'user/repos', {
        name: repository.name,
        description: repository.description,
        private: false,
        has_issues: repository.features.issues,
        has_projects: repository.features.projects,
        has_wiki: repository.features.wiki,
        has_discussions: repository.features.discussions,
        auto_init: true,
      })
    },
    async writePublicTemplate(policy) {
      const files = await loadPublicReleaseTemplate(policy)
      for (const file of files) {
        const encodedPath = file.path
          .split('/')
          .map((part) => encodeURIComponent(part))
          .join('/')
        const path = `repos/${policy.repository.fullName}/contents/${encodedPath}`
        let sha
        try {
          const current = JSON.parse(await callApi('GET', path))
          sha = current.sha
        } catch (error) {
          if (error.statusCode !== 404) throw error
        }
        await callApi('PUT', path, {
          message: policy.template.commitMessage,
          content: Buffer.from(file.content, 'utf8').toString('base64'),
          branch: policy.repository.defaultBranch,
          ...(sha ? { sha } : {}),
        })
      }
    },
    async configureRepositorySettings(policy) {
      const repository = policy.repository
      const current = await readApi(`repos/${repository.fullName}`)
      if (
        typeof current.default_branch !== 'string' ||
        current.default_branch.length === 0
      ) {
        throw new Error('GitHub repository default-branch evidence is missing')
      }
      if (current.default_branch !== repository.defaultBranch) {
        await callApi(
          'POST',
          `repos/${repository.fullName}/branches/${encodeURIComponent(current.default_branch)}/rename`,
          { new_name: repository.defaultBranch },
        )
      }
      await callApi('PATCH', `repos/${repository.fullName}`, {
        name: repository.name,
        description: repository.description,
        visibility: repository.visibility,
        default_branch: repository.defaultBranch,
        archived: repository.archived,
        has_issues: repository.features.issues,
        has_projects: repository.features.projects,
        has_wiki: repository.features.wiki,
        has_discussions: repository.features.discussions,
        allow_squash_merge: repository.mergePolicy.allowSquashMerge,
        allow_merge_commit: repository.mergePolicy.allowMergeCommit,
        allow_rebase_merge: repository.mergePolicy.allowRebaseMerge,
        delete_branch_on_merge:
          repository.mergePolicy.deleteBranchOnMerge,
      })
    },
    async enableImmutableReleases(policy) {
      await callApi(
        'PUT',
        `repos/${policy.repository.fullName}/immutable-releases`,
      )
    },
    async configureActionsPolicy(policy) {
      const root = `repos/${policy.repository.fullName}/actions/permissions`
      await callApi('PUT', root, {
        enabled: policy.actions.enabled,
        allowed_actions: policy.actions.allowedActions,
        sha_pinning_required: policy.actions.shaPinningRequired,
      })
      await callApi('PUT', `${root}/selected-actions`, {
        github_owned_allowed: policy.actions.githubOwnedAllowed,
        verified_allowed: policy.actions.verifiedAllowed,
        patterns_allowed: policy.actions.patternsAllowed,
      })
      await callApi('PUT', `${root}/workflow`, {
        default_workflow_permissions:
          policy.actions.defaultWorkflowPermissions,
        can_approve_pull_request_reviews:
          policy.actions.canApprovePullRequestReviews,
      })
      await callApi('PUT', `${root}/artifact-and-log-retention`, {
        days: policy.actions.retentionDays,
      })
    },
    async configureMainRuleset(policy) {
      const parametersToApi = (parameters) =>
        parameters
          ? {
              required_approving_review_count:
                parameters.requiredApprovingReviewCount,
              dismiss_stale_reviews_on_push:
                parameters.dismissStaleReviewsOnPush,
              require_code_owner_review:
                parameters.requireCodeOwnerReview,
              require_last_push_approval:
                parameters.requireLastPushApproval,
              required_review_thread_resolution:
                parameters.requiredReviewThreadResolution,
            }
          : undefined
      const root = `repos/${policy.repository.fullName}/rulesets`
      const existing = (await readApi(root)).find(
        (ruleset) => ruleset.name === policy.mainRuleset.name,
      )
      await callApi(existing ? 'PUT' : 'POST', existing ? `${root}/${existing.id}` : root, {
        name: policy.mainRuleset.name,
        target: policy.mainRuleset.target,
        enforcement: policy.mainRuleset.enforcement,
        bypass_actors: policy.mainRuleset.bypassActors,
        conditions: {
          ref_name: {
            include: policy.mainRuleset.conditions.include,
            exclude: policy.mainRuleset.conditions.exclude,
          },
        },
        rules: policy.mainRuleset.rules.map((rule) => ({
          type: rule.type,
          ...(rule.parameters
            ? { parameters: parametersToApi(rule.parameters) }
            : {}),
        })),
      })
    },
    async configurePromotionEnvironment(policy) {
      const reviewers = []
      for (const login of policy.promotionEnvironment.requiredReviewers) {
        const user = JSON.parse(await callApi('GET', `users/${login}`))
        reviewers.push({ type: 'User', id: user.id })
      }
      await callApi(
        'PUT',
        `repos/${policy.repository.fullName}/environments/${encodeURIComponent(policy.promotionEnvironment.name)}`,
        {
          prevent_self_review:
            policy.promotionEnvironment.preventSelfReview,
          reviewers,
          deployment_branch_policy: {
            protected_branches:
              policy.promotionEnvironment.protectedBranches,
            custom_branch_policies:
              policy.promotionEnvironment.customBranchPolicies,
          },
        },
      )
    },
    async enablePrivateVulnerabilityReporting(policy) {
      await callApi(
        'PUT',
        `repos/${policy.repository.fullName}/private-vulnerability-reporting`,
      )
    },
    async configureSourceEnvironment(policy) {
      const environment = policy.sourceEnvironment
      const root = `repos/${environment.repository}/environments/${encodeURIComponent(environment.name)}`
      const current = await readOptional(root)
      const protectionRules = current ? current.protection_rules : []
      const supportedProtectionRuleTypes = new Set([
        'wait_timer',
        'required_reviewers',
        'branch_policy',
      ])
      if (
        !Array.isArray(protectionRules) ||
        protectionRules.some(
          (rule) =>
            !rule ||
            !supportedProtectionRuleTypes.has(rule.type),
        ) ||
        new Set(protectionRules.map((rule) => rule.type)).size !==
          protectionRules.length
      ) {
        throw new Error(
          'GitHub source environment protection-rule evidence was incomplete or unsupported',
        )
      }
      const waitTimerRule = protectionRules.find(
        (rule) => rule.type === 'wait_timer',
      )
      const reviewerRule = protectionRules.find(
        (rule) => rule.type === 'required_reviewers',
      )
      const reviewers = reviewerRule?.reviewers?.map((reviewer) => ({
        type: reviewer.type,
        id: reviewer.reviewer?.id,
      }))
      if (
        (waitTimerRule && !Number.isInteger(waitTimerRule.wait_timer)) ||
        (reviewerRule &&
          (typeof reviewerRule.prevent_self_review !== 'boolean' ||
            !Array.isArray(reviewers) ||
            reviewers.some(
              (reviewer) =>
                !['User', 'Team'].includes(reviewer.type) ||
                !Number.isInteger(reviewer.id),
            )))
      ) {
        throw new Error(
          'GitHub source environment protection-rule evidence was incomplete or unsupported',
        )
      }
      await callApi(
        'PUT',
        root,
        {
          ...(waitTimerRule
            ? { wait_timer: waitTimerRule.wait_timer }
            : {}),
          ...(reviewerRule
            ? {
                prevent_self_review: reviewerRule.prevent_self_review,
                reviewers,
              }
            : {}),
          deployment_branch_policy: {
            protected_branches: environment.protection.protectedBranches,
            custom_branch_policies:
              environment.protection.customBranchPolicies,
          },
        },
      )
      const branchPolicyRoot = `${root}/deployment-branch-policies`
      const existing = completeDeploymentBranchPolicies(
        await readApi(`${branchPolicyRoot}?per_page=100`),
      )
      const allowedBranches = new Set(environment.protection.allowedBranches)
      const retainedBranches = new Set()
      for (const branchPolicy of existing) {
        const retain =
          branchPolicy.type === 'branch' &&
          allowedBranches.has(branchPolicy.name) &&
          !retainedBranches.has(branchPolicy.name)
        if (retain) {
          retainedBranches.add(branchPolicy.name)
        } else {
          await callApi('DELETE', `${branchPolicyRoot}/${branchPolicy.id}`)
        }
      }
      for (const name of environment.protection.allowedBranches) {
        if (!retainedBranches.has(name)) {
          await callApi('POST', branchPolicyRoot, { name, type: 'branch' })
        }
      }
    },
    async setSourceReleaseRepositoryVariable(policy) {
      const name = 'EIDO_RELEASE_REPOSITORY'
      await upsertSourceVariable(
        policy,
        name,
        policy.sourceEnvironment.requiredVariables[name],
      )
    },
    async setSourceAppIdVariable(policy) {
      const app = await readApi(`apps/${policy.githubApp.slug}`)
      await upsertSourceVariable(
        policy,
        'EIDO_RELEASE_APP_ID',
        String(app.id),
      )
    },
    async setSourceAppPrivateKey(policy) {
      if (!privateKey) {
        throw new Error(
          'set-source-app-private-key requires --private-key-stdin',
        )
      }
      await runGh(
        [
          'secret',
          'set',
          policy.sourceEnvironment.requiredSecrets[0],
          '--env',
          policy.sourceEnvironment.name,
          '--repo',
          policy.sourceEnvironment.repository,
        ],
        { input: privateKey },
      )
    },
  }

  return {
    async snapshot(policy) {
      let repository
      try {
        repository = await readApi(`repos/${policy.repository.fullName}`)
      } catch (error) {
        if (error.statusCode === 404) return { repository: null }
        throw error
      }

      const target = policy.repository.fullName
      const branch = repository.default_branch
      const actionsRoot = `repos/${target}/actions/permissions`
      const promotionRoot = `repos/${target}/environments/${encodeURIComponent(policy.promotionEnvironment.name)}`
      const sourceRoot = `repos/${policy.sourceEnvironment.repository}/environments/${encodeURIComponent(policy.sourceEnvironment.name)}`
      const [
        tree,
        commit,
        releases,
        tags,
        repositorySecrets,
        immutable,
        actionsPermissions,
        selectedActions,
        workflowPermissions,
        retention,
        rulesets,
        promotionEnvironment,
        promotionSecrets,
        sourceEnvironment,
        sourceBranchPolicies,
        sourceVariables,
        sourceSecrets,
        sourceRepositorySecrets,
        sourceEnvironments,
        app,
        installations,
        vulnerabilityReporting,
      ] = await Promise.all([
        readApi(`repos/${target}/git/trees/${encodeURIComponent(branch)}?recursive=1`),
        readApi(`repos/${target}/commits/${encodeURIComponent(branch)}`),
        readApi(`repos/${target}/releases?per_page=100`),
        readApi(`repos/${target}/tags?per_page=100`),
        readApi(`repos/${target}/actions/secrets?per_page=100`),
        readOptional(`repos/${target}/immutable-releases`),
        readApi(actionsRoot),
        readApi(`${actionsRoot}/selected-actions`),
        readApi(`${actionsRoot}/workflow`),
        readApi(`${actionsRoot}/artifact-and-log-retention`),
        readApi(`repos/${target}/rulesets`),
        readOptional(promotionRoot),
        readOptional(`${promotionRoot}/secrets?per_page=100`),
        readOptional(sourceRoot),
        readOptional(`${sourceRoot}/deployment-branch-policies?per_page=100`),
        readOptional(`${sourceRoot}/variables?per_page=100`),
        readOptional(`${sourceRoot}/secrets?per_page=100`),
        readApi(
          `repos/${policy.sourceEnvironment.repository}/actions/secrets?per_page=100`,
        ),
        readApi(
          `repos/${policy.sourceEnvironment.repository}/environments?per_page=100`,
        ),
        readOptional(`apps/${policy.githubApp.slug}`),
        readOptional('user/installations?per_page=100'),
        readOptional(
          `repos/${target}/private-vulnerability-reporting`,
          [404, 422],
        ),
      ])

      if (tree.truncated !== false) {
        throw new Error('GitHub recursive tree evidence was truncated or incomplete')
      }
      const expectedTemplatePaths = new Set(policy.template.allowedPaths)
      const expectedTemplateDirectories = new Set(
        policy.template.allowedPaths.flatMap((path) => {
          const parts = path.split('/')
          return parts
            .slice(0, -1)
            .map((_, index) => parts.slice(0, index + 1).join('/'))
        }),
      )
      const treeEntries = tree.tree
      const treeEntryIsValid = (entry) => {
        const hasOfficialShape = Boolean(
          entry &&
            typeof entry.path === 'string' &&
            entry.path.length > 0 &&
            typeof entry.mode === 'string' &&
            typeof entry.type === 'string' &&
            /^[0-9a-f]{40}$/i.test(entry.sha ?? ''),
        )
        if (!hasOfficialShape) return false
        if (entry.type === 'tree') {
          return (
            entry.mode === '040000' &&
            expectedTemplateDirectories.has(entry.path)
          )
        }
        if (entry.type !== 'blob') return false
        if (expectedTemplatePaths.has(entry.path)) {
          return entry.mode === '100644'
        }
        return ['100644', '100755', '120000'].includes(entry.mode)
      }
      if (
        !/^[0-9a-f]{40}$/i.test(tree.sha ?? '') ||
        !Array.isArray(treeEntries) ||
        treeEntries.some((entry) => !treeEntryIsValid(entry))
      ) {
        throw new Error(
          'GitHub recursive tree contains a non-template or non-regular entry',
        )
      }

      const repositorySecretNames = completeNamedCollection(
        repositorySecrets,
        'secrets',
        'Public repository secret-name',
      )
      const promotionSecretNames = promotionEnvironment
        ? completeNamedCollection(
            promotionSecrets,
            'secrets',
            'Public promotion environment secret-name',
          )
        : []
      const sourceRepositorySecretNames = completeNamedCollection(
        sourceRepositorySecrets,
        'secrets',
        'Source repository secret-name',
      )
      const sourceEnvironmentNames = completeNamedCollection(
        sourceEnvironments,
        'environments',
        'Source environment-name',
      )
      const sourceEnvironmentSecretNames = Object.fromEntries(
        await Promise.all(
          sourceEnvironmentNames.map(async (environmentName) => {
            const environmentSecrets =
              environmentName === policy.sourceEnvironment.name
                ? sourceSecrets
                : await readApi(
                    `repos/${policy.sourceEnvironment.repository}/environments/${encodeURIComponent(environmentName)}/secrets?per_page=100`,
                  )
            return [
              environmentName,
              completeNamedCollection(
                environmentSecrets,
                'secrets',
                `Source environment ${environmentName} secret-name`,
              ),
            ]
          }),
        ),
      )
      const sourceVariableValues = sourceEnvironment
        ? Object.fromEntries(
            completeCollection(
              sourceVariables,
              'variables',
              'Source environment variable',
              (variable) =>
                typeof variable?.name === 'string' &&
                variable.name.length > 0 &&
                typeof variable?.value === 'string',
              (variable) => variable.name,
            ).map((variable) => [variable.name, variable.value]),
          )
        : {}
      const normalizedSourceBranchPolicies = sourceBranchPolicies
        ? completeDeploymentBranchPolicies(sourceBranchPolicies)
        : null

      const paths = treeEntries
        .filter((entry) => entry.type === 'blob')
        .map((entry) => entry.path)
        .sort()
      const templateFiles = await Promise.all(
        policy.template.allowedPaths.map(async (path) => {
          if (!paths.includes(path)) return [path, null]
          const encodedPath = path
            .split('/')
            .map((part) => encodeURIComponent(part))
            .join('/')
          const file = await readApi(`repos/${target}/contents/${encodedPath}`)
          if (file.encoding !== 'base64') return [path, null]
          const bytes = Buffer.from(file.content.replace(/\s/g, ''), 'base64')
          return [path, createHash('sha256').update(bytes).digest('hex')]
        }),
      )
      const templateSha256 = Object.fromEntries(templateFiles)

      const rulesetSummary = rulesets.find(
        (ruleset) => ruleset.name === policy.mainRuleset.name,
      )
      const ruleset = rulesetSummary
        ? await readApi(`repos/${target}/rulesets/${rulesetSummary.id}`)
        : null
      if (
        ruleset &&
        (!Object.hasOwn(ruleset, 'bypass_actors') ||
          !Array.isArray(ruleset.bypass_actors))
      ) {
        throw new Error(
          'GitHub ruleset bypass-actor evidence was incomplete or unavailable',
        )
      }
      const normalizePullRequestParameters = (parameters) => ({
        requiredApprovingReviewCount:
          parameters.required_approving_review_count,
        dismissStaleReviewsOnPush:
          parameters.dismiss_stale_reviews_on_push,
        requireCodeOwnerReview: parameters.require_code_owner_review,
        requireLastPushApproval: parameters.require_last_push_approval,
        requiredReviewThreadResolution:
          parameters.required_review_thread_resolution,
      })
      const mainRuleset = ruleset
        ? {
            name: ruleset.name,
            target: ruleset.target,
            enforcement: ruleset.enforcement,
            conditions: {
              include: [...(ruleset.conditions?.ref_name?.include ?? [])],
              exclude: [...(ruleset.conditions?.ref_name?.exclude ?? [])],
            },
            bypassActors: ruleset.bypass_actors.map((actor) => ({
              actorId: actor.actor_id,
              actorType: actor.actor_type,
              bypassMode: actor.bypass_mode,
            })),
            rules: (ruleset.rules ?? []).map((rule) => ({
              type: rule.type,
              ...(rule.parameters
                ? {
                    parameters: normalizePullRequestParameters(
                      rule.parameters,
                    ),
                  }
                : {}),
            })),
          }
        : null

      const promotionReviewerRule = promotionEnvironment?.protection_rules?.find(
        (rule) => rule.type === 'required_reviewers',
      )
      const normalizedPromotionEnvironment = promotionEnvironment
        ? {
            name: promotionEnvironment.name,
            preventSelfReview:
              promotionReviewerRule?.prevent_self_review ?? false,
            requiredReviewers: (
              promotionReviewerRule?.reviewers ?? []
            ).map((reviewer) =>
              reviewer.type === 'Team'
                ? reviewer.reviewer.slug
                : reviewer.reviewer.login,
            ),
            protectedBranches:
              promotionEnvironment.deployment_branch_policy
                ?.protected_branches,
            customBranchPolicies:
              promotionEnvironment.deployment_branch_policy
                ?.custom_branch_policies,
            secrets: promotionSecretNames,
          }
        : null

      const normalizedSourceEnvironment = sourceEnvironment
        ? {
            repository: policy.sourceEnvironment.repository,
            name: sourceEnvironment.name,
            protection:
              sourceEnvironment.deployment_branch_policy &&
              normalizedSourceBranchPolicies
                ? {
                    protectedBranches:
                      sourceEnvironment.deployment_branch_policy
                        .protected_branches,
                    customBranchPolicies:
                      sourceEnvironment.deployment_branch_policy
                        .custom_branch_policies,
                    allowedBranches: normalizedSourceBranchPolicies.map(
                      ({ name, type }) => ({ name, type }),
                    ),
                  }
                : null,
            variables: sourceVariableValues,
            secrets:
              sourceEnvironmentSecretNames[policy.sourceEnvironment.name] ?? [],
          }
        : null

      const userInstallations = completeCollection(
        installations,
        'installations',
        'User installation',
        (candidate) =>
          Number.isInteger(candidate?.id) &&
          Number.isInteger(candidate?.app_id) &&
          typeof candidate?.app_slug === 'string' &&
          ['all', 'selected'].includes(candidate?.repository_selection),
        (candidate) => candidate.id,
      )
      const installation = app
        ? userInstallations.find(
            (candidate) => candidate.app_id === app.id,
          )
        : null
      const installedRepositories = installation
        ? await readApi(
            `user/installations/${installation.id}/repositories?per_page=100`,
          )
        : null
      const installedRepositoryNames = installation
        ? completeCollection(
            installedRepositories,
            'repositories',
            'Installed repository',
            (candidate) =>
              typeof candidate?.full_name === 'string' &&
              candidate.full_name.length > 0,
            (candidate) => candidate.full_name,
          )
            .map((candidate) => candidate.full_name)
            .sort()
        : []
      if (
        app &&
        (!Array.isArray(app.events) ||
          app.events.some(
            (event) => typeof event !== 'string' || event.length === 0,
          ) ||
          new Set(app.events).size !== app.events.length)
      ) {
        throw new Error(
          'GitHub App event evidence was incomplete or malformed',
        )
      }
      const normalizedTokenProbe =
        app && installation
          ? await tokenProbe({ policy, app, installation })
          : null
      const githubApp = app
        ? {
            id: app.id,
            slug: app.slug,
            repositorySelection:
              installation?.repository_selection ?? null,
            repositories: installedRepositoryNames,
            permissions: { ...(app.permissions ?? {}) },
            events: [...app.events],
            tokenProbe: normalizedTokenProbe,
          }
        : null

      return {
        repository: {
          fullName: repository.full_name,
          visibility: repository.visibility,
          defaultBranch: repository.default_branch,
          description: repository.description,
          archived: repository.archived,
          features: {
            issues: repository.has_issues,
            projects: repository.has_projects,
            wiki: repository.has_wiki,
            discussions: repository.has_discussions,
          },
          mergePolicy: {
            allowSquashMerge: repository.allow_squash_merge,
            allowMergeCommit: repository.allow_merge_commit,
            allowRebaseMerge: repository.allow_rebase_merge,
            deleteBranchOnMerge: repository.delete_branch_on_merge,
          },
        },
        template: {
          paths,
          sha256: templateSha256,
          commitSha: commit.sha,
        },
        content: {
          releases: releases.map((release) => release.tag_name),
          tags: tags.map((tag) => tag.name),
        },
        repositorySecrets: repositorySecretNames,
        immutableReleases: immutable
          ? {
              enabled: immutable.enabled,
              enforcedByOwner: immutable.enforced_by_owner,
            }
          : { enabled: false, enforcedByOwner: false },
        actions: {
          enabled: actionsPermissions.enabled,
          allowedActions: actionsPermissions.allowed_actions,
          shaPinningRequired: actionsPermissions.sha_pinning_required,
          githubOwnedAllowed: selectedActions.github_owned_allowed,
          verifiedAllowed: selectedActions.verified_allowed,
          patternsAllowed: selectedActions.patterns_allowed ?? [],
          defaultWorkflowPermissions:
            workflowPermissions.default_workflow_permissions,
          canApprovePullRequestReviews:
            workflowPermissions.can_approve_pull_request_reviews,
          retentionDays: retention.days,
        },
        mainRuleset,
        promotionEnvironment: normalizedPromotionEnvironment,
        sourceEnvironment: normalizedSourceEnvironment,
        sourceSecretBoundary: {
          repositorySecrets: sourceRepositorySecretNames,
          environments: sourceEnvironmentSecretNames,
        },
        githubApp,
        privateVulnerabilityReporting: vulnerabilityReporting ?? {
          enabled: false,
        },
      }
    },
    async applyMutation(mutation, { policy }) {
      const apply = mutations[mutation.method]
      if (!apply) {
        throw new Error(`Unsupported release-repository mutation: ${mutation.id}`)
      }
      await apply(policy)
    },
    probeGithubAppToken: tokenProbe,
  }
}

export function planPublicReleaseRepository({
  policy,
  snapshot,
  observedAt,
}) {
  const target = policy.repository.fullName
  if (!snapshot.repository) {
    return {
      schemaVersion: 1,
      verdict: 'READY',
      target,
      mutations: bootstrapMutations(),
      ownerActions: [
        githubAppOwnerAction(policy),
        promotionAdminBypassOwnerAction(policy),
      ],
      violations: [],
    }
  }

  const verification = verifyPublicReleaseRepository({
    policy,
    snapshot,
    observedAt,
  })
  const privateKeyWasValidated =
    snapshot.githubApp?.tokenProbe?.privateKeyValidated === true
  if (verification.verdict === 'PASS') {
    if (privateKeyWasValidated) {
      return {
        schemaVersion: 1,
        verdict: 'READY',
        target,
        mutations: [mutationById('set-source-app-private-key')],
        ownerActions: [],
        violations: [],
      }
    }
    return {
      schemaVersion: 1,
      verdict: 'CONVERGED',
      target,
      mutations: [],
      ownerActions: [],
      violations: [],
    }
  }

  const resumableMutations = new Map([
    ['repository-default-branch-mismatch', 'configure-repository-settings'],
    ['repository-description-mismatch', 'configure-repository-settings'],
    ['repository-features-mismatch', 'configure-repository-settings'],
    ['repository-merge-policy-mismatch', 'configure-repository-settings'],
    [
      'immutable-releases-evidence-missing',
      'enable-immutable-releases',
    ],
    ['immutable-releases-mismatch', 'enable-immutable-releases'],
    ['actions-evidence-missing', 'configure-actions-policy'],
    ['actions-policy-mismatch', 'configure-actions-policy'],
    ['main-ruleset-evidence-missing', 'configure-main-ruleset'],
    ['main-ruleset-mismatch', 'configure-main-ruleset'],
    [
      'promotion-environment-evidence-missing',
      'configure-promotion-environment',
    ],
    ['promotion-environment-mismatch', 'configure-promotion-environment'],
    [
      'private-vulnerability-reporting-evidence-missing',
      'enable-private-vulnerability-reporting',
    ],
    [
      'private-vulnerability-reporting-mismatch',
      'enable-private-vulnerability-reporting',
    ],
    [
      'source-environment-protection-evidence-missing',
      'configure-source-environment',
    ],
    [
      'source-environment-protection-mismatch',
      'configure-source-environment',
    ],
  ])
  const mutationIds = []
  const ownerActions = []
  const unsafeViolations = []
  const addMutation = (id) => {
    if (!mutationIds.includes(id)) mutationIds.push(id)
  }
  const addOwnerAction = (action) => {
    if (!ownerActions.some((candidate) => candidate.id === action.id)) {
      ownerActions.push(action)
    }
  }
  const templateWritesRequirePullRequest = Boolean(
    snapshot.mainRuleset?.enforcement === 'active' &&
      (snapshot.mainRuleset.rules ?? []).some(
        (rule) => rule.type === 'pull_request',
      ),
  )

  for (const requirement of verification.ownerEvidenceRequired ?? []) {
    if (requirement.id === 'promotion-environment-admin-bypass-disabled') {
      addOwnerAction(promotionAdminBypassOwnerAction(policy))
    }
  }

  for (const violation of verification.violations) {
    if (
      [
        'template-evidence-missing',
        'template-paths-mismatch',
        'template-content-mismatch',
      ].includes(violation.code)
    ) {
      const onlyMissingAllowedPaths =
        violation.code !== 'template-paths-mismatch' ||
        violation.actual.every((path) =>
          policy.template.allowedPaths.includes(path),
        )
      if (onlyMissingAllowedPaths && !templateWritesRequirePullRequest) {
        addMutation('write-public-template')
      } else {
        unsafeViolations.push(violation)
      }
      continue
    }

    const mutation = resumableMutations.get(violation.code)
    if (mutation) {
      addMutation(mutation)
      continue
    }

    if (violation.code === 'source-environment-evidence-missing') {
      addMutation('configure-source-environment')
      addMutation('set-source-release-repository-variable')
      if (snapshot.githubApp?.id) {
        addMutation('set-source-app-id-variable')
      }
      if (!privateKeyWasValidated) {
        addOwnerAction({
          id: 'provide-github-app-private-key-via-stdin',
          reason:
            'Credential wiring and token-scope proof require the GitHub App private key on stdin.',
        })
      }
      continue
    }

    if (violation.code === 'source-environment-variables-mismatch') {
      const actual = violation.actual ?? {}
      const allowedNames = Object.keys(
        policy.sourceEnvironment.requiredVariables,
      )
      if (Object.keys(actual).some((name) => !allowedNames.includes(name))) {
        unsafeViolations.push(violation)
        continue
      }
      if (
        actual.EIDO_RELEASE_REPOSITORY !==
        policy.sourceEnvironment.requiredVariables.EIDO_RELEASE_REPOSITORY
      ) {
        addMutation('set-source-release-repository-variable')
      }
      if (
        snapshot.githubApp?.id &&
        actual.EIDO_RELEASE_APP_ID !== String(snapshot.githubApp.id)
      ) {
        addMutation('set-source-app-id-variable')
      }
      continue
    }

    if (violation.code === 'source-environment-secrets-mismatch') {
      const required = policy.sourceEnvironment.requiredSecrets
      if (violation.actual.some((name) => !required.includes(name))) {
        unsafeViolations.push(violation)
      } else if (!privateKeyWasValidated) {
        addOwnerAction({
          id: 'provide-github-app-private-key-via-stdin',
          reason:
            'Credential wiring and token-scope proof require the GitHub App private key on stdin.',
        })
      }
      continue
    }

    if (violation.code === 'github-app-evidence-missing') {
      addOwnerAction(githubAppOwnerAction(policy))
      continue
    }

    if (violation.code === 'github-app-token-probe-missing') {
      addOwnerAction({
        id: 'provide-github-app-private-key-via-stdin',
        reason:
          'Token-scope proof requires the GitHub App private key on stdin; the value is never emitted.',
      })
      continue
    }

    unsafeViolations.push(violation)
  }

  if (privateKeyWasValidated) addMutation('set-source-app-private-key')

  if (unsafeViolations.length > 0) {
    return {
      schemaVersion: 1,
      verdict: 'BLOCK',
      target,
      mutations: [],
      ownerActions,
      violations: verification.violations,
    }
  }

  return {
    schemaVersion: 1,
    verdict: mutationIds.length > 0 ? 'READY' : 'OWNER_ACTION_REQUIRED',
    target,
    mutations: mutationIds.map(mutationById),
    ownerActions,
    violations: verification.violations,
  }
}

export async function applyPublicReleaseRepository({
  policy,
  snapshot,
  client,
  confirmRepository,
  observedAt,
}) {
  const target = policy.repository.fullName
  if (confirmRepository !== target) {
    return {
      schemaVersion: 1,
      verdict: 'BLOCK',
      target,
      applied: [],
      reason: 'repository-confirmation-mismatch',
    }
  }

  const plan = planPublicReleaseRepository({ policy, snapshot, observedAt })
  if (plan.verdict === 'CONVERGED') {
    return { ...plan, applied: [] }
  }
  if (plan.verdict === 'BLOCK') {
    return { ...plan, applied: [] }
  }

  const applied = []
  for (const mutation of plan.mutations) {
    await client.applyMutation(mutation, { policy })
    applied.push(mutation.id)
  }

  return {
    schemaVersion: 1,
    verdict:
      plan.ownerActions.length > 0 ? 'OWNER_ACTION_REQUIRED' : 'APPLIED',
    target,
    applied,
    ownerActions: plan.ownerActions,
  }
}

export function verifyPublicReleaseRepository({
  policy,
  snapshot,
  observedAt = new Date().toISOString(),
}) {
  if (!snapshot.repository) {
    return {
      schemaVersion: 1,
      verdict: 'BLOCK',
      violations: [
        {
          code: 'repository-missing',
          path: 'repository',
          expected: policy.repository.fullName,
          actual: null,
        },
      ],
    }
  }

  const violations = []
  const addMismatch = (code, path, expected, actual) => {
    if (!isDeepStrictEqual(actual, expected)) {
      violations.push({ code, path, expected, actual })
    }
  }

  if (snapshot.repository.visibility !== policy.repository.visibility) {
    violations.push({
      code: 'repository-visibility-mismatch',
      path: 'repository.visibility',
      expected: policy.repository.visibility,
      actual: snapshot.repository.visibility,
    })
  }

  if (policy.repository.fullName) {
    addMismatch(
      'repository-full-name-mismatch',
      'repository.fullName',
      policy.repository.fullName,
      snapshot.repository.fullName,
    )
  }
  if (policy.repository.defaultBranch) {
    addMismatch(
      'repository-default-branch-mismatch',
      'repository.defaultBranch',
      policy.repository.defaultBranch,
      snapshot.repository.defaultBranch,
    )
  }
  if (policy.repository.description) {
    addMismatch(
      'repository-description-mismatch',
      'repository.description',
      policy.repository.description,
      snapshot.repository.description,
    )
  }
  if (typeof policy.repository.archived === 'boolean') {
    addMismatch(
      'repository-archived-mismatch',
      'repository.archived',
      policy.repository.archived,
      snapshot.repository.archived,
    )
  }
  if (policy.repository.features) {
    addMismatch(
      'repository-features-mismatch',
      'repository.features',
      policy.repository.features,
      snapshot.repository.features,
    )
  }
  if (policy.repository.mergePolicy) {
    addMismatch(
      'repository-merge-policy-mismatch',
      'repository.mergePolicy',
      policy.repository.mergePolicy,
      snapshot.repository.mergePolicy,
    )
  }

  if (policy.template && !snapshot.template) {
    violations.push({
      code: 'template-evidence-missing',
      path: 'template',
      expected: { paths: policy.template.allowedPaths },
      actual: null,
    })
  } else if (policy.template) {
    const expectedPaths = [...policy.template.allowedPaths].sort()
    const actualPaths = [...(snapshot.template.paths ?? [])].sort()
    addMismatch(
      'template-paths-mismatch',
      'template.paths',
      expectedPaths,
      actualPaths,
    )
    addMismatch(
      'template-content-mismatch',
      'template.sha256',
      policy.template.sha256,
      snapshot.template.sha256 ?? null,
    )
    if (!/^[0-9a-f]{40}$/i.test(snapshot.template.commitSha ?? '')) {
      violations.push({
        code: 'template-commit-missing',
        path: 'template.commitSha',
        expected: '40-character Git commit SHA',
        actual: snapshot.template.commitSha ?? null,
      })
    }

    const forbiddenPaths = actualPaths.filter((path) => {
      const lowerPath = path.toLowerCase()
      return (
        policy.content?.forbiddenExtensions?.some((extension) =>
          lowerPath.endsWith(extension.toLowerCase()),
        ) ||
        policy.content?.forbiddenPathPatterns?.some((pattern) =>
          lowerPath.includes(pattern.toLowerCase()),
        )
      )
    })
    if (forbiddenPaths.length > 0) {
      violations.push({
        code: 'forbidden-content-detected',
        path: 'template.paths',
        expected: [],
        actual: forbiddenPaths,
      })
    }
  }

  if (policy.content?.requireNoReleases) {
    if (!Array.isArray(snapshot.content?.releases)) {
      violations.push({
        code: 'release-evidence-missing',
        path: 'content.releases',
        expected: [],
        actual: null,
      })
    } else if (snapshot.content.releases.length > 0) {
      violations.push({
        code: 'release-present',
        path: 'content.releases',
        expected: [],
        actual: [...snapshot.content.releases],
      })
    }
  }
  if (policy.content?.requireNoTags) {
    if (!Array.isArray(snapshot.content?.tags)) {
      violations.push({
        code: 'tag-evidence-missing',
        path: 'content.tags',
        expected: [],
        actual: null,
      })
    } else if (snapshot.content.tags.length > 0) {
      violations.push({
        code: 'tag-present',
        path: 'content.tags',
        expected: [],
        actual: [...snapshot.content.tags],
      })
    }
  }

  if (policy.immutableReleases && !snapshot.immutableReleases) {
    violations.push({
      code: 'immutable-releases-evidence-missing',
      path: 'immutableReleases',
      expected: policy.immutableReleases,
      actual: null,
    })
  } else if (policy.immutableReleases) {
    addMismatch(
      'immutable-releases-mismatch',
      'immutableReleases.enabled',
      policy.immutableReleases.enabled,
      snapshot.immutableReleases.enabled,
    )
  }

  if (policy.actions && !snapshot.actions) {
    violations.push({
      code: 'actions-evidence-missing',
      path: 'actions',
      expected: policy.actions,
      actual: null,
    })
  } else if (policy.actions) {
    addMismatch(
      'actions-policy-mismatch',
      'actions',
      policy.actions,
      snapshot.actions,
    )
  }

  if (policy.mainRuleset && !snapshot.mainRuleset) {
    violations.push({
      code: 'main-ruleset-evidence-missing',
      path: 'mainRuleset',
      expected: policy.mainRuleset,
      actual: null,
    })
  } else if (policy.mainRuleset) {
    const normalizeRuleset = (ruleset) => ({
      ...ruleset,
      conditions: {
        ...ruleset.conditions,
        include: [...(ruleset.conditions?.include ?? [])].sort(),
        exclude: [...(ruleset.conditions?.exclude ?? [])].sort(),
      },
      bypassActors: [...(ruleset.bypassActors ?? [])].sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
      rules: [...(ruleset.rules ?? [])].sort((left, right) =>
        left.type.localeCompare(right.type),
      ),
    })
    addMismatch(
      'main-ruleset-mismatch',
      'mainRuleset',
      normalizeRuleset(policy.mainRuleset),
      normalizeRuleset(snapshot.mainRuleset),
    )
  }

  if (policy.promotionEnvironment && !snapshot.promotionEnvironment) {
    violations.push({
      code: 'promotion-environment-evidence-missing',
      path: 'promotionEnvironment',
      expected: policy.promotionEnvironment,
      actual: null,
    })
  } else if (policy.promotionEnvironment) {
    const expected = {
      name: policy.promotionEnvironment.name,
      preventSelfReview: policy.promotionEnvironment.preventSelfReview,
      requiredReviewers: [
        ...policy.promotionEnvironment.requiredReviewers,
      ].sort(),
      protectedBranches: policy.promotionEnvironment.protectedBranches,
      customBranchPolicies:
        policy.promotionEnvironment.customBranchPolicies,
    }
    const actual = {
      name: snapshot.promotionEnvironment.name,
      preventSelfReview: snapshot.promotionEnvironment.preventSelfReview,
      requiredReviewers: [
        ...(snapshot.promotionEnvironment.requiredReviewers ?? []),
      ].sort(),
      protectedBranches: snapshot.promotionEnvironment.protectedBranches,
      customBranchPolicies:
        snapshot.promotionEnvironment.customBranchPolicies,
    }
    addMismatch(
      'promotion-environment-mismatch',
      'promotionEnvironment',
      expected,
      actual,
    )
  }

  const requiresSecretBoundaryEvidence = Boolean(
    policy.sourceEnvironment ||
      policy.promotionEnvironment ||
      policy.githubApp,
  )
  if (
    requiresSecretBoundaryEvidence &&
    !Array.isArray(snapshot.repositorySecrets)
  ) {
    violations.push({
      code: 'public-repository-secrets-evidence-missing',
      path: 'repositorySecrets',
      expected: [],
      actual: null,
    })
  } else if (
    requiresSecretBoundaryEvidence &&
    snapshot.repositorySecrets.length > 0
  ) {
    violations.push({
      code: 'public-repository-secret-detected',
      path: 'repositorySecrets',
      expected: [],
      actual: [...snapshot.repositorySecrets].sort(),
    })
  }
  if (snapshot.promotionEnvironment) {
    if (!Array.isArray(snapshot.promotionEnvironment.secrets)) {
      violations.push({
        code: 'public-promotion-secrets-evidence-missing',
        path: 'promotionEnvironment.secrets',
        expected: policy.promotionEnvironment?.requiredSecrets ?? [],
        actual: null,
      })
    } else if (snapshot.promotionEnvironment.secrets.length > 0) {
      violations.push({
        code: 'public-promotion-secret-detected',
        path: 'promotionEnvironment.secrets',
        expected: policy.promotionEnvironment?.requiredSecrets ?? [],
        actual: [...snapshot.promotionEnvironment.secrets].sort(),
      })
    }
  }

  if (policy.sourceEnvironment && !snapshot.sourceEnvironment) {
    violations.push({
      code: 'source-environment-evidence-missing',
      path: 'sourceEnvironment',
      expected: {
        repository: policy.sourceEnvironment.repository,
        name: policy.sourceEnvironment.name,
      },
      actual: null,
    })
  } else if (policy.sourceEnvironment) {
    addMismatch(
      'source-environment-identity-mismatch',
      'sourceEnvironment',
      {
        repository: policy.sourceEnvironment.repository,
        name: policy.sourceEnvironment.name,
      },
      {
        repository: snapshot.sourceEnvironment.repository,
        name: snapshot.sourceEnvironment.name,
      },
    )
    if (!snapshot.sourceEnvironment.protection) {
      violations.push({
        code: 'source-environment-protection-evidence-missing',
        path: 'sourceEnvironment.protection',
        expected: policy.sourceEnvironment.protection,
        actual: null,
      })
    } else {
      const expectedAllowedBranches =
        policy.sourceEnvironment.protection.allowedBranches
          .map((name) => ({ name, type: 'branch' }))
          .sort(
            (left, right) =>
              left.name.localeCompare(right.name) ||
              left.type.localeCompare(right.type),
          )
      const actualAllowedBranches = [
        ...(snapshot.sourceEnvironment.protection.allowedBranches ?? []),
      ].sort(
        (left, right) =>
          String(left?.name).localeCompare(String(right?.name)) ||
          String(left?.type).localeCompare(String(right?.type)),
      )
      addMismatch(
        'source-environment-protection-mismatch',
        'sourceEnvironment.protection',
        {
          ...policy.sourceEnvironment.protection,
          allowedBranches: expectedAllowedBranches,
        },
        {
          ...snapshot.sourceEnvironment.protection,
          allowedBranches: actualAllowedBranches,
        },
      )
    }
    const expectedVariables = policy.sourceEnvironment.requiredVariables
    const actualVariables = snapshot.sourceEnvironment.variables ?? {}
    const variablesMatch = Object.entries(expectedVariables).every(
      ([name, expected]) =>
        expected === null
          ? snapshot.githubApp?.id
            ? actualVariables[name] === String(snapshot.githubApp.id)
            : typeof actualVariables[name] === 'string' &&
              actualVariables[name].length > 0
          : actualVariables[name] === expected,
    )
    if (
      !variablesMatch ||
      Object.keys(actualVariables).length !== Object.keys(expectedVariables).length
    ) {
      violations.push({
        code: 'source-environment-variables-mismatch',
        path: 'sourceEnvironment.variables',
        expected: expectedVariables,
        actual: actualVariables,
      })
    }
    addMismatch(
      'source-environment-secrets-mismatch',
      'sourceEnvironment.secrets',
      [...policy.sourceEnvironment.requiredSecrets].sort(),
      [...(snapshot.sourceEnvironment.secrets ?? [])].sort(),
    )
  }

  if (policy.sourceEnvironment) {
    const boundary = snapshot.sourceSecretBoundary
    const environments = boundary?.environments
    const environmentEntries =
      environments &&
      typeof environments === 'object' &&
      !Array.isArray(environments)
        ? Object.entries(environments)
        : []
    const isCompleteSecretNameList = (names) =>
      Array.isArray(names) &&
      names.every(
        (name) => typeof name === 'string' && name.length > 0,
      ) &&
      new Set(names).size === names.length
    const boundaryEvidenceIsComplete = Boolean(
      boundary &&
        environments &&
        typeof environments === 'object' &&
        !Array.isArray(environments) &&
        isCompleteSecretNameList(boundary.repositorySecrets) &&
        environmentEntries.every(
          ([environment, names]) =>
            environment.length > 0 && isCompleteSecretNameList(names),
        ) &&
        (!snapshot.sourceEnvironment ||
          Object.hasOwn(environments, policy.sourceEnvironment.name)),
    )
    if (!boundaryEvidenceIsComplete) {
      violations.push({
        code: 'source-secret-exclusivity-evidence-missing',
        path: 'sourceSecretBoundary',
        expected: {
          repositorySecrets: 'secret-name list',
          environment: policy.sourceEnvironment.name,
        },
        actual: null,
      })
    } else {
      const requiredSecretNames = new Set(
        policy.sourceEnvironment.requiredSecrets,
      )
      const misplacedSecrets = [
        ...boundary.repositorySecrets
          .filter((name) => requiredSecretNames.has(name))
          .map((name) => ({
            scope: 'repository',
            repository: policy.sourceEnvironment.repository,
            secret: name,
          })),
        ...environmentEntries.flatMap(([environment, names]) =>
          environment === policy.sourceEnvironment.name
            ? []
            : names
                .filter((name) => requiredSecretNames.has(name))
                .map((name) => ({
                  scope: 'environment',
                  environment,
                  secret: name,
                })),
        ),
      ]
      if (misplacedSecrets.length > 0) {
        violations.push({
          code: 'source-secret-outside-protected-environment',
          path: 'sourceSecretBoundary',
          expected: {
            environment: policy.sourceEnvironment.name,
            secrets: [...requiredSecretNames].sort(),
          },
          actual: misplacedSecrets,
        })
      }
    }
  }

  if (policy.githubApp && !snapshot.githubApp) {
    violations.push({
      code: 'github-app-evidence-missing',
      path: 'githubApp',
      expected: {
        slug: policy.githubApp.slug,
        repositories: policy.githubApp.repositories,
        permissions: policy.githubApp.permissions,
      },
      actual: null,
    })
  } else if (policy.githubApp) {
    addMismatch(
      'github-app-identity-mismatch',
      'githubApp.slug',
      policy.githubApp.slug,
      snapshot.githubApp.slug,
    )
    addMismatch(
      'github-app-repository-selection-mismatch',
      'githubApp.repositorySelection',
      policy.githubApp.repositorySelection,
      snapshot.githubApp.repositorySelection,
    )
    addMismatch(
      'github-app-repositories-mismatch',
      'githubApp.repositories',
      [...policy.githubApp.repositories].sort(),
      [...(snapshot.githubApp.repositories ?? [])].sort(),
    )
    addMismatch(
      'github-app-permissions-mismatch',
      'githubApp.permissions',
      policy.githubApp.permissions,
      snapshot.githubApp.permissions ?? {},
    )
    addMismatch(
      'github-app-events-mismatch',
      'githubApp.events',
      [...policy.githubApp.events].sort(),
      [...(snapshot.githubApp.events ?? [])].sort(),
    )
    if (!snapshot.githubApp.tokenProbe) {
      violations.push({
        code: 'github-app-token-probe-missing',
        path: 'githubApp.tokenProbe',
        expected: 'redacted installation-token scope probe',
        actual: null,
      })
    } else {
      addMismatch(
        'github-app-token-probe-repository-mismatch',
        'githubApp.tokenProbe.repository',
        policy.repository.fullName,
        snapshot.githubApp.tokenProbe.repository,
      )
      const expectedTokenPermissions = Object.fromEntries(
        Object.entries(policy.githubApp.permissions)
          .filter(([name]) => name !== 'metadata')
          .map(([name, level]) => [
            name,
            level === 'write' ? 'read' : level,
          ]),
      )
      const actualTokenPermissions = {
        ...(snapshot.githubApp.tokenProbe.permissions ?? {}),
      }
      if (actualTokenPermissions.metadata === 'read') {
        delete actualTokenPermissions.metadata
      }
      addMismatch(
        'github-app-token-probe-permissions-mismatch',
        'githubApp.tokenProbe.permissions',
        expectedTokenPermissions,
        actualTokenPermissions,
      )
      if (snapshot.githubApp.tokenProbe.sourceRepositoryWriteDenied !== true) {
        violations.push({
          code: 'github-app-token-probe-source-write-authority',
          path: 'githubApp.tokenProbe.sourceRepositoryWriteDenied',
          expected: true,
          actual:
            snapshot.githubApp.tokenProbe.sourceRepositoryWriteDenied ?? null,
        })
      }
    }
  }

  if (
    policy.privateVulnerabilityReporting &&
    !snapshot.privateVulnerabilityReporting
  ) {
    violations.push({
      code: 'private-vulnerability-reporting-evidence-missing',
      path: 'privateVulnerabilityReporting',
      expected: policy.privateVulnerabilityReporting,
      actual: null,
    })
  } else if (policy.privateVulnerabilityReporting) {
    addMismatch(
      'private-vulnerability-reporting-mismatch',
      'privateVulnerabilityReporting.enabled',
      policy.privateVulnerabilityReporting.enabled,
      snapshot.privateVulnerabilityReporting.enabled,
    )
  }

  const unexpectedPaths = policy.template
    ? (snapshot.template?.paths ?? []).filter(
        (path) => !policy.template.allowedPaths.includes(path),
      )
    : []
  const ownerEvidenceRequired = []
  const adminBypassRequirement =
    policy.ownerEvidence?.promotionEnvironmentAdminBypassDisabled
  if (adminBypassRequirement?.required) {
    const ownerEvidence = snapshot.ownerEvidence
    const providerEvidence = ownerEvidence?.evidence
    const verifierObservedAt = parseCanonicalUtcTimestamp(observedAt)
    const evidenceObservedAt = parseCanonicalUtcTimestamp(
      ownerEvidence?.observedAt,
    )
    const evidenceAge = verifierObservedAt - evidenceObservedAt
    const ownerEvidenceIsFresh = Boolean(
      Number.isFinite(verifierObservedAt) &&
        Number.isFinite(evidenceObservedAt) &&
        evidenceAge <= adminBypassRequirement.maxAgeHours * 60 * 60 * 1000 &&
        evidenceAge >=
          -adminBypassRequirement.maxFutureSkewMinutes * 60 * 1000,
    )
    const captureUrl = providerEvidence?.captureUrl
    const captureId =
      typeof captureUrl === 'string' &&
      captureUrl.startsWith(adminBypassRequirement.captureUrlPrefix)
        ? captureUrl.slice(adminBypassRequirement.captureUrlPrefix.length)
        : ''
    const ownerEvidenceHasExactShape = Boolean(
      ownerEvidence &&
        typeof ownerEvidence === 'object' &&
        !Array.isArray(ownerEvidence) &&
        isDeepStrictEqual(Object.keys(ownerEvidence).sort(), [
          'controls',
          'evidence',
          'observedAt',
          'observer',
          'schemaVersion',
          'target',
        ]) &&
        providerEvidence &&
        typeof providerEvidence === 'object' &&
        !Array.isArray(providerEvidence) &&
        isDeepStrictEqual(Object.keys(providerEvidence).sort(), [
          'captureUrl',
          'control',
          'kind',
          'settingsUrl',
        ]) &&
        ownerEvidence.controls &&
        typeof ownerEvidence.controls === 'object' &&
        !Array.isArray(ownerEvidence.controls) &&
        isDeepStrictEqual(Object.keys(ownerEvidence.controls), [
          adminBypassRequirement.control,
        ]),
    )
    const ownerEvidenceIsComplete = Boolean(
      ownerEvidenceHasExactShape &&
      ownerEvidence?.schemaVersion === 1 &&
        ownerEvidence.target === policy.repository.fullName &&
        ownerEvidence.observer === adminBypassRequirement.observer &&
        ownerEvidenceIsFresh &&
        providerEvidence.kind === adminBypassRequirement.evidenceKind &&
        providerEvidence.control === adminBypassRequirement.control &&
        providerEvidence.settingsUrl === adminBypassRequirement.settingsUrl &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          captureId,
        ) &&
        ownerEvidence.controls[adminBypassRequirement.control] === true,
    )
    if (!ownerEvidenceIsComplete) {
      ownerEvidenceRequired.push({
        id: 'promotion-environment-admin-bypass-disabled',
        settingsUrl: adminBypassRequirement.settingsUrl,
        requiredObserver: adminBypassRequirement.observer,
        requiredFields: [
          'observedAt',
          'observer',
          'evidence.kind',
          'evidence.control',
          'evidence.settingsUrl',
          'evidence.captureUrl',
          'controls.promotionEnvironmentAdminBypassDisabled',
        ],
        maxAgeHours: adminBypassRequirement.maxAgeHours,
        maxFutureSkewMinutes: adminBypassRequirement.maxFutureSkewMinutes,
      })
    }
  }

  return {
    schemaVersion: 1,
    observedAt,
    verdict:
      violations.length > 0
        ? 'BLOCK'
        : ownerEvidenceRequired.length > 0
          ? 'OWNER_EVIDENCE_REQUIRED'
          : 'PASS',
    violations,
    ownerEvidenceRequired,
    evidence: {
      repository: {
        fullName: snapshot.repository.fullName,
        visibility: snapshot.repository.visibility,
        defaultBranch: snapshot.repository.defaultBranch,
        archived: snapshot.repository.archived,
      },
      template: {
        paths: [...(snapshot.template?.paths ?? [])],
        sha256: { ...(snapshot.template?.sha256 ?? {}) },
        commitSha: snapshot.template?.commitSha ?? null,
      },
      absence: {
        releases: snapshot.content?.releases?.length ?? null,
        tags: snapshot.content?.tags?.length ?? null,
        unexpectedPaths,
      },
      immutableReleases: snapshot.immutableReleases
        ? { ...snapshot.immutableReleases }
        : null,
      actions: snapshot.actions ? { ...snapshot.actions } : null,
      mainRuleset: snapshot.mainRuleset
        ? structuredClone(snapshot.mainRuleset)
        : null,
      promotionEnvironment: snapshot.promotionEnvironment
        ? {
            name: snapshot.promotionEnvironment.name,
            requiredReviewers: [
              ...(snapshot.promotionEnvironment.requiredReviewers ?? []),
            ],
            protectedBranches:
              snapshot.promotionEnvironment.protectedBranches,
          }
        : null,
      ownerEvidence: snapshot.ownerEvidence
        ? {
            schemaVersion: snapshot.ownerEvidence.schemaVersion,
            target: snapshot.ownerEvidence.target,
            observedAt: snapshot.ownerEvidence.observedAt,
            observer: snapshot.ownerEvidence.observer,
            evidence: snapshot.ownerEvidence.evidence
              ? {
                  kind: snapshot.ownerEvidence.evidence.kind,
                  control: snapshot.ownerEvidence.evidence.control,
                  settingsUrl: snapshot.ownerEvidence.evidence.settingsUrl,
                  captureUrl: snapshot.ownerEvidence.evidence.captureUrl,
                }
              : null,
            controls: {
              promotionEnvironmentAdminBypassDisabled:
                snapshot.ownerEvidence.controls
                  ?.promotionEnvironmentAdminBypassDisabled,
            },
          }
        : null,
      sourceEnvironment: snapshot.sourceEnvironment
        ? {
            repository: snapshot.sourceEnvironment.repository,
            name: snapshot.sourceEnvironment.name,
            protection: snapshot.sourceEnvironment.protection
              ? structuredClone(snapshot.sourceEnvironment.protection)
              : null,
          }
        : null,
      sourceSecretBoundary: snapshot.sourceSecretBoundary
        ? {
            repositorySecrets: [
              ...(snapshot.sourceSecretBoundary.repositorySecrets ?? []),
            ].sort(),
            environments: Object.fromEntries(
              Object.entries(
                snapshot.sourceSecretBoundary.environments ?? {},
              )
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([environment, names]) => [
                  environment,
                  [...names].sort(),
                ]),
            ),
          }
        : null,
      githubApp: snapshot.githubApp
        ? {
            id: snapshot.githubApp.id,
            slug: snapshot.githubApp.slug,
            repositorySelection: snapshot.githubApp.repositorySelection,
            repositories: [...(snapshot.githubApp.repositories ?? [])],
            permissions: { ...(snapshot.githubApp.permissions ?? {}) },
            events: [...(snapshot.githubApp.events ?? [])],
            tokenProbe: snapshot.githubApp.tokenProbe
              ? {
                  repository: snapshot.githubApp.tokenProbe.repository,
                  permissions: {
                    ...(snapshot.githubApp.tokenProbe.permissions ?? {}),
                  },
                  sourceRepositoryWriteDenied:
                    snapshot.githubApp.tokenProbe.sourceRepositoryWriteDenied,
                  expiresAt: snapshot.githubApp.tokenProbe.expiresAt,
                  privateKeyValidated:
                    snapshot.githubApp.tokenProbe.privateKeyValidated === true,
                }
              : null,
          }
        : null,
      credentials: {
        publicRepositorySecrets: [...(snapshot.repositorySecrets ?? [])],
        publicPromotionSecrets: [
          ...(snapshot.promotionEnvironment?.secrets ?? []),
        ],
        sourceEnvironmentSecrets: [
          ...(snapshot.sourceEnvironment?.secrets ?? []),
        ],
        secretValueRead: false,
      },
      privateVulnerabilityReporting: snapshot.privateVulnerabilityReporting
        ? { ...snapshot.privateVulnerabilityReporting }
        : null,
    },
  }
}

function runGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      `gh exited ${result.status}`
    const error = new Error(detail)
    const status = detail.match(/\bHTTP\s+(\d{3})\b/i)
    if (status) error.statusCode = Number(status[1])
    error.exitCode = result.status
    throw error
  }
  return result.stdout.trim()
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function cliUsage() {
  return [
    'Usage:',
    '  node scripts/release/public-release-repository.mjs plan [--json] [--owner-evidence <path>] [--private-key-stdin]',
    '  node scripts/release/public-release-repository.mjs verify --json [--owner-evidence <path>] [--private-key-stdin]',
    '  node scripts/release/public-release-repository.mjs apply --confirm limweili/eido-releases [--json] [--owner-evidence <path>] [--private-key-stdin]',
  ].join('\n')
}

function redactDiagnostic(value) {
  return String(value)
    .replace(
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
      '[REDACTED]',
    )
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[REDACTED]',
    )
}

export async function runPublicReleaseRepositoryCli({
  argv = process.argv.slice(2),
  stdout = console.log,
  stderr = console.error,
  clientFactory = (options) =>
    createGhPublicReleaseRepositoryClient(options),
  now = () => new Date(),
  readPrivateKey = readStdin,
  readOwnerEvidence = async (path) =>
    JSON.parse(await readFile(path, 'utf8')),
} = {}) {
  const [command] = argv
  if (!['plan', 'apply', 'verify'].includes(command)) {
    stderr(cliUsage())
    return 2
  }

  const json = argv.includes('--json')
  const ownerEvidenceIndex = argv.indexOf('--owner-evidence')
  const ownerEvidencePath =
    ownerEvidenceIndex === -1 ? undefined : argv[ownerEvidenceIndex + 1]
  if (
    ownerEvidenceIndex !== -1 &&
    (!ownerEvidencePath || ownerEvidencePath.startsWith('--'))
  ) {
    const result = {
      schemaVersion: 1,
      verdict: 'BLOCK',
      reason: 'owner-evidence-path-missing',
    }
    if (json) stdout(JSON.stringify(result, null, 2))
    else stderr('BLOCK: --owner-evidence requires a JSON file path.')
    return 2
  }

  const privateKey = argv.includes('--private-key-stdin')
    ? await readPrivateKey()
    : undefined
  if (argv.includes('--private-key-stdin') && !privateKey) {
    const result = {
      schemaVersion: 1,
      verdict: 'BLOCK',
      reason: 'private-key-stdin-empty',
    }
    if (json) stdout(JSON.stringify(result, null, 2))
    else stderr('BLOCK: --private-key-stdin was set but stdin was empty.')
    return 2
  }

  try {
    const policy = await loadPublicReleasePolicy()
    const client = clientFactory({ runGh, privateKey, now })
    const machineSnapshot = await client.snapshot(policy)
    const observedAt = now().toISOString()
    const snapshot = ownerEvidencePath
      ? {
          ...machineSnapshot,
          ownerEvidence: await readOwnerEvidence(ownerEvidencePath),
        }
      : machineSnapshot
    let result
    let exitCode

    if (command === 'verify') {
      result = verifyPublicReleaseRepository({ policy, snapshot, observedAt })
      exitCode =
        result.verdict === 'PASS'
          ? 0
          : result.verdict === 'OWNER_EVIDENCE_REQUIRED'
            ? 3
            : 1
    } else if (command === 'plan') {
      result = planPublicReleaseRepository({ policy, snapshot, observedAt })
      exitCode = result.verdict === 'BLOCK' ? 2 : 0
    } else {
      const confirmIndex = argv.indexOf('--confirm')
      const confirmRepository =
        confirmIndex === -1 ? undefined : argv[confirmIndex + 1]
      result = await applyPublicReleaseRepository({
        policy,
        snapshot,
        client,
        confirmRepository,
        observedAt,
      })
      exitCode =
        result.verdict === 'BLOCK'
          ? 2
          : result.verdict === 'OWNER_ACTION_REQUIRED'
            ? 3
            : 0
    }

    if (json) {
      stdout(JSON.stringify(result, null, 2))
    } else {
      stdout(`${result.verdict}: ${result.target ?? policy.repository.fullName}`)
      for (const violation of result.violations ?? []) {
        stdout(`- ${violation.code}: ${violation.path}`)
      }
      for (const action of result.ownerActions ?? []) {
        stdout(`- owner action: ${action.id}`)
      }
    }
    return exitCode
  } catch (error) {
    const message = redactDiagnostic(error.message)
    const result = {
      schemaVersion: 1,
      verdict: 'BLOCK',
      reason: 'provider-error',
      message,
    }
    if (json) stdout(JSON.stringify(result, null, 2))
    else stderr(`BLOCK: ${message}`)
    return 2
  }
}

const isCli =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  process.exitCode = await runPublicReleaseRepositoryCli()
}
