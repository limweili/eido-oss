import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createUpdateFeedFetcher,
  isAllowedUpdateFeedRequestUrl,
  UPDATE_FEED_MAX_BYTES,
  UPDATE_FEED_ORIGIN,
  UPDATE_RELEASE_REPOSITORY,
  updateFeedAssetUrl,
} from './updateEndpoints'

describe('update feed endpoints', () => {
  it('matches the landed public release repository policy identity', () => {
    const policy = JSON.parse(readFileSync(
      resolve(import.meta.dirname, '..', 'release', 'public-repository', 'policy.json'),
      'utf8',
    )) as { repository: { fullName: string } }
    expect(UPDATE_RELEASE_REPOSITORY).toBe(policy.repository.fullName)
  })

  it('asks the Eido-owned feed hostname, never a hosting provider URL', () => {
    expect(UPDATE_FEED_ORIGIN).toBe('https://updates.eido.so')
    expect(updateFeedAssetUrl('eido-update.json')).toBe(
      'https://updates.eido.so/eido-update.json',
    )
    expect(updateFeedAssetUrl('eido-update.json')).not.toContain('github.com')
  })

  it('refuses hostile asset names and any origin but the feed hostname', () => {
    expect(() => updateFeedAssetUrl('../secrets')).toThrow()
    expect(() => updateFeedAssetUrl('a/b')).toThrow()
    expect(() => updateFeedAssetUrl('eido-update.json', 'https://evil.example')).toThrow()
    expect(() => updateFeedAssetUrl('eido-update.json', 'http://updates.eido.so')).toThrow()
    expect(() => updateFeedAssetUrl('eido-update.json', `${UPDATE_FEED_ORIGIN}/`)).toThrow()
  })

  it('allows the feed hostname at a single asset path and refuses anything deeper', () => {
    expect(isAllowedUpdateFeedRequestUrl('https://updates.eido.so/eido-update.json')).toBe(true)
    expect(isAllowedUpdateFeedRequestUrl('https://updates.eido.so/eido-update.json.sha256')).toBe(true)
    expect(isAllowedUpdateFeedRequestUrl('https://updates.eido.so/a/b')).toBe(false)
    // Traversal cannot escape the feed host: the URL parser normalises it
    // back to a single path on the same hostname before we ever see it.
    expect(new URL('https://updates.eido.so/../secrets').toString())
      .toBe('https://updates.eido.so/secrets')
    expect(isAllowedUpdateFeedRequestUrl('https://updates.eido.so/')).toBe(false)
    expect(isAllowedUpdateFeedRequestUrl('http://updates.eido.so/eido-update.json')).toBe(false)
    expect(isAllowedUpdateFeedRequestUrl('https://updates.eido.so:8443/eido-update.json')).toBe(false)
    // A neighbouring Eido hostname is not the feed.
    expect(isAllowedUpdateFeedRequestUrl('https://eido.so/eido-update.json')).toBe(false)
    expect(isAllowedUpdateFeedRequestUrl('https://evil.updates.eido.so/eido-update.json')).toBe(false)
  })

  it('no longer trusts the GitHub hops: the feed hostname serves the bytes itself', () => {
    // These were allowed while updates.eido.so redirected through GitHub.
    // The binding is direct now, and an allowlist compiled into every
    // shipped app is trust that cannot be recalled, so they are retired.
    expect(isAllowedUpdateFeedRequestUrl(
      `https://github.com/${UPDATE_RELEASE_REPOSITORY}/releases/latest/download/eido-update.json`,
    )).toBe(false)
    expect(isAllowedUpdateFeedRequestUrl(
      `https://github.com/${UPDATE_RELEASE_REPOSITORY}/releases/download/v1.0.0/eido-update.json`,
    )).toBe(false)
    expect(isAllowedUpdateFeedRequestUrl('https://objects.githubusercontent.com/anything')).toBe(false)
    expect(isAllowedUpdateFeedRequestUrl('https://release-assets.githubusercontent.com/anything')).toBe(false)
    expect(isAllowedUpdateFeedRequestUrl('https://raw.githubusercontent.com/x')).toBe(false)
    expect(isAllowedUpdateFeedRequestUrl('https://evil.example/x')).toBe(false)
    expect(isAllowedUpdateFeedRequestUrl('not a url')).toBe(false)
  })
})

