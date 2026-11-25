import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Card, Connection } from '../graph/types'
import { isAgentUnadoptedCard } from '../graph/cardAuthorship'
import { cardText } from '../graph/graphHelpers'
import {
  CARD_SHELL_METRICS,
  CONNECTOR_NODE_METRICS,
  DEFAULT_THEME,
  designTokensForTheme,
  GROUP_CARD_SURFACE_OPACITY,
  painterPaletteForTheme,
  painterPaletteIdentity,
  type PainterPalette,
  type ThemeId,
} from '../ui/tokens'
import {
  connectionLimitForZoom,
  MAP_BAND_MAX_ZOOM,
  planPaintedConnections,
  READING_BAND_MIN_ZOOM,
  type CanvasCardSummary,
  type DetailBand,
  type PaintedConnection,
} from './boardScene'
import {
  createLabelSortCache,
  drawLabels,
  loadLabelFont,
  paintedLabelFrameCap,
  type LabelCandidate,
  type LabelSortCache,
} from './labelLayer'
import {
  renderedCardSize,
  resolvedCardSize,
  type BoardRenderIndex,
  type BoardViewport,
  type BoardViewportSize,
} from './renderPlanning'
import {
  bandCrossfade,
  handleScaleForZoom,
  paintedConnectionBadgeGeometry,
  paintedPortGeometry,
} from './zoomChrome'
import { CONNECTION_BADGE_MIN_ZOOM, connectionBadgePaintedAtIndex } from './connectionBadgeHit'
import {
  cardWithResizeHotGeometry,
  resizeHotCardById,
  resizeHotMeasuredCardSizeById,
  type BoardResizeHotFrame,
  type BoardResizeHotGeometryStore,
} from './boardResizeHotGeometry'
import { CONNECTION_LIGHT_STROKE_WIDTH, connectionAppearance } from './connections/connectionAppearance'
import { CARD_RESIZE_HANDLE_GEOMETRY } from './resizeHandleGeometry'
import { connectionArrowGeometry } from './connections/connectionArrow'
import type { MarqueeSelectionState } from './marqueeSelectionState'
import { paintTitleCardText } from './titleCardCanvasText'

declare global {
  interface Window {
    __EIDO_FORCE_OVERVIEW_DRAW__?: () => void
    __EIDO_OVERVIEW_CARD_IDS__?: Set<string>
  }
}

const EMPTY_RESIZE_HOT_GEOMETRY_STORE: BoardResizeHotGeometryStore = {
  getSnapshot: () => null,
  getCardSnapshot: () => null,
  getPaintedConnectionsSnapshot: () => null,
  subscribe: () => () => undefined,
  subscribeCard: () => () => undefined,
  subscribeBegin: () => () => undefined,
  subscribeTerminal: () => () => undefined,
  capturePaintedConnections: () => undefined,
  receive: () => undefined,
  acknowledge: () => undefined,
  dispose: () => undefined,
}
const EMPTY_CONNECTION_IDS: ReadonlySet<string> = new Set()
const EMPTY_CARD_IDS: ReadonlySet<string> = EMPTY_CONNECTION_IDS

type BoardOverviewLayerProps = {
  theme: ThemeId
  renderIndex: BoardRenderIndex
  viewport: BoardViewport
  viewportSize: BoardViewportSize
  marginPx: number
  renderCards: boolean
  renderConnections: boolean
  /** Connections already represented by mounted React Flow edges. */
  suppressedConnectionIds?: ReadonlySet<string>
  selectedCardIds: ReadonlySet<string>
  /** Gesture-local selection for painter-owned Cards before the final commit. */
  marqueeSelectionState?: MarqueeSelectionState
  // Painted hover affordance (story 12). No producer is wired yet — Lane C's
  // hover rework owns feeding this; until then it is always undefined and no
  // hover ring paints.
  hoveredCardId?: string | null
  /** Canvas-painted connection currently owned by the rAF hot adapter. */
  hoveredConnectionId?: string | null
  // Cards with a visual mounted React node (cold P plus hot L, never proxy
  // G). Their underlay geometry must be pixel-aligned via measured DOM sizes
  // — a guessed size ghosts out past the real card during motion
  // (#126/#158/#216).
  reactCardIds: ReadonlySet<string>
  // Cards the underlay must not draw at all (the settled #158 guarantee).
  // Distinct from reactCardIds: while the viewport moves this set empties
  // so mounted cards stay represented for the dense perf gate (#167).
  suppressedCardIds: ReadonlySet<string>
  measuredCardSizesById: ReadonlyMap<string, RenderedCardSize>
  /** Effective opacity of the mounted Reading card visuals. */
  readingCardOpacity: number
  // The canvas text source: labels draw `summary.label` and take their tier
  // straight off `summary.displayPriority` (A2's frozen seam). Only a
  // painter-owned Reading safety Card also draws the bounded `summary.preview`
  // inside its body; mounted native Cards and lower bands do not.
  cardSummariesById: ReadonlyMap<string, CanvasCardSummary>
  resizeHotGeometryStore?: BoardResizeHotGeometryStore
}

export type RenderedCardSize = {
  width: number
  height: number
}

type ViewportSnapshot = {
  viewport: BoardViewport
  viewportSize: BoardViewportSize
}

type ConnectionRenderSummary = {
  connections: number
  badges: number
  omittedBadges: number
}

const DEFAULT_PAINTER_PALETTE = painterPaletteForTheme(DEFAULT_THEME)
const DEFAULT_DESIGN_TOKENS = designTokensForTheme(DEFAULT_THEME)

// `S` is a bounded visual summary, never a second semantic Card renderer.
// These values reuse the native Card's prose role and shell rhythm while the
// excerpt itself remains capped by `CanvasCardSummary.preview` (90 chars).
const SAFETY_PREVIEW_FONT_BOARD_PX = Number.parseFloat(DEFAULT_DESIGN_TOKENS['--e-fs-prose-s'])
const SAFETY_PREVIEW_FONT_FAMILY = DEFAULT_DESIGN_TOKENS['--e-sans']
const SAFETY_PREVIEW_LINE_HEIGHT = 1.5
const SAFETY_PREVIEW_HEADER_BOARD_PX = 36
const SAFETY_PREVIEW_PADDING_BOARD_PX = 14
const SAFETY_PREVIEW_MAX_LINES = 6
const SAFETY_PREVIEW_MIN_SCREEN_FONT_PX = 6

// Compatibility export for geometry/label tests and non-painter consumers.
// Every value comes from the frozen token authority; actual paint resolves
// the active palette at draw time and never reads this default-theme map.
export const KIND_COLORS: Record<Card['kind'], { stroke: string; fill: string }> = {
  note: DEFAULT_PAINTER_PALETTE.cards.note,
  askAi: DEFAULT_PAINTER_PALETTE.cards.ask,
  result: DEFAULT_PAINTER_PALETTE.cards.result,
  title: DEFAULT_PAINTER_PALETTE.cards.title,
  group: DEFAULT_PAINTER_PALETTE.cards.group,
  mod: DEFAULT_PAINTER_PALETTE.cards.mod,
  conversation: DEFAULT_PAINTER_PALETTE.cards.conversation,
}

const RING_OFFSET_PX = 2.5
const RING_WIDTH_PX = 2

const CONNECTION_BADGE_ALPHA = 0.9

/**
 * The two painted card representations (issue #309): the Overview band's
 * simplified card shape and the Map band's pill. Reading has no third shape:
 * a painter-owned safety Card uses the Overview geometry, while native DOM
 * remains the only complete Reading representation.
 */
export type PaintedRepresentation = 'overview' | 'map'

export function paintedRepresentationForBand(band: DetailBand): PaintedRepresentation {
  return band === 'map' ? 'map' : 'overview'
}

// The painter derives its band per drawn frame from the live viewport
// transform (which runs ahead of React state during gestures) as a PURE
// function of zoom — no history, no hysteresis: the representation at a zoom
// never depends on how the user got there (the epic's zoom-pure thesis).
// Inside a crossfade window, CH3's `bandCrossfade` curve (zoomChrome) is the
// transition authority: past its midpoint the higher band's representation
// paints. Outside the windows, the frozen ADR 0019 thresholds decide.
const PAINT_BAND_THRESHOLDS = { readingMinZoom: READING_BAND_MIN_ZOOM, mapMaxZoom: MAP_BAND_MAX_ZOOM }

export function overviewPaintBand(zoom: number): DetailBand {
  const fade = bandCrossfade(zoom, PAINT_BAND_THRESHOLDS)
  if (fade) return fade.t <= 0.5 ? fade.from : fade.to
  if (zoom >= READING_BAND_MIN_ZOOM) return 'reading'
  if (zoom <= MAP_BAND_MAX_ZOOM) return 'map'
  return 'overview'
}

export type OverviewDrawScheduler = {
  onPropsCommit(
    suppressedCardIds: ReadonlySet<string>,
    paintIdentity: string,
    suppressedConnectionIds?: ReadonlySet<string>,
    reactCardIds?: ReadonlySet<string>,
  ): void
  markDirty(): void
  isDirty(): boolean
  consumeDirty(): boolean
}

export type LabelFontRevisionTracker = {
  current(): number
  markReady(): void
}

/** Font readiness is a paint-input change: advance the cache revision and dirty the layer together. */
export function createLabelFontRevisionTracker(markDirty: () => void): LabelFontRevisionTracker {
  let revision = 0
  return {
    current: () => revision,
    markReady() {
      revision += 1
      markDirty()
    },
  }
}

