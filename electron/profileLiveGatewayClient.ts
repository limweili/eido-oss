import { spawn } from 'node:child_process'
import {
  type ProfileGatewayRequest,
  type ProfileGatewayResponse,
} from '../src/persistence/profileAgentGateway'
import { PROFILE_GATEWAY_PROTOCOL_VERSION } from '../src/persistence/profileServiceContract'
import type { ProfileInstallation } from './profileInstallation'
import type {
  ProfileLiveGatewayLocator,
  ProfileLiveGatewayPlatform,
} from './profileLiveGatewayLocator'
import { readProfileLiveGatewayLocator } from './profileLiveGatewayLocatorStore'
import {
  PROFILE_LIVE_GATEWAY_HELPER_EXIT,
  classifyProfileLiveGatewayHelperTermination,
  type ProfileLiveGatewayHelperTermination,
} from './profileLiveGatewayNativeHelper'
import {
  PROFILE_LIVE_GATEWAY_LIMITS,
  createProfileLiveGatewayHello,
  decodeProfileLiveGatewayFrame,
  encodeProfileLiveGatewayFrame,
  parseProfileLiveGatewayDenied,
  parseProfileLiveGatewayReady,
} from './profileLiveGatewayProtocol'
import {
  ProfileLiveGatewayStreamReader,
  writeProfileLiveGatewayBytes,
} from './profileLiveGatewayStream'
import {
  classifyProfileLiveGatewayAbsent,
  classifyProfileLiveGatewayServed,
  classifyProfileLiveGatewayUnavailable,
  type ProfileLiveGatewayClient,
  type ProfileLiveGatewayInvocationResult,
} from './profileLiveGatewayTransport'
import type { ProfileLiveGatewayHelperProcess } from './profileLiveGatewayServer'

const DEFAULT_CLIENT_EXIT_TIMEOUT_MS = 5_000
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000
const DEFAULT_INVOCATION_TIMEOUT_MS = 30_000
const MAX_PRE_ADMISSION_ATTEMPTS = 2
const BOUNDED_TIMEOUT = Symbol('profile-live-gateway-timeout')

type ProfileLiveGatewayAttempt =
  | Readonly<{
    state: 'complete'
    result: ProfileLiveGatewayInvocationResult
  }>
  | Readonly<{
    state: 'retry-pre-admission'
    result: ProfileLiveGatewayInvocationResult
  }>

export type ProfileLiveGatewayClientOptions = Readonly<{
  installation: ProfileInstallation
  platform: ProfileLiveGatewayPlatform
  helperPath: string
  spawnHelper?: (
    helperPath: string,
    args: readonly string[],
  ) => ProfileLiveGatewayHelperProcess
  helperExitTimeoutMs?: number
  handshakeTimeoutMs?: number
  invocationTimeoutMs?: number
}>

