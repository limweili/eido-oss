// The executor injection point, proven at its real seam: these tests run the
// actual Linkup boundary underneath the executors, stubbing only the network,
// so the model's parameters reaching the wire, the pinned output shape, the
// cap, and the failure mapping are checked as one behaviour rather than as
// internals (#961, #965, ADR 0028).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { words } from '../shared/words'
import { eidoWebToolSetFor, resumeResearchJob, WEB_TOOL_BRIEF } from './webTools'

const settings = { linkupKey: 'lk-test' }

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), { status: 200, ...init })
}

function stubSearchWire() {
  const bodies: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
    bodies.push(JSON.parse(String(request?.body)) as Record<string, unknown>)
    return jsonResponse({ results: [{ type: 'text', name: 'A', url: 'https://a.test', content: 'a' }] })
  }))
  return bodies
}

function searchToolOf(mode?: 'web' | 'research') {
  return eidoWebToolSetFor(settings, mode)!.tools.find((tool) => tool.matches('search_web'))!
}

afterEach(() => vi.unstubAllGlobals())

describe('eidoWebToolSetFor', () => {
  it('builds nothing without a Linkup key, so the proven provider path runs instead', () => {
    expect(eidoWebToolSetFor({})).toBeUndefined()
    expect(eidoWebToolSetFor({ linkupKey: '   ' })).toBeUndefined()
  })

  it('declares the synchronous pair in web mode and adds research only when the Card armed it', () => {
    const names = (mode?: 'web' | 'research') =>
      eidoWebToolSetFor(settings, mode)!.tools.map((tool) => tool.declaration.function.name)
    // An absent or unrecognised mode is web: never the warned-about endpoint.
    expect(names()).toEqual(['search_web', 'fetch_page'])
    expect(names('web')).toEqual(['search_web', 'fetch_page'])
    expect(names('research')).toEqual(['search_web', 'fetch_page', 'research'])
  })

  it('makes the research call compulsory on the first turn of a research run, and never in web mode', () => {
    // The mode was chosen, a depth was chosen and Run was pressed twice. A run
    // that then answers from memory has spent nothing and delivered nothing
    // the mode promised, so the first call is not left to persuasion.
    expect(eidoWebToolSetFor(settings, 'research')!.requireFirstCall).toBe('research')
    expect(eidoWebToolSetFor(settings, 'web')!.requireFirstCall).toBeUndefined()
    expect(eidoWebToolSetFor(settings)!.requireFirstCall).toBeUndefined()
  })

  it('requires search depth and the research mode, and never declares reasoningDepth at all', () => {
    const set = eidoWebToolSetFor(settings, 'research')!
    // A JSON-schema default is advisory: a model that omitted depth would
    // silently get fast for an instruction-shaped query. Required makes the
    // choice conscious; the rule to default to fast lives in the prose.
    expect(set.tools[0].declaration.function.parameters.required).toEqual(['query', 'depth'])
    // Research depth is the user's money, not the model's machinery (#971):
    // the parameter is gone from the schema entirely, because a parameter
    // that does not exist is one the model cannot be talked into spending
    // through.
    expect(set.tools[2].declaration.function.parameters.required).toEqual(['query', 'mode'])
    const researchParams = set.tools[2].declaration.function.parameters as {
      properties: Record<string, unknown>
    }
    expect(researchParams.properties).not.toHaveProperty('reasoningDepth')
    expect(JSON.stringify(set.tools[2].declaration)).not.toContain('reasoningDepth')
  })

  it('routes a call named exactly research to the research executor, never the search one', () => {
    // "research" contains "search": a substring matcher would land a
    // research call on the search executor silently, with arguments that
    // happen to fit. The loop takes the first matching tool, so this pins
    // that exactly one tool claims each declared name.
    const set = eidoWebToolSetFor(settings, 'research')!
    const claimants = set.tools.filter((tool) => tool.matches('research'))
    expect(claimants.map((tool) => tool.declaration.function.name)).toEqual(['research'])
    expect(set.tools[0].matches('research')).toBe(false)
    expect(set.tools.filter((tool) => tool.matches('search_web'))).toHaveLength(1)
    expect(set.tools.filter((tool) => tool.matches('fetch_page'))).toHaveLength(1)
  })

  it('carries the travelling brief so the transport can put it in the prompt', () => {
    expect(eidoWebToolSetFor(settings)!.brief).toBe(WEB_TOOL_BRIEF)
    expect(WEB_TOOL_BRIEF).toContain('cannot discover a URL')
    expect(WEB_TOOL_BRIEF).toContain('Default to `fast`')
  })

  it('teaches the selection rules in the descriptions, where the model reads them', () => {
    const set = eidoWebToolSetFor(settings)!
    const search = set.tools[0].declaration.function
    // The one hard rule the vendor names first, and the chain that picks a
    // depth, live on the tool itself: a model deciding per call must have the
    // rule in front of it.
    expect(search.description).toContain('standard cannot discover a URL')
    expect(search.description).toContain('three questions')
    const depth = (search.parameters as { properties: Record<string, { enum?: string[] }> }).properties.depth
    expect(depth.enum).toEqual(['fast', 'standard', 'deep'])
  })
})

