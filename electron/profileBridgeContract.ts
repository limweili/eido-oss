import type { GuiProfileProjection } from '../src/persistence/profileGuiProjection'
import {
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
  type ProfileRecoveryPointSummary,
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
  isProfileTransportServiceFailureBody,
  isProfileTransportSnapshot,
  isProfileTransportStatus,
} from '../src/persistence/profileTransportContract'
import {
  captureProfileGuiInertJson,
  PROFILE_GUI_CAPTURE_MAX_BYTES,
} from '../src/persistence/profileGuiSaveScheduler'
import { isProfileIntentActorId } from '../src/persistence/profileIntentActor'
import { validateProfileModDocumentTransport } from '../src/persistence/profileModRecords'
import {
  assertRuntimeProbeResult,
  type RuntimeProbeResult,
} from './runtimeProbeContract'

export const PROFILE_BRIDGE_VERSION = 1 as const
export const PROFILE_BRIDGE_CHANNEL = 'eido:profile:v1' as const
export const PROFILE_BRIDGE_ENVELOPE_MAX_BYTES = 4 * 1024
export const PROFILE_BRIDGE_CONTROL_MAX_BYTES = 16 * 1024
const PROFILE_BRIDGE_JSON_STRING_MAX_EXPANSION = 6
const PROFILE_BRIDGE_QUERY_FILTER_GROUPS = 4
const PROFILE_BRIDGE_QUERY_REQUEST_STRING_MAX_BYTES = PROFILE_QUERY_LIMITS.maxCursorBytes
  + (PROFILE_BRIDGE_QUERY_FILTER_GROUPS
    * PROFILE_QUERY_LIMITS.maxFilterValues
    * PROFILE_QUERY_LIMITS.maxFilterValueBytes)
  + (PROFILE_QUERY_LIMITS.maxProjectionFields
    * PROFILE_QUERY_LIMITS.maxProjectionFieldBytes)
export const PROFILE_BRIDGE_QUERY_REQUEST_MAX_BYTES = (
  PROFILE_BRIDGE_QUERY_REQUEST_STRING_MAX_BYTES
  * PROFILE_BRIDGE_JSON_STRING_MAX_EXPANSION
)
  + PROFILE_BRIDGE_ENVELOPE_MAX_BYTES
export const PROFILE_BRIDGE_QUERY_RESPONSE_MAX_BYTES = PROFILE_QUERY_LIMITS.maxBytes
  + (PROFILE_QUERY_LIMITS.maxCursorBytes * PROFILE_BRIDGE_JSON_STRING_MAX_EXPANSION)
  + PROFILE_BRIDGE_ENVELOPE_MAX_BYTES
export const PROFILE_BRIDGE_MAX_BYTES = PROFILE_GUI_CAPTURE_MAX_BYTES
  + PROFILE_BRIDGE_ENVELOPE_MAX_BYTES
export const PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT = 'eido:profile-checkpoint-request' as const
export const PROFILE_RENDERER_CHECKPOINT_ACK_EVENT = 'eido:profile-checkpoint-ack' as const
export const PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT = 'eido:profile-agent-barrier-request' as const
export const PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT = 'eido:profile-agent-barrier-ack' as const

export type ProfileRendererCheckpointRequest = Readonly<{ token: string }>
export type ProfileRendererCheckpointAck =
  | Readonly<{
      token: string
      ok: true
      generation: number
      nativeGeneration: number
      revision: number
    }>
  | Readonly<{ token: string; ok: false }>

export type ProfileCheckpointWireRequest = Readonly<{
  version: typeof PROFILE_BRIDGE_VERSION
  kind: 'checkpoint-request'
  token: string
}>

export type ProfileCheckpointWireAck = Readonly<{
  version: typeof PROFILE_BRIDGE_VERSION
  kind: 'checkpoint-ack'
}> & ProfileRendererCheckpointAck

export type ProfileRendererAgentBarrierRequest =
  | Readonly<{ token: string; phase: 'begin' }>
  | Readonly<{ token: string; phase: 'seal' }>
  | Readonly<{ token: string; phase: 'complete'; revision: number }>
  | Readonly<{ token: string; phase: 'cancel' }>

export type ProfileRendererAgentBarrierAck =
  | Readonly<{
      token: string
      phase: 'begin' | 'seal'
      ok: true
      generation: number
      nativeGeneration: number
      revision: number
    }>
  | Readonly<{ token: string; phase: 'complete' | 'cancel'; ok: true }>
  | Readonly<{ token: string; phase: 'begin' | 'seal' | 'complete' | 'cancel'; ok: false }>

