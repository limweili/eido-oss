import { describe, expect, it } from 'vitest'
import { createGraphIndexCache, createGraphIndex } from '../graph/graphIndex'
import { createPerfBoard, type PerfBoardName } from '../graph/perfFixtures'

const GRAPH_INDEX_PERFORMANCE_CASES = ['smoke', 'medium', 'large'] as const satisfies readonly PerfBoardName[]
const LOOKUPS_PER_WORKLOAD = 10_000

// Budgets (#109), in ms, ~3x observed medians for headroom. Construction can
// sit on a commit path (any collection change rebuilds that sub-index), so
// the large full build must stay well under the 8.3ms interaction target.
// The identity hit is the per-frame path — effectively free or the cache is
// broken. Lookup workloads are 10k lookups, far beyond any single frame; they
// bound the aggregate cost, not a per-frame slice.
const INDEX_BUDGETS_MS: Record<(typeof GRAPH_INDEX_PERFORMANCE_CASES)[number], { fullBuild: number; identityHitPerCall: number; cardsOnlyRebuild: number; indexedLookups: number }> = {
  smoke: { fullBuild: 3, identityHitPerCall: 0.01, cardsOnlyRebuild: 3, indexedLookups: 10 },
  medium: { fullBuild: 6, identityHitPerCall: 0.01, cardsOnlyRebuild: 6, indexedLookups: 20 },
  large: { fullBuild: 12, identityHitPerCall: 0.01, cardsOnlyRebuild: 15, indexedLookups: 80 },
}

type GraphIndexPerfRow = {
  fixture: (typeof GRAPH_INDEX_PERFORMANCE_CASES)[number]
  cards: number
  connections: number
  fullBuildMs: string
  identityHitMs: string
  cardsOnlyRebuildMs: string
  indexedLookupsMs: string
  scanLookupsMs: string
  speedup: string
  raw: { fullBuildMs: number; identityHitMs: number; cardsOnlyRebuildMs: number; indexedLookupsMs: number }
}

function measureCase(fixture: (typeof GRAPH_INDEX_PERFORMANCE_CASES)[number]): GraphIndexPerfRow {
  const board = createPerfBoard(fixture)
  const cache = createGraphIndexCache()

  const buildStart = performance.now()
  const index = cache.get(board)
  const fullBuildMs = performance.now() - buildStart

  const hitStart = performance.now()
  for (let i = 0; i < 1000; i += 1) cache.get(board)
  const identityHitMs = (performance.now() - hitStart) / 1000

  // One collection changes identity; the other three sub-indexes must be
  // reused rather than rebuilt.
  const movedCards = board.cards.map((card) => ({ ...card }))
  const rebuildStart = performance.now()
  cache.get({ ...board, cards: movedCards })
  const cardsOnlyRebuildMs = performance.now() - rebuildStart

  const cardIds = board.cards.map((card) => card.id)
  const sampleIds = Array.from(
    { length: LOOKUPS_PER_WORKLOAD },
    (_, i) => cardIds[(i * 7919) % cardIds.length],
  )

  const indexedStart = performance.now()
  let indexedTouched = 0
  for (const id of sampleIds) {
    indexedTouched += index.incomingConnections(id).length + (index.cardById(id) ? 1 : 0)
  }
  const indexedLookupsMs = performance.now() - indexedStart

  const scanStart = performance.now()
  let scanTouched = 0
  for (const id of sampleIds) {
    scanTouched += board.connections.filter((connection) => connection.to.cardId === id).length
    scanTouched += board.cards.find((card) => card.id === id) ? 1 : 0
  }
  const scanLookupsMs = performance.now() - scanStart

  expect(indexedTouched).toBe(scanTouched)

  return {
    fixture,
    cards: board.cards.length,
    connections: board.connections.length,
    fullBuildMs: fullBuildMs.toFixed(2),
    identityHitMs: identityHitMs.toFixed(5),
    cardsOnlyRebuildMs: cardsOnlyRebuildMs.toFixed(2),
    indexedLookupsMs: indexedLookupsMs.toFixed(2),
    scanLookupsMs: scanLookupsMs.toFixed(2),
    speedup: `${(scanLookupsMs / Math.max(indexedLookupsMs, 0.001)).toFixed(0)}x`,
    raw: { fullBuildMs, identityHitMs, cardsOnlyRebuildMs, indexedLookupsMs },
  }
}

describe('graph index performance report', () => {
  it(
    'reports construction and lookup timings across performance fixtures',
    () => {
      const rows = [...GRAPH_INDEX_PERFORMANCE_CASES].map(measureCase)

      expect(rows).toHaveLength(GRAPH_INDEX_PERFORMANCE_CASES.length)

      console.log('\nGraph index performance report')
      console.table(rows.map(({ raw: _raw, ...row }) => row))

      // Budgets assert AFTER the table prints so failures keep the report.
      for (const row of rows) {
        const budget = INDEX_BUDGETS_MS[row.fixture]
        expect(
          row.raw.fullBuildMs,
          `${row.fixture} full build ${row.raw.fullBuildMs.toFixed(2)}ms — budget ${budget.fullBuild}ms`,
        ).toBeLessThanOrEqual(budget.fullBuild)
        expect(
          row.raw.identityHitMs,
          `${row.fixture} identity hit ${row.raw.identityHitMs.toFixed(5)}ms/call — budget ${budget.identityHitPerCall}ms`,
        ).toBeLessThanOrEqual(budget.identityHitPerCall)
        expect(
          row.raw.cardsOnlyRebuildMs,
          `${row.fixture} cards-only rebuild ${row.raw.cardsOnlyRebuildMs.toFixed(2)}ms — budget ${budget.cardsOnlyRebuild}ms`,
        ).toBeLessThanOrEqual(budget.cardsOnlyRebuild)
        expect(
          row.raw.indexedLookupsMs,
          `${row.fixture} 10k indexed lookups ${row.raw.indexedLookupsMs.toFixed(2)}ms — budget ${budget.indexedLookups}ms`,
        ).toBeLessThanOrEqual(budget.indexedLookups)
      }
    },
    120_000,
  )

  it('builds a large-board index without the cache for cold-path callers', () => {
    const board = createPerfBoard('large')
    const start = performance.now()
    const index = createGraphIndex(board)
    const coldBuildMs = performance.now() - start

    expect(index.cardById(board.cards[0].id)).toBe(board.cards[0])
    console.log(`\nCold large-board index build: ${coldBuildMs.toFixed(2)}ms`)
    // Cold path: load/import callers, off the interaction path — generous cap.
    expect(coldBuildMs, `cold large build ${coldBuildMs.toFixed(2)}ms — budget 25ms`).toBeLessThanOrEqual(25)
  })
})
