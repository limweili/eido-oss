// The one OpenRouter network egress in Eido. Follows the OpenRouter quickstart
// (https://openrouter.ai/docs/quickstart). The engine supplies an opaque access
// grant selecting the user's API key; raw credentials stay in the access seam.

import type { ReasoningEffort } from '../graph/types'
import { assertProfileReviewModel } from '../shared/profileReviewPolicy'
import {
  buildOpenRouterCompletionBody,
  type OpenRouterCompletionAsset,
} from '../shared/openRouterProtocol'
import {
  isWireRecording,
  wireRecordFailure,
  wireRecordProviderRequest,
  wireRecordToolCall,
  wireRecordToolResult,
} from '../shared/wireRecord'
import {
  createToolStepCollector,
  declaredServerToolFor,
  DECLARED_SERVER_TOOLS,
  thinkingStepFrom,
  type EidoToolSet,
  type RunToolStep,
} from './agenticRun'
import {
  assertAiAccessGrant,
  fetchOpenRouterWithAccess,
  streamLocalCompletionWithAccess,
  type AiAccessGrant,
} from './aiAccess'
import {
  buildCompactionInstruction,
  compactionStep,
  COMPACTION_FAILURE_LIMIT,
  COMPACTION_REASONING_EFFORT,
  COMPACTION_SYSTEM_PROMPT,
  COMPACTION_THRESHOLD_SHARE,
  CONTEXT_EXHAUSTED_NOTE,
  estimateConversationTokens,
  planCompaction,
  rebuildConversation,
  renderCompactionMaterial,
} from './conversationCompaction'
import { contextWindowFor, recordModelWindow } from './modelWindows'
import { calibratedTokens, recordTokenCalibration } from './tokenCalibration'

// Kept as the label the wire record reports for provider egress. The actual
// request leaves through the access grant's transport using the user's key.
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

// The provider-executed tool surface of an Agentic Run on OpenRouter
// (ADR 0033). These are OpenRouter Server Tools: they are named in the request
// and executed on OpenRouter's side inside the same completion, so there is no
// loop here and no second round trip. Declared with no `max_uses`,
// deliberately: the model stops when it has enough, and a ceiling chosen by
// Eido would truncate exactly the long investigations this exists to enable.
// Cancel remains the stop. This is the fallback path when no Eido-executed
// set arrives (#961): proven code, not a dormant branch.
//
// The set itself lives with the reader that turns their calls into steps, so a
// declared tool and its provenance can never drift apart (ADR 0035).
const SERVER_TOOLS = DECLARED_SERVER_TOOLS.map((tool) => tool.declaration)

export type CompletionAsset = OpenRouterCompletionAsset

