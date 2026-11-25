import { beforeEach, describe, expect, it } from 'vitest'
import { UNDO_RING_LIMIT, isPatchUndoEntry } from './commitFunnel'
import { useGraph } from './store'
import type { Card, Connection, Output } from './types'

function resetStore() {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
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

function connection(id: string, from: string, to: string): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  }
}

describe('structural undo/redo in the graph store', () => {
  beforeEach(resetStore)

  it('undoes and redoes card creation', () => {
    const id = useGraph.getState().addCard('note', { x: 12, y: 34 })

    expect(useGraph.getState().cards.some((candidate) => candidate.id === id)).toBe(true)
    expect(useGraph.getState().undoStack).toHaveLength(1)
    const entry = useGraph.getState().undoStack[0]
    expect(isPatchUndoEntry(entry)).toBe(true)
    if (!isPatchUndoEntry(entry)) return
    expect(entry.label).toBe('Create card')
    expect(entry.id).toMatch(/^hist_/)
    expect(entry.createdAt).toBeTruthy()
    expect(entry.commitId).toMatch(/^commit_/)

    useGraph.getState().undo()
    expect(useGraph.getState().cards.some((candidate) => candidate.id === id)).toBe(false)
    expect(useGraph.getState().redoStack).toHaveLength(1)

    useGraph.getState().redo()
    expect(useGraph.getState().cards.find((candidate) => candidate.id === id)?.position).toEqual({ x: 12, y: 34 })
  })

  it(`bounds the undo ring at ${UNDO_RING_LIMIT} entries`, () => {
    for (let index = 0; index < UNDO_RING_LIMIT + 5; index += 1) {
      useGraph.getState().addCard('note', { x: index * 10, y: 0 })
    }

    expect(useGraph.getState().undoStack).toHaveLength(UNDO_RING_LIMIT)
  })

  it('undoes a move without reverting later text edits', () => {
    const id = useGraph.getState().addCard('note', { x: 0, y: 0 })
    useGraph.getState().moveCard(id, { x: 100, y: 40 })
    useGraph.getState().setCardText(id, 'Edited after the move')

    useGraph.getState().undo()

    const restored = useGraph.getState().cards.find((candidate) => candidate.id === id)!
    expect(restored.position).toEqual({ x: 0, y: 0 })
    expect(restored.blocks[0]?.text).toBe('Edited after the move')
  })

  it('restores a deleted card with its connections and output versions', () => {
    const result = card('result-1', 'result', {
      title: 'Answer',
      blocks: [{ id: 'result-block', text: 'Rendered card text' }],
      position: { x: 80, y: 120 },
    })
    const output: Output = {
      id: 'out-1',
      resultCardId: result.id,
      chosenVersionId: 'ver-1',
      versions: [
        {
          id: 'ver-1',
          number: 1,
          text: 'Generated answer',
          createdAt: '2026-06-20T00:00:00.000Z',
          fromRunId: 'run-1',
        },
      ],
    }
    useGraph.setState({
      cards: [card('ask-1', 'askAi'), result],
      connections: [connection('conn-1', 'ask-1', result.id)],
      outputs: [output],
    })

    useGraph.getState().deleteCard(result.id)
    expect(useGraph.getState().cards.some((candidate) => candidate.id === result.id)).toBe(false)

    useGraph.getState().undo()

    expect(useGraph.getState().cards.find((candidate) => candidate.id === result.id)?.title).toBe('Answer')
    expect(useGraph.getState().connections.find((candidate) => candidate.id === 'conn-1')).toBeTruthy()
    expect(useGraph.getState().outputs.find((candidate) => candidate.id === 'out-1')?.versions[0]?.text).toBe(
      'Generated answer',
    )
  })

  it('undoes and redoes group creation as a member grouping change', () => {
    useGraph.setState({
      cards: [
        card('note-a', 'note', { position: { x: 20, y: 20 } }),
        card('note-b', 'note', { position: { x: 240, y: 20 } }),
      ],
    })

    const groupId = useGraph.getState().createGroupFromSelection(['note-a', 'note-b'])!
    expect(useGraph.getState().cards.find((candidate) => candidate.id === 'note-a')?.groupId).toBe(groupId)

    useGraph.getState().undo()
    expect(useGraph.getState().cards.some((candidate) => candidate.id === groupId)).toBe(false)
    expect(useGraph.getState().cards.find((candidate) => candidate.id === 'note-a')?.groupId).toBeUndefined()

    useGraph.getState().redo()
    expect(useGraph.getState().cards.some((candidate) => candidate.id === groupId)).toBe(true)
    expect(useGraph.getState().cards.find((candidate) => candidate.id === 'note-b')?.groupId).toBe(groupId)
  })

  it('restores a deleted group and its member assignments', () => {
    useGraph.setState({
      cards: [
        card('group-1', 'group', {
          title: 'Group',
          size: { width: 420, height: 320 },
          compressionPrompt: 'Compress this.',
        }),
        card('note-a', 'note', { groupId: 'group-1' }),
        card('note-b', 'note', { groupId: 'group-1' }),
        card('ask-1', 'askAi'),
      ],
      connections: [connection('conn-1', 'group-1', 'ask-1')],
    })

    useGraph.getState().deleteCard('group-1')
    expect(useGraph.getState().cards.find((candidate) => candidate.id === 'note-a')?.groupId).toBeUndefined()

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find((candidate) => candidate.id === 'group-1')?.kind).toBe('group')
    expect(useGraph.getState().cards.find((candidate) => candidate.id === 'note-a')?.groupId).toBe('group-1')
    expect(useGraph.getState().connections.find((candidate) => candidate.id === 'conn-1')).toBeTruthy()

    useGraph.getState().redo()
    expect(useGraph.getState().cards.some((candidate) => candidate.id === 'group-1')).toBe(false)
    expect(useGraph.getState().cards.find((candidate) => candidate.id === 'note-b')?.groupId).toBeUndefined()
  })

  it('undoes group member reorder without changing the member cards', () => {
    useGraph.setState({
      cards: [
        card('group-1', 'group', { title: 'Group', compressionPrompt: 'Compress this.' }),
        card('note-a', 'note', { groupId: 'group-1', blocks: [{ id: 'a-block', text: 'A' }] }),
        card('note-b', 'note', { groupId: 'group-1', blocks: [{ id: 'b-block', text: 'B' }] }),
        card('note-c', 'note', { groupId: 'group-1', blocks: [{ id: 'c-block', text: 'C' }] }),
      ],
    })

    useGraph.getState().reorderGroupMembers('group-1', ['note-c', 'note-a', 'note-b'])
    expect(useGraph.getState().cards.filter((candidate) => candidate.groupId === 'group-1').map((c) => c.id)).toEqual([
      'note-c',
      'note-a',
      'note-b',
    ])

    useGraph.getState().undo()
    expect(useGraph.getState().cards.filter((candidate) => candidate.groupId === 'group-1').map((c) => c.id)).toEqual([
      'note-a',
      'note-b',
      'note-c',
    ])
    expect(useGraph.getState().cards.find((candidate) => candidate.id === 'note-c')?.blocks[0]?.text).toBe('C')
  })

  it('undoes and redoes connection meaning changes', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1')],
    })

    useGraph.getState().setConnectionPolarity('conn-1', 'pushesAgainst')
    expect(useGraph.getState().connections[0]?.polarity).toBe('pushesAgainst')

    useGraph.getState().undo()
    expect(useGraph.getState().connections[0]?.polarity).toBe('helps')

    useGraph.getState().redo()
    expect(useGraph.getState().connections[0]?.polarity).toBe('pushesAgainst')
  })
})
