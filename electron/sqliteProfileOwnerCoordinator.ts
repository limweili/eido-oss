import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  unlinkSync,
} from 'node:fs'
import path from 'node:path'
import type { CardAuthorship } from '../src/graph/types'
import {
  validateProfileAgentChangeTrailRequest,
  type ProfileAgentChangeTrailPage,
  type ProfileAgentChangeTrailRequest,
} from '../src/persistence/profileAgentChangeTrail'
import {
  normalizeProfileAgentCardNeighborsRequest,
  normalizeProfileAgentCardSetBoundsRequest,
  type NormalizedProfileAgentCardNeighborsRequest,
  type ProfileAgentCardNeighbors,
  type ProfileAgentCardSetBounds,
  type ProfileAgentCardSetBoundsRequest,
} from '../src/persistence/profileAgentSpatialQuery'
import type {
  GuiOrdinaryNewIdeaAuthorization,
  GuiProfileProjectionRequest,
} from '../src/persistence/profileGuiProjection'
import {
  PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
  validateInstalledProfileAgentCommandRequest,
  type ProfileAgentCommandBatchReceipt,
  type ProfileAgentInstalledTransport,
} from '../src/persistence/profileAgentCommandInstallation'
import {
  captureProfileGuiInertJson,
  ProfileGuiJsonCaptureError,
} from '../src/persistence/profileGuiSaveScheduler'
import type {
  ProfileCommandBatch,
  ProfileCommandBatchReceipt,
  ProfileCapabilities,
  ProfileOwnershipRequest,
  ProfileDuplicateIdeaRequest,
  ProfileIdeaLifecycleReceipt,
  ProfileImportIdeaClosureRequest,
  ProfilePortableExportReceipt,
  ProfilePortableExportRequest,
  ProfilePortableFreshImportReceipt,
  ProfilePortableFreshImportRequest,
  ProfileQueryPage,
  ProfileQueryRequest,
  ProfileRecoveryPointSummary,
  ProfileRecoveryRequest,
  ProfileServiceResult,
  ProfileSnapshot,
  ProfileStatus,
} from '../src/persistence/profileServiceContract'
import {
  ProfileUnsupportedFutureVersionError,
  profileServiceFailure,
  validateProfileCommandBatch,
  validateProfileQuery,
} from '../src/persistence/profileServiceContract'
import {
  canonicalProfileJson,
  ProfileRevisionCorruptionError,
} from '../src/persistence/profileRevisionKernel'
import { canonicalProfilePortableDocumentBytes } from '../src/persistence/profilePortableArchive'
import { projectProfileSnapshot } from '../src/persistence/profileLogicalProjection'
import {
  validateProfileResultInspectionRequest,
  type ProfileResultInspectionPage,
  type ProfileResultInspectionRequest,
} from '../src/persistence/profileResultInspection'
import {
  createSqliteProfileBlobStore,
  SqliteProfileBlobCorruptionError,
  type SqliteProfileBlobCandidates,
  type SqliteProfileBlobStore,
} from './sqliteProfileBlobStore'
import {
  createSqliteProfileRevisionStore,
  claimSqliteProfileImportStage,
  createSqliteProfileImportStage,
  inspectSqliteProfileRevisionDatabase,
  readProfileLogicalBlobRoots,
  salvageCurrentSqliteProfileSnapshot,
  type SqliteProfileRevisionStore,
  type SqliteProfileRevisionStoreOptions,
  type SqliteProfileGuiProjectionCommitReceipt,
} from './sqliteProfileRevisionStore'
import {
  createSqliteProfileGuiProjectionAdapter,
  type SqliteProfileGuiProjectionAdapter,
} from './sqliteProfileGuiProjection'
import {
  createSqliteProfileRecoveryManager,
  isSqliteProfileRecoveryCandidateId,
  type SqliteProfileRecoveryInspection,
  type SqliteProfileRecoveryManager,
  type SqliteProfileRecoveryManagerOptions,
  type SqliteProfileRecoveryRestoreReceipt,
  type SqliteProfileStartFreshReceipt,
} from './sqliteProfileRecovery'
import {
  assertSameSqlitePhysicalFile as assertSamePhysicalFile,
  captureSqlitePhysicalFile as capturePhysicalFile,
  issueSqliteProfileOwnershipCapability,
  requireSqlitePhysicalFile as requirePhysicalFile,
  SqliteProfileOwnershipCapabilityError as PhysicalAuthorityError,
  type SqlitePhysicalFileIdentity as PhysicalFileIdentity,
  type SqliteProfileOwnershipCapability,
} from './sqliteProfileOwnerCapability'
import {
  openSqliteExclusiveRuntime,
  type SqliteExclusiveRuntime,
  type SqliteOutput,
  type SqliteRow,
  type SqliteRuntime,
} from './sqliteRuntime'
import type { ProfilePortableZipDestination } from './profilePortableZip'
import type { ProfilePortableSource } from './profilePortableSource'
import {
  createSqliteProfilePortableLifecycle,
  type SqlitePreparedFreshProfileImport,
  type SqliteProfilePortableLifecycle,
} from './sqliteProfilePortableLifecycle'

export type SqliteProfileOwner = Readonly<{
  ownerId: string
  generation: number
  route: ProfileOwnershipRequest['route']
}>

