import {
  Background,
  Controls,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useStore,
  useStoreApi,
  useViewport,
  getViewportForBounds,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type Connection as RFConnection,
  type OnConnectEnd,
  type OnConnectStart,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { copyBoardSelection, serializeBoardSelection } from '../graph/boardSemantics'
import { paletteColor } from '../graph/highlights'
import { type ThemeId } from '../ui/tokens'
import { cameraDuration, commitCameraTransition } from '../ui/motion'
import { useDialogs } from '../ui/overlays'
import { Button, Toast } from '../ui/primitives'
import { useGraph, type CanvasTool } from '../graph/store'
import type { Card, Connection } from '../graph/types'
import {
  cardDeepLinkKey,
  formatCardDeepLink,
  parseCardDeepLink,
  stripCardDeepLink,
  type CardDeepLink,
  type CardDeepLinkViewport,
} from '../shared/deepLinks'
import { CARD_LINK_EVENT, type CardLinkEventDetail } from './cardLinks'
import { assetsFromClipboard, clipboardHasSupportedAssets } from '../shared/clipboardAssets'
import {
  linkPreviewUrlFromClipboardText,
  localHtmlPreviewSourceFromClipboardText,
} from '../shared/loadLinkPreview'
import {
  localHtmlDisplayNameFromClipboardText,
  localHtmlPathFromClipboardText,
} from '../shared/linkPreview'
import { subscribeImageRenditionMotion } from '../shared/imageRenditions'
import { words } from '../shared/words'
import { boardKeyboardIntent } from './keyboard'
import { cameraViewportTransform, centeredViewportForCameraTarget } from './cameraViewport'
import { connectionsTouchingRect, type FlowRect } from './connectionMarquee'
import { createMarqueeSelectionState, MarqueeSelectionProvider } from './marqueeSelectionState'
import { createLiveTransitionPulseController } from './liveTransitionPulse'
import {
  boardReleaseSurface,
  cardIdFromEventTarget,
  clientPointHitsPaintedHandle,
  cardActivationDecision,
  createCardSelectionPaintBarrier,
  focusedMarkdownEditorForDifferentDragCapablePress,
  liveCardNodeClassName,
  liveCardNodeData,
  modFaceGestureLiveOwnerIds,
  shouldPanOnScroll,
  useCardActivationOwnership,
  useCardFocusOwnership,
  type CardActivationOwnerSnapshot,
  type CardActivationTrigger,
  type CardResizePreviewEvent,
  type LiveCardNodeData,
  type PlaybackCardNodeData,
} from './cardInteraction'
import {
  cardWithResizeHotGeometry,
  createBoardResizeHotGeometryStore,
  createBoardResizeOuterFramePin,
  createBoardResizeTerminalCoordinator,
  reactFlowNodeMatchesResize,
  resizeHotCardById,
  resizeHotMeasuredCardSizeById,
} from './boardResizeHotGeometry'
import {
  contentAwareMinZoom,
  createBoardRenderIndexCache,
  renderedCardSize,
  resolvedCardSize,
  type BoardRenderIndex,
  type BoardRenderIndexCacheStats,
} from './renderPlanning'

import {
  connectionLimitForZoom,
  createBoardScene,
  createPointerNavigationTracker,
  deriveBoardCardMetrics,
  hitTestSceneCardAtClientPoint,
  hitTestPaintedConnectionsAtClientPoint,
  mountPlanForScene,
  planPaintedConnections,
  READING_BAND_MIN_ZOOM,
  renderLayer,
  type BoardCardMetrics,
  type BoardScene,
  type DetailBand,
  type MountPlan,
} from './boardScene'
import {
  canvasPointerPointAtClientPoint,
  connectionRulesAllow,
  createCanvasHoverTracker,
  paintedPortsHittable,
  POINTER_LEAD_RADIUS_PX,
  type CanvasHoverTracker,
} from './pointerTargets'
import { NoteCard } from './cards/NoteCard'
import { AskAiCard } from './cards/AskAiCard'
import { ResultCard } from './cards/ResultCard'
import { ModCard } from './cards/ModCard'
import { GroupCard } from './cards/GroupCard'
import { ConversationCard } from './cards/ConversationCard'
import { LowZoomCard } from './cards/LowZoomCard'
import { PlaybackCard } from './cards/PlaybackCard'
import { publishResolvedCardEditIntent } from './cards/cardEditIntent'
import { TitleCard } from './cards/TitleCard'
import { ConnectionEdge } from './connections/ConnectionEdge'
import { ConnectionPopover } from './connections/ConnectionPopover'
import { createConnectionEdgeMountRegistry } from './connections/connectionEdgeMountRegistry'
import { connectionPreviewAppearance } from './connections/connectionAppearance'
import { createConnectionHoverTracker } from './connectionHover'
import { executeBoardDeletion } from './boardDeletion'
import {
  connectionBadgeFlowAnchor,
  connectionBadgePaintedAtIndex,
  pointHitsConnectionBadge,
} from './connectionBadgeHit'
import { BoardOverviewLayer, type RenderedCardSize } from './BoardOverviewLayer'
import { cardGrowthMaxHeights } from './resultCardViewport'
import type { ResultPlacementContext } from '../graph/resultCardPlacement'
import {
  cardAccessibilityName,
  focusCardWhenMounted,
  focusMountedCard,
  recoverOrphanedBoardFocus,
} from './cardAccessibility'
import { createLookAheadImageRenditionPrewarmCoordinator } from './imageRenditionPrewarm'
import { residencyViewportMoving } from './cardResidency'
import { memoCardNode } from './memoCardNode'

// React Flow's "nodes/edges" are translated to "cards/connections" right here, at
// the canvas boundary, so the jargon never spreads into the product (Concept 6).
// This file is a thin adapter: it renders the graph and sends edits back through
// store actions. Selection is owned by React Flow (so box-select, shift-select and
// group-drag work) and mirrored to the store's single selection for the dock.

const nodeTypes = {
  note: memoCardNode(NoteCard),
  askAi: memoCardNode(AskAiCard),
  result: memoCardNode(ResultCard),
  mod: memoCardNode(ModCard),
  group: memoCardNode(GroupCard),
  conversation: memoCardNode(ConversationCard),
  title: memoCardNode(TitleCard),
  gestureProxy: LowZoomCard,
}

export const allNodeTypes = {
  ...nodeTypes,
  playbackCard: memoCardNode(PlaybackCard),
}

const edgeTypes = {
  connection: ConnectionEdge,
}

const defaultEdgeOptions = {
  type: 'connection',
}

// The automatic graph-bounds fit (new board, sparse board, single card) must
// never snap the camera all the way to the manual maxZoom ceiling: a lone
// small card would otherwise fill the whole screen. Manual zoom is unaffected
// (see the ReactFlow `maxZoom` prop below).
const BOARD_FIT_MAX_ZOOM = 1.5
const CONNECTION_ZOOM_THRESHOLD = 0.01
// React Flow measures its connect snap radius in FLOW pixels, so its fixed
// default collapses to sub-pixel reach below Reading. Zoom-normalizing holds
// the native snap at a constant ~20 SCREEN px in every band (C3, #320) —
// exactly the default feel at zoom 1.
const CONNECTION_SNAP_SCREEN_PX = 20
const DETAIL_APERTURE_SETTLE_MS = 140
const RENDERED_CARD_SIZE_SETTLE_MS = 120
const RESIZE_SETTLE_STABLE_FRAMES = 2
const RESIZE_SETTLE_MAX_FRAMES = 30
// Any editable a Card can hand a live text cursor to: the markdown body's
// contenteditable, a title input, or a plain textarea (e.g. the Title
// card). Used by the window paste handler to decide Card ownership - see
// its comment below.
const CARD_OWNED_EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]'
const EMPTY_IDS = new Set<string>()
const EMPTY_CONNECTIONS: Connection[] = []
const EMPTY_RENDERED_CARD_SIZES = new Map<string, RenderedCardSize>()

const EMPTY_CARD_GROWTH_MAX_HEIGHTS = new Map<string, number>()
const EMPTY_PROXY_CARD_IDS = new Set<string>()

function unionCardIds(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!left.size) return right
  if (!right.size) return left
  const union = new Set(left)
  for (const cardId of right) union.add(cardId)
  return union
}

function liveProxyCardSize(card: Card, measuredSize?: RenderedCardSize): RenderedCardSize {
  if (
    card.size &&
    Number.isFinite(card.size.width) &&
    Number.isFinite(card.size.height) &&
    card.size.width > 0 &&
    card.size.height > 0
  ) {
    return card.size
  }
  if (
    measuredSize &&
    Number.isFinite(measuredSize.width) &&
    Number.isFinite(measuredSize.height) &&
    measuredSize.width > 0 &&
    measuredSize.height > 0
  ) {
    return measuredSize
  }
  return renderedCardSize(card)
}

type ControlledNodeCache = {
  byId: ReadonlyMap<string, Node>
  nodes: Node[]
}

type ScopedCardNodeData = {
  semanticScopeKey: string
}

type ScopedPlaybackCardNodeData = PlaybackCardNodeData & ScopedCardNodeData

type PlaybackSemanticCardField = Exclude<keyof Card, 'position' | 'zIndex'>

const PLAYBACK_SEMANTIC_CARD_FIELD_RECORD = {
  id: true,
  kind: true,
  createdBy: true,
  lastModifiedBy: true,
  title: true,
  headerColor: true,
  headerFill: true,
  blocks: true,
  assets: true,
  linkPreview: true,
  localHtmlPreview: true,
  compressionPrompt: true,
  modV2: true,
  model: true,
  conversationStyle: true,
  conversationTurns: true,
  source: true,
  agentic: true,
  size: true,
  groupId: true,
  meta: true,
} satisfies Record<PlaybackSemanticCardField, true>

const PLAYBACK_SEMANTIC_CARD_FIELDS = Object.keys(
  PLAYBACK_SEMANTIC_CARD_FIELD_RECORD,
) as PlaybackSemanticCardField[]

function cardSemanticScopeKey(scopeId: string | null, cardId: string): string {
  const prefix = scopeId ?? ''
  return `${prefix.length}:${prefix}:${cardId}`
}

/**
 * Playback renders Card semantics directly from node data instead of using
 * graph subscriptions. Compare its complete semantic record by immutable
 * field identity while deliberately excluding the two shallow layer fields.
 * This must stay exhaustive with Card so a newly rendered semantic field
 * cannot accidentally inherit geometry-blindness.
 */
function playbackCardSemanticEqual(left: Card, right: Card): boolean {
  if (left === right) return true
  for (const field of PLAYBACK_SEMANTIC_CARD_FIELDS) {
    if (!Object.is(left[field], right[field])) return false
  }
  return true
}

function shallowNodeValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => Object.is(leftRecord[key], rightRecord[key]))
  )
}

function controlledNodeEqual(left: Node, right: Node): boolean {
  const leftRecord = left as unknown as Record<string, unknown>
  const rightRecord = right as unknown as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => shallowNodeValueEqual(leftRecord[key], rightRecord[key]))
  )
}

function stablePlaybackNodeData({
  previousNode,
  card,
  ghost,
  semanticScopeKey,
}: {
  previousNode: Node | undefined
  card: Card
  ghost: boolean
  semanticScopeKey: string
}): ScopedPlaybackCardNodeData {
  const previousData = previousNode?.data as Partial<ScopedPlaybackCardNodeData> | undefined
  if (
    previousData?.card &&
    previousData.ghost === ghost &&
    previousData.semanticScopeKey === semanticScopeKey &&
    playbackCardSemanticEqual(previousData.card, card)
  ) {
    return previousData as ScopedPlaybackCardNodeData
  }
  return { card, ghost, semanticScopeKey }
}

function stableLiveNodeData({
  previousNode,
  liveNodeData,
  semanticScopeKey,
}: {
  previousNode: Node | undefined
  liveNodeData: LiveCardNodeData
  semanticScopeKey: string
}): LiveCardNodeData & ScopedCardNodeData {
  const candidate = { ...liveNodeData, semanticScopeKey }
  return previousNode && shallowNodeValueEqual(previousNode.data, candidate)
    ? previousNode.data as LiveCardNodeData & ScopedCardNodeData
    : candidate
}

/**
 * The Board's controlled React Flow node seam. Hot activation/connection
 * metadata may replace the MountPlan object without changing node membership;
 * only the two collections that actually shape nodes are memo inputs. Empty
 * proxy sets are canonicalized because their semantic identity is identical.
 * When one Card changes, unchanged Node objects retain identity so React Flow
 * does not invalidate every mounted NodeWrapper during the hot gesture.
 */
export function useControlledBoardNodes({
  activeTool,
  ghostCardIds,
  liveNodeData,
  liveCardClassName,
  measuredCardSizesById,
  mountPlan,
  readOnly,
  readingOpacity = 1,
  semanticScopeId = null,
  cardById,
  cardOrder,
  cardGrowthMaxHeightsById = EMPTY_CARD_GROWTH_MAX_HEIGHTS,
  selectedNodeIds,
  interactionSelectedNodeIds = selectedNodeIds,
  liveTransitionCardIds = EMPTY_IDS,
}: {
  activeTool: CanvasTool
  ghostCardIds: ReadonlySet<string>
  liveNodeData: LiveCardNodeData
  liveCardClassName: (card: Card) => string | undefined
  measuredCardSizesById: ReadonlyMap<string, RenderedCardSize>
  mountPlan: MountPlan
  readOnly: boolean
  readingOpacity?: number
  semanticScopeId?: string | null
  cardById: (cardId: string) => Card | undefined
  cardOrder?: (cardId: string) => number | undefined
  cardGrowthMaxHeightsById?: ReadonlyMap<string, number>
  selectedNodeIds: ReadonlySet<string>
  /**
   * Editor/Live selection authority, intentionally one paint behind visual
   * selection while an S/O handoff or outgoing deselection settles.
   */
  interactionSelectedNodeIds?: ReadonlySet<string>
  liveTransitionCardIds?: ReadonlySet<string>
}): Node[] {
  const mountedCards = mountPlan.mountedCards
  const proxyCardIds = mountPlan.proxyCardIds.size ? mountPlan.proxyCardIds : EMPTY_PROXY_CARD_IDS
  const nodeCacheRef = useRef<ControlledNodeCache | null>(null)

  // A resize changes only the 0–2 hot proxy cards below Reading. Key their
  // geometry separately so measurements do not rebuild the Reading node set.
  let gestureProxyGeometryKey = ''
  for (const cardId of proxyCardIds) {
    const card = cardById(cardId)
    if (!card) continue
    const size = liveProxyCardSize(card, measuredCardSizesById.get(cardId))
    gestureProxyGeometryKey += `${cardId}:${card.position.x}:${card.position.y}:${size.width}:${size.height}|`
  }

  return useMemo(
    () => {
      const previous = nodeCacheRef.current
      // Selection cardinality is relevant only to selected Cards: it decides
      // whether their editing controls may activate. Normalize it away for
      // every unselected node so adding another Card to the selection does not
      // replace or reconcile unrelated Card nodes.
      const selectedLiveNodeData = liveNodeData.semanticSelected === true
        ? liveNodeData
        : { ...liveNodeData, semanticSelected: true }
      const unselectedLiveNodeData = {
        ...liveNodeData,
        selectedCardCount: 0,
        semanticSelected: false,
      }
      const candidates = mountedCards
        .map((card, index) => {
          const graphOrder = cardOrder?.(card.id) ?? index
          return {
            card,
            index,
            graphOrder,
            // Residency priority changes as the viewport moves. Keep fallback
            // layering and equal-layer ties anchored to graph order so React
            // Flow cannot reinsert a still-mounted Card and clear native
            // scroll or focus state in its body.
            layer: renderLayer(card, graphOrder),
          }
        })
        .sort((a, b) => a.layer - b.layer || a.graphOrder - b.graphOrder || a.index - b.index)
        .map(({ card: mountedCard, layer }) => {
          const type = readOnly
            ? 'playbackCard'
            : proxyCardIds.has(mountedCard.id)
              ? 'gestureProxy'
              : mountedCard.kind
          const card = type === 'gestureProxy' ? (cardById(mountedCard.id) ?? mountedCard) : mountedCard
          const proxySize =
            type === 'gestureProxy' ? liveProxyCardSize(card, measuredCardSizesById.get(card.id)) : undefined
          const growthMaxHeight = cardGrowthMaxHeightsById.get(card.id)
          const selected = !readOnly && selectedNodeIds.has(card.id)
          const interactionSelected = !readOnly && interactionSelectedNodeIds.has(card.id)
          const semanticCard = type !== 'gestureProxy'
          const previousNode = previous?.byId.get(card.id)
          const semanticScopeKey = cardSemanticScopeKey(semanticScopeId, card.id)
          const cardLiveNodeData = interactionSelected
            ? selectedLiveNodeData
            : unselectedLiveNodeData
          const nodeData = readOnly
            ? stablePlaybackNodeData({
                previousNode,
                card,
                ghost: ghostCardIds.has(card.id),
                semanticScopeKey,
              })
            : stableLiveNodeData({
                previousNode,
                liveNodeData: cardLiveNodeData,
                semanticScopeKey,
              })
          const node: Node = {
            id: card.id,
            type,
            position: card.position,
            // Keep React Flow's current footprint on controlled-node
            // replacements. When a resize commit swaps the Card object,
            // adoptUserNodes otherwise treats an omitted `measured` field as
            // an instruction to clear both the measurement and handle bounds,
            // transiently unmounting every incident EdgeWrapper until the
            // ResizeObserver runs again. The observer remains authoritative:
            // its dimension change updates this map, while unchanged node
            // arrays stay identity-stable between measurements.
            measured: measuredCardSizesById.get(card.id),
            data: nodeData,
            selected,
            focusable: semanticCard,
            ariaRole: semanticCard ? 'group' : undefined,
            ariaLabel: semanticCard ? cardAccessibilityName(card, selected) : undefined,
            domAttributes: semanticCard
              ? {
                  'aria-roledescription': words.cardTitle,
                  ...(liveTransitionCardIds.has(card.id)
                    ? { 'data-live-transition': 'loading' }
                    : {}),
                }
              : { 'aria-hidden': true },
            draggable: !readOnly && activeTool === 'select',
            selectable: !readOnly && activeTool === 'select',
            connectable: !readOnly && activeTool === 'select',
            className: readOnly
              ? `playback-node ${ghostCardIds.has(mountedCard.id) ? 'timeline-ghost-node' : 'timeline-live-node'}`
              : type === 'gestureProxy'
                ? liveCardClassName(mountedCard)
                : ['eido-visual-card-node', liveCardClassName(mountedCard)].filter(Boolean).join(' '),
            style: {
              // Standard opacity on React Flow's shallow node keeps the
              // Reading crossfade out of every rich semantic descendant.
              opacity: semanticCard ? readingOpacity : undefined,
              width:
                type === 'gestureProxy'
                  ? proxySize!.width
                  : renderedCardSize(card).width,
              height: type === 'gestureProxy' ? proxySize!.height : card.size?.height,
              zIndex: layer,
              ...(growthMaxHeight === undefined
                ? {}
                : { '--e-card-growth-max-height': `${growthMaxHeight}px` }),
            },
          }
          return node
        })
      const byId = new Map<string, Node>()
      const nodes = candidates.map((node) => {
        const cached = previous?.byId.get(node.id)
        const shared = cached && controlledNodeEqual(cached, node) ? cached : node
        byId.set(node.id, shared)
        return shared
      })
      const sharedNodes =
        previous?.nodes.length === nodes.length &&
        nodes.every((node, index) => node === previous.nodes[index])
          ? previous.nodes
          : nodes
      nodeCacheRef.current = { byId, nodes: sharedNodes }
      return sharedNodes
    },
    // Measurements affect only proxy geometry, represented by the key.
    // MountPlan itself is deliberately absent: live-owner/activation metadata
    // cannot rebuild the controlled node array when membership is unchanged.
    [
      activeTool,
      cardById,
      cardOrder,
      ghostCardIds,
      liveCardClassName,
      liveNodeData,
      liveTransitionCardIds,
      interactionSelectedNodeIds,
      gestureProxyGeometryKey,
      mountedCards,
      proxyCardIds,
      readOnly,
      readingOpacity,
      semanticScopeId,
      cardGrowthMaxHeightsById,
      selectedNodeIds,
    ],
  )
}

// The one fly-to shape shared by every "centre on this card" jump — deep-link
// follow, Highlights-panel focus, and below-Reading double-click. It lands the
// camera on the card's centre AT or above Reading (READING_BAND_MIN_ZOOM), and
// never zooms past 1.25, so a double-click from Map always ends up readable
// while a jump already inside the window keeps its zoom. The centre comes from
// renderedCardSize — the SAME per-kind defaults the painter uses — so group
// (360×360) and title (320×82) cards land centred, not offset by a note-shaped
// guess.
function cardFlyToTarget(card: Card, currentZoom: number) {
  const { width, height } = renderedCardSize(card)
  return {
    x: card.position.x + width / 2,
    y: card.position.y + height / 2,
    zoom: Math.max(READING_BAND_MIN_ZOOM, Math.min(1.25, currentZoom || 1)),
    duration: 360,
  }
}

type ViewSnapshot = {
  ideaId: string
  viewport: CardDeepLinkViewport
}

type EidoHistoryState = {
  eidoKind?: 'viewport' | 'deepLink'
  eidoSnapshot?: ViewSnapshot
  eidoNavStack?: ViewSnapshot[]
  eidoLinkKey?: string
}

type ResizeColdSnapshot = {
  renderIndex: BoardRenderIndexCacheStats
  rankEpoch: number
}

type ResizeColdDelta = {
  renderIndexDelta: {
    gets: number
    incrementalUpdates: number
    cardsPatched: number
    boundsUpdated: number
    fullRebuilds: BoardRenderIndexCacheStats['fullRebuilds']
  }
  rankEpochDelta: number
}

