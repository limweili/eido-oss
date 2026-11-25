import {
  clearSetting,
  defineSetting,
  readSetting,
  setCardEnvelope,
  writeSetting,
} from '../persistence/settingsEnvelope'
import type {
  SettingContract,
  SettingsEnvelope,
  SettingsEnvelopeCarrier,
} from '../persistence/settingsEnvelope'
import type { LinkPreview } from '../graph/types'
import { markdownProseOnly, unescapeMarkdownPunctuation } from './markdown'

export type { LinkPreview } from '../graph/types'

export type LoadedLinkPreview = LinkPreview & Readonly<{
  imageDataUrl?: string
  faviconDataUrl?: string
}>

export const LINK_PREVIEW_LIMITS = Object.freeze({
  url: 2_048,
  localPath: 8_192,
  title: 300,
  description: 1_000,
  siteName: 200,
  imageDataUrl: 700_000,
  faviconDataUrl: 140_000,
})

/**
 * Returns one absolute local HTML path when the complete clipboard text is a
 * Finder/File Explorer path. This is only a cheap renderer-side shape gate;
 * Electron main still canonicalizes and validates the file before any access.
 */
export function localHtmlPathFromClipboardText(value: string): string | null {
  let candidate = value.trim()
  if (!candidate || candidate.length > LINK_PREVIEW_LIMITS.localPath || /[\0\r\n]/.test(candidate)) {
    return null
  }
  if ((candidate.startsWith('"') && candidate.endsWith('"'))
    || (candidate.startsWith("'") && candidate.endsWith("'"))) {
    candidate = candidate.slice(1, -1).trim()
  }
  if (!candidate || /[\0\r\n]/.test(candidate)) return null

  if (/^file:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate)
      if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) return null
      candidate = decodeURIComponent(url.pathname)
      if (/^\/[a-z]:\//i.test(candidate)) candidate = candidate.slice(1)
    } catch {
      return null
    }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(candidate) && !/^[a-z]:[\\/]/i.test(candidate)) {
    return null
  }

  const absolute = candidate.startsWith('/') || /^[a-z]:[\\/]/i.test(candidate)
  if (!absolute || /^\\\\/.test(candidate) || !/\.html?$/i.test(candidate)) return null
  return candidate
}

export function localHtmlDisplayNameFromClipboardText(value: string): string | null {
  const candidate = localHtmlPathFromClipboardText(value)
  if (!candidate) return null
  const segments = candidate.split(/[\\/]/)
  return segments[segments.length - 1] ?? null
}

const COMMON_FILE_EXTENSIONS = new Set([
  'css', 'csv', 'doc', 'docx', 'gif', 'go', 'html', 'jpeg', 'jpg', 'js', 'json',
  'jsx', 'md', 'mp4', 'pdf', 'php', 'png', 'py', 'rb', 'rs', 'sh', 'sql', 'svg',
  'toml', 'ts', 'tsx', 'txt', 'webp', 'xls', 'xlsx', 'xml', 'yaml', 'yml', 'zip',
])

/**
 * Returns one safe web URL only when the complete clipboard text is the URL.
 * This keeps prose and multi-link pastes on the existing Note path.
 */
export function webUrlFromClipboardText(
  value: string,
  hasRegistrableDomain: (hostname: string) => boolean,
): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > LINK_PREVIEW_LIMITS.url || /\s/.test(trimmed)) return null

  const explicitWebScheme = /^https?:\/\//i.test(trimmed)
  if (!explicitWebScheme && !trimmed.includes('.')) return null
  if (!explicitWebScheme && looksLikeCommonFilename(trimmed)) return null

  const candidate = explicitWebScheme ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:')
      || !url.hostname
      || url.username
      || url.password) return null
    if (!explicitWebScheme && !hasRegistrableDomain(url.hostname)) return null
    if (explicitWebScheme) return trimmed
    const normalised = url.pathname === '/' && !url.search && !url.hash
      ? `${url.protocol}//${url.host}`
      : url.toString()
    return normalised.length <= LINK_PREVIEW_LIMITS.url ? normalised : null
  } catch {
    return null
  }
}

