import type { Card, Connection } from '../graph/types'
import { cardFootprint } from '../graph/cardOrganization'

export type BoardViewport = {
  x: number
  y: number
  zoom: number
}

export type BoardViewportSize = {
  width: number
  height: number
}

export type BoardRenderIndex = {
  query: (viewport: BoardViewport, viewportSize: BoardViewportSize, marginPx?: number, options?: BoardRenderQueryOptions) => {
    cards: Card[]
    connections: Connection[]
    // True (untruncated) count of unique window-touching connection
    // candidates — `connections` may be truncated at `maxConnections`, and
    // the difference is the density cap's counted omission (#309).
    connectionCandidateCount: number
  }
  /**
   * Pointer-hot connection prefix for whole-wire hit testing. Membership and
   * order exactly match `query(..., { maxConnections }).connections`, but the
   * adjacency walk stops as soon as the required prefix is complete instead
   * of continuing to compute cold omission diagnostics. Because one
   * connection occupies at most two endpoint buckets, a positive cap visits
   * at most `2 * maxConnections - 1` adjacency candidates.
   */
  queryConnectionsBounded: (
    viewport: BoardViewport,
    viewportSize: BoardViewportSize,
    marginPx: number,
    maxConnections: number,
  ) => Connection[]
  cardById: (cardId: string) => Card | undefined
  /** Stable graph order captured by the incremental spatial index. */
  cardOrder: (cardId: string) => number | undefined
  connectionsForCards: (cards: readonly Card[]) => Connection[]
  connectionPlanStats: () => BoardConnectionPlanStats
  /**
   * Rank epoch (#311, amendment 16): a globally-monotonic stamp that moves
   * when card MEMBERSHIP or any card's SIZE or KIND changes — and stays put
   * across position-only commits (drags) and content-only reference swaps.
   * Computed during visits the index already performs (full rebuilds visit
   * every card; incremental updates pointer-check every slot and
   * field-compare exactly the patched cards) — no additional scan exists
   * anywhere. The label layer's sort cache keys on this so a drag frame
   * costs it O(1). A full rebuild keeps the previous epoch when its
   * order-insensitive rank fingerprint is unchanged, so same-card reorders
   * and connections-only changes do not advance it either.
   */
  rankEpoch: () => number
}

export type BoardRenderQueryOptions = {
  includeConnections?: boolean
  maxConnections?: number
}

export type BoardConnectionPlanStats = {
  totalConnections: number
  spatialCardCandidatesVisited: number
  adjacencyBucketsRead: number
  adjacencyConnectionCandidatesVisited: number
}

const DEFAULT_MARGIN_PX = 700
const GRID_SIZE = 900
export const OVERVIEW_CARD_LIMIT = 80
const OVERVIEW_SAMPLE_CELL_PX = 56

type CardBounds = {
  card: Card
  minX: number
  maxX: number
  minY: number
  maxY: number
  order: number
}

type OverviewCandidate = {
  card: Card
  order: number
  distanceSq: number
}

type RenderIndexState = {
  cards: Card[]
  connections: Connection[]
  boundsById: Map<string, CardBounds>
  cells: Map<string, CardBounds[]>
  connectionsByCardId: Map<string, Connection[]>
  rankEpoch: number
  // Order-insensitive fingerprint of the rank-relevant inputs (membership +
  // size + kind): commutative sum over hash1 and xor over hash2, accumulated
  // during the visits the builder already performs. The two components use
  // INDEPENDENT hash functions (different FNV seed, plus an avalanche mixer
  // on the second) — aggregating one hash both ways is worthless, since a
  // single per-card collision defeats sum and xor together (review round 6
  // constructed exactly that pair; it is pinned as a regression test). Lets
  // a full rebuild whose rank inputs did not change (same-card reorder,
  // connections-only change) KEEP the previous epoch instead of advancing
  // it conservatively.
  rankFingerprintSum: number
  rankFingerprintXor: number
}

// Globally monotonic so a freshly built index can never repeat an epoch an
// older index handed out (harnesses build one index per content version; a
// per-state counter would restart at 1 and alias across versions).
let nextRankEpoch = 1

