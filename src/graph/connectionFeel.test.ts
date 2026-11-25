// The one-shot connection beats for Phase 3 of the connections rework (#259):
// creating a connection begins a connect pulse, flipping polarity begins a
// crossfade, and the store retires both after their animation window — even
// when no edge component ever mounts (canvas-painted connections). Beats are
// transient: they never appear in undo, the intent log, or the save file.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    connectionPulse: null,
    connectionFlip: null,
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

beforeEach(() => {
  vi.useFakeTimers()
  resetStore()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('connect pulse', () => {
  it('creating a connection begins a pulse on the created connection', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('ask-1', 'askAi')] })
    useGraph.getState().addConnection('note-1', 'ask-1')

    const created = useGraph.getState().connections[0]
    expect(useGraph.getState().connectionPulse?.connectionId).toBe(created.id)
  })

  it('pulses the created connection even when auto-orient flips the drag direction', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('ask-1', 'askAi')] })
    // Drawn ask→note; stored note→ask.
    useGraph.getState().addConnection('ask-1', 'note-1')

    const created = useGraph.getState().connections[0]
    expect(created.from.cardId).toBe('note-1')
    expect(useGraph.getState().connectionPulse?.connectionId).toBe(created.id)
  })

  it('pulses the routed leg when a question wires through its Result card', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi'), card('ask-2', 'askAi')] })
    useGraph.getState().addConnection('ask-1', 'ask-2')

    const routed = useGraph
      .getState()
      .connections.find((c) => c.to.cardId === 'ask-2')
    expect(routed).toBeDefined()
    expect(useGraph.getState().connectionPulse?.connectionId).toBe(routed!.id)
  })

  it('does not pulse when the connection already exists (no-op connect)', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1')],
    })
    useGraph.getState().addConnection('note-1', 'ask-1')

    expect(useGraph.getState().connectionPulse).toBeNull()
  })

  it('retires the pulse by itself after the animation window', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('ask-1', 'askAi')] })
    useGraph.getState().addConnection('note-1', 'ask-1')
    expect(useGraph.getState().connectionPulse).not.toBeNull()

    vi.advanceTimersByTime(1200)
    expect(useGraph.getState().connectionPulse).toBeNull()
  })

  it('an edge retiring its own beat wins over the late backstop timer', () => {
    useGraph.setState({ cards: [card('note-1', 'note'), card('ask-1', 'askAi')] })
    useGraph.getState().addConnection('note-1', 'ask-1')
    const first = useGraph.getState().connectionPulse!
    useGraph.getState().clearConnectionPulse(first.seq)
    expect(useGraph.getState().connectionPulse).toBeNull()

    // A second connect while the first backstop is still pending: the stale
    // timer must not clobber the newer beat.
    useGraph.setState({ cards: [...useGraph.getState().cards, card('note-2', 'note')] })
    useGraph.getState().addConnection('note-2', 'ask-1')
    const second = useGraph.getState().connectionPulse!
    expect(second.seq).not.toBe(first.seq)
    useGraph.getState().clearConnectionPulse(first.seq)
    expect(useGraph.getState().connectionPulse).toEqual(second)
  })
})

describe('polarity flip crossfade', () => {
  it('flipping polarity begins a crossfade carrying the outgoing polarity', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1')],
    })
    useGraph.getState().setConnectionPolarity('conn-1', 'pushesAgainst')

    expect(useGraph.getState().connectionFlip).toMatchObject({
      connectionId: 'conn-1',
      fromPolarity: 'helps',
    })
  })

  it('setting the same polarity begins no crossfade', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1')],
    })
    useGraph.getState().setConnectionPolarity('conn-1', 'helps')

    expect(useGraph.getState().connectionFlip).toBeNull()
  })

  it('retires the crossfade by itself after the animation window', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1')],
    })
    useGraph.getState().setConnectionPolarity('conn-1', 'pushesAgainst')
    expect(useGraph.getState().connectionFlip).not.toBeNull()

    vi.advanceTimersByTime(400)
    expect(useGraph.getState().connectionFlip).toBeNull()
  })

  it('the beats stay out of undo and the intent log', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection('conn-1', 'note-1', 'ask-1')],
    })
    const undoDepth = useGraph.getState().undoStack.length
    const logDepth = useGraph.getState().intentLog.length
    useGraph.getState().setConnectionPolarity('conn-1', 'pushesAgainst')

    // One undo entry and one log event for the polarity change itself; the
    // crossfade beat adds nothing, and retiring it adds nothing either.
    expect(useGraph.getState().undoStack.length).toBe(undoDepth + 1)
    expect(useGraph.getState().intentLog.length).toBe(logDepth + 1)
    vi.advanceTimersByTime(400)
    expect(useGraph.getState().undoStack.length).toBe(undoDepth + 1)
    expect(useGraph.getState().intentLog.length).toBe(logDepth + 1)
  })
})
