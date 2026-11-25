import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  unlinkSync,
} from 'node:fs'
import path from 'node:path'
import { isCardAuthorship } from '../src/graph/cardAuthorship'
import type { AgentRunAttribution, CardAuthorship, IntentLogEvent } from '../src/graph/types'
import {
  queryProfileAgentChangeTrail,
  type ProfileAgentChangeTrailPage,
  type ProfileAgentChangeTrailRecord,
  type ProfileAgentChangeTrailRequest,
} from '../src/persistence/profileAgentChangeTrail'
import {
  isProfileAgentCommandBatchReceiptForSurface,
  PROFILE_AGENT_COMMAND_RESULT_LIMITS,
  PROFILE_AGENT_INSTALLED_ACTOR_ID,
  summarizeProfileAgentCommandEffects,
  validateProfileAgentCommandRequestForSurface,
  type ProfileAgentCommandBatchReceipt,
  type ProfileAgentInstalledTransport,
} from '../src/persistence/profileAgentCommandInstallation'
import {
  PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
  PROFILE_AGENT_MOD_COMMAND_NAMES,
  PROFILE_AGENT_RESEARCH_COMMAND_NAMES,
  type ProfileAgentCommandSurfaceVersion,
} from '../src/persistence/profileAgentCommandManifest'
import {
  decodeProfileAgentEventRecord,
  PROFILE_AGENT_EVENT_RECORD_VERSION,
  type ProfileAgentEventPayload,
} from '../src/persistence/profileAgentEvent'
import {
  PROFILE_AGENT_COMMAND_LIMITS,
  planProfileAgentCommandBatch,
  type ProfileAgentCommandPlan,
  type ProfileAgentCommandRequest,
} from '../src/persistence/profileAgentCommandPlan'
import {
  applyProfileRevisionPlan,
  canonicalProfileJson,
  planProfileCommand,
  ProfileRevisionCorruptionError,
  type ProfileRevisionDocument,
  type ProfileRevisionRecord,
} from '../src/persistence/profileRevisionKernel'
import {
  hydrateProfileLogicalAsset,
  readProfileAssetAddReference,
  readProfileAssetRemoveInput,
} from '../src/persistence/profileAssetKernel'
import {
  enumerateProfileAssetDigests,
  enumerateProfileLogicalAssetIds,
  hydrateProfileLogicalDocument,
  ProfileLogicalProjectionError,
  projectProfileSnapshot,
  stampProfileCardAuthorship,
  validateProfileLogicalDocument,
  type ProfileAssetHydrator,
  type ProfileAssetProjector,
  type ProfileLogicalDocument,
  type ProfileLogicalRecordSpec,
} from '../src/persistence/profileLogicalProjection'
import {
  GUI_PROFILE_PROJECTION_VERSION,
  type GuiOrdinaryNewIdeaAuthorization,
  type GuiProfileProjectionRequest,
} from '../src/persistence/profileGuiProjection'
import {
  createProfileCapabilities,
  ProfileUnsupportedFutureVersionError,
  PROFILE_CONTRACT_VERSIONS,
  PROFILE_QUERYABLE_RECORD_KINDS,
  profileServiceFailure,
  validateInternalProfileAssetCommandBatch,
  validateProfileCommandBatch,
  type ProfileCommandBatch,
  type ProfileCommandBatchReceipt,
  type ProfileCapabilities,
  type ProfileQueryPage,
  type ProfileQueryRequest,
  type ProfileServiceResult,
  type ProfileIdeaLifecycleReceipt,
  type ProfileSnapshot,
  type ProfileStatus,
} from '../src/persistence/profileServiceContract'
import { queryProfileLogicalDocument } from '../src/persistence/profileLogicalQuery'
import {
  inspectProfileLogicalResult,
  type NormalizedProfileResultInspectionRequest,
  type ProfileResultInspectionPage,
} from '../src/persistence/profileResultInspection'
import {
  queryProfileAgentCardNeighbors,
  queryProfileAgentCardSetBounds,
  type NormalizedProfileAgentCardNeighborsRequest,
  type ProfileAgentCardNeighbors,
  type ProfileAgentCardSetBounds,
  type ProfileAgentCardSetBoundsRequest,
  type ProfileAgentSpatialResult,
} from '../src/persistence/profileAgentSpatialQuery'
import {
  canonicalProfilePortableDocumentBytes,
  PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS,
} from '../src/persistence/profilePortableArchive'
import {
  assertLiveSqliteProfileOwnershipCapability,
  assertSqliteProfileOwnershipCapability,
  bindSqliteProfileOwnershipCapability,
  SqliteProfileOwnershipCapabilityError,
  type SqliteProfileOwnershipCapability,
} from './sqliteProfileOwnerCapability'
import {
  readSqlitePreparedProfileAssetBatch,
  SqliteProfileBlobCapabilityError,
  SqliteProfileBlobCorruptionError,
  type SqlitePreparedProfileAssetBatch,
} from './sqliteProfileBlobStore'
import {
  openSqliteRuntime,
  type SqliteOutput,
  type SqliteRow,
  type SqliteRuntime,
} from './sqliteRuntime'
import {
  attachAgentClaimedTransitionEvidence,
  auditAgentCommandRevision,
  deriveAgentRecordCommandOwners,
  type DurableRecordTransition,
  type ProfileAgentCommandBinding,
  type ProfileAgentModStampProvenanceV1,
} from './sqliteProfileAgentCommandAudit'

export type SqliteProfileRevisionStore = {
  status(): Promise<ProfileServiceResult<ProfileStatus>>
  capabilities(): Promise<ProfileServiceResult<ProfileCapabilities>>
  query(request: ProfileQueryRequest): Promise<ProfileServiceResult<ProfileQueryPage>>
  inspectResult(
    request: NormalizedProfileResultInspectionRequest,
  ): Promise<ProfileServiceResult<ProfileResultInspectionPage>>
  changes(
    request: ProfileAgentChangeTrailRequest,
  ): Promise<ProfileServiceResult<ProfileAgentChangeTrailPage>>
  agentCardNeighbors(
    request: NormalizedProfileAgentCardNeighborsRequest,
  ): Promise<ProfileServiceResult<ProfileAgentCardNeighbors>>
  agentCardSetBounds(
    request: ProfileAgentCardSetBoundsRequest,
  ): Promise<ProfileServiceResult<ProfileAgentCardSetBounds>>
  snapshot(): Promise<ProfileServiceResult<ProfileSnapshot>>
  applyCommandBatch(candidate: unknown): Promise<ProfileServiceResult<ProfileCommandBatchReceipt>>
  applyAgentCommandBatch(
    request: ProfileAgentCommandRequest,
    transport: ProfileAgentInstalledTransport,
    actor?: Readonly<Pick<CardAuthorship, 'client' | 'sessionId'>>,
  ): Promise<ProfileServiceResult<ProfileAgentCommandBatchReceipt>>
  applyPreparedAssetCommandBatch(
    prepared: SqlitePreparedProfileAssetBatch,
  ): Promise<ProfileServiceResult<ProfileCommandBatchReceipt>>
  readRecord(recordId: string): Promise<ProfileServiceResult<ProfileRevisionRecord | null>>
  logicalDocument(): Promise<ProfileServiceResult<ProfileLogicalDocument>>
  issueGuiOrdinaryIdeaAuthorization(
    authorization: GuiOrdinaryNewIdeaAuthorization,
  ): Promise<ProfileServiceResult<GuiOrdinaryNewIdeaAuthorization>>
  replayGuiProjectionRevision(
    request: unknown,
  ): Promise<ProfileServiceResult<SqliteProfileGuiProjectionCommitReceipt | null>>
  commitGuiProjectionRevision(
    input: SqliteProfileGuiProjectionRevisionInput,
  ): Promise<ProfileServiceResult<SqliteProfileGuiProjectionCommitReceipt>>
  replayIdeaLifecycleRevision(input: Readonly<{
    kind: 'duplicate-idea' | 'import-idea'
    operationId: string
    idempotencyKey: string
    request: unknown
  }>): Promise<ProfileServiceResult<ProfileIdeaLifecycleReceipt | null>>
  commitIdeaLifecycleRevision(
    input: SqliteProfileIdeaLifecycleRevisionInput,
  ): Promise<ProfileServiceResult<ProfileIdeaLifecycleReceipt>>
  referencedAssetDigests(): Promise<ProfileServiceResult<readonly string[]>>
  currentRevision(): number
  currentProfileIdentity(): Readonly<{
    profileId: string
    revision: number
    latestRecovery?: NonNullable<SqliteProfileRevisionInspection['latestRecovery']>
  }>
  createStandaloneBackup(destinationPath: string): Promise<void>
  retryableWork(): ProfileCommandBatch[]
  close(): void
}

export type SqliteProfileGuiProjectionCommitReceipt = Readonly<{
  previousRevision: number
  revision: number
  commitId: string
  generation: number
  clientTxnId: string
  idempotencyKey: string
  deletedRecordIds: readonly string[]
  changedRecordIds: readonly string[]
  appendedIntentEventIds: readonly string[]
  authorizationIds: readonly string[]
  replayed: boolean
}>

export type SqliteProfileGuiProjectionRevisionInput = Readonly<{
  request: GuiProfileProjectionRequest
  candidate: ProfileLogicalDocument
}>

export type SqliteProfileIdeaLifecycleRevisionInput = Readonly<{
  kind: 'duplicate-idea' | 'import-idea'
  operationId: string
  idempotencyKey: string
  expectedRevision: number
  request: unknown
  candidate: unknown
  targetIdeaId: string
  importedAssetIds: readonly string[]
  committedAt: string
}>

export type SqliteProfileRevisionInspection = Readonly<{
  profileId: string
  revision: number
  versions: ProfileSnapshot['versions']
  logicalDigest: string
  blobRoots: readonly Readonly<{ sha256: string; size: number }>[]
  latestRecovery?: Readonly<{
    operationId: string
    candidateId: string
    sourceRevision: number
    observedHighWater: number
  }>
}>

declare const sqliteProfileImportStageBrand: unique symbol
export type SqliteProfileImportStage = Readonly<{
  [sqliteProfileImportStageBrand]: true
}>

type SqliteProfileImportStageState = {
  databasePath: string
  profileId: string
  revision: number
  databaseDigest: string
  databaseSize: number
  blobRoots: readonly Readonly<{ sha256: string; size: number }>[]
  claimed: boolean
}

const sqliteProfileImportStages = new WeakMap<SqliteProfileImportStage, SqliteProfileImportStageState>()

export type SqliteProfileRevisionStoreOptions = {
  databasePath: string
  seed?: ProfileSnapshot
  ownershipCapability: SqliteProfileOwnershipCapability
  materializeAsset?: ProfileAssetProjector
  hydrateAsset?: ProfileAssetHydrator
  openRuntime?: (databasePath: string) => SqliteRuntime
  now?: () => string
  createCommitId?: () => string
  createIntentEventId?: () => string
  /** Internal activation seam. Public owners install only the current manifest-selected surface. */
  agentCommandSurfaceVersion?: ProfileAgentCommandSurfaceVersion
  createProfileAgentEventId?: () => string
  createAgentClientTxnId?: () => string
  agentActor?: Readonly<Pick<CardAuthorship, 'client' | 'sessionId'>>
  testHooks?: {
    beforeCommit?: () => void
  }
}

const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profile_meta (
  profile_id TEXT PRIMARY KEY,
  format TEXT NOT NULL CHECK (format = 'eido-profile'),
  profile_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  record_version INTEGER NOT NULL,
  asset_version INTEGER NOT NULL,
  app_version INTEGER NOT NULL,
  command_version INTEGER NOT NULL,
  export_version INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source = 'friends-alpha'),
  current_revision INTEGER NOT NULL CHECK (current_revision >= 0),
  active_idea_id TEXT NOT NULL,
  seed_profile_agent_event_manifest_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_revisions (
  profile_id TEXT NOT NULL REFERENCES profile_meta(profile_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  previous_revision INTEGER CHECK (previous_revision >= 0),
  commit_id TEXT NOT NULL UNIQUE,
  committed_at TEXT NOT NULL,
  actor_id TEXT,
  actor_kind TEXT,
  actor_transport TEXT,
  client_txn_id TEXT,
  idempotency_key TEXT UNIQUE,
  batch_digest TEXT,
  batch_json TEXT,
  receipt_json TEXT,
  PRIMARY KEY (profile_id, revision)
);

CREATE TABLE IF NOT EXISTS profile_records (
  profile_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'profile', 'compatibility-state', 'idea', 'board', 'card', 'block',
    'logical-asset', 'mod-instance', 'connection', 'output', 'output-version',
    'transcript-message', 'follow-up-message', 'run', 'intent-event', 'board-settings',
    'highlight', 'highlight-tag', 'compaction-summary', 'mod-template',
    'profile-agent-event', 'profile-setting', 'migration-ledger-entry'
  )),
  owner_id TEXT NOT NULL,
  parent_id TEXT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  record_version INTEGER NOT NULL CHECK (record_version = ${PROFILE_CONTRACT_VERSIONS.record}),
  created_revision INTEGER NOT NULL CHECK (created_revision >= 0),
  updated_revision INTEGER NOT NULL CHECK (updated_revision >= created_revision),
  payload_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, record_id),
  FOREIGN KEY (profile_id, created_revision)
    REFERENCES profile_revisions(profile_id, revision),
  FOREIGN KEY (profile_id, updated_revision)
    REFERENCES profile_revisions(profile_id, revision)
);

CREATE INDEX IF NOT EXISTS profile_records_owner_order
  ON profile_records(profile_id, kind, owner_id, ordinal);
CREATE INDEX IF NOT EXISTS profile_records_revision
  ON profile_records(profile_id, updated_revision);

CREATE TABLE IF NOT EXISTS profile_owner_fence (
  profile_id TEXT PRIMARY KEY REFERENCES profile_meta(profile_id) ON DELETE CASCADE,
  owner_token TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  owner_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_recovery_events (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  candidate_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 0),
  observed_high_water INTEGER NOT NULL CHECK (observed_high_water >= source_revision),
  operation_id TEXT NOT NULL UNIQUE,
  recovered_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, revision),
  FOREIGN KEY (profile_id, revision)
    REFERENCES profile_revisions(profile_id, revision)
);

CREATE TABLE IF NOT EXISTS profile_lifecycle_events (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('duplicate-idea', 'import-idea')),
  operation_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  inserted_record_ids_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, revision),
  FOREIGN KEY (profile_id, revision)
    REFERENCES profile_revisions(profile_id, revision)
);

CREATE TABLE IF NOT EXISTS profile_gui_projection_events (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  client_txn_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  changed_record_ids_json TEXT NOT NULL,
  appended_intent_event_ids_json TEXT NOT NULL,
  authorization_ids_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  trusted_actor_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, revision),
  FOREIGN KEY (profile_id, revision)
    REFERENCES profile_revisions(profile_id, revision)
);

CREATE TABLE IF NOT EXISTS profile_gui_projection_record_changes (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  record_id TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('insert', 'update', 'delete')),
  before_digest TEXT,
  after_digest TEXT,
  PRIMARY KEY (profile_id, revision, record_id),
  FOREIGN KEY (profile_id, revision)
    REFERENCES profile_gui_projection_events(profile_id, revision)
);

CREATE TABLE IF NOT EXISTS profile_agent_command_events (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version = 1),
  installed_surface_version INTEGER NOT NULL DEFAULT 1
    CHECK (installed_surface_version IN (1, 2, 3, 4)),
  idempotency_key TEXT NOT NULL UNIQUE,
  client_txn_id TEXT NOT NULL UNIQUE,
  trusted_actor_id TEXT NOT NULL,
  actor_transport TEXT NOT NULL CHECK (actor_transport IN ('cli', 'mcp')),
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  changes_digest TEXT NOT NULL,
  intent_event_ids_json TEXT NOT NULL,
  profile_agent_event_ids_json TEXT NOT NULL DEFAULT '[]',
  command_bindings_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, revision),
  FOREIGN KEY (profile_id, revision)
    REFERENCES profile_revisions(profile_id, revision)
);

