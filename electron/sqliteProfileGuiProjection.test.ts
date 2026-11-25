import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSeedMod } from '../src/mods'
import type {
  CardAsset,
  IdeaSummary,
  IntentLogEvent,
  SavedBoard,
} from '../src/graph/types'
import { createCompleteProfileFixture } from '../src/persistence/fixtures/profileLogicalProjectionFixture'
import {
  GUI_PROFILE_PROJECTION_VERSION,
  type GuiOrdinaryNewIdeaAuthorization,
  type GuiProfileProjection,
  type GuiProfileProjectionRequest,
} from '../src/persistence/profileGuiProjection'
import {
  PROFILE_CONTRACT_VERSIONS,
  type ProfileCommandBatch,
  type ProfileSnapshot,
} from '../src/persistence/profileServiceContract'
import { canonicalProfileJson } from '../src/persistence/profileRevisionKernel'
import {
  acquireSqliteProfileOwner,
  type SqliteProfileOwnerCoordinator,
  type SqliteProfileOwnerCoordinatorOptions,
} from './sqliteProfileOwnerCoordinator'
import {
  createSqliteRuntimeOpener,
  type SqliteDatabase,
} from './sqliteRuntime'

const AUTHORIZED_AT = '2026-07-19T00:00:01.000Z'
const REAUTHORIZED_AT = '2026-07-19T00:06:00.000Z'
const COMMITTED_AT = '2026-07-19T00:06:01.000Z'
const DELETED_AT = '2026-07-19T00:06:02.000Z'
const TRUSTED_ACTOR_ID = 'actor-trusted-owner'
const NEW_IDEA_ID = 'idea-gui-authorized'
const GUI_IDEMPOTENCY_KEY = 'idempotency-gui-native-1'

const disposableRoots: string[] = []
const coordinators: SqliteProfileOwnerCoordinator[] = []
const openTestRuntime = createSqliteRuntimeOpener({
  openDatabase: (location) => new DatabaseSync(location) as unknown as SqliteDatabase,
})

type AcquireOverrides = Pick<
  SqliteProfileOwnerCoordinatorOptions,
  | 'now'
  | 'testHooks'
  | 'blobTestHooks'
  | 'createGuiIdeaAuthorizationId'
  | 'createRecoveryCandidateId'
>

