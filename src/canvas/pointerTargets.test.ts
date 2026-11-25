import { describe, expect, it } from 'vitest'
import { graphIndexForBoard } from '../graph/graphIndex'
import type { Card, Connection } from '../graph/types'
import {
  samePointerTarget,
  nearestSceneCardAtClientPoint,
  type CanvasPointerTarget,
} from './boardScene'
import {
  canvasPointerTargetAtClientPoint,
  connectionRulesAllow,
  createCanvasHoverTracker,
  paintedPortsHittable,
  stableParticipantIdSet,
  type CanvasPointerPoint,
} from './pointerTargets'

function note(id: string, x: number, y: number, extra: Partial<Card> = {}): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: id }],
    position: { x, y },
    ...extra,
  } as Card
}

function last<T>(items: readonly T[]): T {
  return items[items.length - 1]
}

function connectionGraph(cards: Card[], connections: Connection[]) {
  return graphIndexForBoard({ cards, connections, outputs: [], runs: [] })
}

// Default note renders 260x180 (renderPlanning). Viewport at origin, zoom 1:
// board coordinates are screen coordinates.
const VIEWPORT = { x: 0, y: 0, zoom: 1 }
const RECT = { left: 0, top: 0 }

describe('canvasPointerTargetAtClientPoint', () => {
  const cards = [note('a', 0, 0), note('b', 400, 0)]

  it('resolves the card body under the pointer', () => {
    const target = canvasPointerTargetAtClientPoint({
      candidates: cards,
      viewport: VIEWPORT,
      viewportRect: RECT,
      clientX: 130,
      clientY: 90,
      band: 'map',
    })
    expect(target).toEqual({ kind: 'card-body', cardId: 'a' })
  })

  it('resolves none on empty pane', () => {
    const target = canvasPointerTargetAtClientPoint({
      candidates: cards,
      viewport: VIEWPORT,
      viewportRect: RECT,
      clientX: 320,
      clientY: 400,
      band: 'map',
    })
    expect(target).toEqual({ kind: 'none' })
  })

  it('resolves ports at their painted discs; Reading ports are DOM handles', () => {
    // Right edge midpoint of card a: (260, 90) — the source port disc.
    const onSourcePort = { clientX: 259, clientY: 90 }
    const overview = canvasPointerTargetAtClientPoint({
      candidates: cards,
      viewport: VIEWPORT,
      viewportRect: RECT,
      ...onSourcePort,
      band: 'overview',
    })
    expect(overview).toEqual({ kind: 'card-port', cardId: 'a', port: 'source' })

    // Reading's ports are real DOM handles on mounted cards — the canvas
    // resolver never answers 'card-port' there.
    const reading = canvasPointerTargetAtClientPoint({
      candidates: cards,
      viewport: VIEWPORT,
      viewportRect: RECT,
      ...onSourcePort,
      band: 'reading',
    })
    expect(reading).toEqual({ kind: 'card-body', cardId: 'a' })
  })

  it('port-vs-body: outside the painted disc radius the same edge is body', () => {
    // On the right edge but 20px above the midpoint: within the proxy's
    // oversized DOM handle, outside the 4px painted disc — body, not port.
    const target = canvasPointerTargetAtClientPoint({
      candidates: cards,
      viewport: VIEWPORT,
      viewportRect: RECT,
      clientX: 259,
      clientY: 70,
      band: 'overview',
    })
    expect(target).toEqual({ kind: 'card-body', cardId: 'a' })
  })

  it('painted ports are hittable in every canvas-painted band (#320 amendment 9)', () => {
    // The painter draws discs on every painted representation — Map and
    // Overview alike (the epic's port-floor decision) — so hit truth is
    // simply "the band paints canvas cards": everything below Reading.
    // There is no crossfade-window carve-out and no threshold constant to
    // drift from the painter's.
    expect(paintedPortsHittable('map')).toBe(true)
    expect(paintedPortsHittable('overview')).toBe(true)
    // Reading keeps DOM handles on mounted cards; canvas ports never arm.
    expect(paintedPortsHittable('reading')).toBe(false)

    // End to end through the resolver: the disc point resolves card-port at
    // Map zooms above, inside, and below the old crossfade window.
    const discPoint = (zoom: number) => ({
      candidates: cards,
      viewport: { x: 0, y: 0, zoom },
      viewportRect: RECT,
      clientX: 260 * zoom,
      clientY: 90 * zoom,
    })
    for (const zoom of [0.14, 0.12, 0.06]) {
      expect(canvasPointerTargetAtClientPoint({ ...discPoint(zoom), band: 'map' })).toEqual({
        kind: 'card-port',
        cardId: 'a',
        port: 'source',
      })
    }
  })

  it('resolves a port hit just OUTSIDE the card rect (disc centred on the edge)', () => {
    const target = canvasPointerTargetAtClientPoint({
      candidates: cards,
      viewport: VIEWPORT,
      viewportRect: RECT,
      clientX: 262,
      clientY: 90,
      band: 'overview',
    })
    expect(target).toEqual({ kind: 'card-port', cardId: 'a', port: 'source' })
  })

  it('hit-tests the same last measured footprint that Overview and Map paint', () => {
    const tall = note('tall', 0, 0)
    const measuredCardSizeById = (cardId: string) =>
      cardId === tall.id ? { width: 260, height: 1_200 } : undefined

    expect(
      canvasPointerTargetAtClientPoint({
        candidates: [tall],
        viewport: VIEWPORT,
        viewportRect: RECT,
        clientX: 130,
        clientY: 600,
        band: 'overview',
        measuredCardSizeById,
      }),
    ).toEqual({ kind: 'card-body', cardId: 'tall' })

    expect(
      canvasPointerTargetAtClientPoint({
        candidates: [tall],
        viewport: VIEWPORT,
        viewportRect: RECT,
        clientX: 260,
        clientY: 600,
        band: 'overview',
        measuredCardSizeById,
      }),
    ).toEqual({ kind: 'card-port', cardId: 'tall', port: 'source' })
  })
})

