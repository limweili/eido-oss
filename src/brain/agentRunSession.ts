import { boardAiSettingsOf } from '../graph/boardAiSettings'
import { cardById, membersOf } from '../graph/graphHelpers'
import type { SavedBoard } from '../graph/types'
import { newId } from '../shared/ids'
import { stableContentHash } from '../shared/stableHash'
import { resolveProfileReviewModel } from '../shared/profileReviewPolicy'
import { chainStepStatuses } from './chainStaleness'
import { gatherConnectedThought } from './compiler'
import {
  boardExecutionEnvelope,
  effectiveExecutionModel,
  planAiExecution,
  planAskRun,
  planChainRun,
  planConversationRun,
  type AiExecutionPlan,
  type ConversationExecutionPlan,
  type ExecutionPlan,
} from './executionPlan'
import { groupDigestCacheKey } from './groupDigestFreshness'
import {
  AGENT_RUN_CONTRACT_VERSION,
  AGENT_RUN_BUDGET_EXHAUSTED_MESSAGE,
  AGENT_RUN_GRANT_DENIED_MESSAGE,
  AGENT_RUN_GRANT_REQUIRED_MESSAGE,
  AGENT_RUN_INTERNAL_MESSAGE,
  AGENT_RUN_INVALID_REQUEST_MESSAGE,
  AGENT_RUN_LIVE_REQUIRED_MESSAGE,
  AGENT_RUN_NOT_FINISHED_MESSAGE,
  AGENT_RUN_NOT_FOUND_MESSAGE,
  AGENT_RUN_VARIATION_LIMITS,
  normalizeAgentRunSubmitRequest,
  pageAgentRunArtifacts,
  type AgentRunActor,
  type AgentRunArtifactReference,
  type AgentRunLiveService,
  type AgentRunJobStatus,
  type AgentRunServiceFailure,
  type AgentRunServiceFailureCode,
  type AgentRunSubmitRequest,
  type AgentRunSubmissionReceipt,
  type AgentRunTerminalStatus,
  type NormalizedAgentRunSubmitRequest,
} from './agentRunContract'

export const DEFAULT_AGENT_RUN_SESSION_CAP = Object.freeze({
  // A session cap is admission accounting, not guessed dollar pricing. One
  // accepted CLI job consumes one Run; every Ask/Conversation turn, serially
  // required Group refresh, and possible uncached-summary attempt consumes one
  // model-call unit.
  maxRuns: 100,
  maxPlannedSteps: 500,
})

export const DEFAULT_AGENT_RUN_APP_CAP = Object.freeze({
  // App-lifetime ceilings bound both spend and the number of per-session
  // ledgers a rotating client can create before Eido itself restarts.
  maxRuns: 1_000,
  maxPlannedSteps: 5_000,
  maxSessions: 256,
})

export const DEFAULT_AGENT_RUN_JOB_RETENTION = Object.freeze({
  maxRetainedJobs: 500,
})

export const AGENT_RUN_INVALID_RESERVATION_MESSAGE =
  'The agent run reservation is invalid or conflicts with an earlier request.'

export type AgentRunGrantPolicy = Readonly<{
  id: 'owner-default' | 'first-run-approval'
  firstRun: 'allow' | 'require-approval'
}>

export const AGENT_RUN_OWNER_GRANT_POLICY: AgentRunGrantPolicy = Object.freeze({
  id: 'owner-default',
  firstRun: 'allow',
})

export const AGENT_RUN_FIRST_RUN_APPROVAL_POLICY: AgentRunGrantPolicy = Object.freeze({
  id: 'first-run-approval',
  firstRun: 'require-approval',
})

export type AgentRunGrantState =
  | 'not-required'
  | 'unresolved'
  | 'approval-required'
  | 'approved'
  | 'denied'

export type AgentRunSessionCap = Readonly<{
  maxRuns: number
  maxPlannedSteps: number
}>

export type AgentRunSessionUsage = AgentRunSessionCap & Readonly<{
  usedRuns: number
  usedPlannedSteps: number
}>

export type AgentRunReservationRequest = Readonly<{
  runId: string
  plannedSteps: number
}>

export type AgentRunReservation = Readonly<{
  runId: string
  plannedSteps: number
  usedRuns: number
  usedPlannedSteps: number
}>

export type AgentRunReservationResult =
  | Readonly<{ ok: true; value: AgentRunReservation }>
  | Readonly<{
      ok: false
      code: 'budget-exhausted'
      retryable: false
      message: typeof AGENT_RUN_BUDGET_EXHAUSTED_MESSAGE
      usage: AgentRunSessionUsage
    }>
  | Readonly<{
      ok: false
      code: 'grant-required'
      retryable: true
      message: typeof AGENT_RUN_GRANT_REQUIRED_MESSAGE
    }>
  | Readonly<{
      ok: false
      code: 'grant-denied'
      retryable: false
      message: typeof AGENT_RUN_GRANT_DENIED_MESSAGE
    }>
  | Readonly<{
      ok: false
      code: 'invalid-reservation'
      retryable: false
      message: typeof AGENT_RUN_INVALID_RESERVATION_MESSAGE
    }>

