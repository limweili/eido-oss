import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSeedMod, type Mod } from '../src/mods'
import {
  createDirectProfileModInstance,
  createUserProfileModTemplate,
  stampProfileModTemplate,
  type ProfileModRecord,
} from '../src/persistence/profileModRecords'
import {
  createCompleteProfileFixture,
  createProfileAgentEventFixture,
} from '../src/persistence/fixtures/profileLogicalProjectionFixture'
import { PROFILE_AGENT_EVENT_RECORD_VERSION } from '../src/persistence/profileAgentEvent'
import {
  projectProfileSnapshot,
  validateProfileLogicalDocument,
  type ProfileLogicalDocument,
} from '../src/persistence/profileLogicalProjection'
import {
  executeProfileGatewayRequest,
  type ProfileGatewayService,
} from '../src/persistence/profileAgentGateway'
import {
  GUI_PROFILE_PROJECTION_VERSION,
  type GuiProfileProjectionRequest,
} from '../src/persistence/profileGuiProjection'
import { canonicalProfileJson } from '../src/persistence/profileRevisionKernel'
import type {
  ProfileAgentCommandPlan,
  ProfileAgentCommandRequest,
} from '../src/persistence/profileAgentCommandPlan'
import {
  PROFILE_AGENT_INSTALLED_ACTOR_ID,
  PROFILE_AGENT_COMMAND_RESULT_LIMITS,
  type ProfileAgentCommandBatchReceipt,
} from '../src/persistence/profileAgentCommandInstallation'
import type {
  ProfileCommandBatch,
  ProfileCommandBatchReceipt,
  ProfileIdeaLifecycleReceipt,
  ProfileSnapshot,
} from '../src/persistence/profileServiceContract'
import { PROFILE_CONTRACT_VERSIONS } from '../src/persistence/profileServiceContract'
import {
  issueSqliteProfileOwnershipCapability,
  type SqliteProfileOwnershipCapability,
} from './sqliteProfileOwnerCapability'
import {
  claimSqliteProfileImportStage,
  createSqliteProfileImportStage,
  createSqliteProfileRevisionStore,
  inspectSqliteProfileRevisionDatabase,
} from './sqliteProfileRevisionStore'
import { attachAgentClaimedTransitionEvidence } from './sqliteProfileAgentCommandAudit'
import * as sqliteProfileAgentCommandAudit from './sqliteProfileAgentCommandAudit'
import {
  createSqliteRuntimeOpener,
  openSqliteExclusiveRuntime,
  type SqliteDatabase,
  type SqliteExclusiveRuntime,
  type SqliteRuntime,
} from './sqliteRuntime'

const disposableRoots: string[] = []
const ownershipContexts: Array<{
  runtime: SqliteExclusiveRuntime
  capability: SqliteProfileOwnershipCapability
}> = []
const capabilitiesByProfile = new Map<string, SqliteProfileOwnershipCapability>()
const RECEIPT_CORRUPTIONS: ReadonlyArray<readonly [
  string,
  (receipt: ProfileCommandBatchReceipt) => unknown,
]> = [
  ['row revision', (receipt) => ({ ...receipt, revision: receipt.revision - 1 })],
  ['command element shape', (receipt) => ({ ...receipt, commandIds: [{}] })],
  ['canonical command identity', (receipt) => ({ ...receipt, commandIds: ['command-forged'] })],
  ['event attribution', (receipt) => ({
    ...receipt,
    intentEvents: [{ ...receipt.intentEvents[0]!, actorId: 'actor-forged' }],
  })],
  ['authoritative event identity', (receipt) => ({
    ...receipt,
    intentEvents: [{ ...receipt.intentEvents[0]!, id: 'event-forged', seq: 999 }],
  })],
  ['stored dry-run acknowledgement', (receipt) => ({ ...receipt, dryRun: true })],
]
const LIFECYCLE_RECEIPT_CORRUPTIONS: ReadonlyArray<readonly [
  string,
  (receipt: ProfileIdeaLifecycleReceipt) => ProfileIdeaLifecycleReceipt,
]> = [
  ['target Idea', (receipt) => ({ ...receipt, targetIdeaId: 'idea-ghost' })],
  ['imported assets', (receipt) => ({ ...receipt, importedAssetIds: ['asset-ghost'] })],
]
const PROFILE_AGENT_EVENT_CORRUPTIONS: ReadonlyArray<readonly [
  string,
  (database: DatabaseSync, eventId: string) => void,
]> = [
  ['updated', (database, eventId) => {
    const row = database.prepare(`
SELECT payload_json
FROM profile_records
WHERE record_id = ? AND kind = 'profile-agent-event'
`).get(eventId) as { payload_json?: unknown } | undefined
    if (typeof row?.payload_json !== 'string') throw new Error('Profile Agent event fixture is missing')
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    database.prepare(`
UPDATE profile_records
SET payload_json = ?
WHERE record_id = ?
`).run(canonicalProfileJson({ ...payload, templateId: 'mod-template-rewritten' }), eventId)
  }],
  ['deleted', (database, eventId) => {
    database.prepare('DELETE FROM profile_records WHERE record_id = ?').run(eventId)
  }],
  ['duplicated', (database, eventId) => {
    const row = database.prepare(`
SELECT profile_id, owner_id, parent_id, ordinal, record_version,
       created_revision, updated_revision, payload_json
FROM profile_records
WHERE record_id = ? AND kind = 'profile-agent-event'
`).get(eventId) as {
      profile_id?: unknown
      owner_id?: unknown
      parent_id?: unknown
      ordinal?: unknown
      record_version?: unknown
      created_revision?: unknown
      updated_revision?: unknown
      payload_json?: unknown
    } | undefined
    if (!row
      || typeof row.profile_id !== 'string'
      || typeof row.owner_id !== 'string'
      || typeof row.parent_id !== 'string'
      || !Number.isSafeInteger(row.ordinal)
      || !Number.isSafeInteger(row.record_version)
      || !Number.isSafeInteger(row.created_revision)
      || !Number.isSafeInteger(row.updated_revision)
      || typeof row.payload_json !== 'string') {
      throw new Error('Profile Agent event fixture is missing')
    }
    const duplicateId = `${eventId}-duplicate`
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    database.prepare(`
INSERT INTO profile_records (
  profile_id, record_id, kind, owner_id, parent_id, ordinal, record_version,
  created_revision, updated_revision, payload_json
) VALUES (?, ?, 'profile-agent-event', ?, ?, ?, ?, ?, ?, ?)
`).run(
      row.profile_id,
      duplicateId,
      row.owner_id,
      row.parent_id,
      Number(row.ordinal) + 1,
      Number(row.record_version),
      Number(row.created_revision),
      Number(row.updated_revision),
      canonicalProfileJson({ ...payload, id: duplicateId }),
    )
  }],
  ['orphaned', (database, eventId) => {
    database.prepare(`
UPDATE profile_records
SET owner_id = 'profile-orphan', parent_id = 'profile-orphan'
WHERE record_id = ?
`).run(eventId)
  }],
  ['coherently re-sequenced', (database, eventId) => {
    const changeRow = database.prepare(`
SELECT revision
FROM profile_agent_command_record_changes
WHERE record_id = ? AND change_kind = 'insert'
`).get(eventId) as { revision?: unknown } | undefined
    if (typeof changeRow?.revision !== 'number' || !Number.isSafeInteger(changeRow.revision)) {
      throw new Error('Profile Agent sequence fixture is missing')
    }
    database.prepare(`
UPDATE profile_records
SET payload_json = json_set(payload_json, '$.seq', 7)
WHERE record_id = ?
`).run(eventId)
    database.prepare(`
UPDATE profile_agent_command_record_changes
SET after_json = json_set(after_json, '$.payload.seq', 7)
WHERE revision = ? AND record_id = ? AND change_kind = 'insert'
`).run(changeRow.revision, eventId)
    rehashAgentChanges(database, changeRow.revision)
  }],
]
const openTestRuntime = createSqliteRuntimeOpener({
  // Build-host Node 22 does not expose Electron 43's defensive constructor option.
  // #521's exact packaged proof owns that boundary; this injection exercises the
  // unchanged runtime transaction/settings path against real disposable SQLite.
  openDatabase: (location) => new DatabaseSync(location) as unknown as SqliteDatabase,
})

