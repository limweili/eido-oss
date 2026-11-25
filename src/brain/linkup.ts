// Eido's reach inside a Run. Three operations, one boundary:
//
//   searchWeb(query, ...)   ... ask the live web and hand back sources.
//   fetchPage(url, ...)     ... open one page and hand back markdown.
//   runResearch(query, ...) ... submit an investigation, poll it out, hand
//                               back a cited report minutes later.
//   resumeResearch(id, ...) ... re-attach to a job already submitted and
//                               paid for, polling only, never submitting.
//
// The adapter translates Linkup responses into WebSearchResult, FetchedPage,
// and ResearchReport for Runs that use the user's Linkup key.
//
// The caller supplies `depth` and the filters, always; since #965 they are
// the model's per-call choice, made where the retrieval question is actually
// known. `outputType` is the opposite: pinned to searchResults right here,
// with no way for any caller to ask otherwise, because Eido runs the loop
// and the calling model does the synthesis; a sourcedAnswer would pay the
// vendor's model for prose this model then rewrites.
//
// It runs in the renderer, beside the model call in openRouter.ts, because
// api.linkup.so reflects the requesting origin and allows the authorization
// header (probed 2026-08-18; the packaged policy in electron/protocol.ts was
// widened for it in #957).
//
// Error mapping keys on the body's `code`, never on the status alone. Two
// traps force that, both verified live (research/10-linkup-web-intelligence/
// 03-live-capture.md): a missing key answers 402 with an x402 payment
// challenge, so a status-keyed mapping would tell a user who has not pasted a
// key that payment failed; and 429 is both "slow down" and "out of money",
// separated only by the body.

import {
  isWireRecording,
  wireRecordFailure,
  wireRecordRequest,
  wireRecordWebResult,
} from '../shared/wireRecord'
import { displayHost, normalizeWebUrl } from '../shared/webUrl'

const LINKUP_ENDPOINT = 'https://api.linkup.so/v1'

// How hard a search may look, in the vendor's own three tiers. `fast` is
// keyword retrieval with no interpretation in the path, sub-second; `standard`
// plans independent lookups upfront; `deep` may reuse an earlier step's result
// inside one call. All three are exposed since #965, because the model picks
// depth per call and most calls are one fact that lives in a snippet.
export type WebSearchDepth = 'fast' | 'standard' | 'deep'

// One place the web answered from, in Eido's words.
export type WebSource = {
  title: string
  url: string
  snippet: string
}

// A search hands back ranked sources for a model to reason over, and only
// that. The vendor's other output shapes are deliberately not reachable from
// here (#965): a sourcedAnswer would pay the vendor's model to write prose
// the Run's own model then rewrites, and structured has no consumer downstream
// of the loop.
export type WebSearchResult = {
  sources: WebSource[]
}

// Markdown and retrieval time for the requested page.
export type FetchedPage = {
  url: string
  markdown: string
  retrievedAt: string
}

// Every way the reach can fail, and nothing else. "no-results" is a real code
// rather than a fallthrough because finding nothing is an ordinary outcome the
// Card must say plainly, not a malfunction.
export type WebToolErrorCode =
  | 'no-key'
  | 'bad-key'
  | 'out-of-credit'
  | 'rate-limited'
  | 'no-results'
  | 'page-too-large'
  | 'page-unreadable'
  | 'unsupported-content'
  | 'unreachable'
  | 'canceled'
  | 'failed'

// Undocumented x-ratelimit-* headers, observed on every response. Surfaced so
// a tool loop can wait out a rate limit instead of retrying into the same
// wall. Every field is optional because nothing promises these headers exist.
export type WebToolRateLimit = {
  limit?: number
  remaining?: number
  resetSeconds?: number
}

// Callers turn the code into plain words; they never parse a message.
export class WebToolError extends Error {
  constructor(
    readonly code: WebToolErrorCode,
    message?: string,
    readonly rateLimit?: WebToolRateLimit,
  ) {
    super(message ?? code)
    this.name = 'WebToolError'
  }
}

export type WebSearchOptions = {
  apiKey: string
  depth: WebSearchDepth
  signal?: AbortSignal
  // Hard constraints, sent as API parameters rather than folded into the
  // query, because the vendor treats parameters as filters and query text as
  // preference. Absent means unconstrained; this module never invents one.
  includeDomains?: readonly string[]
  excludeDomains?: readonly string[]
  fromDate?: string
  toDate?: string
}

