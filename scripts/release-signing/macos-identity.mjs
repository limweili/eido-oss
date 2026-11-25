// The one macOS Developer ID identity boundary.
//
// Two lanes sign with Eido's Apple Developer ID: the non-promotable signing
// smoke (#469, scripts/release-signing/macos-smoke.mjs) and the production
// packaged certification lane (#696, scripts/release-signing/macos-release.mjs).
// They package different things, but the identity handling (which environment
// names carry the credentials, where credential material may live, what the
// hardened runtime is allowed to ask for, and what a valid signature looks
// like) is one contract with one implementation, kept here so a change to the
// boundary cannot land on one lane and miss the other.
//
// Nothing in this module reads a credential into a return value or a log. It
// writes credential bytes to one fixed, private, runner-temporary directory and
// hands back paths.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const MACOS_SIGNING_ENVIRONMENT_CONTRACT = Object.freeze({
  secrets: Object.freeze({
    certificate: 'EIDO_MACOS_CSC_LINK',
    certificatePassword: 'EIDO_MACOS_CSC_KEY_PASSWORD',
    notarizationKey: 'EIDO_MACOS_NOTARIZATION_API_KEY_BASE64',
  }),
  variables: Object.freeze({
    notarizationKeyId: 'EIDO_MACOS_NOTARIZATION_API_KEY_ID',
    notarizationIssuer: 'EIDO_MACOS_NOTARIZATION_API_ISSUER',
    expectedTeamId: 'EIDO_MACOS_EXPECTED_TEAM_ID',
    expectedAuthority: 'EIDO_MACOS_EXPECTED_AUTHORITY',
  }),
})

export const MACOS_SIGNING_CREDENTIAL_FILES = Object.freeze({
  certificate: 'certificate.p12',
  certificatePem: 'certificate.pem',
  notarizationKey: 'notarization-key.p8',
  entitlements: 'entitlements.plist',
})

