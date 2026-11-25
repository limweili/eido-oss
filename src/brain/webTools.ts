// The Eido-executed web tools an Agentic Run hands to the completion boundary
// (#961, reshaped by #965). This module is the executor injection point: it is
// the top of the stack allowed to import the Linkup boundary. The transport
// below receives these executors as plain data and never learns whose network
// answers them, which keeps #959's promise that `linkup.ts` is the only module
// naming Linkup.
//
// The parameters are the model's, on founder direction (#965, reversing #960
// and the ceiling design in #962): depth, domain filters, date filters, page
// rendering, and fetch effort are retrieval decisions, and the model making
// the call knows the retrieval question better than Eido knew it at Card
// time. The tool descriptions below are how that works in practice. They
// carry the vendor's own selection rules to the model on every request, so
// "the user does not choose, the model decides per task" is a decision made
// with the rule in front of it rather than a guess.
//
// Eido still fixes what is not a retrieval decision. `outputType` is pinned
// to sources and never declared, because Eido runs the loop and this model
// does the synthesis: paying the vendor's model to write prose that this
// model then rewrites would buy latency and nothing else. And the per-result
// cap plus the prompt reserve stay, because they are the size of the
// container, not a spending choice: the model window is finite however
// unconcerned anyone is about price.
//
// Research's `reasoningDepth` is the one deliberate exception to "the
// parameters are the model's" (#971, founder decision 2026-08-18): a research
// job spends dollars per press, and dollars are not machinery. The user picks
// the depth on the Card, it arrives here pinned, and the parameter is not
// declared to the model at all. `mode` stays the model's, because shape is.

import { linkupKeyOf } from '../graph/store'
import { webToolFailureLabel, webToolFailureWordKey, words } from '../shared/words'
import type { EidoExecutedTool, EidoToolOutcome, EidoToolSet } from './agenticRun'
import {
  fetchPage,
  resumeResearch,
  runResearch,
  searchWeb,
  WebToolError,
  type FetchPageMode,
  type ResearchReasoningDepth,
  type ResearchReport,
  type WebSearchDepth,
} from './linkup'
import { DEFAULT_RESEARCH_DEPTH } from './researchDepth'
import { DEFAULT_REACH_MODE, type ReachMode } from './reachMode'

// The travelling brief: prose that rides in the system prompt whenever reach
// is on. The tool descriptions each teach one tool's own parameters; this
// carries what spans them, which is that a lookup here is an instruction to a
// retrieval system rather than a question to a person, and how to phrase one.
// It is re-sent on every request of every loop iteration, so every line is
// paid for as many times as the run looks something up; each earns its place
// by changing a call the model would otherwise get wrong. The line-by-line
// account of why each sentence exists is research/11-linkup-skills/
// eido-tool-brief.md, and the uncompressed source is that folder's upstream/.
//
// It lives here, beside the descriptions, rather than in words.ts: words.ts
// is the user-visible copy boundary, and this text is addressed to a model.
// It reaches the transport as data on the tool set, never as an import, so
// the transport stays ignorant of the vendor the advice is about (#959).
export const WEB_TOOL_BRIEF = [
  'These tools are here because the person asking turned them on. That is a',
  'deliberate act, and it means they want an answer grounded in what the web',
  'says now, not in what you remember. Look it up. Answering from memory when',
  'you were handed a way to check is the one failure this cannot tolerate,',
  'even when you are confident, and especially when the subject is recent.',
  '',
  'Web lookups here run through Linkup. A Linkup query is an instruction to a',
  'retrieval system, not a question to a person: say what to find, where, and',
  'which fields to return, then do the reasoning yourself.',
  '',
  'Choose the search depth from the job, not from how important it feels.',
  'Default to `fast`. Move up only for a reason:',
  '',
  '- `fast` for one fact that lives in a snippet. Sub-second, no interpretation.',
  '  Write it keyword-shaped. It ignores instructions, so never give it steps.',
  '- `standard` for several independent lookups that can all be planned now.',
  '  Name the separate facets so they run as separate searches.',
  '- `deep` when a later step needs an earlier step\'s result: find a page, then',
  '  read it; follow a link you have not seen yet; verify a claim across sources',
  '  you must discover first. Write it as ordered steps.',
  '',
  '`standard` cannot discover a URL and then scrape it in the same call. That is',
  'the most common way to get a thin answer. Use `deep`, or search and then fetch.',
  '',
  'When you already have the URL, fetch it rather than searching for it.',
  '',
  'Avoid: keyword soup with no named fields; rewording one search several ways',
  'instead of naming distinct facets; inventing a domain or a URL; asking for a',
  'whole page when you need three fields.',
  '',
  'Every claim you make from a lookup should be traceable to a source you were',
  'given. If nothing relevant came back, say so rather than filling the gap.',
].join('\n')