export type AgentRunSessionAdmission = Readonly<{
  reserve(request: AgentRunReservationRequest): AgentRunReservationResult
  status(): Readonly<{
    sessionId: string
    grant: AgentRunGrantState
    usage: AgentRunSessionUsage
  }>
  resolveGrant(decision: 'approved' | 'denied'): AgentRunGrantState
}>

type AgentRunReservationFailure = Exclude<AgentRunReservationResult, { ok: true }>

type AgentRunReservationPreview =
  | Readonly<{ ok: true; existing?: AgentRunReservation }>
  | AgentRunReservationFailure

type AgentRunAdmissionState = Readonly<{
  preview(request: AgentRunReservationRequest): AgentRunReservationPreview
  commit(request: AgentRunReservationRequest): AgentRunReservation
  status(): Readonly<{
    sessionId: string
    grant: AgentRunGrantState
    usage: AgentRunSessionUsage
  }>
  resolveGrant(decision: 'approved' | 'denied'): AgentRunGrantState
}>

export function createAgentRunSessionAdmission(options: Readonly<{
  sessionId: string
  cap?: AgentRunSessionCap
  grantPolicy?: AgentRunGrantPolicy
}>): AgentRunSessionAdmission {
  const state = createAgentRunAdmissionState(options)
  return Object.freeze({
    reserve(request) {
      const preview = state.preview(request)
      if (!preview.ok) return preview
      return Object.freeze({
        ok: true,
        value: preview.existing ?? state.commit(request),
      })
    },
    status: state.status,
    resolveGrant: state.resolveGrant,
  })
}

function createAgentRunAdmissionState(options: Readonly<{
  sessionId: string
  cap?: AgentRunSessionCap
  grantPolicy?: AgentRunGrantPolicy
}>): AgentRunAdmissionState {
  const configuredCap = options.cap ?? DEFAULT_AGENT_RUN_SESSION_CAP
  const cap = Object.freeze({
    maxRuns: configuredCap.maxRuns,
    maxPlannedSteps: configuredCap.maxPlannedSteps,
  })
  const grantPolicy = options.grantPolicy ?? AGENT_RUN_OWNER_GRANT_POLICY
  if (!options.sessionId || !validPositiveInteger(cap.maxRuns)
    || !validPositiveInteger(cap.maxPlannedSteps)) {
    throw new Error('Agent run session configuration is invalid')
  }

  let usedRuns = 0
  let usedPlannedSteps = 0
  let grant: AgentRunGrantState = grantPolicy.firstRun === 'allow'
    ? 'not-required'
    : 'unresolved'
  const reservations = new Map<string, AgentRunReservation>()
  const usage = (): AgentRunSessionUsage => Object.freeze({
    ...cap,
    usedRuns,
    usedPlannedSteps,
  })

  return Object.freeze({
    preview(request) {
      if (!validRunId(request.runId) || !validPositiveInteger(request.plannedSteps)) {
        return invalidReservation()
      }
      const existing = reservations.get(request.runId)
      if (existing) {
        return existing.plannedSteps === request.plannedSteps
          ? Object.freeze({ ok: true, existing })
          : invalidReservation()
      }
      if (grant === 'unresolved') grant = 'approval-required'
      if (grant === 'approval-required') {
        return Object.freeze({
          ok: false,
          code: 'grant-required',
          retryable: true,
          message: AGENT_RUN_GRANT_REQUIRED_MESSAGE,
        })
      }
      if (grant === 'denied') {
        return Object.freeze({
          ok: false,
          code: 'grant-denied',
          retryable: false,
          message: AGENT_RUN_GRANT_DENIED_MESSAGE,
        })
      }
      if (usedRuns + 1 > cap.maxRuns
        || usedPlannedSteps + request.plannedSteps > cap.maxPlannedSteps) {
        return budgetExhausted(usage())
      }
      return Object.freeze({ ok: true })
    },
    commit(request) {
      usedRuns += 1
      usedPlannedSteps += request.plannedSteps
      const reservation = Object.freeze({
        runId: request.runId,
        plannedSteps: request.plannedSteps,
        usedRuns,
        usedPlannedSteps,
      })
      reservations.set(request.runId, reservation)
      return reservation
    },
    status: () => Object.freeze({
      sessionId: options.sessionId,
      grant,
      usage: usage(),
    }),
    resolveGrant(decision) {
      if (grant === 'approval-required' || grant === 'unresolved') grant = decision
      return grant
    },
  })
}

export type AgentRunAppCap = AgentRunSessionCap & Readonly<{
  maxSessions: number
}>