describe('the search executor', () => {
  it('reads an omitted or invented depth as fast on the wire, never a silent upgrade', async () => {
    // The declaration requires depth, but the provider is what enforces
    // required; a model that slips one anyway must land on the cheap tier.
    const bodies = stubSearchWire()
    const search = searchToolOf()

    await search.execute({ query: 'plain' }, undefined)
    await search.execute({ query: 'made up', depth: 'exhaustive' }, undefined)

    expect(bodies.map((body) => body.depth)).toEqual(['fast', 'fast'])
  })

  it('sends the depth the model chose, and pins the output shape against its choice', async () => {
    const bodies = stubSearchWire()
    const search = searchToolOf()

    await search.execute({ query: 'a', depth: 'standard' }, undefined)
    await search.execute({ query: 'b', depth: 'deep', outputType: 'sourcedAnswer' }, undefined)

    expect(bodies.map((body) => body.depth)).toEqual(['standard', 'deep'])
    // Eido runs the loop and this model does the synthesis: outputType is not
    // declared, and a model that tries anyway is ignored.
    expect(bodies.every((body) => body.outputType === 'searchResults')).toBe(true)
    const declared = searchToolOf().declaration.function.parameters as { properties: Record<string, unknown> }
    expect(declared.properties).not.toHaveProperty('outputType')
  })

  it('carries the domain and date filters to the wire, and omits what was not chosen', async () => {
    const bodies = stubSearchWire()
    const search = searchToolOf()

    await search.execute(
      {
        query: 'filtered',
        includeDomains: ['wikipedia.org'],
        excludeDomains: ['reddit.com'],
        fromDate: '2026-01-01',
        toDate: '2026-08-18',
      },
      undefined,
    )
    await search.execute({ query: 'plain' }, undefined)

    expect(bodies[0]).toMatchObject({
      includeDomains: ['wikipedia.org'],
      excludeDomains: ['reddit.com'],
      fromDate: '2026-01-01',
      toDate: '2026-08-18',
    })
    for (const key of ['includeDomains', 'excludeDomains', 'fromDate', 'toDate']) {
      expect(bodies[1]).not.toHaveProperty(key)
    }
  })

  it('hands the model ranked sources and the Card the query Eido paid for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      results: [{ type: 'text', name: 'Electron 40', url: 'https://electron.test/40', content: 'It shipped.' }],
    })))
    const search = eidoWebToolSetFor(settings)!.tools[0]

    const outcome = await search.execute({ query: 'electron 40' }, undefined)

    expect(outcome.step).toEqual({ kind: 'search', detail: 'electron 40' })
    expect(outcome.failed).toBeUndefined()
    expect(outcome.resultText).toContain('Electron 40')
    expect(outcome.resultText).toContain('https://electron.test/40')
    expect(outcome.resultText).toContain('It shipped.')
  })

  it('turns a rate limit into a wait the loop can honour, marked failed for the guard', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ statusCode: 429, error: { code: 'TOO_MANY_REQUESTS', message: 'slow down' } }),
      { status: 429, headers: { 'x-ratelimit-reset': '3' } },
    )))
    const search = eidoWebToolSetFor(settings)!.tools[0]

    const outcome = await search.execute({ query: 'q' }, undefined)

    expect(outcome.waitSeconds).toBe(3)
    expect(outcome.failed).toBe(true)
    expect(outcome.step).toEqual({ kind: 'trouble', detail: 'q', title: words.webErrorRateLimited })
    expect(outcome.resultText).toContain('wait')
  })

  it('a failed lookup answers the model and lands on the Card as a step with plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ statusCode: 400, error: { code: 'SEARCH_QUERY_NO_RESULT', message: 'none' } }),
      { status: 400 },
    )))
    const search = eidoWebToolSetFor(settings)!.tools[0]

    const outcome = await search.execute({ query: 'gibberish' }, undefined)

    expect(outcome.failed).toBe(true)
    expect(outcome.step).toEqual({ kind: 'trouble', detail: 'gibberish', title: words.webSearchErrorNoResults })
    expect(outcome.resultText).toContain('no results')
  })

  it('caps a long source list by dropping whole sources, so every kept title keeps its address', async () => {
    // Slicing the joined list could cut a source's URL out from under its
    // title, and the model might then cite a page it cannot name. Whole
    // sources survive or are dropped together, and the drop is said.
    const results = Array.from({ length: 40 }, (_, index) => ({
      type: 'text',
      name: `Source ${index}`,
      url: `https://s.test/${index}`,
      content: 'x'.repeat(1_000),
    }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results })))
    const search = eidoWebToolSetFor(settings)!.tools[0]

    const outcome = await search.execute({ query: 'wide', depth: 'standard' }, undefined)

    expect(outcome.resultText.length).toBeLessThan(18_000)
    expect(outcome.resultText).toContain('sources so this fits')
    const kept = [...outcome.resultText.matchAll(/Source (\d+)/g)].map((match) => Number(match[1]))
    for (const index of kept) {
      expect(outcome.resultText).toContain(`https://s.test/${index}`)
    }
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(40)
  })

  it('cancel is the one failure that escapes: the loop must stop, not message the model', async () => {
    const controller = new AbortController()
    controller.abort()
    const search = eidoWebToolSetFor(settings)!.tools[0]

    await expect(search.execute({ query: 'q' }, controller.signal)).rejects.toMatchObject({ code: 'canceled' })
  })
})

