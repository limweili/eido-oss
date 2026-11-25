// The execution layer seam (ADR 0013): what will run, over which cards, in what
// order — derived from the graph as plain data BEFORE anything runs. Today's
// runs are single-visible-step plans (plus digest-refresh steps they depend on);
// multi-hop chains are longer plans of the same shape, not a new system.
// Plans stay lean: IDs and policy names, never copied card content.
// See docs/foundations/execution-layer.md.

import {
  boardAiSettingsOf,
  DEFAULT_BOARD_AI_PROVIDER,
  DEFAULT_BOARD_AI_REASONING_EFFORT,
} from '../graph/boardAiSettings'
import { CONNECTED_THOUGHT_POLICY, gatherContext } from '../graph/contextQuery'
import { cardById, membersOf, producingAskFor, resultCardFor } from '../graph/graphHelpers'
import {
  DEFAULT_COMPACTION_MODE,
  type ExecutionPlanRecord,
  type ExecutionStepRecord,
  type SavedBoard,
} from '../graph/types'
import { resolveProfileReviewModel } from '../shared/profileReviewPolicy'
import { stableContentHash } from '../shared/stableHash'
import { gatherConnectedThought } from './compiler'
import { resolveConversation } from './conversationCompiler'
import {
  compactionModelForBoard,
  validCachedSummaries,
} from './contextCompaction'
import {
  groupDigestCacheKey,
  groupDigestInput,
  isDigestCurrent,
} from './groupDigestFreshness'
import { budgetFor } from './modelWindows'

// The plan types live in graph/types.ts (the persistence layer records plans
// on runs, #139); these aliases keep the execution vocabulary local.
// Step ids are deterministic within a plan (derived from what the step is,
// not random), so the same graph yields the same plan — explainable data.
export type ExecutionStep = ExecutionStepRecord
export type ExecutionPlan = ExecutionPlanRecord

/** Provider-neutral admission quantities for one user action. Visible turns
 * measure visible replies; provider calls include every hidden helper
 * that must be budgeted before the action starts. */
export type AiExecutionPlan = Readonly<{
  version: 1
  visibleTurns: number
  providerCalls: number
  /** Ordered provider occurrences checked against the live graph before egress. */
  providerCallManifest: readonly AiProviderCallManifestItem[]
}>

export type AiProviderCallClass =
  | 'visible-reply'
  | 'follow-up'
  | 'group-digest'
  | 'context-compaction'
  | 'speaker-name'

export type AiProviderCallManifestItem = Readonly<{
  callClass: AiProviderCallClass
  providerModelId: string
  /** A reserved helper slot may be skipped when runtime content proves it is
   * unnecessary. It still contributes to the maximum providerCalls reserved
   * before execution. Visible replies are never optional. */
  optional?: true
}>

export type AiExecutionAction =
  | Readonly<{ kind: 'ask'; askAiCardId: string }>
  | Readonly<{
      kind: 'chain'
      targetAskAiCardId: string
      /** Exact stale/forced Ask batch selected by chain admission. */
      askAiCardIds: readonly string[]
    }>
  | Readonly<{
      kind: 'conversation'
      conversationCardId: string
      count?: number
      /** Exact rounds this invocation will execute. Continuations override the
       * Card default without changing the saved Conversation definition. */
      turnsPerParticipant?: number
      /** Delegated execution already carries stable labels and makes no naming call. */
      delegated?: boolean
    }>
  | Readonly<{
      kind: 'variations'
      askAiCardId: string
      count: number
      /** Exact serial Ask occurrences: stale prefix followed by each target variation. */
      askAiCardIds: readonly string[]
    }>
  | Readonly<{ kind: 'followUp'; providerModelId: string }>
  | Readonly<{ kind: 'groupCompression'; groupCardId: string }>
  | Readonly<{ kind: 'modComposed' }>

/** Agent admission uses this lean, ephemeral Conversation plan. It is not a
 * durable RunRecord plan: the fingerprint guards renderer execution drift,
 * while participant labels and turn counts make spend derivable before run. */
export type ConversationExecutionPlan = Readonly<{
  version: 1
  rootCardId: string
  targetKind: 'conversation'
  participants: readonly Readonly<{
    cardId: string
    speakerLabel: string
  }>[]
  turnsPerParticipant: number
  totalTurns: number
  fingerprint: string
}>

/** Effective Idea-wide execution envelope. Values are hashed into delegated
 * admission fingerprints; the plain prompt never enters an execution plan. */
