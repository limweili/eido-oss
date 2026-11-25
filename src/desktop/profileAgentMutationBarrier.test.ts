import { describe, expect, it, vi } from 'vitest'
import type { ProfileSnapshot } from '../persistence/profileServiceContract'
import {
  PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT,
  PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT,
  type InstalledProfileBridge,
  type ProfileRendererAgentBarrierAck,
} from '../../electron/profileBridgeContract'
import { registerProfileAgentMutationBarrierHandler } from './profileAgentMutationBarrier'

class TestCustomEvent<Value> extends Event {
  constructor(type: string, readonly detail: Value) {
    super(type)
  }
}

describe('Profile Agent mutation barrier handler', () => {
  it('freezes renderer mutation before capturing an exact terminal seal', async () => {
    const target = new EventTarget()
    const order: string[] = []
    let frozen = false
    let captures = 0
    const persistence = {
      beginAuthoritativeMutation: vi.fn(async () => ({
        generation: 3, nativeGeneration: 2, revision: 7,
      })),
      sealAuthoritativeMutation: vi.fn(async () => {
        order.push('persist-seal')
        expect(frozen).toBe(true)
        return { generation: 4, nativeGeneration: 3, revision: 8 }
      }),
      applyAuthoritativeSnapshot: vi.fn(),
      finishAuthoritativeMutation: vi.fn(async () => ({
        generation: 4, nativeGeneration: 3, revision: 8,
      })),
    }
    const acknowledgements: ProfileRendererAgentBarrierAck[] = []
    registerProfileAgentMutationBarrierHandler(
      target,
      {} as InstalledProfileBridge,
      persistence,
      () => {
        order.push('capture')
        captures += 1
        expect(frozen).toBe(captures > 1)
        return {} as never
      },
      {
        freezeMutationAdmission: () => {
          order.push('freeze')
          frozen = true
        },
      },
    )
    target.addEventListener(PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT, (event) => {
      acknowledgements.push((event as CustomEvent<ProfileRendererAgentBarrierAck>).detail)
    })
    dispatch(target, { token: 'update-seal', phase: 'begin' })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual(expect.objectContaining({
      token: 'update-seal', phase: 'begin', ok: true,
    })))

    dispatch(target, { token: 'update-seal', phase: 'seal' })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual({
      token: 'update-seal',
      phase: 'seal',
      ok: true,
      generation: 4,
      nativeGeneration: 3,
      revision: 8,
    }))
    dispatch(target, { token: 'update-seal', phase: 'seal' })
    await vi.waitFor(() => expect(acknowledgements.filter((ack) => (
      ack.token === 'update-seal' && ack.phase === 'seal' && ack.ok
    ))).toHaveLength(2))

    expect(order).toEqual(['capture', 'freeze', 'capture', 'persist-seal'])
    expect(persistence.sealAuthoritativeMutation).toHaveBeenCalledOnce()
  })

  it('resumes exact completion after ACK failure and releases the next barrier', async () => {
    const target = new EventTarget()
    const snapshot = { revision: 8 } as ProfileSnapshot
    const order: string[] = []
    let ackAttempts = 0
    const bridge = {
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: {
          intentActorId: 'desktop-owner',
          snapshot,
          acknowledgement: { epoch: 'agent-epoch-8', revision: 8 },
        },
      })),
      ackHydration: vi.fn(async () => {
        ackAttempts += 1
        order.push(`ack:${ackAttempts}`)
        return ackAttempts === 1
          ? { ok: false as const, code: 'internal' as const, message: 'retry' }
          : {
              ok: true as const,
              value: { acknowledged: true as const, epoch: 'agent-epoch-8', revision: 8 },
            }
      }),
    } as unknown as InstalledProfileBridge
    const persistence = {
      beginAuthoritativeMutation: vi.fn(async () => {
        order.push('begin')
        return { generation: 2, nativeGeneration: 1, revision: 7 }
      }),
      sealAuthoritativeMutation: vi.fn(async () => ({
        generation: 2, nativeGeneration: 1, revision: 7,
      })),
      applyAuthoritativeSnapshot: vi.fn(() => {
        order.push('apply')
        return { status: 'applied' as const, revision: 8 }
      }),
      finishAuthoritativeMutation: vi.fn(async () => {
        order.push('finish')
        return { generation: 3, nativeGeneration: 1, revision: 9 }
      }),
    }
    const acknowledgements: ProfileRendererAgentBarrierAck[] = []
    target.addEventListener(PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT, (event) => {
      acknowledgements.push((event as CustomEvent<ProfileRendererAgentBarrierAck>).detail)
    })
    const onTerminalFailure = vi.fn()
    registerProfileAgentMutationBarrierHandler(
      target,
      bridge,
      persistence,
      () => ({}) as never,
      { onTerminalFailure, waitForRetry: async () => undefined },
    )

    dispatch(target, { token: 'barrier-one', phase: 'begin' })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual({
      token: 'barrier-one',
      phase: 'begin',
      ok: true,
      generation: 2,
      nativeGeneration: 1,
      revision: 7,
    }))
    dispatch(target, { token: 'barrier-one', phase: 'complete', revision: 8 })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual({
      token: 'barrier-one', phase: 'complete', ok: false,
    }))
    dispatch(target, { token: 'barrier-one', phase: 'complete', revision: 8 })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual({
      token: 'barrier-one', phase: 'complete', ok: true,
    }))

    expect(order).toEqual(['begin', 'apply', 'ack:1', 'ack:2', 'finish'])
    expect(bridge.hydrate).toHaveBeenCalledOnce()
    expect(persistence.applyAuthoritativeSnapshot).toHaveBeenCalledOnce()
    expect(onTerminalFailure).not.toHaveBeenCalled()

    dispatch(target, { token: 'barrier-two', phase: 'begin' })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual(expect.objectContaining({
      token: 'barrier-two', phase: 'begin', ok: true,
    })))
    dispatch(target, { token: 'barrier-two', phase: 'cancel' })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual({
      token: 'barrier-two', phase: 'cancel', ok: true,
    }))
    expect(persistence.finishAuthoritativeMutation).toHaveBeenCalledTimes(2)
  })

  it('latches cancellation while a timed-out begin is still draining renderer work', async () => {
    const target = new EventTarget()
    const began = deferred<{ generation: number; nativeGeneration: number; revision: number }>()
    const acknowledgements: ProfileRendererAgentBarrierAck[] = []
    const persistence = {
      beginAuthoritativeMutation: vi.fn(() => began.promise),
      sealAuthoritativeMutation: vi.fn(async () => ({
        generation: 3, nativeGeneration: 2, revision: 7,
      })),
      applyAuthoritativeSnapshot: vi.fn(),
      finishAuthoritativeMutation: vi.fn(async () => ({
        generation: 4,
        nativeGeneration: 2,
        revision: 7,
      })),
    }
    const onTerminalFailure = vi.fn()
    registerProfileAgentMutationBarrierHandler(
      target,
      {} as InstalledProfileBridge,
      persistence,
      () => ({}) as never,
      { onTerminalFailure },
    )
    target.addEventListener(PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT, (event) => {
      acknowledgements.push((event as CustomEvent<ProfileRendererAgentBarrierAck>).detail)
    })

    dispatch(target, { token: 'late-begin', phase: 'begin' })
    dispatch(target, { token: 'late-begin', phase: 'cancel' })
    expect(persistence.finishAuthoritativeMutation).not.toHaveBeenCalled()

    began.resolve({ generation: 3, nativeGeneration: 2, revision: 7 })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual({
      token: 'late-begin', phase: 'cancel', ok: true,
    }))
    expect(persistence.finishAuthoritativeMutation).toHaveBeenCalledOnce()
    expect(acknowledgements).toContainEqual({
      token: 'late-begin',
      phase: 'begin',
      ok: true,
      generation: 3,
      nativeGeneration: 2,
      revision: 7,
    })
    expect(onTerminalFailure).not.toHaveBeenCalled()
  })

  it('joins concurrent exact completion, replays a lost final ACK, and terminalizes active disposal', async () => {
    const target = new EventTarget()
    const finish = deferred<void>()
    const acknowledgements: ProfileRendererAgentBarrierAck[] = []
    const onTerminalFailure = vi.fn()
    const bridge = {
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: {
          intentActorId: 'desktop-owner',
          snapshot: { revision: 8 } as ProfileSnapshot,
          acknowledgement: { epoch: 'joined-epoch', revision: 8 },
        },
      })),
      ackHydration: vi.fn(async () => ({
        ok: true as const,
        value: { acknowledged: true as const, epoch: 'joined-epoch', revision: 8 },
      })),
    } as unknown as InstalledProfileBridge
    const persistence = {
      beginAuthoritativeMutation: vi.fn(async () => ({
        generation: 1, nativeGeneration: 0, revision: 7,
      })),
      sealAuthoritativeMutation: vi.fn(async () => ({
        generation: 1, nativeGeneration: 0, revision: 7,
      })),
      applyAuthoritativeSnapshot: vi.fn(() => ({ status: 'applied' as const, revision: 8 })),
      finishAuthoritativeMutation: vi.fn(async () => {
        await finish.promise
        return { generation: 2, nativeGeneration: 1, revision: 9 }
      }),
    }
    const dispose = registerProfileAgentMutationBarrierHandler(
      target,
      bridge,
      persistence,
      () => ({}) as never,
      { onTerminalFailure },
    )
    target.addEventListener(PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT, (event) => {
      acknowledgements.push((event as CustomEvent<ProfileRendererAgentBarrierAck>).detail)
    })

    dispatch(target, { token: 'joined', phase: 'begin' })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual(expect.objectContaining({
      token: 'joined', phase: 'begin', ok: true,
    })))
    dispatch(target, { token: 'joined', phase: 'complete', revision: 8 })
    dispatch(target, { token: 'joined', phase: 'complete', revision: 8 })
    await vi.waitFor(() => expect(persistence.finishAuthoritativeMutation).toHaveBeenCalledOnce())
    finish.resolve()
    await vi.waitFor(() => expect(acknowledgements).toContainEqual({
      token: 'joined', phase: 'complete', ok: true,
    }))
    const successCount = acknowledgements.filter(ack => (
      ack.token === 'joined' && ack.phase === 'complete' && ack.ok
    )).length

    // The first final ACK may be lost in transport; exact replay is side-effect free.
    dispatch(target, { token: 'joined', phase: 'complete', revision: 8 })
    await vi.waitFor(() => expect(acknowledgements.filter(ack => (
      ack.token === 'joined' && ack.phase === 'complete' && ack.ok
    ))).toHaveLength(successCount + 1))
    expect(bridge.hydrate).toHaveBeenCalledOnce()
    expect(bridge.ackHydration).toHaveBeenCalledOnce()
    expect(persistence.applyAuthoritativeSnapshot).toHaveBeenCalledOnce()
    expect(persistence.finishAuthoritativeMutation).toHaveBeenCalledOnce()

    dispatch(target, { token: 'abandoned', phase: 'begin' })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual(expect.objectContaining({
      token: 'abandoned', phase: 'begin', ok: true,
    })))
    dispose()
    expect(onTerminalFailure).toHaveBeenCalledOnce()
  })

  it('holds a live execution lease until authoritative completion is released', async () => {
    const target = new EventTarget()
    const order: string[] = []
    const bridge = {
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: {
          intentActorId: 'desktop-owner',
          snapshot: { revision: 8 } as ProfileSnapshot,
          acknowledgement: { epoch: 'lease-epoch', revision: 8 },
        },
      })),
      ackHydration: vi.fn(async () => ({
        ok: true as const,
        value: { acknowledged: true as const, epoch: 'lease-epoch', revision: 8 },
      })),
    } as unknown as InstalledProfileBridge
    const persistence = {
      beginAuthoritativeMutation: vi.fn(async () => {
        order.push('begin')
        return { generation: 1, nativeGeneration: 0, revision: 7 }
      }),
      sealAuthoritativeMutation: vi.fn(async () => ({
        generation: 1, nativeGeneration: 0, revision: 7,
      })),
      applyAuthoritativeSnapshot: vi.fn(() => {
        order.push('apply')
        return { status: 'applied' as const, revision: 8 }
      }),
      finishAuthoritativeMutation: vi.fn(async () => {
        order.push('finish')
        return { generation: 2, nativeGeneration: 1, revision: 8 }
      }),
    }
    let held = false
    registerProfileAgentMutationBarrierHandler(
      target,
      bridge,
      persistence,
      () => ({}) as never,
      {
        acquireExecutionLease: async () => {
          expect(held).toBe(false)
          held = true
          order.push('lease')
          return () => {
            expect(held).toBe(true)
            held = false
            order.push('release')
          }
        },
      },
    )
    const acknowledgements: ProfileRendererAgentBarrierAck[] = []
    target.addEventListener(PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT, (event) => {
      acknowledgements.push((event as CustomEvent<ProfileRendererAgentBarrierAck>).detail)
    })

    dispatch(target, { token: 'leased', phase: 'begin' })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual(expect.objectContaining({
      token: 'leased', phase: 'begin', ok: true,
    })))
    expect(held).toBe(true)
    dispatch(target, { token: 'leased', phase: 'complete', revision: 8 })
    await vi.waitFor(() => expect(acknowledgements).toContainEqual({
      token: 'leased', phase: 'complete', ok: true,
    }))

    expect(held).toBe(false)
    expect(order).toEqual(['lease', 'begin', 'apply', 'finish', 'release'])
  })
})

function dispatch(target: EventTarget, detail: unknown): void {
  target.dispatchEvent(new TestCustomEvent(PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT, detail))
}

function deferred<Value = void>(): Readonly<{
  promise: Promise<Value>
  resolve(value: Value): void
}> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}
