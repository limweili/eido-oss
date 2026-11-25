import { createHash, createPrivateKey, sign } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The client's own rules, not a local approximation: a manifest the shipped
// verifier would refuse must fail HERE, at generation, where a human is still
// watching: the client's response to any malformed field is to reject the
// whole feed for every install, at exactly the moment a recall matters.
import { compareUpdateVersions, isValidUpdateVersion } from '../../electron/updateVersion.ts'

export const UPDATE_FEED_SCHEMA_VERSION = 2

// Older clients refuse a manifest dated more than seven days ahead.
const UPDATE_FRESHNESS_MAX_FUTURE_SKEW_MS = 7 * 24 * 60 * 60 * 1000
const sha256HexPattern = /^[0-9a-f]{64}$/
const sha512Base64Pattern = /^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/
const fullGitShaPattern = /^[0-9a-f]{40}$/
const ED25519_PKCS8_DER_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parsePrivateKey(rawKey) {
  if (typeof rawKey !== 'string' && !Buffer.isBuffer(rawKey)) {
    throw new Error('Signing key must be a string or Buffer.')
  }
  const keyString = typeof rawKey === 'string' ? rawKey.trim() : rawKey.toString('utf8').trim()
  if (keyString.includes('-----BEGIN PRIVATE KEY-----')) {
    return createPrivateKey(keyString)
  }
  // Try 64-char hex (32-byte raw seed)
  if (/^[0-9a-fA-F]{64}$/.test(keyString)) {
    const rawSeed = Buffer.from(keyString, 'hex')
    return createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_DER_PREFIX, rawSeed]),
      format: 'der',
      type: 'pkcs8',
    })
  }
  // Try base64 encoded raw seed (44 chars) or base64 PKCS#8
  try {
    const buf = Buffer.from(keyString, 'base64')
    if (buf.length === 32) {
      return createPrivateKey({
        key: Buffer.concat([ED25519_PKCS8_DER_PREFIX, buf]),
        format: 'der',
        type: 'pkcs8',
      })
    }
    return createPrivateKey({ key: buf, format: 'der', type: 'pkcs8' })
  } catch (error) {
    throw new Error(`Failed to parse Ed25519 private key: ${error instanceof Error ? error.message : 'invalid format'}`)
  }
}

