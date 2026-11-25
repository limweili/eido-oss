import type { BoardChange, BoardChangeEmission } from '../graph/boardChange'
import {
  PASSIVE_CARD_LOOK_AHEAD_MARGIN_PX,
  PASSIVE_CARD_PRELOAD_MARGIN_PX,
  PASSIVE_CARD_RETENTION_MARGIN_PX,
  PASSIVE_CARD_TEXT_WEIGHT_LIMIT,
  planPassiveCardResidency,
  residencyLookAheadViewport,
  residencyViewportMoving,
} from './cardResidency'
import { cardLabel, cardText } from '../graph/graphHelpers'
import type { Card, Connection, Output } from '../graph/types'
import { CONNECTION_INTERACTION_STROKE_WIDTH_PX } from './connections/connectionAppearance'
import { CANVAS_CARD_LAYER_MAX } from '../ui/tokens'
import {
  resolvedCardSize,
  type BoardRenderIndex,
  type BoardViewport,
  type BoardViewportSize,
} from './renderPlanning'
import {
  BAND_CROSSFADE_HALF_WIDTH,
  bandLayerOpacities,
  MAP_BAND_MAX_ZOOM,
  READING_BAND_MIN_ZOOM,
  type DetailBand,
} from './detailBands'

export { BAND_CROSSFADE_HALF_WIDTH, MAP_BAND_MAX_ZOOM, READING_BAND_MIN_ZOOM } from './detailBands'
export type { DetailBand } from './detailBands'

// The full-detail budget: the most cards one viewport may mount. Since the
// mount collapse (ADR 0020) this is not a cap applied to a mounted set — it
// is the occupancy input to `bandForScene` (ADR 0019): a viewport holding
// more than this is demoted out of Reading, so Reading never plans more
// mounts than the budget admits, by construction. Text length never demotes
// the whole viewport out of Reading; the separate passive weight budget keeps
// excess Cards on the painter instead. The massive /
// low-zoom / sticky board-class caps were deleted after the E1 experiment
// re-measured cap removal on top of the mount collapse and approved it
// (src/performance/baselines/massiveDetailExperiment.baseline.json).
export const FULL_DETAIL_CARD_LIMIT = 540
export const DETAIL_CULL_MARGIN_PX = 1800
export const OVERVIEW_CULL_MARGIN_PX = 300
export const ASSET_TEXT_WEIGHT = 20_000

const EMPTY_IDS = new Set<string>()
const EMPTY_CARDS: Card[] = []
const EMPTY_CONNECTIONS: Connection[] = []

/**
 * The product meaning of a card's displayed name, frozen at the scene seam
 * (ADR 0019) so painters and label layers never re-infer it from raw card
 * fields: `landmark` is a structural anchor (group or title card),
 * `user-authored` means a human wrote the words the label shows, and
 * `system-generated` covers kind fallbacks ("Untitled note", "Result") and
 * AI-produced text. Hover and selection OVERRIDE priority at draw time; they
 * never reclassify the card, so they stay out of the scene.
 */
export type CanvasDisplayPriority = 'landmark' | 'user-authored' | 'system-generated'

export type CanvasCardSummary = {
  label: string
  preview: string
  displayPriority: CanvasDisplayPriority
}

/**
 * One card's cached metric inputs and outputs. The input fields are exactly
 * the fields the summary/weight computations read — never the whole card
 * object, because structural updates (a drag) legitimately replace the card
 * object while preserving every summary input. `blocks` is compared by
 * REFERENCE: the store's single-writer commit/progress funnel is backed by
 * Immer, so structural edits preserve untouched nested references while any
 * text mutation replaces the blocks array (pinned by a commit-funnel test).
 */
export type BoardCardMetric = {
  kind: Card['kind']
  title: string
  modLabel: string
  blocks: Card['blocks']
  outputTextLength: number
  assetCount: number
  summary: CanvasCardSummary
  weight: number
}

export type BoardScenePerfCounters = {
  summaryComputations: number
  weightComputations: number
  summaryCardIds: string[]
  weightCardIds: string[]
  /**
   * How many times `createBoardScene` ran since the last reset. The
   * pointer-cold proof (ADR 0019): gates assert pointer storms — hover,
   * gesture moves — leave this unchanged, because pointer state is not a
   * scene input.
   */
  sceneDerivations: number
  /**
   * How many times `deriveBoardCardMetrics` performed metric-relevant work
   * (a targeted update or a full rebuild). The viewport-independence proof
   * (ADR 0019 / A4): viewport-only scene derivations and structural-only
   * board changes (drag, resize, regroup, relayer) leave this at zero.
   */
  cardMetricDerivations: number
  /** How many cards metric derivations inspected since the last reset. */
  cardMetricVisits: number
  /**
   * Full graph-wide metric rebuilds: cold start, hydration/import,
   * add/remove, a missed change sequence, or any unprovable change record.
   * Visible here so fallback rebuilds cannot silently regress into
   * every-frame work.
   */
  cardMetricFullRebuilds: number
}

/**
 * The packaged-safe subset of the scene's cumulative renderer counters.
 * Card identity sets stay behind the richer DEV-only performance surface.
 */
export type BoardSceneNumericCounters = Pick<
  BoardScenePerfCounters,
  | 'sceneDerivations'
  | 'cardMetricDerivations'
  | 'cardMetricVisits'
  | 'cardMetricFullRebuilds'
>

const boardScenePerfCounters = {
  summaryComputations: 0,
  weightComputations: 0,
  summaryCardIds: new Set<string>(),
  weightCardIds: new Set<string>(),
  sceneDerivations: 0,
  cardMetricDerivations: 0,
  cardMetricVisits: 0,
  cardMetricFullRebuilds: 0,
}

export type BoardSceneOptions = {
  cards: Card[]
  connections: Connection[]
  /**
   * The viewport-independent graph metric projection from
   * `deriveBoardCardMetrics`. The scene CONSUMES it and never derives it:
   * a viewport-only change re-derives the scene with zero card-metric visits
   * and no replacement metric maps.
   */
  cardMetrics: BoardCardMetrics
  renderIndex: BoardRenderIndex
  viewport: BoardViewport
  settledViewport: BoardViewport
  viewportSize: BoardViewportSize
  readOnly: boolean
  navigationActive: boolean
  zoomNavigationActive: boolean
  shouldPlanConnections: boolean
  previousScene?: BoardScene | null
}

export type BoardScene = {
  /**
   * The viewport-derived detail band (ADR 0019): the single global
   * level-of-detail step for this viewport — every card on screen shares one
   * representation outside bounded crossfade windows. Derived by `bandForScene`; it
   * replaced `zoomBand` and the board-class render gates (ADR 0020).
   */
  band: DetailBand
  /** Effective opacity of mounted Reading card visuals. Zero when occupancy
   * forbids Reading, even if zoom is inside the visual crossfade window. */
  readingCardOpacity: number
  /**
   * True when the detail (DOM-mounted) set covers every visible card —
   * detail ⊇ visible — so no visible card is a canvas stand-in.
   */
  fullyDetailed: boolean
  boardDetailTextWeight: number
  /** Ordinary text weight admitted within the shared cold Reading pool. */
  admittedDetailTextWeight: number
  /** Exact-visible oversize Cards admitted outside the ordinary weight pool. */
  oversizePassiveCardIds: ReadonlySet<string>
  /** Separately reported combined weight of exact-visible oversize Passive Cards. */
  oversizePassiveTextWeight: number
  /** Shared cold-residency ceiling; hot Live owners are deliberately exempt. */
  detailTextWeightBudget: number
  /** Exact-visible Cards left on the painter by the cold residency budgets. */
  weightDemotedCardIds: ReadonlySet<string>
  visibleCards: Card[]
  visibleCardIds: ReadonlySet<string>
  visibleConnections: Connection[]
  /**
   * The scene's visual-DOM card set (ADR 0020, the mount collapse): below
   * the Reading crossfade no card mounts — every card paints on canvas —
   * while positive Reading opacity mounts the bounded passive window,
   * admitting exact-visible Cards first and leaving weight overflow painted,
   * then considering buffered, directional and retained detail.
   * Read-only playback keeps its whole-board mounting (it has no canvas
   * layer to fall back on). Gesture participants are NOT part of this set:
   * they are a hot overlay composed after the scene by `mountPlanForScene`.
   */
  detailCards: Card[]
  detailCardIds: ReadonlySet<string>
  /** Actual production Reading residency: mounted rich DOM membership (`P ∪ O`). */
  passiveCardIds: ReadonlySet<string>
  /**
   * Exact spatial candidates from the direction-shifted look-ahead query for
   * the current moving viewport. Empty while stationary and read-only.
   */
  lookAheadCardIds: ReadonlySet<string>
  /** Exact-visible editable Cards represented only by the lightweight safety layer (`V − (P ∪ O)`). */
  safetyCardIds: ReadonlySet<string>
  /**
   * Internal candidate history consumed by the residency planner for
   * hysteresis. This is not mounted `P` and must not drive diagnostics.
   */
  residencyHistoryCardIds: ReadonlySet<string>
  /** Viewport history consumed by the bounded Reading residency planner. */
  residencyViewport?: BoardViewport
  hitTestCandidates: Card[]
  renderCanvasCards: boolean
  useCanvasConnections: boolean
  useOverviewLayer: boolean
  showConnections: boolean
  overviewSuppressedCardIds: ReadonlySet<string>
  /** Whether visual DOM owners must fully suppress their painter rendition. */
  suppressMountedCardPaint: boolean
  overviewMarginPx: number
  cardSummariesById: ReadonlyMap<string, CanvasCardSummary>
}

