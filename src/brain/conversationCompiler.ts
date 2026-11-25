// The Conversation compiler (a deep module). It turns the connected graph around a
// Conversation card into everything a run needs: the ordered participants, each
// participant's PRIVATE context, the Shared Conversation Context, the top-level Mod
// guidance, and a deterministic per-turn instruction with Turn Aware metadata.
//
// Like the Ask AI compiler, this is deterministic and explainable: same graph and
// transcript, same instruction. It deliberately keeps private and shared context on
// separate sides so a participant never sees another participant's backstage notes.

import { contractFor } from '../graph/contextContracts'
import { deepThoughtPolicy, PARTICIPANT_PRIVATE_CONTEXT_POLICY } from '../graph/contextQuery'
import { cardById, cardText } from '../graph/graphHelpers'
import type {
  AppliedMod,
  Card,
  CompactionMode,
  ConversationSettings,
  ConversationStyle,
  RunContextBudget,
  SavedBoard,
  TranscriptMessage,
} from '../graph/types'
import {
  gatherConnectedThought,
  hasContextEntry,
  renderAlreadyExploredSection,
  type CompiledAsset,
  type CompiledInstruction,
  type ContextEntry,
} from './compiler'
import { transcriptForPrompt } from './transcript'

const STYLE_GUIDANCE: Record<ConversationStyle, string> = {
  debate:
    'This is a debate. Argue your own position with conviction, engage directly with what others said, ' +
    'and press on weak points — but stay honest and on-topic.',
  critique:
    'This is a critique. Examine the topic and the points already raised carefully, name strengths and ' +
    'weaknesses, and suggest concrete improvements rather than just reacting.',
  interview:
    'This is an interview. Ask sharp, building questions and follow up on the answers already given; ' +
    'go deeper rather than wider.',
  collaborate:
    'This is a collaborative exploration. Build on what others said, add new angles, and move the shared ' +
    'thinking forward together rather than competing.',
}

export const DEFAULT_CONVERSATION_STYLE: ConversationStyle = 'debate'
export const DEFAULT_CONVERSATION_TURNS = 3

export type ResolvedParticipant = {
  cardId: string
  title: string // the Ask AI card title (may be blank → needs a generated Speaker Name)
  model?: string // the card's own model; absent → the run uses the default model
  role: string // the participant's own Ask AI instruction = its Participant Role
  // The participant's PRIVATE context, compiled from its own incoming connections
  // (notes, results, private mods) — never another participant's context.
  privateContext: CompiledInstruction
  // Mods connected to this participant's source card. Their lines come from
  // privateContext's shared compiled-Mod projection; the conversation only
  // scopes those lines to this participant's turns.
  participantMods: ConversationModGuidance[]
  assets: CompiledAsset[]
}

export type SharedContextEntry = {
  cardId: string
  label: string
  text: string
}

export type ConversationModGuidance = {
  cardId: string
  label: string
  instructions: string[]
}

export type ResolvedConversation = {
  settings: ConversationSettings
  participants: ResolvedParticipant[]
  sharedContext: SharedContextEntry[]
  alreadyExplored: ContextEntry[]
  topLevelMods: ConversationModGuidance[]
  // Canonical Mod provenance for the whole run. Participant-scoped entries
  // carry the participant they shaped; room-level entries do not.
  appliedMods: AppliedMod[]
  sharedAssets: CompiledAsset[]
  alreadyExploredAssets: CompiledAsset[]
  // What the context budget did across all participants this resolve (ADR 0015).
  // Absent when no budget was applied or nothing was shortened or left out.
  contextBudget?: RunContextBudget
}

// Each participant's private context is compiled under its own model's budget,
// so a conversation obeys ADR 0015 the same way an Ask run does. The runner
// resolves twice: once with no summaries to learn what needs compacting, then
// again with the cheap-model summaries in hand (mirrors runCard's two passes).
export type ConversationBudgetOptions = {
  mode: CompactionMode
  summaries: ReadonlyMap<string, string>
  budgetTokensForModel: (model?: string) => number
}

