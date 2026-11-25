import { beforeEach, describe, expect, it } from 'vitest'
import type { Card, Connection } from './types'
import { useGraph } from './store'
import { runChain, type CompletionStream } from '../brain/runEngine'
import { dependentsOf, lineageOf, producingAskIdFor } from './lineage'

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
    settings: {
      apiKey: 'test-key',
      model: 'default/model',
      models: ['default/model'],
      reasoningEffort: 'medium',
    },
  })
}

function card(id: string, kind: Card['kind'], extra: Partial<Card> = {}): Card {
  return { id, kind, blocks: [{ id: `${id}-b`, text: '' }], position: { x: 0, y: 0 }, ...extra }
}

function feed(id: string, from: string, to: string): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  }
}

const okStream: CompletionStream = async (_instruction, opts) => {
  opts.onChunk('answer')
  return 'answer'
}

// note-a → ask-a → result-a → ask-b, run as a real chain so RunRecords carry
// real provenance for the lineage walk.
async function ranChainBoard() {
  useGraph.setState({
    cards: [
      card('note-a', 'note', { blocks: [{ id: 'na-b', text: 'A fact.' }] }),
      card('ask-a', 'askAi', { blocks: [{ id: 'a-b', text: 'Summarise the fact.' }] }),
      card('result-a', 'result'),
      card('ask-b', 'askAi', { blocks: [{ id: 'b-b', text: 'Expand the summary.' }] }),
    ],
    connections: [
      feed('c0', 'note-a', 'ask-a'),
      feed('c1', 'ask-a', 'result-a'),
      feed('c2', 'result-a', 'ask-b'),
    ],
  })
  const outcome = await runChain('ask-b', { stream: okStream })
  if (!outcome.ok || outcome.status !== 'done') throw new Error('chain should complete')
  const board = useGraph.getState().snapshot()
  const resultB = board.outputs.find(
    (output) => output.resultCardId !== 'result-a' && output.resultCardId !== 'group',
  )
  if (!resultB) throw new Error('expected a result card for ask-b')
  return { board, resultBId: resultB.resultCardId }
}

beforeEach(resetStore)

describe('lineageOf', () => {
  it('walks recorded provenance across generations of result→ask links', async () => {
    const { board, resultBId } = await ranChainBoard()

    const lineage = lineageOf(board, resultBId)

    expect(lineage.resultCardId).toBe(resultBId)
    expect(lineage.generations).toHaveLength(2)

    const [genZero, genOne] = lineage.generations
    expect(genZero.generation).toBe(0)
    expect(genZero.resultCardId).toBe(resultBId)
    expect(genZero.runId).toBeTruthy()
    expect(genZero.versionId).toBeTruthy()
    // Ask-b's run consumed result-a — that is what links the generations.
    expect(genZero.sourceCardIds).toContain('result-a')

    expect(genOne.generation).toBe(1)
    expect(genOne.resultCardId).toBe('result-a')
    expect(genOne.runId).toBeTruthy()
    // Result-a's producing run consumed the original note.
    expect(genOne.sourceCardIds).toContain('note-a')
  })

  it('is deterministic and terminates on hand-wired provenance loops', async () => {
    const { board, resultBId } = await ranChainBoard()
    // Hand-wire the downstream result back into the upstream ask: a loop.
    const looped = {
      ...board,
      connections: [...board.connections, feed('loop', resultBId, 'ask-a')],
    }

    const first = lineageOf(looped, resultBId)
    const second = lineageOf(looped, resultBId)

    expect(first).toEqual(second)
    // Every generation appears once — the visited guard breaks the loop.
    const ids = first.generations.map((generation) => generation.resultCardId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reports a result with no runs as a single empty generation', () => {
    useGraph.setState({ cards: [card('result-x', 'result')] })
    const lineage = lineageOf(useGraph.getState().snapshot(), 'result-x')
    expect(lineage.generations).toEqual([
      {
        resultCardId: 'result-x',
        versionId: undefined,
        runId: undefined,
        sourceCardIds: [],
        sourceConnectionIds: [],
        generation: 0,
      },
    ])
  })
})

describe('dependentsOf', () => {
  it('lists downstream asks and results by depth', async () => {
    const { board, resultBId } = await ranChainBoard()

    const dependents = dependentsOf(board, 'note-a')

    expect(dependents).toEqual([
      { cardId: 'ask-a', depth: 1 },
      { cardId: 'result-a', depth: 1 },
      { cardId: 'ask-b', depth: 2 },
      { cardId: resultBId, depth: 2 },
    ])
  })

  it('terminates on cyclic wiring and never repeats a card', async () => {
    const { board, resultBId } = await ranChainBoard()
    const looped = {
      ...board,
      connections: [...board.connections, feed('loop', resultBId, 'ask-a')],
    }

    const dependents = dependentsOf(looped, 'note-a')
    const ids = dependents.map((dependent) => dependent.cardId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(dependentsOf(looped, 'note-a')).toEqual(dependents)
  })

  it('returns nothing for a card no ask consumes', () => {
    useGraph.setState({ cards: [card('lonely', 'note')] })
    expect(dependentsOf(useGraph.getState().snapshot(), 'lonely')).toEqual([])
  })
})

describe('producingAskIdFor', () => {
  it('finds the ask behind a result', async () => {
    const { board, resultBId } = await ranChainBoard()
    expect(producingAskIdFor(board, 'result-a')).toBe('ask-a')
    expect(producingAskIdFor(board, resultBId)).toBe('ask-b')
    expect(producingAskIdFor(board, 'note-a')).toBeUndefined()
  })
})