afterEach(async () => {
  await Promise.allSettled(coordinators.splice(0).map((coordinator) => coordinator.close()))
  for (const root of disposableRoots.splice(0)) {
    const expectedPrefix = path.join(tmpdir(), 'eido-595-gui-')
    if (!root.startsWith(expectedPrefix)) throw new Error('Refusing to remove an unexpected test directory')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('SQLite native GUI Profile projection (#595)', () => {
  it('atomically commits, reopens, and exactly replays one rich owner-authorized GUI projection', async () => {
    const fixture = createCompleteProfileFixture()
    const databasePath = disposableDatabasePath()
    let rejectBeforeCommit = true
    let ownerNow = AUTHORIZED_AT
    const authorizationIds = [
      'authorization-gui-expiring',
      'authorization-gui-active-retry-candidate',
      'authorization-gui-ordinary-1',
    ]
    let assetStageFlushes = 0
    const assetStageExisting: boolean[] = []
    const overrides: AcquireOverrides = {
      now: () => ownerNow,
      createGuiIdeaAuthorizationId: () => {
        const authorizationId = authorizationIds.shift()
        if (!authorizationId) throw new Error('Synthetic authorization IDs exhausted')
        return authorizationId
      },
      createRecoveryCandidateId: (revision) => `candidate-before-gui-${revision}`,
      testHooks: {
        beforeCommit() {
          if (!rejectBeforeCommit) return
          rejectBeforeCommit = false
          throw new Error('synthetic rollback before GUI commit')
        },
      },
      blobTestHooks: {
        afterStageFlush() {
          assetStageFlushes += 1
        },
        beforeFinalDurabilityBarrier({ existingFinal }) {
          assetStageExisting.push(existingFinal)
        },
      },
    }
    const coordinator = acquire(databasePath, fixture.snapshot, overrides)
    assetStageFlushes = 0
    assetStageExisting.length = 0
    const before = await mustSnapshot(coordinator)
    const inactiveBoard = clone(before.boards['idea-second'])
    const compatibility = clone(before.compatibility)
    const migrationLedger = clone(before.migrationLedger)
    const profileSettings = clone(before.profileSettings)

    const recoveryPoint = await coordinator.createRecoveryPoint()
    expect(recoveryPoint).toMatchObject({
      ok: true,
      value: { id: `candidate-before-gui-${before.revision}`, revision: before.revision, verified: true },
    })
    const expiringAuthorization = await mustAuthorization(coordinator)
    expect(expiringAuthorization).toMatchObject({
      authorizationId: 'authorization-gui-expiring',
      createdAt: AUTHORIZED_AT,
      expiresAt: '2026-07-19T00:05:01.000Z',
    })
    expect(await mustAuthorization(coordinator)).toEqual(expiringAuthorization)
    ownerNow = REAUTHORIZED_AT
    const authorization = await mustAuthorization(coordinator)
    expect(authorization).toEqual({
      authorizationId: 'authorization-gui-ordinary-1',
      profileId: 'profile-synthetic',
      baseRevision: before.revision,
      ideaId: NEW_IDEA_ID,
      boardId: `board:${NEW_IDEA_ID}`,
      createdAt: REAUTHORIZED_AT,
      expiresAt: '2026-07-19T00:11:00.000Z',
    })
    expect(assetStageFlushes).toBe(0)
    const request = richProjectionRequest(before, authorization)
    const forgedActor = { kind: 'agent' as const, client: 'forged', sessionId: 'forged' }
    const submittedNote = request.projection.boardReplacements['idea-main']!.cards
      .find((card) => card.id === 'card-note')!
    submittedNote.createdBy = forgedActor
    submittedNote.lastModifiedBy = forgedActor
    request.projection.boardReplacements[NEW_IDEA_ID]!.cards[0]!.createdBy = forgedActor

    const rolledBack = await coordinator.commitGuiProjection(clone(request))
    expect(rolledBack).toMatchObject({
      ok: false,
      code: 'internal',
      currentRevision: before.revision,
    })
    expect((await mustSnapshot(coordinator)).revision).toBe(before.revision)
    expect(assetStageExisting).toEqual([false, false])
    expect(assetStageFlushes).toBe(2)

    const mutableSubmission = clone(request)
    const droppedResponse = coordinator.commitGuiProjection(mutableSubmission).then((result) => {
      if (!result.ok) return result
      throw new Error('synthetic transport response loss')
    })
    mutateAfterEnqueue(mutableSubmission)
    const queuedQuery = coordinator.query({
      recordKinds: ['block'],
      recordIds: ['block-note'],
      projection: ['text'],
    })

    await expect(droppedResponse).rejects.toThrow('synthetic transport response loss')
    expect(await queuedQuery).toMatchObject({
      ok: true,
      value: {
        revision: before.revision + 1,
        items: [{ recordId: 'block-note', payload: { text: 'Persisted natively' } }],
      },
    })
    expect(assetStageFlushes).toBe(4)

    await coordinator.close()
    const reopened = acquire(databasePath, undefined, overrides)
    const replayed = await reopened.commitGuiProjection(clone(request))
    expect(replayed).toMatchObject({
      ok: true,
      value: {
        previousRevision: before.revision,
        revision: before.revision + 1,
        generation: request.generation,
        clientTxnId: request.clientTxnId,
        idempotencyKey: request.idempotencyKey,
        replayed: true,
      },
    })
    expect(assetStageFlushes).toBe(4)

    const after = await mustSnapshot(reopened)
    const expectedMainBoard = clone(request.projection.boardReplacements['idea-main']!)
    const expectedNewBoard = clone(request.projection.boardReplacements[NEW_IDEA_ID]!)
    const trustedCardActor = {
      kind: 'user' as const,
      client: 'eido-desktop',
      sessionId: `${TRUSTED_ACTOR_ID}:${request.generation}`,
    }
    const expectedNote = expectedMainBoard.cards.find((card) => card.id === 'card-note')!
    delete expectedNote.createdBy
    expectedNote.lastModifiedBy = trustedCardActor
    expectedMainBoard.cards.find((card) => card.id === 'card-mod')!.lastModifiedBy = trustedCardActor
    const expectedNewCard = expectedNewBoard.cards[0]!
    expectedNewCard.createdBy = trustedCardActor
    expectedNewCard.lastModifiedBy = trustedCardActor
    expect(after).toMatchObject({
      revision: before.revision + 1,
      activeIdeaId: NEW_IDEA_ID,
      compatibility,
      migrationLedger,
      profileSettings,
      recoveryPoints: [],
    })
    expect(after.ideas).toEqual(request.projection.ideas)
    expect(after.boards['idea-main']).toEqual(expectedMainBoard)
    expect(after.boards['idea-second']).toEqual(inactiveBoard)
    expect(after.boards[NEW_IDEA_ID]).toEqual(expectedNewBoard)
    expect(after.modTemplates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        recordId: 'mod-template-synthetic',
        payload: expect.objectContaining({
          templateVersion: 2,
          provenance: { kind: 'user' },
          createdAt: '2026-07-19T00:00:00.000Z',
          updatedAt: COMMITTED_AT,
          mod: request.projection.userModTemplates[0]!.mod,
        }),
      }),
    ]))
    expect(after.modInstances).toEqual(expect.arrayContaining([
      expect.objectContaining({
        recordId: 'mod-stamp-1',
        payload: expect.objectContaining({
          source: { kind: 'template', templateId: 'mod-template-synthetic', templateVersion: 1 },
          mod: expect.objectContaining({ title: 'Stamped Mod edited after stamping' }),
        }),
      }),
      expect.objectContaining({
        recordId: 'mod-gui-direct',
        payload: expect.objectContaining({ source: { kind: 'direct' } }),
      }),
    ]))

    expect(await reopened.recover({ mode: 'inspect' })).toMatchObject({
      ok: true,
      value: {
        selectedCandidateId: `candidate-before-gui-${before.revision}`,
        candidates: [{ id: `candidate-before-gui-${before.revision}`, revision: before.revision }],
        rejectedCandidateIds: [],
      },
    })
    expect(await reopened.status()).toMatchObject({
      ok: true,
      value: {
        revision: before.revision + 1,
        state: 'ready',
        dirty: 'clean',
        owner: { mode: 'mutable' },
      },
    })
    expect(await reopened.capabilities()).toMatchObject({
      ok: true,
      value: { adapter: 'sqlite', commands: [] },
    })

    const alteredReplay: GuiProfileProjectionRequest = {
      ...clone(request),
      projection: { ...clone(request.projection), activeIdeaId: 'idea-second' },
    }
    expect(await reopened.commitGuiProjection(alteredReplay)).toMatchObject({
      ok: false,
      code: 'invalid',
      currentRevision: after.revision,
    })
    const reusedAuthorization: GuiProfileProjectionRequest = {
      ...clone(request),
      generation: 2,
      expectedRevision: after.revision,
      clientTxnId: 'client-txn-gui-native-reuse-auth',
      idempotencyKey: 'idempotency-gui-native-reuse-auth',
    }
    expect(await reopened.commitGuiProjection(reusedAuthorization)).toMatchObject({
      ok: false,
      code: 'invalid',
    })
    const stale: GuiProfileProjectionRequest = {
      ...clone(request),
      generation: 2,
      clientTxnId: 'client-txn-gui-native-stale',
      idempotencyKey: 'idempotency-gui-native-stale',
    }
    expect(await reopened.commitGuiProjection(stale)).toMatchObject({
      ok: false,
      code: 'conflict',
      currentRevision: after.revision,
    })
    expect(await reopened.applyCommandBatch(commandCollision(after.revision))).toMatchObject({
      ok: false,
      code: 'invalid',
      currentRevision: after.revision,
    })
    expect((await mustSnapshot(reopened)).revision).toBe(after.revision)

    await reopened.close()
    verifyNativeEvidence(databasePath, request, authorization, before.revision)

    const expectedRequestDigest = createHash('sha256')
      .update(canonicalProfileJson(request))
      .digest('hex')
    const originalRequestDigest = replaceFirstGuiRequestDigest(
      databasePath,
      `${expectedRequestDigest[0] === '0' ? '1' : '0'}${expectedRequestDigest.slice(1)}`,
    )
    expect(originalRequestDigest).toBe(expectedRequestDigest)
    const digestCorruptionOwner = acquire(databasePath, undefined, overrides)
    expect(await digestCorruptionOwner.snapshot()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    await digestCorruptionOwner.close()
    replaceFirstGuiRequestDigest(databasePath, originalRequestDigest)

    const deleting = acquire(databasePath, undefined, overrides)
    const deletionRequest = ideaDeletionRequest(await mustSnapshot(deleting))
    expect(await deleting.commitGuiProjection(deletionRequest)).toMatchObject({
      ok: true,
      value: {
        previousRevision: after.revision,
        revision: after.revision + 1,
        deletedRecordIds: expect.arrayContaining([
          'idea-main',
          'board:idea-main',
          'event-note-created',
          'event-gui-native-appended',
        ]),
        changedRecordIds: expect.arrayContaining([
          'idea-main',
          'board:idea-main',
          'event-note-created',
          'event-gui-native-appended',
        ]),
        replayed: false,
      },
    })
    await deleting.close()

    const afterDeletionOwner = acquire(databasePath, undefined, overrides)
    const afterDeletion = await mustSnapshot(afterDeletionOwner)
    expect(afterDeletion).toMatchObject({
      revision: after.revision + 1,
      activeIdeaId: NEW_IDEA_ID,
      compatibility,
      migrationLedger,
      profileSettings,
    })
    expect(afterDeletion.ideas.map((idea) => idea.id)).toEqual([
      'idea-second',
      NEW_IDEA_ID,
    ])
    expect(afterDeletion.boards['idea-main']).toBeUndefined()
    expect(afterDeletion.boards['idea-second']).toEqual(inactiveBoard)
    expect(afterDeletion.boards[NEW_IDEA_ID]).toEqual(expectedNewBoard)
    await afterDeletionOwner.close()

    corruptHistoricalChangedEvidence(databasePath)
    const corruptedOwner = acquireSqliteProfileOwner({
      databasePath,
      ownerId: 'owner-gui-corruption-check',
      route: 'active-owner',
      createOwnerToken: () => 'gui-corruption-token'.repeat(16),
      openProfileRuntime: openTestRuntime,
      now: () => ownerNow,
    })
    if (!corruptedOwner.ok) throw new Error(`Corruption probe could not acquire: ${corruptedOwner.code}`)
    coordinators.push(corruptedOwner.value)
    expect(await corruptedOwner.value.snapshot()).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
    await corruptedOwner.value.close()
  }, 20_000)
})

