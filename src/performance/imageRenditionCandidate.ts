import * as nodeFs from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import type { SavedBoard } from '../graph/types'
import type { ImageRenditionSnapshot } from '../shared/imageRenditions'

declare const Buffer: {
  from: (
    value: string | Uint8Array,
    encoding?: 'base64',
  ) => Uint8Array & { toString: (encoding: 'base64') => string }
}

export const IMAGE_RENDITION_CANDIDATE_CONTRACT = {
  id: 'eido-image-rendition-candidate-v1',
  fixtureId: 'rich-card-board-v1',
  minimumTraversals: 6,
  cameraSpeeds: ['settled', 'ordinary-pan', 'fast-pan'] as const,
  warmth: ['cold', 'warm'] as const,
} as const

export const IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS = [
  { cardId: 'benchmark-images-alpha', assetId: 'benchmark-image-alpha-square', width: 1024, height: 1024, mimeType: 'image/png', alpha: true },
  { cardId: 'benchmark-images-alpha', assetId: 'benchmark-image-alpha-wide', width: 1920, height: 1080, mimeType: 'image/png', alpha: true },
  { cardId: 'benchmark-images-alpha', assetId: 'benchmark-image-alpha-small', width: 320, height: 240, mimeType: 'image/png', alpha: true },
  { cardId: 'benchmark-images-alpha', assetId: 'benchmark-image-png-reference', width: 1, height: 1, mimeType: 'image/png', alpha: true },
  { cardId: 'benchmark-images-opaque', assetId: 'benchmark-image-opaque-portrait', width: 1080, height: 1920, mimeType: 'image/jpeg', alpha: false },
  { cardId: 'benchmark-images-opaque', assetId: 'benchmark-image-opaque-wide', width: 2560, height: 1080, mimeType: 'image/jpeg', alpha: false },
  { cardId: 'benchmark-images-opaque', assetId: 'benchmark-image-opaque-medium', width: 800, height: 600, mimeType: 'image/jpeg', alpha: false },
  { cardId: 'benchmark-images-mixed', assetId: 'benchmark-image-mixed-large', width: 2048, height: 2048, mimeType: 'image/jpeg', alpha: false },
  { cardId: 'benchmark-images-mixed', assetId: 'benchmark-image-mixed-thumbnail', width: 240, height: 180, mimeType: 'image/png', alpha: true },
] as const

export type ImageRenditionCandidateReference = {
  assetId: string
  mimeType: 'image/png' | 'image/jpeg'
  dataUrl: string
}

type GalleryClickRect = {
  x: number
  y: number
  width: number
  height: number
}

export type GalleryClickCameraGeometry = {
  button: GalleryClickRect
  topbar: GalleryClickRect
  client: GalleryClickRect
  camera: { x: number; y: number; zoom: number }
}

export const GALLERY_CLICK_TOPBAR_CLEARANCE_PX = 8

export function galleryClickCameraAdjustment(
  geometry: GalleryClickCameraGeometry,
  clearancePx = GALLERY_CLICK_TOPBAR_CLEARANCE_PX,
) {
  const { button, topbar, client, camera } = geometry
  const topbarOverlapsButton = topbar.x < button.x + button.width && topbar.x + topbar.width > button.x
  const requiredButtonY = Math.max(client.y, topbar.y + topbar.height + clearancePx)
  const screenSpaceY = topbarOverlapsButton
    ? Math.max(0, requiredButtonY - button.y)
    : 0
  if (screenSpaceY === 0) return null
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) {
    throw new Error(`Cannot adjust gallery camera with zoom=${camera.zoom}.`)
  }
  const boardSpaceY = screenSpaceY / camera.zoom
  return {
    camera: { ...camera, y: camera.y + boardSpaceY * camera.zoom },
    boardSpaceY,
    screenSpaceY,
  }
}

const CANDIDATE_REFERENCE_PRIVACY_PATTERN =
  /(?:\/Users\/|\/home\/|\\Users\\|\.eido|eido-v3-ideas|BEGIN (?:RSA|OPENSSH) PRIVATE KEY|gh[pousr]_[A-Za-z0-9_]+|api[_-]?key|save(?:d)?[-_ ]?(?:file|path))/i
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

function candidateReferenceBytes(reference: ImageRenditionCandidateReference) {
  if (CANDIDATE_REFERENCE_PRIVACY_PATTERN.test(JSON.stringify(reference))) {
    throw new Error(`Candidate image reference ${reference.assetId} failed the privacy scan.`)
  }
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(reference.dataUrl)
  if (!match) throw new Error(`Candidate image reference ${reference.assetId} must be a base64 PNG or JPEG data URL.`)
  if (match[1] !== reference.mimeType) {
    throw new Error(`Candidate image reference ${reference.assetId} MIME disagrees with its data URL.`)
  }
  const bytes = Uint8Array.from(Buffer.from(match[2], 'base64'))
  if (Buffer.from(bytes).toString('base64') !== match[2]) {
    throw new Error(`Candidate image reference ${reference.assetId} has invalid base64 bytes.`)
  }
  if (CANDIDATE_REFERENCE_PRIVACY_PATTERN.test(new TextDecoder('latin1').decode(bytes))) {
    throw new Error(`Candidate image reference ${reference.assetId} contains private path, save, or key material.`)
  }
  return bytes
}

function readUint32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] * 0x1000000) +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])) >>> 0
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function validatePng(bytes: Uint8Array, assetId: string) {
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error(`Candidate PNG ${assetId} has an invalid signature.`)
  }
  let offset = PNG_SIGNATURE.length
  let chunkIndex = 0
  let width = 0
  let height = 0
  let sawIhdr = false
  let sawIdat = false
  let idatEnded = false
  let sawIend = false
  const idatParts: Uint8Array[] = []
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error(`Candidate PNG ${assetId} has truncated chunk bounds.`)
    const length = readUint32(bytes, offset)
    const end = offset + 12 + length
    if (end > bytes.length || end < offset) throw new Error(`Candidate PNG ${assetId} has invalid chunk bounds.`)
    const typeBytes = bytes.slice(offset + 4, offset + 8)
    const type = String.fromCharCode(...typeBytes)
    const payload = bytes.slice(offset + 8, offset + 8 + length)
    const crcInput = new Uint8Array(4 + length)
    crcInput.set(typeBytes)
    crcInput.set(payload, 4)
    const storedCrc = readUint32(bytes, offset + 8 + length)
    if (crc32(crcInput) !== storedCrc) throw new Error(`Candidate PNG ${assetId} has an invalid ${type} CRC.`)
    if (chunkIndex === 0 && type !== 'IHDR') throw new Error(`Candidate PNG ${assetId} must start with IHDR.`)
    if (type === 'IHDR') {
      if (sawIhdr || length !== 13 || chunkIndex !== 0) throw new Error(`Candidate PNG ${assetId} has invalid IHDR order or bounds.`)
      sawIhdr = true
      width = readUint32(payload, 0)
      height = readUint32(payload, 4)
      if (width === 0 || height === 0) throw new Error(`Candidate PNG ${assetId} has invalid IHDR dimensions.`)
    } else if (type === 'IDAT') {
      if (!sawIhdr || idatEnded || sawIend) throw new Error(`Candidate PNG ${assetId} has invalid IDAT order.`)
      sawIdat = true
      idatParts.push(payload)
    } else {
      if (sawIdat) idatEnded = true
      if (type === 'IEND') {
        if (!sawIdat || length !== 0 || end !== bytes.length) {
          throw new Error(`Candidate PNG ${assetId} has invalid IEND order or bounds.`)
        }
        sawIend = true
      }
    }
    offset = end
    chunkIndex += 1
  }
  if (!sawIhdr || !sawIdat || !sawIend) throw new Error(`Candidate PNG ${assetId} is missing a required chunk.`)
  const compressed = new Uint8Array(idatParts.reduce((total, part) => total + part.length, 0))
  let compressedOffset = 0
  for (const part of idatParts) {
    compressed.set(part, compressedOffset)
    compressedOffset += part.length
  }
  try {
    if (inflateSync(compressed).length === 0) throw new Error('empty image stream')
  } catch (cause) {
    const failure = new Error(`Candidate PNG ${assetId} has invalid IDAT zlib data.`) as Error & { cause: unknown }
    failure.cause = cause
    throw failure
  }
  return { width, height }
}

