import type { CanvasDisplayPriority, DetailBand } from './boardScene'
import type { BoardViewportSize } from './renderPlanning'
import {
  DEFAULT_THEME,
  designTokensForTheme,
  painterPaletteForTheme,
  painterPaletteIdentity,
  type PainterPalette,
} from '../ui/tokens'

/**
 * The screen-space label layer (issue #310, stories 2/16/22): one line per
 * card at a fixed screen font size, free to overflow right past the card's
 * edge, legible via a translucent theme-ground halo under contrast-corrected
 * semantic ink.
 *
 * DATASET COUNTER CONTRACT — frozen by #310. Lane E's label-text-cliff gate
 * (E4, #317) references these NAMES, never this diff:
 *
 * - `dataset.paintedLabelCount`: labels actually painted this frame — after
 *   band eligibility, the area cap, and the declutter (#311):
 *   `paintedLabelCount == drawn + ramped`, always.
 * - `dataset.labelCacheMissesPerFrame`: cold bitmap-cache misses this frame.
 *   A miss is never a skipped label: it renders strokeText+fillText into an
 *   offscreen bitmap and blits it the SAME frame, or — when admission
 *   refuses the request (over the render-width bound, over the max-entry or
 *   cache byte ceiling) or no offscreen 2d surface exists — it strokes and
 *   fills the same spec straight onto the layer, uncached. At a settled
 *   viewport whose painted set fits the byte ceiling this settles to 0.
 * - `dataset.cacheEntries`: live label bitmaps in the shared LRU cache.
 * - `dataset.cacheBytes`: their summed device-pixel byte size (w × h × 4).
 *
 * DECLUTTER COUNTER CONTRACT — frozen by #311, read by E4 (#317) for its
 * accounting identity `drawn + dropped + ramped == eligibleLabelCandidateCount`,
 * which holds on EVERY frame:
 *
 * - `dataset.eligibleLabelCandidateCount`: visible cards eligible for a label
 *   in the current band (band rule + the tier-1 hover/selection override,
 *   non-empty text) BEFORE collision — the declutter's whole input.
 * - `dataset.drawn`: labels painted at full opacity (uncontested, or the
 *   contest resolved by the own-card ellipsis fallback).
 * - `dataset.ramped`: labels painted at a partial opacity from the geometry
 *   fade (`LABEL_CONTEST_FADE_PX`) — cached bitmap under `globalAlpha`,
 *   NEVER a re-render (alpha stays out of the bitmap-cache key).
 * - `dataset.dropped`: eligible labels not painted at all — collision loss at
 *   full penetration, or past the frame cap. A dropped label creates zero
 *   cache traffic: no bitmap request, no ink resolve.
 *
 * COLD-MISS BUDGET — provenance for E4's arithmetic. B1 (#309) measured the
 * exact B2 geometry (12px / weight 500, 3px round-join halo, dpr 2) at
 * a MEDIAN 9.0 µs PER strokeText+fillText PAIR (runs 8.75–9.25 µs across two
 * load windows, spread < 8%; micro-bench in overviewGhosting.browser.test.ts).
 * At 9.0 µs a frame tolerates ~111 cold renders before labels cost the 16.7 ms
 * frame budget a full millisecond. Three bounds keep worst cases under that
 * or close to it, and force steady state to 0 misses:
 *
 * - Render-width bound: `LABEL_MAX_RENDER_WIDTH_PX` (512 css px) caps the
 *   ellipsis width, so the per-entry bitmap is hard-bounded at
 *   `LABEL_MAX_ENTRY_BYTES` = (512 + 2·3) css px × 23 css px at the dpr-2
 *   clamp × 4 B = 190,624 B. The cache enforces this bound itself, BEFORE
 *   allocation — an oversized request never allocates (it direct-draws).
 * - Area cap: 1 label per `LABEL_AREA_PER_LABEL_PX2` (6000 px²) of viewport.
 *   A 1512×982 laptop viewport caps at 248 labels — a fully cold frame there
 *   (hard teleport into an unseen region) costs 248 × 9.0 µs ≈ 2.2 ms once.
 * - Frame cap: `LABEL_FRAME_LABEL_CAP` (352) =
 *   floor(`LABEL_CACHE_MAX_BYTES` / `LABEL_MAX_ENTRY_BYTES`), so one frame's
 *   painted set always fits the byte ceiling — exactly, for every admissible
 *   entry width, because the render-width bound is enforced at the cache
 *   seam — and the next settled frame is all cache hits by construction.
 *   Absolute worst frame: 352 × 9.0 µs ≈ 3.2 ms, once.
 * - Byte ceiling: 64 MiB, sized so the frame cap (ceiling / max entry) stays
 *   ABOVE the laptop-class area cap (352 > 248) and the area rule remains the
 *   binding one on common hardware; only 4K-class viewports (area cap 1383)
 *   feel the frame cap, until B3's declutter bounds them harder. The ceiling
 *   holds ~1,900 average entries (~15-char label ≈ 96 css px wide ≈ 35 KB at
 *   dpr 2) — many saturated laptop viewports of distinct labels resident
 *   before LRU eviction starts.
 */

/**
 * Overview visual geometry (T4, issue #310), now fed by the approved design
 * token authority. Geometry remains frozen; font family and paint roles come
 * from semantic tokens.
 */
const DEFAULT_PAINTER_PALETTE = painterPaletteForTheme(DEFAULT_THEME)
const DEFAULT_DESIGN_TOKENS = designTokensForTheme(DEFAULT_THEME)

export const LABEL_FONT_PX = Number.parseFloat(DEFAULT_DESIGN_TOKENS['--e-fs-label'])
export const LABEL_FONT_WEIGHT = 500
export const LABEL_FONT_FAMILY = DEFAULT_DESIGN_TOKENS['--e-mono']
export const LABEL_FONT = `${LABEL_FONT_WEIGHT} ${LABEL_FONT_PX}px ${LABEL_FONT_FAMILY}`
export const LABEL_FONT_LOAD = `${LABEL_FONT_WEIGHT} ${LABEL_FONT_PX}px "JetBrains Mono"`
export const LABEL_FONT_SAMPLE = 'Eido ASK RESULT MOD GROUP CONVERSATION 0123456789 → — …'
export const LABEL_HALO_PX = 3
export const LABEL_MIN_CONTRAST = 4.5
// Every card gets at least 220px of label (a real Ask AI question at 12px);
// a card wider than 220 screen px uses its own width, so its title sits
// inside. Ellipsize past this; never clip to the card.
export const LABEL_MIN_MAX_WIDTH_PX = 220
// Hard bound on the RENDERED label width (and so on the bitmap-cache entry
// size): 512 css px ≈ 85 characters at 12px. Body-derived names are cut at
// 60 characters (≈ 366px) upstream, so only a typed title longer than ~85
// characters on a card wider than 512 screen px ever meets this — past that
// a one-line label is a sentence, not a name, and it ellipsizes.
export const LABEL_MAX_RENDER_WIDTH_PX = 512
// Anchor = card top-left + (6, 11) screen px, baseline on the header title's
// line, left-aligned, overflowing right.
export const LABEL_ANCHOR_OFFSET_X_PX = 6
export const LABEL_ANCHOR_OFFSET_Y_PX = 11

// Pre-declutter safety caps (see the budget doc-comment above). The area cap
// is B2's interim bound on the one genuinely new performance cliff —
// per-frame text on a saturated Overview viewport — until B3's declutter
// bounds the drawn set by collision.
export const LABEL_AREA_PER_LABEL_PX2 = 6000
export const LABEL_CACHE_MAX_BYTES = 64 * 1024 * 1024

