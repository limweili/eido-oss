// Lineage queries (#142, context layer): where did this result come from, and
// what depends on this card. Read-only, deterministic, pure — SavedBoard in,
// plain data out. Two directions with two different sources of truth:
//
// - lineageOf reads RECORDED provenance (RunRecord + version), because "where
//   did this come from" is a question about what actually happened.
// - dependentsOf reads the LIVE graph (context selections + result links),
//   because "what depends on this" is a question about what would go stale if
//   this card changed — the same reachability the chain cascade rule uses.

import { gatherContext } from './contextQuery'
import { chosenVersion } from './graphIndex'
import { cardById, producingAskFor, resultCardFor } from './graphHelpers'
import type { RunRecord, SavedBoard } from './types'

export type LineageGeneration = {
  // The result-like card this generation explains.
  resultCardId: string
  // The version whose story this is (the chosen version at query time).
  versionId?: string
  // The run that produced it, with what it read.
  runId?: string
  sourceCardIds: string[]
  sourceConnectionIds: string[]
  // Hops back from the queried result: 0 = the result asked about.
  generation: number
}

export type Lineage = {
  resultCardId: string
  generations: LineageGeneration[]
}

export type Dependent = {
  cardId: string
  // Hops forward from the queried card: 1 = uses it directly, 2 = uses a
  // result built on it, and so on.
  depth: number
}

function runById(board: SavedBoard, runId: string | undefined): RunRecord | undefined {
  return runId ? board.runs.find((run) => run.id === runId) : undefined
}

// The ancestry of a result card's chosen version: its producing run and
// sources, then — for every source that is itself a result card — that
// result's own producing run, generation by generation. A hand-wired loop
// terminates because each result card is visited at most once.
export function lineageOf(board: SavedBoard, resultCardId: string): Lineage {
  const generations: LineageGeneration[] = []
  const visited = new Set<string>()

  const visit = (currentResultCardId: string, generation: number) => {
    if (visited.has(currentResultCardId)) return
    visited.add(currentResultCardId)

    const output = board.outputs.find((candidate) => candidate.resultCardId === currentResultCardId)
    const version = chosenVersion(output)
    const run = runById(board, version?.fromRunId)
    generations.push({
      resultCardId: currentResultCardId,
      versionId: version?.id,
      runId: run?.id,
      sourceCardIds: run ? [...run.usedCardIds] : [],
      sourceConnectionIds: run ? [...run.usedConnectionIds] : [],
      generation,
    })

    if (!run) return
    for (const sourceCardId of run.usedCardIds) {
      if (cardById(board, sourceCardId)?.kind === 'result') visit(sourceCardId, generation + 1)
    }
  }

  visit(resultCardId, 0)
  return { resultCardId, generations }
}

// Everything downstream of a card, breadth-first: the Ask cards whose context
// selection includes it (directly or via the walk the default policy does),
// their result cards, then whatever those results feed. This is prospective —
// "if this card changes, these are the cards along the line that could go
// stale" — so it intentionally reads the live graph, not recorded runs.
export function dependentsOf(board: SavedBoard, cardId: string): Dependent[] {
  const dependents: Dependent[] = []
  const visited = new Set<string>([cardId])

  let frontier = [cardId]
  let depth = 1
  while (frontier.length > 0) {
    const next: string[] = []

    for (const ask of board.cards.filter((card) => card.kind === 'askAi')) {
      if (visited.has(ask.id)) continue
      const selection = gatherContext(board, ask.id)
      if (!frontier.some((id) => selection.usedCardIds.includes(id))) continue
      visited.add(ask.id)
      dependents.push({ cardId: ask.id, depth })
      const result = resultCardFor(board, ask.id)
      if (result && !visited.has(result.id)) {
        visited.add(result.id)
        dependents.push({ cardId: result.id, depth })
        next.push(result.id)
      }
    }

    frontier = next
    depth += 1
  }

  return dependents
}

// Convenience for provenance UI: the ask card behind a result, if any.
export function producingAskIdFor(board: SavedBoard, resultCardId: string): string | undefined {
  return producingAskFor(board, resultCardId)?.id
}
