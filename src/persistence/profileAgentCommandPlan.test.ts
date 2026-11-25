import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Card, Connection, SavedBoard } from '../graph/types'
import { toProfileLogicalAssetPayload } from './profileAssetKernel'
import {
  projectProfileSnapshot,
  type ProfileLogicalDocument,
} from './profileLogicalProjection'
import {
  PROFILE_CONTRACT_VERSIONS,
  type ProfileSnapshot,
} from './profileServiceContract'
import {
  PROFILE_AGENT_BOARD_COMMAND_DESCRIPTORS,
  PROFILE_AGENT_COMMAND_LIMITS,
  planProfileAgentCommandBatch,
  type ProfileAgentCommandRequest,
  type ProfileAgentCommandTrustedContext,
} from './profileAgentCommandPlan'

const AT = '2026-07-19T00:00:00.000Z'
const PROFILE_ID = 'profile-command-test'
const IDEA_ID = 'idea-command-test'

function card(id: string, kind: Card['kind'], text = ''): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text }],
    position: { x: 0, y: 0 },
  }
}

function connection(id: string, fromCardId: string, toCardId: string): Connection {
  return {
    id,
    from: { cardId: fromCardId },
    to: { cardId: toCardId },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  }
}

function logicalDocument(input: {
  revision?: number
  cards?: Card[]
  connections?: Connection[]
  outputs?: SavedBoard['outputs']
} = {}): ProfileLogicalDocument {
  const snapshot: ProfileSnapshot = {
    profileId: PROFILE_ID,
    revision: input.revision ?? 7,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId: IDEA_ID,
    ideas: [{
      id: IDEA_ID,
      name: 'Command test',
      createdAt: AT,
      updatedAt: AT,
      lastOpenedAt: AT,
    }],
    boards: {
      [IDEA_ID]: {
        version: 1,
        cards: input.cards ?? [],
        connections: input.connections ?? [],
        outputs: input.outputs ?? [],
        runs: [],
        updatedAt: AT,
      },
    },
    modTemplates: [],
    modInstances: [],
    profileSettings: [],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
  return projectProfileSnapshot(snapshot, (asset) => (
    toProfileLogicalAssetPayload(asset, 'a'.repeat(64))
  ))
}

function request(
  commands: ProfileAgentCommandRequest['commands'],
  additions: Partial<ProfileAgentCommandRequest> = {},
): ProfileAgentCommandRequest {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision: 7,
    idempotencyKey: 'command-request-1',
    dryRun: false,
    commands,
    ...additions,
  }
}

function trusted(
  observedScopes: string[] = [],
): ProfileAgentCommandTrustedContext {
  return {
    profileId: PROFILE_ID,
    actor: {
      id: 'agent-command-test', kind: 'agent', transport: 'test',
      client: 'agent-command-client', sessionId: 'agent-command-session',
    },
    clientTxnId: 'client-transaction-command-test',
    contentSha256: (text) => createHash('sha256').update(text).digest('hex'),
    deriveId(scope) {
      observedScopes.push(JSON.stringify(scope))
      return `${scope.purpose}:${scope.commandId}`
    },
  }
}

