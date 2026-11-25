import {
  boardAiSettingsOf,
  DEFAULT_BOARD_AI_PROVIDER,
  DEFAULT_BOARD_AI_REASONING_EFFORT,
} from '../graph/boardAiSettings'
import { cardLabel, cardText, chosenVersion } from '../graph/graphHelpers'
import type { Card, Connection, Output, OutputVersion, SavedBoard } from '../graph/types'
import { readModContext } from '../mods/prompt'
import { stableContentHash } from '../shared/stableHash'
import { followUpDiscussionSection } from './followUpThread'

export const DEFAULT_COMPRESSION_PROMPT =
  'Compress these cards into a short, useful version. Keep the useful distinctions, preserve constraints, and do not add new ideas.'

export function compressionPromptFor(group: Card): string {
  return group.compressionPrompt?.trim() || DEFAULT_COMPRESSION_PROMPT
}

export function groupMemberCompressionText(board: SavedBoard, member: Card): string {
  const parts: string[] = []
  const title = member.title?.trim()
  const text = cardText(member)

  switch (member.kind) {
    case 'note':
      parts.push('Type: Note')
      if (title) parts.push(`Title: ${title}`)
      parts.push(`Text:\n${text || '(empty)'}`)
      break

    case 'askAi':
      parts.push('Type: Ask AI')
      if (title) parts.push(`Title: ${title}`)
      parts.push(`Question or action:\n${text || '(empty)'}`)
      break

    case 'mod':
      parts.push('Type: Mod')
      if (title) parts.push(`Title: ${title}`)
      if (member.modV2) {
        const context = readModContext(member.modV2)
        parts.push(`Mod title: ${context.title}`)
        parts.push(`How to read it: ${context.treatment}`)
        parts.push(
          context.sentences.length
            ? `Statements:\n${context.sentences.map((sentence) => `- ${sentence.text}`).join('\n')}`
            : 'Statements: (none)',
        )
      }
      break

    case 'result': {
      parts.push('Type: Result')
      if (title) parts.push(`Title: ${title}`)
      const output = board.outputs.find((candidate) => candidate.resultCardId === member.id)
      if (output?.versions.length) {
        const chosen = chosenVersion(output)
        parts.push(
          'Output versions:\n' +
            output.versions
              .map((version) => versionText(version, version.id === chosen?.id))
              .join('\n\n'),
        )
      } else {
        parts.push(`Text:\n${text || '(no output yet)'}`)
      }
      break
    }

    case 'group':
      parts.push('Type: Group')
      if (title) parts.push(`Title: ${title}`)
      parts.push(`Text:\n${text || '(empty)'}`)
      break

    case 'title':
      parts.push('Type: Title')
      parts.push(`Text:\n${text || '(empty)'}`)
      break
  }

  return parts.join('\n')
}

export function groupDigestInput(board: SavedBoard, _group: Card, members: Card[]): string {
  return members
    .map((member, index) => {
      const label = digestCardLabel(member)
      const text = groupMemberCompressionText(board, member)
      return `${index + 1}. ${label}\n${text}`
    })
    .join('\n\n')
    .trim()
}

export function buildGroupDigestInstruction(board: SavedBoard, group: Card, members: Card[]): string {
  const input = groupDigestInput(board, group, members) || '(No cards in this group.)'
  const relationships = groupRelationshipText(board, group, members) || '(No direct relationships inside this group.)'
  return (
    `${compressionPromptFor(group)}\n\n` +
    `Group: ${cardLabel(group)}\n\n` +
    `How to read these cards:\n${CARD_TYPE_GUIDE}\n\n` +
    `Cards in this group:\n${input}\n\n` +
    `Relationships in this group:\n${relationships}\n\n` +
    'Return only the compressed version.'
  )
}

export function groupRelationshipText(board: SavedBoard, _group: Card, members: Card[]): string {
  const memberIds = new Set(members.map((member) => member.id))
  return board.connections
    .filter((connection) => memberIds.has(connection.from.cardId) && memberIds.has(connection.to.cardId))
    .map((connection) => `- ${relationshipSentence(board, connection)}`)
    .join('\n')
}

