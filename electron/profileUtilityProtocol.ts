import path from 'node:path'
import type {
  GuiOrdinaryNewIdeaAuthorization,
  GuiProfileOwnerContext,
  GuiProfileProjection,
} from '../src/persistence/profileGuiProjection'
import {
  captureProfileGuiInertJson,
  PROFILE_GUI_CAPTURE_MAX_BYTES,
  type ProfileGuiRevisionConfirmation,
} from '../src/persistence/profileGuiSaveScheduler'
import {
  PROFILE_CONTRACT_VERSIONS,
  PROFILE_PORTABLE_LIFECYCLE_VERSION,
  PROFILE_QUERY_LIMITS,
  validateProfileQuery,
  type ProfileCapabilities,
  type ProfileDuplicateIdeaRequest,
  type ProfileIdeaLifecycleReceipt,
  type ProfileImportIdeaClosureRequest,
  type ProfilePortableExportReceipt,
  type ProfilePortableExportRequest,
  type ProfileQueryPage,
  type ProfileQueryRequest,
  type ProfileServiceFailure,
  type ProfileServiceResult,
  type ProfileSnapshot,
  type ProfileStatus,
} from '../src/persistence/profileServiceContract'
import {
  isProfileTransportCapabilities,
  isProfileTransportIdeaLifecycleReceipt,
  isProfileTransportPortableExportReceipt,
  isProfileTransportQueryPage,
  isProfileTransportServiceFailure,
  isProfileTransportSnapshot,
  isProfileTransportStatus,
} from '../src/persistence/profileTransportContract'
import { validateProfileModDocumentTransport } from '../src/persistence/profileModRecords'
import {
  isInstalledOrReplayedProfileAgentCommandReceipt,
  validateInstalledProfileAgentCommandRequest,
  type ProfileAgentCommandBatchReceipt,
  type ProfileAgentInstalledTransport,
} from '../src/persistence/profileAgentCommandInstallation'
import {
  PROFILE_AGENT_COMMAND_LIMITS,
  PROFILE_AGENT_COMMAND_RESULT_LIMITS,
} from '../src/persistence/profileAgentCommandManifest'
import type { ProfileAgentCommandRequest } from '../src/persistence/profileAgentCommandPlan'
import {
  isProfileAgentChangeTrailPage,
  PROFILE_AGENT_CHANGE_TRAIL_LIMITS,
  validateProfileAgentChangeTrailRequest,
  type ProfileAgentChangeTrailPage,
  type ProfileAgentChangeTrailRequest,
} from '../src/persistence/profileAgentChangeTrail'
import {
  isProfileAgentCardNeighbors,
  isProfileAgentCardSetBounds,
  normalizeProfileAgentCardNeighborsRequest,
  normalizeProfileAgentCardSetBoundsRequest,
  PROFILE_AGENT_SPATIAL_QUERY_LIMITS,
  type NormalizedProfileAgentCardNeighborsRequest,
  type ProfileAgentCardNeighbors,
  type ProfileAgentCardSetBounds,
  type ProfileAgentCardSetBoundsRequest,
} from '../src/persistence/profileAgentSpatialQuery'
import {
  isProfileResultInspectionPage,
  validateProfileResultInspectionRequest,
  type ProfileResultInspectionPage,
  type ProfileResultInspectionRequest,
} from '../src/persistence/profileResultInspection'
import type {
  SqliteProfileRecoveryInspection,
  SqliteProfileRecoveryRestoreReceipt,
  SqliteProfileStartFreshReceipt,
} from './sqliteProfileRecovery'
import type { SqliteProfileGuiProjectionCommitReceipt } from './sqliteProfileRevisionStore'

export const PROFILE_UTILITY_PROTOCOL_VERSION = 1 as const
export const PROFILE_UTILITY_ENVELOPE_MAX_BYTES = 4 * 1024
export const PROFILE_UTILITY_MESSAGE_MAX_BYTES = PROFILE_GUI_CAPTURE_MAX_BYTES
  + PROFILE_UTILITY_ENVELOPE_MAX_BYTES
const PROFILE_UTILITY_JSON_STRING_MAX_EXPANSION = 6
const PROFILE_UTILITY_QUERY_FILTER_GROUPS = 4
const PROFILE_UTILITY_QUERY_REQUEST_STRING_MAX_BYTES = PROFILE_QUERY_LIMITS.maxCursorBytes
  + (PROFILE_UTILITY_QUERY_FILTER_GROUPS
    * PROFILE_QUERY_LIMITS.maxFilterValues
    * PROFILE_QUERY_LIMITS.maxFilterValueBytes)
  + (PROFILE_QUERY_LIMITS.maxProjectionFields
    * PROFILE_QUERY_LIMITS.maxProjectionFieldBytes)
export const PROFILE_UTILITY_QUERY_REQUEST_MAX_BYTES = (
  PROFILE_UTILITY_QUERY_REQUEST_STRING_MAX_BYTES
  * PROFILE_UTILITY_JSON_STRING_MAX_EXPANSION
)
  + PROFILE_UTILITY_ENVELOPE_MAX_BYTES