function validateJpeg(bytes: Uint8Array, assetId: string) {
  if (bytes.length < 8 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`Candidate JPEG ${assetId} is missing SOI.`)
  }
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new Error(`Candidate JPEG ${assetId} is missing EOI.`)
  }
  let offset = 2
  let dimensions: { width: number; height: number } | undefined
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) throw new Error(`Candidate JPEG ${assetId} has invalid marker bounds.`)
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length - 2) throw new Error(`Candidate JPEG ${assetId} has truncated marker bounds.`)
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length - 2) {
      throw new Error(`Candidate JPEG ${assetId} has invalid marker bounds.`)
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isSof) {
      if (length < 7) throw new Error(`Candidate JPEG ${assetId} has truncated SOF bounds.`)
      dimensions = {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      }
    }
    offset += length
  }
  if (!dimensions || dimensions.width === 0 || dimensions.height === 0) {
    throw new Error(`Candidate JPEG ${assetId} is missing valid SOF dimensions.`)
  }
  return dimensions
}

export function validateImageRenditionCandidateReferences(
  board: Pick<SavedBoard, 'cards'>,
  references: readonly ImageRenditionCandidateReference[],
) {
  const expectedIds = IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS.map((spec) => spec.assetId)
  const boardImages = board.cards.flatMap((card) => (card.assets ?? [])
    .filter((asset) => asset.kind === 'image')
    .map((asset) => ({ cardId: card.id, asset })))
  const boardIds = boardImages.map(({ asset }) => asset.id)
  const duplicateBoardIds = boardIds.filter((id, index) => boardIds.indexOf(id) !== index)
  if (duplicateBoardIds.length > 0) throw new Error(`Candidate board has duplicate image asset IDs: ${duplicateBoardIds.join(', ')}.`)
  const missingBoardIds = expectedIds.filter((id) => !boardIds.includes(id))
  const extraBoardIds = boardIds.filter((id) => !expectedIds.includes(id as typeof expectedIds[number]))
  if (missingBoardIds.length > 0 || extraBoardIds.length > 0 || boardIds.length !== expectedIds.length) {
    throw new Error(`Candidate board image assets differ from the exact expected nine; missing=${missingBoardIds.join(',') || 'none'}; extra=${extraBoardIds.join(',') || 'none'}.`)
  }

  const referenceIds = references.map((reference) => reference.assetId)
  const duplicateReferenceIds = referenceIds.filter((id, index) => referenceIds.indexOf(id) !== index)
  if (duplicateReferenceIds.length > 0) throw new Error(`Candidate references contain duplicate asset IDs: ${duplicateReferenceIds.join(', ')}.`)
  const missingReferenceIds = expectedIds.filter((id) => !referenceIds.includes(id))
  const extraReferenceIds = referenceIds.filter((id) => !expectedIds.includes(id as typeof expectedIds[number]))
  if (missingReferenceIds.length > 0 || extraReferenceIds.length > 0 || references.length !== expectedIds.length) {
    throw new Error(`Candidate references must contain exactly nine asset IDs; missing=${missingReferenceIds.join(',') || 'none'}; extra=${extraReferenceIds.join(',') || 'none'}.`)
  }

  for (const spec of IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS) {
    const boardImage = boardImages.find(({ asset }) => asset.id === spec.assetId)
    if (
      !boardImage || boardImage.cardId !== spec.cardId ||
      boardImage.asset.width !== spec.width || boardImage.asset.height !== spec.height
    ) {
      throw new Error(`Candidate image asset ${spec.assetId} changed Card ownership or declared dimensions.`)
    }
    const reference = references.find((candidate) => candidate.assetId === spec.assetId)!
    if (reference.mimeType !== spec.mimeType) {
      throw new Error(`Candidate image reference ${spec.assetId} must use ${spec.mimeType}.`)
    }
    const bytes = candidateReferenceBytes(reference)
    const dimensions = reference.mimeType === 'image/png'
      ? validatePng(bytes, spec.assetId)
      : validateJpeg(bytes, spec.assetId)
    if (dimensions.width !== boardImage.asset.width || dimensions.height !== boardImage.asset.height) {
      throw new Error(
        `Candidate image reference ${spec.assetId} intrinsic dimensions ${dimensions.width}x${dimensions.height} ` +
        `do not match declared dimensions ${boardImage.asset.width}x${boardImage.asset.height}.`,
      )
    }
  }
}

export function adaptImageRenditionCandidateBoard(
  board: SavedBoard,
  references: readonly ImageRenditionCandidateReference[],
): SavedBoard {
  validateImageRenditionCandidateReferences(board, references)
  const byAssetId = new Map(references.map((reference) => [reference.assetId, reference]))
  return {
    ...board,
    cards: board.cards.map((card) => {
      if (!card.assets?.some((asset) => byAssetId.has(asset.id))) return card
      return {
        ...card,
        assets: card.assets.map((asset) => {
          const reference = byAssetId.get(asset.id)
          if (!reference) return asset
          const binarySize = Buffer.from(reference.dataUrl.slice(reference.dataUrl.indexOf(',') + 1), 'base64').length
          return {
            ...asset,
            mimeType: reference.mimeType,
            dataUrl: reference.dataUrl,
            size: binarySize,
            compression: 'compressed',
          }
        }),
      }
    }),
  }
}

export type ImageRenditionAppProbe = {
  rootChildCount: number
  performanceRuntime: boolean
  graphRuntime: boolean
  viewportRuntime: boolean
  candidateRuntimePresent: boolean
  candidateEnabled: boolean
  detailNodeCount: number
  overviewCardCount: number
  purposeMarkedImageCount: number
  derivedImageCount: number
  decodedReadyImageCount: number
  imageStatusHistogram: Record<string, number>
  resolverFailures: number
  resolverRequestsByPurpose: ImageRenditionSnapshot['requestsByPurpose']
  consoleErrors: string[]
  pageErrors: string[]
}

type ImageRenditionBrowserErrors = Pick<ImageRenditionAppProbe, 'consoleErrors' | 'pageErrors'>

export type ImageRenditionConsoleMessage = {
  text: string
  location: {
    url?: string
    lineNumber?: number
    columnNumber?: number
  }
}

const BENIGN_FAVICON_404 = 'Failed to load resource: the server responded with a status of 404 (Not Found)'
export const IMAGE_RENDITION_DIAGNOSTIC_LIMITS = {
  maxEntries: 8,
  maxBytes: 4_096,
  probeTimeoutMs: 250,
} as const

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function truncateUtf8(value: string, maxBytes: number) {
  if (utf8Bytes(value) <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (utf8Bytes(value.slice(0, middle)) <= maxBytes) low = middle
    else high = middle - 1
  }
  return value.slice(0, low)
}

function recordBoundedDiagnostic(
  errors: ImageRenditionBrowserErrors,
  target: string[],
  message: string,
) {
  if (errors.consoleErrors.length + errors.pageErrors.length >= IMAGE_RENDITION_DIAGNOSTIC_LIMITS.maxEntries) {
    return
  }
  const usedBytes = utf8Bytes([...errors.consoleErrors, ...errors.pageErrors].join(''))
  const remainingBytes = IMAGE_RENDITION_DIAGNOSTIC_LIMITS.maxBytes - usedBytes
  if (remainingBytes <= 0) return
  const bounded = truncateUtf8(message.replace(/\s+/g, ' ').trim(), remainingBytes)
  if (bounded) target.push(bounded)
}

export function recordImageRenditionConsoleError(
  errors: ImageRenditionBrowserErrors,
  message: ImageRenditionConsoleMessage,
) {
  if (message.text === BENIGN_FAVICON_404 && message.location.url) {
    try {
      const source = new URL(message.location.url)
      if (source.pathname === '/favicon.ico' && !source.search && !source.hash) return
    } catch {
      // An unparseable source is not eligible for the narrow benign allowlist.
    }
  }
  const source = message.location.url || 'unknown-source'
  const line = message.location.lineNumber ?? 0
  const column = message.location.columnNumber ?? 0
  recordBoundedDiagnostic(
    errors,
    errors.consoleErrors,
    `${message.text}; source=${source}:${line}:${column}`,
  )
}

