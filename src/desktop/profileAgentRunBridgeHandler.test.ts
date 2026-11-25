import { describe, expect, it, vi } from 'vitest'
import {
  createProfileAgentRunWireRequest,
  createProfileAgentRunWireResponse,
  PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT,
  PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT,
  type ProfileAgentRunWireResponse,
} from '../../electron/profileAgentRunBridgeContract'
import type { ProfileAgentRunRendererService } from './profileAgentRunRendererService'
import { registerProfileAgentRunBridgeHandler } from './profileAgentRunBridgeHandler'

class TestCustomEvent<Value> extends Event {
  constructor(type: string, readonly detail: Value) {
    super(type)
  }
}

const actor = Object.freeze({
  kind: 'agent' as const,
  client: 'codex',
  sessionId: 'authenticated-session',
})

describe('Profile Agent run renderer bridge handler', () => {
  it('validates one bounded request, delegates it, and returns the exact correlated response', async () => {
    const target = new EventTarget()
    const response = createProfileAgentRunWireResponse('renderer-request-1', 'run.status', {
      ok: false,
      code: 'not-found',
      retryable: false,
      message: 'The requested agent run was not found.',
    })
    const service = {
      dispatch: vi.fn(async () => response),
    } as unknown as ProfileAgentRunRendererService
    const responses: ProfileAgentRunWireResponse[] = []
    target.addEventListener(PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT, (event) => {
      responses.push((event as CustomEvent<ProfileAgentRunWireResponse>).detail)
    })
    const dispose = registerProfileAgentRunBridgeHandler(target, service)

    target.dispatchEvent(new TestCustomEvent(PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT, {
      token: 'forged-without-envelope',
      operation: 'run.status',
      payload: { runId: 'agent-run-1' },
    }))
    const request = createProfileAgentRunWireRequest(
      'renderer-request-1',
      actor,
      'run.status',
      { runId: 'agent-run-1' },
    )
    target.dispatchEvent(new TestCustomEvent(PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT, request))

    await vi.waitFor(() => expect(responses).toEqual([response]))
    expect(service.dispatch).toHaveBeenCalledOnce()
    expect(service.dispatch).toHaveBeenCalledWith(request)

    dispose()
    target.dispatchEvent(new TestCustomEvent(PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT, request))
    await Promise.resolve()
    expect(service.dispatch).toHaveBeenCalledOnce()
  })

  it('contains service rejection as an exact internal response without reflecting private text', async () => {
    const target = new EventTarget()
    const service = {
      dispatch: vi.fn(async () => {
        throw new Error('provider key sk-private must never cross the bridge')
      }),
    } as unknown as ProfileAgentRunRendererService
    const responses: ProfileAgentRunWireResponse[] = []
    target.addEventListener(PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT, (event) => {
      responses.push((event as CustomEvent<ProfileAgentRunWireResponse>).detail)
    })
    registerProfileAgentRunBridgeHandler(target, service)

    target.dispatchEvent(new TestCustomEvent(
      PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT,
      createProfileAgentRunWireRequest('renderer-request-2', actor, 'run.read', {
        runId: 'agent-run-2',
      }),
    ))

    await vi.waitFor(() => expect(responses).toEqual([
      createProfileAgentRunWireResponse('renderer-request-2', 'run.read', {
        ok: false,
        code: 'internal',
        retryable: true,
        message: 'The agent run did not complete.',
      }),
    ]))
    expect(JSON.stringify(responses)).not.toContain('sk-private')
  })

  it('marks a rejected submit as outcome-ambiguous and non-retryable', async () => {
    const target = new EventTarget()
    const service = {
      dispatch: vi.fn(async () => {
        throw new Error('submission may already have started')
      }),
    } as unknown as ProfileAgentRunRendererService
    const responses: ProfileAgentRunWireResponse[] = []
    target.addEventListener(PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT, (event) => {
      responses.push((event as CustomEvent<ProfileAgentRunWireResponse>).detail)
    })
    registerProfileAgentRunBridgeHandler(target, service)

    target.dispatchEvent(new TestCustomEvent(
      PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT,
      createProfileAgentRunWireRequest('renderer-submit-error', actor, 'run.submit', {
        ideaId: 'idea-live',
        targetCardId: 'ask-live',
      }),
    ))

    await vi.waitFor(() => expect(responses[0]?.result).toEqual({
      ok: false,
      code: 'internal',
      retryable: false,
      message: 'The agent run submission outcome is unknown. Do not retry this submission.',
    }))
  })
})