afterEach(() => {
  for (const context of ownershipContexts.splice(0)) context.runtime.close()
  capabilitiesByProfile.clear()
  for (const root of disposableRoots.splice(0)) {
    const expectedPrefix = path.join(tmpdir(), 'eido-459-profile-')
    if (!root.startsWith(expectedPrefix)) throw new Error('Refusing to remove an unexpected test directory')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('SQLite transactional Profile revision store (#459)', () => {
  it('stamps distinct trusted Agent sessions on one store without backfilling legacy creation', async () => {
    const databasePath = disposableDatabasePath()
    const agentActor = { client: 'claude-code', sessionId: 'session-agent-provenance' }
    const secondAgentActor = { client: 'codex', sessionId: 'session-agent-provenance-2' }
    let agentTxn = 0
    let intentEvent = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      agentActor,
      createAgentClientTxnId: () => `agent-provenance-txn-${++agentTxn}`,
      createIntentEventId: () => `agent-provenance-intent-${++intentEvent}`,
      now: () => '2026-07-22T01:00:00.000Z',
    })
    const request = agentSingleCreateRequest({
      expectedRevision: 7,
      idempotencyKey: 'agent-provenance-create',
      commandId: 'agent-provenance-create-command',
    })
    const created = await store.applyAgentCommandBatch(request, 'cli')
    expect(created).toMatchObject({ ok: true, value: { revision: 8 } })
    if (!created.ok || created.value.commandResults[0]?.name !== 'card.create') {
      throw new Error('Synthetic Agent Card creation failed')
    }
    const createdCardId = created.value.commandResults[0].cardId
    expect(await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 8,
      idempotencyKey: 'agent-provenance-update',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'agent-provenance-update-command',
        name: 'card.update-content',
        payload: {
          ideaId: 'idea-main',
          cardId: 'card-note',
          blockId: 'block-note',
          text: 'Agent reshaped legacy user work',
        },
      }],
    }, 'cli', secondAgentActor)).toMatchObject({ ok: true, value: { revision: 9 } })
    const afterUpdate = await store.snapshot()
    if (!afterUpdate.ok) throw new Error('Synthetic Agent update snapshot failed')
    const authored = afterUpdate.value.boards['idea-main']!.cards.find((card) => card.id === createdCardId)!
    const legacy = afterUpdate.value.boards['idea-main']!.cards.find((card) => card.id === 'card-note')!
    expect(authored).toMatchObject({
      createdBy: { kind: 'agent', ...agentActor },
      lastModifiedBy: { kind: 'agent', ...agentActor },
    })
    expect(legacy).not.toHaveProperty('createdBy')
    expect(legacy.lastModifiedBy).toEqual({ kind: 'agent', ...secondAgentActor })
    store.close()
  })

  it('projects bounded attributed Agent record changes through the Gateway without user history', async () => {
    const databasePath = disposableDatabasePath()
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      createAgentClientTxnId: () => 'agent-change-trail-txn',
      createIntentEventId: () => 'agent-change-trail-intent',
      now: () => '2026-07-22T02:00:00.000Z',
    })
    const gateway = store as unknown as ProfileGatewayService
    const invoke = (requestId: string, params: Record<string, unknown>) => (
      executeProfileGatewayRequest(gateway, {
        version: 1,
        requestId,
        operation: 'changes.list',
        params,
      })
    )

    await expect(invoke('changes-before-agent', {})).resolves.toMatchObject({
      ok: true,
      result: { revision: 7, items: [], truncated: false },
    })

    const committed = await store.applyAgentCommandBatch(
      agentSingleCreateRequest({
        expectedRevision: 7,
        idempotencyKey: 'agent-change-trail-create',
        commandId: 'agent-change-trail-create-command',
      }),
      'cli',
      { client: 'codex', sessionId: 'session-change-trail' },
    )
    expect(committed).toMatchObject({ ok: true, value: { revision: 8 } })

    const current = await store.logicalDocument()
    if (!current.ok) throw new Error('Synthetic Agent Run source fixture is unavailable')
    const candidate = structuredClone(current.value) as ProfileLogicalDocument
    ;(candidate.head as { revision: number }).revision = 9
    const runRecords = candidate.records as Array<ProfileLogicalDocument['records'][number]>
    const existingIntentEvents = runRecords.filter((record) => (
      record.kind === 'intent-event' && record.ownerId === 'board:idea-main'
    ))
    const nextIntentOrdinal = existingIntentEvents.length
    const nextIntentSeq = existingIntentEvents.reduce((maximum, record) => {
      if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
        return maximum
      }
      return typeof record.payload.seq === 'number' ? Math.max(maximum, record.payload.seq) : maximum
    }, 0) + 1
    const baseRunPayload = {
      startedAt: '2026-07-22T02:00:01.000Z',
      finishedAt: '2026-07-22T02:00:02.000Z',
      askAiCardId: 'card-note',
      model: 'synthetic/model',
      usedCardIds: [],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
      compiledInstruction: 'Synthetic delegated Run.',
      status: 'done',
      kind: 'ask',
    }
    const agentRunPayload = {
      ...baseRunPayload,
      id: 'run-agent-delegated',
      triggeredBy: {
        kind: 'agent',
        client: 'codex-desktop',
        sessionId: 'session-run-submit',
      },
    }
    const userRunPayload = { ...baseRunPayload, id: 'run-user' }
    runRecords.push({
      recordId: 'run-agent-delegated',
      kind: 'run',
      ownerId: 'board:idea-main',
      parentId: 'board:idea-main',
      ordinal: 0,
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      payload: agentRunPayload,
    })
    runRecords.push({
      recordId: 'run-user',
      kind: 'run',
      ownerId: 'board:idea-main',
      parentId: 'board:idea-main',
      ordinal: 1,
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      payload: userRunPayload,
    })
    runRecords.push({
      recordId: 'event-agent-run-started',
      kind: 'intent-event',
      ownerId: 'board:idea-main',
      parentId: 'board:idea-main',
      ordinal: nextIntentOrdinal,
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      payload: {
        id: 'event-agent-run-started',
        at: '2026-07-22T02:00:01.000Z',
        ideaId: 'idea-main',
        type: 'run.started',
        runId: 'run-agent-delegated',
        data: { run: agentRunPayload },
        commitId: 'commit-agent-run',
        actorId: 'actor-gui',
        clientTxnId: 'gui-agent-run-txn',
        seq: nextIntentSeq,
      },
    })
    runRecords.push({
      recordId: 'event-user-run-started',
      kind: 'intent-event',
      ownerId: 'board:idea-main',
      parentId: 'board:idea-main',
      ordinal: nextIntentOrdinal + 1,
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      payload: {
        id: 'event-user-run-started',
        at: '2026-07-22T02:00:01.000Z',
        ideaId: 'idea-main',
        type: 'run.started',
        runId: 'run-user',
        data: { run: userRunPayload },
        commitId: 'commit-user-run',
        actorId: 'actor-gui',
        clientTxnId: 'gui-agent-run-txn',
        seq: nextIntentSeq + 1,
      },
    })
    const guiRequest: GuiProfileProjectionRequest = {
      generation: 1,
      expectedRevision: 8,
      clientTxnId: 'gui-agent-run-txn',
      idempotencyKey: 'gui-agent-run-key',
      committedAt: '2026-07-22T02:00:03.000Z',
      context: { trustedActorId: 'actor-gui', ordinaryNewIdeas: [] },
      projection: {
        projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
        profileId: 'profile-synthetic',
        activeIdeaId: 'idea-main',
        ideas: [],
        boardReplacements: {},
        userModTemplates: [],
        profileSettings: [],
        newModOrigins: {},
      },
    }
    expect(() => validateProfileLogicalDocument(candidate)).not.toThrow()
    expect(await store.commitGuiProjectionRevision({ request: guiRequest, candidate })).toMatchObject({
      ok: true,
      value: {
        revision: 9,
        changedRecordIds: [
          'event-agent-run-started',
          'event-user-run-started',
          'run-agent-delegated',
          'run-user',
        ],
        appendedIntentEventIds: ['event-agent-run-started', 'event-user-run-started'],
      },
    })

    const runOnly = await invoke('changes-run-only', { since: 8 })
    expect(runOnly).toMatchObject({
      ok: true,
      result: {
        revision: 9,
        since: 8,
        items: [{
          revision: 9,
          committedAt: '2026-07-22T02:00:03.000Z',
          actor: { kind: 'agent', client: 'codex-desktop', sessionId: 'session-run-submit' },
          command: { id: 'event-agent-run-started', name: 'run.submit' },
          ideaId: 'idea-main',
          recordId: 'run-agent-delegated',
          recordKind: 'run',
          changeKind: 'insert',
        }],
        truncated: false,
      },
    })
    if (!runOnly.ok || !('result' in runOnly) || !('since' in runOnly.result)
      || runOnly.result.items.length !== 1) {
      throw new Error('Expected attributed Agent Run change')
    }
    const runItemBytes = new TextEncoder().encode(JSON.stringify(runOnly.result.items)).byteLength
    await expect(invoke('changes-run-too-small', {
      since: 8,
      byteLimit: runItemBytes - 1,
    })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })

    const first = await invoke('changes-first', { since: 7, limit: 1 })
    expect(first).toMatchObject({
      ok: true,
      result: {
        revision: 9,
        since: 7,
        items: [{
          revision: 9,
          recordId: 'run-agent-delegated',
          recordKind: 'run',
        }],
        truncated: true,
      },
    })
    if (!first.ok || !('result' in first) || !('since' in first.result)
      || !('nextCursor' in first.result)) {
      throw new Error('Expected bounded Agent change cursor')
    }
    const second = await invoke('changes-second', {
      since: 7,
      limit: 200,
      cursor: first.result.nextCursor,
    })
    expect(second).toMatchObject({
      ok: true,
      result: {
        items: expect.arrayContaining([
          expect.objectContaining({
            recordKind: 'card',
            ideaId: 'idea-main',
            position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
            deepLink: expect.stringContaining('idea=idea-main&card='),
          }),
        ]),
        truncated: false,
      },
    })
    if (!second.ok || !('result' in second) || !('since' in second.result)) {
      throw new Error('Expected command-backed changes')
    }
    const allItems = [...first.result.items, ...second.result.items]
    expect(new Set(allItems.map((item) => `${item.revision}:${item.recordId}`)).size)
      .toBe(allItems.length)
    expect(allItems.filter((item) => item.command.name === 'run.submit')).toHaveLength(1)
    expect(allItems.some((item) => item.command.name === 'card.create')).toBe(true)
    store.close()
  })

  it('rejects a structurally forged future owner before opening or mutating the Profile', () => {
    const databasePath = disposableDatabasePath()
    expect(() => createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: {
        ownerId: 'forged-owner',
        ownerToken: 'forged-token',
        generation: 999,
      } as never,
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
    })).toThrow('SQLite Profile ownership capability was not issued for this Profile')
    expect(existsSync(databasePath)).toBe(false)
  })

  it('rejects a real capability at the wrong Profile path before opening that Profile', () => {
    const issuedDatabasePath = disposableDatabasePath()
    const wrongDatabasePath = disposableDatabasePath()
    const owner = createOwnershipContext(
      issuedDatabasePath,
      1,
      'path-bound-owner-token'.repeat(4),
    )

    expect(() => createSqliteProfileRevisionStore({
      databasePath: wrongDatabasePath,
      ownershipCapability: owner.capability,
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
    })).toThrow('SQLite Profile ownership capability was not issued for this Profile')
    expect(existsSync(wrongDatabasePath)).toBe(false)
  })

  it('refuses retained record-axis 1 before Profile DDL or logical mutation', () => {
    expect(PROFILE_CONTRACT_VERSIONS.record).toBe(2)
    const databasePath = disposableDatabasePath()
    const seeded = createStore(databasePath, assetFreeSnapshot())
    seeded.close()

    const legacy = new DatabaseSync(databasePath)
    legacy.prepare('UPDATE profile_meta SET record_version = 1').run()
    const before = persistedProfileShape(legacy)
    legacy.close()

    let accidentallyOpened: ReturnType<typeof createStore> | undefined
    expect(() => {
      accidentallyOpened = createStore(databasePath)
    }).toThrow(/record_version is invalid/)
    accidentallyOpened?.close()

    const observer = new DatabaseSync(databasePath, { readOnly: true })
    expect(persistedProfileShape(observer)).toEqual(before)
    observer.close()
  })

  it('stores physical record-v2 Profile events while hydrating their event-v1 envelope', async () => {
    expect(PROFILE_CONTRACT_VERSIONS.record).toBe(2)
    expect(PROFILE_AGENT_EVENT_RECORD_VERSION).toBe(1)
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    const event = createProfileAgentEventFixture(seed.profileId)
    seed.profileAgentEvents = [event]

    const seeded = createStore(databasePath, seed)
    expect(await seeded.snapshot()).toMatchObject({
      ok: true,
      value: {
        profileAgentEvents: [{
          recordId: event.recordId,
          recordVersion: PROFILE_AGENT_EVENT_RECORD_VERSION,
          payload: { version: PROFILE_AGENT_EVENT_RECORD_VERSION },
        }],
      },
    })
    seeded.close()

    const physical = new DatabaseSync(databasePath, { readOnly: true })
    expect(physical.prepare(`
SELECT record_version
FROM profile_records
WHERE kind = 'profile-agent-event' AND record_id = ?
`).get(event.recordId)).toEqual({ record_version: PROFILE_CONTRACT_VERSIONS.record })
    physical.close()

    const reopened = createStore(databasePath)
    const logicalDocument = await reopened.logicalDocument()
    expect(logicalDocument).toMatchObject({ ok: true })
    if (!logicalDocument.ok) {
      throw new Error(logicalDocument.message)
    }
    expect(logicalDocument.value.records.find((record) => record.recordId === event.recordId)).toMatchObject({
      kind: 'profile-agent-event',
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
    })
    expect(await reopened.snapshot()).toMatchObject({
      ok: true,
      value: {
        profileAgentEvents: [{
          recordId: event.recordId,
          recordVersion: PROFILE_AGENT_EVENT_RECORD_VERSION,
          payload: { version: PROFILE_AGENT_EVENT_RECORD_VERSION },
        }],
      },
    })
    reopened.close()
  })

  it('commits, reopens, and durably replays one independently addressable revision', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    const store = createStore(databasePath, seed)
    const batch = revisionEightBatch()

    const committed = await store.applyCommandBatch(batch)
    expect(committed).toMatchObject({
      ok: true,
      value: {
        previousRevision: 7,
        revision: 8,
        commitId: 'commit-note-edited',
        affectedIds: ['card-note', 'block-note'],
        replayed: false,
      },
    })
    const block = await store.readRecord('block-note')
    expect(block).toMatchObject({
      ok: true,
      value: {
        kind: 'block',
        recordId: 'block-note',
        createdRevision: 7,
        updatedRevision: 8,
        payload: { id: 'block-note', text: 'Synthetic source note after pending edit', kind: 'line' },
      },
    })
    const card = await store.readRecord('card-note')
    expect(card).toMatchObject({ ok: true, value: { updatedRevision: 7 } })
    const compatibility = await store.readRecord('compatibility:profile-synthetic')
    expect(compatibility).toMatchObject({ ok: true, value: { updatedRevision: 8 } })
    const acknowledged = await store.snapshot()
    expect(acknowledged).toMatchObject({
      ok: true,
      value: {
        revision: 8,
        boards: {
          'idea-main': {
            updatedAt: '2026-01-03T00:00:01.000Z',
            cards: [{ blocks: [{ text: 'Synthetic source note after pending edit' }] }],
            intentLog: [{
              id: 'event-note-edited',
              commitId: 'commit-note-edited',
              actorId: 'actor-synthetic',
              clientTxnId: 'txn-synthetic-3',
            }],
          },
        },
      },
    })
    store.close()

    const reopened = createStore(databasePath)
    expect(await reopened.snapshot()).toEqual(acknowledged)
    const reorderedSemanticBatch = {
      ...batch,
      actor: { transport: 'test', kind: 'user', id: 'actor-synthetic' },
      commands: [{
        ...batch.commands[0]!,
        payload: {
          text: 'Synthetic source note after pending edit',
          blockId: 'block-note',
          cardId: 'card-note',
          ideaId: 'idea-main',
        },
      }],
    }
    const replayed = await reopened.applyCommandBatch(reorderedSemanticBatch)
    expect(replayed).toEqual({
      ok: true,
      value: { ...(committed.ok ? committed.value : neverReceipt()), replayed: true },
    })
    const mismatched = await reopened.applyCommandBatch({
      ...batch,
      commands: [{
        ...batch.commands[0]!,
        payload: { ...batch.commands[0]!.payload, text: 'Different semantic input' },
      }],
    })
    expect(mismatched).toMatchObject({ ok: false, code: 'invalid', currentRevision: 8 })
    const stale = await reopened.applyCommandBatch({
      ...batch,
      idempotencyKey: 'stale-key',
      expectedRevision: 6,
    })
    expect(stale).toMatchObject({ ok: false, code: 'conflict', currentRevision: 8 })
    expect(await reopened.snapshot()).toEqual(acknowledged)
    reopened.close()
  })

  it('dry-runs, commits, replays, rolls back, reopens, and audits one Agent Board journey', async () => {
    const databasePath = disposableDatabasePath()
    let clientTxnSequence = 0
    let intentEventSequence = 0
    let timestampSequence = 0
    const openAgentStore = (beforeCommit?: () => void) => createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      ...(existsSync(databasePath) ? {} : { seed: assetFreeSnapshot() }),
      openRuntime: openTestRuntime,
      now: () => `2026-01-03T00:00:0${++timestampSequence}.000Z`,
      createAgentClientTxnId: () => `agent-client-txn-${++clientTxnSequence}`,
      createIntentEventId: () => `agent-intent-event-${++intentEventSequence}`,
      ...(beforeCommit ? { testHooks: { beforeCommit } } : {}),
    })
    const firstRequest = agentThroughResultRequest()
    let store = openAgentStore()

    const before = await store.logicalDocument()
    const dryRun = await store.applyAgentCommandBatch({ ...firstRequest, dryRun: true }, 'cli')
    expect(dryRun).toMatchObject({
      ok: true,
      value: {
        kind: 'agent-command-batch',
        previousRevision: 7,
        revision: 7,
        proposedRevision: 8,
        commitId: null,
        effects: { inserted: 8, updated: 0, deleted: 0, intentEvents: 5 },
        intentEventIds: [],
        dryRun: true,
        replayed: false,
      },
    })
    if (!dryRun.ok) return
    expect(await store.logicalDocument()).toEqual(before)

    const committed = await store.applyAgentCommandBatch(firstRequest, 'cli')
    expect(committed).toMatchObject({
      ok: true,
      value: {
        previousRevision: 7,
        revision: 8,
        proposedRevision: 8,
        commitId: 'agent:agent-client-txn-1',
        effects: { inserted: 8, updated: 0, deleted: 0, intentEvents: 5 },
        intentEventIds: [
          'agent-intent-event-1',
          'agent-intent-event-2',
          'agent-intent-event-3',
          'agent-intent-event-4',
          'agent-intent-event-5',
        ],
        dryRun: false,
        replayed: false,
      },
    })
    if (!committed.ok) return
    expect(committed.value.commandResults).toEqual(dryRun.value.commandResults)
    expect(committed.value.effects).toEqual(dryRun.value.effects)
    const firstCreatedCardId = committed.value.commandResults[0]?.name === 'card.create'
      ? committed.value.commandResults[0].cardId
      : ''
    expect(firstCreatedCardId).toBe('agent-card-6b6f6ccc1cd4087db446c7d437f90b6b1bca8ce9')
    const snapshot = await store.snapshot()
    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        revision: 8,
        boards: {
          'idea-main': {
            cards: [
              { id: 'card-note' },
              { kind: 'askAi' },
              { kind: 'askAi' },
              { kind: 'result' },
            ],
            connections: [{ role: 'feeds' }, { role: 'feeds' }],
            intentLog: new Array(5).fill(expect.objectContaining({
              actorId: 'local-agent',
              clientTxnId: 'agent-client-txn-1',
            })),
          },
        },
      },
    })
    expect(await store.applyCommandBatch({
      ...revisionEightBatch(),
      expectedRevision: 8,
      idempotencyKey: firstRequest.idempotencyKey,
    })).toMatchObject({ ok: false, code: 'invalid', currentRevision: 8 })

    const legacyAfterAgent = revisionEightBatch()
    const second = await store.applyCommandBatch({
      ...legacyAfterAgent,
      expectedRevision: 8,
      idempotencyKey: 'legacy-after-agent-key',
      clientTxnId: 'legacy-after-agent-txn',
      commands: [{
        ...legacyAfterAgent.commands[0]!,
        id: 'legacy-after-agent-command',
        payload: {
          ...legacyAfterAgent.commands[0]!.payload,
          text: 'Legacy mutation after Agent revision',
        },
      }],
    })
    expect(second).toMatchObject({ ok: true, value: { revision: 9 } })
    store.close()

    store = openAgentStore()
    const replayed = await store.applyAgentCommandBatch(firstRequest, 'cli')
    expect(replayed).toEqual({
      ok: true,
      value: { ...committed.value, replayed: true },
    })
    const firstCommand = firstRequest.commands[0]
    if (!firstCommand
      || firstCommand.name !== 'card.create'
      || !('text' in firstCommand.payload)) throw new Error('Agent fixture changed')
    expect(await store.applyAgentCommandBatch({
      ...firstRequest,
      commands: [{
        ...firstCommand,
        payload: { ...firstCommand.payload, text: 'altered replay' },
      }, ...firstRequest.commands.slice(1)],
    }, 'cli')).toMatchObject({ ok: false, code: 'invalid', currentRevision: 9 })
    expect(await store.applyAgentCommandBatch({
      ...firstRequest,
      idempotencyKey: 'agent-stale-key',
    }, 'cli')).toMatchObject({ ok: false, code: 'conflict', currentRevision: 9 })
    expect(await store.applyAgentCommandBatch(agentSingleCreateRequest({
      expectedRevision: 9,
      idempotencyKey: 'legacy-after-agent-key',
      commandId: 'agent-collides-with-legacy',
    }), 'cli')).toMatchObject({ ok: false, code: 'invalid', currentRevision: 9 })
    store.close()

    const rollbackStore = openAgentStore(() => { throw new Error('synthetic Agent rollback') })
    const rolledBack = await rollbackStore.applyAgentCommandBatch(agentSingleCreateRequest({
      expectedRevision: 9,
      idempotencyKey: 'agent-rollback-key',
      commandId: 'create-rolled-back',
    }), 'cli')
    expect(rolledBack).toMatchObject({ ok: false, code: 'internal', currentRevision: 9 })
    expect(rollbackStore.currentRevision()).toBe(9)
    rollbackStore.close()

    store = openAgentStore()
    expect(store.currentRevision()).toBe(9)
    const deleted = await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 9,
      idempotencyKey: 'agent-delete-key',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'delete-first-created',
        name: 'card.delete',
        payload: { ideaId: 'idea-main', cardId: firstCreatedCardId },
      }],
    }, 'cli')
    expect(deleted).toMatchObject({ ok: true, value: { revision: 10 } })
    store.close()

    rewriteAgentBeforeEvidenceAndDigest(databasePath, 10, firstCreatedCardId)
    const tampered = openAgentStore()
    expect(await tampered.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    tampered.close()
  })

  it('applies an update followed by delete with the same semantics as dry-run', async () => {
    const databasePath = disposableDatabasePath()
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-update-delete-txn',
      createIntentEventId: () => `agent-update-delete-event-${++eventSequence}`,
    })
    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-update-delete-key',
      dryRun: false,
      commands: [
        {
          version: 1,
          id: 'update-before-delete',
          name: 'card.update-content',
          payload: {
            ideaId: 'idea-main',
            cardId: 'card-note',
            blockId: 'block-note',
            text: 'Updated immediately before deletion',
          },
        },
        {
          version: 1,
          id: 'delete-after-update',
          name: 'card.delete',
          payload: { ideaId: 'idea-main', cardId: 'card-note' },
        },
      ],
    }

    const dryRun = await store.applyAgentCommandBatch({ ...request, dryRun: true }, 'cli')
    const applied = await store.applyAgentCommandBatch(request, 'cli')
    expect(dryRun).toMatchObject({
      ok: true,
      value: { effects: { inserted: 0, updated: 0, deleted: 2, intentEvents: 2 } },
    })
    expect(applied).toMatchObject({
      ok: true,
      value: { revision: 8, effects: { inserted: 0, updated: 0, deleted: 2, intentEvents: 2 } },
    })
    if (dryRun.ok && applied.ok) {
      expect(applied.value.commandResults).toEqual(dryRun.value.commandResults)
      expect(applied.value.effects).toEqual(dryRun.value.effects)
    }
    store.close()
  })

  it('applies a Connection meaning update followed by delete as one terminal tombstone', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    seed.boards['idea-main']!.cards.push({
      id: 'card-second-note',
      kind: 'note',
      position: { x: 500, y: 80 },
      blocks: [{ id: 'block-second-note', text: 'Second note', kind: 'line' }],
    })
    seed.boards['idea-main']!.connections.push({
      id: 'connection-note-pair',
      from: { cardId: 'card-note' },
      to: { cardId: 'card-second-note' },
      strength: 'strong',
      polarity: 'helps',
      role: 'feeds',
    })
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed,
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-connection-update-delete-txn',
      createIntentEventId: () => `agent-connection-update-delete-event-${++eventSequence}`,
    })
    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-connection-update-delete-key',
      dryRun: false,
      commands: [
        {
          version: 1,
          id: 'update-connection-before-delete',
          name: 'connection.update-meaning',
          payload: {
            ideaId: 'idea-main',
            connectionId: 'connection-note-pair',
            strength: 'weak',
            reason: 'Transient meaning before deletion',
          },
        },
        {
          version: 1,
          id: 'delete-connection-after-update',
          name: 'connection.delete',
          payload: { ideaId: 'idea-main', connectionId: 'connection-note-pair' },
        },
      ],
    }

    const dryRun = await store.applyAgentCommandBatch({ ...request, dryRun: true }, 'cli')
    const applied = await store.applyAgentCommandBatch(request, 'cli')
    expect(dryRun).toMatchObject({
      ok: true,
      value: { effects: { inserted: 0, updated: 0, deleted: 1, intentEvents: 2 } },
    })
    expect(applied).toMatchObject({
      ok: true,
      value: { revision: 8, effects: { inserted: 0, updated: 0, deleted: 1, intentEvents: 2 } },
    })
    store.close()
  })

  it('folds a Connection meaning update into an attached Card deletion', async () => {
    const databasePath = disposableDatabasePath()
    const seed = agentConnectedNotesSnapshot()
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed,
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-update-card-delete-txn',
      createIntentEventId: () => `agent-update-card-delete-event-${++eventSequence}`,
    })
    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-update-card-delete-key',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'update-before-card-delete',
        name: 'connection.update-meaning',
        payload: {
          ideaId: 'idea-main',
          connectionId: 'connection-note-pair',
          strength: 'weak',
          reason: 'Updated before its endpoint is removed',
        },
      }, {
        version: 1,
        id: 'delete-attached-card',
        name: 'card.delete',
        payload: { ideaId: 'idea-main', cardId: 'card-note' },
      }],
    }

    expect(await store.applyAgentCommandBatch({ ...request, dryRun: true }, 'cli'))
      .toMatchObject({ ok: true })
    expect(await store.applyAgentCommandBatch(request, 'cli')).toMatchObject({
      ok: true,
      value: { revision: 8, effects: { deleted: 3, intentEvents: 2 } },
    })
    store.close()
    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({ ok: true, value: { head: { revision: 8 } } })
    reopened.close()
  })

  it('folds a newly created Connection into an attached Card deletion without a stray transition', async () => {
    const databasePath = disposableDatabasePath()
    const seed = agentConnectedNotesSnapshot()
    seed.boards['idea-main']!.connections = []
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed,
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-create-card-delete-txn',
      createIntentEventId: () => `agent-create-card-delete-event-${++eventSequence}`,
    })
    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-create-card-delete-key',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'create-before-card-delete',
        name: 'connection.create',
        payload: {
          ideaId: 'idea-main',
          from: { cardId: 'card-note' },
          to: { cardId: 'card-second-note' },
          strength: 'weak',
          polarity: 'pushesAgainst',
          reason: 'Ephemeral relation',
        },
      }, {
        version: 1,
        id: 'delete-after-connection-create',
        name: 'card.delete',
        payload: { ideaId: 'idea-main', cardId: 'card-note' },
      }],
    }

    expect(await store.applyAgentCommandBatch({ ...request, dryRun: true }, 'cli'))
      .toMatchObject({ ok: true })
    expect(await store.applyAgentCommandBatch(request, 'cli')).toMatchObject({ ok: true })
    store.close()
    const reopened = createStore(databasePath)
    const document = await reopened.logicalDocument()
    expect(document).toMatchObject({ ok: true, value: { head: { revision: 8 } } })
    if (document.ok) {
      expect(document.value.records.some((record) => record.kind === 'connection')).toBe(false)
    }
    reopened.close()
  })

  it('binds repeated equal-length Card updates to distinct content digests', async () => {
    const databasePath = disposableDatabasePath()
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-repeated-content-txn',
      createIntentEventId: () => `agent-repeated-content-event-${++eventSequence}`,
    })
    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-repeated-content-key',
      dryRun: false,
      commands: ['Alpha', 'Bravo'].map((text, index) => ({
        version: 1 as const,
        id: `repeat-content-${index + 1}`,
        name: 'card.update-content' as const,
        payload: { ideaId: 'idea-main', cardId: 'card-note', blockId: 'block-note', text },
      })),
    }

    expect(await store.applyAgentCommandBatch(request, 'cli')).toMatchObject({
      ok: true,
      value: { revision: 8, effects: { updated: 2, intentEvents: 2 } },
    })
    store.close()
    rewriteStoredAgentRequestText(databasePath, 8, 0, 'Omega')
    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('rejects a coherent net-zero Block retarget with rehashed ordinary evidence', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    seed.boards['idea-main']!.cards.push({
      id: 'card-identical-note',
      kind: 'note',
      position: { x: 600, y: 80 },
      blocks: [{ id: 'block-identical-note', text: 'Synthetic source note', kind: 'line' }],
    })
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed,
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-net-zero-retarget-txn',
      createIntentEventId: () => `agent-net-zero-retarget-event-${++eventSequence}`,
    })
    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-net-zero-retarget-key',
      dryRun: false,
      commands: ['Temporary text', 'Synthetic source note'].map((text, index) => ({
        version: 1 as const,
        id: `net-zero-retarget-${index + 1}`,
        name: 'card.update-content' as const,
        payload: {
          ideaId: 'idea-main',
          cardId: 'card-note',
          blockId: 'block-note',
          text,
        },
      })),
    }
    expect(await store.applyAgentCommandBatch(request, 'cli')).toMatchObject({
      ok: true,
      value: { effects: { updated: 0, intentEvents: 2 } },
    })
    store.close()

    rewriteNetZeroAgentBlockTarget(
      databasePath,
      8,
      'card-identical-note',
      'block-identical-note',
    )
    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('audits existing Group add/remove reconciliation and a later folded Card delete', async () => {
    const groupSeed = (): ProfileSnapshot => {
      const seed = assetFreeSnapshot()
      const board = seed.boards['idea-main']!
      board.cards[0] = {
        ...board.cards[0]!,
        position: { x: 100, y: 100 },
      }
      board.cards.push({
        id: 'card-existing-group',
        kind: 'group',
        position: { x: 0, y: 0 },
        size: { width: 600, height: 500 },
        blocks: [],
      }, {
        id: 'card-stale-member',
        kind: 'note',
        position: { x: 900, y: 700 },
        groupId: 'card-existing-group',
        blocks: [{ id: 'block-stale-member', text: 'Outside the Group', kind: 'line' }],
      })
      return seed
    }
    const createRequest = (idempotencyKey: string): ProfileAgentCommandRequest => ({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey,
      dryRun: false,
      commands: [{
        version: 1,
        id: 'create-group-reconciliation-trigger',
        name: 'card.create',
        payload: {
          ideaId: 'idea-main',
          kind: 'note',
          position: { x: 1250, y: 700 },
          text: 'Trigger geometric reconciliation',
        },
      }],
    })

    const firstPath = disposableDatabasePath()
    let eventSequence = 0
    let store = createSqliteProfileRevisionStore({
      databasePath: firstPath,
      ownershipCapability: ownershipCapabilityFor(firstPath),
      seed: groupSeed(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-group-reconcile-txn',
      createIntentEventId: () => `agent-group-reconcile-event-${++eventSequence}`,
    })
    expect(await store.applyAgentCommandBatch(createRequest(
      'agent-group-reconcile-key',
    ), 'cli')).toMatchObject({ ok: true })
    const reconciled = await store.snapshot()
    expect(reconciled).toMatchObject({ ok: true })
    if (reconciled.ok) {
      const cards = reconciled.value.boards['idea-main']!.cards
      expect(cards.find((card) => card.id === 'card-note')?.groupId).toBe('card-existing-group')
      expect(cards.find((card) => card.id === 'card-stale-member')?.groupId).toBeUndefined()
    }
    store.close()
    let reopened = createStore(firstPath)
    expect(await reopened.logicalDocument()).toMatchObject({ ok: true })
    reopened.close()

    const foldedPath = disposableDatabasePath()
    eventSequence = 0
    store = createSqliteProfileRevisionStore({
      databasePath: foldedPath,
      ownershipCapability: ownershipCapabilityFor(foldedPath),
      seed: groupSeed(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-group-delete-txn',
      createIntentEventId: () => `agent-group-delete-event-${++eventSequence}`,
    })
    const folded: ProfileAgentCommandRequest = {
      ...createRequest('agent-group-delete-key'),
      commands: [
        ...createRequest('ignored').commands,
        {
          version: 1,
          id: 'delete-reconciled-card',
          name: 'card.delete',
          payload: { ideaId: 'idea-main', cardId: 'card-note' },
        },
      ],
    }
    expect(await store.applyAgentCommandBatch({ ...folded, dryRun: true }, 'cli'))
      .toMatchObject({ ok: true })
    expect(await store.applyAgentCommandBatch(folded, 'cli')).toMatchObject({ ok: true })
    store.close()
    reopened = createStore(foldedPath)
    expect(await reopened.logicalDocument()).toMatchObject({ ok: true })
    reopened.close()
  })

  it('admits repeated Connection updates that return exactly to the base state', async () => {
    const databasePath = disposableDatabasePath()
    const seed = agentConnectedNotesSnapshot()
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed,
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-repeated-connection-txn',
      createIntentEventId: () => `agent-repeated-connection-event-${++eventSequence}`,
    })
    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-repeated-connection-key',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'connection-to-weak',
        name: 'connection.update-meaning',
        payload: {
          ideaId: 'idea-main',
          connectionId: 'connection-note-pair',
          strength: 'weak',
          reason: 'Temporary',
        },
      }, {
        version: 1,
        id: 'connection-back-to-base',
        name: 'connection.update-meaning',
        payload: {
          ideaId: 'idea-main',
          connectionId: 'connection-note-pair',
          strength: 'strong',
          reason: null,
        },
      }],
    }

    expect(await store.applyAgentCommandBatch({ ...request, dryRun: true }, 'cli'))
      .toMatchObject({ ok: true, value: { effects: { updated: 0, intentEvents: 2 } } })
    expect(await store.applyAgentCommandBatch(request, 'cli'))
      .toMatchObject({ ok: true, value: { effects: { updated: 0, intentEvents: 2 } } })
    store.close()
    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({ ok: true, value: { head: { revision: 8 } } })
    reopened.close()
  })

  it('rejects omission of one nested Output child from a rehashed Agent delete ledger', async () => {
    const databasePath = disposableDatabasePath()
    const fixture = createCompleteProfileFixture()
    fixture.snapshot.boards['idea-main']!.outputs[0]!.resultCardId = 'card-note'
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: fixture.snapshot,
      materializeAsset: fixture.projectAsset,
      hydrateAsset: fixture.hydrateAsset,
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-cascade-omission-txn',
      createIntentEventId: () => 'agent-cascade-omission-event',
    })
    expect(await store.applyAgentCommandBatch(agentCardDeleteRequest(
      'agent-cascade-omission-key',
    ), 'cli')).toMatchObject({ ok: true, value: { revision: 8 } })
    store.close()

    omitAgentDeleteTransitionAndRehash(databasePath, 8, 'follow-up-user-1')
    const reopened = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      hydrateAsset: fixture.hydrateAsset,
      openRuntime: openTestRuntime,
    })
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('rejects a rehashed Highlight tombstone retargeted away from its deleted Card', async () => {
    const databasePath = disposableDatabasePath()
    const fixture = createCompleteProfileFixture()
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: fixture.snapshot,
      materializeAsset: fixture.projectAsset,
      hydrateAsset: fixture.hydrateAsset,
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-cascade-retarget-txn',
      createIntentEventId: () => 'agent-cascade-retarget-event',
    })
    expect(await store.applyAgentCommandBatch(agentCardDeleteRequest(
      'agent-cascade-retarget-key',
    ), 'cli')).toMatchObject({ ok: true, value: { revision: 8 } })
    store.close()

    retargetAgentHighlightTransitionAndRehash(databasePath, 8, 'highlight-1', 'card-ask')
    const reopened = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      hydrateAsset: fixture.hydrateAsset,
      openRuntime: openTestRuntime,
    })
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('rejects a rehashed semantic transition that no Agent command claims', async () => {
    const databasePath = disposableDatabasePath()
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => `agent-unclaimed-txn-${eventSequence + 1}`,
      createIntentEventId: () => `agent-unclaimed-event-${++eventSequence}`,
    })
    expect(await store.applyAgentCommandBatch(agentSingleCreateRequest({
      expectedRevision: 7,
      idempotencyKey: 'agent-unclaimed-first-key',
      commandId: 'agent-unclaimed-create',
    }), 'cli')).toMatchObject({ ok: true, value: { revision: 8 } })
    expect(await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 8,
      idempotencyKey: 'agent-unclaimed-second-key',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'agent-unclaimed-followup-update',
        name: 'card.update-content',
        payload: {
          ideaId: 'idea-main',
          cardId: 'card-note',
          blockId: 'block-note',
          text: 'Advance the head beyond the tampered revision',
        },
      }],
    }, 'cli')).toMatchObject({ ok: true, value: { revision: 9 } })
    store.close()

    injectUnclaimedAgentIdeaTransition(databasePath, 8, 'idea-main')
    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('rejects a rehashed existing-Result identity that disagrees with its routed Connection', async () => {
    const databasePath = disposableDatabasePath()
    const request = agentExistingResultReuseRequest()
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-existing-result-txn',
      createIntentEventId: () => `agent-existing-result-event-${++eventSequence}`,
    })
    expect(await store.applyAgentCommandBatch(request, 'cli')).toMatchObject({
      ok: true,
      value: { revision: 8 },
    })
    store.close()

    const database = new DatabaseSync(databasePath)
    try {
      const row = database.prepare(`
SELECT receipt_json
FROM profile_agent_command_events
WHERE idempotency_key = ?
`).get(request.idempotencyKey) as { receipt_json?: unknown } | undefined
      if (typeof row?.receipt_json !== 'string') throw new Error('Existing Result receipt fixture is missing')
      const receipt = JSON.parse(row.receipt_json) as {
        commandResults: Array<Record<string, unknown>>
      }
      const reused = receipt.commandResults.find((result) => (
        result.name === 'connection.create' && result.resultCreated === false
      ))
      if (!reused) throw new Error('Existing Result command fixture changed')
      reused.resultCardId = 'card-note'
      const receiptJson = canonicalProfileJson(receipt)
      database.prepare(`
UPDATE profile_agent_command_events
SET receipt_json = ?, receipt_digest = ?
WHERE idempotency_key = ?
`).run(
        receiptJson,
        createHash('sha256').update(receiptJson).digest('hex'),
        request.idempotencyKey,
      )
    } finally {
      database.close()
    }

    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it.each(['placement', 'topology'] as const)(
    'rejects a coherently rehashed historical Agent %s rewrite after an unrelated later revision',
    async (rewriteKind) => {
      const databasePath = disposableDatabasePath()
      const seed = rewriteKind === 'placement' ? assetFreeSnapshot() : agentConnectedNotesSnapshot()
      if (rewriteKind === 'topology') seed.boards['idea-main']!.connections = []
      const request: ProfileAgentCommandRequest = rewriteKind === 'placement'
        ? agentSingleCreateRequest({
            expectedRevision: 7,
            idempotencyKey: 'agent-historical-placement-key',
            commandId: 'agent-historical-placement-create',
          })
        : {
            version: 1,
            schemaVersion: 1,
            expectedRevision: 7,
            idempotencyKey: 'agent-historical-topology-key',
            dryRun: false,
            commands: [{
              version: 1,
              id: 'agent-historical-topology-create',
              name: 'connection.create',
              payload: {
                ideaId: 'idea-main',
                from: { cardId: 'card-note' },
                to: { cardId: 'card-second-note' },
              },
            }],
          }
      let eventSequence = 0
      const store = createSqliteProfileRevisionStore({
        databasePath,
        ownershipCapability: ownershipCapabilityFor(databasePath),
        seed,
        openRuntime: openTestRuntime,
        now: () => '2026-01-03T00:00:01.000Z',
        createAgentClientTxnId: () => `agent-historical-${rewriteKind}-txn`,
        createIntentEventId: () => `agent-historical-${rewriteKind}-event-${++eventSequence}`,
      })
      expect(await store.applyAgentCommandBatch(request, 'cli'))
        .toMatchObject({ ok: true, value: { revision: 8 } })
      const later = revisionEightBatch()
      expect(await store.applyCommandBatch({
        ...later,
        expectedRevision: 8,
        idempotencyKey: `later-${rewriteKind}-key`,
        clientTxnId: `later-${rewriteKind}-txn`,
        commands: [{
          ...later.commands[0]!,
          id: `later-${rewriteKind}-command`,
        }],
      })).toMatchObject({ ok: true, value: { revision: 9 } })
      store.close()

      rewriteHistoricalAgentPlacementOrTopology(databasePath, 8, rewriteKind)
      const reopened = createStore(databasePath)
      expect(await reopened.logicalDocument()).toMatchObject({
        ok: false,
        code: 'corrupt-or-recovery-required',
      })
      reopened.close()
    },
  )

  it('anchors a first Agent delete tombstone through a later GUI reinsertion', async () => {
    const databasePath = disposableDatabasePath()
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-first-delete-txn',
      createIntentEventId: () => 'agent-first-delete-event',
    })
    const before = await store.logicalDocument()
    if (!before.ok) throw new Error('First-delete source fixture is unavailable')
    expect(await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-first-delete-key',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'delete-pre-agent-card',
        name: 'card.delete',
        payload: { ideaId: 'idea-main', cardId: 'card-note' },
      }],
    }, 'cli')).toMatchObject({ ok: true, value: { revision: 8 } })
    const afterDelete = await store.logicalDocument()
    if (!afterDelete.ok) throw new Error('First-delete result fixture is unavailable')
    const candidate = structuredClone(afterDelete.value) as ProfileLogicalDocument
    ;(candidate.head as { revision: number }).revision = 9
    const candidateRecords = candidate.records as Array<ProfileLogicalDocument['records'][number]>
    for (const recordId of ['card-note', 'block-note']) {
      const record = before.value.records.find((entry) => entry.recordId === recordId)
      if (!record) throw new Error(`First-delete ${recordId} fixture is missing`)
      candidateRecords.push(structuredClone(record))
    }
    const guiRequest: GuiProfileProjectionRequest = {
      generation: 1,
      expectedRevision: 8,
      clientTxnId: 'gui-reinsert-after-agent-delete-txn',
      idempotencyKey: 'gui-reinsert-after-agent-delete-key',
      committedAt: '2026-01-03T00:00:02.000Z',
      context: { trustedActorId: 'actor-gui', ordinaryNewIdeas: [] },
      projection: {
        projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
        profileId: 'profile-synthetic',
        activeIdeaId: 'idea-main',
        ideas: [],
        boardReplacements: {},
        userModTemplates: [],
        profileSettings: [],
        newModOrigins: {},
      },
    }
    expect(await store.commitGuiProjectionRevision({ request: guiRequest, candidate })).toMatchObject({
      ok: true,
      value: { revision: 9 },
    })
    store.close()

    rewriteAgentBeforeEvidenceAndDigest(databasePath, 8, 'card-note')
    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('rejects rehashed Agent receipt bindings that swap deterministic result identities', async () => {
    const databasePath = disposableDatabasePath()
    const request = agentThroughResultRequest()
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-result-binding-txn',
      createIntentEventId: () => `agent-result-binding-event-${++eventSequence}`,
    })
    expect(await store.applyAgentCommandBatch(request, 'cli')).toMatchObject({
      ok: true,
      value: { revision: 8 },
    })
    store.close()

    const database = new DatabaseSync(databasePath)
    try {
      const row = database.prepare(`
SELECT receipt_json, command_bindings_json
FROM profile_agent_command_events
WHERE idempotency_key = ?
`).get(request.idempotencyKey) as {
        receipt_json?: unknown
        command_bindings_json?: unknown
      } | undefined
      if (typeof row?.receipt_json !== 'string'
        || typeof row.command_bindings_json !== 'string') {
        throw new Error('Agent result-binding fixture is missing')
      }
      const receipt = JSON.parse(row.receipt_json) as {
        commandResults: Array<Record<string, unknown>>
      }
      const firstResult = receipt.commandResults[0]
      const secondResult = receipt.commandResults[1]
      if (firstResult?.name !== 'card.create' || secondResult?.name !== 'card.create') {
        throw new Error('Agent result-binding command fixture changed')
      }
      receipt.commandResults[0] = {
        ...firstResult,
        cardId: secondResult.cardId,
        blockId: secondResult.blockId,
      }
      receipt.commandResults[1] = {
        ...secondResult,
        cardId: firstResult.cardId,
        blockId: firstResult.blockId,
      }
      const bindings = JSON.parse(row.command_bindings_json) as Array<{
        commandId: string
        events: Array<Record<string, unknown>>
      }>
      const firstEvents = bindings[0]?.events
      const secondEvents = bindings[1]?.events
      if (!firstEvents || !secondEvents) {
        throw new Error('Agent result-binding Intent fixture changed')
      }
      bindings[0] = { ...bindings[0]!, events: secondEvents }
      bindings[1] = { ...bindings[1]!, events: firstEvents }
      const receiptJson = canonicalProfileJson(receipt)
      database.prepare(`
UPDATE profile_agent_command_events
SET receipt_json = ?, receipt_digest = ?, command_bindings_json = ?
WHERE idempotency_key = ?
`).run(
        receiptJson,
        createHash('sha256').update(receiptJson).digest('hex'),
        canonicalProfileJson(bindings),
        request.idempotencyKey,
      )
    } finally {
      database.close()
    }

    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('rejects a coherent rewrite of owner-stamped Intent data against command semantics', async () => {
    const databasePath = disposableDatabasePath()
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-intent-binding-txn',
      createIntentEventId: () => 'agent-intent-binding-event',
    })
    const committed = await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-intent-binding-key',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'update-for-intent-binding',
        name: 'card.update-content',
        payload: {
          ideaId: 'idea-main',
          cardId: 'card-note',
          blockId: 'block-note',
          text: 'Intent-bound content',
        },
      }],
    }, 'cli')
    expect(committed).toMatchObject({ ok: true, value: { revision: 8 } })
    if (!committed.ok) return
    const eventId = committed.value.intentEventIds[0]
    if (!eventId) throw new Error('Intent binding fixture has no event')
    store.close()

    rewriteAgentIntentDataAndDigest(databasePath, 8, eventId)
    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('chains a later GUI transition to Agent evidence and rejects a broken digest link', async () => {
    const databasePath = disposableDatabasePath()
    const request = agentSingleCreateRequest({
      expectedRevision: 7,
      idempotencyKey: 'agent-before-gui-key',
      commandId: 'create-before-gui',
    })
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-before-gui-txn',
      createIntentEventId: () => 'agent-before-gui-event',
    })
    const agent = await store.applyAgentCommandBatch(request, 'cli')
    expect(agent).toMatchObject({ ok: true, value: { revision: 8 } })
    if (!agent.ok || agent.value.commandResults[0]?.name !== 'card.create') return
    const cardId = agent.value.commandResults[0].cardId
    const current = await store.logicalDocument()
    if (!current.ok) throw new Error('Agent logical document fixture is unavailable')
    const candidate = structuredClone(current.value) as ProfileLogicalDocument
    ;(candidate.head as { revision: number }).revision = 9
    const card = candidate.records.find((record) => record.recordId === cardId)
    if (!card || card.payload === null
      || typeof card.payload !== 'object' || Array.isArray(card.payload)) {
      throw new Error('Agent-created Card fixture is unavailable')
    }
    const position = card.payload.position
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw new Error('Agent-created Card position fixture is unavailable')
    }
    ;(card as { payload: Record<string, unknown> }).payload = {
      ...card.payload,
      position: { ...position, x: 901 },
    }
    const guiRequest: GuiProfileProjectionRequest = {
      generation: 1,
      expectedRevision: 8,
      clientTxnId: 'gui-after-agent-txn',
      idempotencyKey: 'gui-after-agent-key',
      committedAt: '2026-01-03T00:00:02.000Z',
      context: { trustedActorId: 'actor-gui', ordinaryNewIdeas: [] },
      projection: {
        projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
        profileId: 'profile-synthetic',
        activeIdeaId: 'idea-main',
        ideas: [],
        boardReplacements: {},
        userModTemplates: [],
        profileSettings: [],
        newModOrigins: {},
      },
    }
    expect(await store.commitGuiProjectionRevision({ request: guiRequest, candidate })).toMatchObject({
      ok: true,
      value: { revision: 9, changedRecordIds: [cardId] },
    })
    store.close()

    const healthy = createStore(databasePath)
    expect(await healthy.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 9 } },
    })
    healthy.close()

    const database = new DatabaseSync(databasePath)
    database.prepare(`
UPDATE profile_records
SET created_revision = 7
WHERE record_id = ?
`).run(cardId)
    database.close()
    const badGeneration = createStore(databasePath)
    expect(await badGeneration.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    badGeneration.close()

    const digestDatabase = new DatabaseSync(databasePath)
    digestDatabase.prepare(`
UPDATE profile_records
SET created_revision = 8
WHERE record_id = ?
`).run(cardId)
    digestDatabase.prepare(`
UPDATE profile_gui_projection_record_changes
SET before_digest = ?
WHERE revision = 9 AND record_id = ?
`).run('0'.repeat(64), cardId)
    digestDatabase.close()
    const tampered = createStore(databasePath)
    expect(await tampered.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    tampered.close()
  })

  it('poisons and closes the Agent store after uncertain transaction cleanup', async () => {
    const databasePath = disposableDatabasePath()
    const seeded = createStore(databasePath, assetFreeSnapshot())
    seeded.close()

    let injectUncertainCleanup = false
    let runtimeClosed = false
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
        close: () => {
          runtimeClosed = true
          runtime.close()
        },
      }
    }
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openUncertainRuntime,
      createAgentClientTxnId: () => 'agent-uncertain-txn',
    })
    injectUncertainCleanup = true

    expect(await store.applyAgentCommandBatch(agentSingleCreateRequest({
      expectedRevision: 7,
      idempotencyKey: 'agent-uncertain-key',
      commandId: 'create-after-uncertain-cleanup',
    }), 'cli')).toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    expect(runtimeClosed).toBe(true)
    expect(await store.status()).toMatchObject({ ok: false, code: 'internal' })
    store.close()

    const reopened = createStore(databasePath)
    expect(reopened.currentRevision()).toBe(7)
    reopened.close()
  })

  it('denies oversized durable Agent evidence before mutation', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    seed.boards['idea-main']!.cards[0]!.blocks[0]!.text = 'x'.repeat(
      PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxDurableChangeBytes,
    )
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed,
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-oversized-evidence-txn',
      createIntentEventId: () => 'agent-oversized-evidence-event',
    })
    const before = await store.logicalDocument()

    expect(await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-oversized-evidence-key',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'delete-oversized-card',
        name: 'card.delete',
        payload: { ideaId: 'idea-main', cardId: 'card-note' },
      }],
    }, 'cli')).toMatchObject({
      ok: false,
      code: 'capability-denied',
      currentRevision: 7,
    })
    expect(await store.logicalDocument()).toEqual(before)
    store.close()
  })

  it('rejects oversized stored Agent evidence before reopening it as history', async () => {
    const databasePath = disposableDatabasePath()
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-stored-oversized-txn',
      createIntentEventId: () => 'agent-stored-oversized-event',
    })
    expect(await store.applyAgentCommandBatch(agentSingleCreateRequest({
      expectedRevision: 7,
      idempotencyKey: 'agent-stored-oversized-key',
      commandId: 'create-before-stored-oversized',
    }), 'cli')).toMatchObject({ ok: true, value: { revision: 8 } })
    store.close()

    const database = new DatabaseSync(databasePath)
    database.prepare(`
UPDATE profile_agent_command_record_changes
SET after_json = ?
WHERE revision = 8 AND change_kind = 'insert'
`).run('x'.repeat(PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxDurableChangeBytes + 1))
    database.close()

    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('rejects a coherent v1 Mod request row as outside installed Agent history authority', async () => {
    const databasePath = disposableDatabasePath()
    const request = agentSingleCreateRequest({
      expectedRevision: 7,
      idempotencyKey: 'agent-mod-history-key',
      commandId: 'agent-board-before-mod-rewrite',
    })
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-mod-history-txn',
      createIntentEventId: () => 'agent-mod-history-event',
    })
    expect(await store.applyAgentCommandBatch(request, 'cli')).toMatchObject({ ok: true })
    store.close()

    rewriteStoredAgentRequestAsModCreate(databasePath, 8)
    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('persists dark surface-v2 Mod outcomes without widening the installed v1 surface', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    const seedEvent = createProfileAgentEventFixture(seed.profileId)
    seed.profileAgentEvents = [{
      ...seedEvent,
      payload: { ...seedEvent.payload, seq: 7 },
    }]
    const stampSource = createUserProfileModTemplate({
      profileId: seed.profileId,
      templateId: 'mod-template-stamp-source',
      createdAt: '2026-07-20T00:00:00.000Z',
      mod: switchMod('STAMP SOURCE', ['stamp-source-item']),
    })
    if (!stampSource.ok) throw new Error(stampSource.message)
    seed.modTemplates = [stampSource.value]
    let intentSequence = 0
    let profileEventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed,
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 2,
      now: () => '2026-07-20T00:00:01.000Z',
      createAgentClientTxnId: (() => {
        let sequence = 0
        return () => `agent-dark-v2-txn-${++sequence}`
      })(),
      createIntentEventId: () => `agent-dark-v2-intent-${++intentSequence}`,
      createProfileAgentEventId: () => `agent-dark-v2-profile-event-${++profileEventSequence}`,
    })

    const stamped = await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-dark-v2-stamp',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'stamp-existing-template',
        name: 'mod-instance.stamp',
        payload: {
          ideaId: 'idea-main',
          templateId: 'mod-template-stamp-source',
          expectedTemplateVersion: 1,
          position: { x: 640, y: 320 },
        },
      }],
    }, 'cli')
    if (!stamped.ok) {
      store.close()
      throw new Error(JSON.stringify(stamped))
    }
    expect(stamped).toMatchObject({
      ok: true,
      value: {
        version: 2,
        effects: {
          inserted: 3,
          updated: 0,
          deleted: 0,
          intentEvents: 1,
          profileAgentEvents: 0,
        },
        intentEventIds: ['agent-dark-v2-intent-1'],
        profileAgentEventIds: [],
      },
    })

    const lifecycleRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 8,
      idempotencyKey: 'agent-dark-v2-template-lifecycle',
      dryRun: false,
      commands: [
        {
          version: 1,
          id: 'create-folded-template',
          name: 'mod-template.create',
          payload: {
            templateId: 'mod-template-folded',
            mod: switchMod('FIRST', ['folded-item']),
          },
        },
        {
          version: 1,
          id: 'update-folded-template',
          name: 'mod-template.update',
          payload: {
            templateId: 'mod-template-folded',
            expectedTemplateVersion: 1,
            mod: switchMod('SECOND', ['folded-item']),
          },
        },
        {
          version: 1,
          id: 'delete-folded-template',
          name: 'mod-template.delete',
          payload: { templateId: 'mod-template-folded', expectedTemplateVersion: 2 },
        },
      ],
    } as const
    const lifecycle = await store.applyAgentCommandBatch(lifecycleRequest, 'cli')
    if (!lifecycle.ok) {
      store.close()
      throw new Error(JSON.stringify(lifecycle))
    }
    expect(lifecycle).toMatchObject({
      ok: true,
      value: {
        version: 2,
        effects: {
          inserted: 0,
          updated: 0,
          deleted: 0,
          intentEvents: 0,
          profileAgentEvents: 3,
        },
        intentEventIds: [],
        profileAgentEventIds: [
          'agent-dark-v2-profile-event-1',
          'agent-dark-v2-profile-event-2',
          'agent-dark-v2-profile-event-3',
        ],
      },
    })
    expect(await store.applyAgentCommandBatch(lifecycleRequest, 'cli')).toMatchObject({
      ok: true,
      value: {
        version: 2,
        revision: 9,
        replayed: true,
        profileAgentEventIds: [
          'agent-dark-v2-profile-event-1',
          'agent-dark-v2-profile-event-2',
          'agent-dark-v2-profile-event-3',
        ],
      },
    })
    const document = await store.logicalDocument()
    expect(document).toMatchObject({ ok: true })
    if (!document.ok) return
    const profileEvents = document.value.records.filter((record) => (
      record.kind === 'profile-agent-event'
    ))
    expect(profileEvents).toMatchObject([
      {
        recordId: seedEvent.recordId,
        ordinal: 0,
        payload: { seq: 7 },
      },
      {
        recordId: 'agent-dark-v2-profile-event-1',
        ownerId: seed.profileId,
        parentId: seed.profileId,
        ordinal: 1,
        payload: {
          version: 1,
          id: 'agent-dark-v2-profile-event-1',
          seq: 8,
          profileId: seed.profileId,
          type: 'mod-template.created',
          templateId: 'mod-template-folded',
          templateVersion: 1,
        },
      },
      {
        recordId: 'agent-dark-v2-profile-event-2',
        ordinal: 2,
        payload: {
          type: 'mod-template.updated',
          templateId: 'mod-template-folded',
          previousTemplateVersion: 1,
          newTemplateVersion: 2,
        },
      },
      {
        recordId: 'agent-dark-v2-profile-event-3',
        ordinal: 3,
        payload: {
          type: 'mod-template.deleted',
          templateId: 'mod-template-folded',
          deletedTemplateVersion: 2,
        },
      },
    ])
    expect(document.value.records.some((record) => (
      record.kind === 'mod-template' && record.recordId === 'mod-template-folded'
    ))).toBe(false)
    store.close()

    const reopenedOnInstalledV1 = createStore(databasePath)
    expect(await reopenedOnInstalledV1.applyAgentCommandBatch(lifecycleRequest, 'cli')).toMatchObject({
      ok: true,
      value: {
        version: 2,
        revision: 9,
        replayed: true,
        profileAgentEventIds: [
          'agent-dark-v2-profile-event-1',
          'agent-dark-v2-profile-event-2',
          'agent-dark-v2-profile-event-3',
        ],
      },
    })
    expect(await reopenedOnInstalledV1.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 9,
      idempotencyKey: 'agent-dark-v2-remains-uninstalled',
      dryRun: true,
      commands: [{
        version: 1,
        id: 'uninstalled-template-command',
        name: 'mod-template.create',
        payload: {
          templateId: 'mod-template-still-dark',
          mod: switchMod('STILL DARK', ['still-dark-item']),
        },
      }],
    }, 'cli')).toMatchObject({ ok: false, code: 'capability-denied' })
    expect(await reopenedOnInstalledV1.logicalDocument()).toMatchObject({
      ok: true,
      value: {
        records: expect.arrayContaining([
          expect.objectContaining({
            kind: 'profile-agent-event',
            recordId: 'agent-dark-v2-profile-event-1',
          }),
        ]),
      },
    })
    reopenedOnInstalledV1.close()

    const database = new DatabaseSync(databasePath)
    database.exec(`
UPDATE profile_records
SET ordinal = CASE record_id WHEN 'agent-dark-v2-profile-event-1' THEN 2 ELSE 1 END,
    payload_json = json_set(payload_json, '$.seq',
      CASE record_id WHEN 'agent-dark-v2-profile-event-1' THEN 9 ELSE 8 END)
WHERE record_id IN ('agent-dark-v2-profile-event-1', 'agent-dark-v2-profile-event-2');
UPDATE profile_agent_command_record_changes
SET after_json = json_set(
  after_json,
  '$.ordinal', CASE record_id WHEN 'agent-dark-v2-profile-event-1' THEN 2 ELSE 1 END,
  '$.payload.seq', CASE record_id WHEN 'agent-dark-v2-profile-event-1' THEN 9 ELSE 8 END
)
WHERE revision = 9
  AND record_id IN ('agent-dark-v2-profile-event-1', 'agent-dark-v2-profile-event-2');
`)
    rehashAgentChanges(database, 9)
    database.close()
    const reordered = createStore(databasePath)
    expect(await reordered.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reordered.close()
  })

  it('freezes canonical nested Mod stamp provenance across later GUI template edits and deletion', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    const templateId = 'mod-template-matrix-audit'
    const matrix = createSeedMod('matrix', {
      title: 'MATRIX AUDIT',
      createId: (_role, ordinal) => `matrix-source-${ordinal}`,
    })
    const template = createUserProfileModTemplate({
      profileId: seed.profileId,
      templateId,
      createdAt: '2026-07-20T00:00:00.000Z',
      mod: matrix,
    })
    if (!template.ok) throw new Error(template.message)
    seed.modTemplates = [template.value]
    let timestampSequence = 0
    let clientTxnSequence = 0
    let intentSequence = 0
    const openStore = (initial = false) => createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      ...(initial ? { seed } : {}),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 2,
      now: () => new Date(Date.UTC(2026, 6, 20, 0, 0, timestampSequence++)).toISOString(),
      createAgentClientTxnId: () => `agent-matrix-audit-txn-${++clientTxnSequence}`,
      createIntentEventId: () => `agent-matrix-audit-intent-${++intentSequence}`,
    })
    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-matrix-audit-stamp',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'stamp-matrix-audit',
        name: 'mod-instance.stamp',
        payload: {
          ideaId: 'idea-main',
          templateId,
          expectedTemplateVersion: 1,
          position: { x: 640, y: 320 },
        },
      }],
    }
    const store = openStore(true)
    const planned = await store.applyAgentCommandBatch({ ...request, dryRun: true }, 'cli')
    const committed = await store.applyAgentCommandBatch(request, 'cli')
    if (!planned.ok || !committed.ok
      || planned.value.commandResults[0]?.name !== 'mod-instance.stamp'
      || committed.value.commandResults[0]?.name !== 'mod-instance.stamp') {
      store.close()
      throw new Error('Expected matrix Mod stamp plan and commit to succeed')
    }
    const stampResult = committed.value.commandResults[0]
    expect(committed.value.commandResults).toEqual(planned.value.commandResults)
    expect(stampResult.idMap).toEqual({
      mod: {
        sourceId: templateId,
        instanceId: 'agent-mod-instance-d7ad20075d6ef117788591c855b840233158eff5',
      },
      controls: [
        { sourceId: 'matrix-source-0', instanceId: 'agent-mod-control-50dfcc446878f1436af53b191155bf056d388185' },
        { sourceId: 'matrix-source-1', instanceId: 'agent-mod-control-80288c86396625115a59a03a2608e05562c79963' },
        { sourceId: 'matrix-source-2', instanceId: 'agent-mod-control-8953244fe72a5a207db1dc4b708d0de4426fc565' },
        { sourceId: 'matrix-source-3', instanceId: 'agent-mod-control-3a3f1aaa8bbe2ab534a3d045c67ae15c9e5d2e43' },
        { sourceId: 'matrix-source-4', instanceId: 'agent-mod-control-776a2da91a9d9be7e15455392cc6826d3f4ae4cc' },
      ],
    })
    const stamped = await store.snapshot()
    if (!stamped.ok) throw new Error('Expected stamped matrix snapshot')
    const storedInstance = stamped.value.modInstances.find((candidate) => (
      candidate.recordId === stampResult.instanceId
    ))
    if (!storedInstance || !('idMap' in storedInstance.payload)
      || storedInstance.payload.mod.kind !== 'matrix') {
      throw new Error('Expected stored matrix instance provenance')
    }
    expect(storedInstance.payload.idMap).toEqual(stampResult.idMap)
    expect([
      ...storedInstance.payload.mod.state.rows.map((row) => row.id),
      ...storedInstance.payload.mod.state.cols.map((column) => column.id),
    ]).toEqual(stampResult.idMap.controls.map(({ instanceId }) => instanceId))

    expect(await store.applyAgentCommandBatch(agentSingleCreateRequest({
      expectedRevision: 8,
      idempotencyKey: 'agent-after-matrix-audit',
      commandId: 'create-after-matrix-audit',
    }), 'cli')).toMatchObject({ ok: true, value: { revision: 9 } })
    store.close()

    const healthy = openStore()
    const beforeGuiEdit = await healthy.logicalDocument()
    expect(beforeGuiEdit).toMatchObject({
      ok: true,
      value: { head: { revision: 9 } },
    })
    if (!beforeGuiEdit.ok) throw new Error('Expected matrix stamp history before GUI edit')
    const editedMatrix = createSeedMod('matrix', {
      title: 'MATRIX AUDIT EDITED BY GUI',
      createId: (_role, ordinal) => `matrix-source-${ordinal}`,
    })
    const editCandidate = structuredClone(beforeGuiEdit.value) as ProfileLogicalDocument
    ;(editCandidate.head as { revision: number }).revision = 10
    const editTemplate = editCandidate.records.find((record) => record.recordId === templateId)
    if (!editTemplate || editTemplate.kind !== 'mod-template') {
      throw new Error('Expected matrix template before GUI edit')
    }
    ;(editTemplate as unknown as { payload: typeof template.value.payload }).payload = {
      ...template.value.payload,
      templateVersion: 2,
      updatedAt: '2026-07-20T00:00:10.000Z',
      mod: editedMatrix,
    }
    const guiEditRequest: GuiProfileProjectionRequest = {
      generation: 1,
      expectedRevision: 9,
      clientTxnId: 'gui-edit-after-matrix-stamp-txn',
      idempotencyKey: 'gui-edit-after-matrix-stamp-key',
      committedAt: '2026-07-20T00:00:10.000Z',
      context: { trustedActorId: 'actor-gui', ordinaryNewIdeas: [] },
      projection: {
        projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
        profileId: seed.profileId,
        activeIdeaId: seed.activeIdeaId,
        ideas: [],
        boardReplacements: {},
        userModTemplates: [{ templateId, mod: editedMatrix }],
        profileSettings: [],
        newModOrigins: {},
      },
    }
    expect(await healthy.commitGuiProjectionRevision({
      request: guiEditRequest,
      candidate: editCandidate,
    })).toMatchObject({ ok: true, value: { revision: 10 } })
    healthy.close()

    const afterGuiEdit = openStore()
    const beforeGuiDelete = await afterGuiEdit.logicalDocument()
    expect(beforeGuiDelete).toMatchObject({
      ok: true,
      value: { head: { revision: 10 } },
    })
    if (!beforeGuiDelete.ok) throw new Error('Expected matrix stamp history after GUI edit')
    const deleteCandidate = structuredClone(beforeGuiDelete.value) as ProfileLogicalDocument
    ;(deleteCandidate.head as { revision: number }).revision = 11
    ;(deleteCandidate as { records: ProfileLogicalDocument['records'] }).records =
      deleteCandidate.records.filter((record) => record.recordId !== templateId)
    const guiDeleteRequest: GuiProfileProjectionRequest = {
      ...guiEditRequest,
      expectedRevision: 10,
      clientTxnId: 'gui-delete-after-matrix-stamp-txn',
      idempotencyKey: 'gui-delete-after-matrix-stamp-key',
      committedAt: '2026-07-20T00:00:11.000Z',
      projection: { ...guiEditRequest.projection, userModTemplates: [] },
    }
    expect(await afterGuiEdit.commitGuiProjectionRevision({
      request: guiDeleteRequest,
      candidate: deleteCandidate,
    })).toMatchObject({ ok: true, value: { revision: 11 } })
    afterGuiEdit.close()

    const afterGuiDelete = openStore()
    expect(await afterGuiDelete.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 11 } },
    })
    afterGuiDelete.close()

    rewriteHistoricalMatrixStampProvenance(
      databasePath,
      8,
      stampResult.instanceId,
      committed.value.intentEventIds[0]!,
      [
        'rewritten-source-row-0',
        'rewritten-source-row-1',
        'rewritten-source-column-0',
        'rewritten-source-column-1',
        'rewritten-source-column-2',
      ],
    )
    const tampered = openStore()
    expect(await tampered.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    tampered.close()
  })

  it('mints non-persisted owner context and commits one complete Mod lifecycle', async () => {
    const databasePath = disposableDatabasePath()
    const transactionModes: Array<'read' | 'write'> = []
    let clientTxnSequence = 0
    let timestampSequence = 0
    let intentSequence = 0
    let profileEventSequence = 0
    let beforeCommitCalls = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      agentCommandSurfaceVersion: 2,
      openRuntime: (location) => {
        const runtime = openTestRuntime(location)
        return {
          ...runtime,
          transaction: (mode, operation) => {
            transactionModes.push(mode)
            return runtime.transaction(mode, operation)
          },
          close: () => runtime.close(),
        }
      },
      now: () => new Date(Date.UTC(2026, 6, 20, 0, timestampSequence++)).toISOString(),
      createAgentClientTxnId: () => `agent-mod-lifecycle-txn-${++clientTxnSequence}`,
      createIntentEventId: () => `agent-mod-lifecycle-intent-${++intentSequence}`,
      createProfileAgentEventId: () => `agent-mod-lifecycle-event-${++profileEventSequence}`,
      testHooks: { beforeCommit: () => { beforeCommitCalls += 1 } },
    })
    const templateId = 'mod-template-native-lifecycle'
    const request = (
      expectedRevision: number,
      idempotencyKey: string,
      commands: ProfileAgentCommandRequest['commands'],
    ): ProfileAgentCommandRequest => ({
      version: 1,
      schemaVersion: 1,
      expectedRevision,
      idempotencyKey,
      dryRun: false,
      commands,
    })

    const created = await store.applyAgentCommandBatch(request(7, 'agent-mod-lifecycle-create', [{
      version: 1,
      id: 'create-native-lifecycle-template',
      name: 'mod-template.create',
      payload: {
        templateId,
        mod: switchMod('FIRST NATIVE MEANING', ['native-source-control-first']),
      },
    }]), 'cli')
    expect(created).toMatchObject({
      ok: true,
      value: {
        version: 2,
        revision: 8,
        effects: { intentEvents: 0, profileAgentEvents: 1 },
        intentEventIds: [],
        profileAgentEventIds: ['agent-mod-lifecycle-event-1'],
      },
    })

    const updated = await store.applyAgentCommandBatch(request(8, 'agent-mod-lifecycle-update', [{
      version: 1,
      id: 'update-native-lifecycle-template',
      name: 'mod-template.update',
      payload: {
        templateId,
        expectedTemplateVersion: 1,
        mod: switchMod('SECOND FROZEN MEANING', ['native-source-control-second']),
      },
    }]), 'mcp')
    expect(updated).toMatchObject({
      ok: true,
      value: {
        version: 2,
        revision: 9,
        commandResults: [{
          name: 'mod-template.update',
          templateId,
          previousTemplateVersion: 1,
          newTemplateVersion: 2,
        }],
        effects: { intentEvents: 0, profileAgentEvents: 1 },
        intentEventIds: [],
        profileAgentEventIds: ['agent-mod-lifecycle-event-2'],
      },
    })

    const stampRequest = request(9, 'agent-mod-lifecycle-stamp', [{
        version: 1,
        id: 'stamp-native-lifecycle-instance',
        name: 'mod-instance.stamp',
        payload: {
          ideaId: 'idea-main',
          templateId,
          expectedTemplateVersion: 2,
          position: { x: 640, y: 320 },
        },
      }])
    const before = await store.logicalDocument()
    transactionModes.length = 0

    const dryRun = await store.applyAgentCommandBatch({ ...stampRequest, dryRun: true }, 'cli')

    expect(dryRun).toMatchObject({
      ok: true,
      value: {
        version: 2,
        previousRevision: 9,
        revision: 9,
        proposedRevision: 10,
        commitId: null,
        effects: {
          inserted: 3,
          updated: 0,
          deleted: 0,
          intentEvents: 1,
          profileAgentEvents: 0,
        },
        intentEventIds: [],
        profileAgentEventIds: [],
        dryRun: true,
      },
    })
    expect(transactionModes).toEqual(['read'])
    expect(clientTxnSequence).toBe(3)
    expect(timestampSequence).toBe(4)
    expect(intentSequence).toBe(0)
    expect(profileEventSequence).toBe(2)
    expect(beforeCommitCalls).toBe(2)
    expect(await store.logicalDocument()).toEqual(before)

    const applied = await store.applyAgentCommandBatch(stampRequest, 'cli')

    expect(applied).toMatchObject({
      ok: true,
      value: {
        version: 2,
        previousRevision: 9,
        revision: 10,
        commitId: 'agent:agent-mod-lifecycle-txn-4',
        effects: {
          inserted: 3,
          updated: 0,
          deleted: 0,
          intentEvents: 1,
          profileAgentEvents: 0,
        },
        intentEventIds: ['agent-mod-lifecycle-intent-1'],
        profileAgentEventIds: [],
        dryRun: false,
      },
    })
    if (!dryRun.ok || !applied.ok) {
      store.close()
      throw new Error('Expected Mod stamp dry-run and apply to succeed')
    }
    expect(applied.value.commandResults).toEqual(dryRun.value.commandResults)
    expect(clientTxnSequence).toBe(4)
    expect(timestampSequence).toBe(5)
    expect(intentSequence).toBe(1)
    expect(profileEventSequence).toBe(2)
    expect(beforeCommitCalls).toBe(3)
    const afterStamp = await store.snapshot()
    if (!afterStamp.ok) throw new Error('Expected stamped native lifecycle snapshot')
    const stampResult = applied.value.commandResults[0]
    if (!stampResult || stampResult.name !== 'mod-instance.stamp') {
      throw new Error('Expected native Mod stamp result')
    }
    const stampedInstance = afterStamp.value.modInstances.find((instance) => (
      instance.recordId === stampResult.instanceId
    ))
    if (!stampedInstance) throw new Error('Expected native stamped Mod instance')
    expect(stampedInstance.payload).toMatchObject({
      source: { kind: 'template', templateId, templateVersion: 2 },
      idMap: stampResult.idMap,
      stampedAt: new Date(Date.UTC(2026, 6, 20, 0, 4)).toISOString(),
      mod: { kind: 'switch', title: 'SECOND FROZEN MEANING' },
    })
    const frozenStampedInstance = structuredClone(stampedInstance)

    const deleted = await store.applyAgentCommandBatch(request(10, 'agent-mod-lifecycle-delete', [{
      version: 1,
      id: 'delete-native-lifecycle-template',
      name: 'mod-template.delete',
      payload: { templateId, expectedTemplateVersion: 2 },
    }]), 'cli')
    expect(deleted).toMatchObject({
      ok: true,
      value: {
        version: 2,
        revision: 11,
        effects: { intentEvents: 0, profileAgentEvents: 1 },
        intentEventIds: [],
        profileAgentEventIds: ['agent-mod-lifecycle-event-3'],
      },
    })
    const final = await store.snapshot()
    if (!final.ok) throw new Error('Expected completed native Mod lifecycle snapshot')
    expect(final.value.modTemplates.some((template) => template.recordId === templateId)).toBe(false)
    expect(final.value.modInstances).toContainEqual(frozenStampedInstance)
    expect(final.value.profileAgentEvents?.map((event) => ({
      type: event.payload.type,
      seq: event.payload.seq,
      clientTxnId: event.payload.clientTxnId,
    }))).toEqual([
      { type: 'mod-template.created', seq: 1, clientTxnId: 'agent-mod-lifecycle-txn-1' },
      { type: 'mod-template.updated', seq: 2, clientTxnId: 'agent-mod-lifecycle-txn-2' },
      { type: 'mod-template.deleted', seq: 3, clientTxnId: 'agent-mod-lifecycle-txn-5' },
    ])
    expect(final.value.boards['idea-main']?.intentLog).toEqual([
      expect.objectContaining({
        type: 'card.created',
        cardId: stampResult.cardId,
        clientTxnId: 'agent-mod-lifecycle-txn-4',
      }),
    ])
    expect(clientTxnSequence).toBe(5)
    expect(timestampSequence).toBe(6)
    expect(profileEventSequence).toBe(3)
    expect(beforeCommitCalls).toBe(4)
    store.close()
  })

  it.each(PROFILE_AGENT_EVENT_CORRUPTIONS)(
    'rejects a Profile Agent event that was %s outside its append-only birth',
    async (_corruption, corrupt) => {
      const databasePath = disposableDatabasePath()
      const eventId = 'agent-event-append-only'
      const store = createSqliteProfileRevisionStore({
        databasePath,
        ownershipCapability: ownershipCapabilityFor(databasePath),
        seed: assetFreeSnapshot(),
        openRuntime: openTestRuntime,
        agentCommandSurfaceVersion: 2,
        now: () => '2026-07-20T01:00:00.000Z',
        createAgentClientTxnId: () => 'agent-event-append-only-txn',
        createProfileAgentEventId: () => eventId,
      })
      const created = await store.applyAgentCommandBatch({
        version: 1,
        schemaVersion: 1,
        expectedRevision: 7,
        idempotencyKey: 'agent-event-append-only-key',
        dryRun: false,
        commands: [{
          version: 1,
          id: 'create-template-for-append-only-event',
          name: 'mod-template.create',
          payload: {
            templateId: 'mod-template-append-only-event',
            mod: switchMod('APPEND-ONLY EVENT', ['append-only-item']),
          },
        }],
      }, 'cli')
      if (!created.ok) {
        store.close()
        throw new Error(created.message)
      }
      expect(created).toMatchObject({
        ok: true,
        value: { version: 2, profileAgentEventIds: [eventId] },
      })
      store.close()

      const database = new DatabaseSync(databasePath)
      try {
        corrupt(database, eventId)
      } finally {
        database.close()
      }
      const reopened = createStore(databasePath)
      expect(await reopened.logicalDocument()).toMatchObject({
        ok: false,
        code: 'corrupt-or-recovery-required',
      })
      reopened.close()
    },
  )

  it('rejects a coherent GUI deletion of imported Profile Agent provenance', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    const seedEvent = createProfileAgentEventFixture(seed.profileId)
    seed.profileAgentEvents = [seedEvent]
    const store = createStore(databasePath, seed)
    const current = await store.logicalDocument()
    if (!current.ok) throw new Error('Imported Profile Agent event fixture is unavailable')
    const eventRecord = current.value.records.find((record) => record.recordId === seedEvent.recordId)
    if (!eventRecord) throw new Error('Imported Profile Agent event record is missing')
    const candidate = structuredClone(current.value) as ProfileLogicalDocument
    ;(candidate.head as { revision: number }).revision = 8
    const card = candidate.records.find((record) => record.recordId === 'card-note')
    if (!card || card.payload === null
      || typeof card.payload !== 'object' || Array.isArray(card.payload)) {
      throw new Error('GUI deletion anchor Card fixture is unavailable')
    }
    ;(card as { payload: Record<string, unknown> }).payload = {
      ...card.payload,
      position: { x: 321, y: 123 },
    }
    const guiRequest: GuiProfileProjectionRequest = {
      generation: 1,
      expectedRevision: 7,
      clientTxnId: 'gui-before-imported-event-deletion-txn',
      idempotencyKey: 'gui-before-imported-event-deletion-key',
      committedAt: '2026-07-20T03:00:00.000Z',
      context: { trustedActorId: 'actor-gui', ordinaryNewIdeas: [] },
      projection: {
        projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
        profileId: seed.profileId,
        activeIdeaId: 'idea-main',
        ideas: [],
        boardReplacements: {},
        userModTemplates: [],
        profileSettings: [],
        newModOrigins: {},
      },
    }
    expect(await store.commitGuiProjectionRevision({ request: guiRequest, candidate })).toMatchObject({
      ok: true,
      value: { revision: 8, changedRecordIds: ['card-note'] },
    })
    store.close()

    const database = new DatabaseSync(databasePath)
    try {
      const row = database.prepare(`
SELECT receipt_json
FROM profile_gui_projection_events
WHERE revision = 8
`).get() as { receipt_json?: unknown } | undefined
      if (typeof row?.receipt_json !== 'string') {
        throw new Error('GUI deletion receipt fixture is missing')
      }
      const receipt = JSON.parse(row.receipt_json) as {
        changedRecordIds: string[]
        deletedRecordIds: string[]
      }
      const changedRecordIds = [...receipt.changedRecordIds, seedEvent.recordId].sort()
      const deletedRecordIds = [...receipt.deletedRecordIds, seedEvent.recordId].sort()
      const receiptJson = canonicalProfileJson({
        ...receipt,
        changedRecordIds,
        deletedRecordIds,
      })
      database.prepare(`
UPDATE profile_gui_projection_events
SET receipt_json = ?, changed_record_ids_json = ?
WHERE revision = 8
`).run(receiptJson, canonicalProfileJson(changedRecordIds))
      database.prepare(`
INSERT INTO profile_gui_projection_record_changes (
  profile_id, revision, record_id, change_kind, before_digest, after_digest
) VALUES (?, 8, ?, 'delete', ?, NULL)
`).run(
        seed.profileId,
        seedEvent.recordId,
        createHash('sha256').update(canonicalProfileJson(eventRecord)).digest('hex'),
      )
      database.prepare(`
DELETE FROM profile_records
WHERE profile_id = ? AND record_id = ?
`).run(seed.profileId, seedEvent.recordId)
    } finally {
      database.close()
    }

    const reopened = createStore(databasePath)
    const reopenedDocument = await reopened.logicalDocument()
    reopened.close()
    expect(reopenedDocument).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
  })

  it('rejects an in-place payload rewrite of imported Profile Agent provenance', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    const seedEvent = createProfileAgentEventFixture(seed.profileId)
    if (seedEvent.payload.type !== 'mod-template.deleted') {
      throw new Error('Imported Profile Agent rewrite fixture is unavailable')
    }
    seed.profileAgentEvents = [seedEvent]
    const store = createStore(databasePath, seed)
    store.close()

    const database = new DatabaseSync(databasePath)
    try {
      database.prepare(`
UPDATE profile_records
SET payload_json = ?
WHERE profile_id = ? AND record_id = ?
`).run(
        canonicalProfileJson({
          ...seedEvent.payload,
          deletedTemplateVersion: seedEvent.payload.deletedTemplateVersion + 1,
        }),
        seed.profileId,
        seedEvent.recordId,
      )
    } finally {
      database.close()
    }

    const reopened = createStore(databasePath)
    const reopenedDocument = await reopened.logicalDocument()
    reopened.close()
    expect(reopenedDocument).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
  })

  it('classifies an empty seed Agent event manifest as storage corruption', async () => {
    const databasePath = disposableDatabasePath()
    const store = createStore(databasePath, assetFreeSnapshot())
    store.close()

    const database = new DatabaseSync(databasePath)
    database.prepare(`
UPDATE profile_meta
SET seed_profile_agent_event_manifest_json = ''
`).run()
    database.close()

    const reopened = createStore(databasePath)
    const reopenedDocument = await reopened.logicalDocument()
    reopened.close()
    expect(reopenedDocument).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
  })

  it('reopens a valid seed Agent event manifest larger than one command change-set', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    const event = createProfileAgentEventFixture(seed.profileId)
    seed.profileAgentEvents = Array.from({ length: 7_000 }, (_, index) => {
      const recordId = `profile-agent-event-${'x'.repeat(470)}-${String(index).padStart(6, '0')}`
      return {
        ...event,
        recordId,
        payload: {
          ...event.payload,
          id: recordId,
          seq: index + 1,
        },
      }
    })
    const seeded = createStore(databasePath, seed)
    seeded.close()

    const database = new DatabaseSync(databasePath)
    const manifestSize = database.prepare(`
SELECT length(CAST(seed_profile_agent_event_manifest_json AS BLOB)) AS manifest_bytes
FROM profile_meta
`).get() as { manifest_bytes?: unknown } | undefined
    database.close()
    expect(Number(manifestSize?.manifest_bytes)).toBeGreaterThan(
      PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxDurableChangeBytes,
    )

    const reopened = createStore(databasePath)
    const reopenedDocument = await reopened.logicalDocument()
    reopened.close()
    expect(reopenedDocument).toMatchObject({ ok: true })
    if (!reopenedDocument.ok) throw new Error('Large seed Agent event fixture did not reopen')
    expect(reopenedDocument.value.records.filter((record) => (
      record.kind === 'profile-agent-event'
    ))).toHaveLength(7_000)
  })

  it('rejects coherently rehashed template history when its immutable event is unchanged', async () => {
    const databasePath = disposableDatabasePath()
    let transactionSequence = 0
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 2,
      now: () => '2026-07-20T02:00:00.000Z',
      createAgentClientTxnId: () => `agent-event-rehash-txn-${++transactionSequence}`,
      createProfileAgentEventId: () => `agent-event-rehash-${++eventSequence}`,
    })
    expect(await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-event-rehash-create-key',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'create-template-before-rehash',
        name: 'mod-template.create',
        payload: {
          templateId: 'mod-template-rehash',
          mod: switchMod('ORIGINAL MEANING', ['rehash-item']),
        },
      }],
    }, 'cli')).toMatchObject({ ok: true, value: { revision: 8 } })
    expect(await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 8,
      idempotencyKey: 'agent-event-rehash-delete-key',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'delete-template-before-rehash',
        name: 'mod-template.delete',
        payload: { templateId: 'mod-template-rehash', expectedTemplateVersion: 1 },
      }],
    }, 'cli')).toMatchObject({ ok: true, value: { revision: 9 } })
    store.close()

    rewriteStoredProfileTemplateMeaningAndRehash(
      databasePath,
      'mod-template-rehash',
      'Rewritten meaning',
    )
    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('binds update/delete-only history to idempotency and trusted transport attribution', async () => {
    const databasePath = disposableDatabasePath()
    let eventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => `agent-attribution-txn-${eventSequence + 1}`,
      createIntentEventId: () => `agent-attribution-event-${++eventSequence}`,
    })
    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-attribution-original-key',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'update-before-attribution-delete',
        name: 'card.update-content',
        payload: {
          ideaId: 'idea-main',
          cardId: 'card-note',
          blockId: 'block-note',
          text: 'Transient attribution text',
        },
      }, {
        version: 1,
        id: 'delete-after-attribution-update',
        name: 'card.delete',
        payload: { ideaId: 'idea-main', cardId: 'card-note' },
      }],
    }
    expect(await store.applyAgentCommandBatch(request, 'cli')).toMatchObject({ ok: true })
    expect(await store.applyAgentCommandBatch(agentSingleCreateRequest({
      expectedRevision: 8,
      idempotencyKey: 'agent-attribution-later-key',
      commandId: 'agent-attribution-later-create',
    }), 'cli')).toMatchObject({ ok: true, value: { revision: 9 } })
    store.close()

    rewriteStoredAgentAttribution(
      databasePath,
      8,
      'agent-attribution-rewritten-key',
      'mcp',
    )
    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('admits both-missing Agent tables only for explicit legacy recovery inspection', async () => {
    const databasePath = disposableDatabasePath()
    const seeded = createStore(databasePath, assetFreeSnapshot())
    seeded.close()

    const legacyDatabase = new DatabaseSync(databasePath)
    legacyDatabase.exec(`
DROP TABLE profile_agent_command_record_changes;
DROP TABLE profile_agent_command_events;
`)
    legacyDatabase.close()

    expect(() => inspectSqliteProfileRevisionDatabase({
      databasePath,
      openRuntime: openTestRuntime,
    })).toThrow(/Agent/)
    expect(inspectSqliteProfileRevisionDatabase({
      databasePath,
      openRuntime: openTestRuntime,
      legacyReadOnlyRecovery: true,
    })).toMatchObject({ profileId: 'profile-synthetic', revision: 7 })

    const migrated = createStore(databasePath)
    expect(await migrated.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 7 } },
    })
    migrated.close()

    const partialDatabase = new DatabaseSync(databasePath)
    partialDatabase.exec('DROP TABLE profile_agent_command_record_changes')
    partialDatabase.close()
    expect(() => inspectSqliteProfileRevisionDatabase({
      databasePath,
      openRuntime: openTestRuntime,
      legacyReadOnlyRecovery: true,
    })).toThrow(/Agent/)
    expect(() => createStore(databasePath)).toThrow(/Agent/)
  })

  it('refuses a missing seed manifest on the current record-kind schema before mutation', () => {
    const databasePath = disposableDatabasePath()
    const seeded = createStore(databasePath, assetFreeSnapshot())
    seeded.close()

    const partial = new DatabaseSync(databasePath)
    partial.exec('ALTER TABLE profile_meta DROP COLUMN seed_profile_agent_event_manifest_json')
    partial.close()

    let readOnlyError: unknown
    try {
      inspectSqliteProfileRevisionDatabase({
        databasePath,
        openRuntime: openTestRuntime,
      })
    } catch (error) {
      readOnlyError = error
    }

    let mutableError: unknown
    let accidentallyOpened: ReturnType<typeof createStore> | undefined
    try {
      accidentallyOpened = createStore(databasePath)
    } catch (error) {
      mutableError = error
    } finally {
      accidentallyOpened?.close()
    }

    const inspected = new DatabaseSync(databasePath)
    const profileMetaColumns = inspected.prepare('PRAGMA table_info(profile_meta)').all() as Array<{
      name?: unknown
    }>
    inspected.close()

    expect(readOnlyError).toBeInstanceOf(Error)
    expect((readOnlyError as Error).message).toMatch(/seed Agent event manifest.*record-kind schema/)
    expect(mutableError).toBeInstanceOf(Error)
    expect((mutableError as Error).message).toMatch(/seed Agent event manifest.*record-kind schema/)
    expect(profileMetaColumns.map(({ name }) => name)).not.toContain(
      'seed_profile_agent_event_manifest_json',
    )
  })

  it('migrates the pre-v2 record and Agent-ledger schema without changing v1 history', async () => {
    const databasePath = disposableDatabasePath()
    const request = agentSingleCreateRequest({
      expectedRevision: 7,
      idempotencyKey: 'agent-v1-before-history-v2-migration',
      commandId: 'agent-v1-create-before-history-v2-migration',
    })
    const seeded = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-v1-before-history-v2-txn',
      createIntentEventId: () => 'agent-v1-before-history-v2-event',
    })
    expect(await seeded.applyAgentCommandBatch(request, 'cli')).toMatchObject({
      ok: true,
      value: { version: 1, revision: 8 },
    })
    seeded.close()

    // This disposable fixture rewrites sqlite_schema to reproduce a shipped schema.
    const legacy = new DatabaseSync(databasePath, { defensive: false })
    const requestRow = legacy.prepare(`
SELECT request_json
FROM profile_agent_command_events
WHERE revision = 8
`).get() as { request_json?: unknown } | undefined
    if (typeof requestRow?.request_json !== 'string') throw new Error('Legacy request fixture is missing')
    const legacyRequest = JSON.parse(requestRow.request_json) as {
      context: { actor: Record<string, unknown> }
    }
    delete legacyRequest.context.actor.client
    delete legacyRequest.context.actor.sessionId
    const legacyRequestJson = canonicalProfileJson(legacyRequest)
    legacy.prepare(`
UPDATE profile_agent_command_events
SET request_json = ?, request_digest = ?
WHERE revision = 8
`).run(
      legacyRequestJson,
      createHash('sha256').update(legacyRequestJson).digest('hex'),
    )
    legacy.exec(`
ALTER TABLE profile_agent_command_events DROP COLUMN profile_agent_event_ids_json;
ALTER TABLE profile_agent_command_events DROP COLUMN installed_surface_version;
ALTER TABLE profile_meta DROP COLUMN seed_profile_agent_event_manifest_json;
`)
    const recordSchema = legacy.prepare(`
SELECT sql
FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_records'
`).get() as { sql?: unknown } | undefined
    if (typeof recordSchema?.sql !== 'string') throw new Error('Profile record schema fixture is missing')
    const legacyRecordSchema = recordSchema.sql.replace("'profile-agent-event', ", '')
    if (legacyRecordSchema === recordSchema.sql) {
      throw new Error('Profile record schema fixture already lacks the v2 event kind')
    }
    const schemaVersion = legacy.prepare('PRAGMA schema_version').get() as {
      schema_version?: unknown
    } | undefined
    if (!Number.isSafeInteger(schemaVersion?.schema_version)) {
      throw new Error('SQLite schema version fixture is invalid')
    }
    legacy.exec('PRAGMA writable_schema = ON')
    legacy.prepare(`
UPDATE sqlite_schema
SET sql = ?
WHERE type = 'table' AND name = 'profile_records'
`).run(legacyRecordSchema)
    legacy.exec(`PRAGMA schema_version = ${Number(schemaVersion!.schema_version) + 1}`)
    legacy.exec('PRAGMA writable_schema = OFF')
    legacy.close()

    expect(inspectSqliteProfileRevisionDatabase({
      databasePath,
      openRuntime: openTestRuntime,
    })).toMatchObject({ profileId: 'profile-synthetic', revision: 8 })

    const migrated = createStore(databasePath)
    expect(await migrated.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 8 } },
    })
    expect(await migrated.applyAgentCommandBatch(request, 'cli')).toMatchObject({
      ok: true,
      value: { version: 1, revision: 8, replayed: true },
    })
    migrated.close()

    const inspected = new DatabaseSync(databasePath)
    const columns = inspected.prepare('PRAGMA table_info(profile_agent_command_events)').all() as Array<{
      name?: unknown
    }>
    expect(columns.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'installed_surface_version',
      'profile_agent_event_ids_json',
    ]))
    const profileMetaColumns = inspected.prepare('PRAGMA table_info(profile_meta)').all() as Array<{
      name?: unknown
    }>
    expect(profileMetaColumns.map(({ name }) => name)).toContain(
      'seed_profile_agent_event_manifest_json',
    )
    const migratedRecordSchema = inspected.prepare(`
SELECT sql
FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_records'
`).get() as { sql?: unknown } | undefined
    expect(migratedRecordSchema?.sql).toContain("'profile-agent-event'")
    inspected.close()
  })

  it('widens a retained v4 ledger only after one audited v5 Idea activation commits', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    seed.ideas.push({
      id: 'idea-second',
      name: 'Synthetic Second',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      lastOpenedAt: '2026-01-02T00:00:00.000Z',
    })
    seed.boards['idea-second'] = {
      version: 1,
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      updatedAt: '2026-01-02T00:00:00.000Z',
    }
    const legacyRequest = agentSingleCreateRequest({
      expectedRevision: 7,
      idempotencyKey: 'agent-v4-before-activation',
      commandId: 'create-before-v5-activation',
    })
    const seeded = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed,
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 4,
      now: () => '2026-08-05T04:05:05.000Z',
      createAgentClientTxnId: () => 'agent-v4-before-activation-txn',
      createIntentEventId: () => 'agent-v4-before-activation-event',
    })
    expect(await seeded.applyAgentCommandBatch(legacyRequest, 'cli')).toMatchObject({
      ok: true,
      value: { version: 4, revision: 8 },
    })
    seeded.close()

    const legacy = new DatabaseSync(databasePath)
    const legacyParentEvidence = legacy.prepare(`
SELECT * FROM profile_agent_command_events WHERE revision = 8
`).get()
    const legacyChildEvidence = legacy.prepare(`
SELECT * FROM profile_agent_command_record_changes
WHERE revision = 8
ORDER BY record_id
`).all()
    expect(legacy.prepare(`
SELECT sql FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get()).toMatchObject({ sql: expect.stringContaining('IN (1, 2, 3, 4)') })
    legacy.close()

    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 8,
      idempotencyKey: 'agent-activate-second-idea',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'activate-second-idea',
        name: 'idea.activate',
        payload: { ideaId: 'idea-second' },
      }],
    }
    const options = {
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 5 as const,
      now: () => '2026-08-05T04:05:06.000Z',
      createAgentClientTxnId: () => 'agent-activate-second-idea-txn',
      createProfileAgentEventId: () => 'agent-activate-second-idea-event',
    }
    const previewing = createSqliteProfileRevisionStore(options)
    expect(await previewing.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 8, activeIdeaId: 'idea-main' } },
    })
    expect(await previewing.applyAgentCommandBatch({ ...request, dryRun: true }, 'cli')).toMatchObject({
      ok: true,
      value: {
        version: 5,
        previousRevision: 8,
        revision: 8,
        proposedRevision: 9,
        dryRun: true,
        commandResults: [{
          commandId: 'activate-second-idea',
          name: 'idea.activate',
          previousActiveIdeaId: 'idea-main',
          activeIdeaId: 'idea-second',
        }],
        effects: { inserted: 0, updated: 1, deleted: 0, intentEvents: 0, profileAgentEvents: 1 },
      },
    })
    expect(await previewing.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 8, activeIdeaId: 'idea-main' } },
    })
    expect(await previewing.applyAgentCommandBatch({
      ...request,
      expectedRevision: 7,
      idempotencyKey: 'agent-stale-v5-activation',
    }, 'cli')).toMatchObject({ ok: false, code: 'conflict', currentRevision: 8 })
    expect(await previewing.applyAgentCommandBatch(legacyRequest, 'cli')).toMatchObject({
      ok: true,
      value: { version: 4, revision: 8, replayed: true },
    })
    previewing.close()

    const beforeApply = new DatabaseSync(databasePath)
    expect(beforeApply.prepare(`
SELECT sql FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get()).toMatchObject({
      sql: expect.stringContaining('IN (1, 2, 3, 4)'),
    })
    beforeApply.close()

    const auditSpy = vi.spyOn(
      sqliteProfileAgentCommandAudit,
      'auditAgentCommandRevision',
    ).mockReturnValueOnce(undefined)
    try {
      const rejected = createSqliteProfileRevisionStore(options)
      expect(await rejected.applyAgentCommandBatch(request, 'cli')).toMatchObject({
        ok: false,
        code: 'corrupt-or-recovery-required',
      })
      expect(await rejected.logicalDocument()).toMatchObject({
        ok: true,
        value: { head: { revision: 8, activeIdeaId: 'idea-main' } },
      })
      rejected.close()
    } finally {
      auditSpy.mockRestore()
    }

    const afterRejectedAudit = new DatabaseSync(databasePath)
    expect(afterRejectedAudit.prepare(`
SELECT sql FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get()).toMatchObject({ sql: expect.stringContaining('IN (1, 2, 3, 4)') })
    afterRejectedAudit.close()

    const applying = createSqliteProfileRevisionStore(options)
    const applied = await applying.applyAgentCommandBatch(request, 'cli')
    expect(applied).toMatchObject({
      ok: true,
      value: {
        version: 5,
        previousRevision: 8,
        revision: 9,
        replayed: false,
        commandResults: [{
          commandId: 'activate-second-idea',
          name: 'idea.activate',
          previousActiveIdeaId: 'idea-main',
          activeIdeaId: 'idea-second',
        }],
        effects: { inserted: 0, updated: 1, deleted: 0, intentEvents: 0, profileAgentEvents: 1 },
      },
    })
    expect(await applying.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 9, activeIdeaId: 'idea-second' } },
    })
    expect(await applying.applyAgentCommandBatch(request, 'cli')).toEqual(applied.ok
      ? { ok: true, value: { ...applied.value, replayed: true } }
      : applied)
    applying.close()

    const inspected = new DatabaseSync(databasePath)
    expect(inspected.prepare(`
SELECT sql FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get()).toMatchObject({ sql: expect.stringContaining('IN (1, 2, 3, 4, 5)') })
    expect(inspected.prepare(`
SELECT record_id, change_kind
FROM profile_agent_command_record_changes
WHERE revision = 9
ORDER BY record_id
`).all()).toEqual([
      { record_id: 'agent-activate-second-idea-event', change_kind: 'insert' },
      { record_id: 'idea-second', change_kind: 'update' },
    ])
    expect(inspected.prepare(`
SELECT * FROM profile_agent_command_events WHERE revision = 8
`).get()).toEqual(legacyParentEvidence)
    expect(inspected.prepare(`
SELECT * FROM profile_agent_command_record_changes
WHERE revision = 8
ORDER BY record_id
`).all()).toEqual(legacyChildEvidence)
    expect(inspected.prepare(`
SELECT installed_surface_version
FROM profile_agent_command_events
ORDER BY revision
`).all()).toEqual([
      { installed_surface_version: 4 },
      { installed_surface_version: 5 },
    ])
    inspected.close()

    const reopened = createSqliteProfileRevisionStore(options)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: true,
      value: {
        head: { revision: 9, activeIdeaId: 'idea-second' },
        records: expect.arrayContaining([
          expect.objectContaining({
            recordId: 'idea-second',
            payload: expect.objectContaining({ lastOpenedAt: '2026-08-05T04:05:06.000Z' }),
          }),
          expect.objectContaining({
            recordId: 'board:idea-second',
            payload: expect.objectContaining({ updatedAt: '2026-01-02T00:00:00.000Z' }),
          }),
        ]),
      },
    })
    reopened.close()
  })

  it('widens a retained v3 ledger directly to v5 without changing historical evidence', async () => {
    const databasePath = disposableDatabasePath()
    const legacyRequest = agentSingleCreateRequest({
      expectedRevision: 7,
      idempotencyKey: 'agent-v3-before-direct-v5',
      commandId: 'create-before-direct-v3-to-v5',
    })
    const seeded = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 3,
      now: () => '2026-08-05T05:00:00.000Z',
      createAgentClientTxnId: () => 'agent-v3-before-direct-v5-txn',
      createIntentEventId: () => 'agent-v3-before-direct-v5-event',
    })
    expect(await seeded.applyAgentCommandBatch(legacyRequest, 'cli')).toMatchObject({
      ok: true,
      value: { version: 3, revision: 8 },
    })
    seeded.close()

    const legacy = new DatabaseSync(databasePath, { defensive: false })
    const parentEvidenceBefore = legacy.prepare(`
SELECT * FROM profile_agent_command_events WHERE revision = 8
`).get()
    const childEvidenceBefore = legacy.prepare(`
SELECT * FROM profile_agent_command_record_changes
WHERE revision = 8
ORDER BY record_id
`).all()
    const schemaRow = legacy.prepare(`
SELECT sql FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get() as { sql?: unknown } | undefined
    if (typeof schemaRow?.sql !== 'string') throw new Error('Agent v3 schema fixture is missing')
    const v3Schema = schemaRow.sql.replace(
      'installed_surface_version IN (1, 2, 3, 4)',
      'installed_surface_version IN (1, 2, 3)',
    )
    if (v3Schema === schemaRow.sql) throw new Error('Agent schema fixture is not v4')
    const schemaVersion = legacy.prepare('PRAGMA schema_version').get() as {
      schema_version?: unknown
    } | undefined
    if (!Number.isSafeInteger(schemaVersion?.schema_version)) {
      throw new Error('SQLite schema version fixture is invalid')
    }
    legacy.exec('PRAGMA writable_schema = ON')
    legacy.prepare(`
UPDATE sqlite_schema
SET sql = ?
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).run(v3Schema)
    legacy.exec(`PRAGMA schema_version = ${Number(schemaVersion!.schema_version) + 1}`)
    legacy.exec('PRAGMA writable_schema = OFF')
    legacy.close()

    const request = agentSingleCreateRequest({
      expectedRevision: 8,
      idempotencyKey: 'agent-v5-after-direct-v3',
      commandId: 'create-after-direct-v3-to-v5',
    })
    const migrated = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 5,
      now: () => '2026-08-05T05:00:01.000Z',
      createAgentClientTxnId: () => 'agent-v5-after-direct-v3-txn',
      createIntentEventId: () => 'agent-v5-after-direct-v3-event',
    })
    expect(await migrated.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 8 } },
    })
    expect(await migrated.applyAgentCommandBatch(request, 'cli')).toMatchObject({
      ok: true,
      value: { version: 5, previousRevision: 8, revision: 9, replayed: false },
    })
    migrated.close()

    const inspected = new DatabaseSync(databasePath)
    expect(inspected.prepare(`
SELECT * FROM profile_agent_command_events WHERE revision = 8
`).get()).toEqual(parentEvidenceBefore)
    expect(inspected.prepare(`
SELECT * FROM profile_agent_command_record_changes
WHERE revision = 8
ORDER BY record_id
`).all()).toEqual(childEvidenceBefore)
    expect(inspected.prepare(`
SELECT sql FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get()).toMatchObject({ sql: expect.stringContaining('IN (1, 2, 3, 4, 5)') })
    expect(inspected.prepare(`
SELECT installed_surface_version
FROM profile_agent_command_events
ORDER BY revision
`).all()).toEqual([
      { installed_surface_version: 3 },
      { installed_surface_version: 5 },
    ])
    expect(inspected.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    inspected.close()
  })

  it('rolls a v5 schema widening and head update back with the failed Agent transaction', async () => {
    const databasePath = disposableDatabasePath()
    const request = agentSingleCreateRequest({
      expectedRevision: 7,
      idempotencyKey: 'agent-v5-rollback',
      commandId: 'create-for-v5-rollback',
    })
    const failedStore = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 5,
      now: () => '2026-08-05T05:30:00.000Z',
      createAgentClientTxnId: () => 'agent-v5-rollback-txn',
      createIntentEventId: () => 'agent-v5-rollback-event',
      testHooks: { beforeCommit: () => { throw new Error('injected v5 rollback') } },
    })
    expect(await failedStore.applyAgentCommandBatch(request, 'cli')).toMatchObject({
      ok: false,
      code: 'internal',
      currentRevision: 7,
    })
    expect(await failedStore.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 7 } },
    })
    failedStore.close()

    const rolledBack = new DatabaseSync(databasePath)
    expect(rolledBack.prepare(`
SELECT sql FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get()).toMatchObject({ sql: expect.stringContaining('IN (1, 2, 3, 4)') })
    expect(rolledBack.prepare(`
SELECT current_revision FROM profile_meta
`).get()).toEqual({ current_revision: 7 })
    expect(rolledBack.prepare(`
SELECT COUNT(*) AS count FROM profile_agent_command_events
`).get()).toEqual({ count: 0 })
    rolledBack.close()

    const retried = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 5,
      now: () => '2026-08-05T05:30:01.000Z',
      createAgentClientTxnId: () => 'agent-v5-rollback-retry-txn',
      createIntentEventId: () => 'agent-v5-rollback-retry-event',
    })
    expect(await retried.applyAgentCommandBatch(request, 'cli')).toMatchObject({
      ok: true,
      value: { version: 5, revision: 8, replayed: false },
    })
    retried.close()
  })

  it('commits and reopens the direct v5 Mod instance lifecycle', async () => {
    const databasePath = disposableDatabasePath()
    let transactionSequence = 0
    let eventSequence = 0
    const options = {
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 5 as const,
      now: () => `2026-08-05T04:05:0${transactionSequence}.000Z`,
      createAgentClientTxnId: () => `agent-direct-mod-txn-${++transactionSequence}`,
      createIntentEventId: () => `agent-direct-mod-event-${++eventSequence}`,
    }
    const request = (
      expectedRevision: number,
      idempotencyKey: string,
      commands: ProfileAgentCommandRequest['commands'],
    ): ProfileAgentCommandRequest => ({
      version: 1,
      schemaVersion: 1,
      expectedRevision,
      idempotencyKey,
      dryRun: false,
      commands,
    })
    const originalMod = switchMod('DIRECT AUDIT', ['direct-audit-control'])
    const configuredMod = switchMod('DIRECT AUDIT CONFIGURED', ['direct-audit-control'])
    const store = createSqliteProfileRevisionStore({ ...options, seed: assetFreeSnapshot() })
    const created = await store.applyAgentCommandBatch(request(7, 'direct-mod-create', [{
      version: 1,
      id: 'create-direct-mod',
      name: 'mod-instance.create',
      payload: {
        ideaId: 'idea-main',
        mod: originalMod,
        position: { x: 640, y: 320 },
      },
    }]), 'cli')
    expect(created).toMatchObject({
      ok: true,
      value: {
        version: 5,
        revision: 8,
        effects: { inserted: 3, updated: 0, deleted: 0, intentEvents: 1 },
      },
    })
    if (!created.ok || created.value.commandResults[0]?.name !== 'mod-instance.create') {
      store.close()
      throw new Error('Expected direct Mod creation')
    }
    const createdResult = created.value.commandResults[0]
    const configured = await store.applyAgentCommandBatch(request(8, 'direct-mod-configure', [{
      version: 1,
      id: 'configure-direct-mod',
      name: 'mod-instance.configure',
      payload: {
        ideaId: 'idea-main',
        cardId: createdResult.cardId,
        mod: configuredMod,
      },
    }]), 'cli')
    expect(configured).toMatchObject({
      ok: true,
      value: {
        version: 5,
        revision: 9,
        commandResults: [{
          name: 'mod-instance.configure',
          cardId: createdResult.cardId,
          instanceId: createdResult.instanceId,
        }],
        effects: { inserted: 0, updated: 1, deleted: 0, intentEvents: 1 },
      },
    })
    const deleted = await store.applyAgentCommandBatch(request(9, 'direct-mod-delete', [{
      version: 1,
      id: 'delete-direct-mod',
      name: 'mod-instance.delete',
      payload: { ideaId: 'idea-main', cardId: createdResult.cardId },
    }]), 'cli')
    expect(deleted).toMatchObject({
      ok: true,
      value: {
        version: 5,
        revision: 10,
        commandResults: [{
          name: 'mod-instance.delete',
          cardId: createdResult.cardId,
          instanceId: createdResult.instanceId,
        }],
        effects: { inserted: 0, updated: 0, deleted: 3, intentEvents: 1 },
      },
    })
    store.close()

    const reopened = createSqliteProfileRevisionStore(options)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: true,
      value: {
        head: { revision: 10 },
        records: expect.not.arrayContaining([
          expect.objectContaining({ recordId: createdResult.cardId }),
          expect.objectContaining({ recordId: createdResult.instanceId }),
        ]),
      },
    })
    reopened.close()
  })

  it('sets and clears identity on direct and stamped Mod Cards without changing provenance', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    const directCardId = 'card-mod-identity-direct'
    const directInstance = createDirectProfileModInstance({
      boardRecordId: 'board:idea-main',
      cardId: directCardId,
      instanceId: 'mod-instance-identity-direct',
      createdAt: '2026-08-05T00:00:00.000Z',
      mod: switchMod('DIRECT IDENTITY', ['direct-identity-control']),
    })
    const templateId = 'mod-template-identity-stamped'
    const template = createUserProfileModTemplate({
      profileId: seed.profileId,
      templateId,
      createdAt: '2026-08-05T00:00:00.000Z',
      mod: switchMod('STAMPED IDENTITY', ['stamped-identity-source-control']),
    })
    if (!directInstance.ok || !template.ok) throw new Error('Expected synthetic Mod records')
    const stampedCardId = 'card-mod-identity-stamped'
    const stampedInstance = stampProfileModTemplate(template.value, {
      boardRecordId: 'board:idea-main',
      cardId: stampedCardId,
      instanceId: 'mod-instance-identity-stamped',
      controlIds: ['stamped-identity-instance-control'],
      stampedAt: '2026-08-05T00:00:01.000Z',
    })
    if (!stampedInstance.ok) throw new Error(stampedInstance.message)
    seed.modTemplates = [template.value]
    seed.modInstances = [directInstance.value, stampedInstance.value]
    seed.boards['idea-main']!.cards.push(
      {
        id: directCardId,
        kind: 'mod',
        position: { x: 500, y: 80 },
        blocks: [{ id: 'block-mod-identity-direct', text: '' }],
        modV2: directInstance.value.payload.mod,
      },
      {
        id: stampedCardId,
        kind: 'mod',
        position: { x: 880, y: 80 },
        blocks: [{ id: 'block-mod-identity-stamped', text: '' }],
        modV2: stampedInstance.value.payload.mod,
      },
    )
    const directProvenance = canonicalProfileJson({
      source: directInstance.value.payload.source,
      createdAt: directInstance.value.payload.createdAt,
    })
    const stampedProvenance = canonicalProfileJson({
      source: stampedInstance.value.payload.source,
      idMap: stampedInstance.value.payload.idMap,
      stampedAt: stampedInstance.value.payload.stampedAt,
    })
    let transactionSequence = 0
    let eventSequence = 0
    const options = {
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 5 as const,
      now: () => '2026-08-05T05:06:07.000Z',
      createAgentClientTxnId: () => `agent-mod-identity-txn-${++transactionSequence}`,
      createIntentEventId: () => `agent-mod-identity-event-${++eventSequence}`,
    }
    const identityRequest = (
      expectedRevision: number,
      idempotencyKey: string,
      dryRun: boolean,
      mode: 'set' | 'clear' | 'reapply',
    ): ProfileAgentCommandRequest => ({
      version: 1,
      schemaVersion: 1,
      expectedRevision,
      idempotencyKey,
      dryRun,
      commands: [
        {
          version: 1,
          id: `${idempotencyKey}:direct`,
          name: 'card.set-identity',
          payload: {
            ideaId: 'idea-main',
            card: { cardId: directCardId },
            identity: mode === 'clear'
              ? null
              : { preset: 'blue', fill: mode === 'reapply' ? 'soft' : 'body' },
          },
        },
        {
          version: 1,
          id: `${idempotencyKey}:stamped`,
          name: 'card.set-identity',
          payload: {
            ideaId: 'idea-main',
            card: { cardId: stampedCardId },
            identity: mode === 'clear'
              ? null
              : { preset: 'coral', fill: mode === 'reapply' ? 'body' : 'pattern' },
          },
        },
      ],
    })
    const store = createSqliteProfileRevisionStore({ ...options, seed })
    const before = await store.snapshot()
    const beforeStamped = before.ok
      ? before.value.modInstances.find(({ recordId }) => recordId === stampedInstance.value.recordId)
      : undefined
    if (!beforeStamped || !('idMap' in beforeStamped.payload)) {
      throw new Error('Expected the initial stamped Mod instance record')
    }
    const stampedIdMapBytes = JSON.stringify(beforeStamped.payload.idMap)
    const preview = await store.applyAgentCommandBatch(
      identityRequest(7, 'mod-identity-preview', true, 'set'),
      'cli',
    )
    expect(preview).toMatchObject({
      ok: true,
      value: {
        previousRevision: 7,
        revision: 7,
        proposedRevision: 8,
        dryRun: true,
        effects: { inserted: 0, updated: 4, deleted: 0, intentEvents: 2 },
      },
    })
    expect(await store.snapshot()).toEqual(before)

    const applied = await store.applyAgentCommandBatch(
      identityRequest(7, 'mod-identity-apply', false, 'set'),
      'cli',
    )
    expect(applied).toMatchObject({
      ok: true,
      value: {
        revision: 8,
        effects: { inserted: 0, updated: 4, deleted: 0, intentEvents: 2 },
      },
    })
    const styled = await store.snapshot()
    if (!styled.ok) throw new Error('Expected styled Mod snapshot')
    expect(styled.value.boards['idea-main']?.cards.find(({ id }) => id === directCardId))
      .toMatchObject({ headerColor: '#3568c6', headerFill: 'full', modV2: { accent: '#3568c6' } })
    expect(styled.value.boards['idea-main']?.cards.find(({ id }) => id === stampedCardId))
      .toMatchObject({ headerColor: '#f1666d', headerFill: 'pattern', modV2: { accent: '#f1666d' } })
    const styledDirect = styled.value.modInstances.find(({ recordId }) => (
      recordId === directInstance.value.recordId
    ))
    const styledStamped = styled.value.modInstances.find(({ recordId }) => (
      recordId === stampedInstance.value.recordId
    ))
    if (!styledDirect || !styledStamped || !('idMap' in styledStamped.payload)) {
      throw new Error('Expected both styled Mod instance records')
    }
    expect(styledDirect.payload.mod.accent).toBe('#3568c6')
    expect(styledStamped.payload.mod.accent).toBe('#f1666d')
    expect(canonicalProfileJson({
      source: styledDirect.payload.source,
      createdAt: 'createdAt' in styledDirect.payload ? styledDirect.payload.createdAt : undefined,
    })).toBe(directProvenance)
    expect(canonicalProfileJson({
      source: styledStamped.payload.source,
      idMap: styledStamped.payload.idMap,
      stampedAt: styledStamped.payload.stampedAt,
    })).toBe(stampedProvenance)
    expect(JSON.stringify(styledStamped.payload.idMap)).toBe(stampedIdMapBytes)

    for (const dryRun of [true, false]) {
      expect(await store.applyAgentCommandBatch(identityRequest(
        8,
        `mod-identity-noop-${dryRun ? 'preview' : 'apply'}`,
        dryRun,
        'set',
      ), 'cli')).toMatchObject({ ok: false, code: 'invalid' })
    }

    const beforeClear = await store.snapshot()
    expect(await store.applyAgentCommandBatch(
      identityRequest(8, 'mod-identity-clear-preview', true, 'clear'),
      'cli',
    )).toMatchObject({
      ok: true,
      value: {
        previousRevision: 8,
        revision: 8,
        proposedRevision: 9,
        dryRun: true,
        effects: { inserted: 0, updated: 2, deleted: 0, intentEvents: 2 },
      },
    })
    expect(await store.snapshot()).toEqual(beforeClear)

    const cleared = await store.applyAgentCommandBatch(
      identityRequest(8, 'mod-identity-clear', false, 'clear'),
      'cli',
    )
    expect(cleared).toMatchObject({
      ok: true,
      value: {
        revision: 9,
        effects: { inserted: 0, updated: 2, deleted: 0, intentEvents: 2 },
      },
    })
    const reapplied = await store.applyAgentCommandBatch(
      identityRequest(9, 'mod-identity-reapply-same-accent', false, 'reapply'),
      'cli',
    )
    expect(reapplied).toMatchObject({
      ok: true,
      value: {
        revision: 10,
        effects: { inserted: 0, updated: 2, deleted: 0, intentEvents: 2 },
      },
    })
    const reappliedSnapshot = await store.snapshot()
    if (!reappliedSnapshot.ok) throw new Error('Expected reapplied Mod identity snapshot')
    expect(reappliedSnapshot.value.boards['idea-main']?.cards.find(({ id }) => id === directCardId))
      .toMatchObject({ headerColor: '#3568c6', headerFill: 'half', modV2: { accent: '#3568c6' } })
    expect(reappliedSnapshot.value.boards['idea-main']?.cards.find(({ id }) => id === stampedCardId))
      .toMatchObject({ headerColor: '#f1666d', headerFill: 'full', modV2: { accent: '#f1666d' } })
    expect(await store.applyAgentCommandBatch(
      identityRequest(10, 'mod-identity-final-clear', false, 'clear'),
      'cli',
    )).toMatchObject({
      ok: true,
      value: {
        revision: 11,
        effects: { inserted: 0, updated: 2, deleted: 0, intentEvents: 2 },
      },
    })
    store.close()

    const reopened = createSqliteProfileRevisionStore(options)
    const final = await reopened.snapshot()
    if (!final.ok) throw new Error('Expected reopened Mod identity snapshot')
    expect(final.value.revision).toBe(11)
    for (const cardId of [directCardId, stampedCardId]) {
      const card = final.value.boards['idea-main']?.cards.find(({ id }) => id === cardId)
      expect(card).not.toHaveProperty('headerColor')
      expect(card).not.toHaveProperty('headerFill')
    }
    const finalDirect = final.value.modInstances.find(({ recordId }) => (
      recordId === directInstance.value.recordId
    ))
    const finalStamped = final.value.modInstances.find(({ recordId }) => (
      recordId === stampedInstance.value.recordId
    ))
    if (!finalDirect || !finalStamped || !('idMap' in finalStamped.payload)) {
      throw new Error('Expected reopened Mod instance records')
    }
    expect(finalDirect.payload.mod.accent).toBe('#3568c6')
    expect(finalStamped.payload.mod.accent).toBe('#f1666d')
    expect(canonicalProfileJson({
      source: finalDirect.payload.source,
      createdAt: 'createdAt' in finalDirect.payload ? finalDirect.payload.createdAt : undefined,
    })).toBe(directProvenance)
    expect(canonicalProfileJson({
      source: finalStamped.payload.source,
      idMap: finalStamped.payload.idMap,
      stampedAt: finalStamped.payload.stampedAt,
    })).toBe(stampedProvenance)
    expect(JSON.stringify(finalStamped.payload.idMap)).toBe(stampedIdMapBytes)
    reopened.close()
  })

  it.each([
    ['provenance rewrite', 'provenance'],
    ['no-op accent transition', 'no-op-accent'],
    ['unrequested Card position rewrite', 'card-position'],
  ] as const)('rejects a coherently rehashed historical Mod identity %s', async (_label, tamper) => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    const cardId = 'card-mod-identity-history'
    const instance = createDirectProfileModInstance({
      boardRecordId: 'board:idea-main',
      cardId,
      instanceId: 'mod-instance-identity-history',
      createdAt: '2026-08-05T00:00:00.000Z',
      mod: switchMod('HISTORICAL IDENTITY', ['historical-identity-control']),
    })
    if (!instance.ok) throw new Error(instance.message)
    seed.modInstances = [instance.value]
    seed.boards['idea-main']!.cards.push({
      id: cardId,
      kind: 'mod',
      position: { x: 500, y: 80 },
      blocks: [{ id: 'block-mod-identity-history', text: '' }],
      modV2: instance.value.payload.mod,
    })
    let transactionSequence = 0
    let eventSequence = 0
    const options = {
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 5 as const,
      now: () => '2026-08-05T05:06:07.000Z',
      createAgentClientTxnId: () => `agent-mod-identity-history-txn-${++transactionSequence}`,
      createIntentEventId: () => `agent-mod-identity-history-event-${++eventSequence}`,
    }
    const store = createSqliteProfileRevisionStore({ ...options, seed })
    expect(await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: `agent-mod-identity-history-${tamper}-key`,
      dryRun: false,
      commands: [{
        version: 1,
        id: 'agent-mod-identity-history-set',
        name: 'card.set-identity',
        payload: {
          ideaId: 'idea-main',
          card: { cardId },
          identity: { preset: 'blue', fill: 'body' },
        },
      }],
    }, 'cli')).toMatchObject({ ok: true, value: { revision: 8 } })
    expect(await store.applyAgentCommandBatch(agentSingleCreateRequest({
      expectedRevision: 8,
      idempotencyKey: `agent-after-mod-identity-history-${tamper}-key`,
      commandId: `agent-after-mod-identity-history-${tamper}-create`,
    }), 'cli')).toMatchObject({ ok: true, value: { revision: 9 } })
    store.close()

    rewriteHistoricalModIdentityProvenance(
      databasePath,
      8,
      instance.value.recordId,
      tamper,
    )
    const reopened = createSqliteProfileRevisionStore(options)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    reopened.close()
  })

  it('attests every v5 research mutation through native apply and historical reopen', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    seed.boards['idea-main'] = {
      version: 1,
      cards: [
        {
          id: 'research-note', kind: 'note', position: { x: 0, y: 0 }, zIndex: 0,
          blocks: [{ id: 'research-note-block', text: 'Evidence' }],
        },
        {
          id: 'research-ask', kind: 'askAi', position: { x: 400, y: 0 }, zIndex: 1,
          blocks: [{ id: 'research-ask-block', text: 'Question' }],
        },
        {
          id: 'research-result', kind: 'result', position: { x: 800, y: 0 },
          blocks: [{ id: 'research-result-block', text: '' }],
        },
        {
          id: 'research-group', kind: 'group', position: { x: 0, y: 360 },
          blocks: [{ id: 'research-group-block', text: '' }],
          title: 'Research cluster',
        },
      ],
      connections: [],
      outputs: [{
        id: 'research-output',
        resultCardId: 'research-result',
        chosenVersionId: 'research-version-2',
        versions: [
          {
            id: 'research-version-1', number: 1, text: 'First',
            createdAt: '2026-08-05T00:00:00.000Z', fromRunId: 'research-run-1',
          },
          {
            id: 'research-version-2', number: 2, text: 'Second',
            createdAt: '2026-08-05T00:01:00.000Z', fromRunId: 'research-run-2',
          },
        ],
      }],
      runs: [],
      updatedAt: '2026-08-05T00:02:00.000Z',
      aiSettings: {
        model: 'default/model',
        models: ['default/model', 'openai/gpt-5.6-luna'],
        reasoningEffort: 'medium',
      },
    }
    let clientTxnSequence = 0
    let intentSequence = 0
    const options = {
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 5 as const,
      now: () => '2026-08-05T05:06:07.000Z',
      createAgentClientTxnId: () => `agent-research-txn-${++clientTxnSequence}`,
      createIntentEventId: () => `agent-research-event-${++intentSequence}`,
    }
    const store = createSqliteProfileRevisionStore({ ...options, seed })
    const researchRequest: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-research-all-v5',
      dryRun: false,
      commands: [
        {
          version: 1,
          id: 'set-research-model',
          name: 'ask.set-model',
          payload: {
            ideaId: 'idea-main', card: { cardId: 'research-ask' },
            model: 'openai/gpt-5.6-luna',
          },
        },
        {
          version: 1,
          id: 'set-research-identity',
          name: 'card.set-identity',
          payload: {
            ideaId: 'idea-main', card: { cardId: 'research-note' },
            identity: { preset: 'amber', fill: 'soft' },
          },
        },
        {
          version: 1,
          id: 'arrange-research-cards',
          name: 'cards.arrange',
          payload: {
            ideaId: 'idea-main',
            frames: [
              {
                card: { cardId: 'research-note' },
                position: { x: 40, y: 60 },
                size: { width: 300, height: 200 },
              },
              { card: { cardId: 'research-ask' }, position: { x: 480, y: 60 } },
            ],
          },
        },
        {
          version: 1,
          id: 'layer-research-card',
          name: 'cards.reorder-layer',
          payload: {
            ideaId: 'idea-main', cards: [{ cardId: 'research-note' }], direction: 'front',
          },
        },
        {
          version: 1,
          id: 'group-research-card',
          name: 'group.membership.set',
          payload: {
            ideaId: 'idea-main',
            card: { cardId: 'research-note' },
            group: { cardId: 'research-group' },
          },
        },
        {
          version: 1,
          id: 'choose-research-version',
          name: 'output.choose-version',
          payload: {
            ideaId: 'idea-main', outputId: 'research-output', versionId: 'research-version-1',
          },
        },
        {
          version: 1,
          id: 'accept-research-version',
          name: 'output.set-accepted',
          payload: {
            ideaId: 'idea-main', outputId: 'research-output',
            versionId: 'research-version-2', accepted: true,
          },
        },
      ],
    }
    const applied = await store.applyAgentCommandBatch(researchRequest, 'cli')
    expect(applied).toMatchObject({
      ok: true,
      value: {
        version: 5,
        revision: 8,
        commandResults: [
          { name: 'ask.set-model' },
          { name: 'card.set-identity' },
          { name: 'cards.arrange' },
          { name: 'cards.reorder-layer' },
          { name: 'group.membership.set' },
          { name: 'output.choose-version' },
          { name: 'output.set-accepted' },
        ],
        effects: { intentEvents: 9, profileAgentEvents: 0 },
      },
    })
    expect(await store.applyAgentCommandBatch(agentSingleCreateRequest({
      expectedRevision: 8,
      idempotencyKey: 'agent-after-research-v5',
      commandId: 'create-after-research-v5',
    }), 'cli')).toMatchObject({ ok: true, value: { version: 5, revision: 9 } })
    store.close()

    const reopened = createSqliteProfileRevisionStore(options)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 9 } },
    })
    reopened.close()
  })

  it('attests a multi-member Group add when its first reframe absorbs the later member', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    seed.boards['idea-main'] = {
      version: 1,
      cards: [
        {
          id: 'research-group', kind: 'group', position: { x: 0, y: 0 },
          blocks: [{ id: 'research-group-block', text: '' }],
        },
        {
          id: 'research-first', kind: 'note', position: { x: 400, y: 80 },
          blocks: [{ id: 'research-first-block', text: 'First member' }],
        },
        {
          id: 'research-absorbed', kind: 'note', position: { x: 450, y: 90 },
          blocks: [{ id: 'research-absorbed-block', text: 'Later member' }],
        },
      ],
      connections: [],
      outputs: [],
      runs: [],
      updatedAt: '2026-08-05T00:02:00.000Z',
    }
    let intentSequence = 0
    const options = {
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 5 as const,
      now: () => '2026-08-05T05:06:07.000Z',
      createAgentClientTxnId: () => 'agent-group-set-txn',
      createIntentEventId: () => `agent-group-set-event-${++intentSequence}`,
    }
    const store = createSqliteProfileRevisionStore({ ...options, seed })

    const applied = await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-group-set-multi',
      dryRun: false,
      commands: [
        {
          version: 1,
          id: 'group-first',
          name: 'group.membership.set',
          payload: {
            ideaId: 'idea-main',
            card: { cardId: 'research-first' },
            group: { cardId: 'research-group' },
          },
        },
        {
          version: 1,
          id: 'group-absorbed',
          name: 'group.membership.set',
          payload: {
            ideaId: 'idea-main',
            card: { cardId: 'research-absorbed' },
            group: { cardId: 'research-group' },
          },
        },
      ],
    }, 'cli')

    expect(applied).toMatchObject({
      ok: true,
      value: {
        revision: 8,
        commandResults: [
          { commandId: 'group-first', cardId: 'research-first' },
          { commandId: 'group-absorbed', cardId: 'research-absorbed' },
        ],
      },
    })
    store.close()

    const reopened = createSqliteProfileRevisionStore(options)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 8 } },
    })
    reopened.close()
  })

  it('atomically widens an exact v1/v2 Agent ledger to v4 without changing parent or child evidence', async () => {
    const databasePath = disposableDatabasePath()
    const legacyRequest = agentSingleCreateRequest({
      expectedRevision: 7,
      idempotencyKey: 'agent-v2-before-surface-v3-migration',
      commandId: 'agent-v2-create-before-surface-v3-migration',
    })
    const seeded = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: assetFreeSnapshot(),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 2,
      now: () => '2026-07-22T00:00:01.000Z',
      createAgentClientTxnId: () => 'agent-v2-before-surface-v3-txn',
      createIntentEventId: () => 'agent-v2-before-surface-v3-event',
    })
    expect(await seeded.applyAgentCommandBatch(legacyRequest, 'cli')).toMatchObject({
      ok: true,
      value: { version: 2, revision: 8 },
    })
    seeded.close()

    const legacy = new DatabaseSync(databasePath, { defensive: false })
    const parentEvidenceBefore = legacy.prepare(`
SELECT * FROM profile_agent_command_events WHERE revision = 8
`).get()
    const childEvidenceBefore = legacy.prepare(`
SELECT * FROM profile_agent_command_record_changes
WHERE revision = 8
ORDER BY record_id
`).all()
    const schemaRow = legacy.prepare(`
SELECT sql FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get() as { sql?: unknown } | undefined
    if (typeof schemaRow?.sql !== 'string') throw new Error('Agent history schema fixture is missing')
    const legacySchema = schemaRow.sql.replace(
      'installed_surface_version IN (1, 2, 3, 4)',
      'installed_surface_version IN (1, 2)',
    )
    if (legacySchema === schemaRow.sql) {
      throw new Error('Agent history schema fixture already lacks the v4 surface')
    }
    const schemaVersion = legacy.prepare('PRAGMA schema_version').get() as {
      schema_version?: unknown
    } | undefined
    if (!Number.isSafeInteger(schemaVersion?.schema_version)) {
      throw new Error('SQLite schema version fixture is invalid')
    }
    legacy.exec('PRAGMA writable_schema = ON')
    legacy.prepare(`
UPDATE sqlite_schema
SET sql = ?
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).run(legacySchema)
    legacy.exec(`PRAGMA schema_version = ${Number(schemaVersion!.schema_version) + 1}`)
    legacy.exec('PRAGMA writable_schema = OFF')
    expect(legacy.prepare(`
SELECT sql FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get()).toMatchObject({ sql: expect.stringContaining('IN (1, 2)') })
    legacy.close()

    let clientTxnSequence = 0
    let intentEventSequence = 0
    const migrated = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 4,
      now: () => '2026-07-22T00:00:02.000Z',
      createAgentClientTxnId: () => `agent-v4-after-migration-txn-${++clientTxnSequence}`,
      createIntentEventId: () => `agent-v4-after-migration-event-${++intentEventSequence}`,
    })
    expect(await migrated.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 8 } },
    })
    const v4Request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 8,
      idempotencyKey: 'agent-v4-after-surface-migration',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'create-title-near-existing-note',
        name: 'card.create',
        payload: {
          ideaId: 'idea-main',
          kind: 'title',
          body: 'Migrated v4 frame',
          near: ['eido://app/?idea=idea-main&card=card-note&x=9999&y=-9999&zoom=0.1'],
        },
      }],
    }
    const dryRun = await migrated.applyAgentCommandBatch({ ...v4Request, dryRun: true }, 'cli')
    expect(dryRun).toMatchObject({ ok: true, value: { version: 4, revision: 8 } })

    const beforeApply = new DatabaseSync(databasePath)
    expect(beforeApply.prepare(`
SELECT sql FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get()).toMatchObject({ sql: expect.stringContaining('IN (1, 2, 3)') })
    beforeApply.close()
    migrated.close()

    const rollbackCompatible = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 3,
    })
    expect(await rollbackCompatible.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 8 } },
    })
    rollbackCompatible.close()

    const applyingV4 = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 4,
      now: () => '2026-07-22T00:00:02.000Z',
      createAgentClientTxnId: () => `agent-v4-after-migration-txn-${++clientTxnSequence}`,
      createIntentEventId: () => `agent-v4-after-migration-event-${++intentEventSequence}`,
    })
    const applied = await applyingV4.applyAgentCommandBatch(v4Request, 'cli')
    expect(applied).toMatchObject({
      ok: true,
      value: {
        version: 4,
        revision: 9,
        replayed: false,
        commandResults: [{
          commandId: 'create-title-near-existing-note',
          name: 'card.create',
          position: { x: 410, y: 80 },
        }],
      },
    })
    if (!dryRun.ok || !applied.ok) throw new Error('Surface v4 migration fixture did not apply')
    expect(dryRun.value.commandResults).toEqual(applied.value.commandResults)
    expect(await applyingV4.applyAgentCommandBatch(v4Request, 'cli')).toMatchObject({
      ok: true,
      value: {
        version: 4,
        revision: 9,
        replayed: true,
        commandResults: applied.value.commandResults,
      },
    })
    applyingV4.close()

    const inspected = new DatabaseSync(databasePath)
    expect(inspected.prepare(`
SELECT * FROM profile_agent_command_events WHERE revision = 8
`).get()).toEqual(parentEvidenceBefore)
    expect(inspected.prepare(`
SELECT * FROM profile_agent_command_record_changes
WHERE revision = 8
ORDER BY record_id
`).all()).toEqual(childEvidenceBefore)
    expect(inspected.prepare(`
SELECT sql FROM sqlite_schema
WHERE type = 'table' AND name = 'profile_agent_command_events'
`).get()).toMatchObject({ sql: expect.stringContaining('IN (1, 2, 3, 4)') })
    expect(inspected.prepare(`
SELECT installed_surface_version
FROM profile_agent_command_events
ORDER BY revision
`).all()).toEqual([
      { installed_surface_version: 2 },
      { installed_surface_version: 4 },
    ])
    expect(inspected.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(inspected.prepare(`
PRAGMA foreign_key_list(profile_agent_command_record_changes)
`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'profile_agent_command_events' }),
    ]))
    inspected.close()

    const reopened = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 4,
    })
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 9 } },
    })
    reopened.close()
  })

  it('commits and reopens a surface-v3 unrun Ask chain without fabricating execution records', async () => {
    const databasePath = disposableDatabasePath()
    let eventSequence = 0
    const options = {
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 3 as const,
      now: () => '2026-07-22T00:00:02.000Z',
      createAgentClientTxnId: () => 'agent-v3-unrun-chain-txn',
      createIntentEventId: () => `agent-v3-unrun-chain-event-${++eventSequence}`,
    }
    const store = createSqliteProfileRevisionStore({
      ...options,
      seed: assetFreeSnapshot(),
    })
    const committed = await store.applyAgentCommandBatch(agentThroughResultRequest(), 'cli')
    expect(committed).toMatchObject({
      ok: true,
      value: {
        version: 3,
        revision: 8,
        effects: { inserted: 8, updated: 0, deleted: 0, intentEvents: 5 },
      },
    })
    if (!committed.ok) {
      store.close()
      return
    }
    const route = committed.value.commandResults.find(({ name }) => name === 'connection.create')
    if (!route || route.name !== 'connection.create') {
      store.close()
      throw new Error('Surface-v3 chain receipt lost its Connection result')
    }
    expect(route).toMatchObject({
      route: 'through-result',
      resultCreated: true,
    })

    const snapshot = await store.snapshot()
    expect(snapshot).toMatchObject({ ok: true, value: { revision: 8 } })
    if (!snapshot.ok) {
      store.close()
      return
    }
    const board = snapshot.value.boards['idea-main']
    const resultCard = board?.cards.find(({ id }) => id === route.resultCardId)
    expect(resultCard).toMatchObject({
      kind: 'result',
      blocks: [{ text: '' }],
      createdBy: { kind: 'agent' },
      lastModifiedBy: { kind: 'agent' },
    })
    expect(board?.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: { cardId: committed.value.commandResults[0]?.name === 'card.create'
          ? committed.value.commandResults[0].cardId
          : '' },
        to: { cardId: route.resultCardId },
        role: 'feeds',
      }),
      expect.objectContaining({
        from: { cardId: route.resultCardId },
        to: { cardId: committed.value.commandResults[1]?.name === 'card.create'
          ? committed.value.commandResults[1].cardId
          : '' },
        role: 'feeds',
      }),
    ]))
    expect(board?.outputs).toEqual([])
    expect(board?.runs).toEqual([])
    store.close()

    const reopened = createSqliteProfileRevisionStore(options)
    const document = await reopened.logicalDocument()
    expect(document).toMatchObject({ ok: true, value: { head: { revision: 8 } } })
    if (document.ok) {
      expect(document.value.records.some(({ kind }) => kind === 'output')).toBe(false)
      expect(document.value.records.some(({ kind }) => kind === 'output-version')).toBe(false)
      expect(document.value.records.some(({ kind }) => kind === 'run')).toBe(false)
    }
    reopened.close()
  })

  it('audits surface-v3 domain edits, group ungrouping, and the complete Result cascade after reopen', async () => {
    const databasePath = disposableDatabasePath()
    const fixture = createCompleteProfileFixture()
    const secondGroupMember = fixture.snapshot.boards['idea-main']!.cards.find(
      ({ id }) => id === 'card-ask',
    )
    if (!secondGroupMember) throw new Error('Complete fixture lost its second Group member')
    secondGroupMember.groupId = 'card-group'
    let transactionSequence = 0
    let eventSequence = 0
    const options = {
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      openRuntime: openTestRuntime,
      materializeAsset: fixture.projectAsset,
      hydrateAsset: fixture.hydrateAsset,
      agentCommandSurfaceVersion: 3 as const,
      now: () => '2026-07-22T00:00:03.000Z',
      createAgentClientTxnId: () => `agent-v3-domain-txn-${++transactionSequence}`,
      createIntentEventId: () => `agent-v3-domain-event-${++eventSequence}`,
    }
    const store = createSqliteProfileRevisionStore({
      ...options,
      seed: fixture.snapshot,
    })
    const updated = await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'agent-v3-domain-updates',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'update-v3-group',
        name: 'card.update-content',
        payload: {
          ideaId: 'idea-main',
          cardId: 'card-group',
          groupTitle: 'Evidence frame',
          compressionPrompt: 'Preserve dissent and provenance.',
        },
      }, {
        version: 1,
        id: 'update-v3-conversation',
        name: 'card.update-content',
        payload: {
          ideaId: 'idea-main',
          cardId: 'card-conversation',
          topic: 'Choose the strongest direction',
          conversationStyle: 'collaborate',
          conversationTurns: 4,
        },
      }],
    }, 'mcp')
    if (!updated.ok) {
      store.close()
      throw new Error(JSON.stringify(updated))
    }
    expect(updated).toMatchObject({
      ok: true,
      value: {
        version: 3,
        revision: 8,
        commandResults: [
          { commandId: 'update-v3-group', name: 'card.update-content' },
          { commandId: 'update-v3-conversation', name: 'card.update-content' },
        ],
        intentEventIds: [
          'agent-v3-domain-event-1',
          'agent-v3-domain-event-2',
          'agent-v3-domain-event-3',
          'agent-v3-domain-event-4',
        ],
      },
    })

    const conversationSettingsRequest: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 8,
      idempotencyKey: 'agent-v3-conversation-settings-only',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'update-v3-conversation-settings-only',
        name: 'card.update-content',
        payload: {
          ideaId: 'idea-main',
          cardId: 'card-conversation',
          conversationStyle: 'critique',
          conversationTurns: 5,
        },
      }],
    }
    expect(await store.applyAgentCommandBatch(conversationSettingsRequest, 'mcp')).toMatchObject({
      ok: true,
      value: { version: 3, revision: 9, replayed: false },
    })
    expect(await store.applyAgentCommandBatch(conversationSettingsRequest, 'mcp')).toMatchObject({
      ok: true,
      value: { version: 3, revision: 9, replayed: true },
    })

    const deleted = await store.applyAgentCommandBatch({
      version: 1,
      schemaVersion: 1,
      expectedRevision: 9,
      idempotencyKey: 'agent-v3-domain-deletes',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'delete-v3-group',
        name: 'card.delete',
        payload: { ideaId: 'idea-main', cardId: 'card-group' },
      }, {
        version: 1,
        id: 'delete-v3-result',
        name: 'card.delete',
        payload: { ideaId: 'idea-main', cardId: 'card-conversation-result' },
      }],
    }, 'mcp')
    if (!deleted.ok) {
      store.close()
      throw new Error(JSON.stringify(deleted))
    }
    expect(deleted).toMatchObject({
      ok: true,
      value: {
        version: 3,
        revision: 10,
        commandResults: [
          { commandId: 'delete-v3-group', name: 'card.delete' },
          { commandId: 'delete-v3-result', name: 'card.delete' },
        ],
      },
    })
    const document = await store.logicalDocument()
    expect(document).toMatchObject({ ok: true, value: { head: { revision: 10 } } })
    if (!document.ok) throw new Error('Surface v3 domain fixture did not project')
    expect(document.value.records.find(({ recordId }) => recordId === 'card-note'))
      .toMatchObject({ kind: 'card', payload: expect.not.objectContaining({ groupId: expect.anything() }) })
    expect(document.value.records.find(({ recordId }) => recordId === 'card-ask'))
      .toMatchObject({ kind: 'card', payload: expect.not.objectContaining({ groupId: expect.anything() }) })
    expect(document.value.records.find((record) => (
      record.kind === 'intent-event'
      && (record.payload as { type?: unknown }).type === 'card.deleted'
      && (record.payload as { cardId?: unknown }).cardId === 'card-group'
    ))?.payload).toMatchObject({
      data: { memberIds: ['card-ask', 'card-note'] },
    })
    expect(document.value.records.some(({ recordId }) => recordId === 'card-group')).toBe(false)
    expect(document.value.records.some(({ recordId }) => (
      recordId === 'card-conversation-result'
      || recordId === 'output-conversation'
      || recordId === 'version-conversation-1'
    ))).toBe(false)
    store.close()

    const reopened = createSqliteProfileRevisionStore(options)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 10 } },
    })
    reopened.close()
  })

  it('queries one complete fenced logical revision without hydrating asset bytes', async () => {
    const databasePath = disposableDatabasePath()
    const fixture = createCompleteProfileFixture()
    let hydratedAssets = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: fixture.snapshot,
      materializeAsset: fixture.projectAsset,
      hydrateAsset: (payload) => {
        hydratedAssets += 1
        return fixture.hydrateAsset(payload)
      },
      openRuntime: openTestRuntime,
    })

    const first = await store.query({
      recordKinds: ['logical-asset'],
      ownerIds: ['board:idea-main'],
    })
    expect(first).toMatchObject({
      ok: true,
      value: {
        profileId: 'profile-synthetic',
        revision: 7,
        truncated: false,
        items: [{
          kind: 'logical-asset',
          ownerId: 'board:idea-main',
          recordVersion: PROFILE_CONTRACT_VERSIONS.record,
        }],
      },
    })
    expect(JSON.stringify(first)).not.toContain('dataUrl')
    expect(hydratedAssets).toBe(0)
    expect(await store.query({
      recordKinds: ['logical-asset'],
      ownerIds: ['board:idea-main'],
    })).toEqual(first)
    expect(hydratedAssets).toBe(0)
    const logical = await store.logicalDocument()
    expect(logical).toMatchObject({
      ok: true,
      value: { head: { profileId: 'profile-synthetic', revision: 7 } },
    })
    expect(JSON.stringify(logical)).not.toContain('dataUrl')
    expect(hydratedAssets).toBe(0)
    store.close()
  })

  it('inspects a bounded Result closure from one fenced revision without hydrating assets', async () => {
    const databasePath = disposableDatabasePath()
    const fixture = createCompleteProfileFixture()
    let hydratedAssets = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability: ownershipCapabilityFor(databasePath),
      seed: fixture.snapshot,
      materializeAsset: fixture.projectAsset,
      hydrateAsset: (payload) => {
        hydratedAssets += 1
        return fixture.hydrateAsset(payload)
      },
      openRuntime: openTestRuntime,
    })

    const first = await store.inspectResult({
      ideaId: 'idea-main',
      resultCardId: 'card-result',
      limit: 4,
      byteLimit: 65_536,
    })
    expect(first).toMatchObject({
      ok: true,
      value: {
        profileId: 'profile-synthetic',
        revision: 7,
        ideaId: 'idea-main',
        resultCardId: 'card-result',
        truncated: true,
      },
    })
    if (!first.ok || !first.value.nextCursor) throw new Error('Expected a second Result page')
    expect(first.value.items.map(item => `${item.kind}:${item.recordId}`)).toEqual([
      'card:card-result',
      'output:output-result',
      'output-version:version-result-1',
      'run:run-main',
    ])
    const second = await store.inspectResult({
      ideaId: 'idea-main',
      resultCardId: 'card-result',
      limit: 4,
      byteLimit: 65_536,
      cursor: first.value.nextCursor,
    })
    expect(second).toMatchObject({
      ok: true,
      value: {
        items: [
          { kind: 'follow-up-message', recordId: 'follow-up-user-1' },
          { kind: 'follow-up-message', recordId: 'follow-up-assistant-1' },
          { kind: 'output-version', recordId: 'version-empty-containers' },
        ],
        truncated: false,
      },
    })
    expect(JSON.stringify([first, second])).not.toContain('dataUrl')
    expect(hydratedAssets).toBe(0)
    store.close()
  })

  it('preserves independently addressable Mod records and rejects malformed native payloads', async () => {
    const databasePath = disposableDatabasePath()
    const seeded = createStore(databasePath, assetFreeSnapshot())
    seeded.close()

    const template = createUserProfileModTemplate({
      profileId: 'profile-synthetic',
      templateId: 'mod-template-focus',
      createdAt: '2026-07-19T01:00:00.000Z',
      mod: switchMod('FOCUS', ['focus-item']),
    })
    const direct = createDirectProfileModInstance({
      boardRecordId: 'board:idea-main',
      cardId: 'card-note',
      instanceId: 'mod-instance-direct',
      createdAt: '2026-07-19T01:00:00.000Z',
      mod: switchMod('DIRECT', ['direct-item']),
    })
    expect(template.ok).toBe(true)
    expect(direct.ok).toBe(true)
    if (!template.ok || !direct.ok) return
    insertSyntheticModRecords(databasePath, [template.value, direct.value])

    const store = createStore(databasePath)
    expect(await store.readRecord(template.value.recordId)).toEqual({
      ok: true,
      value: {
        ...template.value,
        ordinal: 0,
        createdRevision: 7,
        updatedRevision: 7,
      },
    })
    expect(await store.readRecord(direct.value.recordId)).toEqual({
      ok: true,
      value: {
        ...direct.value,
        ordinal: 0,
        createdRevision: 7,
        updatedRevision: 7,
      },
    })
    expect(await store.applyCommandBatch(revisionEightBatch())).toMatchObject({
      ok: true,
      value: { revision: 8 },
    })
    store.close()

    const reopened = createStore(databasePath)
    expect(await reopened.readRecord(direct.value.recordId)).toMatchObject({
      ok: true,
      value: {
        kind: 'mod-instance',
        payload: { source: { kind: 'direct' } },
        createdRevision: 7,
        updatedRevision: 7,
      },
    })
    reopened.close()

    const corruptor = new DatabaseSync(databasePath)
    try {
      corruptor.prepare(`
UPDATE profile_records
SET payload_json = ?
WHERE record_id = ?
`).run(JSON.stringify({ ...template.value.payload, templateVersion: 0 }), template.value.recordId)
    } finally {
      corruptor.close()
    }

    const corrupted = createStore(databasePath)
    expect(await corrupted.readRecord(template.value.recordId)).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    corrupted.close()

    const malformed = new DatabaseSync(databasePath)
    try {
      malformed.prepare(`
UPDATE profile_records
SET payload_json = '{'
WHERE record_id = ?
`).run(template.value.recordId)
    } finally {
      malformed.close()
    }
    const malformedStore = createStore(databasePath)
    expect(await malformedStore.readRecord(template.value.recordId)).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    malformedStore.close()
  })

  it('classifies malformed JSON in ordinary logical records as recovery-required', async () => {
    const databasePath = disposableDatabasePath()
    const seeded = createStore(databasePath, assetFreeSnapshot())
    seeded.close()

    const malformed = new DatabaseSync(databasePath)
    try {
      malformed.prepare(`
UPDATE profile_records
SET payload_json = '{'
WHERE record_id = 'board:idea-main'
`).run()
    } finally {
      malformed.close()
    }

    const malformedStore = createStore(databasePath)
    expect(await malformedStore.snapshot()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    malformedStore.close()
  })

  it('rolls back an injected precommit failure and retains one live-owner retry', async () => {
    const databasePath = disposableDatabasePath()
    let failBeforeCommit = true
    const store = createStore(databasePath, assetFreeSnapshot(), () => {
      if (!failBeforeCommit) return
      failBeforeCommit = false
      throw new Error('injected before-commit failure')
    })
    const batch = revisionEightBatch()
    const before = await store.snapshot()

    const failed = await store.applyCommandBatch(batch)
    expect(failed).toMatchObject({ ok: false, code: 'internal', currentRevision: 7 })
    expect(await store.snapshot()).toEqual(before)
    expect(store.retryableWork()).toEqual([batch])
    expect(await store.status()).toMatchObject({ ok: true, value: { revision: 7, dirty: 'pending' } })

    const retried = await store.applyCommandBatch(store.retryableWork()[0])
    expect(retried).toMatchObject({ ok: true, value: { revision: 8, replayed: false } })
    expect(store.retryableWork()).toEqual([])
    expect(await store.status()).toMatchObject({ ok: true, value: { revision: 8, dirty: 'clean' } })
    const replayed = await store.applyCommandBatch(batch)
    expect(replayed).toMatchObject({ ok: true, value: { revision: 8, replayed: true } })
    const after = await store.snapshot()
    expect(after).toMatchObject({
      ok: true,
      value: { revision: 8, boards: { 'idea-main': { intentLog: [{ id: 'event-note-edited' }] } } },
    })
    store.close()
  })

  it('rejects a capability after its exact sidecar closes and preserves the prior revision', async () => {
    const databasePath = disposableDatabasePath()
    const firstOwner = createOwnershipContext(
      databasePath,
      1,
      'first-owner-token'.repeat(4),
    )
    capabilitiesByProfile.set(databasePath, firstOwner.capability)
    const store = createStore(databasePath, assetFreeSnapshot())
    const before = await store.snapshot()

    firstOwner.runtime.close()
    expect(await store.applyCommandBatch(revisionEightBatch())).toMatchObject({
      ok: false,
      code: 'busy',
    })
    store.close()

    const secondOwner = createOwnershipContext(
      databasePath,
      2,
      'second-owner-token'.repeat(4),
    )
    capabilitiesByProfile.set(databasePath, secondOwner.capability)
    const reopened = createStore(databasePath)
    expect(await reopened.snapshot()).toEqual(before)
    reopened.close()
  })

  it('rejects a stale live capability without committing and permits the newly issued generation', async () => {
    const databasePath = disposableDatabasePath()
    const owner = createOwnershipContext(
      databasePath,
      1,
      'stale-owner-token'.repeat(4),
    )
    capabilitiesByProfile.set(databasePath, owner.capability)
    const store = createStore(databasePath, assetFreeSnapshot())
    const before = await store.snapshot()

    owner.runtime.prepare(`
UPDATE profile_owner_generation
SET generation = 2, owner_token = ?, owner_id = 'replacement-owner'
WHERE identity = 1
`).run('replacement-owner-token'.repeat(4))
    expect(await store.applyCommandBatch(revisionEightBatch())).toMatchObject({
      ok: false,
      code: 'busy',
    })
    store.close()

    const currentCapability = issueSqliteProfileOwnershipCapability({
      profileDatabasePath: databasePath,
      sidecarPath: `${databasePath}.owner.sqlite`,
      sidecarRuntime: owner.runtime,
    })
    expect(Object.keys(currentCapability)).toEqual([])
    capabilitiesByProfile.set(databasePath, currentCapability)
    const reopened = createStore(databasePath)
    expect(await reopened.snapshot()).toEqual(before)
    reopened.close()
  })

  it.each(RECEIPT_CORRUPTIONS)(
    'fails closed instead of acknowledging corrupt replay evidence: %s',
    async (_label, corruptReceipt) => {
      const databasePath = disposableDatabasePath()
      const batch = revisionEightBatch()
      const store = createStore(databasePath, assetFreeSnapshot())
      const committed = await store.applyCommandBatch(batch)
      expect(committed).toMatchObject({ ok: true, value: { revision: 8 } })
      if (!committed.ok) return
      store.close()

      const corruptor = new DatabaseSync(databasePath)
      corruptor.prepare(`
UPDATE profile_revisions
SET receipt_json = ?
WHERE idempotency_key = ?
`).run(JSON.stringify(corruptReceipt(committed.value)), batch.idempotencyKey)
      corruptor.close()

      const reopened = createStore(databasePath)
      expect(await reopened.applyCommandBatch(batch)).toMatchObject({ ok: false, code: 'internal' })
      expect(await reopened.snapshot()).toMatchObject({ ok: true, value: { revision: 8 } })
      expect(reopened.retryableWork()).toEqual([batch])
      reopened.close()
    },
  )

  it('maps the native SQLite lock error to busy and retains the batch for retry', async () => {
    const databasePath = disposableDatabasePath()
    const batch = revisionEightBatch()
    const store = createStore(databasePath, assetFreeSnapshot())
    const blocker = new DatabaseSync(databasePath)
    blocker.exec('BEGIN IMMEDIATE')

    try {
      expect(await store.applyCommandBatch(batch)).toMatchObject({ ok: false, code: 'busy' })
      expect(await store.snapshot()).toMatchObject({ ok: true, value: { revision: 7 } })
      expect(store.retryableWork()).toEqual([batch])
    } finally {
      blocker.exec('ROLLBACK')
      blocker.close()
    }

    expect(await store.applyCommandBatch(store.retryableWork()[0])).toMatchObject({
      ok: true,
      value: { previousRevision: 7, revision: 8, replayed: false },
    })
    store.close()
  })

  it('persists additive Idea lifecycle revisions without fabricating command or Intent receipts', async () => {
    const databasePath = disposableDatabasePath()
    const seed = assetFreeSnapshot()
    const store = createStore(databasePath, seed)
    const input = duplicateIdeaLifecycleInput(seed)

    expect(await store.commitIdeaLifecycleRevision({
      ...input,
      operationId: 'operation-invalid-assets',
      idempotencyKey: 'idempotency-invalid-assets',
      importedAssetIds: ['asset-ghost'],
    })).toMatchObject({ ok: false, code: 'invalid', currentRevision: 7 })
    const committed = await store.commitIdeaLifecycleRevision(input)
    expect(committed).toMatchObject({
      ok: true,
      value: {
        kind: 'duplicate-idea',
        previousRevision: 7,
        revision: 8,
        targetIdeaId: 'idea-copy',
        replayed: false,
      },
    })
    const observed = await store.logicalDocument()
    expect(observed).toMatchObject({
      ok: true,
      value: { head: { revision: 8, activeIdeaId: 'idea-copy' } },
    })
    const database = new DatabaseSync(databasePath, { readOnly: true })
    expect(database.prepare(`
SELECT commit_id, actor_id, actor_kind, actor_transport, idempotency_key,
       batch_digest, batch_json, receipt_json
FROM profile_revisions
WHERE revision = 8
`).get()).toMatchObject({
      commit_id: 'lifecycle:operation-duplicate-1',
      actor_id: 'profile-lifecycle',
      actor_kind: 'system',
      actor_transport: null,
      idempotency_key: null,
      batch_digest: null,
      batch_json: null,
      receipt_json: null,
    })
    expect(database.prepare(`
SELECT kind, operation_id, idempotency_key
FROM profile_lifecycle_events
WHERE revision = 8
`).get()).toEqual({
      kind: 'duplicate-idea',
      operation_id: 'operation-duplicate-1',
      idempotency_key: 'idempotency-duplicate-1',
    })
    expect(database.prepare(`
SELECT updated_revision
FROM profile_records
WHERE record_id = 'card-note'
`).get()).toEqual({ updated_revision: 7 })
    expect(database.prepare(`
SELECT COUNT(*) AS count
FROM profile_records
WHERE kind = 'intent-event' AND created_revision = 8
`).get()).toEqual({ count: 0 })
    database.close()

    expect(await store.commitIdeaLifecycleRevision(input)).toMatchObject({
      ok: true,
      value: { revision: 8, replayed: true },
    })
    expect(await store.commitIdeaLifecycleRevision({
      ...input,
      request: { sourceIdeaId: 'idea-changed' },
    })).toMatchObject({ ok: false, code: 'invalid', currentRevision: 8 })
    expect(await store.applyCommandBatch({
      ...revisionEightBatch(),
      expectedRevision: 8,
      idempotencyKey: input.idempotencyKey,
    })).toMatchObject({ ok: false, code: 'invalid', currentRevision: 8 })

    store.close()
    const reopened = createStore(databasePath)
    expect(await reopened.logicalDocument()).toMatchObject({
      ok: true,
      value: { head: { revision: 8, activeIdeaId: 'idea-copy' } },
    })
    reopened.close()
  })

  it.each(LIFECYCLE_RECEIPT_CORRUPTIONS)(
    'rejects a shape-valid lifecycle receipt whose %s are not closed over the inserted revision',
    async (_label, corruptReceipt) => {
      const databasePath = disposableDatabasePath()
      const seed = assetFreeSnapshot()
      const input = duplicateIdeaLifecycleInput(seed)
      const store = createStore(databasePath, seed)
      expect(await store.commitIdeaLifecycleRevision(input)).toMatchObject({ ok: true })
      store.close()

      const database = new DatabaseSync(databasePath)
      try {
        const row = database.prepare(`
SELECT receipt_json
FROM profile_lifecycle_events
WHERE operation_id = ?
`).get(input.operationId) as { receipt_json?: unknown } | undefined
        if (typeof row?.receipt_json !== 'string') throw new Error('Lifecycle receipt fixture is missing')
        const receipt = JSON.parse(row.receipt_json) as ProfileIdeaLifecycleReceipt
        database.prepare(`
UPDATE profile_lifecycle_events
SET receipt_json = ?
WHERE operation_id = ?
`).run(JSON.stringify(corruptReceipt(receipt)), input.operationId)
      } finally {
        database.close()
      }

      const reopened = createStore(databasePath)
      try {
        expect(await reopened.logicalDocument()).toMatchObject({
          ok: false,
          code: 'corrupt-or-recovery-required',
        })
        expect(await reopened.commitIdeaLifecycleRevision(input)).toMatchObject({
          ok: false,
          code: 'corrupt-or-recovery-required',
        })
      } finally {
        reopened.close()
      }
    },
  )

  it('creates a closed portable-import database stage that preserves source identity and revision', () => {
    const databasePath = disposableDatabasePath()
    const document = projectProfileSnapshot(assetFreeSnapshot(), () => {
      throw new Error('Asset-free import stage unexpectedly projected an asset')
    })

    const stage = createSqliteProfileImportStage({
      databasePath,
      document,
      openRuntime: openTestRuntime,
      now: () => '2026-01-03T00:00:03.000Z',
    })

    expect(existsSync(databasePath)).toBe(true)
    expect(existsSync(`${databasePath}-wal`)).toBe(false)
    expect(existsSync(`${databasePath}-shm`)).toBe(false)
    const evidence = claimSqliteProfileImportStage(stage)
    expect(evidence).toMatchObject({
      databasePath,
      profileId: 'profile-synthetic',
      revision: 7,
      blobRoots: [],
    })
    expect(evidence.databaseDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(evidence.databaseSize).toBeGreaterThan(0)
    expect(() => claimSqliteProfileImportStage(stage)).toThrow('capability is invalid')

    expect(inspectSqliteProfileRevisionDatabase({
      databasePath,
      openRuntime: openTestRuntime,
    })).toMatchObject({
      profileId: 'profile-synthetic',
      revision: 7,
      blobRoots: [],
    })
    const database = new DatabaseSync(databasePath, { readOnly: true })
    expect(database.prepare('SELECT COUNT(*) AS count FROM profile_owner_fence').get())
      .toEqual({ count: 0 })
    expect(database.prepare('SELECT revision, previous_revision FROM profile_revisions').get())
      .toEqual({ revision: 7, previous_revision: null })
    database.close()
  })

  it('refuses a portable-import database stage changed before publication', () => {
    const databasePath = disposableDatabasePath()
    const stage = createSqliteProfileImportStage({
      databasePath,
      document: projectProfileSnapshot(assetFreeSnapshot(), () => {
        throw new Error('Asset-free import stage unexpectedly projected an asset')
      }),
      openRuntime: openTestRuntime,
    })

    appendFileSync(databasePath, Buffer.from('changed-after-stage'))
    expect(() => claimSqliteProfileImportStage(stage)).toThrow(
      'SQLite Profile import stage changed before publication',
    )
  })
})