// Bitmap geometry. Padding absorbs the halo stroke (3px stroke reaches 1.5px
// past glyph edges) plus antialiasing bleed on every side; the baseline sits
// a full font size below the padded top so ascenders never clip, and the
// line box leaves 0.4 em under the baseline for descenders.
export const LABEL_BITMAP_PAD_PX = 3
export const LABEL_BITMAP_BASELINE_PX = LABEL_BITMAP_PAD_PX + LABEL_FONT_PX
export const LABEL_BITMAP_CSS_HEIGHT_PX = Math.ceil(LABEL_FONT_PX * 1.4) + LABEL_BITMAP_PAD_PX * 2

// The TRUE worst-case entry: a label at the render-width bound at the dpr-2
// clamp. The cache's admission check makes this a hard bound, not a nominal
// one — no admissible entry exceeds it.
export const LABEL_MAX_ENTRY_BYTES =
  (LABEL_MAX_RENDER_WIDTH_PX + LABEL_BITMAP_PAD_PX * 2) * 2 * (LABEL_BITMAP_CSS_HEIGHT_PX * 2) * 4
export const LABEL_FRAME_LABEL_CAP = Math.floor(LABEL_CACHE_MAX_BYTES / LABEL_MAX_ENTRY_BYTES)

export function labelMaxWidthPx(cardWidthPx: number): number {
  return Math.max(LABEL_MIN_MAX_WIDTH_PX, cardWidthPx)
}

/**
 * The width the painter actually ellipsizes to: the frozen spec rule
 * `max(220, cardWidthPx)` bounded by the render-width cap that keeps every
 * bitmap entry within `LABEL_MAX_ENTRY_BYTES`.
 */
export function labelRenderMaxWidthPx(cardWidthPx: number): number {
  return Math.min(labelMaxWidthPx(cardWidthPx), LABEL_MAX_RENDER_WIDTH_PX)
}

/**
 * Band eligibility — a PURE function of (band, displayPriority), zoom-pure by
 * construction: no painter-local history, no hysteresis (the epic's thesis).
 * Map → landmarks only (tiers 1–2; tier 1, hovered/selected, is a draw-time
 * override owned by B3 and inert here). Overview → all tiers. Reading → none:
 * the name renders inside the DOM card, so a Reading-band frame that still
 * paints shapes (motion overflow) paints them nameless.
 */
export function labelBandEligible(band: DetailBand, displayPriority: CanvasDisplayPriority): boolean {
  if (band === 'reading') return false
  if (band === 'map') return displayPriority === 'landmark'
  return true
}

/**
 * Labels painted per frame: the viewport-area cap, bounded by the absolute
 * frame cap that guarantees one frame's bitmaps fit the cache byte ceiling.
 */
export function paintedLabelFrameCap(viewportSize: BoardViewportSize): number {
  const area = Math.max(0, viewportSize.width) * Math.max(0, viewportSize.height)
  return Math.min(Math.ceil(area / LABEL_AREA_PER_LABEL_PX2), LABEL_FRAME_LABEL_CAP)
}

// ---------------------------------------------------------------------------
// Ink: resolve to ≥ 4.5:1 against the active theme ground, once per palette/colour.

/**
 * WCAG relative luminance of a `#rrggbb`/`#rgb` colour. Returns null for
 * anything unparseable (the caller falls back to theme label ink).
 */
export function relativeLuminance(color: string): number | null {
  const rgb = parseHexColor(color)
  return rgb ? luminanceOfRgb(rgb) : null
}

/** Theme-ground halo paint used identically by cached and direct labels. */
export function labelHaloForPalette(palette: PainterPalette): string {
  return withHexAlpha(palette.board.fill, 0.92)
}

// Compatibility constants for older consumers. Both are derived from the
// default theme's frozen token palette; production draw paths resolve the
// active theme at paint time.
export const LABEL_HALO_COLOR = labelHaloForPalette(DEFAULT_PAINTER_PALETTE)
export const LABEL_FALLBACK_INK = DEFAULT_PAINTER_PALETTE.label.ink
const defaultGroundLuminance = relativeLuminance(DEFAULT_PAINTER_PALETTE.board.fill) ?? 0
export const LABEL_INK_MAX_LUMINANCE =
  (defaultGroundLuminance + 0.05) / LABEL_MIN_CONTRAST - 0.05

/**
 * Compatibility helper for default-theme consumers. Production paint uses
 * `resolveLabelInk`, which can move toward light ink in a dark theme instead
 * of assuming that contrast correction always means darkening.
 */
export function darkenToLabelInk(color: string): string {
  return resolveLabelInk(DEFAULT_PAINTER_PALETTE, color)
}

export type LabelInkResolver = {
  resolve(palette: PainterPalette, color: string): string
  /** Distinct palette/colour pairs resolved so far. */
  memoSize(): number
}

// Ink memo bound: real boards see tens of semantic/custom palette pairs; 512
// is far past that while keeping the memo the
// same size-capped discipline as the bitmap cache.
export const LABEL_INK_MEMO_MAX_ENTRIES = 512

/**
 * The once-per-palette/colour memo the spec mandates. One resolver instance
 * lives for the process; contrast resolution runs exactly once per distinct
 * resident pair. The memo is an LRU capped at `maxEntries`, and an evicted
 * pair recomputes identically on its next resolve.
 */
export function createLabelInkResolver(
  resolveInk: (palette: PainterPalette, color: string) => string = resolveLabelInk,
  maxEntries: number = LABEL_INK_MEMO_MAX_ENTRIES,
): LabelInkResolver {
  const memo = new Map<string, string>()
  return {
    resolve(palette, color) {
      const key = JSON.stringify([painterPaletteIdentity(palette), color])
      const hit = memo.get(key)
      if (hit !== undefined) {
        memo.delete(key)
        memo.set(key, hit)
        return hit
      }
      const ink = resolveInk(palette, color)
      if (memo.size >= maxEntries) {
        const oldest = memo.keys().next().value
        if (oldest !== undefined) memo.delete(oldest)
      }
      memo.set(key, ink)
      return ink
    },
    memoSize: () => memo.size,
  }
}

/**
 * Resolve the nearest source-derived ink that clears WCAG AA against the
 * active theme ground. The theme label ink is the compliant endpoint and
 * fallback; custom header data is never rewritten before this paint seam.
 */
export function resolveLabelInk(palette: PainterPalette, color: string): string {
  const source = parseHexColor(color)
  const ground = parseHexColor(palette.board.fill)
  const fallback = parseHexColor(palette.label.ink)
  if (!source || !ground || !fallback) return palette.label.ink
  if (contrastRatio(source, ground) >= LABEL_MIN_CONTRAST) return color

  // The resolver runs only on a cold palette/colour memo miss. Search at
  // sub-channel precision for the first source→token-ink mix that clears AA;
  // this works in both themes ("darken" is not a dark-theme-safe operation).
  for (let step = 1; step <= 1024; step += 1) {
    const amount = step / 1024
    const mixed: Rgb = [
      Math.round(source[0] + (fallback[0] - source[0]) * amount),
      Math.round(source[1] + (fallback[1] - source[1]) * amount),
      Math.round(source[2] + (fallback[2] - source[2]) * amount),
    ]
    if (contrastRatio(mixed, ground) >= LABEL_MIN_CONTRAST) return rgbToHex(mixed)
  }
  return palette.label.ink
}

type Rgb = [number, number, number]

function parseHexColor(color: string): Rgb | null {
  const normalized = color.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    const value = Number.parseInt(normalized.slice(1), 16)
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  }
  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    return [
      Number.parseInt(normalized[1] + normalized[1], 16),
      Number.parseInt(normalized[2] + normalized[2], 16),
      Number.parseInt(normalized[3] + normalized[3], 16),
    ]
  }
  return null
}

