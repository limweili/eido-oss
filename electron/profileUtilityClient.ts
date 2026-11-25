import type {
  ProfileServiceFailure,
  ProfileServiceResult,
} from '../src/persistence/profileServiceContract'
import {
  PROFILE_QUERY_LIMITS,
  validateProfileQuery,
} from '../src/persistence/profileServiceContract'
import { isInstalledProfileAgentCommandBatchSuccessForRequest } from '../src/persistence/profileAgentCommandInstallation'
import {
  PROFILE_AGENT_CHANGE_TRAIL_LIMITS,
  validateProfileAgentChangeTrailRequest,
} from '../src/persistence/profileAgentChangeTrail'
import {
  normalizeProfileAgentCardNeighborsRequest,
  normalizeProfileAgentCardSetBoundsRequest,
  resolveProfileAgentCardAddresses,
} from '../src/persistence/profileAgentSpatialQuery'
import { validateProfileResultInspectionRequest } from '../src/persistence/profileResultInspection'
import {
  PROFILE_UTILITY_OPERATIONS,
  PROFILE_UTILITY_PROTOCOL_VERSION,
  assertProfileUtilityChildMessage,
  createProfileUtilityCloseAcknowledgement,
  createProfileUtilityInitialize,
  createProfileUtilityRequest,
  type ProfileUtilityChildMessage,
  type ProfileUtilityInitializePayload,
  type ProfileUtilityOperation,
  type ProfileUtilityOperationPayloads,
  type ProfileUtilityOperationResults,
  type ProfileUtilityReadyMessage,
  type ProfileUtilityRequestMessage,
  type ProfileUtilityResponseMessage,
} from './profileUtilityProtocol'

export const DEFAULT_PROFILE_UTILITY_READY_TIMEOUT_MS = 15_000
export const DEFAULT_PROFILE_UTILITY_MAX_PENDING_REQUESTS = 256
const PROFILE_UTILITY_REQUEST_ID_MAX_BYTES = 256
const PROFILE_UTILITY_REQUEST_SEQUENCE_MAX = Number.MAX_SAFE_INTEGER
const PROFILE_UTILITY_REQUEST_SEQUENCE_MAX_BYTES = new TextEncoder().encode(
  String(PROFILE_UTILITY_REQUEST_SEQUENCE_MAX),
).byteLength
const PROFILE_UTILITY_SESSION_NONCE_MAX_BYTES = PROFILE_UTILITY_REQUEST_ID_MAX_BYTES
  - PROFILE_UTILITY_REQUEST_SEQUENCE_MAX_BYTES
  - 1

export type ProfileUtilityTransport = Readonly<{
  postMessage(message: unknown): void
  kill(): boolean
  on(event: 'message' | 'exit', listener: (value: unknown) => void): unknown
  removeListener(event: 'message' | 'exit', listener: (value: unknown) => void): unknown
}>

export type ProfileUtilityClientOptions = Readonly<{
  initialize: ProfileUtilityInitializePayload
  createRequestId: () => string
  readyTimeoutMs?: number
  maxPendingRequests?: number
}>

export type ProfileUtilityTerminalLoss = Readonly<{
  error: Error
  phase: 'starting' | 'ready'
}>

export type ProfileUtilityExit = Readonly<{
  code: number | null
  signal?: string | null
}>

export type ProfileUtilityClient = Readonly<{
  ready(): Promise<ProfileUtilityReadyMessage>
  request<Operation extends ProfileUtilityOperation>(
    operation: Operation,
    payload: NoInfer<ProfileUtilityOperationPayloads[Operation]>,
  ): Promise<ProfileServiceResult<ProfileUtilityOperationResults[Operation]>>
  onTerminalLoss(listener: (loss: ProfileUtilityTerminalLoss) => void): () => void
  waitForExit(): Promise<ProfileUtilityExit>
  terminate(retry?: boolean): Promise<ProfileUtilityExit>
}>

type PendingRequest = {
  operation: ProfileUtilityOperation
  message: ProfileUtilityRequestMessage
  sent: boolean
  settle(response: ProfileUtilityResponseMessage): void
  reject(error: Error): void
}

type ProfileUtilityChildEnvelope =
  | Readonly<{ kind: 'ready' | 'fatal' }>
  | Readonly<{
      kind: 'response'
      requestId: string
      operation: ProfileUtilityOperation
    }>

