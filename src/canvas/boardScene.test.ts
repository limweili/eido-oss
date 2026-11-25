import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { BoardChangeEmission } from '../graph/boardChange'
import type { Card, Connection, Output } from '../graph/types'
import { createSeedMod } from '../mods'
import {
  CANVAS_CARD_LAYER_CEILING,
  CANVAS_CARD_LAYER_MAX,
  REACT_FLOW_SELECTED_NODE_LIFT,
} from '../ui/tokens'
import { PASSIVE_CARD_TEXT_WEIGHT_LIMIT } from './cardResidency'
import { createBoardRenderIndex } from './renderPlanning'
import {
  apertureStateForScene,
  renderLayer,
  BAND_CROSSFADE_HALF_WIDTH,
  bandForScene,
  boardScenePerfCountersSnapshot,
  connectionHitTolerancePx,
  connectionLimitForZoom,
  createBoardScene,
  createPointerNavigationTracker,
  deriveBoardCardMetrics,
  FULL_DETAIL_CARD_LIMIT,
  GESTURE_PARTICIPANT_LIMIT,
  hitTestSceneCardAtBoardPoint,
  hitTestPaintedConnectionsAtClientPoint,
  hitTestSceneConnectionAtClientPoint,
  isCardInteractionTarget,
  MAP_BAND_MAX_ZOOM,
  mountPlanForScene,
  overviewSuppressionForScene,
  planPaintedConnections,
  READING_BAND_MIN_ZOOM,
  resetBoardScenePerfCounters,
  summaryForCard,
  type BoardCardMetrics,
  type BoardScene,
  type CanvasDisplayPriority,
  type DetailBand,
  type SceneApertureState,
  type SceneBandOccupancy,
} from './boardScene'

// A board past the RETIRED massive-board threshold (1000 cards): board class
// must no longer change what mounts, and these fixtures prove it.
const OLD_MASSIVE_BOARD_CARD_COUNT = 1000
// The retired #209 low-zoom placeholder budget, kept as a fixture size so
// the zero-mount pins exercise a board that USED to mount placeholders.
const OLD_LOW_ZOOM_INTERACTIVE_CARD_LIMIT = 48

function note(id: string, x: number, y: number): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: id }],
    position: { x, y },
  }
}

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

// Past the removed FULL_DETAIL_CONNECTION_LIMIT density gate (320) — dense
// enough that the old routing flipped connections onto the canvas (#211).
const DENSE_CONNECTION_COUNT = 321

// Fresh graph metric projection for a board, the way Board.tsx derives it
// (cold start = full rebuild). Tests that exercise the incremental paths call
// deriveBoardCardMetrics directly with a change record and previous.
// The default outputs array is SHARED: the store keeps the outputs reference
// stable across commits that do not touch outputs (Immer structural
// sharing), and reference identity is what the projection keys on — a fresh
// `[]` per call would read as an unexplained outputs change.
const NO_OUTPUTS: readonly Output[] = []

function metricsFor(cards: readonly Card[], outputs: readonly Output[] = NO_OUTPUTS, options: {
  change?: BoardChangeEmission | null
  previous?: BoardCardMetrics | null
} = {}): BoardCardMetrics {
  const byId = new Map(cards.map((card) => [card.id, card]))
  return deriveBoardCardMetrics({
    cards,
    outputs,
    cardById: (id) => byId.get(id),
    change: options.change ?? null,
    previous: options.previous ?? null,
  })
}

function changeEmission(seq: number, change: BoardChangeEmission['change']): BoardChangeEmission {
  return { seq, source: 'commit', change }
}

function plan({
  cards,
  connections = [],
  outputs = [],
  cardMetrics,
  zoom = 0.5,
  x = 0,
  y = 0,
  settledX = x,
  settledY = y,
  shouldPlanConnections = true,
  previousScene = null,
  navigationActive = false,
  zoomNavigationActive = false,
  settledZoom = zoom,
  readOnly = false,
}: {
  cards: Card[]
  connections?: Connection[]
  outputs?: Output[]
  cardMetrics?: BoardCardMetrics
  zoom?: number
  x?: number
  y?: number
  settledX?: number
  settledY?: number
  shouldPlanConnections?: boolean
  previousScene?: BoardScene | null
  navigationActive?: boolean
  zoomNavigationActive?: boolean
  settledZoom?: number
  readOnly?: boolean
}) {
  const renderIndex = createBoardRenderIndex(cards, connections)
  const viewport = { x, y, zoom }
  const settledViewport = { x: settledX, y: settledY, zoom: settledZoom }
  return createBoardScene({
    cards,
    connections,
    cardMetrics: cardMetrics ?? metricsFor(cards, outputs),
    renderIndex,
    viewport,
    settledViewport,
    viewportSize: { width: 1200, height: 800 },
    readOnly,
    navigationActive,
    zoomNavigationActive,
    shouldPlanConnections,
    previousScene,
  })
}

// Everything observable about a scene, in value (not identity) form. Set
// contents are sorted (sets are unordered); array order is preserved because
// render order is behavior.
// Every card's displayPriority, grouped so the digest pins the full
// per-summary classification without repeating the priority per line.
function displayPrioritiesDigest(scene: BoardScene): Record<CanvasDisplayPriority, string[]> {
  const byPriority: Record<CanvasDisplayPriority, string[]> = {
    landmark: [],
    'user-authored': [],
    'system-generated': [],
  }
  for (const [id, summary] of scene.cardSummariesById) {
    byPriority[summary.displayPriority].push(id)
  }
  for (const ids of Object.values(byPriority)) ids.sort()
  return byPriority
}

function sceneDigest(scene: BoardScene) {
  return {
    band: scene.band,
    fullyDetailed: scene.fullyDetailed,
    cardDisplayPriorities: displayPrioritiesDigest(scene),
    boardDetailTextWeight: scene.boardDetailTextWeight,
    visibleCards: scene.visibleCards.map((card) => card.id),
    visibleCardIds: [...scene.visibleCardIds].sort(),
    visibleConnections: scene.visibleConnections.map((connection) => connection.id),
    detailCards: scene.detailCards.map((card) => card.id),
    detailCardIds: [...scene.detailCardIds].sort(),
    hitTestCandidates: scene.hitTestCandidates.map((card) => card.id),
    renderCanvasCards: scene.renderCanvasCards,
    useCanvasConnections: scene.useCanvasConnections,
    useOverviewLayer: scene.useOverviewLayer,
    showConnections: scene.showConnections,
    overviewSuppressedCardIds: [...scene.overviewSuppressedCardIds].sort(),
    overviewMarginPx: scene.overviewMarginPx,
    cardSummaryCount: scene.cardSummariesById.size,
  }
}

function denseCards(count = 120): Card[] {
  return Array.from({ length: count }, (_, index) =>
    note(`card-${index}`, (index % 12) * 260, Math.floor(index / 12) * 230),
  )
}

function textHeavyCards(count = 140, textLength = 4_000): Card[] {
  return Array.from({ length: count }, (_, index) => ({
    ...note(`card-${index}`, (index % 14) * 260, Math.floor(index / 14) * 190),
    blocks: [{ id: `card-${index}-block`, text: 'x'.repeat(textLength) }],
  }))
}

function massiveCards(): Card[] {
  return Array.from({ length: OLD_MASSIVE_BOARD_CARD_COUNT + 1 }, (_, index) =>
    note(`card-${index}`, (index % 60) * 280, Math.floor(index / 60) * 220),
  )
}

