import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectDeclaredToolchain, inspectRuntimeToolchain } from '../ci/toolchain-policy.mjs'

export const RELEASE_PLANNING_SCHEMA_VERSION = 1
export const LOCKED_RELEASE_PLATFORMS = Object.freeze([
  'darwin-arm64',
  'win32-x64',
])
export const CERTIFICATION_DEPENDENCY_ID = 'profile-agent-packaged-certification'

const fullGitShaPattern = /^[0-9a-f]{40}$/
const sha256DigestPattern = /^sha256:[0-9a-f]{64}$/
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/
const exactVersionPattern = /^\d+\.\d+\.\d+$/
const targetStatuses = new Set(['declared', 'candidate', 'promotable'])
const dependencyStates = new Set(['unresolved', 'resolved', 'stale'])
const certificationDependencyIdentity = Object.freeze({
  parentIssue: Object.freeze({
    number: 520,
    url: 'https://github.com/limweili/eido/issues/520',
  }),
  issue: Object.freeze({
    number: 528,
    url: 'https://github.com/limweili/eido/issues/528',
  }),
})
const repositoryRoot = resolve(import.meta.dirname, '..', '..')
const defaultManifestPath = resolve(repositoryRoot, 'release', 'planning', 'manifest.json')
const defaultPackageManifestPath = resolve(repositoryRoot, 'package.json')

function issue(code, message, path) {
  return { code, message, path }
}

function blockedDeclaration(manifest, issues) {
  return { declared: false, idempotent: false, manifest, issues }
}

