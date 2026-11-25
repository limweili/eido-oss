import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiExecutionPlan } from './executionPlan'
import { streamCompletionWithAccess, type StreamOptions } from './openRouter'
import {
  assertAiAccessGrant,
  fetchOpenRouterWithAccess,
  resolveAiAccess,
  type AiAccessGrant,
} from './aiAccess'

const plan: AiExecutionPlan = {
  version: 1,
  visibleTurns: 1,
  providerCalls: 1,
  providerCallManifest: [{ callClass: 'visible-reply', providerModelId: 'any/model' }],
}
const request = {
  source: 'in-app' as const,
  byokCredential: '',
  requestedModel: 'any/model',
  providerModelIds: ['any/model'],
  executionPlan: plan,
}

afterEach(() => vi.unstubAllGlobals())

describe('user-owned AI access', () => {
  it.each(['in-app', 'agent-cli'] as const)('requires a user key for %s remote execution', (source) => {
    expect(resolveAiAccess({ ...request, source })).toEqual({
      ok: false,
      explanation: 'setup',
      code: 'api-key-required',
    })
  })

  it('keeps the credential outside inspectable run provenance and uses it only for OpenRouter', async () => {
    const network = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', network)
    const decision = resolveAiAccess({ ...request, byokCredential: '  sk-user-owned  ' })
    if (!decision.ok) throw new Error('Expected a user-key grant')
    expect(JSON.stringify(decision.grant)).toBe('{"routeClass":"byok","policyRevision":null}')
    await fetchOpenRouterWithAccess(decision.grant, 'any/model', '{"model":"any/model"}')
    expect(network).toHaveBeenCalledExactlyOnceWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-user-owned' }),
        redirect: 'error',
      }),
    )
  })

  it('runs a local CLI without a remote key or an account', async () => {
    const completion = vi.fn(async (_instruction: string, options: StreamOptions) => {
      options.onChunk('Local answer')
      return 'Local answer'
    })
    const decision = resolveAiAccess({ ...request, localCompletion: completion })
    if (!decision.ok) throw new Error('Expected local access')
    await expect(streamCompletionWithAccess('Task', {
      accessGrant: decision.grant,
      model: 'sonnet',
      reasoningEffort: 'medium',
      systemPrompt: '',
      onChunk: () => undefined,
    })).resolves.toBe('Local answer')
    expect(completion).toHaveBeenCalledOnce()
    expect(() => fetchOpenRouterWithAccess(decision.grant, 'sonnet', '{}')).toThrow(
      'Local provider access does not use OpenRouter fetch',
    )
  })

  it('refuses forged provenance as provider authority', () => {
    expect(() => assertAiAccessGrant({ routeClass: 'byok', policyRevision: null } as AiAccessGrant, 'any/model'))
      .toThrow('AI access grant is invalid')
  })
})
