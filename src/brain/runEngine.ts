// The run engine (Concept 5): run a card, produce versioned outputs, record what
// happened. Single run first; variations next. Richer playback (chaining,
// personas, debate) is designed-for but built later — the graph stays the spec.

import { useGraph } from '../graph/store'
import { cardById, membersOf } from '../graph/graphHelpers'
import type { ResultPlacementContext } from '../graph/resultCardPlacement'
import { DEFAULT_COMPACTION_MODE } from '../graph/types'
import type { AgentRunAttribution, Card, RunRecord, SavedBoard } from '../graph/types'
import { resolveProfileReviewModel } from '../shared/profileReviewPolicy'
import { gatherConnectedThought, type CompiledInstruction } from './compiler'
import {
  AGENT_RUN_VARIATION_LIMITS,
  type AgentRunArtifactReference,
} from './agentRunContract'
import { budgetFor } from './modelWindows'
import { chainStepStatuses } from './chainStaleness'
import {
  askSteps,
  groupDigestSteps,
  planAiExecution,
  planAskRun,
  planChainRun,
  type AiProviderCallClass,
  type AiProviderCallManifestItem,
  type ExecutionPlan,
} from './executionPlan'
import {
  buildGroupDigestInstruction,
  chosenDigestVersion,
  groupDigestCacheKey,
  groupDigestInput,
  groupRelationshipConnectionIds,
  isDigestCurrent,
} from './groupDigestFreshness'
import {
  bindCompletionAccess,
  type CompletionStream as ProviderCompletionStream,
} from './openRouter'
import {
  aiAccessFailure,
  resolveEngineAiAccess,
  type AiAccessFailure,
} from './aiAccess'
import {
  createAiExecutionBatch,
  type AiExecutionBatch,
} from './aiExecutionBatch'
import { localProviderCompletion } from './aiProvider'
import type { RunToolStep } from './agenticRun'
import { compileUnderBudget, createAbortRegistry, isRunCanceled, plainError } from './runLifecycle'
import { researchDepthOf } from './researchDepth'
import { researchJobOf } from './researchJobMeta'
import { reachModeOf, type ReachMode } from './reachMode'
import { eidoWebToolSetFor, resumeResearchJob } from './webTools'
import {
  createSourceContextSnapshot,
  sourceRefsForCompiled,
  type SourceContextRef,
} from './sourceContext'

export type RunOutcome =
  | {
      ok: true
      status: 'done'
      versionId: string
      artifacts: readonly AgentRunArtifactReference[]
    }
  | {
      ok: true
      status: 'canceled'
      /** Present only when the Ask itself began. A canceled prerequisite
       * digest is represented exclusively by its exact artifact identities. */
      versionId?: string
      artifacts: readonly AgentRunArtifactReference[]
    }
  | {
      ok: false
      reason: 'no-key' | 'no-connections' | 'plan-changed' | 'failed'
      message: string
      artifacts: readonly AgentRunArtifactReference[]
    }
  | (AiAccessFailure & Readonly<{
      artifacts: readonly AgentRunArtifactReference[]
    }>)

export type CompletionStream = ProviderCompletionStream

type RunOptions = {
  variationNote?: string
  temperature?: number
  stream?: CompletionStream
  // Set by runChain on the target step: the chain plan to record on the run
  // (#139). Single runs record nothing extra.
  chainPlan?: ExecutionPlan
  resultPlacementContext?: ResultPlacementContext
  triggeredBy?: AgentRunAttribution
  admittedPlan?: ExecutionPlan
  /** Trusted delegated-execution hook. It is evaluated at the engine seam
   * immediately before every prerequisite/main provider call; the supplied
   * references are exact durable artifacts created by this Run so its caller
   * can mask only expected mutations while detecting every other edit. */
  admissionGuard?: (inFlightArtifacts: readonly AgentRunArtifactReference[]) => boolean
}

type AdmittedRunOptions = RunOptions & Readonly<{
  /** Private engine capability; exported entry points can never accept it. */
  executionBatch: AiExecutionBatch
}>

export type AgentAskVariationOptions = Readonly<{
  admittedPlan: ExecutionPlan
  chainPlan: ExecutionPlan
  admissionGuard: (inFlightArtifacts: readonly AgentRunArtifactReference[]) => boolean
  triggeredBy: AgentRunAttribution
  variationIndex: number
  variationCount: number
  /** Internal true-external port used by the delegated executor's test adapter. */
  stream?: CompletionStream
}>

type StreamRunOptions = {
  stream: CompletionStream
  executionBatch: AiExecutionBatch
  controller: AbortController
  triggeredBy?: AgentRunAttribution
  admissionGuard?: () => boolean
}

class CanceledRun extends Error {
  constructor(readonly artifacts: readonly AgentRunArtifactReference[]) {
    super('canceled')
  }
}

class FailedRun extends Error {
  constructor(
    readonly detail: unknown,
    readonly artifacts: readonly AgentRunArtifactReference[],
  ) {
    super('failed')
  }
}

class PlanChangedRun extends Error {
  constructor(readonly artifacts: readonly AgentRunArtifactReference[] = Object.freeze([])) {
    super('plan-changed')
  }
}

// Active stream controllers per source card. Group compression can be registered
// under both the parent Ask AI card and the Group card, so either Cancel button can
// stop the same network stream.
const activeRuns = createAbortRegistry()

function runKind(run: RunRecord): NonNullable<RunRecord['kind']> {
  return run.kind ?? 'ask'
}

