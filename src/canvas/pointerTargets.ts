import { planConnectionAddition, type ConnectionAdditionGraph } from '../graph/connectionAddition'
import type { Card } from '../graph/types'
import { resolvedCardSize, type BoardViewport } from './renderPlanning'
import {
  hitTestSceneCardAtClientPoint,
  nearestSceneCardAtClientPoint,
  samePointerTarget,
  type CanvasPointerTarget,
  type DetailBand,
} from './boardScene'
import { paintedPortGeometry } from './zoomChrome'

// Canvas pointer-target resolution and the hover tracker (C2, #314). This is
// the adapter HOT path: everything here runs per pointer event, holds its
// state in plain fields, and calls back into React state ONLY on an identity
// transition — the pointer-cold scene, the React Flow nodes/edges, the board
// store and the label cache stay untouched while the target is unchanged.
// The resolver lives outside boardScene.ts because port discs come from
// zoomChrome's single geometry owner, and zoomChrome imports boardScene.

/**
 * The proximity lead radius (screen px): the pane pointer-move mounts the
 * nearest card's invisible proxy while the pointer is within this distance
 * of the card's rendered rect, so the proxy's handles exist BEFORE contact.
 */
export const POINTER_LEAD_RADIUS_PX = 48

/**
 * How long a lead card's proxy lingers after the pointer leaves its lead
 * radius, so a fast flick past the card followed by a press still lands on
 * a mounted proxy instead of the bare pane.
 */
export const POINTER_LINGER_MS = 250

// Port discs extend past the card rect by at most their radius (they are
// centred on the rect's edge midpoints), so a containment miss can still be
// a port hit. zoomChrome clamps the painted radius to 4px; searching within
// twice that comfortably covers the disc without scanning the whole board.
const PORT_SEARCH_RADIUS_PX = 8

/**
 * Hit truth follows paint truth (#320 amendment 9): the painter draws port
 * discs on every canvas-painted representation — Map and Overview alike —
 * per the epic's port-floor decision (ports stay grabbable across the whole
 * range in which the card itself is grabbable; `paintedPortGeometry` is
 * continuous to zero and takes no band input). So discs are hittable in
 * every band the canvas paints: everything below Reading. Reading's ports
 * are DOM handles on mounted cards, never canvas targets.
 */
export function paintedPortsHittable(band: DetailBand): boolean {
  return band !== 'reading'
}

/**
 * Resolves the target AND the proximity lead in one pass, hit == paint
 * (ADR 0020): candidates are the scene's `hitTestCandidates`, geometry
 * matches the painter exactly — port discs from `paintedPortGeometry`, hit
 * only where their radius is > 0 and only where the painter actually draws
 * discs: `paintedPortsHittable` (every canvas-painted band, Map and
 * Overview; Reading's ports are DOM handles on mounted cards). At most two
 * candidate scans per pointer event (one when the
 * pointer is inside a card): the containment hit test, then a single nearest
 * scan at the lead radius whose distance also answers the tighter port
 * search. `connection-badge` resolution is C5's slice; until it lands this
 * resolver never returns that kind.
 */
export function canvasPointerPointAtClientPoint({
  candidates,
  viewport,
  viewportRect,
  clientX,
  clientY,
  band,
  leadRadiusPx,
  measuredCardSizeById,
  cardById,
}: {
  candidates: readonly Card[]
  viewport: BoardViewport
  viewportRect: Pick<DOMRect, 'left' | 'top'>
  clientX: number
  clientY: number
  /** The scene's detail band — decides whether painted ports exist at all. */
  band: DetailBand
  leadRadiusPx: number
  measuredCardSizeById?: (cardId: string) => { width: number; height: number } | undefined
  cardById?: (cardId: string) => Card | undefined
}): CanvasPointerPoint {
  const containedCard = hitTestSceneCardAtClientPoint({
    candidates,
    viewport,
    viewportRect,
    clientX,
    clientY,
    measuredCardSizeById,
    cardById,
  })
  // The nearest-within-lead-radius scan runs only on a containment miss: a
  // contained card is at distance 0 and is its own lead.
  const nearestHit = containedCard
    ? null
    : nearestSceneCardAtClientPoint({
        candidates,
        viewport,
        viewportRect,
        clientX,
        clientY,
        leadRadiusPx: Math.max(leadRadiusPx, PORT_SEARCH_RADIUS_PX),
        measuredCardSizeById,
        cardById,
      })
  const portsPainted = paintedPortsHittable(band)
  // Port discs sit within PORT_SEARCH_RADIUS_PX of the rect, so the lead
  // scan's distance answers the port search without a second scan: the
  // nearest card overall, when within the port radius, is exactly the card
  // a dedicated port-radius scan would find (same tie-breaks).
  const portCard =
    portsPainted && (containedCard ?? (nearestHit && nearestHit.distance <= PORT_SEARCH_RADIUS_PX ? nearestHit.card : null))
  let target: CanvasPointerTarget = { kind: 'none' }
  if (portCard) {
    const port = portAtClientPoint(portCard, viewport, viewportRect, clientX, clientY, measuredCardSizeById)
    if (port) target = { kind: 'card-port', cardId: portCard.id, port }
  }
  if (target.kind === 'none' && containedCard) target = { kind: 'card-body', cardId: containedCard.id }
  const leadCard = containedCard ?? (nearestHit && nearestHit.distance <= leadRadiusPx ? nearestHit.card : null)
  return { target, leadCardId: leadCard?.id ?? null }
}