export type ProfileAgentBarrierWireRequest = Readonly<{
  version: typeof PROFILE_BRIDGE_VERSION
  kind: 'agent-barrier-request'
}> & ProfileRendererAgentBarrierRequest

export type ProfileAgentBarrierWireAck = Readonly<{
  version: typeof PROFILE_BRIDGE_VERSION
  kind: 'agent-barrier-ack'
}> & ProfileRendererAgentBarrierAck

export const PROFILE_BRIDGE_OPERATIONS = [
  'runtime-probe',
  'hydrate',
  'ack-hydration',
  'create-ordinary-idea',
  'commit-gui-projection',
  'flush',
  'status',
  'capabilities',
  'query',
  'export-portable',
  'duplicate-idea',
  'import-idea-closure',
  'inspect-recovery',
  'restore-recovery',
  'start-fresh',
] as const

export type ProfileBridgeOperation = (typeof PROFILE_BRIDGE_OPERATIONS)[number]

/** Renderer-owned state only. Native Profile identity and settings never cross
 * the mutation boundary as renderer authority. */
export type RendererProfileProjection = Readonly<
  Omit<GuiProfileProjection, 'profileId' | 'profileSettings'>
>

export type ProfileBridgeGuiCommitReceipt = Readonly<{
  generation: number
  revision: number
  durable: true
  dirty: false
}>

export type ProfileBridgeFlushReceipt = Readonly<{
  generation: number
  revision: number
}>

export type ProfileBridgeOrdinaryIdeaReceipt = Readonly<{
  ideaId: string
  authorized: true
  createdAt: string
}>

export type ProfileBridgeHydration = Readonly<{
  intentActorId: string
  snapshot: ProfileSnapshot
  acknowledgement: Readonly<{
    epoch: string
    revision: number
  }>
}>

export type ProfileBridgeHydrationAckReceipt = Readonly<{
  acknowledged: true
  epoch: string
  revision: number
}>

export type ProfileBridgePortableExportRequest = Omit<
  ProfilePortableExportRequest<unknown>,
  'destination'
>

export type ProfileBridgeDuplicateIdeaRequest = ProfileDuplicateIdeaRequest

export type ProfileBridgeImportIdeaClosureRequest = Omit<
  ProfileImportIdeaClosureRequest<unknown>,
  'source'
>

export type ProfileBridgePortableExportResult =
  | ProfilePortableExportReceipt
  | Readonly<{ cancelled: true }>

export type ProfileBridgeImportIdeaClosureResult =
  | ProfileIdeaLifecycleReceipt
  | Readonly<{ cancelled: true }>

export type ProfileBridgeRecoveryInspection = Readonly<{
  mode: 'inspect'
  currentRevision: number
  selectedCandidateId?: string
  candidates: readonly ProfileRecoveryPointSummary[]
  rejectedCandidateIds: readonly string[]
  quarantinedCurrentState: false
}>

export type ProfileBridgeRecoveryRestoreReceipt = Readonly<{
  mode: 'restore'
  selectedCandidateId: string
  rejectedCandidateIds: readonly string[]
  quarantinedCurrentState: boolean
  previousRevision: number
  revision: number
}>

export type ProfileBridgeStartFreshReceipt = Readonly<{
  mode: 'start-fresh'
  operationId: string
  previousRevision: number
  profileId: string
  revision: number
  quarantinedCurrentState: boolean
}>

export type ProfileBridgeOperationPayloads = Readonly<{
  'runtime-probe': Readonly<Record<never, never>>
  hydrate: Readonly<Record<never, never>>
  'ack-hydration': Readonly<{ epoch: string; revision: number }>
  'create-ordinary-idea': Readonly<{ ideaId: string }>
  'commit-gui-projection': Readonly<{ projection: RendererProfileProjection }>
  flush: Readonly<Record<never, never>>
  status: Readonly<Record<never, never>>
  capabilities: Readonly<Record<never, never>>
  query: Readonly<{ request: ProfileQueryRequest }>
  'export-portable': Readonly<{ request: ProfileBridgePortableExportRequest }>
  'duplicate-idea': Readonly<{ request: ProfileBridgeDuplicateIdeaRequest }>
  'import-idea-closure': Readonly<{ request: ProfileBridgeImportIdeaClosureRequest }>
  'inspect-recovery': Readonly<Record<never, never>>
  'restore-recovery': Readonly<{ candidateId: string }>
  'start-fresh': Readonly<Record<never, never>>
}>

