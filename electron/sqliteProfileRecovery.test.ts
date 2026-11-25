import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProfileAgentCommandRequest } from '../src/persistence/profileAgentCommandPlan'
import {
  PROFILE_CONTRACT_VERSIONS,
  type ProfileCommandBatch,
  type ProfileSnapshot,
} from '../src/persistence/profileServiceContract'
import { SYNTHETIC_PNG_ASSET } from '../src/persistence/fixtures/profileFixtureCorpus'
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
    const expectedPrefix = path.join(tmpdir(), 'eido-462-recovery-')
    if (!root.startsWith(expectedPrefix)) throw new Error('Refusing to remove an unexpected test directory')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('owner-held SQLite Profile recovery (#462)', () => {
  it('creates a verified recovery generation on every clean close', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot(), {
      automaticRecoveryPoints: true,
    })
    await healthy.close()
    mutateDatabase(databasePath, 'UPDATE profile_meta SET profile_version = 0')

    const recovering = acquire(databasePath, 'owner-b', 'b')
    expect(await recovering.recover({ mode: 'inspect' })).toMatchObject({
      ok: true,
      value: {
        mode: 'inspect',
        candidates: [{ revision: 7, verified: true }],
      },
    })
  })

  it('rejects malformed recovery identifiers without demoting a healthy owner', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const identity = fileIdentity(databasePath)

    expect(await healthy.recover({
      mode: 'restore',
      candidateId: '../not-owned',
      expectedRevision: 7,
    })).toMatchObject({ ok: false, code: 'invalid' })
    expect(await healthy.status()).toMatchObject({ ok: true, value: { revision: 7 } })
    expect(fileIdentity(databasePath)).toEqual(identity)
  })

  it('restores an older generation above the sidecar high-water without releasing authority', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const sidecarIdentity = fileIdentity(`${databasePath}.owner.sqlite`)
    const originalProfileIdentity = fileIdentity(databasePath)

    expect(await healthy.createRecoveryPoint()).toMatchObject({
      ok: true,
      value: { revision: 7, verified: true },
    })
    expect(await healthy.applyCommandBatch(updateBatch('eight', 7, 'Acknowledged revision eight')))
      .toMatchObject({ ok: true, value: { revision: 8 } })
    await healthy.close()

    const corruptor = new DatabaseSync(databasePath)
    corruptor.exec('UPDATE profile_meta SET profile_version = 0')
    corruptor.close()

    const recovering = acquire(databasePath, 'owner-b', 'b')
    expect(fileIdentity(`${databasePath}.owner.sqlite`)).toEqual(sidecarIdentity)
    expect(acquireSqliteProfileOwner(ownerOptions(databasePath, 'owner-c', 'c')))
      .toMatchObject({ ok: false, code: 'busy' })
    expect(await recovering.status()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })

    const inspection = await recovering.recover({ mode: 'inspect' })
    expect(inspection).toMatchObject({
      ok: true,
      value: {
        mode: 'inspect',
        candidates: [{ revision: 7, verified: true }],
        rejectedCandidateIds: [],
      },
    })
    if (!inspection.ok || inspection.value.mode !== 'inspect') {
      throw new Error('Expected one inspected recovery candidate')
    }
    const candidateId = inspection.value.selectedCandidateId
    if (!candidateId) throw new Error('Expected the verified candidate to be selected')

    expect(await recovering.recover({
      mode: 'restore',
      candidateId,
      expectedRevision: 8,
    })).toMatchObject({
      ok: true,
      value: {
        mode: 'restore',
        selectedCandidateId: candidateId,
        previousRevision: 8,
        revision: 9,
        quarantinedCurrentState: true,
      },
    })
    expect(fileIdentity(`${databasePath}.owner.sqlite`)).toEqual(sidecarIdentity)
    expect(fileIdentity(databasePath)).not.toEqual(originalProfileIdentity)
    expect(await recovering.snapshot()).toMatchObject({
      ok: true,
      value: {
        revision: 9,
        boards: { 'idea-main': { cards: [{ blocks: [{ text: 'Synthetic source note' }] }] } },
      },
    })
    const restoredProfileIdentity = fileIdentity(databasePath)
    await recovering.close()
    const replayOwner = acquire(databasePath, 'owner-d', 'd')
    expect(await replayOwner.recover({
      mode: 'restore',
      candidateId,
      expectedRevision: 8,
    })).toMatchObject({
      ok: true,
      value: {
        previousRevision: 8,
        revision: 9,
      },
    })
    expect(fileIdentity(databasePath)).toEqual(restoredProfileIdentity)
    const queuedAgent = replayOwner.applyAgentCommandBatch(
      recoveryAgentCreateRequest(9),
      'cli',
    )
    const overtakingReplay = replayOwner.recover({
      mode: 'restore',
      candidateId,
      expectedRevision: 8,
    })
    expect(await queuedAgent).toMatchObject({
      ok: true,
      value: { previousRevision: 9, revision: 10 },
    })
    expect(await overtakingReplay).toMatchObject({
      ok: false,
      code: 'conflict',
      currentRevision: 10,
    })
  })

  it('drains an accepted recovery restore before an immediate close', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-close-after-restore', 'q', assetFreeSnapshot())
    const point = await healthy.createRecoveryPoint()
    if (!point.ok) throw new Error('Expected a recovery point before restore')

    const restoring = healthy.recover({
      mode: 'restore',
      candidateId: point.value.id,
      expectedRevision: 7,
    })
    const closing = healthy.close()

    expect(await restoring).toMatchObject({
      ok: true,
      value: { previousRevision: 7, revision: 8 },
    })
    await closing
    const reopened = acquire(databasePath, 'owner-after-closed-restore', 'r')
    expect(await reopened.status()).toMatchObject({ ok: true, value: { revision: 8 } })
  })

  it('acquires a missing Profile in recovery-only mode under its existing sidecar', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const point = await healthy.createRecoveryPoint()
    if (!point.ok) throw new Error('Expected a recovery point before removing the Profile')
    await healthy.close()
    unlinkSync(databasePath)

    const recovering = acquire(databasePath, 'owner-b', 'b')
    expect(await recovering.snapshot()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    expect(acquireSqliteProfileOwner(ownerOptions(databasePath, 'owner-c', 'c')))
      .toMatchObject({ ok: false, code: 'busy' })
    expect(await recovering.recover({
      mode: 'restore',
      candidateId: point.value.id,
      expectedRevision: 7,
    })).toMatchObject({
      ok: true,
      value: {
        previousRevision: 7,
        revision: 8,
        quarantinedCurrentState: false,
      },
    })
  })

  it('does not adopt a recovery head whose exact sidecar operation evidence mismatches', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const point = await healthy.createRecoveryPoint()
    if (!point.ok) throw new Error('Expected a recovery point before testing operation closure')
    expect(await healthy.applyCommandBatch(updateBatch('eight', 7, 'Acknowledged revision eight')))
      .toMatchObject({ ok: true, value: { revision: 8 } })
    expect(await healthy.recover({
      mode: 'restore',
      candidateId: point.value.id,
      expectedRevision: 8,
    })).toMatchObject({ ok: true, value: { revision: 9 } })
    await healthy.close()

    mutateDatabase(
      `${databasePath}.owner.sqlite`,
      "UPDATE profile_recovery_operations SET candidate_id = 'different-candidate'",
    )
    const recovering = acquire(databasePath, 'owner-b', 'b')
    expect(await recovering.status()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    expect(acquireSqliteProfileOwner(ownerOptions(databasePath, 'owner-c', 'c')))
      .toMatchObject({ ok: false, code: 'busy' })
  })

  it('selects only complete strict candidates while ignoring unrelated blob leftovers', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    expect(await healthy.applyAssetCommandBatch(addAssetBatch(7))).toMatchObject({
      ok: true,
      value: { revision: 8 },
    })
    const created = await healthy.createRecoveryPoint()
    if (!created.ok) throw new Error('Expected an asset-backed recovery generation')
    const validId = created.value.id
    expect(await healthy.applyAssetCommandBatch(removeAssetBatch(8))).toMatchObject({
      ok: true,
      value: { revision: 9 },
    })
    expect(await healthy.blobCandidates()).toMatchObject({
      ok: true,
      value: { final: [{ referenced: true }] },
    })
    const generationsRoot = path.join(`${databasePath}.recovery`, 'generations')
    cloneAndResealCandidate(generationsRoot, validId, 'corrupt-database', (candidateDatabase) => {
      writeFileSync(candidateDatabase, Buffer.from('not a sqlite database'))
    })
    cloneAndResealCandidate(generationsRoot, validId, 'future-version', (candidateDatabase) => {
      mutateDatabase(candidateDatabase, 'UPDATE profile_meta SET profile_version = 99')
    })
    cloneAndResealCandidate(generationsRoot, validId, 'broken-receipt', (candidateDatabase) => {
      mutateDatabase(candidateDatabase, "UPDATE profile_revisions SET receipt_json = '{}' WHERE revision = 8")
    })
    cloneAndResealCandidate(generationsRoot, validId, 'extra-receipt-field', (candidateDatabase) => {
      mutateDatabase(
        candidateDatabase,
        "UPDATE profile_revisions SET receipt_json = json_set(receipt_json, '$.unexpected', 1) WHERE revision = 8",
      )
    })
    cloneAndResealCandidate(generationsRoot, validId, 'orphan-intent', (candidateDatabase) => {
      mutateDatabase(candidateDatabase, `
INSERT INTO profile_records (
  profile_id, record_id, kind, owner_id, parent_id, ordinal, record_version,
  created_revision, updated_revision, payload_json
)
SELECT profile_id, 'event-orphan', kind, owner_id, parent_id, ordinal + 1, record_version,
       created_revision, updated_revision,
       json_set(payload_json, '$.id', 'event-orphan', '$.seq', json_extract(payload_json, '$.seq') + 1)
FROM profile_records
WHERE kind = 'intent-event'
ORDER BY ordinal DESC
LIMIT 1
`)
    })

    const blobRoot = `${databasePath}.blobs`
    const extraDigest = 'f'.repeat(64)
    mkdirSync(path.join(blobRoot, 'sha256', 'ff'), { recursive: true })
    writeFileSync(path.join(blobRoot, 'sha256', 'ff', extraDigest), Buffer.from('unreferenced'))
    mkdirSync(path.join(blobRoot, 'staging'), { recursive: true })
    writeFileSync(path.join(blobRoot, 'staging', 'leftover.stage'), Buffer.from('staged'))

    await healthy.close()
    mutateDatabase(databasePath, 'UPDATE profile_meta SET schema_version = 0')
    const recovering = acquire(databasePath, 'owner-b', 'b')
    expect(await recovering.recover({ mode: 'inspect' })).toMatchObject({
      ok: true,
      value: {
        selectedCandidateId: validId,
        candidates: [{ id: validId, revision: 8 }],
        rejectedCandidateIds: [
          'broken-receipt',
          'corrupt-database',
          'extra-receipt-field',
          'future-version',
          'orphan-intent',
        ],
      },
    })

    const finalPath = finalBlobPath(databasePath)
    writeFileSync(finalPath, Buffer.alloc(SYNTHETIC_PNG_ASSET.size, 0))
    expect(await recovering.recover({ mode: 'inspect' })).toMatchObject({
      ok: true,
      value: {
        candidates: [],
        rejectedCandidateIds: [
          'broken-receipt',
          'corrupt-database',
          'extra-receipt-field',
          'future-version',
          'orphan-intent',
          validId,
        ].sort(),
      },
    })
  })

  it('rejects a candidate ahead of trusted high-water before canonical quarantine', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    expect(await healthy.applyCommandBatch(updateBatch('eight', 7, 'Acknowledged revision eight')))
      .toMatchObject({ ok: true, value: { revision: 8 } })
    const point = await healthy.createRecoveryPoint()
    if (!point.ok) throw new Error('Expected a revision-eight recovery point')
    await healthy.close()

    mutateDatabase(
      `${databasePath}.owner.sqlite`,
      'UPDATE profile_recovery_state SET revision_high_water = 7 WHERE identity = 1',
    )
    mutateDatabase(databasePath, 'UPDATE profile_meta SET profile_version = 0')
    const canonicalIdentity = fileIdentity(databasePath)
    const recovering = acquire(databasePath, 'owner-b', 'b')

    expect(await recovering.recover({ mode: 'inspect' })).toMatchObject({
      ok: true,
      value: {
        candidates: [],
        rejectedCandidateIds: [point.value.id],
      },
    })
    expect(await recovering.recover({
      mode: 'restore',
      candidateId: point.value.id,
      expectedRevision: 7,
    })).toMatchObject({
      ok: false,
      code: 'not-found',
      currentRevision: 7,
    })
    expect(fileIdentity(databasePath)).toEqual(canonicalIdentity)
  })

  it('retains only the newest three verified generations', async () => {
    const databasePath = disposableDatabasePath()
    const coordinator = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const created: string[] = []
    const first = await coordinator.createRecoveryPoint()
    if (!first.ok) throw new Error('Expected the first recovery point')
    created.push(first.value.id)
    for (const revision of [8, 9, 10]) {
      expect(await coordinator.applyCommandBatch(updateBatch(
        `revision-${revision}`,
        revision - 1,
        `Revision ${revision}`,
      ))).toMatchObject({ ok: true, value: { revision } })
      const point = await coordinator.createRecoveryPoint()
      if (!point.ok) throw new Error(`Expected recovery point ${revision}`)
      created.push(point.value.id)
    }

    const inspection = await coordinator.recover({ mode: 'inspect' })
    expect(inspection).toMatchObject({
      ok: true,
      value: { candidates: [{ revision: 10 }, { revision: 9 }, { revision: 8 }] },
    })
    expect(existsSync(path.join(`${databasePath}.recovery`, 'generations', created[0]!))).toBe(false)
  })

  it('keeps incomplete generation publication ineligible', async () => {
    const databasePath = disposableDatabasePath()
    let cut = true
    const coordinator = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot(), {
      recoveryTestHooks: {
        afterGenerationFilesFlushed: () => {
          if (!cut) return
          cut = false
          throw new Error('synthetic incomplete generation publication')
        },
      },
    })
    expect(await coordinator.createRecoveryPoint()).toMatchObject({ ok: false, code: 'internal' })
    expect(await coordinator.recover({ mode: 'inspect' })).toMatchObject({
      ok: true,
      value: { candidates: [], rejectedCandidateIds: [expect.any(String)] },
    })
  })

  it('keeps a pre-quarantine reservation recovery-only across owner restart', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const point = await healthy.createRecoveryPoint()
    if (!point.ok) throw new Error('Expected a recovery point before reservation')
    expect(await healthy.applyCommandBatch(updateBatch('eight', 7, 'Acknowledged revision eight')))
      .toMatchObject({ ok: true, value: { revision: 8 } })
    let cut = true
    const request = {
      mode: 'restore' as const,
      candidateId: point.value.id,
      expectedRevision: 8,
    }

    // The hook must be installed at acquisition, so hand off the healthy
    // canonical Profile before reserving the recovery revision.
    await healthy.close()
    const reserving = acquire(databasePath, 'owner-b', 'b', undefined, {
      recoveryTestHooks: {
        afterReservationBeforeQuarantine: () => {
          if (!cut) return
          cut = false
          throw new Error('synthetic post-reservation cut')
        },
      },
    })
    expect(await reserving.recover(request)).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
      currentRevision: 9,
    })
    await reserving.close()

    const restarted = acquire(databasePath, 'owner-c', 'c')
    expect(await restarted.status()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    expect(await restarted.applyCommandBatch(updateBatch('reserved-nine', 8, 'Must not reuse nine')))
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    expect(await restarted.recover(request)).toMatchObject({
      ok: true,
      value: { previousRevision: 8, revision: 9 },
    })
  })

  it('reverifies candidate bytes after quarantine before publishing them', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const point = await healthy.createRecoveryPoint()
    if (!point.ok) throw new Error('Expected a recovery point before the verification-window fault')
    expect(await healthy.applyCommandBatch(updateBatch('eight', 7, 'Acknowledged revision eight')))
      .toMatchObject({ ok: true, value: { revision: 8 } })
    await healthy.close()

    let changed = false
    const candidateDatabase = path.join(
      `${databasePath}.recovery`,
      'generations',
      point.value.id,
      'profile.sqlite',
    )
    const recovering = acquire(databasePath, 'owner-b', 'b', undefined, {
      recoveryTestHooks: {
        afterQuarantineBeforePromotion: () => {
          if (changed) return
          changed = true
          mutateDatabase(
            candidateDatabase,
            "UPDATE profile_meta SET updated_at = '2099-01-01T00:00:00.000Z'",
          )
        },
      },
    })

    expect(await recovering.recover({
      mode: 'restore',
      candidateId: point.value.id,
      expectedRevision: 8,
    })).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
      currentRevision: 9,
    })
    expect(existsSync(databasePath)).toBe(false)
    expect(await recovering.recover({ mode: 'inspect' })).toMatchObject({
      ok: true,
      value: {
        candidates: [],
        rejectedCandidateIds: [point.value.id],
      },
    })
  })

  it('resets only operation-owned stage sidecars before an exact retry copy', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const point = await healthy.createRecoveryPoint()
    if (!point.ok) throw new Error('Expected a recovery point before planting stale stage state')
    expect(await healthy.applyCommandBatch(updateBatch('eight', 7, 'Acknowledged revision eight')))
      .toMatchObject({ ok: true, value: { revision: 8 } })
    await healthy.close()

    const operationId = 'stale-stage-retry'
    const stagePath = `${databasePath}.restore-${operationId}.stage`
    const unrelatedPath = `${stagePath}.unrelated`
    let planted = false
    const recovering = acquire(databasePath, 'owner-b', 'b', undefined, {
      createRecoveryOperationId: () => operationId,
      openProfileRuntime: (location) => {
        if (
          path.resolve(location) === path.resolve(stagePath)
          && (existsSync(`${stagePath}-wal`) || existsSync(`${stagePath}-shm`))
        ) throw new Error('stale operation-owned SQLite stage sidecar survived recopy')
        return openTestRuntime(location)
      },
      recoveryTestHooks: {
        afterQuarantineBeforePromotion: () => {
          if (planted) return
          planted = true
          writeFileSync(stagePath, Buffer.from('stale stage main'))
          writeFileSync(`${stagePath}-wal`, Buffer.from('stale stage wal'))
          writeFileSync(`${stagePath}-shm`, Buffer.from('stale stage shm'))
          writeFileSync(unrelatedPath, Buffer.from('must survive'))
        },
      },
    })

    expect(await recovering.recover({
      mode: 'restore',
      candidateId: point.value.id,
      expectedRevision: 8,
    })).toMatchObject({
      ok: true,
      value: { previousRevision: 8, revision: 9 },
    })
    expect(readFileSync(unrelatedPath, 'utf8')).toBe('must survive')
  })

  it.each([
    'afterQuarantineBeforePromotion',
    'afterPromotionBeforeReopen',
  ] as const)('retries the same reserved restore safely after %s', async (faultHook) => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const point = await healthy.createRecoveryPoint()
    if (!point.ok) throw new Error('Expected a recovery point before the fault cut')
    expect(await healthy.applyCommandBatch(updateBatch('eight', 7, 'Acknowledged revision eight')))
      .toMatchObject({ ok: true, value: { revision: 8 } })
    await healthy.close()
    mutateDatabase(databasePath, 'UPDATE profile_meta SET record_version = 0')

    let cut = true
    const recovering = acquire(databasePath, 'owner-b', 'b', undefined, {
      recoveryTestHooks: {
        [faultHook]: () => {
          if (!cut) return
          cut = false
          throw new Error(`synthetic ${faultHook}`)
        },
      },
    })
    const request = {
      mode: 'restore' as const,
      candidateId: point.value.id,
      expectedRevision: 8,
    }
    expect(await recovering.recover(request)).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
      currentRevision: 9,
    })
    expect(acquireSqliteProfileOwner(ownerOptions(databasePath, 'owner-c', 'c')))
      .toMatchObject({ ok: false, code: 'busy' })
    let retryOwner = recovering
    if (faultHook === 'afterQuarantineBeforePromotion') {
      await recovering.close()
      retryOwner = acquire(databasePath, 'owner-restarted', 'd')
      expect(await retryOwner.status()).toMatchObject({
        ok: false,
        code: 'corrupt-or-recovery-required',
      })
      expect(await retryOwner.applyCommandBatch(updateBatch('reserved-nine', 8, 'Must not reuse nine')))
        .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    }
    expect(await retryOwner.recover(request)).toMatchObject({
      ok: true,
      value: { previousRevision: 8, revision: 9 },
    })
    expect(await retryOwner.applyCommandBatch(updateBatch('ten', 9, 'Revision ten')))
      .toMatchObject({ ok: true, value: { revision: 10 } })
  })
})

