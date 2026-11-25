import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  classifyCertificationDependency,
  validateReleasePlanningManifest,
} from './release-planning.mjs'

export const RELEASE_PROMOTION_SCHEMA_VERSION = 1

const repositoryRoot = resolve(import.meta.dirname, '..', '..')
const defaultManifestPath = resolve(
  repositoryRoot,
  'release',
  'planning',
  'manifest.json',
)
const defaultPolicyPath = resolve(
  repositoryRoot,
  'release',
  'public-repository',
  'policy.json',
)

function cliUsage() {
  return [
    'Usage:',
    '  node scripts/release/promote-release.mjs promote --repository <owner/name> --confirm <owner/name> --version <semver> [--manifest <path>] [--policy <path>] [--proof] [--json]',
    '  node scripts/release/promote-release.mjs abort --repository <owner/name> --version <semver> [--manifest <path>] [--policy <path>] [--proof] [--json]',
    '  node scripts/release/promote-release.mjs verify --repository <owner/name> --version <semver> [--manifest <path>] [--policy <path>] [--proof] [--json]',
    '',
    'Disposable fallback: add --local-bare <absolute-path> to use a local bare Git repository.',
  ].join('\n')
}

function parseCliFlags(arguments_) {
  const valueFlags = new Set([
    '--confirm',
    '--manifest',
    '--local-bare',
    '--policy',
    '--repository',
    '--version',
  ])
  const booleanFlags = new Set(['--json', '--proof'])
  const flags = {}

  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index]
    if (booleanFlags.has(flag)) {
      if (Object.hasOwn(flags, flag)) return undefined
      flags[flag] = true
      continue
    }
    if (!valueFlags.has(flag) || Object.hasOwn(flags, flag)) return undefined
    const value = arguments_[index + 1]
    if (!value || value.startsWith('--')) return undefined
    flags[flag] = value
    index += 1
  }
  return flags
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function runGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = result.stderr.trim()
      || result.stdout.trim()
      || `gh exited ${result.status}`
    const error = new Error(detail)
    error.exitCode = result.status
    throw error
  }
  return result.stdout.trim()
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function runGit(bareRepositoryPath, args, options = {}) {
  const result = spawnSync(
    'git',
    ['--git-dir', bareRepositoryPath, ...args],
    {
      encoding: options.binary ? undefined : 'utf8',
      input: options.input,
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : result.stderr
    const stdout = Buffer.isBuffer(result.stdout)
      ? result.stdout.toString('utf8')
      : result.stdout
    throw new Error(stderr.trim() || stdout.trim() || `git exited ${result.status}`)
  }
  return options.binary ? result.stdout : result.stdout.trim()
}

function candidateMarker(releaseTarget) {
  return `<!-- eido-release-candidate ${JSON.stringify({
    schemaVersion: RELEASE_PROMOTION_SCHEMA_VERSION,
    version: releaseTarget.version,
    sourceSha: releaseTarget.sourceSha,
  })} -->`
}

function correspondingSourceLinks(releaseTarget) {
  const source = `https://github.com/limweili/eido`
  return {
    commit: `${source}/tree/${releaseTarget.sourceSha}`,
    archive: `${source}/archive/${releaseTarget.sourceSha}.tar.gz`,
    license: `${source}/blob/${releaseTarget.sourceSha}/LICENSE`,
  }
}

export function createReleaseCandidateBody(releaseTarget, notes = '') {
  const source = correspondingSourceLinks(releaseTarget)
  return [
    candidateMarker(releaseTarget),
    notes.trim(),
    `Eido is free software under [GNU GPL version 3 only](${source.license}).`,
    `Corresponding source: [commit ${releaseTarget.sourceSha}](${source.commit}) and [source archive](${source.archive}).`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function normalizeRelease(release) {
  if (
    !Number.isInteger(release?.id)
    || typeof release.tag_name !== 'string'
    || typeof release.draft !== 'boolean'
    || typeof release.prerelease !== 'boolean'
    || !Array.isArray(release.assets)
  ) throw new Error('GitHub release evidence was incomplete or malformed.')

  return {
    id: release.id,
    tagName: release.tag_name,
    name: release.name ?? '',
    draft: release.draft,
    prerelease: release.prerelease,
    body: release.body ?? '',
    htmlUrl: release.html_url ?? null,
    assets: release.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      digest: asset.digest ?? null,
      size: asset.size,
    })),
  }
}

