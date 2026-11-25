import { createPerfBoard, type PerfBoardName } from '../graph/perfFixtures'
import { useGraph } from '../graph/store'
import type { Card, Output, SavedBoard, TranscriptMessage } from '../graph/types'

export type StoreOperationMeasurement = {
  operation: string
  ms: number
}

export type StorePerformanceResult = {
  caseName: PerfBoardName
  cards: number
  connections: number
  outputs: number
  runs: number
  events: number
  measurements: StoreOperationMeasurement[]
}

export const STORE_PERFORMANCE_CASES: PerfBoardName[] = ['smoke', 'medium', 'large']

export function measureStorePerformance(caseName: PerfBoardName): StorePerformanceResult {
  const board = createPerfBoard(caseName)
  const measurements: StoreOperationMeasurement[] = []

  measureStoreOperation(measurements, 'setCardText', board, (state, time) => {
    const card = firstCard(state.cards, 'note')
    time(() => state.setCardText(card.id, 'Edited benchmark note text'))
  })

  measureStoreOperation(measurements, 'appendVersionText', board, (state, time) => {
    const versionId = firstOutputVersion(state.outputs).id
    time(() => state.appendVersionText(versionId, ' streamed'))
  })

  measureStoreOperation(measurements, 'appendTranscriptChunk', withTranscript(board), (state, time) => {
    const version = firstOutputVersion(state.outputs)
    const messageId = version.transcript?.[0]?.id
    if (!messageId) throw new Error('Missing transcript message for benchmark')
    time(() => state.appendTranscriptChunk(version.id, messageId, ' chunk'))
  })

  measureStoreOperation(measurements, 'moveCard', board, (state, time) => {
    const card = firstCard(state.cards, 'note')
    time(() => state.moveCard(card.id, { x: card.position.x + 12, y: card.position.y + 8 }, { recordHistory: false }))
  })

  measureStoreOperation(measurements, 'moveGroup', withGroupMembers(board), (state, time) => {
    const group = firstCard(state.cards, 'group')
    time(() => state.moveCard(group.id, { x: group.position.x + 12, y: group.position.y + 8 }, { recordHistory: false }))
  })

  measureStoreOperation(measurements, 'addConnection', board, (state, time) => {
    const [from, to] = connectablePair(state.cards, state.connections)
    time(() => state.addConnection(from.id, to.id))
  })

  measureStoreOperation(measurements, 'deleteConnection', board, (state, time) => {
    const connection = state.connections[0]
    if (!connection) throw new Error('Missing connection for benchmark')
    time(() => state.deleteConnection(connection.id))
  })

  measureStoreOperation(measurements, 'addCard', board, (state, time) => {
    time(() => state.addCard('note', { x: 42, y: 84 }))
  })

  measureStoreOperation(measurements, 'deleteCard', board, (state, time) => {
    const card = firstCard(state.cards, 'note')
    time(() => state.deleteCard(card.id))
  })

  measureStoreOperation(measurements, 'beginRun', board, (state, time) => {
    const ask = firstCard(state.cards, 'askAi')
    time(() => state.beginRun(ask.id, {
      text: 'Benchmark prompt',
      model: 'synthetic-model',
      usedCardIds: [ask.id],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
    }))
  })

  measureStoreOperation(measurements, 'undo', board, (state, time) => {
    state.addCard('note', { x: 100, y: 100 })
    time(() => state.undo())
  })

  measureStoreOperation(measurements, 'redo', board, (state, time) => {
    state.addCard('note', { x: 100, y: 100 })
    state.undo()
    time(() => state.redo())
  })

  return {
    caseName,
    cards: board.cards.length,
    connections: board.connections.length,
    outputs: board.outputs.length,
    runs: board.runs.length,
    events: board.intentLog?.length ?? 0,
    measurements,
  }
}

export function storeResultRows(results: StorePerformanceResult[]) {
  return results.flatMap((result) =>
    result.measurements.map((measurement) => ({
      fixture: result.caseName,
      cards: result.cards,
      connections: result.connections,
      operation: measurement.operation,
      ms: measurement.ms.toFixed(2),
    })),
  )
}

export function slowestStoreOperations(results: StorePerformanceResult[], limit = 10) {
  return results
    .flatMap((result) =>
      result.measurements.map((measurement) => ({
        fixture: result.caseName,
        operation: measurement.operation,
        ms: measurement.ms,
      })),
    )
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit)
    .map((measurement) => ({
      fixture: measurement.fixture,
      operation: measurement.operation,
      ms: measurement.ms.toFixed(2),
    }))
}

