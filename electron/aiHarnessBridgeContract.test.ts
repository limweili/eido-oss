import { describe, expect, it, vi } from 'vitest'
import {
  AI_HARNESS_BRIDGE_VERSION,
  assertAiHarnessRequest,
  assertAiHarnessRunResult,
  createAiHarnessRunRequest,
  createInstalledAiHarnessBridge,
} from './aiHarnessBridgeContract'

describe('AI harness bridge contract', () => {
  it('routes bounded stream chunks to the matching renderer request', async () => {
    let receive: ((candidate: unknown) => void) | undefined
    const invoke = vi.fn(async (request: { requestId: string }) => {
      receive?.({
        version: AI_HARNESS_BRIDGE_VERSION,
        requestId: request.requestId,
        kind: 'chunk',
        text: 'partial',
      })
      return { ok: true, text: 'done' }
    })
    const bridge = createInstalledAiHarnessBridge(invoke, (listener) => {
      receive = listener
    })
    const request = createAiHarnessRunRequest('claude-code', 'claude', 'sonnet', 'medium', 'Prompt', [])
    const chunks: string[] = []

    await expect(bridge.run(request, (chunk) => chunks.push(chunk))).resolves.toEqual({
      ok: true,
      text: 'done',
    })
    expect(chunks).toEqual(['partial'])
    expect(invoke).toHaveBeenCalledWith(request)
  })

  it('rejects credentials and arbitrary extra fields at the renderer seam', () => {
    const request = createAiHarnessRunRequest('codex', 'codex', 'default', 'medium', 'Prompt', [])
    expect(() => assertAiHarnessRequest({
      ...request,
      apiKey: 'must-not-cross-ipc',
    })).toThrow('AI harness bridge request was denied')
  })

  it('gives concurrent harness requests distinct correlation ids', () => {
    const first = createAiHarnessRunRequest('claude-code', 'claude', 'sonnet', 'medium', 'Prompt', [])
    const second = createAiHarnessRunRequest('claude-code', 'claude', 'sonnet', 'medium', 'Prompt', [])
    expect(second.requestId).not.toBe(first.requestId)
  })

  it('admits the bounded incompatible-output result without exposing raw CLI errors', () => {
    expect(assertAiHarnessRunResult({ ok: false, error: 'incompatible-output' })).toEqual({
      ok: false,
      error: 'incompatible-output',
    })
  })
})