export function generateUpdateManifestPayload(options) {
  if (!isRecord(options)) {
    throw new Error('Options must be an object.')
  }
  const {
    version,
    sourceSha,
    publishedAt = new Date().toISOString(),
    // Where a human is sent, not where the bytes live. updates.eido.so is the
    // object store behind the feed; a notify-only client that opened it would
    // land on a raw bucket listing. The download page is the marketing site.
    downloadPageUrl = 'https://eido.so',
    darwinArm64Artifact,
    darwinArm64Sha256,
    darwinArm64UpdateArtifact,
    darwinArm64UpdateSha256,
    darwinArm64UpdateSha512,
    darwinArm64UpdateBytes,
    win32X64Artifact,
    win32X64Sha256,
    blockedVersions,
    minSupportedVersion,
  } = options

  if (!isValidUpdateVersion(version)) {
    throw new Error(`Invalid version: ${version}`)
  }
  if (!sourceSha || !fullGitShaPattern.test(sourceSha)) {
    throw new Error(`Invalid source SHA: ${sourceSha}`)
  }
  if (!publishedAt || typeof publishedAt !== 'string' || publishedAt.length > 64
    || !Number.isFinite(Date.parse(publishedAt))) {
    throw new Error(`Invalid publishedAt timestamp: ${publishedAt}`)
  }
  // The client refuses (and would otherwise record) timestamps implausibly far
  // ahead of local time; a manifest generated from a faulty runner clock must
  // fail the release instead of shipping a feed every device rejects.
  if (Date.parse(publishedAt) > Date.now() + UPDATE_FRESHNESS_MAX_FUTURE_SKEW_MS) {
    throw new Error(`publishedAt is implausibly far in the future: ${publishedAt}`)
  }

  if (blockedVersions !== undefined) {
    if (!Array.isArray(blockedVersions)) {
      throw new Error('blockedVersions must be an array of versions.')
    }
    for (const blocked of blockedVersions) {
      if (!isValidUpdateVersion(blocked)) {
        // One typo in a recall dispatch input must not make the feed inert
        // for every install: the client rejects the whole manifest on a
        // single malformed entry.
        throw new Error(`Invalid blocked version: ${blocked}`)
      }
    }
    if (blockedVersions.includes(version)) {
      throw new Error(`blockedVersions must not include the advertised version ${version}`)
    }
  }
  if (minSupportedVersion !== undefined) {
    if (!isValidUpdateVersion(minSupportedVersion)) {
      throw new Error(`Invalid minSupportedVersion: ${minSupportedVersion}`)
    }
    if (compareUpdateVersions(minSupportedVersion, version) === 'downgrade') {
      throw new Error(
        `minSupportedVersion ${minSupportedVersion} is above the advertised version ${version}`,
      )
    }
  }
  // Same artifact-name shape the client enforces (electron/updateFeed.ts).
  const artifactNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/
  const isValidArtifactName = (name) => typeof name === 'string'
    && artifactNamePattern.test(name)
    && !name.includes('..')
  if (!isValidArtifactName(darwinArm64Artifact) || !darwinArm64Sha256 || !sha256HexPattern.test(darwinArm64Sha256)) {
    throw new Error('Invalid darwin-arm64 artifact or SHA256.')
  }
  if (!isValidArtifactName(darwinArm64UpdateArtifact)
    || !sha256HexPattern.test(darwinArm64UpdateSha256 ?? '')
    || !sha512Base64Pattern.test(darwinArm64UpdateSha512 ?? '')
    || !Number.isSafeInteger(darwinArm64UpdateBytes)
    || darwinArm64UpdateBytes <= 0) {
    throw new Error('Invalid darwin-arm64 update ZIP identity.')
  }
  if (!isValidArtifactName(win32X64Artifact) || !win32X64Sha256 || !sha256HexPattern.test(win32X64Sha256)) {
    throw new Error('Invalid win32-x64 artifact or SHA256.')
  }

  const manifest = {
    schemaVersion: UPDATE_FEED_SCHEMA_VERSION,
    version,
    sourceSha,
    publishedAt,
    downloadPageUrl,
    ...(Array.isArray(blockedVersions) && blockedVersions.length > 0 ? { blockedVersions } : {}),
    ...(minSupportedVersion ? { minSupportedVersion } : {}),
    platforms: {
      'darwin-arm64': {
        artifactName: darwinArm64Artifact,
        sha256: darwinArm64Sha256,
        updateArtifact: {
          artifactName: darwinArm64UpdateArtifact,
          sha256: darwinArm64UpdateSha256,
          sha512: darwinArm64UpdateSha512,
          bytes: darwinArm64UpdateBytes,
        },
      },
      'win32-x64': {
        artifactName: win32X64Artifact,
        sha256: win32X64Sha256,
      },
    },
  }

  const manifestJson = JSON.stringify(manifest, null, 2) + '\n'
  const manifestBytes = Buffer.from(manifestJson, 'utf8')
  const sha256 = createHash('sha256').update(manifestBytes).digest('hex')
  const checksumText = `${sha256}  eido-update.json\n`
  const latestMacYaml = [
    `version: ${version}`,
    'files:',
    `  - url: ${darwinArm64UpdateArtifact}`,
    `    sha512: ${darwinArm64UpdateSha512}`,
    `    size: ${darwinArm64UpdateBytes}`,
    `path: ${darwinArm64UpdateArtifact}`,
    `sha512: ${darwinArm64UpdateSha512}`,
    `releaseDate: '${publishedAt}'`,
    '',
  ].join('\n')

  return {
    manifest,
    manifestJson,
    manifestBytes,
    sha256,
    checksumText,
    latestMacYaml,
  }
}

