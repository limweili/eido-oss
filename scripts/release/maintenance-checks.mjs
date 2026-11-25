import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { load as loadYaml } from 'js-yaml'

import {
  UPDATE_FEED_MAX_BYTES,
  UPDATE_FEED_MAX_REDIRECTS,
  UPDATE_FEED_TIMEOUT_MS,
  UPDATE_INSTALLER_MAX_BYTES,
  UPDATE_INSTALLER_TIMEOUT_MS,
  UPDATE_MANIFEST_ASSET_NAME,
  UPDATE_MANIFEST_CHECKSUM_ASSET_NAME,
  UPDATE_MANIFEST_SIGNATURE_ASSET_NAME,
  isAllowedUpdateFeedRequestUrl,
  updateFeedAssetUrl,
} from '../../electron/updateEndpoints.ts'
import { verifyUpdateFeed } from '../../electron/updateFeed.ts'
import { runPromotionCli } from './promote-release.mjs'
import {
  LOCKED_RELEASE_PLATFORMS,
  validateReleasePlanningManifest,
} from './release-planning.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..', '..')
const defaultManifestPath = resolve(repositoryRoot, 'release/planning/manifest.json')
const defaultPolicyPath = resolve(repositoryRoot, 'release/public-repository/policy.json')

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function expectedLiveTargets(manifest) {
  return Array.isArray(manifest?.targets)
    ? manifest.targets.filter(
        (target) => target?.status === 'promotable' && target.promotable === true,
      )
    : []
}

function noLiveRelease(check) {
  return {
    check,
    verdict: 'SKIP',
    status: 'skipped',
    reason: 'no-live-release',
    checkedVersions: [],
  }
}