export function boardExecutionEnvelope(board: SavedBoard): Readonly<{
  provider: string
  defaultModel: string
  systemPrompt: string
  reasoningEffort: string
  compactionMode: string
}> {
  // Read through the settings envelope, never off the raw bag (ADR 0040). The
  // persistence validator checks `aiSettings` for its container shape only, so
  // a rung or a provider name from a build this one has never met reaches here
  // intact; hashing it into an admission fingerprint would describe a run this
  // build cannot actually make. The envelope substitutes this build's
  // documented defaults, which is what the run will really send.
  const settings = boardAiSettingsOf(board)
  return Object.freeze({
    provider: settings?.provider ?? DEFAULT_BOARD_AI_PROVIDER,
    defaultModel: effectiveExecutionModel(board),
    systemPrompt: settings?.systemPrompt ?? '',
    reasoningEffort: settings?.reasoningEffort ?? DEFAULT_BOARD_AI_REASONING_EFFORT,
    compactionMode: settings?.compactionMode ?? DEFAULT_COMPACTION_MODE,
  })
}

// Same rule, and one crash. `models` used to be guaranteed a non-empty string
// array by the persistence validator, so `models[0]` was safe; since the bag
// became an envelope a Board on disk may carry no `models` at all, and the bare
// index threw. `boardAiSettingsOf` marks `model` and `models` required for
// exactly this reason: the shape callers dereference always has them.
export function effectiveExecutionModel(board: SavedBoard, cardModel?: string): string {
  const settings = boardAiSettingsOf(board)
  return resolveProfileReviewModel(
    cardModel?.trim()
      || settings?.model?.trim()
      || settings?.models[0]?.trim()
      || '',
  )
}

// Derive the plan for running an Ask AI card: first make every compressed group
// digest it consumes current, then run the ask over its connected thought.
export function planAskRun(board: SavedBoard, askAiCardId: string): ExecutionPlan {
  const selection = gatherContext(board, askAiCardId, CONNECTED_THOUGHT_POLICY)

  const digestSteps: ExecutionStep[] = selection.entries
    .filter((entry) => entry.groupMode === 'compress')
    .map((entry) => ({
      id: `digest:${entry.connectionId}`,
      kind: 'groupDigest' as const,
      cardId: entry.cardId,
      dependsOn: [],
      connectionId: entry.connectionId,
    }))

  const askStep: ExecutionStep = {
    id: `ask:${askAiCardId}`,
    kind: 'ask',
    cardId: askAiCardId,
    dependsOn: digestSteps.map((step) => step.id),
    contextPolicy: selection.policy,
  }

  return { version: 1, rootCardId: askAiCardId, steps: [...digestSteps, askStep] }
}

export function groupDigestSteps(plan: ExecutionPlan): ExecutionStep[] {
  return plan.steps.filter((step) => step.kind === 'groupDigest')
}

export function askSteps(plan: ExecutionPlan): ExecutionStep[] {
  return plan.steps.filter((step) => step.kind === 'ask')
}

// Derive the chain plan for an Ask AI card: every upstream Ask AI whose result
// feeds this card's context runs first, in dependency order, so each step sees
// fresh upstream results. Ask B depends on ask A when A's result card is in
// B's context selection — the graph is the spec (ADR 0013).
//
// Cycles cannot happen in a well-formed board (a result feeds forward), but a
// hand-wired loop must not hang the planner: a back-edge into a card already
// being visited is dropped, so the plan stays acyclic and executable.
//
// Steps are emitted dependencies-first, so plan.steps is already a valid
// execution order. Digest-refresh steps are not enumerated here; each ask
// step's execution expands its own digest refreshes (see planAskRun).
export function planChainRun(board: SavedBoard, targetAskAiCardId: string): ExecutionPlan {
  const steps: ExecutionStep[] = []
  const planned = new Map<string, string>()
  const visiting = new Set<string>()

  const visit = (askCardId: string): string | undefined => {
    const existing = planned.get(askCardId)
    if (existing) return existing
    if (visiting.has(askCardId)) return undefined
    visiting.add(askCardId)

    const selection = gatherContext(board, askCardId, CONNECTED_THOUGHT_POLICY)
    const dependsOn: string[] = []
    for (const entry of selection.entries) {
      if (cardById(board, entry.cardId)?.kind !== 'result') continue
      const producer = producingAskFor(board, entry.cardId)
      if (!producer) continue
      const producerStepId = visit(producer.id)
      if (producerStepId && !dependsOn.includes(producerStepId)) dependsOn.push(producerStepId)
    }

    visiting.delete(askCardId)
    const stepId = `ask:${askCardId}`
    planned.set(askCardId, stepId)
    steps.push({
      id: stepId,
      kind: 'ask',
      cardId: askCardId,
      dependsOn,
      contextPolicy: selection.policy,
    })
    return stepId
  }

  if (cardById(board, targetAskAiCardId)?.kind === 'askAi') visit(targetAskAiCardId)
  return { version: 1, rootCardId: targetAskAiCardId, steps }
}