export function recordImageRenditionPageError(
  errors: ImageRenditionBrowserErrors,
  message: string,
) {
  recordBoundedDiagnostic(errors, errors.pageErrors, message)
}

export function assertNoImageRenditionBrowserErrors(errors: ImageRenditionBrowserErrors) {
  if (errors.pageErrors.length === 0 && errors.consoleErrors.length === 0) return
  throw new Error(truncateUtf8(
    `Image rendition browser error: consoleErrors=${errors.consoleErrors.join(' | ') || 'none'}; ` +
    `pageErrors=${errors.pageErrors.join(' | ') || 'none'}`,
    IMAGE_RENDITION_DIAGNOSTIC_LIMITS.maxBytes,
  ))
}

export function imageRenditionCoreReady(probe: ImageRenditionAppProbe) {
  return probe.rootChildCount > 0 &&
    probe.performanceRuntime &&
    probe.graphRuntime &&
    probe.viewportRuntime
}

export function imageRenditionCandidateReady(probe: ImageRenditionAppProbe) {
  return imageRenditionCoreReady(probe) &&
    probe.candidateRuntimePresent &&
    probe.candidateEnabled &&
    probe.detailNodeCount > 0 &&
    probe.purposeMarkedImageCount === 9 &&
    probe.derivedImageCount === 9 &&
    probe.decodedReadyImageCount === 9 &&
    probe.resolverFailures === 0
}

type ImageRenditionDiagnosticElement = {
  complete: boolean
  naturalWidth: number
  getAttribute: (name: string) => string | null
}

type ImageRenditionDiagnosticDocument = {
  querySelectorAll: (selector: string) => ArrayLike<ImageRenditionDiagnosticElement>
}

export function aggregateImageRenditionDocumentState(
  root: ImageRenditionDiagnosticDocument = document as unknown as ImageRenditionDiagnosticDocument,
) {
  const images = Array.from(root.querySelectorAll('img[data-image-rendition-purpose]'))
  const imageStatusHistogram: Record<string, number> = {}
  let derivedImageCount = 0
  let decodedReadyImageCount = 0
  for (const image of images) {
    if (image.getAttribute('data-image-rendition-derived') === 'true') derivedImageCount += 1
    if (image.complete && image.naturalWidth > 0) decodedReadyImageCount += 1
    const status = image.getAttribute('data-image-rendition-status') ?? 'missing'
    imageStatusHistogram[status] = (imageStatusHistogram[status] ?? 0) + 1
  }
  return {
    purposeMarkedImageCount: images.length,
    derivedImageCount,
    decodedReadyImageCount,
    imageStatusHistogram,
  }
}

export type ImageRenditionRepeatedTraversalProbe = {
  failures: number
  images: Array<{
    derived: boolean
    decodedReady: boolean
    inRange: boolean
  }>
}

export function imageRenditionRepeatedTraversalReady(
  probe: ImageRenditionRepeatedTraversalProbe,
) {
  if (probe.failures !== 0 || probe.images.length !== 9) return false
  if (!probe.images.every((image) => image.decodedReady)) return false
  const inRange = probe.images.filter((image) => image.inRange)
  return inRange.length > 0 && inRange.every((image) => image.derived)
}

type ImageRenditionObservedImage = {
  complete: boolean
  naturalWidth: number
  getAttribute: (name: string) => string | null
}

type ImageRenditionObserverEntry = {
  target: ImageRenditionObservedImage
  isIntersecting: boolean
}

type ImageRenditionObserver = {
  observe: (image: ImageRenditionObservedImage) => void
  disconnect: () => void
}

export async function readImageRenditionRepeatedTraversalProbe(injected?: {
  getSnapshot: () => ImageRenditionSnapshot
  queryImages: () => ArrayLike<ImageRenditionObservedImage>
  createObserver: (
    callback: (entries: ArrayLike<ImageRenditionObserverEntry>) => void,
    options: { root: null; rootMargin: '320px' },
  ) => ImageRenditionObserver
}) {
  let getSnapshot: () => ImageRenditionSnapshot
  let images: ImageRenditionObservedImage[]
  let createObserver: NonNullable<typeof injected>['createObserver']
  if (injected) {
    getSnapshot = injected.getSnapshot
    images = Array.from(injected.queryImages())
    createObserver = injected.createObserver
  } else {
    const candidate = (window as unknown as {
      __EIDO_IMAGE_RENDITION_CANDIDATE__?: { snapshot: () => ImageRenditionSnapshot }
    }).__EIDO_IMAGE_RENDITION_CANDIDATE__
    if (!candidate) throw new Error('Missing image rendition candidate runtime')
    getSnapshot = () => candidate.snapshot()
    images = Array.from(document.querySelectorAll<HTMLImageElement>(
      'img[data-image-rendition-purpose]',
    ))
    createObserver = (callback, options) => {
      const observer = new IntersectionObserver((entries) => callback(entries.map((entry) => ({
        target: entry.target as HTMLImageElement,
        isIntersecting: entry.isIntersecting,
      }))), options)
      return {
        observe: (image) => observer.observe(image as HTMLImageElement),
        disconnect: () => observer.disconnect(),
      }
    }
  }
  const initialEntries = new Map<ImageRenditionObservedImage, boolean>()
  const currentImages = new Set(images)
  let completed = false
  let resolveInitialEntries!: (entries: Map<ImageRenditionObservedImage, boolean>) => void
  const initialEntriesPromise = new Promise<Map<ImageRenditionObservedImage, boolean>>((resolve) => {
    resolveInitialEntries = resolve
  })
  const observer = createObserver((entries) => {
    if (completed) return
    for (const entry of Array.from(entries)) {
      if (currentImages.has(entry.target) && !initialEntries.has(entry.target)) {
        initialEntries.set(entry.target, entry.isIntersecting)
      }
    }
    if (initialEntries.size === images.length) {
      completed = true
      resolveInitialEntries(initialEntries)
    }
  }, { root: null, rootMargin: '320px' })
  let inRangeByImage: Map<ImageRenditionObservedImage, boolean>
  let snapshot: ImageRenditionSnapshot
  try {
    if (images.length === 0) {
      completed = true
      resolveInitialEntries(initialEntries)
    } else {
      for (const image of images) observer.observe(image)
    }
    inRangeByImage = await initialEntriesPromise
    snapshot = getSnapshot()
  } finally {
    observer.disconnect()
  }
  return {
    snapshot,
    value: {
      failures: snapshot.failures,
      images: images.map((image) => ({
        derived: image.getAttribute('data-image-rendition-derived') === 'true',
        decodedReady: image.complete && image.naturalWidth > 0,
        inRange: inRangeByImage.get(image) === true,
      })),
    },
  }
}

type CandidateImageElement = {
  decode: () => Promise<void>
  getAttribute: (name: string) => string | null
}

type CandidateImageDocument = {
  querySelectorAll: (selector: string) => ArrayLike<CandidateImageElement>
  contains: (image: CandidateImageElement) => boolean
}

export async function decodeExactImageRenditionsInDocument(
  options: { selector: string; expectedCount: number },
  root: CandidateImageDocument = document as unknown as CandidateImageDocument,
) {
  const images = Array.from(root.querySelectorAll(options.selector))
  if (images.length !== options.expectedCount) {
    throw new Error(`Expected exactly ${options.expectedCount} current derived rendition images; found ${images.length}.`)
  }
  const evidence = images.map((image) => ({
    image,
    src: image.getAttribute('src'),
    purpose: image.getAttribute('data-image-rendition-purpose'),
    derived: image.getAttribute('data-image-rendition-derived'),
  }))
  if (evidence.some(({ src, purpose, derived }) => !src || !purpose || derived !== 'true')) {
    throw new Error('Every candidate image must have a source, derived marker, and rendition purpose before decode.')
  }
  await Promise.all(images.map((image) => image.decode()))
  const currentImages = Array.from(root.querySelectorAll(options.selector))
  if (currentImages.length !== options.expectedCount) {
    throw new Error(`Expected exactly ${options.expectedCount} current derived rendition images after decode; found ${currentImages.length}.`)
  }
  if (images.some((image) => !root.contains(image))) {
    throw new Error('A decoded derived rendition image was detached before readiness.')
  }
  if (currentImages.some((image) => !images.includes(image))) {
    throw new Error('The current derived rendition image set changed during decode.')
  }
  for (const item of evidence) {
    if (item.image.getAttribute('src') !== item.src) {
      throw new Error('A derived rendition image src changed during decode.')
    }
    if (
      item.image.getAttribute('data-image-rendition-purpose') !== item.purpose ||
      item.image.getAttribute('data-image-rendition-derived') !== item.derived
    ) {
      throw new Error('A derived rendition image purpose or derived marker changed during decode.')
    }
  }
}