export function createGhPromotionClient({
  run = runGh,
} = {}) {
  function callApi(method, path, body, extraArguments = []) {
    const arguments_ = [
      'api',
      '--method',
      method,
      path,
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'X-GitHub-Api-Version: 2026-03-10',
      ...extraArguments,
    ]
    if (body !== undefined) {
      arguments_.push('--input', '-')
    }
    const output = run(arguments_, {
      ...(body === undefined ? {} : { input: JSON.stringify(body) }),
    })
    return output === '' ? undefined : JSON.parse(output)
  }

  return {
    async inspect({ repository }) {
      const repositoryState = callApi('GET', `/repos/${repository}`)
      if (
        typeof repositoryState?.full_name !== 'string'
        || typeof repositoryState?.default_branch !== 'string'
      ) throw new Error('GitHub repository identity evidence was incomplete.')

      const pages = callApi(
        'GET',
        `/repos/${repository}/releases?per_page=100`,
        undefined,
        ['--paginate', '--slurp'],
      )
      if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
        throw new Error('GitHub release collection evidence was incomplete.')
      }
      return {
        repository: {
          fullName: repositoryState.full_name,
          defaultBranch: repositoryState.default_branch,
        },
        releases: pages.flat().map(normalizeRelease),
      }
    },

    async publish({ repository, release }) {
      callApi('PATCH', `/repos/${repository}/releases/${release.id}`, {
        draft: false,
        prerelease: false,
        make_latest: 'true',
      })
    },
  }
}

