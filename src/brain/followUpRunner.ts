import { registerFollowUpStreamStopper, useGraph } from '../graph/store'
import type { FollowUpMessage, OutputVersion, ReasoningEffort, RunRecord, RunToolStep } from '../graph/types'
import { newId } from '../shared/ids'
import { resolveProfileReviewModel } from '../shared/profileReviewPolicy'
import {
  aiAccessFailure,
  resolveEngineAiAccess,
  type AiAccessFailure,
  type AiAccessGrant,
} from './aiAccess'
import { createAiExecutionBatch } from './aiExecutionBatch'
import { planAiExecution } from './executionPlan'
import { flattenFollowUpThread } from './followUpThread'
import type { EidoToolSet } from './agenticRun'
import { bindCompletionAccess, type CompletionStream } from './openRouter'
import { activeAiProvider, localProviderCompletion } from './aiProvider'
import type { AiProvider } from './aiProviderTypes'
import {
  buildThreadNoteInstruction,
  CARD_COMPACTION_SYSTEM_PROMPT,
  cardCompactionThreshold,
  cardContextTokens,
  compactedThread,
  coveredMessageIds,
  handoffNoteMessage,
  planThreadCompaction,
  renderThreadMaterial,
  type ThreadCompactionPlan,
} from './cardContextCompaction'
import {
  COMPACTION_REASONING_EFFORT,
  compactionMaterialFloor,
  compactionStep,
} from './conversationCompaction'
import { createAbortRegistry, plainError } from './runLifecycle'
import { eidoWebToolSetFor } from './webTools'

export type FollowUpStream = (
  instruction: string,
  opts: {
    model: string
    reasoningEffort: ReasoningEffort
    signal?: AbortSignal
    onChunk: (text: string) => void
    agentic?: boolean
    onToolStep?: (step: RunToolStep) => void
    // Eido-executed web tools for this follow-up, when the run it continues
    // was agentic and a Linkup key exists (#961). Injected here, at the
    // caller, so the completion boundary never imports their vendor.
    eidoTools?: EidoToolSet
    // The loop's signal that prose already streamed was the model talking
    // between tool calls; the reply restarts clean and keeps only the answer.
    onAnswerRestart?: () => void
  },
) => Promise<string>

export type FollowUpOutcome =
  | { ok: true; messageId: string; status: 'done' | 'stopped' }
  | { ok: true; status: 'cancelled-before-start' }
  | { ok: false; reason: 'no-key' | 'missing-version' | 'missing-run' | 'failed'; message: string }
  | AiAccessFailure

type FollowUpPromptInput = {
  originalInstruction: string
  resultText: string
  priorMessages: FollowUpMessage[]
  question: string
}

type LocatedVersion = {
  version: OutputVersion
  run?: RunRecord
}

// The AbortController for each streaming follow-up, keyed by the version whose
// thread it extends.
const activeFollowUps = createAbortRegistry()
const activitySubscribers = new Map<string, Set<() => void>>()

function emitFollowUpActivity(versionId: string): void {
  for (const subscriber of activitySubscribers.get(versionId) ?? []) {
    try {
      subscriber()
    } catch {
      // Activity observation drives UI only; it cannot gain execution
      // authority or make an admitted lifecycle fail.
    }
  }
}

function registerFollowUpActivity(versionId: string, controller: AbortController): void {
  const wasActive = activeFollowUps.has(versionId)
  activeFollowUps.add(versionId, controller)
  if (!wasActive) emitFollowUpActivity(versionId)
}

function removeFollowUpActivity(versionId: string, controller: AbortController): void {
  const wasActive = activeFollowUps.has(versionId)
  activeFollowUps.remove(versionId, controller)
  if (wasActive && !activeFollowUps.has(versionId)) emitFollowUpActivity(versionId)
}

export function subscribeFollowUpActivity(
  versionId: string,
  subscriber: () => void,
): () => void {
  const subscribers = activitySubscribers.get(versionId) ?? new Set<() => void>()
  subscribers.add(subscriber)
  activitySubscribers.set(versionId, subscribers)
  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0) activitySubscribers.delete(versionId)
  }
}

