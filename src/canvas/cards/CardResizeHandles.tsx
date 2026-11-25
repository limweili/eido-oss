import { useStore } from '@xyflow/react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useGraph } from '../../graph/store'
import type { Card } from '../../graph/types'
import { resizeCardCurrentSize, resizeCardFrom } from '../../shared/words'
import {
  cardResizePreviewReporterFromNodeData,
  cardResizeReporterFromNodeData,
  type CardResizeGeometry,
} from '../cardInteraction'
import { CARD_RESIZE_HANDLE_GEOMETRY } from '../resizeHandleGeometry'
import { useExitPresence } from '../../ui/primitives/presence'

const MIN_CARD_WIDTH = 200
const MIN_CARD_HEIGHT = 120

const RESIZE_CORNERS = [
  { corner: 'top-left', vertical: 'top', horizontal: 'left' },
  { corner: 'top-right', vertical: 'top', horizontal: 'right' },
  { corner: 'bottom-left', vertical: 'bottom', horizontal: 'left' },
  { corner: 'bottom-right', vertical: 'bottom', horizontal: 'right' },
] as const

type ResizeCorner = (typeof RESIZE_CORNERS)[number]['corner']

type ResizeSession = {
  sessionId: number
  pointerId: number
  captureTarget: HTMLButtonElement
  nodeElement: HTMLElement | null
  corner: ResizeCorner
  startClientX: number
  startClientY: number
  startPosition: { x: number; y: number }
  startSize: { width: number; height: number }
  zoom: number
  beforeCards: Card[]
  groupMemberPositions: Array<Pick<Card, 'id' | 'position'>>
  hasPointerTravel: boolean
  previewGeometry: CardResizeGeometry | null
}

type ResizeReadout = {
  corner: ResizeCorner
  width: number
  height: number
}

type PointerSample = {
  clientX: number
  clientY: number
}

export type CardResizePreview = {
  offset: { x: number; y: number }
  size: { width: number; height: number }
}

type ResizeHandleStyle = CSSProperties & {
  '--e-card-resize-inverse-zoom': number
  '--e-card-resize-handle-size': string
}

function resizedGeometry(session: ResizeSession, clientX: number, clientY: number) {
  const deltaX = (clientX - session.startClientX) / session.zoom
  const deltaY = (clientY - session.startClientY) / session.zoom
  const fromLeft = session.corner.endsWith('left')
  const fromTop = session.corner.startsWith('top')
  const width = Math.max(
    MIN_CARD_WIDTH,
    fromLeft ? session.startSize.width - deltaX : session.startSize.width + deltaX,
  )
  const height = Math.max(
    MIN_CARD_HEIGHT,
    fromTop ? session.startSize.height - deltaY : session.startSize.height + deltaY,
  )

  return {
    position: {
      x: fromLeft
        ? session.startPosition.x + session.startSize.width - width
        : session.startPosition.x,
      y: fromTop
        ? session.startPosition.y + session.startSize.height - height
        : session.startPosition.y,
    },
    size: { width, height },
  }
}

function geometryChanged(session: ResizeSession, next: CardResizeGeometry) {
  return (
    next.position.x !== session.startPosition.x ||
    next.position.y !== session.startPosition.y ||
    next.size.width !== session.startSize.width ||
    next.size.height !== session.startSize.height
  )
}

let nextResizeSessionId = 1