// ─── Aperture state policy ─────────────────────────────────────────────────
// Where the viewport is relative to where it will come to rest, plus which
// navigation inputs are live. Every motion-dependent decision below reads
// viewport motion from here, never from the raw viewports.

export type SceneApertureState = {
  /** The live viewport exactly equals the settled viewport. */
  settled: boolean
  /** Zoom is meaningfully away from its settled value (beyond jitter). */
  zoomChanging: boolean
  /** Any viewport motion: unsettled pan or changing zoom. */
  changing: boolean
  /** Navigation input (pan gesture, wheel) is live, viewport moving or not. */
  navigationActive: boolean
  /** Zoom-specific navigation input is live. */
  zoomNavigationActive: boolean
}

export function apertureStateForScene({
  viewport,
  settledViewport,
  navigationActive,
  zoomNavigationActive,
}: {
  viewport: BoardViewport
  settledViewport: BoardViewport
  navigationActive: boolean
  zoomNavigationActive: boolean
}): SceneApertureState {
  const settled =
    settledViewport.x === viewport.x && settledViewport.y === viewport.y && settledViewport.zoom === viewport.zoom
  const zoomChanging = Math.abs(settledViewport.zoom - viewport.zoom) > 0.001
  return {
    settled,
    zoomChanging,
    changing: !settled || zoomChanging,
    navigationActive,
    zoomNavigationActive,
  }
}

// ─── Detail band model (ADR 0019) ──────────────────────────────────────────
// One global level-of-detail step chosen per viewport: every card on screen
// shares one representation outside bounded crossfade windows. This is the frozen
// interface Lanes B/C/D/E consume — see ADR 0019, never this module's diff.

// Leaving a band requires crossing to the far edge of its crossfade window,
// not just back over the threshold (the Schmitt-trigger deadband): a zoom
// resting ON a threshold cannot flicker between representations.
const READING_BAND_EXIT_ZOOM = READING_BAND_MIN_ZOOM * (1 - BAND_CROSSFADE_HALF_WIDTH)
const MAP_BAND_EXIT_ZOOM = MAP_BAND_MAX_ZOOM * (1 + BAND_CROSSFADE_HALF_WIDTH)

const DETAIL_BAND_ORDER: Record<DetailBand, number> = { map: 0, overview: 1, reading: 2 }

/**
 * Viewport occupancy as the band decider sees it: whether the visible
 * viewport holds more cards than the detail budget can mount. Occupancy can
 * only push AWAY from Reading (demote), never promote.
 */
export type SceneBandOccupancy = {
  /** More visible cards than the detail budget's card cap. */
  cardDenseViewport: boolean
}

function nominalBandForZoom(zoom: number): DetailBand {
  if (zoom >= READING_BAND_MIN_ZOOM) return 'reading'
  if (zoom <= MAP_BAND_MAX_ZOOM) return 'map'
  return 'overview'
}

// The Schmitt-trigger deadband: a band is ENTERED at its nominal threshold
// but only LEFT past the far edge of its crossfade window, so zoom jitter on
// a threshold holds the previous band instead of flickering.
function deadbandedBandForZoom(zoom: number, previousBand: DetailBand): DetailBand {
  switch (previousBand) {
    case 'reading':
      if (zoom > READING_BAND_EXIT_ZOOM) return 'reading'
      return zoom <= MAP_BAND_MAX_ZOOM ? 'map' : 'overview'
    case 'map':
      if (zoom < MAP_BAND_EXIT_ZOOM) return 'map'
      return nominalBandForZoom(zoom)
    case 'overview':
      return nominalBandForZoom(zoom)
  }
}

/**
 * The detail band decider (ADR 0019). A PURE function of
 * `(zoom, occupancy, settleState, previousBand)` — it hides the two zoom
 * thresholds, the occupancy demotion, the Schmitt-trigger deadband, and the
 * settle gate behind one scalar. Rules, in order:
 *
 * - Seed (`previousBand === null`): the nominal band from zoom alone —
 *   `reading` at zoom ≥ 0.325, `map` at ≤ 0.15, `overview` between — with only
 *   the occupancy demotion applied (occupancy is stateless per-frame input;
 *   with no previous band there is no deadband and no settle gate, and
 *   applying occupancy at seed keeps re-derivation at an unchanged viewport
 *   from flipping the band after the first frame).
 * - Deadband: the previous band holds until zoom crosses the far edge of its
 *   crossfade window (Reading holds until ≤ 0.27625; Map holds until ≥ 0.1725).
 * - Occupancy demotion: a viewport too occupied to mount full detail demotes
 *   Reading to Overview. Occupancy never promotes.
 * - Settle gate: promotion toward Reading is blocked while the viewport
 *   moves (cards may "load in" after a fast pan); demotion toward Map is
 *   always allowed, so motion can never show more detail than the viewport
 *   has earned.
 *
 * The decider MUST tolerate re-derivation at an unchanged viewport — the
 * scene already re-derives without viewport motion (selecting a card does
 * it), so everything here keys off the viewport and the settle state, never
 * off call counts or off `previousScene` advancing: same inputs, same band,
 * deadband intact.
 */
export function bandForScene({
  zoom,
  occupancy,
  settleState,
  previousBand,
}: {
  zoom: number
  occupancy: SceneBandOccupancy
  settleState: SceneApertureState
  previousBand: DetailBand | null
}): DetailBand {
  const zoomBand = previousBand === null ? nominalBandForZoom(zoom) : deadbandedBandForZoom(zoom, previousBand)
  const overOccupied = occupancy.cardDenseViewport
  const targetBand = zoomBand === 'reading' && overOccupied ? 'overview' : zoomBand
  if (previousBand === null) return targetBand
  const promoting = DETAIL_BAND_ORDER[targetBand] > DETAIL_BAND_ORDER[previousBand]
  if (promoting && isDetailApertureUnsettled(settleState)) return previousBand
  return targetBand
}

// ─── Suppression policy ────────────────────────────────────────────────────
// Two constraints pull on full-detail suppression, split by viewport motion
// (#150): while SETTLED, mounted cards are suppressed so the canvas fallback
// (which guesses auto-height card sizes) cannot show a persistent outline
// under them — this is the duplicate #158 and its cardEditing browser tests
// guard. While the viewport MOVES, DOM transforms lag the live viewport, so
// the canvas underlay is what keeps viewport-edge cards represented until
// React catches up — the dense full-detail perf gate requires it (#167).
// #158 regressed that gate by suppressing in both states; only the settled
// half was ever needed. Note the split is viewport MOTION (aperture.changing),
// not navigation input: clicking a card sets navigationActive without moving
// the viewport and must not lift suppression.

export function overviewSuppressionForScene({
  readOnly,
  canRenderWholeBoardDetail,
  aperture,
  detailCardIds,
}: {
  readOnly: boolean
  canRenderWholeBoardDetail: boolean
  aperture: SceneApertureState
  detailCardIds: ReadonlySet<string>
}): ReadonlySet<string> {
  const fullDetailNavigationUnderlay = !readOnly && canRenderWholeBoardDetail && aperture.changing
  return fullDetailNavigationUnderlay ? EMPTY_IDS : detailCardIds
}

// ─── Graph metric projection (A4, ADR 0019) ────────────────────────────────
// Card summaries and text weights depend on the board GRAPH only, never on
// the viewport, so they live in their own projection outside the scene:
// navigation frames re-derive the scene without visiting a single card
// metric. The store's BoardChange record is an invalidation HINT, never
// truth — the projection stays pure and rebuildable from graph + change
// record (ADR 0011), and any uncertainty falls back to a counted full
// rebuild from the graph, so a wrong or missing hint can only cost work,
// never leave a stale summary.

/**
 * The viewport-independent graph metric projection `createBoardScene`
 * consumes. Derived by `deriveBoardCardMetrics`; owns every graph-wide
 * metric Map.
 */
