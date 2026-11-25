import {
  LINK_PREVIEW_LIMITS,
  explicitWebUrlFromClipboardText,
  isLoadedLinkPreview,
  localHtmlPathFromClipboardText,
  mightBeSchemeLessWebUrl,
  type LoadedLinkPreview,
} from '../src/shared/linkPreview'
import type {
  LocalHtmlPreviewCapture,
  LocalHtmlPreviewSource,
} from '../src/shared/localHtmlPreview'
import { isLocalHtmlPreviewStaticImage } from '../src/shared/localHtmlPreview'

export type { LocalHtmlPreviewCapture, LocalHtmlPreviewSource } from '../src/shared/localHtmlPreview'

export const LINK_PREVIEW_BRIDGE_VERSION = 1 as const
export const LINK_PREVIEW_BRIDGE_CHANNEL = 'eido:link-preview:v1' as const

export type LinkPreviewRequest = Readonly<{
  version: typeof LINK_PREVIEW_BRIDGE_VERSION
  operation: 'load'
  payload: Readonly<{ url: string }>
}> | Readonly<{
  version: typeof LINK_PREVIEW_BRIDGE_VERSION
  operation: 'recognize'
  payload: Readonly<{ text: string }>
}> | Readonly<{
  version: typeof LINK_PREVIEW_BRIDGE_VERSION
  operation: 'recognize-local'
  payload: Readonly<{ text: string }>
}> | Readonly<{
  version: typeof LINK_PREVIEW_BRIDGE_VERSION
  operation: 'load-local'
  payload: Readonly<{ sourceId: string; refresh: boolean }>
}> | Readonly<{
  version: typeof LINK_PREVIEW_BRIDGE_VERSION
  operation: 'open-local'
  payload: Readonly<{ sourceId: string }>
}>

export type LinkPreviewResponse =
  | Readonly<{ ok: true; preview: LoadedLinkPreview }>
  | Readonly<{ ok: true; url: string | null }>
  | Readonly<{ ok: true; source: LocalHtmlPreviewSource | null }>
  | Readonly<{ ok: true; capture: LocalHtmlPreviewCapture }>
  | Readonly<{ ok: true; opened: boolean }>
  | Readonly<{ ok: false; code: 'unavailable' }>

export type InstalledLinkPreviewBridge = Readonly<{
  load(url: string): Promise<LoadedLinkPreview>
  recognize(text: string): Promise<string | null>
  recognizeLocal(text: string): Promise<LocalHtmlPreviewSource | null>
  loadLocal(sourceId: string, refresh?: boolean): Promise<LocalHtmlPreviewCapture>
  openLocal(sourceId: string): Promise<boolean>
}>

type Invoke = (
  channel: typeof LINK_PREVIEW_BRIDGE_CHANNEL,
  request: LinkPreviewRequest,
) => Promise<unknown>

export function createInstalledLinkPreviewBridge(invoke: Invoke): InstalledLinkPreviewBridge {
  return Object.freeze({
    async load(url: string): Promise<LoadedLinkPreview> {
      const request = assertLinkPreviewRequest({
        version: LINK_PREVIEW_BRIDGE_VERSION,
        operation: 'load',
        payload: { url },
      })
      const response = assertLinkPreviewResponse(await invoke(LINK_PREVIEW_BRIDGE_CHANNEL, request))
      if (!response.ok) throw new Error('Link preview is unavailable')
      if (!('preview' in response)) throw new Error('Link preview response was denied')
      return response.preview
    },
    async recognize(text: string): Promise<string | null> {
      const request = assertLinkPreviewRequest({
        version: LINK_PREVIEW_BRIDGE_VERSION,
        operation: 'recognize',
        payload: { text },
      })
      const response = assertLinkPreviewResponse(await invoke(LINK_PREVIEW_BRIDGE_CHANNEL, request))
      if (!response.ok) throw new Error('Link preview recognition is unavailable')
      if (!('url' in response)) throw new Error('Link preview response was denied')
      return response.url
    },
    async recognizeLocal(text: string): Promise<LocalHtmlPreviewSource | null> {
      const response = assertLinkPreviewResponse(await invoke(LINK_PREVIEW_BRIDGE_CHANNEL, assertLinkPreviewRequest({
        version: LINK_PREVIEW_BRIDGE_VERSION,
        operation: 'recognize-local',
        payload: { text },
      })))
      if (!response.ok || !('source' in response)) throw new Error('Local HTML recognition is unavailable')
      return response.source
    },
    async loadLocal(sourceId: string, refresh = false): Promise<LocalHtmlPreviewCapture> {
      const response = assertLinkPreviewResponse(await invoke(LINK_PREVIEW_BRIDGE_CHANNEL, assertLinkPreviewRequest({
        version: LINK_PREVIEW_BRIDGE_VERSION,
        operation: 'load-local',
        payload: { sourceId, refresh },
      })))
      if (!response.ok || !('capture' in response)) throw new Error('Local HTML preview is unavailable')
      return response.capture
    },
    async openLocal(sourceId: string): Promise<boolean> {
      const response = assertLinkPreviewResponse(await invoke(LINK_PREVIEW_BRIDGE_CHANNEL, assertLinkPreviewRequest({
        version: LINK_PREVIEW_BRIDGE_VERSION,
        operation: 'open-local',
        payload: { sourceId },
      })))
      if (!response.ok || !('opened' in response)) throw new Error('Local HTML file is unavailable')
      return response.opened
    },
  })
}

