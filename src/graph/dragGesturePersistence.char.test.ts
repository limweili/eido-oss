import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IdeaSummary, SavedBoard } from './types'

// Characterization for #213: a full drag gesture — N intra-gesture
// no-history move commits followed by the gesture-end interaction summary —
// must always leave storage holding the final board state and the undo ring
// holding exactly ONE entry for the whole gesture. These tests pin that
// contract so the intra-gesture persistence path can change underneath it
// (per-frame commits, deferred persist) without changing what lands on disk
// or what one undo restores.

const saveMocks = vi.hoisted(() => ({
  scheduledBoards: [] as SavedBoard[],
  loadInitialIdea: vi.fn(),
  listIdeas: vi.fn(),
  saveIdeaBoard: vi.fn(),
}))

vi.mock('./save', () => ({
  emptyBoard: () => ({
    version: 1 as const,
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: new Date().toISOString(),
  }),
  makeSavedBoard: (partial: Partial<SavedBoard> = {}) => ({
    version: 1 as const,
    cards: partial.cards ?? [],
    connections: partial.connections ?? [],
    outputs: partial.outputs ?? [],
    runs: partial.runs ?? [],
    highlights: Array.isArray(partial.highlights) ? partial.highlights : [],
    highlightTags: Array.isArray(partial.highlightTags) ? partial.highlightTags : [],
    intentLog: Array.isArray(partial.intentLog) ? partial.intentLog : [],
    compactionSummaries: Array.isArray(partial.compactionSummaries) ? partial.compactionSummaries : [],
    ...(partial.aiSettings !== undefined ? { aiSettings: partial.aiSettings } : {}),
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
  }),
  loadInitialIdea: saveMocks.loadInitialIdea,
  loadIdea: vi.fn(),
  listIdeas: saveMocks.listIdeas,
  saveIdeaBoard: saveMocks.saveIdeaBoard,
  createIdea: vi.fn(),
  deleteIdea: vi.fn(),
  renameIdea: vi.fn(),
  currentStorageStatus: () => ({ backend: 'disk', dataFile: '/tmp/eido-v3-ideas.json' }),
  // Every persist() schedules a lazy snapshot source here; the debounce window
  // is irrelevant to this final-state contract, so the source is resolved and
  // recorded synchronously by the fake saver.
  makeDebouncedSaver: () => {
    type SaveRequest = { ideaId: string; board: SavedBoard }
    const schedule = ((source: SaveRequest | (() => SaveRequest)) => {
      const request = typeof source === 'function' ? source() : source
      saveMocks.scheduledBoards.push(request.board)
    }) as ((source: SaveRequest | (() => SaveRequest)) => void) & { flush: () => Promise<void> }
    schedule.flush = async () => {}
    return schedule
  },
}))

import { useGraph } from './store'

const idea: IdeaSummary = {
  id: 'idea-drag',
  name: 'Drag characterization',
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
  lastOpenedAt: '2026-07-06T00:00:00.000Z',
}

const initialBoard: SavedBoard = {
  version: 1,
  cards: [
    {
      id: 'note-a',
      kind: 'note',
      blocks: [{ id: 'note-a-block', text: 'a' }],
      position: { x: 0, y: 0 },
      headerColor: '#A1b2C3',
    },
    {
      id: 'note-b',
      kind: 'note',
      blocks: [{ id: 'note-b-block', text: 'b' }],
      position: { x: 400, y: 0 },
      size: { width: 260, height: 160 },
    },
  ],
  connections: [],
  outputs: [],
  runs: [],
  updatedAt: '2026-07-06T00:00:00.000Z',
}

function positionsById(cards: SavedBoard['cards']) {
  return Object.fromEntries(cards.map((card) => [card.id, card.position]))
}

