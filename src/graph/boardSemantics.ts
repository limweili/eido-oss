import { writeTextToClipboard, type ClipboardTextWriter } from '../shared/clipboardText'
import { readModContext } from '../mods'
import { noteLinkPreviews } from '../shared/linkPreview'
import { cardKindLabels } from '../shared/words'
import {
  creatorKindMatchesFilter,
  effectiveCardCreatorKind,
  type CardCreatorFilter,
} from './cardAuthorship'
import { cardLabel, chosenVersion } from './graphHelpers'
import { graphIndexForBoard, type GraphIndexBoard } from './graphIndex'
import type { Card, Connection, Output, OutputVersion, RunRecord } from './types'

export type SemanticBoard = GraphIndexBoard

export type BoardSearchResult = {
  cardId: string
  label: string
  excerpt: string
}

type SemanticCard = BoardSearchResult & {
  text: string
  visibleBody: string
  creator: ReturnType<typeof effectiveCardCreatorKind>
}
export type BoardSearchIndex = { entries: readonly SemanticCard[] }

function modSemanticLines(card: Card): string[] {
  if (!card.modV2) return []
  const context = readModContext(card.modV2)
  return [context.title, context.treatment, ...context.sentences.map((sentence) => sentence.text)]
}

function versionSemanticLines(version: OutputVersion): string[] {
  return [
    `Version ${version.number}`,
    version.text,
    version.provisionalMessage,
    ...(version.transcript ?? []).flatMap((message) => [message.speakerName, message.text]),
    ...(version.followUpThread?.messages ?? []).flatMap((message) => [message.role, message.text]),
  ].filter((line): line is string => Boolean(line?.trim()))
}

function outputSemanticLines(output: Output | undefined): string[] {
  return output ? output.versions.flatMap(versionSemanticLines) : []
}

function linkPreviewSemanticLines(card: Card): string[] {
  return noteLinkPreviews(card)
    .flatMap((preview) => [preview.title, preview.description, preview.siteName])
    .filter((line): line is string => Boolean(line?.trim()))
}

function cardSemanticLines(card: Card, output: Output | undefined): string[] {
  return [
    card.title,
    ...card.blocks.map((block) => block.text),
    ...linkPreviewSemanticLines(card),
    ...((card.assets ?? []).flatMap((asset) => [asset.name, asset.mimeType])),
    card.compressionPrompt,
    ...modSemanticLines(card),
    card.kind === 'conversation' ? card.conversationStyle : undefined,
    card.kind === 'conversation' && card.conversationTurns != null
      ? `${card.conversationTurns} turns`
      : undefined,
    ...outputSemanticLines(output),
  ].filter((line): line is string => Boolean(line?.trim()))
}

function runSemanticLines(run: RunRecord): string[] {
  return [
    run.compiledInstruction,
    run.errorMessage,
    ...run.appliedMods.flatMap((mod) => mod.appliedInstructions),
    ...(run.conversation ? [
      run.conversation.settings.topic,
      run.conversation.settings.style,
      String(run.conversation.settings.turnsPerParticipant),
    ] : []),
    ...(run.conversation?.participants.flatMap((participant) => [
      participant.name,
      participant.model,
      participant.role,
      ...(participant.participantMods?.flatMap((mod) => [mod.label, ...mod.instructions]) ?? []),
    ]) ?? []),
    ...(run.conversation?.sharedContext.flatMap((context) => [context.label, context.text]) ?? []),
    ...(run.conversation?.topLevelMods.flatMap((mod) => [mod.label, ...mod.instructions]) ?? []),
    ...(run.conversation?.turns.flatMap((turn) => [turn.speakerName, turn.instruction]) ?? []),
  ].filter((line): line is string => Boolean(line?.trim()))
}

function connectionSemanticLine(connection: Connection, cardById: (id: string) => Card | undefined): string {
  const from = cardById(connection.from.cardId)
  const to = cardById(connection.to.cardId)
  const polarity = connection.polarity === 'helps' ? 'Helps' : 'Avoid'
  const strength = connection.strength === 'strong' ? 'Direct' : 'Light'
  return [
    from ? cardLabel(from) : connection.from.cardId,
    'to',
    to ? cardLabel(to) : connection.to.cardId,
    polarity,
    strength,
    connection.reason,
  ].filter(Boolean).join(' · ')
}

function searchResultLabel(card: Card): string {
  if (card.title?.trim()) return card.title.trim()
  if (card.kind === 'mod' && card.modV2?.title.trim()) return card.modV2.title.trim()
  return cardLabel({ ...card, blocks: [] })
}

