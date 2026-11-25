import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createSeedMod } from '../src/mods'
import {
  PROFILE_CONTRACT_VERSIONS,
  profileServiceFailure,
  type ProfileSnapshot,
  type ProfileStatus,
} from '../src/persistence/profileServiceContract'
import type { ProfileAgentCommandRequest } from '../src/persistence/profileAgentCommandPlan'
import {
  createProfileUtilityClient,
  type ProfileUtilityTerminalLoss,
} from './profileUtilityClient'
import {
  PROFILE_UTILITY_PROTOCOL_VERSION,
  type ProfileUtilityRequestMessage,
} from './profileUtilityProtocol'

class FakeUtilityTransport extends EventEmitter {
  readonly sent: unknown[] = []
  kills = 0
  killResult = true
  killError: Error | undefined
  onKill: (() => void) | undefined
  onPostMessage: ((message: unknown) => void) | undefined

  postMessage(message: unknown): void {
    this.sent.push(message)
    this.onPostMessage?.(message)
  }

  kill(): boolean {
    this.kills += 1
    this.onKill?.()
    if (this.killError) throw this.killError
    return this.killResult
  }
}

describe('Profile utility client', () => {
  it('waits for readiness and correlates concurrent responses by request identity', async () => {
    const transport = new FakeUtilityTransport()
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'utility-session',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })

    const first = client.request('status', Object.freeze({}))
    const second = client.request('hydrate', Object.freeze({}))
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]).toMatchObject({ kind: 'initialize' })

    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 7,
    })
    await client.ready()

    expect(transport.sent).toHaveLength(3)
    expect((transport.sent[1] as ProfileUtilityRequestMessage).requestId).toBe('utility-session:1')
    expect((transport.sent[2] as ProfileUtilityRequestMessage).requestId).toBe('utility-session:2')

    const status = readyStatus(7)
    const snapshot = profileSnapshot(7)

    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'utility-session:2',
      operation: 'hydrate',
      result: { ok: true, value: snapshot },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'utility-session:1',
      operation: 'status',
      result: { ok: true, value: status },
    })

    await expect(first).resolves.toEqual({ ok: true, value: status })
    await expect(second).resolves.toEqual({ ok: true, value: snapshot })
  })

  it('terminally rejects readiness for a different ownership route', async () => {
    const transport = new FakeUtilityTransport()
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'headless-route-session',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'exclusive-headless-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        transport: 'cli',
        actor: { client: 'eido-test', sessionId: 'client-headless-session' },
      },
    })

    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 7,
    })

    await expect(client.ready()).rejects.toMatchObject({ code: 'invalid-protocol' })
    expect(transport.kills).toBe(1)
  })

  it('fails closed after the bounded readiness deadline without posting queued work', async () => {
    vi.useFakeTimers()
    try {
      const transport = new FakeUtilityTransport()
      const client = createProfileUtilityClient(transport, {
        createRequestId: () => 'queued-before-ready',
        readyTimeoutMs: 25,
        initialize: {
          route: 'active-owner',
          databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
          portableTempRoot: 'C:\\proof\\portable',
        },
      })
      const pending = client.request('status', Object.freeze({}))
      const readyFailure = expect(client.ready()).rejects.toMatchObject({ code: 'not-ready' })
      const pendingFailure = expect(pending).rejects.toMatchObject({ code: 'not-ready' })

      await vi.advanceTimersByTimeAsync(25)

      await readyFailure
      await pendingFailure
      expect(transport.sent).toHaveLength(1)
      expect(transport.kills).toBe(1)

      const exit = client.waitForExit()
      transport.emit('exit', 1)
      await expect(exit).resolves.toEqual({ code: 1 })

      transport.emit('message', {
        version: PROFILE_UTILITY_PROTOCOL_VERSION,
        kind: 'ready',
        route: 'active-owner',
        state: 'ready',
        revision: 0,
      })
      await expect(client.request('status', Object.freeze({}))).rejects.toMatchObject({
        code: 'not-ready',
      })
      expect(transport.sent).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects every pending and future request after one terminal utility exit', async () => {
    const transport = new FakeUtilityTransport()
    const ids = ['pending-a', 'pending-b', 'never-posted'][Symbol.iterator]()
    const losses: string[] = []
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => ids.next().value as string,
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    client.onTerminalLoss((loss) => losses.push(`${loss.phase}:${loss.error.message}`))
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 2,
    })
    const first = client.request('status', Object.freeze({}))
    const second = client.request('hydrate', Object.freeze({}))

    transport.emit('exit', 17)

    await expect(first).rejects.toMatchObject({ code: 'early-exit' })
    await expect(second).rejects.toMatchObject({ code: 'early-exit' })
    await expect(client.request('status', Object.freeze({}))).rejects.toMatchObject({
      code: 'early-exit',
    })
    expect(losses).toEqual(['ready:Profile utility exited with code 17'])
    expect(transport.sent).toHaveLength(3)
    expect(transport.kills).toBe(0)
  })

  it('correlates an unowned response envelope before traversing its result', async () => {
    const transport = new FakeUtilityTransport()
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'owned-request',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 2,
    })
    const pending = client.request('status', Object.freeze({}))
    const pendingFailure = expect(pending).rejects.toMatchObject({ code: 'invalid-protocol' })
    let deepTraversals = 0
    const unownedResult = new Proxy({}, {
      ownKeys() {
        deepTraversals += 1
        throw new Error('unowned result must remain opaque')
      },
    })

    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'not-owned-by-this-client',
      operation: 'status',
      result: { ok: true, value: unownedResult },
    })

    await pendingFailure
    expect(deepTraversals).toBe(0)
    expect(transport.kills).toBe(1)
  })

  it('preserves a canonical fatal failure for main-process startup handling', async () => {
    const transport = new FakeUtilityTransport()
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'unused-request',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    const busy = profileServiceFailure('busy')
    const ready = client.ready()

    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'fatal',
      failure: busy,
    })

    await expect(ready).rejects.toMatchObject({
      code: 'fatal',
      failure: busy,
    })
    expect(transport.kills).toBe(1)
  })

  it('never reuses a session request identity after the former tombstone capacity', async () => {
    const transport = new FakeUtilityTransport()
    const createSessionNonce = vi.fn(() => 'one-lifetime-session')
    const client = createProfileUtilityClient(transport, {
      createRequestId: createSessionNonce,
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 3,
    })
    for (let sequence = 1; sequence <= 4_097; sequence += 1) {
      const request = client.request('status', Object.freeze({}))
      transport.emit('message', {
        version: PROFILE_UTILITY_PROTOCOL_VERSION,
        kind: 'response',
        requestId: `one-lifetime-session:${sequence}`,
        operation: 'status',
        result: { ok: true, value: readyStatus(3) },
      })
      await request
    }
    const pending = client.request('status', Object.freeze({}))
    const pendingFailure = expect(pending).rejects.toMatchObject({ code: 'invalid-protocol' })

    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'one-lifetime-session:1',
      operation: 'status',
      result: { ok: true, value: readyStatus(3) },
    })

    await pendingFailure
    expect(createSessionNonce).toHaveBeenCalledTimes(1)
    expect((transport.sent.at(-1) as ProfileUtilityRequestMessage).requestId)
      .toBe('one-lifetime-session:4098')
    expect(transport.kills).toBe(1)
  })

  it('rejects close instead of resolving it while another request is pending', async () => {
    const transport = new FakeUtilityTransport()
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'premature-close-session',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 0,
    })
    const status = client.request('status', Object.freeze({}))
    const close = client.request('close', Object.freeze({}))
    const statusFailure = expect(status).rejects.toMatchObject({ code: 'invalid-protocol' })
    const closeFailure = expect(close).rejects.toMatchObject({ code: 'invalid-protocol' })

    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'premature-close-session:2',
      operation: 'close',
      result: { ok: true, value: { closed: true } },
    })

    await statusFailure
    await closeFailure
    expect(transport.kills).toBe(1)
  })

  it('arms one intentional exit before acknowledging the correlated close response', async () => {
    const transport = new FakeUtilityTransport()
    const losses: ProfileUtilityTerminalLoss[] = []
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'close-request',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    client.onTerminalLoss((loss) => losses.push(loss))
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 0,
    })
    const close = client.request('close', Object.freeze({}))
    transport.onPostMessage = (message) => {
      if (typeof message === 'object'
        && message !== null
        && 'kind' in message
        && message.kind === 'close-acknowledgement') {
        transport.emit('exit', 0)
      }
    }

    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'close-request:1',
      operation: 'close',
      result: { ok: true, value: { closed: true } },
    })
    await expect(close).resolves.toEqual({ ok: true, value: { closed: true } })
    expect(transport.sent).toContainEqual({
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'close-acknowledgement',
      requestId: 'close-request:1',
    })
    await expect(client.waitForExit()).resolves.toEqual({ code: 0 })
    expect(losses).toEqual([])
    expect(transport.kills).toBe(0)
  })

  it('retries and surfaces a transport that rejects forced termination', async () => {
    const transport = new FakeUtilityTransport()
    transport.killResult = false
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'kill-retry-session',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 0,
    })
    const close = client.request('close', Object.freeze({}))
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'kill-retry-session:1',
      operation: 'close',
      result: { ok: true, value: { closed: true } },
    })
    await close

    await expect(client.terminate()).rejects.toMatchObject({ code: 'transport-failure' })
    await expect(client.terminate()).rejects.toMatchObject({ code: 'transport-failure' })
    expect(transport.kills).toBe(2)
  })

  it('can reissue an accepted termination when the child has not exited', async () => {
    const transport = new FakeUtilityTransport()
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'accepted-kill-retry-session',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 0,
    })

    const firstJoin = client.terminate()
    const retriedJoin = client.terminate(true)
    expect(transport.kills).toBe(2)
    transport.emit('exit', 0)

    await expect(firstJoin).resolves.toEqual({ code: 0 })
    await expect(retriedJoin).resolves.toEqual({ code: 0 })
  })

  it('lets an explicit owner withdraw its loss observer before intentional termination', async () => {
    const transport = new FakeUtilityTransport()
    const losses: ProfileUtilityTerminalLoss[] = []
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'withdrawn-loss-observer-session',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    const stopObserving = client.onTerminalLoss((loss) => losses.push(loss))
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 0,
    })

    stopObserving()
    const joined = client.terminate()
    expect(losses).toEqual([])
    expect(transport.kills).toBe(1)

    transport.emit('exit', 0)
    await expect(joined).resolves.toEqual({ code: 0 })
  })

  it('terminally rejects successful GUI receipts that do not match the submitted identity', async () => {
    const payload = Object.freeze({
      generation: 7,
      expectedRevision: 3,
      clientTxnId: 'client-correlated',
      idempotencyKey: 'idempotency-correlated',
      committedAt: '2026-07-18T00:00:00.000Z',
      context: Object.freeze({
        trustedActorId: 'desktop-owner',
        ordinaryNewIdeas: Object.freeze([{
          authorizationId: 'authorization-correlated',
          profileId: 'profile-default',
          baseRevision: 3,
          ideaId: 'idea-new',
          boardId: 'board:idea-new',
          createdAt: '2026-07-18T00:00:00.000Z',
          expiresAt: '2026-07-18T00:05:00.000Z',
        }]),
      }),
      rendererProjection: Object.freeze({
        projectionVersion: 2 as const,
        activeIdeaId: 'idea-new',
        ideas: [],
        boardReplacements: {},
        userModTemplates: [],
        newModOrigins: {},
      }),
    })
    const receipt = {
      previousRevision: 3,
      revision: 4,
      commitId: 'commit-correlated',
      generation: 7,
      clientTxnId: 'client-correlated',
      idempotencyKey: 'idempotency-correlated',
      deletedRecordIds: [],
      changedRecordIds: [],
      appendedIntentEventIds: [],
      authorizationIds: ['authorization-correlated'],
      replayed: false,
    }
    const mismatches = [
      { generation: 8 },
      { previousRevision: 2 },
      { clientTxnId: 'different-client' },
      { idempotencyKey: 'different-idempotency' },
      { authorizationIds: [] },
    ] as const

    for (const [index, mismatch] of mismatches.entries()) {
      const transport = new FakeUtilityTransport()
      const client = createProfileUtilityClient(transport, {
        createRequestId: () => `commit-correlation-${index}`,
        readyTimeoutMs: 1_000,
        initialize: {
          route: 'active-owner',
          databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
          portableTempRoot: 'C:\\proof\\portable',
        },
      })
      transport.emit('message', {
        version: PROFILE_UTILITY_PROTOCOL_VERSION,
        kind: 'ready',
        route: 'active-owner',
        state: 'ready',
        revision: 3,
      })
      const pending = client.request('commit-gui-projection', payload)
      const failure = expect(pending).rejects.toMatchObject({ code: 'invalid-protocol' })
      transport.emit('message', {
        version: PROFILE_UTILITY_PROTOCOL_VERSION,
        kind: 'response',
        requestId: `commit-correlation-${index}:1`,
        operation: 'commit-gui-projection',
        result: { ok: true, value: { ...receipt, ...mismatch } },
      })

      await failure
      expect(transport.kills).toBe(1)
    }
  })

  it('accepts an Agent receipt that matches the full ordered request', async () => {
    const transport = new FakeUtilityTransport()
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'agent-correlated-success',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'exclusive-headless-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        transport: 'cli',
        actor: { client: 'eido-test', sessionId: 'client-success-session' },
      },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'exclusive-headless-owner',
      state: 'ready',
      revision: 3,
    })
    const request = agentCommandCorrelationRequest()
    const pending = client.request('apply-agent-command-batch', { request })
    const receipt = agentCommandCorrelationReceipt()
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'agent-correlated-success:1',
      operation: 'apply-agent-command-batch',
      result: { ok: true, value: receipt },
    })

    await expect(pending).resolves.toEqual({ ok: true, value: receipt })
    expect(transport.kills).toBe(0)
  })

  it('accepts current v5 raw Mod receipts only when all four results bind the submitted request', async () => {
    for (const [index, testCase] of agentModCorrelationCases().entries()) {
      const receipt = agentModCorrelationReceipt(testCase.result, testCase.eventKind)
      await expectAgentCommandUtilityResponse(
        `agent-mod-correlated-${index}`,
        testCase.request,
        receipt,
        true,
      )
    }
  })

  it('accepts a replayed historical v4 Idea result only when its normalized name and Board identity correlate', async () => {
    const request = ideaCreateCorrelationRequest()
    const receipt = ideaCreateCorrelationReceipt()
    await expectAgentCommandUtilityResponse('idea-create-correlated', request, receipt, true)
    await expectAgentCommandUtilityResponse('idea-create-name-mismatch', request, {
      ...receipt,
      commandResults: [{ ...receipt.commandResults[0], ideaName: 'Other research' }],
    }, false)
    await expectAgentCommandUtilityResponse('idea-create-board-mismatch', request, {
      ...receipt,
      commandResults: [{ ...receipt.commandResults[0], boardId: 'board:different-idea' }],
    }, false)
    await expectAgentCommandUtilityResponse('idea-create-fresh-v4-denied', request, {
      ...receipt,
      replayed: false,
    }, false)
  })

  it('terminally rejects request-mismatched provenance for every Mod result variant', async () => {
    for (const [index, testCase] of agentModCorrelationCases().entries()) {
      const receipt = agentModCorrelationReceipt(
        testCase.mismatchResult,
        testCase.eventKind,
      )
      await expectAgentCommandUtilityResponse(
        `agent-mod-mismatch-${index}`,
        testCase.request,
        receipt,
        false,
      )
    }
  })

  it('correlates every v5 research and direct Mod result without weakening old surfaces', async () => {
    for (const [index, testCase] of agentV5CorrelationCases().entries()) {
      const request: ProfileAgentCommandRequest = {
        version: 1,
        schemaVersion: 1,
        expectedRevision: 3,
        idempotencyKey: `agent-v5-correlation-${index}`,
        dryRun: false,
        commands: [testCase.command] as ProfileAgentCommandRequest['commands'],
      }
      await expectAgentCommandUtilityResponse(
        `agent-v5-valid-${index}`,
        request,
        agentV5CorrelationReceipt(
          testCase.result,
          'profileEvent' in testCase && testCase.profileEvent === true,
        ),
        true,
      )
      if ('mismatchResult' in testCase && testCase.mismatchResult !== undefined) {
        await expectAgentCommandUtilityResponse(
          `agent-v5-mismatch-${index}`,
          request,
          agentV5CorrelationReceipt(
            testCase.mismatchResult,
            'profileEvent' in testCase && testCase.profileEvent === true,
          ),
          false,
        )
      }
    }
  })

  it('terminally rejects Agent receipts that do not match the full ordered request', async () => {
    const request = agentCommandCorrelationRequest()
    const receipt = agentCommandCorrelationReceipt()
    const commandResults = receipt.commandResults
    const mismatches = [
      {
        ...receipt,
        previousRevision: 2,
        proposedRevision: 3,
        revision: 3,
      },
      {
        ...receipt,
        dryRun: true,
        revision: 3,
        commitId: null,
        intentEventIds: [],
        replayed: false,
      },
      { ...receipt, commandResults: [...commandResults].reverse() },
      {
        ...receipt,
        commandResults: [
          { ...commandResults[0]!, commandId: 'different-command' },
          ...commandResults.slice(1),
        ],
      },
      {
        ...receipt,
        commandResults: [
          commandResults[0]!,
          { ...commandResults[1]!, cardId: 'different-card' },
          ...commandResults.slice(2),
        ],
      },
      {
        ...receipt,
        commandResults: [
          commandResults[0]!,
          { ...commandResults[1]!, blockId: 'different-block' },
          ...commandResults.slice(2),
        ],
      },
      {
        ...receipt,
        commandResults: [
          ...commandResults.slice(0, 2),
          { ...commandResults[2]!, cardId: 'different-card' },
          ...commandResults.slice(3),
        ],
      },
      {
        ...receipt,
        commandResults: [
          ...commandResults.slice(0, 3),
          { ...commandResults[3]!, connectionId: 'different-connection' },
          commandResults[4]!,
        ],
      },
      {
        ...receipt,
        commandResults: [
          ...commandResults.slice(0, 4),
          { ...commandResults[4]!, connectionId: 'different-connection' },
        ],
      },
      { ...receipt, effects: { ...receipt.effects, intentEvents: 1 } },
    ] as const

    for (const [index, mismatch] of mismatches.entries()) {
      const transport = new FakeUtilityTransport()
      const client = createProfileUtilityClient(transport, {
        createRequestId: () => `agent-correlation-${index}`,
        readyTimeoutMs: 1_000,
        initialize: {
          route: 'exclusive-headless-owner',
          databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
          transport: 'cli',
          actor: { client: 'eido-test', sessionId: `client-correlation-${index}` },
        },
      })
      transport.emit('message', {
        version: PROFILE_UTILITY_PROTOCOL_VERSION,
        kind: 'ready',
        route: 'exclusive-headless-owner',
        state: 'ready',
        revision: 3,
      })
      const pending = client.request('apply-agent-command-batch', { request })
      const failure = expect(pending).rejects.toMatchObject({ code: 'invalid-protocol' })
      transport.emit('message', {
        version: PROFILE_UTILITY_PROTOCOL_VERSION,
        kind: 'response',
        requestId: `agent-correlation-${index}:1`,
        operation: 'apply-agent-command-batch',
        result: { ok: true, value: mismatch },
      })

      await failure
      expect(transport.kills).toBe(1)
    }
  })

  it('treats a synchronous exit during a false-returning kill as joined', async () => {
    const transport = new FakeUtilityTransport()
    transport.killResult = false
    transport.onKill = () => transport.emit('exit', 0)
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'synchronous-exit-session',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 0,
    })

    await expect(client.terminate()).resolves.toEqual({ code: 0 })
    expect(transport.kills).toBe(1)
  })

  it('terminally rejects query pages that exceed the requested item limit', async () => {
    const transport = new FakeUtilityTransport()
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'query-correlation-session',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 3,
    })
    const pending = client.request('query', Object.freeze({
      request: Object.freeze({ recordIds: ['card-1'], limit: 1, byteLimit: 256 * 1024 }),
    }))
    const failure = expect(pending).rejects.toMatchObject({ code: 'invalid-protocol' })
    const item = {
      recordId: 'card-1',
      kind: 'card',
      ownerId: 'board:idea-main',
      parentId: 'board:idea-main',
      ordinal: 0,
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      payload: {},
    }
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'query-correlation-session:1',
      operation: 'query',
      result: {
        ok: true,
        value: {
          profileId: 'profile-default',
          revision: 3,
          items: [item, { ...item, recordId: 'card-2' }],
          truncated: false,
        },
      },
    })

    await failure
    expect(transport.kills).toBe(1)
  })

  it('terminally rejects a Result page correlated to a different semantic address', async () => {
    const transport = new FakeUtilityTransport()
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'result-correlation-session',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 3,
    })
    const pending = client.request('inspect-result', Object.freeze({
      request: Object.freeze({
        ideaId: 'idea-main',
        resultCardId: 'card-result',
        limit: 1,
        byteLimit: 4_096,
      }),
    }))
    const failure = expect(pending).rejects.toMatchObject({ code: 'invalid-protocol' })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'result-correlation-session:1',
      operation: 'inspect-result',
      result: {
        ok: true,
        value: {
          profileId: 'profile-default',
          revision: 3,
          ideaId: 'idea-main',
          resultCardId: 'card-other',
          items: [],
          truncated: false,
        },
      },
    })

    await failure
    expect(transport.kills).toBe(1)
  })

  it('terminally rejects an Agent change page correlated to a different since bound', async () => {
    const transport = new FakeUtilityTransport()
    const client = createProfileUtilityClient(transport, {
      createRequestId: () => 'changes-correlation-session',
      readyTimeoutMs: 1_000,
      initialize: {
        route: 'active-owner',
        databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
        portableTempRoot: 'C:\\proof\\portable',
      },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 5,
    })
    const pending = client.request('changes', Object.freeze({
      request: Object.freeze({ since: 3, limit: 1, byteLimit: 4_096 }),
    }))
    const failure = expect(pending).rejects.toMatchObject({ code: 'invalid-protocol' })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: 'changes-correlation-session:1',
      operation: 'changes',
      result: {
        ok: true,
        value: {
          profileId: 'profile-default',
          revision: 5,
          since: 2,
          items: [],
          truncated: false,
        },
      },
    })

    await failure
    expect(transport.kills).toBe(1)
  })
})

