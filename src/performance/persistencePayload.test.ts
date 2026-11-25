import { describe, expect, it } from 'vitest'
import { IMAGE_COMPRESSION_POLICY } from '../shared/imageCompression'
import { makeImagePayloadBoard, makeImagePayloadSave } from './persistencePayloadFixtures'
import {
  NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES,
  findImageDataUrlBudgetViolations,
  measureBoardPersistencePayload,
  measureSavePersistencePayload,
} from './persistencePayload'

describe('persistence image payload reporting (#247)', () => {
  it('measures image dataUrl payload bytes, image count, and largest asset for a generated board', () => {
    const board = makeImagePayloadBoard('board-with-images', [
      1_024,
      12_345,
      NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES,
    ])
    board.cards[0].assets?.push({
      id: 'asset-file-ignored',
      kind: 'file',
      name: 'ignored.pdf',
      mimeType: 'application/pdf',
      dataUrl: 'data:application/pdf;base64,'.padEnd(500_000, 'a'),
      size: 500_000,
      createdAt: board.updatedAt,
    })

    const report = measureBoardPersistencePayload(board)

    expect(report.imagePayload).toEqual({
      imageAssetCount: 3,
      totalImageDataUrlPayloadBytes: 1_024 + 12_345 + NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES,
      largestImageDataUrlPayloadBytes: NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES,
    })
  })

  it('measures image payload occurrences across a generated save and per board', () => {
    const save = makeImagePayloadSave([
      { id: 'idea-active', payloadBytes: [10_000, 20_000] },
      { id: 'idea-reference', payloadBytes: [30_000] },
    ])

    const report = measureSavePersistencePayload(save)

    expect(report.imagePayload).toEqual({
      imageAssetCount: 3,
      totalImageDataUrlPayloadBytes: 60_000,
      largestImageDataUrlPayloadBytes: 30_000,
    })
    expect(report.boards.map((board) => [board.boardId, board.imagePayload.totalImageDataUrlPayloadBytes])).toEqual([
      ['idea-active', 30_000],
      ['idea-reference', 30_000],
    ])
    expect(report.activeBoard?.boardId).toBe('idea-active')
    expect(report.activeBoard?.imagePayload.totalImageDataUrlPayloadBytes).toBe(30_000)
  })

  it('gates stored image dataUrls against the shared newly pasted image budget', () => {
    // Keep this even though the constant is derived from the policy; if the
    // derivation is ever reverted to an independent literal, this fires as soon
    // as the two drift apart.
    expect(NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES).toBe(IMAGE_COMPRESSION_POLICY.maxStoredPayloadBytes)

    const withinBudget = makeImagePayloadBoard('within-budget', [
      NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES - 1,
      NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES,
    ])
    expect(findImageDataUrlBudgetViolations(withinBudget)).toEqual([])

    const overBudget = makeImagePayloadBoard('over-budget', [NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES + 1])
    expect(findImageDataUrlBudgetViolations(overBudget)).toEqual([
      {
        boardId: undefined,
        cardId: 'over-budget-card-0',
        assetId: 'over-budget-asset-0',
        name: 'synthetic-image-0.png',
        dataUrlPayloadBytes: NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES + 1,
        budgetBytes: NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES,
      },
    ])
  })
})
