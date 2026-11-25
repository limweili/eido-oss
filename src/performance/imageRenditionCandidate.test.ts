import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createRichCardBenchmarkBoard } from '../graph/perfFixtures'
import { createImageRenditionResolver } from '../shared/imageRenditions'
import {
  IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS,
  IMAGE_RENDITION_CANDIDATE_CONTRACT,
  IMAGE_RENDITION_DIAGNOSTIC_LIMITS,
  assertNoImageRenditionBrowserErrors,
  assertExactImageRenditionGalleryCaptionAfterCopy,
  assertExactImageRenditionGalleryCaptionCopy,
  assertImageRenditionCandidateArtifact,
  assertNoImageRenditionResolverFailures,
  adaptImageRenditionCandidateBoard,
  aggregateImageRenditionDocumentState,
  decodeExactImageRenditionsInDocument,
  diagnoseImageRenditionFailure,
  formatImageRenditionStartupDiagnostic,
  galleryClickCameraAdjustment,
  imageRenditionCandidateReady,
  imageRenditionCoreReady,
  imageRenditionRepeatedTraversalReady,
  publishImageRenditionCandidateArtifact,
  recordImageRenditionConsoleError,
  recordImageRenditionPageError,
  readImageRenditionGalleryProbe,
  readImageRenditionRepeatedTraversalProbe,
  renderImageRenditionCandidateReport,
  runImageRenditionCandidateObservationWorkflow,
  selectExactImageRenditionGalleryCaption,
  validateImageRenditionCandidateReferences,
  waitForImageRenditionResolverCondition,
  type ImageRenditionCandidateArtifact,
  type ImageRenditionCandidateReference,
  type ImageRenditionAppProbe,
} from './imageRenditionCandidate'