function resizeColdDelta(
  start: ResizeColdSnapshot | null,
  current: ResizeColdSnapshot | null,
): ResizeColdDelta {
  if (!start || !current) {
    return {
      renderIndexDelta: {
        gets: 0,
        incrementalUpdates: 0,
        cardsPatched: 0,
        boundsUpdated: 0,
        fullRebuilds: { initial: 0, cardStructure: 0, connections: 0 },
      },
      rankEpochDelta: 0,
    }
  }
  return {
    renderIndexDelta: {
      gets: current.renderIndex.gets - start.renderIndex.gets,
      incrementalUpdates:
        current.renderIndex.incrementalUpdates - start.renderIndex.incrementalUpdates,
      cardsPatched: current.renderIndex.cardsPatched - start.renderIndex.cardsPatched,
      boundsUpdated: current.renderIndex.boundsUpdated - start.renderIndex.boundsUpdated,
      fullRebuilds: {
        initial: current.renderIndex.fullRebuilds.initial - start.renderIndex.fullRebuilds.initial,
        cardStructure:
          current.renderIndex.fullRebuilds.cardStructure -
          start.renderIndex.fullRebuilds.cardStructure,
        connections:
          current.renderIndex.fullRebuilds.connections - start.renderIndex.fullRebuilds.connections,
      },
    },
    rankEpochDelta: current.rankEpoch - start.rankEpoch,
  }
}

declare global {
  interface Window {
    __EIDO_SET_VIEWPORT__?: (viewport: CardDeepLinkViewport) => void
    __EIDO_SET_GESTURE_PARTICIPANTS__?: (cardIds: readonly string[]) => void
    /** Candidate-only, content-free diagnostic for one Card's live owners. */
    __EIDO_CARD_ACTIVATION_OWNER_SNAPSHOT__?: (cardId: string) => CardActivationOwnerSnapshot
    /**
     * Dev-only observability: total `mountPlanForScene` recomputations. The
     * pointer-storm gate asserts a zero delta across a same-target storm —
     * the seam-level proof that participant-set identity stability actually
     * protects the mount plan (and the `nodes` array built from it); a
     * fresh Set per pointermove would tick this on every event.
     */
    __EIDO_MOUNT_PLAN_DERIVATIONS__?: number
    /** Held-resize proof that the adapter never wakes React Flow's store. */
    __EIDO_RESIZE_RF_DIAGNOSTIC__?: {
      notifications: number
      dimensionChanges: number
      measuredMapClones: number
      snapshot: () => ResizeColdDelta
    }
  }
}

const MAX_VIEW_STACK = 20