// How hard a fetch may work on a page that resists retrieval. `pro` exists
// for exactly those pages; `standard` is the vendor default and stays the
// unwritten one here, so an ordinary fetch stays byte-identical to what this
// module sent before the option existed.
export type FetchPageMode = 'standard' | 'pro'

export type FetchPageOptions = {
  apiKey: string
  signal?: AbortSignal
  // On by default, per the vendor's own guidance: most modern pages are
  // client-rendered, and a fetch that skips scripts reads them as empty.
  renderJs?: boolean
  mode?: FetchPageMode
}

// Ask the live web. One POST, one response, no polling.
export async function searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult> {
  const payload = await request(
    '/search',
    {
      q: query,
      depth: options.depth,
      outputType: 'searchResults',
      // Filters ride only when the caller set them: an absent filter and a
      // filter never offered must be the same request on the wire.
      ...(options.includeDomains?.length ? { includeDomains: options.includeDomains } : {}),
      ...(options.excludeDomains?.length ? { excludeDomains: options.excludeDomains } : {}),
      ...(options.fromDate ? { fromDate: options.fromDate } : {}),
      ...(options.toDate ? { toDate: options.toDate } : {}),
    },
    options,
  )

  const result = mapSearchResponse(payload)
  // A 200 with nothing in it is the same event as the documented no-result
  // refusal: the web had nothing. One code, however the vendor spells it.
  if (result.sources.length === 0) throw new WebToolError('no-results')
  return result
}

// Open one page and hand back its markdown. Handles HTML and PDF; a binary is
// refused with its own code so the Card can say why.
export async function fetchPage(rawUrl: string, options: FetchPageOptions): Promise<FetchedPage> {
  // A model-authored URL can be anything at all. Refuse what is not a plain
  // http(s) page before it reaches the network: from where the user sits, an
  // address that could never be fetched is a page that could not be read.
  const url = normalizeWebUrl(rawUrl)
  if (!url) throw new WebToolError('page-unreadable', 'bad-url')

  const payload = await request(
    '/fetch',
    {
      url,
      renderJs: options.renderJs ?? true,
      // Only 'pro' is worth writing on the wire. 'standard' is the vendor's
      // default, so leaving it unsaid keeps the ordinary request identical to
      // what shipped before the option existed.
      ...(options.mode === 'pro' ? { mode: 'pro' } : {}),
    },
    options,
  )

  const markdown =
    isRecord(payload) && typeof payload.markdown === 'string' ? payload.markdown.trim() : ''
  if (!markdown) throw new WebToolError('page-unreadable', 'empty')

  return { url, markdown, retrievedAt: new Date().toISOString() }
}

// ---- the research endpoint ---------------------------------------------------

// The vendor's own vocabulary, passed through untranslated because the model
// chooses both per call (#963): the mode from the shape of the question, the
// depth from how long the investigation deserves.
export type ResearchMode = 'answer' | 'investigate' | 'research'
export type ResearchReasoningDepth = 'S' | 'M' | 'L' | 'XL'

// What a finished investigation hands back: prose the vendor's own agent
// wrote and verified, plus the sources it stands on. The one place Eido buys
// a sourcedAnswer, because here the vendor's model did minutes of work this
// model cannot redo from a transcript.
export type ResearchReport = {
  answer: string
  sources: WebSource[]
}

export type ResearchOptions = {
  apiKey: string
  mode: ResearchMode
  reasoningDepth: ResearchReasoningDepth
  signal?: AbortSignal
  // Fired the moment the vendor acknowledges the job, before the first poll.
  // The charge and the job commit at submission and there is no cancel API,
  // so whoever must remember the job learns its id before anything else can
  // go wrong.
  onSubmitted?: (jobId: string) => void
  // Fired only when the vendor reported a terminal state this call consumed:
  // the report delivered, or the job declared failed, which is not charged.
  // Deliberately never fired for a cancel or an abandoned poll, because then
  // the job is still running on the vendor's servers and the id is the only
  // handle to what was already paid for.
  onSettled?: (jobId: string) => void
}