// Merge each participant's per-model budget into one summary for the run record
// and result marker: the marker only needs which cards were touched and the
// mode; tokens are summed so the numbers still add up across participants.
function mergeContextBudgets(
  budgets: RunContextBudget[],
  mode: CompactionMode,
): RunContextBudget | undefined {
  const touched = budgets.filter(
    (budget) => budget.compactedCardIds.length > 0 || budget.droppedCardIds.length > 0,
  )
  if (!touched.length) return undefined
  return {
    budgetTokens: budgets.reduce((sum, budget) => sum + budget.budgetTokens, 0),
    estimatedTokens: budgets.reduce((sum, budget) => sum + budget.estimatedTokens, 0),
    finalTokens: budgets.reduce((sum, budget) => sum + budget.finalTokens, 0),
    compactedCardIds: [...new Set(touched.flatMap((budget) => budget.compactedCardIds))],
    droppedCardIds: [...new Set(touched.flatMap((budget) => budget.droppedCardIds))],
    mode,
  }
}

export function conversationSettings(card: Card): ConversationSettings {
  return {
    topic: cardText(card),
    style: card.conversationStyle ?? DEFAULT_CONVERSATION_STYLE,
    turnsPerParticipant: Math.max(1, card.conversationTurns ?? DEFAULT_CONVERSATION_TURNS),
  }
}

// Interpret the Conversation Inputs by each source's context contract
// (conversationInput, ADR 0017):
//   participant → a scheduled speaker (ordered by the incoming connection order)
//   shared      → Shared Conversation Context every participant reads
//   guidance    → top-level Conversation guidance (a Mod's dials)
//   none        → never enters the conversation (titles)
// A participant's Mods stay attached to that Ask AI card. The context contract
// compiles them through gatherConnectedThought, then this resolver
// carries their already-emitted lines into that participant's turn scope.
export function resolveConversation(
  board: SavedBoard,
  conversationCardId: string,
  budget?: ConversationBudgetOptions,
): ResolvedConversation {
  const card = cardById(board, conversationCardId)
  const settings = card
    ? conversationSettings(card)
    : { topic: '', style: DEFAULT_CONVERSATION_STYLE, turnsPerParticipant: DEFAULT_CONVERSATION_TURNS }
  const participants: ResolvedParticipant[] = []
  const sharedContext: SharedContextEntry[] = []
  const alreadyExplored: ContextEntry[] = []
  const sharedAssets: CompiledAsset[] = []
  const alreadyExploredAssets: CompiledAsset[] = []
  // Conversation inputs are one hop. This compile is the single authoritative
  // top-level context projection: normal inputs, Avoid entries, compiled Mods,
  // and Mod provenance all come from it rather than a private connection walk.
  const topLevelContext = gatherConnectedThought(
    board,
    conversationCardId,
    undefined,
    deepThoughtPolicy(1),
  )

  const orderedTopLevelEntries = [...topLevelContext.preview.context].sort(
    (left, right) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0),
  )
  for (const entry of orderedTopLevelEntries) {
    const source = cardById(board, entry.cardId)
    if (!source) continue
    const input = contractFor(source.kind).conversationInput
    if (input === 'none') continue

    if (entry.relation === 'avoid') {
      if (hasContextEntry(entry)) {
        alreadyExplored.push(entry)
        alreadyExploredAssets.push(
          ...entry.assets.map((asset) => ({
            ...asset,
            cardId: entry.cardId,
            cardLabel: entry.label,
            connectionId: entry.connectionId,
          })),
        )
      }
      continue
    }

    if (input === 'participant') {
      const privateContext = gatherConnectedThought(
        board,
        source.id,
        budget
          ? {
              budgetTokens: budget.budgetTokensForModel(source.model),
              mode: budget.mode,
              summaries: new Map(budget.summaries),
            }
          : undefined,
        PARTICIPANT_PRIVATE_CONTEXT_POLICY,
      )
      participants.push({
        cardId: source.id,
        title: source.title?.trim() ?? '',
        model: source.model,
        role: cardText(source),
        privateContext,
        participantMods: privateContext.preview.mods.map((mod) => ({
          cardId: mod.cardId,
          label: mod.label,
          instructions: mod.appliedInstructions,
        })),
        assets: privateContext.assets,
      })
      continue
    }

    // Notes, Results and Groups feed every participant as Shared Conversation Context.
    if (hasContextEntry(entry)) {
      sharedContext.push({ cardId: entry.cardId, label: entry.label, text: entry.text })
    }
    for (const asset of entry.assets) {
      sharedAssets.push({
        ...asset,
        cardId: entry.cardId,
        cardLabel: entry.label,
        connectionId: entry.connectionId,
      })
    }
  }

  const topLevelMods: ConversationModGuidance[] = topLevelContext.preview.mods.map((mod) => ({
    cardId: mod.cardId,
    label: mod.label,
    instructions: mod.appliedInstructions,
  }))

  const contextBudget = budget
    ? mergeContextBudgets(
        participants.map((p) => p.privateContext.budget).filter((b): b is RunContextBudget => Boolean(b)),
        budget.mode,
      )
    : undefined

  return {
    settings,
    participants,
    sharedContext,
    alreadyExplored,
    topLevelMods,
    appliedMods: [
      ...topLevelContext.appliedMods,
      ...participants.flatMap((participant) =>
        participant.privateContext.appliedMods.map((mod) => ({
          ...mod,
          participantCardId: participant.cardId,
        })),
      ),
    ],
    sharedAssets,
    alreadyExploredAssets,
    contextBudget,
  }
}

