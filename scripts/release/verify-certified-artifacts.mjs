// The gate between a certified build and a published one (#696, #978, ADR 0032).
//
// Publication runs on Linux, where `codesign`, `spctl`, and `stapler` do not
// exist, so this step cannot re-inspect a Developer ID signature itself. It
// does not need to. The macOS certification leg already ran every one of those
// checks on a macOS runner that held the identity, and wrote the result into a
// digest-addressed platform evidence packet. What must not be skipped is
// *reading* that packet before pushing bytes at users, and proving the bytes in
// hand are the exact bytes it describes.
//
// So this script proves three things, and refuses to publish unless all hold:
//
//   1. The evidence validates against the certification authority. For schema
//      version 2 that is what makes the macOS DMG's Developer ID authority,
//      Team ID, hardened runtime, secure timestamp, stapled notarization, and
//      Gatekeeper acceptance mandatory, via `validatePlatformEvidence`.
//   2. The evidence describes THIS release: the dispatched certification set,
//      semver, and source SHA. Evidence from another run cannot be borrowed to
//      launder an uncertified artifact.
//   3. The artifact on disk hashes to the digest the evidence recorded. The
//      signature was verified against those bytes; a different file, however
//      well-formed, was never certified.
//
// Schema version 1 is refused outright. v1 predates `artifactSigningPosture`,
// so `validatePlatformEvidence` skips the signing gate entirely for it. Those
// retained 0.1.1/0.1.2 sets are legitimate history, but publishing one now
// would mean publishing an artifact whose signature nothing ever checked.

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  FULL_SHA,
  validatePlatformEvidence,
} from '../certification/certification-manifest.mjs'

// The publishable posture. Anything older lacks the signing gate (see above).
export const REQUIRED_EVIDENCE_SCHEMA_VERSION = 2

// Feed platform key -> the certification platform/arch that must back it.
export const PUBLISHED_PLATFORMS = Object.freeze([
  Object.freeze({ feedKey: 'darwin-arm64', platform: 'darwin', arch: 'arm64' }),
  Object.freeze({ feedKey: 'win32-x64', platform: 'win32', arch: 'x64' }),
])

export class ArtifactVerificationError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code)
    this.code = code
  }
}