CREATE TABLE IF NOT EXISTS profile_agent_command_record_changes (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  record_id TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('insert', 'update', 'delete')),
  before_json TEXT,
  after_json TEXT,
  PRIMARY KEY (profile_id, revision, record_id),
  FOREIGN KEY (profile_id, revision)
    REFERENCES profile_agent_command_events(profile_id, revision),
  CHECK (
    (change_kind = 'insert' AND before_json IS NULL AND after_json IS NOT NULL)
    OR (change_kind = 'update' AND before_json IS NOT NULL AND after_json IS NOT NULL)
    OR (change_kind = 'delete' AND before_json IS NOT NULL AND after_json IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS profile_gui_idea_authorizations (
  authorization_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  idea_id TEXT NOT NULL UNIQUE,
  board_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_revision INTEGER,
  consumed_idempotency_key TEXT,
  CHECK (
    (consumed_revision IS NULL AND consumed_idempotency_key IS NULL)
    OR (consumed_revision IS NOT NULL AND consumed_idempotency_key IS NOT NULL)
  ),
  FOREIGN KEY (profile_id, base_revision)
    REFERENCES profile_revisions(profile_id, revision),
  FOREIGN KEY (profile_id, consumed_revision)
    REFERENCES profile_revisions(profile_id, revision)
);
`

export function createSqliteProfileRevisionStore(
  options: SqliteProfileRevisionStoreOptions,
): SqliteProfileRevisionStore {
  if (options.agentCommandSurfaceVersion !== undefined
    && options.agentCommandSurfaceVersion !== 1
    && options.agentCommandSurfaceVersion !== 2
    && options.agentCommandSurfaceVersion !== 3
    && options.agentCommandSurfaceVersion !== 4
    && options.agentCommandSurfaceVersion !== 5) {
    throw new Error('SQLite Profile Agent command surface version is unsupported')
  }
  assertLiveSqliteProfileOwnershipCapability(
    options.ownershipCapability,
    options.databasePath,
  )
  const runtime = (options.openRuntime ?? openSqliteRuntime)(options.databasePath)
  const now = options.now ?? (() => new Date().toISOString())
  const createCommitId = options.createCommitId ?? (() => `commit-${randomUUID()}`)
  const createIntentEventId = options.createIntentEventId ?? (() => `event-${randomUUID()}`)
  const createProfileAgentEventId = options.createProfileAgentEventId
    ?? (() => `profile-agent-event-${randomUUID()}`)
  const agentCommandSurfaceVersion = options.agentCommandSurfaceVersion ?? 1
  const createAgentClientTxnId = options.createAgentClientTxnId ?? (() => `agent-txn-${randomUUID()}`)
  const fallbackAgentSessionId = `agent-session-${randomUUID()}`
  if (options.agentActor !== undefined
    && !isCardAuthorship({ kind: 'agent', ...options.agentActor })) {
    throw new Error('SQLite Profile Agent actor identity is invalid')
  }
  const pending = new Map<string, ProfileCommandBatch>()
  let uncertain = false
  let closed = false
  // A new owner must re-derive the Profile it inherited rather than trust what
  // a previous store in this process concluded about the file.
  lastValidatedLogicalDocument = undefined

  try {
    runtime.transaction('read', (connection) => {
      preflightExistingProfileVersionAxes(connection, options.seed !== undefined)
    })
    runtime.transaction('write', (connection) => {
      connection.exec(CREATE_SCHEMA_SQL)
      ensureProfileAgentEventSeedAnchorSchema(connection)
      ensureProfileAgentEventRecordKindSchema(connection)
      ensureGuiRecordChangeDigestSchema(connection)
      ensureAgentHistoryV2Schema(connection)
      const count = readInteger(
        connection.prepare('SELECT COUNT(*) AS count FROM profile_meta').get(),
        'count',
      )
      if (count > 1) throw new Error('SQLite Profile database contains more than one authority head')
      if (count === 0) {
        if (!options.seed) throw new Error('SQLite Profile database is empty and requires an explicit seed')
        const projected = projectProfileSnapshot(
          options.seed,
          options.materializeAsset ?? unavailableAssetProjector,
        )
        seedProfile(connection, toRevisionDocument(projected), now())
      }
      bindSqliteProfileOwnershipCapability(
        options.ownershipCapability,
        connection,
        options.databasePath,
      )
    })
  } catch (error) {
    runtime.close()
    throw error
  }

  const assertUsable = () => {
    if (closed) throw new Error('SQLite Profile revision store is closed')
    if (uncertain) throw new Error('SQLite Profile revision store has uncertain transaction state')
  }

  const applyValidatedBatch = async (
    batch: ProfileCommandBatch,
  ): Promise<ProfileServiceResult<ProfileCommandBatchReceipt>> => {
    assertUsable()
    const batchJson = canonicalProfileJson(batch)
    const batchDigest = createHash('sha256').update(batchJson).digest('hex')
    let currentRevision: number | undefined
    try {
      const result = runtime.transaction('write', (connection) => {
        assertSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          connection,
          options.databasePath,
        )
        const document = readDocument(connection)
        hydrateRevisionDocument(document, options.hydrateAsset)
        validateRevisionHistory(connection, document)
        currentRevision = document.head.revision
        if (readLifecycleRevisionByIdempotency(connection, batch.idempotencyKey)
          || readGuiProjectionRevisionByIdempotency(connection, batch.idempotencyKey)
          || readAgentRevisionByIdempotency(connection, batch.idempotencyKey)) {
          return profileServiceFailure('invalid', { currentRevision })
        }
        const replay = readIdempotentRevision(connection, batch.idempotencyKey)
        if (replay) {
          if (replay.batchDigest !== batchDigest || replay.batchJson !== batchJson) {
            return profileServiceFailure('invalid', { currentRevision })
          }
          const receipt = parseReceipt(replay.receiptJson, replay.identity, batch, document)
          pending.delete(batch.idempotencyKey)
          return {
            ok: true,
            value: { ...receipt, replayed: true },
          } satisfies ProfileServiceResult<ProfileCommandBatchReceipt>
        }

        const planned = planProfileCommand(document, batch, {
          committedAt: now(),
          commitId: createCommitId(),
          intentEventId: createIntentEventId(),
        })
        if (!planned.ok) return planned
        if (planned.value.receipt.dryRun) {
          return {
            ok: true,
            value: planned.value.receipt,
          } satisfies ProfileServiceResult<ProfileCommandBatchReceipt>
        }
        const committedDocument = applyProfileRevisionPlan(document, planned.value)
        hydrateRevisionDocument(committedDocument, options.hydrateAsset)
        insertRevision(connection, batch, batchDigest, batchJson, planned.value.receipt)
        writePlanRecords(connection, document.head.profileId, planned.value)
        updateHead(connection, committedDocument, planned.value.receipt)
        options.testHooks?.beforeCommit?.()
        return { ok: true, value: planned.value.receipt } satisfies ProfileServiceResult<ProfileCommandBatchReceipt>
      })
      if (result.ok && !result.value.dryRun) pending.delete(batch.idempotencyKey)
      return result
    } catch (error) {
      pending.set(batch.idempotencyKey, batch)
      if (error instanceof AggregateError) {
        uncertain = true
        try {
          runtime.close()
        } catch {
          // The original AggregateError already records the uncertain cleanup boundary.
        }
      }
      return profileServiceFailure(
        error instanceof ProfileUnsupportedFutureVersionError
          ? 'unsupported-future-version'
          : error instanceof SqliteProfileBlobCorruptionError
          || error instanceof ProfileRevisionCorruptionError
          ? 'corrupt-or-recovery-required'
          : isBusyError(error)
            || error instanceof SqliteProfileOwnershipCapabilityError
            ? 'busy'
            : 'internal',
        {
          ...(currentRevision === undefined ? {} : { currentRevision }),
          ...(error instanceof ProfileUnsupportedFutureVersionError
            ? { supportedVersions: error.supportedVersions }
            : {}),
        },
      )
    }
  }

  const applyAgentCommandBatch: SqliteProfileRevisionStore['applyAgentCommandBatch'] = async (
    candidate,
    transport,
    trustedActor,
  ) => {
    const supersetValidation = validateProfileAgentCommandRequestForSurface(
      candidate,
      PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
    )
    if (!supersetValidation.ok) return supersetValidation
    if (transport !== 'cli' && transport !== 'mcp') return profileServiceFailure('capability-denied')
    if (trustedActor !== undefined
      && !isCardAuthorship({ kind: 'agent', ...trustedActor })) {
      return profileServiceFailure('invalid')
    }
    const candidateRequest = supersetValidation.value
    let currentRevision: number | undefined
    try {
      assertUsable()
      assertLiveSqliteProfileOwnershipCapability(
        options.ownershipCapability,
        options.databasePath,
      )
      return runtime.transaction(candidateRequest.dryRun ? 'read' : 'write', (connection) => {
        assertSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          connection,
          options.databasePath,
        )
        const current = readDocument(connection)
        hydrateRevisionDocument(current, options.hydrateAsset)
        validateRevisionHistory(connection, current)
        currentRevision = current.head.revision

        if (readIdempotentRevision(connection, candidateRequest.idempotencyKey)
          || readLifecycleRevisionByIdempotency(connection, candidateRequest.idempotencyKey)
          || readGuiProjectionRevisionByIdempotency(connection, candidateRequest.idempotencyKey)) {
          return profileServiceFailure('invalid', { currentRevision })
        }
        const replayRow = readAgentRevisionByIdempotency(
          connection,
          candidateRequest.idempotencyKey,
        )
        if (replayRow) {
          const replayValidation = validateProfileAgentCommandRequestForSurface(
            candidate,
            readAgentSurfaceVersion(replayRow),
          )
          if (!replayValidation.ok) return profileServiceFailure('invalid', { currentRevision })
          const replayRequest = replayValidation.value
          const persistedTransport = readString(replayRow, 'actor_transport')
          const storedEvidence = readStoredAgentRequestEvidence(replayRow)
          if (persistedTransport !== transport
            || !storedEvidence
            || canonicalProfileJson(storedEvidence.request) !== canonicalProfileJson(replayRequest)
            || readString(replayRow, 'trusted_actor_id') !== PROFILE_AGENT_INSTALLED_ACTOR_ID
            || readString(replayRow, 'request_digest')
              !== profileAgentRequestDigest(readString(replayRow, 'request_json'))) {
            return profileServiceFailure('invalid', { currentRevision })
          }
          const receipt = parseAgentCommandReceipt(replayRow, current)
          return { ok: true, value: Object.freeze({ ...receipt, replayed: true }) }
        }
        const validation = validateProfileAgentCommandRequestForSurface(
          candidate,
          agentCommandSurfaceVersion,
        )
        if (!validation.ok) return validation
        const request = validation.value
        if (request.expectedRevision !== current.head.revision) {
          return profileServiceFailure('conflict', { currentRevision })
        }

        const shouldMintOwnerContext = !request.dryRun || request.commands.some((command) => (
          command.name === 'idea.create'
          || command.name === 'idea.activate'
          || PROFILE_AGENT_MOD_COMMAND_NAMES.some((name) => name === command.name)
          || PROFILE_AGENT_RESEARCH_COMMAND_NAMES.some((name) => name === command.name)
        ))
        const clientTxnId = shouldMintOwnerContext
          ? createAgentClientTxnId()
          : 'agent-dry-run'
        if (typeof clientTxnId !== 'string' || clientTxnId.length === 0) {
          throw new ProfileRevisionCorruptionError('Agent client transaction identity is invalid')
        }
        const committedAt = shouldMintOwnerContext ? now() : undefined
        const commitId = shouldMintOwnerContext ? `agent:${clientTxnId}` : undefined
        const agentActor = {
          kind: 'agent' as const,
          client: trustedActor?.client ?? options.agentActor?.client ?? `eido-${transport}`,
          sessionId: trustedActor?.sessionId ?? options.agentActor?.sessionId ?? fallbackAgentSessionId,
        }
        const planned = planProfileAgentCommandBatch(
          toLogicalDocument(current),
          request,
          {
            profileId: current.head.profileId,
            actor: { id: PROFILE_AGENT_INSTALLED_ACTOR_ID, transport, ...agentActor },
            clientTxnId,
            deriveId: deriveProfileAgentRecordId,
            contentSha256: profileAgentContentSha256,
            ...(committedAt === undefined ? {} : { committedAt }),
            ...(commitId === undefined ? {} : { commitId }),
            ...(committedAt === undefined ? {} : { stampedAt: committedAt }),
          },
          agentCommandSurfaceVersion,
        )
        if (!planned.ok) return planned
        if (request.dryRun) {
          return {
            ok: true,
            value: createAgentDryRunReceipt(planned.value, agentCommandSurfaceVersion),
          }
        }

        const nativePlan = attachAgentClaimedTransitionEvidence(
          request,
          planned.value,
          {
            installedSurfaceVersion: agentCommandSurfaceVersion,
            profileId: current.head.profileId,
            actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
            transport,
            actor: agentActor,
            clientTxnId,
            commitId: commitId!,
            committedAt: committedAt!,
          },
          logicalRecordDigest,
        )
        if (!nativePlan) {
          throw new ProfileRevisionCorruptionError('Agent native transition claims are invalid')
        }
        const revisionPlan = materializeAgentRevisionPlan(
          current,
          nativePlan,
          committedAt!,
          commitId!,
          clientTxnId,
          createIntentEventId,
          createProfileAgentEventId,
        )
        const receipt = createAgentAppliedReceipt(
          nativePlan,
          revisionPlan,
          commitId!,
          agentCommandSurfaceVersion,
        )
        const commandBindings = auditAgentCommandRevision(
          request,
          receipt,
          revisionPlan.recordChanges,
          {
            installedSurfaceVersion: agentCommandSurfaceVersion,
            profileId: current.head.profileId,
            clientTxnId,
            committedAt: committedAt!,
            transport,
            actor: agentActor,
            baseDocument: toLogicalDocument(current),
          },
          {
            deriveId: deriveProfileAgentRecordId,
            contentSha256: profileAgentContentSha256,
            recordDigest: logicalRecordDigest,
          },
        )
        if (!commandBindings) {
          throw new Error('Agent result bindings do not close over the native plan')
        }
        const requestJson = agentRequestEvidenceJson(
          request,
          current.head.profileId,
          transport,
          clientTxnId,
          agentActor,
        )
        const changesJson = canonicalProfileJson(revisionPlan.recordChanges)
        if (Buffer.byteLength(changesJson, 'utf8')
          > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxDurableChangeBytes) {
          throw new SqliteProfileAgentInputError('Agent durable change evidence exceeds its bound')
        }
        if (agentCommandSurfaceVersion === 5) {
          ensureAgentHistorySurfaceV5Schema(connection)
        } else if (agentCommandSurfaceVersion === 4) {
          ensureAgentHistorySurfaceV4Schema(connection)
        }
        insertAgentCommandRevision(connection, {
          request,
          transport,
          clientTxnId,
          committedAt: committedAt!,
          requestJson,
          requestDigest: profileAgentRequestDigest(requestJson),
          changesJson,
          changesDigest: profileAgentRequestDigest(changesJson),
          installedSurfaceVersion: agentCommandSurfaceVersion,
          receipt,
          commandBindings,
          revisionPlan,
        })
        writeAgentPlanRecordsExact(connection, current.head.profileId, revisionPlan)
        updateAgentCommandHead(
          connection,
          revisionPlan.candidate,
          planned.value.baseRevision,
          committedAt!,
        )
        options.testHooks?.beforeCommit?.()

        const persisted = readDocument(connection)
        validatedLogicalDocument(persisted)
        validateRevisionHistory(connection, persisted)
        if (canonicalProfileJson(agentLogicalDocumentEvidence(toLogicalDocument(persisted)))
          !== canonicalProfileJson(agentLogicalDocumentEvidence(revisionPlan.candidate))) {
          throw new ProfileRevisionCorruptionError('Agent mutation readback differs from its plan')
        }
        return { ok: true, value: receipt }
      })
    } catch (error) {
      if (error instanceof AggregateError) {
        uncertain = true
        try {
          runtime.close()
        } catch {
          // AggregateError already records the indeterminate rollback/cleanup boundary.
        }
      }
      return agentStoreFailure(error, currentRevision)
    }
  }

  const commitIdeaLifecycleRevision = async (
    input: SqliteProfileIdeaLifecycleRevisionInput,
  ): Promise<ProfileServiceResult<ProfileIdeaLifecycleReceipt>> => {
    let requestJson: string
    let requestDigest: string
    try {
      validateLifecycleInput(input)
      requestJson = canonicalProfileJson({
        kind: input.kind,
        operationId: input.operationId,
        request: input.request,
      })
      requestDigest = createHash('sha256').update(requestJson).digest('hex')
    } catch {
      return profileServiceFailure('invalid')
    }
    let currentRevision: number | undefined
    try {
      assertUsable()
      assertLiveSqliteProfileOwnershipCapability(
        options.ownershipCapability,
        options.databasePath,
      )
      return runtime.transaction('write', (connection) => {
        assertSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          connection,
          options.databasePath,
        )
        if (readIdempotentRevision(connection, input.idempotencyKey)
          || readGuiProjectionRevisionByIdempotency(connection, input.idempotencyKey)
          || readAgentRevisionByIdempotency(connection, input.idempotencyKey)) {
          const current = readDocument(connection)
          return profileServiceFailure('invalid', { currentRevision: current.head.revision })
        }
        const replay = readLifecycleRevisionByIdempotency(connection, input.idempotencyKey)
        const operation = readLifecycleRevisionByOperation(connection, input.operationId)
        if (replay || operation) {
          const row = replay ?? operation!
          const document = readDocument(connection)
          validateRevisionHistory(connection, document)
          currentRevision = document.head.revision
          if (
            readString(row, 'idempotency_key') !== input.idempotencyKey
            || readString(row, 'operation_id') !== input.operationId
            || readString(row, 'kind') !== input.kind
            || readString(row, 'request_digest') !== requestDigest
            || readString(row, 'request_json') !== requestJson
          ) return profileServiceFailure('invalid', { currentRevision })
          const receipt = parseLifecycleReceipt(readString(row, 'receipt_json'), row, document)
          return { ok: true, value: { ...receipt, replayed: true } }
        }

        const current = readDocument(connection)
        validateRevisionHistory(connection, current)
        currentRevision = current.head.revision
        if (input.expectedRevision !== currentRevision) {
          return profileServiceFailure('conflict', { currentRevision })
        }
        const candidate = validateProfileLogicalDocument(input.candidate)
        if (
          candidate.head.profileId !== current.head.profileId
          || candidate.head.revision !== currentRevision
          || canonicalProfileJson(candidate.head.versions) !== canonicalProfileJson(current.head.versions)
          || candidate.head.activeIdeaId !== input.targetIdeaId
        ) return profileServiceFailure('invalid', { currentRevision })

        const currentLogical = toLogicalDocument(current)
        const candidateById = new Map(candidate.records.map((record) => [record.recordId, record] as const))
        for (const record of currentLogical.records) {
          const retained = candidateById.get(record.recordId)
          if (!retained || canonicalProfileJson(retained) !== canonicalProfileJson(record)) {
            return profileServiceFailure('invalid', { currentRevision })
          }
          candidateById.delete(record.recordId)
        }
        const insertedSpecs = [...candidateById.values()].sort((left, right) => (
          left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0
        ))
        if (
          !validLifecycleInsertion(input.targetIdeaId, insertedSpecs)
          || canonicalProfileJson([...input.importedAssetIds].sort())
            !== canonicalProfileJson(enumerateProfileLogicalAssetIds(insertedSpecs))
        ) {
          return profileServiceFailure('invalid', { currentRevision })
        }
        const revision = currentRevision + 1
        const insertedRecords: ProfileRevisionRecord[] = insertedSpecs.map((record) => ({
          ...record,
          createdRevision: revision,
          updatedRevision: revision,
        }))
        const insertedRecordIds = Object.freeze(insertedRecords.map((record) => record.recordId))
        const receipt: ProfileIdeaLifecycleReceipt = Object.freeze({
          kind: input.kind,
          operationId: input.operationId,
          previousRevision: currentRevision,
          revision,
          targetIdeaId: input.targetIdeaId,
          insertedRecordIds,
          importedAssetIds: Object.freeze([...input.importedAssetIds].sort()),
          replayed: false,
        })
        const receiptJson = canonicalProfileJson(receipt)
        insertLifecycleRevision(connection, input, revision, requestDigest, requestJson, receiptJson)
        for (const record of insertedRecords) insertRecord(connection, current.head.profileId, record)
        const updated = connection.prepare(`
UPDATE profile_meta
SET current_revision = ?, active_idea_id = ?, updated_at = ?
WHERE profile_id = ? AND current_revision = ?
`).run(revision, input.targetIdeaId, input.committedAt, current.head.profileId, currentRevision)
        if (Number(updated.changes) !== 1) throw new Error('SQLite Profile lifecycle compare-and-swap failed')
        options.testHooks?.beforeCommit?.()

        const persisted = readDocument(connection)
        validatedLogicalDocument(persisted)
        validateRevisionHistory(connection, persisted)
        return { ok: true, value: receipt }
      })
    } catch (error) {
      return profileServiceFailure(
        error instanceof ProfileUnsupportedFutureVersionError
          ? 'unsupported-future-version'
          : error instanceof SqliteProfileBlobCorruptionError
          || error instanceof ProfileRevisionCorruptionError
          || error instanceof ProfileLogicalProjectionError
          ? 'corrupt-or-recovery-required'
          : isBusyError(error)
            || error instanceof SqliteProfileOwnershipCapabilityError
            ? 'busy'
            : 'internal',
        {
          ...(currentRevision === undefined ? {} : { currentRevision }),
          ...(error instanceof ProfileUnsupportedFutureVersionError
            ? { supportedVersions: error.supportedVersions }
            : {}),
        },
      )
    }
  }

  const replayIdeaLifecycleRevision: SqliteProfileRevisionStore['replayIdeaLifecycleRevision'] = async (
    input,
  ) => {
    let requestJson: string
    let requestDigest: string
    try {
      if ((input.kind !== 'duplicate-idea' && input.kind !== 'import-idea')
        || input.operationId.length === 0 || input.idempotencyKey.length === 0) {
        return profileServiceFailure('invalid')
      }
      requestJson = canonicalProfileJson({
        kind: input.kind,
        operationId: input.operationId,
        request: input.request,
      })
      requestDigest = createHash('sha256').update(requestJson).digest('hex')
      assertUsable()
      assertLiveSqliteProfileOwnershipCapability(
        options.ownershipCapability,
        options.databasePath,
      )
      return runtime.transaction('read', (connection) => {
        assertSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          connection,
          options.databasePath,
        )
        const document = readDocument(connection)
        validateRevisionHistory(connection, document)
        if (readIdempotentRevision(connection, input.idempotencyKey)
          || readGuiProjectionRevisionByIdempotency(connection, input.idempotencyKey)
          || readAgentRevisionByIdempotency(connection, input.idempotencyKey)) {
          return profileServiceFailure('invalid', { currentRevision: document.head.revision })
        }
        const byKey = readLifecycleRevisionByIdempotency(connection, input.idempotencyKey)
        const byOperation = readLifecycleRevisionByOperation(connection, input.operationId)
        if (!byKey && !byOperation) return { ok: true, value: null }
        const row = byKey ?? byOperation!
        if (readString(row, 'idempotency_key') !== input.idempotencyKey
          || readString(row, 'operation_id') !== input.operationId
          || readString(row, 'kind') !== input.kind
          || readString(row, 'request_digest') !== requestDigest
          || readString(row, 'request_json') !== requestJson) {
          return profileServiceFailure('invalid', { currentRevision: document.head.revision })
        }
        const receipt = parseLifecycleReceipt(readString(row, 'receipt_json'), row, document)
        return { ok: true, value: Object.freeze({ ...receipt, replayed: true }) }
      })
    } catch (error) {
      return profileStoreReadFailure(error)
    }
  }

  const issueGuiOrdinaryIdeaAuthorization: SqliteProfileRevisionStore[
    'issueGuiOrdinaryIdeaAuthorization'
  ] = async (authorization) => {
    if (!validGuiOrdinaryIdeaAuthorization(authorization)) {
      return profileServiceFailure('invalid')
    }
    let currentRevision: number | undefined
    try {
      assertUsable()
      assertLiveSqliteProfileOwnershipCapability(
        options.ownershipCapability,
        options.databasePath,
      )
      return runtime.transaction('write', (connection) => {
        assertSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          connection,
          options.databasePath,
        )
        const document = readDocument(connection)
        validateRevisionHistory(connection, document)
        currentRevision = document.head.revision
        if (authorization.profileId !== document.head.profileId
          || authorization.baseRevision !== document.head.revision
          || authorization.boardId !== `board:${authorization.ideaId}`
          || document.records.some((record) => (
            record.recordId === authorization.ideaId
            || record.recordId === authorization.boardId
          ))
        ) {
          return profileServiceFailure('invalid', { currentRevision })
        }
        const byAuthorizationId = readGuiAuthorizationById(
          connection,
          authorization.authorizationId,
        )
        const byTarget = readGuiAuthorizationByTarget(
          connection,
          authorization.ideaId,
          authorization.boardId,
        )
        if (byAuthorizationId && (!byTarget
          || readString(byAuthorizationId, 'authorization_id')
            !== readString(byTarget, 'authorization_id'))) {
          return profileServiceFailure('invalid', { currentRevision })
        }
        if (byTarget) {
          const existing = guiAuthorizationFromRow(byTarget)
          const consumed = readColumn(byTarget, 'consumed_revision') !== null
          if (consumed) return profileServiceFailure('invalid', { currentRevision })
          const candidateCreatedAt = Date.parse(authorization.createdAt)
          const existingCreatedAt = Date.parse(existing.createdAt)
          if (candidateCreatedAt < existingCreatedAt) {
            return profileServiceFailure('invalid', { currentRevision })
          }
          if (existing.baseRevision === document.head.revision
            && candidateCreatedAt < Date.parse(existing.expiresAt)) {
            return { ok: true, value: existing }
          }
          if (byAuthorizationId) {
            return profileServiceFailure('invalid', { currentRevision })
          }
          const removed = connection.prepare(`
DELETE FROM profile_gui_idea_authorizations
WHERE authorization_id = ?
  AND consumed_revision IS NULL AND consumed_idempotency_key IS NULL
`).run(existing.authorizationId)
          if (Number(removed.changes) !== 1) {
            throw new SqliteProfileGuiInputError('Unused GUI Idea authorization replacement raced')
          }
        }
        connection.prepare(`
INSERT INTO profile_gui_idea_authorizations (
  authorization_id, profile_id, base_revision, idea_id, board_id,
  created_at, expires_at, consumed_revision, consumed_idempotency_key
) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
`).run(
          authorization.authorizationId,
          authorization.profileId,
          authorization.baseRevision,
          authorization.ideaId,
          authorization.boardId,
          authorization.createdAt,
          authorization.expiresAt,
        )
        return { ok: true, value: Object.freeze({ ...authorization }) }
      })
    } catch (error) {
      return guiStoreFailure(error, currentRevision)
    }
  }

  const replayGuiProjectionRevision: SqliteProfileRevisionStore[
    'replayGuiProjectionRevision'
  ] = async (candidate) => {
    const evidence = readGuiProjectionRequestEvidence(candidate)
    if (!evidence) return profileServiceFailure('invalid')
    try {
      assertUsable()
      assertLiveSqliteProfileOwnershipCapability(
        options.ownershipCapability,
        options.databasePath,
      )
      return runtime.transaction('read', (connection) => {
        assertSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          connection,
          options.databasePath,
        )
        const document = readDocument(connection)
        validateRevisionHistory(connection, document)
        const collision = guiProjectionReplayCollision(
          connection,
          evidence,
          document,
        )
        if (collision.kind === 'invalid') {
          return profileServiceFailure('invalid', { currentRevision: document.head.revision })
        }
        if (collision.kind === 'replay') {
          return {
            ok: true,
            value: Object.freeze({ ...collision.receipt, replayed: true }),
          }
        }
        return { ok: true, value: null }
      })
    } catch (error) {
      return profileStoreReadFailure(error)
    }
  }

  const commitGuiProjectionRevision: SqliteProfileRevisionStore[
    'commitGuiProjectionRevision'
  ] = async (input) => {
    const evidence = readGuiProjectionRequestEvidence(input.request)
    let candidate: ProfileLogicalDocument
    if (!evidence) return profileServiceFailure('invalid')
    try {
      candidate = validateProfileLogicalDocument(input.candidate)
    } catch {
      return profileServiceFailure('invalid')
    }
    let currentRevision: number | undefined
    try {
      assertUsable()
      assertLiveSqliteProfileOwnershipCapability(
        options.ownershipCapability,
        options.databasePath,
      )
      return runtime.transaction('write', (connection) => {
        assertSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          connection,
          options.databasePath,
        )
        const current = readDocument(connection)
        validateRevisionHistory(connection, current)
        const replay = guiProjectionReplayCollision(connection, evidence, current)
        if (replay.kind === 'invalid') {
          return profileServiceFailure('invalid', { currentRevision: current.head.revision })
        }
        if (replay.kind === 'replay') {
          return {
            ok: true,
            value: Object.freeze({ ...replay.receipt, replayed: true }),
          }
        }

        currentRevision = current.head.revision
        if (evidence.request.expectedRevision !== currentRevision) {
          return profileServiceFailure('conflict', { currentRevision })
        }
        if (candidate.head.profileId !== current.head.profileId
          || candidate.head.revision !== currentRevision + 1
          || canonicalProfileJson(candidate.head.versions)
            !== canonicalProfileJson(current.head.versions)) {
          return profileServiceFailure('invalid', { currentRevision })
        }

        const trustedCandidate = stampProfileCardAuthorship(
          validatedLogicalDocument(current),
          candidate,
          {
            kind: 'user',
            client: 'eido-desktop',
            sessionId: `${evidence.request.context.trustedActorId}:${evidence.request.generation}`,
          },
        )
        const plan = planGuiProjectionRecordDiff(
          current,
          trustedCandidate,
          evidence.request.context.trustedActorId,
        )
        const authorizationIds = evidence.request.context.ordinaryNewIdeas
          .map((authorization) => authorization.authorizationId)
          .sort()
        if (!validateGuiAuthorizationsForCommit(
          connection,
          evidence.request,
          authorizationIds,
        )) return profileServiceFailure('invalid', { currentRevision })

        const revision = currentRevision + 1
        const commitId = `gui:${evidence.request.clientTxnId}`
        const receipt: SqliteProfileGuiProjectionCommitReceipt = Object.freeze({
          previousRevision: currentRevision,
          revision,
          commitId,
          generation: evidence.request.generation,
          clientTxnId: evidence.request.clientTxnId,
          idempotencyKey: evidence.request.idempotencyKey,
          deletedRecordIds: Object.freeze([...plan.deletedRecordIds]),
          changedRecordIds: Object.freeze([...plan.changedRecordIds]),
          appendedIntentEventIds: Object.freeze([...plan.appendedIntentEventIds]),
          authorizationIds: Object.freeze([...authorizationIds]),
          replayed: false,
        })
        insertGuiProjectionRevision(
          connection,
          evidence,
          receipt,
          plan,
        )
        consumeGuiAuthorizations(
          connection,
          evidence.request,
          authorizationIds,
          revision,
        )
        writePlanRecords(connection, current.head.profileId, plan)
        updateGuiProjectionHead(connection, trustedCandidate, evidence.request)
        options.testHooks?.beforeCommit?.()

        const persisted = readDocument(connection)
        // Verify what landed against what was planned, rather than re-deriving
        // the whole Profile. The plan already carries a validated document, so
        // the open question is only whether SQLite stored exactly the rows this
        // commit asked for and left every other row alone.
        verifyGuiProjectionReadback(persisted, trustedCandidate, plan, revision)
        adoptValidatedLogicalDocument(persisted, trustedCandidate)
        validateRevisionHistory(connection, persisted)
        return { ok: true, value: receipt }
      })
    } catch (error) {
      return guiStoreFailure(error, currentRevision)
    }
  }

  const store: SqliteProfileRevisionStore = {
    async status() {
      try {
        assertUsable()
        assertLiveSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          options.databasePath,
        )
        return runtime.transaction('read', (connection) => {
          assertSqliteProfileOwnershipCapability(
            options.ownershipCapability,
            connection,
            options.databasePath,
          )
          const snapshot = hydrateRevisionDocument(readDocument(connection), options.hydrateAsset)
          return {
            ok: true,
            value: {
              profileId: snapshot.profileId,
              revision: snapshot.revision,
              versions: snapshot.versions,
              state: 'ready',
              owner: { mode: 'none', route: 'none' },
              dirty: pending.size === 0 ? 'clean' : 'pending',
              compatibility: snapshot.compatibility,
            },
          }
        })
      } catch (error) {
        return profileStoreReadFailure(error)
      }
    },
    async capabilities() {
      try {
        assertUsable()
        assertLiveSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          options.databasePath,
        )
        return { ok: true, value: createProfileCapabilities('sqlite') }
      } catch (error) {
        return profileStoreReadFailure(error)
      }
    },
    async query(request) {
      try {
        assertUsable()
        assertLiveSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          options.databasePath,
        )
        return runtime.transaction('read', (connection) => {
          assertSqliteProfileOwnershipCapability(
            options.ownershipCapability,
            connection,
            options.databasePath,
          )
          return queryProfileLogicalDocument(toLogicalDocument(readDocument(connection)), request)
        })
      } catch (error) {
        return profileStoreReadFailure(error)
      }
    },
    async inspectResult(request) {
      try {
        assertUsable()
        assertLiveSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          options.databasePath,
        )
        return runtime.transaction('read', (connection) => {
          assertSqliteProfileOwnershipCapability(
            options.ownershipCapability,
            connection,
            options.databasePath,
          )
          return inspectProfileLogicalResult(
            toLogicalDocument(readDocument(connection)),
            request,
          )
        })
      } catch (error) {
        return profileStoreReadFailure(error)
      }
    },
    async changes(request) {
      try {
        assertUsable()
        assertLiveSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          options.databasePath,
        )
        return runtime.transaction('read', (connection) => {
          assertSqliteProfileOwnershipCapability(
            options.ownershipCapability,
            connection,
            options.databasePath,
          )
          const document = readDocument(connection)
          return queryProfileAgentChangeTrail(
            readAgentChangeTrailSource(connection, document),
            request,
          )
        })
      } catch (error) {
        return profileStoreReadFailure(error)
      }
    },
    async agentCardNeighbors(request) {
      try {
        assertUsable()
        assertLiveSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          options.databasePath,
        )
        return runtime.transaction('read', (connection) => {
          assertSqliteProfileOwnershipCapability(
            options.ownershipCapability,
            connection,
            options.databasePath,
          )
          return profileAgentSpatialServiceResult(queryProfileAgentCardNeighbors(
            toLogicalDocument(readDocument(connection)),
            request,
          ))
        })
      } catch (error) {
        return profileStoreReadFailure(error)
      }
    },
    async agentCardSetBounds(request) {
      try {
        assertUsable()
        assertLiveSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          options.databasePath,
        )
        return runtime.transaction('read', (connection) => {
          assertSqliteProfileOwnershipCapability(
            options.ownershipCapability,
            connection,
            options.databasePath,
          )
          return profileAgentSpatialServiceResult(queryProfileAgentCardSetBounds(
            toLogicalDocument(readDocument(connection)),
            request,
          ))
        })
      } catch (error) {
        return profileStoreReadFailure(error)
      }
    },
    async snapshot() {
      try {
        assertUsable()
        assertLiveSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          options.databasePath,
        )
        return runtime.transaction('read', (connection) => {
          assertSqliteProfileOwnershipCapability(
            options.ownershipCapability,
            connection,
            options.databasePath,
          )
          return {
            ok: true,
            value: hydrateRevisionDocument(readDocument(connection), options.hydrateAsset),
          }
        })
      } catch (error) {
        return profileStoreReadFailure(error)
      }
    },
    async applyCommandBatch(candidate) {
      const validation = validateProfileCommandBatch(candidate)
      if (!validation.ok) return validation
      return applyValidatedBatch(validation.value)
    },
    applyAgentCommandBatch,
    async applyPreparedAssetCommandBatch(prepared) {
      let batch: ProfileCommandBatch
      try {
        batch = readSqlitePreparedProfileAssetBatch(
          prepared,
          options.ownershipCapability,
          options.databasePath,
        )
      } catch (error) {
        return profileServiceFailure(
          error instanceof SqliteProfileBlobCapabilityError
            ? 'capability-denied'
            : error instanceof SqliteProfileOwnershipCapabilityError
              ? 'busy'
              : 'internal',
        )
      }
      const validation = validateInternalProfileAssetCommandBatch(batch)
      if (!validation.ok) return profileServiceFailure('internal')
      return applyValidatedBatch(validation.value)
    },
    async readRecord(recordId) {
      if (recordId.length === 0) return profileServiceFailure('invalid')
      try {
        assertUsable()
        assertLiveSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          options.databasePath,
        )
        return runtime.transaction('read', (connection) => {
          assertSqliteProfileOwnershipCapability(
            options.ownershipCapability,
            connection,
            options.databasePath,
          )
          const document = readDocument(connection)
          hydrateRevisionDocument(document, options.hydrateAsset)
          return {
            ok: true,
            value: document.records.find((record) => record.recordId === recordId) ?? null,
          }
        })
      } catch (error) {
        return profileStoreReadFailure(error)
      }
    },
    async logicalDocument() {
      try {
        assertUsable()
        assertLiveSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          options.databasePath,
        )
        return runtime.transaction('read', (connection) => {
          assertSqliteProfileOwnershipCapability(
            options.ownershipCapability,
            connection,
            options.databasePath,
          )
          const revisionDocument = readDocument(connection)
          validateRevisionHistory(connection, revisionDocument)
          const document = validatedLogicalDocument(revisionDocument)
          return { ok: true, value: document }
        })
      } catch (error) {
        return profileStoreReadFailure(error)
      }
    },
    issueGuiOrdinaryIdeaAuthorization,
    replayGuiProjectionRevision,
    commitGuiProjectionRevision,
    replayIdeaLifecycleRevision,
    commitIdeaLifecycleRevision,
    async referencedAssetDigests() {
      try {
        assertUsable()
        assertLiveSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          options.databasePath,
        )
        return runtime.transaction('read', (connection) => {
          assertSqliteProfileOwnershipCapability(
            options.ownershipCapability,
            connection,
            options.databasePath,
          )
          const document = readDocument(connection)
          const roots = readProfileAssetRoots(document, options.hydrateAsset)
          return { ok: true, value: Object.freeze(roots.map((root) => root.sha256)) }
        })
      } catch (error) {
        return profileStoreReadFailure(error)
      }
    },
    currentRevision() {
      assertUsable()
      assertLiveSqliteProfileOwnershipCapability(
        options.ownershipCapability,
        options.databasePath,
      )
      return runtime.transaction('read', (connection) => {
        assertSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          connection,
          options.databasePath,
        )
        const document = readDocument(connection)
        hydrateRevisionDocument(document, options.hydrateAsset)
        validateRevisionHistory(connection, document)
        return document.head.revision
      })
    },
    currentProfileIdentity() {
      assertUsable()
      assertLiveSqliteProfileOwnershipCapability(
        options.ownershipCapability,
        options.databasePath,
      )
      return runtime.transaction('read', (connection) => {
        assertSqliteProfileOwnershipCapability(
          options.ownershipCapability,
          connection,
          options.databasePath,
        )
        const document = readDocument(connection)
        hydrateRevisionDocument(document, options.hydrateAsset)
        validateRevisionHistory(connection, document)
        return Object.freeze({
          profileId: document.head.profileId,
          revision: document.head.revision,
          ...readLatestRecoveryOperation(connection, document),
        })
      })
    },
    async createStandaloneBackup(destinationPath) {
      assertUsable()
      assertLiveSqliteProfileOwnershipCapability(
        options.ownershipCapability,
        options.databasePath,
      )
      const checkpoint = runtime.checkpointFull()
      if (checkpoint.busy !== 0 || checkpoint.logFrames !== checkpoint.checkpointedFrames) {
        throw new Error('SQLite Profile could not be checkpointed before recovery backup')
      }
      await runtime.backupTo(destinationPath)
      assertLiveSqliteProfileOwnershipCapability(
        options.ownershipCapability,
        options.databasePath,
      )
    },
    retryableWork() {
      return [...pending.values()].map(cloneBatch)
    },
    close() {
      if (closed) return
      runtime.close()
      closed = true
    },
  }
  return Object.freeze(store)
}

export function createSqliteProfileImportStage(options: Readonly<{
  databasePath: string
  document: unknown
  openRuntime?: (databasePath: string) => SqliteRuntime
  now?: () => string
}>): SqliteProfileImportStage {
  const databasePath = path.resolve(options.databasePath)
  if (!path.isAbsolute(options.databasePath) || options.databasePath.includes('\0')
    || [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].some(existsSync)) {
    throw new Error('SQLite Profile import stage path is invalid or occupied')
  }
  const document = validateProfileLogicalDocument(options.document)
  const runtimeOpener = options.openRuntime ?? openSqliteRuntime
  let runtime: SqliteRuntime | undefined
  try {
    runtime = runtimeOpener(databasePath)
    runtime.transaction('write', (connection) => {
      connection.exec(CREATE_SCHEMA_SQL)
      profileAgentEventSchemaGenerationState(connection)
      ensureProfileAgentEventSeedAnchorSchema(connection)
      ensureProfileAgentEventRecordKindSchema(connection)
      ensureGuiRecordChangeDigestSchema(connection)
      ensureAgentHistoryV2Schema(connection)
      seedProfile(connection, toRevisionDocument(document), (options.now ?? (() => new Date().toISOString()))())
    })
    const checkpoint = runtime.checkpointFull()
    if (checkpoint.busy !== 0 || checkpoint.logFrames !== checkpoint.checkpointedFrames) {
      throw new Error('SQLite Profile import stage could not be checkpointed')
    }
    if (!runtime.integrityCheck().ok) throw new Error('SQLite Profile import stage failed integrity')
    runtime.transaction('read', (connection) => {
      const persisted = readDocument(connection)
      validateRevisionHistory(connection, persisted)
      if (canonicalLogicalMeaning(toLogicalDocument(persisted)) !== canonicalLogicalMeaning(document)) {
        throw new Error('SQLite Profile import stage changed logical meaning')
      }
    })
    runtime.close()
    runtime = undefined

    const reopened = runtimeOpener(databasePath)
    try {
      if (!reopened.integrityCheck().ok) throw new Error('SQLite Profile import stage failed reopen integrity')
      reopened.transaction('read', (connection) => {
        const persisted = readDocument(connection)
        validateRevisionHistory(connection, persisted)
        if (canonicalLogicalMeaning(toLogicalDocument(persisted)) !== canonicalLogicalMeaning(document)) {
          throw new Error('SQLite Profile import stage changed after reopen')
        }
      })
    } finally {
      reopened.close()
    }
    flushRegularFile(databasePath)
    if ([`${databasePath}-wal`, `${databasePath}-shm`].some(existsSync)) {
      throw new Error('SQLite Profile import stage retained working sidecars')
    }
    const evidence = digestRegularFile(databasePath)
    const handle = Object.freeze(Object.create(null)) as SqliteProfileImportStage
    sqliteProfileImportStages.set(handle, {
      databasePath,
      profileId: document.head.profileId,
      revision: document.head.revision,
      databaseDigest: evidence.digest,
      databaseSize: evidence.size,
      blobRoots: readProfileLogicalBlobRoots(document),
      claimed: false,
    })
    return handle
  } catch (error) {
    try {
      runtime?.close()
    } finally {
      removeExactSqliteStage(databasePath)
    }
    throw error
  }
}

export function claimSqliteProfileImportStage(stage: SqliteProfileImportStage): Readonly<{
  databasePath: string
  profileId: string
  revision: number
  databaseDigest: string
  databaseSize: number
  blobRoots: readonly Readonly<{ sha256: string; size: number }>[]
}> {
  const state = sqliteProfileImportStages.get(stage)
  if (!state || state.claimed) throw new Error('SQLite Profile import stage capability is invalid')
  const evidence = digestRegularFile(state.databasePath)
  if (evidence.digest !== state.databaseDigest || evidence.size !== state.databaseSize) {
    throw new Error('SQLite Profile import stage changed before publication')
  }
  state.claimed = true
  return Object.freeze({
    databasePath: state.databasePath,
    profileId: state.profileId,
    revision: state.revision,
    databaseDigest: state.databaseDigest,
    databaseSize: state.databaseSize,
    blobRoots: state.blobRoots,
  })
}

function flushRegularFile(location: string): void {
  const descriptor = openSync(location, constants.O_RDWR)
  try {
    const metadata = fstatSync(descriptor, { bigint: true })
    if (!metadata.isFile() || metadata.nlink !== 1n) {
      throw new Error('SQLite Profile import stage is not a private regular file')
    }
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function digestRegularFile(location: string): Readonly<{ digest: string; size: number }> {
  const before = lstatSync(location, { bigint: true })
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n) {
    throw new Error('SQLite Profile import stage is not a private regular file')
  }
  const descriptor = openSync(location, constants.O_RDONLY)
  const digest = createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  let size = 0
  try {
    const opened = fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n
      || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.birthtimeNs !== before.birthtimeNs || opened.size !== before.size) {
      throw new Error('SQLite Profile import stage identity changed while opening')
    }
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.byteLength, null)
      if (count === 0) break
      size += count
      digest.update(buffer.subarray(0, count))
    }
  } finally {
    closeSync(descriptor)
  }
  const after = lstatSync(location, { bigint: true })
  if (after.isSymbolicLink() || !after.isFile() || after.nlink !== 1n
    || after.dev !== before.dev || after.ino !== before.ino
    || after.birthtimeNs !== before.birthtimeNs || after.size !== before.size
    || after.size !== BigInt(size)) {
    throw new Error('SQLite Profile import stage identity changed while reading')
  }
  return Object.freeze({ digest: digest.digest('hex'), size })
}

export function readProfileLogicalBlobRoots(
  document: ProfileLogicalDocument,
): readonly Readonly<{ sha256: string; size: number }>[] {
  const sizes = new Map<string, number>()
  hydrateProfileLogicalDocument(document, (payload) => {
    const existing = sizes.get(payload.sha256)
    if (existing !== undefined && existing !== payload.size) {
      throw new Error('Portable Profile asset digest has inconsistent sizes')
    }
    sizes.set(payload.sha256, payload.size)
    return hydrateProfileLogicalAsset(payload, `data:${payload.mimeType};base64,`)
  }, { validateLocalAssetBytes: false })
  const digests = enumerateProfileAssetDigests(document)
  if (digests.length !== sizes.size || digests.some((digest) => !sizes.has(digest))) {
    throw new Error('Portable Profile asset root closure is inconsistent')
  }
  return Object.freeze(digests.map((sha256) => Object.freeze({
    sha256,
    size: sizes.get(sha256)!,
  })))
}

function canonicalLogicalMeaning(document: ProfileLogicalDocument): string {
  return canonicalProfileJson({
    head: document.head,
    records: [...document.records].sort((left, right) => (
      codeUnitCompare(left.kind, right.kind)
      || codeUnitCompare(left.ownerId, right.ownerId)
      || left.ordinal - right.ordinal
      || codeUnitCompare(left.recordId, right.recordId)
    )),
  })
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function removeExactSqliteStage(databasePath: string): void {
  for (const location of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    try {
      unlinkSync(location)
    } catch (error) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

export function inspectSqliteProfileRevisionDatabase(options: {
  databasePath: string
  hydrateAsset?: ProfileAssetHydrator
  metadataOnly?: boolean
  legacyReadOnlyRecovery?: true
  openRuntime?: (databasePath: string) => SqliteRuntime
}): SqliteProfileRevisionInspection {
  const runtime = (options.openRuntime ?? openSqliteRuntime)(options.databasePath)
  try {
    const integrity = runtime.integrityCheck()
    if (!integrity.ok) throw new ProfileRevisionCorruptionError('SQLite Profile integrity check failed')
    return runtime.transaction('read', (connection) => {
      const document = readDocument(connection)
      const blobRoots = options.metadataOnly
        ? readProfileLogicalBlobRoots(toLogicalDocument(document))
        : readProfileAssetRoots(document, options.hydrateAsset)
      validateRevisionHistory(connection, document, {
        allowMissingAgentSchema: options.legacyReadOnlyRecovery === true,
      })
      return Object.freeze({
        profileId: document.head.profileId,
        revision: document.head.revision,
        versions: Object.freeze({ ...document.head.versions }),
        logicalDigest: createHash('sha256')
          .update(canonicalProfilePortableDocumentBytes(toLogicalDocument(document)))
          .digest('hex'),
        blobRoots,
        ...readLatestRecoveryOperation(connection, document),
      })
    })
  } finally {
    runtime.close()
  }
}

/**
 * Reads the current logical Profile projection without trusting its revision
 * evidence. This is intentionally narrower than ordinary inspection: callers
 * may use it only as input to a copy-first recovery replacement, never as a
 * live mutable authority.
 */
export function salvageCurrentSqliteProfileSnapshot(options: {
  databasePath: string
  hydrateAsset?: ProfileAssetHydrator
  openRuntime?: (databasePath: string) => SqliteRuntime
}): Readonly<{ snapshot: ProfileSnapshot; sourceRecordVersion: 1 | 2 }> {
  const sourcePath = path.resolve(options.databasePath)
  const workingPath = path.join(
    path.dirname(sourcePath),
    `.${path.basename(sourcePath)}.salvage-${randomUUID()}.sqlite`,
  )
  for (const suffix of ['', '-wal', '-shm'] as const) {
    const source = `${sourcePath}${suffix}`
    if (existsSync(source)) copyFileSync(source, `${workingPath}${suffix}`, constants.COPYFILE_FICLONE)
  }
  let runtime: SqliteRuntime | undefined
  try {
    runtime = (options.openRuntime ?? openSqliteRuntime)(workingPath)
    const integrity = runtime.integrityCheck()
    if (!integrity.ok) throw new ProfileRevisionCorruptionError('SQLite Profile integrity check failed')
    return runtime.transaction('read', (connection) => {
      const headCount = readInteger(
        connection.prepare('SELECT COUNT(*) AS count FROM profile_meta').get(),
        'count',
      )
      if (headCount !== 1) {
        throw new ProfileRevisionCorruptionError('SQLite Profile salvage requires exactly one authority head')
      }
      const storedRecordVersion = readInteger(
        connection.prepare('SELECT record_version FROM profile_meta').get(),
        'record_version',
      )
      const sourceRecordVersion: 1 | 2 = storedRecordVersion === PROFILE_CONTRACT_VERSIONS.record
        ? PROFILE_CONTRACT_VERSIONS.record
        : 1
      const document = storedRecordVersion === PROFILE_CONTRACT_VERSIONS.record
        ? readDocument(connection)
        : readLegacyRecordAxisOneDocument(connection, storedRecordVersion)
      return Object.freeze({
        snapshot: hydrateRevisionDocument(document, options.hydrateAsset),
        sourceRecordVersion,
      })
    })
  } finally {
    try {
      runtime?.close()
    } finally {
      removeExactSqliteStage(workingPath)
    }
  }
}

function readLegacyRecordAxisOneDocument(
  runtime: SqliteRuntime,
  sourceRecordVersion: number,
): ProfileRevisionDocument {
  if (sourceRecordVersion !== 1) {
    if (sourceRecordVersion > PROFILE_CONTRACT_VERSIONS.record) {
      throw new ProfileUnsupportedFutureVersionError('SQLite Profile record_version is from a future version')
    }
    throw new ProfileRevisionCorruptionError('SQLite Profile record_version is invalid')
  }
  const headRow = runtime.prepare('SELECT * FROM profile_meta').get()
  if (!headRow
    || readString(headRow, 'format') !== 'eido-profile'
    || readString(headRow, 'source') !== 'friends-alpha') {
    throw new ProfileRevisionCorruptionError('SQLite legacy Profile authority format is unsupported')
  }
  const profileId = readString(headRow, 'profile_id')
  const records = runtime.prepare(`
SELECT record_id, kind, owner_id, parent_id, ordinal, record_version,
       created_revision, updated_revision, payload_json
FROM profile_records
WHERE profile_id = ?
ORDER BY kind, owner_id, ordinal, record_id
`).all(profileId).flatMap((row): ProfileRevisionRecord[] => {
    const kind = readString(row, 'kind') as ProfileRevisionRecord['kind']
    if (readInteger(row, 'record_version') !== 1) {
      throw new ProfileRevisionCorruptionError('SQLite legacy Profile record axis is mixed')
    }
    if (kind === 'mod-template' || kind === 'mod-instance') return []
    const parent = readColumn(row, 'parent_id')
    let payload = parseJson(readString(row, 'payload_json'), 'legacy Profile record payload')
    if (kind === 'migration-ledger-entry' && isObjectRecord(payload)) {
      payload = Object.freeze({ ...payload, recordVersion: PROFILE_CONTRACT_VERSIONS.record })
    } else if (kind === 'card') {
      payload = stripLegacyModFromCardPayload(payload)
    } else if (kind === 'intent-event') {
      payload = stripLegacyModFromIntentPayload(payload)
    }
    return [{
      recordId: readString(row, 'record_id'),
      kind,
      ownerId: readString(row, 'owner_id'),
      parentId: parent === null ? null : requireString(parent, 'parent_id'),
      ordinal: readInteger(row, 'ordinal'),
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      createdRevision: readInteger(row, 'created_revision'),
      updatedRevision: readInteger(row, 'updated_revision'),
      payload,
    }]
  })
  return {
    head: {
      profileId,
      revision: readInteger(headRow, 'current_revision'),
      versions: {
        profile: readExpectedVersion(headRow, 'profile_version', PROFILE_CONTRACT_VERSIONS.profile),
        schema: readExpectedVersion(headRow, 'schema_version', PROFILE_CONTRACT_VERSIONS.schema),
        record: PROFILE_CONTRACT_VERSIONS.record,
        asset: readExpectedVersion(headRow, 'asset_version', PROFILE_CONTRACT_VERSIONS.asset),
        app: readExpectedVersion(headRow, 'app_version', PROFILE_CONTRACT_VERSIONS.app),
        command: readExpectedVersion(headRow, 'command_version', PROFILE_CONTRACT_VERSIONS.command),
        export: readExpectedVersion(headRow, 'export_version', PROFILE_CONTRACT_VERSIONS.export),
      },
      activeIdeaId: readString(headRow, 'active_idea_id'),
    },
    records,
  }
}

function stripLegacyModFromCardPayload(payload: unknown): ProfileRevisionRecord['payload'] {
  if (!isObjectRecord(payload) || !Object.prototype.hasOwnProperty.call(payload, 'mod')) {
    return payload as ProfileRevisionRecord['payload']
  }
  const { mod: _legacyMod, ...cardWithoutLegacyMod } = payload
  return Object.freeze(cardWithoutLegacyMod) as ProfileRevisionRecord['payload']
}

function stripLegacyModFromIntentPayload(payload: unknown): ProfileRevisionRecord['payload'] {
  if (!isObjectRecord(payload) || !isObjectRecord(payload.data)) return payload as ProfileRevisionRecord['payload']
  const card = payload.data.card
  if (!isObjectRecord(card) || !Object.prototype.hasOwnProperty.call(card, 'mod')) {
    return payload as ProfileRevisionRecord['payload']
  }
  const { mod: _legacyMod, ...cardWithoutLegacyMod } = card
  return Object.freeze({
    ...payload,
    data: Object.freeze({ ...payload.data, card: Object.freeze(cardWithoutLegacyMod) }),
  }) as ProfileRevisionRecord['payload']
}

export function appendSqliteProfileRecoveryRevision(options: {
  databasePath: string
  candidateId: string
  sourceRevision: number
  observedHighWater: number
  revision: number
  operationId: string
  recoveredAt: string
  hydrateAsset?: ProfileAssetHydrator
  openRuntime?: (databasePath: string) => SqliteRuntime
}): SqliteProfileRevisionInspection {
  const runtime = (options.openRuntime ?? openSqliteRuntime)(options.databasePath)
  try {
    runtime.transaction('write', (connection) => {
      profileAgentHistorySchemaState(connection)
      profileAgentEventSchemaGenerationState(connection)
      connection.exec(CREATE_SCHEMA_SQL)
      ensureProfileAgentEventSeedAnchorSchema(connection)
      ensureProfileAgentEventRecordKindSchema(connection)
      ensureGuiRecordChangeDigestSchema(connection)
      ensureAgentHistoryV2Schema(connection)
      const document = readDocument(connection)
      hydrateRevisionDocument(document, options.hydrateAsset)
      validateRevisionHistory(connection, document)
      if (
        document.head.revision !== options.sourceRevision
        || !Number.isSafeInteger(options.observedHighWater)
        || options.observedHighWater < options.sourceRevision
        || !Number.isSafeInteger(options.revision)
        || options.revision !== options.observedHighWater + 1
        || options.candidateId.length === 0
        || options.operationId.length === 0
        || options.recoveredAt.length === 0
      ) throw new ProfileRevisionCorruptionError('SQLite Profile recovery revision is invalid')
      connection.prepare(`
INSERT INTO profile_revisions (
  profile_id, revision, previous_revision, commit_id, committed_at,
  actor_id, actor_kind, actor_transport, client_txn_id, idempotency_key,
  batch_digest, batch_json, receipt_json
) VALUES (?, ?, ?, ?, ?, 'profile-recovery', 'system', NULL, ?, NULL, NULL, NULL, NULL)
`).run(
        document.head.profileId,
        options.revision,
        options.sourceRevision,
        `recovery:${options.operationId}`,
        options.recoveredAt,
        options.operationId,
      )
      connection.prepare(`
INSERT INTO profile_recovery_events (
  profile_id, revision, candidate_id, source_revision,
  observed_high_water, operation_id, recovered_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
        document.head.profileId,
        options.revision,
        options.candidateId,
        options.sourceRevision,
        options.observedHighWater,
        options.operationId,
        options.recoveredAt,
      )
      const updated = connection.prepare(`
UPDATE profile_meta
SET current_revision = ?, updated_at = ?
WHERE profile_id = ? AND current_revision = ?
`).run(
        options.revision,
        options.recoveredAt,
        document.head.profileId,
        options.sourceRevision,
      )
      if (Number(updated.changes) !== 1) {
        throw new ProfileRevisionCorruptionError('SQLite Profile recovery compare-and-swap failed')
      }
    })
    const checkpoint = runtime.checkpointFull()
    if (checkpoint.busy !== 0 || checkpoint.logFrames !== checkpoint.checkpointedFrames) {
      throw new ProfileRevisionCorruptionError('Recovered SQLite Profile checkpoint is incomplete')
    }
    const integrity = runtime.integrityCheck()
    if (!integrity.ok) throw new ProfileRevisionCorruptionError('Recovered SQLite Profile integrity check failed')
    return runtime.transaction('read', (connection) => {
      const document = readDocument(connection)
      const blobRoots = readProfileAssetRoots(document, options.hydrateAsset)
      validateRevisionHistory(connection, document)
      return Object.freeze({
        profileId: document.head.profileId,
        revision: document.head.revision,
        versions: Object.freeze({ ...document.head.versions }),
        logicalDigest: createHash('sha256')
          .update(canonicalProfilePortableDocumentBytes(toLogicalDocument(document)))
          .digest('hex'),
        blobRoots,
        ...readLatestRecoveryOperation(connection, document),
      })
    })
  } finally {
    runtime.close()
  }
}