/** Resolve a Conversation with the same compiler seam the ordinary runner
 * uses. Untitled participants receive stable positional labels here; delegated
 * execution must consume these labels without a naming model call or Card-title
 * mutation. */
export function planConversationRun(
  board: SavedBoard,
  conversationCardId: string,
): ConversationExecutionPlan | undefined {
  if (cardById(board, conversationCardId)?.kind !== 'conversation') return undefined
  const resolved = resolveConversation(board, conversationCardId)
  const participants = Object.freeze(resolved.participants.map((participant, index) => (
    Object.freeze({
      cardId: participant.cardId,
      speakerLabel: participant.title.trim() || `Speaker ${index + 1}`,
    })
  )))
  const turnsPerParticipant = resolved.settings.turnsPerParticipant
  const fingerprint = `conversation:${stableContentHash({
    executionEnvelope: boardExecutionEnvelope(board),
    settings: resolved.settings,
    participants: resolved.participants.map((participant) => ({
      cardId: participant.cardId,
      title: participant.title,
      model: effectiveExecutionModel(board, participant.model),
      role: participant.role,
      privateContext: participant.privateContext.text,
      usedCardIds: participant.privateContext.usedCardIds,
      usedConnectionIds: participant.privateContext.usedConnectionIds,
      participantMods: participant.participantMods,
      assets: participant.assets,
    })),
    sharedContext: resolved.sharedContext,
    alreadyExplored: resolved.alreadyExplored.map((entry) => ({
      cardId: entry.cardId,
      connectionId: entry.connectionId,
      relation: entry.relation,
      text: entry.text,
      groupMode: entry.groupMode,
    })),
    topLevelMods: resolved.topLevelMods,
    appliedMods: resolved.appliedMods,
    sharedAssets: resolved.sharedAssets,
    alreadyExploredAssets: resolved.alreadyExploredAssets,
  })}`
  return Object.freeze({
    version: 1,
    rootCardId: conversationCardId,
    targetKind: 'conversation',
    participants,
    turnsPerParticipant,
    totalTurns: participants.length * turnsPerParticipant,
    fingerprint,
  })
}

/**
 * Count one complete action before execution without choosing a provider or
 * mutating the Board. Mods only shape another action's prompt, so the Mod-only
 * shape carries no independent visible turn or provider call.
 */
export function planAiExecution(
  board: SavedBoard,
  action: AiExecutionAction,
): AiExecutionPlan | undefined {
  switch (action.kind) {
    case 'ask':
      return planAskBatch(board, [action.askAiCardId])
    case 'chain':
      if (cardById(board, action.targetAskAiCardId)?.kind !== 'askAi') return undefined
      return planAskBatch(board, action.askAiCardIds)
    case 'conversation': {
      const plan = planConversationRun(board, action.conversationCardId)
      const count = action.count ?? 1
      const turnsPerParticipant = action.turnsPerParticipant ?? plan?.turnsPerParticipant
      if (!plan || !validBatchCount(count) || !validBatchCount(turnsPerParticipant ?? 0)) {
        return undefined
      }
      const visibleTurns = plan.participants.length * turnsPerParticipant! * count
      const compactionCalls = uncachedConversationContextCompactionCount(
        board,
        action.conversationCardId,
      )
      const manifest = conversationProviderCallManifest(
        board,
        action.conversationCardId,
        count,
        turnsPerParticipant!,
        Boolean(action.delegated),
        compactionCalls,
      )
      return aiExecutionPlan(visibleTurns, manifest)
    }
    case 'variations':
      if (!validBatchCount(action.count)
        || action.askAiCardIds.filter((cardId) => cardId === action.askAiCardId).length
          !== action.count) return undefined
      return planAskBatch(board, action.askAiCardIds)
    case 'followUp':
      return aiExecutionPlan(1, [{
        callClass: 'follow-up',
        providerModelId: resolveProfileReviewModel(action.providerModelId),
      }])
    case 'groupCompression': {
      const group = cardById(board, action.groupCardId)
      if (!group || group.kind !== 'group') return undefined
      return groupDigestInput(board, group, membersOf(board, group.id))
        ? aiExecutionPlan(0, [{
            callClass: 'group-digest',
            providerModelId: effectiveExecutionModel(board, group.model),
          }])
        : undefined
    }
    case 'modComposed':
      return aiExecutionPlan(0, [])
  }
}

