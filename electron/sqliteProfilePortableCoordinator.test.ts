import { DatabaseSync } from 'node:sqlite'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompleteProfileFixture } from '../src/persistence/fixtures/profileLogicalProjectionFixture'
import { canonicalProfileJson } from '../src/persistence/profileRevisionKernel'
import type { ProfileSnapshot } from '../src/persistence/profileServiceContract'
import {
  createProfilePortableZipDestination,
  createProfilePortableZipSource,
} from './profilePortableZip'
import { createProfilePortableArchiveSource } from './profilePortableSource'
import {
  acquireSqliteProfileOwner,
  type SqliteProfileOwnerCoordinator,
  type SqliteProfileOwnerCoordinatorOptions,
} from './sqliteProfileOwnerCoordinator'
import {
  createSqliteRuntimeOpener,
  openSqliteExclusiveRuntime,
  type SqliteDatabase,
} from './sqliteRuntime'

const disposableRoots: string[] = []
const coordinators: SqliteProfileOwnerCoordinator[] = []
const openTestRuntime = createSqliteRuntimeOpener({
  openDatabase: (location) => new DatabaseSync(location) as unknown as SqliteDatabase,
})

afterEach(async () => {
  await Promise.allSettled(coordinators.splice(0).map((coordinator) => coordinator.close()))
  for (const root of disposableRoots.splice(0)) {
    const expectedPrefix = path.join(tmpdir(), 'eido-463-coordinator-')
    if (!root.startsWith(expectedPrefix)) throw new Error('Refusing to remove an unexpected test directory')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('owner-coordinated fresh Portable Profile import (#463)', () => {
  it('imports into one genuinely fresh destination, reopens, replays, and refuses merge or key alteration', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const archivePath = await exportFixture(root, fixture.snapshot)
    const databasePath = path.join(root, 'destination.sqlite')
    const fresh = acquire(databasePath, { allowFreshImport: true })

    expect(await fresh.status()).toMatchObject({ ok: false, code: 'busy' })
    expect(await fresh.applyCommandBatch({})).toMatchObject({ ok: false })
    const request = portableImportRequest(archivePath)
    const imported = await fresh.importPortableIntoFreshProfile(request)
    expect(imported).toMatchObject({
      ok: true,
      value: {
        operationId: 'fresh-operation-1',
        profileId: fixture.snapshot.profileId,
        revision: fixture.snapshot.revision,
        verified: true,
        replayed: false,
      },
    })
    expect(await fresh.snapshot()).toEqual({ ok: true, value: fixture.snapshot })
    await closeTracked(fresh)

    const reopened = acquire(databasePath)
    expect(await reopened.snapshot()).toEqual({ ok: true, value: fixture.snapshot })
    expect(await reopened.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({ ok: true, value: { replayed: true, revision: fixture.snapshot.revision } })
    expect(await reopened.importPortableIntoFreshProfile(portableImportRequest(
      archivePath,
      { idempotencyKey: 'altered-key' },
    ))).toMatchObject({ ok: false, code: 'invalid' })
    expect(await reopened.importPortableIntoFreshProfile(portableImportRequest(
      archivePath,
      { operationId: 'altered-operation' },
    ))).toMatchObject({ ok: false, code: 'invalid' })
    expect(await reopened.importPortableIntoFreshProfile(portableImportRequest(
      archivePath,
      { operationId: 'new-operation', idempotencyKey: 'new-key' },
    ))).toMatchObject({ ok: false, code: 'invalid', currentRevision: fixture.snapshot.revision })
    expect(await reopened.duplicateIdea({
      version: 1,
      operationId: 'advance-after-import',
      idempotencyKey: 'advance-after-import-key',
      expectedRevision: fixture.snapshot.revision,
      sourceIdeaId: fixture.snapshot.activeIdeaId,
      name: 'Legitimate later revision',
    })).toMatchObject({
      ok: true,
      value: { revision: fixture.snapshot.revision + 1 },
    })
    expect(await reopened.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({
        ok: true,
        value: { replayed: true, revision: fixture.snapshot.revision },
      })
    expect(await reopened.snapshot()).toMatchObject({
      ok: true,
      value: { revision: fixture.snapshot.revision + 1 },
    })
    const database = new DatabaseSync(databasePath, { readOnly: true })
    expect(database.prepare('SELECT COUNT(*) AS count FROM profile_owner_fence').get())
      .toEqual({ count: 1 })
    database.close()
    expect(await reopened.blobCandidates()).toMatchObject({
      ok: true,
      value: { staging: { files: 0, totalBytes: 0 } },
    })
    await closeTracked(reopened)
    expect(readPortableState(databasePath)).toMatchObject({ state: 'completed' })
    expect(existsSync(readPortableState(databasePath).database_stage_path)).toBe(false)
  })

  it('recovers an atomic publication interruption after the final DB link but before stage unlink', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const archivePath = await exportFixture(root, fixture.snapshot)
    const databasePath = path.join(root, 'destination.sqlite')
    const interrupted = acquire(databasePath, {
      allowFreshImport: true,
      portableTestHooks: {
        afterDatabaseLinkedBeforeStageUnlink: () => {
          throw new Error('synthetic process interruption after DB link')
        },
      },
    })

    expect(await interrupted.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    await closeTracked(interrupted)

    let releaseVerification!: () => void
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve
    })
    const resumed = acquire(databasePath, {
      allowFreshImport: true,
      portableTestHooks: {
        beforePublishedBlobVerification: () => verificationGate,
      },
    })
    expect(await resumed.status()).toMatchObject({ ok: false, code: 'busy' })
    releaseVerification()
    expect(await resumed.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({ ok: true, value: { replayed: true, revision: fixture.snapshot.revision } })
    expect(await resumed.snapshot()).toEqual({ ok: true, value: fixture.snapshot })
  })

  it('preserves and resumes a reservation whose durable commit was not acknowledged', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const archivePath = await exportFixture(root, fixture.snapshot)
    const databasePath = path.join(root, 'destination.sqlite')
    const interrupted = acquire(databasePath, {
      allowFreshImport: true,
      portableTestHooks: {
        afterReservationCommitBeforeAcknowledge: () => {
          throw new Error('synthetic loss of reservation acknowledgement')
        },
      },
    })

    expect(await interrupted.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    await closeTracked(interrupted)
    const reserved = readPortableState(databasePath)
    expect(reserved).toMatchObject({ state: 'reserved' })
    expect(existsSync(reserved.database_stage_path)).toBe(true)

    const resumed = acquire(databasePath, { allowFreshImport: true })
    expect(await resumed.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({ ok: true, value: { replayed: true, revision: fixture.snapshot.revision } })
    expect(await resumed.snapshot()).toEqual({ ok: true, value: fixture.snapshot })
  })

  it('sweeps only abandoned private import stages when a fresh owner reacquires authority', async () => {
    const root = disposableRoot()
    const databasePath = path.join(root, 'destination.sqlite')
    const initial = acquire(databasePath, { allowFreshImport: true })
    await closeTracked(initial)

    const databaseStage = path.join(
      root,
      '.destination.sqlite.abandoned.portable-import-stage.sqlite',
    )
    const databaseWal = `${databaseStage}-wal`
    const databaseShm = `${databaseStage}-shm`
    writeFileSync(databaseStage, 'abandoned database stage')
    writeFileSync(databaseWal, 'abandoned database wal')
    writeFileSync(databaseShm, 'abandoned database shm')
    const stagingRoot = `${databasePath}.blobs${path.sep}staging`
    mkdirSync(stagingRoot, { recursive: true })
    const blobStage = path.join(
      stagingRoot,
      '11111111-1111-4111-8111-111111111111.portable-stage',
    )
    writeFileSync(blobStage, 'abandoned portable blob stage')

    acquire(databasePath, { allowFreshImport: true })
    expect(existsSync(databaseStage)).toBe(false)
    expect(existsSync(databaseWal)).toBe(false)
    expect(existsSync(databaseShm)).toBe(false)
    expect(existsSync(blobStage)).toBe(false)
  })

  it('recovers after the fenced store reopened but before the durable import completion marker', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const archivePath = await exportFixture(root, fixture.snapshot)
    const databasePath = path.join(root, 'destination.sqlite')
    const interrupted = acquire(databasePath, {
      allowFreshImport: true,
      portableTestHooks: {
        afterReopenBeforeComplete: () => {
          throw new Error('synthetic process interruption after fenced reopen')
        },
      },
    })

    expect(await interrupted.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    await closeTracked(interrupted)

    const resumed = acquire(databasePath, { allowFreshImport: true })
    expect(await resumed.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({ ok: true, value: { replayed: true, revision: fixture.snapshot.revision } })
    expect(await resumed.snapshot()).toEqual({ ok: true, value: fixture.snapshot })
  })

  it('refuses post-bind logical tampering even when SQLite integrity and blob roots remain valid', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const archivePath = await exportFixture(root, fixture.snapshot)
    const databasePath = path.join(root, 'destination.sqlite')
    const interrupted = acquire(databasePath, {
      allowFreshImport: true,
      portableTestHooks: {
        afterReopenBeforeComplete: () => {
          throw new Error('synthetic process interruption before logical tamper')
        },
      },
    })

    expect(await interrupted.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    await closeTracked(interrupted)
    tamperIdeaName(databasePath)

    const resumed = acquire(databasePath, { allowFreshImport: true })
    expect(await resumed.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    await closeTracked(resumed)
    expect(readPortableState(databasePath)).toMatchObject({ state: 'profile-published' })
  })

  it('separates invalid incoming bytes from corruption of already-published reachable blobs', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const archivePath = await exportFixture(root, fixture.snapshot)
    const malformedArchive = path.join(root, 'malformed.eido')
    writeFileSync(malformedArchive, Buffer.concat([readFileSync(archivePath), Buffer.from([0xff])]))
    const rejectedDatabasePath = path.join(root, 'rejected.sqlite')
    const rejected = acquire(rejectedDatabasePath, { allowFreshImport: true })
    expect(await rejected.importPortableIntoFreshProfile(portableImportRequest(malformedArchive)))
      .toMatchObject({ ok: false, code: 'invalid' })
    expect(existsSync(rejectedDatabasePath)).toBe(false)

    const databasePath = path.join(root, 'published.sqlite')
    const published = acquire(databasePath, { allowFreshImport: true })
    expect(await published.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({ ok: true })
    const blobPath = firstPublishedBlobPath(databasePath)
    const original = readFileSync(blobPath)
    writeFileSync(blobPath, Buffer.alloc(original.byteLength, 0x5a))
    expect(await published.importPortableIntoFreshProfile(portableImportRequest(archivePath)))
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    expect(await published.snapshot()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
  })
})

async function exportFixture(root: string, snapshot: ProfileSnapshot): Promise<string> {
  const source = acquire(path.join(root, `source-${coordinators.length}.sqlite`), { seed: snapshot })
  const operationRoot = path.join(root, `operations-${coordinators.length}`)
  mkdirSync(operationRoot)
  const archivePath = path.join(root, `source-${coordinators.length}.eido`)
  const result = await source.exportPortable({
    version: 1,
    operationId: `export-${coordinators.length}`,
    expectedRevision: snapshot.revision,
    destination: createProfilePortableZipDestination({ archivePath, operationTempRoot: operationRoot }),
  })
  if (!result.ok) throw new Error(`Synthetic Portable Profile export failed: ${result.code}`)
  return archivePath
}

function portableImportRequest(
  archivePath: string,
  overrides: Partial<{ operationId: string; idempotencyKey: string }> = {},
) {
  return {
    version: 1 as const,
    operationId: overrides.operationId ?? 'fresh-operation-1',
    idempotencyKey: overrides.idempotencyKey ?? 'fresh-key-1',
    source: createProfilePortableArchiveSource(createProfilePortableZipSource(archivePath)),
  }
}

function acquire(
  databasePath: string,
  overrides: Partial<SqliteProfileOwnerCoordinatorOptions> = {},
): SqliteProfileOwnerCoordinator {
  const result = acquireSqliteProfileOwner({
    databasePath,
    ownerId: `owner-${coordinators.length + 1}`,
    createOwnerToken: () => `${`owner-token-${coordinators.length + 1}-`.repeat(4)}`,
    openExclusiveRuntime: openSqliteExclusiveRuntime,
    openProfileRuntime: openTestRuntime,
    now: () => '2026-07-19T05:00:00.000Z',
    ...overrides,
  })
  if (!result.ok) throw new Error(`Synthetic owner acquisition failed: ${result.code}`)
  coordinators.push(result.value)
  return result.value
}

async function closeTracked(coordinator: SqliteProfileOwnerCoordinator): Promise<void> {
  await coordinator.close()
  const index = coordinators.indexOf(coordinator)
  if (index >= 0) coordinators.splice(index, 1)
}

function disposableRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eido-463-coordinator-'))
  disposableRoots.push(root)
  return root
}

function readPortableState(databasePath: string): {
  state: string
  database_stage_path: string
} {
  const sidecar = new DatabaseSync(`${databasePath}.owner.sqlite`, { readOnly: true })
  try {
    return sidecar.prepare(`
SELECT state, database_stage_path
FROM profile_portable_import_operations
`).get() as { state: string; database_stage_path: string }
  } finally {
    sidecar.close()
  }
}

function firstPublishedBlobPath(databasePath: string): string {
  const hashRoot = `${databasePath}.blobs${path.sep}sha256`
  for (const prefix of readdirSync(hashRoot).sort()) {
    for (const digest of readdirSync(path.join(hashRoot, prefix)).sort()) {
      if (/^[0-9a-f]{64}$/.test(digest)) return path.join(hashRoot, prefix, digest)
    }
  }
  throw new Error('Synthetic imported Profile has no published blob')
}

function tamperIdeaName(databasePath: string): void {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database.prepare(`
SELECT record_id, payload_json
FROM profile_records
WHERE kind = 'idea'
ORDER BY record_id
LIMIT 1
`).get() as { record_id: string; payload_json: string }
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    payload.name = 'Tampered after publication'
    database.prepare(`
UPDATE profile_records
SET payload_json = ?
WHERE record_id = ?
`).run(canonicalProfileJson(payload), row.record_id)
  } finally {
    database.close()
  }
}