function toRevisionDocument(document: ProfileLogicalDocument): ProfileRevisionDocument {
  return Object.freeze({
    head: Object.freeze({ ...document.head }),
    records: Object.freeze(document.records.map((record) => Object.freeze({
      ...record,
      createdRevision: document.head.revision,
      updatedRevision: document.head.revision,
    }))),
  })
}

/**
 * One validated logical view per document read. A commit asks for this view
 * from several places (authorship stamping, the record diff, history
 * validation); rebuilding and re-validating it each time cost more than the
 * write itself. The cache is keyed on the read itself, so a later read of a
 * changed Profile never reuses it.
 */
const validatedLogicalDocuments = new WeakMap<ProfileRevisionDocument, ProfileLogicalDocument>()

/**
 * The last document validated in this process, recognised by its records
 * rather than by object identity. Every read builds a new object, so without
 * this a Profile that has not changed since the previous read is validated
 * again from scratch, which on a large Board is the most expensive thing a save
 * does. A record can only change through a commit, and a commit always stamps
 * it with the new revision, so identical ids and revisions mean identical
 * content for as long as one open store owns the database.
 *
 * Opening a store discards it. Anything that edited the file behind the store's
 * back is therefore still caught in full the next time the Profile is opened,
 * which is when such damage actually arrives.
 */
let lastValidatedLogicalDocument: Readonly<{
  fingerprint: string
  document: ProfileLogicalDocument
}> | undefined

function revisionDocumentFingerprint(document: ProfileRevisionDocument): string {
  const parts: (string | number)[] = [
    document.head.profileId,
    document.head.revision,
    document.head.activeIdeaId,
    document.records.length,
  ]
  for (const record of document.records) {
    parts.push(record.recordId, record.createdRevision, record.updatedRevision)
  }
  return parts.join('\u0000')
}

function validatedLogicalDocument(document: ProfileRevisionDocument): ProfileLogicalDocument {
  const cached = validatedLogicalDocuments.get(document)
  if (cached) return cached
  const fingerprint = revisionDocumentFingerprint(document)
  if (lastValidatedLogicalDocument?.fingerprint === fingerprint) {
    const reused = lastValidatedLogicalDocument.document
    validatedLogicalDocuments.set(document, reused)
    return reused
  }
  const validated = validateProfileLogicalDocument(toLogicalDocument(document))
  validatedLogicalDocuments.set(document, validated)
  lastValidatedLogicalDocument = Object.freeze({ fingerprint, document: validated })
  return validated
}

/**
 * Binds a freshly read document to the validated document a commit just wrote,
 * once the read-back check has proved they hold the same records.
 */
function adoptValidatedLogicalDocument(
  document: ProfileRevisionDocument,
  validated: ProfileLogicalDocument,
): void {
  validatedLogicalDocuments.set(document, validated)
  lastValidatedLogicalDocument = Object.freeze({
    fingerprint: revisionDocumentFingerprint(document),
    document: validated,
  })
}

/**
 * Proves a GUI commit landed exactly its plan. Every record the plan touched
 * must read back with this revision and the planned payload, and no other
 * record may claim to have been written by it.
 */
function verifyGuiProjectionReadback(
  persisted: ProfileRevisionDocument,
  intended: ProfileLogicalDocument,
  plan: GuiProjectionRecordPlan,
  revision: number,
): void {
  if (persisted.head.revision !== revision
    || persisted.head.profileId !== intended.head.profileId
    || persisted.head.activeIdeaId !== intended.head.activeIdeaId
    || persisted.records.length !== intended.records.length) {
    throw new ProfileRevisionCorruptionError('GUI commit read-back does not match its plan')
  }
  const written = new Map<string, ProfileRevisionRecord>()
  for (const record of [...plan.upsertedRecords, ...plan.insertedRecords]) {
    written.set(record.recordId, record)
  }
  const deleted = new Set(plan.deletedRecordIds)
  const persistedById = new Map(persisted.records.map((record) => [record.recordId, record] as const))
  for (const recordId of deleted) {
    if (persistedById.has(recordId)) {
      throw new ProfileRevisionCorruptionError('GUI commit read-back retains a deleted record')
    }
  }
  for (const record of persisted.records) {
    const touched = record.updatedRevision === revision
    const planned = written.get(record.recordId)
    if (touched !== (planned !== undefined)) {
      throw new ProfileRevisionCorruptionError('GUI commit read-back touched an unplanned record')
    }
    if (!planned) continue
    if (record.kind !== planned.kind
      || record.ownerId !== planned.ownerId
      || record.parentId !== planned.parentId
      || record.ordinal !== planned.ordinal
      || record.recordVersion !== planned.recordVersion
      || record.createdRevision !== planned.createdRevision
      || record.updatedRevision !== planned.updatedRevision
      || canonicalProfileJson(record.payload) !== canonicalProfileJson(planned.payload)) {
      throw new ProfileRevisionCorruptionError('GUI commit read-back differs from its planned record')
    }
  }
  if (written.size !== [...persisted.records].filter((record) => record.updatedRevision === revision).length) {
    throw new ProfileRevisionCorruptionError('GUI commit read-back is missing a planned record')
  }
}

function toLogicalDocument(document: ProfileRevisionDocument): ProfileLogicalDocument {
  if (!Number.isSafeInteger(document.head.revision) || document.head.revision < 0) {
    throw new ProfileRevisionCorruptionError('SQLite Profile revision head is invalid')
  }
  return {
    head: document.head,
    records: document.records.map((record) => {
      if (
        !Number.isSafeInteger(record.createdRevision)
        || !Number.isSafeInteger(record.updatedRevision)
        || record.createdRevision < 0
        || record.updatedRevision < record.createdRevision
        || record.updatedRevision > document.head.revision
      ) throw new ProfileRevisionCorruptionError('SQLite Profile record revision range is invalid')
      return {
        recordId: record.recordId,
        kind: record.kind,
        ownerId: record.ownerId,
        parentId: record.parentId,
        ordinal: record.ordinal,
        recordVersion: record.recordVersion,
        payload: record.payload as ProfileLogicalRecordSpec['payload'],
      }
    }),
  }
}

function hydrateRevisionDocument(
  document: ProfileRevisionDocument,
  hydrateAsset?: ProfileAssetHydrator,
): ProfileSnapshot {
  try {
    // Validate the document once (cached per revision), then build the snapshot
    // from the validated form without re-proving what validation established.
    return hydrateProfileLogicalDocument(
      validatedLogicalDocument(document),
      hydrateAsset ?? unavailableAssetHydrator,
      { roundTrip: false },
    )
  } catch (error) {
    if (error instanceof ProfileLogicalProjectionError) {
      throw new ProfileRevisionCorruptionError(error.message)
    }
    throw error
  }
}

function readProfileAssetRoots(
  document: ProfileRevisionDocument,
  hydrateAsset?: ProfileAssetHydrator,
): readonly Readonly<{ sha256: string; size: number }>[] {
  const sizes = new Map<string, number>()
  const logicalDocument = toLogicalDocument(document)
  try {
    hydrateProfileLogicalDocument(logicalDocument, (payload) => {
      const existingSize = sizes.get(payload.sha256)
      if (existingSize !== undefined && existingSize !== payload.size) {
        throw new ProfileRevisionCorruptionError('Logical Profile asset digest has inconsistent sizes')
      }
      sizes.set(payload.sha256, payload.size)
      return (hydrateAsset ?? unavailableAssetHydrator)(payload)
    })
    const digests = enumerateProfileAssetDigests(logicalDocument)
    if (digests.length !== sizes.size || digests.some((digest) => !sizes.has(digest))) {
      throw new ProfileRevisionCorruptionError('Logical Profile asset root closure is inconsistent')
    }
    return Object.freeze(digests.map((sha256) => Object.freeze({
      sha256,
      size: sizes.get(sha256)!,
    })))
  } catch (error) {
    if (error instanceof ProfileLogicalProjectionError) {
      throw new ProfileRevisionCorruptionError(error.message)
    }
    throw error
  }
}

const unavailableAssetProjector: ProfileAssetProjector = () => {
  throw new Error('SQLite Profile asset materialization is not installed')
}

const unavailableAssetHydrator: ProfileAssetHydrator = () => {
  throw new ProfileRevisionCorruptionError('SQLite Profile asset hydration is not installed')
}

function readLatestRecoveryOperation(
  runtime: SqliteRuntime,
  document: ProfileRevisionDocument,
): Pick<SqliteProfileRevisionInspection, 'latestRecovery'> {
  const row = runtime.prepare(`
SELECT operation_id, candidate_id, source_revision, observed_high_water
FROM profile_recovery_events
WHERE profile_id = ? AND revision = ?
`).get(document.head.profileId, document.head.revision)
  return row
    ? {
        latestRecovery: Object.freeze({
          operationId: readString(row, 'operation_id'),
          candidateId: readString(row, 'candidate_id'),
          sourceRevision: readInteger(row, 'source_revision'),
          observedHighWater: readInteger(row, 'observed_high_water'),
        }),
      }
    : {}
}

function seedProfile(runtime: SqliteRuntime, document: ProfileRevisionDocument, seededAt: string): void {
  const logicalRecordsById = new Map(toLogicalDocument(document).records.map((record) => (
    [record.recordId, record] as const
  )))
  const seedProfileAgentEventManifest = document.records
    .filter((record) => record.kind === 'profile-agent-event')
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((record) => Object.freeze({
      recordId: record.recordId,
      logicalRecordDigest: logicalRecordDigest(logicalRecordsById.get(record.recordId)!),
    }))
  const seedProfileAgentEventManifestJson = canonicalProfileJson(seedProfileAgentEventManifest)
  if (Buffer.byteLength(seedProfileAgentEventManifestJson, 'utf8')
    > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxProfileBytes) {
    throw new ProfileRevisionCorruptionError('SQLite Profile seed Agent event manifest exceeds its bound')
  }
  runtime.prepare(`
INSERT INTO profile_meta (
  profile_id, format, profile_version, schema_version, record_version, asset_version,
  app_version, command_version, export_version, source, current_revision, active_idea_id,
  seed_profile_agent_event_manifest_json, updated_at
) VALUES (?, 'eido-profile', ?, ?, ?, ?, ?, ?, ?, 'friends-alpha', ?, ?, ?, ?)
`).run(
    document.head.profileId,
    document.head.versions.profile,
    document.head.versions.schema,
    document.head.versions.record,
    document.head.versions.asset,
    document.head.versions.app,
    document.head.versions.command,
    document.head.versions.export,
    document.head.revision,
    document.head.activeIdeaId,
    seedProfileAgentEventManifestJson,
    seededAt,
  )
  runtime.prepare(`
INSERT INTO profile_revisions (
  profile_id, revision, previous_revision, commit_id, committed_at
) VALUES (?, ?, NULL, ?, ?)
`).run(
    document.head.profileId,
    document.head.revision,
    `seed:${document.head.profileId}:${document.head.revision}`,
    seededAt,
  )
  for (const record of document.records) insertRecord(runtime, document.head.profileId, record)
}

function readDocument(runtime: SqliteRuntime): ProfileRevisionDocument {
  const headRow = runtime.prepare('SELECT * FROM profile_meta').get()
  if (!headRow) throw new Error('SQLite Profile head is missing')
  if (readString(headRow, 'format') !== 'eido-profile' || readString(headRow, 'source') !== 'friends-alpha') {
    throw new Error('SQLite Profile authority format is unsupported')
  }
  const profileId = readString(headRow, 'profile_id')
  const records = runtime.prepare(`
SELECT record_id, kind, owner_id, parent_id, ordinal, record_version,
       created_revision, updated_revision, payload_json
FROM profile_records
WHERE profile_id = ?
ORDER BY kind, owner_id, ordinal, record_id
`).all(profileId).map((row) => readRecordRow(row))
  return {
    head: {
      profileId,
      revision: readInteger(headRow, 'current_revision'),
      versions: {
        profile: readExpectedVersion(
          headRow,
          'profile_version',
          PROFILE_CONTRACT_VERSIONS.profile,
        ),
        schema: readExpectedVersion(
          headRow,
          'schema_version',
          PROFILE_CONTRACT_VERSIONS.schema,
        ),
        record: readExpectedVersion(
          headRow,
          'record_version',
          PROFILE_CONTRACT_VERSIONS.record,
        ),
        asset: readExpectedVersion(
          headRow,
          'asset_version',
          PROFILE_CONTRACT_VERSIONS.asset,
        ),
        app: readExpectedVersion(
          headRow,
          'app_version',
          PROFILE_CONTRACT_VERSIONS.app,
        ),
        command: readExpectedVersion(
          headRow,
          'command_version',
          PROFILE_CONTRACT_VERSIONS.command,
        ),
        export: readExpectedVersion(
          headRow,
          'export_version',
          PROFILE_CONTRACT_VERSIONS.export,
        ),
      },
      activeIdeaId: readString(headRow, 'active_idea_id'),
    },
    records,
  }
}

function preflightExistingProfileVersionAxes(runtime: SqliteRuntime, hasSeed: boolean): void {
  profileAgentHistorySchemaState(runtime)
  profileGuiRecordChangeDigestSchemaState(runtime)
  const profileMetaExists = runtime.prepare(`
SELECT 1 AS present
FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_meta'
`).get()
  if (!profileMetaExists) {
    if (hasSeed) return
    throw new ProfileRevisionCorruptionError('SQLite Profile database has no authority schema')
  }
  const count = readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_meta').get(),
    'count',
  )
  if (count === 0 && hasSeed) return
  if (count !== 1) {
    throw new ProfileRevisionCorruptionError('SQLite Profile must contain exactly one authority head')
  }
  const headRow = runtime.prepare('SELECT * FROM profile_meta').get()
  for (const [key, expected] of [
    ['profile_version', PROFILE_CONTRACT_VERSIONS.profile],
    ['schema_version', PROFILE_CONTRACT_VERSIONS.schema],
    ['record_version', PROFILE_CONTRACT_VERSIONS.record],
    ['asset_version', PROFILE_CONTRACT_VERSIONS.asset],
    ['app_version', PROFILE_CONTRACT_VERSIONS.app],
    ['command_version', PROFILE_CONTRACT_VERSIONS.command],
    ['export_version', PROFILE_CONTRACT_VERSIONS.export],
  ] as const) readExpectedVersion(headRow, key, expected)
  profileAgentEventSchemaGenerationState(runtime)
}

function profileAgentHistorySchemaState(runtime: SqliteRuntime): 'missing' | 'present' {
  const rows = runtime.prepare(`
SELECT name
FROM sqlite_schema
WHERE type = 'table' AND name IN (
  'profile_agent_command_events',
  'profile_agent_command_record_changes'
)
ORDER BY name
`).all()
  if (rows.length === 0) return 'missing'
  if (rows.length === 2) return 'present'
  throw new ProfileRevisionCorruptionError('SQLite Profile Agent history schema is incomplete')
}

function profileGuiRecordChangeDigestSchemaState(runtime: SqliteRuntime): 'missing' | 'present' {
  const columns = runtime.prepare('PRAGMA table_info(profile_gui_projection_record_changes)').all()
  const names = new Set(columns.map((row) => readString(row, 'name')))
  const hasBefore = names.has('before_digest')
  const hasAfter = names.has('after_digest')
  if (!hasBefore && !hasAfter) return 'missing'
  if (hasBefore && hasAfter) return 'present'
  throw new ProfileRevisionCorruptionError('SQLite Profile GUI change-digest schema is incomplete')
}

function profileAgentEventSeedAnchorSchemaState(runtime: SqliteRuntime): 'missing' | 'present' {
  const columns = runtime.prepare('PRAGMA table_info(profile_meta)').all()
  return columns.some((row) => readString(row, 'name') === 'seed_profile_agent_event_manifest_json')
    ? 'present'
    : 'missing'
}

function profileAgentEventSchemaGenerationState(
  runtime: SqliteRuntime,
): 'shipped-v1' | 'current' {
  const manifestState = profileAgentEventSeedAnchorSchemaState(runtime)
  const recordKindState = profileAgentEventRecordKindSchemaState(runtime)
  const pairGeneration = manifestState === 'missing' && recordKindState === 'shipped-v1'
    ? 'shipped-v1'
    : manifestState === 'present' && recordKindState === 'current'
      ? 'current'
      : undefined
  if (pairGeneration === undefined) {
    throw new ProfileRevisionCorruptionError(
      'SQLite Profile seed Agent event manifest is incompatible with its record-kind schema',
    )
  }
  if (profileAgentHistorySchemaState(runtime) === 'missing') return pairGeneration
  const agentGeneration = agentHistoryV2SchemaState(runtime) === 'missing'
    ? 'shipped-v1'
    : 'current'
  if (pairGeneration === agentGeneration) return pairGeneration
  throw new ProfileRevisionCorruptionError(
    'SQLite Profile Agent history schema generations are incompatible',
  )
}

function ensureProfileAgentEventSeedAnchorSchema(runtime: SqliteRuntime): void {
  if (profileAgentEventSeedAnchorSchemaState(runtime) === 'present') return
  runtime.exec(`
ALTER TABLE profile_meta
  ADD COLUMN seed_profile_agent_event_manifest_json TEXT NOT NULL DEFAULT '[]';
`)
  if (profileAgentEventSeedAnchorSchemaState(runtime) !== 'present') {
    throw new ProfileRevisionCorruptionError('SQLite Profile seed Agent event anchor migration failed')
  }
}

function ensureGuiRecordChangeDigestSchema(runtime: SqliteRuntime): void {
  if (profileGuiRecordChangeDigestSchemaState(runtime) === 'present') return
  runtime.exec(`
ALTER TABLE profile_gui_projection_record_changes ADD COLUMN before_digest TEXT;
ALTER TABLE profile_gui_projection_record_changes ADD COLUMN after_digest TEXT;
`)
  if (profileGuiRecordChangeDigestSchemaState(runtime) !== 'present') {
    throw new ProfileRevisionCorruptionError('SQLite Profile GUI change-digest migration failed')
  }
}

function profileAgentEventRecordKindSchemaState(
  runtime: SqliteRuntime,
): 'shipped-v1' | 'current' | 'incompatible' {
  const row = runtime.prepare(`
SELECT sql
FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_records'
`).get()
  const sql = readString(row, 'sql')
  const kindClause = /\bkind\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*kind\s+IN\s*\(([\s\S]*?)\)\s*\)/
    .exec(sql)?.[1]
  if (kindClause === undefined) return 'incompatible'
  const kinds = [...kindClause.matchAll(/'([^']+)'/g)].map((match) => match[1]!)
  if (kindClause.replace(/'[^']+'/g, '').replace(/[\s,]/g, '').length > 0
    || new Set(kinds).size !== kinds.length) return 'incompatible'
  const currentKinds = [...PROFILE_QUERYABLE_RECORD_KINDS]
  if (sameStringSet(kinds, currentKinds)) return 'current'
  if (sameStringSet(
    kinds,
    currentKinds.filter((kind) => kind !== 'profile-agent-event'),
  )) return 'shipped-v1'
  return 'incompatible'
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right)
  return left.length === right.length && left.every((value) => rightSet.has(value))
}

function ensureProfileAgentEventRecordKindSchema(runtime: SqliteRuntime): void {
  const state = profileAgentEventRecordKindSchemaState(runtime)
  if (state === 'current') return
  if (state !== 'shipped-v1') {
    throw new ProfileRevisionCorruptionError('SQLite Profile record-kind schema is incompatible')
  }
  runtime.exec(`
CREATE TABLE profile_records_v2 (
  profile_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'profile', 'compatibility-state', 'idea', 'board', 'card', 'block',
    'logical-asset', 'mod-instance', 'connection', 'output', 'output-version',
    'transcript-message', 'follow-up-message', 'run', 'intent-event', 'board-settings',
    'highlight', 'highlight-tag', 'compaction-summary', 'mod-template',
    'profile-agent-event', 'profile-setting', 'migration-ledger-entry'
  )),
  owner_id TEXT NOT NULL,
  parent_id TEXT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  record_version INTEGER NOT NULL CHECK (record_version = ${PROFILE_CONTRACT_VERSIONS.record}),
  created_revision INTEGER NOT NULL CHECK (created_revision >= 0),
  updated_revision INTEGER NOT NULL CHECK (updated_revision >= created_revision),
  payload_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, record_id),
  FOREIGN KEY (profile_id, created_revision)
    REFERENCES profile_revisions(profile_id, revision),
  FOREIGN KEY (profile_id, updated_revision)
    REFERENCES profile_revisions(profile_id, revision)
);
INSERT INTO profile_records_v2 (
  profile_id, record_id, kind, owner_id, parent_id, ordinal, record_version,
  created_revision, updated_revision, payload_json
)
SELECT
  profile_id, record_id, kind, owner_id, parent_id, ordinal, record_version,
  created_revision, updated_revision, payload_json
FROM profile_records;
DROP TABLE profile_records;
ALTER TABLE profile_records_v2 RENAME TO profile_records;
CREATE INDEX profile_records_owner_order
  ON profile_records(profile_id, kind, owner_id, ordinal);
CREATE INDEX profile_records_revision
  ON profile_records(profile_id, updated_revision);
`)
  if (profileAgentEventRecordKindSchemaState(runtime) !== 'current') {
    throw new ProfileRevisionCorruptionError('SQLite Profile record-kind migration failed')
  }
}

