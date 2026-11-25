// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { Card, Connection } from '../graph/types'
import {
  type BoardResizeTerminalState,
  cardWithResizeHotGeometry,
  createBoardResizeTerminalCoordinator,
  createBoardResizeHotGeometryStore,
  createBoardResizeOuterFramePin,
  reactFlowNodeMatchesResize,
  resizeEndpointCenter,
  resizeHotCardById,
} from './boardResizeHotGeometry'

const start = {
  position: { x: 100, y: 80 },
  size: { width: 260, height: 180 },
}
const preview = {
  position: { x: 60, y: 50 },
  size: { width: 300, height: 210 },
}
const fractionalTerminal = {
  position: { x: 31_500, y: 4_750 },
  size: { width: 312.4615009014423, height: 214.6153846153846 },
}

const terminalEndpointOffsets = {
  source: { x: -1.1899, y: -0.1878 },
  target: { x: 0.8113, y: -0.1878 },
}

const terminalActualOffsets = {
  source: { x: -1.19648, y: -0.19832 },
  target: { x: 0.8113, y: -0.19832 },
}

type ReactFlowResizeHandleFixture = {
  x: number
  y: number
  width: number
  height: number
  position: string
}

type ReactFlowResizeNodeFixture = {
  measured: { width?: number; height?: number }
  internals: {
    positionAbsolute: { x: number; y: number }
    handleBounds: {
      source: ReactFlowResizeHandleFixture[] | null
      target: ReactFlowResizeHandleFixture[] | null
    }
  }
}

function matchingReactFlowNode(
  geometry: typeof fractionalTerminal,
  measured: { width?: number; height?: number } = { width: 312, height: 215 },
  actualOffsets = terminalActualOffsets,
): ReactFlowResizeNodeFixture {
  const handleSize = 15
  return {
    measured,
    internals: {
      positionAbsolute: { ...geometry.position },
      handleBounds: {
        source: [{
          x: geometry.size.width + actualOffsets.source.x - handleSize / 2,
          y: geometry.size.height / 2 + actualOffsets.source.y - handleSize / 2,
          width: handleSize,
          height: handleSize,
          position: 'right',
        }],
        target: [{
          x: actualOffsets.target.x - handleSize / 2,
          y: geometry.size.height / 2 + actualOffsets.target.y - handleSize / 2,
          width: handleSize,
          height: handleSize,
          position: 'left',
        }],
      },
    },
  }
}

function publishTerminal(
  store: ReturnType<typeof createBoardResizeHotGeometryStore>,
  sessionId = 1,
  geometry = preview,
  endpointOffsets?: typeof terminalEndpointOffsets,
) {
  store.receive(
    'source',
    { type: 'begin', sessionId, geometry: start },
    endpointOffsets ? { endpointOffsets } : undefined,
  )
  store.receive('source', { type: 'preview', sessionId, geometry })
  store.receive('source', { type: 'commit', sessionId, geometry })
}