export type AgentRunAdmissionOwner = Readonly<{
  reserve(sessionId: string, request: AgentRunReservationRequest): AgentRunReservationResult
  sessionStatus(sessionId: string): ReturnType<AgentRunSessionAdmission['status']> | undefined
  resolveGrant(
    sessionId: string,
    decision: 'approved' | 'denied',
  ): AgentRunGrantState | undefined
  appStatus(): Readonly<{
    maxRetainedSessions: number
    retainedSessions: number
    globalUsage: AgentRunSessionUsage
  }>
}>

/**
 * One app-scoped owner is shared by every live connection. It commits the
 * per-session and global reservations together, so changing session IDs can
 * neither reset the app ceiling nor grow admission state without bound.
 */
export function createAgentRunAdmissionOwner(options: Readonly<{
  sessionCap?: AgentRunSessionCap
  appCap?: AgentRunAppCap
  grantPolicy?: AgentRunGrantPolicy
}> = {}): AgentRunAdmissionOwner {
  const sessionCap = options.sessionCap ?? DEFAULT_AGENT_RUN_SESSION_CAP
  const appCap = options.appCap ?? DEFAULT_AGENT_RUN_APP_CAP
  if (!validPositiveInteger(appCap.maxSessions)) {
    throw new Error('Agent run app admission configuration is invalid')
  }
  const global = createAgentRunAdmissionState({
    sessionId: 'agent-run-app-lifetime',
    cap: appCap,
  })
  const sessions = new Map<string, AgentRunAdmissionState>()
  const runOwners = new Map<string, string>()

  return Object.freeze({
    reserve(sessionId, request) {
      if (!validRunId(sessionId)
        || !validRunId(request.runId)
        || !validPositiveInteger(request.plannedSteps)) return invalidReservation()

      const existingOwner = runOwners.get(request.runId)
      if (existingOwner !== undefined && existingOwner !== sessionId) {
        return invalidReservation()
      }
      const globalPreview = global.preview(request)
      if (!globalPreview.ok) return globalPreview

      let session = sessions.get(sessionId)
      const isNewSession = session === undefined
      if (!session) {
        if (sessions.size >= appCap.maxSessions) {
          return budgetExhausted(global.status().usage)
        }
        session = createAgentRunAdmissionState({
          sessionId,
          cap: sessionCap,
          grantPolicy: options.grantPolicy,
        })
      }
      const sessionPreview = session.preview(request)
      if (!sessionPreview.ok) {
        // A pending first-run grant must remain addressable by the live app.
        if (isNewSession && (sessionPreview.code === 'grant-required'
          || sessionPreview.code === 'grant-denied')) sessions.set(sessionId, session)
        return sessionPreview
      }

      if (isNewSession) sessions.set(sessionId, session)
      const sessionReservation = sessionPreview.existing ?? session.commit(request)
      if (!globalPreview.existing) global.commit(request)
      runOwners.set(request.runId, sessionId)
      return Object.freeze({ ok: true, value: sessionReservation })
    },
    sessionStatus(sessionId) {
      return sessions.get(sessionId)?.status()
    },
    resolveGrant(sessionId, decision) {
      return sessions.get(sessionId)?.resolveGrant(decision)
    },
    appStatus: () => Object.freeze({
      maxRetainedSessions: appCap.maxSessions,
      retainedSessions: sessions.size,
      globalUsage: global.status().usage,
    }),
  })
}

export type AgentRunExecutionRequest = Readonly<{
  runId: string
  ideaId: string
  targetCardId: string
  actor: AgentRunActor
  /** Must be checked verbatim by the brain executor before every model-capable
   * operation in the admitted schedule. */
  admission: AgentRunAdmissionSuccess
}>

export type AgentRunExecutionResult = Readonly<{
  status: AgentRunTerminalStatus
  executedStepIds: readonly string[]
  reusedStepIds: readonly string[]
  artifacts: readonly AgentRunArtifactReference[]
  error?: string
}>

export type AgentRunSessionServiceOptions = Readonly<{
  actor: AgentRunActor
  /** App-scoped; do not construct one per CLI connection. */
  admissionOwner: AgentRunAdmissionOwner
  /** App-lifetime registry shared by every trusted live connection. */
  jobs: AgentRunJobRegistry
  isLive(): boolean
  readBoard(ideaId: string): SavedBoard | undefined
  execute(request: AgentRunExecutionRequest): Promise<AgentRunExecutionResult>
  /** App owner hook. Registration is synchronous with receipt creation so a
   * shutdown drain cannot miss the queued executeJob microtask. */
  trackJob?(job: Promise<void>): void
  createRunId?: () => string
  now?: () => string
}>

export type AgentRunStoredJob = Readonly<{
  status: AgentRunJobStatus
  artifacts: readonly AgentRunArtifactReference[]
}>

export type AgentRunJobRegistry = Readonly<{
  get(runId: string): AgentRunStoredJob | undefined
  canAdd(runId: string): boolean
  add(runId: string, job: AgentRunStoredJob): boolean
  replace(runId: string, job: AgentRunStoredJob): boolean
  status(): Readonly<{
    maxRetainedJobs: number
    retainedJobs: number
    activeJobs: number
    terminalJobs: number
  }>
}>

