import { Position } from '@xyflow/react'
import type { Card, Connection } from '../graph/types'
import { resolvedCardSize } from './renderPlanning'

// React Flow's box selection never geometrically tests edges against the
// selection rect — it auto-adds every edge attached to any box-selected node
// (one endpoint in the box suffices), which both misses and over-selects.
// So "the marquee selects every connection it touches" (#212) is decided
// here, app-side: walk the same cubic bezier React Flow strokes for
// ConnectionEdge (same endpoints, same control-point math) and test
// it against the selection rect in flow coordinates.

export type FlowRect = { x: number; y: number; width: number; height: number }

type Point = { x: number; y: number }

// @xyflow/system's default bezier curvature, used by getBezierPath.
const BEZIER_CURVATURE = 0.25

const CURVE_SAMPLE_SEGMENTS = 32

function controlOffset(distance: number): number {
  return distance >= 0 ? 0.5 * distance : BEZIER_CURVATURE * 25 * Math.sqrt(-distance)
}

// Mirrors getControlWithCurvature in @xyflow/system: the control point leaves
// the handle along its side of the card, bulging backward when the target
// sits behind the source.
function controlPoint(position: Position, from: Point, to: Point): Point {
  switch (position) {
    case Position.Left:
      return { x: from.x - controlOffset(from.x - to.x), y: from.y }
    case Position.Right:
      return { x: from.x + controlOffset(to.x - from.x), y: from.y }
    case Position.Top:
      return { x: from.x, y: from.y - controlOffset(from.y - to.y) }
    case Position.Bottom:
      return { x: from.x, y: from.y + controlOffset(to.y - from.y) }
  }
}

// Liang-Barsky: does the segment a->b cross (or lie inside) the rect?
function segmentIntersectsRect(a: Point, b: Point, rect: FlowRect): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const p = [-dx, dx, -dy, dy]
  const q = [a.x - rect.x, rect.x + rect.width - a.x, a.y - rect.y, rect.y + rect.height - a.y]
  let tEnter = 0
  let tExit = 1
  for (let side = 0; side < 4; side++) {
    if (p[side] === 0) {
      if (q[side] < 0) return false
    } else {
      const t = q[side] / p[side]
      if (p[side] < 0) {
        if (t > tExit) return false
        if (t > tEnter) tEnter = t
      } else {
        if (t < tEnter) return false
        if (t < tExit) tExit = t
      }
    }
  }
  return true
}

function cubicPoint(t: number, start: Point, control1: Point, control2: Point, end: Point): Point {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * start.x + b * control1.x + c * control2.x + d * end.x,
    y: a * start.y + b * control1.y + c * control2.y + d * end.y,
  }
}

export function connectionCurveIntersectsRect({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
  rect,
}: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition?: Position
  targetPosition?: Position
  rect: FlowRect
}): boolean {
  const source = { x: sourceX, y: sourceY }
  const target = { x: targetX, y: targetY }
  const control1 = controlPoint(sourcePosition, source, target)
  const control2 = controlPoint(targetPosition, target, source)

  // The control polygon bounds a cubic bezier: cheap reject before sampling.
  const minX = Math.min(source.x, target.x, control1.x, control2.x)
  const maxX = Math.max(source.x, target.x, control1.x, control2.x)
  const minY = Math.min(source.y, target.y, control1.y, control2.y)
  const maxY = Math.max(source.y, target.y, control1.y, control2.y)
  if (
    maxX < rect.x ||
    minX > rect.x + rect.width ||
    maxY < rect.y ||
    minY > rect.y + rect.height
  ) {
    return false
  }

  let previous = source
  for (let step = 1; step <= CURVE_SAMPLE_SEGMENTS; step++) {
    const point = cubicPoint(step / CURVE_SAMPLE_SEGMENTS, source, control1, control2, target)
    if (segmentIntersectsRect(previous, point, rect)) return true
    previous = point
  }
  return false
}

function endpointFrame(
  card: Card,
  measuredCardSizeById?: (cardId: string) => { width: number; height: number } | undefined,
) {
  const size = resolvedCardSize(card, measuredCardSizeById?.(card.id))
  return { x: card.position.x, y: card.position.y, width: size.width, height: size.height }
}

/**
 * Every connection whose curve the rect touches — the same "touching selects"
 * rule cards get from SelectionMode.Partial (#208). Endpoints anchor where the
 * card handles sit: source right-center to target left-center, from the
 * measured DOM frame when the card is mounted (auto-height cards) or the
 * planned frame otherwise.
 */
export function connectionsTouchingRect({
  connections,
  cardById,
  measuredCardSizeById,
  rect,
}: {
  connections: readonly Connection[]
  cardById: (cardId: string) => Card | undefined
  measuredCardSizeById?: (cardId: string) => { width: number; height: number } | undefined
  rect: FlowRect
}): Connection[] {
  const touched: Connection[] = []
  for (const connection of connections) {
    const source = cardById(connection.from.cardId)
    const target = cardById(connection.to.cardId)
    if (!source || !target) continue
    const sourceFrame = endpointFrame(source, measuredCardSizeById)
    const targetFrame = endpointFrame(target, measuredCardSizeById)
    if (
      connectionCurveIntersectsRect({
        sourceX: sourceFrame.x + sourceFrame.width,
        sourceY: sourceFrame.y + sourceFrame.height / 2,
        targetX: targetFrame.x,
        targetY: targetFrame.y + targetFrame.height / 2,
        rect,
      })
    ) {
      touched.push(connection)
    }
  }
  return touched
}