// Draw-scheduling seam (#214). A props commit normally only marks the layer
// dirty; the rAF loop performs the actual redraw, so any number of same-frame
// commits (per-frame drag commits, resize bursts) coalesce into one draw —
// never a synchronous full-canvas redraw with forced-layout reads per commit.
// Pre-paint is required for either paint-input identity or suppression-set
// membership changes: a theme must never flash one stale palette frame, and
// a card promoted to (or demoted from) a mounted React node must vanish from /
// reappear on the underlay in the same paint. DOM/canvas connection handoffs
// use the same rule so a synchronized edge removal cannot leave a blank or
// doubled frame. If several inputs change in one commit, the single boolean
// OR still draws exactly once. Suppression sets arrive as fresh objects per
// scene rebuild, so membership — not identity — decides.
export function createOverviewDrawScheduler(drawPrePaint: () => void): OverviewDrawScheduler {
  let previousSuppressedCardIds: ReadonlySet<string> | null = null
  let previousSuppressedConnectionIds: ReadonlySet<string> | null = null
  let previousReactCardIds: ReadonlySet<string> | null = null
  let previousPaintIdentity: string | null = null
  let dirty = true
  return {
    onPropsCommit(
      suppressedCardIds,
      paintIdentity,
      suppressedConnectionIds = EMPTY_CONNECTION_IDS,
      reactCardIds = EMPTY_CARD_IDS,
    ) {
      dirty = true
      const suppressionChanged =
        previousSuppressedCardIds !== null && !sameCardIdSet(previousSuppressedCardIds, suppressedCardIds)
      const connectionSuppressionChanged =
        previousSuppressedConnectionIds !== null &&
        !sameCardIdSet(previousSuppressedConnectionIds, suppressedConnectionIds)
      const reactMembershipChanged =
        previousReactCardIds !== null && !sameCardIdSet(previousReactCardIds, reactCardIds)
      const paintIdentityChanged = previousPaintIdentity !== null && previousPaintIdentity !== paintIdentity
      previousSuppressedCardIds = suppressedCardIds
      previousSuppressedConnectionIds = suppressedConnectionIds
      previousReactCardIds = reactCardIds
      previousPaintIdentity = paintIdentity
      if (suppressionChanged || connectionSuppressionChanged || reactMembershipChanged || paintIdentityChanged) {
        drawPrePaint()
      }
    },
    markDirty() {
      dirty = true
    },
    isDirty() {
      return dirty
    },
    consumeDirty() {
      const wasDirty = dirty
      dirty = false
      return wasDirty
    },
  }
}

function sameCardIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const id of b) {
    if (!a.has(id)) return false
  }
  return true
}

type OverviewFramePaintState = {
  band: DetailBand
  representation: PaintedRepresentation
  effectiveReadingOpacity: number
  overviewCardOpacity: number
  readingOverviewFade: boolean
  shapePaints: ReadonlyArray<{ representation: PaintedRepresentation; opacity: number }>
}

function overviewFramePaintState(zoom: number, readingCardOpacity: number): OverviewFramePaintState {
  const band = overviewPaintBand(zoom)
  const representation = paintedRepresentationForBand(band)
  const fade = bandCrossfade(zoom, PAINT_BAND_THRESHOLDS)
  const overviewMapFade = fade?.from === 'map' && fade.to === 'overview' ? fade : null
  const effectiveReadingOpacity = Math.max(0, Math.min(1, readingCardOpacity))
  const readingOverviewFade = effectiveReadingOpacity > 0 && effectiveReadingOpacity < 1
  const overviewCardOpacity = readingOverviewFade ? 1 - effectiveReadingOpacity : 1
  return {
    band,
    representation,
    effectiveReadingOpacity,
    overviewCardOpacity,
    readingOverviewFade,
    shapePaints: overviewMapFade
      ? [
          { representation: 'map', opacity: 1 - overviewMapFade.t },
          { representation: 'overview', opacity: overviewMapFade.t },
        ]
      : [{ representation, opacity: overviewCardOpacity }],
  }
}

type CardBodyPaintMode = 'silhouette' | 'opaque-safety' | 'frame-plan'

/** One ownership decision shared by the cold plane and resize-hot repaint. */
function cardBodyPaintMode(readingMounted: boolean, readingOverviewFade: boolean): CardBodyPaintMode {
  if (readingMounted && !readingOverviewFade) return 'silhouette'
  if (!readingMounted && readingOverviewFade) return 'opaque-safety'
  return 'frame-plan'
}