export interface SqliteProfileOwnerCoordinator {
  readonly owner: SqliteProfileOwner
  status(): Promise<ProfileServiceResult<ProfileStatus>>
  capabilities(): Promise<ProfileServiceResult<ProfileCapabilities>>
  query(request: ProfileQueryRequest): Promise<ProfileServiceResult<ProfileQueryPage>>
  inspectResult(
    request: ProfileResultInspectionRequest,
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
  authorizeOrdinaryIdeaCreate(
    ideaId: string,
  ): Promise<ProfileServiceResult<GuiOrdinaryNewIdeaAuthorization>>
  commitGuiProjection(
    candidate: unknown,
  ): Promise<ProfileServiceResult<SqliteProfileGuiProjectionCommitReceipt>>
  applyCommandBatch(candidate: unknown): Promise<ProfileServiceResult<ProfileCommandBatchReceipt>>
  applyAgentCommandBatch(
    candidate: unknown,
    transport: ProfileAgentInstalledTransport,
    actor?: Readonly<Pick<CardAuthorship, 'client' | 'sessionId'>>,
  ): Promise<ProfileServiceResult<ProfileAgentCommandBatchReceipt>>
  applyAssetCommandBatch(candidate: unknown): Promise<ProfileServiceResult<ProfileCommandBatchReceipt>>
  blobCandidates(): Promise<ProfileServiceResult<SqliteProfileBlobCandidates>>
  createRecoveryPoint(): Promise<ProfileServiceResult<ProfileRecoveryPointSummary>>
  /** Sidecar reservation high-water; it can exceed every retained recovery candidate. */
  recoveryHighWaterRevision(): number
  recover(request: ProfileRecoveryRequest): Promise<ProfileServiceResult<
    SqliteProfileRecoveryInspection | SqliteProfileRecoveryRestoreReceipt
  >>
  /** Recovery-only escape hatch (#813): set the current Profile bytes aside and
   * promote a freshly seeded Profile. Never available while healthy. */
  startFresh(): Promise<ProfileServiceResult<SqliteProfileStartFreshReceipt>>
  exportPortable(
    request: ProfilePortableExportRequest<ProfilePortableZipDestination>,
  ): Promise<ProfileServiceResult<ProfilePortableExportReceipt>>
  importPortableIntoFreshProfile(
    request: ProfilePortableFreshImportRequest<ProfilePortableSource>,
  ): Promise<ProfileServiceResult<ProfilePortableFreshImportReceipt>>
  duplicateIdea(
    request: ProfileDuplicateIdeaRequest,
  ): Promise<ProfileServiceResult<ProfileIdeaLifecycleReceipt>>
  importIdeaClosure(
    request: ProfileImportIdeaClosureRequest<ProfilePortableSource>,
  ): Promise<ProfileServiceResult<ProfileIdeaLifecycleReceipt>>
  retryableWork(): ProfileCommandBatch[]
  transitionProfileStorage<Result>(
    transition: (canonicalProfilePath: string) => Result | PromiseLike<Result>,
  ): Promise<ProfileServiceResult<Result>>
  close(): Promise<void>
}

type ProfileStoreOptions = Pick<
  SqliteProfileRevisionStoreOptions,
  | 'seed'
  | 'now'
  | 'createCommitId'
  | 'createIntentEventId'
  | 'createAgentClientTxnId'
  | 'agentActor'
  | 'testHooks'
>

export type SqliteProfileOwnerCoordinatorOptions = ProfileStoreOptions & {
  databasePath: string
  allowFreshImport?: boolean
  automaticRecoveryPoints?: boolean
  ownerId?: string
  route?: ProfileOwnershipRequest['route']
  createOwnerToken?: () => string
  openExclusiveRuntime?: (databasePath: string) => SqliteExclusiveRuntime
  openProfileRuntime?: (databasePath: string) => SqliteRuntime
  blobTestHooks?: {
    afterStageFlush?: () => void
    beforeFinalDurabilityBarrier?: (context: { existingFinal: boolean }) => void
    afterPortableStageFlush?: () => void
    beforePortablePromote?: () => void
  }
  portableTestHooks?: {
    afterBlobsPublished?: () => void
    afterReservationCommitBeforeAcknowledge?: () => void
    afterImportReserved?: () => void
    afterDatabaseLinkedBeforeStageUnlink?: () => void
    afterDatabasePublishedBeforeBind?: () => void
    beforePublishedBlobVerification?: () => void | Promise<void>
    afterBindBeforeReopen?: () => void
    afterReopenBeforeComplete?: () => void
  }
  createPortableIdentity?: (kind: string) => string
  createPortableStageName?: () => string
  recoveryTestHooks?: SqliteProfileRecoveryManagerOptions['testHooks']
  createRecoveryCandidateId?: (revision: number) => string
  createRecoveryOperationId?: () => string
  createGuiIdeaAuthorizationId?: () => string
}

export type SqliteProfileOwnerAcquisition = ProfileServiceResult<SqliteProfileOwnerCoordinator>

type ProfileOwnerSession = Readonly<{
  ownerId: string
  ownerToken: string
  generation: number
}>

type PortableImportOperation = Readonly<{
  operationId: string
  idempotencyKey: string
  requestDigest: string
  integrityRoot: string
  logicalDigest: string
  profileId: string
  sourceRevision: number
  databaseStagePath: string
  databaseDigest: string
  databaseSize: number
  blobRoots: readonly Readonly<{ sha256: string; size: number }>[]
  receipt: ProfilePortableFreshImportReceipt
  state: 'reserved' | 'profile-published' | 'completed'
}>

const CREATE_OWNER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profile_owner_generation (
  identity INTEGER PRIMARY KEY CHECK (identity = 1),
  generation INTEGER NOT NULL CHECK (generation >= 1),
  owner_token TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  profile_device TEXT,
  profile_inode TEXT,
  profile_birthtime TEXT,
  CHECK (
    (profile_device IS NULL AND profile_inode IS NULL AND profile_birthtime IS NULL)
    OR (profile_device IS NOT NULL AND profile_inode IS NOT NULL AND profile_birthtime IS NOT NULL)
  )
);
`

const CREATE_PORTABLE_IMPORT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profile_portable_import_operations (
  operation_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL,
  integrity_root TEXT NOT NULL,
  logical_digest TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 0),
  database_stage_path TEXT NOT NULL,
  database_digest TEXT NOT NULL,
  database_size INTEGER NOT NULL CHECK (database_size >= 0),
  blob_roots_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'profile-published', 'completed')),
  started_at TEXT NOT NULL,
  completed_at TEXT
);
`

export function acquireSqliteProfileOwner(
  options: SqliteProfileOwnerCoordinatorOptions,
): SqliteProfileOwnerAcquisition {
  let canonicalProfilePath: string
  try {
    canonicalProfilePath = canonicalizeProfileDatabasePath(options.databasePath)
  } catch {
    return profileServiceFailure('invalid')
  }

  let ownerId: string
  let route: ProfileOwnershipRequest['route']
  let ownerToken: string
  let acquiredAt: string
  try {
    ownerId = options.ownerId ?? `owner-${randomUUID()}`
    route = normalizeRoute(options.route)
    ownerToken = (options.createOwnerToken ?? createPrivateOwnerToken)()
    acquiredAt = (options.now ?? (() => new Date().toISOString()))()
    validateOwnerMetadata(ownerId, ownerToken)
  } catch {
    return profileServiceFailure('invalid')
  }

  const sidecarPath = `${canonicalProfilePath}.owner.sqlite`
  let profileIdentity: PhysicalFileIdentity | undefined
  let expectedSidecarIdentity: PhysicalFileIdentity | undefined
  let profileNeedsPortableRepair = false
  try {
    profileIdentity = capturePhysicalFile(canonicalProfilePath)
  } catch {
    if (!existsSync(canonicalProfilePath)) return profileServiceFailure('corrupt-or-recovery-required')
    profileNeedsPortableRepair = true
  }
  try {
    expectedSidecarIdentity = capturePhysicalFile(sidecarPath)
    if ((profileIdentity || profileNeedsPortableRepair) && !expectedSidecarIdentity) {
      return profileServiceFailure('corrupt-or-recovery-required')
    }
  } catch {
    return profileServiceFailure('corrupt-or-recovery-required')
  }
  const canInitializeAuthority = !profileIdentity && !profileNeedsPortableRepair && !expectedSidecarIdentity
  if (canInitializeAuthority && !options.seed && !options.allowFreshImport) {
    return profileServiceFailure('invalid')
  }
  let sidecar: SqliteExclusiveRuntime
  try {
    sidecar = (options.openExclusiveRuntime ?? openSqliteExclusiveRuntime)(sidecarPath)
  } catch (error) {
    return profileServiceFailure(isBusyError(error) ? 'busy' : 'internal')
  }

  let generation!: number
  let store: SqliteProfileRevisionStore | undefined
  let blobStore!: SqliteProfileBlobStore
  let recoveryManager!: SqliteProfileRecoveryManager
  let ownershipCapability!: SqliteProfileOwnershipCapability
  let activeProfileIdentity: PhysicalFileIdentity | undefined
  let startupPendingImport: PortableImportOperation | undefined
  let profileOpen = false
  let startupProfileFenceMatched = false
  let startupSafetyCopy: ReturnType<SqliteProfileRecoveryManager['captureStartupSafetyCopy']>
  let mode: 'healthy' | 'fresh-import' | 'recovery' = 'recovery'
  try {
    const openedSidecarIdentity = requirePhysicalFile(sidecarPath)
    if (expectedSidecarIdentity) assertSamePhysicalFile(expectedSidecarIdentity, openedSidecarIdentity)
    expectedSidecarIdentity = openedSidecarIdentity
    initializePortableImportSchema(sidecar)
    const resumableBeforeFence = readPendingPortableImport(sidecar, canonicalProfilePath)
    sweepAbandonedPortableDatabaseStages(
      canonicalProfilePath,
      resumableBeforeFence?.databaseStagePath,
    )
    if (profileNeedsPortableRepair || (!profileIdentity && resumableBeforeFence)) {
      resumePortableDatabasePublication(
        sidecar,
        canonicalProfilePath,
        resumableBeforeFence,
      )
      profileIdentity = requirePhysicalFile(canonicalProfilePath)
      profileNeedsPortableRepair = false
    } else {
      revalidateProfileIdentity(canonicalProfilePath, profileIdentity)
    }
    const pendingImport = readPendingPortableImport(sidecar, canonicalProfilePath)
    const advanced = advanceOwnerGeneration(
      sidecar,
      ownerId,
      ownerToken,
      acquiredAt,
      profileIdentity,
      canInitializeAuthority,
      options.allowFreshImport === true || pendingImport !== undefined,
    )
    startupProfileFenceMatched = advanced.profileIdentityMatches
    generation = advanced.generation
    ownershipCapability = issueSqliteProfileOwnershipCapability({
      profileDatabasePath: canonicalProfilePath,
      sidecarPath,
      sidecarRuntime: sidecar,
    })
    blobStore = createSqliteProfileBlobStore({
      profileDatabasePath: canonicalProfilePath,
      ownershipCapability,
      ...(options.blobTestHooks ? { testHooks: options.blobTestHooks } : {}),
    })
    recoveryManager = createSqliteProfileRecoveryManager({
      profileDatabasePath: canonicalProfilePath,
      sidecarRuntime: sidecar,
      blobStore,
      ...(options.openProfileRuntime ? { openProfileRuntime: options.openProfileRuntime } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.createRecoveryCandidateId
        ? { createCandidateId: options.createRecoveryCandidateId }
        : {}),
      ...(options.createRecoveryOperationId
        ? { createOperationId: options.createRecoveryOperationId }
        : {}),
      ...(options.recoveryTestHooks ? { testHooks: options.recoveryTestHooks } : {}),
    })
    recoveryManager.initialize()
    if (profileIdentity) startupSafetyCopy = recoveryManager.captureStartupSafetyCopy()
    if (
      advanced.profileDeviceDrift
      && profileIdentity
      && startupSafetyCopy
      && !pendingImport
    ) {
      const inspection = inspectSqliteProfileRevisionDatabase({
        databasePath: startupSafetyCopy.databasePath,
        hydrateAsset: (payload) => blobStore.hydrateAsset(payload),
        ...(options.openProfileRuntime ? { openRuntime: options.openProfileRuntime } : {}),
      })
      revalidateProfileIdentity(canonicalProfilePath, profileIdentity)
      if (
        inspection.profileId !== recoveryManager.trustedProfileId()
        || inspection.revision !== recoveryManager.highWater()
      ) {
        throw new PhysicalAuthorityError(
          'SQLite Profile device remount evidence does not match its owner authority',
        )
      }
      rebindProfileDeviceAfterRemount(
        sidecar,
        { ownerId, ownerToken, generation },
        profileIdentity,
      )
      startupProfileFenceMatched = true
    }
    if (pendingImport) {
      startupPendingImport = pendingImport
      mode = 'fresh-import'
    } else if ((canInitializeAuthority && options.seed) || startupProfileFenceMatched) {
      try {
        store = openFencedProfileStore(
          options,
          canonicalProfilePath,
          ownershipCapability,
          blobStore,
          canInitializeAuthority && options.seed !== undefined,
        )
        profileOpen = true
        const openedProfileIdentity = requirePhysicalFile(canonicalProfilePath)
        if (profileIdentity) assertSamePhysicalFile(profileIdentity, openedProfileIdentity)
        bindInitialProfileIdentity(
          sidecar,
          { ownerId, ownerToken, generation },
          openedProfileIdentity,
        )
        activeProfileIdentity = openedProfileIdentity
        const currentProfile = store.currentProfileIdentity()
        recoveryManager.initialize(currentProfile)
        if (
          recoveryManager.hasPendingOperation()
          || recoveryManager.highWater() !== currentProfile.revision
        ) {
          store.close()
          store = undefined
          profileOpen = false
          mode = 'recovery'
        } else {
          mode = 'healthy'
          if (startupSafetyCopy) {
            recoveryManager.discardStartupSafetyCopy(startupSafetyCopy)
            startupSafetyCopy = undefined
          }
        }
      } catch (error) {
        if (profileOpen && store) {
          store.close()
          profileOpen = false
        }
        store = undefined
        if (error instanceof ProfileUnsupportedFutureVersionError) {
          sidecar.close()
          return profileServiceFailure('unsupported-future-version', {
            supportedVersions: error.supportedVersions,
          })
        }
        if (isBusyError(error)) {
          sidecar.close()
          return profileServiceFailure('busy')
        }
      }
    } else if (options.allowFreshImport && !profileIdentity) {
      mode = 'fresh-import'
    }
    assertSamePhysicalFile(expectedSidecarIdentity, requirePhysicalFile(sidecarPath))
  } catch (error) {
    if (profileOpen && store) {
      try {
        store.close()
      } catch {
        return profileServiceFailure('internal')
      }
    }
    sidecar.close()
    return profileServiceFailure(
      error instanceof ProfileUnsupportedFutureVersionError
        ? 'unsupported-future-version'
        : isBusyError(error)
        ? 'busy'
          : error instanceof PhysicalAuthorityError
            || error instanceof ProfileRevisionCorruptionError
            || error instanceof SqliteProfileBlobCorruptionError
          ? 'corrupt-or-recovery-required'
          : 'internal',
      error instanceof ProfileUnsupportedFutureVersionError
        ? { supportedVersions: error.supportedVersions }
        : {},
    )
  }

  const session: ProfileOwnerSession = Object.freeze({ ownerId, ownerToken, generation })
  let accepting = mode === 'healthy'
  let closingRequested = false
  let closed = false
  let authorityLost = false
  let queue = Promise.resolve()
  let closePromise: Promise<void> | undefined
  let transitionPromise: Promise<ProfileServiceResult<unknown>> | undefined

  const pendingRecoveryKind = recoveryManager.pendingOperationKind()
  const automaticRepairSource = startupSafetyCopy?.databasePath
    ?? recoveryManager.pendingStartFreshSourcePath()
    ?? (profileIdentity ? canonicalProfilePath : undefined)
  if (
    mode === 'recovery'
    && options.seed
    && automaticRepairSource
    && pendingRecoveryKind !== 'restore'
    && (startupProfileFenceMatched || pendingRecoveryKind === 'start-fresh')
  ) {
    try {
      const salvage = salvageCurrentSqliteProfileSnapshot({
        databasePath: automaticRepairSource,
        hydrateAsset: (payload) => blobStore.hydrateAsset(payload),
        ...(options.openProfileRuntime ? { openRuntime: options.openProfileRuntime } : {}),
      })
      const salvaged = salvage.sourceRecordVersion === 1
        ? Object.freeze({
            ...salvage.snapshot,
            modTemplates: options.seed.modTemplates.map((template) => Object.freeze({
              ...template,
              ownerId: salvage.snapshot.profileId,
              parentId: salvage.snapshot.profileId,
            })),
            modInstances: [],
          })
        : salvage.snapshot
      if (salvaged.profileId !== recoveryManager.trustedProfileId()) {
        throw new PhysicalAuthorityError('SQLite Profile automatic repair identity is untrusted')
      }
      // A pending start-fresh already owns the sidecar's next revision. Do not
      // advance its high-water from a promoted-but-not-yet-completed stage.
      if (pendingRecoveryKind !== 'start-fresh') {
        recoveryManager.observeRevision(salvaged.revision)
      }
      const repairedSnapshot = Object.freeze({
        ...salvaged,
        revision: recoveryManager.highWater() + 1,
      })
      const document = projectProfileSnapshot(
        repairedSnapshot,
        (asset) => blobStore.materializeAsset(asset),
      )
      const promoted = recoveryManager.startFresh({ document })
      if (!promoted.ok) throw new PhysicalAuthorityError('SQLite Profile automatic repair failed')

      const replacementIdentity = requirePhysicalFile(canonicalProfilePath)
      store = openFencedProfileStore(
        options,
        canonicalProfilePath,
        ownershipCapability,
        blobStore,
        false,
      )
      profileOpen = true
      const repairedProfile = store.currentProfileIdentity()
      if (
        repairedProfile.profileId !== salvaged.profileId
        || repairedProfile.revision !== repairedSnapshot.revision
        || repairedProfile.latestRecovery
      ) throw new PhysicalAuthorityError('SQLite Profile automatic repair changed Profile identity')
      revalidateProfileIdentity(canonicalProfilePath, replacementIdentity)
      replaceBoundProfileIdentity(sidecar, session, replacementIdentity)
      activeProfileIdentity = replacementIdentity
      recoveryManager.completeStartFresh(promoted.value)
      recoveryManager.initialize(repairedProfile)
      if (
        recoveryManager.hasPendingOperation()
        || recoveryManager.highWater() !== repairedProfile.revision
      ) throw new PhysicalAuthorityError('SQLite Profile automatic repair violated recovery authority')
      mode = 'healthy'
      accepting = true
    } catch {
      if (profileOpen && store) {
        try {
          store.close()
        } catch {
          authorityLost = true
        }
      }
      profileOpen = false
      store = undefined
      mode = 'recovery'
      accepting = false
    }
  }

  const assertLiveSidecar = () => {
    assertSidecarOwnership(sidecar, sidecarPath, expectedSidecarIdentity, session)
  }

  const assertLiveAuthority = () => {
    assertLiveSidecar()
    if (mode !== 'healthy' || !activeProfileIdentity || !store || !profileOpen) {
      throw new PhysicalAuthorityError('SQLite Profile is recovery-only')
    }
    revalidateProfileIdentity(canonicalProfilePath, activeProfileIdentity)
    assertBoundProfileIdentity(sidecar, activeProfileIdentity)
  }

  const markAuthorityLost = () => {
    accepting = false
    authorityLost = true
    return profileServiceFailure('corrupt-or-recovery-required')
  }

  const liveStore = (): SqliteProfileRevisionStore => {
    if (!store || !profileOpen || mode !== 'healthy') {
      throw new PhysicalAuthorityError('SQLite Profile store is recovery-only')
    }
    return store
  }

  const enterRecoveryMode = () => {
    accepting = false
    mode = 'recovery' as const
    if (profileOpen && store) {
      store.close()
      profileOpen = false
    }
    store = undefined
  }

  const handleProfileFailure = () => {
    try {
      assertLiveSidecar()
      enterRecoveryMode()
      return profileServiceFailure('corrupt-or-recovery-required')
    } catch {
      return markAuthorityLost()
    }
  }

  const portableLifecycle: SqliteProfilePortableLifecycle = createSqliteProfilePortableLifecycle({
    store: liveStore,
    blobStore,
    ...(options.now ? { now: options.now } : {}),
    ...(options.createPortableIdentity ? { createIdentity: options.createPortableIdentity } : {}),
    observeRevision: (revision) => recoveryManager.observeRevision(revision),
  })
  const guiProjection: SqliteProfileGuiProjectionAdapter = createSqliteProfileGuiProjectionAdapter({
    store: liveStore,
    blobStore,
    ...(options.now ? { now: options.now } : {}),
    ...(options.createGuiIdeaAuthorizationId
      ? { createAuthorizationId: options.createGuiIdeaAuthorizationId }
      : {}),
  })

  const enqueueHealthyOperation = <Value>(
    operation: () => Promise<ProfileServiceResult<Value>>,
  ): Promise<ProfileServiceResult<Value>> => {
    if (mode === 'recovery') {
      return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
    }
    if (!accepting || closed || authorityLost || transitionPromise) {
      return Promise.resolve(profileServiceFailure('busy'))
    }
    return new Promise((resolve) => {
      queue = queue.then(async () => {
        try {
          assertLiveAuthority()
          const result = await operation()
          if (!result.ok && result.code === 'corrupt-or-recovery-required') {
            enterRecoveryMode()
            resolve(result)
            return
          }
          assertLiveAuthority()
          resolve(result)
        } catch {
          resolve(handleProfileFailure())
        }
      })
    })
  }

  const verifyCompletedPortableImport = async (
    operation: PortableImportOperation,
  ): Promise<void> => {
    assertLiveAuthority()
    const current = await liveStore().logicalDocument()
    if (!current.ok
      || current.value.head.profileId !== operation.profileId
      || current.value.head.revision < operation.sourceRevision) {
      throw new PhysicalAuthorityError('Completed Portable Profile import changed logical meaning')
    }
    const currentRoots = readProfileLogicalBlobRoots(current.value)
    if (current.value.head.revision === operation.sourceRevision
      && (createHash('sha256')
        .update(canonicalProfilePortableDocumentBytes(current.value))
        .digest('hex') !== operation.logicalDigest
        || canonicalProfileJson(currentRoots) !== canonicalProfileJson(operation.blobRoots))) {
      throw new PhysicalAuthorityError('Completed Portable Profile import changed logical meaning')
    }
    for (const root of currentRoots) await blobStore.verifyPortableBlob(root)
    assertLiveAuthority()
  }

  const finishPortableImportOperation = async (
    operation: PortableImportOperation,
  ): Promise<ProfilePortableFreshImportReceipt> => {
    assertLiveSidecar()
    resumePortableDatabasePublication(
      sidecar,
      canonicalProfilePath,
      operation,
      options.portableTestHooks,
    )
    options.portableTestHooks?.afterDatabasePublishedBeforeBind?.()
    await options.portableTestHooks?.beforePublishedBlobVerification?.()
    await verifyPortableImportProfile(
      canonicalProfilePath,
      operation,
      blobStore,
      options.openProfileRuntime,
    )
    const replacementIdentity = requirePhysicalFile(canonicalProfilePath)
    bindPortableImportProfile(
      sidecar,
      session,
      replacementIdentity,
      operation.operationId,
    )
    activeProfileIdentity = replacementIdentity
    options.portableTestHooks?.afterBindBeforeReopen?.()
    store = openFencedProfileStore(
      options,
      canonicalProfilePath,
      ownershipCapability,
      blobStore,
      false,
    )
    profileOpen = true
    const importedIdentity = store.currentProfileIdentity()
    if (importedIdentity.profileId !== operation.profileId
      || importedIdentity.revision !== operation.sourceRevision) {
      throw new PhysicalAuthorityError('Portable Profile import reopened with different identity')
    }
    recoveryManager.initialize(importedIdentity)
    if (recoveryManager.hasPendingOperation()
      || recoveryManager.highWater() !== importedIdentity.revision) {
      throw new PhysicalAuthorityError('Portable Profile import violated recovery authority')
    }
    options.portableTestHooks?.afterReopenBeforeComplete?.()
    completePortableImport(
      sidecar,
      operation.operationId,
      (options.now ?? (() => new Date().toISOString()))(),
    )
    mode = 'healthy'
    accepting = !closingRequested
    return operation.receipt
  }

  const performRecoveryRestore = async (
    request: Extract<ProfileRecoveryRequest, { mode: 'restore' }>,
  ): Promise<ProfileServiceResult<SqliteProfileRecoveryRestoreReceipt>> => {
    const currentHighWater = recoveryManager.highWater()
    if (mode === 'healthy' && request.expectedRevision !== currentHighWater) {
      accepting = !closingRequested
      transitionPromise = undefined
      return profileServiceFailure('conflict', { currentRevision: currentHighWater })
    }
    const inspection = recoveryManager.inspect()
    if (!inspection.ok) {
      if (mode === 'healthy') accepting = !closingRequested
      transitionPromise = undefined
      return inspection
    }
    if (!inspection.value.candidates.some((candidate) => candidate.id === request.candidateId)) {
      if (mode === 'healthy') accepting = !closingRequested
      transitionPromise = undefined
      return profileServiceFailure('not-found', { currentRevision: currentHighWater })
    }
    const rejectedCandidateIds = [...inspection.value.rejectedCandidateIds]
    accepting = false
    try {
      assertLiveSidecar()
      const queuedHighWater = recoveryManager.highWater()
      if (mode === 'healthy' && request.expectedRevision !== queuedHighWater) {
        accepting = !closingRequested
        transitionPromise = undefined
        return profileServiceFailure('conflict', { currentRevision: queuedHighWater })
      }
      if (profileOpen && store) {
        store.close()
        profileOpen = false
      }
      store = undefined
      mode = 'recovery'
      const promoted = recoveryManager.promote(request)
      if (!promoted.ok) {
        transitionPromise = undefined
        return promoted
      }
      assertLiveSidecar()
      const replacementIdentity = requirePhysicalFile(canonicalProfilePath)
      const reopened = openFencedProfileStore(
        options,
        canonicalProfilePath,
        ownershipCapability,
        blobStore,
        false,
      )
      store = reopened
      profileOpen = true
      if (reopened.currentRevision() !== promoted.value.revision) {
        throw new PhysicalAuthorityError('Recovered SQLite Profile revision does not match its reservation')
      }
      revalidateProfileIdentity(canonicalProfilePath, replacementIdentity)
      replaceBoundProfileIdentity(sidecar, session, replacementIdentity)
      activeProfileIdentity = replacementIdentity
      recoveryManager.observeRevision(promoted.value.revision)
      recoveryManager.complete(promoted.value.operationId)
      mode = 'healthy'
      accepting = !closingRequested
      transitionPromise = undefined
      return {
        ok: true,
        value: Object.freeze({
          mode: 'restore' as const,
          selectedCandidateId: promoted.value.candidateId,
          rejectedCandidateIds,
          quarantinedCurrentState: promoted.value.quarantinedCurrentState,
          previousRevision: promoted.value.previousRevision,
          revision: promoted.value.revision,
        }),
      }
    } catch {
      if (profileOpen && store) {
        try {
          store.close()
        } catch {
          authorityLost = true
        }
      }
      profileOpen = false
      store = undefined
      mode = 'recovery'
      accepting = false
      transitionPromise = undefined
      return profileServiceFailure('corrupt-or-recovery-required', {
        currentRevision: recoveryManager.highWater(),
      })
    }
  }

  const performStartFresh = async (): Promise<
    ProfileServiceResult<SqliteProfileStartFreshReceipt>
  > => {
    try {
      assertLiveSidecar()
      if (!options.seed) {
        transitionPromise = undefined
        return profileServiceFailure('invalid')
      }
      if (profileOpen && store) {
        store.close()
        profileOpen = false
      }
      store = undefined
      mode = 'recovery'
      const document = projectProfileSnapshot(
        options.seed,
        (asset) => blobStore.materializeAsset(asset),
      )
      const promoted = recoveryManager.startFresh({ document })
      if (!promoted.ok) {
        transitionPromise = undefined
        return promoted
      }
      assertLiveSidecar()
      const replacementIdentity = requirePhysicalFile(canonicalProfilePath)
      const reopened = openFencedProfileStore(
        options,
        canonicalProfilePath,
        ownershipCapability,
        blobStore,
        false,
      )
      store = reopened
      profileOpen = true
      const freshProfile = reopened.currentProfileIdentity()
      if (freshProfile.profileId !== promoted.value.profileId
        || freshProfile.revision !== promoted.value.revision
        || freshProfile.latestRecovery) {
        throw new PhysicalAuthorityError('Fresh SQLite Profile does not match its start-fresh evidence')
      }
      revalidateProfileIdentity(canonicalProfilePath, replacementIdentity)
      replaceBoundProfileIdentity(sidecar, session, replacementIdentity)
      activeProfileIdentity = replacementIdentity
      recoveryManager.completeStartFresh(promoted.value)
      recoveryManager.initialize(freshProfile)
      if (recoveryManager.hasPendingOperation()
        || recoveryManager.highWater() !== freshProfile.revision) {
        throw new PhysicalAuthorityError('SQLite start-fresh violated recovery authority')
      }
      mode = 'healthy'
      accepting = !closingRequested
      transitionPromise = undefined
      return {
        ok: true,
        value: Object.freeze({
          mode: 'start-fresh' as const,
          operationId: promoted.value.operationId,
          previousRevision: promoted.value.previousRevision,
          profileId: promoted.value.profileId,
          revision: promoted.value.revision,
          quarantinedCurrentState: promoted.value.quarantinedCurrentState,
        }),
      }
    } catch {
      if (profileOpen && store) {
        try {
          store.close()
        } catch {
          authorityLost = true
        }
      }
      profileOpen = false
      store = undefined
      mode = 'recovery'
      accepting = false
      transitionPromise = undefined
      return profileServiceFailure('corrupt-or-recovery-required', {
        currentRevision: recoveryManager.highWater(),
      })
    }
  }

  const startRecoveryRestore = (
    request: Extract<ProfileRecoveryRequest, { mode: 'restore' }>,
  ): Promise<ProfileServiceResult<SqliteProfileRecoveryRestoreReceipt>> => {
    accepting = false
    transitionPromise = queue.then(() => performRecoveryRestore(request))
    const activeRecovery = transitionPromise as Promise<
      ProfileServiceResult<SqliteProfileRecoveryRestoreReceipt>
    >
    queue = activeRecovery.then(() => undefined)
    return activeRecovery
  }

  const coordinator: SqliteProfileOwnerCoordinator = {
    owner: Object.freeze({ ownerId, generation, route }),
    async status() {
      if (authorityLost || mode === 'recovery') {
        return profileServiceFailure('corrupt-or-recovery-required')
      }
      if (mode === 'fresh-import') return profileServiceFailure('busy')
      if (closed) return profileServiceFailure('internal')
      if (transitionPromise) return profileServiceFailure('busy')
      try {
        assertLiveAuthority()
        const result = await liveStore().status()
        assertLiveAuthority()
        if (!result.ok) {
          if (result.code === 'corrupt-or-recovery-required') enterRecoveryMode()
          return result
        }
        return {
          ok: true,
          value: {
            ...result.value,
            owner: { mode: 'mutable', route },
          },
        }
      } catch {
        return handleProfileFailure()
      }
    },
    capabilities() {
      if (mode === 'recovery') {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
      }
      if (!accepting || closed || authorityLost || transitionPromise) {
        return Promise.resolve(profileServiceFailure('busy'))
      }
      return new Promise((resolve) => {
        queue = queue.then(async () => {
          try {
            assertLiveAuthority()
            const result = await liveStore().capabilities()
            if (!result.ok && result.code === 'corrupt-or-recovery-required') {
              enterRecoveryMode()
              resolve(result)
              return
            }
            assertLiveAuthority()
            resolve(result)
          } catch {
            resolve(handleProfileFailure())
          }
        })
      })
    },
    query(request) {
      const validation = validateProfileQuery(request)
      if (!validation.ok) return Promise.resolve(validation)
      if (mode === 'recovery') {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
      }
      if (!accepting || closed || authorityLost || transitionPromise) {
        return Promise.resolve(profileServiceFailure('busy'))
      }
      return new Promise((resolve) => {
        queue = queue.then(async () => {
          try {
            assertLiveAuthority()
            const result = await liveStore().query(validation.value)
            if (!result.ok && result.code === 'corrupt-or-recovery-required') {
              enterRecoveryMode()
              resolve(result)
              return
            }
            assertLiveAuthority()
            resolve(result)
          } catch {
            resolve(handleProfileFailure())
          }
        })
      })
    },
    inspectResult(request) {
      const validation = validateProfileResultInspectionRequest(request)
      if (!validation.ok) return Promise.resolve(validation)
      return enqueueHealthyOperation(() => liveStore().inspectResult(validation.value))
    },
    changes(request) {
      const validation = validateProfileAgentChangeTrailRequest(request)
      if (!validation.ok) return Promise.resolve(validation)
      if (mode === 'recovery') {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
      }
      if (!accepting || closed || authorityLost || transitionPromise) {
        return Promise.resolve(profileServiceFailure('busy'))
      }
      return new Promise((resolve) => {
        queue = queue.then(async () => {
          try {
            assertLiveAuthority()
            const result = await liveStore().changes(validation.value)
            if (!result.ok && result.code === 'corrupt-or-recovery-required') {
              enterRecoveryMode()
              resolve(result)
              return
            }
            assertLiveAuthority()
            resolve(result)
          } catch {
            resolve(handleProfileFailure())
          }
        })
      })
    },
    agentCardNeighbors(request) {
      const normalized = normalizeProfileAgentCardNeighborsRequest(request)
      if (!normalized) return Promise.resolve(profileServiceFailure('invalid'))
      return enqueueHealthyOperation(() => liveStore().agentCardNeighbors(normalized))
    },
    agentCardSetBounds(request) {
      const normalized = normalizeProfileAgentCardSetBoundsRequest(request)
      if (!normalized) return Promise.resolve(profileServiceFailure('invalid'))
      return enqueueHealthyOperation(() => liveStore().agentCardSetBounds(normalized))
    },
    async snapshot() {
      if (authorityLost || mode === 'recovery') {
        return profileServiceFailure('corrupt-or-recovery-required')
      }
      if (mode === 'fresh-import') return profileServiceFailure('busy')
      if (closed) return profileServiceFailure('internal')
      if (transitionPromise) return profileServiceFailure('busy')
      try {
        assertLiveAuthority()
        const result = await liveStore().snapshot()
        assertLiveAuthority()
        if (!result.ok) {
          if (result.code === 'corrupt-or-recovery-required') enterRecoveryMode()
          return result
        }
        return result
      } catch {
        return handleProfileFailure()
      }
    },
    authorizeOrdinaryIdeaCreate(ideaId) {
      return enqueueHealthyOperation(() => guiProjection.authorizeOrdinaryIdeaCreate(ideaId))
    },
    commitGuiProjection(candidate) {
      let captured: GuiProfileProjectionRequest
      try {
        captured = captureProfileGuiInertJson(candidate, '$request') as GuiProfileProjectionRequest
      } catch (error) {
        return Promise.resolve(profileServiceFailure(
          error instanceof ProfileGuiJsonCaptureError ? 'invalid' : 'internal',
        ))
      }
      return enqueueHealthyOperation(async () => {
        const result = await guiProjection.commitGuiProjection(captured)
        if (result.ok) recoveryManager.observeRevision(result.value.revision)
        return result
      })
    },
    applyCommandBatch(candidate) {
      const validation = validateProfileCommandBatch(candidate)
      if (!validation.ok) return Promise.resolve(validation)
      if (mode === 'recovery') {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
      }
      if (!accepting || closed || authorityLost) return Promise.resolve(profileServiceFailure('busy'))
      return new Promise((resolve) => {
        queue = queue.then(async () => {
          try {
            assertLiveAuthority()
            const result = await liveStore().applyCommandBatch(validation.value)
            if (result.ok && !result.value.dryRun) recoveryManager.observeRevision(result.value.revision)
            if (!result.ok && result.code === 'corrupt-or-recovery-required') enterRecoveryMode()
            resolve(result)
          } catch {
            resolve(handleProfileFailure())
          }
        })
      })
    },
    applyAgentCommandBatch(candidate, transport, actor) {
      const validation = validateInstalledProfileAgentCommandRequest(candidate)
      if (!validation.ok) return Promise.resolve(validation)
      if (transport !== 'cli' && transport !== 'mcp') {
        return Promise.resolve(profileServiceFailure('capability-denied'))
      }
      return enqueueHealthyOperation(async () => {
        const result = await liveStore().applyAgentCommandBatch(validation.value, transport, actor)
        if (result.ok && !result.value.dryRun) recoveryManager.observeRevision(result.value.revision)
        return result
      })
    },
    applyAssetCommandBatch(candidate) {
      if (mode === 'recovery') {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
      }
      if (!accepting || closed || authorityLost) return Promise.resolve(profileServiceFailure('busy'))
      return new Promise((resolve) => {
        queue = queue.then(async () => {
          try {
            assertLiveAuthority()
            // Validate the current reachable closure before incoming bytes can
            // promote. Ordinary mutation must never repair a damaged Profile.
            const current = liveStore()
            const currentRoots = await current.referencedAssetDigests()
            if (!currentRoots.ok) {
              if (currentRoots.code === 'corrupt-or-recovery-required') enterRecoveryMode()
              resolve(currentRoots)
              return
            }
            const prepared = blobStore.prepareAssetCommandBatch(candidate)
            if (!prepared.ok) {
              resolve(prepared)
              return
            }
            const result = await current.applyPreparedAssetCommandBatch(prepared.value)
            if (result.ok && !result.value.dryRun) recoveryManager.observeRevision(result.value.revision)
            if (!result.ok && result.code === 'corrupt-or-recovery-required') {
              enterRecoveryMode()
              resolve(result)
              return
            }
            assertLiveAuthority()
            resolve(result)
          } catch {
            resolve(handleProfileFailure())
          }
        })
      })
    },
    blobCandidates() {
      if (mode === 'recovery') {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
      }
      if (!accepting || closed || authorityLost) return Promise.resolve(profileServiceFailure('busy'))
      return new Promise((resolve) => {
        queue = queue.then(async () => {
          try {
            assertLiveAuthority()
            const roots = await liveStore().referencedAssetDigests()
            if (!roots.ok) {
              if (roots.code === 'corrupt-or-recovery-required') enterRecoveryMode()
              resolve(roots)
              return
            }
            const retainedRoots = recoveryManager.retainedBlobDigests()
            const candidates = blobStore.candidates(Object.freeze([
              ...new Set([...roots.value, ...retainedRoots]),
            ].sort()))
            assertLiveAuthority()
            resolve({ ok: true, value: candidates })
          } catch (error) {
            if (error instanceof SqliteProfileBlobCorruptionError) {
              enterRecoveryMode()
              resolve(profileServiceFailure('corrupt-or-recovery-required'))
              return
            }
            resolve(handleProfileFailure())
          }
        })
      })
    },
    createRecoveryPoint() {
      if (mode === 'recovery') {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
      }
      if (!accepting || closed || authorityLost || transitionPromise) {
        return Promise.resolve(profileServiceFailure('busy'))
      }
      return new Promise((resolve) => {
        queue = queue.then(async () => {
          try {
            assertLiveAuthority()
            const result = await recoveryManager.createRecoveryPoint(liveStore())
            assertLiveAuthority()
            resolve(result)
          } catch {
            resolve(handleProfileFailure())
          }
        })
      })
    },
    recoveryHighWaterRevision() {
      if (closed || authorityLost) {
        throw new PhysicalAuthorityError('SQLite Profile recovery authority is unavailable')
      }
      assertLiveSidecar()
      return recoveryManager.highWater()
    },
    recover(request: ProfileRecoveryRequest) {
      if (closed) return Promise.resolve(profileServiceFailure('internal'))
      if (mode === 'fresh-import') return Promise.resolve(profileServiceFailure('busy'))
      if (authorityLost || transitionPromise) {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
      }
      if (request.mode === 'inspect') {
        return new Promise((resolve) => {
          queue = queue.then(() => {
            try {
              assertLiveSidecar()
              resolve(recoveryManager.inspect())
            } catch {
              resolve(markAuthorityLost())
            }
          })
        })
      }
      if (
        request.mode !== 'restore'
        || !isSqliteProfileRecoveryCandidateId(request.candidateId)
        || !Number.isSafeInteger(request.expectedRevision)
        || request.expectedRevision < 0
      ) return Promise.resolve(profileServiceFailure('invalid'))
      if (mode === 'healthy') {
        accepting = false
        transitionPromise = queue.then(async () => {
          try {
            assertLiveAuthority()
            const replay = recoveryManager.replayCompleted(request)
            assertLiveAuthority()
            if (replay) {
              accepting = !closingRequested
              transitionPromise = undefined
              return {
                ok: true,
                value: Object.freeze({
                  mode: 'restore' as const,
                  selectedCandidateId: replay.candidateId,
                  rejectedCandidateIds: [],
                  quarantinedCurrentState: replay.quarantinedCurrentState,
                  previousRevision: replay.previousRevision,
                  revision: replay.revision,
                }),
              }
            }
            return performRecoveryRestore(request)
          } catch {
            transitionPromise = undefined
            return handleProfileFailure()
          }
        })
        const activeRecovery = transitionPromise as Promise<
          ProfileServiceResult<SqliteProfileRecoveryRestoreReceipt>
        >
        queue = activeRecovery.then(() => undefined)
        return activeRecovery
      }
      return startRecoveryRestore(request)
    },
    startFresh() {
      if (closed) return Promise.resolve(profileServiceFailure('internal'))
      if (mode === 'fresh-import') return Promise.resolve(profileServiceFailure('busy'))
      if (authorityLost || transitionPromise) {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
      }
      if (mode === 'healthy') {
        try {
          return Promise.resolve(profileServiceFailure('conflict', {
            currentRevision: recoveryManager.highWater(),
          }))
        } catch {
          return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
        }
      }
      accepting = false
      transitionPromise = queue.then(() => performStartFresh())
      const activeStartFresh = transitionPromise as Promise<
        ProfileServiceResult<SqliteProfileStartFreshReceipt>
      >
      queue = activeStartFresh.then(() => undefined)
      return activeStartFresh
    },
    exportPortable(request) {
      return enqueueHealthyOperation(() => portableLifecycle.exportPortable(request))
    },
    duplicateIdea(request) {
      return enqueueHealthyOperation(() => portableLifecycle.duplicateIdea(request))
    },
    importIdeaClosure(request) {
      return enqueueHealthyOperation(() => portableLifecycle.importIdeaClosure(request))
    },
    importPortableIntoFreshProfile(request) {
      if (mode === 'recovery') {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required'))
      }
      if (closed || authorityLost || transitionPromise || closingRequested) {
        return Promise.resolve(profileServiceFailure('busy'))
      }
      return new Promise((resolve) => {
        queue = queue.then(async () => {
          let reserved = false
          let reservationAttempted = false
          let unreservedDatabaseStagePath: string | undefined
          try {
            assertLiveSidecar()
            const prepared = await portableLifecycle.prepareFreshImport(request)
            if (!prepared.ok) {
              resolve(prepared)
              return
            }
            const collision = readPortableImportCollision(
              sidecar,
              canonicalProfilePath,
              prepared.value.operationId,
              prepared.value.idempotencyKey,
            )
            if (collision) {
              blobStore.discardPortableStages(prepared.value.operationId)
              if (!portableImportMatchesPrepared(collision, prepared.value)) {
                resolve(profileServiceFailure('invalid', {
                  ...(mode === 'healthy' ? { currentRevision: collision.sourceRevision } : {}),
                }))
                return
              }
              if (collision.state === 'completed' && mode === 'healthy') {
                await verifyCompletedPortableImport(collision)
                resolve({
                  ok: true,
                  value: Object.freeze({ ...collision.receipt, replayed: true }),
                })
                return
              }
              const receipt = await finishPortableImportOperation(collision)
              resolve({ ok: true, value: receipt })
              return
            }
            if (mode !== 'fresh-import') {
              blobStore.discardPortableStages(prepared.value.operationId)
              resolve(profileServiceFailure('invalid', {
                ...(store ? { currentRevision: store.currentRevision() } : {}),
              }))
              return
            }
            assertFreshImportAuthority(sidecar, canonicalProfilePath)
            const stagePath = createPortableDatabaseStagePath(
              canonicalProfilePath,
              options.createPortableStageName?.() ?? randomUUID(),
            )
            unreservedDatabaseStagePath = stagePath
            const stage = createSqliteProfileImportStage({
              databasePath: stagePath,
              document: prepared.value.document,
              ...(options.openProfileRuntime ? { openRuntime: options.openProfileRuntime } : {}),
              ...(options.now ? { now: options.now } : {}),
            })
            const stageEvidence = claimSqliteProfileImportStage(stage)
            const expectedRoots = portableManifestBlobRoots(prepared.value)
            if (canonicalProfileJson(stageEvidence.blobRoots) !== canonicalProfileJson(expectedRoots)) {
              throw new PhysicalAuthorityError('Portable Profile staged database blob closure changed')
            }
            blobStore.publishPortableBlobs(
              prepared.value.operationId,
              prepared.value.stagedBlobs,
            )
            options.portableTestHooks?.afterBlobsPublished?.()
            reservationAttempted = true
            reservePortableImport(
              sidecar,
              canonicalProfilePath,
              prepared.value,
              stageEvidence,
              acquiredAt,
            )
            options.portableTestHooks?.afterReservationCommitBeforeAcknowledge?.()
            reserved = true
            unreservedDatabaseStagePath = undefined
            options.portableTestHooks?.afterImportReserved?.()
            const operation = readPendingPortableImport(sidecar, canonicalProfilePath)
            if (!operation || operation.operationId !== prepared.value.operationId) {
              throw new PhysicalAuthorityError('Portable Profile import reservation is missing')
            }
            const receipt = await finishPortableImportOperation(operation)
            blobStore.discardPortableStages(operation.operationId)
            resolve({ ok: true, value: receipt })
          } catch {
            if (reserved || reservationAttempted || existsSync(canonicalProfilePath)) {
              if (profileOpen && store) {
                try {
                  store.close()
                } catch {
                  authorityLost = true
                }
              }
              store = undefined
              profileOpen = false
              mode = 'recovery'
              accepting = false
              resolve(profileServiceFailure('corrupt-or-recovery-required'))
              return
            }
            try {
              blobStore.discardPortableStages(request.operationId)
            } catch {
              authorityLost = true
            }
            if (unreservedDatabaseStagePath) {
              try {
                removePortableDatabaseStage(canonicalProfilePath, unreservedDatabaseStagePath)
              } catch {
                authorityLost = true
              }
            }
            resolve(profileServiceFailure(authorityLost ? 'corrupt-or-recovery-required' : 'internal'))
          }
        })
      })
    },
    retryableWork() {
      return store?.retryableWork() ?? []
    },
    transitionProfileStorage<Result>(
      transition: (canonicalProfilePath: string) => Result | PromiseLike<Result>,
    ) {
      if (!accepting || closed || authorityLost || transitionPromise) {
        return Promise.resolve(profileServiceFailure('busy'))
      }
      accepting = false
      transitionPromise = queue.then(async () => {
        try {
          assertLiveAuthority()
          liveStore().close()
          profileOpen = false
          const value = await transition(canonicalProfilePath)
          assertSidecarOwnership(sidecar, sidecarPath, expectedSidecarIdentity, session)
          const replacementIdentity = requirePhysicalFile(canonicalProfilePath)
          store = openFencedProfileStore(
            options,
            canonicalProfilePath,
            ownershipCapability,
            blobStore,
            false,
          )
          profileOpen = true
          const currentProfile = store.currentProfileIdentity()
          recoveryManager.initialize(currentProfile)
          if (
            recoveryManager.hasPendingOperation()
            || recoveryManager.highWater() !== currentProfile.revision
          ) throw new PhysicalAuthorityError('SQLite Profile maintenance violated recovery authority')
          revalidateProfileIdentity(canonicalProfilePath, replacementIdentity)
          replaceBoundProfileIdentity(sidecar, session, replacementIdentity)
          activeProfileIdentity = replacementIdentity
          mode = 'healthy'
          accepting = !closingRequested
          transitionPromise = undefined
          return { ok: true, value }
        } catch {
          if (profileOpen && store) {
            try {
              store.close()
            } catch {
              authorityLost = true
            }
          }
          mode = 'recovery'
          accepting = false
          store = undefined
          profileOpen = false
          transitionPromise = undefined
          return profileServiceFailure('corrupt-or-recovery-required')
        }
      })
      const activeTransition = transitionPromise as Promise<ProfileServiceResult<Result>>
      queue = activeTransition.then(() => undefined)
      return activeTransition
    },
    close() {
      if (closePromise) return closePromise
      closingRequested = true
      accepting = false
      closePromise = queue.then(async () => {
        if (profileOpen && store) {
          // A verified generation on every clean close means ordinary users
          // gain recovery coverage without finding or invoking diagnostics.
          // Backup failure must never prevent the authority from closing.
          if (options.automaticRecoveryPoints && mode === 'healthy' && !authorityLost) {
            try {
              await recoveryManager.createRecoveryPoint(store)
            } catch {
              // createRecoveryPoint already fails closed; close remains best-effort.
            }
          }
          store.close()
          profileOpen = false
        }
        sidecar.close()
        closed = true
      })
      return closePromise
    },
  }

  if (startupPendingImport) {
    accepting = false
    queue = queue.then(async () => {
      try {
        await finishPortableImportOperation(startupPendingImport!)
      } catch {
        if (profileOpen && store) {
          try {
            store.close()
          } catch {
            authorityLost = true
          }
        }
        store = undefined
        profileOpen = false
        mode = 'recovery'
        accepting = false
      }
    })
  }

  return { ok: true, value: Object.freeze(coordinator) }
}

function openFencedProfileStore(
  options: SqliteProfileOwnerCoordinatorOptions,
  canonicalProfilePath: string,
  ownershipCapability: SqliteProfileOwnershipCapability,
  blobStore: SqliteProfileBlobStore,
  allowSeed: boolean,
): SqliteProfileRevisionStore {
  return createSqliteProfileRevisionStore({
    databasePath: canonicalProfilePath,
    ...(allowSeed && options.seed ? { seed: options.seed } : {}),
    ownershipCapability,
    agentCommandSurfaceVersion: PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
    materializeAsset: (asset) => blobStore.materializeAsset(asset),
    hydrateAsset: (payload) => blobStore.hydrateAsset(payload),
    ...(options.openProfileRuntime ? { openRuntime: options.openProfileRuntime } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.createCommitId ? { createCommitId: options.createCommitId } : {}),
    ...(options.createIntentEventId ? { createIntentEventId: options.createIntentEventId } : {}),
    ...(options.createAgentClientTxnId
      ? { createAgentClientTxnId: options.createAgentClientTxnId }
      : {}),
    ...(options.agentActor ? { agentActor: options.agentActor } : {}),
    ...(options.testHooks ? { testHooks: options.testHooks } : {}),
  })
}

function canonicalizeProfileDatabasePath(location: string): string {
  if (!path.isAbsolute(location) || location.includes('\0')) {
    throw new Error('SQLite Profile path must be absolute')
  }
  const resolved = path.resolve(location)
  if (path.basename(resolved).length === 0) throw new Error('SQLite Profile path requires a file name')
  try {
    return realpathSync.native(resolved)
  } catch (error) {
    if (readErrorCode(error) !== 'ENOENT') throw error
  }
  const parent = realpathSync.native(path.dirname(resolved))
  return path.join(parent, path.basename(resolved))
}

function initializePortableImportSchema(runtime: SqliteExclusiveRuntime): void {
  runtime.transaction('write', (connection) => {
    connection.exec(CREATE_PORTABLE_IMPORT_SCHEMA_SQL)
  })
}

function readPendingPortableImport(
  runtime: SqliteExclusiveRuntime,
  canonicalProfilePath: string,
): PortableImportOperation | undefined {
  return runtime.transaction('read', (connection) => {
    const rows = connection.prepare(`
SELECT * FROM profile_portable_import_operations
WHERE state != 'completed'
ORDER BY operation_id
`).all()
    if (rows.length > 1) {
      throw new PhysicalAuthorityError('SQLite owner sidecar has multiple pending portable imports')
    }
    return rows[0] ? readPortableImportOperation(rows[0], canonicalProfilePath) : undefined
  })
}

function readPendingPortableImportRow(runtime: SqliteRuntime): SqliteRow | undefined {
  const rows = runtime.prepare(`
SELECT * FROM profile_portable_import_operations
WHERE state != 'completed'
ORDER BY operation_id
`).all()
  if (rows.length > 1) {
    throw new PhysicalAuthorityError('SQLite owner sidecar has multiple pending portable imports')
  }
  return rows[0]
}

function readPortableImportCollision(
  runtime: SqliteExclusiveRuntime,
  canonicalProfilePath: string,
  operationId: string,
  idempotencyKey: string,
): PortableImportOperation | undefined {
  return runtime.transaction('read', (connection) => {
    const rows = connection.prepare(`
SELECT * FROM profile_portable_import_operations
WHERE operation_id = ? OR idempotency_key = ?
ORDER BY operation_id
`).all(operationId, idempotencyKey)
    if (rows.length > 1) {
      throw new PhysicalAuthorityError('Portable Profile import identity collides across operations')
    }
    return rows[0] ? readPortableImportOperation(rows[0], canonicalProfilePath) : undefined
  })
}

function readPortableImportOperation(
  row: SqliteRow,
  canonicalProfilePath: string,
): PortableImportOperation {
  const state = readString(row, 'state')
  if (state !== 'reserved' && state !== 'profile-published' && state !== 'completed') {
    throw new PhysicalAuthorityError('Portable Profile import state is invalid')
  }
  const operationId = readString(row, 'operation_id')
  const idempotencyKey = readString(row, 'idempotency_key')
  const requestDigest = readSha256(row, 'request_digest')
  const integrityRoot = readSha256(row, 'integrity_root')
  const logicalDigest = readSha256(row, 'logical_digest')
  const profileId = readString(row, 'profile_id')
  const sourceRevision = readNonNegativeInteger(row, 'source_revision')
  const databaseStagePath = readString(row, 'database_stage_path')
  assertPortableDatabaseStagePath(canonicalProfilePath, databaseStagePath)
  const databaseDigest = readSha256(row, 'database_digest')
  const databaseSize = readNonNegativeInteger(row, 'database_size')
  const blobRootsJson = readString(row, 'blob_roots_json')
  const receiptJson = readString(row, 'receipt_json')
  const blobRoots = parsePortableBlobRoots(blobRootsJson)
  const receipt = parsePortableImportReceipt(receiptJson)
  if (receipt.operationId !== operationId
    || receipt.profileId !== profileId
    || receipt.revision !== sourceRevision) {
    throw new PhysicalAuthorityError('Portable Profile import receipt does not match its operation')
  }
  return Object.freeze({
    operationId,
    idempotencyKey,
    requestDigest,
    integrityRoot,
    logicalDigest,
    profileId,
    sourceRevision,
    databaseStagePath,
    databaseDigest,
    databaseSize,
    blobRoots,
    receipt,
    state,
  })
}

function parsePortableBlobRoots(
  json: string,
): readonly Readonly<{ sha256: string; size: number }>[] {
  let value: unknown
  try {
    value = JSON.parse(json) as unknown
  } catch {
    throw new PhysicalAuthorityError('Portable Profile blob roots are invalid JSON')
  }
  if (!Array.isArray(value) || value.some((root) => (
    !root || typeof root !== 'object' || Array.isArray(root)
    || Object.keys(root).sort().join(',') !== 'sha256,size'
    || typeof (root as { sha256?: unknown }).sha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(String((root as { sha256: string }).sha256))
    || !Number.isSafeInteger((root as { size?: unknown }).size)
    || Number((root as { size: number }).size) < 0
  ))) throw new PhysicalAuthorityError('Portable Profile blob roots are invalid')
  const roots = value as Array<{ sha256: string; size: number }>
  const sorted = [...roots].sort((left, right) => left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0)
  if (new Set(roots.map((root) => root.sha256)).size !== roots.length
    || canonicalProfileJson(sorted) !== json) {
    throw new PhysicalAuthorityError('Portable Profile blob roots are not canonical')
  }
  return Object.freeze(roots.map((root) => Object.freeze({ ...root })))
}

function parsePortableImportReceipt(json: string): ProfilePortableFreshImportReceipt {
  let value: unknown
  try {
    value = JSON.parse(json) as unknown
  } catch {
    throw new PhysicalAuthorityError('Portable Profile import receipt is invalid JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',')
      !== 'importedAssetIds,importedRecordIds,operationId,profileId,replayed,revision,verified'
    || typeof (value as { operationId?: unknown }).operationId !== 'string'
    || typeof (value as { profileId?: unknown }).profileId !== 'string'
    || !Number.isSafeInteger((value as { revision?: unknown }).revision)
    || (value as { verified?: unknown }).verified !== true
    || (value as { replayed?: unknown }).replayed !== false
    || !isUniqueStringArray((value as { importedRecordIds?: unknown }).importedRecordIds)
    || !isUniqueStringArray((value as { importedAssetIds?: unknown }).importedAssetIds)) {
    throw new PhysicalAuthorityError('Portable Profile import receipt is invalid')
  }
  const receipt = value as ProfilePortableFreshImportReceipt
  if (canonicalProfileJson(receipt) !== json) {
    throw new PhysicalAuthorityError('Portable Profile import receipt is not canonical')
  }
  return Object.freeze({
    ...receipt,
    importedRecordIds: Object.freeze([...receipt.importedRecordIds]),
    importedAssetIds: Object.freeze([...receipt.importedAssetIds]),
  })
}

function reservePortableImport(
  runtime: SqliteExclusiveRuntime,
  canonicalProfilePath: string,
  prepared: SqlitePreparedFreshProfileImport,
  stage: Readonly<{
    databasePath: string
    profileId: string
    revision: number
    databaseDigest: string
    databaseSize: number
    blobRoots: readonly Readonly<{ sha256: string; size: number }>[]
  }>,
  startedAt: string,
): void {
  assertPortableDatabaseStagePath(canonicalProfilePath, stage.databasePath)
  if (stage.profileId !== prepared.document.head.profileId
    || stage.revision !== prepared.document.head.revision) {
    throw new PhysicalAuthorityError('Portable Profile database stage identity changed')
  }
  runtime.transaction('write', (connection) => {
    connection.exec(CREATE_PORTABLE_IMPORT_SCHEMA_SQL)
    const count = readNonNegativeInteger(
      connection.prepare('SELECT COUNT(*) AS count FROM profile_portable_import_operations').get(),
      'count',
    )
    if (count !== 0) throw new PhysicalAuthorityError('Fresh Profile already has an import operation')
    connection.prepare(`
INSERT INTO profile_portable_import_operations (
  operation_id, idempotency_key, request_digest, integrity_root, logical_digest,
  profile_id, source_revision, database_stage_path, database_digest,
  database_size, blob_roots_json, receipt_json, state, started_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?)
`).run(
      prepared.operationId,
      prepared.idempotencyKey,
      prepared.requestDigest,
      prepared.integrityRoot,
      prepared.logicalDigest,
      stage.profileId,
      stage.revision,
      stage.databasePath,
      stage.databaseDigest,
      stage.databaseSize,
      canonicalProfileJson(stage.blobRoots),
      canonicalProfileJson(prepared.receipt),
      startedAt,
    )
  })
}

function portableImportMatchesPrepared(
  operation: PortableImportOperation,
  prepared: SqlitePreparedFreshProfileImport,
): boolean {
  return operation.operationId === prepared.operationId
    && operation.idempotencyKey === prepared.idempotencyKey
    && operation.requestDigest === prepared.requestDigest
    && operation.integrityRoot === prepared.integrityRoot
    && operation.logicalDigest === prepared.logicalDigest
    && operation.profileId === prepared.document.head.profileId
    && operation.sourceRevision === prepared.document.head.revision
    && canonicalProfileJson(operation.receipt) === canonicalProfileJson(prepared.receipt)
}

function portableManifestBlobRoots(
  prepared: SqlitePreparedFreshProfileImport,
): readonly Readonly<{ sha256: string; size: number }>[] {
  const sizes = new Map<string, number>()
  for (const asset of prepared.manifest.assets) {
    const previous = sizes.get(asset.sha256)
    if (previous !== undefined && previous !== asset.size) {
      throw new PhysicalAuthorityError('Portable Profile manifest blob sizes conflict')
    }
    sizes.set(asset.sha256, asset.size)
  }
  return Object.freeze([...sizes].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([sha256, size]) => Object.freeze({ sha256, size })))
}

function createPortableDatabaseStagePath(canonicalProfilePath: string, stageName: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(stageName)) {
    throw new Error('Portable Profile database stage name is invalid')
  }
  return path.join(
    path.dirname(canonicalProfilePath),
    `.${path.basename(canonicalProfilePath)}.${stageName}.portable-import-stage.sqlite`,
  )
}