describe('owner-held SQLite Profile start-fresh escape hatch (#813)', () => {
  it('automatically rebuilds valid current Board state when revision evidence needs repair', async () => {
    const databasePath = disposableDatabasePath()
    const source = structuredClone(assetFreeSnapshot())
    source.boards['idea-main']!.cards[0]!.assets = [SYNTHETIC_PNG_ASSET]
    const healthy = acquire(databasePath, 'owner-a', 'a', source)
    expect(await healthy.applyCommandBatch(updateBatch(
      'eight',
      7,
      'The user must see this exact recovered Board text',
    ))).toMatchObject({ ok: true, value: { revision: 8 } })
    const beforeFailure = await healthy.snapshot()
    expect(beforeFailure).toMatchObject({
      ok: true,
      value: {
        activeIdeaId: 'idea-main',
        boards: {
          'idea-main': {
            cards: [{ blocks: [{ text: 'The user must see this exact recovered Board text' }] }],
          },
        },
      },
    })
    await healthy.close()

    mutateDatabase(
      databasePath,
      "UPDATE profile_revisions SET receipt_json = '{}' WHERE revision = 8",
    )
    const damagedBytes = readFileSync(databasePath)

    const repaired = acquire(databasePath, 'owner-b', 'b', freshSeedSnapshot())
    expect(await repaired.status()).toMatchObject({ ok: true, value: { revision: 9 } })
    const afterRepair = await repaired.snapshot()
    expect(afterRepair).toMatchObject({
      ok: true,
      value: {
        activeIdeaId: 'idea-main',
        revision: 9,
        boards: {
          'idea-main': {
            cards: [{ blocks: [{ text: 'The user must see this exact recovered Board text' }] }],
          },
        },
      },
    })
    if (!beforeFailure.ok || !afterRepair.ok) throw new Error('Expected Profile snapshots')
    expect(afterRepair.value.boards).toEqual(beforeFailure.value.boards)
    expect(afterRepair.value.ideas).toEqual(beforeFailure.value.ideas)
    expect(afterRepair.value.boards['idea-main']!.cards[0]!.assets)
      .toEqual([SYNTHETIC_PNG_ASSET])
    expect(startFreshPreservedLocations(databasePath).some((location) => (
      readFileSync(location).equals(damagedBytes)
    ))).toBe(true)
  })

  it('refuses automatic repair when Profile authority has multiple heads', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    await healthy.close()
    mutateDatabase(databasePath, `
PRAGMA foreign_keys = OFF;
INSERT INTO profile_meta (
  profile_id, format, profile_version, schema_version, record_version,
  asset_version, app_version, command_version, export_version, source,
  current_revision, active_idea_id, seed_profile_agent_event_manifest_json, updated_at
)
SELECT 'profile-ambiguous', format, profile_version, schema_version, record_version,
       asset_version, app_version, command_version, export_version, source,
       current_revision, active_idea_id, seed_profile_agent_event_manifest_json, updated_at
FROM profile_meta
WHERE profile_id = 'profile-synthetic';
`)

    const recovering = acquire(databasePath, 'owner-b', 'b', freshSeedSnapshot())
    expect(await recovering.status()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    expect(await recovering.snapshot()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
  })

  it.each([
    'afterStartFreshReservation',
    'afterStartFreshQuarantine',
    'afterStartFreshStageBeforePromotion',
    'afterStartFreshPromotionBeforeReopen',
  ] as const)('resumes automatic same-Board repair after %s', async (faultHook) => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    expect(await healthy.applyCommandBatch(updateBatch(
      'eight-auto-resume',
      7,
      'Automatic repair must resume with this Board',
    ))).toMatchObject({ ok: true, value: { revision: 8 } })
    await healthy.close()
    mutateDatabase(
      databasePath,
      "UPDATE profile_revisions SET receipt_json = '{}' WHERE revision = 8",
    )

    let cut = true
    const interrupted = acquire(databasePath, 'owner-b', 'b', freshSeedSnapshot(), {
      recoveryTestHooks: {
        [faultHook]: () => {
          if (!cut) return
          cut = false
          throw new Error(`synthetic ${faultHook}`)
        },
      },
    })
    expect(await interrupted.status()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    await interrupted.close()

    const resumed = acquire(databasePath, 'owner-c', 'c', freshSeedSnapshot())
    expect(await resumed.status()).toMatchObject({ ok: true, value: { revision: 9 } })
    expect(await resumed.snapshot()).toMatchObject({
      ok: true,
      value: {
        revision: 9,
        boards: {
          'idea-main': {
            cards: [{ blocks: [{ text: 'Automatic repair must resume with this Board' }] }],
          },
        },
      },
    })
  })

  it('automatically upgrades a shipped record-axis-1 Profile without changing its Board', async () => {
    const databasePath = disposableDatabasePath()
    const source = structuredClone(assetFreeSnapshot())
    source.boards['idea-main']!.cards[0]!.kind = 'mod'
    source.boards['idea-main']!.cards[0]!.assets = [SYNTHETIC_PNG_ASSET]
    const healthy = acquire(databasePath, 'owner-a', 'a', source)
    const beforeUpgrade = await healthy.snapshot()
    await healthy.close()
    downgradeRecordAxisToOne(databasePath)
    insertRetiredLegacyCardMod(databasePath)
    insertRetiredLegacyModInstance(databasePath)
    const legacyBytes = readFileSync(databasePath)

    const upgraded = acquire(databasePath, 'owner-b', 'b', freshSeedSnapshot())
    expect(await upgraded.status()).toMatchObject({ ok: true, value: { revision: 8 } })
    const afterUpgrade = await upgraded.snapshot()
    if (!beforeUpgrade.ok || !afterUpgrade.ok) throw new Error('Expected upgraded snapshots')
    expect(afterUpgrade.value.boards).toEqual(beforeUpgrade.value.boards)
    expect(afterUpgrade.value.ideas).toEqual(beforeUpgrade.value.ideas)
    expect(afterUpgrade.value.modInstances).toEqual([])
    expect(afterUpgrade.value.boards['idea-main']!.cards[0]!.assets)
      .toEqual([SYNTHETIC_PNG_ASSET])
    expect(startFreshPreservedLocations(databasePath).some((location) => (
      readFileSync(location).equals(legacyBytes)
    ))).toBe(true)
  })

  it('starts fresh beside the set-aside incompatible Profile bytes', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    await healthy.close()
    mutateDatabase(databasePath, 'UPDATE profile_meta SET record_version = 1')
    const oldBytes = readFileSync(databasePath)
    const sidecarIdentity = fileIdentity(`${databasePath}.owner.sqlite`)

    const recovering = acquire(databasePath, 'owner-b', 'b', freshSeedSnapshot())
    expect(await recovering.status()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })

    expect(await recovering.startFresh()).toMatchObject({
      ok: true,
      value: {
        mode: 'start-fresh',
        previousRevision: 7,
        profileId: 'profile-fresh',
        revision: 0,
        quarantinedCurrentState: true,
      },
    })

    expect(await recovering.status()).toMatchObject({ ok: true, value: { revision: 0 } })
    expect(await recovering.snapshot()).toMatchObject({
      ok: true,
      value: {
        profileId: 'profile-fresh',
        revision: 0,
        boards: { 'idea-main': { cards: [{ blocks: [{ text: 'Synthetic source note' }] }] } },
      },
    })
    expect(fileIdentity(`${databasePath}.owner.sqlite`)).toEqual(sidecarIdentity)

    const setAside = startFreshQuarantineDatabasePaths(databasePath)
    expect(setAside).toHaveLength(1)
    expect(readFileSync(setAside[0]!).equals(oldBytes)).toBe(true)

    expect(await recovering.applyCommandBatch(updateBatch('fresh-one', 0, 'First fresh edit')))
      .toMatchObject({ ok: true, value: { revision: 1 } })
    expect(recovering.recoveryHighWaterRevision()).toBe(1)

    await recovering.close()
    const reopened = acquire(databasePath, 'owner-c', 'c')
    expect(await reopened.status()).toMatchObject({ ok: true, value: { revision: 1 } })
    expect(readFileSync(setAside[0]!).equals(oldBytes)).toBe(true)
  })

  it('refuses start-fresh while the Profile is healthy', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const identity = fileIdentity(databasePath)

    expect(await healthy.startFresh()).toMatchObject({
      ok: false,
      code: 'conflict',
      currentRevision: 7,
    })
    expect(await healthy.status()).toMatchObject({ ok: true, value: { revision: 7 } })
    expect(fileIdentity(databasePath)).toEqual(identity)
  })

  it.each([
    'afterStartFreshReservation',
    'afterStartFreshQuarantine',
    'afterStartFreshStageBeforePromotion',
    'afterStartFreshPromotionBeforeReopen',
  ] as const)('never loses set-aside bytes nor admits a half-seeded Profile after %s', async (faultHook) => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    await healthy.close()
    mutateDatabase(databasePath, 'UPDATE profile_meta SET record_version = 1')
    const oldBytes = readFileSync(databasePath)

    let cut = true
    const faulted = acquire(databasePath, 'owner-b', 'b', freshSeedSnapshot(), {
      recoveryTestHooks: {
        [faultHook]: () => {
          if (!cut) return
          cut = false
          throw new Error(`synthetic ${faultHook}`)
        },
      },
    })
    expect(await faulted.startFresh()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    expect(await faulted.status()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    // The user's bytes survive the interruption: either still canonical or
    // already set aside in the operation quarantine.
    expect(startFreshPreservedLocations(databasePath).some((location) => (
      readFileSync(location).equals(oldBytes)
    ))).toBe(true)

    // A restart must not admit the half-finished authority.
    await faulted.close()
    const restarted = acquire(databasePath, 'owner-c', 'c', freshSeedSnapshot())
    expect(await restarted.status()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    expect(await restarted.applyCommandBatch(updateBatch('half-seeded', 0, 'Must not admit')))
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })

    expect(await restarted.startFresh()).toMatchObject({
      ok: true,
      value: {
        mode: 'start-fresh',
        previousRevision: 7,
        revision: 0,
        quarantinedCurrentState: true,
      },
    })
    expect(await restarted.status()).toMatchObject({ ok: true, value: { revision: 0 } })
    const setAside = startFreshQuarantineDatabasePaths(databasePath)
    expect(setAside).toHaveLength(1)
    expect(readFileSync(setAside[0]!).equals(oldBytes)).toBe(true)
  })

  it('serializes start-fresh against a pending recovery restore reservation', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const point = await healthy.createRecoveryPoint()
    if (!point.ok) throw new Error('Expected a recovery point before the restore fault')
    expect(await healthy.applyCommandBatch(updateBatch('eight', 7, 'Acknowledged revision eight')))
      .toMatchObject({ ok: true, value: { revision: 8 } })
    await healthy.close()
    mutateDatabase(databasePath, 'UPDATE profile_meta SET record_version = 1')

    let cut = true
    const recovering = acquire(databasePath, 'owner-b', 'b', freshSeedSnapshot(), {
      recoveryTestHooks: {
        afterReservationBeforeQuarantine: () => {
          if (!cut) return
          cut = false
          throw new Error('synthetic post-reservation cut')
        },
      },
    })
    const request = {
      mode: 'restore' as const,
      candidateId: point.value.id,
      expectedRevision: 8,
    }
    expect(await recovering.recover(request)).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
      currentRevision: 9,
    })

    expect(await recovering.startFresh()).toMatchObject({
      ok: false,
      code: 'conflict',
      currentRevision: 9,
    })
    expect(await recovering.recover(request)).toMatchObject({
      ok: true,
      value: { previousRevision: 8, revision: 9 },
    })
  })

  it('blocks restore behind a pending start-fresh and rejects stale candidates afterwards', async () => {
    const databasePath = disposableDatabasePath()
    const healthy = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const point = await healthy.createRecoveryPoint()
    if (!point.ok) throw new Error('Expected a recovery point before the start-fresh fault')
    await healthy.close()
    mutateDatabase(databasePath, 'UPDATE profile_meta SET record_version = 1')

    let cut = true
    const recovering = acquire(databasePath, 'owner-b', 'b', freshSeedSnapshot(), {
      recoveryTestHooks: {
        afterStartFreshQuarantine: () => {
          if (!cut) return
          cut = false
          throw new Error('synthetic start-fresh quarantine cut')
        },
      },
    })
    expect(await recovering.startFresh()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    expect(await recovering.recover({
      mode: 'restore',
      candidateId: point.value.id,
      expectedRevision: 7,
    })).toMatchObject({ ok: false, code: 'conflict' })

    expect(await recovering.startFresh()).toMatchObject({
      ok: true,
      value: { mode: 'start-fresh', previousRevision: 7, revision: 0 },
    })
    // The old Profile's generations survive on disk but no longer verify for
    // the fresh Profile identity.
    expect(await recovering.recover({ mode: 'inspect' })).toMatchObject({
      ok: true,
      value: {
        candidates: [],
        rejectedCandidateIds: [point.value.id],
      },
    })
    expect(existsSync(path.join(`${databasePath}.recovery`, 'generations', point.value.id))).toBe(true)
  })
})

