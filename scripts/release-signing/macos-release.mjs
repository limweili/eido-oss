// Production macOS release signing: the identity handling proven by the #469
// signing smoke, applied to the artifact people actually install.
//
// This module owns the three steps that bracket packaging in the packaged
// certification lane:
//
//   preflight     decode and prove the identity before any native spend
//   notarize-dmg  submit the signed DMG to Apple, staple the ticket, re-verify
//   cleanup       remove every byte of credential material from the runner
//
// The signing itself happens inside Electron Builder via
// `release/packaged/production-builder.mjs`, which shares this module's
// credential paths. Verification of the finished artifact happens inside the
// certification harness, which already inspects the exact bytes it will
// publish (`scripts/certification/certify-packaged.mjs`).
//
// Credential boundary, inherited from the smoke: credential material exists
// only between `preflight` and `cleanup`, only under one fixed runner-temporary
// directory, and `cleanup` runs before the packaged app is ever launched and
// before any artifact is uploaded.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CERTIFICATION_PACKAGE_IDENTITY,
  validateCertificationIntent,
} from '../certification/certification-manifest.mjs'
import {
  assertAcceptedNotarytoolResult,
  createDmgNotarizationArguments,
  parseSignedDmgSignature,
  prepareSigningCredentials,
  removeSigningCredentials,
  resolveSigningIdentity,
} from './macos-identity.mjs'
import { runChecked } from './run-command.mjs'

export const MACOS_RELEASE_CREDENTIAL_DIRECTORY = 'eido-macos-release-signing'

// Electron Builder expands this template; the same shape is resolved here so
// the DMG signing hook knows the exact file it is allowed to sign.
export const PRODUCTION_ARTIFACT_NAME_TEMPLATE = 'Eido-${version}-${arch}.${ext}'

// Apple publishes no completion guarantee for notarization, so these numbers
// come from measurement, not from the documentation.
//
// Measured on the first submissions from this Team ID (2026-08-18): Accepted,
// but between 74 and 99 minutes after upload. A 20-minute ceiling failed a
// submission Apple had already queued and would eventually accept; 45 would
// have failed it too. The signing smoke's 90-minute ceiling sits *inside* the
// measured band: it would have failed the slowest observed submission, so it
// is not the value to copy.
//
// The wait is therefore 150 minutes: about 50% above the slowest observed
// queue, which is headroom for a queue that is known to vary by a factor of
// four between the fastest and slowest measurement and has no published
// ceiling at all.
//
// The job limit must exceed the wait, not merely match it. If Apple is slower
// than 150 minutes we want the run to fail with a named notarization timeout
// that a person can read, not to be killed mid-step by GitHub with no
// diagnosis. Two independently submitted artifacts (the app before archive
// construction and the outer DMG) can each consume that wait. 360 minutes is
// those two 150-minute bounds plus 60 minutes for packaging and certification.
//
// The cost of being wrong is asymmetric. Waiting too long burns runner minutes
// on a release that is already dispatched; waiting too little discards a
// completed native build and an Apple submission that was going to succeed.
export const MACOS_NOTARIZATION_WAIT_MINUTES = 150
export const MACOS_RELEASE_JOB_TIMEOUT_MINUTES = 360
export const MACOS_MEASURED_NOTARIZATION_LATENCY_MINUTES = Object.freeze({
  observedMinimum: 74,
  observedMaximum: 99,
  measuredOn: '2026-08-18',
  evidence: '#469',
})

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..')
const notarizationTimeoutMs = MACOS_NOTARIZATION_WAIT_MINUTES * 60 * 1000
const fullSha = /^[0-9a-f]{40}$/

export function productionDmgIdentifier() {
  return `${CERTIFICATION_PACKAGE_IDENTITY.appId}.dmg`
}

export function productionArtifactName(version, arch, extension) {
  return PRODUCTION_ARTIFACT_NAME_TEMPLATE
    .replace('${version}', version)
    .replace('${arch}', arch)
    .replace('${ext}', extension)
}

export function productionPackageDirectory(certificationSetId, platform, arch) {
  return path.join(
    repositoryRoot,
    '.local',
    'packaged-certification',
    certificationSetId,
    `${platform}-${arch}`,
    'package',
  )
}

export class ReleaseSigningFailure extends Error {
  constructor(code) {
    super(code)
    this.name = 'ReleaseSigningFailure'
    this.code = code
  }
}

/**
 * The macOS release identity: the certification intent this run is packaging,
 * plus the signing identity and its credential paths. Every field is public.
 */
export function resolveReleaseSigningContext(env = process.env, {
  requireNotarizationIdentity = true,
} = {}) {
  const platform = env.EIDO_CERTIFICATION_PLATFORM?.trim()
  const arch = env.EIDO_CERTIFICATION_ARCH?.trim()
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new ReleaseSigningFailure('macos-release-signing-target-invalid')
  }
  const intent = validateCertificationIntent({
    schemaVersion: 1,
    certificationSetId: env.EIDO_CERTIFICATION_SET_ID?.trim(),
    sourceSha: env.EIDO_CERTIFICATION_SOURCE_SHA?.trim(),
    semver: env.EIDO_CERTIFICATION_SEMVER?.trim(),
    promotable: true,
    packageIdentity: CERTIFICATION_PACKAGE_IDENTITY,
  })
  const identity = resolveSigningIdentity(env, {
    credentialDirectoryName: MACOS_RELEASE_CREDENTIAL_DIRECTORY,
    requireNotarizationIdentity,
  })
  return {
    intent,
    identity,
    dmgIdentifier: productionDmgIdentifier(),
    packageDirectory: productionPackageDirectory(intent.certificationSetId, platform, arch),
    artifactPath: path.join(
      productionPackageDirectory(intent.certificationSetId, platform, arch),
      productionArtifactName(intent.semver, arch, 'dmg'),
    ),
  }
}

