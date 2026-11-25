import type {
  AgentRunAdmissionSuccess,
  AgentRunExecutionRequest,
} from './agentRunSession'
import { planAgentRunAdmission } from './agentRunSession'
import type {
  AgentRunActor,
  AgentRunArtifactReference,
  AgentRunTerminalStatus,
} from './agentRunContract'
import {
  cancelAiRun,
  runAgentVariation,
  runCard,
  type CompletionStream,
  type RunOutcome,
} from './runEngine'
import {
  cancelConversation,
  runAgentConversation,
  type ConversationOutcome,
  type ConversationStream,
} from './conversationRunner'
import type { SavedBoard } from '../graph/types'

export type AgentRunExecutorFailure =
  | 'live-required'
  | 'idea-not-live'
  | 'plan-changed'
  | 'credential-unavailable'
  | 'execution-failed'

export type AgentRunExecutorOutcome = Readonly<{
  status: AgentRunTerminalStatus
  executedStepIds: readonly string[]
  reusedStepIds: readonly string[]
  artifacts: readonly AgentRunArtifactReference[]
  failure?: AgentRunExecutorFailure
}>

export type AgentRunExecutor = Readonly<{
  execute(request: AgentRunExecutionRequest): Promise<AgentRunExecutorOutcome>
  cancelActive(): void
}>

export type AgentRunExecutorOptions = Readonly<{
  readLiveBoard(): Readonly<{ ideaId: string | null; board: SavedBoard }>
  isLive(): boolean
  /** True external ports. Production omits them and uses Eido's providers. */
  askStream?: CompletionStream
  conversationStream?: ConversationStream
  compactionStream?: CompletionStream
}>

type OwnedAdmissionChange = Readonly<{
  outputId: string
  runId: string
  versionSnapshot: string
  runSnapshot: string
}>

type MutableOwnedArtifactIdentity = Readonly<{
  outputId: string
  runId: string
  versionId: string
}>

/**
 * Executes one admitted Agent schedule. This is the only module that knows how
 * a stale Ask prefix, repeated targets, cancellation, live guards, and exact
 * artifact provenance compose. Callers own neither step decoding nor graph
 * reconstruction.
 */
