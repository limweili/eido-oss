import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const WINDOWS_SIGNING_IDENTITY_FIELDS = Object.freeze([
  'providerClass',
  'expectedPublisher',
  'expectedCertificateThumbprintSha256',
])

export function classifyWindowsSigningIdentityContract(identityContract) {
  if (identityContract === null || typeof identityContract !== 'object' || Array.isArray(identityContract)) {
    return 'invalid'
  }
  const unselected = identityContract.bindingStatus === 'provider-unselected'
    && WINDOWS_SIGNING_IDENTITY_FIELDS.every((field) => identityContract[field] === null)
    && identityContract.trustedTimestampRequired === true
  if (unselected) return 'provider-unselected'

  const bound = identityContract.bindingStatus === 'bound'
    && nonEmptyString(identityContract.providerClass)
    && nonEmptyString(identityContract.expectedPublisher)
    && /^[0-9A-F]{64}$/.test(identityContract.expectedCertificateThumbprintSha256)
    && identityContract.trustedTimestampRequired === true
  return bound ? 'bound' : 'invalid'
}

export function verifyWindowsSigningSmoke({ manifest, evidence }) {
  assertRecord(manifest, 'Windows signing smoke manifest')
  assertRecord(evidence, 'Windows signing smoke evidence')
  assertRecord(manifest.artifact, 'Windows signing smoke artifact contract')
  assertRecord(manifest.builder, 'Windows signing smoke builder contract')
  assertRecord(manifest.identityContract, 'Windows signing identity contract')
  assertRecord(manifest.smartScreenContract, 'Windows signing SmartScreen contract')
  assertRecord(evidence.artifact, 'Windows signing smoke artifact evidence')
  assertRecord(evidence.signer, 'Windows signing smoke signer evidence')
  assertRecord(evidence.lifecycle, 'Windows signing smoke lifecycle evidence')
  assertRecord(evidence.smartScreen, 'Windows signing smoke SmartScreen evidence')

  assert(
    manifest.schemaVersion === 1
      && manifest.scope === '#470'
      && manifest.artifact.class === 'windows-signing-smoke'
      && manifest.artifact.fileName === 'Eido-Windows-Signing-Smoke-0.0.0-x64.exe'
      && manifest.artifact.platform === 'win32'
      && manifest.artifact.arch === 'x64'
      && manifest.artifact.target === 'nsis'
      && manifest.artifact.version === '0.0.0',
    'Windows signing smoke manifest identity is invalid',
  )
  assert(
    evidence.schemaVersion === 1
      && ['class', 'fileName', 'platform', 'arch', 'target', 'version'].every(
        (field) => evidence.artifact[field] === manifest.artifact[field],
      )
      && /^[0-9a-f]{64}$/.test(evidence.artifact.sha256),
    'Windows signing smoke artifact identity did not match the manifest',
  )
  assert(
    manifest.artifact.promotable === false && evidence.artifact.promotable === false,
    'Windows signing smoke artifact must remain non-promotable',
  )
  assert(
    manifest.artifact.publishPolicy === 'never'
      && evidence.artifact.publishPolicy === 'never'
      && manifest.builder?.publishArgument === 'never',
    'Windows signing smoke publishing policy must be never',
  )
  assert(
    manifest.builder.forceCodeSigning === true
      && manifest.builder.verifyUpdateCodeSignature === true,
    'Windows signing smoke builder signing policy is invalid',
  )
  assert(
    Array.isArray(manifest.lifecycleContract)
      && JSON.stringify(manifest.lifecycleContract)
        === JSON.stringify(['install', 'launch', 'offline-launch', 'uninstall']),
    'Windows signing smoke lifecycle contract is invalid',
  )
  assert(
    JSON.stringify(manifest.smartScreenContract.reporting)
      === JSON.stringify(['observed', 'not-measurable'])
      && manifest.smartScreenContract.warningFreeRequired === false,
    'Windows signing smoke SmartScreen contract is invalid',
  )

  const signatures = evidence.signer.signatures
  assert(Array.isArray(signatures) && signatures.length === 1, 'Windows signing smoke requires exactly one signer')
  const signature = signatures[0]
  assertRecord(signature, 'Windows signing smoke signature evidence')
  assertRecord(signature.timestamp, 'Windows signing smoke trusted timestamp evidence')
  assert(
    classifyWindowsSigningIdentityContract(manifest.identityContract) === 'bound',
    'Windows signing smoke provider identity contract is unbound',
  )
  assert(
    nonEmptyString(manifest.identityContract.providerClass)
      && evidence.signer.providerClass === manifest.identityContract.providerClass,
    'Windows signing smoke provider class did not match the bound contract',
  )
  assert(
    evidence.signer.authenticodeStatus === 'Valid',
    'Windows signing smoke Authenticode status was not Valid',
  )
  assert(
    nonEmptyString(manifest.identityContract.expectedPublisher)
      && signature.publisher === manifest.identityContract.expectedPublisher,
    'Windows signing smoke publisher did not match the expected publisher',
  )
  assert(
    /^[0-9A-F]{64}$/.test(manifest.identityContract.expectedCertificateThumbprintSha256)
      && /^[0-9A-F]{64}$/.test(signature.certificateThumbprintSha256),
    'Windows signing smoke certificate thumbprint format is invalid',
  )
  assert(
    signature.certificateThumbprintSha256
      === manifest.identityContract.expectedCertificateThumbprintSha256,
    'Windows signing smoke certificate thumbprint did not match the expected signer',
  )
  assert(signature.chainStatus === 'Valid', 'Windows signing smoke certificate chain was not valid')
  assert(
    manifest.identityContract.trustedTimestampRequired === true
      && signature.timestamp.status === 'Valid'
      && signature.timestamp.trusted === true
      && signature.timestamp.protocol === 'rfc3161'
      && nonEmptyString(signature.timestamp.authority)
      && canonicalTimestamp(signature.timestamp.signedAt),
    'Windows signing smoke trusted timestamp evidence is invalid',
  )

  const install = readPassedPhase(evidence.lifecycle.install, 'install', ['installScope'])
  const launch = readPassedPhase(evidence.lifecycle.launch, 'launch')
  const offlineLaunch = readPassedPhase(
    evidence.lifecycle['offline-launch'],
    'offline-launch',
    ['network', 'outboundConnections'],
  )
  const uninstall = readPassedPhase(
    evidence.lifecycle.uninstall,
    'uninstall',
    ['applicationRemoved', 'shortcutsRemoved', 'runningProcesses'],
  )
  assert(install.installScope === 'per-user', 'Windows signing smoke install scope was not per-user')
  assert(
    offlineLaunch.network === 'blocked' && offlineLaunch.outboundConnections === 0,
    'Windows signing smoke offline-launch was not network-isolated',
  )
  assert(
    uninstall.applicationRemoved === true
      && uninstall.shortcutsRemoved === true
      && uninstall.runningProcesses === 0,
    'Windows signing smoke uninstall cleanup was incomplete',
  )
  const smartScreen = readSmartScreen(evidence.smartScreen)

  return {
    schemaVersion: 1,
    scope: manifest.scope,
    result: 'verified',
    promotable: false,
    artifact: {
      class: evidence.artifact.class,
      fileName: evidence.artifact.fileName,
      sha256: evidence.artifact.sha256,
      platform: evidence.artifact.platform,
      arch: evidence.artifact.arch,
      target: evidence.artifact.target,
      version: evidence.artifact.version,
      publishPolicy: evidence.artifact.publishPolicy,
    },
    signingIdentity: {
      providerClass: evidence.signer.providerClass,
      expectedPublisher: manifest.identityContract.expectedPublisher,
      observedPublisher: signature.publisher,
      expectedCertificateThumbprintSha256:
        manifest.identityContract.expectedCertificateThumbprintSha256,
      observedCertificateThumbprintSha256: signature.certificateThumbprintSha256,
      authenticodeStatus: evidence.signer.authenticodeStatus,
      chainStatus: signature.chainStatus,
      trustedTimestamp: {
        status: signature.timestamp.status,
        trusted: signature.timestamp.trusted,
        protocol: signature.timestamp.protocol,
        authority: signature.timestamp.authority,
        signedAt: signature.timestamp.signedAt,
      },
    },
    lifecycle: [install, launch, offlineLaunch, uninstall],
    smartScreen,
  }
}

