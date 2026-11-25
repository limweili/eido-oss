// Auto-compaction for the loop Eido runs itself (#1036).
//
// An Agentic Run's conversation only grows. Every turn re-sends the whole
// history: each assistant turn with its tool calls, each tool result, all of
// it, every time. A Research run that works for minutes across dozens of
// lookups will eventually ask for more than the model's window holds, and the
// provider refuses the request outright, losing the answer and everything the
// person already paid for.
//
// So before the loop sends a request that would pass a share of the window, it
// stops, asks the model to write down what the run has established, and
// continues from that instead of the full history.
//
// This module owns the shape of that operation and nothing about the wire. It
// decides where a conversation may be cut, what must survive verbatim, what
// the summariser is asked for, and how the result is put back together. The
// transport owns when to call it and what to do when it cannot help.
//
// The one rule that fails loudly if broken: an assistant turn that called
// tools and the tool messages answering it are ONE thing. A tool message whose
// call is gone, or a call whose result is gone, is a malformed request the
// provider rejects. Cuts land between blocks, never inside one.

import type { ReasoningEffort } from '../graph/types'
import { estimateTokens } from '../shared/tokenEstimate'
import type { RunToolStep } from './agenticRun'
import type { ChatMessage } from './openRouter'

// The share of the model's window at which the loop compacts before its next
// request. 80% rather than the 95% several harnesses shipped with: at 95% the
// summariser itself has almost no room to answer in, and the research on those
// harnesses is consistent that late thresholds produce thin summaries. The
// margin also absorbs the estimator's error on everything appended since the
// provider last reported real usage.
export const COMPACTION_THRESHOLD_SHARE = 0.8

// How much of the freshest history stays whole rather than being summarised.
// The model is usually mid-thought when compaction fires, and the last lookup
// is the part it is about to build on; a summary of it would be a summary of
// the one thing that did not need summarising. A block larger than this budget
// is summarised like any other, because keeping it would defeat the
// compaction that the run needs to survive.
export const COMPACTION_TAIL_KEEP_TOKENS = 12_000

// Below this much summarisable material, compaction is not worth a whole extra
// model call: it would cost a request to reclaim almost nothing and would fire
// again on the next turn. A run this small that is already over the threshold
// is over it because of its instruction, which compaction must not touch.
export const COMPACTION_MIN_MATERIAL_TOKENS = 8_000

// Both numbers above are ceilings, not fixed amounts, and they are scaled to
// the threshold they are spent against.
//
// A fixed 12,000-token tail against a 16k-window model is not a tail, it is the
// whole conversation: everything but the first block would be kept whole, and
// what was left would almost never reach a fixed 8,000-token floor, so nothing
// would ever be summarised and the run would walk into the refusal compaction
// exists to prevent. Small windows are not hypothetical - the catalog carries
// 16k models, and `MIN_PLAUSIBLE_WINDOW_TOKENS` is 8,192.
//
// Half the threshold for the tail and a quarter for the floor: enough room that
// a cut always leaves something to cut, at every window size.
//
// These live here rather than beside each caller because there are two callers,
// and the last time this tuning existed in two copies one copy got the scaling
// fix and the other kept walking into refusals.
export function compactionTailBudget(thresholdTokens: number): number {
  return Math.min(COMPACTION_TAIL_KEEP_TOKENS, Math.floor(thresholdTokens / 2))
}

export function compactionMaterialFloor(thresholdTokens: number): number {
  return Math.min(COMPACTION_MIN_MATERIAL_TOKENS, Math.floor(thresholdTokens / 4))
}

// How much of the summary the trail keeps, for the same reason the thinking
// step is capped: the trail is saved with the Board, and a record with no
// natural size grows every saved Board forever.
export const COMPACTION_STEP_KEEP_CHARS = 2_000

// The summariser runs at low effort. It is a transcription job with a fixed
// shape, not a reasoning one, and the run is already at the edge of its window.
export const COMPACTION_REASONING_EFFORT: ReasoningEffort = 'low'

// How many summariser failures in a row end the attempt. Each try is a
// full-price call at roughly the size of the window being summarised, so a
// summariser that is simply unavailable must not be asked once per remaining
// turn. Two: the first failure may be transient, the second is a pattern. The
// run keeps its tools either way and lets the provider be the one that says no.
export const COMPACTION_FAILURE_LIMIT = 2

// ---- reading a conversation ------------------------------------------------