function conversationProviderCallManifest(
  board: SavedBoard,
  conversationCardId: string,
  count: number,
  turnsPerParticipant: number,
  delegated: boolean,
  compactionCalls: number,
): readonly AiProviderCallManifestItem[] {
  const resolved = resolveConversation(board, conversationCardId)
  const defaultModel = effectiveExecutionModel(board)
  const participantModels = resolved.participants.map((participant) => (
    resolveProfileReviewModel(participant.model || defaultModel)
  ))
  const manifest: AiProviderCallManifestItem[] = []
  for (let variation = 0; variation < count; variation += 1) {
    manifest.push(...Array.from({ length: compactionCalls }, (): AiProviderCallManifestItem => (
      Object.freeze({
        callClass: 'context-compaction',
        providerModelId: compactionModelForBoard(board),
        optional: true,
      })
    )))
    if (variation === 0 && !delegated) {
      manifest.push(...resolved.participants
        .filter((participant) => !participant.title.trim())
        .map((): AiProviderCallManifestItem => Object.freeze({
          callClass: 'speaker-name',
          providerModelId: defaultModel,
          optional: true,
        })))
    }
    const visibleTurns = resolved.participants.length * turnsPerParticipant
    manifest.push(...Array.from({ length: visibleTurns }, (_, index): AiProviderCallManifestItem => (
      Object.freeze({
        callClass: 'visible-reply',
        providerModelId: participantModels[index % participantModels.length]!,
      })
    )))
  }
  return Object.freeze(manifest)
}

function planAskBatch(
  board: SavedBoard,
  askAiCardIds: readonly string[],
): AiExecutionPlan | undefined {
  if (askAiCardIds.length === 0
    || askAiCardIds.some((cardId) => cardById(board, cardId)?.kind !== 'askAi')) {
    return undefined
  }
  const plans = askAiCardIds.map((cardId) => planAskRun(board, cardId))
  const compactionCalls = conservativeAskCompactionCounts(board, plans)
  const providerGenerations = new Map<string, number>()
  const refreshedGroupGenerations = new Map<string, string>()
  const manifest: AiProviderCallManifestItem[] = []

  for (const [index, plan] of plans.entries()) {
    const seenGroups = new Set<string>()
    for (const step of groupDigestSteps(plan)) {
      if (seenGroups.has(step.cardId)) continue
      seenGroups.add(step.cardId)
      const group = cardById(board, step.cardId)
      if (!group || group.kind !== 'group') continue
      const members = membersOf(board, group.id)
      if (!groupDigestInput(board, group, members)) continue
      const model = effectiveExecutionModel(board, group.model)
      const producerIds = members.flatMap((member) => {
        if (member.kind !== 'result') return []
        const producer = producingAskFor(board, member.id)
        return producer ? [producer.id] : []
      })
      const generation = producerIds
        .map((producerId) => `${producerId}:${providerGenerations.get(producerId) ?? 0}`)
        .join('|')
      const refreshedGeneration = refreshedGroupGenerations.get(group.id)
      const output = board.outputs.find((candidate) => candidate.resultCardId === group.id)
      const key = groupDigestCacheKey(board, group, members, model)
      const invalidatedByEarlierAsk = producerIds.some((producerId) => (
        (providerGenerations.get(producerId) ?? 0) > 0
      ))
      const needsRefresh = refreshedGeneration === undefined
        ? invalidatedByEarlierAsk || !isDigestCurrent(output, key)
        : refreshedGeneration !== generation
      if (needsRefresh) {
        manifest.push(Object.freeze({
          callClass: 'group-digest',
          providerModelId: model,
        }))
        refreshedGroupGenerations.set(group.id, generation)
      }
    }

    manifest.push(...Array.from(
      { length: compactionCalls[index] ?? 0 },
      (): AiProviderCallManifestItem => Object.freeze({
        callClass: 'context-compaction',
        providerModelId: effectiveExecutionModel(board),
        optional: true,
      }),
    ))
    const ask = cardById(board, plan.rootCardId)
    manifest.push(Object.freeze({
      callClass: 'visible-reply',
      providerModelId: resolveProfileReviewModel(
        ask?.model || effectiveExecutionModel(board),
      ),
    }))
    providerGenerations.set(
      plan.rootCardId,
      (providerGenerations.get(plan.rootCardId) ?? 0) + 1,
    )
  }

  return aiExecutionPlan(askAiCardIds.length, manifest)
}

