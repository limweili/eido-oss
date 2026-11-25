// Update feed endpoints (#682). Discovery talks only to the public release
// repository — the one network surface the packaged network promise allows
// beyond user-configured AI calls (epic #448 decision 9). The repository
// identity mirrors release/public-repository/policy.json (drift-tested).

export const UPDATE_RELEASE_REPOSITORY = 'limweili/eido-releases'

// The feed address is an Eido-owned hostname, never a hosting provider's URL
// (#976, ADR 0032). Both this origin and the allowlist below are compiled into
// every shipped app and cannot be changed on machines already in the field, so
// an app shipped against a provider URL would ask that provider forever and be
// stranded when hosting moves. The hostname is bound directly to object
// storage and serves the bytes itself; the GitHub redirect hops that earlier
// builds trusted are retired, because an allowlist entry shipped in every app
// is trust that cannot be recalled.
export const UPDATE_FEED_HOSTNAME = 'updates.eido.so'
export const UPDATE_FEED_ORIGIN = `https://${UPDATE_FEED_HOSTNAME}`

// Release assets published alongside every promoted release (lane E slices
// publish these names; B2 consumes the per-platform artifact digests).
export const UPDATE_MANIFEST_ASSET_NAME = 'eido-update.json'
export const UPDATE_MANIFEST_CHECKSUM_ASSET_NAME = 'eido-update.json.sha256'
// Detached Ed25519 signature over the exact manifest bytes (#793, ADR 0032).
export const UPDATE_MANIFEST_SIGNATURE_ASSET_NAME = 'eido-update.json.sig'

export const UPDATE_FEED_MAX_BYTES = 256 * 1024
export const UPDATE_FEED_TIMEOUT_MS = 15_000
// A Windows NSIS installer is intentionally bounded separately from the
// small metadata feed. 512 MiB leaves ample room for the packaged app while
// keeping a compromised release endpoint from driving unbounded buffering.
export const UPDATE_INSTALLER_MAX_BYTES = 512 * 1024 * 1024
export const UPDATE_INSTALLER_TIMEOUT_MS = 10 * 60 * 1000

const assetNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/

export function updateFeedAssetUrl(
  assetName: string,
  origin: string = UPDATE_FEED_ORIGIN,
): string {
  if (origin !== UPDATE_FEED_ORIGIN) {
    throw new Error('Update feed origin is invalid')
  }
  if (!assetNamePattern.test(assetName) || assetName.includes('..')) {
    throw new Error('Update feed asset name is invalid')
  }
  return `${origin}/${assetName}`
}

export const UPDATE_FEED_MAX_REDIRECTS = 5

// Every request goes to the Eido-owned feed hostname, which serves release
// bytes directly from object storage. Redirects are still followed manually
// and every hop is validated BEFORE it is contacted, but the only allowed
// destination is the feed hostname at a single asset path. The GitHub hops
// earlier builds trusted (github.com releases tree plus the two release-asset
// CDN hosts) are retired: no code path resolves there any more, and an
// allowlist entry compiled into every shipped app is trust that cannot be
// recalled later (decision 9).
export function isAllowedUpdateFeedRequestUrl(value: string): boolean {
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
  return url.hostname === UPDATE_FEED_HOSTNAME
    && assetNamePattern.test(url.pathname.slice(1))
    && !url.pathname.includes('..')
}

export type UpdateFeedFetchResult =
  | Readonly<{ ok: true; bytes: Uint8Array }>
  | Readonly<{ ok: false }>

// Reports bytes as they arrive. The installer artifact is around 160 MB, so a
// download with no readout is indistinguishable from a hang: this is what lets
// the consent card say how far along it actually is instead of spinning.
// `total` is the length the server declared, and is absent when it declared
// none -- in which case the surface must say "downloading" without inventing a
// proportion it does not know.
export type UpdateDownloadProgress = (received: number, total?: number) => void

export type UpdateFeedFetcher = (
  assetName: string,
  onProgress?: UpdateDownloadProgress,
) => Promise<UpdateFeedFetchResult>

// A quiet fetcher: every failure mode (offline, DNS, HTTP error, oversize
// body, disallowed redirect hop, redirect loop, timeout) collapses to
// { ok: false } so an unreachable feed behaves exactly like offline-normal.
// Redirects are followed manually so no request ever leaves the allowlisted
// endpoints — a hostile hop is refused before it is contacted.
export function createUpdateFeedFetcher(options: {
  readonly fetchImpl: typeof fetch
  readonly feedOrigin?: string
  readonly timeoutMs?: number
  readonly maxBytes?: number
}): UpdateFeedFetcher {
  const timeoutMs = options.timeoutMs ?? UPDATE_FEED_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? UPDATE_FEED_MAX_BYTES
  return async (assetName, onProgress) => {
    const refused = Object.freeze({ ok: false as const })
    let url: string
    try {
      url = updateFeedAssetUrl(assetName, options.feedOrigin)
    } catch {
      return refused
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      for (let hop = 0; hop <= UPDATE_FEED_MAX_REDIRECTS; hop += 1) {
        if (!isAllowedUpdateFeedRequestUrl(url)) return refused
        const response = await options.fetchImpl(url, {
          signal: controller.signal,
          redirect: 'manual',
          cache: 'no-store',
          headers: { accept: 'application/octet-stream' },
        })
        if (isRedirectStatus(response.status)) {
          const location = response.headers.get('location')
          if (!location) return refused
          try {
            url = new URL(location, url).toString()
          } catch {
            return refused
          }
          continue
        }
        if (!response.ok) return refused
        const declaredLength = Number(response.headers.get('content-length') ?? '0')
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return refused
        const declaredTotal = Number.isFinite(declaredLength) && declaredLength > 0
          ? declaredLength
          : undefined
        const bytes = await readBodyCapped(response, maxBytes, onProgress, declaredTotal)
        if (!bytes) return refused
        return Object.freeze({ ok: true as const, bytes })
      }
      return refused
    } catch {
      return refused
    } finally {
      clearTimeout(timer)
    }
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303
    || status === 307 || status === 308
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
  onProgress?: UpdateDownloadProgress,
  declaredTotal?: number,
): Promise<Uint8Array | undefined> {
  const report = (received: number) => {
    if (!onProgress) return
    try {
      onProgress(received, declaredTotal)
    } catch {
      // Progress reporting never interferes with the download itself.
    }
  }
  const body = response.body
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) return undefined
    report(buffer.byteLength)
    return buffer
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > maxBytes) return undefined
        chunks.push(value)
        report(total)
      }
    }
  } finally {
    reader.releaseLock()
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}
