// Highlight tags and their colors. A tag is a lightweight category the user
// creates from the highlighter itself; every tag gets a pre-picked color from a
// fixed palette (Notion-style) so the user never has to choose one.

import { newId } from '../shared/ids'
import { countMatchesBefore } from '../shared/textMatch'
import type { Card, Highlight, HighlightTag, SavedBoard } from './types'

export type HighlightPaletteColor = {
  id: string
  bg: string // the wash painted behind highlighted text
  swatch: string // the saturated dot used for chips and headers
}

// Ordered: new tags take the first least-used color, so early tags read as the
// classic marker colors before drifting into the quieter ones.
export const HIGHLIGHT_PALETTE: readonly HighlightPaletteColor[] = [
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
]

export const DEFAULT_HIGHLIGHT_TAG_NAME = 'Important'

export function paletteColor(colorId: string): HighlightPaletteColor {
  return HIGHLIGHT_PALETTE.find((color) => color.id === colorId) ?? HIGHLIGHT_PALETTE[0]
}

// The least-used palette color, ties broken by palette order — mirrors how Notion
// hands out tag colors without ever asking.
export function nextTagColor(tags: HighlightTag[]): string {
  const usage = new Map(HIGHLIGHT_PALETTE.map((color) => [color.id, 0]))
  for (const tag of tags) {
    if (usage.has(tag.color)) usage.set(tag.color, (usage.get(tag.color) ?? 0) + 1)
  }
  let best = HIGHLIGHT_PALETTE[0].id
  let bestCount = Number.POSITIVE_INFINITY
  for (const color of HIGHLIGHT_PALETTE) {
    const count = usage.get(color.id) ?? 0
    if (count < bestCount) {
      best = color.id
      bestCount = count
    }
  }
  return best
}

export function makeHighlightTag(name: string, tags: HighlightTag[]): HighlightTag {
  return {
    id: newId('tag'),
    name: name.trim() || DEFAULT_HIGHLIGHT_TAG_NAME,
    color: nextTagColor(tags),
    createdAt: new Date().toISOString(),
  }
}

export function findTagByName(tags: HighlightTag[], name: string): HighlightTag | undefined {
  const wanted = name.trim().toLowerCase()
  return wanted ? tags.find((tag) => tag.name.trim().toLowerCase() === wanted) : undefined
}

// ---- Legacy migration -----------------------------------------------------------
// Earlier boards stored highlights inline as ==marked text== inside note text.
// On load, those markers are stripped from the text and re-created as saved
// highlights under a default tag, so nothing the user marked is lost.

const LEGACY_HIGHLIGHT_RE = /==([^=\n]+)==/g

function hasLegacyMark(text: string): boolean {
  return /==([^=\n]+)==/.test(text)
}

function isLegacyMarkedNote(card: Card): boolean {
  return card.kind === 'note' && card.blocks.some((block) => hasLegacyMark(block.text))
}

type LegacyMigrationResult = {
  cards: Card[]
  highlights: Highlight[]
  highlightTags: HighlightTag[]
}

export function migrateLegacyHighlights(board: SavedBoard): LegacyMigrationResult {
  const highlights = board.highlights ?? []
  const highlightTags = board.highlightTags ?? []
  if (!board.cards.some(isLegacyMarkedNote)) return { cards: board.cards, highlights, highlightTags }

  const tags = [...highlightTags]
  let defaultTag = findTagByName(tags, DEFAULT_HIGHLIGHT_TAG_NAME) ?? tags[0]
  if (!defaultTag) {
    defaultTag = makeHighlightTag(DEFAULT_HIGHLIGHT_TAG_NAME, tags)
    tags.push(defaultTag)
  }

  const migrated: Highlight[] = []
  const cards = board.cards.map((card) => {
    if (!isLegacyMarkedNote(card)) return card

    const blocks = card.blocks.map((block) => ({
      ...block,
      text: block.text.replace(LEGACY_HIGHLIGHT_RE, '$1'),
    }))
    const strippedCardText = blocks.map((block) => block.text).join('\n')

    // Walk the original text and place each marked span against the stripped text.
    const originalText = card.blocks.map((block) => block.text).join('\n')
    let removed = 0
    for (const match of originalText.matchAll(LEGACY_HIGHLIGHT_RE)) {
      const text = match[1]
      const strippedStart = (match.index ?? 0) - removed
      removed += 4 // the two == pairs dropped by this match
      migrated.push({
        id: newId('hl'),
        cardId: card.id,
        tagId: defaultTag.id,
        text,
        occurrence: countMatchesBefore(strippedCardText, text, strippedStart),
        createdAt: new Date().toISOString(),
      })
    }

    return { ...card, blocks }
  })

  return { cards, highlights: [...highlights, ...migrated], highlightTags: tags }
}
