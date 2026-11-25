import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  PROFILE_BRIDGE_CHANNEL,
  PROFILE_BRIDGE_VERSION,
} from './profileBridgeContract'
import { requestRendererProfileCheckpoint } from './profileRendererCheckpoint'

function createHarness() {
  const ipc = new EventEmitter()
  const mainFrame = { url: 'eido://app/' }
  const target = {
    mainFrame,
    send: vi.fn(),
  }
  return { ipc, mainFrame, target }
}

describe('renderer Profile close checkpoint', () => {
  it('correlates one exact owned-frame acknowledgement', async () => {
    const { ipc, mainFrame, target } = createHarness()
    const pending = requestRendererProfileCheckpoint({
      ipc,
      target,
      createToken: () => 'checkpoint-1',
      timeoutMs: 1_000,
    })
    expect(target.send).toHaveBeenCalledWith(PROFILE_BRIDGE_CHANNEL, {
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-request',
      token: 'checkpoint-1',
    })
    ipc.emit(PROFILE_BRIDGE_CHANNEL, { sender: target, senderFrame: mainFrame }, {
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-ack',
      token: 'checkpoint-1',
      ok: true,
      generation: 3,
      nativeGeneration: 2,
      revision: 4,
    })
    await expect(pending).resolves.toMatchObject({ ok: true, revision: 4 })
    expect(ipc.listenerCount(PROFILE_BRIDGE_CHANNEL)).toBe(0)
  })

  it('ignores forged and stale acknowledgements then rejects an exact failure', async () => {
    const { ipc, mainFrame, target } = createHarness()
    const pending = requestRendererProfileCheckpoint({
      ipc,
      target,
      createToken: () => 'checkpoint-2',
      timeoutMs: 1_000,
    })
    ipc.emit(PROFILE_BRIDGE_CHANNEL, { sender: {}, senderFrame: mainFrame }, {
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-ack',
      token: 'checkpoint-2',
      ok: true,
      generation: 1,
      nativeGeneration: 1,
      revision: 1,
    })
    ipc.emit(PROFILE_BRIDGE_CHANNEL, { sender: target, senderFrame: mainFrame }, {
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-ack',
      token: 'stale',
      ok: false,
    })
    ipc.emit(PROFILE_BRIDGE_CHANNEL, { sender: target, senderFrame: mainFrame }, {
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-ack',
      token: 'checkpoint-2',
      ok: false,
    })
    await expect(pending).rejects.toThrow('Renderer Profile checkpoint failed')
  })
})