export const PROFILE_UTILITY_QUERY_RESPONSE_MAX_BYTES = PROFILE_QUERY_LIMITS.maxBytes
  + (PROFILE_QUERY_LIMITS.maxCursorBytes * PROFILE_UTILITY_JSON_STRING_MAX_EXPANSION)
  + PROFILE_UTILITY_ENVELOPE_MAX_BYTES
export const PROFILE_UTILITY_CHANGES_REQUEST_MAX_BYTES =
  PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxCursorBytes + PROFILE_UTILITY_ENVELOPE_MAX_BYTES
export const PROFILE_UTILITY_CHANGES_RESPONSE_MAX_BYTES =
  PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxBytes
  + PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxCursorBytes
  + PROFILE_UTILITY_ENVELOPE_MAX_BYTES
export const PROFILE_UTILITY_AGENT_COMMAND_REQUEST_MAX_BYTES =
  PROFILE_AGENT_COMMAND_LIMITS.maxRequestBytes + PROFILE_UTILITY_ENVELOPE_MAX_BYTES
export const PROFILE_UTILITY_AGENT_COMMAND_RESPONSE_MAX_BYTES =
  PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxReceiptBytes + PROFILE_UTILITY_ENVELOPE_MAX_BYTES
export const PROFILE_UTILITY_SPATIAL_REQUEST_MAX_BYTES =
  (PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxBoundingCards
    * PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxAddressBytes
    * PROFILE_UTILITY_JSON_STRING_MAX_EXPANSION)
  + PROFILE_UTILITY_ENVELOPE_MAX_BYTES
export const PROFILE_UTILITY_SPATIAL_RESPONSE_MAX_BYTES =
  PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxBytes
  + (PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxBoundingCards
    * (PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxAddressBytes
      + PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxIdBytes)
    * PROFILE_UTILITY_JSON_STRING_MAX_EXPANSION)
  + PROFILE_UTILITY_ENVELOPE_MAX_BYTES
const PROFILE_UTILITY_RESULT_ID_MAX_BYTES = 512
const PROFILE_UTILITY_RESULT_ID_MAX_COUNT = 100_000

export const PROFILE_UTILITY_OPERATIONS = [
  'runtime-probe',
  'hydrate',
  'authorize-ordinary-idea-create',
  'commit-gui-projection',
  'confirm-revision',
  'status',
  'capabilities',
  'query',
  'inspect-result',
  'changes',
  'agent-card-neighbors',
  'agent-card-set-bounds',
  'apply-agent-command-batch',
  'export-portable',
  'duplicate-idea',
  'import-idea-closure',
  'inspect-recovery',
  'restore-recovery',
  'start-fresh',
  'close',
] as const

export type ProfileUtilityOperation = (typeof PROFILE_UTILITY_OPERATIONS)[number]
export type ProfileUtilityOwnerRoute = ProfileUtilityInitializePayload['route']

export type ProfileUtilityRuntimeProbe = Readonly<{
  chromium: string
  electron: string
  node: string
  sqlite: string
  profileAuthority: 'installed'
}>

export type ProfileUtilityInitializePayload = Readonly<{
  route: 'active-owner'
  databasePath: string
  portableTempRoot: string
}> | Readonly<{
  route: 'exclusive-headless-owner'
  databasePath: string
  transport: ProfileAgentInstalledTransport
  actor: Readonly<{ client: string; sessionId: string }>
}>

export type ProfileUtilityActiveInitializePayload = Extract<
  ProfileUtilityInitializePayload,
  { route: 'active-owner' }
>

export type ProfileUtilityHeadlessInitializePayload = Extract<
  ProfileUtilityInitializePayload,
  { route: 'exclusive-headless-owner' }
>

export type ProfileUtilityRendererProjection = Readonly<
  Omit<GuiProfileProjection, 'profileId' | 'profileSettings'>
>

export type ProfileUtilityGuiCommitPayload = Readonly<{
  generation: number
  expectedRevision: number
  clientTxnId: string
  idempotencyKey: string
  committedAt: string
  context: GuiProfileOwnerContext
  rendererProjection: ProfileUtilityRendererProjection
}>

export type ProfileUtilityRecoveryInspection = Readonly<
  SqliteProfileRecoveryInspection & { currentRevision: number }
>

export type ProfileUtilityAgentCommandPayload =
  | Readonly<{ request: ProfileAgentCommandRequest }>
  | Readonly<{
      request: ProfileAgentCommandRequest
      transport: 'cli'
      actor: Readonly<{ client: string; sessionId: string }>
    }>

export type ProfileUtilityOperationPayloads = Readonly<{
  'runtime-probe': Readonly<Record<never, never>>
  hydrate: Readonly<Record<never, never>>
  'authorize-ordinary-idea-create': Readonly<{ ideaId: string }>
  'commit-gui-projection': ProfileUtilityGuiCommitPayload
  'confirm-revision': Readonly<{ expectedRevision: number }>
  status: Readonly<Record<never, never>>
  capabilities: Readonly<Record<never, never>>
  query: Readonly<{ request: ProfileQueryRequest }>
  'inspect-result': Readonly<{ request: ProfileResultInspectionRequest }>
  changes: Readonly<{ request: ProfileAgentChangeTrailRequest }>
  'agent-card-neighbors': Readonly<{ request: NormalizedProfileAgentCardNeighborsRequest }>
  'agent-card-set-bounds': Readonly<{ request: ProfileAgentCardSetBoundsRequest }>
  'apply-agent-command-batch': ProfileUtilityAgentCommandPayload
  'export-portable': Readonly<{
    request: Omit<ProfilePortableExportRequest<unknown>, 'destination'>
    destinationPath: string
  }>
  'duplicate-idea': Readonly<{ request: ProfileDuplicateIdeaRequest }>
  'import-idea-closure': Readonly<{
    request: Omit<ProfileImportIdeaClosureRequest<unknown>, 'source'>
    sourcePath: string
  }>
  'inspect-recovery': Readonly<Record<never, never>>
  'restore-recovery': Readonly<{ candidateId: string }>
  'start-fresh': Readonly<Record<never, never>>
  close: Readonly<Record<never, never>>
}>

