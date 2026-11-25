import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UNDO_RING_LIMIT, isPatchUndoEntry } from './commitFunnel'
import type { Card, IdeaSummary, SavedBoard } from './types'

// Storage is mocked so the board-switch test can drive loadIdea without a
// backend; every other test in this file never touches persistence.
const saveMocks = vi.hoisted(() => ({
  loadIdea: vi.fn(),
  listIdeas: vi.fn(async () => [] as IdeaSummary[]),
}))

vi.mock('./save', () => ({
  emptyBoard: () => ({
    version: 1 as const,
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    highlights: [],
    highlightTags: [],
    intentLog: [],
    compactionSummaries: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
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
  loadInitialIdea: vi.fn(),
  loadIdea: saveMocks.loadIdea,
  listIdeas: saveMocks.listIdeas,
  saveIdeaBoard: vi.fn(),
  createIdea: vi.fn(),
  deleteIdea: vi.fn(),
  renameIdea: vi.fn(),
  currentStorageStatus: () => ({ backend: 'disk', dataFile: '/tmp/eido-v3-ideas.json' }),
  makeDebouncedSaver: () => {
    const schedule = ((_board: SavedBoard) => {}) as ((board: SavedBoard) => void) & {
      flush: () => Promise<void>
    }
    schedule.flush = async () => {}
    return schedule
  },
}))

import { useGraph } from './store'

function resetStore() {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    intentLog: [],
    lastBoardChange: null,
    boardChangeSeq: 0,
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    hydrated: false,
    currentIdeaId: null,
    keyPromptOpen: false,
    ideaManagerOpen: false,
  })
}

function card(id: string, kind: Card['kind'], extra: Partial<Card> = {}): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text: '' }],
    position: { x: 0, y: 0 },
    ...extra,
  }
}

function latestBoardChange() {
  const emission = useGraph.getState().lastBoardChange
  expect(emission).toBeTruthy()
  return emission!
}