function runningAiRuns(cardId: string): RunRecord[] {
  return useGraph
    .getState()
    .runs.filter((run) => run.askAiCardId === cardId && run.status === 'running' && runKind(run) !== 'conversation')
}

function throwIfCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw new CanceledRun(Object.freeze([]))
}

export function cancelAiRun(cardId: string): void {
  activeRuns.abort(cardId)
  for (const run of runningAiRuns(cardId)) {
    useGraph.getState().cancelRun(run.id)
  }
}

function assetsForCards(cards: Card[]) {
  return cards.flatMap((card) =>
    (card.assets ?? []).map((asset) => ({
      kind: asset.kind,
      name: asset.name,
      mimeType: asset.mimeType,
      dataUrl: asset.dataUrl,
    })),
  )
}

function hasExecutionBatch(options: RunOptions | AdmittedRunOptions): options is AdmittedRunOptions {
  return 'executionBatch' in options
}

type BegunRunIdentity = Readonly<{
  runId: string
  versionId: string
  outputId: string
  resultCardId: string
}>

function durableArtifacts(
  identity: BegunRunIdentity,
  sourceCardId: string,
): readonly AgentRunArtifactReference[] {
  const artifacts: AgentRunArtifactReference[] = []
  if (useGraph.getState().runs.some((run) => run.id === identity.runId)) {
    artifacts.push(Object.freeze({
      kind: 'run-record',
      recordId: identity.runId,
      cardId: sourceCardId,
    }))
  }
  const output = useGraph.getState().outputs.find((candidate) => candidate.id === identity.outputId)
  if (output?.versions.some((version) => version.id === identity.versionId)) {
    artifacts.push(Object.freeze({
      kind: 'output-version',
      recordId: identity.versionId,
      outputId: identity.outputId,
      versionId: identity.versionId,
      cardId: identity.resultCardId,
    }))
  }
  return Object.freeze(artifacts)
}
// The core loop: compile the connected thinking, stream a completion into a new
// version, and close out the run with full provenance.
export async function runCard(
  askAiCardId: string,
  opts: RunOptions = {},
): Promise<RunOutcome> {
  return runCardWithAccess(askAiCardId, opts)
}