if (false) {
  const compileOnlyClient = null as unknown as import('./profileUtilityClient').ProfileUtilityClient
  // @ts-expect-error confirm-revision cannot infer a wider operation from a restore payload.
  void compileOnlyClient.request('confirm-revision', { candidateId: 'candidate-1' })
}

async function expectAgentCommandUtilityResponse(
  requestNonce: string,
  request: ProfileAgentCommandRequest,
  receipt: unknown,
  accepted: boolean,
): Promise<void> {
  const transport = new FakeUtilityTransport()
  const client = createProfileUtilityClient(transport, {
    createRequestId: () => requestNonce,
    readyTimeoutMs: 1_000,
    initialize: {
      route: 'exclusive-headless-owner',
      databasePath: 'C:\\proof\\profiles\\default\\eido-profile.sqlite',
      transport: 'cli',
      actor: { client: 'eido-test', sessionId: `client-${requestNonce}` },
    },
  })
  transport.emit('message', {
    version: PROFILE_UTILITY_PROTOCOL_VERSION,
    kind: 'ready',
    route: 'exclusive-headless-owner',
    state: 'ready',
    revision: 3,
  })
  const pending = client.request('apply-agent-command-batch', { request })
  const response = {
    version: PROFILE_UTILITY_PROTOCOL_VERSION,
    kind: 'response',
    requestId: `${requestNonce}:1`,
    operation: 'apply-agent-command-batch',
    result: { ok: true, value: receipt },
  } as const

  if (accepted) {
    transport.emit('message', response)
    await expect(pending).resolves.toEqual({ ok: true, value: receipt })
    expect(transport.kills).toBe(0)
    return
  }
  const failure = expect(pending).rejects.toMatchObject({ code: 'invalid-protocol' })
  transport.emit('message', response)
  await failure
  expect(transport.kills).toBe(1)
}