declare const Buffer: {
  from: (
    value: string | Uint8Array,
    encoding?: 'base64',
  ) => Uint8Array & { toString: (encoding: 'base64') => string }
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

function uint32(value: number) {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

function pngChunk(type: string, payload: Uint8Array) {
  const kind = new TextEncoder().encode(type)
  const crcInput = new Uint8Array(kind.length + payload.length)
  crcInput.set(kind)
  crcInput.set(payload, kind.length)
  const chunk = new Uint8Array(12 + payload.length)
  chunk.set(uint32(payload.length), 0)
  chunk.set(kind, 4)
  chunk.set(payload, 8)
  chunk.set(uint32(crc32(crcInput)), 8 + payload.length)
  return chunk
}

function joinBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function testPng(width: number, height: number) {
  const ihdr = new Uint8Array(13)
  ihdr.set(uint32(width), 0)
  ihdr.set(uint32(height), 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const scanlines = new Uint8Array(height * (1 + width * 4))
  const bytes = joinBytes([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', new Uint8Array()),
  ])
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
}

function testJpeg(width: number, height: number) {
  const sof = Uint8Array.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
  ])
  const bytes = joinBytes([Uint8Array.from([0xff, 0xd8]), sof, Uint8Array.from([0xff, 0xd9])])
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`
}

function validCandidateReferences(): ImageRenditionCandidateReference[] {
  return IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS.map((spec) => ({
    assetId: spec.assetId,
    mimeType: spec.mimeType,
    dataUrl: spec.mimeType === 'image/png'
      ? testPng(spec.width, spec.height)
      : testJpeg(spec.width, spec.height),
  }))
}

function dataUrlBytes(dataUrl: string) {
  return Uint8Array.from(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
}

function imageDataUrl(mimeType: 'image/png' | 'image/jpeg', bytes: Uint8Array) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
}

function referencesWithDataUrl(assetId: string, dataUrl: string) {
  return validCandidateReferences().map((reference) =>
    reference.assetId === assetId ? { ...reference, dataUrl } : reference)
}

function pngIhdr(width: number, height: number) {
  const ihdr = new Uint8Array(13)
  ihdr.set(uint32(width), 0)
  ihdr.set(uint32(height), 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return ihdr
}

function pngFromChunks(chunks: Uint8Array[]) {
  return imageDataUrl('image/png', joinBytes([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunks,
  ]))
}

function mutatePng(
  dataUrl: string,
  mutation: (bytes: Uint8Array, idatOffset: number, idatLength: number) => void,
) {
  const prefix = 'data:image/png;base64,'
  const bytes = Uint8Array.from(Buffer.from(dataUrl.slice(prefix.length), 'base64'))
  let offset = 8
  while (offset < bytes.length) {
    const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8))
    if (type === 'IDAT') {
      mutation(bytes, offset, length)
      return `${prefix}${Buffer.from(bytes).toString('base64')}`
    }
    offset += length + 12
  }
  throw new Error('Test PNG has no IDAT chunk')
}

function rewritePngChunkCrc(bytes: Uint8Array, chunkOffset: number, chunkLength: number) {
  const value = crc32(bytes.slice(chunkOffset + 4, chunkOffset + 8 + chunkLength))
  bytes.set(uint32(value), chunkOffset + 8 + chunkLength)
}

function insertPngText(dataUrl: string, text: string) {
  const prefix = 'data:image/png;base64,'
  const bytes = Uint8Array.from(Buffer.from(dataUrl.slice(prefix.length), 'base64'))
  const ihdrEnd = 8 + 12 + 13
  const withText = joinBytes([
    bytes.slice(0, ihdrEnd),
    pngChunk('tEXt', new TextEncoder().encode(text)),
    bytes.slice(ihdrEnd),
  ])
  return `${prefix}${Buffer.from(withText).toString('base64')}`
}

type CandidateImageTestDouble = {
  decode: () => Promise<void>
  getAttribute: (name: string) => string | null
  setAttribute: (name: string, value: string) => void
}

function candidateImage(
  decode: () => Promise<void> = async () => undefined,
): CandidateImageTestDouble {
  const attributes: Record<string, string> = {
    src: 'blob:candidate-image',
    'data-image-rendition-derived': 'true',
    'data-image-rendition-purpose': 'card-thumbnail',
  }
  return {
    decode,
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = value },
  }
}

function candidateDocument(images: CandidateImageTestDouble[]) {
  return {
    querySelectorAll: () => images,
    contains: (image: Pick<CandidateImageTestDouble, 'decode' | 'getAttribute'>) =>
      images.includes(image as CandidateImageTestDouble),
  }
}

function snapshot(decodedBytes: number, renditionBytes: number) {
  return {
    entries: 4,
    references: ['ref-a', 'ref-b'],
    decodedBytes,
    renditionBytes,
    activePins: 2,
    pendingPins: 0,
    pinnedEntries: 2,
    invalidatedEntries: 0,
    storedReferenceBytes: 2_375,
    peakEntries: 6,
    peakDecodedBytes: decodedBytes,
    peakRenditionBytes: renditionBytes,
    hits: 8,
    misses: 6,
    deduplicated: 2,
    failures: 0,
    evictions: 2,
    revocations: 2,
    budgetBlocked: 0,
    preloadRejected: 1,
    offscreenDeferred: 3,
    motionDeferred: 2,
    invalidationDeferred: 0,
    requestsByPurpose: {
      'card-thumbnail': 1,
      'passive-card': 3,
      'active-card': 1,
      'gallery-thumbnail': 1,
      gallery: 1,
    },
    decodeMs: 12,
    resizeEncodeMs: 8,
  }
}

function artifact(): ImageRenditionCandidateArtifact {
  const traversals = Array.from({ length: 6 }, (_, index) => ({
    repetition: index + 1,
    cameraSpeed: (['settled', 'ordinary-pan', 'fast-pan'] as const)[index % 3],
    warmth: index === 0 ? 'cold' as const : 'warm' as const,
    durationMs: 30 + index,
    firstDecodeMs: index === 0 ? 12 : 0,
    paintCompositeMs: 4 + index,
    readinessMs: 20 + index,
    cacheGrowthBytes: index === 0 ? 1_200_000 : 0,
    blankReplacements: 0,
    offscreenSharperRenders: 0,
    snapshot: snapshot(1_200_000, 180_000),
  }))
  return {
    schemaVersion: 2,
    contractId: IMAGE_RENDITION_CANDIDATE_CONTRACT.id,
    candidate: {
      enabled: true,
      description: 'Purpose-sized visibility-aware derived image renditions.',
      productionDefaultChanged: false,
    },
    environment: {
      provider: 'github-actions',
      os: 'linux synthetic',
      cpu: 'provider-cpu',
      logicalCores: 2,
      memoryBytes: 8_000_000_000,
      browser: 'Chromium synthetic',
      node: 'v20.0.0',
      commit: '0123456789abcdef0123456789abcdef01234567',
      capturedAt: '2026-07-15T00:00:00.000Z',
    },
    capture: {
      commands: ['VITE_EIDO_IMAGE_RENDITION_CANDIDATE=1 npx playwright test candidate'],
      runner: 'provider-runner',
      sourceRunUrl: 'https://github.com/limweili/eido/actions/runs/1',
    },
    limitations: {
      preAuthorizedSacrifice: false,
      search: {
        status: 'observed',
        target: 'synthetic-alpha-square.png',
        found: true,
        method: 'window.find over mounted visible synthetic asset-name text.',
        unmeasured: [
          'Image pixels and OCR.',
          'Application semantic search.',
          'Unmounted or offscreen asset indexing.',
        ],
      },
      copy: {
        status: 'observed',
        intendedText: 'synthetic-alpha-square.png',
        copiedText: 'synthetic-alpha-square.png',
        method: 'Exact visible gallery caption DOM selection copied through a real browser keyboard copy gesture and read back from the granted synthetic-test clipboard.',
        unmeasured: [
          'Bitmap, data-URL, and image metadata copy.',
          'Operating-system and cross-application interoperability.',
        ],
      },
      accessibility: {
        status: 'observed',
        role: 'image',
        expectedName: 'synthetic-alpha-square.png',
        matchingNodes: 1,
        method: 'Chromium Accessibility.getFullAXTree role/name match for a mounted synthetic image.',
        unmeasured: [
          'Real assistive-technology behavior.',
          'Reading order, announcements, contrast, and zoom.',
          'Complete keyboard and focus navigation.',
        ],
      },
    },
    budgets: {
      maxDecodedBytes: 64 * 1024 * 1024,
      maxRenditionBytes: 12 * 1024 * 1024,
      maxPreloadEntries: 8,
    },
    baseline: {
      commit: 'abcdef0123456789abcdef0123456789abcdef01',
      storedCompressedBytes: 2_375,
      decodedPixelEstimateBytes: 51_019_524,
      coldDecodeMs: 38.92,
      warmDecodeMs: 31.06,
      coldPaintCompositeMs: 79.6,
      warmPaintCompositeMs: 15.2,
    },
    fixture: {
      id: 'rich-card-board-v1',
      referencePolicy: 'Candidate-only PNG/JPEG references; legacy canonical SVG remains an authoritative fallback/readability case; canonical #402 evidence is unchanged.',
      referenceComparison: {
        canonical: {
          storedCompressedBytes: 2_375,
          mimeHistogram: { 'image/svg+xml': 8, 'image/png': 1 },
        },
        candidate: {
          storedCompressedBytes: 3_125,
          mimeHistogram: { 'image/png': 5, 'image/jpeg': 4 },
        },
        storageAssessment: 'unmeasured-confounded',
      },
      imageCount: 9,
      cases: [
        { id: 'alpha-wide', sourceWidth: 1920, sourceHeight: 1080, alpha: true, displayWidth: 240, displayHeight: 180 },
        { id: 'opaque-portrait', sourceWidth: 1080, sourceHeight: 1920, alpha: false, displayWidth: 144, displayHeight: 108 },
        { id: 'small', sourceWidth: 240, sourceHeight: 180, alpha: true, displayWidth: 240, displayHeight: 180 },
      ],
      boardJsonBytesBefore: 360_372,
      boardJsonBytesAfter: 360_372,
      serializationMs: 0.7,
      storedCompressedBytesBefore: 3_125,
      storedCompressedBytesAfter: 3_125,
    },
    pasteCompression: {
      samples: [
        { id: 'paste-alpha', width: 1600, height: 1200, alpha: true, sourceBytes: 900_000, decodeMs: 5, encodeMs: 8, totalMs: 14, encodeAttempts: 2, storedDataUrlBytes: 80_000, compressedBytes: 60_000 },
        { id: 'paste-opaque', width: 2048, height: 2048, alpha: false, sourceBytes: 1_200_000, decodeMs: 7, encodeMs: 9, totalMs: 17, encodeAttempts: 1, storedDataUrlBytes: 90_000, compressedBytes: 67_000 },
      ],
      serializationMs: 0.4,
      serializedBytes: 170_000,
    },
    traversals,
    gallery: {
      activationMs: 28,
      settledReadyMs: 25,
      cardBoundsBefore: { width: 760, height: 900 },
      cardBoundsAfter: { width: 760, height: 900 },
      purpose: 'gallery',
      derived: true,
    },
    authoritative: {
      boardReferencesBefore: ['data:image/png;base64,a', 'data:image/svg+xml,b'],
      boardReferencesAfter: ['data:image/png;base64,a', 'data:image/svg+xml,b'],
      derivedReferenceLeaks: 0,
      aiCompatibilityTest: 'src/graph/cardAssetCompat.test.ts',
      exportCompatibilityTest: 'src/graph/cardAssetCompat.test.ts',
    },
  }
}

function readyProbe(): ImageRenditionAppProbe {
  return {
    rootChildCount: 1,
    performanceRuntime: true,
    graphRuntime: true,
    viewportRuntime: true,
    candidateRuntimePresent: true,
    candidateEnabled: true,
    detailNodeCount: 3,
    overviewCardCount: 0,
    purposeMarkedImageCount: 9,
    derivedImageCount: 9,
    decodedReadyImageCount: 9,
    imageStatusHistogram: { ready: 9 },
    resolverFailures: 0,
    resolverRequestsByPurpose: snapshot(0, 0).requestsByPurpose,
    consoleErrors: [],
    pageErrors: [],
  }
}

describe('image rendition candidate evidence', () => {
  it('selects only the exact unique visible gallery caption', () => {
    const target = 'synthetic-alpha-square.png'
    const caption = {
      textContent: target,
      getBoundingClientRect: () => ({ width: 120, height: 20 }),
    }
    const selectedNodes: unknown[] = []
    const selection = {
      removeAllRanges: () => undefined,
      addRange: (_range: unknown) => undefined,
      toString: () => target,
    }

    expect(selectExactImageRenditionGalleryCaption(target, {
      document: {
        querySelectorAll: (selector: string) => {
          expect(selector).toBe('.gallery-stage figure > figcaption > span')
          return [caption]
        },
        contains: (element: unknown) => element === caption,
        createRange: () => ({ selectNodeContents: (node: unknown) => selectedNodes.push(node) }),
      },
      getComputedStyle: () => ({ display: 'inline', visibility: 'visible' }),
      getSelection: () => selection,
    })).toBe(target)
    expect(selectedNodes).toEqual([caption])
  })

  it.each([
    ['missing caption', [], 'synthetic-alpha-square.png', 'synthetic-alpha-square.png'],
    ['duplicate caption', ['synthetic-alpha-square.png', 'synthetic-alpha-square.png'], 'synthetic-alpha-square.png', 'synthetic-alpha-square.png'],
    ['Board caption is never the target', ['Board'], 'synthetic-alpha-square.png', 'synthetic-alpha-square.png'],
    ['empty selection', ['synthetic-alpha-square.png'], 'synthetic-alpha-square.png', ''],
    ['partial selection', ['synthetic-alpha-square.png'], 'synthetic-alpha-square.png', 'synthetic-alpha'],
  ])('fails closed for %s', (_case, texts, target, selectionText) => {
    const captions = texts.map((text) => ({
      textContent: text,
      getBoundingClientRect: () => ({ width: 120, height: 20 }),
    }))
    let cleared = 0

    expect(() => selectExactImageRenditionGalleryCaption(target, {
      document: {
        querySelectorAll: () => captions,
        contains: (element: unknown) => captions.includes(element as typeof captions[number]),
        createRange: () => ({ selectNodeContents: () => undefined }),
      },
      getComputedStyle: () => ({ display: 'inline', visibility: 'visible' }),
      getSelection: () => ({
        removeAllRanges: () => { cleared += 1 },
        addRange: () => undefined,
        toString: () => selectionText,
      }),
    })).toThrow(/exactly one visible connected gallery caption|selection did not exactly/i)
    if (selectionText !== target && captions.length === 1) expect(cleared).toBe(2)
  })

  it.each([
    ['capture', true],
    ['probe', false],
  ] as const)('orders startup, traversal, gallery, and copy for %s', async (mode, measured) => {
    const steps: string[] = []

    await runImageRenditionCandidateObservationWorkflow({
      mode,
      observeStartup: async () => { steps.push('startup') },
      observeTraversals: async () => { steps.push('traversals') },
      activateGallery: async (shouldMeasure) => {
        steps.push(`gallery:${shouldMeasure}`)
        return 'gallery'
      },
      observeCopy: async () => { steps.push('copy') },
    })

    expect(steps).toEqual(['startup', 'traversals', `gallery:${measured}`, 'copy'])
  })

  it('fails closed when keyboard copy readback differs from the gallery caption', () => {
    expect(() => assertExactImageRenditionGalleryCaptionCopy(
      'synthetic-alpha-square.png',
      'synthetic-alpha-square.png',
      'synthetic-alpha-square.png',
    )).not.toThrow()
    expect(() => assertExactImageRenditionGalleryCaptionCopy(
      'synthetic-alpha-square.png',
      'synthetic-alpha-square.png',
      'Board',
    )).toThrow(/gallery caption copy\/readback/i)
  })

  it.each([
    ['closed modal', []],
    ['changed gallery asset', ['synthetic-alpha-wide.png']],
  ])('fails closed when copy leaves the gallery with a %s', (_case, texts) => {
    const captions = texts.map((text) => ({
      textContent: text,
      contains: () => true,
      getBoundingClientRect: () => ({ width: 120, height: 20 }),
    }))

    expect(() => assertExactImageRenditionGalleryCaptionAfterCopy('synthetic-alpha-square.png', {
      document: {
        querySelectorAll: () => captions,
        contains: (element: unknown) => captions.includes(element as typeof captions[number]),
      },
      getComputedStyle: () => ({ display: 'inline', visibility: 'visible' }),
      getSelection: () => ({
        toString: () => 'synthetic-alpha-square.png',
        rangeCount: 1,
        getRangeAt: () => ({ commonAncestorContainer: captions[0] }),
      }),
    })).toThrow(/copied gallery caption to remain uniquely visible/i)
  })

  it('keeps the gallery camera still when its affordance already clears the topbar', () => {
    expect(galleryClickCameraAdjustment({
      button: { x: 320, y: 96, width: 180, height: 120 },
      topbar: { x: 0, y: 0, width: 1_440, height: 72 },
      client: { x: 0, y: 0, width: 1_440, height: 900 },
      camera: { x: -120, y: -400, zoom: 0.5 },
    })).toBeNull()
  })

  it('converts the minimal topbar clearance from client pixels into board-space camera movement', () => {
    expect(galleryClickCameraAdjustment({
      button: { x: 320, y: 44, width: 180, height: 120 },
      topbar: { x: 0, y: 0, width: 1_440, height: 72 },
      client: { x: 0, y: 0, width: 1_440, height: 900 },
      camera: { x: -120, y: -400, zoom: 0.5 },
    })).toEqual({
      camera: { x: -120, y: -364, zoom: 0.5 },
      boardSpaceY: 72,
      screenSpaceY: 36,
    })
  })

  it('moves an affordance that bleeds above the React Flow client below a fixed topbar', () => {
    expect(galleryClickCameraAdjustment({
      button: { x: 751, y: -77.25, width: 368, height: 110 },
      topbar: { x: 0, y: 0, width: 1_440, height: 47 },
      client: { x: 0, y: 47, width: 1_440, height: 953 },
      camera: { x: 320, y: -651.5, zoom: 0.5 },
    })).toEqual({
      camera: { x: 320, y: -519.25, zoom: 0.5 },
      boardSpaceY: 264.5,
      screenSpaceY: 132.25,
    })
  })

  it('adapts all nine canonical image assets without changing graph identity or declared dimensions', () => {
    const canonical = createRichCardBenchmarkBoard()
    const adapted = adaptImageRenditionCandidateBoard(canonical, validCandidateReferences())

    expect(adapted).not.toBe(canonical)
    expect(adapted.cards.map((card) => card.id)).toEqual(canonical.cards.map((card) => card.id))
    expect(adapted.connections).toEqual(canonical.connections)
    expect(adapted.outputs).toEqual(canonical.outputs)
    expect(adapted.runs).toEqual(canonical.runs)
    for (let index = 0; index < canonical.cards.length; index += 1) {
      const { assets: canonicalAssets, ...canonicalCardContent } = canonical.cards[index]
      const { assets: adaptedAssets, ...adaptedCardContent } = adapted.cards[index]
      expect(adaptedCardContent, canonical.cards[index].id).toEqual(canonicalCardContent)
      expect(adaptedAssets?.length ?? 0).toBe(canonicalAssets?.length ?? 0)
    }

    const canonicalImages = canonical.cards.flatMap((card) => card.assets ?? [])
      .filter((asset) => asset.kind === 'image')
    const adaptedImages = adapted.cards.flatMap((card) => card.assets ?? [])
      .filter((asset) => asset.kind === 'image')
    expect(adaptedImages).toHaveLength(9)
    expect(adaptedImages.map(({ id, width, height }) => ({ id, width, height })))
      .toEqual(canonicalImages.map(({ id, width, height }) => ({ id, width, height })))
    expect(adaptedImages.map((asset) => asset.id))
      .toEqual(IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS.map((spec) => spec.assetId))

    const references = validCandidateReferences()
    for (const reference of references) {
      const canonicalAsset = canonicalImages.find((candidate) => candidate.id === reference.assetId)!
      const asset = adaptedImages.find((candidate) => candidate.id === reference.assetId)
      expect(asset, reference.assetId).toMatchObject({
        id: reference.assetId,
        kind: canonicalAsset.kind,
        name: canonicalAsset.name,
        createdAt: canonicalAsset.createdAt,
        width: canonicalAsset.width,
        height: canonicalAsset.height,
        originalSize: canonicalAsset.originalSize,
        originalMimeType: canonicalAsset.originalMimeType,
        mimeType: reference.mimeType,
        dataUrl: reference.dataUrl,
        compression: 'compressed',
      })
      const substitutedFields = new Set(['mimeType', 'dataUrl', 'size', 'compression'])
      const canonicalPreservedFields = Object.fromEntries(
        Object.entries(canonicalAsset).filter(([field]) => !substitutedFields.has(field)),
      )
      const adaptedPreservedFields = Object.fromEntries(
        Object.entries(asset!).filter(([field]) => !substitutedFields.has(field)),
      )
      expect(adaptedPreservedFields, `${reference.assetId} provenance fields`).toEqual(canonicalPreservedFields)
      expect({
        mimeType: asset!.mimeType,
        dataUrl: asset!.dataUrl,
        size: asset!.size,
        compression: asset!.compression,
      }).toEqual({
        mimeType: reference.mimeType,
        dataUrl: reference.dataUrl,
        size: Buffer.from(reference.dataUrl.slice(reference.dataUrl.indexOf(',') + 1), 'base64').length,
        compression: 'compressed',
      })
    }
  })

  it('rejects CRC and zlib corruption independently for candidate PNG references', () => {
    const board = createRichCardBenchmarkBoard()
    const crcCorrupt = validCandidateReferences()
    crcCorrupt[0] = {
      ...crcCorrupt[0],
      dataUrl: mutatePng(crcCorrupt[0].dataUrl, (bytes, offset, length) => {
        bytes[offset + 8 + length] ^= 0x01
      }),
    }
    expect(() => validateImageRenditionCandidateReferences(board, crcCorrupt))
      .toThrow(/IDAT CRC/i)

    const zlibCorrupt = validCandidateReferences()
    zlibCorrupt[0] = {
      ...zlibCorrupt[0],
      dataUrl: mutatePng(zlibCorrupt[0].dataUrl, (bytes, offset, length) => {
        bytes[offset + 8] ^= 0xff
        rewritePngChunkCrc(bytes, offset, length)
      }),
    }
    expect(() => validateImageRenditionCandidateReferences(board, zlibCorrupt))
      .toThrow(/IDAT zlib/i)
  })

  it('rejects each PNG framing, ordering, and intrinsic-dimension corruption at its own path', () => {
    const board = createRichCardBenchmarkBoard()
    const spec = IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS[0]
    const validDataUrl = testPng(spec.width, spec.height)
    const validBytes = dataUrlBytes(validDataUrl)
    const invalidChunkLength = validBytes.slice()
    invalidChunkLength.set([0xff, 0xff, 0xff, 0xff], 8)
    const compressed = deflateSync(new Uint8Array(spec.height * (1 + spec.width * 4)))
    const split = Math.max(1, Math.floor(compressed.length / 2))
    const corruptions = [
      {
        label: 'invalid signature',
        dataUrl: imageDataUrl('image/png', Uint8Array.from(validBytes, (byte, index) => index === 0 ? 0 : byte)),
        message: /invalid signature/i,
      },
      {
        label: 'truncated chunk framing',
        dataUrl: imageDataUrl('image/png', validBytes.slice(0, -1)),
        message: /truncated chunk bounds|invalid chunk bounds/i,
      },
      {
        label: 'invalid chunk framing',
        dataUrl: imageDataUrl('image/png', invalidChunkLength),
        message: /invalid chunk bounds/i,
      },
      {
        label: 'IHDR after IDAT',
        dataUrl: pngFromChunks([
          pngChunk('IDAT', compressed),
          pngChunk('IHDR', pngIhdr(spec.width, spec.height)),
          pngChunk('IEND', new Uint8Array()),
        ]),
        message: /start with IHDR|IHDR order/i,
      },
      {
        label: 'non-contiguous IDAT',
        dataUrl: pngFromChunks([
          pngChunk('IHDR', pngIhdr(spec.width, spec.height)),
          pngChunk('IDAT', compressed.slice(0, split)),
          pngChunk('tEXt', new TextEncoder().encode('candidate')),
          pngChunk('IDAT', compressed.slice(split)),
          pngChunk('IEND', new Uint8Array()),
        ]),
        message: /invalid IDAT order/i,
      },
      {
        label: 'IEND before IDAT',
        dataUrl: pngFromChunks([
          pngChunk('IHDR', pngIhdr(spec.width, spec.height)),
          pngChunk('IEND', new Uint8Array()),
        ]),
        message: /invalid IEND order/i,
      },
      {
        label: 'wrong IHDR dimensions',
        dataUrl: testPng(spec.width + 1, spec.height),
        message: /intrinsic dimensions.*do not match declared dimensions/i,
      },
    ]

    for (const corruption of corruptions) {
      expect(
        () => validateImageRenditionCandidateReferences(
          board,
          referencesWithDataUrl(spec.assetId, corruption.dataUrl),
        ),
        corruption.label,
      ).toThrow(corruption.message)
    }
  })

  it('rejects each JPEG envelope, marker, SOF, and intrinsic-dimension corruption at its own path', () => {
    const board = createRichCardBenchmarkBoard()
    const spec = IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS.find((candidate) => candidate.mimeType === 'image/jpeg')!
    const validBytes = dataUrlBytes(testJpeg(spec.width, spec.height))
    const badEoi = validBytes.slice()
    badEoi[badEoi.length - 1] = 0
    const corruptions = [
      {
        label: 'bad SOI',
        bytes: Uint8Array.from(validBytes, (byte, index) => index === 0 ? 0 : byte),
        message: /missing SOI/i,
      },
      {
        label: 'missing SOI',
        bytes: validBytes.slice(2),
        message: /missing SOI/i,
      },
      {
        label: 'bad EOI',
        bytes: badEoi,
        message: /missing EOI/i,
      },
      {
        label: 'missing EOI',
        bytes: validBytes.slice(0, -2),
        message: /missing EOI/i,
      },
      {
        label: 'missing SOF',
        bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]),
        message: /missing valid SOF dimensions/i,
      },
      {
        label: 'malformed marker bounds',
        bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]),
        message: /invalid marker bounds/i,
      },
      {
        label: 'truncated marker bounds',
        bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x00, 0xff, 0xd9]),
        message: /invalid marker bounds|truncated marker bounds/i,
      },
      {
        label: 'wrong SOF dimensions',
        bytes: dataUrlBytes(testJpeg(spec.width + 1, spec.height)),
        message: /intrinsic dimensions.*do not match declared dimensions/i,
      },
    ]

    for (const corruption of corruptions) {
      expect(
        () => validateImageRenditionCandidateReferences(
          board,
          referencesWithDataUrl(spec.assetId, imageDataUrl('image/jpeg', corruption.bytes)),
        ),
        corruption.label,
      ).toThrow(corruption.message)
    }
  })

  it('rejects MIME and intrinsic-dimension disagreement before candidate apply', () => {
    const board = createRichCardBenchmarkBoard()
    const mimeMismatch = validCandidateReferences()
    mimeMismatch[0] = { ...mimeMismatch[0], mimeType: 'image/jpeg' }
    expect(() => validateImageRenditionCandidateReferences(board, mimeMismatch))
      .toThrow(/must use image\/png|MIME/i)

    const dimensionMismatch = validCandidateReferences()
    const first = IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS[0]
    dimensionMismatch[0] = {
      ...dimensionMismatch[0],
      dataUrl: testPng(first.width + 1, first.height),
    }
    expect(() => validateImageRenditionCandidateReferences(board, dimensionMismatch))
      .toThrow(/intrinsic dimensions.*do not match declared dimensions/i)
  })

  it('rejects missing, extra, and duplicate candidate references', () => {
    const board = createRichCardBenchmarkBoard()
    const valid = validCandidateReferences()
    const cases = [
      { label: 'missing', references: valid.slice(0, -1), message: /missing=.*mixed-thumbnail/i },
      {
        label: 'extra',
        references: [...valid, { ...valid[0], assetId: 'benchmark-image-extra' }],
        message: /extra=benchmark-image-extra/i,
      },
      { label: 'duplicate', references: [...valid.slice(0, -1), valid[0]], message: /duplicate.*alpha-square/i },
    ]
    for (const candidate of cases) {
      expect(
        () => validateImageRenditionCandidateReferences(board, candidate.references),
        candidate.label,
      ).toThrow(candidate.message)
    }
  })

  it('rejects private path, save, or key material embedded in candidate image bytes', () => {
    const references = validCandidateReferences()
    references[0] = {
      ...references[0],
      dataUrl: insertPngText(
        references[0].dataUrl,
        'source=/Users/example/.eido/eido-v3-ideas.json; api_key=private',
      ),
    }
    expect(() => validateImageRenditionCandidateReferences(
      createRichCardBenchmarkBoard(),
      references,
    )).toThrow(/private path, save, or key material|privacy/i)
  })

  it('makes a resolver fallback visible as a candidate evidence failure', async () => {
    const board = adaptImageRenditionCandidateBoard(
      createRichCardBenchmarkBoard(),
      validCandidateReferences(),
    )
    const reference = board.cards.flatMap((card) => card.assets ?? [])
      .find((asset) => asset.id === IMAGE_RENDITION_CANDIDATE_IMAGE_SPECS[0].assetId)!
    const resolver = createImageRenditionResolver({
      render: async () => { throw new Error('candidate-render-rejected') },
      maxDecodedBytes: 10_000_000,
      maxRenditionBytes: 10_000_000,
      maxPreloadEntries: 1,
    })
    const handle = resolver.request(reference, {
      purpose: 'card-thumbnail',
      width: 240,
      height: 180,
      visibility: 'visible',
      settled: true,
    })

    await expect(handle.ready).resolves.toMatchObject({
      src: reference.dataUrl,
      derived: false,
    })
    expect(resolver.snapshot().failures).toBe(1)
    expect(() => assertNoImageRenditionResolverFailures(resolver.snapshot(), 'after fallback'))
      .toThrow(/1 failure.*after fallback/i)
    handle.release()
    resolver.dispose()
  })

  it('aborts the active-card request wait on the first resolver rejection', async () => {
    let now = 0
    let probes = 0
    const result = waitForImageRenditionResolverCondition({
      stage: 'active-card request and eviction readiness',
      timeoutMs: 90_000,
      readProbe: async () => {
        probes += 1
        return {
          snapshot: { ...snapshot(0, 0), failures: probes === 1 ? 0 : 1 },
          value: { activeCardRequests: 0, evictions: 0 },
        }
      },
      isReady: (value) => value.activeCardRequests >= 9 && value.evictions > 0,
      now: () => now,
      wait: async (milliseconds) => { now += milliseconds },
    })

    await expect(result).rejects.toThrow(/resolver.*1 failure.*active-card/i)
    expect(probes).toBe(2)
    expect(now).toBeLessThan(90_000)
  })

  it('aborts gallery derived/decode readiness on the first resolver rejection', async () => {
    let now = 0
    let probes = 0
    const result = waitForImageRenditionResolverCondition({
      stage: 'gallery derived and decoded readiness',
      timeoutMs: 90_000,
      readProbe: async () => {
        probes += 1
        return {
          snapshot: { ...snapshot(0, 0), failures: probes === 1 ? 0 : 1 },
          value: { derived: false, decodedReady: true },
        }
      },
      isReady: (value) => value.derived && value.decodedReady,
      now: () => now,
      wait: async (milliseconds) => { now += milliseconds },
    })

    await expect(result).rejects.toThrow(/resolver.*1 failure.*gallery/i)
    expect(probes).toBe(2)
    expect(now).toBeLessThan(90_000)
  })

  it('propagates gallery decode rejection immediately when the resolver has no failures', async () => {
    const cause = new Error('gallery decode rejected at the DOM boundary')
    let now = 0
    let probes = 0
    const result = waitForImageRenditionResolverCondition({
      stage: 'gallery derived and decoded readiness',
      timeoutMs: 90_000,
      readProbe: async () => {
        probes += 1
        return readImageRenditionGalleryProbe({
          getSnapshot: () => ({ ...snapshot(0, 0), failures: 0 }),
          getImage: () => ({
            derived: true,
            complete: false,
            naturalWidth: 0,
            decode: async () => { throw cause },
          }),
        })
      },
      isReady: (value) => value.derived && value.decodedReady,
      now: () => now,
      wait: async (milliseconds) => { now += milliseconds },
    })

    const failure = await result.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/gallery.*decode.*gallery decode rejected at the DOM boundary/i)
    expect((failure as Error & { cause?: unknown }).cause).toBe(cause)
    expect(probes).toBe(1)
    expect(now).toBe(0)
  })

  it('aggregates every document-wide purpose image and counts decoded readiness independently of derivation', () => {
    let selector = ''
    const image = (
      derived: boolean,
      decodedReady: boolean,
      status: string,
    ) => ({
      complete: decodedReady,
      naturalWidth: decodedReady ? 160 : 0,
      getAttribute: (name: string) => ({
        'data-image-rendition-derived': derived ? 'true' : 'false',
        'data-image-rendition-status': status,
      })[name] ?? null,
    })
    const aggregate = aggregateImageRenditionDocumentState({
      querySelectorAll: (requestedSelector: string) => {
        selector = requestedSelector
        return [
          image(true, true, 'ready'),
          image(false, true, 'fallback'),
          image(true, false, 'pending'),
        ]
      },
    })

    expect(selector).toBe('img[data-image-rendition-purpose]')
    expect(aggregate).toEqual({
      purposeMarkedImageCount: 3,
      derivedImageCount: 2,
      decodedReadyImageCount: 2,
      imageStatusHistogram: { ready: 1, fallback: 1, pending: 1 },
    })
  })

  it('allows authoritative fallback when an ancestor-clipped image may manually overlap the expanded viewport but actual observer evidence is out of range, while actual in-range underived blocks', () => {
    const images = Array.from({ length: 9 }, (_, index) => ({
      derived: index !== 8,
      decodedReady: true,
      inRange: index !== 8,
    }))

    expect(imageRenditionRepeatedTraversalReady({ failures: 0, images })).toBe(true)

    const underivedInRange = images.map((image, index) => index === 8
      ? { ...image, inRange: true }
      : image)
    expect(imageRenditionRepeatedTraversalReady({
      failures: 0,
      images: underivedInRange,
    })).toBe(false)
  })

  it('awaits and maps initial observer evidence for all nine targets before disconnecting', async () => {
    const images = Array.from({ length: 9 }, (_, index) => ({
      complete: true,
      naturalWidth: 320,
      getAttribute: (name: string) => name === 'data-image-rendition-derived'
        ? (index === 8 ? 'false' : 'true')
        : null,
    }))
    const resolverSnapshot = snapshot(0, 0)
    const observed: typeof images = []
    let rootMargin = ''
    let disconnects = 0
    let notify!: (entries: Array<{ target: typeof images[number]; isIntersecting: boolean }>) => void
    const resultPromise = readImageRenditionRepeatedTraversalProbe({
      getSnapshot: () => resolverSnapshot,
      queryImages: () => images,
      createObserver: (callback, options) => {
        rootMargin = options.rootMargin
        notify = callback
        return {
          observe: (image) => { observed.push(image as typeof images[number]) },
          disconnect: () => { disconnects += 1 },
        }
      },
    })
    let settled = false
    void resultPromise.then(() => { settled = true })

    expect(rootMargin).toBe('320px')
    expect(observed).toEqual(images)
    notify(images.slice(0, 8).map((target, index) => ({
      target,
      isIntersecting: index % 2 === 0,
    })))
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(disconnects).toBe(0)

    notify([{ target: images[8], isIntersecting: false }])
    await expect(resultPromise).resolves.toEqual({
      snapshot: resolverSnapshot,
      value: {
        failures: 0,
        images: images.map((_, index) => ({
          derived: index !== 8,
          decodedReady: true,
          inRange: index < 8 ? index % 2 === 0 : false,
        })),
      },
    })
    expect(disconnects).toBe(1)
  })

  it('samples resolver failures after all initial observer evidence arrives', async () => {
    const images = Array.from({ length: 9 }, () => ({
      complete: true,
      naturalWidth: 320,
      getAttribute: () => 'true',
    }))
    let failures = 0
    let notify!: (entries: Array<{ target: typeof images[number]; isIntersecting: boolean }>) => void
    const resultPromise = readImageRenditionRepeatedTraversalProbe({
      getSnapshot: () => ({ ...snapshot(0, 0), failures }),
      queryImages: () => images,
      createObserver: (callback) => {
        notify = callback
        return {
          observe: () => {},
          disconnect: () => {},
        }
      },
    })

    failures = 1
    notify(images.map((target) => ({ target, isIntersecting: true })))

    const result = await resultPromise
    expect(result.snapshot.failures).toBe(1)
    expect(result.value.failures).toBe(1)
  })

  it('disconnects the initial observer exactly once when observing a target rejects', async () => {
    const observeFailure = new Error('observe failed')
    let disconnects = 0
    const resultPromise = readImageRenditionRepeatedTraversalProbe({
      getSnapshot: () => snapshot(0, 0),
      queryImages: () => [{
        complete: true,
        naturalWidth: 320,
        getAttribute: () => 'true',
      }],
      createObserver: () => ({
        observe: () => { throw observeFailure },
        disconnect: () => { disconnects += 1 },
      }),
    })

    await expect(resultPromise).rejects.toBe(observeFailure)
    expect(disconnects).toBe(1)
  })

  it('does not declare exact image readiness while any of nine decodes is pending', async () => {
    let releaseDecode!: () => void
    const pendingDecode = new Promise<void>((resolve) => { releaseDecode = resolve })
    const images = Array.from({ length: 9 }, (_, index) =>
      candidateImage(index === 8 ? () => pendingDecode : undefined))
    const readiness = decodeExactImageRenditionsInDocument(
      { selector: '[data-candidate-image]', expectedCount: 9 },
      candidateDocument(images),
    )
    let settled = false
    void readiness.finally(() => { settled = true })

    await Promise.resolve()
    expect(settled).toBe(false)

    releaseDecode()
    await expect(readiness).resolves.toBeUndefined()
  })

  it('rejects exact image readiness when any decode rejects', async () => {
    const images = Array.from({ length: 9 }, (_, index) =>
      candidateImage(index === 4
        ? async () => { throw new Error('candidate decode rejected') }
        : undefined))

    await expect(decodeExactImageRenditionsInDocument(
      { selector: '[data-candidate-image]', expectedCount: 9 },
      candidateDocument(images),
    )).rejects.toThrow(/candidate decode rejected/i)
  })

  it('rejects exact image readiness when attachment or the same-count image set changes during decode', async () => {
    let releaseDecode!: () => void
    const pendingDecode = new Promise<void>((resolve) => { releaseDecode = resolve })
    const images = Array.from({ length: 9 }, (_, index) =>
      candidateImage(index === 8 ? () => pendingDecode : undefined))
    const detachedImage = images[3]
    let detached = false
    const readiness = decodeExactImageRenditionsInDocument(
      { selector: '[data-candidate-image]', expectedCount: 9 },
      {
        querySelectorAll: () => images,
        contains: (image) => image !== detachedImage || !detached,
      },
    )

    detached = true
    releaseDecode()

    await expect(readiness, 'attachment check with nine unchanged selector matches')
      .rejects.toThrow(/detached/i)

    let releaseReplacementDecode!: () => void
    const replacementPending = new Promise<void>((resolve) => { releaseReplacementDecode = resolve })
    const originalImages = Array.from({ length: 9 }, (_, index) =>
      candidateImage(index === 8 ? () => replacementPending : undefined))
    let currentImages = originalImages
    const replacementReadiness = decodeExactImageRenditionsInDocument(
      { selector: '[data-candidate-image]', expectedCount: 9 },
      {
        querySelectorAll: () => currentImages,
        contains: () => true,
      },
    )

    currentImages = [...originalImages]
    currentImages[3] = candidateImage()
    releaseReplacementDecode()

    await expect(replacementReadiness, 'set check with nine attached selector matches')
      .rejects.toThrow(/set changed/i)
  })

  it('rejects exact image readiness when captured source or metadata changes during decode', async () => {
    const mutations = [
      { attribute: 'src', value: 'blob:replacement-image', message: /src|source/i },
      { attribute: 'data-image-rendition-derived', value: 'false', message: /derived marker/i },
      { attribute: 'data-image-rendition-purpose', value: 'gallery', message: /purpose/i },
    ]

    for (const mutation of mutations) {
      let releaseDecode!: () => void
      const pendingDecode = new Promise<void>((resolve) => { releaseDecode = resolve })
      const images = Array.from({ length: 9 }, (_, index) =>
        candidateImage(index === 8 ? () => pendingDecode : undefined))
      const readiness = decodeExactImageRenditionsInDocument(
        { selector: '[data-candidate-image]', expectedCount: 9 },
        candidateDocument(images),
      )

      images[3].setAttribute(mutation.attribute, mutation.value)
      releaseDecode()

      await expect(readiness, `${mutation.attribute} mutation during decode`)
        .rejects.toThrow(mutation.message)
    }
  })

  it('rejects exact image readiness when a tenth matching image appears during decode', async () => {
    let releaseDecode!: () => void
    const pendingDecode = new Promise<void>((resolve) => { releaseDecode = resolve })
    const images = Array.from({ length: 9 }, (_, index) =>
      candidateImage(index === 8 ? () => pendingDecode : undefined))
    const readiness = decodeExactImageRenditionsInDocument(
      { selector: '[data-candidate-image]', expectedCount: 9 },
      candidateDocument(images),
    )

    images.push(candidateImage())
    releaseDecode()

    await expect(readiness).rejects.toThrow(/exactly 9.*found 10/i)
  })

  it('separates core readiness from exact lazy candidate image readiness', () => {
    const probe = {
      rootChildCount: 1,
      performanceRuntime: true,
      graphRuntime: true,
      viewportRuntime: true,
      candidateRuntimePresent: false,
      candidateEnabled: false,
      detailNodeCount: 0,
      overviewCardCount: 131,
      purposeMarkedImageCount: 0,
      derivedImageCount: 0,
      decodedReadyImageCount: 0,
      imageStatusHistogram: {},
      resolverFailures: 0,
      resolverRequestsByPurpose: snapshot(0, 0).requestsByPurpose,
      consoleErrors: [],
      pageErrors: [],
    }

    expect(imageRenditionCoreReady(probe)).toBe(true)
    expect(imageRenditionCandidateReady(probe)).toBe(false)
    expect(imageRenditionCandidateReady({
      ...probe,
      candidateRuntimePresent: true,
      candidateEnabled: true,
      detailNodeCount: 3,
      purposeMarkedImageCount: 9,
      derivedImageCount: 9,
      decodedReadyImageCount: 9,
    })).toBe(true)
    expect(imageRenditionCandidateReady({
      ...probe,
      candidateRuntimePresent: true,
      candidateEnabled: true,
      overviewCardCount: 131,
    })).toBe(false)
    expect(imageRenditionCandidateReady({
      ...probe,
      candidateRuntimePresent: true,
      candidateEnabled: true,
      detailNodeCount: 3,
      purposeMarkedImageCount: 9,
      derivedImageCount: 8,
      decodedReadyImageCount: 8,
    })).toBe(false)
    expect(formatImageRenditionStartupDiagnostic(probe)).toContain('overviewCardCount=131')
    expect(formatImageRenditionStartupDiagnostic(probe)).toContain('purposeMarkedImageCount=0')
    expect(formatImageRenditionStartupDiagnostic(readyProbe())).toContain('imageStatusHistogram={"ready":9}')
    expect(formatImageRenditionStartupDiagnostic(readyProbe())).toContain('resolverFailures=0')
    expect(formatImageRenditionStartupDiagnostic(readyProbe())).toContain('resolverRequestsByPurpose=')

    expect(imageRenditionCandidateReady({
      ...readyProbe(),
      resolverFailures: 1,
    })).toBe(false)
  })

  it('rejects generic app-source console errors and allows only the exact benign favicon 404', () => {
    const errors = { consoleErrors: [] as string[], pageErrors: [] as string[] }

    recordImageRenditionConsoleError(errors, {
      text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
      location: { url: 'http://127.0.0.1:4173/favicon.ico', lineNumber: 0, columnNumber: 0 },
    })
    expect(() => assertNoImageRenditionBrowserErrors(errors)).not.toThrow()

    recordImageRenditionConsoleError(errors, {
      text: 'Failed to fetch',
      location: { url: 'http://127.0.0.1:4173/src/canvas/CardAssets.tsx', lineNumber: 41, columnNumber: 9 },
    })
    expect(() => assertNoImageRenditionBrowserErrors(errors)).toThrow(/Failed to fetch.*CardAssets\.tsx/i)

    errors.consoleErrors.length = 0
    recordImageRenditionConsoleError(errors, {
      text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
      location: { url: 'http://127.0.0.1:4173/src/main.tsx', lineNumber: 0, columnNumber: 0 },
    })
    expect(() => assertNoImageRenditionBrowserErrors(errors)).toThrow(/main\.tsx/i)

    errors.consoleErrors.length = 0
    recordImageRenditionPageError(errors, 'startup render crashed')
    expect(() => assertNoImageRenditionBrowserErrors(errors)).toThrow(/startup render crashed/i)
  })

  it('caps collected diagnostics by entry count and UTF-8 bytes', () => {
    const countProbe = readyProbe()
    for (let index = 0; index < 20; index += 1) {
      recordImageRenditionPageError(countProbe, `page-${index}`)
    }
    expect(countProbe.pageErrors).toHaveLength(IMAGE_RENDITION_DIAGNOSTIC_LIMITS.maxEntries)
    expect(countProbe.pageErrors).not.toContain('page-8')

    const byteProbe = readyProbe()
    recordImageRenditionPageError(byteProbe, '🔥'.repeat(2_000))
    expect(new TextEncoder().encode(byteProbe.pageErrors.join('')).byteLength)
      .toBeLessThanOrEqual(IMAGE_RENDITION_DIAGNOSTIC_LIMITS.maxBytes)
    expect(new TextEncoder().encode(formatImageRenditionStartupDiagnostic(byteProbe)).byteLength)
      .toBeLessThanOrEqual(IMAGE_RENDITION_DIAGNOSTIC_LIMITS.maxBytes)
  })

  it('preserves navigation, fixture, and timeout causes when the diagnostic probe succeeds', async () => {
    for (const stage of ['navigation', 'fixture', 'timeout']) {
      const cause = new Error(`${stage} failed first`)
      const failure = await diagnoseImageRenditionFailure(cause, async () => readyProbe())

      expect(failure.cause).toBe(cause)
      expect(failure.message).toContain(`${stage} failed first`)
      expect(failure.message).toContain('purposeMarkedImageCount=9')
    }
  })

  it('uses a short fallback when a crashed page or stalled probe cannot be inspected', async () => {
    const crashCause = new Error('page crashed during traversal')
    const crashed = await diagnoseImageRenditionFailure(crashCause, async () => {
      throw new Error('Target page, context or browser has been closed')
    })
    expect(crashed.cause).toBe(crashCause)
    expect(crashed.message).toMatch(/diagnostic probe unavailable/i)

    const timeoutCause = new Error('fixture wait timed out')
    const stalled = await diagnoseImageRenditionFailure(
      timeoutCause,
      () => new Promise(() => undefined),
      5,
    )
    expect(stalled.cause).toBe(timeoutCause)
    expect(stalled.message).toMatch(/diagnostic probe unavailable.*timed out/i)

    const source = readFileSync('src/performance/imageRenditionCandidate.perf.ts', 'utf8')
    expect(source.indexOf('try {')).toBeLessThan(source.indexOf("await page.goto('/')"))
    expect(source).toContain('diagnoseImageRenditionFailure')
  })

  it('publishes only after browser barriers and cleans every failed publication stage', async () => {
    const events: string[] = []
    const files = new Set<string>()
    const fileSystem = {
      mkdirSync: () => { events.push('mkdir') },
      writeFileSync: (file: string) => {
        events.push(file.endsWith('.tmp') ? 'write-temp' : 'write-final')
        files.add(file)
      },
      renameSync: (from: string, to: string) => {
        events.push('rename')
        files.delete(from)
        files.add(to)
      },
      rmSync: (file: string) => { files.delete(file) },
    }
    const artifactPath = 'artifacts/candidate.json'

    await publishImageRenditionCandidateArtifact({
      artifact: artifact(),
      artifactPath,
      awaitBrowserBarrier: async () => { events.push('barrier') },
      assertBrowserState: async () => { events.push('browser') },
      assertResolverState: async () => { events.push('resolver') },
      fileSystem,
    })

    expect(events).toEqual(['barrier', 'browser', 'resolver', 'mkdir', 'write-temp', 'rename'])
    expect(files).toEqual(new Set([artifactPath]))

    const failureStages = [
      'awaitBrowserBarrier',
      'assertBrowserState',
      'assertResolverState',
      'artifactValidation',
      'rename',
    ] as const
    const cleanupEvidence: Array<{
      stage: typeof failureStages[number]
      staleOrFinalPresent: boolean
      temporaryPresent: boolean
      directFinalWrite: boolean
    }> = []

    for (const stage of failureStages) {
      const temporaryPath = `${artifactPath}.tmp`
      const stageFiles = new Set([artifactPath, temporaryPath])
      const stageWrites: string[] = []
      const stageArtifact = artifact()
      if (stage === 'artifactValidation') stageArtifact.fixture.imageCount = 1
      const failAt = async (current: typeof failureStages[number]) => {
        if (stage === current) throw new Error(`${stage} failed`)
      }
      const stageFileSystem = {
        mkdirSync: () => undefined,
        writeFileSync: (file: string) => {
          stageWrites.push(file)
          stageFiles.add(file)
        },
        renameSync: (from: string, to: string) => {
          if (stage === 'rename') throw new Error('rename failed')
          stageFiles.delete(from)
          stageFiles.add(to)
        },
        rmSync: (file: string) => { stageFiles.delete(file) },
      }

      await expect(publishImageRenditionCandidateArtifact({
        artifact: stageArtifact,
        artifactPath,
        awaitBrowserBarrier: () => failAt('awaitBrowserBarrier'),
        assertBrowserState: () => failAt('assertBrowserState'),
        assertResolverState: () => failAt('assertResolverState'),
        fileSystem: stageFileSystem,
      }), `${stage} rejection`).rejects.toThrow(
        stage === 'artifactValidation'
          ? /canonical-versus-candidate.*divergence|varied deterministic image cases/i
          : new RegExp(`${stage}|rename`, 'i'),
      )
      cleanupEvidence.push({
        stage,
        staleOrFinalPresent: stageFiles.has(artifactPath),
        temporaryPresent: stageFiles.has(temporaryPath),
        directFinalWrite: stageWrites.includes(artifactPath),
      })
    }

    expect(cleanupEvidence).toEqual(failureStages.map((stage) => ({
      stage,
      staleOrFinalPresent: false,
      temporaryPresent: false,
      directFinalWrite: false,
    })))
  })

  it('accepts varied, repeated, bounded, privacy-safe evidence and rejects contract violations', () => {
    const valid = artifact()
    expect(() => assertImageRenditionCandidateArtifact(valid)).not.toThrow()

    const unbounded = structuredClone(valid)
    unbounded.traversals[5].snapshot.decodedBytes = unbounded.budgets.maxDecodedBytes + 1
    expect(() => assertImageRenditionCandidateArtifact(unbounded)).toThrow(/decoded.*budget/i)

    const blank = structuredClone(valid)
    blank.traversals[2].blankReplacements = 1
    expect(() => assertImageRenditionCandidateArtifact(blank)).toThrow(/blank/i)

    const resolverFailure = structuredClone(valid)
    resolverFailure.traversals[0].snapshot.failures = 1
    expect(() => assertImageRenditionCandidateArtifact(resolverFailure)).toThrow(/resolver.*failure/i)

    const falselyMeasuredStorage = structuredClone(valid)
    falselyMeasuredStorage.fixture.referenceComparison.storageAssessment = 'measured-no-impact' as 'unmeasured-confounded'
    expect(() => assertImageRenditionCandidateArtifact(falselyMeasuredStorage))
      .toThrow(/storage.*unmeasured.*confound/i)

    const hiddenCandidateStorage = structuredClone(valid)
    hiddenCandidateStorage.fixture.referenceComparison.candidate.storedCompressedBytes += 1
    expect(() => assertImageRenditionCandidateArtifact(hiddenCandidateStorage))
      .toThrow(/candidate.*stored.*bytes/i)

    const hiddenCanonicalStorage = structuredClone(valid)
    hiddenCanonicalStorage.fixture.referenceComparison.canonical.storedCompressedBytes += 1
    expect(() => assertImageRenditionCandidateArtifact(hiddenCanonicalStorage))
      .toThrow(/canonical.*stored.*bytes/i)

    const changedWithinCandidateBytes = structuredClone(valid)
    changedWithinCandidateBytes.fixture.storedCompressedBytesAfter += 1
    expect(() => assertImageRenditionCandidateArtifact(changedWithinCandidateBytes))
      .toThrow(/cache-integrity|candidate stored bytes/i)

    const changedWithinCandidateBoard = structuredClone(valid)
    changedWithinCandidateBoard.fixture.boardJsonBytesAfter += 1
    expect(() => assertImageRenditionCandidateArtifact(changedWithinCandidateBoard))
      .toThrow(/cache integrity/i)

    const hiddenMimeDivergence = structuredClone(valid)
    hiddenMimeDivergence.fixture.referenceComparison.candidate.mimeHistogram =
      structuredClone(hiddenMimeDivergence.fixture.referenceComparison.canonical.mimeHistogram)
    expect(() => assertImageRenditionCandidateArtifact(hiddenMimeDivergence))
      .toThrow(/MIME.*divergence/i)

    const mutated = structuredClone(valid)
    mutated.authoritative.boardReferencesAfter[0] = 'blob:derived-leak'
    expect(() => assertImageRenditionCandidateArtifact(mutated)).toThrow(/authoritative/i)

    const privateArtifact = structuredClone(valid)
    privateArtifact.environment.cpu = '/Users/example/.eido/eido-v3-ideas.json'
    expect(() => assertImageRenditionCandidateArtifact(privateArtifact)).toThrow(/privacy/i)
  })

  it('requires observed limitations and finite integer policy counters while allowing zero evidence', () => {
    const valid = artifact()
    for (const traversal of valid.traversals) {
      traversal.snapshot.motionDeferred = 0
      traversal.snapshot.offscreenDeferred = 0
    }
    expect(() => assertImageRenditionCandidateArtifact(valid)).not.toThrow()

    const schemaV1 = structuredClone(valid)
    schemaV1.schemaVersion = 1 as never
    expect(() => assertImageRenditionCandidateArtifact(schemaV1)).toThrow(/must match/i)

    const missing = structuredClone(valid)
    delete (missing as unknown as Record<string, unknown>).limitations
    expect(() => assertImageRenditionCandidateArtifact(missing)).toThrow(/limitation/i)

    const sacrificed = structuredClone(valid)
    sacrificed.limitations.preAuthorizedSacrifice = true as never
    expect(() => assertImageRenditionCandidateArtifact(sacrificed)).toThrow(/sacrifice/i)

    const unavailable = structuredClone(valid)
    unavailable.limitations.search.status = 'unavailable' as never
    expect(() => assertImageRenditionCandidateArtifact(unavailable)).toThrow(/observed/i)

    const falseSearch = structuredClone(valid)
    falseSearch.limitations.search.found = false as never
    expect(() => assertImageRenditionCandidateArtifact(falseSearch)).toThrow(/search/i)

    const mismatchedCopy = structuredClone(valid)
    mismatchedCopy.limitations.copy.copiedText = 'other.png'
    expect(() => assertImageRenditionCandidateArtifact(mismatchedCopy)).toThrow(/copy|target/i)

    const emptyCopy = structuredClone(valid)
    emptyCopy.limitations.copy.intendedText = ''
    emptyCopy.limitations.copy.copiedText = ''
    expect(() => assertImageRenditionCandidateArtifact(emptyCopy)).toThrow(/copy|target/i)

    const zeroAxMatches = structuredClone(valid)
    zeroAxMatches.limitations.accessibility.matchingNodes = 0
    expect(() => assertImageRenditionCandidateArtifact(zeroAxMatches)).toThrow(/accessibility/i)

    const softenedBoundary = structuredClone(valid)
    softenedBoundary.limitations.search.unmeasured[0] = 'No limitations.'
    expect(() => assertImageRenditionCandidateArtifact(softenedBoundary)).toThrow(/unmeasured|method/i)

    const negativeMotion = structuredClone(valid)
    negativeMotion.traversals[0].snapshot.motionDeferred = -1
    expect(() => assertImageRenditionCandidateArtifact(negativeMotion)).toThrow(/motionDeferred/i)

    const fractionalOffscreen = structuredClone(valid)
    fractionalOffscreen.traversals[0].snapshot.offscreenDeferred = 0.5
    expect(() => assertImageRenditionCandidateArtifact(fractionalOffscreen)).toThrow(/offscreenDeferred/i)
  })

  it('renders a baseline comparison and selects no production migration', () => {
    const report = renderImageRenditionCandidateReport(artifact())
    const normalized = report.toLowerCase()

    expect(normalized).toContain('stored compressed bytes')
    expect(normalized).toContain('decoded pixels')
    expect(normalized).toContain('rendition residency')
    expect(normalized).toContain('paste decode')
    expect(normalized).toContain('paint/composite')
    expect(normalized).toContain('cache growth')
    expect(normalized).toContain('cold')
    expect(normalized).toContain('warm')
    expect(normalized).toContain('repeated traversal')
    expect(normalized).toContain('image rendering')
    expect(normalized).toContain('image persistence')
    expect(normalized).toContain('unmeasured')
    expect(normalized).toContain('confounded')
    expect(normalized).toContain('image/svg+xml')
    expect(normalized).toContain('image/jpeg')
    expect(report).toContain('Candidate-only PNG/JPEG references')
    expect(report).toContain('legacy canonical SVG remains an authoritative fallback/readability case')
    expect(report).toContain('canonical #402 evidence is unchanged')
    expect(report).toContain('Production default remains unchanged')
    expect(report).not.toMatch(/persistence does not materially contribute|storage payload and serialization were unchanged/i)
    expect(report).not.toMatch(/selected for production|production migration approved/i)
  })

  it('reports all-zero deferral counters as no runtime policy-branch evidence', () => {
    const observed = artifact()
    for (const traversal of observed.traversals) {
      traversal.snapshot.motionDeferred = 0
      traversal.snapshot.offscreenDeferred = 0
    }

    const report = renderImageRenditionCandidateReport(observed)

    expect(report).toContain('| repetition | camera choreography | cache |')
    expect(report).toContain('The settled, ordinary-pan, and fast-pan labels demonstrate traversal choreography and timing comparisons only. They do not demonstrate execution of the resolver’s motion- or offscreen-deferral policy branches.')
    expect(report).toContain('| Motion deferral | max(snapshot.motionDeferred) | 0 | No runtime policy-branch evidence on this fixture |')
    expect(report).toContain('| Offscreen deferral | max(snapshot.offscreenDeferred) | 0 | No runtime policy-branch evidence on this fixture |')
    expect(report).toContain('Both deferral counters remained zero in every retained snapshot.')
    expect(report).toContain('Blank replacements were zero during the measured traversals.')
    expect(report).toContain('Search, copy, and accessibility limitations')
    expect(report).toContain('These synthetic observations pre-authorize no correctness or accessibility sacrifice. Unmeasured behavior is neither waived nor claimed compatible.')
    expect(report).toContain('`snapshot.storedReferenceBytes` and `referenceSizes` are request-seen resolver bookkeeping')
    expect(report).not.toMatch(/(?:proves|demonstrates|confirms) (?:the )?(?:motion|offscreen) policy branch/i)
  })
})