function ensureAgentHistoryV2Schema(runtime: SqliteRuntime): void {
  if (agentHistoryV2SchemaState(runtime) === 'missing') {
    runtime.exec(`
ALTER TABLE profile_agent_command_events
  ADD COLUMN installed_surface_version INTEGER NOT NULL DEFAULT 1
  CHECK (installed_surface_version IN (1, 2, 3));
ALTER TABLE profile_agent_command_events
  ADD COLUMN profile_agent_event_ids_json TEXT NOT NULL DEFAULT '[]';
`)
  }
  if (agentHistoryV2SchemaState(runtime) !== 'present') {
    throw new ProfileRevisionCorruptionError('SQLite Profile Agent history v2 schema migration failed')
  }
  const constraint = agentHistorySurfaceConstraintState(runtime)
  if (constraint === 'v3' || constraint === 'v4' || constraint === 'v5') return
  if (constraint !== 'v2') {
    throw new ProfileRevisionCorruptionError('SQLite Profile Agent surface constraint is incompatible')
  }
  rebuildAgentHistorySurfaceConstraint(runtime, 3)
  if (agentHistorySurfaceConstraintState(runtime) !== 'v3') {
    throw new ProfileRevisionCorruptionError('SQLite Profile Agent history v3 schema migration failed')
  }
}

function ensureAgentHistorySurfaceV4Schema(runtime: SqliteRuntime): void {
  const constraint = agentHistorySurfaceConstraintState(runtime)
  if (constraint === 'v4') return
  if (constraint !== 'v3') {
    throw new ProfileRevisionCorruptionError('SQLite Profile Agent surface constraint is incompatible')
  }
  rebuildAgentHistorySurfaceConstraint(runtime, 4)
  if (agentHistorySurfaceConstraintState(runtime) !== 'v4') {
    throw new ProfileRevisionCorruptionError('SQLite Profile Agent history v4 schema migration failed')
  }
}

function ensureAgentHistorySurfaceV5Schema(runtime: SqliteRuntime): void {
  const constraint = agentHistorySurfaceConstraintState(runtime)
  if (constraint === 'v5') return
  if (constraint !== 'v3' && constraint !== 'v4') {
    throw new ProfileRevisionCorruptionError('SQLite Profile Agent surface constraint is incompatible')
  }
  rebuildAgentHistorySurfaceConstraint(runtime, 5)
  if (agentHistorySurfaceConstraintState(runtime) !== 'v5') {
    throw new ProfileRevisionCorruptionError('SQLite Profile Agent history v5 schema migration failed')
  }
}

function agentHistoryV2SchemaState(runtime: SqliteRuntime): 'missing' | 'present' {
  const names = new Set(runtime.prepare(`
PRAGMA table_info(profile_agent_command_events)
`).all().map((row) => readString(row, 'name')))
  const hasSurfaceVersion = names.has('installed_surface_version')
  const hasProfileEventIds = names.has('profile_agent_event_ids_json')
  if (hasSurfaceVersion && hasProfileEventIds) return 'present'
  if (hasSurfaceVersion || hasProfileEventIds) {
    throw new ProfileRevisionCorruptionError('SQLite Profile Agent history v2 schema is incomplete')
  }
  return 'missing'
}

function agentHistorySurfaceConstraintState(
  runtime: SqliteRuntime,
): 'v2' | 'v3' | 'v4' | 'v5' | 'incompatible' {
  const row = runtime.prepare(`
SELECT sql FROM sqlite_master
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get()
  if (!row) return 'incompatible'
  const normalized = readString(row, 'sql')
    .toLowerCase()
    .replace(/[\s"`\[\]]/g, '')
  if (normalized.includes('check(installed_surface_versionin(1,2,3,4,5))')) return 'v5'
  if (normalized.includes('check(installed_surface_versionin(1,2,3,4))')) return 'v4'
  if (normalized.includes('check(installed_surface_versionin(1,2,3))')) return 'v3'
  if (normalized.includes('check(installed_surface_versionin(1,2))')) return 'v2'
  return 'incompatible'
}

function rebuildAgentHistorySurfaceConstraint(
  runtime: SqliteRuntime,
  targetVersion: 3 | 4 | 5,
): void {
  const suffix = targetVersion === 3 ? 'v3' : targetVersion === 4 ? 'v4' : 'v5'
  const allowedVersions = targetVersion === 3
    ? '1, 2, 3'
    : targetVersion === 4
      ? '1, 2, 3, 4'
      : '1, 2, 3, 4, 5'
  const parentCount = readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_agent_command_events').get(),
    'count',
  )
  const childCount = readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_agent_command_record_changes').get(),
    'count',
  )
  runtime.exec(`
CREATE TABLE profile_agent_command_events_${suffix} (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version = 1),
  installed_surface_version INTEGER NOT NULL DEFAULT 1
    CHECK (installed_surface_version IN (${allowedVersions})),
  idempotency_key TEXT NOT NULL UNIQUE,
  client_txn_id TEXT NOT NULL UNIQUE,
  trusted_actor_id TEXT NOT NULL,
  actor_transport TEXT NOT NULL CHECK (actor_transport IN ('cli', 'mcp')),
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  changes_digest TEXT NOT NULL,
  intent_event_ids_json TEXT NOT NULL,
  profile_agent_event_ids_json TEXT NOT NULL DEFAULT '[]',
  command_bindings_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, revision),
  FOREIGN KEY (profile_id, revision)
    REFERENCES profile_revisions(profile_id, revision)
);
INSERT INTO profile_agent_command_events_${suffix} (
  profile_id, revision, version, installed_surface_version, idempotency_key,
  client_txn_id, trusted_actor_id, actor_transport, request_digest, request_json,
  receipt_digest, receipt_json, changes_digest, intent_event_ids_json,
  profile_agent_event_ids_json, command_bindings_json, committed_at
)
SELECT
  profile_id, revision, version, installed_surface_version, idempotency_key,
  client_txn_id, trusted_actor_id, actor_transport, request_digest, request_json,
  receipt_digest, receipt_json, changes_digest, intent_event_ids_json,
  profile_agent_event_ids_json, command_bindings_json, committed_at
FROM profile_agent_command_events;

CREATE TABLE profile_agent_command_record_changes_${suffix} (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  record_id TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('insert', 'update', 'delete')),
  before_json TEXT,
  after_json TEXT,
  PRIMARY KEY (profile_id, revision, record_id),
  FOREIGN KEY (profile_id, revision)
    REFERENCES profile_agent_command_events_${suffix}(profile_id, revision),
  CHECK (
    (change_kind = 'insert' AND before_json IS NULL AND after_json IS NOT NULL)
    OR (change_kind = 'update' AND before_json IS NOT NULL AND after_json IS NOT NULL)
    OR (change_kind = 'delete' AND before_json IS NOT NULL AND after_json IS NULL)
  )
);
INSERT INTO profile_agent_command_record_changes_${suffix} (
  profile_id, revision, record_id, change_kind, before_json, after_json
)
SELECT profile_id, revision, record_id, change_kind, before_json, after_json
FROM profile_agent_command_record_changes;
`)
  const copiedParentCount = readInteger(
    runtime.prepare(`SELECT COUNT(*) AS count FROM profile_agent_command_events_${suffix}`).get(),
    'count',
  )
  const copiedChildCount = readInteger(
    runtime.prepare(`SELECT COUNT(*) AS count FROM profile_agent_command_record_changes_${suffix}`).get(),
    'count',
  )
  if (copiedParentCount !== parentCount || copiedChildCount !== childCount
    || agentHistoryRowsDiffer(runtime, 'profile_agent_command_events', `profile_agent_command_events_${suffix}`, [
      'profile_id', 'revision', 'version', 'installed_surface_version', 'idempotency_key',
      'client_txn_id', 'trusted_actor_id', 'actor_transport', 'request_digest', 'request_json',
      'receipt_digest', 'receipt_json', 'changes_digest', 'intent_event_ids_json',
      'profile_agent_event_ids_json', 'command_bindings_json', 'committed_at',
    ])
    || agentHistoryRowsDiffer(
      runtime,
      'profile_agent_command_record_changes',
      `profile_agent_command_record_changes_${suffix}`,
      ['profile_id', 'revision', 'record_id', 'change_kind', 'before_json', 'after_json'],
    )) {
    throw new ProfileRevisionCorruptionError('SQLite Profile Agent history migration changed evidence')
  }
  runtime.exec(`
DROP TABLE profile_agent_command_record_changes;
DROP TABLE profile_agent_command_events;
ALTER TABLE profile_agent_command_events_${suffix} RENAME TO profile_agent_command_events;
ALTER TABLE profile_agent_command_record_changes_${suffix} RENAME TO profile_agent_command_record_changes;
`)
  if (runtime.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new ProfileRevisionCorruptionError('SQLite Profile Agent history migration broke foreign keys')
  }
}

function agentHistoryRowsDiffer(
  runtime: SqliteRuntime,
  leftTable: string,
  rightTable: string,
  columns: readonly string[],
): boolean {
  const projection = columns.join(', ')
  return runtime.prepare(`
SELECT 1 AS differs FROM (
  SELECT ${projection} FROM ${leftTable}
  EXCEPT
  SELECT ${projection} FROM ${rightTable}
) LIMIT 1
`).get() !== undefined || runtime.prepare(`
SELECT 1 AS differs FROM (
  SELECT ${projection} FROM ${rightTable}
  EXCEPT
  SELECT ${projection} FROM ${leftTable}
) LIMIT 1
`).get() !== undefined
}