function rewriteHistoricalMatrixStampProvenance(
  databasePath: string,
  revision: number,
  instanceId: string,
  eventId: string,
  replacementSourceIds: readonly [string, string, string, string, string],
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const agentRow = database.prepare(`
SELECT installed_surface_version, client_txn_id, actor_transport,
       request_json, receipt_json, command_bindings_json, committed_at
FROM profile_agent_command_events
WHERE revision = ?
`).get(revision) as {
      installed_surface_version?: unknown
      client_txn_id?: unknown
      actor_transport?: unknown
      request_json?: unknown
      receipt_json?: unknown
      command_bindings_json?: unknown
      committed_at?: unknown
    } | undefined
    if (!agentRow
      || agentRow.installed_surface_version !== 2
      || typeof agentRow.client_txn_id !== 'string'
      || (agentRow.actor_transport !== 'cli' && agentRow.actor_transport !== 'mcp')
      || typeof agentRow.request_json !== 'string'
      || typeof agentRow.receipt_json !== 'string'
      || typeof agentRow.command_bindings_json !== 'string'
      || typeof agentRow.committed_at !== 'string') {
      throw new Error('Historical matrix Agent row fixture is missing')
    }
    const storedRequest = JSON.parse(agentRow.request_json) as {
      request?: ProfileAgentCommandRequest
      context?: {
        profileId?: unknown
        actor?: { id?: unknown }
        clientTxnId?: unknown
      }
    }
    if (!storedRequest.request
      || typeof storedRequest.context?.profileId !== 'string'
      || typeof storedRequest.context.actor?.id !== 'string'
      || storedRequest.context.clientTxnId !== agentRow.client_txn_id) {
      throw new Error('Historical matrix request evidence fixture is invalid')
    }
    const receipt = JSON.parse(agentRow.receipt_json) as ProfileAgentCommandBatchReceipt
    const result = receipt.commandResults[0]
    const command = storedRequest.request.commands[0]
    if (receipt.version !== 2
      || receipt.commitId === null
      || result?.name !== 'mod-instance.stamp'
      || command?.name !== 'mod-instance.stamp'
      || result.instanceId !== instanceId
      || receipt.intentEventIds[0] !== eventId
      || result.idMap.controls.length !== replacementSourceIds.length) {
      throw new Error('Historical matrix stamp receipt fixture is invalid')
    }
    const requestCanonicalJson = canonicalProfileJson({
      version: storedRequest.request.version,
      schemaVersion: storedRequest.request.schemaVersion,
      expectedRevision: storedRequest.request.expectedRevision,
      commands: storedRequest.request.commands,
    })
    const replacementIds = replacementSourceIds.map((sourceId, ordinal) => {
      const scope = {
        profileId: storedRequest.context!.profileId,
        actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
        idempotencyKey: storedRequest.request!.idempotencyKey,
        requestCanonicalJson,
        commandId: command.id,
        purpose: 'mod-control',
        sourceId,
        ordinal,
      }
      const digest = createHash('sha256').update(canonicalProfileJson(scope)).digest('hex')
      return `agent-mod-control-${digest.slice(0, 40)}`
    })
    const tamperedIdMap = {
      mod: { ...result.idMap.mod },
      controls: result.idMap.controls.map((pair, index) => ({
        ...pair,
        sourceId: replacementSourceIds[index]!,
        instanceId: replacementIds[index]!,
      })),
    }
    const tamperedResult = { ...result, idMap: tamperedIdMap }
    const tamperedReceipt = {
      ...receipt,
      commandResults: [tamperedResult],
    } as ProfileAgentCommandBatchReceipt
    const storedBindings = JSON.parse(agentRow.command_bindings_json) as unknown
    if (!Array.isArray(storedBindings)) {
      throw new Error('Historical matrix stamp bindings fixture is invalid')
    }
    const storedBinding = storedBindings.find((candidate) => (
      candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && (candidate as Record<string, unknown>).commandId === command.id
    )) as Record<string, unknown> | undefined
    const storedProvenance = storedBinding?.stampProvenance
    if (!storedProvenance || typeof storedProvenance !== 'object'
      || Array.isArray(storedProvenance)) {
      throw new Error('Historical matrix stamp provenance fixture is invalid')
    }
    const templateFrame = (storedProvenance as Record<string, unknown>).templateFrame
    if (!templateFrame || typeof templateFrame !== 'object' || Array.isArray(templateFrame)) {
      throw new Error('Historical matrix stamp template frame fixture is invalid')
    }

    const rows = database.prepare(`
SELECT record_id, change_kind, before_json, after_json
FROM profile_agent_command_record_changes
WHERE revision = ?
ORDER BY record_id
`).all(revision) as Array<{
      record_id: string
      change_kind: 'insert' | 'update' | 'delete'
      before_json: string | null
      after_json: string | null
    }>
    const changes = rows.map((row) => ({
      recordId: row.record_id,
      changeKind: row.change_kind,
      before: row.before_json === null ? null : JSON.parse(row.before_json) as Record<string, unknown>,
      after: row.after_json === null ? null : JSON.parse(row.after_json) as Record<string, unknown>,
    }))
    const instanceChange = changes.find((change) => change.recordId === instanceId)
    const eventChange = changes.find((change) => change.recordId === eventId)
    if (!instanceChange?.after || !eventChange?.after) {
      throw new Error('Historical matrix transition fixture is missing')
    }
    const instancePayload = instanceChange.after.payload
    const eventPayload = eventChange.after.payload
    if (!instancePayload || typeof instancePayload !== 'object' || Array.isArray(instancePayload)
      || !eventPayload || typeof eventPayload !== 'object' || Array.isArray(eventPayload)) {
      throw new Error('Historical matrix transition payload fixture is invalid')
    }
    const rewriteMatrix = (
      candidate: unknown,
      identities: readonly string[],
    ): Record<string, unknown> => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error('Historical matrix Mod fixture is invalid')
      }
      const mod = structuredClone(candidate) as Record<string, unknown>
      const state = mod.state
      if (mod.kind !== 'matrix' || !state || typeof state !== 'object' || Array.isArray(state)) {
        throw new Error('Historical matrix Mod state fixture is invalid')
      }
      const rows = (state as Record<string, unknown>).rows
      const columns = (state as Record<string, unknown>).cols
      if (!Array.isArray(rows) || rows.length !== 2
        || !Array.isArray(columns) || columns.length !== 3) {
        throw new Error('Historical matrix nested identity fixture is invalid')
      }
      rows.forEach((row, index) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          throw new Error('Historical matrix row fixture is invalid')
        }
        ;(row as Record<string, unknown>).id = identities[index]!
      })
      columns.forEach((column, index) => {
        if (!column || typeof column !== 'object' || Array.isArray(column)) {
          throw new Error('Historical matrix column fixture is invalid')
        }
        ;(column as Record<string, unknown>).id = identities[index + rows.length]!
      })
      return mod
    }
    instanceChange.after = {
      ...instanceChange.after,
      payload: {
        ...instancePayload,
        idMap: tamperedIdMap,
        mod: rewriteMatrix((instancePayload as Record<string, unknown>).mod, replacementIds),
      },
    }
    const eventData = (eventPayload as Record<string, unknown>).data
    if (!eventData || typeof eventData !== 'object' || Array.isArray(eventData)) {
      throw new Error('Historical matrix Intent data fixture is invalid')
    }
    const eventCard = (eventData as Record<string, unknown>).card
    if (!eventCard || typeof eventCard !== 'object' || Array.isArray(eventCard)) {
      throw new Error('Historical matrix Intent Card fixture is invalid')
    }
    eventChange.after = {
      ...eventChange.after,
      payload: {
        ...eventPayload,
        data: {
          ...eventData,
          card: {
            ...eventCard,
            modV2: rewriteMatrix((eventCard as Record<string, unknown>).modV2, replacementIds),
          },
        },
      },
    }

    const tamperedEventPayload = eventChange.after.payload as Record<string, unknown>
    const {
      id: _id,
      at: _at,
      ideaId: _ideaId,
      commitId: _commitId,
      actorId: _actorId,
      clientTxnId: _clientTxnId,
      seq: _seq,
      data,
      ...semanticEvent
    } = tamperedEventPayload
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Historical matrix semantic Intent fixture is invalid')
    }
    const {
      claimedTransitionEvidence: _claimedTransitionEvidence,
      ...semanticData
    } = data as Record<string, unknown>
    const semanticIntent = { ...semanticEvent, data: semanticData }
    const tamperedPlan = attachAgentClaimedTransitionEvidence(
      storedRequest.request,
      {
        commandResults: [tamperedResult],
        intentEventDrafts: [{ ideaId: command.payload.ideaId, event: semanticIntent }],
        profileAgentEventDrafts: [],
        recordChanges: changes.filter((change) => {
          const kind = (change.after ?? change.before)?.kind
          return kind !== 'board'
            && kind !== 'intent-event'
            && kind !== 'profile-agent-event'
        }).map((change) => {
          if (change.changeKind === 'insert') {
            return { operation: 'insert', after: change.after }
          }
          if (change.changeKind === 'update') {
            return { operation: 'replace', before: change.before, after: change.after }
          }
          return { operation: 'delete', before: change.before }
        }),
      } as unknown as ProfileAgentCommandPlan,
      {
        installedSurfaceVersion: 2,
        profileId: storedRequest.context.profileId,
        actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
        transport: agentRow.actor_transport,
        clientTxnId: agentRow.client_txn_id,
        commitId: receipt.commitId,
        committedAt: agentRow.committed_at,
      },
      (record) => createHash('sha256').update(canonicalProfileJson(record)).digest('hex'),
    )
    const attachedEvent = tamperedPlan?.intentEventDrafts[0]?.event
    const attachedData = attachedEvent && typeof attachedEvent === 'object'
      && !Array.isArray(attachedEvent)
      ? attachedEvent.data
      : undefined
    const evidence = attachedData && typeof attachedData === 'object'
      && !Array.isArray(attachedData)
      ? attachedData.claimedTransitionEvidence
      : undefined
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      throw new Error('Historical matrix outcome attestation fixture is invalid')
    }
    const rewrittenEventPayload = {
      ...tamperedEventPayload,
      data: { ...data, claimedTransitionEvidence: evidence },
    }
    eventChange.after = { ...eventChange.after, payload: rewrittenEventPayload }

    for (const change of changes) {
      database.prepare(`
UPDATE profile_agent_command_record_changes
SET before_json = ?, after_json = ?
WHERE revision = ? AND record_id = ?
`).run(
        change.before === null ? null : canonicalProfileJson(change.before),
        change.after === null ? null : canonicalProfileJson(change.after),
        revision,
        change.recordId,
      )
    }
    database.prepare(`
UPDATE profile_records
SET payload_json = ?
WHERE record_id = ?
`).run(canonicalProfileJson(instanceChange.after.payload), instanceId)
    database.prepare(`
UPDATE profile_records
SET payload_json = ?
WHERE record_id = ?
`).run(canonicalProfileJson(rewrittenEventPayload), eventId)
    const receiptJson = canonicalProfileJson(tamperedReceipt)
    const changesJson = canonicalProfileJson(changes)
    const frame = templateFrame as Record<string, unknown>
    const framePayload = frame.payload
    if (!framePayload || typeof framePayload !== 'object' || Array.isArray(framePayload)) {
      throw new Error('Historical matrix stamp template payload frame fixture is invalid')
    }
    const rewrittenSourceTemplate = {
      ...frame,
      payload: {
        ...framePayload,
        mod: rewriteMatrix(
          (instanceChange.after.payload as Record<string, unknown>).mod,
          replacementSourceIds,
        ),
      },
    }
    const rewrittenStampProvenance = {
      ...storedProvenance,
      templateDigest: createHash('sha256')
        .update(canonicalProfileJson(rewrittenSourceTemplate))
        .digest('hex'),
    }
    const bindingsJson = canonicalProfileJson([{
      commandId: command.id,
      events: [{
        eventKind: 'intent-event',
        eventId,
        role: 'mod-instance-stamped',
        evidence,
      }],
      stampProvenance: rewrittenStampProvenance,
    }])
    database.prepare(`
UPDATE profile_agent_command_events
SET receipt_json = ?, receipt_digest = ?, changes_digest = ?, command_bindings_json = ?
WHERE revision = ?
`).run(
      receiptJson,
      createHash('sha256').update(receiptJson).digest('hex'),
      createHash('sha256').update(changesJson).digest('hex'),
      bindingsJson,
      revision,
    )
  } finally {
    database.close()
  }
}