function startFreshQuarantineDatabasePaths(databasePath: string): string[] {
  const quarantineRoot = path.join(`${databasePath}.recovery`, 'quarantine')
  if (!existsSync(quarantineRoot)) return []
  return readdirSync(quarantineRoot)
    .filter((name) => name.startsWith('start-fresh-'))
    .map((name) => path.join(quarantineRoot, name, path.basename(databasePath)))
    .filter((location) => existsSync(location))
}

function startFreshPreservedLocations(databasePath: string): string[] {
  const quarantineRoot = path.join(`${databasePath}.recovery`, 'quarantine')
  const startupSafetyCopies = existsSync(quarantineRoot)
    ? readdirSync(quarantineRoot)
      .filter((name) => name.startsWith('startup-'))
      .map((name) => path.join(quarantineRoot, name, path.basename(databasePath)))
      .filter((location) => existsSync(location))
    : []
  return [
    ...(existsSync(databasePath) ? [databasePath] : []),
    ...startFreshQuarantineDatabasePaths(databasePath),
    ...startupSafetyCopies,
  ]
}

function freshSeedSnapshot(): ProfileSnapshot {
  return {
    ...assetFreeSnapshot(),
    profileId: 'profile-fresh',
    revision: 0,
  }
}

function acquire(
  databasePath: string,
  ownerId: string,
  tokenSeed: string,
  seed?: ProfileSnapshot,
  extra: Partial<SqliteProfileOwnerCoordinatorOptions> = {},
): SqliteProfileOwnerCoordinator {
  let commit = 0
  let event = 0
  const result = acquireSqliteProfileOwner({
    ...ownerOptions(databasePath, ownerId, tokenSeed),
    ...extra,
    ...(seed ? { seed } : {}),
    createCommitId: () => `commit-recovery-${++commit}`,
    createIntentEventId: () => `event-recovery-${++event}`,
  })
  if (!result.ok) throw new Error(`Expected owner acquisition, received ${result.code}`)
  coordinators.push(result.value)
  return result.value
}