function validateRevisionHistory(
  runtime: SqliteRuntime,
  document: ProfileRevisionDocument,
  options: Readonly<{ allowMissingAgentSchema?: boolean }> = {},
): void {
  const profileCount = readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_meta').get(),
    'count',
  )
  if (profileCount !== 1) {
    throw new ProfileRevisionCorruptionError('SQLite Profile must contain exactly one authority head')
  }
  const profileAgentEventSchemaGeneration = profileAgentEventSchemaGenerationState(runtime)
  const anchoredSeedProfileAgentEventManifest = profileAgentEventSchemaGeneration === 'current'
    ? readSeedProfileAgentEventManifest(runtime, document.records.length)
    : Object.freeze([])
  const agentSchemaPresent = profileAgentHistorySchemaState(runtime) === 'present'
  const agentHistoryV2SchemaPresent = agentSchemaPresent
    && agentHistoryV2SchemaState(runtime) === 'present'
  if (!agentSchemaPresent && options.allowMissingAgentSchema !== true) {
    throw new ProfileRevisionCorruptionError('SQLite Profile Agent history schema is missing')
  }
  const guiDigestSchemaPresent = profileGuiRecordChangeDigestSchemaState(runtime) === 'present'
  if (agentSchemaPresent && !guiDigestSchemaPresent) {
    throw new ProfileRevisionCorruptionError('SQLite Profile GUI change-digest schema is missing')
  }
  const recoveryRows = runtime.prepare(`
SELECT revision, candidate_id, source_revision, observed_high_water,
       operation_id, recovered_at
FROM profile_recovery_events
WHERE profile_id = ?
`).all(document.head.profileId)
  const totalRecoveryRows = readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_recovery_events').get(),
    'count',
  )
  if (totalRecoveryRows !== recoveryRows.length) {
    throw new ProfileRevisionCorruptionError('SQLite Profile contains foreign recovery history')
  }
  const recoveryByRevision = new Map<number, SqliteRow>()
  for (const row of recoveryRows) {
    const revision = readInteger(row, 'revision')
    if (recoveryByRevision.has(revision)) {
      throw new ProfileRevisionCorruptionError('SQLite Profile recovery revisions are duplicated')
    }
    recoveryByRevision.set(revision, row)
  }
  const lifecycleRows = runtime.prepare(`
SELECT revision, kind, operation_id, idempotency_key, request_digest,
       request_json, receipt_json, inserted_record_ids_json, committed_at
FROM profile_lifecycle_events
WHERE profile_id = ?
`).all(document.head.profileId)
  const totalLifecycleRows = readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_lifecycle_events').get(),
    'count',
  )
  if (totalLifecycleRows !== lifecycleRows.length) {
    throw new ProfileRevisionCorruptionError('SQLite Profile contains foreign lifecycle history')
  }
  let logicalRecordsById: ReadonlyMap<string, ProfileLogicalRecordSpec> | undefined
  const lifecycleByRevision = new Map<number, SqliteRow>()
  for (const row of lifecycleRows) {
    const revision = readInteger(row, 'revision')
    if (lifecycleByRevision.has(revision) || recoveryByRevision.has(revision)) {
      throw new ProfileRevisionCorruptionError('SQLite Profile lifecycle revisions are duplicated or ambiguous')
    }
    lifecycleByRevision.set(revision, row)
  }
  const guiRows = runtime.prepare(`
SELECT revision, generation, client_txn_id, idempotency_key, request_digest,
       request_json, receipt_json, changed_record_ids_json,
       appended_intent_event_ids_json, authorization_ids_json,
       committed_at, trusted_actor_id
FROM profile_gui_projection_events
WHERE profile_id = ?
`).all(document.head.profileId)
  const totalGuiRows = readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_gui_projection_events').get(),
    'count',
  )
  if (totalGuiRows !== guiRows.length) {
    throw new ProfileRevisionCorruptionError('SQLite Profile contains foreign GUI projection history')
  }
  const guiByRevision = new Map<number, SqliteRow>()
  for (const row of guiRows) {
    const revision = readInteger(row, 'revision')
    if (guiByRevision.has(revision)
      || recoveryByRevision.has(revision)
      || lifecycleByRevision.has(revision)) {
      throw new ProfileRevisionCorruptionError('SQLite Profile GUI revisions are duplicated or ambiguous')
    }
    guiByRevision.set(revision, row)
  }
  const guiRecordChangeRows = runtime.prepare(`
SELECT revision, record_id, change_kind,
       ${guiDigestSchemaPresent ? 'before_digest, after_digest' : 'NULL AS before_digest, NULL AS after_digest'}
FROM profile_gui_projection_record_changes
WHERE profile_id = ?
`).all(document.head.profileId)
  const totalGuiRecordChangeRows = readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_gui_projection_record_changes').get(),
    'count',
  )
  if (totalGuiRecordChangeRows !== guiRecordChangeRows.length) {
    throw new ProfileRevisionCorruptionError('SQLite Profile contains foreign GUI record-change history')
  }
  const guiRecordChangesByRevision = new Map<number, SqliteRow[]>()
  for (const row of guiRecordChangeRows) {
    const revision = readInteger(row, 'revision')
    const recordId = readString(row, 'record_id')
    const changeKind = readString(row, 'change_kind')
    const beforeDigest = readColumn(row, 'before_digest')
    const afterDigest = readColumn(row, 'after_digest')
    const legacyBarrier = beforeDigest === null && afterDigest === null
    const validDigestShape = legacyBarrier
      || (changeKind === 'insert' && beforeDigest === null && validSha256(afterDigest))
      || (changeKind === 'update' && validSha256(beforeDigest) && validSha256(afterDigest))
      || (changeKind === 'delete' && validSha256(beforeDigest) && afterDigest === null)
    if (!guiByRevision.has(revision)
      || recordId.length === 0
      || (changeKind !== 'insert' && changeKind !== 'update' && changeKind !== 'delete')
      || !validDigestShape) {
      throw new ProfileRevisionCorruptionError('SQLite Profile GUI record-change history is invalid')
    }
    const changes = guiRecordChangesByRevision.get(revision) ?? []
    changes.push(row)
    guiRecordChangesByRevision.set(revision, changes)
  }
  const agentEvidenceSizeRows = agentSchemaPresent ? runtime.prepare(`
SELECT revision,
       length(CAST(request_json AS BLOB)) AS request_bytes,
       length(CAST(receipt_json AS BLOB)) AS receipt_bytes,
       length(CAST(intent_event_ids_json AS BLOB)) AS intent_ids_bytes,
       length(CAST(${agentHistoryV2SchemaPresent
    ? 'profile_agent_event_ids_json'
    : "'[]'"} AS BLOB)) AS profile_event_ids_bytes,
       length(CAST(command_bindings_json AS BLOB)) AS bindings_bytes
FROM profile_agent_command_events
WHERE profile_id = ?
`).all(document.head.profileId) : []
  validateAgentEventEvidenceBounds(agentEvidenceSizeRows)
  const agentRows = agentSchemaPresent ? runtime.prepare(`
SELECT agent.revision, revisions.previous_revision, revisions.commit_id,
       revisions.committed_at AS revision_committed_at,
       revisions.actor_id AS revision_actor_id,
       revisions.actor_kind AS revision_actor_kind,
       revisions.actor_transport AS revision_actor_transport,
       revisions.client_txn_id AS revision_client_txn_id,
       revisions.idempotency_key AS revision_idempotency_key,
       revisions.batch_digest AS revision_batch_digest,
       revisions.batch_json AS revision_batch_json,
       revisions.receipt_json AS revision_receipt_json,
       agent.version,
       ${agentHistoryV2SchemaPresent
    ? 'agent.installed_surface_version'
    : '1 AS installed_surface_version'},
       agent.idempotency_key, agent.client_txn_id,
       agent.trusted_actor_id, agent.actor_transport, agent.request_digest,
       agent.request_json, agent.receipt_digest, agent.receipt_json,
       agent.changes_digest, agent.intent_event_ids_json,
       ${agentHistoryV2SchemaPresent
    ? 'agent.profile_agent_event_ids_json'
    : "'[]' AS profile_agent_event_ids_json"},
       agent.command_bindings_json, agent.committed_at
FROM profile_agent_command_events AS agent
JOIN profile_revisions AS revisions
  ON revisions.profile_id = agent.profile_id AND revisions.revision = agent.revision
WHERE agent.profile_id = ?
`).all(document.head.profileId) : []
  const totalAgentRows = agentSchemaPresent ? readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_agent_command_events').get(),
    'count',
  ) : 0
  if (totalAgentRows !== agentRows.length) {
    throw new ProfileRevisionCorruptionError('SQLite Profile contains foreign Agent command history')
  }
  const agentByRevision = new Map<number, SqliteRow>()
  for (const row of agentRows) {
    const revision = readInteger(row, 'revision')
    if (agentByRevision.has(revision)
      || recoveryByRevision.has(revision)
      || lifecycleByRevision.has(revision)
      || guiByRevision.has(revision)) {
      throw new ProfileRevisionCorruptionError('SQLite Profile Agent revisions are duplicated or ambiguous')
    }
    agentByRevision.set(revision, row)
  }
  const agentRecordChangeSizeRows = agentSchemaPresent ? runtime.prepare(`
SELECT revision, record_id, change_kind,
       CASE WHEN before_json IS NULL THEN 4 ELSE length(CAST(before_json AS BLOB)) END AS before_bytes,
       CASE WHEN after_json IS NULL THEN 4 ELSE length(CAST(after_json AS BLOB)) END AS after_bytes
FROM profile_agent_command_record_changes
WHERE profile_id = ?
`).all(document.head.profileId) : []
  validateAgentDurableChangeEvidenceBounds(agentRecordChangeSizeRows, agentByRevision)
  const agentRecordChangeRows = agentSchemaPresent ? runtime.prepare(`
SELECT revision, record_id, change_kind, before_json, after_json
FROM profile_agent_command_record_changes
WHERE profile_id = ?
`).all(document.head.profileId) : []
  const totalAgentRecordChangeRows = agentSchemaPresent ? readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_agent_command_record_changes').get(),
    'count',
  ) : 0
  if (totalAgentRecordChangeRows !== agentRecordChangeRows.length) {
    throw new ProfileRevisionCorruptionError('SQLite Profile contains foreign Agent record-change history')
  }
  const agentRecordChangesByRevision = new Map<number, SqliteRow[]>()
  for (const row of agentRecordChangeRows) {
    const revision = readInteger(row, 'revision')
    const recordId = readString(row, 'record_id')
    const changeKind = readString(row, 'change_kind')
    if (!agentByRevision.has(revision)
      || recordId.length === 0
      || (changeKind !== 'insert' && changeKind !== 'update' && changeKind !== 'delete')) {
      throw new ProfileRevisionCorruptionError('SQLite Profile Agent record-change history is invalid')
    }
    const changes = agentRecordChangesByRevision.get(revision) ?? []
    changes.push(row)
    agentRecordChangesByRevision.set(revision, changes)
  }
  const authorizationRows = runtime.prepare(`
SELECT authorization_id, profile_id, base_revision, idea_id, board_id,
       created_at, expires_at, consumed_revision, consumed_idempotency_key
FROM profile_gui_idea_authorizations
WHERE profile_id = ?
`).all(document.head.profileId)
  const totalAuthorizationRows = readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_gui_idea_authorizations').get(),
    'count',
  )
  if (totalAuthorizationRows !== authorizationRows.length) {
    throw new ProfileRevisionCorruptionError('SQLite Profile contains foreign GUI Idea authorization history')
  }
  const authorizationById = new Map<string, SqliteRow>()
  for (const row of authorizationRows) {
    const authorizationId = readString(row, 'authorization_id')
    const profileId = readString(row, 'profile_id')
    const baseRevision = readInteger(row, 'base_revision')
    const ideaId = readString(row, 'idea_id')
    const boardId = readString(row, 'board_id')
    const createdAt = readString(row, 'created_at')
    const expiresAt = readString(row, 'expires_at')
    const consumedRevisionColumn = readColumn(row, 'consumed_revision')
    const consumedKeyColumn = readColumn(row, 'consumed_idempotency_key')
    if (authorizationById.has(authorizationId)
      || profileId !== document.head.profileId
      || baseRevision > document.head.revision
      || boardId !== `board:${ideaId}`
      || !canonicalTimestamp(createdAt)
      || !canonicalTimestamp(expiresAt)
      || Date.parse(createdAt) >= Date.parse(expiresAt)
      || consumedRevisionColumn === undefined
      || consumedKeyColumn === undefined
      || (consumedRevisionColumn === null) !== (consumedKeyColumn === null)
      || (consumedRevisionColumn !== null
        && (!nonNegativeSafeInteger(consumedRevisionColumn)
          || !nonEmptyString(consumedKeyColumn)))) {
      throw new ProfileRevisionCorruptionError('SQLite Profile GUI Idea authorization is invalid')
    }
    authorizationById.set(authorizationId, row)
  }
  if (lifecycleRows.length > 0 || guiRows.length > 0 || agentRows.length > 0) {
    try {
      const logicalDocument = validatedLogicalDocument(document)
      logicalRecordsById = new Map(logicalDocument.records.map((record) => [record.recordId, record] as const))
    } catch (error) {
      if (error instanceof ProfileLogicalProjectionError) {
        throw new ProfileRevisionCorruptionError(error.message)
      }
      throw error
    }
  }
  const guiReceiptByRevision = new Map<number, SqliteProfileGuiProjectionCommitReceipt>()
  const guiDeletionRevisionsByRecordId = new Map<string, number[]>()
  for (const row of guiRows) {
    const revision = readInteger(row, 'revision')
    const receipt = parseGuiProjectionReceipt(readString(row, 'receipt_json'), row, document)
    guiReceiptByRevision.set(revision, receipt)
    for (const recordId of receipt.deletedRecordIds) {
      const deletionRevisions = guiDeletionRevisionsByRecordId.get(recordId) ?? []
      deletionRevisions.push(revision)
      guiDeletionRevisionsByRecordId.set(recordId, deletionRevisions)
    }
  }
  const agentReceiptByRevision = new Map<number, ProfileAgentCommandBatchReceipt>()
  const agentChangesByRevision = new Map<number, readonly DurableRecordTransition[]>()
  const agentDeletionRevisionsByRecordId = new Map<string, number[]>()
  for (const [revision, row] of agentByRevision) {
    agentReceiptByRevision.set(revision, parseAgentCommandReceipt(row, document))
    const changes = parseAgentRecordChanges(agentRecordChangesByRevision.get(revision) ?? [])
    const changesJson = canonicalProfileJson(changes)
    if (profileAgentRequestDigest(changesJson) !== readString(row, 'changes_digest')) {
      throw new ProfileRevisionCorruptionError('Profile Agent record-change digest is invalid')
    }
    agentChangesByRevision.set(revision, changes)
    for (const change of changes) {
      if (change.changeKind !== 'delete') continue
      const recordId = change.recordId
      const deletionRevisions = agentDeletionRevisionsByRecordId.get(recordId) ?? []
      deletionRevisions.push(revision)
      agentDeletionRevisionsByRecordId.set(recordId, deletionRevisions)
    }
  }
  const recordWasDeletedAfter = (recordId: string, revision: number): boolean => (
    guiDeletionRevisionsByRecordId.get(recordId)?.some(
      (deletionRevision) => deletionRevision > revision,
    ) === true
    || agentDeletionRevisionsByRecordId.get(recordId)?.some(
      (deletionRevision) => deletionRevision > revision,
    ) === true
  )
  const revisions = runtime.prepare(`
SELECT revision, previous_revision, commit_id, committed_at,
       actor_id, actor_kind, actor_transport, client_txn_id, idempotency_key,
       batch_digest, batch_json, receipt_json
FROM profile_revisions
WHERE profile_id = ?
ORDER BY revision
`).all(document.head.profileId)
  const totalRevisions = readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_revisions').get(),
    'count',
  )
  const totalRecords = readInteger(
    runtime.prepare('SELECT COUNT(*) AS count FROM profile_records').get(),
    'count',
  )
  if (totalRevisions !== revisions.length || totalRecords !== document.records.length) {
    throw new ProfileRevisionCorruptionError('SQLite Profile contains records outside its authority head')
  }
  if (revisions.length === 0) {
    throw new ProfileRevisionCorruptionError('SQLite Profile revision history is missing')
  }
  const seed = revisions[0]!
  const seedRevision = readInteger(seed, 'revision')
  if (
    readColumn(seed, 'previous_revision') !== null
    || readString(seed, 'commit_id') !== `seed:${document.head.profileId}:${seedRevision}`
    || readString(seed, 'committed_at').length === 0
    || recoveryByRevision.has(seedRevision)
    || lifecycleByRevision.has(seedRevision)
    || guiByRevision.has(seedRevision)
    || agentByRevision.has(seedRevision)
    || !revisionPayloadColumnsAreNull(seed)
  ) throw new ProfileRevisionCorruptionError('SQLite Profile seed revision is invalid')

  let nextProfileAgentEventOrdinal = 0
  let maximumProfileAgentEventSequence = 0
  const seedProfileAgentEvents = document.records.filter((record) => (
    record.kind === 'profile-agent-event' && record.createdRevision === seedRevision
  )).sort((left, right) => left.ordinal - right.ordinal)
  const logicalSeedRecordsById = new Map(toLogicalDocument(document).records.map((record) => (
    [record.recordId, record] as const
  )))
  const observedSeedProfileAgentEventManifest = seedProfileAgentEvents.map((event) => Object.freeze({
    recordId: event.recordId,
    logicalRecordDigest: logicalRecordDigest(logicalSeedRecordsById.get(event.recordId)!),
  }))
  if (canonicalProfileJson(observedSeedProfileAgentEventManifest)
    !== canonicalProfileJson(anchoredSeedProfileAgentEventManifest)) {
    throw new ProfileRevisionCorruptionError('SQLite Profile seed Agent event identity anchor is invalid')
  }
  for (const event of seedProfileAgentEvents) {
    const decoded = decodeProfileAgentEventRecord({
      recordId: event.recordId,
      kind: event.kind,
      ownerId: event.ownerId,
      parentId: event.parentId,
      recordVersion: PROFILE_AGENT_EVENT_RECORD_VERSION,
      payload: event.payload,
    })
    if (!decoded.ok
      || decoded.value.ownerId !== document.head.profileId
      || event.ordinal !== nextProfileAgentEventOrdinal
      || event.updatedRevision !== seedRevision
      || decoded.value.payload.seq <= maximumProfileAgentEventSequence) {
      throw new ProfileRevisionCorruptionError('SQLite Profile seed Agent event order is invalid')
    }
    nextProfileAgentEventOrdinal += 1
    maximumProfileAgentEventSequence = decoded.value.payload.seq
  }

  let previousRevision = seedRevision
  const claimedIntentEventIds = new Set<string>()
  const claimedProfileAgentEventIds = new Set<string>()
  const claimedAuthorizationIds = new Set<string>()
  const claimedIdempotencyKeys = new Set<string>()
  const agentModStampProvenanceClaims: AgentModStampProvenanceClaim[] = []
  const opaqueTransitionRevisionsByRecordId = new Map<string, number[]>()
  const rememberOpaqueTransition = (recordId: string, revision: number): void => {
    const revisions = opaqueTransitionRevisionsByRecordId.get(recordId) ?? []
    revisions.push(revision)
    opaqueTransitionRevisionsByRecordId.set(recordId, revisions)
  }
  const claimIdempotencyKey = (key: string): void => {
    if (key.length === 0 || claimedIdempotencyKeys.has(key)) {
      throw new ProfileRevisionCorruptionError('SQLite Profile idempotency evidence is ambiguous')
    }
    claimedIdempotencyKeys.add(key)
  }
  for (const row of revisions.slice(1)) {
    const revision = readInteger(row, 'revision')
    const persistedPrevious = readInteger(row, 'previous_revision')
    const recovery = recoveryByRevision.get(revision)
    const lifecycle = lifecycleByRevision.get(revision)
    const gui = guiByRevision.get(revision)
    const agent = agentByRevision.get(revision)
    if (recovery) {
      const sourceRevision = readInteger(recovery, 'source_revision')
      const highWater = readInteger(recovery, 'observed_high_water')
      const operationId = readString(recovery, 'operation_id')
      const recoveredAt = readString(recovery, 'recovered_at')
      if (
        persistedPrevious !== previousRevision
        || sourceRevision !== previousRevision
        || highWater < sourceRevision
        || revision !== highWater + 1
        || readString(recovery, 'candidate_id').length === 0
        || readString(row, 'commit_id') !== `recovery:${operationId}`
        || readString(row, 'committed_at') !== recoveredAt
        || readString(row, 'actor_id') !== 'profile-recovery'
        || readString(row, 'actor_kind') !== 'system'
        || readString(row, 'client_txn_id') !== operationId
        || readColumn(row, 'actor_transport') !== null
        || readColumn(row, 'idempotency_key') !== null
        || readColumn(row, 'batch_digest') !== null
        || readColumn(row, 'batch_json') !== null
        || readColumn(row, 'receipt_json') !== null
      ) throw new ProfileRevisionCorruptionError('SQLite Profile recovery revision is invalid')
    } else if (lifecycle) {
      claimIdempotencyKey(readString(lifecycle, 'idempotency_key'))
      const operationId = readString(lifecycle, 'operation_id')
      const committedAt = readString(lifecycle, 'committed_at')
      const kind = readString(lifecycle, 'kind')
      const requestJson = readString(lifecycle, 'request_json')
      const insertedJson = readString(lifecycle, 'inserted_record_ids_json')
      const insertedIds = parseJson(insertedJson, 'Profile lifecycle inserted IDs')
      if (
        revision !== previousRevision + 1
        || persistedPrevious !== previousRevision
        || (kind !== 'duplicate-idea' && kind !== 'import-idea')
        || readString(row, 'commit_id') !== `lifecycle:${operationId}`
        || readString(row, 'committed_at') !== committedAt
        || readString(row, 'actor_id') !== 'profile-lifecycle'
        || readString(row, 'actor_kind') !== 'system'
        || readString(row, 'client_txn_id') !== operationId
        || readColumn(row, 'actor_transport') !== null
        || readColumn(row, 'idempotency_key') !== null
        || readColumn(row, 'batch_digest') !== null
        || readColumn(row, 'batch_json') !== null
        || readColumn(row, 'receipt_json') !== null
        || createHash('sha256').update(requestJson).digest('hex') !== readString(lifecycle, 'request_digest')
        || canonicalProfileJson(parseJson(requestJson, 'Profile lifecycle request')) !== requestJson
        || !isNonEmptyStringArray(insertedIds)
        || canonicalProfileJson([...insertedIds].sort()) !== insertedJson
      ) throw new ProfileRevisionCorruptionError('SQLite Profile lifecycle revision is invalid')
      const receipt = parseLifecycleReceipt(readString(lifecycle, 'receipt_json'), lifecycle, document)
      for (const recordId of receipt.insertedRecordIds) rememberOpaqueTransition(recordId, revision)
      if (receipt.kind !== kind || canonicalProfileJson(receipt.insertedRecordIds) !== insertedJson) {
        throw new ProfileRevisionCorruptionError('SQLite Profile lifecycle receipt evidence is invalid')
      }
      const insertedRecords: ProfileLogicalRecordSpec[] = []
      let insertionHasMissingRecords = false
      let insertionHasUpdatedRecords = false
      for (const recordId of receipt.insertedRecordIds) {
        const record = document.records.find((candidate) => candidate.recordId === recordId)
        const logicalRecord = logicalRecordsById?.get(recordId)
        if (!record || !logicalRecord) {
          if (!recordWasDeletedAfter(recordId, revision)) {
            throw new ProfileRevisionCorruptionError('SQLite Profile lifecycle record evidence is invalid')
          }
          insertionHasMissingRecords = true
          continue
        }
        if (record.createdRevision !== revision || record.updatedRevision < revision) {
          throw new ProfileRevisionCorruptionError('SQLite Profile lifecycle record evidence is invalid')
        }
        if (record.updatedRevision !== revision) insertionHasUpdatedRecords = true
        if (record.kind === 'intent-event') claimedIntentEventIds.add(record.recordId)
        insertedRecords.push(logicalRecord)
      }
      if (
        !receipt.insertedRecordIds.includes(receipt.targetIdeaId)
        || !receipt.insertedRecordIds.includes(`board:${receipt.targetIdeaId}`)
        || (insertionHasMissingRecords
          ? !insertedRecords.every((record) => validLifecycleSurvivingRecord(
            receipt.targetIdeaId,
            record,
          ))
          : !validLifecycleInsertion(receipt.targetIdeaId, insertedRecords))
        || (!insertionHasMissingRecords && !insertionHasUpdatedRecords
          && canonicalProfileJson(receipt.importedAssetIds)
            !== canonicalProfileJson(enumerateProfileLogicalAssetIds(insertedRecords)))
      ) throw new ProfileRevisionCorruptionError('SQLite Profile lifecycle receipt closure is invalid')
    } else if (gui) {
      const requestJson = readString(gui, 'request_json')
      const evidence = readStoredGuiProjectionRequestEvidence(
        parseJson(requestJson, 'Profile GUI projection request'),
      )
      const requestDigest = readString(gui, 'request_digest')
      const changedJson = readString(gui, 'changed_record_ids_json')
      const appendedJson = readString(gui, 'appended_intent_event_ids_json')
      const authorizationJson = readString(gui, 'authorization_ids_json')
      const changedIds = parseJson(changedJson, 'Profile GUI projection changed record IDs')
      const appendedIds = parseJson(appendedJson, 'Profile GUI projection Intent event IDs')
      const authorizationIds = parseJson(authorizationJson, 'Profile GUI projection authorization IDs')
      const clientTxnId = readString(gui, 'client_txn_id')
      const idempotencyKey = readString(gui, 'idempotency_key')
      claimIdempotencyKey(idempotencyKey)
      const committedAt = readString(gui, 'committed_at')
      const trustedActorId = readString(gui, 'trusted_actor_id')
      const receipt = guiReceiptByRevision.get(revision)
      const recordChanges = guiRecordChangesByRevision.get(revision) ?? []
      const durableChangedRecordIds = recordChanges
        .map((recordChange) => readString(recordChange, 'record_id'))
        .sort()
      const durableDeletedRecordIds = recordChanges
        .filter((recordChange) => readString(recordChange, 'change_kind') === 'delete')
        .map((recordChange) => readString(recordChange, 'record_id'))
        .sort()
      const durableInsertedRecordIds = new Set(recordChanges
        .filter((recordChange) => readString(recordChange, 'change_kind') === 'insert')
        .map((recordChange) => readString(recordChange, 'record_id')))
      if (
        revision !== previousRevision + 1
        || persistedPrevious !== previousRevision
        || !evidence
        || !receipt
        || canonicalProfileJson(evidence) !== requestJson
        || !/^[a-f0-9]{64}$/.test(requestDigest)
        || evidence.requestDigest !== requestDigest
        || evidence.expectedRevision !== previousRevision
        || evidence.profileId !== document.head.profileId
        || evidence.generation !== readInteger(gui, 'generation')
        || evidence.clientTxnId !== clientTxnId
        || evidence.idempotencyKey !== idempotencyKey
        || evidence.committedAt !== committedAt
        || evidence.trustedActorId !== trustedActorId
        || readString(row, 'commit_id') !== `gui:${clientTxnId}`
        || readString(row, 'committed_at') !== committedAt
        || readString(row, 'actor_id') !== trustedActorId
        || readString(row, 'actor_kind') !== 'user'
        || readString(row, 'client_txn_id') !== clientTxnId
        || readColumn(row, 'actor_transport') !== null
        || readColumn(row, 'idempotency_key') !== null
        || readColumn(row, 'batch_digest') !== null
        || readColumn(row, 'batch_json') !== null
        || readColumn(row, 'receipt_json') !== null
        || !isUniqueStringArray(changedIds)
        || !isUniqueStringArray(appendedIds)
        || !isUniqueStringArray(authorizationIds)
        || canonicalProfileJson([...changedIds].sort()) !== changedJson
        || canonicalProfileJson([...appendedIds].sort()) !== appendedJson
        || canonicalProfileJson([...authorizationIds].sort()) !== authorizationJson
        || canonicalProfileJson(durableChangedRecordIds) !== changedJson
        || canonicalProfileJson(durableDeletedRecordIds)
          !== canonicalProfileJson(receipt.deletedRecordIds)
        || appendedIds.some((recordId) => !changedIds.includes(recordId))
        || appendedIds.some((recordId) => !durableInsertedRecordIds.has(recordId))
        || receipt.deletedRecordIds.some((recordId) => !changedIds.includes(recordId))
        || appendedIds.some((recordId) => receipt.deletedRecordIds.includes(recordId))
      ) throw new ProfileRevisionCorruptionError('SQLite Profile GUI projection revision is invalid')
      if (canonicalProfileJson(receipt.changedRecordIds) !== changedJson
        || canonicalProfileJson(receipt.appendedIntentEventIds) !== appendedJson
        || canonicalProfileJson(receipt.authorizationIds) !== authorizationJson) {
        throw new ProfileRevisionCorruptionError('SQLite Profile GUI receipt closure is invalid')
      }
      const recordsStampedAtRevision = document.records.filter((record) => (
        record.createdRevision === revision || record.updatedRevision === revision
      )).map((record) => record.recordId)
      if (recordsStampedAtRevision.some((recordId) => !changedIds.includes(recordId))
        || receipt.deletedRecordIds.some((recordId) => {
          const currentRecord = document.records.find((record) => record.recordId === recordId)
          return currentRecord !== undefined && currentRecord.createdRevision <= revision
        })
        || changedIds.some((recordId) => {
          if (receipt.deletedRecordIds.includes(recordId)) return false
          const currentRecord = document.records.find((record) => record.recordId === recordId)
          return (!currentRecord
            || currentRecord.createdRevision > revision
            || currentRecord.updatedRevision < revision)
            && !recordWasDeletedAfter(recordId, revision)
        })
        || (revision === document.head.revision
          && canonicalProfileJson([
            ...new Set([...recordsStampedAtRevision, ...receipt.deletedRecordIds]),
          ].sort()) !== changedJson)) {
        throw new ProfileRevisionCorruptionError('SQLite Profile GUI changed-record evidence is invalid')
      }
      for (const eventId of appendedIds) {
        const event = document.records.find((record) => record.recordId === eventId)
        if (claimedIntentEventIds.has(eventId)
          || (!event && !recordWasDeletedAfter(eventId, revision))
          || (event && (event.kind !== 'intent-event'
            || event.createdRevision !== revision
            || event.updatedRevision !== revision
            || !isObjectRecord(event.payload)
            || event.payload.actorId !== trustedActorId))) {
          throw new ProfileRevisionCorruptionError('SQLite Profile GUI Intent event evidence is invalid')
        }
        claimedIntentEventIds.add(eventId)
      }
      for (const authorizationId of authorizationIds) {
        const authorizationRow = authorizationById.get(authorizationId)
        if (!authorizationRow
          || claimedAuthorizationIds.has(authorizationId)
          || readString(authorizationRow, 'profile_id') !== document.head.profileId
          || readInteger(authorizationRow, 'base_revision') !== previousRevision
          || !changedIds.includes(readString(authorizationRow, 'idea_id'))
          || !changedIds.includes(readString(authorizationRow, 'board_id'))
          || Date.parse(readString(authorizationRow, 'created_at')) > Date.parse(committedAt)
          || Date.parse(committedAt) >= Date.parse(readString(authorizationRow, 'expires_at'))
          || readInteger(authorizationRow, 'consumed_revision') !== revision
          || readString(authorizationRow, 'consumed_idempotency_key') !== idempotencyKey) {
          throw new ProfileRevisionCorruptionError('SQLite Profile GUI authorization evidence is invalid')
        }
        claimedAuthorizationIds.add(authorizationId)
      }
    } else if (agent) {
      const evidence = readStoredAgentRequestEvidence(agent)
      const receipt = agentReceiptByRevision.get(revision)
      const changes = agentChangesByRevision.get(revision) ?? []
      const clientTxnId = readString(agent, 'client_txn_id')
      const idempotencyKey = readString(agent, 'idempotency_key')
      claimIdempotencyKey(idempotencyKey)
      const transport = readString(agent, 'actor_transport')
      const committedAt = readString(agent, 'committed_at')
      const requestJson = readString(agent, 'request_json')
      const storedCommandBindings = parseJson(
        readString(agent, 'command_bindings_json'),
        'Profile Agent command bindings',
      )
      if (revision !== previousRevision + 1
        || persistedPrevious !== previousRevision
        || readLiteralOne(agent, 'version') !== 1
        || !evidence
        || !receipt
        || evidence.request.dryRun
        || evidence.request.expectedRevision !== previousRevision
        || evidence.request.idempotencyKey !== idempotencyKey
        || evidence.profileId !== document.head.profileId
        || evidence.transport !== transport
        || evidence.clientTxnId !== clientTxnId
        || readString(agent, 'trusted_actor_id') !== PROFILE_AGENT_INSTALLED_ACTOR_ID
        || profileAgentRequestDigest(requestJson) !== readString(agent, 'request_digest')
        || readString(row, 'commit_id') !== `agent:${clientTxnId}`
        || readString(row, 'committed_at') !== committedAt
        || readString(row, 'actor_id') !== PROFILE_AGENT_INSTALLED_ACTOR_ID
        || readString(row, 'actor_kind') !== 'agent'
        || readString(row, 'actor_transport') !== transport
        || readString(row, 'client_txn_id') !== clientTxnId
        || readColumn(row, 'idempotency_key') !== null
        || readColumn(row, 'batch_digest') !== null
        || readColumn(row, 'batch_json') !== null
        || readColumn(row, 'receipt_json') !== null
        || receipt.commandResults.length !== evidence.request.commands.length
        || receipt.commandResults.some((result, index) => (
          result.commandId !== evidence.request.commands[index]?.id
          || result.name !== evidence.request.commands[index]?.name
        ))
        || receipt.effects.intentEvents !== receipt.intentEventIds.length
        || (receipt.version !== 1
          && receipt.effects.profileAgentEvents !== receipt.profileAgentEventIds.length)) {
        throw new ProfileRevisionCorruptionError('SQLite Profile Agent command revision is invalid')
      }
      const commandBindings = auditAgentCommandRevision(
        evidence.request,
        receipt,
        changes,
        {
          installedSurfaceVersion: evidence.installedSurfaceVersion,
          profileId: document.head.profileId,
          clientTxnId,
          committedAt,
          transport: transport as ProfileAgentInstalledTransport,
          ...(evidence.actor === undefined ? {} : { actor: evidence.actor }),
          storedCommandBindings,
          ...(revision === document.head.revision
            ? {
                baseDocument: rewindAgentLogicalDocument(
                  toLogicalDocument(document),
                  changes,
                  previousRevision,
                  receipt,
                ),
              }
            : {}),
        },
        {
          deriveId: deriveProfileAgentRecordId,
          contentSha256: profileAgentContentSha256,
          recordDigest: logicalRecordDigest,
        },
      )
      if (!commandBindings
        || canonicalProfileJson(commandBindings) !== readString(agent, 'command_bindings_json')) {
        throw new ProfileRevisionCorruptionError('SQLite Profile Agent result bindings are invalid')
      }
      for (const binding of commandBindings) {
        const provenance = 'stampProvenance' in binding ? binding.stampProvenance : undefined
        if (provenance === undefined) continue
        agentModStampProvenanceClaims.push(Object.freeze({ revision, provenance }))
      }

      const changedIds = changes.map((change) => change.recordId)
      const deletedIds = changes
        .filter((change) => change.changeKind === 'delete')
        .map((change) => change.recordId)
      const recordsStampedAtRevision = document.records.filter((record) => (
        record.createdRevision === revision || record.updatedRevision === revision
      )).map((record) => record.recordId)
      if (recordsStampedAtRevision.some((recordId) => !changedIds.includes(recordId))
        || (revision === document.head.revision
          && canonicalProfileJson([...new Set([...recordsStampedAtRevision, ...deletedIds])].sort())
            !== canonicalProfileJson([...changedIds].sort()))) {
        throw new ProfileRevisionCorruptionError('SQLite Profile Agent changed-record closure is invalid')
      }
      for (const change of changes) {
        const persistedRecord = document.records.find((record) => record.recordId === change.recordId)
        const logicalPersisted = logicalRecordsById?.get(change.recordId)
        if (change.changeKind === 'delete') {
          if (persistedRecord && persistedRecord.createdRevision <= revision) {
            throw new ProfileRevisionCorruptionError('SQLite Profile Agent tombstone closure is invalid')
          }
          continue
        }
        if (!persistedRecord || !logicalPersisted) {
          if (!recordWasDeletedAfter(change.recordId, revision)) {
            throw new ProfileRevisionCorruptionError('SQLite Profile Agent after-record evidence is missing')
          }
          continue
        }
        if (persistedRecord.createdRevision > revision) {
          if (!recordWasDeletedAfter(change.recordId, revision)) {
            throw new ProfileRevisionCorruptionError('SQLite Profile Agent record was replaced without a tombstone')
          }
          continue
        }
        if (persistedRecord.updatedRevision < revision) {
          throw new ProfileRevisionCorruptionError('SQLite Profile Agent record revision regressed')
        }
        if (persistedRecord.updatedRevision === revision
          && canonicalProfileJson(logicalPersisted) !== canonicalProfileJson(change.after)) {
          throw new ProfileRevisionCorruptionError('SQLite Profile Agent after-record evidence changed')
        }
      }
      const insertedIntentChanges = changes.filter((change) => (
        change.changeKind === 'insert' && change.after?.kind === 'intent-event'
      ))
      if (insertedIntentChanges.length !== receipt.intentEventIds.length
        || insertedIntentChanges.some((change) => !receipt.intentEventIds.includes(change.recordId))) {
        throw new ProfileRevisionCorruptionError('SQLite Profile Agent Intent change closure is invalid')
      }
      for (const eventId of receipt.intentEventIds) {
        const change = insertedIntentChanges.find((candidate) => candidate.recordId === eventId)
        const event = change?.after
        if (!event
          || claimedIntentEventIds.has(eventId)
          || !isObjectRecord(event.payload)
          || event.payload.id !== eventId
          || event.payload.actorId !== PROFILE_AGENT_INSTALLED_ACTOR_ID
          || event.payload.clientTxnId !== clientTxnId
          || event.payload.commitId !== receipt.commitId
          || event.payload.at !== committedAt
          || !Number.isSafeInteger(event.payload.seq)
          || Number(event.payload.seq) <= 0) {
          throw new ProfileRevisionCorruptionError('SQLite Profile Agent Intent event evidence is invalid')
        }
        claimedIntentEventIds.add(eventId)
      }
      const profileAgentEventIds: readonly string[] = receipt.version === 1
        ? []
        : receipt.profileAgentEventIds
      const insertedProfileAgentChanges = changes.filter((change) => (
        change.changeKind === 'insert' && change.after?.kind === 'profile-agent-event'
      ))
      if (insertedProfileAgentChanges.length !== profileAgentEventIds.length
        || insertedProfileAgentChanges.some((change) => (
          !profileAgentEventIds.includes(change.recordId)
        ))) {
        throw new ProfileRevisionCorruptionError('SQLite Profile Agent event change closure is invalid')
      }
      for (const eventId of profileAgentEventIds) {
        const change = insertedProfileAgentChanges.find((candidate) => candidate.recordId === eventId)
        const event = change?.after
        const decoded = event == null ? undefined : decodeProfileAgentEventRecord({
          recordId: event.recordId,
          kind: event.kind,
          ownerId: event.ownerId,
          parentId: event.parentId,
          recordVersion: PROFILE_AGENT_EVENT_RECORD_VERSION,
          payload: event.payload,
        })
        if (!decoded?.ok
          || claimedProfileAgentEventIds.has(eventId)
          || decoded.value.payload.actorId !== PROFILE_AGENT_INSTALLED_ACTOR_ID
          || decoded.value.payload.clientTxnId !== clientTxnId
          || decoded.value.payload.commitId !== receipt.commitId
          || decoded.value.payload.at !== committedAt
          || event?.ordinal !== nextProfileAgentEventOrdinal
          || decoded.value.payload.seq !== maximumProfileAgentEventSequence + 1) {
          throw new ProfileRevisionCorruptionError('SQLite Profile Agent event evidence is invalid')
        }
        claimedProfileAgentEventIds.add(eventId)
        nextProfileAgentEventOrdinal += 1
        maximumProfileAgentEventSequence = decoded.value.payload.seq
      }
    } else {
      if (revision !== previousRevision + 1 || persistedPrevious !== previousRevision) {
        throw new ProfileRevisionCorruptionError('SQLite Profile revision chain is invalid')
      }
      const batchJson = readString(row, 'batch_json')
      const parsed = parseJson(batchJson, 'Profile command batch')
      const publicBatch = validateProfileCommandBatch(parsed)
      const batch = publicBatch.ok ? publicBatch : validateInternalProfileAssetCommandBatch(parsed)
      if (!batch.ok || canonicalProfileJson(batch.value) !== batchJson) {
        throw new ProfileRevisionCorruptionError('SQLite Profile command batch is invalid')
      }
      claimIdempotencyKey(batch.value.idempotencyKey)
      const digest = createHash('sha256').update(batchJson).digest('hex')
      if (
        readString(row, 'batch_digest') !== digest
        || readString(row, 'actor_id') !== batch.value.actor.id
        || readString(row, 'actor_kind') !== batch.value.actor.kind
        || readString(row, 'actor_transport') !== batch.value.actor.transport
        || readString(row, 'client_txn_id') !== batch.value.clientTxnId
        || readString(row, 'idempotency_key') !== batch.value.idempotencyKey
      ) throw new ProfileRevisionCorruptionError('SQLite Profile command revision attribution is invalid')
      const receipt = parseReceipt(
        readString(row, 'receipt_json'),
        {
          revision,
          previousRevision: persistedPrevious,
          commitId: readString(row, 'commit_id'),
          committedAt: readString(row, 'committed_at'),
          actorId: readString(row, 'actor_id'),
          clientTxnId: readString(row, 'client_txn_id'),
        },
        batch.value,
        document,
      )
      for (const recordId of receipt.affectedIds) rememberOpaqueTransition(recordId, revision)
      const legacyIntentEvent = receipt.intentEvents[0]!
      rememberOpaqueTransition(`board:${legacyIntentEvent.ideaId}`, revision)
      rememberOpaqueTransition(legacyIntentEvent.id, revision)
      const eventId = receipt.intentEvents[0]!.id
      const persistedEvent = document.records.some((record) => (
        record.kind === 'intent-event' && record.recordId === eventId
      ))
      if (claimedIntentEventIds.has(eventId)
        || (!persistedEvent && !recordWasDeletedAfter(eventId, revision))) {
        throw new ProfileRevisionCorruptionError('SQLite Profile Intent event is claimed by multiple receipts')
      }
      claimedIntentEventIds.add(eventId)
    }
    previousRevision = revision
  }
  validateAgentModStampProvenanceClaims({
    claims: agentModStampProvenanceClaims,
    logicalRecordsById: logicalRecordsById ?? new Map(),
    agentChangesByRevision,
    guiRecordChangesByRevision,
  })
  validateAgentRecordTransitionChains({
    document,
    immutableSeedProfileAgentEventIds: new Set(
      anchoredSeedProfileAgentEventManifest.map((entry) => entry.recordId),
    ),
    logicalRecordsById: logicalRecordsById ?? new Map(),
    agentChangesByRevision,
    agentByRevision,
    guiRecordChangesByRevision,
    guiByRevision,
    opaqueTransitionRevisionsByRecordId,
  })
  if (document.records.some((record) => (
    record.kind === 'intent-event'
    && (record.createdRevision !== seedRevision || record.updatedRevision !== seedRevision)
    && !claimedIntentEventIds.has(record.recordId)
  ))) throw new ProfileRevisionCorruptionError('SQLite Profile contains an unclaimed Intent event')
  if (document.records.some((record) => (
    record.kind === 'profile-agent-event'
    && (record.createdRevision !== seedRevision || record.updatedRevision !== seedRevision)
    && !claimedProfileAgentEventIds.has(record.recordId)
  ))) throw new ProfileRevisionCorruptionError('SQLite Profile contains an unclaimed Agent event')
  for (const row of authorizationRows) {
    const authorizationId = readString(row, 'authorization_id')
    const consumedRevision = readColumn(row, 'consumed_revision')
    if (consumedRevision === null) {
      if (claimedAuthorizationIds.has(authorizationId)) {
        throw new ProfileRevisionCorruptionError('SQLite Profile GUI authorization claim is ambiguous')
      }
      continue
    }
    if (!claimedAuthorizationIds.has(authorizationId)) {
      throw new ProfileRevisionCorruptionError('SQLite Profile contains an unclaimed GUI authorization')
    }
  }
  if (
    previousRevision !== document.head.revision
    || recoveryByRevision.size !== recoveryRows.length
    || lifecycleByRevision.size !== lifecycleRows.length
    || guiByRevision.size !== guiRows.length
    || agentByRevision.size !== agentRows.length
    || agentChangesByRevision.size !== agentByRevision.size
    || [...recoveryByRevision].some(([revision]) => !revisions.some(
      (row) => readInteger(row, 'revision') === revision,
    ))
    || [...lifecycleByRevision].some(([revision]) => !revisions.some(
      (row) => readInteger(row, 'revision') === revision,
    ))
    || [...guiByRevision].some(([revision]) => !revisions.some(
      (row) => readInteger(row, 'revision') === revision,
    ))
    || [...agentByRevision].some(([revision]) => !revisions.some(
      (row) => readInteger(row, 'revision') === revision,
    ))
  ) throw new ProfileRevisionCorruptionError('SQLite Profile head is not closed over its revision history')
}

function revisionPayloadColumnsAreNull(row: SqliteRow): boolean {
  return [
    'actor_id',
    'actor_kind',
    'actor_transport',
    'client_txn_id',
    'idempotency_key',
    'batch_digest',
    'batch_json',
    'receipt_json',
  ].every((key) => readColumn(row, key) === null)
}

function readRecordRow(row: SqliteRow): ProfileRevisionRecord {
  const kind = readString(row, 'kind') as ProfileRevisionRecord['kind']
  try {
    const parent = readColumn(row, 'parent_id')
    const payloadJson = readString(row, 'payload_json')
    return {
      recordId: readString(row, 'record_id'),
      kind,
      ownerId: readString(row, 'owner_id'),
      parentId: parent === null ? null : requireString(parent, 'parent_id'),
      ordinal: readInteger(row, 'ordinal'),
      recordVersion: readExpectedVersion(
        row,
        'record_version',
        PROFILE_CONTRACT_VERSIONS.record,
      ),
      createdRevision: readInteger(row, 'created_revision'),
      updatedRevision: readInteger(row, 'updated_revision'),
      payload: parseJson(payloadJson, 'Profile record payload'),
    }
  } catch (error) {
    if (error instanceof ProfileUnsupportedFutureVersionError) throw error
    if (kind === 'logical-asset') {
      throw new ProfileRevisionCorruptionError('SQLite Profile logical asset record is invalid')
    }
    if (kind === 'mod-template' || kind === 'mod-instance') {
      throw new ProfileRevisionCorruptionError('SQLite Profile Mod record is invalid')
    }
    throw new ProfileRevisionCorruptionError('SQLite Profile record is invalid')
  }
}

class SqliteProfileAgentInputError extends Error {}

// The public request is already bounded independently. Persisted evidence adds
// only the trusted profile/actor/transport/client transaction envelope, so keep
// a small fixed allowance and reject anything larger before SQLite returns the
// JSON text to JavaScript.
const PROFILE_AGENT_STORED_REQUEST_MAX_BYTES =
  PROFILE_AGENT_COMMAND_LIMITS.maxRequestBytes + (PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes * 4) + 1024

function rewindAgentLogicalDocument(
  current: ProfileLogicalDocument,
  changes: readonly DurableRecordTransition[],
  previousRevision: number,
  receipt: ProfileAgentCommandBatchReceipt,
): ProfileLogicalDocument {
  const records = new Map(current.records.map((record) => [record.recordId, record] as const))
  for (const change of changes) {
    if (change.before === null) records.delete(change.recordId)
    else records.set(change.recordId, change.before)
  }
  const activation = receipt.commandResults.find((result) => result.name === 'idea.activate')
  let activeIdeaId = current.head.activeIdeaId
  if (activation !== undefined) {
    if (current.head.activeIdeaId !== activation.activeIdeaId) {
      throw new ProfileRevisionCorruptionError('Agent activation head evidence is invalid')
    }
    activeIdeaId = activation.previousActiveIdeaId
  }
  try {
    return validateProfileLogicalDocument({
      head: Object.freeze({ ...current.head, revision: previousRevision, activeIdeaId }),
      records: [...records.values()],
    })
  } catch (error) {
    if (error instanceof ProfileLogicalProjectionError) {
      throw new ProfileRevisionCorruptionError('Agent evidence cannot reconstruct its base revision')
    }
    throw error
  }
}

type AgentRevisionPlan = Readonly<{
  candidate: ProfileLogicalDocument
  recordChanges: readonly DurableRecordTransition[]
  upsertedRecords: readonly ProfileRevisionRecord[]
  insertedRecords: readonly ProfileRevisionRecord[]
  deletedRecordIds: readonly string[]
  intentEventIds: readonly string[]
  profileAgentEventIds: readonly string[]
}>

function deriveProfileAgentRecordId(scope: unknown): string {
  const digest = createHash('sha256').update(canonicalProfileJson(scope)).digest('hex')
  const purpose = isObjectRecord(scope) && typeof scope.purpose === 'string'
    ? scope.purpose
    : 'record'
  return `agent-${purpose}-${digest.slice(0, 40)}`
}

function agentLogicalDocumentEvidence(document: ProfileLogicalDocument): ProfileLogicalDocument {
  return {
    head: document.head,
    records: [...document.records].sort((left, right) => (
      left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0
    )),
  }
}

function createAgentDryRunReceipt(
  plan: ProfileAgentCommandPlan,
  surfaceVersion: ProfileAgentCommandSurfaceVersion,
): ProfileAgentCommandBatchReceipt {
  const base = {
    kind: 'agent-command-batch',
    previousRevision: plan.baseRevision,
    revision: plan.baseRevision,
    proposedRevision: plan.proposedRevision,
    commitId: null,
    commandResults: plan.commandResults,
    intentEventIds: Object.freeze([]),
    dryRun: true,
    replayed: false,
  } as const
  const receipt: ProfileAgentCommandBatchReceipt = surfaceVersion === 1
    ? Object.freeze({
        ...base,
        version: 1 as const,
        effects: summarizeProfileAgentCommandEffects(
          plan.recordChanges,
          plan.intentEventDrafts.length,
          0,
          1,
        ),
      })
    : surfaceVersion === 2
      ? Object.freeze({
        ...base,
        version: 2 as const,
        effects: summarizeProfileAgentCommandEffects(
          plan.recordChanges,
          plan.intentEventDrafts.length,
          plan.profileAgentEventDrafts.length,
          2,
        ),
        profileAgentEventIds: Object.freeze([]),
      })
      : surfaceVersion === 3
        ? Object.freeze({
            ...base,
            version: 3 as const,
            effects: summarizeProfileAgentCommandEffects(
              plan.recordChanges,
              plan.intentEventDrafts.length,
              plan.profileAgentEventDrafts.length,
              3,
            ),
            profileAgentEventIds: Object.freeze([]),
          })
        : surfaceVersion === 4
          ? Object.freeze({
              ...base,
              version: 4 as const,
              effects: summarizeProfileAgentCommandEffects(
                plan.recordChanges,
                plan.intentEventDrafts.length,
                plan.profileAgentEventDrafts.length,
                4,
              ),
              profileAgentEventIds: Object.freeze([]),
            })
          : Object.freeze({
              ...base,
              version: 5 as const,
              effects: summarizeProfileAgentCommandEffects(
                plan.recordChanges,
                plan.intentEventDrafts.length,
                plan.profileAgentEventDrafts.length,
                5,
              ),
              profileAgentEventIds: Object.freeze([]),
            })
  if (!isProfileAgentCommandBatchReceiptForSurface(receipt, surfaceVersion)) {
    throw new ProfileRevisionCorruptionError('Agent dry-run receipt exceeds its public boundary')
  }
  return receipt
}

