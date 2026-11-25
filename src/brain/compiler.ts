// The compiler (Concept 3): connected thought → a structured instruction the user
// can always see. Deterministic and explainable — same graph, same instruction.
// No embeddings or ranking magic until determinism visibly falls short.

import { COMPACTION_TARGET_CHARS, planContextBudget, type BudgetEntryInput } from '../graph/contextBudget'
import { contractFor } from '../graph/contextContracts'
import { CONNECTED_THOUGHT_POLICY, gatherContext, type ContextPolicy } from '../graph/contextQuery'
import { cardById, cardLabel, cardText, membersOf } from '../graph/graphHelpers'
import type {
  AppliedMod,
  Card,
  CardAsset,
  CompactionMode,
  ConnectionGroupMode,
  OutputVersion,
  RunContextBudget,
  SavedBoard,
} from '../graph/types'
import { isV2ModCard } from '../mods/card'
import { readModContext, type ModContext } from '../mods/prompt'
import { snapshotModValues } from '../mods/snapshot'
import { estimateTokens } from '../shared/tokenEstimate'
import { followUpDiscussionSection } from './followUpThread'
import { groupMemberCompressionText, groupRelationshipText } from './groupDigestFreshness'
import { renderModBlockEntry, renderModsBlock } from './modBlock'

export type CompiledInstruction = {
  text: string // the exact thing sent to AI
  assets: CompiledAsset[]
  usedCardIds: string[]
  usedConnectionIds: string[]
  modIds: string[]
  appliedMods: AppliedMod[]
  // A structured view of the same thing, so the UI can render "what AI used"
  // without re-parsing the text.
  sections: {
    mods: ModContext[]
    buildOn: ContextEntry[]
    influences: ContextEntry[]
    alreadyExplored: ContextEntry[]
    task: string
  }
  // Read-only UI projection of the same context query and budget plan this
  // compile used. Previews render this; they do not re-walk connections.
  preview: {
    context: ContextPreviewContextEntry[]
    mods: ContextPreviewModEntry[]
  }
  isEmpty: boolean // nothing connected yet (besides the task)
  // Present when a context budget shaped this compile (ADR 0015): what was
  // compacted and what was left out — never silent.
  budget?: RunContextBudget
  // Full text per card the plan wants compacted, so the engine can create and
  // cache the summaries the next compile will apply.
  compactionInputs?: Record<string, string>
}

// Budget options for a compile (ADR 0015). The compiler itself never calls
// AI: it applies only the summaries handed to it and reports what the plan
// wanted, so a compile stays pure and deterministic.
export type CompileBudgetOptions = {
  budgetTokens: number
  mode: CompactionMode
  summaries: Map<string, string>
}

export type CompiledAsset = CardAsset & {
  cardId: string
  cardLabel: string
  connectionId?: string
}

type Gathered = {
  card: Card
  strength: 'strong' | 'weak'
  connectionId: string
  connectionLabel: string
  relation: ContextPreviewRelation
  hop: number
  groupMode?: ConnectionGroupMode
  reason?: string
  // Position in the user's arranged context order — the budget trims from the
  // bottom within a strength band (ADR 0015).
  orderIndex: number
}

export type ContextPreviewRelation = 'direct' | 'light' | 'avoid'
export type ContextPreviewBudgetStatus = 'full' | 'compacted' | 'will-compact' | 'dropped'

export type ContextEntry = {
  cardId: string
  label: string
  text: string
  assets: CardAsset[]
  connectionId?: string
  connectionLabel?: string
  relation?: ContextPreviewRelation
  hop?: number
  groupMode?: ConnectionGroupMode
  reason?: string
  memberLabels?: string[]
  // Budget metadata (ADR 0015); absent on entries older callers built.
  strength?: 'strong' | 'weak'
  orderIndex?: number
  // True when the budget replaced this entry's text with a cached summary.
  compacted?: boolean
  budgetStatus?: ContextPreviewBudgetStatus
}

export type ContextPreviewContextEntry = ContextEntry & {
  connectionId: string
  connectionLabel: string
  relation: ContextPreviewRelation
  hop: number
  budgetStatus: ContextPreviewBudgetStatus
}

type ContextPreviewModEntryCommon = {
  cardId: string
  label: string
  connectionId: string
  connectionLabel: string
  hop: number
  appliedInstructions: string[]
}