export function assertLinkPreviewRequest(candidate: unknown): LinkPreviewRequest {
  if (!isRecord(candidate)
    || !exactKeys(candidate, ['operation', 'payload', 'version'])
    || candidate.version !== LINK_PREVIEW_BRIDGE_VERSION
    || !isRecord(candidate.payload)) {
    throw new Error('Link preview bridge request was denied')
  }
  if (candidate.operation === 'load'
    && exactKeys(candidate.payload, ['url'])
    && typeof candidate.payload.url === 'string'
    && candidate.payload.url.length <= LINK_PREVIEW_LIMITS.url
    && explicitWebUrlFromClipboardText(candidate.payload.url) === candidate.payload.url) {
    return Object.freeze({
      version: LINK_PREVIEW_BRIDGE_VERSION,
      operation: 'load',
      payload: Object.freeze({ url: candidate.payload.url }),
    })
  }
  if (candidate.operation === 'recognize'
    && exactKeys(candidate.payload, ['text'])
    && typeof candidate.payload.text === 'string'
    && candidate.payload.text.length <= LINK_PREVIEW_LIMITS.url
    && mightBeSchemeLessWebUrl(candidate.payload.text)) {
    return Object.freeze({
      version: LINK_PREVIEW_BRIDGE_VERSION,
      operation: 'recognize',
      payload: Object.freeze({ text: candidate.payload.text }),
    })
  }
  if (candidate.operation === 'recognize-local'
    && exactKeys(candidate.payload, ['text'])
    && typeof candidate.payload.text === 'string'
    && localHtmlPathFromClipboardText(candidate.payload.text) !== null) {
    return Object.freeze({
      version: LINK_PREVIEW_BRIDGE_VERSION,
      operation: 'recognize-local',
      payload: Object.freeze({ text: candidate.payload.text }),
    })
  }
  if (candidate.operation === 'load-local'
    && exactKeys(candidate.payload, ['refresh', 'sourceId'])
    && validSourceId(candidate.payload.sourceId)
    && typeof candidate.payload.refresh === 'boolean') {
    return Object.freeze({
      version: LINK_PREVIEW_BRIDGE_VERSION,
      operation: 'load-local',
      payload: Object.freeze({
        sourceId: candidate.payload.sourceId,
        refresh: candidate.payload.refresh,
      }),
    })
  }
  if (candidate.operation === 'open-local'
    && exactKeys(candidate.payload, ['sourceId'])
    && validSourceId(candidate.payload.sourceId)) {
    return Object.freeze({
      version: LINK_PREVIEW_BRIDGE_VERSION,
      operation: 'open-local',
      payload: Object.freeze({ sourceId: candidate.payload.sourceId }),
    })
  }
  throw new Error('Link preview bridge request was denied')
}

export function assertLinkPreviewResponse(candidate: unknown): LinkPreviewResponse {
  if (!isRecord(candidate) || typeof candidate.ok !== 'boolean') {
    throw new Error('Link preview bridge response was denied')
  }
  if (candidate.ok === true
    && exactKeys(candidate, ['ok', 'preview'])
    && isLoadedLinkPreview(candidate.preview)) {
    return Object.freeze({ ok: true, preview: Object.freeze({ ...candidate.preview }) })
  }
  if (candidate.ok === true
    && exactKeys(candidate, ['ok', 'url'])
    && (candidate.url === null
      || (typeof candidate.url === 'string'
        && explicitWebUrlFromClipboardText(candidate.url) === candidate.url))) {
    return Object.freeze({ ok: true, url: candidate.url })
  }
  if (candidate.ok === true
    && exactKeys(candidate, ['ok', 'source'])
    && (candidate.source === null || isLocalHtmlPreviewSource(candidate.source))) {
    return Object.freeze({
      ok: true,
      source: candidate.source === null ? null : Object.freeze({ ...candidate.source }),
    })
  }
  if (candidate.ok === true
    && exactKeys(candidate, ['capture', 'ok'])
    && isLocalHtmlPreviewCapture(candidate.capture)) {
    return Object.freeze({ ok: true, capture: Object.freeze({ ...candidate.capture }) })
  }
  if (candidate.ok === true
    && exactKeys(candidate, ['ok', 'opened'])
    && typeof candidate.opened === 'boolean') {
    return Object.freeze({ ok: true, opened: candidate.opened })
  }
  if (candidate.ok === false
    && exactKeys(candidate, ['code', 'ok'])
    && candidate.code === 'unavailable') {
    return Object.freeze({ ok: false, code: 'unavailable' })
  }
  throw new Error('Link preview bridge response was denied')
}

function isLocalHtmlPreviewSource(value: unknown): value is LocalHtmlPreviewSource {
  return isRecord(value)
    && exactKeys(value, ['id', 'name'])
    && validSourceId(value.id)
    && typeof value.name === 'string'
    && value.name.length > 0
    && value.name.length <= 255
    && !/[\\/\0\r\n]/.test(value.name)
    && /\.html?$/i.test(value.name)
}

function isLocalHtmlPreviewCapture(value: unknown): value is LocalHtmlPreviewCapture {
  return isRecord(value)
    && Object.keys(value).every((key) => [
      'sourceId', 'title', 'imageDataUrl', 'mimeType', 'size', 'width', 'height', 'capturedAt',
    ].includes(key))
    && validSourceId(value.sourceId)
    && (value.title === undefined
      || (typeof value.title === 'string' && value.title.length > 0 && value.title.length <= 300))
    && isLocalHtmlPreviewStaticImage({
      mimeType: value.mimeType,
      dataUrl: value.imageDataUrl,
      size: value.size,
      width: value.width,
      height: value.height,
    })
    && typeof value.capturedAt === 'string'
    && new Date(value.capturedAt).toISOString() === value.capturedAt
}

function validSourceId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[a-z\d_-]+$/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(candidate).sort()
  const sorted = [...expected].sort()
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index])
}