export type BoardCardMetrics = {
  boardDetailTextWeight: number
  cardSummariesById: ReadonlyMap<string, CanvasCardSummary>
  cardWeightById: ReadonlyMap<string, number>
}

// Bookkeeping the incremental path needs (which graph refs and change seq a
// projection corresponds to, plus the per-card metric cache), kept OUT of the
// public projection surface so structural-only updates can return the exact
// previous projection object while still advancing what it corresponds to.
type BoardCardMetricsInternals = {
  cards: readonly Card[]
  outputs: readonly Output[]
  changeSeq: number
  metricById: Map<string, BoardCardMetric>
}

const boardCardMetricsInternals = new WeakMap<BoardCardMetrics, BoardCardMetricsInternals>()

export type DeriveBoardCardMetricsOptions = {
  cards: readonly Card[]
  outputs: readonly Output[]
  /** The render index's existing per-id lookup (`renderIndex.cardById`). */
  cardById: (cardId: string) => Card | undefined
  /** The store's latest change emission (`lastBoardChange`), if any. */
  change: BoardChangeEmission | null
  previous: BoardCardMetrics | null
}

const STRUCTURAL_CARD_ASPECTS = new Set(['position', 'size', 'grouping', 'layer', 'order'])

// A change record that provably cannot alter any metric input: no card
// added/removed, no output touched, and every updated card aspect is
// structural. Connections/runs changes never feed metrics.
function isMetricNeutralChange(change: BoardChange): boolean {
  if (change.cards?.added?.length || change.cards?.removed?.length) return false
  if (change.outputs) return false
  if (!change.cards?.updated?.length) return true
  if (!change.cardAspects?.length) return false
  return change.cardAspects.every((aspect) => STRUCTURAL_CARD_ASPECTS.has(aspect))
}

/**
 * Derives the graph metric projection. Reference identity decides
 * metric-neutrality; the change record never does (#324 as amended:
 * https://github.com/limweili/eido/issues/324#issuecomment-4934751797).
 * Paths, cheapest first:
 *
 * - `cards` AND `outputs` reference-identical to the previous projection's
 *   inputs: metrics are PROVABLY unchanged (the store commits through Immer
 *   with structural sharing), so zero work — even across a missed `seq`,
 *   which is only fast-forwarded.
 * - A reference differs: the change record may NARROW the work, but only
 *   when it is contiguous (`seq` exactly one past the seq this projection
 *   last saw) and acknowledges every collection whose reference changed —
 *   the record is never evidence that no difference exists. A provable
 *   structural-only change (position/size/grouping/layer) returns the exact
 *   previous projection with zero visits; a provable content change or
 *   updated output visits only the named cards via the render index lookup.
 * - Everything else — cold start, hydration/import, card OR output
 *   add/remove, a missed change sequence with changed references, a record
 *   that omits or cannot resolve what changed: a counted full rebuild from
 *   the graph (`cardMetricFullRebuilds`).
 */
export function deriveBoardCardMetrics({
  cards,
  outputs,
  cardById,
  change,
  previous,
}: DeriveBoardCardMetricsOptions): BoardCardMetrics {
  const internals = previous ? boardCardMetricsInternals.get(previous) : undefined
  if (previous && internals) {
    const sameCards = internals.cards === cards
    const sameOutputs = internals.outputs === outputs
    if (sameCards && sameOutputs) {
      // Reference identity proves the metric inputs unchanged; fast-forward
      // the seq so this emission (connections/runs-only, or even a missed
      // run of such emissions) does not read as a gap later.
      if (change) internals.changeSeq = change.seq
      return previous
    }
    const step = change && change.seq === internals.changeSeq + 1 ? change.change : null
    // The record only narrows work when it explains the established
    // difference: every collection whose reference changed must appear in
    // it. A record naming only connections while `cards` changed is
    // malformed for our purposes and falls through to the rebuild.
    const explainsDifference =
      step !== null && (sameCards || Boolean(step.cards)) && (sameOutputs || Boolean(step.outputs))
    if (step && explainsDifference) {
      if (isMetricNeutralChange(step)) {
        internals.cards = cards
        internals.outputs = outputs
        internals.changeSeq = change!.seq
        return previous
      }
      // Card and output adds/removes always take the full rebuild (#324).
      const collectionsStable =
        !step.cards?.added?.length &&
        !step.cards?.removed?.length &&
        !step.outputs?.added?.length &&
        !step.outputs?.removed?.length
      if (collectionsStable) {
        const updated = applyTargetedMetricUpdate({ outputs, cardById, change: step, previous, internals })
        if (updated) {
          internals.cards = cards
          internals.outputs = outputs
          internals.changeSeq = change!.seq
          if (updated !== previous) {
            boardCardMetricsInternals.delete(previous)
            boardCardMetricsInternals.set(updated, internals)
          }
          return updated
        }
      }
    }
  }
  return rebuildBoardCardMetrics(cards, outputs, change, previous, internals)
}

// The provable single-step path: only the cards the change record names (and
// the result cards of updated outputs — BOTH ends when an output's
// `resultCardId` moved, or the previous target would keep a stale weight)
// are visited. Returns null when the record turns out not to explain what it
// claims (an updated id the index cannot resolve, or a card this cache never
// saw) — the caller falls back to a full rebuild.
function applyTargetedMetricUpdate({
  outputs,
  cardById,
  change,
  previous,
  internals,
}: {
  outputs: readonly Output[]
  cardById: (cardId: string) => Card | undefined
  change: BoardChange
  previous: BoardCardMetrics
  internals: BoardCardMetricsInternals
}): BoardCardMetrics | null {
  const outputsTouched = Boolean(change.outputs)
  // Output text lengths follow the same last-wins semantics as the rebuild,
  // so resolve them from one pass over the outputs collection (bounded by
  // outputs, not cards — zero card visits).
  const outputTextLengths = outputsTouched ? outputTextLengthsByCardId(outputs) : null
  const affectedCardIds = new Set<string>()
  for (const id of change.cards?.updated ?? []) affectedCardIds.add(id)
  for (const outputId of change.outputs?.updated ?? []) {
    const nextOutput = outputs.find((candidate) => candidate.id === outputId)
    const previousOutput = internals.outputs.find((candidate) => candidate.id === outputId)
    if (!nextOutput || !previousOutput) return null
    affectedCardIds.add(nextOutput.resultCardId)
    // `resultCardId` is mutable: a moved output must re-derive its previous
    // target too, or that card keeps the moved output's weight forever.
    affectedCardIds.add(previousOutput.resultCardId)
  }

  boardScenePerfCounters.cardMetricDerivations += 1
  const changedMetrics: { id: string; metric: BoardCardMetric; previousMetric: BoardCardMetric }[] = []
  for (const id of affectedCardIds) {
    boardScenePerfCounters.cardMetricVisits += 1
    const card = cardById(id)
    const previousMetric = internals.metricById.get(id)
    if (!card || !previousMetric) return null
    const outputTextLength = outputsTouched ? (outputTextLengths!.get(id) ?? 0) : previousMetric.outputTextLength
    const metric = metricForCard(card, outputTextLength, previousMetric)
    if (metric !== previousMetric) changedMetrics.push({ id, metric, previousMetric })
  }
  if (!changedMetrics.length) return previous

  const metricById = internals.metricById
  let boardDetailTextWeight = previous.boardDetailTextWeight
  let summariesChanged = false
  let weightsChanged = false
  for (const { metric, previousMetric } of changedMetrics) {
    if (metric.summary !== previousMetric.summary) summariesChanged = true
    if (metric.weight !== previousMetric.weight) weightsChanged = true
    boardDetailTextWeight += metric.weight - previousMetric.weight
  }
  const cardSummariesById = summariesChanged
    ? new Map(previous.cardSummariesById)
    : previous.cardSummariesById
  const cardWeightById = weightsChanged ? new Map(previous.cardWeightById) : previous.cardWeightById
  for (const { id, metric } of changedMetrics) {
    metricById.set(id, metric)
    if (summariesChanged) (cardSummariesById as Map<string, CanvasCardSummary>).set(id, metric.summary)
    if (weightsChanged) (cardWeightById as Map<string, number>).set(id, metric.weight)
  }
  if (!summariesChanged && !weightsChanged) return previous
  return { boardDetailTextWeight, cardSummariesById, cardWeightById }
}