function terminalCoordinatorHarness({
  initialState,
  stableFrames = 2,
  maxFrames = 3,
  initialTerminal = false,
}: {
  initialState: BoardResizeTerminalState
  stableFrames?: number
  maxFrames?: number
  initialTerminal?: boolean
}) {
  const store = createBoardResizeHotGeometryStore()
  if (initialTerminal) publishTerminal(store)
  let state = initialState
  let nextFrameId = 1
  const scheduled = new Map<number, () => void>()
  const requestFrame = vi.fn((callback: () => void) => {
    const frameId = nextFrameId
    nextFrameId += 1
    scheduled.set(frameId, callback)
    return frameId
  })
  const cancelFrame = vi.fn((frameId: number) => scheduled.delete(frameId))
  const stateListeners = new Set<() => void>()
  const unsubscribeState = vi.fn((listener: () => void) => stateListeners.delete(listener))
  const subscribeState = vi.fn((listener: () => void) => {
    stateListeners.add(listener)
    return () => unsubscribeState(listener)
  })
  const acknowledge = vi.fn((cardId: string, sessionId: number) => {
    store.acknowledge(cardId, sessionId)
  })
  const onTimeout = vi.fn()
  const coordinator = createBoardResizeTerminalCoordinator({
    store,
    readState: () => state,
    acknowledge,
    requestFrame,
    cancelFrame,
    subscribeState,
    stableFrames,
    maxFrames,
    onTimeout,
  })
  return {
    store,
    coordinator,
    scheduled,
    requestFrame,
    cancelFrame,
    acknowledge,
    onTimeout,
    subscribeState,
    unsubscribeState,
    flushFrame() {
      const next = scheduled.entries().next().value as [number, () => void] | undefined
      if (!next) throw new Error('No terminal reconciliation frame scheduled')
      scheduled.delete(next[0])
      next[1]()
    },
    setState(next: BoardResizeTerminalState) {
      state = next
    },
    emitState() {
      for (const listener of stateListeners) listener()
    },
  }
}

