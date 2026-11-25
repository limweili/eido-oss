import { describe, expect, it, vi } from 'vitest'
import {
  createProfileAgentRunWireRequest,
} from '../../electron/profileAgentRunBridgeContract'
import { AGENT_RUN_LIVE_REQUIRED_MESSAGE } from '../brain/agentRunContract'
import { makeSavedBoard } from '../graph/save'
import type { AgentRunAttribution, Card, SavedBoard } from '../graph/types'
import { createProfileAgentRunRendererService } from './profileAgentRunRendererService'

const submitter = Object.freeze({
  kind: 'agent' as const,
  client: 'eido-cli',
  sessionId: 'session-submit',
})

function actor(sessionId: string): AgentRunAttribution {
  return Object.freeze({ kind: 'agent', client: 'eido-cli', sessionId })
}

function askCard(id: string): Card {
  return {
    id,
    kind: 'askAi',
    blocks: [{ id: `${id}-block`, text: 'Synthetic question.' }],
    position: { x: 0, y: 0 },
  }
}

function liveBoard(): SavedBoard {
  return makeSavedBoard({ cards: [askCard('ask-target')] })
}

describe('app-scoped renderer Agent run service', () => {
  it('shares one job registry across trusted actor sessions and bounds its service cache', async () => {
    const finished = deferred<{
      status: 'done'
      executedStepIds: readonly string[]
      reusedStepIds: readonly string[]
      artifacts: readonly [{
        kind: 'run-record'
        recordId: string
        cardId: string
      }]
    }>()
    const execute = vi.fn(() => finished.promise)
    const renderer = createProfileAgentRunRendererService({
      isLive: () => true,
      readBoard: (ideaId) => ideaId === 'idea-live' ? liveBoard() : undefined,
      execute,
      createRunId: () => 'agent-run-live-1',
      now: (() => {
        let tick = 0
        return () => `2026-07-22T00:00:0${tick++}.000Z`
      })(),
      maxRetainedServices: 2,
    })

    const submitted = await renderer.dispatch(createProfileAgentRunWireRequest(
      'token-submit',
      submitter,
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))
    expect(submitted).toMatchObject({
      token: 'token-submit',
      operation: 'run.submit',
      result: {
        ok: true,
        value: {
          runId: 'agent-run-live-1',
          actor: submitter,
          plannedStepIds: ['ask:ask-target'],
        },
      },
    })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())

    const running = await renderer.dispatch(createProfileAgentRunWireRequest(
      'token-status',
      actor('session-poller'),
      'run.status',
      { runId: 'agent-run-live-1' },
    ))
    expect(running).toMatchObject({
      result: { ok: true, value: { status: 'running', actor: submitter } },
    })

    finished.resolve({
      status: 'done',
      executedStepIds: ['ask:ask-target'],
      reusedStepIds: [],
      artifacts: [{
        kind: 'run-record',
        recordId: 'ordinary-run-target',
        cardId: 'ask-target',
      }],
    })
    await finished.promise
    await vi.waitFor(async () => {
      const response = await renderer.dispatch(createProfileAgentRunWireRequest(
        'token-read',
        actor('session-reader'),
        'run.read',
        { runId: 'agent-run-live-1' },
      ))
      expect(response).toMatchObject({
        result: {
          ok: true,
          value: {
            items: [{ kind: 'run-record', recordId: 'ordinary-run-target' }],
            truncated: false,
          },
        },
      })
    })

    expect(renderer.status()).toMatchObject({
      maxRetainedServices: 2,
      retainedServices: 2,
      admission: { retainedSessions: 1, globalUsage: { usedRuns: 1 } },
      jobs: { retainedJobs: 1, terminalJobs: 1 },
    })
  })

  it('keeps the app-lifetime cap across rotating session identities', async () => {
    let nextRun = 0
    const renderer = createProfileAgentRunRendererService({
      isLive: () => true,
      readBoard: () => liveBoard(),
      execute: async (request) => ({
        status: 'done',
        executedStepIds: request.admission.plannedStepIds,
        reusedStepIds: [],
        artifacts: [],
      }),
      createRunId: () => `agent-run-cap-${++nextRun}`,
      admission: {
        sessionCap: { maxRuns: 2, maxPlannedSteps: 2 },
        appCap: { maxRuns: 1, maxPlannedSteps: 1, maxSessions: 2 },
      },
    })

    const first = await renderer.dispatch(createProfileAgentRunWireRequest(
      'token-cap-one',
      actor('session-cap-one'),
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))
    expect(first.result).toMatchObject({ ok: true })
    const second = await renderer.dispatch(createProfileAgentRunWireRequest(
      'token-cap-two',
      actor('session-cap-two'),
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))
    expect(second.result).toEqual({
      ok: false,
      code: 'budget-exhausted',
      retryable: false,
      message: 'Agent run budget is exhausted. Raise the cap or run from the app.',
    })
    expect(renderer.status().admission.globalUsage.usedRuns).toBe(1)
  })

  it('returns the stable live-app refusal without touching Board or execution state', async () => {
    const readBoard = vi.fn()
    const execute = vi.fn()
    const renderer = createProfileAgentRunRendererService({
      isLive: () => false,
      readBoard,
      execute,
    })

    const response = await renderer.dispatch(createProfileAgentRunWireRequest(
      'token-offline',
      actor('session-offline'),
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))

    expect(response.result).toEqual({
      ok: false,
      code: 'live-app-required',
      retryable: true,
      message: AGENT_RUN_LIVE_REQUIRED_MESSAGE,
    })
    expect(readBoard).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(renderer.status()).toMatchObject({
      retainedServices: 0,
      admission: { retainedSessions: 0, globalUsage: { usedRuns: 0 } },
      jobs: { retainedJobs: 0 },
    })
  })

  it('marks a post-admission submit response fault as outcome-unknown and non-retryable', async () => {
    const execute = vi.fn(async () => ({
      status: 'done' as const,
      executedStepIds: ['ask:ask-target'],
      reusedStepIds: [],
      artifacts: [],
    }))
    const renderer = createProfileAgentRunRendererService({
      isLive: () => true,
      readBoard: () => liveBoard(),
      execute,
      createRunId: () => 'agent-run-post-admission-fault',
      // The job is admitted before the bounded bridge rejects this receipt.
      now: () => 'x'.repeat(257),
    })

    const response = await renderer.dispatch(createProfileAgentRunWireRequest(
      'token-post-admission-fault',
      submitter,
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))

    expect(response.result).toEqual({
      ok: false,
      code: 'internal',
      retryable: false,
      message: 'The agent run submission outcome is unknown. Do not retry this submission.',
    })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    expect(renderer.status()).toMatchObject({
      admission: { globalUsage: { usedRuns: 1 } },
      jobs: { retainedJobs: 1 },
    })
  })
})

function deferred<Value>(): Readonly<{
  promise: Promise<Value>
  resolve(value: Value): void
}> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}