async function hydrateBoard() {
  vi.clearAllMocks()
  saveMocks.scheduledBoards = []
  saveMocks.loadInitialIdea.mockResolvedValue({ idea, board: initialBoard, ideas: [idea] })
  saveMocks.listIdeas.mockResolvedValue([idea])
  saveMocks.saveIdeaBoard.mockResolvedValue(idea)
  useGraph.setState({ hydrated: false, currentIdeaId: null, undoStack: [], redoStack: [], intentLog: [] })
  await useGraph.getState().hydrate()
}

describe('drag gesture persistence characterization (#213)', () => {
  beforeEach(hydrateBoard)

  it('hydrates and snapshots a synthetic mixed-case header colour byte-for-byte', () => {
    const loaded = useGraph.getState().cards.find((card) => card.id === 'note-a')
    expect(loaded?.headerColor).toBe('#A1b2C3')

    const beforeEdit = useGraph.getState().cards
    useGraph.getState().setCardSize('note-a', { width: 280, height: 180 }, { recordHistory: false })
    useGraph.getState().recordCardStructuralChange('resizeCard', beforeEdit, useGraph.getState().cards)

    const snapshot = useGraph.getState().snapshot()
    const scheduled = saveMocks.scheduledBoards[saveMocks.scheduledBoards.length - 1]
    expect(snapshot.cards.find((card) => card.id === 'note-a')?.headerColor).toBe('#A1b2C3')
    expect(scheduled.cards.find((card) => card.id === 'note-a')?.headerColor).toBe('#A1b2C3')
  })

  it('a multi-card drag gesture persists the final state and mints exactly one history entry', () => {
    const preDrag = useGraph.getState().cards
    const preDragPositions = positionsById(preDrag)
    const undoDepthBefore = useGraph.getState().undoStack.length

    // The gesture: 20 frames of no-history move commits, then the gesture-end
    // summary — the exact call sequence Board.tsx makes for a drag.
    for (let frame = 1; frame <= 20; frame += 1) {
      useGraph.getState().moveCards(
        [
          { id: 'note-a', position: { x: frame * 15, y: frame * 6 } },
          { id: 'note-b', position: { x: 400 + frame * 15, y: frame * 6 } },
        ],
        { recordHistory: false },
      )
    }
    useGraph.getState().recordCardStructuralChange('moveCard', preDrag, useGraph.getState().cards)

    // Exactly ONE history entry for the whole gesture.
    expect(useGraph.getState().undoStack.length).toBe(undoDepthBefore + 1)

    // The final scheduled save holds the gesture's final board state.
    expect(saveMocks.scheduledBoards.length).toBeGreaterThanOrEqual(1)
    const lastSaved = saveMocks.scheduledBoards[saveMocks.scheduledBoards.length - 1]
    expect(positionsById(lastSaved.cards)).toEqual({
      'note-a': { x: 300, y: 120 },
      'note-b': { x: 700, y: 120 },
    })
    expect(lastSaved.cards).toEqual(useGraph.getState().cards)
    expect(lastSaved.intentLog).toEqual(useGraph.getState().intentLog)

    // One undo restores every pre-drag position.
    useGraph.getState().undo()
    expect(positionsById(useGraph.getState().cards)).toEqual(preDragPositions)
  })

  it('a single-card drag gesture behaves identically through the moveCard path', () => {
    const preDrag = useGraph.getState().cards
    const undoDepthBefore = useGraph.getState().undoStack.length

    for (let frame = 1; frame <= 12; frame += 1) {
      useGraph.getState().moveCards([{ id: 'note-a', position: { x: frame * 10, y: 0 } }], {
        recordHistory: false,
      })
    }
    useGraph.getState().recordCardStructuralChange('moveCard', preDrag, useGraph.getState().cards)

    expect(useGraph.getState().undoStack.length).toBe(undoDepthBefore + 1)
    const lastSaved = saveMocks.scheduledBoards[saveMocks.scheduledBoards.length - 1]
    expect(positionsById(lastSaved.cards)['note-a']).toEqual({ x: 120, y: 0 })
    expect(lastSaved.cards).toEqual(useGraph.getState().cards)

    useGraph.getState().undo()
    expect(positionsById(useGraph.getState().cards)['note-a']).toEqual({ x: 0, y: 0 })
  })

  it('a live resize gesture persists the final size and mints exactly one history entry', () => {
    const preResize = useGraph.getState().cards
    const undoDepthBefore = useGraph.getState().undoStack.length

    // The exact no-history size sequence CardResizeHandles makes during a resize.
    for (let frame = 1; frame <= 10; frame += 1) {
      useGraph.getState().setCardSize('note-b', { width: 260 + frame * 12, height: 160 + frame * 8 }, {
        recordHistory: false,
      })
    }
    useGraph.getState().recordCardStructuralChange('resizeCard', preResize, useGraph.getState().cards)

    expect(useGraph.getState().undoStack.length).toBe(undoDepthBefore + 1)
    const lastSaved = saveMocks.scheduledBoards[saveMocks.scheduledBoards.length - 1]
    expect(lastSaved.cards.find((card) => card.id === 'note-b')?.size).toEqual({ width: 380, height: 240 })
    expect(lastSaved.cards).toEqual(useGraph.getState().cards)

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find((card) => card.id === 'note-b')?.size).toEqual({
      width: 260,
      height: 160,
    })
  })

  it('a top-left resize persists position and size together as one gesture', () => {
    const preResize = useGraph.getState().cards
    const savesBefore = saveMocks.scheduledBoards.length
    const undoDepthBefore = useGraph.getState().undoStack.length

    for (let frame = 1; frame <= 10; frame += 1) {
      useGraph.getState().moveCard(
        'note-b',
        { x: 400 - frame * 8, y: -frame * 5 },
        { recordHistory: false },
      )
      useGraph.getState().setCardSize(
        'note-b',
        { width: 260 + frame * 8, height: 160 + frame * 5 },
        { recordHistory: false },
      )
    }
    useGraph.getState().recordCardStructuralChange('resizeCard', preResize, useGraph.getState().cards)

    expect(saveMocks.scheduledBoards.length).toBe(savesBefore + 1)
    expect(useGraph.getState().undoStack.length).toBe(undoDepthBefore + 1)
    const lastSaved = saveMocks.scheduledBoards[saveMocks.scheduledBoards.length - 1]
    expect(lastSaved.cards.find((card) => card.id === 'note-b')).toMatchObject({
      position: { x: 320, y: -50 },
      size: { width: 340, height: 210 },
    })

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find((card) => card.id === 'note-b')).toMatchObject({
      position: { x: 400, y: 0 },
      size: { width: 260, height: 160 },
    })
  })
})