function readyStatus(revision: number): ProfileStatus {
  return {
    profileId: 'profile-default',
    revision,
    versions: contractVersions(),
    state: 'ready',
    owner: { mode: 'mutable', route: 'active-owner' },
    dirty: 'clean',
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
}

function agentCommandCorrelationRequest() {
  return Object.freeze({
    version: 1 as const,
    schemaVersion: 1 as const,
    expectedRevision: 3,
    idempotencyKey: 'agent-correlation-key',
    dryRun: false,
    commands: Object.freeze([{
      version: 1 as const,
      id: 'create-note',
      name: 'card.create' as const,
      payload: Object.freeze({
        ideaId: 'idea-main',
        kind: 'note' as const,
        position: Object.freeze({ x: 10, y: 20 }),
        text: 'Created',
      }),
    }, {
      version: 1 as const,
      id: 'update-note',
      name: 'card.update-content' as const,
      payload: Object.freeze({
        ideaId: 'idea-main',
        cardId: 'card-existing',
        blockId: 'block-existing',
        text: 'Updated',
      }),
    }, {
      version: 1 as const,
      id: 'delete-note',
      name: 'card.delete' as const,
      payload: Object.freeze({
        ideaId: 'idea-main',
        cardId: 'card-delete',
      }),
    }, {
      version: 1 as const,
      id: 'update-connection',
      name: 'connection.update-meaning' as const,
      payload: Object.freeze({
        ideaId: 'idea-main',
        connectionId: 'connection-update',
        reason: 'Updated',
      }),
    }, {
      version: 1 as const,
      id: 'delete-connection',
      name: 'connection.delete' as const,
      payload: Object.freeze({
        ideaId: 'idea-main',
        connectionId: 'connection-delete',
      }),
    }]),
  })
}

function ideaCreateCorrelationRequest(): ProfileAgentCommandRequest {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision: 3,
    idempotencyKey: 'idea-create-correlation-key',
    dryRun: false,
    commands: [{
      version: 1,
      id: 'create-chicken-research',
      name: 'idea.create',
      payload: { name: 'Chicken Research_1' },
    }],
  }
}

