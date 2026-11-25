import { describe, expect, it } from 'vitest'
import { measureStorePerformance, slowestStoreOperations, STORE_PERFORMANCE_CASES, storeResultRows } from './storePerformance'

// Large-fixture budgets (#109), in ms, on the 5,000-card / 10,000-connection
// fixture. Each number is the observed median of repeated warm samples plus
// ~50% headroom, so a failure here means the code got slower, not that the
// machine was busy.
//
// These budgets record what the store costs today; they are NOT the product
// target. The interaction target is 8.3ms (120Hz-class) for anything on a
// typing or dragging hot path, and at 5,000 cards several operations miss it:
// every commit rebuilds whole-board state, so cost scales with board size.
// Closing that gap is separate work (#143 for drag batching); loosening these
// numbers to make a slow commit pass would defeat the point of the file.
//
// Smaller boards are comfortably inside the target: the 1,000-card fixture
// stays under ~3.5ms and the 100-card fixture under ~0.5ms for every operation.
const LARGE_BUDGET_MS: Record<string, number> = {
  setCardText: 11,
  appendVersionText: 8,
  appendTranscriptChunk: 7,
  moveCard: 17,
  moveGroup: 17,
  addConnection: 12,
  deleteConnection: 14,
  addCard: 31,
  deleteCard: 32,
  beginRun: 12,
  undo: 14,
  redo: 14,
}

describe('store operation performance report', () => {
  it(
    'reports baseline timings for high-risk Board store operations',
    () => {
      const results = STORE_PERFORMANCE_CASES.map(measureStorePerformance)

      expect(results).toHaveLength(STORE_PERFORMANCE_CASES.length)
      for (const result of results) {
        expect(result.measurements.map((measurement) => measurement.operation)).toEqual([
          'setCardText',
          'appendVersionText',
          'appendTranscriptChunk',
          'moveCard',
          'moveGroup',
          'addConnection',
          'deleteConnection',
          'addCard',
          'deleteCard',
          'beginRun',
          'undo',
          'redo',
        ])
      }

      console.log('\nStore operation performance report')
      console.table(storeResultRows(results))
      console.log('\nSlowest store operations')
      console.table(slowestStoreOperations(results))

      // Budgets are asserted AFTER the tables print, so a failure still
      // leaves the full timing report for diagnosis.
      const large = results.find((result) => result.caseName === 'large')
      expect(large).toBeDefined()
      for (const measurement of large!.measurements) {
        const budget = LARGE_BUDGET_MS[measurement.operation]
        expect(budget, `no budget declared for ${measurement.operation}`).toBeDefined()
        expect(
          measurement.ms,
          `large-board ${measurement.operation} took ${measurement.ms.toFixed(2)}ms — budget ${budget}ms`,
        ).toBeLessThanOrEqual(budget)
      }

      // The smaller fixtures are where the 8.3ms interaction target must hold.
      // One ceiling per fixture keeps the claim above honest without pinning a
      // separate number to every operation.
      for (const [caseName, ceiling] of [['smoke', 1], ['medium', 5]] as const) {
        const result = results.find((entry) => entry.caseName === caseName)
        expect(result, `missing ${caseName} fixture`).toBeDefined()
        for (const measurement of result!.measurements) {
          expect(
            measurement.ms,
            `${caseName}-board ${measurement.operation} took ${measurement.ms.toFixed(2)}ms — ceiling ${ceiling}ms`,
          ).toBeLessThanOrEqual(ceiling)
        }
      }
    },
    120_000,
  )
})
