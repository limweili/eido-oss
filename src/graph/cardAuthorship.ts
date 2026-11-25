import type { ActorKind, Card, CardAuthorship } from './types'

export const CARD_AUTHORSHIP_TEXT_LIMIT = 256
export const CARD_CREATOR_KINDS = Object.freeze(['agent', 'user'] as const)
export type CardCreatorKind = (typeof CARD_CREATOR_KINDS)[number]
export type CardCreatorFilter = 'all' | CardCreatorKind

export function isCardAuthorship(value: unknown): value is CardAuthorship {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate)
  return keys.length === 3
    && keys.includes('kind')
    && keys.includes('client')
    && keys.includes('sessionId')
    && (candidate.kind === 'user' || candidate.kind === 'agent' || candidate.kind === 'system')
    && boundedText(candidate.client)
    && boundedText(candidate.sessionId)
}

export function effectiveCardCreatorKind(card: Pick<Card, 'createdBy'>): ActorKind {
  return card.createdBy?.kind ?? 'user'
}

export function cardMatchesCreatorFilter(
  card: Pick<Card, 'createdBy'>,
  creator: CardCreatorFilter,
): boolean {
  return creatorKindMatchesFilter(effectiveCardCreatorKind(card), creator)
}

export function creatorKindMatchesFilter(
  creatorKind: ActorKind,
  creator: CardCreatorFilter,
): boolean {
  return creator === 'all' || creatorKind === creator
}

export function isAgentUnadoptedCard(
  card: Pick<Card, 'createdBy' | 'lastModifiedBy'>,
): boolean {
  return card.createdBy?.kind === 'agent' && card.lastModifiedBy?.kind !== 'user'
}

function boundedText(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= CARD_AUTHORSHIP_TEXT_LIMIT
}