function rewriteHistoricalModIdentityProvenance(
  databasePath: string,
  revision: number,
  instanceId: string,
  tamper: 'provenance' | 'no-op-accent' | 'card-position',
): void {
  const database = new DatabaseSync(databasePath)
  const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  )
  try {
    const agentRow = database.prepare(`
SELECT installed_surface_version, client_txn_id, actor_transport,
       request_json, receipt_json, command_bindings_json, committed_at
FROM profile_agent_command_events
WHERE revision = ?
`).get(revision) as {
      installed_surface_version?: unknown
      client_txn_id?: unknown
      actor_transport?: unknown
      request_json?: unknown
      receipt_json?: unknown
      command_bindings_json?: unknown
      committed_at?: unknown
    } | undefined
    if (!agentRow
      || agentRow.installed_surface_version !== 5
      || typeof agentRow.client_txn_id !== 'string'
      || (agentRow.actor_transport !== 'cli' && agentRow.actor_transport !== 'mcp')
      || typeof agentRow.request_json !== 'string'
      || typeof agentRow.receipt_json !== 'string'
      || typeof agentRow.command_bindings_json !== 'string'
      || typeof agentRow.committed_at !== 'string') {
      throw new Error('Historical Mod identity Agent row fixture is missing')
    }
    const storedRequest = JSON.parse(agentRow.request_json) as {
      request?: ProfileAgentCommandRequest
      context?: { profileId?: unknown }
    }
    const receipt = JSON.parse(agentRow.receipt_json) as ProfileAgentCommandBatchReceipt
    const command = storedRequest.request?.commands[0]
    const result = receipt.commandResults[0]
    const eventId = receipt.intentEventIds[0]
    if (typeof storedRequest.context?.profileId !== 'string'
      || receipt.commitId === null
      || command?.name !== 'card.set-identity'
      || result?.name !== 'card.set-identity'
      || !eventId) {
      throw new Error('Historical Mod identity request fixture is invalid')
    }

    const rows = database.prepare(`
SELECT record_id, change_kind, before_json, after_json
FROM profile_agent_command_record_changes
WHERE revision = ?
ORDER BY record_id
`).all(revision) as Array<{
      record_id: string
      change_kind: 'insert' | 'update' | 'delete'
      before_json: string | null
      after_json: string | null
    }>
    const changes = rows.map((row) => ({
      recordId: row.record_id,
      changeKind: row.change_kind,
      before: row.before_json === null ? null : JSON.parse(row.before_json) as Record<string, unknown>,
      after: row.after_json === null ? null : JSON.parse(row.after_json) as Record<string, unknown>,
    }))
    const instanceChange = changes.find((change) => change.recordId === instanceId)
    const cardChange = changes.find((change) => change.recordId === result.cardId)
    const eventChange = changes.find((change) => change.recordId === eventId)
    if (instanceChange?.changeKind !== 'update'
      || !instanceChange.before
      || !instanceChange.after
      || cardChange?.changeKind !== 'update'
      || !cardChange.before
      || !cardChange.after
      || eventChange?.changeKind !== 'insert'
      || !eventChange.after
      || !isRecord(instanceChange.before.payload)
      || !isRecord(instanceChange.after.payload)
      || !isRecord(cardChange.before.payload)
      || !isRecord(cardChange.after.payload)
      || !isRecord(eventChange.after.payload)) {
      throw new Error('Historical Mod identity transition fixture is invalid')
    }
    if (tamper === 'provenance') {
      instanceChange.after = {
        ...instanceChange.after,
        payload: {
          ...instanceChange.after.payload,
          createdAt: '2026-08-05T00:00:09.000Z',
        },
      }
    } else if (tamper === 'no-op-accent') {
      if (!isRecord(instanceChange.before.payload.mod)) {
        throw new Error('Historical Mod identity before-Mod fixture is invalid')
      }
      instanceChange.before = {
        ...instanceChange.before,
        payload: {
          ...instanceChange.before.payload,
          mod: { ...instanceChange.before.payload.mod, accent: '#3568c6' },
        },
      }
    } else {
      if (!isRecord(cardChange.after.payload.position)
        || typeof cardChange.after.payload.position.x !== 'number') {
        throw new Error('Historical Mod identity Card position fixture is invalid')
      }
      cardChange.after = {
        ...cardChange.after,
        payload: {
          ...cardChange.after.payload,
          position: {
            ...cardChange.after.payload.position,
            x: cardChange.after.payload.position.x + 37,
          },
        },
      }
    }

    const eventPayload = eventChange.after.payload
    if (!isRecord(eventPayload.data)) {
      throw new Error('Historical Mod identity Intent fixture is invalid')
    }
    const {
      id: _id,
      at: _at,
      ideaId: _ideaId,
      commitId: _commitId,
      actorId: _actorId,
      clientTxnId: _clientTxnId,
      seq: _seq,
      data,
      ...semanticEvent
    } = eventPayload
    const {
      claimedTransitionEvidence: _claimedTransitionEvidence,
      ...semanticData
    } = data as Record<string, unknown>
    const shapes = changes.flatMap((change) => {
      const record = change.after ?? change.before
      if (!record || (record.kind !== 'card' && record.kind !== 'mod-instance')) return []
      return [{
        recordId: change.recordId,
        kind: record.kind,
        operation: change.changeKind,
        beforeDigest: change.before === null
          ? null
          : createHash('sha256').update(canonicalProfileJson(change.before)).digest('hex'),
        afterDigest: change.after === null
          ? null
          : createHash('sha256').update(canonicalProfileJson(change.after)).digest('hex'),
        claim: 'record-last-write',
      }]
    }).sort((left, right) => {
      const leftCanonical = canonicalProfileJson(left)
      const rightCanonical = canonicalProfileJson(right)
      return leftCanonical < rightCanonical ? -1 : leftCanonical > rightCanonical ? 1 : 0
    })
    const commitment = canonicalProfileJson({
      eventVersion: 1,
      installedSurfaceVersion: 5,
      request: storedRequest.request,
      trustedContext: {
        profileId: storedRequest.context.profileId,
        actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
        transport: agentRow.actor_transport,
        clientTxnId: agentRow.client_txn_id,
        commitId: receipt.commitId,
        committedAt: agentRow.committed_at,
      },
      commandIndex: 0,
      command,
      result,
      eventRole: 'card-identity-set',
      intent: { ...semanticEvent, data: semanticData },
      shapes,
    })
    const evidence = {
      version: 1,
      count: shapes.length,
      sha256: createHash('sha256')
        .update(`eido.agent-command-outcome.v1\0${commitment}`)
        .digest('hex'),
    }
    eventChange.after = {
      ...eventChange.after,
      payload: {
        ...eventPayload,
        data: { ...data, claimedTransitionEvidence: evidence },
      },
    }

    for (const change of [instanceChange, cardChange, eventChange]) {
      database.prepare(`
UPDATE profile_agent_command_record_changes
SET before_json = ?, after_json = ?
WHERE revision = ? AND record_id = ?
`).run(
        change.before === null ? null : canonicalProfileJson(change.before),
        canonicalProfileJson(change.after),
        revision,
        change.recordId,
      )
      database.prepare(`
UPDATE profile_records
SET payload_json = ?
WHERE record_id = ?
`).run(canonicalProfileJson(change.after!.payload), change.recordId)
    }

    const bindings = JSON.parse(agentRow.command_bindings_json) as Array<Record<string, unknown>>
    const binding = bindings.find((candidate) => candidate.commandId === command.id)
    if (!binding || !Array.isArray(binding.events) || !isRecord(binding.events[0])) {
      throw new Error('Historical Mod identity binding fixture is invalid')
    }
    binding.events[0] = { ...binding.events[0], evidence }
    const changesJson = canonicalProfileJson(changes)
    database.prepare(`
UPDATE profile_agent_command_events
SET changes_digest = ?, command_bindings_json = ?
WHERE revision = ?
`).run(
      createHash('sha256').update(changesJson).digest('hex'),
      canonicalProfileJson(bindings),
      revision,
    )
  } finally {
    database.close()
  }
}

