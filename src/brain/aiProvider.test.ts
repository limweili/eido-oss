import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../graph/store'
import { hasAiAccess, localProviderCompletion, streamCompletion } from './aiProvider'
import { compactionModelForSettings } from './contextCompaction'

describe('AI provider routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses a configured local harness without requiring an API key', async () => {
    const run = vi.fn(async (_request: unknown, onChunk: (text: string) => void) => {
      onChunk('hello')
      return { ok: true as const, text: 'hello world' }
    })
    const cancel = vi.fn(async () => undefined)
    vi.stubGlobal('window', { eidoAiHarness: { run, cancel } })
    useGraph.setState({
      settings: {
        ...useGraph.getState().settings,
        apiKey: '',
        provider: 'claude-code',
        harnesses: {
          'claude-code': { command: 'claude' },
          codex: { command: 'codex' },
          antigravity: { command: 'agy' },
        },
      },
    })

    expect(hasAiAccess(useGraph.getState().settings)).toBe(true)
    const chunks: string[] = []
    await expect(streamCompletion('Task', {
      model: 'sonnet',
      reasoningEffort: 'medium',
      systemPrompt: '',
      onChunk: (chunk) => chunks.push(chunk),
    })).resolves.toBe('hello world')

    expect(chunks).toEqual(['hello'])
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ harness: 'claude-code', command: 'claude', model: 'sonnet' }),
      expect.any(Function),
    )
  })

  it('asserts nothing about tools when an Agentic Run reaches a local harness', async () => {
    // The harness owns its own tools and its own loop (ADR 0033). Eido asking
    // for an Agentic Run must change nothing that crosses the bridge: no tool
    // declaration, and no instruction smuggled into the prompt.
    const run = vi.fn(async (_request: unknown) => ({ ok: true as const, text: 'answer' }))
    vi.stubGlobal('window', { eidoAiHarness: { run, cancel: vi.fn(async () => undefined) } })
    useGraph.setState({
      settings: { ...useGraph.getState().settings, apiKey: '', provider: 'codex' },
    })

    const options = {
      model: 'default',
      reasoningEffort: 'medium' as const,
      systemPrompt: '',
      onChunk: () => undefined,
    }
    await streamCompletion('Task', options)
    await streamCompletion('Task', { ...options, agentic: true, onToolStep: () => undefined })

    // Every field but the request's own identity, which is new per call.
    const withoutIdentity = (request: unknown) => {
      const { requestId: _requestId, ...rest } = request as Record<string, unknown>
      return rest
    }
    const [plain, requested] = run.mock.calls.map(([request]) => withoutIdentity(request))
    expect(requested).toEqual(plain)
    expect(JSON.stringify(requested)).not.toMatch(/agentic|tool|search|web_fetch/i)
  })

  it('uses the selected model for context compaction on every provider', () => {
    expect(compactionModelForSettings({ provider: 'claude-code', model: 'sonnet' })).toBe('sonnet')
    expect(compactionModelForSettings({ provider: 'codex', model: 'default' })).toBe('default')
    expect(compactionModelForSettings({ provider: 'antigravity', model: 'pro' })).toBe('pro')
    expect(compactionModelForSettings({ provider: 'openrouter', model: 'openai/gpt-5.6' })).toBe('openai/gpt-5.6')
  })
})

describe('local provider availability', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports a missing CLI bridge without changing saved commands', async () => {
    vi.stubGlobal('window', {})
    useGraph.setState({ settings: { ...useGraph.getState().settings, provider: 'claude-code', apiKey: '' } })
    const before = useGraph.getState().settings.harnesses
    await expect(streamCompletion('Task', {
      model: 'sonnet', reasoningEffort: 'medium', systemPrompt: '', onChunk: () => undefined,
    })).rejects.toThrow('harness-unavailable')
    expect(useGraph.getState().settings.harnesses).toBe(before)
    expect(hasAiAccess(useGraph.getState().settings)).toBe(false)
  })

  it('keeps OpenRouter on the user-key route', () => {
    const settings = { apiKey: 'sk-user-key', provider: 'openrouter' as const }
    expect(hasAiAccess(settings)).toBe(true)
    expect(localProviderCompletion(settings)).toBeUndefined()
  })
})
