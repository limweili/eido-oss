// Auto-compaction for a Result Card's own context (#1036).
//
// A Result Card carries one context and it only grows. Every follow-up re-sends
// the whole of it: the frozen run context the card was made from, the version
// text it is discussing, and every turn of the discussion so far. Ask enough
// follow-ups and that outgrows the model's window, and the provider refuses the
// request outright, losing the answer the reader was waiting for.
//
// So the measurement here is deliberately of the card and nothing else: what is
// about to be sent, against the window of the model that will be sent it. It
// does not know or care what put the text there. Web mode, a research run's
// lookups, tool trails, and whatever gets plugged into a Result Card later all
// arrive as the same thing at this seam, which is the point: if it enters the
// card's context, it is counted, and no future feature has to remember to
// register itself here (founder decision, #1036).
//
// What may be cut is only the discussion. The frozen run context and the
// version text are the card's identity, not its history: a summary of them
// would be a different card. So the older turns of the discussion become a note
// the model writes about them, and everything else is sent verbatim.
//
// The note replaces those turns in the OUTGOING REQUEST ONLY. What the reader
// sees on the card is untouched, and so is everything the thread feeds
// downstream. Nobody loses a conversation because it got long.
//
// This module owns the shape of that operation and nothing about the wire or
// the store: where the discussion may be cut, what the summariser is asked for,
// and how the result is put back together. The runner owns when to call it and
// what to do when it cannot help.

import type { AiProvider } from './aiProviderTypes'
import type { FollowUpMessage } from '../graph/types'
import { newId } from '../shared/ids'
import { estimateTokens } from '../shared/tokenEstimate'
import {
  COMPACTION_THRESHOLD_SHARE,
  compactionMaterialFloor,
  compactionTailBudget,
} from './conversationCompaction'
import { settledFollowUpMessages } from './followUpThread'
import { contextWindowFor } from './modelWindows'
import { calibratedTokens } from './tokenCalibration'

// What a cut may keep whole and what makes a cut worth buying are the same
// tuning the run loop uses, scaled to the same share of the threshold. They are
// imported rather than restated: a card and a run are two seams applying one
// decision, and the copy that drifts is the one that walks into a refusal.

// What the framing around the instruction costs: Eido's own system message, the
// board's guidance, and the JSON envelope each message is wrapped in. Small,
// fixed, and counted rather than ignored, because the threshold it feeds is a
// ceiling and every uncounted token eats the margin.
export const CARD_FRAMING_TOKENS = 120

// ---- measuring the card ----------------------------------------------------

// What this card is about to cost the window, as well as it can be known before
// sending it. The estimate is corrected by what this model was last seen to
// actually charge (see tokenCalibration), so a model whose tokenizer runs
// heavier than QuadChars compacts at the right moment rather than late.
export function cardContextTokens(
  instruction: string,
  systemPrompt: string,
  model: string,
): number {
  const estimated =
    estimateTokens(instruction) + estimateTokens(systemPrompt) + CARD_FRAMING_TOKENS
  return calibratedTokens(model, estimated)
}

// The point at which this card compacts rather than sending. The same share of
// the same window that the run loop and the compile-time budget use, so a card,
// its run, and its follow-ups can never disagree about how full it is.
export function cardCompactionThreshold(
  model: string,
  provider: AiProvider = 'openrouter',
): number {
  return Math.floor(contextWindowFor(model, provider) * COMPACTION_THRESHOLD_SHARE)
}

// ---- reading a discussion --------------------------------------------------

// One indivisible turn of the discussion: what the reader asked, and everything
// answering it. Cuts land between turns, never inside one, so a note can never
// strand a question without its answer.
//
// Two sizes, because a turn has two of them and conflating them is a real bug.
// `tokens` is what the turn costs the REQUEST, which is what the tail budget is
// spending. `materialTokens` is what it would give the SUMMARISER, which is
// what the floor is judging. They are not the same number: the instruction
// carries message text and nothing else (`flattenFollowUpThread`), while the
// summariser is also shown what each reply looked up and is never shown a
// previous handoff note twice. A plan that measured the floor with the request's
// number could clear it on tokens the summariser will never be handed, and then
// pay for a completion to summarise nothing.
export type ThreadTurn = Readonly<{
  messages: readonly FollowUpMessage[]
  tokens: number
  materialTokens: number
}>

