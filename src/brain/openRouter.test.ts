import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  THINKING_STEP_KEEP_CHARS,
  thinkingStepFrom,
  type EidoExecutedTool,
  type EidoToolSet,
} from './agenticRun'
import type { AiAccessDecision, AiAccessGrant } from './aiAccess'
import { resolveAiAccess } from './aiAccess'
import {
  AiError,
  contextOverflowLimit,
  streamCompletionWithAccess,
  TOOL_FAILURE_STOP_LIMIT,
  TOOL_FAILURE_STOP_NOTE,
  type ChatMessage,
  type StreamOptions,
} from './openRouter'
import type { RunToolStep } from './agenticRun'
import {
  COMPACTION_FAILURE_LIMIT,
  COMPACTION_HANDOFF_PREAMBLE,
  COMPACTION_SYSTEM_PROMPT,
  CONTEXT_EXHAUSTED_NOTE,
  estimateConversationTokens,
} from './conversationCompaction'
import { contextWindowFor, recordModelWindow, resetModelWindowsForTests } from './modelWindows'
import { calibratedTokens, resetTokenCalibrationForTests } from './tokenCalibration'

function streamingResponse(text = 'Done') {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`),
        )
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }),
    { status: 200 },
  )
}

function requireGrant(decision: AiAccessDecision) {
  if (!decision.ok) throw new Error(`expected access grant: ${decision.code}`)
  return decision.grant
}

function byokGrant(credential: string, model: string) {
  return requireGrant(resolveAiAccess({
    source: 'in-app',
    byokCredential: credential,
    requestedModel: model,
    providerModelIds: [model],
    executionPlan: {
      version: 1,
      visibleTurns: 1,
      providerCalls: 1,
      providerCallManifest: [{ callClass: 'visible-reply', providerModelId: model }],
    },
  }))
}

describe('OpenRouter completion boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('injects the Idea system prompt before Eido framing and the compiled instruction', async () => {
    const requests: RequestInit[] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      requests.push(request ?? {})
      return streamingResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    await streamCompletionWithAccess('Compiled card instruction', {
      accessGrant: byokGrant('test-key', 'openai/gpt-4o-mini'),
      model: 'openai/gpt-4o-mini',
      reasoningEffort: 'medium',
      systemPrompt: 'Keep answers concise. This Idea is a neighborhood bakery.',
      variationNote: 'Offer a substantially different direction.',
      onChunk: () => {},
    })

    const request = requests[0]
    const body = JSON.parse(String(request.body)) as {
      messages: Array<{ role: string; content: string }>
    }

    expect(body.messages).toEqual([
      {
        role: 'system',
        content: 'Keep answers concise. This Idea is a neighborhood bakery.',
      },
      {
        role: 'system',
        content: expect.stringContaining('You are Eido, a thinking partner.'),
      },
      { role: 'user', content: 'Compiled card instruction' },
    ])
    expect(body.messages[1].content).toContain('Offer a substantially different direction.')
  })

  it('fails closed before network egress when review receives any other model', async () => {
    vi.stubGlobal('window', {
      eidoDesktop: true,
      eidoProfileReview: true,
    })
    const fetchMock = vi.fn(async () => streamingResponse())
    vi.stubGlobal('fetch', fetchMock)

    await expect(streamCompletionWithAccess('Compiled card instruction', {
      accessGrant: byokGrant('present', 'another/provider-model'),
      model: 'another/provider-model',
      reasoningEffort: 'medium',
      systemPrompt: '',
      onChunk: () => {},
    })).rejects.toThrow('Development Profile review model is unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'Invalid API key', 'bad-key'],
    [403, 'Access denied', 'bad-key'],
    [402, 'Insufficient credits', 'http-402: Insufficient credits'],
    [429, 'Rate limited', 'http-429: Rate limited'],
    [500, 'Provider error', 'http-500: Provider error'],
  ] as const)('reports HTTP %i using the user key without retrying', async (status, body, message) => {
    const fetchMock = vi.fn(async () => new Response(body, { status }))
    vi.stubGlobal('fetch', fetchMock)

    const failure = await streamCompletionWithAccess('Compiled instruction', {
      accessGrant: byokGrant('user-key', 'test/model'),
      model: 'test/model',
      reasoningEffort: 'medium',
      systemPrompt: '',
      onChunk: () => {},
    }).then(() => undefined, (error: unknown) => error)

    expect(failure).toBeInstanceOf(AiError)
    expect((failure as AiError).message).toBe(message)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('runs a local provider through its completion function', async () => {
    const completion = vi.fn(async (_instruction: string, options: StreamOptions) => {
      options.onChunk('Local answer')
      return 'Local answer'
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const grant = requireGrant(resolveAiAccess({
      source: 'in-app',
      byokCredential: '',
      requestedModel: 'local-model',
      providerModelIds: ['local-model'],
      executionPlan: {
        version: 1,
        visibleTurns: 1,
        providerCalls: 1,
        providerCallManifest: [{ callClass: 'visible-reply', providerModelId: 'local-model' }],
      },
      localCompletion: completion,
    }))
    const chunks: string[] = []

    await expect(streamCompletionWithAccess('Compiled instruction', {
      accessGrant: grant,
      model: 'local-model',
      reasoningEffort: 'medium',
      systemPrompt: '',
      onChunk: (text) => chunks.push(text),
    })).resolves.toBe('Local answer')
    expect(chunks).toEqual(['Local answer'])
    expect(completion).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// An Agentic Run at the network boundary (ADR 0033). Two claims are load
// bearing here, and neither can be checked by reading OpenRouter's docs.
//
//   1. The tools are declared only when the Card asked for them, and the
//      request is otherwise exactly what it always was.
//   2. What came back is read correctly whether OpenRouter reports tool
//      activity as it streams or only on the finished message. Its
//      documentation does not commit to either, so the boundary handles both
//      and this file proves it, which is why no live capture gates the code.
describe('Agentic Runs on OpenRouter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function captureRequest(response: () => Response) {
    const requests: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      requests.push(request ?? {})
      return response()
    }))
    return () => JSON.parse(String(requests[0].body)) as Record<string, unknown>
  }

  function sse(payloads: unknown[]) {
    const encoder = new TextEncoder()
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const payload of payloads) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }),
      { status: 200 },
    )
  }

  const base = {
    model: 'openai/gpt-4o-mini',
    reasoningEffort: 'medium' as const,
    systemPrompt: '',
    onChunk: () => {},
  }

  function grant(): AiAccessGrant {
    return byokGrant('test-key', base.model)
  }

  it('declares web search and web fetch, with no ceiling on their use', async () => {
    const body = captureRequest(() => streamingResponse())

    await streamCompletionWithAccess('Find out what shipped.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
    })

    expect(body().tools).toEqual([
      { type: 'openrouter:web_search', parameters: { engine: 'auto' } },
      { type: 'openrouter:web_fetch', parameters: { engine: 'openrouter' } },
    ])
    // No max_uses anywhere: the model decides when it has enough, and Cancel is
    // the stop. A ceiling chosen here would truncate the long investigations
    // this exists to enable, invisibly.
    expect(JSON.stringify(body().tools)).not.toContain('max_uses')
  })

  it('sends no tools at all when the Card did not ask for an Agentic Run', async () => {
    const body = captureRequest(() => streamingResponse())

    await streamCompletionWithAccess('Write three story ideas.', {
      ...base,
      accessGrant: grant(),
    })

    expect(body()).not.toHaveProperty('tools')
  })

  it('reports each search and page as the stream reports them', async () => {
    const steps: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'web_search', arguments: '{"query":"electron' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ' 40 release notes"}' } }] } }] },
      { choices: [{ delta: { annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.test/40', title: 'Electron 40' } }] } }] },
      { choices: [{ delta: { content: 'Electron 40 shipped.' } }] },
    ])))

    await streamCompletionWithAccess('What shipped?', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      onToolStep: (step) => steps.push(step),
    })

    expect(steps).toEqual([
      { kind: 'search', detail: 'electron 40 release notes' },
      { kind: 'read', detail: 'https://example.test/40', title: 'Electron 40' },
    ])
  })

  it('reports the same activity when it arrives only on the finished message', async () => {
    const steps: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { choices: [{ delta: { content: 'Electron 40 shipped.' } }] },
      {
        choices: [{
          message: {
            tool_calls: [{ function: { name: 'web_search', arguments: '{"query":"electron 40 release notes"}' } }],
            annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.test/40', title: 'Electron 40' } }],
          },
        }],
      },
    ])))

    await streamCompletionWithAccess('What shipped?', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      onToolStep: (step) => steps.push(step),
    })

    expect(steps).toEqual([
      { kind: 'search', detail: 'electron 40 release notes' },
      { kind: 'read', detail: 'https://example.test/40', title: 'Electron 40' },
    ])
  })

  it('reports a page once, however many times it is cited', async () => {
    const steps: unknown[] = []
    const citation = { type: 'url_citation', url_citation: { url: 'https://example.test/40', title: 'Electron 40' } }
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { choices: [{ delta: { annotations: [citation] } }] },
      { choices: [{ delta: { content: 'One. ' } }] },
      { choices: [{ delta: { annotations: [citation, citation] } }] },
      { choices: [{ message: { annotations: [citation] } }] },
    ])))

    await streamCompletionWithAccess('What shipped?', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      onToolStep: (step) => steps.push(step),
    })

    expect(steps).toEqual([{ kind: 'read', detail: 'https://example.test/40', title: 'Electron 40' }])
  })

  it('still reports a tool whose arguments never finished arriving', async () => {
    // Silence would read as "this answer used nothing", which is a lie about
    // what it read. An incomplete step is reported without its detail instead.
    const steps: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'web_search', arguments: '{"query":"unfinis' } }] } }] },
      { choices: [{ delta: { content: 'Partial.' } }] },
    ])))

    await streamCompletionWithAccess('What shipped?', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      onToolStep: (step) => steps.push(step),
    })

    expect(steps).toEqual([{ kind: 'search', detail: '' }])
  })

  it('reports nothing when the model chose to use no tools', async () => {
    const steps: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async () => streamingResponse('Answered from what I already knew.')))

    await streamCompletionWithAccess('What shipped?', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      onToolStep: (step) => steps.push(step),
    })

    expect(steps).toEqual([])
  })
})

// Eido runs the tool loop (#961; #965 supersedes ADR 0033's "never"). Each
// test here pins a regression an adversarial review of the plan named before
// any code existed: a per-run reader landing iteration two's call on iteration
// one's fragment, intermediate prose concatenating into the saved answer, a
// 429 retried into instead of waited out, a failure spiral that never ends, a
// progressing run cut off by the guard meant for spirals, and a cancel that
// stops the stream but not the tool.
describe('Eido runs the tool loop', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const base = {
    model: 'openai/gpt-4o-mini',
    reasoningEffort: 'medium' as const,
    systemPrompt: '',
    onChunk: () => {},
  }

  function grant(): AiAccessGrant {
    return byokGrant('test-key', base.model)
  }

  function sse(payloads: unknown[]) {
    const encoder = new TextEncoder()
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const payload of payloads) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }),
      { status: 200 },
    )
  }

  // A scripted provider: each request consumes the next turn, and every
  // request body is kept for assertion.
  function scriptedFetch(turns: unknown[][]) {
    const bodies: Array<Record<string, unknown>> = []
    const mock = vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      bodies.push(JSON.parse(String(request?.body)) as Record<string, unknown>)
      return sse(turns[Math.min(bodies.length - 1, turns.length - 1)])
    })
    vi.stubGlobal('fetch', mock)
    return { bodies, mock }
  }

  function searchToolStub() {
    const calls: Record<string, unknown>[] = []
    const tool: EidoExecutedTool = {
      declaration: {
        type: 'function',
        function: { name: 'web_search', description: 'Search.', parameters: { type: 'object' } },
      },
      matches: (name) => name.includes('search'),
      execute: async (args) => {
        calls.push(args)
        return { resultText: `results for ${String(args.query)}`, step: { kind: 'search', detail: String(args.query) } }
      },
    }
    return { tool, calls }
  }

  function toolSet(tool: EidoExecutedTool, brief = ''): EidoToolSet {
    return { tools: [tool], promptReserveTokens: 0, brief }
  }

  it('holds the model to the set\'s required first call, then lets the loop go', async () => {
    // Research mode is not a hint: the person chose the mode, chose a depth
    // and pressed Run twice. Left to persuasion a small fast model answers
    // from memory in seconds and the trail comes back empty, which reads as a
    // broken feature (founder report 2026-08-18). So the first turn is forced,
    // and only the first: forcing every turn would trap a run in one tool.
    const { bodies } = scriptedFetch([
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'web_search', arguments: '{"query":"q"}' } }] } }] }],
      [{ choices: [{ delta: { content: 'Answered.' } }] }],
    ])
    const { tool } = searchToolStub()

    const text = await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: { ...toolSet(tool), requireFirstCall: 'web_search' },
    })

    expect(text).toBe('Answered.')
    expect(bodies[0].tool_choice).toEqual({ type: 'function', function: { name: 'web_search' } })
    expect(bodies[1].tool_choice).toBeUndefined()
  })

  it('leaves the model free when the set requires no first call', async () => {
    const { bodies } = scriptedFetch([[{ choices: [{ delta: { content: 'From memory.' } }] }]])
    const { tool } = searchToolStub()

    await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
    })

    expect(bodies[0].tool_choice).toBeUndefined()
  })

  it('executes the call, appends the result in the model shape, and streams the final answer', async () => {
    const { bodies } = scriptedFetch([
      [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'web_search', arguments: '{"query":"electr' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'on 40"}' } }] } }] },
      ],
      [{ choices: [{ delta: { content: 'Electron 40 shipped.' } }] }],
    ])
    const { tool, calls } = searchToolStub()
    const steps: unknown[] = []

    const text = await streamCompletionWithAccess('What shipped?', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
      onToolStep: (step) => steps.push(step),
    })

    expect(text).toBe('Electron 40 shipped.')
    expect(calls).toEqual([{ query: 'electron 40' }])
    expect(steps).toEqual([{ kind: 'search', detail: 'electron 40' }])
    const second = bodies[1] as { messages: Array<Record<string, unknown>>; tools: unknown }
    expect(second.tools).toEqual([tool.declaration])
    expect(second.messages[second.messages.length - 2]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'web_search', arguments: '{"query":"electron 40"}' } }],
    })
    expect(second.messages[second.messages.length - 1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_a',
      content: 'results for electron 40',
    })
  })

  it('keeps iterations apart: indices restart at zero, and the same search paid for twice is two lines', async () => {
    // The named trap: a reader reused across iterations would land the second
    // response's index-0 call on the first one's fragment, concatenate two
    // argument strings, and suppress the second step entirely.
    scriptedFetch([
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"same thing"}' } }] } }] }],
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c2', function: { name: 'web_search', arguments: '{"query":"same thing"}' } }] } }] }],
      [{ choices: [{ delta: { content: 'Done.' } }] }],
    ])
    const { tool, calls } = searchToolStub()
    const steps: unknown[] = []

    const text = await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
      onToolStep: (step) => steps.push(step),
    })

    expect(text).toBe('Done.')
    expect(calls).toEqual([{ query: 'same thing' }, { query: 'same thing' }])
    expect(steps).toEqual([
      { kind: 'search', detail: 'same thing' },
      { kind: 'search', detail: 'same thing' },
    ])
  })

  it('drops between-tools prose from the answer and says so through onAnswerRestart', async () => {
    scriptedFetch([
      [
        { choices: [{ delta: { content: 'Let me look. ' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"q"}' } }] } }] },
      ],
      [{ choices: [{ delta: { content: 'The answer.' } }] }],
    ])
    const { tool } = searchToolStub()
    const heard: string[] = []
    let restarts = 0

    const text = await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
      onChunk: (chunk) => heard.push(chunk),
      onAnswerRestart: () => {
        restarts += 1
        heard.length = 0
      },
    })

    expect(text).toBe('The answer.')
    expect(restarts).toBe(1)
    expect(heard.join('')).toBe('The answer.')
  })

  it('echoes the assistant turn reasoning back with the tool results', async () => {
    const { bodies } = scriptedFetch([
      [
        { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: 'thinking ', index: 0, format: 'unknown' }] } }] },
        { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: 'hard', index: 0 }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"q"}' } }] } }] },
      ],
      [{ choices: [{ delta: { content: 'Done.' } }] }],
    ])
    const { tool } = searchToolStub()

    await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
    })

    const second = bodies[1] as { messages: Array<Record<string, unknown>> }
    const assistant = second.messages.find((message) => message.role === 'assistant')!
    expect(assistant.reasoning_details).toEqual([
      { type: 'reasoning.text', text: 'thinking hard', index: 0, format: 'unknown' },
    ])
  })

  it('says what the model was thinking before the calls it led to, in order (#966)', async () => {
    scriptedFetch([
      [
        { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: 'Two are resellers, ', index: 0 }] } }] },
        { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: 'so the register decides it.', index: 0 }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"DOP register"}' } }] } }] },
      ],
      [
        // The final answer turn thinks too, but that reasoning sits between the
        // last lookup and the answer, so it is never a step.
        { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: 'Now I can answer.', index: 0 }] } }] },
        { choices: [{ delta: { content: 'Done.' } }] },
      ],
    ])
    const { tool } = searchToolStub()
    const steps: Array<{ kind: string; detail: string }> = []

    await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
      onToolStep: (step) => steps.push(step),
    })

    expect(steps).toEqual([
      { kind: 'thinking', detail: 'Two are resellers, so the register decides it.' },
      { kind: 'search', detail: 'DOP register' },
    ])
  })

  it('makes no thinking row from a signed or redacted block with no words (#966)', async () => {
    // Proof the model thought is not a record of what it thought. The lookups
    // still land.
    scriptedFetch([
      [
        { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque-signature', index: 0 }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"q"}' } }] } }] },
      ],
      [{ choices: [{ delta: { content: 'Done.' } }] }],
    ])
    const { tool } = searchToolStub()
    const steps: Array<{ kind: string }> = []

    await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
      onToolStep: (step) => steps.push(step),
    })

    expect(steps).toEqual([{ kind: 'search', detail: 'q' }])
  })

  it('bounds a kept thinking passage per step and marks the cut (#966)', () => {
    // The trail is saved with the Board; an unbounded record would grow every
    // saved Board without limit. The head is kept, and a shortened record
    // never passes as complete.
    const long = Array.from({ length: 600 }, (_, index) => `word${index}`).join(' ')
    const step = thinkingStepFrom([{ type: 'reasoning.text', text: long, index: 0 }])!

    expect(step.kind).toBe('thinking')
    expect(step.detail.length).toBeLessThanOrEqual(THINKING_STEP_KEEP_CHARS + 2)
    expect(step.detail.endsWith(' …')).toBe(true)
    expect(step.detail.startsWith('word0 word1')).toBe(true)

    // Under the bound, the passage is kept whole, and no reasoning at all is
    // no step rather than an empty one.
    expect(thinkingStepFrom([{ type: 'reasoning.text', text: 'short', index: 0 }])).toEqual({
      kind: 'thinking',
      detail: 'short',
    })
    expect(thinkingStepFrom([])).toBeNull()
  })

  it('puts the travelling brief in the system text when the tools ride, before the user turn', async () => {
    const { bodies } = scriptedFetch([[{ choices: [{ delta: { content: 'Done.' } }] }]])
    const { tool } = searchToolStub()

    await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool, 'How to phrase a lookup.'),
    })

    const first = bodies[0] as { messages: Array<{ role: string; content: string }> }
    const briefIndex = first.messages.findIndex((m) => m.content === 'How to phrase a lookup.')
    expect(first.messages[briefIndex]).toMatchObject({ role: 'system' })
    expect(briefIndex).toBeGreaterThanOrEqual(0)
    expect(briefIndex).toBeLessThan(first.messages.length - 1)
    expect(first.messages[first.messages.length - 1]).toMatchObject({ role: 'user' })
  })

  it('keeps the brief out of the prompt when reach is off or the tools do not ride', async () => {
    const { bodies } = scriptedFetch([[{ choices: [{ delta: { content: 'Done.' } }] }]])

    // Reach off entirely, then reach on without an Eido-executed set: the
    // provider path declares its own tools with no depth to teach, so brief
    // text there would be advice about parameters that do not exist.
    await streamCompletionWithAccess('Plain.', { ...base, accessGrant: grant() })
    await streamCompletionWithAccess('Provider tools.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
    })

    for (const body of bodies as Array<{ messages: Array<{ content: string }> }>) {
      expect(body.messages.some((m) => m.content.includes('phrase a lookup'))).toBe(false)
    }
  })

  it('never stops a run that is making progress, however many calls it spends', async () => {
    // Failures outnumber the guard's limit three to one here, but a success
    // always lands before five in a row, so the run must reach its answer
    // with every call executed. This is the guard's whole promise: it reads
    // progress, never spend.
    const failuresPerBurst = TOOL_FAILURE_STOP_LIMIT - 1
    const bursts = 3
    const turns: unknown[][] = []
    for (let burst = 0; burst < bursts; burst++) {
      for (let call = 0; call < failuresPerBurst; call++) {
        turns.push([{ choices: [{ delta: { tool_calls: [{ index: 0, id: `f${burst}-${call}`, function: { name: 'web_search', arguments: '{"query":"missing"}' } }] } }] }])
      }
      turns.push([{ choices: [{ delta: { tool_calls: [{ index: 0, id: `ok${burst}`, function: { name: 'web_search', arguments: '{"query":"found"}' } }] } }] }])
    }
    turns.push([{ choices: [{ delta: { content: 'Got there.' } }] }])
    const { mock } = scriptedFetch(turns)
    let executed = 0
    const tool: EidoExecutedTool = {
      declaration: { type: 'function', function: { name: 'web_search', description: 'Search.', parameters: {} } },
      matches: (name) => name.includes('search'),
      execute: async (args) => {
        executed += 1
        return args.query === 'found'
          ? { resultText: 'a result' }
          : { resultText: 'nothing came back', failed: true }
      },
    }

    const text = await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
    })

    expect(text).toBe('Got there.')
    expect(executed).toBe(bursts * (failuresPerBurst + 1))
    expect(mock).toHaveBeenCalledTimes(turns.length)
  })

  it('ends a run whose calls keep failing with nothing succeeding between them', async () => {
    // The provider is scripted to call forever: scriptedFetch repeats its
    // last turn, so only the guard can end this loop. Without it, a
    // persistent 429 or a dead host is an unbounded spin re-billing the whole
    // conversation every iteration.
    const { bodies, mock } = scriptedFetch([
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"q"}' } }] } }] }],
    ])
    let executed = 0
    const tool: EidoExecutedTool = {
      declaration: { type: 'function', function: { name: 'web_search', description: 'Search.', parameters: {} } },
      matches: (name) => name.includes('search'),
      execute: async () => {
        executed += 1
        return { resultText: 'the lookup failed', failed: true }
      },
    }

    await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
    })

    // Exactly the limit gets executed; the terminal request tells the model
    // why and forbids further calls, and a model that calls anyway has its
    // words returned rather than another iteration paid for.
    expect(executed).toBe(TOOL_FAILURE_STOP_LIMIT)
    expect(mock).toHaveBeenCalledTimes(TOOL_FAILURE_STOP_LIMIT + 1)
    const terminal = bodies[bodies.length - 1] as {
      messages: Array<{ role: string; content: string }>
      tool_choice?: unknown
    }
    expect(terminal.tool_choice).toBe('none')
    expect(terminal.messages.some(
      (message) => message.role === 'system' && message.content === TOOL_FAILURE_STOP_NOTE,
    )).toBe(true)
  })

  it('ends a run stuck on a tool name no executor claims', async () => {
    // Spending died with the budget, so a model hallucinating tool names has
    // nothing else to stop it: each turn gets a polite "no such tool" reply,
    // never trips backoff, and re-bills the whole conversation. The guard
    // counts these exactly like executor failures.
    const { mock } = scriptedFetch([
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'make_coffee', arguments: '{}' } }] } }] }],
    ])
    const { tool, calls } = searchToolStub()

    await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
    })

    expect(calls).toEqual([])
    expect(mock).toHaveBeenCalledTimes(TOOL_FAILURE_STOP_LIMIT + 1)
  })

  it('ends a run stuck on arguments that never parse', async () => {
    const { mock } = scriptedFetch([
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{not json' } }] } }] }],
    ])
    const { tool, calls } = searchToolStub()

    await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
    })

    expect(calls).toEqual([])
    expect(mock).toHaveBeenCalledTimes(TOOL_FAILURE_STOP_LIMIT + 1)
  })

  it('answers every reported call when the guard trips inside one turn of parallel calls', async () => {
    const calls = Array.from({ length: TOOL_FAILURE_STOP_LIMIT + 2 }, (_, index) => ({
      index,
      id: `c${index}`,
      function: { name: 'web_search', arguments: '{"query":"q"}' },
    }))
    const { bodies } = scriptedFetch([
      [{ choices: [{ delta: { tool_calls: calls } }] }],
      [{ choices: [{ delta: { content: 'Best I have.' } }] }],
    ])
    let executed = 0
    const tool: EidoExecutedTool = {
      declaration: { type: 'function', function: { name: 'web_search', description: 'Search.', parameters: {} } },
      matches: (name) => name.includes('search'),
      execute: async () => {
        executed += 1
        return { resultText: 'the lookup failed', failed: true }
      },
    }

    const text = await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
    })

    // The overflow calls are not executed, but each still gets a tool
    // message: a tool_call_id left unanswered is a malformed re-request.
    expect(text).toBe('Best I have.')
    expect(executed).toBe(TOOL_FAILURE_STOP_LIMIT)
    const second = bodies[1] as { messages: Array<{ role: string; tool_call_id?: string; content: string }> }
    const toolMessages = second.messages.filter((message) => message.role === 'tool')
    expect(toolMessages).toHaveLength(TOOL_FAILURE_STOP_LIMIT + 2)
    expect(toolMessages[toolMessages.length - 1]).toMatchObject({
      tool_call_id: `c${TOOL_FAILURE_STOP_LIMIT + 1}`,
      content: TOOL_FAILURE_STOP_NOTE,
    })
  })

  it('waits out a rate limit before the next request instead of retrying into it', async () => {
    vi.useFakeTimers()
    const { mock } = scriptedFetch([
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"q"}' } }] } }] }],
      [{ choices: [{ delta: { content: 'Done.' } }] }],
    ])
    const tool: EidoExecutedTool = {
      declaration: { type: 'function', function: { name: 'web_search', description: 'Search.', parameters: {} } },
      matches: (name) => name.includes('search'),
      execute: async () => ({
        resultText: 'slow down',
        step: { kind: 'trouble', detail: 'q', title: 'Rate limited' },
        waitSeconds: 5,
      }),
    }

    const done = streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(mock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4000)
    expect(mock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(done).resolves.toBe('Done.')
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('cancel reaches an in-flight tool call, not just the stream', async () => {
    scriptedFetch([
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"q"}' } }] } }] }],
    ])
    const controller = new AbortController()
    let sawAbort = false
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const tool: EidoExecutedTool = {
      declaration: { type: 'function', function: { name: 'web_search', description: 'Search.', parameters: {} } },
      matches: (name) => name.includes('search'),
      execute: (_args, signal) => {
        started()
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              sawAbort = true
              reject(new Error('canceled'))
            },
            { once: true },
          )
        })
      },
    }

    const done = streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      signal: controller.signal,
      eidoTools: toolSet(tool),
    })

    await startedPromise
    controller.abort()
    await expect(done).rejects.toThrow('canceled')
    expect(sawAbort).toBe(true)
  })

  it('answers a call for a tool that was never declared and keeps going, with no step', async () => {
    const { bodies } = scriptedFetch([
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'make_coffee', arguments: '{}' } }] } }] }],
      [{ choices: [{ delta: { content: 'Done.' } }] }],
    ])
    const { tool, calls } = searchToolStub()
    const steps: unknown[] = []

    const text = await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
      onToolStep: (step) => steps.push(step),
    })

    expect(text).toBe('Done.')
    expect(calls).toEqual([])
    expect(steps).toEqual([])
    const second = bodies[1] as { messages: Array<Record<string, unknown>> }
    expect(second.messages[second.messages.length - 1]).toMatchObject({ role: 'tool', tool_call_id: 'c1' })
  })

  it('without an Eido-executed set, the request is the single provider-tools request it always was', async () => {
    // The no-key path must not drift: tool calls in the stream are the
    // provider reporting its own server tools, never an invitation to loop.
    const { bodies, mock } = scriptedFetch([
      [
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'web_search', arguments: '{"query":"q"}' } }] } }] },
        { choices: [{ delta: { content: 'Answer.' } }] },
      ],
    ])
    const steps: unknown[] = []

    const text = await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      onToolStep: (step) => steps.push(step),
    })

    expect(text).toBe('Answer.')
    expect(mock).toHaveBeenCalledTimes(1)
    expect((bodies[0] as { tools: unknown }).tools).toEqual([
      { type: 'openrouter:web_search', parameters: { engine: 'auto' } },
      { type: 'openrouter:web_fetch', parameters: { engine: 'openrouter' } },
    ])
    expect(steps).toEqual([{ kind: 'search', detail: 'q' }])
  })

  it('reports a provider refusal during the tool loop without retrying the action', async () => {
    const { tool } = searchToolStub()
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"q"}' } }] } }] }])
      }
      return new Response(
        '{"error":{"code":402,"message":"Insufficient credits. Add more credits at https://openrouter.ai/settings/credits"}}',
        { status: 402 },
      )
    }))

    const failure = await streamCompletionWithAccess('Look.', {
      ...base,
      accessGrant: grant(),
      agentic: true,
      eidoTools: toolSet(tool),
    }).then(() => undefined, (error: unknown) => error)

    expect(calls).toBe(2)
    expect(failure).toBeInstanceOf(AiError)
    expect((failure as AiError).message).toMatch(/^http-402:/)
  })
})

// Auto-compaction inside the loop Eido runs itself (#1035, #1036, #1038).
//
// The claims that matter here cannot be read off OpenRouter's docs either:
// that the request which goes out after a compaction is still structurally
// valid, that a run which cannot be helped degrades truthfully instead of
// spinning, and that a refusal Eido did not predict is recoverable.
describe('staying inside the model window', () => {
  const WINDOW = 40_000
  const THRESHOLD = WINDOW * 0.8
  const MODEL = 'test/window'

  afterEach(() => {
    vi.unstubAllGlobals()
    resetModelWindowsForTests()
  })

  const base = {
    accessGrant: byokGrant('test-key', MODEL),
    model: MODEL,
    reasoningEffort: 'medium' as const,
    systemPrompt: '',
    onChunk: () => {},
  }

  type Frame = Record<string, unknown>

  function sseOf(payloads: Frame[]) {
    const encoder = new TextEncoder()
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const payload of payloads) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }),
      { status: 200 },
    )
  }

  // One turn that calls the search tool, and one that answers.
  const callTurn = (id: string, query: string): Frame[] => [
    { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name: 'web_search', arguments: JSON.stringify({ query }) } }] } }] },
  ]
  const answerTurn = (text: string): Frame[] => [{ choices: [{ delta: { content: text } }] }]

  type Sent = { body: Record<string, unknown>; messages: ChatMessage[]; isSummariser: boolean }

  // Each entry is the response to the request of the same index. Anything past
  // the end repeats the last entry, so a test only scripts what it cares about.
  function scripted(script: Array<Frame[] | Response>) {
    const sent: Sent[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      const body = JSON.parse(String(request?.body)) as Record<string, unknown>
      const messages = body.messages as ChatMessage[]
      sent.push({
        body,
        messages,
        isSummariser: !body.tools && String((messages[0] as { content?: string }).content ?? '')
          === COMPACTION_SYSTEM_PROMPT,
      })
      const entry = script[Math.min(sent.length - 1, script.length - 1)]
      return entry instanceof Response ? entry : sseOf(entry)
    }))
    return sent
  }

  function bigTool(chars: number) {
    const tool: EidoExecutedTool = {
      declaration: {
        type: 'function',
        function: { name: 'web_search', description: 'Search.', parameters: { type: 'object' } },
      },
      matches: (name) => name.includes('search'),
      execute: async (args) => ({
        resultText: `result for ${String(args.query)} `.padEnd(chars, 'x'),
        step: { kind: 'search', detail: String(args.query) },
      }),
    }
    return { tools: [tool], promptReserveTokens: 0, brief: '' } satisfies EidoToolSet
  }

  // The rule that fails at the provider rather than here.
  function pairingBreaks(messages: readonly ChatMessage[]): string[] {
    const problems: string[] = []
    const offered = new Set<string>()
    const answered = new Set<string>()
    for (const message of messages) {
      if (message.role === 'assistant') for (const call of message.tool_calls ?? []) offered.add(call.id)
      if (message.role === 'tool') {
        if (!offered.has(message.tool_call_id)) problems.push(`orphan ${message.tool_call_id}`)
        answered.add(message.tool_call_id)
      }
    }
    for (const id of offered) if (!answered.has(id)) problems.push(`unanswered ${id}`)
    return problems
  }

  it('compacts before the request that would pass the threshold, and keeps it valid', async () => {
    recordModelWindow(MODEL, WINDOW)
    const steps: RunToolStep[] = []
    const sent = scripted([
      callTurn('c1', 'one'),
      callTurn('c2', 'two'),
      callTurn('c3', 'three'),
      answerTurn('The handoff note.'),
      answerTurn('Final answer.'),
    ])

    const text = await streamCompletionWithAccess('Investigate.', {
      ...base,
      agentic: true,
      eidoTools: bigTool(60_000),
      onToolStep: (step) => steps.push(step),
    })

    expect(text).toBe('Final answer.')
    const summarisers = sent.filter((entry) => entry.isSummariser)
    expect(summarisers).toHaveLength(1)
    // It asked for the note before sending the turn, not after being refused.
    expect(sent.indexOf(summarisers[0])).toBe(3)

    const resumed = sent[4]
    expect(resumed.isSummariser).toBe(false)
    expect(pairingBreaks(resumed.messages)).toEqual([])
    expect(estimateConversationTokens(resumed.messages)).toBeLessThan(THRESHOLD)
    // The instruction survives verbatim; the note stands in for the history.
    expect(resumed.messages.some((m) => m.role === 'user' && m.content === 'Investigate.')).toBe(true)
    expect(
      resumed.messages.some((m) => m.role === 'user' && String(m.content).includes('The handoff note.')),
    ).toBe(true)
  })

  it('recovers from a refusal Eido did not predict, then stops rather than looping', async () => {
    let mainRequests = 0
    let summariserRequests = 0
    // The provider refuses every real request from the fourth onwards, whatever
    // is cut. The summariser always answers, so compaction always reports that
    // it reduced something and the loop always has a reason to try again.
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      const body = JSON.parse(String(request?.body)) as Record<string, unknown>
      const messages = body.messages as ChatMessage[]
      const isSummariser = !body.tools
        && String((messages[0] as { content?: string }).content ?? '') === COMPACTION_SYSTEM_PROMPT
      if (isSummariser) {
        summariserRequests += 1
        return sseOf(answerTurn('The handoff note.'))
      }
      mainRequests += 1
      if (mainRequests <= 3) return sseOf(callTurn(`c${mainRequests}`, `query ${mainRequests}`))
      return new Response(
        JSON.stringify({ error: { message: 'maximum context length is 40000 tokens.' } }),
        { status: 400 },
      )
    }))

    await expect(
      streamCompletionWithAccess('Investigate.', { ...base, agentic: true, eidoTools: bigTool(40_000) }),
    ).rejects.toThrow()

    // Three turns, a refusal Eido's own threshold never saw coming, one note,
    // one retry, one more refusal, stop. A second refusal in a row means length
    // was never the problem, and each further attempt would buy a full-size
    // request and a full-size summariser call for another one.
    expect(mainRequests).toBe(5)
    expect(summariserRequests).toBe(1)
  })

  it('shows the compaction in the trail, with the note behind it', async () => {
    recordModelWindow(MODEL, WINDOW)
    const steps: RunToolStep[] = []
    scripted([
      callTurn('c1', 'one'),
      callTurn('c2', 'two'),
      callTurn('c3', 'three'),
      answerTurn('What we established so far.'),
      answerTurn('Final answer.'),
    ])

    await streamCompletionWithAccess('Investigate.', {
      ...base,
      agentic: true,
      eidoTools: bigTool(60_000),
      onToolStep: (step) => steps.push(step),
    })

    const compactions = steps.filter((step) => step.kind === 'compaction')
    expect(compactions).toHaveLength(1)
    expect(compactions[0].detail).toBe('What we established so far.')
    // It sits after the lookups that filled the window, not before them.
    expect(steps.filter((step) => step.kind === 'search')).toHaveLength(3)
    expect(steps.indexOf(compactions[0])).toBeGreaterThan(steps.findIndex((s) => s.kind === 'search'))
  })

  it('leaves a short run alone', async () => {
    recordModelWindow(MODEL, WINDOW)
    const sent = scripted([callTurn('c1', 'one'), answerTurn('Done.')])

    await streamCompletionWithAccess('Investigate.', {
      ...base,
      agentic: true,
      eidoTools: bigTool(400),
    })

    expect(sent.some((entry) => entry.isSummariser)).toBe(false)
  })

  it('believes the provider about what it just spent, not only its own estimate', async () => {
    recordModelWindow(MODEL, WINDOW)
    // The conversation Eido can see is nowhere near the threshold. The usage
    // the provider reported says the request was, and that is what counts.
    const sent = scripted([
      [
        ...callTurn('c1', 'one'),
        { usage: { prompt_tokens: 25_000, completion_tokens: 100 } },
      ],
      answerTurn('The note.'),
      answerTurn('Final answer.'),
    ])

    await streamCompletionWithAccess('Investigate.', {
      ...base,
      agentic: true,
      eidoTools: bigTool(40_000),
    })

    expect(sent[1].isSummariser).toBe(true)
  })

  it('carries one note through a second compaction rather than stacking two', async () => {
    recordModelWindow(MODEL, WINDOW)
    const sent = scripted([
      callTurn('c1', 'one'),
      callTurn('c2', 'two'),
      callTurn('c3', 'three'),
      answerTurn('First note.'),
      callTurn('c4', 'four'),
      callTurn('c5', 'five'),
      callTurn('c6', 'six'),
      answerTurn('Second note.'),
      answerTurn('Final answer.'),
    ])

    const text = await streamCompletionWithAccess('Investigate.', {
      ...base,
      agentic: true,
      eidoTools: bigTool(60_000),
    })

    expect(text).toBe('Final answer.')
    const summarisers = sent.filter((entry) => entry.isSummariser)
    expect(summarisers).toHaveLength(2)
    // The second summariser was given the first note as material, once, and
    // without the preamble that wraps it in the conversation. Carried twice it
    // would double the cost at the moment the window is scarcest, and the
    // preamble's imperatives would arrive inside the record the summariser has
    // been told to transcribe.
    const material = String(summarisers[1].messages[1].content)
    expect(material).toContain('First note.')
    expect(material.split('First note.')).toHaveLength(2)
    expect(material).not.toContain(COMPACTION_HANDOFF_PREAMBLE)

    const resumed = sent[sent.length - 1]
    const notes = resumed.messages.filter(
      (m) => m.role === 'user' && String(m.content).includes('handoff note'),
    )
    expect(notes).toHaveLength(1)
    expect(String(notes[0].content)).toContain('Second note.')
    expect(String(notes[0].content)).not.toContain('First note.')
  })

  it('stops asking for tools, truthfully, when the note did not make room', async () => {
    recordModelWindow(MODEL, WINDOW)
    // The summariser returns something as long as what it replaced, so the
    // rebuilt conversation is still over the threshold.
    const sent = scripted([
      callTurn('c1', 'one'),
      callTurn('c2', 'two'),
      callTurn('c3', 'three'),
      answerTurn('note '.repeat(40_000)),
      answerTurn('Answered with what I had.'),
    ])

    const text = await streamCompletionWithAccess('Investigate.', {
      ...base,
      agentic: true,
      eidoTools: bigTool(60_000),
    })

    expect(text).toBe('Answered with what I had.')
    const resumed = sent[4]
    expect(resumed.body.tool_choice).toBe('none')
    const notes = resumed.messages.filter((m) => m.role === 'system').map((m) => String(m.content))
    expect(notes).toContain(CONTEXT_EXHAUSTED_NOTE)
    // It must not wear the repeated-failure guard's words: no lookup failed.
    expect(notes).not.toContain(TOOL_FAILURE_STOP_NOTE)
  })

  it('carries on with the history it had when the summariser fails', async () => {
    recordModelWindow(MODEL, WINDOW)
    const sent = scripted([
      callTurn('c1', 'one'),
      callTurn('c2', 'two'),
      callTurn('c3', 'three'),
      new Response('upstream exploded', { status: 500 }),
      answerTurn('Answered anyway.'),
    ])

    const text = await streamCompletionWithAccess('Investigate.', {
      ...base,
      agentic: true,
      eidoTools: bigTool(60_000),
    })

    expect(text).toBe('Answered anyway.')
    // The history it was given is the history it kept.
    expect(sent[4].messages.filter((m) => m.role === 'tool')).toHaveLength(3)
  })

  it('recovers from a refusal it did not predict by compacting and sending again', async () => {
    // No window recorded: Eido believes the generous fallback and walks into a
    // refusal it had no way to see coming.
    const sent = scripted([
      callTurn('c1', 'one'),
      callTurn('c2', 'two'),
      new Response(
        JSON.stringify({ error: { message: "This model's maximum context length is 40000 tokens." } }),
        { status: 400 },
      ),
      answerTurn('The note.'),
      answerTurn('Final answer.'),
    ])

    const text = await streamCompletionWithAccess('Investigate.', {
      ...base,
      agentic: true,
      eidoTools: bigTool(60_000),
    })

    expect(text).toBe('Final answer.')
    expect(sent[3].isSummariser).toBe(true)
    // It took the provider's number rather than keeping its own.
    expect(contextWindowFor(MODEL)).toBe(40_000)
  })

  it('fails the run when a second refusal follows the retry', async () => {
    const refusal = () =>
      new Response(JSON.stringify({ error: { message: 'maximum context length exceeded' } }), { status: 400 })
    scripted([
      callTurn('c1', 'one'),
      callTurn('c2', 'two'),
      refusal(),
      answerTurn('The note.'),
      refusal(),
    ])

    await expect(
      streamCompletionWithAccess('Investigate.', { ...base, agentic: true, eidoTools: bigTool(40_000) }),
    ).rejects.toThrow(/http-400/)
  })

  it('does not retry a refusal that has nothing to do with length', async () => {
    const sent = scripted([
      callTurn('c1', 'one'),
      new Response(JSON.stringify({ error: { message: 'that model is not available to you' } }), { status: 400 }),
    ])

    await expect(
      streamCompletionWithAccess('Investigate.', { ...base, agentic: true, eidoTools: bigTool(40_000) }),
    ).rejects.toThrow(/http-400/)
    expect(sent.some((entry) => entry.isSummariser)).toBe(false)
  })

  it('does not lose a turn from the count when the provider reports no usage', async () => {
    recordModelWindow(MODEL, WINDOW)
    // The provider reports usage on the first turn and then goes quiet, which
    // real providers do. The reported figure and the point it covers have to
    // move together: advancing the boundary against a stale figure drops the
    // silent turns out of the count entirely, and the hole grows until the run
    // walks into the refusal all of this exists to prevent.
    const sent = scripted([
      [...callTurn('c1', 'one'), { usage: { prompt_tokens: 5_000, completion_tokens: 100 } }],
      callTurn('c2', 'two'),
      callTurn('c3', 'three'),
      answerTurn('The note.'),
      answerTurn('Final answer.'),
    ])

    await streamCompletionWithAccess('Investigate.', {
      ...base,
      agentic: true,
      eidoTools: bigTool(40_000),
    })

    // Counting only the freshest turn would put the projection near 15k against
    // a 32k threshold, and nothing would ever compact.
    expect(sent[3].isSummariser).toBe(true)
  })

  it('keeps its tools when the summariser fails, and claims no room it has not proved', async () => {
    recordModelWindow(MODEL, WINDOW)
    const sent = scripted([
      callTurn('c1', 'one'),
      callTurn('c2', 'two'),
      callTurn('c3', 'three'),
      new Response('upstream exploded', { status: 500 }),
      answerTurn('Answered anyway.'),
    ])

    await streamCompletionWithAccess('Investigate.', {
      ...base,
      agentic: true,
      eidoTools: bigTool(60_000),
    })

    const resumed = sent[4]
    // A 500 from the summariser says nothing about how much room the run has.
    expect(resumed.body.tools).toBeTruthy()
    expect(resumed.body.tool_choice).toBeUndefined()
    expect(resumed.messages.map((m) => String(m.content))).not.toContain(CONTEXT_EXHAUSTED_NOTE)
  })

  it('stops asking a summariser that keeps failing, without taking the tools away', async () => {
    recordModelWindow(MODEL, WINDOW)
    const broken = () => new Response('upstream exploded', { status: 500 })
    const sent = scripted([
      callTurn('c1', 'one'),
      callTurn('c2', 'two'),
      callTurn('c3', 'three'),
      broken(),
      callTurn('c4', 'four'),
      broken(),
      callTurn('c5', 'five'),
      answerTurn('Answered anyway.'),
    ])

    const text = await streamCompletionWithAccess('Investigate.', {
      ...base,
      agentic: true,
      eidoTools: bigTool(60_000),
    })

    expect(text).toBe('Answered anyway.')
    // Each attempt is a full-price call at the size of the window. Two, then it
    // leaves the provider to be the one that says no.
    expect(sent.filter((entry) => entry.isSummariser)).toHaveLength(COMPACTION_FAILURE_LIMIT)
    expect(sent[sent.length - 1].body.tools).toBeTruthy()
  })

  it('does not pay for a retry of a request that cannot have changed', async () => {
    // Refused on the very first request, with no history to cut. Compacting
    // would return the same conversation, so the retry would be the same bytes
    // or, once a note is appended, more of them.
    const sent = scripted([
      new Response(
        JSON.stringify({ error: { message: 'prompt is too long: 210000 tokens' } }),
        { status: 400 },
      ),
    ])

    await expect(
      streamCompletionWithAccess('An enormous compiled instruction.', {
        ...base,
        agentic: true,
        eidoTools: bigTool(60_000),
      }),
    ).rejects.toThrow(/http-400/)
    expect(sent).toHaveLength(1)
  })
})

// What a refusal actually proves. This is the one number in the feature that
// persists on the device across runs, so a misread here is not a bad turn, it
// is a model permanently believed to be smaller or larger than it is.
describe('reading a provider refusal', () => {
  it('takes the limit, not the count that broke it', () => {
    expect(
      contextOverflowLimit(
        400,
        "This model's maximum context length is 128000 tokens. However, your messages resulted in 143021 tokens.",
      ),
    ).toBe(128_000)
  })

  it('discards a number the body cap clipped in half', () => {
    // The body is read to a cap, so the last number in it may be a fragment.
    // Recorded, "1280" from "128000" would set a window a hundred times too
    // small and degrade every later run on that model before it started.
    expect(contextOverflowLimit(400, 'maximum context length is 1280')).toBeNull()
  })

  it('is an overflow with no usable number when the message states none', () => {
    expect(contextOverflowLimit(400, 'context length exceeded')).toBeNull()
  })

  it('does not read a completion ceiling as a context window', () => {
    // Refused for asking for too long an ANSWER. Sending a shorter conversation
    // fixes nothing, and neither number here is this model's window.
    //
    // The body is the real Anthropic-via-OpenRouter wording, which is the one
    // that matters: it ends with "reduce the length of the messages", so it
    // reads as an overflow on every phrase test. Only the completion-ceiling
    // exclusion keeps 32768 from being recorded as the window of a 200k model.
    expect(
      contextOverflowLimit(
        400,
        'max_tokens: 200000 > 32768, which is the maximum allowed number of output tokens for '
          + 'claude-sonnet-4. Please reduce the length of the messages or completion.',
      ),
    ).toBeUndefined()
  })

  it('reads the stated limit, not the smallest number in the breakdown', () => {
    // The commonest overflow wording states four numbers, and the smallest is
    // the completion allowance. Recorded as the window it would shrink this
    // model to an eighth of its size on this device, permanently: a correction
    // survives every catalog refresh while the published number holds.
    expect(
      contextOverflowLimit(
        400,
        "This model's maximum context length is 128000 tokens. However, you requested 132000 "
          + 'tokens (116000 in the messages, 16000 in the completion). Please reduce the length '
          + 'of the messages or completion.',
      ),
    ).toBe(128_000)
  })

  it('reads a limit that the provider states inside brackets', () => {
    // Some providers bracket BOTH numbers. Discarding bracketed text to get rid
    // of the breakdown would discard the limit here and leave nothing at all.
    expect(
      contextOverflowLimit(
        400,
        'The input token count (1050000) exceeds the maximum number of tokens allowed (1000000).',
      ),
    ).toBe(1_000_000)
  })

  it('still takes the smaller number when nothing says which is the limit', () => {
    // An unfamiliar wording that labels nothing. The count that broke a limit is
    // by definition larger than the limit it broke, so the smaller one is it.
    expect(contextOverflowLimit(400, 'context length exceeded: 143021 against 128000.')).toBe(
      128_000,
    )
  })

  it('leaves every unrelated failure alone', () => {
    expect(contextOverflowLimit(400, 'that model is not available to you')).toBeUndefined()
    expect(contextOverflowLimit(429, 'context length exceeded')).toBeUndefined()
    expect(contextOverflowLimit(500, 'context length exceeded')).toBeUndefined()
  })

  it('trusts the one status that cannot mean anything else', () => {
    expect(contextOverflowLimit(413, '<html><body>Payload Too Large</body></html>')).toBeNull()
  })
})

// ---- learning what the estimator gets wrong ---------------------------------

describe('what the provider says a request really cost', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetTokenCalibrationForTests()
  })

  function responseWithUsage(promptTokens: number, cachedTokens = 0) {
    const encoder = new TextEncoder()
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const payload of [
            { choices: [{ delta: { content: 'Done' } }] },
            {
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: 40,
                prompt_tokens_details: { cached_tokens: cachedTokens },
              },
            },
          ]) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }),
      { status: 200 },
    )
  }

  it('corrects later estimates for this model by what it was just charged', async () => {
    resetTokenCalibrationForTests()
    const instruction = 'word '.repeat(8_000)
    const estimated = estimateConversationTokens([{ role: 'user', content: instruction }])
    vi.stubGlobal('fetch', vi.fn(async () => responseWithUsage(Math.round(estimated * 1.3))))

    await streamCompletionWithAccess(instruction, {
      accessGrant: byokGrant('test-key', 'heavy/tokenizer'),
      model: 'heavy/tokenizer',
      reasoningEffort: 'medium',
      systemPrompt: '',
      onChunk: () => {},
    })

    // A model that charges a third more than QuadChars expects must be read as
    // a third fuller, or every threshold built on the estimate fires late.
    expect(calibratedTokens('heavy/tokenizer', 10_000)).toBeGreaterThan(12_000)
    expect(calibratedTokens('heavy/tokenizer', 10_000)).toBeLessThan(14_000)
  })

  it('learns nothing from a request carrying a picture', async () => {
    resetTokenCalibrationForTests()
    const instruction = 'word '.repeat(8_000)
    const estimated = estimateConversationTokens([{ role: 'user', content: instruction }])
    // The provider charges for the image; the estimator only ever saw a
    // filename. That gap is the attachment, not the tokenizer, and using it
    // would move the threshold on every later text-only request.
    vi.stubGlobal('fetch', vi.fn(async () => responseWithUsage(Math.round(estimated * 1.6))))

    await streamCompletionWithAccess(instruction, {
      accessGrant: byokGrant('test-key', 'seen/with-a-picture'),
      model: 'seen/with-a-picture',
      reasoningEffort: 'medium',
      systemPrompt: '',
      assets: [{ kind: 'image', name: 'chart.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }],
      onChunk: () => {},
    })

    expect(calibratedTokens('seen/with-a-picture', 10_000)).toBe(10_000)
  })

  it('learns nothing from a request that declares tools', async () => {
    resetTokenCalibrationForTests()
    const instruction = 'word '.repeat(8_000)
    const estimated = estimateConversationTokens([{ role: 'user', content: instruction }])
    // The declarations never enter `messages`, and the provider expands its
    // server tools into full schemas before charging for them. That gap is a
    // fixed lump, not this model's tokenizer, and as a ratio it would read
    // every later card on this model high.
    vi.stubGlobal('fetch', vi.fn(async () => responseWithUsage(Math.round(estimated * 1.6))))

    await streamCompletionWithAccess(instruction, {
      accessGrant: byokGrant('test-key', 'seen/with-tools'),
      model: 'seen/with-tools',
      reasoningEffort: 'medium',
      systemPrompt: '',
      agentic: true,
      onChunk: () => {},
    })

    expect(calibratedTokens('seen/with-tools', 10_000)).toBe(10_000)
  })

  it('learns nothing when the provider served part of the prompt from its cache', async () => {
    resetTokenCalibrationForTests()
    const instruction = 'word '.repeat(8_000)
    const estimated = estimateConversationTokens([{ role: 'user', content: instruction }])
    // A count net of cache reads would teach a ratio below 1, and reading a
    // full card as having room is the one direction that ends in the refusal
    // this feature exists to prevent.
    vi.stubGlobal('fetch', vi.fn(async () => responseWithUsage(Math.round(estimated * 0.6), 4_000)))

    await streamCompletionWithAccess(instruction, {
      accessGrant: byokGrant('test-key', 'seen/with-a-cache'),
      model: 'seen/with-a-cache',
      reasoningEffort: 'medium',
      systemPrompt: '',
      onChunk: () => {},
    })

    expect(calibratedTokens('seen/with-a-cache', 10_000)).toBe(10_000)
  })

  it('leaves the estimate alone for a model it has never been told about', async () => {
    resetTokenCalibrationForTests()
    expect(calibratedTokens('never/seen', 10_000)).toBe(10_000)
  })
})