export function createAgentRunExecutor(options: AgentRunExecutorOptions): AgentRunExecutor {
  let active: Readonly<{ kind: 'ask' | 'conversation'; cardId: string }> | undefined

  return Object.freeze({
    execute,
    cancelActive(): void {
      if (!active) return
      if (active.kind === 'conversation') cancelConversation(active.cardId)
      else cancelAiRun(active.cardId)
    },
  })

  async function execute(request: AgentRunExecutionRequest): Promise<AgentRunExecutorOutcome> {
    const authorityFailure = liveFailure(request)
    if (authorityFailure) return failed(authorityFailure)

    const baseline = options.readLiveBoard()
    if (!sameAdmission(request.admission, baseline.board, request.ideaId, request.targetCardId)) {
      return failed('plan-changed')
    }

    const baselineOutputs = new Map(baseline.board.outputs.map((output) => [output.id, output]))
    const ownedChanges = new Map<string, OwnedAdmissionChange>()
    const executedStepIds: string[] = []
    const artifacts: AgentRunArtifactReference[] = []
    let guardFailure: AgentRunExecutorFailure | undefined

    const guard = (
      inFlightArtifacts: readonly AgentRunArtifactReference[],
      mutable: boolean,
    ): boolean => {
      const authority = liveFailure(request)
      if (authority) {
        guardFailure = authority
        return false
      }
      const current = options.readLiveBoard().board
      if (!validateExactArtifacts(current, inFlightArtifacts, request.actor)) {
        guardFailure = 'plan-changed'
        return false
      }
      const mutableArtifacts = mutable
        ? readMutableOwnedArtifactIdentities(current, inFlightArtifacts, ownedChanges)
        : Object.freeze([])
      if (mutableArtifacts === undefined || (!mutable && !recordOwnedArtifactChanges(
        current,
        inFlightArtifacts,
        request.actor,
        ownedChanges,
      ))) {
        guardFailure = 'plan-changed'
        return false
      }
      const projected = projectOwnedAdmissionChanges(
        current,
        baselineOutputs,
        ownedChanges,
        mutableArtifacts,
      )
      if (!projected || !sameAdmission(
        request.admission,
        projected,
        request.ideaId,
        request.targetCardId,
      )) {
        guardFailure = 'plan-changed'
        return false
      }
      return true
    }

    const settle = (outcomeArtifacts: readonly AgentRunArtifactReference[]): boolean => {
      // Recheck after the awaited operation as well: live authority, Result
      // selection, and every other admission input may have changed meanwhile.
      const authority = liveFailure(request)
      if (authority) {
        guardFailure = authority
        return false
      }
      const current = options.readLiveBoard().board
      if (!recordOwnedArtifactChanges(current, outcomeArtifacts, request.actor, ownedChanges)) {
        guardFailure = 'plan-changed'
        return false
      }
      artifacts.push(...outcomeArtifacts)
      return guard(artifacts, false)
    }

    const schedule = request.admission.schedule
    if (schedule.targetKind === 'ask') {
      const executeAskSchedule = async (): Promise<AgentRunExecutorOutcome> => {
        for (const step of schedule.prefix) {
          if (!guard(artifacts, false)) return finishFailure(guardFailure ?? 'plan-changed')
          executedStepIds.push(step.stepId)
          const outcome = await runAsk(step.cardId, () => runCard(step.cardId, {
            admittedPlan: step.plan,
            admissionGuard: (inFlight) => guard([...artifacts, ...inFlight], false),
            triggeredBy: request.actor,
            ...(options.askStream ? { stream: options.askStream } : {}),
          }))
          if (!settle(outcome.artifacts)) return finishFailure(guardFailure ?? 'plan-changed')
          const terminal = terminalFromRun(outcome, guardFailure)
          if (terminal) return finish(terminal.status, terminal.failure)
        }

        for (const step of schedule.targets) {
          if (!guard(artifacts, false)) return finishFailure(guardFailure ?? 'plan-changed')
          executedStepIds.push(step.stepId)
          const operation = () => step.mode === 'variations'
            ? runAgentVariation(step.cardId, {
                admittedPlan: step.plan,
                chainPlan: schedule.chainPlan,
                admissionGuard: (inFlight) => guard([...artifacts, ...inFlight], false),
                triggeredBy: request.actor,
                variationIndex: step.variationIndex,
                variationCount: step.variationCount,
                ...(options.askStream ? { stream: options.askStream } : {}),
              })
            : runCard(step.cardId, {
                admittedPlan: step.plan,
                chainPlan: schedule.chainPlan,
                admissionGuard: (inFlight) => guard([...artifacts, ...inFlight], false),
                triggeredBy: request.actor,
                ...(options.askStream ? { stream: options.askStream } : {}),
              })
          const outcome = await runAsk(step.cardId, operation)
          if (!settle(outcome.artifacts)) return finishFailure(guardFailure ?? 'plan-changed')
          const terminal = terminalFromRun(outcome, guardFailure)
          if (terminal) return finish(terminal.status, terminal.failure)
        }
        return finish('done')
      }

      return executeAskSchedule()
    }

    const conversationSchedule = schedule
    for (const step of conversationSchedule.runs) {
      if (!guard(artifacts, false)) return finishFailure(guardFailure ?? 'plan-changed')
      executedStepIds.push(step.stepId)
      const outcome = await runConversation(step, request, conversationSchedule.plan)
      if (!settle(outcome.artifacts)) return finishFailure(guardFailure ?? 'plan-changed')
      const terminal = terminalFromConversation(outcome, guardFailure)
      if (terminal) return finish(terminal.status, terminal.failure)
    }
    return finish('done')

    function finish(
      status: AgentRunTerminalStatus,
      failure?: AgentRunExecutorFailure,
    ): AgentRunExecutorOutcome {
      return Object.freeze({
        status,
        executedStepIds: Object.freeze([...executedStepIds]),
        reusedStepIds: Object.freeze([...request.admission.reusedStepIds]),
        artifacts: Object.freeze([...artifacts]),
        ...(failure ? { failure } : {}),
      })
    }

    function finishFailure(failure: AgentRunExecutorFailure): AgentRunExecutorOutcome {
      // Once the live Idea changes, no artifact from the old authority is
      // advertised or flushed as though it belonged to the newly active Idea.
      if (failure === 'idea-not-live' || failure === 'live-required') {
        return Object.freeze({
          status: 'failed',
          executedStepIds: Object.freeze([...executedStepIds]),
          reusedStepIds: Object.freeze([...request.admission.reusedStepIds]),
          artifacts: Object.freeze([]),
          failure,
        })
      }
      return finish('failed', failure)
    }

    async function runConversation(
      step: Readonly<{ variationIndex: number; variationCount: number }>,
      executionRequest: AgentRunExecutionRequest,
      plan: typeof conversationSchedule.plan,
    ): Promise<ConversationOutcome> {
      active = { kind: 'conversation', cardId: executionRequest.targetCardId }
      try {
        return await runAgentConversation(
          executionRequest.targetCardId,
          {
            admittedPlan: plan,
            admissionGuard: (inFlight) => guard([...artifacts, ...inFlight], true),
            triggeredBy: executionRequest.actor,
            mode: executionRequest.admission.mode,
            variationIndex: step.variationIndex,
            variationCount: step.variationCount,
            ...(options.conversationStream ? { stream: options.conversationStream } : {}),
            ...(options.compactionStream ? { compactionStream: options.compactionStream } : {}),
          },
        )
      } catch {
        return {
          ok: false,
          reason: 'failed',
          message: 'errGeneric',
          artifacts: Object.freeze([]),
        }
      } finally {
        active = undefined
      }
    }
  }

  async function runAsk(cardId: string, operation: () => Promise<RunOutcome>): Promise<RunOutcome> {
    active = { kind: 'ask', cardId }
    try {
      return await operation()
    } catch {
      return {
        ok: false,
        reason: 'failed',
        message: 'errGeneric',
        artifacts: Object.freeze([]),
      }
    } finally {
      active = undefined
    }
  }

  function liveFailure(request: AgentRunExecutionRequest): AgentRunExecutorFailure | undefined {
    let live = false
    try {
      live = options.isLive() === true
    } catch {
      return 'live-required'
    }
    if (!live) return 'live-required'
    return options.readLiveBoard().ideaId === request.ideaId ? undefined : 'idea-not-live'
  }
}

