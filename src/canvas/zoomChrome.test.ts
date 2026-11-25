// Zoom compensation for handles and the connection pill (#259 Phase 3): the
// scales must keep both grabbable on screen across the whole zoom range where
// they render, and must never explode a step boundary into a visual jump the
// user reads as a glitch. Screen size = natural size × zoom × scale.

import { describe, expect, it } from 'vitest'
import {
  BAND_CROSSFADE_HALF_WIDTH,
  MAP_BAND_MAX_ZOOM,
  READING_BAND_MIN_ZOOM,
} from './boardScene'
import {
  bandCrossfade,
  bandLayerOpacities,
  chromeScreenPx,
  connectorHitScaleForZoom,
  handleScaleForZoom,
  paintedBadgeRadius,
  paintedConnectionBadgeGeometry,
  paintedPortGeometry,
  pillScaleForZoom,
  type BandThresholds,
  type ScreenFrame,
} from './zoomChrome'
import { CONNECTOR_NODE_METRICS } from '../ui/tokens'

const HANDLE_PX = CONNECTOR_NODE_METRICS.diameter
const PILL_PX = 20
const FLOAT_EPSILON = 1e-9

const BAND_THRESHOLDS: BandThresholds = {
  readingMinZoom: READING_BAND_MIN_ZOOM,
  mapMaxZoom: MAP_BAND_MAX_ZOOM,
}

describe('bandCrossfade', () => {
  it('uses the frozen multiplicative windows for adjacent band transitions', () => {
    expect(bandCrossfade(0.1275, BAND_THRESHOLDS)).toEqual({
      from: 'map',
      to: 'overview',
      t: 0,
    })
    expect(bandCrossfade(0.15, BAND_THRESHOLDS)).toEqual({
      from: 'map',
      to: 'overview',
      t: 0.5,
    })
    expect(bandCrossfade(0.1725, BAND_THRESHOLDS)).toEqual({
      from: 'map',
      to: 'overview',
      t: 1,
    })

    expect(bandCrossfade(0.27625, BAND_THRESHOLDS)).toEqual({
      from: 'overview',
      to: 'reading',
      t: 0,
    })
    expect(bandCrossfade(0.325, BAND_THRESHOLDS)).toEqual({
      from: 'overview',
      to: 'reading',
      t: 0.5,
    })
    expect(bandCrossfade(0.37375, BAND_THRESHOLDS)).toEqual({
      from: 'overview',
      to: 'reading',
      t: 1,
    })
  })

  it('keeps smoothstep progress finite, continuous, monotone, and in range across each window', () => {
    for (const threshold of [MAP_BAND_MAX_ZOOM, READING_BAND_MIN_ZOOM]) {
      const start = threshold * (1 - BAND_CROSSFADE_HALF_WIDTH)
      const end = threshold * (1 + BAND_CROSSFADE_HALF_WIDTH)
      const progress: number[] = []

      for (let step = 0; step <= 100; step += 1) {
        const fade = bandCrossfade(start + ((end - start) * step) / 100, BAND_THRESHOLDS)
        expect(fade).not.toBeNull()
        progress.push(fade!.t)
      }

      expect(progress[0]).toBeCloseTo(0, 12)
      expect(progress[25]).toBeCloseTo(0.15625, 12)
      expect(progress[50]).toBeCloseTo(0.5, 12)
      expect(progress[75]).toBeCloseTo(0.84375, 12)
      expect(progress[100]).toBeCloseTo(1, 12)

      for (let index = 1; index < progress.length; index += 1) {
        const previous = progress[index - 1]!
        const current = progress[index]!
        expect(Number.isFinite(current)).toBe(true)
        expect(current).toBeGreaterThanOrEqual(previous)
        expect(current).toBeGreaterThanOrEqual(0)
        expect(current).toBeLessThanOrEqual(1)
        expect(current - previous).toBeLessThan(0.016)
      }
    }
  })

  it('returns null outside the two frozen, disjoint windows', () => {
    const mapStart = MAP_BAND_MAX_ZOOM * (1 - BAND_CROSSFADE_HALF_WIDTH)
    const mapEnd = MAP_BAND_MAX_ZOOM * (1 + BAND_CROSSFADE_HALF_WIDTH)
    const readingStart = READING_BAND_MIN_ZOOM * (1 - BAND_CROSSFADE_HALF_WIDTH)
    const readingEnd = READING_BAND_MIN_ZOOM * (1 + BAND_CROSSFADE_HALF_WIDTH)

    expect(mapStart).toBeCloseTo(0.1275, 12)
    expect(mapEnd).toBeCloseTo(0.1725, 12)
    expect(readingStart).toBeCloseTo(0.27625, 12)
    expect(readingEnd).toBeCloseTo(0.37375, 12)
    expect(mapEnd).toBeLessThan(readingStart)

    const justBelowReadingWindow = readingStart - Number.EPSILON / 2
    const justAboveReadingWindow = 0.37375 + Number.EPSILON / 2
    expect(justBelowReadingWindow).toBeLessThan(readingStart)
    expect(justAboveReadingWindow).toBeGreaterThan(0.37375)

    for (const zoom of [
      0.1,
      0.2,
      0.27,
      justBelowReadingWindow,
      justAboveReadingWindow,
      0.38,
      2,
    ]) {
      expect(bandCrossfade(zoom, BAND_THRESHOLDS), `zoom ${zoom}`).toBeNull()
    }
  })

  it('retraces the same mid-fade values exactly when zoom direction reverses', () => {
    const zoomsAcrossMapFade = [0.13, 0.14, 0.15, 0.16, 0.17]
    const forward = zoomsAcrossMapFade.map((zoom) => bandCrossfade(zoom, BAND_THRESHOLDS))
    const reverse = [...zoomsAcrossMapFade]
      .reverse()
      .map((zoom) => bandCrossfade(zoom, BAND_THRESHOLDS))
      .reverse()

    expect(reverse).toEqual(forward)
  })

  it('is total at and below zoom 0 without raw-zoom division', () => {
    expect(bandCrossfade(0, BAND_THRESHOLDS)).toBeNull()
    expect(bandCrossfade(-1, BAND_THRESHOLDS)).toBeNull()
    expect(bandCrossfade(NaN, BAND_THRESHOLDS)).toBeNull()
    expect(bandCrossfade(Infinity, BAND_THRESHOLDS)).toBeNull()
    expect(bandCrossfade(-Infinity, BAND_THRESHOLDS)).toBeNull()
  })
})

