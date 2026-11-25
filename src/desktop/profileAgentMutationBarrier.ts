import type { InstalledProfileBridge } from '../../electron/profileBridgeContract'
import {
  PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT,
  PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT,
  type ProfileRendererAgentBarrierAck,
  type ProfileRendererAgentBarrierRequest,
} from '../../electron/profileBridgeContract'
import type {
  ProfileRendererCommitState,
  ProfileRendererPersistence,
} from '../graph/profileRendererPersistence'

export type ProfileAgentMutationBarrierOptions = Readonly<{
  maxApplyAttempts?: number
  waitForRetry?: () => Promise<void>
  acquireExecutionLease?: () => Promise<() => void>
  onTerminalFailure?: (error: Error) => void
  freezeMutationAdmission?: () => void
}>

type ProfileRendererAgentBarrierFinishRequest = Extract<
  ProfileRendererAgentBarrierRequest,
  Readonly<{ phase: 'complete' | 'cancel' }>
>

/**
 * Holds renderer-first persistence before main admits a live Agent mutation,
 * then applies/acknowledges the authoritative revision before draining the
 * held renderer delta onto that new base.
 */
export function registerProfileAgentMutationBarrierHandler(
  target: EventTarget,
  bridge: InstalledProfileBridge,
  persistence: Pick<
    ProfileRendererPersistence,
    | 'applyAuthoritativeSnapshot'
    | 'beginAuthoritativeMutation'
    | 'sealAuthoritativeMutation'
    | 'finishAuthoritativeMutation'
  >,
  captureCurrentState: () => ProfileRendererCommitState,
  options: ProfileAgentMutationBarrierOptions = {},
): () => void {
  const maxApplyAttempts = requireAttemptLimit(options.maxApplyAttempts ?? 5)
  const waitForRetry = options.waitForRetry ?? nextTask
  let registered = true
  let activeToken: string | undefined
  let activeCheckpoint: Awaited<ReturnType<ProfileRendererPersistence['beginAuthoritativeMutation']>> | undefined
  let sealedCheckpoint: Awaited<ReturnType<ProfileRendererPersistence['sealAuthoritativeMutation']>> | undefined
  let appliedAcknowledgement: Readonly<{ epoch: string; revision: number }> | undefined
  let authorityAcknowledged = false
  let completed: ProfileRendererAgentBarrierFinishRequest | undefined
  let inFlight: Readonly<{ key: string; promise: Promise<void> }> | undefined
  let pendingCancelToken: string | undefined
  let terminalFailureReported = false
  let releaseExecutionLease: (() => void) | undefined

  const acknowledge = (ack: ProfileRendererAgentBarrierAck): void => {
    if (!registered) return
    target.dispatchEvent(new CustomEvent(PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT, {
      detail: Object.freeze(ack),
    }))
  }

  const fail = (request: ProfileRendererAgentBarrierRequest, _error: unknown): void => {
    acknowledge(Object.freeze({ token: request.token, phase: request.phase, ok: false }))
  }

  const reportTerminalFailure = (error: unknown): void => {
    if (terminalFailureReported) return
    terminalFailureReported = true
    try {
      options.onTerminalFailure?.(error instanceof Error
        ? error
        : new Error('Profile Agent mutation barrier failed'))
    } catch {
      // Terminal failure observation cannot change renderer authority state.
    }
  }

  const clearActiveBarrier = (request: ProfileRendererAgentBarrierFinishRequest): void => {
    const release = releaseExecutionLease
    releaseExecutionLease = undefined
    release?.()
    completed = request
    activeToken = undefined
    activeCheckpoint = undefined
    sealedCheckpoint = undefined
    appliedAcknowledgement = undefined
    authorityAcknowledged = false
  }

  const finishActiveBarrier = async (
    request: ProfileRendererAgentBarrierFinishRequest,
  ): Promise<void> => {
    await persistence.finishAuthoritativeMutation()
    clearActiveBarrier(request)
    acknowledge(Object.freeze({ token: request.token, phase: request.phase, ok: true }))
  }

  const applyAuthoritativeRevision = async (
    revision: number,
  ): Promise<Readonly<{ epoch: string; revision: number }>> => {
    if (appliedAcknowledgement?.revision === revision) return appliedAcknowledgement
    let lastError: unknown
    for (let attempt = 1; registered && attempt <= maxApplyAttempts; attempt += 1) {
      try {
        const hydrated = await bridge.hydrate()
        if (!hydrated.ok || hydrated.value.snapshot.revision !== revision) {
          throw new Error('Profile Agent hydration did not match the committed revision')
        }
        const applied = persistence.applyAuthoritativeSnapshot(hydrated.value.snapshot)
        if (applied.status === 'blocked') {
          throw new Error('Profile Agent authoritative apply remained blocked')
        }
        if (applied.status !== 'applied' || applied.revision !== revision) {
          throw new Error('Profile Agent authoritative apply was inexact')
        }
        appliedAcknowledgement = Object.freeze({
          epoch: hydrated.value.acknowledgement.epoch,
          revision: hydrated.value.acknowledgement.revision,
        })
        return appliedAcknowledgement
      } catch (error) {
        lastError = error
        if (attempt < maxApplyAttempts) await waitForRetry()
      }
    }
    throw lastError ?? new Error('Profile Agent authoritative apply was disposed')
  }

  const handle = async (request: ProfileRendererAgentBarrierRequest): Promise<void> => {
    try {
      if (request.phase === 'begin') {
        if (activeToken === request.token && activeCheckpoint) {
          acknowledge(Object.freeze({
            token: request.token,
            phase: request.phase,
            ok: true,
            ...activeCheckpoint,
          }))
          return
        }
        if (activeToken !== undefined) {
          throw new Error('Another Profile Agent mutation barrier is active')
        }
        activeToken = request.token
        releaseExecutionLease = await options.acquireExecutionLease?.()
        const checkpoint = await persistence.beginAuthoritativeMutation(captureCurrentState())
        activeCheckpoint = checkpoint
        acknowledge(Object.freeze({
          token: request.token,
          phase: request.phase,
          ok: true,
          ...checkpoint,
        }))
        if (pendingCancelToken === request.token) {
          pendingCancelToken = undefined
          const cancel = Object.freeze({ token: request.token, phase: 'cancel' as const })
          try {
            await finishActiveBarrier(cancel)
          } catch (error) {
            fail(cancel, error)
          }
        }
        return
      }
      if (activeToken !== request.token) {
        throw new Error('Profile Agent mutation barrier token changed')
      }
      if (request.phase === 'seal') {
        if (!sealedCheckpoint) {
          options.freezeMutationAdmission?.()
          sealedCheckpoint = await persistence.sealAuthoritativeMutation(captureCurrentState())
        }
        acknowledge(Object.freeze({
          token: request.token,
          phase: request.phase,
          ok: true,
          ...sealedCheckpoint,
        }))
        return
      }
      if (request.phase === 'complete') {
        const acknowledgement = await applyAuthoritativeRevision(request.revision)
        if (!authorityAcknowledged) {
          const acknowledged = await bridge.ackHydration(
            acknowledgement.epoch,
            acknowledgement.revision,
          )
          if (!acknowledged.ok
            || acknowledged.value.acknowledged !== true
            || acknowledged.value.epoch !== acknowledgement.epoch
            || acknowledged.value.revision !== acknowledgement.revision) {
            throw new Error('Profile Agent hydration acknowledgement failed')
          }
          authorityAcknowledged = true
        }
      } else if (appliedAcknowledgement) {
        throw new Error('Committed Profile Agent authority cannot be cancelled')
      }
      await finishActiveBarrier(request)
    } catch (error) {
      if (request.phase === 'begin') {
        const pendingCancel = pendingCancelToken === request.token
        pendingCancelToken = undefined
        activeToken = undefined
        activeCheckpoint = undefined
        sealedCheckpoint = undefined
        const release = releaseExecutionLease
        releaseExecutionLease = undefined
        release?.()
        if (pendingCancel) {
          acknowledge(Object.freeze({ token: request.token, phase: 'cancel', ok: false }))
        }
      }
      fail(request, error)
    }
  }

  const listener: EventListener = (event) => {
    const request = readBarrierRequest((event as CustomEvent<unknown>).detail)
    if (!request) return
    if (sameBarrierRequest(completed, request)) {
      if (request.phase === 'begin') {
        fail(request, new Error('Completed Profile Agent barriers cannot replay begin'))
        return
      }
      if (request.phase === 'seal') {
        fail(request, new Error('Completed Profile Agent barriers cannot replay seal'))
        return
      }
      acknowledge(Object.freeze({ token: request.token, phase: request.phase, ok: true }))
      return
    }
    const key = barrierRequestKey(request)
    if (inFlight) {
      if (request.phase === 'cancel'
        && activeToken === request.token
        && inFlight.key === barrierRequestKey({ token: request.token, phase: 'begin' })) {
        pendingCancelToken = request.token
      } else if (inFlight.key !== key) {
        fail(request, new Error('Another Profile Agent barrier phase is active'))
      }
      return
    }
    const promise = handle(request).finally(() => {
      if (inFlight?.promise === promise) inFlight = undefined
    })
    inFlight = Object.freeze({ key, promise })
  }
  target.addEventListener(PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT, listener)
  return () => {
    const abandonedToken = activeToken
    registered = false
    target.removeEventListener(PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT, listener)
    if (abandonedToken !== undefined) {
      reportTerminalFailure(new Error(
        `Profile Agent mutation barrier ${abandonedToken} was disposed while active`,
      ))
    }
  }
}

