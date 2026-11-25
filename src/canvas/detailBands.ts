export const READING_BAND_MIN_ZOOM = 0.325
export const MAP_BAND_MAX_ZOOM = 0.15
export const BAND_CROSSFADE_HALF_WIDTH = 0.15

export type DetailBand = 'reading' | 'overview' | 'map'

export type BandThresholds = {
  readingMinZoom: number
  mapMaxZoom: number
}

export type BandFade = {
  from: DetailBand
  to: DetailBand
  t: number
}

export type BandLayerOpacities = Record<DetailBand, number>

/**
 * Returns the active adjacent-band transition and its smoothstep progress,
 * or null outside both multiplicative windows. Progress increases with zoom
 * from the lower-detail band to the higher-detail band.
 */
export function bandCrossfade(zoom: number, thresholds: BandThresholds): BandFade | null {
  if (!Number.isFinite(zoom)) return null

  const halfWidthPercent = BAND_CROSSFADE_HALF_WIDTH * 100
  const transitions: Array<{ threshold: number; from: DetailBand; to: DetailBand }> = [
    { threshold: thresholds.mapMaxZoom, from: 'map', to: 'overview' },
    { threshold: thresholds.readingMinZoom, from: 'overview', to: 'reading' },
  ]

  for (const { threshold, from, to } of transitions) {
    const start = (threshold * (100 - halfWidthPercent)) / 100
    const end = (threshold * (100 + halfWidthPercent)) / 100
    if (zoom < start || zoom > end) continue

    const progress =
      zoom <= start
        ? 0
        : zoom >= end
          ? 1
          : ((zoom / threshold) * 100 - (100 - halfWidthPercent)) / (2 * halfWidthPercent)
    const t = progress * progress * (3 - 2 * progress)
    return { from, to, t }
  }

  return null
}

/** One opacity plan shared by Reading DOM card visuals and canvas card bodies. */
export function bandLayerOpacities(zoom: number, thresholds: BandThresholds): BandLayerOpacities {
  const fade = bandCrossfade(zoom, thresholds)
  if (fade) {
    return {
      map: fade.from === 'map' ? 1 - fade.t : 0,
      overview: fade.from === 'overview' ? 1 - fade.t : fade.to === 'overview' ? fade.t : 0,
      reading: fade.to === 'reading' ? fade.t : 0,
    }
  }
  if (zoom >= thresholds.readingMinZoom) return { map: 0, overview: 0, reading: 1 }
  if (zoom <= thresholds.mapMaxZoom) return { map: 1, overview: 0, reading: 0 }
  return { map: 0, overview: 1, reading: 0 }
}
