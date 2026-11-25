// Lane E of #247 (#283): opt-in migration of legacy image assets through the
// same compression pipeline that gates newly pasted images (#268). This module
// is the pure core — selection, safety rules, and reporting. Pixel work stays
// behind the injected `compress` function so the logic runs identically under
// node, jsdom tests, and the browser. It is only ever invoked explicitly (dev
// script); nothing here runs on load or save.
//
// Safety rules, stricter than the paste path: an asset is rewritten only when
// the compressed payload is under IMAGE_COMPRESSION_POLICY.maxStoredPayloadBytes
// AND strictly smaller than the stored original. Assets that cannot be decoded
// or cannot fit the budget are left byte-for-byte untouched and listed in the
// report — never dropped, never replaced with a worse version.

import type { IdeaStore } from '../graph/storageMerge'
import type { Card, CardAsset, SavedBoard } from '../graph/types'
import {
  IMAGE_COMPRESSION_POLICY,
  compressImage,
  storedPayloadBytes,
  type CompressedImage,
} from '../shared/imageCompression'
import {
  findImageDataUrlBudgetViolations,
  measureImagePayload,
  type ImageDataUrlBudgetViolation,
} from '../performance/persistencePayload'

export { IMAGE_COMPRESSION_POLICY }

// ---- Dry-run plan ----------------------------------------------------------

export type BoardMigrationPlan = {
  boardId: string
  imageAssetCount: number
  overBudgetAssetCount: number
  currentImageDataUrlBytes: number
  // Worst-case estimate: every over-budget asset lands exactly at the budget.
  // Real results are at or below this; unfittable assets stay at current size.
  estimatedImageDataUrlBytes: number
  overBudgetAssets: ImageDataUrlBudgetViolation[]
}

export type SaveMigrationPlan = {
  budgetBytes: number
  boardCount: number
  imageAssetCount: number
  overBudgetAssetCount: number
  currentImageDataUrlBytes: number
  estimatedImageDataUrlBytes: number
  // Only boards that hold at least one image asset appear here.
  boards: BoardMigrationPlan[]
}

export function planImageMigration(save: IdeaStore): SaveMigrationPlan {
  const budgetBytes = IMAGE_COMPRESSION_POLICY.maxStoredPayloadBytes
  const boards: BoardMigrationPlan[] = []

  for (const [boardId, board] of Object.entries(save.boards)) {
    const payload = measureImagePayload(board.cards)
    if (payload.imageAssetCount === 0) continue
    const overBudgetAssets = findImageDataUrlBudgetViolations(board, { boardId })
    const overBudgetBytes = sum(overBudgetAssets, (v) => v.dataUrlPayloadBytes)
    boards.push({
      boardId,
      imageAssetCount: payload.imageAssetCount,
      overBudgetAssetCount: overBudgetAssets.length,
      currentImageDataUrlBytes: payload.totalImageDataUrlPayloadBytes,
      estimatedImageDataUrlBytes:
        payload.totalImageDataUrlPayloadBytes - overBudgetBytes + overBudgetAssets.length * budgetBytes,
      overBudgetAssets,
    })
  }

  return {
    budgetBytes,
    boardCount: Object.keys(save.boards).length,
    imageAssetCount: sum(boards, (b) => b.imageAssetCount),
    overBudgetAssetCount: sum(boards, (b) => b.overBudgetAssetCount),
    currentImageDataUrlBytes: sum(boards, (b) => b.currentImageDataUrlBytes),
    estimatedImageDataUrlBytes: sum(boards, (b) => b.estimatedImageDataUrlBytes),
    boards,
  }
}

// ---- Migration -------------------------------------------------------------

export type AssetMigrationStatus =
  // Rewritten: compressed under budget and strictly smaller than the original.
  | 'migrated'
  // Left untouched: the stored data URL could not be decoded into an image.
  | 'kept-undecodable'
  // Left untouched: the pipeline could not produce a strictly smaller result
  // under the budget (or the compress step failed while encoding).
  | 'kept-unfittable'

export type AssetMigrationOutcome = {
  boardId: string
  cardId: string
  assetId: string
  name: string
  status: AssetMigrationStatus
  beforeDataUrlBytes: number
  // Equals beforeDataUrlBytes for kept-* outcomes.
  afterDataUrlBytes: number
  detail?: string
}