// The conversation this boundary accumulates while a tool loop runs (#961).
// Assistant turns carry their tool calls and, when the model produced any,
// their reasoning; tool turns carry the result of a call Eido executed.
type RawAssistantToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: unknown }
  | {
      role: 'assistant'
      content: string
      tool_calls: RawAssistantToolCall[]
      reasoning_details?: unknown[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

export type StreamOptions = {
  model: string
  /** Engine-owned annotation identifying this call within its execution plan. */
  providerCallClass?:
    | 'visible-reply'
    | 'follow-up'
    | 'group-digest'
    | 'context-compaction'
    | 'speaker-name'
  reasoningEffort: ReasoningEffort
  // Idea-level guidance injected at the network boundary. It deliberately stays
  // outside compiled instructions and source fingerprints.
  systemPrompt: string
  // A nudge appended to the system instruction, e.g. variation framing.
  variationNote?: string
  assets?: CompletionAsset[]
  temperature?: number
  signal?: AbortSignal
  onChunk: (text: string) => void
  // An Agentic Run: let the model search the web and open pages while it
  // thinks (ADR 0033). Off, the request is byte-identical to what it was
  // before Agentic Runs existed.
  agentic?: boolean
  // Called once per distinct tool the model used, as soon as it is known.
  onToolStep?: (step: RunToolStep) => void
  // Tools Eido executes itself (#961; #965 supersedes ADR 0033's "Eido never
  // runs a tool loop"). Injected by the caller as plain data, never imported,
  // so this transport cannot learn whose network answers a call and the
  // module that names the vendor stays below the injection point (#959).
  // With a set present alongside `agentic`, this boundary runs the loop;
  // absent, the provider-executed server tools above run exactly as before.
  eidoTools?: EidoToolSet
  // Told when prose already sent through onChunk turned out to be the model
  // talking between tool calls rather than the answer. The caller restarts
  // whatever it was accumulating; the trail narrates the progress instead.
  onAnswerRestart?: () => void
}

export type CompletionStream = (
  instruction: string,
  options: StreamOptions,
) => Promise<string>

export type AccessControlledStreamOptions = StreamOptions & Readonly<{
  accessGrant: AiAccessGrant
}>

export class AiError extends Error {}

/** Preferred provider interface for engine-owned execution. It accepts only a
 * resolver-issued grant, then delegates request construction and SSE parsing to
 * the one existing OpenRouter implementation. */
export function streamCompletionWithAccess(
  instruction: string,
  options: AccessControlledStreamOptions,
): Promise<string> {
  const { accessGrant, ...streamOptions } = options
  return streamCompletion(instruction, streamOptions, accessGrant)
}

/** Binds one engine admission to every model call in an action. Injected test
 * streams receive only credentialless request semantics; the real bearer is
 * unwrapped exclusively by the private provider transport. */
export function bindCompletionAccess(
  accessGrant: AiAccessGrant,
  injected?: CompletionStream,
): CompletionStream {
  return (instruction, options) => {
    if (injected) {
      assertAiAccessGrant(accessGrant, options.model)
      return injected(instruction, options)
    }
    return streamCompletionWithAccess(instruction, { ...options, accessGrant })
  }
}

// The provider refusing a request specifically because it was too long for the
// model (#1038). Distinguished from every other failure because it is the one
// the loop can do something about: compact and send it again. Its message is
// deliberately the same string the plain HTTP failure would have carried, so a
// refusal that survives the retry reaches the user exactly as it does today.
export class ContextOverflowError extends AiError {
  // The limit the provider named, when it named one. A number the provider
  // states beats any number Eido believed.
  readonly limitTokens?: number
  constructor(message: string, limitTokens?: number) {
    super(message)
    this.limitTokens = limitTokens
  }
}

// Providers word this refusal differently and none of them promise a stable
// code, so the match is on the wordings they actually use. Deliberately narrow:
// a failure wrongly read as an overflow costs a pointless summarising call, and
// one wrongly read as ordinary costs the whole run.
const CONTEXT_OVERFLOW_PHRASES = [
  'context length',
  'context_length',
  'context window',
  'maximum context',
  'too many tokens',
  'request too large',
  'request_too_large',
  'prompt is too long',
  'input is too long',
  'reduce the length of the messages',
  // Google's wording, which names neither a window nor a length: "The input
  // token count (1050000) exceeds the maximum number of tokens allowed
  // (1000000)." Unrecognised, it is not an overflow at all, so the run never
  // reaches the compact-and-retry recovery that would have saved it.
  'input token count',
  'exceeds the maximum number of tokens',
] as const

// Wordings that contain a length complaint but are not about the conversation.
// `max_tokens` is the ceiling on the ANSWER: a request refused for asking for
// too long a reply is not fixed by sending a shorter conversation, and the
// number beside it is a completion limit that must never be mistaken for a
// window. Checked first, so a message carrying both readings is not an
// overflow.
const NOT_CONTEXT_OVERFLOW_PHRASES = ['max_tokens', 'max tokens', 'maximum output', 'max_completion'] as const

// Phrases that mark the number before them as a PART of the request rather than
// the limit on it. Every provider that breaks the arithmetic down uses one:
// "(116000 in the messages, 16000 in the completion)".
const REQUEST_PART_PHRASES = [
  'in the message',
  'in your message',
  'in the prompt',
  'in your prompt',
  'in the completion',
  'for the completion',
] as const

// How far past a number to look for one of those phrases. Long enough for
// "116000 in the messages" and short enough not to reach the next clause.
const PART_PHRASE_REACH = 28

// What a refusal proves, when it is one:
//
//   undefined   not an overflow at all
//   null        an overflow, but the provider named no usable limit
//   a number    an overflow, and this is the window the provider will accept
export function contextOverflowLimit(status: number, detail: string): number | null | undefined {
  // Only a refusal of the request itself. A 429 is a rate limit and a 500 is
  // the provider's problem; neither is fixed by sending less.
  if (status !== 400 && status !== 413 && status !== 422) return undefined
  const haystack = detail.toLowerCase()
  if (NOT_CONTEXT_OVERFLOW_PHRASES.some((phrase) => haystack.includes(phrase))) return undefined
  // 413 is definitionally a size refusal, whatever the body says. Providers
  // return it with an HTML error page often enough that requiring a phrase
  // would miss the one status that cannot mean anything else.
  const named = CONTEXT_OVERFLOW_PHRASES.some((phrase) => haystack.includes(phrase))
  if (!named && status !== 413) return undefined

  // Which number in the message is the window.
  //
  // The naive reading is "the smallest number, because the count that broke the
  // limit is by definition larger than the limit". That is true of a two-number
  // message and wrong on the commonest four-number one:
  //
  //   "maximum context length is 128000 tokens. However, you requested 132000
  //    tokens (116000 in the messages, 16000 in the completion)."
  //
  // The smallest number there is the completion allowance. Recorded as the
  // window it would cut this model's believed size by eight, on this device,
  // permanently: it survives every catalog refresh, because the published
  // number has not moved. Every later Ask on that model would be truncated to
  // fit a window the model does not have.
  //
  // So a number that says it is part of the request is set aside, and the
  // smallest of what remains is the limit. That keeps the reading that is right
  // about two-number messages and unfamiliar wordings, without letting a
  // breakdown of the request masquerade as the window.
  // A number touching the end of the string is discarded: the body is read to a
  // cap, and a limit clipped mid-digit ("...is 1280" from 128000) would be
  // recorded as a window a hundred times too small. `recordModelWindow` refuses
  // an implausibly small number as well, so this is the second of two guards on
  // the one number that persists across runs.
  const unclipped = (index: number, digits: string) => index + digits.length < detail.length

  // A number followed by "in the messages" or "in the completion" is a part of
  // the request being described, not a limit, and must never be the smallest
  // number considered. Note this drops the number rather than the parentheses
  // around it: some providers state BOTH numbers parenthesised ("The input
  // token count (1050000) exceeds the maximum allowed (1000000)"), and throwing
  // out bracketed text would throw out the limit itself.
  const isRequestPart = (index: number, digits: string) => {
    const after = haystack.slice(index + digits.length, index + digits.length + PART_PHRASE_REACH)
    return REQUEST_PART_PHRASES.some((phrase) => after.includes(phrase))
  }

  const numbers = [...detail.matchAll(/\b(\d{4,9})\b/g)]
    .filter((match) => unclipped(match.index ?? 0, match[1]))
    .filter((match) => !isRequestPart(match.index ?? 0, match[1]))
    .map((match) => Number(match[1]))
  return numbers.length ? Math.min(...numbers) : null
}

// How many failed calls in a row, with no successful call anywhere between
// them, end the loop. This is a termination guard, never a spend ceiling: the
// founder retired every cost cap (#965), and a run that is making progress is
// never stopped, however long it runs, because any success resets the count.
// What the count catches is a loop with nothing left to spend it down: a
// provider returning 429 forever, a dead host, a tool the model keeps
// misnaming. Backoff delays the next attempt; it does not end one, and each
// attempt re-bills the entire conversation for no new information.
//
// A failed call is any answered call that did not execute successfully: a
// name no executor claims and arguments that do not parse count exactly like
// an executor failure, because a model hallucinating tool names is a loop
// getting nowhere at full price, and nothing else ends it.
//
// Three. The first failure is information the model acts on; the second
// shows its correction did not take; the third shows a pattern, and a fourth
// attempt buys no new information, only another bill for the whole
// conversation. The failure messages are truthful throughout, so a model
// with a real correction available lands it inside three tries or was never
// going to.
export const TOOL_FAILURE_STOP_LIMIT = 3

// What the model hears once the guard trips. A truthful degradation rather
// than a silent truncation: the run still ends in an answer, and the answer
// can say what went unchecked.
export const TOOL_FAILURE_STOP_NOTE =
  'Several lookups in a row have failed and none succeeded between them. Make no more tool calls. ' +
  'Answer with what you already have, and say plainly if something important could not be checked.'

type ToolCallFragment = { name: string; args: string; emitted: boolean }

// Reads provider-executed tool activity out of the response, wherever it
// turns up.
//
// OpenRouter's documentation does not commit to when server-tool calls and
// `url_citation` annotations arrive: they may stream as deltas, or land only on
// the finished message. This reader deliberately does not care. It watches
// every place either could appear, and the collector makes a repeat harmless,
// so the same code is correct under both behaviours and stays correct if the
// behaviour changes. That is why no live-capture spike gates this file.
function toolActivityReader(onStep: (step: RunToolStep) => void) {
  const collector = createToolStepCollector()
  const pending = new Map<number, ToolCallFragment>()

  const emit = (step: RunToolStep) => {
    const fresh = collector.add(step)
    if (fresh) onStep(fresh)
  }

  // A citation names a page the model actually read. Title is a nicety; the
  // address is the provenance.
  const readCitations = (annotations: unknown) => {
    if (!Array.isArray(annotations)) return
    for (const entry of annotations) {
      const citation = (entry as { url_citation?: { url?: unknown; title?: unknown } } | null)?.url_citation
      const url = typeof citation?.url === 'string' ? citation.url.trim() : ''
      if (!url) continue
      const title = typeof citation?.title === 'string' && citation.title.trim() ? citation.title.trim() : undefined
      emit({ kind: 'read', detail: url, ...(title ? { title } : {}) })
    }
  }

  // Only the tools this boundary declares are understood. Anything else the
  // model reports is ignored rather than guessed at.
  const stepFor = (fragment: ToolCallFragment): RunToolStep | null => {
    const tool = declaredServerToolFor(fragment.name)
    if (!tool) return null
    let detail = ''
    try {
      const parsed = JSON.parse(fragment.args) as Record<string, unknown>
      const value = tool.detailKeys.map((key) => parsed[key]).find((candidate) => candidate !== undefined)
      if (typeof value === 'string') detail = value.trim()
    } catch {
      // Arguments arrive in fragments, so an incomplete parse is expected until
      // the last one. A call whose arguments never complete is still reported,
      // with no detail, when the stream ends.
    }
    if (!detail) return null
    return { kind: tool.kind, detail }
  }

  const readToolCalls = (toolCalls: unknown) => {
    if (!Array.isArray(toolCalls)) return
    for (const [position, raw] of toolCalls.entries()) {
      const call = raw as { index?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } }
      const index = typeof call?.index === 'number' ? call.index : position
      const fragment = pending.get(index) ?? { name: '', args: '', emitted: false }
      const name = call?.function?.name ?? call?.type
      if (typeof name === 'string' && name) fragment.name = name
      if (typeof call?.function?.arguments === 'string') fragment.args += call.function.arguments
      pending.set(index, fragment)
      if (fragment.emitted) continue
      const step = stepFor(fragment)
      if (step) {
        fragment.emitted = true
        emit(step)
      }
    }
  }

  return {
    // One SSE payload or one finished response body, whichever this is.
    read: (json: unknown) => {
      const choice = (json as { choices?: Array<Record<string, unknown>> })?.choices?.[0]
      if (!choice) return
      const delta = choice.delta as { tool_calls?: unknown; annotations?: unknown } | undefined
      const message = choice.message as { tool_calls?: unknown; annotations?: unknown } | undefined
      readToolCalls(delta?.tool_calls)
      readToolCalls(message?.tool_calls)
      readCitations(delta?.annotations)
      readCitations(message?.annotations)
    },
    // A tool whose arguments never finished arriving still happened, and a step
    // strip that quietly drops it would be lying about what the answer read.
    flush: () => {
      for (const fragment of pending.values()) {
        if (fragment.emitted) continue
        const tool = declaredServerToolFor(fragment.name)
        if (!tool) continue
        fragment.emitted = true
        emit({ kind: tool.kind, detail: '' })
      }
    },
    steps: collector.steps,
  }
}

// Accumulates `reasoning_details` deltas into the shape the next request
// echoes back (#961). Reasoning-family models routed through OpenRouter expect
// the assistant turn's reasoning returned alongside its tool calls; stripped,
// the re-request is malformed or the model degrades. The merge is
// conservative: chunks sharing an `index` (or an `id`, when no index arrives)
// are one entry whose string payloads grew across the stream, and every other
// field keeps its freshest value. Whether providers accept exactly this shape
// is a named capture question, not an assumption: see
// research/10-linkup-web-intelligence/05-loop-capture.md.
function createReasoningCollector() {
  const GROWING: readonly string[] = ['text', 'summary', 'data']
  const order: Record<string, unknown>[] = []
  const byKey = new Map<string, Record<string, unknown>>()
  return {
    read: (list: unknown) => {
      if (!Array.isArray(list)) return
      for (const raw of list) {
        if (typeof raw !== 'object' || raw === null) continue
        const chunk = raw as Record<string, unknown>
        const key =
          typeof chunk.index === 'number'
            ? `index:${chunk.index}`
            : typeof chunk.id === 'string' && chunk.id
              ? `id:${chunk.id}`
              : 'lone'
        const entry = byKey.get(key)
        if (!entry) {
          const fresh = { ...chunk }
          byKey.set(key, fresh)
          order.push(fresh)
          continue
        }
        for (const [field, value] of Object.entries(chunk)) {
          if (GROWING.includes(field) && typeof value === 'string' && typeof entry[field] === 'string') {
            entry[field] = (entry[field] as string) + value
          } else if (value !== undefined && value !== null) {
            entry[field] = value
          }
        }
      }
    },
    entries: () => [...order],
  }
}

// What one streamed response amounted to, once read to the end.
type StreamedTurn = {
  text: string
  toolCalls: { id: string; name: string; args: string }[]
  reasoningDetails: unknown[]
  // What the provider says this request actually cost, counted with the
  // model's own tokenizer (#1035). OpenRouter includes it in the last frame of
  // every stream. It is the authority on everything sent up to this point, so
  // the loop only has to estimate what it appends afterwards. Null when the
  // provider sent none, and the loop then estimates the lot.
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number } | null
}

