// Context-window sizes per model and the per-ask budget derived from them
// (ADR 0015). All tunables here are engineering parameters — documented in
// docs/foundations/context-layer.md, never surfaced in the UI.

import type { AiProvider } from './aiProviderTypes'

export const CONTEXT_WINDOW_FALLBACK_TOKENS = 128_000
export const BUDGET_WINDOW_SHARE = 0.8
export const BUDGET_CAP_TOKENS = 256_000

const WINDOWS_STORAGE_KEY = 'eido-v3-model-windows'
const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models'

// How long a fetched catalog stands before Eido asks again. Windows change
// when a model is re-released, which is weeks apart, not minutes; a day keeps
// the number honest without turning every session into a catalog fetch.
export const WINDOWS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

// How long a failed catalog fetch stands before Eido tries again. Without this
// an offline device fires one doomed request per run. Half an hour rather than
// a day, because the usual cause is a network that will be back shortly.
export const WINDOWS_RETRY_INTERVAL_MS = 30 * 60 * 1000

// The smallest number Eido will believe as a context window. A refusal message
// is prose, and prose contains numbers that are not limits: a year, a model
// name, a count clipped mid-digit by the cap on how much of the body is read.
// Any of those recorded as a window would set a threshold below the compiled
// instruction itself, and every later run on that model would degrade to
// tools-off before it started. No model worth routing to has a window this
// small, so anything under it is read as a misparse rather than a limit.
export const MIN_PLAUSIBLE_WINDOW_TOKENS = 8_192

// There is deliberately no table of models here.
//
// One used to sit at this spot: seven slugs and their windows, hand written.
// By the time the catalog fetch below was added, every one of them had aged out
// of the product and not one model on the current shortlist was in it, so every
// budget Eido computed for a model anyone actually used came from the generic
// fallback. A hand-kept table of a 400-model catalog cannot be right for long,
// and a table that is quietly wrong is worse than no table, because it looks
// like knowledge. The provider is asked instead (founder decision, #1034).
//
// The provider-family floors in `contextWindowFor` below are not that table.
// They cover local CLI harnesses, whose model aliases are not OpenRouter slugs
// and appear in no catalog at all.

// What a provider proved by refusing, and what the catalog was claiming at the
// time. The second number is why a correction cannot outlive its cause: when
// the published window for a model changes, the model has been re-released and
// a refusal recorded against the old one says nothing about the new one.
type WindowCorrection = { tokens: number; catalogTokens: number }

// Two layers, deliberately. `windows` is what OpenRouter publishes and is
// replaced wholesale on every refresh. `corrections` is what a provider
// actually did, and it survives refreshes, because a catalog that keeps
// re-asserting a window the provider has already refused would undo the
// correction every day (#1038).
type WindowCache = {
  fetchedAt: number
  // When the last fetch was attempted, successful or not.
  attemptedAt: number
  windows: Record<string, number>
  corrections: Record<string, WindowCorrection>
}

let cache: WindowCache | null = null
let inFlight: Promise<void> | null = null

function readCache(): WindowCache {
  if (cache) return cache
  cache = { fetchedAt: 0, attemptedAt: 0, windows: {}, corrections: {} }
  try {
    const raw = localStorage.getItem(WINDOWS_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      // The pre-refresh shape was a bare slug→tokens map, written by nothing
      // and read by everything. Both shapes are accepted so a device that
      // somehow holds the old one keeps its numbers.
      const stored = (typeof record.windows === 'object' && record.windows !== null
        ? record.windows
        : record) as Record<string, unknown>
      const corrections = (typeof record.corrections === 'object' && record.corrections !== null
        ? record.corrections
        : {}) as Record<string, unknown>
      const fetchedAt = typeof record.fetchedAt === 'number' ? record.fetchedAt : 0
      cache = {
        fetchedAt,
        attemptedAt: typeof record.attemptedAt === 'number' ? record.attemptedAt : fetchedAt,
        windows: sanitizeWindows(stored),
        corrections: sanitizeCorrections(corrections),
      }
    }
  } catch {
    /* a device with unreadable storage asks the catalog again */
  }
  return cache
}