export function explicitWebUrlFromClipboardText(value: string): string | null {
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  return webUrlFromClipboardText(trimmed, () => false)
}

// HOW MANY PREVIEWS ONE NOTE MAY GROW. A Note is a thought, not a link farm:
// four tiles fill the carousel, and every extra one costs a fetch, a stored
// tile and vertical space inside the Card. A body with more links keeps its
// links; only the previews stop at four.
export const LINK_PREVIEW_MAX_PER_NOTE = 4

// WHAT COUNTS AS A LINK IN A NOTE BODY. The reader sees three Markdown shapes
// of the same thing, and only the address inside each is the address:
//
//   http://example.com/page          a bare url, autolinked as it stands
//   <http://example.com/page>        an autolink
//   [some words](http://example.com/page)   an inline link
//
// Reading the third shape as if it were the first is what produced hrefs like
// `http://site/page](http://site/page`: the scan started at the first `http`
// and ran through the `](` into the second copy. That address resolves
// nowhere, so the fetch failed and the tile fell back to the raw url with no
// title, description, image or favicon.
//
// The scan mirrors what the passive Markdown render already links
// (renderMarkdown in shared/markdown.ts), so "this becomes a live link" and
// "this can grow a preview" stay the same question. Mirroring it means code is
// skipped: a fenced block or an inline span is a code sample the reader sees
// verbatim and never as a link, so pasting one must not send Eido fetching.
// Deliberately narrower than webUrlFromClipboardText's scheme-less matching:
// scanning arbitrary prose for bare domains would flag ordinary sentences
// ("v1.2", "e.g.").
const WEB_URL_IN_PROSE = new RegExp([
  // [text](<destination>) and [text](destination "title") - destination only
  /\[[^\]\n]*\]\(\s*(?:<([^<>\n]*)>|((?:[^()\s]|\([^()\s]*\))+))/,
  // <http://autolink>, and never one whose closing angle is escaped
  /<(https?:\/\/[^\s<>\\]+)>/,
  // a bare url in prose, minus the punctuation that ends a sentence or closes
  // an angle pair the Markdown editor left escaped (`\<url\>`)
  /(https?:\/\/[^\s<]*[^\s<>\\.,:;!?'")\]}])/,
].map((part) => part.source).join('|'), 'gi')

/**
 * Every distinct http(s) address a Note body offers a preview to, in the order
 * the body carries them, capped at `limit`.
 */
export function webUrlsInText(text: string, limit = LINK_PREVIEW_MAX_PER_NOTE): string[] {
  const found: string[] = []
  if (limit < 1) return found
  for (const match of markdownProseOnly(text).matchAll(WEB_URL_IN_PROSE)) {
    // The Markdown editor writes an ordinary address back with its punctuation
    // escaped, so the address a Note fetches is the unescaped one a reader
    // clicks, never `...?v\=1\&pp\=2`.
    const candidate = explicitWebUrlFromClipboardText(
      unescapeMarkdownPunctuation(match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''),
    )
    if (!candidate || found.includes(candidate)) continue
    found.push(candidate)
    if (found.length >= limit) break
  }
  return found
}

export function firstWebUrlInText(text: string): string | null {
  return webUrlsInText(text, 1)[0] ?? null
}

// WHAT A NOTE REMEMBERS ABOUT PREVIEWS IT WILL NOT GROW AGAIN. Two things:
// the addresses the founder closed with the X, and the addresses this Note has
// already spent a fetch on. An attempt is spent once per address per Note and
// never again, so a failed or finished attempt is not repeated just because the
// Board was reopened; the memory is bounded because it is durable state on a
// Card.
//
// Both are portable settings by ADR 0040. Neither changes what the Note MEANS,
// so a build that cannot read one owes the reader a preview it could have
// skipped, never a refused Profile. They live in the Card's settings envelope
// and are read and written only through the envelope helpers, like the reach
// mode and the Note text scale.
const LINK_PREVIEW_ATTEMPT_MEMORY = 8
const LINK_PREVIEW_DISMISSAL_MEMORY = 8

function isRememberedUrls(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export const LINK_PREVIEW_DISMISSED_URLS_SETTING = defineSetting<string[]>({
  key: 'linkPreviewDismissedUrls',
  fallback: [],
  accepts: isRememberedUrls,
})

export const LINK_PREVIEW_ATTEMPTED_URLS_SETTING = defineSetting<string[]>({
  key: 'linkPreviewAttemptedUrls',
  fallback: [],
  accepts: isRememberedUrls,
})

/**
 * A Note can carry several previews, so the X is answered per address: closing
 * the second tile must not hold back the first, and neither may regrow.
 */
export function linkPreviewDismissed(
  card: SettingsEnvelopeCarrier | undefined,
  url: string,
): boolean {
  return readSetting(card, LINK_PREVIEW_DISMISSED_URLS_SETTING).includes(url)
}

export function withLinkPreviewDismissal(
  card: SettingsEnvelopeCarrier | undefined,
  url: string,
): SettingsEnvelope | undefined {
  return withRememberedUrl(
    card,
    LINK_PREVIEW_DISMISSED_URLS_SETTING,
    url,
    LINK_PREVIEW_DISMISSAL_MEMORY,
  )
}

export function linkPreviewAttempted(
  card: SettingsEnvelopeCarrier | undefined,
  url: string,
): boolean {
  return readSetting(card, LINK_PREVIEW_ATTEMPTED_URLS_SETTING).includes(url)
}

export function withLinkPreviewAttempt(
  card: SettingsEnvelopeCarrier | undefined,
  url: string,
): SettingsEnvelope | undefined {
  return withRememberedUrl(
    card,
    LINK_PREVIEW_ATTEMPTED_URLS_SETTING,
    url,
    LINK_PREVIEW_ATTEMPT_MEMORY,
  )
}

// The newest address goes last and the oldest falls off the front, so a Note
// carrying more links than the memory holds remembers what it just did rather
// than what it did first.
function withRememberedUrl(
  card: SettingsEnvelopeCarrier | undefined,
  setting: SettingContract<string[]>,
  url: string,
  memory: number,
): SettingsEnvelope | undefined {
  const remembered = readSetting(card, setting).filter((entry) => entry !== url)
  return writeSetting(card, setting, [...remembered, url].slice(-memory))
}

export function mightBeSchemeLessWebUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed
    || trimmed.length > LINK_PREVIEW_LIMITS.url
    || /\s/.test(trimmed)
    || /^https?:\/\//i.test(trimmed)
    || !trimmed.includes('.')
    || looksLikeCommonFilename(trimmed)) return false

  try {
    const url = new URL(`https://${trimmed}`)
    if (!url.hostname || url.username || url.password) return false
    const hostname = url.hostname.endsWith('.') ? url.hostname.slice(0, -1) : url.hostname
    if (hostname.includes(':')) return false
    const labels = hostname.split('.')
    if (labels.length < 2 || labels.some((label) => (
      label.length > 63
      || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
    ))) return false
    const suffix = labels[labels.length - 1]!
    return /^(?:[a-z]{2,63}|xn--[a-z\d-]{2,59})$/i.test(suffix)
  } catch {
    return false
  }
}

function looksLikeCommonFilename(value: string): boolean {
  if (/^www\./i.test(value) || /[/?#]/.test(value)) return false
  const extension = value.slice(value.lastIndexOf('.') + 1).toLowerCase()
  return COMMON_FILE_EXTENSIONS.has(extension)
}

// A NOTE'S PREVIEWS ARE ONE LIST KEPT IN TWO PLACES, deliberately. The first
// preview stays in the top level `linkPreview` key every shipped build already
// validates, and previews two and up ride in the Card's settings envelope. A
// second top level key would not fail one Card in an older build: it refuses
// the whole Profile revision, so a founder who added a second link and then
// reinstalled the previous version could open no Board at all. Read and write
// the list through these two functions rather than the fields, so the split
// stays a storage detail.
type NoteLinkPreviewCarrier = SettingsEnvelopeCarrier & { linkPreview?: LinkPreview }

export const LINK_PREVIEW_EXTRAS_META_KEY = 'linkPreviewExtras'

// Wider than this build's own cap on purpose: a Board written by a build that
// allows more previews is a Board this one still opens, showing what it has.
const LINK_PREVIEW_EXTRAS_LIMIT = 32

// Extras this build cannot read are somebody else's saved previews, so they
// stay on disk untouched and this Note simply shows the one preview it can.
export const LINK_PREVIEW_EXTRAS_SETTING = defineSetting<LinkPreview[]>({
  key: LINK_PREVIEW_EXTRAS_META_KEY,
  fallback: [],
  accepts: isLinkPreviewExtras,
})

export function noteLinkPreviews(
  card: Readonly<NoteLinkPreviewCarrier> | undefined,
): readonly LinkPreview[] {
  if (!card?.linkPreview) return []
  return [card.linkPreview, ...readSetting(card, LINK_PREVIEW_EXTRAS_SETTING)]
}

export function setNoteLinkPreviews(
  card: NoteLinkPreviewCarrier,
  previews: readonly LinkPreview[],
): void {
  const [first, ...rest] = previews
  if (!first) {
    delete card.linkPreview
    setCardEnvelope(card, clearSetting(card, LINK_PREVIEW_EXTRAS_SETTING))
    return
  }
  card.linkPreview = first
  setCardEnvelope(card, writeSetting(card, LINK_PREVIEW_EXTRAS_SETTING, rest))
}

/** Previews two and up, as they travel through storage. */
export function isLinkPreviewExtras(value: unknown): value is LinkPreview[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= LINK_PREVIEW_EXTRAS_LIMIT
    && value.every(isLinkPreview)
}

export function linkPreviewFallback(url: string): LinkPreview {
  return Object.freeze({ url, status: 'fallback' })
}

export function isLinkPreview(value: unknown): value is LinkPreview {
  return isLinkPreviewShape(value, false)
}

export function isLoadedLinkPreview(value: unknown): value is LoadedLinkPreview {
  return isLinkPreviewShape(value, true)
}

export function durableLinkPreview(preview: LoadedLinkPreview): LinkPreview {
  const { imageDataUrl: _imageDataUrl, faviconDataUrl: _faviconDataUrl, ...durable } = preview
  return Object.freeze(durable)
}

function isLinkPreviewShape(value: unknown, allowMedia: boolean): value is LoadedLinkPreview {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'url',
    'status',
    'title',
    'description',
    'siteName',
    ...(allowMedia ? ['imageDataUrl', 'faviconDataUrl'] : []),
  ])) return false
  if (typeof value.url !== 'string'
    || value.url.length > LINK_PREVIEW_LIMITS.url
    || explicitWebUrlFromClipboardText(value.url) !== value.url
    || (value.status !== 'loading' && value.status !== 'ready' && value.status !== 'fallback')) {
    return false
  }
  if (!optionalBoundedText(value.title, LINK_PREVIEW_LIMITS.title)
    || !optionalBoundedText(value.description, LINK_PREVIEW_LIMITS.description)
    || !optionalBoundedText(value.siteName, LINK_PREVIEW_LIMITS.siteName)
    || (allowMedia && !optionalImageDataUrl(value.imageDataUrl, LINK_PREVIEW_LIMITS.imageDataUrl))
    || (allowMedia && !optionalImageDataUrl(value.faviconDataUrl, LINK_PREVIEW_LIMITS.faviconDataUrl))) {
    return false
  }
  return true
}

function optionalBoundedText(value: unknown, limit: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= limit)
}

function optionalImageDataUrl(value: unknown, limit: number): boolean {
  return value === undefined || (
    typeof value === 'string'
    && value.length <= limit
    // x-icon covers a favicon read straight from a site's /favicon.ico: real
    // ones are near-universally the classic .ico container, not PNG/JPEG,
    // and the browser's own <img> renders that format natively.
    && /^data:image\/(?:png|jpeg|x-icon);base64,[a-z\d+/]*={0,2}$/i.test(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.every((key) => allowed.includes(key))
}
