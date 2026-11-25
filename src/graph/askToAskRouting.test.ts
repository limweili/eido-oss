import { beforeEach, describe, expect, it } from 'vitest'
import { planChainRun } from '../brain/executionPlan'
import type { Card } from './types'
import { useGraph } from './store'

function card(id: string, kind: Card['kind'], position: Card['position'] = { x: 0, y: 0 }): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text: kind === 'note' ? id : '' }],
    position,
  }
}

function resetStore(cards: Card[]) {
  useGraph.setState({
    cards,
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
    keyPromptOpen: false,
    cardClipboard: null,
  })
}

describe('connecting a question to a question routes through its Result card', () => {
  beforeEach(() => {
    resetStore([card('ask-1', 'askAi', { x: 0, y: 0 }), card('ask-2', 'askAi', { x: 600, y: 0 })])
  })

  it('creates the upstream Result card and routes the connection through it', () => {
    useGraph.getState().addConnection('ask-1', 'ask-2')

    const state = useGraph.getState()
    const resultCard = state.cards.find((c) => c.kind === 'result')
    expect(resultCard).toBeTruthy()
    expect(
      state.connections.some((c) => c.from.cardId === 'ask-1' && c.to.cardId === resultCard!.id),
    ).toBe(true)
    expect(
      state.connections.some((c) => c.from.cardId === resultCard!.id && c.to.cardId === 'ask-2'),
    ).toBe(true)
    expect(
      state.connections.some((c) => c.from.cardId === 'ask-1' && c.to.cardId === 'ask-2'),
    ).toBe(false)
  })

  it('reuses the Result card the question already has', () => {
    useGraph.setState({
      cards: [...useGraph.getState().cards, card('result-1', 'result', { x: 0, y: 300 })],
      connections: [
        {
          id: 'conn-1',
          from: { cardId: 'ask-1' },
          to: { cardId: 'result-1' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
    })

    useGraph.getState().addConnection('ask-1', 'ask-2')

    const state = useGraph.getState()
    expect(state.cards.filter((c) => c.kind === 'result')).toHaveLength(1)
    expect(
      state.connections.some((c) => c.from.cardId === 'result-1' && c.to.cardId === 'ask-2'),
    ).toBe(true)
  })

  it('connecting the same two questions again changes nothing', () => {
    useGraph.getState().addConnection('ask-1', 'ask-2')
    const after = useGraph.getState()

    useGraph.getState().addConnection('ask-1', 'ask-2')

    const state = useGraph.getState()
    expect(state.cards).toHaveLength(after.cards.length)
    expect(state.connections).toHaveLength(after.connections.length)
  })

  it('one undo removes everything the gesture created', () => {
    useGraph.getState().addConnection('ask-1', 'ask-2')

    useGraph.getState().undo()

    const state = useGraph.getState()
    expect(state.cards.map((c) => c.id).sort()).toEqual(['ask-1', 'ask-2'])
    expect(state.connections).toHaveLength(0)
  })

  it('three questions wired directly become one chain that runs all of them in order', () => {
    resetStore([
      card('ask-1', 'askAi', { x: 0, y: 0 }),
      card('ask-2', 'askAi', { x: 600, y: 0 }),
      card('ask-3', 'askAi', { x: 1200, y: 0 }),
    ])

    useGraph.getState().addConnection('ask-1', 'ask-2')
    useGraph.getState().addConnection('ask-2', 'ask-3')

    const plan = planChainRun(useGraph.getState().snapshot(), 'ask-3')

    expect(plan.steps.map((step) => step.cardId)).toEqual(['ask-1', 'ask-2', 'ask-3'])
  })
})
