import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Card, SavedBoard } from '../graph/types'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import {
  validateProfileAgentCommandRequestForSurface,
} from './profileAgentCommandInstallation'
import {
  planProfileAgentCommandBatch,
  type ProfileAgentCommandRequest,
  type ProfileAgentCommandTrustedContext,
} from './profileAgentCommandPlan'
import { projectProfileSnapshot, type ProfileLogicalDocument } from './profileLogicalProjection'

const IDEA_ID = 'idea-second'

function fixtureDocument(input: Partial<SavedBoard> = {}): ProfileLogicalDocument {
  const fixture = createCompleteProfileFixture()
  fixture.snapshot.boards[IDEA_ID] = {
    ...fixture.snapshot.boards[IDEA_ID]!,
    ...input,
  }
  return projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
}

function card(id: string, kind: Card['kind'], x: number, additions: Partial<Card> = {}): Card {
  return {
    id,
    kind,
    position: { x, y: 0 },
    blocks: [{ id: `block-v3-${id}`, text: `${kind} body` }],
    ...additions,
  }
}

function request(
  commands: ProfileAgentCommandRequest['commands'],
  additions: Partial<ProfileAgentCommandRequest> = {},
): ProfileAgentCommandRequest {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision: 7,
    idempotencyKey: 'surface-v3-request',
    dryRun: false,
    commands,
    ...additions,
  }
}

function trusted(): ProfileAgentCommandTrustedContext {
  return {
    profileId: 'profile-synthetic',
    actor: {
      id: 'surface-v3-agent',
      kind: 'agent',
      transport: 'test',
      client: 'surface-v3-client',
      sessionId: 'surface-v3-session',
    },
    clientTxnId: 'surface-v3-transaction',
    deriveId: (scope) => `${scope.purpose}:${scope.commandId}`,
    contentSha256: (text) => createHash('sha256').update(text).digest('hex'),
  }
}