function rejectedTransition(manifest, ledgerState, issues) {
  return { accepted: false, idempotent: false, manifest, ledgerState, issues }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validReleaseVersion(version) {
  return typeof version === 'string'
    && semverPattern.test(version)
    && version.split(/[+-]/, 1)[0] !== '0.0.0'
}

function canonicalPlatformEvidence(evidence) {
  return [...evidence].sort(
    (left, right) => left.platform.localeCompare(right.platform),
  )
}

function samePlatformEvidence(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  return JSON.stringify(canonicalPlatformEvidence(left))
    === JSON.stringify(canonicalPlatformEvidence(right))
}

function validEvidenceReferences(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return false
  const kinds = new Set()
  for (const reference of evidence) {
    if (
      !isRecord(reference)
      || typeof reference.kind !== 'string'
      || reference.kind === ''
      || kinds.has(reference.kind)
      || !sha256DigestPattern.test(reference.digest ?? '')
    ) return false
    kinds.add(reference.kind)
  }
  return true
}

function validateTarget(target, targetIndex) {
  const issues = []
  const targetPath = `targets[${targetIndex}]`

  if (!isRecord(target)) {
    return [issue(
      'invalid-target',
      'Release targets must be JSON objects.',
      targetPath,
    )]
  }
  if (!validReleaseVersion(target.version)) {
    issues.push(issue(
      'invalid-version',
      'A release target version must be a unique SemVer whose core is not 0.0.0.',
      `${targetPath}.version`,
    ))
  }
  if (!fullGitShaPattern.test(target.sourceSha ?? '')) {
    issues.push(issue(
      'invalid-source-sha',
      'A release target must name one exact full lowercase Git commit SHA.',
      `${targetPath}.sourceSha`,
    ))
  }
  if (typeof target.evidenceKind !== 'string' || target.evidenceKind === '') {
    issues.push(issue(
      'invalid-evidence-kind',
      'A release target must declare its evidence kind.',
      `${targetPath}.evidenceKind`,
    ))
  }
  if (!targetStatuses.has(target.status)) {
    issues.push(issue(
      'invalid-status',
      'A release target status must be declared, candidate, or promotable.',
      `${targetPath}.status`,
    ))
  }
  if (typeof target.promotable !== 'boolean') {
    issues.push(issue(
      'invalid-promotable-flag',
      'A release target must carry an explicit promotable boolean.',
      `${targetPath}.promotable`,
    ))
  } else if ((target.status === 'promotable') !== target.promotable) {
    issues.push(issue(
      'status-promotable-mismatch',
      'Only a target with promotable status may set promotable to true.',
      `${targetPath}.promotable`,
    ))
  }

  const evidence = target.platformEvidence
  if (!Array.isArray(evidence)) {
    issues.push(issue(
      'missing-platform-evidence',
      `A release target must provide evidence for ${LOCKED_RELEASE_PLATFORMS.join(' and ')}.`,
      `${targetPath}.platformEvidence`,
    ))
    return issues
  }

  const evidencePlatforms = evidence
    .filter(isRecord)
    .map((entry) => entry.platform)
  const missingPlatforms = LOCKED_RELEASE_PLATFORMS.filter(
    (platform) => !evidencePlatforms.includes(platform),
  )
  if (missingPlatforms.length > 0) {
    issues.push(issue(
      'missing-platform-evidence',
      `Missing platform evidence: ${missingPlatforms.join(', ')}.`,
      `${targetPath}.platformEvidence`,
    ))
  }

  const extraPlatforms = [...new Set(evidencePlatforms.filter(
    (platform) => !LOCKED_RELEASE_PLATFORMS.includes(platform),
  ))]
  if (extraPlatforms.length > 0) {
    issues.push(issue(
      'extra-platform-evidence',
      `Unsupported platform evidence: ${extraPlatforms.join(', ')}.`,
      `${targetPath}.platformEvidence`,
    ))
  }

  for (const platform of LOCKED_RELEASE_PLATFORMS) {
    if (evidencePlatforms.filter((candidate) => candidate === platform).length > 1) {
      issues.push(issue(
        'duplicate-platform-evidence',
        `Platform evidence for ${platform} may appear only once.`,
        `${targetPath}.platformEvidence`,
      ))
    }
  }

  for (const [evidenceIndex, entry] of evidence.entries()) {
    const evidencePath = `${targetPath}.platformEvidence[${evidenceIndex}]`
    if (!isRecord(entry)) {
      issues.push(issue(
        'invalid-platform-evidence',
        'Platform evidence entries must be JSON objects.',
        evidencePath,
      ))
      continue
    }
    if (!fullGitShaPattern.test(entry.sourceSha ?? '')) {
      issues.push(issue(
        'invalid-platform-source-sha',
        'Platform evidence must name one exact full lowercase Git commit SHA.',
        `${evidencePath}.sourceSha`,
      ))
    }
    if (!sha256DigestPattern.test(entry.digest ?? '')) {
      issues.push(issue(
        'invalid-platform-evidence-digest',
        'Platform evidence must use a lowercase sha256:<64-hex> digest.',
        `${evidencePath}.digest`,
      ))
    }
    if (typeof entry.evidenceKind !== 'string' || entry.evidenceKind === '') {
      issues.push(issue(
        'invalid-platform-evidence-kind',
        'Platform evidence must declare its evidence kind.',
        `${evidencePath}.evidenceKind`,
      ))
    }
  }

  const platformShas = new Set(
    evidence.filter(isRecord).map((entry) => entry.sourceSha),
  )
  if (
    platformShas.size > 1
    || [...platformShas].some((sourceSha) => sourceSha !== target.sourceSha)
  ) {
    issues.push(issue(
      'mixed-sha',
      'Both locked platform evidence entries must match the release target source SHA.',
      `${targetPath}.platformEvidence`,
    ))
  }

  return issues
}

function validateManifestShape(manifest) {
  const issues = []
  if (!isRecord(manifest)) {
    return [issue(
      'invalid-manifest',
      'The release planning manifest must be a JSON object.',
      '',
    )]
  }
  if (manifest.schemaVersion !== RELEASE_PLANNING_SCHEMA_VERSION) {
    issues.push(issue(
      'unsupported-schema-version',
      `Release planning schemaVersion must be ${RELEASE_PLANNING_SCHEMA_VERSION}.`,
      'schemaVersion',
    ))
  }
  if (manifest.manifestKind !== 'release-planning') {
    issues.push(issue(
      'invalid-manifest-kind',
      'manifestKind must be release-planning.',
      'manifestKind',
    ))
  }
  if (JSON.stringify(manifest.platforms) !== JSON.stringify(LOCKED_RELEASE_PLATFORMS)) {
    issues.push(issue(
      'invalid-platform-lock',
      `The release platform lock must be exactly ${LOCKED_RELEASE_PLATFORMS.join(', ')}.`,
      'platforms',
    ))
  }
  if (!Array.isArray(manifest.targets)) {
    issues.push(issue(
      'invalid-targets',
      'targets must be an array.',
      'targets',
    ))
  }
  return issues
}

export function readReleaseToolchain(packageManifest) {
  const inspected = inspectDeclaredToolchain(packageManifest)
  const historicalPin = packageManifest?.volta
  const issues = [...inspected.issues]
  // An older package manifest can be used to repeat an existing declaration.
  // Keep its recorded keys and values so the immutable comparison still works.
  if (historicalPin !== undefined && inspected.toolchain) {
    if (typeof historicalPin?.node !== 'string' || !exactVersionPattern.test(historicalPin.node)
      || typeof historicalPin?.npm !== 'string' || !exactVersionPattern.test(historicalPin.npm)
      || packageManifest.packageManager !== `npm@${historicalPin.npm}`) {
      issues.push('Legacy package toolchain pins must name exact Node and npm versions.')
    } else {
      issues.push(...inspectRuntimeToolchain({
        nodeVersion: historicalPin.node,
        npmVersion: historicalPin.npm,
      }, inspected.toolchain))
    }
  }
  if (issues.length > 0) {
    return {
      issues: issues.map((message) => issue(
        'invalid-toolchain-manifest',
        message,
        'package.json',
      )),
      toolchain: undefined,
    }
  }
  return {
    issues: [],
    toolchain: Object.freeze({
      source: 'package.json',
      engines: Object.freeze({
        node: inspected.toolchain.nodeEngine,
        npm: inspected.toolchain.npmEngine,
      }),
      ...(historicalPin === undefined ? {} : {
        volta: Object.freeze({ node: historicalPin.node, npm: historicalPin.npm }),
      }),
    }),
  }
}

export function validateReleasePlanningManifest(
  manifest,
  { previousManifest } = {},
) {
  const issues = validateManifestShape(manifest)
  if (!Array.isArray(manifest?.targets)) return { valid: false, issues }

  for (const [targetIndex, target] of manifest.targets.entries()) {
    issues.push(...validateTarget(target, targetIndex))
  }

  const dependency = classifyCertificationDependency(manifest)
  if (dependency.state === 'empty') {
    issues.push(issue(
      'dependency-ledger-empty',
      'The external dependency ledger must record the #520/#528 certification gate.',
      'externalDependencies',
    ))
  } else if (dependency.state === 'manually-assumed') {
    issues.push(issue(
      'dependency-ledger-manually-assumed',
      'A resolved certification gate requires a certification set and real digest references.',
      'externalDependencies',
    ))
  } else if (dependency.state === 'invalid') {
    issues.push(...dependency.issues)
  }

  const versions = new Map()
  for (const [targetIndex, target] of manifest.targets.entries()) {
    if (!isRecord(target) || typeof target.version !== 'string') continue
    const prior = versions.get(target.version)
    if (!prior) {
      versions.set(target.version, { target, targetIndex })
      continue
    }
    const reused = target.sourceSha !== prior.target.sourceSha
    issues.push(issue(
      reused ? 'reused-version' : 'duplicate-version',
      reused
        ? `Version ${target.version} is declared against more than one source SHA.`
        : `Version ${target.version} is declared more than once.`,
      `targets[${targetIndex}].version`,
    ))
  }

  if (previousManifest !== undefined) {
    if (!Array.isArray(previousManifest?.targets)) {
      issues.push(issue(
        'invalid-previous-manifest',
        'The previous manifest must contain a targets array.',
        'previousManifest.targets',
      ))
    } else {
      for (const previousTarget of previousManifest.targets) {
        if (!isRecord(previousTarget) || typeof previousTarget.version !== 'string') continue
        const currentTarget = manifest.targets.find(
          (candidate) => candidate?.version === previousTarget.version,
        )
        if (!currentTarget) {
          issues.push(issue(
            'replaced-evidence',
            `Previously declared version ${previousTarget.version} cannot be removed.`,
            'targets',
          ))
          continue
        }
        if (
          currentTarget.sourceSha !== previousTarget.sourceSha
          || !samePlatformEvidence(
            currentTarget.platformEvidence,
            previousTarget.platformEvidence,
          )
          || JSON.stringify(currentTarget.toolchain)
            !== JSON.stringify(previousTarget.toolchain)
        ) {
          issues.push(issue(
            'replaced-evidence',
            `Previously declared version ${previousTarget.version} changed its source, platform evidence, or toolchain provenance.`,
            `targets[${manifest.targets.indexOf(currentTarget)}]`,
          ))
        }
      }
    }
  }

  return { valid: issues.length === 0, issues }
}

export function classifyCertificationDependency(manifest, sourceSha) {
  if (!Object.hasOwn(manifest ?? {}, 'externalDependencies')) {
    return { state: 'empty', entry: undefined, issues: [] }
  }
  if (!Array.isArray(manifest.externalDependencies)) {
    return {
      state: 'invalid',
      entry: undefined,
      issues: [issue(
        'dependency-ledger-invalid',
        'externalDependencies must be an array.',
        'externalDependencies',
      )],
    }
  }

  const matches = manifest.externalDependencies.filter(
    (entry) => entry?.id === CERTIFICATION_DEPENDENCY_ID,
  )
  if (matches.length === 0) {
    const malformedEntry = manifest.externalDependencies.find(
      (entry) => !isRecord(entry) || typeof entry.id !== 'string' || entry.id === '',
    )
    return malformedEntry
      ? {
          state: 'invalid',
          entry: malformedEntry,
          issues: [issue(
            'dependency-ledger-invalid',
            'Every external dependency must be an object with an id.',
            'externalDependencies',
          )],
        }
      : { state: 'empty', entry: undefined, issues: [] }
  }
  if (matches.length !== 1) {
    return {
      state: 'invalid',
      entry: matches[0],
      issues: [issue(
        'dependency-ledger-invalid',
        'The #520/#528 certification gate must appear exactly once.',
        'externalDependencies',
      )],
    }
  }

  const entry = matches[0]
  if (
    entry.parentIssue?.number !== certificationDependencyIdentity.parentIssue.number
    || entry.parentIssue?.url !== certificationDependencyIdentity.parentIssue.url
    || entry.issue?.number !== certificationDependencyIdentity.issue.number
    || entry.issue?.url !== certificationDependencyIdentity.issue.url
    || !dependencyStates.has(entry.state)
    || !(entry.targetSha === null || fullGitShaPattern.test(entry.targetSha ?? ''))
    || !(entry.certificationSetId === null
      || (typeof entry.certificationSetId === 'string'
        && /^[0-9a-zA-Z._:-]+$/.test(entry.certificationSetId)))
    || !Array.isArray(entry.evidence)
  ) {
    return {
      state: 'invalid',
      entry,
      issues: [issue(
        'dependency-ledger-invalid',
        'The #520/#528 certification gate identity or state shape is malformed.',
        'externalDependencies',
      )],
    }
  }

  if (entry.state === 'unresolved') {
    if (entry.certificationSetId !== null || entry.evidence.length > 0) {
      return {
        state: 'invalid',
        entry,
        issues: [issue(
          'dependency-ledger-invalid',
          'An unresolved certification gate cannot claim a certification set or evidence.',
          'externalDependencies',
        )],
      }
    }
    return { state: 'unresolved', entry, issues: [] }
  }

  const resolvedShape = fullGitShaPattern.test(entry.targetSha ?? '')
    && typeof entry.certificationSetId === 'string'
    && entry.certificationSetId !== ''
    && validEvidenceReferences(entry.evidence)
  if (!resolvedShape) {
    if (entry.state === 'resolved') {
      return { state: 'manually-assumed', entry, issues: [] }
    }
    return {
      state: 'invalid',
      entry,
      issues: [issue(
        'dependency-ledger-invalid',
        'A stale certification entry must retain its certification set and digest references.',
        'externalDependencies',
      )],
    }
  }

  if (sourceSha !== undefined && entry.targetSha !== sourceSha) {
    return { state: 'stale', entry, issues: [] }
  }
  if (entry.state === 'stale') {
    if (sourceSha === undefined || entry.targetSha !== sourceSha) {
      return { state: 'stale', entry, issues: [] }
    }
    return {
      state: 'invalid',
      entry,
      issues: [issue(
        'dependency-ledger-invalid',
        'A stale certification entry cannot match the current release target SHA.',
        'externalDependencies',
      )],
    }
  }
  return { state: 'resolved', entry, issues: [] }
}

export function transitionReleaseTargetStatus({ manifest, version, toStatus }) {
  const targetIndex = Array.isArray(manifest?.targets)
    ? manifest.targets.findIndex((candidate) => candidate?.version === version)
    : -1
  if (targetIndex === -1) {
    return rejectedTransition(
      manifest,
      classifyCertificationDependency(manifest).state,
      [issue(
        'release-target-not-found',
        `Release target ${version} was not found.`,
        'version',
      )],
    )
  }

  const target = manifest.targets[targetIndex]
  const smokeEvidence = target.version?.split(/[+-]/, 1)[0] === '0.0.0'
    || /-smoke$/.test(target.evidenceKind ?? '')
    || target.platformEvidence?.some(
      (entry) => /-smoke$/.test(entry?.evidenceKind ?? ''),
    )
  if (smokeEvidence && toStatus === 'promotable') {
    return rejectedTransition(
      manifest,
      classifyCertificationDependency(manifest, target.sourceSha).state,
      [issue(
        'smoke-target-non-promotable',
        'Version 0.0.0 and smoke/proof-only evidence can never become promotable.',
        `targets[${targetIndex}]`,
      )],
    )
  }

  if (!targetStatuses.has(toStatus)) {
    return rejectedTransition(
      manifest,
      classifyCertificationDependency(manifest, target.sourceSha).state,
      [issue(
        'invalid-status-transition',
        'The requested status must be declared, candidate, or promotable.',
        'toStatus',
      )],
    )
  }

  const ledger = classifyCertificationDependency(manifest, target.sourceSha)
  if (toStatus === 'promotable' && ledger.state !== 'resolved') {
    return rejectedTransition(
      manifest,
      ledger.state,
      [issue(
        `promotion-dependency-${ledger.state}`,
        `Release target ${version} cannot become promotable while the #528 certification gate is ${ledger.state}.`,
        'externalDependencies',
      )],
    )
  }

  const validation = validateReleasePlanningManifest(manifest)
  if (!validation.valid) {
    return rejectedTransition(manifest, ledger.state, validation.issues)
  }
  if (target.status === toStatus) {
    return {
      accepted: true,
      idempotent: true,
      manifest,
      ledgerState: ledger.state,
      issues: [],
    }
  }

  const transitions = {
    declared: new Set(['candidate', 'promotable']),
    candidate: new Set(['promotable']),
    promotable: new Set(),
  }
  if (!transitions[target.status]?.has(toStatus)) {
    return rejectedTransition(
      manifest,
      ledger.state,
      [issue(
        'invalid-status-transition',
        `Release target status cannot move from ${target.status} to ${toStatus}.`,
        `targets[${targetIndex}].status`,
      )],
    )
  }

  const nextManifest = structuredClone(manifest)
  nextManifest.targets[targetIndex].status = toStatus
  nextManifest.targets[targetIndex].promotable = toStatus === 'promotable'
  return {
    accepted: true,
    idempotent: false,
    manifest: nextManifest,
    ledgerState: ledger.state,
    issues: [],
  }
}

function parseCliFlags(arguments_, allowedFlags) {
  const flags = {}
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index]
    const value = arguments_[index + 1]
    if (
      !allowedFlags.has(flag)
      || typeof value !== 'string'
      || value === ''
      || value.startsWith('--')
      || Object.hasOwn(flags, flag)
    ) return undefined
    flags[flag] = value
  }
  return flags
}

