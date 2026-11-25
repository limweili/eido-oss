import {
  PROFILE_AGENT_RUN_BRIDGE_VERSION,
  type ProfileAgentRunOperation,
  type ProfileAgentRunWireRequest,
  type ProfileAgentRunWireRequestFor,
  type ProfileAgentRunWireResponse,
  type ProfileAgentRunWireResponseFor,
} from '../../electron/profileAgentRunBridgeContract'
import {
  AGENT_RUN_CONTRACT_VERSION,
  AGENT_RUN_INTERNAL_MESSAGE,
  AGENT_RUN_LIVE_REQUIRED_MESSAGE,
  AGENT_RUN_SUBMIT_OUTCOME_UNKNOWN_MESSAGE,
  type AgentRunLiveService,
  type AgentRunServiceFailure,
  type AgentRunSubmissionReceipt,
} from '../brain/agentRunContract'
import {
  createAgentRunAdmissionOwner,
  createAgentRunJobRegistry,
  createAgentRunSessionService,
  type AgentRunAppCap,
  type AgentRunGrantPolicy,
  type AgentRunJobRegistry,
  type AgentRunSessionCap,
  type AgentRunSessionServiceOptions,
} from '../brain/agentRunSession'
import type { SavedBoard } from '../graph/types'

export const DEFAULT_PROFILE_AGENT_RUN_RENDERER_SERVICE_CACHE = Object.freeze({
  maxRetainedServices: 256,
})

export type ProfileAgentRunRendererServiceOptions = Readonly<{
  isLive(): boolean
  readBoard(ideaId: string): SavedBoard | undefined
  execute: AgentRunSessionServiceOptions['execute']
  createRunId?: () => string
  now?: () => string
  maxRetainedServices?: number
  admission?: Readonly<{
    sessionCap?: AgentRunSessionCap
    appCap?: AgentRunAppCap
    grantPolicy?: AgentRunGrantPolicy
  }>
  jobRetention?: Readonly<{
    maxRetainedJobs?: number
  }>
}>

export type ProfileAgentRunRendererServiceStatus = Readonly<{
  maxRetainedServices: number
  retainedServices: number
  admission: ReturnType<ReturnType<typeof createAgentRunAdmissionOwner>['appStatus']>
  jobs: ReturnType<AgentRunJobRegistry['status']>
}>

export type ProfileAgentRunRendererService = Readonly<{
  dispatch<Operation extends ProfileAgentRunOperation>(
    request: ProfileAgentRunWireRequestFor<Operation>,
  ): Promise<ProfileAgentRunWireResponseFor<Operation>>
  sessionStatus(
    sessionId: string,
  ): ReturnType<ReturnType<typeof createAgentRunAdmissionOwner>['sessionStatus']>
  resolveGrant(
    sessionId: string,
    decision: 'approved' | 'denied',
  ): ReturnType<ReturnType<typeof createAgentRunAdmissionOwner>['resolveGrant']>
  status(): ProfileAgentRunRendererServiceStatus
  /** Stops admission synchronously, then joins every accepted job. */
  close(): Promise<void>
}>

/**
 * Renderer-app lifetime owner for delegated runs. Credentials stay captured by
 * the injected ordinary execution adapter; this surface only accepts bounded
 * attribution and job messages that already crossed the trusted main seam.
 */