async function runCardWithAccess(
  askAiCardId: string,
  opts: RunOptions | AdmittedRunOptions,
): Promise<RunOutcome> {
  const store = useGraph.getState()
  const { apiKey, reasoningEffort, systemPrompt = '' } = store.settings
  let prerequisiteArtifacts: readonly AgentRunArtifactReference[] = Object.freeze([])
  const admissionIsCurrent = (): boolean => (
    opts.admissionGuard?.(prerequisiteArtifacts) ?? true
  )


  // Per-card model wins; the global setting is just the default for unset cards.
  const askCard = store.cards.find((c) => c.id === askAiCardId)
  const model = resolveProfileReviewModel(askCard?.model || store.settings.model)

  const controller = new AbortController()
  activeRuns.add(askAiCardId, controller)

  // Derive the plan first (ADR 0013): digest-refresh steps, then the ask step.
  const plan = planAskRun(useGraph.getState().snapshot(), askAiCardId)
  if (opts.admittedPlan && JSON.stringify(opts.admittedPlan) !== JSON.stringify(plan)) {
    if (hasExecutionBatch(opts)) await opts.executionBatch.release('failed')
    activeRuns.remove(askAiCardId, controller)
    return {
      ok: false,
      reason: 'plan-changed',
      message: 'chainPlanChanged',
      artifacts: Object.freeze([]),
    }
  }

  const ownsExecutionBatch = !hasExecutionBatch(opts)
  let executionBatch: AiExecutionBatch
  if (hasExecutionBatch(opts)) {
    executionBatch = opts.executionBatch
  } else {
    const aiExecutionPlan = planAiExecution(store.snapshot(), {
      kind: 'ask',
      askAiCardId,
    })
    const providerModelIds = aiExecutionPlan?.providerCallManifest.map(
      (occurrence) => occurrence.providerModelId,
    )
    const accessRequest = aiExecutionPlan && providerModelIds
      ? Object.freeze({
          action: (opts.variationNote === undefined ? 'ask' : 'variation') as 'ask' | 'variation',
          source: (opts.triggeredBy ? 'agent-cli' : 'in-app') as 'agent-cli' | 'in-app',
          byokCredential: apiKey,
          requestedModel: model,
          providerModelIds,
          executionPlan: aiExecutionPlan,
          localCompletion: localProviderCompletion(store.settings),
        })
      : undefined
    const accessDecision = accessRequest
      ? await resolveEngineAiAccess(accessRequest)
      : undefined
    if (!accessDecision?.ok) {
      activeRuns.remove(askAiCardId, controller)
      return accessDecision
        ? { ...aiAccessFailure(accessDecision), artifacts: Object.freeze([]) }
        : { ok: false, reason: 'failed', message: 'errGeneric', artifacts: Object.freeze([]) }
    }
    executionBatch = createAiExecutionBatch(accessDecision.grant, aiExecutionPlan!)
  }
  const stream = bindCompletionAccess(executionBatch.grant, opts.stream)
  const finishOwnedBatch = async (): Promise<void> => {
    if (ownsExecutionBatch) await executionBatch.finish()
  }
  const terminalize = async (outcome: 'failed' | 'cancelled'): Promise<void> => {
    await executionBatch.release(outcome)
    await finishOwnedBatch()
  }

  let usedGroupDigests: RunRecord['usedGroupDigests'] = []
  try {
    const prerequisites = await ensureCompressedGroups(plan, {
      stream,
      executionBatch,
      controller,
      triggeredBy: opts.triggeredBy,
      admissionGuard: admissionIsCurrent,
    })
    usedGroupDigests = prerequisites.usedGroupDigests
    prerequisiteArtifacts = prerequisites.artifacts
  } catch (err) {
    activeRuns.remove(askAiCardId, controller)
    if (err instanceof PlanChangedRun) {
      return {
        ok: false,
        reason: 'plan-changed',
        message: 'chainPlanChanged',
        artifacts: err.artifacts,
      }
    }
    if (err instanceof CanceledRun) {
      await terminalize('cancelled')
      return { ok: true, status: 'canceled', artifacts: err.artifacts }
    }
    if (controller.signal.aborted) {
      await terminalize('cancelled')
      return { ok: true, status: 'canceled', artifacts: prerequisiteArtifacts }
    }
    if (err instanceof FailedRun) {
      await terminalize('failed')
      return { ok: false, reason: 'failed', message: plainError(err.detail), artifacts: err.artifacts }
    }
    await terminalize('failed')
    return { ok: false, reason: 'failed', message: plainError(err), artifacts: prerequisiteArtifacts }
  }

  // Compile under the context budget: the shared two-pass protocol (ADR 0015).
  // Mode 'never' still plans — it drops with a note instead of compacting, so it
  // reports no compaction inputs and the first pass stands.
  // An Agentic Run lets the model call tools while it thinks. The Card asks
  // for it; who executes them depends on what exists (#961): with a Linkup
  // key the executors built here ride into the completion boundary, which
  // runs the loop itself, declaring what the Card's reach mode allows.
  // Without one, nothing is passed and the provider's own server tools run
  // exactly as before. On a local harness the bridge carries a prompt and
  // nothing else, so the set is simply never read.
  const agentic = askCard?.agentic === true
  const reachArmed = agentic
  const armedReachMode: ReachMode | null = reachArmed ? reachModeOf(askCard) : null
  // The research hooks stash the job id in card.meta from the vendor's
  // acknowledgement until the run consumes a terminal state (#963). A
  // research job cannot be cancelled once submitted, so the id must survive
  // a quit mid-poll: card.meta persists immediately and is the one Card
  // surface an older build carries without reading. A cancel or a crash
  // leaves the stash standing on purpose; only a delivered report or a
  // vendor-declared failure, which is not charged, clears it.
  //
  // The depth beside the hooks is the user's, read from the Card (#971): the
  // press that started this run chose it, it persists per Card, and a Card
  // never asked runs at S, the cheapest.
  const eidoTools = armedReachMode
    ? eidoWebToolSetFor(store.settings, armedReachMode, {
        depth: researchDepthOf(askCard),
        hooks: {
          onSubmitted: (jobId) => useGraph.getState().recordCardResearchJob(askAiCardId, jobId),
          onSettled: () => useGraph.getState().clearCardResearchJob(askAiCardId),
        },
      })
    : undefined

  let prepared: Readonly<{
    compiled: CompiledInstruction
    runId: string
    versionId: string
    outputId: string
    resultCardId: string
  }>
  try {
    const compactionMode = store.settings.compactionMode ?? DEFAULT_COMPACTION_MODE
    const fullBudget = budgetFor(model, store.settings.provider ?? 'openrouter')
    const budgetTokens = eidoTools
      ? Math.max(fullBudget - eidoTools.promptReserveTokens, Math.ceil(fullBudget / 2))
      : fullBudget
    let board = useGraph.getState().snapshot()
    const compiled: CompiledInstruction = await compileUnderBudget(
      (summaries) => {
        board = useGraph.getState().snapshot()
        const pass = gatherConnectedThought(board, askAiCardId, {
          budgetTokens,
          mode: compactionMode,
          summaries,
        })
        return {
          compiled: pass,
          compactionInputs:
            pass.budget?.compactedCardIds.length && pass.compactionInputs ? pass.compactionInputs : {},
        }
      },
      {
        stream: batchCompletionStream(executionBatch, 'context-compaction', stream),
        signal: controller.signal,
      },
    )
    if (!admissionIsCurrent()) throw new PlanChangedRun()
    const sourceContext = createSourceContextSnapshot(
      board,
      sourceRefsForCompiled(askAiCardId, compiled),
    )
    const begun = store.beginRun(askAiCardId, {
      // Nothing is appended after the compile. The compiled instruction is
      // exactly what is sent, so "same graph, same instruction" holds without
      // qualification (ADR 0033).
      text: compiled.text,
      model,
      usedCardIds: compiled.usedCardIds,
      usedConnectionIds: compiled.usedConnectionIds,
      usedGroupDigests,
      modIds: compiled.modIds,
      appliedMods: compiled.appliedMods,
      sourceContext,
      contextBudget: compiled.budget,
      plan: opts.chainPlan,
      resultPlacementContext: opts.resultPlacementContext,
      triggeredBy: opts.triggeredBy,
      // Follow-ups inherit the reach requested by this run.
      ...(reachArmed ? { agentic: true as const } : {}),
      aiAccessPhases: [executionBatch.grant],
    })
    prepared = {
      compiled,
      runId: begun.runId,
      versionId: begun.versionId,
      outputId: begun.outputId,
      resultCardId: begun.resultCardId,
    }
  } catch (err) {
    activeRuns.remove(askAiCardId, controller)
    const cancelled = err instanceof CanceledRun || controller.signal.aborted
    await terminalize(cancelled ? 'cancelled' : 'failed')
    return cancelled
      ? { ok: true, status: 'canceled', artifacts: prerequisiteArtifacts }
      : { ok: false, reason: 'failed', message: plainError(err), artifacts: prerequisiteArtifacts }
  }
  const { compiled, runId, versionId, outputId, resultCardId } = prepared
  const runIdentity: BegunRunIdentity = { runId, versionId, outputId, resultCardId }

  const visibleReply = (): Promise<string> => executionBatch.runProvider(
    providerOccurrence('visible-reply', model),
    () => stream(compiled.text, {
      model,
      reasoningEffort,
      systemPrompt,
      assets: compiled.assets,
      variationNote: opts.variationNote,
      temperature: opts.temperature,
      signal: controller.signal,
      ...(reachArmed ? { agentic: true } : {}),
      ...(eidoTools
        ? {
            eidoTools,
            // Prose streamed between tool calls is not the answer (#961).
            // The loop says so, and the streaming version restarts clean;
            // the trail keeps narrating what is happening in the meantime.
            onAnswerRestart: () => {
              if (!isRunCanceled(runId, controller.signal)) {
                useGraph.getState().resetVersionText(versionId)
              }
            },
          }
        : {}),
      onChunk: (chunk) => {
        if (!isRunCanceled(runId, controller.signal)) {
          useGraph.getState().appendVersionText(versionId, chunk)
        }
      },
      ...(reachArmed
        ? {
            onToolStep: (step: RunToolStep) => {
              if (!isRunCanceled(runId, controller.signal)) {
                useGraph.getState().recordRunToolStep(runId, step)
              }
            },
          }
        : {}),
    }),
  )

  try {
    throwIfCanceled(controller.signal)
    await visibleReply()
    if (isRunCanceled(runId, controller.signal)) {
      useGraph.getState().cancelRun(runId)
      await terminalize('cancelled')
      return {
        ok: true,
        status: 'canceled',
        versionId,
        artifacts: Object.freeze([...prerequisiteArtifacts, ...durableArtifacts(runIdentity, askAiCardId)]),
      }
    }
    const completed = await executionBatch.completeOutput()
    if (!completed) {
      useGraph.getState().failRun(runId, 'AI returned no durable visible output')
      await terminalize('failed')
      return {
        ok: false,
        reason: 'failed',
        message: 'errGeneric',
        artifacts: Object.freeze([...prerequisiteArtifacts, ...durableArtifacts(runIdentity, askAiCardId)]),
      }
    }
    useGraph.getState().finishRun(runId)
    await finishOwnedBatch()
    return {
      ok: true,
      status: 'done',
      versionId,
      artifacts: Object.freeze([...prerequisiteArtifacts, ...durableArtifacts(runIdentity, askAiCardId)]),
    }
  } catch (err) {
    if (isRunCanceled(runId, controller.signal)) {
      useGraph.getState().cancelRun(runId)
      await terminalize('cancelled')
      return {
        ok: true,
        status: 'canceled',
        versionId,
        artifacts: Object.freeze([...prerequisiteArtifacts, ...durableArtifacts(runIdentity, askAiCardId)]),
      }
    }
    useGraph.getState().failRun(runId, plainError(err))
    await terminalize('failed')
    return {
      ok: false,
      reason: 'failed',
      message: plainError(err),
      artifacts: Object.freeze([...prerequisiteArtifacts, ...durableArtifacts(runIdentity, askAiCardId)]),
    }
  } finally {
    activeRuns.remove(askAiCardId, controller)
  }
}

