// What an Agentic Run is, in one place (ADR 0033; #965 supersedes its "Eido
// never runs a tool loop").
//
// An Agentic Run is an ordinary Run in which the model may call tools instead
// of answering from the compiled instruction alone. This module owns the two
// things every executor has in common:
//
//   Who executes the tools differs by what exists. With a Linkup key on an
//   OpenRouter run, the caller passes Eido-executed tools in and Eido runs
//   the loop itself (#961). Without one, Eido declares two server tools and
//   OpenRouter runs them inside the same request. On the local CLI harnesses,
//   the harness already owns its own tools and its own loop, and Eido asserts
//   nothing new over the bridge. The Card says which of these is happening,
//   because a silently weaker run is worse than a visibly different one.
//
//   What the model did has one shape, whoever ran it, so provenance does not
//   fork by provider.
//
// Two vocabularies, deliberately different sizes (ADR 0035). What Eido
// DECLARES is closed and small, because Eido must only ask for tools it can
// stand behind: today that is exactly two. What Eido RECORDS is open, because a
// Run written by a later build must still open in this one, and a step nobody
// here recognises is a fact about what happened, not a corrupt file.

import type { AiProvider } from './aiProviderTypes'

// One tool the model used during an Agentic Run. Stored on the Run and shown
// on the result Card. Page text is never kept: the address is the provenance,
// and the answer is the content.
//
// `kind` is an open vocabulary, not a union. Widening it later is a registry
// entry (`runToolVocabulary`) and its words, not a change to this type, to the
// persistence validator, or to any component.
export type RunToolStep = Readonly<{
  kind: string
  // What the model searched for, or the address it opened. May be empty when
  // the provider reported that a tool ran without saying what it was given.
  detail: string
  // The page's title, when the provider supplied one.
  title?: string
}>

// The tools Eido declares to OpenRouter, and how their reported calls become
// steps. One entry per tool, so a third declared tool is one row here rather
// than a change spread across the streaming reader.
//
// `matches` is generous about the name because a provider may qualify or
// prefix it; the request is what fixes which tools can run at all, and it names
// only these.
export const DECLARED_SERVER_TOOLS = [
  {
    declaration: { type: 'openrouter:web_search', parameters: { engine: 'auto' } },
    matches: (name: string) => name.includes('search'),
    kind: 'search',
    detailKeys: ['query', 'q'],
  },
  {
    declaration: { type: 'openrouter:web_fetch', parameters: { engine: 'openrouter' } },
    matches: (name: string) => name.includes('fetch'),
    kind: 'read',
    detailKeys: ['url'],
  },
] as const

export type DeclaredServerTool = (typeof DECLARED_SERVER_TOOLS)[number]

// Which declared tool a reported call belongs to, or nothing. A name Eido did
// not declare is ignored rather than guessed at: the request named two tools,
// so a third would be the provider inventing work Eido cannot stand behind.
export function declaredServerToolFor(name: string): DeclaredServerTool | null {
  return DECLARED_SERVER_TOOLS.find((tool) => tool.matches(name)) ?? null
}

// ---- Eido-executed tools (#961) ---------------------------------------------
//
// The declared set splits by executor rather than growing (ADR 0035 keeps the
// declared vocabulary closed either way). When the caller can execute a tool
// itself, it hands the completion boundary a set of these; the boundary then
// runs the loop: declare, wait for calls, execute, append the result in the
// shape the model expects, re-request. The types are data, deliberately: the
// transport that consumes them must never learn whose network answers a call,
// so the modules that name a vendor stay below the injection point (#959).

// What one executed call hands back. Every ordinary failure comes back as one
// of these rather than as a rejection, because a tool that fails must not fail
// the run: the model is told, the Card shows the step, and the loop moves on.
export type EidoToolOutcome = Readonly<{
  // Exactly what the model is told, already capped for the prompt. On failure
  // this says what went wrong and whether retrying could help.
  resultText: string
  // The line the Card shows for this call, when a call was actually made. A
  // request refused before the network (blank arguments, say) records
  // nothing, because nothing was spent and nothing was reached.
  step?: RunToolStep
  // Set when the provider said to slow down: seconds the loop must sit out
  // before its next call, instead of retrying into the same wall.
  waitSeconds?: number
  // True when the call produced nothing the model asked for. The model is
  // told either way; this flag is for the loop, which counts consecutive
  // failures toward its termination guard and resets the count on any call
  // that worked. A separate field rather than a reading of `step.kind`,
  // because the step vocabulary belongs to the Card and must stay free to
  // grow without the loop's stopping rule changing underneath it.
  failed?: boolean
}>

