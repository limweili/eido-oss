import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HIGHLIGHT_TAG_NAME,
  HIGHLIGHT_PALETTE,
  migrateLegacyHighlights,
  nextTagColor,
  paletteColor,
} from './highlights'
import type { Card, HighlightTag, SavedBoard } from './types'

function note(id: string, text: string): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text }],
    position: { x: 0, y: 0 },
  }
}

function board(cards: Card[]): SavedBoard {
  return {
    version: 1,
    cards,
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

function tag(id: string, color: string): HighlightTag {
  return { id, name: id, color, createdAt: '2026-07-01T00:00:00.000Z' }
}

describe('tag colors', () => {
  it('publishes the approved palette order as semantic wash and dot token pairs', () => {
    expect(HIGHLIGHT_PALETTE).toEqual([
      { id: 'yellow', bg: 'var(--e-hl-yellow)', swatch: 'var(--e-hl-yellow-dot)' },
      { id: 'green', bg: 'var(--e-hl-green)', swatch: 'var(--e-hl-green-dot)' },
      { id: 'blue', bg: 'var(--e-hl-blue)', swatch: 'var(--e-hl-blue-dot)' },
      { id: 'pink', bg: 'var(--e-hl-pink)', swatch: 'var(--e-hl-pink-dot)' },
      { id: 'orange', bg: 'var(--e-hl-orange)', swatch: 'var(--e-hl-orange-dot)' },
      { id: 'purple', bg: 'var(--e-hl-purple)', swatch: 'var(--e-hl-purple-dot)' },
      { id: 'teal', bg: 'var(--e-hl-teal)', swatch: 'var(--e-hl-teal-dot)' },
      { id: 'red', bg: 'var(--e-hl-red)', swatch: 'var(--e-hl-red-dot)' },
      { id: 'brown', bg: 'var(--e-hl-brown)', swatch: 'var(--e-hl-brown-dot)' },
      { id: 'gray', bg: 'var(--e-hl-gray)', swatch: 'var(--e-hl-gray-dot)' },
    ])
  })

  it('cycles through the palette by least use', () => {
    expect(nextTagColor([])).toBe(HIGHLIGHT_PALETTE[0].id)
    expect(nextTagColor([tag('a', HIGHLIGHT_PALETTE[0].id)])).toBe(HIGHLIGHT_PALETTE[1].id)
    const allUsedOnce = HIGHLIGHT_PALETTE.map((color, index) => tag(`t${index}`, color.id))
    expect(nextTagColor(allUsedOnce)).toBe(HIGHLIGHT_PALETTE[0].id)
  })

  it('falls back to the first palette color for unknown ids', () => {
    expect(paletteColor('not-a-color')).toBe(HIGHLIGHT_PALETTE[0])
  })

  it('preserves arbitrary saved color bytes while rendering the safe fallback', () => {
    const existing = tag('custom', '#D09c7B80')
    const source: SavedBoard = {
      ...board([note('n1', 'No marks here')]),
      highlightTags: [existing],
    }
    const savedTagBytes = JSON.stringify(source.highlightTags)

    const result = migrateLegacyHighlights(source)

    expect(JSON.stringify(result.highlightTags)).toBe(savedTagBytes)
    expect(result.highlightTags[0].color).toBe('#D09c7B80')
    expect(paletteColor(result.highlightTags[0].color)).toBe(HIGHLIGHT_PALETTE[0])
  })
})

describe('migrateLegacyHighlights', () => {
  it('strips ==marks== from note text and recreates them as saved highlights', () => {
    const result = migrateLegacyHighlights(board([note('n1', 'A ==bright== note with ==focus==')]))

    expect(result.cards[0].blocks[0].text).toBe('A bright note with focus')
    expect(result.highlights).toHaveLength(2)
    expect(result.highlights.map((h) => h.text)).toEqual(['bright', 'focus'])
    expect(result.highlights.every((h) => h.cardId === 'n1')).toBe(true)
    expect(result.highlightTags).toHaveLength(1)
    expect(result.highlightTags[0].name).toBe(DEFAULT_HIGHLIGHT_TAG_NAME)
    expect(result.highlights.every((h) => h.tagId === result.highlightTags[0].id)).toBe(true)
  })

  it('pins repeated marked phrases to the right occurrence', () => {
    const result = migrateLegacyHighlights(board([note('n1', 'echo then ==echo== then echo')]))

    expect(result.cards[0].blocks[0].text).toBe('echo then echo then echo')
    expect(result.highlights[0].occurrence).toBe(1)
  })

  it('leaves boards without legacy marks untouched', () => {
    const source = board([note('n1', 'No marks here')])
    const result = migrateLegacyHighlights(source)

    expect(result.cards).toBe(source.cards)
    expect(result.highlights).toEqual([])
    expect(result.highlightTags).toEqual([])
  })

  it('reuses an existing tag set instead of inventing a second default', () => {
    const existing = tag('keep', 'green')
    const source: SavedBoard = {
      ...board([note('n1', 'A ==bright== note')]),
      highlightTags: [existing],
      highlights: [],
    }
    const result = migrateLegacyHighlights(source)

    expect(result.highlightTags).toEqual([existing])
    expect(result.highlights[0].tagId).toBe('keep')
  })
})
