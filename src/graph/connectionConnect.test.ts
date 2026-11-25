// Store connect behavior for the connections rework, Phase 1 (#260):
// auto-orient toward the consuming endpoint, the optional reason field, and
// undo/intent-log coverage for every connection mutation. Tests assert what
// the store persists — never traversal internals.

import { beforeEach, describe, expect, it } from 'vitest'
import { makeSavedBoard } from './save'
import { useGraph } from './store'
import type { Card, Connection } from './types'

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

function card(id: string, kind: Card['kind'], extra: Partial<Card> = {}): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text: '' }],
    position: { x: 0, y: 0 },
    ...extra,
  }
}

function connection(id: string, from: string, to: string, extra: Partial<Connection> = {}): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
    ...extra,
  }
}

function storedConnections() {
  return useGraph.getState().connections
}

describe('auto-orient on connect', () => {
  beforeEach(resetStore)

  it('stores note→ask when drawn note→ask (already oriented)', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('ask-1', 'askAi')] })
    useGraph.getState().addConnection('note-1', 'ask-1')
    expect(storedConnections()).toHaveLength(1)
    expect(storedConnections()[0]).toMatchObject({
      from: { cardId: 'note-1' },
      to: { cardId: 'ask-1' },
      role: 'feeds',
    })
  })

  it('stores note→ask when drawn ask→note (flipped toward the consumer)', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('ask-1', 'askAi')] })
    useGraph.getState().addConnection('ask-1', 'note-1')
    expect(storedConnections()).toHaveLength(1)
    expect(storedConnections()[0]).toMatchObject({
      from: { cardId: 'note-1' },
      to: { cardId: 'ask-1' },
      role: 'feeds',
    })
  })

  it('flipping toward the consumer applies the stored source kind role: ask→mod becomes mod→ask modifies', () => {
    useGraph.setState({ cards: [card('mod-1', 'mod'), card('ask-1', 'askAi')] })
    useGraph.getState().addConnection('ask-1', 'mod-1')
    expect(storedConnections()[0]).toMatchObject({
      from: { cardId: 'mod-1' },
      to: { cardId: 'ask-1' },
      role: 'modifies',
    })
  })

  it('keeps the drawn direction between two non-consumers (it decides second-hop flow)', () => {
    useGraph.setState({ cards: [card('note-a', 'note'), card('note-b', 'note')] })
    useGraph.getState().addConnection('note-a', 'note-b')
    expect(storedConnections()[0]).toMatchObject({ from: { cardId: 'note-a' }, to: { cardId: 'note-b' } })

    resetStore()
    useGraph.setState({ cards: [card('note-a', 'note'), card('note-b', 'note')] })
    useGraph.getState().addConnection('note-b', 'note-a')
    expect(storedConnections()[0]).toMatchObject({ from: { cardId: 'note-b' }, to: { cardId: 'note-a' } })
  })

  it('keeps opposite non-consumer directions as distinct connections in one board', () => {
    useGraph.setState({ cards: [card('note-a', 'note'), card('note-b', 'note')] })
    useGraph.getState().addConnection('note-a', 'note-b')
    useGraph.getState().addConnection('note-b', 'note-a')

    expect(
      storedConnections().map((connection) => [connection.from.cardId, connection.to.cardId]),
    ).toEqual([
      ['note-a', 'note-b'],
      ['note-b', 'note-a'],
    ])
  })

  it('orients toward a conversation from either drawn direction', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('conv-1', 'conversation')] })
    useGraph.getState().addConnection('conv-1', 'note-1')
    expect(storedConnections()[0]).toMatchObject({ from: { cardId: 'note-1' }, to: { cardId: 'conv-1' } })
  })

  it('question-to-question wires still route through the Result card in the drawn direction', () => {
    useGraph.setState({ cards: [card('ask-a', 'askAi'), card('ask-b', 'askAi')] })
    useGraph.getState().addConnection('ask-a', 'ask-b')
    const conns = storedConnections()
    const result = useGraph.getState().cards.find((c) => c.kind === 'result')
    expect(result).toBeTruthy()
    expect(conns.some((c) => c.from.cardId === 'ask-a' && c.to.cardId === result!.id)).toBe(true)
    expect(conns.some((c) => c.from.cardId === result!.id && c.to.cardId === 'ask-b')).toBe(true)
  })

  it('dedups against the STORED direction: drawing the same pair the other way changes nothing', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('ask-1', 'askAi')] })
    useGraph.getState().addConnection('note-1', 'ask-1')
    const logAfterFirst = useGraph.getState().intentLog.length
    const undoAfterFirst = useGraph.getState().undoStack.length

    useGraph.getState().addConnection('ask-1', 'note-1')
    expect(storedConnections()).toHaveLength(1)
    expect(useGraph.getState().intentLog).toHaveLength(logAfterFirst)
    expect(useGraph.getState().undoStack).toHaveLength(undoAfterFirst)
  })

  it('the intent log records the stored direction, not the drawn one', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('ask-1', 'askAi')], intentLog: [] })
    useGraph.getState().addConnection('ask-1', 'note-1')
    const event = useGraph.getState().intentLog[useGraph.getState().intentLog.length - 1]
    expect(event?.type).toBe('connection.created')
    if (event?.type !== 'connection.created') return
    expect(event.data.connection.from.cardId).toBe('note-1')
    expect(event.data.connection.to.cardId).toBe('ask-1')
  })

  it('undo removes an auto-oriented connection; redo restores the stored direction', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('ask-1', 'askAi')] })
    useGraph.getState().addConnection('ask-1', 'note-1')
    expect(storedConnections()).toHaveLength(1)

    useGraph.getState().undo()
    expect(storedConnections()).toHaveLength(0)

    useGraph.getState().redo()
    expect(storedConnections()).toHaveLength(1)
    expect(storedConnections()[0]).toMatchObject({ from: { cardId: 'note-1' }, to: { cardId: 'ask-1' } })
  })
})