// The rank-relevant card fields only — position deliberately excluded, so a
// drag never moves the fingerprint. INJECTIVE over the size domain: an
// absent size gets a non-numeric token, and every explicit pair serializes
// as its numbers (clamped or not — setCardSize accepts unclamped values), so
// explicit {-1,-1} can never alias 'no size' (review round 7: the old
// `?? -1` default made reorder + resize-to-(-1,-1) preserve the epoch while
// the label area really changed).
function cardRankHashInput(card: Card): string {
  const sizePart = card.size ? `${card.size.width}|${card.size.height}` : 'none'
  return `${card.id}|${card.kind}|${sizePart}`
}

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0
  for (let at = 0; at < input.length; at += 1) {
    hash ^= input.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

// murmur3's 32-bit finalizer: full avalanche over the second component.
function mix32(value: number): number {
  let hash = value >>> 0
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b) >>> 0
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0
  hash ^= hash >>> 16
  return hash >>> 0
}

// Component 1: FNV-1a at the standard offset basis, aggregated by SUM.
function cardRankHash1(card: Card): number {
  return fnv1a(cardRankHashInput(card), 0x811c9dc5)
}

// Component 2: FNV-1a at a DIFFERENT seed pushed through the murmur3
// finalizer, aggregated by XOR. Independent of component 1 by construction:
// a pair colliding under hash1 must ALSO collide under this unrelated
// function for the fingerprint to miss a change.
function cardRankHash2(card: Card): number {
  return mix32(fnv1a(cardRankHashInput(card), 0x7f4a7c15))
}

/** Test-only probe: both fingerprint components for one card. */
export function cardRankHashesForTests(card: Card): [number, number] {
  return [cardRankHash1(card), cardRankHash2(card)]
}

function buildRenderIndexState(cards: Card[], connections: Connection[]): RenderIndexState {
  const boundsById = new Map<string, CardBounds>()
  const cells = new Map<string, CardBounds[]>()
  const connectionsByCardId = new Map<string, Connection[]>()
  let rankFingerprintSum = 0
  let rankFingerprintXor = 0

  cards.forEach((card, order) => {
    const bounds = cardBounds(card, order)
    boundsById.set(card.id, bounds)
    insertBoundsIntoCells(cells, bounds)
    rankFingerprintSum = (rankFingerprintSum + cardRankHash1(card)) >>> 0
    rankFingerprintXor = (rankFingerprintXor ^ cardRankHash2(card)) >>> 0
  })

  for (const connection of connections) {
    pushConnection(connectionsByCardId, connection.from.cardId, connection)
    pushConnection(connectionsByCardId, connection.to.cardId, connection)
  }

  nextRankEpoch += 1
  return {
    cards,
    connections,
    boundsById,
    cells,
    connectionsByCardId,
    rankEpoch: nextRankEpoch,
    rankFingerprintSum,
    rankFingerprintXor,
  }
}

function visibleCardsForViewport(
  state: RenderIndexState,
  viewport: BoardViewport,
  viewportSize: BoardViewportSize,
  marginPx: number,
  countSpatialCardCandidate?: () => void,
): Card[] {
  const windowBounds = viewportBounds(viewport, viewportSize, marginPx)
  const candidateCards = new Map<string, CardBounds>()

  for (let x = cell(windowBounds.minX); x <= cell(windowBounds.maxX); x += 1) {
    for (let y = cell(windowBounds.minY); y <= cell(windowBounds.maxY); y += 1) {
      for (const bounds of state.cells.get(cellKey(x, y)) ?? []) {
        countSpatialCardCandidate?.()
        if (intersects(bounds, windowBounds)) candidateCards.set(bounds.card.id, bounds)
      }
    }
  }

  return [...candidateCards.values()]
    .sort((a, b) => a.order - b.order)
    .map((bounds) => bounds.card)
}

