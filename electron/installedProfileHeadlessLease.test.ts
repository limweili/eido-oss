import { EventEmitter } from 'node:events'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PROFILE_CONTRACT_VERSIONS,
  profileServiceFailure,
  type ProfileStatus,
} from '../src/persistence/profileServiceContract'
import {
  createInstalledProfileAgentCapabilities,
  type ProfileAgentCommandBatchReceipt,
} from '../src/persistence/profileAgentCommandInstallation'
import type { ProfileAgentCommandRequest } from '../src/persistence/profileAgentCommandPlan'
import { createInstalledProfileHeadlessLeaseFactory } from './installedProfileHeadlessLease'
import type { ProfileInstallation } from './profileInstallation'
import {
  PROFILE_UTILITY_PROTOCOL_VERSION,
  type ProfileUtilityRequestMessage,
} from './profileUtilityProtocol'

class FakeUtilityTransport extends EventEmitter {
  readonly sent: unknown[] = []
  kills = 0
  onKill?: () => void

  postMessage(message: unknown): void {
    this.sent.push(message)
  }

  kill(): boolean {
    this.kills += 1
    this.onKill?.()
    return true
  }

  request(operation: ProfileUtilityRequestMessage['operation']): ProfileUtilityRequestMessage {
    for (let index = this.sent.length - 1; index >= 0; index -= 1) {
      const candidate = this.sent[index]
      if (isRequest(candidate) && candidate.operation === operation) return candidate
    }
    throw new Error(`Missing ${operation} request`)
  }

  respond<Operation extends ProfileUtilityRequestMessage['operation']>(
    operation: Operation,
    result: unknown,
  ): void {
    const request = this.request(operation)
    this.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'response',
      requestId: request.requestId,
      operation,
      result,
    })
  }
}