describe('nearestSceneCardAtClientPoint', () => {
  const cards = [note('a', 0, 0), note('b', 400, 0)]

  it('returns the contained card at distance zero', () => {
    const hit = nearestSceneCardAtClientPoint({
      candidates: cards,
      viewport: VIEWPORT,
      viewportRect: RECT,
      clientX: 100,
      clientY: 100,
      leadRadiusPx: 48,
    })
    expect(hit?.card.id).toBe('a')
    expect(hit?.distance).toBe(0)
  })

  it('returns the nearest card within the lead radius before contact', () => {
    // 30px right of card a's right edge (260), 110px left of card b (400).
    const hit = nearestSceneCardAtClientPoint({
      candidates: cards,
      viewport: VIEWPORT,
      viewportRect: RECT,
      clientX: 290,
      clientY: 90,
      leadRadiusPx: 48,
    })
    expect(hit?.card.id).toBe('a')
    expect(hit?.distance).toBe(30)
  })

  it('returns null past the lead radius', () => {
    const hit = nearestSceneCardAtClientPoint({
      candidates: cards,
      viewport: VIEWPORT,
      viewportRect: RECT,
      clientX: 330,
      clientY: 90,
      leadRadiusPx: 48,
    })
    expect(hit).toBeNull()
  })

  it('breaks overlap ties by render layer like the containment hit test', () => {
    const under = note('under', 0, 0, { zIndex: 1 })
    const over = note('over', 100, 40, { zIndex: 5 })
    const hit = nearestSceneCardAtClientPoint({
      candidates: [over, under],
      viewport: VIEWPORT,
      viewportRect: RECT,
      clientX: 120,
      clientY: 60,
      leadRadiusPx: 48,
    })
    expect(hit?.card.id).toBe('over')
  })
})

describe('samePointerTarget', () => {
  it('compares structurally per kind', () => {
    const body = (cardId: string): CanvasPointerTarget => ({ kind: 'card-body', cardId })
    expect(samePointerTarget({ kind: 'none' }, { kind: 'none' })).toBe(true)
    expect(samePointerTarget(body('a'), body('a'))).toBe(true)
    expect(samePointerTarget(body('a'), body('b'))).toBe(false)
    expect(samePointerTarget(body('a'), { kind: 'none' })).toBe(false)
    expect(
      samePointerTarget(
        { kind: 'card-port', cardId: 'a', port: 'source' },
        { kind: 'card-port', cardId: 'a', port: 'target' },
      ),
    ).toBe(false)
    expect(
      samePointerTarget(
        { kind: 'connection-badge', connectionId: 'c1' },
        { kind: 'connection-badge', connectionId: 'c1' },
      ),
    ).toBe(true)
  })
})

