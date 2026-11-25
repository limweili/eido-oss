import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  budgetFor,
  contextWindowFor,
  ensureModelWindowsFresh,
  recordModelWindow,
  resetModelWindowsForTests,
  WINDOWS_REFRESH_INTERVAL_MS,
  WINDOWS_RETRY_INTERVAL_MS,
} from './modelWindows'

function catalogResponse(data: unknown) {
  return { ok: true, json: async () => ({ data }) } as unknown as Response
}

beforeEach(() => {
  resetModelWindowsForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetModelWindowsForTests()
})

describe('provider-aware model windows', () => {
  it('uses known Claude aliases instead of the generic fallback', () => {
    expect(contextWindowFor('sonnet', 'claude-code')).toBe(200_000)
    expect(budgetFor('sonnet', 'claude-code')).toBe(160_000)
  })

  it('uses a conservative Codex provider floor when the CLI owns the default model', () => {
    expect(contextWindowFor('default', 'codex')).toBe(256_000)
    expect(budgetFor('default', 'codex')).toBe(204_800)
  })

  it('uses the Google window for local Antigravity aliases', () => {
    expect(contextWindowFor('pro', 'antigravity')).toBe(1_000_000)
    expect(budgetFor('pro', 'antigravity')).toBe(256_000)
  })

  it('falls back for a slug nothing knows about', () => {
    expect(contextWindowFor('someone/never-heard-of-it')).toBe(128_000)
  })
})

describe('learning windows from the OpenRouter catalog', () => {
  it('stores the published window for a slug the seed list never had', async () => {
    const fetchMock = vi.fn(async () =>
      catalogResponse([{ id: 'x-ai/grok-4.5', context_length: 2_000_000 }]),
    )
    vi.stubGlobal('fetch', fetchMock)

    expect(contextWindowFor('x-ai/grok-4.5')).toBe(128_000)
    await ensureModelWindowsFresh('sk-test')
    expect(contextWindowFor('x-ai/grok-4.5')).toBe(2_000_000)
    expect(budgetFor('x-ai/grok-4.5')).toBe(256_000)
  })

  it('prefers the serving provider window when it is smaller than the headline one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        catalogResponse([
          { id: 'a/model', context_length: 1_000_000, top_provider: { context_length: 131_072 } },
        ]),
      ),
    )
    await ensureModelWindowsFresh('sk-test')
    expect(contextWindowFor('a/model')).toBe(131_072)
  })

  it('keeps the headline window when the serving provider reports a larger one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        catalogResponse([
          { id: 'a/model', context_length: 200_000, top_provider: { context_length: 400_000 } },
        ]),
      ),
    )
    await ensureModelWindowsFresh('sk-test')
    expect(contextWindowFor('a/model')).toBe(200_000)
  })

  it('makes no network call without a key', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await ensureModelWindowsFresh(undefined)
    await ensureModelWindowsFresh('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks once a day, not once a run', async () => {
    const fetchMock = vi.fn(async () => catalogResponse([{ id: 'a/model', context_length: 300_000 }]))
    vi.stubGlobal('fetch', fetchMock)
    const start = 1_000_000_000
    await ensureModelWindowsFresh('sk-test', start)
    await ensureModelWindowsFresh('sk-test', start + 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await ensureModelWindowsFresh('sk-test', start + WINDOWS_REFRESH_INTERVAL_MS + 1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back rather than failing when the catalog is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    await expect(ensureModelWindowsFresh('sk-test')).resolves.toBeUndefined()
    expect(contextWindowFor('openai/gpt-4o')).toBe(128_000)
  })

  it('falls back rather than failing when the catalog answers with rubbish', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: 'nope' }) }) as unknown as Response))
    await ensureModelWindowsFresh('sk-test')
    expect(contextWindowFor('openai/gpt-4o')).toBe(128_000)
  })
})