function assertPortableDatabaseStagePath(canonicalProfilePath: string, stagePath: string): void {
  const resolved = path.resolve(stagePath)
  const expectedParent = path.dirname(canonicalProfilePath)
  const prefix = `.${path.basename(canonicalProfilePath)}.`
  const suffix = '.portable-import-stage.sqlite'
  const baseName = path.basename(resolved)
  const stageName = baseName.slice(prefix.length, -suffix.length)
  if (path.dirname(resolved) !== expectedParent
    || !baseName.startsWith(prefix)
    || !baseName.endsWith(suffix)
    || !/^[A-Za-z0-9._-]{1,128}$/.test(stageName)
    || resolved === canonicalProfilePath) {
    throw new PhysicalAuthorityError('Portable Profile database stage path is outside its authority root')
  }
}

function sweepAbandonedPortableDatabaseStages(
  canonicalProfilePath: string,
  retainedStagePath: string | undefined,
): void {
  const parent = path.dirname(canonicalProfilePath)
  const prefix = `.${path.basename(canonicalProfilePath)}.`
  const suffix = '.portable-import-stage.sqlite'
  const retained = retainedStagePath === undefined ? undefined : path.resolve(retainedStagePath)
  const candidates = new Set<string>()
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    let baseName = entry.name
    if (baseName.endsWith(`${suffix}-wal`)) baseName = baseName.slice(0, -4)
    else if (baseName.endsWith(`${suffix}-shm`)) baseName = baseName.slice(0, -4)
    if (!baseName.startsWith(prefix) || !baseName.endsWith(suffix)) continue
    const stageName = baseName.slice(prefix.length, -suffix.length)
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(stageName)) continue
    const candidate = path.join(parent, baseName)
    if (retained !== undefined && path.resolve(candidate) === retained) continue
    candidates.add(candidate)
  }
  for (const candidate of candidates) {
    removePortableDatabaseStage(canonicalProfilePath, candidate)
  }
}

