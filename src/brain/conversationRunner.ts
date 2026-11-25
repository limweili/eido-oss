// The Conversation runner (a deep module). It drives a Conversation from graph
// state: resolve participants, generate any missing Speaker Names, then cycle
// through ordered participants for the configured number of turns, streaming each
// turn into the one Conversation Result version. It supports cancel (keeping the
// Partial Transcript as a Provisional Version) and continuing from an existing
// transcript. There is no pause/resume in v1.
//
// The streaming boundary and Speaker Name generator are injectable so the whole
// orchestration can be tested with a fake AI, against the real store.

import { useGraph } from '../graph/store'
import { incomingConnections } from '../graph/graphHelpers'
import {
  DEFAULT_COMPACTION_MODE,
  type AgentRunAttribution,
  type ConversationProvenance,
} from '../graph/types'
import { resolveProfileReviewModel } from '../shared/profileReviewPolicy'
import {
  buildTurnPrompt,
  planConversationTurns,
  resolveConversation,
  type ResolvedConversation,
  type ResolvedParticipant,
} from './conversationCompiler'
import { budgetFor } from './modelWindows'
import {
  AGENT_RUN_VARIATION_LIMITS,
  type AgentRunArtifactReference,
} from './agentRunContract'
import {
  planAiExecution,
  planConversationRun,
  type ConversationExecutionPlan,
} from './executionPlan'
import {
  bindCompletionAccess,
  streamCompletionWithAccess,
  type CompletionAsset,
} from './openRouter'
import type { CompletionStream } from './runEngine'
import { compileUnderBudget, createAbortRegistry, isRunCanceled, plainError } from './runLifecycle'
import { createSourceContextSnapshot, sourceRefsForConversation } from './sourceContext'
import { participantTurnCount, startParticipantMessage, userMessage } from './transcript'
import {
  aiAccessFailure,
  resolveEngineAiAccess,
  type AiAccessFailure,
  type AiAccessGrant,
} from './aiAccess'
import {
  createAiExecutionBatch,
  type AiExecutionBatch,
} from './aiExecutionBatch'
import { localProviderCompletion } from './aiProvider'

export type ConversationStream = (
  instruction: string,
  opts: {
    model: string
    assets: CompletionAsset[]
    variationNote?: string
    temperature?: number
    signal?: AbortSignal
    onChunk: (text: string) => void
  },
) => Promise<string>

export type ConversationRunOptions = {
  continueInVersionId?: string // continue this version IN PLACE (one conversation = one version)
  leadingUserMessage?: string // a user message that opens a continuation
  rounds?: number // override the number of rounds (a continuation runs one round)
  variationNote?: string // optional framing for making a distinct version
  temperature?: number
  stream?: ConversationStream // injectable AI boundary (tests pass a fake)
  compactionStream?: CompletionStream // injectable boundary for context-budget summaries
  generateSpeakerName?: (participant: ResolvedParticipant) => Promise<string>
  /** Trusted delegated execution inputs. Ordinary visible runs omit both. */
  admittedPlan?: ConversationExecutionPlan
  triggeredBy?: AgentRunAttribution
  /** Trusted delegated guard, checked immediately before every compaction and
   * participant provider call. Active artifacts identify the one owned Run. */
  admissionGuard?: (activeArtifacts: readonly AgentRunArtifactReference[]) => boolean
}

export type ConversationOutcome =
  | {
      ok: true
      versionId: string
      status: 'done'
      artifacts: readonly AgentRunArtifactReference[]
    }
  | {
      ok: true
      versionId?: string
      status: 'canceled'
      artifacts: readonly AgentRunArtifactReference[]
    }
  | {
      ok: false
      reason: 'no-key' | 'no-participants' | 'plan-changed' | 'failed'
      message: string
      artifacts: readonly AgentRunArtifactReference[]
    }
  | (AiAccessFailure & Readonly<{
      artifacts: readonly AgentRunArtifactReference[]
    }>)