// One tool result may not swallow the prompt (#961). Linkup will hand back up
// to 20 MB of page markdown; the compiler has already filled up to 80% of the
// model window before the first result exists, and every loop iteration
// re-sends everything, so the first uncapped result would make the provider
// reject the re-request after the user had already paid for the search, the
// fetch, and every prior iteration. This is not a ceiling on spend and it did
// not fall with the ceilings: removing it would not free the run, it would
// fail the run. The cap is head-weighted: openings carry the thesis and
// navigation of a page, so most of the allowance goes to the head, a slice
// keeps the end, and the cut marker tells the model the middle was removed
// rather than letting it mistake a truncation for the whole page.
const TOOL_RESULT_CAP_CHARS = 16_000
const CAP_HEAD_CHARS = 12_000
const CAP_TAIL_CHARS = TOOL_RESULT_CAP_CHARS - CAP_HEAD_CHARS

// Prompt tokens the context compile leaves free for the loop's results. A
// dozen capped results, at the same QuadChars four-characters-per-token rule
// the budget itself uses: 12 x 16,000 chars / 4 = 48,000 tokens. A dozen
// because the reserve must not try to scale with how long the loop may run.
// The loop has no ceiling now, so no compile-time number can pre-pay a whole
// run; what a reserve can honestly buy is room for the opening stretch of
// lookups to land without the first re-request already overflowing, and past
// a dozen results the conversation the loop itself accumulates dominates the
// window whatever was reserved. The per-result cap is what keeps each later
// re-request survivable, and the compile's half-window floor (runEngine.ts)
// keeps a small model compiling a real instruction underneath this.
const RESERVE_CAP_TOKENS = 48_000

function capForPrompt(text: string): string {
  if (text.length <= TOOL_RESULT_CAP_CHARS) return text
  const cut = text.length - CAP_HEAD_CHARS - CAP_TAIL_CHARS
  return [
    text.slice(0, CAP_HEAD_CHARS),
    `[Eido cut ${cut} characters from the middle of this result so it fits the conversation. The beginning and the end are intact.]`,
    text.slice(text.length - CAP_TAIL_CHARS),
  ].join('\n\n')
}

// A source list is capped by dropping whole trailing sources, never by
// slicing the joined text: a middle slice can cut a source's address out
// from under its title, and a model that still sees the title may cite a
// page it can no longer name. The head-weighted slice above is for one
// document, where the middle is prose; here the middle is other sources'
// provenance. Each kept entry passes through the single-result cap first,
// so one pathological snippet cannot swallow the whole allowance either.
function capSourcesForPrompt(entries: readonly string[]): string {
  const kept: string[] = []
  let length = 0
  for (const entry of entries) {
    const capped = capForPrompt(entry)
    const added = capped.length + (kept.length ? 2 : 0)
    if (kept.length && length + added > TOOL_RESULT_CAP_CHARS) break
    kept.push(capped)
    length += added
  }
  if (kept.length < entries.length) {
    kept.push(
      `[Eido kept the first ${kept.length} of ${entries.length} sources so this fits the conversation.]`,
    )
  }
  return kept.join('\n\n')
}