describe('Profile Agent command planning', () => {
  it('rejects caller-supplied attribution before invoking trusted ID derivation', () => {
    const observedScopes: string[] = []
    const candidate = {
      ...request([{
        version: 1,
        id: 'create-note',
        name: 'card.create',
        payload: {
          ideaId: IDEA_ID,
          kind: 'note',
          position: { x: 10, y: 20 },
          text: 'A bounded thought',
        },
      }]),
      actor: {
        id: 'forged', kind: 'agent', transport: 'cli',
        client: 'forged-client', sessionId: 'forged-session',
      },
    }

    const result = planProfileAgentCommandBatch(logicalDocument(), candidate, trusted(observedScopes))

    expect(result).toMatchObject({ ok: false, code: 'invalid' })
    expect(observedScopes).toEqual([])
  })

  it('plans one bounded Card create as immutable logical records plus an unstamped Intent draft', () => {
    const source = logicalDocument()
    const result = planProfileAgentCommandBatch(source, request([{
      version: 1,
      id: 'create-note',
      name: 'card.create',
      payload: {
        ideaId: IDEA_ID,
        kind: 'note',
        position: { x: 10, y: 20 },
        text: 'A bounded thought',
      },
    }]), trusted())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      version: 1,
      profileId: PROFILE_ID,
      ideaId: IDEA_ID,
      baseRevision: 7,
      proposedRevision: 8,
      dryRun: false,
      attribution: {
        profileId: PROFILE_ID,
        actor: {
          id: 'agent-command-test', kind: 'agent', transport: 'test',
          client: 'agent-command-client', sessionId: 'agent-command-session',
        },
        clientTxnId: 'client-transaction-command-test',
      },
      commandResults: [{
        commandId: 'create-note',
        name: 'card.create',
        cardId: 'card:create-note',
        blockId: 'block:create-note',
      }],
      recordChanges: [
        {
          operation: 'insert',
          after: {
            recordId: 'card:create-note',
            kind: 'card',
            ownerId: `board:${IDEA_ID}`,
            parentId: `board:${IDEA_ID}`,
            ordinal: 0,
            payload: {
              id: 'card:create-note',
              kind: 'note',
              position: { x: 10, y: 20 },
              zIndex: 0,
            },
          },
        },
        {
          operation: 'insert',
          after: {
            recordId: 'block:create-note',
            kind: 'block',
            ownerId: `board:${IDEA_ID}`,
            parentId: 'card:create-note',
            ordinal: 0,
            payload: { id: 'block:create-note', text: 'A bounded thought' },
          },
        },
      ],
      intentEventDrafts: [{
        ideaId: IDEA_ID,
        event: {
          type: 'card.created',
          cardId: 'card:create-note',
          data: {
            card: {
              id: 'card:create-note',
              kind: 'note',
              blocks: [{ id: 'block:create-note', text: 'A bounded thought' }],
              position: { x: 10, y: 20 },
              zIndex: 0,
            },
          },
        },
      }],
    })
    expect(result.value.intentEventDrafts[0]?.event).not.toHaveProperty('id')
    expect(result.value.intentEventDrafts[0]?.event).not.toHaveProperty('at')
    expect(result.value.intentEventDrafts[0]?.event).not.toHaveProperty('actorId')
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.recordChanges)).toBe(true)
    expect(source.records).toHaveLength(4)
  })

  it('shares GUI collision, group, and legacy layer placement for created Cards', () => {
    const empty = planProfileAgentCommandBatch(logicalDocument(), request([{
      version: 1,
      id: 'create-on-empty-board',
      name: 'card.create',
      payload: { ideaId: IDEA_ID, kind: 'note', position: { x: 0, y: 0 } },
    }]), trusted())
    expect(empty.ok).toBe(true)
    if (!empty.ok) return
    expect(empty.value.recordChanges).toContainEqual(expect.objectContaining({
      operation: 'insert',
      after: expect.objectContaining({
        recordId: 'card:create-on-empty-board',
        payload: expect.objectContaining({ position: { x: 0, y: 0 }, zIndex: 0 }),
      }),
    }))

    const group = {
      ...card('group-existing', 'group'),
      position: { x: 0, y: 0 },
      size: { width: 600, height: 400 },
    }
    const legacyCard = {
      ...card('legacy-note', 'note'),
      position: { x: 40, y: 40 },
    }
    const placed = planProfileAgentCommandBatch(
      logicalDocument({ cards: [group, legacyCard] }),
      request([{
        version: 1,
        id: 'create-inside-group',
        name: 'card.create',
        payload: { ideaId: IDEA_ID, kind: 'askAi', position: { x: 40, y: 40 } },
      }]),
      trusted(),
    )

    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    const afterById = Object.fromEntries(placed.value.recordChanges.map((change) => {
      const record = change.operation === 'delete' ? change.before : change.after
      return [record.recordId, record]
    }))
    expect(afterById['card:create-inside-group']).toMatchObject({
      kind: 'card',
      payload: {
        id: 'card:create-inside-group',
        kind: 'askAi',
        position: { x: 74, y: 40 },
        zIndex: 2,
        groupId: 'group-existing',
      },
    })
    expect(afterById['legacy-note']).toMatchObject({
      kind: 'card',
      payload: expect.objectContaining({ groupId: 'group-existing' }),
    })
    expect(placed.value.intentEventDrafts[0]?.event).not.toHaveProperty('data.card.groupId')
  })

  it('admits declared coordinate boundaries and rejects geometry beyond them', () => {
    const limit = PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate
    const atBoundary = planProfileAgentCommandBatch(logicalDocument(), request([{
      version: 1,
      id: 'create-at-boundary',
      name: 'card.create',
      payload: {
        ideaId: IDEA_ID,
        kind: 'note',
        position: { x: limit, y: -limit },
      },
    }]), trusted())
    expect(atBoundary).toMatchObject({ ok: true })

    const beyondBoundary = planProfileAgentCommandBatch(logicalDocument(), request([{
      version: 1,
      id: 'create-beyond-boundary',
      name: 'card.create',
      payload: {
        ideaId: IDEA_ID,
        kind: 'note',
        position: { x: limit + 1, y: 0 },
      },
    }]), trusted())
    expect(beyondBoundary).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('routes backward references between two new Ask Cards through one deterministic system Result', () => {
    const commands: ProfileAgentCommandRequest['commands'] = [
      {
        version: 1,
        id: 'create-upstream',
        name: 'card.create',
        payload: {
          ideaId: IDEA_ID,
          kind: 'askAi',
          position: { x: 0, y: 0 },
          text: 'Find the strongest evidence.',
        },
      },
      {
        version: 1,
        id: 'create-downstream',
        name: 'card.create',
        payload: {
          ideaId: IDEA_ID,
          kind: 'askAi',
          position: { x: 600, y: 0 },
          text: 'Turn it into a decision.',
        },
      },
      {
        version: 1,
        id: 'route-chain',
        name: 'connection.create',
        payload: {
          ideaId: IDEA_ID,
          from: { createdByCommandId: 'create-upstream' },
          to: { createdByCommandId: 'create-downstream' },
        },
      },
    ]
    const dryRunScopes: string[] = []
    const applyScopes: string[] = []
    const dryRun = planProfileAgentCommandBatch(
      logicalDocument(),
      request(commands, { dryRun: true }),
      trusted(dryRunScopes),
    )
    const apply = planProfileAgentCommandBatch(
      logicalDocument(),
      request(commands, { dryRun: false }),
      trusted(applyScopes),
    )

    expect(dryRun.ok).toBe(true)
    expect(apply.ok).toBe(true)
    if (!dryRun.ok || !apply.ok) return
    const inserted = apply.value.recordChanges.flatMap((change) => (
      change.operation === 'insert' ? [change.after] : []
    ))
    expect(inserted.filter((record) => record.kind === 'card').map((record) => record.payload)).toEqual([
      expect.objectContaining({ id: 'card:create-upstream', kind: 'askAi' }),
      expect.objectContaining({ id: 'card:create-downstream', kind: 'askAi' }),
      expect.objectContaining({ id: 'result-card:route-chain', kind: 'result' }),
    ])
    expect(inserted.filter((record) => record.kind === 'block')).toHaveLength(3)
    const connections = inserted
      .filter((record) => record.kind === 'connection')
      .map((record) => record.payload)
    expect(connections).toEqual([
      expect.objectContaining({
        id: 'source-result-connection:route-chain',
        from: { cardId: 'card:create-upstream' },
        to: { cardId: 'result-card:route-chain' },
      }),
      expect.objectContaining({
        id: 'routed-connection:route-chain',
        from: { cardId: 'result-card:route-chain' },
        to: { cardId: 'card:create-downstream' },
      }),
    ])
    expect(connections).not.toContainEqual(expect.objectContaining({
      from: { cardId: 'card:create-upstream' },
      to: { cardId: 'card:create-downstream' },
    }))
    expect(apply.value.intentEventDrafts.map((draft) => (
      (draft.event as { type: string }).type
    ))).toEqual([
      'card.created',
      'card.created',
      'card.created',
      'connection.created',
      'connection.created',
    ])
    expect(apply.value.commandResults).toEqual([
      {
        commandId: 'create-upstream',
        name: 'card.create',
        cardId: 'card:create-upstream',
        blockId: 'block:create-upstream',
      },
      {
        commandId: 'create-downstream',
        name: 'card.create',
        cardId: 'card:create-downstream',
        blockId: 'block:create-downstream',
      },
      {
        commandId: 'route-chain',
        name: 'connection.create',
        route: 'through-result',
        connectionIds: [
          'source-result-connection:route-chain',
          'routed-connection:route-chain',
        ],
        resultCardId: 'result-card:route-chain',
        resultCreated: true,
      },
    ])
    expect(dryRun.value.recordChanges).toEqual(apply.value.recordChanges)
    expect(dryRun.value.intentEventDrafts).toEqual(apply.value.intentEventDrafts)
    expect(dryRunScopes).toEqual(applyScopes)
    expect(dryRunScopes.every((scope) => !scope.includes('dryRun'))).toBe(true)
  })

  it('reindexes each mutable step so later commands reuse a Result created earlier in the batch', () => {
    const result = planProfileAgentCommandBatch(
      logicalDocument({
        cards: [
          card('ask-source', 'askAi'),
          card('ask-first-target', 'askAi'),
          card('ask-second-target', 'askAi'),
        ],
      }),
      request([
        {
          version: 1,
          id: 'route-first',
          name: 'connection.create',
          payload: {
            ideaId: IDEA_ID,
            from: { cardId: 'ask-source' },
            to: { cardId: 'ask-first-target' },
          },
        },
        {
          version: 1,
          id: 'route-second',
          name: 'connection.create',
          payload: {
            ideaId: IDEA_ID,
            from: { cardId: 'ask-source' },
            to: { cardId: 'ask-second-target' },
          },
        },
      ]),
      trusted(),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const inserted = result.value.recordChanges.flatMap((change) => (
      change.operation === 'insert' ? [change.after] : []
    ))
    expect(inserted.filter((record) => record.kind === 'card')).toHaveLength(1)
    expect(inserted.filter((record) => record.kind === 'connection')).toHaveLength(3)
    expect(result.value.commandResults).toEqual([
      {
        commandId: 'route-first',
        name: 'connection.create',
        route: 'through-result',
        connectionIds: [
          'source-result-connection:route-first',
          'routed-connection:route-first',
        ],
        resultCardId: 'result-card:route-first',
        resultCreated: true,
      },
      {
        commandId: 'route-second',
        name: 'connection.create',
        route: 'through-result',
        connectionIds: ['routed-connection:route-second'],
        resultCardId: 'result-card:route-first',
        resultCreated: false,
      },
    ])
  })

  it('plans narrow Card content and Connection meaning updates before a same-batch Connection delete', () => {
    const source = logicalDocument({
      cards: [card('note-existing', 'note', 'Before'), card('ask-existing', 'askAi', 'Question')],
      connections: [connection('connection-existing', 'note-existing', 'ask-existing')],
    })
    const result = planProfileAgentCommandBatch(source, request([
      {
        version: 1,
        id: 'edit-note',
        name: 'card.update-content',
        payload: {
          ideaId: IDEA_ID,
          cardId: 'note-existing',
          blockId: 'note-existing-block',
          text: 'After',
        },
      },
      {
        version: 1,
        id: 'mark-connection',
        name: 'connection.update-meaning',
        payload: {
          ideaId: IDEA_ID,
          connectionId: 'connection-existing',
          strength: 'weak',
          polarity: 'pushesAgainst',
          reason: '  already explored  ',
        },
      },
      {
        version: 1,
        id: 'delete-connection',
        name: 'connection.delete',
        payload: { ideaId: IDEA_ID, connectionId: 'connection-existing' },
      },
    ]), trusted())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.recordChanges).toEqual([
      expect.objectContaining({
        operation: 'replace',
        before: expect.objectContaining({ recordId: 'note-existing', kind: 'card' }),
        after: expect.objectContaining({
          recordId: 'note-existing',
          payload: expect.objectContaining({
            lastModifiedBy: {
              kind: 'agent',
              client: 'agent-command-client',
              sessionId: 'agent-command-session',
            },
          }),
        }),
      }),
      expect.objectContaining({
        operation: 'replace',
        before: expect.objectContaining({
          recordId: 'note-existing-block',
          payload: { id: 'note-existing-block', text: 'Before' },
        }),
        after: expect.objectContaining({
          recordId: 'note-existing-block',
          payload: { id: 'note-existing-block', text: 'After' },
        }),
      }),
      expect.objectContaining({
        operation: 'delete',
        before: expect.objectContaining({ recordId: 'connection-existing', kind: 'connection' }),
      }),
    ])
    expect(result.value.intentEventDrafts).toEqual([
      expect.objectContaining({
        event: {
          type: 'card.content.edited',
          cardId: 'note-existing',
          data: {
            field: 'body',
            textLength: 5,
            contentSha256: createHash('sha256').update('After').digest('hex'),
          },
        },
      }),
      expect.objectContaining({
        event: {
          type: 'connection.changed',
          connectionId: 'connection-existing',
          data: {
            before: expect.objectContaining({ strength: 'strong', polarity: 'helps' }),
            after: expect.objectContaining({
              strength: 'weak',
              polarity: 'pushesAgainst',
              reason: 'already explored',
            }),
          },
        },
      }),
      expect.objectContaining({
        event: {
          type: 'connection.deleted',
          connectionId: 'connection-existing',
          data: {
            connection: expect.objectContaining({
              strength: 'weak',
              polarity: 'pushesAgainst',
              reason: 'already explored',
            }),
          },
        },
      }),
    ])
    expect(result.value.commandResults).toEqual([
      {
        commandId: 'edit-note',
        name: 'card.update-content',
        cardId: 'note-existing',
        blockId: 'note-existing-block',
      },
      {
        commandId: 'mark-connection',
        name: 'connection.update-meaning',
        connectionId: 'connection-existing',
      },
      {
        commandId: 'delete-connection',
        name: 'connection.delete',
        connectionId: 'connection-existing',
      },
    ])
  })

  it('preserves a Note website preview when an Agent replaces its body', () => {
    const linkCard: Card = {
      ...card('link-existing', 'note', 'https://drybread.studio/'),
      linkPreview: {
        url: 'https://drybread.studio/',
        status: 'ready',
        title: 'Drybread Studios',
      },
    }
    const result = planProfileAgentCommandBatch(logicalDocument({
      cards: [linkCard],
    }), request([{
      version: 1,
      id: 'replace-link-body',
      name: 'card.update-content',
      payload: {
        ideaId: IDEA_ID,
        cardId: linkCard.id,
        blockId: 'link-existing-block',
        text: 'An ordinary editable note',
      },
    }]), trusted())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const replacement = result.value.recordChanges.find((change) => (
      change.operation === 'replace' && change.after.recordId === linkCard.id
    ))
    expect(replacement).toMatchObject({
      operation: 'replace',
      after: {
        kind: 'card',
      },
    })
    if (replacement?.operation === 'replace' && replacement.after.kind === 'card') {
      expect(replacement.after.payload).toMatchObject({
        linkPreview: linkCard.linkPreview,
      })
    }
    expect(result.value.recordChanges).toContainEqual(expect.objectContaining({
      operation: 'replace',
      after: expect.objectContaining({
        recordId: 'link-existing-block',
        kind: 'block',
        payload: expect.objectContaining({ text: 'An ordinary editable note' }),
      }),
    }))
  })

  it('deletes one Card closure, renumbers surviving records, and keeps only projected asset metadata in history', () => {
    const assetCard: Card = {
      ...card('note-deleted', 'note', 'Retired evidence'),
      assets: [{
        id: 'asset-deleted',
        kind: 'image',
        name: 'synthetic.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AA==',
        size: 1,
        createdAt: AT,
      }],
    }
    const source = logicalDocument({
      cards: [assetCard, card('note-retained', 'note'), card('ask-retained', 'askAi')],
      connections: [
        connection('connection-deleted', 'note-deleted', 'ask-retained'),
        connection('connection-retained', 'note-retained', 'ask-retained'),
      ],
      outputs: [{ id: 'output-deleted', resultCardId: 'note-deleted', versions: [] }],
    })
    const result = planProfileAgentCommandBatch(source, request([{
      version: 1,
      id: 'delete-note',
      name: 'card.delete',
      payload: { ideaId: IDEA_ID, cardId: 'note-deleted' },
    }]), trusted())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const operationById = Object.fromEntries(result.value.recordChanges.map((change) => {
      const record = change.operation === 'delete' ? change.before : change.after
      return [record.recordId, change]
    }))
    expect(operationById['note-retained']).toMatchObject({
      operation: 'replace',
      before: { ordinal: 1 },
      after: { ordinal: 0 },
    })
    expect(operationById['ask-retained']).toMatchObject({
      operation: 'replace',
      before: { ordinal: 2 },
      after: { ordinal: 1 },
    })
    expect(operationById['connection-retained']).toMatchObject({
      operation: 'replace',
      before: { ordinal: 1 },
      after: { ordinal: 0 },
    })
    for (const recordId of [
      'note-deleted',
      'note-deleted-block',
      'asset-deleted',
      'connection-deleted',
      'output-deleted',
    ]) expect(operationById[recordId]).toMatchObject({ operation: 'delete' })

    expect(result.value.commandResults).toEqual([{
      commandId: 'delete-note',
      name: 'card.delete',
      cardId: 'note-deleted',
    }])
    const deletionDescriptor = PROFILE_AGENT_BOARD_COMMAND_DESCRIPTORS['card.delete']
    expect(deletionDescriptor).toEqual({
      name: 'card.delete',
      payloadVersion: 1,
      dryRun: true,
      profileAgentEventCount: 0,
      supportedCardKinds: ['note', 'askAi', 'title', 'group', 'conversation', 'result'],
      effects: [
        'card',
        'block',
        'connection',
        'output',
        'output-version',
        'transcript-message',
        'follow-up-message',
        'logical-asset',
        'highlight',
        'mod-instance',
      ],
      conditionalEffects: true,
    })
    const deletedKinds = result.value.affectedRecords
      .filter((record) => record.operation === 'delete')
      .map((record) => record.kind)
    expect(deletedKinds.every((kind) => deletionDescriptor.effects.includes(kind))).toBe(true)

    const draft = result.value.intentEventDrafts[0]
    expect(draft).toMatchObject({
      ideaId: IDEA_ID,
      event: {
        type: 'card.deleted',
        cardId: 'note-deleted',
        data: {
          card: {
            id: 'note-deleted',
            assets: [{
              id: 'asset-deleted',
              assetVersion: 1,
              sha256: 'a'.repeat(64),
            }],
          },
          connections: [expect.objectContaining({ id: 'connection-deleted' })],
          outputs: [expect.objectContaining({ id: 'output-deleted' })],
        },
      },
    })
    expect(JSON.stringify(draft)).not.toContain('data:image')
    expect(JSON.stringify(draft)).not.toContain('dataUrl')
  })

  it('fails closed on denied commands, future versions, extra keys, mixed Ideas, and bounded content', () => {
    const validCreate = {
      version: 1,
      id: 'create-note',
      name: 'card.create',
      payload: {
        ideaId: IDEA_ID,
        kind: 'note',
        position: { x: 0, y: 0 },
        text: 'Bounded',
      },
    }
    const cases: Array<{ candidate: unknown; code: string }> = [
      {
        candidate: request([{ ...validCreate, name: 'raw-sql' } as never]),
        code: 'capability-denied',
      },
      {
        candidate: request([{ ...validCreate, name: 'mod-template.create' } as never]),
        code: 'invalid',
      },
      {
        candidate: request([{ ...validCreate, version: 2 } as never]),
        code: 'unsupported-future-version',
      },
      {
        candidate: request([{
          ...validCreate,
          payload: {
            ...validCreate.payload,
            text: 'x'.repeat(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes + 1),
          },
        } as never]),
        code: 'invalid',
      },
      {
        candidate: request([{
          ...validCreate,
          payload: { ...validCreate.payload, actorId: 'forged' },
        } as never]),
        code: 'invalid',
      },
      {
        candidate: request([
          validCreate as never,
          {
            ...validCreate,
            id: 'create-other',
            payload: { ...validCreate.payload, ideaId: 'idea-other' },
          } as never,
        ]),
        code: 'invalid',
      },
    ]

    for (const testCase of cases) {
      expect(planProfileAgentCommandBatch(logicalDocument(), testCase.candidate, trusted())).toMatchObject({
        ok: false,
        code: testCase.code,
      })
    }

    let getterInvoked = false
    const executablePayload = Object.create(null) as Record<string, unknown>
    Object.assign(executablePayload, {
      ideaId: IDEA_ID,
      kind: 'note',
      position: { x: 0, y: 0 },
    })
    Object.defineProperty(executablePayload, 'text', {
      enumerable: true,
      get() {
        getterInvoked = true
        return 'must not execute'
      },
    })
    expect(planProfileAgentCommandBatch(logicalDocument(), request([{
      ...validCreate,
      payload: executablePayload,
    } as never]), trusted())).toMatchObject({ ok: false, code: 'invalid' })
    expect(getterInvoked).toBe(false)
  })

  it('leaves source and request immutable when a later command uses a forward Card reference', () => {
    const source = logicalDocument()
    const candidate = request([
      {
        version: 1,
        id: 'create-first',
        name: 'card.create',
        payload: { ideaId: IDEA_ID, kind: 'note', position: { x: 0, y: 0 } },
      },
      {
        version: 1,
        id: 'connect-forward',
        name: 'connection.create',
        payload: {
          ideaId: IDEA_ID,
          from: { createdByCommandId: 'create-first' },
          to: { createdByCommandId: 'create-later' },
        },
      },
      {
        version: 1,
        id: 'create-later',
        name: 'card.create',
        payload: { ideaId: IDEA_ID, kind: 'askAi', position: { x: 300, y: 0 } },
      },
    ])
    const sourceBefore = JSON.stringify(source)
    const requestBefore = JSON.stringify(candidate)

    const result = planProfileAgentCommandBatch(source, candidate, trusted())

    expect(result).toMatchObject({ ok: false, code: 'invalid' })
    expect(JSON.stringify(source)).toBe(sourceBefore)
    expect(JSON.stringify(candidate)).toBe(requestBefore)
  })

  it('rejects stale or overflowing revisions and invalid authority-derived identities before producing a plan', () => {
    const create = [{
      version: 1,
      id: 'create-note',
      name: 'card.create',
      payload: { ideaId: IDEA_ID, kind: 'note', position: { x: 0, y: 0 } },
    }] as const
    const staleScopes: string[] = []
    expect(planProfileAgentCommandBatch(
      logicalDocument(),
      request(create, { expectedRevision: 6 }),
      trusted(staleScopes),
    )).toMatchObject({ ok: false, code: 'conflict', currentRevision: 7 })
    expect(staleScopes).toEqual([])

    expect(planProfileAgentCommandBatch(
      logicalDocument({ revision: Number.MAX_SAFE_INTEGER }),
      request(create, { expectedRevision: Number.MAX_SAFE_INTEGER }),
      trusted(),
    )).toMatchObject({
      ok: false,
      code: 'internal',
      currentRevision: Number.MAX_SAFE_INTEGER,
    })

    const collidingContext: ProfileAgentCommandTrustedContext = {
      ...trusted(),
      deriveId: () => 'note-existing',
    }
    expect(planProfileAgentCommandBatch(
      logicalDocument({ cards: [card('note-existing', 'note')] }),
      request(create),
      collidingContext,
    )).toMatchObject({ ok: false, code: 'internal', currentRevision: 7 })

    expect(planProfileAgentCommandBatch(
      logicalDocument(),
      request(create),
      { ...trusted(), deriveId: 7 } as never,
    )).toMatchObject({ ok: false, code: 'internal' })
  })
})