/** App-scoped so a new CLI process can poll a Run submitted by an earlier
 * connection. Admission accounting remains separately scoped by sessionId. */
export function createAgentRunJobRegistry(options: Readonly<{
  maxRetainedJobs?: number
}> = {}): AgentRunJobRegistry {
  const maxRetainedJobs = options.maxRetainedJobs
    ?? DEFAULT_AGENT_RUN_JOB_RETENTION.maxRetainedJobs
  if (!validPositiveInteger(maxRetainedJobs)) {
    throw new Error('Agent run job retention configuration is invalid')
  }
  const jobs = new Map<string, AgentRunStoredJob>()
  const oldestTerminalRunId = (): string | undefined => {
    for (const [runId, job] of jobs) {
      if (isTerminal(job.status.status)) return runId
    }
    return undefined
  }
  return Object.freeze({
    get: (runId) => jobs.get(runId),
    canAdd(runId) {
      return !jobs.has(runId)
        && (jobs.size < maxRetainedJobs || oldestTerminalRunId() !== undefined)
    },
    add(runId, job) {
      if (jobs.has(runId)) return false
      if (jobs.size >= maxRetainedJobs) {
        const evictable = oldestTerminalRunId()
        if (evictable === undefined) return false
        jobs.delete(evictable)
      }
      jobs.set(runId, freezeJob(job))
      return true
    },
    replace(runId, job) {
      if (!jobs.has(runId)) return false
      jobs.set(runId, freezeJob(job))
      return true
    },
    status() {
      let terminalJobs = 0
      for (const job of jobs.values()) {
        if (isTerminal(job.status.status)) terminalJobs += 1
      }
      return Object.freeze({
        maxRetainedJobs,
        retainedJobs: jobs.size,
        activeJobs: jobs.size - terminalJobs,
        terminalJobs,
      })
    },
  })
}

/**
 * Async job core for the live app. Job state lives in the injected app-scoped
 * registry, while admission remains session-scoped.
 */
export function createAgentRunSessionService(
  options: AgentRunSessionServiceOptions,
): AgentRunLiveService {
  if (!validActor(options.actor)) {
    throw new Error('Agent run service identity is invalid')
  }
  const createRunId = options.createRunId ?? (() => newId('agent-run'))
  const now = options.now ?? (() => new Date().toISOString())
  const jobs = options.jobs

  const service: AgentRunLiveService = Object.freeze({
    async submit(request) {
      if (!options.isLive()) return runFailure('live-app-required')
      const normalizedRequest = normalizeAgentRunSubmitRequest(request)
      if (!normalizedRequest) return runFailure('invalid')

      let board: SavedBoard | undefined
      try {
        board = options.readBoard(normalizedRequest.ideaId)
      } catch {
        return runFailure('internal')
      }
      if (!board) return runFailure('not-found')
      const planned = planAgentRunAdmission(board, normalizedRequest)
      if (!planned.ok) return runFailure('not-found')

      const runId = createRunId()
      if (!validRunId(runId) || jobs.get(runId)) return runFailure('internal')
      if (!jobs.canAdd(runId)) return runFailure('budget-exhausted')
      const reserved = options.admissionOwner.reserve(options.actor.sessionId, {
        runId,
        plannedSteps: planned.budgetedModelCalls,
      })
      if (!reserved.ok) return reservationFailure(reserved)

      const submittedAt = now()
      const receipt: AgentRunSubmissionReceipt = Object.freeze({
        version: AGENT_RUN_CONTRACT_VERSION,
        runId,
        ideaId: normalizedRequest.ideaId,
        targetCardId: normalizedRequest.targetCardId,
        actor: Object.freeze({ ...options.actor }),
        status: 'queued',
        submittedAt,
        plannedStepIds: Object.freeze([...planned.plannedStepIds]),
        reusedStepIds: Object.freeze([...planned.reusedStepIds]),
      })
      if (!jobs.add(runId, {
        status: statusFromReceipt(receipt),
        artifacts: Object.freeze([]),
      })) return runFailure('internal')

      const scheduled = Promise.resolve().then(() => executeJob({
        runId,
        ideaId: normalizedRequest.ideaId,
        targetCardId: normalizedRequest.targetCardId,
        actor: receipt.actor,
        admission: planned,
      }))
      options.trackJob?.(scheduled)
      void scheduled.catch(() => undefined)
      return Object.freeze({ ok: true, value: receipt })
    },
    async status(request) {
      if (!options.isLive()) return runFailure('live-app-required')
      if (!validStatusRequest(request)) return runFailure('invalid')
      const job = jobs.get(request.runId)
      return job
        ? Object.freeze({ ok: true, value: job.status })
        : runFailure('not-found')
    },
    async read(request) {
      if (!options.isLive()) return runFailure('live-app-required')
      if (!validReadRequest(request)) return runFailure('invalid')
      const job = jobs.get(request.runId)
      if (!job) return runFailure('not-found')
      if (!isTerminal(job.status.status)) return runFailure('run-not-finished')
      const { runId, ...pageRequest } = request
      const page = pageAgentRunArtifacts({
        runId,
        status: job.status.status,
        artifacts: job.artifacts,
      }, pageRequest)
      if (!page.ok) {
        return Object.freeze({
          ok: false,
          code: 'invalid',
          retryable: page.retryable,
          message: page.message,
        })
      }
      return Object.freeze({ ok: true, value: page.value })
    },
  })
  return service

  async function executeJob(request: AgentRunExecutionRequest): Promise<void> {
    const queued = jobs.get(request.runId)
    if (!queued) return
    const running = Object.freeze({
      ...queued.status,
      status: 'running',
      startedAt: now(),
    })
    if (!jobs.replace(request.runId, {
      status: running,
      artifacts: queued.artifacts,
    })) return
    try {
      const result = await options.execute(request)
      const validated = validateExecutionResult(request, result)
      if (!validated) throw new Error('invalid Agent run execution result')
      jobs.replace(request.runId, {
        artifacts: Object.freeze([...result.artifacts]),
        status: Object.freeze({
          ...running,
          status: result.status,
          finishedAt: now(),
          executedStepIds: Object.freeze([...result.executedStepIds]),
          reusedStepIds: Object.freeze([...result.reusedStepIds]),
          artifactCount: result.artifacts.length,
          ...(result.error === undefined ? {} : { error: result.error }),
        }),
      })
    } catch {
      jobs.replace(request.runId, {
        artifacts: Object.freeze([]),
        status: Object.freeze({
          ...running,
          status: 'failed',
          finishedAt: now(),
          artifactCount: 0,
          error: AGENT_RUN_INTERNAL_MESSAGE,
        }),
      })
    }
  }
}

