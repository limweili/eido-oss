import type { Card, Connection } from './types'
import { cardFootprint } from './cardOrganization'

export const AGENT_SPATIAL_READ_LIMITS = Object.freeze({
  defaultNeighbors: 25,
  maxNeighbors: 100,
  defaultBytes: 32 * 1024,
  maxBytes: 128 * 1024,
  minBytes: 256,
  maxBoundingCardIds: 100,
})

export type AgentCardNeighborItem = Readonly<{
  cardId: string
  kind: Card['kind']
  position: Readonly<{ x: number; y: number }>
  size: Readonly<{ width: number; height: number }>
  connection: Readonly<{
    id: string
    direction: 'incoming' | 'outgoing'
    strength: Connection['strength']
    polarity: Connection['polarity']
    role: Connection['role']
    reason?: string
    groupMode?: NonNullable<Connection['meta']>['groupMode']
  }>
}>

export type AgentCardNeighborsResult =
  | Readonly<{
      ok: true
      items: readonly AgentCardNeighborItem[]
      truncated: boolean
    }>
  | Readonly<{ ok: false; reason: 'invalid' }>
  | Readonly<{ ok: false; reason: 'card-not-found'; cardId: string }>

export type AgentCardSetBoundsResult =
  | Readonly<{
      ok: true
      cardIds: readonly string[]
      cards: readonly AgentCardBoundsItem[]
      bounds: Readonly<{ x: number; y: number; width: number; height: number }>
    }>
  | Readonly<{ ok: false; reason: 'invalid' }>
  | Readonly<{ ok: false; reason: 'card-not-found'; cardId: string }>

export type AgentCardBoundsItem = Readonly<{
  cardId: string
  kind: Card['kind']
  position: Readonly<{ x: number; y: number }>
  size: Readonly<{ width: number; height: number }>
}>

export function readAgentCardNeighbors(
  graph: Readonly<{
    cards: readonly Card[]
    connections: readonly Connection[]
  }>,
  request: Readonly<{
    cardId: string
    limit?: number
    byteLimit?: number
  }>,
): AgentCardNeighborsResult {
  const limit = request.limit ?? AGENT_SPATIAL_READ_LIMITS.defaultNeighbors
  const byteLimit = request.byteLimit ?? AGENT_SPATIAL_READ_LIMITS.defaultBytes
  if (!nonEmptyString(request.cardId)
    || !positiveSafeInteger(limit)
    || limit > AGENT_SPATIAL_READ_LIMITS.maxNeighbors
    || !positiveSafeInteger(byteLimit)
    || byteLimit < AGENT_SPATIAL_READ_LIMITS.minBytes
    || byteLimit > AGENT_SPATIAL_READ_LIMITS.maxBytes) {
    return Object.freeze({ ok: false, reason: 'invalid' })
  }
  const cardsById = new Map(graph.cards.map((card) => [card.id, card] as const))
  if (!cardsById.has(request.cardId)) {
    return Object.freeze({
      ok: false,
      reason: 'card-not-found',
      cardId: request.cardId,
    })
  }

  const candidates = graph.connections
    .flatMap((connection): AgentCardNeighborItem[] => {
      const outgoing = connection.from.cardId === request.cardId
      const incoming = connection.to.cardId === request.cardId
      if (!outgoing && !incoming) return []
      const cardId = outgoing ? connection.to.cardId : connection.from.cardId
      const card = cardsById.get(cardId)
      if (!card || cardId === request.cardId) return []
      const size = cardFootprint(card)
      return [Object.freeze({
        cardId,
        kind: card.kind,
        position: Object.freeze({ ...card.position }),
        size: Object.freeze(size),
        connection: Object.freeze({
          id: connection.id,
          direction: outgoing ? 'outgoing' as const : 'incoming' as const,
          strength: connection.strength,
          polarity: connection.polarity,
          role: connection.role,
          ...(connection.reason === undefined ? {} : { reason: connection.reason }),
          ...(connection.meta?.groupMode === undefined
            ? {}
            : { groupMode: connection.meta.groupMode }),
        }),
      })]
    })
    .sort((left, right) => (
      compareStrings(left.connection.id, right.connection.id)
      || compareStrings(left.cardId, right.cardId)
    ))

  const items: AgentCardNeighborItem[] = []
  let encodedBytes = 2
  for (const candidate of candidates) {
    if (items.length >= limit) break
    const candidateBytes = utf8Bytes(JSON.stringify(candidate)) + (items.length === 0 ? 0 : 1)
    if (encodedBytes + candidateBytes > byteLimit) break
    items.push(candidate)
    encodedBytes += candidateBytes
  }
  return Object.freeze({
    ok: true,
    items: Object.freeze(items),
    truncated: items.length < candidates.length,
  })
}

export function agentCardSetBounds(
  cards: readonly Card[],
  requestedCardIds: readonly string[],
): AgentCardSetBoundsResult {
  if (!Array.isArray(requestedCardIds)
    || requestedCardIds.length === 0
    || requestedCardIds.length > AGENT_SPATIAL_READ_LIMITS.maxBoundingCardIds
    || requestedCardIds.some((id) => !nonEmptyString(id))) {
    return Object.freeze({ ok: false, reason: 'invalid' })
  }
  const cardIds = [...new Set(requestedCardIds)].sort(compareStrings)
  const cardsById = new Map(cards.map((card) => [card.id, card] as const))
  for (const cardId of cardIds) {
    if (!cardsById.has(cardId)) {
      return Object.freeze({ ok: false, reason: 'card-not-found', cardId })
    }
  }
  const resolvedCards = cardIds.map((cardId): AgentCardBoundsItem => {
    const card = cardsById.get(cardId)!
    return Object.freeze({
      cardId,
      kind: card.kind,
      position: Object.freeze({ ...card.position }),
      size: Object.freeze(cardFootprint(card)),
    })
  })
  const rects = resolvedCards.map((card) => Object.freeze({
    ...card.position,
    ...card.size,
  }))
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return Object.freeze({
    ok: true,
    cardIds: Object.freeze(cardIds),
    cards: Object.freeze(resolvedCards),
    bounds: Object.freeze({ x, y, width: right - x, height: bottom - y }),
  })
}

function nonEmptyString(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0
}

function positiveSafeInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && (candidate as number) > 0
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