function ownerOptions(databasePath: string, ownerId: string, tokenSeed: string) {
  return {
    databasePath,
    ownerId,
    createOwnerToken: () => token(tokenSeed),
    openExclusiveRuntime: openSqliteExclusiveRuntime,
    openProfileRuntime: openTestRuntime,
    now: () => '2026-01-03T00:00:01.000Z',
  }
}

function token(seed: string): string {
  return seed.repeat(64)
}

function disposableDatabasePath(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eido-462-recovery-'))
  disposableRoots.push(root)
  return path.join(root, 'profile.sqlite')
}

function fileIdentity(location: string) {
  const metadata = lstatSync(location, { bigint: true })
  return {
    device: metadata.dev,
    inode: metadata.ino,
    birthtime: metadata.birthtimeNs,
  }
}

function updateBatch(suffix: string, expectedRevision: number, text: string): ProfileCommandBatch {
  return {
    version: PROFILE_CONTRACT_VERSIONS.command,
    schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
    expectedRevision,
    actor: { id: 'actor-synthetic', kind: 'user', transport: 'test' },
    clientTxnId: `txn-${suffix}`,
    idempotencyKey: `idempotency-${suffix}`,
    dryRun: false,
    commands: [{
      version: PROFILE_CONTRACT_VERSIONS.command,
      id: `command-${suffix}`,
      name: 'card.update-content',
      payload: {
        ideaId: 'idea-main',
        cardId: 'card-note',
        blockId: 'block-note',
        text,
      },
    }],
  }
}

