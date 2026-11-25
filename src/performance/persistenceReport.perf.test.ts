import { describe, expect, it } from 'vitest'
import { createPerfBoard, type PerfBoardName } from '../graph/perfFixtures'
import type { SavedBoard } from '../graph/types'
import imagePayloadBaseline from './baselines/imagePayload.baseline.json'
import {
  NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES,
  measureBoardPersistencePayload,
  measureSavePersistencePayload,
  type ImagePayloadSummary,
} from './persistencePayload'
import { makeImagePayloadBoard, makeImagePayloadSave } from './persistencePayloadFixtures'

const CASES: PerfBoardName[] = ['smoke', 'medium', 'large']

// Budgets (#94): serialization sits on the debounced save path, off the
// keystroke itself but still main-thread. The large fixture must serialize
// well inside a frame-budget multiple; the threshold that triggers normalized
// persistence work is documented in research/03-performance-architecture.
const SERIALIZE_BUDGET_MS: Record<PerfBoardName, number> = {
  smoke: 5,
  medium: 20,
  large: 120,
  rich: 120,
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(1)
}

function measure(fixture: PerfBoardName) {
  const board: SavedBoard = createPerfBoard(fixture)

  const start = performance.now()
  JSON.stringify(board)
  const serializeMs = performance.now() - start

  const report = measureBoardPersistencePayload(board)

  return {
    fixture,
    cards: report.cards,
    connections: report.connections,
    outputs: report.outputs,
    runs: report.runs,
    intentLogEvents: report.intentLogEvents,
    totalKb: kb(report.totalBytes),
    cardsKb: kb(report.cardsBytes),
    connectionsKb: kb(report.connectionsBytes),
    outputsKb: kb(report.outputsBytes),
    runsKb: kb(report.runsBytes),
    intentLogKb: kb(report.intentLogBytes),
    imageAssetCount: report.imagePayload.imageAssetCount,
    totalImageDataUrlPayloadBytes: report.imagePayload.totalImageDataUrlPayloadBytes,
    largestImageDataUrlPayloadBytes: report.imagePayload.largestImageDataUrlPayloadBytes,
    serializeMs: serializeMs.toFixed(2),
    raw: { serializeMs, totalBytes: report.totalBytes },
  }
}

function imagePayloadRow(scope: string, payload: ImagePayloadSummary) {
  return {
    scope,
    imageAssetCount: payload.imageAssetCount,
    totalImageDataUrlPayloadBytes: payload.totalImageDataUrlPayloadBytes,
    totalImagePayloadKb: kb(payload.totalImageDataUrlPayloadBytes),
    largestImageDataUrlPayloadBytes: payload.largestImageDataUrlPayloadBytes,
    // This is the newly-pasted compression budget. Real legacy saves can still
    // report larger stored image data URLs until the Lane E migration removes
    // pre-compression assets.
    budgetBytesPerNewImage: NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES,
  }
}

function issue247BaselineRows() {
  return Object.entries(imagePayloadBaseline.measurements).map(([metric, value]) => ({
    metric,
    value,
    source: `#${imagePayloadBaseline.provenance.issue}`,
  }))
}

describe('persistence payload report (#94)', () => {
  it(
    'reports snapshot size and serialization cost per fixture, split by collection',
    () => {
      const rows = CASES.map(measure)

      console.log('\nPersistence payload report')
      console.table(rows.map(({ raw: _raw, ...row }) => row))

      const imageBoard = measureBoardPersistencePayload(
        makeImagePayloadBoard('report-image-board', [64 * 1024, NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES]),
        { boardId: 'report-image-board' },
      )
      const imageSave = measureSavePersistencePayload(
        makeImagePayloadSave([
          { id: 'report-image-board', payloadBytes: [64 * 1024, NEWLY_PASTED_IMAGE_DATA_URL_BUDGET_BYTES] },
          { id: 'report-reference-board', payloadBytes: [32 * 1024] },
        ]),
      )
      console.log('\nImage asset payload report (#247)')
      console.table([
        imagePayloadRow(`board:${imageBoard.boardId ?? 'unknown'}`, imageBoard.imagePayload),
        imagePayloadRow('save:synthetic-image-payload', imageSave.imagePayload),
        ...(imageSave.activeBoard
          ? [imagePayloadRow(`active-board:${imageSave.activeBoard.boardId ?? 'unknown'}`, imageSave.activeBoard.imagePayload)]
          : []),
      ])

      console.log('\nIssue #247 image payload reference baseline (recorded evidence, not a timing gate)')
      console.table(issue247BaselineRows())

      for (const row of rows) {
        const budget = SERIALIZE_BUDGET_MS[row.fixture]
        expect(
          row.raw.serializeMs,
          `${row.fixture} serialization ${row.raw.serializeMs.toFixed(2)}ms — budget ${budget}ms`,
        ).toBeLessThanOrEqual(budget)
      }
    },
    120_000,
  )
})