export function CardResizeHandles({
  id,
  data,
  onVisualPreview,
}: {
  id: string
  data: unknown
  onVisualPreview: (preview: CardResizePreview | null) => void
}) {
  const viewportZoom = useStore((state) => state.transform[2])
  const currentSize = useGraph((state) => state.graph().cardById(id)?.size)
  const sessionRef = useRef<ResizeSession | null>(null)
  const pendingSampleRef = useRef<PointerSample | null>(null)
  const frameRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const applySampleRef = useRef<(session: ResizeSession, sample: PointerSample) => void>(() => {})
  const finishRef = useRef<(pointerId?: number) => void>(() => {})
  const lastReadoutRef = useRef<ResizeReadout | null>(null)
  const [readout, setReadout] = useState<ResizeReadout | null>(null)
  const [handleEntranceRetired, setHandleEntranceRetired] = useState(false)
  const readoutPresence = useExitPresence(readout !== null)
  const reportCardResize = cardResizeReporterFromNodeData(data)
  const zoom = Math.max(0.01, viewportZoom)
  const handleStyle: ResizeHandleStyle = {
    '--e-card-resize-inverse-zoom': 1 / zoom,
    '--e-card-resize-handle-size': `${CARD_RESIZE_HANDLE_GEOMETRY.size}px`,
  }
  if (readout) lastReadoutRef.current = readout
  const visibleReadout = readout ?? lastReadoutRef.current
  const reportCardResizePreview = cardResizePreviewReporterFromNodeData(data)

  const previewGeometry = (
    session: ResizeSession,
    sample: PointerSample,
    showReadout = true,
  ) => {
    const next = resizedGeometry(session, sample.clientX, sample.clientY)
    session.previewGeometry = next
    onVisualPreview({
      offset: {
        x: next.position.x - session.startPosition.x,
        y: next.position.y - session.startPosition.y,
      },
      size: next.size,
    })
    reportCardResizePreview?.(
      id,
      { type: 'preview', sessionId: session.sessionId, geometry: next },
      session.nodeElement,
    )
    if (showReadout && mountedRef.current) {
      setReadout({ corner: session.corner, ...next.size })
    }
  }
  applySampleRef.current = (session, sample) => previewGeometry(session, sample)

  const commitGeometry = (session: ResizeSession, next: CardResizeGeometry) => {
    const state = useGraph.getState()
    if (
      next.position.x !== session.startPosition.x ||
      next.position.y !== session.startPosition.y
    ) {
      if (session.groupMemberPositions.length > 0) {
        state.moveCards(
          [
            { id, position: next.position },
            ...session.groupMemberPositions,
          ],
          { recordHistory: false },
        )
      } else {
        state.moveCard(id, next.position, { recordHistory: false })
      }
    }
    useGraph.getState().setCardSize(id, next.size, { recordHistory: false })
    useGraph
      .getState()
      .recordCardStructuralChange('resizeCard', session.beforeCards, useGraph.getState().cards)
    reportCardResize?.(id, next.size)
  }

  const cancelScheduledFrame = () => {
    if (frameRef.current === null) return
    cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }

  const flushPendingGeometry = () => {
    const session = sessionRef.current
    const sample = pendingSampleRef.current
    cancelScheduledFrame()
    pendingSampleRef.current = null
    if (session && sample) {
      session.previewGeometry = resizedGeometry(session, sample.clientX, sample.clientY)
    }
  }

  finishRef.current = (pointerId) => {
    const session = sessionRef.current
    if (!session || (pointerId !== undefined && session.pointerId !== pointerId)) return
    // Resolve the last browser sample without publishing another preview,
    // then retire the session before release/store callbacks can re-enter.
    flushPendingGeometry()
    sessionRef.current = null
    try {
      if (session.captureTarget.hasPointerCapture(session.pointerId)) {
        session.captureTarget.releasePointerCapture(session.pointerId)
      }
      const next = session.previewGeometry
      const liveCardExists = Boolean(useGraph.getState().graph().cardById(id))
      if (next && geometryChanged(session, next) && liveCardExists) {
        // Publish the exact terminal frame before the graph mutation. Board
        // keeps it in settling state until React Flow's controlled wrapper,
        // measurements and handle bounds have reconciled, so clearing the
        // child preview cannot expose one stale release frame.
        reportCardResizePreview?.(
          id,
          {
            type: 'commit',
            sessionId: session.sessionId,
            geometry: next,
          },
          session.nodeElement,
        )
        commitGeometry(session, next)
      } else {
        reportCardResizePreview?.(
          id,
          { type: 'abort', sessionId: session.sessionId },
          session.nodeElement,
        )
      }
    } finally {
      onVisualPreview(null)
      if (mountedRef.current) setReadout(null)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    const finishActiveSession = () => finishRef.current()
    const finishWhenHidden = () => {
      if (document.visibilityState === 'hidden') finishRef.current()
    }
    window.addEventListener('blur', finishActiveSession)
    document.addEventListener('visibilitychange', finishWhenHidden)
    return () => {
      mountedRef.current = false
      finishRef.current()
      window.removeEventListener('blur', finishActiveSession)
      document.removeEventListener('visibilitychange', finishWhenHidden)
    }
  }, [])

  const onPointerDown = (corner: ResizeCorner, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || sessionRef.current) return
    const state = useGraph.getState()
    const card = state.graph().cardById(id)
    if (!card) return
    const element = event.currentTarget.closest<HTMLElement>('.card')
    const bounds = element?.getBoundingClientRect()
    const startSize = {
      width: card.size?.width ?? (bounds?.width ?? MIN_CARD_WIDTH) / zoom,
      height: card.size?.height ?? (bounds?.height ?? MIN_CARD_HEIGHT) / zoom,
    }

    event.preventDefault()
    event.stopPropagation()
    cancelScheduledFrame()
    pendingSampleRef.current = null
    event.currentTarget.setPointerCapture(event.pointerId)
    sessionRef.current = {
      sessionId: nextResizeSessionId,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      nodeElement: event.currentTarget.closest<HTMLElement>('.react-flow__node'),
      corner,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: card.position,
      startSize,
      zoom,
      beforeCards: state.cards,
      groupMemberPositions:
        card.kind === 'group'
          ? state.graph().membersOf(id).map((member) => ({
              id: member.id,
              position: { ...member.position },
            }))
          : [],
      hasPointerTravel: false,
      previewGeometry: null,
    }
    nextResizeSessionId += 1
    const session = sessionRef.current
    reportCardResizePreview?.(
      id,
      {
        type: 'begin',
        sessionId: session.sessionId,
        geometry: { position: session.startPosition, size: session.startSize },
      },
      session.nodeElement,
    )
    setHandleEntranceRetired(true)
    setReadout({ corner, ...startSize })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const hasPointerTravel =
      event.clientX !== session.startClientX || event.clientY !== session.startClientY
    if (!session.hasPointerTravel && !hasPointerTravel) return
    session.hasPointerTravel ||= hasPointerTravel
    pendingSampleRef.current = { clientX: event.clientX, clientY: event.clientY }
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const activeSession = sessionRef.current
      const sample = pendingSampleRef.current
      pendingSampleRef.current = null
      if (activeSession && sample) applySampleRef.current(activeSession, sample)
    })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const hasPointerTravel =
      event.clientX !== session.startClientX || event.clientY !== session.startClientY
    session.hasPointerTravel ||= hasPointerTravel
    if (session.hasPointerTravel) {
      pendingSampleRef.current = { clientX: event.clientX, clientY: event.clientY }
    }
    finishRef.current(event.pointerId)
  }

  const onPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    // Cancellation coordinates are not a valid pointer sample. Flush the last
    // move the browser delivered, then summarize the exact geometry once.
    finishRef.current(event.pointerId)
  }

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    finishRef.current(event.pointerId)
  }

  const onKeyDown = (
    corner: ResizeCorner,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const state = useGraph.getState()
    const card = state.graph().cardById(id)
    if (!card) return
    setHandleEntranceRetired(true)
    const bounds = event.currentTarget.closest<HTMLElement>('.card')?.getBoundingClientRect()
    const startSize = {
      width: card.size?.width ?? (bounds?.width ?? MIN_CARD_WIDTH) / zoom,
      height: card.size?.height ?? (bounds?.height ?? MIN_CARD_HEIGHT) / zoom,
    }
    const step = event.shiftKey ? 1 : 10
    const session: ResizeSession = {
      sessionId: -1,
      pointerId: -1,
      captureTarget: event.currentTarget,
      nodeElement: event.currentTarget.closest<HTMLElement>('.react-flow__node'),
      corner,
      startClientX: 0,
      startClientY: 0,
      startPosition: card.position,
      startSize,
      zoom: 1,
      beforeCards: state.cards,
      groupMemberPositions:
        card.kind === 'group'
          ? state.graph().membersOf(id).map((member) => ({
              id: member.id,
              position: { ...member.position },
            }))
          : [],
      hasPointerTravel: true,
      previewGeometry: null,
    }
    const sample = {
      clientX: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      clientY: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
    }
    const next = resizedGeometry(session, sample.clientX, sample.clientY)
    if (geometryChanged(session, next)) commitGeometry(session, next)
  }

  return (
    <>
      {RESIZE_CORNERS.map(({ corner, vertical, horizontal }) => (
        <button
          key={corner}
          type="button"
          className={`react-flow__resize-control nodrag ${vertical} ${horizontal} handle card-resize-handle`}
          data-corner={corner}
          data-resizing={readout !== null || undefined}
          data-entrance-retired={handleEntranceRetired || undefined}
          aria-label={resizeCardFrom(corner.replace('-', ' '))}
          aria-description={resizeCardCurrentSize(
            Math.round(currentSize?.width ?? MIN_CARD_WIDTH),
            Math.round(currentSize?.height ?? MIN_CARD_HEIGHT),
          )}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
          style={handleStyle}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => onPointerDown(corner, event)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onLostPointerCapture}
          onKeyDown={(event) => onKeyDown(corner, event)}
        />
      ))}
      {readoutPresence.mounted && visibleReadout && (
        <div
          className="card-resize-readout t-value"
          data-corner={visibleReadout.corner}
          data-state={readoutPresence.state}
          role="status"
          aria-live="off"
          aria-hidden={readoutPresence.state === 'exiting' || undefined}
          style={handleStyle}
          onTransitionEnd={readoutPresence.onTransitionEnd}
        >
          {Math.round(visibleReadout.width)} × {Math.round(visibleReadout.height)}
        </div>
      )}
    </>
  )
}
