import { describe, expect, it } from 'vitest'
import {
  cardById as cardByIdScan,
  incomingConnections as incomingScan,
  membersOf as membersOfScan,
  outgoingConnections as outgoingScan,
  resultCardFor as resultCardForScan,
} from './graphHelpers'
import {
  createGraphIndex,
  createGraphIndexCache,
  graphIndexForBoard,
  type GraphIndexCacheStats,
} from './graphIndex'
import { createPerfBoard } from './perfFixtures'
import type { Card, Connection, Output, RunRecord, SavedBoard } from './types'

type GraphIndexCacheStatsExpectation = Partial<
  Omit<GraphIndexCacheStats, 'rebuildsByCause' | 'subIndexBuilds' | 'subIndexReuses'>
> & {
  rebuildsByCause?: Partial<GraphIndexCacheStats['rebuildsByCause']>
  subIndexBuilds?: Partial<GraphIndexCacheStats['subIndexBuilds']>
  subIndexReuses?: Partial<GraphIndexCacheStats['subIndexReuses']>
}

function card(id: string, kind: Card['kind'] = 'note', groupId?: string): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text: id }],
    position: { x: 0, y: 0 },
    groupId,
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

function board(partial: Partial<SavedBoard>): SavedBoard {
  return {
    version: 1,
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: '2026-06-25T00:00:00.000Z',
    ...partial,
  }
}

function cacheStats({
  rebuildsByCause,
  subIndexBuilds,
  subIndexReuses,
  ...stats
}: GraphIndexCacheStatsExpectation): GraphIndexCacheStats {
  return {
    hits: 0,
    misses: 0,
    fullBuilds: 0,
    partialBuilds: 0,
    ...stats,
    rebuildsByCause: {
      initial: 0,
      cards: 0,
      connections: 0,
      outputs: 0,
      runs: 0,
      ...rebuildsByCause,
    },
    subIndexBuilds: {
      cards: 0,
      connections: 0,
      outputs: 0,
      runs: 0,
      ...subIndexBuilds,
    },
    subIndexReuses: {
      cards: 0,
      connections: 0,
      outputs: 0,
      runs: 0,
      ...subIndexReuses,
    },
  }
}

describe('createGraphIndex', () => {
  it('indexes cards and directional connection adjacency while preserving board order', () => {
    const graph = createGraphIndex(board({
      cards: [card('a'), card('b'), card('c')],
      connections: [
        connection('one', 'a', 'b'),
        connection('two', 'c', 'b'),
        connection('three', 'b', 'a'),
      ],
    }))

    expect(graph.cardById('b')?.id).toBe('b')
    expect(graph.cardsByKind('note').map((candidate) => candidate.id)).toEqual(['a', 'b', 'c'])
    expect(graph.connectionById('two')?.id).toBe('two')
    expect(graph.incomingConnections('b').map((candidate) => candidate.id)).toEqual(['one', 'two'])
    expect(graph.outgoingConnections('b').map((candidate) => candidate.id)).toEqual(['three'])
    expect(graph.connectionsForCard('b').map((candidate) => candidate.id)).toEqual(['one', 'two', 'three'])
    expect(graph.connectionsForCard('missing')).toEqual([])
  })

  it('indexes group members and subgraph connections in saved-board order', () => {
    const graph = createGraphIndex(board({
      cards: [
        card('group', 'group'),
        card('first', 'note', 'group'),
        card('nested-title', 'title', 'group'),
        card('second', 'askAi', 'group'),
        card('other'),
      ],
      connections: [
        connection('outside', 'first', 'other'),
        connection('inside', 'first', 'second'),
      ],
    }))

    expect(graph.membersOf('group').map((candidate) => candidate.id)).toEqual(['first', 'second'])
    expect(graph.connectionsAmong(new Set(['first', 'second'])).map((candidate) => candidate.id)).toEqual(['inside'])
  })

  it('indexes outputs, chosen versions, runs, and result cards', () => {
    const output: Output = {
      id: 'output-1',
      resultCardId: 'result',
      chosenVersionId: 'version-1',
      versions: [
        { id: 'version-0', number: 1, text: 'old', createdAt: '2026-06-25T00:00:00.000Z', fromRunId: 'run-0' },
        { id: 'version-1', number: 2, text: 'chosen', createdAt: '2026-06-25T00:01:00.000Z', fromRunId: 'run-1' },
      ],
    }
    const run: RunRecord = {
      id: 'run-1',
      startedAt: '2026-06-25T00:00:00.000Z',
      askAiCardId: 'ask',
      model: 'model',
      usedCardIds: [],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
      compiledInstruction: '',
      producedVersionId: 'version-1',
      status: 'done',
    }
    const earlierRun: RunRecord = {
      ...run,
      id: 'run-0',
      producedVersionId: 'version-0',
    }
    const otherRun: RunRecord = {
      ...run,
      id: 'run-other',
      askAiCardId: 'other',
      producedVersionId: undefined,
    }
    const graph = createGraphIndex(board({
      cards: [card('ask', 'askAi'), card('result', 'result'), card('other', 'askAi')],
      connections: [connection('ask-to-result', 'ask', 'result')],
      outputs: [output],
      runs: [earlierRun, run, otherRun],
    }))

    expect(graph.outputById('output-1')).toBe(output)
    expect(graph.outputForResultCard('result')).toBe(output)
    expect(graph.chosenVersionForResultCard('result')?.text).toBe('chosen')
    expect(graph.versionById('version-1')).toEqual({ output, version: output.versions[1] })
    expect(graph.runById('run-1')).toBe(run)
    expect(graph.runsForCard('ask').map((candidate) => candidate.id)).toEqual(['run-0', 'run-1'])
    expect(graph.runForVersion('version-1')).toBe(run)
    expect(graph.resultCardFor('ask')?.id).toBe('result')
  })
})