/**
 * Target-only resolution (the frozen `CanvasPointerTarget` producer) — a
 * thin wrapper over `canvasPointerPointAtClientPoint` for callers that do
 * not need the proximity lead.
 */
export function canvasPointerTargetAtClientPoint({
  candidates,
  viewport,
  viewportRect,
  clientX,
  clientY,
  band,
  measuredCardSizeById,
  cardById,
}: {
  candidates: readonly Card[]
  viewport: BoardViewport
  viewportRect: Pick<DOMRect, 'left' | 'top'>
  clientX: number
  clientY: number
  /** The scene's detail band — decides whether painted ports exist at all. */
  band: DetailBand
  measuredCardSizeById?: (cardId: string) => { width: number; height: number } | undefined
  cardById?: (cardId: string) => Card | undefined
}): CanvasPointerTarget {
  return canvasPointerPointAtClientPoint({
    candidates,
    viewport,
    viewportRect,
    clientX,
    clientY,
    band,
    leadRadiusPx: PORT_SEARCH_RADIUS_PX,
    measuredCardSizeById,
    cardById,
  }).target
}

function portAtClientPoint(
  card: Card,
  viewport: BoardViewport,
  viewportRect: Pick<DOMRect, 'left' | 'top'>,
  clientX: number,
  clientY: number,
  measuredCardSizeById?: (cardId: string) => { width: number; height: number } | undefined,
): 'source' | 'target' | null {
  const safeZoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
  const size = resolvedCardSize(card, measuredCardSizeById?.(card.id))
  const ports = paintedPortGeometry({
    x: card.position.x * safeZoom + viewport.x,
    y: card.position.y * safeZoom + viewport.y,
    width: size.width * safeZoom,
    height: size.height * safeZoom,
  })
  if (ports.radius <= 0) return null
  const pointX = clientX - viewportRect.left
  const pointY = clientY - viewportRect.top
  // Right edge is the source handle, left the target — the same sides the
  // proxy's DOM Handles register (LowZoomCard) and the painter draws.
  if (Math.hypot(pointX - ports.right.x, pointY - ports.right.y) <= ports.radius) return 'source'
  if (Math.hypot(pointX - ports.left.x, pointY - ports.left.y) <= ports.radius) return 'target'
  return null
}

/**
 * Graph-rules connect validation (C3, #320): the pure predicate behind React
 * Flow's `isValidConnection`. Consumes the board GRAPH only — never DOM or
 * proxy existence; a handle that happens not to be mounted is not a
 * validation answer. Delegates admission, orientation, routing, and
 * directional duplicate detection to the graph's connection-addition plan.
 */
export function connectionRulesAllow(
  graph: ConnectionAdditionGraph,
  sourceCardId: string,
  targetCardId: string,
): boolean {
  return planConnectionAddition(graph, sourceCardId, targetCardId) !== null
}

const EMPTY_PARTICIPANT_IDS: ReadonlySet<string> = new Set()

/**
 * The identity-stability guarantee `mountPlanForScene`'s memo depends on
 * (C2, #314): when `ids` matches the previous set's membership, the PREVIOUS
 * instance is returned — a fresh `new Set()` per pointermove would invalidate
 * the mount-plan memo (and rebuild `nodes`) on every mouse coordinate.
 */
export function stableParticipantIdSet(
  previous: ReadonlySet<string>,
  ids: readonly string[],
): ReadonlySet<string> {
  if (ids.length === previous.size && ids.every((id) => previous.has(id))) return previous
  return ids.length ? new Set(ids) : EMPTY_PARTICIPANT_IDS
}

export type CanvasPointerPoint = {
  /** The resolved target under the pointer. */
  target: CanvasPointerTarget
  /** The proximity lead: nearest card within the lead radius, if any. */
  leadCardId: string | null
}

export type CanvasHoverTracker = {
  pointerMove(clientX: number, clientY: number): void
  /** Freezes target and participants for the duration of a press gesture. */
  pointerDown(): void
  pointerUp(): void
  pointerLeave(): void
  /**
   * Enters connect mode (C3, #320): a connect gesture started on the named
   * card's port (React Flow's onConnectStart). The source is frozen as the
   * first participant; pointer-moves lead-mount the candidate target as the
   * second, so its proxy handles exist BEFORE the pointer arrives and React
   * Flow's native snap/preview/validate runs unchanged.
   */
  connectStart(sourceCardId: string): void
  /** Leaves connect mode and re-resolves from the release point. */
  connectEnd(clientX: number, clientY: number): void
  dispose(): void
}