function renderIndexFromState(holder: { state: RenderIndexState }): BoardRenderIndex {
  let spatialCardCandidatesVisited = 0
  let adjacencyBucketsRead = 0
  let adjacencyConnectionCandidatesVisited = 0

  return {
    query(viewport, viewportSize, marginPx = DEFAULT_MARGIN_PX, options = {}) {
      const visibleCards = visibleCardsForViewport(
        holder.state,
        viewport,
        viewportSize,
        marginPx,
        () => {
          spatialCardCandidatesVisited += 1
        },
      )

      if (options.includeConnections === false) {
        return { cards: visibleCards, connections: [], connectionCandidateCount: 0 }
      }
      const { connections, candidateCount } = touchingConnectionsForCards(
        visibleCards,
        holder.state.connectionsByCardId,
        {
          maxConnections: options.maxConnections,
          countConnectionCandidate: () => {
            adjacencyConnectionCandidatesVisited += 1
          },
          countBucketRead: () => {
            adjacencyBucketsRead += 1
          },
        },
      )
      return { cards: visibleCards, connections, connectionCandidateCount: candidateCount }
    },
    queryConnectionsBounded(viewport, viewportSize, marginPx, maxConnections) {
      const limit = Number.isFinite(maxConnections)
        ? Math.max(0, Math.floor(maxConnections))
        : 0
      if (limit === 0) return []
      const visibleCards = visibleCardsForViewport(
        holder.state,
        viewport,
        viewportSize,
        marginPx,
        () => {
          spatialCardCandidatesVisited += 1
        },
      )
      return touchingConnectionsForCards(visibleCards, holder.state.connectionsByCardId, {
        maxConnections: limit,
        countAllCandidates: false,
        countConnectionCandidate: () => {
          adjacencyConnectionCandidatesVisited += 1
        },
        countBucketRead: () => {
          adjacencyBucketsRead += 1
        },
      }).connections
    },
    cardById(cardId) {
      return holder.state.boundsById.get(cardId)?.card
    },
    cardOrder(cardId) {
      return holder.state.boundsById.get(cardId)?.order
    },
    connectionsForCards(cards) {
      return enclosedConnectionsForCards(cards, holder.state.connectionsByCardId, {
        countConnectionCandidate: () => {
          adjacencyConnectionCandidatesVisited += 1
        },
        countBucketRead: () => {
          adjacencyBucketsRead += 1
        },
      })
    },
    rankEpoch: () => holder.state.rankEpoch,
    connectionPlanStats() {
      return {
        totalConnections: holder.state.connections.length,
        spatialCardCandidatesVisited,
        adjacencyBucketsRead,
        adjacencyConnectionCandidatesVisited,
      }
    },
  }
}

export function createBoardRenderIndex(cards: Card[], connections: Connection[]): BoardRenderIndex {
  return renderIndexFromState({ state: buildRenderIndexState(cards, connections) })
}

export type BoardRenderIndexCacheStats = {
  gets: number
  identityHits: number
  incrementalUpdates: number
  cardsPatched: number
  boundsUpdated: number
  fullRebuilds: {
    initial: number
    cardStructure: number
    connections: number
  }
}