describe('bandLayerOpacities', () => {
  it('crossfades Reading card bodies against Overview bodies with complementary opacity', () => {
    expect(bandLayerOpacities(0.27625, BAND_THRESHOLDS)).toEqual({ map: 0, overview: 1, reading: 0 })
    expect(bandLayerOpacities(0.325, BAND_THRESHOLDS)).toEqual({ map: 0, overview: 0.5, reading: 0.5 })
    expect(bandLayerOpacities(0.37375, BAND_THRESHOLDS)).toEqual({ map: 0, overview: 0, reading: 1 })
  })

  it('keeps exactly one opaque body outside a transition window', () => {
    expect(bandLayerOpacities(0.1, BAND_THRESHOLDS)).toEqual({ map: 1, overview: 0, reading: 0 })
    expect(bandLayerOpacities(0.25, BAND_THRESHOLDS)).toEqual({ map: 0, overview: 1, reading: 0 })
    expect(bandLayerOpacities(0.8, BAND_THRESHOLDS)).toEqual({ map: 0, overview: 0, reading: 1 })
  })
})

describe('chromeScreenPx', () => {
  it('clamps natural screen size between the configured bounds', () => {
    expect(chromeScreenPx(20, 0.25, 12, 40)).toBe(12)
    expect(chromeScreenPx(20, 1, 12, 40)).toBe(20)
    expect(chromeScreenPx(20, 3, 12, 40)).toBe(40)
  })
})

// Sample the whole DOM-edge zoom range densely, including each former step boundary.
const zooms: number[] = []
for (let zoom = 0.08; zoom <= 4; zoom += 0.001) zooms.push(Number(zoom.toFixed(3)))

function expectContinuousMonotoneScreenCurve(
  label: string,
  naturalPx: number,
  scaleForZoom: (zoom: number) => number,
) {
  const maxContinuousDelta = naturalPx * 0.001 + FLOAT_EPSILON
  const screenSizes = zooms.map((zoom) => naturalPx * zoom * scaleForZoom(zoom))

  for (let index = 1; index < screenSizes.length; index += 1) {
    const previous = screenSizes[index - 1]!
    const current = screenSizes[index]!
    expect(current, `${label} monotonic at zoom ${zooms[index]}`).toBeGreaterThanOrEqual(
      previous - FLOAT_EPSILON,
    )
    expect(current - previous, `${label} continuous at zoom ${zooms[index]}`).toBeLessThanOrEqual(
      maxContinuousDelta,
    )
  }
}

it('keeps chrome screen sizes monotone and continuous across a dense zoom sweep', () => {
  expectContinuousMonotoneScreenCurve('handle', HANDLE_PX, handleScaleForZoom)
  expectContinuousMonotoneScreenCurve('pill', PILL_PX, pillScaleForZoom)
})

