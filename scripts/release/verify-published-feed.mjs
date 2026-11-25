// The last gate: prove older shipped clients will accept the published feed
// (#793, #977, #978, ADR 0032).
//
// A reachability check (three 200s) proves only that something is served. It
// would pass on a manifest signed by the wrong key, a manifest whose checksum
// no longer matches, or last week's release still sitting in the bucket. Every
// one of those is invisible until users stop updating.
//
// This uses the verifier and public key shipped in builds with update checks.
// It verifies the exact bytes served by the live feed for those builds.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { UPDATE_FEED_PUBLIC_KEY_HEX } from '../../electron/updateFeedPublicKey.ts'
import { verifyUpdateFeed } from '../../electron/updateFeed.ts'

export class PublishedFeedError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code)
    this.code = code
  }
}

/**
 * Verify a downloaded copy of the live feed exactly as a shipped client would.
 *
 * @returns {Promise<{version: string, downloadPageUrl: string, platforms: string[]}>}
 */
export async function verifyPublishedFeed({
  directory,
  expectedVersion,
  publicKeyHex = UPDATE_FEED_PUBLIC_KEY_HEX,
  readFileImpl = readFile,
}) {
  if (!/^[0-9a-f]{64}$/.test(publicKeyHex)) {
    throw new PublishedFeedError(
      'compiled-public-key-unprovisioned',
      'the app has no compiled update feed public key, so no published feed could be trusted',
    )
  }

  let manifestBytes
  let signatureText
  let checksumText
  try {
    manifestBytes = new Uint8Array(await readFileImpl(resolve(directory, 'eido-update.json')))
    signatureText = await readFileImpl(resolve(directory, 'eido-update.json.sig'), 'utf8')
    checksumText = await readFileImpl(resolve(directory, 'eido-update.json.sha256'), 'utf8')
  } catch (error) {
    throw new PublishedFeedError(
      'published-feed-unreadable',
      error instanceof Error ? error.message : 'unknown',
    )
  }

  const verification = verifyUpdateFeed({
    manifestBytes,
    signatureText,
    checksumText,
    publicKeyHex,
  })

  if (!verification.ok) {
    throw new PublishedFeedError('published-feed-refused', `a shipped client would reject this feed (${verification.reason})`)
  }

  const manifest = verification.manifest
  if (expectedVersion !== undefined && manifest.version !== expectedVersion) {
    throw new PublishedFeedError(
      'published-feed-version-mismatch',
      `the live feed offers ${manifest.version}, not the ${expectedVersion} just published`,
    )
  }

  return Object.freeze({
    version: manifest.version,
    downloadPageUrl: manifest.downloadPageUrl,
    platforms: Object.keys(manifest.platforms ?? {}),
  })
}

export async function runVerifyPublishedFeedCli(argv, { stdout = process.stdout } = {}) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new PublishedFeedError('argument-invalid', token)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      throw new PublishedFeedError('argument-value-missing', token)
    }
    flags[token] = next
    index += 1
  }

  const result = await verifyPublishedFeed({
    directory: resolve(flags['--dir'] ?? '.'),
    expectedVersion: flags['--version'],
  })

  stdout.write(`A shipped client accepts the live feed: ${result.version} for ${result.platforms.join(', ')}.\n`)
  stdout.write(`Download page: ${result.downloadPageUrl}\n`)
  return result
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runVerifyPublishedFeedCli(process.argv.slice(2))
  } catch (error) {
    const code = error instanceof PublishedFeedError ? error.code : 'published-feed-verification-failed'
    process.stderr.write(`The published update feed did not verify (${code}).\n`)
    if (error instanceof PublishedFeedError && error.message !== code) {
      process.stderr.write(`${error.message}\n`)
    }
    process.exitCode = 1
  }
}