function acquire(
  databasePath: string,
  seed?: ProfileSnapshot,
  overrides: AcquireOverrides = {},
): SqliteProfileOwnerCoordinator {
  const result = acquireSqliteProfileOwner({
    databasePath,
    ownerId: 'owner-gui-test',
    route: 'active-owner',
    createOwnerToken: () => 'gui-owner-token'.repeat(16),
    openProfileRuntime: openTestRuntime,
    ...(seed ? { seed } : {}),
    ...overrides,
  })
  if (!result.ok) throw new Error(`Failed to acquire synthetic Profile: ${result.code}`)
  coordinators.push(result.value)
  return result.value
}

async function mustSnapshot(coordinator: SqliteProfileOwnerCoordinator): Promise<ProfileSnapshot> {
  const result = await coordinator.snapshot()
  if (!result.ok) throw new Error(`Failed to read synthetic Profile: ${result.code}`)
  return result.value
}

async function mustAuthorization(
  coordinator: SqliteProfileOwnerCoordinator,
): Promise<GuiOrdinaryNewIdeaAuthorization> {
  const result = await coordinator.authorizeOrdinaryIdeaCreate(NEW_IDEA_ID)
  if (!result.ok) throw new Error(`Failed to authorize synthetic Idea: ${result.code}`)
  return result.value
}

