// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card, Connection } from '../graph/types'
import { painterPaletteForTheme } from '../ui/tokens'
import { MAP_BAND_MAX_ZOOM, READING_BAND_MIN_ZOOM, summaryForCard } from './boardScene'
import { drawOverviewLayer, KIND_COLORS, labelSortAreaOf } from './BoardOverviewLayer'
import type { CanvasDisplayPriority } from './boardScene'
import {
  createLabelBitmapCache,
  createLabelInkResolver,
  createLabelSortCache,
  darkenToLabelInk,
  declutterLabels,
  drawLabels,
  ellipsizeToWidth,
  LABEL_CONTEST_FADE_PX,
  labelContestOpacity,
  labelDeclutterSortsForTests,
  labelOverlapPenetrationPx,
  labelPaintScratchCountForTests,
  labelPlacementObjectsForTests,
  labelPriorityTier,
  sortLabelCandidateIndices,
  LABEL_ANCHOR_OFFSET_X_PX,
  LABEL_ANCHOR_OFFSET_Y_PX,
  LABEL_AREA_PER_LABEL_PX2,
  LABEL_BITMAP_BASELINE_PX,
  LABEL_BITMAP_CSS_HEIGHT_PX,
  LABEL_BITMAP_PAD_PX,
  LABEL_CACHE_MAX_BYTES,
  LABEL_FONT,
  LABEL_FALLBACK_INK,
  LABEL_FRAME_LABEL_CAP,
  LABEL_HALO_COLOR,
  LABEL_HALO_PX,
  LABEL_INK_MAX_LUMINANCE,
  LABEL_MAX_ENTRY_BYTES,
  LABEL_MAX_RENDER_WIDTH_PX,
  LABEL_MIN_MAX_WIDTH_PX,
  labelAnchor,
  labelBandEligible,
  labelInkDarkenInvocationsForTests,
  labelHaloForPalette,
  labelMaxWidthPx,
  labelRenderMaxWidthPx,
  paintedLabelFrameCap,
  relativeLuminance,
  resolveLabelInk,
  loadLabelFont,
  LABEL_FONT_SAMPLE,
  LABEL_FONT_LOAD,
  type LabelBitmapContextFactory,
  type LabelCandidate,
} from './labelLayer'
import { createBoardRenderIndex, createBoardRenderIndexCache, renderedCardSize } from './renderPlanning'
import { bandCrossfade } from './zoomChrome'

// ---------------------------------------------------------------------------
// Recording 2d context (superset of the B1 test recorder: adds measureText,
// drawImage, lineJoin/miterLimit/font/textBaseline state capture).

type RecordedOp = {
  op: string
  args: unknown[]
  globalAlpha: number
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  lineJoin: string
  miterLimit: number
  font: string
  textBaseline: string
}

type RecordingContext = CanvasRenderingContext2D & { ops: RecordedOp[] }

// Deterministic glyph advance: every character is 6px at the label font.
const CHAR_WIDTH_PX = 6
const measureWidth = (text: string) => text.length * CHAR_WIDTH_PX

function recordingContext(): RecordingContext {
  const ops: RecordedOp[] = []
  const state = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: '',
    miterLimit: 10,
    font: '',
    textBaseline: '',
  }
  const record = (op: string) =>
    function (...args: unknown[]) {
      ops.push({ op, args, ...state })
    }
  const context: Record<string, unknown> = { ops }
  for (const op of [
    'save',
    'restore',
    'setTransform',
    'clearRect',
    'beginPath',
    'moveTo',
    'lineTo',
    'quadraticCurveTo',
    'bezierCurveTo',
    'arc',
    'roundRect',
    'fill',
    'stroke',
    'fillRect',
    'fillText',
    'strokeText',
    'setLineDash',
    'drawImage',
  ]) {
    context[op] = record(op)
  }
  context.measureText = (text: string) => ({ width: measureWidth(text) })
  for (const key of Object.keys(state)) {
    Object.defineProperty(context, key, {
      get: () => state[key as keyof typeof state],
      set: (value) => {
        ;(state as Record<string, unknown>)[key] = value
      },
    })
  }
  return context as unknown as RecordingContext
}

type RecordedBitmap = {
  source: { deviceWidth: number; deviceHeight: number }
  context: RecordingContext
}

function recordingBitmapFactory() {
  const bitmaps: RecordedBitmap[] = []
  const factory: LabelBitmapContextFactory = (deviceWidth, deviceHeight) => {
    const bitmap = { source: { deviceWidth, deviceHeight }, context: recordingContext() }
    bitmaps.push(bitmap)
    return bitmap as unknown as ReturnType<LabelBitmapContextFactory>
  }
  return { bitmaps, factory }
}

function candidate(overrides: Partial<LabelCandidate> = {}): LabelCandidate {
  return {
    id: 'card-1',
    text: 'A card name',
    displayPriority: 'user-authored',
    hovered: false,
    selected: false,
    mountedInReading: false,
    pinToRegion: false,
    color: '#d7ad45',
    x: 100,
    y: 50,
    width: 96,
    height: 54,
    ...overrides,
  }
}

const VIEWPORT = { width: 1200, height: 800 }
const LIGHT_PALETTE = painterPaletteForTheme('light')

function paint({
  candidates,
  band = 'overview' as const,
  ordinaryLabelAlpha = 1,
  viewportSize = VIEWPORT,
  dpr = 2,
  maxBytes,
  ink,
  palette = LIGHT_PALETTE,
  fontRevision = 0,
}: {
  candidates: LabelCandidate[]
  band?: 'reading' | 'overview' | 'map'
  ordinaryLabelAlpha?: number
  viewportSize?: { width: number; height: number }
  dpr?: number
  maxBytes?: number
  ink?: ReturnType<typeof createLabelInkResolver>
  palette?: ReturnType<typeof painterPaletteForTheme>
  fontRevision?: number
}) {
  const context = recordingContext()
  const { bitmaps, factory } = recordingBitmapFactory()
  const cache = createLabelBitmapCache({ maxBytes, createBitmapContext: factory })
  const draw = () =>
    drawLabels({
      context,
      band,
      candidates,
      ordinaryLabelAlpha,
      viewportSize,
      devicePixelRatio: dpr,
      palette,
      fontRevision,
      cache,
      ink,
    })
  return { context, bitmaps, cache, draw }
}

// Independent WCAG luminance/contrast (its own implementation, so a bug in
// the layer's math cannot self-certify).
function wcagLuminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const scaled = channel / 255
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

const PAPER = '#fffdf8'
const contrastVsPaper = (ink: string) => (wcagLuminance(PAPER) + 0.05) / (wcagLuminance(ink) + 0.05)
const contrastRatio = (a: string, b: string) => {
  const aLuminance = wcagLuminance(a)
  const bLuminance = wcagLuminance(b)
  return (Math.max(aLuminance, bLuminance) + 0.05) / (Math.min(aLuminance, bLuminance) + 0.05)
}

// ---------------------------------------------------------------------------

describe('frozen visual spec (T4)', () => {
  it('pins the exact frozen values — these ARE the acceptance', () => {
    expect(LABEL_FONT).toBe('500 12px "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace')
    expect(LABEL_HALO_PX).toBe(3)
    expect(LABEL_HALO_COLOR).toBe('rgba(232, 228, 220, 0.92)')
    expect(LABEL_INK_MAX_LUMINANCE).toBeCloseTo(
      (wcagLuminance(painterPaletteForTheme('light').board.fill) + 0.05) / 4.5 - 0.05,
      12,
    )
    expect(LABEL_MIN_MAX_WIDTH_PX).toBe(220)
    expect(LABEL_ANCHOR_OFFSET_X_PX).toBe(6)
    expect(LABEL_ANCHOR_OFFSET_Y_PX).toBe(11)
  })

  it('LABEL_MAX_WIDTH_PX = max(220, cardWidthPx): never below 220, wider cards use their own width', () => {
    expect(labelMaxWidthPx(40)).toBe(220)
    expect(labelMaxWidthPx(220)).toBe(220)
    expect(labelMaxWidthPx(301.5)).toBe(301.5)
  })

  it('the rendered width is the spec rule bounded by the 512px render cap', () => {
    expect(labelRenderMaxWidthPx(40)).toBe(220)
    expect(labelRenderMaxWidthPx(301.5)).toBe(301.5)
    expect(labelRenderMaxWidthPx(5000)).toBe(LABEL_MAX_RENDER_WIDTH_PX)
  })
})

describe('labelBandEligible — pure band rule, zoom-pure by construction', () => {
  it('Map shows landmarks only (tiers 1–2)', () => {
    expect(labelBandEligible('map', 'landmark')).toBe(true)
    expect(labelBandEligible('map', 'user-authored')).toBe(false)
    expect(labelBandEligible('map', 'system-generated')).toBe(false)
  })

  it('Overview shows all tiers', () => {
    expect(labelBandEligible('overview', 'landmark')).toBe(true)
    expect(labelBandEligible('overview', 'user-authored')).toBe(true)
    expect(labelBandEligible('overview', 'system-generated')).toBe(true)
  })

  it('Reading shows none — the DOM card renders the name', () => {
    expect(labelBandEligible('reading', 'landmark')).toBe(false)
    expect(labelBandEligible('reading', 'user-authored')).toBe(false)
    expect(labelBandEligible('reading', 'system-generated')).toBe(false)
  })
})

