import { describe, expect, it } from 'vitest'
import { AGENT_RUN_CONTRACT_VERSION } from '../src/brain/agentRunContract'
import {
  PROFILE_AGENT_RUN_BRIDGE_CHANNEL,
  PROFILE_AGENT_RUN_BRIDGE_LIMITS,
  PROFILE_AGENT_RUN_BRIDGE_VERSION,
  PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT,
  PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT,
  assertProfileAgentRunWireResponse,
  assertProfileAgentRunWireRequest,
  createProfileAgentRunWireResponse,
  createProfileAgentRunWireRequest,
} from './profileAgentRunBridgeContract'

const actor = Object.freeze({
  kind: 'agent' as const,
  client: 'codex',
  sessionId: 'session-synthetic',
})

describe('Profile Agent run renderer wire contract', () => {
  it('binds trusted actor identity outside a bounded caller submit payload', () => {
    const request = createProfileAgentRunWireRequest(
      'correlation-submit',
      actor,
      'run.submit',
      Object.freeze({ ideaId: 'idea-live', targetCardId: 'ask-target' }),
    )

    expect(request).toEqual({
      version: PROFILE_AGENT_RUN_BRIDGE_VERSION,
      kind: 'agent-run-request',
      token: 'correlation-submit',
      actor,
      operation: 'run.submit',
      payload: { ideaId: 'idea-live', targetCardId: 'ask-target' },
    })
    expect(assertProfileAgentRunWireRequest(request)).toEqual(request)
    expect(createProfileAgentRunWireRequest(
      'correlation-variations',
      actor,
      'run.submit',
      Object.freeze({
        ideaId: 'idea-live',
        targetCardId: 'conversation-target',
        mode: 'variations',
        variationCount: 3,
      }),
    ).payload).toEqual({
      ideaId: 'idea-live',
      targetCardId: 'conversation-target',
      mode: 'variations',
      variationCount: 3,
    })
    for (const candidate of [
      { ...request, credentials: { apiKey: 'must-not-cross-ipc' } },
      { ...request, actor: { ...actor, transport: 'caller-controlled' } },
      { ...request, payload: { ...request.payload, provider: 'private-provider' } },
      { ...request, token: 'x'.repeat(PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxTokenBytes + 1) },
    ]) {
      expect(() => assertProfileAgentRunWireRequest(candidate)).toThrow(
        'Agent run renderer request is invalid',
      )
    }
  })

  it('admits only bounded status and artifact-reference reads', () => {
    const status = createProfileAgentRunWireRequest(
      'correlation-status',
      actor,
      'run.status',
      Object.freeze({ runId: 'agent-run-1' }),
    )
    const read = createProfileAgentRunWireRequest(
      'correlation-read',
      actor,
      'run.read',
      Object.freeze({
        runId: 'agent-run-1',
        limit: 5,
        byteLimit: 8 * 1024,
        cursor: 'bounded-cursor',
      }),
    )

    expect(assertProfileAgentRunWireRequest(status)).toEqual(status)
    expect(assertProfileAgentRunWireRequest(read)).toEqual(read)
    for (const candidate of [
      { ...status, payload: { runId: 'agent-run-1', actor } },
      { ...read, payload: { ...read.payload, limit: 201 } },
      { ...read, payload: { ...read.payload, byteLimit: 256 * 1024 + 1 } },
      { ...read, payload: { ...read.payload, cursor: 'x'.repeat(4 * 1024 + 1) } },
    ]) {
      expect(() => assertProfileAgentRunWireRequest(candidate)).toThrow(
        'Agent run renderer request is invalid',
      )
    }
  })

  it('validates bounded operation-specific results without output or credential material', () => {
    expect(PROFILE_AGENT_RUN_BRIDGE_CHANNEL).toBe('eido:profile-agent-run:v1')
    expect(PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT).toBe('eido:profile-agent-run-request')
    expect(PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT).toBe('eido:profile-agent-run-response')

    const response = createProfileAgentRunWireResponse(
      'correlation-submit',
      'run.submit',
      Object.freeze({
        ok: true as const,
        value: Object.freeze({
          version: AGENT_RUN_CONTRACT_VERSION,
          runId: 'agent-run-1',
          ideaId: 'idea-live',
          targetCardId: 'ask-target',
          actor,
          status: 'queued' as const,
          submittedAt: '2026-07-22T00:00:00.000Z',
          plannedStepIds: Object.freeze(['ask-target']),
          reusedStepIds: Object.freeze(['ask-upstream']),
        }),
      }),
    )
    if (!response.result.ok) throw new Error('Synthetic submit response must succeed')

    expect(assertProfileAgentRunWireResponse(response)).toEqual(response)
    for (const candidate of [
      { ...response, credentials: { apiKey: 'must-not-cross-ipc' } },
      { ...response, result: { ...response.result, provider: 'private-provider' } },
      {
        ...response,
        result: {
          ok: true,
          value: { ...response.result.value, output: 'model output must remain in Profile' },
        },
      },
      {
        ...response,
        result: {
          ok: false,
          code: 'internal',
          retryable: true,
          message: 'x'.repeat(PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxMessageBytes + 1),
        },
      },
    ]) {
      expect(() => assertProfileAgentRunWireResponse(candidate)).toThrow(
        'Agent run renderer response is invalid',
      )
    }
  })
})
