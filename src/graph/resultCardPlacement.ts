import type { Card } from './types'
import { defaultCardFootprint } from './cardOrganization'

// Result placement stays in graph space so result routing never depends on the
// canvas adapter. These match the canvas' default visual card dimensions.
const RESULT_FOOTPRINT = defaultCardFootprint('result')
const RESULT_WIDTH = RESULT_FOOTPRINT.width
const RESULT_HEIGHT = RESULT_FOOTPRINT.height
const CLEARANCE = 30
const DEFAULT_RESULT_FLOW_GAP = CLEARANCE * 3
const MAX_LOCAL_RINGS = 8

type Rect = { x: number; y: number; width: number; height: number }
type GridPoint = { column: number; row: number }

export type ResultPlacementContext = {
  viewport?: Rect
  measuredCardSizesById?: ReadonlyMap<string, { width: number; height: number }>
}

function cardRect(
  card: Card,
  measuredCardSizesById?: ReadonlyMap<string, { width: number; height: number }>,
): Rect {
  const measured = measuredCardSizesById?.get(card.id)
  const fallback = defaultCardFootprint(card.kind)
  return {
    x: card.position.x,
    y: card.position.y,
    width: card.size?.width ?? measured?.width ?? fallback.width,
    height: card.size?.height ?? measured?.height ?? fallback.height,
  }
}

function conflictsWithClearance(candidate: Rect, occupied: Rect) {
  return (
    candidate.x < occupied.x + occupied.width + CLEARANCE &&
    candidate.x + candidate.width + CLEARANCE > occupied.x &&
    candidate.y < occupied.y + occupied.height + CLEARANCE &&
    candidate.y + candidate.height + CLEARANCE > occupied.y
  )
}

function candidatePosition(source: Rect, { column, row }: GridPoint) {
  const x =
    column > 0
      ? source.x + source.width + DEFAULT_RESULT_FLOW_GAP + (column - 1) * (RESULT_WIDTH + CLEARANCE)
      : column < 0
        ? source.x - RESULT_WIDTH - CLEARANCE + (column + 1) * (RESULT_WIDTH + CLEARANCE)
        : source.x
  const y =
    row > 0
      ? source.y + source.height + CLEARANCE + (row - 1) * (RESULT_HEIGHT + CLEARANCE)
      : row < 0
        ? source.y - RESULT_HEIGHT - CLEARANCE + (row + 1) * (RESULT_HEIGHT + CLEARANCE)
        : source.y
  return { x, y }
}

function candidateDistance(source: Rect, position: { x: number; y: number }) {
  const x = position.x + RESULT_WIDTH / 2 - (source.x + source.width / 2)
  const y = position.y + RESULT_HEIGHT / 2 - (source.y + source.height / 2)
  return x * x + y * y
}

function directionPriority({ column, row }: GridPoint) {
  if (column > 0 && row === 0) return 0
  if (column === 0 && row > 0) return 1
  if (column < 0 && row === 0) return 2
  if (column === 0 && row < 0) return 3
  return 4
}

const thoughtFlowPriority = directionPriority

function insideViewport(position: { x: number; y: number }, viewport: Rect) {
  return (
    position.x >= viewport.x &&
    position.y >= viewport.y &&
    position.x + RESULT_WIDTH <= viewport.x + viewport.width &&
    position.y + RESULT_HEIGHT <= viewport.y + viewport.height
  )
}

function viewportRingLimit(source: Rect, viewport: Rect) {
  const horizontalReach = Math.max(
    Math.abs(source.x - viewport.x),
    Math.abs(source.x - (viewport.x + viewport.width)),
  )
  const verticalReach = Math.max(
    Math.abs(source.y - viewport.y),
    Math.abs(source.y - (viewport.y + viewport.height)),
  )
  return Math.min(
    64,
    Math.max(
      1,
      Math.ceil(horizontalReach / (RESULT_WIDTH + CLEARANCE)),
      Math.ceil(verticalReach / (RESULT_HEIGHT + CLEARANCE)),
    ) + 2,
  )
}

function ringCandidates(source: Rect, ring: number) {
  const candidates: Array<GridPoint & { position: { x: number; y: number }; distance: number }> = []
  for (let column = -ring; column <= ring; column += 1) {
    for (let row = -ring; row <= ring; row += 1) {
      if (Math.max(Math.abs(column), Math.abs(row)) !== ring) continue
      const point = { column, row }
      const position = candidatePosition(source, point)
      candidates.push({ ...point, position, distance: candidateDistance(source, position) })
    }
  }
  return candidates.sort(
    (a, b) =>
      directionPriority(a) - directionPriority(b) ||
      a.distance - b.distance ||
      a.row - b.row ||
      a.column - b.column,
  )
}

/**
 * Finds a nearby, buffered Result-card position. The bounded local search is
 * deterministic and evaluates only a small neighbourhood; a right-of-board
 * fallback guarantees progress even on an unusually dense board.
 */
export function findResultCardPosition(
  cards: readonly Card[],
  source: Card,
  context: ResultPlacementContext = {},
) {
  const sourceRect = cardRect(source, context.measuredCardSizesById)
  const occupied = cards.map((card) => cardRect(card, context.measuredCardSizesById))
  const preferredRight = candidatePosition(sourceRect, { column: 1, row: 0 })
  const preferredRightRect = {
    ...preferredRight,
    width: RESULT_WIDTH,
    height: RESULT_HEIGHT,
  }
  if (!occupied.some((existing) => conflictsWithClearance(preferredRightRect, existing))) {
    return preferredRight
  }
  if (context.viewport) {
    const visibleCandidates = []
    const ringLimit = viewportRingLimit(sourceRect, context.viewport)
    for (let ring = 1; ring <= ringLimit; ring += 1) {
      visibleCandidates.push(
        ...ringCandidates(sourceRect, ring).filter((candidate) =>
          insideViewport(candidate.position, context.viewport!),
        ),
      )
    }
    visibleCandidates.sort(
      (a, b) =>
        Math.max(Math.abs(a.column), Math.abs(a.row)) -
          Math.max(Math.abs(b.column), Math.abs(b.row)) ||
        thoughtFlowPriority(a) - thoughtFlowPriority(b) ||
        a.distance - b.distance ||
        a.row - b.row ||
        a.column - b.column,
    )
    for (const candidate of visibleCandidates) {
      const rect = { ...candidate.position, width: RESULT_WIDTH, height: RESULT_HEIGHT }
      if (!occupied.some((existing) => conflictsWithClearance(rect, existing))) return candidate.position
    }
  }
  for (let ring = 1; ring <= MAX_LOCAL_RINGS; ring += 1) {
    for (const candidate of ringCandidates(sourceRect, ring)) {
      const rect = { ...candidate.position, width: RESULT_WIDTH, height: RESULT_HEIGHT }
      if (!occupied.some((existing) => conflictsWithClearance(rect, existing))) return candidate.position
    }
  }

  const rightmost = occupied.reduce(
    (maximum, rect) => Math.max(maximum, rect.x + rect.width),
    sourceRect.x + sourceRect.width,
  )
  return { x: rightmost + CLEARANCE, y: sourceRect.y }
}
