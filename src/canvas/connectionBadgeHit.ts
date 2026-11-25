import type { BoardViewport } from './renderPlanning'
import {
  paintedConnectionBadgeGeometry,
  type ConnectionEndpoints,
  type PaintedConnectionBadgeGeometryOptions,
} from './zoomChrome'

// Hit == paint (ADR 0020) for the painted connection badge. Both functions
// read the DISC from CH2's single geometry owner
// (`paintedConnectionBadgeGeometry`) — no second centre or radius rule lives
// here. The painter draws exactly that disc, so a click "hits" exactly what a
// user can see and the Board-level editor host anchors to exactly that disc.

function safeZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.max(0.01, zoom) : 1
}

// ─── Badge suppression (paint == hit MEMBERSHIP, not just geometry) ─────────
// Lifted from BoardOverviewLayer so the painter and the badge hit-test share
// ONE decision about which planned connections carry a visible badge. The
// painter walks `planPaintedConnections` in order and paints a badge for each
// connection while this predicate holds; the hit path tests the same predicate
// at the same ordinal, so a suppressed (unpainted) badge can never take a
// click.

/** Below this zoom no badges draw at all (far-language styling gate). */
export const CONNECTION_BADGE_MIN_ZOOM = 0.04

/**
 * Badge DENSITY limit (how many midpoint badges paint per frame), zoom-keyed
 * exactly as before the representation swap. Distinct from the badge's
 * radius, which is CH2's `paintedBadgeRadius`. Connection density caps are a
 * parked human decision (H2) — badges past this limit are counted as omitted
 * instead of disappearing silently.
 */
export function connectionBadgeLimitForZoom(zoom: number): number {
  if (zoom < 0.12) return 1200
  if (zoom < 0.3) return 320
  return 32
}

/**
 * Whether the planned connection at `paintedIndex` (its position in the
 * `planPaintedConnections` output) carries a painted badge at this zoom.
 * Badges paint in plan order and every planned connection is badge-eligible
 * once the zoom gate holds, so "index under the density limit" is exactly
 * "this badge painted".
 */
export function connectionBadgePaintedAtIndex(paintedIndex: number, zoom: number): boolean {
  return zoom >= CONNECTION_BADGE_MIN_ZOOM && paintedIndex < connectionBadgeLimitForZoom(zoom)
}

/**
 * True when a viewport-relative screen point lands inside the painted badge
 * disc for a planned connection. `endpoints` are the screen-space endpoints
 * `planPaintedConnections` produced, so the disc centre/radius match the
 * painter frame for frame. `options.expanded` carries the same hover state as
 * the painter, so the visible and interactive discs grow together.
 */
export function pointHitsConnectionBadge(
  endpoints: ConnectionEndpoints,
  zoom: number,
  pointX: number,
  pointY: number,
  options: PaintedConnectionBadgeGeometryOptions = {},
): boolean {
  const badge = paintedConnectionBadgeGeometry(endpoints, safeZoom(zoom), options)
  const dx = pointX - badge.center.x
  const dy = pointY - badge.center.y
  return dx * dx + dy * dy <= badge.radius * badge.radius
}

/**
 * The badge disc centre in FLOW space, so a popover glued to flow coordinates
 * (React Flow's `ViewportPortal`) tracks the painted badge through pan and
 * zoom. The disc centre comes from the shared owner (screen space) and is
 * inverse-transformed through the viewport — the single reversible step, not a
 * re-derived midpoint.
 */
export function connectionBadgeFlowAnchor(
  endpoints: ConnectionEndpoints,
  viewport: BoardViewport,
): { x: number; y: number } {
  const zoom = safeZoom(viewport.zoom)
  const badge = paintedConnectionBadgeGeometry(endpoints, zoom)
  return {
    x: (badge.center.x - viewport.x) / zoom,
    y: (badge.center.y - viewport.y) / zoom,
  }
}