export type ProfileBridgeOperationResults = Readonly<{
  'runtime-probe': RuntimeProbeResult
  hydrate: ProfileBridgeHydration
  'ack-hydration': ProfileBridgeHydrationAckReceipt
  'create-ordinary-idea': ProfileBridgeOrdinaryIdeaReceipt
  'commit-gui-projection': ProfileBridgeGuiCommitReceipt
  flush: ProfileBridgeFlushReceipt
  status: ProfileStatus
  capabilities: ProfileCapabilities
  query: ProfileQueryPage
  'export-portable': ProfileBridgePortableExportResult
  'duplicate-idea': ProfileIdeaLifecycleReceipt
  'import-idea-closure': ProfileBridgeImportIdeaClosureResult
  'inspect-recovery': ProfileBridgeRecoveryInspection
  'restore-recovery': ProfileBridgeRecoveryRestoreReceipt
  'start-fresh': ProfileBridgeStartFreshReceipt
}>

export type ProfileBridgeRequest<
  Operation extends ProfileBridgeOperation = ProfileBridgeOperation,
> = Operation extends ProfileBridgeOperation
  ? Readonly<{
      version: typeof PROFILE_BRIDGE_VERSION
      requestId: string
      operation: Operation
      payload: ProfileBridgeOperationPayloads[Operation]
    }>
  : never

export type ProfileBridgeSuccess<
  Operation extends ProfileBridgeOperation = ProfileBridgeOperation,
> = Operation extends ProfileBridgeOperation
  ? Readonly<{
      version: typeof PROFILE_BRIDGE_VERSION
      requestId: string
      operation: Operation
      ok: true
      value: ProfileBridgeOperationResults[Operation]
    }>
  : never

export type ProfileBridgeFailure = Readonly<{
  version: typeof PROFILE_BRIDGE_VERSION
  requestId: string
  operation: ProfileBridgeOperation
  ok: false
  error: Readonly<Omit<ProfileServiceFailure, 'ok'>>
}>

export type ProfileBridgeResponse = ProfileBridgeSuccess | ProfileBridgeFailure

export type InstalledProfileBridge = Readonly<{
  runtimeProbe(): Promise<RuntimeProbeResult>
  hydrate(): Promise<ProfileServiceResult<ProfileBridgeHydration>>
  ackHydration(
    epoch: string,
    revision: number,
  ): Promise<ProfileServiceResult<ProfileBridgeHydrationAckReceipt>>
  createOrdinaryIdea(ideaId: string): Promise<ProfileServiceResult<ProfileBridgeOrdinaryIdeaReceipt>>
  commitGuiProjection(
    projection: RendererProfileProjection,
  ): Promise<ProfileServiceResult<ProfileBridgeGuiCommitReceipt>>
  flush(): Promise<ProfileServiceResult<ProfileBridgeFlushReceipt>>
  status(): Promise<ProfileServiceResult<ProfileStatus>>
  capabilities(): Promise<ProfileServiceResult<ProfileCapabilities>>
  query(request: ProfileQueryRequest): Promise<ProfileServiceResult<ProfileQueryPage>>
  exportPortable(
    request: ProfileBridgePortableExportRequest,
  ): Promise<ProfileServiceResult<ProfileBridgePortableExportResult>>
  duplicateIdea(
    request: ProfileBridgeDuplicateIdeaRequest,
  ): Promise<ProfileServiceResult<ProfileIdeaLifecycleReceipt>>
  importIdeaClosure(
    request: ProfileBridgeImportIdeaClosureRequest,
  ): Promise<ProfileServiceResult<ProfileBridgeImportIdeaClosureResult>>
  inspectRecovery(): Promise<ProfileServiceResult<ProfileBridgeRecoveryInspection>>
  restoreRecovery(candidateId: string): Promise<ProfileServiceResult<ProfileBridgeRecoveryRestoreReceipt>>
  startFresh(): Promise<ProfileServiceResult<ProfileBridgeStartFreshReceipt>>
}>

type ProfileBridgeInvoke = (
  channel: typeof PROFILE_BRIDGE_CHANNEL,
  request: ProfileBridgeRequest,
) => Promise<unknown>

