import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSeedMod } from '../src/mods'
import { PROFILE_GUI_CAPTURE_MAX_BYTES } from '../src/persistence/profileGuiSaveScheduler'
import {
  assertProfileUtilityChildMessage,
  assertProfileUtilityParentMessage,
  createProfileUtilityCloseAcknowledgement,
  createProfileUtilityInitialize,
  createProfileUtilityReady,
  createProfileUtilityRequest,
  PROFILE_UTILITY_OPERATIONS,
  PROFILE_UTILITY_ENVELOPE_MAX_BYTES,
  PROFILE_UTILITY_MESSAGE_MAX_BYTES,
  PROFILE_UTILITY_PROTOCOL_VERSION,
  PROFILE_UTILITY_AGENT_COMMAND_REQUEST_MAX_BYTES,
  PROFILE_UTILITY_AGENT_COMMAND_RESPONSE_MAX_BYTES,
  PROFILE_UTILITY_QUERY_REQUEST_MAX_BYTES,
  PROFILE_UTILITY_QUERY_RESPONSE_MAX_BYTES,
  PROFILE_UTILITY_SPATIAL_REQUEST_MAX_BYTES,
  PROFILE_UTILITY_SPATIAL_RESPONSE_MAX_BYTES,
} from './profileUtilityProtocol'
import {
  PROFILE_AGENT_COMMAND_LIMITS,
  PROFILE_AGENT_COMMAND_RESULT_LIMITS,
} from '../src/persistence/profileAgentCommandManifest'
import { PROFILE_AGENT_CHANGE_TRAIL_LIMITS } from '../src/persistence/profileAgentChangeTrail'
import {
  PROFILE_CONTRACT_VERSIONS,
  PROFILE_QUERY_LIMITS,
  profileServiceFailure,
} from '../src/persistence/profileServiceContract'

const syntheticMod = createSeedMod('slider', {
  createId: (role, ordinal) => `synthetic-slider-${role}-${ordinal}`,
})

