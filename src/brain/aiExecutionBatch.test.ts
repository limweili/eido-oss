import { describe, expect, it, vi } from 'vitest'
import { resolveAiAccess } from './aiAccess'
import { createAiExecutionBatch } from './aiExecutionBatch'
import type { AiExecutionPlan, AiProviderCallManifestItem } from './executionPlan'

const reply = { callClass: 'visible-reply', providerModelId: 'user/model' } as const
const helper = { callClass: 'context-compaction', providerModelId: 'user/helper', optional: true } as const
function batch(manifest: readonly AiProviderCallManifestItem[], visibleTurns = 1) {
  const plan: AiExecutionPlan = { version: 1, visibleTurns, providerCalls: manifest.length, providerCallManifest: manifest }
  const decision = resolveAiAccess({
    source: 'in-app', byokCredential: 'user-key', requestedModel: 'user/model',
    providerModelIds: ['user/model'], executionPlan: plan,
  })
  if (!decision.ok) throw new Error('Expected user-key access')
  return createAiExecutionBatch(decision.grant, plan)
}

describe('local execution plan ordering', () => {
  it('runs ordered replies and skips a helper that is no longer needed', async () => {
    const execution = batch([reply, helper, reply], 2)
    await execution.runProvider(reply, async () => 'first')
    expect(await execution.completeOutput()).toBe(true)
    await execution.runProvider(reply, async () => 'second')
    expect(await execution.completeOutput()).toBe(true)
    expect(execution.providerCallsStarted()).toBe(2)
    expect(await execution.finish()).toBe(true)
    expect(await execution.finish()).toBe(false)
  })

  it('refuses changed provider order before starting provider work', async () => {
    const execution = batch([{ ...helper, optional: undefined }, reply])
    const provider = vi.fn(async () => 'answer')
    await expect(execution.runProvider(reply, provider)).rejects.toMatchObject({ code: 'provider-plan-mismatch' })
    expect(provider).not.toHaveBeenCalled()
    expect(await execution.finish()).toBe(false)
  })

  it('never repeats an occurrence after its provider fails', async () => {
    const execution = batch([reply])
    await expect(execution.runProvider(reply, async () => { throw new Error('bad-key') })).rejects.toThrow('bad-key')
    const again = vi.fn(async () => 'answer')
    await expect(execution.runProvider(reply, again)).rejects.toMatchObject({ code: 'provider-plan-mismatch' })
    expect(again).not.toHaveBeenCalled()
  })

  it('stops later provider calls after cancellation', async () => {
    const execution = batch([reply, reply], 2)
    await execution.runProvider(reply, async () => 'partial')
    expect(await execution.release('cancelled')).toBe(true)
    const later = vi.fn(async () => 'answer')
    await expect(execution.runProvider(reply, later)).rejects.toMatchObject({ code: 'batch-terminal' })
    expect(later).not.toHaveBeenCalled()
  })

  it('does not allow an optional visible reply in a plan', () => {
    expect(() => batch([{ ...reply, optional: true }])).toThrow('provider-plan-mismatch')
  })
})
