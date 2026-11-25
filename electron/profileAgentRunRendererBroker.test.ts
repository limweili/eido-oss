import { describe, expect, it, vi } from 'vitest'
import { AGENT_RUN_CONTRACT_VERSION } from '../src/brain/agentRunContract'
import {
  createProfileAgentRunWireResponse,
  PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
  type ProfileAgentRunWireRequest,
} from './profileAgentRunBridgeContract'
import { createProfileAgentRunRendererBroker } from './profileAgentRunRendererBroker'

const actor = Object.freeze({
  kind: 'agent' as const,
  client: 'codex',
  sessionId: 'authenticated-live-session',
})

describe('Profile Agent run main-to-renderer broker', () => {
  it('injects authenticated actor identity and settles only an exact trusted token/operation response', async () => {
    const ipc = new FakeIpc()
    const target = rendererTarget()
    const broker = createProfileAgentRunRendererBroker({
      ipc,
      target,
      createToken: () => 'run-request-1',
    })

    let settled = false
    const pending = broker.dispatch(actor, 'run.submit', {
      ideaId: 'idea-live',
      targetCardId: 'ask-live',
    })
    void pending.then(() => { settled = true })

    expect(target.send).toHaveBeenCalledWith(
      PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
      expect.objectContaining({
        token: 'run-request-1',
        actor,
        operation: 'run.submit',
        payload: { ideaId: 'idea-live', targetCardId: 'ask-live' },
      }),
    )
    const request = target.send.mock.calls[0]![1] as ProfileAgentRunWireRequest
    expect(request.payload).not.toHaveProperty('actor')
    expect(request.payload).not.toHaveProperty('provider')
    expect(request.payload).not.toHaveProperty('credentials')

    const success = createProfileAgentRunWireResponse('run-request-1', 'run.submit', {
      ok: true,
      value: {
        version: AGENT_RUN_CONTRACT_VERSION,
        runId: 'agent-run-1',
        ideaId: 'idea-live',
        targetCardId: 'ask-live',
        actor,
        status: 'queued',
        submittedAt: '2026-07-22T01:00:00.000Z',
        plannedStepIds: ['ask-live'],
        reusedStepIds: [],
      },
    })

    ipc.emit({ sender: {}, senderFrame: target.mainFrame }, success)
    ipc.emit(
      { sender: target, senderFrame: target.mainFrame },
      createProfileAgentRunWireResponse('run-request-1', 'run.status', {
        ok: false,
        code: 'internal',
        retryable: true,
        message: 'The agent run did not complete.',
      }),
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    ipc.emit({ sender: target, senderFrame: target.mainFrame }, success)
    await expect(pending).resolves.toEqual(success.result)
    broker.close()
  })

  it('bounds pending work and contains timeout without replaying a renderer request', async () => {
    vi.useFakeTimers()
    try {
      const ipc = new FakeIpc()
      const target = rendererTarget()
      let sequence = 0
      const broker = createProfileAgentRunRendererBroker({
        ipc,
        target,
        createToken: () => `run-request-${++sequence}`,
        timeoutMs: 1_000,
        maxPendingRequests: 1,
      })

      const first = broker.dispatch(actor, 'run.status', { runId: 'agent-run-1' })
      await expect(broker.dispatch(actor, 'run.status', { runId: 'agent-run-2' }))
        .resolves.toMatchObject({ ok: false, code: 'internal' })
      expect(target.send).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1_000)
      await expect(first).resolves.toMatchObject({ ok: false, code: 'internal' })
      expect(target.send).toHaveBeenCalledTimes(1)
      broker.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks a timed-out submit as outcome-ambiguous and non-retryable', async () => {
    vi.useFakeTimers()
    try {
      const ipc = new FakeIpc()
      const target = rendererTarget()
      const broker = createProfileAgentRunRendererBroker({
        ipc,
        target,
        createToken: () => 'ambiguous-submit',
        timeoutMs: 1_000,
      })

      const submitted = broker.dispatch(actor, 'run.submit', {
        ideaId: 'idea-live',
        targetCardId: 'ask-live',
      })
      await vi.advanceTimersByTimeAsync(1_000)

      await expect(submitted).resolves.toEqual({
        ok: false,
        code: 'internal',
        retryable: false,
        message: 'The agent run submission outcome is unknown. Do not retry this submission.',
      })
      expect(target.send).toHaveBeenCalledTimes(1)
      broker.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('contains successful replies that do not correlate to the authenticated request', async () => {
    const ipc = new FakeIpc()
    const target = rendererTarget()
    let sequence = 0
    const broker = createProfileAgentRunRendererBroker({
      ipc,
      target,
      createToken: () => `semantic-correlation-${++sequence}`,
    })

    const submitted = broker.dispatch(actor, 'run.submit', {
      ideaId: 'idea-live',
      targetCardId: 'ask-live',
    })
    ipc.emit(
      { sender: target, senderFrame: target.mainFrame },
      createProfileAgentRunWireResponse('semantic-correlation-1', 'run.submit', {
        ok: true,
        value: {
          version: AGENT_RUN_CONTRACT_VERSION,
          runId: 'agent-run-other',
          ideaId: 'idea-other',
          targetCardId: 'ask-live',
          actor,
          status: 'queued',
          submittedAt: '2026-07-22T01:00:00.000Z',
          plannedStepIds: ['ask:ask-live'],
          reusedStepIds: [],
        },
      }),
    )
    await expect(submitted).resolves.toMatchObject({
      ok: false,
      code: 'internal',
      retryable: false,
      message: expect.stringContaining('outcome is unknown'),
    })

    const status = broker.dispatch(actor, 'run.status', { runId: 'agent-run-expected' })
    ipc.emit(
      { sender: target, senderFrame: target.mainFrame },
      createProfileAgentRunWireResponse('semantic-correlation-2', 'run.status', {
        ok: true,
        value: {
          version: AGENT_RUN_CONTRACT_VERSION,
          runId: 'agent-run-other',
          ideaId: 'idea-live',
          targetCardId: 'ask-live',
          actor,
          status: 'done',
          submittedAt: '2026-07-22T01:00:00.000Z',
          finishedAt: '2026-07-22T01:00:01.000Z',
          plannedStepIds: ['ask:ask-live'],
          executedStepIds: ['ask:ask-live'],
          reusedStepIds: [],
          artifactCount: 1,
        },
      }),
    )
    await expect(status).resolves.toMatchObject({ ok: false, code: 'internal' })
    broker.close()
  })

  it('tears down accepted and future work with the canonical live-app refusal', async () => {
    const ipc = new FakeIpc()
    const target = rendererTarget()
    let sequence = 0
    const broker = createProfileAgentRunRendererBroker({
      ipc,
      target,
      createToken: () => `run-request-${++sequence}`,
    })

    const accepted = broker.dispatch(actor, 'run.read', { runId: 'agent-run-1' })
    const acceptedSubmit = broker.dispatch(actor, 'run.submit', {
      ideaId: 'idea-live',
      targetCardId: 'ask-live',
    })
    broker.close()

    await expect(accepted).resolves.toMatchObject({
      ok: false,
      code: 'live-app-required',
      message: 'Open Eido to run AI. Headless agent runs are not available.',
    })
    await expect(acceptedSubmit).resolves.toMatchObject({
      ok: false,
      code: 'internal',
      retryable: false,
      message: expect.stringContaining('outcome is unknown'),
    })
    await expect(broker.dispatch(actor, 'run.status', { runId: 'agent-run-1' }))
      .resolves.toMatchObject({ ok: false, code: 'live-app-required' })
    expect(ipc.listenerCount()).toBe(0)
  })
})

type TestEvent = Readonly<{
  sender: unknown
  senderFrame: Readonly<{ url: string }> | null
}>

class FakeIpc {
  private readonly listeners = new Set<(event: TestEvent, ...args: unknown[]) => void>()

  on(
    channel: typeof PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
    listener: (event: TestEvent, ...args: unknown[]) => void,
  ): void {
    expect(channel).toBe(PROFILE_AGENT_RUN_BRIDGE_CHANNEL)
    this.listeners.add(listener)
  }

  removeListener(
    channel: typeof PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
    listener: (event: TestEvent, ...args: unknown[]) => void,
  ): void {
    expect(channel).toBe(PROFILE_AGENT_RUN_BRIDGE_CHANNEL)
    this.listeners.delete(listener)
  }

  emit(event: TestEvent, candidate: unknown): void {
    for (const listener of this.listeners) listener(event, candidate)
  }

  listenerCount(): number {
    return this.listeners.size
  }
}

function rendererTarget() {
  const mainFrame = Object.freeze({ url: 'eido://app/' })
  return Object.assign({ mainFrame }, {
    send: vi.fn((_channel: typeof PROFILE_AGENT_RUN_BRIDGE_CHANNEL, _candidate: unknown) => {}),
  })
}
