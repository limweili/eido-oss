import { createHash, createPublicKey, verify as verifyDetachedSignature } from 'node:crypto'
import { isValidUpdateVersion } from './updateVersion.ts'
import { UPDATE_FEED_PUBLIC_KEY_HEX } from './updateFeedPublicKey.ts'

export { compareUpdateVersions, isValidUpdateVersion } from './updateVersion.ts'
export type { UpdateVersionComparison } from './updateVersion.ts'

// Update feed verification (#682, #793, ADR 0032). The feed publishes an
// update manifest, a detached SHA-256 checksum, and a detached Ed25519
// signature over the exact manifest bytes. The checksum proves the file
// arrived undamaged; only the signature proves Eido produced it, and on
// Windows, where artifacts are deliberately unsigned, it is the single
// authenticity control between a compromised release host and code execution.
// Everything here fails closed: metadata that cannot be signature-verified,
// checksum-verified, and strictly parsed never becomes a user-visible prompt.

// Schema 2 is the first signed schema (#793). Fielded schema-1 installs treat
// it as no manifest at all, which is the accepted migration path (ADR 0032).
// #977 adds the recall fields (blocked versions, minimum supported version,
// freshness) inside this signed payload; unknown fields are ignored rather
// than rejected so those additions do not break apps shipped with this schema.
export const UPDATE_FEED_SCHEMA_VERSION = 2 as const

export const UPDATE_PLATFORMS = Object.freeze(['darwin-arm64', 'win32-x64'] as const)

export type UpdatePlatform = (typeof UPDATE_PLATFORMS)[number]

export interface UpdateManifestArtifact {
  readonly artifactName: string
  readonly sha256: string
}

export interface UpdateArchiveArtifact extends UpdateManifestArtifact {
  readonly sha512: string
  readonly bytes: number
}

export interface VerifiedUpdateManifest {
  readonly schemaVersion: typeof UPDATE_FEED_SCHEMA_VERSION
  readonly version: string
  readonly sourceSha: string
  readonly publishedAt: string
  readonly downloadPageUrl: string
  readonly platforms: Readonly<Record<UpdatePlatform, UpdateManifestArtifact & {
    readonly updateArtifact?: UpdateArchiveArtifact
  }>>
  readonly blockedVersions?: readonly string[]
  readonly minSupportedVersion?: string
}

export type UpdateFeedRejectionReason =
  | 'signature-invalid'
  | 'signature-mismatch'
  | 'checksum-invalid'
  | 'checksum-mismatch'
  | 'malformed-metadata'

export type UpdateFeedVerification =
  | Readonly<{ ok: true; manifest: VerifiedUpdateManifest }>
  | Readonly<{ ok: false; reason: UpdateFeedRejectionReason }>

const fullGitShaPattern = /^[0-9a-f]{40}$/
const sha256HexPattern = /^[0-9a-f]{64}$/
const sha512Base64Pattern = /^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/
const artifactNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/
// A raw Ed25519 public key is exactly 32 bytes.
const publicKeyHexPattern = /^[0-9a-f]{64}$/
// A detached Ed25519 signature is exactly 64 bytes: 88 base64 characters with
// two padding characters. Anything shorter, longer, or oddly encoded is
// refused before any cryptography runs.
const signatureBase64Pattern = /^[A-Za-z0-9+/]{86}==$/
// SPKI DER header for an Ed25519 public key (RFC 8410); the raw 32-byte key
// follows it. node:crypto only accepts wrapped keys, not raw bytes.
const ED25519_SPKI_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

// Verifies the manifest bytes against the detached Ed25519 signature and the
// detached checksum document, then parses them strictly. Any failure is a
// quiet rejection: the caller must treat every not-ok result as "no prompt",
// indistinguishable to the user from an unreachable feed.
export function verifyUpdateFeed(options: {
  readonly manifestBytes: Uint8Array
  readonly signatureText: string
  readonly checksumText: string
  readonly publicKeyHex?: string
}): UpdateFeedVerification {
  // Authenticity first: nothing else about the document matters if Eido did
  // not sign these exact bytes. An unprovisioned compiled key fails closed.
  const signature = parseDetachedSignature(options.signatureText)
  if (!signature) return rejection('signature-invalid')
  const publicKeyHex = options.publicKeyHex ?? UPDATE_FEED_PUBLIC_KEY_HEX
  if (!publicKeyHexPattern.test(publicKeyHex)) return rejection('signature-invalid')
  if (!verifyManifestSignature(options.manifestBytes, signature, publicKeyHex)) {
    return rejection('signature-mismatch')
  }

  const expectedDigest = parseDetachedChecksum(options.checksumText)
  if (!expectedDigest) return rejection('checksum-invalid')

  const actualDigest = createHash('sha256').update(options.manifestBytes).digest('hex')
  if (actualDigest !== expectedDigest) return rejection('checksum-mismatch')

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(options.manifestBytes))
  } catch {
    return rejection('malformed-metadata')
  }

  if (!isRecord(parsed)
    || parsed.schemaVersion !== UPDATE_FEED_SCHEMA_VERSION
    || !isValidUpdateVersion(parsed.version)
    || typeof parsed.sourceSha !== 'string'
    || !fullGitShaPattern.test(parsed.sourceSha)
    || !isValidPublishedAt(parsed.publishedAt)
    || !isTrustedDownloadPageUrl(parsed.downloadPageUrl)
    || !isRecord(parsed.platforms)) {
    return rejection('malformed-metadata')
  }

  let blockedVersions: readonly string[] | undefined
  if ('blockedVersions' in parsed && parsed.blockedVersions !== undefined) {
    if (!Array.isArray(parsed.blockedVersions)) return rejection('malformed-metadata')
    for (const item of parsed.blockedVersions) {
      if (typeof item !== 'string' || !isValidUpdateVersion(item)) {
        return rejection('malformed-metadata')
      }
    }
    blockedVersions = Object.freeze([...parsed.blockedVersions])
  }

  let minSupportedVersion: string | undefined
  if ('minSupportedVersion' in parsed && parsed.minSupportedVersion !== undefined) {
    if (typeof parsed.minSupportedVersion !== 'string' || !isValidUpdateVersion(parsed.minSupportedVersion)) {
      return rejection('malformed-metadata')
    }
    minSupportedVersion = parsed.minSupportedVersion
  }

  const platforms: Partial<Record<UpdatePlatform, UpdateManifestArtifact & {
    readonly updateArtifact?: UpdateArchiveArtifact
  }>> = {}
  for (const platform of UPDATE_PLATFORMS) {
    const artifact = parseArtifact((parsed.platforms as Record<string, unknown>)[platform], platform)
    if (!artifact) return rejection('malformed-metadata')
    platforms[platform] = artifact
  }

  return Object.freeze({
    ok: true,
    manifest: Object.freeze({
      schemaVersion: UPDATE_FEED_SCHEMA_VERSION,
      version: parsed.version,
      sourceSha: parsed.sourceSha,
      publishedAt: parsed.publishedAt as string,
      downloadPageUrl: parsed.downloadPageUrl as string,
      platforms: Object.freeze(platforms as Record<UpdatePlatform, UpdateManifestArtifact>),
      ...(blockedVersions !== undefined ? { blockedVersions } : {}),
      ...(minSupportedVersion !== undefined ? { minSupportedVersion } : {}),
    }),
  })
}