export function formatImageRenditionStartupDiagnostic(probe: ImageRenditionAppProbe) {
  const state = [
    `rootChildCount=${probe.rootChildCount}`,
    `performanceRuntime=${probe.performanceRuntime}`,
    `graphRuntime=${probe.graphRuntime}`,
    `viewportRuntime=${probe.viewportRuntime}`,
    `candidateRuntimePresent=${probe.candidateRuntimePresent}`,
    `candidateEnabled=${probe.candidateEnabled}`,
    `detailNodeCount=${probe.detailNodeCount}`,
    `overviewCardCount=${probe.overviewCardCount}`,
    `purposeMarkedImageCount=${probe.purposeMarkedImageCount}`,
    `derivedImageCount=${probe.derivedImageCount}`,
    `decodedReadyImageCount=${probe.decodedReadyImageCount}`,
    `imageStatusHistogram=${JSON.stringify(probe.imageStatusHistogram)}`,
    `resolverFailures=${probe.resolverFailures}`,
    `resolverRequestsByPurpose=${JSON.stringify(probe.resolverRequestsByPurpose)}`,
  ].join(', ')
  const errors: ImageRenditionBrowserErrors = { consoleErrors: [], pageErrors: [] }
  for (const message of probe.consoleErrors) recordBoundedDiagnostic(errors, errors.consoleErrors, message)
  for (const message of probe.pageErrors) recordBoundedDiagnostic(errors, errors.pageErrors, message)
  const consoleErrors = errors.consoleErrors.length ? errors.consoleErrors.join(' | ') : 'none'
  const pageErrors = errors.pageErrors.length ? errors.pageErrors.join(' | ') : 'none'
  return truncateUtf8(
    `${state}; consoleErrors=${consoleErrors}; pageErrors=${pageErrors}`,
    IMAGE_RENDITION_DIAGNOSTIC_LIMITS.maxBytes,
  )
}

