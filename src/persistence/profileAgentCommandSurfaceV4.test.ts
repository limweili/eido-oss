import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import {
  PROFILE_AGENT_COMMAND_LIMITS,
  selectProfileAgentCommandSurface,
} from './profileAgentCommandManifest'
import {
  planProfileAgentCommandBatch,
  validateProfileAgentCommandRequest,
  type ProfileAgentCommandPlan,
  type ProfileAgentCommandRequest,
  type ProfileAgentCommandTrustedContext,
} from './profileAgentCommandPlan'
import { decodeProfileAgentEventRecord } from './profileAgentEvent'
import {
  hydrateProfileLogicalDocument,
  projectProfileSnapshot,
  type ProfileLogicalDocument,
} from './profileLogicalProjection'

const COMMITTED_AT = '2026-08-02T03:04:05.000Z'

describe('Profile Agent command surface v4 Idea creation', () => {
  it('adds only idea.create to the immutable v3 command inventory', () => {
    const v1 = selectProfileAgentCommandSurface(1)
    const v2 = selectProfileAgentCommandSurface(2)
    const v3 = selectProfileAgentCommandSurface(3)
    const v4 = selectProfileAgentCommandSurface(4)

    expect(v1?.names).not.toContain('idea.create')
    expect(v2?.names).not.toContain('idea.create')
    expect(v3?.names).not.toContain('idea.create')
    expect(v4?.names).toEqual([...v3!.names, 'idea.create'])
    const v4Descriptor = v4?.capability.descriptors[
      (v4?.capability.descriptors.length ?? 0) - 1
    ]
    expect(v4Descriptor).toEqual({
      name: 'idea.create',
      version: 4,
      payloadVersion: 1,
      effects: ['idea', 'board'],
      conditionalEffects: false,
    })
  })

  it('denies Idea creation on v1-v3 and normalizes one bounded v4 name', () => {
    const candidate = request('  Chicken Research_1  ')

    for (const version of [1, 2, 3] as const) {
      expect(validateProfileAgentCommandRequest(
        candidate,
        ['idea.create'],
        version,
      )).toMatchObject({ ok: false, code: 'capability-denied' })
    }
    expect(validateProfileAgentCommandRequest(
      candidate,
      ['idea.create'],
      4,
    )).toMatchObject({
      ok: true,
      value: {
        commands: [{
          name: 'idea.create',
          payload: { name: 'Chicken Research_1' },
        }],
      },
    })

    expect(validateProfileAgentCommandRequest(
      request('   '),
      ['idea.create'],
      4,
    )).toMatchObject({ ok: false, code: 'invalid' })
    expect(validateProfileAgentCommandRequest(
      request('x'.repeat(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes + 1)),
      ['idea.create'],
      4,
    )).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('plans a deterministic inactive Idea and canonical empty Board from trusted commit time', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const candidate = request('  Chicken Research_1  ', document.head.revision)
    const dry = planProfileAgentCommandBatch(
      document,
      { ...candidate, dryRun: true },
      trusted(),
      4,
    )
    const apply = planProfileAgentCommandBatch(document, candidate, trusted(), 4)

    expect(dry.ok).toBe(true)
    expect(apply.ok).toBe(true)
    if (!dry.ok || !apply.ok) return
    expect(dry.value.commandResults).toEqual(apply.value.commandResults)
    expect(dry.value.recordChanges).toEqual(apply.value.recordChanges)
    expect(dry.value.profileAgentEventDrafts).toEqual(apply.value.profileAgentEventDrafts)
    expect(apply.value).toMatchObject({
      scope: { kind: 'profile' },
      revisionAudit: {
        kind: 'profile-revision',
        commitId: 'commit-create-idea',
        committedAt: COMMITTED_AT,
      },
      commandResults: [{
        commandId: 'create-chicken-research',
        name: 'idea.create',
        ideaId: 'idea:create-chicken-research',
        boardId: 'board:idea:create-chicken-research',
        ideaName: 'Chicken Research_1',
      }],
      intentEventDrafts: [],
      profileAgentEventDrafts: [{
        version: 1,
        type: 'idea.created',
        ideaId: 'idea:create-chicken-research',
        boardId: 'board:idea:create-chicken-research',
        ideaName: 'Chicken Research_1',
      }],
    })

    const inserted = apply.value.recordChanges.flatMap((change) => (
      change.operation === 'insert' ? [change.after] : []
    ))
    expect(inserted).toEqual([
      expect.objectContaining({
        recordId: 'idea:create-chicken-research',
        kind: 'idea',
        ownerId: 'profile-synthetic',
        parentId: 'profile-synthetic',
        ordinal: fixture.snapshot.ideas.length,
        payload: {
          id: 'idea:create-chicken-research',
          name: 'Chicken Research_1',
          createdAt: COMMITTED_AT,
          updatedAt: COMMITTED_AT,
          lastOpenedAt: COMMITTED_AT,
        },
      }),
      expect.objectContaining({
        recordId: 'board:idea:create-chicken-research',
        kind: 'board',
        ownerId: 'idea:create-chicken-research',
        parentId: 'idea:create-chicken-research',
        ordinal: 0,
        payload: { version: 1, updatedAt: COMMITTED_AT },
      }),
    ])
    expect(apply.value.affectedRecords).toEqual([
      { recordId: 'idea:create-chicken-research', kind: 'idea', operation: 'insert' },
      { recordId: 'board:idea:create-chicken-research', kind: 'board', operation: 'insert' },
    ])

    const next = applyPlan(document, apply.value)
    const snapshot = hydrateProfileLogicalDocument(next, fixture.hydrateAsset)
    expect(snapshot.activeIdeaId).toBe(fixture.snapshot.activeIdeaId)
    expect(snapshot.ideas[snapshot.ideas.length - 1]).toEqual({
      id: 'idea:create-chicken-research',
      name: 'Chicken Research_1',
      createdAt: COMMITTED_AT,
      updatedAt: COMMITTED_AT,
      lastOpenedAt: COMMITTED_AT,
    })
    expect(snapshot.boards['idea:create-chicken-research']).toEqual({
      version: 1,
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      updatedAt: COMMITTED_AT,
    })
  })

  it('rejects mixing the Profile-scoped create with an Idea-scoped Board command', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const candidate = {
      ...request('Chicken Research_1', document.head.revision),
      commands: [
        ...request('Chicken Research_1').commands,
        {
          version: 1,
          id: 'create-note',
          name: 'card.create',
          payload: {
            ideaId: fixture.snapshot.activeIdeaId,
            kind: 'note',
            body: 'Must be a later revision',
            position: { x: 0, y: 0 },
          },
        },
      ],
    }

    expect(planProfileAgentCommandBatch(document, candidate, trusted(), 4))
      .toMatchObject({ ok: false, code: 'invalid' })
  })

  it('allows a new Idea to reuse an existing display name', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const existingName = fixture.snapshot.ideas[0]!.name

    expect(planProfileAgentCommandBatch(
      document,
      request(existingName, document.head.revision),
      trusted(),
      4,
    )).toMatchObject({
      ok: true,
      value: {
        commandResults: [{
          name: 'idea.create',
          ideaName: existingName,
        }],
      },
    })
  })

  it('decodes only the exact Profile-owned idea.created event shape', () => {
    const record = {
      kind: 'profile-agent-event',
      recordId: 'profile-agent-event-create-idea',
      ownerId: 'profile-synthetic',
      parentId: 'profile-synthetic',
      recordVersion: 1,
      payload: {
        version: 1,
        id: 'profile-agent-event-create-idea',
        seq: 3,
        at: COMMITTED_AT,
        profileId: 'profile-synthetic',
        commitId: 'commit-create-idea',
        actorId: 'agent-create-idea',
        clientTxnId: 'client-create-idea',
        claimedTransitionEvidence: {
          version: 1,
          count: 2,
          sha256: 'a'.repeat(64),
        },
        type: 'idea.created',
        ideaId: 'idea:create-chicken-research',
        boardId: 'board:idea:create-chicken-research',
        ideaName: 'Chicken Research_1',
      },
    }

    expect(decodeProfileAgentEventRecord(record)).toMatchObject({ ok: true, value: record })
    expect(decodeProfileAgentEventRecord({
      ...record,
      payload: { ...record.payload, boardId: 'board:wrong' },
    })).toMatchObject({ ok: false, code: 'invalid' })
    expect(decodeProfileAgentEventRecord({
      ...record,
      payload: { ...record.payload, ideaName: ' Chicken Research_1' },
    })).toMatchObject({ ok: false, code: 'invalid' })
    expect(decodeProfileAgentEventRecord({
      ...record,
      payload: { ...record.payload, extra: true },
    })).toMatchObject({ ok: false, code: 'invalid' })
  })
})