export type AgentConversationRunOptions = Readonly<{
  admittedPlan: ConversationExecutionPlan
  triggeredBy: AgentRunAttribution
  mode: 'run' | 'variations'
  variationIndex: number
  variationCount: number
  admissionGuard?: (activeArtifacts: readonly AgentRunArtifactReference[]) => boolean
  stream?: ConversationStream
  compactionStream?: CompletionStream
}>

class ConversationPlanChanged extends Error {}

// The AbortController for each running Conversation, keyed by the Conversation
// card id, so the UI can cancel without reaching into the runner's internals.
const activeRuns = createAbortRegistry()

export function cancelConversation(conversationCardId: string): void {
  activeRuns.abort(conversationCardId)
  for (const run of runningConversationRuns(conversationCardId)) {
    useGraph.getState().cancelConversationRun(run.id)
  }
}

function runningConversationRuns(conversationCardId: string) {
  return useGraph
    .getState()
    .runs.filter(
      (run) =>
        run.kind === 'conversation' &&
        run.askAiCardId === conversationCardId &&
        run.status === 'running',
    )
}

// The default AI boundary: one resolver-issued access grant, one OpenRouter
// request implementation. Conversation orchestration never selects credentials.
function defaultStream(accessGrant: AiAccessGrant): ConversationStream {
  return (instruction, opts) => {
    const { reasoningEffort, systemPrompt = '' } = useGraph.getState().settings
    return streamCompletionWithAccess(instruction, {
      accessGrant,
      model: opts.model,
      reasoningEffort,
      systemPrompt,
      assets: opts.assets,
      variationNote: opts.variationNote,
      temperature: opts.temperature,
      signal: opts.signal,
      onChunk: opts.onChunk,
    })
  }
}

// Generate a short Speaker Name from a participant's PRIVATE role/context. Falls
// back to a positional name if the small call fails — a missing name should never
// fail the whole run.
async function defaultGenerateSpeakerName(
  participant: ResolvedParticipant,
  accessGrant: AiAccessGrant,
  providerModelId: string,
  signal?: AbortSignal,
): Promise<string> {
  const { reasoningEffort, systemPrompt = '' } = useGraph.getState().settings
  const seed = [participant.role, participant.privateContext.text].filter(Boolean).join('\n\n')
  const prompt =
    'Read the role and context below for one participant in a conversation. Reply with a SHORT ' +
    'speaker name for them — at most three words, no quotes, no punctuation, no explanation.\n\n' +
    seed
  let full = ''
  await streamCompletionWithAccess(prompt, {
    accessGrant,
    model: providerModelId,
    reasoningEffort,
    systemPrompt,
    temperature: 0.3,
    signal,
    onChunk: (chunk) => {
      full += chunk
    },
  })
  return full
}

function cleanSpeakerName(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .split('\n')[0]
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .trim()
  if (!cleaned) return fallback
  return cleaned.length > 40 ? cleaned.slice(0, 40).trim() : cleaned
}

type ConversationVariation = Readonly<{
  variationNote?: string
  temperature?: number
}>

type AdmittedConversationBatch = Readonly<{
  admitted: true
  executionBatch: AiExecutionBatch
  rounds: number
  visibleTurnsPerVariation: number
}>

type RejectedConversationBatch = Readonly<{
  admitted: false
  outcome: ConversationOutcome
}>

export function runConversation(
  conversationCardId: string,
  opts: ConversationRunOptions = {},
): Promise<ConversationOutcome> {
  return runConversationBatch(conversationCardId, opts, [{}])
}

