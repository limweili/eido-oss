import { describe, expect, it, vi } from 'vitest'
import { createSeedMod } from '../src/mods'
import { createCompleteProfileFixture } from '../src/persistence/fixtures/profileLogicalProjectionFixture'
import { PROFILE_GUI_CAPTURE_MAX_BYTES } from '../src/persistence/profileGuiSaveScheduler'
import { PROFILE_QUERY_LIMITS } from '../src/persistence/profileServiceContract'
import {
  assertProfileAgentBarrierWireAck,
  assertProfileAgentBarrierWireRequest,
  assertProfileBridgeRequest,
  assertProfileBridgeResponse,
  assertProfileCheckpointWireAck,
  assertProfileCheckpointWireRequest,
  createInstalledProfileBridge,
  PROFILE_BRIDGE_CHANNEL,
  PROFILE_BRIDGE_CONTROL_MAX_BYTES,
  PROFILE_BRIDGE_ENVELOPE_MAX_BYTES,
  PROFILE_BRIDGE_MAX_BYTES,
  PROFILE_BRIDGE_QUERY_REQUEST_MAX_BYTES,
  PROFILE_BRIDGE_QUERY_RESPONSE_MAX_BYTES,
  PROFILE_BRIDGE_VERSION,
  type ProfileBridgeRequest,
} from './profileBridgeContract'

const projection = {
  projectionVersion: 2,
  activeIdeaId: 'idea-synthetic',
  ideas: [{
    id: 'idea-synthetic',
    name: 'Synthetic',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
    lastOpenedAt: '2026-07-19T00:00:00.000Z',
  }],
  boardReplacements: {},
  userModTemplates: [],
  newModOrigins: {},
} as const

const syntheticMod = createSeedMod('slider', {
  createId: (role, ordinal) => `synthetic-slider-${role}-${ordinal}`,
})