describe('the page executor', () => {
  it('renders scripts by default, against the API default and on vendor advice, and honours an explicit off', async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      bodies.push(JSON.parse(String(request?.body)) as Record<string, unknown>)
      return jsonResponse({ markdown: 'content' })
    }))
    const read = eidoWebToolSetFor(settings)!.tools[1]

    await read.execute({ url: 'https://a.test/page' }, undefined)
    await read.execute({ url: 'https://a.test/static', renderJs: false }, undefined)
    await read.execute({ url: 'https://a.test/hard', mode: 'pro' }, undefined)

    expect(bodies.map((body) => body.renderJs)).toEqual([true, false, true])
    // Only the upgrade is written; standard stays the vendor's own unwritten
    // default so the ordinary request does not change shape.
    expect(bodies[0]).not.toHaveProperty('mode')
    expect(bodies[2].mode).toBe('pro')
  })

  it('caps an oversized page head-weighted before it can enter the prompt, and says so to the model', async () => {
    const markdown = 'H'.repeat(40_000) + 'MIDDLE' + 'T'.repeat(40_000)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ markdown })))
    const read = eidoWebToolSetFor(settings)!.tools[1]

    const outcome = await read.execute({ url: 'https://example.test/big' }, undefined)

    expect(outcome.step?.kind).toBe('read')
    expect(outcome.step?.detail).toContain('example.test/big')
    expect(outcome.resultText.length).toBeLessThan(17_000)
    expect(outcome.resultText).toContain('cut')
    expect(outcome.resultText.startsWith('HHHH')).toBe(true)
    expect(outcome.resultText.endsWith('TTTT')).toBe(true)
    expect(outcome.resultText).not.toContain('MIDDLE')
  })

  it('refuses an address that could never be a page before any network or spend', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const read = eidoWebToolSetFor(settings)!.tools[1]

    const outcome = await read.execute({ url: 'file:///etc/passwd' }, undefined)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(outcome.failed).toBe(true)
    expect(outcome.step).toEqual({
      kind: 'trouble',
      detail: 'file:///etc/passwd',
      title: words.webSearchErrorPageUnreadable,
    })
  })
})