// A single cold call measures the engine warming up, not the operation: the
// first invocation pays interpreter tier-up and first-touch allocation, which
// on a large fixture dominated the number by roughly an order of magnitude and
// swung it by 2x between runs. Discard warm-up samples and report the median of
// the rest, so a budget failure means the code got slower.
const STORE_MEASUREMENT_WARMUPS = 3
const STORE_MEASUREMENT_SAMPLES = 5

function measureStoreOperation(
  measurements: StoreOperationMeasurement[],
  operation: string,
  board: SavedBoard,
  fn: (state: ReturnType<typeof useGraph.getState>, time: (work: () => void) => void) => void,
) {
  const samples: number[] = []
  for (let iteration = 0; iteration < STORE_MEASUREMENT_WARMUPS + STORE_MEASUREMENT_SAMPLES; iteration += 1) {
    // Each sample starts from the same fixture, so the operation always runs
    // against an identical board rather than one N edits deep.
    resetStore(board)
    let sample: number | null = null
    const time = (work: () => void) => {
      const start = performance.now()
      work()
      sample = performance.now() - start
    }
    fn(useGraph.getState(), time)
    if (sample === null) throw new Error(`Benchmark ${operation} recorded no timed work`)
    if (iteration >= STORE_MEASUREMENT_WARMUPS) samples.push(sample)
  }
  measurements.push({ operation, ms: median(samples) })
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function resetStore(board: SavedBoard) {
  useGraph.setState({
    cards: board.cards.map((card) => ({ ...card, blocks: card.blocks.map((block) => ({ ...block })) })),
    connections: board.connections.map((connection) => ({ ...connection })),
    outputs: board.outputs.map(cloneOutput),
    runs: board.runs.map((run) => ({ ...run, usedCardIds: [...run.usedCardIds], usedConnectionIds: [...run.usedConnectionIds] })),
    intentLog: [...(board.intentLog ?? [])],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    hydrated: false,
    currentIdeaId: null,
    keyPromptOpen: false,
    ideaManagerOpen: false,
    cardClipboard: null,
  })
}

function withTranscript(board: SavedBoard): SavedBoard {
  const output = board.outputs[0]
  const version = output?.versions[0]
  if (!output || !version) return board

  const message: TranscriptMessage = {
    id: 'benchmark-transcript-message',
    speakerKind: 'participant',
    speakerName: 'Benchmark',
    participantCardId: output.resultCardId,
    text: 'Initial transcript',
    streaming: true,
  }

  return {
    ...board,
    outputs: [
      {
        ...output,
        versions: [{ ...version, transcript: [message] }, ...output.versions.slice(1)],
      },
      ...board.outputs.slice(1),
    ],
  }
}

function withGroupMembers(board: SavedBoard): SavedBoard {
  const group = board.cards.find((card) => card.kind === 'group')
  if (!group) return board
  let assigned = 0
  return {
    ...board,
    cards: board.cards.map((card) => {
      if (card.id === group.id || card.kind === 'title' || card.kind === 'group' || assigned >= 8) return card
      assigned += 1
      return { ...card, groupId: group.id }
    }),
  }
}

function firstCard(cards: Card[], kind: Card['kind']): Card {
  const card = cards.find((candidate) => candidate.kind === kind)
  if (!card) throw new Error(`Missing ${kind} card for benchmark`)
  return card
}

function firstOutputVersion(outputs: Output[]) {
  const version = outputs[0]?.versions[0]
  if (!version) throw new Error('Missing output version for benchmark')
  return version
}

function connectablePair(cards: Card[], connections: SavedBoard['connections']): [Card, Card] {
  const candidates = cards.filter((card) => card.kind !== 'title')
  const existing = new Set(connections.map((connection) => `${connection.from.cardId}->${connection.to.cardId}`))
  for (const from of candidates) {
    for (const to of candidates) {
      if (from.id === to.id) continue
      if (!existing.has(`${from.id}->${to.id}`)) return [from, to]
    }
  }
  throw new Error('Missing connectable card pair for benchmark')
}

function cloneOutput(output: Output): Output {
  return {
    ...output,
    versions: output.versions.map((version) => ({
      ...version,
      transcript: version.transcript?.map((message) => ({ ...message })),
    })),
  }
}
