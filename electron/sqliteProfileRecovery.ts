import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  canonicalProfileJson,
  type ProfileAssetHydrator,
} from '../src/persistence/profileRevisionKernel'
import {
  PROFILE_CONTRACT_VERSIONS,
  profileServiceFailure,
  type ProfileRecoveryPointSummary,
  type ProfileRecoveryReceipt,
  type ProfileRecoveryRequest,
  type ProfileServiceResult,
} from '../src/persistence/profileServiceContract'
import type { SqliteProfileBlobStore } from './sqliteProfileBlobStore'
import {
  appendSqliteProfileRecoveryRevision,
  claimSqliteProfileImportStage,
  createSqliteProfileImportStage,
  inspectSqliteProfileRevisionDatabase,
  type SqliteProfileRevisionInspection,
  type SqliteProfileRevisionStore,
} from './sqliteProfileRevisionStore'
import type { SqliteExclusiveRuntime, SqliteOutput, SqliteRow, SqliteRuntime } from './sqliteRuntime'

const RECOVERY_FORMAT = 'eido-profile-recovery'
const RECOVERY_VERSION = 1
const RETAINED_GENERATIONS = 3
const CANDIDATE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/

export type SqliteProfileRecoveryInspection = Readonly<{
  mode: 'inspect'
  selectedCandidateId?: string
  candidates: readonly ProfileRecoveryPointSummary[]
  rejectedCandidateIds: readonly string[]
  quarantinedCurrentState: false
}>

export type SqliteProfileRecoveryRestoreReceipt = Readonly<
  ProfileRecoveryReceipt & { mode: 'restore'; selectedCandidateId: string }
>

export type SqliteProfileRecoveryPromotion = Readonly<{
  operationId: string
  candidateId: string
  previousRevision: number
  revision: number
  quarantinedCurrentState: boolean
}>

/** Receipt for the start-fresh escape hatch (#813): the incompatible Profile is
 * set aside byte-for-byte and a brand-new seeded Profile becomes the authority. */
export type SqliteProfileStartFreshReceipt = Readonly<{
  mode: 'start-fresh'
  operationId: string
  previousRevision: number
  profileId: string
  revision: number
  quarantinedCurrentState: boolean
}>

export type SqliteProfileStartFreshPromotion = Readonly<{
  operationId: string
  previousRevision: number
  profileId: string
  revision: number
  quarantinedCurrentState: boolean
}>

export type SqliteProfileStartupSafetyCopy = Readonly<{
  id: string
  databasePath: string
}>

type StartFreshFreshEvidence = Readonly<{
  profileId: string
  revision: number
  sha256: string
  size: number
}>

type StartFreshOperation = Readonly<{
  operationId: string
  quarantineId: string
  previousRevision: number
  fresh?: StartFreshFreshEvidence
  state: 'reserved' | 'quarantined' | 'staged' | 'promoted' | 'completed'
}>

type RecoveryManifest = Readonly<{
  format: typeof RECOVERY_FORMAT
  version: typeof RECOVERY_VERSION
  candidateId: string
  profileId: string
  sourceRevision: number
  createdAt: string
  versions: typeof PROFILE_CONTRACT_VERSIONS
  database: Readonly<{ sha256: string; size: number }>
  blobs: readonly Readonly<{ sha256: string; size: number }>[]
}>

type RecoveryCompletion = Readonly<{
  format: 'eido-profile-recovery-complete'
  version: typeof RECOVERY_VERSION
  candidateId: string
  manifestSha256: string
  databaseSha256: string
  completedAt: string
}>

type VerifiedCandidate = Readonly<{
  manifest: RecoveryManifest
  summary: ProfileRecoveryPointSummary
  databasePath: string
}>

type RecoveryOperation = Readonly<{
  operationId: string
  candidateId: string
  sourceRevision: number
  expectedRevision: number
  reservedRevision: number
  quarantineId: string
  state: 'reserved' | 'quarantined' | 'promoted' | 'completed'
}>

export type SqliteProfileRecoveryManager = Readonly<{
  initialize(observed?: Readonly<{
    profileId: string
    revision: number
    latestRecovery?: NonNullable<SqliteProfileRevisionInspection['latestRecovery']>
  }>): void
  observeRevision(revision: number): void
  highWater(): number
  trustedProfileId(): string | undefined
  hasPendingOperation(): boolean
  pendingOperationKind(): 'restore' | 'start-fresh' | undefined
  pendingStartFreshSourcePath(): string | undefined
  retainedBlobDigests(): readonly string[]
  /** Capture the unopened canonical SQLite files before startup can mutate
   * them. Healthy startup discards this copy; repair retains it as evidence. */
  captureStartupSafetyCopy(): SqliteProfileStartupSafetyCopy | undefined
  discardStartupSafetyCopy(copy: SqliteProfileStartupSafetyCopy): void
  createRecoveryPoint(
    store: SqliteProfileRevisionStore,
  ): Promise<ProfileServiceResult<ProfileRecoveryPointSummary>>
  inspect(): ProfileServiceResult<SqliteProfileRecoveryInspection>
  replayCompleted(
    request: Extract<ProfileRecoveryRequest, { mode: 'restore' }>,
  ): SqliteProfileRecoveryPromotion | undefined
  promote(
    request: Extract<ProfileRecoveryRequest, { mode: 'restore' }>,
  ): ProfileServiceResult<SqliteProfileRecoveryPromotion>
  complete(operationId: string): void
  /** Quarantine the current (possibly unreadable) Profile bytes and promote a
   * freshly seeded Profile in their place. Crash boundaries mirror restore:
   * reserved -> quarantined -> staged -> promoted, resumable at every step. */
  startFresh(request: Readonly<{ document: unknown }>): ProfileServiceResult<
    SqliteProfileStartFreshPromotion
  >
  completeStartFresh(promotion: SqliteProfileStartFreshPromotion): void
}>

export type SqliteProfileRecoveryManagerOptions = Readonly<{
  profileDatabasePath: string
  sidecarRuntime: SqliteExclusiveRuntime
  blobStore: SqliteProfileBlobStore
  openProfileRuntime?: (databasePath: string) => SqliteRuntime
  now?: () => string
  createCandidateId?: (revision: number) => string
  createOperationId?: () => string
  testHooks?: {
    afterGenerationFilesFlushed?: () => void
    afterReservationBeforeQuarantine?: () => void
    afterQuarantineBeforePromotion?: () => void
    afterPromotionBeforeReopen?: () => void
    afterStartFreshReservation?: () => void
    afterStartFreshQuarantine?: () => void
    afterStartFreshStageBeforePromotion?: () => void
    afterStartFreshPromotionBeforeReopen?: () => void
  }
}>