// What a message costs the outgoing instruction. Text only, because that is all
// `flattenFollowUpThread` puts there; a trail is shown on the card and never
// sent.
export function estimateFollowUpTokens(message: FollowUpMessage): number {
  return estimateTokens(message.text) + 4
}

// What a message would give the summariser. Its text plus what it looked up,
// and nothing at all for a handoff note, which reaches the summariser once as
// `previousNote` and is skipped where it sits (see renderThreadMaterial). This
// must stay in step with what that function actually emits.
export function estimateFollowUpMaterialTokens(message: FollowUpMessage): number {
  const text = message.text.trim()
  if (text.startsWith(CARD_HANDOFF_PREAMBLE)) return 0
  let material = text
  for (const step of message.toolSteps ?? []) {
    if (step.kind === 'compaction') continue
    material += `\n${step.kind} ${step.detail}`
  }
  return estimateTokens(material) + 4
}

export function splitThread(messages: readonly FollowUpMessage[]): ThreadTurn[] {
  const turns: ThreadTurn[] = []
  let current: FollowUpMessage[] = []
  for (const message of settledFollowUpMessages([...messages])) {
    // A user message opens a turn. Everything after it belongs to that turn
    // until the reader speaks again.
    if (message.role === 'user' && current.length > 0) {
      turns.push(sealTurn(current))
      current = []
    }
    current.push(message)
  }
  if (current.length > 0) turns.push(sealTurn(current))
  return turns
}

function sealTurn(messages: readonly FollowUpMessage[]): ThreadTurn {
  return {
    messages: [...messages],
    tokens: messages.reduce((total, message) => total + estimateFollowUpTokens(message), 0),
    materialTokens: messages.reduce(
      (total, message) => total + estimateFollowUpMaterialTokens(message),
      0,
    ),
  }
}

// ---- planning a cut --------------------------------------------------------

export type ThreadCompactionPlan = Readonly<{
  summarize: readonly ThreadTurn[]
  tail: readonly ThreadTurn[]
  materialTokens: number
}>

// Where this discussion may be cut, or nothing when cutting it would not be
// worth the call. Nothing is a real answer rather than a failure: the runner
// then knows compaction cannot help this card and sends what it has, instead of
// paying for a summarising call on every remaining follow-up.
export function planThreadCompaction(
  messages: readonly FollowUpMessage[],
  thresholdTokens: number,
): ThreadCompactionPlan | null {
  const turns = splitThread(messages)
  if (turns.length === 0) return null
  const tailBudget = compactionTailBudget(thresholdTokens)

  // Walk back from the freshest turn while the tail budget holds, never
  // reaching the first: something must always be summarised, or compaction
  // would hand back the discussion it was given and the next follow-up would
  // ask for it again. A single turn larger than the whole budget is summarised
  // like any other, because keeping it would defeat the compaction the card
  // needs to survive.
  const tail: ThreadTurn[] = []
  let tailTokens = 0
  for (let index = turns.length - 1; index > 0; index -= 1) {
    const turn = turns[index]
    if (tailTokens + turn.tokens > tailBudget) break
    tail.unshift(turn)
    tailTokens += turn.tokens
  }

  const summarize = turns.slice(0, turns.length - tail.length)
  // Judged on what the summariser will actually be handed. A card whose only
  // summarisable turn is the note it already wrote has nothing left to give,
  // and measuring that note as material is how a card ends up paying for a
  // completion per follow-up to rewrite its own summary forever.
  const materialTokens = summarize.reduce((total, turn) => total + turn.materialTokens, 0)
  if (materialTokens < compactionMaterialFloor(thresholdTokens)) return null
  return { summarize, tail, materialTokens }
}

// ---- asking for the note ---------------------------------------------------

export const CARD_COMPACTION_SYSTEM_PROMPT =
  'You are writing the summary of a discussion so that it can carry on. The next reply will have ' +
  'your summary as the only record of everything said before it, because the rest is being ' +
  'discarded. Write for whoever reads it next.\n\n' +
  'Be complete rather than brief. Copy every number, name, date, quotation and web address exactly ' +
  "as it appeared; a detail you paraphrase is a detail that has to be found again. Keep the " +
  "reader's own words for anything they asked for or decided. Never add a fact, a source, or a " +
  'conclusion that is not in the discussion. Reply with the summary only. No preamble, no sign-off.'