const EMPTY_PAYLOAD_OPERATIONS = new Set<ProfileBridgeOperation>([
  'runtime-probe',
  'hydrate',
  'flush',
  'status',
  'capabilities',
  'inspect-recovery',
  'start-fresh',
])

export function createInstalledProfileBridge(
  invoke: ProfileBridgeInvoke,
  createRequestId: () => string = createSequentialRequestId(),
): InstalledProfileBridge {
  const call = async <Operation extends ProfileBridgeOperation>(
    operation: Operation,
    payload: ProfileBridgeOperationPayloads[Operation],
  ): Promise<ProfileServiceResult<ProfileBridgeOperationResults[Operation]>> => {
    const request = Object.freeze({
      version: PROFILE_BRIDGE_VERSION,
      requestId: createRequestId(),
      operation,
      payload,
    }) as ProfileBridgeRequest<Operation>
    const response = assertCorrelatedProfileBridgeResponse(
      await invoke(PROFILE_BRIDGE_CHANNEL, request),
      request,
    )
    if (!response.ok) return Object.freeze({ ok: false, ...response.error })
    return Object.freeze({ ok: true, value: response.value }) as ProfileServiceResult<
      ProfileBridgeOperationResults[Operation]
    >
  }

  return Object.freeze({
    async runtimeProbe() {
      const result = await call('runtime-probe', Object.freeze({}))
      if (!result.ok) throw new Error('Runtime probe was unavailable')
      return result.value
    },
    hydrate: () => call('hydrate', Object.freeze({})),
    ackHydration: (epoch, revision) => call(
      'ack-hydration',
      Object.freeze({ epoch, revision }),
    ),
    createOrdinaryIdea: (ideaId) => call(
      'create-ordinary-idea',
      Object.freeze({ ideaId }),
    ),
    commitGuiProjection: (projection) => call(
      'commit-gui-projection',
      Object.freeze({ projection }),
    ),
    flush: () => call('flush', Object.freeze({})),
    status: () => call('status', Object.freeze({})),
    capabilities: () => call('capabilities', Object.freeze({})),
    query: (request) => call('query', Object.freeze({ request })),
    exportPortable: (request) => call('export-portable', Object.freeze({ request })),
    duplicateIdea: (request) => call('duplicate-idea', Object.freeze({ request })),
    importIdeaClosure: (request) => call('import-idea-closure', Object.freeze({ request })),
    inspectRecovery: () => call('inspect-recovery', Object.freeze({})),
    restoreRecovery: (candidateId) => call(
      'restore-recovery',
      Object.freeze({ candidateId }),
    ),
    startFresh: () => call('start-fresh', Object.freeze({})),
  })
}

/** The main process is the sole renderer trust boundary and performs the full
 * request/result decode. The preload only correlates the structured-cloned
 * response, avoiding a second full Board projection on the UI side. */
function assertCorrelatedProfileBridgeResponse<Operation extends ProfileBridgeOperation>(
  candidate: unknown,
  request: ProfileBridgeRequest<Operation>,
): ProfileBridgeResponse {
  if (!isPlainRecord(candidate)
    || candidate.version !== PROFILE_BRIDGE_VERSION
    || candidate.requestId !== request.requestId
    || candidate.operation !== request.operation
    || typeof candidate.ok !== 'boolean') {
    return deniedResponse()
  }
  if (candidate.ok) {
    if (!hasExactKeys(candidate, ['ok', 'operation', 'requestId', 'value', 'version'])) {
      return deniedResponse()
    }
    if (request.operation === 'create-ordinary-idea'
      && (!validOperationResult(request.operation, candidate.value)
        || !correlatedOperationResult(request, candidate.value))) {
      return deniedResponse()
    }
    return candidate as ProfileBridgeSuccess<Operation>
  }
  if (!hasExactKeys(candidate, ['error', 'ok', 'operation', 'requestId', 'version'])
    || !isProfileTransportServiceFailureBody(candidate.error)) {
    return deniedResponse()
  }
  return candidate as ProfileBridgeFailure
}

export function assertProfileBridgeRequest(candidate: unknown): ProfileBridgeRequest {
  try {
    const operation = peekProfileBridgeRequestOperation(candidate)
    const captured = captureBridgeJson(
      candidate,
      '$bridgeRequest',
      profileBridgeRequestMaxBytes(operation),
    )
    if (!isPlainRecord(captured)
      || !hasExactKeys(captured, ['operation', 'payload', 'requestId', 'version'])
      || captured.version !== PROFILE_BRIDGE_VERSION
      || !boundedString(captured.requestId, 256)
      || captured.operation !== operation
      || !isPlainRecord(captured.payload)) {
      return deniedRequest()
    }
    validatePayload(operation, captured.payload)
    return captured as ProfileBridgeRequest
  } catch {
    return deniedRequest()
  }
}

