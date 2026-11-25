import { describe, expect, it, vi } from 'vitest'
import {
  IMAGE_COMPRESSION_POLICY,
  fileFromImageAsset,
  migrateSaveImages,
  planImageMigration,
} from './imageMigration'
import {
  FIXTURE_TIMESTAMP,
  base64DataUrl,
  boardWithCards,
  cardWithAssets,
  fileAsset,
  imageAsset,
  storeWithBoards,
} from './imageMigrationFixtures'
import {
  compressImage,
  dataUrlByteSize,
  type CompressedImage,
  type EncodeOptions,
  type ImageCodec,
} from '../shared/imageCompression'

const BUDGET = IMAGE_COMPRESSION_POLICY.maxStoredPayloadBytes

// Same deterministic fake-codec pattern as imageCompression.test.ts: encoded
// size is a pure function of the encode options, so these tests drive the REAL
// compressImage search — only the pixel work is faked.
function fakeCodec(opts: {
  width: number
  height: number
  hasAlpha?: boolean
  bytes: (options: EncodeOptions) => number
}): ImageCodec {
  return {
    decode: async () => ({
      width: opts.width,
      height: opts.height,
      hasAlpha: Boolean(opts.hasAlpha),
      source: null,
    }),
    encode: async (_image, options) => {
      const bytes = Math.max(3, Math.round(opts.bytes(options)))
      return `data:${options.mimeType};base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`
    },
  }
}

const pipelineCompress =
  (codec: ImageCodec) =>
  (file: File): Promise<CompressedImage> =>
    compressImage(file, codec)

const compressibleCodec = () => fakeCodec({ width: 4000, height: 3000, bytes: () => 60_000 })
// Pathological content: never fits any edge/quality step, so the real
// pipeline throws image-compression-over-budget.
const unfittableCodec = () => fakeCodec({ width: 6000, height: 6000, bytes: (o) => 300_000 + o.width * 100 })

describe('planImageMigration', () => {
  it('reports per-board over-budget assets, current bytes, and a worst-case estimate', () => {
    const bigAsset = imageAsset('asset-big', 'legacy-big.png', 500_000)
    const okAsset = imageAsset('asset-ok', 'small.png', 50_000)
    const otherOk = imageAsset('asset-other', 'other.png', 80_000)
    const store = storeWithBoards({
      'board-a': boardWithCards([cardWithAssets('card-1', [bigAsset, okAsset])]),
      'board-b': boardWithCards([cardWithAssets('card-2', [otherOk])]),
      'board-c': boardWithCards([cardWithAssets('card-3', [fileAsset('asset-pdf', 'doc.pdf', 400_000)])]),
    })

    const plan = planImageMigration(store)

    expect(plan.budgetBytes).toBe(BUDGET)
    expect(plan.boardCount).toBe(3)
    // board-c has no image assets, so it does not appear in the per-board list.
    expect(plan.boards.map((board) => board.boardId)).toEqual(['board-a', 'board-b'])
    expect(plan.imageAssetCount).toBe(3)
    expect(plan.overBudgetAssetCount).toBe(1)

    const boardA = plan.boards[0]
    expect(boardA.overBudgetAssetCount).toBe(1)
    expect(boardA.overBudgetAssets[0]).toMatchObject({ assetId: 'asset-big', cardId: 'card-1' })
    expect(boardA.currentImageDataUrlBytes).toBe(bigAsset.dataUrl.length + okAsset.dataUrl.length)
    // Worst case: the over-budget asset lands exactly at the budget.
    expect(boardA.estimatedImageDataUrlBytes).toBe(okAsset.dataUrl.length + BUDGET)

    expect(plan.currentImageDataUrlBytes).toBe(
      bigAsset.dataUrl.length + okAsset.dataUrl.length + otherOk.dataUrl.length,
    )
    expect(plan.estimatedImageDataUrlBytes).toBe(okAsset.dataUrl.length + otherOk.dataUrl.length + BUDGET)
  })

  it('does not mutate the save', () => {
    const store = storeWithBoards({
      'board-a': boardWithCards([cardWithAssets('card-1', [imageAsset('asset-big', 'big.png', 400_000)])]),
    })
    const snapshot = JSON.stringify(store)

    planImageMigration(store)

    expect(JSON.stringify(store)).toBe(snapshot)
  })
})

