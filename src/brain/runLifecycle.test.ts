import { beforeEach, describe, expect, it } from 'vitest'
import { useGraph } from '../graph/store'
import { compactionFingerprint } from './contextCompaction'
import { AiError, ContextOverflowError } from './openRouter'
import type { CompletionStream } from './runEngine'
import { compileUnderBudget, createAbortRegistry, isRunCanceled, plainError } from './runLifecycle'

function resetStore() {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    compactionSummaries: [],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    hydrated: false,
    currentIdeaId: null,
    keyPromptOpen: false,
    settings: {
      apiKey: 'test-key',
      model: 'default/model',
      models: ['default/model'],
      reasoningEffort: 'medium',
    },
  })
}

beforeEach(resetStore)

describe('createAbortRegistry', () => {
  it('aborts every controller registered under a key', () => {
    const registry = createAbortRegistry()
    const a = new AbortController()
    const b = new AbortController()
    registry.add('card-1', a)
    registry.add('card-1', b)

    registry.abort('card-1')

    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(true)
  })

  it('aborts a controller registered under two keys from either key', () => {
    const registry = createAbortRegistry()
    const shared = new AbortController()
    registry.add('ask-card', shared)
    registry.add('group-card', shared)

    registry.abort('group-card')

    expect(shared.signal.aborted).toBe(true)
  })

  it('keeps the key active until the last controller is removed', () => {
    const registry = createAbortRegistry()
    const a = new AbortController()
    const b = new AbortController()
    registry.add('card-1', a)
    registry.add('card-1', b)

    registry.remove('card-1', a)
    expect(registry.has('card-1')).toBe(true)

    registry.remove('card-1', b)
    expect(registry.has('card-1')).toBe(false)
  })

  it('removing a controller that was never added changes nothing', () => {
    const registry = createAbortRegistry()
    const active = new AbortController()
    registry.add('card-1', active)

    registry.remove('card-1', new AbortController())
    registry.remove('other-card', active)

    expect(registry.has('card-1')).toBe(true)
    expect(registry.has('other-card')).toBe(false)
  })

  it('aborting an unknown key is a no-op', () => {
    const registry = createAbortRegistry()
    expect(() => registry.abort('never-registered')).not.toThrow()
  })
})

describe('isRunCanceled', () => {
  const runRecord = (id: string, status: 'running' | 'canceled') =>
    ({ id, status }) as unknown as ReturnType<typeof useGraph.getState>['runs'][number]

  it('is false while the run is live and the signal untouched', () => {
    useGraph.setState({ runs: [runRecord('run-1', 'running')] })
    expect(isRunCanceled('run-1', new AbortController().signal)).toBe(false)
  })

  it('is true once the signal aborts, before the store hears about it', () => {
    useGraph.setState({ runs: [runRecord('run-1', 'running')] })
    const controller = new AbortController()
    controller.abort()
    expect(isRunCanceled('run-1', controller.signal)).toBe(true)
  })

  it('is true once the store settled the run as canceled, even with a live signal', () => {
    useGraph.setState({ runs: [runRecord('run-1', 'canceled')] })
    expect(isRunCanceled('run-1', new AbortController().signal)).toBe(true)
  })

  it('is false for a run the store does not know', () => {
    expect(isRunCanceled('missing-run', new AbortController().signal)).toBe(false)
  })
})

describe('plainError', () => {
  it.each(['no-key', 'bad-key', 'unreachable'])('maps AiError %s to errCouldNotReach', (code) => {
    expect(plainError(new AiError(code))).toBe('errCouldNotReach')
  })

  it('explains when a configured local harness cannot be found', () => {
    expect(plainError(new AiError('harness-unavailable'))).toBe('errHarnessUnavailable')
  })

  it('explains when a local harness exits unsuccessfully', () => {
    expect(plainError(new AiError('failed'))).toBe('errHarnessFailed')
  })

  it('explains when a local harness output contract has changed', () => {
    expect(plainError(new AiError('incompatible-output'))).toBe('errHarnessIncompatible')
  })

  it('maps any other AiError to the generic message', () => {
    // A refusal for length is an AiError too, so without its own check it
    // reaches the generic message and sends the reader to a working key.
    expect(plainError(new ContextOverflowError('context length exceeded', 128_000))).toBe(
      'errTooLong',
    )
    expect(plainError(new AiError('rate-limited'))).toBe('errGeneric')
  })

  it('maps non-AI errors to the generic message', () => {
    expect(plainError(new Error('boom'))).toBe('errGeneric')
    expect(plainError('boom')).toBe('errGeneric')
  })
})