function removePortableDatabaseStage(canonicalProfilePath: string, stagePath: string): void {
  assertPortableDatabaseStagePath(canonicalProfilePath, stagePath)
  for (const location of [stagePath, `${stagePath}-wal`, `${stagePath}-shm`]) {
    try {
      const metadata = lstatSync(location, { bigint: true })
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n) {
        throw new PhysicalAuthorityError('Portable Profile database stage is not a private regular file')
      }
      unlinkSync(location)
    } catch (error) {
      if (readErrorCode(error) !== 'ENOENT') throw error
    }
  }
  flushDirectory(path.dirname(canonicalProfilePath))
}

function resumePortableDatabasePublication(
  runtime: SqliteExclusiveRuntime,
  canonicalProfilePath: string,
  operation: PortableImportOperation | undefined,
  hooks?: SqliteProfileOwnerCoordinatorOptions['portableTestHooks'],
): void {
  if (!operation) throw new PhysicalAuthorityError('Portable Profile import cannot be resumed')
  assertPortableDatabaseStagePath(canonicalProfilePath, operation.databaseStagePath)
  const stageExists = existsSync(operation.databaseStagePath)
  const profileExists = existsSync(canonicalProfilePath)
  if (!profileExists) {
    if (!stageExists) throw new PhysicalAuthorityError('Portable Profile import database stage is missing')
    verifyPortableDatabaseFile(
      operation.databaseStagePath,
      operation.databaseDigest,
      operation.databaseSize,
      1n,
    )
    linkSync(operation.databaseStagePath, canonicalProfilePath)
    hooks?.afterDatabaseLinkedBeforeStageUnlink?.()
    flushPublishedFile(canonicalProfilePath)
    flushDirectory(path.dirname(canonicalProfilePath))
    unlinkSync(operation.databaseStagePath)
    flushDirectory(path.dirname(canonicalProfilePath))
  } else if (stageExists) {
    const stage = lstatSync(operation.databaseStagePath, { bigint: true })
    const profile = lstatSync(canonicalProfilePath, { bigint: true })
    if (!stage.isFile() || !profile.isFile()
      || stage.dev !== profile.dev || stage.ino !== profile.ino
      || stage.birthtimeNs !== profile.birthtimeNs) {
      throw new PhysicalAuthorityError('Portable Profile publication names do not identify one stage')
    }
    verifyPortableDatabaseFile(
      canonicalProfilePath,
      operation.databaseDigest,
      operation.databaseSize,
      2n,
    )
    unlinkSync(operation.databaseStagePath)
    flushPublishedFile(canonicalProfilePath)
    flushDirectory(path.dirname(canonicalProfilePath))
  } else {
    const bound = runtime.transaction('read', (connection) => (
      readPersistedProfileIdentity(readOwnerRow(connection))
    ))
    if (bound) {
      assertSamePhysicalFile(bound, requirePhysicalFile(canonicalProfilePath))
    } else {
      verifyPortableDatabaseFile(
        canonicalProfilePath,
        operation.databaseDigest,
        operation.databaseSize,
        1n,
      )
    }
  }
  const boundAfterPublication = runtime.transaction('read', (connection) => (
    readPersistedProfileIdentity(readOwnerRow(connection))
  ))
  if (!boundAfterPublication) {
    verifyPortableDatabaseFile(
      canonicalProfilePath,
      operation.databaseDigest,
      operation.databaseSize,
      1n,
    )
  }
}