describe('Board resize hot geometry', () => {
  it.each([
    ['left', { x: 100, y: 170 }],
    ['top', { x: 230, y: 80 }],
    ['right', { x: 360, y: 170 }],
    ['bottom', { x: 230, y: 260 }],
  ] as const)('derives the shared %s endpoint center', (position, expected) => {
    expect(resizeEndpointCenter(position, start)).toEqual(expected)
  })

  it('keeps a stationary begin private until the first visual frame publishes', () => {
    const store = createBoardResizeHotGeometryStore()

    store.receive('source', { type: 'begin', sessionId: 7, geometry: start })
    expect(store.getSnapshot()).toBeNull()
    expect(store.getCardSnapshot('source')).toBeNull()

    store.receive('source', { type: 'preview', sessionId: 7, geometry: preview })
    expect(store.getSnapshot()).toMatchObject({ cardId: 'source', geometry: preview })
    expect(store.getCardSnapshot('source')).toMatchObject({ cardId: 'source', geometry: preview })
  })

  it('notifies only the canvas and the active Card key on each published frame', () => {
    const store = createBoardResizeHotGeometryStore()
    const canvas = vi.fn()
    const incident = vi.fn()
    const unrelated = Array.from({ length: 512 }, () => vi.fn())
    store.subscribe(canvas)
    store.subscribeCard('source', incident)
    unrelated.forEach((listener, index) => store.subscribeCard(`unrelated-${index}`, listener))

    store.receive('source', { type: 'begin', sessionId: 7, geometry: start })
    expect({ canvas: canvas.mock.calls.length, incident: incident.mock.calls.length }).toEqual({
      canvas: 0,
      incident: 0,
    })

    store.receive('source', { type: 'preview', sessionId: 7, geometry: preview })
    expect({ canvas: canvas.mock.calls.length, incident: incident.mock.calls.length }).toEqual({
      canvas: 1,
      incident: 1,
    })
    expect(unrelated.reduce((calls, listener) => calls + listener.mock.calls.length, 0)).toBe(0)

    store.receive('source', { type: 'commit', sessionId: 7, geometry: preview })
    store.acknowledge('source', 6)
    expect({ canvas: canvas.mock.calls.length, incident: incident.mock.calls.length }).toEqual({
      canvas: 2,
      incident: 2,
    })
    store.acknowledge('source', 7)
    expect({ canvas: canvas.mock.calls.length, incident: incident.mock.calls.length }).toEqual({
      canvas: 3,
      incident: 3,
    })
    expect(unrelated.reduce((calls, listener) => calls + listener.mock.calls.length, 0)).toBe(0)
  })

  it('ignores a delayed terminal event from an older session', () => {
    const store = createBoardResizeHotGeometryStore()
    const canvas = vi.fn()
    const incident = vi.fn()
    store.subscribe(canvas)
    store.subscribeCard('source', incident)
    store.receive('source', { type: 'begin', sessionId: 1, geometry: start })
    store.receive('source', { type: 'preview', sessionId: 1, geometry: preview })
    store.receive('source', { type: 'begin', sessionId: 2, geometry: start })
    store.receive('source', { type: 'preview', sessionId: 2, geometry: preview })
    const sessionTwoFrame = store.getSnapshot()
    const notificationCounts = {
      canvas: canvas.mock.calls.length,
      incident: incident.mock.calls.length,
    }

    for (const staleEvent of [
      { type: 'preview' as const, sessionId: 1, geometry: start },
      { type: 'commit' as const, sessionId: 1, geometry: start },
      { type: 'abort' as const, sessionId: 1 },
    ]) {
      store.receive('source', staleEvent)
      expect(store.getSnapshot()).toBe(sessionTwoFrame)
      expect({
        canvas: canvas.mock.calls.length,
        incident: incident.mock.calls.length,
      }).toEqual(notificationCounts)
    }
  })

  it('keeps a settling terminal visual through a stationary superseding session', () => {
    const store = createBoardResizeHotGeometryStore()
    const canvas = vi.fn()
    const incident = vi.fn()
    store.subscribe(canvas)
    store.subscribeCard('source', incident)
    store.receive('source', { type: 'begin', sessionId: 1, geometry: start })
    store.receive('source', { type: 'preview', sessionId: 1, geometry: preview })
    store.receive('source', { type: 'commit', sessionId: 1, geometry: preview })
    const terminal = store.getSnapshot()
    const notifications = {
      canvas: canvas.mock.calls.length,
      incident: incident.mock.calls.length,
    }

    store.receive('source', { type: 'begin', sessionId: 2, geometry: preview })
    expect(store.getSnapshot()).toBe(terminal)
    expect({ canvas: canvas.mock.calls.length, incident: incident.mock.calls.length }).toEqual(notifications)

    store.receive('source', { type: 'abort', sessionId: 2 })
    expect(store.getSnapshot()).toBe(terminal)
    expect({ canvas: canvas.mock.calls.length, incident: incident.mock.calls.length }).toEqual(notifications)

    // React Flow eventually reconciling session one's graph-final geometry is
    // the safe point at which the retained visual may disappear.
    store.acknowledge('source', 1)
    expect(store.getSnapshot()).toBeNull()
    expect({ canvas: canvas.mock.calls.length, incident: incident.mock.calls.length }).toEqual({
      canvas: notifications.canvas + 1,
      incident: notifications.incident + 1,
    })
  })

  it('atomically replaces a retained terminal visual when the new session publishes', () => {
    const store = createBoardResizeHotGeometryStore()
    const canvas = vi.fn()
    store.subscribe(canvas)
    store.receive('source', { type: 'begin', sessionId: 1, geometry: start })
    store.receive('source', { type: 'preview', sessionId: 1, geometry: preview })
    store.receive('source', { type: 'commit', sessionId: 1, geometry: preview })
    const callsBeforeBegin = canvas.mock.calls.length

    store.receive('source', { type: 'begin', sessionId: 2, geometry: preview })
    expect(canvas).toHaveBeenCalledTimes(callsBeforeBegin)

    const secondPreview = {
      position: preview.position,
      size: { width: 340, height: 240 },
    }
    store.receive('source', { type: 'preview', sessionId: 2, geometry: secondPreview })
    expect(store.getSnapshot()).toMatchObject({
      sessionId: 2,
      phase: 'active',
      geometry: secondPreview,
    })
    expect(canvas).toHaveBeenCalledTimes(callsBeforeBegin + 1)
  })

  it('restores the retained terminal visual when a superseding preview aborts', () => {
    const store = createBoardResizeHotGeometryStore()
    const canvas = vi.fn()
    store.subscribe(canvas)
    store.receive('source', { type: 'begin', sessionId: 1, geometry: start })
    store.receive('source', { type: 'preview', sessionId: 1, geometry: preview })
    store.receive('source', { type: 'commit', sessionId: 1, geometry: preview })
    const terminal = store.getSnapshot()
    store.receive('source', { type: 'begin', sessionId: 2, geometry: preview })
    store.receive('source', {
      type: 'preview',
      sessionId: 2,
      geometry: { position: preview.position, size: { width: 340, height: 240 } },
    })

    store.receive('source', { type: 'abort', sessionId: 2 })

    expect(store.getSnapshot()).toBe(terminal)
    const callsAfterRestore = canvas.mock.calls.length

    // S1 visual ownership may be retained, but S1 input ownership was
    // superseded forever. Delayed browser events from it can never mutate the
    // restored bridge or re-enter active/settling state.
    store.receive('source', { type: 'preview', sessionId: 1, geometry: start })
    store.receive('source', { type: 'commit', sessionId: 1, geometry: start })
    expect(store.getSnapshot()).toBe(terminal)
    expect(canvas).toHaveBeenCalledTimes(callsAfterRestore)

    // Reconciliation/deletion retires terminal ownership explicitly; it does
    // not reopen the superseded gesture ingress just to clear the visual.
    store.acknowledge('source', 1)
    expect(store.getSnapshot()).toBeNull()
  })

  it('restores the depth-one captured paint authority with its terminal visual', () => {
    const store = createBoardResizeHotGeometryStore()
    const link: Connection = {
      id: 'source-target',
      from: { cardId: 'source' },
      to: { cardId: 'target' },
      strength: 'strong',
      polarity: 'helps',
      role: 'feeds',
    }
    const first = [{
      connection: link,
      sourceX: 300,
      sourceY: 140,
      targetX: 600,
      targetY: 140,
      curve: 108,
    }]
    const second = [{ ...first[0], sourceX: 340 }]

    store.receive('source', { type: 'begin', sessionId: 1, geometry: start })
    store.capturePaintedConnections('source', 1, first)
    store.receive('source', { type: 'preview', sessionId: 1, geometry: preview })
    store.receive('source', { type: 'commit', sessionId: 1, geometry: preview })
    store.receive('source', { type: 'begin', sessionId: 2, geometry: preview })
    store.capturePaintedConnections('source', 2, second)
    store.receive('source', {
      type: 'preview',
      sessionId: 2,
      geometry: { position: preview.position, size: { width: 340, height: 240 } },
    })

    store.receive('source', { type: 'abort', sessionId: 2 })

    expect(store.getPaintedConnectionsSnapshot('source', 1)?.connections).toBe(first)
    expect(store.getPaintedConnectionsSnapshot('source', 2)).toBeNull()
    first[0].sourceX = 375
    expect(store.getPaintedConnectionsSnapshot('source', 1)?.connections[0].sourceX).toBe(375)
    store.acknowledge('source', 1)
    expect(store.getPaintedConnectionsSnapshot('source', 1)).toBeNull()
  })

  it('restarts terminal reconciliation after a previewing successor aborts without a graph change', () => {
    const store = createBoardResizeHotGeometryStore()
    const scheduled = new Map<number, () => void>()
    let nextFrameId = 1
    const requestFrame = vi.fn((callback: () => void) => {
      const frameId = nextFrameId
      nextFrameId += 1
      scheduled.set(frameId, callback)
      return frameId
    })
    const cancelFrame = vi.fn((frameId: number) => scheduled.delete(frameId))
    const flushFrame = () => {
      const frame = [...scheduled.entries()][0]
      if (!frame) throw new Error('No terminal reconciliation frame scheduled')
      scheduled.delete(frame[0])
      frame[1]()
    }
    let nodeState: 'matching' | 'mismatching' = 'mismatching'
    const acknowledge = vi.fn((cardId: string, sessionId: number) => {
      store.acknowledge(cardId, sessionId)
    })
    const terminalSignals = vi.fn()
    store.subscribeTerminal(terminalSignals)
    const coordinator = createBoardResizeTerminalCoordinator({
      store,
      readState: () => ({ graph: 'matching', node: nodeState }),
      acknowledge,
      requestFrame,
      cancelFrame,
      stableFrames: 2,
      maxFrames: 4,
    })

    store.receive('source', { type: 'begin', sessionId: 1, geometry: start })
    store.receive('source', { type: 'preview', sessionId: 1, geometry: preview })
    store.receive('source', { type: 'commit', sessionId: 1, geometry: preview })
    expect(terminalSignals).toHaveBeenCalledTimes(1)
    expect(requestFrame).toHaveBeenCalledTimes(1)
    flushFrame()

    // S2 previews do not wake Board/coordinator. The already-scheduled S1
    // poll observes that it lost visual ownership and exits.
    store.receive('source', { type: 'begin', sessionId: 2, geometry: preview })
    store.receive('source', {
      type: 'preview',
      sessionId: 2,
      geometry: { position: preview.position, size: { width: 340, height: 240 } },
    })
    store.receive('source', {
      type: 'preview',
      sessionId: 2,
      geometry: { position: preview.position, size: { width: 360, height: 250 } },
    })
    expect(terminalSignals).toHaveBeenCalledTimes(1)
    flushFrame()
    expect(scheduled.size).toBe(0)

    // Returning to S2's start aborts without touching graph/cards. Restoring
    // S1 emits one terminal-only signal and starts a fresh reconciliation.
    store.receive('source', { type: 'abort', sessionId: 2 })
    expect(terminalSignals).toHaveBeenCalledTimes(2)
    expect(requestFrame).toHaveBeenCalledTimes(3)
    nodeState = 'matching'
    flushFrame()
    flushFrame()
    expect(acknowledge).toHaveBeenCalledWith('source', 1)
    expect(store.getSnapshot()).toBeNull()

    // S1 remains retired forever, and later authoritative geometry is cold.
    store.receive('source', { type: 'preview', sessionId: 1, geometry: start })
    store.receive('source', { type: 'commit', sessionId: 1, geometry: start })
    const moved: Card = {
      id: 'source',
      kind: 'note',
      blocks: [],
      position: { x: 900, y: 700 },
      size: { width: 280, height: 190 },
    }
    expect(cardWithResizeHotGeometry(moved, store.getSnapshot())).toBe(moved)
    coordinator.dispose()
  })

  it('retires a terminal immediately when its graph Card is missing', () => {
    const harness = terminalCoordinatorHarness({
      initialState: { graph: 'missing', node: 'absent' },
    })
    publishTerminal(harness.store)

    harness.flushFrame()

    expect(harness.acknowledge).toHaveBeenCalledWith('source', 1)
    expect(harness.store.getSnapshot()).toBeNull()
    expect(harness.scheduled.size).toBe(0)
  })

  it('retires the realistic fractional terminal with preserved endpoint offsets on sample two', () => {
    const nodeMatches = reactFlowNodeMatchesResize(
      matchingReactFlowNode(fractionalTerminal),
      fractionalTerminal,
      terminalEndpointOffsets,
    )
    const harness = terminalCoordinatorHarness({
      initialState: {
        graph: 'matching',
        node: nodeMatches ? 'matching' : 'mismatching',
      },
      stableFrames: 2,
    })
    publishTerminal(harness.store, 1, fractionalTerminal, terminalEndpointOffsets)

    expect(nodeMatches).toBe(true)
    harness.flushFrame()
    expect(harness.acknowledge).not.toHaveBeenCalled()
    harness.flushFrame()

    expect(harness.acknowledge).toHaveBeenCalledTimes(1)
    expect(harness.acknowledge).toHaveBeenCalledWith('source', 1)
    expect(harness.store.getSnapshot()).toBeNull()
  })

  it('retains the terminal for representative endpoint-offset and geometry mismatches', () => {
    const offsetMismatch = matchingReactFlowNode(fractionalTerminal)
    offsetMismatch.internals.handleBounds.source![0].x += 1.01
    const geometryMismatch = matchingReactFlowNode(fractionalTerminal, { width: 311, height: 215 })

    for (const node of [offsetMismatch, geometryMismatch]) {
      const nodeMatches = reactFlowNodeMatchesResize(
        node,
        fractionalTerminal,
        terminalEndpointOffsets,
      )
      const harness = terminalCoordinatorHarness({
        initialState: { graph: 'matching', node: nodeMatches ? 'matching' : 'mismatching' },
        stableFrames: 2,
        maxFrames: 2,
      })
      publishTerminal(harness.store, 1, fractionalTerminal, terminalEndpointOffsets)

      expect(nodeMatches).toBe(false)
      harness.flushFrame()
      harness.flushFrame()
      expect(harness.acknowledge).not.toHaveBeenCalled()
      expect(harness.onTimeout).toHaveBeenCalledTimes(1)
      expect(harness.store.getSnapshot()).toMatchObject({ phase: 'settling' })
      harness.coordinator.dispose()
    }
  })

  it('retains the terminal when controlled-node measurement or handle evidence is missing', () => {
    const missingWidth = matchingReactFlowNode(fractionalTerminal, { height: 215 })
    const missingSource = matchingReactFlowNode(fractionalTerminal)
    missingSource.internals.handleBounds.source = null
    const missingTarget = matchingReactFlowNode(fractionalTerminal)
    missingTarget.internals.handleBounds.target = null

    for (const node of [missingWidth, missingSource, missingTarget]) {
      const nodeMatches = reactFlowNodeMatchesResize(
        node,
        fractionalTerminal,
        terminalEndpointOffsets,
      )
      const harness = terminalCoordinatorHarness({
        initialState: { graph: 'matching', node: nodeMatches ? 'matching' : 'mismatching' },
        stableFrames: 2,
        maxFrames: 2,
      })
      publishTerminal(harness.store, 1, fractionalTerminal, terminalEndpointOffsets)

      expect(nodeMatches).toBe(false)
      harness.flushFrame()
      harness.flushFrame()
      expect(harness.acknowledge).not.toHaveBeenCalled()
      expect(harness.onTimeout).toHaveBeenCalledTimes(1)
      expect(harness.store.getSnapshot()).toMatchObject({ phase: 'settling' })
      harness.coordinator.dispose()
    }
  })

  it('retires after stable graph matches even when the controlled node is absent', () => {
    const harness = terminalCoordinatorHarness({
      initialState: { graph: 'matching', node: 'absent' },
      stableFrames: 2,
    })
    publishTerminal(harness.store)

    harness.flushFrame()
    expect(harness.acknowledge).not.toHaveBeenCalled()
    harness.flushFrame()

    expect(harness.acknowledge).toHaveBeenCalledWith('source', 1)
    expect(harness.store.getSnapshot()).toBeNull()
  })

  it('stops polling after maxFrames and remains idle until authoritative state wakes it', () => {
    const harness = terminalCoordinatorHarness({
      initialState: { graph: 'mismatching', node: 'mismatching' },
      maxFrames: 2,
    })
    publishTerminal(harness.store)

    harness.flushFrame()
    harness.flushFrame()

    expect(harness.onTimeout).toHaveBeenCalledTimes(1)
    expect(harness.acknowledge).not.toHaveBeenCalled()
    expect(harness.scheduled.size).toBe(0)
    expect(harness.requestFrame).toHaveBeenCalledTimes(2)
  })

  it('wakes a timed-out terminal for one fresh bounded reconciliation sequence', () => {
    const harness = terminalCoordinatorHarness({
      initialState: { graph: 'mismatching', node: 'mismatching' },
      stableFrames: 2,
      maxFrames: 2,
    })
    publishTerminal(harness.store)
    harness.flushFrame()
    harness.flushFrame()
    expect(harness.scheduled.size).toBe(0)

    harness.setState({ graph: 'matching', node: 'matching' })
    harness.emitState()
    expect(harness.scheduled.size).toBe(1)
    harness.flushFrame()
    harness.flushFrame()

    expect(harness.acknowledge).toHaveBeenCalledWith('source', 1)
    expect(harness.onTimeout).toHaveBeenCalledTimes(1)
  })

  it('retires when authoritative graph geometry diverges after first matching', () => {
    const harness = terminalCoordinatorHarness({
      initialState: { graph: 'matching', node: 'mismatching' },
    })
    publishTerminal(harness.store)
    harness.flushFrame()
    expect(harness.acknowledge).not.toHaveBeenCalled()

    harness.setState({ graph: 'mismatching', node: 'mismatching' })
    harness.emitState()

    expect(harness.acknowledge).toHaveBeenCalledWith('source', 1)
    expect(harness.store.getSnapshot()).toBeNull()
    expect(harness.scheduled.size).toBe(0)
  })

  it('reconciles a settling snapshot that predates coordinator construction', () => {
    const harness = terminalCoordinatorHarness({
      initialState: { graph: 'matching', node: 'absent' },
      initialTerminal: true,
      stableFrames: 1,
    })

    expect(harness.scheduled.size).toBe(1)
    harness.flushFrame()

    expect(harness.acknowledge).toHaveBeenCalledWith('source', 1)
    expect(harness.store.getSnapshot()).toBeNull()
  })

  it('dispose cancels active polling and unsubscribes both terminal authorities', () => {
    const harness = terminalCoordinatorHarness({
      initialState: { graph: 'mismatching', node: 'mismatching' },
    })
    publishTerminal(harness.store)
    expect(harness.scheduled.size).toBe(1)
    const requestsBeforeDispose = harness.requestFrame.mock.calls.length

    harness.coordinator.dispose()

    expect(harness.scheduled.size).toBe(0)
    expect(harness.cancelFrame).toHaveBeenCalledTimes(1)
    expect(harness.unsubscribeState).toHaveBeenCalledTimes(1)
    harness.emitState()
    publishTerminal(harness.store, 2)
    expect(harness.requestFrame).toHaveBeenCalledTimes(requestsBeforeDispose)
  })

  it('overlays one indexed Card without visiting unrelated Cards', () => {
    const source: Card = {
      id: 'source',
      kind: 'note',
      blocks: [],
      position: start.position,
      size: start.size,
    }
    const unrelated = new Map<string, Card>(
      Array.from({ length: 512 }, (_, index) => [
        `unrelated-${index}`,
        {
          id: `unrelated-${index}`,
          kind: 'note',
          blocks: [],
          position: { x: index, y: index },
        },
      ]),
    )
    const lookup = vi.fn((cardId: string) => (cardId === source.id ? source : unrelated.get(cardId)))
    const frame = {
      cardId: source.id,
      sessionId: 4,
      startGeometry: start,
      geometry: preview,
      phase: 'active' as const,
    }
    const cardById = resizeHotCardById(lookup, frame)

    expect(cardById(source.id)).toEqual(cardWithResizeHotGeometry(source, frame))
    expect(cardById(source.id)).toEqual(cardWithResizeHotGeometry(source, frame))
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(cardById('unrelated-300')).toBe(unrelated.get('unrelated-300'))
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('pins begin dimensions, restores aborts, and cannot clear a newer pin', () => {
    const pin = createBoardResizeOuterFramePin()
    const first = document.createElement('div')
    const firstLayer = document.createElement('div')
    firstLayer.className = 'card-resize-layer'
    first.append(firstLayer)
    first.style.width = '260px'
    const second = document.createElement('div')
    const secondLayer = document.createElement('div')
    secondLayer.className = 'card-resize-layer'
    second.append(secondLayer)

    pin.receive('source', { type: 'begin', sessionId: 1, geometry: start }, first)
    expect({ width: first.style.width, height: first.style.height }).toEqual({
      width: '260px',
      height: '180px',
    })
    expect([first.dataset.resizeFrame, firstLayer.dataset.resizeFrame]).toEqual([
      'active',
      'active',
    ])
    pin.receive('source', { type: 'begin', sessionId: 2, geometry: preview }, second)
    expect({ width: first.style.width, height: first.style.height }).toEqual({
      width: '260px',
      height: '',
    })
    expect([first.dataset.resizeFrame, firstLayer.dataset.resizeFrame]).toEqual([
      undefined,
      undefined,
    ])
    expect([second.dataset.resizeFrame, secondLayer.dataset.resizeFrame]).toEqual([
      'active',
      'active',
    ])
    pin.receive('source', { type: 'abort', sessionId: 1 }, first)
    expect({ width: second.style.width, height: second.style.height }).toEqual({
      width: '300px',
      height: '210px',
    })
    expect(second.dataset.resizeFrame).toBe('active')
    pin.receive('source', { type: 'abort', sessionId: 2 }, second)
    expect({ width: second.style.width, height: second.style.height }).toEqual({
      width: '',
      height: '',
    })
    expect([second.dataset.resizeFrame, secondLayer.dataset.resizeFrame]).toEqual([
      undefined,
      undefined,
    ])
  })

  it.each([
    ['preview', { type: 'preview' as const, sessionId: 1, geometry: start }],
    ['commit', { type: 'commit' as const, sessionId: 1, geometry: start }],
    ['abort', { type: 'abort' as const, sessionId: 1 }],
  ] as const)('ignores a stale %s without corrupting the active pin phase', (_label, staleEvent) => {
    const pin = createBoardResizeOuterFramePin()
    const first = document.createElement('div')
    first.style.width = '260px'
    const second = document.createElement('div')

    pin.receive('source', { type: 'begin', sessionId: 1, geometry: start }, first)
    pin.receive('source', { type: 'begin', sessionId: 2, geometry: preview }, second)
    pin.receive('source', staleEvent, first)

    expect({ width: second.style.width, height: second.style.height }).toEqual({
      width: '300px',
      height: '210px',
    })
    pin.dispose()
    expect({ width: second.style.width, height: second.style.height }).toEqual({
      width: '',
      height: '',
    })
  })

  it('does not restore a committed pin when a newer gesture begins and aborts', () => {
    const pin = createBoardResizeOuterFramePin()
    const element = document.createElement('div')
    const resizeLayer = document.createElement('div')
    resizeLayer.className = 'card-resize-layer'
    element.append(resizeLayer)
    element.style.width = '260px'
    element.style.height = '180px'

    pin.receive('source', { type: 'begin', sessionId: 1, geometry: start }, element)
    pin.receive('source', { type: 'commit', sessionId: 1, geometry: preview }, element)
    expect([element.dataset.resizeFrame, resizeLayer.dataset.resizeFrame]).toEqual([
      'settling',
      'settling',
    ])

    // Session two begins before controlled React Flow reconciliation. Its
    // restore point must still be session one's committed geometry.
    pin.receive('source', { type: 'begin', sessionId: 2, geometry: preview }, element)
    pin.receive('source', { type: 'abort', sessionId: 2 }, element)

    expect({ width: element.style.width, height: element.style.height }).toEqual({
      width: '300px',
      height: '210px',
    })
    expect([element.dataset.resizeFrame, resizeLayer.dataset.resizeFrame]).toEqual([
      undefined,
      undefined,
    ])
  })
})
