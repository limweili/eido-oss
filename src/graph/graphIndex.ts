import { chosenVersion } from './graphHelpers'
import type { Card, CardKind, Connection, Output, OutputVersion, RunRecord, SavedBoard } from './types'

export { chosenVersion }

export type GraphIndexBoard = Pick<SavedBoard, 'cards' | 'connections' | 'outputs' | 'runs'>

export type OutputVersionLookup = {
  output: Output
  version: OutputVersion
}

export type BoardGraphIndex = {
  cardById: (cardId: string) => Card | undefined
  cardOrder: (cardId: string) => number | undefined
  cardsByKind: (kind: CardKind) => readonly Card[]
  connectionById: (connectionId: string) => Connection | undefined
  incomingConnections: (cardId: string) => readonly Connection[]
  outgoingConnections: (cardId: string) => readonly Connection[]
  connectionsForCard: (cardId: string) => readonly Connection[]
  connectionsAmong: (cardIds: ReadonlySet<string> | readonly string[]) => Connection[]
  membersOf: (groupId: string) => readonly Card[]
  outputById: (outputId: string) => Output | undefined
  outputForResultCard: (resultCardId: string) => Output | undefined
  chosenVersionForResultCard: (resultCardId: string) => OutputVersion | undefined
  versionById: (versionId: string) => OutputVersionLookup | undefined
  runById: (runId: string) => RunRecord | undefined
  runsForCard: (cardId: string) => readonly RunRecord[]
  runForVersion: (versionId: string) => RunRecord | undefined
  resultCardFor: (askAiCardId: string) => Card | undefined
}

export type GraphIndexCache = {
  get: (board: GraphIndexBoard) => BoardGraphIndex
  stats: () => GraphIndexCacheStats
}

export type GraphIndexCacheStats = {
  hits: number
  misses: number
  fullBuilds: number
  partialBuilds: number
  rebuildsByCause: GraphIndexRebuildCauseCounts
  subIndexBuilds: GraphIndexSubIndexCounts
  subIndexReuses: GraphIndexSubIndexCounts
}

export type GraphIndexRebuildCauseCounts = {
  initial: number
  cards: number
  connections: number
  outputs: number
  runs: number
}

export type GraphIndexSubIndexCounts = {
  cards: number
  connections: number
  outputs: number
  runs: number
}

type GraphCardIndex = {
  cardsById: Map<string, Card>
  cardOrderById: Map<string, number>
  cardsByKind: Map<CardKind, Card[]>
  membersByGroupId: Map<string, Card[]>
}

type GraphConnectionIndex = {
  connectionsById: Map<string, Connection>
  incomingConnectionsByCardId: Map<string, Connection[]>
  outgoingConnectionsByCardId: Map<string, Connection[]>
  connectionsByCardId: Map<string, Connection[]>
  connectionOrderById: Map<string, number>
}

type GraphOutputIndex = {
  outputsById: Map<string, Output>
  outputsByResultCardId: Map<string, Output>
  versionsById: Map<string, OutputVersionLookup>
}

type GraphRunIndex = {
  runsById: Map<string, RunRecord>
  runsByCardId: Map<string, RunRecord[]>
  runsByProducedVersionId: Map<string, RunRecord>
}

type GraphIndexParts = {
  cards: GraphCardIndex
  connections: GraphConnectionIndex
  outputs: GraphOutputIndex
  runs: GraphRunIndex
}

const sharedGraphIndexCache = createGraphIndexCache()

const EMPTY_CONNECTIONS: readonly Connection[] = []
const EMPTY_CARDS: readonly Card[] = []
const EMPTY_RUNS: readonly RunRecord[] = []