describe('createGraphIndexCache', () => {
  it('reuses the index while board array identities are unchanged', () => {
    const saved = board({
      cards: [card('a'), card('b')],
      connections: [connection('ab', 'a', 'b')],
    })
    const cache = createGraphIndexCache()

    const first = cache.get(saved)
    const second = cache.get(saved)

    expect(second).toBe(first)
    expect(cache.stats()).toEqual(cacheStats({
      hits: 1,
      misses: 1,
      fullBuilds: 1,
      rebuildsByCause: {
        initial: 1,
      },
      subIndexBuilds: {
        cards: 1,
        connections: 1,
        outputs: 1,
        runs: 1,
      },
    }))
  })

  it('attributes rebuilds when a board card array identity changes', () => {
    const saved = board({
      cards: [card('a'), card('b')],
      connections: [connection('ab', 'a', 'b')],
    })
    const cache = createGraphIndexCache()
    const first = cache.get(saved)

    const second = cache.get({
      ...saved,
      cards: [...saved.cards, card('c')],
    })

    expect(second).not.toBe(first)
    expect(second.cardById('c')?.id).toBe('c')
    expect(cache.stats()).toEqual(cacheStats({
      misses: 2,
      fullBuilds: 1,
      partialBuilds: 1,
      rebuildsByCause: {
        initial: 1,
        cards: 1,
      },
      subIndexBuilds: {
        cards: 2,
        connections: 1,
        outputs: 1,
        runs: 1,
      },
      subIndexReuses: {
        connections: 1,
        outputs: 1,
        runs: 1,
      },
    }))
  })

  it('attributes rebuilds when a board connection array identity changes', () => {
    const saved = board({
      cards: [card('a'), card('b'), card('c'), card('result', 'result')],
      connections: [connection('ab', 'a', 'b')],
    })
    const cache = createGraphIndexCache()
    const first = cache.get(saved)

    const second = cache.get({
      ...saved,
      connections: [
        ...saved.connections,
        connection('bc', 'b', 'c'),
        connection('c-result', 'c', 'result'),
      ],
    })

    expect(second).not.toBe(first)
    expect(second.connectionById('bc')?.id).toBe('bc')
    expect(second.incomingConnections('c').map((candidate) => candidate.id)).toEqual(['bc'])
    expect(second.outgoingConnections('c').map((candidate) => candidate.id)).toEqual(['c-result'])
    expect(second.connectionsForCard('c').map((candidate) => candidate.id)).toEqual(['bc', 'c-result'])
    expect(second.connectionsAmong(['b', 'c', 'result']).map((candidate) => candidate.id)).toEqual([
      'bc',
      'c-result',
    ])
    expect(second.resultCardFor('c')?.id).toBe('result')
    expect(cache.stats()).toEqual(cacheStats({
      misses: 2,
      fullBuilds: 1,
      partialBuilds: 1,
      rebuildsByCause: {
        initial: 1,
        connections: 1,
      },
      subIndexBuilds: {
        cards: 1,
        connections: 2,
        outputs: 1,
        runs: 1,
      },
      subIndexReuses: {
        cards: 1,
        outputs: 1,
        runs: 1,
      },
    }))
  })

  it('attributes output-only and run-only cache rebuild causes separately', () => {
    const output: Output = {
      id: 'output-1',
      resultCardId: 'result',
      chosenVersionId: 'version-1',
      versions: [
        {
          id: 'version-1',
          number: 1,
          text: 'chosen',
          createdAt: '2026-06-25T00:01:00.000Z',
          fromRunId: 'run-1',
        },
      ],
    }
    const run: RunRecord = {
      id: 'run-1',
      startedAt: '2026-06-25T00:00:00.000Z',
      askAiCardId: 'ask',
      model: 'model',
      usedCardIds: [],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
      compiledInstruction: '',
      producedVersionId: 'version-1',
      status: 'done',
    }
    const saved = board({
      cards: [card('ask', 'askAi'), card('result', 'result')],
      connections: [connection('ask-result', 'ask', 'result')],
      outputs: [output],
      runs: [run],
    })
    const cache = createGraphIndexCache()
    const outputChanged = {
      ...saved,
      outputs: [{ ...output, versions: [{ ...output.versions[0], text: 'changed' }] }],
    }

    cache.get(saved)
    const afterOutputChange = cache.get(outputChanged)
    const runChanged = {
      ...outputChanged,
      runs: [{ ...run, status: 'failed' } satisfies RunRecord],
    }
    const afterRunChange = cache.get(runChanged)

    expect(afterOutputChange.chosenVersionForResultCard('result')?.text).toBe('changed')
    expect(afterOutputChange.versionById('version-1')?.version.text).toBe('changed')
    expect(afterRunChange.runById('run-1')?.status).toBe('failed')
    expect(afterRunChange.runForVersion('version-1')?.status).toBe('failed')

    expect(cache.stats()).toEqual(cacheStats({
      misses: 3,
      fullBuilds: 1,
      partialBuilds: 2,
      rebuildsByCause: {
        initial: 1,
        outputs: 1,
        runs: 1,
      },
      subIndexBuilds: {
        cards: 1,
        connections: 1,
        outputs: 2,
        runs: 2,
      },
      subIndexReuses: {
        cards: 2,
        connections: 2,
        outputs: 1,
        runs: 1,
      },
    }))
  })

  it('combines rebuilt card indexes with reused connection indexes', () => {
    const saved = board({
      cards: [card('ask', 'askAi'), card('target', 'note')],
      connections: [connection('ask-target', 'ask', 'target')],
    })
    const cache = createGraphIndexCache()
    const first = cache.get(saved)

    const second = cache.get({
      ...saved,
      cards: saved.cards.map((candidate) =>
        candidate.id === 'target'
          ? { ...candidate, kind: 'result' }
          : candidate,
      ),
    })

    expect(first.resultCardFor('ask')).toBeUndefined()
    expect(second.resultCardFor('ask')?.id).toBe('target')
    expect(cache.stats()).toEqual(cacheStats({
      misses: 2,
      fullBuilds: 1,
      partialBuilds: 1,
      rebuildsByCause: {
        initial: 1,
        cards: 1,
      },
      subIndexBuilds: {
        cards: 2,
        connections: 1,
        outputs: 1,
        runs: 1,
      },
      subIndexReuses: {
        connections: 1,
        outputs: 1,
        runs: 1,
      },
    }))
  })

  it('reuses the index across new board shells when record arrays are unchanged', () => {
    const saved = board({
      cards: [card('a'), card('b')],
      connections: [connection('ab', 'a', 'b')],
    })
    const cache = createGraphIndexCache()
    const first = cache.get(saved)

    const second = cache.get({
      cards: saved.cards,
      connections: saved.connections,
      outputs: saved.outputs,
      runs: saved.runs,
    })

    expect(second).toBe(first)
    expect(cache.stats().hits).toBe(1)
  })

  it('treats unchanged array identity as unchanged graph contents', () => {
    const saved = board({
      cards: [card('a'), card('b')],
      connections: [connection('ab', 'a', 'b')],
    })
    const cache = createGraphIndexCache()
    const first = cache.get(saved)

    saved.cards.push(card('mutated'))
    const second = cache.get(saved)

    expect(second).toBe(first)
    expect(second.cardById('mutated')).toBeUndefined()
    expect(cache.stats()).toEqual(cacheStats({
      hits: 1,
      misses: 1,
      fullBuilds: 1,
      rebuildsByCause: {
        initial: 1,
      },
      subIndexBuilds: {
        cards: 1,
        connections: 1,
        outputs: 1,
        runs: 1,
      },
    }))
  })
})