// A failed call still answers the model and still lands on the Card. The step
// keeps what was being looked for in `detail` and carries the plain words for
// what went wrong in `title`, written at failure time, so an older build can
// draw a truthful line without knowing this build's failure taxonomy
// (ADR 0035). Every outcome here is marked `failed` for the loop's
// termination guard: with no call budget spending a broken run down, the
// count of consecutive failures is the only thing standing between a dead
// host and a loop that never ends. Cancel is the one failure that is not an
// outcome: a user who cancelled needs the loop stopped, not a message to the
// model.
function failureOutcome(err: unknown, detail: string): EidoToolOutcome {
  if (err instanceof WebToolError && err.code === 'canceled') throw err
  const code = err instanceof WebToolError ? err.code : 'failed'
  const step = { kind: 'trouble', detail, title: webToolFailureLabel(code) }
  if (code === 'rate-limited') {
    const reset = err instanceof WebToolError ? err.rateLimit?.resetSeconds : undefined
    return {
      resultText:
        'The web rate limit was hit. Eido will wait before your next lookup runs; do not repeat this call immediately.',
      step,
      failed: true,
      // The undocumented reset header when it arrived, a short pause when it
      // did not, and never a wait so long it reads as a hang.
      waitSeconds: Math.min(Math.max(reset ?? 5, 1), 30),
    }
  }
  if (code === 'no-results') {
    return {
      resultText: 'The web had no results for this. Try different words, or answer without it.',
      step,
      failed: true,
    }
  }
  return {
    resultText: `The lookup failed (${code}). Do not retry this exact call.`,
    step,
    failed: true,
  }
}

// The model may hand back anything at all where a string list was declared.
// Only the strings are kept, because a filter half-made of garbage is worse
// than no filter: the vendor would take it literally.
function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : []
}

function isoDate(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function searchTool(apiKey: string): EidoExecutedTool {
  return {
    declaration: {
      type: 'function',
      function: {
        name: 'search_web',
        // The description is the selection rule. It teaches the three
        // questions that land on a depth, and states the one hard rule the
        // vendor names first, because that failure mode is quiet: a
        // `standard` call asked to find-then-scrape returns something, and
        // the something is thin.
        description:
          'Search the live web. Returns ranked sources, each with a title, an address, and an excerpt. ' +
          'Choose depth by answering three questions in order. One: what do you already have? A URL ' +
          'means fetch_page, not a search. Two: where does the answer live? One fact that fits a ' +
          'snippet is fast; several independent facts across snippets is standard; content on full ' +
          'pages you have not found yet means deep, or a search followed by fetch_page. Three: does a ' +
          'later step depend on an earlier result? All-parallel work is standard; find-then-read ' +
          'inside one call is deep. Hard rule: standard cannot discover a URL and then scrape it in ' +
          'the same call. That needs deep, or a search and then fetch_page.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'An instruction to a retrieval system, not a question: name the target entity, what ' +
                'to find, which sources matter, and the exact fields to return. Keyword-shaped at ' +
                'fast; separate named facets at standard; ordered steps at deep.',
            },
            depth: {
              type: 'string',
              enum: ['fast', 'standard', 'deep'],
              description:
                'How hard to look. fast answers in under a second from snippets and ignores ' +
                'instructions, so never give it steps. standard fans out over lookups you can all ' +
                'plan now. deep reuses earlier results inside the call. Default to fast; move up ' +
                'only for a reason.',
            },
            includeDomains: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Search only these domains. Only when the source family is implied by the task; ' +
                'never invent a domain.',
            },
            excludeDomains: {
              type: 'array',
              items: { type: 'string' },
              description: 'Leave these domains out of the results.',
            },
            fromDate: {
              type: 'string',
              description:
                'Earliest publish date to accept, as YYYY-MM-DD. Only when the timeframe is ' +
                'implied by the task.',
            },
            toDate: {
              type: 'string',
              description: 'Latest publish date to accept, as YYYY-MM-DD.',
            },
          },
          // depth is required, not defaulted, matching the vendor's own
          // published tool definition. A JSON-schema default is advisory: a
          // model that merely omitted depth would silently get fast, and fast
          // treats an instruction-shaped query as keywords, the vendor's
          // first-named anti-pattern, failing quietly with a thin answer.
          // Required makes the model choose consciously; "default to fast"
          // lives in the description and the brief as the rule it applies.
          required: ['query', 'depth'],
        },
      },
    },
    // Exact, not generous. The generous substring matching on the
    // provider-executed set exists because OpenRouter may prefix or qualify a
    // name it reports back; these names Eido chose itself and the model
    // echoes them verbatim, so generosity buys nothing and costs a real bug:
    // "research" contains "search", and a substring matcher would land a
    // research call on this executor silently, wrong tool, wrong price,
    // wrong trail line, with arguments that happen to fit.
    matches: (name) => name === 'search_web',
    execute: async (args, signal) => {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) return { resultText: 'search_web needs a non-empty "query" string.', failed: true }
      // Anything but the two named upgrades reads as the default. A model
      // that invents a depth gets fast, never a silent upgrade.
      const depth: WebSearchDepth =
        args.depth === 'standard' || args.depth === 'deep' ? args.depth : 'fast'
      try {
        // The output shape is never declared and never read from the model:
        // the boundary below pins it to sources, because the model in this
        // loop is the one doing the reasoning.
        const result = await searchWeb(query, {
          apiKey,
          depth,
          includeDomains: stringList(args.includeDomains),
          excludeDomains: stringList(args.excludeDomains),
          fromDate: isoDate(args.fromDate),
          toDate: isoDate(args.toDate),
          signal,
        })
        const entries = result.sources.map((source, position) =>
          `${position + 1}. ${source.title}\n${source.url}\n${source.snippet}`.trim(),
        )
        return {
          resultText: capSourcesForPrompt(entries),
          step: { kind: 'search', detail: query },
        }
      } catch (err) {
        return failureOutcome(err, query)
      }
    },
  }
}