// One request, one streamed response, read to the end. Every piece of
// per-response state lives inside this function, created fresh for each
// request: tool-call deltas key on `index`, and indices restart at zero on
// every response, so any accumulator shared across the loop's iterations
// would land iteration two's first call on iteration one's fragment, merge
// two argument strings, and suppress the second step entirely (#961).
//
// The request leaves through the API-key access grant. This function never
// sees a raw credential.
async function streamOneRequest(
  body: Record<string, unknown>,
  options: Pick<StreamOptions, 'model' | 'signal' | 'onChunk'>,
  accessGrant: AiAccessGrant,
  serverToolReader: ReturnType<typeof toolActivityReader> | null,
  // Whether the travelling brief rides in this request's messages. Told by
  // the caller, which is the only place that knows: this transport receives
  // the brief as an anonymous system message and must stay unable to
  // recognise it (#959).
  briefIncluded = false,
): Promise<StreamedTurn> {
  // The Board Info wire record (#968): one entry per request that leaves for
  // the provider, tool declarations and all. A no-op until the record is on,
  // and it only ever sees the body's declaration list, never a header.
  wireRecordProviderRequest(ENDPOINT, body.tools, briefIncluded)
  let res: Response
  try {
    res = await fetchOpenRouterWithAccess(
      accessGrant,
      options.model,
      JSON.stringify(body),
      {
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Eido',
      },
      options.signal,
    )
  } catch {
    wireRecordFailure(ENDPOINT, 0, 'unreachable')
    throw new AiError(options.signal?.aborted ? 'canceled' : 'unreachable')
  }

  if (!res.ok || !res.body) {
    // Recorded before the body is read: status and kind only, never the
    // response text (#968).
    wireRecordFailure(ENDPOINT, res.status, res.status === 401 || res.status === 403 ? 'bad-key' : 'http')
    // Read further than the error message shows. The message the user's run
    // fails with stays 200 characters; the limit a provider names can sit past
    // that, and a limit clipped in half is worse than no limit at all.
    let body = ''
    try {
      body = (await res.text()).slice(0, 2_000)
    } catch {
      // A missing error body still reports the provider's status.
    }
    if (res.status === 401 || res.status === 403) throw new AiError('bad-key')
    const detail = body.slice(0, 200)
    const message = `http-${res.status}${detail ? ': ' + detail : ''}`
    const limit = contextOverflowLimit(res.status, body)
    if (limit !== undefined) throw new ContextOverflowError(message, limit ?? undefined)
    throw new AiError(message)
  }

  // Parse the Server-Sent Events stream.
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  const pendingCalls = new Map<number, { id?: string; name: string; args: string }>()
  const reasoning = createReasoningCollector()
  let usage: StreamedTurn['usage'] = null

  // Usage arrives once, in the stream's last frame, and OpenRouter sends it on
  // every completion without being asked. Read wherever it turns up rather
  // than only at the end, for the same reason the tool reader watches
  // everywhere: nothing here depends on the provider's frame ordering.
  const readUsage = (raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return
    const entry = raw as {
      prompt_tokens?: unknown
      completion_tokens?: unknown
      prompt_tokens_details?: { cached_tokens?: unknown } | null
    }
    const prompt = typeof entry.prompt_tokens === 'number' ? entry.prompt_tokens : null
    if (prompt === null) return
    const cached = entry.prompt_tokens_details?.cached_tokens
    usage = {
      promptTokens: prompt,
      completionTokens: typeof entry.completion_tokens === 'number' ? entry.completion_tokens : 0,
      cachedTokens: typeof cached === 'number' && cached > 0 ? cached : 0,
    }
  }

  const readTurnToolCalls = (list: unknown, form: 'delta' | 'whole') => {
    if (!Array.isArray(list)) return
    for (const [position, raw] of list.entries()) {
      const call = raw as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } }
      const index = typeof call?.index === 'number' ? call.index : position
      const entry = pendingCalls.get(index) ?? { name: '', args: '' }
      if (typeof call?.id === 'string' && call.id) entry.id = call.id
      const name = call?.function?.name
      if (typeof name === 'string' && name) entry.name = name
      const args = call?.function?.arguments
      // Deltas accumulate fragments; a finished message carries the whole
      // string, so it replaces rather than doubles what the deltas built.
      if (typeof args === 'string') entry.args = form === 'delta' ? entry.args + args : args
      pendingCalls.set(index, entry)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // keep the last partial line
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const data = trimmed.slice('data:'.length).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data) as { choices?: Array<Record<string, unknown>>; usage?: unknown }
        serverToolReader?.read(json)
        readUsage(json.usage)
        const choice = json.choices?.[0]
        const delta = choice?.delta as Record<string, unknown> | undefined
        const message = choice?.message as Record<string, unknown> | undefined
        readTurnToolCalls(delta?.tool_calls, 'delta')
        readTurnToolCalls(message?.tool_calls, 'whole')
        reasoning.read(delta?.reasoning_details)
        reasoning.read(message?.reasoning_details)
        const text = typeof delta?.content === 'string' ? delta.content : ''
        if (text) {
          full += text
          options.onChunk(text)
        }
      } catch {
        // OpenRouter sends occasional comment/keepalive lines; ignore unparseable.
      }
    }
  }

  serverToolReader?.flush()
  return {
    text: full,
    toolCalls: [...pendingCalls.entries()]
      .sort(([left], [right]) => left - right)
      .filter(([, call]) => call.name)
      .map(([index, call]) => ({ id: call.id ?? `call_${index}`, name: call.name, args: call.args })),
    reasoningDetails: reasoning.entries(),
    usage,
  }
}