describe('installed Profile existing-only headless lease', () => {
  it('opens lazily with a frozen narrow lease and drains before joined close', async () => {
    const transport = new FakeUtilityTransport()
    let transportsCreated = 0
    const factory = createInstalledProfileHeadlessLeaseFactory({
      installation: installation(),
      transport: 'cli',
      createTransport: () => {
        transportsCreated += 1
        return transport
      },
      createRequestId: () => 'headless-session',
      agentClient: 'claude-code',
      createAgentSessionId: () => 'headless-agent-session',
      utilityExitTimeoutMs: 1_000,
    })

    expect(transportsCreated).toBe(0)
    const opened = factory.open()
    expect(transportsCreated).toBe(1)
    expect(transport.sent[0]).toMatchObject({
      kind: 'initialize',
      payload: {
        route: 'exclusive-headless-owner',
        transport: 'cli',
        actor: { client: 'claude-code', sessionId: 'headless-agent-session' },
      },
    })
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'exclusive-headless-owner',
      state: 'ready',
      revision: 4,
    })
    await Promise.resolve()
    transport.respond('status', { ok: true, value: status(4) })
    await Promise.resolve()
    transport.respond('capabilities', {
      ok: true,
      value: createInstalledProfileAgentCapabilities('sqlite'),
    })
    const result = await opened
    if (!result.ok) throw new Error(`Headless lease failed: ${result.message}`)
    const lease = result.value

    expect(Object.isFrozen(factory)).toBe(true)
    expect(Object.isFrozen(lease)).toBe(true)
    expect(Object.keys(lease).sort()).toEqual([
      'agentCardNeighbors',
      'agentCardSetBounds',
      'applyAgentCommandBatch',
      'capabilities',
      'changes',
      'close',
      'inspectResult',
      'query',
      'status',
    ])

    const changed = lease.changes({ since: 0, limit: 1, byteLimit: 4_096 })
    await Promise.resolve()
    transport.respond('changes', {
      ok: true,
      value: {
        profileId: 'profile-headless',
        revision: 4,
        since: 0,
        items: [],
        truncated: false,
      },
    })
    await expect(changed).resolves.toMatchObject({ ok: true, value: { revision: 4, since: 0 } })

    const neighbors = lease.agentCardNeighbors({
      ideaId: 'idea-main',
      card: 'card-1',
      limit: 1,
      byteLimit: 4_096,
    })
    await Promise.resolve()
    transport.respond('agent-card-neighbors', {
      ok: true,
      value: {
        profileId: 'profile-headless',
        revision: 4,
        ideaId: 'idea-main',
        card: { cardId: 'card-1', deepLink: 'eido://app/?idea=idea-main&card=card-1' },
        items: [],
        truncated: false,
      },
    })
    await expect(neighbors).resolves.toMatchObject({
      ok: true,
      value: { revision: 4, ideaId: 'idea-main', items: [] },
    })

    const bounds = lease.agentCardSetBounds({ ideaId: 'idea-main', cards: ['card-1'] })
    await Promise.resolve()
    transport.respond('agent-card-set-bounds', {
      ok: true,
      value: {
        profileId: 'profile-headless',
        revision: 4,
        ideaId: 'idea-main',
        cards: [{
          cardId: 'card-1',
          deepLink: 'eido://app/?idea=idea-main&card=card-1',
          kind: 'note',
          position: { x: 10, y: 20 },
          size: { width: 260, height: 180 },
        }],
        bounds: { x: 10, y: 20, width: 260, height: 180 },
      },
    })
    await expect(bounds).resolves.toMatchObject({
      ok: true,
      value: { revision: 4, ideaId: 'idea-main' },
    })

    const inspected = lease.inspectResult({
      ideaId: 'idea-main',
      resultCardId: 'card-result',
      limit: 2,
      byteLimit: 4_096,
    })
    await Promise.resolve()
    transport.respond('inspect-result', {
      ok: true,
      value: {
        profileId: 'profile-headless',
        revision: 4,
        ideaId: 'idea-main',
        resultCardId: 'card-result',
        items: [],
        truncated: false,
      },
    })
    await expect(inspected).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 4,
        ideaId: 'idea-main',
        resultCardId: 'card-result',
      },
    })

    const queried = lease.query({ recordKinds: ['idea'] })
    const firstClose = lease.close()
    const secondClose = lease.close()
    expect(firstClose).toBe(secondClose)
    await Promise.resolve()
    expect(transport.sent.filter((candidate) => (
      isRequest(candidate) && candidate.operation === 'close'
    ))).toHaveLength(0)

    transport.respond('query', {
      ok: true,
      value: {
        profileId: 'profile-headless',
        revision: 4,
        items: [],
        truncated: false,
      },
    })
    await expect(queried).resolves.toMatchObject({ ok: true, value: { revision: 4 } })
    await Promise.resolve()
    transport.respond('close', { ok: true, value: { closed: true } })
    let joined = false
    void firstClose.then(() => { joined = true })
    await Promise.resolve()
    expect(joined).toBe(false)
    transport.emit('exit', 0)
    await expect(firstClose).resolves.toBeUndefined()
    expect(transport.kills).toBe(0)
  })

  it('advances its observed head once while dry-run and historical replay never move it', async () => {
    const transport = new FakeUtilityTransport()
    const factory = createInstalledProfileHeadlessLeaseFactory({
      installation: installation(),
      transport: 'cli',
      createTransport: () => transport,
      createRequestId: () => 'headless-command-session',
      utilityExitTimeoutMs: 1_000,
    })
    const opened = factory.open()
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'exclusive-headless-owner',
      state: 'ready',
      revision: 4,
    })
    await Promise.resolve()
    transport.respond('status', { ok: true, value: status(4) })
    await Promise.resolve()
    transport.respond('capabilities', {
      ok: true,
      value: createInstalledProfileAgentCapabilities('sqlite'),
    })
    const result = await opened
    if (!result.ok) throw new Error(`Headless lease failed: ${result.message}`)
    const lease = result.value

    const firstRequest = agentRequest(4, 'first')
    const firstApplied = lease.applyAgentCommandBatch(firstRequest)
    await Promise.resolve()
    transport.respond('apply-agent-command-batch', {
      ok: true,
      value: agentReceipt(firstRequest, 5),
    })
    await expect(firstApplied).resolves.toMatchObject({
      ok: true,
      value: { previousRevision: 4, revision: 5, replayed: false },
    })

    const secondRequest = agentRequest(5, 'second')
    const secondApplied = lease.applyAgentCommandBatch(secondRequest)
    await Promise.resolve()
    transport.respond('apply-agent-command-batch', {
      ok: true,
      value: agentReceipt(secondRequest, 6),
    })
    await expect(secondApplied).resolves.toMatchObject({
      ok: true,
      value: { previousRevision: 5, revision: 6, replayed: false },
    })

    const dryRunRequest = agentRequest(6, 'dry-run', true)
    const dryRun = lease.applyAgentCommandBatch(dryRunRequest)
    await Promise.resolve()
    transport.respond('apply-agent-command-batch', {
      ok: true,
      value: agentReceipt(dryRunRequest, 6),
    })
    await expect(dryRun).resolves.toMatchObject({
      ok: true,
      value: { previousRevision: 6, revision: 6, dryRun: true },
    })

    const replay = lease.applyAgentCommandBatch(firstRequest)
    await Promise.resolve()
    transport.respond('apply-agent-command-batch', {
      ok: true,
      value: { ...agentReceipt(firstRequest, 5), replayed: true },
    })
    await expect(replay).resolves.toMatchObject({
      ok: true,
      value: { revision: 5, replayed: true },
    })

    const queried = lease.query({ recordKinds: ['idea'] })
    await Promise.resolve()
    transport.respond('query', {
      ok: true,
      value: {
        profileId: 'profile-headless',
        revision: 6,
        items: [],
        truncated: false,
      },
    })
    await expect(queried).resolves.toMatchObject({ ok: true, value: { revision: 6 } })
  })

  it('terminally rejects future replay and a non-replay whose previous head was not observed', async () => {
    for (const [suffix, request, receipt] of [
      [
        'future-replay',
        agentRequest(4, 'future-replay'),
        { ...agentReceipt(agentRequest(4, 'future-replay'), 5), replayed: true },
      ],
      [
        'mismatched-previous',
        agentRequest(3, 'mismatched-previous'),
        agentReceipt(agentRequest(3, 'mismatched-previous'), 4),
      ],
    ] as const) {
      const transport = new FakeUtilityTransport()
      transport.onKill = () => transport.emit('exit', 1)
      const factory = createInstalledProfileHeadlessLeaseFactory({
        installation: installation(),
        transport: 'cli',
        createTransport: () => transport,
        createRequestId: () => `headless-${suffix}`,
        utilityExitTimeoutMs: 1_000,
      })
      const opened = factory.open()
      transport.emit('message', {
        version: PROFILE_UTILITY_PROTOCOL_VERSION,
        kind: 'ready',
        route: 'exclusive-headless-owner',
        state: 'ready',
        revision: 4,
      })
      await Promise.resolve()
      transport.respond('status', { ok: true, value: status(4) })
      await Promise.resolve()
      transport.respond('capabilities', {
        ok: true,
        value: createInstalledProfileAgentCapabilities('sqlite'),
      })
      const openedResult = await opened
      if (!openedResult.ok) throw new Error(`Headless lease failed: ${openedResult.message}`)

      const applied = openedResult.value.applyAgentCommandBatch(request)
      const failure = expect(applied).rejects.toThrow()
      await Promise.resolve()
      transport.respond('apply-agent-command-batch', { ok: true, value: receipt })
      await failure
      expect(transport.kills).toBe(1)
    }
  })

  it('closes and joins recovery readiness before returning a typed result', async () => {
    const transport = new FakeUtilityTransport()
    const factory = createInstalledProfileHeadlessLeaseFactory({
      installation: installation(),
      transport: 'cli',
      createTransport: () => transport,
      createRequestId: () => 'recovery-session',
      utilityExitTimeoutMs: 1_000,
    })

    const opened = factory.open()
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'ready',
      route: 'exclusive-headless-owner',
      state: 'recovery-required',
      currentRevision: 8,
    })
    await Promise.resolve()
    transport.respond('close', { ok: true, value: { closed: true } })
    let settled = false
    void opened.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    transport.emit('exit', 0)

    await expect(opened).resolves.toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
      currentRevision: 8,
    })
  })

  it('preserves typed existing-only absence after the utility has joined', async () => {
    const transport = new FakeUtilityTransport()
    const factory = createInstalledProfileHeadlessLeaseFactory({
      installation: installation(),
      transport: 'cli',
      createTransport: () => transport,
      createRequestId: () => 'absent-session',
      utilityExitTimeoutMs: 1_000,
    })

    const opened = factory.open()
    transport.emit('message', {
      version: PROFILE_UTILITY_PROTOCOL_VERSION,
      kind: 'fatal',
      failure: profileServiceFailure('not-found'),
    })
    transport.emit('exit', 1)

    await expect(opened).resolves.toMatchObject({ ok: false, code: 'not-found' })
    expect(transport.kills).toBe(1)
  })
})