// The four things a discussion needs in order to be picked up again. Ordered as
// a checklist rather than left open: an unstructured summary is reliably
// missing whichever part the next answer needed.
export function buildThreadNoteInstruction(material: string): string {
  return (
    'Here is the earlier part of a discussion about one result. Write the summary under these ' +
    'exact headings.\n\n' +
    'What is being worked out\n' +
    '  One or two sentences. What the reader is trying to get to, as it stands now rather than as ' +
    'it was first phrased.\n\n' +
    'What has been answered\n' +
    '  Every point that was settled, each with the numbers, names, dates and web addresses exactly ' +
    'as they appeared. This is the bulk of the summary.\n\n' +
    'What has been ruled out\n' +
    '  Anything asked, checked, or suggested that did not work out, so that it is not offered ' +
    'again.\n\n' +
    'What is still open\n' +
    '  The questions this discussion has not answered yet.\n\n' +
    '--- discussion begins ---\n\n' +
    material +
    '\n\n--- discussion ends ---'
  )
}

// How the note is introduced to the reply that continues. It says plainly that
// turns were dropped and that the note stands in for them, because a model
// handed a summary with no explanation treats it as something the reader wrote.
export const CARD_HANDOFF_PREAMBLE =
  'This discussion has run long enough that its earlier turns no longer fit. Those turns have been ' +
  'replaced by the summary below, which is now the only record of them. Treat the summary as ' +
  'established fact, answer the new follow-up using it, and do not start over or ask the reader to ' +
  'repeat anything it already covers.'

// The turns being dropped, rendered as something a model can read. A previous
// note is folded in ahead of them rather than kept beside them, so a card that
// compacts five times still carries exactly one note.
//
// The note as it sits in the discussion is skipped, because a second compaction
// would otherwise carry it twice: once as `previousNote` and again as the first
// turn of the history, wrapped in the preamble. Twice the cost at the exact
// moment the window is scarce, and worse, the preamble's imperatives ("do not
// start over, ask for nothing again") would arrive inside the record the
// summariser has been told to transcribe, where they read as instructions
// rather than as material.
export function renderThreadMaterial(
  turns: readonly ThreadTurn[],
  previousNote?: string,
): string {
  const parts: string[] = []
  if (previousNote?.trim()) {
    parts.push(`Summary of the earlier part of this same discussion:\n\n${previousNote.trim()}`)
  }
  for (const turn of turns) {
    for (const message of turn.messages) {
      const text = message.text.trim()
      if (text.startsWith(CARD_HANDOFF_PREAMBLE)) continue
      const steps = message.toolSteps ?? []
      if (message.role === 'user') {
        if (text) parts.push(`The reader asked:\n${text}`)
        continue
      }
      for (const step of steps) {
        // A compaction row is the reader's record that a note was written, not
        // evidence the next note is built from. Its detail IS the previous
        // note, which arrives once already as `previousNote`, so transcribing
        // it here would carry the whole note twice at the exact moment the
        // window is scarce.
        if (step.kind === 'compaction') continue
        if (step.detail.trim()) parts.push(`The reply used ${step.kind}: ${step.detail.trim()}`)
      }
      const ended = message.status === 'stopped' ? ' (stopped early)' : ''
      if (text) parts.push(`The reply${ended}:\n${text}`)
    }
  }
  return parts.join('\n\n')
}

// ---- putting the discussion back together ----------------------------------

// The discussion as it will be sent: the note in place of everything it covers,
// then the freshest turns verbatim. A plain message rather than a special
// shape, so every reader of a thread keeps working unchanged.
export function handoffNoteMessage(note: string): FollowUpMessage {
  return {
    id: newId('fu'),
    role: 'user',
    text: `${CARD_HANDOFF_PREAMBLE}\n\n${note.trim()}`,
    createdAt: new Date().toISOString(),
    status: 'complete',
  }
}

export function compactedThread(
  plan: ThreadCompactionPlan,
  note: string,
): FollowUpMessage[] {
  return [handoffNoteMessage(note), ...plan.tail.flatMap((turn) => [...turn.messages])]
}

// Which messages a note stands in for, so a note written once can be reused on
// the next follow-up instead of being paid for again.
export function coveredMessageIds(plan: ThreadCompactionPlan): string[] {
  return plan.summarize.flatMap((turn) => turn.messages.map((message) => message.id))
}