async function inspectPublicReleasePresence({
  repository,
  fetchImpl = globalThis.fetch,
}) {
  updateFeedAssetUrl(UPDATE_MANIFEST_ASSET_NAME)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPDATE_FEED_TIMEOUT_MS)
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/releases?per_page=1`,
      {
        signal: controller.signal,
        redirect: 'manual',
        cache: 'no-store',
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2026-03-10',
        },
      },
    )
    if (!response.ok) {
      throw maintenanceError(
        'release-presence-unreadable',
        `Latest public release inspection returned HTTP ${response.status}.`,
      )
    }
    const bytes = await readResponseCapped(response, UPDATE_FEED_MAX_BYTES)
    let releases
    try {
      releases = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw maintenanceError(
        'release-presence-unreadable',
        'Latest public release evidence was malformed.',
      )
    }
    if (
      !Array.isArray(releases)
      || releases.length > 1
      || releases.some(
        (release) => !isRecord(release)
          || typeof release.tag_name !== 'string'
          || release.draft !== false,
      )
    ) {
      throw maintenanceError(
        'release-presence-unreadable',
        'Latest public release evidence was incomplete.',
      )
    }
    return releases.length > 0
  } catch (error) {
    if (error.name === 'AbortError') {
      throw maintenanceError(
        'release-presence-unreadable',
        'Latest public release inspection timed out.',
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function checkNoExpectedRelease({
  check,
  repository,
  fetchImpl,
  inspectReleasePresence,
  releasePresence,
}) {
  try {
    const present = releasePresence === undefined
      ? await inspectReleasePresence({ repository, fetchImpl })
      : await releasePresence
    if (present) {
      return maintenanceFailure(
        check,
        'unplanned-public-release',
        'The public repository has a release but planning has no expected live target.',
        [],
      )
    }
    return noLiveRelease(check)
  } catch (error) {
    return maintenanceFailure(
      check,
      error.reason ?? 'release-presence-unreadable',
      error.message,
      [],
    )
  }
}

function maintenanceFailure(check, reason, detail, checkedVersions) {
  return {
    check,
    verdict: 'BLOCK',
    status: 'failed',
    reason,
    detail,
    checkedVersions,
  }
}

function maintenanceError(reason, message) {
  const error = new Error(message)
  error.reason = reason
  return error
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(status)
}

async function readResponseCapped(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw maintenanceError('update-asset-too-large', 'Update asset exceeded the byte limit.')
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      throw maintenanceError('update-asset-too-large', 'Update asset exceeded the byte limit.')
    }
    return bytes
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        throw maintenanceError('update-asset-too-large', 'Update asset exceeded the byte limit.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function fetchUpdateAsset({
  assetName,
  fetchImpl,
  maxBytes = UPDATE_FEED_MAX_BYTES,
  timeoutMs = UPDATE_FEED_TIMEOUT_MS,
}) {
  let url = updateFeedAssetUrl(assetName)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let hop = 0; hop <= UPDATE_FEED_MAX_REDIRECTS; hop += 1) {
      if (!isAllowedUpdateFeedRequestUrl(url)) {
        throw maintenanceError(
          'update-redirect-refused',
          `Update asset redirect left the trusted update path: ${url}`,
        )
      }
      const response = await fetchImpl(url, {
        signal: controller.signal,
        redirect: 'manual',
        cache: 'no-store',
        headers: { accept: 'application/octet-stream' },
      })
      if (isRedirectStatus(response.status)) {
        const location = response.headers.get('location')
        if (!location) {
          throw maintenanceError('update-redirect-invalid', 'Update redirect omitted its location.')
        }
        url = new URL(location, url).toString()
        continue
      }
      if (!response.ok) {
        throw maintenanceError(
          'update-asset-unavailable',
          `${assetName} returned HTTP ${response.status}.`,
        )
      }
      return readResponseCapped(response, maxBytes)
    }
    throw maintenanceError('update-redirect-limit', 'Update asset exceeded the redirect limit.')
  } catch (error) {
    if (error.name === 'AbortError') {
      throw maintenanceError('update-asset-timeout', `${assetName} timed out.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function verifyPublishedMacUpdate({ published, fetchImpl }) {
  const expected = published.platforms['darwin-arm64']?.updateArtifact
  if (!expected) {
    throw maintenanceError(
      'update-metadata-malformed',
      'Published Darwin update metadata has no certified ZIP identity.',
    )
  }
  const metadataBytes = await fetchUpdateAsset({ assetName: 'latest-mac.yml', fetchImpl })
  let metadata
  try {
    metadata = loadYaml(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes))
  } catch {
    throw maintenanceError('update-metadata-malformed', 'Published latest-mac.yml is malformed.')
  }
  const files = metadata?.files
  if (metadata?.version !== published.version
    || !Array.isArray(files)
    || files.length !== 1
    || files[0]?.url !== expected.artifactName
    || files[0]?.sha512 !== expected.sha512
    || files[0]?.size !== expected.bytes
    || metadata?.path !== expected.artifactName
    || metadata?.sha512 !== expected.sha512) {
    throw maintenanceError(
      'update-target-mismatch',
      'Published latest-mac.yml does not identify the one signed Darwin update ZIP.',
    )
  }
  const archive = await fetchUpdateAsset({
    assetName: expected.artifactName,
    fetchImpl,
    maxBytes: UPDATE_INSTALLER_MAX_BYTES,
    timeoutMs: UPDATE_INSTALLER_TIMEOUT_MS,
  })
  const sha256 = createHash('sha256').update(archive).digest('hex')
  const sha512 = createHash('sha512').update(archive).digest('base64')
  if (archive.byteLength !== expected.bytes
    || sha256 !== expected.sha256
    || sha512 !== expected.sha512) {
    throw maintenanceError(
      'update-platform-evidence-mismatch',
      'Published Darwin update ZIP does not match its signed identity.',
    )
  }
}

// The published feed must be one a shipped client accepts, so this runs the
// client's own verifier: the exact `verifyUpdateFeed` compiled into every
// app, current schema and signature included, rather than a maintenance-only
// re-implementation. A separate copy once drifted (it still asserted the
// pre-signing schema 1 and never fetched the .sig), which would have rejected
// the real live feed as malformed while missing an unsigned one entirely.
const clientRejectionReasons = {
  'signature-invalid': 'update-signature-invalid',
  'signature-mismatch': 'update-signature-mismatch',
  'checksum-invalid': 'update-checksum-invalid',
  'checksum-mismatch': 'update-checksum-mismatch',
  'malformed-metadata': 'update-metadata-malformed',
}

function verifyPublishedUpdateFeed({
  manifestBytes,
  signatureBytes,
  checksumBytes,
  feedPublicKeyHex,
}) {
  let signatureText
  let checksumText
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    signatureText = decoder.decode(signatureBytes)
    checksumText = decoder.decode(checksumBytes)
  } catch {
    throw maintenanceError('update-metadata-malformed', 'Update metadata is not valid UTF-8.')
  }

  const verification = verifyUpdateFeed({
    manifestBytes,
    signatureText,
    checksumText,
    // Test seam only; production runs verify against the compiled key.
    ...(feedPublicKeyHex ? { publicKeyHex: feedPublicKeyHex } : {}),
  })
  if (!verification.ok) {
    throw maintenanceError(
      clientRejectionReasons[verification.reason] ?? 'update-metadata-malformed',
      `A shipped client would reject the published feed (${verification.reason}).`,
    )
  }

  // Maintenance-only strictness on top of the client contract: the published
  // artifacts must carry the installer extension each platform installs.
  const parsed = verification.manifest
  for (const platform of LOCKED_RELEASE_PLATFORMS) {
    const artifact = parsed.platforms[platform]
    if (!artifact || !artifact.artifactName.toLowerCase().endsWith(
      platform === 'darwin-arm64' ? '.dmg' : '.exe',
    )) {
      throw maintenanceError(
        'update-metadata-malformed',
        `Update manifest platform ${platform} is invalid.`,
      )
    }
  }
  return parsed
}

