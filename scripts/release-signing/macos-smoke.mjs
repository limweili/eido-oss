import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, realpathSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MACOS_SIGNING_ENVIRONMENT_CONTRACT,
  assertAcceptedNotarytoolResult as assertAcceptedNotarytoolResultShared,
  assertCertificateIdentity as assertCertificateIdentityShared,
  createDmgNotarizationArguments as createDmgNotarizationArgumentsShared,
  parseDeveloperIdCodeSignature,
  parseSignedDmgSignature,
  prepareSigningCredentials,
  removeSigningCredentials,
  resolveSigningIdentity,
} from './macos-identity.mjs'

export const MACOS_SIGNING_SMOKE_MANIFEST = Object.freeze({
  schemaVersion: 1,
  evidenceKind: 'macos-signing-smoke',
  scope: '#469',
  promotable: false,
  platform: 'darwin',
  arch: 'arm64',
  appId: 'dev.eido.signing-smoke.macos',
  productName: 'Eido macOS Signing Smoke',
  version: '0.0.0',
  profileAuthority: Object.freeze({
    state: 'installed',
    dataRoot: 'disposable',
    certification: 'not-certified',
  }),
})

// One identity boundary, two lanes: the smoke and the production release lane
// name the same environment values and share the same credential handling.
export const MACOS_SIGNING_SMOKE_ENVIRONMENT_CONTRACT = MACOS_SIGNING_ENVIRONMENT_CONTRACT

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..')
const outputRoot = path.join(repositoryRoot, '.local', 'macos-signing-smoke')
const evidencePath = path.join(outputRoot, 'macos-signing-evidence.json')
const failurePath = path.join(outputRoot, 'failure-diagnostics.json')
const artifactName = 'eido-macos-signing-smoke-non-promotable-0.0.0-arm64.dmg'
const artifactPath = path.join(outputRoot, artifactName)
const dmgIdentifier = `${MACOS_SIGNING_SMOKE_MANIFEST.appId}.dmg`
const credentialDirectoryName = 'eido-macos-signing-smoke'
const fullSha = /^[0-9a-f]{40}$/
const safeIntegerPattern = /^(?:0|[1-9]\d*)$/
// Apple publishes no completion guarantee for notarization. Measured on the
// first submission from a new Team ID (2026-08-18): Accepted, but between 74
// and 99 minutes after upload. A 20-minute ceiling failed a submission Apple
// had already queued, and 45 would have failed it too. 90 covers the observed
// latency with margin; the job timeout is raised to match so the run can
// still write its failure diagnostic instead of being killed.
const notarizationTimeoutMs = 90 * 60 * 1000
const offlineLaunchEnvironmentAllowlist = Object.freeze([
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TMPDIR',
  'USER',
  '__CF_USER_TEXT_ENCODING',
])

class SmokeFailure extends Error {
  constructor(code) {
    super(code)
    this.name = 'SmokeFailure'
    this.code = code
  }
}

export function validateMacosSigningEnvironment(env = process.env) {
  try {
    const identity = validatePublicEnvironment(env)
    const certificate = decodeBase64(required(
      env,
      MACOS_SIGNING_SMOKE_ENVIRONMENT_CONTRACT.secrets.certificate,
    ))
    assert(certificate.length > 0)
    required(env, MACOS_SIGNING_SMOKE_ENVIRONMENT_CONTRACT.secrets.certificatePassword)
    const notarizationKey = decodeBase64(required(
      env,
      MACOS_SIGNING_SMOKE_ENVIRONMENT_CONTRACT.secrets.notarizationKey,
    ))
    assert(/^-----BEGIN PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END PRIVATE KEY-----\r?\n?$/.test(
      notarizationKey.toString('utf8'),
    ))
    return identity
  } catch {
    throw new Error('macos-signing-preflight-invalid')
  }
}

function validatePublicEnvironment(env) {
  return smokeIdentity(env, { requireNotarizationIdentity: true })
}

function validateVerificationEnvironment(env) {
  return smokeIdentity(env, { requireNotarizationIdentity: false })
}