// Whether this turn may teach the estimator anything. A provider that served
// part of the prompt from its cache is the one case that could make the ratio
// too SMALL, and too small is the dangerous direction: it would read a full
// card as having room and send it into the refusal this all exists to prevent.
// OpenRouter documents `prompt_tokens` as the whole input with `cached_tokens`
// as an informational subset, so this should never bite; it costs one
// comparison to be sure, and the alternative is trusting a normalisation across
// hundreds of providers.
function isCalibrationSample(
  usage: StreamedTurn['usage'],
  carriesUncountedWeight: boolean,
): usage is NonNullable<StreamedTurn['usage']> {
  return Boolean(usage) && !carriesUncountedWeight && usage!.cachedTokens === 0
}

function throwIfCanceledSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AiError('canceled')
}

// A rate limit is waited out, not retried into (#961). Told a tool failed,
// models retry immediately, and with no pause a 429 becomes a spin loop that
// re-bills the full prompt on every turn. The wait honours cancel.
function waitOut(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new AiError('canceled'))
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, Math.max(seconds, 0) * 1000)
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function parseCallArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

// The request body and its message list, derived once from the one shared
// body authority so Agentic Runs cannot drift the prompt. The shared builder
// returns the exact serialized body; the loop needs data it can extend.
function parsedCompletionBody(
  instruction: string,
  options: StreamOptions,
): { baseBody: Record<string, unknown>; messages: ChatMessage[] } {
  const { messages, ...baseBody } = JSON.parse(
    buildOpenRouterCompletionBody(instruction, options),
  ) as Record<string, unknown> & { messages: ChatMessage[] }
  return { baseBody, messages }
}