function richProjectionRequest(
  snapshot: ProfileSnapshot,
  authorization: GuiOrdinaryNewIdeaAuthorization,
): GuiProfileProjectionRequest {
  const replacement = clone(snapshot.boards['idea-main']!)
  replacement.updatedAt = COMMITTED_AT
  const note = replacement.cards.find((card) => card.id === 'card-note')
  if (!note) throw new Error('Synthetic note Card is missing')
  note.blocks[0]!.text = 'Persisted natively'
  const localPreviewAsset = newLocalPreviewAsset()
  note.assets = [...(note.assets ?? []), newAsset(), localPreviewAsset]
  note.localHtmlPreview = {
    sourceId: 'source-opaque-gui',
    name: 'review.html',
    status: 'ready',
    title: 'Persisted visual review',
    assetId: localPreviewAsset.id,
  }
  const stampedCard = replacement.cards.find((card) => card.id === 'card-mod')
  if (!stampedCard?.modV2) throw new Error('Synthetic stamped Mod Card is missing')
  stampedCard.modV2 = {
    ...clone(stampedCard.modV2),
    title: 'Stamped Mod edited after stamping',
  }
  replacement.intentLog = [
    ...(replacement.intentLog ?? []),
    appendedIntent(),
  ]

  const newIdea: IdeaSummary = {
    id: NEW_IDEA_ID,
    name: 'Authorized and already contentful',
    createdAt: authorization.createdAt,
    updatedAt: COMMITTED_AT,
    lastOpenedAt: COMMITTED_AT,
  }
  const directMod = createSeedMod('switch', {
    title: 'Native direct Mod',
    createId: (role, ordinal) => `control-gui-direct-${role}-${ordinal}`,
  })
  const newBoard: SavedBoard = {
    version: 1,
    updatedAt: COMMITTED_AT,
    cards: [{
      id: 'card-gui-direct-mod',
      kind: 'mod',
      position: { x: 40, y: 60 },
      blocks: [{ id: 'block-gui-direct-mod', text: 'Created before debounce flushed', kind: 'line' }],
      modV2: directMod,
    }],
    connections: [],
    outputs: [],
    runs: [],
    aiSettings: { model: 'synthetic/model', models: ['synthetic/model'], reasoningEffort: 'low' },
  }
  const ideas = clone(snapshot.ideas)
  ideas[0] = {
    ...ideas[0]!,
    name: 'Synthetic Main renamed',
    updatedAt: COMMITTED_AT,
    lastOpenedAt: COMMITTED_AT,
  }
  ideas.push(newIdea)
  const userModTemplates = clone(snapshot.modTemplates
    .filter((template) => template.payload.provenance.kind === 'user')
    .map((template) => ({ templateId: template.recordId, mod: template.payload.mod })))
  userModTemplates[0] = {
    ...userModTemplates[0]!,
    mod: {
      ...userModTemplates[0]!.mod,
      title: 'Synthetic Mod updated natively',
    },
  }

  return projectionRequest(snapshot, {
    activeIdeaId: NEW_IDEA_ID,
    ideas,
    boardReplacements: {
      'idea-main': replacement,
      [NEW_IDEA_ID]: newBoard,
    },
    userModTemplates,
    newModOrigins: {
      'card-gui-direct-mod': { kind: 'direct', instanceId: 'mod-gui-direct' },
    },
  }, [authorization])
}

