import type { Card } from '../graph/types'
import type { CardResizeGeometry, CardResizePreviewEvent } from './cardInteraction'
import type { PaintedConnection } from './boardScene'

export type BoardResizeHotFrame = {
  cardId: string
  sessionId: number
  startGeometry: CardResizeGeometry
  geometry: CardResizeGeometry
  phase: 'active' | 'settling'
  endpointOffsets?: {
    source?: { x: number; y: number }
    target?: { x: number; y: number }
  }
}

export type BoardResizeHotBeginContext = Pick<BoardResizeHotFrame, 'endpointOffsets'>

export function resizeEndpointCenter(position: string, geometry: CardResizeGeometry) {
  if (position === 'left') {
    return { x: geometry.position.x, y: geometry.position.y + geometry.size.height / 2 }
  }
  if (position === 'top') {
    return { x: geometry.position.x + geometry.size.width / 2, y: geometry.position.y }
  }
  if (position === 'bottom') {
    return {
      x: geometry.position.x + geometry.size.width / 2,
      y: geometry.position.y + geometry.size.height,
    }
  }
  return {
    x: geometry.position.x + geometry.size.width,
    y: geometry.position.y + geometry.size.height / 2,
  }
}

export const REACT_FLOW_MEASURED_DIMENSION_TOLERANCE_PX = 0.5

type ReactFlowResizeHandle = {
  x: number
  y: number
  width: number
  height: number
  position: string
}

type ReactFlowResizeNode = {
  measured: { width?: number; height?: number }
  internals: {
    positionAbsolute: { x: number; y: number }
    handleBounds?: {
      source: ReadonlyArray<ReactFlowResizeHandle> | null
      target: ReadonlyArray<ReactFlowResizeHandle> | null
    }
  }
}

function resizeHandleBoundsMatch(
  handles: ReadonlyArray<ReactFlowResizeHandle> | null | undefined,
  nodePosition: CardResizeGeometry['position'],
  geometry: CardResizeGeometry,
  expectedOffset: { x: number; y: number } | undefined,
) {
  if (!handles?.length) return false
  return handles.every((handle) => {
    const canonical = resizeEndpointCenter(handle.position, geometry)
    const actualOffset = {
      x: nodePosition.x + handle.x + handle.width / 2 - canonical.x,
      y: nodePosition.y + handle.y + handle.height / 2 - canonical.y,
    }
    return (
      Math.abs(actualOffset.x - (expectedOffset?.x ?? 0)) <= 1 &&
      Math.abs(actualOffset.y - (expectedOffset?.y ?? 0)) <= 1
    )
  })
}

export function reactFlowNodeMatchesResize(
  node: ReactFlowResizeNode | undefined,
  geometry: CardResizeGeometry,
  endpointOffsets?: BoardResizeHotFrame['endpointOffsets'],
) {
  if (!node) return false
  return (
    Math.abs(node.internals.positionAbsolute.x - geometry.position.x) <= 0.01 &&
    Math.abs(node.internals.positionAbsolute.y - geometry.position.y) <= 0.01 &&
    Math.abs((node.measured.width ?? 0) - geometry.size.width) <=
      REACT_FLOW_MEASURED_DIMENSION_TOLERANCE_PX &&
    Math.abs((node.measured.height ?? 0) - geometry.size.height) <=
      REACT_FLOW_MEASURED_DIMENSION_TOLERANCE_PX &&
    resizeHandleBoundsMatch(
      node.internals.handleBounds?.source,
      node.internals.positionAbsolute,
      geometry,
      endpointOffsets?.source,
    ) &&
    resizeHandleBoundsMatch(
      node.internals.handleBounds?.target,
      node.internals.positionAbsolute,
      geometry,
      endpointOffsets?.target,
    )
  )
}

export type BoardResizePaintedConnectionSnapshot = {
  cardId: string
  sessionId: number
  /** Stable, query-truncated paint order; incident entries mutate in place. */
  connections: readonly PaintedConnection[]
}

type Listener = () => void
type TerminalListener = (frame: BoardResizeHotFrame) => void

