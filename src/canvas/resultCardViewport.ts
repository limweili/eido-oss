import type { Card } from '../graph/types'
import { defaultCardFootprint } from '../graph/cardOrganization'

export const RESULT_VIEWPORT_BOTTOM_BUFFER_PX = 30
const MIN_RESULT_CARD_HEIGHT = 120
const EMPTY_RESULT_CARD_HEIGHTS = new Map<string, number>()
export const CARD_GROWTH_BUFFER_PX = 20

type CardSize = { width: number; height: number }

function cardSize(card: Card, measuredCardSizesById?: ReadonlyMap<string, CardSize>) {
  const measured = measuredCardSizesById?.get(card.id)
  const fallback = defaultCardFootprint(card.kind)
  return {
    width: card.size?.width ?? measured?.width ?? fallback.width,
    height: card.size?.height ?? measured?.height ?? fallback.height,
  }
}

export function cardGrowthMaxHeight({
  card,
  cards,
  viewport,
  viewportSize,
  measuredCardSizesById,
}: {
  card: Card
  cards: readonly Card[]
  viewport: { x: number; y: number; zoom: number }
  viewportSize: { width: number; height: number }
  measuredCardSizesById?: ReadonlyMap<string, CardSize>
}) {
  if (card.size?.height) return undefined
  const zoom = Math.max(0.01, viewport.zoom)
  const screenTop = card.position.y * zoom + viewport.y
  const viewportAllowance =
    Number.isFinite(viewportSize.height) && viewportSize.height > 0
      ? (viewportSize.height - RESULT_VIEWPORT_BOTTOM_BUFFER_PX - screenTop) / zoom
      : Number.POSITIVE_INFINITY

  const size = cardSize(card, measuredCardSizesById)
  const right = card.position.x + size.width
  let blockerAllowance = Number.POSITIVE_INFINITY
  for (const candidate of cards) {
    if (candidate.id === card.id || candidate.position.y <= card.position.y) continue
    const candidateSize = cardSize(candidate, measuredCardSizesById)
    const overlapsHorizontally =
      card.position.x < candidate.position.x + candidateSize.width && right > candidate.position.x
    if (!overlapsHorizontally) continue
    blockerAllowance = Math.min(
      blockerAllowance,
      candidate.position.y - card.position.y - CARD_GROWTH_BUFFER_PX,
    )
  }

  return Math.max(MIN_RESULT_CARD_HEIGHT, Math.min(viewportAllowance, blockerAllowance))
}

export function cardGrowthMaxHeights({
  cards,
  viewport,
  viewportSize,
  measuredCardSizesById,
  establishedHeights = EMPTY_RESULT_CARD_HEIGHTS,
}: {
  cards: readonly Card[]
  viewport: { x: number; y: number; zoom: number }
  viewportSize: { width: number; height: number }
  measuredCardSizesById?: ReadonlyMap<string, CardSize>
  establishedHeights?: ReadonlyMap<string, number>
}) {
  let addedHeights: Map<string, number> | undefined
  for (const card of cards) {
    if (establishedHeights.has(card.id)) continue
    const height = cardGrowthMaxHeight({
      card,
      cards,
      viewport,
      viewportSize,
      measuredCardSizesById,
    })
    if (height === undefined) continue
    addedHeights ??= new Map(establishedHeights)
    addedHeights.set(card.id, height)
  }
  return addedHeights ?? establishedHeights
}

export function resultCardViewportMaxHeight({
  card,
  viewport,
  viewportSize,
}: {
  card: Card
  viewport: { x: number; y: number; zoom: number }
  viewportSize: { width: number; height: number }
}) {
  // Compatibility wrapper while Board migrates to the all-card growth planner.
  if (card.kind !== 'result' || card.size?.height) return undefined
  if (!Number.isFinite(viewportSize.height) || viewportSize.height <= 0) return undefined
  return cardGrowthMaxHeight({ card, cards: [card], viewport, viewportSize })
}

export function resultCardViewportMaxHeights(
  cards: readonly Card[],
  viewport: { x: number; y: number; zoom: number },
  viewportSize: { width: number; height: number },
  establishedHeights: ReadonlyMap<string, number> = EMPTY_RESULT_CARD_HEIGHTS,
) {
  let addedHeights: Map<string, number> | undefined
  for (const card of cards) {
    if (establishedHeights.has(card.id)) continue
    const height = resultCardViewportMaxHeight({ card, viewport, viewportSize })
    if (height === undefined) continue
    addedHeights ??= new Map(establishedHeights)
    addedHeights.set(card.id, height)
  }
  return addedHeights ?? establishedHeights
}