function ideaDeletionRequest(snapshot: ProfileSnapshot): GuiProfileProjectionRequest {
  return {
    ...projectionRequest(snapshot, {
      activeIdeaId: NEW_IDEA_ID,
      ideas: clone(snapshot.ideas.filter((idea) => idea.id !== 'idea-main')),
    }),
    generation: 2,
    clientTxnId: 'client-txn-gui-native-delete-idea',
    idempotencyKey: 'idempotency-gui-native-delete-idea',
    committedAt: DELETED_AT,
  }
}

function projectionRequest(
  snapshot: ProfileSnapshot,
  overrides: Partial<GuiProfileProjection> = {},
  ordinaryNewIdeas: readonly GuiOrdinaryNewIdeaAuthorization[] = [],
): GuiProfileProjectionRequest {
  return {
    generation: 1,
    expectedRevision: snapshot.revision,
    clientTxnId: 'client-txn-gui-native-1',
    idempotencyKey: GUI_IDEMPOTENCY_KEY,
    committedAt: COMMITTED_AT,
    context: {
      trustedActorId: TRUSTED_ACTOR_ID,
      ordinaryNewIdeas,
    },
    projection: {
      projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
      profileId: snapshot.profileId,
      activeIdeaId: snapshot.activeIdeaId,
      ideas: clone(snapshot.ideas),
      boardReplacements: {},
      userModTemplates: clone(snapshot.modTemplates
        .filter((template) => template.payload.provenance.kind === 'user')
        .map((template) => ({ templateId: template.recordId, mod: template.payload.mod }))),
      profileSettings: clone(snapshot.profileSettings) as unknown as GuiProfileProjection['profileSettings'],
      newModOrigins: {},
      ...overrides,
    },
  }
}

function appendedIntent(): IntentLogEvent {
  return {
    id: 'event-gui-native-appended',
    at: COMMITTED_AT,
    ideaId: 'idea-main',
    type: 'card.content.edited',
    cardId: 'card-note',
    data: { field: 'body', textLength: 18 },
    commitId: 'commit-gui-native-appended',
    actorId: TRUSTED_ACTOR_ID,
    clientTxnId: 'interaction-gui-native-1',
    seq: 4,
  }
}