describe('stableParticipantIdSet', () => {
  it('returns the previous instance when membership is unchanged', () => {
    const previous: ReadonlySet<string> = new Set(['a'])
    expect(stableParticipantIdSet(previous, ['a'])).toBe(previous)
  })

  it('returns a new instance when membership changes', () => {
    const previous: ReadonlySet<string> = new Set(['a'])
    const next = stableParticipantIdSet(previous, ['b'])
    expect(next).not.toBe(previous)
    expect([...next]).toEqual(['b'])
  })

  it('collapses empty results to one shared empty instance', () => {
    const emptyA = stableParticipantIdSet(new Set(['a']), [])
    const emptyB = stableParticipantIdSet(new Set(['b']), [])
    expect(emptyA).toBe(emptyB)
    expect(emptyA.size).toBe(0)
  })
})

type TrackerHarness = {
  moves: (point: CanvasPointerPoint | null) => void
  hoverChanges: (string | null)[]
  participantChanges: ReadonlySet<string>[]
  targetChanges: CanvasPointerTarget[]
  tracker: ReturnType<typeof createCanvasHoverTracker>
  fireTimers: () => void
  pendingTimers: () => number
}

function trackerHarness(lingerMs = 250): TrackerHarness {
  let point: CanvasPointerPoint | null = null
  const hoverChanges: (string | null)[] = []
  const participantChanges: ReadonlySet<string>[] = []
  const targetChanges: CanvasPointerTarget[] = []
  const timers = new Map<number, () => void>()
  let nextTimer = 1
  const tracker = createCanvasHoverTracker({
    resolvePoint: () => point,
    onHoveredCardChange: (id) => hoverChanges.push(id),
    onParticipantIdsChange: (ids) => participantChanges.push(ids),
    onPointerTargetChange: (target) => targetChanges.push(target),
    lingerMs,
    setTimeoutFn: (fn) => {
      const handle = nextTimer++
      timers.set(handle, fn)
      return handle
    },
    clearTimeoutFn: (handle) => {
      timers.delete(handle)
    },
  })
  return {
    moves: (nextPoint) => {
      point = nextPoint
      tracker.pointerMove(0, 0)
    },
    hoverChanges,
    participantChanges,
    targetChanges,
    tracker,
    fireTimers: () => {
      const pending = [...timers.values()]
      timers.clear()
      for (const fn of pending) fn()
    },
    pendingTimers: () => timers.size,
  }
}

const overCard = (cardId: string): CanvasPointerPoint => ({
  target: { kind: 'card-body', cardId },
  leadCardId: cardId,
})
const nearCard = (cardId: string): CanvasPointerPoint => ({
  target: { kind: 'none' },
  leadCardId: cardId,
})
const farFromCards: CanvasPointerPoint = { target: { kind: 'none' }, leadCardId: null }