async function admitConversationBatch(
  conversationCardId: string,
  opts: ConversationRunOptions,
  count: number,
): Promise<AdmittedConversationBatch | RejectedConversationBatch> {
  const store = useGraph.getState()
  const board = store.snapshot()
  if (opts.admittedPlan && !sameConversationPlan(
    opts.admittedPlan,
    planConversationRun(board, conversationCardId),
  )) {
    return {
      admitted: false,
      outcome: {
        ok: false,
        reason: 'plan-changed',
        message: 'chainPlanChanged',
        artifacts: Object.freeze([]),
      },
    }
  }
  const preview = resolveConversation(board, conversationCardId)
  if (preview.participants.length === 0) {
    return {
      admitted: false,
      outcome: {
        ok: false,
        reason: 'no-participants',
        message: 'errNoParticipants',
        artifacts: Object.freeze([]),
      },
    }
  }
  const delegated = Boolean(opts.triggeredBy)
  const rounds = opts.admittedPlan?.turnsPerParticipant
    ?? opts.rounds
    ?? preview.settings.turnsPerParticipant
  const aiExecutionPlan = planAiExecution(board, {
    kind: 'conversation',
    conversationCardId,
    count,
    delegated,
    turnsPerParticipant: rounds,
  })
  if (!aiExecutionPlan) {
    return {
      admitted: false,
      outcome: { ok: false, reason: 'failed', message: 'errGeneric', artifacts: Object.freeze([]) },
    }
  }
  const providerModelIds = aiExecutionPlan.providerCallManifest.map(
    (occurrence) => occurrence.providerModelId,
  )
  const requestedModel = resolveProfileReviewModel(
    preview.participants[0]?.model || store.settings.model,
  )
  const accessDecision = await resolveEngineAiAccess({
    action: count > 1 ? 'variation' : 'conversation',
    source: delegated ? 'agent-cli' : 'in-app',
    byokCredential: store.settings.apiKey,
    requestedModel,
    providerModelIds,
    executionPlan: aiExecutionPlan,
    localCompletion: localProviderCompletion(store.settings),
  })
  if (!accessDecision.ok) {
    return {
      admitted: false,
      outcome: {
        ...aiAccessFailure(accessDecision),
        artifacts: Object.freeze([]),
      },
    }
  }
  return Object.freeze({
    admitted: true,
    executionBatch: createAiExecutionBatch(accessDecision.grant, aiExecutionPlan),
    rounds,
    visibleTurnsPerVariation: aiExecutionPlan.visibleTurns / count,
  })
}

async function runConversationBatch(
  conversationCardId: string,
  opts: ConversationRunOptions,
  variations: readonly ConversationVariation[],
): Promise<ConversationOutcome> {
  const admission = await admitConversationBatch(conversationCardId, opts, variations.length)
  if (!admission.admitted) return admission.outcome
  let last: ConversationOutcome = {
    ok: false,
    reason: 'failed',
    message: 'errGeneric',
    artifacts: Object.freeze([]),
  }
  try {
    for (const variation of variations) {
      try {
        last = await runConversationVariation(
          conversationCardId,
          { ...opts, ...variation, rounds: admission.rounds },
          {
            executionBatch: admission.executionBatch,
            visibleTurnsPerVariation: admission.visibleTurnsPerVariation,
          },
        )
      } catch (error) {
        await admission.executionBatch.release('failed')
        return {
          ok: false,
          reason: 'failed',
          message: plainError(error),
          artifacts: Object.freeze([]),
        }
      }
      if (!last.ok || last.status === 'canceled') return last
    }
    return last
  } finally {
    await admission.executionBatch.finish()
  }
}