export function createProfileLiveGatewayClient(
  options: ProfileLiveGatewayClientOptions,
): ProfileLiveGatewayClient {
  const helperExitTimeoutMs = requireTimeout(
    options.helperExitTimeoutMs ?? DEFAULT_CLIENT_EXIT_TIMEOUT_MS,
  )
  const handshakeTimeoutMs = requireTimeout(
    options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
  )
  const invocationTimeoutMs = requireTimeout(
    options.invocationTimeoutMs ?? DEFAULT_INVOCATION_TIMEOUT_MS,
  )
  const spawnHelper = options.spawnHelper ?? defaultSpawnHelper

  const invokeLocated = async (
    locator: ProfileLiveGatewayLocator,
    request: ProfileGatewayRequest,
    identity: Readonly<{ client: string; sessionId: string }>,
  ): Promise<ProfileLiveGatewayAttempt> => {
    let child: ProfileLiveGatewayHelperProcess
    try {
      child = spawnHelper(options.helperPath, ['--client', locator.endpoint])
    } catch {
      return complete(classifyProfileLiveGatewayUnavailable('transport-failure', 'none'))
    }
    const termination = waitForClientTermination(child)
    const reader = new ProfileLiveGatewayStreamReader(child.stdout, {
      maxPayloadBytes: PROFILE_LIVE_GATEWAY_LIMITS.maxGatewayPayloadBytes,
    })
    let readyAccepted = false
    let requestWriteStarted = false
    try {
      const hello = encodeProfileLiveGatewayFrame(createProfileLiveGatewayHello({
        generation: locator.generation,
        token: locator.token,
        client: identity.client,
        sessionId: identity.sessionId,
      }), PROFILE_LIVE_GATEWAY_LIMITS.maxHandshakePayloadBytes)
      if (!hello.ok) {
        return complete(classifyProfileLiveGatewayUnavailable('protocol-failure', 'none'))
      }
      await writeProfileLiveGatewayBytes(child.stdin, hello.value)
      const readyMessage = await waitBounded(reader.read(), handshakeTimeoutMs)
      if (readyMessage === BOUNDED_TIMEOUT) {
        return complete(classifyProfileLiveGatewayUnavailable('transport-failure', 'none'))
      }
      if (!readyMessage) {
        const ended = await waitBounded(termination, helperExitTimeoutMs)
        if (ended === BOUNDED_TIMEOUT) {
          return complete(classifyProfileLiveGatewayUnavailable('disconnected', 'none'))
        }
        const result = classifyPreAdmissionTermination(ended)
        return isRetryablePreAdmissionTermination(ended)
          ? retryPreAdmission(result)
          : complete(result)
      }
      const decodedHandshake = readyMessage.kind === 'frame'
        ? decodeProfileLiveGatewayFrame(
          readyMessage.frame,
          PROFILE_LIVE_GATEWAY_LIMITS.maxHandshakePayloadBytes,
        )
        : undefined
      if (!decodedHandshake?.ok) {
        return complete(classifyProfileLiveGatewayUnavailable('protocol-failure', 'none'))
      }
      if (parseProfileLiveGatewayDenied(decodedHandshake.value, locator.generation)) {
        return complete(classifyProfileLiveGatewayUnavailable('token-rejected', 'none'))
      }
      if (!parseProfileLiveGatewayReady(decodedHandshake.value, locator.generation)) {
        return complete(classifyProfileLiveGatewayUnavailable('protocol-failure', 'none'))
      }
      readyAccepted = true
      const encodedRequest = encodeProfileLiveGatewayFrame(
        request,
        PROFILE_LIVE_GATEWAY_LIMITS.maxGatewayPayloadBytes,
      )
      if (!encodedRequest.ok) {
        return complete(classifyProfileLiveGatewayUnavailable('protocol-failure', 'none'))
      }
      requestWriteStarted = true
      await writeProfileLiveGatewayBytes(child.stdin, encodedRequest.value)
      const responseMessage = await waitBounded(reader.read(), invocationTimeoutMs)
      if (responseMessage === BOUNDED_TIMEOUT || !responseMessage) {
        return complete(classifyProfileLiveGatewayUnavailable('disconnected', 'unknown'))
      }
      const decodedResponse = responseMessage.kind === 'frame'
        ? decodeProfileLiveGatewayFrame(
          responseMessage.frame,
          PROFILE_LIVE_GATEWAY_LIMITS.maxGatewayPayloadBytes,
        )
        : undefined
      const response = decodedResponse?.ok
        ? parseCorrelatedGatewayResponse(decodedResponse.value, request)
        : undefined
      if (!response) {
        return complete(classifyProfileLiveGatewayUnavailable('protocol-failure', 'admitted'))
      }
      child.stdin.end()
      await waitBounded(termination, helperExitTimeoutMs)
      return complete(classifyProfileLiveGatewayServed(response))
    } catch {
      const settled = await waitBounded(termination, 25)
      if (!readyAccepted || !requestWriteStarted) {
        if (settled === BOUNDED_TIMEOUT) {
          return complete(classifyProfileLiveGatewayUnavailable('transport-failure', 'none'))
        }
        const result = classifyPreAdmissionTermination(settled)
        return isRetryablePreAdmissionTermination(settled)
          ? retryPreAdmission(result)
          : complete(result)
      }
      if (settled !== BOUNDED_TIMEOUT) {
        const classified = classifyProfileLiveGatewayHelperTermination(settled)
        return complete(classified.state === 'absent'
          ? classifyProfileLiveGatewayUnavailable('transport-failure', 'unknown')
          : classified)
      }
      return complete(classifyProfileLiveGatewayUnavailable('transport-failure', 'unknown'))
    } finally {
      if (!child.stdin.destroyed) child.stdin.destroy()
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    }
  }

  return Object.freeze({
    async invoke(request, identity): Promise<ProfileLiveGatewayInvocationResult> {
      let located = await readProfileLiveGatewayLocator(
        options.installation,
        options.platform,
      )
      if (located.state === 'absent') {
        return classifyProfileLiveGatewayAbsent(located.reason)
      }
      if (located.state === 'rejected') {
        return classifyProfileLiveGatewayUnavailable('locator-rejected', 'none')
      }
      // A retry is emitted only before a valid ready frame, while the Gateway
      // request still has zero bytes on the wire. Re-resolve so an orphaned
      // helper can withdraw its endpoint without risking duplicate mutation.
      for (let attempt = 0; attempt < MAX_PRE_ADMISSION_ATTEMPTS; attempt += 1) {
        const outcome = await invokeLocated(located.locator, request, identity)
        if (outcome.state === 'complete') return outcome.result
        if (attempt + 1 >= MAX_PRE_ADMISSION_ATTEMPTS) return outcome.result
        located = await readProfileLiveGatewayLocator(
          options.installation,
          options.platform,
        )
        if (located.state === 'absent') {
          return classifyProfileLiveGatewayAbsent(located.reason)
        }
        if (located.state === 'rejected') {
          return classifyProfileLiveGatewayUnavailable('locator-rejected', 'none')
        }
      }
      return classifyProfileLiveGatewayUnavailable('transport-failure', 'none')
    },
  })
}

