// Zoom-compensated sizing for the small interactive chrome that lives in flow
// space — card connection handles and the connection midpoint pill. Each
// target follows one clamped screen-space curve, avoiding visible jumps while
// keeping the chrome grabbable at zoom-out and bounded at zoom-in.

import {
  bandCrossfade,
  bandLayerOpacities,
  type BandFade,
  type BandLayerOpacities,
  type BandThresholds,
} from './detailBands'
import { CONNECTOR_NODE_METRICS } from '../ui/tokens'

export { bandCrossfade, bandLayerOpacities }
export type { BandFade, BandLayerOpacities, BandThresholds }

/**
 * CONTRACT — shared by the band planner, DOM card layer, and canvas painter.
 *
 * Returns the active adjacent-band transition and its smoothstep progress,
 * or `null` outside both windows. Progress increases with zoom from the
 * lower-detail `from` band to the higher-detail `to` band.
 *
 * The window is zoom-pure and multiplicative: the frozen
 * `BAND_CROSSFADE_HALF_WIDTH = 0.15` is applied as `threshold · (1 ± 0.15)`.
 * With the ADR 0019 thresholds, Overview↔Map spans 0.1275–0.1725 and
 * Reading↔Overview spans 0.27625–0.37375. The windows are disjoint, so at most
 * two adjacent representations are co-visible. There is no viewport input,
 * clock, carried state, or previous-band input.
 */

export function chromeScreenPx(
  naturalPx: number,
  zoom: number,
  minScreenPx: number,
  maxScreenPx: number,
): number {
  return Math.min(maxScreenPx, Math.max(minScreenPx, naturalPx * zoom))
}

// Connector nodes stay on the prototype's exact 13px recipe through normal
// detail, then grow with a close-up Card until the 24px cap. The canvas
// painter uses the 13px base directly below Reading.
export function handleScaleForZoom(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const screenDiameter = Math.min(
    CONNECTOR_NODE_METRICS.maxDiameter,
    Math.max(CONNECTOR_NODE_METRICS.diameter, CONNECTOR_NODE_METRICS.diameter * safeZoom),
  )
  return screenDiameter / (CONNECTOR_NODE_METRICS.diameter * safeZoom)
}

// The generous target is independent of the visible close-up growth: it stays
// 24 screen pixels even while the 13px node grows toward the same cap.
export function connectorHitScaleForZoom(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return 1 / safeZoom
}

const PILL_NATURAL_PX = 20
const PILL_MIN_SCREEN_PX = 12
const PILL_MAX_SCREEN_PX = 40

// Multiplier for the 20px connection pill. Keeps the pill (the connection's
// editor handle) at least 12px on screen while zoomed out, leaves its natural
// scale unchanged through zoom 2, then caps its screen size at 40px.
export function pillScaleForZoom(zoom: number): number {
  return (
    chromeScreenPx(PILL_NATURAL_PX, zoom, PILL_MIN_SCREEN_PX, PILL_MAX_SCREEN_PX) /
    (PILL_NATURAL_PX * zoom)
  )
}

// A card's painted rectangle in screen space (post-viewport-transform pixels).
export type ScreenFrame = {
  x: number
  y: number
  width: number
  height: number
}

export type PortPoint = { x: number; y: number }

// Both port discs of one card: centres plus the shared radius the painter
// draws and the pointer layer hit-tests.
export type PortGeometry = {
  left: PortPoint
  right: PortPoint
  radius: number
}

/**
 * CONTRACT — revised by the connector-node polish pass. Lane B (B1) and Lane
 * C (C3) import this function and cite this comment, never the implementing
 * diff.
 *
 * The single owner of painted-port geometry: the overview painter draws its
 * port discs from exactly this value and the pointer layer hit-tests against
 * exactly this value, so the hit region is byte-identical to the painted
 * disc with nothing to sync.
 *
 * Ports sit at the frame's left and right edge midpoints. Their radius is the
 * prototype's 13px diameter divided by two, independent of card footprint.
 * The card may simplify through Reading, Overview, and Map; its connector is
 * stable screen-space chrome and does not continuously mutate with zoom.
 *
 * Guarantees:
 * - Idle paint is the same 13px hollow ring in every LOD.
 * - Pointer hit geometry remains byte-identical to the painted disc.
 * - Connection endpoints remain the frame edge midpoints; graph behavior and
 *   routing are unchanged.
 */
export function paintedPortGeometry(frame: ScreenFrame): PortGeometry {
  const midY = frame.y + frame.height / 2
  return {
    left: { x: frame.x, y: midY },
    right: { x: frame.x + frame.width, y: midY },
    radius: CONNECTOR_NODE_METRICS.diameter / 2,
  }
}

const BADGE_NATURAL_PX = 14
const BADGE_MIN_SCREEN_PX = 2
const BADGE_MAX_SCREEN_PX = 6

/**
 * CONTRACT — frozen by #308, same ownership rule as `paintedPortGeometry`:
 * the connection midpoint badge is painted at exactly this radius and
 * hit-tested against exactly this radius.
 *
 * Same clamped screen-space curve family as the handle and pill: a 14px
 * natural disc held between 2px and 6px on screen. Total over all finite
 * zooms — a clamp of a product, no division, so zoom ≤ 0 yields the 2px
 * minimum rather than Infinity or a negative radius.
 */
export function paintedBadgeRadius(zoom: number): number {
  return chromeScreenPx(BADGE_NATURAL_PX, zoom, BADGE_MIN_SCREEN_PX, BADGE_MAX_SCREEN_PX)
}

// The painted curve's screen-space endpoints, as planned by
// `planPaintedConnections` (structural — no import cycle back into the scene).
export type ConnectionEndpoints = {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
}

export type BadgeGeometry = {
  center: PortPoint
  radius: number
}

export const PAINTED_CONNECTION_BADGE_HOVER_SCALE = 1.35

export type PaintedConnectionBadgeGeometryOptions = Readonly<{
  expanded?: boolean
}>

/**
 * CONTRACT — added by #309 under CH2's ownership rule: the single owner of
 * the painted connection-badge DISC. The centre is the midpoint of the
 * planned curve's endpoints; the radius is `paintedBadgeRadius`, optionally
 * expanded by the shared hover scale. The painter and badge hit-test pass the
 * same named state and consume exactly this disc — no second centre, radius,
 * or hover-growth rule may exist.
 */
export function paintedConnectionBadgeGeometry(
  endpoints: ConnectionEndpoints,
  zoom: number,
  { expanded = false }: PaintedConnectionBadgeGeometryOptions = {},
): BadgeGeometry {
  return {
    center: {
      x: (endpoints.sourceX + endpoints.targetX) / 2,
      y: (endpoints.sourceY + endpoints.targetY) / 2,
    },
    radius: paintedBadgeRadius(zoom) * (expanded ? PAINTED_CONNECTION_BADGE_HOVER_SCALE : 1),
  }
}