function fitSafetyPreviewLine(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string {
  if (context.measureText(value).width <= maxWidth) return value
  let end = value.length
  while (end > 1 && context.measureText(`${value.slice(0, end)}…`).width > maxWidth) end -= 1
  return `${value.slice(0, end).trimEnd()}…`
}

function safetyPreviewLines(
  context: CanvasRenderingContext2D,
  preview: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = preview.trim().split(/\s+/)
  const lines: string[] = []
  let line = ''
  let wordIndex = 0
  while (wordIndex < words.length && lines.length < maxLines) {
    const word = words[wordIndex]
    const candidate = line ? `${line} ${word}` : word
    if (!line || context.measureText(candidate).width <= maxWidth) {
      line = candidate
      wordIndex += 1
      continue
    }
    lines.push(fitSafetyPreviewLine(context, line, maxWidth))
    line = ''
  }
  if (line && lines.length < maxLines) lines.push(fitSafetyPreviewLine(context, line, maxWidth))
  if (wordIndex < words.length && lines.length > 0) {
    lines[lines.length - 1] = fitSafetyPreviewLine(context, `${lines[lines.length - 1]}…`, maxWidth)
  }
  return lines
}

function paintSafetyCardPreview(
  context: CanvasRenderingContext2D,
  preview: string,
  palette: PainterPalette,
  frame: { x: number; y: number; width: number; height: number; zoom: number },
  lineBudget: number,
): number {
  const fontPx = SAFETY_PREVIEW_FONT_BOARD_PX * frame.zoom
  if (fontPx < SAFETY_PREVIEW_MIN_SCREEN_FONT_PX) return 0
  const paddingPx = SAFETY_PREVIEW_PADDING_BOARD_PX * frame.zoom
  const top = frame.y + (SAFETY_PREVIEW_HEADER_BOARD_PX + SAFETY_PREVIEW_PADDING_BOARD_PX) * frame.zoom
  const maxWidth = frame.width - paddingPx * 2
  const linePx = fontPx * SAFETY_PREVIEW_LINE_HEIGHT
  const availableHeight = frame.y + frame.height - paddingPx - top
  const maxLines = Math.min(SAFETY_PREVIEW_MAX_LINES, lineBudget, Math.floor(availableHeight / linePx))
  if (!(maxWidth > 0) || maxLines < 1 || preview.trim().length === 0) return 0

  context.save()
  context.font = `400 ${fontPx}px ${SAFETY_PREVIEW_FONT_FAMILY}`
  context.fillStyle = palette.label.softInk
  context.textBaseline = 'top'
  context.textAlign = 'left'
  const lines = safetyPreviewLines(context, preview, maxWidth, maxLines)
  for (const [index, line] of lines.entries()) {
    context.fillText(line, frame.x + paddingPx, top + index * linePx)
  }
  context.restore()
  return lines.length
}

type ResizeRetainedIdentity = {
  renderIndex: BoardRenderIndex
  viewport: BoardViewport
  viewportSize: BoardViewportSize
  transform: string
  ratio: number
  marginPx: number
  renderCards: boolean
  renderConnections: boolean
  suppressedConnectionIds: ReadonlySet<string>
  selectedCardIds: ReadonlySet<string>
  hoveredCardId?: string | null
  reactCardIds: ReadonlySet<string>
  suppressedCardIds: ReadonlySet<string>
  measuredCardSizesById: ReadonlyMap<string, RenderedCardSize>
  readingCardOpacity: number
  cardSummariesById: ReadonlyMap<string, CanvasCardSummary>
  paintIdentity: string
  fontRevision: number
}

type ResizeRetainedPlan = {
  cardId: string
  sessionId: number
  card: Card
  connections: PaintedConnection[]
  incidentIndexes: number[]
  identity: ResizeRetainedIdentity
  preparedPosition: { x: number; y: number }
  cardPlane: HTMLCanvasElement
  labelPlane: HTMLCanvasElement
  activeLabelPlane: HTMLCanvasElement
  anchorPlane: HTMLCanvasElement
  diagnostics: {
    connectionCandidateCount: number
    connectionCapApplied: boolean
    omittedConnectionCount: number
    coldRenderedCardCount: number
    coldRepresentationCount: number
    coldSilhouetteCardCount: number
    coldSuppressedReactCardCount: number
    coldResizeAnchorCount: number
    paintedCardIds: Set<string>
    labels: {
      paintedLabelCount: number
      cacheEntries: number
      cacheBytes: number
      drawn: number
      ramped: number
      dropped: number
      eligibleLabelCandidateCount: number
      activeOutcome: 'ineligible' | 'drawn' | 'ramped' | 'dropped'
    }
  }
}

function createRetainedPlane(): HTMLCanvasElement {
  const plane = document.createElement('canvas')
  plane.setAttribute('data-board-overview-retained-layer', '')
  return plane
}

function overviewViewportTransform(canvas: HTMLCanvasElement): string {
  return canvas.closest('.react-flow')?.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? ''
}

function disposeResizeRetainedPlan(plan: ResizeRetainedPlan | null) {
  if (!plan) return
  for (const plane of [plan.cardPlane, plan.labelPlane, plan.activeLabelPlane, plan.anchorPlane]) {
    // Resetting backing stores releases the DPR-scaled pixel allocations. The
    // elements are detached, so there is no DOM removal step to defer.
    plane.width = 0
    plane.height = 0
  }
}

function canvasDatasetNumber(canvas: HTMLCanvasElement, key: keyof DOMStringMap): number {
  return Number(canvas.dataset[key] ?? 0)
}

function screenFrameIntersectsViewport(
  frame: { x: number; y: number; width: number; height: number },
  viewportSize: BoardViewportSize,
) {
  return (
    frame.x <= viewportSize.width &&
    frame.y <= viewportSize.height &&
    frame.x + frame.width >= 0 &&
    frame.y + frame.height >= 0
  )
}

export function BoardOverviewLayer({
  theme,
  renderIndex,
  viewport,
  viewportSize,
  marginPx,
  renderCards,
  renderConnections,
  suppressedConnectionIds = EMPTY_CONNECTION_IDS,
  selectedCardIds,
  marqueeSelectionState,
  hoveredCardId,
  hoveredConnectionId,
  reactCardIds,
  suppressedCardIds,
  measuredCardSizesById,
  readingCardOpacity,
  cardSummariesById,
  resizeHotGeometryStore = EMPTY_RESIZE_HOT_GEOMETRY_STORE,
}: BoardOverviewLayerProps) {
  const palette = useMemo(() => painterPaletteForTheme(theme), [theme])
  const paintIdentity = useMemo(() => painterPaletteIdentity(palette), [palette])
  const committedSelectedCardIdsRef = useRef(selectedCardIds)
  committedSelectedCardIdsRef.current = selectedCardIds
  const effectiveSelectedCardIds =
    marqueeSelectionState?.effectiveCardIds(selectedCardIds) ?? selectedCardIds
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scheduleDrawRef = useRef<(() => void) | null>(null)
  const schedulerRef = useRef<OverviewDrawScheduler | null>(null)
  if (schedulerRef.current === null) {
    schedulerRef.current = createOverviewDrawScheduler(() => scheduleDrawRef.current?.())
  }
  const scheduler = schedulerRef.current
  const labelFontRevisionRef = useRef<LabelFontRevisionTracker | null>(null)
  if (labelFontRevisionRef.current === null) {
    labelFontRevisionRef.current = createLabelFontRevisionTracker(() => scheduler.markDirty())
  }
  const labelFontRevision = labelFontRevisionRef.current
  // One label sort cache per layer instance: two mounted boards must not
  // alternate a single cache entry into re-sorting every frame.
  const labelSortCacheRef = useRef<LabelSortCache | null>(null)
  if (labelSortCacheRef.current === null) {
    labelSortCacheRef.current = createLabelSortCache()
  }
  const labelSortCache = labelSortCacheRef.current
  const latestRenderStateRef = useRef({
    renderIndex,
    viewport,
    viewportSize,
    marginPx,
    renderCards,
    renderConnections,
    suppressedConnectionIds,
    selectedCardIds: effectiveSelectedCardIds,
    hoveredCardId,
    hoveredConnectionId,
    reactCardIds,
    suppressedCardIds,
    measuredCardSizesById,
    readingCardOpacity,
    cardSummariesById,
    resizeHotGeometryStore,
    palette,
    paintIdentity,
  })

  useLayoutEffect(() => {
    latestRenderStateRef.current = {
      renderIndex,
      viewport,
      viewportSize,
      marginPx,
      renderCards,
      renderConnections,
      suppressedConnectionIds,
      selectedCardIds: effectiveSelectedCardIds,
      hoveredCardId,
      hoveredConnectionId,
      reactCardIds,
      suppressedCardIds,
      measuredCardSizesById,
      readingCardOpacity,
      cardSummariesById,
      resizeHotGeometryStore,
      palette,
      paintIdentity,
    }
    // Content changes only mark the layer dirty — the rAF loop below draws
    // once per frame no matter how many commits landed (#214). Only a
    // suppression or visual-DOM membership change draws pre-paint: the
    // underlay must change ownership in the exact paint where the React owner
    // above it mounts or unmounts, or the representation flashes
    // doubled/missing for a frame.
    scheduler.onPropsCommit(suppressedCardIds, paintIdentity, suppressedConnectionIds, reactCardIds)
  })

  useLayoutEffect(() => {
    if (!marqueeSelectionState) return
    return marqueeSelectionState.subscribeCards(() => {
      latestRenderStateRef.current.selectedCardIds =
        marqueeSelectionState.effectiveCardIds(committedSelectedCardIdsRef.current)
      scheduler.markDirty()
    })
  }, [marqueeSelectionState, scheduler])

  useEffect(() => {
    if (!document.fonts?.load) return
    let active = true
    void loadLabelFont(document.fonts)
      .then(() => {
        if (!active) return
        labelFontRevision.markReady()
      })
      .catch(() => {
        // A failed webfont request leaves the deterministic fallback stack in
        // place. No revision means no redundant cache churn.
      })
    return () => {
      active = false
    }
  }, [labelFontRevision])

  // Dirty-flagged drawing (#145): the layer redraws only when a relevant
  // input changed — React props (the effect above marks dirty), the React
  // Flow viewport transform (React Flow moves the DOM directly during
  // gestures, ahead of React state), or the pane size (ResizeObserver).
  // An idle board does zero canvas redraws and zero forced-layout reads per
  // frame — an idle frame is one inline-style string compare.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let scheduledFrame = 0
    let lastFrameKey = ''
    let disposed = false
    let drawCount = 0
    let activeResizePlan: ResizeRetainedPlan | null = null
    const observers: (() => void)[] = []

    const clearActiveResizePlan = () => {
      disposeResizeRetainedPlan(activeResizePlan)
      activeResizePlan = null
    }

    const resizeIdentityMatches = (plan: ResizeRetainedPlan) => {
      const latest = latestRenderStateRef.current
      const identity = plan.identity
      const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
      return (
        identity.renderIndex === latest.renderIndex &&
        identity.viewport.x === latest.viewport.x &&
        identity.viewport.y === latest.viewport.y &&
        identity.viewport.zoom === latest.viewport.zoom &&
        identity.viewportSize.width === latest.viewportSize.width &&
        identity.viewportSize.height === latest.viewportSize.height &&
        identity.transform === overviewViewportTransform(canvas) &&
        identity.ratio === ratio &&
        identity.marginPx === latest.marginPx &&
        identity.renderCards === latest.renderCards &&
        identity.renderConnections === latest.renderConnections &&
        identity.suppressedConnectionIds === latest.suppressedConnectionIds &&
        identity.selectedCardIds === latest.selectedCardIds &&
        identity.hoveredCardId === latest.hoveredCardId &&
        identity.reactCardIds === latest.reactCardIds &&
        identity.suppressedCardIds === latest.suppressedCardIds &&
        identity.measuredCardSizesById === latest.measuredCardSizesById &&
        identity.readingCardOpacity === latest.readingCardOpacity &&
        identity.cardSummariesById === latest.cardSummariesById &&
        identity.paintIdentity === latest.paintIdentity &&
        identity.fontRevision === labelFontRevision.current()
      )
    }

    const prepareResizePlan = (
      frame: BoardResizeHotFrame,
      snapshot: ViewportSnapshot,
      renderWindow: ReturnType<BoardRenderIndex['query']>,
    ): ResizeRetainedPlan | null => {
      const latest = latestRenderStateRef.current
      const card = latest.renderIndex.cardById(frame.cardId)
      if (!card) return null
      const hotCardById = resizeHotCardById(latest.renderIndex.cardById, frame)
      const hotMeasuredCardSizeById = resizeHotMeasuredCardSizeById(
        (cardId) => latest.measuredCardSizesById.get(cardId),
        frame,
      )
      const connections = planPaintedConnections({
        connections: renderWindow.connections,
        suppressedConnectionIds: latest.suppressedConnectionIds,
        cardById: hotCardById,
        measuredCardSizeById: hotMeasuredCardSizeById,
        viewport: snapshot.viewport,
        viewportSize: snapshot.viewportSize,
      })
      const incidentIndexes: number[] = []
      for (let index = 0; index < connections.length; index += 1) {
        const connection = connections[index].connection
        if (connection.from.cardId === frame.cardId || connection.to.cardId === frame.cardId) {
          incidentIndexes.push(index)
        }
      }

      const drawPlane = (
        plane: HTMLCanvasElement,
        options: {
          paintCards: boolean
          paintLabels: boolean
          paintAnchors: boolean
          excludedPaintCardId?: string | null
          labelPaintCandidate?: (candidate: LabelCandidate) => boolean
          trackedLabelCandidateId?: string
        },
      ) => {
        drawOverviewLayer({
          canvas: plane,
          renderIndex: latest.renderIndex,
          cards: renderWindow.cards,
          connections: [],
          connectionCandidateCount: 0,
          viewport: snapshot.viewport,
          viewportSize: snapshot.viewportSize,
          renderCards: latest.renderCards,
          selectedCardIds: latest.selectedCardIds,
          hoveredCardId: latest.hoveredCardId,
          reactCardIds: latest.reactCardIds,
          suppressedCardIds: latest.suppressedCardIds,
          measuredCardSizesById: latest.measuredCardSizesById,
          readingCardOpacity: latest.readingCardOpacity,
          cardSummariesById: latest.cardSummariesById,
          labelSortCache,
          palette: latest.palette,
          paintIdentity: latest.paintIdentity,
          fontRevision: labelFontRevision.current(),
          resizeHotFrame: frame,
          paintConnections: false,
          paintCards: options.paintCards,
          paintLabels: options.paintLabels,
          paintAnchors: options.paintAnchors,
          excludedPaintCardId: options.excludedPaintCardId,
          labelPaintCandidate: options.labelPaintCandidate,
          trackedLabelCandidateId: options.trackedLabelCandidateId,
          publishDiagnostics: false,
        })
      }

      const cardPlane = createRetainedPlane()
      const labelPlane = createRetainedPlane()
      const activeLabelPlane = createRetainedPlane()
      const anchorPlane = createRetainedPlane()
      drawPlane(cardPlane, {
        paintCards: true,
        paintLabels: false,
        paintAnchors: false,
        excludedPaintCardId: frame.cardId,
      })
      // Both label planes run the identical full declutter at cold begin.
      // Only their final paint partition differs, so every unrelated label
      // keeps its survivor/outcome and the active label can move without any
      // hot-frame sort, measure, cache, or collision walk. Its text/ellipsis
      // is deliberately frozen for the transient gesture; position follows
      // the active Card exactly.
      drawPlane(labelPlane, {
        paintCards: false,
        paintLabels: true,
        paintAnchors: false,
        labelPaintCandidate: (candidate) => candidate.id !== frame.cardId,
      })
      drawPlane(activeLabelPlane, {
        paintCards: false,
        paintLabels: true,
        paintAnchors: false,
        labelPaintCandidate: (candidate) => candidate.id === frame.cardId,
        trackedLabelCandidateId: frame.cardId,
      })
      drawPlane(anchorPlane, {
        paintCards: false,
        paintLabels: false,
        paintAnchors: true,
        excludedPaintCardId: frame.cardId,
      })

      const zoom = Number.isFinite(snapshot.viewport.zoom) ? Math.max(0.01, snapshot.viewport.zoom) : 1
      const preparedActiveFrame = {
        x: frame.geometry.position.x * zoom + snapshot.viewport.x,
        y: frame.geometry.position.y * zoom + snapshot.viewport.y,
        width: frame.geometry.size.width * zoom,
        height: frame.geometry.size.height * zoom,
      }
      const preparedActiveVisible = screenFrameIntersectsViewport(preparedActiveFrame, snapshot.viewportSize)
      const preparedActiveSuppressed = preparedActiveVisible && latest.suppressedCardIds.has(frame.cardId)
      const paintedCardIds = new Set<string>()
      if (latest.renderCards) {
        for (const indexedCard of renderWindow.cards) {
          if (indexedCard.id === frame.cardId) continue
          const candidate = cardWithResizeHotGeometry(indexedCard, frame)!
          const size = resolvedCardSize(candidate, hotMeasuredCardSizeById(candidate.id))
          const candidateFrame = {
            x: candidate.position.x * zoom + snapshot.viewport.x,
            y: candidate.position.y * zoom + snapshot.viewport.y,
            width: size.width * zoom,
            height: size.height * zoom,
          }
          if (
            screenFrameIntersectsViewport(candidateFrame, snapshot.viewportSize) &&
            !latest.suppressedCardIds.has(candidate.id)
          ) {
            paintedCardIds.add(candidate.id)
          }
        }
      }

      const activeLabelOutcome = activeLabelPlane.dataset.trackedLabelOutcome
      const trackedOutcome =
        activeLabelOutcome === 'drawn' ||
        activeLabelOutcome === 'ramped' ||
        activeLabelOutcome === 'dropped'
          ? activeLabelOutcome
          : 'ineligible'

      const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
      const plan: ResizeRetainedPlan = {
        cardId: frame.cardId,
        sessionId: frame.sessionId,
        card,
        connections,
        incidentIndexes,
        identity: {
          renderIndex: latest.renderIndex,
          viewport: snapshot.viewport,
          viewportSize: snapshot.viewportSize,
          transform: overviewViewportTransform(canvas),
          ratio,
          marginPx: latest.marginPx,
          renderCards: latest.renderCards,
          renderConnections: latest.renderConnections,
          suppressedConnectionIds: latest.suppressedConnectionIds,
          selectedCardIds: latest.selectedCardIds,
          hoveredCardId: latest.hoveredCardId,
          reactCardIds: latest.reactCardIds,
          suppressedCardIds: latest.suppressedCardIds,
          measuredCardSizesById: latest.measuredCardSizesById,
          readingCardOpacity: latest.readingCardOpacity,
          cardSummariesById: latest.cardSummariesById,
          paintIdentity: latest.paintIdentity,
          fontRevision: labelFontRevision.current(),
        },
        preparedPosition: frame.geometry.position,
        cardPlane,
        labelPlane,
        activeLabelPlane,
        anchorPlane,
        diagnostics: {
          connectionCandidateCount: renderWindow.connectionCandidateCount,
          connectionCapApplied: renderWindow.connectionCandidateCount > renderWindow.connections.length,
          omittedConnectionCount: Math.max(
            0,
            renderWindow.connectionCandidateCount - renderWindow.connections.length,
          ),
          coldRenderedCardCount: canvasDatasetNumber(cardPlane, 'renderedCardCount'),
          coldRepresentationCount: canvasDatasetNumber(cardPlane, 'representationCount'),
          coldSilhouetteCardCount: canvasDatasetNumber(cardPlane, 'silhouetteCardCount'),
          coldSuppressedReactCardCount: Math.max(
            0,
            canvasDatasetNumber(cardPlane, 'suppressedReactCardCount') - (preparedActiveSuppressed ? 1 : 0),
          ),
          coldResizeAnchorCount: canvasDatasetNumber(anchorPlane, 'resizeAnchorCount'),
          paintedCardIds,
          labels: {
            paintedLabelCount: canvasDatasetNumber(activeLabelPlane, 'paintedLabelCount'),
            cacheEntries: canvasDatasetNumber(activeLabelPlane, 'cacheEntries'),
            cacheBytes: canvasDatasetNumber(activeLabelPlane, 'cacheBytes'),
            drawn: canvasDatasetNumber(activeLabelPlane, 'drawn'),
            ramped: canvasDatasetNumber(activeLabelPlane, 'ramped'),
            dropped: canvasDatasetNumber(activeLabelPlane, 'dropped'),
            eligibleLabelCandidateCount: canvasDatasetNumber(
              activeLabelPlane,
              'eligibleLabelCandidateCount',
            ),
            activeOutcome: trackedOutcome,
          },
        },
      }
      latest.resizeHotGeometryStore.capturePaintedConnections(
        frame.cardId,
        frame.sessionId,
        connections,
      )
      canvas.dataset.resizeHotCardVisits = '0'
      canvas.dataset.resizeHotConnectionVisits = '0'
      canvas.dataset.resizeHotCapturedConnectionCount = String(connections.length)
      canvas.dataset.resizeHotIncidentConnectionCount = String(incidentIndexes.length)
      return plan
    }

    const drawResizeFrame = (plan: ResizeRetainedPlan, frame: BoardResizeHotFrame, countVisit: boolean) => {
      const latest = latestRenderStateRef.current
      const context = canvas.getContext('2d')
      if (!context) return
      const { viewport, viewportSize, ratio } = plan.identity
      const width = Math.max(1, Math.floor(viewportSize.width))
      const height = Math.max(1, Math.floor(viewportSize.height))
      const pixelWidth = Math.floor(width * ratio)
      const pixelHeight = Math.floor(height * ratio)
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      const zoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
      const hotX = frame.geometry.position.x * zoom + viewport.x
      const hotY = frame.geometry.position.y * zoom + viewport.y
      const hotWidth = frame.geometry.size.width * zoom
      const hotHeight = frame.geometry.size.height * zoom
      const activeVisible = screenFrameIntersectsViewport(
        { x: hotX, y: hotY, width: hotWidth, height: hotHeight },
        viewportSize,
      )
      const activeSuppressed = activeVisible && latest.suppressedCardIds.has(frame.cardId)
      const activePainted = latest.renderCards && activeVisible && !activeSuppressed
      // Stable captured objects are the shared paint/hit authority. Mutate
      // only the incident entries and leave them at current hot geometry so
      // asynchronous pane hit-testing sees exactly the endpoints painted.
      for (const index of plan.incidentIndexes) {
        const painted = plan.connections[index]
        if (painted.connection.from.cardId === frame.cardId) {
          painted.sourceX = hotX + hotWidth
          painted.sourceY = hotY + hotHeight / 2
        }
        if (painted.connection.to.cardId === frame.cardId) {
          painted.targetX = hotX
          painted.targetY = hotY + hotHeight / 2
        }
        painted.curve = Math.max(18, Math.min(140, Math.abs(painted.targetX - painted.sourceX) * 0.36))
      }

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, pixelWidth, pixelHeight)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const connectionSummary = drawOverviewConnections(context, plan.connections, {
        viewport,
        palette: latest.palette,
        hoveredConnectionId: latest.hoveredConnectionId,
      })
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.drawImage(plan.cardPlane, 0, 0)

      const framePaint = overviewFramePaintState(viewport.zoom, latest.readingCardOpacity)
      let hotAnchor: { x: number; y: number; width: number; height: number } | null = null
      let representationPaintCount = 0
      let activeSilhouette = false
      if (activePainted) {
        const card = {
          ...plan.card,
          position: frame.geometry.position,
          size: frame.geometry.size,
        }
        const cardPaint = overviewCardPaint(card, latest.palette)
        const readingMounted = latest.reactCardIds.has(card.id)
        const paintMode = cardBodyPaintMode(readingMounted, framePaint.readingOverviewFade)
        const silhouette = paintMode === 'silhouette'
        activeSilhouette = silhouette
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        if (silhouette) {
          drawOverviewCard(context, cardPaint, latest.palette, {
            x: hotX,
            y: hotY,
            width: hotWidth,
            height: hotHeight,
            zoom,
            selected: latest.selectedCardIds.has(card.id),
            hovered: latest.hoveredCardId === card.id,
            representation: framePaint.representation,
            opacity: framePaint.readingOverviewFade ? framePaint.overviewCardOpacity : 1,
            silhouette: true,
          })
          representationPaintCount = 1
        } else if (paintMode === 'opaque-safety') {
          // Text-weight overflow has no complementary DOM body. Keep its
          // Overview rendition fully opaque while passive/Live owners use
          // the ordinary inverse Reading fade.
          drawOverviewCard(context, cardPaint, latest.palette, {
            x: hotX,
            y: hotY,
            width: hotWidth,
            height: hotHeight,
            zoom,
            selected: latest.selectedCardIds.has(card.id),
            hovered: latest.hoveredCardId === card.id,
            representation: framePaint.representation,
            opacity: 1,
            silhouette: false,
          })
          representationPaintCount = 1
          if (latest.selectedCardIds.has(card.id)) {
            hotAnchor = { x: hotX, y: hotY, width: hotWidth, height: hotHeight }
          }
        } else {
          for (const paint of framePaint.shapePaints) {
            drawOverviewCard(context, cardPaint, latest.palette, {
              x: hotX,
              y: hotY,
              width: hotWidth,
              height: hotHeight,
              zoom,
              selected: latest.selectedCardIds.has(card.id),
              hovered: latest.hoveredCardId === card.id,
              representation: paint.representation,
              opacity: paint.opacity,
              silhouette: false,
            })
          }
          representationPaintCount = framePaint.shapePaints.length
          if (latest.selectedCardIds.has(card.id)) {
            hotAnchor = { x: hotX, y: hotY, width: hotWidth, height: hotHeight }
          }
        }
      }

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.drawImage(plan.labelPlane, 0, 0)
      const labelDeltaX = (frame.geometry.position.x - plan.preparedPosition.x) * zoom * ratio
      const labelDeltaY = (frame.geometry.position.y - plan.preparedPosition.y) * zoom * ratio
      context.drawImage(plan.activeLabelPlane, labelDeltaX, labelDeltaY)
      context.drawImage(plan.anchorPlane, 0, 0)
      if (hotAnchor) {
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        drawResizeAnchors(context, hotAnchor, latest.palette)
      }

      const diagnostics = plan.diagnostics
      const labels = diagnostics.labels
      const subtractActiveLabel = !activeVisible && labels.activeOutcome !== 'ineligible'
      const drawn = labels.drawn - (subtractActiveLabel && labels.activeOutcome === 'drawn' ? 1 : 0)
      const ramped = labels.ramped - (subtractActiveLabel && labels.activeOutcome === 'ramped' ? 1 : 0)
      const dropped = labels.dropped - (subtractActiveLabel && labels.activeOutcome === 'dropped' ? 1 : 0)
      const eligibleLabelCandidateCount =
        labels.eligibleLabelCandidateCount - (subtractActiveLabel ? 1 : 0)
      const renderedCardCount = diagnostics.coldRenderedCardCount + (activePainted ? 1 : 0)
      const representationCount =
        diagnostics.coldRepresentationCount + (activePainted && !activeSilhouette ? 1 : 0)
      const silhouetteCardCount =
        diagnostics.coldSilhouetteCardCount + (activePainted && activeSilhouette ? 1 : 0)
      if (activePainted) diagnostics.paintedCardIds.add(frame.cardId)
      else diagnostics.paintedCardIds.delete(frame.cardId)

      canvas.dataset.coversReactNodes = 'false'
      canvas.dataset.reactCardCount = String(latest.reactCardIds.size)
      canvas.dataset.hoveredConnectionId = latest.hoveredConnectionId ?? ''
      canvas.dataset.connectionCandidateCount = String(diagnostics.connectionCandidateCount)
      canvas.dataset.connectionCapApplied = String(diagnostics.connectionCapApplied)
      canvas.dataset.omittedConnectionCount = String(diagnostics.omittedConnectionCount)
      canvas.dataset.renderedCardCount = String(renderedCardCount)
      canvas.dataset.representation = framePaint.representation
      canvas.dataset.representationCount = String(representationCount)
      canvas.dataset.silhouetteCardCount = String(silhouetteCardCount)
      canvas.dataset.suppressedReactCardCount = String(
        diagnostics.coldSuppressedReactCardCount + (activeSuppressed ? 1 : 0),
      )
      canvas.dataset.resizeAnchorCount = String(
        diagnostics.coldResizeAnchorCount + (hotAnchor ? 4 : 0),
      )
      canvas.dataset.readingCardOpacity = String(framePaint.effectiveReadingOpacity)
      canvas.dataset.overviewCardOpacity = String(framePaint.overviewCardOpacity)
      canvas.dataset.paintedLabelCount = String(drawn + ramped)
      canvas.dataset.labelCacheMissesPerFrame = '0'
      canvas.dataset.cacheEntries = String(labels.cacheEntries)
      canvas.dataset.cacheBytes = String(labels.cacheBytes)
      canvas.dataset.drawn = String(drawn)
      canvas.dataset.ramped = String(ramped)
      canvas.dataset.dropped = String(dropped)
      canvas.dataset.eligibleLabelCandidateCount = String(eligibleLabelCandidateCount)
      window.__EIDO_OVERVIEW_CARD_IDS__ = diagnostics.paintedCardIds

      canvas.dataset.renderedConnectionCount = String(connectionSummary.connections)
      canvas.dataset.renderedConnectionBadgeCount = String(connectionSummary.badges)
      canvas.dataset.omittedConnectionBadgeCount = String(connectionSummary.omittedBadges)
      canvas.dataset.resizeHotRepresentationPaintCount = String(representationPaintCount)
      canvas.dataset.resizeHotSessionId = String(frame.sessionId)
      canvas.dataset.resizeHotWidth = String(frame.geometry.size.width)
      canvas.dataset.resizeHotHeight = String(frame.geometry.size.height)
      if (countVisit) {
        canvas.dataset.resizeHotCardVisits = String(Number(canvas.dataset.resizeHotCardVisits ?? 0) + 1)
        canvas.dataset.resizeHotConnectionVisits = String(
          Number(canvas.dataset.resizeHotConnectionVisits ?? 0) + plan.connections.length,
        )
      }
    }

    const drawCurrentViewport = (force = false, hotOverride?: BoardResizeHotFrame | null) => {
      const latest = latestRenderStateRef.current
      const snapshot = reactFlowViewportSnapshot(canvas, latest.viewport, latest.viewportSize)
      canvas.dataset.overviewLayoutReadCount = String(Number(canvas.dataset.overviewLayoutReadCount ?? 0) + 1)
      const frameKey = [
        snapshot.viewport.x.toFixed(2),
        snapshot.viewport.y.toFixed(2),
        snapshot.viewport.zoom.toFixed(4),
        snapshot.viewportSize.width.toFixed(1),
        snapshot.viewportSize.height.toFixed(1),
      ].join('|')

      if (scheduler.consumeDirty() || force || frameKey !== lastFrameKey) {
        lastFrameKey = frameKey
        const connectionLimit = connectionLimitForZoom(snapshot.viewport.zoom)
        const boundedReadingFallback = latest.renderConnections && latest.readingCardOpacity > 0
        const baseWindow = latest.renderIndex.query(
          snapshot.viewport,
          snapshot.viewportSize,
          latest.marginPx,
          {
            includeConnections: latest.renderConnections && !boundedReadingFallback,
            maxConnections: connectionLimit,
          },
        )
        // Reading normally needs no canvas wires. When a remote endpoint
        // leaves DOM residency, use the early-return prefix rather than the
        // diagnostic query that counts every incident connection.
        const boundedConnections = boundedReadingFallback
          ? latest.renderIndex.queryConnectionsBounded(
              snapshot.viewport,
              snapshot.viewportSize,
              latest.marginPx,
              connectionLimit,
            )
          : null
        const renderWindow = boundedConnections
          ? {
              ...baseWindow,
              connections: boundedConnections,
              connectionCandidateCount: boundedConnections.length,
            }
          : baseWindow
        const hotFrame = hotOverride === undefined
          ? latest.resizeHotGeometryStore.getSnapshot()
          : hotOverride
        if (hotFrame) {
          clearActiveResizePlan()
          activeResizePlan = prepareResizePlan(hotFrame, snapshot, renderWindow)
          if (activeResizePlan) drawResizeFrame(activeResizePlan, hotFrame, false)
        } else {
          clearActiveResizePlan()
          drawOverviewLayer({
            canvas,
            renderIndex: latest.renderIndex,
            cards: renderWindow.cards,
            connections: renderWindow.connections,
            connectionCandidateCount: renderWindow.connectionCandidateCount,
            viewport: snapshot.viewport,
            viewportSize: snapshot.viewportSize,
            renderCards: latest.renderCards,
            suppressedConnectionIds: latest.suppressedConnectionIds,
            selectedCardIds: latest.selectedCardIds,
            hoveredCardId: latest.hoveredCardId,
            hoveredConnectionId: latest.hoveredConnectionId,
            reactCardIds: latest.reactCardIds,
            suppressedCardIds: latest.suppressedCardIds,
            measuredCardSizesById: latest.measuredCardSizesById,
            readingCardOpacity: latest.readingCardOpacity,
            cardSummariesById: latest.cardSummariesById,
            labelSortCache,
            palette: latest.palette,
            paintIdentity: latest.paintIdentity,
            fontRevision: labelFontRevision.current(),
          })
        }
        drawCount += 1
        canvas.dataset.overviewDrawCount = String(drawCount)
      }
    }

    const scheduleDraw = () => {
      if (disposed) return
      drawCurrentViewport()
    }
    scheduleDrawRef.current = scheduleDraw

    const forceDrawCurrentViewport = () => drawCurrentViewport(true)
    window.__EIDO_FORCE_OVERVIEW_DRAW__ = forceDrawCurrentViewport

    // The loop keeps the per-frame cadence navigation needs (React Flow moves
    // the DOM transform directly during gestures, ahead of React state), but
    // an idle frame costs one inline-style string compare: no forced layout,
    // no snapshot, no redraw. The full snapshot + draw runs only when the
    // transform string actually changed or props marked the layer dirty.
    let viewportElement: HTMLElement | null = null
    let lastTransform = ''

    const loop = () => {
      if (disposed) return
      if (!viewportElement || !viewportElement.isConnected) {
        viewportElement = canvas.closest('.react-flow')?.querySelector('.react-flow__viewport') ?? null
      }
      const transform = viewportElement?.style.transform ?? ''
      if (scheduler.isDirty() || transform !== lastTransform) {
        lastTransform = transform
        drawCurrentViewport()
      }
      scheduledFrame = requestAnimationFrame(loop)
    }
    loop()

    // Pane resizes change the drawable area without touching the transform.
    const sizeObserver = new ResizeObserver(() => {
      scheduler.markDirty()
    })
    const root = canvas.closest('.react-flow')
    if (root) sizeObserver.observe(root)
    observers.push(() => sizeObserver.disconnect())

    const paintPublishedResizeFrame = () => {
      const frame = resizeHotGeometryStore.getSnapshot()
      if (!frame) {
        scheduler.markDirty()
        drawCurrentViewport(true, null)
        return
      }
      if (
        !activeResizePlan ||
        activeResizePlan.cardId !== frame.cardId ||
        activeResizePlan.sessionId !== frame.sessionId ||
        !resizeIdentityMatches(activeResizePlan)
      ) {
        scheduler.markDirty()
        drawCurrentViewport(true, frame)
        return
      }
      drawResizeFrame(activeResizePlan, frame, true)
    }
    observers.push(
      resizeHotGeometryStore.subscribeBegin((frame) => {
        // Explicit begin preparation closes the first-preview ghost window:
        // the retained planes and captured connection order exist before a
        // coalesced pointer frame can publish.
        scheduler.markDirty()
        drawCurrentViewport(true, frame)
      }),
      resizeHotGeometryStore.subscribe(paintPublishedResizeFrame),
      resizeHotGeometryStore.subscribeTerminal((frame) => {
        // A stationary superseding gesture can restore a terminal without a
        // visual publish. Rebase only when that identity is not already live.
        if (
          activeResizePlan?.cardId === frame.cardId &&
          activeResizePlan.sessionId === frame.sessionId
        ) return
        scheduler.markDirty()
        drawCurrentViewport(true, frame)
      }),
    )

    return () => {
      disposed = true
      if (window.__EIDO_FORCE_OVERVIEW_DRAW__ === forceDrawCurrentViewport) delete window.__EIDO_FORCE_OVERVIEW_DRAW__
      delete window.__EIDO_OVERVIEW_CARD_IDS__
      if (scheduledFrame) cancelAnimationFrame(scheduledFrame)
      for (const disconnect of observers) disconnect()
      clearActiveResizePlan()
      scheduleDrawRef.current = null
    }
    // `scheduler` is ref-initialized once, so this still runs only on mount.
  }, [labelFontRevision, resizeHotGeometryStore, scheduler])

  return <canvas ref={canvasRef} className="board-overview-layer" data-board-overview-layer aria-hidden="true" />
}