// This cache follows the store's immutable array convention: unchanged array
// identity means unchanged graph contents.
export function createGraphIndexCache(): GraphIndexCache {
  let previousCards: GraphIndexBoard['cards'] | undefined
  let previousConnections: GraphIndexBoard['connections'] | undefined
  let previousOutputs: GraphIndexBoard['outputs'] | undefined
  let previousRuns: GraphIndexBoard['runs'] | undefined
  let previousIndex: BoardGraphIndex | undefined
  let previousParts: GraphIndexParts | undefined
  let hits = 0
  let misses = 0
  let fullBuilds = 0
  let partialBuilds = 0
  const rebuildsByCause: GraphIndexRebuildCauseCounts = {
    initial: 0,
    cards: 0,
    connections: 0,
    outputs: 0,
    runs: 0,
  }
  const subIndexBuilds: GraphIndexSubIndexCounts = emptySubIndexCounts()
  const subIndexReuses: GraphIndexSubIndexCounts = emptySubIndexCounts()

  return {
    get(board) {
      if (
        previousIndex &&
        previousCards === board.cards &&
        previousConnections === board.connections &&
        previousOutputs === board.outputs &&
        previousRuns === board.runs
      ) {
        hits += 1
        return previousIndex
      }

      misses += 1
      recordGraphIndexRebuildCauses(rebuildsByCause, {
        previousIndex,
        previousCards,
        previousConnections,
        previousOutputs,
        previousRuns,
        board,
      })
      const nextParts = nextGraphIndexParts({
        previousParts,
        previousCards,
        previousConnections,
        previousOutputs,
        previousRuns,
        board,
        subIndexBuilds,
        subIndexReuses,
      })
      if (previousParts && hasReusedSubIndex(previousParts, nextParts)) {
        partialBuilds += 1
      } else {
        fullBuilds += 1
      }
      previousCards = board.cards
      previousConnections = board.connections
      previousOutputs = board.outputs
      previousRuns = board.runs
      previousParts = nextParts
      previousIndex = createGraphIndexFromParts(nextParts)
      return previousIndex
    },
    stats() {
      return {
        hits,
        misses,
        fullBuilds,
        partialBuilds,
        rebuildsByCause: { ...rebuildsByCause },
        subIndexBuilds: { ...subIndexBuilds },
        subIndexReuses: { ...subIndexReuses },
      }
    },
  }
}

export function graphIndexForBoard(board: GraphIndexBoard): BoardGraphIndex {
  return sharedGraphIndexCache.get(board)
}

export function sharedGraphIndexCacheStats(): GraphIndexCacheStats {
  return sharedGraphIndexCache.stats()
}

export function createGraphIndex(board: GraphIndexBoard): BoardGraphIndex {
  return createGraphIndexFromParts(createGraphIndexParts(board))
}

function createGraphIndexParts(board: GraphIndexBoard): GraphIndexParts {
  return {
    cards: buildCardIndex(board.cards),
    connections: buildConnectionIndex(board.connections),
    outputs: buildOutputIndex(board.outputs),
    runs: buildRunIndex(board.runs),
  }
}

function buildCardIndex(cards: GraphIndexBoard['cards']): GraphCardIndex {
  const cardsById = new Map<string, Card>()
  const cardOrderById = new Map<string, number>()
  const cardsByKind = new Map<CardKind, Card[]>()
  const membersByGroupId = new Map<string, Card[]>()

  for (const [index, card] of cards.entries()) {
    cardsById.set(card.id, card)
    cardOrderById.set(card.id, index)
    push(cardsByKind, card.kind, card)
    if (card.groupId && card.kind !== 'group' && card.kind !== 'title') {
      push(membersByGroupId, card.groupId, card)
    }
  }

  return {
    cardsById,
    cardOrderById,
    cardsByKind,
    membersByGroupId,
  }
}

function buildConnectionIndex(connections: GraphIndexBoard['connections']): GraphConnectionIndex {
  const connectionsById = new Map<string, Connection>()
  const incomingConnectionsByCardId = new Map<string, Connection[]>()
  const outgoingConnectionsByCardId = new Map<string, Connection[]>()
  const connectionsByCardId = new Map<string, Connection[]>()
  const connectionOrderById = new Map<string, number>()

  connections.forEach((connection, index) => {
    connectionsById.set(connection.id, connection)
    connectionOrderById.set(connection.id, index)
    push(outgoingConnectionsByCardId, connection.from.cardId, connection)
    push(incomingConnectionsByCardId, connection.to.cardId, connection)
    push(connectionsByCardId, connection.from.cardId, connection)
    if (connection.to.cardId !== connection.from.cardId) {
      push(connectionsByCardId, connection.to.cardId, connection)
    }
  })

  return {
    connectionsById,
    incomingConnectionsByCardId,
    outgoingConnectionsByCardId,
    connectionsByCardId,
    connectionOrderById,
  }
}