// The vendor's published polling contract: start at 2 seconds, double to a
// cap of 10, never faster than once per second. Failed polls do not abandon
// the job lightly, because the money is already committed: a rate limit or a
// network blip keeps polling at the cap, and only a run of them in a row
// gives up, leaving the job id with whoever holds it.
const RESEARCH_POLL_START_SECONDS = 2
const RESEARCH_POLL_CAP_SECONDS = 10
const RESEARCH_POLL_FLOOR_SECONDS = 1
const RESEARCH_POLL_GIVE_UP_AFTER = 5

// Submit one investigation and poll it out. Resolves minutes after it is
// called; the signal is the only early exit, and it stops the polling, never
// the job. `reasoningDepth` arrives pinned by the caller from the user's own
// choice (#971): a research job spends dollars, so how long it may think is
// decided by the person paying, never guessed here and never by the model.
export async function runResearch(query: string, options: ResearchOptions): Promise<ResearchReport> {
  const submitted = await request(
    '/research',
    {
      q: query,
      mode: options.mode,
      reasoningDepth: options.reasoningDepth,
      // Pinned here exactly as searchResults is pinned for search, and for
      // the mirrored reason: the research agent already did the multi-source
      // reasoning, so its own synthesis is the product being bought.
      outputType: 'sourcedAnswer',
    },
    options,
  )
  const jobId = isRecord(submitted) && typeof submitted.id === 'string' ? submitted.id.trim() : ''
  // An acknowledgement without an id cannot be polled and cannot be
  // remembered; treat it as the submission failing before any commitment.
  if (!jobId) throw new WebToolError('failed', 'no-job-id')
  options.onSubmitted?.(jobId)

  // A job just submitted cannot be done yet, so the first poll waits the
  // vendor's opening beat.
  return pollResearchOut(jobId, options, RESEARCH_POLL_START_SECONDS)
}

// What resuming a standing job needs, and nothing more: there is no submit,
// so there is no query, no mode, no depth, and no onSubmitted.
export type ResearchResumeOptions = Pick<ResearchOptions, 'apiKey' | 'signal' | 'onSettled'>

// Re-attach to a job that was already submitted and paid for, and poll it
// out. Never submits anything: the id is the whole request. The first poll
// fires immediately, because a resumed job may have finished on the vendor's
// side long ago and its report should land without a manufactured wait.
export async function resumeResearch(
  jobId: string,
  options: ResearchResumeOptions,
): Promise<ResearchReport> {
  return pollResearchOut(jobId, options, 0)
}

// The shared poll loop under both the fresh submit and a resume. A first
// delay of zero polls at once and then falls onto the published cadence, so
// "never faster than once per second" still holds: one immediate GET, then
// the ordinary backoff.
async function pollResearchOut(
  jobId: string,
  options: Pick<ResearchOptions, 'apiKey' | 'signal' | 'onSettled'>,
  firstDelaySeconds: number,
): Promise<ResearchReport> {
  let delaySeconds = firstDelaySeconds
  let troubledPolls = 0
  for (;;) {
    if (delaySeconds > 0) {
      await researchPollWait(delaySeconds, options.signal)
    } else if (options.signal?.aborted) {
      throw new WebToolError('canceled')
    }
    delaySeconds =
      delaySeconds === 0
        ? RESEARCH_POLL_START_SECONDS
        : Math.min(delaySeconds * 2, RESEARCH_POLL_CAP_SECONDS)

    let envelope: unknown
    try {
      envelope = await requestGet(`/research/${jobId}`, options)
    } catch (err) {
      if (!(err instanceof WebToolError) || err.code === 'canceled') throw err
      // Transient trouble is polled through, not surrendered to: the job is
      // paid for and still running whatever this GET said. Anything that is
      // not transient (a key gone bad, say) will answer every retry the same
      // way, so it abandons at once. Abandoning never settles the job.
      const transient =
        err.code === 'rate-limited' || err.code === 'unreachable' || err.code === 'failed'
      troubledPolls += 1
      if (!transient || troubledPolls >= RESEARCH_POLL_GIVE_UP_AFTER) throw err
      if (err.code === 'rate-limited') {
        // Honour the reset when the vendor named one, within reason: waiting
        // longer than the cap is fine, hanging on a strange header is not.
        const reset = err.rateLimit?.resetSeconds
        delaySeconds = Math.min(Math.max(reset ?? delaySeconds, delaySeconds), 30)
      }
      continue
    }
    troubledPolls = 0

    const status = isRecord(envelope) && typeof envelope.status === 'string' ? envelope.status : ''
    if (status === 'failed') {
      // A failed job is terminal and, per the vendor, not charged.
      options.onSettled?.(jobId)
      throw new WebToolError('failed', researchErrorMessage(envelope))
    }
    if (status === 'completed') {
      const report = mapResearchOutput(isRecord(envelope) ? envelope.output : undefined)
      options.onSettled?.(jobId)
      // Completed with nothing to show is a failure to the caller, but the
      // vendor considers the job done, so it settles either way.
      if (!report) throw new WebToolError('failed', 'empty-report')
      return report
    }
    // pending, processing, or a status this build has never met: the job is
    // taken to be still working, because guessing "dead" costs a paid report
    // and guessing "alive" costs one more poll.
  }
}

