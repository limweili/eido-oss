import { describe, expect, it } from 'vitest'
import { TITLE_CARD_TYPE_METRICS, fitFontSize } from './titleCardFontFit'

// A stand-in for real text layout: monospace glyphs of `charWidth` ems wrap at
// word boundaries, and each line is one leading tall. Words never break, so an
// overlong word reports a width past the box exactly as the DOM twin does.
function monoLayout(input: { words: number[]; boxWidth: number; charWidth?: number }) {
  const charWidth = input.charWidth ?? 0.6
  return (fontSize: number) => {
    const glyph = fontSize * charWidth
    const lines: number[] = []
    let line = 0
    for (const word of input.words) {
      const candidate = line === 0 ? word : line + 1 + word
      if (line !== 0 && candidate * glyph > input.boxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
    return {
      width: Math.max(...lines) * glyph,
      height: lines.length * fontSize * TITLE_CARD_TYPE_METRICS.lineHeight,
    }
  }
}

const label = (characters: number) => [characters]
const phrase = (...words: number[]) => words

describe('fitFontSize', () => {
  it('grows the label as the drawn box grows', () => {
    const sizeFor = (width: number, height: number) =>
      fitFontSize({
        box: { width, height },
        measure: monoLayout({ words: phrase(5, 6), boxWidth: width }),
      })

    expect(sizeFor(160, 48)).toBeLessThan(sizeFor(320, 96))
    expect(sizeFor(320, 96)).toBeLessThan(sizeFor(900, 300))
  })

  it('shrinks the label as the text outgrows a fixed box', () => {
    const sizeFor = (words: number[]) =>
      fitFontSize({ box: { width: 320, height: 96 }, measure: monoLayout({ words, boxWidth: 320 }) })

    expect(sizeFor(phrase(4, 3))).toBeGreaterThan(sizeFor(phrase(4, 3, 6, 5, 7)))
    expect(sizeFor(phrase(4, 3, 6, 5, 7))).toBeGreaterThan(
      sizeFor(Array.from({ length: 40 }, () => 6)),
    )
  })

  it('keeps the fitted text inside the box on both axes', () => {
    const measure = monoLayout({ words: phrase(9, 4, 8), boxWidth: 280 })
    const fitted = fitFontSize({ box: { width: 280, height: 120 }, measure })

    const inside = measure(fitted)
    expect(inside.width).toBeLessThanOrEqual(280)
    expect(inside.height).toBeLessThanOrEqual(120)
    const larger = measure(fitted + 1)
    expect(larger.width > 280 || larger.height > 120).toBe(true)
  })

  it('shrinks a long single word rather than breaking it', () => {
    // 14 unbreakable characters in a 280px box: only a size where the whole
    // word fits one line is acceptable, even though a broken word would fit
    // the height at nearly twice that size.
    const measure = monoLayout({ words: label(14), boxWidth: 280 })
    const fitted = fitFontSize({ box: { width: 280, height: 400 }, measure })

    expect(measure(fitted).width).toBeLessThanOrEqual(280)
    expect(fitted).toBeLessThan(Math.floor(400 / TITLE_CARD_TYPE_METRICS.lineHeight))
  })

  it('holds the named bounds at both ends', () => {
    const tiny = fitFontSize({
      box: { width: 40, height: 12 },
      measure: monoLayout({ words: Array.from({ length: 90 }, () => 8), boxWidth: 40 }),
    })
    const huge = fitFontSize({
      box: { width: 4_000, height: 4_000 },
      measure: monoLayout({ words: label(1), boxWidth: 4_000 }),
    })

    expect(tiny).toBe(TITLE_CARD_TYPE_METRICS.minFontSize)
    expect(huge).toBe(TITLE_CARD_TYPE_METRICS.maxFontSize)
  })

  it('falls back to the smallest size when the box has no measurable area', () => {
    const measure = monoLayout({ words: label(4), boxWidth: 100 })
    expect(fitFontSize({ box: { width: 100, height: 0 }, measure })).toBe(
      TITLE_CARD_TYPE_METRICS.minFontSize,
    )
    expect(fitFontSize({ box: { width: 0, height: 100 }, measure })).toBe(
      TITLE_CARD_TYPE_METRICS.minFontSize,
    )
  })
})