describe('createBoardScene', () => {
  it('uses spatial Reading visibility on a small production board', () => {
    const cards = [note('visible', 0, 0), note('far-away', 20_000, 20_000)]
    const renderIndex = createBoardRenderIndex(cards, [])

    const result = createBoardScene({
      cards,
      connections: [],
      cardMetrics: metricsFor(cards),
      renderIndex,
      viewport: { x: 0, y: 0, zoom: 1 },
      settledViewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1200, height: 800 },
      readOnly: false,
      navigationActive: false,
      zoomNavigationActive: false,
      shouldPlanConnections: true,
      previousScene: null,
    })

    expect(result.visibleCards.map((card) => card.id)).toEqual(['visible'])
  })

  it('keeps a bounded passive preload window distinct from exact viewport visibility', () => {
    const cards = [
      note('visible', 0, 0),
      note('preloaded', 1_500, 0),
      note('far-away', 20_000, 20_000),
    ]
    const renderIndex = createBoardRenderIndex(cards, [])

    const result = createBoardScene({
      cards,
      connections: [],
      cardMetrics: metricsFor(cards),
      renderIndex,
      viewport: { x: 0, y: 0, zoom: 1 },
      settledViewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 1200, height: 800 },
      readOnly: false,
      navigationActive: false,
      zoomNavigationActive: false,
      shouldPlanConnections: true,
      previousScene: null,
    })

    expect({
      visible: result.visibleCards.map((card) => card.id),
      passive: result.detailCards.map((card) => card.id),
    }).toEqual({ visible: ['visible'], passive: ['visible', 'preloaded'] })
  })

  it('preloads farther in the camera direction through the spatial index', () => {
    const cards = [note('visible', 600, 0), note('ahead', 2_700, 0), note('behind', -2_700, 0)]
    const first = plan({ cards, zoom: 1 })
    const movingRight = plan({
      cards,
      zoom: 1,
      x: -400,
      settledX: -800,
      previousScene: first,
      navigationActive: true,
    })

    expect(first.lookAheadCardIds).toEqual(new Set())
    expect(movingRight.lookAheadCardIds).toContain('ahead')
    expect(movingRight.lookAheadCardIds).not.toContain('behind')
    expect(movingRight.detailCards.map((card) => card.id)).toContain('ahead')
  })

  it('keeps the lightweight canvas safety layer exposed during Reading navigation', () => {
    const cards = Array.from({ length: FULL_DETAIL_CARD_LIMIT + 20 }, (_, index) =>
      note(`card-${index}`, index * 2_000, 0),
    )

    const moving = plan({
      cards,
      zoom: 1,
      x: -400,
      settledX: -800,
      navigationActive: true,
    })

    expect({
      renderCanvasCards: moving.renderCanvasCards,
      useOverviewLayer: moving.useOverviewLayer,
      suppressed: moving.overviewSuppressedCardIds.size,
    }).toEqual({ renderCanvasCards: true, useOverviewLayer: true, suppressed: 0 })
  })

  it('plans candidate DOM connections only between spatially resident endpoint Cards', () => {
    const cards = [note('visible', 0, 0), note('preloaded', 1_500, 0), note('far-away', 20_000, 0)]
    const connections = [
      connection('resident-edge', 'visible', 'preloaded'),
      connection('off-window-edge', 'visible', 'far-away'),
    ]

    const result = plan({ cards, connections, zoom: 1 })

    expect(result.visibleConnections.map((candidate) => candidate.id)).toEqual(['resident-edge'])
  })

  it('keeps massive mid-zoom boards canvas-first instead of mounting a DOM aperture', () => {
    const cards = Array.from({ length: OLD_MASSIVE_BOARD_CARD_COUNT + 1 }, (_, index) =>
      note(`card-${index}`, (index % 60) * 280, Math.floor(index / 60) * 220),
    )

    const result = plan({ cards, zoom: 0.25 })

    expect(result.visibleCards.length).toBeGreaterThan(0)
    expect(result.renderCanvasCards).toBe(true)
    expect(result.useOverviewLayer).toBe(true)
    expect(result.detailCards).toEqual([])
    expect(result.overviewSuppressedCardIds.size).toBe(0)
    // Every painted card is hit-testable (hit == paint, ADR 0020) — this is
    // how a below-Reading click selects a card now that selection promotion
    // is gone; the selection itself paints (Lane B) and is not a scene input.
    expect(result.hitTestCandidates.some((card) => card.id === 'card-0')).toBe(true)
  })

  it('reports actual P/S across below-Reading and Reading representations (ADR 0020)', () => {
    for (const cards of [denseCards(120), textHeavyCards(140), massiveCards()]) {
      for (const zoom of [0.25, 0.05]) {
        const belowReading = plan({ cards, zoom })
        expect(belowReading.detailCards).toEqual([])
        expect(belowReading.passiveCardIds).toEqual(new Set())
        expect(belowReading.safetyCardIds).toEqual(belowReading.visibleCardIds)
      }
    }

    const reading = plan({ cards: denseCards(120), zoom: 1 })
    expect(reading.band).toBe('reading')
    expect(reading.passiveCardIds).toBe(reading.detailCardIds)
    expect([...reading.visibleCardIds].every((cardId) => reading.passiveCardIds.has(cardId))).toBe(true)
    expect(reading.safetyCardIds).toEqual(
      new Set([...reading.visibleCardIds].filter((cardId) => !reading.passiveCardIds.has(cardId))),
    )
    expect(reading.detailCards.length).toBeLessThanOrEqual(FULL_DETAIL_CARD_LIMIT)
    expect(reading.detailCards.length).toBeLessThan(120)
  })

  it('keeps Reading weight overflow painted until an exempt Live owner takes over', () => {
    const ordinaryCards = Array.from({ length: 6 }, (_, index) => ({
      ...note(`ordinary-${index}`, (index % 3) * 320, Math.floor(index / 3) * 220),
      blocks: [{ id: `ordinary-${index}-block`, text: String(index).repeat(100_000) }],
    }))
    const ordinaryCardIds = ordinaryCards.map((card) => card.id)
    const cards = [
      ...ordinaryCards,
      { ...note('overflow', 640, 0), blocks: [{ id: 'overflow-block', text: 'c'.repeat(50_000) }] },
    ]
    const scene = plan({ cards, zoom: 1 })

    expect({
      band: scene.band,
      readingCardOpacity: scene.readingCardOpacity,
      passive: [...scene.passiveCardIds],
      safety: [...scene.safetyCardIds],
      weightDemoted: [...scene.weightDemotedCardIds],
      admittedWeight: scene.admittedDetailTextWeight,
      oversizePassive: [...scene.oversizePassiveCardIds],
      oversizeWeight: scene.oversizePassiveTextWeight,
      budget: scene.detailTextWeightBudget,
      paintedHits: scene.hitTestCandidates.map((card) => card.id),
      suppressed: [...scene.overviewSuppressedCardIds],
    }).toEqual({
      band: 'reading',
      readingCardOpacity: 1,
      passive: ordinaryCardIds,
      safety: ['overflow'],
      weightDemoted: ['overflow'],
      admittedWeight: 600_000,
      oversizePassive: [],
      oversizeWeight: 0,
      budget: 600_000,
      paintedHits: ['overflow'],
      suppressed: ordinaryCardIds,
    })

    const live = mountPlanForScene({
      scene,
      gestureParticipantIds: new Set<string>(),
      liveOwnerIds: new Set(['overflow']),
      cardById: (cardId) => cards.find((card) => card.id === cardId),
    })

    expect({
      mounted: live.mountedCards.map((card) => card.id),
      paintOccluding: [...live.paintOccludingCardIds],
      suppressed: [...live.overviewSuppressedCardIds],
    }).toEqual({
      mounted: [...ordinaryCardIds, 'overflow'],
      paintOccluding: [...ordinaryCardIds, 'overflow'],
      suppressed: [...ordinaryCardIds, 'overflow'],
    })

    const oversizeCards = Array.from({ length: 31 }, (_, index) => ({
      ...note(`oversize-${index}`, 0, 0),
      blocks: [{
        id: `oversize-${index}-block`,
        text: 'x'.repeat(100_001 + index),
      }],
    }))
    const afterOversizeCard = {
      ...note('after-oversize', 0, 0),
      blocks: [{ id: 'after-oversize-block', text: 'small content' }],
    }
    const oversizeFixture = [...oversizeCards, afterOversizeCard]
    const oversizeScene = plan({ cards: oversizeFixture, zoom: 1 })
    const oversizeLive = mountPlanForScene({
      scene: oversizeScene,
      gestureParticipantIds: new Set<string>(),
      liveOwnerIds: new Set(['oversize-10']),
      cardById: (cardId) => oversizeFixture.find((card) => card.id === cardId),
    })
    const admittedOversizeIds = oversizeCards.slice(0, 10).map((card) => card.id)
    const expectedPassiveIds = [...admittedOversizeIds, afterOversizeCard.id]
    const expectedMountedIds = [...expectedPassiveIds, 'oversize-10']

    expect({
      passive: [...oversizeScene.passiveCardIds],
      oversizePassive: [...oversizeScene.oversizePassiveCardIds],
      admittedWeight: oversizeScene.admittedDetailTextWeight,
      oversizeWeight: oversizeScene.oversizePassiveTextWeight,
      paintedHits: oversizeScene.hitTestCandidates.map((card) => card.id),
      mounted: oversizeLive.mountedCards.map((card) => card.id),
      paintOccluding: [...oversizeLive.paintOccludingCardIds],
      suppressed: [...oversizeLive.overviewSuppressedCardIds],
    }).toEqual({
      passive: expectedPassiveIds,
      oversizePassive: admittedOversizeIds,
      admittedWeight: 'small content'.length,
      oversizeWeight: oversizeCards
        .slice(0, 10)
        .reduce((sum, _card, index) => sum + 100_001 + index, 0),
      paintedHits: ['oversize-10', ...oversizeCards.slice(11).map((card) => card.id)],
      mounted: expectedMountedIds,
      paintOccluding: expectedMountedIds,
      suppressed: expectedMountedIds,
    })
  })

  it('keeps full cards mounted and editable while their Reading bodies crossfade into Overview', () => {
    const cards = denseCards(12)
    const atOverviewEndpoint = plan({ cards, zoom: 0.27625 })
    const crossing = plan({ cards, zoom: 0.3 })
    const atReadingEndpoint = plan({ cards, zoom: 0.37375 })

    expect(atOverviewEndpoint.readingCardOpacity).toBe(0)
    expect(atOverviewEndpoint.detailCards).toEqual([])

    expect(crossing.band).toBe('overview')
    expect(crossing.readingCardOpacity).toBeGreaterThan(0)
    expect(crossing.readingCardOpacity).toBeLessThan(1)
    expect([...crossing.visibleCardIds].every((cardId) => crossing.detailCardIds.has(cardId))).toBe(true)
    expect(crossing.overviewSuppressedCardIds.size).toBe(0)
    expect(crossing.renderCanvasCards).toBe(true)

    expect(atReadingEndpoint.readingCardOpacity).toBe(1)
    expect([...atReadingEndpoint.visibleCardIds].every((cardId) => atReadingEndpoint.detailCardIds.has(cardId))).toBe(true)
  })

  it('does not mount a Reading crossfade layer when occupancy forces Overview', () => {
    const cards = Array.from({ length: FULL_DETAIL_CARD_LIMIT + 60 }, (_, index) =>
      note(`card-${index}`, (index % 30) * 90, Math.floor(index / 30) * 70),
    )
    const result = plan({ cards, zoom: 0.3 })

    expect(result.band).toBe('overview')
    expect(result.readingCardOpacity).toBe(0)
    expect(result.detailCards).toEqual([])
    expect(result.passiveCardIds).toEqual(new Set())
    expect(result.safetyCardIds).toEqual(result.visibleCardIds)
  })

  it('keeps dense connections as interactive DOM edges while every card is a mounted node (#211)', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const connections = Array.from({ length: DENSE_CONNECTION_COUNT }, (_, index) =>
      connection(`connection-${index}`, 'a', 'b'),
    )

    const result = plan({ cards, connections, zoom: 1 })

    expect(result.detailCards.map((card) => card.id)).toEqual(['a', 'b'])
    expect(result.renderCanvasCards).toBe(true)
    // Connection density alone must never route connections onto the
    // pointer-transparent canvas: that made every connector line unclickable.
    expect(result.useCanvasConnections).toBe(false)
    expect(result.showConnections).toBe(true)
    expect(result.visibleConnections).toHaveLength(DENSE_CONNECTION_COUNT)
    expect(result.overviewSuppressedCardIds).toEqual(new Set(['a', 'b']))
  })

  it('keeps canvas connections for overview scenes, where endpoint cards are not mounted', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const connections = [connection('connection-0', 'a', 'b')]

    const result = plan({ cards, connections, zoom: 0.25 })

    expect(result.band).toBe('overview')
    expect(result.renderCanvasCards).toBe(true)
    expect(result.useCanvasConnections).toBe(true)
    expect(result.showConnections).toBe(false)
  })

  it('keeps the overview underlay while the viewport moves and suppresses it once settled', () => {
    const cards = Array.from({ length: 120 }, (_, index) =>
      note(`card-${index}`, (index % 12) * 260, Math.floor(index / 12) * 230),
    )

    const panning = plan({ cards, zoom: 1, x: 180, settledX: 0 })
    const zooming = plan({ cards, zoom: 1, settledZoom: 0.6 })
    const settled = plan({ cards, zoom: 1 })
    // Input activity without viewport motion (e.g. clicking a card) must not
    // change suppression either.
    const clickingWhileStill = plan({ cards, zoom: 1, navigationActive: true })

    expect(panning.renderCanvasCards).toBe(true)
    // While the viewport moves, DOM transforms lag the live viewport — the
    // canvas underlay keeps viewport-edge cards represented (#150, #167).
    // Mounted cards draw with measured DOM sizes so the underlay coincides
    // with the real card instead of peeking out beneath it (#158).
    expect(panning.overviewSuppressedCardIds.size).toBe(0)
    expect(zooming.overviewSuppressedCardIds.size).toBe(0)
    // Full-detail scenes suppress mounted cards once settled so the canvas
    // cannot peek out under auto-height notes (issue #126).
    expect(settled.overviewSuppressedCardIds).toEqual(settled.detailCardIds)
    expect(settled.overviewSuppressedCardIds.size).toBeLessThanOrEqual(FULL_DETAIL_CARD_LIMIT)
    expect([...settled.visibleCardIds].every((cardId) => settled.overviewSuppressedCardIds.has(cardId))).toBe(true)
    expect(clickingWhileStill.overviewSuppressedCardIds).toEqual(clickingWhileStill.detailCardIds)
  })

  it('keeps text-heavy boards in Reading while excess weight stays painter-owned', () => {
    const cards = textHeavyCards(140, 8_000)

    const readingZoom = plan({ cards, zoom: 1 })
    const midZoom = plan({ cards, zoom: 0.5 })
    const farZoom = plan({ cards, zoom: 0.12 })

    expect(readingZoom.band).toBe('reading')
    expect([...readingZoom.visibleCardIds].every((cardId) => readingZoom.detailCardIds.has(cardId))).toBe(true)
    expect(midZoom.band).toBe('reading')
    expect(midZoom.admittedDetailTextWeight).toBeLessThanOrEqual(PASSIVE_CARD_TEXT_WEIGHT_LIMIT)
    expect(midZoom.safetyCardIds.size).toBeGreaterThan(0)
    expect(midZoom.hitTestCandidates.map((card) => card.id)).toEqual([...midZoom.safetyCardIds])
    expect(readingZoom.detailCards.length).toBeLessThan(cards.length)
    expect(midZoom.detailCards.length).toBeLessThanOrEqual(FULL_DETAIL_CARD_LIMIT)
    expect(farZoom.detailCards).toEqual([])
  })

  it('keeps far-zoom boards uniform on canvas with no selection promotion', () => {
    const denseFarCards = Array.from({ length: FULL_DETAIL_CARD_LIMIT + 60 }, (_, index) =>
      note(`card-${index}`, (index % 40) * 90, Math.floor(index / 40) * 70),
    )

    const textHeavyFar = plan({ cards: textHeavyCards(), zoom: 0.12 })
    const denseFar = plan({ cards: denseFarCards, zoom: 0.12 })

    expect(textHeavyFar.detailCards).toEqual([])
    expect(textHeavyFar.renderCanvasCards).toBe(true)
    expect(textHeavyFar.hitTestCandidates.some((card) => card.id === 'card-3')).toBe(true)
    expect(denseFar.detailCards).toEqual([])
    expect(denseFar.renderCanvasCards).toBe(true)
    expect(denseFar.hitTestCandidates.length).toBeGreaterThan(0)
  })

  it('keeps only the currently over-occupied viewport out of Reading', () => {
    const cards = Array.from({ length: FULL_DETAIL_CARD_LIMIT + 80 }, (_, index) =>
      note(`card-${index}`, (index % 30) * 20, Math.floor(index / 30) * 20),
    )
    const settled = plan({ cards, zoom: 1 })
    const moving = plan({ cards, zoom: 1, x: -1800, settledX: 0, settledY: 0, previousScene: settled })

    expect(settled.band).toBe('overview')
    expect(settled.detailCards).toEqual([])
    expect(settled.fullyDetailed).toBe(false)
    expect(moving.visibleCardIds.size).toBeLessThanOrEqual(FULL_DETAIL_CARD_LIMIT)
    expect([...moving.visibleCardIds].every((cardId) => moving.detailCardIds.has(cardId))).toBe(true)
  })

  it('reuses summary, weight, and planned-id identities when only card position changes', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const firstMetrics = metricsFor(cards)
    const first = plan({ cards, cardMetrics: firstMetrics, zoom: 1 })
    resetBoardScenePerfCounters()
    const movedCards = [
      { ...cards[0], position: { x: 24, y: 12 } },
      cards[1],
    ]

    const secondMetrics = metricsFor(movedCards, NO_OUTPUTS, {
      change: changeEmission(1, { cards: { updated: ['a'] }, cardAspects: ['position'] }),
      previous: firstMetrics,
    })
    const second = plan({ cards: movedCards, cardMetrics: secondMetrics, zoom: 1, previousScene: first })
    const counters = boardScenePerfCountersSnapshot()

    expect(secondMetrics).toBe(firstMetrics)
    expect(second.cardSummariesById).toBe(first.cardSummariesById)
    expect(second.detailCardIds).toBe(first.detailCardIds)
    expect(counters.summaryCardIds).toEqual([])
    expect(counters.weightCardIds).toEqual([])
    expect(counters.cardMetricDerivations).toBe(0)
    expect(counters.cardMetricVisits).toBe(0)
  })

  it('reuses visible identities when viewport movement keeps the same visible card set', () => {
    const cards = Array.from({ length: OLD_MASSIVE_BOARD_CARD_COUNT + 1 }, (_, index) =>
      note(`card-${index}`, (index % 60) * 280, Math.floor(index / 60) * 220),
    )
    const first = plan({ cards, zoom: 0.5 })
    const second = plan({ cards, zoom: 0.5, x: -12, previousScene: first })

    expect(second.visibleCards).toBe(first.visibleCards)
    expect(second.visibleCardIds).toBe(first.visibleCardIds)
  })

  it('keeps summaries stable while changing only output text weights', () => {
    const cards = [note('result', 0, 0)]
    const output: Output = {
      id: 'output',
      resultCardId: 'result',
      versions: [{
        id: 'v1',
        number: 1,
        text: 'short',
        createdAt: '2026-06-25T00:00:00.000Z',
        fromRunId: 'run-1',
      }],
    }
    const firstMetrics = metricsFor(cards, [output])
    const secondMetrics = metricsFor(
      cards,
      [{ ...output, versions: [{ ...output.versions[0], text: 'longer generated output' }] }],
      { change: changeEmission(1, { outputs: { updated: ['output'] } }), previous: firstMetrics },
    )

    expect(secondMetrics.cardSummariesById).toBe(firstMetrics.cardSummariesById)
    expect(secondMetrics.boardDetailTextWeight).toBeGreaterThan(firstMetrics.boardDetailTextWeight)
  })

  it('hit-tests canvas candidates by rendered layer order', () => {
    const back = { ...note('back', 0, 0), zIndex: 1 }
    const front = { ...note('front', 20, 20), zIndex: 4 }
    const result = hitTestSceneCardAtBoardPoint({
      candidates: [back, front],
      boardX: 48,
      boardY: 48,
    })

    expect(result?.id).toBe('front')
  })

  // #211: canvas-painted connections have no DOM edge, so onPaneClick asks the
  // scene which painted connection is under a click. Both the painter and the
  // hit test consume planPaintedConnections, so membership (zoom paint cap,
  // viewport line filter) and geometry (source right-center to target
  // left-center, cubic bezier with the clamped horizontal curve) stay in
  // lockstep by construction — a click can never select an unpainted line.
  describe('hitTestSceneConnectionAtClientPoint (#211)', () => {
    const source = note('a', 0, 0)
    const target = note('b', 600, 0)
    const cards = new Map([['a', source], ['b', target]])
    const cardById = (cardId: string) => cards.get(cardId)
    const link = connection('connection-a-b', 'a', 'b')
    const viewportSize = { width: 800, height: 600 }

    it('hits a connection at the midpoint of its painted line', () => {
      // Notes estimate 260x180: endpoints (260, 90) -> (600, 90), a flat line.
      const hit = hitTestSceneConnectionAtClientPoint({
        connections: [link],
        cardById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize,
        viewportRect: { left: 0, top: 0 },
        clientX: 430,
        clientY: 90,
      })

      expect(hit?.id).toBe('connection-a-b')
    })

    it('suppresses a connection already owned by a mounted DOM edge', () => {
      expect(planPaintedConnections({
        connections: [link],
        suppressedConnectionIds: new Set([link.id]),
        cardById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize,
      })).toEqual([])
    })

    it('hit-tests the same mutable captured endpoints the resize painter leaves live', () => {
      const painted = planPaintedConnections({
        connections: [link],
        cardById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize,
      })
      const captured = painted[0]
      captured.sourceX = 460
      captured.sourceY = 180
      captured.curve = Math.max(18, Math.min(140, Math.abs(captured.targetX - captured.sourceX) * 0.36))

      expect(
        hitTestPaintedConnectionsAtClientPoint({
          paintedConnections: painted,
          viewport: { x: 0, y: 0, zoom: 1 },
          viewportRect: { left: 0, top: 0 },
          clientX: 530,
          clientY: 135,
        })?.id,
      ).toBe(link.id)
      expect(
        hitTestPaintedConnectionsAtClientPoint({
          paintedConnections: painted,
          viewport: { x: 0, y: 0, zoom: 1 },
          viewportRect: { left: 0, top: 0 },
          clientX: 430,
          clientY: 90,
        }),
      ).toBeNull()
    })

    it('misses clicks outside the tolerance band', () => {
      const hit = hitTestSceneConnectionAtClientPoint({
        connections: [link],
        cardById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize,
        viewportRect: { left: 0, top: 0 },
        clientX: 430,
        clientY: 120,
      })

      expect(hit).toBeNull()
    })

    it('transforms through viewport pan, zoom, and the pane client rect', () => {
      // zoom 0.5, viewport (50, 40): endpoints (180, 85) -> (350, 85);
      // rect offset (10, 20) puts the screen midpoint at (275, 105).
      const hit = hitTestSceneConnectionAtClientPoint({
        connections: [link],
        cardById,
        viewport: { x: 50, y: 40, zoom: 0.5 },
        viewportSize,
        viewportRect: { left: 10, top: 20 },
        clientX: 275,
        clientY: 105,
      })

      expect(hit?.id).toBe('connection-a-b')
    })

    it('follows measured DOM sizes for mounted endpoint cards, like the painter does', () => {
      // Source measured 260x300 lifts its endpoint to y=150; the bezier
      // midpoint sits at (430, 120), not on the estimated flat line at y=90.
      const measuredCardSizeById = (cardId: string) =>
        cardId === 'a' ? { width: 260, height: 300 } : undefined

      const onMeasuredCurve = hitTestSceneConnectionAtClientPoint({
        connections: [link],
        cardById,
        measuredCardSizeById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize,
        viewportRect: { left: 0, top: 0 },
        clientX: 430,
        clientY: 120,
      })
      const onEstimatedLine = hitTestSceneConnectionAtClientPoint({
        connections: [link],
        cardById,
        measuredCardSizeById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize,
        viewportRect: { left: 0, top: 0 },
        clientX: 430,
        clientY: 90,
      })

      expect(onMeasuredCurve?.id).toBe('connection-a-b')
      expect(onEstimatedLine).toBeNull()
    })

    it('skips connections whose endpoint cards are unknown', () => {
      const hit = hitTestSceneConnectionAtClientPoint({
        connections: [connection('dangling', 'a', 'missing')],
        cardById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize,
        viewportRect: { left: 0, top: 0 },
        clientX: 430,
        clientY: 90,
      })

      expect(hit).toBeNull()
    })

    // Parity with the painter's zoom paint cap: at zoom >= 0.3 the overview
    // canvas strokes at most 64 lines, so a click on the line of connection
    // 65+ lands on empty pane and must deselect — not select an invisible
    // line the user cannot see and would otherwise delete blind.
    it('never hits a connection past the paint cap, even when its line is nearer the click', () => {
      // 70 stacked pairs, one connection per row at y = i*300 + 90 — every
      // line intersects the (tall) viewport, so the cap alone decides.
      const rowCards = new Map<string, Card>()
      const rowConnections = Array.from({ length: 70 }, (_, index) => {
        rowCards.set(`s-${index}`, note(`s-${index}`, 0, index * 300))
        rowCards.set(`t-${index}`, note(`t-${index}`, 600, index * 300))
        return connection(`row-${index}`, `s-${index}`, `t-${index}`)
      })
      const rowCardById = (cardId: string) => rowCards.get(cardId)
      const tallViewport = { width: 800, height: 30_000 }

      const painted = planPaintedConnections({
        connections: rowConnections,
        cardById: rowCardById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize: tallViewport,
      })
      expect(painted).toHaveLength(connectionLimitForZoom(1))
      expect(painted.map((planned) => planned.connection.id)).not.toContain('row-68')

      const onPaintedLine = hitTestSceneConnectionAtClientPoint({
        connections: rowConnections,
        cardById: rowCardById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize: tallViewport,
        viewportRect: { left: 0, top: 0 },
        clientX: 430,
        clientY: 30 * 300 + 90,
      })
      const onUnpaintedLine = hitTestSceneConnectionAtClientPoint({
        connections: rowConnections,
        cardById: rowCardById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize: tallViewport,
        viewportRect: { left: 0, top: 0 },
        clientX: 430,
        clientY: 68 * 300 + 90,
      })

      expect(onPaintedLine?.id).toBe('row-30')
      expect(onUnpaintedLine).toBeNull()
    })

    it('never hits a connection whose line the painter culled as outside the viewport', () => {
      // Same viewport-line filter as the painter: a line wholly below the
      // pane is not painted, so it is not clickable either.
      const farCards = new Map<string, Card>([
        ['below-s', note('below-s', 0, 2000)],
        ['below-t', note('below-t', 600, 2000)],
      ])
      const farCardById = (cardId: string) => farCards.get(cardId)
      const belowLink = connection('below-viewport', 'below-s', 'below-t')

      const painted = planPaintedConnections({
        connections: [belowLink],
        cardById: farCardById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize,
      })
      const hit = hitTestSceneConnectionAtClientPoint({
        connections: [belowLink],
        cardById: farCardById,
        viewport: { x: 0, y: 0, zoom: 1 },
        viewportSize,
        viewportRect: { left: 0, top: 0 },
        clientX: 430,
        clientY: 2090,
      })

      expect(painted).toHaveLength(0)
      expect(hit).toBeNull()
    })

    it('uses half of the shared 28px whole-wire hit stroke at every painted zoom', () => {
      // The canvas painter already works in screen space, so its radius stays
      // 14px just like the DOM edge's non-scaling 28px interaction stroke.
      expect(connectionHitTolerancePx(1)).toBe(14)
      expect(connectionHitTolerancePx(0.1)).toBe(14)

      const nearMiss = hitTestSceneConnectionAtClientPoint({
        connections: [link],
        cardById,
        viewport: { x: 0, y: 0, zoom: 0.1 },
        viewportSize,
        viewportRect: { left: 0, top: 0 },
        clientX: 43,
        clientY: 24,
      })
      const nearHit = hitTestSceneConnectionAtClientPoint({
        connections: [link],
        cardById,
        viewport: { x: 0, y: 0, zoom: 0.1 },
        viewportSize,
        viewportRect: { left: 0, top: 0 },
        clientX: 43,
        clientY: 22,
      })

      expect(nearMiss).toBeNull()
      expect(nearHit?.id).toBe('connection-a-b')
    })
  })

  // ADR 0020 retires the #209 low-zoom placeholder policy: below Reading
  // NOTHING mounts. Every card paints on the canvas at one uniform tier and
  // stays selectable through the scene hit test; connection starting from
  // the zoomed-out view is Lane C's gesture-participant proxy work.
  describe('below-Reading zero-mount (ADR 0020)', () => {
    const lowZoomCards = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        note(`card-${index}`, (index % 10) * 300, Math.floor(index / 10) * 250),
      )

    it('mounts nothing at settled low zoom; every visible card is a painted hit-test candidate', () => {
      const result = plan({ cards: lowZoomCards(OLD_LOW_ZOOM_INTERACTIVE_CARD_LIMIT + 30), zoom: 0.05 })

      expect(result.band).toBe('map')
      expect(result.detailCards).toEqual([])
      expect(result.detailCardIds.size).toBe(0)
      expect(result.overviewSuppressedCardIds.size).toBe(0)
      expect(result.useOverviewLayer).toBe(true)
      expect(result.hitTestCandidates).toEqual(result.visibleCards)
    })

    it('mounts nothing on massive boards at settled low zoom', () => {
      const cards = Array.from({ length: OLD_MASSIVE_BOARD_CARD_COUNT + 1 }, (_, index) =>
        note(`card-${index}`, (index % 60) * 280, Math.floor(index / 60) * 220),
      )

      const result = plan({ cards, zoom: 0.05 })

      expect(result.detailCards).toEqual([])
    })

    it('keeps zero mounts while the zoom aperture is still changing', () => {
      const cards = lowZoomCards(OLD_LOW_ZOOM_INTERACTIVE_CARD_LIMIT + 30)
      const zoomingOut = plan({ cards, zoom: 0.05, settledZoom: 0.5, zoomNavigationActive: true })

      expect(zoomingOut.detailCards).toEqual([])
    })
  })
})

