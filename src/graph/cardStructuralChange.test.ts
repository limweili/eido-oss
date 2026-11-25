import { beforeEach, describe, expect, it } from 'vitest'
import { useGraph } from './store'
import { cardUpdateAction } from './history'
import type { Card } from './types'

function resetStore() {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    intentLog: [],
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

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: '' }],
    position: { x: 0, y: 0 },
    ...extra,
  }
}

function record(label: 'moveCard' | 'resizeCard', before: Card[], after: Card[]) {
  useGraph.setState({ cards: after })
  useGraph.getState().recordCardStructuralChange(label, before, after)
}

describe('one card-diff rule shared by undo history and the Intent Log', () => {
  beforeEach(resetStore)

  it('adopts first rendered footprints in one silent durable graph change without overwriting explicit sizes', () => {
    useGraph.setState({
      cards: [
        card('auto'),
        card('authored', { size: { width: 500, height: 300 } }),
      ],
    })

    useGraph.getState().adoptRenderedCardSizes([
      { id: 'auto', size: { width: 260, height: 420 } },
      { id: 'authored', size: { width: 260, height: 180 } },
      { id: 'invalid', size: { width: Number.NaN, height: 100 } },
    ])

    expect(useGraph.getState().cards.map(({ id, size }) => ({ id, size }))).toEqual([
      { id: 'auto', size: { width: 260, height: 420 } },
      { id: 'authored', size: { width: 500, height: 300 } },
    ])
    expect(useGraph.getState().undoStack).toHaveLength(0)
    expect(useGraph.getState().intentLog).toHaveLength(0)
  })

  // Contract probe (#184): history.ts and store.ts used to diff the same
  // before/after cards with two different equality rules, so the undo stack
  // could record a change the Intent Log never saw.
  it('undo history and the Intent Log agree on whether a change happened (size change under a moveCard label)', () => {
    const before = [card('a', { size: { width: 100, height: 50 } })]
    const after = [card('a', { size: { width: 220, height: 90 } })]

    record('moveCard', before, after)

    const undoRecorded = useGraph.getState().undoStack.length > 0
    const logRecorded = useGraph.getState().intentLog.length > 0
    expect(undoRecorded).toBe(true)
    expect(logRecorded).toBe(undoRecorded)
  })

  it('undo history and the Intent Log agree on whether a change happened (position change under a resizeCard label)', () => {
    const before = [card('a', { position: { x: 0, y: 0 } })]
    const after = [card('a', { position: { x: 40, y: 8 } })]

    record('resizeCard', before, after)

    const undoRecorded = useGraph.getState().undoStack.length > 0
    const logRecorded = useGraph.getState().intentLog.length > 0
    expect(undoRecorded).toBe(true)
    expect(logRecorded).toBe(undoRecorded)
  })

  it('a no-op card update emits no Intent Log Event and no undo entry', () => {
    const before = [card('a', { position: { x: 5, y: 5 }, size: { width: 100, height: 50 }, groupId: 'g1' })]
    const after = [card('a', { position: { x: 5, y: 5 }, size: { width: 100, height: 50 }, groupId: 'g1' })]

    record('moveCard', before, after)

    expect(useGraph.getState().undoStack).toHaveLength(0)
    expect(useGraph.getState().intentLog).toHaveLength(0)
  })

  // Former history.ts consumer case: the undo patch carries full structural state.
  it('a move pushes one undo entry whose patch holds before/after structural state', () => {
    const before = [card('a', { position: { x: 0, y: 0 } })]
    const after = [card('a', { position: { x: 120, y: 60 } })]

    record('moveCard', before, after)

    expect(useGraph.getState().undoStack).toHaveLength(1)
    const entry = useGraph.getState().undoStack[0]
    expect(entry && 'action' in entry ? entry.action : undefined).toMatchObject({
      type: 'cardsUpdated',
      label: 'moveCard',
      patches: [
        {
          id: 'a',
          before: { position: { x: 0, y: 0 } },
          after: { position: { x: 120, y: 60 } },
        },
      ],
    })
    const event = useGraph.getState().intentLog[0]
    expect(entry && 'commitId' in entry ? entry.commitId : undefined).toBe(event?.commitId)
  })

  // Former store.ts consumer cases: the emitted events keep their shape.
  it('a move emits one card.moved event carrying every moved card', () => {
    const before = [card('a', { position: { x: 0, y: 0 } }), card('b', { position: { x: 10, y: 10 } })]
    const after = [card('a', { position: { x: 50, y: 0 } }), card('b', { position: { x: 10, y: 90 } })]

    record('moveCard', before, after)

    const events = useGraph.getState().intentLog
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'card.moved',
      cardId: 'a',
      data: {
        moves: [
          { cardId: 'a', from: { x: 0, y: 0 }, to: { x: 50, y: 0 } },
          { cardId: 'b', from: { x: 10, y: 10 }, to: { x: 10, y: 90 } },
        ],
      },
    })
    // Exact payload (excluding generated id/at):
    const { id: _id, at: _at, commitId: _commitId, actorId: _actorId, clientTxnId: _clientTxnId, seq: _seq, ...rest0 } = events[0]
    expect(rest0).toEqual({
      type: 'card.moved',
      cardId: 'a',
      data: {
        moves: [
          { cardId: 'a', from: { x: 0, y: 0 }, to: { x: 50, y: 0 } },
          { cardId: 'b', from: { x: 10, y: 10 }, to: { x: 10, y: 90 } },
        ],
      },
    })
  })

  it('a group membership change under a moveCard label emits a card.moved event with group ids', () => {
    const before = [card('a', { groupId: undefined })]
    const after = [card('a', { groupId: 'g1' })]

    record('moveCard', before, after)

    const events = useGraph.getState().intentLog
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'card.moved',
      cardId: 'a',
      data: { moves: [{ cardId: 'a', nextGroupId: 'g1' }] },
    })
    // Exact payload (excluding generated id/at):
    const { id: _id, at: _at, commitId: _commitId, actorId: _actorId, clientTxnId: _clientTxnId, seq: _seq, ...rest0 } = events[0]
    expect(rest0).toEqual({
      type: 'card.moved',
      cardId: 'a',
      data: {
        moves: [{ cardId: 'a', from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, nextGroupId: 'g1' }],
      },
    })
  })

  it('a resize emits one card.resized event per resized card with from/to sizes', () => {
    const before = [
      card('a', { size: { width: 100, height: 50 } }),
      card('b', { size: undefined }),
    ]
    const after = [
      card('a', { size: { width: 180, height: 70 } }),
      card('b', { size: { width: 60, height: 40 } }),
    ]

    record('resizeCard', before, after)

    const events = useGraph.getState().intentLog
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'card.resized',
      cardId: 'a',
      data: { from: { width: 100, height: 50 }, to: { width: 180, height: 70 } },
    })
    expect(events[1]).toMatchObject({
      type: 'card.resized',
      cardId: 'b',
      data: { to: { width: 60, height: 40 } },
    })
    // Exact payloads (excluding generated id/at):
    const { id: _id0, at: _at0, commitId: _commitId0, actorId: _actorId0, clientTxnId: _clientTxnId0, seq: _seq0, ...rest0 } = events[0]
    expect(rest0).toEqual({ type: 'card.resized', cardId: 'a', data: { from: { width: 100, height: 50 }, to: { width: 180, height: 70 } } })
    const { id: _id1, at: _at1, commitId: _commitId1, actorId: _actorId1, clientTxnId: _clientTxnId1, seq: _seq1, ...rest1 } = events[1]
    expect(rest1).toEqual({ type: 'card.resized', cardId: 'b', data: { to: { width: 60, height: 40 } } })
  })

  // Nit from PR #196 review: pin exact event ORDER — moved is emitted before resized.
  it('a batch that both moves and resizes emits card.moved first, then card.resized, regardless of label', () => {
    const before = [
      card('a', { position: { x: 0, y: 0 } }),
      card('b', { size: { width: 100, height: 50 } }),
    ]
    const after = [
      card('a', { position: { x: 30, y: 30 } }),
      card('b', { size: { width: 140, height: 90 } }),
    ]

    record('moveCard', before, after)

    const events = useGraph.getState().intentLog
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('card.moved')
    expect(events[1].type).toBe('card.resized')
    expect(useGraph.getState().undoStack).toHaveLength(1)
  })
})

describe('cardUpdateAction diff rule', () => {
  it('returns undefined when nothing structural changed', () => {
    const cards = [card('a', { position: { x: 1, y: 2 }, size: { width: 10, height: 20 }, groupId: 'g' })]
    expect(cardUpdateAction('moveCard', cards, cards.map((c) => ({ ...c })))).toBeUndefined()
  })

  it('patches position, size, and groupId changes with one rule', () => {
    const before = [
      card('moved', { position: { x: 0, y: 0 } }),
      card('resized', { size: { width: 10, height: 10 } }),
      card('regrouped', { groupId: undefined }),
      card('untouched', { position: { x: 9, y: 9 } }),
    ]
    const after = [
      card('moved', { position: { x: 5, y: 0 } }),
      card('resized', { size: { width: 20, height: 10 } }),
      card('regrouped', { groupId: 'g1' }),
      card('untouched', { position: { x: 9, y: 9 } }),
    ]

    const action = cardUpdateAction('moveCard', before, after)
    expect(action?.type).toBe('cardsUpdated')
    if (action?.type !== 'cardsUpdated') return
    expect(action.patches.map((patch) => patch.id)).toEqual(['moved', 'resized', 'regrouped'])
  })
})