function fetchTool(apiKey: string): EidoExecutedTool {
  return {
    declaration: {
      type: 'function',
      function: {
        name: 'fetch_page',
        description:
          'Open one web page and read it as markdown. When you already have the address, this beats ' +
          'searching for it: faster, cheaper, more reliable. Handles articles and PDFs. Very long ' +
          'pages arrive with their middle cut. Cannot see pages behind a login.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The full http or https address of the page to read.' },
            renderJs: {
              type: 'boolean',
              description:
                'Run the page\'s scripts before reading it; many sites read as empty without this. ' +
                'Defaults to true. Turn it off only when speed matters more on a known-static page.',
            },
            mode: {
              type: 'string',
              enum: ['standard', 'pro'],
              description:
                'Use pro when a page resists retrieval, such as a fetch that came back empty or ' +
                'thin. Defaults to standard.',
            },
          },
          required: ['url'],
        },
      },
    },
    matches: (name) => name === 'fetch_page',
    execute: async (args, signal) => {
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      if (!url) return { resultText: 'fetch_page needs a non-empty "url" string.', failed: true }
      // Rendering defaults on, deliberately against the vendor API's own
      // default of off, on the vendor's explicit advice: most modern pages
      // are client-rendered, and the latency is worth the reliability.
      const renderJs = args.renderJs !== false
      const mode: FetchPageMode = args.mode === 'pro' ? 'pro' : 'standard'
      try {
        const page = await fetchPage(url, { apiKey, renderJs, mode, signal })
        return {
          resultText: capForPrompt(page.markdown),
          // The normalized address, because that is the page that was
          // actually opened and the link the reader can check.
          step: { kind: 'read', detail: page.url },
        }
      } catch (err) {
        return failureOutcome(err, url)
      }
    },
  }
}

// ---- the research executor ---------------------------------------------------