function verifyPortableDatabaseFile(
  location: string,
  expectedDigest: string,
  expectedSize: number,
  expectedLinks: bigint,
): void {
  const before = lstatSync(location, { bigint: true })
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== expectedLinks
    || before.size !== BigInt(expectedSize)) {
    throw new PhysicalAuthorityError('Portable Profile database publication identity is invalid')
  }
  const descriptor = openSync(location, constants.O_RDONLY)
  const digest = createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  let size = 0
  try {
    const opened = fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.birthtimeNs !== before.birthtimeNs || opened.size !== before.size) {
      throw new PhysicalAuthorityError('Portable Profile database identity changed while verifying')
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
  if (size !== expectedSize || digest.digest('hex') !== expectedDigest) {
    throw new PhysicalAuthorityError('Portable Profile database digest changed before publication')
  }
}

async function verifyPortableImportProfile(
  canonicalProfilePath: string,
  operation: PortableImportOperation,
  blobStore: SqliteProfileBlobStore,
  openRuntime?: (databasePath: string) => SqliteRuntime,
): Promise<void> {
  const inspection = inspectSqliteProfileRevisionDatabase({
    databasePath: canonicalProfilePath,
    metadataOnly: true,
    ...(openRuntime ? { openRuntime } : {}),
  })
  if (inspection.profileId !== operation.profileId
    || inspection.revision !== operation.sourceRevision
    || inspection.logicalDigest !== operation.logicalDigest
    || canonicalProfileJson(inspection.blobRoots) !== canonicalProfileJson(operation.blobRoots)) {
    throw new PhysicalAuthorityError('Portable Profile publication does not match its reservation')
  }
  for (const root of operation.blobRoots) await blobStore.verifyPortableBlob(root)
}

