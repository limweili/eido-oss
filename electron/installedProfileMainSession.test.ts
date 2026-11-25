import { describe, expect, it, vi } from 'vitest'
import {
  PROFILE_BRIDGE_VERSION,
  type ProfileBridgeRequest,
  type ProfileBridgeResponse,
} from './profileBridgeContract'
import type { InstalledProfileHost } from './installedProfileHost'
import { createInstalledProfileMainSession } from './installedProfileMainSession'
import type { ProfileBridgeEvent, ProfileBridgeWebContents } from './security'

describe('installed Profile main session', () => {
  it('does not publish live Agent authority until the renderer adopts the exact hydration', async () => {
    const fixture = sessionFixture('ready')

    expect(fixture.onRendererAuthorityAdopted).not.toHaveBeenCalled()
    await acknowledgeHydration(fixture)
    expect(fixture.onRendererAuthorityAdopted).toHaveBeenCalledOnce()
  })

  it('routes only the exact owned app frame', async () => {
    const fixture = sessionFixture('ready')
    const request = statusRequest()
    const ownedEvent = eventFor(fixture.target)

    await expect(fixture.session.route(ownedEvent, [request])).resolves.toMatchObject({
      requestId: request.requestId,
      operation: 'status',
      ok: true,
    })
    expect(fixture.host.route).toHaveBeenCalledWith(request)

    const forged = { ...ownedEvent, senderFrame: { url: 'eido://attacker/' } }
    await expect(fixture.session.route(forged, [request])).rejects.toThrow(
      'Profile bridge request was denied',
    )
    expect(fixture.host.route).toHaveBeenCalledTimes(1)
  })

  it('passes only the authoritative native checkpoint pair to one joined shutdown', async () => {
    const fixture = sessionFixture('ready')
    await acknowledgeHydration(fixture)
    expect(fixture.onRendererAuthorityAdopted).toHaveBeenCalledOnce()
    const first = fixture.session.shutdown()
    const second = fixture.session.shutdown()

    expect(first).toBe(second)
    await expect(first).resolves.toMatchObject({ state: 'flushed', generation: 3, revision: 7 })
    expect(fixture.requestCheckpoint).toHaveBeenCalledOnce()
    expect(fixture.host.shutdown).toHaveBeenCalledOnce()
    expect(fixture.host.shutdown).toHaveBeenCalledWith({
      nativeGeneration: 3,
      revision: 7,
    })
  })

  it('skips checkpoints only for untouched recovery startup and arms one after exact hydration ACK', async () => {
    const recovery = sessionFixture('recovery-required')
    await recovery.session.shutdown()
    expect(recovery.requestCheckpoint).not.toHaveBeenCalled()
    expect(recovery.host.shutdown).toHaveBeenCalledWith(undefined)

    const restored = sessionFixture('recovery-required')
    const request = Object.freeze({
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'restore-1',
      operation: 'restore-recovery',
      payload: Object.freeze({ candidateId: 'recovery-1' }),
    }) as ProfileBridgeRequest<'restore-recovery'>
    await restored.session.route(eventFor(restored.target), [request])
    await acknowledgeHydration(restored)
    await restored.session.shutdown()
    expect(restored.requestCheckpoint).toHaveBeenCalledOnce()
    expect(restored.host.shutdown).toHaveBeenCalledWith({ nativeGeneration: 3, revision: 7 })
  })

  it('terminates an unadopted restored authority instead of requesting a false checkpoint', async () => {
    const fixture = sessionFixture('recovery-required')
    const request = Object.freeze({
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'restore-unadopted',
      operation: 'restore-recovery',
      payload: Object.freeze({ candidateId: 'recovery-1' }),
    }) as ProfileBridgeRequest<'restore-recovery'>
    await fixture.session.route(eventFor(fixture.target), [request])

    await expect(fixture.session.shutdown()).rejects.toThrow('never adopted')
    expect(fixture.requestCheckpoint).not.toHaveBeenCalled()
    expect(fixture.host.shutdown).not.toHaveBeenCalled()
    expect(fixture.host.terminate).toHaveBeenCalledOnce()
  })

  it('awaits forced termination when renderer checkpointing fails', async () => {
    const fixture = sessionFixture('ready')
    await acknowledgeHydration(fixture)
    const order: string[] = []
    fixture.requestCheckpoint.mockRejectedValueOnce(new Error('renderer gone'))
    fixture.host.terminate.mockImplementationOnce(async () => {
      await Promise.resolve()
      order.push('terminated')
    })

    await expect(fixture.session.shutdown()).rejects.toThrow('renderer gone')
    order.push('rejected')
    expect(order).toEqual(['terminated', 'rejected'])
    expect(fixture.host.shutdown).not.toHaveBeenCalled()
  })

  it('preserves the checkpoint failure when forced termination also fails', async () => {
    const fixture = sessionFixture('ready')
    await acknowledgeHydration(fixture)
    fixture.requestCheckpoint.mockRejectedValueOnce(new Error('renderer checkpoint failed'))
    fixture.host.terminate.mockRejectedValueOnce(new Error('utility termination failed'))

    await expect(fixture.session.shutdown()).rejects.toThrow('renderer checkpoint failed')
    expect(fixture.host.terminate).toHaveBeenCalledOnce()
    expect(fixture.host.shutdown).not.toHaveBeenCalled()
  })
})

