import { resolve4, resolve6 } from 'node:dns/promises'
import { request as requestHttp, type IncomingMessage, type RequestOptions } from 'node:http'
import { request as requestHttps } from 'node:https'
import { isIP } from 'node:net'
import {
  LINK_PREVIEW_LIMITS,
  linkPreviewFallback,
  type LoadedLinkPreview,
} from '../src/shared/linkPreview'
import { webUrlFromClipboardText } from './linkPreviewUrlClassifier'

const HTML_BYTE_LIMIT = 1_000_000
const IMAGE_BYTE_LIMIT = 512_000
const FAVICON_BYTE_LIMIT = 96_000
const REQUEST_TIMEOUT_MS = 8_000
const MAX_REDIRECTS = 4
const MAX_CONCURRENT_PREVIEWS = 8
const MAX_QUEUED_PREVIEWS = 16
const MAX_IMAGE_WIDTH = 2_400
const MAX_IMAGE_HEIGHT = 1_600
const MAX_IMAGE_PIXELS = MAX_IMAGE_WIDTH * MAX_IMAGE_HEIGHT
const ICON_MIME_TYPES = new Set([
  'image/x-icon',
  'image/vnd.microsoft.icon',
])
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  ...ICON_MIME_TYPES,
])

export type LinkPreviewResourceRequest = Readonly<{
  url: string
  maxBytes: number
  accept: 'html' | 'image'
  signal?: AbortSignal
}>

export type LinkPreviewResource = Readonly<{
  finalUrl: string
  mimeType: string
  bytes: Uint8Array
}>

export type LinkPreviewResourceReader = (
  request: LinkPreviewResourceRequest,
) => Promise<LinkPreviewResource>

export type LinkPreviewService = Readonly<{
  load(url: string): Promise<LoadedLinkPreview>
}>

export type ParsedLinkPreviewDocument = Readonly<{
  title?: string
  description?: string
  siteName?: string
  imageUrl?: string
  // Every icon the page declared, smallest declared `sizes` first, an
  // undeclared size last. A page that names its real favicon small and
  // separately reuses a full resolution logo as `rel="icon"` (a live,
  // observed pattern) is common enough that keeping only the first tag found
  // means keeping the wrong one; trying every candidate in order, cheapest
  // first, is what makes the real icon win instead of the logo.
  faviconCandidates: readonly string[]
}>

export function createLinkPreviewService({
  readResource = readPublicLinkPreviewResource,
  requestDeadlineMs = REQUEST_TIMEOUT_MS,
}: Readonly<{
  readResource?: LinkPreviewResourceReader
  requestDeadlineMs?: number
}> = {}): LinkPreviewService {
  const gate = createTaskGate(MAX_CONCURRENT_PREVIEWS, MAX_QUEUED_PREVIEWS)
  return Object.freeze({
    async load(url: string): Promise<LoadedLinkPreview> {
      if (webUrlFromClipboardText(url) !== url) return linkPreviewFallback(url)
      try {
        return await gate.run(async () => {
          const controller = new AbortController()
          let rejectDeadline: ((reason: Error) => void) | undefined
          const deadline = new Promise<never>((_resolve, reject) => {
            rejectDeadline = reject
          })
          const timer = setTimeout(() => {
            controller.abort()
            rejectDeadline?.(new Error('Link preview request timed out'))
          }, requestDeadlineMs)
          try {
            return await Promise.race([
              loadPreview(url, readResource, controller.signal),
              deadline,
            ])
          } catch {
            return linkPreviewFallback(url)
          } finally {
            clearTimeout(timer)
          }
        })
      } catch {
        return linkPreviewFallback(url)
      }
    },
  })
}