export type BoardResizeHotGeometryStore = {
  /** Visual subscribers never observe a stationary begin-only frame. */
  getSnapshot(): BoardResizeHotFrame | null
  getCardSnapshot(cardId: string): BoardResizeHotFrame | null
  getPaintedConnectionsSnapshot(cardId: string, sessionId: number): BoardResizePaintedConnectionSnapshot | null
  subscribe(listener: Listener): () => void
  subscribeCard(cardId: string, listener: Listener): () => void
  /** Gesture setup only: fires before any preview can publish. */
  subscribeBegin(listener: TerminalListener): () => void
  /** Commit/restore only: never fires for pointer-preview frames. */
  subscribeTerminal(listener: TerminalListener): () => void
  capturePaintedConnections(
    cardId: string,
    sessionId: number,
    connections: readonly PaintedConnection[],
  ): void
  receive(cardId: string, event: CardResizePreviewEvent, context?: BoardResizeHotBeginContext): void
  acknowledge(cardId: string, sessionId: number): void
  dispose(): void
}

/**
 * One active resize frame, outside the graph and React Flow stores. Global
 * listeners are the single canvas layer; keyed listeners are only edges
 * incident to the active Card. A pointer sample never wakes unrelated nodes
 * or edges and never visits the board collections.
 */
