import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  contentAwareMinZoom,
  createBoardRenderIndex,
  limitCardsForDetail,
  limitCardsForOverview,
  ZOOM_FLOOR_FIT_FRACTION,
  ZOOM_FLOOR_MAX,
  ZOOM_FLOOR_MIN,
} from './renderPlanning'
import type { Card, Connection } from '../graph/types'

function card(id: string, x: number, y: number, size?: Card['size']): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: id }],
    position: { x, y },
    size,
  }
}

describe('Board render planning', () => {
  it('returns cards intersecting the viewport plus margin', () => {
    const near = card('near', 100, 100)
    const edge = card('edge', 760, 100)
    const far = card('far', 4000, 100)
    const index = createBoardRenderIndex([near, edge, far], [])

    const result = index.query({ x: 0, y: 0, zoom: 1 }, { width: 500, height: 400 }, 300)

    expect(result.cards.map((candidate) => candidate.id)).toEqual(['near', 'edge'])
  })

  it('uses card size when testing visibility', () => {
    const large = card('large', 900, 0, { width: 600, height: 200 })
    const index = createBoardRenderIndex([large], [])

    const result = index.query({ x: 0, y: 0, zoom: 1 }, { width: 500, height: 400 }, 0)

    expect(result.cards.map((candidate) => candidate.id)).toEqual([])
    expect(index.query({ x: -500, y: 0, zoom: 1 }, { width: 500, height: 400 }, 0).cards[0]?.id).toBe('large')
  })

  it('returns overview connections touching visible cards while keeping React edge planning enclosed', () => {
    const a = card('a', 0, 0)
    const b = card('b', 220, 0)
    const c = card('c', 4000, 0)
    const connections: Connection[] = [
      connection('ab', 'a', 'b'),
      connection('ac', 'a', 'c'),
    ]
    const index = createBoardRenderIndex([a, b, c], connections)

    const result = index.query({ x: 0, y: 0, zoom: 1 }, { width: 500, height: 400 }, 0)

    expect(result.cards.map((candidate) => candidate.id)).toEqual(['a', 'b'])
    expect(result.connections.map((candidate) => candidate.id)).toEqual(['ab', 'ac'])
    expect(index.connectionsForCards(result.cards).map((candidate) => candidate.id)).toEqual(['ab'])
  })

  it('caps overview connection planning before returning the render window', () => {
    const a = card('a', 0, 0)
    const b = card('b', 220, 0)
    const c = card('c', 4000, 0)
    const connections: Connection[] = [
      connection('ab', 'a', 'b'),
      connection('ac', 'a', 'c'),
    ]
    const index = createBoardRenderIndex([a, b, c], connections)

    const result = index.query({ x: 0, y: 0, zoom: 1 }, { width: 500, height: 400 }, 0, {
      maxConnections: 1,
    })

    expect(result.connections).toHaveLength(1)
    // The cap is a COUNTED omission (#309): the true untruncated candidate
    // count still reports both window-touching connections.
    expect(result.connectionCandidateCount).toBe(2)
  })

  it('prepares a bounded hover prefix outside the pointer frame while preserving cold diagnostics', () => {
    const cards = [
      card('a', 0, 0),
      card('b', 220, 0),
      card('c', 440, 0),
      card('d', 660, 0),
      card('e', 880, 0),
      card('f', 1100, 0),
    ]
    const connections: Connection[] = [
      connection('ab', 'a', 'b'),
      connection('ac', 'a', 'c'),
      connection('cd', 'c', 'd'),
      connection('de', 'd', 'e'),
      connection('ef', 'e', 'f'),
    ]
    const viewport = { x: 0, y: 0, zoom: 1 }
    const viewportSize = { width: 1400, height: 400 }
    const coldIndex = createBoardRenderIndex(cards, connections)
    const hotIndex = createBoardRenderIndex(cards, connections)

    const cold = coldIndex.query(viewport, viewportSize, 0, { maxConnections: 3 })
    const hot = hotIndex.queryConnectionsBounded(viewport, viewportSize, 0, 3)

    expect(hot.map((candidate) => candidate.id)).toEqual(
      cold.connections.map((candidate) => candidate.id),
    )
    const hotStats = hotIndex.connectionPlanStats()
    expect(hotStats.adjacencyConnectionCandidatesVisited).toBe(5)
    expect(hotStats.spatialCardCandidatesVisited).toBeGreaterThan(0)
    expect(cold.connectionCandidateCount).toBe(5)
    expect(coldIndex.connectionPlanStats().adjacencyConnectionCandidatesVisited).toBe(10)

    const boardSource = readFileSync(
      fileURLToPath(new URL('./Board.tsx', import.meta.url)),
      'utf8',
    )
    const hoverFrame = boardSource
      .split('// Painted-band whole-wire hover.')[1]
      ?.split('// A non-empty exclusion set')[0] ?? ''
    expect(boardSource).toMatch(/const connectionHoverCandidates = useMemo\(/)
    expect(hoverFrame).not.toContain('renderIndex.query')
    expect(hoverFrame).not.toContain('hitTestSceneCardAtClientPoint')
    expect(hoverFrame).toContain('latest.connectionCandidates')
  })

  it('reports the candidate count equal to the returned set when nothing is truncated', () => {
    const a = card('a', 0, 0)
    const b = card('b', 220, 0)
    const connections: Connection[] = [connection('ab', 'a', 'b')]
    const index = createBoardRenderIndex([a, b], connections)

    const result = index.query({ x: 0, y: 0, zoom: 1 }, { width: 500, height: 400 }, 0, {
      maxConnections: 1,
    })

    // Exactly-at-cap is not an omission: candidates == returned length, and
    // duplicate adjacency visits (both endpoints visible) do not double-count.
    expect(result.connections.map((candidate) => candidate.id)).toEqual(['ab'])
    expect(result.connectionCandidateCount).toBe(1)
  })

  it('can skip connection planning for overview-only queries', () => {
    const a = card('a', 0, 0)
    const b = card('b', 220, 0)
    const connections: Connection[] = [connection('ab', 'a', 'b')]
    const index = createBoardRenderIndex([a, b], connections)

    const result = index.query({ x: 0, y: 0, zoom: 1 }, { width: 500, height: 400 }, 0, {
      includeConnections: false,
    })

    expect(result.cards.map((candidate) => candidate.id)).toEqual(['a', 'b'])
    expect(result.connections).toEqual([])
    expect(index.connectionsForCards(result.cards).map((candidate) => candidate.id)).toEqual(['ab'])
  })

  it('plans dense React edges from visible-card adjacency instead of scanning every connection', () => {
    const visibleCards = [card('a', 0, 0), card('b', 280, 0), card('c', 560, 0)]
    const farCards = Array.from({ length: 240 }, (_, index) =>
      card(`far-${index}`, 10_000 + (index % 40) * 280, Math.floor(index / 40) * 220),
    )
    const localConnections = [
      connection('ab', 'a', 'b'),
      connection('bc', 'b', 'c'),
    ]
    const farConnections = Array.from({ length: 4_000 }, (_, index) =>
      connection(`far-${index}`, `far-${index % farCards.length}`, `far-${(index + 17) % farCards.length}`),
    )
    const index = createBoardRenderIndex([...visibleCards, ...farCards], [...localConnections, ...farConnections])

    const result = index.query({ x: 0, y: 0, zoom: 1 }, { width: 900, height: 400 }, 0, {
      includeConnections: false,
    })
    const plannedConnections = index.connectionsForCards(result.cards)
    const stats = index.connectionPlanStats()

    expect(result.cards.map((candidate) => candidate.id)).toEqual(['a', 'b', 'c'])
    expect(plannedConnections.map((candidate) => candidate.id)).toEqual(['ab', 'bc'])
    expect(stats.totalConnections).toBeGreaterThan(4_000)
    expect(stats.adjacencyBucketsRead).toBe(result.cards.length)
    expect(stats.adjacencyConnectionCandidatesVisited).toBe(4)
  })

  it('caps overview cards with a spatial sample near the viewport', () => {
    const cards = Array.from({ length: 100 }, (_, index) => card(`card-${index}`, (index % 20) * 260, Math.floor(index / 20) * 220))

    const result = limitCardsForOverview({
      cards,
      viewport: { x: 0, y: 0, zoom: 0.1 },
      viewportSize: { width: 500, height: 400 },
      maxCards: 12,
    })

    expect(result).toHaveLength(12)
    expect(result.some((candidate) => ['card-88', 'card-89', 'card-90'].includes(candidate.id))).toBe(true)
    expect(result.some((candidate) => candidate.id === 'card-99')).toBe(false)
  })

  it('preserves selected overview cards even when the overview budget is full', () => {
    const cards = Array.from({ length: 100 }, (_, index) => card(`card-${index}`, (index % 20) * 260, Math.floor(index / 20) * 220))

    const result = limitCardsForOverview({
      cards,
      viewport: { x: 0, y: 0, zoom: 0.1 },
      viewportSize: { width: 500, height: 400 },
      maxCards: 12,
      preserveCardIds: new Set(['card-99']),
    })

    expect(result).toHaveLength(12)
    expect(result.some((candidate) => candidate.id === 'card-99')).toBe(true)
  })

  it('selects detail cards near the viewport center within a card budget', () => {
    const cards = Array.from({ length: 30 }, (_, index) => card(`card-${index}`, index * 280, 0))

    const result = limitCardsForDetail({
      cards,
      viewport: { x: -2800, y: 0, zoom: 1 },
      viewportSize: { width: 560, height: 400 },
      maxCards: 4,
      maxWeight: 100,
    })

    expect(result).toHaveLength(4)
    expect(result.some((candidate) => candidate.id === 'card-10')).toBe(true)
    expect(result.some((candidate) => candidate.id === 'card-29')).toBe(false)
  })

  it('keeps preserved detail cards even when they exceed the normal weight budget', () => {
    const cards = Array.from({ length: 12 }, (_, index) => card(`card-${index}`, index * 280, 0))

    const result = limitCardsForDetail({
      cards,
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 560, height: 400 },
      maxCards: 4,
      maxWeight: 3,
      preserveCardIds: new Set(['card-11']),
      cardWeight: (candidate) => candidate.id === 'card-11' ? 10 : 1,
    })

    expect(result.some((candidate) => candidate.id === 'card-11')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(4)
  })

  it('derives the zoom floor from board size so zoom-out stops near a fitted board', () => {
    const viewportSize = { width: 1200, height: 800 }
    // Board spans 0..2660 x 0..1780 world units (default note size 260x180).
    const cards = Array.from({ length: 9 }, (_, index) =>
      card(`card-${index}`, (index % 3) * 1200, Math.floor(index / 3) * 800),
    )

    const floor = contentAwareMinZoom(cards, viewportSize)

    const fitZoom = Math.min(1200 / 2660, 800 / 1780)
    expect(floor).toBeCloseTo(fitZoom * ZOOM_FLOOR_FIT_FRACTION, 5)
    expect(floor).toBeGreaterThan(ZOOM_FLOOR_MIN)
    expect(floor).toBeLessThan(ZOOM_FLOOR_MAX)
  })

  it('clamps the zoom floor for tiny, gigantic, and empty boards', () => {
    const viewportSize = { width: 1200, height: 800 }

    expect(contentAwareMinZoom([], viewportSize)).toBe(ZOOM_FLOOR_MAX)
    expect(contentAwareMinZoom([card('only', 0, 0)], viewportSize)).toBe(ZOOM_FLOOR_MAX)
    const gigantic = [card('a', 0, 0), card('b', 200_000, 150_000)]
    expect(contentAwareMinZoom(gigantic, viewportSize)).toBe(ZOOM_FLOOR_MIN)
  })
})

function connection(id: string, from: string, to: string): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  }
}