function recoveryAgentCreateRequest(expectedRevision: number): ProfileAgentCommandRequest {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision,
    idempotencyKey: 'recovery-agent-create',
    dryRun: false,
    commands: [{
      version: 1,
      id: 'recovery-agent-create-card',
      name: 'card.create',
      payload: {
        ideaId: 'idea-main',
        kind: 'note',
        position: { x: 400, y: 200 },
        text: 'Queued before completed recovery replay',
      },
    }],
  }
}

function addAssetBatch(expectedRevision: number): ProfileCommandBatch {
  return {
    version: PROFILE_CONTRACT_VERSIONS.command,
    schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
    expectedRevision,
    actor: { id: 'actor-synthetic', kind: 'user', transport: 'test' },
    clientTxnId: 'txn-add-asset',
    idempotencyKey: 'idempotency-add-asset',
    dryRun: false,
    commands: [{
      version: PROFILE_CONTRACT_VERSIONS.command,
      id: 'command-add-asset',
      name: 'card.asset.add',
      payload: {
        ideaId: 'idea-main',
        cardId: 'card-note',
        asset: SYNTHETIC_PNG_ASSET,
      },
    }],
  }
}

function removeAssetBatch(expectedRevision: number): ProfileCommandBatch {
  return {
    version: PROFILE_CONTRACT_VERSIONS.command,
    schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
    expectedRevision,
    actor: { id: 'actor-synthetic', kind: 'user', transport: 'test' },
    clientTxnId: 'txn-remove-asset',
    idempotencyKey: 'idempotency-remove-asset',
    dryRun: false,
    commands: [{
      version: PROFILE_CONTRACT_VERSIONS.command,
      id: 'command-remove-asset',
      name: 'card.asset.remove',
      payload: {
        ideaId: 'idea-main',
        cardId: 'card-note',
        assetId: SYNTHETIC_PNG_ASSET.id,
      },
    }],
  }
}