describe('mountPlanForScene (ADR 0020)', () => {
  const cardByIdFor = (cards: Card[]) => {
    const byId = new Map(cards.map((card) => [card.id, card]))
    return (cardId: string) => byId.get(cardId)
  }

  it('pins an off-window live owner as a full Card outside the gesture-proxy set', () => {
    const cards = [note('visible', 0, 0), note('focused', 20_000, 20_000)]
    const scene = plan({ cards, zoom: 1 })

    const mount = mountPlanForScene({
      scene,
      gestureParticipantIds: new Set<string>(),
      liveOwnerIds: new Set(['focused']),
      cardById: cardByIdFor(cards),
    } as Parameters<typeof mountPlanForScene>[0] & { liveOwnerIds: ReadonlySet<string> })

    expect({
      mounted: mount.mountedCards.map((card) => card.id),
      live: [...mount.liveCardIds],
      proxies: [...mount.proxyCardIds],
    }).toEqual({ mounted: ['visible', 'focused'], live: ['focused'], proxies: [] })
  })

  it('preserves node-driving collections when live ownership moves between resident Cards', () => {
    const cards = [note('source', 0, 0), note('target', 320, 0)]
    const scene = plan({ cards, zoom: 1 })
    const first = mountPlanForScene({
      scene,
      gestureParticipantIds: new Set<string>(),
      liveOwnerIds: new Set(['source']),
      cardById: cardByIdFor(cards),
    })
    const second = mountPlanForScene({
      scene,
      gestureParticipantIds: new Set(['source']),
      liveOwnerIds: new Set(['source', 'target']),
      cardById: cardByIdFor(cards),
    })

    expect(second.mountedCards).toBe(first.mountedCards)
    expect(second.proxyCardIds).toBe(first.proxyCardIds)
  })

  // Amendment (#306): the empty-participant path is reference-identity
  // evidence — every returned collection must BE the scene/empty-set
  // instance, the same Immer-style structural sharing the scene memos pin.
  it('with an empty participant set every returned collection is the scene/empty-set instance', () => {
    const cards = denseCards(120)
    const scene = plan({ cards, zoom: 1 })
    const participants = new Set<string>()

    const mount = mountPlanForScene({ scene, gestureParticipantIds: participants, cardById: cardByIdFor(cards) })

    expect(mount.mountedCards).toBe(scene.detailCards)
    expect(mount.proxyCardIds).toBe(participants)
    expect(mount.paintOccludingCardIds).toBe(scene.detailCardIds)
    expect(mount.overviewSuppressedCardIds).toBe(scene.overviewSuppressedCardIds)
  })

  it('below Reading mounts exactly the participants, as proxies, outside every painter set', () => {
    const cards = denseCards(120)
    const scene = plan({ cards, zoom: 0.25 })
    expect(scene.detailCards).toEqual([])
    const participants = new Set(['card-3', 'card-7'])

    const mount = mountPlanForScene({ scene, gestureParticipantIds: participants, cardById: cardByIdFor(cards) })

    expect(mount.mountedCards.map((card) => card.id).sort()).toEqual(['card-3', 'card-7'])
    expect([...mount.proxyCardIds].sort()).toEqual(['card-3', 'card-7'])
    // A proxy is an invisible node: it must not enter the painter's visual
    // DOM set or suppression, or the card would silhouette while moving and
    // vanish when settled.
    expect(mount.paintOccludingCardIds.has('card-3')).toBe(false)
    expect(mount.overviewSuppressedCardIds.has('card-3')).toBe(false)
    expect(mount.paintOccludingCardIds).toBe(scene.detailCardIds)
    expect(mount.overviewSuppressedCardIds).toBe(scene.overviewSuppressedCardIds)
  })

  it('holds mountedCardIds ⊇ gestureParticipantIds at every band', () => {
    const cards = denseCards(60)
    for (const zoom of [1, 0.25, 0.05]) {
      const scene = plan({ cards, zoom })
      const participants = new Set(['card-2', 'card-5'])

      const mount = mountPlanForScene({ scene, gestureParticipantIds: participants, cardById: cardByIdFor(cards) })

      const mountedIds = new Set(mount.mountedCards.map((card) => card.id))
      expect([...participants].every((cardId) => mountedIds.has(cardId)), `zoom ${zoom}`).toBe(true)
    }
  })

  it('gives a participant the scene already mounts its full node, not a proxy', () => {
    const cards = denseCards(60)
    const scene = plan({ cards, zoom: 1 })
    expect(scene.detailCardIds.has('card-2')).toBe(true)

    const mount = mountPlanForScene({
      scene,
      gestureParticipantIds: new Set(['card-2']),
      cardById: cardByIdFor(cards),
    })

    expect(mount.mountedCards).toBe(scene.detailCards)
    expect(mount.proxyCardIds.size).toBe(0)
  })

  it('excludes an unresolvable participant loudly, never silently', () => {
    const cards = denseCards(60)
    const scene = plan({ cards, zoom: 0.25 })

    const mount = mountPlanForScene({
      scene,
      gestureParticipantIds: new Set(['ghost', 'card-4']),
      cardById: cardByIdFor(cards),
    })

    // The deleted-mid-gesture id mounts nothing and takes no slot, but it is
    // observable on the plan — a silent filter would hide the delete race.
    expect([...mount.excludedParticipantIds]).toEqual(['ghost'])
    expect(mount.mountedCards.map((card) => card.id)).toEqual(['card-4'])
    expect([...mount.proxyCardIds]).toEqual(['card-4'])
  })

  it('enforces the participant bound: a third participant is clamped deterministically and surfaced', () => {
    const cards = denseCards(60)
    const scene = plan({ cards, zoom: 0.25 })

    const mount = mountPlanForScene({
      scene,
      gestureParticipantIds: new Set(['card-3', 'card-7', 'card-9']),
      cardById: cardByIdFor(cards),
    })

    expect(GESTURE_PARTICIPANT_LIMIT).toBe(2)
    // Insertion order decides the clamp: the first two participants win,
    // the violation is observable, and the mount set stays bounded.
    expect(mount.mountedCards.map((card) => card.id).sort()).toEqual(['card-3', 'card-7'])
    expect(mount.proxyCardIds.size).toBe(GESTURE_PARTICIPANT_LIMIT)
    expect([...mount.excludedParticipantIds]).toEqual(['card-9'])
  })

  it('an unresolvable participant does not consume a bound slot', () => {
    const cards = denseCards(60)
    const scene = plan({ cards, zoom: 0.25 })

    const mount = mountPlanForScene({
      scene,
      gestureParticipantIds: new Set(['ghost', 'card-3', 'card-7']),
      cardById: cardByIdFor(cards),
    })

    expect(mount.mountedCards.map((card) => card.id).sort()).toEqual(['card-3', 'card-7'])
    expect([...mount.excludedParticipantIds]).toEqual(['ghost'])
  })

  it('reuses one empty excluded-set instance on well-behaved frames', () => {
    const cards = denseCards(60)
    const scene = plan({ cards, zoom: 0.25 })
    const first = mountPlanForScene({
      scene,
      gestureParticipantIds: new Set<string>(),
      cardById: cardByIdFor(cards),
    })
    const second = mountPlanForScene({
      scene,
      gestureParticipantIds: new Set(['card-3']),
      cardById: cardByIdFor(cards),
    })

    expect(first.excludedParticipantIds.size).toBe(0)
    expect(second.excludedParticipantIds).toBe(first.excludedParticipantIds)
  })
})

