// Run lifecycle utilities (issue #191): the pieces every runner — Ask, Conversation,
// Follow-up — needs but none should own. One AbortController registry shape, one
// cancel check, one error normalization, and the two-pass compile-under-budget
// protocol (ADR 0015).
//
// Deliberately plain utilities, not a runLifecycle module: the run state machine
// (running → done/failed/canceled, settling exactly once) lives in the store's run
// spine (startRun/settleRun, issue #189). The brain layer holds no run state of its
// own beyond the live network controllers, so a module here would be a second,
// competing state machine. Adding a fourth run kind means composing these helpers,
// not copying a runner.

import { useGraph } from '../graph/store'
import { ensureCompactionSummaries } from './contextCompaction'
import { AiError, ContextOverflowError } from './openRouter'
// Type-only, so no runtime cycle with the run engine (the same pattern
// contextCompaction uses for this type).
import type { CompletionStream } from './runEngine'

// One AbortController registry shape for every run kind, keyed by whatever the
// runner's Cancel button knows (a card id, a version id). A key may hold several
// controllers — and one controller may sit under several keys, as group compression
// does with the parent Ask card and the Group card — so cancel aborts everything
// under the key, and a finishing run removes only its own controller.
export type AbortRegistry = {
  add(key: string, controller: AbortController): void
  remove(key: string, controller: AbortController): void
  abort(key: string): void
  has(key: string): boolean
}

export function createAbortRegistry(): AbortRegistry {
  const active = new Map<string, Set<AbortController>>()
  return {
    add(key, controller) {
      const controllers = active.get(key) ?? new Set<AbortController>()
      controllers.add(controller)
      active.set(key, controllers)
    },
    remove(key, controller) {
      const controllers = active.get(key)
      if (!controllers) return
      controllers.delete(controller)
      if (controllers.size === 0) active.delete(key)
    },
    abort(key) {
      for (const controller of active.get(key) ?? []) controller.abort()
    },
    has(key) {
      return active.has(key)
    },
  }
}

// A run is canceled when its network stream was aborted or the store already
// settled it as canceled (the Cancel button can win that race while a chunk is
// still in flight).
export function isRunCanceled(runId: string, signal: AbortSignal): boolean {
  return signal.aborted || useGraph.getState().runs.find((run) => run.id === runId)?.status === 'canceled'
}

// Turn a thrown error into the plain-words message key the cards render.
export function plainError(err: unknown): string {
  // Checked before the rest, because a context overflow IS an AiError and would
  // otherwise fall through to the generic message, which tells the reader to
  // check a key that is working fine.
  if (err instanceof ContextOverflowError) return 'errTooLong'
  if (err instanceof AiError) {
    if (err.message === 'no-key' || err.message === 'bad-key') return 'errCouldNotReach'
    if (err.message === 'unreachable') return 'errCouldNotReach'
    if (err.message === 'harness-unavailable') return 'errHarnessUnavailable'
    if (err.message === 'failed') return 'errHarnessFailed'
    if (err.message === 'incompatible-output') return 'errHarnessIncompatible'
  }
  return 'errGeneric'
}

// The two-pass compile-under-budget protocol (ADR 0015). Pass one compiles with no
// summaries and reports which cards it wants compacted; the cheap model then makes
// sure summaries exist for exactly those cards (fingerprint-cached on the board);
// pass two recompiles with the summaries applied. When nothing wants compaction —
// or no summary could be obtained — the first compile stands.
export async function compileUnderBudget<T>(
  compile: (summaries: Map<string, string>) => { compiled: T; compactionInputs: Record<string, string> },
  opts: { stream: CompletionStream; signal?: AbortSignal },
): Promise<T> {
  const first = compile(new Map())
  if (Object.keys(first.compactionInputs).length === 0) return first.compiled
  const summaries = await ensureCompactionSummaries(first.compactionInputs, opts)
  if (summaries.size === 0) return first.compiled
  return compile(summaries).compiled
}