export type SaveMigrationReport = {
  budgetBytes: number
  scannedImageAssets: number
  alreadyCompliantAssets: number
  // One entry per over-budget asset the pass attempted.
  outcomes: AssetMigrationOutcome[]
  migratedCount: number
  keptCount: number
  beforeTotalImageDataUrlBytes: number
  afterTotalImageDataUrlBytes: number
  changed: boolean
}

export type MigrateImagesOptions = {
  // The compression step. Defaults to the real pipeline with the browser
  // codec; tests inject `(file) => compressImage(file, fakeCodec)` and the dev
  // script injects a version that runs compressImage inside a real browser.
  compress?: (file: File) => Promise<CompressedImage>
  // Timestamp for `updatedAt` on boards that changed, so the migrated save is
  // strictly newer than any stale browser-side copy during store merges. When
  // omitted, updatedAt is left alone.
  now?: () => string
}

export type SaveMigrationResult = {
  save: IdeaStore
  report: SaveMigrationReport
}

export async function migrateSaveImages(
  save: IdeaStore,
  options: MigrateImagesOptions = {},
): Promise<SaveMigrationResult> {
  const budgetBytes = IMAGE_COMPRESSION_POLICY.maxStoredPayloadBytes
  const compress = options.compress ?? ((file: File) => compressImage(file))
  const outcomes: AssetMigrationOutcome[] = []
  let scannedImageAssets = 0
  let beforeTotalImageDataUrlBytes = 0
  let afterTotalImageDataUrlBytes = 0

  const nextBoards: Record<string, SavedBoard> = {}
  let changed = false

  for (const [boardId, board] of Object.entries(save.boards)) {
    let boardChanged = false
    const nextCards: Card[] = []

    for (const card of board.cards) {
      if (!card.assets?.some((asset) => asset.kind === 'image')) {
        nextCards.push(card)
        continue
      }

      let cardChanged = false
      const nextAssets: CardAsset[] = []
      for (const asset of card.assets) {
        if (asset.kind !== 'image') {
          nextAssets.push(asset)
          continue
        }
        scannedImageAssets += 1
        const beforeBytes = storedPayloadBytes(asset.dataUrl)
        beforeTotalImageDataUrlBytes += beforeBytes
        if (beforeBytes <= budgetBytes) {
          nextAssets.push(asset)
          afterTotalImageDataUrlBytes += beforeBytes
          continue
        }

        const migrated = await migrateAsset(asset, compress, budgetBytes)
        outcomes.push({
          boardId,
          cardId: card.id,
          assetId: asset.id,
          name: asset.name,
          status: migrated.status,
          beforeDataUrlBytes: beforeBytes,
          afterDataUrlBytes: storedPayloadBytes(migrated.asset.dataUrl),
          ...(migrated.detail ? { detail: migrated.detail } : {}),
        })
        nextAssets.push(migrated.asset)
        afterTotalImageDataUrlBytes += storedPayloadBytes(migrated.asset.dataUrl)
        if (migrated.status === 'migrated') cardChanged = true
      }

      nextCards.push(cardChanged ? { ...card, assets: nextAssets } : card)
      if (cardChanged) boardChanged = true
    }

    if (boardChanged) {
      nextBoards[boardId] = {
        ...board,
        cards: nextCards,
        ...(options.now ? { updatedAt: options.now() } : {}),
      }
      changed = true
    } else {
      nextBoards[boardId] = board
    }
  }

  const migratedCount = outcomes.filter((outcome) => outcome.status === 'migrated').length
  const report: SaveMigrationReport = {
    budgetBytes,
    scannedImageAssets,
    alreadyCompliantAssets: scannedImageAssets - outcomes.length,
    outcomes,
    migratedCount,
    keptCount: outcomes.length - migratedCount,
    beforeTotalImageDataUrlBytes,
    afterTotalImageDataUrlBytes,
    changed,
  }

  return { save: changed ? { ...save, boards: nextBoards } : save, report }
}