function smokeIdentity(env, { requireNotarizationIdentity }) {
  const identity = resolveSigningIdentity(env, {
    credentialDirectoryName,
    requireNotarizationIdentity,
  })
  const testedSha = required(env, 'EIDO_MACOS_TESTED_SHA')
  const runId = required(env, 'EIDO_MACOS_RUN_ID')
  const runAttempt = required(env, 'EIDO_MACOS_RUN_ATTEMPT')
  assert(fullSha.test(testedSha))
  assert(safeIntegerPattern.test(runId))
  assert(/^[1-9]\d*$/.test(runAttempt))
  return {
    ...identity,
    testedSha,
    runId,
    runAttempt,
    verificationPrefix: `${identity.runnerTemp}/eido-macos-signing-verify-`,
  }
}

export function assertMacosSigningSmokeManifest(value) {
  const expectedEntries = Object.entries(MACOS_SIGNING_SMOKE_MANIFEST)
  const actualKeys = value && typeof value === 'object' ? Object.keys(value) : []
  assert(actualKeys.length === expectedEntries.length, 'macos-signing-manifest-invalid')
  for (const [key, expected] of expectedEntries) {
    assert(
      Object.hasOwn(value, key) && JSON.stringify(value[key]) === JSON.stringify(expected),
      'macos-signing-manifest-invalid',
    )
  }
  return value
}

// The signature shapes are the shared boundary's; the smoke only binds its own
// DMG identifier and keeps the exported names its evidence and tests use.
export function parseCodeSignature(source, identity) {
  return parseDeveloperIdCodeSignature(source, identity)
}

export function parseDmgSignature(source, identity) {
  return parseSignedDmgSignature(source, { ...identity, expectedIdentifier: dmgIdentifier })
}

export function normalizedFailureEvidence(phase, env = process.env) {
  return {
    schemaVersion: 1,
    evidenceKind: 'macos-signing-smoke-failure-diagnostic',
    scope: '#469',
    promotable: false,
    testedSha: fullSha.test(env.EIDO_MACOS_TESTED_SHA ?? '') ? env.EIDO_MACOS_TESTED_SHA : null,
    runId: safeIntegerPattern.test(env.EIDO_MACOS_RUN_ID ?? '') ? env.EIDO_MACOS_RUN_ID : null,
    runAttempt: /^[1-9]\d*$/.test(env.EIDO_MACOS_RUN_ATTEMPT ?? '') ? env.EIDO_MACOS_RUN_ATTEMPT : null,
    phase: ['preflight', 'package', 'notarize', 'verify', 'cleanup'].includes(phase) ? phase : 'unknown',
    code: 'macos-signing-smoke-failed',
  }
}

export function createOfflineLaunchEnvironment(source) {
  const environment = {}
  for (const name of offlineLaunchEnvironmentAllowlist) {
    if (typeof source[name] === 'string' && source[name] !== '') environment[name] = source[name]
  }
  return environment
}

export function profileProofRootPrefix(temporaryRoot = realpathSync(os.tmpdir())) {
  return path.join(temporaryRoot, 'eido-profile-signing-')
}

export function createDmgNotarizationArguments(identity, dmgPath = artifactPath) {
  return createDmgNotarizationArgumentsShared(identity, dmgPath)
}

export function assertAcceptedNotarytoolResult(source) {
  return assertAcceptedNotarytoolResultShared(source)
}

export function assertStableArtifactHash(before, after) {
  assert(/^[0-9a-f]{64}$/.test(before) && before === after, 'dmg-changed-after-verification')
  return before
}

async function preflight(env = process.env) {
  assert(process.platform === 'darwin', 'preflight-host-invalid')
  assert(process.arch === 'arm64', 'preflight-architecture-invalid')
  const identity = validateMacosSigningEnvironment(env)
  assert(readGitRevision() === identity.testedSha, 'preflight-revision-invalid')

  await rm(outputRoot, { force: true, recursive: true })
  await mkdir(outputRoot, { recursive: true })
  await prepareSigningCredentials(env, identity)

  console.log(`macOS signing preflight passed for ${identity.expectedAuthority}.`)
}