/** Count compaction attempts for each serial Ask occurrence. The changed set
 * makes the reservation conservative when an earlier Ask or Group refresh can
 * replace a short context entry with arbitrarily large provider output. */
function conservativeAskCompactionCounts(
  board: SavedBoard,
  plans: readonly ExecutionPlan[],
): readonly number[] {
  const compactionModel = compactionModelForBoard(board)
  const settings = boardAiSettingsOf(board)
  const compactionMode = settings?.compactionMode ?? DEFAULT_COMPACTION_MODE
  const changedContextCardIds = new Set<string>()
  const groupCurrent = new Map<string, boolean>()
  const groupMemberIds = new Map<string, ReadonlySet<string>>()
  const groupIds = new Set(plans.flatMap((plan) => groupDigestSteps(plan)
    .map((step) => step.cardId)))

  for (const groupId of groupIds) {
    const group = cardById(board, groupId)
    if (!group || group.kind !== 'group') continue
    const members = membersOf(board, groupId)
    if (!groupDigestInput(board, group, members)) continue
    const model = effectiveExecutionModel(board, group.model)
    groupCurrent.set(groupId, isDigestCurrent(
      board.outputs.find((candidate) => candidate.resultCardId === groupId),
      groupDigestCacheKey(board, group, members, model),
    ))
    groupMemberIds.set(groupId, new Set(members.map((member) => member.id)))
  }

  return plans.map((plan) => {
    for (const groupId of new Set(groupDigestSteps(plan).map((step) => step.cardId))) {
      if (groupCurrent.get(groupId) === false) {
        changedContextCardIds.add(groupId)
        groupCurrent.set(groupId, true)
      }
    }

    const ask = cardById(board, plan.rootCardId)
    const model = effectiveExecutionModel(board, ask?.model)
    const compiled = gatherConnectedThought(board, plan.rootCardId, {
      budgetTokens: budgetFor(model, settings?.provider ?? DEFAULT_BOARD_AI_PROVIDER),
      mode: compactionMode,
      summaries: new Map(),
    })
    const inputs = compiled.compactionInputs ?? {}
    const cached = validCachedSummaries(board, inputs, compactionModel)
    const candidates = new Set(Object.keys(inputs))
    if (compactionMode !== 'never') {
      for (const entry of compiled.preview.context) {
        if (changedContextCardIds.has(entry.cardId)) candidates.add(entry.cardId)
      }
    }
    const count = [...candidates].filter((cardId) => (
      changedContextCardIds.has(cardId) || !cached.has(cardId)
    )).length

    const producedResultId = resultCardFor(board, plan.rootCardId)?.id
    if (producedResultId) {
      changedContextCardIds.add(producedResultId)
      for (const [groupId, memberIds] of groupMemberIds) {
        if (!memberIds.has(producedResultId)) continue
        changedContextCardIds.add(groupId)
        groupCurrent.set(groupId, false)
      }
    }
    return count
  })
}

function uncachedConversationContextCompactionCount(
  board: SavedBoard,
  conversationCardId: string,
): number {
  const settings = boardAiSettingsOf(board)
  const resolved = resolveConversation(board, conversationCardId, {
    mode: settings?.compactionMode ?? DEFAULT_COMPACTION_MODE,
    summaries: new Map(),
    budgetTokensForModel: (candidate) => budgetFor(
      effectiveExecutionModel(board, candidate),
      settings?.provider ?? DEFAULT_BOARD_AI_PROVIDER,
    ),
  })
  const inputs: Record<string, string> = {}
  for (const participant of resolved.participants) {
    Object.assign(inputs, participant.privateContext.compactionInputs ?? {})
  }
  const cached = validCachedSummaries(board, inputs, compactionModelForBoard(board))
  return Object.keys(inputs).filter((cardId) => !cached.has(cardId)).length
}

function aiExecutionPlan(
  visibleTurns: number,
  providerCallManifest: readonly AiProviderCallManifestItem[],
): AiExecutionPlan {
  return Object.freeze({
    version: 1,
    visibleTurns,
    providerCalls: providerCallManifest.length,
    providerCallManifest: Object.freeze([...providerCallManifest]),
  })
}

function validBatchCount(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}