function bindPortableImportProfile(
  runtime: SqliteExclusiveRuntime,
  session: ProfileOwnerSession,
  identity: PhysicalFileIdentity,
  operationId: string,
): void {
  runtime.transaction('write', (connection) => {
    const owner = readOwnerRow(connection)
    assertOwnerSession(owner, session)
    const persisted = readPersistedProfileIdentity(owner)
    if (persisted) assertSamePhysicalFile(persisted, identity)
    else writeBoundProfileIdentity(connection, identity)
    const result = connection.prepare(`
UPDATE profile_portable_import_operations
SET state = 'profile-published'
WHERE operation_id = ? AND state IN ('reserved', 'profile-published')
`).run(operationId)
    if (Number(result.changes) !== 1) {
      throw new PhysicalAuthorityError('Portable Profile publication could not bind its owner')
    }
  })
}

function completePortableImport(
  runtime: SqliteExclusiveRuntime,
  operationId: string,
  completedAt: string,
): void {
  runtime.transaction('write', (connection) => {
    const result = connection.prepare(`
UPDATE profile_portable_import_operations
SET state = 'completed', completed_at = ?
WHERE operation_id = ? AND state IN ('profile-published', 'completed')
`).run(completedAt, operationId)
    if (Number(result.changes) !== 1) {
      throw new PhysicalAuthorityError('Portable Profile import completion could not advance')
    }
  })
}