export function isSqliteProfileRecoveryCandidateId(value: unknown): value is string {
  return typeof value === 'string' && CANDIDATE_ID_PATTERN.test(value)
}

const CREATE_RECOVERY_STATE_SQL = `
CREATE TABLE IF NOT EXISTS profile_recovery_state (
  identity INTEGER PRIMARY KEY CHECK (identity = 1),
  revision_high_water INTEGER NOT NULL CHECK (revision_high_water >= 0),
  profile_id TEXT
);

CREATE TABLE IF NOT EXISTS profile_recovery_operations (
  operation_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 0 AND source_revision <= expected_revision),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  reserved_revision INTEGER NOT NULL CHECK (reserved_revision = expected_revision + 1),
  quarantine_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'quarantined', 'promoted', 'completed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (candidate_id, expected_revision)
);

CREATE TABLE IF NOT EXISTS profile_start_fresh_operations (
  operation_id TEXT PRIMARY KEY,
  quarantine_id TEXT NOT NULL UNIQUE,
  previous_profile_id TEXT,
  previous_revision INTEGER NOT NULL CHECK (previous_revision >= 0),
  fresh_profile_id TEXT,
  fresh_revision INTEGER CHECK (fresh_revision IS NULL OR fresh_revision >= 0),
  fresh_database_sha256 TEXT,
  fresh_database_size INTEGER CHECK (fresh_database_size IS NULL OR fresh_database_size >= 0),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'quarantined', 'staged', 'promoted', 'completed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (fresh_profile_id IS NULL AND fresh_revision IS NULL
      AND fresh_database_sha256 IS NULL AND fresh_database_size IS NULL)
    OR (fresh_profile_id IS NOT NULL AND fresh_revision IS NOT NULL
      AND fresh_database_sha256 IS NOT NULL AND fresh_database_size IS NOT NULL)
  ),
  CHECK (state NOT IN ('staged', 'promoted', 'completed') OR fresh_profile_id IS NOT NULL)
);
`

