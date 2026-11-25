import { TITLE_CARD_TYPE_METRICS, fitFontSize } from './cards/titleCardFontFit'
import { LABEL_FONT_FAMILY } from './labelLayer'

/**
 * The painted half of the Title card. A Title card is text the founder drew at
 * a size, so unlike every other kind it has no low-detail stand-in: the painter
 * reproduces the DOM label at board scale instead of substituting a card shape
 * plus a fixed-size name. The type rule is shared with the DOM editor, so both
 * halves answer the same question (largest size whose wrapped text fits) and a
 * band crossing changes only who draws, never what is drawn.
 */

// The DOM card's inner box: `.title-card` padding plus its always-present 1px
// border, in board pixels. CSS owns the visible values; this mirrors them for
// the painter, and the shared browser proof fails if the two drift apart.
export const TITLE_CARD_PAINT_PADDING = Object.freeze({ x: 12 + 1, y: 8 + 1 })

const TITLE_CARD_FONT_WEIGHT = 700

export function titleCardCanvasFont(fontSizePx: number): string {
  return `${TITLE_CARD_FONT_WEIGHT} ${fontSizePx}px ${LABEL_FONT_FAMILY}`
}

/**
 * Greedy wrap at word boundaries. `breakWords` is the floor's safety net, the
 * painted twin of the editor's `overflow-wrap: break-word`: it only applies
 * once the fit has already given up on keeping a word whole.
 */
export function wrapTitleLines(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
  breakWords = false,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (word.length === 0) continue
      const candidate = line + word
      if (line !== '' && measure(candidate) > maxWidth) {
        lines.push(line.trimEnd())
        line = word.trimStart()
      } else {
        line = candidate
      }
      while (breakWords && measure(line) > maxWidth && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut -= 1
        lines.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

/** The widest line, the axis the fit rejects a size on. */
function widestLine(lines: readonly string[], measure: (value: string) => number): number {
  let widest = 0
  for (const line of lines) widest = Math.max(widest, measure(line))
  return widest
}

export type TitleCardTextLayout = {
  fontSize: number
  lines: readonly string[]
}

// Layout is pure geometry over one text and one board-space box, so a frame
// that pans a Title card across the viewport reuses the previous answer.
const layoutCache = new Map<string, TitleCardTextLayout>()
const LAYOUT_CACHE_LIMIT = 256

export function titleCardTextLayout(input: {
  text: string
  boardWidth: number
  boardHeight: number
  measure: (value: string, fontSize: number) => number
}): TitleCardTextLayout | undefined {
  const innerWidth = input.boardWidth - TITLE_CARD_PAINT_PADDING.x * 2
  const innerHeight = input.boardHeight - TITLE_CARD_PAINT_PADDING.y * 2
  if (!(innerWidth > 0) || !(innerHeight > 0) || input.text.length === 0) return undefined

  const key = `${Math.round(innerWidth)}x${Math.round(innerHeight)}:${input.text}`
  const cached = layoutCache.get(key)
  if (cached) return cached

  const fontSize = fitFontSize({
    box: { width: innerWidth, height: innerHeight },
    measure: (candidate) => {
      const measure = (value: string) => input.measure(value, candidate)
      const wrapped = wrapTitleLines(input.text, innerWidth, measure)
      return {
        width: widestLine(wrapped, measure),
        height: wrapped.length * candidate * TITLE_CARD_TYPE_METRICS.lineHeight,
      }
    },
  })
  // The search ends on a rejected candidate as often as an accepted one, so
  // re-wrap at the size actually chosen. Breaking is allowed here for the same
  // reason CSS allows it: at the floor, an overlong word must still stay inside.
  const lines = wrapTitleLines(
    input.text,
    innerWidth,
    (value) => input.measure(value, fontSize),
    true,
  )

  const layout = { fontSize, lines }
  if (layoutCache.size >= LAYOUT_CACHE_LIMIT) layoutCache.clear()
  layoutCache.set(key, layout)
  return layout
}

/** Test seam: the cache is keyed by content, so proofs must be able to drop it. */
export function clearTitleCardTextLayoutCache() {
  layoutCache.clear()
}

/**
 * Paints one Title card's text into a screen-space frame. Returns the painted
 * line count so the caller can report an honest representation.
 */
export function paintTitleCardText(
  context: CanvasRenderingContext2D,
  frame: {
    text: string
    x: number
    y: number
    width: number
    height: number
    zoom: number
    color: string
    opacity?: number
  },
): number {
  const zoom = frame.zoom > 0 ? frame.zoom : 1
  const layout = titleCardTextLayout({
    text: frame.text,
    boardWidth: frame.width / zoom,
    boardHeight: frame.height / zoom,
    measure: (value, fontSize) => {
      context.font = titleCardCanvasFont(fontSize)
      return context.measureText(value).width
    },
  })
  if (!layout) return 0

  const fontPx = layout.fontSize * zoom
  const linePx = fontPx * TITLE_CARD_TYPE_METRICS.lineHeight
  const left = frame.x + TITLE_CARD_PAINT_PADDING.x * zoom

  context.save()
  if (frame.opacity !== undefined) context.globalAlpha = frame.opacity
  context.font = titleCardCanvasFont(fontPx)
  context.fillStyle = frame.color
  context.textBaseline = 'alphabetic'
  context.textAlign = 'left'
  // Half-leading, exactly as CSS distributes a line box around its glyphs. CSS
  // centres the font's own content area (ascent + descent), which is taller
  // than the em square, so a painter that centred `fontPx` instead sat a few
  // percent of the type size off the DOM text. At a Title card's size that gap
  // is visible as a doubled ghost through the whole band crossfade.
  const metrics = context.measureText(layout.lines[0] ?? '')
  const ascent = metrics.fontBoundingBoxAscent
  const descent = metrics.fontBoundingBoxDescent
  const contentPx = Number.isFinite(ascent) && Number.isFinite(descent)
    ? ascent + descent
    : fontPx
  const firstBaseline =
    frame.y +
    TITLE_CARD_PAINT_PADDING.y * zoom +
    (linePx - contentPx) / 2 +
    (Number.isFinite(ascent) ? ascent : fontPx)
  let painted = 0
  for (const [index, line] of layout.lines.entries()) {
    const baseline = firstBaseline + index * linePx
    if (baseline - contentPx > frame.y + frame.height) break
    if (line.length > 0) {
      context.fillText(line, left, baseline)
      painted += 1
    }
  }
  context.restore()
  return painted
}