export type ProfileUtilityOperationResults = Readonly<{
  'runtime-probe': ProfileUtilityRuntimeProbe
  hydrate: ProfileSnapshot
  'authorize-ordinary-idea-create': GuiOrdinaryNewIdeaAuthorization
  'commit-gui-projection': SqliteProfileGuiProjectionCommitReceipt
  'confirm-revision': ProfileGuiRevisionConfirmation
  status: ProfileStatus
  capabilities: ProfileCapabilities
  query: ProfileQueryPage
  'inspect-result': ProfileResultInspectionPage
  changes: ProfileAgentChangeTrailPage
  'agent-card-neighbors': ProfileAgentCardNeighbors
  'agent-card-set-bounds': ProfileAgentCardSetBounds
  'apply-agent-command-batch': ProfileAgentCommandBatchReceipt
  'export-portable': ProfilePortableExportReceipt
  'duplicate-idea': ProfileIdeaLifecycleReceipt
  'import-idea-closure': ProfileIdeaLifecycleReceipt
  'inspect-recovery': ProfileUtilityRecoveryInspection
  'restore-recovery': SqliteProfileRecoveryRestoreReceipt
  'start-fresh': SqliteProfileStartFreshReceipt
  close: Readonly<{ closed: true }>
}>

export type ProfileUtilityInitializeMessage = Readonly<{
  version: typeof PROFILE_UTILITY_PROTOCOL_VERSION
  kind: 'initialize'
  payload: ProfileUtilityInitializePayload
}>

export type ProfileUtilityRequestMessage<
  Operation extends ProfileUtilityOperation = ProfileUtilityOperation,
> = Operation extends ProfileUtilityOperation
  ? Readonly<{
      version: typeof PROFILE_UTILITY_PROTOCOL_VERSION
      kind: 'request'
      requestId: string
      operation: Operation
      payload: ProfileUtilityOperationPayloads[Operation]
    }>
  : never

export type ProfileUtilityCloseAcknowledgementMessage = Readonly<{
  version: typeof PROFILE_UTILITY_PROTOCOL_VERSION
  kind: 'close-acknowledgement'
  requestId: string
}>

export type ProfileUtilityParentMessage =
  | ProfileUtilityInitializeMessage
  | ProfileUtilityRequestMessage
  | ProfileUtilityCloseAcknowledgementMessage

export type ProfileUtilityReadyMessage<
  Route extends ProfileUtilityInitializePayload['route'] = ProfileUtilityInitializePayload['route'],
> = Route extends ProfileUtilityInitializePayload['route']
  ? | Readonly<{
        version: typeof PROFILE_UTILITY_PROTOCOL_VERSION
        kind: 'ready'
        route: Route
        state: 'ready'
        revision: number
      }>
    | Readonly<{
        version: typeof PROFILE_UTILITY_PROTOCOL_VERSION
        kind: 'ready'
        route: Route
        state: 'recovery-required'
        currentRevision: number
      }>
  : never

export type ProfileUtilityResponseMessage<
  Operation extends ProfileUtilityOperation = ProfileUtilityOperation,
> = Operation extends ProfileUtilityOperation
  ? Readonly<{
      version: typeof PROFILE_UTILITY_PROTOCOL_VERSION
      kind: 'response'
      requestId: string
      operation: Operation
      result: ProfileServiceResult<ProfileUtilityOperationResults[Operation]>
    }>
  : never

export type ProfileUtilityFatalMessage = Readonly<{
  version: typeof PROFILE_UTILITY_PROTOCOL_VERSION
  kind: 'fatal'
  failure: ProfileServiceFailure
}>

export type ProfileUtilityChildMessage =
  | ProfileUtilityReadyMessage
  | ProfileUtilityResponseMessage
  | ProfileUtilityFatalMessage

const EMPTY_PAYLOAD_OPERATIONS = new Set<ProfileUtilityOperation>([
  'runtime-probe',
  'hydrate',
  'status',
  'capabilities',
  'inspect-recovery',
  'start-fresh',
  'close',
])

export function createProfileUtilityInitialize(
  payload: ProfileUtilityInitializePayload,
): ProfileUtilityInitializeMessage {
  return Object.freeze({
    version: PROFILE_UTILITY_PROTOCOL_VERSION,
    kind: 'initialize',
    payload: Object.freeze({ ...payload }),
  })
}