async function verify(env = process.env) {
  assert(process.platform === 'darwin', 'verify-host-invalid')
  assert(process.arch === 'arm64', 'verify-architecture-invalid')
  const identity = validateVerificationEnvironment(env)
  assert(readGitRevision() === identity.testedSha, 'verify-revision-invalid')
  assert(existsSync(artifactPath), 'dmg-missing')
  const outputEntries = await readdir(outputRoot)
  assert(outputEntries.filter((entry) => entry.endsWith('.dmg')).length === 1, 'dmg-count-invalid')
  const verifiedArtifactSha = await sha256(artifactPath)
  const dmgSignature = await verifyDmgIdentity(artifactPath, identity)
  await verifyDmgIntegrity(artifactPath)
  await verifyStaple(artifactPath)
  await verifyDmgGatekeeper(artifactPath)

  const verificationRoot = await mkdtemp(identity.verificationPrefix)
  const mountPath = path.join(verificationRoot, 'mounted-dmg')
  const installRoot = path.join(verificationRoot, 'fresh-install')
  const profileProofRoot = await mkdtemp(profileProofRootPrefix())
  const mountedApp = path.join(mountPath, `${MACOS_SIGNING_SMOKE_MANIFEST.productName}.app`)
  const installedApp = path.join(installRoot, `${MACOS_SIGNING_SMOKE_MANIFEST.productName}.app`)
  let mounted = false
  let result
  let primaryError

  try {
    await mkdir(mountPath, { recursive: true })
    await mkdir(installRoot, { recursive: true })

    await runChecked('/usr/bin/hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-mountpoint', mountPath,
      artifactPath,
    ], { code: 'dmg-mount-failed', timeoutMs: 60_000 })
    mounted = true
    assert(existsSync(mountedApp), 'dmg-app-missing')

    const embeddedManifest = JSON.parse(await readFile(
      path.join(mountedApp, 'Contents', 'Resources', 'macos-manifest.json'),
      'utf8',
    ))
    assertMacosSigningSmokeManifest(embeddedManifest)
    const mountedSignature = await verifyAppIdentity(mountedApp, identity)
    await verifyGatekeeper(mountedApp)

    await runChecked('/usr/bin/ditto', [mountedApp, installedApp], {
      code: 'dmg-install-copy-failed',
      timeoutMs: 60_000,
    })
    assert(existsSync(installedApp), 'installed-app-missing')
    const installedSignature = await verifyAppIdentity(installedApp, identity)
    assert(installedSignature.cdHash === mountedSignature.cdHash, 'installed-signature-mismatch')
    await verifyGatekeeper(installedApp)

    await runChecked('/usr/bin/hdiutil', ['detach', mountPath], {
      code: 'dmg-detach-failed',
      timeoutMs: 60_000,
    })
    mounted = false

    const executable = path.join(
      installedApp,
      'Contents',
      'MacOS',
      MACOS_SIGNING_SMOKE_MANIFEST.productName,
    )
    assert(existsSync(executable), 'installed-executable-missing')
    const childEnvironment = createOfflineLaunchEnvironment(process.env)
    const stampLaunch = await runCommand('/usr/bin/sandbox-exec', [
      '-p', '(version 1) (allow default) (deny network*)',
      executable,
      `--eido-profile-proof-root=${profileProofRoot}`,
      '--eido-profile-proof-phase=stamp',
    ], { cwd: installRoot, env: childEnvironment, timeoutMs: 45_000 })
    assert(stampLaunch.code === 0, 'offline-stamp-launch-failed')
    const stamped = assertProfileStampProof(stampLaunch.stdout)
    const verifyLaunch = await runCommand('/usr/bin/sandbox-exec', [
      '-p', '(version 1) (allow default) (deny network*)',
      executable,
      `--eido-profile-proof-root=${profileProofRoot}`,
      '--eido-profile-proof-phase=verify',
      `--eido-profile-proof-card-id=${stamped.cardId}`,
      `--eido-profile-proof-mod-id=${stamped.modId}`,
      `--eido-profile-proof-revision=${stamped.revision}`,
    ], { cwd: installRoot, env: childEnvironment, timeoutMs: 45_000 })
    assert(verifyLaunch.code === 0, 'offline-verify-launch-failed')
    const reopened = assertProfileVerifyProof(verifyLaunch.stdout, stamped)

    result = {
      identity,
      dmgSignature,
      manifest: embeddedManifest,
      signature: installedSignature,
      profileProof: { stamped, reopened },
    }
  } catch (error) {
    primaryError = error
  }

  const detached = !mounted || await detachWithoutThrow(mountPath)
  let verificationRootRemoved = false
  let profileProofRootRemoved = false
  try {
    await rm(verificationRoot, { force: true, recursive: true })
    verificationRootRemoved = !existsSync(verificationRoot)
  } catch {
    verificationRootRemoved = false
  }
  try {
    await rm(profileProofRoot, { force: true, recursive: true })
    profileProofRootRemoved = !existsSync(profileProofRoot)
  } catch {
    profileProofRootRemoved = false
  }
  if (primaryError) throw primaryError
  assert(detached && verificationRootRemoved && profileProofRootRemoved, 'verification-cleanup-failed')
  const stableArtifactSha = assertStableArtifactHash(verifiedArtifactSha, await sha256(artifactPath))

  const evidence = {
    schemaVersion: 1,
    evidenceKind: 'macos-signing-smoke',
    scope: '#469',
    promotable: false,
    profileAuthority: MACOS_SIGNING_SMOKE_MANIFEST.profileAuthority,
    testedSha: result.identity.testedSha,
    runId: result.identity.runId,
    runAttempt: result.identity.runAttempt,
    platform: 'darwin',
    arch: 'arm64',
    artifact: {
      name: artifactName,
      sha256: stableArtifactSha,
      signature: result.dmgSignature,
    },
    signature: result.signature,
    notarization: {
      artifact: 'dmg',
      accepted: true,
      outerTicketStapled: true,
    },
    gatekeeper: {
      dmgAccepted: true,
      installedAppAccepted: true,
    },
    install: {
      source: 'mounted-dmg',
      method: 'ditto',
      destination: 'fresh-ephemeral-install-root',
      signaturePreserved: true,
    },
    offlineLaunch: {
      networkDeniedBy: 'sandbox-exec',
      installedProfileProofPassed: true,
      rendererOrigin: result.profileProof.stamped.security.origin,
      profileAdapter: result.profileProof.reopened.adapter,
      observedRevision: result.profileProof.reopened.queryRevision,
    },
    cleanup: {
      dmgDetached: true,
      installRootRemoved: true,
      profileProofRootRemoved: true,
    },
    manifest: result.manifest,
  }
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    status: 'verified',
    testedSha: evidence.testedSha,
    authority: evidence.signature.authority,
    teamIdentifier: evidence.signature.teamIdentifier,
  }))
}