async function loadPreview(
  url: string,
  readResource: LinkPreviewResourceReader,
  signal: AbortSignal,
): Promise<LoadedLinkPreview> {
  const page = await readResource({
    url,
    maxBytes: HTML_BYTE_LIMIT,
    accept: 'html',
    signal,
  })
  if (mimeTypeOnly(page.mimeType) !== 'text/html') return linkPreviewFallback(url)
  const document = parseLinkPreviewDocument(new TextDecoder().decode(page.bytes), page.finalUrl)
  const faviconAttempts = dedupeUrls([
    ...document.faviconCandidates,
    // Reliable well-known path (RFC-less but universal browser convention):
    // tried last, so a page's own declared icon always wins when it works.
    wellKnownFaviconUrl(page.finalUrl),
  ])
  const [imageDataUrl, faviconDataUrl] = await Promise.all([
    document.imageUrl
      ? readImageDataUrl(readResource, document.imageUrl, IMAGE_BYTE_LIMIT, signal)
      : undefined,
    firstUsableImageDataUrl(readResource, faviconAttempts, FAVICON_BYTE_LIMIT, signal),
  ])
  const siteName = bounded(document.siteName, LINK_PREVIEW_LIMITS.siteName)
    ?? bounded(new URL(page.finalUrl).hostname.replace(/^www\./i, ''), LINK_PREVIEW_LIMITS.siteName)
  if (!document.title
    && !document.description
    && !document.siteName
    && !imageDataUrl
    && !faviconDataUrl) {
    return linkPreviewFallback(url)
  }
  return Object.freeze({
    url,
    status: 'ready',
    ...optional('title', bounded(document.title, LINK_PREVIEW_LIMITS.title)),
    ...optional('description', bounded(document.description, LINK_PREVIEW_LIMITS.description)),
    ...optional('siteName', siteName),
    ...optional('imageDataUrl', imageDataUrl),
    ...optional('faviconDataUrl', faviconDataUrl),
  })
}

export function parseLinkPreviewDocument(
  html: string,
  pageUrl: string,
): ParsedLinkPreviewDocument {
  const metadata = new Map<string, string>()
  const faviconsBySize = new Map<string, number>()
  for (const match of html.matchAll(/<(meta|link)\b[^>]*>/gi)) {
    const tag = match[0]
    const attributes = attributesOf(tag)
    if (match[1]?.toLowerCase() === 'meta') {
      const key = (attributes.property ?? attributes.name)?.toLowerCase()
      const content = cleanText(attributes.content)
      if (key && content && !metadata.has(key)) metadata.set(key, content)
      continue
    }
    const relations = (attributes.rel ?? '').toLowerCase().split(/\s+/)
    if (relations.includes('icon') || relations.includes('apple-touch-icon')) {
      const href = safeReferencedUrl(attributes.href, pageUrl)
      if (href && !faviconsBySize.has(href)) {
        faviconsBySize.set(href, declaredIconArea(attributes.sizes))
      }
    }
  }
  const faviconCandidates = Object.freeze(
    [...faviconsBySize.entries()]
      .sort(([, areaA], [, areaB]) => areaA - areaB)
      .map(([href]) => href),
  )

  const rawTitle = first(metadata.get('og:title'), metadata.get('twitter:title'), titleOf(html))
  const rawDescription = first(
    metadata.get('og:description'),
    metadata.get('twitter:description'),
    metadata.get('description'),
  )
  return Object.freeze({
    ...optional('title', cleanText(rawTitle)),
    ...optional('description', cleanText(rawDescription)),
    ...optional('siteName', cleanText(metadata.get('og:site_name'))),
    ...optional('imageUrl', safeReferencedUrl(first(
      metadata.get('og:image:secure_url'),
      metadata.get('og:image'),
      metadata.get('twitter:image'),
      metadata.get('twitter:image:src'),
    ), pageUrl)),
    faviconCandidates,
  })
}

/** The pixel area a `sizes="WxH"` attribute declares, or +Infinity when it is
 *  absent, unparsable, or `"any"` -- an undeclared size sorts after every
 *  declared one instead of winning by default. */
function declaredIconArea(sizes: string | undefined): number {
  const firstSize = sizes?.trim().split(/\s+/)[0]
  const match = firstSize ? /^(\d+)x(\d+)$/i.exec(firstSize) : null
  if (!match) return Number.POSITIVE_INFINITY
  const width = Number(match[1])
  const height = Number(match[2])
  return width * height
}