export function createProfileUtilityRequest<Operation extends ProfileUtilityOperation>(
  requestId: string,
  operation: Operation,
  payload: NoInfer<ProfileUtilityOperationPayloads[Operation]>,
): ProfileUtilityRequestMessage<Operation> {
  return Object.freeze({
    version: PROFILE_UTILITY_PROTOCOL_VERSION,
    kind: 'request',
    requestId,
    operation,
    payload,
  }) as ProfileUtilityRequestMessage<Operation>
}

export function createProfileUtilityCloseAcknowledgement(
  requestId: string,
): ProfileUtilityCloseAcknowledgementMessage {
  return assertProfileUtilityParentMessage({
    version: PROFILE_UTILITY_PROTOCOL_VERSION,
    kind: 'close-acknowledgement',
    requestId,
  }) as ProfileUtilityCloseAcknowledgementMessage
}

export function createProfileUtilityReady(
  route: ProfileUtilityInitializePayload['route'],
  state: 'ready' | 'recovery-required',
  currentRevision: number,
): ProfileUtilityReadyMessage {
  return assertProfileUtilityChildMessage({
    version: PROFILE_UTILITY_PROTOCOL_VERSION,
    kind: 'ready',
    route,
    state,
    ...(state === 'ready' ? { revision: currentRevision } : { currentRevision }),
  }) as ProfileUtilityReadyMessage
}

export function createProfileUtilityResponse<Operation extends ProfileUtilityOperation>(
  requestId: string,
  operation: Operation,
  result: ProfileServiceResult<NoInfer<ProfileUtilityOperationResults[Operation]>>,
): ProfileUtilityResponseMessage<Operation> {
  return assertProfileUtilityChildMessage({
    version: PROFILE_UTILITY_PROTOCOL_VERSION,
    kind: 'response',
    requestId,
    operation,
    result,
  }, requestId, operation) as ProfileUtilityResponseMessage<Operation>
}

export function createProfileUtilityFatal(
  failure: ProfileServiceFailure,
): ProfileUtilityFatalMessage {
  return assertProfileUtilityChildMessage({
    version: PROFILE_UTILITY_PROTOCOL_VERSION,
    kind: 'fatal',
    failure,
  }) as ProfileUtilityFatalMessage
}

export function assertProfileUtilityParentMessage(candidate: unknown): ProfileUtilityParentMessage {
  try {
    const captured = captureProfileGuiInertJson(
      candidate,
      '$profileUtilityParentMessage',
      utilityMessageCaptureLimit(candidate, 'parent'),
    )
    if (!isPlainRecord(captured)
      || captured.version !== PROFILE_UTILITY_PROTOCOL_VERSION
      || (captured.kind !== 'initialize'
        && captured.kind !== 'request'
        && captured.kind !== 'close-acknowledgement')) {
      return deniedParentMessage()
    }
    if (captured.kind === 'close-acknowledgement') {
      if (!hasExactKeys(captured, ['kind', 'requestId', 'version'])
        || !boundedString(captured.requestId, 256)) {
        return deniedParentMessage()
      }
      return captured as ProfileUtilityCloseAcknowledgementMessage
    }
    if (captured.kind === 'initialize') {
      if (!hasExactKeys(captured, ['kind', 'payload', 'version'])
        || !isPlainRecord(captured.payload)
        || !validInitializePayload(captured.payload)) {
        return deniedParentMessage()
      }
      return captured as ProfileUtilityInitializeMessage
    }
    if (!hasExactKeys(captured, ['kind', 'operation', 'payload', 'requestId', 'version'])
      || !boundedString(captured.requestId, 256)
      || !PROFILE_UTILITY_OPERATIONS.includes(captured.operation as ProfileUtilityOperation)
      || !isPlainRecord(captured.payload)) {
      return deniedParentMessage()
    }
    validateOperationPayload(
      captured.operation as ProfileUtilityOperation,
      captured.payload,
    )
    return captured as ProfileUtilityRequestMessage
  } catch {
    return deniedParentMessage()
  }
}

export function assertProfileUtilityChildMessage(
  candidate: unknown,
  expectedRequestId?: string,
  expectedOperation?: ProfileUtilityOperation,
): ProfileUtilityChildMessage {
  try {
    const captured = captureProfileGuiInertJson(
      candidate,
      '$profileUtilityChildMessage',
      utilityMessageCaptureLimit(candidate, 'child'),
    )
    if (!isPlainRecord(captured) || captured.version !== PROFILE_UTILITY_PROTOCOL_VERSION) {
      return deniedChildMessage()
    }
    if (captured.kind === 'ready') {
      if ((captured.route !== 'active-owner'
          && captured.route !== 'exclusive-headless-owner')
        || (captured.state === 'ready'
          ? (!hasExactKeys(captured, ['kind', 'revision', 'route', 'state', 'version'])
            || !nonNegativeSafeInteger(captured.revision))
          : captured.state === 'recovery-required'
            ? (!hasExactKeys(captured, [
                'currentRevision',
                'kind',
                'route',
                'state',
                'version',
              ]) || !nonNegativeSafeInteger(captured.currentRevision))
            : true)) {
        return deniedChildMessage()
      }
      return captured as ProfileUtilityReadyMessage
    }
    if (captured.kind === 'fatal') {
      if (!hasExactKeys(captured, ['failure', 'kind', 'version'])
        || !isProfileTransportServiceFailure(captured.failure)) {
        return deniedChildMessage()
      }
      return captured as ProfileUtilityFatalMessage
    }
    if (captured.kind !== 'response'
      || !hasExactKeys(captured, ['kind', 'operation', 'requestId', 'result', 'version'])
      || !boundedString(captured.requestId, 256)
      || (expectedRequestId !== undefined && captured.requestId !== expectedRequestId)
      || !PROFILE_UTILITY_OPERATIONS.includes(captured.operation as ProfileUtilityOperation)
      || (expectedOperation !== undefined && captured.operation !== expectedOperation)
      || !isProfileServiceResult(captured.result)) {
      return deniedChildMessage()
    }
    if (captured.result.ok) {
      validateOperationResult(
        captured.operation as ProfileUtilityOperation,
        captured.result.value,
      )
    }
    return captured as ProfileUtilityResponseMessage
  } catch {
    return deniedChildMessage()
  }
}

