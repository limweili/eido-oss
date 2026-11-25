import { DatabaseSync } from 'node:sqlite'
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSeedMod } from '../src/mods'
import type { ProfileAgentCommandRequest } from '../src/persistence/profileAgentCommandPlan'
import {
  createProfileCapabilities,
  PROFILE_CONTRACT_VERSIONS,
  type ProfileCommandBatch,
  type ProfileSnapshot,
} from '../src/persistence/profileServiceContract'
import {
  acquireSqliteProfileOwner,
  type SqliteProfileOwnerCoordinator,
} from './sqliteProfileOwnerCoordinator'
import {
  createSqliteRuntimeOpener,
  openSqliteExclusiveRuntime,
  type SqliteDatabase,
  type SqliteRuntime,
} from './sqliteRuntime'

const disposableRoots: string[] = []
const coordinators: SqliteProfileOwnerCoordinator[] = []
const openTestRuntime = createSqliteRuntimeOpener({
  openDatabase: (location) => new DatabaseSync(location) as unknown as SqliteDatabase,
})

afterEach(async () => {
  await Promise.allSettled(coordinators.splice(0).map((coordinator) => coordinator.close()))
  for (const root of disposableRoots.splice(0)) {
    const expectedPrefix = path.join(tmpdir(), 'eido-460-owner-')
    if (!root.startsWith(expectedPrefix)) throw new Error('Refusing to remove an unexpected test directory')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('SQLite Profile mutable-owner coordinator (#460)', () => {
  it('serializes a request-only Agent dry-run and commit under the owner FIFO', async () => {
    const coordinator = acquire(
      disposableDatabasePath(),
      'owner-agent-command',
      'agent',
      assetFreeSnapshot(),
    )
    const request = coordinatorAgentCreateRequest()

    const [dryRun, committed] = await Promise.all([
      coordinator.applyAgentCommandBatch({ ...request, dryRun: true }, 'cli'),
      coordinator.applyAgentCommandBatch(request, 'cli'),
    ])

    expect(dryRun).toMatchObject({
      ok: true,
      value: { previousRevision: 7, revision: 7, proposedRevision: 8, dryRun: true },
    })
    expect(committed).toMatchObject({
      ok: true,
      value: { previousRevision: 7, revision: 8, proposedRevision: 8, dryRun: false },
    })
    expect(coordinator.recoveryHighWaterRevision()).toBe(8)
  })

  it('admits one installed Mod command through the owner FIFO', async () => {
    const coordinator = acquire(
      disposableDatabasePath(),
      'owner-agent-mod-command',
      'mod',
      assetFreeSnapshot(),
    )
    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'coordinator-agent-mod-create',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'coordinator-agent-create-template',
        name: 'mod-template.create',
        payload: {
          templateId: 'mod-template-coordinator',
          mod: createSeedMod('switch', {
            title: 'COORDINATOR MOD',
            createId: (role, ordinal) => `coordinator-${role}-${ordinal}`,
          }),
        },
      }],
    }

    const [dryRun, committed] = await Promise.all([
      coordinator.applyAgentCommandBatch({ ...request, dryRun: true }, 'cli'),
      coordinator.applyAgentCommandBatch(request, 'cli'),
    ])

    expect(dryRun).toMatchObject({
      ok: true,
      value: {
        version: 5,
        previousRevision: 7,
        revision: 7,
        proposedRevision: 8,
        dryRun: true,
      },
    })
    expect(committed).toMatchObject({
      ok: true,
      value: {
        version: 5,
        previousRevision: 7,
        revision: 8,
        proposedRevision: 8,
        effects: { intentEvents: 0, profileAgentEvents: 1 },
        dryRun: false,
      },
    })
    expect(coordinator.recoveryHighWaterRevision()).toBe(8)
  })

  it('recovery-gates the owner after uncertain Agent transaction cleanup', async () => {
    const databasePath = disposableDatabasePath()
    const seeded = acquire(databasePath, 'owner-agent-seed', 's', assetFreeSnapshot())
    await seeded.close()

    let injectUncertainCleanup = false
    const openUncertainRuntime = (location: string): SqliteRuntime => {
      const runtime = openTestRuntime(location)
      return {
        ...runtime,
        transaction: (mode, operation) => {
          if (injectUncertainCleanup && mode === 'write') {
            throw new AggregateError(
              [new Error('synthetic transaction failure'), new Error('synthetic rollback failure')],
              'synthetic uncertain cleanup',
            )
          }
          return runtime.transaction(mode, operation)
        },
        close: () => runtime.close(),
      }
    }
    const acquired = acquireSqliteProfileOwner({
      ...ownerOptions(databasePath, 'owner-agent-uncertain', 'u'),
      openProfileRuntime: openUncertainRuntime,
      createIntentEventId: () => 'event-owner-agent-uncertain',
    })
    if (!acquired.ok) throw new Error(`Expected owner acquisition, received ${acquired.code}`)
    coordinators.push(acquired.value)
    injectUncertainCleanup = true

    expect(await acquired.value.applyAgentCommandBatch(coordinatorAgentCreateRequest(), 'cli'))
      .toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    expect(acquired.value.recoveryHighWaterRevision()).toBe(7)
    expect(await acquired.value.status()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    expect(await acquired.value.applyAgentCommandBatch({
      ...coordinatorAgentCreateRequest(),
      idempotencyKey: 'coordinator-agent-after-uncertain',
    }, 'cli')).toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
  })

  it('exposes the canonical recovery high-water even when no candidate carries it', async () => {
    const coordinator = acquire(
      disposableDatabasePath(),
      'owner-high-water',
      'h',
      assetFreeSnapshot(),
    )

    expect(coordinator.recoveryHighWaterRevision()).toBe(7)
    expect(await coordinator.recover({ mode: 'inspect' })).toMatchObject({
      ok: true,
      value: { candidates: [] },
    })
    expect(await coordinator.applyCommandBatch(updateBatch('high-water', 7, 'Advance high-water')))
      .toMatchObject({ ok: true, value: { revision: 8 } })
    expect(coordinator.recoveryHighWaterRevision()).toBe(8)
  })

  it('coordinates path aliases through one exclusive sidecar and releases it handle-locally', async () => {
    const root = disposableRoot()
    const storage = path.join(root, 'storage')
    const alias = path.join(root, 'alias')
    mkdirSync(storage)
    symlinkSync(storage, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const databasePath = path.join(storage, 'profile.sqlite')
    const aliasPath = path.join(alias, 'profile.sqlite')
    const first = acquire(
      databasePath,
      'owner-a',
      'a',
      assetFreeSnapshot(),
      'active-owner',
    )
    expect(await first.status()).toMatchObject({
      ok: true,
      value: { owner: { mode: 'mutable', route: 'active-owner' } },
    })

    expect(acquireSqliteProfileOwner(ownerOptions(aliasPath, 'owner-b', 'b'))).toMatchObject({
      ok: false,
      code: 'busy',
    })

    await first.close()
    const second = acquire(aliasPath, 'owner-b', 'b')
    expect(second.owner).toEqual({
      ownerId: 'owner-b',
      generation: 2,
      route: 'exclusive-headless-owner',
    })
  })

  it('rejects an unknown route before creating authority files', () => {
    const databasePath = disposableDatabasePath()
    expect(acquireSqliteProfileOwner({
      ...ownerOptions(databasePath, 'owner-invalid', 'x'),
      route: 'escaped-route' as never,
      seed: assetFreeSnapshot(),
    })).toMatchObject({ ok: false, code: 'invalid' })
    expect(existsSync(databasePath)).toBe(false)
    expect(existsSync(`${databasePath}.owner.sqlite`)).toBe(false)
  })

  it('serializes commit, replay, and stale conflict before admitting the current revision', async () => {
    const coordinator = acquire(disposableDatabasePath(), 'owner-a', 'a', assetFreeSnapshot())
    const batchK = updateBatch('k', 7, 'First queued edit')
    const staleL = updateBatch('l', 7, 'Second queued edit')

    const [committed, replayed, conflicted, inspected] = await Promise.all([
      coordinator.applyCommandBatch(batchK),
      coordinator.applyCommandBatch(batchK),
      coordinator.applyCommandBatch(staleL),
      coordinator.query({
        recordKinds: ['block'],
        recordIds: ['block-note'],
        projection: ['text'],
      }),
    ])

    expect(committed).toMatchObject({ ok: true, value: { revision: 8, replayed: false } })
    expect(replayed).toMatchObject({ ok: true, value: { revision: 8, replayed: true } })
    expect(conflicted).toMatchObject({ ok: false, code: 'conflict', currentRevision: 8 })
    expect(inspected).toMatchObject({
      ok: true,
      value: {
        revision: 8,
        items: [{ recordId: 'block-note', payload: { text: 'First queued edit' } }],
      },
    })
    expect(await coordinator.capabilities()).toEqual({
      ok: true,
      value: createProfileCapabilities('sqlite'),
    })
    expect(await coordinator.applyCommandBatch({
      ...staleL,
      expectedRevision: 8,
    })).toMatchObject({ ok: true, value: { previousRevision: 8, revision: 9 } })
  })

  it('retains the sidecar across a drained Profile maintenance transition', async () => {
    const databasePath = disposableDatabasePath()
    const coordinator = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const accepted = coordinator.applyCommandBatch(updateBatch('k', 7, 'Queued before maintenance'))
    const transitioned = coordinator.transitionProfileStorage(async () => {
      expect(await coordinator.status()).toMatchObject({ ok: false, code: 'busy' })
      expect(await coordinator.snapshot()).toMatchObject({ ok: false, code: 'busy' })
      expect(await coordinator.query({ recordKinds: ['idea'] })).toMatchObject({ ok: false, code: 'busy' })
      expect(await coordinator.capabilities()).toMatchObject({ ok: false, code: 'busy' })
      expect(acquireSqliteProfileOwner(ownerOptions(databasePath, 'owner-b', 'b'))).toMatchObject({
        ok: false,
        code: 'busy',
      })
      return 'reopened'
    })

    expect(await accepted).toMatchObject({ ok: true, value: { revision: 8 } })
    expect(await transitioned).toEqual({ ok: true, value: 'reopened' })
    expect(await coordinator.applyCommandBatch(updateBatch('l', 8, 'After maintenance')))
      .toMatchObject({ ok: true, value: { revision: 9 } })
  })

  it('refuses a future persisted head before any Profile-schema write or recovery fallback', async () => {
    const databasePath = disposableDatabasePath()
    const first = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    await first.close()

    const mutator = new DatabaseSync(databasePath)
    mutator.prepare('UPDATE profile_meta SET record_version = ?')
      .run(PROFILE_CONTRACT_VERSIONS.record + 1)
    const before = persistedProfileShape(mutator)
    mutator.close()

    const result = acquireSqliteProfileOwner(ownerOptions(databasePath, 'owner-b', 'b'))
    expect(result).toMatchObject({
      ok: false,
      code: 'unsupported-future-version',
      retryable: false,
      supportedVersions: PROFILE_CONTRACT_VERSIONS,
    })

    const observer = new DatabaseSync(databasePath, { readOnly: true })
    expect(persistedProfileShape(observer)).toEqual(before)
    observer.close()
  })

  it('does not reopen admission when close is requested during maintenance', async () => {
    const coordinator = acquire(
      disposableDatabasePath(),
      'owner-a',
      'a',
      assetFreeSnapshot(),
    )
    let releaseMaintenance!: () => void
    let enteredMaintenance!: () => void
    const release = new Promise<void>((resolve) => { releaseMaintenance = resolve })
    const entered = new Promise<void>((resolve) => { enteredMaintenance = resolve })
    const transition = coordinator.transitionProfileStorage(async () => {
      enteredMaintenance()
      await release
      return 'finished'
    })
    await entered

    const closing = coordinator.close()
    releaseMaintenance()

    expect(await transition).toEqual({ ok: true, value: 'finished' })
    expect(await coordinator.applyCommandBatch(updateBatch('late', 7, 'Too late')))
      .toMatchObject({ ok: false, code: 'busy' })
    await closing
  })

  it('rejects a closed prior session after handoff without mutating retained state', async () => {
    const databasePath = disposableDatabasePath()
    const first = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    const committed = updateBatch('k', 7, 'Acknowledged before handoff')
    expect(await first.applyCommandBatch(committed)).toMatchObject({ ok: true, value: { revision: 8 } })
    await first.close()
    const second = acquire(databasePath, 'owner-b', 'b')
    const before = await second.snapshot()

    expect(await first.applyCommandBatch(updateBatch('l', 8, 'Stale owner edit')))
      .toMatchObject({ ok: false, code: 'busy' })
    expect(await second.snapshot()).toEqual(before)
    expect(await second.applyCommandBatch(committed)).toMatchObject({
      ok: true,
      value: { revision: 8, replayed: true },
    })
  })

  it.each([
    ['status', 'Profile'],
    ['snapshot', 'Profile'],
    ['status', 'sidecar'],
    ['snapshot', 'sidecar'],
  ] as const)(
    '%s never reports healthy after the live %s authority gains another link',
    async (operation, authorityFile) => {
      const databasePath = disposableDatabasePath()
      const coordinator = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
      const authorityPath = authorityFile === 'Profile'
        ? databasePath
        : `${databasePath}.owner.sqlite`
      linkSync(authorityPath, `${authorityPath}.unexpected-link`)

      const result = operation === 'status'
        ? await coordinator.status()
        : await coordinator.snapshot()
      expect(result).toMatchObject({
        ok: false,
        code: 'corrupt-or-recovery-required',
      })
      if (authorityFile === 'Profile') {
        expect(await coordinator.recover({ mode: 'inspect' })).toMatchObject({
          ok: true,
          value: { mode: 'inspect' },
        })
      }
    },
  )

  it.each(['status', 'snapshot'] as const)(
    '%s reports recovery-required when the live Profile fence is tampered',
    async (operation) => {
      const databasePath = disposableDatabasePath()
      const coordinator = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
      const mutator = new DatabaseSync(databasePath)
      try {
        mutator.exec(`
UPDATE profile_owner_fence
SET owner_token = 'tampered-owner-token'
`)
      } finally {
        mutator.close()
      }

      const result = operation === 'status'
        ? await coordinator.status()
        : await coordinator.snapshot()
      expect(result).toMatchObject({
        ok: false,
        code: 'corrupt-or-recovery-required',
      })
    },
  )

  it('fails closed when an existing Profile loses its sidecar or gains a hard-link alias', async () => {
    const databasePath = disposableDatabasePath()
    const coordinator = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    await coordinator.close()
    unlinkSync(`${databasePath}.owner.sqlite`)
    expect(acquireSqliteProfileOwner(ownerOptions(databasePath, 'owner-b', 'b'))).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })

    const replacementPath = disposableDatabasePath()
    const replacement = acquire(replacementPath, 'owner-c', 'c', assetFreeSnapshot())
    await replacement.close()
    linkSync(replacementPath, `${replacementPath}.hard-link`)
    expect(acquireSqliteProfileOwner(ownerOptions(replacementPath, 'owner-d', 'd'))).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
  })

  it('retains recovery-only authority after a Profile replacement during fenced store open', async () => {
    const databasePath = disposableDatabasePath()
    const first = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    await first.close()

    const replacementPath = disposableDatabasePath()
    const replacement = acquire(replacementPath, 'owner-r', 'r', assetFreeSnapshot())
    await replacement.close()
    let replaced = false

    const result = acquireSqliteProfileOwner({
      ...ownerOptions(databasePath, 'owner-b', 'b'),
      openProfileRuntime: (location) => {
        if (!replaced) {
          replaced = true
          unlinkSync(location)
          copyFileSync(replacementPath, location)
        }
        return openTestRuntime(location)
      },
    })
    if (!result.ok) throw new Error(`Expected recovery-only acquisition, received ${result.code}`)
    coordinators.push(result.value)
    expect(await result.value.status()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    expect(acquireSqliteProfileOwner(ownerOptions(databasePath, 'owner-c', 'c'))).toMatchObject({
      ok: false,
      code: 'busy',
    })
    expect(replaced).toBe(true)
  })

  it('repairs from the startup safety copy instead of adopting replacement Profile content', async () => {
    const databasePath = disposableDatabasePath()
    const first = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    await first.close()

    const replacementPath = disposableDatabasePath()
    const replacement = acquire(replacementPath, 'owner-r', 'r', assetFreeSnapshot())
    expect(await replacement.applyCommandBatch(updateBatch(
      'replacement-eight',
      7,
      'Content from an untrusted replacement Profile',
    ))).toMatchObject({ ok: true, value: { revision: 8 } })
    await replacement.close()
    let replaced = false

    const result = acquireSqliteProfileOwner({
      ...ownerOptions(databasePath, 'owner-b', 'b'),
      seed: assetFreeSnapshot(),
      openProfileRuntime: (location) => {
        if (!replaced) {
          replaced = true
          unlinkSync(location)
          copyFileSync(replacementPath, location)
        }
        return openTestRuntime(location)
      },
    })
    if (!result.ok) throw new Error(`Expected repaired acquisition, received ${result.code}`)
    coordinators.push(result.value)
    expect(await result.value.status()).toMatchObject({ ok: true, value: { revision: 8 } })
    expect(await result.value.snapshot()).toMatchObject({
      ok: true,
      value: {
        boards: {
          'idea-main': {
            cards: [{ blocks: [{ text: 'Synthetic source note' }] }],
          },
        },
      },
    })
    expect(replaced).toBe(true)
  })

  it('rebinds a healthy Profile when only its persisted device number drifted', async () => {
    const databasePath = disposableDatabasePath()
    const first = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    expect(await first.applyAgentCommandBatch(coordinatorAgentCreateRequest(), 'cli'))
      .toMatchObject({ ok: true, value: { revision: 8, version: 5 } })
    const before = await first.snapshot()
    await first.close()

    const actualDevice = lstatSync(databasePath, { bigint: true }).dev
    const sidecarPath = `${databasePath}.owner.sqlite`
    const sidecar = new DatabaseSync(sidecarPath)
    sidecar.prepare(`
UPDATE profile_owner_generation
SET profile_device = ?
WHERE identity = 1
`).run((actualDevice + 1n).toString())
    sidecar.close()

    const reopened = acquire(databasePath, 'owner-b', 'b', assetFreeSnapshot())
    expect(await reopened.status()).toMatchObject({ ok: true, value: { revision: 8 } })
    expect(await reopened.snapshot()).toEqual(before)
    await reopened.close()

    const observer = new DatabaseSync(sidecarPath, { readOnly: true })
    expect(observer.prepare(`
SELECT profile_device FROM profile_owner_generation WHERE identity = 1
`).get()).toEqual({ profile_device: actualDevice.toString() })
    observer.close()
  })

  it.each(['profile_inode', 'profile_birthtime'] as const)(
    'does not rebind device drift when %s also changed',
    async (changedField) => {
      const databasePath = disposableDatabasePath()
      const first = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
      await first.close()

      const identity = lstatSync(databasePath, { bigint: true })
      const changedValue = changedField === 'profile_inode'
        ? identity.ino + 1n
        : identity.birthtimeNs + 1n
      const sidecar = new DatabaseSync(`${databasePath}.owner.sqlite`)
      sidecar.prepare(`
UPDATE profile_owner_generation
SET profile_device = ?, ${changedField} = ?
WHERE identity = 1
`).run((identity.dev + 1n).toString(), changedValue.toString())
      sidecar.close()

      const reopened = acquire(databasePath, 'owner-b', 'b', assetFreeSnapshot())
      expect(await reopened.status()).toMatchObject({
        ok: false,
        code: 'corrupt-or-recovery-required',
      })
    },
  )

  it('does not rebind device drift when strict revision validation fails', async () => {
    const databasePath = disposableDatabasePath()
    const first = acquire(databasePath, 'owner-a', 'a', assetFreeSnapshot())
    expect(await first.applyAgentCommandBatch(coordinatorAgentCreateRequest(), 'cli'))
      .toMatchObject({ ok: true, value: { revision: 8, version: 5 } })
    await first.close()

    const identity = lstatSync(databasePath, { bigint: true })
    const sidecar = new DatabaseSync(`${databasePath}.owner.sqlite`)
    sidecar.prepare(`
UPDATE profile_owner_generation
SET profile_device = ?
WHERE identity = 1
`).run((identity.dev + 1n).toString())
    sidecar.close()
    const profile = new DatabaseSync(databasePath)
    profile.prepare("UPDATE profile_revisions SET receipt_json = '{}' WHERE revision = 8").run()
    profile.close()

    expect(acquireSqliteProfileOwner({
      ...ownerOptions(databasePath, 'owner-b', 'b'),
      seed: assetFreeSnapshot(),
    })).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
  })
})

function acquire(
  databasePath: string,
  ownerId: string,
  tokenSeed: string,
  seed?: ProfileSnapshot,
  route?: 'active-owner' | 'exclusive-headless-owner',
): SqliteProfileOwnerCoordinator {
  let commit = 0
  let event = 0
  const result = acquireSqliteProfileOwner({
    ...ownerOptions(databasePath, ownerId, tokenSeed),
    ...(route ? { route } : {}),
    ...(seed ? { seed } : {}),
    createCommitId: () => `commit-owner-${ownerId}-${++commit}`,
    createIntentEventId: () => `event-owner-${ownerId}-${++event}`,
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

function disposableRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eido-460-owner-'))
  disposableRoots.push(root)
  return root
}

function disposableDatabasePath(): string {
  return path.join(disposableRoot(), 'profile.sqlite')
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

function coordinatorAgentCreateRequest(): ProfileAgentCommandRequest {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision: 7,
    idempotencyKey: 'coordinator-agent-create',
    dryRun: false,
    commands: [{
      version: 1,
      id: 'coordinator-agent-create-card',
      name: 'card.create',
      payload: {
        ideaId: 'idea-main',
        kind: 'note',
        position: { x: 400, y: 200 },
        text: 'Created through the owner FIFO',
      },
    }],
  }
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

function persistedProfileShape(database: DatabaseSync): unknown {
  return {
    head: database.prepare(`
SELECT profile_id, current_revision, schema_version, record_version
FROM profile_meta
`).get(),
    schema: database.prepare(`
SELECT type, name, sql
FROM sqlite_schema
WHERE name NOT LIKE 'sqlite_%'
ORDER BY type, name
`).all(),
  }
}
