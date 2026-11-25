// Chains flow through visible Result cards (CONTEXT.md: a chain exists only
// where a result card is another Ask's input). This module owns that shape:
// every question exposes exactly one Result card, and anything that would wire
// a question straight into another question routes through it instead.

import { newId } from '../shared/ids'
import { routesThroughResult } from './contextContracts'
import { resultCardFor } from './graphHelpers'
import { findResultCardPosition, type ResultPlacementContext } from './resultCardPlacement'
import type { Card, Connection, SavedBoard } from './types'

export type EnsuredResult = {
  resultCard: Card
  createdCard?: Card
  createdConnection?: Connection
}

// A default connection: strong · helps · feeds.
export function feedsConnection(fromCardId: string, toCardId: string): Connection {
  return {
    id: newId('conn'),
    from: { cardId: fromCardId },
    to: { cardId: toCardId },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  }
}

// The Result card a card feeds. When it has none yet, returns a new one
// placed in its nearest buffered empty space plus the card→result connection;
// the caller commits both.
export function ensureResultCardFor(
  cards: Card[],
  connections: Connection[],
  sourceCardId: string,
  placementContext?: ResultPlacementContext,
): EnsuredResult {
  const existing = resultCardFor({ cards, connections }, sourceCardId)
  if (existing) return { resultCard: existing }
  const source = cards.find((c) => c.id === sourceCardId)
  const position = source ? findResultCardPosition(cards, source, placementContext) : { x: 0, y: 0 }
  const resultCard: Card = {
    id: newId('result'),
    kind: 'result',
    blocks: [{ id: newId('blk'), text: '' }],
    position,
  }
  return {
    resultCard,
    createdCard: resultCard,
    createdConnection: feedsConnection(sourceCardId, resultCard.id),
  }
}

// Older boards could store a question wired straight into another question;
// that connection never carried an answer, so the chain ran hollow. Reroute
// each one through the upstream question's Result card on load. Returns the
// same board object when there is nothing to repair.
export function repairAskToAskConnections(board: SavedBoard): SavedBoard {
  const kindById = new Map(board.cards.map((c) => [c.id, c.kind]))
  const routesVia = (cardId: string) => {
    const kind = kindById.get(cardId)
    return kind ? routesThroughResult(kind) : false
  }
  const legacy = board.connections.filter(
    (c) => c.role === 'feeds' && routesVia(c.from.cardId) && routesVia(c.to.cardId),
  )
  if (!legacy.length) return board

  const legacyIds = new Set(legacy.map((c) => c.id))
  let cards = board.cards
  let connections = board.connections.filter((c) => !legacyIds.has(c.id))
  for (const old of legacy) {
    const ensured = ensureResultCardFor(cards, connections, old.from.cardId)
    if (ensured.createdCard) cards = [...cards, ensured.createdCard]
    if (ensured.createdConnection) connections = [...connections, ensured.createdConnection]
    const alreadyRouted = connections.some(
      (c) =>
        c.role === 'feeds' &&
        c.from.cardId === ensured.resultCard.id &&
        c.to.cardId === old.to.cardId,
    )
    // Rerouting keeps the old connection id so run records that reference it
    // still resolve; a legacy connection made redundant by an existing routed
    // one is dropped.
    if (!alreadyRouted) {
      connections = [...connections, { ...old, from: { cardId: ensured.resultCard.id } }]
    }
  }
  return { ...board, cards, connections }
}