describe('the commit funnel (ADR 0016) — three commit shapes', () => {
  beforeEach(resetStore)

  it('MUTATING commit: state + one undo entry + events, all under one commitId', () => {
    useGraph.setState({ cards: [card('note-1', 'note')] })

    const result = useGraph.getState().commit(
      'Test mutation',
      (draft) => {
        draft.cards[0].position = { x: 40, y: 8 }
      },
      [{ type: 'card.content.edited', cardId: 'note-1', data: { field: 'body' } }],
    )

    expect(result.changed).toBe(true)
    expect(useGraph.getState().cards[0].position).toEqual({ x: 40, y: 8 })

    const undoStack = useGraph.getState().undoStack
    expect(undoStack).toHaveLength(1)
    const entry = undoStack[0]
    expect(isPatchUndoEntry(entry)).toBe(true)
    if (!isPatchUndoEntry(entry)) return
    expect(entry.commitId).toBe(result.commitId)
    expect(entry.label).toBe('Test mutation')
    expect(entry.inversePatches.length).toBeGreaterThan(0)
    expect(entry.forwardPatches.length).toBeGreaterThan(0)

    const log = useGraph.getState().intentLog
    expect(log).toHaveLength(1)
    expect(log[0].commitId).toBe(result.commitId)

    const emission = latestBoardChange()
    expect(emission).toMatchObject({
      seq: 1,
      source: 'commit',
      commitId: result.commitId,
      label: 'Test mutation',
      change: {
        cards: { updated: ['note-1'] },
        cardAspects: ['position'],
      },
    })
  })

  it('NARRATIVE commit: events append under their own commitId, no undo entry', () => {
    useGraph.setState({ cards: [card('note-1', 'note')] })

    const result = useGraph.getState().commit(
      'Narrative only',
      () => {},
      [{ type: 'card.content.edited', cardId: 'note-1', data: { field: 'body', textLength: 5 } }],
    )

    expect(result.changed).toBe(false)
    expect(useGraph.getState().undoStack).toHaveLength(0)
    const log = useGraph.getState().intentLog
    expect(log).toHaveLength(1)
    expect(log[0].commitId).toBe(result.commitId)
    expect(useGraph.getState().lastBoardChange).toBeNull()
    expect(useGraph.getState().boardChangeSeq).toBe(0)
  })

  it('EMPTY commit: nothing is written at all', () => {
    useGraph.setState({ cards: [card('note-1', 'note')] })
    const cardsBefore = useGraph.getState().cards

    const result = useGraph.getState().commit('Nothing', () => {}, [])

    expect(result.changed).toBe(false)
    expect(result.commitId).toBeNull() // nothing happened, no identity allocated
    expect(useGraph.getState().cards).toBe(cardsBefore)
    expect(useGraph.getState().undoStack).toHaveLength(0)
    expect(useGraph.getState().intentLog).toHaveLength(0)
    expect(useGraph.getState().lastBoardChange).toBeNull()
  })

  it('stamps every event with commitId, actorId, clientTxnId, and a monotonic seq', () => {
    useGraph.setState({ cards: [card('note-1', 'note')] })

    useGraph.getState().commit('First', () => {}, [
      { type: 'card.content.edited', cardId: 'note-1', data: { field: 'body' } },
      { type: 'card.content.edited', cardId: 'note-1', data: { field: 'title' } },
    ])
    useGraph.getState().commit('Second', () => {}, [
      { type: 'card.content.edited', cardId: 'note-1', data: { field: 'body' } },
    ])

    const log = useGraph.getState().intentLog
    expect(log).toHaveLength(3)
    for (const event of log) {
      expect(event.commitId).toMatch(/^commit_/)
      expect(event.actorId).toMatch(/^actor_/)
      expect(event.clientTxnId).toMatch(/^txn_/)
      expect(event.id).toMatch(/^evt_/)
      expect(event.at).toBeTruthy()
    }
    // One commit = one commitId/clientTxnId shared by its events.
    expect(log[0].commitId).toBe(log[1].commitId)
    expect(log[0].clientTxnId).toBe(log[1].clientTxnId)
    expect(log[2].commitId).not.toBe(log[0].commitId)
    // Same client → same actor.
    expect(log[2].actorId).toBe(log[0].actorId)
    // seq is monotonic across commits within the log.
    expect(log.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('a mutating commit clears the redo stack; a narrative commit does not', () => {
    useGraph.setState({ cards: [card('note-1', 'note')] })
    useGraph.getState().commit('Move', (draft) => {
      draft.cards[0].position = { x: 10, y: 10 }
    }, [])
    useGraph.getState().undo()
    expect(useGraph.getState().redoStack).toHaveLength(1)

    useGraph.getState().commit('Narrate', () => {}, [
      { type: 'card.content.edited', cardId: 'note-1', data: { field: 'body' } },
    ])
    expect(useGraph.getState().redoStack).toHaveLength(1)

    useGraph.getState().commit('Move again', (draft) => {
      draft.cards[0].position = { x: 20, y: 20 }
    }, [])
    expect(useGraph.getState().redoStack).toHaveLength(0)
  })

  it('caps the undo ring at UNDO_RING_LIMIT patch entries', () => {
    useGraph.setState({ cards: [card('note-1', 'note')] })
    for (let index = 0; index < UNDO_RING_LIMIT + 5; index += 1) {
      useGraph.getState().commit('Move', (draft) => {
        draft.cards[0].position = { x: index + 1, y: 0 }
      }, [])
    }
    expect(useGraph.getState().undoStack).toHaveLength(UNDO_RING_LIMIT)
  })
})

describe('undo/redo over funnel patch entries', () => {
  beforeEach(resetStore)

  it('undo replays inverse patches scoped to the commit; redo replays forward patches', () => {
    useGraph.setState({
      cards: [card('note-1', 'note', { position: { x: 0, y: 0 } })],
    })

    useGraph.getState().commit('Move', (draft) => {
      draft.cards[0].position = { x: 100, y: 50 }
    }, [])
    // A later, non-undoable edit must survive the undo (granular patches).
    useGraph.getState().setCardText('note-1', 'kept text')

    useGraph.getState().undo()
    const afterUndo = useGraph.getState().cards[0]
    expect(afterUndo.position).toEqual({ x: 0, y: 0 })
    expect(afterUndo.blocks[0].text).toBe('kept text')

    useGraph.getState().redo()
    expect(useGraph.getState().cards[0].position).toEqual({ x: 100, y: 50 })

    const emission = latestBoardChange()
    expect(emission).toMatchObject({
      seq: 4,
      source: 'redo',
      change: {
        cards: { updated: ['note-1'] },
        cardAspects: ['position'],
      },
    })
  })

  it('state-only writes emit progress BoardChange records without undo or log entries', () => {
    useGraph.setState({ cards: [card('note-1', 'note')] })

    useGraph.getState().setCardText('note-1', 'draft text')

    expect(useGraph.getState().undoStack).toHaveLength(0)
    expect(useGraph.getState().intentLog).toHaveLength(0)
    const emission = latestBoardChange()
    expect(emission).toMatchObject({
      seq: 1,
      source: 'progress',
      change: {
        cards: { updated: ['note-1'] },
        cardAspects: ['content'],
      },
    })
  })

  it('order-only card changes distinguish semantic order from visual layer', () => {
    useGraph.setState({
      cards: [
        card('group-1', 'group'),
        card('note-a', 'note', { groupId: 'group-1' }),
        card('note-b', 'note', { groupId: 'group-1' }),
      ],
    })

    useGraph.getState().reorderGroupMembers('group-1', ['note-b', 'note-a'])

    const emission = latestBoardChange()
    expect(emission).toMatchObject({
      source: 'progress',
      change: {
        cards: { updated: ['note-b', 'note-a'] },
        cardAspects: ['layer', 'order'],
      },
    })
  })

  it('undo/redo of interaction-summary entries emit undo/redo records, not progress', () => {
    useGraph.setState({ cards: [card('note-1', 'note')] })
    const beforeCards = useGraph.getState().cards
    useGraph.getState().moveCard('note-1', { x: 80, y: 20 }, { recordHistory: false })
    useGraph.getState().recordCardStructuralChange('moveCard', beforeCards, useGraph.getState().cards)
    const log = useGraph.getState().intentLog
    const summaryCommitId = log[log.length - 1].commitId

    useGraph.getState().undo()
    expect(useGraph.getState().cards[0].position).toEqual({ x: 0, y: 0 })
    expect(latestBoardChange()).toMatchObject({
      source: 'undo',
      targetCommitId: summaryCommitId,
      label: 'moveCard',
      change: {
        cards: { updated: ['note-1'] },
        cardAspects: ['position'],
      },
    })

    useGraph.getState().redo()
    expect(useGraph.getState().cards[0].position).toEqual({ x: 80, y: 20 })
    expect(latestBoardChange()).toMatchObject({
      source: 'redo',
      targetCommitId: summaryCommitId,
      change: {
        cards: { updated: ['note-1'] },
        cardAspects: ['position'],
      },
    })
  })

  it('undo/redo never remove, mutate, or add Intent Log entries', () => {
    useGraph.setState({ cards: [card('note-1', 'note')] })
    useGraph.getState().commit('Move', (draft) => {
      draft.cards[0].position = { x: 5, y: 5 }
    }, [{ type: 'card.content.edited', cardId: 'note-1', data: { field: 'body' } }])

    const baseline = structuredClone(useGraph.getState().intentLog)
    expect(baseline).toHaveLength(1)

    useGraph.getState().undo()
    expect(useGraph.getState().intentLog).toStrictEqual(baseline)
    useGraph.getState().redo()
    expect(useGraph.getState().intentLog).toStrictEqual(baseline)
  })

  it('funnel patch entries interleave on one stack', () => {
    const noteId = useGraph.getState().addCard('note', { x: 0, y: 0 })
    const askId = useGraph.getState().addCard('askAi', { x: 300, y: 0 })
    useGraph.getState().addConnection(noteId, askId) // funnel patch entry

    expect(useGraph.getState().connections).toHaveLength(1)
    expect(useGraph.getState().undoStack).toHaveLength(3)

    useGraph.getState().undo() // pops the funnel entry
    expect(useGraph.getState().connections).toHaveLength(0)
    expect(useGraph.getState().cards).toHaveLength(2)

    useGraph.getState().undo()
    expect(useGraph.getState().cards).toHaveLength(1)

    useGraph.getState().redo()
    expect(useGraph.getState().cards).toHaveLength(2)
    useGraph.getState().redo()
    expect(useGraph.getState().connections).toHaveLength(1)
  })
})

describe('migrated call sites keep their append semantics (#188 vertical slice)', () => {
  beforeEach(resetStore)

  it('unconditional variant — addConnection always emits connection.created with stamps and an undo entry', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('ask-1', 'askAi')] })

    useGraph.getState().addConnection('note-1', 'ask-1')

    const log = useGraph.getState().intentLog
    expect(log.map((event) => event.type)).toEqual(['connection.created'])
    expect(log[0].commitId).toMatch(/^commit_/)
    expect(log[0].seq).toBe(1)
    expect(latestBoardChange()).toMatchObject({
      source: 'commit',
      change: {
        connections: { added: [expect.stringMatching(/^conn_/)] },
      },
    })
    const entry = useGraph.getState().undoStack[0]
    expect(entry && isPatchUndoEntry(entry) && entry.commitId).toBe(log[0].commitId)

    useGraph.getState().undo()
    expect(useGraph.getState().connections).toHaveLength(0)
    expect(useGraph.getState().intentLog).toHaveLength(1) // append-only

    useGraph.getState().redo()
    expect(useGraph.getState().connections).toHaveLength(1)
  })

  it('event-guarded variant — addCardToGroup emits group.members.changed only when membership changes', () => {
    useGraph.setState({
      cards: [
        card('group-1', 'group', {
          title: 'Group',
          size: { width: 420, height: 320 },
          compressionPrompt: 'Compress this.',
        }),
        card('note-1', 'note', { position: { x: 900, y: 900 } }),
      ],
    })

    useGraph.getState().addCardToGroup('note-1', 'group-1')

    const log = useGraph.getState().intentLog
    expect(log.map((event) => event.type)).toEqual(['group.members.changed'])
    const event = log[0]
    expect(event.type).toBe('group.members.changed')
    if (event.type === 'group.members.changed') {
      expect(event.data.memberChanges['note-1']).toEqual({ to: 'group-1' })
    }
    expect(useGraph.getState().cards.find((c) => c.id === 'note-1')?.groupId).toBe('group-1')
    expect(useGraph.getState().undoStack).toHaveLength(1)
    expect(event.commitId).toMatch(/^commit_/)

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find((c) => c.id === 'note-1')?.groupId).toBeUndefined()
    expect(useGraph.getState().intentLog).toHaveLength(1) // append-only
  })

  it('length-guarded variant — a real resize emits card.resized from the shared diff', () => {
    useGraph.setState({
      cards: [card('note-1', 'note', { size: { width: 100, height: 50 } })],
    })

    useGraph.getState().setCardSize('note-1', { width: 220, height: 90 })

    const log = useGraph.getState().intentLog
    expect(log.map((event) => event.type)).toEqual(['card.resized'])
    const event = log[0]
    if (event.type === 'card.resized') {
      expect(event.data).toMatchObject({
        from: { width: 100, height: 50 },
        to: { width: 220, height: 90 },
      })
    }
    expect(useGraph.getState().undoStack).toHaveLength(1)

    useGraph.getState().undo()
    expect(useGraph.getState().cards[0].size).toEqual({ width: 100, height: 50 })
    useGraph.getState().redo()
    expect(useGraph.getState().cards[0].size).toEqual({ width: 220, height: 90 })
  })

  it('length-guarded variant — a no-op resize writes nothing anywhere (empty commit)', () => {
    useGraph.setState({
      cards: [card('note-1', 'note', { size: { width: 100, height: 50 } })],
    })
    const cardsBefore = useGraph.getState().cards

    useGraph.getState().setCardSize('note-1', { width: 100, height: 50 })

    expect(useGraph.getState().intentLog).toHaveLength(0)
    expect(useGraph.getState().undoStack).toHaveLength(0)
    expect(useGraph.getState().cards).toBe(cardsBefore)
  })

  it('length-guarded variant — recordHistory:false stays a transient interaction-local update', () => {
    useGraph.setState({
      cards: [card('note-1', 'note', { size: { width: 100, height: 50 } })],
    })

    useGraph.getState().setCardSize('note-1', { width: 300, height: 200 }, { recordHistory: false })

    expect(useGraph.getState().cards[0].size).toEqual({ width: 300, height: 200 })
    expect(useGraph.getState().intentLog).toHaveLength(0)
    expect(useGraph.getState().undoStack).toHaveLength(0)
  })
})