// Incremental spatial index (Tier 2 of the index design in
// docs/foundations/context-layer.md). The change record is DERIVED, not
// declared: store commits replace changed cards in place (array positions are
// stable for pure updates), so one pointer-identity pass over the arrays finds
// exactly what changed — it cannot desync from reality the way a mis-declared
// change could. Grid work is then O(changed cards), and only cards whose
// position/size/kind actually moved touch the grid (field guard); content-only
// edits just swap the card reference so queries return fresh objects.
// Anything the diff cannot prove safe (length change, reorder, connection
// change) falls back to a counted full rebuild — a slow path here is a
// number, never a silent behavior change.
export function createBoardRenderIndexCache(): {
  get: (cards: Card[], connections: Connection[]) => BoardRenderIndex
  stats: () => BoardRenderIndexCacheStats
} {
  let holder: { state: RenderIndexState } | undefined
  let index: BoardRenderIndex | undefined
  const stats: BoardRenderIndexCacheStats = {
    gets: 0,
    identityHits: 0,
    incrementalUpdates: 0,
    cardsPatched: 0,
    boundsUpdated: 0,
    fullRebuilds: { initial: 0, cardStructure: 0, connections: 0 },
  }

  const rebuild = (cards: Card[], connections: Connection[], cause: keyof BoardRenderIndexCacheStats['fullRebuilds']) => {
    stats.fullRebuilds[cause] += 1
    const previousState = holder?.state
    const nextState = buildRenderIndexState(cards, connections)
    // A full rebuild whose ORDER-INSENSITIVE rank fingerprint matches the
    // previous state changed nothing rank-relevant (same-card reorder,
    // connections-only change): keep the previous epoch so the label sort
    // is not rebuilt for free.
    if (
      previousState &&
      previousState.rankFingerprintSum === nextState.rankFingerprintSum &&
      previousState.rankFingerprintXor === nextState.rankFingerprintXor
    ) {
      nextState.rankEpoch = previousState.rankEpoch
    }
    if (holder) {
      holder.state = nextState
    } else {
      holder = { state: nextState }
    }
    // A fresh index object per content change keeps React memo semantics
    // honest: same object = same answers, new object = recompute.
    index = renderIndexFromState(holder)
    return index
  }

  return {
    get(cards, connections) {
      stats.gets += 1
      if (!holder || !index) return rebuild(cards, connections, 'initial')

      const previous = holder.state
      if (previous.cards === cards && previous.connections === connections) {
        stats.identityHits += 1
        return index
      }
      if (previous.connections !== connections) return rebuild(cards, connections, 'connections')
      if (previous.cards.length !== cards.length) return rebuild(cards, connections, 'cardStructure')

      // Pointer-diff: pure in-place updates keep every card at its array
      // position, so any id misalignment means adds/removes/reorders.
      const patches: { previousBounds: CardBounds; next: Card }[] = []
      for (let i = 0; i < cards.length; i += 1) {
        const before = previous.cards[i]
        const after = cards[i]
        if (before === after) continue
        if (before.id !== after.id) return rebuild(cards, connections, 'cardStructure')
        const previousBounds = previous.boundsById.get(after.id)
        if (!previousBounds) return rebuild(cards, connections, 'cardStructure')
        patches.push({ previousBounds, next: after })
      }

      let rankInputsChanged = false
      for (const { previousBounds, next } of patches) {
        // Rank-epoch inputs (#311, amendment 16): size and kind, checked on
        // the already-collected patches only — position is deliberately NOT
        // an input, so a drag commit leaves the epoch (and the label sort)
        // untouched. Membership changes take the full-rebuild path above.
        // The fingerprint is maintained incrementally (sum/xor are
        // commutative) so a later full rebuild compares against truth.
        const before = previousBounds.card
        if (
          before.kind !== next.kind ||
          before.size?.width !== next.size?.width ||
          before.size?.height !== next.size?.height
        ) {
          rankInputsChanged = true
          previous.rankFingerprintSum =
            (previous.rankFingerprintSum - cardRankHash1(before) + cardRankHash1(next)) >>> 0
          previous.rankFingerprintXor =
            (previous.rankFingerprintXor ^ cardRankHash2(before) ^ cardRankHash2(next)) >>> 0
        }
        if (boundsUnchanged(before, next)) {
          // Spatially irrelevant edit (text, group membership, intent…):
          // refresh the reference so queries return the current card.
          previousBounds.card = next
          continue
        }
        removeBoundsFromCells(previous.cells, previousBounds)
        const nextBounds = cardBounds(next, previousBounds.order)
        previous.boundsById.set(next.id, nextBounds)
        insertBoundsIntoCells(previous.cells, nextBounds)
        stats.boundsUpdated += 1
      }
      if (rankInputsChanged) {
        nextRankEpoch += 1
        previous.rankEpoch = nextRankEpoch
      }

      previous.cards = cards
      stats.incrementalUpdates += 1
      stats.cardsPatched += patches.length
      index = renderIndexFromState(holder)
      return index
    },
    stats() {
      return {
        ...stats,
        fullRebuilds: { ...stats.fullRebuilds },
      }
    },
  }
}