// The hardened runtime denies capabilities the app used to get for free, so
// every entitlement here is a hole in that protection and must be one Eido
// actually needs. `allow-jit` is the only one: Chromium's JavaScript engine
// writes executable pages. This set was proven sufficient end to end by the
// signing smoke on 2026-08-18 (Apple returned Accepted, Gatekeeper accepted the
// installed app, and the app launched offline). Do not widen it to make a
// signing failure go away: a missing entitlement is a crash with a specific
// name, and the fix is to name that capability, not to open the runtime.
export const HARDENED_RUNTIME_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
</dict>
</plist>
`

export const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/
export const NOTARIZATION_KEY_ID_PATTERN = /^[A-Z0-9]{10}$/
export const NOTARIZATION_ISSUER_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const DEVELOPER_ID_AUTHORITY_PATTERN =
  /^Developer ID Application: (.+) \(([A-Z0-9]{10})\)$/

export class SigningIdentityError extends Error {
  constructor(code) {
    super(code)
    this.name = 'SigningIdentityError'
    this.code = code
  }
}

/**
 * Parse and cross-check the public halves of the identity: the certificate
 * common name must be a Developer ID Application authority whose embedded Team
 * ID equals the separately configured Team ID. Returns null when invalid so
 * callers decide their own failure code.
 */
export function parseSigningAuthority(expectedAuthority, expectedTeamId) {
  if (!TEAM_ID_PATTERN.test(expectedTeamId ?? '')) return null
  const authority = DEVELOPER_ID_AUTHORITY_PATTERN.exec(expectedAuthority ?? '')
  if (!authority || authority[1].trim() === '' || authority[2] !== expectedTeamId) return null
  return { name: authority[1], teamId: authority[2] }
}

/**
 * Resolve the public identity plus the fixed credential paths for one lane.
 * Reads no secret; a lane that only verifies (after credentials are removed)
 * calls this with `requireNotarizationIdentity: false`.
 */
export function resolveSigningIdentity(env, {
  credentialDirectoryName,
  requireNotarizationIdentity = true,
}) {
  if (typeof credentialDirectoryName !== 'string'
    || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(credentialDirectoryName)) {
    throw new SigningIdentityError('macos-signing-credential-directory-invalid')
  }
  const expectedAuthority = readRequired(env, MACOS_SIGNING_ENVIRONMENT_CONTRACT.variables.expectedAuthority)
  const expectedTeamId = readRequired(env, MACOS_SIGNING_ENVIRONMENT_CONTRACT.variables.expectedTeamId)
  const authority = parseSigningAuthority(expectedAuthority, expectedTeamId)
  if (!authority) throw new SigningIdentityError('macos-signing-authority-invalid')

  const runnerTemp = (env.RUNNER_TEMP ?? '').trim().replace(/[\\/]+$/, '')
  if (!runnerTemp.startsWith('/') || /[\0\r\n]/.test(runnerTemp)) {
    throw new SigningIdentityError('macos-signing-runner-temp-invalid')
  }

  const credentialRoot = `${runnerTemp}/${credentialDirectoryName}`
  const identity = {
    expectedAuthority,
    expectedTeamId,
    // Electron Builder's `mac.identity` matches on the certificate's common
    // name minus its `Developer ID Application: ` prefix.
    identityQualifier: `${authority.name} (${authority.teamId})`,
    runnerTemp,
    credentialRoot,
    certificatePath: `${credentialRoot}/${MACOS_SIGNING_CREDENTIAL_FILES.certificate}`,
    certificatePemPath: `${credentialRoot}/${MACOS_SIGNING_CREDENTIAL_FILES.certificatePem}`,
    notarizationKeyPath: `${credentialRoot}/${MACOS_SIGNING_CREDENTIAL_FILES.notarizationKey}`,
    entitlementsPath: `${credentialRoot}/${MACOS_SIGNING_CREDENTIAL_FILES.entitlements}`,
  }
  if (!requireNotarizationIdentity) return identity

  const notarizationApiKeyId = readRequired(
    env,
    MACOS_SIGNING_ENVIRONMENT_CONTRACT.variables.notarizationKeyId,
  )
  const notarizationApiIssuer = readRequired(
    env,
    MACOS_SIGNING_ENVIRONMENT_CONTRACT.variables.notarizationIssuer,
  )
  if (!NOTARIZATION_KEY_ID_PATTERN.test(notarizationApiKeyId)
    || !NOTARIZATION_ISSUER_PATTERN.test(notarizationApiIssuer)) {
    throw new SigningIdentityError('macos-notarization-identity-invalid')
  }
  return { ...identity, notarizationApiKeyId, notarizationApiIssuer }
}

/**
 * Decode the certificate and notarization key into the lane's private
 * credential root, prove the certificate is readable, unexpired, and the
 * expected identity, and write the entitlements the hardened runtime needs.
 * The password is passed to openssl through the environment, never argv.
 */
export async function prepareSigningCredentials(env, identity, run = execFileAsync) {
  const {
    certificate: certificateName,
    certificatePassword: certificatePasswordName,
    notarizationKey: notarizationKeyName,
  } = MACOS_SIGNING_ENVIRONMENT_CONTRACT.secrets
  const certificate = decodeBase64Secret(env[certificateName], 'macos-signing-certificate-invalid')
  const notarizationKey = decodeBase64Secret(
    env[notarizationKeyName],
    'macos-signing-notarization-key-invalid',
  )
  const certificatePassword = env[certificatePasswordName]
  if (typeof certificatePassword !== 'string' || certificatePassword.trim() === '') {
    throw new SigningIdentityError('macos-signing-certificate-password-missing')
  }
  if (!/^-----BEGIN PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END PRIVATE KEY-----\r?\n?$/.test(
    notarizationKey.toString('utf8'),
  )) {
    throw new SigningIdentityError('macos-signing-notarization-key-invalid')
  }

  await rm(identity.credentialRoot, { force: true, recursive: true })
  await mkdir(identity.credentialRoot, { recursive: true, mode: 0o700 })
  await writeFile(identity.certificatePath, certificate, { mode: 0o600 })
  await writeFile(identity.notarizationKeyPath, notarizationKey, { mode: 0o600 })
  await writeFile(identity.entitlementsPath, HARDENED_RUNTIME_ENTITLEMENTS, {
    encoding: 'utf8',
    mode: 0o600,
  })

  const commandEnvironment = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    [certificatePasswordName]: certificatePassword,
  }
  const openssl = (args, code) => run('/usr/bin/openssl', args, {
    env: commandEnvironment,
    timeout: 60_000,
    windowsHide: true,
  }).catch(() => {
    throw new SigningIdentityError(code)
  })

  await openssl([
    'pkcs12',
    '-in', identity.certificatePath,
    '-clcerts',
    '-nokeys',
    '-out', identity.certificatePemPath,
    '-passin', `env:${certificatePasswordName}`,
  ], 'macos-signing-certificate-unreadable')
  await chmod(identity.certificatePemPath, 0o600)
  await openssl([
    'x509', '-in', identity.certificatePemPath, '-checkend', '0', '-noout',
  ], 'macos-signing-certificate-expired')
  const subject = await openssl([
    'x509', '-in', identity.certificatePemPath, '-noout', '-subject', '-nameopt', 'RFC2253',
  ], 'macos-signing-certificate-identity-unreadable')
  assertCertificateIdentity(subject.stdout, identity)
  return identity
}

/** Remove every byte of credential material this lane wrote. */
export async function removeSigningCredentials(identity) {
  await rm(identity.credentialRoot, { force: true, recursive: true })
  if (existsSync(identity.credentialRoot)) {
    throw new SigningIdentityError('macos-signing-credential-cleanup-failed')
  }
}

export function assertCertificateIdentity(source, identity) {
  const subject = String(source).replace(/^subject\s*=\s*/i, '').replace(/\\,/g, '\u0000')
  const commonName = /(?:^|,)CN=([^,]+)/.exec(subject)?.[1]?.replaceAll('\u0000', ',').trim()
  const organizationalUnit = /(?:^|,)OU=([^,]+)/.exec(subject)?.[1]?.replaceAll('\u0000', ',').trim()
  if (commonName !== identity.expectedAuthority) {
    throw new SigningIdentityError('certificate-authority-mismatch')
  }
  if (organizationalUnit !== identity.expectedTeamId) {
    throw new SigningIdentityError('certificate-team-mismatch')
  }
  return { commonName, organizationalUnit }
}

/**
 * A Mach-O signature that a person's Mac will accept from an identified
 * developer: our exact authority, our Team ID, the hardened runtime, and a
 * secure timestamp (without which the signature expires with the certificate).
 */
export function parseDeveloperIdCodeSignature(source, { expectedAuthority, expectedTeamId }) {
  try {
    const authorities = [...String(source).matchAll(/^Authority=(.+)$/gm)].map((match) => match[1].trim())
    const teamIdentifier = /^TeamIdentifier=(.+)$/m.exec(source)?.[1].trim()
    const cdHash = /^CDHash=([0-9a-f]{40,64})$/im.exec(source)?.[1].toLowerCase()
    const hardenedRuntime = /^CodeDirectory .*\bflags=.*(?:\(runtime\)|\bruntime\b)/m.test(source)
    const secureTimestamp = /^Timestamp=(?!none\s*$).+$/mi.test(source)
    assert(authorities[0] === expectedAuthority)
    assert(teamIdentifier === expectedTeamId)
    assert(Boolean(cdHash))
    assert(hardenedRuntime)
    assert(secureTimestamp)
    return { authority: authorities[0], teamIdentifier, cdHash, hardenedRuntime, secureTimestamp }
  } catch {
    throw new SigningIdentityError('macos-signature-invalid')
  }
}

/**
 * A signed disk image. A DMG carries no hardened runtime, because that flag
 * belongs to executable code, so the guarantees here are authority, Team ID, the
 * exact identifier the lane signed with, and a secure timestamp.
 */
export function parseSignedDmgSignature(source, { expectedAuthority, expectedTeamId, expectedIdentifier }) {
  try {
    const authorities = [...String(source).matchAll(/^Authority=(.+)$/gm)].map((match) => match[1].trim())
    const identifier = /^Identifier=(.+)$/m.exec(source)?.[1].trim()
    const format = /^Format=(.+)$/m.exec(source)?.[1].trim()
    const teamIdentifier = /^TeamIdentifier=(.+)$/m.exec(source)?.[1].trim()
    const cdHash = /^CDHash=([0-9a-f]{40,64})$/im.exec(source)?.[1].toLowerCase()
    const secureTimestamp = /^Timestamp=(?!none\s*$).+$/mi.test(source)
    assert(identifier === expectedIdentifier)
    assert(format === 'disk image')
    assert(authorities[0] === expectedAuthority)
    assert(teamIdentifier === expectedTeamId)
    assert(Boolean(cdHash))
    assert(secureTimestamp)
    return { identifier, authority: authorities[0], teamIdentifier, cdHash, secureTimestamp }
  } catch {
    throw new SigningIdentityError('macos-dmg-signature-invalid')
  }
}

/**
 * Arguments for signing a finished DMG with the identity Electron Builder just
 * used for the app, taken from the temporary keychain it still holds open.
 * `expectedDmgPath` is resolved by the caller so a hook can never be talked
 * into signing some other file.
 */
export function createDmgSigningArguments(identity, keychainFile, dmgPath, expectedIdentifier) {
  if (!parseSigningAuthority(identity?.expectedAuthority, identity?.expectedTeamId)
    || typeof keychainFile !== 'string'
    || !keychainFile.startsWith('/')
    || /[\0\r\n]/.test(keychainFile)
    || typeof dmgPath !== 'string'
    || dmgPath === ''
    || typeof expectedIdentifier !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9.-]{2,127}$/.test(expectedIdentifier)) {
    throw new SigningIdentityError('macos-dmg-signing-context-invalid')
  }
  return [
    '--sign', identity.expectedAuthority,
    '--timestamp',
    '--identifier', expectedIdentifier,
    '--keychain', keychainFile,
    dmgPath,
  ]
}

export function createDmgNotarizationArguments(identity, dmgPath) {
  if (typeof dmgPath !== 'string' || dmgPath === '') {
    throw new SigningIdentityError('macos-notarization-context-invalid')
  }
  return [
    'notarytool',
    'submit',
    dmgPath,
    '--wait',
    '--output-format', 'json',
    '--key', identity.notarizationKeyPath,
    '--key-id', identity.notarizationApiKeyId,
    '--issuer', identity.notarizationApiIssuer,
  ]
}

export function assertAcceptedNotarytoolResult(source) {
  try {
    const result = JSON.parse(source)
    assert(result?.status === 'Accepted')
    return { status: 'Accepted' }
  } catch {
    throw new SigningIdentityError('dmg-notarization-rejected')
  }
}

export function decodeBase64Secret(value, code = 'macos-signing-secret-invalid') {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new SigningIdentityError(code)
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value || decoded.length === 0) {
    throw new SigningIdentityError(code)
  }
  return decoded
}

function readRequired(env, name) {
  const value = env?.[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SigningIdentityError(`macos-signing-${name.toLowerCase().replaceAll('_', '-')}-missing`)
  }
  return value.trim()
}

function assert(condition) {
  if (!condition) throw new SigningIdentityError('macos-signing-assertion-failed')
}