function freezeJob(job: AgentRunStoredJob): AgentRunStoredJob {
  return Object.freeze({
    status: job.status,
    artifacts: Object.freeze([...job.artifacts]),
  })
}

function statusFromReceipt(receipt: AgentRunSubmissionReceipt): AgentRunJobStatus {
  return Object.freeze({
    version: receipt.version,
    runId: receipt.runId,
    ideaId: receipt.ideaId,
    targetCardId: receipt.targetCardId,
    actor: receipt.actor,
    status: receipt.status,
    submittedAt: receipt.submittedAt,
    plannedStepIds: receipt.plannedStepIds,
    executedStepIds: Object.freeze([]),
    reusedStepIds: receipt.reusedStepIds,
    artifactCount: 0,
  })
}

function validateExecutionResult(
  request: AgentRunExecutionRequest,
  candidate: AgentRunExecutionResult,
): boolean {
  if (!candidate || typeof candidate !== 'object'
    || !isTerminal(candidate.status)
    || !validIds(candidate.executedStepIds)
    || !validIds(candidate.reusedStepIds)
    || !Array.isArray(candidate.artifacts)
    || (candidate.error !== undefined && typeof candidate.error !== 'string')) return false
  if (candidate.status === 'done'
    ? !sameIds(candidate.executedStepIds, request.admission.plannedStepIds)
    : !isIdPrefix(candidate.executedStepIds, request.admission.plannedStepIds)) return false
  return pageAgentRunArtifacts({
    runId: request.runId,
    status: candidate.status,
    artifacts: candidate.artifacts,
  }, {}).ok
}

function validStatusRequest(request: { runId: string }): boolean {
  return isExactRecord(request, ['runId']) && validRunId(request.runId)
}

function validReadRequest(request: { runId: string; limit?: number; byteLimit?: number; cursor?: string }): boolean {
  return isOnlyRecord(request, ['byteLimit', 'cursor', 'limit', 'runId'])
    && validRunId(request.runId)
}

function validActor(actor: AgentRunActor): boolean {
  return isExactRecord(actor, ['client', 'kind', 'sessionId'])
    && actor.kind === 'agent'
    && validRunId(actor.client)
    && validRunId(actor.sessionId)
}

function validIds(candidate: readonly string[]): boolean {
  return Array.isArray(candidate) && candidate.every(validRunId)
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && isIdPrefix(left, right)
}

function isIdPrefix(prefix: readonly string[], values: readonly string[]): boolean {
  return prefix.every((value, index) => value === values[index])
}

function isTerminal(status: string): status is AgentRunTerminalStatus {
  return status === 'done' || status === 'failed' || status === 'canceled'
}

function isExactRecord(candidate: unknown, keys: readonly string[]): candidate is Record<string, unknown> {
  return isOnlyRecord(candidate, keys) && Object.keys(candidate).length === keys.length
}

function isOnlyRecord(candidate: unknown, keys: readonly string[]): candidate is Record<string, unknown> {
  return typeof candidate === 'object'
    && candidate !== null
    && !Array.isArray(candidate)
    && Object.keys(candidate).every((key) => keys.includes(key))
}

