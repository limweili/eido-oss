import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createInstalledProfileHost } from './installedProfileHost'
import { MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY } from './installedProfileRouter'
import type { ProfileUtilityTerminalLoss } from './profileUtilityClient'
import {
  PROFILE_UTILITY_PROTOCOL_VERSION,
} from './profileUtilityProtocol'

const routerFakes = vi.hoisted(() => ({
  shutdown: vi.fn(),
}))

vi.mock('./installedProfileRouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./installedProfileRouter')>()
  const createInstalledProfileRouter = vi.fn(async (
    options: Parameters<typeof actual.createInstalledProfileRouter>[0],
  ) => Object.freeze({
    route: vi.fn(),
    openAgentService: vi.fn(),
    pauseAgentAdmission: vi.fn(),
    flushForUpdate: vi.fn(),
    shutdown: (
      checkpoint: Parameters<typeof routerFakes.shutdown>[0],
      capability: Parameters<typeof routerFakes.shutdown>[1],
    ) => (
      routerFakes.shutdown(options, checkpoint, capability)
    ),
  }))
  return {
    ...actual,
    createInstalledProfileRouter:
      createInstalledProfileRouter as unknown as typeof actual.createInstalledProfileRouter,
  }
})

class FakeProfileUtilityTransport extends EventEmitter {
  readonly sent: unknown[] = []
  kills = 0

  postMessage(message: unknown): void {
    this.sent.push(message)
  }

  kill(): boolean {
    this.kills += 1
    this.emit('exit', 0)
    return true
  }
}

describe('installed Profile host', () => {
  it('withdraws external terminal-loss forwarding during router-owned shutdown termination', async () => {
    const transport = new FakeProfileUtilityTransport()
    const onTerminalLoss = vi.fn()
    const hostPromise = createHost(transport, onTerminalLoss)
    emitReady(transport)
    const host = await hostPromise
    routerFakes.shutdown.mockImplementationOnce(async (routerOptions, _checkpoint, capability) => {
      expect(capability).toBe(MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY)
      routerOptions.onShutdownUtilityTerminationRequested?.()
      transport.emit('exit', 0)
      return { state: 'flushed', generation: 3, revision: 7 }
    })

    await expect(host.shutdownForMacosUpdate({ nativeGeneration: 3, revision: 7 }))
      .resolves.toEqual({
        state: 'flushed',
        generation: 3,
        revision: 7,
      })

    expect(onTerminalLoss).not.toHaveBeenCalled()
  })

  it('does not supply the macOS update fallback capability to ordinary shutdown', async () => {
    const transport = new FakeProfileUtilityTransport()
    const hostPromise = createHost(transport, vi.fn())
    emitReady(transport)
    const host = await hostPromise
    routerFakes.shutdown.mockResolvedValueOnce({ state: 'flushed', generation: 2, revision: 5 })

    await expect(host.shutdown({ nativeGeneration: 2, revision: 5 })).resolves.toEqual({
      state: 'flushed',
      generation: 2,
      revision: 5,
    })

    expect(routerFakes.shutdown).toHaveBeenLastCalledWith(
      expect.any(Object),
      { nativeGeneration: 2, revision: 5 },
      undefined,
    )
  })

  it('withdraws external terminal-loss forwarding before intentional termination', async () => {
    const transport = new FakeProfileUtilityTransport()
    const onTerminalLoss = vi.fn()
    const hostPromise = createHost(transport, onTerminalLoss)
    emitReady(transport)
    const host = await hostPromise

    await expect(host.terminate()).resolves.toBeUndefined()

    expect(transport.kills).toBe(1)
    expect(onTerminalLoss).not.toHaveBeenCalled()
  })

  it('still forwards unexpected terminal loss after startup', async () => {
    const transport = new FakeProfileUtilityTransport()
    const onTerminalLoss = vi.fn()
    const hostPromise = createHost(transport, onTerminalLoss)
    emitReady(transport)
    const host = await hostPromise

    transport.emit('exit', 17)

    expect(onTerminalLoss).toHaveBeenCalledOnce()
    expect(onTerminalLoss).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'ready',
      error: expect.objectContaining({
        message: 'Profile utility exited with code 17',
      }),
    }))
    await expect(host.terminate()).resolves.toBeUndefined()
  })
})

function createHost(
  transport: FakeProfileUtilityTransport,
  onTerminalLoss: (loss: ProfileUtilityTerminalLoss) => void,
) {
  return createInstalledProfileHost({
    transport,
    initialize: {
      route: 'active-owner',
      databasePath: '/synthetic/profiles/default/eido-profile.sqlite',
      portableTempRoot: '/synthetic/portable',
    },
    trustedActorId: 'eido-desktop-gui',
    createRequestId: () => 'installed-host-test',
    createIdentity: () => ({
      clientTxnId: 'client-txn',
      idempotencyKey: 'idempotency-key',
      committedAt: '2026-07-23T00:00:00.000Z',
    }),
    createHydrationEpoch: () => 'hydration-epoch',
    onTerminalLoss,
    utilityReadyTimeoutMs: 1_000,
    utilityExitTimeoutMs: 1_000,
  })
}

function emitReady(transport: FakeProfileUtilityTransport): void {
  transport.emit('message', {
    version: PROFILE_UTILITY_PROTOCOL_VERSION,
    kind: 'ready',
    route: 'active-owner',
    state: 'ready',
    revision: 0,
  })
}