export async function checkUpdaterHealth({
  repository,
  manifest,
  fetchImpl = globalThis.fetch,
  inspectReleasePresence = inspectPublicReleasePresence,
  releasePresence,
  // Test seam only; production runs verify against the compiled key.
  feedPublicKeyHex,
}) {
  const targets = expectedLiveTargets(manifest)
  if (targets.length === 0) {
    return checkNoExpectedRelease({
      check: 'updater-health',
      repository,
      fetchImpl,
      inspectReleasePresence,
      releasePresence,
    })
  }
  const checkedVersions = targets.map((target) => target.version)
  try {
    const [manifestBytes, signatureBytes, checksumBytes] = await Promise.all([
      fetchUpdateAsset({
        assetName: UPDATE_MANIFEST_ASSET_NAME,
        fetchImpl,
      }),
      fetchUpdateAsset({
        assetName: UPDATE_MANIFEST_SIGNATURE_ASSET_NAME,
        fetchImpl,
      }),
      fetchUpdateAsset({
        assetName: UPDATE_MANIFEST_CHECKSUM_ASSET_NAME,
        fetchImpl,
      }),
    ])
    const published = verifyPublishedUpdateFeed({
      manifestBytes,
      signatureBytes,
      checksumBytes,
      feedPublicKeyHex,
    })
    // Declarations append immutable targets; the last expected-live target is
    // therefore the release the `latest` feed must advertise. Accepting any
    // older known target would let a stale feed pass after a forward hotfix.
    const target = targets.at(-1)
    if (
      target.version !== published.version
      || target.sourceSha !== published.sourceSha
    ) {
      throw maintenanceError(
        'update-target-mismatch',
        'Published update metadata does not match an expected live release target.',
      )
    }
    await verifyPublishedMacUpdate({ published, fetchImpl })
    for (const platform of LOCKED_RELEASE_PLATFORMS) {
      const planned = target.platformEvidence?.find(
        (evidence) => evidence.platform === platform,
      )
      if (planned?.digest !== `sha256:${published.platforms[platform].sha256}`) {
        throw maintenanceError(
          'update-platform-evidence-mismatch',
          `Published update metadata does not match planned ${platform} evidence.`,
        )
      }
    }
    return {
      check: 'updater-health',
      verdict: 'PASS',
      status: 'healthy',
      checkedVersions,
      published: {
        version: published.version,
        sourceSha: published.sourceSha,
        platforms: [...LOCKED_RELEASE_PLATFORMS],
      },
    }
  } catch (error) {
    return maintenanceFailure(
      'updater-health',
      error.reason ?? 'updater-health-provider-error',
      error.message,
      checkedVersions,
    )
  }
}

export async function checkArtifactIntegrity({
  repository,
  manifest,
  manifestPath = defaultManifestPath,
  policyPath = defaultPolicyPath,
  runPromotion = runPromotionCli,
  inspectReleasePresence = inspectPublicReleasePresence,
  releasePresence,
}) {
  const targets = expectedLiveTargets(manifest)
  if (targets.length === 0) {
    return checkNoExpectedRelease({
      check: 'public-artifact-integrity',
      repository,
      inspectReleasePresence,
      releasePresence,
    })
  }
  const releases = []
  for (const target of targets) {
    const stdout = []
    const stderr = []
    try {
      const exitCode = await runPromotion({
        argv: [
          'verify',
          '--repository', repository,
          '--version', target.version,
          '--manifest', manifestPath,
          '--policy', policyPath,
          '--json',
        ],
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      })
      let output
      try {
        output = JSON.parse(stdout.join('\n'))
      } catch {
        output = { verdict: 'BLOCK', reason: 'verify-output-malformed' }
      }
      releases.push({
        version: target.version,
        verdict: exitCode === 0 && output.verdict === 'PASS' ? 'PASS' : 'BLOCK',
        ...(exitCode === 0 && output.verdict === 'PASS'
          ? {}
          : {
              exitCode,
              reason: output.reason ?? 'verify-did-not-pass',
              ...(stderr.length > 0 ? { detail: stderr.join('\n') } : {}),
            }),
      })
    } catch (error) {
      releases.push({
        version: target.version,
        verdict: 'BLOCK',
        exitCode: 2,
        reason: 'verify-provider-error',
        detail: error.message,
      })
    }
  }
  const checkedVersions = targets.map((target) => target.version)
  if (releases.some((release) => release.verdict !== 'PASS')) {
    return {
      check: 'public-artifact-integrity',
      verdict: 'BLOCK',
      status: 'failed',
      reason: 'public-artifact-integrity-failed',
      checkedVersions,
      releases,
    }
  }
  return {
    check: 'public-artifact-integrity',
    verdict: 'PASS',
    status: 'healthy',
    checkedVersions,
    releases,
  }
}