export async function diagnoseImageRenditionFailure(
  cause: unknown,
  readProbe: () => Promise<ImageRenditionAppProbe>,
  probeTimeoutMs: number = IMAGE_RENDITION_DIAGNOSTIC_LIMITS.probeTimeoutMs,
): Promise<Error & { cause: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let diagnostic: string
  try {
    const probe = await Promise.race([
      Promise.resolve().then(readProbe),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${probeTimeoutMs}ms`)), probeTimeoutMs)
      }),
    ])
    diagnostic = formatImageRenditionStartupDiagnostic(probe)
  } catch (probeError) {
    const fallback = probeError instanceof Error ? probeError.message : String(probeError)
    diagnostic = `diagnostic probe unavailable: ${fallback}`
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }

  const causeSummary = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
  const failure = new Error(truncateUtf8(
    `Image rendition candidate run failed; originalCause=${causeSummary}; diagnostics=${diagnostic}`,
    IMAGE_RENDITION_DIAGNOSTIC_LIMITS.maxBytes,
  )) as Error & { cause: unknown }
  failure.cause = cause
  return failure
}

export type ImageRenditionFixtureCase = {
  id: string
  sourceWidth: number
  sourceHeight: number
  alpha: boolean
  displayWidth: number
  displayHeight: number
}

export type ImageCompressionSample = {
  id: string
  width: number
  height: number
  alpha: boolean
  sourceBytes: number
  decodeMs: number
  encodeMs: number
  totalMs: number
  encodeAttempts: number
  storedDataUrlBytes: number
  compressedBytes: number
}

export type ImageRenditionTraversal = {
  repetition: number
  cameraSpeed: (typeof IMAGE_RENDITION_CANDIDATE_CONTRACT.cameraSpeeds)[number]
  warmth: (typeof IMAGE_RENDITION_CANDIDATE_CONTRACT.warmth)[number]
  durationMs: number
  firstDecodeMs: number
  paintCompositeMs: number
  readinessMs: number
  cacheGrowthBytes: number
  blankReplacements: number
  offscreenSharperRenders: number
  snapshot: ImageRenditionSnapshot
}

export function assertNoImageRenditionResolverFailures(
  snapshot: Pick<ImageRenditionSnapshot, 'failures'>,
  stage: string,
) {
  if (snapshot.failures !== 0) {
    throw new Error(`Image rendition resolver recorded ${snapshot.failures} failure(s) ${stage}.`)
  }
}

export async function waitForImageRenditionResolverCondition<T>(options: {
  stage: string
  timeoutMs: number
  readProbe: () => Promise<{
    snapshot: Pick<ImageRenditionSnapshot, 'failures' | 'requestsByPurpose'>
    value: T
  }>
  isReady: (value: T) => boolean
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
}) {
  const now = options.now ?? Date.now
  const wait = options.wait ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const startedAt = now()
  while (true) {
    const probe = await options.readProbe()
    assertNoImageRenditionResolverFailures(probe.snapshot, `during ${options.stage}`)
    if (options.isReady(probe.value)) return probe.value
    if (now() - startedAt >= options.timeoutMs) {
      throw new Error(
        `Timed out after ${options.timeoutMs}ms waiting for ${options.stage}; ` +
        `requestsByPurpose=${JSON.stringify(probe.snapshot.requestsByPurpose)}.`,
      )
    }
    await wait(50)
  }
}

type ImageRenditionGalleryProbeImage = {
  derived: boolean
  complete: boolean
  naturalWidth: number
  decode: () => Promise<void>
}

export async function readImageRenditionGalleryProbe(options?: {
  getSnapshot: () => Pick<ImageRenditionSnapshot, 'failures' | 'requestsByPurpose'>
  getImage: () => ImageRenditionGalleryProbeImage | undefined
}) {
  let snapshot: Pick<ImageRenditionSnapshot, 'failures' | 'requestsByPurpose'>
  let image: ImageRenditionGalleryProbeImage | HTMLImageElement | undefined
  if (options) {
    snapshot = options.getSnapshot()
    image = options.getImage()
  } else {
    const candidate = (window as unknown as {
      __EIDO_IMAGE_RENDITION_CANDIDATE__?: { snapshot: () => ImageRenditionSnapshot }
    }).__EIDO_IMAGE_RENDITION_CANDIDATE__
    if (!candidate) throw new Error('Missing image rendition candidate runtime')
    snapshot = candidate.snapshot()
    image = document.querySelector<HTMLImageElement>(
      '.gallery-stage img[data-image-rendition-purpose="gallery"]',
    ) ?? undefined
  }

  const derived = image
    ? ('derived' in image ? image.derived : image.dataset.imageRenditionDerived === 'true')
    : false
  let decodedReady = false
  if (image && derived) {
    try {
      await image.decode()
    } catch (cause) {
      const causeSummary = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
      const failure = new Error(
        `Gallery image decode failed during gallery derived and decoded readiness; originalCause=${causeSummary}`,
      ) as Error & { cause: unknown }
      failure.cause = cause
      throw failure
    }
    decodedReady = image.complete && image.naturalWidth > 0
  }
  return { snapshot, value: { derived, decodedReady } }
}

type ImageRenditionGalleryCaption = {
  textContent: string | null
  getBoundingClientRect: () => { width: number; height: number }
}

type ImageRenditionGalleryCaptionDocument = {
  querySelectorAll: (selector: string) => ArrayLike<ImageRenditionGalleryCaption>
  contains: (element: ImageRenditionGalleryCaption) => boolean
  createRange: () => { selectNodeContents: (node: ImageRenditionGalleryCaption) => void }
}

type ImageRenditionGalleryCaptionSelection = {
  removeAllRanges: () => void
  addRange: (range: unknown) => void
  toString: () => string
}

export function selectExactImageRenditionGalleryCaption(
  target: string,
  options: {
    document?: ImageRenditionGalleryCaptionDocument
    getComputedStyle?: (element: ImageRenditionGalleryCaption) => { display: string; visibility: string }
    getSelection?: () => ImageRenditionGalleryCaptionSelection | null
  } = {},
) {
  const pageDocument = options.document ?? document as unknown as ImageRenditionGalleryCaptionDocument
  const getComputedStyleForCaption = options.getComputedStyle ??
    ((element) => window.getComputedStyle(element as unknown as Element))
  const getSelection = options.getSelection ??
    (() => window.getSelection() as unknown as ImageRenditionGalleryCaptionSelection | null)
  const captions = Array.from(pageDocument.querySelectorAll('.gallery-stage figure > figcaption > span'))
    .filter((caption) => {
      const style = getComputedStyleForCaption(caption)
      const rect = caption.getBoundingClientRect()
      return pageDocument.contains(caption) && rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden'
    })
    .filter((caption) => caption.textContent === target)
  if (captions.length !== 1) {
    throw new Error(`Expected exactly one visible connected gallery caption equal to ${target}; found ${captions.length}.`)
  }
  const selection = getSelection()
  if (!selection) throw new Error('window.getSelection returned null for gallery caption copy.')
  const range = pageDocument.createRange()
  range.selectNodeContents(captions[0])
  selection.removeAllRanges()
  selection.addRange(range)
  if (selection.toString() !== target) {
    selection.removeAllRanges()
    throw new Error(`Gallery caption selection did not exactly equal ${target}.`)
  }
  return target
}

type ImageRenditionGalleryOpenCaption = ImageRenditionGalleryCaption & {
  contains: (node: unknown) => boolean
}

type ImageRenditionGalleryCaptionAfterCopySelection = {
  toString: () => string
  rangeCount: number
  getRangeAt: (index: number) => { commonAncestorContainer: unknown }
}

export function assertExactImageRenditionGalleryCaptionAfterCopy(
  target: string,
  options: {
    document?: Pick<ImageRenditionGalleryCaptionDocument, 'contains'> & {
      querySelectorAll: (selector: string) => ArrayLike<ImageRenditionGalleryOpenCaption>
    }
    getComputedStyle?: (element: ImageRenditionGalleryOpenCaption) => { display: string; visibility: string }
    getSelection?: () => ImageRenditionGalleryCaptionAfterCopySelection | null
  } = {},
) {
  const pageDocument = options.document ?? document as unknown as NonNullable<typeof options.document>
  const getComputedStyleForCaption = options.getComputedStyle ??
    ((element) => window.getComputedStyle(element as unknown as Element))
  const getSelection = options.getSelection ??
    (() => window.getSelection() as unknown as ImageRenditionGalleryCaptionAfterCopySelection | null)
  const captions = Array.from(pageDocument.querySelectorAll(
    '.gallery-stage figure > figcaption > span',
  )).filter((caption) => {
    const style = getComputedStyleForCaption(caption)
    const rect = caption.getBoundingClientRect()
    return pageDocument.contains(caption) && rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' && style.visibility !== 'hidden' && caption.textContent === target
  })
  if (captions.length !== 1) {
    throw new Error(`Expected the copied gallery caption to remain uniquely visible as ${target}; found ${captions.length}.`)
  }
  const selection = getSelection()
  if (!selection || selection.toString() !== target || selection.rangeCount !== 1) {
    throw new Error(`Gallery caption selection changed after copy; expected ${target}.`)
  }
  const selectedNode = selection.getRangeAt(0).commonAncestorContainer
  if (!captions[0].contains(selectedNode)) {
    throw new Error('Gallery caption selection no longer belongs to the open gallery caption after copy.')
  }
  return target
}

export function assertExactImageRenditionGalleryCaptionCopy(
  target: string,
  intendedText: string,
  copiedText: string,
) {
  if (intendedText !== target || copiedText !== target) {
    throw new Error(`Synthetic gallery caption copy/readback did not equal ${target}.`)
  }
}

export async function runImageRenditionCandidateObservationWorkflow<TStartup, TGallery, TCopy>(options: {
  mode: 'capture' | 'probe'
  observeStartup: () => Promise<TStartup>
  observeTraversals: () => Promise<void>
  activateGallery: (measured: boolean) => Promise<TGallery>
  observeCopy: () => Promise<TCopy>
}) {
  const startup = await options.observeStartup()
  await options.observeTraversals()
  const gallery = await options.activateGallery(options.mode === 'capture')
  const copy = await options.observeCopy()
  return { startup, gallery, copy }
}

export const IMAGE_RENDITION_CANDIDATE_LIMITATIONS = {
  search: {
    method: 'window.find over mounted visible synthetic asset-name text.',
    unmeasured: [
      'Image pixels and OCR.',
      'Application semantic search.',
      'Unmounted or offscreen asset indexing.',
    ],
  },
  copy: {
    method: 'Exact visible gallery caption DOM selection copied through a real browser keyboard copy gesture and read back from the granted synthetic-test clipboard.',
    unmeasured: [
      'Bitmap, data-URL, and image metadata copy.',
      'Operating-system and cross-application interoperability.',
    ],
  },
  accessibility: {
    method: 'Chromium Accessibility.getFullAXTree role/name match for a mounted synthetic image.',
    unmeasured: [
      'Real assistive-technology behavior.',
      'Reading order, announcements, contrast, and zoom.',
      'Complete keyboard and focus navigation.',
    ],
  },
} as const

export type ImageRenditionCandidateArtifact = {
  schemaVersion: 2
  contractId: typeof IMAGE_RENDITION_CANDIDATE_CONTRACT.id
  candidate: {
    enabled: true
    description: string
    productionDefaultChanged: false
  }
  environment: {
    provider: string
    os: string
    cpu: string
    logicalCores: number
    memoryBytes: number
    browser: string
    node: string
    commit: string
    capturedAt: string
  }
  capture: {
    commands: string[]
    runner: string
    sourceRunUrl?: string
  }
  limitations: {
    preAuthorizedSacrifice: false
    search: {
      status: 'observed'
      target: string
      found: true
      method: string
      unmeasured: string[]
    }
    copy: {
      status: 'observed'
      intendedText: string
      copiedText: string
      method: string
      unmeasured: string[]
    }
    accessibility: {
      status: 'observed'
      role: 'image'
      expectedName: string
      matchingNodes: number
      method: string
      unmeasured: string[]
    }
  }
  budgets: {
    maxDecodedBytes: number
    maxRenditionBytes: number
    maxPreloadEntries: number
  }
  baseline: {
    commit: string
    storedCompressedBytes: number
    decodedPixelEstimateBytes: number
    coldDecodeMs: number
    warmDecodeMs: number
    coldPaintCompositeMs: number
    warmPaintCompositeMs: number
  }
  fixture: {
    id: typeof IMAGE_RENDITION_CANDIDATE_CONTRACT.fixtureId
    referencePolicy: string
    referenceComparison: {
      canonical: {
        storedCompressedBytes: number
        mimeHistogram: Record<string, number>
      }
      candidate: {
        storedCompressedBytes: number
        mimeHistogram: Record<string, number>
      }
      storageAssessment: 'unmeasured-confounded'
    }
    imageCount: number
    cases: ImageRenditionFixtureCase[]
    boardJsonBytesBefore: number
    boardJsonBytesAfter: number
    serializationMs: number
    storedCompressedBytesBefore: number
    storedCompressedBytesAfter: number
  }
  pasteCompression: {
    samples: ImageCompressionSample[]
    serializationMs: number
    serializedBytes: number
  }
  traversals: ImageRenditionTraversal[]
  gallery: {
    activationMs: number
    settledReadyMs: number
    cardBoundsBefore: { width: number; height: number }
    cardBoundsAfter: { width: number; height: number }
    purpose: 'gallery'
    derived: boolean
  }
  authoritative: {
    boardReferencesBefore: string[]
    boardReferencesAfter: string[]
    derivedReferenceLeaks: number
    aiCompatibilityTest: string
    exportCompatibilityTest: string
  }
}

type ImageRenditionArtifactFileSystem = {
  mkdirSync: (directory: string, options: { recursive: true }) => unknown
  writeFileSync: (file: string, contents: string) => unknown
  renameSync: (from: string, to: string) => unknown
  rmSync: (file: string, options: { force: true }) => unknown
}

const NODE_ARTIFACT_FILE_SYSTEM: ImageRenditionArtifactFileSystem = {
  mkdirSync: nodeFs.mkdirSync,
  writeFileSync: nodeFs.writeFileSync,
  renameSync: (nodeFs as unknown as ImageRenditionArtifactFileSystem).renameSync,
  rmSync: (nodeFs as unknown as ImageRenditionArtifactFileSystem).rmSync,
}

export async function publishImageRenditionCandidateArtifact(options: {
  artifact: ImageRenditionCandidateArtifact
  artifactPath: string
  awaitBrowserBarrier: () => void | Promise<void>
  assertBrowserState: () => void | Promise<void>
  assertResolverState: () => void | Promise<void>
  fileSystem?: ImageRenditionArtifactFileSystem
}) {
  const fileSystem = options.fileSystem ?? NODE_ARTIFACT_FILE_SYSTEM
  const temporaryPath = `${options.artifactPath}.tmp`
  const removePublication = () => {
    try { fileSystem.rmSync(temporaryPath, { force: true }) } catch { /* preserve original failure */ }
    try { fileSystem.rmSync(options.artifactPath, { force: true }) } catch { /* preserve original failure */ }
  }

  try {
    removePublication()
    await options.awaitBrowserBarrier()
    await options.assertBrowserState()
    await options.assertResolverState()
    assertImageRenditionCandidateArtifact(options.artifact)
    fileSystem.mkdirSync(path.dirname(options.artifactPath), { recursive: true })
    fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(options.artifact, null, 2)}\n`)
    fileSystem.renameSync(temporaryPath, options.artifactPath)
  } catch (cause) {
    removePublication()
    throw cause
  }
}

const PRIVACY_PATTERN = /(?:\/Users\/|\/home\/|\\Users\\|\.eido|eido-v3-ideas|BEGIN (?:RSA|OPENSSH) PRIVATE KEY|gh[pousr]_[A-Za-z0-9_]+)/i

export const DEFAULT_IMAGE_RENDITION_CANDIDATE_RAW_ARTIFACT_PATH =
  'src/performance/baselines/imageRenditionCandidate.raw.json'
export const DEFAULT_IMAGE_RENDITION_CANDIDATE_REPORT_PATH =
  'research/03-performance-architecture/16-image-rendition-candidate.md'

export function generateImageRenditionCandidateReport(options: {
  root?: string
  artifactPath?: string
  reportPath?: string
  fileSystem?: ImageRenditionArtifactFileSystem
} = {}) {
  const root = options.root ?? '.'
  const artifactPath = options.artifactPath ?? path.join(root, DEFAULT_IMAGE_RENDITION_CANDIDATE_RAW_ARTIFACT_PATH)
  const reportPath = options.reportPath ?? path.join(root, DEFAULT_IMAGE_RENDITION_CANDIDATE_REPORT_PATH)
  const temporaryPath = `${reportPath}.tmp`
  const fileSystem = options.fileSystem ?? NODE_ARTIFACT_FILE_SYSTEM
  const artifact = JSON.parse(nodeFs.readFileSync(artifactPath, 'utf8')) as ImageRenditionCandidateArtifact

  assertImageRenditionCandidateArtifact(artifact)
  const report = renderImageRenditionCandidateReport(artifact)
  const removeTemporaryReport = () => {
    try { fileSystem.rmSync(temporaryPath, { force: true }) } catch { /* preserve publication failure */ }
  }

  try {
    removeTemporaryReport()
    fileSystem.mkdirSync(path.dirname(reportPath), { recursive: true })
    fileSystem.writeFileSync(temporaryPath, report)
    fileSystem.renameSync(temporaryPath, reportPath)
  } catch (cause) {
    removeTemporaryReport()
    throw cause
  }

  return { report, reportPath }
}

function assertNonNegative(path: string, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Image rendition artifact has invalid non-negative metric ${path}: ${String(value)}.`)
  }
}

function assertNonNegativeInteger(path: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`Image rendition artifact has invalid non-negative integer metric ${path}: ${String(value)}.`)
  }
}

export function assertImageRenditionCandidateArtifact(
  artifact: ImageRenditionCandidateArtifact,
): asserts artifact is ImageRenditionCandidateArtifact {
  if (
    artifact.schemaVersion !== 2 ||
    artifact.contractId !== IMAGE_RENDITION_CANDIDATE_CONTRACT.id
  ) {
    throw new Error(`Image rendition artifact must match ${IMAGE_RENDITION_CANDIDATE_CONTRACT.id}.`)
  }
  if (PRIVACY_PATTERN.test(JSON.stringify(artifact))) {
    throw new Error('Image rendition artifact failed the privacy scan.')
  }
  const limitations = artifact.limitations
  if (!limitations || limitations.preAuthorizedSacrifice !== false) {
    throw new Error('Image rendition artifact limitations must pre-authorize no sacrifice.')
  }
  if (
    limitations.search.status !== 'observed' ||
    limitations.copy.status !== 'observed' ||
    limitations.accessibility.status !== 'observed'
  ) {
    throw new Error('Image rendition limitations must be observed; unavailable evidence is not publishable.')
  }
  if (!limitations.search.found || limitations.search.target.trim().length === 0) {
    throw new Error('Image rendition search limitations must prove a nonblank found target.')
  }
  if (
    limitations.copy.intendedText.trim().length === 0 ||
    limitations.copy.intendedText !== limitations.copy.copiedText ||
    limitations.search.target !== limitations.copy.intendedText ||
    limitations.search.target !== limitations.accessibility.expectedName
  ) {
    throw new Error('Image rendition copy and accessibility limitations must agree with the search target.')
  }
  if (
    limitations.accessibility.role !== 'image' ||
    !Number.isInteger(limitations.accessibility.matchingNodes) ||
    limitations.accessibility.matchingNodes <= 0
  ) {
    throw new Error('Image rendition accessibility limitations must prove a positive image role/name match.')
  }
  if (
    limitations.search.method !== IMAGE_RENDITION_CANDIDATE_LIMITATIONS.search.method ||
    JSON.stringify(limitations.search.unmeasured) !== JSON.stringify(IMAGE_RENDITION_CANDIDATE_LIMITATIONS.search.unmeasured) ||
    limitations.copy.method !== IMAGE_RENDITION_CANDIDATE_LIMITATIONS.copy.method ||
    JSON.stringify(limitations.copy.unmeasured) !== JSON.stringify(IMAGE_RENDITION_CANDIDATE_LIMITATIONS.copy.unmeasured) ||
    limitations.accessibility.method !== IMAGE_RENDITION_CANDIDATE_LIMITATIONS.accessibility.method ||
    JSON.stringify(limitations.accessibility.unmeasured) !== JSON.stringify(IMAGE_RENDITION_CANDIDATE_LIMITATIONS.accessibility.unmeasured)
  ) {
    throw new Error('Image rendition limitation methods and unmeasured boundaries must use the fixed contract.')
  }
  if (!artifact.candidate.enabled || artifact.candidate.productionDefaultChanged) {
    throw new Error('Image rendition artifact must use the explicit candidate while leaving the production default unchanged.')
  }
  if (artifact.fixture.id !== IMAGE_RENDITION_CANDIDATE_CONTRACT.fixtureId) {
    throw new Error(`Image rendition fixture must be ${IMAGE_RENDITION_CANDIDATE_CONTRACT.fixtureId}.`)
  }
  if (
    !/candidate-only.*PNG\/JPEG/i.test(artifact.fixture.referencePolicy) ||
    !/legacy.*SVG.*authoritative fallback/i.test(artifact.fixture.referencePolicy) ||
    !/canonical #402.*unchanged/i.test(artifact.fixture.referencePolicy)
  ) {
    throw new Error('Image rendition fixture must disclose its candidate-only raster reference policy.')
  }
  const comparison = artifact.fixture.referenceComparison
  if (comparison.storageAssessment !== 'unmeasured-confounded') {
    throw new Error('Candidate storage impact must remain unmeasured and confounded by substituted references.')
  }
  if (comparison.canonical.storedCompressedBytes !== artifact.baseline.storedCompressedBytes) {
    throw new Error('Canonical stored bytes must match the retained canonical baseline.')
  }
  if (
    comparison.candidate.storedCompressedBytes !== artifact.fixture.storedCompressedBytesBefore ||
    comparison.candidate.storedCompressedBytes !== artifact.fixture.storedCompressedBytesAfter
  ) {
    throw new Error('Candidate stored bytes must match both within-candidate cache-integrity observations.')
  }
  const canonicalMimeCount = Object.values(comparison.canonical.mimeHistogram)
    .reduce((total, count) => total + count, 0)
  const candidateMimeCount = Object.values(comparison.candidate.mimeHistogram)
    .reduce((total, count) => total + count, 0)
  if (
    canonicalMimeCount !== artifact.fixture.imageCount ||
    candidateMimeCount !== artifact.fixture.imageCount ||
    JSON.stringify(comparison.canonical.mimeHistogram) === JSON.stringify(comparison.candidate.mimeHistogram) ||
    comparison.canonical.storedCompressedBytes === comparison.candidate.storedCompressedBytes
  ) {
    throw new Error('Canonical-versus-candidate MIME and stored-byte divergence must be represented explicitly.')
  }
  if (
    Object.keys(comparison.candidate.mimeHistogram)
      .some((mimeType) => mimeType !== 'image/png' && mimeType !== 'image/jpeg')
  ) {
    throw new Error('Candidate MIME evidence must contain only current PNG/JPEG compression outputs.')
  }
  if (artifact.fixture.cases.length < 3 || artifact.fixture.imageCount < artifact.fixture.cases.length) {
    throw new Error('Image rendition fixture must retain varied deterministic image cases.')
  }
  if (
    !artifact.fixture.cases.some((image) => image.alpha) ||
    !artifact.fixture.cases.some((image) => !image.alpha) ||
    new Set(artifact.fixture.cases.map((image) => `${image.sourceWidth}x${image.sourceHeight}`)).size < 3 ||
    new Set(artifact.fixture.cases.map((image) => `${image.displayWidth}x${image.displayHeight}`)).size < 2
  ) {
    throw new Error('Image rendition fixture must vary dimensions, alpha, and display size.')
  }
  if (
    artifact.fixture.boardJsonBytesBefore !== artifact.fixture.boardJsonBytesAfter ||
    artifact.fixture.storedCompressedBytesBefore !== artifact.fixture.storedCompressedBytesAfter
  ) {
    throw new Error('Derived renditions must not change within-candidate Board or stored-byte cache integrity.')
  }
  if (
    artifact.pasteCompression.samples.length < 2 ||
    !artifact.pasteCompression.samples.some((sample) => sample.alpha) ||
    !artifact.pasteCompression.samples.some((sample) => !sample.alpha)
  ) {
    throw new Error('Paste compression evidence must include transparent and opaque samples.')
  }
  if (artifact.traversals.length < IMAGE_RENDITION_CANDIDATE_CONTRACT.minimumTraversals) {
    throw new Error('Image rendition evidence requires repeated traversal.')
  }
  for (const speed of IMAGE_RENDITION_CANDIDATE_CONTRACT.cameraSpeeds) {
    if (!artifact.traversals.some((traversal) => traversal.cameraSpeed === speed)) {
      throw new Error(`Image rendition evidence is missing camera speed ${speed}.`)
    }
  }
  for (const warmth of IMAGE_RENDITION_CANDIDATE_CONTRACT.warmth) {
    if (!artifact.traversals.some((traversal) => traversal.warmth === warmth)) {
      throw new Error(`Image rendition evidence is missing ${warmth} cache readiness.`)
    }
  }
  for (const traversal of artifact.traversals) {
    assertNoImageRenditionResolverFailures(
      traversal.snapshot,
      `during traversal ${traversal.repetition}`,
    )
    if (traversal.snapshot.decodedBytes > artifact.budgets.maxDecodedBytes) {
      throw new Error(`Traversal ${traversal.repetition} exceeded the decoded byte budget.`)
    }
    if (traversal.snapshot.renditionBytes > artifact.budgets.maxRenditionBytes) {
      throw new Error(`Traversal ${traversal.repetition} exceeded the rendition byte budget.`)
    }
    if (traversal.blankReplacements !== 0) {
      throw new Error(`Traversal ${traversal.repetition} replaced a prepared image with blank.`)
    }
    if (traversal.offscreenSharperRenders !== 0) {
      throw new Error(`Traversal ${traversal.repetition} rendered a sharper offscreen image.`)
    }
    assertNonNegativeInteger(
      `traversals[${traversal.repetition}].snapshot.motionDeferred`,
      traversal.snapshot.motionDeferred,
    )
    assertNonNegativeInteger(
      `traversals[${traversal.repetition}].snapshot.offscreenDeferred`,
      traversal.snapshot.offscreenDeferred,
    )
    for (const [path, value] of Object.entries({
      durationMs: traversal.durationMs,
      firstDecodeMs: traversal.firstDecodeMs,
      paintCompositeMs: traversal.paintCompositeMs,
      readinessMs: traversal.readinessMs,
      cacheGrowthBytes: traversal.cacheGrowthBytes,
    })) {
      assertNonNegative(`traversals[${traversal.repetition}].${path}`, value)
    }
  }
  const evictionProof = Math.max(...artifact.traversals.map((traversal) => traversal.snapshot.evictions))
  const revocationProof = Math.max(...artifact.traversals.map((traversal) => traversal.snapshot.revocations))
  if (evictionProof <= 0 || revocationProof < evictionProof) {
    throw new Error('Repeated traversal must prove LRU eviction and object-URL revocation.')
  }
  if (
    JSON.stringify(artifact.authoritative.boardReferencesBefore) !==
      JSON.stringify(artifact.authoritative.boardReferencesAfter) ||
    artifact.authoritative.derivedReferenceLeaks !== 0
  ) {
    throw new Error('Authoritative Board image references changed or contain a derived rendition.')
  }
  if (
    artifact.gallery.purpose !== 'gallery' ||
    !artifact.gallery.derived ||
    JSON.stringify(artifact.gallery.cardBoundsBefore) !== JSON.stringify(artifact.gallery.cardBoundsAfter)
  ) {
    throw new Error('Gallery must reach a derived gallery rendition without resizing the Card.')
  }
  if (artifact.capture.commands.length === 0 || artifact.capture.runner.length === 0) {
    throw new Error('Image rendition artifact must identify its provider capture.')
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function bytes(value: number) {
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`
}

function formatMimeHistogram(histogram: Record<string, number>) {
  return Object.entries(histogram)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mimeType, count]) => `${mimeType}=${count}`)
    .join(', ')
}