function boundsUnchanged(before: Card, after: Card): boolean {
  return (
    before.position.x === after.position.x &&
    before.position.y === after.position.y &&
    before.size?.width === after.size?.width &&
    before.size?.height === after.size?.height &&
    before.kind === after.kind
  )
}

function insertBoundsIntoCells(cells: Map<string, CardBounds[]>, bounds: CardBounds): void {
  for (let x = cell(bounds.minX); x <= cell(bounds.maxX); x += 1) {
    for (let y = cell(bounds.minY); y <= cell(bounds.maxY); y += 1) {
      const key = cellKey(x, y)
      const bucket = cells.get(key)
      if (bucket) bucket.push(bounds)
      else cells.set(key, [bounds])
    }
  }
}

function removeBoundsFromCells(cells: Map<string, CardBounds[]>, bounds: CardBounds): void {
  for (let x = cell(bounds.minX); x <= cell(bounds.maxX); x += 1) {
    for (let y = cell(bounds.minY); y <= cell(bounds.maxY); y += 1) {
      const key = cellKey(x, y)
      const bucket = cells.get(key)
      if (!bucket) continue
      const at = bucket.indexOf(bounds)
      if (at !== -1) bucket.splice(at, 1)
      if (bucket.length === 0) cells.delete(key)
    }
  }
}

// Zoom-out stops when the whole board fits comfortably on screen (with room
// to spare), instead of at a fixed floor unrelated to the board's size. The
// fraction leaves breathing room around a fitted board. The floor only ever
// RAISES the old fixed 0.05 minimum — canvas LOD (connection badges, the far
// zoom band) is tuned for zoom >= 0.05, so gigantic boards keep the old
// floor rather than zooming out beyond it.
export const ZOOM_FLOOR_FIT_FRACTION = 0.5
export const ZOOM_FLOOR_MIN = 0.05
export const ZOOM_FLOOR_MAX = 0.5

export function contentAwareMinZoom(cards: readonly Card[], viewportSize: BoardViewportSize): number {
  if (!cards.length) return ZOOM_FLOOR_MAX
  const viewportWidth = Number.isFinite(viewportSize.width) ? Math.max(1, viewportSize.width) : 1
  const viewportHeight = Number.isFinite(viewportSize.height) ? Math.max(1, viewportSize.height) : 1

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

  const boardWidth = Math.max(1, maxX - minX)
  const boardHeight = Math.max(1, maxY - minY)
  const fitZoom = Math.min(viewportWidth / boardWidth, viewportHeight / boardHeight)
  const floor = fitZoom * ZOOM_FLOOR_FIT_FRACTION
  return Math.min(ZOOM_FLOOR_MAX, Math.max(ZOOM_FLOOR_MIN, floor))
}

export function renderedCardSize(card: Card): { width: number; height: number } {
  return cardFootprint(card)
}