function rebuildBoardCardMetrics(
  cards: readonly Card[],
  outputs: readonly Output[],
  change: BoardChangeEmission | null,
  previous: BoardCardMetrics | null,
  previousInternals: BoardCardMetricsInternals | undefined,
): BoardCardMetrics {
  boardScenePerfCounters.cardMetricDerivations += 1
  boardScenePerfCounters.cardMetricFullRebuilds += 1
  const outputTextLengths = outputTextLengthsByCardId(outputs)
  const metricById = new Map<string, BoardCardMetric>()
  const nextSummaries = new Map<string, CanvasCardSummary>()
  const nextWeights = new Map<string, number>()
  let boardDetailTextWeight = 0

  for (const card of cards) {
    boardScenePerfCounters.cardMetricVisits += 1
    const metric = metricForCard(card, outputTextLengths.get(card.id) ?? 0, previousInternals?.metricById.get(card.id))
    metricById.set(card.id, metric)
    nextSummaries.set(card.id, metric.summary)
    nextWeights.set(card.id, metric.weight)
    boardDetailTextWeight += metric.weight
  }

  const projection: BoardCardMetrics = {
    boardDetailTextWeight,
    cardSummariesById: reuseMapByEntries(nextSummaries, previous?.cardSummariesById),
    cardWeightById: reuseMapByEntries(nextWeights, previous?.cardWeightById),
  }
  // A rebuild that changed no value must return the previous projection so
  // downstream memoization holds.
  if (
    previous &&
    previousInternals &&
    projection.cardSummariesById === previous.cardSummariesById &&
    projection.cardWeightById === previous.cardWeightById &&
    projection.boardDetailTextWeight === previous.boardDetailTextWeight
  ) {
    previousInternals.cards = cards
    previousInternals.outputs = outputs
    previousInternals.changeSeq = change?.seq ?? previousInternals.changeSeq
    previousInternals.metricById = metricById
    return previous
  }
  // The rebuilt projection reflects the graph as of the triggering emission,
  // so the NEXT emission (seq + 1) is again provable and incremental.
  boardCardMetricsInternals.set(projection, { cards, outputs, changeSeq: change?.seq ?? 0, metricById })
  return projection
}

// Recomputes a card's summary/weight only when the inputs each one reads
// changed; identical inputs return the previous metric object untouched.
function metricForCard(card: Card, outputTextLength: number, previousMetric: BoardCardMetric | undefined): BoardCardMetric {
  const title = card.title ?? ''
  const modLabel = card.modV2?.title ?? ''
  const assetCount = card.assets?.length ?? 0
  const sameSummaryInputs =
    previousMetric !== undefined &&
    previousMetric.kind === card.kind &&
    previousMetric.title === title &&
    previousMetric.modLabel === modLabel &&
    previousMetric.blocks === card.blocks
  const sameWeightInputs =
    previousMetric !== undefined &&
    previousMetric.blocks === card.blocks &&
    previousMetric.outputTextLength === outputTextLength &&
    previousMetric.assetCount === assetCount
  if (sameSummaryInputs && sameWeightInputs) return previousMetric
  return {
    kind: card.kind,
    title,
    modLabel,
    blocks: card.blocks,
    outputTextLength,
    assetCount,
    summary: sameSummaryInputs ? previousMetric.summary : computeSummaryForCard(card),
    weight: sameWeightInputs ? previousMetric.weight : computeCardTextWeight(card, outputTextLength),
  }
}

// ─── Composition ───────────────────────────────────────────────────────────

/**
 * Derives the board scene — the projection every rendering layer consumes —
 * as a pure function of the board graph projection and the viewport.
 *
 * The scene is POINTER-COLD (ADR 0019): pointer state — hovered id, gesture
 * participant ids, drag/connect preview — must never become an input to this
 * function; it lives in the adapter hot path. Cold does not mean infrequent:
 * viewport changes still re-derive the scene on navigation frames, so
 * graph-wide card metrics live outside this function in the
 * viewport-independent `deriveBoardCardMetrics` projection this function
 * consumes (its `cardMetricDerivations` / `cardMetricVisits` counters prove
 * viewport-only derivations do no graph-metric work; `sceneDerivations` here
 * proves pointer stability).
 */
export function createBoardScene({
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
  previousScene,
}: BoardSceneOptions): BoardScene {
  boardScenePerfCounters.sceneDerivations += 1
  // Playback renders static cards and has no overview layer to fall back on,
  // so viewport culling there would pop cards and connections in and out
  // (each with a mount animation) while replaying or panning. Render the whole
  // board up to the card limit. Text length never changes this decision.
  const canRenderWholeBoardDetail = cards.length <= FULL_DETAIL_CARD_LIMIT
  const aperture = apertureStateForScene({ viewport, settledViewport, navigationActive, zoomNavigationActive })

  const boundedReadingResidency = !readOnly
  const renderWindow = boundedReadingResidency
    ? renderIndex.query(viewport, viewportSize, 0, { includeConnections: false }).cards
    : canRenderWholeBoardDetail
    ? cards
    : renderIndex.query(viewport, viewportSize, DETAIL_CULL_MARGIN_PX, { includeConnections: false }).cards
  const visibleCards = reuseCardArray(renderWindow, previousScene?.visibleCards)
  const visibleCardIds = reuseSetForCards(visibleCards, previousScene?.visibleCardIds)
  const previousResidencyViewport = previousScene?.residencyViewport
  const lookAheadQueryActive = boundedReadingResidency && residencyViewportMoving(viewport, previousResidencyViewport)
  const lookAheadCards = lookAheadQueryActive
    ? renderIndex.query(
        residencyLookAheadViewport(viewport, previousResidencyViewport),
        viewportSize,
        PASSIVE_CARD_LOOK_AHEAD_MARGIN_PX,
        { includeConnections: false },
      ).cards
    : EMPTY_CARDS
  const lookAheadCardIds = reuseSetForCards(lookAheadCards, previousScene?.lookAheadCardIds)
  const plannedPassiveResidency = boundedReadingResidency
    ? (() => {
        return planPassiveCardResidency({
          visibleCardIds: visibleCards.map((card) => card.id),
          preloadCardIds: renderIndex
            .query(viewport, viewportSize, PASSIVE_CARD_PRELOAD_MARGIN_PX, { includeConnections: false })
            .cards.map((card) => card.id),
          lookAheadCardIds: lookAheadCards.map((card) => card.id),
          cardWeightById: cardMetrics.cardWeightById,
          previousPassiveCardIds:
            previousScene?.residencyHistoryCardIds ?? previousScene?.passiveCardIds,
          retentionCardIds: renderIndex
            .query(viewport, viewportSize, PASSIVE_CARD_RETENTION_MARGIN_PX, { includeConnections: false })
            .cards.map((card) => card.id),
          viewport,
          previousViewport: previousResidencyViewport,
        })
      })()
    : null
  const plannedPassiveCardIds = plannedPassiveResidency?.passiveCardIds ?? null
  const cardDenseViewport = visibleCards.length > FULL_DETAIL_CARD_LIMIT

  const band = bandForScene({
    zoom: viewport.zoom,
    occupancy: { cardDenseViewport },
    settleState: aperture,
    previousBand: previousScene?.band ?? null,
  })

  const readingMountDisallowed = cardDenseViewport
  const readingCardOpacity = readingMountDisallowed
    ? 0
    : bandLayerOpacities(viewport.zoom, {
        readingMinZoom: READING_BAND_MIN_ZOOM,
        mapMaxZoom: MAP_BAND_MAX_ZOOM,
      }).reading

  const routing = layerRoutingForScene({
    readOnly,
    shouldPlanConnections,
    canRenderWholeBoardDetail,
    boundedReadingResidency,
    band,
    readingCardOpacity,
  })

  // The mount collapse (ADR 0020): band occupancy plus the zoom-pure Reading
  // opacity decide what mounts. Below its crossfade the visual-DOM set is
  // EMPTY — no board-class aperture, no
  // low-zoom placeholders, no selection promotion (selection paints on the
  // canvas instead). At positive Reading opacity the production passive
  // window mounts: viewport-visible candidates lead the stable tier order,
  // followed by direction-aware preload and retained Cards. Ordinary Cards
  // share the 600K text-weight pool while up to ten exact-visible Cards
  // above the 100K individual threshold use the separate O pool.
  // Weight-rejected candidates stay on the painter while later ordered
  // candidates remain eligible; the shared 540-Card ceiling still demotes an
  // over-occupied viewport as a whole. Read-only
  // playback keeps whole-board mounting when the
  // board fits the budget — it has no canvas layer to represent unmounted
  // cards — and a playback window past the budget mounts nothing rather
  // than an unbounded node set.
  const passiveCards = plannedPassiveCardIds
    ? [...plannedPassiveCardIds]
        .map((cardId) => renderIndex.cardById(cardId))
        .filter((card): card is Card => Boolean(card))
    : visibleCards
  const detailCards = reuseCardArray(
    readOnly
      ? visibleCards.length <= FULL_DETAIL_CARD_LIMIT
        ? visibleCards
        : EMPTY_CARDS
      : readingCardOpacity > 0
        ? passiveCards
        : EMPTY_CARDS,
    previousScene?.detailCards,
  )
  const detailCardIds = reuseSetForCards(detailCards, previousScene?.detailCardIds)
  const residencyHistoryCardIds = plannedPassiveCardIds
    ? reuseIdSet(plannedPassiveCardIds, previousScene?.residencyHistoryCardIds)
    : detailCardIds
  // P/O/S describe actual representation, not the planner's pre-LOD candidate
  // set. The separate history above preserves off-band hysteresis without
  // reporting nonmounted Cards as passive residency.
  const passiveCardIds = boundedReadingResidency
    ? readingCardOpacity > 0
      ? detailCardIds
      : EMPTY_IDS
    : detailCardIds
  const oversizePassiveCardIds = boundedReadingResidency && readingCardOpacity > 0
    ? reuseIdSet(
        plannedPassiveResidency?.oversizePassiveCardIds ?? EMPTY_IDS,
        previousScene?.oversizePassiveCardIds,
      )
    : EMPTY_IDS
  const oversizePassiveTextWeight = oversizePassiveCardIds.size
    ? (plannedPassiveResidency?.oversizePassiveTextWeight ?? 0)
    : 0
  const safetyCardIds = boundedReadingResidency
    ? reuseIdSet(
        new Set([...visibleCardIds].filter((cardId) => !passiveCardIds.has(cardId))),
        previousScene?.safetyCardIds,
      )
    : EMPTY_IDS
  const weightDemotedCardIds = boundedReadingResidency && readingCardOpacity > 0
    ? safetyCardIds
    : EMPTY_IDS
  const admittedDetailTextWeight = boundedReadingResidency
    ? readingCardOpacity > 0
      ? (plannedPassiveResidency?.admittedTextWeight ?? 0)
      : 0
    : detailCards.length
      ? cardMetrics.boardDetailTextWeight
      : 0
  const residencyViewport = boundedReadingResidency
    ? reuseViewport(viewport, previousScene?.residencyViewport)
    : undefined

  // DOM connection edges exist only between mounted endpoint cards, so they
  // are planned only when the routing shows them (Reading / playback); the
  // painter draws every other band's connections straight from the render
  // index.
  const visibleConnections = reuseConnectionArray(
    !routing.showConnections
      ? EMPTY_CONNECTIONS
      : boundedReadingResidency
        ? renderIndex.connectionsForCards(detailCards)
        : canRenderWholeBoardDetail
          ? connections
          : renderIndex.connectionsForCards(visibleCards),
    previousScene?.visibleConnections,
  )

  const paintOccludingCardIds = readOnly || readingCardOpacity >= 1 ? detailCardIds : EMPTY_IDS
  const overviewSuppressedCardIds = overviewSuppressionForScene({
    readOnly,
    canRenderWholeBoardDetail: canRenderWholeBoardDetail || boundedReadingResidency,
    aperture,
    detailCardIds: paintOccludingCardIds,
  })
  // This scalar stays authoritative even when P is empty (for example one
  // exact-visible Card alone exceeds the text budget). The hot mount plan
  // needs it to suppress a later Live owner without guessing from an empty
  // suppression set.
  const suppressMountedCardPaint = readOnly || (readingCardOpacity >= 1 && !aperture.changing)
  const hitTestCandidates = reuseCardArray(
    routing.renderCanvasCards
      ? visibleCards.filter(
          (card) =>
            !overviewSuppressedCardIds.has(card.id) &&
            (readingCardOpacity <= 0 || safetyCardIds.has(card.id)),
        )
      : EMPTY_CARDS,
    previousScene?.hitTestCandidates,
  )

  return {
    band,
    readingCardOpacity,
    fullyDetailed: isSupersetOf(detailCardIds, visibleCardIds),
    boardDetailTextWeight: cardMetrics.boardDetailTextWeight,
    admittedDetailTextWeight,
    oversizePassiveCardIds,
    oversizePassiveTextWeight,
    detailTextWeightBudget: PASSIVE_CARD_TEXT_WEIGHT_LIMIT,
    weightDemotedCardIds,
    visibleCards,
    visibleCardIds,
    visibleConnections,
    detailCards,
    detailCardIds,
    passiveCardIds,
    lookAheadCardIds,
    safetyCardIds,
    residencyHistoryCardIds,
    residencyViewport,
    hitTestCandidates,
    renderCanvasCards: routing.renderCanvasCards,
    useCanvasConnections: routing.useCanvasConnections,
    useOverviewLayer: routing.useOverviewLayer,
    showConnections: routing.showConnections,
    overviewSuppressedCardIds,
    suppressMountedCardPaint,
    overviewMarginPx: OVERVIEW_CULL_MARGIN_PX,
    cardSummariesById: cardMetrics.cardSummariesById,
  }
}