export type ContextPreviewModEntry = ContextPreviewModEntryCommon & {
  modVersion: 2
  context: ModContext
  // Exact per-Mod Markdown already used inside the compiled MODS block.
  // Context Peek renders this projection; it never formats Mod state itself.
  markdown: string
}

type ModInput = {
  card: Card
  connectionId: string
  connectionLabel: string
  hop: number
}

type ModApplication = {
  input: ModInput
  appliedMod: AppliedMod
  context: ModContext
}

export const BUILD_ON_FRAMING = "Use this as primary material. Preserve the user's framing and build directly from it."
export const INFLUENCES_FRAMING =
  'Use these as ambient color and secondary signals. Let them subtly shape tone, associations, and options, but do not treat them as requirements or make them the focal point.'
export const ALREADY_EXPLORED_HEADING = '## ALREADY EXPLORED — do not retread'
export const ALREADY_EXPLORED_FRAMING =
  'These are explored dead ends. Do not reuse their approach or merely avoid their exact words; steer toward structurally different directions.'

function chosenVersion(board: SavedBoard, resultCardId: string): OutputVersion | undefined {
  const output = board.outputs.find((o) => o.resultCardId === resultCardId)
  if (!output) return undefined
  const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
  return output.versions.find((v) => v.id === chosenId)
}

export function resultText(board: SavedBoard, resultCardId: string): string {
  return chosenVersion(board, resultCardId)?.text.trim() ?? ''
}

function chosenOutputText(board: SavedBoard, resultCardId: string): string {
  return resultText(board, resultCardId)
}

// What a card contributes to a consumer's context, per its contract (ADR 0017).
// Group content depends on the connection's group mode, so groups render in
// groupContextText below; here they fall back to their body like a note.
export function contextText(board: SavedBoard, card: Card): string {
  if (contractFor(card.kind).contributes === 'chosenOutput') {
    // Whatever is visible on the card flows downstream (ADR 0011): the chosen
    // version's answer, then its follow-up thread when there is one. The answer
    // stays first so context labels (first line) are unchanged.
    const answer = resultText(board, card.id)
    const discussion = followUpDiscussionSection(
      chosenVersion(board, card.id)?.followUpThread?.messages ?? [],
    )
    return [answer, discussion].filter(Boolean).join('\n\n')
  }
  return cardText(card)
}

function groupContextText(board: SavedBoard, group: Card, groupMode: ConnectionGroupMode): string {
  if (groupMode === 'compress') return chosenOutputText(board, group.id)
  const members = membersOf(board, group.id)
  const memberText = members
    .map((member) => {
      const label = contextLabel(board, member)
      const text = groupMemberCompressionText(board, member)
      return label && label !== text.split('\n')[0] ? `${label}\n${text}` : text
    })
    .filter(Boolean)
    .join('\n\n')
  const relationships = groupRelationshipText(board, group, members)
  return [memberText, relationships ? `Relationships in this group:\n${relationships}` : '']
    .filter(Boolean)
    .join('\n\n')
}

export function contextLabel(board: SavedBoard, card: Card): string {
  if (card.title?.trim()) return card.title.trim()
  // Cards whose contribution is their chosen output label themselves with its
  // first line; everything else labels itself with its own text.
  if (contractFor(card.kind).contributes !== 'chosenOutput') return cardLabel(card)

  const text = contextText(board, card)
  if (!text) return cardLabel(card)

  const firstLine = text.split('\n')[0]
  return firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine
}

export type ContextEntryInput = {
  card: Card
  connectionId?: string
  connectionLabel?: string
  relation?: ContextPreviewRelation
  hop?: number
  groupMode?: ConnectionGroupMode
  reason?: string
  strength?: 'strong' | 'weak'
  orderIndex?: number
  budgetStatus?: ContextPreviewBudgetStatus
}

export function contextEntryForCard(board: SavedBoard, input: ContextEntryInput): ContextEntry {
  const { card, connectionId, connectionLabel, relation, hop, groupMode, reason, strength, orderIndex, budgetStatus } =
    input
  if (contractFor(card.kind).contributes === 'groupContent') {
    const members = membersOf(board, card.id)
    const mode = groupMode ?? 'full'
    return {
      cardId: card.id,
      label: contextLabel(board, card),
      text: groupContextText(board, card, mode),
      assets: mode === 'full' ? members.flatMap((member) => member.assets ?? []) : (card.assets ?? []),
      connectionId,
      connectionLabel,
      relation,
      hop,
      groupMode: mode,
      reason,
      memberLabels: members.map((member) => contextLabel(board, member)),
      strength,
      orderIndex,
      budgetStatus,
    }
  }
  return {
    cardId: card.id,
    label: contextLabel(board, card),
    text: contextText(board, card),
    assets: card.assets ?? [],
    connectionId,
    connectionLabel,
    relation,
    hop,
    reason,
    strength,
    orderIndex,
    budgetStatus,
  }
}