export function createSqliteProfileRecoveryManager(
  options: SqliteProfileRecoveryManagerOptions,
): SqliteProfileRecoveryManager {
  const profileDatabasePath = path.resolve(options.profileDatabasePath)
  const recoveryRoot = `${profileDatabasePath}.recovery`
  const generationsRoot = path.join(recoveryRoot, 'generations')
  const quarantineRoot = path.join(recoveryRoot, 'quarantine')
  const now = options.now ?? (() => new Date().toISOString())
  const createCandidateId = options.createCandidateId
    ?? ((revision: number) => `revision-${revision}-${randomUUID()}`)
  const createOperationId = options.createOperationId ?? (() => randomUUID())
  const hydrateAsset: ProfileAssetHydrator = (payload) => options.blobStore.hydrateAsset(payload)
  const openRuntime = options.openProfileRuntime

  const manager: SqliteProfileRecoveryManager = {
    initialize(observed) {
      options.sidecarRuntime.transaction('write', (connection) => {
        connection.exec(CREATE_RECOVERY_STATE_SQL)
        const existing = connection.prepare(`
SELECT profile_id, revision_high_water
FROM profile_recovery_state
WHERE identity = 1
`).get()
        if (observed && existing) {
          const persistedProfileId = readNullableString(existing, 'profile_id')
          if (persistedProfileId && persistedProfileId !== observed.profileId) {
            throw new Error('SQLite recovery Profile identity changed')
          }
          if (observed.latestRecovery) {
            const operation = readOperation(connection, observed.latestRecovery.operationId)
            if (
              !operation
              || (operation.state !== 'promoted' && operation.state !== 'completed')
              || readNonNegativeInteger(existing, 'revision_high_water') !== observed.revision
              || !operationMatchesRecoveryHead(operation, observed.latestRecovery, observed.revision)
            ) throw new Error('SQLite recovery head is not closed over its sidecar operation')
          }
        } else if (observed?.latestRecovery) {
          throw new Error('SQLite recovery head has no trusted sidecar state')
        }
        connection.prepare(`
INSERT INTO profile_recovery_state (identity, revision_high_water, profile_id)
VALUES (1, ?, ?)
ON CONFLICT(identity) DO UPDATE SET
  revision_high_water = MAX(revision_high_water, excluded.revision_high_water),
  profile_id = COALESCE(profile_recovery_state.profile_id, excluded.profile_id)
`).run(observed?.revision ?? 0, observed?.profileId ?? null)
        if (observed) {
          const persistedProfileId = readNullableString(
            connection.prepare(`
SELECT profile_id FROM profile_recovery_state WHERE identity = 1
`).get(),
            'profile_id',
          )
          if (persistedProfileId !== observed.profileId) {
            throw new Error('SQLite recovery Profile identity changed')
          }
        }
      })
    },
    observeRevision(revision) {
      requireRevision(revision, 'observed Profile revision')
      options.sidecarRuntime.transaction('write', (connection) => {
        connection.exec(CREATE_RECOVERY_STATE_SQL)
        const result = connection.prepare(`
UPDATE profile_recovery_state
SET revision_high_water = MAX(revision_high_water, ?)
WHERE identity = 1
`).run(revision)
        if (Number(result.changes) !== 1) throw new Error('SQLite recovery high-water is missing')
      })
    },
    highWater() {
      return options.sidecarRuntime.transaction('read', (connection) => readHighWater(connection))
    },
    trustedProfileId() {
      return options.sidecarRuntime.transaction('read', (connection) => readNullableString(
        connection.prepare(`
SELECT profile_id FROM profile_recovery_state WHERE identity = 1
`).get(),
        'profile_id',
      ))
    },
    hasPendingOperation() {
      return options.sidecarRuntime.transaction('read', (connection) => Boolean(
        readPendingOperation(connection) ?? readPendingStartFreshOperation(connection),
      ))
    },
    pendingOperationKind() {
      return options.sidecarRuntime.transaction('read', (connection) => {
        if (readPendingOperation(connection)) return 'restore'
        if (readPendingStartFreshOperation(connection)) return 'start-fresh'
        return undefined
      })
    },
    pendingStartFreshSourcePath() {
      return options.sidecarRuntime.transaction('read', (connection) => {
        const operation = readPendingStartFreshOperation(connection)
        if (!operation) return undefined
        const quarantined = path.join(
          ownedCandidateDirectory(quarantineRoot, operation.quarantineId),
          path.basename(profileDatabasePath),
        )
        if (existsSync(quarantined)) return quarantined
        if (existsSync(profileDatabasePath)) return profileDatabasePath
        return undefined
      })
    },
    retainedBlobDigests() {
      const { accepted } = inspectCandidates()
      return Object.freeze([...new Set(accepted.flatMap((candidate) => (
        candidate.manifest.blobs.map((blob) => blob.sha256)
      )))].sort())
    },
    captureStartupSafetyCopy() {
      if (!existsSync(profileDatabasePath)) return undefined
      ensureDirectory(recoveryRoot)
      ensureDirectory(quarantineRoot)
      const id = `startup-${createOperationId()}`
      requireCandidateId(id)
      const directory = ownedCandidateDirectory(quarantineRoot, id)
      mkdirSync(directory)
      let copiedDatabasePath: string | undefined
      for (const suffix of ['', '-wal', '-shm'] as const) {
        const source = `${profileDatabasePath}${suffix}`
        if (!existsSync(source)) continue
        const target = path.join(directory, `${path.basename(profileDatabasePath)}${suffix}`)
        copyFileSync(source, target, constants.COPYFILE_FICLONE)
        requireSingleLinkRegularFile(target)
        flushFile(target)
        if (suffix === '') copiedDatabasePath = target
      }
      if (!copiedDatabasePath) {
        rmSync(directory, { recursive: true })
        flushDirectory(quarantineRoot)
        return undefined
      }
      flushDirectory(directory)
      flushDirectory(quarantineRoot)
      return Object.freeze({ id, databasePath: copiedDatabasePath })
    },
    discardStartupSafetyCopy(copy) {
      requireCandidateId(copy.id)
      const directory = ownedCandidateDirectory(quarantineRoot, copy.id)
      const expectedDatabasePath = path.join(directory, path.basename(profileDatabasePath))
      if (path.resolve(copy.databasePath) !== path.resolve(expectedDatabasePath)) {
        throw new Error('SQLite startup safety copy is outside its owned directory')
      }
      if (!existsSync(directory)) return
      requireDirectory(directory)
      rmSync(directory, { recursive: true })
      flushDirectory(quarantineRoot)
    },
    async createRecoveryPoint(store) {
      let candidateDirectory: string | undefined
      try {
        const revision = store.currentRevision()
        manager.observeRevision(revision)
        const profileId = store.currentProfileIdentity().profileId
        const existing = inspectCandidates().accepted.find((candidate) => (
          candidate.manifest.profileId === profileId
          && candidate.manifest.sourceRevision === revision
        ))
        if (existing) return { ok: true, value: existing.summary }
        const candidateId = createCandidateId(revision)
        requireCandidateId(candidateId)
        ensureDirectory(recoveryRoot)
        ensureDirectory(generationsRoot)
        candidateDirectory = ownedCandidateDirectory(generationsRoot, candidateId)
        mkdirSync(candidateDirectory)
        const databasePath = path.join(candidateDirectory, 'profile.sqlite')
        await store.createStandaloneBackup(databasePath)
        flushFile(databasePath)
        const inspected = inspectDatabase(databasePath)
        if (inspected.revision !== revision) {
          throw new Error('SQLite recovery backup did not preserve the admitted revision')
        }
        const database = fileDigest(databasePath)
        const createdAt = now()
        const manifest: RecoveryManifest = Object.freeze({
          format: RECOVERY_FORMAT,
          version: RECOVERY_VERSION,
          candidateId,
          profileId: inspected.profileId,
          sourceRevision: inspected.revision,
          createdAt,
          versions: PROFILE_CONTRACT_VERSIONS,
          database,
          blobs: inspected.blobRoots,
        })
        const manifestBytes = Buffer.from(canonicalProfileJson(manifest), 'utf8')
        const manifestPath = path.join(candidateDirectory, 'manifest.json')
        writeExclusiveFlushedFile(manifestPath, manifestBytes)
        flushDirectory(candidateDirectory)
        options.testHooks?.afterGenerationFilesFlushed?.()
        const complete: RecoveryCompletion = Object.freeze({
          format: 'eido-profile-recovery-complete',
          version: RECOVERY_VERSION,
          candidateId,
          manifestSha256: sha256(manifestBytes),
          databaseSha256: database.sha256,
          completedAt: createdAt,
        })
        writeExclusiveFlushedFile(
          path.join(candidateDirectory, 'complete.json'),
          Buffer.from(canonicalProfileJson(complete), 'utf8'),
        )
        flushDirectory(candidateDirectory)
        flushDirectory(generationsRoot)
        const verified = verifyCandidate(candidateId)
        pruneVerifiedGenerations()
        return { ok: true, value: verified.summary }
      } catch {
        return profileServiceFailure('internal')
      }
    },
    inspect() {
      try {
        const { accepted, rejected } = inspectCandidates()
        const selected = accepted[0]
        return {
          ok: true,
          value: Object.freeze({
            mode: 'inspect',
            ...(selected ? { selectedCandidateId: selected.summary.id } : {}),
            candidates: Object.freeze(accepted.map((candidate) => candidate.summary)),
            rejectedCandidateIds: Object.freeze(rejected),
            quarantinedCurrentState: false,
          }),
        }
      } catch {
        return profileServiceFailure('corrupt-or-recovery-required')
      }
    },
    replayCompleted(request) {
      requireCandidateId(request.candidateId)
      requireRevision(request.expectedRevision, 'expected recovery revision')
      const operation = options.sidecarRuntime.transaction('read', (connection) => {
        const completed = readCompletedOperation(connection, request)
        if (!completed) return undefined
        if (readHighWater(connection) !== completed.reservedRevision) return undefined
        return completed
      })
      if (!operation) return undefined
      if (!inspectPromotedProfile(operation)) {
        throw new Error('Completed SQLite recovery is not the current verified Profile head')
      }
      return Object.freeze({
        operationId: operation.operationId,
        candidateId: operation.candidateId,
        previousRevision: operation.expectedRevision,
        revision: operation.reservedRevision,
        quarantinedCurrentState: quarantineContainsProfile(operation),
      })
    },
    promote(request) {
      if (!isSqliteProfileRecoveryCandidateId(request.candidateId)) return profileServiceFailure('invalid')
      try {
        const initialCandidate = verifyCandidate(request.candidateId)
        const operationResult = beginOperation(request, initialCandidate.summary.revision)
        if (!operationResult.ok) return operationResult
        const operation = operationResult.value
        options.testHooks?.afterReservationBeforeQuarantine?.()
        const promoted = inspectPromotedProfile(operation)
        let quarantined = quarantineContainsProfile(operation)
        if (promoted) {
          if (operation.state === 'reserved') updateOperationState(operation.operationId, 'quarantined')
          if (operation.state !== 'promoted') updateOperationState(operation.operationId, 'promoted')
        } else {
          quarantined = quarantineCurrentProfile(operation) || quarantined
          updateOperationState(operation.operationId, 'quarantined')
          options.testHooks?.afterQuarantineBeforePromotion?.()
          // Reservation and quarantine are deliberate crash boundaries. Re-read
          // and re-hash the generation after them so bytes changed in that
          // window can never reach the canonical Profile path.
          promoteCandidate(verifyCandidate(request.candidateId), operation)
          updateOperationState(operation.operationId, 'promoted')
          options.testHooks?.afterPromotionBeforeReopen?.()
        }
        return {
          ok: true,
          value: Object.freeze({
            operationId: operation.operationId,
            candidateId: operation.candidateId,
            previousRevision: operation.expectedRevision,
            revision: operation.reservedRevision,
            quarantinedCurrentState: quarantined,
          }),
        }
      } catch {
        return profileServiceFailure('corrupt-or-recovery-required', {
          currentRevision: manager.highWater(),
        })
      }
    },
    complete(operationId) {
      options.sidecarRuntime.transaction('write', (connection) => {
        const operation = readOperation(connection, operationId)
        if (!operation || operation.state !== 'promoted') {
          throw new Error('SQLite recovery operation is not ready to complete')
        }
        if (readHighWater(connection) !== operation.reservedRevision) {
          throw new Error('SQLite recovery operation no longer owns its reserved revision')
        }
        const result = connection.prepare(`
UPDATE profile_recovery_operations
SET state = 'completed', completed_at = ?
WHERE operation_id = ? AND state = 'promoted'
`).run(now(), operationId)
        if (Number(result.changes) !== 1) throw new Error('SQLite recovery operation was not completed')
      })
    },
    startFresh(request) {
      try {
        const operationResult = beginStartFreshOperation()
        if (!operationResult.ok) return operationResult
        let operation = operationResult.value
        options.testHooks?.afterStartFreshReservation?.()
        let quarantined = quarantineContainsProfile(operation)
        if (inspectFreshProfile(operation)) {
          if (operation.state === 'staged') {
            operation = updateStartFreshState(operation, 'promoted')
          } else if (operation.state !== 'promoted') {
            throw new Error('SQLite start-fresh canonical Profile is ahead of its operation state')
          }
        } else {
          if (operation.state === 'reserved') {
            quarantined = quarantineCurrentProfile(operation) || quarantined
            operation = updateStartFreshState(operation, 'quarantined')
          }
          options.testHooks?.afterStartFreshQuarantine?.()
          // Once the operation is quarantined the canonical path must be empty:
          // the user's bytes were renamed into the quarantine directory, and
          // nothing else may write the canonical name before promotion.
          if (existsSync(profileDatabasePath)) {
            throw new Error('SQLite start-fresh canonical path was not quarantined')
          }
          const stagePath = `${profileDatabasePath}.start-fresh-${operation.operationId}.stage`
          let fresh = operation.fresh
          if (!fresh || !stageMatchesEvidence(stagePath, fresh)) {
            resetOwnedStageArtifacts(stagePath, operation.operationId, 'start-fresh')
            const stage = createSqliteProfileImportStage({
              databasePath: stagePath,
              document: request.document,
              now,
              ...(openRuntime ? { openRuntime } : {}),
            })
            const claimed = claimSqliteProfileImportStage(stage)
            fresh = Object.freeze({
              profileId: claimed.profileId,
              revision: claimed.revision,
              sha256: claimed.databaseDigest,
              size: claimed.databaseSize,
            })
          }
          operation = recordStartFreshStage(operation, fresh)
          options.testHooks?.afterStartFreshStageBeforePromotion?.()
          const staged = fileDigest(stagePath)
          if (staged.sha256 !== fresh.sha256 || staged.size !== fresh.size) {
            throw new Error('SQLite start-fresh staged bytes do not match their recorded evidence')
          }
          flushFile(stagePath)
          flushDirectory(path.dirname(stagePath))
          if (existsSync(profileDatabasePath)) {
            throw new Error('SQLite start-fresh canonical path was not quarantined')
          }
          renameSync(stagePath, profileDatabasePath)
          flushFile(profileDatabasePath)
          flushDirectory(path.dirname(profileDatabasePath))
          operation = updateStartFreshState(operation, 'promoted')
          options.testHooks?.afterStartFreshPromotionBeforeReopen?.()
        }
        if (!operation.fresh) throw new Error('SQLite start-fresh operation has no fresh identity')
        return {
          ok: true,
          value: Object.freeze({
            operationId: operation.operationId,
            previousRevision: operation.previousRevision,
            profileId: operation.fresh.profileId,
            revision: operation.fresh.revision,
            quarantinedCurrentState: quarantined,
          }),
        }
      } catch {
        return profileServiceFailure('corrupt-or-recovery-required', {
          currentRevision: manager.highWater(),
        })
      }
    },
    completeStartFresh(promotion) {
      options.sidecarRuntime.transaction('write', (connection) => {
        const operation = readStartFreshOperation(connection, promotion.operationId)
        if (!operation
          || operation.state !== 'promoted'
          || !operation.fresh
          || operation.fresh.profileId !== promotion.profileId
          || operation.fresh.revision !== promotion.revision
          || operation.previousRevision !== promotion.previousRevision) {
          throw new Error('SQLite start-fresh operation is not ready to complete')
        }
        const completed = connection.prepare(`
UPDATE profile_start_fresh_operations
SET state = 'completed', completed_at = ?
WHERE operation_id = ? AND state = 'promoted'
`).run(now(), promotion.operationId)
        if (Number(completed.changes) !== 1) {
          throw new Error('SQLite start-fresh operation was not completed')
        }
        // Start fresh deliberately abandons the previous Profile authority:
        // the trusted identity and high-water are rebound to the fresh Profile
        // in the same transaction that closes the operation, so an interrupted
        // completion resumes instead of admitting a half-bound authority.
        const rebound = connection.prepare(`
UPDATE profile_recovery_state
SET profile_id = ?, revision_high_water = ?
WHERE identity = 1
`).run(promotion.profileId, promotion.revision)
        if (Number(rebound.changes) !== 1) {
          throw new Error('SQLite start-fresh could not rebind recovery authority')
        }
      })
    },
  }
  return Object.freeze(manager)

  function inspectDatabase(
    databasePath: string,
    legacyReadOnlyRecovery = false,
  ): SqliteProfileRevisionInspection {
    return inspectSqliteProfileRevisionDatabase({
      databasePath,
      hydrateAsset,
      ...(legacyReadOnlyRecovery ? { legacyReadOnlyRecovery: true as const } : {}),
      ...(openRuntime ? { openRuntime } : {}),
    })
  }

  function inspectCandidates(): { accepted: VerifiedCandidate[]; rejected: string[] } {
    if (!existsSync(generationsRoot)) return { accepted: [], rejected: [] }
    requireDirectory(generationsRoot)
    const accepted: VerifiedCandidate[] = []
    const rejected: string[] = []
    for (const entry of readdirSync(generationsRoot, { withFileTypes: true })) {
      if (!CANDIDATE_ID_PATTERN.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) {
        rejected.push(entry.name)
        continue
      }
      try {
        accepted.push(verifyCandidate(entry.name))
      } catch {
        rejected.push(entry.name)
      }
    }
    accepted.sort((left, right) => (
      right.manifest.createdAt.localeCompare(left.manifest.createdAt)
      || right.manifest.sourceRevision - left.manifest.sourceRevision
      || right.manifest.candidateId.localeCompare(left.manifest.candidateId)
    ))
    rejected.sort()
    return { accepted, rejected }
  }

  function verifyCandidate(candidateId: string): VerifiedCandidate {
    requireCandidateId(candidateId)
    const candidateDirectory = ownedCandidateDirectory(generationsRoot, candidateId)
    requireDirectory(candidateDirectory)
    const databasePath = path.join(candidateDirectory, 'profile.sqlite')
    const manifestPath = path.join(candidateDirectory, 'manifest.json')
    const completePath = path.join(candidateDirectory, 'complete.json')
    const manifestBytes = readSingleLinkFile(manifestPath)
    const completeBytes = readSingleLinkFile(completePath)
    const manifest = readManifest(manifestBytes, candidateId)
    const complete = readCompletion(completeBytes, candidateId)
    if (
      complete.manifestSha256 !== sha256(manifestBytes)
      || complete.completedAt !== manifest.createdAt
    ) {
      throw new Error('SQLite recovery manifest digest does not match completion evidence')
    }
    const before = fileDigest(databasePath)
    if (
      before.sha256 !== manifest.database.sha256
      || before.size !== manifest.database.size
      || complete.databaseSha256 !== before.sha256
    ) throw new Error('SQLite recovery database digest does not match its manifest')
    const inspected = inspectDatabase(databasePath, true)
    const after = fileDigest(databasePath)
    if (
      canonicalProfileJson(before) !== canonicalProfileJson(after)
      || inspected.profileId !== manifest.profileId
      || inspected.revision !== manifest.sourceRevision
      || canonicalProfileJson(inspected.versions) !== canonicalProfileJson(manifest.versions)
      || canonicalProfileJson(inspected.blobRoots) !== canonicalProfileJson(manifest.blobs)
    ) throw new Error('SQLite recovery candidate is not closed over its manifest')
    const expected = options.sidecarRuntime.transaction('read', (connection) => {
      const row = connection.prepare(`
SELECT profile_id, revision_high_water
FROM profile_recovery_state
WHERE identity = 1
`).get()
      return Object.freeze({
        profileId: readNullableString(row, 'profile_id'),
        highWater: readNonNegativeInteger(row, 'revision_high_water'),
      })
    })
    if (!expected.profileId || manifest.profileId !== expected.profileId) {
      throw new Error('SQLite recovery candidate belongs to a different Profile')
    }
    if (manifest.sourceRevision > expected.highWater) {
      throw new Error('SQLite recovery candidate is ahead of the trusted revision high-water')
    }
    return Object.freeze({
      manifest,
      databasePath,
      summary: Object.freeze({
        id: candidateId,
        recordVersion: PROFILE_CONTRACT_VERSIONS.record,
        revision: manifest.sourceRevision,
        verified: true,
        createdAt: manifest.createdAt,
      }),
    })
  }

  function beginOperation(
    request: Extract<ProfileRecoveryRequest, { mode: 'restore' }>,
    sourceRevision: number,
  ): ProfileServiceResult<RecoveryOperation> {
    requireRevision(sourceRevision, 'recovery source revision')
    return options.sidecarRuntime.transaction('write', (connection) => {
      connection.exec(CREATE_RECOVERY_STATE_SQL)
      if (readPendingStartFreshOperation(connection)) {
        return profileServiceFailure('conflict', { currentRevision: readHighWater(connection) })
      }
      const active = readPendingOperation(connection)
      if (active) {
        if (readHighWater(connection) !== active.reservedRevision) {
          throw new Error('SQLite recovery operation lost its reserved high-water')
        }
        if (
          active.candidateId !== request.candidateId
          || active.sourceRevision !== sourceRevision
          || active.expectedRevision !== request.expectedRevision
        ) return profileServiceFailure('conflict', { currentRevision: readHighWater(connection) })
        return { ok: true, value: active }
      }
      const highWater = readHighWater(connection)
      if (request.expectedRevision !== highWater) {
        return profileServiceFailure('conflict', { currentRevision: highWater })
      }
      const reservedRevision = highWater + 1
      if (!Number.isSafeInteger(reservedRevision)) return profileServiceFailure('internal')
      const operationId = createOperationId()
      const quarantineId = `operation-${operationId}`
      requireCandidateId(operationId)
      requireCandidateId(quarantineId)
      const reserved = connection.prepare(`
UPDATE profile_recovery_state
SET revision_high_water = ?
WHERE identity = 1 AND revision_high_water = ?
`).run(reservedRevision, highWater)
      if (Number(reserved.changes) !== 1) return profileServiceFailure('conflict', {
        currentRevision: readHighWater(connection),
      })
      connection.prepare(`
INSERT INTO profile_recovery_operations (
  operation_id, candidate_id, source_revision, expected_revision, reserved_revision,
  quarantine_id, state, started_at
) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?)
`).run(
        operationId,
        request.candidateId,
        sourceRevision,
        request.expectedRevision,
        reservedRevision,
        quarantineId,
        now(),
      )
      return {
        ok: true,
        value: Object.freeze({
          operationId,
          candidateId: request.candidateId,
          sourceRevision,
          expectedRevision: request.expectedRevision,
          reservedRevision,
          quarantineId,
          state: 'reserved' as const,
        }),
      }
    })
  }

  function quarantineCurrentProfile(operation: Readonly<{ quarantineId: string }>): boolean {
    ensureDirectory(recoveryRoot)
    ensureDirectory(quarantineRoot)
    const directory = ownedCandidateDirectory(quarantineRoot, operation.quarantineId)
    if (!existsSync(directory)) mkdirSync(directory)
    else requireDirectory(directory)
    let quarantined = false
    for (const suffix of ['', '-wal', '-shm'] as const) {
      const source = `${profileDatabasePath}${suffix}`
      if (!existsSync(source)) continue
      const target = path.join(directory, `${path.basename(profileDatabasePath)}${suffix}`)
      if (existsSync(target)) throw new Error('SQLite recovery quarantine contains ambiguous duplicate state')
      renameSync(source, target)
      quarantined = true
    }
    flushDirectory(directory)
    flushDirectory(path.dirname(profileDatabasePath))
    return quarantined
  }

  function quarantineContainsProfile(operation: Readonly<{ quarantineId: string }>): boolean {
    const directory = ownedCandidateDirectory(quarantineRoot, operation.quarantineId)
    return existsSync(path.join(directory, path.basename(profileDatabasePath)))
  }

  function promoteCandidate(candidate: VerifiedCandidate, operation: RecoveryOperation): void {
    const stagePath = `${profileDatabasePath}.restore-${operation.operationId}.stage`
    resetOwnedStageArtifacts(stagePath, operation.operationId, 'restore')
    copyFileSync(candidate.databasePath, stagePath)
    requireSingleLinkRegularFile(stagePath)
    flushFile(stagePath)
    const copied = fileDigest(stagePath)
    if (
      copied.sha256 !== candidate.manifest.database.sha256
      || copied.size !== candidate.manifest.database.size
    ) throw new Error('SQLite recovery staged bytes do not match the verified generation')
    const inspected = appendSqliteProfileRecoveryRevision({
      databasePath: stagePath,
      candidateId: candidate.summary.id,
      sourceRevision: candidate.summary.revision,
      observedHighWater: operation.expectedRevision,
      revision: operation.reservedRevision,
      operationId: operation.operationId,
      recoveredAt: now(),
      hydrateAsset,
      ...(openRuntime ? { openRuntime } : {}),
    })
    if (
      inspected.revision !== operation.reservedRevision
      || !inspected.latestRecovery
      || !operationMatchesRecoveryHead(operation, inspected.latestRecovery, inspected.revision)
      || inspected.latestRecovery.sourceRevision !== candidate.summary.revision
    ) throw new Error('SQLite recovery stage did not publish its reserved revision')
    flushFile(stagePath)
    flushDirectory(path.dirname(stagePath))
    if (existsSync(profileDatabasePath)) {
      throw new Error('SQLite recovery canonical path was not quarantined')
    }
    renameSync(stagePath, profileDatabasePath)
    flushFile(profileDatabasePath)
    flushDirectory(path.dirname(profileDatabasePath))
  }

  function inspectPromotedProfile(operation: RecoveryOperation): boolean {
    if (!existsSync(profileDatabasePath)) return false
    try {
      const inspected = inspectDatabase(profileDatabasePath)
      return inspected.revision === operation.reservedRevision
        && Boolean(inspected.latestRecovery)
        && operationMatchesRecoveryHead(
          operation,
          inspected.latestRecovery!,
          inspected.revision,
        )
    } catch {
      return false
    }
  }

  function updateOperationState(
    operationId: string,
    state: 'quarantined' | 'promoted',
  ): void {
    options.sidecarRuntime.transaction('write', (connection) => {
      const current = readOperation(connection, operationId)
      if (!current) throw new Error('SQLite recovery operation is missing')
      if (current.state === state) return
      const allowed = state === 'quarantined'
        ? current.state === 'reserved'
        : current.state === 'quarantined'
      if (!allowed) throw new Error('SQLite recovery operation transition is invalid')
      const result = connection.prepare(`
UPDATE profile_recovery_operations
SET state = ?
WHERE operation_id = ? AND state = ?
`).run(state, operationId, current.state)
      if (Number(result.changes) !== 1) throw new Error('SQLite recovery operation did not advance')
    })
  }

  function pruneVerifiedGenerations(): void {
    const accepted = inspectCandidates().accepted
    for (const candidate of accepted.slice(RETAINED_GENERATIONS)) {
      const directory = ownedCandidateDirectory(generationsRoot, candidate.summary.id)
      requireDirectory(directory)
      rmSync(directory, { recursive: true })
      if (existsSync(directory)) throw new Error('SQLite recovery generation was not pruned')
    }
    flushDirectory(generationsRoot)
  }

  function beginStartFreshOperation(): ProfileServiceResult<StartFreshOperation> {
    return options.sidecarRuntime.transaction('write', (connection) => {
      connection.exec(CREATE_RECOVERY_STATE_SQL)
      if (readPendingOperation(connection)) {
        return profileServiceFailure('conflict', { currentRevision: readHighWater(connection) })
      }
      const active = readPendingStartFreshOperation(connection)
      if (active) return { ok: true, value: active }
      const previousRevision = readHighWater(connection)
      const previousProfileId = readNullableString(
        connection.prepare(`
SELECT profile_id FROM profile_recovery_state WHERE identity = 1
`).get(),
        'profile_id',
      )
      const operationId = createOperationId()
      const quarantineId = `start-fresh-${operationId}`
      requireCandidateId(operationId)
      requireCandidateId(quarantineId)
      connection.prepare(`
INSERT INTO profile_start_fresh_operations (
  operation_id, quarantine_id, previous_profile_id, previous_revision, state, started_at
) VALUES (?, ?, ?, ?, 'reserved', ?)
`).run(operationId, quarantineId, previousProfileId ?? null, previousRevision, now())
      return {
        ok: true,
        value: Object.freeze({
          operationId,
          quarantineId,
          previousRevision,
          state: 'reserved' as const,
        }),
      }
    })
  }

  function inspectFreshProfile(operation: StartFreshOperation): boolean {
    if (!operation.fresh || !existsSync(profileDatabasePath)) return false
    try {
      const inspected = inspectDatabase(profileDatabasePath)
      return inspected.profileId === operation.fresh.profileId
        && inspected.revision === operation.fresh.revision
        && !inspected.latestRecovery
    } catch {
      return false
    }
  }

  function stageMatchesEvidence(stagePath: string, fresh: StartFreshFreshEvidence): boolean {
    if (!existsSync(stagePath)) return false
    try {
      const staged = fileDigest(stagePath)
      return staged.sha256 === fresh.sha256 && staged.size === fresh.size
    } catch {
      return false
    }
  }

  function updateStartFreshState(
    operation: StartFreshOperation,
    state: 'quarantined' | 'promoted',
  ): StartFreshOperation {
    return options.sidecarRuntime.transaction('write', (connection) => {
      const current = readStartFreshOperation(connection, operation.operationId)
      if (!current) throw new Error('SQLite start-fresh operation is missing')
      if (current.state === state) return current
      const allowed = state === 'quarantined'
        ? current.state === 'reserved'
        : current.state === 'staged'
      if (!allowed) throw new Error('SQLite start-fresh operation transition is invalid')
      const result = connection.prepare(`
UPDATE profile_start_fresh_operations
SET state = ?
WHERE operation_id = ? AND state = ?
`).run(state, operation.operationId, current.state)
      if (Number(result.changes) !== 1) throw new Error('SQLite start-fresh operation did not advance')
      const advanced = readStartFreshOperation(connection, operation.operationId)
      if (!advanced) throw new Error('SQLite start-fresh operation is missing')
      return advanced
    })
  }

  function recordStartFreshStage(
    operation: StartFreshOperation,
    fresh: StartFreshFreshEvidence,
  ): StartFreshOperation {
    return options.sidecarRuntime.transaction('write', (connection) => {
      const current = readStartFreshOperation(connection, operation.operationId)
      if (!current) throw new Error('SQLite start-fresh operation is missing')
      if (current.state !== 'quarantined' && current.state !== 'staged') {
        throw new Error('SQLite start-fresh operation cannot record a stage now')
      }
      const result = connection.prepare(`
UPDATE profile_start_fresh_operations
SET fresh_profile_id = ?, fresh_revision = ?, fresh_database_sha256 = ?,
    fresh_database_size = ?, state = 'staged'
WHERE operation_id = ? AND state IN ('quarantined', 'staged')
`).run(fresh.profileId, fresh.revision, fresh.sha256, fresh.size, operation.operationId)
      if (Number(result.changes) !== 1) throw new Error('SQLite start-fresh stage was not recorded')
      const staged = readStartFreshOperation(connection, operation.operationId)
      if (!staged) throw new Error('SQLite start-fresh operation is missing')
      return staged
    })
  }
}

