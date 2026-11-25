import { describe, expect, it } from 'vitest'
import {
  CONNECTION_BADGE_MIN_ZOOM,
  connectionBadgeFlowAnchor,
  connectionBadgeLimitForZoom,
  connectionBadgePaintedAtIndex,
  pointHitsConnectionBadge,
} from './connectionBadgeHit'
import { paintedConnectionBadgeGeometry } from './zoomChrome'

// A horizontal painted connection: source right edge to target left edge on
// one row, so the disc centre is the plain midpoint of the endpoints.
const endpoints = { sourceX: 100, sourceY: 200, targetX: 500, targetY: 200 }

describe('pointHitsConnectionBadge', () => {
  it('hits dead centre of the painted disc', () => {
    const zoom = 0.3
    const badge = paintedConnectionBadgeGeometry(endpoints, zoom)
    expect(pointHitsConnectionBadge(endpoints, zoom, badge.center.x, badge.center.y)).toBe(true)
  })

  it('hits exactly at the painted radius and misses just past it', () => {
    const zoom = 0.3
    const badge = paintedConnectionBadgeGeometry(endpoints, zoom)
    // On the rim (distance === radius) counts as a hit.
    expect(pointHitsConnectionBadge(endpoints, zoom, badge.center.x + badge.radius, badge.center.y)).toBe(true)
    // A pixel past the rim misses.
    expect(
      pointHitsConnectionBadge(endpoints, zoom, badge.center.x + badge.radius + 1, badge.center.y),
    ).toBe(false)
  })

  it('never invents a second radius rule — the disc is the shared owner', () => {
    const zoom = 0.08
    const badge = paintedConnectionBadgeGeometry(endpoints, zoom)
    // A point one unit inside the shared radius hits; the same offset applied
    // to a hand-rolled larger radius would wrongly pass, proving we defer to
    // the owner.
    expect(pointHitsConnectionBadge(endpoints, zoom, badge.center.x, badge.center.y + badge.radius - 0.001)).toBe(
      true,
    )
    expect(pointHitsConnectionBadge(endpoints, zoom, badge.center.x, badge.center.y + badge.radius + 0.001)).toBe(
      false,
    )
  })

  it('uses the same expanded hover disc for paint geometry and hit testing', () => {
    const zoom = 0.25
    const rest = paintedConnectionBadgeGeometry(endpoints, zoom)
    const expanded = paintedConnectionBadgeGeometry(endpoints, zoom, { expanded: true })
    const pointInsideExpandedRim = expanded.center.x + expanded.radius - 0.001

    expect(expanded.center).toEqual(rest.center)
    expect(expanded.radius).toBe(rest.radius * 1.35)
    expect(
      pointHitsConnectionBadge(
        endpoints,
        zoom,
        pointInsideExpandedRim,
        expanded.center.y,
        { expanded: true },
      ),
    ).toBe(true)
    expect(
      pointHitsConnectionBadge(endpoints, zoom, pointInsideExpandedRim, expanded.center.y),
    ).toBe(false)
  })
})

describe('connectionBadgeFlowAnchor', () => {
  it('inverse-transforms the painted disc centre back to flow space', () => {
    const viewport = { x: 40, y: 15, zoom: 0.3 }
    const badge = paintedConnectionBadgeGeometry(endpoints, viewport.zoom)
    const anchor = connectionBadgeFlowAnchor(endpoints, viewport)
    // Re-applying the viewport transform to the flow anchor lands back on the
    // painted (screen-space) disc centre.
    expect(anchor.x * viewport.zoom + viewport.x).toBeCloseTo(badge.center.x, 6)
    expect(anchor.y * viewport.zoom + viewport.y).toBeCloseTo(badge.center.y, 6)
  })
})

describe('connectionBadgePaintedAtIndex', () => {
  it('suppresses every badge below the paint floor', () => {
    expect(connectionBadgePaintedAtIndex(0, CONNECTION_BADGE_MIN_ZOOM - 0.001)).toBe(false)
    expect(connectionBadgePaintedAtIndex(0, CONNECTION_BADGE_MIN_ZOOM)).toBe(true)
  })

  it('cuts off exactly at the zoom-keyed density limit', () => {
    for (const zoom of [0.05, 0.2, 0.5]) {
      const limit = connectionBadgeLimitForZoom(zoom)
      expect(connectionBadgePaintedAtIndex(limit - 1, zoom)).toBe(true)
      expect(connectionBadgePaintedAtIndex(limit, zoom)).toBe(false)
    }
  })
})
