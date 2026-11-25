import { DatabaseSync } from 'node:sqlite'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompleteProfileFixture } from '../src/persistence/fixtures/profileLogicalProjectionFixture'
import {
  extractProfileIdeaClosure,
  PROFILE_IDEA_REMAP_V1_LIMITS,
} from '../src/persistence/profileIdeaClosure'
import type { ProfileSnapshot } from '../src/persistence/profileServiceContract'
import {
  createProfilePortableZipDestination,
  createProfilePortableZipSource,
} from './profilePortableZip'
import {
  createProfileIdeaClosureSource,
  createProfileLegacyIdeaSource,
  createProfilePortableArchiveSource,
} from './profilePortableSource'
import { createSqliteProfileBlobStore, type SqliteProfileBlobStore } from './sqliteProfileBlobStore'
import {
  issueSqliteProfileOwnershipCapability,
  type SqliteProfileOwnershipCapability,
} from './sqliteProfileOwnerCapability'
import {
  createSqliteProfilePortableLifecycle,
  type SqliteProfilePortableLifecycle,
} from './sqliteProfilePortableLifecycle'
import {
  createSqliteProfileRevisionStore,
  type SqliteProfileRevisionStore,
} from './sqliteProfileRevisionStore'
import {
  createSqliteRuntimeOpener,
  openSqliteExclusiveRuntime,
  type SqliteDatabase,
  type SqliteExclusiveRuntime,
} from './sqliteRuntime'