function defaultStream(accessGrant: AiAccessGrant): FollowUpStream {
  // The spread carries the whole agentic surface through to the provider
  // boundary: `agentic`, `onToolStep`, and, when the caller built them, the
  // Eido-executed tools and their answer-restart signal (#961). A test stream
  // that replaces this one sees exactly the same options.
  const bound = bindCompletionAccess(accessGrant)
  return (instruction, opts) => bound(instruction, {
    ...opts,
    systemPrompt: useGraph.getState().settings.systemPrompt ?? '',
  })
}

function locateVersion(versionId: string): LocatedVersion | undefined {
  const graph = useGraph.getState().graph()
  const version = graph.versionById(versionId)?.version
  if (!version) return undefined
  const producingRun = graph.runForVersion(versionId)
  return {
    version,
    run: producingRun?.id === version.fromRunId ? producingRun : graph.runById(version.fromRunId),
  }
}

export function buildFollowUpInstruction(input: FollowUpPromptInput): string {
  return [
    'You are continuing a previous Eido AI result. Answer the new follow-up using the frozen run context and the selected result version below.',
    'Do not use or infer any current board state. If the follow-up asks for context that was not in the frozen run, say what is missing and continue from the available context.',
    '## FROZEN RUN CONTEXT',
    input.originalInstruction.trim() || '(No original context was recorded.)',
    '## SELECTED RESULT VERSION',
    input.resultText.trim() || '(The selected version has no result text.)',
    '## FOLLOW-UP THREAD SO FAR',
    flattenFollowUpThread(input.priorMessages) || '(No follow-up messages yet.)',
    '## NEW FOLLOW-UP',
    input.question.trim(),
  ].join('\n\n')
}

function userFollowUp(text: string): FollowUpMessage {
  return {
    id: newId('fu'),
    role: 'user',
    text,
    createdAt: new Date().toISOString(),
    status: 'complete',
  }
}

function assistantFollowUp(): FollowUpMessage {
  return {
    id: newId('fu'),
    role: 'assistant',
    text: '',
    createdAt: new Date().toISOString(),
    status: 'streaming',
  }
}

// ---- staying inside the window (#1036) --------------------------------------
//
// A Result Card's context only grows, and a long enough discussion outgrows the
// model's window. Before every follow-up leaves, the whole of what is about to
// be sent is measured against that window, and if it is over the share Eido
// compacts at, the older turns are replaced by a note the model writes about
// them.
//
// The measurement is of the assembled instruction and nothing else, so it
// counts everything that reached the card's context regardless of what put it
// there. A future feature that adds to a Result Card is covered here on the day
// it ships, with nothing to register and nothing to remember.
//
// The card itself is not touched. The reader keeps every word of their
// discussion on screen and downstream context keeps reading the whole thread;
// only the request is shortened.

// The note a card currently sends in place of its earlier turns, and which of
// its messages that note stands in for. Held in memory rather than on the
// board, deliberately: this is a saving and not a record, the discussion it
// summarises is still there in full, and losing it on a reload costs exactly
// one summarising call.
type CardNote = { note: string; covers: Set<string> }

const cardNotes = new Map<string, CardNote>()

// How many cards keep a note, and how many keep a record of what could not be
// shortened. A note is a saving rather than a correctness requirement: evicting
// one costs the next follow-up on that card a summariser call and nothing else.
// Without a bound, a long session on a busy board holds one entry per version
// it ever followed up, for the life of the process.
const CARD_MEMORY_LIMIT = 64

// Insertion-ordered, so the oldest entry is the first key. The card being
// followed up is re-set on every compaction, which moves it to the back and
// keeps an active discussion out of reach of eviction.
function remember<T>(store: Map<string, T>, key: string, value: T): void {
  store.delete(key)
  store.set(key, value)
  if (store.size <= CARD_MEMORY_LIMIT) return
  const oldest = store.keys().next()
  if (!oldest.done) store.delete(oldest.value)
}

// Material a summariser has already been asked about and could not shorten.
//
// Observed live rather than imagined: a discussion of a hundred dense points,
// each with its own address and its own figures, is already as short as it can
// be said. A summariser told to copy every number and address exactly, as this
// one is, returns a note the size of what it replaced. The note is discarded
// (it is not a compaction), but the completion was paid for, and nothing would
// stop the next follow-up buying the same answer again.
//
// So the ids that failed are remembered, and the summariser is not asked again
// until the material is not the same material. A discussion that grows past
// what was declined is a new question and gets a new answer.
const declinedMaterial = new Map<string, Set<string>>()

