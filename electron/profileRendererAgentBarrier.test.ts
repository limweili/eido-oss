import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  PROFILE_BRIDGE_CHANNEL,
  PROFILE_BRIDGE_VERSION,
} from './profileBridgeContract'
import { requestRendererProfileAgentBarrier } from './profileRendererAgentBarrier'

describe('renderer Profile Agent barrier coordinator', () => {
  it('retries an exact failed completion and admits the next globally serialized barrier', async () => {
    const ipc = new EventEmitter()
    const mainFrame = { url: 'eido://app/' }
    let completeAttempts = 0
    const target = {
      mainFrame,
      send: vi.fn((_channel: string, candidate: unknown) => {
        const request = candidate as { token: string; phase: string; revision?: number }
        const common = {
          version: PROFILE_BRIDGE_VERSION,
          kind: 'agent-barrier-ack',
          token: request.token,
          phase: request.phase,
        }
        if (request.phase === 'begin') {
          ipc.emit(PROFILE_BRIDGE_CHANNEL, { sender: target, senderFrame: mainFrame }, {
            ...common,
            ok: true,
            generation: 3,
            nativeGeneration: 2,
            revision: 7,
          })
        } else if (request.phase === 'complete') {
          completeAttempts += 1
          ipc.emit(PROFILE_BRIDGE_CHANNEL, { sender: target, senderFrame: mainFrame }, {
            ...common,
            ok: completeAttempts > 1,
          })
        } else {
          ipc.emit(PROFILE_BRIDGE_CHANNEL, { sender: target, senderFrame: mainFrame }, {
            ...common,
            ok: true,
          })
        }
      }),
    }
    const tokens = ['barrier-one', 'barrier-two'][Symbol.iterator]()

    const first = await requestRendererProfileAgentBarrier({
      ipc,
      target,
      createToken: () => tokens.next().value!,
    })
    const firstCompletion = first.complete(8)
    const joinedCompletion = first.complete(8)
    await expect(firstCompletion).resolves.toBeUndefined()
    await expect(joinedCompletion).resolves.toBeUndefined()
    expect(completeAttempts).toBe(2)

    const second = await requestRendererProfileAgentBarrier({
      ipc,
      target,
      createToken: () => tokens.next().value!,
    })
    await expect(second.cancel()).resolves.toBeUndefined()
    expect(second.checkpoint).toEqual({ generation: 3, nativeGeneration: 2, revision: 7 })
    expect(ipc.listenerCount(PROFILE_BRIDGE_CHANNEL)).toBe(0)
  })

  it('retries the exact terminal seal and removes acknowledgement listeners', async () => {
    const ipc = new EventEmitter()
    const mainFrame = { url: 'eido://app/' }
    let seals = 0
    const target = {
      mainFrame,
      send: vi.fn((_channel: string, candidate: unknown) => {
        const request = candidate as { token: string; phase: string }
        const common = {
          version: PROFILE_BRIDGE_VERSION,
          kind: 'agent-barrier-ack',
          token: request.token,
          phase: request.phase,
        }
        if (request.phase === 'begin') {
          ipc.emit(PROFILE_BRIDGE_CHANNEL, { sender: target, senderFrame: mainFrame }, {
            ...common, ok: true, generation: 3, nativeGeneration: 2, revision: 7,
          })
        } else if (request.phase === 'seal') {
          seals += 1
          ipc.emit(PROFILE_BRIDGE_CHANNEL, { sender: target, senderFrame: mainFrame }, seals === 1
            ? { ...common, ok: false }
            : { ...common, ok: true, generation: 4, nativeGeneration: 3, revision: 8 })
        }
      }),
    }
    const barrier = await requestRendererProfileAgentBarrier({
      ipc,
      target,
      createToken: () => 'seal-retry',
    })

    await expect(barrier.sealForTerminalDrain()).resolves.toEqual({
      generation: 4,
      nativeGeneration: 3,
      revision: 8,
    })
    expect(seals).toBe(2)
    expect(ipc.listenerCount(PROFILE_BRIDGE_CHANNEL)).toBe(0)
  })

  it('proves cancellation before reporting a lost begin acknowledgement recoverable', async () => {
    vi.useFakeTimers()
    try {
      const ipc = new EventEmitter()
      const mainFrame = { url: 'eido://app/' }
      const target = {
        mainFrame,
        send: vi.fn((_channel: string, candidate: unknown) => {
          const request = candidate as { token: string; phase: string }
          if (request.phase !== 'cancel') return
          ipc.emit(PROFILE_BRIDGE_CHANNEL, { sender: target, senderFrame: mainFrame }, {
            version: PROFILE_BRIDGE_VERSION,
            kind: 'agent-barrier-ack',
            token: request.token,
            phase: request.phase,
            ok: true,
          })
        }),
      }
      const acquisition = requestRendererProfileAgentBarrier({
        ipc,
        target,
        createToken: () => 'lost-begin-ack',
        timeoutMs: 5,
      })
      const observed = acquisition.catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(6)

      await expect(observed).resolves.toMatchObject({
        message: 'Renderer Profile Agent barrier begin timed out',
      })
      expect(target.send).toHaveBeenCalledWith(PROFILE_BRIDGE_CHANNEL, expect.objectContaining({
        token: 'lost-begin-ack', phase: 'cancel',
      }))
      expect(ipc.listenerCount(PROFILE_BRIDGE_CHANNEL)).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