function terminalFromRun(
  outcome: RunOutcome,
  guardFailure: AgentRunExecutorFailure | undefined,
): Readonly<{ status: AgentRunTerminalStatus; failure?: AgentRunExecutorFailure }> | undefined {
  if (!outcome.ok) {
    return {
      status: 'failed',
      failure: outcome.reason === 'no-key'
        ? 'credential-unavailable'
        : outcome.reason === 'plan-changed'
        ? guardFailure ?? 'plan-changed'
        : 'execution-failed',
    }
  }
  return outcome.status === 'canceled' ? { status: 'canceled' } : undefined
}

function terminalFromConversation(
  outcome: ConversationOutcome,
  guardFailure: AgentRunExecutorFailure | undefined,
): Readonly<{ status: AgentRunTerminalStatus; failure?: AgentRunExecutorFailure }> | undefined {
  if (!outcome.ok) {
    return {
      status: 'failed',
      failure: outcome.reason === 'no-key'
        ? 'credential-unavailable'
        : outcome.reason === 'plan-changed'
        ? guardFailure ?? 'plan-changed'
        : 'execution-failed',
    }
  }
  return outcome.status === 'canceled' ? { status: 'canceled' } : undefined
}

function sameAdmission(
  admission: AgentRunAdmissionSuccess,
  board: SavedBoard,
  ideaId: string,
  targetCardId: string,
): boolean {
  const planned = planAgentRunAdmission(board, admission.mode === 'run'
    ? { ideaId, targetCardId }
    : { ideaId, targetCardId, mode: 'variations', variationCount: admission.variationCount })
  return planned.ok
    && planned.targetKind === admission.targetKind
    && planned.mode === admission.mode
    && planned.variationCount === admission.variationCount
    && planned.fingerprint === admission.fingerprint
    && JSON.stringify(planned.schedule) === JSON.stringify(admission.schedule)
    && sameIds(planned.plannedStepIds, admission.plannedStepIds)
    && planned.budgetedModelCalls <= admission.budgetedModelCalls
}

