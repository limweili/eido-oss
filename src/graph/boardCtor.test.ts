import { describe, expect, it } from 'vitest'
import { makeSavedBoard } from './save'
import type { Card, SavedBoard } from './types'

// Minimal note card from an old-format board.
function oldCard(extra: Partial<Card> = {}): Card {
  return {
    id: 'note-1',
    kind: 'note',
    blocks: [{ id: 'block-1', text: 'Hello' }],
    position: { x: 0, y: 0 },
    ...extra,
  }
}

// Partial SavedBoard as it might exist in an old save file (some fields absent).
function partialBoard(extra: Partial<SavedBoard> = {}): SavedBoard {
  return {
    version: 1,
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  }
}

// Canonical empty-board JSON: the exact shape and field order produced by
// makeSavedBoard when called with only updatedAt. Any change to this string
// is a breaking change to the SavedBoard wire format.
const EMPTY_BOARD_JSON =
  '{"version":1,"cards":[],"connections":[],"outputs":[],"runs":[],"highlights":[],"highlightTags":[],"intentLog":[],"compactionSummaries":[],"updatedAt":"2026-01-01T00:00:00.000Z"}'

describe('makeSavedBoard — emptyBoard() parity', () => {
  it('produces an empty board with all collection fields present', () => {
    const board = makeSavedBoard({ updatedAt: '2026-01-01T00:00:00.000Z' })

    expect(board.version).toBe(1)
    expect(board.cards).toEqual([])
    expect(board.connections).toEqual([])
    expect(board.outputs).toEqual([])
    expect(board.runs).toEqual([])
    expect(board.intentLog).toEqual([])
    expect(board.highlights).toEqual([])
    expect(board.highlightTags).toEqual([])
    expect(board.compactionSummaries).toEqual([])
    expect(board.updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('field order, absent aiSettings, and all defaults pinned byte-for-byte', () => {
    const board = makeSavedBoard({ updatedAt: '2026-01-01T00:00:00.000Z' })
    expect(JSON.stringify(board)).toBe(EMPTY_BOARD_JSON)
  })

  // DIVERGENCE: emptyBoard() omitted highlights/highlightTags/compactionSummaries.
  // Winner: normalizeBoardForRuntime — all collection fields are always present.
  it('includes highlights, highlightTags, and compactionSummaries (unlike old emptyBoard)', () => {
    const board = makeSavedBoard({ updatedAt: '2026-01-01T00:00:00.000Z' })

    expect(board).toHaveProperty('highlights', [])
    expect(board).toHaveProperty('highlightTags', [])
    expect(board).toHaveProperty('compactionSummaries', [])
  })
})

describe('makeSavedBoard — normalizeBoardForRuntime() parity', () => {
  it('defaults missing optional collections to empty arrays', () => {
    const board = makeSavedBoard(partialBoard())

    expect(board.highlights).toEqual([])
    expect(board.highlightTags).toEqual([])
    expect(board.intentLog).toEqual([])
    expect(board.compactionSummaries).toEqual([])
  })

  it('full shape from a minimal old-format board matches byte-for-byte', () => {
    const board = makeSavedBoard(partialBoard())
    expect(JSON.stringify(board)).toBe(EMPTY_BOARD_JSON)
  })

  it('preserves existing optional collections', () => {
    const highlight = { id: 'h-1', tagId: 't-1', cardId: 'note-1', text: 'foo', occurrence: 0, createdAt: '2026-01-01T00:00:00.000Z' }
    const board = makeSavedBoard(partialBoard({ highlights: [highlight] }))
    expect(board.highlights).toEqual([highlight])
  })

  it('coerces non-array optional fields to empty arrays', () => {
    // Simulates a very old save that had a scalar or missing field.
    const board = makeSavedBoard({
      version: 1,
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: undefined,
      highlights: undefined,
      highlightTags: undefined,
      compactionSummaries: undefined,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(board.intentLog).toEqual([])
    expect(board.highlights).toEqual([])
    expect(board.highlightTags).toEqual([])
    expect(board.compactionSummaries).toEqual([])
  })

  it('preserves an empty updatedAt from an old board', () => {
    const board = makeSavedBoard({
      version: 1,
      cards: [oldCard()],
      connections: [],
      outputs: [],
      runs: [],
      updatedAt: '',
    })

    expect(board.updatedAt).toBe('')
  })

  it('preserves updatedAt from the input board — including empty string', () => {
    expect(makeSavedBoard(partialBoard({ updatedAt: '2026-03-15T12:00:00.000Z' })).updatedAt)
      .toBe('2026-03-15T12:00:00.000Z')
    // '' must round-trip: load path preserves old boards that had no updatedAt
    expect(makeSavedBoard({ version: 1, cards: [], connections: [], outputs: [], runs: [], updatedAt: '' }).updatedAt)
      .toBe('')
  })

  // makeSavedBoard is pure shape defaulting — it does NOT run legacy highlight
  // migration. That migration is load-path only (normalizeBoardForRuntime in
  // store.ts) so that snapshot() never strips user-typed ==marks== or mints
  // stale highlight IDs against live store state.
  it('does NOT migrate legacy ==marks== (migration is load-path only)', () => {
    const legacyCard: Card = {
      id: 'note-legacy',
      kind: 'note',
      blocks: [{ id: 'block-1', text: '==important== phrase' }],
      position: { x: 0, y: 0 },
    }
    const board = makeSavedBoard(partialBoard({ cards: [legacyCard] }))

    // Text is unchanged — no stripping.
    expect(board.cards[0].blocks[0].text).toBe('==important== phrase')
    // No highlight was minted.
    expect(board.highlights).toEqual([])
  })

  it('preserves aiSettings when provided, in correct field position', () => {
    const aiSettings = {
      model: 'claude-opus-4-8',
      models: [] as string[],
      reasoningEffort: 'high' as const,
      chainConfirmThreshold: 3,
      compactionMode: 'when-needed' as const,
    }
    const board = makeSavedBoard(partialBoard({ aiSettings }))
    expect(board.aiSettings).toEqual(aiSettings)
    // aiSettings appears in JSON between compactionSummaries and updatedAt
    const json = JSON.parse(JSON.stringify(board))
    const keys = Object.keys(json)
    expect(keys.indexOf('aiSettings')).toBeLessThan(keys.indexOf('updatedAt'))
    expect(keys.indexOf('compactionSummaries')).toBeLessThan(keys.indexOf('aiSettings'))
  })

  it('omits aiSettings when not provided — absent, not undefined', () => {
    const board = makeSavedBoard(partialBoard())
    expect(board).not.toHaveProperty('aiSettings')
    expect(JSON.stringify(board)).not.toContain('aiSettings')
  })
})

describe('makeSavedBoard — round-trip', () => {
  it('is idempotent: applying it twice yields the same JSON', () => {
    const at = '2026-06-01T00:00:00.000Z'
    const card = oldCard()
    const first = makeSavedBoard(partialBoard({ cards: [card], updatedAt: at }))
    const second = makeSavedBoard(first)

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})