function assertFreshImportAuthority(
  runtime: SqliteExclusiveRuntime,
  canonicalProfilePath: string,
): void {
  if (existsSync(canonicalProfilePath)) {
    throw new PhysicalAuthorityError('Fresh Profile destination is no longer empty')
  }
  runtime.transaction('read', (connection) => {
    if (readPersistedProfileIdentity(readOwnerRow(connection))) {
      throw new PhysicalAuthorityError('Fresh Profile owner is already bound')
    }
    const count = readNonNegativeInteger(
      connection.prepare('SELECT COUNT(*) AS count FROM profile_portable_import_operations').get(),
      'count',
    )
    if (count !== 0) throw new PhysicalAuthorityError('Fresh Profile already has an import operation')
  })
}

function flushPublishedFile(location: string): void {
  const descriptor = openSync(location, constants.O_RDWR)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function flushDirectory(location: string): void {
  let descriptor: number | undefined
  try {
    descriptor = openSync(location, constants.O_RDONLY)
    fsyncSync(descriptor)
  } catch (error) {
    if (process.platform !== 'win32' || readErrorCode(error) !== 'EPERM') throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function readSha256(row: SqliteRow | undefined, key: string): string {
  const value = readString(row, key)
  if (!/^[0-9a-f]{64}$/.test(value)) throw new PhysicalAuthorityError(`SQLite owner ${key} is invalid`)
  return value
}

function readNonNegativeInteger(row: SqliteRow | undefined, key: string): number {
  const value = readColumn(row, key)
  const normalized = typeof value === 'bigint' ? Number(value) : value
  if (!Number.isSafeInteger(normalized) || Number(normalized) < 0) {
    throw new PhysicalAuthorityError(`SQLite owner ${key} is invalid`)
  }
  return Number(normalized)
}

function isUniqueStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === 'string' && entry.length > 0)
    && new Set(value).size === value.length
}

function advanceOwnerGeneration(
  runtime: SqliteExclusiveRuntime,
  ownerId: string,
  ownerToken: string,
  acquiredAt: string,
  profileIdentity: PhysicalFileIdentity | undefined,
  allowInitializeAuthority: boolean,
  allowUnboundFreshImport: boolean,
): Readonly<{
  generation: number
  profileIdentityMatches: boolean
  profileDeviceDrift: boolean
}> {
  return runtime.transaction('write', (connection) => {
    connection.exec(CREATE_OWNER_SCHEMA_SQL)
    connection.exec(CREATE_PORTABLE_IMPORT_SCHEMA_SQL)
    const row = connection.prepare(`
SELECT generation, profile_device, profile_inode, profile_birthtime
FROM profile_owner_generation
WHERE identity = 1
`).get()
    if (!row) {
      if (!allowInitializeAuthority || profileIdentity) {
        throw new PhysicalAuthorityError('SQLite owner sidecar has no bound Profile identity')
      }
      connection.prepare(`
INSERT INTO profile_owner_generation (
  identity, generation, owner_token, owner_id, acquired_at
) VALUES (1, 1, ?, ?, ?)
`).run(ownerToken, ownerId, acquiredAt)
      return Object.freeze({
        generation: 1,
        profileIdentityMatches: false,
        profileDeviceDrift: false,
      })
    }
    const persistedIdentity = readPersistedProfileIdentity(row)
    if (!persistedIdentity) {
      if (!allowUnboundFreshImport
        || (profileIdentity && !readPendingPortableImportRow(connection))) {
        throw new PhysicalAuthorityError('SQLite owner sidecar Profile identity is incomplete')
      }
      const generation = readPositiveInteger(row, 'generation') + 1
      if (!Number.isSafeInteger(generation)) throw new Error('SQLite owner generation is exhausted')
      connection.prepare(`
UPDATE profile_owner_generation
SET generation = ?, owner_token = ?, owner_id = ?, acquired_at = ?
WHERE identity = 1
`).run(generation, ownerToken, ownerId, acquiredAt)
      return Object.freeze({
        generation,
        profileIdentityMatches: false,
        profileDeviceDrift: false,
      })
    }
    let profileIdentityMatches = false
    let profileDeviceDrift = false
    if (profileIdentity) {
      try {
        assertSamePhysicalFile(persistedIdentity, profileIdentity)
        profileIdentityMatches = true
      } catch (error) {
        if (!(error instanceof PhysicalAuthorityError)) throw error
        profileDeviceDrift = isDeviceOnlyPhysicalIdentityDrift(
          persistedIdentity,
          profileIdentity,
        )
      }
    }
    const generation = readPositiveInteger(row, 'generation') + 1
    if (!Number.isSafeInteger(generation)) throw new Error('SQLite owner generation is exhausted')
    connection.prepare(`
UPDATE profile_owner_generation
SET generation = ?, owner_token = ?, owner_id = ?, acquired_at = ?
WHERE identity = 1
`).run(generation, ownerToken, ownerId, acquiredAt)
    return Object.freeze({ generation, profileIdentityMatches, profileDeviceDrift })
  })
}

function rebindProfileDeviceAfterRemount(
  runtime: SqliteExclusiveRuntime,
  session: ProfileOwnerSession,
  identity: PhysicalFileIdentity,
): void {
  runtime.transaction('write', (connection) => {
    const row = readOwnerRow(connection)
    assertOwnerSession(row, session)
    const persisted = readPersistedProfileIdentity(row)
    if (!persisted || !isDeviceOnlyPhysicalIdentityDrift(persisted, identity)) {
      throw new PhysicalAuthorityError(
        'SQLite Profile device remount identity is not a narrow rebind',
      )
    }
    writeBoundProfileIdentity(connection, identity)
  })
}

function isDeviceOnlyPhysicalIdentityDrift(
  persisted: PhysicalFileIdentity,
  actual: PhysicalFileIdentity,
): boolean {
  return persisted.device !== actual.device
    && persisted.inode === actual.inode
    && persisted.birthtime === actual.birthtime
}

function bindInitialProfileIdentity(
  runtime: SqliteExclusiveRuntime,
  session: ProfileOwnerSession,
  identity: PhysicalFileIdentity,
): void {
  runtime.transaction('write', (connection) => {
    const row = readOwnerRow(connection)
    assertOwnerSession(row, session)
    const persisted = readPersistedProfileIdentity(row)
    if (persisted) {
      assertSamePhysicalFile(persisted, identity)
      return
    }
    writeBoundProfileIdentity(connection, identity)
  })
}

function assertBoundProfileIdentity(
  runtime: SqliteExclusiveRuntime,
  identity: PhysicalFileIdentity,
): void {
  runtime.transaction('read', (connection) => {
    const persisted = readPersistedProfileIdentity(readOwnerRow(connection))
    if (!persisted) throw new PhysicalAuthorityError('SQLite owner Profile identity is missing')
    assertSamePhysicalFile(persisted, identity)
  })
}

function replaceBoundProfileIdentity(
  runtime: SqliteExclusiveRuntime,
  session: ProfileOwnerSession,
  identity: PhysicalFileIdentity,
): void {
  runtime.transaction('write', (connection) => {
    assertOwnerSession(readOwnerRow(connection), session)
    writeBoundProfileIdentity(connection, identity)
  })
}

function readOwnerRow(runtime: SqliteRuntime): SqliteRow {
  const row = runtime.prepare(`
SELECT owner_token, generation, profile_device, profile_inode, profile_birthtime
FROM profile_owner_generation
WHERE identity = 1
`).get()
  if (!row) throw new PhysicalAuthorityError('SQLite owner sidecar metadata is missing')
  return row
}

function assertOwnerSession(row: SqliteRow, session: ProfileOwnerSession): void {
  if (
    readString(row, 'owner_token') !== session.ownerToken
    || readPositiveInteger(row, 'generation') !== session.generation
  ) throw new PhysicalAuthorityError('SQLite owner sidecar session changed')
}

function writeBoundProfileIdentity(
  runtime: SqliteRuntime,
  identity: PhysicalFileIdentity,
): void {
  const result = runtime.prepare(`
UPDATE profile_owner_generation
SET profile_device = ?, profile_inode = ?, profile_birthtime = ?
WHERE identity = 1
`).run(
    identity.device.toString(),
    identity.inode.toString(),
    identity.birthtime.toString(),
  )
  if (Number(result.changes) !== 1) {
    throw new PhysicalAuthorityError('SQLite owner Profile identity was not bound')
  }
}

function assertSidecarOwnership(
  runtime: SqliteExclusiveRuntime,
  sidecarPath: string,
  expectedIdentity: PhysicalFileIdentity,
  expected: { ownerToken: string; generation: number },
): void {
  assertSamePhysicalFile(expectedIdentity, requirePhysicalFile(sidecarPath))
  const lockingMode = readColumn(runtime.prepare('PRAGMA locking_mode').get(), 'locking_mode')
  if (typeof lockingMode !== 'string' || lockingMode.toLowerCase() !== 'exclusive') {
    throw new Error('SQLite owner sidecar lost exclusive locking mode')
  }
  runtime.transaction('read', (connection) => {
    const row = connection.prepare(`
SELECT owner_token, generation
FROM profile_owner_generation
WHERE identity = 1
`).get()
    if (
      readString(row, 'owner_token') !== expected.ownerToken
      || readPositiveInteger(row, 'generation') !== expected.generation
    ) throw new Error('SQLite owner sidecar fence was lost')
  })
}

function revalidateProfileIdentity(
  location: string,
  expected: PhysicalFileIdentity | undefined,
): void {
  const actual = capturePhysicalFile(location)
  if (!expected && !actual) return
  if (!expected || !actual) throw new PhysicalAuthorityError('SQLite Profile file identity changed')
  assertSamePhysicalFile(expected, actual)
}

function readPersistedProfileIdentity(row: SqliteRow): PhysicalFileIdentity | undefined {
  const device = readColumn(row, 'profile_device')
  const inode = readColumn(row, 'profile_inode')
  const birthtime = readColumn(row, 'profile_birthtime')
  if (device === null && inode === null && birthtime === null) return undefined
  if (typeof device !== 'string' || typeof inode !== 'string' || typeof birthtime !== 'string') {
    throw new PhysicalAuthorityError('SQLite owner Profile identity is invalid')
  }
  try {
    return Object.freeze({
      device: BigInt(device),
      inode: BigInt(inode),
      birthtime: BigInt(birthtime),
    })
  } catch {
    throw new PhysicalAuthorityError('SQLite owner Profile identity is invalid')
  }
}

function normalizeRoute(route: unknown): ProfileOwnershipRequest['route'] {
  if (route === undefined) return 'exclusive-headless-owner'
  if (route === 'active-owner' || route === 'exclusive-headless-owner') return route
  throw new Error('SQLite owner route is invalid')
}

function validateOwnerMetadata(ownerId: string, ownerToken: string): void {
  if (ownerId.length === 0 || ownerToken.length < 32) {
    throw new Error('SQLite owner metadata is invalid')
  }
}

function createPrivateOwnerToken(): string {
  return randomBytes(32).toString('hex')
}

function readPositiveInteger(row: SqliteRow | undefined, key: string): number {
  const value = readColumn(row, key)
  const normalized = typeof value === 'bigint' ? Number(value) : value
  if (!Number.isSafeInteger(normalized) || Number(normalized) < 1) {
    throw new Error(`SQLite owner ${key} is invalid`)
  }
  return Number(normalized)
}

function readString(row: SqliteRow | undefined, key: string): string {
  const value = readColumn(row, key)
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`SQLite owner ${key} is invalid`)
  }
  return value
}

function readColumn(row: SqliteRow | undefined, key: string): SqliteOutput | undefined {
  if (!row || !(key in row)) return undefined
  return row[key]
}

function readErrorCode(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  return error.code
}

function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const sqliteError = error as Error & { code?: unknown; errcode?: unknown }
  if (sqliteError.code === 'ERR_SQLITE_BUSY') return true
  return sqliteError.code === 'ERR_SQLITE_ERROR'
    && typeof sqliteError.errcode === 'number'
    && (sqliteError.errcode & 0xff) === 5
}