function complete(
  result: ProfileLiveGatewayInvocationResult,
): ProfileLiveGatewayAttempt {
  return Object.freeze({ state: 'complete' as const, result })
}

function retryPreAdmission(
  result: ProfileLiveGatewayInvocationResult,
): ProfileLiveGatewayAttempt {
  return Object.freeze({ state: 'retry-pre-admission' as const, result })
}

function classifyPreAdmissionTermination(
  termination: ProfileLiveGatewayHelperTermination,
): ProfileLiveGatewayInvocationResult {
  if (termination.kind !== 'exit') {
    return classifyProfileLiveGatewayUnavailable('transport-failure', 'none')
  }
  switch (termination.code) {
    case PROFILE_LIVE_GATEWAY_HELPER_EXIT.endpointAbsent:
      return classifyProfileLiveGatewayAbsent('endpoint-not-found')
    case PROFILE_LIVE_GATEWAY_HELPER_EXIT.peerRejected:
      return classifyProfileLiveGatewayUnavailable('peer-rejected', 'none')
    case PROFILE_LIVE_GATEWAY_HELPER_EXIT.invalidFrame:
      return classifyProfileLiveGatewayUnavailable('protocol-failure', 'none')
    case PROFILE_LIVE_GATEWAY_HELPER_EXIT.transportFailed:
      return classifyProfileLiveGatewayUnavailable('transport-failure', 'unknown')
    case 0:
      return classifyProfileLiveGatewayUnavailable('disconnected', 'none')
    default:
      return classifyProfileLiveGatewayUnavailable('transport-failure', 'none')
  }
}

function isRetryablePreAdmissionTermination(
  termination: ProfileLiveGatewayHelperTermination,
): boolean {
  return termination.kind === 'exit'
    && (termination.code === 0
      || termination.code === PROFILE_LIVE_GATEWAY_HELPER_EXIT.transportFailed)
}

function defaultSpawnHelper(
  helperPath: string,
  args: readonly string[],
): ProfileLiveGatewayHelperProcess {
  return spawn(helperPath, [...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

function parseCorrelatedGatewayResponse(
  candidate: unknown,
  request: ProfileGatewayRequest,
): ProfileGatewayResponse | undefined {
  if (!isRecord(candidate)
    || candidate.version !== PROFILE_GATEWAY_PROTOCOL_VERSION
    || candidate.requestId !== request.requestId
    || typeof candidate.ok !== 'boolean') {
    return undefined
  }
  const expectedKeys = candidate.ok
    ? ['version', 'requestId', 'ok', 'result']
    : ['version', 'requestId', 'ok', 'error']
  if (!hasExactKeys(candidate, expectedKeys)) return undefined
  if (candidate.ok) {
    return isRecord(candidate.result) ? candidate as ProfileGatewayResponse : undefined
  }
  return isRecord(candidate.error) ? candidate as ProfileGatewayResponse : undefined
}

function waitForClientTermination(
  child: ProfileLiveGatewayHelperProcess,
): Promise<ProfileLiveGatewayHelperTermination> {
  if (child.exitCode !== null) {
    return Promise.resolve({ kind: 'exit', code: child.exitCode })
  }
  if (child.signalCode !== null) {
    return Promise.resolve({ kind: 'signal', signal: child.signalCode })
  }
  return new Promise((resolve) => {
    const finish = (termination: ProfileLiveGatewayHelperTermination): void => {
      child.off('error', onError)
      child.off('exit', onExit)
      resolve(termination)
    }
    const onError = (error: Error & { code?: string }): void => finish({
      kind: 'spawn-error',
      ...(error.code === undefined ? {} : { code: error.code }),
    })
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(code === null
        ? { kind: 'signal', signal: signal ?? 'unknown' }
        : { kind: 'exit', code })
    }
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

function requireTimeout(candidate: number): number {
  if (!Number.isSafeInteger(candidate) || candidate <= 0 || candidate > 60_000) {
    throw new Error('Profile Live Gateway client timeout is invalid')
  }
  return candidate
}

async function waitBounded<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
): Promise<Value | typeof BOUNDED_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<typeof BOUNDED_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(BOUNDED_TIMEOUT), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

function hasExactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(candidate)
  return keys.length === expected.length && expected.every((key) => (
    Object.prototype.hasOwnProperty.call(candidate, key)
  ))
}