// Streams a completion, calling onChunk with each token as it arrives. Resolves
// with the full text. Throws AiError on failure; callers turn it into plain words.
//
// With Eido-executed tools present, this is also the tool loop (#961): declare
// the tools, execute what the model calls, append each result in the shape the
// model expects, and re-request until the model answers with no further calls,
// streaming throughout.
async function streamCompletion(
  instruction: string,
  options: StreamOptions,
  accessGrant: AiAccessGrant,
): Promise<string> {
  assertProfileReviewModel(options.model)

  // Local harnesses own their tools and transport, including their tool loop.
  const local = streamLocalCompletionWithAccess(accessGrant, instruction, options)
  if (local) return local

  const { baseBody, messages } = parsedCompletionBody(instruction, options)

  // What this request carries that the estimator cannot see, and therefore
  // cannot learn from. Two sources, one rule.
  //
  // An attachment: the estimator sees a filename, the provider sees a picture
  // and charges thousands of tokens for it. Tool declarations and plugins: they
  // never enter `messages` at all, and OpenRouter expands its server tools into
  // full schemas on its side before the model sees them, so the overhead is
  // larger than the two lines Eido declares.
  //
  // Either way the gap between estimate and charge is a fixed lump that has
  // nothing to do with how this model tokenizes text. Recorded as a ratio it
  // becomes a multiplier, and a 1,200-token Ask with web on would teach every
  // later 100k-token card on that model to read 57% high and compact at two
  // thirds full. Such requests are simply not sampled.
  const carriesUncountedWeight =
    Boolean(options.assets?.length) || Boolean(options.agentic)

  const eidoTools = options.agentic && options.eidoTools?.tools.length ? options.eidoTools : null

  // No Eido-executed set: one request, exactly as before #961. Provider
  // server tools when the Card asked for an Agentic Run, none otherwise, and
  // the reader that watches for their activity is unchanged, so the no-key
  // path cannot drift off the behaviour it shipped with.
  if (!eidoTools) {
    const serverToolReader = options.onToolStep ? toolActivityReader(options.onToolStep) : null
    try {
      const turn = await streamOneRequest(
        {
          ...baseBody,
          ...(options.agentic ? { tools: SERVER_TOOLS } : {}),
          messages,
        },
        options,
        accessGrant,
        serverToolReader,
      )
      // What this exact request really cost, against what Eido estimated it
      // would (#1035). Recorded on the plain path too, and especially here: an
      // ordinary Result Card only ever takes this path, and the card-level
      // guard that decides when to compact reads its estimates through the
      // ratio this leaves behind.
      if (isCalibrationSample(turn.usage, carriesUncountedWeight)) {
        recordTokenCalibration(options.model, estimateConversationTokens(messages), turn.usage.promptTokens)
      }
      return turn.text
    } catch (err) {
      // Nothing here can be compacted. There is no history, only the
      // instruction the person's own graph compiled. The refusal still
      // corrects what Eido believes this model's window to be, so the next
      // run compiles under a truthful budget instead of the same wrong one.
      if (err instanceof ContextOverflowError && err.limitTokens) {
        recordModelWindow(options.model, err.limitTokens)
      }
      throw err
    }
  }

  // The Eido-executed loop (#961). The step for every call lands as Eido
  // makes it, one line per call, repeats included: the trail reports spend as
  // well as provenance, so the same search paid for twice is two lines. That
  // is why these steps bypass the citation reader's dedupe entirely.
  //
  // The loop has no iteration bound and no call budget (#965). Its one guard
  // counts consecutive failed calls, and any call that works resets it, so
  // the only run it can end is one that has stopped getting anywhere.
  const declarations = eidoTools.tools.map((tool) => tool.declaration)
  // The travelling brief: how to phrase a lookup and when to move up a depth,
  // carried on the set as data so this transport never learns whose network
  // the advice is about. It rides only when the tools it teaches are
  // declared, which is why it joins the system text here rather than in the
  // shared framing above, and it stands with that text, before the user turn.
  const brief = eidoTools.brief.trim()
  const conversation: ChatMessage[] = [...messages]
  if (brief) {
    conversation.splice(conversation.length - 1, 0, { role: 'system', content: brief })
  }
  let consecutiveFailures = 0
  let stopNoteSent = false

  // ---- staying inside the window (#1035, #1036) ---------------------------
  //
  // The loop measures how full it is before every request and compacts rather
  // than walking into a refusal. The measurement leans on the provider: the
  // usage it reported for the last request is the authority on everything sent
  // up to that point, counted with the model's own tokenizer, so only what has
  // been appended since needs estimating. With no usage reported the whole
  // thing falls back to the estimator, which is what the context budgets have
  // always used.
  let windowTokens = contextWindowFor(options.model)
  let compactionThreshold = Math.floor(windowTokens * COMPACTION_THRESHOLD_SHARE)
  let lastUsage: { promptTokens: number; completionTokens: number } | null = null
  // Everything before this index is covered by `lastUsage`. Set the moment the
  // assistant turn is appended, because its cost is the completion the
  // provider just charged for; the tool results appended after it are not.
  let measuredUpTo = 0
  // The note from this run's last compaction. The next one supersedes it
  // rather than stacking beside it, so a run that compacts five times still
  // carries exactly one note.
  let previousSummary: string | undefined
  // Set when compaction has nothing left to give. The loop then behaves like
  // the repeated-failure guard: the model is told, the tools come off, and the
  // run still ends in an answer that can say what went unchecked.
  let contextExhausted = false
  let contextNoteSent = false
  // One recovery per refusal, reset by any request that succeeds. A second
  // refusal in a row means sending less was not the problem.
  let overflowRecovered = false
  // A summariser that keeps failing must not be asked on every remaining turn:
  // each attempt is a full-price call at the size of the window. After two in a
  // row the loop stops asking and leaves the provider to judge, which is where
  // it would have ended up anyway. Tools stay on throughout.
  let compactionFailures = 0

  const projectedPromptTokens = (): number =>
    lastUsage
      ? lastUsage.promptTokens
        + lastUsage.completionTokens
        + calibratedTokens(options.model, estimateConversationTokens(conversation.slice(measuredUpTo)))
      : calibratedTokens(options.model, estimateConversationTokens(conversation))

  // Replace the history with a note the model writes about it.
  //
  //   'reduced'      the run is back under the threshold
  //   'insufficient' a cut was made and did not get there
  //   'failed'       the summariser could not be asked, or said nothing
  //   'not-worth-it' there was nothing but the instruction to cut
  //
  // 'failed' is deliberately not 'insufficient'. A single 500 from the
  // summariser proves nothing about how much room the run has, and treating it
  // as proof would take the tools away for the rest of the run and tell the
  // model "there is no room left" without ever having established that. A
  // failed tidy-up is not a failed run (ADR 0038): the history stands, the
  // tools stay, and the provider gets to be the one that says no.
  //
  // The third outcome is deliberately not a failure. Being over the threshold
  // with no history to drop means the belief about this model's window may
  // simply be wrong (a stale catalog, an unlisted slug), and disabling tools
  // on a belief the provider has not confirmed would cripple a run that would
  // have worked. So the guard defers: it lets the request go, and if the
  // provider really does refuse it, the recovery path below acts on a number
  // the provider stated rather than one Eido guessed.
  //
  // The summariser is the run's own model, deliberately. A cheap small model is
  // the obvious saving and the wrong one: the conversation being summarised is
  // by definition near a large window, and a small model's own window cannot
  // hold it, so the saving buys a call that fails exactly when it is needed.
  const compactConversation = async (): Promise<
    'reduced' | 'insufficient' | 'failed' | 'not-worth-it'
  > => {
    const plan = planCompaction(conversation, compactionThreshold)
    if (!plan) return 'not-worth-it'
    let summary = ''
    try {
      const written = await streamOneRequest(
        {
          model: options.model,
          stream: true,
          reasoning: { effort: COMPACTION_REASONING_EFFORT },
          messages: [
            { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildCompactionInstruction(
                renderCompactionMaterial(plan.summarize, previousSummary),
              ),
            },
          ],
        },
        // The summary is not the answer, so none of it reaches the Card's
        // streaming text. The trail row is where it shows.
        { model: options.model, signal: options.signal, onChunk: () => {} },
        // The summariser is a provider call like any other, so it leaves
        // through the same grant the run was admitted on. A tidy-up request
        // is not a licence to reach the provider unchecked.
        accessGrant,
        null,
      )
      summary = written.text.trim()
    } catch (err) {
      // Cancel is the user's, and it stops everything. Any other failure
      // leaves the run standing on the history it already had: a failed
      // tidy-up is not a failed run.
      if (options.signal?.aborted) throw err
      return 'failed'
    }
    if (!summary) return 'failed'

    const rebuilt = rebuildConversation(plan, summary)
    conversation.splice(0, conversation.length, ...rebuilt)
    previousSummary = summary
    // Either guard's note may have just been summarised into prose. Both are
    // owed again if their condition still holds, because "you were told once,
    // in a paragraph that no longer exists" is not being told.
    stopNoteSent = false
    contextNoteSent = false
    // The provider's usage described a conversation that no longer exists.
    lastUsage = null
    measuredUpTo = 0
    options.onToolStep?.(compactionStep(summary))
    return projectedPromptTokens() < compactionThreshold ? 'reduced' : 'insufficient'
  }
  // Set only while the set's required first call is still owed. Once the model
  // has made any call the loop is the model's own again: forcing every turn
  // would trap a run in one tool, and the point was only that the run must
  // begin by doing the thing it was started to do.
  let owedFirstCall = eidoTools.requireFirstCall

  for (;;) {
    throwIfCanceledSignal(options.signal)

    // Before the request, not after the refusal. Compacting early costs one
    // summarising call; compacting late costs the whole run.
    if (
      !contextExhausted
      && compactionFailures < COMPACTION_FAILURE_LIMIT
      && projectedPromptTokens() >= compactionThreshold
    ) {
      const outcome = await compactConversation()
      // Only a cut that was made and did not get there proves there is no room.
      if (outcome === 'insufficient') contextExhausted = true
      if (outcome === 'failed') compactionFailures += 1
      if (outcome === 'reduced') compactionFailures = 0
    }
    if (contextExhausted && !contextNoteSent) {
      contextNoteSent = true
      conversation.push({ role: 'system', content: CONTEXT_EXHAUSTED_NOTE })
    }

    // Two different reasons to stop calling tools, told apart because the model
    // is given a different explanation for each and neither may wear the
    // other's words: "your lookups keep failing" and "there is no room left"
    // are not the same message, and an answer written under the wrong one
    // would misreport what went unchecked.
    const failureStopped = consecutiveFailures >= TOOL_FAILURE_STOP_LIMIT
    const stopped = failureStopped || contextExhausted
    // The model is told why it must answer, once, even when the guard tripped
    // between turns and no overflow call carried the note: 'none' alone would
    // forbid the tools without saying so, and the answer should be able to
    // say what went unchecked.
    if (failureStopped && !stopNoteSent) {
      stopNoteSent = true
      conversation.push({ role: 'system', content: TOOL_FAILURE_STOP_NOTE })
    }
    const requestBody = {
        ...baseBody,
        tools: declarations,
        // Once the guard has tripped the model has been told to answer;
        // 'none' makes the provider hold it to that. Otherwise, while a
        // required first call is still owed, the provider holds the model to
        // that one instead.
        ...(stopped
          ? { tool_choice: 'none' }
          : owedFirstCall
            ? { tool_choice: { type: 'function', function: { name: owedFirstCall } } }
            : {}),
        messages: conversation,
    }
    let turn: StreamedTurn
    try {
      turn = await streamOneRequest(requestBody, options, accessGrant, null, brief !== '')
    } catch (err) {
      // The threshold is measured against a window Eido believes the model
      // has, and that belief can be wrong: a stale catalog, a slug nobody
      // lists, a provider serving less than the headline number. When the
      // provider disproves it, take its number, compact, and send once more
      // (#1038). A second refusal in a row means length was not the problem.
      //
      // Two things stop this repeating, deliberately. The outcome check below
      // ends it whenever compaction has nothing left to cut, which is what
      // actually terminates the common case. This flag bounds it at one
      // recovery per successful turn regardless, so that a change to what
      // counts as worth cutting can never turn the recovery into a cycle of
      // full-size refused requests each paying for a full-size summariser call.
      if (!(err instanceof ContextOverflowError) || overflowRecovered) throw err
      overflowRecovered = true
      if (err.limitTokens) {
        recordModelWindow(options.model, err.limitTokens)
        windowTokens = contextWindowFor(options.model)
        compactionThreshold = Math.floor(windowTokens * COMPACTION_THRESHOLD_SHARE)
      }
      lastUsage = null
      measuredUpTo = 0
      const outcome = await compactConversation()
      // Only retry a request that is actually different from the one just
      // refused. With nothing cut, the retry is the same bytes or, once the
      // exhausted note is appended, more of them: a second refusal bought at
      // the price of a whole request.
      if (outcome !== 'reduced' && outcome !== 'insufficient') throw err
      // The provider has already refused, so a cut that did not clear the
      // threshold means the tools come off for whatever room is left.
      if (outcome === 'insufficient') contextExhausted = true
      continue
    }
    overflowRecovered = false
    // Deliberately no calibration sample here. Every request in this loop
    // declares tools, and what a tool schema costs on the wire is not something
    // Eido's estimate of the conversation can be held to. A ratio learned here
    // would read as the estimator being wrong by whatever the declarations
    // weigh, and would then be applied to plain requests that carry none.
    // `carriesUncountedWeight` says the same thing; this says why.
    if (turn.toolCalls.length > 0) owedFirstCall = undefined

    if (turn.toolCalls.length === 0) return turn.text
    // A model that keeps calling after being held to 'none' gets its words
    // returned as they stand: an answer, however thin, over an error the
    // user pays for.
    if (stopped) return turn.text

    // What the model was working out before the calls it is about to make,
    // when it said so in words (#966). Emitted ahead of those calls, so the
    // trail reads in the order it happened. A turn whose reasoning carried no
    // readable text adds no row, and the final answer turn's reasoning is
    // never a step at all: it sits between the last lookup and the answer,
    // and the answer landing right under the trail is its record.
    const thought = thinkingStepFrom(turn.reasoningDetails)
    if (thought) options.onToolStep?.(thought)

    // Whatever prose streamed in this turn was the model talking between tool
    // calls, not the answer. The trail narrates the progress; the saved
    // answer keeps only the final turn (#961). A cancel from here on keeps
    // the recorded steps and the current turn's partial prose, deliberately:
    // the steps are real spend, and the prose is the freshest thing the model
    // was saying.
    options.onAnswerRestart?.()

    conversation.push({
      role: 'assistant',
      content: turn.text,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.args },
      })),
      ...(turn.reasoningDetails.length ? { reasoning_details: turn.reasoningDetails } : {}),
    })
    // Everything up to here is covered by the usage just reported: the prompt
    // that was sent, plus the completion that became the turn above. What the
    // tool calls below append is what the next projection has to estimate.
    //
    // The figure and the boundary it covers move together or not at all. A turn
    // that reported no usage must leave both alone: advancing the boundary
    // against a stale figure would drop that whole turn out of the count, and
    // the hole would grow with every further silent turn until the run walked
    // into the refusal this all exists to prevent.
    if (turn.usage) {
      lastUsage = turn.usage
      measuredUpTo = conversation.length
    }

    for (const call of turn.toolCalls) {
      throwIfCanceledSignal(options.signal)
      // The call as the model made it, name and arguments, before any
      // judgment about whether an executor claims it (#968). No-op when the
      // record is off.
      wireRecordToolCall(call.name, call.args)
      // The guard can trip in the middle of a turn of parallel calls. Every
      // reported call must still be answered, because a tool_call_id without
      // a tool message is a malformed re-request, so the calls past the trip
      // are told to stop rather than executed. Carrying the note here is
      // telling the model, so the loop head need not say it again.
      if (consecutiveFailures >= TOOL_FAILURE_STOP_LIMIT) {
        stopNoteSent = true
        wireRecordToolResult(call.name, 0, 0, 'stopped')
        conversation.push({ role: 'tool', tool_call_id: call.id, content: TOOL_FAILURE_STOP_NOTE })
        continue
      }
      // A call the loop could not even hand to an executor counts against the
      // guard like any other failure: a model stuck misnaming a tool or
      // mangling its arguments is a loop getting nowhere, and nothing else
      // ends it now.
      const tool = eidoTools.tools.find((candidate) => candidate.matches(call.name))
      if (!tool) {
        consecutiveFailures += 1
        wireRecordToolResult(call.name, 0, 0, 'unknown-tool')
        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `There is no tool named "${call.name}". Use only the declared tools, or answer with what you have.`,
        })
        continue
      }
      const args = parseCallArguments(call.args)
      if (!args) {
        consecutiveFailures += 1
        wireRecordToolResult(call.name, 0, 0, 'bad-arguments')
        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          content:
            'The arguments did not parse as one JSON object. Send arguments matching the tool parameters, or answer with what you have.',
        })
        continue
      }
      // Timed only while the record is on: the guarded Date.now() is the
      // cheapest way for off to pay nothing here (#968).
      const callStartedAt = isWireRecording() ? Date.now() : 0
      let outcome
      try {
        outcome = await tool.execute(args, options.signal, (step) => options.onToolStep?.(step))
      } catch {
        // Executors reject only for cancel; anything else here is a bug in
        // one, and a tool that fails must still not fail the run.
        if (options.signal?.aborted) throw new AiError('canceled')
        consecutiveFailures += 1
        wireRecordToolResult(call.name, callStartedAt ? Date.now() - callStartedAt : 0, 0, 'error')
        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'The tool failed before it could answer. Do not retry this exact call.',
        })
        continue
      }
      // Success resets the count. That is the whole promise of the guard: a
      // run making progress is never stopped, however long it runs, because
      // progress keeps starting the count over.
      consecutiveFailures = outcome.failed ? consecutiveFailures + 1 : 0
      wireRecordToolResult(
        call.name,
        callStartedAt ? Date.now() - callStartedAt : 0,
        outcome.resultText.length,
        outcome.failed ? 'failed' : 'ok',
      )
      if (outcome.step) options.onToolStep?.(outcome.step)
      conversation.push({ role: 'tool', tool_call_id: call.id, content: outcome.resultText })
      if (outcome.waitSeconds) await waitOut(outcome.waitSeconds, options.signal)
    }
  }
}