// The readable text of one message, whatever shape its content arrived in.
// Assets carried as content parts contribute their filename only: their bytes
// are not text and estimating them as text would be a fiction.
export function messageText(message: ChatMessage): string {
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      const entry = part as { type?: unknown; text?: unknown; file?: { filename?: unknown } }
      if (entry.type === 'text' && typeof entry.text === 'string') return entry.text
      if (entry.type === 'file' && typeof entry.file?.filename === 'string') return entry.file.filename
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

// What one message costs, near enough. The tool-call arguments count too: they
// are sent, so they are paid for, and a turn of parallel calls with long
// queries is not free just because it carried no prose.
export function estimateMessageTokens(message: ChatMessage): number {
  let text = messageText(message)
  if (message.role === 'assistant') {
    for (const call of message.tool_calls ?? []) {
      text += `\n${call.function.name}\n${call.function.arguments}`
    }
    for (const entry of message.reasoning_details ?? []) {
      if (typeof entry === 'object' && entry !== null) {
        for (const value of Object.values(entry as Record<string, unknown>)) {
          if (typeof value === 'string') text += `\n${value}`
        }
      }
    }
  }
  // Per-message envelope: role, ids, and the JSON around them all cost tokens.
  return estimateTokens(text) + 4
}

export function estimateConversationTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
}

// One indivisible unit of the loop's history: an assistant turn plus every
// tool message answering it, or a lone message the loop appended on its own.
export type ConversationBlock = Readonly<{ messages: readonly ChatMessage[]; tokens: number }>

// The part of the conversation compaction may never touch, and the part it
// may. The prefix is the system framing, the travelling brief, and the
// person's own compiled instruction: everything up to and including the first
// user turn. That instruction is the task; a summary of the task is a
// different task, so it survives verbatim however long the run gets.
export function splitConversation(
  messages: readonly ChatMessage[],
): { prefix: readonly ChatMessage[]; blocks: readonly ConversationBlock[] } {
  const firstUser = messages.findIndex((message) => message.role === 'user')
  if (firstUser === -1) return { prefix: messages, blocks: [] }
  const prefix = messages.slice(0, firstUser + 1)
  const blocks: ConversationBlock[] = []
  let current: ChatMessage[] = []
  for (const message of messages.slice(firstUser + 1)) {
    // Only a tool message continues a block, and only when a block is open.
    // Anything else opens a new one, which is exactly why a cut between
    // blocks can never separate a call from its result.
    if (message.role === 'tool' && current.length > 0) {
      current.push(message)
      continue
    }
    if (current.length > 0) blocks.push(sealBlock(current))
    current = [message]
  }
  if (current.length > 0) blocks.push(sealBlock(current))
  return { prefix, blocks }
}

function sealBlock(messages: readonly ChatMessage[]): ConversationBlock {
  return { messages: [...messages], tokens: estimateConversationTokens(messages) }
}

// ---- planning a cut --------------------------------------------------------

export type CompactionPlan = Readonly<{
  prefix: readonly ChatMessage[]
  summarize: readonly ConversationBlock[]
  tail: readonly ConversationBlock[]
  materialTokens: number
}>

// Where this conversation may be cut, or nothing when cutting it would not be
// worth the call. Nothing is a real answer, not a failure: the caller then
// knows compaction cannot help and can degrade truthfully instead of trying
// again on the next turn, and the next, forever.
export function planCompaction(
  messages: readonly ChatMessage[],
  thresholdTokens: number,
): CompactionPlan | null {
  const { prefix, blocks } = splitConversation(messages)
  if (blocks.length === 0) return null
  const tailBudget = compactionTailBudget(thresholdTokens)

  // Walk back from the freshest block while the tail budget holds, never
  // reaching the first block: something must always be summarised, or
  // compaction would return the conversation it was given and the loop would
  // ask again immediately.
  const tail: ConversationBlock[] = []
  let tailTokens = 0
  for (let index = blocks.length - 1; index > 0; index -= 1) {
    const block = blocks[index]
    if (tailTokens + block.tokens > tailBudget) break
    tail.unshift(block)
    tailTokens += block.tokens
  }

  const summarize = blocks.slice(0, blocks.length - tail.length)
  const materialTokens = summarize.reduce((total, block) => total + block.tokens, 0)
  if (materialTokens < compactionMaterialFloor(thresholdTokens)) return null
  return { prefix, summarize, tail, materialTokens }
}

// ---- asking for the summary ------------------------------------------------

export const COMPACTION_SYSTEM_PROMPT =
  'You are writing a handoff note. Another run is about to continue this work with your note ' +
  'as the only record of everything that came before it. The full history is being discarded. ' +
  'Write for that reader.\n\n' +
  'Be complete over being brief. Copy every number, name, date, quotation and web address exactly ' +
  'as it appeared; a detail you paraphrase is a detail the next run has to pay to look up again. ' +
  'Never invent a finding, a source, or a conclusion that is not in the material. ' +
  'Reply with the note only. No preamble, no sign-off.'

