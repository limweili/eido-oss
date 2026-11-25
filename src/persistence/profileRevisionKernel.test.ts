import { describe, expect, it } from 'vitest'
import { createSeedMod } from '../mods'
import {
  createDirectProfileModInstance,
  createUserProfileModTemplate,
  type ProfileModRecord,
} from './profileModRecords'
import type { ProfileCommandBatch, ProfileSnapshot } from './profileServiceContract'
import {
  PROFILE_CONTRACT_VERSIONS,
  PUBLIC_GATEWAY_COMMAND_REGISTRY,
} from './profileServiceContract'
import {
  applyProfileRevisionPlan,
  canonicalProfileJson,
  encodeProfileSnapshot,
  hydrateProfileSnapshot,
  planProfileCommand,
  ProfileRevisionCorruptionError,
  type ProfileRevisionRecord,
} from './profileRevisionKernel'

const COMMIT_IDENTITY = {
  committedAt: '2026-01-03T00:00:01.000Z',
  commitId: 'commit-note-edited',
  intentEventId: 'event-note-edited',
} as const

describe('transactional Profile revision kernel (#459)', () => {
  it('round-trips independent records and plans one attributed card-content revision', () => {
    const snapshot = assetFreeSnapshot()
    const document = encodeProfileSnapshot(snapshot)

    expect(PUBLIC_GATEWAY_COMMAND_REGISTRY['card.update-content'].affectedRecords).toEqual([
      'card',
      'block',
    ])
    expect(PUBLIC_GATEWAY_COMMAND_REGISTRY['card.set-identity'].affectedRecords).toEqual([
      'card',
      'mod-instance',
    ])
    expect(document.records.map((record) => [record.kind, record.recordId])).toEqual([
      ['profile', 'profile-synthetic'],
      ['compatibility-state', 'compatibility:profile-synthetic'],
      ['idea', 'idea-main'],
      ['board', 'board:idea-main'],
      ['card', 'card-note'],
      ['block', 'block-note'],
    ])
    expect(hydrateProfileSnapshot(document)).toEqual(snapshot)

    const planned = planProfileCommand(document, revisionEightBatch(), COMMIT_IDENTITY)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.value.receipt).toEqual({
      previousRevision: 7,
      revision: 8,
      commitId: 'commit-note-edited',
      commandIds: ['command-note-edited'],
      affectedIds: ['card-note', 'block-note'],
      intentEvents: [{
        id: 'event-note-edited',
        at: '2026-01-03T00:00:01.000Z',
        ideaId: 'idea-main',
        type: 'card.content.edited',
        cardId: 'card-note',
        data: { field: 'body', textLength: 40 },
        commitId: 'commit-note-edited',
        actorId: 'actor-synthetic',
        clientTxnId: 'txn-synthetic-3',
        seq: 1,
      }],
      dryRun: false,
      replayed: false,
    })
    expect(planned.value.upsertedRecords.map((record) => record.recordId)).toEqual([
      'block-note',
      'board:idea-main',
      'compatibility:profile-synthetic',
    ])
    expect(planned.value.insertedRecords.map((record) => record.recordId)).toEqual([
      'event-note-edited',
    ])

    const committed = applyProfileRevisionPlan(document, planned.value)
    const hydrated = hydrateProfileSnapshot(committed)
    expect(hydrated.revision).toBe(8)
    expect(hydrated.boards['idea-main']?.updatedAt).toBe('2026-01-03T00:00:01.000Z')
    expect(hydrated.boards['idea-main']?.cards[0]?.blocks[0]?.text).toBe(
      'Synthetic source note after pending edit',
    )
    expect(hydrated.boards['idea-main']?.intentLog).toEqual(planned.value.receipt.intentEvents)
    expect(hydrateProfileSnapshot(document)).toEqual(snapshot)
  })

  it('admits strict native Mod records without owning their #594 snapshot projection', () => {
    const document = encodeProfileSnapshot(assetFreeSnapshot())
    const template = createUserProfileModTemplate({
      profileId: document.head.profileId,
      templateId: 'mod-template-focus',
      createdAt: '2026-07-19T01:00:00.000Z',
      mod: createSeedMod('switch', {
        title: 'FOCUS',
        createId: (role, ordinal) => `focus-${role}-${ordinal}`,
      }),
    })
    const direct = createDirectProfileModInstance({
      boardRecordId: 'board:idea-main',
      cardId: 'card-note',
      instanceId: 'mod-instance-direct',
      createdAt: '2026-07-19T01:00:00.000Z',
      mod: createSeedMod('switch', {
        title: 'DIRECT',
        createId: (role, ordinal) => `direct-${role}-${ordinal}`,
      }),
    })
    expect(template.ok).toBe(true)
    expect(direct.ok).toBe(true)
    if (!template.ok || !direct.ok) return

    const templateRecord = revisionModRecord(template.value, 0)
    const directRecord = revisionModRecord(direct.value, 0)
    const withMods = {
      ...document,
      records: [...document.records, templateRecord, directRecord],
    }
    const planned = planProfileCommand(withMods, revisionEightBatch(), COMMIT_IDENTITY)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(applyProfileRevisionPlan(withMods, planned.value).records.filter((record) => (
      record.kind === 'mod-template' || record.kind === 'mod-instance'
    ))).toEqual([templateRecord, directRecord])

    const malformedTemplate = {
      ...templateRecord,
      payload: { ...template.value.payload, templateVersion: 0 },
    }
    expect(() => planProfileCommand({
      ...document,
      records: [...document.records, malformedTemplate, directRecord],
    }, revisionEightBatch(), COMMIT_IDENTITY)).toThrow(ProfileRevisionCorruptionError)

    let accessorRead = false
    const accessorPayload = { ...template.value.payload }
    Object.defineProperty(accessorPayload, 'templateVersion', {
      enumerable: true,
      get: () => {
        accessorRead = true
        return 1
      },
    })
    expect(() => planProfileCommand({
      ...document,
      records: [...document.records, { ...templateRecord, payload: accessorPayload }, directRecord],
    }, revisionEightBatch(), COMMIT_IDENTITY)).toThrow(ProfileRevisionCorruptionError)
    expect(accessorRead).toBe(false)
  })

  it('preserves Profile Agent events through legacy record command planning', () => {
    const document = encodeProfileSnapshot(assetFreeSnapshot())
    const profileAgentEvent = revisionProfileAgentEvent(document.head.profileId, document.head.revision)
    const withAgentHistory = {
      ...document,
      records: [...document.records, profileAgentEvent],
    }

    const planned = planProfileCommand(withAgentHistory, revisionEightBatch(), COMMIT_IDENTITY)

    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const committed = applyProfileRevisionPlan(withAgentHistory, planned.value)
    expect(committed.records.find((record) => record.recordId === profileAgentEvent.recordId)).toStrictEqual(
      profileAgentEvent,
    )
  })

  it('canonicalizes semantic JSON and rejects non-mutating invalid paths', () => {
    expect(canonicalProfileJson({ z: 1, nested: { b: 2, a: 1 } })).toBe(
      canonicalProfileJson({ nested: { a: 1, b: 2 }, z: 1 }),
    )
    const prototypePayload = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as unknown
    expect(canonicalProfileJson(prototypePayload)).toBe('{"__proto__":{"polluted":true},"a":1}')
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    const snapshot = assetFreeSnapshot()
    const document = encodeProfileSnapshot(snapshot)

    const stale = planProfileCommand(
      document,
      { ...revisionEightBatch(), expectedRevision: 6 },
      COMMIT_IDENTITY,
    )
    expect(stale).toMatchObject({ ok: false, code: 'conflict', currentRevision: 7 })

    const invalidBatch = revisionEightBatch()
    const invalid = planProfileCommand(document, {
      ...invalidBatch,
      commands: [{
        ...invalidBatch.commands[0],
        payload: { ...invalidBatch.commands[0]?.payload, unexpected: true },
      }],
    }, COMMIT_IDENTITY)
    expect(invalid).toMatchObject({ ok: false, code: 'invalid' })

    const dryRun = planProfileCommand(
      document,
      { ...revisionEightBatch(), dryRun: true },
      COMMIT_IDENTITY,
    )
    expect(dryRun.ok).toBe(true)
    if (dryRun.ok) {
      expect(dryRun.value.receipt).toMatchObject({
        previousRevision: 7,
        revision: 7,
        dryRun: true,
        affectedIds: ['card-note', 'block-note'],
      })
      expect(applyProfileRevisionPlan(document, dryRun.value)).toBe(document)
    }

    const card = snapshot.boards['idea-main']?.cards[0]
    expect(card).toBeDefined()
    expect(() => encodeProfileSnapshot({
      ...snapshot,
      boards: {
        'idea-main': {
          ...snapshot.boards['idea-main']!,
          cards: [{ ...card!, assets: [{ id: 'asset-inline' } as never] }],
        },
      },
    })).toThrow(/#461 owns blob-backed hydration/)
    expect(() => encodeProfileSnapshot({
      ...snapshot,
      boards: {
        'idea-main': {
          ...snapshot.boards['idea-main']!,
          cards: [{
            ...card!,
            modV2: createSeedMod('switch', {
              createId: (role, ordinal) => `kernel-${role}-${ordinal}`,
            }),
          }],
        },
      },
    })).toThrow(/Mod instance/)
    const profileAgentEvent = profileAgentEventRecord(snapshot.profileId)
    expect(() => encodeProfileSnapshot({
      ...snapshot,
      profileAgentEvents: [profileAgentEvent],
    })).toThrow(/Profile Agent events/)
    expect(() => hydrateProfileSnapshot({
      ...document,
      records: [
        ...document.records,
        revisionProfileAgentEvent(document.head.profileId, document.head.revision),
      ],
    })).toThrow(/cannot hydrate Profile Agent events/)
    expect(hydrateProfileSnapshot(document)).toEqual(snapshot)
  })

  it('round-trips prototype-key Idea IDs without losing their Board', () => {
    const base = assetFreeSnapshot()
    const boards = Object.create(null) as ProfileSnapshot['boards']
    boards.__proto__ = base.boards['idea-main']!
    const snapshot: ProfileSnapshot = {
      ...base,
      activeIdeaId: '__proto__',
      ideas: [{ ...base.ideas[0]!, id: '__proto__' }],
      boards,
    }

    const hydrated = hydrateProfileSnapshot(encodeProfileSnapshot(snapshot))

    expect(Object.prototype.hasOwnProperty.call(hydrated.boards, '__proto__')).toBe(true)
    expect(Object.keys(hydrated.boards)).toEqual(['__proto__'])
    expect(hydrated.boards.__proto__?.cards[0]?.id).toBe('card-note')
  })

  it('fails closed when persisted record payload identity is tampered', () => {
    const document = encodeProfileSnapshot(assetFreeSnapshot())
    const tamper = (recordId: string, payload: unknown) => ({
      ...document,
      records: document.records.map((record) => (
        record.recordId === recordId ? { ...record, payload } : record
      )),
    })

    expect(() => hydrateProfileSnapshot(tamper('idea-main', {
      ...assetFreeSnapshot().ideas[0],
      id: 'idea-other',
    }))).toThrow(/Idea record/)
    expect(() => hydrateProfileSnapshot(tamper('block-note', {
      id: 'block-other',
      text: 'Synthetic source note',
      kind: 'line',
    }))).toThrow(/Block record/)
    expect(() => hydrateProfileSnapshot(tamper('compatibility:profile-synthetic', {
      read: 'supported',
      write: 'supported',
      source: 'tampered',
    }))).toThrow(/compatibility record/)
  })
})

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

