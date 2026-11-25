import type {
  LocalHtmlPreviewCapture,
  LocalHtmlPreviewSource,
} from './linkPreviewContract'
import type { LocalHtmlPreviewSourceStore } from './localHtmlPreviewSourceStore'
import {
  hasJpegEnvelope,
  LOCAL_HTML_PREVIEW_IMAGE_LIMITS,
} from '../src/shared/localHtmlPreview'

const MAX_CACHE_BYTES = 16_000_000
const MAX_CONCURRENT_CAPTURES = 2
const MAX_QUEUED_CAPTURES = 16

export type LocalHtmlPageCapture = Readonly<{
  bytes: Uint8Array
  title?: string
  width: number
  height: number
}>

export type LocalHtmlPageCapturer = (path: string) => Promise<LocalHtmlPageCapture>

export type LocalHtmlPreviewService = Readonly<{
  recognize(text: string): Promise<LocalHtmlPreviewSource | null>
  load(sourceId: string, refresh?: boolean): Promise<LocalHtmlPreviewCapture>
  open(sourceId: string): Promise<boolean>
  close(): void
}>

export function createLocalHtmlPreviewService({
  sources,
  capture,
  openPath,
  now = () => new Date().toISOString(),
}: Readonly<{
  sources: LocalHtmlPreviewSourceStore
  capture: LocalHtmlPageCapturer
  openPath: (path: string) => Promise<string>
  now?: () => string
}>): LocalHtmlPreviewService {
  const gate = createTaskGate(MAX_CONCURRENT_CAPTURES, MAX_QUEUED_CAPTURES)
  const cache = new Map<string, LocalHtmlPreviewCapture>()
  const inFlight = new Map<string, Promise<LocalHtmlPreviewCapture>>()
  const forcedRefreshes = new Map<string, Promise<LocalHtmlPreviewCapture>>()
  const latestKey = new Map<string, string>()
  let cacheBytes = 0
  let refreshSequence = 0

  const removeCached = (cacheKey: string) => {
    const cached = cache.get(cacheKey)
    if (cached) cacheBytes -= cached.imageDataUrl.length
    cache.delete(cacheKey)
  }
  const removeSourceCache = (sourceId: string) => {
    const prefix = `${sourceId}:`
    for (const cacheKey of cache.keys()) {
      if (cacheKey.startsWith(prefix)) removeCached(cacheKey)
    }
  }
  const loadCapture = async (sourceId: string, refresh: boolean) => {
      const resolved = await sources.resolve(sourceId)
      if (!resolved) throw new Error('Local HTML preview source is unavailable')
      const cacheKey = `${sourceId}:${resolved.size}:${resolved.modifiedAtMs}`
      const requestKey = refresh ? `${cacheKey}:refresh:${++refreshSequence}` : cacheKey
      const cached = refresh ? undefined : cache.get(cacheKey)
      if (cached) {
        cache.delete(cacheKey)
        cache.set(cacheKey, cached)
        return cached
      }
      const pending = inFlight.get(requestKey)
      if (pending) return pending
      const request = gate.run(async () => {
        const result = await capture(resolved.path)
        if (latestKey.get(sourceId) !== requestKey) {
          throw new Error('Local HTML preview capture was superseded')
        }
        if (!hasJpegEnvelope(result.bytes)
          || result.bytes.byteLength > LOCAL_HTML_PREVIEW_IMAGE_LIMITS.maxBytes
          || !Number.isSafeInteger(result.width) || result.width <= 0
          || result.width > LOCAL_HTML_PREVIEW_IMAGE_LIMITS.maxWidth
          || !Number.isSafeInteger(result.height) || result.height <= 0
          || result.height > LOCAL_HTML_PREVIEW_IMAGE_LIMITS.maxHeight) {
          throw new Error('Local HTML preview capture is invalid')
        }
        const loaded: LocalHtmlPreviewCapture = Object.freeze({
          sourceId,
          ...(result.title?.trim() ? { title: result.title.trim().slice(0, 300) } : {}),
          imageDataUrl: `data:image/jpeg;base64,${Buffer.from(result.bytes).toString('base64')}`,
          mimeType: 'image/jpeg',
          size: result.bytes.byteLength,
          width: result.width,
          height: result.height,
          capturedAt: now(),
        })
        removeCached(cacheKey)
        cache.set(cacheKey, loaded)
        cacheBytes += loaded.imageDataUrl.length
        while (cacheBytes > MAX_CACHE_BYTES) {
          const oldest = cache.keys().next().value
          if (oldest === undefined) break
          removeCached(oldest)
        }
        return loaded
      }, () => latestKey.set(sourceId, requestKey)).finally(() => {
        if (inFlight.get(requestKey) === request) inFlight.delete(requestKey)
      })
      inFlight.set(requestKey, request)
      return request
  }

  return Object.freeze({
    recognize: (text) => sources.recognize(text),
    load(sourceId, refresh = false) {
      if (!refresh) return forcedRefreshes.get(sourceId) ?? loadCapture(sourceId, false)
      const pending = forcedRefreshes.get(sourceId)
      if (pending) return pending
      removeSourceCache(sourceId)
      const request = loadCapture(sourceId, true).finally(() => {
        if (forcedRefreshes.get(sourceId) === request) forcedRefreshes.delete(sourceId)
      })
      forcedRefreshes.set(sourceId, request)
      return request
    },
    async open(sourceId) {
      const resolved = await sources.resolve(sourceId)
      if (!resolved) return false
      try {
        return (await openPath(resolved.path)) === ''
      } catch {
        return false
      }
    },
    close() {
      cache.clear()
      inFlight.clear()
      forcedRefreshes.clear()
      latestKey.clear()
      gate.close()
      sources.close()
    },
  })
}

function createTaskGate(limit: number, maxQueued: number): Readonly<{
  run<T>(task: () => Promise<T>, onAdmitted?: () => void): Promise<T>
  close(): void
}> {
  let active = 0
  let closed = false
  const queue: Array<Readonly<{ resolve(): void; reject(error: Error): void }>> = []
  const acquire = async (onAdmitted?: () => void) => {
    if (closed) throw new Error('Local HTML preview service is closed')
    if (active < limit) {
      active += 1
      onAdmitted?.()
      return
    }
    if (queue.length >= maxQueued) throw new Error('Local HTML preview queue is full')
    onAdmitted?.()
    await new Promise<void>((resolve, reject) => queue.push({ resolve, reject }))
  }
  const release = () => {
    active -= 1
    const next = queue.shift()
    if (!next) return
    active += 1
    next.resolve()
  }
  return Object.freeze({
    async run<T>(task: () => Promise<T>, onAdmitted?: () => void): Promise<T> {
      await acquire(onAdmitted)
      try {
        return await task()
      } finally {
        release()
      }
    },
    close() {
      closed = true
      const error = new Error('Local HTML preview service is closed')
      queue.splice(0).forEach((waiter) => waiter.reject(error))
    },
  })
}