// The five things a stopped run needs in order to be picked up again. Ordered
// as a checklist rather than left open, because the harnesses that shipped an
// open "summarise this" prompt all ended up adding a fixed structure: an
// unstructured summary is reliably missing whichever part the next turn needed.
export function buildCompactionInstruction(material: string): string {
  return (
    'Here is the record of a run in progress. Write the handoff note under these exact headings.\n\n' +
    'What this run was asked for\n' +
    '  One or two sentences. The task as it stands, not as it was first phrased.\n\n' +
    'What has been established\n' +
    '  Every finding so far, each with the web address it came from. This is the bulk of the note.\n\n' +
    'What did not work\n' +
    '  Searches that returned nothing, pages that could not be read, lines of enquiry ruled out. ' +
    'Say so plainly, so the next run does not spend money repeating them.\n\n' +
    'What is still open\n' +
    '  The questions the run has not answered yet.\n\n' +
    'What to do next\n' +
    '  The immediate next step the run was about to take.\n\n' +
    '--- record begins ---\n\n' +
    material +
    '\n\n--- record ends ---'
  )
}

// How the note is introduced to the continuing run. It says plainly that
// history was dropped and that the note stands in for it, because a model
// handed a summary with no explanation treats it as something the user wrote.
export const COMPACTION_HANDOFF_PREAMBLE =
  'This run has been going long enough that its earlier history no longer fits. That history has ' +
  'been replaced by the handoff note below, which is now the only record of it. Treat the note as ' +
  'established fact, keep working on the original task above, and do not start over or ask any ' +
  'questions. Carry on from where the note leaves off.'

// The blocks being discarded, rendered as something a model can read. Tool
// results appear as they were given to the model, because what a lookup
// actually returned is the evidence behind every finding in the note.
//
// A previous note is folded in ahead of them rather than kept beside them: the
// next note supersedes it, so a run that compacts five times carries one note,
// not five stacked ones.
//
// The note as it sits in the conversation is skipped, because a second
// compaction would otherwise carry it twice: once as `previousSummary` and
// again as the first block of the history, wrapped in the preamble. Twice the
// cost at the exact moment the window is scarce, and worse, the preamble's
// imperatives ("do not start over, ask no questions") would arrive inside the
// record the summariser has been told to transcribe, where they read as
// instructions rather than as material.
export function renderCompactionMaterial(
  blocks: readonly ConversationBlock[],
  previousSummary?: string,
): string {
  const parts: string[] = []
  if (previousSummary?.trim()) {
    parts.push(`Handoff note from earlier in this same run:\n\n${previousSummary.trim()}`)
  }
  for (const block of blocks) {
    for (const message of block.messages) {
      const text = messageText(message).trim()
      if (text.startsWith(COMPACTION_HANDOFF_PREAMBLE)) continue
      if (message.role === 'assistant') {
        if (text) parts.push(`The run said:\n${text}`)
        for (const call of message.tool_calls ?? []) {
          parts.push(`The run used ${call.function.name} with: ${call.function.arguments}`)
        }
        continue
      }
      if (message.role === 'tool') {
        parts.push(`That returned:\n${text || '(nothing)'}`)
        continue
      }
      if (text) parts.push(text)
    }
  }
  return parts.join('\n\n')
}

// ---- putting the conversation back together --------------------------------

export function rebuildConversation(
  plan: CompactionPlan,
  summary: string,
): ChatMessage[] {
  return [
    ...plan.prefix,
    { role: 'user', content: `${COMPACTION_HANDOFF_PREAMBLE}\n\n${summary.trim()}` },
    ...plan.tail.flatMap((block) => [...block.messages]),
  ]
}

// What the person sees on the Result Card. The model's own note, capped, so
// the row can be opened and read. It has the same standing as a thinking row, and
// for the same reason: this is the run talking, never text a page handed back.
export function compactionStep(summary: string): RunToolStep {
  const whole = summary.trim()
  if (whole.length <= COMPACTION_STEP_KEEP_CHARS) return { kind: 'compaction', detail: whole }
  const head = whole.slice(0, COMPACTION_STEP_KEEP_CHARS)
  const lastBreak = head.lastIndexOf(' ')
  const kept = lastBreak > COMPACTION_STEP_KEEP_CHARS - 200 ? head.slice(0, lastBreak) : head
  return { kind: 'compaction', detail: `${kept.trimEnd()} …` }
}

// What the model is told when compaction cannot bring the run back under the
// window. A truthful degradation rather than a silent truncation: the run
// still ends in an answer, and the answer can say what went unchecked.
export const CONTEXT_EXHAUSTED_NOTE =
  'This run has filled the space available to it and cannot look anything else up. Make no more ' +
  'tool calls. Answer with what you already have, and say plainly if something important could ' +
  'not be checked.'