function ideaCreateCorrelationReceipt() {
  const ideaId = 'idea-chicken-research'
  return {
    kind: 'agent-command-batch' as const,
    version: 4 as const,
    previousRevision: 3,
    revision: 4,
    proposedRevision: 4,
    commitId: 'agent-idea-create-commit',
    commandResults: [{
      commandId: 'create-chicken-research',
      name: 'idea.create' as const,
      ideaId,
      boardId: `board:${ideaId}`,
      ideaName: 'Chicken Research_1',
    }],
    effects: {
      inserted: 2,
      updated: 0,
      deleted: 0,
      intentEvents: 0,
      profileAgentEvents: 1,
    },
    intentEventIds: [],
    profileAgentEventIds: ['profile-agent-event-idea-created'],
    dryRun: false,
    replayed: true,
  }
}

function agentCommandCorrelationReceipt() {
  return {
    kind: 'agent-command-batch' as const,
    version: 1 as const,
    previousRevision: 3,
    revision: 4,
    proposedRevision: 4,
    commitId: 'agent-commit-correlated',
    commandResults: [{
      commandId: 'create-note',
      name: 'card.create' as const,
      cardId: 'card-created',
      blockId: 'block-created',
    }, {
      commandId: 'update-note',
      name: 'card.update-content' as const,
      cardId: 'card-existing',
      blockId: 'block-existing',
    }, {
      commandId: 'delete-note',
      name: 'card.delete' as const,
      cardId: 'card-delete',
    }, {
      commandId: 'update-connection',
      name: 'connection.update-meaning' as const,
      connectionId: 'connection-update',
    }, {
      commandId: 'delete-connection',
      name: 'connection.delete' as const,
      connectionId: 'connection-delete',
    }],
    effects: { inserted: 2, updated: 2, deleted: 2, intentEvents: 5 },
    intentEventIds: [
      'intent-create',
      'intent-update',
      'intent-delete',
      'intent-connection-update',
      'intent-connection-delete',
    ],
    dryRun: false,
    replayed: true,
  }
}

