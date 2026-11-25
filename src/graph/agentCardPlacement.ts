import type { Card, CardKind, Connection } from './types'
import { cardFootprint, defaultCardFootprint } from './cardOrganization'

const PLACEMENT_CLEARANCE = 30
const DEFAULT_MAX_RINGS = 8
const DEFAULT_MAX_ABSOLUTE_COORDINATE = 1_000_000

export type AgentPlaceableCardKind = Exclude<CardKind, 'mod' | 'result'>

export type AgentCardPlacementResult =
  | Readonly<{ ok: true; position: Readonly<{ x: number; y: number }> }>
  | Readonly<{ ok: false; reason: 'anchor-required' | 'no-bounded-space' }>
  | Readonly<{ ok: false; reason: 'anchor-not-found'; anchorCardId: string }>

export type AgentCardPlacementInput = Readonly<{
  cards: readonly Card[]
  connections: readonly Connection[]
  anchorCardIds: readonly string[]
  kind: AgentPlaceableCardKind
  maxAbsoluteCoordinate?: number
  maxRings?: number
}>

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>
type GridPoint = Readonly<{ column: number; row: number }>

/**
 * Finds one deterministic, non-overlapping position beside the connected
 * cluster containing the requested anchors. The bounded search is graph-core:
 * callers pin it to their expected Profile revision before applying a plan.
 */
export function findAgentCardPlacement(
  input: AgentCardPlacementInput,
): AgentCardPlacementResult {
  const maxAbsoluteCoordinate = input.maxAbsoluteCoordinate
    ?? DEFAULT_MAX_ABSOLUTE_COORDINATE
  const maxRings = input.maxRings ?? DEFAULT_MAX_RINGS
  if (!positiveFinite(maxAbsoluteCoordinate)
    || !positiveSafeInteger(maxRings)) {
    return Object.freeze({ ok: false, reason: 'no-bounded-space' })
  }

  const cardsById = new Map(input.cards.map((card) => [card.id, card] as const))
  const anchorCardIds = [...new Set(input.anchorCardIds)].sort(compareStrings)
  if (anchorCardIds.length === 0) {
    return Object.freeze({ ok: false, reason: 'anchor-required' })
  }
  for (const anchorCardId of anchorCardIds) {
    if (!cardsById.has(anchorCardId)) {
      return Object.freeze({ ok: false, reason: 'anchor-not-found', anchorCardId })
    }
  }

  const clusterIds = connectedClusterIds(
    cardsById,
    input.connections,
    anchorCardIds,
  )
  const clusterCards = [...clusterIds]
    .sort(compareStrings)
    .map((id) => cardsById.get(id)!)
  const cluster = boundingRect(clusterCards.map(cardRect))
  const occupied = input.cards.map(cardRect)
  const candidateSize = defaultCardFootprint(input.kind)

  for (let ring = 1; ring <= maxRings; ring += 1) {
    for (const point of ringPoints(ring)) {
      const position = positionFor(cluster, candidateSize, point)
      if (!boundedPosition(position, maxAbsoluteCoordinate)) continue
      const candidate = Object.freeze({ ...position, ...candidateSize })
      if (!occupied.some((rect) => conflictsWithClearance(candidate, rect))) {
        return Object.freeze({
          ok: true,
          position: Object.freeze(position),
        })
      }
    }
  }
  return Object.freeze({ ok: false, reason: 'no-bounded-space' })
}

export function defaultAgentCardSize(
  kind: AgentPlaceableCardKind,
): Readonly<{ width: number; height: number }> {
  return Object.freeze(defaultCardFootprint(kind))
}