/**
 * The canvas hover tracker: turns raw pane pointer events into the two hot
 * outputs Board feeds downstream — `hoveredCardId` (the painter's hover
 * affordance) and the gesture participant id set (`mountPlanForScene`'s
 * proxy mounts). Both callbacks fire ONLY on identity transitions; a
 * pointer-move with an unchanged target and lead is a pure field update.
 * `resolvePoint` returning null means the canvas is not hover-authoritative
 * right now (Reading band: DOM cards own hover) and the move is ignored.
 */
export function createCanvasHoverTracker({
  resolvePoint,
  onHoveredCardChange,
  onParticipantIdsChange,
  onPointerTargetChange,
  lingerMs = POINTER_LINGER_MS,
  setTimeoutFn = (fn, ms) => window.setTimeout(fn, ms),
  clearTimeoutFn = (handle) => window.clearTimeout(handle),
}: {
  resolvePoint: (clientX: number, clientY: number) => CanvasPointerPoint | null
  onHoveredCardChange: (cardId: string | null) => void
  onParticipantIdsChange: (ids: ReadonlySet<string>) => void
  /**
   * Fires on target identity transitions only — the port-arming seam (C3,
   * #320): Board mirrors `card-port` targets onto the wrapper dataset so the
   * proxy handles accept a press exactly where the painted disc is.
   */
  onPointerTargetChange?: (target: CanvasPointerTarget) => void
  lingerMs?: number
  setTimeoutFn?: (fn: () => void, ms: number) => number
  clearTimeoutFn?: (handle: number) => void
}): CanvasHoverTracker {
  let target: CanvasPointerTarget = { kind: 'none' }
  let hoveredCardId: string | null = null
  let participantIds = EMPTY_PARTICIPANT_IDS
  let lingerHandle: number | null = null
  let gestureLocked = false
  let connectSourceId: string | null = null

  const clearLinger = () => {
    if (lingerHandle !== null) {
      clearTimeoutFn(lingerHandle)
      lingerHandle = null
    }
  }

  const setHovered = (cardId: string | null) => {
    if (cardId === hoveredCardId) return
    hoveredCardId = cardId
    onHoveredCardChange(cardId)
  }

  const setTarget = (next: CanvasPointerTarget) => {
    if (samePointerTarget(next, target)) return
    target = next
    setHovered(next.kind === 'card-body' || next.kind === 'card-port' ? next.cardId : null)
    onPointerTargetChange?.(next)
  }

  const setParticipants = (ids: readonly string[]) => {
    const next = stableParticipantIdSet(participantIds, ids)
    if (next === participantIds) return
    participantIds = next
    onParticipantIdsChange(next)
  }

  const applyLead = (leadCardId: string | null) => {
    if (leadCardId) {
      clearLinger()
      setParticipants([leadCardId])
      return
    }
    if (!participantIds.size || lingerHandle !== null) return
    lingerHandle = setTimeoutFn(() => {
      lingerHandle = null
      if (!gestureLocked) setParticipants([])
    }, lingerMs)
  }

  return {
    pointerMove(clientX, clientY) {
      if (connectSourceId) {
        // Connect mode (C3, #320): hover and the armed port stay frozen; the
        // only live output is the candidate target lead — [source, candidate]
        // in that insertion order, so a candidate change replaces exactly the
        // second participant. Same-candidate moves hit the stable set and
        // touch nothing.
        const point = resolvePoint(clientX, clientY)
        if (!point) return
        const candidateId =
          point.leadCardId && point.leadCardId !== connectSourceId ? point.leadCardId : null
        setParticipants(candidateId ? [connectSourceId, candidateId] : [connectSourceId])
        return
      }
      if (gestureLocked) return
      const point = resolvePoint(clientX, clientY)
      if (!point) return
      setTarget(point.target)
      applyLead(point.leadCardId)
    },
    pointerDown() {
      // A press freezes the hot state: the participant must stay mounted for
      // the whole gesture (dropping it would unmount the node mid-drag), and
      // a pane gesture (marquee, pan) must not churn proxies as it crosses
      // cards. A fresh press also ends any stale connect gesture.
      gestureLocked = true
      connectSourceId = null
      clearLinger()
    },
    pointerUp() {
      gestureLocked = false
    },
    pointerLeave() {
      if (gestureLocked) return
      setTarget({ kind: 'none' })
      applyLead(null)
    },
    connectStart(sourceCardId) {
      connectSourceId = sourceCardId
      gestureLocked = true
      clearLinger()
      setParticipants([sourceCardId])
    },
    connectEnd(clientX, clientY) {
      if (!connectSourceId) return
      connectSourceId = null
      gestureLocked = false
      const point = resolvePoint(clientX, clientY)
      if (!point) {
        applyLead(null)
        return
      }
      setTarget(point.target)
      applyLead(point.leadCardId)
    },
    dispose() {
      clearLinger()
    },
  }
}