function luminanceOfRgb(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const scaled = channel / 255
    return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const lighter = Math.max(luminanceOfRgb(a), luminanceOfRgb(b))
  const darker = Math.min(luminanceOfRgb(a), luminanceOfRgb(b))
  return (lighter + 0.05) / (darker + 0.05)
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0')).join('')}`
}

function withHexAlpha(color: string, alpha: number): string {
  const rgb = parseHexColor(color)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color
}

/** Request the exact canvas label font; callers own repaint invalidation. */
export async function loadLabelFont(fonts: Pick<FontFaceSet, 'load'>): Promise<void> {
  await fonts.load(LABEL_FONT_LOAD, LABEL_FONT_SAMPLE)
}

// ---------------------------------------------------------------------------
// Per-label bitmap cache: content-addressed, LRU by bytes.

export type LabelBitmap = {
  source: CanvasImageSource
  cssWidth: number
  cssHeight: number
  bytes: number
}

/**
 * Offscreen bitmap seam: returns a fresh device-pixel-sized 2d surface, or
 * null where offscreen 2d contexts don't exist (jsdom); the painter then
 * strokes/fills the same spec straight onto the main context, uncached.
 */
export type LabelBitmapContextFactory = (
  deviceWidth: number,
  deviceHeight: number,
) => { source: CanvasImageSource; context: CanvasRenderingContext2D } | null

export type LabelBitmapRequest = {
  text: string
  ink: string
  paletteKey: string
  halo: string
  font: string
  fontRevision: number
  dpr: number
  /** Measured width of `text` at the label font — the ellipsis already applied. */
  textWidthPx: number
}

export type LabelBitmapCache = {
  /** Resets the per-frame miss counter; call once at the top of each frame. */
  beginFrame(): void
  /**
   * The bitmap for a content-addressed key covering palette, actual halo,
   * full font, font revision, text, ink, measured size, and DPR. A hit
   * refreshes LRU recency; a miss renders the label (halo then ink) into a
   * fresh bitmap the same call — never skipped — and evicts least-recently
   * used entries until the byte ceiling holds. Admission is checked BEFORE
   * allocation: a request wider than `LABEL_MAX_RENDER_WIDTH_PX` or bigger
   * than the byte ceiling never allocates a surface. Null means "not
   * cacheable here" — over-bound request or no offscreen context — and the
   * caller draws direct (still counted as a miss, still painted).
   */
  bitmapFor(request: LabelBitmapRequest): LabelBitmap | null
  missesThisFrame(): number
  entryCount(): number
  byteSize(): number
}

export function createLabelBitmapCache(
  options: { maxBytes?: number; createBitmapContext?: LabelBitmapContextFactory } = {},
): LabelBitmapCache {
  const maxBytes = options.maxBytes ?? LABEL_CACHE_MAX_BYTES
  const createBitmapContext = options.createBitmapContext ?? defaultBitmapContextFactory
  // Map iteration order is insertion order, so the Map IS the LRU list:
  // hits delete + re-insert, eviction walks from the head.
  const entries = new Map<string, LabelBitmap>()
  let bytes = 0
  let misses = 0

  return {
    beginFrame() {
      misses = 0
    },
    bitmapFor(request) {
      const key = JSON.stringify([
        request.paletteKey,
        request.halo,
        request.font,
        request.fontRevision,
        request.text,
        request.ink,
        request.textWidthPx,
        request.dpr,
      ])
      const hit = entries.get(key)
      if (hit) {
        entries.delete(key)
        entries.set(key, hit)
        return hit
      }
      misses += 1
      // Admission BEFORE allocation: compute the prospective footprint from
      // the request alone, and refuse anything over-bound without ever
      // creating a surface for it.
      const cssWidth = Math.ceil(request.textWidthPx) + LABEL_BITMAP_PAD_PX * 2
      const cssHeight = LABEL_BITMAP_CSS_HEIGHT_PX
      const deviceWidth = Math.max(1, Math.ceil(cssWidth * request.dpr))
      const deviceHeight = Math.max(1, Math.ceil(cssHeight * request.dpr))
      const entryBytes = deviceWidth * deviceHeight * 4
      // The max-entry invariant is the CACHE's, not the caller's: whatever
      // dpr arrives (the layer clamps to 2, but nothing here relies on it),
      // no admitted entry may exceed LABEL_MAX_ENTRY_BYTES, or the
      // frame-cap × max-entry ≤ ceiling arithmetic silently breaks.
      if (
        request.textWidthPx > LABEL_MAX_RENDER_WIDTH_PX ||
        entryBytes > LABEL_MAX_ENTRY_BYTES ||
        entryBytes > maxBytes
      ) {
        return null
      }
      const rendered = renderLabelBitmap(
        request,
        { cssWidth, cssHeight, deviceWidth, deviceHeight, bytes: entryBytes },
        createBitmapContext,
      )
      if (!rendered) return null
      entries.set(key, rendered)
      bytes += rendered.bytes
      for (const [staleKey, stale] of entries) {
        if (bytes <= maxBytes) break
        entries.delete(staleKey)
        bytes -= stale.bytes
      }
      return rendered
    },
    missesThisFrame: () => misses,
    entryCount: () => entries.size,
    byteSize: () => bytes,
  }
}

function defaultBitmapContextFactory(deviceWidth: number, deviceHeight: number) {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = deviceWidth
  canvas.height = deviceHeight
  try {
    const context = canvas.getContext('2d')
    return context ? { source: canvas, context } : null
  } catch {
    return null
  }
}

function renderLabelBitmap(
  request: LabelBitmapRequest,
  footprint: { cssWidth: number; cssHeight: number; deviceWidth: number; deviceHeight: number; bytes: number },
  createBitmapContext: LabelBitmapContextFactory,
): LabelBitmap | null {
  const { cssWidth, cssHeight, deviceWidth, deviceHeight, bytes } = footprint
  const target = createBitmapContext(deviceWidth, deviceHeight)
  if (!target) return null

  const { source, context } = target
  context.setTransform(request.dpr, 0, 0, request.dpr, 0, 0)
  context.font = request.font
  context.textBaseline = 'alphabetic'
  applyHaloStroke(context, request.halo)
  context.strokeText(request.text, LABEL_BITMAP_PAD_PX, LABEL_BITMAP_BASELINE_PX)
  context.fillStyle = request.ink
  context.fillText(request.text, LABEL_BITMAP_PAD_PX, LABEL_BITMAP_BASELINE_PX)
  return { source, cssWidth, cssHeight, bytes }
}

function applyHaloStroke(context: CanvasRenderingContext2D, halo: string) {
  context.lineJoin = 'round'
  context.miterLimit = 2
  context.lineWidth = LABEL_HALO_PX
  context.strokeStyle = halo
}

// ---------------------------------------------------------------------------
// Ellipsis, memoised per context (measureText belongs to a context+font).

const ELLIPSIS = '…'
const ELLIPSIS_MEMO_MAX_ENTRIES = 4096
const ellipsisMemoByContext = new WeakMap<CanvasRenderingContext2D, Map<string, ResolvedLabelText>>()
let ellipsisMemoMisses = 0

/** Test-only probe: content/font identities measured on ellipsis-cache misses. */
export function labelEllipsisMissesForTests(): number {
  return ellipsisMemoMisses
}

export type ResolvedLabelText = { text: string; widthPx: number }

/**
 * Longest prefix (plus `…`) that fits `maxWidthPx`; text that already fits
 * passes through unchanged. Binary search on the prefix length — measureText
 * width is monotonic in prefix length.
 */