function reservationFailure(
  failure: Exclude<AgentRunReservationResult, { ok: true }>,
): AgentRunServiceFailure {
  const code: AgentRunServiceFailureCode = failure.code === 'invalid-reservation'
    ? 'invalid'
    : failure.code
  return Object.freeze({
    ok: false,
    code,
    retryable: failure.retryable,
    message: failure.message,
  })
}

function runFailure(code: AgentRunServiceFailureCode): AgentRunServiceFailure {
  const contract: Record<AgentRunServiceFailureCode, Readonly<{
    retryable: boolean
    message: string
  }>> = {
    'live-app-required': { retryable: true, message: AGENT_RUN_LIVE_REQUIRED_MESSAGE },
    invalid: { retryable: false, message: AGENT_RUN_INVALID_REQUEST_MESSAGE },
    'not-found': { retryable: false, message: AGENT_RUN_NOT_FOUND_MESSAGE },
    'run-not-finished': { retryable: true, message: AGENT_RUN_NOT_FINISHED_MESSAGE },
    'budget-exhausted': { retryable: false, message: AGENT_RUN_BUDGET_EXHAUSTED_MESSAGE },
    'grant-required': { retryable: true, message: AGENT_RUN_GRANT_REQUIRED_MESSAGE },
    'grant-denied': { retryable: false, message: AGENT_RUN_GRANT_DENIED_MESSAGE },
    internal: { retryable: true, message: AGENT_RUN_INTERNAL_MESSAGE },
  }
  return Object.freeze({ ok: false, code, ...contract[code] })
}

export type AdmittedAskPlan = Readonly<{
  stepId: string
  plan: ExecutionPlan
}>

export type AgentRunExecutionSchedule =
  | Readonly<{
      targetKind: 'ask'
      chainPlan: ExecutionPlan
      prefix: readonly Readonly<{
        stepId: string
        cardId: string
        plan: ExecutionPlan
      }>[]
      targets: readonly Readonly<{
        stepId: string
        cardId: string
        plan: ExecutionPlan
        mode: 'run' | 'variations'
        variationIndex: number
        variationCount: number
      }>[]
    }>
  | Readonly<{
      targetKind: 'conversation'
      plan: ConversationExecutionPlan
      runs: readonly Readonly<{
        stepId: string
        variationIndex: number
        variationCount: number
      }>[]
    }>

export type AgentRunAdmissionSuccess = Readonly<{
      ok: true
      targetKind: 'ask' | 'conversation'
      mode: NormalizedAgentRunSubmitRequest['mode']
      variationCount: number
      plan: ExecutionPlan | ConversationExecutionPlan
      conversationPlan?: ConversationExecutionPlan
      plannedStepIds: readonly string[]
      reusedStepIds: readonly string[]
      askPlans: readonly AdmittedAskPlan[]
      /** Explicit brain-owned execution order. Callers never infer prefix or
       * target roles from positional step ids. */
      schedule: AgentRunExecutionSchedule
      /** Worst-case model calls reserved before start: every admitted Ask,
       * serial compressed-Group refresh, possible context-summary attempt, or
       * Conversation participant turn. */
      budgetedModelCalls: number
      /** Provider-neutral quantities used by local execution admission. */
      aiExecutionPlan: AiExecutionPlan
      fingerprint: string
    }>

export type AgentRunAdmissionPlan =
  | AgentRunAdmissionSuccess
  | Readonly<{
      ok: false
      code: 'invalid-target'
    }>

/**
 * Projects the exact Ask steps an agent-triggered Run will execute. Agent Runs
 * use the ordinary pressed-card behavior: stale upstream steps heal and the
 * target always produces a new version, even when it was already fresh.
 */