function validInitializePayload(
  candidate: Record<string, unknown>,
): candidate is ProfileUtilityInitializePayload {
  if (candidate.route === 'active-owner') {
    return hasExactKeys(candidate, ['databasePath', 'portableTempRoot', 'route'])
      && absoluteBoundedPath(candidate.databasePath)
      && absoluteBoundedPath(candidate.portableTempRoot)
  }
  return candidate.route === 'exclusive-headless-owner'
    && hasExactKeys(candidate, ['actor', 'databasePath', 'route', 'transport'])
    && absoluteBoundedPath(candidate.databasePath)
    && (candidate.transport === 'cli' || candidate.transport === 'mcp')
    && isPlainRecord(candidate.actor)
    && hasExactKeys(candidate.actor, ['client', 'sessionId'])
    && boundedString(candidate.actor.client, 256)
    && boundedString(candidate.actor.sessionId, 256)
}

function utilityMessageCaptureLimit(
  candidate: unknown,
  direction: 'parent' | 'child',
): number {
  try {
    if (!candidate || typeof candidate !== 'object') return PROFILE_UTILITY_MESSAGE_MAX_BYTES
    const kind = inertOwnValue(candidate, 'kind')
    const operation = inertOwnValue(candidate, 'operation')
    const queryEnvelope = direction === 'parent'
      ? kind === 'request' && (operation === 'query' || operation === 'inspect-result')
      : kind === 'response' && (operation === 'query' || operation === 'inspect-result')
    if (queryEnvelope) {
      return direction === 'parent'
        ? PROFILE_UTILITY_QUERY_REQUEST_MAX_BYTES
        : PROFILE_UTILITY_QUERY_RESPONSE_MAX_BYTES
    }
    const changesEnvelope = direction === 'parent'
      ? kind === 'request' && operation === 'changes'
      : kind === 'response' && operation === 'changes'
    if (changesEnvelope) {
      return direction === 'parent'
        ? PROFILE_UTILITY_CHANGES_REQUEST_MAX_BYTES
        : PROFILE_UTILITY_CHANGES_RESPONSE_MAX_BYTES
    }
    const spatialEnvelope = direction === 'parent'
      ? kind === 'request'
        && (operation === 'agent-card-neighbors' || operation === 'agent-card-set-bounds')
      : kind === 'response'
        && (operation === 'agent-card-neighbors' || operation === 'agent-card-set-bounds')
    if (spatialEnvelope) {
      return direction === 'parent'
        ? PROFILE_UTILITY_SPATIAL_REQUEST_MAX_BYTES
        : PROFILE_UTILITY_SPATIAL_RESPONSE_MAX_BYTES
    }
    const agentCommandEnvelope = direction === 'parent'
      ? kind === 'request' && operation === 'apply-agent-command-batch'
      : kind === 'response' && operation === 'apply-agent-command-batch'
    if (agentCommandEnvelope) {
      return direction === 'parent'
        ? PROFILE_UTILITY_AGENT_COMMAND_REQUEST_MAX_BYTES
        : PROFILE_UTILITY_AGENT_COMMAND_RESPONSE_MAX_BYTES
    }
    return PROFILE_UTILITY_MESSAGE_MAX_BYTES
  } catch {
    return PROFILE_UTILITY_MESSAGE_MAX_BYTES
  }
}

function inertOwnValue(candidate: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
    throw new Error('Profile utility envelope property is not inert')
  }
  return descriptor.value
}