function createStore(
  databasePath: string,
  seed?: ProfileSnapshot,
  beforeCommit?: () => void,
) {
  return createSqliteProfileRevisionStore({
    databasePath,
    ownershipCapability: ownershipCapabilityFor(databasePath),
    ...(seed ? { seed } : {}),
    openRuntime: openTestRuntime,
    now: () => '2026-01-03T00:00:01.000Z',
    createCommitId: () => 'commit-note-edited',
    createIntentEventId: () => 'event-note-edited',
    ...(beforeCommit ? { testHooks: { beforeCommit } } : {}),
  })
}

function rewriteAgentBeforeEvidenceAndDigest(
  databasePath: string,
  revision: number,
  recordId: string,
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const rows = database.prepare(`
SELECT record_id, change_kind, before_json, after_json
FROM profile_agent_command_record_changes
WHERE revision = ?
ORDER BY record_id
`).all(revision) as Array<{
      record_id: string
      change_kind: 'insert' | 'update' | 'delete'
      before_json: string | null
      after_json: string | null
    }>
    const changes = rows.map((row) => ({
      recordId: row.record_id,
      changeKind: row.change_kind,
      before: row.before_json === null ? null : JSON.parse(row.before_json) as Record<string, unknown>,
      after: row.after_json === null ? null : JSON.parse(row.after_json) as Record<string, unknown>,
    }))
    const target = changes.find((change) => change.recordId === recordId)
    if (!target?.before || target.changeKind !== 'delete') {
      throw new Error('Agent delete transition fixture is missing')
    }
    const payload = target.before.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Agent delete transition payload fixture is invalid')
    }
    const position = (payload as Record<string, unknown>).position
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw new Error('Agent delete transition position fixture is invalid')
    }
    const x = (position as Record<string, unknown>).x
    if (typeof x !== 'number') throw new Error('Agent delete transition x fixture is invalid')
    target.before = {
      ...target.before,
      payload: {
        ...payload,
        position: { ...position, x: x + 1 },
      },
    }
    database.prepare(`
UPDATE profile_agent_command_record_changes
SET before_json = ?
WHERE revision = ? AND record_id = ? AND change_kind = 'delete'
`).run(canonicalProfileJson(target.before), revision, recordId)
    const changesJson = canonicalProfileJson(changes)
    database.prepare(`
UPDATE profile_agent_command_events
SET changes_digest = ?
WHERE revision = ?
`).run(createHash('sha256').update(changesJson).digest('hex'), revision)
  } finally {
    database.close()
  }
}