function decideBand({
  zoom,
  previousBand = null,
  moving = false,
  occupancy = {},
}: {
  zoom: number
  previousBand?: DetailBand | null
  moving?: boolean
  occupancy?: Partial<SceneBandOccupancy>
}): DetailBand {
  return bandForScene({
    zoom,
    occupancy: { cardDenseViewport: false, ...occupancy },
    settleState: aperture(moving ? { settled: false, changing: true } : {}),
    previousBand,
  })
}

describe('bandForScene (ADR 0019)', () => {
  it('freezes the band constants', () => {
    expect(READING_BAND_MIN_ZOOM).toBe(0.325)
    expect(MAP_BAND_MAX_ZOOM).toBe(0.15)
    expect(BAND_CROSSFADE_HALF_WIDTH).toBe(0.15)
  })

  it('classifies the zoom-only nominal band at the frozen thresholds', () => {
    expect(decideBand({ zoom: 1 })).toBe('reading')
    expect(decideBand({ zoom: 0.325 })).toBe('reading')
    expect(decideBand({ zoom: 0.324 })).toBe('overview')
    expect(decideBand({ zoom: 0.25 })).toBe('overview')
    expect(decideBand({ zoom: 0.151 })).toBe('overview')
    expect(decideBand({ zoom: 0.15 })).toBe('map')
    expect(decideBand({ zoom: 0.05 })).toBe('map')
  })

  // These two tests pin an AMENDED #305 criterion, not the issue's original
  // text. #305 originally said the seed is the "zoom-only nominal band";
  // that reading is mutually unsatisfiable with its unchanged-viewport
  // stability criterion on an occupied viewport at Reading zoom, and the
  // orchestrator amended the contract in the open:
  // https://github.com/limweili/eido/issues/305#issuecomment-4934286311
  // Amended criterion: seed = zoom-only nominal band PLUS the occupancy
  // demotion; no deadband, no settle gate.
  it('seeds without history per the amended #305 criterion: no deadband, no settle gate, but occupancy still demotes', () => {
    // Motion cannot gate a seed (there is no previous band to hold)...
    expect(decideBand({ zoom: 1, moving: true })).toBe('reading')
    // ...but occupancy is stateless per-frame input and applies from the
    // first frame, so re-derivation at an unchanged viewport never flips the
    // band after the seed.
    expect(decideBand({ zoom: 1, occupancy: { cardDenseViewport: true } })).toBe('overview')
  })

  it('documents the rejected literal seed: a zoom-only seed on an occupied viewport would flip at an unchanged viewport', () => {
    const occupiedAtReadingZoom = { zoom: 1, occupancy: { cardDenseViewport: true } }

    // Under #305's original wording the seed would ignore occupancy and
    // return 'reading'. Feed that hypothetical seed back as previousBand at
    // the SAME viewport: occupancy demotes it — the band would change with
    // no viewport motion, violating the stability criterion.
    expect(decideBand({ ...occupiedAtReadingZoom, previousBand: 'reading' })).toBe('overview')
    // The amended seed lands on 'overview' from the first frame instead,
    // and re-derivation at the unchanged viewport is a fixed point.
    expect(decideBand(occupiedAtReadingZoom)).toBe('overview')
    expect(decideBand({ ...occupiedAtReadingZoom, previousBand: 'overview' })).toBe('overview')
  })

  it('holds the previous band inside the deadband instead of flickering on a threshold', () => {
    // Reading is left only past the far edge of its crossfade window (0.27625)...
    expect(decideBand({ zoom: 0.3, previousBand: 'reading' })).toBe('reading')
    expect(decideBand({ zoom: 0.277, previousBand: 'reading' })).toBe('reading')
    expect(decideBand({ zoom: 0.276, previousBand: 'reading' })).toBe('overview')
    // ...and map only past the far edge of its window (0.1725) — leaving map
    // is a promotion, so these are settled derivations.
    expect(decideBand({ zoom: 0.16, previousBand: 'map' })).toBe('map')
    expect(decideBand({ zoom: 0.17, previousBand: 'map' })).toBe('map')
    expect(decideBand({ zoom: 0.18, previousBand: 'map' })).toBe('overview')
    // Bands are ENTERED at the nominal thresholds: overview carries no
    // deadband of its own.
    expect(decideBand({ zoom: 0.325, previousBand: 'overview' })).toBe('reading')
    expect(decideBand({ zoom: 0.15, previousBand: 'overview' })).toBe('map')
  })

  it('blocks promotion toward reading while the viewport moves and promotes once settled', () => {
    expect(decideBand({ zoom: 0.9, previousBand: 'overview', moving: true })).toBe('overview')
    expect(decideBand({ zoom: 0.9, previousBand: 'overview' })).toBe('reading')
    expect(decideBand({ zoom: 0.25, previousBand: 'map', moving: true })).toBe('map')
    expect(decideBand({ zoom: 0.25, previousBand: 'map' })).toBe('overview')
    // A still viewport with live navigation input (a pane click mid-gesture)
    // still gates promotion.
    expect(
      bandForScene({
        zoom: 0.9,
        occupancy: { cardDenseViewport: false },
        settleState: aperture({ navigationActive: true }),
        previousBand: 'overview',
      }),
    ).toBe('overview')
  })

  it('always allows demotion toward map, even mid-gesture', () => {
    expect(decideBand({ zoom: 0.25, previousBand: 'reading', moving: true })).toBe('overview')
    expect(decideBand({ zoom: 0.1, previousBand: 'overview', moving: true })).toBe('map')
    // A hard zoom-out crosses both boundaries in one derivation.
    expect(decideBand({ zoom: 0.05, previousBand: 'reading', moving: true })).toBe('map')
  })

  it('demotes reading to overview while the viewport is over-occupied, and never promotes on occupancy', () => {
    expect(decideBand({ zoom: 1, previousBand: 'reading', occupancy: { cardDenseViewport: true } })).toBe('overview')
    // Occupancy holds the board in overview at reading zoom...
    expect(decideBand({ zoom: 1, previousBand: 'overview', occupancy: { cardDenseViewport: true } })).toBe('overview')
    // ...and the promotion happens (settled) once the viewport thins out.
    expect(decideBand({ zoom: 1, previousBand: 'overview' })).toBe('reading')
    // Occupancy never touches the overview/map boundary.
    expect(
      decideBand({
        zoom: 0.3,
        previousBand: 'overview',
        occupancy: { cardDenseViewport: true },
      }),
    ).toBe('overview')
  })

  it('is a pure function: identical inputs give an identical band with the deadband intact', () => {
    const inputs = {
      zoom: 0.325,
      occupancy: { cardDenseViewport: false },
      settleState: aperture(),
      previousBand: 'reading' as const,
    }

    expect(bandForScene(inputs)).toBe('reading')
    expect(bandForScene(inputs)).toBe('reading')
  })
})