/**
 * Dataset counter contract (frozen by #309 — Lane E's band-uniformity gate
 * (E2, #315) references these names, never this diff):
 *
 * - `data-representation`: the ONE painted representation this frame's band
 *   selected — `overview` or `map`. Every non-silhouette card in the frame
 *   is drawn with exactly this representation ("one look per zoom").
 * - `data-representation-count` (`dataset.representationCount`): cards drawn
 *   in that representation. Derived from `drawOverviewCard`'s return value —
 *   the geometry actually drawn — never recounted in the loop.
 * - `dataset.silhouetteCardCount`: mounted-card motion silhouettes drawn.
 *   `renderedCardCount === representationCount + silhouetteCardCount`;
 *   at a settled viewport silhouettes are 0.
 * - `dataset.connectionCandidateCount` / `dataset.renderedConnectionCount`:
 *   the TRUE (untruncated) count of unique window-touching connection
 *   candidates from the render index, and the lines actually painted.
 * - `dataset.connectionCapApplied` / `dataset.omittedConnectionCount`:
 *   whether the density cap truncated the candidate set, and exactly how
 *   many candidates it removed (`candidateCount - truncated length`). The
 *   cap value itself is a parked human decision (H2, E1's artifact); these
 *   surface the planned omission. A candidate set that merely EQUALS the
 *   cap reports no omission.
 * - `dataset.omittedConnectionBadgeCount`: badge-eligible painted connections
 *   past the badge density limit — a planned omission with a counter.
 *
 * Label counters (frozen by #310 — Lane E's label-text-cliff gate (E4, #317)
 * references these names; the full contract prose, budget arithmetic, and
 * 9.0 µs provenance live in `labelLayer.ts`):
 *
 * - `dataset.paintedLabelCount`
 * - `dataset.labelCacheMissesPerFrame`
 * - `dataset.cacheEntries`
 * - `dataset.cacheBytes`
 *
 * Declutter counters (frozen by #311 — E4's accounting identity
 * `drawn + dropped + ramped == eligibleLabelCandidateCount` reads all four;
 * contract prose in `labelLayer.ts`):
 *
 * - `dataset.drawn`
 * - `dataset.ramped`
 * - `dataset.dropped`
 * - `dataset.eligibleLabelCandidateCount`
 */