describe('connection reason', () => {
  beforeEach(resetStore)

  it('is absent on a new connection', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('ask-1', 'askAi')] })
    useGraph.getState().addConnection('note-1', 'ask-1')
    expect(storedConnections()[0]?.reason).toBeUndefined()
  })

  it('persists a trimmed reason and clears it when emptied', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1', { polarity: 'pushesAgainst' })],
    })

    useGraph.getState().setConnectionReason('conn-1', '  tried this in v2, too pricey  ')
    expect(storedConnections()[0]?.reason).toBe('tried this in v2, too pricey')

    useGraph.getState().setConnectionReason('conn-1', '   ')
    expect(storedConnections()[0]?.reason).toBeUndefined()
  })

  it('setting the same reason again mints no undo entry', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1')],
    })
    useGraph.getState().setConnectionReason('conn-1', 'dead end')
    const undoCount = useGraph.getState().undoStack.length
    useGraph.getState().setConnectionReason('conn-1', 'dead end')
    expect(useGraph.getState().undoStack).toHaveLength(undoCount)
  })

  it('undoes and redoes a reason change', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1')],
    })

    useGraph.getState().setConnectionReason('conn-1', 'explored already')
    useGraph.getState().undo()
    expect(storedConnections()[0]?.reason).toBeUndefined()
    useGraph.getState().redo()
    expect(storedConnections()[0]?.reason).toBe('explored already')
  })

  it('logs the reason change with before and after', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1')],
      intentLog: [],
    })
    useGraph.getState().setConnectionReason('conn-1', 'why it died')
    const event = useGraph.getState().intentLog[useGraph.getState().intentLog.length - 1]
    expect(event?.type).toBe('connection.changed')
    if (event?.type !== 'connection.changed') return
    expect(event.data.before.reason).toBeUndefined()
    expect(event.data.after.reason).toBe('why it died')
  })
})