describe('update feed fetcher', () => {
  it('returns bytes for an ok response from an allowed host', async () => {
    const fetchAsset = createUpdateFeedFetcher({
      fetchImpl: (async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
      })) as typeof fetch,
    })
    const result = await fetchAsset('eido-update.json')
    expect(result.ok).toBe(true)
    if (result.ok) expect([...result.bytes]).toEqual([1, 2, 3])
  })

  it('reports bytes as they arrive, with the length the server declared', async () => {
    const chunks = [new Uint8Array(40_000), new Uint8Array(60_000), new Uint8Array(60_000)]
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    const fetchAsset = createUpdateFeedFetcher({
      fetchImpl: (async () => new Response(body, {
        status: 200,
        headers: { 'content-length': String(total) },
      })) as typeof fetch,
    })

    const seen: Array<readonly [number, number | undefined]> = []
    const result = await fetchAsset('Eido-1.0.0-arm64.dmg', (received, declared) => {
      seen.push([received, declared])
    })

    expect(result.ok).toBe(true)
    // A 160 MB download with no readout is indistinguishable from a hang, so
    // the running total has to arrive while the body is still arriving.
    expect(seen).toEqual([
      [40_000, total],
      [100_000, total],
      [160_000, total],
    ])
  })

  it('reports what arrived even when the server declared no length', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1_024))
        controller.close()
      },
    })
    const fetchAsset = createUpdateFeedFetcher({
      fetchImpl: (async () => new Response(body, { status: 200 })) as typeof fetch,
    })

    const seen: Array<readonly [number, number | undefined]> = []
    await fetchAsset('Eido-1.0.0-arm64.dmg', (received, declared) => {
      seen.push([received, declared])
    })

    // No proportion is invented from a length nobody sent.
    expect(seen).toEqual([[1_024, undefined]])
  })

  it('never lets a progress listener break the download', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([7, 7, 7]))
        controller.close()
      },
    })
    const fetchAsset = createUpdateFeedFetcher({
      fetchImpl: (async () => new Response(body, { status: 200 })) as typeof fetch,
    })

    const result = await fetchAsset('Eido-1.0.0-arm64.dmg', () => {
      throw new Error('the surface fell over')
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect([...result.bytes]).toEqual([7, 7, 7])
  })

  it('refuses a redirect onto the retired GitHub chain BEFORE contacting it', async () => {
    const requested: string[] = []
    const fetchAsset = createUpdateFeedFetcher({
      fetchImpl: (async (url: string) => {
        requested.push(url)
        return new Response(null, {
          status: 302,
          headers: {
            location: `https://github.com/${UPDATE_RELEASE_REPOSITORY}/releases/download/v1.0.0/eido-update.json`,
          },
        })
      }) as typeof fetch,
    })
    expect((await fetchAsset('eido-update.json')).ok).toBe(false)
    expect(requested).toEqual([`${UPDATE_FEED_ORIGIN}/eido-update.json`])
  })

  it('refuses a hostile redirect hop BEFORE contacting it', async () => {
    const requested: string[] = []
    const fetchAsset = createUpdateFeedFetcher({
      fetchImpl: (async (url: string) => {
        requested.push(url)
        return new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/exfiltrate' },
        })
      }) as typeof fetch,
    })
    expect((await fetchAsset('eido-update.json')).ok).toBe(false)
    // Only the allowlisted first request went out; the hostile hop never did.
    expect(requested).toEqual([`${UPDATE_FEED_ORIGIN}/eido-update.json`])
  })

  it('refuses redirect loops, missing locations, HTTP errors, and network failures', async () => {
    const looping = createUpdateFeedFetcher({
      fetchImpl: (async (url: string) => new Response(null, {
        status: 302,
        headers: { location: url },
      })) as typeof fetch,
    })
    expect((await looping('eido-update.json')).ok).toBe(false)

    const missingLocation = createUpdateFeedFetcher({
      fetchImpl: (async () => new Response(null, { status: 302 })) as typeof fetch,
    })
    expect((await missingLocation('eido-update.json')).ok).toBe(false)

    const notFound = createUpdateFeedFetcher({
      fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch,
    })
    expect((await notFound('eido-update.json')).ok).toBe(false)

    const offline = createUpdateFeedFetcher({
      fetchImpl: (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch,
    })
    expect((await offline('eido-update.json')).ok).toBe(false)
  })

  it('refuses oversized bodies instead of buffering them', async () => {
    const oversized = createUpdateFeedFetcher({
      maxBytes: 8,
      fetchImpl: (async () => new Response(new Uint8Array(64), { status: 200 })) as typeof fetch,
    })
    expect((await oversized('eido-update.json')).ok).toBe(false)
    expect(UPDATE_FEED_MAX_BYTES).toBeGreaterThan(0)
  })

  it('aborts a hung request after the timeout', async () => {
    const hung = createUpdateFeedFetcher({
      timeoutMs: 10,
      fetchImpl: ((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as typeof fetch,
    })
    expect((await hung('eido-update.json')).ok).toBe(false)
  })
})
