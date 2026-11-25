import { execFile } from 'node:child_process'
import {
  createHash,
  generateKeyPairSync,
  sign as signDetached,
  type KeyObject,
} from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import {
  compareUpdateVersions,
  isTrustedDownloadPageUrl,
  UPDATE_FEED_SCHEMA_VERSION,
  verifyUpdateFeed,
} from './updateFeed'
import { UPDATE_FEED_PUBLIC_KEY_HEX } from './updateFeedPublicKey'

const RELEASE_REPOSITORY = 'limweili/eido-releases'

// Test-only Ed25519 keys, generated fresh per run, never persisted, never a
// stand-in for the real ceremony key (which does not exist in this repo).
const signer = generateKeyPairSync('ed25519')
const otherSigner = generateKeyPairSync('ed25519')

function rawPublicKeyHex(publicKey: KeyObject): string {
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  return Buffer.from(spki.subarray(spki.byteLength - 32)).toString('hex')
}

const PUBLIC_KEY_HEX = rawPublicKeyHex(signer.publicKey)

function manifestDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: UPDATE_FEED_SCHEMA_VERSION,
    version: '1.2.0',
    sourceSha: 'a'.repeat(40),
    publishedAt: '2026-07-22T00:00:00Z',
    downloadPageUrl: 'https://eido.so/download',
    platforms: {
      'darwin-arm64': { artifactName: 'Eido-1.2.0-arm64.dmg', sha256: 'b'.repeat(64) },
      'win32-x64': { artifactName: 'Eido-Setup-1.2.0.exe', sha256: 'c'.repeat(64) },
    },
    ...overrides,
  }
}

function signatureLineOver(bytes: Uint8Array, key: KeyObject = signer.privateKey): string {
  return `${signDetached(null, bytes, key).toString('base64')}\n`
}

// A fully consistent feed: signature and checksum both over the exact
// manifest bytes, signed by the trusted test key.
function feedFor(document: Record<string, unknown>): {
  manifestBytes: Uint8Array
  signatureText: string
  checksumText: string
} {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(document))
  const digest = createHash('sha256').update(manifestBytes).digest('hex')
  return {
    manifestBytes,
    signatureText: signatureLineOver(manifestBytes),
    checksumText: `${digest}  eido-update.json\n`,
  }
}

function verifyWithTestKey(feed: {
  manifestBytes: Uint8Array
  signatureText: string
  checksumText: string
}) {
  return verifyUpdateFeed({ ...feed, publicKeyHex: PUBLIC_KEY_HEX })
}