async function runConversationVariation(
  conversationCardId: string,
  opts: ConversationRunOptions,
  batch: Readonly<{
    executionBatch: AiExecutionBatch
    visibleTurnsPerVariation: number
  }>,
): Promise<ConversationOutcome> {
  const store = useGraph.getState()
  const board = store.snapshot()
  if (opts.admittedPlan && !sameConversationPlan(
    opts.admittedPlan,
    planConversationRun(board, conversationCardId),
  )) {
    await batch.executionBatch.release('failed')
    return {
      ok: false,
      reason: 'plan-changed',
      message: 'chainPlanChanged',
      artifacts: Object.freeze([]),
    }
  }
  const preview = resolveConversation(board, conversationCardId)
  if (preview.participants.length === 0) {
    await batch.executionBatch.release('failed')
    return {
      ok: false,
      reason: 'no-participants',
      message: 'errNoParticipants',
      artifacts: Object.freeze([]),
    }
  }
  const rounds = opts.admittedPlan?.turnsPerParticipant
    ?? opts.rounds
    ?? preview.settings.turnsPerParticipant
  const executionBatch = batch.executionBatch
  const stream = opts.stream ?? defaultStream(executionBatch.grant)
  const boundCompactionStream = bindCompletionAccess(
    executionBatch.grant,
    opts.compactionStream,
  )
  const compactionStream: CompletionStream = (instruction, options) => (
    executionBatch.runProvider(
      {
        callClass: 'context-compaction',
        providerModelId: options.model,
      },
      () => boundCompactionStream(instruction, options),
    )
  )

  const defaultModel = resolveProfileReviewModel(store.settings.model)
  const currentProvider = store.settings.provider ?? 'openrouter'
  const isContinue = !!opts.continueInVersionId
  const producingRun = isContinue ? store.graph().runForVersion(opts.continueInVersionId!) : undefined
  if (producingRun && (
    (producingRun.provider ?? 'openrouter') !== currentProvider
    || resolveProfileReviewModel(producingRun.model) !== defaultModel
  )) {
    await batch.executionBatch.release('failed')
    return {
      ok: false,
      reason: 'failed',
      message: 'conversationProviderChanged',
      artifacts: Object.freeze([]),
    }
  }

  const compactionMode = store.settings.compactionMode ?? DEFAULT_COMPACTION_MODE
  const budgetTokensForModel = (model?: string) => budgetFor(
    resolveProfileReviewModel(model || store.settings.model),
    store.settings.provider ?? 'openrouter',
  )

  const controller = new AbortController()
  activeRuns.add(conversationCardId, controller)
  try {
  // Compact weakest-first before dropping: the shared two-pass protocol (ADR 0015)
  // over every participant's over-budget private context — the same passes an Ask
  // run makes, so conversations are never silently truncated.
  let resolved: ResolvedConversation
  try {
    resolved = await compileUnderBudget(
      (summaries) => {
        const pass = resolveConversation(useGraph.getState().snapshot(), conversationCardId, {
          mode: compactionMode,
          summaries,
          budgetTokensForModel,
        })
        const compactionInputs: Record<string, string> = {}
        for (const participant of pass.participants) {
          Object.assign(compactionInputs, participant.privateContext.compactionInputs ?? {})
        }
        return { compiled: pass, compactionInputs }
      },
      {
        stream: compactionStream,
        signal: controller.signal,
      },
    )
    if (opts.admissionGuard && !opts.admissionGuard(Object.freeze([]))) {
      throw new ConversationPlanChanged()
    }
  } catch (error) {
    const cancelled = controller.signal.aborted
    await executionBatch.release(cancelled ? 'cancelled' : 'failed')
    activeRuns.remove(conversationCardId, controller)
    if (error instanceof ConversationPlanChanged) {
      return {
        ok: false,
        reason: 'plan-changed',
        message: 'chainPlanChanged',
        artifacts: Object.freeze([]),
      }
    }
    return cancelled
      ? { ok: true, status: 'canceled', artifacts: Object.freeze([]) }
      : { ok: false, reason: 'failed', message: plainError(error), artifacts: Object.freeze([]) }
  }
  if (resolved.participants.length === 0) {
    await executionBatch.release('failed')
    activeRuns.remove(conversationCardId, controller)
    return {
      ok: false,
      reason: 'no-participants',
      message: 'errNoParticipants',
      artifacts: Object.freeze([]),
    }
  }
  if (resolved.participants.length * rounds !== batch.visibleTurnsPerVariation) {
    await executionBatch.release('failed')
    activeRuns.remove(conversationCardId, controller)
    return {
      ok: false,
      reason: 'plan-changed',
      message: 'chainPlanChanged',
      artifacts: Object.freeze([]),
    }
  }

  const sourceContext = createSourceContextSnapshot(
    board,
    sourceRefsForConversation(conversationCardId, resolved),
  )
  if (opts.admittedPlan && !sameConversationPlan(
    opts.admittedPlan,
    planConversationRun(useGraph.getState().snapshot(), conversationCardId),
  )) {
    await executionBatch.release('failed')
    activeRuns.remove(conversationCardId, controller)
    return {
      ok: false,
      reason: 'plan-changed',
      message: 'chainPlanChanged',
      artifacts: Object.freeze([]),
    }
  }

  const canonicalMods = {
    modIds: resolved.appliedMods.map((mod) => mod.modCardId),
    appliedMods: resolved.appliedMods,
  }

  // Provisional Speaker Names — an existing title, else a positional placeholder —
  // so the Result card and run can be created and shown IMMEDIATELY. The slower
  // name generation happens afterwards, with the card already visible and running.
  const nameByCard = new Map<string, string>()
  const admittedLabels = new Map(opts.admittedPlan?.participants.map((participant) => (
    [participant.cardId, participant.speakerLabel] as const
  )))
  resolved.participants.forEach((p, i) => nameByCard.set(
    p.cardId,
    admittedLabels.get(p.cardId) ?? (p.title.trim() || `Speaker ${i + 1}`),
  ))

  const buildProvenance = (): ConversationProvenance => ({
    settings: resolved.settings,
    participants: resolved.participants.map((p) => ({
      cardId: p.cardId,
      name: nameByCard.get(p.cardId) ?? '',
      model: resolveProfileReviewModel(p.model || defaultModel),
      role: p.role,
      participantMods: p.participantMods,
    })),
    sharedContext: resolved.sharedContext.map((c) => ({
      cardId: c.cardId,
      label: c.label,
      text: c.text,
    })),
    topLevelMods: resolved.topLevelMods,
    turns: [],
  })

  // Create the run up front so the Result card appears instantly in a running
  // state. A fresh Run starts a new version; a continuation extends the existing
  // version in place (one whole conversation = one version).
  let runId: string
  let versionId: string
  let outputId: string | undefined
  let resultCardId: string | undefined
  if (isContinue) {
    const cont = useGraph
      .getState()
      .continueConversationRun(
        conversationCardId,
        opts.continueInVersionId!,
        buildProvenance(),
        sourceContext,
        canonicalMods,
        executionBatch.grant,
      )
    runId = cont.runId
    versionId = cont.versionId
    const located = useGraph.getState().outputs.find((output) => (
      output.versions.some((version) => version.id === versionId)
    ))
    outputId = located?.id
    resultCardId = located?.resultCardId
  } else {
    const usedCardIds = new Set<string>()
    for (const p of resolved.participants) {
      usedCardIds.add(p.cardId)
      for (const id of p.privateContext.usedCardIds) usedCardIds.add(id)
    }
    for (const c of resolved.sharedContext) usedCardIds.add(c.cardId)
    for (const c of resolved.alreadyExplored) usedCardIds.add(c.cardId)
    for (const m of resolved.topLevelMods) usedCardIds.add(m.cardId)
    const usedConnectionIds = new Set(
      incomingConnections(board, conversationCardId).map((c) => c.id),
    )
    for (const p of resolved.participants) {
      for (const id of p.privateContext.usedConnectionIds) usedConnectionIds.add(id)
    }
    const begun = useGraph.getState().beginConversationRun(conversationCardId, {
      model: defaultModel,
      usedCardIds: [...usedCardIds],
      usedConnectionIds: [...usedConnectionIds],
      ...canonicalMods,
      conversation: buildProvenance(),
      seedTranscript: [],
      sourceContext,
      contextBudget: resolved.contextBudget,
      triggeredBy: opts.triggeredBy,
      aiAccessPhases: [executionBatch.grant],
    })
    runId = begun.runId
    versionId = begun.versionId
    outputId = begun.outputId
    resultCardId = begun.resultCardId
  }

  const artifacts: readonly AgentRunArtifactReference[] = Object.freeze([
    Object.freeze({ kind: 'run-record' as const, recordId: runId, cardId: conversationCardId }),
    ...(outputId && resultCardId
      ? [Object.freeze({
          kind: 'output-version' as const,
          recordId: versionId,
          outputId,
          versionId,
          cardId: resultCardId,
        })]
      : []),
  ])

  // A continuation opens with the user's message, outside the scheduled turn order.
  if (opts.leadingUserMessage?.trim()) {
    useGraph.getState().appendTranscriptMessage(versionId, userMessage(opts.leadingUserMessage))
  }

  // Now generate any MISSING Speaker Names (the slow part). Keep an existing title;
  // otherwise generate one, save it back to the card title, and refresh provenance.
  let generatedAny = false
  const generateName = opts.generateSpeakerName
    ?? ((participant: ResolvedParticipant) => defaultGenerateSpeakerName(
      participant,
      executionBatch.grant,
      defaultModel,
      controller.signal,
    ))
  if (!opts.triggeredBy) {
    for (let i = 0; i < resolved.participants.length; i++) {
      const participant = resolved.participants[i]
      if (participant.title.trim()) continue
      const fallback = `Speaker ${i + 1}`
      let name = fallback
      try {
        name = cleanSpeakerName(await executionBatch.runProvider(
          { callClass: 'speaker-name', providerModelId: defaultModel },
          () => generateName(participant),
        ), fallback)
      } catch {
        name = fallback
      }
      nameByCard.set(participant.cardId, name)
      // Never overwrite a user-authored title (only untitled cards reach here).
      useGraph.getState().setCardTitle(participant.cardId, name)
      generatedAny = true
    }
  }
  if (generatedAny) {
    useGraph.getState().updateConversationProvenance(runId, {
      participants: buildProvenance().participants,
    })
  }

  const wasCanceledBeforeTurns =
    useGraph.getState().runs.find((run) => run.id === runId)?.status === 'canceled'
  if (wasCanceledBeforeTurns) {
    await executionBatch.release('cancelled')
    activeRuns.remove(conversationCardId, controller)
    return { ok: true, versionId, status: 'canceled', artifacts }
  }

  const priorTurns: Record<string, number> = {}
  for (const p of resolved.participants) {
    priorTurns[p.cardId] = participantTurnCount(currentTranscript(versionId), p.cardId)
  }
  const plan = planConversationTurns(
    resolved.participants.map((p) => p.cardId),
    { rounds, priorTurns },
  )

    for (const turn of plan) {
      if (isRunCanceled(runId, controller.signal)) {
        useGraph.getState().cancelConversationRun(runId)
        await executionBatch.release('cancelled')
        return { ok: true, versionId, status: 'canceled', artifacts }
      }

      if (opts.admissionGuard && !opts.admissionGuard(artifacts)) {
        useGraph.getState().failConversationRun(runId, 'chainPlanChanged')
        await executionBatch.release('failed')
        return {
          ok: false,
          reason: 'plan-changed',
          message: 'chainPlanChanged',
          artifacts,
        }
      }

      const participant = resolved.participants.find((p) => p.cardId === turn.participantCardId)!
      const speakerName = nameByCard.get(participant.cardId) ?? 'Speaker'

      const instruction = buildTurnPrompt({
        settings: resolved.settings,
        participant,
        speakerName,
        sharedContext: resolved.sharedContext,
        alreadyExplored: resolved.alreadyExplored,
        topLevelMods: resolved.topLevelMods,
        // Read the live transcript so Interjections sent mid-run are seen next turn.
        transcript: currentTranscript(versionId),
        turn,
      })

      const message = startParticipantMessage({
        participantCardId: participant.cardId,
        speakerName,
        turnNumber: turn.currentTurn,
      })
      useGraph.getState().appendTranscriptMessage(versionId, message)
      useGraph.getState().recordConversationTurn(runId, {
        speakerName,
        participantCardId: participant.cardId,
        currentTurn: turn.currentTurn,
        totalTurns: turn.totalTurns,
        instruction,
      })

      const providerModelId = resolveProfileReviewModel(
        participant.model || defaultModel,
      )
      try {
        await executionBatch.runProvider(
          { callClass: 'visible-reply', providerModelId },
          () => stream(instruction, {
            model: providerModelId,
            assets: [...participant.assets, ...resolved.sharedAssets, ...resolved.alreadyExploredAssets],
            variationNote: opts.variationNote,
            temperature: opts.temperature,
            signal: controller.signal,
            onChunk: (chunk) =>
              useGraph.getState().appendTranscriptChunk(versionId, message.id, chunk),
          }),
        )
      } catch (err) {
        if (isRunCanceled(runId, controller.signal)) {
          useGraph.getState().cancelConversationRun(runId)
          await executionBatch.release('cancelled')
          return { ok: true, versionId, status: 'canceled', artifacts }
        }
        useGraph.getState().failConversationRun(runId, plainError(err))
        await executionBatch.release('failed')
        return {
          ok: false,
          reason: 'failed',
          message: plainError(err),
          artifacts,
        }
      }

      if (isRunCanceled(runId, controller.signal)) {
        useGraph.getState().cancelConversationRun(runId)
        await executionBatch.release('cancelled')
        return { ok: true, versionId, status: 'canceled', artifacts }
      }

      useGraph.getState().finishTranscriptMessage(versionId, message.id)
      const completed = await executionBatch.completeOutput()
      if (!completed) {
        useGraph.getState().failConversationRun(
          runId,
          'errGeneric',
        )
        await executionBatch.release('failed')
        return { ok: false, reason: 'failed', message: 'errGeneric', artifacts }
      }
    }

    useGraph.getState().finishConversationRun(runId)
    return { ok: true, versionId, status: 'done', artifacts }
  } finally {
    activeRuns.remove(conversationCardId, controller)
  }
}