function validateOperationPayload(
  operation: ProfileUtilityOperation,
  payload: Record<string, unknown>,
): void {
  if (EMPTY_PAYLOAD_OPERATIONS.has(operation)) {
    if (!hasExactKeys(payload, [])) deniedParentMessage()
    return
  }
  switch (operation) {
    case 'authorize-ordinary-idea-create':
      if (!hasExactKeys(payload, ['ideaId']) || !boundedString(payload.ideaId, 512)) {
        deniedParentMessage()
      }
      return
    case 'commit-gui-projection':
      if (!validGuiCommitPayload(payload)) {
        deniedParentMessage()
      }
      return
    case 'confirm-revision':
      if (!hasExactKeys(payload, ['expectedRevision'])
        || !nonNegativeSafeInteger(payload.expectedRevision)) {
        deniedParentMessage()
      }
      return
    case 'query':
      if (!hasExactKeys(payload, ['request']) || !validateProfileQuery(payload.request).ok) {
        deniedParentMessage()
      }
      return
    case 'inspect-result':
      if (!hasExactKeys(payload, ['request'])
        || !validateProfileResultInspectionRequest(payload.request).ok) {
        deniedParentMessage()
      }
      return
    case 'changes':
      if (!hasExactKeys(payload, ['request'])
        || !validateProfileAgentChangeTrailRequest(payload.request).ok) {
        deniedParentMessage()
      }
      return
    case 'agent-card-neighbors': {
      if (!hasExactKeys(payload, ['request']) || !isPlainRecord(payload.request)) {
        deniedParentMessage()
      }
      const normalized = normalizeProfileAgentCardNeighborsRequest(payload.request)
      if (!normalized
        || !hasExactKeys(payload.request, ['byteLimit', 'card', 'ideaId', 'limit'])
        || normalized.ideaId !== payload.request.ideaId
        || normalized.card !== payload.request.card
        || normalized.limit !== payload.request.limit
        || normalized.byteLimit !== payload.request.byteLimit) deniedParentMessage()
      return
    }
    case 'agent-card-set-bounds':
      if (!hasExactKeys(payload, ['request'])
        || !normalizeProfileAgentCardSetBoundsRequest(payload.request)) deniedParentMessage()
      return
    case 'apply-agent-command-batch':
      if (!validateInstalledProfileAgentCommandRequest(payload.request).ok
        || !(hasExactKeys(payload, ['request'])
          || (hasExactKeys(payload, ['actor', 'request', 'transport'])
            && payload.transport === 'cli'
            && validLiveAgentActor(payload.actor)))) {
        deniedParentMessage()
      }
      return
    case 'export-portable':
      if (!hasExactKeys(payload, ['destinationPath', 'request'])
        || !absoluteBoundedPath(payload.destinationPath)
        || !validPortableExportRequest(payload.request)) {
        deniedParentMessage()
      }
      return
    case 'duplicate-idea':
      if (!hasExactKeys(payload, ['request']) || !validDuplicateRequest(payload.request)) {
        deniedParentMessage()
      }
      return
    case 'import-idea-closure':
      if (!hasExactKeys(payload, ['request', 'sourcePath'])
        || !absoluteBoundedPath(payload.sourcePath)
        || !validIdeaImportRequest(payload.request)) {
        deniedParentMessage()
      }
      return
    case 'restore-recovery':
      if (!hasExactKeys(payload, ['candidateId'])
        || !boundedString(payload.candidateId, 512)) {
        deniedParentMessage()
      }
      return
    case 'runtime-probe':
    case 'hydrate':
    case 'status':
    case 'capabilities':
    case 'inspect-recovery':
    case 'start-fresh':
    case 'close':
      return
    default:
      assertNever(operation)
  }
}

function validLiveAgentActor(candidate: unknown): boolean {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, ['client', 'sessionId'])
    && boundedString(candidate.client, 128)
    && boundedString(candidate.sessionId, 128)
}

function validGuiCommitPayload(candidate: unknown): boolean {
  if (!isPlainRecord(candidate)
    || !hasExactKeys(candidate, [
      'clientTxnId',
      'committedAt',
      'context',
      'expectedRevision',
      'generation',
      'idempotencyKey',
      'rendererProjection',
    ])
    || !nonNegativeSafeInteger(candidate.generation)
    || !nonNegativeSafeInteger(candidate.expectedRevision)
    || !boundedString(candidate.clientTxnId, 512)
    || !boundedString(candidate.idempotencyKey, 512)
    || !boundedString(candidate.committedAt, 128)
    || !isPlainRecord(candidate.context)
    || !hasExactKeys(candidate.context, ['ordinaryNewIdeas', 'trustedActorId'])
    || !boundedString(candidate.context.trustedActorId, 512)
    || !Array.isArray(candidate.context.ordinaryNewIdeas)
    || !candidate.context.ordinaryNewIdeas.every(validOrdinaryIdeaAuthorization)
    || !validRendererGuiProjection(candidate.rendererProjection)) {
    return false
  }
  return true
}

function validOrdinaryIdeaAuthorization(candidate: unknown): boolean {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, [
      'authorizationId',
      'baseRevision',
      'boardId',
      'createdAt',
      'expiresAt',
      'ideaId',
      'profileId',
    ])
    && boundedString(candidate.authorizationId, 512)
    && nonNegativeSafeInteger(candidate.baseRevision)
    && boundedString(candidate.boardId, 512)
    && boundedString(candidate.createdAt, 128)
    && boundedString(candidate.expiresAt, 128)
    && boundedString(candidate.ideaId, 512)
    && boundedString(candidate.profileId, 512)
}

function validRendererGuiProjection(candidate: unknown): boolean {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, [
      'activeIdeaId',
      'boardReplacements',
      'ideas',
      'newModOrigins',
      'projectionVersion',
      'userModTemplates',
    ])
    && candidate.projectionVersion === 2
    && boundedString(candidate.activeIdeaId, 512)
    && Array.isArray(candidate.ideas)
    && isPlainRecord(candidate.boardReplacements)
    && Array.isArray(candidate.userModTemplates)
    && candidate.userModTemplates.every(validGuiUserModTemplate)
    && isPlainRecord(candidate.newModOrigins)
}