export function resolvedCardSize(
  card: Card,
  measuredSize?: { width: number; height: number },
): { width: number; height: number } {
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

export function limitCardsForOverview({
  cards,
  viewport,
  viewportSize,
  maxCards = OVERVIEW_CARD_LIMIT,
  preserveCardIds,
}: {
  cards: Card[]
  viewport: BoardViewport
  viewportSize: BoardViewportSize
  maxCards?: number
  preserveCardIds?: ReadonlySet<string>
}): Card[] {
  if (cards.length <= maxCards) return cards

  const preserved = new Set<string>()
  const chosen = new Set<string>()
  if (preserveCardIds?.size) {
    const cardIds = new Set(cards.map((card) => card.id))
    for (const cardId of preserveCardIds) {
      if (cardIds.has(cardId)) {
        preserved.add(cardId)
        chosen.add(cardId)
      }
    }
  }

  const safeZoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
  const centerX = viewportSize.width / 2
  const centerY = viewportSize.height / 2
  const bucketCandidates = new Map<string, OverviewCandidate>()
  const fallbackCandidates: OverviewCandidate[] = []
  const availableSlots = Math.max(0, maxCards - chosen.size)

  for (let order = 0; order < cards.length; order += 1) {
    const card = cards[order]
    if (chosen.has(card.id)) continue
    const size = renderedCardSize(card)
    const screenX = (card.position.x + size.width / 2) * safeZoom + viewport.x
    const screenY = (card.position.y + size.height / 2) * safeZoom + viewport.y
    const candidate = {
      card,
      order,
      distanceSq: (screenX - centerX) ** 2 + (screenY - centerY) ** 2,
    }
    const bucket = `${Math.floor(screenX / OVERVIEW_SAMPLE_CELL_PX)}:${Math.floor(screenY / OVERVIEW_SAMPLE_CELL_PX)}`
    const currentBucketCandidate = bucketCandidates.get(bucket)
    if (!currentBucketCandidate || compareOverviewCandidates(candidate, currentBucketCandidate) < 0) {
      bucketCandidates.set(bucket, candidate)
    }
    insertBoundedOverviewCandidate(fallbackCandidates, candidate, availableSlots)
  }

  const sampledCandidates: OverviewCandidate[] = []
  for (const candidate of bucketCandidates.values()) {
    insertBoundedOverviewCandidate(sampledCandidates, candidate, availableSlots)
  }

  for (const candidate of sampledCandidates) chosen.add(candidate.card.id)
  if (chosen.size < maxCards) {
    for (const candidate of fallbackCandidates) {
      if (chosen.size >= maxCards) break
      chosen.add(candidate.card.id)
    }
  }

  for (const cardId of preserved) chosen.add(cardId)
  return cards.filter((card) => chosen.has(card.id))
}

export function limitCardsForDetail({
  cards,
  viewport,
  viewportSize,
  maxCards,
  maxWeight,
  preserveCardIds,
  cardWeight = () => 1,
}: {
  cards: Card[]
  viewport: BoardViewport
  viewportSize: BoardViewportSize
  maxCards: number
  maxWeight: number
  preserveCardIds?: ReadonlySet<string>
  cardWeight?: (card: Card) => number
}): Card[] {
  if (cards.length <= maxCards) {
    const totalWeight = cards.reduce((sum, card) => sum + cardWeight(card), 0)
    if (totalWeight <= maxWeight) return cards
  }

  const chosen = new Set<string>()
  let weight = 0
  const cardIds = new Set(cards.map((card) => card.id))
  if (preserveCardIds?.size) {
    for (const cardId of preserveCardIds) {
      if (!cardIds.has(cardId)) continue
      const card = cards.find((candidate) => candidate.id === cardId)
      if (!card) continue
      chosen.add(card.id)
      weight += cardWeight(card)
    }
  }

  const safeZoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
  const centerX = viewportSize.width / 2
  const centerY = viewportSize.height / 2
  const availableSlots = Math.max(0, maxCards - chosen.size)
  const candidateLimit = Math.max(availableSlots, Math.min(cards.length, availableSlots * 4))
  const candidates: OverviewCandidate[] = []

  for (let order = 0; order < cards.length; order += 1) {
    const card = cards[order]
    if (chosen.has(card.id)) continue
    const size = renderedCardSize(card)
    const screenX = (card.position.x + size.width / 2) * safeZoom + viewport.x
    const screenY = (card.position.y + size.height / 2) * safeZoom + viewport.y
    insertBoundedOverviewCandidate(candidates, {
      card,
      order,
      distanceSq: (screenX - centerX) ** 2 + (screenY - centerY) ** 2,
    }, candidateLimit)
  }

  for (const candidate of candidates) {
    if (chosen.size >= maxCards) break
    const candidateWeight = cardWeight(candidate.card)
    if (weight + candidateWeight > maxWeight && chosen.size > 0) continue
    chosen.add(candidate.card.id)
    weight += candidateWeight
  }

  return cards.filter((card) => chosen.has(card.id))
}

function cardBounds(card: Card, order: number): CardBounds {
  const size = renderedCardSize(card)
  return {
    card,
    minX: card.position.x,
    maxX: card.position.x + size.width,
    minY: card.position.y,
    maxY: card.position.y + size.height,
    order,
  }
}

function viewportBounds(viewport: BoardViewport, viewportSize: BoardViewportSize, marginPx: number) {
  const safeZoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
  const margin = marginPx / safeZoom
  return {
    minX: (0 - viewport.x) / safeZoom - margin,
    maxX: (viewportSize.width - viewport.x) / safeZoom + margin,
    minY: (0 - viewport.y) / safeZoom - margin,
    maxY: (viewportSize.height - viewport.y) / safeZoom + margin,
  }
}

function intersects(a: Pick<CardBounds, 'minX' | 'maxX' | 'minY' | 'maxY'>, b: ReturnType<typeof viewportBounds>) {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY
}

function cell(value: number): number {
  return Math.floor(value / GRID_SIZE)
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`
}

function pushConnection(map: Map<string, Connection[]>, cardId: string, connection: Connection) {
  const bucket = map.get(cardId)
  if (bucket) bucket.push(connection)
  else map.set(cardId, [connection])
}

function insertBoundedOverviewCandidate(
  candidates: OverviewCandidate[],
  candidate: OverviewCandidate,
  maxCandidates: number,
) {
  if (maxCandidates <= 0) return

  let insertAt = candidates.length
  while (insertAt > 0 && compareOverviewCandidates(candidate, candidates[insertAt - 1]) < 0) {
    insertAt -= 1
  }

  if (insertAt >= maxCandidates) return
  candidates.splice(insertAt, 0, candidate)
  if (candidates.length > maxCandidates) candidates.length = maxCandidates
}

function compareOverviewCandidates(a: OverviewCandidate, b: OverviewCandidate): number {
  return a.distanceSq - b.distanceSq || a.order - b.order
}

function enclosedConnectionsForCards(
  cards: readonly Card[],
  connectionsByCardId: Map<string, Connection[]>,
  instrumentation: ConnectionPlanInstrumentation = {},
): Connection[] {
  const visibleCardIds = new Set(cards.map((card) => card.id))
  const visibleConnections = new Map<string, Connection>()

  for (const cardId of visibleCardIds) {
    instrumentation.countBucketRead?.()
    for (const connection of connectionsByCardId.get(cardId) ?? []) {
      instrumentation.countConnectionCandidate?.()
      if (visibleCardIds.has(connection.from.cardId) && visibleCardIds.has(connection.to.cardId)) {
        visibleConnections.set(connection.id, connection)
      }
    }
  }

  return [...visibleConnections.values()]
}

// Returns the truncated candidate list (unchanged membership: the first
// `maxConnections` unique connections in visit order) PLUS the true untruncated
// candidate count, so a density cap is a counted omission, never a silent one
// (#309). Counting continues past the cap without materializing — the walk no
// longer early-returns, which only costs on views dense enough to cap.
function touchingConnectionsForCards(
  cards: readonly Card[],
  connectionsByCardId: Map<string, Connection[]>,
  {
    maxConnections = Number.POSITIVE_INFINITY,
    countAllCandidates = true,
    countBucketRead,
    countConnectionCandidate,
  }: ConnectionPlanInstrumentation & {
    maxConnections?: number
    countAllCandidates?: boolean
  } = {},
): { connections: Connection[]; candidateCount: number } {
  const seenConnectionIds = new Set<string>()
  const connections: Connection[] = []

  for (const card of cards) {
    countBucketRead?.()
    for (const connection of connectionsByCardId.get(card.id) ?? []) {
      countConnectionCandidate?.()
      if (seenConnectionIds.has(connection.id)) continue
      seenConnectionIds.add(connection.id)
      if (connections.length < maxConnections) {
        connections.push(connection)
        if (!countAllCandidates && connections.length >= maxConnections) {
          return { connections, candidateCount: connections.length }
        }
      }
    }
  }

  return { connections, candidateCount: seenConnectionIds.size }
}

type ConnectionPlanInstrumentation = {
  countBucketRead?: () => void
  countConnectionCandidate?: () => void
}