// The wait between polls. Rejects as a cancel when the signal fires so the
// whole investigation unwinds the same way every other cancelled call does.
// The floor stands even if a caller ever passes something smaller, because
// "never faster than once per second" is the vendor's rate limit, not a
// preference.
function researchPollWait(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new WebToolError('canceled'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new WebToolError('canceled'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, Math.max(seconds, RESEARCH_POLL_FLOOR_SECONDS) * 1000)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// On completed, `output` holds `{answer, sources[]}`. The source entries are
// documented as the search shape but a sourcedAnswer's have been seen with
// `snippet` where search says `content`, so both spellings are read: this is
// provenance for a paid report, the last place to be strict about a field
// name.
function mapResearchOutput(output: unknown): ResearchReport | null {
  if (!isRecord(output)) return null
  const answer = typeof output.answer === 'string' ? output.answer.trim() : ''
  if (!answer) return null
  const sources = Array.isArray(output.sources)
    ? output.sources.filter(isRecord).map(mapResearchSource)
    : []
  return { answer, sources }
}

function mapResearchSource(entry: Record<string, unknown>): WebSource {
  const url = typeof entry.url === 'string' ? entry.url : ''
  const title = typeof entry.name === 'string' ? entry.name.trim() : ''
  const snippet =
    typeof entry.snippet === 'string'
      ? entry.snippet
      : typeof entry.content === 'string'
        ? entry.content
        : ''
  return { title: title || displayHost(url), url, snippet: snippet.trim() }
}

// The terminal envelope's `error` field, in whichever of its shapes arrived.
// Carried on the WebToolError message for the model's benefit; the user sees
// the code's plain words, never this.
function researchErrorMessage(envelope: unknown): string {
  if (!isRecord(envelope)) return 'job-failed'
  const error = envelope.error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (isRecord(error)) {
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim()
    if (typeof error.code === 'string' && error.code.trim()) return error.code.trim()
  }
  return 'job-failed'
}

// ---- the shared network edge -------------------------------------------------

async function request(
  path: string,
  body: Record<string, unknown>,
  options: { apiKey: string; signal?: AbortSignal },
): Promise<unknown> {
  return send(path, { method: 'POST', body: JSON.stringify(body) }, options)
}

// The research poll is the one GET this API has; everything else posts.
async function requestGet(
  path: string,
  options: { apiKey: string; signal?: AbortSignal },
): Promise<unknown> {
  return send(path, { method: 'GET' }, options)
}

async function send(
  path: string,
  init: { method: 'GET' | 'POST'; body?: string },
  options: { apiKey: string; signal?: AbortSignal },
): Promise<unknown> {
  // An unset key never reaches the wire. The API would answer it with an x402
  // payment challenge, which is the trap this module exists to absorb.
  if (!options.apiKey.trim()) throw new WebToolError('no-key')
  if (options.signal?.aborted) throw new WebToolError('canceled')

  // The Board Info wire record (#968) watches this one edge, so every caller
  // above it, today's search and fetch and any endpoint routed through here
  // later, is recorded without knowing the record exists. Every record call
  // is a no-op until the record is on, sees the URL and never a header, and
  // keeps the outcome code and never the response body.
  const url = LINKUP_ENDPOINT + path
  wireRecordRequest(url)
  const startedAt = isWireRecording() ? Date.now() : 0

  let response: Response
  try {
    response = await fetch(url, {
      method: init.method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: options.signal,
    })
  } catch {
    // fetch rejects for a cancelled request and for a dead network alike; the
    // signal is what tells them apart.
    const code = options.signal?.aborted ? 'canceled' : 'unreachable'
    wireRecordFailure(url, 0, code)
    throw new WebToolError(code)
  }

  if (!response.ok) {
    const refusal = await refusalError(response)
    wireRecordFailure(url, response.status, refusal.code)
    throw refusal
  }

  try {
    // Read as text so the record can say how big the answer was; the parse is
    // the same one response.json() would have run.
    const text = await response.text()
    const payload: unknown = JSON.parse(text)
    wireRecordWebResult(url, startedAt ? Date.now() - startedAt : 0, text.length)
    return payload
  } catch {
    wireRecordFailure(url, response.status, 'failed')
    throw new WebToolError('failed')
  }
}

// Turn a refusal into one of Eido's codes. The body's `code` decides; the
// status only breaks ties the body leaves open. Codes the docs never publish
// are matched on their load-bearing token rather than pinned exactly, so a
// vendor rewording (INSUFFICIENT_CREDITS to INSUFFICIENT_BALANCE, say) fails
// soft into the right bucket instead of into "failed".
async function refusalError(response: Response): Promise<WebToolError> {
  const bodyCode = await refusalBodyCode(response)
  return new WebToolError(
    classifyRefusal(response.status, bodyCode),
    bodyCode || `http-${response.status}`,
    readRateLimit(response.headers),
  )
}

function classifyRefusal(status: number, rawCode: string): WebToolErrorCode {
  const code = rawCode.toUpperCase()
  // Both verified live, 2026-08-18: no Authorization header at all is 402
  // X402_PAYMENT_REQUIRED, a key that is present but wrong is 401
  // UNAUTHORIZED. The docs say 401 for both; reality disagrees, and these two
  // must reach the user as different sentences.
  if (code === 'X402_PAYMENT_REQUIRED') return 'no-key'
  if (code.includes('UNAUTHORIZED')) return 'bad-key'
  if (code.includes('CREDIT') || code.includes('BALANCE') || code.includes('INSUFFICIENT'))
    return 'out-of-credit'
  if (code.includes('NO_RESULT')) return 'no-results'
  if (code.includes('TOO_LARGE')) return 'page-too-large'
  if (code.includes('UNSUPPORTED')) return 'unsupported-content'
  if (code.includes('UNREACHABLE')) return 'page-unreadable'
  // Only after the body has said nothing about money may 429 mean waiting.
  if (status === 429) return 'rate-limited'
  if (status === 401 || status === 403) return 'bad-key'
  return 'failed'
}

async function refusalBodyCode(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json()
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === 'string') {
      return payload.error.code
    }
  } catch {
    // A refusal without a JSON body classifies on status alone.
  }
  return ''
}