describe('handleScaleForZoom', () => {
  it('holds 13px through normal detail, then grows smoothly to a 24px close-up cap', () => {
    for (const zoom of [0.01, ...zooms.filter((value) => value <= 1), 1]) {
      const screen = HANDLE_PX * zoom * handleScaleForZoom(zoom)
      expect(screen, `handle at zoom ${zoom}`).toBeCloseTo(CONNECTOR_NODE_METRICS.diameter, 8)
    }
    expect(HANDLE_PX * 1.5 * handleScaleForZoom(1.5)).toBe(19.5)
    expect(HANDLE_PX * 2 * handleScaleForZoom(2)).toBe(CONNECTOR_NODE_METRICS.maxDiameter)
    expect(HANDLE_PX * 4 * handleScaleForZoom(4)).toBe(CONNECTOR_NODE_METRICS.maxDiameter)
  })

  it('leaves working zoom alone', () => {
    expect(handleScaleForZoom(1)).toBe(1)
  })

  it('keeps the invisible interaction target at 24 screen pixels independently', () => {
    for (const zoom of [0.01, ...zooms, 1, 1.5, 2, 4]) {
      const screen = CONNECTOR_NODE_METRICS.hitDiameter * zoom * connectorHitScaleForZoom(zoom)
      expect(screen, `hit target at zoom ${zoom}`).toBeCloseTo(CONNECTOR_NODE_METRICS.hitDiameter, 8)
    }
  })
})

describe('pillScaleForZoom', () => {
  it('keeps the pill clickable on screen from the detail threshold up', () => {
    for (const zoom of zooms) {
      const screen = PILL_PX * zoom * pillScaleForZoom(zoom)
      expect(screen, `pill at zoom ${zoom}`).toBeGreaterThanOrEqual(12 - FLOAT_EPSILON)
    }
  })

  it('leaves working zoom alone', () => {
    expect(pillScaleForZoom(1)).toBe(1)
    expect(pillScaleForZoom(2)).toBe(1)
  })

  it('never grows the pill past its natural screen size while compensating', () => {
    // Compensation caps at "readable", not "huge": below working zoom the
    // scaled pill must stay at or under its natural 20px screen size.
    for (const zoom of zooms.filter((z) => z < 1)) {
      const screen = PILL_PX * zoom * pillScaleForZoom(zoom)
      expect(screen, `pill at zoom ${zoom}`).toBeLessThanOrEqual(PILL_PX)
    }
  })
})

// Painted-port + badge geometry (#308): one pure owner for the port discs the
// painter draws and the pointer layer hit-tests. The contract lives in the doc
// comments on the exported functions; these tests pin its guarantees.

const frameAt = (width: number, height: number): ScreenFrame => ({ x: 100, y: 50, width, height })

describe('paintedPortGeometry', () => {
  it('centres the two ports on the frame edge midpoints', () => {
    const geometry = paintedPortGeometry({ x: 100, y: 50, width: 40, height: 20 })
    expect(geometry.left).toEqual({ x: 100, y: 60 })
    expect(geometry.right).toEqual({ x: 140, y: 60 })
  })

  it('keeps one 13px screen-space disc through Reading, Overview, and Map', () => {
    for (const [width, height] of [
      [260, 120],
      [78, 36],
      [39, 18],
      [21, 10],
      [5, 2],
      [0, 0],
    ]) {
      expect(paintedPortGeometry(frameAt(width, height)).radius).toBe(
        CONNECTOR_NODE_METRICS.diameter / 2,
      )
    }
  })
})

describe('paintedBadgeRadius', () => {
  it('holds the badge on the clamped 2-6px screen curve', () => {
    expect(paintedBadgeRadius(0.08)).toBe(2) // 14·0.08 = 1.12 → floor
    expect(paintedBadgeRadius(0.3)).toBeCloseTo(4.2, 5) // natural range
    expect(paintedBadgeRadius(1)).toBe(6) // 14 → cap
  })

  it('is monotone and continuous across a dense zoom sweep', () => {
    let previous = paintedBadgeRadius(zooms[0]!)
    for (const zoom of zooms.slice(1)) {
      const current = paintedBadgeRadius(zoom)
      expect(current, `badge monotonic at zoom ${zoom}`).toBeGreaterThanOrEqual(
        previous - FLOAT_EPSILON,
      )
      expect(current - previous, `badge continuous at zoom ${zoom}`).toBeLessThanOrEqual(
        14 * 0.001 + FLOAT_EPSILON,
      )
      previous = current
    }
  })

  it('is total at and below zoom 0 — no raw-zoom division', () => {
    // Unlike the scale multipliers above (which divide by zoom and are only
    // ever called with the adapter's clamped positive zoom), the badge radius
    // is a clamp of a product: degenerate zooms yield the floor, not
    // Infinity or a negative radius.
    expect(paintedBadgeRadius(0)).toBe(2)
    expect(paintedBadgeRadius(-1)).toBe(2)
  })
})

describe('paintedConnectionBadgeGeometry', () => {
  it('owns the badge disc: endpoint midpoint centre + the frozen radius curve', () => {
    const geometry = paintedConnectionBadgeGeometry(
      { sourceX: 100, sourceY: 40, targetX: 300, targetY: 120 },
      0.3,
    )

    expect(geometry.center).toEqual({ x: 200, y: 80 })
    expect(geometry.radius).toBe(paintedBadgeRadius(0.3))
  })
})
