import { describe, expect, it } from 'vitest'
import {
  IMAGE_COMPRESSION_POLICY,
  compressImage,
  dataUrlByteSize,
  storedPayloadBytes,
  type EncodeOptions,
  type ImageCodec,
} from './imageCompression'

const BUDGET = IMAGE_COMPRESSION_POLICY.maxStoredPayloadBytes

// Deterministic fake codec: encoded size is a pure function of the encode
// options, so each test can force a specific search behavior. The emitted
// data URL is valid base64 whose string length tracks the requested byte size.
function fakeCodec(opts: {
  width: number
  height: number
  hasAlpha?: boolean
  bytes: (options: EncodeOptions) => number
  encodes?: EncodeOptions[]
}): ImageCodec {
  return {
    decode: async () => ({
      width: opts.width,
      height: opts.height,
      hasAlpha: Boolean(opts.hasAlpha),
      source: null,
    }),
    encode: async (_image, options) => {
      opts.encodes?.push(options)
      const bytes = Math.max(3, Math.round(opts.bytes(options)))
      return `data:${options.mimeType};base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`
    },
  }
}

function imageFile(name = 'photo.png', type = 'image/png', byteLength = 5 * 1024 * 1024): File {
  return new File([new Uint8Array(byteLength)], name, { type })
}