export function assertProfileCheckpointWireRequest(candidate: unknown): ProfileCheckpointWireRequest {
  if (!isPlainRecord(candidate)
    || !hasExactKeys(candidate, ['kind', 'token', 'version'])
    || candidate.version !== PROFILE_BRIDGE_VERSION
    || candidate.kind !== 'checkpoint-request'
    || !boundedString(candidate.token, 256)) {
    throw new Error('Profile checkpoint request was denied')
  }
  return Object.freeze(candidate) as ProfileCheckpointWireRequest
}

export function assertProfileAgentBarrierWireRequest(
  candidate: unknown,
): ProfileAgentBarrierWireRequest {
  if (!isPlainRecord(candidate)
    || candidate.version !== PROFILE_BRIDGE_VERSION
    || candidate.kind !== 'agent-barrier-request'
    || !boundedString(candidate.token, 256)
    || (candidate.phase !== 'begin'
      && candidate.phase !== 'seal'
      && candidate.phase !== 'complete'
      && candidate.phase !== 'cancel')) {
    throw new Error('Profile Agent barrier request was denied')
  }
  const expectedKeys = candidate.phase === 'complete'
    ? ['kind', 'phase', 'revision', 'token', 'version']
    : ['kind', 'phase', 'token', 'version']
  if (!hasExactKeys(candidate, expectedKeys)
    || (candidate.phase === 'complete' && !nonNegativeSafeInteger(candidate.revision))) {
    throw new Error('Profile Agent barrier request was denied')
  }
  return Object.freeze(candidate) as ProfileAgentBarrierWireRequest
}

export function assertProfileAgentBarrierWireAck(
  candidate: unknown,
): ProfileAgentBarrierWireAck {
  if (!isPlainRecord(candidate)
    || candidate.version !== PROFILE_BRIDGE_VERSION
    || candidate.kind !== 'agent-barrier-ack'
    || !boundedString(candidate.token, 256)
    || (candidate.phase !== 'begin'
      && candidate.phase !== 'seal'
      && candidate.phase !== 'complete'
      && candidate.phase !== 'cancel')
    || typeof candidate.ok !== 'boolean') {
    throw new Error('Profile Agent barrier acknowledgement was denied')
  }
  if (!candidate.ok || (candidate.phase !== 'begin' && candidate.phase !== 'seal')) {
    if (!hasExactKeys(candidate, ['kind', 'ok', 'phase', 'token', 'version'])) {
      throw new Error('Profile Agent barrier acknowledgement was denied')
    }
    return Object.freeze(candidate) as ProfileAgentBarrierWireAck
  }
  if (!hasExactKeys(candidate, [
    'generation',
    'kind',
    'nativeGeneration',
    'ok',
    'phase',
    'revision',
    'token',
    'version',
  ])
    || !nonNegativeSafeInteger(candidate.generation)
    || !nonNegativeSafeInteger(candidate.nativeGeneration)
    || !nonNegativeSafeInteger(candidate.revision)) {
    throw new Error('Profile Agent barrier acknowledgement was denied')
  }
  return Object.freeze(candidate) as ProfileAgentBarrierWireAck
}

export function assertProfileCheckpointWireAck(candidate: unknown): ProfileCheckpointWireAck {
  if (!isPlainRecord(candidate)
    || candidate.version !== PROFILE_BRIDGE_VERSION
    || candidate.kind !== 'checkpoint-ack'
    || !boundedString(candidate.token, 256)
    || typeof candidate.ok !== 'boolean') {
    throw new Error('Profile checkpoint acknowledgement was denied')
  }
  if (!candidate.ok) {
    if (!hasExactKeys(candidate, ['kind', 'ok', 'token', 'version'])) {
      throw new Error('Profile checkpoint acknowledgement was denied')
    }
    return Object.freeze(candidate) as ProfileCheckpointWireAck
  }
  if (!hasExactKeys(candidate, [
    'generation',
    'kind',
    'nativeGeneration',
    'ok',
    'revision',
    'token',
    'version',
  ])
    || !nonNegativeSafeInteger(candidate.generation)
    || !nonNegativeSafeInteger(candidate.nativeGeneration)
    || !nonNegativeSafeInteger(candidate.revision)) {
    throw new Error('Profile checkpoint acknowledgement was denied')
  }
  return Object.freeze(candidate) as ProfileCheckpointWireAck
}