function readManifest(bytes: Buffer, candidateId: string): RecoveryManifest {
  const value = parseJson(bytes, 'SQLite recovery manifest')
  if (!isExactRecord(value, [
    'blobs', 'candidateId', 'createdAt', 'database', 'format', 'profileId',
    'sourceRevision', 'version', 'versions',
  ])) throw new Error('SQLite recovery manifest schema is invalid')
  if (
    value.format !== RECOVERY_FORMAT
    || value.version !== RECOVERY_VERSION
    || value.candidateId !== candidateId
    || typeof value.profileId !== 'string'
    || value.profileId.length === 0
    || !isIsoTimestamp(value.createdAt)
    || !isNonNegativeSafeInteger(value.sourceRevision)
    || canonicalProfileJson(value.versions) !== canonicalProfileJson(PROFILE_CONTRACT_VERSIONS)
    || !isDigestRecord(value.database)
    || !Array.isArray(value.blobs)
  ) throw new Error('SQLite recovery manifest values are invalid')
  const blobs = value.blobs.map((entry) => {
    if (!isDigestRecord(entry)) throw new Error('SQLite recovery manifest blob root is invalid')
    return Object.freeze({ sha256: entry.sha256, size: entry.size })
  })
  if (
    blobs.some((entry, index) => index > 0 && blobs[index - 1]!.sha256 >= entry.sha256)
  ) throw new Error('SQLite recovery manifest blob roots are not uniquely sorted')
  return Object.freeze({
    format: RECOVERY_FORMAT,
    version: RECOVERY_VERSION,
    candidateId,
    profileId: value.profileId,
    sourceRevision: value.sourceRevision,
    createdAt: value.createdAt,
    versions: PROFILE_CONTRACT_VERSIONS,
    database: Object.freeze({ sha256: value.database.sha256, size: value.database.size }),
    blobs: Object.freeze(blobs),
  })
}