export function forgetCardNotesForTests(): void {
  cardNotes.clear()
  declinedMaterial.clear()
}

// The messages a plan covers that really belong to this thread. The synthetic
// message carrying a previous note is not one of them: it is built fresh on
// every follow-up, so counting it would make every remembered set look new.
function realCoveredIds(
  plan: ThreadCompactionPlan,
  priorMessages: readonly FollowUpMessage[],
): string[] {
  const present = new Set(priorMessages.map((message) => message.id))
  return coveredMessageIds(plan).filter((id) => present.has(id))
}

// The discussion as it currently goes out. A stored note is only applied when
// every message it stands in for is still present: a thread that changed
// underneath it (a board reloaded, a version duplicated) drops the note rather
// than sending a summary of turns that are no longer there.
function applyCardNote(versionId: string, messages: FollowUpMessage[]): FollowUpMessage[] {
  const stored = cardNotes.get(versionId)
  if (!stored) return messages
  const remaining = messages.filter((message) => !stored.covers.has(message.id))
  if (messages.length - remaining.length !== stored.covers.size) {
    cardNotes.delete(versionId)
    return messages
  }
  return [handoffNoteMessage(stored.note), ...remaining]
}

type WindowGuardInput = {
  versionId: string
  assistantMessageId: string
  priorMessages: FollowUpMessage[]
  build: (messages: FollowUpMessage[]) => string
  model: string
  provider: AiProvider
  systemPrompt: string
  signal: AbortSignal
}

// Only the summariser needs a way to reach the provider, and it is handed the
// caller's already-admitted stream rather than opening one of its own.
type CompactionInput = WindowGuardInput & { stream: CompletionStream | FollowUpStream }

type PreparedInstruction = {
  instruction: string
  // Present only when this card is over the threshold AND there is something
  // worth cutting. Absent means send `instruction` as it stands.
  compaction?: { plan: ThreadCompactionPlan; previousNote?: string }
}

// What to send, decided without touching the network.
//
// Deliberately synchronous, and the caller only awaits when it returns work to
// do. A card that fits reaches its stream in the same tick it always did, which
// is what keeps a Stop or a board duplicate pressed in that same tick landing
// on a stream that has started (issue #286).
function prepareInstruction(input: WindowGuardInput): PreparedInstruction {
  const threshold = cardCompactionThreshold(input.model, input.provider)
  // The real discussion first, every time. A note is a saving, not a state the
  // card is now in: applying a stored one before knowing whether it is needed
  // would keep sending a summary for the rest of the session even after the
  // reader moved to a model with room to spare.
  const whole = input.build(input.priorMessages)
  if (cardContextTokens(whole, input.systemPrompt, input.model) < threshold) {
    return { instruction: whole }
  }
  // Over. A note already paid for is applied before another one is bought.
  const messages = applyCardNote(input.versionId, input.priorMessages)
  const instruction = messages === input.priorMessages ? whole : input.build(messages)
  if (cardContextTokens(instruction, input.systemPrompt, input.model) < threshold) {
    return { instruction }
  }
  const plan = planThreadCompaction(messages, threshold)
  // Over the threshold with nothing worth cutting. Sending is still the right
  // move: being over is Eido's own estimate against a window it believes, and
  // refusing to send on that would fail a follow-up that would have worked.
  if (!plan) return { instruction }
  // A summariser is asked again only when there is enough discussion it has not
  // already refused to shorten to be worth the call on its own. Asking whether
  // the whole plan is declined would be no guard at all: a card over its
  // threshold has a full tail, so nearly every follow-up pushes one more turn
  // into the material and makes the plan look new, and the same unshortenable
  // discussion gets bought over and over at close to the size of the window.
  const declined = declinedMaterial.get(input.versionId)
  if (declined && freshMaterialTokens(plan, declined) < compactionMaterialFloor(threshold)) {
    return { instruction }
  }
  return { instruction, compaction: { plan, previousNote: cardNotes.get(input.versionId)?.note } }
}