function rewriteAgentIntentDataAndDigest(
  databasePath: string,
  revision: number,
  eventId: string,
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const record = database.prepare(`
SELECT payload_json
FROM profile_records
WHERE record_id = ?
`).get(eventId) as { payload_json?: unknown } | undefined
    if (typeof record?.payload_json !== 'string') throw new Error('Intent binding record fixture is missing')
    const payload = JSON.parse(record.payload_json) as Record<string, unknown>
    const data = payload.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Intent binding data fixture is invalid')
    }
    const textLength = (data as Record<string, unknown>).textLength
    if (typeof textLength !== 'number') throw new Error('Intent binding length fixture is invalid')
    payload.data = { ...data, textLength: textLength + 1 }
    database.prepare(`
UPDATE profile_records
SET payload_json = ?
WHERE record_id = ?
`).run(canonicalProfileJson(payload), eventId)

    const rows = database.prepare(`
SELECT record_id, change_kind, before_json, after_json
FROM profile_agent_command_record_changes
WHERE revision = ?
ORDER BY record_id
`).all(revision) as Array<{
      record_id: string
      change_kind: 'insert' | 'update' | 'delete'
      before_json: string | null
      after_json: string | null
    }>
    const changes = rows.map((row) => ({
      recordId: row.record_id,
      changeKind: row.change_kind,
      before: row.before_json === null ? null : JSON.parse(row.before_json) as Record<string, unknown>,
      after: row.after_json === null ? null : JSON.parse(row.after_json) as Record<string, unknown>,
    }))
    const eventChange = changes.find((change) => change.recordId === eventId)
    if (!eventChange?.after) throw new Error('Intent binding transition fixture is missing')
    eventChange.after = { ...eventChange.after, payload }
    database.prepare(`
UPDATE profile_agent_command_record_changes
SET after_json = ?
WHERE revision = ? AND record_id = ?
`).run(canonicalProfileJson(eventChange.after), revision, eventId)
    const changesJson = canonicalProfileJson(changes)
    database.prepare(`
UPDATE profile_agent_command_events
SET changes_digest = ?
WHERE revision = ?
`).run(createHash('sha256').update(changesJson).digest('hex'), revision)
  } finally {
    database.close()
  }
}