export function groupRelationshipConnectionIds(board: SavedBoard, members: Card[]): string[] {
  const memberIds = new Set(members.map((member) => member.id))
  return board.connections
    .filter((connection) => memberIds.has(connection.from.cardId) && memberIds.has(connection.to.cardId))
    .map((connection) => connection.id)
}

export function groupDigestCacheKey(
  board: SavedBoard,
  group: Card,
  members: Card[],
  model?: string,
): string {
  const assets = members.flatMap((member) => (member.assets ?? []).map((asset) => ({
    kind: asset.kind,
    name: asset.name,
    mimeType: asset.mimeType,
    dataUrl: asset.dataUrl,
  })))
  const payload = {
    // v3 deliberately invalidates the v2 key once: provider identity now joins
    // the exact instruction and provider-facing configuration. A digest made
    // by one provider can never remain current after switching to another.
    version: 3,
    instruction: buildGroupDigestInstruction(board, group, members),
    // Read through the settings envelope (ADR 0040): a value from a build this
    // one has never met reads as this build's documented default, so the digest
    // key stays a hash of what this build would actually send.
    provider: boardAiSettingsOf(board)?.provider ?? DEFAULT_BOARD_AI_PROVIDER,
    model: model ?? group.model ?? '',
    reasoningEffort: boardAiSettingsOf(board)?.reasoningEffort ?? DEFAULT_BOARD_AI_REASONING_EFFORT,
    systemPrompt: boardAiSettingsOf(board)?.systemPrompt ?? '',
    temperature: 0.2,
    assets,
  }
  return `digest:${stableContentHash(payload)}`
}

export function chosenDigestVersion(output: Output | undefined) {
  return chosenVersion(output)
}

export function isDigestCurrent(output: Output | undefined, cacheKey: string): boolean {
  return chosenDigestVersion(output)?.digestKey === cacheKey
}

function versionText(version: OutputVersion, chosen: boolean): string {
  const markers = [chosen ? 'chosen' : '', version.accepted ? 'kept' : ''].filter(Boolean).join(', ')
  const markerText = markers ? ` (${markers})` : ''
  const base = `v${version.number}${markerText}:\n${version.text.trim() || '(empty)'}`
  // The chosen version's follow-up thread is part of what the card says (same
  // seam as downstream context), so the digest — and its cache key — see it too.
  // Threads stay per-version, so only the chosen version's thread travels.
  const discussion = chosen ? followUpDiscussionSection(version.followUpThread?.messages ?? []) : ''
  return discussion ? `${base}\n\n${discussion}` : base
}

const CARD_TYPE_GUIDE = [
  '- Note: source material, facts, observations, or constraints written by the user.',
  '- Ask AI: a question or action the user wants answered; treat it as intent, not as generated output.',
  '- Result: AI-generated output from an earlier run; compress the text itself, especially the chosen version.',
  '- Mod: hand-set guidance. Read its treatment first, then its statements in order.',
  '- Title: a board label. Ignore it unless the user deliberately includes its text.',
  '- Connection: a directed relationship. Strong positive connections are primary support; weak positive connections are secondary support; negative connections are tensions or constraints; Mod connections adjust how the target should be interpreted.',
].join('\n')

function relationshipSentence(board: SavedBoard, connection: Connection): string {
  const from = sentenceLabel(digestCardLabel(board.cards.find((card) => card.id === connection.from.cardId)!))
  const to = sentenceLabel(digestCardLabel(board.cards.find((card) => card.id === connection.to.cardId)!))
  if (connection.role === 'modifies') {
    return `${from} modifies how ${to} should be interpreted.`
  }
  if (connection.polarity === 'pushesAgainst') {
    const weight = connection.strength === 'strong' ? 'strong' : 'light'
    return `${from} creates a ${weight} constraint or tension for ${to}.`
  }
  const weight = connection.strength === 'strong' ? 'primary' : 'secondary'
  return `${from} supports ${to} as ${weight} context.`
}

function digestCardLabel(card: Card): string {
  if (card.kind === 'mod' && card.modV2?.title.trim()) return card.modV2.title.trim()
  return cardLabel(card)
}

function sentenceLabel(label: string): string {
  return label.trim().replace(/[.!?]+$/, '')
}