function visibleCardBody(card: Card, output: Output | undefined, isConversationResult: boolean): string {
  if (card.kind === 'result') {
    const chosen = chosenVersion(output)
    if (!chosen) return ''
    if (isConversationResult) {
      const transcriptText = (chosen.transcript ?? [])
        .map((message) => message.text.trim())
        .filter(Boolean)
        .join('\n')
      return transcriptText || chosen.text.trim()
    }
    return [
      chosen.text,
      ...(chosen.followUpThread?.messages.map((message) => message.text) ?? []),
    ].map((line) => line.trim()).filter(Boolean).join('\n')
  }
  const blockText = card.blocks.map((block) => block.text.trim()).filter(Boolean).join('\n').trim()
  if (blockText) return blockText
  const linkPreviewText = linkPreviewSemanticLines(card).join('\n')
  if (linkPreviewText) return linkPreviewText
  if (card.kind === 'mod') return modSemanticLines(card).join('\n')
  return ''
}

function semanticCards(board: SemanticBoard): SemanticCard[] {
  const index = graphIndexForBoard(board)
  const connectionLinesByCardId = new Map<string, string[]>()
  for (const connection of board.connections) {
    const line = connectionSemanticLine(connection, index.cardById)
    for (const cardId of new Set([connection.from.cardId, connection.to.cardId])) {
      const lines = connectionLinesByCardId.get(cardId)
      if (lines) lines.push(line)
      else connectionLinesByCardId.set(cardId, [line])
    }
  }

  return board.cards.map((card) => {
    const output = index.outputForResultCard(card.id)
    const isConversationResult = card.kind === 'result' && (
      Boolean(output?.versions.some((version) => version.transcript)) ||
      index.incomingConnections(card.id).some((connection) => (
        index.cardById(connection.from.cardId)?.kind === 'conversation'
      ))
    )
    const searchableLabel = cardLabel(card)
    const text = [
      searchableLabel,
      ...cardSemanticLines(card, output),
      ...(connectionLinesByCardId.get(card.id) ?? []),
      ...index.runsForCard(card.id).flatMap(runSemanticLines),
    ].join('\n')
    return {
      cardId: card.id,
      label: searchResultLabel(card),
      excerpt: '',
      text,
      visibleBody: visibleCardBody(card, output, isConversationResult),
      creator: effectiveCardCreatorKind(card),
    }
  })
}

function excerptFor(text: string, tokens: readonly string[]): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  const firstMatch = tokens.length ? compact.toLocaleLowerCase().indexOf(tokens[0]) : 0
  const start = Math.max(0, firstMatch - 48)
  const excerpt = compact.slice(start, start + 168)
  return `${start > 0 ? '…' : ''}${excerpt}${start + excerpt.length < compact.length ? '…' : ''}`
}

// The complete result model is graph-derived and stable in immutable saved
// order. UI consumers may expose a bounded window without weakening membership.
export function searchBoardContent(
  board: SemanticBoard,
  query: string,
  creator: CardCreatorFilter = 'all',
): BoardSearchResult[] {
  return searchBoardIndex(createBoardSearchIndex(board), query, creator)
}

export function createBoardSearchIndex(board: SemanticBoard): BoardSearchIndex {
  return { entries: semanticCards(board) }
}

export function searchBoardIndex(
  index: BoardSearchIndex,
  query: string,
  creator: CardCreatorFilter = 'all',
): BoardSearchResult[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return index.entries.flatMap((entry) => {
    if (!creatorKindMatchesFilter(entry.creator, creator)) return []
    const normalized = entry.text.toLocaleLowerCase()
    if (!tokens.every((token) => normalized.includes(token))) return []
    return [{
      cardId: entry.cardId,
      label: entry.label,
      excerpt: excerptFor(entry.visibleBody, tokens),
    }]
  })
}

function serializeVersion(version: OutputVersion, chosenVersionId: string | undefined): string[] {
  const heading = `### Version ${version.number}${version.id === chosenVersionId ? ' · Chosen' : ''}`
  const transcript = (version.transcript ?? []).flatMap((message) => [
    `${message.speakerName}:`,
    message.text,
  ])
  const followUp = (version.followUpThread?.messages ?? []).flatMap((message) => [
    `${message.role === 'user' ? 'You' : 'AI'}:`,
    message.text,
  ])
  return [
    heading,
    version.text,
    ...(transcript.length ? ['#### Transcript', ...transcript] : []),
    ...(followUp.length ? ['#### Follow-up', ...followUp] : []),
  ].filter((line) => Boolean(line.trim()))
}