// The life of a research job, told to whoever must remember it. A submitted
// job cannot be cancelled and bills whatever Eido does next, so the one
// thing that must survive a quit is its id: `onSubmitted` fires the moment
// the vendor acknowledges the job, before the first poll, and `onSettled`
// fires only when the job reached an end this run consumed, the report
// delivered or the vendor declaring it failed, which is not charged. A
// cancel, a dead network, or a quit between the two deliberately leaves the
// record standing, because then the job is still running on the vendor's
// servers and the id is the only handle to what was already paid for. The
// hooks are plain callbacks rather than a store import, so this module stays
// the executor injection point and never learns where the memory lives.
export type ResearchJobHooks = Readonly<{
  onSubmitted: (jobId: string) => void
  onSettled: (jobId: string) => void
}>

const RESEARCH_TOOL_NAME = 'research'

function researchTool(
  apiKey: string,
  reasoningDepth: ResearchReasoningDepth,
  jobHooks?: ResearchJobHooks,
): EidoExecutedTool {
  return {
    declaration: {
      type: 'function',
      function: {
        name: RESEARCH_TOOL_NAME,
        // The mode is required, never defaulted: the vendor is explicit that
        // leaving it unset makes output shape unpredictable, and a job the
        // user consented to should not then be vague about what it is doing.
        // `reasoningDepth` is deliberately not declared at all (#971): depth
        // is the price, the price is the user's, and a parameter that does
        // not exist is one the model cannot be talked into spending through.
        description:
          'Hand one whole investigation to an autonomous research agent that searches, ' +
          'cross-checks claims across sources, and returns a cited answer, taking minutes rather ' +
          'than seconds. The person who started this run has already chosen how long it may ' +
          'work. Use it only when a single deep search cannot cover the job: many entities, ' +
          'many facets, claims to verify, or a report-shaped deliverable. For anything smaller, ' +
          'search_web and fetch_page are faster and cheaper.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'A well-scoped instruction: the angles to cover, leads to pursue, facts to verify, ' +
                'entities to compare, constraints and exclusions, and the output structure you want.',
            },
            mode: {
              type: 'string',
              enum: ['answer', 'investigate', 'research'],
              description:
                'answer for a precise question with one correct, self-verified answer. investigate ' +
                'for a deep analysis of one defined entity. research for broad exploration across ' +
                'many entities. Choose it from the job.',
            },
          },
          required: ['query', 'mode'],
        },
      },
    },
    matches: (name) => name === RESEARCH_TOOL_NAME,
    execute: async (args, signal, announce) => {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) return { resultText: 'research needs a non-empty "query" string.', failed: true }
      // The mode is refused rather than guessed, the opposite of search's
      // read-as-fast. There a wrong guess costs a fraction of a cent and a
      // thin answer; here it would submit minutes and dollars that no one can
      // take back, so a mangled choice costs a correction and no submission.
      const mode =
        args.mode === 'answer' || args.mode === 'investigate' || args.mode === 'research'
          ? args.mode
          : null
      if (!mode) {
        return {
          resultText: 'research needs "mode": one of answer, investigate, research.',
          failed: true,
        }
      }
      try {
        // The depth on the wire is the one the user pressed, whatever rode in
        // on the arguments: an undeclared parameter can still arrive from a
        // model, and here arriving must change nothing.
        const report = await runResearch(query, {
          apiKey,
          mode,
          reasoningDepth,
          signal,
          // The trail row goes up the moment the vendor takes the job, not
          // when it comes back. A research job runs for minutes and every
          // other tool here returns in seconds, so a Card with nothing on it
          // reads as stuck rather than working (founder report 2026-08-18).
          // Announced once here, which is why nothing is returned as a step
          // below: two would be two lookups in a count of one.
          onSubmitted: (jobId) => {
            announce?.({ kind: 'research', detail: query })
            jobHooks?.onSubmitted?.(jobId)
          },
          onSettled: jobHooks?.onSettled,
        })
        return { resultText: researchReportText(report) }
      } catch (err) {
        return failureOutcome(err, query)
      }
    },
  }
}