function rejection(reason: UpdateFeedRejectionReason): UpdateFeedVerification {
  return Object.freeze({ ok: false, reason })
}

// Accepts a single base64 line decoding to exactly 64 bytes: the detached
// signature format written by scripts/release-signing/sign-update-manifest.mjs.
// The strict pattern rejects truncation, padding games, and whitespace tricks
// before Buffer's lenient base64 decoder ever sees the text.
function parseDetachedSignature(signatureText: string): Buffer | undefined {
  if (typeof signatureText !== 'string' || signatureText.length > 512) return undefined
  const firstLine = signatureText.split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (!signatureBase64Pattern.test(firstLine)) return undefined
  const signature = Buffer.from(firstLine, 'base64')
  return signature.byteLength === 64 ? signature : undefined
}

function verifyManifestSignature(
  manifestBytes: Uint8Array,
  signature: Buffer,
  publicKeyHex: string,
): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_DER_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    })
    return verifyDetachedSignature(null, manifestBytes, publicKey, signature)
  } catch {
    return false
  }
}

// Accepts "<64-hex>" optionally followed by whitespace and a filename — the
// `shasum`/`sha256sum` detached format.
function parseDetachedChecksum(checksumText: string): string | undefined {
  if (typeof checksumText !== 'string' || checksumText.length > 512) return undefined
  const firstLine = checksumText.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const digest = firstLine.split(/[ \t]/, 1)[0]?.toLowerCase() ?? ''
  return sha256HexPattern.test(digest) ? digest : undefined
}

function isValidPublishedAt(value: unknown): boolean {
  return typeof value === 'string'
    && value.length <= 64
    && Number.isFinite(Date.parse(value))
}

// The download page must live on an Eido-owned domain: a manifest pointing
// anywhere else is refused before any prompt. The public release repository
// page on github.com was trusted while the feed still redirected there; that
// trust is retired along with the redirect hops, because this check ships
// compiled into every app.
export function isTrustedDownloadPageUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 512) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:'
    || url.port !== ''
    || url.username !== ''
    || url.password !== '') {
    return false
  }
  return url.hostname === 'updates.eido.so' || url.hostname === 'eido.so'
}

function parseArtifact(value: unknown, platform: UpdatePlatform): (UpdateManifestArtifact & {
  readonly updateArtifact?: UpdateArchiveArtifact
}) | undefined {
  if (!isRecord(value)
    || typeof value.artifactName !== 'string'
    || !artifactNamePattern.test(value.artifactName)
    || value.artifactName.includes('..')
    || typeof value.sha256 !== 'string'
    || !sha256HexPattern.test(value.sha256)) {
    return undefined
  }
  let updateArtifact: UpdateArchiveArtifact | undefined
  if ('updateArtifact' in value && value.updateArtifact !== undefined) {
    const candidate = value.updateArtifact
    const bytes = isRecord(candidate) ? candidate.bytes : undefined
    if (platform !== 'darwin-arm64'
      || !isRecord(candidate)
      || typeof candidate.artifactName !== 'string'
      || !artifactNamePattern.test(candidate.artifactName)
      || candidate.artifactName.includes('..')
      || !candidate.artifactName.toLowerCase().endsWith('.zip')
      || typeof candidate.sha256 !== 'string'
      || !sha256HexPattern.test(candidate.sha256)
      || typeof candidate.sha512 !== 'string'
      || !sha512Base64Pattern.test(candidate.sha512)
      || typeof bytes !== 'number'
      || !Number.isSafeInteger(bytes)
      || bytes <= 0) {
      return undefined
    }
    updateArtifact = Object.freeze({
      artifactName: candidate.artifactName,
      sha256: candidate.sha256,
      sha512: candidate.sha512,
      bytes,
    })
  }
  return Object.freeze({
    artifactName: value.artifactName,
    sha256: value.sha256,
    ...(updateArtifact ? { updateArtifact } : {}),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