function validateExactArtifacts(
  board: SavedBoard,
  artifacts: readonly AgentRunArtifactReference[],
  actor: AgentRunActor,
): boolean {
  for (const artifact of artifacts) {
    if (artifact.kind === 'run-record') {
      const run = board.runs.find((candidate) => candidate.id === artifact.recordId)
      if (!run || run.askAiCardId !== artifact.cardId || !sameActor(run.triggeredBy, actor)) {
        return false
      }
      continue
    }
    const output = board.outputs.find((candidate) => candidate.id === artifact.outputId)
    const version = output?.versions.find((candidate) => candidate.id === artifact.versionId)
    if (!output || !version
      || artifact.recordId !== artifact.versionId
      || output.resultCardId !== artifact.cardId
      || version.fromRunId === undefined) return false
    const run = board.runs.find((candidate) => candidate.id === version.fromRunId)
    if (!run || !sameActor(run.triggeredBy, actor)) return false
  }
  return true
}

function recordOwnedArtifactChanges(
  board: SavedBoard,
  artifacts: readonly AgentRunArtifactReference[],
  actor: AgentRunActor,
  ownedChanges: Map<string, OwnedAdmissionChange>,
): boolean {
  if (!validateExactArtifacts(board, artifacts, actor)) return false
  const pending: Array<readonly [string, OwnedAdmissionChange]> = []
  for (const artifact of artifacts) {
    if (artifact.kind !== 'output-version' || ownedChanges.has(artifact.versionId)) continue
    const output = board.outputs.find((candidate) => candidate.id === artifact.outputId)
    const version = output?.versions.find((candidate) => candidate.id === artifact.versionId)
    const run = board.runs.find((candidate) => candidate.id === version?.fromRunId)
    if (!output || !version || !run) return false
    pending.push([artifact.versionId, Object.freeze({
      outputId: output.id,
      runId: run.id,
      versionSnapshot: JSON.stringify(version),
      runSnapshot: JSON.stringify(run),
    })])
  }
  for (const [versionId, change] of pending) ownedChanges.set(versionId, change)
  return true
}

/**
 * Reads the stable identity of an active Conversation artifact without
 * freezing its transcript or Run progress. Completed artifacts already held
 * by `ownedChanges` remain subject to exact snapshot checks in the projector.
 */
function readMutableOwnedArtifactIdentities(
  board: SavedBoard,
  artifacts: readonly AgentRunArtifactReference[],
  ownedChanges: ReadonlyMap<string, OwnedAdmissionChange>,
): readonly MutableOwnedArtifactIdentity[] | undefined {
  const runArtifactIds = new Set(
    artifacts
      .filter((artifact) => artifact.kind === 'run-record')
      .map((artifact) => artifact.recordId),
  )
  const seenVersionIds = new Set<string>()
  const seenOutputIds = new Set<string>()
  const mutable: MutableOwnedArtifactIdentity[] = []
  for (const artifact of artifacts) {
    if (artifact.kind !== 'output-version'
      || ownedChanges.has(artifact.versionId)
      || seenVersionIds.has(artifact.versionId)) continue
    const output = board.outputs.find((candidate) => candidate.id === artifact.outputId)
    const version = output?.versions.find((candidate) => candidate.id === artifact.versionId)
    const run = board.runs.find((candidate) => candidate.id === version?.fromRunId)
    if (!output || !version || !run
      || !runArtifactIds.has(run.id)
      || seenOutputIds.has(output.id)) return undefined
    seenVersionIds.add(version.id)
    seenOutputIds.add(output.id)
    mutable.push(Object.freeze({
      outputId: output.id,
      runId: run.id,
      versionId: version.id,
    }))
  }
  return Object.freeze(mutable)
}

/**
 * Masks exact completed artifacts plus the stable identity of the one active
 * mutable Conversation artifact. Only the latter's transcript and Run
 * progress may change while streaming; its links and selected Result may not.
 */