// ---- Turn planning ------------------------------------------------------------

export type PlannedTurn = {
  participantCardId: string
  currentTurn: number // this participant's turn number across the whole conversation
  totalTurns: number // total turns this participant will have had by run's end
  isFinalTurn: boolean // is this the participant's last scheduled turn in this run?
}

// Plan the turns for one run. Participants cycle in order; each round every
// participant speaks once. `rounds` is turnsPerParticipant for a fresh run, or a
// smaller continuation (e.g. one more round after a user message). `priorTurns`
// carries how many times each participant has already spoken, so a continuation
// keeps counting up instead of restarting at turn 1.
export function planConversationTurns(
  participantCardIds: string[],
  opts: { rounds: number; priorTurns?: Record<string, number> },
): PlannedTurn[] {
  const prior = opts.priorTurns ?? {}
  const rounds = Math.max(0, opts.rounds)
  const turns: PlannedTurn[] = []
  for (let round = 1; round <= rounds; round++) {
    for (const participantCardId of participantCardIds) {
      const base = prior[participantCardId] ?? 0
      const currentTurn = base + round
      const totalTurns = base + rounds
      turns.push({
        participantCardId,
        currentTurn,
        totalTurns,
        isFinalTurn: currentTurn === totalTurns,
      })
    }
  }
  return turns
}

// ---- Per-turn prompt assembly -------------------------------------------------

export type TurnPromptInput = {
  settings: ConversationSettings
  participant: ResolvedParticipant
  speakerName: string
  sharedContext: SharedContextEntry[]
  alreadyExplored?: ContextEntry[]
  topLevelMods: ConversationModGuidance[]
  transcript: TranscriptMessage[]
  turn: { currentTurn: number; totalTurns: number; isFinalTurn: boolean }
}

function privateContextLines(compiled: CompiledInstruction): string[] {
  const lines: string[] = []
  const push = (entries: ContextEntry[]) => {
    for (const e of entries) {
      const body = e.text.trim()
      if (body) lines.push(e.label && e.label !== body ? `- ${e.label}: ${body}` : `- ${body}`)
    }
  }
  push(compiled.sections.buildOn)
  push(compiled.sections.influences)
  return lines
}

