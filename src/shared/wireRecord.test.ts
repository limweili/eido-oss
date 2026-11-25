// Board Info's wire record (#968). The proofs here are the ticket's rules:
// off accumulates nothing, the buffer is bounded, no entry ever contains key
// material from a request that carried one, and nothing about the record
// reaches the Profile document.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchWeb } from '../brain/linkup'
import { resolveAiAccess } from '../brain/aiAccess'
import { streamCompletionWithAccess } from '../brain/openRouter'
import type { EidoToolSet } from '../brain/agenticRun'
import { useGraph } from '../graph/store'
import {
  clearWireRecord,
  isWireRecording,
  readWireRecord,
  setWireRecording,
  wireRecordFailure,
  wireRecordProviderRequest,
  wireRecordRequest,
  wireRecordToolCall,
  wireRecordToolResult,
  wireRecordWebResult,
  WIRE_RECORD_MAX_ENTRIES,
  WIRE_RECORD_MAX_STRING,
} from './wireRecord'

afterEach(() => {
  setWireRecording(false)
  vi.unstubAllGlobals()
})

function recordOneOfEach(): void {
  wireRecordProviderRequest('https://openrouter.ai/api/v1/chat/completions', [], false)
  wireRecordRequest('https://api.linkup.so/v1/search')
  wireRecordToolCall('search_web', '{"query":"x"}')
  wireRecordToolResult('search_web', 12, 300, 'ok')
  wireRecordWebResult('https://api.linkup.so/v1/search', 12, 300)
  wireRecordFailure('https://api.linkup.so/v1/search', 429, 'rate-limited')
}

describe('the wire record buffer', () => {
  it('accumulates nothing while off, before and after having been on', () => {
    recordOneOfEach()
    expect(readWireRecord()).toEqual([])
    expect(isWireRecording()).toBe(false)

    // Turning off drops the buffer itself, entries and all.
    setWireRecording(true)
    recordOneOfEach()
    expect(readWireRecord()).toHaveLength(6)
    setWireRecording(false)
    recordOneOfEach()
    expect(readWireRecord()).toEqual([])
  })

  it('is a ring: the newest entries win and the count never passes the cap', () => {
    setWireRecording(true)
    for (let index = 0; index < WIRE_RECORD_MAX_ENTRIES + 50; index += 1) {
      wireRecordToolCall(`tool_${index}`, '{}')
    }
    const entries = readWireRecord()
    expect(entries).toHaveLength(WIRE_RECORD_MAX_ENTRIES)
    expect(entries[0]?.tool).toBe('tool_50')
    expect(entries[entries.length - 1]?.tool).toBe(`tool_${WIRE_RECORD_MAX_ENTRIES + 49}`)
  })

  it('caps every kept string so one call cannot grow memory without limit', () => {
    setWireRecording(true)
    wireRecordToolCall('search_web', 'x'.repeat(WIRE_RECORD_MAX_STRING * 3))
    expect(readWireRecord()[0]?.args).toHaveLength(WIRE_RECORD_MAX_STRING)
  })

  it('keeps host and path only: no query string, and no unparseable address', () => {
    setWireRecording(true)
    wireRecordRequest('https://api.linkup.so/v1/search?leak=oops#frag')
    wireRecordRequest('not a url at all')
    const [parsed, garbage] = readWireRecord()
    expect(parsed).toMatchObject({ host: 'api.linkup.so', path: '/v1/search' })
    expect(JSON.stringify(parsed)).not.toContain('oops')
    expect(garbage).toMatchObject({ host: '', path: '' })
  })

  it('clears without turning off', () => {
    setWireRecording(true)
    recordOneOfEach()
    clearWireRecord()
    expect(readWireRecord()).toEqual([])
    expect(isWireRecording()).toBe(true)
  })
})