function* cardsInPaintPlaneOrder(cards: readonly Card[]): Generator<Card> {
  // Groups are background regions. Paint every Group (including its fill)
  // before ordinary Cards so a coloured region can never cover a member
  // Card's connector nodes merely because it appears later in saved order.
  for (const card of cards) {
    if (card.kind === 'group') yield card
  }
  for (const card of cards) {
    if (card.kind !== 'group') yield card
  }
}

export function drawOverviewLayer({
  canvas,
  renderIndex,
  cards,
  connections,
  connectionCandidateCount,
  viewport,
  viewportSize,
  renderCards,
  suppressedConnectionIds = EMPTY_CONNECTION_IDS,
  selectedCardIds,
  hoveredCardId,
  hoveredConnectionId,
  reactCardIds,
  suppressedCardIds,
  measuredCardSizesById,
  readingCardOpacity = 0,
  cardSummariesById = EMPTY_CARD_SUMMARIES,
  labelSortCache,
  palette,
  paintIdentity = painterPaletteIdentity(palette),
  fontRevision = 0,
  resizeHotFrame = null,
  paintConnections = true,
  paintCards = true,
  paintLabels = true,
  paintAnchors = true,
  excludedPaintCardId = null,
  labelPaintCandidate,
  trackedLabelCandidateId,
  publishDiagnostics = true,
}: {
  canvas: HTMLCanvasElement
  renderIndex: BoardRenderIndex
  cards: Card[]
  connections: Connection[]
  connectionCandidateCount: number
  viewport: BoardViewport
  viewportSize: BoardViewportSize
  renderCards: boolean
  suppressedConnectionIds?: ReadonlySet<string>
  selectedCardIds: ReadonlySet<string>
  hoveredCardId?: string | null
  hoveredConnectionId?: string | null
  reactCardIds: ReadonlySet<string>
  suppressedCardIds: ReadonlySet<string>
  measuredCardSizesById: ReadonlyMap<string, RenderedCardSize>
  readingCardOpacity?: number
  // Optional so pre-#310 callers/tests draw a labelless frame unchanged.
  cardSummariesById?: ReadonlyMap<string, CanvasCardSummary>
  // Optional per-layer sort cache (#311); absent, drawLabels sorts fresh.
  labelSortCache?: LabelSortCache
  palette: PainterPalette
  paintIdentity?: string
  fontRevision?: number
  resizeHotFrame?: BoardResizeHotFrame | null
  paintConnections?: boolean
  paintCards?: boolean
  paintLabels?: boolean
  paintAnchors?: boolean
  excludedPaintCardId?: string | null
  labelPaintCandidate?: (candidate: LabelCandidate) => boolean
  trackedLabelCandidateId?: string
  publishDiagnostics?: boolean
}) {
  const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
  const width = Math.max(1, Math.floor(viewportSize.width))
  const height = Math.max(1, Math.floor(viewportSize.height))
  const pixelWidth = Math.floor(width * ratio)
  const pixelHeight = Math.floor(height * ratio)
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  canvas.dataset.coversReactNodes = 'false'
  canvas.dataset.safetyPreviewLineCount = '0'
  if (publishDiagnostics) window.__EIDO_OVERVIEW_CARD_IDS__ = new Set()
  if (publishDiagnostics && import.meta.env.DEV) {
    if (resizeHotFrame) {
      canvas.dataset.resizeHotSessionId = String(resizeHotFrame.sessionId)
      canvas.dataset.resizeHotWidth = String(resizeHotFrame.geometry.size.width)
      canvas.dataset.resizeHotHeight = String(resizeHotFrame.geometry.size.height)
    } else {
      delete canvas.dataset.resizeHotSessionId
      delete canvas.dataset.resizeHotWidth
      delete canvas.dataset.resizeHotHeight
    }
  }

  const context = canvas.getContext('2d')
  if (!context) return
  const hotCardById = resizeHotCardById(renderIndex.cardById, resizeHotFrame)
  const hotMeasuredCardSizeById = resizeHotMeasuredCardSizeById(
    (cardId) => measuredCardSizesById.get(cardId),
    resizeHotFrame,
  )

  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  canvas.dataset.reactCardCount = String(reactCardIds.size)
  canvas.dataset.resizeAnchorCount = '0'
  canvas.dataset.hoveredConnectionId = hoveredConnectionId ?? ''

  // ONE band per frame, pure in zoom — the label layer's eligibility and the
  // card representation both key off this same value, never a second rule.
  const framePaint = overviewFramePaintState(viewport.zoom, readingCardOpacity)
  const {
    band,
    representation,
    effectiveReadingOpacity,
    overviewCardOpacity,
    readingOverviewFade,
    shapePaints,
  } = framePaint
  const fade = bandCrossfade(viewport.zoom, PAINT_BAND_THRESHOLDS)
  const overviewMapFade = fade?.from === 'map' && fade.to === 'overview' ? fade : null
  // Overview-only labels enter for the whole Map↔Overview window and fade
  // with the same zoom-pure t. Map landmarks and tier-0 overrides remain
  // fully opaque because they exist on both sides of the crossing.
  const labelBand = overviewMapFade || readingOverviewFade ? 'overview' : band
  const ordinaryLabelAlpha = overviewMapFade?.t ?? (readingOverviewFade ? overviewCardOpacity : 1)

  // The shared plan (not a local filter) decides which lines exist: the
  // pane-click hit test consumes the same planner, so a connection is
  // clickable exactly when it is painted (#211).
  const paintedConnections = paintConnections
    ? planPaintedConnections({
        connections,
        suppressedConnectionIds,
        cardById: hotCardById,
        measuredCardSizeById: hotMeasuredCardSizeById,
        viewport,
        viewportSize,
      })
    : []
  let renderedConnections: ConnectionRenderSummary | null = null
  const drawConnections = () => {
    if (renderedConnections) return
    renderedConnections = drawOverviewConnections(context, paintedConnections, {
      viewport,
      palette,
      hoveredConnectionId,
    })
    canvas.dataset.renderedConnectionCount = String(renderedConnections.connections)
    canvas.dataset.renderedConnectionBadgeCount = String(renderedConnections.badges)
    canvas.dataset.omittedConnectionBadgeCount = String(renderedConnections.omittedBadges)
  }
  canvas.dataset.connectionCandidateCount = String(connectionCandidateCount)
  canvas.dataset.connectionCapApplied = String(connectionCandidateCount > connections.length)
  canvas.dataset.omittedConnectionCount = String(Math.max(0, connectionCandidateCount - connections.length))
  canvas.dataset.representation = representation
  canvas.dataset.readingCardOpacity = String(effectiveReadingOpacity)
  canvas.dataset.overviewCardOpacity = String(overviewCardOpacity)

  const renderedOverviewCardIds = new Set<string>()
  if (!renderCards) {
    drawConnections()
    canvas.dataset.renderedCardCount = '0'
    canvas.dataset.representationCount = '0'
    canvas.dataset.silhouetteCardCount = '0'
    canvas.dataset.suppressedReactCardCount = String(suppressedCardIds.size)
    writeLabelCounters(
      canvas,
      drawLabels({
        context,
        band,
        candidates: [],
        viewportSize: { width, height },
        devicePixelRatio: ratio,
        palette,
        paintIdentity,
        fontRevision,
        trackedCandidateId: trackedLabelCandidateId,
      }),
    )
    if (publishDiagnostics) window.__EIDO_OVERVIEW_CARD_IDS__ = renderedOverviewCardIds
    return
  }

  let renderedCount = 0
  let representationCount = 0
  let silhouetteCount = 0
  let safetyPreviewLineCount = 0
  const safetyPreviewLineBudget = paintedLabelFrameCap(viewportSize)
  let suppressedReactCardCount = 0
  const resizeAnchorFrames: Array<{ x: number; y: number; width: number; height: number }> = []
  const labelCandidates: LabelCandidate[] = []
  const zoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
  for (const indexedCard of cardsInPaintPlaneOrder(cards)) {
    // Groups are background regions. Their wash must land before wires, while
    // ordinary Cards and connector nodes must land after wires, in every LOD.
    if (indexedCard.kind !== 'group') drawConnections()
    const card = cardWithResizeHotGeometry(indexedCard, resizeHotFrame)!
    const cardPaint = overviewCardPaint(card, palette)
    // A measurement captured in Reading remains the card's exact footprint
    // after the DOM node unmounts in Overview/Map. Falling back to the
    // planning estimate here made every auto-height card collapse to 180px
    // on zoom-out. The render index still supplies the bounded candidate
    // window; final culling and every painted geometry use the same resolved
    // size so a tall card cannot be clipped at the viewport edge.
    const size = resolvedCardSize(card, hotMeasuredCardSizeById(card.id))
    const x = card.position.x * zoom + viewport.x
    const y = card.position.y * zoom + viewport.y
    const cardWidth = size.width * zoom
    const cardHeight = size.height * zoom
    if (x > width || y > height || x + size.width * zoom < 0 || y + size.height * zoom < 0) continue
    if (suppressedCardIds.has(card.id)) {
      suppressedReactCardCount += 1
      continue
    }
    const paintCard = paintCards && card.id !== excludedPaintCardId
    if (paintCard) {
      renderedCount += 1
      renderedOverviewCardIds.add(card.id)
    }
    const readingMounted = reactCardIds.has(card.id)
    const paintMode = cardBodyPaintMode(readingMounted, readingOverviewFade)
    const silhouette = paintMode === 'silhouette'
    if (card.kind === 'title') {
      // A Title card has no low-detail stand-in. Its painted form is the same
      // text at the same size as the DOM label, so there is no card body to
      // fill, no port to draw, and nothing at all to paint under a mounted
      // one: a silhouette fill would put paper behind transparent type.
      if (paintCard && !silhouette) {
        drawPaintedTitleCard(context, cardPaint, palette, {
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          zoom,
          selected: selectedCardIds.has(card.id),
          hovered: hoveredCardId === card.id,
          opacity: readingOverviewFade ? overviewCardOpacity : 1,
          // The painted label is the card's whole text, not the summary's
          // one-line provenance label: this representation is the label.
          text: cardText(card),
          agentUnadopted: isAgentUnadoptedCard(card),
        })
        representationCount += 1
      }
    } else if (paintCard && silhouette) {
      // Reading silhouettes keep their single invariant representation; the
      // only implemented shape double-paint is the canvas↔canvas Map crossing.
      drawOverviewCard(context, cardPaint, palette, {
        x,
        y,
        width: cardWidth,
        height: cardHeight,
        zoom,
        selected: selectedCardIds.has(card.id),
        hovered: hoveredCardId === card.id,
        representation,
        opacity: readingOverviewFade ? overviewCardOpacity : 1,
        silhouette: true,
      })
      silhouetteCount += 1
    } else if (paintCard && paintMode === 'opaque-safety') {
      // S has no DOM complement: unlike mounted P/O/L, it must never fade
      // toward a blank Reading endpoint.
      drawOverviewCard(context, cardPaint, palette, {
        x,
        y,
        width: cardWidth,
        height: cardHeight,
        zoom,
        selected: selectedCardIds.has(card.id),
        hovered: hoveredCardId === card.id,
        representation,
        opacity: 1,
        silhouette: false,
      })
      representationCount += 1
    } else if (paintCard) {
      for (const paint of shapePaints) {
        drawOverviewCard(context, cardPaint, palette, {
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          zoom,
          selected: selectedCardIds.has(card.id),
          hovered: hoveredCardId === card.id,
          representation: paint.representation,
          opacity: paint.opacity,
          silhouette: false,
        })
      }
      representationCount += 1
    }
    const summary = cardSummariesById.get(card.id)
    if (
      paintCard &&
      band === 'reading' &&
      effectiveReadingOpacity > 0 &&
      !readingMounted &&
      card.kind !== 'title' &&
      card.kind !== 'group' &&
      summary
    ) {
      safetyPreviewLineCount += paintSafetyCardPreview(
        context,
        summary.preview,
        palette,
        {
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          zoom,
        },
        safetyPreviewLineBudget - safetyPreviewLineCount,
      )
    }
    if (
      paintAnchors &&
      !silhouette &&
      card.id !== excludedPaintCardId &&
      selectedCardIds.has(card.id)
    ) {
      resizeAnchorFrames.push({ x, y, width: cardWidth, height: cardHeight })
    }
    // Label candidates are painted representations plus Reading silhouettes.
    // The latter deliberately reach labelLayer with `mountedInReading` so
    // Reading suppression is tested and owned at the label seam instead of
    // being an accidental consequence of the shape painter's early return.
    // Below Reading, silhouettes remain labelless as before.
    // A Title card paints its own text in board space, so it never enters the
    // screen-space label layer: that would double-draw its name at a size the
    // founder did not choose.
    if (paintLabels && summary && card.kind !== 'title' && (!silhouette || band === 'reading')) {
      labelCandidates.push({
        id: card.id,
        text: summary.label,
        displayPriority: summary.displayPriority,
        hovered: hoveredCardId === card.id,
        selected: selectedCardIds.has(card.id),
        mountedInReading: band === 'reading' && readingMounted,
        ordinaryAlpha: readingOverviewFade && !readingMounted ? 1 : undefined,
        pinToRegion: card.kind === 'group',
        color: cardPaint.label,
        x,
        y,
        width: cardWidth,
        height: cardHeight,
      })
    }
  }
  // An all-Group or empty paint window still needs its connection plane.
  drawConnections()
  canvas.dataset.renderedCardCount = String(renderedCount)
  canvas.dataset.representationCount = String(representationCount)
  canvas.dataset.silhouetteCardCount = String(silhouetteCount)
  canvas.dataset.safetyPreviewLineCount = String(safetyPreviewLineCount)
  canvas.dataset.suppressedReactCardCount = String(suppressedReactCardCount)
  // Labels paint LAST — screen-space text sits above shapes and connections.
  // Sort-cache key (#311, amendment 16): the `cards` PARAM here is the
  // render window's culled list, rebuilt fresh every query — keying on it
  // would re-sort every pan frame. Instead the key is O(1) signals that
  // jointly cover every rank input: the index's position-blind rankEpoch
  // (membership + size + kind, gathered during visits the index already
  // performs — a drag commit moves the index but not the epoch) and the
  // value-keyed summaries map identity (displayPriority, which the index
  // cannot see). The label layer itself never scans the board; sortEntries
  // runs only on an actual rebuild, and traverses via forEach so not even a
  // [key, value] pair is materialized per card.
  writeLabelCounters(
    canvas,
    drawLabels({
      context,
      band: labelBand,
      candidates: labelCandidates,
      ordinaryLabelAlpha,
      viewportSize: { width, height },
      devicePixelRatio: ratio,
      palette,
      paintIdentity,
      fontRevision,
      sortCache: labelSortCache,
      sortKey: {
        rankInputsEpoch: renderIndex.rankEpoch(),
        summariesIdentity: cardSummariesById,
        hoveredCardId: hoveredCardId ?? null,
        selectedCardIds,
      },
      sortEntries: (visit) => {
        cardSummariesById.forEach((summary, id) => {
          const card = renderIndex.cardById(id)
          if (card) visit(id, summary.displayPriority, labelSortAreaOf(card))
        })
      },
      paintCandidate: labelPaintCandidate,
      trackedCandidateId: trackedLabelCandidateId,
    }),
  )
  // Visible low-detail resize grabbers share the canvas card's exact frame
  // and paint pass. The React Flow controls above the canvas are transparent
  // hit targets only, so the grabbers can never visually outrun the card.
  if (paintAnchors) {
    for (const frame of resizeAnchorFrames) drawResizeAnchors(context, frame, palette)
  }
  canvas.dataset.resizeAnchorCount = String(resizeAnchorFrames.length * 4)
  if (publishDiagnostics) window.__EIDO_OVERVIEW_CARD_IDS__ = renderedOverviewCardIds
}