export function planAgentRunAdmission(
  board: SavedBoard,
  request: string | AgentRunSubmitRequest | NormalizedAgentRunSubmitRequest,
): AgentRunAdmissionPlan {
  const normalized = typeof request === 'string'
    ? Object.freeze({
        ideaId: 'legacy-v1',
        targetCardId: request,
        mode: 'run' as const,
        variationCount: 1,
      })
    : isNormalizedSubmitRequest(request)
      ? request
      : normalizeAgentRunSubmitRequest(request)
  if (!normalized) return Object.freeze({ ok: false, code: 'invalid-target' })
  // The delegated ledger must reserve every Eido-owned model call before any
  // work starts. Local harness commands are device-local rather than part of
  // the Board snapshot, and Agentic Ask loops intentionally have no call cap,
  // so neither execution kind can satisfy that contract today.
  if ((boardAiSettingsOf(board)?.provider ?? 'openrouter') !== 'openrouter') {
    return Object.freeze({ ok: false, code: 'invalid-target' })
  }
  const target = board.cards.find((card) => card.id === normalized.targetCardId)
  if (target?.kind === 'conversation') {
    const conversationPlan = planConversationRun(board, target.id)
    if (!conversationPlan || conversationPlan.totalTurns < 1) {
      return Object.freeze({ ok: false, code: 'invalid-target' })
    }
    const plannedStepIds = normalized.mode === 'run'
      ? [`conversation:${target.id}`]
      : Array.from({ length: normalized.variationCount }, (_, index) => (
          `conversation:${target.id}:variation:${index + 1}`
        ))
    const aiExecutionPlan = planAiExecution(board, {
      kind: 'conversation',
      conversationCardId: target.id,
      count: normalized.variationCount,
      delegated: true,
    })
    if (!aiExecutionPlan) return Object.freeze({ ok: false, code: 'invalid-target' })
    return Object.freeze({
      ok: true,
      targetKind: 'conversation',
      mode: normalized.mode,
      variationCount: normalized.variationCount,
      plan: conversationPlan,
      conversationPlan,
      plannedStepIds: Object.freeze(plannedStepIds),
      reusedStepIds: Object.freeze([]),
      askPlans: Object.freeze([]),
      schedule: Object.freeze({
        targetKind: 'conversation',
        plan: conversationPlan,
        runs: Object.freeze(plannedStepIds.map((stepId, index) => Object.freeze({
          stepId,
          variationIndex: index + 1,
          variationCount: normalized.variationCount,
        }))),
      }),
      aiExecutionPlan,
      budgetedModelCalls: aiExecutionPlan.providerCalls,
      fingerprint: conversationPlan.fingerprint,
    })
  }
  if (target?.kind !== 'askAi') return Object.freeze({ ok: false, code: 'invalid-target' })
  if (normalized.mode === 'variations') {
    const plan = planChainRun(board, target.id)
    const statuses = chainStepStatuses(board, plan)
    const upstreamStatuses = statuses.filter((status) => status.step.cardId !== target.id)
    const upstreamStepIds = upstreamStatuses
      .filter((status) => status.willRun)
      .map((status) => status.step.id)
    const reusedStepIds = upstreamStatuses
      .filter((status) => !status.willRun)
      .map((status) => status.step.id)
    const variationStepIds = Array.from({ length: normalized.variationCount }, (_, index) => (
      `variation:${target.id}:${index + 1}`
    ))
    const targetPlan = planAskRun(board, target.id)
    const askPlans = Object.freeze([
      ...upstreamStatuses
        .filter((status) => status.willRun)
        .map((status) => Object.freeze({
          stepId: status.step.id,
          plan: planAskRun(board, status.step.cardId),
        })),
      ...variationStepIds.map((stepId) => Object.freeze({ stepId, plan: targetPlan })),
    ])
    const plannedStepIds = Object.freeze([...upstreamStepIds, ...variationStepIds])
    if (hasUnboundedAgenticAsk(board, askPlans)) {
      return Object.freeze({ ok: false, code: 'invalid-target' })
    }
    const aiExecutionPlan = planAiExecution(board, {
      kind: 'variations',
      askAiCardId: target.id,
      count: normalized.variationCount,
      askAiCardIds: askPlans.map((candidate) => candidate.plan.rootCardId),
    })
    if (!aiExecutionPlan) return Object.freeze({ ok: false, code: 'invalid-target' })
    return Object.freeze({
      ok: true,
      targetKind: 'ask',
      mode: normalized.mode,
      variationCount: normalized.variationCount,
      plan,
      plannedStepIds,
      reusedStepIds: Object.freeze(reusedStepIds),
      askPlans,
      schedule: Object.freeze({
        targetKind: 'ask',
        chainPlan: plan,
        prefix: Object.freeze(askPlans.slice(0, upstreamStepIds.length).map((candidate) => (
          Object.freeze({
            stepId: candidate.stepId,
            cardId: candidate.plan.rootCardId,
            plan: candidate.plan,
          })
        ))),
        targets: Object.freeze(askPlans.slice(upstreamStepIds.length).map((candidate, index) => (
          Object.freeze({
            stepId: candidate.stepId,
            cardId: target.id,
            plan: candidate.plan,
            mode: 'variations' as const,
            variationIndex: index + 1,
            variationCount: normalized.variationCount,
          })
        ))),
      }),
      aiExecutionPlan,
      budgetedModelCalls: aiExecutionPlan.providerCalls,
      fingerprint: askAdmissionFingerprint(board, askPlans),
    })
  }

  const targetAskAiCardId = target.id
  const plan = planChainRun(board, targetAskAiCardId)
  const statuses = chainStepStatuses(board, plan)
  if (!statuses.some((status) => status.step.cardId === targetAskAiCardId)) {
    return Object.freeze({ ok: false, code: 'invalid-target' })
  }

  const plannedStepIds = statuses
    .filter((status) => status.willRun || status.step.cardId === targetAskAiCardId)
    .map((status) => status.step.id)
  const planned = new Set(plannedStepIds)
  const reusedStepIds = statuses
    .filter((status) => !planned.has(status.step.id))
    .map((status) => status.step.id)
  const askPlans = Object.freeze(statuses
    .filter((status) => planned.has(status.step.id))
    .map((status) => Object.freeze({
      stepId: status.step.id,
      plan: planAskRun(board, status.step.cardId),
    })))
  const aiExecutionPlan = planAiExecution(board, {
    kind: 'chain',
    targetAskAiCardId,
    askAiCardIds: askPlans.map((admission) => admission.plan.rootCardId),
  })
  if (!aiExecutionPlan) return Object.freeze({ ok: false, code: 'invalid-target' })
  if (hasUnboundedAgenticAsk(board, askPlans)) {
    return Object.freeze({ ok: false, code: 'invalid-target' })
  }

  return Object.freeze({
    ok: true,
    targetKind: 'ask',
    mode: normalized.mode,
    variationCount: normalized.variationCount,
    plan,
    plannedStepIds: Object.freeze(plannedStepIds),
    reusedStepIds: Object.freeze(reusedStepIds),
    askPlans,
    schedule: Object.freeze({
      targetKind: 'ask',
      chainPlan: plan,
      prefix: Object.freeze(askPlans
        .filter((candidate) => candidate.plan.rootCardId !== targetAskAiCardId)
        .map((candidate) => Object.freeze({
          stepId: candidate.stepId,
          cardId: candidate.plan.rootCardId,
          plan: candidate.plan,
        }))),
      targets: Object.freeze(askPlans
        .filter((candidate) => candidate.plan.rootCardId === targetAskAiCardId)
        .map((candidate) => Object.freeze({
          stepId: candidate.stepId,
          cardId: targetAskAiCardId,
          plan: candidate.plan,
          mode: 'run' as const,
          variationIndex: 1,
          variationCount: 1,
        }))),
    }),
    aiExecutionPlan,
    budgetedModelCalls: aiExecutionPlan.providerCalls,
    fingerprint: askAdmissionFingerprint(board, askPlans),
  })
}

