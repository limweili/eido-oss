// What each output version remembers (Concept 5). Every version can explain its
// sources because the run that made it stored the exact compiled instruction and
// the cards/connections it used.

import { cardById, cardLabel } from '../graph/graphHelpers'
import type { RunRecord, SavedBoard } from '../graph/types'

export type VersionProvenance = {
  run?: RunRecord
  compiledInstruction: string
  usedCards: { id: string; label: string }[]
  modLabels: string[]
}

export function runForVersion(board: SavedBoard, versionId: string): RunRecord | undefined {
  return board.runs.find((r) => r.producedVersionId === versionId)
}

export function provenanceForVersion(board: SavedBoard, versionId: string): VersionProvenance {
  const run = runForVersion(board, versionId)
  if (!run) {
    return { run: undefined, compiledInstruction: '', usedCards: [], modLabels: [] }
  }
  const usedCards = run.usedCardIds
    .map((id) => {
      const c = cardById(board, id)
      return c ? { id, label: cardLabel(c) } : null
    })
    .filter((x): x is { id: string; label: string } => x !== null)

  const modLabels = run.modIds
    .map((id) => cardById(board, id)?.modV2?.title)
    .filter((l): l is string => Boolean(l))

  return { run, compiledInstruction: run.compiledInstruction, usedCards, modLabels }
}