function projectOwnedAdmissionChanges(
  board: SavedBoard,
  baselineOutputs: ReadonlyMap<string, SavedBoard['outputs'][number]>,
  ownedChanges: ReadonlyMap<string, OwnedAdmissionChange>,
  mutableArtifacts: readonly MutableOwnedArtifactIdentity[] = Object.freeze([]),
): SavedBoard | undefined {
  if (ownedChanges.size === 0 && mutableArtifacts.length === 0) return board
  const ownedRunIds = new Set<string>()
  const ownedVersionIdsByOutputId = new Map<string, Set<string>>()
  const latestOwnedVersionIdByOutputId = new Map<string, string>()
  for (const [versionId, owned] of ownedChanges) {
    const output = board.outputs.find((candidate) => candidate.id === owned.outputId)
    const version = output?.versions.find((candidate) => candidate.id === versionId)
    const run = board.runs.find((candidate) => candidate.id === owned.runId)
    if (!version || !run
      || JSON.stringify(version) !== owned.versionSnapshot
      || JSON.stringify(run) !== owned.runSnapshot) return undefined
    ownedRunIds.add(owned.runId)
    const versionIds = ownedVersionIdsByOutputId.get(owned.outputId) ?? new Set<string>()
    versionIds.add(versionId)
    ownedVersionIdsByOutputId.set(owned.outputId, versionIds)
    latestOwnedVersionIdByOutputId.set(owned.outputId, versionId)
  }

  for (const mutable of mutableArtifacts) {
    const output = board.outputs.find((candidate) => candidate.id === mutable.outputId)
    const version = output?.versions.find((candidate) => candidate.id === mutable.versionId)
    const run = board.runs.find((candidate) => candidate.id === mutable.runId)
    if (!output || !version || !run || version.fromRunId !== run.id) return undefined
    ownedRunIds.add(run.id)
    const versionIds = ownedVersionIdsByOutputId.get(output.id) ?? new Set<string>()
    versionIds.add(version.id)
    ownedVersionIdsByOutputId.set(output.id, versionIds)
    latestOwnedVersionIdByOutputId.set(output.id, version.id)
  }

  for (const [outputId, latestOwnedVersionId] of latestOwnedVersionIdByOutputId) {
    if (board.outputs.find((output) => output.id === outputId)?.chosenVersionId
      !== latestOwnedVersionId) return undefined
  }

  const outputs: SavedBoard['outputs'] = []
  for (const output of board.outputs) {
    const ownedVersionIds = ownedVersionIdsByOutputId.get(output.id)
    if (!ownedVersionIds) {
      outputs.push(output)
      continue
    }
    const versions = output.versions.filter((version) => !ownedVersionIds.has(version.id))
    const chosenWasOwned = output.chosenVersionId !== undefined
      && ownedVersionIds.has(output.chosenVersionId)
    const baseline = baselineOutputs.get(output.id)
    if (versions.length === 0 && !baseline) continue
    if (chosenWasOwned && !baseline) return undefined
    const chosenVersionId = chosenWasOwned ? baseline!.chosenVersionId : output.chosenVersionId
    if (chosenVersionId !== undefined
      && !versions.some((version) => version.id === chosenVersionId)) return undefined
    const { chosenVersionId: _liveChoice, ...outputWithoutChoice } = output
    outputs.push({
      ...outputWithoutChoice,
      versions,
      ...(chosenVersionId === undefined ? {} : { chosenVersionId }),
    })
  }

  return {
    ...board,
    outputs,
    runs: board.runs.filter((run) => !ownedRunIds.has(run.id)),
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameActor(candidate: AgentRunActor | undefined, expected: AgentRunActor): boolean {
  return candidate?.kind === expected.kind
    && candidate.client === expected.client
    && candidate.sessionId === expected.sessionId
}

function failed(failure: AgentRunExecutorFailure): AgentRunExecutorOutcome {
  return Object.freeze({
    status: 'failed',
    executedStepIds: Object.freeze([]),
    reusedStepIds: Object.freeze([]),
    artifacts: Object.freeze([]),
    failure,
  })
}