function readCompletion(bytes: Buffer, candidateId: string): RecoveryCompletion {
  const value = parseJson(bytes, 'SQLite recovery completion marker')
  if (!isExactRecord(value, [
    'candidateId', 'completedAt', 'databaseSha256', 'format', 'manifestSha256', 'version',
  ])) throw new Error('SQLite recovery completion schema is invalid')
  if (
    value.format !== 'eido-profile-recovery-complete'
    || value.version !== RECOVERY_VERSION
    || value.candidateId !== candidateId
    || !isSha256(value.manifestSha256)
    || !isSha256(value.databaseSha256)
    || !isIsoTimestamp(value.completedAt)
  ) throw new Error('SQLite recovery completion values are invalid')
  return Object.freeze({
    format: 'eido-profile-recovery-complete',
    version: RECOVERY_VERSION,
    candidateId,
    manifestSha256: value.manifestSha256,
    databaseSha256: value.databaseSha256,
    completedAt: value.completedAt,
  })
}

function readHighWater(runtime: SqliteRuntime): number {
  return readNonNegativeInteger(runtime.prepare(`
SELECT revision_high_water
FROM profile_recovery_state
WHERE identity = 1
`).get(), 'revision_high_water')
}

function readOperation(runtime: SqliteRuntime, operationId: string): RecoveryOperation | undefined {
  const row = runtime.prepare(`
SELECT operation_id, candidate_id, expected_revision, reserved_revision,
       source_revision, quarantine_id, state
FROM profile_recovery_operations
WHERE operation_id = ?
`).get(operationId)
  return row ? readOperationRow(row) : undefined
}