export function createBoardResizeHotGeometryStore(): BoardResizeHotGeometryStore {
  // `sessionFrame` accepts events only from the newest gesture. `visualFrame`
  // is what canvas/edge subscribers see. They normally point at the same
  // object, but a stationary gesture that supersedes a still-settling commit
  // keeps the prior terminal visual until the new gesture publishes.
  let sessionFrame: BoardResizeHotFrame | null = null
  let visualFrame: BoardResizeHotFrame | null = null
  let retainedSettlingFrame: BoardResizeHotFrame | null = null
  let paintedConnections: BoardResizePaintedConnectionSnapshot | null = null
  let retainedPaintedConnections: BoardResizePaintedConnectionSnapshot | null = null
  const listeners = new Set<Listener>()
  const cardListeners = new Map<string, Set<Listener>>()
  const beginListeners = new Set<TerminalListener>()
  const terminalListeners = new Set<TerminalListener>()

  const notify = (previousCardId?: string, nextCardId?: string) => {
    for (const listener of listeners) listener()
    const keyedListeners = new Set<Listener>()
    if (previousCardId) {
      for (const listener of cardListeners.get(previousCardId) ?? []) keyedListeners.add(listener)
    }
    if (nextCardId) {
      for (const listener of cardListeners.get(nextCardId) ?? []) keyedListeners.add(listener)
    }
    for (const listener of keyedListeners) listener()
  }

  const publish = (next: BoardResizeHotFrame | null) => {
    const previous = visualFrame
    visualFrame = next
    if (previous || next) notify(previous?.cardId, next?.cardId)
  }

  const publishTerminal = (frame: BoardResizeHotFrame) => {
    for (const listener of terminalListeners) listener(frame)
  }

  return {
    getSnapshot: () => visualFrame,
    getCardSnapshot: (cardId) => (visualFrame?.cardId === cardId ? visualFrame : null),
    getPaintedConnectionsSnapshot(cardId, sessionId) {
      if (paintedConnections?.cardId === cardId && paintedConnections.sessionId === sessionId) {
        return paintedConnections
      }
      if (
        retainedPaintedConnections?.cardId === cardId &&
        retainedPaintedConnections.sessionId === sessionId
      ) {
        return retainedPaintedConnections
      }
      return null
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeCard(cardId, listener) {
      let keyed = cardListeners.get(cardId)
      if (!keyed) {
        keyed = new Set()
        cardListeners.set(cardId, keyed)
      }
      keyed.add(listener)
      return () => {
        keyed!.delete(listener)
        if (keyed!.size === 0) cardListeners.delete(cardId)
      }
    },
    subscribeBegin(listener) {
      beginListeners.add(listener)
      return () => beginListeners.delete(listener)
    },
    subscribeTerminal(listener) {
      terminalListeners.add(listener)
      return () => terminalListeners.delete(listener)
    },
    capturePaintedConnections(cardId, sessionId, connections) {
      if (
        !sessionFrame ||
        sessionFrame.cardId !== cardId ||
        sessionFrame.sessionId !== sessionId
      ) return
      paintedConnections = { cardId, sessionId, connections }
    },
    receive(cardId, event, context) {
      if (event.type === 'begin') {
        // An ordinary begin stays private. If the prior visual is already a
        // terminal frame, leave it published while this new session is still
        // stationary; the outer pin makes the same handoff. A first preview
        // replaces it atomically, while abort keeps it until reconciliation
        // acknowledges the old session.
        if (visualFrame?.phase === 'settling') {
          retainedSettlingFrame = visualFrame
          retainedPaintedConnections =
            paintedConnections?.cardId === visualFrame.cardId &&
            paintedConnections.sessionId === visualFrame.sessionId
              ? paintedConnections
              : retainedPaintedConnections
        }
        else {
          retainedSettlingFrame = null
          retainedPaintedConnections = null
          paintedConnections = null
          publish(null)
        }
        sessionFrame = {
          cardId,
          sessionId: event.sessionId,
          startGeometry: event.geometry,
          geometry: event.geometry,
          phase: 'active',
          endpointOffsets: context?.endpointOffsets,
        }
        for (const listener of beginListeners) listener(sessionFrame)
        return
      }
      if (
        !sessionFrame ||
        sessionFrame.cardId !== cardId ||
        sessionFrame.sessionId !== event.sessionId
      ) return
      if (event.type === 'abort') {
        const restoredSettlingFrame = retainedSettlingFrame
        let publishedVisual = false
        if (
          visualFrame?.cardId === sessionFrame.cardId &&
          visualFrame.sessionId === sessionFrame.sessionId
        ) {
          publish(restoredSettlingFrame)
          publishedVisual = true
        }
        // Visual ownership may return to the retained terminal frame, but
        // input ownership never moves backwards. S1 was superseded by S2, so
        // delayed S1 pointer packets must remain retired forever.
        sessionFrame = null
        retainedSettlingFrame = null
        paintedConnections = restoredSettlingFrame ? retainedPaintedConnections : null
        retainedPaintedConnections = null
        if (restoredSettlingFrame) publishTerminal(restoredSettlingFrame)
        else if (!publishedVisual) {
          // A begin-only session never published visual geometry, but its
          // painter still owns retained DPR planes prepared synchronously at
          // begin. One terminal notification lets visual subscribers release
          // those resources and repaint the ordinary cold frame.
          notify(cardId)
        }
        return
      }
      sessionFrame = {
        ...sessionFrame,
        geometry: event.geometry,
        phase: event.type === 'commit' ? 'settling' : 'active',
      }
      if (event.type === 'commit') {
        retainedSettlingFrame = null
        retainedPaintedConnections = null
      }
      publish(sessionFrame)
      if (event.type === 'commit') publishTerminal(sessionFrame)
    },
    acknowledge(cardId, sessionId) {
      if (
        !visualFrame ||
        visualFrame.phase !== 'settling' ||
        visualFrame.cardId !== cardId ||
        visualFrame.sessionId !== sessionId
      ) {
        return
      }
      publish(null)
      if (
        retainedSettlingFrame?.cardId === cardId &&
        retainedSettlingFrame.sessionId === sessionId
      ) {
        retainedSettlingFrame = null
      }
      if (sessionFrame?.cardId === cardId && sessionFrame.sessionId === sessionId) {
        sessionFrame = null
      }
      if (paintedConnections?.cardId === cardId && paintedConnections.sessionId === sessionId) {
        paintedConnections = null
      }
    },
    dispose() {
      sessionFrame = null
      visualFrame = null
      retainedSettlingFrame = null
      paintedConnections = null
      retainedPaintedConnections = null
      listeners.clear()
      cardListeners.clear()
      beginListeners.clear()
      terminalListeners.clear()
    },
  }
}

export type BoardResizeTerminalState = {
  graph: 'matching' | 'mismatching' | 'missing'
  node: 'matching' | 'mismatching' | 'absent'
}

type BoardResizeTerminalCoordinatorOptions = {
  store: BoardResizeHotGeometryStore
  readState(frame: BoardResizeHotFrame): BoardResizeTerminalState
  acknowledge(cardId: string, sessionId: number): void
  requestFrame(callback: () => void): number
  cancelFrame(frameId: number): void
  subscribeState?(listener: Listener): () => void
  stableFrames: number
  maxFrames: number
  onTimeout?(frame: BoardResizeHotFrame, state: BoardResizeTerminalState): void
}

/**
 * Reconciles terminal hot geometry without observing the preview stream.
 *
 * A generation belongs to one published terminal identity. Restoring an old
 * terminal starts a new generation even though its identity is unchanged,
 * which closes the S1 -> S2 preview -> S2 abort hole without making Board a
 * per-pointer-frame subscriber.
 */
export function createBoardResizeTerminalCoordinator({
  store,
  readState,
  acknowledge,
  requestFrame,
  cancelFrame,
  subscribeState,
  stableFrames,
  maxFrames,
  onTimeout,
}: BoardResizeTerminalCoordinatorOptions): { dispose(): void } {
  let disposed = false
  let generation = 0
  let scheduledFrame: number | null = null
  let activeFrame: BoardResizeHotFrame | null = null
  let matchingFrames = 0
  let absentNodeGraphFrames = 0
  let sampledFrames = 0
  let graphWasMatching = false

  const ownsVisual = (frame: BoardResizeHotFrame) => {
    const latest = store.getSnapshot()
    return Boolean(
      latest?.phase === 'settling' &&
      latest.cardId === frame.cardId &&
      latest.sessionId === frame.sessionId,
    )
  }

  const cancelScheduledFrame = () => {
    if (scheduledFrame === null) return
    cancelFrame(scheduledFrame)
    scheduledFrame = null
  }

  const retire = (frame: BoardResizeHotFrame) => {
    generation += 1
    cancelScheduledFrame()
    activeFrame = null
    acknowledge(frame.cardId, frame.sessionId)
  }

  const schedule = (expectedGeneration: number) => {
    if (disposed || scheduledFrame !== null) return
    scheduledFrame = requestFrame(() => {
      scheduledFrame = null
      if (disposed || expectedGeneration !== generation || !activeFrame) return
      const frame = activeFrame
      if (!ownsVisual(frame)) {
        activeFrame = null
        return
      }

      const state = readState(frame)
      if (state.graph === 'missing') {
        retire(frame)
        return
      }
      if (state.graph === 'matching') graphWasMatching = true
      matchingFrames =
        state.graph === 'matching' && state.node === 'matching' ? matchingFrames + 1 : 0
      absentNodeGraphFrames =
        state.graph === 'matching' && state.node === 'absent'
          ? absentNodeGraphFrames + 1
          : 0
      sampledFrames += 1

      if (matchingFrames >= stableFrames || absentNodeGraphFrames >= stableFrames) {
        retire(frame)
        return
      }
      if (sampledFrames >= maxFrames) {
        onTimeout?.(frame, state)
        return
      }
      schedule(expectedGeneration)
    })
  }

  const start = (frame: BoardResizeHotFrame) => {
    generation += 1
    cancelScheduledFrame()
    activeFrame = frame
    matchingFrames = 0
    absentNodeGraphFrames = 0
    sampledFrames = 0
    graphWasMatching = false
    schedule(generation)
  }

  const unsubscribeTerminal = store.subscribeTerminal(start)
  const unsubscribeState = subscribeState?.(() => {
    const frame = activeFrame
    if (disposed || !frame || !ownsVisual(frame)) return
    const state = readState(frame)
    if (state.graph === 'missing' || (graphWasMatching && state.graph === 'mismatching')) {
      // Once the graph owned the terminal geometry, a later graph edit is
      // authoritative. Retire the bridge so it can never paint over that edit.
      retire(frame)
      return
    }
    if (state.graph === 'matching') graphWasMatching = true
    // A timed-out mounted-node mismatch may still reconcile later. State
    // notifications wake one bounded verification sequence; pointer previews
    // do not touch either subscribed store and therefore never reach here.
    if (scheduledFrame === null && sampledFrames >= maxFrames) {
      matchingFrames = 0
      absentNodeGraphFrames = 0
      sampledFrames = 0
      schedule(generation)
    }
  })

  const initial = store.getSnapshot()
  if (initial?.phase === 'settling') start(initial)

  return {
    dispose() {
      if (disposed) return
      disposed = true
      generation += 1
      cancelScheduledFrame()
      activeFrame = null
      unsubscribeTerminal()
      unsubscribeState?.()
    },
  }
}

export function cardWithResizeHotGeometry(
  card: Card | undefined,
  frame: BoardResizeHotFrame | null,
): Card | undefined {
  if (!card || !frame || card.id !== frame.cardId) return card
  return {
    ...card,
    position: frame.geometry.position,
    size: frame.geometry.size,
  }
}

export function resizeHotCardById(
  cardById: (cardId: string) => Card | undefined,
  frame: BoardResizeHotFrame | null,
): (cardId: string) => Card | undefined {
  if (!frame) return cardById
  let hotCard: Card | undefined
  return (cardId) => {
    if (cardId !== frame.cardId) return cardById(cardId)
    if (hotCard === undefined) hotCard = cardWithResizeHotGeometry(cardById(cardId), frame)
    return hotCard
  }
}

export function resizeHotMeasuredCardSizeById(
  measuredCardSizeById: (cardId: string) => { width: number; height: number } | undefined,
  frame: BoardResizeHotFrame | null,
): (cardId: string) => { width: number; height: number } | undefined {
  if (!frame) return measuredCardSizeById
  return (cardId) => (
    cardId === frame.cardId ? frame.geometry.size : measuredCardSizeById(cardId)
  )
}

type PinnedOuterFrame = {
  cardId: string
  sessionId: number
  nodeElement: HTMLElement
  resizeLayerElement: HTMLElement | null
  width: string
  height: string
  committedWidth?: string
  committedHeight?: string
  phase: 'active' | 'settling'
}

export type BoardResizeOuterFramePin = {
  receive(cardId: string, event: CardResizePreviewEvent, nodeElement: HTMLElement | null): void
  acknowledge(cardId: string, sessionId: number): void
  dispose(): void
}

/** Pins only the outer wrapper's begin dimensions; previews remain child-local. */
export function createBoardResizeOuterFramePin(): BoardResizeOuterFramePin {
  let pin: PinnedOuterFrame | null = null

  const markFrame = (nextPin: PinnedOuterFrame, phase: 'active' | 'settling' | null) => {
    if (phase) {
      nextPin.nodeElement.dataset.resizeFrame = phase
      if (nextPin.resizeLayerElement) nextPin.resizeLayerElement.dataset.resizeFrame = phase
      return
    }
    delete nextPin.nodeElement.dataset.resizeFrame
    if (nextPin.resizeLayerElement) delete nextPin.resizeLayerElement.dataset.resizeFrame
  }

  const restore = () => {
    if (!pin) return
    pin.nodeElement.style.width = pin.width
    pin.nodeElement.style.height = pin.height
    markFrame(pin, null)
    pin = null
  }

  return {
    receive(cardId, event, nodeElement) {
      if (event.type === 'begin') {
        if (pin?.phase === 'settling') {
          // A second press can beat React Flow's controlled reconciliation.
          // Materialize session one's terminal footprint before session two
          // captures its abort restore point; otherwise aborting session two
          // can jump all the way back to session one's gesture-start size.
          pin.nodeElement.style.width = pin.committedWidth ?? pin.nodeElement.style.width
          pin.nodeElement.style.height = pin.committedHeight ?? pin.nodeElement.style.height
          markFrame(pin, null)
          pin = null
        } else {
          restore()
        }
        if (!nodeElement) return
        pin = {
          cardId,
          sessionId: event.sessionId,
          nodeElement,
          resizeLayerElement: nodeElement.querySelector<HTMLElement>('.card-resize-layer'),
          width: nodeElement.style.width,
          height: nodeElement.style.height,
          phase: 'active',
        }
        nodeElement.style.width = `${event.geometry.size.width}px`
        nodeElement.style.height = `${event.geometry.size.height}px`
        markFrame(pin, 'active')
        return
      }
      if (!pin || pin.cardId !== cardId || pin.sessionId !== event.sessionId) return
      if (event.type === 'commit') {
        pin.committedWidth = `${event.geometry.size.width}px`
        pin.committedHeight = `${event.geometry.size.height}px`
        pin.nodeElement.style.width = pin.committedWidth
        pin.nodeElement.style.height = pin.committedHeight
        pin.phase = 'settling'
        markFrame(pin, 'settling')
        return
      }
      if (event.type === 'abort') restore()
    },
    acknowledge(cardId, sessionId) {
      if (!pin || pin.cardId !== cardId || pin.sessionId !== sessionId) return
      // React Flow has reconciled the committed controlled geometry by now;
      // release ownership without restoring the gesture-start dimensions.
      markFrame(pin, null)
      pin = null
    },
    dispose() {
      if (pin?.phase === 'active') restore()
      else {
        if (pin) markFrame(pin, null)
        pin = null
      }
    },
  }
}