function newAsset(): CardAsset {
  const bytes = Buffer.from('native-gui-asset', 'utf8')
  return {
    id: 'asset-gui-new',
    kind: 'file',
    name: 'native-gui.txt',
    mimeType: 'text/plain',
    dataUrl: `data:text/plain;base64,${bytes.toString('base64')}`,
    size: bytes.byteLength,
    createdAt: COMMITTED_AT,
  }
}

function newLocalPreviewAsset(): CardAsset {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  return {
    id: 'asset-local-html-preview-gui',
    kind: 'image',
    name: 'review.html preview.jpg',
    mimeType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
    size: bytes.byteLength,
    createdAt: COMMITTED_AT,
    width: 1200,
    height: 675,
  }
}

function mutateAfterEnqueue(request: GuiProfileProjectionRequest): void {
  const mutable = request as unknown as {
    projection: { ideas: Array<{ name: string }> }
  }
  mutable.projection.ideas[0]!.name = 'Caller mutation must not persist'
}

function commandCollision(expectedRevision: number): ProfileCommandBatch {
  return {
    version: PROFILE_CONTRACT_VERSIONS.command,
    schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
    expectedRevision,
    actor: { id: 'actor-synthetic', kind: 'user', transport: 'test' },
    clientTxnId: 'txn-command-gui-collision',
    idempotencyKey: GUI_IDEMPOTENCY_KEY,
    dryRun: false,
    commands: [{
      version: PROFILE_CONTRACT_VERSIONS.command,
      id: 'command-gui-collision',
      name: 'card.update-content',
      payload: {
        ideaId: 'idea-main',
        cardId: 'card-note',
        blockId: 'block-note',
        text: 'must not commit',
      },
    }],
  }
}

function verifyNativeEvidence(
  databasePath: string,
  request: GuiProfileProjectionRequest,
  authorization: GuiOrdinaryNewIdeaAuthorization,
  previousRevision: number,
): void {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const guiRows = database.prepare(`
SELECT revision, generation, client_txn_id, idempotency_key, request_digest, request_json,
       receipt_json,
       changed_record_ids_json, appended_intent_event_ids_json,
       authorization_ids_json, trusted_actor_id
FROM profile_gui_projection_events
`).all() as Record<string, unknown>[]
    expect(guiRows).toHaveLength(1)
    expect(guiRows[0]).toMatchObject({
      revision: previousRevision + 1,
      generation: request.generation,
      client_txn_id: request.clientTxnId,
      idempotency_key: request.idempotencyKey,
      trusted_actor_id: TRUSTED_ACTOR_ID,
    })
    const requestDigest = createHash('sha256')
      .update(canonicalProfileJson(request))
      .digest('hex')
    expect(guiRows[0]!.request_digest).toBe(requestDigest)
    expect(JSON.parse(String(guiRows[0]!.request_json))).toEqual({
      projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
      profileId: request.projection.profileId,
      requestDigest,
      generation: request.generation,
      expectedRevision: request.expectedRevision,
      clientTxnId: request.clientTxnId,
      idempotencyKey: request.idempotencyKey,
      committedAt: request.committedAt,
      trustedActorId: TRUSTED_ACTOR_ID,
    })
    expect(String(guiRows[0]!.request_json)).not.toContain('base64')
    expect(String(guiRows[0]!.request_json)).not.toContain('native-gui-asset')
    expect(JSON.parse(String(guiRows[0]!.appended_intent_event_ids_json)))
      .toEqual(['event-gui-native-appended'])
    expect(JSON.parse(String(guiRows[0]!.authorization_ids_json)))
      .toEqual([authorization.authorizationId])
    const changedRecordIds = JSON.parse(
      String(guiRows[0]!.changed_record_ids_json),
    ) as string[]
    expect(changedRecordIds).toEqual(expect.arrayContaining([
      'block-note',
      'asset-gui-new',
      'asset-local-html-preview-gui',
      'event-gui-native-appended',
      NEW_IDEA_ID,
      `board:${NEW_IDEA_ID}`,
    ]))
    const receipt = JSON.parse(String(guiRows[0]!.receipt_json)) as {
      deletedRecordIds: string[]
    }
    expect(receipt.deletedRecordIds).toEqual([])
    const stampedRecordIds = (database.prepare(`
SELECT record_id
FROM profile_records
WHERE created_revision = ? OR updated_revision = ?
`).all(previousRevision + 1, previousRevision + 1) as Array<{ record_id: string }>)
      .map((row) => row.record_id)
      .sort()
    expect(changedRecordIds).toEqual(stampedRecordIds)

    expect(database.prepare(`
SELECT authorization_id, consumed_revision, consumed_idempotency_key
FROM profile_gui_idea_authorizations
`).all()).toEqual([{
      authorization_id: authorization.authorizationId,
      consumed_revision: previousRevision + 1,
      consumed_idempotency_key: request.idempotencyKey,
    }])
    expect(database.prepare(`
SELECT commit_id, actor_id, actor_kind, actor_transport,
       idempotency_key, batch_json, receipt_json
FROM profile_revisions
WHERE revision = ?
`).get(previousRevision + 1)).toEqual({
      commit_id: `gui:${request.clientTxnId}`,
      actor_id: TRUSTED_ACTOR_ID,
      actor_kind: 'user',
      actor_transport: null,
      idempotency_key: null,
      batch_json: null,
      receipt_json: null,
    })

    const unchanged = database.prepare(`
SELECT record_id, created_revision, updated_revision
FROM profile_records
WHERE record_id IN (?, ?, ?)
`).all(
      'board:idea-second',
      'compatibility:profile-synthetic',
      'migration-ledger-synthetic',
    ) as Array<{ record_id: string; created_revision: number; updated_revision: number }>
    expect(Object.fromEntries(unchanged.map((row) => [row.record_id, {
      createdRevision: row.created_revision,
      updatedRevision: row.updated_revision,
    }]))).toEqual({
      'board:idea-second': { createdRevision: previousRevision, updatedRevision: previousRevision },
      'compatibility:profile-synthetic': {
        createdRevision: previousRevision,
        updatedRevision: previousRevision,
      },
      'migration-ledger-synthetic': {
        createdRevision: previousRevision,
        updatedRevision: previousRevision,
      },
    })
    expect(database.prepare(`
SELECT created_revision, updated_revision
FROM profile_records
WHERE record_id = 'block-note'
`).get()).toEqual({
      created_revision: previousRevision,
      updated_revision: previousRevision + 1,
    })
  } finally {
    database.close()
  }
}