function cloneAndResealCandidate(
  generationsRoot: string,
  sourceId: string,
  targetId: string,
  mutate: (candidateDatabase: string) => void,
): void {
  const source = path.join(generationsRoot, sourceId)
  const target = path.join(generationsRoot, targetId)
  cpSync(source, target, { recursive: true, errorOnExist: true })
  const candidateDatabase = path.join(target, 'profile.sqlite')
  mutate(candidateDatabase)
  const databaseBytes = readFileSync(candidateDatabase)
  const manifestPath = path.join(target, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  manifest.candidateId = targetId
  manifest.database = {
    sha256: sha256(databaseBytes),
    size: databaseBytes.length,
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8')
  writeFileSync(manifestPath, manifestBytes)
  const completePath = path.join(target, 'complete.json')
  const complete = JSON.parse(readFileSync(completePath, 'utf8')) as Record<string, unknown>
  complete.candidateId = targetId
  complete.manifestSha256 = sha256(manifestBytes)
  complete.databaseSha256 = sha256(databaseBytes)
  writeFileSync(completePath, JSON.stringify(complete))
}

function mutateDatabase(databasePath: string, sql: string): void {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(sql)
  } finally {
    database.close()
  }
}

function downgradeRecordAxisToOne(databasePath: string): void {
  mutateDatabase(databasePath, `
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;
CREATE TABLE profile_records_legacy (
  profile_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  parent_id TEXT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  record_version INTEGER NOT NULL CHECK (record_version = 1),
  created_revision INTEGER NOT NULL CHECK (created_revision >= 0),
  updated_revision INTEGER NOT NULL CHECK (updated_revision >= created_revision),
  payload_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, record_id)
);
INSERT INTO profile_records_legacy (
  profile_id, record_id, kind, owner_id, parent_id, ordinal, record_version,
  created_revision, updated_revision, payload_json
)
SELECT profile_id, record_id, kind, owner_id, parent_id, ordinal, 1,
       created_revision, updated_revision, payload_json
FROM profile_records;
DROP TABLE profile_records;
ALTER TABLE profile_records_legacy RENAME TO profile_records;
CREATE INDEX profile_records_owner_order
  ON profile_records(profile_id, kind, owner_id, ordinal);
CREATE INDEX profile_records_revision
  ON profile_records(profile_id, updated_revision);
UPDATE profile_meta SET record_version = 1;
COMMIT;
`)
}

function insertRetiredLegacyModInstance(databasePath: string): void {
  mutateDatabase(databasePath, `
INSERT INTO profile_records (
  profile_id, record_id, kind, owner_id, parent_id, ordinal, record_version,
  created_revision, updated_revision, payload_json
) VALUES (
  'profile-synthetic', 'legacy-mod-instance', 'mod-instance', 'board:idea-main',
  'card-note', 0, 1, 7, 7,
  '{"source":{"kind":"direct"},"createdAt":"2026-01-01T00:00:00.000Z","mod":{"id":"legacy-mod","label":"Retired controller","controls":[]}}'
);
`)
}

function insertRetiredLegacyCardMod(databasePath: string): void {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database.prepare(`
SELECT payload_json
FROM profile_records
WHERE profile_id = 'profile-synthetic'
  AND record_id = 'card-note'
  AND kind = 'card'
`).get() as { payload_json?: unknown } | undefined
    if (!row || typeof row.payload_json !== 'string') {
      throw new Error('Synthetic legacy Card record is missing')
    }
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    database.prepare(`
UPDATE profile_records
SET payload_json = ?
WHERE profile_id = 'profile-synthetic'
  AND record_id = 'card-note'
  AND kind = 'card'
`).run(JSON.stringify({
      ...payload,
      mod: {
        id: 'legacy-mod',
        label: 'Retired controller',
        controls: [],
      },
    }))
  } finally {
    database.close()
  }
}

function finalBlobPath(databasePath: string): string {
  const digest = sha256(assetBytes())
  return path.join(`${databasePath}.blobs`, 'sha256', digest.slice(0, 2), digest)
}

function assetBytes(): Buffer {
  return Buffer.from(
    SYNTHETIC_PNG_ASSET.dataUrl.slice(SYNTHETIC_PNG_ASSET.dataUrl.indexOf(',') + 1),
    'base64',
  )
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
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