describe('undo/redo covers every connection mutation', () => {
  beforeEach(() => {
    resetStore()
    useGraph.setState({
      cards: [card('note-1', 'note'), card('group-1', 'group'), card('ask-1', 'askAi')],
      connections: [
        connection('conn-1', 'note-1', 'ask-1'),
        connection('conn-2', 'group-1', 'ask-1', { meta: { groupMode: 'full' } }),
      ],
    })
  })

  it('restyle: undoes and redoes a strength change', () => {
    useGraph.getState().setConnectionStrength('conn-1', 'weak')
    expect(storedConnections().find((c) => c.id === 'conn-1')?.strength).toBe('weak')

    useGraph.getState().undo()
    expect(storedConnections().find((c) => c.id === 'conn-1')?.strength).toBe('strong')

    useGraph.getState().redo()
    expect(storedConnections().find((c) => c.id === 'conn-1')?.strength).toBe('weak')
  })

  it('flip: undoes and redoes a polarity change', () => {
    useGraph.getState().setConnectionPolarity('conn-1', 'pushesAgainst')
    expect(storedConnections().find((c) => c.id === 'conn-1')?.polarity).toBe('pushesAgainst')

    useGraph.getState().undo()
    expect(storedConnections().find((c) => c.id === 'conn-1')?.polarity).toBe('helps')

    useGraph.getState().redo()
    expect(storedConnections().find((c) => c.id === 'conn-1')?.polarity).toBe('pushesAgainst')
  })

  it('group mode: undoes and redoes an Everything/Compress change', () => {
    useGraph.getState().setConnectionGroupMode('conn-2', 'compress')
    expect(storedConnections().find((c) => c.id === 'conn-2')?.meta?.groupMode).toBe('compress')

    useGraph.getState().undo()
    expect(storedConnections().find((c) => c.id === 'conn-2')?.meta?.groupMode).toBe('full')

    useGraph.getState().redo()
    expect(storedConnections().find((c) => c.id === 'conn-2')?.meta?.groupMode).toBe('compress')
  })

  it('reorder: undoes and redoes a context reorder', () => {
    const orderOf = (id: string) => storedConnections().find((c) => c.id === id)?.meta?.contextOrder

    useGraph.getState().reorderContextItems(['conn-2', 'conn-1'])
    expect(orderOf('conn-2')).toBe(0)
    expect(orderOf('conn-1')).toBe(1)

    useGraph.getState().undo()
    expect(orderOf('conn-1')).toBeUndefined()
    expect(orderOf('conn-2')).toBeUndefined()

    useGraph.getState().redo()
    expect(orderOf('conn-2')).toBe(0)
    expect(orderOf('conn-1')).toBe(1)
  })

  it('delete: undo restores the connection with every field, redo removes it again', () => {
    useGraph.getState().setConnectionReason('conn-1', 'dead end')
    const before = storedConnections().find((c) => c.id === 'conn-1')

    useGraph.getState().deleteConnection('conn-1')
    expect(storedConnections().some((c) => c.id === 'conn-1')).toBe(false)

    useGraph.getState().undo()
    expect(storedConnections().find((c) => c.id === 'conn-1')).toEqual(before)

    useGraph.getState().redo()
    expect(storedConnections().some((c) => c.id === 'conn-1')).toBe(false)
  })
})

describe('save compatibility for connections', () => {
  it('a pre-rework connection loads unchanged (no reason, same meaning fields)', () => {
    const board = makeSavedBoard({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1', { strength: 'weak', polarity: 'pushesAgainst' })],
      updatedAt: '2025-01-01T00:00:00.000Z',
    })
    expect(board.connections[0]).toEqual({
      id: 'conn-1',
      from: { cardId: 'note-1' },
      to: { cardId: 'ask-1' },
      strength: 'weak',
      polarity: 'pushesAgainst',
      role: 'feeds',
    })
    expect(board.connections[0]).not.toHaveProperty('reason')
  })

  it('a reason round-trips through save shape and JSON', () => {
    const board = makeSavedBoard({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1', { reason: 'went nowhere' })],
      updatedAt: '2025-01-01T00:00:00.000Z',
    })
    const reloaded = makeSavedBoard(JSON.parse(JSON.stringify(board)))
    expect(reloaded.connections[0]?.reason).toBe('went nowhere')
  })
})