const PROFILE_UTILITY_OPERATION_SET = new Set<unknown>(PROFILE_UTILITY_OPERATIONS)

export class ProfileUtilityClientError extends Error {
  constructor(
    readonly code:
      | 'early-exit'
      | 'fatal'
      | 'invalid-protocol'
      | 'not-ready'
      | 'request-capacity'
      | 'stopped'
      | 'transport-failure',
    message: string,
    readonly failure?: ProfileServiceFailure,
  ) {
    super(message)
    this.name = 'ProfileUtilityClientError'
  }
}

export function createProfileUtilityClient(
  transport: ProfileUtilityTransport,
  options: ProfileUtilityClientOptions,
): ProfileUtilityClient {
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_PROFILE_UTILITY_READY_TIMEOUT_MS
  const maxPendingRequests = options.maxPendingRequests
    ?? DEFAULT_PROFILE_UTILITY_MAX_PENDING_REQUESTS
  if (!Number.isSafeInteger(readyTimeoutMs) || readyTimeoutMs <= 0 || readyTimeoutMs > 60_000) {
    throw new Error('Profile utility ready timeout must be between 1 and 60000 milliseconds')
  }
  if (!Number.isSafeInteger(maxPendingRequests)
    || maxPendingRequests <= 0
    || maxPendingRequests > 4_096) {
    throw new Error('Profile utility pending request capacity is invalid')
  }

  let readyMessage: ProfileUtilityReadyMessage | undefined
  let terminalError: Error | undefined
  let expectedExit = false
  let exited: ProfileUtilityExit | undefined
  let killRequested = false
  const pending = new Map<string, PendingRequest>()
  let requestSessionNonce: string | undefined
  let requestSequence = 0
  const terminalListeners = new Set<(loss: ProfileUtilityTerminalLoss) => void>()
  let resolveReady!: (message: ProfileUtilityReadyMessage) => void
  let rejectReady!: (error: Error) => void
  let resolveExit!: (exit: ProfileUtilityExit) => void
  const readyPromise = new Promise<ProfileUtilityReadyMessage>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // Readiness may fail before a caller asks for it. Keep that failure observable
  // through ready()/request() without creating an unhandled rejection.
  void readyPromise.catch(() => undefined)
  const exitPromise = new Promise<ProfileUtilityExit>((resolve) => {
    resolveExit = resolve
  })

  const readyTimer = setTimeout(() => {
    failTerminal(new ProfileUtilityClientError(
      'not-ready',
      `Profile utility did not become ready within ${readyTimeoutMs} milliseconds`,
    ))
  }, readyTimeoutMs)

  function detachMessages(): void {
    transport.removeListener('message', onMessage)
  }

  function detachAll(): void {
    detachMessages()
    transport.removeListener('exit', onExit)
  }

  function requestKill(retry = false): ProfileUtilityClientError | undefined {
    if ((killRequested && !retry) || exited) return undefined
    try {
      const accepted = transport.kill()
      if (exited) return undefined
      if (!accepted) {
        return new ProfileUtilityClientError(
          'transport-failure',
          'Profile utility transport rejected termination',
        )
      }
      killRequested = true
    } catch {
      if (exited) return undefined
      return new ProfileUtilityClientError(
        'transport-failure',
        'Profile utility transport failed termination',
      )
    }
    return undefined
  }

  function failTerminal(error: Error, kill = true): void {
    if (terminalError) return
    terminalError = error
    clearTimeout(readyTimer)
    detachMessages()
    if (!readyMessage) rejectReady(error)
    const requests = [...pending.values()]
    pending.clear()
    requests.forEach((request) => request.reject(error))
    const loss = Object.freeze({
      error,
      phase: readyMessage ? 'ready' as const : 'starting' as const,
    })
    for (const listener of [...terminalListeners]) {
      try {
        listener(loss)
      } catch {
        // Terminal observation cannot change the already-failed authority state.
      }
    }
    if (kill) requestKill()
  }

  function postPending(request: PendingRequest): void {
    if (request.sent || terminalError || !readyMessage) return
    request.sent = true
    try {
      transport.postMessage(request.message)
    } catch {
      failTerminal(new ProfileUtilityClientError(
        'transport-failure',
        'Profile utility transport rejected a request',
      ))
    }
  }

  function onMessage(candidate: unknown): void {
    let envelope: ProfileUtilityChildEnvelope
    try {
      envelope = peekProfileUtilityChildEnvelope(candidate)
    } catch {
      failTerminal(new ProfileUtilityClientError(
        'invalid-protocol',
        'Profile utility sent an invalid protocol message',
      ))
      return
    }
    if (envelope.kind === 'response') {
      if (!readyMessage) {
        failTerminal(new ProfileUtilityClientError(
          'invalid-protocol',
          'Profile utility responded before readiness',
        ))
        return
      }
      const request = pending.get(envelope.requestId)
      if (!request || request.operation !== envelope.operation) {
        failTerminal(new ProfileUtilityClientError(
          'invalid-protocol',
          'Profile utility response did not match a pending request',
        ))
        return
      }
      let response: ProfileUtilityResponseMessage
      try {
        const message = assertProfileUtilityChildMessage(
          candidate,
          envelope.requestId,
          envelope.operation,
        )
        if (message.kind !== 'response') throw new Error('Response kind changed during decoding')
        response = message
      } catch {
        failTerminal(new ProfileUtilityClientError(
          'invalid-protocol',
          'Profile utility sent an invalid protocol message',
        ))
        return
      }
      pending.delete(envelope.requestId)
      if (response.operation === 'close' && response.result.ok && pending.size > 0) {
        const error = new ProfileUtilityClientError(
          'invalid-protocol',
          'Profile utility closed while other requests were pending',
        )
        request.reject(error)
        failTerminal(error)
        return
      }
      if (response.operation === 'close' && response.result.ok) {
        expectedExit = true
        try {
          transport.postMessage(createProfileUtilityCloseAcknowledgement(response.requestId))
        } catch {
          expectedExit = false
          const error = new ProfileUtilityClientError(
            'transport-failure',
            'Profile utility close acknowledgement could not be delivered',
          )
          request.reject(error)
          failTerminal(error)
          return
        }
      }
      try {
        request.settle(response)
      } catch {
        const error = new ProfileUtilityClientError(
          'invalid-protocol',
          'Profile utility response failed typed result correlation',
        )
        request.reject(error)
        failTerminal(error)
        return
      }
      if (response.operation === 'close' && response.result.ok) {
        detachMessages()
      }
      return
    }
    let message: ProfileUtilityChildMessage
    try {
      message = assertProfileUtilityChildMessage(candidate)
    } catch {
      failTerminal(new ProfileUtilityClientError(
        'invalid-protocol',
        'Profile utility sent an invalid protocol message',
      ))
      return
    }
    if (message.kind === 'ready') {
      if (readyMessage) {
        failTerminal(new ProfileUtilityClientError(
          'invalid-protocol',
          'Profile utility sent readiness more than once',
        ))
        return
      }
      if (message.route !== options.initialize.route) {
        failTerminal(new ProfileUtilityClientError(
          'invalid-protocol',
          'Profile utility readiness route did not match initialization',
        ))
        return
      }
      readyMessage = message
      clearTimeout(readyTimer)
      resolveReady(message)
      for (const request of pending.values()) postPending(request)
      return
    }
    if (message.kind === 'fatal') {
      failTerminal(new ProfileUtilityClientError(
        'fatal',
        message.failure.message,
        message.failure,
      ))
      return
    }
  }

  function onExit(code: unknown): void {
    if (exited) return
    exited = Object.freeze({ code: typeof code === 'number' ? code : null })
    clearTimeout(readyTimer)
    detachAll()
    resolveExit(exited)
    if (expectedExit) return
    failTerminal(new ProfileUtilityClientError(
      'early-exit',
      `Profile utility exited${typeof code === 'number' ? ` with code ${code}` : ''}`,
    ), false)
  }

  transport.on('message', onMessage)
  transport.on('exit', onExit)
  try {
    transport.postMessage(createProfileUtilityInitialize(options.initialize))
  } catch {
    failTerminal(new ProfileUtilityClientError(
      'transport-failure',
      'Profile utility transport rejected initialization',
    ))
  }

  function request<Operation extends ProfileUtilityOperation>(
    operation: Operation,
    payload: NoInfer<ProfileUtilityOperationPayloads[Operation]>,
  ): Promise<ProfileServiceResult<ProfileUtilityOperationResults[Operation]>> {
    if (terminalError) return Promise.reject(terminalError)
    if (expectedExit || exited) {
      return Promise.reject(new ProfileUtilityClientError(
        'stopped',
        'Profile utility is closing or has exited',
      ))
    }
    if (pending.size >= maxPendingRequests) {
      return Promise.reject(new ProfileUtilityClientError(
        'request-capacity',
        'Profile utility pending request capacity was reached',
      ))
    }
    let requestId: string
    try {
      requestId = nextRequestId()
    } catch {
      const error = new ProfileUtilityClientError(
        'transport-failure',
        'Profile utility request identity could not be created',
      )
      failTerminal(error)
      return Promise.reject(error)
    }
    return new Promise<ProfileServiceResult<ProfileUtilityOperationResults[Operation]>>((resolve, reject) => {
      const message = createProfileUtilityRequest(requestId, operation, payload)
      const pendingRequest: PendingRequest = {
        operation,
        message,
        sent: false,
        settle(response) {
          resolve(correlatedResponseResult(response, message))
        },
        reject,
      }
      pending.set(requestId, pendingRequest)
      postPending(pendingRequest)
    })
  }

  function nextRequestId(): string {
    if (requestSessionNonce === undefined) {
      const nonce = options.createRequestId()
      if (!boundedSessionNonce(nonce)) {
        throw new Error('Profile utility request session nonce is invalid')
      }
      requestSessionNonce = nonce
    }
    if (requestSequence >= PROFILE_UTILITY_REQUEST_SEQUENCE_MAX) {
      throw new Error('Profile utility request sequence is exhausted')
    }
    requestSequence += 1
    return `${requestSessionNonce}:${requestSequence}`
  }

  return Object.freeze({
    ready: () => readyPromise,
    request,
    onTerminalLoss(listener) {
      if (terminalError) {
        try {
          listener(Object.freeze({
            error: terminalError,
            phase: readyMessage ? 'ready' : 'starting',
          }))
        } catch {
          // Terminal observation cannot change the already-failed authority state.
        }
        return () => undefined
      }
      terminalListeners.add(listener)
      return () => terminalListeners.delete(listener)
    },
    waitForExit: () => exitPromise,
    terminate(retry = false) {
      if (!terminalError && !expectedExit && !exited) {
        failTerminal(new ProfileUtilityClientError(
          'transport-failure',
          'Profile utility termination was requested',
        ), false)
      }
      const killError = !exited ? requestKill(retry) : undefined
      if (killError) return Promise.reject(killError)
      return exitPromise
    },
  })
}

