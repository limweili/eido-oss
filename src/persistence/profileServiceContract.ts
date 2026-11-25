import type { IdeaSummary, IntentLogEvent, SavedBoard } from '../graph/types'
import {
  CARD_CREATOR_KINDS,
  type CardCreatorKind,
} from '../graph/cardAuthorship.ts'
import type { ProfileAgentCommandBatchCapability } from './profileAgentCommandManifest'
import type { ProfileModInstanceRecord, ProfileModTemplateRecord } from './profileModRecords'

export const PROFILE_CONTRACT_VERSIONS = {
  profile: 1,
  schema: 1,
  record: 2,
  asset: 1,
  app: 1,
  command: 1,
  export: 1,
} as const

// Profile-setting payloads have their own envelope version. They remain v1
// while the physical Profile record envelope advances independently.
export const PROFILE_SETTING_RECORD_VERSION = 1 as const

export type ProfileContractVersions = typeof PROFILE_CONTRACT_VERSIONS

export const PROFILE_GATEWAY_PROTOCOL_VERSION = 1 as const
export const PROFILE_GATEWAY_COMPATIBILITY_VERSION = 1 as const
export const PROFILE_GATEWAY_VERSIONS = {
  gateway: PROFILE_GATEWAY_PROTOCOL_VERSION,
  schema: PROFILE_CONTRACT_VERSIONS.schema,
  record: PROFILE_CONTRACT_VERSIONS.record,
  command: PROFILE_CONTRACT_VERSIONS.command,
  export: PROFILE_CONTRACT_VERSIONS.export,
  compatibility: PROFILE_GATEWAY_COMPATIBILITY_VERSION,
} as const

export class ProfileUnsupportedFutureVersionError extends Error {
  readonly supportedVersions = PROFILE_CONTRACT_VERSIONS
}

export const PROFILE_CONTRACT_VERSION_DIMENSIONS = [
  'profile',
  'schema',
  'record',
  'asset',
  'app',
  'command',
  'export',
] as const satisfies readonly (keyof ProfileContractVersions)[]

export const PROFILE_SERVICE_OPERATIONS = [
  'status',
  'capabilities',
  'snapshot',
  'query',
  'command-batch',
  'flush',
  'recovery',
  'portable-export',
  'portable-import',
] as const

export type ProfileServiceOperation = (typeof PROFILE_SERVICE_OPERATIONS)[number]
export const PROFILE_ADAPTER_KINDS = [
  'sqlite',
  'browser-development',
  'in-memory',
  'fault-test',
] as const
export type ProfileAdapterKind = (typeof PROFILE_ADAPTER_KINDS)[number]
export type ProfileOperationAvailability = 'available' | 'unavailable'

export const PROFILE_SERVICE_OPERATION_METHODS = {
  status: 'status',
  capabilities: 'capabilities',
  snapshot: 'snapshot',
  query: 'query',
  'command-batch': 'applyCommandBatch',
  flush: 'flush',
  recovery: 'recover',
  'portable-export': 'exportPortable',
  'portable-import': 'importPortableIntoFreshProfile',
} as const satisfies Record<ProfileServiceOperation, string>

export type ProfileOperationRevisionSemantics =
  | 'consistent-observation'
  | 'increment-on-acknowledged-commit'
  | 'preserve'
  | 'preserve-source-on-fresh-import'
  | 'new-highest-on-restore'
  | 'not-applicable'

export type ProfileServiceOperationContract = {
  mutating: boolean
  physicalAuthority: 'hidden'
  revision: ProfileOperationRevisionSemantics
  atomic?: true
  expectedRevision?: 'required' | 'required-for-restore'
  bounded?: true
  rendererHydration?: 'saved-board-contract'
  copyFirst?: true
  portableBoundary?: 'logical-records-and-assets'
}

export const PROFILE_SERVICE_OPERATION_CONTRACTS: Record<ProfileServiceOperation, ProfileServiceOperationContract> = {
  status: operationContract(false, 'consistent-observation'),
  capabilities: operationContract(false, 'not-applicable'),
  snapshot: operationContract(false, 'consistent-observation', { rendererHydration: 'saved-board-contract' }),
  query: operationContract(false, 'consistent-observation', { bounded: true }),
  'command-batch': operationContract(true, 'increment-on-acknowledged-commit', {
    atomic: true,
    expectedRevision: 'required',
  }),
  flush: operationContract(false, 'preserve', { expectedRevision: 'required' }),
  recovery: operationContract(true, 'new-highest-on-restore', {
    atomic: true,
    expectedRevision: 'required-for-restore',
  }),
  'portable-export': operationContract(false, 'preserve', {
    expectedRevision: 'required',
    portableBoundary: 'logical-records-and-assets',
  }),
  'portable-import': operationContract(true, 'preserve-source-on-fresh-import', {
    atomic: true,
    copyFirst: true,
    portableBoundary: 'logical-records-and-assets',
  }),
}

export type ProfileAdapterDescriptor = {
  kind: ProfileAdapterKind
  versions: ProfileContractVersions
  operations: Record<ProfileServiceOperation, ProfileOperationAvailability>
}

export const PROFILE_ADAPTER_CAPABILITY_REQUIREMENTS: Record<ProfileAdapterKind, ProfileAdapterDescriptor> = {
  sqlite: adapterDescriptor('sqlite'),
  'browser-development': adapterDescriptor('browser-development', ['recovery']),
  'in-memory': adapterDescriptor('in-memory', ['recovery']),
  'fault-test': adapterDescriptor('fault-test', [
    'capabilities',
    'query',
    'flush',
    'recovery',
    'portable-export',
    'portable-import',
  ]),
}

export const PROFILE_SERVICE_ERROR_CODES = [
  'busy',
  'conflict',
  'unsupported-future-version',
  'invalid',
  'not-found',
  'corrupt-or-recovery-required',
  'capability-denied',
  'idea-remap-too-large',
  'internal',
] as const

export type ProfileServiceErrorCode = (typeof PROFILE_SERVICE_ERROR_CODES)[number]

export type ProfileServiceFailureContract = {
  retryable: boolean
  message: string
}

