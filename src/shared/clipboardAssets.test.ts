// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { assetsFromFiles } from './clipboardAssets'
import { IMAGE_COMPRESSION_POLICY, type ImageCodec } from './imageCompression'

const COMPRESSED_DATA_URL = `data:image/jpeg;base64,${'B'.repeat(40_000)}`

function stubCodec(): ImageCodec {
  return {
    decode: async () => ({ width: 3000, height: 2000, hasAlpha: false, source: null }),
    encode: async () => COMPRESSED_DATA_URL,
  }
}

describe('assetsFromFiles (pasted-asset ingest)', () => {
  it('compresses pasted images before creating the asset and stores compressed metadata', async () => {
    const file = new File([new Uint8Array(3_000_000)], 'photo.png', { type: 'image/png' })

    const [asset] = await assetsFromFiles([file], { codec: stubCodec() })

    expect(asset.kind).toBe('image')
    expect(asset.dataUrl).toBe(COMPRESSED_DATA_URL)
    expect(asset.dataUrl.length).toBeLessThanOrEqual(IMAGE_COMPRESSION_POLICY.maxStoredPayloadBytes)
    expect(asset.mimeType).toBe('image/jpeg')
    // Size reflects the saved compressed payload, not the pasted original.
    expect(asset.size).toBe(30_000)
    expect(asset.width).toBe(1280)
    expect(asset.height).toBe(853)
    expect(asset.originalSize).toBe(3_000_000)
    expect(asset.originalMimeType).toBe('image/png')
    expect(asset.compression).toBe('compressed')
  })

  it('lets non-image files bypass the compression pipeline entirely', async () => {
    const decode = vi.fn()
    const codec = { decode, encode: vi.fn() } as unknown as ImageCodec
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    const file = new File([pdfBytes], 'paper.pdf', { type: 'application/pdf' })

    const [asset] = await assetsFromFiles([file], { codec })

    expect(asset.kind).toBe('file')
    expect(asset.mimeType).toBe('application/pdf')
    expect(asset.size).toBe(file.size)
    expect(asset.dataUrl.startsWith('data:application/pdf')).toBe(true)
    expect(asset.width).toBeUndefined()
    expect(asset.originalSize).toBeUndefined()
    expect(asset.compression).toBeUndefined()
    expect(decode).not.toHaveBeenCalled()
  })

  it('drops an image that fails compression while the rest of the paste survives', async () => {
    const failingCodec: ImageCodec = {
      decode: async () => {
        throw new Error('image-decode-failed')
      },
      encode: async () => 'data:image/jpeg;base64,AAAA',
    }
    const weirdImage = new File([new Uint8Array(100)], 'weird.png', { type: 'image/png' })
    const pdf = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' })

    const assets = await assetsFromFiles([weirdImage, pdf], { codec: failingCodec })

    expect(assets).toHaveLength(1)
    expect(assets[0].name).toBe('doc.pdf')
    // No silent empty-dataUrl assets sneak through.
    expect(assets.every((asset) => asset.dataUrl.length > 0)).toBe(true)
  })

  it('drops an image no encode can fit under the budget while the rest of the paste survives', async () => {
    // Every encode attempt comes back over the stored-payload budget.
    const overBudgetCodec: ImageCodec = {
      decode: async () => ({ width: 6000, height: 6000, hasAlpha: false, source: null }),
      encode: async () => `data:image/jpeg;base64,${'C'.repeat(IMAGE_COMPRESSION_POLICY.maxStoredPayloadBytes * 2)}`,
    }
    const unfittable = new File([new Uint8Array(5_000_000)], 'noise.png', { type: 'image/png' })
    const pdf = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' })

    const assets = await assetsFromFiles([unfittable, pdf], { codec: overBudgetCodec })

    expect(assets).toHaveLength(1)
    expect(assets[0].name).toBe('doc.pdf')
    // The over-budget payload never lands in an asset.
    expect(assets.every((asset) => asset.dataUrl.length <= IMAGE_COMPRESSION_POLICY.maxStoredPayloadBytes)).toBe(true)
  })

  it('returns an empty list when the only pasted image fails, without throwing', async () => {
    const failingCodec: ImageCodec = {
      decode: async () => {
        throw new Error('image-decode-failed')
      },
      encode: async () => 'data:image/jpeg;base64,AAAA',
    }
    const weirdImage = new File([new Uint8Array(100)], 'weird.png', { type: 'image/png' })

    await expect(assetsFromFiles([weirdImage], { codec: failingCodec })).resolves.toEqual([])
  })

  it('ignores unsupported file types', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    await expect(assetsFromFiles([file], { codec: stubCodec() })).resolves.toEqual([])
  })
})
