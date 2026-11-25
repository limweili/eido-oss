import {
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  useInternalNode,
  useStore,
  useStoreApi,
  type EdgeProps,
} from '@xyflow/react'
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
} from 'react'
import { useGraph } from '../../graph/store'
import type { Connection } from '../../graph/types'
import { words } from '../../shared/words'
import { CONNECTOR_NODE_METRICS } from '../../ui/tokens'
import { useEffectiveMarqueeConnectionSelection } from '../marqueeSelectionState'
import { handleScaleForZoom, pillScaleForZoom } from '../zoomChrome'
import {
  resizeEndpointCenter,
  type BoardResizeHotFrame,
  type BoardResizeHotGeometryStore,
} from '../boardResizeHotGeometry'
import {
  CONNECTION_INTERACTION_STROKE_WIDTH_PX,
  connectionAppearance,
  connectionColor,
  connectionDashCss,
} from './connectionAppearance'
import { ConnectionPopover } from './ConnectionPopover'
import { connectionArrowPoints, connectionArrowRotation } from './connectionArrow'
import type { ConnectionEdgeMountRegistry } from './connectionEdgeMountRegistry'

const selectViewportZoom = (state: { transform: [number, number, number] }) => state.transform[2]

function ZoomScaledConnectionArrow({ points, fill }: { points: string; fill: string }) {
  const zoom = useStore(selectViewportZoom)
  return (
    <polygon
      points={points}
      fill={fill}
      style={{
        transform: `scale(${handleScaleForZoom(zoom).toFixed(3)})`,
        transformOrigin: '0 0',
      }}
    />
  )
}

type ZoomScaledConnectionPillProps = ComponentPropsWithoutRef<'button'> & {
  labelX: number
  labelY: number
  magnified: boolean
}