describe('createBoardScene detail band exposure (ADR 0019)', () => {
  it('exposes the seeded nominal band on the scene', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]

    expect(plan({ cards, zoom: 1 }).band).toBe('reading')
    expect(plan({ cards, zoom: 0.25 }).band).toBe('overview')
    expect(plan({ cards, zoom: 0.05 }).band).toBe('map')
  })

  it('keeps the band and deadband intact when the scene re-derives at an unchanged viewport', () => {
    // The scene can re-derive without the viewport moving (a graph edit at a
    // still viewport advances previousScene). The band keys off the viewport
    // and the settle state — never off call counts — so held deadband state
    // must survive any number of re-derivations.
    const cards = denseCards(120)
    const seeded = plan({ cards, zoom: 0.4 })
    expect(seeded.band).toBe('reading')

    // Settled inside the deadband: nominal zoom says overview, reading holds.
    const insideDeadband = plan({ cards, zoom: 0.3, previousScene: seeded })
    expect(insideDeadband.band).toBe('reading')

    const rederived = plan({ cards, zoom: 0.3, previousScene: insideDeadband })
    const rederivedAgain = plan({ cards, zoom: 0.3, previousScene: rederived })

    expect(rederived.band).toBe('reading')
    expect(rederivedAgain.band).toBe('reading')
  })

  it('reports fullyDetailed only when the detail set covers every visible card', () => {
    const small = plan({ cards: [note('a', 0, 0), note('b', 320, 0)], zoom: 1 })
    expect(small.fullyDetailed).toBe(true)

    const textHeavy = plan({ cards: textHeavyCards(140), zoom: 0.25 })
    expect(textHeavy.detailCardIds.size).toBeLessThan(textHeavy.visibleCardIds.size)
    expect(textHeavy.fullyDetailed).toBe(false)

    const massive = plan({ cards: massiveCards(), zoom: 0.25 })
    expect(massive.fullyDetailed).toBe(false)
  })

  it('counts one sceneDerivation per createBoardScene call and resets with the perf counters', () => {
    const cards = [note('a', 0, 0)]
    resetBoardScenePerfCounters()

    plan({ cards, zoom: 1 })
    expect(boardScenePerfCountersSnapshot().sceneDerivations).toBe(1)

    plan({ cards, zoom: 1 })
    plan({ cards, zoom: 0.5 })
    expect(boardScenePerfCountersSnapshot().sceneDerivations).toBe(3)

    resetBoardScenePerfCounters()
    expect(boardScenePerfCountersSnapshot().sceneDerivations).toBe(0)
  })

  it('keeps the scene pointer-cold: no pointer, hover, or gesture input in the options type', () => {
    const source = readFileSync(fileURLToPath(new URL('./boardScene.ts', import.meta.url)), 'utf8')
    const start = source.indexOf('export type BoardSceneOptions')
    const end = source.indexOf('export type BoardScene = ')

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(source.slice(start, end)).not.toMatch(/hover|gesture|pointer/i)
  })
})