const EMPTY_CARD_SUMMARIES: ReadonlyMap<string, CanvasCardSummary> = new Map()

// Scalar world-space card area for the label sort. Rank rebuilds visit
// every card and must not allocate per entry, so this avoids
// renderedCardSize's per-call {width,height} object: explicit sizes multiply
// directly, and each kind's default area is derived from renderedCardSize
// ONCE and memoised — no duplicated size rules, no per-entry allocation.
const defaultCardAreaByKind = new Map<Card['kind'], number>()

export function labelSortAreaOf(card: Card): number {
  if (card.size) return card.size.width * card.size.height
  let area = defaultCardAreaByKind.get(card.kind)
  if (area === undefined) {
    const size = renderedCardSize(card)
    area = size.width * size.height
    defaultCardAreaByKind.set(card.kind, area)
  }
  return area
}

function writeLabelCounters(canvas: HTMLCanvasElement, counters: ReturnType<typeof drawLabels>) {
  canvas.dataset.paintedLabelCount = String(counters.paintedLabelCount)
  canvas.dataset.labelCacheMissesPerFrame = String(counters.labelCacheMissesPerFrame)
  canvas.dataset.cacheEntries = String(counters.cacheEntries)
  canvas.dataset.cacheBytes = String(counters.cacheBytes)
  canvas.dataset.drawn = String(counters.drawn)
  canvas.dataset.ramped = String(counters.ramped)
  canvas.dataset.dropped = String(counters.dropped)
  canvas.dataset.eligibleLabelCandidateCount = String(counters.eligibleLabelCandidateCount)
  if (counters.trackedCandidateOutcome) {
    canvas.dataset.trackedLabelOutcome = counters.trackedCandidateOutcome
  } else {
    delete canvas.dataset.trackedLabelOutcome
  }
}