describe('compileUnderBudget', () => {
  const neverStream: CompletionStream = async () => {
    throw new Error('the summariser must not be called when nothing is over budget')
  }

  const summarizingStream = (calls: string[]): CompletionStream => {
    return async (instruction, opts) => {
      calls.push(instruction)
      opts.onChunk('a short summary')
      return 'a short summary'
    }
  }

  // A compile whose first pass wants 'card-1' compacted and whose second pass fits.
  const overBudgetCompile =
    (first: string, second: string) =>
    (summaries: Map<string, string>): { compiled: string; compactionInputs: Record<string, string> } =>
      summaries.size === 0
        ? { compiled: first, compactionInputs: { 'card-1': 'a very long card text' } }
        : { compiled: second, compactionInputs: {} }

  it('returns the first pass untouched when nothing is over budget', async () => {
    const passes: number[] = []
    const result = await compileUnderBudget(
      (summaries) => {
        passes.push(summaries.size)
        return { compiled: 'compiled-once', compactionInputs: {} }
      },
      { stream: neverStream },
    )

    expect(result).toBe('compiled-once')
    expect(passes).toEqual([0])
  })

  it('summarizes the over-budget cards and recompiles with the summaries', async () => {
    const summaryCalls: string[] = []
    const passSummaries: Map<string, string>[] = []
    const compile = overBudgetCompile('first-pass', 'compacted-pass')
    const result = await compileUnderBudget(
      (summaries) => {
        passSummaries.push(new Map(summaries))
        return compile(summaries)
      },
      { stream: summarizingStream(summaryCalls) },
    )

    expect(result).toBe('compacted-pass')
    expect(summaryCalls).toHaveLength(1)
    expect(summaryCalls[0]).toContain('a very long card text')
    expect(passSummaries).toHaveLength(2)
    expect(passSummaries[1].get('card-1')).toBe('a short summary')
  })

  it('falls back to the first pass when no summary could be obtained', async () => {
    const passes: number[] = []
    const failingStream: CompletionStream = async () => {
      throw new AiError('unreachable')
    }
    const result = await compileUnderBudget(
      (summaries) => {
        passes.push(summaries.size)
        return { compiled: 'first-pass', compactionInputs: { 'card-1': 'a very long card text' } }
      },
      { stream: failingStream },
    )

    expect(result).toBe('first-pass')
    expect(passes).toEqual([0])
  })

  it('reuses a valid cached summary without calling the summariser again', async () => {
    const summaryCalls: string[] = []
    await compileUnderBudget(overBudgetCompile('first', 'second'), {
      stream: summarizingStream(summaryCalls),
    })
    expect(summaryCalls).toHaveLength(1)

    const result = await compileUnderBudget(overBudgetCompile('first', 'second-from-cache'), {
      stream: neverStream,
    })

    expect(result).toBe('second-from-cache')
    expect(summaryCalls).toHaveLength(1)
  })

  // Summarising inherits the Idea's settings, so it runs on the same provider,
  // model, and reasoning rung a real Ask would have used.
  it.each([
    ['openrouter', 'openai/gpt-5.6', 'xhigh'],
    ['claude-code', 'sonnet', 'high'],
    ['codex', 'default', 'low'],
    ['antigravity', 'pro', 'medium'],
  ] as const)('summarizes on the %s settings the Idea already has', async (provider, model, effort) => {
    useGraph.setState({
      settings: { ...useGraph.getState().settings, provider, model, reasoningEffort: effort },
    })
    const sent: { model: string; reasoningEffort: string }[] = []
    const stream: CompletionStream = async (_instruction, opts) => {
      sent.push({ model: opts.model, reasoningEffort: opts.reasoningEffort })
      opts.onChunk('a short summary')
      return 'a short summary'
    }

    await compileUnderBudget(overBudgetCompile('first', 'second'), {
      stream,
    })

    expect(sent).toEqual([{ model, reasoningEffort: effort }])
  })

  // An Idea carrying summaries from the retired cheap model must not serve them
  // under the model that summarises now.
  it('remakes a summary cached under a different model', async () => {
    const summaryCalls: string[] = []
    await compileUnderBudget(overBudgetCompile('first', 'second'), {
      stream: summarizingStream(summaryCalls),
    })
    expect(useGraph.getState().compactionSummaries[0]?.model).toBe('default/model')

    useGraph.setState({
      settings: { ...useGraph.getState().settings, model: 'another/model' },
    })
    const afterSwitch: string[] = []
    await compileUnderBudget(overBudgetCompile('first', 'second'), {
      stream: summarizingStream(afterSwitch),
    })

    expect(afterSwitch).toHaveLength(1)
  })

  it('keys an in-flight summary with the same system prompt sent to AI', async () => {
    useGraph.setState({
      settings: { ...useGraph.getState().settings, systemPrompt: 'Prompt A' },
    })
    const promptsSent: string[] = []
    const stream: CompletionStream = async (_instruction, opts) => {
      promptsSent.push(opts.systemPrompt)
      useGraph.setState({
        settings: { ...useGraph.getState().settings, systemPrompt: 'Prompt B' },
      })
      opts.onChunk('summary shaped by prompt A')
      return 'summary shaped by prompt A'
    }

    await compileUnderBudget(overBudgetCompile('first', 'second'), {
      stream,
    })

    expect(promptsSent).toEqual(['Prompt A'])
    expect(useGraph.getState().compactionSummaries[0]?.fingerprint).toBe(
      compactionFingerprint('a very long card text', 'default/model', 'Prompt A'),
    )
  })
})