describe('update feed signature verification', () => {
  it('accepts a manifest whose detached signature verifies under the trusted key', () => {
    const verification = verifyWithTestKey(feedFor(manifestDocument()))
    expect(verification.ok).toBe(true)
    if (!verification.ok) return
    expect(verification.manifest.version).toBe('1.2.0')
    expect(verification.manifest.platforms['darwin-arm64'].artifactName).toBe('Eido-1.2.0-arm64.dmg')
    expect(verification.manifest.platforms['win32-x64'].sha256).toBe('c'.repeat(64))
  })

  it('accepts valid blockedVersions and minSupportedVersion inside the signed payload', () => {
    const verification = verifyWithTestKey(feedFor(manifestDocument({
      blockedVersions: ['1.1.0', '1.1.1'],
      minSupportedVersion: '1.0.0',
      manifestExpiresAt: '2027-01-01T00:00:00Z',
    })))
    expect(verification.ok).toBe(true)
    if (!verification.ok) return
    expect(verification.manifest.blockedVersions).toEqual(['1.1.0', '1.1.1'])
    expect(verification.manifest.minSupportedVersion).toBe('1.0.0')
  })

  it('rejects malformed blockedVersions or minSupportedVersion', () => {
    const invalidManifests = [
      manifestDocument({ blockedVersions: '1.1.0' }),
      manifestDocument({ blockedVersions: ['not-semver'] }),
      manifestDocument({ blockedVersions: [123] }),
      manifestDocument({ minSupportedVersion: 'not-semver' }),
      manifestDocument({ minSupportedVersion: 100 }),
    ]
    for (const doc of invalidManifests) {
      expect(verifyWithTestKey(feedFor(doc))).toEqual({ ok: false, reason: 'malformed-metadata' })
    }
  })

  it('fails closed on an absent signature', () => {
    const feed = feedFor(manifestDocument())
    expect(verifyWithTestKey({ ...feed, signatureText: '' }))
      .toEqual({ ok: false, reason: 'signature-invalid' })
  })

  it('fails closed on malformed signature encodings', () => {
    const feed = feedFor(manifestDocument())
    const validLine = feed.signatureText.trim()
    const malformed = [
      'not a signature at all',
      'zz'.repeat(64),
      Buffer.from(validLine, 'base64').toString('hex'), // right bytes, wrong encoding
      `${validLine.slice(0, 40)} ${validLine.slice(40)}`, // interior whitespace
      Buffer.alloc(63).toString('base64'), // one byte short of an Ed25519 signature
      Buffer.alloc(80).toString('base64'), // too long
      `${'A'.repeat(1024)}==`, // oversized text
    ]
    for (const signatureText of malformed) {
      expect(verifyWithTestKey({ ...feed, signatureText }))
        .toEqual({ ok: false, reason: 'signature-invalid' })
    }
  })

  it('fails closed on a truncated signature', () => {
    const feed = feedFor(manifestDocument())
    const truncated = feed.signatureText.trim().slice(0, 60)
    expect(verifyWithTestKey({ ...feed, signatureText: truncated }))
      .toEqual({ ok: false, reason: 'signature-invalid' })
  })

  it('fails closed on a signature made over different bytes', () => {
    const feed = feedFor(manifestDocument())
    const otherBytes = new TextEncoder().encode(JSON.stringify(manifestDocument({ version: '9.9.9' })))
    expect(verifyWithTestKey({ ...feed, signatureText: signatureLineOver(otherBytes) }))
      .toEqual({ ok: false, reason: 'signature-mismatch' })
  })

  it('fails closed on a signature by a different key, even over the exact bytes', () => {
    const feed = feedFor(manifestDocument())
    expect(verifyWithTestKey({
      ...feed,
      signatureText: signatureLineOver(feed.manifestBytes, otherSigner.privateKey),
    })).toEqual({ ok: false, reason: 'signature-mismatch' })
  })

  it('fails closed when one manifest byte changes after signing, even with a freshly matching checksum', () => {
    const feed = feedFor(manifestDocument())
    const tampered = Uint8Array.from(feed.manifestBytes)
    const flipAt = tampered.indexOf('1'.charCodeAt(0))
    tampered[flipAt] = '2'.charCodeAt(0)
    // The attacker can recompute the adjacent checksum; only the signature
    // stands between the tampered bytes and a prompt.
    const recomputedChecksum = `${createHash('sha256').update(tampered).digest('hex')}  eido-update.json\n`
    expect(verifyWithTestKey({
      manifestBytes: tampered,
      signatureText: feed.signatureText,
      checksumText: recomputedChecksum,
    })).toEqual({ ok: false, reason: 'signature-mismatch' })
  })

  it('fails closed when public key is empty or invalid: no manifest verifies', () => {
    // Fail-closed is proven with an INJECTED key so this case survives the key
    // ceremony. Asserting the compiled constant is empty would have turned the
    // ceremony's own PR red; that shape assertion lives in its own test below,
    // and is strict now that the ceremony has provisioned the real key.
    const feed = feedFor(manifestDocument())
    expect(verifyUpdateFeed({ ...feed, publicKeyHex: '' }))
      .toEqual({ ok: false, reason: 'signature-invalid' })
    expect(verifyUpdateFeed({ ...feed, publicKeyHex: 'not-hex' }))
      .toEqual({ ok: false, reason: 'signature-invalid' })
  })

  it('compiles a valid 64-character lowercase hex public key into the app', () => {
    expect(UPDATE_FEED_PUBLIC_KEY_HEX).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('update feed verification', () => {
  it('fails closed on tampered manifest bytes whose checksum was not recomputed', () => {
    const feed = feedFor(manifestDocument())
    const tampered = new TextEncoder().encode(
      JSON.stringify(manifestDocument({ version: '9.9.9' })),
    )
    // Even re-signed bytes must still match the published checksum.
    expect(verifyWithTestKey({
      manifestBytes: tampered,
      signatureText: signatureLineOver(tampered),
      checksumText: feed.checksumText,
    })).toEqual({ ok: false, reason: 'checksum-mismatch' })
  })

  it('fails closed on an unverifiable checksum document', () => {
    const feed = feedFor(manifestDocument())
    for (const checksumText of ['', 'not-a-digest', 'zz'.repeat(32), '1234']) {
      expect(verifyWithTestKey({ ...feed, checksumText }))
        .toEqual({ ok: false, reason: 'checksum-invalid' })
    }
  })

  it('fails closed on malformed metadata even when signature and checksum verify', () => {
    const malformedDocuments = [
      manifestDocument({ schemaVersion: 1 }), // the retired unsigned schema
      manifestDocument({ schemaVersion: 3 }),
      manifestDocument({ version: '0.0.0' }),
      manifestDocument({ version: 'not-semver' }),
      manifestDocument({ sourceSha: 'short' }),
      manifestDocument({ publishedAt: 'whenever' }),
      manifestDocument({ downloadPageUrl: 'https://evil.example/download' }),
      manifestDocument({ downloadPageUrl: 'http://eido.so/download' }),
      // The public release repository page was trusted while the feed
      // redirected through GitHub; that trust is retired with the hops.
      manifestDocument({ downloadPageUrl: `https://github.com/${RELEASE_REPOSITORY}/releases/tag/v1.2.0` }),
      manifestDocument({ downloadPageUrl: 'https://github.com/limweili/other-repo/releases' }),
      manifestDocument({ platforms: {} }),
      manifestDocument({
        platforms: {
          'darwin-arm64': { artifactName: 'Eido.dmg', sha256: 'b'.repeat(64) },
        },
      }),
      manifestDocument({
        platforms: {
          'darwin-arm64': { artifactName: '../escape.dmg', sha256: 'b'.repeat(64) },
          'win32-x64': { artifactName: 'Eido.exe', sha256: 'c'.repeat(64) },
        },
      }),
      manifestDocument({
        platforms: {
          'darwin-arm64': { artifactName: 'Eido.dmg', sha256: 'not-hex' },
          'win32-x64': { artifactName: 'Eido.exe', sha256: 'c'.repeat(64) },
        },
      }),
    ]
    for (const document of malformedDocuments) {
      expect(verifyWithTestKey(feedFor(document)))
        .toEqual({ ok: false, reason: 'malformed-metadata' })
    }
  })

  it('fails closed on bytes that are not JSON at all', () => {
    const manifestBytes = new TextEncoder().encode('<!doctype html><html></html>')
    const digest = createHash('sha256').update(manifestBytes).digest('hex')
    expect(verifyWithTestKey({
      manifestBytes,
      signatureText: signatureLineOver(manifestBytes),
      checksumText: digest,
    })).toEqual({ ok: false, reason: 'malformed-metadata' })
  })
})

// The signing tool is the other half of this trust boundary: what it writes
// to disk must verify under the app's own verifier, or a release would ship a
// feed every installed app silently refuses.
describe('release signing tool compatibility', () => {
  const execFileAsync = promisify(execFile)
  const toolPath = fileURLToPath(new URL('../scripts/release-signing/sign-update-manifest.mjs', import.meta.url))
  const cleanups: string[] = []

  afterAll(async () => {
    await Promise.all(cleanups.map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function stageManifest(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'eido-update-signing-'))
    cleanups.push(dir)
    const manifestPath = path.join(dir, 'eido-update.json')
    await writeFile(manifestPath, JSON.stringify(manifestDocument()), 'utf8')
    return manifestPath
  }

  const privateKeyPem = signer.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

  it('signs a manifest file the app verifier accepts, and self-verifies', async () => {
    const manifestPath = await stageManifest()
    const { stdout } = await execFileAsync(process.execPath, [toolPath, manifestPath], {
      env: { ...process.env, EIDO_UPDATE_MANIFEST_SIGNING_KEY: privateKeyPem },
    })
    expect(stdout).toContain('self-verification: ok')
    expect(stdout).toContain(`public-key-hex: ${PUBLIC_KEY_HEX}`)

    const manifestBytes = await readFile(manifestPath)
    const signatureText = await readFile(`${manifestPath}.sig`, 'utf8')
    const digest = createHash('sha256').update(manifestBytes).digest('hex')
    const verification = verifyUpdateFeed({
      manifestBytes,
      signatureText,
      checksumText: `${digest}  eido-update.json\n`,
      publicKeyHex: PUBLIC_KEY_HEX,
    })
    expect(verification.ok).toBe(true)
  })

  it('refuses to run without the key in the environment, and accepts no key path argument', async () => {
    const manifestPath = await stageManifest()
    await expect(execFileAsync(process.execPath, [toolPath, manifestPath], {
      env: { ...process.env, EIDO_UPDATE_MANIFEST_SIGNING_KEY: '' },
    })).rejects.toMatchObject({ code: 1 })
    await expect(execFileAsync(process.execPath, [toolPath, manifestPath, '/tmp/some-key.pem'], {
      env: { ...process.env, EIDO_UPDATE_MANIFEST_SIGNING_KEY: privateKeyPem },
    })).rejects.toMatchObject({ code: 1 })
  })

  it('fails the run when the key does not match the expected compiled public key', async () => {
    const manifestPath = await stageManifest()
    await expect(execFileAsync(process.execPath, [toolPath, manifestPath], {
      env: {
        ...process.env,
        EIDO_UPDATE_MANIFEST_SIGNING_KEY: privateKeyPem,
        EIDO_UPDATE_MANIFEST_PUBLIC_KEY_HEX: rawPublicKeyHex(otherSigner.publicKey),
      },
    })).rejects.toMatchObject({ code: 1 })
  })
})

describe('update version comparison', () => {
  it('accepts only strict upgrades', () => {
    expect(compareUpdateVersions('1.2.0', '1.2.1')).toBe('upgrade')
    expect(compareUpdateVersions('1.2.0', '2.0.0')).toBe('upgrade')
    expect(compareUpdateVersions('1.2.0-beta.1', '1.2.0')).toBe('upgrade')
    expect(compareUpdateVersions('1.2.0-beta.1', '1.2.0-beta.2')).toBe('upgrade')
  })

  it('refuses equal versions and explicit downgrades even if the feed regresses', () => {
    expect(compareUpdateVersions('1.2.0', '1.2.0')).toBe('same')
    expect(compareUpdateVersions('1.2.0+build.5', '1.2.0')).toBe('same')
    expect(compareUpdateVersions('1.2.0', '1.1.9')).toBe('downgrade')
    expect(compareUpdateVersions('2.0.0', '1.9.9')).toBe('downgrade')
    expect(compareUpdateVersions('1.2.0', '1.2.0-rc.1')).toBe('downgrade')
  })

  it('refuses versions it cannot reason about', () => {
    expect(compareUpdateVersions('1.2.0', 'latest')).toBe('invalid')
    expect(compareUpdateVersions('', '1.2.1')).toBe('invalid')
    expect(compareUpdateVersions('1.2.0', '0.0.0')).toBe('invalid')
  })
})

describe('download page trust', () => {
  it('trusts https URLs only on the owned hostnames updates.eido.so and eido.so', () => {
    expect(isTrustedDownloadPageUrl('https://updates.eido.so')).toBe(true)
    expect(isTrustedDownloadPageUrl('https://updates.eido.so/releases/v1.2.0')).toBe(true)
    expect(isTrustedDownloadPageUrl('https://eido.so')).toBe(true)
    expect(isTrustedDownloadPageUrl('https://eido.so/download')).toBe(true)
    expect(isTrustedDownloadPageUrl('http://updates.eido.so')).toBe(false)
    expect(isTrustedDownloadPageUrl('https://updates.eido.so:8443/')).toBe(false)
    expect(isTrustedDownloadPageUrl('https://user:pw@updates.eido.so/')).toBe(false)
    // GitHub trust is retired now that the feed serves bytes directly.
    expect(isTrustedDownloadPageUrl(`https://github.com/${RELEASE_REPOSITORY}/releases/tag/v1.0.0`)).toBe(false)
    expect(isTrustedDownloadPageUrl(`https://github.com/${RELEASE_REPOSITORY}`)).toBe(false)
    expect(isTrustedDownloadPageUrl('https://evil.example/download')).toBe(false)
    expect(isTrustedDownloadPageUrl(42)).toBe(false)
  })
})