function afterAnimationFrames(count: number, fn: () => void): () => void {
  let cancelled = false
  let frame = 0
  const step = () => {
    if (cancelled) return
    if (count <= 0) {
      fn()
      return
    }
    count -= 1
    frame = window.requestAnimationFrame(step)
  }
  frame = window.requestAnimationFrame(step)
  return () => {
    cancelled = true
    window.cancelAnimationFrame(frame)
  }
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

function unionIds(a: ReadonlySet<string>, b: ReadonlySet<string> | null): Set<string> {
  if (!b?.size) return new Set(a)
  return new Set([...a, ...b])
}

function flowRectBetween(start: { x: number; y: number }, end: { x: number; y: number }): FlowRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

function cardIdsTouchingRect({
  cards,
  measuredCardSizeById,
  rect,
}: {
  cards: readonly Card[]
  measuredCardSizeById: (cardId: string) => RenderedCardSize | undefined
  rect: FlowRect
}): Set<string> {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const touched = new Set<string>()
  for (const card of cards) {
    const size = resolvedCardSize(card, measuredCardSizeById(card.id))
    if (
      card.position.x + size.width < rect.x ||
      card.position.x > right ||
      card.position.y + size.height < rect.y ||
      card.position.y > bottom
    ) {
      continue
    }
    touched.add(card.id)
  }
  return touched
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function hasDocumentTextSelection(): boolean {
  const selection = typeof window === 'undefined' ? null : window.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0)
}

function isViewport(value: unknown): value is CardDeepLinkViewport {
  if (!value || typeof value !== 'object') return false
  const maybe = value as Partial<CardDeepLinkViewport>
  return Number.isFinite(maybe.x) && Number.isFinite(maybe.y) && Number.isFinite(maybe.zoom)
}

function isViewSnapshot(value: unknown): value is ViewSnapshot {
  if (!value || typeof value !== 'object') return false
  const maybe = value as Partial<ViewSnapshot>
  return typeof maybe.ideaId === 'string' && Boolean(maybe.ideaId) && isViewport(maybe.viewport)
}

function historyState(): EidoHistoryState {
  return window.history.state && typeof window.history.state === 'object'
    ? (window.history.state as EidoHistoryState)
    : {}
}

function historyStack(state = historyState()): ViewSnapshot[] {
  return Array.isArray(state.eidoNavStack)
    ? state.eidoNavStack.filter(isViewSnapshot).slice(-MAX_VIEW_STACK)
    : []
}

function pushDeepLinkHistory(link: CardDeepLink, snapshot: ViewSnapshot): ViewSnapshot[] {
  const state = historyState()
  const stack = historyStack(state)
  const nextStack = [...stack, snapshot].slice(-MAX_VIEW_STACK)
  const plainHref = stripCardDeepLink(window.location.href)
  window.history.replaceState(
    { eidoKind: 'viewport', eidoSnapshot: snapshot, eidoNavStack: stack } satisfies EidoHistoryState,
    '',
    plainHref,
  )
  window.history.pushState(
    { eidoKind: 'deepLink', eidoLinkKey: cardDeepLinkKey(link), eidoNavStack: nextStack } satisfies EidoHistoryState,
    '',
    formatCardDeepLink(plainHref, link),
  )
  return nextStack
}

export function Board({
  theme,
  reducedMotion,
  cards: projectedCards,
  connections: projectedConnections,
  readOnly = false,
  ghostCardIds = EMPTY_IDS,
  ghostConnectionIds = EMPTY_IDS,
  resumeViewport = null,
}: {
  theme: ThemeId
  reducedMotion: boolean
  cards?: Card[]
  connections?: Connection[]
  readOnly?: boolean
  ghostCardIds?: ReadonlySet<string>
  ghostConnectionIds?: ReadonlySet<string>
  resumeViewport?: Viewport | null
}) {
  const liveCards = useGraph((s) => s.cards)
  const liveConnections = useGraph((s) => s.connections)
  const cards = projectedCards ?? liveCards
  const connections = projectedConnections ?? liveConnections
  const outputs = useGraph((s) => s.outputs)
  const runs = useGraph((s) => s.runs)
  const lastBoardChange = useGraph((s) => s.lastBoardChange)
  const ideas = useGraph((s) => s.ideas)
  const currentIdeaId = useGraph((s) => s.currentIdeaId)
  const hydrated = useGraph((s) => s.hydrated)
  const loadIdea = useGraph((s) => s.loadIdea)
  const addCard = useGraph((s) => s.addCard)
  const addNoteWithLinkPreview = useGraph((s) => s.addNoteWithLinkPreview)
  const addNoteWithLocalHtmlPreview = useGraph((s) => s.addNoteWithLocalHtmlPreview)
  const addCardAssets = useGraph((s) => s.addCardAssets)
  const setCardText = useGraph((s) => s.setCardText)
  const moveCards = useGraph((s) => s.moveCards)
  const recordCardStructuralChange = useGraph((s) => s.recordCardStructuralChange)
  const addConnection = useGraph((s) => s.addConnection)
  const deleteCard = useGraph((s) => s.deleteCard)
  const deleteConnection = useGraph((s) => s.deleteConnection)
  const deleteConnections = useGraph((s) => s.deleteConnections)
  const copyCards = useGraph((s) => s.copyCards)
  const pasteCards = useGraph((s) => s.pasteCards)
  const select = useGraph((s) => s.select)
  const setSelectedCardIds = useGraph((s) => s.setSelectedCardIds)
  const connectionEditorId = useGraph((s) => s.connectionEditorId)
  const openConnectionEditor = useGraph((s) => s.openConnectionEditor)
  const closeConnectionEditor = useGraph((s) => s.closeConnectionEditor)
  const dialogs = useDialogs()
  const activeTool = useGraph((s) => s.activeTool)
  const setActiveTool = useGraph((s) => s.setActiveTool)
  const cardFocusRequest = useGraph((s) => s.cardFocusRequest)
  const { getViewport, screenToFlowPosition, setCenter, setViewport } = useReactFlow()
  const reactFlowStore = useStoreApi()
  const resizeHotGeometryStore = useMemo(() => createBoardResizeHotGeometryStore(), [])
  const resizeOuterFramePin = useMemo(() => createBoardResizeOuterFramePin(), [])
  const resizeRfDiagnosticUnsubscribeRef = useRef<(() => void) | null>(null)
  const resizeRfDimensionChangesRef = useRef(0)
  const resizeMeasuredMapClonesRef = useRef(0)
  const resizeColdSnapshotRef = useRef<() => ResizeColdSnapshot | null>(() => null)
  const reportCardResizePreview = useCallback((
    cardId: string,
    event: CardResizePreviewEvent,
    nodeElement: HTMLElement | null,
  ) => {
    // Pin before CardShell's local preview state can commit. Writing the same
    // begin dimensions is a no-op box-wise, so React Flow's ResizeObserver
    // stays asleep while the child Card follows the pointer.
    resizeOuterFramePin.receive(cardId, event, nodeElement)
    resizeHotGeometryStore.receive(cardId, event)
    if (!import.meta.env.DEV) return
    if (event.type === 'begin') {
      resizeRfDiagnosticUnsubscribeRef.current?.()
      resizeRfDimensionChangesRef.current = 0
      resizeMeasuredMapClonesRef.current = 0
      const start = resizeColdSnapshotRef.current()
      window.__EIDO_RESIZE_RF_DIAGNOSTIC__ = {
        notifications: 0,
        dimensionChanges: 0,
        measuredMapClones: 0,
        snapshot: () => resizeColdDelta(start, resizeColdSnapshotRef.current()),
      }
      resizeRfDiagnosticUnsubscribeRef.current = reactFlowStore.subscribe(() => {
        const diagnostic = window.__EIDO_RESIZE_RF_DIAGNOSTIC__
        if (diagnostic) diagnostic.notifications += 1
      })
      return
    }
    if (event.type === 'commit' || event.type === 'abort') {
      resizeRfDiagnosticUnsubscribeRef.current?.()
      resizeRfDiagnosticUnsubscribeRef.current = null
    }
  }, [reactFlowStore, resizeHotGeometryStore, resizeOuterFramePin])
  useEffect(() => () => {
    resizeRfDiagnosticUnsubscribeRef.current?.()
    resizeHotGeometryStore.dispose()
    resizeOuterFramePin.dispose()
    delete window.__EIDO_RESIZE_RF_DIAGNOSTIC__
  }, [resizeHotGeometryStore, resizeOuterFramePin])
  const viewport = useViewport()
  const { zoom } = viewport
  // S1's bounded Reading residency and S2's Live activation are the
  // production editable-Board path.
  const liveActivationEnabled = !readOnly
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  }))
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  // The exact text this app most recently wrote to the SYSTEM clipboard for a
  // Card copy. The system clipboard is the authority for which copy is
  // newest: the internal Card clipboard is only trusted at paste time when
  // the system clipboard still carries this exact payload (see onPaste
  // below). This is what stops a Card copy from permanently hijacking every
  // later paste once the founder copies something else.
  const lastCardsClipboardTextRef = useRef<string | null>(null)
  const dragStartCardsRef = useRef<Card[] | null>(null)
  const lowLodSelectionDragStartRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  // Per-frame drag coalescing (#213): pointer events land here (latest
  // position per card wins) and commit once per animation frame, so a high-
  // polling-rate mouse commits at display rate instead of event rate.
  const pendingDragMovesRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  const dragFlushFrameRef = useRef<number | null>(null)
  const pendingIdeaLoadRef = useRef<string | null>(null)
  const appliedDeepLinkRef = useRef<string | null>(null)
  const pendingDeepLinkViewportRef = useRef<(() => void) | null>(null)
  const restoredSnapshotRef = useRef<string | null>(null)
  const programmaticSelectionRef = useRef<string | null>(null)
  // The Board-level editor host has no midpoint pill (the badge is painted on
  // the canvas), so `ConnectionPopover`'s click-away pill guard gets a null
  // ref — only clicks inside the popover itself are held.
  const connectionEditorHostPillRef = useRef<HTMLButtonElement>(null)
  const boardDeletionPendingRef = useRef(false)
  // Set while a drag-selection box is in progress (onSelectionStart ->
  // onSelectionEnd); holds the box's start corner in flow coordinates.
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null)
  // React Flow computes box selection on every pointer move. Keep that
  // provisional result out of the controlled node props until the gesture is
  // complete: publishing it mid-drag rebuilds the nodes array, leaving its
  // bounds briefly unmeasured and making React Flow treat every node as inside
  // the next selection rectangle.
  const marqueeSelectedNodeIdsRef = useRef<Set<string> | null>(null)
  // Reading can mix mounted P/O/L Cards with painter-owned S Cards. React Flow
  // reports only the mounted half; this gesture-local set carries the S half
  // so ownership transitions cannot change which Cards the same rect selects.
  const marqueePaintedCardIdsRef = useRef<Set<string> | null>(null)
  // The selection the box is replacing. React Flow re-adopts `selected` from
  // the controlled node array on every rebuild, so a rebuild landing mid-drag
  // republishes this outgoing set as though the box had just chosen it. A new
  // box never inherits the old selection: an outgoing id is accepted again
  // only when the rectangle itself touches the Card.
  const marqueeOutgoingCardIdsRef = useRef<ReadonlySet<string>>(EMPTY_IDS)
  // A pane press that starts a marquee also starts the browser's own native
  // text-selection drag, which paints a blue wash over every mounted Card the
  // box crosses. The box selects Cards, never their contents, so the press's
  // default action is refused at the following `mousedown`. Latched on
  // `pointerdown` (which precedes `mousedown`) so the refusal matches exactly
  // the press that begins a marquee, and never an ordinary press inside a Card.
  const marqueePressRef = useRef(false)
  const additiveSelectionStartRef = useRef<Set<string> | null>(null)
  const additiveModifierHeldRef = useRef(false)
  const handledLowLodAdditivePressRef = useRef(false)
  const marqueePreviewPointerRef = useRef<{ x: number; y: number } | null>(null)
  const marqueePreviewFrameRef = useRef<number | null>(null)
  const handledFocusRequestRef = useRef(0)
  const previousSceneRef = useRef<BoardScene | null>(null)
  const previousCardMetricsRef = useRef<BoardCardMetrics | null>(null)
  const imagePrewarmCoordinator = useMemo(createLookAheadImageRenditionPrewarmCoordinator, [])
  // The live canvas hover/connect tracker, held for React Flow's connect
  // callbacks (onConnectStart/onConnectEnd) to reach without re-subscribing
  // the pointer listeners.
  const hoverTrackerRef = useRef<CanvasHoverTracker | null>(null)
  // Whole-Card connection acceptance is transient chrome, not Board state.
  // Resolve it at most once per frame during a connect gesture and mark only
  // the accepting DOM Card, so pointer storms never rebuild nodes or Cards.
  const connectionDragOriginRef = useRef<{
    cardId: string
    handleType: 'source' | 'target'
  } | null>(null)
  const connectionDropCandidateElementRef = useRef<HTMLElement | null>(null)
  const connectionDropCandidateHandleRef = useRef<'source' | 'target' | null>(null)
  const connectionDropTargetElementRef = useRef<HTMLElement | null>(null)
  const connectionDropFeedbackPointRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const connectionDropFeedbackFrameRef = useRef<number | null>(null)
  const paintConnectionDropTarget = useCallback((cardNode: HTMLElement | null) => {
    const previous = connectionDropTargetElementRef.current
    const origin = connectionDragOriginRef.current
    const acceptingHandle = origin?.handleType === 'source' ? 'target' : 'source'
    // Same Card, same gesture direction: no graph read and no DOM write.
    if (
      connectionDropCandidateElementRef.current === cardNode &&
      connectionDropCandidateHandleRef.current === acceptingHandle
    ) return
    connectionDropCandidateElementRef.current = cardNode
    connectionDropCandidateHandleRef.current = acceptingHandle
    const candidateCardId = cardNode?.dataset.id ?? null
    const sourceCardId = origin?.handleType === 'source' ? origin.cardId : candidateCardId
    const targetCardId = origin?.handleType === 'source' ? candidateCardId : origin?.cardId ?? null
    const accepted = Boolean(
      origin &&
      cardNode &&
      candidateCardId !== origin.cardId &&
      sourceCardId &&
      targetCardId &&
      connectionRulesAllow(useGraph.getState().graph(), sourceCardId, targetCardId),
    )
    const next = accepted ? cardNode : null
    if (previous) delete previous.dataset.connectionDropTarget
    if (next) next.dataset.connectionDropTarget = acceptingHandle
    connectionDropTargetElementRef.current = next
  }, [])
  const hideConnectionDropFeedback = useCallback(() => {
    connectionDropFeedbackPointRef.current = null
    if (connectionDropFeedbackFrameRef.current !== null) {
      window.cancelAnimationFrame(connectionDropFeedbackFrameRef.current)
      connectionDropFeedbackFrameRef.current = null
    }
    paintConnectionDropTarget(null)
  }, [paintConnectionDropTarget])
  const endConnectionDropFeedback = useCallback(() => {
    hideConnectionDropFeedback()
    connectionDragOriginRef.current = null
    const boardRoot = wrapRef.current
    if (boardRoot) delete boardRoot.dataset.connectionDragActive
  }, [hideConnectionDropFeedback])
  const scheduleConnectionDropFeedback = useCallback((clientX: number, clientY: number) => {
    if (!connectionDragOriginRef.current) return
    connectionDropFeedbackPointRef.current = { clientX, clientY }
    if (connectionDropFeedbackFrameRef.current !== null) return
    connectionDropFeedbackFrameRef.current = window.requestAnimationFrame(() => {
      connectionDropFeedbackFrameRef.current = null
      const point = connectionDropFeedbackPointRef.current
      const boardRoot = wrapRef.current
      if (!point || !boardRoot) {
        paintConnectionDropTarget(null)
        return
      }
      const hit = document.elementFromPoint(point.clientX, point.clientY)
      const releaseSurface = hit
        ? boardReleaseSurface([hit], boardRoot)
        : { kind: 'blocked' as const }
      const cardNode = releaseSurface.kind === 'card'
        ? hit?.closest<HTMLElement>('.react-flow__node[data-id]') ?? null
        : null
      paintConnectionDropTarget(cardNode && boardRoot.contains(cardNode) ? cardNode : null)
    })
  }, [paintConnectionDropTarget])
  const activeHighlightBg = useGraph((s) => {
    const tag = s.highlightTags.find((t) => t.id === s.activeHighlightTagId)
    return tag ? paletteColor(tag.color).bg : undefined
  })
  const connectionPreview = connectionPreviewAppearance()
  const boardStyle = {
    '--e-connection-preview-stroke-width': connectionPreview.strokeWidth,
    '--e-connection-preview-stroke-dasharray': connectionPreview.dash.join(' '),
    '--e-connection-preview-opacity': connectionPreview.opacity,
    // The text-selection wash previews the active highlighter tag's color.
    ...(activeHighlightBg ? { '--active-highlight-bg': activeHighlightBg } : {}),
  } as CSSProperties

  // Selection lives here so React Flow can manage multi-select; we mirror the
  // single-select case into the store so the bottom dock can show its controls.
  // Cards and connections are selected symmetrically (#212): both are sets,
  // and they coexist.
  const [selectedNodeIds, setSelectedNodeIdsState] = useState<Set<string>>(new Set())
  // Visual selection is immediate. Editor/Live selection follows only after
  // the browser has had one opportunity to paint that outline, so switching
  // away from a giant Card cannot hide the user's feedback behind teardown.
  const [interactionSelectedNodeIds, setInteractionSelectedNodeIds] =
    useState<ReadonlySet<string>>(EMPTY_IDS)
  const interactionSelectedNodeIdsRef = useRef<ReadonlySet<string>>(EMPTY_IDS)
  interactionSelectedNodeIdsRef.current = interactionSelectedNodeIds
  const selectedNodeIdsRef = useRef<ReadonlySet<string>>(selectedNodeIds)
  selectedNodeIdsRef.current = selectedNodeIds
  const selectionPaintBarrier = useMemo(
    () => createCardSelectionPaintBarrier({
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (frame) => window.cancelAnimationFrame(frame),
    }),
    [],
  )
  useEffect(() => () => selectionPaintBarrier.cancel(), [selectionPaintBarrier])
  // Deferred cross-plane reconciliation captures this revision so it cannot
  // resurrect an older selection after a newer interaction intent.
  const selectionIntentRevisionRef = useRef(0)
  const setSelectedNodeIds: typeof setSelectedNodeIdsState = useCallback((next) => {
    selectionIntentRevisionRef.current += 1
    setSelectedNodeIdsState(next)
  }, [])
  useLayoutEffect(() => {
    // Changing tools is a newer interaction intent even when it preserves the
    // selected-id set. Invalidate any reconciliation queued by the old tool.
    selectionIntentRevisionRef.current += 1
  }, [activeTool])
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set())
  const lastCardSelectionRef = useRef<ReadonlySet<string>>(selectedNodeIds)
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null)
  // Cmd/Ctrl+A selects graph semantics, not React Flow nodes. Selected node ids
  // are #556 Live owners; filling that set with the whole Board would defeat
  // bounded residency merely to prepare a copy command.
  const [wholeBoardSelected, setWholeBoardSelected] = useState(false)
  const marqueeSelectionState = useMemo(() => createMarqueeSelectionState(), [])

  const applyCardSetSelection = useCallback((
    nextIds: ReadonlySet<string>,
    primaryCardId: string,
  ) => {
    const selectedIds = new Set(nextIds)
    lastCardSelectionRef.current = selectedIds
    // The intent revision was claimed when this immediate/deferred commit was
    // scheduled. Applying it must not supersede sibling work from that intent.
    setSelectedNodeIdsState(selectedIds)
    setSelectedConnectionIds(new Set())
    setSelectedCardIds([...selectedIds])
    select({ kind: 'card', id: primaryCardId })
  }, [select, setSelectedCardIds])

  const commitCardSetSelection = useCallback((
    nextIds: ReadonlySet<string>,
    primaryCardId: string,
    deferUntilNextFrame = false,
  ) => {
    const selectedIds = new Set(nextIds)
    const expectedRevision = selectionIntentRevisionRef.current + 1
    selectionIntentRevisionRef.current = expectedRevision
    const commit = () => applyCardSetSelection(selectedIds, primaryCardId)
    if (deferUntilNextFrame) {
      requestAnimationFrame(() => {
        if (selectionIntentRevisionRef.current === expectedRevision) commit()
      })
    }
    else commit()
  }, [applyCardSetSelection])

  useLayoutEffect(() => {
    if (selectedNodeIds.size > 0) lastCardSelectionRef.current = selectedNodeIds
  }, [selectedNodeIds])

  useEffect(() => {
    const updateModifier = (event: KeyboardEvent) => {
      // Chromium may still report the released modifier's boolean as true on
      // that modifier's own keyup. Exclude the terminal key explicitly so the
      // reconciliation below always runs.
      const releasedKey = event.type === 'keyup' ? event.key : null
      const held =
        (event.shiftKey && releasedKey !== 'Shift') ||
        (event.metaKey && releasedKey !== 'Meta' && releasedKey !== 'OS') ||
        (event.ctrlKey && releasedKey !== 'Control')
      if (held && !additiveModifierHeldRef.current) {
        // Capture the existing selection when the modifier is pressed, before
        // pointer proximity can mount a proxy and make React Flow publish its
        // DOM-only selection plane.
        additiveSelectionStartRef.current = new Set([
          ...lastCardSelectionRef.current,
          ...useGraph.getState().selectedCardIds,
        ])
      } else if (
        !held &&
        (additiveModifierHeldRef.current || additiveSelectionStartRef.current !== null)
      ) {
        // The library may publish its proxy-only result after the pointer
        // callbacks. Modifier release is the terminal signal: reconcile once
        // more against that final graph set before forgetting the base.
        const currentIds = useGraph.getState().selectedCardIds
        const baseIds = additiveSelectionStartRef.current
        if (baseIds?.size && currentIds.length) {
          const union = new Set([...baseIds, ...currentIds])
          const expectedRevision = selectionIntentRevisionRef.current + 1
          selectionIntentRevisionRef.current = expectedRevision
          // React Flow can publish its proxy-only click result from its own
          // next-frame work after the native key event. Reconcile one frame
          // beyond that work so this cross-plane union is terminal.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (selectionIntentRevisionRef.current === expectedRevision) {
                applyCardSetSelection(union, currentIds[currentIds.length - 1]!)
              }
            })
          })
        }
        additiveSelectionStartRef.current = null
      }
      additiveModifierHeldRef.current = held
    }
    const clearModifier = () => {
      additiveModifierHeldRef.current = false
      additiveSelectionStartRef.current = null
    }
    window.addEventListener('keydown', updateModifier)
    window.addEventListener('keyup', updateModifier)
    window.addEventListener('blur', clearModifier)
    return () => {
      window.removeEventListener('keydown', updateModifier)
      window.removeEventListener('keyup', updateModifier)
      window.removeEventListener('blur', clearModifier)
    }
  }, [applyCardSetSelection])

  // A Card reads its committed selection from the node data's
  // `semanticSelected`, which the selection paint barrier publishes one paint
  // AFTER the visual selection moves. Handing the Cards straight back to that
  // value at gesture end therefore repaints the outgoing selection (its
  // outline, corner dots and grab cursor) for the frames the barrier is still
  // catching up. So the gesture channel stays the publisher, carrying the
  // committed result, until the Card data agrees with it.
  const marqueeSettlePendingRef = useRef(false)
  const settleMarqueeSelection = useCallback(() => {
    if (!marqueeSelectionState.isActive()) {
      marqueeSettlePendingRef.current = false
      return
    }
    const committed = selectedNodeIdsRef.current
    if (!sameIds(interactionSelectedNodeIdsRef.current, committed)) {
      marqueeSettlePendingRef.current = true
      marqueeSelectionState.setCards(committed)
      return
    }
    marqueeSettlePendingRef.current = false
    marqueeSelectionState.deactivate()
  }, [marqueeSelectionState])
  useLayoutEffect(() => {
    if (marqueeSettlePendingRef.current) settleMarqueeSelection()
  }, [interactionSelectedNodeIds, settleMarqueeSelection])
  // A new gesture supersedes a settle still waiting on the old one.
  const endMarqueeSettle = useCallback(() => {
    if (!marqueeSettlePendingRef.current) return
    marqueeSettlePendingRef.current = false
    marqueeSelectionState.deactivate()
  }, [marqueeSelectionState])

  const clearMarqueePreview = useCallback(() => {
    if (marqueePreviewFrameRef.current !== null) {
      cancelAnimationFrame(marqueePreviewFrameRef.current)
      marqueePreviewFrameRef.current = null
    }
    marqueePreviewPointerRef.current = null
    settleMarqueeSelection()
  }, [settleMarqueeSelection])
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null)
  const [pendingCardFocusId, setPendingCardFocusId] = useState<string | null>(null)
  /**
   * `hoveredCardId` — frozen name (C2, #314): the card the pointer is over,
   * surfaced onto the painter props (B4's hover-always-wins label rule and
   * the painted hover ring read it there; C3 reads the richer
   * `CanvasPointerTarget` behind it). Below Reading the canvas pointer-move
   * hit-test is the producer (the hover tracker effect below) — a proxy is
   * not mounted for most cards, so DOM mouseenter cannot fire there. Mounted
   * Reading Cards use CSS `:hover` for their own shallow presentation; DOM
   * enter/leave never acquires Live authority or updates this painter state.
   */
  const releaseFocusActivationRef = useRef<(cardId: string) => void>(() => undefined)
  const releaseFocusActivation = useCallback((cardId: string) => {
    releaseFocusActivationRef.current(cardId)
  }, [])
  const { focusedCardId, claimFocusedCard, releaseFocusedCard } = useCardFocusOwnership({
    onFocusOwnershipLost: releaseFocusActivation,
  })
  const blurFocusedCardAfterResolvedSelection = useCallback((nextCardId: string | null) => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !wrapRef.current?.contains(active)) return
    const activeCardId = cardIdFromEventTarget(active)
    if (activeCardId && activeCardId !== nextCardId) active.blur()
  }, [])
  const [scrollingCardId, setScrollingCardId] = useState<string | null>(null)
  const [activeMediaCardIds, setActiveMediaCardIds] = useState<ReadonlySet<string>>(EMPTY_IDS)
  const scrollingReleaseTimerRef = useRef<number | null>(null)
  const [deepLinkNotice, setDeepLinkNotice] = useState<{ id: number; message: string } | null>(null)
  const deepLinkNoticeSequenceRef = useRef(0)
  const [urlRevision, setUrlRevision] = useState(0)
  const [viewportBackStack, setViewportBackStack] = useState<ViewSnapshot[]>([])
  const [settledViewport, setSettledViewport] = useState(viewport)
  const [navigationActive, setNavigationActive] = useState(false)
  const [zoomNavigationActive, setZoomNavigationActive] = useState(false)
  const [imageRenditionMotionSettled, setImageRenditionMotionSettled] = useState(true)
  const [measuredCardSizesById, setMeasuredCardSizesById] = useState<ReadonlyMap<string, RenderedCardSize>>(
    EMPTY_RENDERED_CARD_SIZES,
  )
  const latestMeasuredCardSizesRef = useRef(measuredCardSizesById)
  latestMeasuredCardSizesRef.current = measuredCardSizesById
  const resultPlacementContextRef = useRef<ResultPlacementContext>({})
  const getResultPlacementContext = useCallback(() => resultPlacementContextRef.current, [])
  const safePlacementZoom = Math.max(0.01, viewport.zoom)
  const placementViewportInsetPx = 24
  resultPlacementContextRef.current = {
    viewport: {
      x: (placementViewportInsetPx - viewport.x) / safePlacementZoom,
      y: (placementViewportInsetPx - viewport.y) / safePlacementZoom,
      width: Math.max(0, viewportSize.width - placementViewportInsetPx * 2) / safePlacementZoom,
      height: Math.max(0, viewportSize.height - placementViewportInsetPx * 2) / safePlacementZoom,
    },
    measuredCardSizesById,
  }
  const reportCardResize = useCallback((cardId: string, size: RenderedCardSize) => {
    setMeasuredCardSizesById((previous) => {
      const previousSize = previous.get(cardId)
      if (previousSize?.width === size.width && previousSize.height === size.height) return previous
      const next = new Map(previous)
      next.set(cardId, size)
      return next
    })
  }, [])
  const pendingRenderedSizeAdoptionsRef = useRef<{
    ideaId: string | null
    sizes: Map<string, RenderedCardSize>
  } | null>(null)
  const renderedSizeAdoptionTimerRef = useRef<number | null>(null)
  const renderedSizeAdoptionWaitingForFontsRef = useRef(false)
  const flushRenderedSizeAdoptions = useCallback(() => {
    renderedSizeAdoptionTimerRef.current = null
    const pending = pendingRenderedSizeAdoptionsRef.current
    if (!pending) return
    const fonts = document.fonts
    if (fonts && fonts.status !== 'loaded') {
      if (!renderedSizeAdoptionWaitingForFontsRef.current) {
        renderedSizeAdoptionWaitingForFontsRef.current = true
        void fonts.ready.then(() => {
          renderedSizeAdoptionWaitingForFontsRef.current = false
          if (!pendingRenderedSizeAdoptionsRef.current || renderedSizeAdoptionTimerRef.current !== null) return
          renderedSizeAdoptionTimerRef.current = window.setTimeout(
            flushRenderedSizeAdoptions,
            RENDERED_CARD_SIZE_SETTLE_MS,
          )
        })
      }
      return
    }
    pendingRenderedSizeAdoptionsRef.current = null
    if (useGraph.getState().currentIdeaId !== pending.ideaId) return
    useGraph.getState().adoptRenderedCardSizes(
      [...pending.sizes].map(([id, size]) => ({ id, size })),
    )
  }, [])
  const scheduleRenderedSizeAdoptions = useCallback((sizes: readonly { id: string; size: RenderedCardSize }[]) => {
    if (!sizes.length) return
    let pending = pendingRenderedSizeAdoptionsRef.current
    if (!pending || pending.ideaId !== currentIdeaId) {
      pending = { ideaId: currentIdeaId, sizes: new Map() }
      pendingRenderedSizeAdoptionsRef.current = pending
    }
    for (const { id, size } of sizes) pending.sizes.set(id, size)
    if (renderedSizeAdoptionWaitingForFontsRef.current) return
    if (renderedSizeAdoptionTimerRef.current !== null) {
      window.clearTimeout(renderedSizeAdoptionTimerRef.current)
    }
    renderedSizeAdoptionTimerRef.current = window.setTimeout(
      flushRenderedSizeAdoptions,
      RENDERED_CARD_SIZE_SETTLE_MS,
    )
  }, [currentIdeaId, flushRenderedSizeAdoptions])
  const reportCardRenderedSize = useCallback((cardId: string, size: RenderedCardSize) => {
    reportCardResize(cardId, size)
    scheduleRenderedSizeAdoptions([{ id: cardId, size }])
  }, [reportCardResize, scheduleRenderedSizeAdoptions])

  useEffect(() => () => {
    if (renderedSizeAdoptionTimerRef.current !== null) {
      window.clearTimeout(renderedSizeAdoptionTimerRef.current)
      renderedSizeAdoptionTimerRef.current = null
    }
    pendingRenderedSizeAdoptionsRef.current = null
    renderedSizeAdoptionWaitingForFontsRef.current = false
  }, [currentIdeaId])

  useEffect(() => {
    const fonts = document.fonts
    if (!fonts || fonts.status === 'loaded') return
    let active = true
    void fonts.ready.then(() => {
      if (!active) return
      // Auto-height Reading measurements are projections of the active font
      // metrics. A face may finish loading while those cards are unmounted in
      // Overview/Map, where no ResizeObserver exists to retire the fallback
      // footprint. Invalidate the Board-owned projection once at that external
      // readiness boundary; the normal mounted-card observer repopulates exact
      // sizes when Reading owns the card again. This is event-driven and O(1),
      // so it does not reintroduce graph work into #502's interaction frames.
      setMeasuredCardSizesById((previous) => (
        previous.size ? EMPTY_RENDERED_CARD_SIZES : previous
      ))
    })
    return () => {
      active = false
    }
  }, [])

  const navigationIdleTimerRef = useRef<number | null>(null)
  // React Flow's `fitView` works from mounted nodes. At low zoom those nodes
  // are deliberately culled, so a saved board can finish loading with nothing
  // for the library to fit. Track each loaded board separately and fit its
  // graph bounds once the pane has a real measurement instead.
  const fittedIdeaIdRef = useRef<string | null>(null)

  useEffect(() => () => {
    pendingDeepLinkViewportRef.current?.()
    if (scrollingReleaseTimerRef.current !== null) window.clearTimeout(scrollingReleaseTimerRef.current)
  }, [])

  // Coming back from playback: put the user exactly where they were. fitView is
  // disabled for this mount (see the ReactFlow props), so nothing fights it.
  const resumeViewportRef = useRef(resumeViewport)
  useEffect(() => {
    const viewport = resumeViewportRef.current
    if (readOnly || !viewport) return
    return afterAnimationFrames(2, () => {
      void setViewport(viewport, { duration: cameraDuration(0, reducedMotion) })
    })
  }, [readOnly, reducedMotion, setViewport])

  useEffect(
    () => () => {
      if (navigationIdleTimerRef.current !== null) window.clearTimeout(navigationIdleTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (readOnly) return
    return subscribeImageRenditionMotion(setImageRenditionMotionSettled)
  }, [readOnly])
  useEffect(() => () => imagePrewarmCoordinator.dispose(), [imagePrewarmCoordinator])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSettledViewport((prev) =>
        prev.x === viewport.x && prev.y === viewport.y && prev.zoom === viewport.zoom ? prev : viewport,
      )
    }, DETAIL_APERTURE_SETTLE_MS)
    return () => window.clearTimeout(timeout)
  }, [navigationActive, viewport])

  useEffect(() => {
    setMeasuredCardSizesById(EMPTY_RENDERED_CARD_SIZES)
  }, [currentIdeaId, readOnly])

  // Zoom-out stops once the whole board fits with room to spare, so small
  // boards do not shrink into a speck surrounded by empty space. Declared
  // here (rather than nearer its other zoom siblings) so the graph-bounds
  // fit effect below can close over it without a temporal-dead-zone read.
  const minZoom = useMemo(() => contentAwareMinZoom(cards, viewportSize), [cards, viewportSize])

  useEffect(() => {
    if (readOnly || resumeViewport || !hydrated || !currentIdeaId || !cards.length) return
    if (fittedIdeaIdRef.current === currentIdeaId) return
    // A card deep link has a more specific, intentional camera target.
    if (parseCardDeepLink(window.location.href)) return

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const card of cards) {
      const size = renderedCardSize(card)
      minX = Math.min(minX, card.position.x)
      minY = Math.min(minY, card.position.y)
      maxX = Math.max(maxX, card.position.x + size.width)
      maxY = Math.max(maxY, card.position.y + size.height)
    }
    const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }

    // The initial DOM measurement and a disk-loaded board may resolve in
    // either order. Two frames matches the playback fit and lets React Flow
    // measure its pane before this explicit graph-bounds fit.
    return afterAnimationFrames(2, () => {
      // An exact dev/test camera request may have superseded this fit after it
      // was queued. Re-check at commit time so scheduling order cannot replace
      // that explicit viewport.
      if (fittedIdeaIdRef.current === currentIdeaId) return
      const pane = wrapRef.current?.getBoundingClientRect()
      if (!pane || pane.width <= 0 || pane.height <= 0) return
      fittedIdeaIdRef.current = currentIdeaId
      // fitBounds has no maxZoom option of its own: it clamps to the
      // ReactFlow component's manual maxZoom (4), which is far too tight for
      // a sparse or single-card board. Compute the fit viewport directly so
      // this automatic fit can carry its own, lower cap.
      const nextViewport = getViewportForBounds(
        bounds,
        pane.width,
        pane.height,
        minZoom,
        BOARD_FIT_MAX_ZOOM,
        0.15,
      )
      void setViewport(nextViewport, { duration: 0 })
    })
  }, [cards, currentIdeaId, hydrated, minZoom, readOnly, resumeViewport, setViewport, viewportSize])

  const panOnScroll = shouldPanOnScroll({
    activeTool,
    readOnly,
    selectedCardCount: selectedNodeIds.size,
  })
  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const updateSize = () => {
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize((prev) =>
          prev.width === rect.width && prev.height === rect.height
            ? prev
            : { width: rect.width, height: rect.height },
        )
      }
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const setEidoViewport = (nextViewport: CardDeepLinkViewport) => {
      // This is an exact dev/test camera authority. Treat the current board as
      // already framed so a pending initial fit cannot replace the request.
      fittedIdeaIdRef.current = currentIdeaId
      void setViewport(nextViewport)
    }
    window.__EIDO_SET_VIEWPORT__ = setEidoViewport
    return () => {
      if (window.__EIDO_SET_VIEWPORT__ === setEidoViewport) delete window.__EIDO_SET_VIEWPORT__
    }
  }, [currentIdeaId, setViewport])

  useEffect(() => {
    const element = wrapRef.current
    if (!element || readOnly) return

    const markNavigationActive = (zooming = false) => {
      setNavigationActive(true)
      if (zooming) setZoomNavigationActive(true)
      if (navigationIdleTimerRef.current !== null) window.clearTimeout(navigationIdleTimerRef.current)
      navigationIdleTimerRef.current = window.setTimeout(() => {
        navigationIdleTimerRef.current = null
        setNavigationActive(false)
        setZoomNavigationActive(false)
      }, DETAIL_APERTURE_SETTLE_MS * 2)
    }
    const markWheelNavigation = (event: WheelEvent) => {
      markNavigationActive(event.ctrlKey || event.metaKey)
    }
    // Only pan/zoom counts as navigation for the detail aperture. A pointer
    // gesture that starts on a card (drag or resize) moves the card, not the
    // viewport — marking it as navigation froze sticky detail cards at their
    // gesture-start geometry (#204).
    const pointerNavigation = createPointerNavigationTracker(() => markNavigationActive(false))

    element.addEventListener('wheel', markWheelNavigation, { passive: true })
    element.addEventListener('pointerdown', pointerNavigation.pointerdown, { passive: true })
    element.addEventListener('pointermove', pointerNavigation.pointermove, { passive: true })
    return () => {
      element.removeEventListener('wheel', markWheelNavigation)
      element.removeEventListener('pointerdown', pointerNavigation.pointerdown)
      element.removeEventListener('pointermove', pointerNavigation.pointermove)
    }
  }, [readOnly])

  useEffect(() => {
    const onPopState = () => {
      appliedDeepLinkRef.current = null
      restoredSnapshotRef.current = null
      setUrlRevision((revision) => revision + 1)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // A card link clicked inside card text: swap the link into the address bar
  // and let the deep-link effect below run it, exactly as if the page had been
  // opened on that link — same history push, same Back behavior.
  useEffect(() => {
    if (readOnly) return
    const onCardLink = (event: Event) => {
      const href = (event as CustomEvent<CardLinkEventDetail>).detail?.href
      if (!href || !parseCardDeepLink(href)) return
      window.history.replaceState(window.history.state, '', href)
      appliedDeepLinkRef.current = null
      setUrlRevision((revision) => revision + 1)
    }
    window.addEventListener(CARD_LINK_EVENT, onCardLink)
    return () => window.removeEventListener(CARD_LINK_EVENT, onCardLink)
  }, [readOnly])

  useEffect(() => {
    if (!highlightedCardId) return
    const timeout = window.setTimeout(() => setHighlightedCardId(null), 1800)
    return () => window.clearTimeout(timeout)
  }, [highlightedCardId])

  const restoreSnapshot = useCallback(
    async (snapshot: ViewSnapshot) => {
      if (snapshot.ideaId !== currentIdeaId) {
        if (!ideas.some((idea) => idea.id === snapshot.ideaId)) {
          setDeepLinkNotice({
            id: ++deepLinkNoticeSequenceRef.current,
            message: words.cardLinkMissingIdea,
          })
          return
        }
        await loadIdea(snapshot.ideaId)
      }
      lastCardSelectionRef.current = new Set()
      setSelectedNodeIds(new Set())
      setSelectedConnectionIds(new Set())
      setDeepLinkNotice(null)
      await setViewport(snapshot.viewport, {
        duration: cameraDuration(260, reducedMotion),
      })
    },
    [currentIdeaId, ideas, loadIdea, reducedMotion, setViewport],
  )

  const holdCardSelection = useCallback(
    (cardId: string) => {
      programmaticSelectionRef.current = cardId
      setSelectedNodeIds(new Set([cardId]))
      setSelectedConnectionIds(new Set())
      select({ kind: 'card', id: cardId })
      setSelectedCardIds([cardId])

      for (const delay of [0, 180]) {
        window.setTimeout(() => {
          if (programmaticSelectionRef.current !== cardId) return
          setSelectedNodeIds(new Set([cardId]))
          setSelectedConnectionIds(new Set())
          select({ kind: 'card', id: cardId })
          setSelectedCardIds([cardId])
        }, delay)
      }
    },
    [select, setSelectedCardIds],
  )

  // Picking up the highlighter clears the selection: no resize handles or context
  // dock underneath while painting — the pen is the only thing in hand.
  useEffect(() => {
    if (readOnly || activeTool !== 'highlight') return
    setWholeBoardSelected(false)
    programmaticSelectionRef.current = null
    lastCardSelectionRef.current = new Set()
    setSelectedNodeIds((prev) => (prev.size ? new Set() : prev))
    setSelectedConnectionIds((prev) => (prev.size ? new Set() : prev))
  }, [activeTool, readOnly])

  // Jump requests from outside the canvas (e.g. the Highlights panel): center on
  // the card and flash it, like following a card link.
  useEffect(() => {
    if (readOnly || !cardFocusRequest) return
    if (cardFocusRequest.requestId === handledFocusRequestRef.current) return
    handledFocusRequestRef.current = cardFocusRequest.requestId

    const card = cards.find((c) => c.id === cardFocusRequest.cardId)
    if (!card) {
      recoverOrphanedBoardFocus(wrapRef.current)
      return
    }

    if (activeTool !== 'select') setActiveTool('select')
    holdCardSelection(card.id)
    setPendingCardFocusId(card.id)
    setHighlightedCardId(card.id)
    const target = cardFlyToTarget(card, getViewport().zoom)
    const requestId = cardFocusRequest.requestId
    const duration = cameraDuration(target.duration, reducedMotion)
    let focusRetargeted = false
    let cancelSettledFrame: (() => void) | undefined
    const retargetFocus = () => {
      focusRetargeted = true
    }
    window.addEventListener('pointerdown', retargetFocus)
    window.addEventListener('keydown', retargetFocus)
    void setCenter(target.x, target.y, {
      zoom: target.zoom,
      duration,
    })
    const settledFocusTimer = window.setTimeout(() => {
      cancelSettledFrame = afterAnimationFrames(2, () => {
        if (focusRetargeted || handledFocusRequestRef.current !== requestId) return
        const boardRoot = wrapRef.current
        if (boardRoot) focusMountedCard(boardRoot, card.id)
      })
    }, duration)
    return () => {
      focusRetargeted = true
      window.clearTimeout(settledFocusTimer)
      cancelSettledFrame?.()
      window.removeEventListener('pointerdown', retargetFocus)
      window.removeEventListener('keydown', retargetFocus)
    }
  }, [
    activeTool,
    cardFocusRequest,
    cards,
    getViewport,
    holdCardSelection,
    readOnly,
    reducedMotion,
    setActiveTool,
    setCenter,
  ])

  useEffect(() => {
    if (!pendingCardFocusId || readOnly) return
    const boardRoot = wrapRef.current
    if (!boardRoot) return
    return focusCardWhenMounted(boardRoot, pendingCardFocusId, () => {
      setPendingCardFocusId((current) => current === pendingCardFocusId ? null : current)
    })
  }, [pendingCardFocusId, readOnly])

  useEffect(() => {
    if (!pendingCardFocusId || cards.some((card) => card.id === pendingCardFocusId)) return
    setPendingCardFocusId(null)
    recoverOrphanedBoardFocus(wrapRef.current)
  }, [cards, pendingCardFocusId])

  // Escape clears the whole selection (e.g. after a box-select drag).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const intent = boardKeyboardIntent({
        readOnly,
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        targetIsEditable: isEditableTarget(e.target),
        hasTextSelection: hasDocumentTextSelection(),
        wholeBoardSelected,
        selectedNodeIds,
        selectedConnectionIds,
      })
      if (!intent) return

      if (intent.type === 'clearSelection') {
        blurFocusedCardAfterResolvedSelection(null)
        if (activeTool !== 'select') setActiveTool('select')
        programmaticSelectionRef.current = null
        selectionIntentRevisionRef.current += 1
        lastCardSelectionRef.current = new Set()
        setSelectedNodeIds((prev) => (prev.size ? new Set() : prev))
        setSelectedCardIds([])
        setSelectedConnectionIds((prev) => (prev.size ? new Set() : prev))
        setWholeBoardSelected(false)
        return
      }

      if (intent.type === 'selectAll') {
        e.preventDefault()
        programmaticSelectionRef.current = null
        lastCardSelectionRef.current = new Set()
        setSelectedNodeIds(new Set())
        setSelectedCardIds([])
        setSelectedConnectionIds(new Set())
        select(null)
        setWholeBoardSelected(true)
        return
      }

      if (intent.type === 'deleteSelection') {
        e.preventDefault()
        if (boardDeletionPendingRef.current) return
        boardDeletionPendingRef.current = true
        void executeBoardDeletion({
          cardIds: intent.cardIds,
          connectionIds: intent.connectionIds,
          includesGroup: cards.some(
            (card) => intent.cardIds.includes(card.id) && card.kind === 'group',
          ),
          confirmGroupDelete: () => dialogs.confirm({
            title: words.deleteGroup,
            message: words.deleteGroupConfirm,
            confirmLabel: words.deleteGroup,
            tone: 'danger',
          }),
          onConfirmed: () => {
            programmaticSelectionRef.current = null
            lastCardSelectionRef.current = new Set()
            setSelectedNodeIds(new Set())
            setSelectedConnectionIds(new Set())
            setSelectedCardIds([])
            setWholeBoardSelected(false)
            select(null)
          },
          deleteCard,
          deleteConnections,
        }).finally(() => {
          boardDeletionPendingRef.current = false
        })
        return
      }

      if (intent.type === 'copyWholeBoard') {
        e.preventDefault()
        const cardIds = cards.map((card) => card.id)
        copyCards(cardIds)
        const board = { cards, connections, outputs, runs }
        lastCardsClipboardTextRef.current = serializeBoardSelection(board, cardIds) || null
        void copyBoardSelection({ board, cardIds })
        return
      }

      if (intent.type === 'copyCards') {
        e.preventDefault()
        copyCards(intent.cardIds)
        const board = { cards, connections, outputs, runs }
        lastCardsClipboardTextRef.current = serializeBoardSelection(board, intent.cardIds) || null
        void copyBoardSelection({ board, cardIds: intent.cardIds })
        return
      }

      // intent.type === 'pasteCards' here. Card-set paste is decided in the
      // native `paste` handler below (onPaste), which can read the real
      // system clipboard payload and compare it against
      // lastCardsClipboardTextRef. Consuming Cmd/Ctrl+V here unconditionally,
      // as this used to do, replayed the internal Card clipboard forever and
      // blocked every native text/image paste after the first Card copy.
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activeTool,
    blurFocusedCardAfterResolvedSelection,
    cards,
    connections,
    copyCards,
    deleteCard,
    deleteConnections,
    dialogs,
    outputs,
    readOnly,
    runs,
    select,
    selectedConnectionIds,
    selectedNodeIds,
    setActiveTool,
    setSelectedCardIds,
    wholeBoardSelected,
  ])

  // Interactive selection is the Live-owner channel. Once a real Card or
  // connection is selected, the logical whole-Board copy scope is over.
  useEffect(() => {
    if (selectedNodeIds.size || selectedConnectionIds.size) setWholeBoardSelected(false)
  }, [selectedConnectionIds, selectedNodeIds])

  useEffect(() => {
    setWholeBoardSelected(false)
  }, [currentIdeaId])

  useEffect(() => {
    if (readOnly) return

    const onPointerMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY }
    }

    const onPaste = async (e: ClipboardEvent) => {
      const hasSupportedAssets = clipboardHasSupportedAssets(e)
      const clipboardText = e.clipboardData?.getData('text/plain') ?? ''
      if (!hasSupportedAssets && !clipboardText.trim()) return

      const target = e.target instanceof Element ? e.target : null

      // A Card with a live text cursor owns this paste completely, no matter
      // where the pointer that would otherwise place a new Card is parked.
      // The browser only ever targets a paste at the element that actually
      // holds focus, so a live cursor inside ANY editable that belongs to a
      // Card - the markdown body's contenteditable (including a fenced code
      // block, which nests its own contenteditable beneath it), a title
      // input, or a plain textarea - means `target` sits at or under that
      // editable, itself under the Card's React Flow node. That is the one
      // authoritative signal for "this Card is being edited right now";
      // checking it here, before any pointer reasoning, is what makes the
      // ownership rule structurally true instead of depending on every
      // paste path remembering to stop propagation.
      const editableTarget = target?.closest<HTMLElement>(CARD_OWNED_EDITABLE_SELECTOR) ?? null
      if (editableTarget?.closest('.react-flow__node[data-id]')) return

      // A Note's body claims a supported asset paste (image or PDF) through
      // its own onPaste handler even when the Card is not in edit mode -
      // see onPasteAssets in NoteCard.tsx - and that handler does not stop
      // propagation. Without this check Board's own paste handling still
      // sees the same bubbling event and adds a second, stray Note carrying
      // its own copy of the same asset.
      if (
        hasSupportedAssets &&
        target?.closest<HTMLElement>('.note-body')?.closest('.react-flow__node[data-id]')
      ) return

      const wrap = wrapRef.current
      if (!wrap) return
      if (
        target &&
        !wrap.contains(target) &&
        target !== document.body &&
        target !== document.documentElement
      ) {
        return
      }
      const rect = wrap.getBoundingClientRect()
      const pointer = pointerRef.current
      const hasPointer = Boolean(
        pointer &&
          pointer.x >= rect.left &&
          pointer.x <= rect.right &&
          pointer.y >= rect.top &&
          pointer.y <= rect.bottom,
      )
      const screenPoint = hasPointer
        ? pointer!
        : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }

      // The system clipboard is the authority for which copy is newest. Only
      // trust the internal Card clipboard when the system clipboard still
      // carries the exact Eido payload this app wrote for the last Card
      // copy (lastCardsClipboardTextRef, set in the Cmd/Ctrl+C handler
      // above). Anything else on the system clipboard - external text, an
      // image, or a stale Eido payload after a later external copy - falls
      // through to the ordinary text/asset paste below instead.
      if (
        clipboardText &&
        clipboardText === lastCardsClipboardTextRef.current &&
        useGraph.getState().cardClipboard
      ) {
        e.preventDefault()
        const pasted = pasteCards(screenToFlowPosition(screenPoint))
        if (pasted.length) {
          setWholeBoardSelected(false)
          setSelectedNodeIds(new Set(pasted))
          setSelectedConnectionIds(new Set())
        }
        return
      }

      const pasteIdeaId = useGraph.getState().currentIdeaId

      e.preventDefault()
      const assets = hasSupportedAssets ? await assetsFromClipboard(e) : []
      if (!assets.length && !clipboardText.trim()) return

      const localHtmlPath = assets.length
        ? null
        : localHtmlPathFromClipboardText(clipboardText)
      const localHtmlSource = localHtmlPath
        ? await localHtmlPreviewSourceFromClipboardText(clipboardText)
        : null
      const linkUrl = assets.length || localHtmlPath
        ? null
        : await linkPreviewUrlFromClipboardText(clipboardText)
      if (useGraph.getState().currentIdeaId !== pasteIdeaId) return
      const position = screenToFlowPosition(screenPoint)
      const id = localHtmlSource
        ? addNoteWithLocalHtmlPreview(localHtmlSource, position)
        : linkUrl
          ? addNoteWithLinkPreview({ url: linkUrl, text: clipboardText.trim() }, position)
          : addCard('note', position)

      if (assets.length) addCardAssets(id, assets)
      else if (!linkUrl && !localHtmlSource) {
        setCardText(
          id,
          localHtmlPath
            ? localHtmlDisplayNameFromClipboardText(clipboardText) ?? 'Local HTML file'
            : clipboardText,
        )
      }
      holdCardSelection(id)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('paste', onPaste)
    }
  }, [
    addCard,
    addCardAssets,
    addNoteWithLinkPreview,
    addNoteWithLocalHtmlPreview,
    holdCardSelection,
    pasteCards,
    readOnly,
    screenToFlowPosition,
    setCardText,
  ])

  useEffect(() => {
    if (readOnly) return

    const link = parseCardDeepLink(window.location.href)
    const state = historyState()

    if (!link) {
      appliedDeepLinkRef.current = null
      const snapshot = state.eidoKind === 'viewport' && isViewSnapshot(state.eidoSnapshot) ? state.eidoSnapshot : null
      const restoreKey = snapshot ? `${urlRevision}:${snapshot.ideaId}:${cardDeepLinkKey({ ideaId: snapshot.ideaId, cardId: 'view', viewport: snapshot.viewport })}` : null
      if (snapshot && restoredSnapshotRef.current !== restoreKey) {
        restoredSnapshotRef.current = restoreKey
        setViewportBackStack(historyStack(state))
        void restoreSnapshot(snapshot)
      } else if (!snapshot) {
        setViewportBackStack(historyStack(state))
      }
      return
    }

    const linkKey = cardDeepLinkKey(link)
    const applyKey = `${urlRevision}:${linkKey}`
    if (appliedDeepLinkRef.current === applyKey) return

    if (!hydrated) return

    if (!ideas.some((idea) => idea.id === link.ideaId)) {
      appliedDeepLinkRef.current = applyKey
      setDeepLinkNotice({
        id: ++deepLinkNoticeSequenceRef.current,
        message: words.cardLinkMissingIdea,
      })
      return
    }

    const fromHistory = state.eidoKind === 'deepLink' && state.eidoLinkKey === linkKey
    if (link.ideaId !== currentIdeaId) {
      if (fromHistory) {
        setViewportBackStack(historyStack(state))
      } else if (currentIdeaId) {
        setViewportBackStack(
          pushDeepLinkHistory(link, {
            ideaId: currentIdeaId,
            viewport: getViewport(),
          }),
        )
      }
      if (pendingIdeaLoadRef.current !== link.ideaId) {
        pendingIdeaLoadRef.current = link.ideaId
        void loadIdea(link.ideaId).finally(() => {
          pendingIdeaLoadRef.current = null
        })
      }
      return
    }

    if (fromHistory) {
      setViewportBackStack(historyStack(state))
    } else if (currentIdeaId) {
      setViewportBackStack(
        pushDeepLinkHistory(link, {
          ideaId: currentIdeaId,
          viewport: getViewport(),
        }),
      )
    }

    const card = cards.find((c) => c.id === link.cardId)
    if (!card) {
      appliedDeepLinkRef.current = applyKey
      lastCardSelectionRef.current = new Set()
      setSelectedNodeIds(new Set())
      setSelectedConnectionIds(new Set())
      setDeepLinkNotice({
        id: ++deepLinkNoticeSequenceRef.current,
        message: words.cardLinkMissingCard,
      })
      return
    }

    appliedDeepLinkRef.current = applyKey
    setDeepLinkNotice(null)
    holdCardSelection(card.id)
    setHighlightedCardId(card.id)
    // A valid Card deep link owns the first camera for this Board just as
    // completely as the bounds-fit and dev camera paths do. Pin the one-shot
    // fit latch before applying either its saved viewport or its centred
    // fallback so the subsequent LOD handoff cannot re-arm React Flow fitView.
    fittedIdeaIdRef.current = currentIdeaId

    if (link.viewport) {
      pendingDeepLinkViewportRef.current?.()
      void setViewport(link.viewport, {
        duration: cameraDuration(360, reducedMotion),
      })
      pendingDeepLinkViewportRef.current = afterAnimationFrames(2, () => {
        void setViewport(link.viewport!, {
          duration: cameraDuration(0, reducedMotion),
        })
        pendingDeepLinkViewportRef.current = null
      })
      return
    }

    const target = cardFlyToTarget(card, getViewport().zoom)
    void setCenter(target.x, target.y, {
      zoom: target.zoom,
      duration: cameraDuration(target.duration, reducedMotion),
    })
  }, [
    cards,
    currentIdeaId,
    getViewport,
    holdCardSelection,
    hydrated,
    ideas,
    loadIdea,
    restoreSnapshot,
    readOnly,
    reducedMotion,
    setCenter,
    setViewport,
    urlRevision,
  ])

  // A flush scheduled for a frame that never comes (unmount mid-drag) must
  // not fire against a torn-down board.
  useEffect(
    () => () => {
      if (dragFlushFrameRef.current !== null) cancelAnimationFrame(dragFlushFrameRef.current)
    },
    [],
  )

  // Drop selection ids whose card/connection no longer exists.
  useEffect(() => {
    const graph = useGraph.getState().graph()
    setSelectedNodeIds((prev) => {
      const next = new Set([...prev].filter((id) => graph.cardById(id) !== undefined))
      lastCardSelectionRef.current = new Set(
        [...lastCardSelectionRef.current].filter((id) => graph.cardById(id) !== undefined),
      )
      return next.size === prev.size ? prev : next
    })
  }, [cards])

  useEffect(() => {
    setSelectedConnectionIds((prev) => {
      const next = new Set([...prev].filter((id) => connections.some((c) => c.id === id)))
      return next.size === prev.size ? prev : next
    })
  }, [connections])

  useEffect(() => {
    if (readOnly) return
    if (programmaticSelectionRef.current && selectedNodeIds.size === 0 && selectedConnectionIds.size === 0) return
    if (selectedConnectionIds.size === 1 && selectedNodeIds.size === 0) {
      select({ kind: 'connection', id: [...selectedConnectionIds][0] })
    } else if (selectedNodeIds.size === 1 && selectedConnectionIds.size === 0) {
      select({ kind: 'card', id: [...selectedNodeIds][0] })
    } else {
      select(null)
    }
    setSelectedCardIds([...selectedNodeIds])
  }, [readOnly, selectedNodeIds, selectedConnectionIds, select, setSelectedCardIds])

  useEffect(() => {
    if (!readOnly) return
    programmaticSelectionRef.current = null
    lastCardSelectionRef.current = new Set()
    setSelectedNodeIds(new Set())
    setSelectedConnectionIds(new Set())
    select(null)
    setSelectedCardIds([])
  }, [readOnly, select, setSelectedCardIds])

  // Incremental spatial index: drags and edits patch the grid in O(changed
  // cards) instead of rebuilding it every mutation (issue #144).
  const renderIndexCache = useMemo(() => createBoardRenderIndexCache(), [])
  const renderIndex = useMemo(
    () => renderIndexCache.get(cards, connections),
    [renderIndexCache, cards, connections],
  )
  if (import.meta.env.DEV) {
    resizeColdSnapshotRef.current = () => ({
      renderIndex: renderIndexCache.stats(),
      rankEpoch: renderIndex.rankEpoch(),
    })
  }
  useEffect(() => {
    const readState = (
      frame: NonNullable<ReturnType<typeof resizeHotGeometryStore.getSnapshot>>,
    ) => {
      const card = useGraph.getState().graph().cardById(frame.cardId)
      const graphMatches = Boolean(
        card?.size &&
        card.position.x === frame.geometry.position.x &&
        card.position.y === frame.geometry.position.y &&
        card.size.width === frame.geometry.size.width &&
        card.size.height === frame.geometry.size.height,
      )
      const node = reactFlowStore.getState().nodeLookup.get(frame.cardId)
      return {
        graph: !card ? 'missing' as const : graphMatches ? 'matching' as const : 'mismatching' as const,
        node: !node
          ? 'absent' as const
          : reactFlowNodeMatchesResize(node, frame.geometry, frame.endpointOffsets)
            ? 'matching' as const
            : 'mismatching' as const,
      }
    }
    const coordinator = createBoardResizeTerminalCoordinator({
      store: resizeHotGeometryStore,
      readState,
      acknowledge(cardId, sessionId) {
        resizeHotGeometryStore.acknowledge(cardId, sessionId)
        resizeOuterFramePin.acknowledge(cardId, sessionId)
      },
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
      subscribeState(listener) {
        const unsubscribeGraph = useGraph.subscribe(listener)
        const unsubscribeReactFlow = reactFlowStore.subscribe(listener)
        return () => {
          unsubscribeGraph()
          unsubscribeReactFlow()
        }
      },
      stableFrames: RESIZE_SETTLE_STABLE_FRAMES,
      maxFrames: RESIZE_SETTLE_MAX_FRAMES,
      onTimeout(frame, state) {
        // The controlled node did not prove the graph-final geometry within
        // React Flow's integer measurement and handle tolerances. Retain the
        // bridge but stop idle polling; state subscriptions can restart
        // verification or retire it when an authoritative graph edit diverges.
        if (!import.meta.env.DEV) return
        const node = reactFlowStore.getState().nodeLookup.get(frame.cardId)
        console.warn('[eido] resize terminal reconciliation timed out', {
          cardId: frame.cardId,
          geometry: frame.geometry,
          graphMatches: state.graph === 'matching',
          nodePresent: Boolean(node),
          nodeMeasured: node?.measured,
          nodePosition: node?.internals.positionAbsolute,
        })
      },
    })
    return () => coordinator.dispose()
  }, [reactFlowStore, resizeHotGeometryStore, resizeOuterFramePin])
  const shouldPlanConnections = (
    Number.isFinite(zoom) ? Math.max(0.01, zoom) : 1
  ) >= CONNECTION_ZOOM_THRESHOLD
  // Graph metrics are viewport-independent (issue #324): they re-derive only
  // when the graph changes, guided by the store's BoardChange record, so
  // navigation and drag frames re-derive the scene below without visiting a
  // single card metric.
  const cardMetrics = useMemo(
    () =>
      deriveBoardCardMetrics({
        cards,
        outputs,
        cardById: renderIndex.cardById,
        change: lastBoardChange,
        previous: previousCardMetricsRef.current,
      }),
    [cards, lastBoardChange, outputs, renderIndex],
  )
  useEffect(() => {
    previousCardMetricsRef.current = cardMetrics
  }, [cardMetrics])
  // Selection is not a scene input (ADR 0019/0020): the band replaced the
  // selection-aware zoomBand, selection promotion is gone, and the painter
  // reads selection from Board state — so selecting a card no longer
  // re-derives the scene at all.
  const boardScene = useMemo(
    () =>
      createBoardScene({
        cards,
        connections,
        cardMetrics,
        renderIndex,
        viewport,
        settledViewport,
        viewportSize,
        readOnly,
        navigationActive,
        zoomNavigationActive,
        shouldPlanConnections,
        previousScene: previousSceneRef.current,
      }),
    [
      cardMetrics,
      cards,
      connections,
      navigationActive,
      readOnly,
      renderIndex,
      settledViewport,
      shouldPlanConnections,
      viewport,
      viewportSize,
      zoomNavigationActive,
    ],
  )
  useEffect(() => {
    previousSceneRef.current = boardScene
  }, [boardScene])
  const imagePrewarmLookAheadActive = residencyViewportMoving(
    viewport,
    previousSceneRef.current?.residencyViewport,
  )
  const imagePrewarmViewportChanging =
    viewport.x !== settledViewport.x || viewport.y !== settledViewport.y || viewport.zoom !== settledViewport.zoom
  useLayoutEffect(() => {
    imagePrewarmCoordinator.update({
      scopeId: readOnly ? null : currentIdeaId,
      lookAheadCardIds: imagePrewarmLookAheadActive ? boardScene.lookAheadCardIds : undefined,
      visibleCardIds: boardScene.visibleCardIds,
      cardById: renderIndex.cardById,
      settled: !imagePrewarmViewportChanging && imageRenditionMotionSettled,
    })
  }, [
    boardScene.lookAheadCardIds,
    boardScene.visibleCardIds,
    currentIdeaId,
    imagePrewarmCoordinator,
    imageRenditionMotionSettled,
    imagePrewarmLookAheadActive,
    imagePrewarmViewportChanging,
    readOnly,
    renderIndex,
  ])
  const {
    visibleConnections,
    hitTestCandidates,
    renderCanvasCards,
    useOverviewLayer,
    showConnections,
    overviewMarginPx,
    cardSummariesById,
    readingCardOpacity,
  } = boardScene
  const clickResolvedActivationCardIds = useMemo(
    () => unionCardIds(boardScene.oversizePassiveCardIds, boardScene.safetyCardIds),
    [boardScene.oversizePassiveCardIds, boardScene.safetyCardIds],
  )
  const clickResolvedActivationCardIdsRef = useRef(clickResolvedActivationCardIds)
  clickResolvedActivationCardIdsRef.current = clickResolvedActivationCardIds
  const [liveTransitionCardId, setLiveTransitionCardId] = useState<string | null>(null)
  const liveTransitionCardIdRef = useRef<string | null>(null)
  liveTransitionCardIdRef.current = liveTransitionCardId
  const liveTransitionPulse = useMemo(
    () => createLiveTransitionPulseController({
      now: () => performance.now(),
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (handle) => window.cancelAnimationFrame(handle),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (handle) => window.clearTimeout(handle),
    }, reducedMotion ? 0 : undefined),
    [reducedMotion],
  )
  useEffect(() => () => liveTransitionPulse.dispose(), [liveTransitionPulse])
  const pendingPaintActivationRef = useRef<{
    cardId: string
    decision: ReturnType<typeof cardActivationDecision>
    trigger: CardActivationTrigger
  } | null>(null)
  const liveTransitionCardIds = useMemo<ReadonlySet<string>>(
    () => liveTransitionCardId ? new Set([liveTransitionCardId]) : EMPTY_IDS,
    [liveTransitionCardId],
  )
  // ConnectionEdge reports its actual layout-effect lifetime. This avoids
  // scanning React Flow's entire edge set on every viewport transform while
  // keeping the DOM/canvas handoff tied to real rendered ownership.
  const connectionEdgeMountRegistry = useMemo(createConnectionEdgeMountRegistry, [])
  const mountedConnectionIds = useSyncExternalStore(
    connectionEdgeMountRegistry.subscribe,
    connectionEdgeMountRegistry.getSnapshot,
    connectionEdgeMountRegistry.getSnapshot,
  )

  // The scene stays pointer-cold (ADR 0019/0020): gesture participants are a
  // hot overlay composed AFTER the scene memo, so a hover transition can
  // never invalidate the scene or its uncapped `nodes`. The canvas hover
  // tracker below is the live producer (proximity lead + linger); the dev
  // seam remains as a direct injection path for browser gates.
  const [gestureParticipantIds, setGestureParticipantIds] = useState<ReadonlySet<string>>(EMPTY_IDS)
  // Face gestures have an independent owner. The proximity/React Flow producer
  // may legitimately replace its own set while an imperative face still owns
  // pointer capture, so the two sources are united only at this hot seam.
  const [modFaceGestureParticipantIds, setModFaceGestureParticipantIds] =
    useState<ReadonlySet<string>>(EMPTY_IDS)
  const allGestureParticipantIds = useMemo(
    () => unionCardIds(gestureParticipantIds, modFaceGestureParticipantIds),
    [gestureParticipantIds, modFaceGestureParticipantIds],
  )
  const reportModFaceGestureChange = useCallback((cardId: string, active: boolean) => {
    setModFaceGestureParticipantIds((current) => {
      if (active) {
        if (current.has(cardId)) return current
        const next = new Set(current)
        next.add(cardId)
        return next
      }
      if (!current.has(cardId)) return current
      const next = new Set(current)
      next.delete(cardId)
      return next.size ? next : EMPTY_IDS
    })
  }, [])
  const editingCardIds = useMemo<ReadonlySet<string>>(
    () => activeTool === 'select' && interactionSelectedNodeIds.size === 1
      ? interactionSelectedNodeIds
      : EMPTY_IDS,
    [activeTool, interactionSelectedNodeIds],
  )
  const richCardActivationEnabled = liveActivationEnabled && readingCardOpacity > 0
  const {
    beginActivation,
    releaseActivation,
    hoveredCardId,
    setHoveredCardId,
    liveOwnerIds: activationOwnerIds,
    ownerSnapshot,
  } = useCardActivationOwnership({
    enabled: richCardActivationEnabled,
    focusedCardId,
    selectedCardIds: interactionSelectedNodeIds,
    editingCardIds,
    scrollingCardId,
    gestureParticipantIds: allGestureParticipantIds,
    activeMediaCardIds,
    deferredActivationCardIds: clickResolvedActivationCardIds,
  })
  useLayoutEffect(() => {
    releaseFocusActivationRef.current = (cardId) => releaseActivation(cardId, 'focus')
  }, [releaseActivation])
  // A face remains a full live node even if zoom crosses below Reading during
  // pointer capture; ordinary participants may still use bounded proxies. In
  // Reading, a deferred S/O face cannot bypass the stationary-click gate.
  const liveModFaceGestureOwnerIds = useMemo(
    () => modFaceGestureLiveOwnerIds({
      pointerGestureIds: modFaceGestureParticipantIds,
      deferredActivationCardIds: clickResolvedActivationCardIds,
      existingLiveOwnerIds: activationOwnerIds,
      preserveCapturedContinuation: !richCardActivationEnabled,
    }),
    [
      activationOwnerIds,
      clickResolvedActivationCardIds,
      modFaceGestureParticipantIds,
      richCardActivationEnabled,
    ],
  )
  const liveOwnerIds = useMemo(
    () => unionCardIds(activationOwnerIds, liveModFaceGestureOwnerIds),
    [activationOwnerIds, liveModFaceGestureOwnerIds],
  )
  useLayoutEffect(() => {
    if (!liveActivationEnabled) return
    window.__EIDO_CARD_ACTIVATION_OWNER_SNAPSHOT__ = ownerSnapshot
    return () => {
      if (window.__EIDO_CARD_ACTIVATION_OWNER_SNAPSHOT__ === ownerSnapshot) {
        delete window.__EIDO_CARD_ACTIVATION_OWNER_SNAPSHOT__
      }
    }
  }, [liveActivationEnabled, ownerSnapshot])
  const beginCardActivationById = useCallback((cardId: string, trigger: CardActivationTrigger) => {
    if (!richCardActivationEnabled) return
    const deferUntilClick = clickResolvedActivationCardIds.has(cardId)
    const decision = cardActivationDecision({
      trigger,
      live: liveOwnerIds.has(cardId),
      deferUntilClick,
    })
    if (decision.showLoading) {
      const previousTransition = liveTransitionCardIdRef.current
      if (previousTransition && previousTransition !== cardId) {
        liveTransitionPulse.cancel(previousTransition)
      }
      liveTransitionPulse.begin(cardId)
      pendingPaintActivationRef.current = { cardId, decision, trigger }
      liveTransitionCardIdRef.current = cardId
      setLiveTransitionCardId(cardId)
      return
    }
    // Any immediate keyboard/focus/ordinary-P intent supersedes a staged S/O
    // click. The visual-selection follower will schedule its own fresh work.
    pendingPaintActivationRef.current = null
    selectionPaintBarrier.cancel()
    const previousTransition = liveTransitionCardIdRef.current
    if (previousTransition) liveTransitionPulse.cancel(previousTransition)
    liveTransitionCardIdRef.current = null
    setLiveTransitionCardId(null)
    beginActivation(cardId, decision, trigger)
  }, [
    beginActivation,
    clickResolvedActivationCardIds,
    liveOwnerIds,
    richCardActivationEnabled,
    selectionPaintBarrier,
    liveTransitionPulse,
  ])
  const deferredPointerPressCardIdRef = useRef<string | null>(null)
  const beginCardActivation = useCallback((
    target: EventTarget | null,
    boardRoot: Element,
    trigger: CardActivationTrigger,
  ) => {
    const targetCardId = cardIdFromEventTarget(target)
    // A pointer press can focus the O wrapper before React Flow knows whether
    // it is a click or drag. Do not let that browser focus event bypass the
    // shared 5 px decision; keyboard focus has no latched pointer id and keeps
    // the native accessibility path.
    if (trigger === 'focus' && targetCardId === deferredPointerPressCardIdRef.current) return
    const cardId = trigger === 'focus' ? claimFocusedCard(target, boardRoot) : targetCardId
    if (!cardId) return
    beginCardActivationById(cardId, trigger)
  }, [beginCardActivationById, claimFocusedCard])

  useLayoutEffect(() => {
    const visualSelection = new Set(selectedNodeIds)
    const pendingActivation = pendingPaintActivationRef.current
    if (
      !pendingActivation &&
      sameIds(interactionSelectedNodeIdsRef.current, visualSelection)
    ) return

    selectionPaintBarrier.afterPaint(
      pendingActivation?.cardId ?? [...visualSelection][0] ?? '',
      () => {
        const outgoingSelection = interactionSelectedNodeIdsRef.current
        // Selection can move during another Card's drag while this editor
        // retains focus. Resolved clicks and native focus own its handoff.
        for (const cardId of outgoingSelection) {
          if (!visualSelection.has(cardId)) releaseActivation(cardId, 'click')
        }
        interactionSelectedNodeIdsRef.current = visualSelection
        setInteractionSelectedNodeIds((current) =>
          sameIds(current, visualSelection) ? current : visualSelection,
        )

        if (!pendingActivation || pendingPaintActivationRef.current !== pendingActivation) return
        pendingPaintActivationRef.current = null
        if (!visualSelection.has(pendingActivation.cardId)) {
          liveTransitionPulse.cancel(pendingActivation.cardId)
          if (liveTransitionCardIdRef.current === pendingActivation.cardId) {
            liveTransitionCardIdRef.current = null
          }
          setLiveTransitionCardId((current) =>
            current === pendingActivation.cardId ? null : current,
          )
          return
        }
        beginActivation(
          pendingActivation.cardId,
          pendingActivation.decision,
          pendingActivation.trigger,
        )
      },
    )
    return () => selectionPaintBarrier.cancel()
  }, [
    beginActivation,
    releaseActivation,
    selectedNodeIds,
    selectionPaintBarrier,
    liveTransitionCardId,
    liveTransitionPulse,
  ])
  // Key the memo on the identity-stable scene COLLECTIONS the plan consumes,
  // never the scene object: the scene is a fresh object every derivation
  // (e.g. the navigation-active flip a pointerdown triggers), and a fresh
  // mount plan would rebuild `nodes` — remounting every card and edge — in
  // the middle of the very click being handled. A pill click's own
  // pointerdown used to unmount the pill that way, losing the click.
  const {
    detailCards: sceneDetailCards,
    detailCardIds: sceneDetailCardIds,
    overviewSuppressedCardIds: sceneOverviewSuppressedCardIds,
    readingCardOpacity: sceneReadingCardOpacity,
    suppressMountedCardPaint: sceneSuppressMountedCardPaint,
  } = boardScene
  const mountPlan = useMemo(
    () => {
      if (import.meta.env.DEV) {
        window.__EIDO_MOUNT_PLAN_DERIVATIONS__ = (window.__EIDO_MOUNT_PLAN_DERIVATIONS__ ?? 0) + 1
      }
      return mountPlanForScene({
        scene: boardScene,
        gestureParticipantIds: allGestureParticipantIds,
        liveOwnerIds,
        cardById: renderIndex.cardById,
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boardScene is
    // deliberately excluded: the plan reads the three scene collections and
    // one scalar below plus the bounded hot owner sets, synchronously. The
    // opacity is load-bearing: Reading→crossfade can preserve every
    // collection identity while changing whether mounted cards occlude full
    // Overview paint (including its ports).
    [
      sceneDetailCards,
      sceneDetailCardIds,
      sceneOverviewSuppressedCardIds,
      sceneReadingCardOpacity,
      sceneSuppressMountedCardPaint,
      allGestureParticipantIds,
      liveOwnerIds,
      renderIndex,
    ],
  )
  // The cold list remains the proximity sensor so S → L can also observe
  // departure and release. Actual canvas interaction excludes current DOM
  // owners downstream; those Cards hit-test through their mounted node.
  const canvasInteractiveCandidates = useMemo(
    () =>
      mountPlan.paintOccludingCardIds.size
        ? hitTestCandidates.filter((card) => !mountPlan.paintOccludingCardIds.has(card.id))
        : hitTestCandidates,
    [hitTestCandidates, mountPlan.paintOccludingCardIds],
  )

  // Dev seam for the participant overlay: browser gates inject participant
  // ids (including deliberately unresolvable ones — the delete race) to
  // exercise the mount plan directly, alongside the hover tracker's live
  // write path below.
  useEffect(() => {
    if (!import.meta.env.DEV || readOnly) return
    const setParticipants = (cardIds: readonly string[]) => {
      setGestureParticipantIds(cardIds.length ? new Set(cardIds) : EMPTY_IDS)
    }
    window.__EIDO_SET_GESTURE_PARTICIPANTS__ = setParticipants
    return () => {
      if (window.__EIDO_SET_GESTURE_PARTICIPANTS__ === setParticipants) {
        delete window.__EIDO_SET_GESTURE_PARTICIPANTS__
      }
    }
  }, [readOnly])

  // The hover tracker's per-event inputs, held in a ref so pointer events
  // read the CURRENT scene without re-subscribing listeners per derivation.
  // Written every commit; pointer events only ever read it.
  const pointerSceneRef = useRef<{
    candidates: readonly Card[]
    viewport: Viewport
    band: DetailBand
    measuredCardSizesById: ReadonlyMap<string, RenderedCardSize>
    cardById: (cardId: string) => Card | undefined
    renderIndex: BoardRenderIndex
  }>({
    candidates: hitTestCandidates,
    viewport,
    band: boardScene.band,
    measuredCardSizesById,
    cardById: renderIndex.cardById,
    renderIndex,
  })
  useLayoutEffect(() => {
    // Keep the cold S membership here even after a Card promotes to L: this
    // tracker is the latent proximity/release sensor, not the pane-hit owner.
    // It must still resolve departure so a gesture claim or painter-only
    // hover state cannot strand. Actual canvas interaction uses
    // canvasInteractiveCandidates.
    pointerSceneRef.current = {
      candidates: hitTestCandidates,
      viewport,
      band: boardScene.band,
      measuredCardSizesById,
      cardById: renderIndex.cardById,
      renderIndex,
    }
  })

  // Prepare the bounded connection prefix only when its graph/viewport inputs
  // change. Pointer-identity renders keep these primitive keys stable, so the
  // rAF below never repeats spatial discovery or adjacency planning.
  const connectionHoverEnabled =
    !readOnly && shouldPlanConnections && activeTool === 'select'
  const connectionHoverCandidates = useMemo(
    () =>
      connectionHoverEnabled
        ? renderIndex.queryConnectionsBounded(
            viewport,
            viewportSize,
            overviewMarginPx,
            connectionLimitForZoom(viewport.zoom),
          )
        : EMPTY_CONNECTIONS,
    [
      connectionHoverEnabled,
      overviewMarginPx,
      renderIndex,
      viewport.x,
      viewport.y,
      viewport.zoom,
      viewportSize.height,
      viewportSize.width,
    ],
  )

  // Marquee connection geometry must cover both visible ownership planes:
  // mounted DOM edges plus the exact bounded set the painter can draw for
  // mixed P/O/L↔S and S↔S endpoints. `visibleConnections` alone contains
  // only connections enclosed by mounted Cards in Reading.
  const marqueeVisibleConnections = useMemo(() => {
    if (!connectionHoverEnabled) return visibleConnections
    const byId = new Map(visibleConnections.map((connection) => [connection.id, connection]))
    for (const { connection } of planPaintedConnections({
      connections: connectionHoverCandidates,
      suppressedConnectionIds: mountedConnectionIds,
      cardById: renderIndex.cardById,
      measuredCardSizeById: (cardId) => measuredCardSizesById.get(cardId),
      viewport,
      viewportSize,
    })) {
      byId.set(connection.id, connection)
    }
    return [...byId.values()]
  }, [
    connectionHoverCandidates,
    connectionHoverEnabled,
    measuredCardSizesById,
    mountedConnectionIds,
    renderIndex,
    viewport,
    viewportSize,
    visibleConnections,
  ])

  // The ref is refreshed per commit so the pointer listener remains stable
  // across pan/zoom and graph changes while reading only prepared candidates.
  const connectionPointerSceneRef = useRef({
    enabled: connectionHoverEnabled,
    viewport,
    viewportSize,
    cardById: renderIndex.cardById,
    connectionCandidates: connectionHoverCandidates,
    measuredCardSizesById,
    suppressedConnectionIds: mountedConnectionIds,
  })
  useLayoutEffect(() => {
    connectionPointerSceneRef.current = {
      enabled: connectionHoverEnabled,
      viewport,
      viewportSize,
      cardById: renderIndex.cardById,
      connectionCandidates: connectionHoverCandidates,
      measuredCardSizesById,
      suppressedConnectionIds: mountedConnectionIds,
    }
  })
  const connectionPointerOverCardRef = useRef(false)
  const canvasPointerCardIdRef = useRef<string | null>(null)

  // Drag-selection policy, latched at POINTER-DOWN (#321). React Flow reads
  // `selectNodesOnDrag` at drag-threshold cross, not at pointer-down, and the
  // navigation settle timer can promote the band to Reading mid-press —
  // flipping the live policy while a below-Reading press is still inside its
  // first 5px. The press latches the policy it started under; renders during
  // the press (the promotion is one) keep the latched value. Refs, not
  // state: a press adds no re-render; releasing a pinned latch forces one
  // sync re-render, unconditionally — deciding whether the render is needed
  // would race the passive effect that tracks the live policy, and a wrong
  // skip leaves React Flow pinned. A release can also arrive as window blur
  // or a hidden tab (a mouse released OUTSIDE the browser window may deliver
  // neither pointerup nor pointercancel), so those clear the latch too.
  const liveDragSelectPolicy = readOnly || readingCardOpacity > 0
  const liveDragSelectPolicyRef = useRef(liveDragSelectPolicy)
  useEffect(() => {
    liveDragSelectPolicyRef.current = liveDragSelectPolicy
  }, [liveDragSelectPolicy])
  const pressDragSelectPolicyRef = useRef<boolean | null>(null)
  // Marquee availability, latched by the SAME press (#322). React Flow reads
  // `selectionOnDrag`/`panOnDrag` at drag-threshold cross, so a settle that
  // promotes the band to Reading mid-press
  // would otherwise flip an in-flight pan into a marquee. The marquee is
  // available in every scene band with the select tool; the app unions React
  // Flow's mounted P/O/L result with the scene's painter-owned S geometry.
  const liveMarqueeAvailable = !readOnly && activeTool === 'select'
  const liveMarqueeAvailableRef = useRef(liveMarqueeAvailable)
  useEffect(() => {
    liveMarqueeAvailableRef.current = liveMarqueeAvailable
  }, [liveMarqueeAvailable])
  const pressMarqueeAvailableRef = useRef<boolean | null>(null)
  const [, setDragSelectPolicySyncTick] = useState(0)
  useEffect(() => {
    if (readOnly) return
    const element = wrapRef.current
    if (!element) return
    const latch = (event: PointerEvent) => {
      const pressedCardId =
        cardIdFromEventTarget(event.target) ?? canvasPointerCardIdRef.current
      const deferredCardPress =
        event.button === 0 &&
        pressedCardId !== null &&
        clickResolvedActivationCardIdsRef.current.has(pressedCardId)
      deferredPointerPressCardIdRef.current = deferredCardPress ? pressedCardId : null
      // O/S movement stays a geometry gesture. React Flow may move the node,
      // but it must not select it at threshold-cross and thereby create L.
      pressDragSelectPolicyRef.current = deferredCardPress
        ? false
        : liveDragSelectPolicyRef.current
      reactFlowStore.setState({
        selectNodesOnDrag: pressDragSelectPolicyRef.current,
      })
      pressMarqueeAvailableRef.current = liveMarqueeAvailableRef.current
    }
    const release = () => {
      if (pressDragSelectPolicyRef.current === null && pressMarqueeAvailableRef.current === null) return
      pressDragSelectPolicyRef.current = null
      pressMarqueeAvailableRef.current = null
      deferredPointerPressCardIdRef.current = null
      reactFlowStore.setState({ selectNodesOnDrag: liveDragSelectPolicyRef.current })
      // React Flow normally calls onSelectionEnd before this window listener.
      // If a drag is cancelled outside the pane instead, do not leave its
      // provisional selection latched and suppress a later ordinary click.
      marqueeStartRef.current = null
      marqueeSelectedNodeIdsRef.current = null
      marqueePaintedCardIdsRef.current = null
      marqueePressRef.current = false
      lowLodSelectionDragStartRef.current = null
      clearMarqueePreview()
      // Unconditional: a mid-press render may have pinned the latched value
      // into React Flow, so re-render once to hand the prop back to the live
      // policy. No compare — the live-policy ref updates in a passive
      // effect, so a release landing between a promotion commit and that
      // effect would compare against the OLD value and wrongly skip. One
      // possibly-redundant re-render per press END is free; a stale pin on
      // React Flow's drag-selection setting is not.
      setDragSelectPolicySyncTick((tick) => tick + 1)
    }
    const releaseIfHidden = () => {
      if (document.visibilityState === 'hidden') release()
    }
    // Capture phase: the latch must record BEFORE React Flow's own node
    // handlers see the press.
    element.addEventListener('pointerdown', latch, { passive: true, capture: true })
    window.addEventListener('pointerup', release, { passive: true })
    window.addEventListener('pointercancel', release, { passive: true })
    window.addEventListener('blur', release, { passive: true })
    document.addEventListener('visibilitychange', releaseIfHidden, { passive: true })
    return () => {
      element.removeEventListener('pointerdown', latch, { capture: true })
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', releaseIfHidden)
    }
  }, [clearMarqueePreview, reactFlowStore, readOnly])

  // A box selection must leave exactly what a shift-click multi selection
  // leaves: selected Cards, and nothing else. React Flow answers its own box
  // selection by raising `nodesSelectionActive`, which mounts an invisible
  // rectangle over the whole selected bounding box: it takes the grab cursor,
  // swallows presses on the blank canvas between the Cards, drags the set from
  // there, and steals keyboard focus. Shift-click never raises it, so the flag
  // is held down here and the founder keeps interacting with the real Cards.
  // Dragging a selected Card still moves the whole selection: React Flow's node
  // drag reads the selected set, not this rectangle.
  useEffect(() => {
    const clearNodesSelectionRect = () => {
      if (!reactFlowStore.getState().nodesSelectionActive) return
      reactFlowStore.setState({ nodesSelectionActive: false })
    }
    clearNodesSelectionRect()
    return reactFlowStore.subscribe(clearNodesSelectionRect)
  }, [reactFlowStore])

  // Canvas-driven hover + proximity-lead proxy mount (C2, #314). Below
  // Reading the pane pointer-move hit-test is the hover producer, and the
  // nearest card within the lead radius becomes the single gesture
  // participant — its invisible proxy mounts BEFORE contact so the handles
  // exist by the time the pointer arrives, and lingers briefly so a fast
  // flick-then-press still lands on a mounted proxy. The tracker touches
  // React state only on identity transitions: a pointer-move with an
  // unchanged target and lead is refs-only — no scene derivation, no
  // nodes/edges rebuild, no store write, no label-cache invalidation (the
  // pointer-storm browser gate counts the proof).
  useEffect(() => {
    if (readOnly) return
    const element = wrapRef.current
    if (!element) return
    const tracker = createCanvasHoverTracker({
      resolvePoint: (clientX, clientY) => {
        const {
          candidates,
          viewport: liveViewport,
          band,
          measuredCardSizesById: liveMeasuredSizes,
          cardById,
        } = pointerSceneRef.current
        // No canvas hit candidates means the canvas painter has nothing to
        // resolve. Mounted Reading Cards own only their CSS `:hover`; they do
        // not publish Board hover state or acquire Live authority.
        if (!candidates.length) return null
        const hotFrame = resizeHotGeometryStore.getSnapshot()
        // The cold candidate array already carries indexed Cards. Only the
        // one hot Card needs an override; passing the render-index lookup on
        // every cold pointer event would add one lookup per candidate.
        const hotCard = hotFrame
          ? cardWithResizeHotGeometry(cardById(hotFrame.cardId), hotFrame)
          : undefined
        const hotCardById = hotFrame
          ? (cardId: string) => cardId === hotFrame.cardId ? hotCard : undefined
          : undefined
        const hotMeasuredCardSizeById = resizeHotMeasuredCardSizeById(
          (cardId) => liveMeasuredSizes.get(cardId),
          hotFrame,
        )
        return canvasPointerPointAtClientPoint({
          candidates,
          viewport: liveViewport,
          viewportRect: element.getBoundingClientRect(),
          clientX,
          clientY,
          band,
          leadRadiusPx: POINTER_LEAD_RADIUS_PX,
          measuredCardSizeById: hotMeasuredCardSizeById,
          cardById: hotCardById,
        })
      },
      onHoveredCardChange: setHoveredCardId,
      onParticipantIdsChange: setGestureParticipantIds,
      // Port arming (C3, #320): written straight onto the wrapper dataset —
      // no React state — so the CSS rule that lets a proxy handle take the
      // press is in force within the same pointer event that resolved the
      // painted disc under the pointer.
      onPointerTargetChange: (pointerTarget) => {
        connectionPointerOverCardRef.current =
          pointerTarget.kind === 'card-body' || pointerTarget.kind === 'card-port'
        canvasPointerCardIdRef.current =
          pointerTarget.kind === 'card-body' || pointerTarget.kind === 'card-port'
            ? pointerTarget.cardId
            : null
        if (pointerTarget.kind === 'card-port') element.dataset.canvasPortTarget = pointerTarget.port
        else delete element.dataset.canvasPortTarget
      },
    })
    hoverTrackerRef.current = tracker
    const onPointerMove = (event: PointerEvent) => {
      tracker.pointerMove(event.clientX, event.clientY)
      scheduleConnectionDropFeedback(event.clientX, event.clientY)
    }
    const onPointerDown = () => tracker.pointerDown()
    const onPointerUp = () => tracker.pointerUp()
    const onPointerLeave = () => {
      tracker.pointerLeave()
      hideConnectionDropFeedback()
    }
    element.addEventListener('pointermove', onPointerMove, { passive: true })
    element.addEventListener('pointerdown', onPointerDown, { passive: true })
    element.addEventListener('pointerleave', onPointerLeave, { passive: true })
    // A drag can end outside the board, so the gesture unlock listens on
    // window.
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    return () => {
      tracker.dispose()
      hoverTrackerRef.current = null
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('pointerup', onPointerUp)
      endConnectionDropFeedback()
    }
  }, [endConnectionDropFeedback, hideConnectionDropFeedback, readOnly, scheduleConnectionDropFeedback])

  // Painted-band whole-wire hover. Pointer events only replace a pending
  // point; the tracker performs one hit query over a prepared bounded prefix
  // per frame and writes React state only when the hovered identity changes.
  useEffect(() => {
    if (readOnly) return
    const element = wrapRef.current
    if (!element) return
    const tracker = createConnectionHoverTracker({
      hitTest: ({ clientX, clientY }) => {
        const latest = connectionPointerSceneRef.current
        if (!latest.enabled || connectionPointerOverCardRef.current) return null
        const viewportRect = element.getBoundingClientRect()
        const hotFrame = resizeHotGeometryStore.getSnapshot()
        const hotCardById = resizeHotCardById(latest.cardById, hotFrame)
        const hotMeasuredCardSizeById = resizeHotMeasuredCardSizeById(
          (cardId) => latest.measuredCardSizesById.get(cardId),
          hotFrame,
        )
        const capturedPaintedConnections = hotFrame
          ? resizeHotGeometryStore.getPaintedConnectionsSnapshot(hotFrame.cardId, hotFrame.sessionId)
          : null
        const paintedConnections =
          capturedPaintedConnections?.connections ??
          planPaintedConnections({
            connections: latest.connectionCandidates,
            suppressedConnectionIds: latest.suppressedConnectionIds,
            cardById: hotCardById,
            measuredCardSizeById: hotMeasuredCardSizeById,
            viewport: latest.viewport,
            viewportSize: latest.viewportSize,
          })
        return hitTestPaintedConnectionsAtClientPoint({
          paintedConnections,
          viewport: latest.viewport,
          viewportRect,
          clientX,
          clientY,
        })?.id ?? null
      },
      onIdentityChange: setHoveredConnectionId,
    })
    const onPointerMove = (event: PointerEvent) => tracker.move({ clientX: event.clientX, clientY: event.clientY })
    const onPointerLeave = () => tracker.leave()
    element.addEventListener('pointermove', onPointerMove, { passive: true })
    element.addEventListener('pointerleave', onPointerLeave, { passive: true })
    return () => {
      tracker.dispose()
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [readOnly])

  // A non-empty exclusion set means a participant was clamped past the bound
  // or deleted mid-gesture. Both are runtime-observable: the counts/ids land
  // on the board wrapper's dataset (the observability seam the browser gates
  // read), and dev builds warn once per distinct exclusion set — never per
  // frame — so a delete race is loud without flooding the console.
  const excludedParticipantIds = mountPlan.excludedParticipantIds
  const warnedExclusionsRef = useRef('')
  useEffect(() => {
    const excluded = [...excludedParticipantIds].sort().join(' ')
    if (excluded === warnedExclusionsRef.current) return
    warnedExclusionsRef.current = excluded
    if (excluded && import.meta.env.DEV) {
      console.warn(`[eido] mount plan excluded gesture participants: ${excluded}`)
    }
  }, [excludedParticipantIds])

  // One data object shared by every live node, remade only when the selection
  // changes (#213): React Flow's per-node memo compares `data` by reference,
  // so a per-node object would re-render every visible card on every drag
  // frame even though nothing in it changed.
  const liveNodeData = useMemo(
    () => ({
      // Semantic selection intentionally follows the paint barrier; wrapper
      // selection can change without replacing this rich-node data object.
      ...liveCardNodeData(interactionSelectedNodeIds),
      onCardResize: reportCardResize,
      onCardRenderedSize: reportCardRenderedSize,
      onCardResizePreview: reportCardResizePreview,
      getResultPlacementContext,
      onModFaceGestureChange: reportModFaceGestureChange,
    }),
    [
      getResultPlacementContext,
      reportCardResize,
      reportCardRenderedSize,
      reportCardResizePreview,
      reportModFaceGestureChange,
      interactionSelectedNodeIds,
    ],
  )
  // Capture each visible auto-height Card's growth allowance once. Camera
  // movement moves ordinary board geometry and never resizes a Card to pin a
  // screen-space edge. The local cache resets with the active projection.
  const cardGrowthCapScope = `${readOnly ? 'playback' : 'live'}:${currentIdeaId ?? ''}`
  const [cardGrowthCapState, setCardGrowthCapState] = useState<{
    scope: string
    heights: ReadonlyMap<string, number>
  }>(() => ({ scope: cardGrowthCapScope, heights: EMPTY_CARD_GROWTH_MAX_HEIGHTS }))
  const cardGrowthMaxHeightsById =
    cardGrowthCapState.scope === cardGrowthCapScope
      ? cardGrowthCapState.heights
      : EMPTY_CARD_GROWTH_MAX_HEIGHTS
  useLayoutEffect(() => {
    setCardGrowthCapState((previous) => {
      const established =
        previous.scope === cardGrowthCapScope ? previous.heights : EMPTY_CARD_GROWTH_MAX_HEIGHTS
      const heights = cardGrowthMaxHeights({
        cards: mountPlan.mountedCards,
        viewport,
        viewportSize,
        measuredCardSizesById: latestMeasuredCardSizesRef.current,
        establishedHeights: established,
      })
      if (previous.scope === cardGrowthCapScope && heights === previous.heights) return previous
      return { scope: cardGrowthCapScope, heights }
    })
  }, [cardGrowthCapScope, mountPlan.mountedCards, viewportSize])
  const controlledNodeClassName = useCallback(
    (c: Card) => liveCardNodeClassName(selectedNodeIds.has(c.id), highlightedCardId === c.id),
    [highlightedCardId, selectedNodeIds],
  )

  const nodes = useControlledBoardNodes({
    activeTool,
    ghostCardIds,
    liveCardClassName: controlledNodeClassName,
    liveNodeData,
    measuredCardSizesById,
    mountPlan,
    readOnly,
    readingOpacity: readOnly ? 1 : readingCardOpacity,
    semanticScopeId: currentIdeaId,
    cardById: renderIndex.cardById,
    cardOrder: readOnly ? undefined : renderIndex.cardOrder,
    cardGrowthMaxHeightsById,
    selectedNodeIds,
    interactionSelectedNodeIds,
    liveTransitionCardIds,
  })

  useEffect(() => {
    const cardId = liveTransitionCardId
    const boardRoot = wrapRef.current
    if (!cardId || !boardRoot) return
    const card = renderIndex.cardById(cardId)
    const expectsMarkdownEditor =
      activeTool === 'select' &&
      selectedNodeIds.size === 1 &&
      selectedNodeIds.has(cardId) &&
      (card?.kind === 'note' || card?.kind === 'askAi' || card?.kind === 'conversation')
    const transitionStillOwned = () =>
      selectedNodeIds.has(cardId) || mountPlan.liveCardIds.has(cardId)
    const matchingNode = () =>
      [...boardRoot.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')]
        .find((node) => node.dataset.id === cardId) ?? null
    const clearWhenReady = () => {
      if (!transitionStillOwned()) {
        liveTransitionPulse.cancel(cardId)
        if (liveTransitionCardIdRef.current === cardId) {
          liveTransitionCardIdRef.current = null
        }
        setLiveTransitionCardId((current) => current === cardId ? null : current)
        return
      }
      const node = matchingNode()
      if (!node || !mountPlan.liveCardIds.has(cardId)) return
      if (
        expectsMarkdownEditor &&
        !node.querySelector('.markdown-card-editor-transition[data-editor-ready="true"]')
      ) return
      liveTransitionPulse.release(cardId, () => {
        if (liveTransitionCardIdRef.current === cardId) {
          liveTransitionCardIdRef.current = null
        }
        setLiveTransitionCardId((current) => current === cardId ? null : current)
      })
    }
    clearWhenReady()
    const observer = new MutationObserver(clearWhenReady)
    observer.observe(boardRoot, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-editor-ready'],
    })
    return () => observer.disconnect()
  }, [
    activeTool,
    liveTransitionCardId,
    liveTransitionPulse,
    mountPlan.liveCardIds,
    renderIndex,
    selectedNodeIds,
  ])

  const computedEdges: Edge[] = useMemo(
    () =>
      showConnections
        ? visibleConnections
            .map((c) => ({
              id: c.id,
              source: c.from.cardId,
              target: c.to.cardId,
              type: 'connection',
              selected: !readOnly && selectedConnectionIds.has(c.id),
              data: readOnly
                ? {
                    connection: c,
                    ghost: ghostConnectionIds.has(c.id),
                    playback: true,
                    mountRegistry: connectionEdgeMountRegistry,
                  }
                : { connection: c, resizeHotGeometryStore, mountRegistry: connectionEdgeMountRegistry },
            }))
        : [],
    [
      ghostConnectionIds,
      connectionEdgeMountRegistry,
      readOnly,
      resizeHotGeometryStore,
      selectedConnectionIds,
      showConnections,
      visibleConnections,
    ],
  )
  const edges = computedEdges
  // Board-level connection-editor host (#322). At Overview/Map the connection
  // is canvas-painted with no mounted edge component, so nothing would render
  // its popover — the store's `connectionEditorId` opened by a painted-badge
  // click has no home. This host renders THE SAME `ConnectionPopover` for that
  // id via its `ViewportPortal` whenever the edge is NOT mounted; in Reading
  // the mounted edge owns the popover and this stays null, so exactly one
  // popover ever exists in the DOM for one id. The anchor is the shared badge
  // disc's flow-space centre (`connectionBadgeFlowAnchor`) — the same disc the
  // painter drew — so the popover sits on the badge and tracks it through pan
  // and zoom. If the connection is culled off-screen the anchor is absent and
  // the host yields, matching the mounted edge's own cull-driven unmount.
  // The edge-mounted check reads React Flow's SYNCHRONIZED internal store,
  // not the controlled `edges` prop: RF syncs the prop into its store in a
  // passive effect, so during a band demotion the prop can already lack the
  // edge while RF still renders it (and its popover) for one more commit —
  // and a promotion can transiently render neither. `edgeLookup` is the same
  // source of truth the edge component's own mount follows, so host and edge
  // popover stay mutually exclusive on every commit: exactly one popover in
  // the DOM for one id at any time.
  const editorEdgeMounted = useStore(
    useCallback(
      (s: { edgeLookup: Map<string, unknown> }) =>
        connectionEditorId !== null && s.edgeLookup.has(connectionEditorId),
      [connectionEditorId],
    ),
  )
  // Resolved once per editor-open / graph commit — NEVER per viewport frame.
  // Below Reading the scene carries no `visibleConnections` (they are painted
  // straight from `renderIndex.query`), so the editor connection comes from
  // the store's live connections.
  const editorConnection = useMemo(
    () =>
      connectionEditorId !== null
        ? (liveConnections.find((c) => c.id === connectionEditorId) ?? null)
        : null,
    [connectionEditorId, liveConnections],
  )
  const connectionEditorHost = useMemo(() => {
    if (readOnly || !editorConnection || editorEdgeMounted) return null
    // Reading mounts the edge (and its own popover); the host only fills the
    // Overview/Map gap where the connection is canvas-painted with no edge.
    // Per pan/zoom frame this plans exactly ONE connection (O(1)); the
    // connection lookup above is not viewport-keyed.
    const painted = planPaintedConnections({
      connections: [editorConnection],
      cardById: renderIndex.cardById,
      measuredCardSizeById: (cardId) => measuredCardSizesById.get(cardId),
      viewport,
      viewportSize,
    })[0]
    if (!painted) return null
    const anchor = connectionBadgeFlowAnchor(painted, viewport)
    return { connection: editorConnection, labelX: anchor.x, labelY: anchor.y }
  }, [
    readOnly,
    editorConnection,
    editorEdgeMounted,
    renderIndex,
    measuredCardSizesById,
    viewport,
    viewportSize,
  ])

  // Commits the buffered drag positions as ONE moveCards store commit. Group
  // cards drag their members along in the store, so a member's own reported
  // move is dropped when its group is also in the buffer — the same rule the
  // per-event path applied per changes batch.
  const flushPendingDragMoves = () => {
    if (dragFlushFrameRef.current !== null) {
      cancelAnimationFrame(dragFlushFrameRef.current)
      dragFlushFrameRef.current = null
    }
    const pending = pendingDragMovesRef.current
    pendingDragMovesRef.current = null
    if (!pending?.size) return
    const cardsById = new Map(useGraph.getState().cards.map((c) => [c.id, c]))
    const movingGroups = new Set([...pending.keys()].filter((id) => cardsById.get(id)?.kind === 'group'))
    const frameMoves = [...pending]
      .filter(([id]) => {
        const groupId = cardsById.get(id)?.groupId
        return !(groupId && movingGroups.has(groupId))
      })
      .map(([id, position]) => ({ id, position }))
    if (frameMoves.length) moveCards(frameMoves, { recordHistory: false })
  }

  const scheduleDragFlush = () => {
    if (dragFlushFrameRef.current !== null) return
    dragFlushFrameRef.current = requestAnimationFrame(() => {
      dragFlushFrameRef.current = null
      flushPendingDragMoves()
    })
  }

  const onNodesChange = (changes: NodeChange[]) => {
    if (readOnly) return
    if (import.meta.env.DEV && resizeRfDiagnosticUnsubscribeRef.current) {
      const dimensionChanges = changes.filter((change) => change.type === 'dimensions').length
      if (dimensionChanges > 0) {
        resizeRfDimensionChangesRef.current += dimensionChanges
        const diagnostic = window.__EIDO_RESIZE_RF_DIAGNOSTIC__
        if (diagnostic) diagnostic.dimensionChanges = resizeRfDimensionChangesRef.current
      }
    }
    let nextSelected: Set<string> | null = null
    const marqueeNextSelected = marqueeSelectedNodeIdsRef.current
      ? new Set(marqueeSelectedNodeIdsRef.current)
      : null
    if (changes.some((ch) => ch.type === 'dimensions' || ch.type === 'remove')) {
      setMeasuredCardSizesById((prev) => {
        let next: Map<string, RenderedCardSize> | null = null
        for (const ch of changes) {
          if (ch.type === 'dimensions' && ch.dimensions) {
            const { width, height } = ch.dimensions
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue
            const previousSize = prev.get(ch.id)
            if (previousSize?.width === width && previousSize.height === height) continue
            if (!next) {
              next = new Map(prev)
              if (import.meta.env.DEV && resizeRfDiagnosticUnsubscribeRef.current) {
                resizeMeasuredMapClonesRef.current += 1
                const diagnostic = window.__EIDO_RESIZE_RF_DIAGNOSTIC__
                if (diagnostic) diagnostic.measuredMapClones = resizeMeasuredMapClonesRef.current
              }
            }
            next.set(ch.id, { width, height })
          } else if (ch.type === 'remove' && prev.has(ch.id)) {
            if (!next) {
              next = new Map(prev)
              if (import.meta.env.DEV && resizeRfDiagnosticUnsubscribeRef.current) {
                resizeMeasuredMapClonesRef.current += 1
                const diagnostic = window.__EIDO_RESIZE_RF_DIAGNOSTIC__
                if (diagnostic) diagnostic.measuredMapClones = resizeMeasuredMapClonesRef.current
              }
            }
            next.delete(ch.id)
          }
        }
        return next ?? prev
      })
    }
    const positionChanges = changes.filter(
      (ch): ch is Extract<NodeChange, { type: 'position' }> => ch.type === 'position' && Boolean(ch.position),
    )
    const instantMoveBefore = positionChanges.length ? useGraph.getState().cards : null
    if (positionChanges.some((ch) => ch.dragging) && !dragStartCardsRef.current) {
      dragStartCardsRef.current = instantMoveBefore
    }
    if (
      positionChanges.some((change) => change.dragging) &&
      readingCardOpacity === 0 &&
      selectedNodeIds.size > 1 &&
      lowLodSelectionDragStartRef.current === null
    ) {
      const starts = new Map<string, { x: number; y: number }>()
      for (const cardId of selectedNodeIds) {
        const card = renderIndex.cardById(cardId)
        if (card) starts.set(cardId, card.position)
      }
      lowLodSelectionDragStartRef.current = starts
    }
    const lowLodSelectedDrag =
      readingCardOpacity === 0 && selectedNodeIds.size > 1
        ? positionChanges.find((change) => selectedNodeIds.has(change.id))
        : undefined
    const selectedDragStarts = lowLodSelectionDragStartRef.current
    const draggedStartPosition =
      lowLodSelectedDrag ? selectedDragStarts?.get(lowLodSelectedDrag.id) : undefined
    const selectedDragDelta =
      lowLodSelectedDrag?.position && draggedStartPosition
        ? {
            x: lowLodSelectedDrag.position.x - draggedStartPosition.x,
            y: lowLodSelectedDrag.position.y - draggedStartPosition.y,
          }
        : null
    // One RENDERED frame of drag = one store commit (#143, #213): every
    // position change lands in the pending buffer (latest position per card
    // wins), and the buffer commits once per animation frame while the
    // gesture is live — a 500 Hz mouse delivers 4-10 events per frame, and
    // committing each one made every extra event a full store commit plus
    // scene rebuild. Undo semantics are unchanged — the history patch is
    // still recorded once per gesture below.
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
        const pending = pendingDragMovesRef.current ?? new Map<string, { x: number; y: number }>()
        pendingDragMovesRef.current = pending
        pending.set(ch.id, ch.position)
      }
      else if (ch.type === 'remove') deleteCard(ch.id)
      else if (ch.type === 'select') {
        // The final marquee selection is committed by onSelectionEnd. During
        // the gesture, changing the controlled `selected` props invalidates
        // React Flow's measurements in the very loop that is finding nodes
        // inside the rectangle.
        if (marqueeNextSelected) {
          if (ch.selected) marqueeNextSelected.add(ch.id)
          else marqueeNextSelected.delete(ch.id)
          continue
        }
        if (!nextSelected) nextSelected = new Set(selectedNodeIds)
        if (ch.selected) nextSelected.add(ch.id)
        else nextSelected.delete(ch.id)
      }
    }
    if (selectedDragDelta && selectedDragStarts) {
      const changedIds = new Set(positionChanges.map((change) => change.id))
      const pending = pendingDragMovesRef.current ?? new Map<string, { x: number; y: number }>()
      pendingDragMovesRef.current = pending
      for (const [cardId, start] of selectedDragStarts) {
        if (changedIds.has(cardId)) continue
        pending.set(cardId, {
          x: start.x + selectedDragDelta.x,
          y: start.y + selectedDragDelta.y,
        })
      }
    }
    if (marqueeNextSelected) {
      marqueeSelectedNodeIdsRef.current = marqueeNextSelected
      marqueeSelectionState.setCards(unionIds(marqueeNextSelected, marqueePaintedCardIdsRef.current))
    }
    if (positionChanges.length) {
      // Mid-gesture moves wait for the next animation frame; instant moves
      // and the gesture-end change commit synchronously so history records
      // against fully applied state.
      if (positionChanges.some((ch) => ch.dragging)) scheduleDragFlush()
      else flushPendingDragMoves()
    }
    // React Flow's mounted-plane echo is not a newer user intent. Let the
    // graph-plane reconciliation own ordering for this same pointer action.
    if (nextSelected) setSelectedNodeIdsState(nextSelected)
    if (positionChanges.length && positionChanges.every((ch) => ch.dragging === undefined)) {
      recordCardStructuralChange('moveCard', instantMoveBefore ?? [], useGraph.getState().cards)
    }
    if (positionChanges.some((ch) => ch.dragging === false)) {
      recordCardStructuralChange(
        'moveCard',
        dragStartCardsRef.current ?? instantMoveBefore ?? [],
        useGraph.getState().cards,
      )
      dragStartCardsRef.current = null
      lowLodSelectionDragStartRef.current = null
    }
  }

  // React Flow's box selection auto-adds every edge attached to any
  // box-selected node — ONE endpoint in the box suffices — which is broader
  // than "the box touches the connection". So while a marquee is in progress
  // its edge select deltas are ignored: the geometric touch test in
  // onSelectionEnd is the only authority for marquee connection selection.
  // Click-select deltas outside a marquee still land.
  const marqueeInProgress = () => {
    if (marqueeSelectionState.isActive()) return true
    if (!marqueeStartRef.current) return false
    const { userSelectionActive, userSelectionRect } = reactFlowStore.getState()
    if (userSelectionActive || userSelectionRect) return true
    // A canceled drag can skip onSelectionEnd; a stale marker must not eat
    // click-selects forever.
    marqueeStartRef.current = null
    return false
  }

  const onEdgesChange = (changes: EdgeChange[]) => {
    if (readOnly) return
    const selectChanges = changes.filter(
      (ch): ch is Extract<EdgeChange, { type: 'select' }> => ch.type === 'select',
    )
    for (const ch of changes) {
      if (ch.type === 'remove') deleteConnection(ch.id)
    }
    if (selectChanges.length && !marqueeInProgress()) {
      // Functional update: React Flow batches deselect changes with our own
      // selection writes (pane clicks, marquee end), so apply the delta to
      // the latest set instead of the render's snapshot.
      setSelectedConnectionIds((prev) => {
        const next = new Set(prev)
        for (const ch of selectChanges) {
          if (ch.selected) next.add(ch.id)
          else next.delete(ch.id)
        }
        return sameIds(prev, next) ? prev : next
      })
    }
  }

  const onConnect = (c: RFConnection) => {
    if (readOnly) return
    if (c.source && c.target) {
      addConnection(c.source, c.target)
    }
  }

  // Two-proxy connect wiring (C3, #320). The source proxy is already mounted
  // (it is the proximity lead the press landed on); connect-start freezes it
  // as the first participant, and the tracker lead-mounts the candidate
  // target on pointer-move so React Flow's native snap/preview/validate runs
  // unchanged. Callback outputs translate back into ordinary store actions
  // (`onConnect` above); no proxy state is ever persisted.
  const onConnectStart = useCallback<OnConnectStart>((_event, params) => {
    // The press already resolved port-vs-body through the armed dataset;
    // disarm for the drag so no proxy handle takes pointer events and React
    // Flow's completion stays geometric (snap radius + isValidConnection).
    const element = wrapRef.current
    if (element) delete element.dataset.canvasPortTarget
    endConnectionDropFeedback()
    if (params.nodeId && params.handleType) {
      connectionDragOriginRef.current = {
        cardId: params.nodeId,
        handleType: params.handleType,
      }
      if (element) element.dataset.connectionDragActive = 'true'
    }
    if (params.nodeId) {
      hoverTrackerRef.current?.connectStart(params.nodeId)
      if (liveActivationEnabled) setGestureParticipantIds(new Set([params.nodeId]))
    }
  }, [endConnectionDropFeedback, liveActivationEnabled])

  const onConnectEnd = useCallback<OnConnectEnd>((event, finalState) => {
    endConnectionDropFeedback()
    const point = 'clientX' in event ? event : event.changedTouches[0]
    const heldHandle = finalState.fromHandle
    if (point && heldHandle && finalState.isValid !== true) {
      // Pointer capture can leave `event.target` pinned to the source Handle,
      // so ask the document what is actually under the release point. Rich
      // Cards and low-zoom proxies share `.react-flow__node[data-id]`, making
      // this independent of Card kind, internal surface, and camera scale.
      const dropElements = document.elementsFromPoint(point.clientX, point.clientY)
      const boardRoot = wrapRef.current
      const viewportRect = boardRoot?.getBoundingClientRect()
      const insideBoard = Boolean(
        viewportRect &&
        point.clientX >= viewportRect.left &&
        point.clientX <= viewportRect.right &&
        point.clientY >= viewportRect.top &&
        point.clientY <= viewportRect.bottom,
      )
      const releaseSurface = boardRoot && insideBoard
        ? boardReleaseSurface(dropElements, boardRoot)
        : { kind: 'blocked' as const }
      const domDropCardId = releaseSurface.kind === 'card' ? releaseSurface.cardId : null
      // Group surfaces deliberately sit below the connection plane and are
      // pointer-transparent through most of their frame, so they do not
      // necessarily appear in elementsFromPoint. Fall back to one exact-point
      // query against the Board's existing incremental hash grid. This is a
      // release-only O(local bucket) read; pointer-move remains unchanged.
      let spatialDropTarget: ReturnType<typeof canvasPointerPointAtClientPoint>['target'] = {
        kind: 'none',
      }
      if (
        releaseSurface.kind !== 'blocked' &&
        (!domDropCardId || finalState.toHandle !== null)
      ) {
        if (boardRoot) {
          const latest = pointerSceneRef.current
          if (viewportRect && insideBoard) {
            const safeZoom = Number.isFinite(latest.viewport.zoom)
              ? Math.max(0.01, latest.viewport.zoom)
              : 1
            const boardX = (point.clientX - viewportRect.left - latest.viewport.x) / safeZoom
            const boardY = (point.clientY - viewportRect.top - latest.viewport.y) / safeZoom
            const pointCandidates = latest.renderIndex.query(
              { x: -boardX * safeZoom, y: -boardY * safeZoom, zoom: safeZoom },
              { width: 0, height: 0 },
              0,
              { includeConnections: false },
            ).cards
            spatialDropTarget = canvasPointerPointAtClientPoint({
              candidates: pointCandidates,
              viewport: latest.viewport,
              viewportRect,
              clientX: point.clientX,
              clientY: point.clientY,
              band: latest.band,
              leadRadiusPx: 0,
              measuredCardSizeById: (cardId) => latest.measuredCardSizesById.get(cardId),
              cardById: latest.cardById,
            }).target
          }
        }
      }
      // Preserve directional port semantics only when the release is truly
      // on connector chrome. React Flow's screen-space snap radius may choose
      // an incompatible nearby Handle even when the pointer is visibly over
      // the Card body; that body still fulfils the whole-surface drop intent.
      const releasedOnConnector =
        (releaseSurface.kind === 'card' && dropElements.some((element) => {
          const handle = element.closest<HTMLElement>('.react-flow__handle')
          const paintedOwner = handle?.closest<HTMLElement>('.react-flow__node[data-id]')
          return handle && paintedOwner?.dataset.id === releaseSurface.cardId
            ? clientPointHitsPaintedHandle(handle, point.clientX, point.clientY)
            : false
        })) ||
        spatialDropTarget.kind === 'card-port'
      const spatialDropCardId =
        spatialDropTarget.kind === 'card-body' || spatialDropTarget.kind === 'card-port'
          ? spatialDropTarget.cardId
          : null
      const dropCardId = domDropCardId ?? spatialDropCardId
      if (
        !(finalState.toHandle !== null && releasedOnConnector) &&
        dropCardId &&
        dropCardId !== heldHandle.nodeId
      ) {
        const sourceCardId = heldHandle.type === 'source' ? heldHandle.nodeId : dropCardId
        const targetCardId = heldHandle.type === 'source' ? dropCardId : heldHandle.nodeId
        addConnection(sourceCardId, targetCardId)
      }
    }
    if (point) hoverTrackerRef.current?.connectEnd(point.clientX, point.clientY)
    if (liveActivationEnabled) setGestureParticipantIds(EMPTY_IDS)
  }, [addConnection, endConnectionDropFeedback, liveActivationEnabled])

  // Validation consumes graph and connection rules only (C3, #320) — the
  // live store state, exactly what `addConnection` will see — never DOM or
  // proxy existence.
  const isValidConnection = useCallback((connection: RFConnection | Edge) => {
    return connectionRulesAllow(
      useGraph.getState().graph(),
      connection.source,
      connection.target,
    )
  }, [])

  // Connection selection is deliberately NOT derived here: React Flow only
  // reports edges it selected itself (click, or edges hanging off box-selected
  // nodes), so deriving from this callback used to discard every other
  // combination. Connection ids flow through onEdgesChange, onPaneClick and
  // onSelectionEnd instead (#212).
  const onSelectionChange = useCallback(({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) => {
    if (readOnly) return
    const nextNodeIds = new Set(nodes.map((node) => node.id))
    if (marqueeSelectedNodeIdsRef.current) {
      const paintedCardIds = marqueePaintedCardIdsRef.current
      const outgoing = marqueeOutgoingCardIdsRef.current
      const chosenByTheBox = new Set(
        [...nextNodeIds].filter((id) => !outgoing.has(id) || paintedCardIds?.has(id)),
      )
      marqueeSelectedNodeIdsRef.current = chosenByTheBox
      marqueeSelectionState.setCards(unionIds(chosenByTheBox, paintedCardIds))
      return
    }
    const selectedCanvasCardIds = new Set(
      canvasInteractiveCandidates
        .filter((card) => selectedNodeIds.has(card.id))
        .map((card) => card.id),
    )
    if (
      selectedCanvasCardIds.size > 0 &&
      nextNodeIds.size > 0 &&
      nextNodeIds.size < selectedNodeIds.size &&
      [...nextNodeIds].every((id) => selectedNodeIds.has(id))
    ) {
      // React Flow can publish only mounted selection. Preserve the selected
      // canvas owners it cannot report while still accepting any mounted Card
      // removals represented by this strict-subset update. In Overview/Map
      // that restores the complete proxy+painter set; in Reading it keeps an
      // S Card selected without promoting it into the DOM.
      const completeNodeIds = unionIds(nextNodeIds, selectedCanvasCardIds)
      setSelectedNodeIdsState((prev) => (
        sameIds(prev, completeNodeIds) ? prev : completeNodeIds
      ))
      return
    }
    if (readingCardOpacity === 0 && additiveModifierHeldRef.current && nextNodeIds.size > 0) {
      // React Flow can report only the one mounted gesture proxy in
      // Overview/Map. Preserve the painter-owned selection plane whenever its
      // native modifier selection callback publishes that proxy-only set.
      const union = new Set([
        ...selectedNodeIds,
        ...useGraph.getState().selectedCardIds,
        ...nextNodeIds,
      ])
      commitCardSetSelection(union, [...nextNodeIds][0]!, true)
      return
    }
    const programmaticId = programmaticSelectionRef.current
    if (programmaticId) {
      if (nextNodeIds.size === 0 && edges.length === 0) return
      if (!nextNodeIds.has(programmaticId)) programmaticSelectionRef.current = null
    }
    // Below Reading, a selected card is canvas-painted while its React Flow
    // proxy exists only near the pointer. When hover linger expires React
    // Flow reports an empty DOM selection because that proxy unmounted; that
    // is not a user deselection. The pane-click path below remains the owner
    // of a real outside click and clears selection explicitly.
    if (
      nextNodeIds.size === 0 &&
      edges.length === 0 &&
      selectedNodeIds.size > 0 &&
      (
        readingCardOpacity === 0 ||
        canvasInteractiveCandidates.some((card) => selectedNodeIds.has(card.id))
      )
    ) {
      return
    }
    // This is another mounted-plane publication from the current gesture, not
    // a fresh selection intent.
    setSelectedNodeIdsState((prev) => (sameIds(prev, nextNodeIds) ? prev : nextNodeIds))
  }, [
    canvasInteractiveCandidates,
    commitCardSetSelection,
    marqueeSelectionState,
    readOnly,
    readingCardOpacity,
    selectedNodeIds,
  ])

  const onNodeClick = useCallback((event: MouseEvent, node: Node) => {
    // A resolved click may hand focus away; a drag never reaches this path.
    blurFocusedCardAfterResolvedSelection(node.id)
    beginCardActivation(event.target, wrapRef.current ?? document.body, 'click')
    if (
      readOnly ||
      node.type !== 'gestureProxy' ||
      !(event.shiftKey || event.metaKey || event.ctrlKey || additiveModifierHeldRef.current)
    ) {
      return
    }
    // A low-LOD proxy exists only for the Card currently under the pointer,
    // so React Flow cannot retain an earlier painter-owned Card in its mounted
    // multi-selection set. Union against the graph selection at click time
    // after the library has handled the proxy click.
    const selectionAtPress =
      additiveSelectionStartRef.current ??
      new Set([...selectedNodeIds, ...useGraph.getState().selectedCardIds])
    const nextSelectedNodeIds = new Set([...selectionAtPress, node.id])
    programmaticSelectionRef.current = null
    // React Flow publishes the proxy-only selection after its click callback.
    // Commit the cross-plane union on the next frame so the library cannot
    // immediately replace it with the one mounted proxy it can see.
    commitCardSetSelection(nextSelectedNodeIds, node.id, true)
  }, [beginCardActivation, blurFocusedCardAfterResolvedSelection, commitCardSetSelection, readOnly, selectedNodeIds])

  // The drag-selection box selects every connection it touches (#212). The
  // intersection test runs on release. The rect's start corner is read from
  // React Flow's store in flow coordinates (it survives auto-pan); the
  // release corner converts the same way React Flow converts its own rect.
  const onSelectionStart = useCallback(() => {
    setWholeBoardSelected(false)
    const rect = reactFlowStore.getState().userSelectionRect
    marqueeStartRef.current = rect ? { x: rect.startX, y: rect.startY } : null
    endMarqueeSettle()
    if (!marqueeSelectionState.isActive()) {
      marqueeSelectedNodeIdsRef.current = new Set()
      marqueePaintedCardIdsRef.current = new Set()
      marqueeOutgoingCardIdsRef.current = selectedNodeIds
      marqueeSelectionState.activate(selectedNodeIds, selectedConnectionIds)
    }
  }, [
    endMarqueeSettle,
    marqueeSelectionState,
    reactFlowStore,
    selectedConnectionIds,
    selectedNodeIds,
  ])

  // Latch the gesture before React Flow clears the previous selection at the
  // drag threshold. Its reset changes therefore enter the transient channel,
  // never the controlled node array, closing the last re-measure/all-board
  // race and hiding stale handles on the pointer-down frame.
  const beginMarqueeSelectionPress = useCallback(
    (target: EventTarget | null, button: number) => {
      const element = target instanceof Element ? target : null
      if (button !== 0 || !liveMarqueeAvailable || !element?.classList.contains('react-flow__pane')) return
      marqueePressRef.current = true
      endMarqueeSettle()
      clearMarqueePreview()
      marqueeSelectedNodeIdsRef.current = new Set()
      marqueePaintedCardIdsRef.current = new Set()
      marqueeOutgoingCardIdsRef.current = selectedNodeIds
      marqueeSelectionState.activate(selectedNodeIds, selectedConnectionIds)
    },
    [
      clearMarqueePreview,
      endMarqueeSettle,
      liveMarqueeAvailable,
      marqueeSelectionState,
      selectedConnectionIds,
      selectedNodeIds,
    ],
  )

  const cardIdsTouchingMarqueeRect = useCallback(
    (rect: FlowRect) => {
      // Query the incremental spatial index by the full selection rectangle,
      // not only by the current viewport. During edge auto-pan, Cards already
      // crossed by the marquee leave the viewport but remain inside the
      // flow-space rectangle and must stay selected. This remains proportional
      // to the rectangle's spatial candidates; it never scans the Board.
      const candidates = renderIndex.query(
        { x: -rect.x, y: -rect.y, zoom: 1 },
        { width: Math.max(1, rect.width), height: Math.max(1, rect.height) },
        0,
        { includeConnections: false },
      ).cards
      return cardIdsTouchingRect({
        cards: candidates,
        measuredCardSizeById: (cardId) => measuredCardSizesById.get(cardId),
        rect,
      })
    },
    [measuredCardSizesById, renderIndex],
  )

  // React Flow previews mounted P/O/L membership itself. Painter-owned S Cards
  // use the same indexed flow-space rectangle, including Cards that leave the
  // current viewport during edge auto-pan. Coalesce high-rate pointer input to
  // one update per frame and keep the result out of controlled props.
  const previewMarqueeGeometry = useCallback(
    (clientX: number, clientY: number) => {
      if (!marqueeStartRef.current || !marqueeSelectedNodeIdsRef.current || readOnly) return
      marqueePreviewPointerRef.current = { x: clientX, y: clientY }
      if (marqueePreviewFrameRef.current !== null) return
      marqueePreviewFrameRef.current = requestAnimationFrame(() => {
        marqueePreviewFrameRef.current = null
        const start = marqueeStartRef.current
        const pointer = marqueePreviewPointerRef.current
        if (!start || !pointer) return
        const end = screenToFlowPosition(pointer)
        const rect = flowRectBetween(start, end)
        const paintedCardIds = cardIdsTouchingMarqueeRect(rect)
        marqueePaintedCardIdsRef.current = paintedCardIds
        marqueeSelectionState.setCards(unionIds(marqueeSelectedNodeIdsRef.current ?? new Set(), paintedCardIds))
        if (!showConnections) return
        const touched = connectionsTouchingRect({
          connections: marqueeVisibleConnections,
          cardById: renderIndex.cardById,
          measuredCardSizeById: (cardId) => measuredCardSizesById.get(cardId),
          rect,
        })
        marqueeSelectionState.setConnections(new Set(touched.map((connection) => connection.id)))
      })
    },
    [
      cardIdsTouchingMarqueeRect,
      marqueeSelectionState,
      readOnly,
      renderIndex,
      screenToFlowPosition,
      showConnections,
      marqueeVisibleConnections,
    ],
  )

  // React Flow auto-pans while the pointer is held at a pane edge without
  // emitting another pointermove. Re-evaluate the same held pointer whenever
  // that camera motion changes the flow-space rectangle, so painter-owned
  // Cards newly scrolled into view join the live marquee.
  useLayoutEffect(() => {
    const pointer = marqueePreviewPointerRef.current
    if (!pointer || !marqueeSelectionState.isActive()) return
    previewMarqueeGeometry(pointer.x, pointer.y)
  }, [
    marqueeSelectionState,
    previewMarqueeGeometry,
    viewport.x,
    viewport.y,
    viewport.zoom,
  ])

  const onSelectionEnd = useCallback(
    (event: MouseEvent) => {
      const start = marqueeStartRef.current
      marqueeStartRef.current = null
      const mountedNodeIdsAtRelease = marqueeSelectedNodeIdsRef.current ?? new Set<string>()
      marqueeSelectedNodeIdsRef.current = null
      let paintedCardIdsAtRelease = marqueePaintedCardIdsRef.current ?? new Set<string>()
      marqueePaintedCardIdsRef.current = null
      let selectedConnectionIdsAtRelease = new Set<string>()
      if (start && !readOnly) {
        const end = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        const rect = flowRectBetween(start, end)
        paintedCardIdsAtRelease = cardIdsTouchingMarqueeRect(rect)
        if (showConnections) {
          const touched = connectionsTouchingRect({
            connections: marqueeVisibleConnections,
            cardById: renderIndex.cardById,
            measuredCardSizeById: (cardId) => measuredCardSizesById.get(cardId),
            rect,
          })
          selectedConnectionIdsAtRelease = new Set(touched.map((connection) => connection.id))
        }
      }
      const selectedNodeIdsAtRelease = unionIds(mountedNodeIdsAtRelease, paintedCardIdsAtRelease)
      lastCardSelectionRef.current = selectedNodeIdsAtRelease
      marqueeSelectionState.setCards(selectedNodeIdsAtRelease)
      marqueeSelectionState.setConnections(selectedConnectionIdsAtRelease)
      // Commit both controlled sets before dropping the gesture override. The
      // ordinary selected render is therefore already present when the live
      // channel deactivates: no border/handle gap and no stale deselection.
      flushSync(() => {
        setSelectedNodeIds(selectedNodeIdsAtRelease)
        setSelectedConnectionIds(selectedConnectionIdsAtRelease)
      })
      clearMarqueePreview()
    },
    [
      cardIdsTouchingMarqueeRect,
      clearMarqueePreview,
      marqueeSelectionState,
      readOnly,
      renderIndex,
      screenToFlowPosition,
      showConnections,
      marqueeVisibleConnections,
    ],
  )

  // Below Reading a painted card has no editable DOM, so double-clicking it
  // flies the camera in to Reading centred on the card (reusing the deep-link
  // fly-to shape). Under C2's proximity lead the pointer over a card already
  // has its invisible proxy mounted, so the double-click lands on that proxy
  // node — this routes through the node handler, never the pane. In Reading
  // the mounted DOM card owns double-click (edit), so this stays out of its way.
  const onNodeDoubleClick = useCallback(
    (_event: MouseEvent, node: Node) => {
      if (readOnly || readingCardOpacity > 0) return
      // O(1) via the render index — interaction handlers never scan the board.
      const card = renderIndex.cardById(node.id)
      if (!card) return
      const target = cardFlyToTarget(card, getViewport().zoom)
      const { width, height } = reactFlowStore.getState()
      const targetViewport = centeredViewportForCameraTarget(target, { width, height })
      // React Flow updates its external store before its Viewport subscriber
      // necessarily commits the matching DOM transform. Reduced motion is a
      // same-frame jump, so bridge the exact store target onto this Board's
      // viewport; the subsequent React render writes the byte-equivalent value.
      commitCameraTransition(() => {
        void setCenter(target.x, target.y, {
          zoom: target.zoom,
          duration: cameraDuration(target.duration, reducedMotion),
        })
      }, reducedMotion, () => {
        const viewportElement = wrapRef.current?.querySelector<HTMLElement>('.react-flow__viewport')
        if (viewportElement) viewportElement.style.transform = cameraViewportTransform(targetViewport)
      })
    },
    [readOnly, readingCardOpacity, renderIndex, getViewport, reducedMotion, setCenter],
  )

  const onPaneClick = (event: MouseEvent) => {
    if (readOnly) return
    setWholeBoardSelected(false)
    const rect = wrapRef.current?.getBoundingClientRect()
    const hotFrame = resizeHotGeometryStore.getSnapshot()
    const hotCardById = resizeHotCardById(renderIndex.cardById, hotFrame)
    const hotMeasuredCardSizeById = resizeHotMeasuredCardSizeById(
      (cardId) => measuredCardSizesById.get(cardId),
      hotFrame,
    )
    // Hit == paint (ADR 0020): whenever the scene offers canvas-painted hit
    // candidates — every band below Reading, plus the Reading motion
    // underlay — a pane click asks the scene which painted card is under it.
    // Mounted cards are suppressed out of the candidate set and hit-test
    // themselves as DOM nodes. Cards resolve FIRST: the painter draws badges
    // before cards, so a badge under a painted card is covered paint and must
    // never steal the card's press (#322).
    if (canvasInteractiveCandidates.length) {
      const hitCard = rect
        ? hitTestSceneCardAtClientPoint({
            candidates: canvasInteractiveCandidates,
            viewport,
            viewportRect: rect,
            clientX: event.clientX,
            clientY: event.clientY,
            measuredCardSizeById: hotMeasuredCardSizeById,
            cardById: hotCardById,
          })
        : null
      if (hitCard) {
        const additiveSelection =
          event.shiftKey || event.metaKey || event.ctrlKey || additiveModifierHeldRef.current
        const selectionAtPress =
          additiveSelectionStartRef.current ??
          new Set([...selectedNodeIds, ...useGraph.getState().selectedCardIds])
        if (!additiveSelection) additiveSelectionStartRef.current = null
        const nextSelectedNodeIds = additiveSelection
          ? new Set([...selectionAtPress, hitCard.id])
          : new Set([hitCard.id])
        programmaticSelectionRef.current = additiveSelection ? null : hitCard.id
        if (
          hitCard.kind === 'note' ||
          hitCard.kind === 'askAi' ||
          hitCard.kind === 'conversation'
        ) {
          publishResolvedCardEditIntent({
            ideaId: currentIdeaId,
            cardId: hitCard.id,
            clientX: event.clientX,
            clientY: event.clientY,
          })
        }
        blurFocusedCardAfterResolvedSelection(hitCard.id)
        beginCardActivationById(hitCard.id, 'click')
        commitCardSetSelection(nextSelectedNodeIds, hitCard.id, additiveSelection)
        return
      }
    }
    blurFocusedCardAfterResolvedSelection(null)
    // The same query-capped connection candidate set the painter uses, planned
    // once and shared by the badge and line hit tests below (#322). Empty when
    // connections are DOM edges (Reading) — there the mounted edge owns both.
    const capturedPaintedConnections = hotFrame
      ? resizeHotGeometryStore.getPaintedConnectionsSnapshot(hotFrame.cardId, hotFrame.sessionId)
      : null
    const paintedConnections =
      capturedPaintedConnections?.connections ??
      (shouldPlanConnections && rect
        ? planPaintedConnections({
            connections: renderIndex.query(viewport, viewportSize, overviewMarginPx, {
              includeConnections: true,
              maxConnections: connectionLimitForZoom(viewport.zoom),
            }).connections,
            suppressedConnectionIds: mountedConnectionIds,
            cardById: hotCardById,
            measuredCardSizeById: hotMeasuredCardSizeById,
            viewport,
            viewportSize,
          })
        : [])
    // The badge is the connection's topmost UNCOVERED paint, so with no card
    // under the point it resolves ahead of the line (hit == paint, #322): the
    // disc comes from the shared geometry owner and membership from the shared
    // suppression predicate — a badge the painter suppressed (zoom floor or
    // density cap) is unpainted and therefore unhittable. The badge opens the
    // connection editor — the Overview/Map counterpart of the Reading pill.
    if (rect && paintedConnections.length) {
      const pointX = event.clientX - rect.left
      const pointY = event.clientY - rect.top
      const badgeHit = paintedConnections.find(
        (painted, paintedIndex) =>
          connectionBadgePaintedAtIndex(paintedIndex, viewport.zoom) &&
          pointHitsConnectionBadge(painted, viewport.zoom, pointX, pointY, {
            expanded: painted.connection.id === hoveredConnectionId,
          }),
      )
      if (badgeHit) {
        programmaticSelectionRef.current = badgeHit.connection.id
        lastCardSelectionRef.current = new Set()
        setSelectedNodeIds(new Set())
        setSelectedConnectionIds(new Set([badgeHit.connection.id]))
        setSelectedCardIds([])
        select({ kind: 'connection', id: badgeHit.connection.id })
        openConnectionEditor(badgeHit.connection.id)
        return
      }
    }
    // Canvas-painted connections have no DOM edge to click, so the pane click
    // is the only signal — hit test the same connections the overview layer
    // paints (#211). Runs after the card hit test: cards paint over lines.
    // The query cap must match the painter's, and the hit test applies the
    // painter's plan on top, so a click can only ever land on a line the
    // user can see — never an invisible one past the paint cap.
    if (shouldPlanConnections && rect) {
      const hitConnection = hitTestPaintedConnectionsAtClientPoint({
        paintedConnections,
        viewport,
        viewportRect: rect,
        clientX: event.clientX,
        clientY: event.clientY,
      })
      if (hitConnection) {
        programmaticSelectionRef.current = hitConnection.id
        lastCardSelectionRef.current = new Set()
        setSelectedNodeIds(new Set())
        setSelectedConnectionIds(new Set([hitConnection.id]))
        setSelectedCardIds([])
        select({ kind: 'connection', id: hitConnection.id })
        openConnectionEditor(hitConnection.id)
        return
      }
    }
    programmaticSelectionRef.current = null
    lastCardSelectionRef.current = new Set()
    setSelectedNodeIds(new Set())
    setSelectedConnectionIds(new Set())
    setSelectedCardIds([])
    select(null)
  }

  const restorePreviousView = () => {
    const snapshot = viewportBackStack[viewportBackStack.length - 1]
    if (!snapshot) return

    const state = historyState()
    if (state.eidoKind === 'deepLink') {
      window.history.back()
      return
    }

    setViewportBackStack((stack) => stack.slice(0, -1))
    void restoreSnapshot(snapshot)
  }

  return (
    <div
      ref={wrapRef}
      className={`board-flow ${readOnly ? 'board-flow-playback' : ''} tool-${activeTool}`}
      role="region"
      aria-label={words.board}
      tabIndex={-1}
      style={boardStyle}
      data-excluded-participant-count={excludedParticipantIds.size}
      data-excluded-participant-ids={
        excludedParticipantIds.size ? [...excludedParticipantIds].sort().join(' ') : undefined
      }
      data-hovered-card-id={hoveredCardId ?? undefined}
      data-live-transition-card-id={liveTransitionCardId ?? undefined}
      data-hovered-connection-id={hoveredConnectionId ?? undefined}
      data-motion-underlay-active={
        readingCardOpacity >= 1 &&
        mountPlan.paintOccludingCardIds.size > 0 &&
        mountPlan.overviewSuppressedCardIds.size === 0
          ? 'true'
          : undefined
      }
      data-residency-mode={readOnly ? undefined : 'bounded-reading'}
      data-whole-board-selected={wholeBoardSelected ? 'true' : undefined}
      data-passive-card-count={readOnly ? undefined : boardScene.passiveCardIds.size}
      data-live-card-count={readOnly ? undefined : mountPlan.liveCardIds.size}
      data-safety-card-count={readOnly ? undefined : boardScene.safetyCardIds.size}
      data-board-detail-text-weight={readOnly ? undefined : boardScene.boardDetailTextWeight}
      data-admitted-detail-text-weight={readOnly ? undefined : boardScene.admittedDetailTextWeight}
      data-oversize-passive-card-count={readOnly ? undefined : boardScene.oversizePassiveCardIds.size}
      data-oversize-passive-text-weight={readOnly ? undefined : boardScene.oversizePassiveTextWeight}
      data-detail-text-weight-budget={readOnly ? undefined : boardScene.detailTextWeightBudget}
      data-weight-demoted-card-count={readOnly ? undefined : boardScene.weightDemotedCardIds.size}
      onPointerDownCapture={(event) => {
        if (event.button === 0) selectionIntentRevisionRef.current += 1
        handledLowLodAdditivePressRef.current = false
        marqueePressRef.current = false
        const target = event.target instanceof Element ? event.target : null
        const additiveSelection =
          event.button === 0 &&
          (event.shiftKey || event.metaKey || event.ctrlKey || additiveModifierHeldRef.current)
        const proxyNode = target?.closest<HTMLElement>('.react-flow__node-gestureProxy')
        const proxyCardId = proxyNode?.dataset.id
        const wrapperRect = event.currentTarget.getBoundingClientRect()
        const hotFrame = resizeHotGeometryStore.getSnapshot()
        const hotCardById = resizeHotCardById(renderIndex.cardById, hotFrame)
        const hotMeasuredCardSizeById = resizeHotMeasuredCardSizeById(
          (cardId) => measuredCardSizesById.get(cardId),
          hotFrame,
        )
        const paintedCardId =
          additiveSelection && !proxyCardId && canvasInteractiveCandidates.length
            ? hitTestSceneCardAtClientPoint({
                candidates: canvasInteractiveCandidates,
                viewport,
                viewportRect: wrapperRect,
                clientX: event.clientX,
                clientY: event.clientY,
                measuredCardSizeById: hotMeasuredCardSizeById,
                cardById: hotCardById,
              })?.id
            : undefined
        const additiveCardId = proxyCardId ?? paintedCardId ?? canvasPointerCardIdRef.current
        if (
          additiveSelection &&
          activeTool === 'select' &&
          readingCardOpacity === 0 &&
          additiveCardId
        ) {
          // React Flow sees only the one low-LOD proxy under the pointer, so
          // its native multi-select would replace earlier painter selections.
          // Own this modifier press at the wrapper boundary and keep the
          // graph-level set intact.
          event.preventDefault()
          event.stopPropagation()
          handledLowLodAdditivePressRef.current = true
          const additiveBase =
            additiveSelectionStartRef.current ??
            new Set([
              ...selectedNodeIds,
              ...useGraph.getState().selectedCardIds,
            ])
          additiveSelectionStartRef.current = new Set(additiveBase)
          const nextSelectedNodeIds = new Set([
            ...additiveBase,
            ...selectedNodeIds,
            ...useGraph.getState().selectedCardIds,
            additiveCardId,
          ])
          commitCardSetSelection(nextSelectedNodeIds, additiveCardId)
          return
        }
        beginCardActivation(event.target, event.currentTarget, 'press')
        beginMarqueeSelectionPress(event.target, event.button)
        additiveSelectionStartRef.current =
          additiveSelection
            ? new Set([...selectedNodeIds, ...useGraph.getState().selectedCardIds])
            : null
      }}
      onMouseDownCapture={(event) => {
        if (marqueePressRef.current) {
          // Refuse only the native selection drag. Pointer events, the click
          // that follows, and React Flow's own box selection are untouched:
          // `preventDefault` on `mousedown` suppresses the browser's text
          // anchor, nothing else. Any wash left by an earlier in-Card text
          // selection is dropped too, matching what an ordinary pane press
          // would have done.
          event.preventDefault()
          // Refusing the default also refuses the focus and caret change the
          // press would otherwise make, so an editing session survives into the
          // drag: a still-focused Card editor keeps its caret, and the browser
          // grows the wash from that anchor as the box crosses the Card. End
          // the session's DOM state with the press: drop the focus and EVERY
          // range, collapsed carets included. A press inside a Card is never a
          // marquee press, so ordinary in-Card text selection is untouched.
          const editing = document.activeElement
          if (editing instanceof HTMLElement && isEditableTarget(editing)) editing.blur()
          const selection = window.getSelection()
          if (selection?.rangeCount) selection.removeAllRanges()
        }
        if (focusedMarkdownEditorForDifferentDragCapablePress({
          target: event.target,
          activeElement: document.activeElement,
          boardRoot: event.currentTarget,
          button: event.button,
          modified: event.shiftKey || event.metaKey || event.ctrlKey || event.altKey,
        })) event.preventDefault()
      }}
      onClickCapture={(event) => {
        if (!handledLowLodAdditivePressRef.current) return
        handledLowLodAdditivePressRef.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
      onPointerMoveCapture={(event) => previewMarqueeGeometry(event.clientX, event.clientY)}
      onFocusCapture={(event) => beginCardActivation(event.target, event.currentTarget, 'focus')}
      onBlurCapture={(event) => {
        releaseFocusedCard(event.target, event.relatedTarget, event.currentTarget)
      }}
      onWheelCapture={(event) => {
        if (!liveActivationEnabled) return
        // Ctrl/meta wheel is Board zoom, not Card scrolling. Treating it as
        // scrolling promotes the rich Card owner and starts a competing 240ms
        // settle timer on every pinch tick.
        if (event.ctrlKey || event.metaKey) return
        const cardId = cardIdFromEventTarget(event.target)
        if (!cardId) return
        setScrollingCardId(cardId)
        if (scrollingReleaseTimerRef.current !== null) window.clearTimeout(scrollingReleaseTimerRef.current)
        scrollingReleaseTimerRef.current = window.setTimeout(() => setScrollingCardId(null), 240)
      }}
      onPlayCapture={(event) => {
        if (!liveActivationEnabled) return
        const cardId = cardIdFromEventTarget(event.target)
        if (!cardId) return
        setActiveMediaCardIds((current) => new Set(current).add(cardId))
      }}
      onPauseCapture={(event) => {
        const cardId = cardIdFromEventTarget(event.target)
        if (!cardId) return
        setActiveMediaCardIds((current) => {
          if (!current.has(cardId)) return current
          const next = new Set(current)
          next.delete(cardId)
          return next.size ? next : EMPTY_IDS
        })
      }}
      onEndedCapture={(event) => {
        const cardId = cardIdFromEventTarget(event.target)
        if (!cardId) return
        setActiveMediaCardIds((current) => {
          if (!current.has(cardId)) return current
          const next = new Set(current)
          next.delete(cardId)
          return next.size ? next : EMPTY_IDS
        })
      }}
      // Painted-port zone (#320 amendment 9): every below-Reading band
      // paints port discs (Map and Overview alike), and the proxy handles
      // are press-gated to the armed disc via the dataset below at every
      // zoom. In Reading the canvas paints no cards and the mounted DOM
      // cards own their handles, so no zone is declared.
      data-canvas-port-zone={
        !readOnly && readingCardOpacity === 0 && paintedPortsHittable(boardScene.band) ? 'painted' : undefined
      }
      // The marquee owns left-drag selection across both mounted P/O/L and
      // painter-owned S Cards in every scene band. This flag reports the
      // scene-level availability (not the latched per-press value) so tests
      // and tooling can read the live state after a settle.
      data-scene-marquee-available={liveMarqueeAvailable ? 'true' : undefined}
    >
      {!readOnly && viewportBackStack.length > 0 && (
        <Button className="viewport-back-control" onClick={restorePreviousView}>
          {words.backToPreviousView}
        </Button>
      )}
      {!readOnly && deepLinkNotice && (
        <Toast key={deepLinkNotice.id} className="deep-link-toast" tone="avoid">
          {deepLinkNotice.message}
        </Toast>
      )}
      {!readOnly && wholeBoardSelected && (
        <Toast className="deep-link-toast board-selection-status">{words.wholeBoardSelected}</Toast>
      )}
      <MarqueeSelectionProvider state={marqueeSelectionState}>
        <ReactFlow
          aria-label={words.boardCanvas}
          key={readOnly ? 'playback' : 'live'}
          nodes={nodes}
          edges={edges}
          nodeTypes={allNodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={readOnly ? undefined : onNodesChange}
        onEdgesChange={readOnly ? undefined : onEdgesChange}
        onSelectionChange={readOnly ? undefined : onSelectionChange}
        onSelectionStart={readOnly ? undefined : onSelectionStart}
        onSelectionEnd={readOnly ? undefined : onSelectionEnd}
        onConnect={readOnly ? undefined : onConnect}
        onConnectStart={readOnly ? undefined : onConnectStart}
        onConnectEnd={readOnly ? undefined : onConnectEnd}
        isValidConnection={readOnly ? undefined : isValidConnection}
        connectionRadius={CONNECTION_SNAP_SCREEN_PX / Math.max(0.01, zoom)}
        onNodeClick={readOnly ? undefined : onNodeClick}
        onNodeDoubleClick={readOnly ? undefined : onNodeDoubleClick}
        onPaneClick={readOnly ? undefined : onPaneClick}
        // Pointer mode box-selects on an empty-area left-drag in every scene
        // band, across mounted P/O/L and painter-owned S Cards. Availability
        // is latched at pointer-down so a tool change cannot flip a live
        // gesture.
        // When the marquee is unavailable the left button joins middle/right
        // on panOnDrag. Move mode owns left-drag panning outright.
        selectionOnDrag={pressMarqueeAvailableRef.current ?? liveMarqueeAvailable}
        selectionKeyCode={readOnly || activeTool === 'select' ? null : 'Shift'}
        panOnDrag={
          readOnly || activeTool === 'pan'
            ? true
            : (pressMarqueeAvailableRef.current ?? liveMarqueeAvailable)
              ? [1, 2]
              : [0, 1, 2]
        }
        panOnScroll={panOnScroll}
        zoomOnScroll={false}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={readOnly ? null : ['Shift', 'Meta', 'Control']}
        deleteKeyCode={null}
        // Press-and-move vs click disambiguation (#210): a press must travel a
        // few pixels before it becomes a drag, so a stationary click still goes
        // "into" the card (title, buttons). Click distance matches the threshold
        // so a slightly jittery click is not swallowed as an aborted drag.
        nodeDragThreshold={5}
        nodeClickDistance={5}
        // Below Reading a past-threshold drag must NOT change selection (#321,
        // frozen gesture semantics): React Flow's default selectNodesOnDrag
        // (true) would select an initially unselected proxy the moment the
        // drag threshold crosses. Scoped to the band — in Reading this stays
        // true (the library default), so mounted-card behaviour is unchanged
        // — and latched at pointer-down (see the latch above), so a band
        // promotion mid-press cannot flip the policy under a live gesture.
        // Click-select is unaffected either way: it runs through the click
        // path (nodeClickDistance), not the drag path.
        selectNodesOnDrag={pressDragSelectPolicyRef.current ?? liveDragSelectPolicy}
        nodesDraggable={!readOnly && activeTool === 'select'}
        nodesConnectable={!readOnly && activeTool === 'select'}
        elementsSelectable={!readOnly && activeTool === 'select'}
        nodesFocusable={!readOnly && activeTool !== 'pan'}
        edgesFocusable={!readOnly && activeTool === 'select'}
        // React Flow's fit is a one-shot bootstrap for the current Board. The
        // explicit graph-bounds fit (or an exact dev/deep-link camera request)
        // pins fittedIdeaIdRef, after which LOD opacity changes must never
        // re-arm the library fit: doing so lets the Overview→Reading handoff
        // replace an in-flight pinch with a fit around the newly mounted nodes.
        fitView={
          !readOnly &&
          !resumeViewport &&
          fittedIdeaIdRef.current !== currentIdeaId &&
          readingCardOpacity > 0
        }
        // Cap this bootstrap fit the same way as the explicit graph-bounds
        // fit above: a sparse or single-card board must not snap to the
        // manual maxZoom ceiling below.
        fitViewOptions={{ maxZoom: BOARD_FIT_MAX_ZOOM }}
        defaultViewport={!readOnly && resumeViewport ? resumeViewport : undefined}
        proOptions={{ hideAttribution: true }}
        minZoom={minZoom}
        maxZoom={4}
      >
        <Background gap={22} size={1} color="var(--e-grid-dot)" />
        {!readOnly && useOverviewLayer && (
          <BoardOverviewLayer
            theme={theme}
            renderIndex={renderIndex}
            viewport={viewport}
            viewportSize={viewportSize}
            marginPx={overviewMarginPx}
            renderCards={renderCanvasCards}
            // The bounded painter owns any viewport-touching connection whose
            // remote Card left Reading residency. Mounted DOM edges are
            // suppressed so each connection has exactly one representation.
            renderConnections={shouldPlanConnections}
            suppressedConnectionIds={mountedConnectionIds}
            selectedCardIds={selectedNodeIds}
            marqueeSelectionState={marqueeSelectionState}
            // The frozen `hoveredCardId` producer (C2, #314): the painted
            // hover ring and B4's hover-always-wins label rule read this.
            hoveredCardId={hoveredCardId}
            hoveredConnectionId={hoveredConnectionId}
            reactCardIds={mountPlan.paintOccludingCardIds}
            suppressedCardIds={mountPlan.overviewSuppressedCardIds}
            measuredCardSizesById={measuredCardSizesById}
            readingCardOpacity={readingCardOpacity}
            cardSummariesById={cardSummariesById}
            resizeHotGeometryStore={resizeHotGeometryStore}
          />
        )}
        {connectionEditorHost && (
          <ConnectionPopover
            connection={connectionEditorHost.connection}
            labelX={connectionEditorHost.labelX}
            labelY={connectionEditorHost.labelY}
            pillRef={connectionEditorHostPillRef}
            returnFocusRef={wrapRef}
            onClose={closeConnectionEditor}
          />
        )}
        <Controls showInteractive={false} />
        </ReactFlow>
      </MarqueeSelectionProvider>
    </div>
  )
}