describe('migrateSaveImages', () => {
  it('recompresses an over-budget legacy asset through the real pipeline and keeps compliant assets untouched', async () => {
    const bigAsset = imageAsset('asset-big', 'legacy-big.png', 500_000)
    const okAsset = imageAsset('asset-ok', 'small.png', 50_000)
    const pdfAsset = fileAsset('asset-pdf', 'doc.pdf', 400_000)
    const untouchedBoard = boardWithCards([cardWithAssets('card-2', [imageAsset('asset-other', 'other.png', 60_000)])])
    const store = storeWithBoards({
      'board-a': boardWithCards([cardWithAssets('card-1', [bigAsset, okAsset, pdfAsset])]),
      'board-b': untouchedBoard,
    })

    const { save, report } = await migrateSaveImages(store, {
      compress: pipelineCompress(compressibleCodec()),
      now: () => '2026-07-07T12:00:00.000Z',
    })

    expect(report.changed).toBe(true)
    expect(report.migratedCount).toBe(1)
    expect(report.keptCount).toBe(0)
    expect(report.scannedImageAssets).toBe(3)
    expect(report.alreadyCompliantAssets).toBe(2)
    expect(report.outcomes).toHaveLength(1)
    expect(report.outcomes[0]).toMatchObject({
      boardId: 'board-a',
      cardId: 'card-1',
      assetId: 'asset-big',
      status: 'migrated',
    })

    const migratedCard = save.boards['board-a'].cards[0]
    const migratedAsset = migratedCard.assets![0]
    expect(migratedAsset.dataUrl.length).toBeLessThanOrEqual(BUDGET)
    expect(migratedAsset.dataUrl.length).toBeLessThan(bigAsset.dataUrl.length)
    expect(migratedAsset.compression).toBe('compressed')
    expect(migratedAsset.mimeType).toBe('image/jpeg')
    expect(migratedAsset.width).toBe(1280)
    expect(migratedAsset.height).toBe(960)
    expect(migratedAsset.size).toBe(dataUrlByteSize(migratedAsset.dataUrl))
    // The stored original's binary size and mime survive as provenance.
    expect(migratedAsset.originalSize).toBe(dataUrlByteSize(bigAsset.dataUrl))
    expect(migratedAsset.originalMimeType).toBe('image/png')
    expect(migratedAsset.id).toBe('asset-big')
    expect(migratedAsset.createdAt).toBe(bigAsset.createdAt)

    // Compliant and non-image assets are the same objects, not rewrites.
    expect(migratedCard.assets![1]).toBe(okAsset)
    expect(migratedCard.assets![2]).toBe(pdfAsset)

    // Only the changed board gets a bumped updatedAt; untouched boards keep
    // their identity entirely.
    expect(save.boards['board-a'].updatedAt).toBe('2026-07-07T12:00:00.000Z')
    expect(save.boards['board-b']).toBe(untouchedBoard)
    expect(save.boards['board-b'].updatedAt).toBe(FIXTURE_TIMESTAMP)

    expect(report.beforeTotalImageDataUrlBytes).toBe(
      bigAsset.dataUrl.length + okAsset.dataUrl.length + untouchedBoard.cards[0].assets![0].dataUrl.length,
    )
    expect(report.afterTotalImageDataUrlBytes).toBe(
      migratedAsset.dataUrl.length + okAsset.dataUrl.length + untouchedBoard.cards[0].assets![0].dataUrl.length,
    )
  })

  it('leaves an undecodable asset byte-for-byte untouched and lists it', async () => {
    const badAsset = imageAsset('asset-bad', 'corrupt.png', 400_000)
    const store = storeWithBoards({
      'board-a': boardWithCards([cardWithAssets('card-1', [badAsset])]),
    })
    const compress = vi.fn().mockRejectedValue(new Error('image-decode-failed'))

    const { save, report } = await migrateSaveImages(store, { compress, now: () => '2026-07-07T12:00:00.000Z' })

    expect(report.changed).toBe(false)
    expect(report.outcomes).toEqual([
      expect.objectContaining({
        assetId: 'asset-bad',
        status: 'kept-undecodable',
        beforeDataUrlBytes: badAsset.dataUrl.length,
        afterDataUrlBytes: badAsset.dataUrl.length,
        detail: 'image-decode-failed',
      }),
    ])
    // The whole board is untouched — same object, no updatedAt bump.
    expect(save.boards['board-a'].cards[0].assets![0]).toBe(badAsset)
    expect(save.boards['board-a'].updatedAt).toBe(FIXTURE_TIMESTAMP)
  })

  it('treats a non-base64 data URL as undecodable without calling compress', async () => {
    const weirdAsset = {
      ...imageAsset('asset-weird', 'weird.svg', 100),
      dataUrl: `data:image/svg+xml,${'<svg>'.repeat(60_000)}`,
    }
    const store = storeWithBoards({
      'board-a': boardWithCards([cardWithAssets('card-1', [weirdAsset])]),
    })
    const compress = vi.fn()

    const { save, report } = await migrateSaveImages(store, { compress })

    expect(compress).not.toHaveBeenCalled()
    expect(report.outcomes[0]).toMatchObject({ status: 'kept-undecodable', detail: 'image-data-url-not-base64' })
    expect(save.boards['board-a'].cards[0].assets![0]).toBe(weirdAsset)
  })

  it('keeps an asset the real pipeline cannot fit under the budget', async () => {
    const stubbornAsset = imageAsset('asset-stubborn', 'stubborn.png', 900_000)
    const store = storeWithBoards({
      'board-a': boardWithCards([cardWithAssets('card-1', [stubbornAsset])]),
    })

    const { save, report } = await migrateSaveImages(store, {
      compress: pipelineCompress(unfittableCodec()),
    })

    expect(report.changed).toBe(false)
    expect(report.migratedCount).toBe(0)
    expect(report.outcomes[0]).toMatchObject({
      assetId: 'asset-stubborn',
      status: 'kept-unfittable',
      detail: 'image-compression-over-budget',
    })
    expect(save.boards['board-a'].cards[0].assets![0]).toBe(stubbornAsset)
  })

  it('rejects a compress result that is not a strict improvement, even if compress claims success', async () => {
    const bigAsset = imageAsset('asset-big', 'big.png', 400_000)
    const store = storeWithBoards({
      'board-a': boardWithCards([cardWithAssets('card-1', [bigAsset])]),
    })
    // A misbehaving compress step that returns an over-budget payload.
    const overBudgetDataUrl = base64DataUrl('image/jpeg', 250_000)
    const compress = vi.fn().mockResolvedValue({
      dataUrl: overBudgetDataUrl,
      mimeType: 'image/jpeg',
      size: dataUrlByteSize(overBudgetDataUrl),
      width: 1280,
      height: 960,
      originalSize: 300_000,
      originalMimeType: 'image/png',
    })

    const { save, report } = await migrateSaveImages(store, { compress })

    expect(report.outcomes[0].status).toBe('kept-unfittable')
    expect(save.boards['board-a'].cards[0].assets![0]).toBe(bigAsset)
  })

  it('is idempotent: a second run on a migrated save changes nothing and skips compliant assets', async () => {
    const store = storeWithBoards({
      'board-a': boardWithCards([
        cardWithAssets('card-1', [imageAsset('asset-1', 'one.png', 500_000)]),
        cardWithAssets('card-2', [imageAsset('asset-2', 'two.png', 300_000)]),
      ]),
    })
    const compress = pipelineCompress(compressibleCodec())

    const first = await migrateSaveImages(store, { compress, now: () => '2026-07-07T12:00:00.000Z' })
    expect(first.report.changed).toBe(true)
    expect(first.report.migratedCount).toBe(2)

    const compressSpy = vi.fn(compress)
    const second = await migrateSaveImages(first.save, { compress: compressSpy, now: () => '2026-07-08T12:00:00.000Z' })

    expect(second.report.changed).toBe(false)
    expect(second.report.outcomes).toEqual([])
    expect(second.report.alreadyCompliantAssets).toBe(2)
    expect(compressSpy).not.toHaveBeenCalled()
    // No-op runs return the same save object; nothing is rebuilt or re-stamped.
    expect(second.save).toBe(first.save)
    expect(second.save.boards['board-a'].updatedAt).toBe('2026-07-07T12:00:00.000Z')
  })

  it('is a no-op on a save whose only over-budget assets are unfittable', async () => {
    const store = storeWithBoards({
      'board-a': boardWithCards([cardWithAssets('card-1', [imageAsset('asset-stubborn', 'stubborn.png', 500_000)])]),
    })
    const compress = pipelineCompress(unfittableCodec())

    const first = await migrateSaveImages(store, { compress })
    const second = await migrateSaveImages(first.save, { compress })

    expect(first.save).toBe(store)
    expect(second.save).toBe(store)
    expect(first.report.changed).toBe(false)
    expect(second.report.changed).toBe(false)
    // The kept asset is still reported on every run, never silently forgotten.
    expect(second.report.outcomes[0]).toMatchObject({ assetId: 'asset-stubborn', status: 'kept-unfittable' })
  })
})

describe('fileFromImageAsset', () => {
  it('rebuilds a File whose bytes and type match the stored data URL', async () => {
    const asset = imageAsset('asset-1', 'photo.png', 100_000)

    const file = fileFromImageAsset(asset)

    expect(file.name).toBe('photo.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBe(dataUrlByteSize(asset.dataUrl))
  })

  it('throws for data URLs that are not base64', () => {
    expect(() =>
      fileFromImageAsset({ dataUrl: 'data:image/svg+xml,<svg/>', mimeType: 'image/svg+xml', name: 'v.svg' }),
    ).toThrow('image-data-url-not-base64')
  })
})