function materializeAgentRevisionPlan(
  current: ProfileRevisionDocument,
  plan: ProfileAgentCommandPlan,
  committedAt: string,
  commitId: string,
  clientTxnId: string,
  createIntentEventId: () => string,
  createProfileAgentEventId: () => string,
): AgentRevisionPlan {
  const currentLogical = validatedLogicalDocument(current)
  const currentById = new Map(currentLogical.records.map((record) => [record.recordId, record] as const))
  const revisionRecordById = new Map(current.records.map((record) => [record.recordId, record] as const))
  const changes = new Map<string, DurableRecordTransition>()
  for (const change of plan.recordChanges) {
    const before = change.operation === 'insert' ? null : change.before
    const after = change.operation === 'delete' ? null : change.after
    if ((after ?? before)?.kind === 'profile-agent-event') {
      throw new ProfileRevisionCorruptionError('Agent plan cannot mutate a Profile Agent event')
    }
    const recordId = (after ?? before)!.recordId
    changes.set(recordId, Object.freeze({
      recordId,
      changeKind: change.operation === 'replace' ? 'update' : change.operation,
      before,
      after,
    }))
  }

  const boardId = plan.ideaId === undefined ? undefined : `board:${plan.ideaId}`
  let retainedIntentRecords: readonly ProfileLogicalRecordSpec[] = []
  if (boardId !== undefined) {
    const boardBefore = currentById.get(boardId)
    if (!boardBefore || boardBefore.kind !== 'board' || !isObjectRecord(boardBefore.payload)) {
      throw new ProfileRevisionCorruptionError('Agent Board timestamp record is missing')
    }
    const plannedBoardChange = changes.get(boardId)
    const boardBase = plannedBoardChange?.after ?? boardBefore
    if (boardBase.kind !== 'board' || !isObjectRecord(boardBase.payload)) {
      throw new ProfileRevisionCorruptionError('Agent planned Board timestamp record is invalid')
    }
    const boardAfter: ProfileLogicalRecordSpec = Object.freeze({
      ...boardBase,
      payload: Object.freeze({ ...boardBase.payload, updatedAt: committedAt }),
    })
    changes.set(boardId, Object.freeze({
      recordId: boardId,
      changeKind: 'update',
      before: boardBefore,
      after: boardAfter,
    }))
    retainedIntentRecords = currentLogical.records.filter((record) => (
      record.kind === 'intent-event' && record.ownerId === boardId
    ))
  } else if (plan.intentEventDrafts.length !== 0) {
    throw new ProfileRevisionCorruptionError('Profile-scoped Agent plan cannot own Board Intent events')
  }
  const baseSequence = retainedIntentRecords.reduce((maximum, record) => (
    isObjectRecord(record.payload)
      && Number.isSafeInteger(record.payload.seq)
      && Number(record.payload.seq) > maximum
      ? Number(record.payload.seq)
      : maximum
  ), 0)
  const usedIds = new Set([
    ...currentLogical.records.map((record) => record.recordId),
    ...changes.keys(),
  ])
  const intentEventIds: string[] = []
  plan.intentEventDrafts.forEach((draft, index) => {
    if (boardId === undefined || draft.ideaId !== plan.ideaId || !isObjectRecord(draft.event)) {
      throw new ProfileRevisionCorruptionError('Agent Intent draft scope is invalid')
    }
    const eventId = createIntentEventId()
    if (typeof eventId !== 'string' || eventId.length === 0 || usedIds.has(eventId)) {
      throw new ProfileRevisionCorruptionError('Agent Intent event identity is invalid')
    }
    usedIds.add(eventId)
    intentEventIds.push(eventId)
    const event: IntentLogEvent = {
      ...draft.event,
      id: eventId,
      at: committedAt,
      ideaId: plan.ideaId,
      commitId,
      actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
      clientTxnId,
      seq: baseSequence + index + 1,
    } as IntentLogEvent
    const after: ProfileLogicalRecordSpec = Object.freeze({
      recordId: eventId,
      kind: 'intent-event',
      ownerId: boardId,
      parentId: boardId,
      ordinal: retainedIntentRecords.length + index,
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      payload: Object.freeze(event) as ProfileLogicalRecordSpec['payload'],
    })
    changes.set(eventId, Object.freeze({
      recordId: eventId,
      changeKind: 'insert',
      before: null,
      after,
    }))
  })

  const retainedProfileAgentEventRecords = currentLogical.records.filter((record) => (
    record.kind === 'profile-agent-event' && record.ownerId === plan.profileId
  ))
  const baseProfileSequence = retainedProfileAgentEventRecords.reduce((maximum, record) => (
    isObjectRecord(record.payload)
      && Number.isSafeInteger(record.payload.seq)
      && Number(record.payload.seq) > maximum
      ? Number(record.payload.seq)
      : maximum
  ), 0)
  const profileAgentEventIds: string[] = []
  plan.profileAgentEventDrafts.forEach((draft, index) => {
    const eventId = createProfileAgentEventId()
    if (typeof eventId !== 'string' || eventId.length === 0 || usedIds.has(eventId)) {
      throw new ProfileRevisionCorruptionError('Profile Agent event identity is invalid')
    }
    usedIds.add(eventId)
    profileAgentEventIds.push(eventId)
    const payload: ProfileAgentEventPayload = Object.freeze({
      ...draft,
      id: eventId,
      seq: baseProfileSequence + index + 1,
      at: committedAt,
      profileId: plan.profileId,
      commitId,
      actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
      clientTxnId,
    }) as ProfileAgentEventPayload
    const decoded = decodeProfileAgentEventRecord({
      recordId: eventId,
      kind: 'profile-agent-event',
      ownerId: plan.profileId,
      parentId: plan.profileId,
      recordVersion: PROFILE_AGENT_EVENT_RECORD_VERSION,
      payload,
    })
    if (!decoded.ok) {
      throw new ProfileRevisionCorruptionError('Profile Agent event draft is invalid')
    }
    const after: ProfileLogicalRecordSpec = Object.freeze({
      ...decoded.value,
      ordinal: retainedProfileAgentEventRecords.length + index,
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
    })
    changes.set(eventId, Object.freeze({
      recordId: eventId,
      changeKind: 'insert',
      before: null,
      after,
    }))
  })

  const recordChanges = [...changes.values()].sort((left, right) => (
    left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0
  ))
  const nextById = new Map(currentLogical.records.map((record) => [record.recordId, record] as const))
  for (const change of recordChanges) {
    const currentRecord = nextById.get(change.recordId)
    if (canonicalProfileJson(currentRecord ?? null) !== canonicalProfileJson(change.before)) {
      throw new ProfileRevisionCorruptionError('Agent record plan lost its exact-before state')
    }
    if (change.after === null) nextById.delete(change.recordId)
    else nextById.set(change.recordId, change.after)
  }
  const headTransition = plan.headTransition
  if (headTransition !== undefined) {
    const activationResult = plan.commandResults.find((result) => (
      result.commandId === headTransition.commandId && result.name === 'idea.activate'
    ))
    if (activationResult?.name !== 'idea.activate') {
      throw new ProfileRevisionCorruptionError('Agent head transition result is invalid')
    }
    if (currentLogical.head.activeIdeaId !== headTransition.previousActiveIdeaId
      || activationResult.previousActiveIdeaId !== headTransition.previousActiveIdeaId
      || activationResult.activeIdeaId !== headTransition.activeIdeaId
      || !nextById.has(headTransition.activeIdeaId)
      || !nextById.has(`board:${headTransition.activeIdeaId}`)) {
      throw new ProfileRevisionCorruptionError('Agent head transition is invalid')
    }
  }
  const candidate = validateProfileLogicalDocument({
    head: {
      ...currentLogical.head,
      revision: plan.proposedRevision,
      ...(headTransition === undefined ? {} : { activeIdeaId: headTransition.activeIdeaId }),
    },
    records: [...nextById.values()],
  })
  const upsertedRecords: ProfileRevisionRecord[] = []
  const insertedRecords: ProfileRevisionRecord[] = []
  const deletedRecordIds: string[] = []
  for (const change of recordChanges) {
    if (change.changeKind === 'delete') {
      deletedRecordIds.push(change.recordId)
      continue
    }
    const after = change.after!
    if (change.changeKind === 'insert') {
      insertedRecords.push(Object.freeze({
        ...after,
        createdRevision: plan.proposedRevision,
        updatedRevision: plan.proposedRevision,
      }))
      continue
    }
    const persisted = revisionRecordById.get(change.recordId)
    if (!persisted) throw new ProfileRevisionCorruptionError('Agent update target is missing')
    upsertedRecords.push(Object.freeze({
      ...after,
      createdRevision: persisted.createdRevision,
      updatedRevision: plan.proposedRevision,
    }))
  }
  return Object.freeze({
    candidate,
    recordChanges: Object.freeze(recordChanges),
    upsertedRecords: Object.freeze(upsertedRecords),
    insertedRecords: Object.freeze(insertedRecords),
    deletedRecordIds: Object.freeze(deletedRecordIds),
    intentEventIds: Object.freeze(intentEventIds),
    profileAgentEventIds: Object.freeze(profileAgentEventIds),
  })
}

function createAgentAppliedReceipt(
  plan: ProfileAgentCommandPlan,
  revisionPlan: AgentRevisionPlan,
  commitId: string,
  surfaceVersion: ProfileAgentCommandSurfaceVersion,
): ProfileAgentCommandBatchReceipt {
  const base = {
    kind: 'agent-command-batch',
    previousRevision: plan.baseRevision,
    revision: plan.proposedRevision,
    proposedRevision: plan.proposedRevision,
    commitId,
    commandResults: plan.commandResults,
    intentEventIds: revisionPlan.intentEventIds,
    dryRun: false,
    replayed: false,
  } as const
  const receipt: ProfileAgentCommandBatchReceipt = surfaceVersion === 1
    ? Object.freeze({
        ...base,
        version: 1 as const,
        effects: summarizeProfileAgentCommandEffects(
          plan.recordChanges,
          plan.intentEventDrafts.length,
          0,
          1,
        ),
      })
    : surfaceVersion === 2
      ? Object.freeze({
        ...base,
        version: 2 as const,
        effects: summarizeProfileAgentCommandEffects(
          plan.recordChanges,
          plan.intentEventDrafts.length,
          plan.profileAgentEventDrafts.length,
          2,
        ),
        profileAgentEventIds: revisionPlan.profileAgentEventIds,
      })
      : surfaceVersion === 3
        ? Object.freeze({
            ...base,
            version: 3 as const,
            effects: summarizeProfileAgentCommandEffects(
              plan.recordChanges,
              plan.intentEventDrafts.length,
              plan.profileAgentEventDrafts.length,
              3,
            ),
            profileAgentEventIds: revisionPlan.profileAgentEventIds,
          })
        : surfaceVersion === 4
          ? Object.freeze({
              ...base,
              version: 4 as const,
              effects: summarizeProfileAgentCommandEffects(
                plan.recordChanges,
                plan.intentEventDrafts.length,
                plan.profileAgentEventDrafts.length,
                4,
              ),
              profileAgentEventIds: revisionPlan.profileAgentEventIds,
            })
          : Object.freeze({
              ...base,
              version: 5 as const,
              effects: summarizeProfileAgentCommandEffects(
                plan.recordChanges,
                plan.intentEventDrafts.length,
                plan.profileAgentEventDrafts.length,
                5,
              ),
              profileAgentEventIds: revisionPlan.profileAgentEventIds,
            })
  if (!isProfileAgentCommandBatchReceiptForSurface(receipt, surfaceVersion)) {
    throw new ProfileRevisionCorruptionError('Agent mutation receipt exceeds its public boundary')
  }
  return receipt
}

function agentRequestEvidenceJson(
  request: ProfileAgentCommandRequest,
  profileId: string,
  transport: ProfileAgentInstalledTransport,
  clientTxnId: string,
  actor: CardAuthorship,
): string {
  return canonicalProfileJson({
    version: 1,
    request,
    context: {
      profileId,
      actor: { id: PROFILE_AGENT_INSTALLED_ACTOR_ID, transport, ...actor },
      clientTxnId,
    },
  })
}

function legacyAgentRequestEvidenceJson(
  request: ProfileAgentCommandRequest,
  profileId: string,
  transport: ProfileAgentInstalledTransport,
  clientTxnId: string,
): string {
  return canonicalProfileJson({
    version: 1,
    request,
    context: {
      profileId,
      actor: { id: PROFILE_AGENT_INSTALLED_ACTOR_ID, kind: 'agent', transport },
      clientTxnId,
    },
  })
}

function profileAgentRequestDigest(json: string): string {
  return createHash('sha256').update(json).digest('hex')
}

function profileAgentContentSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function logicalRecordDigest(record: ProfileLogicalRecordSpec): string {
  return profileAgentRequestDigest(canonicalProfileJson(record))
}

function readAgentChangeTrailSource(
  runtime: SqliteRuntime,
  document: ProfileRevisionDocument,
): Readonly<{
  profileId: string
  revision: number
  records: readonly ProfileAgentChangeTrailRecord[]
}> {
  const eventRows = runtime.prepare(`
SELECT agent.revision, revisions.previous_revision, revisions.commit_id,
       revisions.committed_at AS revision_committed_at,
       revisions.actor_id AS revision_actor_id,
       revisions.actor_kind AS revision_actor_kind,
       revisions.actor_transport AS revision_actor_transport,
       revisions.client_txn_id AS revision_client_txn_id,
       revisions.idempotency_key AS revision_idempotency_key,
       revisions.batch_digest AS revision_batch_digest,
       revisions.batch_json AS revision_batch_json,
       revisions.receipt_json AS revision_receipt_json,
       agent.version, agent.installed_surface_version, agent.idempotency_key,
       agent.client_txn_id, agent.trusted_actor_id, agent.actor_transport,
       agent.request_digest, agent.request_json, agent.receipt_digest,
       agent.receipt_json, agent.changes_digest, agent.intent_event_ids_json,
       agent.profile_agent_event_ids_json, agent.command_bindings_json,
       agent.committed_at
FROM profile_agent_command_events AS agent
JOIN profile_revisions AS revisions
  ON revisions.profile_id = agent.profile_id AND revisions.revision = agent.revision
WHERE agent.profile_id = ?
ORDER BY agent.revision DESC
`).all(document.head.profileId)
  const changeRows = runtime.prepare(`
SELECT revision, record_id, change_kind, before_json, after_json
FROM profile_agent_command_record_changes
WHERE profile_id = ?
ORDER BY revision DESC, record_id ASC
`).all(document.head.profileId)
  const rowsByRevision = new Map<number, SqliteRow[]>()
  for (const row of changeRows) {
    const revision = readInteger(row, 'revision')
    const rows = rowsByRevision.get(revision) ?? []
    rows.push(row)
    rowsByRevision.set(revision, rows)
  }

  const committedAtByRevision = new Map<number, string>()
  const revisionRows = runtime.prepare(`
SELECT revision, committed_at
FROM profile_revisions
WHERE profile_id = ?
ORDER BY revision DESC
`).all(document.head.profileId)
  for (const row of revisionRows) {
    committedAtByRevision.set(readInteger(row, 'revision'), readString(row, 'committed_at'))
  }

  const records: ProfileAgentChangeTrailRecord[] = []
  for (const row of eventRows) {
    const revision = readInteger(row, 'revision')
    const evidence = readStoredAgentRequestEvidence(row)
    const receipt = parseAgentCommandReceipt(row, document)
    const changes = parseAgentRecordChanges(rowsByRevision.get(revision) ?? [])
    const transport = readString(row, 'actor_transport') as ProfileAgentInstalledTransport
    const committedAt = readString(row, 'committed_at')
    const clientTxnId = readString(row, 'client_txn_id')
    if (!evidence) {
      throw new ProfileRevisionCorruptionError('Profile Agent change-trail request evidence is invalid')
    }
    const owners = deriveAgentRecordCommandOwners(
      evidence.request,
      receipt,
      changes,
      {
        installedSurfaceVersion: evidence.installedSurfaceVersion,
        profileId: document.head.profileId,
        clientTxnId,
        committedAt,
        transport,
        ...(evidence.actor === undefined ? {} : { actor: evidence.actor }),
      },
      logicalRecordDigest,
    )
    if (!owners) {
      throw new ProfileRevisionCorruptionError('Profile Agent change-trail ownership is invalid')
    }
    const changeById = new Map(changes.map(change => [change.recordId, change] as const))
    for (const owner of owners) {
      const change = changeById.get(owner.recordId)
      const command = evidence.request.commands[owner.commandIndex]
      const record = change?.after ?? change?.before
      if (!change || !command || !record) {
        throw new ProfileRevisionCorruptionError('Profile Agent change-trail record is invalid')
      }
      const commandPayload: unknown = command.payload
      const ideaId = isObjectRecord(commandPayload) && typeof commandPayload.ideaId === 'string'
        ? commandPayload.ideaId
        : null
      const position = agentChangeTrailCardPosition(record)
      records.push(Object.freeze({
        revision,
        committedAt,
        actor: Object.freeze({
          kind: 'agent' as const,
          client: evidence.actor?.client ?? null,
          sessionId: evidence.actor?.sessionId ?? null,
        }),
        command: Object.freeze({ id: command.id, name: command.name }),
        ideaId,
        recordId: change.recordId,
        recordKind: record.kind,
        changeKind: change.changeKind,
        ...(position === undefined ? {} : { position }),
      }))
    }
  }
  appendAttributedRunChanges(records, document, committedAtByRevision)
  return Object.freeze({
    profileId: document.head.profileId,
    revision: document.head.revision,
    records: Object.freeze(records),
  })
}

function appendAttributedRunChanges(
  records: ProfileAgentChangeTrailRecord[],
  document: ProfileRevisionDocument,
  committedAtByRevision: ReadonlyMap<number, string>,
): void {
  const ideaIdByBoardId = new Map(
    document.records
      .filter((record) => record.kind === 'board')
      .map((record) => [record.recordId, record.ownerId] as const),
  )
  const identities = new Set(records.map((record) => `${record.revision}\u0000${record.recordId}`))

  for (const record of document.records) {
    if (record.kind !== 'intent-event') continue
    const evidence = readAttributedRunStart(record.payload)
    if (evidence === undefined) continue
    const ownerIdeaId = ideaIdByBoardId.get(record.ownerId)
    const ideaId = evidence.ideaId ?? ownerIdeaId
    const committedAt = committedAtByRevision.get(record.createdRevision)
    if (!ideaId || !ownerIdeaId || ideaId !== ownerIdeaId || !committedAt) {
      throw new ProfileRevisionCorruptionError('Attributed Run change-trail evidence is incomplete')
    }
    const identity = `${record.createdRevision}\u0000${evidence.runId}`
    // Installed command ownership remains authoritative if a future command
    // surface ever records the same logical transition.
    if (identities.has(identity)) continue
    identities.add(identity)
    records.push(Object.freeze({
      revision: record.createdRevision,
      committedAt,
      actor: Object.freeze({ ...evidence.triggeredBy }),
      command: Object.freeze({ id: record.recordId, name: 'run.submit' as const }),
      ideaId,
      recordId: evidence.runId,
      recordKind: 'run' as const,
      changeKind: 'insert' as const,
    }))
  }
}

function readAttributedRunStart(payload: unknown): Readonly<{
  runId: string
  ideaId?: string
  triggeredBy: AgentRunAttribution
}> | undefined {
  if (!isObjectRecord(payload)) {
    throw new ProfileRevisionCorruptionError('Profile Intent change-trail payload is invalid')
  }
  if (payload.type !== 'run.started') return undefined
  if (!nonEmptyString(payload.runId)
    || (payload.ideaId !== undefined && !nonEmptyString(payload.ideaId))
    || !isObjectRecord(payload.data)
    || !isObjectRecord(payload.data.run)
    || payload.data.run.id !== payload.runId) {
    throw new ProfileRevisionCorruptionError('Profile Run start change-trail evidence is invalid')
  }
  const triggeredBy = payload.data.run.triggeredBy
  if (triggeredBy === undefined) return undefined
  if (!hasExactKeys(triggeredBy, ['client', 'kind', 'sessionId'])
    || triggeredBy.kind !== 'agent'
    || !nonEmptyString(triggeredBy.client)
    || !nonEmptyString(triggeredBy.sessionId)) {
    throw new ProfileRevisionCorruptionError('Profile Run change-trail attribution is invalid')
  }
  return Object.freeze({
    runId: payload.runId,
    ...(payload.ideaId === undefined ? {} : { ideaId: payload.ideaId }),
    triggeredBy: Object.freeze({
      kind: 'agent',
      client: triggeredBy.client,
      sessionId: triggeredBy.sessionId,
    }),
  })
}

function agentChangeTrailCardPosition(
  record: ProfileLogicalRecordSpec,
): Readonly<{ x: number; y: number }> | undefined {
  if (record.kind !== 'card'
    || !isObjectRecord(record.payload)
    || !isObjectRecord(record.payload.position)
    || typeof record.payload.position.x !== 'number'
    || !Number.isFinite(record.payload.position.x)
    || typeof record.payload.position.y !== 'number'
    || !Number.isFinite(record.payload.position.y)) return undefined
  return Object.freeze({ x: record.payload.position.x, y: record.payload.position.y })
}

function validSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function parseAgentLogicalRecordEvidence(
  json: string,
  label: string,
): ProfileLogicalRecordSpec {
  const value = parseJson(json, label)
  if (!hasExactKeys(value, [
    'kind',
    'ordinal',
    'ownerId',
    'parentId',
    'payload',
    'recordId',
    'recordVersion',
  ])
    || typeof value.recordId !== 'string'
    || value.recordId.length === 0
    || !PROFILE_QUERYABLE_RECORD_KINDS.includes(value.kind as ProfileLogicalRecordSpec['kind'])
    || typeof value.ownerId !== 'string'
    || value.ownerId.length === 0
    || (value.parentId !== null && typeof value.parentId !== 'string')
    || !nonNegativeSafeInteger(value.ordinal)
    || value.recordVersion !== PROFILE_CONTRACT_VERSIONS.record
    || canonicalProfileJson(value) !== json) {
    throw new ProfileRevisionCorruptionError(`${label} is invalid`)
  }
  return Object.freeze(value as unknown as ProfileLogicalRecordSpec)
}

function parseAgentRecordChanges(
  rows: readonly SqliteRow[],
): readonly DurableRecordTransition[] {
  const changes = rows.map((row) => {
    const recordId = readString(row, 'record_id')
    const changeKind = readString(row, 'change_kind') as DurableRecordTransition['changeKind']
    const beforeColumn = readColumn(row, 'before_json')
    const afterColumn = readColumn(row, 'after_json')
    const before = beforeColumn === null
      ? null
      : parseAgentLogicalRecordEvidence(
          requireString(beforeColumn, 'before_json'),
          'Profile Agent before record',
        )
    const after = afterColumn === null
      ? null
      : parseAgentLogicalRecordEvidence(
          requireString(afterColumn, 'after_json'),
          'Profile Agent after record',
        )
    if ((changeKind === 'insert' && (before !== null || after === null))
      || (changeKind === 'update' && (before === null || after === null))
      || (changeKind === 'delete' && (before === null || after !== null))
      || (changeKind !== 'insert' && changeKind !== 'update' && changeKind !== 'delete')
      || (before !== null && before.recordId !== recordId)
      || (after !== null && after.recordId !== recordId)
      || (before !== null && after !== null && before.kind !== after.kind)) {
      throw new ProfileRevisionCorruptionError('Profile Agent record-change evidence is invalid')
    }
    return Object.freeze({ recordId, changeKind, before, after })
  })
  changes.sort((left, right) => (
    left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0
  ))
  return Object.freeze(changes)
}

function validateAgentDurableChangeEvidenceBounds(
  rows: readonly SqliteRow[],
  agentByRevision: ReadonlyMap<number, SqliteRow>,
): void {
  const totals = new Map<number, { bytes: number; count: number }>()
  for (const row of rows) {
    const revision = readInteger(row, 'revision')
    if (!agentByRevision.has(revision)) {
      throw new ProfileRevisionCorruptionError('SQLite Profile Agent change evidence is orphaned')
    }
    const recordId = readString(row, 'record_id')
    const changeKind = readString(row, 'change_kind')
    const beforeBytes = readInteger(row, 'before_bytes')
    const afterBytes = readInteger(row, 'after_bytes')
    const previous = totals.get(revision) ?? { bytes: 2, count: 0 }
    const objectBytes = Buffer.byteLength('{"after":', 'utf8')
      + afterBytes
      + Buffer.byteLength(',"before":', 'utf8')
      + beforeBytes
      + Buffer.byteLength(',"changeKind":', 'utf8')
      + Buffer.byteLength(canonicalProfileJson(changeKind), 'utf8')
      + Buffer.byteLength(',"recordId":', 'utf8')
      + Buffer.byteLength(canonicalProfileJson(recordId), 'utf8')
      + Buffer.byteLength('}', 'utf8')
    const bytes = previous.bytes + (previous.count === 0 ? 0 : 1) + objectBytes
    if (bytes > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxDurableChangeBytes) {
      throw new ProfileRevisionCorruptionError('Profile Agent durable change evidence exceeds its bound')
    }
    totals.set(revision, { bytes, count: previous.count + 1 })
  }
}

function validateAgentEventEvidenceBounds(rows: readonly SqliteRow[]): void {
  const revisions = new Set<number>()
  for (const row of rows) {
    const revision = readInteger(row, 'revision')
    const requestBytes = readInteger(row, 'request_bytes')
    const receiptBytes = readInteger(row, 'receipt_bytes')
    const intentIdsBytes = readInteger(row, 'intent_ids_bytes')
    const profileEventIdsBytes = readInteger(row, 'profile_event_ids_bytes')
    const bindingsBytes = readInteger(row, 'bindings_bytes')
    if (revisions.has(revision)
      || requestBytes === 0
      || requestBytes > PROFILE_AGENT_STORED_REQUEST_MAX_BYTES
      || receiptBytes === 0
      || receiptBytes > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxReceiptBytes
      || intentIdsBytes === 0
      || intentIdsBytes > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxReceiptBytes
      || profileEventIdsBytes === 0
      || profileEventIdsBytes > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxReceiptBytes
      || bindingsBytes === 0
      || bindingsBytes > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxReceiptBytes) {
      throw new ProfileRevisionCorruptionError('Profile Agent event evidence exceeds its bound')
    }
    revisions.add(revision)
  }
}

type AgentModStampProvenanceClaim = Readonly<{
  revision: number
  provenance: ProfileAgentModStampProvenanceV1
}>

function validateAgentModStampProvenanceClaims(input: Readonly<{
  claims: readonly AgentModStampProvenanceClaim[]
  logicalRecordsById: ReadonlyMap<string, ProfileLogicalRecordSpec>
  agentChangesByRevision: ReadonlyMap<number, readonly DurableRecordTransition[]>
  guiRecordChangesByRevision: ReadonlyMap<number, readonly SqliteRow[]>
}>): void {
  for (const claim of input.claims) {
    const templateId = claim.provenance.templateFrame.recordId
    const templateDigest = claim.provenance.templateDigest
    const sameRevisionDigests = (input.agentChangesByRevision.get(claim.revision) ?? [])
      .filter((change) => change.recordId === templateId)
      .flatMap((change) => [change.before, change.after])
      .filter((record): record is ProfileLogicalRecordSpec => record?.kind === 'mod-template')
      .map(logicalRecordDigest)
    if (sameRevisionDigests.includes(templateDigest)) continue

    const laterAnchors: Array<Readonly<{
      revision: number
      beforeDigest: string | null
    }>> = []
    for (const [revision, changes] of input.agentChangesByRevision) {
      if (revision <= claim.revision) continue
      for (const change of changes) {
        if (change.recordId !== templateId) continue
        laterAnchors.push(Object.freeze({
          revision,
          beforeDigest: change.before === null ? null : logicalRecordDigest(change.before),
        }))
      }
    }
    for (const [revision, rows] of input.guiRecordChangesByRevision) {
      if (revision <= claim.revision) continue
      for (const row of rows) {
        if (readString(row, 'record_id') !== templateId) continue
        const beforeDigest = readColumn(row, 'before_digest')
        laterAnchors.push(Object.freeze({
          revision,
          beforeDigest: beforeDigest === null
            ? null
            : requireString(beforeDigest, 'before_digest'),
        }))
      }
    }
    laterAnchors.sort((left, right) => left.revision - right.revision)
    const earliestLaterAnchor = laterAnchors[0]
    if (earliestLaterAnchor !== undefined) {
      if (earliestLaterAnchor.beforeDigest === templateDigest) continue
      throw new ProfileRevisionCorruptionError(
        'SQLite Profile Agent Mod stamp source differs from later template history',
      )
    }

    const currentTemplate = input.logicalRecordsById.get(templateId)
    if (currentTemplate?.kind === 'mod-template'
      && logicalRecordDigest(currentTemplate) === templateDigest) continue
    throw new ProfileRevisionCorruptionError(
      'SQLite Profile Agent Mod stamp source lacks an independent template anchor',
    )
  }
}

type RecordDigestTransition = Readonly<{
  revision: number
  recordId: string
  changeKind: DurableRecordTransition['changeKind']
  beforeDigest: string | null
  afterDigest: string | null
  source: 'agent' | 'gui'
  legacyBarrier: boolean
}>

function validateAgentRecordTransitionChains(input: Readonly<{
  document: ProfileRevisionDocument
  immutableSeedProfileAgentEventIds: ReadonlySet<string>
  logicalRecordsById: ReadonlyMap<string, ProfileLogicalRecordSpec>
  agentChangesByRevision: ReadonlyMap<number, readonly DurableRecordTransition[]>
  agentByRevision: ReadonlyMap<number, SqliteRow>
  guiRecordChangesByRevision: ReadonlyMap<number, readonly SqliteRow[]>
  guiByRevision: ReadonlyMap<number, SqliteRow>
  opaqueTransitionRevisionsByRecordId: ReadonlyMap<string, readonly number[]>
}>): void {
  const agentIntentBirthRevisionByRecordId = new Map<string, number>()
  const profileAgentEventBirthRevisionByRecordId = new Map<string, number>()
  const transitionsByRecordId = new Map<string, RecordDigestTransition[]>()
  const append = (transition: RecordDigestTransition) => {
    const transitions = transitionsByRecordId.get(transition.recordId) ?? []
    transitions.push(transition)
    transitionsByRecordId.set(transition.recordId, transitions)
  }
  for (const [revision, changes] of input.agentChangesByRevision) {
    for (const change of changes) {
      if (change.changeKind === 'insert' && change.after?.kind === 'intent-event') {
        if (agentIntentBirthRevisionByRecordId.has(change.recordId)) {
          throw new ProfileRevisionCorruptionError('SQLite Profile Agent Intent event birth is ambiguous')
        }
        agentIntentBirthRevisionByRecordId.set(change.recordId, revision)
      }
      if (change.changeKind === 'insert' && change.after?.kind === 'profile-agent-event') {
        if (profileAgentEventBirthRevisionByRecordId.has(change.recordId)) {
          throw new ProfileRevisionCorruptionError('SQLite Profile Agent event birth is ambiguous')
        }
        profileAgentEventBirthRevisionByRecordId.set(change.recordId, revision)
      }
      append(Object.freeze({
        revision,
        recordId: change.recordId,
        changeKind: change.changeKind,
        beforeDigest: change.before === null ? null : logicalRecordDigest(change.before),
        afterDigest: change.after === null ? null : logicalRecordDigest(change.after),
        source: 'agent',
        legacyBarrier: false,
      }))
    }
  }
  for (const [revision, rows] of input.guiRecordChangesByRevision) {
    for (const row of rows) {
      const beforeColumn = readColumn(row, 'before_digest')
      const afterColumn = readColumn(row, 'after_digest')
      append(Object.freeze({
        revision,
        recordId: readString(row, 'record_id'),
        changeKind: readString(row, 'change_kind') as DurableRecordTransition['changeKind'],
        beforeDigest: beforeColumn === null ? null : requireString(beforeColumn, 'before_digest'),
        afterDigest: afterColumn === null ? null : requireString(afterColumn, 'after_digest'),
        source: 'gui',
        legacyBarrier: beforeColumn === null && afterColumn === null,
      }))
    }
  }

  for (const recordId of input.immutableSeedProfileAgentEventIds) {
    if (transitionsByRecordId.has(recordId)
      || (input.opaqueTransitionRevisionsByRecordId.get(recordId)?.length ?? 0) > 0) {
      throw new ProfileRevisionCorruptionError(
        'SQLite Profile imported seed Agent event was mutated after import',
      )
    }
  }

  for (const [recordId, transitions] of transitionsByRecordId) {
    transitions.sort((left, right) => left.revision - right.revision)
    const agentIntentBirthRevision = agentIntentBirthRevisionByRecordId.get(recordId)
    if (agentIntentBirthRevision !== undefined) {
      const birthIndex = transitions.findIndex((transition) => (
        transition.revision === agentIntentBirthRevision
        && transition.source === 'agent'
        && transition.changeKind === 'insert'
      ))
      if (birthIndex < 0
        || transitions.slice(birthIndex + 1).some((transition) => (
          transition.changeKind !== 'delete'
        ))
        || input.opaqueTransitionRevisionsByRecordId.get(recordId)?.some((revision) => (
          revision > agentIntentBirthRevision
        )) === true) {
        throw new ProfileRevisionCorruptionError(
          'SQLite Profile Agent Intent event was mutated after insertion',
        )
      }
    }
    const profileAgentEventBirthRevision = profileAgentEventBirthRevisionByRecordId.get(recordId)
    if (profileAgentEventBirthRevision !== undefined) {
      const birthIndex = transitions.findIndex((transition) => (
        transition.revision === profileAgentEventBirthRevision
        && transition.source === 'agent'
        && transition.changeKind === 'insert'
      ))
      if (birthIndex < 0
        || transitions.length !== birthIndex + 1
        || input.opaqueTransitionRevisionsByRecordId.get(recordId)?.some((revision) => (
          revision > profileAgentEventBirthRevision
        )) === true) {
        throw new ProfileRevisionCorruptionError(
          'SQLite Profile Agent event was mutated after insertion',
        )
      }
    }
    const firstAgentIndex = transitions.findIndex((transition) => transition.source === 'agent')
    if (firstAgentIndex < 0) continue
    let expectedBefore: string | null | undefined
    const prior = transitions[firstAgentIndex - 1]
    if (prior && !prior.legacyBarrier) expectedBefore = prior.afterDigest
    let previousTransitionRevision = prior?.revision
    let generationStartRevision: number | undefined
    for (const transition of transitions.slice(firstAgentIndex)) {
      if (transition.legacyBarrier) {
        throw new ProfileRevisionCorruptionError(
          'SQLite Profile GUI transition after Agent history lacks canonical digests',
        )
      }
      if ((transition.changeKind === 'insert'
          && (transition.beforeDigest !== null || transition.afterDigest === null))
        || (transition.changeKind === 'update'
          && (transition.beforeDigest === null || transition.afterDigest === null))
        || (transition.changeKind === 'delete'
          && (transition.beforeDigest === null || transition.afterDigest !== null))) {
        throw new ProfileRevisionCorruptionError(
          `SQLite Profile record transition shape is invalid for ${recordId} at ${transition.revision}`,
        )
      }
      if (expectedBefore !== undefined && transition.beforeDigest !== expectedBefore) {
        const opaqueBarrier = previousTransitionRevision !== undefined
          && input.opaqueTransitionRevisionsByRecordId.get(recordId)?.some((revision) => (
            revision > previousTransitionRevision! && revision < transition.revision
          )) === true
        if (!opaqueBarrier) {
          throw new ProfileRevisionCorruptionError(
            `SQLite Profile record transition chain is broken for ${recordId} at ${transition.revision}`,
          )
        }
        generationStartRevision = undefined
      }
      if (transition.changeKind === 'insert') generationStartRevision = transition.revision
      else if (transition.changeKind === 'delete') generationStartRevision = undefined
      expectedBefore = transition.afterDigest
      previousTransitionRevision = transition.revision
    }
    const latest = transitions[transitions.length - 1]!
    const currentRecord = input.logicalRecordsById.get(recordId)
    const persistedRecord = input.document.records.find((record) => record.recordId === recordId)
    if (latest.afterDigest === null) {
      if (persistedRecord) {
        const opaqueRevisions = input.opaqueTransitionRevisionsByRecordId.get(recordId) ?? []
        if (persistedRecord.createdRevision <= latest.revision
          || !opaqueRevisions.includes(persistedRecord.createdRevision)
          || (persistedRecord.updatedRevision !== persistedRecord.createdRevision
            && !opaqueRevisions.includes(persistedRecord.updatedRevision))) {
          throw new ProfileRevisionCorruptionError('SQLite Profile deleted record transition is still live')
        }
      }
      continue
    }
    if (!currentRecord || !persistedRecord) {
      const deletedByLaterOpaqueRevision = !currentRecord && !persistedRecord
        && input.opaqueTransitionRevisionsByRecordId.get(recordId)?.some((revision) => (
          revision > latest.revision
        )) === true
      if (deletedByLaterOpaqueRevision) continue
      throw new ProfileRevisionCorruptionError('SQLite Profile live record transition has no current record')
    }
    if (persistedRecord.updatedRevision < latest.revision) {
      throw new ProfileRevisionCorruptionError('SQLite Profile record transition revision regressed')
    }
    if (persistedRecord.updatedRevision === latest.revision) {
      if (logicalRecordDigest(currentRecord) !== latest.afterDigest) {
        throw new ProfileRevisionCorruptionError('SQLite Profile record transition head digest changed')
      }
      if (generationStartRevision !== undefined
        && persistedRecord.createdRevision !== generationStartRevision) {
        throw new ProfileRevisionCorruptionError('SQLite Profile record generation start is invalid')
      }
      continue
    }
    if (input.agentByRevision.has(persistedRecord.updatedRevision)
      || input.guiByRevision.has(persistedRecord.updatedRevision)
      || input.opaqueTransitionRevisionsByRecordId.get(recordId)?.includes(
        persistedRecord.updatedRevision,
      ) !== true) {
      throw new ProfileRevisionCorruptionError('SQLite Profile record transition history is incomplete')
    }
    // A pre-existing non-Agent writer has no canonical transition image. It is
    // an explicit compatibility barrier, not evidence that can close this chain.
  }
}