function installation(): ProfileInstallation {
  const userDataRoot = path.resolve('synthetic-headless-installation')
  return Object.freeze({
    mode: 'proof',
    userDataRoot,
    databasePath: path.join(userDataRoot, 'profiles', 'default', 'eido-profile.sqlite'),
    disposable: true,
  })
}

function status(revision: number): ProfileStatus {
  return {
    profileId: 'profile-headless',
    revision,
    versions: PROFILE_CONTRACT_VERSIONS,
    state: 'ready',
    owner: { mode: 'mutable', route: 'exclusive-headless-owner' },
    dirty: 'clean',
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
}

function agentRequest(
  expectedRevision: number,
  suffix: string,
  dryRun = false,
): ProfileAgentCommandRequest {
  return Object.freeze({
    version: 1,
    schemaVersion: 1,
    expectedRevision,
    idempotencyKey: `agent-key-${suffix}`,
    dryRun,
    commands: Object.freeze([{
      version: 1 as const,
      id: `agent-command-${suffix}`,
      name: 'card.create' as const,
      payload: Object.freeze({
        ideaId: 'idea-main',
        kind: 'note' as const,
        position: Object.freeze({ x: 10, y: 20 }),
        body: suffix,
      }),
    }]),
  })
}

function agentReceipt(
  request: ProfileAgentCommandRequest,
  revision: number,
): ProfileAgentCommandBatchReceipt {
  const dryRun = request.dryRun
  return Object.freeze({
    kind: 'agent-command-batch',
    version: 5,
    previousRevision: request.expectedRevision,
    revision,
    proposedRevision: request.expectedRevision + 1,
    commitId: dryRun ? null : `agent-commit-${request.idempotencyKey}`,
    commandResults: Object.freeze([Object.freeze({
      commandId: request.commands[0]!.id,
      name: 'card.create' as const,
      cardId: `card-${request.idempotencyKey}`,
      blockId: `block-${request.idempotencyKey}`,
      position: Object.freeze({ x: 10, y: 20 }),
    })]),
    effects: Object.freeze({
      inserted: 2,
      updated: 0,
      deleted: 0,
      intentEvents: 1,
      profileAgentEvents: 0,
    }),
    intentEventIds: dryRun ? Object.freeze([]) : Object.freeze([`intent-${request.idempotencyKey}`]),
    profileAgentEventIds: Object.freeze([]),
    dryRun,
    replayed: false,
  })
}

function isRequest(candidate: unknown): candidate is ProfileUtilityRequestMessage {
  return Boolean(candidate
    && typeof candidate === 'object'
    && (candidate as { kind?: unknown }).kind === 'request')
}