describe('the research executor', () => {
  // The wire, scripted: one POST acknowledgement, then one scripted GET per
  // poll, repeating the last entry if the loop outlives the script. Requests
  // are recorded so the tests can pin what was submitted and when.
  function stubResearchWire(polls: Array<Record<string, unknown> | Response>) {
    const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
    let pollAt = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, request?: RequestInit) => {
      const url = String(input)
      const method = request?.method ?? 'GET'
      requests.push({
        url,
        method,
        ...(request?.body ? { body: JSON.parse(String(request.body)) as Record<string, unknown> } : {}),
      })
      if (method === 'POST') {
        return jsonResponse({ id: 'job-1', type: 'research', status: 'pending' })
      }
      const scripted = polls[Math.min(pollAt, polls.length - 1)]
      pollAt += 1
      return scripted instanceof Response ? scripted.clone() : jsonResponse(scripted)
    }))
    return requests
  }

  function researchToolOf(
    research?: Parameters<typeof eidoWebToolSetFor>[2],
  ) {
    return eidoWebToolSetFor(settings, 'research', research)!.tools[2]
  }

  const completedEnvelope = {
    id: 'job-1',
    status: 'completed',
    output: {
      answer: 'The verified answer.',
      sources: [{ name: 'Primary', url: 'https://primary.test/report', snippet: 'the source line' }],
    },
  }

  afterEach(() => vi.useRealTimers())

  it('submits the depth the user pressed, ignoring any the model smuggles in, and polls the job out', async () => {
    vi.useFakeTimers()
    const requests = stubResearchWire([{ id: 'job-1', status: 'processing' }, completedEnvelope])

    // The model was never offered reasoningDepth, but an undeclared parameter
    // can still arrive in the arguments; the wire must carry the user's press
    // regardless (#971).
    const announced: unknown[] = []
    const pending = researchToolOf({ depth: 'L' }).execute(
      { query: 'map the market', mode: 'research', reasoningDepth: 'XL' },
      undefined,
      (step) => announced.push(step),
    )
    await vi.advanceTimersByTimeAsync(2_000)
    // The trail row is up as soon as the vendor takes the job, not minutes
    // later when the report lands: a Card showing nothing for four minutes
    // reads as stuck rather than working.
    expect(announced).toEqual([{ kind: 'research', detail: 'map the market' }])
    await vi.advanceTimersByTimeAsync(4_000)
    const outcome = await pending

    expect(requests[0]).toMatchObject({
      url: 'https://api.linkup.so/v1/research',
      method: 'POST',
      body: { q: 'map the market', mode: 'research', reasoningDepth: 'L', outputType: 'sourcedAnswer' },
    })
    expect(requests.slice(1).every((poll) =>
      poll.method === 'GET' && poll.url === 'https://api.linkup.so/v1/research/job-1',
    )).toBe(true)
    expect(outcome.failed).toBeUndefined()
    // Announced once, returned never: two would count one lookup twice.
    expect(outcome.step).toBeUndefined()
    expect(announced).toHaveLength(1)
    // The report reads as an answer with its provenance under it, so the
    // model can cite pages the reader can open.
    expect(outcome.resultText).toContain('The verified answer.')
    expect(outcome.resultText).toContain('https://primary.test/report')
  })

  it('runs at S when no depth was configured, because the only depth safe to assume is the cheapest', async () => {
    vi.useFakeTimers()
    const requests = stubResearchWire([completedEnvelope])

    const pending = researchToolOf().execute({ query: 'q', mode: 'answer' }, undefined)
    await vi.advanceTimersByTimeAsync(2_000)
    await pending

    expect(requests[0]?.body?.reasoningDepth).toBe('S')
  })

  it('polls on the published cadence: 2 seconds doubling to a 10 second cap, never faster', async () => {
    vi.useFakeTimers()
    const requests = stubResearchWire([{ id: 'job-1', status: 'pending' }])
    const controller = new AbortController()
    const pending = researchToolOf().execute(
      { query: 'q', mode: 'answer' },
      controller.signal,
    )
    // Flush the submit so the first wait is armed.
    await vi.advanceTimersByTimeAsync(0)

    // Waits run 2, 4, 8, 10, 10: polls land at 2, 6, 14, 24, 34 seconds.
    const pollsBySecond: Array<[number, number]> = [[2, 1], [6, 2], [14, 3], [24, 4], [33, 4], [34, 5]]
    let elapsed = 0
    for (const [second, polls] of pollsBySecond) {
      await vi.advanceTimersByTimeAsync(second * 1000 - elapsed)
      elapsed = second * 1000
      expect(requests.filter((entry) => entry.method === 'GET')).toHaveLength(polls)
    }

    // The job never finishes on purpose; end the poller the way a user would.
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'canceled' })
  })

  it('refuses a mangled mode without submitting, because a guess here is dollars and minutes', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const research = researchToolOf()

    const noMode = await research.execute({ query: 'q' }, undefined)
    const badMode = await research.execute({ query: 'q', mode: 'exhaustive' }, undefined)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(noMode.failed).toBe(true)
    expect(noMode.resultText).toContain('mode')
    expect(badMode.failed).toBe(true)
    expect(badMode.resultText).toContain('mode')
  })

  it('hands the job id over at acknowledgement and back at completion, so a quit cannot orphan it', async () => {
    vi.useFakeTimers()
    stubResearchWire([completedEnvelope])
    const submitted: string[] = []
    const settled: string[] = []
    const research = researchToolOf({
      hooks: {
        onSubmitted: (id) => submitted.push(id),
        onSettled: (id) => settled.push(id),
      },
    })

    const pending = research.execute({ query: 'q', mode: 'answer' }, undefined)
    await vi.advanceTimersByTimeAsync(0)
    // The id is handed over the moment the vendor acknowledges, before any
    // poll: the charge is already committed and there is no cancel API.
    expect(submitted).toEqual(['job-1'])
    expect(settled).toEqual([])
    await vi.advanceTimersByTimeAsync(2_000)
    await pending

    expect(settled).toEqual(['job-1'])
  })

  it('a cancel stops the polling and keeps the job id, because the job is still running and paid for', async () => {
    vi.useFakeTimers()
    stubResearchWire([{ id: 'job-1', status: 'pending' }])
    const controller = new AbortController()
    const submitted: string[] = []
    const settled: string[] = []
    const research = researchToolOf({
      hooks: {
        onSubmitted: (id) => submitted.push(id),
        onSettled: (id) => settled.push(id),
      },
    })

    const pending = research.execute(
      { query: 'q', mode: 'investigate' },
      controller.signal,
    )
    await vi.advanceTimersByTimeAsync(2_000)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'canceled' })
    expect(submitted).toEqual(['job-1'])
    expect(settled).toEqual([])
  })

  it('a job the vendor declares failed settles unharmed: plain words, not charged, nothing kept', async () => {
    vi.useFakeTimers()
    stubResearchWire([{ id: 'job-1', status: 'failed', error: { message: 'source gathering broke' } }])
    const settled: string[] = []
    const research = researchToolOf({ hooks: { onSubmitted: () => {}, onSettled: (id) => settled.push(id) } })

    const pending = research.execute({ query: 'doomed', mode: 'answer' }, undefined)
    await vi.advanceTimersByTimeAsync(2_000)
    const outcome = await pending

    expect(outcome.failed).toBe(true)
    expect(outcome.step).toEqual({ kind: 'trouble', detail: 'doomed', title: words.webErrorFailed })
    expect(settled).toEqual(['job-1'])
  })

  it('a submission refusal reaches the user in the words that tell a wrong key from empty credit', async () => {
    const refusals: Array<[Response, string]> = [
      [
        new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 }),
        words.webSearchErrorBadKey,
      ],
      [
        new Response(JSON.stringify({ error: { code: 'INSUFFICIENT_CREDITS' } }), { status: 429 }),
        words.webSearchErrorOutOfCredit,
      ],
    ]
    for (const [response, title] of refusals) {
      vi.stubGlobal('fetch', vi.fn(async () => response.clone()))
      const outcome = await researchToolOf().execute(
        { query: 'q', mode: 'answer' },
        undefined,
      )
      expect(outcome.failed).toBe(true)
      expect(outcome.step).toMatchObject({ kind: 'trouble', title })
    }
  })

  it('polls through transient trouble instead of abandoning a paid job to one bad response', async () => {
    vi.useFakeTimers()
    stubResearchWire([
      new Response('gateway', { status: 502 }),
      completedEnvelope,
    ])
    const research = researchToolOf()

    const pending = research.execute({ query: 'q', mode: 'answer' }, undefined)
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(4_000)
    const outcome = await pending

    expect(outcome.failed).toBeUndefined()
    expect(outcome.resultText).toContain('The verified answer.')
  })
})