function cliUsage() {
  return [
    'Usage:',
    '  node scripts/release/release-planning.mjs validate [--manifest <path>] [--previous-manifest <path>]',
    '  node scripts/release/release-planning.mjs declare --version <semver> --source-sha <sha> --platform-evidence <path> [--manifest <path>] [--package-manifest <path>]',
    '  node scripts/release/release-planning.mjs transition --version <semver> --status <candidate|promotable> [--manifest <path>]',
    '  node scripts/release/release-planning.mjs resolve-dependency --reference <certification-reference.json> [--manifest <path>]',
    '',
    'Commands print a planned manifest to stdout and never edit the input file.',
  ].join('\n')
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function runReleasePlanningCli({
  argv = process.argv.slice(2),
  stdout = console.log,
  stderr = console.error,
  loadJson = readJson,
} = {}) {
  const [command, ...arguments_] = argv
  const allowedFlags = {
    validate: new Set(['--manifest', '--previous-manifest']),
    declare: new Set([
      '--manifest',
      '--package-manifest',
      '--platform-evidence',
      '--source-sha',
      '--version',
    ]),
    transition: new Set(['--manifest', '--status', '--version']),
    'resolve-dependency': new Set(['--manifest', '--reference']),
  }
  if (!Object.hasOwn(allowedFlags, command)) {
    stderr(cliUsage())
    return 2
  }
  const flags = parseCliFlags(arguments_, allowedFlags[command])
  if (!flags) {
    stderr(cliUsage())
    return 2
  }

  try {
    const manifest = await loadJson(resolve(flags['--manifest'] ?? defaultManifestPath))
    let result
    if (command === 'validate') {
      const previousManifest = flags['--previous-manifest']
        ? await loadJson(resolve(flags['--previous-manifest']))
        : undefined
      const validation = validateReleasePlanningManifest(manifest, { previousManifest })
      result = {
        schemaVersion: RELEASE_PLANNING_SCHEMA_VERSION,
        action: 'validate',
        ...validation,
        dependencyStates: Array.isArray(manifest.targets) && manifest.targets.length > 0
          ? manifest.targets.map(
              (target) => classifyCertificationDependency(manifest, target.sourceSha).state,
            )
          : [classifyCertificationDependency(manifest).state],
      }
    } else if (command === 'declare') {
      if (
        !flags['--version']
        || !flags['--source-sha']
        || !flags['--platform-evidence']
      ) {
        stderr(cliUsage())
        return 2
      }
      const [packageManifest, platformEvidence] = await Promise.all([
        loadJson(resolve(flags['--package-manifest'] ?? defaultPackageManifestPath)),
        loadJson(resolve(flags['--platform-evidence'])),
      ])
      result = {
        schemaVersion: RELEASE_PLANNING_SCHEMA_VERSION,
        action: 'declare',
        ...declareReleaseTarget({
          manifest,
          version: flags['--version'],
          sourceSha: flags['--source-sha'],
          platformEvidence,
          packageManifest,
        }),
      }
    } else if (command === 'resolve-dependency') {
      if (!flags['--reference']) {
        stderr(cliUsage())
        return 2
      }
      const reference = await loadJson(resolve(flags['--reference']))
      result = {
        schemaVersion: RELEASE_PLANNING_SCHEMA_VERSION,
        action: 'resolve-dependency',
        ...resolveCertificationDependency({ manifest, reference }),
      }
    } else {
      if (!flags['--version'] || !flags['--status']) {
        stderr(cliUsage())
        return 2
      }
      result = {
        schemaVersion: RELEASE_PLANNING_SCHEMA_VERSION,
        action: 'transition',
        ...transitionReleaseTargetStatus({
          manifest,
          version: flags['--version'],
          toStatus: flags['--status'],
        }),
      }
    }

    stdout(JSON.stringify(result, null, 2))
    const succeeded = command === 'validate'
      ? result.valid
      : command === 'declare' || command === 'resolve-dependency'
        ? result.issues.length === 0
        : result.accepted
    return succeeded ? 0 : 1
  } catch (error) {
    stderr(`Release planning input could not be read: ${error.message}`)
    return 2
  }
}

const isCli = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  process.exitCode = await runReleasePlanningCli()
}