describe('compressImage', () => {
  it('reports paste decode, encode, total, and stored/reference bytes through an injected clock', async () => {
    const observed: unknown[] = []
    let time = 0
    const result = await compressImage(
      imageFile('measured.png', 'image/png', 4_000_000),
      fakeCodec({ width: 1600, height: 1200, bytes: () => 60_000 }),
      {
        now: () => ++time,
        onComplete: (metrics) => observed.push(metrics),
      },
    )

    expect(observed).toEqual([
      expect.objectContaining({
        decodeMs: 1,
        encodeMs: 1,
        totalMs: 3,
        encodeAttempts: 1,
        sourceBytes: 4_000_000,
        storedDataUrlBytes: storedPayloadBytes(result.dataUrl),
        compressedBytes: result.size,
      }),
    ])
  })

  it('compresses a large image under the stored budget with bounded dimensions and metadata', async () => {
    const file = imageFile('big.png', 'image/png', 4_000_000)
    const codec = fakeCodec({
      width: 4000,
      height: 3000,
      bytes: () => 60_000,
    })

    const result = await compressImage(file, codec)

    expect(storedPayloadBytes(result.dataUrl)).toBeLessThanOrEqual(BUDGET)
    expect(result.width).toBe(1280)
    expect(result.height).toBe(960)
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.size).toBe(dataUrlByteSize(result.dataUrl))
    expect(result.size).toBeLessThan(file.size)
    expect(result.originalSize).toBe(file.size)
    expect(result.originalMimeType).toBe('image/png')
  })

  it('walks JPEG quality down before shrinking dimensions', async () => {
    const encodes: EncodeOptions[] = []
    const codec = fakeCodec({
      width: 2600,
      height: 2600,
      encodes,
      // Too big at high quality, fits once quality drops to 0.65.
      bytes: (o) => ((o.quality ?? 1) > 0.7 ? 400_000 : 90_000),
    })

    const result = await compressImage(imageFile(), codec)

    expect(result.width).toBe(1280)
    expect(encodes.map((o) => o.quality)).toEqual([0.85, 0.75, 0.65])
    expect(storedPayloadBytes(result.dataUrl)).toBeLessThanOrEqual(BUDGET)
  })

  it('downshifts dimensions when the quality floor still misses the budget', async () => {
    const encodes: EncodeOptions[] = []
    const codec = fakeCodec({
      width: 4000,
      height: 2000,
      encodes,
      bytes: (o) => (o.width > 1000 ? 400_000 : 90_000),
    })

    const result = await compressImage(imageFile(), codec)

    expect(result.width).toBe(960)
    expect(result.height).toBe(480)
    expect(storedPayloadBytes(result.dataUrl)).toBeLessThanOrEqual(BUDGET)
    // All quality steps were tried at 1280 before the edge dropped.
    const atFullEdge = encodes.filter((o) => o.width === 1280)
    expect(atFullEdge.map((o) => o.quality)).toEqual([...IMAGE_COMPRESSION_POLICY.jpegQualitySteps])
  })

  it('never upscales a small image', async () => {
    const codec = fakeCodec({ width: 400, height: 250, bytes: () => 20_000 })

    const result = await compressImage(imageFile('small.jpg', 'image/jpeg', 50_000), codec)

    expect(result.width).toBe(400)
    expect(result.height).toBe(250)
  })

  it('keeps PNG transparency when the transparent result fits the budget', async () => {
    const encodes: EncodeOptions[] = []
    const codec = fakeCodec({
      width: 1600,
      height: 1200,
      hasAlpha: true,
      encodes,
      bytes: () => 120_000,
    })

    const result = await compressImage(imageFile('screenshot.png'), codec)

    expect(result.mimeType).toBe('image/png')
    expect(encodes).toHaveLength(1)
    expect(encodes[0].background).toBeUndefined()
    expect(storedPayloadBytes(result.dataUrl)).toBeLessThanOrEqual(BUDGET)
  })

  it('keeps transparency by downshifting PNG dimensions when only a smaller PNG fits', async () => {
    const encodes: EncodeOptions[] = []
    const codec = fakeCodec({
      width: 1600,
      height: 1200,
      hasAlpha: true,
      encodes,
      // PNG misses the budget at 1280 but fits once the edge drops to 960.
      bytes: (o) => (o.width > 1000 ? 900_000 : 120_000),
    })

    const result = await compressImage(imageFile('screenshot.png'), codec)

    expect(result.mimeType).toBe('image/png')
    expect(result.width).toBe(960)
    expect(result.height).toBe(720)
    expect(encodes.every((o) => o.mimeType === 'image/png')).toBe(true)
    expect(encodes.every((o) => o.background === undefined)).toBe(true)
    expect(storedPayloadBytes(result.dataUrl)).toBeLessThanOrEqual(BUDGET)
  })

  it('flattens transparency onto white only when no PNG ladder step fits the budget', async () => {
    const encodes: EncodeOptions[] = []
    const codec = fakeCodec({
      width: 1600,
      height: 1200,
      hasAlpha: true,
      encodes,
      bytes: (o) => (o.mimeType === 'image/png' ? 900_000 : 80_000),
    })

    const result = await compressImage(imageFile('screenshot.png'), codec)

    expect(result.mimeType).toBe('image/jpeg')
    // Every dimension ladder step was tried as PNG before giving up on
    // transparency: 1280, 960, 720, 540, 405, 320.
    const pngEdges = encodes.filter((o) => o.mimeType === 'image/png').map((o) => o.width)
    expect(pngEdges).toEqual([1280, 960, 720, 540, 405, 320])
    const winner = encodes[encodes.length - 1]
    expect(winner.background).toBe(IMAGE_COMPRESSION_POLICY.flattenBackground)
    expect(storedPayloadBytes(result.dataUrl)).toBeLessThanOrEqual(BUDGET)
  })

  it('converts a GIF into a single still compressed reference', async () => {
    const codec = fakeCodec({ width: 800, height: 600, bytes: () => 40_000 })

    const result = await compressImage(imageFile('loop.gif', 'image/gif', 3_000_000), codec)

    expect(result.mimeType).toBe('image/jpeg')
    expect(result.originalMimeType).toBe('image/gif')
    expect(storedPayloadBytes(result.dataUrl)).toBeLessThanOrEqual(BUDGET)
  })

  it('rejects when nothing can hit the budget — an over-budget payload is never returned', async () => {
    const encodes: EncodeOptions[] = []
    const codec = fakeCodec({
      width: 6000,
      height: 6000,
      encodes,
      // Pathological content: size only shrinks with dimensions, never fits.
      bytes: (o) => 300_000 + o.width * 100,
    })

    await expect(compressImage(imageFile(), codec)).rejects.toThrow('image-compression-over-budget')
    // The whole search ran before giving up: every quality at every edge.
    const minEdgeTries = encodes.filter((o) => o.width === IMAGE_COMPRESSION_POLICY.minEdgePx)
    expect(minEdgeTries.map((o) => o.quality)).toEqual([...IMAGE_COMPRESSION_POLICY.jpegQualitySteps])
  })

  it('propagates decode failures so callers can recover', async () => {
    const codec: ImageCodec = {
      decode: async () => {
        throw new Error('image-decode-failed')
      },
      encode: async () => 'data:image/jpeg;base64,AAAA',
    }

    await expect(compressImage(imageFile('weird.png'), codec)).rejects.toThrow('image-decode-failed')
  })
})