describe('createCanvasHoverTracker', () => {
  it('participant set is identity-stable across pointermoves with an unchanged target', () => {
    const h = trackerHarness()
    h.moves(overCard('a'))
    expect(h.participantChanges).toHaveLength(1)
    expect([...h.participantChanges[0]]).toEqual(['a'])

    // A pointer storm inside the same card: no further callbacks — neither a
    // fresh Set instance nor a redundant same-value call reaches React.
    for (let index = 0; index < 200; index += 1) h.moves(overCard('a'))
    expect(h.participantChanges).toHaveLength(1)
    expect(h.hoverChanges).toEqual(['a'])
  })

  it('mounts the lead card before contact and hovers only on contact', () => {
    const h = trackerHarness()
    h.moves(nearCard('a'))
    expect(h.hoverChanges).toEqual([])
    expect(h.participantChanges).toHaveLength(1)
    h.moves(overCard('a'))
    expect(h.hoverChanges).toEqual(['a'])
    expect(h.participantChanges).toHaveLength(1)
  })

  it('lingers after the pointer leaves the lead radius, then drops the participant', () => {
    const h = trackerHarness()
    h.moves(overCard('a'))
    h.moves(farFromCards)
    expect(h.hoverChanges).toEqual(['a', null])
    // Still mounted during the linger window.
    expect(h.participantChanges).toHaveLength(1)
    expect(h.pendingTimers()).toBe(1)
    h.fireTimers()
    expect(h.participantChanges).toHaveLength(2)
    expect(h.participantChanges[1].size).toBe(0)
  })

  it('cancels the linger when the pointer returns within the window', () => {
    const h = trackerHarness()
    h.moves(overCard('a'))
    h.moves(farFromCards)
    h.moves(overCard('a'))
    expect(h.pendingTimers()).toBe(0)
    h.fireTimers()
    expect(h.participantChanges).toHaveLength(1)
  })

  it('swaps the participant immediately when a new lead card wins', () => {
    const h = trackerHarness()
    h.moves(overCard('a'))
    h.moves(overCard('b'))
    expect(h.participantChanges).toHaveLength(2)
    expect([...h.participantChanges[1]]).toEqual(['b'])
    expect(h.hoverChanges).toEqual(['a', 'b'])
  })

  it('freezes target and participants for the duration of a press gesture', () => {
    const h = trackerHarness()
    h.moves(overCard('a'))
    h.tracker.pointerDown()
    // A drag can outrun the node or cross other cards: no retarget, no drop.
    h.moves(overCard('b'))
    h.moves(farFromCards)
    h.fireTimers()
    expect(h.participantChanges).toHaveLength(1)
    expect(h.hoverChanges).toEqual(['a'])
    h.tracker.pointerUp()
    h.moves(overCard('b'))
    expect([...h.participantChanges[1]]).toEqual(['b'])
  })

  it('ignores moves when the canvas is not hover-authoritative (Reading band)', () => {
    const h = trackerHarness()
    h.moves(overCard('a'))
    h.moves(null)
    expect(h.hoverChanges).toEqual(['a'])
    expect(h.participantChanges).toHaveLength(1)
  })

  it('clears hover on pointer leave and lingers the participant', () => {
    const h = trackerHarness()
    h.moves(overCard('a'))
    h.tracker.pointerLeave()
    expect(h.hoverChanges).toEqual(['a', null])
    expect(h.participantChanges).toHaveLength(1)
    h.fireTimers()
    expect(h.participantChanges).toHaveLength(2)
  })

  it('reports pointer-target transitions once for the port-arming seam', () => {
    const h = trackerHarness()
    const onPort: CanvasPointerPoint = {
      target: { kind: 'card-port', cardId: 'a', port: 'source' },
      leadCardId: 'a',
    }
    h.moves(overCard('a'))
    h.moves(onPort)
    for (let index = 0; index < 50; index += 1) h.moves(onPort)
    h.tracker.pointerLeave()
    expect(h.targetChanges).toEqual([
      { kind: 'card-body', cardId: 'a' },
      { kind: 'card-port', cardId: 'a', port: 'source' },
      { kind: 'none' },
    ])
  })
})

describe('createCanvasHoverTracker connect mode (C3, #320)', () => {
  const sourcePort: CanvasPointerPoint = {
    target: { kind: 'card-port', cardId: 'src', port: 'source' },
    leadCardId: 'src',
  }

  function startConnect(h: TrackerHarness) {
    h.moves(sourcePort)
    h.tracker.pointerDown()
    h.tracker.connectStart('src')
  }

  it('freezes the source as the first participant for the whole gesture', () => {
    const h = trackerHarness()
    startConnect(h)
    expect([...last(h.participantChanges)]).toEqual(['src'])
    // Moving off every card mid-drag never drops the source.
    h.moves(farFromCards)
    h.fireTimers()
    expect([...last(h.participantChanges)]).toEqual(['src'])
  })

  it('lead-mounts the candidate target and stays identity-stable within the same pair', () => {
    const h = trackerHarness()
    startConnect(h)
    h.moves(nearCard('tgt'))
    const pair = last(h.participantChanges)
    expect([...pair]).toEqual(['src', 'tgt'])
    // A pointer storm within the same pair: the SAME set instance, zero
    // further callbacks — the mount plan memo never re-runs.
    const callbacks = h.participantChanges.length
    for (let index = 0; index < 200; index += 1) h.moves(overCard('tgt'))
    expect(h.participantChanges).toHaveLength(callbacks)
    expect(last(h.participantChanges)).toBe(pair)
  })

  it('replaces only the second participant when the candidate changes; never exceeds two', () => {
    const h = trackerHarness()
    startConnect(h)
    h.moves(nearCard('tgt-a'))
    h.moves(nearCard('tgt-b'))
    expect([...last(h.participantChanges)]).toEqual(['src', 'tgt-b'])
    // The source stays the first entry through every candidate swap, and the
    // set never holds more than the two gesture ends.
    for (const ids of h.participantChanges) {
      expect(ids.size).toBeLessThanOrEqual(2)
      if (ids.size) expect([...ids][0]).toBe('src')
    }
  })

  it('keeps hover and the armed port frozen during the gesture', () => {
    const h = trackerHarness()
    startConnect(h)
    const hoverCount = h.hoverChanges.length
    const targetCount = h.targetChanges.length
    h.moves(overCard('tgt'))
    h.moves(farFromCards)
    expect(h.hoverChanges).toHaveLength(hoverCount)
    expect(h.targetChanges).toHaveLength(targetCount)
  })

  it('a hovered source card is its own lead, not a candidate', () => {
    const h = trackerHarness()
    startConnect(h)
    h.moves(overCard('src'))
    expect([...last(h.participantChanges)]).toEqual(['src'])
  })

  it('connect end over a card collapses the participants to that lead', () => {
    const h = trackerHarness()
    startConnect(h)
    h.moves(nearCard('tgt'))
    h.tracker.pointerUp()
    h.moves(overCard('tgt'))
    h.tracker.connectEnd(0, 0)
    expect([...last(h.participantChanges)]).toEqual(['tgt'])
    expect(last(h.hoverChanges)).toBe('tgt')
  })

  it('cancelling over empty pane clears the participants after the linger', () => {
    const h = trackerHarness()
    startConnect(h)
    h.moves(nearCard('tgt'))
    h.tracker.pointerUp()
    h.moves(farFromCards)
    h.tracker.connectEnd(0, 0)
    h.fireTimers()
    expect(last(h.participantChanges).size).toBe(0)
  })

  it('a fresh press ends a stale connect gesture', () => {
    const h = trackerHarness()
    startConnect(h)
    h.tracker.pointerUp()
    h.tracker.pointerDown()
    h.tracker.pointerUp()
    h.moves(overCard('other'))
    expect([...last(h.participantChanges)]).toEqual(['other'])
  })
})