function readStoredAgentRequestEvidence(
  row: SqliteRow,
): Readonly<{
  installedSurfaceVersion: ProfileAgentCommandSurfaceVersion
  request: ProfileAgentCommandRequest
  profileId: string
  transport: ProfileAgentInstalledTransport
  clientTxnId: string
  actor?: CardAuthorship
}> | undefined {
  const requestJson = readString(row, 'request_json')
  const installedSurfaceVersion = readAgentSurfaceVersion(row)
  const value = parseJson(requestJson, 'Profile Agent command request')
  if (!hasExactKeys(value, ['context', 'request', 'version'])
    || value.version !== 1
    || !hasExactKeys(value.context, ['actor', 'clientTxnId', 'profileId'])
    || (!hasExactKeys(value.context.actor, ['client', 'id', 'kind', 'sessionId', 'transport'])
      && !hasExactKeys(value.context.actor, ['id', 'kind', 'transport']))
    || value.context.actor.id !== PROFILE_AGENT_INSTALLED_ACTOR_ID
    || value.context.actor.kind !== 'agent'
    || (value.context.actor.transport !== 'cli' && value.context.actor.transport !== 'mcp')
    || typeof value.context.profileId !== 'string'
    || typeof value.context.clientTxnId !== 'string') return undefined
  const actor = hasExactKeys(value.context.actor, [
    'client', 'id', 'kind', 'sessionId', 'transport',
  ]) && isCardAuthorship({
    kind: value.context.actor.kind,
    client: value.context.actor.client,
    sessionId: value.context.actor.sessionId,
  })
    ? Object.freeze({
        kind: 'agent' as const,
        client: value.context.actor.client as string,
        sessionId: value.context.actor.sessionId as string,
      })
    : undefined
  const validation = validateProfileAgentCommandRequestForSurface(
    value.request,
    installedSurfaceVersion,
  )
  if (!validation.ok) return undefined
  const normalizedJson = actor === undefined
    ? legacyAgentRequestEvidenceJson(
        validation.value,
        value.context.profileId,
        value.context.actor.transport,
        value.context.clientTxnId,
      )
    : agentRequestEvidenceJson(
        validation.value,
        value.context.profileId,
        value.context.actor.transport,
        value.context.clientTxnId,
        actor,
      )
  if (normalizedJson !== requestJson) return undefined
  return Object.freeze({
    installedSurfaceVersion,
    request: validation.value,
    profileId: value.context.profileId,
    transport: value.context.actor.transport,
    clientTxnId: value.context.clientTxnId,
    ...(actor === undefined ? {} : { actor }),
  })
}

function readAgentRevisionByIdempotency(
  runtime: SqliteRuntime,
  idempotencyKey: string,
): SqliteRow | undefined {
  return runtime.prepare(`
SELECT agent.revision, revisions.previous_revision, revisions.commit_id,
       revisions.committed_at AS revision_committed_at,
       revisions.actor_id AS revision_actor_id,
       revisions.actor_kind AS revision_actor_kind,
       revisions.actor_transport AS revision_actor_transport,
       revisions.client_txn_id AS revision_client_txn_id,
       revisions.idempotency_key AS revision_idempotency_key,
       revisions.batch_digest AS revision_batch_digest,
       revisions.batch_json AS revision_batch_json,
       revisions.receipt_json AS revision_receipt_json,
       agent.version, agent.installed_surface_version, agent.idempotency_key, agent.client_txn_id,
       agent.trusted_actor_id, agent.actor_transport, agent.request_digest,
       agent.request_json, agent.receipt_digest, agent.receipt_json,
       agent.changes_digest, agent.intent_event_ids_json, agent.profile_agent_event_ids_json,
       agent.command_bindings_json, agent.committed_at
FROM profile_agent_command_events AS agent
JOIN profile_revisions AS revisions
  ON revisions.profile_id = agent.profile_id AND revisions.revision = agent.revision
WHERE agent.idempotency_key = ?
`).get(idempotencyKey)
}

function parseAgentCommandReceipt(
  row: SqliteRow,
  document: ProfileRevisionDocument,
): ProfileAgentCommandBatchReceipt {
  const receiptJson = readString(row, 'receipt_json')
  const value = parseJson(receiptJson, 'Profile Agent command receipt')
  const surfaceVersion = readAgentSurfaceVersion(row)
  if (!isProfileAgentCommandBatchReceiptForSurface(value, surfaceVersion)
    || value.dryRun
    || value.replayed
    || value.previousRevision !== readInteger(row, 'previous_revision')
    || value.revision !== readInteger(row, 'revision')
    || value.revision > document.head.revision
    || value.commitId !== readString(row, 'commit_id')
    || canonicalProfileJson(value) !== receiptJson
    || profileAgentRequestDigest(receiptJson) !== readString(row, 'receipt_digest')
    || canonicalProfileJson(value.intentEventIds) !== readString(row, 'intent_event_ids_json')
    || canonicalProfileJson(value.version === 1 ? [] : value.profileAgentEventIds)
      !== readString(row, 'profile_agent_event_ids_json')) {
    throw new ProfileRevisionCorruptionError('Profile Agent command receipt evidence is invalid')
  }
  const commandResults = value.commandResults.map((result) => Object.freeze(
    result.name === 'connection.create'
      ? { ...result, connectionIds: Object.freeze([...result.connectionIds]) }
      : { ...result },
  )) as ProfileAgentCommandBatchReceipt['commandResults']
  if (value.version === 1) {
    return Object.freeze({
      ...value,
      commandResults: Object.freeze(commandResults),
      effects: Object.freeze({ ...value.effects }),
      intentEventIds: Object.freeze([...value.intentEventIds]),
    })
  }
  return Object.freeze({
    ...value,
    commandResults: Object.freeze(commandResults),
    effects: Object.freeze({ ...value.effects }),
    intentEventIds: Object.freeze([...value.intentEventIds]),
    profileAgentEventIds: Object.freeze([...value.profileAgentEventIds]),
  })
}

function readAgentSurfaceVersion(row: SqliteRow): ProfileAgentCommandSurfaceVersion {
  const value = readInteger(row, 'installed_surface_version')
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4 && value !== 5) {
    throw new ProfileRevisionCorruptionError('Profile Agent installed surface version is invalid')
  }
  return value
}

function insertAgentCommandRevision(
  runtime: SqliteRuntime,
  input: Readonly<{
    request: ProfileAgentCommandRequest
    transport: ProfileAgentInstalledTransport
    clientTxnId: string
    committedAt: string
    requestJson: string
    requestDigest: string
    changesJson: string
    changesDigest: string
    installedSurfaceVersion: ProfileAgentCommandSurfaceVersion
    receipt: ProfileAgentCommandBatchReceipt
    commandBindings: readonly ProfileAgentCommandBinding[]
    revisionPlan: AgentRevisionPlan
  }>,
): void {
  const receiptJson = canonicalProfileJson(input.receipt)
  const intentEventIdsJson = canonicalProfileJson(input.receipt.intentEventIds)
  const profileAgentEventIdsJson = canonicalProfileJson(
    input.receipt.version === 1 ? [] : input.receipt.profileAgentEventIds,
  )
  const commandBindingsJson = canonicalProfileJson(input.commandBindings)
  if (Buffer.byteLength(input.requestJson, 'utf8') > PROFILE_AGENT_STORED_REQUEST_MAX_BYTES
    || Buffer.byteLength(receiptJson, 'utf8') > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxReceiptBytes
    || Buffer.byteLength(intentEventIdsJson, 'utf8') > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxReceiptBytes
    || Buffer.byteLength(profileAgentEventIdsJson, 'utf8') > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxReceiptBytes
    || Buffer.byteLength(commandBindingsJson, 'utf8') > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxReceiptBytes) {
    throw new SqliteProfileAgentInputError('Agent event evidence exceeds its bound')
  }
  runtime.prepare(`
INSERT INTO profile_revisions (
  profile_id, revision, previous_revision, commit_id, committed_at,
  actor_id, actor_kind, actor_transport, client_txn_id, idempotency_key,
  batch_digest, batch_json, receipt_json
) SELECT profile_id, ?, ?, ?, ?, ?, 'agent', ?, ?, NULL, NULL, NULL, NULL
FROM profile_meta
`).run(
    input.receipt.revision,
    input.receipt.previousRevision,
    input.receipt.commitId,
    input.committedAt,
    PROFILE_AGENT_INSTALLED_ACTOR_ID,
    input.transport,
    input.clientTxnId,
  )
  runtime.prepare(`
INSERT INTO profile_agent_command_events (
  profile_id, revision, version, installed_surface_version, idempotency_key, client_txn_id,
  trusted_actor_id, actor_transport, request_digest, request_json,
  receipt_digest, receipt_json, changes_digest, intent_event_ids_json,
  profile_agent_event_ids_json, command_bindings_json, committed_at
) SELECT profile_id, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM profile_meta
`).run(
    input.receipt.revision,
    input.installedSurfaceVersion,
    input.request.idempotencyKey,
    input.clientTxnId,
    PROFILE_AGENT_INSTALLED_ACTOR_ID,
    input.transport,
    input.requestDigest,
    input.requestJson,
    profileAgentRequestDigest(receiptJson),
    receiptJson,
    input.changesDigest,
    intentEventIdsJson,
    profileAgentEventIdsJson,
    commandBindingsJson,
    input.committedAt,
  )
  const insertChange = runtime.prepare(`
INSERT INTO profile_agent_command_record_changes (
  profile_id, revision, record_id, change_kind, before_json, after_json
) SELECT profile_id, ?, ?, ?, ?, ? FROM profile_meta
`)
  for (const change of input.revisionPlan.recordChanges) {
    insertChange.run(
      input.receipt.revision,
      change.recordId,
      change.changeKind,
      change.before === null ? null : canonicalProfileJson(change.before),
      change.after === null ? null : canonicalProfileJson(change.after),
    )
  }
}

function writeAgentPlanRecordsExact(
  runtime: SqliteRuntime,
  profileId: string,
  plan: AgentRevisionPlan,
): void {
  const nextById = new Map([
    ...plan.upsertedRecords,
    ...plan.insertedRecords,
  ].map((record) => [record.recordId, record] as const))
  const remove = runtime.prepare(`
DELETE FROM profile_records
WHERE profile_id = ? AND record_id = ? AND kind = ? AND owner_id = ?
  AND parent_id IS ? AND ordinal = ? AND record_version = ?
  AND created_revision = ? AND updated_revision = ? AND payload_json = ?
`)
  const update = runtime.prepare(`
UPDATE profile_records
SET owner_id = ?, parent_id = ?, ordinal = ?, record_version = ?,
    updated_revision = ?, payload_json = ?
WHERE profile_id = ? AND record_id = ? AND kind = ? AND owner_id = ?
  AND parent_id IS ? AND ordinal = ? AND record_version = ?
  AND created_revision = ? AND updated_revision = ? AND payload_json = ?
`)
  for (const change of plan.recordChanges) {
    if (change.changeKind === 'insert') continue
    const row = runtime.prepare(`
SELECT record_id, kind, owner_id, parent_id, ordinal, record_version,
       created_revision, updated_revision, payload_json
FROM profile_records
WHERE profile_id = ? AND record_id = ?
`).get(profileId, change.recordId)
    if (!row) throw new ProfileRevisionCorruptionError('Agent exact-before record is missing')
    const persisted = readRecordRow(row)
    const logicalPersisted: ProfileLogicalRecordSpec = {
      recordId: persisted.recordId,
      kind: persisted.kind,
      ownerId: persisted.ownerId,
      parentId: persisted.parentId,
      ordinal: persisted.ordinal,
      recordVersion: persisted.recordVersion,
      payload: persisted.payload as ProfileLogicalRecordSpec['payload'],
    }
    if (canonicalProfileJson(logicalPersisted) !== canonicalProfileJson(change.before)) {
      throw new ProfileRevisionCorruptionError('Agent exact-before record changed during planning')
    }
    const beforeArgs = [
      profileId,
      persisted.recordId,
      persisted.kind,
      persisted.ownerId,
      persisted.parentId,
      persisted.ordinal,
      persisted.recordVersion,
      persisted.createdRevision,
      persisted.updatedRevision,
      canonicalProfileJson(persisted.payload),
    ] as const
    if (change.changeKind === 'delete') {
      if (Number(remove.run(...beforeArgs).changes) !== 1) {
        throw new ProfileRevisionCorruptionError('Agent delete compare-and-swap failed')
      }
      continue
    }
    const next = nextById.get(change.recordId)
    if (!next) throw new ProfileRevisionCorruptionError('Agent update record is missing')
    const result = update.run(
      next.ownerId,
      next.parentId,
      next.ordinal,
      next.recordVersion,
      next.updatedRevision,
      canonicalProfileJson(next.payload),
      ...beforeArgs,
    )
    if (Number(result.changes) !== 1) {
      throw new ProfileRevisionCorruptionError('Agent update compare-and-swap failed')
    }
  }
  for (const record of plan.insertedRecords) insertRecord(runtime, profileId, record)
}

function updateAgentCommandHead(
  runtime: SqliteRuntime,
  candidate: ProfileLogicalDocument,
  expectedRevision: number,
  committedAt: string,
): void {
  const result = runtime.prepare(`
UPDATE profile_meta
SET current_revision = ?, active_idea_id = ?, updated_at = ?
WHERE profile_id = ? AND current_revision = ?
`).run(
    candidate.head.revision,
    candidate.head.activeIdeaId,
    committedAt,
    candidate.head.profileId,
    expectedRevision,
  )
  if (Number(result.changes) !== 1) {
    throw new ProfileRevisionCorruptionError('Agent head compare-and-swap failed')
  }
}

function agentStoreFailure(
  error: unknown,
  currentRevision?: number,
): ProfileServiceResult<never> {
  return profileServiceFailure(
    error instanceof AggregateError
      ? 'corrupt-or-recovery-required'
      : error instanceof ProfileUnsupportedFutureVersionError
      ? 'unsupported-future-version'
      : error instanceof SqliteProfileAgentInputError
        ? 'capability-denied'
      : error instanceof SqliteProfileBlobCorruptionError
      || error instanceof ProfileRevisionCorruptionError
      || error instanceof ProfileLogicalProjectionError
        ? 'corrupt-or-recovery-required'
        : isBusyError(error) || error instanceof SqliteProfileOwnershipCapabilityError
          ? 'busy'
          : 'internal',
    {
      ...(currentRevision === undefined ? {} : { currentRevision }),
      ...(error instanceof ProfileUnsupportedFutureVersionError
        ? { supportedVersions: error.supportedVersions }
        : {}),
    },
  )
}

type GuiProjectionRequestEvidence = Readonly<{
  request: GuiProfileProjectionRequest
  requestEvidenceJson: string
  requestDigest: string
}>

type StoredGuiProjectionRequestEvidence = Readonly<{
  projectionVersion: typeof GUI_PROFILE_PROJECTION_VERSION
  profileId: string
  requestDigest: string
  generation: number
  expectedRevision: number
  clientTxnId: string
  idempotencyKey: string
  committedAt: string
  trustedActorId: string
}>

type GuiProjectionRecordPlan = Readonly<{
  upsertedRecords: readonly ProfileRevisionRecord[]
  insertedRecords: readonly ProfileRevisionRecord[]
  deletedRecordIds: readonly string[]
  changedRecordIds: readonly string[]
  appendedIntentEventIds: readonly string[]
  durableTransitions: readonly DurableRecordTransition[]
}>

class SqliteProfileGuiInputError extends Error {}

function readGuiProjectionRequestEvidence(candidate: unknown): GuiProjectionRequestEvidence | undefined {
  if (!hasExactKeys(candidate, [
    'generation',
    'expectedRevision',
    'clientTxnId',
    'idempotencyKey',
    'committedAt',
    'context',
    'projection',
  ])
    || !positiveSafeInteger(candidate.generation)
    || !nonNegativeSafeInteger(candidate.expectedRevision)
    || !nonEmptyString(candidate.clientTxnId)
    || !nonEmptyString(candidate.idempotencyKey)
    || !canonicalTimestamp(candidate.committedAt)
    || !hasExactKeys(candidate.context, ['trustedActorId', 'ordinaryNewIdeas'])
    || !nonEmptyString(candidate.context.trustedActorId)
    || !Array.isArray(candidate.context.ordinaryNewIdeas)
    || !candidate.context.ordinaryNewIdeas.every(validGuiOrdinaryIdeaAuthorization)
    || !hasExactKeys(candidate.projection, [
      'projectionVersion',
      'profileId',
      'activeIdeaId',
      'ideas',
      'boardReplacements',
      'userModTemplates',
      'profileSettings',
      'newModOrigins',
    ])
    || candidate.projection.projectionVersion !== GUI_PROFILE_PROJECTION_VERSION
    || !nonEmptyString(candidate.projection.profileId)
    || !nonEmptyString(candidate.projection.activeIdeaId)
    || !Array.isArray(candidate.projection.ideas)
    || !isObjectRecord(candidate.projection.boardReplacements)
    || !Array.isArray(candidate.projection.userModTemplates)
    || !Array.isArray(candidate.projection.profileSettings)
    || !isObjectRecord(candidate.projection.newModOrigins)) return undefined
  try {
    const request = candidate as unknown as GuiProfileProjectionRequest
    const requestJson = canonicalProfileJson(request)
    const requestDigest = createHash('sha256').update(requestJson).digest('hex')
    const requestEvidenceJson = canonicalProfileJson({
      projectionVersion: request.projection.projectionVersion,
      profileId: request.projection.profileId,
      requestDigest,
      generation: request.generation,
      expectedRevision: request.expectedRevision,
      clientTxnId: request.clientTxnId,
      idempotencyKey: request.idempotencyKey,
      committedAt: request.committedAt,
      trustedActorId: request.context.trustedActorId,
    } satisfies StoredGuiProjectionRequestEvidence)
    return Object.freeze({
      request,
      requestEvidenceJson,
      requestDigest,
    })
  } catch {
    return undefined
  }
}

function readStoredGuiProjectionRequestEvidence(
  candidate: unknown,
): StoredGuiProjectionRequestEvidence | undefined {
  if (!hasExactKeys(candidate, [
    'projectionVersion',
    'profileId',
    'requestDigest',
    'generation',
    'expectedRevision',
    'clientTxnId',
    'idempotencyKey',
    'committedAt',
    'trustedActorId',
  ])
    || candidate.projectionVersion !== GUI_PROFILE_PROJECTION_VERSION
    || !nonEmptyString(candidate.profileId)
    || typeof candidate.requestDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(candidate.requestDigest)
    || !positiveSafeInteger(candidate.generation)
    || !nonNegativeSafeInteger(candidate.expectedRevision)
    || !nonEmptyString(candidate.clientTxnId)
    || !nonEmptyString(candidate.idempotencyKey)
    || !canonicalTimestamp(candidate.committedAt)
    || !nonEmptyString(candidate.trustedActorId)) return undefined
  return candidate as unknown as StoredGuiProjectionRequestEvidence
}

function validGuiOrdinaryIdeaAuthorization(
  value: unknown,
): value is GuiOrdinaryNewIdeaAuthorization {
  return hasExactKeys(value, [
    'authorizationId',
    'profileId',
    'baseRevision',
    'ideaId',
    'boardId',
    'createdAt',
    'expiresAt',
  ])
    && nonEmptyString(value.authorizationId)
    && nonEmptyString(value.profileId)
    && nonNegativeSafeInteger(value.baseRevision)
    && nonEmptyString(value.ideaId)
    && value.boardId === `board:${value.ideaId}`
    && canonicalTimestamp(value.createdAt)
    && canonicalTimestamp(value.expiresAt)
    && Date.parse(value.createdAt) < Date.parse(value.expiresAt)
}

function readGuiAuthorizationById(
  runtime: SqliteRuntime,
  authorizationId: string,
): SqliteRow | undefined {
  return runtime.prepare(`
SELECT authorization_id, profile_id, base_revision, idea_id, board_id,
       created_at, expires_at, consumed_revision, consumed_idempotency_key
FROM profile_gui_idea_authorizations
WHERE authorization_id = ?
LIMIT 1
`).get(authorizationId)
}

function readGuiAuthorizationByTarget(
  runtime: SqliteRuntime,
  ideaId: string,
  boardId: string,
): SqliteRow | undefined {
  return runtime.prepare(`
SELECT authorization_id, profile_id, base_revision, idea_id, board_id,
       created_at, expires_at, consumed_revision, consumed_idempotency_key
FROM profile_gui_idea_authorizations
WHERE idea_id = ? OR board_id = ?
LIMIT 1
`).get(ideaId, boardId)
}

function guiAuthorizationFromRow(row: SqliteRow): GuiOrdinaryNewIdeaAuthorization {
  return Object.freeze({
    authorizationId: readString(row, 'authorization_id'),
    profileId: readString(row, 'profile_id'),
    baseRevision: readInteger(row, 'base_revision'),
    ideaId: readString(row, 'idea_id'),
    boardId: readString(row, 'board_id'),
    createdAt: readString(row, 'created_at'),
    expiresAt: readString(row, 'expires_at'),
  })
}

function readGuiProjectionRevisionByIdempotency(
  runtime: SqliteRuntime,
  idempotencyKey: string,
): SqliteRow | undefined {
  return runtime.prepare(`
SELECT revision, generation, client_txn_id, idempotency_key, request_digest,
       request_json, receipt_json, changed_record_ids_json,
       appended_intent_event_ids_json, authorization_ids_json,
       committed_at, trusted_actor_id
FROM profile_gui_projection_events
WHERE idempotency_key = ?
`).get(idempotencyKey)
}

function readGuiProjectionRevisionByClientTxn(
  runtime: SqliteRuntime,
  clientTxnId: string,
): SqliteRow | undefined {
  return runtime.prepare(`
SELECT revision, generation, client_txn_id, idempotency_key, request_digest,
       request_json, receipt_json, changed_record_ids_json,
       appended_intent_event_ids_json, authorization_ids_json,
       committed_at, trusted_actor_id
FROM profile_gui_projection_events
WHERE client_txn_id = ?
`).get(clientTxnId)
}

function guiProjectionReplayCollision(
  runtime: SqliteRuntime,
  evidence: GuiProjectionRequestEvidence,
  document: ProfileRevisionDocument,
): Readonly<{
  kind: 'none'
} | {
  kind: 'invalid'
} | {
  kind: 'replay'
  receipt: SqliteProfileGuiProjectionCommitReceipt
}> {
  if (readIdempotentRevision(runtime, evidence.request.idempotencyKey)
    || readLifecycleRevisionByIdempotency(runtime, evidence.request.idempotencyKey)
    || readAgentRevisionByIdempotency(runtime, evidence.request.idempotencyKey)) {
    return Object.freeze({ kind: 'invalid' })
  }
  const byKey = readGuiProjectionRevisionByIdempotency(
    runtime,
    evidence.request.idempotencyKey,
  )
  const byClient = readGuiProjectionRevisionByClientTxn(
    runtime,
    evidence.request.clientTxnId,
  )
  if (!byKey && !byClient) return Object.freeze({ kind: 'none' })
  if (!byKey || !byClient || readInteger(byKey, 'revision') !== readInteger(byClient, 'revision')
    || readString(byKey, 'idempotency_key') !== evidence.request.idempotencyKey
    || readString(byKey, 'client_txn_id') !== evidence.request.clientTxnId
    || readString(byKey, 'request_digest') !== evidence.requestDigest
    || readString(byKey, 'request_json') !== evidence.requestEvidenceJson
    || readInteger(byKey, 'generation') !== evidence.request.generation
    || readString(byKey, 'committed_at') !== evidence.request.committedAt
    || readString(byKey, 'trusted_actor_id') !== evidence.request.context.trustedActorId) {
    return Object.freeze({ kind: 'invalid' })
  }
  return Object.freeze({
    kind: 'replay',
    receipt: parseGuiProjectionReceipt(readString(byKey, 'receipt_json'), byKey, document),
  })
}

function validateGuiAuthorizationsForCommit(
  runtime: SqliteRuntime,
  request: GuiProfileProjectionRequest,
  authorizationIds: readonly string[],
): boolean {
  if (new Set(authorizationIds).size !== authorizationIds.length
    || authorizationIds.length !== request.context.ordinaryNewIdeas.length) return false
  for (const authorization of request.context.ordinaryNewIdeas) {
    if (!validGuiOrdinaryIdeaAuthorization(authorization)
      || authorization.profileId !== request.projection.profileId
      || authorization.baseRevision !== request.expectedRevision
      || Date.parse(authorization.createdAt) > Date.parse(request.committedAt)
      || Date.parse(request.committedAt) >= Date.parse(authorization.expiresAt)) return false
    const row = runtime.prepare(`
SELECT authorization_id, profile_id, base_revision, idea_id, board_id,
       created_at, expires_at, consumed_revision, consumed_idempotency_key
FROM profile_gui_idea_authorizations
WHERE authorization_id = ?
`).get(authorization.authorizationId)
    if (!row
      || readString(row, 'profile_id') !== authorization.profileId
      || readInteger(row, 'base_revision') !== authorization.baseRevision
      || readString(row, 'idea_id') !== authorization.ideaId
      || readString(row, 'board_id') !== authorization.boardId
      || readString(row, 'created_at') !== authorization.createdAt
      || readString(row, 'expires_at') !== authorization.expiresAt
      || readColumn(row, 'consumed_revision') !== null
      || readColumn(row, 'consumed_idempotency_key') !== null) return false
  }
  return true
}

function consumeGuiAuthorizations(
  runtime: SqliteRuntime,
  request: GuiProfileProjectionRequest,
  authorizationIds: readonly string[],
  revision: number,
): void {
  const consume = runtime.prepare(`
UPDATE profile_gui_idea_authorizations
SET consumed_revision = ?, consumed_idempotency_key = ?
WHERE authorization_id = ? AND profile_id = ? AND base_revision = ?
  AND idea_id = ? AND board_id = ? AND created_at = ? AND expires_at = ?
  AND consumed_revision IS NULL AND consumed_idempotency_key IS NULL
`)
  for (const authorizationId of authorizationIds) {
    const authorization = request.context.ordinaryNewIdeas.find(
      (candidate) => candidate.authorizationId === authorizationId,
    )
    if (!authorization) throw new SqliteProfileGuiInputError('GUI authorization closure changed')
    const result = consume.run(
      revision,
      request.idempotencyKey,
      authorization.authorizationId,
      authorization.profileId,
      authorization.baseRevision,
      authorization.ideaId,
      authorization.boardId,
      authorization.createdAt,
      authorization.expiresAt,
    )
    if (Number(result.changes) !== 1) {
      throw new SqliteProfileGuiInputError('GUI ordinary-Idea authorization was not consumed exactly once')
    }
  }
}