function readPassedPhase(candidate, phase, extraFields = []) {
  assertRecord(candidate, `Windows signing smoke ${phase} evidence`)
  assert(candidate.status === 'passed', `Windows signing smoke ${phase} did not pass`)
  assert(candidate.exitCode === 0, `Windows signing smoke ${phase} exit code was not zero`)
  return {
    phase,
    status: candidate.status,
    exitCode: candidate.exitCode,
    ...Object.fromEntries(extraFields.map((field) => [field, candidate[field]])),
  }
}

function assertRecord(value, description) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${description} is invalid`)
}

function readSmartScreen(candidate) {
  if (candidate.measurement === 'observed') {
    assert(
      ['allowed', 'warned', 'blocked'].includes(candidate.verdict)
        && canonicalTimestamp(candidate.observedAt),
      'Windows signing smoke observed SmartScreen evidence is invalid',
    )
    return {
      measurement: 'observed',
      verdict: candidate.verdict,
      observedAt: candidate.observedAt,
    }
  }
  assert(candidate.measurement === 'not-measurable', 'Windows signing smoke SmartScreen measurement is invalid')
  assert(nonEmptyString(candidate.reason), 'Windows signing smoke SmartScreen not-measurable reason is invalid')
  return { measurement: 'not-measurable', reason: candidate.reason }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim()
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function runCli(arguments_) {
  const paths = readCliPaths(arguments_)
  const [manifest, evidence] = await Promise.all([
    readJson(paths.manifest, 'manifest'),
    readJson(paths.evidence, 'evidence'),
  ])
  process.stdout.write(`${JSON.stringify(verifyWindowsSigningSmoke({ manifest, evidence }), null, 2)}\n`)
}

function readCliPaths(arguments_) {
  const result = {}
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index]
    const value = arguments_[index + 1]
    assert(
      (flag === '--manifest' || flag === '--evidence')
        && nonEmptyString(value)
        && result[flag.slice(2)] === undefined,
      'Usage: windows-smoke.mjs --manifest <path> --evidence <path>',
    )
    result[flag.slice(2)] = value
  }
  assert(
    arguments_.length === 4 && result.manifest && result.evidence,
    'Usage: windows-smoke.mjs --manifest <path> --evidence <path>',
  )
  return result
}

async function readJson(location, description) {
  try {
    return JSON.parse(await readFile(location, 'utf8'))
  } catch (error) {
    throw new Error(`Windows signing smoke ${description} could not be read: ${error.message}`)
  }
}

const isCli = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isCli) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