function providerOccurrence(
  callClass: AiProviderCallClass,
  providerModelId: string,
): AiProviderCallManifestItem {
  return Object.freeze({ callClass, providerModelId })
}

function batchCompletionStream(
  executionBatch: AiExecutionBatch,
  callClass: AiProviderCallClass,
  stream: CompletionStream,
): CompletionStream {
  return (instruction, options) => executionBatch.runProvider(
    providerOccurrence(callClass, options.model),
    () => stream(instruction, options),
  )
}

// Re-attach to a paid research job whose id is standing in card.meta (#971).
// A cancel, a crash, or a quit mid-poll left a job running and billing on the
// vendor's side with no run listening; this run listens again. It never
// submits: no compile, no model call, no new spend. It polls the standing job
// out and lands the vendor's own cited report as a version, which is honest,
// because the vendor's synthesis is the product that was bought and the model
// that would have rewritten it never saw the report. Cancel here stops the
// listening exactly as it did on the original run, and keeps the stash so the
// next Resume can try again; only a terminal state the poll consumed, the
// report delivered or the vendor declaring the job failed, clears it.
export async function resumeResearchRun(
  askAiCardId: string,
  opts: { resultPlacementContext?: ResultPlacementContext } = {},
): Promise<RunOutcome> {
  const store = useGraph.getState()
  const askCard = store.cards.find((c) => c.id === askAiCardId)
  const job = researchJobOf(askCard)
  if (!askCard || !job) {
    return { ok: false, reason: 'failed', message: 'errGeneric', artifacts: Object.freeze([]) }
  }
  const model = resolveProfileReviewModel(askCard.model || store.settings.model)

  const controller = new AbortController()
  activeRuns.add(askAiCardId, controller)

  // The run record is real so Cancel, the state word, and the Result Card
  // behave exactly as on any run. Its compiled instruction is empty because
  // nothing was compiled and nothing was sent to a model: recording the
  // Card's text would claim a prompt that never ran.
  const begun = store.beginRun(askAiCardId, {
    text: '',
    model,
    usedCardIds: [],
    usedConnectionIds: [],
    modIds: [],
    appliedMods: [],
    resultPlacementContext: opts.resultPlacementContext,
    agentic: true,
  })
  const { runId, versionId } = begun

  try {
    const resumed = await resumeResearchJob(useGraph.getState().settings, job.id, {
      signal: controller.signal,
      onSettled: () => useGraph.getState().clearCardResearchJob(askAiCardId),
    })
    if (isRunCanceled(runId, controller.signal) || resumed.status === 'canceled') {
      useGraph.getState().cancelRun(runId)
      return {
        ok: true,
        status: 'canceled',
        versionId,
        artifacts: durableArtifacts(begun, askAiCardId),
      }
    }
    if (resumed.status === 'failed') {
      useGraph.getState().failRun(runId, resumed.messageKey)
      return {
        ok: false,
        reason: 'failed',
        message: resumed.messageKey,
        artifacts: durableArtifacts(begun, askAiCardId),
      }
    }
    // The trail line first, then the answer, the order a normal research run
    // lands in. The step carries no instruction because the original query
    // was never persisted; the trail's own words cover a step that cannot
    // name what it looked for.
    useGraph.getState().recordRunToolStep(runId, { kind: 'research', detail: '' })
    useGraph.getState().appendVersionText(versionId, resumed.answerText)
    useGraph.getState().finishRun(runId)
    return {
      ok: true,
      status: 'done',
      versionId,
      artifacts: durableArtifacts(begun, askAiCardId),
    }
  } catch (err) {
    if (isRunCanceled(runId, controller.signal)) {
      useGraph.getState().cancelRun(runId)
      return {
        ok: true,
        status: 'canceled',
        versionId,
        artifacts: durableArtifacts(begun, askAiCardId),
      }
    }
    useGraph.getState().failRun(runId, plainError(err))
    return {
      ok: false,
      reason: 'failed',
      message: plainError(err),
      artifacts: durableArtifacts(begun, askAiCardId),
    }
  } finally {
    activeRuns.remove(askAiCardId, controller)
  }
}

