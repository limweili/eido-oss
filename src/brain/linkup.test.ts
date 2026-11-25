import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebToolError, fetchPage, searchWeb } from './linkup'

type Call = { url: string; init: RequestInit }

function stubFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    return respond(call)
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status })
}

// The vendor's one error envelope, verbatim from the live capture.
function refusal(status: number, code: string, headers?: Record<string, string>) {
  return new Response(
    JSON.stringify({ error: { code, details: [], message: code }, statusCode: status }),
    { status, headers },
  )
}

function sentBody(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>
}

const key = { apiKey: 'lk-test' }

describe('the run reach boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('searching', () => {
    it('sends the caller\'s depth and key, and maps sources to title, address, and snippet', async () => {
      const calls = stubFetch(() =>
        jsonResponse({
          results: [
            { type: 'text', name: 'A Page', url: 'https://example.com/a', content: 'What it said' },
            { type: 'image', name: 'A Picture', url: 'https://example.com/pic.jpg' },
            { type: 'text', url: 'https://www.example.com/b', content: 'Untitled but real' },
          ],
        }),
      )

      const result = await searchWeb('what is eido', { ...key, depth: 'standard' })

      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://api.linkup.so/v1/search')
      const headers = calls[0].init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer lk-test')
      expect(sentBody(calls[0])).toMatchObject({ q: 'what is eido', depth: 'standard' })
      // Image results carry no text a Run can use; a source without a title is
      // named by its host rather than left blank.
      expect(result.sources).toEqual([
        { title: 'A Page', url: 'https://example.com/a', snippet: 'What it said' },
        { title: 'example.com', url: 'https://www.example.com/b', snippet: 'Untitled but real' },
      ])
    })

    it('passes each depth through untouched and pins the output shape to sources', async () => {
      // The vendor's other output shapes are not reachable from this boundary
      // (#965): Eido runs the loop, the Run's model does the synthesis, and a
      // sourcedAnswer would pay for prose that model then rewrites.
      for (const depth of ['fast', 'standard', 'deep'] as const) {
        vi.unstubAllGlobals()
        const calls = stubFetch(() =>
          jsonResponse({ results: [{ type: 'text', name: 'T', url: 'https://e.com', content: 'c' }] }),
        )
        await searchWeb('q', { ...key, depth })
        expect(sentBody(calls[0]).depth).toBe(depth)
        expect(sentBody(calls[0]).outputType).toBe('searchResults')
      }
    })

    it('reports finding nothing as its own code, from the documented 400 and from an empty list alike', async () => {
      // The documented refusal: this is the epic's own user flow, so it must
      // never fall through to a generic failure.
      stubFetch(() => refusal(400, 'SEARCH_QUERY_NO_RESULT'))
      await expect(searchWeb('q', { ...key, depth: 'standard' })).rejects.toMatchObject({
        code: 'no-results',
      })

      vi.unstubAllGlobals()
      stubFetch(() => jsonResponse({ results: [] }))
      await expect(searchWeb('q', { ...key, depth: 'standard' })).rejects.toMatchObject({
        code: 'no-results',
      })
    })
  })

  describe('fetching a page', () => {
    it('renders scripts by default and hands back markdown for an ordinary page', async () => {
      const calls = stubFetch(() => jsonResponse({ markdown: '# Hi', contentType: 'html' }))

      const page = await fetchPage('https://example.com/a', key)

      expect(calls[0].url).toBe('https://api.linkup.so/v1/fetch')
      expect(sentBody(calls[0])).toEqual({ url: 'https://example.com/a', renderJs: true })
      expect(page).toMatchObject({ url: 'https://example.com/a', markdown: '# Hi' })
      expect(page.retrievedAt).toEqual(expect.any(String))
    })

    it('hands back markdown for a PDF, and turns script rendering off when told to', async () => {
      const calls = stubFetch(() => jsonResponse({ markdown: 'Extracted PDF text', contentType: 'pdf' }))

      const page = await fetchPage('https://example.com/paper.pdf', { ...key, renderJs: false })

      expect(sentBody(calls[0]).renderJs).toBe(false)
      expect(page.markdown).toBe('Extracted PDF text')
    })

    it('refuses an address that is not a web page before anything is fetched', async () => {
      const calls = stubFetch(() => jsonResponse({}))

      for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url', '']) {
        await expect(fetchPage(bad, key)).rejects.toMatchObject({ code: 'page-unreadable' })
      }
      expect(calls).toHaveLength(0)
    })

    it('maps each way a page can refuse to be read to its own code', async () => {
      const cases = [
        ['FETCH_RESPONSE_TOO_LARGE', 'page-too-large'],
        ['FETCH_UNSUPPORTED_CONTENT_TYPE', 'unsupported-content'],
        ['FETCH_TARGET_UNREACHABLE', 'page-unreadable'],
      ] as const
      for (const [vendorCode, code] of cases) {
        vi.unstubAllGlobals()
        stubFetch(() => refusal(400, vendorCode))
        await expect(fetchPage('https://example.com', key)).rejects.toMatchObject({ code })
      }
    })

    it('treats a page with nothing readable as unreadable', async () => {
      stubFetch(() => jsonResponse({ markdown: '   ' }))

      await expect(fetchPage('https://example.com', key)).rejects.toMatchObject({ code: 'page-unreadable' })
    })
  })

  describe('keys and money', () => {
    it('never sends an empty key to the wire', async () => {
      const calls = stubFetch(() => jsonResponse({}))

      await expect(searchWeb('q', { apiKey: '  ', depth: 'standard' })).rejects.toMatchObject(
        { code: 'no-key' },
      )
      expect(calls).toHaveLength(0)
    })

    it('reads a 402 by its body, so a missing key is a missing key and not a payment failure', async () => {
      // Verified live 2026-08-18: no Authorization header answers 402 with
      // this body, not the documented 401. The mapping must key on the code.
      stubFetch(() => refusal(402, 'X402_PAYMENT_REQUIRED'))
      await expect(searchWeb('q', { ...key, depth: 'standard' })).rejects.toMatchObject({
        code: 'no-key',
      })

      // The same status with a different body must NOT read as a missing key.
      // This is the assertion that fails if the mapping regresses to a status
      // check.
      vi.unstubAllGlobals()
      stubFetch(() => refusal(402, 'SETTLEMENT_FAILED'))
      const error = await searchWeb('q', { ...key, depth: 'standard' }).catch((e) => e)
      expect(error.code).not.toBe('no-key')
    })

    it('reports a wrong key as wrong, not as anything about payment', async () => {
      // Verified live 2026-08-18: a key that is present but wrong is 401
      // UNAUTHORIZED, distinct from the missing-key 402.
      stubFetch(() => refusal(401, 'UNAUTHORIZED'))

      await expect(fetchPage('https://example.com', key)).rejects.toMatchObject({ code: 'bad-key' })
    })

    it('tells rate limiting apart from exhausted credit under the one shared 429', async () => {
      // Same status, two meanings, two different sentences: one says wait, the
      // other says top up. Only the body separates them, so both cases here
      // would fail a status-keyed mapping.
      stubFetch(() => refusal(429, 'INSUFFICIENT_CREDITS'))
      await expect(searchWeb('q', { ...key, depth: 'standard' })).rejects.toMatchObject({
        code: 'out-of-credit',
      })

      vi.unstubAllGlobals()
      stubFetch(() => refusal(429, 'TOO_MANY_REQUESTS'))
      await expect(searchWeb('q', { ...key, depth: 'standard' })).rejects.toMatchObject({
        code: 'rate-limited',
      })
    })

    it('surfaces the rate-limit headers when present and stays quiet when absent', async () => {
      stubFetch(() =>
        refusal(429, 'TOO_MANY_REQUESTS', {
          'x-ratelimit-limit': '10',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1',
        }),
      )
      const limited = await searchWeb('q', { ...key, depth: 'standard' }).catch((e) => e)
      expect(limited.rateLimit).toEqual({ limit: 10, remaining: 0, resetSeconds: 1 })

      vi.unstubAllGlobals()
      stubFetch(() => refusal(429, 'TOO_MANY_REQUESTS'))
      const bare = await searchWeb('q', { ...key, depth: 'standard' }).catch((e) => e)
      expect(bare.code).toBe('rate-limited')
      expect(bare.rateLimit).toBeUndefined()
    })
  })

  describe('cancelling and the network', () => {
    it('stops before the network when already cancelled', async () => {
      const calls = stubFetch(() => jsonResponse({}))
      const controller = new AbortController()
      controller.abort()

      await expect(
        searchWeb('q', { ...key, depth: 'standard', signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'canceled' })
      expect(calls).toHaveLength(0)
    })

    it('reports an abandoned call as cancelled, and a dead network as unreachable', async () => {
      const controller = new AbortController()
      stubFetch(() => {
        controller.abort()
        throw new Error('aborted')
      })
      await expect(
        fetchPage('https://example.com', { ...key, signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'canceled' })

      vi.unstubAllGlobals()
      stubFetch(() => {
        throw new Error('network down')
      })
      await expect(fetchPage('https://example.com', key)).rejects.toMatchObject({ code: 'unreachable' })
    })
  })

  describe('when the provider misbehaves', () => {
    it('raises a WebToolError, never a bare fetch error, even for a body that is not JSON', async () => {
      stubFetch(() => new Response('not json', { status: 200 }))
      const error = await searchWeb('q', { ...key, depth: 'standard' }).catch((e) => e)
      expect(error).toBeInstanceOf(WebToolError)
      expect(error.code).toBe('failed')

      vi.unstubAllGlobals()
      stubFetch(() => new Response('<html>gateway</html>', { status: 502 }))
      const refused = await searchWeb('q', { ...key, depth: 'standard' }).catch((e) => e)
      expect(refused).toBeInstanceOf(WebToolError)
      expect(refused.code).toBe('failed')
    })

    it('collapses the provider\'s own trouble to a plain failure', async () => {
      // Observed live under a request burst: 500 INTERNAL_SERVER_ERROR.
      stubFetch(() => refusal(500, 'INTERNAL_SERVER_ERROR'))

      await expect(searchWeb('q', { ...key, depth: 'standard' })).rejects.toMatchObject({
        code: 'failed',
      })
    })
  })
})