function sessionFixture(state: 'ready' | 'recovery-required') {
  const target: ProfileBridgeWebContents = {
    mainFrame: { url: 'eido://app/?profile-mode=ready' },
  }
  const route = vi.fn(async (request: ProfileBridgeRequest): Promise<ProfileBridgeResponse> => ({
    version: PROFILE_BRIDGE_VERSION,
    requestId: request.requestId,
    operation: request.operation,
    ok: true,
    value: request.operation === 'restore-recovery'
      ? {
          mode: 'restore',
          selectedCandidateId: 'recovery-1',
          rejectedCandidateIds: [],
          quarantinedCurrentState: false,
          previousRevision: 6,
          revision: 7,
        }
      : request.operation === 'ack-hydration'
        ? {
            acknowledged: true,
            epoch: request.payload.epoch,
            revision: request.payload.revision,
          }
        : readyStatus(),
  } as ProfileBridgeResponse))
  const host = {
    startup: state === 'ready'
      ? {
          version: 1,
          kind: 'ready',
          route: 'active-owner',
          state,
          revision: 6,
        }
      : {
          version: 1,
          kind: 'ready',
          route: 'active-owner',
          state,
          currentRevision: 6,
        },
    route,
    openAgentService: vi.fn(() => { throw new Error('Agent service is unused') }),
    pauseAgentAdmission: vi.fn(async () => () => undefined),
    flushForUpdate: vi.fn(async () => ({ state: 'flushed' as const, generation: 3, revision: 7 })),
    shutdown: vi.fn(async () => (
      state === 'ready'
        ? { state: 'flushed' as const, generation: 3, revision: 7 }
        : { state: 'recovery-only' as const, revision: 6 }
    )),
    shutdownForMacosUpdate: vi.fn(async () => ({
      state: 'flushed' as const,
      generation: 3,
      revision: 7,
    })),
    terminate: vi.fn(async () => undefined),
  } satisfies InstalledProfileHost
  const requestCheckpoint = vi.fn(async () => ({
    version: PROFILE_BRIDGE_VERSION,
    kind: 'checkpoint-ack' as const,
    token: 'shutdown-token',
    ok: true as const,
    generation: 19,
    nativeGeneration: 3,
    revision: 7,
  }))
  const onRendererAuthorityAdopted = vi.fn()
  return {
    target,
    host,
    requestCheckpoint,
    onRendererAuthorityAdopted,
    session: createInstalledProfileMainSession({
      host,
      target,
      requestCheckpoint,
      onRendererAuthorityAdopted,
    }),
  }
}

async function acknowledgeHydration(
  fixture: ReturnType<typeof sessionFixture>,
): Promise<void> {
  const request = Object.freeze({
    version: PROFILE_BRIDGE_VERSION,
    requestId: 'ack-hydration-1',
    operation: 'ack-hydration',
    payload: Object.freeze({ epoch: 'epoch-1', revision: 7 }),
  }) as ProfileBridgeRequest<'ack-hydration'>
  await fixture.session.route(eventFor(fixture.target), [request])
}

function eventFor(target: ProfileBridgeWebContents): ProfileBridgeEvent {
  return { sender: target, senderFrame: target.mainFrame }
}

function statusRequest(): ProfileBridgeRequest<'status'> {
  return Object.freeze({
    version: PROFILE_BRIDGE_VERSION,
    requestId: 'status-1',
    operation: 'status',
    payload: Object.freeze({}),
  })
}

function readyStatus() {
  return {
    profileId: 'profile-main',
    revision: 6,
    versions: {
      profile: 1 as const,
      schema: 1 as const,
      record: 1 as const,
      asset: 1 as const,
      app: 1 as const,
      command: 1 as const,
      export: 1 as const,
    },
    state: 'ready' as const,
    owner: { mode: 'mutable' as const, route: 'active-owner' as const },
    dirty: 'clean' as const,
    compatibility: { read: 'supported' as const, write: 'supported' as const, source: 'friends-alpha' as const },
  }
}