function agentModCorrelationCases() {
  const templateId = 'mod-template-correlated'
  const mod = createSeedMod('filter', {
    title: 'Correlated template',
    createId: () => 'source-control-tone',
  })
  const requestBase = {
    version: 1 as const,
    schemaVersion: 1 as const,
    expectedRevision: 3,
    dryRun: false,
  } as const
  const createResult = {
    commandId: 'create-template',
    name: 'mod-template.create' as const,
    templateId,
    templateVersion: 1,
  }
  const updateResult = {
    commandId: 'update-template',
    name: 'mod-template.update' as const,
    templateId,
    previousTemplateVersion: 1,
    newTemplateVersion: 2,
  }
  const deleteResult = {
    commandId: 'delete-template',
    name: 'mod-template.delete' as const,
    templateId,
    deletedTemplateVersion: 2,
  }
  const stampResult = {
    commandId: 'stamp-template',
    name: 'mod-instance.stamp' as const,
    cardId: 'card-stamped',
    blockId: 'block-stamped',
    instanceId: 'mod-instance-stamped',
    source: { kind: 'template' as const, templateId, templateVersion: 2 },
    idMap: {
      mod: { sourceId: templateId, instanceId: 'mod-instance-stamped' },
      controls: [{
        sourceId: 'source-control-tone',
        instanceId: 'instance-control-tone',
      }],
    },
  }
  return [{
    request: {
      ...requestBase,
      idempotencyKey: 'agent-mod-create-correlation-key',
      commands: [{
        version: 1 as const,
        id: 'create-template',
        name: 'mod-template.create' as const,
        payload: { templateId, mod },
      }],
    },
    result: createResult,
    mismatchResult: { ...createResult, templateVersion: 2 },
    eventKind: 'profile' as const,
  }, {
    request: {
      ...requestBase,
      idempotencyKey: 'agent-mod-update-correlation-key',
      commands: [{
        version: 1 as const,
        id: 'update-template',
        name: 'mod-template.update' as const,
        payload: { templateId, expectedTemplateVersion: 1, mod },
      }],
    },
    result: updateResult,
    mismatchResult: {
      ...updateResult,
      previousTemplateVersion: 2,
      newTemplateVersion: 3,
    },
    eventKind: 'profile' as const,
  }, {
    request: {
      ...requestBase,
      idempotencyKey: 'agent-mod-delete-correlation-key',
      commands: [{
        version: 1 as const,
        id: 'delete-template',
        name: 'mod-template.delete' as const,
        payload: { templateId, expectedTemplateVersion: 2 },
      }],
    },
    result: deleteResult,
    mismatchResult: { ...deleteResult, deletedTemplateVersion: 1 },
    eventKind: 'profile' as const,
  }, {
    request: {
      ...requestBase,
      idempotencyKey: 'agent-mod-stamp-correlation-key',
      commands: [{
        version: 1 as const,
        id: 'stamp-template',
        name: 'mod-instance.stamp' as const,
        payload: {
          ideaId: 'idea-main',
          templateId,
          expectedTemplateVersion: 2,
          position: { x: 10, y: 20 },
        },
      }],
    },
    result: stampResult,
    mismatchResult: {
      ...stampResult,
      idMap: {
        ...stampResult.idMap,
        mod: { ...stampResult.idMap.mod, instanceId: 'different-instance' },
      },
    },
    eventKind: 'intent' as const,
  }] as const
}

