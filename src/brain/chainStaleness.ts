// Chain staleness (ADR 0014): running an Ask runs the minimum chain that makes
// its answer fresh. This module decides, per planned step, whether the step
// must run and why — as plain data over the plan, before anything executes —
// so the same answer drives execution (runChain) and the "what will run"
// preview (#137). Reasons map to the preview's plain-language tags:
// 'never-ran' → "Hasn't run", 'source-changed' → "Source changed",
// 'upstream-ran' → "Feeds from the step above".

import { chosenVersion, resultCardFor } from '../graph/graphHelpers'
import type { SavedBoard } from '../graph/types'
import { currentProfileReviewPolicy } from '../shared/profileReviewPolicy'
import { planChainRun, type ExecutionPlan, type ExecutionStep } from './executionPlan'
import { sourceChangeStatus } from './sourceContext'

export type ChainStepReason = 'never-ran' | 'source-changed' | 'upstream-ran' | 'fresh'

export type ChainStepStatus = {
  step: ExecutionStep
  willRun: boolean
  reason: ChainStepReason
}

// Statuses in plan order. planChainRun emits steps dependencies-first, so by
// the time a step is examined every dependency's verdict is known — the
// cascade rule (a re-run parent makes every child stale) is one lookup.
export function chainStepStatuses(board: SavedBoard, plan: ExecutionPlan): ChainStepStatus[] {
  const byStepId = new Map<string, ChainStepStatus>()
  const statuses: ChainStepStatus[] = []

  for (const step of plan.steps) {
    let reason: ChainStepReason = step.kind === 'ask' ? askFreshness(board, step.cardId) : 'fresh'
    if (reason === 'fresh' && step.dependsOn.some((id) => byStepId.get(id)?.willRun)) {
      reason = 'upstream-ran'
    }
    const status: ChainStepStatus = { step, willRun: reason !== 'fresh', reason }
    byStepId.set(step.id, status)
    statuses.push(status)
  }

  return statuses
}

// The "what will run" preview (#137, ADR 0014): plan + staleness as plain data,
// zero side effects — opening a preview never runs anything and spends nothing.
export function chainRunPreview(board: SavedBoard, targetAskAiCardId: string): ChainStepStatus[] {
  return chainStepStatuses(board, planChainRun(board, targetAskAiCardId))
}

// How many steps beyond the pressed card itself would run. This is what the
// confirm gate compares against the Settings threshold (default 2): pressing
// Run on a card always implies that card may run; the gate is about the
// *extra* upstream healing the press would trigger.
export function extraRunCount(statuses: ChainStepStatus[], targetAskAiCardId: string): number {
  return statuses.filter((status) => status.willRun && status.step.cardId !== targetAskAiCardId).length
}

// An ask step is fresh when its result card's chosen version exists, succeeded,
// its recorded source fingerprints still match the live board, and its run used
// the model currently selected on the Ask. The source check is the same one that
// drives the user-facing Source-changed badge, including its dismissal: a
// dismissed badge means the user accepted the result, so a heal run trusts that
// and reuses it. A provisional version (canceled partial) is
// not a success, and a failed run leaves no version at all — both read as
// 'never-ran', which is exactly why pressing Run again after a halt resumes
// from the failed step with no extra machinery.
function askFreshness(board: SavedBoard, askAiCardId: string): 'never-ran' | 'source-changed' | 'fresh' {
  const result = resultCardFor(board, askAiCardId)
  if (!result) return 'never-ran'
  const output = board.outputs.find((candidate) => candidate.resultCardId === result.id)
  const chosen = chosenVersion(output)
  if (!chosen || chosen.provisional) return 'never-ran'
  const ask = board.cards.find((candidate) => candidate.id === askAiCardId)
  const chosenRun = board.runs.find((run) => run.id === chosen.fromRunId)
  const reviewPolicy = currentProfileReviewPolicy()
  const selectedModel = reviewPolicy.kind === 'review' ? reviewPolicy.model : ask?.model
  if (selectedModel && chosenRun && selectedModel !== chosenRun.model) return 'source-changed'
  return sourceChangeStatus(board, chosen) ? 'source-changed' : 'fresh'
}