describe('the undo ring is session-scoped', () => {
  beforeEach(resetStore)

  it('clears on board switch', async () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      currentIdeaId: 'idea-one',
      hydrated: true,
    })
    useGraph.getState().addConnection('note-1', 'ask-1')
    useGraph.getState().undo()
    expect(useGraph.getState().redoStack).toHaveLength(1)
    expect(useGraph.getState().boardChangeSeq).toBeGreaterThan(0)

    saveMocks.loadIdea.mockResolvedValue({
      idea: {
        id: 'idea-two',
        name: 'Two',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: '2026-01-01T00:00:00.000Z',
      },
      board: {
        version: 1 as const,
        cards: [],
        connections: [],
        outputs: [],
        runs: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })
    await useGraph.getState().loadIdea('idea-two')

    expect(useGraph.getState().currentIdeaId).toBe('idea-two')
    expect(useGraph.getState().undoStack).toHaveLength(0)
    expect(useGraph.getState().redoStack).toHaveLength(0)
    expect(useGraph.getState().lastBoardChange).toBeNull()
    expect(useGraph.getState().boardChangeSeq).toBe(0)
  })
})

// A4 (#324): the canvas graph-metric cache compares `Card.blocks` by
// REFERENCE to decide whether a card's summary/weight inputs changed. That is
// only sound because every live board write goes through this Immer-backed
// single-writer funnel: structural edits preserve untouched nested
// references, while any text change replaces the blocks array. This suite
// pins that architectural dependency so it is a test, not folklore.
describe('Immer reference behavior at the commit funnel (A4 metric-cache dependency)', () => {
  beforeEach(resetStore)

  it('an unrelated structural mutation replaces the card object but preserves its blocks identity', () => {
    useGraph.setState({
      cards: [card('note-1', 'note', { blocks: [{ id: 'b-1', text: 'kept text' }] }), card('note-2', 'note')],
    })
    const before = useGraph.getState().cards.find((c) => c.id === 'note-1')!

    useGraph.getState().moveCard('note-1', { x: 120, y: 80 })

    const after = useGraph.getState().cards.find((c) => c.id === 'note-1')!
    // The card OBJECT is legitimately replaced — which is exactly why the
    // metric cache must never compare whole cards...
    expect(after).not.toBe(before)
    expect(after.position).toEqual({ x: 120, y: 80 })
    // ...but its untouched blocks keep their identity.
    expect(after.blocks).toBe(before.blocks)
  })

  it('a nested block-text mutation through the funnel replaces the blocks identity', () => {
    useGraph.setState({ cards: [card('note-1', 'note', { blocks: [{ id: 'b-1', text: 'before' }] })] })
    const before = useGraph.getState().cards[0]

    useGraph.getState().commit(
      'Edit text',
      (draft) => {
        draft.cards[0].blocks[0].text = 'after'
      },
      [],
    )

    const after = useGraph.getState().cards[0]
    expect(after.blocks).not.toBe(before.blocks)
    expect(after.blocks[0].text).toBe('after')
  })

  it('setCardText replaces the blocks identity', () => {
    useGraph.setState({ cards: [card('note-1', 'note', { blocks: [{ id: 'b-1', text: 'before' }] })] })
    const before = useGraph.getState().cards[0]

    useGraph.getState().setCardText('note-1', 'replaced text')

    const after = useGraph.getState().cards[0]
    expect(after.blocks).not.toBe(before.blocks)
    expect(after.blocks[0].text).toBe('replaced text')
  })
})