export function hasContextEntry(entry: ContextEntry): boolean {
  return Boolean(entry.text || entry.assets.length)
}

export { orderedIncomingConnections } from '../graph/contextQuery'

export function gatherConnectedThought(
  board: SavedBoard,
  askAiCardId: string,
  budgetOpts?: CompileBudgetOptions,
  contextPolicy: ContextPolicy = CONNECTED_THOUGHT_POLICY,
): CompiledInstruction {
  // Which cards feed this one — and why — is the context layer's answer.
  // This module only assembles the selected thought into an instruction.
  const selection = gatherContext(board, askAiCardId, contextPolicy)
  const askCard = cardById(board, askAiCardId)

  const directHelps: Gathered[] = []
  const lightHelps: Gathered[] = []
  const avoidConnections: Gathered[] = []
  const modCards: ModInput[] = []

  for (const [orderIndex, entry] of selection.entries.entries()) {
    const card = cardById(board, entry.cardId)
    if (!card) continue
    const connectionLabel = connectionPreviewLabel(board, card, entry.connectionId, entry.hop)
    if (entry.relation === 'modifies') {
      modCards.push({ card, connectionId: entry.connectionId, connectionLabel, hop: entry.hop })
      continue
    }
    // For budget priority, Avoid entries keep their real connection strength.
    const connection = board.connections.find((candidate) => candidate.id === entry.connectionId)
    const gathered: Gathered = {
      card,
      strength:
        entry.relation === 'feeds-strong' || (entry.relation === 'constrains' && connection?.strength === 'strong')
          ? 'strong'
          : 'weak',
      connectionId: entry.connectionId,
      connectionLabel,
      relation:
        entry.relation === 'constrains'
          ? 'avoid'
          : entry.relation === 'feeds-strong'
            ? 'direct'
            : 'light',
      hop: entry.hop,
      groupMode: entry.groupMode,
      reason: connection?.reason?.trim() || undefined,
      orderIndex,
    }
    if (entry.relation === 'constrains') {
      // Avoid connections are anti-context: they are kept separate from
      // ordinary context and framed as already-explored paths (ADR 0018).
      avoidConnections.push(gathered)
    } else if (entry.relation === 'feeds-strong') {
      directHelps.push(gathered)
    } else {
      lightHelps.push(gathered)
    }
  }

  const modApplications = modCards.flatMap<ModApplication>((input) => {
    if (!isV2ModCard(input.card)) return []
    const context = readModContext(input.card.modV2)
    return [{
      input,
      context,
      appliedMod: {
        modVersion: 2,
        modCardId: input.card.id,
        controlValues: snapshotModValues(input.card.modV2),
        appliedInstructions: [
          context.treatment,
          ...context.sentences.map(({ text }) => text),
        ],
      },
    }]
  })
  const appliedMods = modApplications.map(({ appliedMod }) => appliedMod)
  const modIds = modApplications.map(({ input }) => input.card.id)

  const toEntry = (g: Gathered): ContextEntry =>
    contextEntryForCard(board, {
      card: g.card,
      connectionId: g.connectionId,
      connectionLabel: g.connectionLabel,
      relation: g.relation,
      hop: g.hop,
      groupMode: g.groupMode,
      reason: g.reason,
      strength: g.strength,
      orderIndex: g.orderIndex,
      budgetStatus: 'full',
    })
  const selectedBuildOn = directHelps.map(toEntry)
  const selectedInfluences = lightHelps.map(toEntry)
  const selectedAlreadyExplored = avoidConnections.map(toEntry)
  const buildOn = selectedBuildOn.filter(hasContextEntry)
  const influences = selectedInfluences.filter(hasContextEntry)
  const alreadyExplored = selectedAlreadyExplored.filter(hasContextEntry)
  // The preview is also the compiler-owned projection of the selected wires.
  // Keep silent cards here even though they emit no prompt text: Conversation
  // uses this projection to schedule an empty-role participant, and Context
  // Peek can show that the connected card currently says nothing.
  const selectedContextEntries = [
    ...selectedBuildOn,
    ...selectedInfluences,
    ...selectedAlreadyExplored,
  ]
  const assets = [...buildOn, ...influences, ...alreadyExplored].flatMap((entry) =>
    entry.assets.map((asset) => ({
      ...asset,
      cardId: entry.cardId,
      cardLabel: entry.label,
      connectionId: entry.connectionId,
    })),
  )

  const task = askCard ? cardText(askCard) : ''

  const sections = {
    mods: modApplications.map(({ context }) => context),
    buildOn,
    influences,
    alreadyExplored,
    task,
  }

  const isEmpty =
    buildOn.length === 0 &&
    influences.length === 0 &&
    alreadyExplored.length === 0 &&
    modIds.length === 0

  // Context budget (ADR 0015): plan what to compact or drop, apply the
  // summaries we already have, and report the outcome. Task text, modifiers,
  // approach, and output requirements are the fixed part — never trimmed.
  let budget: RunContextBudget | undefined
  let compactionInputs: Record<string, string> | undefined
  let previewContext: ContextPreviewContextEntry[] = selectedContextEntries.map((entry) =>
    toPreviewContextEntry(entry, 'full'),
  )
  if (budgetOpts) {
    const allEntries = [...sections.buildOn, ...sections.influences, ...sections.alreadyExplored]
    const inputs: BudgetEntryInput[] = allEntries.map((entry) => ({
      cardId: entry.cardId,
      strength: entry.strength ?? 'weak',
      orderIndex: entry.orderIndex ?? 0,
      fullTokens: estimateTokens(contextEntryBullet(entry)),
      compactTokens: estimateTokens(
        contextEntryBullet({
          ...entry,
          text: budgetOpts.summaries.get(entry.cardId) ?? 'x'.repeat(COMPACTION_TARGET_CHARS),
        }),
      ),
    }))
    const fixedTokens = estimateTokens(
      assembleInstruction({ ...sections, buildOn: [], influences: [], alreadyExplored: [] }),
    )
    const plan = planContextBudget(inputs, fixedTokens, budgetOpts.budgetTokens, budgetOpts.mode)

    if (plan.compact.length || plan.drop.length) {
      const budgetStatusFor = (cardId: string): ContextPreviewBudgetStatus => {
        if (plan.drop.includes(cardId)) return 'dropped'
        if (!plan.compact.includes(cardId)) return 'full'
        return budgetOpts.summaries.has(cardId) ? 'compacted' : 'will-compact'
      }
      budget = {
        budgetTokens: plan.budgetTokens,
        estimatedTokens: plan.estimatedTokens,
        finalTokens: plan.finalTokens,
        compactedCardIds: plan.compact,
        droppedCardIds: plan.drop,
        mode: budgetOpts.mode,
      }
      compactionInputs = {}
      for (const entry of allEntries) {
        if (plan.compact.includes(entry.cardId)) compactionInputs[entry.cardId] = entry.text
      }
      previewContext = selectedContextEntries.map((entry) => {
        const budgetStatus = budgetStatusFor(entry.cardId)
        const summary = budgetOpts.summaries.get(entry.cardId)
        return toPreviewContextEntry(
          budgetStatus === 'compacted' && summary
            ? { ...entry, text: summary, compacted: true, budgetStatus }
            : { ...entry, budgetStatus },
          budgetStatus,
        )
      })
      const apply = (list: ContextEntry[]) =>
        list
          .filter((entry) => !plan.drop.includes(entry.cardId))
          .map((entry) =>
            plan.compact.includes(entry.cardId) && budgetOpts.summaries.has(entry.cardId)
              ? {
                  ...entry,
                  text: budgetOpts.summaries.get(entry.cardId)!,
                  compacted: true,
                  budgetStatus: 'compacted' as const,
                }
              : plan.compact.includes(entry.cardId)
                ? { ...entry, budgetStatus: 'will-compact' as const }
                : { ...entry, budgetStatus: 'full' as const },
          )
      sections.buildOn = apply(sections.buildOn)
      sections.influences = apply(sections.influences)
      sections.alreadyExplored = apply(sections.alreadyExplored)
    }
  }

  const text = assembleInstruction(sections)
  const previewMods: ContextPreviewModEntry[] = modApplications.map(({ input, appliedMod, context }) => ({
    modVersion: 2,
    cardId: appliedMod.modCardId,
    label: context.title,
    connectionId: input.connectionId,
    connectionLabel: input.connectionLabel,
    hop: input.hop,
    context,
    markdown: renderModBlockEntry(context),
    appliedInstructions: appliedMod.appliedInstructions,
  }))

  return {
    text,
    // Dropped entries carry no assets either.
    assets: assets.filter((asset) => !budget?.droppedCardIds.includes(asset.cardId)),
    // usedCardIds intentionally keeps compacted AND dropped cards: they are
    // part of what the user connected, so source-change staleness still
    // watches them; what the budget did to them is recorded separately.
    usedCardIds: selection.usedCardIds,
    usedConnectionIds: selection.usedConnectionIds,
    modIds,
    appliedMods,
    sections,
    preview: {
      context: previewContext,
      mods: previewMods,
    },
    isEmpty,
    budget,
    compactionInputs,
  }
}