// What the summariser would be handed that it has not already refused. A turn
// counts only if some part of it is new: a turn already declined in full is
// material the summariser has seen and given back at the same size.
function freshMaterialTokens(plan: ThreadCompactionPlan, declined: ReadonlySet<string>): number {
  let total = 0
  for (const turn of plan.summarize) {
    if (turn.messages.every((message) => declined.has(message.id))) continue
    total += turn.materialTokens
  }
  return total
}

// The instruction to send, with the older turns replaced by a note the model
// writes about them.
//
// Every path that is not a clean compaction returns the instruction unchanged,
// on purpose. A summariser that failed and a summariser that said nothing prove
// nothing about whether the request will be refused, so the provider is left to
// be the one that says no (ADR 0038).
async function compactedInstruction(
  input: CompactionInput,
  prepared: PreparedInstruction,
): Promise<string> {
  const { instruction } = prepared
  const compaction = prepared.compaction
  if (!compaction) return instruction
  const { plan, previousNote } = compaction

  // The summariser is this card's own model, deliberately. A cheap small model
  // is the obvious saving and the wrong one: the discussion being summarised is
  // by definition near a large window, and a small model's own window cannot
  // hold it, so the saving buys a call that fails exactly when it is needed.
  //
  // It goes out through the same stream the reply uses, which means it carries
  // Eido's framing and the board's guidance as well. That is accepted rather
  // than worked around: one injection point is one thing to test, and the
  // instruction below says plainly enough what the job is.
  let note = ''
  try {
    await input.stream(
      `${CARD_COMPACTION_SYSTEM_PROMPT}\n\n${buildThreadNoteInstruction(
        renderThreadMaterial(plan.summarize, previousNote),
      )}`,
      {
        model: input.model,
        systemPrompt: input.systemPrompt,
        reasoningEffort: COMPACTION_REASONING_EFFORT,
        signal: input.signal,
        onChunk: (chunk) => {
          note += chunk
        },
      },
    )
  } catch (err) {
    // Cancel is the reader's and it stops everything. Any other failure leaves
    // the follow-up standing on the discussion it already had: a failed tidy-up
    // is not a failed reply.
    if (input.signal.aborted) throw err
    return instruction
  }
  note = note.trim()
  if (!note) return instruction

  // A note that is not shorter than what it replaces is not a compaction. The
  // summariser is told to be complete rather than brief and given no length
  // cap, so a model that near-transcribes its input can hand back more than it
  // was given; sending that would break the one rule this whole guard rests on,
  // and could push a follow-up that would have squeaked under the window into a
  // refusal. Nothing is stored and no row is recorded, so the next follow-up is
  // free to try again on a different discussion.
  const rebuilt = input.build(compactedThread(plan, note))
  if (
    cardContextTokens(rebuilt, input.systemPrompt, input.model)
    >= cardContextTokens(instruction, input.systemPrompt, input.model)
  ) {
    // This material cannot be said shorter. Remembered so the next follow-up
    // does not buy the same answer over again.
    remember(
      declinedMaterial,
      input.versionId,
      new Set([
        ...(declinedMaterial.get(input.versionId) ?? []),
        ...realCoveredIds(plan, input.priorMessages),
      ]),
    )
    return instruction
  }

  // Only ids that were really in this thread are recorded as covered. The note
  // message a previous compaction put at the front is not one of them, and
  // counting it would make the note look inapplicable on every later follow-up.
  const covers = new Set([
    ...(cardNotes.get(input.versionId)?.covers ?? []),
    ...realCoveredIds(plan, input.priorMessages),
  ])
  remember(cardNotes, input.versionId, { note, covers })
  // The reader is told, in the same trail row that web lookups and thinking
  // use. Recorded whatever the card is armed to do, because a plain discussion
  // compacts exactly as an Agentic Run does and the reader is owed the same
  // account of it.
  useGraph.getState().recordFollowUpToolStep(input.versionId, input.assistantMessageId, compactionStep(note))
  return rebuilt
}

export function isFollowUpRunning(versionId: string): boolean {
  return activeFollowUps.has(versionId)
}

export function cancelFollowUp(versionId: string): void {
  activeFollowUps.abort(versionId)
  const located = locateVersion(versionId)
  const streaming = located?.version.followUpThread?.messages.filter((m) => m.status === 'streaming') ?? []
  for (const message of streaming) {
    useGraph.getState().finishFollowUpMessage(versionId, message.id, 'stopped')
  }
}