function readPendingOperation(runtime: SqliteRuntime): RecoveryOperation | undefined {
  const rows = runtime.prepare(`
SELECT operation_id, candidate_id, expected_revision, reserved_revision,
       source_revision, quarantine_id, state
FROM profile_recovery_operations
WHERE state <> 'completed'
ORDER BY started_at, operation_id
LIMIT 2
`).all()
  if (rows.length > 1) throw new Error('SQLite recovery has multiple unfinished operations')
  return rows[0] ? readOperationRow(rows[0]) : undefined
}

function readCompletedOperation(
  runtime: SqliteRuntime,
  request: Extract<ProfileRecoveryRequest, { mode: 'restore' }>,
): RecoveryOperation | undefined {
  const rows = runtime.prepare(`
SELECT operation_id, candidate_id, expected_revision, reserved_revision,
       source_revision, quarantine_id, state
FROM profile_recovery_operations
WHERE state = 'completed' AND candidate_id = ? AND expected_revision = ?
LIMIT 2
`).all(request.candidateId, request.expectedRevision)
  if (rows.length > 1) throw new Error('SQLite recovery request has multiple completed operations')
  return rows[0] ? readOperationRow(rows[0]) : undefined
}

function readStartFreshOperation(
  runtime: SqliteRuntime,
  operationId: string,
): StartFreshOperation | undefined {
  const row = runtime.prepare(`
SELECT operation_id, quarantine_id, previous_revision, fresh_profile_id,
       fresh_revision, fresh_database_sha256, fresh_database_size, state
FROM profile_start_fresh_operations
WHERE operation_id = ?
`).get(operationId)
  return row ? readStartFreshOperationRow(row) : undefined
}

