import {
  AGENT_RUN_INTERNAL_MESSAGE,
  AGENT_RUN_INVALID_REQUEST_MESSAGE,
  AGENT_RUN_LIVE_REQUIRED_MESSAGE,
  AGENT_RUN_SUBMIT_OUTCOME_UNKNOWN_MESSAGE,
  type AgentRunActor,
  type AgentRunServiceFailure,
} from '../src/brain/agentRunContract'
import {
  assertProfileAgentRunWireResponse,
  createProfileAgentRunWireRequest,
  PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
  type ProfileAgentRunOperation,
  type ProfileAgentRunWireRequest,
  type ProfileAgentRunWireRequestFor,
  type ProfileAgentRunWireResponse,
  type ProfileAgentRunWireResponseFor,
} from './profileAgentRunBridgeContract'
import {
  isTrustedAppUrl,
  type ProfileBridgeEvent,
  type ProfileBridgeWebContents,
} from './security'

export const DEFAULT_PROFILE_AGENT_RUN_RENDERER_TIMEOUT_MS = 10_000
export const DEFAULT_PROFILE_AGENT_RUN_MAX_PENDING_REQUESTS = 256

export type ProfileAgentRunRendererBrokerIpc = Readonly<{
  on(
    channel: typeof PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
    listener: (event: ProfileBridgeEvent, ...args: unknown[]) => void,
  ): unknown
  removeListener(
    channel: typeof PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
    listener: (event: ProfileBridgeEvent, ...args: unknown[]) => void,
  ): unknown
}>

export type ProfileAgentRunRendererBrokerTarget = ProfileBridgeWebContents & Readonly<{
  send(channel: typeof PROFILE_AGENT_RUN_BRIDGE_CHANNEL, message: unknown): void
  isDestroyed?(): boolean
}>

export type ProfileAgentRunRendererBroker = Readonly<{
  dispatch<Operation extends ProfileAgentRunOperation>(
    actor: AgentRunActor,
    operation: Operation,
    payload: ProfileAgentRunWireRequestFor<Operation>['payload'],
  ): Promise<ProfileAgentRunWireResponseFor<Operation>['result']>
  close(): void
}>

type PendingRequest = Readonly<{
  operation: ProfileAgentRunOperation
  request: ProfileAgentRunWireRequest
  timer: ReturnType<typeof setTimeout>
  resolve(result: ProfileAgentRunWireResponse['result']): void
}>

/**
 * Main-owned request broker for the one trusted packaged renderer.
 *
 * The authenticated local-socket actor is a separate argument and is placed
 * outside the caller payload. A single listener correlates the exact token and
 * operation, bounds retained work, and contains timeout/teardown without ever
 * replaying a renderer request whose admission may be unknown.
 */