// Which rendering layers carry the scene, decided by the detail band and its
// shared opacity plan (ADR 0020). Below the Reading crossfade nothing mounts,
// so the canvas paints every card and —
// because unmounted endpoint cards make DOM edges impossible — every
// connection; onPaneClick's hit tests keep clicks working there. While Reading
// opacity is positive the bounded passive window owns its resident Cards and
// their endpoint connections; weight overflow and nonresident connections
// stay on the painter (#211). The canvas body crossfades underneath
// until Reading becomes fully opaque, then serves only as the full-detail
// motion underlay (canvas-layer invariant 5).
function layerRoutingForScene({
  readOnly,
  shouldPlanConnections,
  canRenderWholeBoardDetail,
  boundedReadingResidency,
  band,
  readingCardOpacity,
}: {
  readOnly: boolean
  shouldPlanConnections: boolean
  canRenderWholeBoardDetail: boolean
  boundedReadingResidency: boolean
  band: DetailBand
  readingCardOpacity: number
}) {
  const belowReading = band !== 'reading'
  const readingInteractionActive = readingCardOpacity > 0
  const renderOverviewCards = !readOnly && (belowReading || readingCardOpacity < 1)
  const fullDetailNavigationFallback =
    !readOnly && band === 'reading' && (canRenderWholeBoardDetail || boundedReadingResidency)
  const renderCanvasCards = renderOverviewCards || fullDetailNavigationFallback
  const useCanvasConnections = !readOnly && shouldPlanConnections && !readingInteractionActive
  const useOverviewLayer = renderCanvasCards || useCanvasConnections
  return {
    renderCanvasCards,
    useCanvasConnections,
    useOverviewLayer,
    showConnections: shouldPlanConnections && !useCanvasConnections,
  }
}

function isDetailApertureUnsettled(aperture: SceneApertureState): boolean {
  return aperture.navigationActive || aperture.zoomNavigationActive || aperture.changing
}

// ─── Mount plan composition (the hot overlay, ADR 0020) ───────────────────
// The scene is cold: derived from the board graph projection and the
// viewport only. Gesture participants are HOT pointer state — passing them
// into `createBoardScene` would re-derive the scene (and, on an uncapped
// board, rebuild `nodes`) on every hover transition. So they are composed
// AFTER the scene memo by this pure function, and only a participant
// identity transition rebuilds the bounded mount plan.

/**
 * The gesture participant bound: a drag holds one card, a connect gesture
 * holds two ends. The mount plan ENFORCES this — it is not advisory.
 */
export const GESTURE_PARTICIPANT_LIMIT = 2

export type MountPlan = {
  /** Every card mounted as a React Flow node: the scene's own visual-DOM
   * cards plus the admitted gesture participants. The guarantee is
   * `mountedCardIds ⊇ (gestureParticipantIds ∩ resolvable cards)`, up to
   * the enforced participant bound — deliberately not a detail-set
   * guarantee. */
  mountedCards: readonly Card[]
  /** Full interactive Card owners, kept distinct from passive residents. */
  liveCardIds: ReadonlySet<string>
  /**
   * Gesture participants mounted as invisible proxies — never the scene's
   * own cards, and never more than `GESTURE_PARTICIPANT_LIMIT`. A proxy
   * enters `nodes` for interaction, but it does not visually occlude the
   * canvas.
   */
  proxyCardIds: ReadonlySet<string>
  /**
   * Participants this plan did NOT mount, surfaced loudly instead of
   * silently filtered: ids the board cannot resolve (a delete raced the
   * gesture) and ids past the participant bound (a caller-contract
   * violation, clamped). Empty on every well-behaved frame.
   */
  excludedParticipantIds: ReadonlySet<string>
  /**
   * The cards the painter treats as visual DOM cards. Cold passive and hot
   * Live owners enter; invisible gesture proxies never do. During the
   * Reading crossfade the painter uses this membership to keep mounted cards
   * on the inverse fade while nonmounted safety cards stay fully painted.
   */
  paintOccludingCardIds: ReadonlySet<string>
  /** The scene's own suppression set, likewise untouched by proxies. */
  overviewSuppressedCardIds: ReadonlySet<string>
}