function readPendingStartFreshOperation(runtime: SqliteRuntime): StartFreshOperation | undefined {
  if (!runtime.prepare(`
SELECT 1 AS present
FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_start_fresh_operations'
`).get()) return undefined
  const rows = runtime.prepare(`
SELECT operation_id, quarantine_id, previous_revision, fresh_profile_id,
       fresh_revision, fresh_database_sha256, fresh_database_size, state
FROM profile_start_fresh_operations
WHERE state <> 'completed'
ORDER BY started_at, operation_id
LIMIT 2
`).all()
  if (rows.length > 1) throw new Error('SQLite start-fresh has multiple unfinished operations')
  return rows[0] ? readStartFreshOperationRow(rows[0]) : undefined
}

function readStartFreshOperationRow(row: SqliteRow): StartFreshOperation {
  const operationId = readString(row, 'operation_id')
  const quarantineId = readString(row, 'quarantine_id')
  requireCandidateId(operationId)
  requireCandidateId(quarantineId)
  const previousRevision = readNonNegativeInteger(row, 'previous_revision')
  const state = readString(row, 'state')
  if (!['reserved', 'quarantined', 'staged', 'promoted', 'completed'].includes(state)) {
    throw new Error('SQLite start-fresh operation metadata is invalid')
  }
  const freshProfileId = readNullableString(row, 'fresh_profile_id')
  let fresh: StartFreshFreshEvidence | undefined
  if (freshProfileId !== undefined) {
    const sha256Value = readString(row, 'fresh_database_sha256')
    if (!isSha256(sha256Value)) throw new Error('SQLite start-fresh operation metadata is invalid')
    fresh = Object.freeze({
      profileId: freshProfileId,
      revision: readNonNegativeInteger(row, 'fresh_revision'),
      sha256: sha256Value,
      size: readNonNegativeInteger(row, 'fresh_database_size'),
    })
  } else if (['staged', 'promoted', 'completed'].includes(state)) {
    throw new Error('SQLite start-fresh operation metadata is invalid')
  }
  return Object.freeze({
    operationId,
    quarantineId,
    previousRevision,
    ...(fresh ? { fresh } : {}),
    state: state as StartFreshOperation['state'],
  })
}