export function ellipsizeToWidth(
  text: string,
  maxWidthPx: number,
  measure: (candidate: string) => number,
): ResolvedLabelText {
  const fullWidth = measure(text)
  if (fullWidth <= maxWidthPx) return { text, widthPx: fullWidth }

  let low = 0
  let high = text.length - 1
  let best: ResolvedLabelText = { text: ELLIPSIS, widthPx: measure(ELLIPSIS) }
  while (low <= high) {
    const mid = (low + high) >> 1
    const candidate = text.slice(0, mid) + ELLIPSIS
    const width = measure(candidate)
    if (width <= maxWidthPx) {
      best = { text: candidate, widthPx: width }
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

function memoisedEllipsize(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
  font: string,
  fontRevision: number,
): ResolvedLabelText {
  let memo = ellipsisMemoByContext.get(context)
  if (!memo) {
    memo = new Map()
    ellipsisMemoByContext.set(context, memo)
  }
  // Exact-keyed width: a shared bucket could hand a narrower card a resolved
  // text measured against a wider cap. Zoom-gesture churn on wide cards is
  // bounded by the memo's size cap instead.
  const key = JSON.stringify([font, fontRevision, maxWidthPx, text])
  const hit = memo.get(key)
  if (hit) return hit
  ellipsisMemoMisses += 1
  if (memo.size >= ELLIPSIS_MEMO_MAX_ENTRIES) memo.clear()
  const resolved = ellipsizeToWidth(text, maxWidthPx, (candidate) => context.measureText(candidate).width)
  memo.set(key, resolved)
  return resolved
}

// ---------------------------------------------------------------------------
// Anchoring.

export type LabelCandidate = {
  id: string
  /** The display name — `CanvasCardSummary.label`. */
  text: string
  /** Tier straight off the scene seam (A2) — never re-inferred from kind. */
  displayPriority: CanvasDisplayPriority
  /**
   * Group regions pin their name to the region's top-left INSIDE edge,
   * screen-clamped while any part of the region is visible. A geometry rule,
   * not a priority tier — priority stays on `displayPriority`.
   */
  pinToRegion: boolean
  /** Semantic label colour or raw custom header colour; the layer contrast-corrects it. */
  color: string
  /**
   * Draw-time priority overrides (#311): hover/selection lift the label to
   * tier 1 WITHOUT reclassifying the card — `displayPriority` is untouched.
   */
  hovered: boolean
  selected: boolean
  /**
   * The painter derives this from its frozen `reactCardIds` prop. Reading
   * cards mount their DOM title, so their canvas label must not enter the
   * declutter at all; an unmounted motion-overflow card may still be named.
   */
  mountedInReading: boolean
  /** Per-card Reading handoff opacity; painter-owned overflow stays at 1. */
  ordinaryAlpha?: number
  /** Screen-space card frame. */
  x: number
  y: number
  width: number
  height: number
}

/**
 * Anchor = frame top-left + (6, 11) screen px; `y` is the text BASELINE.
 *
 * Region-pinned candidates (group names) clamp the anchor against the ACTUAL
 * viewport rect on all four sides, so the full glyph box (the bitmap box:
 * pad + ascent above the baseline, line box + pad below) stays on screen
 * while any part of the region is visible — a region entering from any edge
 * keeps its name readable (landmark priority, #310). Visibility wins over
 * the region's own edges: a region reduced to a sliver still shows its full
 * name at the nearest viewport edge. When the clamp conflicts (label wider
 * than the viewport), the top-left bound wins. Plain cards never clamp.
 */
export function labelAnchor(
  candidate: Pick<LabelCandidate, 'x' | 'y' | 'width' | 'height' | 'pinToRegion'>,
  viewportSize: BoardViewportSize,
  labelWidthPx = 0,
): {
  x: number
  y: number
} {
  return {
    x: anchorXFor(candidate, viewportSize, labelWidthPx),
    y: anchorYFor(candidate, viewportSize),
  }
}

// The x and y clamps are independent (x needs the label width, y does not),
// split so the allocation-free walk can compute anchors as plain numbers.
// Full-box bounds: blit x spans [anchor − pad, anchor + width + pad] and
// blit y spans [baseline − BASELINE, baseline + (HEIGHT − BASELINE)].
function anchorXFor(
  candidate: Pick<LabelCandidate, 'x' | 'pinToRegion'>,
  viewportSize: BoardViewportSize,
  labelWidthPx: number,
): number {
  const x = candidate.x + LABEL_ANCHOR_OFFSET_X_PX
  if (!candidate.pinToRegion) return x
  const maxX = viewportSize.width - labelWidthPx - LABEL_BITMAP_PAD_PX
  return Math.max(LABEL_BITMAP_PAD_PX, Math.min(x, maxX))
}

function anchorYFor(
  candidate: Pick<LabelCandidate, 'y' | 'pinToRegion'>,
  viewportSize: BoardViewportSize,
): number {
  const y = candidate.y + LABEL_ANCHOR_OFFSET_Y_PX
  if (!candidate.pinToRegion) return y
  const maxY = viewportSize.height - (LABEL_BITMAP_CSS_HEIGHT_PX - LABEL_BITMAP_BASELINE_PX)
  return Math.max(LABEL_BITMAP_BASELINE_PX, Math.min(y, maxY))
}

// ---------------------------------------------------------------------------
// Declutter (#311): priority sort + greedy grid walk + geometry fade.

/**
 * The geometry-driven opacity ramp's span, in screen px of overlap
 * penetration against the winner (T3 decision, #311). Stable ordering alone
 * gives per-frame determinism but not temporal coherence across a pan; this
 * ramp turns the 1px boolean pop into a fade while staying a PURE function
 * of the viewport, so the single-viewport digest strategy survives. The only
 * escape hatch is `0` — that IS the clean-snap behaviour, reachable by
 * changing this constant with no code change and no test-strategy change.
 * The frame-carried-incumbency fallback is abandoned: it is path-dependent
 * and would break the single-viewport digest. Do not rebuild it.
 */
export const LABEL_CONTEST_FADE_PX = 6

// One product-semantics read for landmark behavior: both rank and collision
// immunity consume the frozen scene field through this seam. A mutation that
// demotes `displayPriority` therefore removes the guarantee everywhere and
// trips the landmark red-capability proofs.
const isLandmarkPriority = (displayPriority: CanvasDisplayPriority) => displayPriority === 'landmark'

/**
 * Draw-time priority tier: hovered/selected (0) > landmark (1) >
 * user-authored (2) > system-generated (3). The bottom three read straight
 * off `displayPriority` (frozen by A2, ADR 0019) — never re-inferred from
 * card fields; hover/selection override at draw time without reclassifying.
 */
export function labelPriorityTier(
  displayPriority: CanvasDisplayPriority,
  hovered: boolean,
  selected: boolean,
): 0 | 1 | 2 | 3 {
  if (hovered || selected) return 0
  if (isLandmarkPriority(displayPriority)) return 1
  if (displayPriority === 'user-authored') return 2
  return 3
}

function compareLabelRank(
  aTier: number,
  aHovered: boolean,
  aArea: number,
  aId: string,
  bTier: number,
  bHovered: boolean,
  bArea: number,
  bId: string,
): number {
  if (aTier !== bTier) return aTier - bTier
  if (aHovered !== bHovered) return aHovered ? -1 : 1
  if (aArea !== bArea) return bArea - aArea
  return aId < bId ? -1 : aId > bId ? 1 : 0
}

/**
 * Position-independent walk order: (tier asc, hovered first inside tier 0,
 * area desc, id asc). Hover gets the tie-break over selection so the one
 * frozen `hoveredCardId` always enters the collision grid first. No screen
 * coordinate participates, and a zoom scales every area by the same factor,
 * so the ORDER is invariant under both pan and zoom — which is what lets the
 * sort cache skip re-sorting on every pure pan/zoom frame.
 */
export function sortLabelCandidateIndices(candidates: readonly LabelCandidate[]): number[] {
  const tiers = candidates.map((c) => labelPriorityTier(c.displayPriority, c.hovered, c.selected))
  const areas = candidates.map((c) => c.width * c.height)
  return candidates
    .map((_, index) => index)
    .sort((a, b) =>
      compareLabelRank(
        tiers[a],
        candidates[a].hovered,
        areas[a],
        candidates[a].id,
        tiers[b],
        candidates[b].hovered,
        areas[b],
        candidates[b].id,
      ),
    )
}

/**
 * The sort cache's key: four O(1) comparisons, no scan of any kind at this
 * layer. Together the fields cover EVERY rank input:
 *
 * - `rankInputsEpoch`: the render index's rank epoch (#311, amendment 16) —
 *   moves when membership or any card's size/kind changes, computed during
 *   visits the index already performs, and deliberately position-blind: a
 *   drag commit (per animation frame) leaves it untouched. Covers the AREA
 *   and membership sort inputs.
 * - `summariesIdentity`: the scene's `cardSummariesById` map, value-keyed
 *   upstream (`reuseMapByEntries`) — a new reference exactly when any
 *   summary value (including `displayPriority`) or membership changes, and
 *   the SAME reference across structural-only commits. Covers the PRIORITY
 *   sort input the index cannot see (it never reads title/text).
 * - `hoveredCardId` / `selectedCardIds`: the draw-time tier-0 override
 *   inputs; the selection Set is replaced on change, never mutated.
 */
export type LabelSortKey = {
  rankInputsEpoch: number
  summariesIdentity: unknown
  hoveredCardId: string | null
  selectedCardIds: ReadonlySet<string>
}

/**
 * Visits one card's rank inputs. `area` is WORLD-space: zoom scales every
 * screen area by the same factor, so world-area order IS screen-area order —
 * which is why the rank survives zoom without recomputation.
 */
export type LabelSortEntryVisitor = (id: string, displayPriority: CanvasDisplayPriority, area: number) => void

/**
 * Iterates the WHOLE board's rank inputs in a stable order, calling `visit`
 * once per card. Visitor-shaped (not an array builder) so a rebuild
 * collects into reusable flat scratch without materializing per-entry
 * objects.
 */
export type LabelSortInputs = (visit: LabelSortEntryVisitor) => void

export type LabelSortCache = {
  /**
   * Dense rank (0 = walk first) per card id over the WHOLE board — not the
   * visible subset, so pan-driven culling changes never invalidate it.
   *
   * Honest cost model: O(1) per call at this layer — four key equalities —
   * on EVERY frame kind, including position-only drag commits (the epoch is
   * position-blind by construction). `forEachEntry` is invoked, and the
   * O(n log n) rebuild runs, only when the key says a rank input, hover, or
   * selection actually changed. No full-board scan happens here, ever; the
   * epoch's inputs are gathered by the render index during visits it
   * already performs.
   */
  ranks(key: LabelSortKey, forEachEntry: LabelSortInputs): ReadonlyMap<string, number>
  sortCountForTests(): number
}

export function createLabelSortCache(): LabelSortCache {
  let initialized = false
  let lastEpoch = 0
  let lastSummaries: unknown = null
  let lastHovered: string | null = null
  let lastSelected: ReadonlySet<string> | null = null
  // Rebuild scratch, flat and reused across rebuilds.
  const ids: string[] = []
  const priorities: CanvasDisplayPriority[] = []
  const areas: number[] = []
  let ranks = new Map<string, number>()
  let sortCount = 0

  return {
    ranks(key, forEachEntry) {
      if (
        initialized &&
        key.rankInputsEpoch === lastEpoch &&
        key.summariesIdentity === lastSummaries &&
        key.hoveredCardId === lastHovered &&
        key.selectedCardIds === lastSelected
      ) {
        return ranks
      }
      initialized = true
      lastEpoch = key.rankInputsEpoch
      lastSummaries = key.summariesIdentity
      lastHovered = key.hoveredCardId
      lastSelected = key.selectedCardIds
      sortCount += 1
      let entryCount = 0
      forEachEntry((id, displayPriority, area) => {
        ids[entryCount] = id
        priorities[entryCount] = displayPriority
        areas[entryCount] = area
        entryCount += 1
      })
      ids.length = entryCount
      priorities.length = entryCount
      areas.length = entryCount
      const tiers = new Array<number>(entryCount)
      for (let index = 0; index < entryCount; index += 1) {
        tiers[index] = labelPriorityTier(
          priorities[index],
          ids[index] === key.hoveredCardId,
          key.selectedCardIds.has(ids[index]),
        )
      }
      const order = Array.from({ length: entryCount }, (_, index) => index).sort((a, b) => {
        const aHovered = ids[a] === key.hoveredCardId
        const bHovered = ids[b] === key.hoveredCardId
        return compareLabelRank(tiers[a], aHovered, areas[a], ids[a], tiers[b], bHovered, areas[b], ids[b])
      })
      ranks = new Map()
      for (let rank = 0; rank < order.length; rank += 1) ranks.set(ids[order[rank]], rank)
      return ranks
    },
    sortCountForTests: () => sortCount,
  }
}

// Applying the cached rank to this frame's (culled) candidate list: one
// rank lookup per VISIBLE candidate, then an O(v log v) integer sort of the
// visible indices by cached rank. Honest complexity: zero rank COMPUTATION
// on a pan frame (the ranks are cached), and per-frame work is bounded by
// the visible count, never the board — the rank map's size appears in no
// per-frame loop (a 50k-card board with 100 visible labels touches 100
// ranks). Scratch reuse below is allocation discipline, NOT frame-carried
// state: both arrays are fully rewritten from this frame's inputs before use.
const orderScratch: number[] = []
const rankScratch: number[] = []

/**
 * Fills `orderScratch` with candidate indices in rank order and returns the
 * count, or -1 when a candidate has no rank (a candidate list not derived
 * from the ranked card collection) — the caller falls back to a fresh sort.
 */
function orderCandidatesByRank(
  candidates: readonly LabelCandidate[],
  ranks: ReadonlyMap<string, number>,
): number {
  for (let index = 0; index < candidates.length; index += 1) {
    const rank = ranks.get(candidates[index].id)
    if (rank === undefined) return -1
    rankScratch[index] = rank
    orderScratch[index] = index
  }
  orderScratch.length = candidates.length
  orderScratch.sort((a, b) => rankScratch[a] - rankScratch[b])
  return candidates.length
}

export type LabelRect = { left: number; top: number; right: number; bottom: number }

function penetrationOf(
  aLeft: number,
  aTop: number,
  aRight: number,
  aBottom: number,
  bLeft: number,
  bTop: number,
  bRight: number,
  bBottom: number,
): number {
  const overlapX = Math.min(aRight, bRight) - Math.max(aLeft, bLeft)
  if (overlapX <= 0) return 0
  const overlapY = Math.min(aBottom, bBottom) - Math.max(aTop, bTop)
  if (overlapY <= 0) return 0
  return Math.min(overlapX, overlapY)
}

/**
 * Overlap penetration between two label boxes: the smaller axis of the
 * intersection, 0 when disjoint. Continuous in every coordinate — a 1px pan
 * moves it at most 1px — which is what makes the fade temporally coherent.
 */
export function labelOverlapPenetrationPx(a: LabelRect, b: LabelRect): number {
  return penetrationOf(a.left, a.top, a.right, a.bottom, b.left, b.top, b.right, b.bottom)
}

/**
 * The contest fade: smoothstep from 1 at zero penetration to exactly 0 at
 * `fadePx`, monotonically decreasing between. `fadePx = 0` degenerates to
 * the clean boolean snap (any penetration loses outright) with no other
 * behaviour change — the escape hatch IS this branch.
 */
export function labelContestOpacity(penetrationPx: number, fadePx: number = LABEL_CONTEST_FADE_PX): number {
  if (penetrationPx <= 0) return 1
  if (fadePx <= 0 || penetrationPx >= fadePx) return 0
  const t = 1 - penetrationPx / fadePx
  return t * t * (3 - 2 * t)
}

export type LabelPlacementOutcome = 'drawn' | 'ramped' | 'dropped'

export type LabelPlacement = {
  /** Index into the candidates array handed to the declutter. */
  index: number
  id: string
  /** Resolved (possibly ellipsized) text — the card-fit variant when chosen. */
  text: string
  widthPx: number
  anchorX: number
  anchorY: number
  opacity: number
  outcome: LabelPlacementOutcome
}

export type LabelDeclutterResult = {
  /** One entry per ELIGIBLE candidate, in walk (priority) order. */
  placements: LabelPlacement[]
  droppedIds: string[]
  drawn: number
  ramped: number
  dropped: number
  eligibleLabelCandidateCount: number
}

// Spatial grid for the greedy walk: placed labels bucket into 128px cells so
// a candidate only tests its neighbourhood, not every placed label. Cell
// coordinates clamp into a fixed keyspace; clamping can only MERGE buckets
// (more comparisons at absurd coordinates), never lose an overlapping pair.
//
// ONE persistent instance, reset at the top of every walk. Reuse here is
// allocation discipline, not frame-carried state: nothing read out of the
// grid survives `reset()`, so the walk's output stays a pure function of its
// inputs. Placed boxes live in flat parallel number arrays (no per-label
// rect objects) and emptied cell buckets return to a pool — steady-state
// frames allocate nothing here.
const LABEL_GRID_CELL_PX = 128
const LABEL_GRID_CLAMP = 4096

type PlacedLabelGrid = ReturnType<typeof createPlacedLabelGrid>

function createPlacedLabelGrid() {
  const cells = new Map<number, number[]>()
  const bucketPool: number[][] = []
  const activeBuckets: number[][] = []
  const lefts: number[] = []
  const tops: number[] = []
  const rights: number[] = []
  const bottoms: number[] = []
  const visibilities: number[] = []
  const lastVisit: number[] = []
  let placedCount = 0
  let stamp = 0

  const cellCoord = (px: number) =>
    Math.max(-LABEL_GRID_CLAMP, Math.min(LABEL_GRID_CLAMP - 1, Math.floor(px / LABEL_GRID_CELL_PX)))

  return {
    reset() {
      for (const bucket of activeBuckets) {
        bucket.length = 0
        bucketPool.push(bucket)
      }
      activeBuckets.length = 0
      cells.clear()
      placedCount = 0
    },
    /**
     * The candidate's visibility against every placed label it overlaps:
     * `v = Π (1 − v_winner · (1 − labelContestOpacity(penetration)))`.
     * Suppression is weighted by the WINNER's own opacity, so a fading
     * winner releases its claim continuously — the whole field stays a
     * continuous pure function of the viewport.
     */
    visibilityAgainst(left: number, top: number, right: number, bottom: number, fadePx: number): number {
      stamp += 1
      let visibility = 1
      const x0 = cellCoord(left)
      const x1 = cellCoord(right)
      const y0 = cellCoord(top)
      const y1 = cellCoord(bottom)
      for (let cy = y0; cy <= y1; cy += 1) {
        for (let cx = x0; cx <= x1; cx += 1) {
          const bucket = cells.get((cy + LABEL_GRID_CLAMP) * LABEL_GRID_CLAMP * 2 + (cx + LABEL_GRID_CLAMP))
          if (!bucket) continue
          for (const placed of bucket) {
            if (lastVisit[placed] === stamp) continue
            lastVisit[placed] = stamp
            const penetration = penetrationOf(
              left,
              top,
              right,
              bottom,
              lefts[placed],
              tops[placed],
              rights[placed],
              bottoms[placed],
            )
            if (penetration <= 0) continue
            visibility *= 1 - visibilities[placed] * (1 - labelContestOpacity(penetration, fadePx))
            if (visibility === 0) return 0
          }
        }
      }
      return visibility
    },
    place(left: number, top: number, right: number, bottom: number, visibility: number) {
      const index = placedCount
      placedCount += 1
      lefts[index] = left
      tops[index] = top
      rights[index] = right
      bottoms[index] = bottom
      visibilities[index] = visibility
      lastVisit[index] = 0
      const x0 = cellCoord(left)
      const x1 = cellCoord(right)
      const y0 = cellCoord(top)
      const y1 = cellCoord(bottom)
      for (let cy = y0; cy <= y1; cy += 1) {
        for (let cx = x0; cx <= x1; cx += 1) {
          const key = (cy + LABEL_GRID_CLAMP) * LABEL_GRID_CLAMP * 2 + (cx + LABEL_GRID_CLAMP)
          let bucket = cells.get(key)
          if (!bucket) {
            bucket = bucketPool.pop() ?? []
            cells.set(key, bucket)
            activeBuckets.push(bucket)
          }
          bucket.push(index)
        }
      }
    },
  }
}

const sharedPlacedLabelGrid: PlacedLabelGrid = createPlacedLabelGrid()

type LabelWalkCounters = {
  drawn: number
  ramped: number
  dropped: number
  eligibleLabelCandidateCount: number
}

/**
 * The greedy screen-space declutter walk (#311), shared verbatim by the
 * allocation-free painter path (`drawLabels`) and the materializing digest
 * path (`declutterLabels`) — one walk, two sinks, no drift. Candidates walk
 * in the position-independent priority order; each eligible candidate's
 * opacity is its visibility against everything already placed (weighted by
 * the placed label's own opacity — see `visibilityAgainst`). On a contest,
 * ellipsis is preferred over dropping for the anchor's own card: the loser
 * retries at its own card's width and keeps whichever variant is more
 * visible — a label whose only sin was overflowing past its card truncates
 * instead of fading. Past the paint cap, the LOWEST-priority eligible
 * candidates drop first (the walk order guarantees it).
 *
 * OUTPUT-PURE per call: same candidates + order + viewport + fade ⇒ same
 * emissions (the shared grid and scratch are reset on entry and nothing in
 * them outlives the call). A dropped candidate costs nothing downstream:
 * `onDropped` receives only the index — no placement object, no bitmap
 * request, no ink resolve. The accounting identity
 * `drawn + dropped + ramped == eligibleLabelCandidateCount` holds on every
 * call — every eligible candidate hits exactly one sink.
 */
function walkLabelDeclutter(
  {
    band,
    candidates,
    viewportSize,
    resolveText,
    order,
    orderCount,
    fadePx,
    cap,
  }: {
    band: DetailBand
    candidates: readonly LabelCandidate[]
    viewportSize: BoardViewportSize
    resolveText: (text: string, maxWidthPx: number) => ResolvedLabelText
    order: ArrayLike<number>
    orderCount: number
    fadePx: number
    cap: number
  },
  onPlaced: (
    index: number,
    text: string,
    widthPx: number,
    anchorX: number,
    anchorY: number,
    opacity: number,
  ) => void,
  onDropped?: (index: number) => void,
): LabelWalkCounters {
  const grid = sharedPlacedLabelGrid
  grid.reset()
  let drawn = 0
  let ramped = 0
  let dropped = 0
  // Counted at the eligibility gate, INDEPENDENTLY of the outcome buckets, so
  // the E4 identity `drawn + dropped + ramped == eligibleLabelCandidateCount`
  // is an enforced invariant, not a definition.
  let eligibleLabelCandidateCount = 0

  for (let at = 0; at < orderCount; at += 1) {
    const index = order[at]
    const candidate = candidates[index]
    if (candidate.text.length === 0) continue
    const tier = labelPriorityTier(candidate.displayPriority, candidate.hovered, candidate.selected)
    // Band rule off displayPriority, plus the tier-1 override: a hovered or
    // selected card keeps its label in any label-bearing band. Reading is a
    // per-card suppression rule: mounted cards show their DOM title, while a
    // painted motion-overflow card that is not mounted keeps its canvas name.
    if (band === 'reading') {
      if (candidate.mountedInReading) continue
    } else if (tier !== 0 && !labelBandEligible(band, candidate.displayPriority)) {
      continue
    }
    eligibleLabelCandidateCount += 1

    // Past the cap nothing further paints — dropped, before any text/geometry
    // work (no measure, no bitmap, no ink: zero cache traffic by construction).
    if (drawn + ramped >= cap) {
      dropped += 1
      onDropped?.(index)
      continue
    }

    const full = resolveText(candidate.text, labelRenderMaxWidthPx(candidate.width))
    const anchorY = anchorYFor(candidate, viewportSize)
    const top = anchorY - LABEL_BITMAP_BASELINE_PX
    const bottom = top + LABEL_BITMAP_CSS_HEIGHT_PX
    let resolved = full
    let anchorX = anchorXFor(candidate, viewportSize, full.widthPx)
    let left = anchorX - LABEL_BITMAP_PAD_PX
    let right = left + Math.ceil(full.widthPx) + LABEL_BITMAP_PAD_PX * 2
    // Hover is the absolute draw-time winner, including against selection;
    // landmarks are structural anchors and never lose to collision, including
    // against another landmark. Both still enter the grid so lower tiers are
    // decluttered around them. The frame cap remains the separate performance
    // bound above — this exemption is collision-only.
    const collisionImmune = candidate.hovered || isLandmarkPriority(candidate.displayPriority)
    let visibility = collisionImmune ? 1 : grid.visibilityAgainst(left, top, right, bottom, fadePx)

    if (!collisionImmune && visibility < 1) {
      // Ellipsis over dropping for the anchor's own card: retry at the width
      // the card itself owns. Only a genuinely narrower box can score better.
      const cardFitWidthPx = Math.max(0, candidate.width - LABEL_ANCHOR_OFFSET_X_PX)
      if (cardFitWidthPx < full.widthPx) {
        const fit = resolveText(candidate.text, cardFitWidthPx)
        if (fit.widthPx < full.widthPx) {
          const fitAnchorX = anchorXFor(candidate, viewportSize, fit.widthPx)
          const fitLeft = fitAnchorX - LABEL_BITMAP_PAD_PX
          const fitRight = fitLeft + Math.ceil(fit.widthPx) + LABEL_BITMAP_PAD_PX * 2
          const fitVisibility = grid.visibilityAgainst(fitLeft, top, fitRight, bottom, fadePx)
          if (fitVisibility > visibility) {
            resolved = fit
            anchorX = fitAnchorX
            left = fitLeft
            right = fitRight
            visibility = fitVisibility
          }
        }
      }
    }

    if (visibility === 0) {
      dropped += 1
      onDropped?.(index)
      continue
    }
    // A placed label suppresses later candidates in proportion to its own
    // opacity (a v=0 label would suppress nothing), so only placed labels
    // enter the grid.
    grid.place(left, top, right, bottom, visibility)
    if (visibility === 1) drawn += 1
    else ramped += 1
    onPlaced(index, resolved.text, resolved.widthPx, anchorX, anchorY, visibility)
  }

  return { drawn, ramped, dropped, eligibleLabelCandidateCount }
}

// Test probe: every placement OBJECT ever materialized (only
// `declutterLabels` makes them). The painter path must leave this untouched
// — that is the finding-3 allocation contract, pinned by test.
let labelPlacementObjectAllocations = 0

export function labelPlacementObjectsForTests(): number {
  return labelPlacementObjectAllocations
}

/**
 * The materializing wrapper over the declutter walk: one `LabelPlacement`
 * object per ELIGIBLE candidate (dropped included), in walk order — the
 * digest/test seam. The production painter never calls this; it runs the
 * same walk into reusable scratch (see `drawLabels`).
 *
 * Dropped placements report the candidate's raw text and unclamped anchor —
 * the digest reads only their identity and zero opacity.
 */
export function declutterLabels({
  band,
  candidates,
  viewportSize,
  resolveText,
  order,
  fadePx = LABEL_CONTEST_FADE_PX,
  paintCap,
}: {
  band: DetailBand
  candidates: readonly LabelCandidate[]
  viewportSize: BoardViewportSize
  /** Ellipsize `text` to `maxWidthPx` — `memoisedEllipsize` in production. */
  resolveText: (text: string, maxWidthPx: number) => ResolvedLabelText
  /** Walk order; defaults to a fresh sort (the cache-less digest path). */
  order?: readonly number[]
  fadePx?: number
  paintCap?: number
}): LabelDeclutterResult {
  const walkOrder = order ?? sortLabelCandidateIndices(candidates)
  const placements: LabelPlacement[] = []
  const droppedIds: string[] = []
  const counters = walkLabelDeclutter(
    {
      band,
      candidates,
      viewportSize,
      resolveText,
      order: walkOrder,
      orderCount: walkOrder.length,
      fadePx,
      cap: paintCap ?? paintedLabelFrameCap(viewportSize),
    },
    (index, text, widthPx, anchorX, anchorY, opacity) => {
      labelPlacementObjectAllocations += 1
      placements.push({
        index,
        id: candidates[index].id,
        text,
        widthPx,
        anchorX,
        anchorY,
        opacity,
        outcome: opacity === 1 ? 'drawn' : 'ramped',
      })
    },
    (index) => {
      labelPlacementObjectAllocations += 1
      const candidate = candidates[index]
      droppedIds.push(candidate.id)
      placements.push({
        index,
        id: candidate.id,
        text: candidate.text,
        widthPx: 0,
        anchorX: candidate.x + LABEL_ANCHOR_OFFSET_X_PX,
        anchorY: candidate.y + LABEL_ANCHOR_OFFSET_Y_PX,
        opacity: 0,
        outcome: 'dropped',
      })
    },
  )
  return { placements, droppedIds, ...counters }
}

// ---------------------------------------------------------------------------
// The painter.

export type LabelPaintCounters = {
  paintedLabelCount: number
  labelCacheMissesPerFrame: number
  cacheEntries: number
  cacheBytes: number
  drawn: number
  ramped: number
  dropped: number
  eligibleLabelCandidateCount: number
  /** Optional O(1) retained-painter delta for one explicitly tracked Card. */
  trackedCandidateOutcome?: 'ineligible' | 'drawn' | 'ramped' | 'dropped'
}

// One process-wide cache, ink memo, and sort cache: labels are
// content-addressed, so sharing across layers/boards is safe and keeps a
// board switch warm; the sort cache simply re-sorts on its first frame after
// a board switch (the candidate set changed).
const sharedLabelBitmapCache = createLabelBitmapCache()
let sharedInkResolveInvocations = 0
const sharedLabelInk = createLabelInkResolver((palette, color) => {
  sharedInkResolveInvocations += 1
  return resolveLabelInk(palette, color)
})
const sharedLabelSortCache = createLabelSortCache()

/**
 * Test-only probe: total contrast resolutions through the production shared ink
 * resolver. The memoisation acceptance test reads this across un-injected
 * drawLabels frames, so constructing a fresh resolver per frame goes red.
 */
export function labelInkDarkenInvocationsForTests(): number {
  return sharedInkResolveInvocations
}

/**
 * Test-only probe: sorts performed by the PRODUCTION shared sort cache — the
 * zero-sort-on-pure-pan acceptance reads this across un-injected frames.
 */
export function labelDeclutterSortsForTests(): number {
  return sharedLabelSortCache.sortCountForTests()
}

// Paint scratch: the surviving placements of the current frame as parallel
// primitive arrays, reused every frame — bounded by the paint cap (≤ 352),
// NEVER by the eligible count. Reuse is allocation discipline, not state:
// `paintCount` is reset at the top of every drawLabels call and nothing here
// is read after the call returns (the probe below reports the last frame's
// count to tests).
const paintIndices: number[] = []
const paintTexts: string[] = []
const paintWidths: number[] = []
const paintAnchorXs: number[] = []
const paintAnchorYs: number[] = []
const paintOpacities: number[] = []
let paintCount = 0

/** Test-only probe: placements the LAST drawLabels frame materialized. */
export function labelPaintScratchCountForTests(): number {
  return paintCount
}

/**
 * Declutter, then paint (#311). The walk order comes from the rank cache
 * when the caller supplies the identity-stable `sortKey` (+ `sortEntries`):
 * a pure pan/zoom frame is four key equalities plus an O(v log v)
 * integer ordering of the visible candidates by cached rank — zero rank
 * computation, and never O(board) work. Without a key (tests, embedders)
 * every call sorts fresh.
 *
 * The walk emits survivors straight into reusable scratch — per-frame
 * allocation is bounded by the placed count, not the eligible count; a
 * dropped label allocates nothing and never touches the bitmap cache or the
 * ink memo. Painting then runs the scratch in REVERSE walk order so a
 * winner composites on top of the loser fading under it. A ramped label
 * blits its cached bitmap under `globalAlpha` — the alpha lives on the
 * context for that one blit, never in the cache key.
 */
export function drawLabels({
  context,
  band,
  candidates,
  ordinaryLabelAlpha = 1,
  viewportSize,
  devicePixelRatio,
  palette,
  paintIdentity = painterPaletteIdentity(palette),
  fontRevision = 0,
  cache = sharedLabelBitmapCache,
  ink = sharedLabelInk,
  sortCache = sharedLabelSortCache,
  sortKey,
  sortEntries,
  paintCandidate,
  trackedCandidateId,
}: {
  context: CanvasRenderingContext2D
  band: DetailBand
  candidates: readonly LabelCandidate[]
  /**
   * Zoom-pure Map↔Overview alpha for ordinary (tier 3/4) labels. Applied
   * only to the final bitmap blit/direct paint; it never enters eligibility,
   * collision, cache keys, cache work, or accounting.
   */
  ordinaryLabelAlpha?: number
  viewportSize: BoardViewportSize
  devicePixelRatio: number
  palette: PainterPalette
  paintIdentity?: string
  fontRevision?: number
  cache?: LabelBitmapCache
  ink?: LabelInkResolver
  sortCache?: LabelSortCache
  /** Identity-stable rank-cache key; supply together with `sortEntries`. */
  sortKey?: LabelSortKey
  /**
   * Whole-board rank-input visitor; invoked only when the key identity
   * changed (a rank rebuild), never on a pure pan frame.
   */
  sortEntries?: LabelSortInputs
  /**
   * Paint partition only. Every candidate still participates in the same
   * eligibility/declutter walk and counters, so retained label planes can
   * omit one transient label without changing any other label's outcome.
   */
  paintCandidate?: (candidate: LabelCandidate) => boolean
  /** Reports this Card's declutter outcome without materialising placements. */
  trackedCandidateId?: string
}): LabelPaintCounters {
  cache.beginFrame()

  let order: ArrayLike<number>
  let orderCount: number
  const ranked =
    sortKey && sortEntries ? orderCandidatesByRank(candidates, sortCache.ranks(sortKey, sortEntries)) : -1
  if (ranked >= 0) {
    order = orderScratch
    orderCount = ranked
  } else {
    const sorted = sortLabelCandidateIndices(candidates)
    order = sorted
    orderCount = sorted.length
  }

  // The context is only touched (save + font state) once a label actually
  // needs a measurement or a paint — a label-less frame leaves it untouched.
  let contextPrepared = false
  const prepareContext = () => {
    if (contextPrepared) return
    context.save()
    context.font = LABEL_FONT
    context.textBaseline = 'alphabetic'
    contextPrepared = true
  }

  paintCount = 0
  let trackedCandidateOutcome: LabelPaintCounters['trackedCandidateOutcome'] =
    trackedCandidateId === undefined ? undefined : 'ineligible'
  const counters = walkLabelDeclutter(
    {
      band,
      candidates,
      viewportSize,
      resolveText: (text, maxWidthPx) => {
        prepareContext()
        return memoisedEllipsize(context, text, maxWidthPx, LABEL_FONT, fontRevision)
      },
      order,
      orderCount,
      fadePx: LABEL_CONTEST_FADE_PX,
      cap: paintedLabelFrameCap(viewportSize),
    },
    (index, text, widthPx, anchorX, anchorY, opacity) => {
      if (candidates[index].id === trackedCandidateId) {
        trackedCandidateOutcome = opacity === 1 ? 'drawn' : 'ramped'
      }
      paintIndices[paintCount] = index
      paintTexts[paintCount] = text
      paintWidths[paintCount] = widthPx
      paintAnchorXs[paintCount] = anchorX
      paintAnchorYs[paintCount] = anchorY
      paintOpacities[paintCount] = opacity
      paintCount += 1
    },
    (index) => {
      if (candidates[index].id === trackedCandidateId) trackedCandidateOutcome = 'dropped'
    },
  )

  const halo = labelHaloForPalette(palette)
  for (let at = paintCount - 1; at >= 0; at -= 1) {
    prepareContext()
    const candidate = candidates[paintIndices[at]]
    if (paintCandidate && !paintCandidate(candidate)) continue
    const inkColor = ink.resolve(palette, candidate.color)
    const priorityTier = labelPriorityTier(candidate.displayPriority, candidate.hovered, candidate.selected)
    context.globalAlpha =
      paintOpacities[at] * (priorityTier >= 2 ? (candidate.ordinaryAlpha ?? ordinaryLabelAlpha) : 1)
    const bitmap = cache.bitmapFor({
      text: paintTexts[at],
      ink: inkColor,
      paletteKey: paintIdentity,
      halo,
      font: LABEL_FONT,
      fontRevision,
      dpr: devicePixelRatio,
      textWidthPx: paintWidths[at],
    })
    if (bitmap) {
      // Device-exact blit: the main transform is dpr-scaled, so a css-rect
      // destination maps the bitmap 1:1 onto device pixels — crisp text.
      context.drawImage(
        bitmap.source,
        paintAnchorXs[at] - LABEL_BITMAP_PAD_PX,
        paintAnchorYs[at] - LABEL_BITMAP_BASELINE_PX,
        bitmap.cssWidth,
        bitmap.cssHeight,
      )
    } else {
      // No offscreen 2d surface (or over-bound request): same spec, straight
      // onto the layer.
      applyHaloStroke(context, halo)
      context.strokeText(paintTexts[at], paintAnchorXs[at], paintAnchorYs[at])
      context.fillStyle = inkColor
      context.fillText(paintTexts[at], paintAnchorXs[at], paintAnchorYs[at])
    }
    context.globalAlpha = 1
  }
  if (contextPrepared) context.restore()

  return {
    paintedLabelCount: counters.drawn + counters.ramped,
    labelCacheMissesPerFrame: cache.missesThisFrame(),
    cacheEntries: cache.entryCount(),
    cacheBytes: cache.byteSize(),
    drawn: counters.drawn,
    ramped: counters.ramped,
    dropped: counters.dropped,
    eligibleLabelCandidateCount: counters.eligibleLabelCandidateCount,
    ...(trackedCandidateOutcome === undefined ? {} : { trackedCandidateOutcome }),
  }
}