describe('no credential ever enters an entry', () => {
  const OPENROUTER_KEY = 'sk-or-v1-secret-openrouter-key-424242'
  const LINKUP_KEY = 'lk-secret-linkup-key-717171'

  // The engine hands the completion boundary a resolved BYOK grant now; the
  // raw key still reaches the wire exactly as before, which is the condition
  // this suite exists to prove harmless to the record.
  function byokGrant(credential: string, model: string) {
    const decision = resolveAiAccess({
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
    })
    if (!decision.ok) throw new Error('expected access grant')
    return decision.grant
  }

  function sse(payloads: unknown[]): Response {
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

  it('records a full tool-loop run without any key material from the credentialed requests', async () => {
    setWireRecording(true)
    const authorizations: string[] = []
    let providerRequests = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, request?: RequestInit) => {
      const headers = (request?.headers ?? {}) as Record<string, string>
      authorizations.push(headers.Authorization ?? '')
      if (String(input).includes('linkup')) {
        return new Response(
          JSON.stringify({
            results: [{ type: 'text', name: 'A page', url: 'https://example.com/a', content: 'facts' }],
          }),
          { status: 200 },
        )
      }
      providerRequests += 1
      return providerRequests === 1
        ? sse([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: 'call_a', function: { name: 'search_web', arguments: '{"query":"electron 40"}' } },
                    ],
                  },
                },
              ],
            },
          ])
        : sse([{ choices: [{ delta: { content: 'Done.' } }] }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const tools: EidoToolSet = {
      tools: [
        {
          declaration: {
            type: 'function',
            function: { name: 'search_web', description: 'Search.', parameters: { type: 'object' } },
          },
          matches: (name) => name === 'search_web',
          execute: async (args, signal) => {
            const result = await searchWeb(String(args.query), {
              apiKey: LINKUP_KEY,
              depth: 'fast',
              signal,
            })
            return { resultText: result.sources[0]?.snippet ?? '' }
          },
        },
      ],
      promptReserveTokens: 0,
      brief: 'Phrase lookups as instructions.',
    }

    await streamCompletionWithAccess('What shipped?', {
      accessGrant: byokGrant(OPENROUTER_KEY, 'openai/gpt-4o-mini'),
      model: 'openai/gpt-4o-mini',
      reasoningEffort: 'medium',
      systemPrompt: '',
      onChunk: () => {},
      agentic: true,
      eidoTools: tools,
    })

    // The requests really carried the credentials this test must prove absent.
    expect(authorizations).toContain(`Bearer ${OPENROUTER_KEY}`)
    expect(authorizations).toContain(`Bearer ${LINKUP_KEY}`)

    const entries = readWireRecord()
    // The whole run is legible: provider request with its declared tools and
    // the brief, the model's call with its arguments, the web edge's request
    // and result, the tool's result, and the final provider request.
    expect(entries.map((entry) => entry.kind)).toEqual([
      'request',
      'call',
      'request',
      'result',
      'result',
      'request',
    ])
    expect(entries[0]).toMatchObject({
      host: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      toolNames: ['search_web'],
      briefIncluded: true,
    })
    expect(entries[1]).toMatchObject({ tool: 'search_web', args: '{"query":"electron 40"}' })
    expect(entries[2]).toMatchObject({ host: 'api.linkup.so', path: '/v1/search' })
    expect(entries[4]).toMatchObject({ tool: 'search_web', outcome: 'ok' })

    const dump = JSON.stringify(entries)
    expect(dump).not.toContain(OPENROUTER_KEY)
    expect(dump).not.toContain(LINKUP_KEY)
    expect(dump).not.toContain('Authorization')
    expect(dump).not.toContain('Bearer')
  })

  it('records a refusal as status and kind, never the response body', async () => {
    setWireRecording(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'secret-body-text' } }),
          { status: 429 },
        ),
      ),
    )

    await expect(
      searchWeb('anything', { apiKey: LINKUP_KEY, depth: 'fast' }),
    ).rejects.toMatchObject({ code: 'rate-limited' })

    const entries = readWireRecord()
    expect(entries[1]).toMatchObject({ kind: 'failure', status: 429, outcome: 'rate-limited' })
    const dump = JSON.stringify(entries)
    expect(dump).not.toContain('secret-body-text')
    expect(dump).not.toContain(LINKUP_KEY)
  })

  it('shows a run that declared tools and called none as exactly that', async () => {
    // The case this ticket exists for (2026-08-18): the record must separate
    // "tools declared, model answered from memory" from "never declared".
    setWireRecording(true)
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ choices: [{ delta: { content: 'From memory.' } }] }])))

    await streamCompletionWithAccess('Question', {
      accessGrant: byokGrant(OPENROUTER_KEY, 'openai/gpt-4o-mini'),
      model: 'openai/gpt-4o-mini',
      reasoningEffort: 'medium',
      systemPrompt: '',
      onChunk: () => {},
      agentic: true,
    })

    const entries = readWireRecord()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'request',
      toolNames: ['openrouter:web_search', 'openrouter:web_fetch'],
      briefIncluded: false,
    })
  })
})

describe('nothing about the record reaches the Profile document', () => {
  it('saves a byte-identical Board whether the record is off or on and full', () => {
    // The snapshot stamps its own save time; the clock is pinned so the only
    // thing that could differ between the two serializations is the record.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'))
    try {
      const before = JSON.stringify(useGraph.getState().snapshot())

      setWireRecording(true)
      recordOneOfEach()
      const after = JSON.stringify(useGraph.getState().snapshot())

      expect(after).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })
})