export function assertProfileBridgeResponse<Operation extends ProfileBridgeOperation>(
  candidate: unknown,
  request: ProfileBridgeRequest<Operation>,
): ProfileBridgeResponse {
  try {
    const captured = captureBridgeJson(
      candidate,
      '$bridgeResponse',
      request.operation === 'query'
        ? PROFILE_BRIDGE_QUERY_RESPONSE_MAX_BYTES
        : PROFILE_BRIDGE_MAX_BYTES,
    )
    if (!isPlainRecord(captured)
      || captured.version !== PROFILE_BRIDGE_VERSION
      || captured.requestId !== request.requestId
      || captured.operation !== request.operation
      || typeof captured.ok !== 'boolean') {
      return deniedResponse()
    }
    if (captured.ok) {
      if (!hasExactKeys(captured, ['ok', 'operation', 'requestId', 'value', 'version'])
        || !validOperationResult(request.operation, captured.value)
        || !correlatedOperationResult(request, captured.value)) {
        return deniedResponse()
      }
      return captured as ProfileBridgeSuccess<Operation>
    }
    if (!hasExactKeys(captured, ['error', 'ok', 'operation', 'requestId', 'version'])
      || !isProfileTransportServiceFailureBody(captured.error)) {
      return deniedResponse()
    }
    return captured as ProfileBridgeFailure
  } catch {
    return deniedResponse()
  }
}

function peekProfileBridgeRequestOperation(candidate: unknown): ProfileBridgeOperation {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) deniedRequest()
  const prototype = Object.getPrototypeOf(candidate)
  if (prototype !== Object.prototype && prototype !== null) deniedRequest()
  if (Object.getOwnPropertySymbols(candidate).length > 0) deniedRequest()

  const descriptors = Object.getOwnPropertyDescriptors(candidate)
  const expectedKeys = ['operation', 'payload', 'requestId', 'version']
  const keys = Object.keys(descriptors).sort()
  if (keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])) {
    deniedRequest()
  }
  for (const key of expectedKeys) {
    const descriptor = descriptors[key]
    if (!descriptor?.enumerable || !('value' in descriptor)) deniedRequest()
  }

  const version = descriptors.version!.value as unknown
  const requestId = descriptors.requestId!.value as unknown
  const operation = descriptors.operation!.value as unknown
  if (version !== PROFILE_BRIDGE_VERSION
    || !boundedString(requestId, 256)
    || !PROFILE_BRIDGE_OPERATIONS.includes(operation as ProfileBridgeOperation)) {
    deniedRequest()
  }
  return operation as ProfileBridgeOperation
}

function profileBridgeRequestMaxBytes(operation: ProfileBridgeOperation): number {
  if (operation === 'commit-gui-projection') return PROFILE_BRIDGE_MAX_BYTES
  if (operation === 'query') return PROFILE_BRIDGE_QUERY_REQUEST_MAX_BYTES
  return PROFILE_BRIDGE_CONTROL_MAX_BYTES
}

function captureBridgeJson(
  candidate: unknown,
  root: string,
  maxBytes: number = PROFILE_BRIDGE_MAX_BYTES,
): unknown {
  return captureProfileGuiInertJson(candidate, root, maxBytes)
}

function validatePayload(operation: ProfileBridgeOperation, payload: Record<string, unknown>): void {
  if (EMPTY_PAYLOAD_OPERATIONS.has(operation)) {
    if (!hasExactKeys(payload, [])) deniedRequest()
    return
  }
  switch (operation) {
    case 'create-ordinary-idea':
      if (!hasExactKeys(payload, ['ideaId']) || !boundedString(payload.ideaId, 512)) deniedRequest()
      return
    case 'ack-hydration':
      if (!hasExactKeys(payload, ['epoch', 'revision'])
        || !boundedString(payload.epoch, 512)
        || !nonNegativeSafeInteger(payload.revision)) {
        deniedRequest()
      }
      return
    case 'commit-gui-projection':
      if (!hasExactKeys(payload, ['projection']) || !validRendererProjection(payload.projection)) deniedRequest()
      return
    case 'query': {
      if (!hasExactKeys(payload, ['request']) || !validateProfileQuery(payload.request).ok) deniedRequest()
      return
    }
    case 'export-portable':
      if (!hasExactKeys(payload, ['request']) || !validPortableRequest(payload.request, 'export')) deniedRequest()
      return
    case 'duplicate-idea':
      if (!hasExactKeys(payload, ['request']) || !validPortableRequest(payload.request, 'duplicate')) deniedRequest()
      return
    case 'import-idea-closure':
      if (!hasExactKeys(payload, ['request']) || !validPortableRequest(payload.request, 'import-idea')) deniedRequest()
      return
    case 'restore-recovery':
      if (!hasExactKeys(payload, ['candidateId'])
        || !boundedString(payload.candidateId, 512)) {
        deniedRequest()
      }
      return
    case 'runtime-probe':
    case 'hydrate':
    case 'flush':
    case 'status':
    case 'capabilities':
    case 'inspect-recovery':
    case 'start-fresh':
      return
    default:
      assertNever(operation)
  }
}

