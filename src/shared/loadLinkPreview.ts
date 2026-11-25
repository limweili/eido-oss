import {
  explicitWebUrlFromClipboardText,
  isLoadedLinkPreview,
  linkPreviewFallback,
  localHtmlPathFromClipboardText,
  mightBeSchemeLessWebUrl,
  type LoadedLinkPreview,
} from './linkPreview'
import type { LocalHtmlPreviewCapture, LocalHtmlPreviewSource } from './localHtmlPreview'

const inFlight = new Map<string, Promise<LoadedLinkPreview>>()
const loadedCache = new Map<string, LoadedLinkPreview>()
const LOADED_CACHE_BYTE_LIMIT = 16_000_000
const LINK_RECOGNITION_DEADLINE_MS = 750
let loadedCacheBytes = 0

export async function linkPreviewUrlFromClipboardText(value: string): Promise<string | null> {
  const explicit = explicitWebUrlFromClipboardText(value)
  if (explicit) return explicit
  if (!mightBeSchemeLessWebUrl(value)) return null

  const text = value.trim()
  const bridge = window.eidoLinkPreviews
  if (bridge) {
    try {
      return await withinDeadline(bridge.recognize(text), null)
    } catch {
      return null
    }
  }
  if (window.eidoDesktop) return null

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), LINK_RECOGNITION_DEADLINE_MS)
  try {
    const response = await fetch(`/api/eido/link-preview-url?text=${encodeURIComponent(text)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const candidate = await response.json() as unknown
    return isRecord(candidate)
      && (candidate.url === null || typeof candidate.url === 'string')
      && (candidate.url === null || explicitWebUrlFromClipboardText(candidate.url) === candidate.url)
      ? candidate.url
      : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function localHtmlPreviewSourceFromClipboardText(
  value: string,
): Promise<LocalHtmlPreviewSource | null> {
  if (!localHtmlPathFromClipboardText(value) || !window.eidoLinkPreviews) return null
  try {
    return await withinDeadline(window.eidoLinkPreviews.recognizeLocal(value), null)
  } catch {
    return null
  }
}

export function loadLocalHtmlPreview(
  sourceId: string,
  refresh = false,
): Promise<LocalHtmlPreviewCapture> {
  if (!window.eidoLinkPreviews) {
    throw new Error('Local HTML previews require the installed desktop app')
  }
  return window.eidoLinkPreviews.loadLocal(sourceId, refresh)
}

async function withinDeadline<T>(request: Promise<T>, fallback: T): Promise<T> {
  let timeout: number | undefined
  try {
    return await Promise.race([
      request,
      new Promise<T>((resolve) => {
        timeout = window.setTimeout(() => resolve(fallback), LINK_RECOGNITION_DEADLINE_MS)
      }),
    ])
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
}

export function cachedLinkPreview(url: string): LoadedLinkPreview | undefined {
  return loadedCache.get(url)
}

export function loadLinkPreview(url: string): Promise<LoadedLinkPreview> {
  const existing = inFlight.get(url)
  if (existing) return existing
  const request = loadLinkPreviewOnce(url)
    .catch(() => linkPreviewFallback(url))
    .then((preview) => {
      const replaced = loadedCache.get(url)
      if (replaced) loadedCacheBytes -= previewCacheBytes(replaced)
      loadedCache.delete(url)
      loadedCache.set(url, preview)
      loadedCacheBytes += previewCacheBytes(preview)
      while (loadedCacheBytes > LOADED_CACHE_BYTE_LIMIT) {
        const oldest = loadedCache.keys().next().value
        if (oldest === undefined) break
        const evicted = loadedCache.get(oldest)
        if (evicted) loadedCacheBytes -= previewCacheBytes(evicted)
        loadedCache.delete(oldest)
      }
      return preview
    })
    .finally(() => {
      if (inFlight.get(url) === request) inFlight.delete(url)
    })
  inFlight.set(url, request)
  return request
}

function previewCacheBytes(preview: LoadedLinkPreview): number {
  return (preview.imageDataUrl?.length ?? 0)
    + (preview.faviconDataUrl?.length ?? 0)
    + (preview.title?.length ?? 0)
    + (preview.description?.length ?? 0)
    + (preview.siteName?.length ?? 0)
    + preview.url.length
}

async function loadLinkPreviewOnce(url: string): Promise<LoadedLinkPreview> {
  const bridge = window.eidoLinkPreviews
  if (bridge) {
    const preview = await bridge.load(url)
    return isLoadedLinkPreview(preview) && preview.url === url
      ? preview
      : linkPreviewFallback(url)
  }
  if (window.eidoDesktop) return linkPreviewFallback(url)

  const response = await fetch(`/api/eido/link-preview?url=${encodeURIComponent(url)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) return linkPreviewFallback(url)
  const candidate = await response.json() as unknown
  if (!isRecord(candidate)
    || !isLoadedLinkPreview(candidate.preview)
    || candidate.preview.url !== url) {
    return linkPreviewFallback(url)
  }
  return candidate.preview
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