async function cleanupCredentials(env = process.env) {
  const runnerTemp = required(env, 'RUNNER_TEMP').replace(/[\\/]+$/, '')
  assert(runnerTemp.startsWith('/') && !/[\0\r\n]/.test(runnerTemp), 'cleanup-path-invalid')
  await removeSigningCredentials({ credentialRoot: `${runnerTemp}/${credentialDirectoryName}` })
}

async function notarizeDmg(env = process.env) {
  assert(process.platform === 'darwin', 'notarization-host-invalid')
  assert(process.arch === 'arm64', 'notarization-architecture-invalid')
  const identity = validatePublicEnvironment(env)
  assert(readGitRevision() === identity.testedSha, 'notarization-revision-invalid')
  assert(existsSync(identity.notarizationKeyPath), 'notarization-key-missing')
  assert(existsSync(artifactPath), 'dmg-missing')

  const signatureBeforeNotarization = await verifyDmgIdentity(artifactPath, identity)
  await verifyDmgIntegrity(artifactPath)
  const submission = await runChecked('/usr/bin/xcrun', createDmgNotarizationArguments(identity), {
    code: 'dmg-notarization-command-failed',
    timeoutMs: notarizationTimeoutMs,
  })
  assertAcceptedNotarytoolResult(submission.stdout)
  await runChecked('/usr/bin/xcrun', ['stapler', 'staple', artifactPath], {
    code: 'dmg-staple-failed',
    timeoutMs: 60_000,
  })
  await verifyStaple(artifactPath)
  const signatureAfterStapling = await verifyDmgIdentity(artifactPath, identity)
  assert(
    signatureAfterStapling.cdHash === signatureBeforeNotarization.cdHash,
    'dmg-signature-changed-after-stapling',
  )
  await verifyDmgIntegrity(artifactPath)
  console.log(JSON.stringify({ status: 'notarized', testedSha: identity.testedSha, artifact: artifactName }))
}

async function verifyDmgIntegrity(dmgPath) {
  await runChecked('/usr/bin/hdiutil', ['verify', dmgPath], {
    code: 'dmg-integrity-invalid',
    timeoutMs: 60_000,
  })
}