const ZoomScaledConnectionPill = forwardRef<HTMLButtonElement, ZoomScaledConnectionPillProps>(
  function ZoomScaledConnectionPill({ labelX, labelY, magnified, style, ...props }, ref) {
    const zoom = useStore(selectViewportZoom)
    return (
      <button
        {...props}
        ref={ref}
        style={{
          ...style,
          transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(calc(${
            magnified ? 1.35 : 1
          } * ${pillScaleForZoom(zoom).toFixed(3)}))`,
        }}
      />
    )
  },
)

function connectorCenterEndpoint(point: { x: number; y: number }, position: Position) {
  const radius = CONNECTOR_NODE_METRICS.diameter / 2
  if (position === Position.Left) return { x: point.x + radius, y: point.y }
  if (position === Position.Top) return { x: point.x, y: point.y + radius }
  if (position === Position.Bottom) return { x: point.x, y: point.y - radius }
  return { x: point.x - radius, y: point.y }
}

function useResizeHotFrame(
  store: BoardResizeHotGeometryStore | undefined,
  cardId: string | undefined,
) {
  const subscribe = useCallback(
    (listener: () => void) => (
      store && cardId ? store.subscribeCard(cardId, listener) : () => undefined
    ),
    [cardId, store],
  )
  const getSnapshot = useCallback(
    () => (store && cardId ? store.getCardSnapshot(cardId) : null),
    [cardId, store],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function endpointCenter(
  frame: BoardResizeHotFrame | null,
  position: string,
  x: number,
  y: number,
  node: {
    measured: { width?: number; height?: number }
    internals: {
      positionAbsolute: { x: number; y: number }
    }
  } | undefined,
  kind: 'source' | 'target',
) {
  const nodePosition = node?.internals.positionAbsolute
  if (!frame) {
    const width = node?.measured.width
    const height = node?.measured.height
    if (nodePosition && width !== undefined && height !== undefined) {
      return resizeEndpointCenter(position, {
        position: nodePosition,
        size: { width, height },
      })
    }
    return connectorCenterEndpoint({ x, y }, position as Position)
  }
  const endpointOffset = frame.endpointOffsets?.[kind] ?? { x: 0, y: 0 }
  const canonicalHotCenter = resizeEndpointCenter(position, frame.geometry)
  return {
    x: canonicalHotCenter.x + endpointOffset.x,
    y: canonicalHotCenter.y + endpointOffset.y,
  }
}

// The React Flow edge for a connection — named for what it is, not more: the
// meaning it draws is binary strength (thick Direct / thin Light) and
// polarity (solid accent "+" Helps, dashed warn "−" Avoid, purple "~" for a
// Mod's coil). The midpoint pill is the connection's editor: hovering the
// line or the pill grows the pill, clicking it opens the popover with every
// connection control.
//
// The one-shot beats (connect pulse, polarity crossfade) render from the
// store's transient records, never local state: edges remount on every graph
// commit, so a mid-flight beat restarts its CSS animation gracefully instead
// of dying with the component. After a beat retires its elements unmount —
// a settled board carries zero animation work.
export function ConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps) {
  const projected = data as {
    connection?: Connection
    ghost?: boolean
    playback?: boolean
    resizeHotGeometryStore?: BoardResizeHotGeometryStore
    mountRegistry?: ConnectionEdgeMountRegistry
  } | undefined
  const storeConn = useGraph((s) => s.graph().connectionById(id))
  const activeTool = useGraph((s) => s.activeTool)
  // Open state lives in the store, not here: the canvas remounts edge
  // components on every graph commit, so an open editor must outlive them.
  const editorOpen = useGraph((s) => s.connectionEditorId === id)
  const openConnectionEditor = useGraph((s) => s.openConnectionEditor)
  const closeConnectionEditor = useGraph((s) => s.closeConnectionEditor)
  const pulse = useGraph((s) => (s.connectionPulse?.connectionId === id ? s.connectionPulse : null))
  const flip = useGraph((s) => (s.connectionFlip?.connectionId === id ? s.connectionFlip : null))
  const clearConnectionPulse = useGraph((s) => s.clearConnectionPulse)
  const clearConnectionFlip = useGraph((s) => s.clearConnectionFlip)
  const reactFlowStore = useStoreApi()
  const [hovered, setHovered] = useState(false)
  const pillRef = useRef<HTMLButtonElement | null>(null)
  const effectiveSelected = useEffectiveMarqueeConnectionSelection(id, !!selected)
  const conn = projected?.connection ?? storeConn
  const sourceNode = useInternalNode(conn?.from.cardId ?? '')
  const targetNode = useInternalNode(conn?.to.cardId ?? '')
  const sourceHotFrame = useResizeHotFrame(projected?.resizeHotGeometryStore, conn?.from.cardId)
  const targetHotFrame = useResizeHotFrame(projected?.resizeHotGeometryStore, conn?.to.cardId)
  useLayoutEffect(() => {
    projected?.mountRegistry?.mount(id)
    return () => projected?.mountRegistry?.unmount(id)
  }, [id, projected?.mountRegistry])
  const liveSource = endpointCenter(
    sourceHotFrame,
    sourcePosition,
    sourceX,
    sourceY,
    sourceNode,
    'source',
  )
  const liveTarget = endpointCenter(
    targetHotFrame,
    targetPosition,
    targetX,
    targetY,
    targetNode,
    'target',
  )

  const [path, labelX, labelY] = getBezierPath({
    sourceX: liveSource.x,
    sourceY: liveSource.y,
    targetX: liveTarget.x,
    targetY: liveTarget.y,
    sourcePosition,
    targetPosition,
  })

  if (!conn) return null

  const isNegative = conn.polarity === 'pushesAgainst'
  const isMod = conn.role === 'modifies'
  const isGhost = Boolean(projected?.ghost)
  const interactive = !projected?.playback && !isGhost && activeTool === 'select'
  const highlighted = interactive && hovered

  const appearance = connectionAppearance({ ...conn, ghost: isGhost, hovered: highlighted })
  const color = connectionColor(appearance.colorRole)

  const pulsing = interactive && Boolean(pulse)
  const flipping = interactive && Boolean(flip)

  const style: React.CSSProperties = {
    stroke: color,
    strokeWidth: appearance.strokeWidth,
    strokeDasharray: connectionDashCss(appearance.dash),
    strokeLinecap: 'round',
    opacity: appearance.opacity,
    transition:
      'opacity var(--e-t-fast) var(--e-ease-out), stroke-width var(--e-t-fast) var(--e-ease-out)',
  }

  const symbol = isMod ? '~' : isNegative ? '−' : '+'
  const symbolClass = isMod ? 'modifies' : isNegative ? 'pushes' : 'positive'

  // The outgoing character during a polarity flip: the same line drawn the old
  // way, fading out over the incoming one (~200ms crossfade).
  const outgoing = flip
    ? connectionAppearance({ ...conn, polarity: flip.fromPolarity })
    : null

  const openEditor = () => {
    reactFlowStore.getState().addSelectedEdges([id])
    openConnectionEditor(id)
  }

  const toggleEditor = () => {
    if (editorOpen) {
      closeConnectionEditor()
      return
    }
    openEditor()
  }

  return (
    <>
      <path
        id={id}
        d={path}
        fill="none"
        className={`react-flow__edge-path connection-line ${highlighted ? 'hovered' : ''} ${
          pulsing ? 'settling' : ''
        } ${flipping ? 'flip-in' : ''}`}
        style={style}
      />
      <g
        data-connection-arrow={id}
        transform={`translate(${liveTarget.x} ${liveTarget.y}) rotate(${connectionArrowRotation(targetPosition)})`}
        style={{ opacity: appearance.opacity, pointerEvents: 'none' }}
      >
        <ZoomScaledConnectionArrow points={connectionArrowPoints()} fill={color} />
      </g>
      {flipping && outgoing && (
        <path
          d={path}
          fill="none"
          className="connection-line connection-flip-out"
          onAnimationEnd={() => clearConnectionFlip(flip!.seq)}
          style={{
            stroke: connectionColor(outgoing.colorRole),
            strokeWidth: outgoing.strokeWidth,
            strokeDasharray: connectionDashCss(outgoing.dash),
            strokeLinecap: 'round',
            pointerEvents: 'none',
          }}
        />
      )}
      {pulsing && (
        <circle
          key={pulse!.seq}
          className="connection-pulse"
          r={5}
          fill={color}
          onAnimationEnd={() => clearConnectionPulse(pulse!.seq)}
          style={{ offsetPath: `path('${path}')`, pointerEvents: 'none' }}
        />
      )}
      <path
        d={path}
        fill="none"
        strokeOpacity={0}
        strokeWidth={CONNECTION_INTERACTION_STROKE_WIDTH_PX}
        vectorEffect="non-scaling-stroke"
        className="react-flow__edge-interaction"
        onMouseEnter={interactive ? () => setHovered(true) : undefined}
        onMouseLeave={interactive ? () => setHovered(false) : undefined}
        onClick={
          interactive
            ? (event) => {
                event.stopPropagation()
                openEditor()
              }
            : undefined
        }
      />
      <EdgeLabelRenderer>
        <ZoomScaledConnectionPill
          ref={pillRef}
          type="button"
          data-connection-id={id}
          className={`connection-pill ${symbolClass} ${effectiveSelected ? 'selected' : ''} ${isGhost ? 'ghost' : ''} ${
            highlighted ? 'hovered' : ''
          } ${editorOpen ? 'open' : ''} nodrag nopan`}
          labelX={labelX}
          labelY={labelY}
          magnified={highlighted || editorOpen}
          style={{
            position: 'absolute',
            opacity: appearance.opacity,
            pointerEvents: interactive ? 'all' : 'none',
          }}
          aria-label={words.connectionTitle}
          aria-haspopup="dialog"
          aria-expanded={editorOpen}
          onMouseEnter={interactive ? () => setHovered(true) : undefined}
          onMouseLeave={interactive ? () => setHovered(false) : undefined}
          onClick={
            interactive
              ? (event) => {
                  event.stopPropagation()
                  toggleEditor()
                }
              : undefined
          }
        >
          {symbol}
        </ZoomScaledConnectionPill>
        {editorOpen && interactive && (
          <ConnectionPopover
            connection={conn}
            labelX={labelX}
            labelY={labelY}
            pillRef={pillRef}
            onClose={closeConnectionEditor}
          />
        )}
      </EdgeLabelRenderer>
    </>
  )
}