describe('connectionRulesAllow (C3, #320 — graph rules only, no DOM, no proxies)', () => {
  const feeds = (id: string, from: string, to: string, role: Connection['role'] = 'feeds'): Connection => ({
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role,
  })
  const ask = (id: string): Card => ({ ...note(id, 0, 0), kind: 'askAi' }) as Card
  const result = (id: string): Card => ({ ...note(id, 0, 0), kind: 'result' }) as Card
  const title = (id: string): Card => ({ ...note(id, 0, 0), kind: 'title' }) as Card

  it('rejects source === target', () => {
    expect(connectionRulesAllow(connectionGraph([note('a', 0, 0)], []), 'a', 'a')).toBe(false)
  })

  it('rejects unresolvable endpoints', () => {
    expect(connectionRulesAllow(connectionGraph([note('a', 0, 0)], []), 'a', 'ghost')).toBe(false)
  })

  it('rejects unconnectable kinds (titles are labels, not thought)', () => {
    expect(
      connectionRulesAllow(connectionGraph([note('a', 0, 0), title('t')], []), 'a', 't'),
    ).toBe(false)
  })

  it('accepts a valid new pair and rejects the existing duplicate — directionally, like the store', () => {
    const cards = [note('a', 0, 0), note('b', 400, 0)]
    const connections = [feeds('c1', 'a', 'b')]
    expect(connectionRulesAllow(connectionGraph(cards, connections), 'a', 'b')).toBe(false)
    // The reverse pair is a DIFFERENT connection under the store's
    // directional duplicate rule (it decides second-hop flow) — still valid.
    expect(connectionRulesAllow(connectionGraph(cards, connections), 'b', 'a')).toBe(true)
    expect(
      connectionRulesAllow(connectionGraph([...cards, note('c', 800, 0)], connections), 'c', 'a'),
    ).toBe(true)
  })

  it('applies the store auto-orient before the duplicate check (ADR 0017)', () => {
    // note → askAi stores as note→askAi (askAi consumes). Dragging askAi→note
    // auto-orients to the SAME stored direction, so it duplicates too.
    const cards = [note('n', 0, 0), ask('q')]
    const connections = [feeds('c1', 'n', 'q')]
    expect(connectionRulesAllow(connectionGraph(cards, connections), 'n', 'q')).toBe(false)
    expect(connectionRulesAllow(connectionGraph(cards, connections), 'q', 'n')).toBe(false)
  })

  it('question→question duplicates only when the routed Result leg exists', () => {
    const cards = [ask('q1'), ask('q2'), result('r1')]
    const producing = feeds('c1', 'q1', 'r1')
    // No routed leg yet: the store would create it — valid.
    expect(
      connectionRulesAllow(connectionGraph(cards, [producing]), 'q1', 'q2'),
    ).toBe(true)
    // Routed leg exists: the store returns without a commit — duplicate.
    expect(
      connectionRulesAllow(
        connectionGraph(cards, [producing, feeds('c2', 'r1', 'q2')]),
        'q1',
        'q2',
      ),
    ).toBe(false)
  })
})