const CONVERSATION_VARIATION_NOTES = [
  'Run this conversation in a focused, fairly conventional way.',
  'Run this conversation from a different angle; surface less obvious tensions or options.',
  'Run this conversation more boldly and exploratorily, while still respecting the topic and context.',
]

/** Trusted Agent Conversation seam. Speaker labels and turn count come from
 * admission; Eido supplies every provider-facing execution setting. */
export async function runAgentConversation(
  conversationCardId: string,
  options: AgentConversationRunOptions,
): Promise<ConversationOutcome> {
  if (!Number.isSafeInteger(options.variationIndex)
    || !Number.isSafeInteger(options.variationCount)
    || options.variationCount < 1
    || options.variationCount > AGENT_RUN_VARIATION_LIMITS.maxCount
    || options.variationIndex < 1
    || options.variationIndex > options.variationCount) {
    return {
      ok: false,
      reason: 'plan-changed',
      message: 'chainPlanChanged',
      artifacts: Object.freeze([]),
    }
  }
  const ordinal = options.variationIndex - 1
  return runConversation(conversationCardId, {
    admittedPlan: options.admittedPlan,
    admissionGuard: options.admissionGuard ?? (() => true),
    triggeredBy: options.triggeredBy,
    stream: options.stream,
    compactionStream: options.compactionStream,
    ...(options.mode === 'variations' ? {
      variationNote: CONVERSATION_VARIATION_NOTES[
        Math.min(ordinal, CONVERSATION_VARIATION_NOTES.length - 1)
      ],
      temperature: Math.min(2, 0.5 + ordinal * 0.25),
    } : {}),
  })
}

export async function makeConversationVariations(
  conversationCardId: string,
  n = 3,
  opts: Pick<ConversationRunOptions, 'stream' | 'generateSpeakerName'> = {},
): Promise<ConversationOutcome> {
  const variations = Array.from({ length: n }, (_, index) => ({
    variationNote: CONVERSATION_VARIATION_NOTES[
      Math.min(index, CONVERSATION_VARIATION_NOTES.length - 1)
    ],
    temperature: 0.5 + index * 0.25,
  }))
  return runConversationBatch(conversationCardId, opts, variations)
}

function currentTranscript(versionId: string) {
  return useGraph.getState().graph().versionById(versionId)?.version.transcript ?? []
}

function sameConversationPlan(
  admitted: ConversationExecutionPlan,
  current: ConversationExecutionPlan | undefined,
): boolean {
  return current !== undefined && JSON.stringify(current) === JSON.stringify(admitted)
}