async function verifyDmgIdentity(dmgPath, identity) {
  await runChecked('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', dmgPath], {
    code: 'dmg-codesign-verification-failed',
    timeoutMs: 60_000,
  })
  const signature = await runChecked('/usr/bin/codesign', ['--display', '--verbose=4', dmgPath], {
    code: 'dmg-codesign-readback-failed',
    timeoutMs: 60_000,
  })
  return parseDmgSignature(`${signature.stdout}\n${signature.stderr}`, identity)
}

async function verifyAppIdentity(app, identity) {
  await runChecked('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', app], {
    code: 'codesign-verification-failed',
    timeoutMs: 60_000,
  })
  for (const [name, executable] of [
    ['eido-cli', path.join(app, 'Contents', 'Resources', 'bin', 'eido')],
    [
      'eido-live-gateway-helper',
      path.join(
        app,
        'Contents',
        'Resources',
        'bin',
        'eido-profile-live-gateway-helper',
      ),
    ],
  ]) {
    assert(existsSync(executable), `${name}-missing`)
    await runChecked('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', executable], {
      code: `${name}-codesign-verification-failed`,
      timeoutMs: 60_000,
    })
    const nestedSignature = await runChecked(
      '/usr/bin/codesign',
      ['--display', '--verbose=4', executable],
      { code: `${name}-codesign-readback-failed`, timeoutMs: 60_000 },
    )
    parseCodeSignature(`${nestedSignature.stdout}\n${nestedSignature.stderr}`, identity)
  }
  const signature = await runChecked('/usr/bin/codesign', ['--display', '--verbose=4', app], {
    code: 'codesign-readback-failed',
    timeoutMs: 60_000,
  })
  return parseCodeSignature(`${signature.stdout}\n${signature.stderr}`, identity)
}

async function verifyStaple(app) {
  await runChecked('/usr/bin/xcrun', ['stapler', 'validate', app], {
    code: 'staple-verification-failed',
    timeoutMs: 60_000,
  })
}

async function verifyGatekeeper(app) {
  const assessment = await runChecked('/usr/sbin/spctl', [
    '--assess',
    '--type', 'execute',
    '--verbose=4',
    app,
  ], { code: 'gatekeeper-rejected', timeoutMs: 60_000 })
  const output = `${assessment.stdout}\n${assessment.stderr}`
  assert(/:\s*accepted\s*$/m.test(output), 'gatekeeper-rejected')
  assert(/^source=Notarized Developer ID\s*$/m.test(output), 'gatekeeper-source-invalid')
}

async function verifyDmgGatekeeper(dmgPath) {
  const assessment = await runChecked('/usr/sbin/spctl', [
    '--assess',
    '--type', 'open',
    '--context', 'context:primary-signature',
    '--verbose=4',
    dmgPath,
  ], { code: 'dmg-gatekeeper-rejected', timeoutMs: 60_000 })
  const output = `${assessment.stdout}\n${assessment.stderr}`
  assert(/:\s*accepted\s*$/m.test(output), 'dmg-gatekeeper-rejected')
  assert(/^source=Notarized Developer ID\s*$/m.test(output), 'dmg-gatekeeper-source-invalid')
}

function assertProfileStampProof(stdout) {
  const report = readProfileProofReport(stdout)
  assert(report.phase === 'stamp', 'profile-stamp-phase-invalid')
  assertProofIdentity(report.cardId)
  assertProofIdentity(report.modId)
  assert(Number.isSafeInteger(report.nativeGeneration) && report.nativeGeneration > 0, 'profile-stamp-generation-invalid')
  assert(Number.isSafeInteger(report.revision) && report.revision > 0, 'profile-stamp-revision-invalid')
  assert(report.logicalClose === true && report.utilityJoined === true, 'profile-stamp-shutdown-invalid')
  assert(report.security?.origin === 'eido://app', 'shell-origin-invalid')
  assert(report.security?.nodeGlobal === 'undefined', 'shell-node-global-exposed')
  assert(report.security?.requireGlobal === 'undefined', 'shell-require-global-exposed')
  assert(report.security?.popupDenied === true, 'shell-popup-not-denied')
  assert(report.security?.webviewCapability === 'undefined', 'shell-webview-exposed')
  assert(report.security?.permissionState === 'denied', 'shell-permission-not-denied')
  return report
}

