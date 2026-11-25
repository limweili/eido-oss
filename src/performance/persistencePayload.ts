import type { IdeaStore } from '../graph/storageMerge'
import type { Card, SavedBoard } from '../graph/types'
import { IMAGE_COMPRESSION_POLICY } from '../shared/imageCompression'

export const NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES = IMAGE_COMPRESSION_POLICY.maxStoredPayloadBytes

export type ImagePayloadSummary = {
  imageAssetCount: number
  totalImageDataUrlPayloadBytes: number
  largestImageDataUrlPayloadBytes: number
}

export type BoardPersistencePayloadReport = {
  boardId?: string
  cards: number
  connections: number
  outputs: number
  runs: number
  intentLogEvents: number
  totalBytes: number
  cardsBytes: number
  connectionsBytes: number
  outputsBytes: number
  runsBytes: number
  intentLogBytes: number
  imagePayload: ImagePayloadSummary
}

export type SavePersistencePayloadReport = {
  ideaCount: number
  boardCount: number
  activeBoardId: string | null
  totalBytes: number
  imagePayload: ImagePayloadSummary
  boards: BoardPersistencePayloadReport[]
  activeBoard?: BoardPersistencePayloadReport
}

export type ImageDataUrlBudgetViolation = {
  boardId?: string
  cardId: string
  assetId: string
  name: string
  dataUrlPayloadBytes: number
  budgetBytes: number
}

const textEncoder = new TextEncoder()

export function jsonPayloadBytes(value: unknown): number {
  return textEncoder.encode(JSON.stringify(value)).length
}

export function measureBoardPersistencePayload(
  board: SavedBoard,
  options: { boardId?: string } = {},
): BoardPersistencePayloadReport {
  return {
    boardId: options.boardId,
    cards: board.cards.length,
    connections: board.connections.length,
    outputs: board.outputs.length,
    runs: board.runs.length,
    intentLogEvents: board.intentLog?.length ?? 0,
    totalBytes: jsonPayloadBytes(board),
    cardsBytes: jsonPayloadBytes(board.cards),
    connectionsBytes: jsonPayloadBytes(board.connections),
    outputsBytes: jsonPayloadBytes(board.outputs),
    runsBytes: jsonPayloadBytes(board.runs),
    intentLogBytes: jsonPayloadBytes(board.intentLog ?? []),
    imagePayload: measureImagePayload(board.cards),
  }
}

export function measureSavePersistencePayload(save: IdeaStore): SavePersistencePayloadReport {
  const boards = Object.entries(save.boards).map(([boardId, board]) =>
    measureBoardPersistencePayload(board, { boardId }),
  )
  const activeBoard = save.activeIdeaId ? boards.find((board) => board.boardId === save.activeIdeaId) : undefined

  return {
    ideaCount: save.ideas.length,
    boardCount: boards.length,
    activeBoardId: save.activeIdeaId,
    totalBytes: jsonPayloadBytes(save),
    imagePayload: combineImagePayloads(boards.map((board) => board.imagePayload)),
    boards,
    ...(activeBoard ? { activeBoard } : {}),
  }
}

export function measureImagePayload(cards: Pick<Card, 'assets'>[]): ImagePayloadSummary {
  let imageAssetCount = 0
  let totalImageDataUrlPayloadBytes = 0
  let largestImageDataUrlPayloadBytes = 0

  for (const card of cards) {
    for (const asset of card.assets ?? []) {
      if (asset.kind !== 'image') continue
      const dataUrlPayloadBytes = asset.dataUrl.length
      imageAssetCount += 1
      totalImageDataUrlPayloadBytes += dataUrlPayloadBytes
      largestImageDataUrlPayloadBytes = Math.max(largestImageDataUrlPayloadBytes, dataUrlPayloadBytes)
    }
  }

  return {
    imageAssetCount,
    totalImageDataUrlPayloadBytes,
    largestImageDataUrlPayloadBytes,
  }
}

/**
 * Reports stored image data URLs over the newly-pasted image budget across the
 * whole board. This includes legacy pre-compression assets from old saves, so a
 * violation here means stored data still exceeds the current budget, not that
 * the paste compression pipeline accepted an over-budget image.
 */
export function findImageDataUrlBudgetViolations(
  board: SavedBoard,
  options: { boardId?: string; budgetBytes?: number } = {},
): ImageDataUrlBudgetViolation[] {
  const budgetBytes = options.budgetBytes ?? NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES
  const violations: ImageDataUrlBudgetViolation[] = []

  for (const card of board.cards) {
    for (const asset of card.assets ?? []) {
      if (asset.kind !== 'image') continue
      const dataUrlPayloadBytes = asset.dataUrl.length
      if (dataUrlPayloadBytes <= budgetBytes) continue
      violations.push({
        boardId: options.boardId,
        cardId: card.id,
        assetId: asset.id,
        name: asset.name,
        dataUrlPayloadBytes,
        budgetBytes,
      })
    }
  }

  return violations
}

function combineImagePayloads(payloads: ImagePayloadSummary[]): ImagePayloadSummary {
  return payloads.reduce<ImagePayloadSummary>(
    (combined, payload) => ({
      imageAssetCount: combined.imageAssetCount + payload.imageAssetCount,
      totalImageDataUrlPayloadBytes:
        combined.totalImageDataUrlPayloadBytes + payload.totalImageDataUrlPayloadBytes,
      largestImageDataUrlPayloadBytes: Math.max(
        combined.largestImageDataUrlPayloadBytes,
        payload.largestImageDataUrlPayloadBytes,
      ),
    }),
    {
      imageAssetCount: 0,
      totalImageDataUrlPayloadBytes: 0,
      largestImageDataUrlPayloadBytes: 0,
    },
  )
}