export function signUpdateManifest(manifestBytes, privateKeyInput) {
  const privateKey = privateKeyInput instanceof Object && 'type' in privateKeyInput
    ? privateKeyInput
    : parsePrivateKey(privateKeyInput)
  const signature = sign(null, manifestBytes, privateKey).toString('base64')
  return `${signature}\n`
}

export async function writeUpdateManifestBundle(options) {
  const { outDir, privateKey, ...manifestOptions } = options
  const generated = generateUpdateManifestPayload(manifestOptions)
  const signatureText = privateKey ? signUpdateManifest(generated.manifestBytes, privateKey) : undefined

  if (outDir) {
    await mkdir(outDir, { recursive: true })
    await writeFile(resolve(outDir, 'eido-update.json'), generated.manifestBytes)
    await writeFile(resolve(outDir, 'eido-update.json.sha256'), generated.checksumText, 'utf8')
    await writeFile(resolve(outDir, 'latest-mac.yml'), generated.latestMacYaml, 'utf8')
    if (signatureText) {
      await writeFile(resolve(outDir, 'eido-update.json.sig'), signatureText, 'utf8')
    }
  }

  return {
    ...generated,
    signatureText,
  }
}

function parseCliFlags(args) {
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    }
  }
  return flags
}

export async function runCli(argv = process.argv.slice(2)) {
  const flags = parseCliFlags(argv)
  if (flags['--help'] || flags['-h']) {
    console.log(`Usage: node generate-update-manifest.mjs [options]
  --version <semver>
  --source-sha <40-hex>
  --published-at <iso-timestamp>
  --download-page-url <url>
  --darwin-arm64-artifact <name>
  --darwin-arm64-sha256 <hex>
  --darwin-arm64-update-artifact <name>
  --darwin-arm64-update-sha256 <hex>
  --darwin-arm64-update-sha512 <base64>
  --darwin-arm64-update-bytes <integer>
  --win32-x64-artifact <name>
  --win32-x64-sha256 <hex>
  --blocked-versions <v1,v2>
  --min-supported-version <semver>
  --key <key-or-hex>
  --key-env <env-var-name>
  --out-dir <path>`)
    return 0
  }

  const keyEnv = flags['--key-env']
  const key = flags['--key'] ?? (keyEnv ? process.env[keyEnv] : undefined)
  const blockedRaw = flags['--blocked-versions']
  const blockedVersions = blockedRaw ? blockedRaw.split(',').map((v) => v.trim()).filter(Boolean) : undefined

  try {
    const result = await writeUpdateManifestBundle({
      version: flags['--version'],
      sourceSha: flags['--source-sha'],
      publishedAt: flags['--published-at'],
      downloadPageUrl: flags['--download-page-url'],
      darwinArm64Artifact: flags['--darwin-arm64-artifact'],
      darwinArm64Sha256: flags['--darwin-arm64-sha256'],
      darwinArm64UpdateArtifact: flags['--darwin-arm64-update-artifact'],
      darwinArm64UpdateSha256: flags['--darwin-arm64-update-sha256'],
      darwinArm64UpdateSha512: flags['--darwin-arm64-update-sha512'],
      darwinArm64UpdateBytes: Number(flags['--darwin-arm64-update-bytes']),
      win32X64Artifact: flags['--win32-x64-artifact'],
      win32X64Sha256: flags['--win32-x64-sha256'],
      blockedVersions,
      minSupportedVersion: flags['--min-supported-version'],
      privateKey: key,
      outDir: flags['--out-dir'],
    })

    if (!flags['--out-dir']) {
      process.stdout.write(result.manifestJson)
      if (result.signatureText) {
        process.stderr.write(`Signature:\n${result.signatureText}`)
      }
    }
    return 0
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli().then((code) => {
    if (code !== 0) process.exit(code)
  })
}
