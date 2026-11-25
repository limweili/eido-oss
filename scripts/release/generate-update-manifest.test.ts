import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  generateUpdateManifestPayload,
  signUpdateManifest,
  writeUpdateManifestBundle,
} from './generate-update-manifest.mjs'
import { verifyUpdateFeed } from '../../electron/updateFeed'

describe('generate-update-manifest', () => {
  const signer = generateKeyPairSync('ed25519')
  const spki = signer.publicKey.export({ format: 'der', type: 'spki' })
  const publicKeyHex = Buffer.from(spki.subarray(spki.byteLength - 32)).toString('hex')
  const privateKeyPem = signer.privateKey.export({ format: 'pem', type: 'pkcs8' })
  const updateZip = {
    darwinArm64UpdateArtifact: 'Eido-1.2.0-arm64.zip',
    darwinArm64UpdateSha256: 'd'.repeat(64),
    darwinArm64UpdateSha512: Buffer.alloc(64, 4).toString('base64'),
    darwinArm64UpdateBytes: 123_456,
  }

  it('generates valid schema 2 manifest and checksum', () => {
    const payload = generateUpdateManifestPayload({
      version: '1.2.0',
      sourceSha: 'a'.repeat(40),
      publishedAt: '2026-08-19T00:00:00.000Z',
      darwinArm64Artifact: 'Eido-1.2.0-arm64.dmg',
      darwinArm64Sha256: 'b'.repeat(64),
      ...updateZip,
      win32X64Artifact: 'Eido-Setup-1.2.0.exe',
      win32X64Sha256: 'c'.repeat(64),
      blockedVersions: ['1.0.0'],
      minSupportedVersion: '1.1.0',
    })

    expect(payload.manifest.schemaVersion).toBe(2)
    expect(payload.manifest.version).toBe('1.2.0')
    expect(payload.manifest.blockedVersions).toEqual(['1.0.0'])
    expect(payload.manifest.minSupportedVersion).toBe('1.1.0')
    expect(payload.checksumText).toMatch(/^[0-9a-f]{64} {2}eido-update\.json\n$/)
  })

  it('signs manifest with Ed25519 and passes client verification', () => {
    const payload = generateUpdateManifestPayload({
      version: '1.2.0',
      sourceSha: 'a'.repeat(40),
      publishedAt: '2026-08-19T00:00:00.000Z',
      darwinArm64Artifact: 'Eido-1.2.0-arm64.dmg',
      darwinArm64Sha256: 'b'.repeat(64),
      ...updateZip,
      win32X64Artifact: 'Eido-Setup-1.2.0.exe',
      win32X64Sha256: 'c'.repeat(64),
    })

    const sigText = signUpdateManifest(payload.manifestBytes, privateKeyPem)
    expect(sigText).toMatch(/^[A-Za-z0-9+/]{86}==\n$/)

    const verification = verifyUpdateFeed({
      manifestBytes: payload.manifestBytes,
      signatureText: sigText,
      checksumText: payload.checksumText,
      publicKeyHex,
    })

    expect(verification.ok).toBe(true)
    if (verification.ok) {
      expect(verification.manifest.version).toBe('1.2.0')
      expect(verification.manifest.schemaVersion).toBe(2)
    }
  })

  it('refuses recall fields the shipped client would reject, at generation time', () => {
    const base = {
      version: '1.2.0',
      sourceSha: 'a'.repeat(40),
      publishedAt: '2026-08-19T00:00:00.000Z',
      darwinArm64Artifact: 'Eido-1.2.0-arm64.dmg',
      darwinArm64Sha256: 'b'.repeat(64),
      ...updateZip,
      win32X64Artifact: 'Eido-Setup-1.2.0.exe',
      win32X64Sha256: 'c'.repeat(64),
    }

    // One typo in a recall dispatch must fail the release run, not ship a
    // manifest every install rejects at exactly the moment recall matters.
    expect(() => generateUpdateManifestPayload({ ...base, blockedVersions: ['1.1'] }))
      .toThrow(/Invalid blocked version/)
    expect(() => generateUpdateManifestPayload({ ...base, blockedVersions: ['v1.1.0'] }))
      .toThrow(/Invalid blocked version/)
    expect(() => generateUpdateManifestPayload({ ...base, blockedVersions: [' 1.1.0'] }))
      .toThrow(/Invalid blocked version/)
    expect(() => generateUpdateManifestPayload({ ...base, blockedVersions: 'not-an-array' }))
      .toThrow(/must be an array/)
    expect(() => generateUpdateManifestPayload({ ...base, minSupportedVersion: 'not-semver' }))
      .toThrow(/Invalid minSupportedVersion/)
  })

  it('refuses recall fields that are well-formed but self-contradictory', () => {
    const base = {
      version: '1.2.0',
      sourceSha: 'a'.repeat(40),
      publishedAt: '2026-08-19T00:00:00.000Z',
      darwinArm64Artifact: 'Eido-1.2.0-arm64.dmg',
      darwinArm64Sha256: 'b'.repeat(64),
      ...updateZip,
      win32X64Artifact: 'Eido-Setup-1.2.0.exe',
      win32X64Sha256: 'c'.repeat(64),
    }

    // Blocking the very version the feed advertises recalls users the moment
    // they finish updating.
    expect(() => generateUpdateManifestPayload({ ...base, blockedVersions: ['1.2.0'] }))
      .toThrow(/must not include the advertised version/)
    // A support floor above the advertised version leaves no installable release.
    expect(() => generateUpdateManifestPayload({ ...base, minSupportedVersion: '2.0.0' }))
      .toThrow(/above the advertised version/)
  })

  it('refuses a publishedAt implausibly far ahead of the runner clock', () => {
    expect(() => generateUpdateManifestPayload({
      version: '1.2.0',
      sourceSha: 'a'.repeat(40),
      publishedAt: '9999-01-01T00:00:00.000Z',
      darwinArm64Artifact: 'Eido-1.2.0-arm64.dmg',
      darwinArm64Sha256: 'b'.repeat(64),
      ...updateZip,
      win32X64Artifact: 'Eido-Setup-1.2.0.exe',
      win32X64Sha256: 'c'.repeat(64),
    })).toThrow(/implausibly far in the future/)
  })

  it('generates a recall manifest the shipped client verifier accepts end to end', () => {
    const payload = generateUpdateManifestPayload({
      version: '1.2.0',
      sourceSha: 'a'.repeat(40),
      publishedAt: '2026-08-19T00:00:00.000Z',
      darwinArm64Artifact: 'Eido-1.2.0-arm64.dmg',
      darwinArm64Sha256: 'b'.repeat(64),
      ...updateZip,
      win32X64Artifact: 'Eido-Setup-1.2.0.exe',
      win32X64Sha256: 'c'.repeat(64),
      blockedVersions: ['1.0.0', '1.0.1'],
      minSupportedVersion: '1.1.0',
    })
    const sigText = signUpdateManifest(payload.manifestBytes, privateKeyPem)
    const verification = verifyUpdateFeed({
      manifestBytes: payload.manifestBytes,
      signatureText: sigText,
      checksumText: payload.checksumText,
      publicKeyHex,
    })
    expect(verification.ok).toBe(true)
    if (verification.ok) {
      expect(verification.manifest.blockedVersions).toEqual(['1.0.0', '1.0.1'])
      expect(verification.manifest.minSupportedVersion).toBe('1.1.0')
    }
  })

  it('writes manifest bundle to disk', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'eido-manifest-test-'))
    try {
      const result = await writeUpdateManifestBundle({
        version: '1.2.0',
        sourceSha: 'a'.repeat(40),
        publishedAt: '2026-08-19T00:00:00.000Z',
        darwinArm64Artifact: 'Eido-1.2.0-arm64.dmg',
        darwinArm64Sha256: 'b'.repeat(64),
        ...updateZip,
        win32X64Artifact: 'Eido-Setup-1.2.0.exe',
        win32X64Sha256: 'c'.repeat(64),
        privateKey: privateKeyPem,
        outDir: tempDir,
      })

      const manifestContent = await readFile(join(tempDir, 'eido-update.json'), 'utf8')
      const checksumContent = await readFile(join(tempDir, 'eido-update.json.sha256'), 'utf8')
      const sigContent = await readFile(join(tempDir, 'eido-update.json.sig'), 'utf8')
      const latestMacContent = await readFile(join(tempDir, 'latest-mac.yml'), 'utf8')

      expect(JSON.parse(manifestContent).version).toBe('1.2.0')
      expect(checksumContent).toBe(result.checksumText)
      expect(sigContent).toBe(result.signatureText)
      expect(latestMacContent).toContain('url: Eido-1.2.0-arm64.zip')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
