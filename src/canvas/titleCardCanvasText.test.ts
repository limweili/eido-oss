import { describe, expect, it } from 'vitest'
import { TITLE_CARD_TYPE_METRICS } from './cards/titleCardFontFit'
import {
  TITLE_CARD_PAINT_PADDING,
  clearTitleCardTextLayoutCache,
  paintTitleCardText,
} from './titleCardCanvasText'

// A stand-in for the browser's text engine: every glyph is half its font size
// wide, and the font's content area is taller than its em square, exactly as a
// real face's ascent plus descent is. That gap is the whole subject of the
// baseline proof below.
const ASCENT_RATIO = 1.02
const DESCENT_RATIO = 0.3

type PaintedLine = { text: string; x: number; y: number }

function recordingContext(): { context: CanvasRenderingContext2D; painted: PaintedLine[] } {
  const painted: PaintedLine[] = []
  let fontSize = 10
  const context = {
    font: '',
    fillStyle: '',
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    textAlign: 'left' as CanvasTextAlign,
    globalAlpha: 1,
    save: () => undefined,
    restore: () => undefined,
    measureText: (value: string) => ({
      width: value.length * fontSize * 0.5,
      fontBoundingBoxAscent: fontSize * ASCENT_RATIO,
      fontBoundingBoxDescent: fontSize * DESCENT_RATIO,
    }),
    fillText: (text: string, x: number, y: number) => {
      painted.push({ text, x, y })
    },
  }
  Object.defineProperty(context, 'font', {
    get: () => `700 ${fontSize}px mono`,
    set: (value: string) => {
      fontSize = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(value)?.[1] ?? '10')
    },
  })
  return { context: context as unknown as CanvasRenderingContext2D, painted }
}

describe('paintTitleCardText', () => {
  it('places each line on the baseline CSS would give it', () => {
    clearTitleCardTextLayoutCache()
    const { context, painted } = recordingContext()
    const frame = { text: 'One two', x: 40, y: 100, width: 600, height: 200, zoom: 2 }

    expect(paintTitleCardText(context, { ...frame, color: '#000' })).toBe(painted.length)
    expect(painted).toHaveLength(1)

    const fontPx = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(context.font)![1])
    const linePx = fontPx * TITLE_CARD_TYPE_METRICS.lineHeight
    const contentPx = fontPx * (ASCENT_RATIO + DESCENT_RATIO)
    // Half-leading around the font's CONTENT area, not around its em square:
    // centring `fontPx` instead leaves the painted line a few percent of the
    // type size off the DOM text, which reads as a ghost through a crossfade.
    expect(painted[0].y).toBeCloseTo(
      frame.y +
        TITLE_CARD_PAINT_PADDING.y * frame.zoom +
        (linePx - contentPx) / 2 +
        fontPx * ASCENT_RATIO,
      5,
    )
    expect(painted[0].x).toBeCloseTo(frame.x + TITLE_CARD_PAINT_PADDING.x * frame.zoom, 5)
    expect(context.textBaseline).toBe('alphabetic')
  })

  it('mirrors the DOM card box: padding plus its always-present 1px border', () => {
    expect(TITLE_CARD_PAINT_PADDING).toEqual({ x: 13, y: 9 })
  })
})