export function mountPlanForScene({
  scene,
  gestureParticipantIds,
  liveOwnerIds = EMPTY_IDS,
  cardById,
}: {
  scene: BoardScene
  gestureParticipantIds: ReadonlySet<string>
  liveOwnerIds?: ReadonlySet<string>
  cardById: (cardId: string) => Card | undefined
}): MountPlan {
  const visualDomPaintActive = scene.readingCardOpacity > 0 || scene.suppressMountedCardPaint
  const scenePaintOccludingCardIds = visualDomPaintActive ? scene.detailCardIds : EMPTY_IDS
  // The empty-participant fast path returns the scene's/caller's own
  // instances untouched — Immer-style structural sharing is the memo
  // neutrality evidence downstream consumers rely on.
  if (!gestureParticipantIds.size && !liveOwnerIds.size) {
    return {
      mountedCards: scene.detailCards,
      liveCardIds: liveOwnerIds,
      proxyCardIds: gestureParticipantIds,
      excludedParticipantIds: EMPTY_IDS,
      paintOccludingCardIds: scenePaintOccludingCardIds,
      overviewSuppressedCardIds: scene.overviewSuppressedCardIds,
    }
  }

  const liveCards: Card[] = []
  const fullCardIds = new Set(scene.detailCardIds)
  for (const cardId of liveOwnerIds) {
    if (fullCardIds.has(cardId)) continue
    const card = cardById(cardId)
    if (!card) continue
    fullCardIds.add(cardId)
    liveCards.push(card)
  }
  const proxyCardIds = new Set<string>()
  const proxyCards: Card[] = []
  const excludedParticipantIds = new Set<string>()
  let admitted = 0
  for (const cardId of gestureParticipantIds) {
    // More than GESTURE_PARTICIPANT_LIMIT participants is a caller-contract
    // violation. The plan ENFORCES AND CLAMPS deterministically (set
    // iteration is insertion order: the first admitted participants win)
    // rather than throwing: this composition runs on the render path, so a
    // caller bug must degrade to a still-bounded plan instead of taking the
    // canvas down — and the clamped ids surface in excludedParticipantIds
    // so the violation is observable, never a silent widening of the mount
    // set.
    if (admitted >= GESTURE_PARTICIPANT_LIMIT) {
      excludedParticipantIds.add(cardId)
      continue
    }
    // A participant the scene already mounts keeps its full card node; it
    // needs no proxy but still occupies a participant slot.
    if (fullCardIds.has(cardId)) {
      admitted += 1
      continue
    }
    const card = cardById(cardId)
    if (!card) {
      // A participant the board cannot resolve (deleted mid-gesture) is
      // excluded LOUDLY — the id lands here for callers and dev overlays to
      // observe — never silently dropped. It does not consume a slot.
      excludedParticipantIds.add(cardId)
      continue
    }
    admitted += 1
    proxyCardIds.add(cardId)
    proxyCards.push(card)
  }

  const paintOccludingCardIds =
    visualDomPaintActive && liveCards.length
      ? fullCardIds
      : scenePaintOccludingCardIds
  const overviewSuppressedCardIds = scene.suppressMountedCardPaint && liveCards.length
    ? paintOccludingCardIds
    : scene.overviewSuppressedCardIds

  return {
    mountedCards:
      liveCards.length || proxyCards.length
        ? [...scene.detailCards, ...liveCards, ...proxyCards]
        : scene.detailCards,
    liveCardIds: liveOwnerIds,
    proxyCardIds: proxyCardIds.size ? proxyCardIds : EMPTY_IDS,
    excludedParticipantIds: excludedParticipantIds.size ? excludedParticipantIds : EMPTY_IDS,
    paintOccludingCardIds,
    overviewSuppressedCardIds,
  }
}

/**
 * True when a pointer gesture began on a card node or a resize handle. Card
 * drags/resizes must NOT count as navigation for the detail aperture — only
 * pan/zoom does (#204). If a drag marked navigation active, the scene would
 * hold the tightened navigation aperture (and its sticky reuse) open for the
 * whole gesture plus the settle delay. Duck-typed on `closest` so it stays
 * testable outside a DOM environment.
 */
export function isCardInteractionTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null
  if (!element || typeof element.closest !== 'function') return false
  return Boolean(element.closest('.react-flow__node, .react-flow__resize-control'))
}

export type PointerNavigationEvent = {
  target: EventTarget | null
  buttons?: number
}

/**
 * The Board-side half of the aperture invariant (#204): only pan/zoom marks
 * navigation active. A pointer gesture that begins on a card node or resize
 * handle moves the CARD, not the viewport, so neither its pointerdown nor any
 * pointermove while the button is held may flip the scene into
 * navigation-active sticky mode. Board.tsx wires the returned handlers to its
 * wrapper's pointerdown/pointermove listeners.
 */
export function createPointerNavigationTracker(markNavigationActive: () => void) {
  let gestureOnCard = false
  return {
    pointerdown(event: PointerNavigationEvent) {
      gestureOnCard = isCardInteractionTarget(event.target)
      if (!gestureOnCard) markNavigationActive()
    },
    pointermove(event: PointerNavigationEvent) {
      if (!event.buttons || gestureOnCard) return
      markNavigationActive()
    },
  }
}

export function resetBoardScenePerfCounters() {
  boardScenePerfCounters.summaryComputations = 0
  boardScenePerfCounters.weightComputations = 0
  boardScenePerfCounters.summaryCardIds.clear()
  boardScenePerfCounters.weightCardIds.clear()
  boardScenePerfCounters.sceneDerivations = 0
  boardScenePerfCounters.cardMetricDerivations = 0
  boardScenePerfCounters.cardMetricVisits = 0
  boardScenePerfCounters.cardMetricFullRebuilds = 0
}

export function boardScenePerfCountersSnapshot(): BoardScenePerfCounters {
  return {
    summaryComputations: boardScenePerfCounters.summaryComputations,
    weightComputations: boardScenePerfCounters.weightComputations,
    summaryCardIds: [...boardScenePerfCounters.summaryCardIds],
    weightCardIds: [...boardScenePerfCounters.weightCardIds],
    ...boardSceneNumericCountersSnapshot(),
  }
}

export function boardSceneNumericCountersSnapshot(): BoardSceneNumericCounters {
  return {
    sceneDerivations: boardScenePerfCounters.sceneDerivations,
    cardMetricDerivations: boardScenePerfCounters.cardMetricDerivations,
    cardMetricVisits: boardScenePerfCounters.cardMetricVisits,
    cardMetricFullRebuilds: boardScenePerfCounters.cardMetricFullRebuilds,
  }
}

// Scene derivation owns the product meaning of the displayed name; label and
// render code own placement, collision, and drawing (ADR 0019). A result
// card's text is AI output, so a body-derived result label stays
// system-generated; a typed title is user-authored on any kind.
function displayPriorityForCard(card: Card): CanvasDisplayPriority {
  if (card.kind === 'group' || card.kind === 'title') return 'landmark'
  if (card.title?.trim()) return 'user-authored'
  if (card.kind === 'result' || card.kind === 'mod') return 'system-generated'
  return cardText(card) ? 'user-authored' : 'system-generated'
}

export function summaryForCard(card: Card): CanvasCardSummary {
  const label = cardLabel(card)
  const displayPriority = displayPriorityForCard(card)
  if (card.kind === 'mod') return { label, preview: card.modV2?.title ?? 'Mod', displayPriority }
  const text = cardText(card).replace(/\s+/g, ' ').trim()
  if (!text || text === label) return { label, preview: card.kind, displayPriority }
  return { label, preview: text.length > 90 ? `${text.slice(0, 87)}...` : text, displayPriority }
}

export function renderLayer(card: Card, fallback: number): number {
  const layer = storedLayer(card, fallback)
  // React Flow connections occupy layer 0. A Group is a background region:
  // keep its whole interactive frame below that connection plane while
  // ordinary Cards remain above it. Previously Groups started at layer 0,
  // so an opaque colour wash painted over member-to-member connections even
  // though the DOM edge remained mounted and clickable.
  // A Card may never reach the canvas-floating plane. Cards and the connection
  // editor share the viewport's private stacking scale, so the editor's place
  // above every Card is only real if the Card ladder has a ceiling. The cap
  // leaves room for the lift React Flow adds to the selected node, which is
  // applied after this number is handed over.
  return card.kind === 'group'
    ? -100 + Math.min(90, layer)
    : Math.min(CANVAS_CARD_LAYER_MAX, 100 + layer)
}