function assertProfileVerifyProof(stdout, stamped) {
  const report = readProfileProofReport(stdout)
  assert(report.phase === 'verify', 'profile-verify-phase-invalid')
  assert(report.cardId === stamped.cardId && report.modId === stamped.modId, 'profile-verify-identity-mismatch')
  assert(report.adapter === 'sqlite', 'profile-verify-adapter-invalid')
  assert(report.queryRevision === stamped.revision, 'profile-verify-revision-mismatch')
  assert(
    report.offline?.scope === 'window-session'
      && report.offline.networkEmulationEnabled === true,
    'profile-verify-offline-invalid',
  )
  assert(Number.isSafeInteger(report.nativeGeneration) && report.nativeGeneration > 0, 'profile-verify-generation-invalid')
  assert(Number.isSafeInteger(report.revision) && report.revision > 0, 'profile-verify-close-revision-invalid')
  assert(report.logicalClose === true && report.utilityJoined === true, 'profile-verify-shutdown-invalid')
  return report
}

function readProfileProofReport(stdout) {
  const prefix = 'EIDO_PROFILE_PROOF:'
  const lines = stdout.split(/\r?\n/).filter((entry) => entry.startsWith(prefix))
  assert(lines.length === 1, 'profile-proof-evidence-invalid')
  return JSON.parse(lines[0].slice(prefix.length))
}

function assertProofIdentity(value) {
  assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value), 'profile-proof-identity-invalid')
}

export function assertCertificateIdentity(source, identity) {
  return assertCertificateIdentityShared(source, identity)
}

function readGitRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  assert(!result.error && result.status === 0 && fullSha.test(result.stdout.trim()), 'git-revision-unavailable')
  return result.stdout.trim()
}

async function writeFailureEvidence(phase, env, error) {
  await rm(outputRoot, { force: true, recursive: true })
  await mkdir(outputRoot, { recursive: true })
  const payload = normalizedFailureEvidence(phase, env, error)
  await writeFile(failurePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function detachWithoutThrow(mountPath) {
  const normal = await runCommand('/usr/bin/hdiutil', ['detach', mountPath], { timeoutMs: 60_000 })
  if (normal.code === 0) return true
  const forced = await runCommand('/usr/bin/hdiutil', ['detach', '-force', mountPath], { timeoutMs: 60_000 })
  return forced.code === 0
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function runChecked(command, args, { code, ...options } = {}) {
  const result = await runCommand(command, args, options)
  assert(result.code === 0, code ?? 'command-failed')
  return result
}

function runCommand(command, args, {
  cwd = repositoryRoot,
  env = process.env,
  timeoutMs = 30_000,
} = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ code, stdout, stderr })
    }
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code))
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, timeoutMs)
  })
}

function decodeBase64(value) {
  assert(typeof value === 'string' && value.length > 0 && value.length % 4 === 0)
  assert(/^[A-Za-z0-9+/]+={0,2}$/.test(value))
  const decoded = Buffer.from(value, 'base64')
  assert(decoded.toString('base64') === value)
  return decoded
}

function required(env, name) {
  const value = env[name]
  assert(typeof value === 'string' && value.trim() !== '')
  return value.trim()
}

function assert(condition, code = 'macos-signing-smoke-invalid') {
  if (!condition) throw new SmokeFailure(code)
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isCli) {
  const command = process.argv[2]
  const phase = command === 'preflight'
    ? 'preflight'
    : command === 'notarize-dmg'
      ? 'notarize'
      : command === 'verify'
        ? 'verify'
        : command === 'cleanup'
          ? 'cleanup'
          : 'package'
  try {
    if (command === 'preflight') await preflight()
    else if (command === 'notarize-dmg') await notarizeDmg()
    else if (command === 'verify') await verify()
    else if (command === 'cleanup') await cleanupCredentials()
    else if (command === 'record-package-failure') await writeFailureEvidence('package', process.env)
    else throw new SmokeFailure('command-invalid')
  } catch (error) {
    if (command !== 'record-package-failure') {
      try {
        await writeFailureEvidence(phase, process.env, error)
      } catch {
        // The workflow still fails closed when even normalized evidence cannot be written.
      }
    }
    console.error(`macOS signing smoke ${phase} failed (${error?.code ?? 'macos-signing-smoke-failed'}).`)
    process.exitCode = 1
  }
}