export const PROFILE_SERVICE_FAILURE_CONTRACTS: Record<ProfileServiceErrorCode, ProfileServiceFailureContract> = {
  busy: {
    retryable: true,
    message: 'Another owner is changing this Profile. Try again when it is available.',
  },
  conflict: {
    retryable: true,
    message: 'The Profile changed. Read the current revision before retrying.',
  },
  'unsupported-future-version': {
    retryable: false,
    message: 'This Profile was written by a newer incompatible version of Eido.',
  },
  invalid: {
    retryable: false,
    message: 'The request does not satisfy the Local Profile Service contract.',
  },
  'not-found': {
    retryable: false,
    message: 'The requested Profile record was not found.',
  },
  'corrupt-or-recovery-required': {
    retryable: false,
    message: 'This Profile needs a verified recovery choice before it can continue.',
  },
  'capability-denied': {
    retryable: false,
    message: 'The requested operation is not part of the public Agent Gateway.',
  },
  'idea-remap-too-large': {
    retryable: false,
    message: 'This Idea contains more asset data than this Eido version can safely remap.',
  },
  internal: {
    retryable: true,
    message: 'The operation did not complete. Retry or inspect Profile status.',
  },
}

export type ProfileServiceFailure = {
  ok: false
  code: ProfileServiceErrorCode
  retryable: boolean
  message: string
  currentRevision?: number
  supportedVersions?: ProfileContractVersions
  supportedGatewayProtocolVersion?: typeof PROFILE_GATEWAY_PROTOCOL_VERSION
}

export type ProfileServiceResult<Value> = { ok: true; value: Value } | ProfileServiceFailure

export function profileServiceFailure(
  code: ProfileServiceErrorCode,
  context: Pick<
    ProfileServiceFailure,
    'currentRevision' | 'supportedVersions' | 'supportedGatewayProtocolVersion'
  > = {},
): ProfileServiceFailure {
  return { ok: false, code, ...PROFILE_SERVICE_FAILURE_CONTRACTS[code], ...context }
}

export type ProfileCompatibility = {
  read: 'supported'
  write: 'supported'
  source: 'friends-alpha'
}

export type ProfileSettingRecord = {
  id: string
  recordVersion: typeof PROFILE_SETTING_RECORD_VERSION
  classification: 'portable-profile'
  value: ProfileJsonValue
}

export type ProfileMigrationLedgerEntry = {
  id: string
  recordVersion: typeof PROFILE_CONTRACT_VERSIONS.record
  source: 'eido-v3' | 'friends-alpha'
  sourceVersion: number
  targetVersion: number
  completedAt: string
  sourceRetained: true
}

export type ProfileRecoveryPointSummary = {
  id: string
  recordVersion: typeof PROFILE_CONTRACT_VERSIONS.record
  revision: number
  verified: boolean
  createdAt: string
}

export type ProfileSnapshot = {
  profileId: string
  revision: number
  versions: ProfileContractVersions
  activeIdeaId: string
  ideas: IdeaSummary[]
  boards: Record<string, SavedBoard>
  modTemplates: ProfileModTemplateRecord[]
  modInstances: ProfileModInstanceRecord[]
  profileAgentEvents?: import('./profileAgentEvent').ProfileAgentEventRecord[]
  profileSettings: ProfileSettingRecord[]
  migrationLedger: ProfileMigrationLedgerEntry[]
  recoveryPoints: ProfileRecoveryPointSummary[]
  compatibility: ProfileCompatibility
}

export type ProfileSnapshotReader = {
  snapshot(request?: { ideaIds?: string[] }): Promise<ProfileServiceResult<ProfileSnapshot>>
}

export type ProfileLogicalRecordKind =
  | 'profile'
  | 'idea'
  | 'board'
  | 'card'
  | 'block'
  | 'connection'
  | 'output'
  | 'output-version'
  | 'run'
  | 'transcript-message'
  | 'follow-up-message'
  | 'intent-event'
  | 'profile-agent-event'
  | 'logical-asset'
  | 'board-settings'
  | 'highlight'
  | 'highlight-tag'
  | 'compaction-summary'
  | 'mod-template'
  | 'mod-instance'
  | 'compatibility-state'
  | 'migration-ledger-entry'
  | 'recovery-point'
  | 'profile-setting'

export type ProfileLogicalRecordContract = {
  kind: ProfileLogicalRecordKind
  owner: 'profile' | 'idea' | 'board'
  identity: 'stable-global-id' | 'stable-owner-key'
  version: typeof PROFILE_CONTRACT_VERSIONS.record
  retention: 'authoritative' | 'append-only' | 'derived-cache' | 'bounded-recovery'
}