function agentModCorrelationReceipt<Result>(result: Result, eventKind: 'profile' | 'intent') {
  const profileEvent = eventKind === 'profile'
  return {
    kind: 'agent-command-batch' as const,
    version: 5 as const,
    previousRevision: 3,
    revision: 4,
    proposedRevision: 4,
    commitId: `agent-mod-${eventKind}-commit`,
    commandResults: [result] as const,
    effects: {
      inserted: profileEvent ? 2 : 4,
      updated: 0,
      deleted: 0,
      intentEvents: profileEvent ? 0 : 1,
      profileAgentEvents: profileEvent ? 1 : 0,
    },
    intentEventIds: profileEvent ? [] : ['intent-stamped'],
    profileAgentEventIds: profileEvent ? ['profile-agent-event'] : [],
    dryRun: false,
    replayed: false,
  } as const
}

function agentV5CorrelationCases() {
  const mod = createSeedMod('switch', {
    title: 'DIRECT V5',
    createId: (role, ordinal) => `v5-${role}-${ordinal}`,
  })
  return [
    {
      command: {
        version: 1 as const,
        id: 'set-model',
        name: 'ask.set-model' as const,
        payload: { ideaId: 'idea-main', card: { cardId: 'ask-1' }, model: ' model-v5 ' },
      },
      result: {
        commandId: 'set-model', name: 'ask.set-model' as const,
        cardId: 'ask-1', model: 'model-v5',
      },
      mismatchResult: {
        commandId: 'set-model', name: 'ask.set-model' as const,
        cardId: 'ask-1', model: 'other-model',
      },
    },
    {
      command: {
        version: 1 as const,
        id: 'set-identity',
        name: 'card.set-identity' as const,
        payload: {
          ideaId: 'idea-main', card: { cardId: 'note-1' },
          identity: { fill: 'pattern' as const, preset: 'amber' as const },
        },
      },
      result: {
        commandId: 'set-identity', name: 'card.set-identity' as const,
        cardId: 'note-1', identity: { preset: 'amber' as const, fill: 'pattern' as const },
      },
      mismatchResult: {
        commandId: 'set-identity', name: 'card.set-identity' as const,
        cardId: 'note-1', identity: { preset: 'blue' as const, fill: 'pattern' as const },
      },
    },
    {
      command: {
        version: 1 as const,
        id: 'arrange-cards',
        name: 'cards.arrange' as const,
        payload: {
          ideaId: 'idea-main',
          frames: [{ card: { cardId: 'note-1' }, position: { x: 10, y: 20 } }],
        },
      },
      result: {
        commandId: 'arrange-cards', name: 'cards.arrange' as const, cardIds: ['note-1'],
      },
      mismatchResult: {
        commandId: 'arrange-cards', name: 'cards.arrange' as const, cardIds: ['other-note'],
      },
    },
    {
      command: {
        version: 1 as const,
        id: 'layer-cards',
        name: 'cards.reorder-layer' as const,
        payload: { ideaId: 'idea-main', cards: [{ cardId: 'note-1' }], direction: 'front' as const },
      },
      result: {
        commandId: 'layer-cards', name: 'cards.reorder-layer' as const,
        cardIds: ['note-1'], direction: 'front' as const,
      },
      mismatchResult: {
        commandId: 'layer-cards', name: 'cards.reorder-layer' as const,
        cardIds: ['note-1'], direction: 'back' as const,
      },
    },
    {
      command: {
        version: 1 as const,
        id: 'group-member',
        name: 'group.membership.set' as const,
        payload: {
          ideaId: 'idea-main', card: { cardId: 'note-1' }, group: { cardId: 'group-1' },
        },
      },
      result: {
        commandId: 'group-member', name: 'group.membership.set' as const,
        cardId: 'note-1', groupId: 'group-1',
      },
      mismatchResult: {
        commandId: 'group-member', name: 'group.membership.set' as const,
        cardId: 'note-1', groupId: 'group-2',
      },
    },
    {
      command: {
        version: 1 as const,
        id: 'choose-version',
        name: 'output.choose-version' as const,
        payload: { ideaId: 'idea-main', outputId: 'output-1', versionId: 'version-2' },
      },
      result: {
        commandId: 'choose-version', name: 'output.choose-version' as const,
        outputId: 'output-1', versionId: 'version-2',
      },
      mismatchResult: {
        commandId: 'choose-version', name: 'output.choose-version' as const,
        outputId: 'output-1', versionId: 'version-1',
      },
    },
    {
      command: {
        version: 1 as const,
        id: 'accept-version',
        name: 'output.set-accepted' as const,
        payload: {
          ideaId: 'idea-main', outputId: 'output-1', versionId: 'version-2', accepted: true,
        },
      },
      result: {
        commandId: 'accept-version', name: 'output.set-accepted' as const,
        outputId: 'output-1', versionId: 'version-2', accepted: true,
      },
      mismatchResult: {
        commandId: 'accept-version', name: 'output.set-accepted' as const,
        outputId: 'output-1', versionId: 'version-2', accepted: false,
      },
    },
    {
      command: {
        version: 1 as const,
        id: 'create-direct-mod',
        name: 'mod-instance.create' as const,
        payload: { ideaId: 'idea-main', mod, position: { x: 10, y: 20 } },
      },
      result: {
        commandId: 'create-direct-mod', name: 'mod-instance.create' as const,
        cardId: 'mod-card', blockId: 'mod-block', instanceId: 'mod-instance',
        source: { kind: 'direct' as const },
      },
    },
    {
      command: {
        version: 1 as const,
        id: 'configure-direct-mod',
        name: 'mod-instance.configure' as const,
        payload: { ideaId: 'idea-main', cardId: 'mod-card', mod },
      },
      result: {
        commandId: 'configure-direct-mod', name: 'mod-instance.configure' as const,
        cardId: 'mod-card', instanceId: 'mod-instance',
      },
      mismatchResult: {
        commandId: 'configure-direct-mod', name: 'mod-instance.configure' as const,
        cardId: 'other-mod-card', instanceId: 'mod-instance',
      },
    },
    {
      command: {
        version: 1 as const,
        id: 'delete-direct-mod',
        name: 'mod-instance.delete' as const,
        payload: { ideaId: 'idea-main', cardId: 'mod-card' },
      },
      result: {
        commandId: 'delete-direct-mod', name: 'mod-instance.delete' as const,
        cardId: 'mod-card', instanceId: 'mod-instance',
      },
      mismatchResult: {
        commandId: 'delete-direct-mod', name: 'mod-instance.delete' as const,
        cardId: 'other-mod-card', instanceId: 'mod-instance',
      },
    },
    {
      command: {
        version: 1 as const,
        id: 'activate-idea',
        name: 'idea.activate' as const,
        payload: { ideaId: 'idea-second' },
      },
      result: {
        commandId: 'activate-idea', name: 'idea.activate' as const,
        previousActiveIdeaId: 'idea-main', activeIdeaId: 'idea-second',
      },
      mismatchResult: {
        commandId: 'activate-idea', name: 'idea.activate' as const,
        previousActiveIdeaId: 'idea-main', activeIdeaId: 'idea-third',
      },
      profileEvent: true,
    },
  ] as const
}