/**
 * What the pointer is over on the canvas — the epic's frozen hot/cold pointer
 * contract (C2, #314). C3 (connect), C4 (marquee/pan feel) and C5 (the
 * `connection-badge` variant) CONSUME this type rather than re-deriving what
 * the pointer is over; B4 reads the `card-body`/`card-port` card id through
 * the `hoveredCardId` painter prop. The target lives in the adapter hot path:
 * it is never a scene input, and a pointer-move that does not change the
 * target's identity must not rebuild the scene, the React Flow nodes/edges,
 * the board store, or the label cache. Resolution lives in
 * `pointerTargets.ts` (`canvasPointerTargetAtClientPoint`) — port discs come
 * from `zoomChrome`'s geometry owner, which imports this module, so the
 * resolver cannot live here without a cycle.
 */
export type CanvasPointerTarget =
  | { kind: 'none' }
  | { kind: 'card-body'; cardId: string }
  | { kind: 'card-port'; cardId: string; port: 'source' | 'target' }
  | { kind: 'connection-badge'; connectionId: string }

/**
 * Identity comparison for pointer targets: the hot-path guard that decides
 * whether a pointer-move is a no-op (same identity → refs only) or a
 * transition (may touch React state). Structural, so callers never rely on
 * object identity of freshly resolved targets.
 */
export function samePointerTarget(a: CanvasPointerTarget, b: CanvasPointerTarget): boolean {
  if (a === b) return true
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'none':
      return true
    case 'card-body':
      return a.cardId === (b as Extract<CanvasPointerTarget, { kind: 'card-body' }>).cardId
    case 'card-port': {
      const other = b as Extract<CanvasPointerTarget, { kind: 'card-port' }>
      return a.cardId === other.cardId && a.port === other.port
    }
    case 'connection-badge':
      return a.connectionId === (b as Extract<CanvasPointerTarget, { kind: 'connection-badge' }>).connectionId
  }
}

/**
 * The proximity-lead half of canvas hover (C2, #314): the nearest candidate
 * whose rendered rect is within `leadRadiusPx` SCREEN pixels of the pointer.
 * Mounting the nearest card's proxy before contact is what makes the
 * invisible-proxy handles exist by the time the pointer arrives — DOM
 * mouseenter cannot fire for a card that has no DOM. Distance 0 (pointer
 * inside the rect) ties break like the containment hit test: higher render
 * layer wins, then later candidate order. Returns the winning card WITH its
 * screen distance so one scan serves both the lead radius and the tighter
 * port-search radius (`pointerTargets.ts` filters by distance instead of
 * scanning again).
 */
export function nearestSceneCardAtClientPoint({
  candidates,
  viewport,
  viewportRect,
  clientX,
  clientY,
  leadRadiusPx,
  measuredCardSizeById,
  cardById,
}: {
  candidates: readonly Card[]
  viewport: BoardViewport
  viewportRect: Pick<DOMRect, 'left' | 'top'>
  clientX: number
  clientY: number
  leadRadiusPx: number
  measuredCardSizeById?: (cardId: string) => { width: number; height: number } | undefined
  cardById?: (cardId: string) => Card | undefined
}): { card: Card; distance: number } | null {
  const safeZoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
  const pointX = clientX - viewportRect.left
  const pointY = clientY - viewportRect.top
  let hit: { card: Card; distance: number; layer: number; order: number } | null = null

  for (let order = 0; order < candidates.length; order += 1) {
    const indexedCard = candidates[order]
    const card = cardById?.(indexedCard.id) ?? indexedCard
    const size = resolvedCardSize(card, measuredCardSizeById?.(card.id))
    const x = card.position.x * safeZoom + viewport.x
    const y = card.position.y * safeZoom + viewport.y
    const deltaX = Math.max(x - pointX, 0, pointX - (x + size.width * safeZoom))
    const deltaY = Math.max(y - pointY, 0, pointY - (y + size.height * safeZoom))
    const distance = Math.hypot(deltaX, deltaY)
    if (distance > leadRadiusPx) continue
    const layer = renderLayer(card, order)
    if (
      !hit ||
      distance < hit.distance ||
      (distance === hit.distance && (layer > hit.layer || (layer === hit.layer && order > hit.order)))
    ) {
      hit = { card, distance, layer, order }
    }
  }

  return hit ? { card: hit.card, distance: hit.distance } : null
}

export function hitTestSceneCardAtClientPoint({
  candidates,
  viewport,
  viewportRect,
  clientX,
  clientY,
  measuredCardSizeById,
  cardById,
}: {
  candidates: readonly Card[]
  viewport: BoardViewport
  viewportRect: Pick<DOMRect, 'left' | 'top'>
  clientX: number
  clientY: number
  measuredCardSizeById?: (cardId: string) => { width: number; height: number } | undefined
  cardById?: (cardId: string) => Card | undefined
}): Card | null {
  const safeZoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
  return hitTestSceneCardAtBoardPoint({
    candidates,
    boardX: (clientX - viewportRect.left - viewport.x) / safeZoom,
    boardY: (clientY - viewportRect.top - viewport.y) / safeZoom,
    measuredCardSizeById,
    cardById,
  })
}

// ─── Canvas connection painting plan + hit testing ──────────────────────────
// Overview scenes paint connections on the pointer-transparent canvas, so a
// click on a connector line lands on the React Flow pane. The painter and the
// pane-click hit test must agree on the SAME set of lines — membership, not
// just geometry — or clicks select invisible connections the painter dropped
// past its zoom cap. planPaintedConnections is that single source of truth:
// BoardOverviewLayer draws exactly its output, and the hit test answers
// "which planned line is under this click" over the same output.

/**
 * How many connections the overview canvas paints at a given zoom. Callers
 * that feed planPaintedConnections from renderIndex.query must pass this as
 * `maxConnections` — the painter truncates at the query, before the viewport
 * line filter, so the candidate prefix is part of painted-set membership.
 */
export function connectionLimitForZoom(zoom: number): number {
  if (zoom < 0.12) return 2200
  if (zoom < 0.3) return 700
  return 64
}

/** Half of the one shared 28px whole-wire interaction stroke. */
export const CONNECTION_HIT_TOLERANCE_PX = CONNECTION_INTERACTION_STROKE_WIDTH_PX / 2

export function connectionHitTolerancePx(_zoom: number): number {
  return CONNECTION_HIT_TOLERANCE_PX
}

const CONNECTION_HIT_SAMPLE_SEGMENTS = 24

export type PaintedConnection = {
  connection: Connection
  // Screen-space bezier endpoints: source right-center to target left-center,
  // with the clamped horizontal control-point offset the painter strokes.
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  curve: number
}

export function planPaintedConnections({
  connections,
  suppressedConnectionIds,
  cardById,
  measuredCardSizeById,
  viewport,
  viewportSize,
}: {
  /**
   * The query-truncated candidate set: renderIndex.query(..., {
   * includeConnections: true, maxConnections: connectionLimitForZoom(zoom) }).
   */
  connections: readonly Connection[]
  /** Connections already owned by mounted DOM edges in the same frame. */
  suppressedConnectionIds?: ReadonlySet<string>
  cardById: (cardId: string) => Card | undefined
  /**
   * Measured DOM size for cards mounted as React nodes, when known — the
   * painter draws their connection endpoints from the measured frame, so the
   * plan must too or auto-height cards would shift the line off the painted
   * curve.
   */
  measuredCardSizeById?: (cardId: string) => { width: number; height: number } | undefined
  viewport: BoardViewport
  viewportSize: BoardViewportSize
}): PaintedConnection[] {
  const zoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
  const maxConnections = connectionLimitForZoom(zoom)
  const painted: PaintedConnection[] = []

  for (const connection of connections) {
    if (painted.length >= maxConnections) break
    if (suppressedConnectionIds?.has(connection.id)) continue
    const source = cardById(connection.from.cardId)
    const target = cardById(connection.to.cardId)
    if (!source || !target) continue

    const sourceFrame = connectionEndpointFrame(source, viewport, zoom, measuredCardSizeById)
    const targetFrame = connectionEndpointFrame(target, viewport, zoom, measuredCardSizeById)
    const sourceX = sourceFrame.x + sourceFrame.width
    const sourceY = sourceFrame.y + sourceFrame.height / 2
    const targetX = targetFrame.x
    const targetY = targetFrame.y + targetFrame.height / 2
    if (!lineIntersectsViewport(sourceX, sourceY, targetX, targetY, viewportSize)) continue

    painted.push({
      connection,
      sourceX,
      sourceY,
      targetX,
      targetY,
      curve: Math.max(18, Math.min(140, Math.abs(targetX - sourceX) * 0.36)),
    })
  }

  return painted
}

function lineIntersectsViewport(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  viewportSize: BoardViewportSize,
): boolean {
  const minX = Math.min(sourceX, targetX)
  const maxX = Math.max(sourceX, targetX)
  const minY = Math.min(sourceY, targetY)
  const maxY = Math.max(sourceY, targetY)
  return maxX >= 0 && minX <= viewportSize.width && maxY >= 0 && minY <= viewportSize.height
}