function planGuiProjectionRecordDiff(
  current: ProfileRevisionDocument,
  candidate: ProfileLogicalDocument,
  trustedActorId: string,
): GuiProjectionRecordPlan {
  const currentLogical = validatedLogicalDocument(current)
  const nextById = new Map(candidate.records.map((record) => [record.recordId, record] as const))
  const currentById = new Map(current.records.map((record) => [record.recordId, record] as const))
  const upsertedRecords: ProfileRevisionRecord[] = []
  const insertedRecords: ProfileRevisionRecord[] = []
  const deletedRecordIds: string[] = []
  const appendedIntentEventIds: string[] = []
  const durableTransitions: DurableRecordTransition[] = []
  const revision = candidate.head.revision

  for (const logicalRecord of currentLogical.records) {
    const previous = currentById.get(logicalRecord.recordId)
    if (!previous) throw new ProfileRevisionCorruptionError('Current logical Profile record is missing')
    const next = nextById.get(logicalRecord.recordId)
    if (!next) {
      if (logicalRecord.kind === 'profile-agent-event') {
        throw new SqliteProfileGuiInputError('GUI projection cannot delete a Profile Agent event')
      }
      if (logicalRecord.kind === 'intent-event' && nextById.has(logicalRecord.ownerId)) {
        throw new SqliteProfileGuiInputError(
          'GUI projection cannot delete an Intent event while retaining its owning Board',
        )
      }
      deletedRecordIds.push(logicalRecord.recordId)
      durableTransitions.push(Object.freeze({
        recordId: logicalRecord.recordId,
        changeKind: 'delete',
        before: logicalRecord,
        after: null,
      }))
      continue
    }
    if (next.kind !== logicalRecord.kind) {
      throw new SqliteProfileGuiInputError('GUI projection cannot change a record kind')
    }
    if (canonicalProfileJson(next) === canonicalProfileJson(logicalRecord)) continue
    if (logicalRecord.kind === 'intent-event' || logicalRecord.kind === 'profile-agent-event') {
      throw new SqliteProfileGuiInputError(
        `GUI projection cannot rewrite a ${logicalRecord.kind === 'intent-event'
          ? 'Board Intent'
          : 'Profile Agent'} event`,
      )
    }
    upsertedRecords.push(Object.freeze({
      ...next,
      createdRevision: previous.createdRevision,
      updatedRevision: revision,
    }))
    durableTransitions.push(Object.freeze({
      recordId: logicalRecord.recordId,
      changeKind: 'update',
      before: logicalRecord,
      after: next,
    }))
  }

  for (const next of candidate.records) {
    if (currentById.has(next.recordId)) continue
    if (next.kind === 'profile-agent-event') {
      throw new SqliteProfileGuiInputError('GUI projection cannot insert a Profile Agent event')
    }
    if (next.kind === 'intent-event') {
      if (!isObjectRecord(next.payload) || next.payload.actorId !== trustedActorId) {
        throw new SqliteProfileGuiInputError('GUI Intent suffix actor attribution changed')
      }
      appendedIntentEventIds.push(next.recordId)
    }
    insertedRecords.push(Object.freeze({
      ...next,
      createdRevision: revision,
      updatedRevision: revision,
    }))
    durableTransitions.push(Object.freeze({
      recordId: next.recordId,
      changeKind: 'insert',
      before: null,
      after: next,
    }))
  }

  const changedRecordIds = [
    ...deletedRecordIds,
    ...upsertedRecords.map((record) => record.recordId),
    ...insertedRecords.map((record) => record.recordId),
  ].sort()
  return Object.freeze({
    upsertedRecords: Object.freeze(upsertedRecords),
    insertedRecords: Object.freeze(insertedRecords),
    deletedRecordIds: Object.freeze(deletedRecordIds.sort()),
    changedRecordIds: Object.freeze(changedRecordIds),
    appendedIntentEventIds: Object.freeze(appendedIntentEventIds.sort()),
    durableTransitions: Object.freeze(durableTransitions.sort((left, right) => (
      codeUnitCompare(left.recordId, right.recordId)
    ))),
  })
}

function insertGuiProjectionRevision(
  runtime: SqliteRuntime,
  evidence: GuiProjectionRequestEvidence,
  receipt: SqliteProfileGuiProjectionCommitReceipt,
  plan: GuiProjectionRecordPlan,
): void {
  runtime.prepare(`
INSERT INTO profile_revisions (
  profile_id, revision, previous_revision, commit_id, committed_at,
  actor_id, actor_kind, actor_transport, client_txn_id, idempotency_key,
  batch_digest, batch_json, receipt_json
) SELECT profile_id, ?, ?, ?, ?, ?, 'user', NULL, ?, NULL, NULL, NULL, NULL
FROM profile_meta
`).run(
    receipt.revision,
    receipt.previousRevision,
    receipt.commitId,
    evidence.request.committedAt,
    evidence.request.context.trustedActorId,
    evidence.request.clientTxnId,
  )
  runtime.prepare(`
INSERT INTO profile_gui_projection_events (
  profile_id, revision, generation, client_txn_id, idempotency_key,
  request_digest, request_json, receipt_json, changed_record_ids_json,
  appended_intent_event_ids_json, authorization_ids_json, committed_at,
  trusted_actor_id
) SELECT profile_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM profile_meta
`).run(
    receipt.revision,
    evidence.request.generation,
    evidence.request.clientTxnId,
    evidence.request.idempotencyKey,
    evidence.requestDigest,
    evidence.requestEvidenceJson,
    canonicalProfileJson(receipt),
    canonicalProfileJson(receipt.changedRecordIds),
    canonicalProfileJson(receipt.appendedIntentEventIds),
    canonicalProfileJson(receipt.authorizationIds),
    evidence.request.committedAt,
    evidence.request.context.trustedActorId,
  )
  const insertChange = runtime.prepare(`
INSERT INTO profile_gui_projection_record_changes (
  profile_id, revision, record_id, change_kind, before_digest, after_digest
) SELECT profile_id, ?, ?, ?, ?, ? FROM profile_meta
`)
  for (const change of plan.durableTransitions) {
    insertChange.run(
      receipt.revision,
      change.recordId,
      change.changeKind,
      change.before === null ? null : logicalRecordDigest(change.before),
      change.after === null ? null : logicalRecordDigest(change.after),
    )
  }
}

function updateGuiProjectionHead(
  runtime: SqliteRuntime,
  candidate: ProfileLogicalDocument,
  request: GuiProfileProjectionRequest,
): void {
  const result = runtime.prepare(`
UPDATE profile_meta
SET current_revision = ?, active_idea_id = ?, updated_at = ?
WHERE profile_id = ? AND current_revision = ?
`).run(
    candidate.head.revision,
    candidate.head.activeIdeaId,
    request.committedAt,
    candidate.head.profileId,
    request.expectedRevision,
  )
  if (Number(result.changes) !== 1) {
    throw new Error('SQLite GUI Profile revision compare-and-swap failed')
  }
}

function parseGuiProjectionReceipt(
  json: string,
  row: SqliteRow,
  document: ProfileRevisionDocument,
): SqliteProfileGuiProjectionCommitReceipt {
  const value = parseJson(json, 'Profile GUI projection receipt')
  if (!hasExactKeys(value, [
    'previousRevision',
    'revision',
    'commitId',
    'generation',
    'clientTxnId',
    'idempotencyKey',
    'deletedRecordIds',
    'changedRecordIds',
    'appendedIntentEventIds',
    'authorizationIds',
    'replayed',
  ]) || !isUniqueStringArray(value.deletedRecordIds)) {
    throw new ProfileRevisionCorruptionError('Profile GUI projection receipt is invalid')
  }
  const previousRevision = readInteger(row, 'revision') - 1
  const receipt: SqliteProfileGuiProjectionCommitReceipt = Object.freeze({
    previousRevision,
    revision: readInteger(row, 'revision'),
    commitId: `gui:${readString(row, 'client_txn_id')}`,
    generation: readInteger(row, 'generation'),
    clientTxnId: readString(row, 'client_txn_id'),
    idempotencyKey: readString(row, 'idempotency_key'),
    deletedRecordIds: Object.freeze([...value.deletedRecordIds].sort()),
    changedRecordIds: readCanonicalStringArray(row, 'changed_record_ids_json'),
    appendedIntentEventIds: readCanonicalStringArray(row, 'appended_intent_event_ids_json'),
    authorizationIds: readCanonicalStringArray(row, 'authorization_ids_json'),
    replayed: false,
  })
  if (receipt.revision > document.head.revision
    || !nonNegativeSafeInteger(value.previousRevision)
    || !nonNegativeSafeInteger(value.revision)
    || !positiveSafeInteger(value.generation)
    || value.previousRevision !== receipt.previousRevision
    || value.revision !== receipt.revision
    || value.commitId !== receipt.commitId
    || value.generation !== receipt.generation
    || value.clientTxnId !== receipt.clientTxnId
    || value.idempotencyKey !== receipt.idempotencyKey
    || !isUniqueStringArray(value.deletedRecordIds)
    || !isUniqueStringArray(value.changedRecordIds)
    || !isUniqueStringArray(value.appendedIntentEventIds)
    || !isUniqueStringArray(value.authorizationIds)
    || canonicalProfileJson([...value.deletedRecordIds].sort())
      !== canonicalProfileJson(receipt.deletedRecordIds)
    || canonicalProfileJson([...value.changedRecordIds].sort())
      !== canonicalProfileJson(receipt.changedRecordIds)
    || canonicalProfileJson([...value.appendedIntentEventIds].sort())
      !== canonicalProfileJson(receipt.appendedIntentEventIds)
    || canonicalProfileJson([...value.authorizationIds].sort())
      !== canonicalProfileJson(receipt.authorizationIds)
    || value.replayed !== false
    || canonicalProfileJson(receipt) !== json) {
    throw new ProfileRevisionCorruptionError('Profile GUI projection receipt evidence is invalid')
  }
  return receipt
}

function readCanonicalStringArray(row: SqliteRow, key: string): readonly string[] {
  const json = readString(row, key)
  const value = parseJson(json, `Profile GUI projection ${key}`)
  if (!isUniqueStringArray(value) || canonicalProfileJson([...value].sort()) !== json) {
    throw new ProfileRevisionCorruptionError(`Profile GUI projection ${key} is invalid`)
  }
  return Object.freeze([...value])
}

type SeedProfileAgentEventManifestEntry = Readonly<{
  recordId: string
  logicalRecordDigest: string
}>

function readSeedProfileAgentEventManifest(
  runtime: SqliteRuntime,
  maximumEntryCount: number,
): readonly SeedProfileAgentEventManifestEntry[] {
  const byteLength = readInteger(runtime.prepare(`
SELECT length(CAST(seed_profile_agent_event_manifest_json AS BLOB)) AS manifest_bytes
FROM profile_meta
`).get(), 'manifest_bytes')
  if (byteLength > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxProfileBytes) {
    throw new ProfileRevisionCorruptionError('SQLite Profile seed Agent event manifest exceeds its bound')
  }
  const row = runtime.prepare(`
SELECT seed_profile_agent_event_manifest_json
FROM profile_meta
`).get()
  const manifestColumn = readColumn(row, 'seed_profile_agent_event_manifest_json')
  if (typeof manifestColumn !== 'string') {
    throw new ProfileRevisionCorruptionError('SQLite Profile seed Agent event manifest is invalid')
  }
  const json = manifestColumn
  const value = parseJson(json, 'SQLite Profile seed Agent event manifest')
  if (!Array.isArray(value) || value.length > maximumEntryCount) {
    throw new ProfileRevisionCorruptionError('SQLite Profile seed Agent event manifest is invalid')
  }
  if (!value.every(isSeedProfileAgentEventManifestEntry)
    || new Set(value.map((entry) => entry.recordId)).size !== value.length
    || canonicalProfileJson(value) !== json) {
    throw new ProfileRevisionCorruptionError('SQLite Profile seed Agent event manifest is invalid')
  }
  return Object.freeze(value.map((entry) => Object.freeze({
    recordId: entry.recordId,
    logicalRecordDigest: entry.logicalRecordDigest,
  })))
}

function isSeedProfileAgentEventManifestEntry(
  value: unknown,
): value is SeedProfileAgentEventManifestEntry {
  return hasExactKeys(value, ['recordId', 'logicalRecordDigest'])
    && typeof value.recordId === 'string'
    && value.recordId.length > 0
    && Buffer.byteLength(value.recordId, 'utf8') <= PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes
    && validSha256(value.logicalRecordDigest)
}

function guiStoreFailure(
  error: unknown,
  currentRevision?: number,
): ProfileServiceResult<never> {
  return profileServiceFailure(
    error instanceof ProfileUnsupportedFutureVersionError
      ? 'unsupported-future-version'
      : error instanceof SqliteProfileGuiInputError
        ? 'invalid'
        : error instanceof SqliteProfileBlobCorruptionError
        || error instanceof ProfileRevisionCorruptionError
        || error instanceof ProfileLogicalProjectionError
          ? 'corrupt-or-recovery-required'
          : isBusyError(error) || error instanceof SqliteProfileOwnershipCapabilityError
            ? 'busy'
            : 'internal',
    {
      ...(currentRevision === undefined ? {} : { currentRevision }),
      ...(error instanceof ProfileUnsupportedFutureVersionError
        ? { supportedVersions: error.supportedVersions }
        : {}),
    },
  )
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0)
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function readIdempotentRevision(
  runtime: SqliteRuntime,
  idempotencyKey: string,
): {
  batchDigest: string
  batchJson: string
  receiptJson: string
  identity: {
    revision: number
    previousRevision: number
    commitId: string
    committedAt: string
    actorId: string
    clientTxnId: string
  }
} | undefined {
  const row = runtime.prepare(`
SELECT revision, previous_revision, commit_id, committed_at, actor_id, client_txn_id,
       batch_digest, batch_json, receipt_json
FROM profile_revisions
WHERE idempotency_key = ?
`).get(idempotencyKey)
  if (!row) return undefined
  const identity = {
    revision: readInteger(row, 'revision'),
    previousRevision: readInteger(row, 'previous_revision'),
    commitId: readString(row, 'commit_id'),
    committedAt: readString(row, 'committed_at'),
    actorId: readString(row, 'actor_id'),
    clientTxnId: readString(row, 'client_txn_id'),
  }
  if (identity.revision !== identity.previousRevision + 1) {
    throw new Error('SQLite Profile persisted revision does not advance its predecessor')
  }
  return {
    batchDigest: readString(row, 'batch_digest'),
    batchJson: readString(row, 'batch_json'),
    receiptJson: readString(row, 'receipt_json'),
    identity,
  }
}

function readLifecycleRevisionByIdempotency(
  runtime: SqliteRuntime,
  idempotencyKey: string,
): SqliteRow | undefined {
  return runtime.prepare(`
SELECT revision, kind, operation_id, idempotency_key, request_digest,
       request_json, receipt_json, inserted_record_ids_json, committed_at
FROM profile_lifecycle_events
WHERE idempotency_key = ?
`).get(idempotencyKey)
}

function readLifecycleRevisionByOperation(
  runtime: SqliteRuntime,
  operationId: string,
): SqliteRow | undefined {
  return runtime.prepare(`
SELECT revision, kind, operation_id, idempotency_key, request_digest,
       request_json, receipt_json, inserted_record_ids_json, committed_at
FROM profile_lifecycle_events
WHERE operation_id = ?
`).get(operationId)
}

function insertLifecycleRevision(
  runtime: SqliteRuntime,
  input: SqliteProfileIdeaLifecycleRevisionInput,
  revision: number,
  requestDigest: string,
  requestJson: string,
  receiptJson: string,
): void {
  runtime.prepare(`
INSERT INTO profile_revisions (
  profile_id, revision, previous_revision, commit_id, committed_at,
  actor_id, actor_kind, actor_transport, client_txn_id, idempotency_key,
  batch_digest, batch_json, receipt_json
) SELECT profile_id, ?, ?, ?, ?, 'profile-lifecycle', 'system', NULL, ?, NULL, NULL, NULL, NULL
FROM profile_meta
`).run(
    revision,
    input.expectedRevision,
    `lifecycle:${input.operationId}`,
    input.committedAt,
    input.operationId,
  )
  const insertedRecordIdsJson = canonicalProfileJson(
    (JSON.parse(receiptJson) as ProfileIdeaLifecycleReceipt).insertedRecordIds,
  )
  runtime.prepare(`
INSERT INTO profile_lifecycle_events (
  profile_id, revision, kind, operation_id, idempotency_key, request_digest,
  request_json, receipt_json, inserted_record_ids_json, committed_at
) SELECT profile_id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM profile_meta
`).run(
    revision,
    input.kind,
    input.operationId,
    input.idempotencyKey,
    requestDigest,
    requestJson,
    receiptJson,
    insertedRecordIdsJson,
    input.committedAt,
  )
}

function parseLifecycleReceipt(
  json: string,
  row: SqliteRow,
  document: ProfileRevisionDocument,
): ProfileIdeaLifecycleReceipt {
  const value = parseJson(json, 'Profile lifecycle receipt')
  if (!hasExactKeys(value, [
    'importedAssetIds',
    'insertedRecordIds',
    'kind',
    'operationId',
    'previousRevision',
    'replayed',
    'revision',
    'targetIdeaId',
  ]) || (value.kind !== 'duplicate-idea' && value.kind !== 'import-idea')
    || value.operationId !== readString(row, 'operation_id')
    || value.operationId === ''
    || !Number.isSafeInteger(value.previousRevision)
    || !Number.isSafeInteger(value.revision)
    || Number(value.revision) !== readInteger(row, 'revision')
    || Number(value.previousRevision) + 1 !== Number(value.revision)
    || Number(value.revision) > document.head.revision
    || !isNonEmptyStringArray(value.insertedRecordIds)
    || !Array.isArray(value.importedAssetIds)
    || value.importedAssetIds.some((id) => typeof id !== 'string' || id.length === 0)
    || new Set(value.importedAssetIds).size !== value.importedAssetIds.length
    || typeof value.targetIdeaId !== 'string'
    || value.targetIdeaId.length === 0
    || value.replayed !== false) {
    throw new ProfileRevisionCorruptionError('SQLite Profile lifecycle receipt is invalid')
  }
  const receipt: ProfileIdeaLifecycleReceipt = {
    kind: value.kind,
    operationId: value.operationId,
    previousRevision: Number(value.previousRevision),
    revision: Number(value.revision),
    targetIdeaId: value.targetIdeaId,
    insertedRecordIds: [...value.insertedRecordIds],
    importedAssetIds: [...value.importedAssetIds].sort(),
    replayed: false,
  }
  if (canonicalProfileJson(receipt) !== json) {
    throw new ProfileRevisionCorruptionError('SQLite Profile lifecycle receipt is not canonical')
  }
  return Object.freeze(receipt)
}

function validateLifecycleInput(input: SqliteProfileIdeaLifecycleRevisionInput): void {
  if ((input.kind !== 'duplicate-idea' && input.kind !== 'import-idea')
    || input.operationId.length === 0
    || input.idempotencyKey.length === 0
    || !Number.isSafeInteger(input.expectedRevision)
    || input.expectedRevision < 0
    || input.targetIdeaId.length === 0
    || !Array.isArray(input.importedAssetIds)
    || input.importedAssetIds.some((id) => typeof id !== 'string' || id.length === 0)
    || new Set(input.importedAssetIds).size !== input.importedAssetIds.length
    || !canonicalTimestamp(input.committedAt)) throw new Error('SQLite Profile lifecycle input is invalid')
}

function validLifecycleInsertion(
  targetIdeaId: string,
  records: readonly ProfileLogicalRecordSpec[],
): boolean {
  const boardId = `board:${targetIdeaId}`
  const idea = records.filter((record) => record.kind === 'idea' && record.recordId === targetIdeaId)
  const board = records.filter((record) => record.kind === 'board' && record.recordId === boardId)
  return idea.length === 1
    && board.length === 1
    && records.every((record) => (
      record.recordId === targetIdeaId
        ? record.ownerId === idea[0]!.ownerId && record.parentId === idea[0]!.parentId
        : record.recordId === boardId
          ? record.ownerId === targetIdeaId && record.parentId === targetIdeaId
          : record.ownerId === boardId
    ))
}

function validLifecycleSurvivingRecord(
  targetIdeaId: string,
  record: ProfileLogicalRecordSpec,
): boolean {
  const boardId = `board:${targetIdeaId}`
  if (record.recordId === targetIdeaId) return record.kind === 'idea'
  if (record.recordId === boardId) {
    return record.kind === 'board'
      && record.ownerId === targetIdeaId
      && record.parentId === targetIdeaId
  }
  return record.ownerId === boardId
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function insertRevision(
  runtime: SqliteRuntime,
  batch: ProfileCommandBatch,
  batchDigest: string,
  batchJson: string,
  receipt: ProfileCommandBatchReceipt,
): void {
  runtime.prepare(`
INSERT INTO profile_revisions (
  profile_id, revision, previous_revision, commit_id, committed_at,
  actor_id, actor_kind, actor_transport, client_txn_id, idempotency_key,
  batch_digest, batch_json, receipt_json
) SELECT profile_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM profile_meta
`).run(
    receipt.revision,
    receipt.previousRevision,
    receipt.commitId,
    receipt.intentEvents[0]?.at ?? '',
    batch.actor.id,
    batch.actor.kind,
    batch.actor.transport,
    batch.clientTxnId,
    batch.idempotencyKey,
    batchDigest,
    batchJson,
    canonicalProfileJson(receipt),
  )
}

function writePlanRecords(
  runtime: SqliteRuntime,
  profileId: string,
  plan: {
    upsertedRecords: readonly ProfileRevisionRecord[]
    insertedRecords: readonly ProfileRevisionRecord[]
    deletedRecordIds: readonly string[]
  },
): void {
  const remove = runtime.prepare(`
DELETE FROM profile_records
WHERE profile_id = ? AND record_id = ?
`)
  for (const recordId of plan.deletedRecordIds) {
    const result = remove.run(profileId, recordId)
    if (Number(result.changes) !== 1) throw new Error(`SQLite Profile record ${recordId} was not deleted`)
  }
  const update = runtime.prepare(`
UPDATE profile_records
SET owner_id = ?, parent_id = ?, ordinal = ?, record_version = ?,
    updated_revision = ?, payload_json = ?
WHERE profile_id = ? AND record_id = ? AND kind = ?
`)
  for (const record of plan.upsertedRecords) {
    const result = update.run(
      record.ownerId,
      record.parentId,
      record.ordinal,
      record.recordVersion,
      record.updatedRevision,
      canonicalProfileJson(record.payload),
      profileId,
      record.recordId,
      record.kind,
    )
    if (Number(result.changes) !== 1) throw new Error(`SQLite Profile record ${record.recordId} was not updated`)
  }
  for (const record of plan.insertedRecords) insertRecord(runtime, profileId, record)
}

function insertRecord(runtime: SqliteRuntime, profileId: string, record: ProfileRevisionRecord): void {
  runtime.prepare(`
INSERT INTO profile_records (
  profile_id, record_id, kind, owner_id, parent_id, ordinal, record_version,
  created_revision, updated_revision, payload_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    profileId,
    record.recordId,
    record.kind,
    record.ownerId,
    record.parentId,
    record.ordinal,
    record.recordVersion,
    record.createdRevision,
    record.updatedRevision,
    canonicalProfileJson(record.payload),
  )
}

function updateHead(
  runtime: SqliteRuntime,
  document: ProfileRevisionDocument,
  receipt: ProfileCommandBatchReceipt,
): void {
  const updatedAt = receipt.intentEvents[0]?.at
  if (!updatedAt) throw new Error('SQLite Profile commit is missing its attributed event time')
  const result = runtime.prepare(`
UPDATE profile_meta
SET current_revision = ?, active_idea_id = ?, updated_at = ?
WHERE profile_id = ? AND current_revision = ?
`).run(
    document.head.revision,
    document.head.activeIdeaId,
    updatedAt,
    document.head.profileId,
    receipt.previousRevision,
  )
  if (Number(result.changes) !== 1) throw new Error('SQLite Profile revision compare-and-swap failed')
}

function parseReceipt(
  json: string,
  identity: {
    revision: number
    previousRevision: number
    commitId: string
    committedAt: string
    actorId: string
    clientTxnId: string
  },
  batch: ProfileCommandBatch,
  document: ProfileRevisionDocument,
): ProfileCommandBatchReceipt {
  const value = parseJson(json, 'Profile command receipt')
  if (!hasExactKeys(value, [
    'affectedIds',
    'commandIds',
    'commitId',
    'dryRun',
    'intentEvents',
    'previousRevision',
    'replayed',
    'revision',
  ])) throw new Error('Profile command receipt is invalid')
  const receipt = value
  const command = batch.commands[0]
  const semantics = command ? readReceiptSemantics(command.name, command.payload) : undefined
  if (
    identity.revision > document.head.revision
    || batch.dryRun
    || batch.expectedRevision !== identity.previousRevision
    || batch.actor.id !== identity.actorId
    || batch.clientTxnId !== identity.clientTxnId
    || batch.commands.length !== 1
    || !command
    || !semantics
    || !Number.isSafeInteger(receipt.previousRevision)
    || Number(receipt.previousRevision) !== identity.previousRevision
    || !Number.isSafeInteger(receipt.revision)
    || Number(receipt.revision) !== identity.revision
    || receipt.commitId !== identity.commitId
    || !isNonEmptyStringArray(receipt.commandIds)
    || receipt.commandIds.length !== 1
    || !isNonEmptyStringArray(receipt.affectedIds)
    || canonicalProfileJson(receipt.affectedIds) !== canonicalProfileJson(semantics.affectedIds)
    || !Array.isArray(receipt.intentEvents)
    || receipt.intentEvents.length !== 1
    || receipt.dryRun !== false
    || receipt.replayed !== false
    || receipt.commandIds[0] !== command.id
  ) throw new Error('Profile command receipt is invalid')

  const event = receipt.intentEvents[0]
  if (
    !hasExactKeys(event, [
      'actorId',
      'at',
      'cardId',
      'clientTxnId',
      'commitId',
      'data',
      'id',
      'ideaId',
      'seq',
      'type',
    ])
    || typeof event.id !== 'string'
    || event.id.length === 0
    || event.at !== identity.committedAt
    || event.ideaId !== semantics.ideaId
    || event.type !== 'card.content.edited'
    || event.cardId !== semantics.cardId
    || event.commitId !== identity.commitId
    || event.actorId !== identity.actorId
    || event.clientTxnId !== identity.clientTxnId
    || !Number.isSafeInteger(event.seq)
    || Number(event.seq) <= 0
    || canonicalProfileJson(event.data) !== canonicalProfileJson(semantics.eventData)
  ) throw new Error('Profile command receipt event is invalid')

  const normalizedEvent: ProfileCommandBatchReceipt['intentEvents'][number] = {
    id: event.id,
    at: identity.committedAt,
    ideaId: semantics.ideaId,
    type: 'card.content.edited',
    cardId: semantics.cardId,
    data: semantics.eventData,
    commitId: identity.commitId,
    actorId: identity.actorId,
    clientTxnId: identity.clientTxnId,
    seq: Number(event.seq),
  }
  const expectedBoardId = `board:${semantics.ideaId}`
  const persistedEvent = document.records.find((record) => (
    record.kind === 'intent-event' && record.recordId === normalizedEvent.id
  ))
  if ((!persistedEvent && identity.revision === document.head.revision)
    || (persistedEvent && (
      persistedEvent.ownerId !== expectedBoardId
      || persistedEvent.parentId !== expectedBoardId
      || persistedEvent.createdRevision !== identity.revision
      || persistedEvent.updatedRevision !== identity.revision
      || canonicalProfileJson(persistedEvent.payload) !== canonicalProfileJson(normalizedEvent)
    ))) throw new Error('Profile command receipt is not bound to its persisted Intent event')

  const normalizedReceipt: ProfileCommandBatchReceipt = {
    previousRevision: identity.previousRevision,
    revision: identity.revision,
    commitId: identity.commitId,
    commandIds: [...receipt.commandIds],
    affectedIds: [...semantics.affectedIds],
    intentEvents: [normalizedEvent],
    dryRun: false,
    replayed: false,
  }
  if (canonicalProfileJson(normalizedReceipt) !== json) {
    throw new Error('Profile command receipt is not canonical')
  }
  return normalizedReceipt
}

function readReceiptSemantics(
  commandName: ProfileCommandBatch['commands'][number]['name'],
  value: unknown,
): {
  ideaId: string
  cardId: string
  affectedIds: string[]
  eventData: Extract<IntentLogEvent, { type: 'card.content.edited' }>['data']
} | undefined {
  if (commandName === 'card.update-content') {
    if (
      !isObjectRecord(value)
      || typeof value.ideaId !== 'string'
      || typeof value.cardId !== 'string'
      || typeof value.blockId !== 'string'
      || typeof value.text !== 'string'
    ) return undefined
    return {
      ideaId: value.ideaId,
      cardId: value.cardId,
      affectedIds: [value.cardId, value.blockId],
      eventData: { field: 'body', textLength: value.text.length },
    }
  }
  if (commandName === 'card.asset.add') {
    const payload = readProfileAssetAddReference(value)
    if (!payload) return undefined
    return {
      ideaId: payload.ideaId,
      cardId: payload.cardId,
      affectedIds: [payload.cardId, payload.asset.id],
      eventData: { field: 'assets', action: 'add', assetId: payload.asset.id },
    }
  }
  if (commandName === 'card.asset.remove') {
    const payload = readProfileAssetRemoveInput(value)
    if (!payload) return undefined
    return {
      ideaId: payload.ideaId,
      cardId: payload.cardId,
      affectedIds: [payload.cardId, payload.assetId],
      eventData: { field: 'assets', action: 'remove', assetId: payload.assetId },
    }
  }
  return undefined
}

function cloneBatch(batch: ProfileCommandBatch): ProfileCommandBatch {
  return parseJson(canonicalProfileJson(batch), 'Profile retry batch') as ProfileCommandBatch
}

function parseJson(json: string, label: string): unknown {
  try {
    return JSON.parse(json) as unknown
  } catch {
    throw new ProfileRevisionCorruptionError(`${label} is not valid JSON`)
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isObjectRecord(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isUniqueStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(nonEmptyString)
    && new Set(value).size === value.length
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0
    && value.every((entry) => typeof entry === 'string' && entry.length > 0)
}

function readLiteralOne(row: SqliteRow | undefined, key: string): 1 {
  return readExpectedVersion(row, key, 1)
}

function readExpectedVersion<Version extends number>(
  row: SqliteRow | undefined,
  key: string,
  expected: Version,
): Version {
  const version = readInteger(row, key)
  if (version > expected) {
    throw new ProfileUnsupportedFutureVersionError(`SQLite Profile ${key} is from a future version`)
  }
  if (version !== expected) {
    throw new ProfileRevisionCorruptionError(`SQLite Profile ${key} is invalid`)
  }
  return expected
}

function profileAgentSpatialServiceResult<Value>(
  result: ProfileAgentSpatialResult<Value>,
): ProfileServiceResult<Value> {
  if (result.ok) return result
  switch (result.reason) {
    case 'idea-not-found':
    case 'card-not-found':
      return profileServiceFailure('not-found')
    case 'profile-invalid':
      return profileServiceFailure('corrupt-or-recovery-required')
    case 'card-idea-mismatch':
    case 'invalid-request':
    case 'no-bounded-space':
      return profileServiceFailure('invalid')
  }
}

function profileStoreReadFailure(error: unknown): ProfileServiceResult<never> {
  if (error instanceof ProfileUnsupportedFutureVersionError) {
    return profileServiceFailure('unsupported-future-version', {
      supportedVersions: error.supportedVersions,
    })
  }
  return profileServiceFailure(
    error instanceof SqliteProfileOwnershipCapabilityError
      || error instanceof ProfileRevisionCorruptionError
      || error instanceof SqliteProfileBlobCorruptionError
      ? 'corrupt-or-recovery-required'
      : 'internal',
  )
}

function readInteger(row: SqliteRow | undefined, key: string): number {
  const value = readColumn(row, key)
  const number = typeof value === 'bigint' ? Number(value) : value
  if (!Number.isSafeInteger(number) || Number(number) < 0) {
    throw new Error(`SQLite Profile ${key} is invalid`)
  }
  return Number(number)
}

function readString(row: SqliteRow | undefined, key: string): string {
  return requireString(readColumn(row, key), key)
}

function requireString(value: SqliteOutput | undefined, key: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`SQLite Profile ${key} is invalid`)
  return value
}

function readColumn(row: SqliteRow | undefined, key: string): SqliteOutput | undefined {
  if (!row || !(key in row)) return undefined
  return row[key]
}

function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const sqliteError = error as Error & { code?: unknown; errcode?: unknown }
  if (sqliteError.code === 'ERR_SQLITE_BUSY') return true
  return sqliteError.code === 'ERR_SQLITE_ERROR'
    && typeof sqliteError.errcode === 'number'
    && (sqliteError.errcode & 0xff) === 5
}