export type EidoExecutedTool = Readonly<{
  // An ordinary function tool in the OpenAI shape OpenRouter speaks natively.
  declaration: Readonly<{
    type: 'function'
    function: Readonly<{ name: string; description: string; parameters: Record<string, unknown> }>
  }>
  // Exact for Eido-executed tools, unlike the server set above. The server
  // matchers are generous because OpenRouter may qualify or prefix a name it
  // reports; these names Eido chose and the model echoes verbatim, and a
  // generous matcher is how "research" once nearly landed on "search".
  matches: (name: string) => boolean
  // Runs one call. Rejects only for cancel; every other failure is an outcome.
  //
  // `announce` lets a tool that will be a while say what it is doing the
  // moment it knows, rather than leaving the trail empty until it returns.
  // Research needs it: the job runs for minutes, and a Card that shows
  // nothing for four of them looks stuck rather than busy (founder report
  // 2026-08-18). A tool that announces must not also return the same step,
  // or the trail counts the one lookup twice.
  execute: (
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    announce?: (step: RunToolStep) => void,
  ) => Promise<EidoToolOutcome>
}>

export type EidoToolSet = Readonly<{
  tools: readonly EidoExecutedTool[]
  // Prompt tokens the context compile must leave free so the loop's capped
  // tool results fit without pushing a re-request over the model window.
  // There is no call budget beside it any more: the founder retired every
  // spend ceiling (#965), and the loop's only guard is about termination,
  // never cost.
  promptReserveTokens: number
  // Prose that travels with the tools into the system prompt: how to phrase a
  // lookup, when to move up a depth, what spans the individual descriptions.
  // Carried here as data so the transport that appends it never learns whose
  // network the advice is about (#959).
  brief: string
  // The one tool the model must call on the first turn, by name, or undefined
  // when the model is free to answer without calling anything. Research mode
  // sets it: a person who chose Research, chose a depth and pressed Run twice
  // has said what the run is for, and a model that answers from memory anyway
  // has ignored the only instruction that cost money. Observed in the wild on
  // a small fast model, which returned in sixteen seconds with an empty trail
  // (founder report 2026-08-18). Named here as data, so the transport that
  // forces it never learns whose network it belongs to.
  requireFirstCall?: string
}>

// ---- Thinking between lookups (#966) ----------------------------------------

// How much of one turn's reasoning a Run keeps, in characters. The trail is
// saved with the Board, and reasoning is the one part of a run with no natural
// size: a long research run can think tens of thousands of characters across
// its turns, and an unbounded record would grow every saved Board without
// limit. Two thousand characters is a few paragraphs: enough to follow why the
// next lookup happened, which is all the trail is for, and it caps even a
// fifty-turn run's whole thinking record near the weight of one small image.
// The head is kept, because a passage is read from its first words; the cut is
// marked, so a shortened record never passes as a complete one.
export const THINKING_STEP_KEEP_CHARS = 2000

// The readable words in one turn's accumulated `reasoning_details`, as a step,
// or nothing. Nothing is deliberate (#966): several models return a signed or
// redacted block with no text in it, which is the model proving it thought
// rather than saying what it thought, and an empty row would dress that proof
// up as a record. Only `text` and `summary` fields are read; `data` carries
// the encrypted proof and is never mistaken for words. And no second model is
// ever asked to summarise a passage: that would bill the user for decoration.
export function thinkingStepFrom(reasoningDetails: readonly unknown[]): RunToolStep | null {
  const passages: string[] = []
  for (const raw of reasoningDetails) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    for (const field of ['text', 'summary'] as const) {
      const value = entry[field]
      if (typeof value === 'string' && value.trim()) passages.push(value.trim())
    }
  }
  const whole = passages.join('\n\n')
  if (!whole) return null
  if (whole.length <= THINKING_STEP_KEEP_CHARS) return { kind: 'thinking', detail: whole }
  const head = whole.slice(0, THINKING_STEP_KEEP_CHARS)
  const lastBreak = head.lastIndexOf(' ')
  // Cut at a word when one is near; a mid-word cut is kept only when the tail
  // is one unbroken run of characters, where any cut lands mid-word anyway.
  const kept = lastBreak > THINKING_STEP_KEEP_CHARS - 200 ? head.slice(0, lastBreak) : head
  return { kind: 'thinking', detail: `${kept.trimEnd()} …` }
}

// How the active provider comes by its tools.
//
//   'declared'      Eido names the tools in the request; the provider runs them.
//   'provider-owned' The provider's own harness owns them; Eido asserts nothing.
export type AgenticReach = 'declared' | 'provider-owned'

export function agenticReachFor(provider: AiProvider): AgenticReach {
  return provider === 'openrouter' ? 'declared' : 'provider-owned'
}

// Dedupe key for a step. A provider may report the same citation more than
// once across a stream, and the same page read twice is one thing the model
// read, not two.
export function toolStepKey(step: RunToolStep): string {
  return `${step.kind}:${step.detail}`
}

// Collects steps as they arrive, in order, without repeats. Used by the
// streaming boundary, which cannot know whether a provider will report a step
// once or on every chunk.
export function createToolStepCollector(): {
  add: (step: RunToolStep) => RunToolStep | null
  steps: () => RunToolStep[]
} {
  const seen = new Set<string>()
  const collected: RunToolStep[] = []
  return {
    add: (step) => {
      const key = toolStepKey(step)
      if (seen.has(key)) return null
      seen.add(key)
      collected.push(step)
      return step
    },
    steps: () => [...collected],
  }
}