function privateAlreadyExploredSection(compiled: CompiledInstruction): string | undefined {
  return renderAlreadyExploredSection(compiled.sections.alreadyExplored, {
    heading: '## YOUR ALREADY EXPLORED — do not retread',
  })
}

// Build the exact instruction sent for one participant's turn. Includes the shared
// topic, Conversation Style, the participant's private role/context, top-level Mod
// guidance, the full Public Transcript so far, and Turn Aware metadata.
export function buildTurnPrompt(input: TurnPromptInput): string {
  const { settings, participant, speakerName, sharedContext, topLevelMods, transcript, turn } = input
  const parts: string[] = []
  const remaining = Math.max(0, turn.totalTurns - turn.currentTurn)

  parts.push(
    `You are "${speakerName}", one participant in a multi-turn conversation. ` +
      'Write only your own next message, in your own voice. Do not narrate the conversation, ' +
      'speak for anyone else, or write a summary or final verdict for the whole exchange.',
  )

  parts.push('## TOPIC\n' + (settings.topic.trim() || '(No topic written — discuss the points raised.)'))

  parts.push('## CONVERSATION STYLE\n' + STYLE_GUIDANCE[settings.style])

  // Turn awareness: total, current, remaining, and final-turn status.
  const turnLines = [
    `You get ${turn.totalTurns} turn(s) in total in this conversation.`,
    `This is your turn ${turn.currentTurn} of ${turn.totalTurns}.`,
    `You have ${remaining} turn(s) remaining after this one.`,
    turn.isFinalTurn
      ? 'This is your FINAL turn — bring your contribution to a close rather than opening new threads.'
      : 'This is not your final turn — you can leave threads open for later turns.',
  ]
  parts.push('## YOUR TURN\n' + turnLines.map((l) => `- ${l}`).join('\n'))

  if (participant.role.trim()) {
    parts.push('## YOUR ROLE\n' + participant.role.trim())
  }

  const privateLines = privateContextLines(participant.privateContext)
  if (privateLines.length) {
    parts.push(
      '## YOUR PRIVATE CONTEXT (only you can see this)\n' + privateLines.join('\n'),
    )
  }
  const privateAlreadyExplored = privateAlreadyExploredSection(participant.privateContext)
  if (privateAlreadyExplored) parts.push(privateAlreadyExplored)

  if (participant.participantMods.length) {
    const modLines = participant.participantMods.flatMap((mod) => mod.instructions)
    if (modLines.length) {
      parts.push(
        '## YOUR GUIDANCE (applies only to you)\n' + modLines.map((line) => `- ${line}`).join('\n'),
      )
    }
  }

  if (topLevelMods.length) {
    const modLines = topLevelMods.flatMap((m) => m.instructions)
    if (modLines.length) {
      parts.push(
        '## CONVERSATION GUIDANCE (applies to everyone)\n' + modLines.map((l) => `- ${l}`).join('\n'),
      )
    }
  }

  if (sharedContext.length) {
    const lines = sharedContext
      .filter((c) => c.text.trim())
      .map((c) => `- ${c.label}: ${c.text.trim()}`)
    if (lines.length) {
      parts.push('## SHARED CONTEXT (everyone can see this)\n' + lines.join('\n'))
    }
  }

  const alreadyExplored = renderAlreadyExploredSection(input.alreadyExplored ?? [])
  if (alreadyExplored) parts.push(alreadyExplored)

  const said = transcriptForPrompt(transcript)
  parts.push(
    '## CONVERSATION SO FAR\n' +
      (said || '(Nothing said yet — you are opening the conversation.)'),
  )

  parts.push(`Now write your next message as "${speakerName}".`)

  return parts.join('\n\n')
}