function barrierRequestKey(request: ProfileRendererAgentBarrierRequest): string {
  return `${request.token}:${request.phase}:${request.phase === 'complete' ? request.revision : ''}`
}

function sameBarrierRequest(
  left: ProfileRendererAgentBarrierRequest | undefined,
  right: ProfileRendererAgentBarrierRequest,
): boolean {
  return left?.token === right.token
    && left.phase === right.phase
    && (left.phase !== 'complete'
      || (right.phase === 'complete' && left.revision === right.revision))
}

function readBarrierRequest(candidate: unknown): ProfileRendererAgentBarrierRequest | undefined {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
  const record = candidate as Record<string, unknown>
  if (typeof record.token !== 'string'
    || record.token.length === 0
    || record.token.length > 256
    || (record.phase !== 'begin'
      && record.phase !== 'seal'
      && record.phase !== 'complete'
      && record.phase !== 'cancel')) {
    return undefined
  }
  if (record.phase === 'complete') {
    return Object.keys(record).length === 3
      && Number.isSafeInteger(record.revision)
      && Number(record.revision) >= 0
      ? Object.freeze({ token: record.token, phase: record.phase, revision: Number(record.revision) })
      : undefined
  }
  return Object.keys(record).length === 2
    ? Object.freeze({ token: record.token, phase: record.phase })
    : undefined
}

function requireAttemptLimit(candidate: number): number {
  if (!Number.isSafeInteger(candidate) || candidate <= 0 || candidate > 100) {
    throw new Error('Profile Agent barrier attempt limit is invalid')
  }
  return candidate
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