export function createProfileAgentRunRendererBroker(options: Readonly<{
  ipc: ProfileAgentRunRendererBrokerIpc
  target: ProfileAgentRunRendererBrokerTarget
  createToken(): string
  timeoutMs?: number
  maxPendingRequests?: number
}>): ProfileAgentRunRendererBroker {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROFILE_AGENT_RUN_RENDERER_TIMEOUT_MS
  const maxPendingRequests = options.maxPendingRequests
    ?? DEFAULT_PROFILE_AGENT_RUN_MAX_PENDING_REQUESTS
  requirePositiveBoundedInteger(timeoutMs, 60_000, 'timeout')
  requirePositiveBoundedInteger(maxPendingRequests, 1_024, 'pending-request limit')

  let admitting = true
  const pending = new Map<string, PendingRequest>()

  const onResponse = (event: ProfileBridgeEvent, ...args: unknown[]): void => {
    let response: ProfileAgentRunWireResponse
    try {
      response = assertTrustedResponse(event, options.target, args)
    } catch {
      return
    }
    const retained = pending.get(response.token)
    if (!retained || retained.operation !== response.operation) return
    pending.delete(response.token)
    clearTimeout(retained.timer)
    retained.resolve(responseCorrelates(retained.request, response)
      ? response.result
      : retained.operation === 'run.submit'
        ? submitOutcomeUnknown()
        : internalFailure())
  }
  options.ipc.on(PROFILE_AGENT_RUN_BRIDGE_CHANNEL, onResponse)

  const broker: ProfileAgentRunRendererBroker = Object.freeze({
    dispatch: <Operation extends ProfileAgentRunOperation>(
      actor: AgentRunActor,
      operation: Operation,
      payload: ProfileAgentRunWireRequestFor<Operation>['payload'],
    ): Promise<ProfileAgentRunWireResponseFor<Operation>['result']> => {
      if (!admitting || targetUnavailable(options.target)) {
        return Promise.resolve(liveRequired()) as Promise<
          ProfileAgentRunWireResponseFor<Operation>['result']
        >
      }
      if (pending.size >= maxPendingRequests) {
        return Promise.resolve(internalFailure()) as Promise<
          ProfileAgentRunWireResponseFor<Operation>['result']
        >
      }

      let request: ProfileAgentRunWireRequestFor<Operation>
      try {
        request = createProfileAgentRunWireRequest(
          options.createToken(),
          actor,
          operation,
          payload,
        )
      } catch {
        return Promise.resolve(invalidFailure()) as Promise<
          ProfileAgentRunWireResponseFor<Operation>['result']
        >
      }
      if (pending.has(request.token)) {
        return Promise.resolve(internalFailure()) as Promise<
          ProfileAgentRunWireResponseFor<Operation>['result']
        >
      }

      return new Promise<ProfileAgentRunWireResponseFor<Operation>['result']>((resolve) => {
        const finish = (result: ProfileAgentRunWireResponse['result']): void => {
          resolve(result as ProfileAgentRunWireResponseFor<Operation>['result'])
        }
        const timer = setTimeout(() => {
          const retained = pending.get(request.token)
          if (!retained || retained.operation !== operation) return
          pending.delete(request.token)
          retained.resolve(operation === 'run.submit'
            ? submitOutcomeUnknown()
            : internalFailure())
        }, timeoutMs)
        pending.set(request.token, Object.freeze({
          operation,
          request: request as ProfileAgentRunWireRequest,
          timer,
          resolve: finish,
        }))
        try {
          options.target.send(PROFILE_AGENT_RUN_BRIDGE_CHANNEL, request)
        } catch {
          const retained = pending.get(request.token)
          if (!retained) return
          pending.delete(request.token)
          clearTimeout(retained.timer)
          retained.resolve(operation === 'run.submit'
            ? submitOutcomeUnknown()
            : targetUnavailable(options.target) ? liveRequired() : internalFailure())
        }
      })
    },
    close(): void {
      if (!admitting) return
      admitting = false
      options.ipc.removeListener(PROFILE_AGENT_RUN_BRIDGE_CHANNEL, onResponse)
      for (const retained of pending.values()) {
        clearTimeout(retained.timer)
        retained.resolve(retained.operation === 'run.submit'
          ? submitOutcomeUnknown()
          : liveRequired())
      }
      pending.clear()
    },
  })
  return broker
}

function responseCorrelates(
  request: ProfileAgentRunWireRequest,
  response: ProfileAgentRunWireResponse,
): boolean {
  if (!response.result.ok) return true
  if (request.operation === 'run.submit' && response.operation === 'run.submit') {
    return response.result.value.ideaId === request.payload.ideaId
      && response.result.value.targetCardId === request.payload.targetCardId
      && sameActor(response.result.value.actor, request.actor)
  }
  if (request.operation === 'run.status' && response.operation === 'run.status') {
    return response.result.value.runId === request.payload.runId
  }
  return request.operation === 'run.read'
    && response.operation === 'run.read'
    && response.result.value.runId === request.payload.runId
}

function sameActor(left: AgentRunActor, right: AgentRunActor): boolean {
  return left.kind === right.kind
    && left.client === right.client
    && left.sessionId === right.sessionId
}

function assertTrustedResponse(
  event: ProfileBridgeEvent,
  target: ProfileAgentRunRendererBrokerTarget,
  args: readonly unknown[],
): ProfileAgentRunWireResponse {
  if (event.sender !== target
    || event.senderFrame === null
    || event.senderFrame !== target.mainFrame
    || !isTrustedAppUrl(event.senderFrame.url)
    || args.length !== 1) {
    throw new Error('Profile Agent run response was denied')
  }
  return assertProfileAgentRunWireResponse(args[0])
}

function targetUnavailable(target: ProfileAgentRunRendererBrokerTarget): boolean {
  try {
    return target.isDestroyed?.() === true
  } catch {
    return true
  }
}

function liveRequired(): AgentRunServiceFailure {
  return Object.freeze({
    ok: false,
    code: 'live-app-required',
    retryable: true,
    message: AGENT_RUN_LIVE_REQUIRED_MESSAGE,
  })
}

function invalidFailure(): AgentRunServiceFailure {
  return Object.freeze({
    ok: false,
    code: 'invalid',
    retryable: false,
    message: AGENT_RUN_INVALID_REQUEST_MESSAGE,
  })
}

function internalFailure(): AgentRunServiceFailure {
  return Object.freeze({
    ok: false,
    code: 'internal',
    retryable: true,
    message: AGENT_RUN_INTERNAL_MESSAGE,
  })
}

function submitOutcomeUnknown(): AgentRunServiceFailure {
  return Object.freeze({
    ok: false,
    code: 'internal',
    retryable: false,
    message: AGENT_RUN_SUBMIT_OUTCOME_UNKNOWN_MESSAGE,
  })
}

function requirePositiveBoundedInteger(candidate: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(candidate) || candidate <= 0 || candidate > maximum) {
    throw new Error(`Profile Agent run renderer ${label} is invalid`)
  }
}