function rewriteStoredAgentRequestText(
  databasePath: string,
  revision: number,
  commandIndex: number,
  text: string,
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database.prepare(`
SELECT request_json
FROM profile_agent_command_events
WHERE revision = ?
`).get(revision) as { request_json?: unknown } | undefined
    if (typeof row?.request_json !== 'string') throw new Error('Agent request fixture is missing')
    const envelope = JSON.parse(row.request_json) as {
      request?: { commands?: Array<{ payload?: Record<string, unknown> }> }
    }
    const command = envelope.request?.commands?.[commandIndex]
    if (!command?.payload) throw new Error('Agent request command fixture is missing')
    command.payload.text = text
    const requestJson = canonicalProfileJson(envelope)
    database.prepare(`
UPDATE profile_agent_command_events
SET request_json = ?, request_digest = ?
WHERE revision = ?
`).run(
      requestJson,
      createHash('sha256').update(requestJson).digest('hex'),
      revision,
    )
  } finally {
    database.close()
  }
}

function rewriteNetZeroAgentBlockTarget(
  databasePath: string,
  revision: number,
  cardId: string,
  blockId: string,
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database.prepare(`
SELECT request_json, receipt_json
FROM profile_agent_command_events
WHERE revision = ?
`).get(revision) as { request_json?: unknown; receipt_json?: unknown } | undefined
    if (typeof row?.request_json !== 'string' || typeof row.receipt_json !== 'string') {
      throw new Error('Net-zero Agent fixture is missing')
    }
    const envelope = JSON.parse(row.request_json) as {
      request?: { commands?: Array<{ payload?: Record<string, unknown> }> }
    }
    const receipt = JSON.parse(row.receipt_json) as ProfileAgentCommandBatchReceipt
    if (envelope.request?.commands?.length !== 2
      || receipt.commandResults.length !== 2
      || receipt.intentEventIds.length !== 2) {
      throw new Error('Net-zero Agent command fixture changed')
    }
    for (const command of envelope.request.commands) {
      if (!command.payload) throw new Error('Net-zero Agent request payload is missing')
      command.payload.cardId = cardId
      command.payload.blockId = blockId
    }
    const commandResults = receipt.commandResults.map((result) => ({
      ...result,
      cardId,
      blockId,
    })) as ProfileAgentCommandBatchReceipt['commandResults']
    const requestJson = canonicalProfileJson(envelope)
    database.prepare(`
UPDATE profile_agent_command_events
SET request_json = ?, request_digest = ?
WHERE revision = ?
`).run(
      requestJson,
      createHash('sha256').update(requestJson).digest('hex'),
      revision,
    )
    rewriteAgentReceipt(database, revision, (stored) => ({ ...stored, commandResults }))

    for (const eventId of receipt.intentEventIds) {
      const record = database.prepare(`
SELECT payload_json
FROM profile_records
WHERE record_id = ?
`).get(eventId) as { payload_json?: unknown } | undefined
      if (typeof record?.payload_json !== 'string') {
        throw new Error('Net-zero Agent Intent record is missing')
      }
      const payload = JSON.parse(record.payload_json) as Record<string, unknown>
      payload.cardId = cardId
      const payloadJson = canonicalProfileJson(payload)
      database.prepare(`
UPDATE profile_records
SET payload_json = ?
WHERE record_id = ?
`).run(payloadJson, eventId)

      const change = database.prepare(`
SELECT after_json
FROM profile_agent_command_record_changes
WHERE revision = ? AND record_id = ? AND change_kind = 'insert'
`).get(revision, eventId) as { after_json?: unknown } | undefined
      if (typeof change?.after_json !== 'string') {
        throw new Error('Net-zero Agent Intent transition is missing')
      }
      const after = JSON.parse(change.after_json) as Record<string, unknown>
      after.payload = payload
      database.prepare(`
UPDATE profile_agent_command_record_changes
SET after_json = ?
WHERE revision = ? AND record_id = ? AND change_kind = 'insert'
`).run(canonicalProfileJson(after), revision, eventId)
    }
    rehashAgentChanges(database, revision)
  } finally {
    database.close()
  }
}