describe('Profile utility-process protocol', () => {
  it('correlates the parent acknowledgement that permits a closed utility to exit', () => {
    const acknowledgement = createProfileUtilityCloseAcknowledgement('close-request:1')

    expect(assertProfileUtilityParentMessage(acknowledgement)).toEqual(acknowledgement)
    expect(() => assertProfileUtilityParentMessage({
      ...acknowledgement,
      unexpected: true,
    })).toThrow('Profile utility parent message was denied')
  })

  it('discriminates seeded active ownership from existing-only headless ownership', () => {
    const databasePath = path.resolve('synthetic-profile', 'profiles', 'default', 'eido-profile.sqlite')
    const portableTempRoot = path.resolve('synthetic-profile', 'portable-operations')
    const active = createProfileUtilityInitialize({
      route: 'active-owner',
      databasePath,
      portableTempRoot,
    })
    const headless = createProfileUtilityInitialize({
      route: 'exclusive-headless-owner',
      databasePath,
      transport: 'mcp',
      actor: { client: 'eido-test', sessionId: 'protocol-headless-session' },
    })

    expect(assertProfileUtilityParentMessage(active)).toEqual(active)
    expect(assertProfileUtilityParentMessage(headless)).toEqual(headless)
    expect(headless.payload).toMatchObject({ transport: 'mcp' })
    expect(createProfileUtilityReady('exclusive-headless-owner', 'ready', 9)).toEqual({
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'exclusive-headless-owner',
      state: 'ready',
      revision: 9,
    })
    expect(() => assertProfileUtilityParentMessage({
      ...headless,
      payload: {
        ...headless.payload,
        portableTempRoot,
      },
    })).toThrow('Profile utility parent message was denied')
    expect(() => assertProfileUtilityParentMessage({
      ...active,
      payload: {
        route: 'active-owner',
        databasePath: active.payload.databasePath,
      },
    })).toThrow('Profile utility parent message was denied')
    expect(() => assertProfileUtilityParentMessage({
      ...headless,
      payload: {
        route: 'exclusive-headless-owner',
        databasePath,
        actor: { client: 'eido-test', sessionId: 'protocol-headless-session' },
      },
    })).toThrow('Profile utility parent message was denied')
    expect(() => assertProfileUtilityParentMessage({
      ...headless,
      payload: {
        route: 'exclusive-headless-owner',
        databasePath,
        transport: 'renderer',
        actor: { client: 'eido-test', sessionId: 'protocol-headless-session' },
      },
    })).toThrow('Profile utility parent message was denied')
  })

  it('reserves fixed utility-envelope overhead above the logical payload bound', () => {
    expect(PROFILE_UTILITY_MESSAGE_MAX_BYTES).toBe(
      PROFILE_GUI_CAPTURE_MAX_BYTES + PROFILE_UTILITY_ENVELOPE_MAX_BYTES,
    )
    expect(PROFILE_UTILITY_QUERY_REQUEST_MAX_BYTES).toBeGreaterThan(
      PROFILE_QUERY_LIMITS.maxCursorBytes + PROFILE_UTILITY_ENVELOPE_MAX_BYTES,
    )
    expect(PROFILE_UTILITY_QUERY_RESPONSE_MAX_BYTES).toBeGreaterThan(
      PROFILE_QUERY_LIMITS.maxBytes
      + PROFILE_QUERY_LIMITS.maxCursorBytes
      + PROFILE_UTILITY_ENVELOPE_MAX_BYTES,
    )
    expect(PROFILE_UTILITY_QUERY_REQUEST_MAX_BYTES).toBeLessThan(
      PROFILE_UTILITY_MESSAGE_MAX_BYTES,
    )
    expect(PROFILE_UTILITY_QUERY_RESPONSE_MAX_BYTES).toBeLessThan(
      PROFILE_UTILITY_MESSAGE_MAX_BYTES,
    )
    expect(PROFILE_UTILITY_AGENT_COMMAND_REQUEST_MAX_BYTES).toBe(
      PROFILE_AGENT_COMMAND_LIMITS.maxRequestBytes + PROFILE_UTILITY_ENVELOPE_MAX_BYTES,
    )
    expect(PROFILE_UTILITY_AGENT_COMMAND_RESPONSE_MAX_BYTES).toBe(
      PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxReceiptBytes + PROFILE_UTILITY_ENVELOPE_MAX_BYTES,
    )
    expect(PROFILE_UTILITY_SPATIAL_REQUEST_MAX_BYTES).toBeLessThan(
      PROFILE_UTILITY_MESSAGE_MAX_BYTES,
    )
    expect(PROFILE_UTILITY_SPATIAL_RESPONSE_MAX_BYTES).toBeLessThan(
      PROFILE_UTILITY_MESSAGE_MAX_BYTES,
    )
  })

  it('admits only the bounded installed Agent command request and typed receipt', () => {
    const commandRequest = {
      version: 1,
      schemaVersion: 1,
      expectedRevision: 4,
      idempotencyKey: 'batch-utility-1',
      dryRun: false,
      commands: [{
        version: 1,
        id: 'create-note',
        name: 'card.create',
        payload: {
          ideaId: 'idea-main',
          kind: 'note',
          position: { x: 10, y: 20 },
          body: 'Native command',
        },
      }],
    } as const
    const request = createProfileUtilityRequest(
      'agent-command-1',
      'apply-agent-command-batch',
      { request: commandRequest },
    )

    expect(assertProfileUtilityParentMessage(request)).toEqual(request)
    const liveRequest = createProfileUtilityRequest(
      'agent-command-live-1',
      'apply-agent-command-batch',
      {
        request: commandRequest,
        transport: 'cli',
        actor: { client: 'codex', sessionId: 'live-session-1' },
      },
    )
    expect(assertProfileUtilityParentMessage(liveRequest)).toEqual(liveRequest)
    expect(() => assertProfileUtilityParentMessage({
      ...request,
      payload: { request: commandRequest, transport: 'mcp' },
    })).toThrow('Profile utility parent message was denied')
    expect(() => assertProfileUtilityParentMessage({
      ...liveRequest,
      payload: { request: commandRequest, transport: 'cli' },
    })).toThrow('Profile utility parent message was denied')
    expect(() => assertProfileUtilityParentMessage({
      ...liveRequest,
      payload: {
        request: commandRequest,
        transport: 'mcp',
        actor: { client: 'codex', sessionId: 'live-session-1' },
      },
    })).toThrow('Profile utility parent message was denied')
    expect(() => assertProfileUtilityParentMessage({
      ...liveRequest,
      payload: {
        request: commandRequest,
        transport: 'cli',
        actor: { client: 'codex', sessionId: 'live-session-1', kind: 'user' },
      },
    })).toThrow('Profile utility parent message was denied')
    expect(() => assertProfileUtilityParentMessage({
      ...request,
      payload: {
        request: {
          ...commandRequest,
          commands: [{
            version: 1,
            id: 'create-template',
            name: 'mod-template.create',
            payload: {},
          }],
        },
      },
    })).toThrow('Profile utility parent message was denied')

    const receipt = {
      kind: 'agent-command-batch',
      version: 5,
      previousRevision: 4,
      revision: 5,
      proposedRevision: 5,
      commitId: 'agent-commit-1',
      commandResults: [{
        commandId: 'create-note',
        name: 'card.create',
        cardId: 'card-created',
        blockId: 'block-created',
        position: { x: 10, y: 20 },
      }],
      effects: {
        inserted: 2,
        updated: 0,
        deleted: 0,
        intentEvents: 1,
        profileAgentEvents: 0,
      },
      intentEventIds: ['intent-created'],
      profileAgentEventIds: [],
      dryRun: false,
      replayed: false,
    } as const
    const response = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'agent-command-1',
      operation: 'apply-agent-command-batch',
      result: { ok: true, value: receipt },
    } as const

    expect(assertProfileUtilityChildMessage(
      response,
      'agent-command-1',
      'apply-agent-command-batch',
    )).toEqual(response)
    expect(() => assertProfileUtilityChildMessage({
      ...response,
      result: { ok: true, value: { ...receipt, actorId: 'forged' } },
    }, 'agent-command-1', 'apply-agent-command-batch')).toThrow(
      'Profile utility child message was denied',
    )
  })

  it('admits a supported older Agent receipt only when it is an exact replay', () => {
    const receipt = {
      kind: 'agent-command-batch',
      version: 1,
      previousRevision: 4,
      revision: 5,
      proposedRevision: 5,
      commitId: 'agent-commit-v1',
      commandResults: [{
        commandId: 'create-note',
        name: 'card.create',
        cardId: 'card-created',
        blockId: 'block-created',
      }],
      effects: { inserted: 2, updated: 0, deleted: 0, intentEvents: 1 },
      intentEventIds: ['intent-created'],
      dryRun: false,
      replayed: true,
    } as const
    const response = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'agent-command-v1-replay',
      operation: 'apply-agent-command-batch',
      result: { ok: true, value: receipt },
    } as const

    expect(assertProfileUtilityChildMessage(
      response,
      'agent-command-v1-replay',
      'apply-agent-command-batch',
    )).toEqual(response)
    expect(() => assertProfileUtilityChildMessage({
      ...response,
      result: { ok: true, value: { ...receipt, replayed: false } },
    }, 'agent-command-v1-replay', 'apply-agent-command-batch')).toThrow(
      'Profile utility child message was denied',
    )
  })

  it('admits a canonical max-cursor query with its separately bounded filters', () => {
    const request = createProfileUtilityRequest('query-boundary', 'query', {
      request: {
        cursor: 'c'.repeat(PROFILE_QUERY_LIMITS.maxCursorBytes),
        recordIds: Array.from({ length: PROFILE_QUERY_LIMITS.maxFilterValues }, (_, index) => (
          `${index.toString().padStart(2, '0')}-${'r'.repeat(PROFILE_QUERY_LIMITS.maxFilterValueBytes - 3)}`
        )),
      },
    })
    expect(assertProfileUtilityParentMessage(request)).toEqual(request)
  })

  it('admits only exact bounded Result-inspection requests and typed pages', () => {
    const request = createProfileUtilityRequest('result-boundary', 'inspect-result', {
      request: {
        ideaId: 'idea-main',
        resultCardId: 'card-result',
        limit: 1,
        byteLimit: 4_096,
        cursor: 'cursor-1',
      },
    })
    expect(assertProfileUtilityParentMessage(request)).toEqual(request)
    expect(() => assertProfileUtilityParentMessage({
      ...request,
      payload: { request: { ...request.payload.request, projection: ['text'] } },
    })).toThrow('Profile utility parent message was denied')

    const response = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'result-boundary',
      operation: 'inspect-result',
      result: {
        ok: true,
        value: {
          profileId: 'profile-proof',
          revision: 5,
          ideaId: 'idea-main',
          resultCardId: 'card-result',
          items: [{
            recordId: 'card-result',
            kind: 'card',
            ownerId: 'board:idea-main',
            parentId: 'board:idea-main',
            ordinal: 0,
            recordVersion: PROFILE_CONTRACT_VERSIONS.record,
            payload: { id: 'card-result', kind: 'result' },
          }],
          nextCursor: 'cursor-2',
          truncated: true,
        },
      },
    } as const
    expect(assertProfileUtilityChildMessage(
      response,
      'result-boundary',
      'inspect-result',
    )).toEqual(response)
    expect(() => assertProfileUtilityChildMessage({
      ...response,
      result: {
        ok: true,
        value: { ...response.result.value, resultCardId: '' },
      },
    }, 'result-boundary', 'inspect-result')).toThrow(
      'Profile utility child message was denied',
    )
  })

  it('admits bounded Agent change requests and exact attributed pages', () => {
    const request = createProfileUtilityRequest('changes-boundary', 'changes', {
      request: {
        since: 3,
        limit: 1,
        byteLimit: 4_096,
        cursor: 'c'.repeat(PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxCursorBytes),
      },
    })
    expect(assertProfileUtilityParentMessage(request)).toEqual(request)

    const response = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'changes-boundary',
      operation: 'changes',
      result: {
        ok: true,
        value: {
          profileId: 'profile-proof',
          revision: 5,
          since: 3,
          items: [{
            revision: 5,
            committedAt: '2026-07-22T00:00:00.000Z',
            actor: { kind: 'agent', client: 'eido-test', sessionId: 'session-1' },
            command: { id: 'create-1', name: 'card.create' },
            ideaId: 'idea-1',
            recordId: 'card-1',
            recordKind: 'card',
            changeKind: 'insert',
            position: { x: 10, y: 20 },
            deepLink: 'eido://app/?idea=idea-1&card=card-1',
          }],
          truncated: false,
        },
      },
    } as const
    expect(assertProfileUtilityChildMessage(
      response,
      'changes-boundary',
      'changes',
    )).toEqual(response)
  })

  it('admits bounded spatial requests and exact authority-correlated results', () => {
    const neighborsRequest = createProfileUtilityRequest(
      'neighbors-boundary',
      'agent-card-neighbors',
      { request: { ideaId: 'idea-1', card: 'card-1', limit: 2, byteLimit: 4_096 } },
    )
    expect(assertProfileUtilityParentMessage(neighborsRequest)).toEqual(neighborsRequest)
    expect(() => assertProfileUtilityParentMessage({
      ...neighborsRequest,
      payload: { request: { ideaId: 'idea-1', card: 'card-1' } },
    })).toThrow('Profile utility parent message was denied')

    const neighborsResponse = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'neighbors-boundary',
      operation: 'agent-card-neighbors',
      result: {
        ok: true,
        value: {
          profileId: 'profile-proof',
          revision: 5,
          ideaId: 'idea-1',
          card: {
            cardId: 'card-1',
            deepLink: 'eido://app/?idea=idea-1&card=card-1',
          },
          items: [{
            cardId: 'card-2',
            deepLink: 'eido://app/?idea=idea-1&card=card-2',
            kind: 'note',
            position: { x: 20, y: 30 },
            size: { width: 260, height: 180 },
            connection: {
              id: 'connection-1',
              direction: 'outgoing',
              strength: 'strong',
              polarity: 'helps',
              role: 'feeds',
            },
          }],
          truncated: false,
        },
      },
    } as const
    expect(assertProfileUtilityChildMessage(
      neighborsResponse,
      'neighbors-boundary',
      'agent-card-neighbors',
    )).toEqual(neighborsResponse)

    const boundsRequest = createProfileUtilityRequest(
      'bounds-boundary',
      'agent-card-set-bounds',
      { request: { ideaId: 'idea-1', cards: ['card-2', 'card-1', 'card-1'] } },
    )
    expect(assertProfileUtilityParentMessage(boundsRequest)).toEqual(boundsRequest)
    const boundsResponse = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'bounds-boundary',
      operation: 'agent-card-set-bounds',
      result: {
        ok: true,
        value: {
          profileId: 'profile-proof',
          revision: 5,
          ideaId: 'idea-1',
          cards: [{
            cardId: 'card-1',
            deepLink: 'eido://app/?idea=idea-1&card=card-1',
            kind: 'note',
            position: { x: 10, y: 20 },
            size: { width: 260, height: 180 },
          }, {
            cardId: 'card-2',
            deepLink: 'eido://app/?idea=idea-1&card=card-2',
            kind: 'note',
            position: { x: 50, y: 40 },
            size: { width: 260, height: 180 },
          }],
          bounds: { x: 10, y: 20, width: 300, height: 200 },
        },
      },
    } as const
    expect(assertProfileUtilityChildMessage(
      boundsResponse,
      'bounds-boundary',
      'agent-card-set-bounds',
    )).toEqual(boundsResponse)
  })

  it('admits one exact versioned request envelope and excludes fresh Profile import', () => {
    expect(PROFILE_UTILITY_OPERATIONS).toEqual([
      'runtime-probe',
      'hydrate',
      'authorize-ordinary-idea-create',
      'commit-gui-projection',
      'confirm-revision',
      'status',
      'capabilities',
      'query',
      'inspect-result',
      'changes',
      'agent-card-neighbors',
      'agent-card-set-bounds',
      'apply-agent-command-batch',
      'export-portable',
      'duplicate-idea',
      'import-idea-closure',
      'inspect-recovery',
      'restore-recovery',
      'start-fresh',
      'close',
    ])

    const request = createProfileUtilityRequest(
      'request-1',
      'confirm-revision',
      { expectedRevision: 7 },
    )
    expect(assertProfileUtilityParentMessage(request)).toEqual(request)
    expect(Object.isFrozen(request)).toBe(true)

    for (const denied of [
      { ...request, version: 2 },
      { ...request, requestId: '' },
      { ...request, rawSql: 'SELECT * FROM profile_meta' },
      { ...request, operation: 'import-portable-into-fresh-profile' },
      { ...request, payload: { expectedRevision: 7, databasePath: 'private.sqlite' } },
    ]) {
      expect(() => assertProfileUtilityParentMessage(denied)).toThrow(
        'Profile utility parent message was denied',
      )
    }
  })

  it('requires correlation on explicit success and failure result envelopes', () => {
    const success = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'request-2',
      operation: 'confirm-revision',
      result: { ok: true, value: { revision: 8, durable: true, dirty: false } },
    } as const
    const failure = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'request-2',
      operation: 'confirm-revision',
      result: profileServiceFailure('busy'),
    } as const

    expect(assertProfileUtilityChildMessage(success, 'request-2', 'confirm-revision')).toEqual(success)
    expect(assertProfileUtilityChildMessage(failure, 'request-2', 'confirm-revision')).toEqual(failure)
    const futureFailure = {
      ...failure,
      result: profileServiceFailure('unsupported-future-version', {
        supportedVersions: PROFILE_CONTRACT_VERSIONS,
      }),
    } as const
    expect(assertProfileUtilityChildMessage(
      futureFailure,
      'request-2',
      'confirm-revision',
    )).toEqual(futureFailure)
    expect(() => assertProfileUtilityChildMessage(success, 'request-other')).toThrow(
      'Profile utility child message was denied',
    )

    const userPayloadField = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'request-query',
      operation: 'query',
      result: {
        ok: true,
        value: {
          profileId: 'profile-synthetic',
          revision: 8,
          items: [{
            recordId: 'card-user-text',
            kind: 'card',
            ownerId: 'board:idea-main',
            parentId: 'board:idea-main',
            ordinal: 0,
            recordVersion: PROFILE_CONTRACT_VERSIONS.record,
            payload: { databasePath: 'ordinary user-authored text' },
          }],
          truncated: false,
        },
      },
    } as const
    expect(assertProfileUtilityChildMessage(
      userPayloadField,
      'request-query',
      'query',
    )).toEqual(userPayloadField)
  })

  it('bounds inert messages before dispatch', () => {
    let overdeep: Record<string, unknown> = { leaf: true }
    for (let depth = 0; depth < 70; depth += 1) overdeep = { child: overdeep }
    const oversized = createProfileUtilityRequest(
      'request-large',
      'query',
      { request: overdeep },
    )

    expect(() => assertProfileUtilityParentMessage(oversized)).toThrow(
      'Profile utility parent message was denied',
    )
  })

  it('admits renderer commit state without accepting Profile identity or settings authority', () => {
    const payload = {
      generation: 1,
      expectedRevision: 0,
      clientTxnId: 'client-1',
      idempotencyKey: 'key-1',
      committedAt: '2026-07-19T04:00:00.000Z',
      context: { trustedActorId: 'eido-gui', ordinaryNewIdeas: [] },
      rendererProjection: {
        projectionVersion: 2,
        activeIdeaId: 'idea-main',
        ideas: [],
        boardReplacements: {},
        userModTemplates: [],
        newModOrigins: {},
      },
    } as const
    const request = createProfileUtilityRequest('commit-renderer', 'commit-gui-projection', payload)

    expect(assertProfileUtilityParentMessage(request)).toEqual(request)
    expect(() => assertProfileUtilityParentMessage({
      ...request,
      payload: {
        ...payload,
        rendererProjection: {
          ...payload.rendererProjection,
          profileId: 'profile-forged',
          profileSettings: [],
        },
      },
    })).toThrow('Profile utility parent message was denied')

    expect(assertProfileUtilityParentMessage({
      ...request,
      payload: {
        ...payload,
        rendererProjection: {
          ...payload.rendererProjection,
          userModTemplates: [{ templateId: 'template-synthetic', mod: syntheticMod }],
          // Origin contents are validated canonically by the owner projection.
          newModOrigins: { 'card-synthetic': { opaqueAtThisBoundary: true } },
        },
      },
    })).toMatchObject({ kind: 'request', operation: 'commit-gui-projection' })

    for (const rendererProjection of [
      { ...payload.rendererProjection, projectionVersion: 1 },
      { ...payload.rendererProjection, userModTemplates: [syntheticMod] },
      { ...payload.rendererProjection, userModTemplates: [{ mod: syntheticMod }] },
      {
        ...payload.rendererProjection,
        userModTemplates: [{ templateId: '', mod: syntheticMod }],
      },
      {
        ...payload.rendererProjection,
        userModTemplates: [{ templateId: '   ', mod: syntheticMod }],
      },
      {
        ...payload.rendererProjection,
        userModTemplates: [{ templateId: 'é'.repeat(257), mod: syntheticMod }],
      },
      {
        ...payload.rendererProjection,
        userModTemplates: [{
          templateId: 'template-synthetic',
          mod: syntheticMod,
          recordId: 'renderer-forged',
        }],
      },
      {
        ...payload.rendererProjection,
        userModTemplates: [{
          templateId: 'template-synthetic',
          mod: { ...syntheticMod, id: 'legacy-root-id' },
        }],
      },
    ]) {
      expect(() => assertProfileUtilityParentMessage({
        ...request,
        payload: {
          ...payload,
          rendererProjection,
        },
      }), JSON.stringify(rendererProjection)).toThrow('Profile utility parent message was denied')
    }
  })

  it('requires bounded string evidence in GUI commit success receipts', () => {
    const response = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'commit-receipt-1',
      operation: 'commit-gui-projection',
      result: {
        ok: true,
        value: {
          previousRevision: 0,
          revision: 1,
          commitId: 'commit-1',
          generation: 1,
          clientTxnId: 'client-1',
          idempotencyKey: 'key-1',
          deletedRecordIds: [],
          changedRecordIds: [],
          appendedIntentEventIds: [],
          authorizationIds: ['authorization-1'],
          replayed: false,
        },
      },
    } as const
    expect(assertProfileUtilityChildMessage(
      response,
      'commit-receipt-1',
      'commit-gui-projection',
    )).toEqual(response)

    for (const authorizationIds of [
      [7],
      [''],
      ['x'.repeat(513)],
      ['authorization-1', 'authorization-1'],
      ['authorization-z', 'authorization-a'],
    ]) {
      expect(() => assertProfileUtilityChildMessage({
        ...response,
        result: {
          ok: true,
          value: { ...response.result.value, authorizationIds },
        },
      }, 'commit-receipt-1', 'commit-gui-projection')).toThrow(
        'Profile utility child message was denied',
      )
    }
  })

  it('carries trusted recovery high-water without accepting a parent revision token', () => {
    expect(createProfileUtilityReady('active-owner', 'recovery-required', 11)).toEqual({
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'recovery-required',
      currentRevision: 11,
    })
    expect(() => assertProfileUtilityChildMessage({
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'recovery-required',
    })).toThrow('Profile utility child message was denied')

    const restore = createProfileUtilityRequest(
      'restore-1',
      'restore-recovery',
      { candidateId: 'recovery-1' },
    )
    expect(assertProfileUtilityParentMessage(restore)).toEqual(restore)
    expect(() => assertProfileUtilityParentMessage({
      ...restore,
      payload: { candidateId: 'recovery-1', expectedRevision: 11 },
    })).toThrow('Profile utility parent message was denied')

    const inspection = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'inspect-1',
      operation: 'inspect-recovery',
      result: {
        ok: true,
        value: {
          mode: 'inspect',
          candidates: [{
            id: 'recovery-1',
            recordVersion: PROFILE_CONTRACT_VERSIONS.record,
            revision: 10,
            verified: true,
            createdAt: '2026-07-18T00:00:00.000Z',
          }],
          rejectedCandidateIds: [],
          quarantinedCurrentState: false,
          currentRevision: 11,
        },
      },
    } as const
    expect(assertProfileUtilityChildMessage(
      inspection,
      'inspect-1',
      'inspect-recovery',
    )).toEqual(inspection)
    expect(() => assertProfileUtilityChildMessage({
      ...inspection,
      result: {
        ok: true,
        value: {
          mode: 'inspect',
          candidates: [],
          rejectedCandidateIds: [],
          quarantinedCurrentState: false,
        },
      },
    }, 'inspect-1', 'inspect-recovery')).toThrow('Profile utility child message was denied')
    for (const mutation of [
      { candidates: [{ id: 'recovery-1' }] },
      { candidates: [inspection.result.value.candidates[0], inspection.result.value.candidates[0]] },
      { rejectedCandidateIds: [7] },
      { rejectedCandidateIds: [''] },
      { rejectedCandidateIds: ['rejected-1', 'rejected-1'] },
    ]) {
      expect(() => assertProfileUtilityChildMessage({
        ...inspection,
        result: {
          ok: true,
          value: { ...inspection.result.value, ...mutation },
        },
      }, 'inspect-1', 'inspect-recovery')).toThrow('Profile utility child message was denied')
    }

    const restored = {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'restore-1',
      operation: 'restore-recovery',
      result: {
        ok: true,
        value: {
          mode: 'restore',
          selectedCandidateId: 'recovery-1',
          rejectedCandidateIds: [],
          quarantinedCurrentState: false,
          previousRevision: 11,
          revision: 12,
        },
      },
    } as const
    expect(assertProfileUtilityChildMessage(restored, 'restore-1', 'restore-recovery')).toEqual(
      restored,
    )
    expect(() => assertProfileUtilityChildMessage({
      ...restored,
      result: {
        ok: true,
        value: { ...restored.result.value, revision: 11 },
      },
    }, 'restore-1', 'restore-recovery')).toThrow('Profile utility child message was denied')
    expect(() => assertProfileUtilityChildMessage({
      ...restored,
      result: {
        ok: true,
        value: { ...restored.result.value, revision: 10 },
      },
    }, 'restore-1', 'restore-recovery')).toThrow('Profile utility child message was denied')
    expect(() => assertProfileUtilityChildMessage({
      ...restored,
      result: {
        ok: true,
        value: { ...restored.result.value, rejectedCandidateIds: [7] },
      },
    }, 'restore-1', 'restore-recovery')).toThrow('Profile utility child message was denied')
  })

})