function readOperationRow(row: SqliteRow): RecoveryOperation {
  const operationId = readString(row, 'operation_id')
  const candidateId = readString(row, 'candidate_id')
  const sourceRevision = readNonNegativeInteger(row, 'source_revision')
  const quarantineId = readString(row, 'quarantine_id')
  requireCandidateId(operationId)
  requireCandidateId(candidateId)
  requireCandidateId(quarantineId)
  const expectedRevision = readNonNegativeInteger(row, 'expected_revision')
  const reservedRevision = readNonNegativeInteger(row, 'reserved_revision')
  const state = readString(row, 'state')
  if (
    reservedRevision !== expectedRevision + 1
    || sourceRevision > expectedRevision
    || !['reserved', 'quarantined', 'promoted', 'completed'].includes(state)
  ) throw new Error('SQLite recovery operation metadata is invalid')
  return Object.freeze({
    operationId,
    candidateId,
    sourceRevision,
    expectedRevision,
    reservedRevision,
    quarantineId,
    state: state as RecoveryOperation['state'],
  })
}

function operationMatchesRecoveryHead(
  operation: RecoveryOperation,
  recovery: NonNullable<SqliteProfileRevisionInspection['latestRecovery']>,
  revision: number,
): boolean {
  return recovery.operationId === operation.operationId
    && recovery.candidateId === operation.candidateId
    && recovery.sourceRevision === operation.sourceRevision
    && recovery.observedHighWater === operation.expectedRevision
    && revision === operation.reservedRevision
}

function writeExclusiveFlushedFile(location: string, bytes: Buffer): void {
  writeFileSync(location, bytes, { flag: 'wx' })
  flushFile(location)
  if (!readFileSync(location).equals(bytes)) throw new Error('SQLite recovery file verification failed')
}

function flushFile(location: string): void {
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

function ensureDirectory(location: string): void {
  if (!existsSync(location)) {
    mkdirSync(location)
    flushDirectory(path.dirname(location))
  }
  requireDirectory(location)
}

function requireDirectory(location: string): void {
  const metadata = lstatSync(location, { bigint: true })
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || metadata.nlink < 1n) {
    throw new Error('SQLite recovery directory is invalid')
  }
}

function readSingleLinkFile(location: string): Buffer {
  const before = requireSingleLinkRegularFile(location)
  const bytes = readFileSync(location)
  const after = lstatSync(location, { bigint: true })
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.birthtimeNs !== after.birthtimeNs
    || before.size !== after.size
    || BigInt(bytes.length) !== after.size
  ) throw new Error('SQLite recovery file changed while it was read')
  return bytes
}

function requireSingleLinkRegularFile(location: string) {
  const metadata = lstatSync(location, { bigint: true })
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n) {
    throw new Error('SQLite recovery file is invalid')
  }
  return metadata
}

function fileDigest(location: string): Readonly<{ sha256: string; size: number }> {
  const bytes = readSingleLinkFile(location)
  return Object.freeze({ sha256: sha256(bytes), size: bytes.length })
}

function ownedCandidateDirectory(root: string, candidateId: string): string {
  requireCandidateId(candidateId)
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, candidateId)
  if (path.dirname(resolved) !== resolvedRoot) throw new Error('SQLite recovery path escaped its root')
  return resolved
}

function assertOwnedStagePath(
  location: string,
  operationId: string,
  kind: 'restore' | 'start-fresh',
): void {
  requireCandidateId(operationId)
  const suffix = `.${kind}-${operationId}.stage`
  const expected = path.resolve(`${path.resolve(location.replace(suffix, ''))}${suffix}`)
  if (path.resolve(location) !== expected) throw new Error('SQLite recovery staging path is invalid')
}

function resetOwnedStageArtifacts(
  location: string,
  operationId: string,
  kind: 'restore' | 'start-fresh',
): void {
  assertOwnedStagePath(location, operationId, kind)
  for (const suffix of ['', '-wal', '-shm'] as const) {
    const artifact = `${location}${suffix}`
    if (!existsSync(artifact)) continue
    requireSingleLinkRegularFile(artifact)
    rmSync(artifact)
    if (existsSync(artifact)) throw new Error('SQLite recovery staging artifact was not reset')
  }
  flushDirectory(path.dirname(location))
}

function requireCandidateId(value: string): void {
  if (!isSqliteProfileRecoveryCandidateId(value)) throw new Error('SQLite recovery identifier is invalid')
}

function requireRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`)
}

function isDigestRecord(value: unknown): value is { sha256: string; size: number } {
  return isExactRecord(value, ['sha256', 'size'])
    && isSha256(value.sha256)
    && isNonNegativeSafeInteger(value.size)
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

function readNonNegativeInteger(row: SqliteRow | undefined, key: string): number {
  const value = readColumn(row, key)
  const normalized = typeof value === 'bigint' ? Number(value) : value
  if (!Number.isSafeInteger(normalized) || Number(normalized) < 0) {
    throw new Error(`SQLite recovery ${key} is invalid`)
  }
  return Number(normalized)
}

function readString(row: SqliteRow | undefined, key: string): string {
  const value = readColumn(row, key)
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`SQLite recovery ${key} is invalid`)
  }
  return value
}

function readNullableString(row: SqliteRow | undefined, key: string): string | undefined {
  const value = readColumn(row, key)
  if (value === null) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`SQLite recovery ${key} is invalid`)
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