export function createProfileAgentRunRendererService(
  options: ProfileAgentRunRendererServiceOptions,
): ProfileAgentRunRendererService {
  const maxRetainedServices = requireServiceLimit(
    options.maxRetainedServices
      ?? DEFAULT_PROFILE_AGENT_RUN_RENDERER_SERVICE_CACHE.maxRetainedServices,
  )
  const admissionOwner = createAgentRunAdmissionOwner(options.admission)
  const jobs = createAgentRunJobRegistry(options.jobRetention)
  const services = new Map<string, AgentRunLiveService>()
  const pendingJobs = new Set<Promise<void>>()
  let admitting = true
  let closePromise: Promise<void> | undefined

  const service = Object.freeze({
    dispatch: <Operation extends ProfileAgentRunOperation>(
      request: ProfileAgentRunWireRequestFor<Operation>,
    ): Promise<ProfileAgentRunWireResponseFor<Operation>> => {
      return dispatchOne(request as ProfileAgentRunWireRequest) as Promise<
        ProfileAgentRunWireResponseFor<Operation>
      >
    },
    sessionStatus: admissionOwner.sessionStatus,
    resolveGrant: admissionOwner.resolveGrant,
    status: (): ProfileAgentRunRendererServiceStatus => Object.freeze({
      maxRetainedServices,
      retainedServices: services.size,
      admission: admissionOwner.appStatus(),
      jobs: jobs.status(),
    }),
    close(): Promise<void> {
      if (closePromise) return closePromise
      admitting = false
      closePromise = drainPendingJobs()
      return closePromise
    },
  })
  return service

  async function dispatchOne(
    request: ProfileAgentRunWireRequest,
  ): Promise<ProfileAgentRunWireResponse> {
    if (!rendererIsLive()) {
      return responseForFailure(request, Object.freeze({
        ok: false,
        code: 'live-app-required',
        retryable: true,
        message: AGENT_RUN_LIVE_REQUIRED_MESSAGE,
      }))
    }
    try {
      const actorService = serviceFor(request)
      if (request.operation === 'run.submit') {
        const result = await actorService.submit(request.payload)
        // Admission has already happened by the time a successful receipt is
        // returned. Preserve the non-retryable outcome-unknown rule if the
        // renderer generated an invalid receipt, without retaining the full
        // main-process response decoder in this bundle.
        if (result.ok && !validSubmitReceipt(result.value)) {
          throw new Error('Agent run renderer receipt is invalid')
        }
        return createRendererWireResponse(
          request.token,
          request.operation,
          result,
        )
      }
      if (request.operation === 'run.status') {
        return createRendererWireResponse(
          request.token,
          request.operation,
          await actorService.status(request.payload),
        )
      }
      return createRendererWireResponse(
        request.token,
        request.operation,
        await actorService.read(request.payload),
      )
    } catch {
      return responseForFailure(request, Object.freeze({
        ok: false,
        code: 'internal',
        retryable: request.operation !== 'run.submit',
        message: request.operation === 'run.submit'
          ? AGENT_RUN_SUBMIT_OUTCOME_UNKNOWN_MESSAGE
          : AGENT_RUN_INTERNAL_MESSAGE,
      }))
    }
  }

  function serviceFor(request: ProfileAgentRunWireRequest): AgentRunLiveService {
    const key = actorKey(request.actor.client, request.actor.sessionId)
    const existing = services.get(key)
    if (existing) {
      // Refresh insertion order so the bounded cache evicts the least recently
      // used adapter, never app-scoped admission or job state.
      services.delete(key)
      services.set(key, existing)
      return existing
    }
    if (services.size >= maxRetainedServices) {
      const oldest = services.keys().next().value as string | undefined
      if (oldest !== undefined) services.delete(oldest)
    }
    const created = createAgentRunSessionService({
      actor: request.actor,
      admissionOwner,
      jobs,
      isLive: options.isLive,
      readBoard: options.readBoard,
      execute: options.execute,
      trackJob(job) {
        pendingJobs.add(job)
        void job.finally(() => pendingJobs.delete(job)).catch(() => undefined)
      },
      ...(options.createRunId === undefined ? {} : { createRunId: options.createRunId }),
      ...(options.now === undefined ? {} : { now: options.now }),
    })
    services.set(key, created)
    return created
  }

  function rendererIsLive(): boolean {
    if (!admitting) return false
    try {
      return options.isLive() === true
    } catch {
      return false
    }
  }

  async function drainPendingJobs(): Promise<void> {
    while (pendingJobs.size > 0) {
      await Promise.allSettled([...pendingJobs])
    }
  }
}

function responseForFailure(
  request: ProfileAgentRunWireRequest,
  failure: AgentRunServiceFailure,
): ProfileAgentRunWireResponse {
  if (request.operation === 'run.submit') {
    return createRendererWireResponse(request.token, request.operation, failure)
  }
  if (request.operation === 'run.status') {
    return createRendererWireResponse(request.token, request.operation, failure)
  }
  return createRendererWireResponse(request.token, request.operation, failure)
}

/**
 * Main remains the trust seam that validates and bounds the complete response
 * before it reaches a socket client. Re-running that deep decoder over this
 * typed renderer-owned result retained main-only validation code here without
 * adding another authority decision.
 */
function createRendererWireResponse<Operation extends ProfileAgentRunOperation>(
  token: string,
  operation: Operation,
  result: ProfileAgentRunWireResponseFor<Operation>['result'],
): ProfileAgentRunWireResponseFor<Operation> {
  return Object.freeze({
    version: PROFILE_AGENT_RUN_BRIDGE_VERSION,
    kind: 'agent-run-response',
    token,
    operation,
    result,
  })
}

function validSubmitReceipt(candidate: AgentRunSubmissionReceipt): boolean {
  return candidate.version === AGENT_RUN_CONTRACT_VERSION
    && candidate.status === 'queued'
    && boundedIdentity(candidate.runId)
    && boundedIdentity(candidate.ideaId)
    && boundedIdentity(candidate.targetCardId)
    && boundedIdentity(candidate.submittedAt)
    && candidate.actor.kind === 'agent'
    && boundedIdentity(candidate.actor.client)
    && boundedIdentity(candidate.actor.sessionId)
    && validIds(candidate.plannedStepIds)
    && validIds(candidate.reusedStepIds)
}

function validIds(candidate: readonly string[]): boolean {
  return Array.isArray(candidate) && candidate.every(boundedIdentity)
}

function boundedIdentity(candidate: string): boolean {
  return typeof candidate === 'string'
    && candidate.length > 0
    && new TextEncoder().encode(candidate).byteLength <= 256
}

function actorKey(client: string, sessionId: string): string {
  return `${client.length}:${client}${sessionId}`
}

function requireServiceLimit(candidate: number): number {
  if (!Number.isSafeInteger(candidate) || candidate <= 0 || candidate > 1_024) {
    throw new Error('Profile Agent run renderer service limit is invalid')
  }
  return candidate
}
