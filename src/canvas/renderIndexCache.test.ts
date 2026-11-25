import { describe, expect, it } from 'vitest'
import {
  cardRankHashesForTests,
  createBoardRenderIndex,
  createBoardRenderIndexCache,
  type BoardViewport,
  type BoardViewportSize,
} from './renderPlanning'
import type { Card, Connection } from '../graph/types'

function card(id: string, x: number, y: number, extra: Partial<Card> = {}): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-b`, text: `note ${id}` }],
    position: { x, y },
    ...extra,
  }
}

function conn(id: string, from: string, to: string): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  }
}

// A deterministic spread of cards across many grid cells (grid size is 900).
function makeCards(count: number): Card[] {
  const cards: Card[] = []
  for (let i = 0; i < count; i += 1) {
    cards.push(card(`card-${i}`, (i % 25) * 400, Math.floor(i / 25) * 350))
  }
  return cards
}

const VIEWPORTS: { viewport: BoardViewport; size: BoardViewportSize }[] = [
  { viewport: { x: 0, y: 0, zoom: 1 }, size: { width: 1280, height: 800 } },
  { viewport: { x: -2000, y: -1200, zoom: 0.5 }, size: { width: 1280, height: 800 } },
  { viewport: { x: 400, y: 300, zoom: 2 }, size: { width: 800, height: 600 } },
  { viewport: { x: -9000, y: -9000, zoom: 0.1 }, size: { width: 1600, height: 1000 } },
]

// The Tier 2 correctness contract: applying N changes through the cache must
// answer every query exactly like an index rebuilt from scratch.
function expectEquivalent(cached: ReturnType<typeof createBoardRenderIndex>, cards: Card[], connections: Connection[]) {
  const fresh = createBoardRenderIndex(cards, connections)
  for (const { viewport, size } of VIEWPORTS) {
    const cachedResult = cached.query(viewport, size)
    const freshResult = fresh.query(viewport, size)
    expect(cachedResult.cards.map((c) => c.id)).toEqual(freshResult.cards.map((c) => c.id))
    expect(cachedResult.connections.map((c) => c.id)).toEqual(freshResult.connections.map((c) => c.id))
    // Same objects, not just same ids: queries must return current references.
    expect(cachedResult.cards).toEqual(freshResult.cards)
  }
  for (const [order, c] of cards.entries()) {
    expect(cached.cardById(c.id)).toBe(c)
    expect(cached.cardOrder(c.id)).toBe(order)
  }
  expect(cached.cardOrder('missing-card')).toBeUndefined()
}

describe('createBoardRenderIndexCache', () => {
  it('returns the same index for identical arrays and a fresh one after changes', () => {
    const cache = createBoardRenderIndexCache()
    const cards = makeCards(50)
    const connections = [conn('c1', 'card-0', 'card-1')]

    const first = cache.get(cards, connections)
    expect(cache.get(cards, connections)).toBe(first)

    const moved = cards.map((c) => (c.id === 'card-3' ? { ...c, position: { x: 5000, y: 5000 } } : c))
    const second = cache.get(moved, connections)
    expect(second).not.toBe(first)
    expect(cache.stats().identityHits).toBe(1)
  })

  it('applies a long drag sequence incrementally and stays equivalent to a rebuild', () => {
    const cache = createBoardRenderIndexCache()
    let cards = makeCards(200)
    const connections = [conn('c1', 'card-0', 'card-1'), conn('c2', 'card-10', 'card-190')]
    cache.get(cards, connections)

    // Drag card-7 across the board in 40 steps, far enough to cross grid cells.
    for (let step = 1; step <= 40; step += 1) {
      cards = cards.map((c) =>
        c.id === 'card-7' ? { ...c, position: { x: step * 260, y: step * 190 } } : c,
      )
      const index = cache.get(cards, connections)
      expectEquivalent(index, cards, connections)
    }

    const stats = cache.stats()
    expect(stats.fullRebuilds).toEqual({ initial: 1, cardStructure: 0, connections: 0 })
    expect(stats.incrementalUpdates).toBe(40)
    expect(stats.boundsUpdated).toBe(40)
  })

  it('patches multi-card moves in one pass', () => {
    const cache = createBoardRenderIndexCache()
    const connections: Connection[] = []
    let cards = makeCards(120)
    cache.get(cards, connections)

    const dragged = new Set(['card-2', 'card-40', 'card-77'])
    cards = cards.map((c) =>
      dragged.has(c.id) ? { ...c, position: { x: c.position.x + 3000, y: c.position.y + 3000 } } : c,
    )
    const index = cache.get(cards, connections)

    expectEquivalent(index, cards, connections)
    expect(cache.stats().cardsPatched).toBe(3)
    expect(cache.stats().fullRebuilds.cardStructure).toBe(0)
  })

  it('refreshes references without touching the grid for spatially irrelevant edits', () => {
    const cache = createBoardRenderIndexCache()
    const connections: Connection[] = []
    let cards = makeCards(30)
    cache.get(cards, connections)

    // Text and group membership change; position/size/kind do not.
    cards = cards.map((c) =>
      c.id === 'card-5' ? { ...c, blocks: [{ id: 'nb', text: 'rewritten' }], groupId: 'group-9' } : c,
    )
    const index = cache.get(cards, connections)

    expect(index.cardById('card-5')).toBe(cards.find((c) => c.id === 'card-5'))
    const stats = cache.stats()
    expect(stats.cardsPatched).toBe(1)
    expect(stats.boundsUpdated).toBe(0)
    expectEquivalent(index, cards, connections)
  })

  it('falls back to a counted full rebuild on adds, removes, reorders, and connection changes', () => {
    const cache = createBoardRenderIndexCache()
    let cards = makeCards(20)
    let connections: Connection[] = []
    cache.get(cards, connections)

    cards = [...cards, card('card-new', 9999, 9999)]
    expectEquivalent(cache.get(cards, connections), cards, connections)

    cards = cards.slice(0, -1)
    expectEquivalent(cache.get(cards, connections), cards, connections)

    cards = [...cards.slice(1), cards[0]]
    expectEquivalent(cache.get(cards, connections), cards, connections)

    connections = [conn('c1', 'card-1', 'card-2')]
    expectEquivalent(cache.get(cards, connections), cards, connections)

    const stats = cache.stats()
    expect(stats.fullRebuilds.cardStructure).toBe(3)
    expect(stats.fullRebuilds.connections).toBe(1)
    expect(stats.incrementalUpdates).toBe(0)
  })

  it('handles resize and kind-affecting size defaults through the field guard', () => {
    const cache = createBoardRenderIndexCache()
    const connections: Connection[] = []
    let cards = makeCards(15)
    cache.get(cards, connections)

    cards = cards.map((c) =>
      c.id === 'card-1' ? { ...c, size: { width: 1200, height: 900 } } : c,
    )
    const index = cache.get(cards, connections)

    expectEquivalent(index, cards, connections)
    expect(cache.stats().boundsUpdated).toBe(1)
  })
})

// Rank epoch (#311, amendment 16): the label layer keys its sort cache on
// this, so a drag frame must never move it, and every rank-relevant change
// (membership, size, kind) must.
describe('rankEpoch', () => {
  it('is stable across identity hits and position-only incremental updates — even though the index object is fresh', () => {
    const cache = createBoardRenderIndexCache()
    const cards = makeCards(30)
    const connections: Connection[] = []
    const first = cache.get(cards, connections)
    const epoch = first.rankEpoch()

    expect(cache.get(cards, connections).rankEpoch()).toBe(epoch) // identity hit

    // Ten drag frames: position-only patches, epoch untouched throughout.
    let dragged = cards
    for (let frame = 1; frame <= 10; frame += 1) {
      dragged = dragged.map((c) => (c.id === 'card-7' ? { ...c, position: { x: c.position.x + 12, y: c.position.y + 8 } } : c))
      const index = cache.get(dragged, connections)
      expect(index).not.toBe(first) // content commit → fresh index object
      expect(index.rankEpoch()).toBe(epoch) // rank untouched by positions
    }
  })

  it('is stable across content-only reference swaps (text edits) — bounds and rank inputs unchanged', () => {
    const cache = createBoardRenderIndexCache()
    const cards = makeCards(10)
    const connections: Connection[] = []
    const epoch = cache.get(cards, connections).rankEpoch()

    const edited = cards.map((c) =>
      c.id === 'card-2' ? { ...c, blocks: [{ id: 'card-2-b', text: 'rewritten body' }] } : c,
    )
    expect(cache.get(edited, connections).rankEpoch()).toBe(epoch)
  })

  it('moves on a resize and on a kind change — the rank-relevant card fields', () => {
    const cache = createBoardRenderIndexCache()
    const cards = makeCards(10)
    const connections: Connection[] = []
    const epoch = cache.get(cards, connections).rankEpoch()

    const resized = cards.map((c) => (c.id === 'card-4' ? { ...c, size: { width: 900, height: 400 } } : c))
    const afterResize = cache.get(resized, connections).rankEpoch()
    expect(afterResize).not.toBe(epoch)

    const rekinded = resized.map((c) => (c.id === 'card-5' ? { ...c, kind: 'group' as Card['kind'] } : c))
    expect(cache.get(rekinded, connections).rankEpoch()).not.toBe(afterResize)
  })

  it('moves on membership changes (the full-rebuild path)', () => {
    const cache = createBoardRenderIndexCache()
    const cards = makeCards(10)
    const connections: Connection[] = []
    const epoch = cache.get(cards, connections).rankEpoch()

    const added = [...cards, card('card-extra', 9000, 9000)]
    const afterAdd = cache.get(added, connections).rankEpoch()
    expect(afterAdd).not.toBe(epoch)

    expect(cache.get(cards, connections).rankEpoch()).not.toBe(afterAdd) // removal rebuilds too
  })

  it('is stable across a same-card REORDER — a full rebuild with an unchanged rank fingerprint keeps the epoch', () => {
    const cache = createBoardRenderIndexCache()
    const cards = makeCards(12)
    const connections: Connection[] = []
    const epoch = cache.get(cards, connections).rankEpoch()

    const reordered = [...cards].reverse() // same cards, new order → cardStructure rebuild
    const index = cache.get(reordered, connections)
    expect(cache.stats().fullRebuilds.cardStructure).toBe(1) // it DID take the rebuild path...
    expect(index.rankEpoch()).toBe(epoch) // ...but nothing rank-relevant changed

    // Reorder AND resize together: the fingerprint moves, so the epoch must.
    const resizedToo = [...cards].reverse().map((c) => (c.id === 'card-3' ? { ...c, size: { width: 500, height: 300 } } : c))
    expect(cache.get(resizedToo, connections).rankEpoch()).not.toBe(epoch)
  })

  it('is stable across a connections-only change — the rebuild fingerprint sees no rank input move', () => {
    const cache = createBoardRenderIndexCache()
    const cards = makeCards(10)
    const epoch = cache.get(cards, [conn('c1', 'card-0', 'card-1')]).rankEpoch()

    const index = cache.get(cards, [conn('c1', 'card-0', 'card-1'), conn('c2', 'card-2', 'card-3')])
    expect(cache.stats().fullRebuilds.connections).toBe(1)
    expect(index.rankEpoch()).toBe(epoch)
  })

  it('REGRESSION (round 6): a single-hash collision pair cannot freeze the epoch — the components are independent', () => {
    // These two rank inputs collide under component 1 (FNV-1a at the
    // standard basis: both hash to 2706802789). With sum AND xor aggregating
    // that same hash, a reorder+resize commit between them preserved the
    // fingerprint and served stale area ranks. The second component is an
    // independent function, so the pair must now separate.
    const specA = card('card', 0, 0, { size: { width: 625728, height: 696731 } })
    const specB = card('card', 0, 0, { size: { width: 500628, height: 644511 } })
    const [h1A] = cardRankHashesForTests(specA)
    const [h1B] = cardRankHashesForTests(specB)
    expect(h1A).toBe(h1B) // the collision is REAL under component 1 — this pin is load-bearing
    const [, h2A] = cardRankHashesForTests(specA)
    const [, h2B] = cardRankHashesForTests(specB)
    expect(h2A).not.toBe(h2B) // ...and component 2 separates it

    // End to end: reorder + the colliding resize in ONE commit takes the
    // full-rebuild path, and the epoch MUST move.
    const cache = createBoardRenderIndexCache()
    const others = [card('other-1', 900, 0), card('other-2', 1800, 0)]
    const connections: Connection[] = []
    const epoch = cache.get([specA, ...others], connections).rankEpoch()

    const reorderedAndResized = [...others, specB] // same ids, new order, colliding resize
    const index = cache.get(reorderedAndResized, connections)
    expect(cache.stats().fullRebuilds.cardStructure).toBe(1)
    expect(index.rankEpoch()).not.toBe(epoch)
  })

  it('REGRESSION (round 7): absent size and explicit {-1,-1} are distinct rank inputs — no serialization alias', () => {
    // setCardSize accepts unclamped numbers, so explicit {-1,-1} is a real
    // (degenerate) size; the old `?? -1` default serialized it identically
    // to 'no size at all'.
    const absent = card('alias-card', 0, 0)
    const explicitNegative = card('alias-card', 0, 0, { size: { width: -1, height: -1 } })
    const [h1Absent, h2Absent] = cardRankHashesForTests(absent)
    const [h1Explicit, h2Explicit] = cardRankHashesForTests(explicitNegative)
    expect(h1Absent).not.toBe(h1Explicit)
    expect(h2Absent).not.toBe(h2Explicit)

    // End to end (the probe): reorder + resize-to-explicit-{-1,-1} in one
    // commit takes the full-rebuild path, and the epoch MUST move.
    const cache = createBoardRenderIndexCache()
    const others = [card('other-1', 900, 0), card('other-2', 1800, 0)]
    const connections: Connection[] = []
    const epoch = cache.get([absent, ...others], connections).rankEpoch()

    const index = cache.get([...others, explicitNegative], connections)
    expect(cache.stats().fullRebuilds.cardStructure).toBe(1)
    expect(index.rankEpoch()).not.toBe(epoch)
  })

  it('the two fingerprint components are genuinely different functions — a sample card hashes differently under each', () => {
    const [h1, h2] = cardRankHashesForTests(card('sample-card', 0, 0, { size: { width: 260, height: 180 } }))
    expect(h1).not.toBe(h2)
  })

  it('never repeats across separately built indexes — globally monotonic, no cross-version aliasing', () => {
    const cards = makeCards(5)
    const a = createBoardRenderIndex(cards, [])
    const b = createBoardRenderIndex(cards, [])
    expect(b.rankEpoch()).not.toBe(a.rankEpoch())
  })
})