describe('graphIndexForBoard', () => {
  it('shares the default graph cache across board snapshots with stable arrays', () => {
    const saved = board({
      cards: [card('a'), card('b')],
      connections: [connection('ab', 'a', 'b')],
    })
    const first = graphIndexForBoard(saved)
    const second = graphIndexForBoard({
      cards: saved.cards,
      connections: saved.connections,
      outputs: saved.outputs,
      runs: saved.runs,
    })

    expect(second).toBe(first)
  })
})

describe('index answers match board array semantics', () => {
  // The straightforward array walks in graphHelpers (and inline scans for
  // lookups graphHelpers does not cover) are the semantic oracle.
  const saved = createPerfBoard('smoke')
  const index = createGraphIndex(saved)

  it('matches card lookups for every card', () => {
    for (const c of saved.cards) {
      expect(index.cardById(c.id)).toBe(cardByIdScan(saved, c.id))
    }
    expect(index.cardById('missing')).toBeUndefined()
    const kinds = new Set(saved.cards.map((c) => c.kind))
    for (const kind of kinds) {
      expect(index.cardsByKind(kind)).toEqual(saved.cards.filter((c) => c.kind === kind))
    }
  })

  it('matches connection adjacency for every card, in saved-board order', () => {
    for (const c of saved.cards) {
      expect(index.incomingConnections(c.id)).toEqual(incomingScan(saved, c.id))
      expect(index.outgoingConnections(c.id)).toEqual(outgoingScan(saved, c.id))
      expect(index.connectionsForCard(c.id)).toEqual(
        saved.connections.filter(
          (connection) => connection.from.cardId === c.id || connection.to.cardId === c.id,
        ),
      )
    }
    for (const c of saved.connections) {
      expect(index.connectionById(c.id)).toBe(c)
    }
  })

  it('matches subgraph connections for a card subset', () => {
    const subset = new Set(saved.cards.slice(0, 40).map((c) => c.id))
    expect(index.connectionsAmong(subset)).toEqual(
      saved.connections.filter(
        (connection) => subset.has(connection.from.cardId) && subset.has(connection.to.cardId),
      ),
    )
  })

  it('matches group membership and result cards', () => {
    for (const group of saved.cards.filter((c) => c.kind === 'group')) {
      expect(index.membersOf(group.id)).toEqual(membersOfScan(saved, group.id))
    }
    for (const ask of saved.cards.filter((c) => c.kind === 'askAi')) {
      expect(index.resultCardFor(ask.id)).toBe(resultCardForScan(saved, ask.id))
    }
  })

  it('matches output, version, and run lookups', () => {
    for (const output of saved.outputs) {
      expect(index.outputById(output.id)).toBe(output)
      expect(index.outputForResultCard(output.resultCardId)).toBe(output)
      const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
      expect(index.chosenVersionForResultCard(output.resultCardId)).toBe(
        output.versions.find((version) => version.id === chosenId),
      )
      for (const version of output.versions) {
        expect(index.versionById(version.id)).toEqual({ output, version })
      }
    }
    for (const run of saved.runs) {
      expect(index.runById(run.id)).toBe(run)
      expect(index.runsForCard(run.askAiCardId)).toEqual(
        saved.runs.filter((candidate) => candidate.askAiCardId === run.askAiCardId),
      )
      if (run.producedVersionId) {
        expect(index.runForVersion(run.producedVersionId)).toBe(run)
      }
    }
  })
})
