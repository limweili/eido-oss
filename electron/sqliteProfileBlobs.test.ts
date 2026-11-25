import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CardAsset } from '../src/graph/types'
import { createCompleteProfileFixture } from '../src/persistence/fixtures/profileLogicalProjectionFixture'
import { SYNTHETIC_PNG_ASSET } from '../src/persistence/fixtures/profileFixtureCorpus'
import {
  PROFILE_CONTRACT_VERSIONS,
  PUBLIC_GATEWAY_COMMAND_NAMES,
  validateProfileCommandBatch,
  type ProfileCommandBatch,
  type ProfileSnapshot,
} from '../src/persistence/profileServiceContract'
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
    const expectedPrefix = path.join(tmpdir(), 'eido-461-blobs-')
    if (!root.startsWith(expectedPrefix)) throw new Error('Refusing to remove an unexpected test directory')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('owner-gated SQLite Profile blobs (#461)', () => {
  it('reopens one complete logical Profile with hydrated blobs and one live plus retained root closure', async () => {
    const databasePath = disposableDatabasePath()
    const fixture = createCompleteProfileFixture()
    const mainBoard = fixture.snapshot.boards['idea-main']!
    const currentAsset = mainBoard.cards.find((card) => card.id === 'card-note')!.assets![0]!
    const historicalEvent = mainBoard.intentLog!.find((event) => event.id === 'event-retired-asset')
    if (historicalEvent?.type !== 'card.deleted') throw new Error('Complete fixture historical asset is missing')
    const historicalAsset = historicalEvent.data.card.assets![0]!
    const expectedRoots = [currentAsset, historicalAsset]
      .map((asset) => ({
        sha256: createHash('sha256').update(assetBytes(asset)).digest('hex'),
        size: asset.size,
      }))
      .sort((left, right) => left.sha256.localeCompare(right.sha256))
    const first = acquire(databasePath, fixture.snapshot)

    expect(await first.snapshot()).toEqual({ ok: true, value: fixture.snapshot })
    expect(readBoardPayloads(databasePath)).toEqual([
      { version: 1, updatedAt: fixture.snapshot.boards['idea-main']!.updatedAt },
      { version: 1, updatedAt: fixture.snapshot.boards['idea-second']!.updatedAt },
    ])
    const persistedText = readPersistedProfileText(databasePath)
    expect(persistedText).not.toContain('dataUrl')
    expect(persistedText).not.toContain('data:image/png;base64,')
    expect(persistedText).not.toContain(currentAsset.dataUrl.split(',')[1])
    expect(persistedText).not.toContain(historicalAsset.dataUrl.split(',')[1])
    expect(persistedText).not.toContain('.blobs')
    expect(persistedText).not.toContain(databasePath)

    const recoveryPoint = await first.createRecoveryPoint()
    expect(recoveryPoint).toMatchObject({ ok: true, value: { revision: fixture.snapshot.revision } })
    if (!recoveryPoint.ok) throw new Error('Complete fixture recovery point was not created')
    expect(readRecoveryManifestBlobRoots(databasePath, recoveryPoint.value.id)).toEqual(expectedRoots)
    expect(await first.blobCandidates()).toEqual({
      ok: true,
      value: {
        final: expectedRoots.map((root) => ({ ...root, referenced: true })),
        staging: { files: 0, totalBytes: 0 },
      },
    })

    await first.close()
    const reopened = acquire(databasePath)
    expect(await reopened.snapshot()).toEqual({ ok: true, value: fixture.snapshot })
    expect(await reopened.blobCandidates()).toEqual({
      ok: true,
      value: {
        final: expectedRoots.map((root) => ({ ...root, referenced: true })),
        staging: { files: 0, totalBytes: 0 },
      },
    })
  })

  it('deduplicates equal bytes without merging logical identities and hydrates them after reopen', async () => {
    const databasePath = disposableDatabasePath()
    const first = acquire(databasePath, assetFreeSnapshot())
    const secondLogicalAsset: CardAsset = {
      ...SYNTHETIC_PNG_ASSET,
      id: 'asset-note-image-copy',
      name: 'synthetic-note-copy.png',
      createdAt: '2026-01-03T00:00:02.000Z',
    }

    expect(PUBLIC_GATEWAY_COMMAND_NAMES).not.toContain('card.asset.add')
    expect(validateProfileCommandBatch(addAssetBatch('a', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: false, code: 'capability-denied' })
    expect(await first.applyCommandBatch(addAssetBatch('a', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: false, code: 'capability-denied' })

    expect(await first.applyAssetCommandBatch(addAssetBatch('a', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: true, value: { previousRevision: 7, revision: 8 } })
    expect(await first.applyAssetCommandBatch(addAssetBatch('b', 8, secondLogicalAsset)))
      .toMatchObject({ ok: true, value: { previousRevision: 8, revision: 9 } })
    expect(await first.applyAssetCommandBatch(addAssetBatch('a', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: true, value: { revision: 8, replayed: true } })

    const live = await first.snapshot()
    expect(live).toMatchObject({
      ok: true,
      value: {
        revision: 9,
        boards: {
          'idea-main': {
            cards: [{ assets: [SYNTHETIC_PNG_ASSET, secondLogicalAsset] }],
          },
        },
      },
    })
    const candidates = await first.blobCandidates()
    expect(candidates).toEqual({
      ok: true,
      value: {
        final: [{
          sha256: createHash('sha256').update(assetBytes(SYNTHETIC_PNG_ASSET)).digest('hex'),
          size: SYNTHETIC_PNG_ASSET.size,
          referenced: true,
        }],
        staging: { files: 0, totalBytes: 0 },
      },
    })
    expect(JSON.stringify(candidates)).not.toContain(databasePath)

    const persistedText = readPersistedProfileText(databasePath)
    expect(persistedText).not.toContain('dataUrl')
    expect(persistedText).not.toContain(SYNTHETIC_PNG_ASSET.dataUrl)
    expect(persistedText).not.toContain(SYNTHETIC_PNG_ASSET.dataUrl.split(',')[1])
    expect(persistedText).not.toContain('.blobs')
    expect(persistedText).not.toContain(databasePath)

    await first.close()
    const reopened = acquire(databasePath)
    expect(await reopened.snapshot()).toMatchObject({
      ok: true,
      value: {
        revision: 9,
        boards: {
          'idea-main': {
            cards: [{ assets: [SYNTHETIC_PNG_ASSET, secondLogicalAsset] }],
          },
        },
      },
    })
    expect(existsSync(`${databasePath}.blobs`)).toBe(true)
  })

  it('removes logical references transactionally without deleting the shared final blob', async () => {
    const databasePath = disposableDatabasePath()
    const coordinator = acquire(databasePath, assetFreeSnapshot())
    const copy: CardAsset = { ...SYNTHETIC_PNG_ASSET, id: 'asset-copy', name: 'copy.png' }

    expect(await coordinator.applyAssetCommandBatch(addAssetBatch('a', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: true, value: { revision: 8 } })
    expect(await coordinator.applyAssetCommandBatch(addAssetBatch('b', 8, copy)))
      .toMatchObject({ ok: true, value: { revision: 9 } })
    expect(await coordinator.applyAssetCommandBatch(removeAssetBatch('c', 9, SYNTHETIC_PNG_ASSET.id)))
      .toMatchObject({ ok: true, value: { revision: 10 } })
    expect(await coordinator.snapshot()).toMatchObject({
      ok: true,
      value: { boards: { 'idea-main': { cards: [{ assets: [copy] }] } } },
    })
    expect(await coordinator.applyAssetCommandBatch(removeAssetBatch('d', 10, copy.id)))
      .toMatchObject({ ok: true, value: { revision: 11 } })
    expect(await coordinator.snapshot()).toMatchObject({
      ok: true,
      value: { revision: 11, boards: { 'idea-main': { cards: [{ id: 'card-note' }] } } },
    })
    expect(await coordinator.blobCandidates()).toMatchObject({
      ok: true,
      value: { final: [{ size: 68, referenced: false }] },
    })
    expect(existsSync(finalBlobPath(databasePath, SYNTHETIC_PNG_ASSET))).toBe(true)
  })

  it('keeps pre-promotion staging failure and promoted commit failure outside the acknowledged revision', async () => {
    const stagedPath = disposableDatabasePath()
    let stageAttempts = 0
    const staged = acquire(stagedPath, assetFreeSnapshot(), {
      blobTestHooks: {
        afterStageFlush: () => {
          stageAttempts += 1
          if (stageAttempts === 1) throw new Error('synthetic stage interruption')
        },
      },
    })
    expect(await staged.applyAssetCommandBatch(addAssetBatch('stage', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: false, code: 'internal' })
    expect(await staged.snapshot()).toMatchObject({ ok: true, value: { revision: 7 } })
    expect(await staged.blobCandidates()).toEqual({
      ok: true,
      value: { final: [], staging: { files: 1, totalBytes: 68 } },
    })

    const promotedPath = disposableDatabasePath()
    let commitAttempts = 0
    const promoted = acquire(promotedPath, assetFreeSnapshot(), {
      testHooks: {
        beforeCommit: () => {
          commitAttempts += 1
          if (commitAttempts === 1) throw new Error('synthetic commit interruption')
        },
      },
    })
    const batch = addAssetBatch('promoted', 7, SYNTHETIC_PNG_ASSET)
    expect(await promoted.applyAssetCommandBatch(batch)).toMatchObject({ ok: false, code: 'internal' })
    expect(await promoted.snapshot()).toMatchObject({ ok: true, value: { revision: 7 } })
    expect(await promoted.blobCandidates()).toMatchObject({
      ok: true,
      value: { final: [{ referenced: false }], staging: { files: 0 } },
    })
    expect(await promoted.applyAssetCommandBatch(batch))
      .toMatchObject({ ok: true, value: { revision: 8, replayed: false } })
  })

  it('does not acknowledge an existing final when its durability barrier fails', async () => {
    const databasePath = disposableDatabasePath()
    let existingFinalBarriers = 0
    const coordinator = acquire(databasePath, assetFreeSnapshot(), {
      blobTestHooks: {
        beforeFinalDurabilityBarrier: ({ existingFinal }) => {
          if (!existingFinal) return
          existingFinalBarriers += 1
          throw new Error('synthetic existing-final durability failure')
        },
      },
    })
    const copy: CardAsset = {
      ...SYNTHETIC_PNG_ASSET,
      id: 'asset-existing-final-copy',
      name: 'existing-final-copy.png',
    }

    expect(await coordinator.applyAssetCommandBatch(addAssetBatch('first', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: true, value: { revision: 8 } })
    expect(await coordinator.applyAssetCommandBatch(removeAssetBatch('remove', 8, SYNTHETIC_PNG_ASSET.id)))
      .toMatchObject({ ok: true, value: { revision: 9 } })
    expect(await coordinator.applyAssetCommandBatch(addAssetBatch('dedupe', 9, copy)))
      .toMatchObject({ ok: false, code: 'internal' })
    expect(existingFinalBarriers).toBe(1)
    expect(await coordinator.snapshot()).toMatchObject({
      ok: true,
      value: { revision: 9, boards: { 'idea-main': { cards: [{ id: 'card-note' }] } } },
    })
    expect(await coordinator.blobCandidates()).toMatchObject({
      ok: true,
      value: {
        final: [{ referenced: false }],
        staging: { files: 1, totalBytes: SYNTHETIC_PNG_ASSET.size },
      },
    })
  })

  it('fails closed before publication when a blob directory identity changes', async () => {
    const databasePath = disposableDatabasePath()
    const digest = createHash('sha256').update(assetBytes(SYNTHETIC_PNG_ASSET)).digest('hex')
    const prefixRoot = path.dirname(finalBlobPathForDigest(databasePath, digest))
    const trapRoot = path.join(path.dirname(databasePath), 'outside-blob-root')
    let swapped = false
    const coordinator = acquire(databasePath, assetFreeSnapshot(), {
      blobTestHooks: {
        afterStageFlush: () => {
          if (swapped) return
          swapped = true
          mkdirSync(trapRoot)
          renameSync(prefixRoot, `${prefixRoot}.detached`)
          symlinkSync(trapRoot, prefixRoot, process.platform === 'win32' ? 'junction' : 'dir')
        },
      },
    })

    expect(await coordinator.applyAssetCommandBatch(addAssetBatch('swap', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    expect(readdirSync(trapRoot)).toEqual([])
    expect(await coordinator.snapshot()).toMatchObject({ ok: true, value: { revision: 7 } })
  })

  it('fails closed for a missing or corrupt reachable blob while ignoring unreferenced extras', async () => {
    const databasePath = disposableDatabasePath()
    const coordinator = acquire(databasePath, assetFreeSnapshot())
    expect(await coordinator.applyAssetCommandBatch(addAssetBatch('a', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: true, value: { revision: 8 } })

    const extraBytes = Buffer.from('unreferenced synthetic blob')
    const extraDigest = createHash('sha256').update(extraBytes).digest('hex')
    const extraPath = finalBlobPathForDigest(databasePath, extraDigest)
    mkdirSync(path.dirname(extraPath), { recursive: true })
    writeFileSync(extraPath, extraBytes)
    expect(await coordinator.snapshot()).toMatchObject({ ok: true, value: { revision: 8 } })
    const candidates = await coordinator.blobCandidates()
    expect(candidates).toMatchObject({ ok: true, value: { final: [{}, {}] } })
    if (candidates.ok) {
      expect(candidates.value.final.map((candidate) => candidate.referenced).sort())
        .toEqual([false, true])
    }

    const reachablePath = finalBlobPath(databasePath, SYNTHETIC_PNG_ASSET)
    writeFileSync(reachablePath, Buffer.from('corrupt'))
    expect(await coordinator.snapshot())
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    writeFileSync(reachablePath, assetBytes(SYNTHETIC_PNG_ASSET))
    unlinkSync(reachablePath)
    expect(await coordinator.status())
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    expect(await coordinator.applyAssetCommandBatch(addAssetBatch('cannot-repair', 8, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    expect(existsSync(reachablePath)).toBe(false)
  })

  it('classifies tampered logical asset references and payloads as recovery-required', async () => {
    const databasePath = disposableDatabasePath()
    const coordinator = acquire(databasePath, assetFreeSnapshot())
    expect(await coordinator.applyAssetCommandBatch(addAssetBatch('a', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: true, value: { revision: 8 } })

    const database = new DatabaseSync(databasePath)
    try {
      database.prepare(`
UPDATE profile_records
SET parent_id = 'card-tampered'
WHERE kind = 'logical-asset'
`).run()
    } finally {
      database.close()
    }
    expect(await coordinator.snapshot())
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })

    const malformed = new DatabaseSync(databasePath)
    try {
      malformed.prepare(`
UPDATE profile_records
SET parent_id = 'card-note', payload_json = '{'
WHERE kind = 'logical-asset'
`).run()
    } finally {
      malformed.close()
    }
    expect(await coordinator.snapshot())
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
  })

  it('classifies a missing reachable blob ancestor as recovery-required', async () => {
    const databasePath = disposableDatabasePath()
    const coordinator = acquire(databasePath, assetFreeSnapshot())
    expect(await coordinator.applyAssetCommandBatch(addAssetBatch('a', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: true, value: { revision: 8 } })

    const hashRoot = path.join(`${databasePath}.blobs`, 'sha256')
    renameSync(hashRoot, `${hashRoot}.missing`)
    expect(await coordinator.snapshot())
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    expect(await coordinator.blobCandidates())
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
  })

  it('does not let a closed owner create blob storage', async () => {
    const databasePath = disposableDatabasePath()
    const coordinator = acquire(databasePath, assetFreeSnapshot())
    await coordinator.close()

    expect(await coordinator.applyAssetCommandBatch(addAssetBatch('late', 7, SYNTHETIC_PNG_ASSET)))
      .toMatchObject({ ok: false, code: 'busy' })
    expect(existsSync(`${databasePath}.blobs`)).toBe(false)
  })
})

function acquire(
  databasePath: string,
  seed?: ProfileSnapshot,
  hooks: Pick<SqliteProfileOwnerCoordinatorOptions, 'blobTestHooks' | 'testHooks'> = {},
): SqliteProfileOwnerCoordinator {
  let commit = 0
  let event = 0
  const result = acquireSqliteProfileOwner({
    databasePath,
    ownerId: `owner-${coordinators.length + 1}`,
    createOwnerToken: () => String(coordinators.length + 1).repeat(64),
    openExclusiveRuntime: openSqliteExclusiveRuntime,
    openProfileRuntime: openTestRuntime,
    now: () => '2026-01-03T00:00:01.000Z',
    createCommitId: () => `commit-asset-${++commit}`,
    createIntentEventId: () => `event-asset-${++event}`,
    ...hooks,
    ...(seed ? { seed } : {}),
  })
  if (!result.ok) throw new Error(`Expected owner acquisition, received ${result.code}`)
  coordinators.push(result.value)
  return result.value
}

function removeAssetBatch(
  suffix: string,
  expectedRevision: number,
  assetId: string,
): ProfileCommandBatch {
  return {
    version: PROFILE_CONTRACT_VERSIONS.command,
    schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
    expectedRevision,
    actor: { id: 'actor-synthetic', kind: 'user', transport: 'test' },
    clientTxnId: `txn-asset-${suffix}`,
    idempotencyKey: `idempotency-asset-${suffix}`,
    dryRun: false,
    commands: [{
      version: PROFILE_CONTRACT_VERSIONS.command,
      id: `command-asset-${suffix}`,
      name: 'card.asset.remove',
      payload: { ideaId: 'idea-main', cardId: 'card-note', assetId },
    }],
  }
}

function addAssetBatch(
  suffix: string,
  expectedRevision: number,
  asset: CardAsset,
): ProfileCommandBatch {
  return {
    version: PROFILE_CONTRACT_VERSIONS.command,
    schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
    expectedRevision,
    actor: { id: 'actor-synthetic', kind: 'user', transport: 'test' },
    clientTxnId: `txn-asset-${suffix}`,
    idempotencyKey: `idempotency-asset-${suffix}`,
    dryRun: false,
    commands: [{
      version: PROFILE_CONTRACT_VERSIONS.command,
      id: `command-asset-${suffix}`,
      name: 'card.asset.add',
      payload: { ideaId: 'idea-main', cardId: 'card-note', asset },
    }],
  }
}

function assetBytes(asset: CardAsset): Buffer {
  return Buffer.from(asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1), 'base64')
}

function finalBlobPath(databasePath: string, asset: CardAsset): string {
  const digest = createHash('sha256').update(assetBytes(asset)).digest('hex')
  return finalBlobPathForDigest(databasePath, digest)
}

function finalBlobPathForDigest(databasePath: string, digest: string): string {
  return path.join(`${databasePath}.blobs`, 'sha256', digest.slice(0, 2), digest)
}

function readPersistedProfileText(databasePath: string): string {
  const database = new DatabaseSync(databasePath)
  try {
    const records = database.prepare(`
SELECT payload_json AS value FROM profile_records
UNION ALL
SELECT COALESCE(batch_json, '') AS value FROM profile_revisions
UNION ALL
SELECT COALESCE(receipt_json, '') AS value FROM profile_revisions
`).all() as Array<{ value: string }>
    return records.map((row) => row.value).join('\n')
  } finally {
    database.close()
  }
}

function readBoardPayloads(databasePath: string): unknown[] {
  const database = new DatabaseSync(databasePath)
  try {
    const rows = database.prepare(`
SELECT payload_json FROM profile_records
WHERE kind = 'board'
ORDER BY record_id
`).all() as Array<{ payload_json: string }>
    return rows.map((row) => JSON.parse(row.payload_json) as unknown)
  } finally {
    database.close()
  }
}

function readRecoveryManifestBlobRoots(databasePath: string, candidateId: string): unknown {
  const manifestPath = path.join(
    `${databasePath}.recovery`,
    'generations',
    candidateId,
    'manifest.json',
  )
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { blobs?: unknown }
  return manifest.blobs
}

function disposableDatabasePath(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eido-461-blobs-'))
  disposableRoots.push(root)
  return path.join(root, 'profile.sqlite')
}

function assetFreeSnapshot(): ProfileSnapshot {
  return {
    profileId: 'profile-synthetic',
    revision: 7,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId: 'idea-main',
    ideas: [{
      id: 'idea-main',
      name: 'Synthetic Main',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: '2026-01-01T00:00:00.000Z',
    }],
    boards: {
      'idea-main': {
        version: 1,
        cards: [{
          id: 'card-note',
          kind: 'note',
          position: { x: 120, y: 80 },
          blocks: [{ id: 'block-note', text: 'Synthetic source note', kind: 'line' }],
        }],
        connections: [],
        outputs: [],
        runs: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
    modTemplates: [],
    modInstances: [],
    profileSettings: [],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
}