function serializeRun(run: RunRecord, number: number): string[] {
  const lines = [
    `#### Run ${number} · ${run.status}`,
    `Model: ${run.model}`,
    'Instruction sent:',
    run.compiledInstruction,
  ]
  if (run.errorMessage?.trim()) lines.push('Error:', run.errorMessage)
  const appliedInstructions = run.appliedMods.flatMap((mod) => mod.appliedInstructions)
  if (appliedInstructions.length) lines.push('Guidance applied:', ...appliedInstructions)
  if (run.conversation) {
    lines.push(
      'Conversation settings:',
      `Topic: ${run.conversation.settings.topic}`,
      `Style: ${run.conversation.settings.style}`,
      `Turns each: ${run.conversation.settings.turnsPerParticipant}`,
    )
    lines.push('Conversation participants:')
    for (const participant of run.conversation.participants) {
      lines.push(`${participant.name} · ${participant.model}: ${participant.role}`)
      for (const mod of participant.participantMods ?? []) {
        lines.push(`${mod.label}:`, ...mod.instructions)
      }
    }
    if (run.conversation.sharedContext.length) {
      lines.push('Shared context:')
      for (const context of run.conversation.sharedContext) lines.push(`${context.label}: ${context.text}`)
    }
    if (run.conversation.topLevelMods.length) {
      lines.push('Conversation guidance:')
      for (const mod of run.conversation.topLevelMods) lines.push(mod.label, ...mod.instructions)
    }
    if (run.conversation.turns.length) {
      lines.push('Turn instructions:')
      for (const turn of run.conversation.turns) lines.push(`${turn.speakerName}: ${turn.instruction}`)
    }
  }
  return lines.filter((line) => Boolean(line.trim()))
}

function serializeCard(card: Card, output: Output | undefined, runs: readonly RunRecord[]): string[] {
  const lines = [`## ${cardLabel(card)}`, `Kind: ${cardKindLabels[card.kind]}`]
  if (card.title?.trim()) lines.push('', card.title.trim())
  for (const block of card.blocks) {
    if (block.text.trim()) lines.push('', block.text)
  }
  const linkPreviewLines = linkPreviewSemanticLines(card)
  if (linkPreviewLines.length) lines.push('', '### Website preview', ...linkPreviewLines)
  if (card.compressionPrompt?.trim()) lines.push('', 'Compress prompt:', card.compressionPrompt)
  if (card.kind === 'conversation') {
    if (card.conversationStyle) lines.push('', `Style: ${card.conversationStyle}`)
    if (card.conversationTurns != null) lines.push(`Turns each: ${card.conversationTurns}`)
  }
  if (card.modV2) {
    const context = readModContext(card.modV2)
    lines.push('', '### Mod', context.title, `How to read it: ${context.treatment}`)
    for (const sentence of context.sentences) lines.push(`- ${sentence.text}`)
  }
  if (card.assets?.length) {
    lines.push('', '### Attachments')
    for (const asset of card.assets) lines.push(`- ${asset.name} · ${asset.mimeType}`)
  }
  if (output?.versions.length) {
    lines.push('', '### Saved result versions')
    for (const version of output.versions) lines.push('', ...serializeVersion(version, output.chosenVersionId))
  }
  if (runs.length) {
    lines.push('', '### Run history')
    runs.forEach((run, index) => lines.push('', ...serializeRun(run, index + 1)))
  }
  return lines
}

export function serializeBoardSelection(board: SemanticBoard, cardIds: readonly string[]): string {
  const selectedIds = new Set(cardIds)
  const selectedCards = board.cards.filter((card) => selectedIds.has(card.id))
  if (!selectedCards.length) return ''
  const index = graphIndexForBoard(board)
  const lines = ['# Board']
  for (const card of selectedCards) {
    lines.push('', ...serializeCard(card, index.outputForResultCard(card.id), index.runsForCard(card.id)))
  }

  const connections = index.connectionsAmong(selectedIds)
  if (connections.length) {
    lines.push('', '## Connections')
    for (const connection of connections) {
      lines.push(`- ${connectionSemanticLine(connection, index.cardById)}`)
    }
  }
  return lines.join('\n').trim()
}

export async function copyBoardSelection({
  board,
  cardIds,
  writeText = writeTextToClipboard,
}: {
  board: SemanticBoard
  cardIds: readonly string[]
  writeText?: ClipboardTextWriter
}): Promise<boolean> {
  const text = serializeBoardSelection(board, cardIds)
  return text ? writeText(text) : false
}