export function declareReleaseTarget({
  manifest,
  version,
  sourceSha,
  platformEvidence,
  packageManifest,
  evidenceKind = 'release-target',
}) {
  const manifestValidation = validateReleasePlanningManifest(manifest)
  if (!manifestValidation.valid) {
    return blockedDeclaration(manifest, manifestValidation.issues)
  }

  const toolchainResult = readReleaseToolchain(packageManifest)
  if (toolchainResult.issues.length > 0) {
    return blockedDeclaration(manifest, toolchainResult.issues)
  }

  const target = {
    version,
    sourceSha,
    evidenceKind,
    status: 'declared',
    promotable: false,
    toolchain: toolchainResult.toolchain,
    platformEvidence: Array.isArray(platformEvidence)
      ? canonicalPlatformEvidence(structuredClone(platformEvidence))
      : platformEvidence,
  }
  const targetValidation = validateReleasePlanningManifest({
    ...manifest,
    targets: [target],
  })
  if (!targetValidation.valid) {
    return blockedDeclaration(manifest, targetValidation.issues)
  }

  const existingTarget = manifest.targets.find(
    (candidate) => candidate.version === version,
  )
  if (existingTarget) {
    if (existingTarget.sourceSha !== sourceSha) {
      return blockedDeclaration(
        manifest,
        [issue(
          'reused-version',
          `Version ${version} is already bound to another source SHA.`,
          'version',
        )],
      )
    }
    if (
      existingTarget.evidenceKind !== evidenceKind
      || !samePlatformEvidence(existingTarget.platformEvidence, target.platformEvidence)
      || JSON.stringify(existingTarget.toolchain) !== JSON.stringify(target.toolchain)
    ) {
      return blockedDeclaration(
        manifest,
        [issue(
          'replaced-evidence',
          `Version ${version} cannot replace its recorded platform evidence or toolchain provenance.`,
          'platformEvidence',
        )],
      )
    }
    return {
      declared: false,
      idempotent: true,
      manifest,
      issues: [],
    }
  }

  return {
    declared: true,
    idempotent: false,
    manifest: {
      ...structuredClone(manifest),
      targets: [...structuredClone(manifest.targets), target],
    },
    issues: [],
  }
}