// The #213 store change itself: intra-gesture no-history commits build no
// snapshot and schedule no save; the one gesture-end summary does.
describe('intra-gesture persistence is deferred to gesture end (#213)', () => {
  beforeEach(hydrateBoard)

  it('no-history move and resize commits schedule zero saves; the summary schedules one', () => {
    const preGesture = useGraph.getState().cards
    const savesBefore = saveMocks.scheduledBoards.length

    for (let frame = 1; frame <= 20; frame += 1) {
      useGraph.getState().moveCards(
        [
          { id: 'note-a', position: { x: frame * 15, y: frame * 6 } },
          { id: 'note-b', position: { x: 400 + frame * 15, y: frame * 6 } },
        ],
        { recordHistory: false },
      )
      useGraph.getState().setCardSize('note-b', { width: 260 + frame, height: 160 }, { recordHistory: false })
    }
    expect(saveMocks.scheduledBoards.length).toBe(savesBefore)

    useGraph.getState().recordCardStructuralChange('moveCard', preGesture, useGraph.getState().cards)
    expect(saveMocks.scheduledBoards.length).toBe(savesBefore + 1)
    // Queued work is not a write. The indicator only claims "Saving" once
    // the writer starts, so the quiet window keeps the last real status.
    expect(useGraph.getState().saveState).not.toBe('saving')
    expect(saveMocks.scheduledBoards[saveMocks.scheduledBoards.length - 1].cards).toEqual(
      useGraph.getState().cards,
    )
  })
})