const disposableRoots: string[] = []
const contexts: TestContext[] = []
const openTestRuntime = createSqliteRuntimeOpener({
  openDatabase: (location) => new DatabaseSync(location) as unknown as SqliteDatabase,
})

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.store?.close()
    context.sidecar.close()
  }
  for (const root of disposableRoots.splice(0)) {
    const expectedPrefix = path.join(tmpdir(), 'eido-463-lifecycle-')
    if (!root.startsWith(expectedPrefix)) throw new Error('Refusing to remove an unexpected test directory')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('native SQLite Profile portable lifecycle (#463)', () => {
  it('exports one owner revision byte-identically and stages a verified full-Profile import', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const authoredSnapshot = structuredClone(fixture.snapshot)
    const authoredCard = authoredSnapshot.boards[authoredSnapshot.activeIdeaId]!.cards[0]!
    authoredCard.createdBy = { kind: 'agent', client: 'claude-code', sessionId: 'portable-session' }
    authoredCard.lastModifiedBy = { kind: 'user', client: 'eido-desktop', sessionId: 'gui-session' }
    const source = createContext(path.join(root, 'source.sqlite'), authoredSnapshot)
    const operationRoot = path.join(root, 'operations')
    mkdirSync(operationRoot)
    const firstArchive = path.join(root, 'first.eido')
    const secondArchive = path.join(root, 'second.eido')

    const first = await source.lifecycle.exportPortable({
      version: 1,
      operationId: 'export-first',
      expectedRevision: fixture.snapshot.revision,
      destination: createProfilePortableZipDestination({
        archivePath: firstArchive,
        operationTempRoot: operationRoot,
      }),
    })
    const second = await source.lifecycle.exportPortable({
      version: 1,
      operationId: 'export-second',
      expectedRevision: fixture.snapshot.revision,
      destination: createProfilePortableZipDestination({
        archivePath: secondArchive,
        operationTempRoot: operationRoot,
      }),
    })

    expect(first).toMatchObject({
      ok: true,
      value: { profileId: fixture.snapshot.profileId, revision: fixture.snapshot.revision, verified: true },
    })
    expect(second).toMatchObject({
      ok: true,
      value: { integrityRoot: first.ok ? first.value.integrityRoot : 'unreachable' },
    })
    expect(readFileSync(firstArchive)).toEqual(readFileSync(secondArchive))

    const destination = createContext(path.join(root, 'destination.sqlite'))
    const prepared = await destination.lifecycle.prepareFreshImport({
      version: 1,
      operationId: 'fresh-import-1',
      idempotencyKey: 'fresh-import-key-1',
      source: createProfilePortableArchiveSource(createProfilePortableZipSource(firstArchive)),
    })
    expect(prepared).toMatchObject({
      ok: true,
      value: {
        document: { head: { profileId: fixture.snapshot.profileId, revision: fixture.snapshot.revision } },
        receipt: {
          profileId: fixture.snapshot.profileId,
          revision: fixture.snapshot.revision,
          verified: true,
          replayed: false,
        },
      },
    })
    if (!prepared.ok) throw new Error('Portable Profile import did not prepare')
    expect(prepared.value.document.records.find((record) => record.recordId === authoredCard.id)?.payload)
      .toMatchObject({ createdBy: authoredCard.createdBy, lastModifiedBy: authoredCard.lastModifiedBy })
    expect(prepared.value.stagedBlobs).toHaveLength(2)
    expect(destination.blobStore.candidates([]).staging.files).toBe(2)
    destination.blobStore.publishPortableBlobs(
      prepared.value.operationId,
      prepared.value.stagedBlobs,
    )
    expect(destination.blobStore.candidates([]).staging.files).toBe(0)
  })

  it('duplicates one complete native Idea and repairs recovery high-water on exact replay', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const context = createContext(path.join(root, 'profile.sqlite'), fixture.snapshot)
    const request = {
      version: 1 as const,
      operationId: 'duplicate-operation-1',
      idempotencyKey: 'duplicate-key-1',
      expectedRevision: fixture.snapshot.revision,
      sourceIdeaId: fixture.snapshot.activeIdeaId,
      name: 'Native duplicate',
    }

    const committed = await context.lifecycle.duplicateIdea(request)
    expect(committed).toMatchObject({
      ok: true,
      value: {
        kind: 'duplicate-idea',
        previousRevision: fixture.snapshot.revision,
        revision: fixture.snapshot.revision + 1,
        replayed: false,
      },
    })
    expect(await context.lifecycle.duplicateIdea(request)).toMatchObject({
      ok: true,
      value: { revision: fixture.snapshot.revision + 1, replayed: true },
    })
    expect(await context.lifecycle.duplicateIdea({ ...request, name: 'Altered retry' }))
      .toMatchObject({ ok: false, code: 'invalid', currentRevision: fixture.snapshot.revision + 1 })
    expect(await context.lifecycle.duplicateIdea({
      ...request,
      operationId: 'duplicate-operation-stale',
      idempotencyKey: 'duplicate-key-stale',
    })).toMatchObject({
      ok: false,
      code: 'conflict',
      currentRevision: fixture.snapshot.revision + 1,
    })

    const logical = await context.store!.logicalDocument()
    expect(logical).toMatchObject({
      ok: true,
      value: { head: { revision: fixture.snapshot.revision + 1 } },
    })
    if (!committed.ok || !logical.ok) throw new Error('Native duplicate did not commit')
    expect(logical.value.head.activeIdeaId).toBe(committed.value.targetIdeaId)
    expect(logical.value.records.some((record) => (
      record.kind === 'mod-instance' && record.ownerId === `board:${committed.value.targetIdeaId}`
    ))).toBe(true)

    let observationAttempts = 0
    let observedRevision = fixture.snapshot.revision
    const interrupted = createContext(
      path.join(root, 'interrupted-profile.sqlite'),
      fixture.snapshot,
      {
        observeRevision: (revision) => {
          observationAttempts += 1
          if (observationAttempts === 1) throw new Error('synthetic high-water interruption')
          observedRevision = revision
        },
      },
    )
    expect(await interrupted.lifecycle.duplicateIdea(request))
      .toMatchObject({ ok: false, code: 'internal' })
    expect(await interrupted.lifecycle.duplicateIdea(request)).toMatchObject({
      ok: true,
      value: { revision: fixture.snapshot.revision + 1, replayed: true },
    })
    expect(observationAttempts).toBe(2)
    expect(observedRevision).toBe(fixture.snapshot.revision + 1)
  })

  it('imports a bounded current-Idea closure and fully reverifies source bytes on exact replay', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const databasePath = path.join(root, 'profile.sqlite')
    const context = createContext(databasePath, fixture.snapshot)
    const logical = await context.store!.logicalDocument()
    if (!logical.ok) throw new Error('Synthetic source logical document is unavailable')
    const closure = extractProfileIdeaClosure(logical.value, fixture.snapshot.activeIdeaId)
    let replayBlobOpenCount = 0
    const source = () => createProfileIdeaClosureSource({
      closure,
      openBlob: ({ sha256, size }) => {
        replayBlobOpenCount += 1
        return context.blobStore.streamVerifiedBlob({ sha256, size })
      },
    })
    const request = {
      version: 1 as const,
      operationId: 'import-idea-operation-1',
      idempotencyKey: 'import-idea-key-1',
      expectedRevision: fixture.snapshot.revision,
      source: source(),
      name: 'Imported native Idea',
    }

    const committed = await context.lifecycle.importIdeaClosure(request)
    expect(committed).toMatchObject({
      ok: true,
      value: { kind: 'import-idea', revision: fixture.snapshot.revision + 1, replayed: false },
    })
    expect(replayBlobOpenCount).toBe(2)
    replayBlobOpenCount = 0
    const mismatchedReplaySource = createProfileIdeaClosureSource({
      closure,
      openBlob: () => (async function* mismatchedBlob() {
        yield new Uint8Array([0xff])
      })(),
    })
    expect(await context.lifecycle.importIdeaClosure({
      ...request,
      source: mismatchedReplaySource,
    })).toMatchObject({ ok: false, code: 'invalid' })
    expect(await context.lifecycle.importIdeaClosure({ ...request, source: source() })).toMatchObject({
      ok: true,
      value: { revision: fixture.snapshot.revision + 1, replayed: true },
    })
    expect(replayBlobOpenCount).toBe(2)

    const mismatchedSource = createProfileIdeaClosureSource({
      closure,
      openBlob: () => (async function* mismatchedBlob() {
        yield new Uint8Array([0xff])
      })(),
    })
    expect(await context.lifecycle.importIdeaClosure({
      ...request,
      operationId: 'import-idea-operation-mismatch',
      idempotencyKey: 'import-idea-key-mismatch',
      expectedRevision: fixture.snapshot.revision + 1,
      source: mismatchedSource,
    })).toMatchObject({ ok: false, code: 'invalid' })
    expect((await context.store!.logicalDocument())).toMatchObject({
      ok: true,
      value: { head: { revision: fixture.snapshot.revision + 1 } },
    })
    expect(context.blobStore.candidates([]).staging.files).toBe(0)

    const corruptRoot = closure.assets[0]!
    const corruptPath = path.join(
      `${databasePath}.blobs`,
      'sha256',
      corruptRoot.sha256.slice(0, 2),
      corruptRoot.sha256,
    )
    const cleanBytes = readFileSync(corruptPath)
    writeFileSync(corruptPath, Buffer.alloc(cleanBytes.length, 0xff))
    const cleanIncomingSource = createProfileIdeaClosureSource({
      closure,
      openBlob: ({ sha256, size }) => (
        sha256 === corruptRoot.sha256
          ? (async function* cleanIncomingBlob() { yield cleanBytes })()
          : context.blobStore.streamVerifiedBlob({ sha256, size })
      ),
    })
    expect(await context.lifecycle.importIdeaClosure({
      ...request,
      operationId: 'import-idea-operation-corrupt-final',
      idempotencyKey: 'import-idea-key-corrupt-final',
      expectedRevision: fixture.snapshot.revision + 1,
      source: cleanIncomingSource,
    })).toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
  })

  it('treats destination staging-directory corruption as recovery, not invalid input', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const databasePath = path.join(root, 'profile.sqlite')
    const context = createContext(databasePath, fixture.snapshot)
    const logical = await context.store!.logicalDocument()
    if (!logical.ok) throw new Error('Synthetic source logical document is unavailable')
    const closure = extractProfileIdeaClosure(logical.value, fixture.snapshot.activeIdeaId)
    const source = createProfileIdeaClosureSource({
      closure,
      openBlob: ({ sha256, size }) => context.blobStore.streamVerifiedBlob({ sha256, size }),
    })
    const stagingRoot = path.join(`${databasePath}.blobs`, 'staging')
    rmSync(stagingRoot, { recursive: true })
    writeFileSync(stagingRoot, 'synthetic directory corruption')

    expect(await context.lifecycle.importIdeaClosure({
      version: 1,
      operationId: 'import-idea-corrupt-staging',
      idempotencyKey: 'import-idea-corrupt-staging-key',
      expectedRevision: fixture.snapshot.revision,
      source,
    })).toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
  })

  it('strictly imports legacy IdeaExport v1 and raw Board sources with direct-only Mod provenance', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const context = createContext(path.join(root, 'profile.sqlite'), fixture.snapshot)
    const sourceIdea = fixture.snapshot.ideas.find((idea) => idea.id === fixture.snapshot.activeIdeaId)!
    const sourceBoard = fixture.snapshot.boards[sourceIdea.id]!

    const legacy = await context.lifecycle.importIdeaClosure({
      version: 1,
      operationId: 'legacy-export-operation-1',
      idempotencyKey: 'legacy-export-key-1',
      expectedRevision: fixture.snapshot.revision,
      source: createProfileLegacyIdeaSource({
        version: 1,
        exportedAt: '2026-07-19T04:00:00.000Z',
        idea: sourceIdea,
        board: sourceBoard,
      }),
      name: 'Legacy imported Idea',
    })
    expect(legacy).toMatchObject({
      ok: true,
      value: { kind: 'import-idea', revision: fixture.snapshot.revision + 1 },
    })
    if (!legacy.ok) throw new Error('Legacy IdeaExport import did not commit')
    const afterLegacy = await context.store!.logicalDocument()
    if (!afterLegacy.ok) throw new Error('Legacy IdeaExport logical result is unavailable')
    const importedInstances = afterLegacy.value.records.filter((record) => (
      record.kind === 'mod-instance'
      && record.ownerId === `board:${legacy.value.targetIdeaId}`
    ))
    expect(importedInstances).toHaveLength(2)
    expect(importedInstances.every((record) => (
      (record.payload as { source?: { kind?: unknown } }).source?.kind === 'direct'
    ))).toBe(true)

    const rawBoard = fixture.snapshot.boards['idea-second']!
    expect(await context.lifecycle.importIdeaClosure({
      version: 1,
      operationId: 'legacy-raw-operation-1',
      idempotencyKey: 'legacy-raw-key-1',
      expectedRevision: fixture.snapshot.revision + 1,
      source: createProfileLegacyIdeaSource(rawBoard),
      name: 'Raw Board import',
    })).toMatchObject({
      ok: true,
      value: { kind: 'import-idea', revision: fixture.snapshot.revision + 2 },
    })
  })

  it('rejects a legacy Idea asset envelope before decoding or committing it', async () => {
    const root = disposableRoot()
    const fixture = createCompleteProfileFixture()
    const context = createContext(path.join(root, 'profile.sqlite'), fixture.snapshot)
    const sourceIdea = fixture.snapshot.ideas.find((idea) => idea.id === fixture.snapshot.activeIdeaId)!
    const sourceBoard = structuredClone(fixture.snapshot.boards[sourceIdea.id]!)
    const oversizedAsset = sourceBoard.cards
      .flatMap((card) => card.assets ?? [])
      .at(0) as { dataUrl: string; mimeType: string; size: number } | undefined
    if (!oversizedAsset) throw new Error('Synthetic legacy Board has no asset')
    const bytes = Buffer.alloc(PROFILE_IDEA_REMAP_V1_LIMITS.maxUniqueDecodedAssetBytes + 1, 0x61)
    oversizedAsset.size = bytes.byteLength
    oversizedAsset.dataUrl = `data:${oversizedAsset.mimeType};base64,${bytes.toString('base64')}`

    expect(await context.lifecycle.importIdeaClosure({
      version: 1,
      operationId: 'legacy-oversized-operation',
      idempotencyKey: 'legacy-oversized-key',
      expectedRevision: fixture.snapshot.revision,
      source: createProfileLegacyIdeaSource({
        version: 1,
        exportedAt: '2026-07-19T04:00:00.000Z',
        idea: sourceIdea,
        board: sourceBoard,
      }),
    })).toMatchObject({ ok: false, code: 'idea-remap-too-large' })
    expect(await context.store!.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: fixture.snapshot.revision } },
    })
  })
})