function validGuiUserModTemplate(candidate: unknown): boolean {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, ['mod', 'templateId'])
    && boundedString(candidate.templateId, 512)
    && candidate.templateId.trim().length > 0
    && validateProfileModDocumentTransport(candidate.mod).ok
}

function validPortableExportRequest(candidate: unknown): boolean {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, ['expectedRevision', 'operationId', 'version'])
    && candidate.version === PROFILE_PORTABLE_LIFECYCLE_VERSION
    && boundedString(candidate.operationId, 512)
    && nonNegativeSafeInteger(candidate.expectedRevision)
}

function validDuplicateRequest(candidate: unknown): boolean {
  if (!isPlainRecord(candidate)
    || candidate.version !== PROFILE_PORTABLE_LIFECYCLE_VERSION
    || !boundedString(candidate.operationId, 512)
    || !boundedString(candidate.idempotencyKey, 512)
    || !nonNegativeSafeInteger(candidate.expectedRevision)
    || !boundedString(candidate.sourceIdeaId, 512)
    || (candidate.name !== undefined && !boundedString(candidate.name, 4_096))) {
    return false
  }
  return hasExactKeys(candidate, [
    'expectedRevision',
    'idempotencyKey',
    ...(candidate.name === undefined ? [] : ['name']),
    'operationId',
    'sourceIdeaId',
    'version',
  ])
}

function validIdeaImportRequest(candidate: unknown): boolean {
  if (!isPlainRecord(candidate)
    || candidate.version !== PROFILE_PORTABLE_LIFECYCLE_VERSION
    || !boundedString(candidate.operationId, 512)
    || !boundedString(candidate.idempotencyKey, 512)
    || !nonNegativeSafeInteger(candidate.expectedRevision)
    || (candidate.name !== undefined && !boundedString(candidate.name, 4_096))) {
    return false
  }
  return hasExactKeys(candidate, [
    'expectedRevision',
    'idempotencyKey',
    ...(candidate.name === undefined ? [] : ['name']),
    'operationId',
    'version',
  ])
}

function isProfileServiceResult(candidate: unknown): candidate is ProfileServiceResult<unknown> {
  return isPlainRecord(candidate)
    && (candidate.ok === true
      ? hasExactKeys(candidate, ['ok', 'value'])
      : isProfileTransportServiceFailure(candidate))
}