function readRateLimit(headers: Headers): WebToolRateLimit | undefined {
  const limit = headerNumber(headers, 'x-ratelimit-limit')
  const remaining = headerNumber(headers, 'x-ratelimit-remaining')
  const resetSeconds = headerNumber(headers, 'x-ratelimit-reset')
  if (limit === undefined && remaining === undefined && resetSeconds === undefined) return undefined
  return { limit, remaining, resetSeconds }
}

function headerNumber(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)
  if (raw === null) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

// ---- mapping the vendor's shapes to Eido's -----------------------------------

// The searchResults shape: a ranked list, where image entries carry no text
// and a Run has nothing to do with them.
function mapSearchResponse(payload: unknown): WebSearchResult {
  if (!isRecord(payload) || !Array.isArray(payload.results)) return { sources: [] }
  return {
    sources: payload.results
      .filter((entry): entry is Record<string, unknown> => isRecord(entry) && entry.type === 'text')
      .map(mapSource),
  }
}

function mapSource(entry: Record<string, unknown>): WebSource {
  const url = typeof entry.url === 'string' ? entry.url : ''
  const title = typeof entry.name === 'string' ? entry.name.trim() : ''
  const snippet = typeof entry.content === 'string' ? entry.content.trim() : ''
  // A source without a usable title still needs a name on the Card. Its host
  // is a better name than a blank line.
  return { title: title || displayHost(url), url, snippet }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