function replaceFirstGuiRequestDigest(databasePath: string, replacement: string): string {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database.prepare(`
SELECT revision, request_digest
FROM profile_gui_projection_events
ORDER BY revision ASC
LIMIT 1
`).get() as Record<string, unknown> | undefined
    if (!row) throw new Error('Synthetic GUI history is missing')
    const revision = Number(row.revision)
    if (!Number.isSafeInteger(revision)) throw new Error('Synthetic GUI revision is invalid')
    const previous = String(row.request_digest)
    database.prepare(`
UPDATE profile_gui_projection_events
SET request_digest = ?
WHERE revision = ?
`).run(replacement, revision)
    return previous
  } finally {
    database.close()
  }
}

function corruptHistoricalChangedEvidence(databasePath: string): void {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database.prepare(`
SELECT revision, changed_record_ids_json, receipt_json
FROM profile_gui_projection_events
ORDER BY revision ASC
LIMIT 1
`).get() as Record<string, unknown> | undefined
    if (!row) throw new Error('Synthetic GUI history is missing')
    const revision = Number(row.revision)
    if (!Number.isSafeInteger(revision)) throw new Error('Synthetic GUI revision is invalid')
    const changedRecordIds = JSON.parse(String(row.changed_record_ids_json)) as string[]
    const removedIndex = changedRecordIds.indexOf('block-note')
    if (removedIndex < 0) throw new Error('Synthetic historical GUI diff is missing block-note')
    changedRecordIds.splice(removedIndex, 1)
    const receipt = JSON.parse(String(row.receipt_json)) as Record<string, unknown>
    receipt.changedRecordIds = changedRecordIds
    database.prepare(`
UPDATE profile_gui_projection_events
SET changed_record_ids_json = ?, receipt_json = ?
WHERE revision = ?
`).run(
      canonicalProfileJson(changedRecordIds),
      canonicalProfileJson(receipt),
      revision,
    )
  } finally {
    database.close()
  }
}

function disposableDatabasePath(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eido-595-gui-'))
  disposableRoots.push(root)
  return path.join(root, 'profile.sqlite')
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}