function wellKnownFaviconUrl(pageUrl: string): string | undefined {
  try {
    return new URL('/favicon.ico', pageUrl).toString()
  } catch {
    return undefined
  }
}

function dedupeUrls(urls: readonly (string | undefined)[]): readonly string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const url of urls) {
    if (url && !seen.has(url)) {
      seen.add(url)
      ordered.push(url)
    }
  }
  return ordered
}

/** Tries every favicon candidate in order and keeps the first that resolves
 *  to a usable image, so one oversized or missing icon does not sink every
 *  other one a page declared. */
async function firstUsableImageDataUrl(
  readResource: LinkPreviewResourceReader,
  candidates: readonly string[],
  maxBytes: number,
  signal: AbortSignal,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    const dataUrl = await readImageDataUrl(readResource, candidate, maxBytes, signal)
    if (dataUrl) return dataUrl
  }
  return undefined
}

export function isPublicAddress(candidate: string): boolean {
  const address = candidate.replace(/^\[|\]$/g, '').toLowerCase()
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1]
  if (mapped) return isPublicAddress(mapped)
  const family = isIP(address)
  if (family === 4) {
    const parts = address.split('.').map(Number)
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false
    }
    const [a, b] = parts as [number, number, number, number]
    return !(
      a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 192 && b === 88)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && parts[2] === 100)
      || (a === 203 && b === 0 && parts[2] === 113)
      || a >= 224
    )
  }
  if (family !== 6) return false
  return !(
    !/^[23]/.test(address)
    || address === '::'
    || address === '::1'
    || /^f[cd]/.test(address)
    || /^fe[89ab]/.test(address)
    || /^ff/.test(address)
    || /^2001:db8(?::|$)/.test(address)
    || /^2001:0(?::|$)/.test(address)
    || /^2002:/.test(address)
    || /^64:ff9b(?::|$)/.test(address)
  )
}

export function isAllowedLinkPreviewPort(url: URL): boolean {
  return (url.protocol === 'http:' && (url.port === '' || url.port === '80'))
    || (url.protocol === 'https:' && (url.port === '' || url.port === '443'))
}

export const readPublicLinkPreviewResource: LinkPreviewResourceReader = async (request) => {
  let current = requireWebUrl(request.url)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await readPublicUrlOnce(current, request)
    if (response.redirect) {
      if (redirects === MAX_REDIRECTS) throw new Error('Link preview redirected too many times')
      current = requireWebUrl(new URL(response.redirect, current).toString())
      continue
    }
    return {
      finalUrl: current.toString(),
      mimeType: response.mimeType,
      bytes: response.bytes,
    }
  }
  throw new Error('Link preview redirected too many times')
}

type PublicUrlResponse = Readonly<{
  redirect?: string
  mimeType: string
  bytes: Uint8Array
}>