// A4 (#324): graph metrics are viewport-independent. The scene consumes the
// projection; navigation frames and structural-only board changes perform
// zero card-metric work, targeted content changes visit only the named
// cards, and every unprovable case falls back to a counted full rebuild.
describe('deriveBoardCardMetrics (A4 — viewport-independent graph metric projection)', () => {
  const sceneSource = () => readFileSync(fileURLToPath(new URL('./boardScene.ts', import.meta.url)), 'utf8')

  it('bans the deleted string metric keys from the scene module', () => {
    const source = sceneSource()
    expect(source).not.toContain('JSON.stringify')
    expect(source).not.toContain('cardSummaryKey')
    expect(source).not.toContain('cardWeightKey')
  })

  it('deriving 200 scenes at different viewports does zero metric work', () => {
    const cards = denseCards(60)
    const cardMetrics = metricsFor(cards)
    resetBoardScenePerfCounters()

    for (let step = 0; step < 200; step += 1) {
      plan({ cards, cardMetrics, zoom: 0.2 + (step % 10) * 0.08, x: -step * 7, y: step * 3 })
    }

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.sceneDerivations).toBe(200)
    expect(counters.cardMetricDerivations).toBe(0)
    expect(counters.cardMetricVisits).toBe(0)
    expect(counters.cardMetricFullRebuilds).toBe(0)
  })

  it('re-deriving with identical cards/outputs returns the same projection and computes nothing', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const outputs: Output[] = []
    const first = metricsFor(cards, outputs)
    resetBoardScenePerfCounters()

    const second = metricsFor(cards, outputs, { previous: first })

    const counters = boardScenePerfCountersSnapshot()
    expect(second).toBe(first)
    expect(second.cardSummariesById).toBe(first.cardSummariesById)
    expect(second.cardWeightById).toBe(first.cardWeightById)
    expect(counters.summaryComputations).toBe(0)
    expect(counters.weightComputations).toBe(0)
    expect(counters.cardMetricDerivations).toBe(0)
    expect(counters.cardMetricVisits).toBe(0)
  })

  it('a position/size/grouping/layer-only change returns the exact previous projection with zero visits', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const first = metricsFor(cards)
    resetBoardScenePerfCounters()
    const restructured = [
      { ...cards[0], position: { x: 40, y: 12 }, size: { width: 300, height: 200 }, groupId: 'g-1', zIndex: 5 },
      cards[1],
    ]

    const second = metricsFor(restructured, NO_OUTPUTS, {
      change: changeEmission(1, {
        cards: { updated: ['a'] },
        cardAspects: ['position', 'size', 'grouping', 'layer'],
      }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(second).toBe(first)
    expect(counters.cardMetricDerivations).toBe(0)
    expect(counters.cardMetricVisits).toBe(0)
    expect(counters.cardMetricFullRebuilds).toBe(0)
  })

  it('a one-card text edit visits one card and recomputes exactly one summary and one weight', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const first = metricsFor(cards)
    resetBoardScenePerfCounters()
    const edited = [{ ...cards[0], blocks: [{ id: 'a-block', text: 'edited body text' }] }, cards[1]]

    const second = metricsFor(edited, NO_OUTPUTS, {
      change: changeEmission(1, { cards: { updated: ['a'] }, cardAspects: ['content'] }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricDerivations).toBe(1)
    expect(counters.cardMetricVisits).toBe(1)
    expect(counters.cardMetricFullRebuilds).toBe(0)
    expect(counters.summaryCardIds).toEqual(['a'])
    expect(counters.weightCardIds).toEqual(['a'])
    expect(second.cardSummariesById.get('a')?.label).toBe('edited body text')
    expect(second.cardSummariesById.get('b')).toBe(first.cardSummariesById.get('b'))
    expect(second.cardWeightById.get('a')).toBe('edited body text'.length)
    expect(second.cardWeightById.get('b')).toBe(first.cardWeightById.get('b'))
    // The incrementally-adjusted total matches a from-scratch rebuild.
    expect(second.boardDetailTextWeight).toBe(metricsFor(edited).boardDetailTextWeight)
  })

  it('a title edit visits and recomputes only the affected card summary, not its weight', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const first = metricsFor(cards)
    resetBoardScenePerfCounters()
    const retitled = [{ ...cards[0], title: 'Reading list' }, cards[1]]

    const second = metricsFor(retitled, NO_OUTPUTS, {
      change: changeEmission(1, { cards: { updated: ['a'] }, cardAspects: ['content'] }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricVisits).toBe(1)
    expect(counters.summaryCardIds).toEqual(['a'])
    expect(counters.weightCardIds).toEqual([])
    expect(second.cardSummariesById.get('a')?.label).toBe('Reading list')
    expect(second.boardDetailTextWeight).toBe(first.boardDetailTextWeight)
  })

  it('a Mod title edit visits and recomputes only the affected card summary', () => {
    const modV2 = createSeedMod('slider', {
      title: 'Tone',
      createId: (_, ordinal) => `tone-${ordinal}`,
    })
    const modCard: Card = {
      id: 'm',
      kind: 'mod',
      blocks: [],
      position: { x: 0, y: 0 },
      modV2,
    }
    const cards = [modCard, note('b', 320, 0)]
    const first = metricsFor(cards)
    resetBoardScenePerfCounters()
    const relabeled = [{ ...modCard, modV2: { ...modV2, title: 'Voice' } }, cards[1]]

    const second = metricsFor(relabeled, NO_OUTPUTS, {
      change: changeEmission(1, { cards: { updated: ['m'] }, cardAspects: ['content'] }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricVisits).toBe(1)
    expect(counters.summaryCardIds).toEqual(['m'])
    expect(counters.weightCardIds).toEqual([])
    expect(second.cardSummariesById.get('m')?.preview).toBe('Voice')
  })

  it('a changed output visits only its result card and recomputes only its weight', () => {
    const cards = [note('a', 0, 0), note('r', 320, 0)]
    const output: Output = {
      id: 'output',
      resultCardId: 'r',
      versions: [{ id: 'v1', number: 1, text: 'short', createdAt: '2026-06-25T00:00:00.000Z', fromRunId: 'run-1' }],
    }
    const first = metricsFor(cards, [output])
    resetBoardScenePerfCounters()
    const grownOutputs = [{ ...output, versions: [{ ...output.versions[0], text: 'a much longer generated output' }] }]

    const second = metricsFor(cards, grownOutputs, {
      change: changeEmission(1, { outputs: { updated: ['output'] } }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricDerivations).toBe(1)
    expect(counters.cardMetricVisits).toBe(1)
    expect(counters.summaryCardIds).toEqual([])
    expect(counters.weightCardIds).toEqual(['r'])
    expect(second.cardSummariesById).toBe(first.cardSummariesById)
    expect(second.boardDetailTextWeight).toBe(
      'a'.length + 'r'.length + 'a much longer generated output'.length,
    )
  })

  it('an updated output whose resultCardId moved re-derives BOTH the previous and the new target', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const output: Output = {
      id: 'output',
      resultCardId: 'a',
      versions: [{ id: 'v1', number: 1, text: 'generated text', createdAt: '2026-06-25T00:00:00.000Z', fromRunId: 'run-1' }],
    }
    const first = metricsFor(cards, [output])
    expect(first.boardDetailTextWeight).toBe('a'.length + 'b'.length + 'generated text'.length)
    resetBoardScenePerfCounters()
    const movedOutputs = [{ ...output, resultCardId: 'b' }]

    const second = metricsFor(cards, movedOutputs, {
      change: changeEmission(1, { outputs: { updated: ['output'] } }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricVisits).toBe(2)
    expect(counters.cardMetricFullRebuilds).toBe(0)
    expect(second).not.toBe(first)
    expect(second.cardSummariesById).toBe(first.cardSummariesById)
    expect(second.cardWeightById).not.toBe(first.cardWeightById)
    expect(second.cardWeightById.get('a')).toBe('a'.length)
    expect(second.cardWeightById.get('b')).toBe('b'.length + 'generated text'.length)
    expect(second.boardDetailTextWeight).toBe(metricsFor(cards, movedOutputs).boardDetailTextWeight)

    // A following targeted edit exposes stale per-card bookkeeping: if the
    // moved output still belonged to `a` internally, changing `a` would
    // subtract the generated text from the Board total a second time.
    const editedCards = [{ ...cards[0], blocks: [{ id: 'a-block', text: 'edited a' }] }, cards[1]]
    const afterEdit = metricsFor(editedCards, movedOutputs, {
      change: changeEmission(2, { cards: { updated: ['a'] }, cardAspects: ['content'] }),
      previous: second,
    })
    expect(afterEdit.boardDetailTextWeight).toBe(
      'edited a'.length + 'b'.length + 'generated text'.length,
    )
  })

  it('a record that omits the changed collection is never trusted as neutral: full rebuild, no stale summary', () => {
    const cards = [note('a', 0, 0)]
    const first = metricsFor(cards)
    resetBoardScenePerfCounters()
    // The cards reference changed (a text edit), but the contiguous record
    // names only connections. Reference identity establishes the difference;
    // the record fails to explain it, so it must not be used as evidence
    // that metrics are unchanged (#324 as amended).
    const edited = [{ ...cards[0], blocks: [{ id: 'a-block', text: 'edited despite the record' }] }]

    const second = metricsFor(edited, NO_OUTPUTS, {
      change: changeEmission(1, { connections: { added: ['c-1'] } }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricFullRebuilds).toBe(1)
    expect(second.cardSummariesById.get('a')?.label).toBe('edited despite the record')
  })

  it('an added output takes a counted full rebuild', () => {
    const cards = [note('a', 0, 0), note('r', 320, 0)]
    const first = metricsFor(cards)
    resetBoardScenePerfCounters()
    const addedOutputs: Output[] = [{
      id: 'output',
      resultCardId: 'r',
      versions: [{ id: 'v1', number: 1, text: 'fresh output', createdAt: '2026-06-25T00:00:00.000Z', fromRunId: 'run-1' }],
    }]

    const second = metricsFor(cards, addedOutputs, {
      change: changeEmission(1, { outputs: { added: ['output'] } }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricFullRebuilds).toBe(1)
    expect(second.boardDetailTextWeight).toBe('a'.length + 'r'.length + 'fresh output'.length)
  })

  it('a removed output takes a counted full rebuild that sheds its weight', () => {
    const cards = [note('a', 0, 0), note('r', 320, 0)]
    const output: Output = {
      id: 'output',
      resultCardId: 'r',
      versions: [{ id: 'v1', number: 1, text: 'soon removed', createdAt: '2026-06-25T00:00:00.000Z', fromRunId: 'run-1' }],
    }
    const first = metricsFor(cards, [output])
    expect(first.boardDetailTextWeight).toBe('a'.length + 'r'.length + 'soon removed'.length)
    resetBoardScenePerfCounters()

    const second = metricsFor(cards, NO_OUTPUTS, {
      change: changeEmission(1, { outputs: { removed: ['output'] } }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricFullRebuilds).toBe(1)
    expect(second.boardDetailTextWeight).toBe('a'.length + 'r'.length)
  })

  it('an unrelated emission (connections-only) keeps the projection and stays provable for the next edit', () => {
    const cards = [note('a', 0, 0)]
    const first = metricsFor(cards)
    const afterConnections = metricsFor(cards, NO_OUTPUTS, {
      change: changeEmission(1, { connections: { added: ['c-1'] } }),
      previous: first,
    })
    expect(afterConnections).toBe(first)

    resetBoardScenePerfCounters()
    const edited = [{ ...cards[0], blocks: [{ id: 'a-block', text: 'still incremental' }] }]
    const second = metricsFor(edited, NO_OUTPUTS, {
      change: changeEmission(2, { cards: { updated: ['a'] }, cardAspects: ['content'] }),
      previous: afterConnections,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricFullRebuilds).toBe(0)
    expect(counters.cardMetricVisits).toBe(1)
    expect(second.cardSummariesById.get('a')?.label).toBe('still incremental')
  })

  it('cold start is a counted full rebuild', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    resetBoardScenePerfCounters()

    metricsFor(cards)

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricDerivations).toBe(1)
    expect(counters.cardMetricFullRebuilds).toBe(1)
    expect(counters.cardMetricVisits).toBe(2)
  })

  it('an added card takes a counted full rebuild that reuses unchanged summaries by identity', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const first = metricsFor(cards)
    resetBoardScenePerfCounters()
    const grown = [...cards, note('c', 640, 0)]

    const second = metricsFor(grown, NO_OUTPUTS, {
      change: changeEmission(1, { cards: { added: ['c'] } }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricFullRebuilds).toBe(1)
    expect(counters.cardMetricVisits).toBe(3)
    expect(counters.summaryCardIds).toEqual(['c'])
    expect(second.cardSummariesById.get('a')).toBe(first.cardSummariesById.get('a'))
    expect(second.cardSummariesById.size).toBe(3)
  })

  it('a removed card takes a counted full rebuild that drops its metrics', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const first = metricsFor(cards)
    resetBoardScenePerfCounters()

    const second = metricsFor([cards[0]], NO_OUTPUTS, {
      change: changeEmission(1, { cards: { removed: ['b'] } }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricFullRebuilds).toBe(1)
    expect(second.cardSummariesById.has('b')).toBe(false)
    expect(second.boardDetailTextWeight).toBe(1)
  })

  it('a missed change sequence falls back to a full rebuild and cannot leave stale summaries', () => {
    const cards = [note('a', 0, 0)]
    const first = metricsFor(cards)
    resetBoardScenePerfCounters()
    // Two commits landed but only the LAST emission is visible (seq jumped
    // 0 -> 2): the record no longer explains the whole delta.
    const edited = [{ ...cards[0], blocks: [{ id: 'a-block', text: 'second edit' }] }]

    const second = metricsFor(edited, NO_OUTPUTS, {
      change: changeEmission(2, { cards: { updated: ['a'] }, cardAspects: ['content'] }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricFullRebuilds).toBe(1)
    expect(second.cardSummariesById.get('a')?.label).toBe('second edit')
  })

  it('a changed graph without any change record falls back to a full rebuild (hydration/import shape)', () => {
    const cards = [note('a', 0, 0)]
    const first = metricsFor(cards)
    resetBoardScenePerfCounters()
    const imported = [{ ...cards[0], blocks: [{ id: 'a-block', text: 'imported text' }] }]

    const second = metricsFor(imported, NO_OUTPUTS, { previous: first })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricFullRebuilds).toBe(1)
    expect(second.cardSummariesById.get('a')?.label).toBe('imported text')
  })

  it('a change record naming a card the index cannot resolve falls back to a full rebuild', () => {
    const cards = [note('a', 0, 0)]
    const first = metricsFor(cards)
    resetBoardScenePerfCounters()

    const second = metricsFor(cards.map((card) => ({ ...card })), NO_OUTPUTS, {
      change: changeEmission(1, { cards: { updated: ['ghost'] }, cardAspects: ['content'] }),
      previous: first,
    })

    const counters = boardScenePerfCountersSnapshot()
    expect(counters.cardMetricFullRebuilds).toBe(1)
    expect(second.cardSummariesById.get('a')?.label).toBe(first.cardSummariesById.get('a')?.label)
  })
})

describe('summaryForCard display priority (ADR 0019)', () => {
  const at = { x: 0, y: 0 }

  it('classifies groups and title cards as landmarks', () => {
    const group: Card = { id: 'g', kind: 'group', title: 'Research', blocks: [], position: at }
    const titleCard: Card = { id: 't', kind: 'title', blocks: [{ id: 't-b', text: 'Q3 planning' }], position: at }

    expect(summaryForCard(group).displayPriority).toBe('landmark')
    expect(summaryForCard(titleCard).displayPriority).toBe('landmark')
  })

  it('classifies user-titled cards and user-written bodies as user-authored', () => {
    const titled: Card = { id: 'n', kind: 'note', title: 'Reading list', blocks: [{ id: 'n-b', text: '' }], position: at }
    const question: Card = {
      id: 'q',
      kind: 'askAi',
      blocks: [{ id: 'q-b', text: 'What themes connect these notes?' }],
      position: at,
    }

    expect(summaryForCard(titled).displayPriority).toBe('user-authored')
    expect(summaryForCard(question).displayPriority).toBe('user-authored')
  })

  it('classifies untitled empty notes, AI results, and default Mod titles as system-generated', () => {
    const untitled: Card = { id: 'u', kind: 'note', blocks: [{ id: 'u-b', text: '' }], position: at }
    const result: Card = { id: 'r', kind: 'result', blocks: [{ id: 'r-b', text: 'Generated answer text' }], position: at }
    const mod: Card = {
      id: 'm',
      kind: 'mod',
      blocks: [],
      position: at,
      modV2: createSeedMod('slider', {
        title: 'Tone',
        createId: (_, ordinal) => `tone-${ordinal}`,
      }),
    }

    expect(summaryForCard(untitled).displayPriority).toBe('system-generated')
    expect(summaryForCard(result).displayPriority).toBe('system-generated')
    expect(summaryForCard(mod).displayPriority).toBe('system-generated')
  })

  it('a typed title outranks system kinds: a renamed result is user-authored', () => {
    const renamed: Card = {
      id: 'r2',
      kind: 'result',
      title: 'Chosen synthesis',
      blocks: [{ id: 'r2-b', text: 'Generated' }],
      position: at,
    }

    expect(summaryForCard(renamed).displayPriority).toBe('user-authored')
  })
})

// Compact value-level pins for representative band, priority, connection,
// far-zoom, and playback seams. Residency matrices use the direct V/P/S and
// identity assertions above; full Board membership dumps duplicated those
// invariants and were retired under ADR 0028.
describe('createBoardScene output pinning', () => {
  it('pins one card of each display priority with band and coverage (ADR 0019)', () => {
    const cards: Card[] = [
      { id: 'group-1', kind: 'group', title: 'Research', blocks: [], position: { x: 0, y: 0 } },
      { id: 'title-1', kind: 'title', blocks: [{ id: 'title-1-block', text: 'Q3 planning wall' }], position: { x: 340, y: 0 } },
      {
        id: 'named-note',
        kind: 'note',
        title: 'Reading list',
        blocks: [{ id: 'named-note-block', text: 'Papers to read' }],
        position: { x: 0, y: 220 },
      },
      {
        id: 'ask-question',
        kind: 'askAi',
        blocks: [{ id: 'ask-question-block', text: 'What themes connect these notes?' }],
        position: { x: 340, y: 220 },
      },
      { id: 'untitled-note', kind: 'note', blocks: [{ id: 'untitled-note-block', text: '' }], position: { x: 0, y: 440 } },
      {
        id: 'result-output',
        kind: 'result',
        blocks: [{ id: 'result-output-block', text: 'Generated synthesis of the notes.' }],
        position: { x: 340, y: 440 },
      },
    ]

    expect(sceneDigest(plan({ cards, zoom: 1 }))).toMatchSnapshot()
  })

  it('pins a small settled board at near zoom', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0), note('c', 0, 260)]
    const connections = [connection('c-1', 'a', 'b'), connection('c-2', 'b', 'c')]

    expect(sceneDigest(plan({ cards, connections, zoom: 1 }))).toMatchSnapshot()
  })

  it('pins a small board with dense connections kept as DOM edges (#211)', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const connections = Array.from({ length: DENSE_CONNECTION_COUNT }, (_, index) =>
      connection(`connection-${index}`, 'a', 'b'),
    )

    expect(sceneDigest(plan({ cards, connections, zoom: 1 }))).toMatchSnapshot()
  })

  it('pins read-only playback rendering the whole board even when text-heavy', () => {
    const cards = textHeavyCards(140)

    expect(sceneDigest(plan({ cards, zoom: 0.5, readOnly: true }))).toMatchSnapshot()
  })

  it('pins far zoom on a plain board', () => {
    const cards = denseCards(120)

    expect(sceneDigest(plan({ cards, zoom: 0.05 }))).toMatchSnapshot()
  })
})

// Fake pointer-event targets: closest() matches when the selector mentions
// one of the given classes, mirroring an element inside a card node, a
// resize handle, or the bare pane.
const targetMatching = (matched: string[]) =>
  ({
    closest: (selector: string) =>
      matched.some((className) => selector.includes(className)) ? {} : null,
  }) as unknown as EventTarget

// #204: card drags and resizes are card gestures, not viewport navigation -
// Board.tsx uses this to keep the detail aperture out of navigation mode
// during them (only pan/zoom flips it).
describe('isCardInteractionTarget', () => {
  it('classifies pointer gestures starting on a card node as card interactions', () => {
    expect(isCardInteractionTarget(targetMatching(['.react-flow__node']))).toBe(true)
  })

  it('classifies pointer gestures starting on a resize handle as card interactions', () => {
    expect(isCardInteractionTarget(targetMatching(['.react-flow__resize-control']))).toBe(true)
  })

  it('leaves pane gestures (pan) counting as navigation', () => {
    expect(isCardInteractionTarget(targetMatching([]))).toBe(false)
    expect(isCardInteractionTarget(null)).toBe(false)
  })
})

// #204 acceptance: Board's actual pointer-event decision path. These are the
// exact handlers Board.tsx wires to its wrapper's pointerdown/pointermove
// listeners, so a drag/resize gesture flipping navigation on would fail here.
describe('createPointerNavigationTracker', () => {
  it('a drag gesture on a card node never marks navigation active', () => {
    let marks = 0
    const tracker = createPointerNavigationTracker(() => {
      marks += 1
    })
    const cardTarget = targetMatching(['.react-flow__node'])

    tracker.pointerdown({ target: cardTarget })
    for (let move = 0; move < 5; move += 1) {
      tracker.pointermove({ target: cardTarget, buttons: 1 })
    }

    expect(marks).toBe(0)
  })

  it('a resize gesture on a resize handle never marks navigation active', () => {
    let marks = 0
    const tracker = createPointerNavigationTracker(() => {
      marks += 1
    })
    const handleTarget = targetMatching(['.react-flow__resize-control'])

    tracker.pointerdown({ target: handleTarget })
    for (let move = 0; move < 5; move += 1) {
      tracker.pointermove({ target: handleTarget, buttons: 1 })
    }

    expect(marks).toBe(0)
  })

  it('a pan gesture on the pane marks navigation on pointerdown and every held move', () => {
    let marks = 0
    const tracker = createPointerNavigationTracker(() => {
      marks += 1
    })
    const paneTarget = targetMatching([])

    tracker.pointerdown({ target: paneTarget })
    tracker.pointermove({ target: paneTarget, buttons: 1 })
    tracker.pointermove({ target: paneTarget, buttons: 1 })

    expect(marks).toBe(3)
  })

  it('hovering the pane with no button held does not mark navigation', () => {
    let marks = 0
    const tracker = createPointerNavigationTracker(() => {
      marks += 1
    })

    tracker.pointermove({ target: targetMatching([]), buttons: 0 })

    expect(marks).toBe(0)
  })

  it('a pane gesture after a card gesture counts as navigation again', () => {
    let marks = 0
    const tracker = createPointerNavigationTracker(() => {
      marks += 1
    })

    tracker.pointerdown({ target: targetMatching(['.react-flow__node']) })
    tracker.pointermove({ target: targetMatching(['.react-flow__node']), buttons: 1 })
    expect(marks).toBe(0)

    tracker.pointerdown({ target: targetMatching([]) })
    tracker.pointermove({ target: targetMatching([]), buttons: 1 })
    expect(marks).toBe(2)
  })
})

function aperture(overrides: Partial<SceneApertureState> = {}): SceneApertureState {
  return {
    settled: true,
    zoomChanging: false,
    changing: false,
    navigationActive: false,
    zoomNavigationActive: false,
    ...overrides,
  }
}


describe('apertureStateForScene', () => {
  const still = { x: 0, y: 0, zoom: 1 }

  it('is settled and unchanging when the live viewport equals the settled one', () => {
    const state = apertureStateForScene({
      viewport: still,
      settledViewport: still,
      navigationActive: false,
      zoomNavigationActive: false,
    })

    expect(state).toEqual(aperture())
  })

  it('marks a pan offset as changing without zoomChanging', () => {
    const state = apertureStateForScene({
      viewport: { x: 180, y: 0, zoom: 1 },
      settledViewport: still,
      navigationActive: false,
      zoomNavigationActive: false,
    })

    expect(state.settled).toBe(false)
    expect(state.zoomChanging).toBe(false)
    expect(state.changing).toBe(true)
  })

  it('marks a zoom delta beyond jitter as zoomChanging', () => {
    const state = apertureStateForScene({
      viewport: { x: 0, y: 0, zoom: 1 },
      settledViewport: { x: 0, y: 0, zoom: 0.6 },
      navigationActive: false,
      zoomNavigationActive: false,
    })

    expect(state.zoomChanging).toBe(true)
    expect(state.changing).toBe(true)
  })

  it('treats sub-jitter zoom drift as changing but not zoomChanging (settled is exact equality)', () => {
    const state = apertureStateForScene({
      viewport: { x: 0, y: 0, zoom: 1.0005 },
      settledViewport: still,
      navigationActive: false,
      zoomNavigationActive: false,
    })

    expect(state.settled).toBe(false)
    expect(state.zoomChanging).toBe(false)
    expect(state.changing).toBe(true)
  })

  it('passes navigation input flags through untouched', () => {
    const state = apertureStateForScene({
      viewport: still,
      settledViewport: still,
      navigationActive: true,
      zoomNavigationActive: true,
    })

    expect(state.navigationActive).toBe(true)
    expect(state.zoomNavigationActive).toBe(true)
    expect(state.settled).toBe(true)
    expect(state.changing).toBe(false)
  })
})

// The #167 regression case: #158 suppressed the full-detail underlay in BOTH
// viewport states; only the settled half was ever needed. The policy must key
// on viewport MOTION, not navigation input.
describe('overviewSuppressionForScene', () => {
  const detailCardIds: ReadonlySet<string> = new Set(['a', 'b'])

  it('keeps the underlay (suppresses nothing) while a full-detail viewport moves', () => {
    const panning = overviewSuppressionForScene({
      readOnly: false,
      canRenderWholeBoardDetail: true,
      aperture: aperture({ settled: false, changing: true }),
      detailCardIds,
    })
    const zooming = overviewSuppressionForScene({
      readOnly: false,
      canRenderWholeBoardDetail: true,
      aperture: aperture({ settled: false, zoomChanging: true, changing: true }),
      detailCardIds,
    })

    expect(panning.size).toBe(0)
    expect(zooming.size).toBe(0)
  })

  it('suppresses mounted detail cards once the full-detail viewport settles', () => {
    const settled = overviewSuppressionForScene({
      readOnly: false,
      canRenderWholeBoardDetail: true,
      aperture: aperture(),
      detailCardIds,
    })

    expect(settled).toBe(detailCardIds)
  })

  it('keeps suppression while navigation input is live but the viewport is still (clicking a card)', () => {
    const clickingWhileStill = overviewSuppressionForScene({
      readOnly: false,
      canRenderWholeBoardDetail: true,
      aperture: aperture({ navigationActive: true }),
      detailCardIds,
    })

    expect(clickingWhileStill).toBe(detailCardIds)
  })

  it('never lifts suppression for read-only playback or overview scenes', () => {
    const playback = overviewSuppressionForScene({
      readOnly: true,
      canRenderWholeBoardDetail: true,
      aperture: aperture({ settled: false, changing: true }),
      detailCardIds,
    })
    const overviewScene = overviewSuppressionForScene({
      readOnly: false,
      canRenderWholeBoardDetail: false,
      aperture: aperture({ settled: false, changing: true }),
      detailCardIds,
    })

    expect(playback).toBe(detailCardIds)
    expect(overviewScene).toBe(detailCardIds)
  })
})

// Unchanged inputs must yield identity-equal outputs for every scene field, so
// scene rebuilds on dense boards cannot churn downstream selectors (#194).
describe('createBoardScene referential stability', () => {
  function expectIdenticalScenes(first: BoardScene, second: BoardScene) {
    for (const key of Object.keys(second) as (keyof BoardScene)[]) {
      expect(Object.is(second[key], first[key]), `scene.${String(key)} should be identity-equal`).toBe(true)
    }
  }

  it('keeps every field identity-equal on a small board with connections', () => {
    const cards = [note('a', 0, 0), note('b', 320, 0)]
    const connections = [connection('c-1', 'a', 'b')]
    const cardMetrics = metricsFor(cards)
    const first = plan({ cards, connections, cardMetrics, zoom: 1 })
    const second = plan({ cards, connections, cardMetrics, zoom: 1, previousScene: first })

    expectIdenticalScenes(first, second)
  })

  it('keeps every field identity-equal on a capped board with culled connections', () => {
    const cards = Array.from({ length: FULL_DETAIL_CARD_LIMIT + 80 }, (_, index) =>
      note(`card-${index}`, (index % 30) * 90, Math.floor(index / 30) * 70),
    )
    const connections = Array.from({ length: 40 }, (_, index) =>
      connection(`connection-${index}`, `card-${index}`, `card-${index + 1}`),
    )
    const cardMetrics = metricsFor(cards)
    const first = plan({ cards, connections, cardMetrics, zoom: 1 })
    const second = plan({ cards, connections, cardMetrics, zoom: 1, previousScene: first })

    expectIdenticalScenes(first, second)
  })

  it('keeps every field identity-equal on a text-heavy board', () => {
    const cards = textHeavyCards(140)
    const cardMetrics = metricsFor(cards)
    const first = plan({ cards, cardMetrics, zoom: 0.5 })
    const second = plan({ cards, cardMetrics, zoom: 0.5, previousScene: first })

    expectIdenticalScenes(first, second)
  })

  it('keeps every field identity-equal on a massive board at mid zoom and zoomed in', () => {
    const cards = massiveCards()
    const cardMetrics = metricsFor(cards)
    const midFirst = plan({ cards, cardMetrics, zoom: 0.5 })
    const midSecond = plan({ cards, cardMetrics, zoom: 0.5, previousScene: midFirst })
    const zoomedFirst = plan({ cards, cardMetrics, zoom: 0.8 })
    const zoomedSecond = plan({ cards, cardMetrics, zoom: 0.8, previousScene: zoomedFirst })

    expectIdenticalScenes(midFirst, midSecond)
    expectIdenticalScenes(zoomedFirst, zoomedSecond)
  })

  it('keeps every field identity-equal while the viewport is mid-pan', () => {
    const cards = denseCards(120)
    const cardMetrics = metricsFor(cards)
    const first = plan({ cards, cardMetrics, zoom: 1, x: 180, settledX: 0 })
    const second = plan({ cards, cardMetrics, zoom: 1, x: 180, settledX: 0, previousScene: first })

    expectIdenticalScenes(first, second)
  })
})

describe('renderLayer', () => {
  it('leaves React Flow room to raise the selected Card without reaching the editor', () => {
    // The connection editor is a menu panel that lives inside the same
    // transformed viewport as the Cards, so its place above them is only real
    // if the Card ladder ends below it. React Flow adds a fixed lift to the
    // SELECTED node on top of the layer the Board authored, and it does that
    // inside its own renderer where this function cannot see it. So the
    // ceiling has to hold for the authored layer PLUS that lift, or the one
    // Card the founder has in hand is exactly the Card that can climb over
    // the editor.
    const runaway: Card = {
      id: 'runaway',
      kind: 'note',
      blocks: [{ id: 'runaway-block', text: 'raised over and over' }],
      position: { x: 0, y: 0 },
      size: { width: 200, height: 120 },
      zIndex: 1_000_000,
    } as Card
    const authored = renderLayer(runaway, 0)
    expect(authored).toBe(CANVAS_CARD_LAYER_MAX)
    // The canvas-floating plane sits one step above the ceiling.
    expect(authored + REACT_FLOW_SELECTED_NODE_LIFT).toBeLessThanOrEqual(CANVAS_CARD_LAYER_CEILING)
  })
})