// The report's own sources ride under the answer so every claim the model or
// the reader repeats stays traceable to a page that can be opened. Each half
// is capped on its own: the answer head-weighted like a page, the sources by
// whole entries like a search.
function researchReportText(report: ResearchReport): string {
  const entries = report.sources.map((source, position) =>
    `${position + 1}. ${source.title}\n${source.url}\n${source.snippet}`.trim(),
  )
  return entries.length
    ? [capForPrompt(report.answer), 'Sources:', capSourcesForPrompt(entries)].join('\n\n')
    : capForPrompt(report.answer)
}

// What re-attaching to a standing job can end as, in terms a run engine can
// consume without knowing the Linkup boundary exists: the landed report, a
// cancel that keeps the job standing, or a failure carried as a words key.
export type ResumedResearch =
  | Readonly<{ status: 'done'; answerText: string }>
  | Readonly<{ status: 'canceled' }>
  | Readonly<{ status: 'failed'; messageKey: keyof typeof words }>

// Re-attach to a paid research job by its stashed id (#971): poll it out,
// never submit. `onSettled` fires exactly as it does on a fresh run, when the
// vendor reported a terminal state this call consumed, so the caller clears
// the stash on the same rule either way; a cancel or a dead network leaves
// the job standing for the next resume.
export async function resumeResearchJob(
  settings: Readonly<{ linkupKey?: string }>,
  jobId: string,
  options: Readonly<{ signal?: AbortSignal; onSettled?: (jobId: string) => void }> = {},
): Promise<ResumedResearch> {
  const apiKey = linkupKeyOf(settings)
  if (!apiKey) return { status: 'failed', messageKey: webToolFailureWordKey('no-key') }
  try {
    const report = await resumeResearch(jobId, {
      apiKey,
      signal: options.signal,
      onSettled: options.onSettled,
    })
    return { status: 'done', answerText: researchReportText(report) }
  } catch (err) {
    if (err instanceof WebToolError && err.code === 'canceled') return { status: 'canceled' }
    const code = err instanceof WebToolError ? err.code : 'failed'
    return { status: 'failed', messageKey: webToolFailureWordKey(code) }
  }
}

// The whole Eido-executed set for one run, or nothing. Nothing when no Linkup
// key exists is the epic's selection rule: the fallback is the proven
// provider-executed path, not a dormant branch, and the completion boundary
// then behaves exactly as it did before this module existed.
//
// The mode gates what is declared, never how a declared tool behaves. Web is
// the synchronous pair. Research adds the minutes-long endpoint, and only
// because the user armed it on the Card: a tool that is not declared is a
// tool the model cannot be talked into.
//
// The research config carries what the user, not the model, decided: the
// depth the person paying pressed (#971), and the hooks that remember the
// job. A caller that declares research without naming a depth gets S, the
// cheapest, because the only depth safe to assume is the one that costs the
// least.
export type ResearchRunConfig = Readonly<{
  depth?: ResearchReasoningDepth
  hooks?: ResearchJobHooks
}>

export function eidoWebToolSetFor(
  settings: Readonly<{ linkupKey?: string }>,
  mode: ReachMode = DEFAULT_REACH_MODE,
  research?: ResearchRunConfig,
): EidoToolSet | undefined {
  const apiKey = linkupKeyOf(settings)
  if (!apiKey) return undefined
  const researching = mode === 'research'
  return {
    tools: [
      searchTool(apiKey),
      fetchTool(apiKey),
      ...(researching
        ? [researchTool(apiKey, research?.depth ?? DEFAULT_RESEARCH_DEPTH, research?.hooks)]
        : []),
    ],
    promptReserveTokens: RESERVE_CAP_TOKENS,
    brief: WEB_TOOL_BRIEF,
    // Research mode is not a hint. The person chose the mode, chose a depth
    // and pressed Run twice; the run exists to hand that investigation over.
    // Left to persuasion a small model answers from memory in seconds and the
    // trail comes back empty, which reads as a broken feature rather than a
    // model declining. So the first turn is required to call it; every turn
    // after is the model's own. Web mode stays a free choice, because there
    // nothing was promised and nothing costs dollars.
    ...(researching ? { requireFirstCall: RESEARCH_TOOL_NAME } : {}),
  }
}