function connectedClusterIds(
  cardsById: ReadonlyMap<string, Card>,
  connections: readonly Connection[],
  anchorCardIds: readonly string[],
): ReadonlySet<string> {
  const adjacent = new Map<string, Set<string>>()
  for (const connection of [...connections].sort((left, right) => (
    compareStrings(left.id, right.id)
  ))) {
    const from = connection.from.cardId
    const to = connection.to.cardId
    if (!cardsById.has(from) || !cardsById.has(to)) continue
    addAdjacent(adjacent, from, to)
    addAdjacent(adjacent, to, from)
  }
  const visited = new Set<string>(anchorCardIds)
  const pending = [...anchorCardIds]
  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index]!
    const neighbors = [...(adjacent.get(current) ?? [])].sort(compareStrings)
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      pending.push(neighbor)
    }
  }
  return visited
}

function addAdjacent(
  adjacent: Map<string, Set<string>>,
  source: string,
  target: string,
): void {
  const neighbors = adjacent.get(source) ?? new Set<string>()
  neighbors.add(target)
  adjacent.set(source, neighbors)
}

function cardRect(card: Card): Rect {
  const footprint = cardFootprint(card)
  return Object.freeze({
    x: card.position.x,
    y: card.position.y,
    width: footprint.width,
    height: footprint.height,
  })
}

function boundingRect(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return Object.freeze({ x, y, width: right - x, height: bottom - y })
}

function ringPoints(ring: number): readonly GridPoint[] {
  const points: GridPoint[] = []
  for (let column = -ring; column <= ring; column += 1) {
    for (let row = -ring; row <= ring; row += 1) {
      if (Math.max(Math.abs(column), Math.abs(row)) !== ring) continue
      points.push(Object.freeze({ column, row }))
    }
  }
  return points.sort((left, right) => (
    directionPriority(left) - directionPriority(right)
    || distanceSquared(left) - distanceSquared(right)
    || left.row - right.row
    || left.column - right.column
  ))
}

function positionFor(
  cluster: Rect,
  size: Readonly<{ width: number; height: number }>,
  point: GridPoint,
): Readonly<{ x: number; y: number }> {
  const x = point.column > 0
    ? cluster.x + cluster.width + PLACEMENT_CLEARANCE
      + (point.column - 1) * (size.width + PLACEMENT_CLEARANCE)
    : point.column < 0
      ? cluster.x - size.width - PLACEMENT_CLEARANCE
        + (point.column + 1) * (size.width + PLACEMENT_CLEARANCE)
      : cluster.x
  const y = point.row > 0
    ? cluster.y + cluster.height + PLACEMENT_CLEARANCE
      + (point.row - 1) * (size.height + PLACEMENT_CLEARANCE)
    : point.row < 0
      ? cluster.y - size.height - PLACEMENT_CLEARANCE
        + (point.row + 1) * (size.height + PLACEMENT_CLEARANCE)
      : cluster.y
  return { x, y }
}

function conflictsWithClearance(candidate: Rect, occupied: Rect): boolean {
  return candidate.x < occupied.x + occupied.width + PLACEMENT_CLEARANCE
    && candidate.x + candidate.width + PLACEMENT_CLEARANCE > occupied.x
    && candidate.y < occupied.y + occupied.height + PLACEMENT_CLEARANCE
    && candidate.y + candidate.height + PLACEMENT_CLEARANCE > occupied.y
}

function directionPriority(point: GridPoint): number {
  if (point.column > 0 && point.row === 0) return 0
  if (point.column === 0 && point.row > 0) return 1
  if (point.column < 0 && point.row === 0) return 2
  if (point.column === 0 && point.row < 0) return 3
  return 4
}

function distanceSquared(point: GridPoint): number {
  return point.column * point.column + point.row * point.row
}

function boundedPosition(
  position: Readonly<{ x: number; y: number }>,
  maxAbsoluteCoordinate: number,
): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Math.abs(position.x) <= maxAbsoluteCoordinate
    && Math.abs(position.y) <= maxAbsoluteCoordinate
}

function positiveFinite(candidate: number): boolean {
  return Number.isFinite(candidate) && candidate > 0
}

function positiveSafeInteger(candidate: number): boolean {
  return Number.isSafeInteger(candidate) && candidate > 0
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