export type ChainStepOutcome = {
  stepId: string
  cardId: string
  outcome: RunOutcome
}

export type ChainRunOptions = RunOptions & {
  // Explicit "re-run everything": execute the full plan unconditionally.
  everything?: boolean
  // A press on an Ask card is a request for a new answer, even when its
  // source fingerprint is still current. Upstream steps remain stale-only.
  rerunTarget?: boolean
  admission?: ChainRunAdmission
}

export type ChainRunAdmission = Readonly<{
  plan: ExecutionPlan
  plannedStepIds: readonly string[]
  askPlans: readonly Readonly<{
    stepId: string
    plan: ExecutionPlan
  }>[]
}>

export type ChainOutcome =
  // 'fresh': nothing was stale, so nothing ran and nothing was spent.
  | { ok: true; status: 'done' | 'canceled' | 'fresh'; steps: ChainStepOutcome[]; reusedStepIds: string[] }
  | {
      ok: false
      reason: 'no-key' | 'empty-plan' | 'plan-changed' | 'failed'
      message: string
      steps: ChainStepOutcome[]
      reusedStepIds: string[]
      failedStepId?: string
    }
  | (AiAccessFailure & Readonly<{
      steps: ChainStepOutcome[]
      reusedStepIds: string[]
      failedStepId?: string
    }>)

// While a chain runs, the streaming step may be a different card than the one
// the user pressed Run on — its Cancel button must still stop the whole chain,
// not just whatever happens to be streaming. One entry per chain target.
const activeChains = new Map<string, { currentCardId: string; canceled: boolean }>()

export function cancelChain(targetAskAiCardId: string): void {
  const chain = activeChains.get(targetAskAiCardId)
  if (!chain) return
  chain.canceled = true
  cancelAiRun(chain.currentCardId)
}