export function renderImageRenditionCandidateReport(
  artifact: ImageRenditionCandidateArtifact,
): string {
  assertImageRenditionCandidateArtifact(artifact)
  const cold = artifact.traversals.filter((traversal) => traversal.warmth === 'cold')
  const warm = artifact.traversals.filter((traversal) => traversal.warmth === 'warm')
  const peakDecoded = Math.max(...artifact.traversals.map((traversal) => traversal.snapshot.peakDecodedBytes))
  const peakRendition = Math.max(...artifact.traversals.map((traversal) => traversal.snapshot.peakRenditionBytes))
  const evictions = Math.max(...artifact.traversals.map((traversal) => traversal.snapshot.evictions))
  const motionDeferred = Math.max(...artifact.traversals.map((traversal) => traversal.snapshot.motionDeferred))
  const offscreenDeferred = Math.max(...artifact.traversals.map((traversal) => traversal.snapshot.offscreenDeferred))
  const cameraCounts = IMAGE_RENDITION_CANDIDATE_CONTRACT.cameraSpeeds.map((speed) =>
    artifact.traversals.filter((traversal) => traversal.cameraSpeed === speed).length)
  const renderingMaterial = peakDecoded <= artifact.baseline.decodedPixelEstimateBytes * 0.5
  const renderingConclusion = renderingMaterial
    ? 'image rendering materially contributes at runtime'
    : 'this evidence does not show a material runtime image-rendering contribution'
  const pasteRows = artifact.pasteCompression.samples.map((sample) =>
    `| ${sample.id} | ${sample.width}×${sample.height} | ${sample.alpha} | ${sample.decodeMs.toFixed(1)} | ${sample.encodeMs.toFixed(1)} | ${sample.totalMs.toFixed(1)} | ${sample.storedDataUrlBytes} |`,
  ).join('\n')
  const traversalRows = artifact.traversals.map((traversal) =>
    `| ${traversal.repetition} | ${traversal.cameraSpeed} | ${traversal.warmth} | ${traversal.readinessMs.toFixed(1)} | ${traversal.paintCompositeMs.toFixed(1)} | ${bytes(traversal.snapshot.decodedBytes)} | ${bytes(traversal.snapshot.renditionBytes)} | ${bytes(traversal.cacheGrowthBytes)} | ${traversal.snapshot.evictions} | ${traversal.snapshot.motionDeferred} | ${traversal.snapshot.offscreenDeferred} |`,
  ).join('\n')
  const limitationRows = [
    ['Search', `found \`${artifact.limitations.search.target}\``, artifact.limitations.search.method, artifact.limitations.search.unmeasured.join('<br>')],
    ['Copy', `copied \`${artifact.limitations.copy.copiedText}\``, artifact.limitations.copy.method, artifact.limitations.copy.unmeasured.join('<br>')],
    ['Accessibility', `${artifact.limitations.accessibility.matchingNodes} matching \`${artifact.limitations.accessibility.role}\` node(s) named \`${artifact.limitations.accessibility.expectedName}\``, artifact.limitations.accessibility.method, artifact.limitations.accessibility.unmeasured.join('<br>')],
  ].map((row) => `| ${row.join(' | ')} |`).join('\n')

  return `# Visibility-aware image rendition candidate (#413)

Status: **prototype evidence only. Production default remains unchanged. No production migration is selected.**

## Reproduce

Capture: \`${artifact.capture.commands.join('`, `')}\`. Regenerate this report from the retained raw artifact with the dedicated Vitest report test.

Provider: ${artifact.environment.provider}; Chromium: ${artifact.environment.browser}; commit: \`${artifact.environment.commit}\`; source: ${artifact.capture.sourceRunUrl ?? 'unavailable'}.

## Fixed contract and fixture

The candidate keeps one authoritative Card data URL and derives purpose/size keyed object URLs only in memory. ${artifact.fixture.referencePolicy} The deterministic \`${artifact.fixture.id}\` fixture covers ${artifact.fixture.imageCount} images with varied count, source dimensions, alpha, Card/display size, cold/warm cache, and settled/ordinary/fast camera movement. Production Reading/Overview/Map appearance, thresholds, occupancy, deadband, settle, and crossfades are untouched.

## Persistence and paste ingestion

- Canonical #402 stored compressed bytes: ${artifact.fixture.referenceComparison.canonical.storedCompressedBytes}; MIME mix: ${formatMimeHistogram(artifact.fixture.referenceComparison.canonical.mimeHistogram)}.
- Candidate substituted stored compressed bytes: ${artifact.fixture.referenceComparison.candidate.storedCompressedBytes}; MIME mix: ${formatMimeHistogram(artifact.fixture.referenceComparison.candidate.mimeHistogram)}.
- Within-candidate cache integrity: stored compressed bytes ${artifact.fixture.storedCompressedBytesBefore} before / ${artifact.fixture.storedCompressedBytesAfter} after; Board JSON ${artifact.fixture.boardJsonBytesBefore} bytes before / ${artifact.fixture.boardJsonBytesAfter} after; authoritative references remained equal.
- Image persistence/storage impact is **unmeasured and confounded** because the candidate deliberately substitutes PNG/JPEG bytes for canonical SVG/PNG bytes. This evidence claims neither a persistence win nor a persistence loss.
- \`snapshot.storedReferenceBytes\` and \`referenceSizes\` are request-seen resolver bookkeeping, not authoritative Board storage; they may omit never-requested images, are unbounded, may undercount, and are not used for storage conclusions or treated as independently bounded.
- Board serialization: ${artifact.fixture.serializationMs.toFixed(2)} ms; paste-batch serialization: ${artifact.pasteCompression.serializationMs.toFixed(2)} ms / ${artifact.pasteCompression.serializedBytes} bytes.

| paste sample | source | alpha | paste decode ms | encode ms | total ms | stored data-URL bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${pasteRows}

## Runtime decode, paint, readiness, and repeated traversal

The canonical baseline estimated ${bytes(artifact.baseline.decodedPixelEstimateBytes)} decoded pixels from ${artifact.baseline.storedCompressedBytes} stored bytes. Candidate peak decoded residency was ${bytes(peakDecoded)} against a ${bytes(artifact.budgets.maxDecodedBytes)} budget; peak derived rendition residency was ${bytes(peakRendition)} against ${bytes(artifact.budgets.maxRenditionBytes)}. Reference-aware LRU produced ${evictions} evictions/revocations while repeated traversal remained bounded.

| repetition | camera choreography | cache | ready ms | paint/composite ms | decoded residency | rendition residency | cache growth | evictions | motion deferred | offscreen deferred |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${traversalRows}

The settled, ordinary-pan, and fast-pan labels demonstrate traversal choreography and timing comparisons only. They do not demonstrate execution of the resolver’s motion- or offscreen-deferral policy branches.

| Evidence | Raw source | Result | Claim boundary |
| --- | --- | --- | --- |
| Camera-regime traversal | traversal.cameraSpeed | ${cameraCounts[0]} settled / ${cameraCounts[1]} ordinary / ${cameraCounts[2]} fast | Traversal/timing evidence only |
| Motion deferral | max(snapshot.motionDeferred) | ${motionDeferred} | ${motionDeferred === 0 ? 'No runtime policy-branch evidence on this fixture' : 'Raw counter observation only'} |
| Offscreen deferral | max(snapshot.offscreenDeferred) | ${offscreenDeferred} | ${offscreenDeferred === 0 ? 'No runtime policy-branch evidence on this fixture' : 'Raw counter observation only'} |

Both deferral counters remained ${motionDeferred === 0 && offscreenDeferred === 0 ? 'zero in every retained snapshot' : 'as recorded in the raw snapshots'}. Current UI routing skips resolver requests for out-of-range \`RenditionImage\` instances and filters offscreen preload demands, so the offscreen zero is expected and is not branch-success evidence.

Cold median readiness was ${median(cold.map((run) => run.readinessMs)).toFixed(1)} ms; warm median readiness was ${median(warm.map((run) => run.readinessMs)).toFixed(1)} ms. Blank replacements were zero during the measured traversals. \`offscreenSharperRenders\` was also zero, but because \`offscreenDeferred\` remained ${offscreenDeferred}, that observation is not evidence that the offscreen policy branch executed. Decode/resize work is request-driven and asynchronous; no encode/decode loop runs on requestAnimationFrame.

## Search, copy, and accessibility limitations

| Observation | Observed result | Measured scope | Unmeasured boundaries |
| --- | --- | --- | --- |
${limitationRows}

These synthetic observations pre-authorize no correctness or accessibility sacrifice. Unmeasured behavior is neither waived nor claimed compatible.

## Gallery and authoritative consumers

Gallery activation reached a derived \`${artifact.gallery.purpose}\` rendition in ${artifact.gallery.settledReadyMs.toFixed(1)} ms without changing the Card's ${artifact.gallery.cardBoundsBefore.width}×${artifact.gallery.cardBoundsBefore.height} bounds. Hover/focus prepares the active path. Save/export and AI compatibility guards continue to assert the original Card \`dataUrl\`; no \`blob:\` or thumbnail reference entered Board JSON.

## Interpretation

On this fixture, **${renderingConclusion}**: decoded-pixel residency, derived rendition residency, paint/composite time, and cache growth are measured separately. Image persistence/storage impact remains **unmeasured and confounded** by the canonical-versus-candidate MIME and byte divergence. This is candidate evidence, not authorization to change the production renderer or default behavior; no production migration is selected.
`
}