describe('ink darkening — ≥ 4.5:1 against --paper', () => {
  const lightPalette = painterPaletteForTheme('light')
  const headerColorSamples = ['#d7ad45', '#ff0000', '#00c8ff', '#ffffff', '#e6b3ff', '#77b08c']

  it('darkens every kind colour to relative luminance ≤ 0.176 and WCAG ≥ 4.5:1 vs --paper', () => {
    for (const [kind, palette] of Object.entries(KIND_COLORS)) {
      const ink = darkenToLabelInk(palette.stroke)
      expect(wcagLuminance(ink), `${kind} ${palette.stroke} → ${ink}`).toBeLessThanOrEqual(
        LABEL_INK_MAX_LUMINANCE,
      )
      expect(contrastVsPaper(ink), `${kind} ${palette.stroke} → ${ink}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('darkens sampled header colours to ≤ 0.176 and ≥ 4.5:1 — askAi #d7ad45 (~2.0:1 untreated) included', () => {
    expect(contrastVsPaper('#d7ad45')).toBeLessThan(4.5) // proves darkening is mandatory, not cosmetic
    for (const color of headerColorSamples) {
      const ink = darkenToLabelInk(color)
      expect(wcagLuminance(ink), `${color} → ${ink}`).toBeLessThanOrEqual(LABEL_INK_MAX_LUMINANCE)
      expect(contrastVsPaper(ink), `${color} → ${ink}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('darkens minimally: the ink sits just under the luminance target, not at black', () => {
    const ink = darkenToLabelInk('#d7ad45')
    expect(wcagLuminance(ink)).toBeGreaterThan(LABEL_INK_MAX_LUMINANCE * 0.9)
  })

  it('passes already-compliant colours through unchanged', () => {
    expect(darkenToLabelInk('#333333')).toBe('#333333')
    expect(darkenToLabelInk('#000000')).toBe('#000000')
  })

  it('falls back to a known-compliant ink for unparseable colour strings', () => {
    expect(darkenToLabelInk('var(--accent)')).toBe(LABEL_FALLBACK_INK)
    expect(wcagLuminance(LABEL_FALLBACK_INK)).toBeLessThanOrEqual(LABEL_INK_MAX_LUMINANCE)
  })

  it('exports a relativeLuminance that agrees with the independent WCAG math', () => {
    for (const color of [PAPER, '#d7ad45', '#000000', '#5f5b52']) {
      expect(relativeLuminance(color)).toBeCloseTo(wcagLuminance(color), 9)
    }
    expect(relativeLuminance('not-a-colour')).toBeNull()
  })

  it('MEMOISES: the darkening function runs once per distinct colour, never per call', () => {
    const darken = vi.fn(darkenToLabelInk)
    const resolver = createLabelInkResolver((_palette, color) => darken(color))

    for (let call = 0; call < 500; call += 1) resolver.resolve(lightPalette, '#d7ad45')
    resolver.resolve(lightPalette, '#77b08c')

    expect(darken).toHaveBeenCalledTimes(2)
    expect(resolver.memoSize()).toBe(2)
  })

  it('MEMOISES across frames: repeated drawLabels calls never re-darken a seen colour', () => {
    const darken = vi.fn(darkenToLabelInk)
    const ink = createLabelInkResolver((_palette, color) => darken(color))
    const { draw } = paint({
      candidates: [candidate({ id: 'a', color: '#d7ad45' }), candidate({ id: 'b', x: 400, color: '#d7ad45' })],
      ink,
    })

    for (let frame = 0; frame < 10; frame += 1) draw()

    // 2 labels × 10 frames = 20 resolves, ONE darkening.
    expect(darken).toHaveBeenCalledTimes(1)
  })

  it('MEMOISES through the PRODUCTION resolver: un-injected drawLabels frames darken a colour once', () => {
    // No `ink` injection — this exercises drawLabels' real default seam, so
    // constructing a fresh resolver per drawLabels call goes red here (the
    // production counter would read 0 or 2, never 1).
    const context = recordingContext()
    const { factory } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    const freshColor = '#4c9e72' // unique to this test — the shared memo is process-wide
    const draw = () =>
      drawLabels({
        context,
        band: 'overview',
        candidates: [candidate({ color: freshColor }), candidate({ id: 'b', x: 400, color: freshColor })],
        viewportSize: VIEWPORT,
        devicePixelRatio: 2,
        palette: lightPalette,
        cache,
      })

    const before = labelInkDarkenInvocationsForTests()
    draw()
    draw()

    expect(labelInkDarkenInvocationsForTests() - before).toBe(1)
  })

  it('bounds the ink memo: LRU eviction at the entry cap, and an evicted colour recomputes correctly', () => {
    const darken = vi.fn(darkenToLabelInk)
    const resolver = createLabelInkResolver((_palette, color) => darken(color), 2)

    const firstInk = resolver.resolve(lightPalette, '#ff0000')
    resolver.resolve(lightPalette, '#00ff00')
    resolver.resolve(lightPalette, '#0000ff') // cap hit — evicts #ff0000, the LRU head

    expect(resolver.memoSize()).toBe(2)
    expect(darken).toHaveBeenCalledTimes(3)

    expect(resolver.resolve(lightPalette, '#ff0000')).toBe(firstInk) // recomputed, identical (pure)
    expect(darken).toHaveBeenCalledTimes(4)
    expect(resolver.memoSize()).toBe(2) // #00ff00 evicted in turn

    resolver.resolve(lightPalette, '#0000ff') // survived both evictions — still a hit
    expect(darken).toHaveBeenCalledTimes(4)
  })

  it('a mid-sequence re-read refreshes ink-memo recency: the untouched colour evicts, the re-read one survives', () => {
    const darken = vi.fn(darkenToLabelInk)
    const resolver = createLabelInkResolver((_palette, color) => darken(color), 2)

    resolver.resolve(lightPalette, '#ff0000')
    resolver.resolve(lightPalette, '#00ff00')
    resolver.resolve(lightPalette, '#ff0000') // hit — refreshes #ff0000 over #00ff00
    expect(darken).toHaveBeenCalledTimes(2)

    resolver.resolve(lightPalette, '#0000ff') // cap hit — evicts #00ff00 (LRU), NOT #ff0000
    expect(darken).toHaveBeenCalledTimes(3)

    resolver.resolve(lightPalette, '#ff0000') // still resident — no recompute
    expect(darken).toHaveBeenCalledTimes(3)
    resolver.resolve(lightPalette, '#00ff00') // evicted — recomputes
    expect(darken).toHaveBeenCalledTimes(4)
  })
})

describe('theme-ground label paint', () => {
  it.each(['light', 'dark'] as const)('resolves every semantic/custom sample to ≥4.5:1 in %s', (theme) => {
    const palette = painterPaletteForTheme(theme)
    const samples = [
      palette.label.ink,
      palette.cards.mod.stroke,
      palette.cards.conversation.stroke,
      '#d7ad45',
      '#6a4fb0',
      '#ffffff',
      '#000000',
    ]

    for (const source of samples) {
      const ink = resolveLabelInk(palette, source)
      expect(contrastRatio(ink, palette.board.fill), `${theme}: ${source} → ${ink}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('falls back to the active theme ink for unparseable custom header data', () => {
    for (const theme of ['light', 'dark'] as const) {
      const palette = painterPaletteForTheme(theme)
      expect(resolveLabelInk(palette, 'var(--custom-header)')).toBe(palette.label.ink)
    }
  })

  it('derives the actual translucent halo from each theme ground', () => {
    expect(labelHaloForPalette(painterPaletteForTheme('light'))).toBe('rgba(232, 228, 220, 0.92)')
    expect(labelHaloForPalette(painterPaletteForTheme('dark'))).toBe('rgba(30, 27, 25, 0.92)')
  })

  it('uses identical dark-theme halo, ink, and font on cached and direct paths', () => {
    const palette = painterPaletteForTheme('dark')
    const candidateUnderTest = candidate({ color: '#6a4fb0' })
    const cached = paint({ candidates: [candidateUnderTest], palette })
    cached.draw()
    const cachedStroke = cached.bitmaps[0].context.ops.find((op) => op.op === 'strokeText')
    const cachedFill = cached.bitmaps[0].context.ops.find((op) => op.op === 'fillText')

    const directContext = recordingContext()
    drawLabels({
      context: directContext,
      band: 'overview',
      candidates: [candidateUnderTest],
      viewportSize: VIEWPORT,
      devicePixelRatio: 2,
      palette,
      cache: createLabelBitmapCache({ createBitmapContext: () => null }),
    })
    const directStroke = directContext.ops.find((op) => op.op === 'strokeText')
    const directFill = directContext.ops.find((op) => op.op === 'fillText')

    expect(cachedStroke).toMatchObject({
      strokeStyle: labelHaloForPalette(palette),
      font: LABEL_FONT,
      lineWidth: LABEL_HALO_PX,
    })
    expect(directStroke).toMatchObject({
      strokeStyle: cachedStroke?.strokeStyle,
      font: cachedStroke?.font,
      lineWidth: cachedStroke?.lineWidth,
    })
    expect(directFill?.fillStyle).toBe(cachedFill?.fillStyle)
  })

  it('requests the exact label font and representative glyph sample', async () => {
    const load = vi.fn().mockResolvedValue([])

    await loadLabelFont({ load } as unknown as Pick<FontFaceSet, 'load'>)

    expect(load).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledWith(LABEL_FONT_LOAD, LABEL_FONT_SAMPLE)
  })
})

describe('ellipsis at LABEL_MAX_WIDTH_PX', () => {
  it('returns text that fits unchanged', () => {
    const resolved = ellipsizeToWidth('short name', 220, measureWidth)
    expect(resolved).toEqual({ text: 'short name', widthPx: 60 })
  })

  it('ellipsizes overflowing text to the longest prefix that fits', () => {
    const long = 'x'.repeat(60) // 360px at 6px/char
    const resolved = ellipsizeToWidth(long, 220, measureWidth)
    expect(resolved.text).toBe('x'.repeat(35) + '…') // 36 chars = 216px; 37 chars would be 222px
    expect(resolved.widthPx).toBeLessThanOrEqual(220)
    expect(resolved.widthPx + CHAR_WIDTH_PX).toBeGreaterThan(220)
  })
})

describe('anchor — card top-left + (6, 11) screen px', () => {
  // The full glyph box around an anchor spans x ∈ [anchor − pad, anchor +
  // labelWidth + pad] and y ∈ [baseline − 15, baseline + 8] (the bitmap box).
  const onScreen = (anchor: { x: number; y: number }, labelWidth: number) => ({
    left: anchor.x - LABEL_BITMAP_PAD_PX,
    right: anchor.x + labelWidth + LABEL_BITMAP_PAD_PX,
    top: anchor.y - LABEL_BITMAP_BASELINE_PX,
    bottom: anchor.y + (LABEL_BITMAP_CSS_HEIGHT_PX - LABEL_BITMAP_BASELINE_PX),
  })

  it('anchors at top-left + (6, 11) with the baseline on the y offset', () => {
    expect(labelAnchor({ x: 100, y: 50, width: 96, height: 54, pinToRegion: false }, VIEWPORT, 60)).toEqual({
      x: 106,
      y: 61,
    })
  })

  it('does NOT clamp plain cards — a card above the viewport keeps its off-screen anchor', () => {
    expect(labelAnchor({ x: -30, y: -40, width: 96, height: 54, pinToRegion: false }, VIEWPORT, 60)).toEqual({
      x: -24,
      y: -29,
    })
  })

  it('pins a region name fully on screen while the region hangs off the top-left', () => {
    const anchor = labelAnchor({ x: -500, y: -200, width: 2000, height: 1000, pinToRegion: true }, VIEWPORT, 100)
    expect(anchor).toEqual({ x: LABEL_BITMAP_PAD_PX, y: LABEL_BITMAP_BASELINE_PX })
    const box = onScreen(anchor, 100)
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.top).toBeGreaterThanOrEqual(0)
  })

  it('keeps the FULL glyph box on screen when the region is a sliver at the top (visibility beats the region edge)', () => {
    // Region bottom sits at y = 5: only a 5px strip is visible, but the name
    // is a landmark — the whole glyph box must remain readable (#310).
    const anchor = labelAnchor({ x: 200, y: -995, width: 2000, height: 1000, pinToRegion: true }, VIEWPORT, 100)
    expect(anchor.y).toBe(LABEL_BITMAP_BASELINE_PX)
    const box = onScreen(anchor, 100)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(VIEWPORT.height)
  })

  it('pins a region entering from the RIGHT edge inside the viewport', () => {
    const anchor = labelAnchor({ x: 1150, y: 300, width: 2000, height: 1000, pinToRegion: true }, VIEWPORT, 100)
    expect(anchor).toEqual({ x: VIEWPORT.width - 100 - LABEL_BITMAP_PAD_PX, y: 311 })
    expect(onScreen(anchor, 100).right).toBeLessThanOrEqual(VIEWPORT.width)
  })

  it('pins a region entering from the BOTTOM edge inside the viewport', () => {
    const anchor = labelAnchor({ x: 200, y: 790, width: 2000, height: 1000, pinToRegion: true }, VIEWPORT, 100)
    expect(anchor).toEqual({ x: 206, y: VIEWPORT.height - (LABEL_BITMAP_CSS_HEIGHT_PX - LABEL_BITMAP_BASELINE_PX) })
    expect(onScreen(anchor, 100).bottom).toBeLessThanOrEqual(VIEWPORT.height)
  })

  it('leaves an on-screen region name at the region top-left inside edge', () => {
    expect(labelAnchor({ x: 40, y: 30, width: 800, height: 600, pinToRegion: true }, VIEWPORT, 100)).toEqual({
      x: 46,
      y: 41,
    })
  })

  it('lets the top-left bound win when the label is wider than the viewport', () => {
    const anchor = labelAnchor({ x: -50, y: 300, width: 4000, height: 1000, pinToRegion: true }, VIEWPORT, 5000)
    expect(anchor.x).toBe(LABEL_BITMAP_PAD_PX)
  })
})

describe('bitmap cache — content-addressed, LRU by bytes', () => {
  const request = (overrides: Record<string, unknown> = {}) => ({
    text: 'aaaa',
    ink: '#5f5b52',
    paletteKey: 'light:v1',
    halo: 'rgba(232, 228, 220, 0.92)',
    font: LABEL_FONT,
    fontRevision: 0,
    dpr: 1,
    textWidthPx: measureWidth('aaaa'),
    ...overrides,
  })
  // dpr 1 entry for 'aaaa': css 30×23 → 30·23·4 = 2760 bytes.
  const ENTRY_BYTES = (24 + LABEL_BITMAP_PAD_PX * 2) * LABEL_BITMAP_CSS_HEIGHT_PX * 4

  it('renders a cold miss and serves the identical request as a hit', () => {
    const { factory, bitmaps } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })

    cache.beginFrame()
    const first = cache.bitmapFor(request())
    const second = cache.bitmapFor(request())

    expect(cache.missesThisFrame()).toBe(1)
    expect(second).toBe(first)
    expect(bitmaps).toHaveLength(1)
    expect(cache.entryCount()).toBe(1)
    expect(cache.byteSize()).toBe(ENTRY_BYTES)
  })

  it('keys on text: a text change is a new entry', () => {
    const { factory } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()
    cache.bitmapFor(request())
    cache.bitmapFor(request({ text: 'aaab' }))
    expect(cache.missesThisFrame()).toBe(2)
    expect(cache.entryCount()).toBe(2)
  })

  it('keys on ink: an ink change is a new entry', () => {
    const { factory } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()
    cache.bitmapFor(request())
    cache.bitmapFor(request({ ink: '#123456' }))
    expect(cache.missesThisFrame()).toBe(2)
    expect(cache.entryCount()).toBe(2)
  })

  it('misses when only the palette identity changes', () => {
    const { factory, bitmaps } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()

    cache.bitmapFor(request())
    cache.bitmapFor(request({ paletteKey: 'dark:v1' }))

    expect(cache.missesThisFrame()).toBe(2)
    expect(cache.entryCount()).toBe(2)
    expect(bitmaps).toHaveLength(2)
  })

  it('misses when only the actual halo paint changes', () => {
    const { factory, bitmaps } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()

    cache.bitmapFor(request())
    cache.bitmapFor(request({ halo: 'rgba(44, 44, 44, 0.92)' }))

    expect(cache.missesThisFrame()).toBe(2)
    expect(cache.entryCount()).toBe(2)
    expect(bitmaps).toHaveLength(2)
  })

  it('keys on the full font and font-load revision', () => {
    const { factory } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()

    cache.bitmapFor(request())
    cache.bitmapFor(request({ font: LABEL_FONT.replace('500 ', '600 '), fontRevision: 0 }))
    cache.bitmapFor(request({ fontRevision: 1 }))

    expect(cache.missesThisFrame()).toBe(3)
    expect(cache.entryCount()).toBe(3)
  })

  it('keys on measured bitmap size as well as text', () => {
    const { factory } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()

    cache.bitmapFor(request())
    cache.bitmapFor(request({ textWidthPx: measureWidth('aaaa') + 1 }))

    expect(cache.missesThisFrame()).toBe(2)
    expect(cache.entryCount()).toBe(2)
  })

  it('memoises label ink per palette identity', () => {
    const light = painterPaletteForTheme('light')
    const dark = painterPaletteForTheme('dark')
    const resolve = vi.fn((_palette: typeof light, color: string) => color)
    const resolver = createLabelInkResolver(resolve)

    resolver.resolve(light, '#6a4fb0')
    resolver.resolve(light, '#6a4fb0')
    resolver.resolve(dark, '#6a4fb0')

    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('keys on dpr: the same label at dpr 1 and dpr 2 are distinct entries with distinct bytes', () => {
    const { factory, bitmaps } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()
    cache.bitmapFor(request())
    cache.bitmapFor(request({ dpr: 2 }))
    expect(cache.missesThisFrame()).toBe(2)
    expect(cache.entryCount()).toBe(2)
    expect(bitmaps[1].source.deviceWidth).toBe(bitmaps[0].source.deviceWidth * 2)
    expect(cache.byteSize()).toBe(ENTRY_BYTES + ENTRY_BYTES * 4)
  })

  it('evicts least-recently-USED (not least-recently-inserted) at the byte ceiling', () => {
    const { factory } = recordingBitmapFactory()
    // Ceiling fits two entries, not three.
    const cache = createLabelBitmapCache({ maxBytes: ENTRY_BYTES * 2, createBitmapContext: factory })
    cache.beginFrame()

    cache.bitmapFor(request({ text: 'aaaA' })) // miss 1
    cache.bitmapFor(request({ text: 'aaaB' })) // miss 2
    cache.bitmapFor(request({ text: 'aaaA' })) // hit — refreshes A over B
    cache.bitmapFor(request({ text: 'aaaC' })) // miss 3 — evicts B (LRU), not A

    expect(cache.missesThisFrame()).toBe(3)
    expect(cache.entryCount()).toBe(2)
    expect(cache.byteSize()).toBeLessThanOrEqual(ENTRY_BYTES * 2)

    cache.bitmapFor(request({ text: 'aaaA' })) // still resident — no miss
    expect(cache.missesThisFrame()).toBe(3)
    cache.bitmapFor(request({ text: 'aaaB' })) // evicted — misses again
    expect(cache.missesThisFrame()).toBe(4)
  })

  it('refuses a request wider than the render bound BEFORE allocation — no surface is ever created', () => {
    const { factory, bitmaps } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()

    const bitmap = cache.bitmapFor(request({ textWidthPx: 5000 }))

    expect(bitmap).toBeNull()
    expect(bitmaps).toHaveLength(0) // admission ran first: nothing allocated
    expect(cache.missesThisFrame()).toBe(1) // still a miss — the caller direct-draws
    expect(cache.entryCount()).toBe(0)
    expect(cache.byteSize()).toBe(0)
  })

  it('refuses a request over the byte ceiling BEFORE allocation', () => {
    const { factory, bitmaps } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ maxBytes: 100, createBitmapContext: factory })
    cache.beginFrame()

    expect(cache.bitmapFor(request())).toBeNull() // 2760 B > 100 B ceiling
    expect(bitmaps).toHaveLength(0)
    expect(cache.entryCount()).toBe(0)
  })

  it('owns the max-entry invariant: a dpr-3 512px request exceeds LABEL_MAX_ENTRY_BYTES and is refused pre-allocation', () => {
    // 518 css px × 3 = 1554 × 69 device px × 4 B = 428,904 B > 190,624 B.
    // The layer clamps dpr to 2, but the CACHE must not rely on that — the
    // frame-cap arithmetic is keyed to LABEL_MAX_ENTRY_BYTES.
    const { factory, bitmaps } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()

    const bitmap = cache.bitmapFor(request({ textWidthPx: LABEL_MAX_RENDER_WIDTH_PX, dpr: 3 }))

    expect(bitmap).toBeNull()
    expect(bitmaps).toHaveLength(0) // refused BEFORE allocation
    expect(cache.missesThisFrame()).toBe(1) // direct-drawn by the caller, counted
    expect(cache.entryCount()).toBe(0)
  })

  it('admits a max-render-width entry at exactly LABEL_MAX_ENTRY_BYTES', () => {
    const { factory } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()

    const bitmap = cache.bitmapFor(request({ textWidthPx: LABEL_MAX_RENDER_WIDTH_PX, dpr: 2 }))

    expect(bitmap).not.toBeNull()
    expect(bitmap?.bytes).toBe(LABEL_MAX_ENTRY_BYTES)
    expect(cache.byteSize()).toBe(LABEL_MAX_ENTRY_BYTES)
  })

  it('renders the frozen spec into the bitmap: halo stroke first, ink fill second, dpr transform', () => {
    const { factory, bitmaps } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()
    cache.bitmapFor(request({ dpr: 2, ink: '#8a6f2c' }))

    const ops = bitmaps[0].context.ops
    expect(ops[0]).toMatchObject({ op: 'setTransform', args: [2, 0, 0, 2, 0, 0] })
    const strokeIndex = ops.findIndex((op) => op.op === 'strokeText')
    const fillIndex = ops.findIndex((op) => op.op === 'fillText')
    expect(strokeIndex).toBeGreaterThanOrEqual(0)
    expect(fillIndex).toBeGreaterThan(strokeIndex) // halo UNDER the ink

    const stroke = ops[strokeIndex]
    expect(stroke.font).toBe(LABEL_FONT)
    expect(stroke.textBaseline).toBe('alphabetic')
    expect(stroke.strokeStyle).toBe(LABEL_HALO_COLOR)
    expect(stroke.lineWidth).toBe(LABEL_HALO_PX)
    expect(stroke.lineJoin).toBe('round')
    expect(stroke.miterLimit).toBe(2)
    expect(stroke.args).toEqual(['aaaa', LABEL_BITMAP_PAD_PX, LABEL_BITMAP_BASELINE_PX])

    const fill = ops[fillIndex]
    expect(fill.fillStyle).toBe('#8a6f2c')
    expect(fill.args).toEqual(['aaaa', LABEL_BITMAP_PAD_PX, LABEL_BITMAP_BASELINE_PX])
  })

  it('uses the full request font as the sole per-request font authority', () => {
    const font = LABEL_FONT.replace('500 ', '600 ')
    const { factory, bitmaps } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    cache.beginFrame()

    cache.bitmapFor(request({ font }))

    expect(bitmaps[0].context.ops.find((op) => op.op === 'strokeText')?.font).toBe(font)
    expect(bitmaps[0].context.ops.find((op) => op.op === 'fillText')?.font).toBe(font)
  })
})

describe('cold-miss budget arithmetic (E4 provenance)', () => {
  it('one frame at the label cap always fits the byte ceiling — EXACT for every admissible entry, because the cache enforces the render-width bound at admission', () => {
    expect(LABEL_FRAME_LABEL_CAP * LABEL_MAX_ENTRY_BYTES).toBeLessThanOrEqual(LABEL_CACHE_MAX_BYTES)
  })

  it('pins the budget constants the doc-comment arithmetic is written against', () => {
    expect(LABEL_MAX_RENDER_WIDTH_PX).toBe(512)
    expect(LABEL_CACHE_MAX_BYTES).toBe(64 * 1024 * 1024)
    expect(LABEL_MAX_ENTRY_BYTES).toBe(1036 * 46 * 4) // (512+2·3) css px at dpr 2 × 23 css px at dpr 2 × RGBA
    expect(LABEL_FRAME_LABEL_CAP).toBe(352)
    expect(LABEL_AREA_PER_LABEL_PX2).toBe(6000)
    // The ceiling is sized so the frame cap stays above the laptop-class
    // area cap — the area rule remains the binding one on common hardware.
    expect(LABEL_FRAME_LABEL_CAP).toBeGreaterThan(paintedLabelFrameCap({ width: 1512, height: 982 }))
  })

  it('area-caps painted labels per frame and bounds the cap by the cache-fit frame cap', () => {
    expect(paintedLabelFrameCap({ width: 100, height: 120 })).toBe(2)
    expect(paintedLabelFrameCap({ width: 1512, height: 982 })).toBe(248)
    expect(paintedLabelFrameCap({ width: 100000, height: 100000 })).toBe(LABEL_FRAME_LABEL_CAP)
    expect(paintedLabelFrameCap({ width: 0, height: 0 })).toBe(0)
  })
})

describe('drawLabels', () => {
  it('applies ordinary-label alpha at the cached-bitmap blit without changing blit or counter counts', () => {
    const ordinaryLabelAlpha = 0.25
    const { context, draw } = paint({ candidates: [candidate()], ordinaryLabelAlpha })

    const counters = draw()
    const blits = context.ops.filter((op) => op.op === 'drawImage')

    expect(blits).toHaveLength(counters.paintedLabelCount)
    expect(blits[0].globalAlpha).toBe(ordinaryLabelAlpha)
    expect(counters).toMatchObject({
      paintedLabelCount: 1,
      labelCacheMissesPerFrame: 1,
      drawn: 1,
      ramped: 0,
      dropped: 0,
      eligibleLabelCandidateCount: 1,
    })
  })

  it('cold miss renders AND blits the same frame — never skipped — then hits the next frame', () => {
    const { context, bitmaps, draw } = paint({ candidates: [candidate()] })

    const first = draw()

    expect(first.paintedLabelCount).toBe(1)
    expect(first.labelCacheMissesPerFrame).toBe(1)
    expect(first.cacheEntries).toBe(1)
    expect(bitmaps).toHaveLength(1)
    expect(context.ops.filter((op) => op.op === 'drawImage')).toHaveLength(1)

    const second = draw()

    expect(second.labelCacheMissesPerFrame).toBe(0)
    expect(bitmaps).toHaveLength(1) // no re-render
    expect(context.ops.filter((op) => op.op === 'drawImage')).toHaveLength(2) // still blitted
  })

  it('blits at anchor top-left + (6, 11) minus the bitmap pad/baseline, at css size', () => {
    // 'A card name' = 11 chars = 66px wide → bitmap css 66+6 = 72 × 23.
    const { context, draw } = paint({ candidates: [candidate({ x: 100, y: 50 })] })

    draw()

    const [blit] = context.ops.filter((op) => op.op === 'drawImage')
    expect(blit.args.slice(1)).toEqual([
      100 + 6 - LABEL_BITMAP_PAD_PX,
      50 + 11 - LABEL_BITMAP_BASELINE_PX,
      72,
      LABEL_BITMAP_CSS_HEIGHT_PX,
    ])
  })

  it('overflows right past a narrow card, never clipped: 180px of text on a 40px card draws whole', () => {
    const text = 'y'.repeat(30) // 180px
    const { bitmaps, draw } = paint({ candidates: [candidate({ text, width: 40 })] })

    draw()

    expect(bitmaps[0].context.ops.find((op) => op.op === 'fillText')?.args[0]).toBe(text)
  })

  it('bounds the rendered width at 512px on an arbitrarily wide card — the cache entry lands at the bound, cached', () => {
    const text = 'w'.repeat(100) // 600px at 6px/char — past the render bound
    const { bitmaps, cache, draw } = paint({ candidates: [candidate({ text, width: 5000 })] })

    const counters = draw()

    // Longest prefix + '…' fitting 512px: 85 chars × 6px = 510px.
    expect(bitmaps[0].context.ops.find((op) => op.op === 'fillText')?.args[0]).toBe('w'.repeat(84) + '…')
    expect(counters.paintedLabelCount).toBe(1)
    expect(counters.cacheEntries).toBe(1) // within bound → admitted, not direct-drawn
    expect(cache.byteSize()).toBeLessThanOrEqual(LABEL_MAX_ENTRY_BYTES)
  })

  it('ellipsizes at max(220, cardWidthPx): narrow card at 220, wider card at its own width', () => {
    const text = 'z'.repeat(45) // 270px
    const { bitmaps, draw } = paint({
      candidates: [candidate({ id: 'narrow', text, width: 96 }), candidate({ id: 'wide', text, width: 300, x: 500 })],
    })

    draw()

    const drawnTexts = bitmaps.map(
      (bitmap) => bitmap.context.ops.find((op) => op.op === 'fillText')?.args[0],
    )
    expect(drawnTexts[0]).toBe('z'.repeat(35) + '…') // 216px ≤ 220
    expect(drawnTexts[1]).toBe(text) // 270px ≤ 300 — the wide card holds its own title
  })

  it('applies band eligibility: Map paints landmarks only; Reading suppresses only mounted cards', () => {
    const candidates = [
      candidate({ id: 'group', displayPriority: 'landmark' }),
      candidate({ id: 'note', displayPriority: 'user-authored', x: 300 }),
      candidate({ id: 'result', displayPriority: 'system-generated', x: 500 }),
    ]

    expect(paint({ candidates, band: 'map' }).draw().paintedLabelCount).toBe(1)
    expect(paint({ candidates, band: 'overview' }).draw().paintedLabelCount).toBe(3)
    const reading = paint({
      candidates: candidates.map((item) => ({ ...item, mountedInReading: item.id !== 'result' })),
      band: 'reading',
    })
    expect(reading.draw()).toMatchObject({ paintedLabelCount: 1, eligibleLabelCandidateCount: 1 })
    expect(reading.bitmaps[0].context.ops.find((op) => op.op === 'fillText')?.args[0]).toBe('A card name')
  })

  it('area-caps the painted count, in stable candidate order', () => {
    const candidates = Array.from({ length: 6 }, (_, index) =>
      candidate({ id: `c${index}`, text: `Card ${index}`, x: index * 150 }),
    )
    // 100×120 viewport → area cap 2.
    const { bitmaps, draw } = paint({ candidates, viewportSize: { width: 100, height: 120 } })

    const counters = draw()

    expect(counters.paintedLabelCount).toBe(2)
    expect(counters.dropped).toBe(4) // past the cap — dropped, never silently skipped
    expect(counters.eligibleLabelCandidateCount).toBe(6)
    // The cap keeps the FIRST candidates in walk order (equal tier and area →
    // id asc); bitmaps render in paint order, which is reverse-priority so
    // winners composite on top.
    expect(bitmaps.map((bitmap) => bitmap.context.ops.find((op) => op.op === 'fillText')?.args[0])).toEqual([
      'Card 1',
      'Card 0',
    ])
  })

  it('skips empty-text candidates', () => {
    const counters = paint({ candidates: [candidate({ text: '' })] }).draw()
    expect(counters.paintedLabelCount).toBe(0)
  })

  it('draws the same spec straight onto the layer when no offscreen 2d surface exists', () => {
    const context = recordingContext()
    const cache = createLabelBitmapCache({ createBitmapContext: () => null })

    const counters = drawLabels({
      context,
      band: 'overview',
      candidates: [candidate({ x: 100, y: 50 })],
      viewportSize: VIEWPORT,
      devicePixelRatio: 2,
      palette: LIGHT_PALETTE,
      cache,
    })

    expect(counters.paintedLabelCount).toBe(1)
    expect(counters.labelCacheMissesPerFrame).toBe(1)
    expect(counters.cacheEntries).toBe(0)
    const stroke = context.ops.find((op) => op.op === 'strokeText')
    const fill = context.ops.find((op) => op.op === 'fillText')
    expect(stroke).toMatchObject({
      args: ['A card name', 106, 61],
      strokeStyle: LABEL_HALO_COLOR,
      lineWidth: LABEL_HALO_PX,
      lineJoin: 'round',
      miterLimit: 2,
      font: LABEL_FONT,
    })
    expect(fill?.args).toEqual(['A card name', 106, 61])
    expect(context.ops.indexOf(stroke!)).toBeLessThan(context.ops.indexOf(fill!))
  })
})

// ---------------------------------------------------------------------------
// Integration through drawOverviewLayer: candidates, counters, band rules.

function fakeCanvas(context: RecordingContext): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    style: {},
    dataset: {} as DOMStringMap,
    getContext: () => context,
  } as unknown as HTMLCanvasElement
}

function note(id: string, x: number, y: number, overrides: Partial<Card> = {}): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: `Note ${id}` }],
    position: { x, y },
    ...overrides,
  } as Card
}

function drawLayer({
  cards,
  zoom,
  reactCardIds = new Set<string>(),
  withSummaries = true,
  renderIndex,
  viewport,
  labelSortCache,
  selectedCardIds,
  cardSummariesById,
}: {
  cards: Card[]
  zoom: number
  reactCardIds?: ReadonlySet<string>
  withSummaries?: boolean
  renderIndex?: ReturnType<typeof createBoardRenderIndex>
  viewport?: { x: number; y: number; zoom: number }
  labelSortCache?: ReturnType<typeof createLabelSortCache>
  selectedCardIds?: ReadonlySet<string>
  cardSummariesById?: ReadonlyMap<string, ReturnType<typeof summaryForCard>>
}) {
  const context = recordingContext()
  const canvas = fakeCanvas(context)
  drawOverviewLayer({
    canvas,
    renderIndex: renderIndex ?? createBoardRenderIndex(cards, []),
    cards,
    connections: [],
    connectionCandidateCount: 0,
    viewport: viewport ?? { x: 20, y: 20, zoom },
    viewportSize: VIEWPORT,
    renderCards: true,
    selectedCardIds: selectedCardIds ?? new Set(),
    hoveredCardId: null,
    reactCardIds,
    suppressedCardIds: new Set(),
    measuredCardSizesById: new Map(),
    cardSummariesById:
      cardSummariesById ?? (withSummaries ? new Map(cards.map((card) => [card.id, summaryForCard(card)])) : undefined),
    labelSortCache,
    palette: painterPaletteForTheme('light'),
  })
  return { context, dataset: canvas.dataset as Record<string, string> }
}

describe('drawOverviewLayer label integration', () => {
  // jsdom has no 2d context, so the shared cache's offscreen factory yields
  // null and the layer takes the direct-draw path — which is exactly what
  // lets the recording context see the halo/ink ops.
  afterEach(() => vi.restoreAllMocks())
  const blockOffscreenBitmaps = () =>
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)

  it('exposes the four frozen dataset counters and paints every eligible Overview label', () => {
    blockOffscreenBitmaps()
    const cards = [note('a', 0, 0), note('b', 500, 100), note('c', 100, 400)]

    const { context, dataset } = drawLayer({ cards, zoom: 0.4 })

    expect(dataset.paintedLabelCount).toBe('3')
    expect(dataset.labelCacheMissesPerFrame).toBe('3') // direct-draw: every label re-renders
    expect(dataset.cacheEntries).toBe('0')
    expect(dataset.cacheBytes).toBe('0')

    const strokes = context.ops.filter((op) => op.op === 'strokeText')
    const fills = context.ops.filter((op) => op.op === 'fillText')
    expect(strokes).toHaveLength(3)
    expect(fills).toHaveLength(3)
    for (const stroke of strokes) {
      expect(stroke.strokeStyle).toBe(LABEL_HALO_COLOR)
      expect(stroke.lineWidth).toBe(LABEL_HALO_PX)
      expect(stroke.font).toBe(LABEL_FONT)
    }
    // Anchors: card top-left + (6, 11) at zoom 0.4 with viewport (20, 20).
    // Paint order is reverse-priority (winners on top), so 'Note a' (id asc
    // first in walk order) paints LAST.
    expect(strokes[2].args).toEqual(['Note a', 0 * 0.4 + 20 + 6, 0 * 0.4 + 20 + 11])
  })

  it('paints only landmark labels at the Map band', () => {
    blockOffscreenBitmaps()
    // A Group is the landmark that still reaches this layer. A Title card is
    // the other landmark kind, but it now paints its own board-space text and
    // deliberately never enters the screen-space label layer.
    const cards = [
      note('a', 0, 0),
      note('landmark', 500, 100, { kind: 'group', title: 'North star' } as Partial<Card>),
    ]

    const { context, dataset } = drawLayer({ cards, zoom: 0.1 })

    expect(dataset.representation).toBe('map')
    expect(dataset.paintedLabelCount).toBe('1')
    expect(context.ops.filter((op) => op.op === 'fillText').map((op) => op.args[0])).toEqual([
      'North star',
    ])
  })

  it.each([0.14, 0.16])('applies the zoom-pure crossfade t to an ordinary label at zoom %s', (zoom) => {
    blockOffscreenBitmaps()
    const fade = bandCrossfade(zoom, {
      mapMaxZoom: MAP_BAND_MAX_ZOOM,
      readingMinZoom: READING_BAND_MIN_ZOOM,
    })

    const { context, dataset } = drawLayer({ cards: [note('a', 0, 0)], zoom })
    const fills = context.ops.filter((op) => op.op === 'fillText')

    expect(fade).toMatchObject({ from: 'map', to: 'overview' })
    expect(fills).toHaveLength(Number(dataset.paintedLabelCount))
    expect(fills[0].globalAlpha).toBe(fade!.t)
    expect(dataset.paintedLabelCount).toBe('1')
    expect(dataset.drawn).toBe('1')
    expect(dataset.dropped).toBe('0')
    expect(dataset.ramped).toBe('0')
    expect(dataset.eligibleLabelCandidateCount).toBe('1')
  })

  it('suppresses a mounted Reading card label while retaining an unmounted overflow label', () => {
    blockOffscreenBitmaps()
    const cards = [note('a', 0, 0), note('b', 500, 100)]

    const { context, dataset } = drawLayer({ cards, zoom: 1, reactCardIds: new Set(['b']) })

    expect(dataset.silhouetteCardCount).toBe('1')
    expect(dataset.paintedLabelCount).toBe('1')
    expect(context.ops.filter((op) => op.op === 'fillText').map((op) => op.args[0])).toEqual(['Note a'])
  })

  it('draws a labelless frame with zeroed counters when no summaries are supplied (pre-#310 callers)', () => {
    const cards = [note('a', 0, 0)]

    const { context, dataset } = drawLayer({ cards, zoom: 0.4, withSummaries: false })

    expect(dataset.paintedLabelCount).toBe('0')
    expect(context.ops.filter((op) => op.op === 'fillText' || op.op === 'strokeText')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Declutter (#311): priority sort, greedy grid walk, geometry fade.

const resolveTestText = (text: string, maxWidthPx: number) =>
  ellipsizeToWidth(text, maxWidthPx, measureWidth)

function declutter(
  candidates: LabelCandidate[],
  options: {
    band?: 'reading' | 'overview' | 'map'
    fadePx?: number
    paintCap?: number
    viewportSize?: { width: number; height: number }
    order?: readonly number[]
  } = {},
) {
  return declutterLabels({
    band: options.band ?? 'overview',
    candidates,
    viewportSize: options.viewportSize ?? VIEWPORT,
    resolveText: resolveTestText,
    fadePx: options.fadePx,
    paintCap: options.paintCap,
    order: options.order,
  })
}

const placementOf = (result: ReturnType<typeof declutter>, id: string) =>
  result.placements.find((placement) => placement.id === id)

// Two default-size candidates on one row: anchors at (x+6, 61), blit boxes
// [x+3, x+75] × 23px tall ('A card name' = 66px + 2·3 pad). At a horizontal
// gap dx the boxes overlap by 72 − dx, so penetration = min(72 − dx, 23).
const pairAt = (dx: number, overrides: { a?: Partial<LabelCandidate>; b?: Partial<LabelCandidate> } = {}) => [
  candidate({ id: 'a', ...overrides.a }),
  candidate({ id: 'b', x: 100 + dx, ...overrides.b }),
]

describe('LABEL_CONTEST_FADE_PX — the T3 decision', () => {
  it('ships at exactly 6 screen px', () => {
    expect(LABEL_CONTEST_FADE_PX).toBe(6)
  })
})

describe('labelContestOpacity — smoothstep over overlap penetration', () => {
  it('is 1 at zero penetration and exactly 0 at the fade span', () => {
    expect(labelContestOpacity(0)).toBe(1)
    expect(labelContestOpacity(LABEL_CONTEST_FADE_PX)).toBe(0)
    expect(labelContestOpacity(23)).toBe(0)
  })

  it('spans EXACTLY the fade constant: still visible a hair inside, gone at the edge', () => {
    expect(labelContestOpacity(5.999)).toBeGreaterThan(0)
    expect(labelContestOpacity(6)).toBe(0)
  })

  it('decreases monotonically as penetration grows', () => {
    let previous = 1
    for (let penetration = 0.5; penetration <= 6; penetration += 0.5) {
      const opacity = labelContestOpacity(penetration)
      expect(opacity).toBeLessThan(previous)
      previous = opacity
    }
  })

  it('is the smoothstep: 0.5 at half the span, flat-tangent at both ends', () => {
    expect(labelContestOpacity(3)).toBeCloseTo(0.5, 12)
    // Near-zero slope at the ends is what removes the visible onset kink.
    expect(1 - labelContestOpacity(0.05)).toBeLessThan(0.001)
    expect(labelContestOpacity(5.95)).toBeLessThan(0.001)
  })

  it('fadePx = 0 IS the clean boolean snap — the only escape hatch, no other change', () => {
    expect(labelContestOpacity(0, 0)).toBe(1)
    expect(labelContestOpacity(0.001, 0)).toBe(0)
    expect(labelContestOpacity(23, 0)).toBe(0)
  })
})

describe('labelOverlapPenetrationPx', () => {
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

  it('is 0 for disjoint and edge-touching boxes', () => {
    expect(labelOverlapPenetrationPx(box(0, 0, 10, 10), box(20, 0, 30, 10))).toBe(0)
    expect(labelOverlapPenetrationPx(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(0)
    expect(labelOverlapPenetrationPx(box(0, 0, 10, 10), box(0, 10, 10, 20))).toBe(0)
  })

  it('is the smaller axis of the intersection', () => {
    expect(labelOverlapPenetrationPx(box(0, 0, 100, 23), box(96, 0, 200, 23))).toBe(4)
    expect(labelOverlapPenetrationPx(box(0, 0, 100, 23), box(0, 20, 100, 43))).toBe(3)
  })
})

describe('labelPriorityTier — displayPriority plus the draw-time override', () => {
  it('maps the bottom three tiers straight off displayPriority', () => {
    expect(labelPriorityTier('landmark', false, false)).toBe(1)
    expect(labelPriorityTier('user-authored', false, false)).toBe(2)
    expect(labelPriorityTier('system-generated', false, false)).toBe(3)
  })

  it('hover or selection lifts ANY card to tier 0 without reclassifying it', () => {
    expect(labelPriorityTier('system-generated', true, false)).toBe(0)
    expect(labelPriorityTier('system-generated', false, true)).toBe(0)
    expect(labelPriorityTier('landmark', true, true)).toBe(0)
  })
})

describe('position-independent cached sort — (tier asc, area desc, id asc)', () => {
  it('orders by tier, then larger area, then id — and never reads a coordinate', () => {
    const candidates = [
      candidate({ id: 'small-note', displayPriority: 'user-authored', width: 50, height: 50, x: 900 }),
      candidate({ id: 'landmark', displayPriority: 'landmark', width: 10, height: 10, x: 500 }),
      candidate({ id: 'hovered-result', displayPriority: 'system-generated', hovered: true, x: 700 }),
      candidate({ id: 'big-note', displayPriority: 'user-authored', width: 200, height: 100, x: 0 }),
      candidate({ id: 'result', displayPriority: 'system-generated', x: 300 }),
    ]

    const order = sortLabelCandidateIndices(candidates).map((index) => candidates[index].id)

    expect(order).toEqual(['hovered-result', 'landmark', 'big-note', 'small-note', 'result'])
  })

  it('breaks exact area ties by id ascending', () => {
    const candidates = [
      candidate({ id: 'z', x: 0 }),
      candidate({ id: 'a', x: 500 }),
      candidate({ id: 'm', x: 900 }),
    ]
    expect(sortLabelCandidateIndices(candidates).map((index) => candidates[index].id)).toEqual([
      'a',
      'm',
      'z',
    ])
  })

  it('is identical for identical input — deterministic, twice over', () => {
    const candidates = [
      candidate({ id: 'b', width: 120 }),
      candidate({ id: 'a', x: 400 }),
      candidate({ id: 'c', x: 800, displayPriority: 'landmark' }),
    ]
    expect(sortLabelCandidateIndices(candidates)).toEqual(sortLabelCandidateIndices(candidates))
  })

  // The rank cache key is four O(1) signals that jointly cover every rank
  // input: the render index's position-blind rankEpoch (membership + size +
  // kind), the value-keyed summaries map identity (displayPriority), the
  // hovered id, and the selection Set (amendment 16, #311).
  const sortInputsOf =
    (specs: Array<{ id: string; displayPriority?: CanvasDisplayPriority; area?: number }>) =>
    (visit: (id: string, displayPriority: CanvasDisplayPriority, area: number) => void) => {
      for (const spec of specs) {
        visit(spec.id, spec.displayPriority ?? ('user-authored' as CanvasDisplayPriority), spec.area ?? 5184)
      }
    }
  const keyOf = (
    rankInputsEpoch: number,
    summariesIdentity: unknown = 'summaries',
    hoveredCardId: string | null = null,
    selectedCardIds: ReadonlySet<string> = new Set(),
  ) => ({ rankInputsEpoch, summariesIdentity, hoveredCardId, selectedCardIds })

  it('a pure pan or zoom frame pays ZERO sort-key work: same key → cached ranks, entries never re-read', () => {
    const sortCache = createLabelSortCache()
    const summaries = {}
    const selection = new Set<string>()
    const entries = vi.fn(sortInputsOf([{ id: 'a' }, { id: 'b' }]))

    const ranks1 = sortCache.ranks(keyOf(7, summaries, null, selection), entries)
    // Pan and zoom frames: the viewport moved, no key signal did.
    const ranks2 = sortCache.ranks(keyOf(7, summaries, null, selection), entries)
    const ranks3 = sortCache.ranks(keyOf(7, summaries, null, selection), entries)

    expect(entries).toHaveBeenCalledTimes(1) // the sort inputs were read ONCE
    expect(sortCache.sortCountForTests()).toBe(1)
    expect(ranks2).toBe(ranks1) // the SAME cached map, not a recompute
    expect(ranks3).toBe(ranks1)
  })

  it('a position-only drag commit costs the label layer NOTHING: the epoch is position-blind, no scan runs here', () => {
    // Production: a drag commit refreshes the render index every animation
    // frame, but the index preserves its rankEpoch across position-only
    // patches (pinned in renderIndexCache.test.ts) — so the key is unchanged
    // and the sort inputs are never even visited.
    const sortCache = createLabelSortCache()
    const summaries = {}
    const selection = new Set<string>()
    const inputs = vi.fn(sortInputsOf([{ id: 'a' }, { id: 'b' }]))

    const ranks1 = sortCache.ranks(keyOf(3, summaries, null, selection), inputs)
    const ranks2 = sortCache.ranks(keyOf(3, summaries, null, selection), inputs) // drag frames: same epoch
    const ranks3 = sortCache.ranks(keyOf(3, summaries, null, selection), inputs)

    expect(sortCache.sortCountForTests()).toBe(1)
    expect(inputs).toHaveBeenCalledTimes(1) // ZERO label-layer scans after the initial build
    expect(ranks2).toBe(ranks1)
    expect(ranks3).toBe(ranks1)
  })

  it('an epoch move (resize/kind/membership) and a summaries-identity move (displayPriority) each rebuild', () => {
    const sortCache = createLabelSortCache()
    const summaries = {}
    const selection = new Set<string>()
    const inputs = sortInputsOf([{ id: 'a' }, { id: 'b' }])

    sortCache.ranks(keyOf(1, summaries, null, selection), inputs) // initial build
    sortCache.ranks(keyOf(2, summaries, null, selection), inputs) // epoch moved (resize)
    sortCache.ranks(keyOf(2, {}, null, selection), inputs) // summaries identity moved (priority)

    expect(sortCache.sortCountForTests()).toBe(3)
  })

  it('hover and selection changes rebuild directly — tier inputs live in the key, not the entries', () => {
    const sortCache = createLabelSortCache()
    const summaries = {}
    const selection = new Set<string>()
    const inputs = sortInputsOf([{ id: 'a' }, { id: 'b' }])

    sortCache.ranks(keyOf(1, summaries, null, selection), inputs)
    sortCache.ranks(keyOf(1, summaries, 'b', selection), inputs) // hover moved
    sortCache.ranks(keyOf(1, summaries, 'b', new Set(['a'])), inputs) // selection changed

    expect(sortCache.sortCountForTests()).toBe(3)
  })

  it('ranks by (tier, area desc, id) with the hover/selection override applied from the key', () => {
    const sortCache = createLabelSortCache()
    const ranks = sortCache.ranks(keyOf(1, {}, 'hov', new Set(['sel'])), sortInputsOf([
        { id: 'small', area: 100 },
        { id: 'hov', displayPriority: 'system-generated', area: 1 },
        { id: 'sel', displayPriority: 'system-generated', area: 1 },
        { id: 'big', area: 900 },
        { id: 'mark', displayPriority: 'landmark', area: 1 },
      ]),
    )

    expect([...ranks.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)).toEqual([
      'hov',
      'sel',
      'mark',
      'big',
      'small',
    ])
  })

  it('REGRESSION (review finding): a same-tier card RESIZE re-sorts — the area key lives on the cards collection', () => {
    const sortCache = createLabelSortCache()
    const selection = new Set<string>()
    // Two same-tier overlapping cards; 'first' starts larger and wins.
    const overlapping = (aArea: number, bArea: number, epoch: number) => {
      const ranks = sortCache.ranks(
        keyOf(epoch, 'summaries', null, selection),
        sortInputsOf([
          { id: 'first', area: aArea },
          { id: 'second', area: bArea },
        ]),
      )
      const candidates = pairAt(0, { a: { id: 'first' }, b: { id: 'second' } })
      const order = candidates
        .map((_, index) => index)
        .sort((a, b) => ranks.get(candidates[a].id)! - ranks.get(candidates[b].id)!)
      return declutter(candidates, { order })
    }

    const before = overlapping(200, 100, 1)
    expect(before.droppedIds).toEqual(['second'])

    // The user resizes 'second' past 'first': the render index bumps its
    // rank epoch, the key changes, the rank flips — the stale cached order
    // (the reviewer's repro) cannot survive.
    const after = overlapping(200, 400, 2)
    expect(after.droppedIds).toEqual(['first'])
    expect(sortCache.sortCountForTests()).toBe(2)
  })

  it('sorts through the PRODUCTION shared cache: un-injected drawLabels frames re-sort only on key change', () => {
    const context = recordingContext()
    const cache = createLabelBitmapCache({ createBitmapContext: recordingBitmapFactory().factory })
    const frame = [candidate({ id: 'sort-seam-1' }), candidate({ id: 'sort-seam-2', x: 400 })]
    const summaries = {}
    const selection = new Set<string>()
    const entries = vi.fn(sortInputsOf([{ id: 'sort-seam-1' }, { id: 'sort-seam-2' }]))
    const draw = (candidates: LabelCandidate[], hoveredCardId: string | null = null) =>
      drawLabels({
        context,
        band: 'overview',
        candidates,
        viewportSize: VIEWPORT,
        devicePixelRatio: 2,
        palette: LIGHT_PALETTE,
        cache,
        sortKey: { rankInputsEpoch: 1, summariesIdentity: summaries, hoveredCardId, selectedCardIds: selection },
        sortEntries: entries,
      })

    const before = labelDeclutterSortsForTests()
    draw(frame)
    draw(frame.map((c) => ({ ...c, x: c.x + 25 }))) // pure pan — same key references
    draw(frame.map((c) => ({ ...c, x: c.x + 50 }))) // still panning
    expect(labelDeclutterSortsForTests() - before).toBe(1)
    expect(entries).toHaveBeenCalledTimes(1) // zero sort-key reads on the pan frames

    draw(
      frame.map((c) => (c.id === 'sort-seam-1' ? { ...c, hovered: true } : c)),
      'sort-seam-1',
    )
    expect(labelDeclutterSortsForTests() - before).toBe(2)
  })

  it('culling changes need NO re-sort: the rank spans the whole board, a shrunken candidate list just buckets less', () => {
    const context = recordingContext()
    const cache = createLabelBitmapCache({ createBitmapContext: recordingBitmapFactory().factory })
    const cards = [{ id: 'cull-1' }, { id: 'cull-2' }, { id: 'cull-3' }]
    const selection = new Set<string>()
    const all = [
      candidate({ id: 'cull-1' }),
      candidate({ id: 'cull-2', x: 400 }),
      candidate({ id: 'cull-3', x: 800 }),
    ]
    const draw = (candidates: LabelCandidate[]) =>
      drawLabels({
        context,
        band: 'overview',
        candidates,
        viewportSize: VIEWPORT,
        devicePixelRatio: 2,
        palette: LIGHT_PALETTE,
        cache,
        sortKey: { rankInputsEpoch: 1, summariesIdentity: 'summaries', hoveredCardId: null, selectedCardIds: selection },
        sortEntries: sortInputsOf(cards as Array<{ id: string }>),
      })

    const before = labelDeclutterSortsForTests()
    expect(draw(all).eligibleLabelCandidateCount).toBe(3)
    expect(draw(all.slice(0, 2)).eligibleLabelCandidateCount).toBe(2) // a card culled out
    expect(draw(all).eligibleLabelCandidateCount).toBe(3) // and back in
    expect(labelDeclutterSortsForTests() - before).toBe(1) // no membership-driven re-sort
  })
})

describe('declutterLabels — greedy walk, priority precedence', () => {
  it('overlap → higher priority wins, the loser lands in droppedIds', () => {
    const result = declutter(
      pairAt(0, { a: { displayPriority: 'system-generated' }, b: { displayPriority: 'user-authored' } }),
    )

    expect(placementOf(result, 'b')?.outcome).toBe('drawn')
    expect(result.droppedIds).toEqual(['a'])
    expect(result).toMatchObject({ drawn: 1, ramped: 0, dropped: 1, eligibleLabelCandidateCount: 2 })
  })

  it('hover is always placed over a landmark without dropping the landmark', () => {
    const result = declutter(
      pairAt(0, {
        a: { displayPriority: 'system-generated', hovered: true },
        b: { displayPriority: 'landmark', width: 4000, height: 3000 },
      }),
    )

    expect(placementOf(result, 'a')).toMatchObject({ outcome: 'drawn', opacity: 1 })
    expect(placementOf(result, 'b')).toMatchObject({ outcome: 'drawn', opacity: 1 })
    expect(result.droppedIds).toEqual([])
  })

  it('landmark status comes only from displayPriority and survives a lower-tier collision', () => {
    const result = declutter([
      candidate({ id: 'ordinary-card', displayPriority: 'user-authored', width: 4000, height: 3000 }),
      candidate({ id: 'title-landmark', displayPriority: 'landmark', width: 10, height: 10 }),
    ])

    expect(placementOf(result, 'title-landmark')).toMatchObject({ outcome: 'drawn', opacity: 1 })
    expect(result.droppedIds).toEqual(['ordinary-card'])
  })

  it('overlapping landmarks are both drawn at full strength instead of dropping each other', () => {
    const result = declutter(
      pairAt(0, {
        a: { displayPriority: 'landmark', width: 4000, height: 3000 },
        b: { displayPriority: 'landmark', width: 10, height: 10 },
      }),
    )

    expect(result.placements.map(({ outcome, opacity }) => ({ outcome, opacity }))).toEqual([
      { outcome: 'drawn', opacity: 1 },
      { outcome: 'drawn', opacity: 1 },
    ])
    expect(result.droppedIds).toEqual([])
  })

  it('user-authored beats system-generated at the same anchor', () => {
    const result = declutter(
      pairAt(0, { a: { displayPriority: 'user-authored' }, b: { displayPriority: 'system-generated' } }),
    )
    expect(placementOf(result, 'a')?.outcome).toBe('drawn')
    expect(result.droppedIds).toEqual(['b'])
  })

  it('same-tier ties: larger area wins, then id ascending', () => {
    const byArea = declutter(pairAt(0, { b: { width: 300, height: 200 } }))
    expect(byArea.droppedIds).toEqual(['a'])

    const byId = declutter(pairAt(0))
    expect(byId.droppedIds).toEqual(['b'])
  })

  it('the hover override reorders WITHOUT reclassifying — displayPriority is untouched on the way through', () => {
    const candidates = pairAt(0, {
      a: { displayPriority: 'system-generated', hovered: true },
      b: { displayPriority: 'user-authored' },
    })
    const result = declutter(candidates)

    expect(placementOf(result, 'a')?.outcome).toBe('drawn')
    expect(candidates[0].displayPriority).toBe('system-generated')
  })

  it('hover always wins its collision, paints last, and stays at full strength', () => {
    const hovered = candidate({
      id: 'hovered-dust',
      text: 'Hovered dust',
      displayPriority: 'system-generated',
      hovered: true,
    })
    const selected = candidate({
      id: 'selected-large',
      text: 'Selected',
      selected: true,
      width: 4000,
      height: 3000,
    })
    const distant = candidate({ id: 'distant', text: 'Distant', x: 500 })
    const { context, bitmaps, draw } = paint({ candidates: [selected, hovered, distant] })

    const counters = draw()
    const blits = context.ops.filter((op) => op.op === 'drawImage')

    expect(counters).toMatchObject({ drawn: 2, ramped: 0, dropped: 1 })
    expect(blits).toHaveLength(2)
    expect(blits[blits.length - 1]?.args[0]).toBe(bitmaps.find((bitmap) =>
      bitmap.context.ops.some((op) => op.op === 'fillText' && op.args[0] === 'Hovered dust'),
    )?.source)
    expect(blits[blits.length - 1]?.globalAlpha).toBe(1)
    expect(placementOf(declutter([selected, hovered]), 'hovered-dust')).toMatchObject({ outcome: 'drawn', opacity: 1 })
    expect(hovered.displayPriority).toBe('system-generated')
  })

  it('a hovered card keeps its label in the Map band (tier-0 override); unhovered non-landmarks stay out', () => {
    const result = declutter(
      [
        candidate({ id: 'hovered-note', displayPriority: 'system-generated', hovered: true }),
        candidate({ id: 'plain-note', displayPriority: 'user-authored', x: 500 }),
        candidate({ id: 'region', displayPriority: 'landmark', x: 900 }),
      ],
      { band: 'map' },
    )

    expect(result.eligibleLabelCandidateCount).toBe(2)
    expect(result.placements.map((placement) => placement.id)).toEqual(['hovered-note', 'region'])
  })

  it('Reading excludes mounted cards from eligibility without hiding an unmounted painted card', () => {
    const result = declutter(
      pairAt(200, {
        a: { mountedInReading: true, hovered: true },
        b: { mountedInReading: false },
      }),
      { band: 'reading' },
    )
    expect(result).toMatchObject({ drawn: 1, ramped: 0, dropped: 0, eligibleLabelCandidateCount: 1 })
    expect(result.placements.map((placement) => placement.id)).toEqual(['b'])
  })

  it('past the paint cap the LOWEST-priority eligible candidates drop first', () => {
    const result = declutter(
      [
        candidate({ id: 'note-1', x: 0 }),
        candidate({ id: 'result-1', displayPriority: 'system-generated', x: 300 }),
        candidate({ id: 'landmark-1', displayPriority: 'landmark', x: 600 }),
      ],
      { paintCap: 2 },
    )

    expect(placementOf(result, 'landmark-1')?.outcome).toBe('drawn')
    expect(placementOf(result, 'note-1')?.outcome).toBe('drawn')
    expect(placementOf(result, 'result-1')?.outcome).toBe('dropped')
    expect(result).toMatchObject({ drawn: 2, dropped: 1, eligibleLabelCandidateCount: 3 })
  })

  it('is PURE: identical input produces identical placements, twice over', () => {
    const candidates = pairAt(69, { b: { displayPriority: 'system-generated' } })
    expect(declutter(candidates)).toEqual(declutter(candidates))
  })
})

describe('declutterLabels — the geometry fade', () => {
  // pairAt(dx): penetration = 72 − dx for dx in (49, 72]; 'a' wins on id.
  const loserOpacityAt = (dx: number, fadePx?: number) =>
    placementOf(declutter(pairAt(dx), { fadePx }), 'b')?.opacity ?? -1

  it('no contact → both drawn at full opacity', () => {
    const result = declutter(pairAt(80))
    expect(result).toMatchObject({ drawn: 2, ramped: 0, dropped: 0 })
  })

  it('the loser opacity decreases monotonically as overlap grows, and is 0 at full overlap', () => {
    const opacities = [72, 71, 70, 69, 68, 67, 66].map((dx) => loserOpacityAt(dx))
    for (let step = 1; step < opacities.length; step += 1) {
      expect(opacities[step]).toBeLessThan(opacities[step - 1])
    }
    expect(opacities[0]).toBe(1) // penetration 0 — clean
    expect(opacities[opacities.length - 1]).toBe(0) // penetration 6 — gone
    expect(loserOpacityAt(0)).toBe(0) // same anchor: full overlap
  })

  it('the ramp spans exactly LABEL_CONTEST_FADE_PX = 6 screen px of penetration', () => {
    expect(loserOpacityAt(72)).toBe(1) // penetration 0
    expect(loserOpacityAt(66.001)).toBeGreaterThan(0) // penetration 5.999
    expect(loserOpacityAt(66)).toBe(0) // penetration 6
  })

  it('a mid-ramp loser is RAMPED (counted, placed, partially visible), at the smoothstep value', () => {
    const result = declutter(pairAt(69)) // penetration 3 = half the span
    const loser = placementOf(result, 'b')

    expect(loser?.outcome).toBe('ramped')
    expect(loser?.opacity).toBeCloseTo(0.5, 12)
    expect(result).toMatchObject({ drawn: 1, ramped: 1, dropped: 0 })
    expect(result.droppedIds).toEqual([])
  })

  it('fadePx = 0 yields the clean boolean snap with NO other change — the loser drops at any penetration', () => {
    const snap = declutter(pairAt(71.5), { fadePx: 0 }) // penetration 0.5
    expect(placementOf(snap, 'b')?.outcome).toBe('dropped')
    expect(snap.droppedIds).toEqual(['b'])

    const clear = declutter(pairAt(72), { fadePx: 0 }) // penetration 0
    expect(clear).toMatchObject({ drawn: 2, dropped: 0, ramped: 0 })
  })

  it('suppression is weighted by the winner\'s own opacity: a fading winner releases its claim continuously', () => {
    // 'a' wins outright; 'b' ramps against it; 'c' (lowest, under 'b' only)
    // is suppressed in proportion to b's opacity, so as b fades, c recovers —
    // no third-party pop when b finally drops.
    const contested = declutter([
      candidate({ id: 'a' }),
      candidate({ id: 'b', x: 100 + 69, displayPriority: 'system-generated' }), // pen 3 vs a → 0.5
      // x = 185: clear of a's box entirely, a 3px vertical graze against b only.
      candidate({ id: 'c', x: 185, y: 50 + 20, displayPriority: 'system-generated', text: 'A card nam' }),
    ])
    const b = placementOf(contested, 'b')
    const c = placementOf(contested, 'c')
    expect(b?.opacity).toBeCloseTo(0.5, 12)
    // c overlaps b by 3px vertically (pen 3 → contest opacity 0.5), weighted
    // by b's own 0.5: v_c = 1 − 0.5·(1 − 0.5) = 0.75.
    expect(c?.opacity).toBeCloseTo(0.75, 12)

    // Once b is fully dropped (deep overlap with a), its claim vanishes and c
    // is untouched by it.
    const released = declutter([
      candidate({ id: 'a' }),
      candidate({ id: 'b', x: 100 + 60, displayPriority: 'system-generated' }), // pen 12 → dropped
      candidate({ id: 'c', x: 185, y: 50 + 20, displayPriority: 'system-generated', text: 'A card nam' }),
    ])
    expect(placementOf(released, 'b')?.outcome).toBe('dropped')
    expect(placementOf(released, 'c')?.opacity).toBe(1)
  })

  it('pair fade is temporally coherent: 0.25px pan steps move the loser opacity in small monotone decrements', () => {
    const opacities: number[] = []
    for (let dx = 73; dx >= 65; dx -= 0.25) opacities.push(loserOpacityAt(dx))

    for (let step = 1; step < opacities.length; step += 1) {
      const delta = opacities[step - 1] - opacities[step]
      expect(delta).toBeGreaterThanOrEqual(0) // never brightens while closing in
      expect(delta).toBeLessThanOrEqual(0.07) // ≤ smoothstep max slope × 0.25px
    }
    expect(opacities[0]).toBe(1)
    expect(opacities[opacities.length - 1]).toBe(0)
  })
})

describe('declutterLabels — ellipsis over dropping for the anchor\'s own card', () => {
  // Loser 'tail': 60px-wide card, 20-char title (120px) — the label fits the
  // 220px floor, so 66px of it overflows past the card. Winner 'win' sits to
  // the right, deep-overlapping ONLY that overflow tail.
  const tailText = 'abcdefghijklmnopqrst' // 20 chars = 120px
  const overflowPair = (winnerX: number) => [
    candidate({ id: 'win', displayPriority: 'landmark', x: winnerX, text: 'Winner name' }),
    candidate({ id: 'tail', width: 60, text: tailText }),
  ]

  it('a loser whose only sin is overflow TRUNCATES to its own card width and stays fully visible', () => {
    // Winner blit box starts at x = 170; tail's full box [103, 229] deep-
    // overlaps it, but its card-fit box [103, 163] (60 − 6 = 54px of text)
    // clears it entirely.
    const result = declutter(overflowPair(167))
    const tail = placementOf(result, 'tail')

    expect(tail?.outcome).toBe('drawn')
    expect(tail?.opacity).toBe(1)
    expect(tail?.text).toBe('abcdefgh…') // 8 chars + ellipsis = 54px
    expect(tail?.widthPx).toBe(54)
    expect(result.droppedIds).toEqual([])
  })

  it('when even the card-fit box is contested, the stub ramps/drops by ITS penetration — ellipsis first, fade second', () => {
    // Winner shifted far left: its box [123, 212] swallows the card-fit box
    // [103, 163] by 40px — past the fade span even truncated.
    const result = declutter(overflowPair(120))
    expect(placementOf(result, 'tail')?.outcome).toBe('dropped')
  })

  it('never truncates an uncontested label', () => {
    const result = declutter([candidate({ id: 'tail', width: 60, text: tailText })])
    expect(placementOf(result, 'tail')?.text).toBe(tailText)
  })
})

describe('declutter cache economics — frozen by amendment 4 (#311)', () => {
  it('a dropped label renders NO bitmap: cache entries == winners + ramped, factory calls == unique specs', () => {
    const { context, bitmaps, draw } = paint({
      candidates: pairAt(0, { a: { text: 'Winner label' }, b: { text: 'Loser label' } }),
    })

    const counters = draw()

    expect(counters).toMatchObject({ drawn: 1, ramped: 0, dropped: 1 })
    expect(counters.cacheEntries).toBe(counters.drawn + counters.ramped) // == 1
    expect(bitmaps).toHaveLength(1) // ONE factory call — the winner's spec only
    expect(bitmaps[0].context.ops.find((op) => op.op === 'fillText')?.args[0]).toBe('Winner label')
    expect(context.ops.filter((op) => op.op === 'drawImage')).toHaveLength(1)
  })

  it('a ramped label blits the CACHED bitmap under globalAlpha — alpha never enters the key, a new alpha is never a re-render', () => {
    const winner = candidate({ id: 'a', text: 'Winner label' })
    const loserAt = (dx: number) =>
      candidate({ id: 'b', x: 100 + dx, text: 'Loser label!', displayPriority: 'system-generated' })
    const context = recordingContext()
    const { bitmaps, factory } = recordingBitmapFactory()
    const cache = createLabelBitmapCache({ createBitmapContext: factory })
    const draw = (dx: number) =>
      drawLabels({
        context,
        band: 'overview',
        candidates: [winner, loserAt(dx)],
        viewportSize: VIEWPORT,
        devicePixelRatio: 2,
        palette: LIGHT_PALETTE,
        cache,
      })

    // Frame 1: penetration 3 ('Winner label' = 12 chars = 72px + pads → box
    // 78 wide; 'Loser label!' identical width) → loser at smoothstep(0.5).
    const frame1 = draw(75)
    expect(frame1).toMatchObject({ drawn: 1, ramped: 1, dropped: 0 })
    expect(frame1.cacheEntries).toBe(2) // winners + ramped
    expect(bitmaps).toHaveLength(2) // one factory call per unique spec

    const blits1 = context.ops.filter((op) => op.op === 'drawImage')
    expect(blits1).toHaveLength(2)
    expect(blits1[0].globalAlpha).toBeCloseTo(0.5, 12) // loser paints first (reverse priority) at its ramp value
    expect(blits1[1].globalAlpha).toBe(1) // winner composites on top, opaque

    // Frame 2: 1px pan apart → penetration 2, a DIFFERENT alpha. Same two
    // bitmaps, zero misses, zero factory calls — only globalAlpha moved.
    const frame2 = draw(76)
    expect(frame2.labelCacheMissesPerFrame).toBe(0)
    expect(bitmaps).toHaveLength(2)
    const blits2 = context.ops.filter((op) => op.op === 'drawImage').slice(2)
    expect(blits2[0].globalAlpha).toBeCloseTo(20 / 27, 12) // smoothstep at penetration 2 of 6
    expect(blits2[1].globalAlpha).toBe(1)
  })

  it('direct-draw fallback (no offscreen surface) strokes and fills the ramped label under the same globalAlpha', () => {
    const context = recordingContext()
    const cache = createLabelBitmapCache({ createBitmapContext: () => null })

    drawLabels({
      context,
      band: 'overview',
      candidates: pairAt(69, { b: { displayPriority: 'system-generated' } }),
      viewportSize: VIEWPORT,
      devicePixelRatio: 2,
      palette: LIGHT_PALETTE,
      cache,
    })

    const strokes = context.ops.filter((op) => op.op === 'strokeText')
    expect(strokes).toHaveLength(2)
    expect(strokes[0].globalAlpha).toBeCloseTo(0.5, 12) // the ramped loser
    expect(strokes[1].globalAlpha).toBe(1) // the winner, painted last
  })
})

// ---------------------------------------------------------------------------
// Digest fixtures — the temporal-coherence and accounting-identity proof.

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

/**
 * The digest fixture: an 8×10 jittered wall of labels, rows 16px apart
 * (labels are 23px tall — every row collides with its neighbours), columns
 * 70px apart (labels 36–144px wide — most columns collide too). Mixed tiers
 * and title lengths, fully deterministic, everything well inside the
 * viewport so the eligible set is identical at every pan step.
 */
function digestFixture(): LabelCandidate[] {
  const random = seededRandom(311)
  const priorities: CanvasDisplayPriority[] = ['landmark', 'user-authored', 'system-generated']
  const candidates: LabelCandidate[] = []
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const index = row * 10 + col
      candidates.push(
        candidate({
          id: `fx-${String(index).padStart(2, '0')}`,
          text: `L${'x'.repeat(4 + Math.floor(random() * 19))}`, // 5–23 chars = 30–138px
          displayPriority: priorities[Math.floor(random() * 3)],
          x: 80 + col * 70 + Math.floor(random() * 24),
          y: 80 + row * 16 + Math.floor(random() * 8),
          width: 40 + Math.floor(random() * 160),
          height: 30 + Math.floor(random() * 40),
        }),
      )
    }
  }
  return candidates
}

const pannedBy = (candidates: LabelCandidate[], dx: number) =>
  candidates.map((c) => ({ ...c, x: c.x - dx }))

describe('digest fixtures — stability sweep V → V+4px (the #311 [MANUAL] gate, enforced)', () => {
  const fixture = digestFixture()
  const PAN_STEPS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]

  it('the accounting identity drawn + dropped + ramped == eligibleLabelCandidateCount holds on EVERY frame of the sweep', () => {
    for (const dx of PAN_STEPS) {
      const result = declutter(pannedBy(fixture, dx))
      expect(
        result.drawn + result.dropped + result.ramped,
        `identity at pan ${dx}px`,
      ).toBe(result.eligibleLabelCandidateCount)
      expect(result.eligibleLabelCandidateCount).toBe(fixture.length) // nothing silently skipped
      expect(result.drawn).toBeGreaterThan(0)
      expect(result.dropped).toBeGreaterThan(0) // the fixture genuinely collides
    }
  })

  it('NO placed label goes 1→0→1 across the pan — the temporal-coherence proof, as digest numbers', () => {
    const opacitySequences = new Map<string, number[]>()
    for (const dx of PAN_STEPS) {
      for (const placement of declutter(pannedBy(fixture, dx)).placements) {
        const sequence = opacitySequences.get(placement.id) ?? []
        sequence.push(placement.opacity)
        opacitySequences.set(placement.id, sequence)
      }
    }

    for (const [id, sequence] of opacitySequences) {
      expect(sequence, id).toHaveLength(PAN_STEPS.length)
      let seenPlaced = false
      let seenGoneAfterPlaced = false
      for (const opacity of sequence) {
        if (opacity > 0) {
          expect(seenGoneAfterPlaced, `${id} revived after dropping: [${sequence.join(', ')}]`).toBe(false)
          seenPlaced = true
        } else if (seenPlaced) {
          seenGoneAfterPlaced = true
        }
      }
    }
  })

  it('the identity also holds when the frame cap bites (tiny viewport)', () => {
    const result = declutter(pannedBy(fixture, 2), { viewportSize: { width: 100, height: 120 } }) // cap 2
    expect(result.drawn + result.ramped).toBeLessThanOrEqual(2)
    expect(result.drawn + result.dropped + result.ramped).toBe(result.eligibleLabelCandidateCount)
    expect(result.eligibleLabelCandidateCount).toBe(fixture.length)
  })

  it('the identity holds through drawLabels itself — the painted counters agree with the declutter', () => {
    for (const dx of [0, 2, 4]) {
      const counters = paint({ candidates: pannedBy(fixture, dx) }).draw()
      expect(counters.drawn + counters.dropped + counters.ramped).toBe(counters.eligibleLabelCandidateCount)
      expect(counters.paintedLabelCount).toBe(counters.drawn + counters.ramped)
    }
  })
})

describe('digest fixtures — geometry that genuinely CHANGES during a pan', () => {
  const fixture = digestFixture()
  const PAN_STEPS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]

  it('a viewport-pinned region name sliding against the field ramps the contested label smoothly — no pop', () => {
    // The region hangs far off the left edge, so its landmark label clamps to
    // x = 3 and stands still while the field pans under it — the one piece of
    // label geometry that MOVES relative to everything else during a pan.
    // Region box (anchor clamped to (3, 100)): [0, 90] × [85, 108]. The
    // probe's box left edge is 89 − dx, so its penetration grows 1 → 5px
    // across the sweep — inside the fade window the whole way.
    const region = candidate({
      id: 'region',
      text: 'Region name xx', // 84px + 2·3 pad → box right edge at x = 90
      displayPriority: 'landmark',
      pinToRegion: true,
      x: -500,
      y: 89,
      width: 900,
      height: 400,
    })
    const probe = candidate({ id: 'probe', displayPriority: 'system-generated', x: 86, y: 96 })
    const control = candidate({ id: 'control', displayPriority: 'system-generated', x: 400, y: 96 })

    const probeOpacities: number[] = []
    for (const dx of PAN_STEPS) {
      // The region does not move (clamped); the plain cards pan left.
      const result = declutter([region, ...pannedBy([probe, control], dx)])
      expect(result.drawn + result.dropped + result.ramped).toBe(result.eligibleLabelCandidateCount)
      expect(placementOf(result, 'region')?.opacity).toBe(1) // the landmark never budges
      expect(placementOf(result, 'control')?.opacity).toBe(1) // untouched bystander
      probeOpacities.push(placementOf(result, 'probe')!.opacity)
    }

    // Strictly deeper each step → strictly dimmer each step, never a snap.
    for (let step = 1; step < probeOpacities.length; step += 1) {
      expect(probeOpacities[step]).toBeLessThan(probeOpacities[step - 1])
      expect(probeOpacities[step - 1] - probeOpacities[step]).toBeLessThanOrEqual(0.15)
    }
    expect(probeOpacities[0]).toBeGreaterThan(0.9) // penetration 1 of 6
    expect(probeOpacities[probeOpacities.length - 1]).toBeGreaterThan(0) // still visible at penetration 5
  })

  it('cards entering at the pan edge (set change) keep the identity and never revive an incumbent', () => {
    // A right-edge cluster already on screen, and landmark entrants just past
    // the cull boundary that scroll in mid-sweep — the production set-change.
    const cluster = [0, 1, 2].map((at) =>
      candidate({ id: `cluster-${at}`, x: 1140, y: 84 + at * 16, displayPriority: 'system-generated' }),
    )
    const entrants = [0, 1, 2].map((at) =>
      candidate({ id: `enter-${at}`, x: 1203 + at, y: 84 + at * 16, displayPriority: 'landmark' }),
    )

    const opacitySequences = new Map<string, number[]>()
    for (const dx of PAN_STEPS) {
      const shifted = pannedBy([...fixture, ...cluster, ...entrants], dx)
      // Production culling: a card whose left edge sits past the viewport
      // never becomes a candidate.
      const visible = shifted.filter((c) => c.x <= VIEWPORT.width)
      const result = declutter(visible)
      expect(result.drawn + result.dropped + result.ramped).toBe(result.eligibleLabelCandidateCount)
      expect(result.eligibleLabelCandidateCount).toBe(visible.length)
      for (const placement of result.placements) {
        const sequence = opacitySequences.get(placement.id) ?? []
        sequence.push(placement.opacity)
        opacitySequences.set(placement.id, sequence)
      }
    }

    expect(opacitySequences.get('enter-0')!.length).toBeLessThan(PAN_STEPS.length) // genuinely entered mid-sweep
    for (const [id, sequence] of opacitySequences) {
      let seenPlaced = false
      let seenGoneAfterPlaced = false
      for (const opacity of sequence) {
        if (opacity > 0) {
          expect(seenGoneAfterPlaced, `${id} revived: [${sequence.join(', ')}]`).toBe(false)
          seenPlaced = true
        } else if (seenPlaced) {
          seenGoneAfterPlaced = true
        }
      }
    }
  })
})

describe('per-frame allocation bounds — review finding 3', () => {
  it('the painter materializes NO placement objects and its scratch is bounded by placed, not eligible', () => {
    const fixture = digestFixture() // 80 eligible, heavily colliding
    const { draw } = paint({ candidates: fixture })

    const objectsBefore = labelPlacementObjectsForTests()
    const counters = draw()

    expect(labelPlacementObjectsForTests() - objectsBefore).toBe(0) // zero placement objects on the paint path
    expect(labelPaintScratchCountForTests()).toBe(counters.drawn + counters.ramped)
    expect(labelPaintScratchCountForTests()).toBeLessThan(counters.eligibleLabelCandidateCount)
    expect(counters.eligibleLabelCandidateCount).toBe(fixture.length)
  })

  it('cap-dropped labels cost counters only: a capped dense frame keeps the scratch at the cap', () => {
    const candidates = Array.from({ length: 6 }, (_, index) =>
      candidate({ id: `alloc-${index}`, text: `Card ${index}`, x: index * 150 }),
    )
    const { draw } = paint({ candidates, viewportSize: { width: 100, height: 120 } }) // cap 2

    const objectsBefore = labelPlacementObjectsForTests()
    const counters = draw()

    expect(counters).toMatchObject({ drawn: 2, dropped: 4, eligibleLabelCandidateCount: 6 })
    expect(labelPaintScratchCountForTests()).toBe(2)
    expect(labelPlacementObjectsForTests() - objectsBefore).toBe(0)
  })

  it('only the digest seam materializes placements — one object per ELIGIBLE candidate, by design', () => {
    const fixture = digestFixture()
    const objectsBefore = labelPlacementObjectsForTests()

    const result = declutter(fixture)

    expect(labelPlacementObjectsForTests() - objectsBefore).toBe(result.eligibleLabelCandidateCount)
    expect(result.placements).toHaveLength(result.eligibleLabelCandidateCount)
  })
})

describe('rank application scaling — review round 2, finding 2', () => {
  it('per-frame rank reads are bounded by the VISIBLE candidates, never the board: 5,000 ranked, 40 visible → 40 reads', () => {
    let reads = 0
    const bigBoard = new Map<string, number>()
    for (let at = 0; at < 5000; at += 1) bigBoard.set(`big-${at}`, at)
    const countingRanks = {
      get(id: string) {
        reads += 1
        return bigBoard.get(id)
      },
    } as unknown as ReadonlyMap<string, number>
    const sortCache = { ranks: () => countingRanks, sortCountForTests: () => 0 }

    // 40 visible candidates spread collision-free across the viewport.
    const candidates = Array.from({ length: 40 }, (_, at) =>
      candidate({ id: `big-${at * 100}`, x: (at % 8) * 150, y: 50 + Math.floor(at / 8) * 40 }),
    )
    const context = recordingContext()
    const cache = createLabelBitmapCache({ createBitmapContext: recordingBitmapFactory().factory })

    const counters = drawLabels({
      context,
      band: 'overview',
      candidates,
      viewportSize: VIEWPORT,
      devicePixelRatio: 2,
      palette: LIGHT_PALETTE,
      cache,
      sortCache,
      sortKey: { rankInputsEpoch: 1, summariesIdentity: {}, hoveredCardId: null, selectedCardIds: new Set() },
      sortEntries: () => {},
    })

    expect(counters.drawn).toBe(40) // the ranked order was applied, nothing skipped
    expect(reads).toBe(40) // one cached-rank lookup per visible candidate — O(v), not O(board)
  })
})

describe('production sort-cache integration — the drawOverviewLayer seam (review round 2, finding 1)', () => {
  afterEach(() => vi.restoreAllMocks())
  const blockOffscreenBitmaps = () =>
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)

  it('three panned draws through the production path cost ONE sort — the culled render-window list never keys the cache', () => {
    blockOffscreenBitmaps()
    const cards = [note('pan-a', 0, 0), note('pan-b', 500, 100), note('pan-c', 100, 400)]
    const renderIndex = createBoardRenderIndex(cards, [])
    const labelSortCache = createLabelSortCache()
    // Stable across pans, like Board's selection state and summaries map.
    const selectedCardIds = new Set<string>()
    const summaries = new Map(cards.map((card) => [card.id, summaryForCard(card)]))

    for (const x of [20, 24, 28]) {
      const { dataset } = drawLayer({
        // Production hands drawOverviewLayer a FRESH culled window array per
        // query — the harness must too, so a key regression back to the
        // culled list fails right here.
        cards: [...cards],
        zoom: 0.4,
        renderIndex,
        viewport: { x, y: 20, zoom: 0.4 },
        labelSortCache,
        selectedCardIds,
        cardSummariesById: summaries,
      })
      expect(dataset.eligibleLabelCandidateCount).toBe('3')
    }

    expect(labelSortCache.sortCountForTests()).toBe(1)
  })

  it('a position-only drag commit costs zero label-layer scans: fresh index object, same epoch, no re-sort', () => {
    blockOffscreenBitmaps()
    const labelSortCache = createLabelSortCache()
    const selectedCardIds = new Set<string>()
    const indexCache = createBoardRenderIndexCache() // the PRODUCTION incremental path
    const cardsV1 = [note('drag-a', 0, 0), note('drag-b', 500, 100)]
    // One connections array across commits, like the store's identity-stable
    // slice — a fresh [] per get() would read as a connections change and
    // force a full rebuild.
    const connections: Connection[] = []
    const index1 = indexCache.get(cardsV1, connections)
    // Position-only commits are metric-neutral upstream: the summaries map
    // keeps its identity, exactly like production.
    const summaries = new Map(cardsV1.map((card) => [card.id, summaryForCard(card)]))
    drawLayer({
      cards: [...cardsV1],
      zoom: 0.4,
      renderIndex: index1,
      labelSortCache,
      selectedCardIds,
      cardSummariesById: summaries,
    })

    // A drag frame: same cards except positions. The index cache mints a
    // FRESH index object — but preserves the rank epoch, so the label layer
    // does nothing at all.
    const cardsV2 = cardsV1.map((card) => ({ ...card, position: { x: card.position.x + 40, y: card.position.y + 25 } }))
    const index2 = indexCache.get(cardsV2, connections)
    expect(index2).not.toBe(index1) // a genuinely new index object...
    expect(index2.rankEpoch()).toBe(index1.rankEpoch()) // ...with the epoch untouched
    const { dataset } = drawLayer({
      cards: [...cardsV2],
      zoom: 0.4,
      renderIndex: index2,
      labelSortCache,
      selectedCardIds,
      cardSummariesById: summaries,
    })

    expect(dataset.eligibleLabelCandidateCount).toBe('2')
    expect(labelSortCache.sortCountForTests()).toBe(1) // never re-sorted, nothing scanned
  })

  it('labelSortAreaOf mirrors renderedCardSize exactly — the allocation-free scalar cannot drift', () => {
    const cases = [
      note('area-note', 0, 0),
      note('area-group', 0, 0, { kind: 'group' } as Partial<Card>),
      note('area-title', 0, 0, { kind: 'title', title: 'T' } as Partial<Card>),
      note('area-sized', 0, 0, { size: { width: 123, height: 45 } } as Partial<Card>),
    ]
    for (const card of cases) {
      const size = renderedCardSize(card)
      expect(labelSortAreaOf(card), card.id).toBe(size.width * size.height)
    }
  })

  it('a resize through the production path re-sorts: the fresh render index flips a same-tier contest', () => {
    blockOffscreenBitmaps()
    const labelSortCache = createLabelSortCache()
    // Stable selection: the ONLY key change between the draws below is the
    // fresh render index — the re-sort must be attributable to it alone.
    const selectedCardIds = new Set<string>()
    // Two same-tier cards whose labels deep-overlap at zoom 0.4; 'small' vs
    // 'grand' — area decides the winner, id would tie-break identically.
    const cardsV1 = [
      note('grand', 0, 0, { size: { width: 300, height: 150 } } as Partial<Card>),
      note('small', 10, 4, { size: { width: 100, height: 50 } } as Partial<Card>),
    ]
    const indexCache = createBoardRenderIndexCache() // the PRODUCTION incremental path
    const connections: Connection[] = []
    // A resize is metric-neutral upstream: production keeps the summaries
    // map identity, so the re-sort below is attributable to the epoch alone.
    const summaries = new Map(cardsV1.map((card) => [card.id, summaryForCard(card)]))
    const v1 = drawLayer({
      cards: cardsV1,
      zoom: 0.4,
      renderIndex: indexCache.get(cardsV1, connections),
      labelSortCache,
      selectedCardIds,
      cardSummariesById: summaries,
    })
    expect(v1.dataset.drawn).toBe('1')
    expect(v1.dataset.dropped).toBe('1')
    expect(v1.context.ops.filter((op) => op.op === 'fillText').map((op) => op.args[0])).toEqual([
      'Note grand',
    ])

    // The user resizes 'small' past 'grand': the incremental index update
    // sees the size change and BUMPS the rank epoch — the key changes, the
    // rank flips, the other label wins. Same sort cache instance throughout.
    const cardsV2 = [
      cardsV1[0],
      { ...cardsV1[1], size: { width: 900, height: 400 } } as Card,
    ]
    const v2 = drawLayer({
      cards: cardsV2,
      zoom: 0.4,
      renderIndex: indexCache.get(cardsV2, connections),
      labelSortCache,
      selectedCardIds,
      cardSummariesById: summaries,
    })
    expect(v2.dataset.drawn).toBe('1')
    expect(v2.context.ops.filter((op) => op.op === 'fillText').map((op) => op.args[0])).toEqual([
      'Note small',
    ])
    expect(labelSortCache.sortCountForTests()).toBe(2)
  })
})