async function migrateAsset(
  asset: CardAsset,
  compress: (file: File) => Promise<CompressedImage>,
  budgetBytes: number,
): Promise<{ asset: CardAsset; status: AssetMigrationStatus; detail?: string }> {
  let file: File
  try {
    file = fileFromImageAsset(asset)
  } catch (error) {
    return { asset, status: 'kept-undecodable', detail: errorMessage(error) }
  }

  let compressed: CompressedImage
  try {
    compressed = await compress(file)
  } catch (error) {
    const message = errorMessage(error)
    const status: AssetMigrationStatus =
      message === 'image-compression-over-budget' ? 'kept-unfittable' : 'kept-undecodable'
    return { asset, status, detail: message }
  }

  // Stricter than the paste path: the rewrite must be a strict improvement.
  const afterBytes = storedPayloadBytes(compressed.dataUrl)
  const beforeBytes = storedPayloadBytes(asset.dataUrl)
  if (afterBytes > budgetBytes || afterBytes >= beforeBytes) {
    return {
      asset,
      status: 'kept-unfittable',
      detail: `compressed payload ${afterBytes} bytes did not improve on ${beforeBytes} bytes under budget ${budgetBytes}`,
    }
  }

  return {
    status: 'migrated',
    asset: {
      ...asset,
      mimeType: compressed.mimeType,
      dataUrl: compressed.dataUrl,
      size: compressed.size,
      width: compressed.width,
      height: compressed.height,
      // Legacy assets predate the compression metadata; keep the earliest
      // known original if a previous pass already recorded one.
      originalSize: asset.originalSize ?? compressed.originalSize,
      originalMimeType: asset.originalMimeType ?? compressed.originalMimeType,
      compression: 'compressed',
    },
  }
}

// Rebuilds a File from a stored base64 data URL so the compression pipeline
// can treat a legacy asset exactly like a fresh paste.
export function fileFromImageAsset(asset: Pick<CardAsset, 'dataUrl' | 'mimeType' | 'name'>): File {
  const match = /^data:([^;,]+)?(;base64)?,/.exec(asset.dataUrl)
  if (!match || !match[2]) throw new Error('image-data-url-not-base64')
  const mimeType = match[1] || asset.mimeType || 'application/octet-stream'
  const base64 = asset.dataUrl.slice(match[0].length)
  let binary: string
  try {
    binary = atob(base64)
  } catch {
    throw new Error('image-data-url-invalid-base64')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], asset.name || 'legacy-image', { type: mimeType })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sum<T>(items: T[], select: (item: T) => number): number {
  return items.reduce((total, item) => total + select(item), 0)
}

// ---- Human-readable report formatting (shared by the dev script and tests) --

export function formatMigrationPlan(plan: SaveMigrationPlan): string {
  const lines = [
    `Image migration preflight (budget ${formatBytes(plan.budgetBytes)} per stored data URL)`,
    `Boards: ${plan.boardCount} (${plan.boards.length} with images) | image assets: ${plan.imageAssetCount} | over budget: ${plan.overBudgetAssetCount}`,
    `Current image payload: ${formatBytes(plan.currentImageDataUrlBytes)} | estimated after migration: ≤ ${formatBytes(plan.estimatedImageDataUrlBytes)}`,
  ]
  for (const board of plan.boards) {
    lines.push(
      `  Board ${board.boardId}: ${board.overBudgetAssetCount}/${board.imageAssetCount} image assets over budget, ` +
        `${formatBytes(board.currentImageDataUrlBytes)} now, ≤ ${formatBytes(board.estimatedImageDataUrlBytes)} after`,
    )
    for (const asset of board.overBudgetAssets) {
      lines.push(`    - ${asset.name} (${asset.assetId}) ${formatBytes(asset.dataUrlPayloadBytes)}`)
    }
  }
  if (plan.overBudgetAssetCount === 0) lines.push('Nothing to migrate: every image asset is within budget.')
  return lines.join('\n')
}

export function formatMigrationReport(report: SaveMigrationReport): string {
  const lines = [
    `Migration pass: ${report.migratedCount} migrated, ${report.keptCount} kept untouched, ` +
      `${report.alreadyCompliantAssets} already compliant (of ${report.scannedImageAssets} image assets)`,
    `Image payload: ${formatBytes(report.beforeTotalImageDataUrlBytes)} before → ${formatBytes(report.afterTotalImageDataUrlBytes)} after`,
  ]
  for (const outcome of report.outcomes) {
    const change =
      outcome.status === 'migrated'
        ? `${formatBytes(outcome.beforeDataUrlBytes)} → ${formatBytes(outcome.afterDataUrlBytes)}`
        : `${formatBytes(outcome.beforeDataUrlBytes)} unchanged${outcome.detail ? ` (${outcome.detail})` : ''}`
    lines.push(`  [${outcome.status}] board ${outcome.boardId} card ${outcome.cardId} "${outcome.name}": ${change}`)
  }
  return lines.join('\n')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