function cliUsage() {
  return 'Usage: node scripts/release/maintenance-checks.mjs run --repository <owner/name> [--manifest <path>] [--policy <path>] [--json]'
}

function parseCliFlags(arguments_) {
  const flags = {}
  const valueFlags = new Set(['--manifest', '--policy', '--repository'])
  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index]
    if (flag === '--json') {
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

function inputFailure(reason, detail) {
  return {
    check: 'maintenance-input',
    verdict: 'BLOCK',
    status: 'failed',
    reason,
    detail,
    checkedVersions: [],
  }
}

function emitMaintenanceResult({ result, json, stdout, stderr }) {
  if (json) {
    stdout(JSON.stringify(result, null, 2))
    return
  }
  for (const check of Object.values(result.checks)) {
    const suffix = check.reason ? ` (${check.reason})` : ''
    stdout(`${check.verdict}: ${check.check}${suffix}`)
  }
  const line = `${result.verdict}: release maintenance checks`
  if (result.verdict === 'BLOCK') stderr(line)
  else stdout(line)
}

export async function runMaintenanceChecksCli({
  argv = process.argv.slice(2),
  stdout = console.log,
  stderr = console.error,
  loadManifest = async (path) => JSON.parse(await readFile(path, 'utf8')),
  updaterCheck = checkUpdaterHealth,
  artifactCheck = checkArtifactIntegrity,
  inspectReleasePresence = inspectPublicReleasePresence,
} = {}) {
  const [command, ...arguments_] = argv
  const flags = parseCliFlags(arguments_)
  if (command !== 'run' || !flags?.['--repository']) {
    stderr(cliUsage())
    return 2
  }
  const repository = flags['--repository']
  const json = flags['--json'] === true
  const manifestPath = resolve(flags['--manifest'] ?? defaultManifestPath)
  const policyPath = resolve(flags['--policy'] ?? defaultPolicyPath)
  let checks
  try {
    updateFeedAssetUrl(UPDATE_MANIFEST_ASSET_NAME)
    const manifest = await loadManifest(manifestPath)
    const validation = validateReleasePlanningManifest(manifest)
    if (!validation.valid) {
      const failed = inputFailure(
        'release-planning-manifest-invalid',
        validation.issues,
      )
      checks = {
        updaterHealth: { ...failed, check: 'updater-health' },
        artifactIntegrity: { ...failed, check: 'public-artifact-integrity' },
      }
    } else {
      const releasePresence = expectedLiveTargets(manifest).length === 0
        ? inspectReleasePresence({ repository })
        : undefined
      const [updaterHealth, artifactIntegrity] = await Promise.all([
        updaterCheck({ repository, manifest, releasePresence }),
        artifactCheck({
          repository,
          manifest,
          manifestPath,
          policyPath,
          releasePresence,
        }),
      ])
      checks = { updaterHealth, artifactIntegrity }
    }
  } catch (error) {
    const failed = inputFailure('maintenance-input-unreadable', error.message)
    checks = {
      updaterHealth: { ...failed, check: 'updater-health' },
      artifactIntegrity: { ...failed, check: 'public-artifact-integrity' },
    }
  }
  const verdict = Object.values(checks).some((check) => check.verdict === 'BLOCK')
    ? 'BLOCK'
    : 'PASS'
  const result = {
    schemaVersion: 1,
    action: 'run',
    repository,
    checks,
    verdict,
  }
  emitMaintenanceResult({ result, json, stdout, stderr })
  return verdict === 'PASS' ? 0 : 1
}

const isCli = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  process.exitCode = await runMaintenanceChecksCli()
}
