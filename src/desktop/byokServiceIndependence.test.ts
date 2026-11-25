import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCard } from '../brain/runEngine'
import { useGraph } from '../graph/store'
import type { Card } from '../graph/types'

const MODEL = 'openai/gpt-4.1-mini'
const CHAT_COMPLETIONS = 'https://openrouter.ai/api/v1/chat/completions'
const MODELS = 'https://openrouter.ai/api/v1/models'
const LINKUP_SEARCH = 'https://api.linkup.so/v1/search'


function askCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'byok-independence-ask',
    kind: 'askAi',
    blocks: [{ id: 'byok-independence-block', text: 'Answer the private question.' }],
    position: { x: 0, y: 0 },
    model: MODEL,
    ...overrides,
  }
}

function sseResponse(payloads: readonly unknown[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }), { status: 200 })
}

function completionResponse(text: string): Response {
  return sseResponse([{ choices: [{ delta: { content: text } }] }])
}

beforeEach(() => {
  useGraph.setState({
    cards: [askCard()],
    connections: [],
    outputs: [],
    runs: [],
    compactionSummaries: [],
    settings: {
      apiKey: '',
      linkupKey: '',
      model: MODEL,
      models: [MODEL],
      reasoningEffort: 'medium',
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('installed BYOK service independence', () => {
  it('finishes an OpenRouter Ask directly with the supplied key', async () => {
    useGraph.setState((state) => ({
      cards: [askCard({ agentic: true })],
      settings: { ...state.settings, apiKey: 'sk-personal-openrouter' },
    }))
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url === CHAT_COMPLETIONS) return completionResponse('Personal OpenRouter answer')
      if (url === MODELS) return new Response(JSON.stringify({ data: [] }), { status: 200 })
      throw new Error(`unexpected egress: ${url}`)
    }))

    await expect(runCard('byok-independence-ask')).resolves.toMatchObject({
      ok: true,
      status: 'done',
    })
    expect(requests.find(({ url }) => url === CHAT_COMPLETIONS)?.init?.headers)
      .toMatchObject({ Authorization: 'Bearer sk-personal-openrouter' })
    expect(JSON.stringify(useGraph.getState().snapshot())).not.toContain('sk-personal-openrouter')
    expect(JSON.stringify(useGraph.getState().runs)).not.toContain('sk-personal-openrouter')
  })

  it('uses a personal Linkup key through Ask execution', async () => {
    useGraph.setState((state) => ({
      cards: [askCard({ agentic: true })],
      settings: {
        ...state.settings,
        apiKey: 'sk-personal-openrouter',
        linkupKey: 'lk-personal-linkup',
      },
    }))
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    let completionCount = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url === CHAT_COMPLETIONS) {
        completionCount += 1
        return completionCount === 1
          ? sseResponse([{
              choices: [{ delta: {
                tool_calls: [{
                  index: 0,
                  id: 'personal-linkup-search-1',
                  function: {
                    name: 'search_web',
                    arguments: JSON.stringify({ query: 'private web question', depth: 'fast' }),
                  },
                }],
              } }],
            }])
          : completionResponse('Personal Linkup answer')
      }
      if (url === LINKUP_SEARCH) {
        return new Response(JSON.stringify({
          results: [{
            type: 'text',
            name: 'Personal source',
            url: 'https://example.test/personal-source',
            content: 'Personal source text',
          }],
        }), { status: 200 })
      }
      if (url === MODELS) return new Response(JSON.stringify({ data: [] }), { status: 200 })
      throw new Error(`unexpected egress: ${url}`)
    }))

    await expect(runCard('byok-independence-ask')).resolves.toMatchObject({
      ok: true,
      status: 'done',
    })
    // Model-window refresh may also query OpenRouter's public catalog. It is
    // provider egress, not an Eido control-plane call, so assert the actual
    // completion/tool route while allowing that independent refresh.
    const routeRequests = requests.filter(({ url }) => url === CHAT_COMPLETIONS || url === LINKUP_SEARCH)
    expect(routeRequests.map(({ url }) => url)).toEqual([
      CHAT_COMPLETIONS,
      LINKUP_SEARCH,
      CHAT_COMPLETIONS,
    ])
    const linkupRequest = requests.find(({ url }) => url === LINKUP_SEARCH)
    expect(linkupRequest?.init?.headers).toMatchObject({ Authorization: 'Bearer lk-personal-linkup' })
    expect(requests.filter(({ url }) => url === CHAT_COMPLETIONS)).toHaveLength(2)
    const runs = useGraph.getState().runs
    const run = runs[runs.length - 1]
    expect(run?.toolSteps).toEqual([{ kind: 'search', detail: 'private web question' }])
    expect(JSON.stringify(useGraph.getState().snapshot())).not.toMatch(/sk-personal-openrouter|lk-personal-linkup/)
    expect(JSON.stringify(run)).not.toMatch(/sk-personal-openrouter|lk-personal-linkup/)
  })

  it.each([
    ['bad-key', () => new Response(JSON.stringify({
      error: { code: 'UNAUTHORIZED', message: 'UNAUTHORIZED', details: [] },
      statusCode: 401,
    }), { status: 401 })],
    ['out-of-credit', () => new Response(JSON.stringify({
      error: { code: 'INSUFFICIENT_CREDITS', message: 'INSUFFICIENT_CREDITS', details: [] },
      statusCode: 429,
    }), { status: 429 })],
    ['rate-limited', () => new Response(JSON.stringify({
      error: { code: 'TOO_MANY_REQUESTS', message: 'TOO_MANY_REQUESTS', details: [] },
      statusCode: 429,
    }), { status: 429 })],
    ['no-results', () => new Response(JSON.stringify({ results: [] }), { status: 200 })],
    ['provider-5xx', () => new Response(JSON.stringify({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'INTERNAL_SERVER_ERROR', details: [] },
      statusCode: 500,
    }), { status: 500 })],
    ['parse-failure', () => new Response('not-json', { status: 200 })],
    ['transport-loss', () => { throw new Error('LINKUP_TRANSPORT_LOSS') }],
  ] as const)(
    'handles personal Linkup %s using the supplied key',
    async (_failureClass, linkupResponse) => {
      useGraph.setState((state) => ({
        cards: [askCard({ agentic: true })],
        connections: [],
        outputs: [],
        runs: [],
        settings: {
          ...state.settings,
          apiKey: 'sk-personal-openrouter',
          linkupKey: 'lk-personal-linkup',
        },
      }))
      const requests: string[] = []
      let completionCount = 0
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        requests.push(url)
        if (url === CHAT_COMPLETIONS) {
          completionCount += 1
          return completionCount === 1
            ? sseResponse([{
                choices: [{ delta: {
                  tool_calls: [{
                    index: 0,
                    id: `personal-linkup-failure-${String(_failureClass)}`,
                    function: {
                      name: 'search_web',
                      arguments: JSON.stringify({ query: 'private web question', depth: 'fast' }),
                    },
                  }],
                } }],
              }])
            : completionResponse('Answer after personal tool failure')
        }
        if (url === LINKUP_SEARCH) return linkupResponse()
        if (url === MODELS) return new Response(JSON.stringify({ data: [] }), { status: 200 })
        throw new Error(`unexpected egress: ${url}`)
      }))

      await expect(runCard('byok-independence-ask')).resolves.toMatchObject({
        ok: true,
        status: 'done',
      })
      expect(requests.filter((url) => url === LINKUP_SEARCH)).toHaveLength(1)
      expect(requests.filter((url) => url === CHAT_COMPLETIONS)).toHaveLength(2)
      expect(JSON.stringify(useGraph.getState().snapshot()))
        .not.toMatch(/sk-personal-openrouter|lk-personal-linkup|LINKUP_TRANSPORT_LOSS/)
    },
  )

  it.each(['web', 'research'] as const)(
    'runs a keyless local harness with %s reach',
    async (reachMode) => {
      useGraph.setState((state) => ({
        cards: [askCard({ model: 'sonnet', agentic: true, meta: { reachMode } })],
        settings: {
          ...state.settings,
          apiKey: '',
          model: 'sonnet',
          models: ['sonnet'],
          provider: 'claude-code',
          harnesses: {
            'claude-code': { command: 'claude' },
            codex: { command: 'codex' },
            antigravity: { command: 'agy' },
          },
        },
      }))
      const run = vi.fn(async (_request: unknown, onChunk: (text: string) => void) => {
        onChunk('Local answer')
        return { ok: true as const, text: 'Local answer' }
      })
      vi.stubGlobal('window', {
        eidoAiHarness: { run, cancel: vi.fn(async () => undefined) },
      })
      const egress = vi.fn(async (input: RequestInfo | URL) => {
        throw new Error(`unexpected local egress: ${String(input)}`)
      })
      vi.stubGlobal('fetch', egress)

      await expect(runCard('byok-independence-ask')).resolves.toMatchObject({
        ok: true,
        status: 'done',
      })
      expect(run).toHaveBeenCalledOnce()
      expect(useGraph.getState().runs.slice(-1)[0]?.agentic).toBe(true)
      expect(egress).not.toHaveBeenCalled()
    },
  )
})