function sanitizeCorrections(raw: Record<string, unknown>): Record<string, WindowCorrection> {
  const clean: Record<string, WindowCorrection> = {}
  for (const [slug, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue
    const entry = value as { tokens?: unknown; catalogTokens?: unknown }
    if (typeof entry.tokens !== 'number' || !Number.isFinite(entry.tokens)) continue
    if (entry.tokens < MIN_PLAUSIBLE_WINDOW_TOKENS) continue
    clean[slug] = {
      tokens: Math.floor(entry.tokens),
      catalogTokens: typeof entry.catalogTokens === 'number' ? Math.floor(entry.catalogTokens) : 0,
    }
  }
  return clean
}

function sanitizeWindows(raw: Record<string, unknown>): Record<string, number> {
  const clean: Record<string, number> = {}
  for (const [slug, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) clean[slug] = Math.floor(value)
  }
  return clean
}

function writeCache(next: WindowCache): void {
  cache = next
  try {
    localStorage.setItem(WINDOWS_STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* the in-memory copy still serves this session */
  }
}

export function contextWindowFor(model: string, provider: AiProvider = 'openrouter'): number {
  const cached = readCache()
  // A correction outranks the catalog: the catalog is what a provider
  // publishes, a correction is what it did.
  const corrected = cached.corrections[model]
  if (corrected) return corrected.tokens
  const stored = cached.windows[model]
  if (typeof stored === 'number' && stored > 0) return stored
  // Local CLI harnesses only. Their model aliases ('sonnet', 'default') are not
  // OpenRouter slugs and appear in no catalog, so a floor per harness is the
  // only thing that can be known about them without asking the harness itself.
  if (provider === 'antigravity') return 1_000_000
  if (provider === 'codex') return 256_000
  if (provider === 'claude-code') return 200_000
  return CONTEXT_WINDOW_FALLBACK_TOKENS
}

// The per-ask budget: 80% of the model's window (margin covers QuadChars
// estimation error and completion headroom), capped at 256k estimated tokens.
export function budgetFor(model: string, provider: AiProvider = 'openrouter'): number {
  return Math.min(Math.floor(contextWindowFor(model, provider) * BUDGET_WINDOW_SHARE), BUDGET_CAP_TOKENS)
}

// What one entry in OpenRouter's model catalog says about its window. Two
// numbers can appear, and the smaller one wins: `context_length` is the
// model's headline size, while `top_provider.context_length` is what the
// endpoint that would actually serve the request will accept. Budgeting
// against a window the serving provider will not honour is worse than
// budgeting against no number at all, because the request is refused after
// the user has already waited for it.
function windowFromCatalogEntry(entry: unknown): { slug: string; tokens: number } | null {
  if (typeof entry !== 'object' || entry === null) return null
  const record = entry as { id?: unknown; context_length?: unknown; top_provider?: unknown }
  const slug = typeof record.id === 'string' ? record.id.trim() : ''
  if (!slug) return null
  const candidates: number[] = []
  const push = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) candidates.push(Math.floor(value))
  }
  push(record.context_length)
  const top = record.top_provider as { context_length?: unknown } | null | undefined
  if (top && typeof top === 'object') push(top.context_length)
  if (candidates.length === 0) return null
  return { slug, tokens: Math.min(...candidates) }
}

// Correct one model's window from something better than the catalog. Today
// that means a provider refusing a request as too long (#1038). A number the
// provider has just disproved must not keep steering the rest of the run.
//
// A correction may only ever shrink the believed window. A refusal is evidence
// that the window is smaller than Eido thought and is evidence of nothing else,
// so a larger number extracted from a refusal message is a misread rather than
// a discovery. This matters because corrections persist on the device: a single
// bad parse that could grow the window would keep steering every future run on
// that model, and no later refusal could undo it.
export function recordModelWindow(model: string, tokens: number): void {
  if (!model || !Number.isFinite(tokens)) return
  const limit = Math.floor(tokens)
  if (limit < MIN_PLAUSIBLE_WINDOW_TOKENS) return
  if (limit >= contextWindowFor(model)) return
  const current = readCache()
  writeCache({
    ...current,
    corrections: {
      ...current.corrections,
      [model]: { tokens: limit, catalogTokens: current.windows[model] ?? 0 },
    },
  })
}

// Ask OpenRouter what its models' windows actually are, at most once a day and
// never more than once at a time. Deliberately not awaited by any run: a run
// that waited on a catalog fetch would be slower for a number it can already
// approximate, and every failure path here simply leaves the fallback standing.
//
// Gated on holding an OpenRouter key. The endpoint is public, but a person who
// has not chosen OpenRouter has not chosen to talk to it, and Eido does not
// make network calls on their behalf to fill a cache they will never read.
export function ensureModelWindowsFresh(
  apiKey: string | undefined,
  now: number = Date.now(),
): Promise<void> {
  if (!apiKey) return Promise.resolve()
  if (inFlight) return inFlight
  const cached = readCache()
  if (now - cached.fetchedAt < WINDOWS_REFRESH_INTERVAL_MS) return Promise.resolve()
  if (now - cached.attemptedAt < WINDOWS_RETRY_INTERVAL_MS) return Promise.resolve()
  inFlight = refreshModelWindows(apiKey, now).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function refreshModelWindows(apiKey: string, now: number): Promise<void> {
  // Recorded before anything can fail, so a device that cannot reach the
  // catalog stops asking for a while instead of once per run.
  writeCache({ ...readCache(), attemptedAt: now })
  let payload: unknown
  try {
    const res = await fetch(MODELS_ENDPOINT, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'X-Title': 'Eido' },
    })
    if (!res.ok) return
    payload = await res.json()
  } catch {
    return
  }
  const list = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(list)) return
  const fetched: Record<string, number> = {}
  for (const entry of list) {
    const read = windowFromCatalogEntry(entry)
    if (read) fetched[read.slug] = read.tokens
  }
  if (Object.keys(fetched).length === 0) return
  // The catalog replaces the catalog, so a daily refresh can never quietly
  // restore a window a provider has refused. A correction is dropped only when
  // its cause has expired: the published number for that model has moved, which
  // means the model was re-released and the old refusal no longer describes it.
  const current = readCache()
  const corrections: Record<string, WindowCorrection> = {}
  for (const [slug, correction] of Object.entries(current.corrections)) {
    const published = fetched[slug]
    if (published === undefined) {
      corrections[slug] = correction
      continue
    }
    // A correction learned before any catalog ever landed has no baseline to
    // compare against: `catalogTokens` is 0 because nothing was published yet,
    // not because the model was re-released. Dropping it here would restore the
    // very number the provider refused, on the first refresh after an offline
    // session. The correction is kept and the number it was measured against is
    // filled in now, so the next refresh can judge it properly.
    if (correction.catalogTokens === 0) {
      corrections[slug] = { tokens: correction.tokens, catalogTokens: published }
      continue
    }
    if (published !== correction.catalogTokens) continue
    if (correction.tokens >= published) continue
    corrections[slug] = correction
  }
  writeCache({ fetchedAt: now, attemptedAt: now, windows: fetched, corrections })
}

export function resetModelWindowsForTests(): void {
  cache = null
  inFlight = null
  try {
    localStorage.removeItem(WINDOWS_STORAGE_KEY)
  } catch {
    /* nothing stored */
  }
}