type TestContext = Readonly<{
  sidecar: SqliteExclusiveRuntime
  ownershipCapability: SqliteProfileOwnershipCapability
  blobStore: SqliteProfileBlobStore
  store?: SqliteProfileRevisionStore
  lifecycle: SqliteProfilePortableLifecycle
}>

function createContext(
  databasePath: string,
  seed?: ProfileSnapshot,
  lifecycleOptions: Readonly<{ observeRevision?: (revision: number) => void }> = {},
): TestContext {
  const sidecarPath = `${databasePath}.owner.sqlite`
  const sidecar = openSqliteExclusiveRuntime(sidecarPath)
  sidecar.exec(`
CREATE TABLE profile_owner_generation (
  identity INTEGER PRIMARY KEY CHECK (identity = 1),
  generation INTEGER NOT NULL,
  owner_token TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  profile_device TEXT,
  profile_inode TEXT,
  profile_birthtime TEXT
);
INSERT INTO profile_owner_generation (
  identity, generation, owner_token, owner_id, acquired_at
) VALUES (1, 1, '${'owner-token-'.repeat(4)}', 'owner-portable-test', '2026-07-19T04:00:00.000Z');
`)
  const ownershipCapability = issueSqliteProfileOwnershipCapability({
    profileDatabasePath: databasePath,
    sidecarPath,
    sidecarRuntime: sidecar,
  })
  const blobStore = createSqliteProfileBlobStore({
    profileDatabasePath: databasePath,
    ownershipCapability,
  })
  const store = seed
    ? createSqliteProfileRevisionStore({
        databasePath,
        seed,
        ownershipCapability,
        materializeAsset: (asset) => blobStore.materializeAsset(asset),
        hydrateAsset: (payload) => blobStore.hydrateAsset(payload),
        openRuntime: openTestRuntime,
        now: () => '2026-07-19T04:00:01.000Z',
      })
    : undefined
  let identity = 0
  const lifecycle = createSqliteProfilePortableLifecycle({
    store: () => {
      if (!store) throw new Error('Fresh destination has no live Profile store')
      return store
    },
    blobStore,
    now: () => '2026-07-19T04:00:02.000Z',
    createIdentity: (kind) => `${kind}-portable-${++identity}`,
    ...(lifecycleOptions.observeRevision
      ? { observeRevision: lifecycleOptions.observeRevision }
      : {}),
  })
  const context = Object.freeze({ sidecar, ownershipCapability, blobStore, store, lifecycle })
  contexts.push(context)
  return context
}

function disposableRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eido-463-lifecycle-'))
  disposableRoots.push(root)
  return root
}