describe('installed Profile renderer bridge contract', () => {
  it('uses the canonical GUI capture bound for renderer projections and hydration', () => {
    expect(PROFILE_BRIDGE_MAX_BYTES).toBe(
      PROFILE_GUI_CAPTURE_MAX_BYTES + PROFILE_BRIDGE_ENVELOPE_MAX_BYTES,
    )
    expect(PROFILE_BRIDGE_QUERY_REQUEST_MAX_BYTES).toBeGreaterThan(
      PROFILE_QUERY_LIMITS.maxCursorBytes + PROFILE_BRIDGE_ENVELOPE_MAX_BYTES,
    )
    expect(PROFILE_BRIDGE_QUERY_RESPONSE_MAX_BYTES).toBeGreaterThan(
      PROFILE_QUERY_LIMITS.maxBytes
      + PROFILE_QUERY_LIMITS.maxCursorBytes
      + PROFILE_BRIDGE_ENVELOPE_MAX_BYTES,
    )
    expect(PROFILE_BRIDGE_CONTROL_MAX_BYTES).toBeLessThan(
      PROFILE_BRIDGE_QUERY_REQUEST_MAX_BYTES,
    )
    expect(PROFILE_BRIDGE_QUERY_REQUEST_MAX_BYTES).toBeLessThan(PROFILE_BRIDGE_MAX_BYTES)
    expect(PROFILE_BRIDGE_QUERY_RESPONSE_MAX_BYTES).toBeLessThan(PROFILE_BRIDGE_MAX_BYTES)
  })

  it('exposes frozen logical methods over one versioned channel without renderer authority fields', async () => {
    const invoke = vi.fn(async (_channel: string, request: ProfileBridgeRequest) => ({
      version: PROFILE_BRIDGE_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      value: request.operation === 'runtime-probe'
        ? {
            chromium: '150.0.7871.114',
            electron: '43.1.1',
            node: '24.18.0',
            profileAuthority: 'installed',
            sqlite: '3.53.1',
          }
        : request.operation === 'commit-gui-projection'
          ? { generation: 1, revision: 2, durable: true, dirty: false }
          : null,
    }))
    const bridge = createInstalledProfileBridge(invoke, () => 'renderer-request-1')

    expect(Object.isFrozen(bridge)).toBe(true)
    expect(Object.keys(bridge)).toEqual([
      'runtimeProbe',
      'hydrate',
      'ackHydration',
      'createOrdinaryIdea',
      'commitGuiProjection',
      'flush',
      'status',
      'capabilities',
      'query',
      'exportPortable',
      'duplicateIdea',
      'importIdeaClosure',
      'inspectRecovery',
      'restoreRecovery',
      'startFresh',
    ])

    await expect(bridge.commitGuiProjection(projection)).resolves.toEqual({
      ok: true,
      value: { generation: 1, revision: 2, durable: true, dirty: false },
    })
    expect(invoke).toHaveBeenCalledWith(PROFILE_BRIDGE_CHANNEL, {
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'renderer-request-1',
      operation: 'commit-gui-projection',
      payload: { projection },
    })
    expect(JSON.stringify(invoke.mock.calls[0]?.[1])).not.toMatch(/trustedActor|authorization|context/)
  })

  it('admits only exact inert operation envelopes and bounded schemas', () => {
    const valid = {
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'request-1',
      operation: 'commit-gui-projection',
      payload: { projection },
    } as const

    expect(assertProfileBridgeRequest(valid)).toEqual(valid)

    for (const attack of [
      { ...valid, version: 2 },
      { ...valid, rawIpc: true },
      { ...valid, payload: { projection, trustedActorId: 'renderer-forged' } },
      { ...valid, payload: { projection, context: { ordinaryNewIdeas: [] } } },
      { ...valid, payload: { projection: { ...projection, profileId: 'renderer-forged' } } },
      { ...valid, payload: { projection: { ...projection, profileSettings: [] } } },
      { ...valid, requestId: '' },
      { ...valid, operation: 'apply-command-batch' },
    ]) {
      expect(() => assertProfileBridgeRequest(attack), JSON.stringify(attack)).toThrow(
        'Profile bridge request was denied',
      )
    }
  })

  it('admits only exact GUI-v2 Mod template wrappers', () => {
    const valid = {
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'request-v2-mod-template',
      operation: 'commit-gui-projection',
      payload: {
        projection: {
          ...projection,
          userModTemplates: [{ templateId: 'template-synthetic', mod: syntheticMod }],
          // Origin contents are validated canonically by the owner projection.
          newModOrigins: { 'card-synthetic': { opaqueAtThisBoundary: true } },
        },
      },
    } as const

    expect(assertProfileBridgeRequest(valid)).toEqual(valid)

    for (const candidateProjection of [
      { ...valid.payload.projection, projectionVersion: 1 },
      { ...valid.payload.projection, userModTemplates: [syntheticMod] },
      {
        ...valid.payload.projection,
        userModTemplates: [{
          templateId: 'template-synthetic',
          mod: syntheticMod,
          recordId: 'renderer-forged',
        }],
      },
      {
        ...valid.payload.projection,
        userModTemplates: [{
          templateId: 'template-synthetic',
          mod: { ...syntheticMod, id: 'legacy-root-id' },
        }],
      },
    ]) {
      expect(() => assertProfileBridgeRequest({
        ...valid,
        payload: { projection: candidateProjection },
      }), JSON.stringify(candidateProjection)).toThrow('Profile bridge request was denied')
    }
  })

  it('selects the operation byte cap from a shallow inert envelope peek', () => {
    let nestedGetterCalls = 0
    const nestedPayload = Object.defineProperty({}, 'request', {
      enumerable: true,
      get() {
        nestedGetterCalls += 1
        return {}
      },
    })
    expect(() => assertProfileBridgeRequest({
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'unknown-operation',
      operation: 'not-a-profile-operation',
      payload: nestedPayload,
    })).toThrow('Profile bridge request was denied')
    expect(nestedGetterCalls).toBe(0)

    const maxCursor = 'c'.repeat(PROFILE_QUERY_LIMITS.maxCursorBytes)
    const validAtQueryCap = {
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'bounded-query',
      operation: 'query',
      payload: { request: { recordIds: ['idea-1'], cursor: maxCursor } },
    } as const
    expect(assertProfileBridgeRequest(validAtQueryCap)).toEqual(validAtQueryCap)

    const maximalBoundedQuery = {
      ...validAtQueryCap,
      requestId: 'maximal-bounded-query',
      payload: {
        request: {
          cursor: maxCursor,
          recordIds: Array.from({ length: PROFILE_QUERY_LIMITS.maxFilterValues }, (_, index) => (
            `${index.toString().padStart(2, '0')}-${'r'.repeat(PROFILE_QUERY_LIMITS.maxFilterValueBytes - 3)}`
          )),
        },
      },
    } as const
    expect(assertProfileBridgeRequest(maximalBoundedQuery)).toEqual(maximalBoundedQuery)
  })

  it('keeps canonical domain projection off the UI-sensitive main loop', () => {
    const request = {
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'request-cheap-admission',
      operation: 'commit-gui-projection',
      payload: {
        projection: {
          ...projection,
          ideas: [{ ...projection.ideas[0], malformedDomainField: true }],
          userModTemplates: [{ templateId: 'template-synthetic', mod: syntheticMod }],
        },
      },
    } as const

    // Main owns inert/top-level admission. The utility/owner performs the
    // canonical Idea/Board/origin projection before any native mutation. The
    // exact current Mod wrapper is already cheap and safe to admit here.
    expect(assertProfileBridgeRequest(request)).toEqual(request)
  })

  it('lets the main trust boundary reject malformed or path-bearing utility results', () => {
    const request = {
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'request-malformed',
      operation: 'status',
      payload: {},
    } as const
    expect(() => assertProfileBridgeResponse({
      version: PROFILE_BRIDGE_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      value: { revision: 1, databasePath: 'C:\\private\\profile.sqlite' },
    }, request)).toThrow('Profile bridge response was denied')
  })

  it('admits only an exact bounded Intent actor on native hydration results', () => {
    const snapshot = createCompleteProfileFixture().snapshot
    const request = {
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'hydrate-with-actor',
      operation: 'hydrate',
      payload: {},
    } as const
    const valid = {
      version: PROFILE_BRIDGE_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      value: {
        intentActorId: 'actor-trusted-owner',
        snapshot,
        acknowledgement: { epoch: 'hydration-epoch', revision: snapshot.revision },
      },
    } as const

    expect(assertProfileBridgeResponse(valid, request)).toEqual(valid)
    const { intentActorId: _omitted, ...withoutActor } = valid.value
    for (const value of [
      withoutActor,
      { ...valid.value, intentActorId: '' },
      { ...valid.value, intentActorId: '   ' },
      { ...valid.value, intentActorId: 'a'.repeat(513) },
      { ...valid.value, intentActorId: 'é'.repeat(257) },
      { ...valid.value, rendererActorId: 'renderer-forged' },
    ]) {
      expect(() => assertProfileBridgeResponse({ ...valid, value }, request)).toThrow(
        'Profile bridge response was denied',
      )
    }
  })

  it('carries only the correlated canonical owner timestamp for ordinary Idea creation', async () => {
    const request = {
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'ordinary-owner-time',
      operation: 'create-ordinary-idea',
      payload: { ideaId: 'idea-owner-time' },
    } as const
    const valid = {
      version: PROFILE_BRIDGE_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      value: {
        ideaId: request.payload.ideaId,
        authorized: true,
        createdAt: '2026-07-23T01:00:00.001Z',
      },
    } as const

    expect(assertProfileBridgeResponse(valid, request)).toEqual(valid)
    for (const value of [
      { ...valid.value, ideaId: 'idea-different' },
      { ideaId: valid.value.ideaId, authorized: true },
      { ...valid.value, createdAt: '2026-07-23T01:00:00Z' },
      { ...valid.value, createdAt: 'not-a-timestamp' },
      { ...valid.value, authorizationId: 'native-secret' },
    ]) {
      expect(() => assertProfileBridgeResponse({ ...valid, value }, request)).toThrow(
        'Profile bridge response was denied',
      )
    }

    const bridge = createInstalledProfileBridge(
      async () => ({ ...valid, value: { ...valid.value, ideaId: 'idea-different' } }),
      () => request.requestId,
    )
    await expect(bridge.createOrdinaryIdea(request.payload.ideaId)).rejects.toThrow(
      'Profile bridge response was denied',
    )
  })

  it('correlates only exact bounded renderer checkpoint envelopes', () => {
    expect(assertProfileCheckpointWireRequest({
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-request',
      token: 'checkpoint-1',
    })).toEqual({
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-request',
      token: 'checkpoint-1',
    })
    expect(assertProfileCheckpointWireAck({
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-ack',
      token: 'checkpoint-1',
      ok: true,
      generation: 2,
      nativeGeneration: 2,
      revision: 3,
    })).toMatchObject({ ok: true, revision: 3 })
    expect(() => assertProfileCheckpointWireAck({
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-ack',
      token: 'checkpoint-1',
      ok: true,
      generation: 2,
      nativeGeneration: 2,
      revision: 3,
      databasePath: 'C:\\private\\profile.sqlite',
    })).toThrow('Profile checkpoint acknowledgement was denied')
  })

  it('correlates exact tokened Agent barrier phases without authority fields', () => {
    expect(assertProfileAgentBarrierWireRequest({
      version: 1,
      kind: 'agent-barrier-request',
      token: 'barrier-1',
      phase: 'complete',
      revision: 8,
    })).toMatchObject({ token: 'barrier-1', phase: 'complete', revision: 8 })
    expect(assertProfileAgentBarrierWireAck({
      version: 1,
      kind: 'agent-barrier-ack',
      token: 'barrier-1',
      phase: 'begin',
      ok: true,
      generation: 3,
      nativeGeneration: 2,
      revision: 7,
    })).toMatchObject({ token: 'barrier-1', phase: 'begin', ok: true })
    expect(assertProfileAgentBarrierWireRequest({
      version: 1,
      kind: 'agent-barrier-request',
      token: 'barrier-1',
      phase: 'seal',
    })).toMatchObject({ token: 'barrier-1', phase: 'seal' })
    expect(assertProfileAgentBarrierWireAck({
      version: 1,
      kind: 'agent-barrier-ack',
      token: 'barrier-1',
      phase: 'seal',
      ok: true,
      generation: 4,
      nativeGeneration: 3,
      revision: 8,
    })).toMatchObject({ token: 'barrier-1', phase: 'seal', ok: true })
    for (const candidate of [
      { version: 1, kind: 'agent-barrier-request', token: 'barrier-1', phase: 'begin', revision: 7 },
      { version: 1, kind: 'agent-barrier-request', token: 'barrier-1', phase: 'complete' },
      { version: 1, kind: 'agent-barrier-request', token: 'barrier-1', phase: 'seal', revision: 8 },
      {
        version: 1,
        kind: 'agent-barrier-ack',
        token: 'barrier-1',
        phase: 'seal',
        ok: true,
        generation: 4,
        revision: 8,
      },
      {
        version: 1,
        kind: 'agent-barrier-ack',
        token: 'barrier-1',
        phase: 'complete',
        ok: true,
        databasePath: '/private/profile.sqlite',
      },
    ]) {
      const validate = candidate.kind === 'agent-barrier-request'
        ? assertProfileAgentBarrierWireRequest
        : assertProfileAgentBarrierWireAck
      expect(() => validate(candidate)).toThrow(/Profile Agent barrier/)
    }
  })

  it('rejects a recovery success that does not advance its authoritative revision', () => {
    const request = {
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'restore-no-advance',
      operation: 'restore-recovery',
      payload: { candidateId: 'recovery-1' },
    } as const
    expect(() => assertProfileBridgeResponse({
      version: PROFILE_BRIDGE_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      value: {
        mode: 'restore',
        selectedCandidateId: 'recovery-1',
        rejectedCandidateIds: [],
        quarantinedCurrentState: false,
        previousRevision: 4,
        revision: 4,
      },
    }, request)).toThrow('Profile bridge response was denied')
  })
})
