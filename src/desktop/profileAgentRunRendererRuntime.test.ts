import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProfileAgentRunWireRequest,
  PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT,
  PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT,
  type ProfileAgentRunWireResponse,
} from '../../electron/profileAgentRunBridgeContract'
import { makeSavedBoard } from '../graph/save'
import type { Card } from '../graph/types'
import { registerProfileAgentRunRendererRuntime } from './profileAgentRunRendererRuntime'

const executor = vi.hoisted(() => ({
  execute: vi.fn(),
  cancelActive: vi.fn(),
}))

vi.mock('../brain/agentRunExecutor', () => ({
  createAgentRunExecutor: vi.fn(() => executor),
}))

class TestCustomEvent<Value> extends Event {
  readonly detail: Value

  constructor(type: string, init: { detail: Value }) {
    super(type)
    this.detail = init.detail
  }
}

const submitter = Object.freeze({
  kind: 'agent' as const,
  client: 'eido-cli',
  sessionId: 'authenticated-submitter',
})

describe('packaged Profile Agent run renderer runtime', () => {
  beforeEach(() => {
    executor.execute.mockReset()
    executor.cancelActive.mockReset()
  })

  it('uses the brain executor, flushes packaged persistence, and shares jobs across connections', async () => {
    vi.stubGlobal('CustomEvent', TestCustomEvent)
    const target = new EventTarget()
    const card: Card = {
      id: 'ask-target',
      kind: 'askAi',
      blocks: [{ id: 'ask-block', text: 'Synthetic question.' }],
      position: { x: 0, y: 0 },
    }
    const board = makeSavedBoard({ cards: [card] })
    executor.execute.mockResolvedValue({
      status: 'failed',
      failure: 'execution-failed',
      executedStepIds: ['ask:ask-target'],
      reusedStepIds: [],
      artifacts: [{ kind: 'run-record', recordId: 'run-1', cardId: 'ask-target' }],
    })
    const flush = vi.fn(async () => undefined)
    const runtime = registerProfileAgentRunRendererRuntime(target, {
      isAuthorityReady: () => true,
      subscribeAuthorityReadiness: () => () => undefined,
      readLiveBoard: () => ({ ideaId: 'idea-live', board }),
      flush,
    })
    const responses: ProfileAgentRunWireResponse[] = []
    target.addEventListener(PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT, (event) => {
      responses.push((event as CustomEvent<ProfileAgentRunWireResponse>).detail)
    })

    dispatch(target, createProfileAgentRunWireRequest(
      'runtime-submit',
      submitter,
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))
    await vi.waitFor(() => expect(responses).toHaveLength(1))
    const receipt = responses[0]
    if (receipt?.operation !== 'run.submit' || !receipt.result.ok) {
      throw new Error(`Synthetic submission must be admitted: ${JSON.stringify(receipt)}`)
    }
    await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce())

    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      targetCardId: 'ask-target',
      actor: submitter,
      admission: expect.objectContaining({ plannedStepIds: ['ask:ask-target'] }),
    }))
    expect(JSON.stringify(executor.execute.mock.calls)).not.toMatch(/credential|apiKey|bearer|sk-or-/i)

    dispatch(target, createProfileAgentRunWireRequest(
      'runtime-status',
      { kind: 'agent', client: 'eido-cli', sessionId: 'authenticated-reader' },
      'run.status',
      { runId: receipt.result.value.runId },
    ))
    await vi.waitFor(() => expect(responses).toHaveLength(2))
    expect(responses[1]).toMatchObject({
      operation: 'run.status',
      result: {
        ok: true,
        value: { status: 'failed', actor: submitter },
      },
    })
    expect(JSON.stringify(responses)).not.toContain('private provider output')

    runtime.close()
    dispatch(target, createProfileAgentRunWireRequest(
      'runtime-after-close',
      submitter,
      'run.status',
      { runId: receipt.result.value.runId },
    ))
    await Promise.resolve()
    expect(responses).toHaveLength(2)
  })

  it('stops queued model work when packaged Profile authority becomes terminal', async () => {
    const target = new EventTarget()
    const board = makeSavedBoard({ cards: [{
      id: 'ask-target',
      kind: 'askAi',
      blocks: [{ id: 'ask-block', text: 'Synthetic question.' }],
      position: { x: 0, y: 0 },
    }] })
    let authorityReady = true
    let authorityChanged: () => void = () => undefined
    const firstReleased = deferred<void>()
    executor.execute.mockImplementation(async () => {
      await firstReleased.promise
      return {
        status: 'failed' as const,
        failure: 'plan-changed' as const,
        executedStepIds: [],
        reusedStepIds: [],
        artifacts: [],
      }
    })
    const runtime = registerProfileAgentRunRendererRuntime(target, {
      isAuthorityReady: () => authorityReady,
      subscribeAuthorityReadiness(listener) {
        authorityChanged = listener
        return () => { authorityChanged = () => undefined }
      },
      readLiveBoard: () => ({ ideaId: 'idea-live', board }),
      flush: async () => undefined,
    })

    const first = await runtime.service.dispatch(createProfileAgentRunWireRequest(
      'terminal-first',
      submitter,
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))
    expect(first.result.ok).toBe(true)
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalledOnce())

    const second = await runtime.service.dispatch(createProfileAgentRunWireRequest(
      'terminal-second',
      submitter,
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))
    expect(second.result.ok).toBe(true)

    authorityReady = false
    authorityChanged()
    const draining = runtime.drain()
    expect(executor.cancelActive).toHaveBeenCalledOnce()
    firstReleased.resolve()
    await draining

    expect(executor.execute).toHaveBeenCalledTimes(2)
    const usageBeforeRefusal = runtime.service.status().admission.globalUsage.usedRuns
    const refused = await runtime.service.dispatch(createProfileAgentRunWireRequest(
      'terminal-refused',
      submitter,
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))
    expect(refused.result).toMatchObject({
      ok: false,
      code: 'live-app-required',
      retryable: true,
    })
    expect(runtime.service.status().admission.globalUsage.usedRuns).toBe(usageBeforeRefusal)
  })

  it('owns an accepted submit before its executeJob microtask when shutdown starts immediately', async () => {
    const target = new EventTarget()
    const board = makeSavedBoard({ cards: [{
      id: 'ask-target',
      kind: 'askAi',
      blocks: [{ id: 'ask-block', text: 'Synthetic question.' }],
      position: { x: 0, y: 0 },
    }] })
    const runtime = registerProfileAgentRunRendererRuntime(target, {
      isAuthorityReady: () => true,
      subscribeAuthorityReadiness: () => () => undefined,
      readLiveBoard: () => ({ ideaId: 'idea-live', board }),
      flush: async () => undefined,
    })

    const submitting = runtime.service.dispatch(createProfileAgentRunWireRequest(
      'immediate-close-submit',
      submitter,
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))
    const draining = runtime.drain()

    await expect(submitting).resolves.toMatchObject({ result: { ok: true } })
    await draining
    expect(executor.execute).toHaveBeenCalledOnce()
    expect(runtime.service.status()).toMatchObject({
      admission: { globalUsage: { usedRuns: 1 } },
      jobs: { activeJobs: 0, terminalJobs: 1 },
    })
  })

  it('leases the live executor across an authoritative mutation without closing it', async () => {
    const target = new EventTarget()
    const board = makeSavedBoard({ cards: [{
      id: 'ask-target',
      kind: 'askAi',
      blocks: [{ id: 'ask-block', text: 'Synthetic question.' }],
      position: { x: 0, y: 0 },
    }] })
    const activeReleased = deferred<void>()
    executor.execute.mockImplementation(async () => {
      await activeReleased.promise
      return {
        status: 'failed' as const,
        failure: 'plan-changed' as const,
        executedStepIds: [],
        reusedStepIds: [],
        artifacts: [],
      }
    })
    executor.cancelActive.mockImplementation(() => activeReleased.resolve())
    const runtime = registerProfileAgentRunRendererRuntime(target, {
      isAuthorityReady: () => true,
      subscribeAuthorityReadiness: () => () => undefined,
      readLiveBoard: () => ({ ideaId: 'idea-live', board }),
      flush: async () => undefined,
    })

    const first = await runtime.service.dispatch(createProfileAgentRunWireRequest(
      'lease-first',
      submitter,
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))
    expect(first.result.ok).toBe(true)
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalledOnce())

    const release = await runtime.acquireAuthoritativeMutationLease()
    expect(executor.cancelActive).toHaveBeenCalledOnce()
    const refused = await runtime.service.dispatch(createProfileAgentRunWireRequest(
      'lease-refused',
      submitter,
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))
    expect(refused.result).toMatchObject({
      ok: false,
      code: 'live-app-required',
      retryable: true,
    })

    release()
    const resumed = await runtime.service.dispatch(createProfileAgentRunWireRequest(
      'lease-resumed',
      submitter,
      'run.submit',
      { ideaId: 'idea-live', targetCardId: 'ask-target' },
    ))
    expect(resumed.result.ok).toBe(true)
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalledTimes(2))
    runtime.close()
  })
})

function dispatch(target: EventTarget, detail: unknown): void {
  target.dispatchEvent(new TestCustomEvent(PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT, { detail }))
}

function deferred<Value>(): Readonly<{
  promise: Promise<Value>
  resolve(value: Value): void
}> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}