function boundedRequestId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= PROFILE_UTILITY_REQUEST_ID_MAX_BYTES
}

function boundedSessionNonce(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= PROFILE_UTILITY_SESSION_NONCE_MAX_BYTES
}

function peekProfileUtilityChildEnvelope(candidate: unknown): ProfileUtilityChildEnvelope {
  if (typeof candidate !== 'object'
    || candidate === null
    || Object.getPrototypeOf(candidate) !== Object.prototype) {
    throw new Error('Profile utility child envelope must be a plain object')
  }
  const version = ownEnumerableDataValue(candidate, 'version')
  const kind = ownEnumerableDataValue(candidate, 'kind')
  if (version !== PROFILE_UTILITY_PROTOCOL_VERSION) {
    throw new Error('Profile utility child envelope version is invalid')
  }
  if (kind === 'ready' || kind === 'fatal') return Object.freeze({ kind })
  if (kind !== 'response') throw new Error('Profile utility child envelope kind is invalid')
  const requestId = ownEnumerableDataValue(candidate, 'requestId')
  const operation = ownEnumerableDataValue(candidate, 'operation')
  if (!boundedRequestId(requestId) || !PROFILE_UTILITY_OPERATION_SET.has(operation)) {
    throw new Error('Profile utility response envelope correlation is invalid')
  }
  return Object.freeze({
    kind,
    requestId,
    operation: operation as ProfileUtilityOperation,
  })
}