function reactFlowViewportSnapshot(
  canvas: HTMLCanvasElement,
  fallbackViewport: BoardViewport,
  fallbackViewportSize: BoardViewportSize,
): ViewportSnapshot {
  const root = canvas.closest('.react-flow')
  const viewportElement = root?.querySelector('.react-flow__viewport')
  if (!root || !viewportElement) {
    return { viewport: fallbackViewport, viewportSize: fallbackViewportSize }
  }

  const rect = root.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return { viewport: fallbackViewport, viewportSize: fallbackViewportSize }
  }

  const transform = getComputedStyle(viewportElement).transform
  const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
  return {
    viewport: {
      x: matrix?.e ?? 0,
      y: matrix?.f ?? 0,
      zoom: matrix?.a ?? 1,
    },
    viewportSize: {
      width: rect.width,
      height: rect.height,
    },
  }
}

function drawOverviewConnections(
  context: CanvasRenderingContext2D,
  paintedConnections: readonly PaintedConnection[],
  {
    viewport,
    palette,
    hoveredConnectionId,
  }: {
    viewport: BoardViewport
    palette: PainterPalette
    hoveredConnectionId?: string | null
  },
): ConnectionRenderSummary {
  const zoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
  let renderedCount = 0
  let renderedBadges = 0
  let omittedBadges = 0

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (const painted of paintedConnections) {
    const { connection, sourceX, sourceY, targetX, targetY, curve } = painted
    renderedCount += 1
    const appearance = connectionAppearance({
      ...connection,
      hovered: connection.id === hoveredConnectionId,
    })
    const color = palette.connections[appearance.colorRole]

    context.globalAlpha = appearance.opacity
    context.strokeStyle = color
    // Canvas coordinates are already in screen pixels, unlike React Flow's
    // scaled SVG. Below Reading, use the shared Light weight so direct wires
    // do not visually outweigh low-detail card silhouettes.
    context.lineWidth =
      zoom < READING_BAND_MIN_ZOOM
        ? Math.min(appearance.strokeWidth, CONNECTION_LIGHT_STROKE_WIDTH)
        : appearance.strokeWidth
    context.setLineDash([...appearance.dash])
    context.beginPath()
    context.moveTo(sourceX, sourceY)
    context.bezierCurveTo(sourceX + curve, sourceY, targetX - curve, targetY, targetX, targetY)
    context.stroke()

    // The tip is authored at the exact target connector centre. Its body is
    // then covered by the connector's hollow DOM/canvas ring, which leaves a
    // compact green arrow visibly touching the outer ink with no marker-box
    // gap. Scale follows the same zoom curve as the connector itself.
    const arrow = connectionArrowGeometry(zoom * handleScaleForZoom(zoom))
    context.setLineDash([])
    context.fillStyle = color
    context.beginPath()
    context.moveTo(targetX, targetY)
    context.lineTo(targetX - arrow.length, targetY - arrow.halfHeight)
    context.lineTo(targetX - arrow.length, targetY + arrow.halfHeight)
    context.fill()

    if (zoom >= CONNECTION_BADGE_MIN_ZOOM) {
      // The SHARED suppression predicate (#322): badges paint in plan order,
      // so `renderedBadges` is this connection's badge ordinal — the same
      // index the pane-click badge hit-test evaluates. Paint and hit agree on
      // membership by construction.
      if (connectionBadgePaintedAtIndex(renderedBadges, zoom)) {
        // The badge DISC (centre + radius) comes from CH2's single geometry
        // owner, so any future badge hit-test paints and hits the same disc.
        const badge = paintedConnectionBadgeGeometry(painted, zoom, {
          expanded: connection.id === hoveredConnectionId,
        })
        context.setLineDash([])
        context.globalAlpha = CONNECTION_BADGE_ALPHA
        context.fillStyle = palette.badge.fill
        context.strokeStyle = palette.badge.stroke
        context.lineWidth = 1
        context.beginPath()
        context.arc(badge.center.x, badge.center.y, badge.radius, 0, Math.PI * 2)
        context.fill()
        context.stroke()
        renderedBadges += 1
      } else {
        omittedBadges += 1
      }
    }
  }

  context.restore()
  return { connections: renderedCount, badges: renderedBadges, omittedBadges }
}