function buildOutputIndex(outputs: GraphIndexBoard['outputs']): GraphOutputIndex {
  const outputsById = new Map<string, Output>()
  const outputsByResultCardId = new Map<string, Output>()
  const versionsById = new Map<string, OutputVersionLookup>()

  for (const output of outputs) {
    outputsById.set(output.id, output)
    outputsByResultCardId.set(output.resultCardId, output)
    for (const version of output.versions) {
      versionsById.set(version.id, { output, version })
    }
  }

  return {
    outputsById,
    outputsByResultCardId,
    versionsById,
  }
}

function buildRunIndex(runs: GraphIndexBoard['runs']): GraphRunIndex {
  const runsById = new Map<string, RunRecord>()
  const runsByCardId = new Map<string, RunRecord[]>()
  const runsByProducedVersionId = new Map<string, RunRecord>()

  for (const run of runs) {
    runsById.set(run.id, run)
    push(runsByCardId, run.askAiCardId, run)
    if (run.producedVersionId) runsByProducedVersionId.set(run.producedVersionId, run)
  }

  return {
    runsById,
    runsByCardId,
    runsByProducedVersionId,
  }
}

function createGraphIndexFromParts({
  cards,
  connections,
  outputs,
  runs,
}: GraphIndexParts): BoardGraphIndex {
  return {
    cardById(cardId) {
      return cards.cardsById.get(cardId)
    },
    cardOrder(cardId) {
      return cards.cardOrderById.get(cardId)
    },
    cardsByKind(kind) {
      return cards.cardsByKind.get(kind) ?? EMPTY_CARDS
    },
    connectionById(connectionId) {
      return connections.connectionsById.get(connectionId)
    },
    incomingConnections(cardId) {
      return connections.incomingConnectionsByCardId.get(cardId) ?? EMPTY_CONNECTIONS
    },
    outgoingConnections(cardId) {
      return connections.outgoingConnectionsByCardId.get(cardId) ?? EMPTY_CONNECTIONS
    },
    connectionsForCard(cardId) {
      return connections.connectionsByCardId.get(cardId) ?? EMPTY_CONNECTIONS
    },
    connectionsAmong(cardIds) {
      const ids = cardIds instanceof Set ? cardIds : new Set(cardIds)
      const candidates = new Map<string, Connection>()
      for (const cardId of ids) {
        for (const connection of connections.connectionsByCardId.get(cardId) ?? EMPTY_CONNECTIONS) {
          if (ids.has(connection.from.cardId) && ids.has(connection.to.cardId)) {
            candidates.set(connection.id, connection)
          }
        }
      }
      return [...candidates.values()].sort(
        (a, b) =>
          (connections.connectionOrderById.get(a.id) ?? 0) - (connections.connectionOrderById.get(b.id) ?? 0),
      )
    },
    membersOf(groupId) {
      return cards.membersByGroupId.get(groupId) ?? EMPTY_CARDS
    },
    outputById(outputId) {
      return outputs.outputsById.get(outputId)
    },
    outputForResultCard(resultCardId) {
      return outputs.outputsByResultCardId.get(resultCardId)
    },
    chosenVersionForResultCard(resultCardId) {
      return chosenVersion(outputs.outputsByResultCardId.get(resultCardId))
    },
    versionById(versionId) {
      return outputs.versionsById.get(versionId)
    },
    runById(runId) {
      return runs.runsById.get(runId)
    },
    runsForCard(cardId) {
      return runs.runsByCardId.get(cardId) ?? EMPTY_RUNS
    },
    runForVersion(versionId) {
      return runs.runsByProducedVersionId.get(versionId)
    },
    resultCardFor(askAiCardId) {
      for (const connection of connections.outgoingConnectionsByCardId.get(askAiCardId) ?? EMPTY_CONNECTIONS) {
        const target = cards.cardsById.get(connection.to.cardId)
        if (target?.kind === 'result') return target
      }
      return undefined
    },
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const bucket = map.get(key)
  if (bucket) bucket.push(value)
  else map.set(key, [value])
}

function nextGraphIndexParts({
  previousParts,
  previousCards,
  previousConnections,
  previousOutputs,
  previousRuns,
  board,
  subIndexBuilds,
  subIndexReuses,
}: {
  previousParts: GraphIndexParts | undefined
  previousCards: GraphIndexBoard['cards'] | undefined
  previousConnections: GraphIndexBoard['connections'] | undefined
  previousOutputs: GraphIndexBoard['outputs'] | undefined
  previousRuns: GraphIndexBoard['runs'] | undefined
  board: GraphIndexBoard
  subIndexBuilds: GraphIndexSubIndexCounts
  subIndexReuses: GraphIndexSubIndexCounts
}): GraphIndexParts {
  return {
    cards: reusableSubIndex(previousParts?.cards, previousCards, board.cards, 'cards', subIndexReuses)
      ?? countedSubIndexBuild('cards', subIndexBuilds, () => buildCardIndex(board.cards)),
    connections: reusableSubIndex(
      previousParts?.connections,
      previousConnections,
      board.connections,
      'connections',
      subIndexReuses,
    )
      ?? countedSubIndexBuild('connections', subIndexBuilds, () => buildConnectionIndex(board.connections)),
    outputs: reusableSubIndex(previousParts?.outputs, previousOutputs, board.outputs, 'outputs', subIndexReuses)
      ?? countedSubIndexBuild('outputs', subIndexBuilds, () => buildOutputIndex(board.outputs)),
    runs: reusableSubIndex(previousParts?.runs, previousRuns, board.runs, 'runs', subIndexReuses)
      ?? countedSubIndexBuild('runs', subIndexBuilds, () => buildRunIndex(board.runs)),
  }
}

function reusableSubIndex<T>(
  previousSubIndex: T | undefined,
  previousRecords: readonly unknown[] | undefined,
  nextRecords: readonly unknown[],
  part: keyof GraphIndexSubIndexCounts,
  counts: GraphIndexSubIndexCounts,
): T | undefined {
  if (!previousSubIndex || previousRecords !== nextRecords) return undefined
  counts[part] += 1
  return previousSubIndex
}

function countedSubIndexBuild<T>(
  part: keyof GraphIndexSubIndexCounts,
  counts: GraphIndexSubIndexCounts,
  build: () => T,
): T {
  counts[part] += 1
  return build()
}

function hasReusedSubIndex(previousParts: GraphIndexParts, nextParts: GraphIndexParts): boolean {
  return (
    previousParts.cards === nextParts.cards ||
    previousParts.connections === nextParts.connections ||
    previousParts.outputs === nextParts.outputs ||
    previousParts.runs === nextParts.runs
  )
}

function emptySubIndexCounts(): GraphIndexSubIndexCounts {
  return {
    cards: 0,
    connections: 0,
    outputs: 0,
    runs: 0,
  }
}

function recordGraphIndexRebuildCauses(
  counts: GraphIndexRebuildCauseCounts,
  {
    previousIndex,
    previousCards,
    previousConnections,
    previousOutputs,
    previousRuns,
    board,
  }: {
    previousIndex: BoardGraphIndex | undefined
    previousCards: GraphIndexBoard['cards'] | undefined
    previousConnections: GraphIndexBoard['connections'] | undefined
    previousOutputs: GraphIndexBoard['outputs'] | undefined
    previousRuns: GraphIndexBoard['runs'] | undefined
    board: GraphIndexBoard
  },
) {
  if (!previousIndex) {
    counts.initial += 1
    return
  }
  if (previousCards !== board.cards) counts.cards += 1
  if (previousConnections !== board.connections) counts.connections += 1
  if (previousOutputs !== board.outputs) counts.outputs += 1
  if (previousRuns !== board.runs) counts.runs += 1
}