function ownEnumerableDataValue(
  candidate: object,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
    throw new Error(`Profile utility child envelope ${key} is not inert data`)
  }
  return descriptor.value
}

function correlatedResponseResult<Operation extends ProfileUtilityOperation>(
  response: ProfileUtilityResponseMessage,
  request: ProfileUtilityRequestMessage<Operation>,
): ProfileServiceResult<ProfileUtilityOperationResults[Operation]> {
  if (response.operation !== request.operation) {
    throw new ProfileUtilityClientError(
      'invalid-protocol',
      'Profile utility response failed typed result correlation',
    )
  }
  if (response.result.ok) assertOperationResultCorrelation(response, request)
  // The protocol decoder has already validated the result against this exact
  // operation. TypeScript cannot retain that correlation through a heterogeneous
  // pending-request map, so the assertion is confined to this checked seam.
  return response.result as ProfileServiceResult<ProfileUtilityOperationResults[Operation]>
}

function assertOperationResultCorrelation(
  response: ProfileUtilityResponseMessage,
  request: ProfileUtilityRequestMessage,
): void {
  if (!response.result.ok) return
  switch (request.operation) {
    case 'authorize-ordinary-idea-create': {
      const value = response.result.value as ProfileUtilityOperationResults[
        'authorize-ordinary-idea-create'
      ]
      if (value.ideaId !== request.payload.ideaId) correlationFailure()
      return
    }
    case 'commit-gui-projection': {
      const value = response.result.value as ProfileUtilityOperationResults['commit-gui-projection']
      const expectedAuthorizationIds = request.payload.context.ordinaryNewIdeas.map(
        (authorization) => authorization.authorizationId,
      )
      if (value.generation !== request.payload.generation
        || value.clientTxnId !== request.payload.clientTxnId
        || value.idempotencyKey !== request.payload.idempotencyKey
        || value.previousRevision !== request.payload.expectedRevision
        || request.payload.expectedRevision >= Number.MAX_SAFE_INTEGER
        || value.revision !== request.payload.expectedRevision + 1
        || !sameExactStringSet(value.authorizationIds, expectedAuthorizationIds)) {
        correlationFailure()
      }
      return
    }
    case 'confirm-revision': {
      const value = response.result.value as ProfileUtilityOperationResults['confirm-revision']
      if (value.revision !== request.payload.expectedRevision
        || value.durable !== true
        || value.dirty !== false) correlationFailure()
      return
    }
    case 'export-portable': {
      const value = response.result.value as ProfileUtilityOperationResults['export-portable']
      if (value.operationId !== request.payload.request.operationId
        || value.revision !== request.payload.request.expectedRevision) correlationFailure()
      return
    }
    case 'duplicate-idea': {
      const value = response.result.value as ProfileUtilityOperationResults['duplicate-idea']
      if (value.kind !== 'duplicate-idea'
        || value.operationId !== request.payload.request.operationId
        || value.previousRevision !== request.payload.request.expectedRevision
        || request.payload.request.expectedRevision >= Number.MAX_SAFE_INTEGER
        || value.revision !== request.payload.request.expectedRevision + 1) correlationFailure()
      return
    }
    case 'import-idea-closure': {
      const value = response.result.value as ProfileUtilityOperationResults['import-idea-closure']
      if (value.kind !== 'import-idea'
        || value.operationId !== request.payload.request.operationId
        || value.previousRevision !== request.payload.request.expectedRevision
        || request.payload.request.expectedRevision >= Number.MAX_SAFE_INTEGER
        || value.revision !== request.payload.request.expectedRevision + 1) correlationFailure()
      return
    }
    case 'restore-recovery': {
      const value = response.result.value as ProfileUtilityOperationResults['restore-recovery']
      if (value.selectedCandidateId !== request.payload.candidateId) correlationFailure()
      return
    }
    case 'query': {
      const normalized = validateProfileQuery(request.payload.request)
      const value = response.result.value as ProfileUtilityOperationResults['query']
      let encodedBytes: number
      try {
        encodedBytes = encodedQueryItemsBytes(value.items)
      } catch {
        correlationFailure()
      }
      if (!normalized.ok
        || value.items.length > normalized.value.limit
        || encodedBytes > normalized.value.byteLimit
        || encodedBytes > PROFILE_QUERY_LIMITS.maxBytes) correlationFailure()
      return
    }
    case 'inspect-result': {
      const normalized = validateProfileResultInspectionRequest(request.payload.request)
      const value = response.result.value as ProfileUtilityOperationResults['inspect-result']
      let encodedBytes: number
      try {
        encodedBytes = encodedJsonArrayBytes(value.items)
      } catch {
        correlationFailure()
      }
      if (!normalized.ok
        || value.ideaId !== normalized.value.ideaId
        || value.resultCardId !== normalized.value.resultCardId
        || value.items.length > normalized.value.limit
        || encodedBytes > normalized.value.byteLimit
        || encodedBytes > PROFILE_QUERY_LIMITS.maxBytes) correlationFailure()
      return
    }
    case 'changes': {
      const normalized = validateProfileAgentChangeTrailRequest(request.payload.request)
      const value = response.result.value as ProfileUtilityOperationResults['changes']
      let encodedBytes: number
      try {
        encodedBytes = encodedJsonArrayBytes(value.items)
      } catch {
        correlationFailure()
      }
      if (!normalized.ok
        || value.since !== normalized.value.since
        || value.items.length > normalized.value.limit
        || encodedBytes > normalized.value.byteLimit
        || encodedBytes > PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxBytes) correlationFailure()
      return
    }
    case 'apply-agent-command-batch': {
      const submitted = request.payload.request
      const value = response.result.value as ProfileUtilityOperationResults[
        'apply-agent-command-batch'
      ]
      if (!isInstalledProfileAgentCommandBatchSuccessForRequest(value, submitted)
        || value.previousRevision !== submitted.expectedRevision
        || value.dryRun !== submitted.dryRun
        || value.commandResults.length !== submitted.commands.length
        || value.commandResults.some((result, index) => !agentCommandResultCorrelates(
          submitted.commands[index],
          result,
        ))
        || (!value.dryRun && value.effects.intentEvents !== value.intentEventIds.length)) {
        correlationFailure()
      }
      return
    }
    case 'agent-card-neighbors': {
      const normalized = normalizeProfileAgentCardNeighborsRequest(request.payload.request)
      const resolved = normalized === undefined
        ? undefined
        : resolveProfileAgentCardAddresses(normalized.ideaId, [normalized.card])
      const value = response.result.value as ProfileUtilityOperationResults[
        'agent-card-neighbors'
      ]
      let encodedBytes: number
      try {
        encodedBytes = encodedJsonArrayBytes(value.items)
      } catch {
        correlationFailure()
      }
      if (!normalized
        || !resolved?.ok
        || value.ideaId !== normalized.ideaId
        || value.card.cardId !== resolved.cardIds[0]
        || value.items.length > normalized.limit
        || encodedBytes > normalized.byteLimit) correlationFailure()
      return
    }
    case 'agent-card-set-bounds': {
      const normalized = normalizeProfileAgentCardSetBoundsRequest(request.payload.request)
      const resolved = normalized === undefined
        ? undefined
        : resolveProfileAgentCardAddresses(normalized.ideaId, normalized.cards)
      const value = response.result.value as ProfileUtilityOperationResults[
        'agent-card-set-bounds'
      ]
      if (!normalized
        || !resolved?.ok
        || value.ideaId !== normalized.ideaId
        || !sameExactStringSet(
          value.cards.map((card) => card.cardId),
          resolved.cardIds,
        )) correlationFailure()
      return
    }
    case 'runtime-probe':
    case 'hydrate':
    case 'status':
    case 'capabilities':
    case 'inspect-recovery':
    case 'start-fresh':
    case 'close':
      return
    default:
      return assertNever(request)
  }
}

function sameExactStringSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (actual.length !== expected.length) return false
  if (new Set(actual).size !== actual.length) return false
  const expectedSet = new Set(expected)
  return expectedSet.size === expected.length && actual.every((entry) => expectedSet.has(entry))
}

function agentCommandResultCorrelates(
  command: ProfileUtilityOperationPayloads[
    'apply-agent-command-batch'
  ]['request']['commands'][number] | undefined,
  result: ProfileUtilityOperationResults[
    'apply-agent-command-batch'
  ]['commandResults'][number],
): boolean {
  if (!command || result.commandId !== command.id || result.name !== command.name) return false
  switch (command.name) {
    case 'idea.create':
      return result.name === 'idea.create'
        && result.ideaName === command.payload.name.trim()
        && result.boardId === `board:${result.ideaId}`
    case 'idea.activate':
      return result.name === 'idea.activate'
        && result.activeIdeaId === command.payload.ideaId
        && result.previousActiveIdeaId !== result.activeIdeaId
    case 'card.create':
    case 'connection.create':
      return true
    case 'card.update-content':
      return result.name === 'card.update-content'
        && result.cardId === command.payload.cardId
        && (!('blockId' in command.payload) || result.blockId === command.payload.blockId)
    case 'card.delete':
      return result.name === 'card.delete' && result.cardId === command.payload.cardId
    case 'connection.update-meaning':
      return result.name === 'connection.update-meaning'
        && result.connectionId === command.payload.connectionId
    case 'connection.delete':
      return result.name === 'connection.delete'
        && result.connectionId === command.payload.connectionId
    case 'ask.set-model':
      return result.name === 'ask.set-model'
        && cardReferenceCorrelates(command.payload.card, result.cardId)
        && result.model === command.payload.model.trim()
    case 'card.set-identity':
      return result.name === 'card.set-identity'
        && cardReferenceCorrelates(command.payload.card, result.cardId)
        && (command.payload.identity === null
          ? result.identity === null
          : result.identity !== null
            && result.identity.preset === command.payload.identity.preset
            && result.identity.fill === command.payload.identity.fill)
    case 'cards.arrange':
      return result.name === 'cards.arrange'
        && result.cardIds.length === command.payload.frames.length
        && command.payload.frames.every((frame, index) => (
          cardReferenceCorrelates(frame.card, result.cardIds[index])
        ))
    case 'cards.reorder-layer':
      return result.name === 'cards.reorder-layer'
        && result.direction === command.payload.direction
        && result.cardIds.length === command.payload.cards.length
        && command.payload.cards.every((card, index) => (
          cardReferenceCorrelates(card, result.cardIds[index])
        ))
    case 'group.membership.set':
      return result.name === 'group.membership.set'
        && cardReferenceCorrelates(command.payload.card, result.cardId)
        && (command.payload.group === null
          ? result.groupId === null
          : result.groupId !== null
            && cardReferenceCorrelates(command.payload.group, result.groupId))
    case 'output.choose-version':
      return result.name === 'output.choose-version'
        && result.outputId === command.payload.outputId
        && result.versionId === command.payload.versionId
    case 'output.set-accepted':
      return result.name === 'output.set-accepted'
        && result.outputId === command.payload.outputId
        && result.versionId === command.payload.versionId
        && result.accepted === command.payload.accepted
    case 'mod-template.create':
      return result.name === 'mod-template.create'
        && result.templateId === command.payload.templateId
        && result.templateVersion === 1
    case 'mod-template.update':
      return result.name === 'mod-template.update'
        && result.templateId === command.payload.templateId
        && result.previousTemplateVersion === command.payload.expectedTemplateVersion
        && command.payload.expectedTemplateVersion < Number.MAX_SAFE_INTEGER
        && result.newTemplateVersion === command.payload.expectedTemplateVersion + 1
    case 'mod-template.delete':
      return result.name === 'mod-template.delete'
        && result.templateId === command.payload.templateId
        && result.deletedTemplateVersion === command.payload.expectedTemplateVersion
    case 'mod-instance.stamp':
      return result.name === 'mod-instance.stamp'
        && result.source.templateId === command.payload.templateId
        && result.source.templateVersion === command.payload.expectedTemplateVersion
        && result.idMap.mod.sourceId === command.payload.templateId
        && result.idMap.mod.instanceId === result.instanceId
    case 'mod-instance.create':
      return result.name === 'mod-instance.create'
        && result.source.kind === 'direct'
    case 'mod-instance.configure':
      return result.name === 'mod-instance.configure'
        && result.cardId === command.payload.cardId
    case 'mod-instance.delete':
      return result.name === 'mod-instance.delete'
        && result.cardId === command.payload.cardId
    default:
      return assertNever(command)
  }
}

function cardReferenceCorrelates(
  reference: Readonly<{ cardId: string } | { createdByCommandId: string }>,
  cardId: string | undefined,
): boolean {
  return cardId !== undefined && ('cardId' in reference ? reference.cardId === cardId : true)
}

function encodedQueryItemsBytes(
  items: ProfileUtilityOperationResults['query']['items'],
): number {
  return encodedJsonArrayBytes(items)
}

function encodedJsonArrayBytes(items: readonly unknown[]): number {
  const encoder = new TextEncoder()
  let bytes = 2
  items.forEach((item, index) => {
    if (index > 0) bytes += 1
    bytes += encoder.encode(JSON.stringify(item)).byteLength
  })
  return bytes
}

function correlationFailure(): never {
  throw new ProfileUtilityClientError(
    'invalid-protocol',
    'Profile utility response failed request/result correlation',
  )
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Profile utility request correlation: ${String(value)}`)
}