function toPreviewContextEntry(
  entry: ContextEntry,
  budgetStatus: ContextPreviewBudgetStatus,
): ContextPreviewContextEntry {
  return {
    ...entry,
    connectionId: entry.connectionId ?? '',
    connectionLabel: entry.connectionLabel ?? 'From connected card',
    relation: entry.relation ?? 'light',
    hop: entry.hop ?? 1,
    budgetStatus,
  }
}

function connectionPreviewLabel(board: SavedBoard, source: Card, connectionId: string, hop: number): string {
  const sourceLabel = contextLabel(board, source) || 'Untitled card'
  const connection = board.connections.find((candidate) => candidate.id === connectionId)
  const viaCard = hop > 1 && connection ? cardById(board, connection.to.cardId) : undefined
  const viaLabel = viaCard ? contextLabel(board, viaCard) : ''
  return viaLabel && viaLabel !== sourceLabel ? `From ${sourceLabel} via ${viaLabel}` : `From ${sourceLabel}`
}

export function contextEntryBullet(entry: ContextEntry, opts: { includeReason?: boolean } = {}): string {
  // Keep it readable: lead with the label when it differs from the text.
  const firstLine = entry.text.split('\n')[0]?.trim() ?? ''
  const labelDiffers = entry.label.trim() && entry.label.trim() !== firstLine
  const body = entry.text.trim()
  const assetSuffix = entry.assets.length
    ? ` ${entry.assets.map((asset) => `[${asset.kind}: ${asset.name}]`).join(' ')}`
    : ''
  const line = !body
    ? `- ${entry.label || 'Attached context'}:${assetSuffix}`
    : labelDiffers
    ? `- ${entry.label}: ${body}${assetSuffix}`
    : `- ${body}${assetSuffix}`
  if (!opts.includeReason || !entry.reason) return line
  return `${line}\n  Reason this path died: ${entry.reason}`
}