export const PROFILE_LOGICAL_RECORDS: readonly ProfileLogicalRecordContract[] = [
  logicalRecord('profile', 'profile', 'stable-global-id', 'authoritative'),
  logicalRecord('idea', 'profile', 'stable-global-id', 'authoritative'),
  logicalRecord('board', 'idea', 'stable-global-id', 'authoritative'),
  logicalRecord('card', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('block', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('connection', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('output', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('output-version', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('run', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('transcript-message', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('follow-up-message', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('intent-event', 'board', 'stable-global-id', 'append-only'),
  logicalRecord('profile-agent-event', 'profile', 'stable-global-id', 'append-only'),
  logicalRecord('logical-asset', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('board-settings', 'board', 'stable-owner-key', 'authoritative'),
  logicalRecord('highlight', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('highlight-tag', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('compaction-summary', 'board', 'stable-owner-key', 'derived-cache'),
  logicalRecord('mod-template', 'profile', 'stable-global-id', 'authoritative'),
  logicalRecord('mod-instance', 'board', 'stable-global-id', 'authoritative'),
  logicalRecord('compatibility-state', 'profile', 'stable-owner-key', 'authoritative'),
  logicalRecord('migration-ledger-entry', 'profile', 'stable-global-id', 'append-only'),
  logicalRecord('recovery-point', 'profile', 'stable-global-id', 'bounded-recovery'),
  logicalRecord('profile-setting', 'profile', 'stable-owner-key', 'authoritative'),
]

export type ProfileQueryableRecordKind = Exclude<ProfileLogicalRecordKind, 'recovery-point'>

export const PROFILE_QUERYABLE_RECORD_KINDS = PROFILE_LOGICAL_RECORDS
  .map((record) => record.kind)
  .filter((kind): kind is ProfileQueryableRecordKind => kind !== 'recovery-point')

export type ProfileDurableBoardClass =
  | 'cards'
  | 'blocks'
  | 'connections'
  | 'groups'
  | 'intent-metadata'
  | 'outputs'
  | 'versions'
  | 'runs'
  | 'transcripts'
  | 'follow-ups'
  | 'intent-log'
  | 'assets'
  | 'board-settings'
  | 'highlights'
  | 'compaction-summaries'

export const PROFILE_DURABLE_CLASS_RECORD_MAP: Record<ProfileDurableBoardClass, ProfileLogicalRecordKind> = {
  cards: 'card',
  blocks: 'block',
  connections: 'connection',
  groups: 'card',
  'intent-metadata': 'intent-event',
  outputs: 'output',
  versions: 'output-version',
  runs: 'run',
  transcripts: 'transcript-message',
  'follow-ups': 'follow-up-message',
  'intent-log': 'intent-event',
  assets: 'logical-asset',
  'board-settings': 'board-settings',
  highlights: 'highlight',
  'compaction-summaries': 'compaction-summary',
}

export const PROFILE_IDENTITY_AND_ORDERING_BOUNDARY = {
  recordIds: 'stable-across-revisions-and-portable-transfer',
  references: 'logical-id-only',
  meaningfulCollections: 'preserve-domain-order',
  serializationKeyOrder: 'not-semantic',
} as const

export const SEMANTIC_INDEX_BOUNDARY = {
  authority: 'derived',
  lifecycle: 'disposable-and-rebuildable',
  storage: 'optional-sidecar',
  portableExport: 'excluded-by-default',
  contextPolicy: 'separate-versioned-and-labeled',
  implementation: 'absent',
} as const

export const MOD_PROFILE_BOUNDARY = {
  templateOwner: 'profile',
  instanceOwner: 'board',
  stamping: 'deep-copy-and-remap-internal-id-closure',
  templateMutationEffect: 'future-stamps-only',
  instanceLibraryDependency: 'none',
  futureFields: 'optional-data-only-round-trip',
  executableContent: 'forbidden',
} as const

export const ASSET_PROFILE_BOUNDARY = {
  logicalIdentity: 'stable-global-id',
  contentIdentity: 'sha256-digest',
  equalBytes: 'physical-deduplication-only',
  logicalIdentityMerge: 'forbidden',
  rendererHydration: 'path-free-logical-asset',
  portableExport: 'digest-verified-closure',
} as const

export const PROFILE_SECRET_BOUNDARY = {
  credentials: 'account-private-local-file-and-excluded',
  deviceSecrets: 'excluded',
  filesystemPaths: 'opaque',
  diagnostics: 'redacted',
  gateway: 'unreachable',
  portableExport: 'excluded',
} as const

export const PROFILE_QUERY_LIMITS = {
  defaultItems: 50,
  maxItems: 200,
  defaultBytes: 64 * 1024,
  maxBytes: 256 * 1024,
  maxFilterValues: 16,
  maxFilterValueBytes: 512,
  maxProjectionFields: 16,
  maxProjectionFieldBytes: 128,
  maxCursorBytes: 256 * 1024,
} as const

export type ProfileQueryRequest = {
  creator?: CardCreatorKind
  recordKinds?: readonly ProfileQueryableRecordKind[]
  recordIds?: readonly string[]
  ownerIds?: readonly string[]
  parentIds?: readonly (string | null)[]
  limit?: number
  byteLimit?: number
  cursor?: string
  projection?: readonly string[]
}

export type NormalizedProfileQuery = {
  creator?: CardCreatorKind
  recordKinds?: readonly ProfileQueryableRecordKind[]
  recordIds?: readonly string[]
  ownerIds?: readonly string[]
  parentIds?: readonly (string | null)[]
  limit: number
  byteLimit: number
  cursor?: string
  projection?: readonly string[]
}

export type ProfileQueryItem = Readonly<{
  recordId: string
  kind: ProfileQueryableRecordKind
  ownerId: string
  parentId: string | null
  ordinal: number
  recordVersion: number
  payload: ProfileJsonValue
}>

export type ProfileQueryPage = Readonly<{
  profileId: string
  revision: number
  items: readonly ProfileQueryItem[]
  nextCursor?: string
  truncated: boolean
}>

export function validateProfileQuery(request: unknown): ProfileServiceResult<NormalizedProfileQuery> {
  if (!isRecord(request)) return profileServiceFailure('invalid')
  if (!hasOnlyKeys(request, [
    'creator',
    'recordKinds',
    'recordIds',
    'ownerIds',
    'parentIds',
    'limit',
    'byteLimit',
    'cursor',
    'projection',
  ])) return profileServiceFailure('invalid')

  const recordKinds = normalizeStringFilter(request.recordKinds)
  const recordIds = normalizeStringFilter(request.recordIds)
  const ownerIds = normalizeStringFilter(request.ownerIds)
  const parentIds = normalizeParentFilter(request.parentIds)
  if (!recordKinds.ok || !recordIds.ok || !ownerIds.ok || !parentIds.ok) {
    return profileServiceFailure('invalid')
  }
  if (
    request.creator !== undefined
    && !CARD_CREATOR_KINDS.includes(request.creator as CardCreatorKind)
  ) return profileServiceFailure('invalid')
  if (
    request.creator === undefined
    && recordKinds.value === undefined
    && recordIds.value === undefined
    && ownerIds.value === undefined
    && parentIds.value === undefined
  ) return profileServiceFailure('invalid')
  if (recordKinds.value?.some((kind) => !PROFILE_QUERYABLE_RECORD_KINDS.includes(
    kind as ProfileQueryableRecordKind,
  ))) return profileServiceFailure('invalid')

  const limit = request.limit === undefined ? PROFILE_QUERY_LIMITS.defaultItems : request.limit
  if (
    !Number.isInteger(limit)
    || (limit as number) < 1
    || (limit as number) > PROFILE_QUERY_LIMITS.maxItems
  ) {
    return profileServiceFailure('invalid')
  }

  const byteLimit = request.byteLimit === undefined ? PROFILE_QUERY_LIMITS.defaultBytes : request.byteLimit
  if (
    !Number.isInteger(byteLimit)
    || (byteLimit as number) < 2
    || (byteLimit as number) > PROFILE_QUERY_LIMITS.maxBytes
  ) return profileServiceFailure('invalid')

  const cursor = request.cursor
  if (
    cursor !== undefined
    && (
      !isNonEmptyString(cursor)
      || utf8ByteLength(cursor) > PROFILE_QUERY_LIMITS.maxCursorBytes
    )
  ) {
    return profileServiceFailure('invalid')
  }

  const projection = request.projection
  if (
    projection !== undefined
    && (
      !Array.isArray(projection)
      || projection.length > PROFILE_QUERY_LIMITS.maxProjectionFields
      || projection.some((field) => (
        !isNonEmptyString(field)
        || utf8ByteLength(field) > PROFILE_QUERY_LIMITS.maxProjectionFieldBytes
      ))
      || new Set(projection).size !== projection.length
    )
  ) {
    return profileServiceFailure('invalid')
  }

  return {
    ok: true,
    value: {
      ...(request.creator === undefined ? {} : { creator: request.creator as CardCreatorKind }),
      ...(recordKinds.value === undefined
        ? {}
        : { recordKinds: recordKinds.value as readonly ProfileQueryableRecordKind[] }),
      ...(recordIds.value === undefined ? {} : { recordIds: recordIds.value }),
      ...(ownerIds.value === undefined ? {} : { ownerIds: ownerIds.value }),
      ...(parentIds.value === undefined ? {} : { parentIds: parentIds.value }),
      ...(projection === undefined
        ? {}
        : { projection: Object.freeze([...projection].sort(compareStrings)) }),
      limit: limit as number,
      byteLimit: byteLimit as number,
      ...(cursor === undefined ? {} : { cursor }),
    },
  }
}

export type ProfileStatus = {
  profileId: string
  revision: number
  versions: ProfileContractVersions
  state: 'ready' | 'busy' | 'unsupported-future' | 'recovery-required' | 'unrecoverable'
  owner: {
    mode: 'mutable' | 'read-only' | 'none'
    route: 'active-owner' | 'exclusive-headless-owner' | 'none'
  }
  dirty: 'clean' | 'pending' | 'committing' | 'uncertain'
  compatibility: ProfileCompatibility
}

export type ProfileOwnershipRequest = {
  ownerId: string
  mode: 'mutable' | 'read-only'
  route: 'active-owner' | 'exclusive-headless-owner'
}

export type ProfileOwnershipReceipt = {
  ownerId: string
  mode: ProfileOwnershipRequest['mode']
  route: ProfileOwnershipRequest['route']
  revision: number
  disposition: 'acquired' | 'already-owned'
}

export type ProfileCapabilities = {
  adapter: ProfileAdapterKind
  versions: typeof PROFILE_GATEWAY_VERSIONS
  queries: readonly ProfileInspectionQueryName[]
  commands: readonly PublicGatewayCommandName[]
  commandBatch?: ProfileAgentCommandBatchCapability
  queryLimits: typeof PROFILE_QUERY_LIMITS
}

export type ProfileFlushRequest = {
  expectedRevision: number
}

export type ProfileFlushReceipt = {
  revision: number
  durable: true
  dirty: false
}

export type ProfileRecoveryRequest =
  | { mode: 'inspect' }
  | { mode: 'restore'; candidateId: string; expectedRevision: number }

export type ProfileRecoveryReceipt = {
  mode: ProfileRecoveryRequest['mode']
  selectedCandidateId?: string
  rejectedCandidateIds: string[]
  quarantinedCurrentState: boolean
  previousRevision?: number
  revision?: number
}

export const PORTABLE_EXPORT_EXCLUDED_STATE = [
  'wal',
  'locks',
  'caches',
  'credentials',
  'device-settings',
  'derived-indexes',
] as const

export const PROFILE_PORTABLE_LIFECYCLE_VERSION = 1 as const

/**
 * Native adapters brand these values with operation-bound capabilities. The
 * logical service contract deliberately knows neither a path nor a byte API.
 */
export type ProfilePortableExportRequest<Destination> = Readonly<{
  version: typeof PROFILE_PORTABLE_LIFECYCLE_VERSION
  operationId: string
  expectedRevision: number
  destination: Destination
}>

export type ProfilePortableExportReceipt = Readonly<{
  operationId: string
  profileId: string
  revision: number
  integrityRoot: string
  entryCount: number
  verified: true
}>

export type ProfilePortableFreshImportRequest<Source> = Readonly<{
  version: typeof PROFILE_PORTABLE_LIFECYCLE_VERSION
  operationId: string
  idempotencyKey: string
  source: Source
}>

export type ProfilePortableFreshImportReceipt = Readonly<{
  operationId: string
  profileId: string
  revision: number
  importedRecordIds: readonly string[]
  importedAssetIds: readonly string[]
  verified: true
  replayed: boolean
}>

export type ProfileDuplicateIdeaRequest = Readonly<{
  version: typeof PROFILE_PORTABLE_LIFECYCLE_VERSION
  operationId: string
  idempotencyKey: string
  expectedRevision: number
  sourceIdeaId: string
  name?: string
}>

export type ProfileImportIdeaClosureRequest<Source> = Readonly<{
  version: typeof PROFILE_PORTABLE_LIFECYCLE_VERSION
  operationId: string
  idempotencyKey: string
  expectedRevision: number
  source: Source
  name?: string
}>

export type ProfileIdeaLifecycleReceipt = Readonly<{
  kind: 'duplicate-idea' | 'import-idea'
  operationId: string
  previousRevision: number
  revision: number
  targetIdeaId: string
  insertedRecordIds: readonly string[]
  importedAssetIds: readonly string[]
  replayed: boolean
}>

export interface ProfilePortableLifecycleService<Source, Destination> {
  exportPortable(
    request: ProfilePortableExportRequest<Destination>,
  ): Promise<ProfileServiceResult<ProfilePortableExportReceipt>>
  importPortableIntoFreshProfile(
    request: ProfilePortableFreshImportRequest<Source>,
  ): Promise<ProfileServiceResult<ProfilePortableFreshImportReceipt>>
  duplicateIdea(
    request: ProfileDuplicateIdeaRequest,
  ): Promise<ProfileServiceResult<ProfileIdeaLifecycleReceipt>>
  importIdeaClosure(
    request: ProfileImportIdeaClosureRequest<Source>,
  ): Promise<ProfileServiceResult<ProfileIdeaLifecycleReceipt>>
}

export interface LocalProfileService<Source = unknown, Destination = unknown>
  extends ProfileSnapshotReader, ProfileCommandBatchWriter {
  status(): Promise<ProfileServiceResult<ProfileStatus>>
  capabilities(): Promise<ProfileServiceResult<ProfileCapabilities>>
  query(request: ProfileQueryRequest): Promise<ProfileServiceResult<ProfileQueryPage>>
  flush(request: ProfileFlushRequest): Promise<ProfileServiceResult<ProfileFlushReceipt>>
  recover(request: ProfileRecoveryRequest): Promise<ProfileServiceResult<ProfileRecoveryReceipt>>
  exportPortable(
    request: ProfilePortableExportRequest<Destination>,
  ): Promise<ProfileServiceResult<ProfilePortableExportReceipt>>
  importPortableIntoFreshProfile(
    request: ProfilePortableFreshImportRequest<Source>,
  ): Promise<ProfileServiceResult<ProfilePortableFreshImportReceipt>>
}

export const PUBLIC_GATEWAY_COMMAND_NAMES = [
  'idea.create',
  'card.create',
  'card.update-content',
  'card.delete',
  'connection.create',
  'connection.update-meaning',
  'connection.delete',
  'mod-template.create',
  'mod-template.update',
  'mod-template.delete',
  'mod-instance.stamp',
  'mod-instance.create',
  'ask.set-model',
  'card.set-identity',
  'cards.arrange',
  'cards.reorder-layer',
  'group.membership.set',
  'output.choose-version',
  'output.set-accepted',
  'mod-instance.configure',
  'mod-instance.delete',
  'idea.activate',
] as const

export type PublicGatewayCommandName = (typeof PUBLIC_GATEWAY_COMMAND_NAMES)[number]
export const INTERNAL_PROFILE_ASSET_COMMAND_NAMES = [
  'card.asset.add',
  'card.asset.remove',
] as const
export type InternalProfileAssetCommandName = (typeof INTERNAL_PROFILE_ASSET_COMMAND_NAMES)[number]
export type ProfileCommandName = PublicGatewayCommandName | InternalProfileAssetCommandName
export const PUBLIC_GATEWAY_QUERY_NAMES = [
  'profile.status',
  'profile.capabilities',
  'idea.list',
  'board.snapshot',
  'graph.query',
  'record.get',
  'mod-template.list',
  'export.plan',
] as const

export type PublicGatewayQueryName = (typeof PUBLIC_GATEWAY_QUERY_NAMES)[number]
export const PROFILE_INSPECTION_QUERY_NAMES = [
  'profile.status',
  'profile.capabilities',
  'idea.list',
  'graph.query',
  'record.get',
  'mod-template.list',
] as const satisfies readonly PublicGatewayQueryName[]
export type ProfileInspectionQueryName = (typeof PROFILE_INSPECTION_QUERY_NAMES)[number]
export type ProfileJsonValue = null | boolean | number | string | ProfileJsonValue[] | { [key: string]: ProfileJsonValue }

export type ProfileDomainCommand = {
  version: typeof PROFILE_CONTRACT_VERSIONS.command
  id: string
  name: ProfileCommandName
  payload: Record<string, ProfileJsonValue>
}

export type ProfileCommandBatch = {
  version: typeof PROFILE_CONTRACT_VERSIONS.command
  schemaVersion: typeof PROFILE_CONTRACT_VERSIONS.schema
  expectedRevision: number
  actor: {
    id: string
    kind: 'user' | 'agent' | 'system'
    transport: 'renderer' | 'cli' | 'mcp' | 'test'
  }
  clientTxnId: string
  idempotencyKey: string
  dryRun: boolean
  commands: ProfileDomainCommand[]
}

export type ProfileCommandBatchReceipt = {
  previousRevision: number
  revision: number
  commitId: string
  commandIds: string[]
  affectedIds: string[]
  intentEvents: IntentLogEvent[]
  dryRun: boolean
  replayed: boolean
}

export type ProfileCommandBatchWriter = {
  applyCommandBatch(batch: ProfileCommandBatch): Promise<ProfileServiceResult<ProfileCommandBatchReceipt>>
}

export type PublicGatewayDomainContract =
  | 'idea.lifecycle'
  | 'card.lifecycle'
  | 'card.content'
  | 'connection.lifecycle'
  | 'profile.mod-template'

export type GatewayDomainExpectation = {
  name: PublicGatewayCommandName
  version: typeof PROFILE_CONTRACT_VERSIONS.command
  scope: 'idea' | 'profile'
  dryRun: true
  expectedRevision: 'required'
  idempotency: 'required'
  atomicBatch: true
  domainContract: PublicGatewayDomainContract
  domainContractVersion: 1
  affectedRecords: readonly string[]
  semanticAttribution:
    | 'board-intent-log'
    | 'profile-revision'
    | 'profile-revision-and-board-intent-log'
}

export const PUBLIC_GATEWAY_COMMAND_REGISTRY: Record<PublicGatewayCommandName, GatewayDomainExpectation> = {
  'idea.create': gatewayExpectation(
    'idea.create',
    'profile',
    'idea.lifecycle',
    ['idea', 'board'],
    'profile-revision',
  ),
  'card.create': gatewayExpectation('card.create', 'idea', 'card.lifecycle', ['card'], 'board-intent-log'),
  'card.update-content': gatewayExpectation(
    'card.update-content',
    'idea',
    'card.content',
    ['card', 'block'],
    'board-intent-log',
  ),
  'card.delete': gatewayExpectation(
    'card.delete',
    'idea',
    'card.lifecycle',
    ['card', 'connection', 'output'],
    'board-intent-log',
  ),
  'connection.create': gatewayExpectation(
    'connection.create',
    'idea',
    'connection.lifecycle',
    ['connection'],
    'board-intent-log',
  ),
  'connection.update-meaning': gatewayExpectation(
    'connection.update-meaning',
    'idea',
    'connection.lifecycle',
    ['connection'],
    'board-intent-log',
  ),
  'connection.delete': gatewayExpectation(
    'connection.delete',
    'idea',
    'connection.lifecycle',
    ['connection'],
    'board-intent-log',
  ),
  'mod-template.create': gatewayExpectation(
    'mod-template.create',
    'profile',
    'profile.mod-template',
    ['mod-template'],
    'profile-revision',
  ),
  'mod-template.update': gatewayExpectation(
    'mod-template.update',
    'profile',
    'profile.mod-template',
    ['mod-template'],
    'profile-revision',
  ),
  'mod-template.delete': gatewayExpectation(
    'mod-template.delete',
    'profile',
    'profile.mod-template',
    ['mod-template'],
    'profile-revision',
  ),
  'mod-instance.stamp': gatewayExpectation(
    'mod-instance.stamp',
    'idea',
    'card.lifecycle',
    ['card', 'block', 'mod-instance'],
    'profile-revision-and-board-intent-log',
  ),
  'mod-instance.create': gatewayExpectation(
    'mod-instance.create', 'idea', 'card.lifecycle', ['card', 'block', 'mod-instance'],
    'profile-revision-and-board-intent-log',
  ),
  'ask.set-model': gatewayExpectation(
    'ask.set-model', 'idea', 'card.content', ['card'],
    'profile-revision-and-board-intent-log',
  ),
  'card.set-identity': gatewayExpectation(
    'card.set-identity', 'idea', 'card.content', ['card', 'mod-instance'],
    'profile-revision-and-board-intent-log',
  ),
  'cards.arrange': gatewayExpectation(
    'cards.arrange', 'idea', 'card.lifecycle', ['card'],
    'profile-revision-and-board-intent-log',
  ),
  'cards.reorder-layer': gatewayExpectation(
    'cards.reorder-layer', 'idea', 'card.lifecycle', ['card'],
    'profile-revision-and-board-intent-log',
  ),
  'group.membership.set': gatewayExpectation(
    'group.membership.set', 'idea', 'card.lifecycle', ['card'],
    'profile-revision-and-board-intent-log',
  ),
  'output.choose-version': gatewayExpectation(
    'output.choose-version', 'idea', 'card.content', ['output'],
    'profile-revision-and-board-intent-log',
  ),
  'output.set-accepted': gatewayExpectation(
    'output.set-accepted', 'idea', 'card.content', ['output-version'],
    'profile-revision-and-board-intent-log',
  ),
  'mod-instance.configure': gatewayExpectation(
    'mod-instance.configure', 'idea', 'card.content', ['card', 'mod-instance'],
    'profile-revision-and-board-intent-log',
  ),
  'mod-instance.delete': gatewayExpectation(
    'mod-instance.delete', 'idea', 'card.lifecycle', ['card', 'block', 'connection', 'mod-instance'],
    'profile-revision-and-board-intent-log',
  ),
  'idea.activate': gatewayExpectation(
    'idea.activate', 'profile', 'idea.lifecycle', ['idea'], 'profile-revision',
  ),
}

export type GatewayQueryContract = {
  name: PublicGatewayQueryName
  version: typeof PROFILE_CONTRACT_VERSIONS.command
  scope: 'profile' | 'idea'
  serviceOperation: ProfileServiceOperation
  mutating: false
  bounded: true
  consistentSnapshot: true
}

export const PUBLIC_GATEWAY_QUERY_REGISTRY: Record<PublicGatewayQueryName, GatewayQueryContract> = {
  'profile.status': gatewayQuery('profile.status', 'profile', 'status'),
  'profile.capabilities': gatewayQuery('profile.capabilities', 'profile', 'capabilities'),
  'idea.list': gatewayQuery('idea.list', 'profile', 'query'),
  'board.snapshot': gatewayQuery('board.snapshot', 'idea', 'snapshot'),
  'graph.query': gatewayQuery('graph.query', 'idea', 'query'),
  'record.get': gatewayQuery('record.get', 'idea', 'query'),
  'mod-template.list': gatewayQuery('mod-template.list', 'profile', 'query'),
  'export.plan': gatewayQuery('export.plan', 'profile', 'portable-export'),
}

export function createProfileCapabilities(adapter: ProfileAdapterKind): ProfileCapabilities {
  return Object.freeze({
    adapter,
    versions: Object.freeze({ ...PROFILE_GATEWAY_VERSIONS }),
    queries: Object.freeze([...PROFILE_INSPECTION_QUERY_NAMES]),
    commands: Object.freeze([]),
    queryLimits: Object.freeze({ ...PROFILE_QUERY_LIMITS }),
  })
}

export const FORBIDDEN_GATEWAY_OPERATIONS = [
  'raw-storage',
  'generic-patch',
  'raw-sql',
  'filesystem.read',
  'filesystem.write',
  'electron.raw-ipc',
  'credentials.read',
  'network.listen',
] as const

export type GatewayAdmission =
  | { kind: 'command'; operation: PublicGatewayCommandName; contract: GatewayDomainExpectation }
  | { kind: 'query'; operation: PublicGatewayQueryName; contract: GatewayQueryContract }

export function admitGatewayOperation(operation: string): ProfileServiceResult<GatewayAdmission> {
  if (Object.prototype.hasOwnProperty.call(PUBLIC_GATEWAY_COMMAND_REGISTRY, operation)) {
    const name = operation as PublicGatewayCommandName
    return { ok: true, value: { kind: 'command', operation: name, contract: PUBLIC_GATEWAY_COMMAND_REGISTRY[name] } }
  }
  if (Object.prototype.hasOwnProperty.call(PUBLIC_GATEWAY_QUERY_REGISTRY, operation)) {
    const name = operation as PublicGatewayQueryName
    return { ok: true, value: { kind: 'query', operation: name, contract: PUBLIC_GATEWAY_QUERY_REGISTRY[name] } }
  }
  return profileServiceFailure('capability-denied')
}

export function validateProfileCommandBatch(candidate: unknown): ProfileServiceResult<ProfileCommandBatch> {
  return validateCommandBatch(candidate, (name) => {
    const admission = admitGatewayOperation(name)
    return admission.ok && admission.value.kind === 'command'
  })
}

export function validateInternalProfileAssetCommandBatch(
  candidate: unknown,
): ProfileServiceResult<ProfileCommandBatch> {
  return validateCommandBatch(
    candidate,
    (name) => INTERNAL_PROFILE_ASSET_COMMAND_NAMES.includes(name as InternalProfileAssetCommandName),
  )
}

function validateCommandBatch(
  candidate: unknown,
  commandIsAllowed: (name: string) => boolean,
): ProfileServiceResult<ProfileCommandBatch> {
  if (!isRecord(candidate)) return profileServiceFailure('invalid')
  if (!isPositiveInteger(candidate.version) || !isPositiveInteger(candidate.schemaVersion)) {
    return profileServiceFailure('invalid')
  }
  if (
    candidate.version > PROFILE_CONTRACT_VERSIONS.command
    || candidate.schemaVersion > PROFILE_CONTRACT_VERSIONS.schema
  ) {
    return profileServiceFailure('unsupported-future-version', {
      supportedVersions: PROFILE_CONTRACT_VERSIONS,
    })
  }
  if (
    candidate.version !== PROFILE_CONTRACT_VERSIONS.command
    || candidate.schemaVersion !== PROFILE_CONTRACT_VERSIONS.schema
    || !isNonNegativeInteger(candidate.expectedRevision)
    || !isRecord(candidate.actor)
    || !isNonEmptyString(candidate.actor.id)
    || !['user', 'agent', 'system'].includes(String(candidate.actor.kind))
    || !['renderer', 'cli', 'mcp', 'test'].includes(String(candidate.actor.transport))
    || !isNonEmptyString(candidate.clientTxnId)
    || !isNonEmptyString(candidate.idempotencyKey)
    || typeof candidate.dryRun !== 'boolean'
    || !Array.isArray(candidate.commands)
    || candidate.commands.length === 0
  ) {
    return profileServiceFailure('invalid')
  }

  const commandIds = new Set<string>()
  for (const command of candidate.commands) {
    if (!isRecord(command) || !isPositiveInteger(command.version)) return profileServiceFailure('invalid')
    if (command.version > PROFILE_CONTRACT_VERSIONS.command) {
      return profileServiceFailure('unsupported-future-version', {
        supportedVersions: PROFILE_CONTRACT_VERSIONS,
      })
    }
    if (
      command.version !== PROFILE_CONTRACT_VERSIONS.command
      || !isNonEmptyString(command.id)
      || commandIds.has(command.id)
      || !isNonEmptyString(command.name)
      || !isRecord(command.payload)
      || !isProfileJsonValue(command.payload)
    ) {
      return profileServiceFailure('invalid')
    }
    commandIds.add(command.id)
    if (!commandIsAllowed(command.name)) return profileServiceFailure('capability-denied')
  }

  return { ok: true, value: cloneAndFreezeProfileCommandBatch(candidate) }
}

export type ProfileCompatibilityInspection = {
  compatibility: ProfileCompatibility
  versions: ProfileContractVersions
}

export function inspectProfileContractVersions(candidate: unknown): ProfileServiceResult<ProfileContractVersions> {
  if (!isRecord(candidate)) return profileServiceFailure('invalid')
  for (const dimension of PROFILE_CONTRACT_VERSION_DIMENSIONS) {
    const receivedVersion = candidate[dimension]
    if (!isPositiveInteger(receivedVersion)) return profileServiceFailure('invalid')
    if (receivedVersion > PROFILE_CONTRACT_VERSIONS[dimension]) {
      return profileServiceFailure('unsupported-future-version', {
        supportedVersions: PROFILE_CONTRACT_VERSIONS,
      })
    }
    if (dimension === 'record' && receivedVersion !== PROFILE_CONTRACT_VERSIONS.record) {
      return profileServiceFailure('invalid')
    }
  }
  return { ok: true, value: PROFILE_CONTRACT_VERSIONS }
}

export function inspectProfileCompatibility(candidate: unknown): ProfileServiceResult<ProfileCompatibilityInspection> {
  if (!isRecord(candidate) || candidate.format !== 'eido-profile' || !isPositiveInteger(candidate.schemaVersion)) {
    return profileServiceFailure('invalid')
  }
  if (candidate.schemaVersion > PROFILE_CONTRACT_VERSIONS.schema) {
    return profileServiceFailure('unsupported-future-version', {
      supportedVersions: PROFILE_CONTRACT_VERSIONS,
    })
  }
  const versionInspection = inspectProfileContractVersions(candidate.versions)
  if (!versionInspection.ok) return versionInspection
  return {
    ok: true,
    value: {
      compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
      versions: versionInspection.value,
    },
  }
}

export function validateProfileAdapterDescriptor(descriptor: unknown): string[] {
  if (!isRecord(descriptor)) return ['invalid-descriptor']

  const issues: string[] = []
  const descriptorFields = new Set(['kind', 'versions', 'operations'])
  for (const field of Object.keys(descriptor)) {
    if (!descriptorFields.has(field)) issues.push(`unknown-descriptor-field:${field}`)
  }
  if (!PROFILE_ADAPTER_KINDS.includes(descriptor.kind as ProfileAdapterKind)) {
    issues.push('unsupported-adapter-kind')
  }

  if (!isRecord(descriptor.versions)) {
    issues.push('invalid-versions')
  } else {
    for (const [name, expectedVersion] of Object.entries(PROFILE_CONTRACT_VERSIONS)) {
      if (descriptor.versions[name] !== expectedVersion) {
        issues.push(`unsupported-${name}-version`)
      }
    }
    for (const name of Object.keys(descriptor.versions)) {
      if (!PROFILE_CONTRACT_VERSION_DIMENSIONS.includes(name as keyof ProfileContractVersions)) {
        issues.push(`unknown-version-dimension:${name}`)
      }
    }
  }

  if (!isRecord(descriptor.operations)) {
    issues.push('invalid-operations')
  } else {
    for (const operation of PROFILE_SERVICE_OPERATIONS) {
      if (descriptor.operations[operation] !== 'available' && descriptor.operations[operation] !== 'unavailable') {
        issues.push(`undeclared-${operation}`)
      }
    }
    for (const operation of Object.keys(descriptor.operations)) {
      if (!PROFILE_SERVICE_OPERATIONS.includes(operation as ProfileServiceOperation)) {
        issues.push(`unknown-operation:${operation}`)
      }
    }
  }
  return issues
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function normalizeStringFilter(
  value: unknown,
): ProfileServiceResult<readonly string[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > PROFILE_QUERY_LIMITS.maxFilterValues
    || value.some((entry) => (
      !isNonEmptyString(entry)
      || utf8ByteLength(entry) > PROFILE_QUERY_LIMITS.maxFilterValueBytes
    ))
    || new Set(value).size !== value.length
  ) return profileServiceFailure('invalid')
  return { ok: true, value: Object.freeze([...value].sort(compareStrings)) }
}

function normalizeParentFilter(
  value: unknown,
): ProfileServiceResult<readonly (string | null)[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > PROFILE_QUERY_LIMITS.maxFilterValues
    || value.some((entry) => (
      entry !== null
      && (
        !isNonEmptyString(entry)
        || utf8ByteLength(entry) > PROFILE_QUERY_LIMITS.maxFilterValueBytes
      )
    ))
    || new Set(value).size !== value.length
  ) return profileServiceFailure('invalid')
  return {
    ok: true,
    value: Object.freeze([...value].sort((left, right) => {
      if (left === right) return 0
      if (left === null) return -1
      if (right === null) return 1
      return compareStrings(left, right)
    })),
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isProfileJsonValue(value: unknown): value is ProfileJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isProfileJsonValue)
  return isRecord(value) && Object.values(value).every(isProfileJsonValue)
}

function cloneAndFreezeProfileCommandBatch(candidate: Record<string, unknown>): ProfileCommandBatch {
  const actor = candidate.actor as Record<string, unknown>
  const commands = (candidate.commands as Record<string, unknown>[]).map((command) => Object.freeze({
    version: command.version as ProfileDomainCommand['version'],
    id: command.id as string,
    name: command.name as ProfileCommandName,
    payload: cloneAndFreezeProfileJsonValue(command.payload) as Record<string, ProfileJsonValue>,
  }))
  Object.freeze(commands)

  const batch: ProfileCommandBatch = {
    version: candidate.version as ProfileCommandBatch['version'],
    schemaVersion: candidate.schemaVersion as ProfileCommandBatch['schemaVersion'],
    expectedRevision: candidate.expectedRevision as number,
    actor: Object.freeze({
      id: actor.id as string,
      kind: actor.kind as ProfileCommandBatch['actor']['kind'],
      transport: actor.transport as ProfileCommandBatch['actor']['transport'],
    }),
    clientTxnId: candidate.clientTxnId as string,
    idempotencyKey: candidate.idempotencyKey as string,
    dryRun: candidate.dryRun as boolean,
    commands,
  }
  return Object.freeze(batch)
}

function cloneAndFreezeProfileJsonValue(value: unknown): ProfileJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    const clone = value.map(cloneAndFreezeProfileJsonValue)
    Object.freeze(clone)
    return clone
  }
  const clone = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      cloneAndFreezeProfileJsonValue(entry),
    ] as const),
  ) as Record<string, ProfileJsonValue>
  return Object.freeze(clone)
}

function gatewayExpectation(
  name: PublicGatewayCommandName,
  scope: GatewayDomainExpectation['scope'],
  domainContract: PublicGatewayDomainContract,
  affectedRecords: readonly string[],
  semanticAttribution: GatewayDomainExpectation['semanticAttribution'],
): GatewayDomainExpectation {
  return {
    name,
    version: PROFILE_CONTRACT_VERSIONS.command,
    scope,
    dryRun: true,
    expectedRevision: 'required',
    idempotency: 'required',
    atomicBatch: true,
    domainContract,
    domainContractVersion: 1,
    affectedRecords,
    semanticAttribution,
  }
}

function logicalRecord(
  kind: ProfileLogicalRecordKind,
  owner: ProfileLogicalRecordContract['owner'],
  identity: ProfileLogicalRecordContract['identity'],
  retention: ProfileLogicalRecordContract['retention'],
): ProfileLogicalRecordContract {
  return { kind, owner, identity, version: PROFILE_CONTRACT_VERSIONS.record, retention }
}

function adapterDescriptor(
  kind: ProfileAdapterKind,
  unavailable: readonly ProfileServiceOperation[] = [],
): ProfileAdapterDescriptor {
  const unavailableSet = new Set(unavailable)
  return {
    kind,
    versions: PROFILE_CONTRACT_VERSIONS,
    operations: Object.fromEntries(
      PROFILE_SERVICE_OPERATIONS.map((operation) => [
        operation,
        unavailableSet.has(operation) ? 'unavailable' : 'available',
      ] as const),
    ) as ProfileAdapterDescriptor['operations'],
  }
}

function gatewayQuery(
  name: PublicGatewayQueryName,
  scope: GatewayQueryContract['scope'],
  serviceOperation: ProfileServiceOperation,
): GatewayQueryContract {
  return {
    name,
    version: PROFILE_CONTRACT_VERSIONS.command,
    scope,
    serviceOperation,
    mutating: false,
    bounded: true,
    consistentSnapshot: true,
  }
}

function operationContract(
  mutating: boolean,
  revision: ProfileOperationRevisionSemantics,
  additions: Omit<Partial<ProfileServiceOperationContract>, 'mutating' | 'physicalAuthority' | 'revision'> = {},
): ProfileServiceOperationContract {
  return { mutating, physicalAuthority: 'hidden', revision, ...additions }
}
