import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { SavedBoard } from '../graph/types'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import {
  PROFILE_AGENT_COMMAND_RESULT_LIMITS,
  selectProfileAgentCommandSurface,
} from './profileAgentCommandManifest'
import {
  planProfileAgentCommandBatch,
  validateProfileAgentCommandRequest,
  type ProfileAgentCommandTrustedContext,
} from './profileAgentCommandPlan'
import {
  hydrateProfileLogicalDocument,
  projectProfileSnapshot,
} from './profileLogicalProjection'

const IDEA_ID = 'idea-second'

describe('Profile Agent command surface v5 research controls', () => {
  it('adds the exact domain mutations without changing historical inventories', () => {
    const v4 = selectProfileAgentCommandSurface(4)
    const v5 = selectProfileAgentCommandSurface(5)

    expect(v4).toBeDefined()
    expect(v5?.names).toEqual([
      ...v4!.names,
      'ask.set-model',
      'card.set-identity',
      'cards.arrange',
      'cards.reorder-layer',
      'group.membership.set',
      'output.choose-version',
      'output.set-accepted',
      'mod-instance.create',
      'mod-instance.configure',
      'mod-instance.delete',
      'idea.activate',
    ])
    expect(v5?.capability.descriptors.slice(-11)).toEqual([
      expect.objectContaining({ name: 'ask.set-model', version: 5, effects: ['card'] }),
      expect.objectContaining({
        name: 'card.set-identity',
        version: 5,
        supportedCardKinds: ['note', 'askAi', 'result', 'mod', 'group', 'conversation'],
        effects: ['card', 'mod-instance'],
        conditionalEffects: true,
      }),
      expect.objectContaining({ name: 'cards.arrange', version: 5, effects: ['card'] }),
      expect.objectContaining({ name: 'cards.reorder-layer', version: 5, effects: ['card'] }),
      expect.objectContaining({ name: 'group.membership.set', version: 5, effects: ['card'] }),
      expect.objectContaining({ name: 'output.choose-version', version: 5, effects: ['output'] }),
      expect.objectContaining({ name: 'output.set-accepted', version: 5, effects: ['output-version'] }),
      expect.objectContaining({
        name: 'mod-instance.create',
        version: 5,
        effects: ['card', 'block', 'mod-instance'],
      }),
      expect.objectContaining({
        name: 'mod-instance.configure',
        version: 5,
        effects: ['card', 'mod-instance'],
      }),
      expect.objectContaining({
        name: 'mod-instance.delete',
        version: 5,
        effects: ['card', 'block', 'connection', 'mod-instance'],
      }),
      expect.objectContaining({ name: 'idea.activate', version: 5, effects: ['idea'] }),
    ])
  })

  it('normalizes v5 research controls while denying them on v4', () => {
    const candidate = request([
      command('ask.set-model', {
        ideaId: IDEA_ID,
        card: { cardId: 'ask' },
        model: ' openai/gpt-5.6-luna ',
      }),
      command('card.set-identity', {
        ideaId: IDEA_ID,
        card: { cardId: 'note' },
        identity: { preset: 'amber', fill: 'soft' },
      }),
      command('cards.arrange', {
        ideaId: IDEA_ID,
        frames: [{
          card: { cardId: 'note' },
          position: { x: 40, y: 60 },
          size: { width: 300, height: 200 },
        }],
      }),
      command('cards.reorder-layer', {
        ideaId: IDEA_ID,
        cards: [{ cardId: 'note' }],
        direction: 'front',
      }),
      command('output.choose-version', {
        ideaId: IDEA_ID,
        outputId: 'output',
        versionId: 'version-1',
      }),
      command('output.set-accepted', {
        ideaId: IDEA_ID,
        outputId: 'output',
        versionId: 'version-2',
        accepted: true,
      }),
    ])

    expect(validateProfileAgentCommandRequest(candidate, candidate.commands.map((item) => item.name) as never, 4))
      .toMatchObject({ ok: false, code: 'capability-denied' })
    expect(validateProfileAgentCommandRequest(candidate, candidate.commands.map((item) => item.name) as never, 5))
      .toMatchObject({
        ok: true,
        value: {
          commands: [
            expect.objectContaining({ payload: expect.objectContaining({ model: 'openai/gpt-5.6-luna' }) }),
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything(),
          ],
        },
      })
  })

  it('atomically configures, styles, arranges, layers, chooses, and judges research output', () => {
    const fixture = createCompleteProfileFixture()
    const board: SavedBoard = {
      version: 1,
      cards: [
        {
          id: 'note', kind: 'note', position: { x: 0, y: 0 }, zIndex: 0,
          blocks: [{ id: 'block-v5-note', text: 'Evidence' }],
        },
        {
          id: 'ask', kind: 'askAi', position: { x: 400, y: 0 }, zIndex: 1,
          blocks: [{ id: 'block-v5-ask', text: 'Question' }],
        },
        {
          id: 'result', kind: 'result', position: { x: 800, y: 0 },
          blocks: [{ id: 'block-v5-result', text: '' }],
        },
      ],
      connections: [],
      outputs: [{
        id: 'output',
        resultCardId: 'result',
        chosenVersionId: 'version-2',
        versions: [
          {
            id: 'version-1', number: 1, text: 'First',
            createdAt: '2026-08-05T00:00:00.000Z', fromRunId: 'run-1',
          },
          {
            id: 'version-2', number: 2, text: 'Second',
            createdAt: '2026-08-05T00:01:00.000Z', fromRunId: 'run-2',
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
    fixture.snapshot.boards[IDEA_ID] = board
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const candidate = request([
      command('ask.set-model', {
        ideaId: IDEA_ID, card: { cardId: 'ask' }, model: 'openai/gpt-5.6-luna',
      }),
      command('card.set-identity', {
        ideaId: IDEA_ID,
        card: { cardId: 'note' },
        identity: { preset: 'amber', fill: 'soft' },
      }),
      command('cards.arrange', {
        ideaId: IDEA_ID,
        frames: [
          { card: { cardId: 'note' }, position: { x: 40, y: 60 }, size: { width: 300, height: 200 } },
          { card: { cardId: 'ask' }, position: { x: 480, y: 60 } },
        ],
      }),
      command('cards.reorder-layer', {
        ideaId: IDEA_ID, cards: [{ cardId: 'note' }], direction: 'front',
      }),
      command('output.choose-version', {
        ideaId: IDEA_ID, outputId: 'output', versionId: 'version-1',
      }),
      command('output.set-accepted', {
        ideaId: IDEA_ID, outputId: 'output', versionId: 'version-2', accepted: true,
      }),
    ], document.head.revision)

    const planned = planProfileAgentCommandBatch(document, candidate, trusted(), 5)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.value.commandResults).toEqual([
      { commandId: 'command-0', name: 'ask.set-model', cardId: 'ask', model: 'openai/gpt-5.6-luna' },
      {
        commandId: 'command-1', name: 'card.set-identity', cardId: 'note',
        identity: { preset: 'amber', fill: 'soft' },
      },
      { commandId: 'command-2', name: 'cards.arrange', cardIds: ['note', 'ask'] },
      { commandId: 'command-3', name: 'cards.reorder-layer', cardIds: ['note'], direction: 'front' },
      { commandId: 'command-4', name: 'output.choose-version', outputId: 'output', versionId: 'version-1' },
      {
        commandId: 'command-5', name: 'output.set-accepted', outputId: 'output',
        versionId: 'version-2', accepted: true,
      },
    ])
    expect(planned.value.intentEventDrafts).toEqual([
      {
        ideaId: IDEA_ID,
        event: {
          type: 'card.content.edited',
          cardId: 'ask',
          data: { field: 'model' },
        },
      },
      {
        ideaId: IDEA_ID,
        event: {
          type: 'card.content.edited',
          cardId: 'note',
          data: { field: 'identity' },
        },
      },
      {
        ideaId: IDEA_ID,
        event: {
          type: 'cards.arranged',
          cardId: 'note',
          data: {
            changes: [
              {
                cardId: 'note',
                before: { position: { x: 0, y: 0 } },
                after: {
                  position: { x: 40, y: 60 },
                  size: { width: 300, height: 200 },
                },
              },
              {
                cardId: 'ask',
                before: { position: { x: 400, y: 0 } },
                after: { position: { x: 480, y: 60 } },
              },
            ],
          },
        },
      },
      {
        ideaId: IDEA_ID,
        event: {
          type: 'card.layer.changed',
          cardId: 'note',
          data: {
            direction: 'front',
            changes: [
              { cardId: 'note', from: 0, to: 2 },
              { cardId: 'ask', from: 1, to: 0 },
              { cardId: 'result', to: 1 },
            ],
          },
        },
      },
      {
        ideaId: IDEA_ID,
        event: {
          type: 'version.chosen',
          versionId: 'version-1',
          data: {
            outputId: 'output',
            previousVersionId: 'version-2',
            nextVersionId: 'version-1',
          },
        },
      },
      {
        ideaId: IDEA_ID,
        event: {
          type: 'version.acceptance.changed',
          versionId: 'version-2',
          data: { outputId: 'output', from: false, to: true },
        },
      },
    ])

    const nextDocument = {
      ...document,
      head: { ...document.head, revision: planned.value.proposedRevision },
      records: applyRecordChanges(document.records, planned.value.recordChanges),
    }
    const next = hydrateProfileLogicalDocument(nextDocument, fixture.hydrateAsset)
    const note = next.boards[IDEA_ID]!.cards.find((card) => card.id === 'note')!
    const ask = next.boards[IDEA_ID]!.cards.find((card) => card.id === 'ask')!
    const output = next.boards[IDEA_ID]!.outputs[0]!
    expect(note).toMatchObject({
      position: { x: 40, y: 60 },
      size: { width: 300, height: 200 },
      headerColor: '#eca23b',
      headerFill: 'half',
    })
    expect(note.zIndex).toBeGreaterThan(ask.zIndex ?? 0)
    expect(ask).toMatchObject({ position: { x: 480, y: 60 }, model: 'openai/gpt-5.6-luna' })
    expect(output.chosenVersionId).toBe('version-1')
    expect(output.versions.find((version) => version.id === 'version-2')?.accepted).toBe(true)
  })

  it('coalesces the maximum arrangement into one bounded Intent event', () => {
    const fixture = createCompleteProfileFixture()
    const cards = Array.from({ length: 100 }, (_, index) => ({
      id: `arrange-card-${index}`,
      kind: 'note' as const,
      blocks: [{ id: `arrange-block-${index}`, text: `Evidence ${index}` }],
      position: { x: index * 10, y: 0 },
    }))
    fixture.snapshot.boards[IDEA_ID] = {
      version: 1,
      cards,
      connections: [],
      outputs: [],
      runs: [],
      updatedAt: '2026-08-05T00:02:00.000Z',
    }
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const candidate = request([
      command('cards.arrange', {
        ideaId: IDEA_ID,
        frames: cards.map((card, index) => ({
          card: { cardId: card.id },
          position: { x: index * 10, y: 100 },
          size: { width: 280, height: 190 },
        })),
      }),
    ], document.head.revision)

    const planned = planProfileAgentCommandBatch(document, candidate, trusted(), 5)

    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.value.intentEventDrafts).toHaveLength(1)
    expect(planned.value.intentEventDrafts[0]).toMatchObject({
      event: {
        type: 'cards.arranged',
        data: { changes: expect.arrayContaining([expect.objectContaining({ cardId: 'arrange-card-99' })]) },
      },
    })
    expect(planned.value.intentEventDrafts.length)
      .toBeLessThanOrEqual(PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxIntentEventIds)
  })

  it.each([
    {
      name: 'cards.arrange',
      payload: {
        ideaId: IDEA_ID,
        frames: [{ card: { cardId: 'note' }, position: { x: 40, y: 60 } }],
      },
    },
    {
      name: 'cards.reorder-layer',
      payload: {
        ideaId: IDEA_ID,
        cards: [{ cardId: 'note' }],
        direction: 'front',
      },
    },
    {
      name: 'group.membership.set',
      payload: {
        ideaId: IDEA_ID,
        card: { cardId: 'note' },
        group: null,
      },
    },
  ])('rejects unchanged $name in both preview and apply planning', ({ name, payload }) => {
    const fixture = createCompleteProfileFixture()
    fixture.snapshot.boards[IDEA_ID] = {
      version: 1,
      cards: [{
        id: 'note', kind: 'note', position: { x: 40, y: 60 }, zIndex: 0,
        blocks: [{ id: 'block-v5-note', text: 'Evidence' }],
      }],
      connections: [],
      outputs: [],
      runs: [],
      updatedAt: '2026-08-05T00:02:00.000Z',
    }
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    for (const dryRun of [true, false]) {
      const candidate = {
        ...request([command(name, payload)], document.head.revision),
        dryRun,
      }

      expect(planProfileAgentCommandBatch(document, candidate, trusted(), 5))
        .toMatchObject({ ok: false, code: 'invalid' })
    }
  })

  it.each([
    {
      name: 'ask.set-model',
      payload: {
        ideaId: IDEA_ID,
        card: { cardId: 'ask' },
        model: 'default/model',
      },
    },
    {
      name: 'card.set-identity',
      payload: {
        ideaId: IDEA_ID,
        card: { cardId: 'note' },
        identity: { preset: 'amber', fill: 'soft' },
      },
    },
    {
      name: 'card.set-identity',
      payload: {
        ideaId: IDEA_ID,
        card: { cardId: 'ask' },
        identity: null,
      },
    },
  ])('rejects unchanged $name content attribution in preview and apply', ({ name, payload }) => {
    const fixture = createCompleteProfileFixture()
    fixture.snapshot.boards[IDEA_ID] = {
      version: 1,
      cards: [
        {
          id: 'note', kind: 'note', position: { x: 40, y: 60 },
          headerColor: '#eca23b', headerFill: 'half',
          blocks: [{ id: 'block-v5-note', text: 'Evidence' }],
        },
        {
          id: 'ask', kind: 'askAi', position: { x: 400, y: 60 },
          model: 'default/model',
          blocks: [{ id: 'block-v5-ask', text: 'Question' }],
        },
      ],
      connections: [],
      outputs: [],
      runs: [],
      updatedAt: '2026-08-05T00:02:00.000Z',
      aiSettings: {
        model: 'default/model',
        models: ['default/model'],
        reasoningEffort: 'medium',
      },
    }
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    for (const dryRun of [true, false]) {
      const candidate = {
        ...request([command(name, payload)], document.head.revision),
        dryRun,
      }
      expect(planProfileAgentCommandBatch(document, candidate, trusted(), 5))
        .toMatchObject({ ok: false, code: 'invalid' })
    }
  })

  it('plans one Profile-scoped Idea activation without touching either Board', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const candidate = request([
      command('idea.activate', { ideaId: IDEA_ID }),
    ], document.head.revision)

    const planned = planProfileAgentCommandBatch(document, candidate, trusted(), 5)

    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.value).toMatchObject({
      scope: { kind: 'profile' },
      headTransition: {
        kind: 'active-idea',
        commandId: 'command-0',
        previousActiveIdeaId: 'idea-main',
        activeIdeaId: IDEA_ID,
      },
      commandResults: [{
        commandId: 'command-0',
        name: 'idea.activate',
        previousActiveIdeaId: 'idea-main',
        activeIdeaId: IDEA_ID,
      }],
      intentEventDrafts: [],
      profileAgentEventDrafts: [{
        version: 1,
        type: 'idea.activated',
        previousActiveIdeaId: 'idea-main',
        activeIdeaId: IDEA_ID,
      }],
    })
    expect(planned.value.recordChanges).toEqual([
      expect.objectContaining({
        operation: 'replace',
        before: expect.objectContaining({ recordId: IDEA_ID, kind: 'idea' }),
        after: expect.objectContaining({
          recordId: IDEA_ID,
          kind: 'idea',
          payload: expect.objectContaining({
            id: IDEA_ID,
            updatedAt: '2026-01-02T00:00:00.000Z',
            lastOpenedAt: '2026-08-05T00:03:00.000Z',
          }),
        }),
      }),
    ])
  })
})

function command(name: string, payload: Record<string, unknown>, index?: number) {
  return { version: 1 as const, id: `command-${index ?? commandOrdinal++}`, name, payload }
}

let commandOrdinal = 0

function request(commands: readonly ReturnType<typeof command>[], expectedRevision = 7) {
  commandOrdinal = 0
  return {
    version: 1 as const,
    schemaVersion: 1 as const,
    expectedRevision,
    idempotencyKey: 'surface-v5-research-controls',
    dryRun: false,
    commands,
  }
}

function trusted(): ProfileAgentCommandTrustedContext {
  return {
    profileId: 'profile-synthetic',
    actor: {
      id: 'surface-v5-agent', kind: 'agent', transport: 'test',
      client: 'surface-v5-client', sessionId: 'surface-v5-session',
    },
    clientTxnId: 'surface-v5-transaction',
    commitId: 'surface-v5-commit',
    committedAt: '2026-08-05T00:03:00.000Z',
    deriveId: (scope) => `${scope.purpose}:${scope.commandId}`,
    contentSha256: (text) => createHash('sha256').update(text).digest('hex'),
  }
}

function applyRecordChanges(
  records: ReturnType<typeof projectProfileSnapshot>['records'],
  changes: readonly import('./profileAgentCommandPlan').ProfileAgentRecordChange[],
) {
  const next = new Map(records.map((record) => [record.recordId, record]))
  for (const change of changes) {
    if (change.operation === 'delete') next.delete(change.before.recordId)
    else next.set(change.after.recordId, change.after)
  }
  return records
    .flatMap((record) => next.has(record.recordId) ? [next.get(record.recordId)!] : [])
    .concat([...next.values()].filter((record) => !records.some((existing) => existing.recordId === record.recordId)))
}
