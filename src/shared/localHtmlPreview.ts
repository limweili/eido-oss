export type LocalHtmlPreviewSource = Readonly<{
  id: string
  name: string
}>

export const LOCAL_HTML_PREVIEW_IMAGE_LIMITS = Object.freeze({
  maxBytes: 700_000,
  maxDataUrlChars: 1_000_000,
  maxWidth: 2400,
  maxHeight: 1600,
})

export type LocalHtmlPreviewCapture = Readonly<{
  sourceId: string
  title?: string
  imageDataUrl: string
  mimeType: 'image/jpeg'
  size: number
  width: number
  height: number
  capturedAt: string
}>

export type LocalHtmlPreview = Readonly<{
  sourceId: string
  name: string
  status: 'loading' | 'ready' | 'unavailable'
  title?: string
  assetId?: string
}>

export function isLocalHtmlPreview(value: unknown): value is LocalHtmlPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (!Object.keys(candidate).every((key) => [
    'sourceId', 'name', 'status', 'title', 'assetId',
  ].includes(key))) return false
  if (typeof candidate.sourceId !== 'string'
    || !/^[a-z\d_-]{1,128}$/i.test(candidate.sourceId)
    || typeof candidate.name !== 'string'
    || candidate.name.length === 0
    || candidate.name.length > 255
    || /[\\/\0\r\n]/.test(candidate.name)
    || !/\.html?$/i.test(candidate.name)
    || !['loading', 'ready', 'unavailable'].includes(String(candidate.status))) return false
  if (candidate.title !== undefined
    && (typeof candidate.title !== 'string' || candidate.title.length === 0 || candidate.title.length > 300)) {
    return false
  }
  if (candidate.assetId !== undefined
    && (typeof candidate.assetId !== 'string' || candidate.assetId.length === 0)) return false
  if (candidate.status === 'loading') return candidate.assetId === undefined
  if (candidate.status === 'ready') return typeof candidate.assetId === 'string'
  return candidate.assetId === undefined || typeof candidate.assetId === 'string'
}

export function hasJpegEnvelope(bytes: ArrayLike<number>): boolean {
  return bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff
    && bytes[bytes.length - 1] === 0xd9
}

export function isLocalHtmlPreviewStaticImage(value: Readonly<{
  kind?: unknown
  mimeType?: unknown
  dataUrl?: unknown
  size?: unknown
  width?: unknown
  height?: unknown
}>): boolean {
  if (!isLocalHtmlPreviewStaticImageMetadata(value)
    || typeof value.dataUrl !== 'string'
    || value.dataUrl.length > LOCAL_HTML_PREVIEW_IMAGE_LIMITS.maxDataUrlChars) return false
  const match = /^data:image\/jpeg;base64,([A-Za-z\d+/]+={0,2})$/.exec(value.dataUrl)
  if (!match) return false
  try {
    const decoded = atob(match[1]!)
    return decoded.length === value.size
      && decoded.length >= 4
      && decoded.charCodeAt(0) === 0xff
      && decoded.charCodeAt(1) === 0xd8
      && decoded.charCodeAt(decoded.length - 2) === 0xff
      && decoded.charCodeAt(decoded.length - 1) === 0xd9
  } catch {
    return false
  }
}

export function isLocalHtmlPreviewStaticImageMetadata(value: Readonly<{
  kind?: unknown
  mimeType?: unknown
  dataUrl?: unknown
  size?: unknown
  width?: unknown
  height?: unknown
}>): boolean {
  if (value.kind !== undefined && value.kind !== 'image') return false
  if (value.mimeType !== 'image/jpeg'
    || !Number.isSafeInteger(value.size)
    || Number(value.size) <= 0
    || Number(value.size) > LOCAL_HTML_PREVIEW_IMAGE_LIMITS.maxBytes
    || !Number.isSafeInteger(value.width)
    || Number(value.width) <= 0
    || Number(value.width) > LOCAL_HTML_PREVIEW_IMAGE_LIMITS.maxWidth
    || !Number.isSafeInteger(value.height)
    || Number(value.height) <= 0
    || Number(value.height) > LOCAL_HTML_PREVIEW_IMAGE_LIMITS.maxHeight) return false
  return true
}