function hasUnboundedAgenticAsk(
  board: SavedBoard,
  askPlans: readonly AdmittedAskPlan[],
): boolean {
  return askPlans.some((candidate) => (
    cardById(board, candidate.plan.rootCardId)?.agentic === true
  ))
}

function isNormalizedSubmitRequest(
  candidate: AgentRunSubmitRequest | NormalizedAgentRunSubmitRequest,
): candidate is NormalizedAgentRunSubmitRequest {
  if (!isExactRecord(candidate, ['ideaId', 'mode', 'targetCardId', 'variationCount'])) {
    return false
  }
  const normalized = candidate as unknown as NormalizedAgentRunSubmitRequest
  return validRunId(normalized.ideaId)
    && validRunId(normalized.targetCardId)
    && (normalized.mode === 'run' || normalized.mode === 'variations')
    && validPositiveInteger(normalized.variationCount)
    && normalized.variationCount <= AGENT_RUN_VARIATION_LIMITS.maxCount
    && (normalized.mode === 'run' ? normalized.variationCount === 1 : true)
}

function askAdmissionFingerprint(
  board: SavedBoard,
  askPlans: readonly AdmittedAskPlan[],
): string {
  return `ask:${stableContentHash({
    executionEnvelope: boardExecutionEnvelope(board),
    asks: askPlans.map((candidate) => {
      const compiled = gatherConnectedThought(board, candidate.plan.rootCardId)
      return {
        stepId: candidate.stepId,
        plan: candidate.plan,
        model: effectiveExecutionModel(
          board,
          board.cards.find((card) => card.id === candidate.plan.rootCardId)?.model,
        ),
        task: compiled.sections.task,
        context: compiled.preview.context.map((entry) => entry.groupMode === 'compress'
          ? {
              ...entry,
              digestSource: groupDigestSourceFingerprint(board, entry.cardId),
            }
          : entry),
        mods: compiled.preview.mods,
        appliedMods: compiled.appliedMods,
      }
    }),
  })}`
}

function groupDigestSourceFingerprint(board: SavedBoard, groupId: string): string | undefined {
  const group = cardById(board, groupId)
  if (!group || group.kind !== 'group') return undefined
  const members = membersOf(board, groupId)
  const model = resolveProfileReviewModel(group.model || boardAiSettingsOf(board)?.model || '')
  return groupDigestCacheKey(board, group, members, model)
}

function validPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function validRunId(value: string): boolean {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= 256
}

function invalidReservation(): AgentRunReservationResult {
  return Object.freeze({
    ok: false,
    code: 'invalid-reservation',
    retryable: false,
    message: AGENT_RUN_INVALID_RESERVATION_MESSAGE,
  })
}

function budgetExhausted(usage: AgentRunSessionUsage): AgentRunReservationFailure {
  return Object.freeze({
    ok: false,
    code: 'budget-exhausted',
    retryable: false,
    message: AGENT_RUN_BUDGET_EXHAUSTED_MESSAGE,
    usage,
  })
}