function validateOperationResult(operation: ProfileUtilityOperation, value: unknown): void {
  switch (operation) {
    case 'runtime-probe':
      if (!isPlainRecord(value)
        || !hasExactKeys(value, ['chromium', 'electron', 'node', 'profileAuthority', 'sqlite'])
        || value.profileAuthority !== 'installed'
        || !boundedString(value.chromium, 128)
        || !boundedString(value.electron, 128)
        || !boundedString(value.node, 128)
        || !boundedString(value.sqlite, 128)) deniedChildMessage()
      return
    case 'hydrate':
      if (!isProfileTransportSnapshot(value)) deniedChildMessage()
      return
    case 'authorize-ordinary-idea-create':
      if (!validOrdinaryIdeaAuthorization(value)) deniedChildMessage()
      return
    case 'commit-gui-projection':
      if (!isPlainRecord(value)
        || !hasExactKeys(value, [
          'appendedIntentEventIds',
          'authorizationIds',
          'changedRecordIds',
          'clientTxnId',
          'commitId',
          'deletedRecordIds',
          'generation',
          'idempotencyKey',
          'previousRevision',
          'replayed',
          'revision',
        ])
        || !nonNegativeSafeInteger(value.previousRevision)
        || !nonNegativeSafeInteger(value.revision)
        || !nonNegativeSafeInteger(value.generation)
        || !boundedString(value.commitId, 512)
        || !boundedString(value.clientTxnId, 512)
        || !boundedString(value.idempotencyKey, 512)
        || !canonicalBoundedStringArray(value.deletedRecordIds)
        || !canonicalBoundedStringArray(value.changedRecordIds)
        || !canonicalBoundedStringArray(value.appendedIntentEventIds)
        || !canonicalBoundedStringArray(value.authorizationIds)
        || typeof value.replayed !== 'boolean') deniedChildMessage()
      return
    case 'confirm-revision':
      if (!isPlainRecord(value)
        || !hasExactKeys(value, ['dirty', 'durable', 'revision'])
        || !nonNegativeSafeInteger(value.revision)
        || typeof value.durable !== 'boolean'
        || typeof value.dirty !== 'boolean') deniedChildMessage()
      return
    case 'status':
      if (!isProfileTransportStatus(value)) deniedChildMessage()
      return
    case 'capabilities':
      if (!isProfileTransportCapabilities(value)) deniedChildMessage()
      return
    case 'query':
      if (!isProfileTransportQueryPage(value)) deniedChildMessage()
      return
    case 'inspect-result':
      if (!isProfileResultInspectionPage(value)) deniedChildMessage()
      return
    case 'changes':
      if (!isProfileAgentChangeTrailPage(value)) deniedChildMessage()
      return
    case 'agent-card-neighbors':
      if (!isProfileAgentCardNeighbors(value)) deniedChildMessage()
      return
    case 'agent-card-set-bounds':
      if (!isProfileAgentCardSetBounds(value)) deniedChildMessage()
      return
    case 'apply-agent-command-batch':
      if (!isInstalledOrReplayedProfileAgentCommandReceipt(value)) deniedChildMessage()
      return
    case 'export-portable':
      if (!isProfileTransportPortableExportReceipt(value)) deniedChildMessage()
      return
    case 'duplicate-idea':
    case 'import-idea-closure':
      if (!isProfileTransportIdeaLifecycleReceipt(value)) deniedChildMessage()
      return
    case 'inspect-recovery': {
      if (!isPlainRecord(value)
        || !hasExactKeys(value, [
          'candidates',
          'currentRevision',
          'mode',
          'quarantinedCurrentState',
          'rejectedCandidateIds',
          ...(value.selectedCandidateId === undefined ? [] : ['selectedCandidateId']),
        ])
        || value.mode !== 'inspect'
        || !nonNegativeSafeInteger(value.currentRevision)
        || !Array.isArray(value.candidates)
        || value.candidates.length > PROFILE_UTILITY_RESULT_ID_MAX_COUNT
        || !value.candidates.every(validRecoveryPoint)
        || !uniqueRecoveryCandidateIds(value.candidates)
        || !uniqueBoundedStringArray(value.rejectedCandidateIds)
        || value.quarantinedCurrentState !== false
        || (value.selectedCandidateId !== undefined
          && !boundedString(value.selectedCandidateId, 512))) deniedChildMessage()
      return
    }
    case 'restore-recovery': {
      if (!isPlainRecord(value)
        || !hasExactKeys(value, [
          'mode',
          'previousRevision',
          'quarantinedCurrentState',
          'rejectedCandidateIds',
          'revision',
          'selectedCandidateId',
        ])
        || value.mode !== 'restore'
        || !boundedString(value.selectedCandidateId, 512)
        || !uniqueBoundedStringArray(value.rejectedCandidateIds)
        || typeof value.quarantinedCurrentState !== 'boolean'
        || !nonNegativeSafeInteger(value.previousRevision)
        || !nonNegativeSafeInteger(value.revision)
        || value.revision <= value.previousRevision) {
        deniedChildMessage()
      }
      return
    }
    case 'start-fresh': {
      if (!isPlainRecord(value)
        || !hasExactKeys(value, [
          'mode',
          'operationId',
          'previousRevision',
          'profileId',
          'quarantinedCurrentState',
          'revision',
        ])
        || value.mode !== 'start-fresh'
        || !boundedString(value.operationId, 512)
        || !boundedString(value.profileId, 512)
        || typeof value.quarantinedCurrentState !== 'boolean'
        || !nonNegativeSafeInteger(value.previousRevision)
        || !nonNegativeSafeInteger(value.revision)) {
        deniedChildMessage()
      }
      return
    }
    case 'close':
      if (!isPlainRecord(value)
        || !hasExactKeys(value, ['closed'])
        || value.closed !== true) deniedChildMessage()
      return
    default:
      assertNever(operation)
  }
}

function hasExactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(candidate).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index])
}

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
  const prototype = Object.getPrototypeOf(candidate)
  return prototype === Object.prototype || prototype === null
}

function boundedString(candidate: unknown, maxBytes: number): candidate is string {
  return typeof candidate === 'string'
    && candidate.length > 0
    && new TextEncoder().encode(candidate).byteLength <= maxBytes
}

function uniqueBoundedStringArray(candidate: unknown): candidate is readonly string[] {
  return Array.isArray(candidate)
    && candidate.length <= PROFILE_UTILITY_RESULT_ID_MAX_COUNT
    && candidate.every((entry) => boundedString(entry, PROFILE_UTILITY_RESULT_ID_MAX_BYTES))
    && new Set(candidate).size === candidate.length
}

function canonicalBoundedStringArray(candidate: unknown): candidate is readonly string[] {
  return uniqueBoundedStringArray(candidate)
    && candidate.every((entry, index) => index === 0 || (candidate[index - 1] as string) < entry)
}

function uniqueRecoveryCandidateIds(candidates: readonly unknown[]): boolean {
  const ids = candidates.map((candidate) => (candidate as Record<string, unknown>).id)
  return new Set(ids).size === ids.length
}

function validRecoveryPoint(candidate: unknown): boolean {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, ['createdAt', 'id', 'recordVersion', 'revision', 'verified'])
    && boundedString(candidate.id, PROFILE_UTILITY_RESULT_ID_MAX_BYTES)
    && candidate.recordVersion === PROFILE_CONTRACT_VERSIONS.record
    && nonNegativeSafeInteger(candidate.revision)
    && typeof candidate.verified === 'boolean'
    && boundedString(candidate.createdAt, 128)
}

function absoluteBoundedPath(candidate: unknown): candidate is string {
  return boundedString(candidate, 32_768) && path.isAbsolute(candidate)
}

function nonNegativeSafeInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && (candidate as number) >= 0
}

function deniedParentMessage(): never {
  throw new Error('Profile utility parent message was denied')
}

function deniedChildMessage(): never {
  throw new Error('Profile utility child message was denied')
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Profile utility operation: ${String(value)}`)
}