describe('Profile Agent command surface v3 (#719/#720)', () => {
  it('keeps v1/v2 normalization exact and admits only the v3 domain shapes on v3', () => {
    const titleCreate = request([{
      version: 1,
      id: 'create-title',
      name: 'card.create',
      payload: {
        ideaId: IDEA_ID,
        kind: 'title',
        body: 'Decision frame',
        near: ['anchor'],
      },
    }])
    expect(validateProfileAgentCommandRequestForSurface(titleCreate, 1))
      .toMatchObject({ ok: false, code: 'invalid' })
    expect(validateProfileAgentCommandRequestForSurface(titleCreate, 2))
      .toMatchObject({ ok: false, code: 'invalid' })
    expect(validateProfileAgentCommandRequestForSurface(titleCreate, 3)).toMatchObject({
      ok: true,
      value: {
        commands: [{
          payload: {
            ideaId: IDEA_ID,
            kind: 'title',
            body: 'Decision frame',
            near: ['anchor'],
          },
        }],
      },
    })

    const legacy = request([{
      version: 1,
      id: 'legacy-note',
      name: 'card.create',
      payload: {
        ideaId: IDEA_ID,
        kind: 'note',
        position: { x: 1, y: 2 },
        text: 'Legacy spelling',
      },
    }])
    const v2 = validateProfileAgentCommandRequestForSurface(legacy, 2)
    const v3 = validateProfileAgentCommandRequestForSurface(legacy, 3)
    expect(v2).toMatchObject({ ok: true })
    expect(v3).toEqual(v2)

    const transcriptSmuggle = request([{
      version: 1,
      id: 'edit-conversation',
      name: 'card.update-content',
      payload: {
        ideaId: IDEA_ID,
        cardId: 'conversation',
        topic: 'Allowed topic',
        transcriptMessageId: 'not-agent-owned',
      },
    }] as never)
    expect(validateProfileAgentCommandRequestForSurface(transcriptSmuggle, 3))
      .toMatchObject({ ok: false, code: 'invalid' })
  })

  it('creates all admitted thought kinds with their domain defaults and exact chosen positions', () => {
    const result = planProfileAgentCommandBatch(fixtureDocument({ cards: [] }), request([
      {
        version: 1, id: 'note', name: 'card.create',
        payload: { ideaId: IDEA_ID, kind: 'note', body: 'Note', position: { x: 0, y: 0 } },
      },
      {
        version: 1, id: 'ask', name: 'card.create',
        payload: { ideaId: IDEA_ID, kind: 'askAi', body: 'Ask', position: { x: 400, y: 0 } },
      },
      {
        version: 1, id: 'title', name: 'card.create',
        payload: { ideaId: IDEA_ID, kind: 'title', body: 'Frame', position: { x: 800, y: 0 } },
      },
      {
        version: 1, id: 'group', name: 'card.create',
        payload: {
          ideaId: IDEA_ID,
          kind: 'group',
          groupTitle: 'Evidence',
          compressionPrompt: 'Compress faithfully.',
          position: { x: 1_200, y: 0 },
        },
      },
      {
        version: 1, id: 'conversation', name: 'card.create',
        payload: {
          ideaId: IDEA_ID,
          kind: 'conversation',
          topic: 'Choose a direction',
          conversationStyle: 'collaborate',
          conversationTurns: 4,
          position: { x: 1_700, y: 0 },
        },
      },
    ]), trusted(), 3)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.commandResults).toEqual([
      expect.objectContaining({ name: 'card.create', position: { x: 0, y: 0 } }),
      expect.objectContaining({ name: 'card.create', position: { x: 400, y: 0 } }),
      expect.objectContaining({ name: 'card.create', position: { x: 800, y: 0 } }),
      expect.objectContaining({ name: 'card.create', position: { x: 1_200, y: 0 } }),
      expect.objectContaining({ name: 'card.create', position: { x: 1_700, y: 0 } }),
    ])
    const cards = result.value.recordChanges.flatMap((change) => (
      change.operation === 'insert' && change.after.kind === 'card' ? [change.after.payload] : []
    ))
    expect(cards).toEqual([
      expect.objectContaining({ kind: 'note' }),
      expect.objectContaining({ kind: 'askAi' }),
      expect.objectContaining({ kind: 'title', size: { width: 320, height: 82 } }),
      expect.objectContaining({
        kind: 'group', title: 'Evidence', compressionPrompt: 'Compress faithfully.',
      }),
      expect.objectContaining({
        kind: 'conversation', conversationStyle: 'collaborate', conversationTurns: 4,
      }),
    ])
  })

  it('computes near placement inside the pinned plan and composes a connected thought atomically', () => {
    const source = fixtureDocument({ cards: [card('anchor', 'note', 0)], connections: [] })
    const commands: ProfileAgentCommandRequest['commands'] = [
      {
        version: 1,
        id: 'create-near',
        name: 'card.create',
        payload: {
          ideaId: IDEA_ID,
          kind: 'note',
          body: 'Adjacent thought',
          near: ['eido://app/?idea=idea-second&card=anchor&x=999&y=-999&zoom=0.1'],
        },
      },
      {
        version: 1,
        id: 'connect-near',
        name: 'connection.create',
        payload: {
          ideaId: IDEA_ID,
          from: { cardId: 'anchor' },
          to: { createdByCommandId: 'create-near' },
        },
      },
    ]
    const dry = planProfileAgentCommandBatch(
      source,
      request(commands, { dryRun: true }),
      trusted(),
      3,
    )
    const apply = planProfileAgentCommandBatch(
      source,
      request(commands, { dryRun: false }),
      trusted(),
      3,
    )

    expect(dry.ok).toBe(true)
    expect(apply.ok).toBe(true)
    if (!dry.ok || !apply.ok) return
    expect(dry.value.commandResults).toEqual(apply.value.commandResults)
    expect(dry.value.recordChanges).toEqual(apply.value.recordChanges)
    expect(apply.value.commandResults[0]).toMatchObject({ position: { x: 290, y: 0 } })
    expect(apply.value.intentEventDrafts.map((draft) => draft.event)).toEqual([
      expect.objectContaining({ type: 'card.created', cardId: 'card:create-near' }),
      expect.objectContaining({ type: 'connection.created' }),
    ])
    expect(apply.value.attribution.actor).toMatchObject({
      kind: 'agent', client: 'surface-v3-client', sessionId: 'surface-v3-session',
    })

    expect(planProfileAgentCommandBatch(
      source,
      request(commands, { expectedRevision: 6 }),
      trusted(),
      3,
    )).toMatchObject({ ok: false, code: 'conflict', currentRevision: 7 })
  })

  it('edits each admitted domain field while keeping transcript identifiers unreachable', () => {
    const source = fixtureDocument({
      cards: [
        card('note', 'note', 0),
        card('title', 'title', 400),
        card('group', 'group', 800, {
          title: 'Old group', compressionPrompt: 'Old prompt',
        }),
        card('conversation', 'conversation', 1_200, {
          conversationStyle: 'debate', conversationTurns: 2,
        }),
        card('result', 'result', 1_600),
        card('mod', 'mod', 2_000),
      ],
      outputs: [],
    })
    const result = planProfileAgentCommandBatch(source, request([
      {
        version: 1, id: 'edit-note', name: 'card.update-content',
        payload: { ideaId: IDEA_ID, cardId: 'note', body: 'New note' },
      },
      {
        version: 1, id: 'edit-title', name: 'card.update-content',
        payload: { ideaId: IDEA_ID, cardId: 'title', body: 'New frame' },
      },
      {
        version: 1, id: 'edit-group', name: 'card.update-content',
        payload: {
          ideaId: IDEA_ID, cardId: 'group',
          groupTitle: 'New group', compressionPrompt: 'New prompt',
        },
      },
      {
        version: 1, id: 'edit-conversation', name: 'card.update-content',
        payload: {
          ideaId: IDEA_ID, cardId: 'conversation', topic: 'New topic',
          conversationStyle: 'critique', conversationTurns: 5,
        },
      },
    ]), trusted(), 3)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.intentEventDrafts.map((draft) => (
      (draft.event as { data: { field: string } }).data.field
    ))).toEqual(['body', 'body', 'title', 'groupPrompt', 'body', 'conversationSettings'])
    const after = Object.fromEntries(result.value.recordChanges.flatMap((change) => (
      change.operation === 'replace' ? [[change.after.recordId, change.after.payload]] : []
    )))
    expect(after.group).toMatchObject({ title: 'New group', compressionPrompt: 'New prompt' })
    expect(after.conversation).toMatchObject({
      conversationStyle: 'critique', conversationTurns: 5,
    })
    expect(after['block-v3-conversation']).toMatchObject({ text: 'New topic' })

    expect(planProfileAgentCommandBatch(source, request([{
      version: 1, id: 'edit-result', name: 'card.update-content',
      payload: { ideaId: IDEA_ID, cardId: 'result', body: 'Forged output' },
    }]), trusted(), 3)).toMatchObject({ ok: false, code: 'capability-denied' })
    expect(planProfileAgentCommandBatch(source, request([{
      version: 1, id: 'delete-mod', name: 'card.delete',
      payload: { ideaId: IDEA_ID, cardId: 'mod' },
    }]), trusted(), 3)).toMatchObject({ ok: false, code: 'capability-denied' })
  })

  it('ungroups members and truthfully deletes the complete Result output cascade', () => {
    const groupSource = fixtureDocument({
      cards: [
        card('group', 'group', 0, { size: { width: 600, height: 400 } }),
        card('member-a', 'note', 30, { groupId: 'group' }),
        card('member-b', 'askAi', 300, { groupId: 'group' }),
      ],
      outputs: [],
      connections: [],
    })
    const groupDelete = planProfileAgentCommandBatch(groupSource, request([{
      version: 1, id: 'delete-group', name: 'card.delete',
      payload: { ideaId: IDEA_ID, cardId: 'group' },
    }]), trusted(), 3)
    expect(groupDelete.ok).toBe(true)
    if (!groupDelete.ok) return
    expect(groupDelete.value.intentEventDrafts[0]?.event).toMatchObject({
      type: 'card.deleted', data: { memberIds: ['member-a', 'member-b'] },
    })
    const memberChanges = groupDelete.value.recordChanges.filter((change) => (
      change.operation === 'replace' && ['member-a', 'member-b'].includes(change.after.recordId)
    ))
    expect(memberChanges).toHaveLength(2)
    expect(memberChanges.every((change) => (
      change.operation === 'replace' && !('groupId' in (change.after.payload as object))
    ))).toBe(true)

    const fixture = createCompleteProfileFixture()
    const resultSource = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const resultDelete = planProfileAgentCommandBatch(resultSource, request([{
      version: 1, id: 'delete-result', name: 'card.delete',
      payload: { ideaId: 'idea-main', cardId: 'card-conversation-result' },
    }]), trusted(), 3)
    expect(resultDelete.ok).toBe(true)
    if (!resultDelete.ok) return
    const deletedKinds = resultDelete.value.recordChanges.flatMap((change) => (
      change.operation === 'delete' ? [change.before.kind] : []
    ))
    expect(deletedKinds).toEqual(expect.arrayContaining([
      'card', 'block', 'output', 'output-version', 'transcript-message',
    ]))
    expect(resultDelete.value.intentEventDrafts[0]?.event).toMatchObject({
      type: 'card.deleted',
      cardId: 'card-conversation-result',
      data: { outputs: [expect.objectContaining({ id: 'output-conversation' })] },
    })
  })

  it('fails closed when a Card kind is outside the explicit v3 delete matrix', () => {
    const source = fixtureDocument({
      cards: [card('mod-outside-delete-matrix', 'mod', 0)],
      outputs: [],
      connections: [],
    })
    expect(planProfileAgentCommandBatch(source, request([{
      version: 1,
      id: 'delete-kind-outside-matrix',
      name: 'card.delete',
      payload: { ideaId: IDEA_ID, cardId: 'mod-outside-delete-matrix' },
    }]), trusted(), 3)).toMatchObject({ ok: false, code: 'capability-denied' })
  })

  it('routes an unrun Ask chain through an empty Result shell without fabricating Run output', () => {
    const commands: ProfileAgentCommandRequest['commands'] = [
      {
        version: 1, id: 'upstream', name: 'card.create',
        payload: { ideaId: IDEA_ID, kind: 'askAi', position: { x: 0, y: 0 }, text: 'One' },
      },
      {
        version: 1, id: 'downstream', name: 'card.create',
        payload: { ideaId: IDEA_ID, kind: 'askAi', position: { x: 600, y: 0 }, text: 'Two' },
      },
      {
        version: 1, id: 'route', name: 'connection.create',
        payload: {
          ideaId: IDEA_ID,
          from: { createdByCommandId: 'upstream' },
          to: { createdByCommandId: 'downstream' },
        },
      },
    ]
    const v2 = planProfileAgentCommandBatch(
      fixtureDocument({ cards: [], connections: [] }), request(commands), trusted(), 2,
    )
    expect(v2).toMatchObject({ ok: true })
    const v3 = planProfileAgentCommandBatch(
      fixtureDocument({ cards: [], connections: [] }), request(commands), trusted(), 3,
    )
    expect(v3).toMatchObject({ ok: true })
    if (!v3.ok) return

    expect(v3.value.commandResults[2]).toEqual({
      commandId: 'route',
      name: 'connection.create',
      route: 'through-result',
      connectionIds: [
        'source-result-connection:route',
        'routed-connection:route',
      ],
      resultCardId: 'result-card:route',
      resultCreated: true,
    })
    expect(v3.value.recordChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'insert',
        after: expect.objectContaining({
          kind: 'card',
          payload: expect.objectContaining({
            id: 'result-card:route',
            kind: 'result',
          }),
        }),
      }),
      expect.objectContaining({
        operation: 'insert',
        after: expect.objectContaining({
          kind: 'block',
          parentId: 'result-card:route',
          payload: expect.objectContaining({
            id: 'result-block:route',
            text: '',
          }),
        }),
      }),
    ]))
    expect(v3.value.recordChanges.some((change) => (
      (change.operation === 'insert' ? change.after : change.before).kind === 'output'
    ))).toBe(false)
    expect(v3.value.recordChanges.some((change) => (
      (change.operation === 'insert' ? change.after : change.before).kind === 'output-version'
    ))).toBe(false)
    expect(v3.value.recordChanges.some((change) => (
      (change.operation === 'insert' ? change.after : change.before).kind === 'run'
    ))).toBe(false)
  })
})