export function resolveCertificationDependency({ manifest, reference }) {
  const manifestValidation = validateReleasePlanningManifest(manifest)
  if (!manifestValidation.valid) {
    return blockedResolution(manifest, manifestValidation.issues)
  }

  const referenceIssues = validateCertificationReference(reference)
  if (referenceIssues.length > 0) {
    return blockedResolution(manifest, referenceIssues)
  }

  const target = manifest.targets.find(
    (candidate) => candidate?.version === reference.semver,
  )
  if (!target) {
    return blockedResolution(manifest, [issue(
      'release-target-not-found',
      `Release target ${reference.semver} must be declared before its certification set is resolved.`,
      'reference.semver',
    )])
  }
  if (target.sourceSha !== reference.sourceSha) {
    return blockedResolution(manifest, [issue(
      'stale-certification-reference',
      `Certification reference source ${reference.sourceSha} does not match target ${reference.semver} at ${target.sourceSha}.`,
      'reference.sourceSha',
    )])
  }

  const entryIndex = manifest.externalDependencies?.findIndex?.(
    (entry) => entry?.id === CERTIFICATION_DEPENDENCY_ID,
  )
  if (entryIndex === undefined || entryIndex < 0) {
    return blockedResolution(manifest, [issue(
      'dependency-ledger-empty',
      'The external dependency ledger must record the #520/#528 certification gate.',
      'externalDependencies',
    )])
  }

  const next = structuredClone(manifest)
  next.externalDependencies[entryIndex] = {
    ...next.externalDependencies[entryIndex],
    state: 'resolved',
    targetSha: reference.sourceSha,
    certificationSetId: reference.certificationSetId,
    evidence: [
      { kind: 'certification-manifest', digest: reference.manifest.sha256 },
      ...target.platformEvidence.map((evidence) => ({
        kind: `${evidence.platform}-evidence`,
        digest: evidence.digest,
      })),
    ],
  }

  const resolvedValidation = validateReleasePlanningManifest(next)
  if (!resolvedValidation.valid) {
    return blockedResolution(manifest, resolvedValidation.issues)
  }
  const ledger = classifyCertificationDependency(next, target.sourceSha)
  if (ledger.state !== 'resolved') {
    return blockedResolution(manifest, ledger.issues.length > 0 ? ledger.issues : [issue(
      'dependency-ledger-invalid',
      `The resolved certification gate classified as ${ledger.state}.`,
      'externalDependencies',
    )])
  }

  return { resolved: true, manifest: next, ledgerState: ledger.state, issues: [] }
}