export function renderAlreadyExploredSection(
  entries: ContextEntry[],
  opts: { heading?: string } = {},
): string | undefined {
  if (!entries.length) return undefined
  return (
    `${opts.heading ?? ALREADY_EXPLORED_HEADING}\n` +
    `${ALREADY_EXPLORED_FRAMING}\n` +
    entries.map((entry) => contextEntryBullet(entry, { includeReason: true })).join('\n')
  )
}

function assembleInstruction(sections: CompiledInstruction['sections']): string {
  const parts: string[] = []

  parts.push('## TASK\n' + (sections.task || '(No task written yet — say what AI should do.)'))

  const modsBlock = renderModsBlock(sections.mods)
  if (modsBlock) parts.push(modsBlock)

  if (sections.buildOn.length) {
    parts.push(
      '## BUILD ON\n' +
        BUILD_ON_FRAMING +
        '\n' +
        sections.buildOn.map((entry) => contextEntryBullet(entry)).join('\n'),
    )
  }

  if (sections.influences.length) {
    parts.push(
      '## INFLUENCES\n' +
        INFLUENCES_FRAMING +
        '\n' +
        sections.influences.map((entry) => contextEntryBullet(entry)).join('\n'),
    )
  }

  const alreadyExplored = renderAlreadyExploredSection(sections.alreadyExplored)
  if (alreadyExplored) parts.push(alreadyExplored)

  return parts.join('\n\n')
}
