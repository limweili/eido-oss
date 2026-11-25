// Compaction summaries (ADR 0015): replace a card's full text with a short
// AI summary when an Ask's context outgrows its budget. Summaries inherit the
// Idea's own AI settings and are cached by content fingerprint: a card compacts
// once and is reused until its text changes, so compaction adds no per-run
// token cost. Tunables documented in docs/foundations/context-layer.md.

import { boardAiSettingsOf } from '../graph/boardAiSettings'
import { useGraph } from '../graph/store'
import type { BoardAiSettings, CompactionMode, CompactionSummary, SavedBoard } from '../graph/types'
import { stableContentHash } from '../shared/stableHash'
import { resolveProfileReviewModel } from '../shared/profileReviewPolicy'
import { gatherConnectedThought, type CompiledInstruction } from './compiler'
import type { CompletionStream } from './runEngine'

// Summarising inherits the Idea's own AI settings: the selected provider, the
// selected model, and the selected reasoning effort. There is no separate cheap
// model, so a summary is made by whatever would have answered the Ask.
export function compactionModelForBoard(board: Pick<SavedBoard, 'aiSettings'>): string {
  return resolveProfileReviewModel(boardAiSettingsOf(board)?.model ?? '')
}

export function compactionModelForSettings(settings: Readonly<{
  provider?: BoardAiSettings['provider']
  model: string
}>): string {
  return resolveProfileReviewModel(settings.model)
}

export function compactionFingerprint(
  fullText: string,
  model: string,
  systemPrompt = '',
): string {
  // Preserve pre-system-prompt cache hashes when no prompt is configured. Once
  // guidance exists, it becomes part of this private cache identity without
  // entering AI-card source fingerprints.
  return stableContentHash(systemPrompt ? { fullText, model, systemPrompt } : { fullText, model })
}

// The cached summaries that are still valid for the given full texts.
export function validCachedSummaries(
  board: SavedBoard,
  inputs: Record<string, string>,
  expectedModel?: string,
): Map<string, string> {
  const valid = new Map<string, string>()
  const systemPrompt = boardAiSettingsOf(board)?.systemPrompt ?? ''
  for (const summary of board.compactionSummaries ?? []) {
    if (expectedModel !== undefined && summary.model !== expectedModel) continue
    const fullText = inputs[summary.cardId]
    if (fullText === undefined) continue
    if (summary.fingerprint === compactionFingerprint(fullText, summary.model, systemPrompt)) {
      valid.set(summary.cardId, summary.summary)
    }
  }
  return valid
}

export function gatherConnectedThoughtWithCachedSummaries(
  board: SavedBoard,
  askAiCardId: string,
  opts: { budgetTokens: number; mode: CompactionMode },
): CompiledInstruction {
  const first = gatherConnectedThought(board, askAiCardId, {
    ...opts,
    summaries: new Map(),
  })
  const compactionInputs = first.budget?.compactedCardIds.length ? first.compactionInputs ?? {} : {}
  if (Object.keys(compactionInputs).length === 0) return first

  const cached = validCachedSummaries(
    board,
    compactionInputs,
    compactionModelForBoard(board),
  )
  if (cached.size === 0) return first

  return gatherConnectedThought(board, askAiCardId, {
    ...opts,
    summaries: cached,
  })
}

export function buildCompactionInstruction(fullText: string): string {
  return (
    'Shorten the following context to roughly a third of its length, at most a few hundred words. ' +
    'Keep every constraint, number, name, and decision exactly; drop only elaboration. ' +
    'Reply with the shortened text only.\n\n' +
    fullText
  )
}

// Make sure every requested card has a valid cached summary, generating the
// missing ones with the Idea's own AI settings. Returns cardId → summary for
// everything available afterwards. Generation failures are skipped: the compile
// then keeps that card's full text and the plan simply trims less than hoped.
export async function ensureCompactionSummaries(
  inputs: Record<string, string>,
  opts: { stream: CompletionStream; signal?: AbortSignal },
): Promise<Map<string, string>> {
  const board = useGraph.getState().snapshot()
  const model = compactionModelForSettings(useGraph.getState().settings)
  const summaries = validCachedSummaries(board, inputs, model)

  for (const [cardId, fullText] of Object.entries(inputs)) {
    if (summaries.has(cardId)) continue
    if (opts.signal?.aborted) break
    try {
      const systemPrompt = useGraph.getState().settings.systemPrompt ?? ''
      let text = ''
      await opts.stream(buildCompactionInstruction(fullText), {
        model,
        reasoningEffort: useGraph.getState().settings.reasoningEffort,
        systemPrompt,
        temperature: 0.2,
        signal: opts.signal,
        onChunk: (chunk) => {
          text += chunk
        },
      })
      const summary = text.trim()
      if (!summary) continue
      const record: CompactionSummary = {
        cardId,
        fingerprint: compactionFingerprint(
          fullText,
          model,
          systemPrompt,
        ),
        summary,
        model,
        createdAt: new Date().toISOString(),
      }
      useGraph.getState().recordCompactionSummary(record)
      summaries.set(cardId, summary)
    } catch {
      /* skipped: the card stays full text this run */
    }
  }

  return summaries
}