async function readPublicUrlOnce(
  url: URL,
  request: LinkPreviewResourceRequest,
): Promise<PublicUrlResponse> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literalFamily = isIP(hostname)
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolveHostAddresses(hostname, request.signal)
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Link preview target is not public')
  }
  const target = addresses.find(({ family }) => family === 4) ?? addresses[0]
  if (!target) throw new Error('Link preview target could not be resolved')

  const options: RequestOptions & { servername?: string } = {
    protocol: url.protocol,
    hostname: target.address,
    family: target.family,
    port: url.port || undefined,
    method: 'GET',
    path: `${url.pathname}${url.search}`,
    servername: url.protocol === 'https:' ? hostname : undefined,
    headers: {
      Host: url.host,
      Accept: request.accept === 'html'
        ? 'text/html,application/xhtml+xml;q=0.9'
        : 'image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon',
      'Accept-Encoding': 'identity',
      'User-Agent': 'Eido-Link-Preview/1.0',
    },
    signal: request.signal,
  }
  const transport = url.protocol === 'https:' ? requestHttps : requestHttp
  return new Promise((resolve, reject) => {
    const outgoing = transport(options, (incoming) => {
      void collectResponse(incoming, request).then(resolve, reject)
    })
    outgoing.setTimeout(REQUEST_TIMEOUT_MS, () => {
      outgoing.destroy(new Error('Link preview request timed out'))
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

async function collectResponse(
  response: IncomingMessage,
  request: LinkPreviewResourceRequest,
): Promise<PublicUrlResponse> {
  const { maxBytes } = request
  const status = response.statusCode ?? 0
  if (status >= 300 && status < 400 && response.headers.location) {
    response.destroy()
    return { redirect: response.headers.location, mimeType: '', bytes: new Uint8Array() }
  }
  if (status < 200 || status >= 300) {
    response.destroy()
    throw new Error('Link preview request failed')
  }
  // A page's og:/icon metadata lives in its <head>, near the top of the
  // document, regardless of how large the rest of the page runs -- a
  // JavaScript bundle or an inlined script tail past the byte cap does not
  // change that. An image accept, in contrast, is decoded whole: a truncated
  // PNG or ICO is not a smaller valid image, it is a corrupt one. So html
  // truncates to the cap and still hands back what it read; image keeps the
  // strict all-or-nothing rule truncation would break.
  const truncatable = request.accept === 'html'
  const declaredLength = Number(response.headers['content-length'])
  if (!truncatable && Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    response.destroy()
    throw new Error('Link preview response was too large')
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > maxBytes) {
      if (truncatable) {
        chunks.push(buffer.subarray(0, buffer.length - (length - maxBytes)))
        response.destroy()
        break
      }
      response.destroy()
      throw new Error('Link preview response was too large')
    }
    chunks.push(buffer)
  }
  return {
    mimeType: typeof response.headers['content-type'] === 'string'
      ? response.headers['content-type']
      : 'application/octet-stream',
    bytes: Buffer.concat(chunks).subarray(0, maxBytes),
  }
}

async function readImageDataUrl(
  readResource: LinkPreviewResourceReader,
  url: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string | undefined> {
  try {
    const image = await readResource({ url, maxBytes, accept: 'image', signal })
    const mimeType = mimeTypeOnly(image.mimeType)
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)
      || !isBoundedStaticImage(mimeType, image.bytes)) return undefined
    // Both ICO content-type spellings render identically; carrying one
    // canonical value into the data url keeps the client's validator (and
    // every consumer downstream of it) checking a single mime string.
    const outputMimeType = ICON_MIME_TYPES.has(mimeType) ? 'image/x-icon' : mimeType
    const dataUrl = `data:${outputMimeType};base64,${Buffer.from(image.bytes).toString('base64')}`
    const limit = maxBytes === FAVICON_BYTE_LIMIT
      ? LINK_PREVIEW_LIMITS.faviconDataUrl
      : LINK_PREVIEW_LIMITS.imageDataUrl
    return dataUrl.length <= limit ? dataUrl : undefined
  } catch {
    return undefined
  }
}

async function resolveHostAddresses(
  hostname: string,
  signal: AbortSignal | undefined,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  if (signal?.aborted) throw new Error('Link preview request was cancelled')
  const resolution = Promise.allSettled([resolve4(hostname), resolve6(hostname)])
  const results = signal
    ? await Promise.race([
      resolution,
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(
          new Error('Link preview request was cancelled'),
        ), { once: true })
      }),
    ])
    : await resolution
  return results.flatMap((result, index) => (
    result.status === 'fulfilled'
      ? result.value.map((address) => ({ address, family: index === 0 ? 4 as const : 6 as const }))
      : []
  ))
}

function createTaskGate(limit: number, maxQueued: number): Readonly<{
  run<Result>(task: () => Promise<Result>): Promise<Result>
}> {
  let active = 0
  const waiting: Array<() => void> = []
  return Object.freeze({
    async run<Result>(task: () => Promise<Result>): Promise<Result> {
      if (active >= limit) {
        if (waiting.length >= maxQueued) throw new Error('Link preview queue is full')
        await new Promise<void>((resolve) => waiting.push(resolve))
      }
      else active += 1
      try {
        return await task()
      } finally {
        const next = waiting.shift()
        if (next) next()
        else active -= 1
      }
    },
  })
}