function validRendererProjection(candidate: unknown): candidate is RendererProfileProjection {
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

function validPortableRequest(candidate: unknown, kind: 'export' | 'duplicate' | 'import-idea'): boolean {
  if (!isPlainRecord(candidate)
    || candidate.version !== PROFILE_PORTABLE_LIFECYCLE_VERSION
    || !boundedString(candidate.operationId, 512)
    || !nonNegativeSafeInteger(candidate.expectedRevision)) {
    return false
  }
  const common = ['expectedRevision', 'operationId']
  if (kind === 'export') return hasExactKeys(candidate, [...common, 'version'])
  if (!boundedString(candidate.idempotencyKey, 512)
    || (candidate.name !== undefined && !boundedString(candidate.name, 4_096))) {
    return false
  }
  if (kind === 'duplicate') {
    return boundedString(candidate.sourceIdeaId, 512)
      && hasExactKeys(candidate, [
        ...common,
        'idempotencyKey',
        ...(candidate.name === undefined ? [] : ['name']),
        'sourceIdeaId',
        'version',
      ])
  }
  return hasExactKeys(candidate, [
    ...common,
    'idempotencyKey',
    ...(candidate.name === undefined ? [] : ['name']),
    'version',
  ])
}

function validOperationResult(operation: ProfileBridgeOperation, candidate: unknown): boolean {
  switch (operation) {
    case 'runtime-probe':
      try {
        assertRuntimeProbeResult(candidate)
        return true
      } catch {
        return false
      }
    case 'hydrate':
      return isPlainRecord(candidate)
        && hasExactKeys(candidate, ['acknowledgement', 'intentActorId', 'snapshot'])
        && isProfileIntentActorId(candidate.intentActorId)
        && isProfileTransportSnapshot(candidate.snapshot)
        && isPlainRecord(candidate.acknowledgement)
        && hasExactKeys(candidate.acknowledgement, ['epoch', 'revision'])
        && boundedString(candidate.acknowledgement.epoch, 512)
        && nonNegativeSafeInteger(candidate.acknowledgement.revision)
        && candidate.acknowledgement.revision === candidate.snapshot.revision
    case 'ack-hydration':
      return isPlainRecord(candidate)
        && hasExactKeys(candidate, ['acknowledged', 'epoch', 'revision'])
        && candidate.acknowledged === true
        && boundedString(candidate.epoch, 512)
        && nonNegativeSafeInteger(candidate.revision)
    case 'create-ordinary-idea':
      return isPlainRecord(candidate)
        && hasExactKeys(candidate, ['authorized', 'createdAt', 'ideaId'])
        && candidate.authorized === true
        && boundedString(candidate.ideaId, 512)
        && canonicalTimestamp(candidate.createdAt)
    case 'commit-gui-projection':
      return isPlainRecord(candidate)
        && hasExactKeys(candidate, ['dirty', 'durable', 'generation', 'revision'])
        && positiveSafeInteger(candidate.generation)
        && nonNegativeSafeInteger(candidate.revision)
        && candidate.durable === true
        && candidate.dirty === false
    case 'flush':
      return isPlainRecord(candidate)
        && hasExactKeys(candidate, ['generation', 'revision'])
        && nonNegativeSafeInteger(candidate.generation)
        && nonNegativeSafeInteger(candidate.revision)
    case 'status':
      return isProfileTransportStatus(candidate)
    case 'capabilities':
      return isProfileTransportCapabilities(candidate)
    case 'query':
      return isProfileTransportQueryPage(candidate)
    case 'export-portable':
      return validCancelled(candidate) || isProfileTransportPortableExportReceipt(candidate)
    case 'duplicate-idea':
      return isProfileTransportIdeaLifecycleReceipt(candidate)
    case 'import-idea-closure':
      return validCancelled(candidate) || isProfileTransportIdeaLifecycleReceipt(candidate)
    case 'inspect-recovery':
      return validRecoveryInspection(candidate)
    case 'restore-recovery':
      return validRecoveryRestore(candidate)
    case 'start-fresh':
      return validStartFreshReceipt(candidate)
    default:
      return assertNever(operation)
  }
}

function correlatedOperationResult(
  request: ProfileBridgeRequest,
  candidate: unknown,
): boolean {
  if (request.operation !== 'create-ordinary-idea') return true
  return isPlainRecord(candidate) && candidate.ideaId === request.payload.ideaId
}

function validRecoveryInspection(candidate: unknown): candidate is ProfileBridgeRecoveryInspection {
  if (!isPlainRecord(candidate)
    || !hasOptionalExactKeys(
      candidate,
      ['candidates', 'currentRevision', 'mode', 'quarantinedCurrentState', 'rejectedCandidateIds'],
      ['selectedCandidateId'],
    )
    || candidate.mode !== 'inspect'
    || !nonNegativeSafeInteger(candidate.currentRevision)
    || candidate.quarantinedCurrentState !== false
    || (candidate.selectedCandidateId !== undefined && !boundedString(candidate.selectedCandidateId, 512))
    || !Array.isArray(candidate.candidates)
    || !stringArray(candidate.rejectedCandidateIds)) {
    return false
  }
  return candidate.candidates.every(validRecoveryPoint)
}

function validRecoveryRestore(candidate: unknown): candidate is ProfileBridgeRecoveryRestoreReceipt {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, [
      'mode',
      'previousRevision',
      'quarantinedCurrentState',
      'rejectedCandidateIds',
      'revision',
      'selectedCandidateId',
    ])
    && candidate.mode === 'restore'
    && boundedString(candidate.selectedCandidateId, 512)
    && stringArray(candidate.rejectedCandidateIds)
    && typeof candidate.quarantinedCurrentState === 'boolean'
    && nonNegativeSafeInteger(candidate.previousRevision)
    && nonNegativeSafeInteger(candidate.revision)
    && candidate.revision > candidate.previousRevision
}