function revisionModRecord(record: ProfileModRecord, ordinal: number): ProfileRevisionRecord {
  return {
    ...record,
    ordinal,
    createdRevision: 7,
    updatedRevision: 7,
  }
}

function profileAgentEventRecord(profileId: string) {
  return {
    kind: 'profile-agent-event' as const,
    recordId: 'profile-agent-event-legacy-kernel',
    ownerId: profileId,
    parentId: profileId,
    recordVersion: 1 as const,
    payload: {
      version: 1 as const,
      id: 'profile-agent-event-legacy-kernel',
      seq: 1,
      at: '2026-07-20T01:00:00.000Z',
      profileId,
      commitId: 'commit-agent-history',
      actorId: 'agent-history',
      clientTxnId: 'client-agent-history',
      type: 'mod-template.created' as const,
      templateId: 'template-agent-history',
      templateVersion: 1,
      claimedTransitionEvidence: {
        version: 1 as const,
        count: 1,
        sha256: 'a'.repeat(64),
      },
    },
  }
}

function revisionProfileAgentEvent(profileId: string, revision: number): ProfileRevisionRecord {
  return {
    ...profileAgentEventRecord(profileId),
    recordVersion: PROFILE_CONTRACT_VERSIONS.record,
    ordinal: 0,
    createdRevision: revision,
    updatedRevision: revision,
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