async function preflight(env = process.env) {
  assert(process.platform === 'darwin', 'macos-release-preflight-host-invalid')
  assert(process.arch === 'arm64', 'macos-release-preflight-architecture-invalid')
  const context = resolveReleaseSigningContext(env)
  assertExactSourceRevision(context.intent.sourceSha)
  await prepareSigningCredentials(env, context.identity)
  console.log(`macOS release signing preflight passed for ${context.identity.expectedAuthority}.`)
}

async function notarizeDmg(env = process.env) {
  assert(process.platform === 'darwin', 'macos-release-notarization-host-invalid')
  assert(process.arch === 'arm64', 'macos-release-notarization-architecture-invalid')
  const context = resolveReleaseSigningContext(env)
  assertExactSourceRevision(context.intent.sourceSha)
  assert(existsSync(context.identity.notarizationKeyPath), 'notarization-key-missing')
  const artifact = await requireSingleDmg(context)

  // Prove the DMG carries our identity before spending an Apple submission on
  // it, so a signing regression fails here with a signature error rather than
  // an hour later with a notarization rejection.
  const signatureBefore = await verifyDmgIdentity(artifact, context)
  await verifyDmgIntegrity(artifact)

  const submission = await runChecked('/usr/bin/xcrun', createDmgNotarizationArguments(
    context.identity,
    artifact,
  ), { code: 'dmg-notarization-command-failed', timeoutMs: notarizationTimeoutMs })
  assertAcceptedNotarytoolResult(submission.stdout)

  await runChecked('/usr/bin/xcrun', ['stapler', 'staple', artifact], {
    code: 'dmg-staple-failed',
    timeoutMs: 60_000,
  })
  await runChecked('/usr/bin/xcrun', ['stapler', 'validate', artifact], {
    code: 'staple-verification-failed',
    timeoutMs: 60_000,
  })
  const signatureAfter = await verifyDmgIdentity(artifact, context)
  assert(
    signatureAfter.cdHash === signatureBefore.cdHash,
    'dmg-signature-changed-after-stapling',
  )
  await verifyDmgIntegrity(artifact)
  console.log(JSON.stringify({
    status: 'notarized',
    certificationSetId: context.intent.certificationSetId,
    artifact: path.basename(artifact),
  }))
}

async function cleanupCredentials(env = process.env) {
  // Cleanup must succeed even when preflight never ran, so it resolves the
  // credential root from the runner temp directory alone.
  const runnerTemp = (env.RUNNER_TEMP ?? '').trim().replace(/[\\/]+$/, '')
  assert(runnerTemp.startsWith('/') && !/[\0\r\n]/.test(runnerTemp), 'cleanup-path-invalid')
  await removeSigningCredentials({
    credentialRoot: `${runnerTemp}/${MACOS_RELEASE_CREDENTIAL_DIRECTORY}`,
  })
}

async function requireSingleDmg(context) {
  const entries = (await readdir(context.packageDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.dmg'))
  assert(entries.length === 1, 'dmg-count-invalid')
  const artifact = path.join(context.packageDirectory, entries[0].name)
  assert(artifact === context.artifactPath, 'dmg-name-invalid')
  return artifact
}

async function verifyDmgIntegrity(dmgPath) {
  await runChecked('/usr/bin/hdiutil', ['verify', dmgPath], {
    code: 'dmg-integrity-invalid',
    timeoutMs: 60_000,
  })
}

async function verifyDmgIdentity(dmgPath, context) {
  await runChecked('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', dmgPath], {
    code: 'dmg-codesign-verification-failed',
    timeoutMs: 60_000,
  })
  const signature = await runChecked('/usr/bin/codesign', ['--display', '--verbose=4', dmgPath], {
    code: 'dmg-codesign-readback-failed',
    timeoutMs: 60_000,
  })
  return parseSignedDmgSignature(`${signature.stdout}\n${signature.stderr}`, {
    expectedAuthority: context.identity.expectedAuthority,
    expectedTeamId: context.identity.expectedTeamId,
    expectedIdentifier: context.dmgIdentifier,
  })
}

function assertExactSourceRevision(sourceSha) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  assert(
    !result.error && result.status === 0 && fullSha.test(result.stdout.trim()),
    'git-revision-unavailable',
  )
  assert(result.stdout.trim() === sourceSha, 'macos-release-signing-revision-invalid')
}

function assert(condition, code = 'macos-release-signing-invalid') {
  if (!condition) throw new ReleaseSigningFailure(code)
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isCli) {
  const command = process.argv[2]
  try {
    if (command === 'preflight') await preflight()
    else if (command === 'notarize-dmg') await notarizeDmg()
    else if (command === 'cleanup') await cleanupCredentials()
    else throw new ReleaseSigningFailure('command-invalid')
  } catch (error) {
    // Failure names a code, never a command transcript, path, or credential.
    console.error(`macOS release signing ${command ?? 'command'} failed (${error?.code ?? 'macos-release-signing-failed'}).`)
    process.exitCode = 1
  }
}