describe('correcting a window from what a provider actually did', () => {
  it('outranks the catalog and survives the next refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => catalogResponse([{ id: 'a/model', context_length: 1_000_000 }])))
    const start = 2_000_000_000
    await ensureModelWindowsFresh('sk-test', start)
    expect(contextWindowFor('a/model')).toBe(1_000_000)

    recordModelWindow('a/model', 128_000)
    expect(contextWindowFor('a/model')).toBe(128_000)

    await ensureModelWindowsFresh('sk-test', start + WINDOWS_REFRESH_INTERVAL_MS + 1)
    expect(contextWindowFor('a/model')).toBe(128_000)
  })

  it('ignores a nonsense correction', () => {
    recordModelWindow('a/model', 0)
    recordModelWindow('a/model', Number.NaN)
    expect(contextWindowFor('a/model')).toBe(128_000)
  })

  it("refuses a number too small to be anyone's window", () => {
    // A refusal message is prose. A year, or a limit clipped mid-digit by the
    // cap on how much of the body is read, would set a threshold below the
    // compiled instruction and degrade every later run on this model.
    recordModelWindow('a/model', 2_024)
    recordModelWindow('a/model', 1_280)
    expect(contextWindowFor('a/model')).toBe(128_000)
  })

  it('only ever shrinks: a refusal is no evidence of a bigger window', () => {
    // Corrections persist on the device, so one bad parse that could grow the
    // window would steer every future run and no later refusal could undo it.
    recordModelWindow('a/model', 512_000)
    expect(contextWindowFor('a/model')).toBe(128_000)

    recordModelWindow('a/model', 64_000)
    expect(contextWindowFor('a/model')).toBe(64_000)
    recordModelWindow('a/model', 100_000)
    expect(contextWindowFor('a/model')).toBe(64_000)
  })

  it('drops a correction once the model it described has been re-released', async () => {
    const start = 3_000_000_000
    vi.stubGlobal('fetch', vi.fn(async () => catalogResponse([{ id: 'a/model', context_length: 200_000 }])))
    await ensureModelWindowsFresh('sk-test', start)
    recordModelWindow('a/model', 100_000)
    expect(contextWindowFor('a/model')).toBe(100_000)

    // The published number moves, so the model is not the one that was refused.
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', vi.fn(async () => catalogResponse([{ id: 'a/model', context_length: 400_000 }])))
    await ensureModelWindowsFresh('sk-test', start + WINDOWS_REFRESH_INTERVAL_MS + 1)
    expect(contextWindowFor('a/model')).toBe(400_000)
  })

  it('keeps a correction learned before any catalog had landed', async () => {
    // The refusal came first: an offline session, or a fetch that failed. There
    // is no published number the correction was measured against, and reading
    // that absence as a re-release would restore the very window the provider
    // refused on the first refresh that succeeds.
    recordModelWindow('a/model', 32_000)
    expect(contextWindowFor('a/model')).toBe(32_000)

    const start = 3_500_000_000
    vi.stubGlobal('fetch', vi.fn(async () => catalogResponse([{ id: 'a/model', context_length: 200_000 }])))
    await ensureModelWindowsFresh('sk-test', start)
    expect(contextWindowFor('a/model')).toBe(32_000)

    // And the baseline is filled in, so a real re-release still clears it.
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', vi.fn(async () => catalogResponse([{ id: 'a/model', context_length: 500_000 }])))
    await ensureModelWindowsFresh('sk-test', start + WINDOWS_REFRESH_INTERVAL_MS + 1)
    expect(contextWindowFor('a/model')).toBe(500_000)
  })
})

describe('not asking a catalog that cannot answer', () => {
  it('backs off after a failure instead of trying once per run', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fetchMock)
    const start = 4_000_000_000

    await ensureModelWindowsFresh('sk-test', start)
    await ensureModelWindowsFresh('sk-test', start + 60_000)
    await ensureModelWindowsFresh('sk-test', start + WINDOWS_RETRY_INTERVAL_MS - 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await ensureModelWindowsFresh('sk-test', start + WINDOWS_RETRY_INTERVAL_MS + 1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