function require_(condition, code, detail) {
  if (!condition) throw new ArtifactVerificationError(code, detail)
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sha512Base64(bytes) {
  return createHash('sha512').update(bytes).digest('base64')
}

/**
 * Verify one platform's evidence packet against the release being published
 * and against the artifact bytes on disk.
 *
 * @returns {Promise<{feedKey: string, artifactName: string, sha256: string, bytes: number}>}
 */
export async function verifyPublishedPlatform({
  feedKey,
  platform,
  arch,
  evidencePath,
  packageDirectory,
  certificationSetId,
  semver,
  sourceSha,
  readFileImpl = readFile,
  statImpl = stat,
}) {
  let parsed
  try {
    parsed = JSON.parse(await readFileImpl(evidencePath, 'utf8'))
  } catch (error) {
    throw new ArtifactVerificationError(
      'platform-evidence-unreadable',
      `${feedKey} (${error instanceof Error ? error.message : 'unknown'})`,
    )
  }

  // Checked before validation so a v1 packet fails with the reason that
  // actually matters, rather than passing a validator that skips the gate.
  require_(
    parsed?.schemaVersion === REQUIRED_EVIDENCE_SCHEMA_VERSION,
    'platform-evidence-schema-unpublishable',
    `${feedKey} evidence is schemaVersion ${parsed?.schemaVersion}; publication requires ${REQUIRED_EVIDENCE_SCHEMA_VERSION}, which is the version that carries the signing posture gate`,
  )

  let evidence
  try {
    evidence = validatePlatformEvidence(parsed)
  } catch (error) {
    throw new ArtifactVerificationError(
      'platform-evidence-invalid',
      `${feedKey} (${error instanceof Error ? error.message : 'unknown'})`,
    )
  }

  require_(evidence.platform === platform && evidence.arch === arch,
    'platform-evidence-target-mismatch',
    `${feedKey} evidence describes ${evidence.platform}-${evidence.arch}`)
  require_(evidence.certificationSetId === certificationSetId,
    'platform-evidence-set-mismatch',
    `${feedKey} evidence belongs to certification set ${evidence.certificationSetId}, not ${certificationSetId}`)
  require_(evidence.semver === semver,
    'platform-evidence-semver-mismatch',
    `${feedKey} evidence certifies ${evidence.semver}, not ${semver}`)
  require_(evidence.sourceSha === sourceSha,
    'platform-evidence-source-mismatch',
    `${feedKey} evidence certifies source ${evidence.sourceSha}, not ${sourceSha}`)

  const artifactPath = resolve(packageDirectory, evidence.artifact.fileName)
  let bytes
  try {
    bytes = await readFileImpl(artifactPath)
  } catch (error) {
    throw new ArtifactVerificationError(
      'certified-artifact-missing',
      `${feedKey} expected ${evidence.artifact.fileName} in ${packageDirectory} (${error instanceof Error ? error.message : 'unknown'})`,
    )
  }

  const observedDigest = sha256Hex(bytes)
  require_(observedDigest === evidence.artifact.sha256,
    'certified-artifact-digest-mismatch',
    `${feedKey} ${evidence.artifact.fileName} hashes to ${observedDigest}, certified as ${evidence.artifact.sha256}`)

  const observedBytes = (await statImpl(artifactPath)).size
  require_(observedBytes === evidence.artifact.bytes,
    'certified-artifact-size-mismatch',
    `${feedKey} ${evidence.artifact.fileName} is ${observedBytes} bytes, certified as ${evidence.artifact.bytes}`)

  let updateArtifact
  if (platform === 'darwin') {
    require_(evidence.updateArtifact !== undefined,
      'certified-update-artifact-missing-evidence',
      `${feedKey} evidence does not bind a macOS update ZIP`)
    const updateArtifactPath = resolve(packageDirectory, evidence.updateArtifact.fileName)
    let updateBytes
    try {
      updateBytes = await readFileImpl(updateArtifactPath)
    } catch (error) {
      throw new ArtifactVerificationError(
        'certified-update-artifact-missing',
        `${feedKey} expected ${evidence.updateArtifact.fileName} in ${packageDirectory} (${error instanceof Error ? error.message : 'unknown'})`,
      )
    }
    require_(sha256Hex(updateBytes) === evidence.updateArtifact.sha256,
      'certified-update-artifact-digest-mismatch',
      `${feedKey} ${evidence.updateArtifact.fileName} does not match its certified SHA-256`)
    require_(sha512Base64(updateBytes) === evidence.updateArtifact.sha512,
      'certified-update-artifact-sha512-mismatch',
      `${feedKey} ${evidence.updateArtifact.fileName} does not match its certified SHA-512`)
    require_((await statImpl(updateArtifactPath)).size === evidence.updateArtifact.bytes,
      'certified-update-artifact-size-mismatch',
      `${feedKey} ${evidence.updateArtifact.fileName} does not match its certified size`)
    updateArtifact = Object.freeze({
      artifactPath: updateArtifactPath,
      artifactName: evidence.updateArtifact.fileName,
      sha256: evidence.updateArtifact.sha256,
      sha512: evidence.updateArtifact.sha512,
      bytes: evidence.updateArtifact.bytes,
    })
  }

  return Object.freeze({
    feedKey,
    artifactPath,
    artifactName: evidence.artifact.fileName,
    sha256: evidence.artifact.sha256,
    bytes: evidence.artifact.bytes,
    ...(updateArtifact ? { updateArtifact } : {}),
  })
}

/**
 * Verify every platform required for a published release.
 *
 * @returns {Promise<{certificationSetId: string, semver: string, sourceSha: string,
 *   platforms: Record<string, {artifactName: string, sha256: string, bytes: number}>}>}
 */
export async function verifyCertifiedArtifacts({
  certificationSetId,
  semver,
  sourceSha,
  evidencePathFor,
  packageDirectoryFor,
  readFileImpl,
  statImpl,
}) {
  require_(typeof certificationSetId === 'string' && certificationSetId.length > 0,
    'certification-set-id-missing')
  require_(typeof semver === 'string' && semver.length > 0, 'semver-missing')
  require_(FULL_SHA.test(sourceSha ?? ''), 'source-sha-invalid',
    'a full 40-character commit SHA is required')

  const platforms = {}
  for (const target of PUBLISHED_PLATFORMS) {
    const verified = await verifyPublishedPlatform({
      ...target,
      evidencePath: evidencePathFor(target),
      packageDirectory: packageDirectoryFor(target),
      certificationSetId,
      semver,
      sourceSha,
      readFileImpl,
      statImpl,
    })
    platforms[verified.feedKey] = Object.freeze({
      artifactPath: verified.artifactPath,
      artifactName: verified.artifactName,
      sha256: verified.sha256,
      bytes: verified.bytes,
      ...(verified.updateArtifact ? { updateArtifact: verified.updateArtifact } : {}),
    })
  }

  return Object.freeze({ certificationSetId, semver, sourceSha, platforms: Object.freeze(platforms) })
}

function parseFlags(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new ArtifactVerificationError('argument-invalid', token)
    const next = argv[index + 1]
    require_(next !== undefined && !next.startsWith('--'), 'argument-value-missing', token)
    flags[token] = next
    index += 1
  }
  return flags
}

export async function runVerifyCertifiedArtifactsCli(argv, { stdout = process.stdout } = {}) {
  const flags = parseFlags(argv)
  // The publish job unpacks each certification artifact into its own directory
  // named for the feed key, mirroring the layout inside the uploaded artifact
  // (`package/` and `evidence/`). Keeping them separate means evidence can
  // never be crossed between platforms by a file-name collision.
  const certifiedRoot = resolve(flags['--certified-dir'] ?? '.')

  const result = await verifyCertifiedArtifacts({
    certificationSetId: flags['--certification-set-id'],
    semver: flags['--semver'],
    sourceSha: flags['--source-sha'],
    evidencePathFor: ({ feedKey }) =>
      resolve(certifiedRoot, feedKey, 'evidence', 'platform-evidence.json'),
    packageDirectoryFor: ({ feedKey }) =>
      resolve(certifiedRoot, feedKey, 'package'),
  })

  stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runVerifyCertifiedArtifactsCli(process.argv.slice(2))
  } catch (error) {
    const code = error instanceof ArtifactVerificationError ? error.code : 'verification-failed'
    process.stderr.write(`Refusing to publish uncertified artifacts (${code}).\n`)
    if (error instanceof ArtifactVerificationError && error.message !== code) {
      process.stderr.write(`${error.message}\n`)
    }
    process.exitCode = 1
  }
}
