import type { Card } from './types'
import { storedLayer } from './cardOrganization'
export {
  canJoinGroup,
  cardFootprint,
  cardFootprint as cardSize,
  reconcileGroupMembership,
  storedLayer,
} from './cardOrganization'

function cascadedPosition(
  cards: readonly Card[],
  base: { x: number; y: number },
): Card['position'] {
  let attempt = 0
  let position = base
  while (
    attempt < 48
    && cards.some(
      (card) => Math.abs(card.position.x - position.x) < 20
        && Math.abs(card.position.y - position.y) < 20,
    )
  ) {
    attempt += 1
    position = {
      x: base.x + (attempt % 6) * 34,
      y: base.y + Math.floor(attempt / 6) * 34,
    }
  }
  return position
}

export function orderedByLayer(cards: readonly Card[]): Card[] {
  return [...cards]
    .map((card, index) => ({ card, index }))
    .sort((a, b) => storedLayer(a.card, a.index) - storedLayer(b.card, b.index) || a.index - b.index)
    .map(({ card }) => card)
}

export function maxLayer(cards: readonly Card[]): number {
  return cards.reduce((max, card, index) => Math.max(max, storedLayer(card, index)), -1)
}

/**
 * Applies the transport-neutral pre-commit creation rules shared by GUI and
 * Agent callers: collision cascade and legacy-aware top layering. Callers then
 * pass the appended Card list through reconcileGroupMembership at their own
 * mutation seam, preserving the established ordering between event capture and
 * geometric group reconciliation in stored graph state.
 */
export function placeCreatedCard(
  cards: readonly Card[],
  candidate: Card,
): Card {
  return {
    ...candidate,
    position: cascadedPosition(cards, candidate.position),
    zIndex: maxLayer(cards) + 1,
  }
}