function rewriteHistoricalAgentPlacementOrTopology(
  databasePath: string,
  revision: number,
  rewriteKind: 'placement' | 'topology',
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database.prepare(`
SELECT request_json, receipt_json
FROM profile_agent_command_events
WHERE revision = ?
`).get(revision) as { request_json?: unknown; receipt_json?: unknown } | undefined
    if (typeof row?.request_json !== 'string' || typeof row.receipt_json !== 'string') {
      throw new Error('Historical Agent rewrite fixture is missing')
    }
    const envelope = JSON.parse(row.request_json) as {
      request?: { commands?: Array<{ payload?: Record<string, unknown> }> }
    }
    const receipt = JSON.parse(row.receipt_json) as ProfileAgentCommandBatchReceipt
    const command = envelope.request?.commands?.[0]
    const result = receipt.commandResults[0]
    const eventId = receipt.intentEventIds[0]
    if (!command?.payload || !result || !eventId) {
      throw new Error('Historical Agent rewrite command fixture changed')
    }

    const rewriteStoredRecord = (
      recordId: string,
      rewritePayload: (payload: Record<string, unknown>) => void,
    ): void => {
      const current = database.prepare(`
SELECT payload_json
FROM profile_records
WHERE record_id = ?
`).get(recordId) as { payload_json?: unknown } | undefined
      const change = database.prepare(`
SELECT after_json
FROM profile_agent_command_record_changes
WHERE revision = ? AND record_id = ? AND change_kind = 'insert'
`).get(revision, recordId) as { after_json?: unknown } | undefined
      if (typeof current?.payload_json !== 'string' || typeof change?.after_json !== 'string') {
        throw new Error(`Historical Agent record ${recordId} is missing`)
      }
      const payload = JSON.parse(current.payload_json) as Record<string, unknown>
      rewritePayload(payload)
      const after = JSON.parse(change.after_json) as Record<string, unknown>
      after.payload = payload
      database.prepare(`
UPDATE profile_records
SET payload_json = ?
WHERE record_id = ?
`).run(canonicalProfileJson(payload), recordId)
      database.prepare(`
UPDATE profile_agent_command_record_changes
SET after_json = ?
WHERE revision = ? AND record_id = ? AND change_kind = 'insert'
`).run(canonicalProfileJson(after), revision, recordId)
    }

    if (rewriteKind === 'placement') {
      if (result.name !== 'card.create') throw new Error('Historical placement result changed')
      const requestedPosition = command.payload.position
      if (!requestedPosition || typeof requestedPosition !== 'object'
        || Array.isArray(requestedPosition)
        || typeof (requestedPosition as Record<string, unknown>).x !== 'number') {
        throw new Error('Historical placement request is invalid')
      }
      const nextX = Number((requestedPosition as Record<string, unknown>).x) + 37
      command.payload.position = { ...requestedPosition, x: nextX }
      rewriteStoredRecord(result.cardId, (payload) => {
        if (!payload.position || typeof payload.position !== 'object'
          || Array.isArray(payload.position)) throw new Error('Historical Card position is invalid')
        payload.position = { ...payload.position, x: nextX }
      })
      rewriteStoredRecord(eventId, (payload) => {
        if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
          throw new Error('Historical card.created data is invalid')
        }
        const data = payload.data as Record<string, unknown>
        if (!data.card || typeof data.card !== 'object' || Array.isArray(data.card)) {
          throw new Error('Historical card.created Card is invalid')
        }
        const card = data.card as Record<string, unknown>
        if (!card.position || typeof card.position !== 'object' || Array.isArray(card.position)) {
          throw new Error('Historical card.created position is invalid')
        }
        data.card = { ...card, position: { ...card.position, x: nextX } }
      })
    } else {
      if (result.name !== 'connection.create') throw new Error('Historical topology result changed')
      const from = command.payload.from
      const to = command.payload.to
      if (!from || typeof from !== 'object' || Array.isArray(from)
        || !to || typeof to !== 'object' || Array.isArray(to)) {
        throw new Error('Historical topology request is invalid')
      }
      command.payload.from = to
      command.payload.to = from
      const connectionId = result.connectionIds[0]
      if (!connectionId) throw new Error('Historical topology Connection is missing')
      const swapConnection = (connection: Record<string, unknown>): void => {
        const connectionFrom = connection.from
        const connectionTo = connection.to
        if (!connectionFrom || typeof connectionFrom !== 'object' || Array.isArray(connectionFrom)
          || !connectionTo || typeof connectionTo !== 'object' || Array.isArray(connectionTo)) {
          throw new Error('Historical Connection topology is invalid')
        }
        connection.from = connectionTo
        connection.to = connectionFrom
      }
      rewriteStoredRecord(connectionId, swapConnection)
      rewriteStoredRecord(eventId, (payload) => {
        if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
          throw new Error('Historical connection.created data is invalid')
        }
        const data = payload.data as Record<string, unknown>
        if (!data.connection || typeof data.connection !== 'object'
          || Array.isArray(data.connection)) {
          throw new Error('Historical connection.created Connection is invalid')
        }
        swapConnection(data.connection as Record<string, unknown>)
      })
    }

    const requestJson = canonicalProfileJson(envelope)
    database.prepare(`
UPDATE profile_agent_command_events
SET request_json = ?, request_digest = ?
WHERE revision = ?
`).run(
      requestJson,
      createHash('sha256').update(requestJson).digest('hex'),
      revision,
    )
    rehashAgentChanges(database, revision)
  } finally {
    database.close()
  }
}

function rewriteStoredAgentRequestAsModCreate(
  databasePath: string,
  revision: number,
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database.prepare(`
SELECT request_json
FROM profile_agent_command_events
WHERE revision = ?
`).get(revision) as { request_json?: unknown } | undefined
    if (typeof row?.request_json !== 'string') throw new Error('Agent Mod history fixture is missing')
    const envelope = JSON.parse(row.request_json) as {
      request?: Record<string, unknown> & { commands?: unknown[] }
    }
    if (!envelope.request) throw new Error('Agent Mod request envelope is missing')
    envelope.request.commands = [{
      version: 1,
      id: 'rewritten-mod-create',
      name: 'mod-template.create',
      payload: {
        templateId: 'mod-template-rewritten-history',
        mod: switchMod('REWRITTEN HISTORICAL MOD', ['rewritten-history-item']),
      },
    }]
    const requestJson = canonicalProfileJson(envelope)
    database.prepare(`
UPDATE profile_agent_command_events
SET request_json = ?, request_digest = ?
WHERE revision = ?
`).run(
      requestJson,
      createHash('sha256').update(requestJson).digest('hex'),
      revision,
    )
  } finally {
    database.close()
  }
}

function rewriteStoredAgentAttribution(
  databasePath: string,
  revision: number,
  idempotencyKey: string,
  transport: 'cli' | 'mcp',
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database.prepare(`
SELECT request_json
FROM profile_agent_command_events
WHERE revision = ?
`).get(revision) as { request_json?: unknown } | undefined
    if (typeof row?.request_json !== 'string') {
      throw new Error('Agent attribution fixture is missing')
    }
    const envelope = JSON.parse(row.request_json) as {
      context?: { actor?: Record<string, unknown> }
      request?: Record<string, unknown>
    }
    if (!envelope.context?.actor || !envelope.request) {
      throw new Error('Agent attribution envelope is invalid')
    }
    envelope.context.actor.transport = transport
    envelope.request.idempotencyKey = idempotencyKey
    const requestJson = canonicalProfileJson(envelope)
    database.prepare(`
UPDATE profile_agent_command_events
SET idempotency_key = ?, actor_transport = ?, request_json = ?, request_digest = ?
WHERE revision = ?
`).run(
      idempotencyKey,
      transport,
      requestJson,
      createHash('sha256').update(requestJson).digest('hex'),
      revision,
    )
    database.prepare(`
UPDATE profile_revisions
SET actor_transport = ?
WHERE revision = ?
`).run(transport, revision)
  } finally {
    database.close()
  }
}

function omitAgentDeleteTransitionAndRehash(
  databasePath: string,
  revision: number,
  recordId: string,
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const removed = database.prepare(`
DELETE FROM profile_agent_command_record_changes
WHERE revision = ? AND record_id = ? AND change_kind = 'delete'
`).run(revision, recordId)
    if (removed.changes !== 1) throw new Error('Nested Agent delete fixture is missing')
    rehashAgentChanges(database, revision)
    rewriteAgentReceipt(database, revision, (receipt) => receipt.version === 1
      ? {
          ...receipt,
          effects: { ...receipt.effects, deleted: receipt.effects.deleted - 1 },
        }
      : {
          ...receipt,
          effects: { ...receipt.effects, deleted: receipt.effects.deleted - 1 },
        })
  } finally {
    database.close()
  }
}

function retargetAgentHighlightTransitionAndRehash(
  databasePath: string,
  revision: number,
  recordId: string,
  cardId: string,
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database.prepare(`
SELECT before_json
FROM profile_agent_command_record_changes
WHERE revision = ? AND record_id = ? AND change_kind = 'delete'
`).get(revision, recordId) as { before_json?: unknown } | undefined
    if (typeof row?.before_json !== 'string') throw new Error('Highlight tombstone fixture is missing')
    const before = JSON.parse(row.before_json) as Record<string, unknown>
    if (!before.payload || typeof before.payload !== 'object' || Array.isArray(before.payload)) {
      throw new Error('Highlight tombstone payload fixture is invalid')
    }
    before.payload = { ...before.payload, cardId }
    database.prepare(`
UPDATE profile_agent_command_record_changes
SET before_json = ?
WHERE revision = ? AND record_id = ? AND change_kind = 'delete'
`).run(canonicalProfileJson(before), revision, recordId)
    rehashAgentChanges(database, revision)
  } finally {
    database.close()
  }
}

function injectUnclaimedAgentIdeaTransition(
  databasePath: string,
  revision: number,
  recordId: string,
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database.prepare(`
SELECT record_id, kind, owner_id, parent_id, ordinal, record_version, payload_json
FROM profile_records
WHERE record_id = ?
`).get(recordId) as {
      record_id?: unknown
      kind?: unknown
      owner_id?: unknown
      parent_id?: unknown
      ordinal?: unknown
      record_version?: unknown
      payload_json?: unknown
    } | undefined
    if (!row
      || typeof row.record_id !== 'string'
      || typeof row.kind !== 'string'
      || typeof row.owner_id !== 'string'
      || (row.parent_id !== null && typeof row.parent_id !== 'string')
      || typeof row.ordinal !== 'number'
      || typeof row.record_version !== 'number'
      || typeof row.payload_json !== 'string') {
      throw new Error('Unclaimed Idea fixture is missing')
    }
    const before = {
      recordId: row.record_id,
      kind: row.kind,
      ownerId: row.owner_id,
      parentId: row.parent_id,
      ordinal: row.ordinal,
      recordVersion: row.record_version,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    }
    const after = {
      ...before,
      payload: { ...before.payload, name: 'Unclaimed rewritten Idea' },
    }
    database.prepare(`
INSERT INTO profile_agent_command_record_changes (
  profile_id, revision, record_id, change_kind, before_json, after_json
) VALUES ('profile-synthetic', ?, ?, 'update', ?, ?)
`).run(revision, recordId, canonicalProfileJson(before), canonicalProfileJson(after))
    database.prepare(`
UPDATE profile_records
SET payload_json = ?, updated_revision = ?
WHERE record_id = ?
`).run(canonicalProfileJson(after.payload), revision, recordId)
    rehashAgentChanges(database, revision)
    rewriteAgentReceipt(database, revision, (receipt) => receipt.version === 1
      ? {
          ...receipt,
          effects: { ...receipt.effects, updated: receipt.effects.updated + 1 },
        }
      : {
          ...receipt,
          effects: { ...receipt.effects, updated: receipt.effects.updated + 1 },
        })
  } finally {
    database.close()
  }
}

function rehashAgentChanges(database: DatabaseSync, revision: number): void {
  const rows = database.prepare(`
SELECT record_id, change_kind, before_json, after_json
FROM profile_agent_command_record_changes
WHERE revision = ?
ORDER BY record_id
`).all(revision) as Array<{
    record_id: string
    change_kind: 'insert' | 'update' | 'delete'
    before_json: string | null
    after_json: string | null
  }>
  const changes = rows.map((row) => ({
    recordId: row.record_id,
    changeKind: row.change_kind,
    before: row.before_json === null ? null : JSON.parse(row.before_json) as Record<string, unknown>,
    after: row.after_json === null ? null : JSON.parse(row.after_json) as Record<string, unknown>,
  }))
  const changesJson = canonicalProfileJson(changes)
  database.prepare(`
UPDATE profile_agent_command_events
SET changes_digest = ?
WHERE revision = ?
`).run(createHash('sha256').update(changesJson).digest('hex'), revision)
}

function rewriteStoredProfileTemplateMeaningAndRehash(
  databasePath: string,
  templateId: string,
  label: string,
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const requestRow = database.prepare(`
SELECT request_json
FROM profile_agent_command_events
WHERE revision = 8
`).get() as { request_json?: unknown } | undefined
    if (typeof requestRow?.request_json !== 'string') {
      throw new Error('Profile template request fixture is missing')
    }
    const evidence = JSON.parse(requestRow.request_json) as Record<string, unknown>
    if (!evidence.request || typeof evidence.request !== 'object' || Array.isArray(evidence.request)) {
      throw new Error('Profile template request fixture is invalid')
    }
    const request = evidence.request as Record<string, unknown>
    if (!Array.isArray(request.commands) || request.commands.length !== 1) {
      throw new Error('Profile template command fixture is invalid')
    }
    const command = request.commands[0]
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new Error('Profile template command fixture is invalid')
    }
    const payload = (command as Record<string, unknown>).payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Profile template payload fixture is invalid')
    }
    const mod = (payload as Record<string, unknown>).mod
    if (!mod || typeof mod !== 'object' || Array.isArray(mod)) {
      throw new Error('Profile template Mod fixture is invalid')
    }
    const requestJson = canonicalProfileJson({
      ...evidence,
      request: {
        ...request,
        commands: [{
          ...(command as Record<string, unknown>),
          payload: {
            ...(payload as Record<string, unknown>),
            mod: { ...(mod as Record<string, unknown>), title: label },
          },
        }],
      },
    })
    database.prepare(`
UPDATE profile_agent_command_events
SET request_json = ?, request_digest = ?
WHERE revision = 8
`).run(requestJson, createHash('sha256').update(requestJson).digest('hex'))

    for (const [revision, column] of [[8, 'after_json'], [9, 'before_json']] as const) {
      const transitionRow = database.prepare(`
SELECT ${column} AS record_json
FROM profile_agent_command_record_changes
WHERE revision = ? AND record_id = ?
`).get(revision, templateId) as { record_json?: unknown } | undefined
      if (typeof transitionRow?.record_json !== 'string') {
        throw new Error('Profile template transition fixture is missing')
      }
      const record = JSON.parse(transitionRow.record_json) as Record<string, unknown>
      if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
        throw new Error('Profile template transition payload fixture is invalid')
      }
      const transitionPayload = record.payload as Record<string, unknown>
      if (!transitionPayload.mod
        || typeof transitionPayload.mod !== 'object'
        || Array.isArray(transitionPayload.mod)) {
        throw new Error('Profile template transition Mod fixture is invalid')
      }
      database.prepare(`
UPDATE profile_agent_command_record_changes
SET ${column} = ?
WHERE revision = ? AND record_id = ?
`).run(canonicalProfileJson({
        ...record,
        payload: {
          ...transitionPayload,
          mod: { ...(transitionPayload.mod as Record<string, unknown>), title: label },
        },
      }), revision, templateId)
      rehashAgentChanges(database, revision)
    }
  } finally {
    database.close()
  }
}

function rewriteAgentReceipt(
  database: DatabaseSync,
  revision: number,
  rewrite: (receipt: ProfileAgentCommandBatchReceipt) => ProfileAgentCommandBatchReceipt,
): void {
  const row = database.prepare(`
SELECT receipt_json
FROM profile_agent_command_events
WHERE revision = ?
`).get(revision) as { receipt_json?: unknown } | undefined
  if (typeof row?.receipt_json !== 'string') throw new Error('Agent receipt fixture is missing')
  const receiptJson = canonicalProfileJson(rewrite(
    JSON.parse(row.receipt_json) as ProfileAgentCommandBatchReceipt,
  ))
  database.prepare(`
UPDATE profile_agent_command_events
SET receipt_json = ?, receipt_digest = ?
WHERE revision = ?
`).run(
    receiptJson,
    createHash('sha256').update(receiptJson).digest('hex'),
    revision,
  )
}

function duplicateIdeaLifecycleInput(seed: ProfileSnapshot) {
  const candidateSnapshot = structuredClone(seed)
  candidateSnapshot.activeIdeaId = 'idea-copy'
  candidateSnapshot.ideas.push({
    id: 'idea-copy',
    name: 'Synthetic copy',
    createdAt: '2026-01-03T00:00:02.000Z',
    updatedAt: '2026-01-03T00:00:02.000Z',
    lastOpenedAt: '2026-01-03T00:00:02.000Z',
  })
  candidateSnapshot.boards['idea-copy'] = {
    version: 1,
    cards: [{
      id: 'card-copy',
      kind: 'note',
      position: { x: 40, y: 60 },
      blocks: [{ id: 'block-copy', kind: 'line', text: 'Copied thought' }],
    }],
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: '2026-01-03T00:00:02.000Z',
  }
  const candidate = projectProfileSnapshot(candidateSnapshot, () => {
    throw new Error('Asset-free lifecycle candidate unexpectedly projected an asset')
  })
  return {
    kind: 'duplicate-idea' as const,
    operationId: 'operation-duplicate-1',
    idempotencyKey: 'idempotency-duplicate-1',
    expectedRevision: 7,
    request: { sourceIdeaId: 'idea-main' },
    candidate,
    targetIdeaId: 'idea-copy',
    importedAssetIds: [],
    committedAt: '2026-01-03T00:00:02.000Z',
  }
}

function insertSyntheticModRecords(
  databasePath: string,
  records: readonly ProfileModRecord[],
): void {
  const database = new DatabaseSync(databasePath)
  try {
    const insert = database.prepare(`
INSERT INTO profile_records (
  profile_id, record_id, kind, owner_id, parent_id, ordinal, record_version,
  created_revision, updated_revision, payload_json
) VALUES (?, ?, ?, ?, ?, ?, ?, 7, 7, ?)
`)
    records.forEach((record) => insert.run(
      'profile-synthetic',
      record.recordId,
      record.kind,
      record.ownerId,
      record.parentId,
      0,
      record.recordVersion,
      JSON.stringify(record.payload),
    ))
  } finally {
    database.close()
  }
}

function persistedProfileShape(database: DatabaseSync): unknown {
  return {
    schemaVersion: database.prepare('PRAGMA schema_version').get(),
    schema: database.prepare(`
SELECT type, name, sql
FROM sqlite_schema
WHERE name NOT LIKE 'sqlite_%'
ORDER BY type, name
`).all(),
    head: database.prepare('SELECT * FROM profile_meta').get(),
    records: database.prepare(`
SELECT *
FROM profile_records
ORDER BY profile_id, record_id
`).all(),
    ownerFence: database.prepare(`
SELECT *
FROM profile_owner_fence
ORDER BY profile_id
`).all(),
  }
}

function ownershipCapabilityFor(databasePath: string): SqliteProfileOwnershipCapability {
  const existing = capabilitiesByProfile.get(databasePath)
  if (existing) return existing
  const context = createOwnershipContext(databasePath, 1, 'synthetic-store-owner-token'.repeat(3))
  capabilitiesByProfile.set(databasePath, context.capability)
  return context.capability
}

function createOwnershipContext(
  databasePath: string,
  generation: number,
  ownerToken: string,
) {
  const sidecarPath = `${databasePath}.owner.sqlite`
  const runtime = openSqliteExclusiveRuntime(sidecarPath)
  runtime.exec(`
CREATE TABLE IF NOT EXISTS profile_owner_generation (
  identity INTEGER PRIMARY KEY CHECK (identity = 1),
  generation INTEGER NOT NULL CHECK (generation >= 1),
  owner_token TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL
);
`)
  runtime.prepare(`
INSERT INTO profile_owner_generation (
  identity, generation, owner_token, owner_id, acquired_at
) VALUES (1, ?, ?, 'owner-synthetic-store', '2026-01-03T00:00:00.000Z')
ON CONFLICT(identity) DO UPDATE SET
  generation = excluded.generation,
  owner_token = excluded.owner_token,
  owner_id = excluded.owner_id,
  acquired_at = excluded.acquired_at
`).run(generation, ownerToken)
  const context = {
    runtime,
    capability: issueSqliteProfileOwnershipCapability({
      profileDatabasePath: databasePath,
      sidecarPath,
      sidecarRuntime: runtime,
    }),
  }
  ownershipContexts.push(context)
  return context
}

function switchMod(title: string, ids: readonly string[]): Mod<'switch'> {
  const mod = createSeedMod('switch', {
    title,
    createId: (role, ordinal) => `${role}-${ordinal}`,
  })
  mod.state.items = ids.map((id, index) => ({
    id,
    label: `SWITCH ${index + 1}`,
    on: index === 0,
    frame: '',
  }))
  return mod
}

function disposableDatabasePath(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eido-459-profile-'))
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

function revisionEightBatch(): ProfileCommandBatch {
  return {
    version: PROFILE_CONTRACT_VERSIONS.command,
    schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
    expectedRevision: 7,
    actor: { id: 'actor-synthetic', kind: 'user', transport: 'test' },
    clientTxnId: 'txn-synthetic-3',
    idempotencyKey: 'idempotency-synthetic-3',
    dryRun: false,
    commands: [{
      version: PROFILE_CONTRACT_VERSIONS.command,
      id: 'command-note-edited',
      name: 'card.update-content',
      payload: {
        ideaId: 'idea-main',
        cardId: 'card-note',
        blockId: 'block-note',
        text: 'Synthetic source note after pending edit',
      },
    }],
  }
}

function agentConnectedNotesSnapshot(): ProfileSnapshot {
  const snapshot = assetFreeSnapshot()
  snapshot.boards['idea-main']!.cards.push({
    id: 'card-second-note',
    kind: 'note',
    position: { x: 500, y: 80 },
    blocks: [{ id: 'block-second-note', text: 'Second note', kind: 'line' }],
  })
  snapshot.boards['idea-main']!.connections.push({
    id: 'connection-note-pair',
    from: { cardId: 'card-note' },
    to: { cardId: 'card-second-note' },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  })
  return snapshot
}

function agentThroughResultRequest(): ProfileAgentCommandRequest {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision: 7,
    idempotencyKey: 'agent-through-result-key',
    dryRun: false,
    commands: [
      {
        version: 1,
        id: 'create-upstream',
        name: 'card.create',
        payload: {
          ideaId: 'idea-main',
          kind: 'askAi',
          position: { x: 300, y: 120 },
          text: 'Upstream question',
        },
      },
      {
        version: 1,
        id: 'create-downstream',
        name: 'card.create',
        payload: {
          ideaId: 'idea-main',
          kind: 'askAi',
          position: { x: 700, y: 120 },
          text: 'Downstream question',
        },
      },
      {
        version: 1,
        id: 'connect-created-asks',
        name: 'connection.create',
        payload: {
          ideaId: 'idea-main',
          from: { createdByCommandId: 'create-upstream' },
          to: { createdByCommandId: 'create-downstream' },
        },
      },
    ],
  }
}

function agentExistingResultReuseRequest(): ProfileAgentCommandRequest {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision: 7,
    idempotencyKey: 'agent-existing-result-reuse-key',
    dryRun: false,
    commands: [
      ...['source', 'first-target', 'second-target'].map((suffix, index) => ({
        version: 1 as const,
        id: `create-${suffix}`,
        name: 'card.create' as const,
        payload: {
          ideaId: 'idea-main',
          kind: 'askAi' as const,
          position: { x: 300 + index * 300, y: 500 },
          text: suffix,
        },
      })),
      {
        version: 1,
        id: 'connect-first-target',
        name: 'connection.create',
        payload: {
          ideaId: 'idea-main',
          from: { createdByCommandId: 'create-source' },
          to: { createdByCommandId: 'create-first-target' },
        },
      },
      {
        version: 1,
        id: 'connect-second-target',
        name: 'connection.create',
        payload: {
          ideaId: 'idea-main',
          from: { createdByCommandId: 'create-source' },
          to: { createdByCommandId: 'create-second-target' },
        },
      },
    ],
  }
}

function agentCardDeleteRequest(idempotencyKey: string): ProfileAgentCommandRequest {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision: 7,
    idempotencyKey,
    dryRun: false,
    commands: [{
      version: 1,
      id: 'delete-cascade-card',
      name: 'card.delete',
      payload: { ideaId: 'idea-main', cardId: 'card-note' },
    }],
  }
}

function agentSingleCreateRequest(input: Readonly<{
  expectedRevision: number
  idempotencyKey: string
  commandId: string
}>): ProfileAgentCommandRequest {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    dryRun: false,
    commands: [{
      version: 1,
      id: input.commandId,
      name: 'card.create',
      payload: {
        ideaId: 'idea-main',
        kind: 'note',
        position: { x: 900, y: 300 },
        text: input.commandId,
      },
    }],
  }
}

function neverReceipt(): never {
  throw new Error('Expected the first SQLite Profile commit to succeed')
}