function blockedResolution(manifest, issues) {
  return { resolved: false, manifest, ledgerState: undefined, issues }
}

function validateCertificationReference(reference) {
  const issues = []
  if (!isRecord(reference)) {
    return [issue('invalid-certification-reference', 'The certification reference must be an object.', 'reference')]
  }
  if (reference.schemaVersion !== 1) {
    issues.push(issue('invalid-certification-reference', 'The certification reference schemaVersion must be 1.', 'reference.schemaVersion'))
  }
  if (reference.kind !== 'eido-packaged-certification-set') {
    issues.push(issue('invalid-certification-reference', 'The certification reference kind must be eido-packaged-certification-set.', 'reference.kind'))
  }
  if (typeof reference.certificationSetId !== 'string' || !/^[0-9a-zA-Z._:-]+$/.test(reference.certificationSetId)) {
    issues.push(issue('invalid-certification-reference', 'The certification set id is malformed.', 'reference.certificationSetId'))
  }
  if (!fullGitShaPattern.test(reference.sourceSha ?? '')) {
    issues.push(issue('invalid-certification-reference', 'The certification reference requires a full lowercase source SHA.', 'reference.sourceSha'))
  }
  if (typeof reference.semver !== 'string' || !semverPattern.test(reference.semver)) {
    issues.push(issue('invalid-certification-reference', 'The certification reference requires a valid SemVer.', 'reference.semver'))
  }
  if (!isRecord(reference.manifest)
    || typeof reference.manifest.fileName !== 'string'
    || reference.manifest.fileName === ''
    || !sha256DigestPattern.test(reference.manifest.sha256 ?? '')) {
    issues.push(issue('invalid-certification-reference', 'The certification reference manifest requires a fileName and lowercase sha256:<64-hex> digest.', 'reference.manifest'))
  }
  return issues
}