function agentV5CorrelationReceipt<Result>(result: Result, profileEvent = false) {
  return {
    kind: 'agent-command-batch' as const,
    version: 5 as const,
    previousRevision: 3,
    revision: 4,
    proposedRevision: 4,
    commitId: 'agent-v5-correlation-commit',
    commandResults: [result] as const,
    effects: {
      inserted: 0,
      updated: 1,
      deleted: 0,
      intentEvents: 0,
      profileAgentEvents: profileEvent ? 1 : 0,
    },
    intentEventIds: [],
    profileAgentEventIds: profileEvent ? ['profile-agent-event-v5'] : [],
    dryRun: false,
    replayed: false,
  } as const
}

function profileSnapshot(revision: number): ProfileSnapshot {
  return {
    profileId: 'profile-default',
    revision,
    versions: contractVersions(),
    activeIdeaId: 'idea-main',
    ideas: [{
      id: 'idea-main',
      name: 'Synthetic Main',
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
      lastOpenedAt: '2026-07-18T00:00:00.000Z',
    }],
    boards: {
      'idea-main': {
        version: 1,
        cards: [],
        connections: [],
        outputs: [],
        runs: [],
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
    },
    modTemplates: [],
    modInstances: [],
    profileSettings: [{
      id: 'profile-setting-locale',
      recordVersion: 1,
      classification: 'portable-profile',
      value: { locale: 'en-AU' },
    }],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
}

function contractVersions() {
  return PROFILE_CONTRACT_VERSIONS
}