// Chain runs heal stale upstream steps (ADR 0014) and can force the pressed
// target to create another version. The plan (ADR 0013) says what could run;
// the stale filter says what upstream steps must run — steps that never
// produced a result, whose recorded sources changed, or whose upstream re-ran.
// Fresh upstream steps are reused.
// Each executed step is a normal runCard: its own RunRecord, streaming,
// cancel, and its result re-enters the graph, which is exactly how the next
// step sees it fresh. Failure halts the chain loudly, keeping completed
// results; pressing Run again IS resume, because the stale filter skips what
// already succeeded. Cancel stops after the current step, keeping its partial
// text provisional. There is no step cap — the confirm gate (#137) is the
// only guard.
export async function runChain(
  targetAskAiCardId: string,
  opts: ChainRunOptions = {},
): Promise<ChainOutcome> {
  const board = useGraph.getState().snapshot()
  const plan = planChainRun(board, targetAskAiCardId)
  const steps: ChainStepOutcome[] = []

  if (opts.admission && JSON.stringify(opts.admission.plan) !== JSON.stringify(plan)) {
    return { ok: false, reason: 'plan-changed', message: 'chainPlanChanged', steps, reusedStepIds: [] }
  }

  if (!askSteps(plan).length) {
    return { ok: false, reason: 'empty-plan', message: 'errGeneric', steps, reusedStepIds: [] }
  }

  const statuses = chainStepStatuses(board, plan)
  const stepsToRun = opts.everything
    ? askSteps(plan)
    : statuses
        .filter((status) => status.willRun || (opts.rerunTarget && status.step.cardId === targetAskAiCardId))
        .map((status) => status.step)
  const stepIdsToRun = new Set(stepsToRun.map((step) => step.id))
  const reusedStepIds = statuses
    .filter((status) => !stepIdsToRun.has(status.step.id))
    .map((status) => status.step.id)

  if (opts.admission && !sameIds(opts.admission.plannedStepIds, stepsToRun.map((step) => step.id))) {
    return { ok: false, reason: 'plan-changed', message: 'chainPlanChanged', steps, reusedStepIds }
  }
  if (opts.admission && !sameAskPlans(
    opts.admission.askPlans,
    stepsToRun.map((step) => ({
      stepId: step.id,
      plan: planAskRun(board, step.cardId),
    })),
  )) {
    return { ok: false, reason: 'plan-changed', message: 'chainPlanChanged', steps, reusedStepIds }
  }

  if (!stepsToRun.length) {
    return { ok: true, status: 'fresh', steps, reusedStepIds }
  }

  const aiExecutionPlan = planAiExecution(board, {
    kind: 'chain',
    targetAskAiCardId,
    askAiCardIds: stepsToRun.map((step) => step.cardId),
  })
  const providerModelIds = aiExecutionPlan?.providerCallManifest.map(
    (occurrence) => occurrence.providerModelId,
  )
  const firstAsk = cardById(board, stepsToRun[0].cardId)
  const requestedModel = resolveProfileReviewModel(
    firstAsk?.model || useGraph.getState().settings.model,
  )
  const accessDecision = aiExecutionPlan && providerModelIds
    ? await resolveEngineAiAccess({
        action: 'chain',
        source: opts.triggeredBy ? 'agent-cli' : 'in-app',
        byokCredential: useGraph.getState().settings.apiKey,
        requestedModel,
        providerModelIds,
        executionPlan: aiExecutionPlan,
        localCompletion: localProviderCompletion(useGraph.getState().settings),
      })
    : undefined
  if (!accessDecision?.ok) {
    return accessDecision
      ? { ...aiAccessFailure(accessDecision), steps, reusedStepIds }
      : { ok: false, reason: 'failed', message: 'errGeneric', steps, reusedStepIds }
  }
  const executionBatch = createAiExecutionBatch(accessDecision.grant, aiExecutionPlan!)

  const chain = { currentCardId: stepsToRun[0].cardId, canceled: false }
  const completedArtifacts: AgentRunArtifactReference[] = []
  activeChains.set(targetAskAiCardId, chain)
  try {
    for (const step of stepsToRun) {
      if (chain.canceled) {
        await executionBatch.release('cancelled')
        return { ok: true, status: 'canceled', steps, reusedStepIds }
      }
      chain.currentCardId = step.cardId
      // The target step carries the whole chain plan into provenance (#139).
      const isTarget = step.cardId === targetAskAiCardId
      const admittedPlan = opts.admission?.askPlans.find((candidate) => (
        candidate.stepId === step.id
      ))?.plan
      const admissionGuard = opts.admissionGuard
        ? (currentStepArtifacts: readonly AgentRunArtifactReference[]) => opts.admissionGuard!(Object.freeze([
            ...completedArtifacts,
            ...currentStepArtifacts,
          ]))
        : undefined
      const outcome = await runCardWithAccess(step.cardId, isTarget
        ? { ...opts, chainPlan: plan, admittedPlan, admissionGuard, executionBatch }
        : { ...opts, admittedPlan, admissionGuard, executionBatch })
      steps.push({ stepId: step.id, cardId: step.cardId, outcome })

      completedArtifacts.push(...outcome.artifacts)

      if (!outcome.ok) {
        return {
          ok: false,
          reason: outcome.reason === 'no-key'
            ? 'no-key'
            : outcome.reason === 'plan-changed'
              ? 'plan-changed'
              : 'failed',
          message: outcome.message,
          steps,
          reusedStepIds,
          failedStepId: step.id,
        }
      }
      if (outcome.status === 'canceled') {
        return { ok: true, status: 'canceled', steps, reusedStepIds }
      }
    }

    return { ok: true, status: 'done', steps, reusedStepIds }
  } finally {
    await executionBatch.finish()
    activeChains.delete(targetAskAiCardId)
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function sameAskPlans(
  left: ChainRunAdmission['askPlans'],
  right: ChainRunAdmission['askPlans'],
): boolean {
  return left.length === right.length && left.every((candidate, index) => (
    candidate.stepId === right[index]?.stepId
    && JSON.stringify(candidate.plan) === JSON.stringify(right[index]?.plan)
  ))
}

// Execute the plan's digest-refresh steps: make every compressed group digest
// the ask consumes current, skipping digests that are already fresh.
async function ensureCompressedGroups(
  plan: ExecutionPlan,
  opts: StreamRunOptions,
): Promise<Readonly<{
  usedGroupDigests: NonNullable<RunRecord['usedGroupDigests']>
  artifacts: readonly AgentRunArtifactReference[]
}>> {
  const used: { groupCardId: string; versionId: string; connectionId: string }[] = []
  const artifacts: AgentRunArtifactReference[] = []
  const seen = new Set<string>()

  for (const step of groupDigestSteps(plan)) {
    throwIfCanceled(opts.controller.signal)
    const board = useGraph.getState().snapshot()
    const group = cardById(board, step.cardId)
    if (!group || group.kind !== 'group') continue
    const members = membersOf(board, group.id)
    const groupModel = resolveProfileReviewModel(
      group.model || useGraph.getState().settings.model,
    )
    const cacheKey = groupDigestCacheKey(board, group, members, groupModel)
    const output = board.outputs.find((o) => o.resultCardId === group.id)

    if (!isDigestCurrent(output, cacheKey) && !seen.has(group.id)) {
      seen.add(group.id)
      const input = groupDigestInput(board, group, members)
      if (!input) continue
      let digest: Awaited<ReturnType<typeof createGroupDigestVersion>>
      try {
        digest = await createGroupDigestVersion(board, group, members, groupModel, cacheKey, opts)
      } catch (error) {
        if (error instanceof PlanChangedRun) {
          throw new PlanChangedRun(Object.freeze([...artifacts, ...error.artifacts]))
        }
        if (error instanceof FailedRun) {
          throw new FailedRun(error.detail, Object.freeze([...artifacts, ...error.artifacts]))
        }
        throw error
      }
      artifacts.push(...digest.artifacts)
      if (digest.status === 'canceled') throw new CanceledRun(Object.freeze([...artifacts]))
    }

    const freshBoard = useGraph.getState().snapshot()
    const freshOutput = freshBoard.outputs.find((o) => o.resultCardId === group.id)
    const digestVersion = chosenDigestVersion(freshOutput)
    if (digestVersion && step.connectionId) {
      used.push({ groupCardId: group.id, versionId: digestVersion.id, connectionId: step.connectionId })
    }
  }

  return Object.freeze({
    usedGroupDigests: used,
    artifacts: Object.freeze(artifacts),
  })
}

export async function runGroupCompression(
  groupCardId: string,
  opts: { stream?: CompletionStream } = {},
): Promise<RunOutcome> {
  const store = useGraph.getState()
  const { apiKey } = store.settings
  const controller = new AbortController()

  const board = store.snapshot()
  const group = cardById(board, groupCardId)
  if (!group || group.kind !== 'group') {
    return { ok: false, reason: 'failed', message: 'errGeneric', artifacts: Object.freeze([]) }
  }

  const members = membersOf(board, group.id)
  const input = groupDigestInput(board, group, members)
  if (!input) {
    return {
      ok: false,
      reason: 'no-connections',
      message: 'groupNoMembers',
      artifacts: Object.freeze([]),
    }
  }

  const model = resolveProfileReviewModel(group.model || store.settings.model)
  const executionPlan = planAiExecution(board, { kind: 'groupCompression', groupCardId })
  if (!executionPlan) {
    return { ok: false, reason: 'failed', message: 'errGeneric', artifacts: Object.freeze([]) }
  }
  const accessDecision = await resolveEngineAiAccess({
    action: 'group-compression',
    source: 'in-app',
    byokCredential: apiKey,
    requestedModel: model,
    providerModelIds: executionPlan.providerCallManifest.map(
      (occurrence) => occurrence.providerModelId,
    ),
    executionPlan,
    localCompletion: localProviderCompletion(store.settings),
  })
  if (!accessDecision.ok) {
    return { ...aiAccessFailure(accessDecision), artifacts: Object.freeze([]) }
  }
  const executionBatch = createAiExecutionBatch(accessDecision.grant, executionPlan)
  const stream = bindCompletionAccess(executionBatch.grant, opts.stream)
  const cacheKey = groupDigestCacheKey(board, group, members, model)

  try {
    const digest = await createGroupDigestVersion(board, group, members, model, cacheKey, {
      stream,
      executionBatch,
      controller,
    })
    if (digest.status === 'canceled') {
      await executionBatch.release('cancelled')
      await executionBatch.finish()
      return {
        ok: true,
        status: 'canceled',
        versionId: digest.versionId,
        artifacts: digest.artifacts,
      }
    }
    await executionBatch.finish()
    return {
      ok: true,
      status: 'done',
      versionId: digest.versionId,
      artifacts: digest.artifacts,
    }
  } catch (err) {
    const cancelled = err instanceof CanceledRun || controller.signal.aborted
    await executionBatch.release(cancelled ? 'cancelled' : 'failed')
    await executionBatch.finish()
    if (cancelled) {
      return {
        ok: true,
        status: 'canceled',
        artifacts: err instanceof CanceledRun ? err.artifacts : Object.freeze([]),
      }
    }
    if (controller.signal.aborted) {
      return { ok: true, status: 'canceled', artifacts: Object.freeze([]) }
    }
    if (err instanceof FailedRun) {
      return { ok: false, reason: 'failed', message: plainError(err.detail), artifacts: err.artifacts }
    }
    return { ok: false, reason: 'failed', message: plainError(err), artifacts: Object.freeze([]) }
  }
}

async function createGroupDigestVersion(
  board: SavedBoard,
  group: Card,
  members: Card[],
  model: string,
  cacheKey: string,
  opts: StreamRunOptions,
): Promise<Readonly<{
  status: 'done' | 'canceled'
  versionId: string
  artifacts: readonly AgentRunArtifactReference[]
}>> {
  const instruction = buildGroupDigestInstruction(board, group, members)
  const sourceRefs: SourceContextRef[] = [
    { cardId: group.id },
    ...members.map((member) => ({ cardId: member.id })),
  ]
  if (opts.admissionGuard && !opts.admissionGuard()) throw new PlanChangedRun()
  activeRuns.add(group.id, opts.controller)
  const begun = useGraph.getState().beginGroupDigestRun(group.id, {
    text: instruction,
    model,
    usedCardIds: members.map((member) => member.id),
    usedConnectionIds: groupRelationshipConnectionIds(board, members),
    digestKey: cacheKey,
    triggeredBy: opts.triggeredBy,
    sourceContext: createSourceContextSnapshot(board, sourceRefs),
  })
  const { runId, versionId } = begun
  try {
    throwIfCanceled(opts.controller.signal)
    await opts.executionBatch.runProvider(
      providerOccurrence('group-digest', model),
      () => opts.stream(instruction, {
        model,
        reasoningEffort: useGraph.getState().settings.reasoningEffort,
        systemPrompt: useGraph.getState().settings.systemPrompt ?? '',
        assets: assetsForCards(members),
        temperature: 0.2,
        signal: opts.controller.signal,
        onChunk: (chunk) => {
          if (!isRunCanceled(runId, opts.controller.signal)) {
            useGraph.getState().appendVersionText(versionId, chunk)
          }
        },
      }),
    )
    if (isRunCanceled(runId, opts.controller.signal)) {
      useGraph.getState().cancelRun(runId)
      return {
        status: 'canceled',
        versionId,
        artifacts: durableArtifacts(begun, group.id),
      }
    }
    useGraph.getState().finishRun(runId)
    return { status: 'done', versionId, artifacts: durableArtifacts(begun, group.id) }
  } catch (err) {
    if (isRunCanceled(runId, opts.controller.signal)) {
      useGraph.getState().cancelRun(runId)
      return {
        status: 'canceled',
        versionId,
        artifacts: durableArtifacts(begun, group.id),
      }
    }
    useGraph.getState().failRun(runId, plainError(err))
    throw new FailedRun(err, durableArtifacts(begun, group.id))
  } finally {
    activeRuns.remove(group.id, opts.controller)
  }
}

// "Autofill for thought" (Concept 5): run the same compiled instruction a few times
// with light variation framing, producing a small stack of versions the user picks
// between. A stack you choose from — never a wall you read.
const VARIATION_NOTES = [
  'Give a focused, fairly conventional take.',
  'Take a different angle from the obvious one; surface a less expected option.',
  'Be bolder and more exploratory; favour the uncommon idea, while still respecting the connected requirements.',
]

/** Trusted Agent variation seam. The caller selects only the admitted ordinal;
 * Eido owns the framing, temperature, model, key, prompt, and persistence. */
export async function runAgentVariation(
  askAiCardId: string,
  options: AgentAskVariationOptions,
): Promise<RunOutcome> {
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
  return runCard(askAiCardId, {
    admittedPlan: options.admittedPlan,
    chainPlan: options.chainPlan,
    admissionGuard: options.admissionGuard,
    triggeredBy: options.triggeredBy,
    stream: options.stream,
    variationNote: VARIATION_NOTES[Math.min(ordinal, VARIATION_NOTES.length - 1)],
    temperature: Math.min(2, 0.5 + ordinal * 0.25),
  })
}

export async function makeVariations(
  askAiCardId: string,
  n = 3,
  opts: Readonly<{ stream?: CompletionStream }> = {},
): Promise<RunOutcome> {
  const board = useGraph.getState().snapshot()
  const executionPlan = planAiExecution(board, {
    kind: 'variations',
    askAiCardId,
    count: n,
    askAiCardIds: Array.from({ length: n }, () => askAiCardId),
  })
  const ask = cardById(board, askAiCardId)
  const requestedModel = resolveProfileReviewModel(
    ask?.model || useGraph.getState().settings.model,
  )
  const providerModelIds = executionPlan?.providerCallManifest.map(
    (occurrence) => occurrence.providerModelId,
  )
  const accessDecision = executionPlan && providerModelIds
    ? await resolveEngineAiAccess({
        action: 'variation',
        source: 'in-app',
        byokCredential: useGraph.getState().settings.apiKey,
        requestedModel,
        providerModelIds,
        executionPlan,
        localCompletion: localProviderCompletion(useGraph.getState().settings),
      })
    : undefined
  if (!accessDecision?.ok) {
    return accessDecision
      ? { ...aiAccessFailure(accessDecision), artifacts: Object.freeze([]) }
      : { ok: false, reason: 'failed', message: 'errGeneric', artifacts: Object.freeze([]) }
  }
  const executionBatch = createAiExecutionBatch(accessDecision.grant, executionPlan!)
  const admittedPlan = planAskRun(board, askAiCardId)
  let last: RunOutcome = {
    ok: false,
    reason: 'failed',
    message: 'errGeneric',
    artifacts: Object.freeze([]),
  }
  try {
    for (let i = 0; i < n; i++) {
      const note = VARIATION_NOTES[Math.min(i, VARIATION_NOTES.length - 1)]
      const temperature = 0.5 + i * 0.25
      last = await runCardWithAccess(askAiCardId, {
        ...opts,
        admittedPlan,
        executionBatch,
        variationNote: note,
        temperature,
      })
      if (!last.ok || last.status === 'canceled') return last
    }
    return last
  } finally {
    await executionBatch.finish()
  }
}