// Duplicating a board must not let a live stream trail into the copy (issue
// #286): stop every active follow-up run among the given versions, exactly as
// the card's Stop button does — abort the stream and settle its reply to
// 'stopped'. Versions with no active run are left alone, so a duplicate with
// nothing streaming touches nothing. Handed to the store below because the
// store cannot import this module (this module imports the store).
export function cancelActiveFollowUps(versionIds: string[]): void {
  for (const versionId of versionIds) {
    if (activeFollowUps.has(versionId)) cancelFollowUp(versionId)
  }
}

registerFollowUpStreamStopper(cancelActiveFollowUps)

export async function runFollowUp(
  versionId: string,
  question: string,
  opts: { stream?: FollowUpStream } = {},
): Promise<FollowUpOutcome> {
  const trimmed = question.trim()
  if (!trimmed) return { ok: false, reason: 'failed', message: 'errGeneric' }

  const state = useGraph.getState()
  const { apiKey, reasoningEffort, systemPrompt = '' } = state.settings

  const located = locateVersion(versionId)
  if (!located) return { ok: false, reason: 'missing-version', message: 'errGeneric' }
  const { version, run } = located
  if (!run) return { ok: false, reason: 'missing-run', message: 'versionContextMissing' }
  if (activeFollowUps.has(versionId)) return { ok: false, reason: 'failed', message: 'errGeneric' }
  const currentProvider = state.settings.provider ?? 'openrouter'
  const runProvider = run.provider ?? 'openrouter'
  const followUpModel = runProvider === currentProvider ? run.model : state.settings.model
  const model = resolveProfileReviewModel(followUpModel || state.settings.model)
  const executionPlan = planAiExecution(state.snapshot(), {
    kind: 'followUp',
    providerModelId: model,
  })
  if (!executionPlan) return { ok: false, reason: 'failed', message: 'errGeneric' }
  const priorMessages = version.followUpThread?.messages ?? []
  const buildInstruction = (messages: FollowUpMessage[]): string =>
    buildFollowUpInstruction({
      originalInstruction: run.compiledInstruction,
      resultText: version.text,
      priorMessages: messages,
      question: trimmed,
    })

  // A follow-up continues the run it hangs off, so it inherits that run's reach
  // (ADR 0033). Research does not stop at the first answer: the question a
  // reader asks second is usually the one that needs a fresh lookup. The run's
  // own record answers this rather than the Card's switch, which may have moved
  // since. Provider is deliberately not re-checked here: a run recorded under
  // one provider carries what it was allowed to do, and the provider boundary
  // decides for itself what to do with the request.
  const userMessage = userFollowUp(trimmed)
  const assistantMessage = assistantFollowUp()
  const controller = new AbortController()
  const sourceIdeaId = state.currentIdeaId
  const sourceRunId = version.fromRunId
  const sourceCreatedAt = version.createdAt

  const stillOwnsDestination = () => {
    const currentVersion = locateVersion(versionId)?.version
    return useGraph.getState().currentIdeaId === sourceIdeaId
      && currentVersion?.fromRunId === sourceRunId
      && currentVersion.createdAt === sourceCreatedAt
  }

  // Register the whole operation before awaiting access so duplicate/switch/stop
  // lifecycles can see
  // and cancel pending work before it gains provider or Board authority.
  registerFollowUpActivity(versionId, controller)

  try {
    const accessDecision = await resolveEngineAiAccess(
      {
        action: 'follow-up',
        source: 'in-app',
        byokCredential: apiKey,
        requestedModel: model,
        providerModelIds: [model],
        executionPlan,
        localCompletion: localProviderCompletion(state.settings),
      },
      { signal: controller.signal },
    )
    if (!accessDecision.ok) {
      return controller.signal.aborted || !stillOwnsDestination()
        ? { ok: true, status: 'cancelled-before-start' }
        : aiAccessFailure(accessDecision)
    }
    const executionBatch = createAiExecutionBatch(accessDecision.grant, executionPlan)
    const agentic = run.agentic === true
    // A follow-up is clamped to the Web tools, whatever the Card is armed to.
    // The research warning guards the Run press and only the Run press: a
    // one-line conversational reply must never be able to submit a job that
    // runs for minutes, keeps spending after a cancel, and was consented to
    // days earlier about a different press. Someone who wants another
    // investigation presses Run. The clamp is stated here rather than left to
    // the parameter default, so the lane that adds the research executor
    // cannot widen a follow-up's reach by changing what the default means.
    const eidoTools = agentic
      ? eidoWebToolSetFor(state.settings, 'web')
      : undefined

    if (controller.signal.aborted || !stillOwnsDestination()) {
      await executionBatch.release('cancelled')
      await executionBatch.finish()
      return { ok: true, status: 'cancelled-before-start' }
    }

    useGraph.getState().appendFollowUpMessage(versionId, userMessage)
    useGraph.getState().appendFollowUpMessage(versionId, assistantMessage)

    try {
      const stream = opts.stream
        ? bindCompletionAccess(accessDecision.grant, opts.stream)
        : defaultStream(accessDecision.grant)
      // What to send, and whether this thread has outgrown the window and
      // should be summarised first (#1039). Deciding costs nothing: the choice
      // is made from the thread alone, with no request.
      const guard: WindowGuardInput = {
        versionId,
        assistantMessageId: assistantMessage.id,
        priorMessages,
        build: buildInstruction,
        model,
        provider: activeAiProvider(state.settings),
        systemPrompt,
        signal: controller.signal,
      }
      const prepared = prepareInstruction(guard)
      await executionBatch.runProvider(
        { callClass: 'follow-up', providerModelId: model },
        async () => {
          const instruction = prepared.compaction
            ? await compactedInstruction({ ...guard, stream }, prepared)
            : prepared.instruction
          return stream(instruction, {
            model,
            reasoningEffort,
            systemPrompt,
            signal: controller.signal,
            ...(agentic ? { agentic: true as const } : {}),
            ...(eidoTools
              ? {
                  eidoTools,
                  onAnswerRestart: () => {
                    if (!controller.signal.aborted && stillOwnsDestination()) {
                      useGraph.getState().resetFollowUpMessageText(versionId, assistantMessage.id)
                    }
                  },
                }
              : {}),
            onChunk: (chunk) => {
              if (controller.signal.aborted) return
              if (!stillOwnsDestination()) {
                controller.abort()
                return
              }
              useGraph.getState().appendFollowUpChunk(versionId, assistantMessage.id, chunk)
            },
            ...(agentic
              ? {
                  onToolStep: (step: RunToolStep) => {
                    if (!controller.signal.aborted && stillOwnsDestination()) {
                      useGraph.getState().recordFollowUpToolStep(versionId, assistantMessage.id, step)
                    }
                  },
                }
              : {}),
          })
        },
      )
      if (controller.signal.aborted || !stillOwnsDestination()) {
        controller.abort()
        if (stillOwnsDestination()) {
          useGraph.getState().finishFollowUpMessage(versionId, assistantMessage.id, 'stopped')
        }
        await executionBatch.release('cancelled')
        await executionBatch.finish()
        return { ok: true, messageId: assistantMessage.id, status: 'stopped' }
      }
      useGraph.getState().finishFollowUpMessage(versionId, assistantMessage.id, 'complete')
      const completed = await executionBatch.completeOutput()
      if (!completed) {
        useGraph.getState().finishFollowUpMessage(versionId, assistantMessage.id, 'failed')
        await executionBatch.finish()
        return { ok: false, reason: 'failed', message: 'errGeneric' }
      }
      await executionBatch.finish()
      return { ok: true, messageId: assistantMessage.id, status: 'done' }
    } catch (err) {
      if (controller.signal.aborted || !stillOwnsDestination()) {
        controller.abort()
        if (stillOwnsDestination()) {
          useGraph.getState().finishFollowUpMessage(versionId, assistantMessage.id, 'stopped')
        }
        await executionBatch.release('cancelled')
        await executionBatch.finish()
        return { ok: true, messageId: assistantMessage.id, status: 'stopped' }
      }
      useGraph.getState().finishFollowUpMessage(versionId, assistantMessage.id, 'failed')
      await executionBatch.release('failed')
      await executionBatch.finish()
      return { ok: false, reason: 'failed', message: plainError(err) }
    }
  } finally {
    removeFollowUpActivity(versionId, controller)
  }
}