export function hitTestSceneConnectionAtClientPoint({
  connections,
  cardById,
  measuredCardSizeById,
  viewport,
  viewportSize,
  viewportRect,
  clientX,
  clientY,
  tolerancePx,
}: {
  /** Same query-truncated candidate set contract as planPaintedConnections. */
  connections: readonly Connection[]
  cardById: (cardId: string) => Card | undefined
  measuredCardSizeById?: (cardId: string) => { width: number; height: number } | undefined
  viewport: BoardViewport
  viewportSize: BoardViewportSize
  viewportRect: Pick<DOMRect, 'left' | 'top'>
  clientX: number
  clientY: number
  tolerancePx?: number
}): Connection | null {
  const painted = planPaintedConnections({
    connections,
    cardById,
    measuredCardSizeById,
    viewport,
    viewportSize,
  })

  return hitTestPaintedConnectionsAtClientPoint({
    paintedConnections: painted,
    viewport,
    viewportRect,
    clientX,
    clientY,
    tolerancePx,
  })
}

/** Hit-test a captured paint-order buffer without querying or replanning it. */
export function hitTestPaintedConnectionsAtClientPoint({
  paintedConnections,
  viewport,
  viewportRect,
  clientX,
  clientY,
  tolerancePx,
}: {
  paintedConnections: readonly PaintedConnection[]
  viewport: BoardViewport
  viewportRect: Pick<DOMRect, 'left' | 'top'>
  clientX: number
  clientY: number
  tolerancePx?: number
}): Connection | null {
  const zoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
  const tolerance = tolerancePx ?? connectionHitTolerancePx(zoom)
  const pointX = clientX - viewportRect.left
  const pointY = clientY - viewportRect.top

  let hit: { connection: Connection; distance: number } | null = null
  for (const { connection, sourceX, sourceY, targetX, targetY, curve } of paintedConnections) {
    const reach = tolerance + curve
    if (
      pointX < Math.min(sourceX, targetX) - reach ||
      pointX > Math.max(sourceX, targetX) + reach ||
      pointY < Math.min(sourceY, targetY) - tolerance ||
      pointY > Math.max(sourceY, targetY) + tolerance
    ) {
      continue
    }

    const distance = distanceToConnectionCurve({
      pointX,
      pointY,
      sourceX,
      sourceY,
      targetX,
      targetY,
      curve,
    })
    if (distance <= tolerance && (!hit || distance < hit.distance)) {
      hit = { connection, distance }
    }
  }

  return hit?.connection ?? null
}

function connectionEndpointFrame(
  card: Card,
  viewport: BoardViewport,
  zoom: number,
  measuredCardSizeById?: (cardId: string) => { width: number; height: number } | undefined,
) {
  const size = resolvedCardSize(card, measuredCardSizeById?.(card.id))
  return {
    x: card.position.x * zoom + viewport.x,
    y: card.position.y * zoom + viewport.y,
    width: size.width * zoom,
    height: size.height * zoom,
  }
}

function distanceToConnectionCurve({
  pointX,
  pointY,
  sourceX,
  sourceY,
  targetX,
  targetY,
  curve,
}: {
  pointX: number
  pointY: number
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  curve: number
}): number {
  const control1X = sourceX + curve
  const control2X = targetX - curve
  let previousX = sourceX
  let previousY = sourceY
  let best = Number.POSITIVE_INFINITY

  for (let step = 1; step <= CONNECTION_HIT_SAMPLE_SEGMENTS; step += 1) {
    const t = step / CONNECTION_HIT_SAMPLE_SEGMENTS
    const inverse = 1 - t
    const a = inverse * inverse * inverse
    const b = 3 * inverse * inverse * t
    const c = 3 * inverse * t * t
    const d = t * t * t
    const x = a * sourceX + b * control1X + c * control2X + d * targetX
    const y = a * sourceY + b * sourceY + c * targetY + d * targetY
    best = Math.min(best, distanceToSegment(pointX, pointY, previousX, previousY, x, y))
    previousX = x
    previousY = y
  }

  return best
}

function distanceToSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const deltaX = endX - startX
  const deltaY = endY - startY
  const lengthSq = deltaX * deltaX + deltaY * deltaY
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSq))
  const nearestX = startX + t * deltaX
  const nearestY = startY + t * deltaY
  return Math.hypot(pointX - nearestX, pointY - nearestY)
}

export function hitTestSceneCardAtBoardPoint({
  candidates,
  boardX,
  boardY,
  measuredCardSizeById,
  cardById,
}: {
  candidates: readonly Card[]
  boardX: number
  boardY: number
  measuredCardSizeById?: (cardId: string) => { width: number; height: number } | undefined
  cardById?: (cardId: string) => Card | undefined
}): Card | null {
  let hit: { card: Card; layer: number; order: number } | null = null

  for (let order = 0; order < candidates.length; order += 1) {
    const indexedCard = candidates[order]
    const card = cardById?.(indexedCard.id) ?? indexedCard
    const size = resolvedCardSize(card, measuredCardSizeById?.(card.id))
    const inside =
      boardX >= card.position.x &&
      boardX <= card.position.x + size.width &&
      boardY >= card.position.y &&
      boardY <= card.position.y + size.height
    if (!inside) continue
    const layer = renderLayer(card, order)
    if (!hit || layer > hit.layer || (layer === hit.layer && order > hit.order)) {
      hit = { card, layer, order }
    }
  }

  return hit?.card ?? null
}

function computeSummaryForCard(card: Card): CanvasCardSummary {
  boardScenePerfCounters.summaryComputations += 1
  boardScenePerfCounters.summaryCardIds.add(card.id)
  return summaryForCard(card)
}

function computeCardTextWeight(card: Card, outputTextLength: number): number {
  boardScenePerfCounters.weightComputations += 1
  boardScenePerfCounters.weightCardIds.add(card.id)
  return cardTextWeight(card, outputTextLength)
}

function outputTextLengthsByCardId(outputs: readonly Output[]): Map<string, number> {
  const lengths = new Map<string, number>()
  for (const output of outputs) {
    const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
    const chosen = output.versions.find((version) => version.id === chosenId)
    lengths.set(output.resultCardId, chosen?.text.length ?? 0)
  }
  return lengths
}

function cardTextWeight(card: Card, outputTextLength: number): number {
  const ownTextLength = card.blocks.reduce((sum, block) => sum + block.text.length, 0)
  const assetWeight = (card.assets?.length ?? 0) * ASSET_TEXT_WEIGHT
  return ownTextLength + outputTextLength + assetWeight
}

function storedLayer(card: Card, fallback: number): number {
  return typeof card.zIndex === 'number' && Number.isFinite(card.zIndex) ? card.zIndex : fallback
}

function isSupersetOf(container: ReadonlySet<string>, contained: ReadonlySet<string>): boolean {
  if (contained.size > container.size) return false
  for (const id of contained) {
    if (!container.has(id)) return false
  }
  return true
}

function reuseSetForCards(cards: readonly Card[], previous?: ReadonlySet<string>): ReadonlySet<string> {
  if (previous && previous.size === cards.length) {
    let same = true
    for (const card of cards) {
      if (!previous.has(card.id)) {
        same = false
        break
      }
    }
    if (same) return previous
  }
  return cards.length ? new Set(cards.map((card) => card.id)) : EMPTY_IDS
}

function reuseIdSet(ids: ReadonlySet<string>, previous?: ReadonlySet<string>): ReadonlySet<string> {
  if (previous && previous.size === ids.size) {
    for (const id of ids) {
      if (!previous.has(id)) return ids
    }
    return previous
  }
  return ids.size ? ids : EMPTY_IDS
}

function reuseViewport(viewport: BoardViewport, previous?: BoardViewport): BoardViewport {
  return previous && previous.x === viewport.x && previous.y === viewport.y && previous.zoom === viewport.zoom
    ? previous
    : viewport
}

function reuseCardArray<T extends readonly Card[]>(cards: T, previous?: readonly Card[]): T {
  if (previous && previous.length === cards.length && cards.every((card, index) => previous[index] === card)) {
    return previous as T
  }
  return cards
}

function reuseConnectionArray(connections: Connection[], previous?: readonly Connection[]): Connection[] {
  if (
    previous &&
    previous.length === connections.length &&
    connections.every((connection, index) => previous[index] === connection)
  ) {
    return previous as Connection[]
  }
  return connections
}

function reuseMapByEntries<T>(
  next: Map<string, T>,
  previous?: ReadonlyMap<string, T>,
): ReadonlyMap<string, T> {
  if (previous && previous.size === next.size) {
    let same = true
    for (const [key, value] of next) {
      if (previous.get(key) !== value) {
        same = false
        break
      }
    }
    if (same) return previous
  }
  return next
}