function validStartFreshReceipt(candidate: unknown): candidate is ProfileBridgeStartFreshReceipt {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, [
      'mode',
      'operationId',
      'previousRevision',
      'profileId',
      'quarantinedCurrentState',
      'revision',
    ])
    && candidate.mode === 'start-fresh'
    && boundedString(candidate.operationId, 512)
    && boundedString(candidate.profileId, 512)
    && typeof candidate.quarantinedCurrentState === 'boolean'
    && nonNegativeSafeInteger(candidate.previousRevision)
    && nonNegativeSafeInteger(candidate.revision)
}

function validRecoveryPoint(candidate: unknown): boolean {
  return isPlainRecord(candidate)
    && hasExactKeys(candidate, ['createdAt', 'id', 'recordVersion', 'revision', 'verified'])
    && boundedString(candidate.id, 512)
    && positiveSafeInteger(candidate.recordVersion)
    && nonNegativeSafeInteger(candidate.revision)
    && typeof candidate.verified === 'boolean'
    && boundedString(candidate.createdAt, 128)
}

function validCancelled(candidate: unknown): boolean {
  return isPlainRecord(candidate) && hasExactKeys(candidate, ['cancelled']) && candidate.cancelled === true
}

function hasExactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(candidate).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index])
}

function hasOptionalExactKeys(
  candidate: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  return required.every((key) => Object.prototype.hasOwnProperty.call(candidate, key))
    && Object.keys(candidate).every((key) => required.includes(key) || optional.includes(key))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= maxBytes
}

function stringArray(candidate: unknown): candidate is readonly string[] {
  return Array.isArray(candidate) && candidate.every((value) => boundedString(value, 512))
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function createSequentialRequestId(): () => string {
  let sequence = 0
  return () => {
    sequence += 1
    return `profile-renderer-${sequence}`
  }
}

function deniedRequest(): never {
  throw new Error('Profile bridge request was denied')
}

function deniedResponse(): never {
  throw new Error('Profile bridge response was denied')
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Profile bridge operation: ${String(value)}`)
}