function request(
  name: string,
  expectedRevision = 7,
): ProfileAgentCommandRequest {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision,
    idempotencyKey: 'create-chicken-research-1',
    dryRun: false,
    commands: [{
      version: 1,
      id: 'create-chicken-research',
      name: 'idea.create',
      payload: { name },
    }],
  }
}

function trusted(): ProfileAgentCommandTrustedContext {
  return {
    profileId: 'profile-synthetic',
    actor: {
      id: 'agent-create-idea',
      kind: 'agent',
      transport: 'test',
      client: 'surface-v4-client',
      sessionId: 'surface-v4-session',
    },
    clientTxnId: 'client-create-idea',
    commitId: 'commit-create-idea',
    committedAt: COMMITTED_AT,
    deriveId: (scope) => `${scope.purpose}:${scope.commandId}`,
    contentSha256: (text) => createHash('sha256').update(text).digest('hex'),
  }
}

function applyPlan(
  document: ProfileLogicalDocument,
  plan: ProfileAgentCommandPlan,
): ProfileLogicalDocument {
  const records = new Map(document.records.map((record) => [record.recordId, record]))
  for (const change of plan.recordChanges) {
    if (change.operation === 'delete') records.delete(change.before.recordId)
    else records.set(change.after.recordId, change.after)
  }
  return {
    head: { ...document.head, revision: plan.proposedRevision },
    records: [...records.values()],
  }
}