export function createLocalBarePromotionClient({
  bareRepositoryPath,
} = {}) {
  const git = (args, options) => runGit(bareRepositoryPath, args, options)

  function readRelease(refName, oid, draft) {
    const metadata = JSON.parse(
      git(['show', `${oid}:.eido-release/release.json`]),
    )
    const assetPrefix = '.eido-release/assets/'
    const assetPaths = git([
      'ls-tree',
      '-r',
      '--name-only',
      oid,
      '.eido-release/assets',
    ]).split('\n').filter(Boolean)
    return {
      id: oid,
      oid,
      refName,
      tagName: metadata.tagName,
      name: metadata.name ?? '',
      draft,
      prerelease: draft,
      body: metadata.body ?? '',
      htmlUrl: null,
      assets: assetPaths.map((path) => ({
        id: `${oid}:${path}`,
        name: path.slice(assetPrefix.length),
        digest: `sha256:${sha256(git(['show', `${oid}:${path}`], { binary: true }))}`,
        size: git(['cat-file', '-s', `${oid}:${path}`]),
      })),
    }
  }

  return {
    async inspect() {
      const fullName = git(['config', '--get', 'eido.repositoryIdentity'])
      const headRef = git(['symbolic-ref', 'HEAD'])
      const defaultBranch = headRef.replace(/^refs\/heads\//, '')

      const refLines = git([
        'for-each-ref',
        '--format=%(refname) %(objectname)',
        'refs/eido/candidates',
        'refs/tags',
      ]).split('\n').filter(Boolean)
      const releases = refLines.map((line) => {
        const separator = line.indexOf(' ')
        const refName = line.slice(0, separator)
        const oid = line.slice(separator + 1)
        return readRelease(refName, oid, refName.startsWith('refs/eido/candidates/'))
      })
      return {
        repository: { fullName, defaultBranch },
        releases,
      }
    },

    async publish({ release }) {
      const tagRef = `refs/tags/${release.tagName}`
      const transaction = [
        'start',
        `create ${tagRef} ${release.oid}`,
        `delete ${release.refName} ${release.oid}`,
        'prepare',
        'commit',
        '',
      ].join('\n')
      git(['update-ref', '--stdin'], { input: transaction })
    },
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validatePromotionPolicy(policy) {
  const issues = []
  if (!isRecord(policy)) {
    issues.push({ code: 'policy-not-an-object' })
    return issues
  }
  if (
    typeof policy.repository?.fullName !== 'string'
    || policy.repository.fullName.trim() === ''
  ) {
    issues.push({ code: 'policy-repository-full-name-missing' })
  }
  if (
    typeof policy.repository?.defaultBranch !== 'string'
    || policy.repository.defaultBranch.trim() === ''
  ) {
    issues.push({ code: 'policy-repository-default-branch-missing' })
  }
  return issues
}

function resultBase(action, target, version) {
  return {
    schemaVersion: RELEASE_PROMOTION_SCHEMA_VERSION,
    verdict: 'BLOCK',
    action,
    target,
    version,
  }
}

function emitResult({ result, json, stdout, stderr, error = false }) {
  if (json) stdout(JSON.stringify(result, null, 2))
  else if (error) stderr(`BLOCK: ${result.reason}`)
  else stdout(`${result.verdict}: ${result.target} ${result.version}`)
}

function redactDiagnostic(value) {
  return String(value)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED]')
}

function releaseSummary(release) {
  return {
    id: release.id,
    tagName: release.tagName,
    draft: release.draft,
    prerelease: release.prerelease,
    ...(release.htmlUrl ? { htmlUrl: release.htmlUrl } : {}),
  }
}

const platformAssets = Object.freeze({
  'darwin-arm64': '.dmg',
  'win32-x64': '.exe',
})

function validateCandidate(release, releaseTarget) {
  const issues = []
  const marker = candidateMarker(releaseTarget)
  if (!release.body.split(/\r?\n/).includes(marker)) {
    issues.push({
      code: 'candidate-provenance-mismatch',
      expected: marker,
      actual: release.body,
    })
  }
  if (release.draft) {
    const links = Object.values(correspondingSourceLinks(releaseTarget))
    if (!links.every((link) => release.body.includes(link))) {
      issues.push({ code: 'candidate-corresponding-source-missing', expected: links })
    }
  }
  if (release.assets.some((asset) => typeof asset.name !== 'string')) {
    issues.push({ code: 'candidate-assets-malformed' })
    return issues
  }
  const assetNames = release.assets.map((asset) => asset.name)
  if (new Set(assetNames).size !== assetNames.length) {
    issues.push({ code: 'candidate-asset-name-duplicate' })
  }

  for (const evidence of releaseTarget.platformEvidence) {
    const suffix = platformAssets[evidence.platform]
    const matches = release.assets.filter(
      (asset) => asset.name.toLowerCase().endsWith(suffix),
    )
    if (matches.length !== 1) {
      issues.push({
        code: 'candidate-platform-asset-count-mismatch',
        platform: evidence.platform,
        expected: 1,
        actual: matches.length,
      })
      continue
    }
    if (matches[0].digest !== evidence.digest) {
      issues.push({
        code: 'candidate-platform-digest-mismatch',
        platform: evidence.platform,
        asset: matches[0].name,
        expected: evidence.digest,
        actual: matches[0].digest,
      })
    }
  }
  return issues
}

function inspectRelease(snapshot, releaseTarget) {
  const tagName = `v${releaseTarget.version}`
  const matches = snapshot.releases?.filter(
    (candidate) => candidate.tagName === tagName,
  ) ?? []
  const final = matches.find((release) => release.draft === false)
  if (final) return { state: 'final', release: final, matches }
  if (matches.length === 0) return { state: 'missing', matches }
  if (matches.length > 1) return { state: 'ambiguous', matches }
  return { state: 'candidate', release: matches[0], matches }
}

export async function runPromotionCli({
  argv = process.argv.slice(2),
  stdout = console.log,
  stderr = console.error,
  loadManifest = async (path) => readJson(path),
  loadPolicy = async (path) => readJson(path),
  clientFactory = ({ localBarePath }) => localBarePath
    ? createLocalBarePromotionClient({ bareRepositoryPath: localBarePath })
    : createGhPromotionClient(),
} = {}) {
  const [action, ...arguments_] = argv
  if (!['abort', 'promote', 'verify'].includes(action)) {
    stderr(cliUsage())
    return 2
  }

  const flags = parseCliFlags(arguments_)
  if (!flags || !flags['--repository'] || !flags['--version']) {
    stderr(cliUsage())
    return 2
  }
  const target = flags['--repository']
  const version = flags['--version']
  const json = flags['--json'] === true
  const base = resultBase(action, target, version)

  if (action === 'promote' && flags['--confirm'] !== target) {
    const result = { ...base, reason: 'repository-confirmation-mismatch' }
    emitResult({ result, json, stdout, stderr, error: true })
    return 2
  }

  try {
    const [manifest, policy] = await Promise.all([
      loadManifest(resolve(flags['--manifest'] ?? defaultManifestPath)),
      loadPolicy(resolve(flags['--policy'] ?? defaultPolicyPath)),
    ])

    const policyIssues = validatePromotionPolicy(policy)
    if (policyIssues.length > 0) {
      const result = {
        ...base,
        reason: 'release-public-repository-policy-invalid',
        issues: policyIssues,
      }
      emitResult({ result, json, stdout, stderr, error: true })
      return 2
    }

    if (
      flags['--proof']
      && target.toLowerCase() === policy.repository?.fullName?.toLowerCase()
    ) {
      const result = {
        ...base,
        reason: 'real-public-repository-forbidden-in-proof-mode',
      }
      emitResult({ result, json, stdout, stderr, error: true })
      return 2
    }

    const validation = validateReleasePlanningManifest(manifest)
    const releaseTarget = manifest.targets?.find(
      (candidate) => candidate?.version === version,
    )
    if (!validation.valid || !releaseTarget) {
      const result = {
        ...base,
        reason: releaseTarget
          ? 'release-planning-manifest-invalid'
          : 'release-target-not-found',
        issues: validation.issues,
      }
      emitResult({ result, json, stdout, stderr, error: true })
      return 1
    }
    if (action !== 'verify'
      && target.toLowerCase() === policy.repository?.fullName?.toLowerCase()
      && releaseTarget.platformEvidence.some((evidence) => evidence.platform === 'darwin-arm64')) {
      const result = {
        ...base,
        reason: 'legacy-promotion-does-not-support-paired-macos-artifacts',
      }
      emitResult({ result, json, stdout, stderr, error: true })
      return 1
    }
    if (releaseTarget.status !== 'promotable' || releaseTarget.promotable !== true) {
      const result = { ...base, reason: 'release-target-not-promotable' }
      emitResult({ result, json, stdout, stderr, error: true })
      return 1
    }

    if (action !== 'verify') {
      const dependency = classifyCertificationDependency(
        manifest,
        releaseTarget.sourceSha,
      )
      if (dependency.state !== 'resolved') {
        const result = {
          ...base,
          reason: `promotion-dependency-${dependency.state}`,
        }
        emitResult({ result, json, stdout, stderr, error: true })
        return 1
      }
    }

    const client = clientFactory({
      policy,
      localBarePath: flags['--local-bare']
        ? resolve(flags['--local-bare'])
        : undefined,
    })
    const snapshot = await client.inspect({
      repository: target,
      policy,
      releaseTarget,
    })
    if (snapshot.repository?.fullName !== target) {
      const result = { ...base, reason: 'repository-identity-mismatch' }
      emitResult({ result, json, stdout, stderr, error: true })
      return 2
    }
    if (snapshot.repository.defaultBranch !== policy.repository?.defaultBranch) {
      const result = { ...base, reason: 'repository-default-branch-mismatch' }
      emitResult({ result, json, stdout, stderr, error: true })
      return 2
    }
    const inspected = inspectRelease(snapshot, releaseTarget)
    if (inspected.state === 'final') {
      const result = {
        ...base,
        reason: action === 'abort'
          ? 'final-release-is-immutable'
          : action === 'verify'
            ? undefined
            : 'release-already-final',
        release: releaseSummary(inspected.release),
      }
      if (action === 'verify') {
        const issues = validateCandidate(inspected.release, releaseTarget)
        if (issues.length > 0) {
          result.verdict = 'BLOCK'
          result.reason = 'final-release-evidence-mismatch'
          result.issues = issues
          emitResult({ result, json, stdout, stderr, error: true })
          return 1
        }
        result.verdict = 'PASS'
        delete result.reason
        emitResult({ result, json, stdout, stderr })
        return 0
      }
      emitResult({ result, json, stdout, stderr, error: true })
      return 1
    }
    if (inspected.state === 'missing') {
      const result = { ...base, reason: 'release-candidate-not-found' }
      emitResult({ result, json, stdout, stderr, error: true })
      return 1
    }
    if (inspected.state === 'ambiguous') {
      const result = { ...base, reason: 'release-candidate-ambiguous' }
      emitResult({ result, json, stdout, stderr, error: true })
      return 1
    }

    const release = inspected.release
    if (action === 'verify') {
      const result = {
        ...base,
        reason: 'release-not-final',
        release: releaseSummary(release),
      }
      emitResult({ result, json, stdout, stderr, error: true })
      return 1
    }
    if (release.prerelease !== true) {
      const result = {
        ...base,
        reason: 'release-candidate-not-prerelease',
        release: releaseSummary(release),
      }
      emitResult({ result, json, stdout, stderr, error: true })
      return 1
    }
    const candidateIssues = validateCandidate(release, releaseTarget)
    if (candidateIssues.length > 0) {
      const result = {
        ...base,
        reason: 'release-candidate-evidence-mismatch',
        issues: candidateIssues,
      }
      emitResult({ result, json, stdout, stderr, error: true })
      return 1
    }

    if (action === 'abort') {
      const result = {
        ...base,
        verdict: 'ABORTED',
        release: releaseSummary(release),
        repositoryMutation: 'none',
      }
      emitResult({ result, json, stdout, stderr })
      return 0
    }

    await client.publish({ repository: target, release })
    const publishedSnapshot = await client.inspect({
      repository: target,
      policy,
      releaseTarget,
    })
    const published = inspectRelease(publishedSnapshot, releaseTarget)
    if (
      published.state !== 'final'
      || published.release.prerelease !== false
      || validateCandidate(published.release, releaseTarget).length > 0
    ) {
      const result = {
        ...base,
        reason: 'promotion-verification-failed',
      }
      emitResult({ result, json, stdout, stderr, error: true })
      return 2
    }
    const result = {
      ...base,
      verdict: 'PROMOTED',
      release: releaseSummary(published.release),
      repositoryMutation: 'atomic-release-publication',
    }
    emitResult({ result, json, stdout, stderr })
    return 0

  } catch (error) {
    const result = {
      ...base,
      reason: 'provider-error',
      message: redactDiagnostic(error.message),
    }
    emitResult({ result, json, stdout, stderr, error: true })
    return 2
  }
}

const isCli = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  process.exitCode = await runPromotionCli()
}
