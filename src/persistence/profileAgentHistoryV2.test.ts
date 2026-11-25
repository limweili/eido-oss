import { describe, expect, it } from 'vitest'
import { createSeedMod } from '../mods'
import {
  INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_CAPABILITY,
  INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES,
  INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY,
  INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
  selectProfileAgentCommandSurface,
} from './profileAgentCommandManifest'
import { decodeProfileAgentEventRecord } from './profileAgentEvent'
import {
  isProfileAgentCommandBatchReceipt,
  isProfileAgentCommandBatchReceiptForSurface,
  summarizeProfileAgentCommandEffects,
  validateInstalledProfileAgentCommandRequest,
  validateProfileAgentCommandRequestForSurface,
} from './profileAgentCommandInstallation'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import {
  planProfileAgentCommandBatch,
  type ProfileAgentCommandRequest,
  type ProfileAgentCommandTrustedContext,
} from './profileAgentCommandPlan'
import { projectProfileSnapshot } from './profileLogicalProjection'

describe('Profile Agent durable command surfaces (#525)', () => {
  it('keeps persisted v1-v4 descriptors exact while installing the immutable v5 matrix', () => {
    const v1 = selectProfileAgentCommandSurface(1)
    const v2 = selectProfileAgentCommandSurface(2)
    const v3 = selectProfileAgentCommandSurface(3)
    const v4 = selectProfileAgentCommandSurface(4)
    const v5 = selectProfileAgentCommandSurface(5)

    expect(v1?.names).toEqual([
      'card.create',
      'card.update-content',
      'card.delete',
      'connection.create',
      'connection.update-meaning',
      'connection.delete',
    ])
    expect(v2?.names).toEqual([
      ...v1!.names,
      'mod-template.create',
      'mod-template.update',
      'mod-template.delete',
      'mod-instance.stamp',
    ])
    expect(v3?.names).toEqual(v2?.names)
    expect(v4?.names).toEqual([...v3!.names, 'idea.create'])
    expect(v5?.names).toEqual(INSTALLED_PROFILE_AGENT_COMMAND_NAMES)
    expect(v1?.capability.version).toBe(1)
    expect(v2?.capability.version).toBe(2)
    expect(v3?.capability.version).toBe(3)
    expect(v4?.capability.version).toBe(4)
    expect(v5?.capability.version).toBe(5)
    const legacyBoardDescriptors = [
      {
        name: 'card.create', version: 1, payloadVersion: 1,
        effects: ['card', 'block'], conditionalEffects: false,
      },
      {
        name: 'card.update-content', version: 1, payloadVersion: 1,
        effects: ['block'], conditionalEffects: false,
      },
      {
        name: 'card.delete', version: 1, payloadVersion: 1,
        effects: [
          'card', 'block', 'connection', 'output', 'output-version',
          'transcript-message', 'follow-up-message', 'logical-asset',
          'highlight', 'mod-instance',
        ],
        conditionalEffects: true,
      },
      {
        name: 'connection.create', version: 1, payloadVersion: 1,
        effects: ['card', 'block', 'connection'], conditionalEffects: true,
      },
      {
        name: 'connection.update-meaning', version: 1, payloadVersion: 1,
        effects: ['connection'], conditionalEffects: false,
      },
      {
        name: 'connection.delete', version: 1, payloadVersion: 1,
        effects: ['connection'], conditionalEffects: false,
      },
    ] as const
    const legacyModDescriptors = [
      {
        name: 'mod-template.create',
        version: 2,
        payloadVersion: 1,
        effects: ['mod-template'],
        conditionalEffects: false,
      },
      {
        name: 'mod-template.update',
        version: 2,
        payloadVersion: 1,
        effects: ['mod-template'],
        conditionalEffects: false,
      },
      {
        name: 'mod-template.delete',
        version: 2,
        payloadVersion: 1,
        effects: ['mod-template'],
        conditionalEffects: false,
      },
      {
        name: 'mod-instance.stamp',
        version: 2,
        payloadVersion: 1,
        effects: ['card', 'block', 'mod-instance'],
        conditionalEffects: false,
      },
    ] as const
    expect(v1?.capability.descriptors).toEqual(legacyBoardDescriptors)
    expect(v2?.capability.descriptors).toEqual([
      ...legacyBoardDescriptors.map((descriptor) => ({ ...descriptor, version: 2 })),
      ...legacyModDescriptors,
    ])
    expect(Object.isFrozen(v2)).toBe(true)
    expect(Object.isFrozen(v2?.names)).toBe(true)
    expect(Object.isFrozen(v2?.capability.descriptors)).toBe(true)
    expect(v3?.capability.descriptors.slice(0, 4)).toEqual([
      {
        name: 'card.create', version: 3, payloadVersion: 1,
        supportedCardKinds: ['note', 'askAi', 'title', 'group', 'conversation'],
        effects: ['card', 'block'], conditionalEffects: false,
      },
      {
        name: 'card.update-content', version: 3, payloadVersion: 1,
        supportedCardKinds: ['note', 'askAi', 'title', 'group', 'conversation'],
        effects: ['card', 'block'], conditionalEffects: true,
      },
      {
        name: 'card.delete', version: 3, payloadVersion: 1,
        supportedCardKinds: ['note', 'askAi', 'title', 'group', 'conversation', 'result'],
        effects: [
          'card', 'block', 'connection', 'output', 'output-version',
          'transcript-message', 'follow-up-message', 'logical-asset',
          'highlight', 'mod-instance',
        ],
        conditionalEffects: true,
      },
      {
        name: 'connection.create', version: 3, payloadVersion: 1,
        supportedCardKinds: ['note', 'askAi', 'result', 'mod', 'group', 'conversation'],
        effects: ['card', 'block', 'connection'], conditionalEffects: true,
      },
    ])
    expect(v4?.capability.descriptors[(v4.capability.descriptors.length ?? 0) - 1]).toEqual({
      name: 'idea.create',
      version: 4,
      payloadVersion: 1,
      effects: ['idea', 'board'],
      conditionalEffects: false,
    })

    expect(INSTALLED_PROFILE_AGENT_COMMAND_NAMES).toBe(v5?.names)
    expect(INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY).toBe(v5?.capability)
    expect(INSTALLED_PROFILE_AGENT_COMMAND_NAMES).toHaveLength(22)
    expect(INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES).toHaveLength(15)
    expect(INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES)
      .not.toBe(INSTALLED_PROFILE_AGENT_COMMAND_NAMES)
    expect(INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES.every((name) => (
      INSTALLED_PROFILE_AGENT_COMMAND_NAMES.includes(name)
    ))).toBe(true)
    expect(INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_CAPABILITY.descriptors.map(({ name }) => name))
      .toEqual(INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES)
  })

  it('decodes only the exact flat Profile-owned append-only event contract', () => {
    const record = {
      kind: 'profile-agent-event',
      recordId: 'profile-agent-event-1',
      ownerId: 'profile-1',
      parentId: 'profile-1',
      recordVersion: 1,
      payload: {
        version: 1,
        id: 'profile-agent-event-1',
        seq: 7,
        at: '2026-07-20T01:02:03.000Z',
        profileId: 'profile-1',
        commitId: 'commit-8',
        actorId: 'agent-1',
        clientTxnId: 'client-1',
        type: 'mod-template.updated',
        templateId: 'template-1',
        previousTemplateVersion: 2,
        newTemplateVersion: 3,
        claimedTransitionEvidence: {
          version: 1,
          count: 1,
          sha256: 'a'.repeat(64),
        },
      },
    }

    const decoded = decodeProfileAgentEventRecord(record)
    expect(decoded).toMatchObject({ ok: true, value: record })
    if (!decoded.ok) return
    expect(Object.isFrozen(decoded.value)).toBe(true)
    expect(Object.isFrozen(decoded.value.payload)).toBe(true)

    expect(decodeProfileAgentEventRecord({
      ...record,
      payload: {
        ...record.payload,
        data: {
          previousTemplateVersion: 2,
          newTemplateVersion: 3,
        },
      },
    })).toMatchObject({ ok: false, code: 'invalid' })
    expect(decodeProfileAgentEventRecord({
      ...record,
      parentId: 'another-profile',
    })).toMatchObject({ ok: false, code: 'invalid' })
    expect(decodeProfileAgentEventRecord({
      ...record,
      payload: { ...record.payload, seq: 0 },
    })).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('keeps one ordered Profile event per template command when every record transition folds', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const templateId = 'template-folded-in-one-batch'
    const request: ProfileAgentCommandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: document.head.revision,
      idempotencyKey: 'folded-template-lifecycle',
      dryRun: false,
      commands: [
        {
          version: 1,
          id: 'create-folded-template',
          name: 'mod-template.create',
          payload: {
            templateId,
            mod: createSeedMod('switch', {
              title: 'FIRST',
              createId: (role, ordinal) => `folded-${role}-${ordinal}`,
            }),
          },
        },
        {
          version: 1,
          id: 'delete-folded-template',
          name: 'mod-template.delete',
          payload: { templateId, expectedTemplateVersion: 1 },
        },
      ],
    }

    const result = planProfileAgentCommandBatch(document, request, trustedContext())

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.value.recordChanges).toEqual([])
    expect(result.value.intentEventDrafts).toEqual([])
    expect(result.value.profileAgentEventDrafts).toEqual([
      {
        version: 1,
        type: 'mod-template.created',
        templateId,
        templateVersion: 1,
      },
      {
        version: 1,
        type: 'mod-template.deleted',
        templateId,
        deletedTemplateVersion: 1,
      },
    ])
    expect(Object.isFrozen(result.value.profileAgentEventDrafts)).toBe(true)
    expect(result.value.profileAgentEventDrafts.every(Object.isFrozen)).toBe(true)
  })

  it('validates requests, results, effects, and receipts against their persisted surface', () => {
    const modRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'surface-specific-request',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'create-template',
        name: 'mod-template.create',
        payload: {
          templateId: 'template-1',
          mod: createSeedMod('switch', {
            title: 'TEMPLATE',
            createId: (role, ordinal) => `surface-${role}-${ordinal}`,
          }),
        },
      }],
    }
    expect(validateInstalledProfileAgentCommandRequest(modRequest))
      .toMatchObject({ ok: true })
    expect(validateProfileAgentCommandRequestForSurface(modRequest, 1))
      .toMatchObject({ ok: false, code: 'capability-denied' })
    expect(validateProfileAgentCommandRequestForSurface(modRequest, 2))
      .toMatchObject({ ok: true })
    expect(validateProfileAgentCommandRequestForSurface(modRequest, 3))
      .toMatchObject({ ok: true })
    expect(validateProfileAgentCommandRequestForSurface(modRequest, 4))
      .toMatchObject({ ok: true })

    const ideaRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 7,
      idempotencyKey: 'surface-specific-idea',
      dryRun: true,
      commands: [{
        version: 1,
        id: 'create-idea',
        name: 'idea.create',
        payload: { name: 'Chicken Research_1' },
      }],
    }
    expect(validateInstalledProfileAgentCommandRequest(ideaRequest))
      .toMatchObject({ ok: true })
    for (const version of [1, 2, 3] as const) {
      expect(validateProfileAgentCommandRequestForSurface(ideaRequest, version))
        .toMatchObject({ ok: false, code: 'capability-denied' })
    }
    expect(validateProfileAgentCommandRequestForSurface(ideaRequest, 4))
      .toMatchObject({ ok: true })

    const v1ShapeWithModResult = {
      kind: 'agent-command-batch',
      version: 1,
      previousRevision: 7,
      revision: 8,
      proposedRevision: 8,
      commitId: 'commit-8',
      commandResults: [{
        commandId: 'create-template',
        name: 'mod-template.create',
        templateId: 'template-1',
        templateVersion: 1,
      }],
      effects: { inserted: 1, updated: 0, deleted: 0, intentEvents: 0 },
      intentEventIds: [],
      dryRun: false,
      replayed: false,
    }
    expect(isProfileAgentCommandBatchReceipt(v1ShapeWithModResult)).toBe(false)
    expect(isProfileAgentCommandBatchReceiptForSurface(v1ShapeWithModResult, 1)).toBe(false)

    const v2 = {
      ...v1ShapeWithModResult,
      version: 2,
      effects: {
        inserted: 1,
        updated: 0,
        deleted: 0,
        intentEvents: 0,
        profileAgentEvents: 1,
      },
      profileAgentEventIds: ['profile-agent-event-1'],
    }
    expect(isProfileAgentCommandBatchReceiptForSurface(v2, 2)).toBe(true)
    expect(isProfileAgentCommandBatchReceiptForSurface(v2, 1)).toBe(false)
    expect(isProfileAgentCommandBatchReceiptForSurface({
      ...v2,
      effects: { ...v2.effects, profileAgentEvents: 1.5 },
    }, 2)).toBe(false)
    expect(isProfileAgentCommandBatchReceiptForSurface({
      ...v2,
      commandResults: [{
        commandId: 'create-template',
        name: 'mod-template.create',
        templateId: 'template-1',
        templateVersion: 0,
      }],
    }, 2)).toBe(false)
    expect(isProfileAgentCommandBatchReceiptForSurface({
      ...v2,
      commandResults: [{
        commandId: 'update-template',
        name: 'mod-template.update',
        templateId: 'template-1',
        previousTemplateVersion: 1,
        newTemplateVersion: 3,
      }],
    }, 2)).toBe(false)
    expect(isProfileAgentCommandBatchReceipt(v2)).toBe(false)
    const v3 = { ...v2, version: 3 }
    expect(isProfileAgentCommandBatchReceiptForSurface(v3, 3)).toBe(true)
    expect(isProfileAgentCommandBatchReceipt(v3)).toBe(false)
    const v4 = { ...v3, version: 4 }
    expect(isProfileAgentCommandBatchReceiptForSurface(v4, 4)).toBe(true)
    expect(isProfileAgentCommandBatchReceipt(v4)).toBe(false)
    expect(isProfileAgentCommandBatchReceipt({ ...v4, version: 5 })).toBe(true)

    expect(summarizeProfileAgentCommandEffects([], 0)).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
      intentEvents: 0,
      profileAgentEvents: 0,
    })
    expect(summarizeProfileAgentCommandEffects([], 0, 3, 2)).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
      intentEvents: 0,
      profileAgentEvents: 3,
    })
  })
})

function trustedContext(): ProfileAgentCommandTrustedContext {
  return {
    profileId: 'profile-synthetic',
    actor: {
      id: 'agent-history-test', kind: 'agent', transport: 'test',
      client: 'agent-history-client', sessionId: 'agent-history-session',
    },
    clientTxnId: 'client-history-test',
    commitId: 'commit-history-test',
    committedAt: '2026-07-20T02:00:00.000Z',
    stampedAt: '2026-07-20T02:00:00.000Z',
    contentSha256: () => 'a'.repeat(64),
    deriveId: ({ purpose, commandId }) => `${purpose}:${commandId}`,
  }
}