describe('resuming a standing research job (#971)', () => {
  // The wire, scripted for a resume: GETs only. Any POST is recorded so the
  // tests can prove none happened.
  function stubResumeWire(polls: Array<Record<string, unknown> | Response>) {
    const requests: Array<{ url: string; method: string }> = []
    let pollAt = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, request?: RequestInit) => {
      const url = String(input)
      const method = request?.method ?? 'GET'
      requests.push({ url, method })
      const scripted = polls[Math.min(pollAt, polls.length - 1)]
      pollAt += 1
      return scripted instanceof Response ? scripted.clone() : jsonResponse(scripted)
    }))
    return requests
  }

  const completedEnvelope = {
    id: 'job-9',
    status: 'completed',
    output: {
      answer: 'The report that was already paid for.',
      sources: [{ name: 'Primary', url: 'https://primary.test/report', snippet: 'the source line' }],
    },
  }

  afterEach(() => vi.useRealTimers())

  it('polls the standing job at once and never submits, landing a finished report immediately', async () => {
    const requests = stubResumeWire([completedEnvelope])
    const settled: string[] = []

    // No fake timers on purpose: a job that already finished on the vendor
    // side must land without a single manufactured wait.
    const resumed = await resumeResearchJob(settings, 'job-9', {
      onSettled: (id) => settled.push(id),
    })

    expect(requests).toEqual([
      { url: 'https://api.linkup.so/v1/research/job-9', method: 'GET' },
    ])
    expect(requests.some((entry) => entry.method === 'POST')).toBe(false)
    expect(resumed).toMatchObject({ status: 'done' })
    if (resumed.status === 'done') {
      expect(resumed.answerText).toContain('The report that was already paid for.')
      expect(resumed.answerText).toContain('https://primary.test/report')
    }
    expect(settled).toEqual(['job-9'])
  })

  it('keeps polling a job still working, on the published cadence, without ever posting', async () => {
    vi.useFakeTimers()
    const requests = stubResumeWire([{ id: 'job-9', status: 'processing' }, completedEnvelope])

    const pending = resumeResearchJob(settings, 'job-9', {})
    await vi.advanceTimersByTimeAsync(0)
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2_000)
    const resumed = await pending

    expect(resumed.status).toBe('done')
    expect(requests.every((entry) => entry.method === 'GET')).toBe(true)
  })

  it('a cancel mid-resume reports canceled and never settles, so the job id stays standing', async () => {
    vi.useFakeTimers()
    stubResumeWire([{ id: 'job-9', status: 'pending' }])
    const controller = new AbortController()
    const settled: string[] = []

    const pending = resumeResearchJob(settings, 'job-9', {
      signal: controller.signal,
      onSettled: (id) => settled.push(id),
    })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    const resumed = await pending

    expect(resumed).toEqual({ status: 'canceled' })
    expect(settled).toEqual([])
  })

  it('a job the vendor declares failed settles and reports plain words, clearing the way for a fresh run', async () => {
    stubResumeWire([{ id: 'job-9', status: 'failed', error: { message: 'gathering broke' } }])
    const settled: string[] = []

    const resumed = await resumeResearchJob(settings, 'job-9', {
      onSettled: (id) => settled.push(id),
    })

    expect(resumed).toEqual({ status: 'failed', messageKey: 'webErrorFailed' })
    expect(settled).toEqual(['job-9'])
  })

  it('refuses to resume without a key, before anything reaches the wire', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const resumed = await resumeResearchJob({}, 'job-9')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(resumed).toEqual({ status: 'failed', messageKey: 'webSearchErrorNoKey' })
  })
})
