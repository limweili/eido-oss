import { describe, expect, it, vi } from 'vitest'
import type { AgentRunExecutionRequest } from '../brain/agentRunSession'
import type { AgentRunExecutorOutcome } from '../brain/agentRunExecutor'
import {
  AGENT_RUN_CREDENTIAL_UNAVAILABLE_MESSAGE,
  AGENT_RUN_PERSISTENCE_FAILED_MESSAGE,
  createAgentRunExecutionAdapter,
} from './agentRunExecutionAdapter'

const request = Object.freeze({
  runId: 'agent-run-1',
  ideaId: 'idea-1',
  targetCardId: 'ask-1',
  actor: Object.freeze({ kind: 'agent' as const, client: 'codex', sessionId: 'session-1' }),
  admission: Object.freeze({ ok: true }) as AgentRunExecutionRequest['admission'],
})

function outcome(
  overrides: Partial<AgentRunExecutorOutcome> = {},
): AgentRunExecutorOutcome {
  return Object.freeze({
    status: 'done',
    executedStepIds: Object.freeze(['ask:ask-1']),
    reusedStepIds: Object.freeze([]),
    artifacts: Object.freeze([
      Object.freeze({ kind: 'run-record' as const, recordId: 'run-1', cardId: 'ask-1' }),
    ]),
    ...overrides,
  })
}

describe('Agent Run execution adapter', () => {
  it('returns a safe actionable message when Eido has no usable provider credential', async () => {
    const adapter = createAgentRunExecutionAdapter({
      runner: {
        execute: vi.fn(async () => outcome({
          status: 'failed',
          failure: 'credential-unavailable',
          artifacts: [],
        })),
        cancelActive: vi.fn(),
      },
      flush: vi.fn(async () => undefined),
    })

    await expect(adapter(request)).resolves.toMatchObject({
      status: 'failed',
      error: AGENT_RUN_CREDENTIAL_UNAVAILABLE_MESSAGE,
      artifacts: [],
    })
  })

  it('serializes the deep operation and flushes its exact partial terminal artifacts', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const execute = vi.fn()
      .mockImplementationOnce(async () => {
        await firstGate
        return outcome({
          status: 'failed',
          failure: 'plan-changed',
        })
      })
      .mockResolvedValueOnce(outcome())
    const flush = vi.fn(async () => undefined)
    const adapter = createAgentRunExecutionAdapter({
      runner: { execute, cancelActive: vi.fn() },
      flush,
    })

    const first = adapter(request)
    const second = adapter({ ...request, runId: 'agent-run-2' })
    await Promise.resolve()
    expect(execute).toHaveBeenCalledTimes(1)
    releaseFirst()

    await expect(first).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('changed'),
      artifacts: [{ kind: 'run-record', recordId: 'run-1' }],
    })
    await expect(second).resolves.toMatchObject({ status: 'done' })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('delegates cancellation and does not advertise artifacts when persistence fails', async () => {
    const cancelActive = vi.fn()
    const adapter = createAgentRunExecutionAdapter({
      runner: { execute: vi.fn(async () => outcome()), cancelActive },
      flush: vi.fn(async () => { throw new Error('private storage detail') }),
    })

    const pending = adapter(request)
    adapter.cancelActive()
    await adapter.drain()

    expect(cancelActive).toHaveBeenCalledOnce()
    await expect(pending).resolves.toEqual({
      status: 'failed',
      executedStepIds: ['ask:ask-1'],
      reusedStepIds: [],
      artifacts: [],
      error: AGENT_RUN_PERSISTENCE_FAILED_MESSAGE,
    })
  })
})