export function isBoundedStaticImage(mimeType: string, bytes: Uint8Array): boolean {
  const size = mimeType === 'image/png'
    ? pngSize(bytes)
    : mimeType === 'image/jpeg'
      ? jpegSize(bytes)
      : ICON_MIME_TYPES.has(mimeType)
        ? icoSize(bytes)
        : null
  return Boolean(size
    && size.width <= MAX_IMAGE_WIDTH
    && size.height <= MAX_IMAGE_HEIGHT
    && size.width * size.height <= MAX_IMAGE_PIXELS)
}

// A .ico is a directory of one or more embedded images, not one bitmap; the
// browser picks whichever the display needs and decodes it, so this checks
// only the container header and the size the first directory entry declares
// (0 means 256, the format's own convention). No pixel decode happens here --
// the bytes are handed to the browser's own <img> renderer unmodified.
function icoSize(bytes: Uint8Array): Readonly<{ width: number; height: number }> | null {
  if (bytes.length < 22) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const reserved = view.getUint16(0, true)
  const type = view.getUint16(2, true)
  const count = view.getUint16(4, true)
  if (reserved !== 0 || type !== 1 || count < 1) return null
  const rawWidth = bytes[6]
  const rawHeight = bytes[7]
  if (rawWidth === undefined || rawHeight === undefined) return null
  return Object.freeze({
    width: rawWidth === 0 ? 256 : rawWidth,
    height: rawHeight === 0 ? 256 : rawHeight,
  })
}

function pngSize(bytes: Uint8Array): Readonly<{ width: number; height: number }> | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || !signature.every((byte, index) => bytes[index] === byte)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let size: Readonly<{ width: number; height: number }> | null = null
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const chunkEnd = offset + 12 + length
    if (chunkEnd > bytes.length) return null
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === 'acTL') return null
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) return null
      const width = view.getUint32(offset + 8)
      const height = view.getUint32(offset + 12)
      if (!width || !height) return null
      size = Object.freeze({ width, height })
    }
    offset = chunkEnd
    if (type === 'IEND') return size
  }
  return null
}

function jpegSize(bytes: Uint8Array): Readonly<{ width: number; height: number }> | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  while (offset + 3 < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return null
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.length) return null
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
      && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isStartOfFrame) {
      if (length < 7) return null
      const height = view.getUint16(offset + 3)
      const width = view.getUint16(offset + 5)
      return width && height ? Object.freeze({ width, height }) : null
    }
    offset += length
  }
  return null
}

function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  for (const match of tag.matchAll(pattern)) {
    const name = match[1]?.toLowerCase()
    const value = match[2] ?? match[3] ?? match[4]
    if (name && value !== undefined && attributes[name] === undefined) attributes[name] = value
  }
  return attributes
}

function titleOf(html: string): string | undefined {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]
  return match ? match.replace(/<[^>]*>/g, ' ') : undefined
}

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined
  const decoded = decodeHtmlEntities(value).replace(/\s+/g, ' ').trim()
  return decoded || undefined
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, key: string) => {
    if (key.startsWith('#')) {
      const hexadecimal = key[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isSafeInteger(codePoint) && codePoint > 0
        ? String.fromCodePoint(codePoint)
        : entity
    }
    return named[key.toLowerCase()] ?? entity
  })
}

function safeReferencedUrl(value: string | undefined, pageUrl: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(decodeHtmlEntities(value), pageUrl)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:')
      || !url.hostname
      || url.username
      || url.password) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function requireWebUrl(value: string): URL {
  const normalised = webUrlFromClipboardText(value)
  if (normalised !== value) throw new Error('Link preview URL was invalid')
  const url = new URL(value)
  if (!isAllowedLinkPreviewPort(url)) throw new Error('Link preview port was not allowed')
  return url
}

function mimeTypeOnly(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function bounded(value: string | undefined, limit: number): string | undefined {
  const cleaned = cleanText(value)
  if (!cleaned) return undefined
  return cleaned.slice(0, limit)
}

function first(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value))
}

function optional<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): { [Property in Key]?: Value } {
  return value === undefined ? {} : { [key]: value } as { [Property in Key]?: Value }
}