function drawOverviewCard(
  context: CanvasRenderingContext2D,
  cardPaint: OverviewCardPaint,
  palette: PainterPalette,
  frame: {
    x: number
    y: number
    width: number
    height: number
    zoom: number
    selected: boolean
    hovered: boolean
    representation: PaintedRepresentation
    opacity: number
    silhouette: boolean
  },
): 'silhouette' | PaintedRepresentation {
  const radius = Math.min(8, Math.max(2, frame.height / 3))

  context.save()
  // The only opacity below 1 is the zoom-pure Map↔Overview crossfade. Visual
  // decay remains removed (ADR 0021): opacity never varies per card or time.
  context.globalAlpha = frame.opacity

  if (frame.silhouette) {
    // Mounted P/O/L Cards own every pixel of their normal/selected boundary.
    // The painter supplies fill continuity during motion only, using the
    // DOM Card's board-space 8px radius transformed into screen coordinates.
    // Native roundRect matches CSS circular border-radius geometry; the
    // painter-owned Map/Overview path below remains intentionally unchanged.
    cssRoundedRect(
      context,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      CARD_SHELL_METRICS.radius * frame.zoom,
    )
    context.fillStyle = frame.selected
      ? cardPaint.selectedSilhouetteFill ?? cardPaint.silhouetteFill ?? cardPaint.fill
      : cardPaint.silhouetteFill ?? cardPaint.fill
    context.fill()
    context.restore()
    return 'silhouette'
  }

  roundedRect(context, frame.x, frame.y, frame.width, frame.height, radius)
  context.fillStyle = cardPaint.fill
  context.fill()
  context.lineWidth = Math.max(1, Math.min(1.4, frame.zoom * 1.2))
  context.strokeStyle = frame.selected ? palette.selection : cardPaint.stroke
  context.setLineDash(cardPaint.dashed ? [4, 4] : [])
  context.stroke()
  context.setLineDash([])

  // Port discs from the single geometry owner — the pointer layer hit-tests
  // exactly this outer value, so hit == paint with nothing to sync. The ink
  // ring is drawn inward to keep the complete painted node inside that 13px
  // boundary. Every painted representation gets the same prototype node,
  // Map and Overview alike; the card changes LOD while this chrome stays stable.
  const ports = paintedPortGeometry(frame)
  if (ports.radius > 0) {
    context.fillStyle = palette.port.fill
    context.strokeStyle = palette.port.stroke
    context.lineWidth = CONNECTOR_NODE_METRICS.stroke
    drawPort(context, ports.left.x, ports.left.y, ports.radius)
    drawPort(context, ports.right.x, ports.right.y, ports.radius)
  }

  // Selection already replaced the Card's own boundary ink above. Hover keeps
  // its quiet outer affordance only while selection does not outrank it.
  if (frame.hovered && !frame.selected) {
    roundedRect(
      context,
      frame.x - RING_OFFSET_PX,
      frame.y - RING_OFFSET_PX,
      frame.width + RING_OFFSET_PX * 2,
      frame.height + RING_OFFSET_PX * 2,
      radius + RING_OFFSET_PX,
    )
    context.strokeStyle = withAlpha(palette.hover, 0.35)
    context.lineWidth = RING_WIDTH_PX
    context.stroke()
  }

  context.restore()
  return frame.representation
}

/**
 * The Title card's painted representation: type, and only the chrome the DOM
 * card itself shows. No paper, no border at rest, no ports. The agent-unadopted
 * dashed accent and the painted selection/hover ring survive because both are
 * states the mounted card shows too.
 */
function drawPaintedTitleCard(
  context: CanvasRenderingContext2D,
  cardPaint: OverviewCardPaint,
  palette: PainterPalette,
  frame: {
    x: number
    y: number
    width: number
    height: number
    zoom: number
    selected: boolean
    hovered: boolean
    opacity: number
    text: string
    agentUnadopted: boolean
  },
): void {
  const radius = Math.min(8, Math.max(2, frame.height / 3))
  context.save()
  context.globalAlpha = frame.opacity

  if (frame.agentUnadopted || frame.selected) {
    roundedRect(context, frame.x, frame.y, frame.width, frame.height, radius)
    context.lineWidth = Math.max(1, Math.min(1.4, frame.zoom * 1.2))
    context.strokeStyle = frame.selected ? palette.selection : cardPaint.stroke
    context.setLineDash(frame.selected ? [] : [4, 4])
    context.stroke()
    context.setLineDash([])
  }

  paintTitleCardText(context, {
    text: frame.text,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    zoom: frame.zoom,
    color: cardPaint.label,
  })

  if (frame.hovered && !frame.selected) {
    roundedRect(
      context,
      frame.x - RING_OFFSET_PX,
      frame.y - RING_OFFSET_PX,
      frame.width + RING_OFFSET_PX * 2,
      frame.height + RING_OFFSET_PX * 2,
      radius + RING_OFFSET_PX,
    )
    context.strokeStyle = withAlpha(palette.hover, 0.35)
    context.lineWidth = RING_WIDTH_PX
    context.stroke()
  }

  context.restore()
}

function drawResizeAnchors(
  context: CanvasRenderingContext2D,
  frame: { x: number; y: number; width: number; height: number },
  palette: PainterPalette,
) {
  const { size, radius } = CARD_RESIZE_HANDLE_GEOMETRY
  const corners = [
    [frame.x, frame.y],
    [frame.x + frame.width, frame.y],
    [frame.x, frame.y + frame.height],
    [frame.x + frame.width, frame.y + frame.height],
  ] as const

  context.save()
  context.globalAlpha = 1
  context.fillStyle = palette.selection
  for (const [x, y] of corners) {
    roundedRect(
      context,
      x - radius,
      y - radius,
      size,
      size,
      radius,
    )
    context.fill()
  }
  context.restore()
}

function drawPort(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  const innerRadius = Math.max(0, radius - context.lineWidth)
  context.save()
  const groundFill = context.fillStyle
  context.fillStyle = context.strokeStyle
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
  if (innerRadius > 0) {
    context.fillStyle = groundFill
    context.beginPath()
    context.arc(x, y, innerRadius, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2))
  context.beginPath()
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  context.lineTo(x + width, y + height - safeRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  context.lineTo(x + safeRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  context.lineTo(x, y + safeRadius)
  context.quadraticCurveTo(x, y, x + safeRadius, y)
}

function cssRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2))
  context.beginPath()
  context.roundRect(x, y, width, height, safeRadius)
}

type OverviewCardPaint = {
  fill: string
  stroke: string
  label: string
  dashed: boolean
  silhouetteFill?: string
  selectedSilhouetteFill?: string
}

function overviewCardPaint(card: Card, palette: PainterPalette): OverviewCardPaint {
  const agentUnadopted = isAgentUnadoptedCard(card)
  const customHeader = card.headerColor?.trim()
  if (customHeader && isHexColor(customHeader)) {
    return {
      fill: withAlpha(customHeader, 0.16),
      stroke: agentUnadopted ? palette.agentUnadoptedAccent : customHeader,
      label: customHeader,
      dashed: agentUnadopted || card.kind === 'group',
    }
  }

  const semantic =
    card.kind === 'askAi'
      ? palette.cards.ask
      : card.kind === 'note'
        ? palette.cards.note
        : palette.cards[card.kind]
  const semanticLabel =
    card.kind === 'mod' || card.kind === 'conversation' ? semantic.stroke : palette.label.ink
  return {
    ...semantic,
    stroke: agentUnadopted ? palette.agentUnadoptedAccent : semantic.stroke,
    label: semanticLabel,
    dashed: agentUnadopted || card.kind === 'group',
    ...(card.kind === 'group'
      ? {
          silhouetteFill: withAlpha(semantic.fill, GROUP_CARD_SURFACE_OPACITY.resting),
          selectedSilhouetteFill: withAlpha(semantic.fill, GROUP_CARD_SURFACE_OPACITY.selected),
        }
      : {}),
  }
}

function isHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color)
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.trim()
  if (!isHexColor(normalized)) return normalized
  const expanded =
    normalized.length === 4
      ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
      : normalized
  const value = Number.parseInt(expanded.slice(1), 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
