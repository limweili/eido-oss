export const PASSIVE_CARD_PRELOAD_MARGIN_PX = 900
export const PASSIVE_CARD_RETENTION_MARGIN_PX = 1_350
export const PASSIVE_CARD_LOOK_AHEAD_PX = 900
export const PASSIVE_CARD_LOOK_AHEAD_MARGIN_PX = 450
export const PASSIVE_CARD_LIMIT = 540
export const PASSIVE_CARD_TEXT_WEIGHT_LIMIT = 600_000
export const OVERSIZE_PASSIVE_CARD_TEXT_WEIGHT_THRESHOLD = 100_000
export const OVERSIZE_PASSIVE_CARD_LIMIT = 10

export type ResidencyViewport = { x: number; y: number; zoom: number }

export function residencyViewportMoving(
  viewport?: ResidencyViewport,
  previousViewport?: ResidencyViewport | null,
): boolean {
  return Boolean(
    viewport && previousViewport &&
      (viewport.x !== previousViewport.x || viewport.y !== previousViewport.y || viewport.zoom !== previousViewport.zoom),
  )
}

export function residencyLookAheadViewport(
  viewport: ResidencyViewport,
  previousViewport?: ResidencyViewport | null,
): ResidencyViewport {
  if (!previousViewport) return viewport
  const dx = viewport.x - previousViewport.x
  const dy = viewport.y - previousViewport.y
  const distance = Math.hypot(dx, dy)
  if (distance === 0) return viewport
  return {
    x: viewport.x + (dx / distance) * PASSIVE_CARD_LOOK_AHEAD_PX,
    y: viewport.y + (dy / distance) * PASSIVE_CARD_LOOK_AHEAD_PX,
    zoom: viewport.zoom,
  }
}

/**
 * Production passive Card residency decision. The caller supplies spatially
 * queried memberships and the graph-derived Card weights. This is a stable
 * ordered-subsequence plan, not an optimizing packing problem: exact-visible
 * Cards lead, then moving look-ahead, preload and retained Cards. Previous
 * residents lead WITHIN a tier so small viewport changes keep the budget
 * boundary still without ever outranking a newly visible Card. A Card that
 * exceeds the remaining text-weight budget stays painter-owned while later
 * ordered candidates remain eligible. Exact-visible Cards whose individual
 * weight exceeds the oversize threshold may occupy up to ten separately
 * accounted Passive slots; they are never admitted from look-ahead, preload,
 * or retention.
 * The Card-count ceiling remains terminal.
 * Canvas safety coverage and hot Live/gesture ownership stay with their
 * existing downstream owners.
 */
export function planPassiveCardResidency({
  visibleCardIds,
  preloadCardIds,
  lookAheadCardIds = [],
  cardWeightById,
  viewport,
  previousViewport,
  previousPassiveCardIds,
  retentionCardIds = preloadCardIds,
  passiveCardLimit = PASSIVE_CARD_LIMIT,
  passiveCardTextWeightLimit = PASSIVE_CARD_TEXT_WEIGHT_LIMIT,
}: {
  visibleCardIds: readonly string[]
  preloadCardIds: readonly string[]
  lookAheadCardIds?: readonly string[]
  cardWeightById: ReadonlyMap<string, number>
  viewport?: ResidencyViewport
  previousViewport?: ResidencyViewport | null
  previousPassiveCardIds?: ReadonlySet<string>
  retentionCardIds?: readonly string[]
  passiveCardLimit?: number
  passiveCardTextWeightLimit?: number
}): {
  passiveCardIds: ReadonlySet<string>
  admittedTextWeight: number
  oversizePassiveCardIds: ReadonlySet<string>
  oversizePassiveTextWeight: number
} {
  const passiveCardIds = new Set<string>()
  const oversizePassiveCardIds = new Set<string>()
  const consideredCardIds = new Set<string>()
  let admittedTextWeight = 0
  let oversizePassiveTextWeight = 0
  const plan = () => ({
    passiveCardIds,
    admittedTextWeight,
    oversizePassiveCardIds,
    oversizePassiveTextWeight,
  })
  // False means the count ceiling is exhausted; a weight rejection skips only
  // that Card and leaves the ordered plan open for later, cheaper candidates.
  const consider = (cardId: string, allowOversize: boolean): boolean => {
    if (consideredCardIds.has(cardId)) return true
    consideredCardIds.add(cardId)
    if (passiveCardIds.size >= passiveCardLimit) return false
    const recordedWeight = cardWeightById.get(cardId) ?? 0
    if (!Number.isFinite(recordedWeight)) return true
    const cardWeight = Math.max(0, recordedWeight)
    if (cardWeight > OVERSIZE_PASSIVE_CARD_TEXT_WEIGHT_THRESHOLD) {
      if (allowOversize && oversizePassiveCardIds.size < OVERSIZE_PASSIVE_CARD_LIMIT) {
        passiveCardIds.add(cardId)
        oversizePassiveCardIds.add(cardId)
        oversizePassiveTextWeight += cardWeight
      }
      return true
    }
    if (admittedTextWeight + cardWeight > passiveCardTextWeightLimit) return true
    passiveCardIds.add(cardId)
    admittedTextWeight += cardWeight
    return true
  }
  const admitTier = (cardIds: readonly string[], allowOversize = false): boolean => {
    if (previousPassiveCardIds?.size) {
      for (const cardId of cardIds) {
        if (previousPassiveCardIds.has(cardId) && !consider(cardId, allowOversize)) return false
      }
    }
    for (const cardId of cardIds) {
      if (!previousPassiveCardIds?.has(cardId) && !consider(cardId, allowOversize)) return false
    }
    return true
  }
  if (!admitTier(visibleCardIds, true)) return plan()
  const viewportMoving = residencyViewportMoving(viewport, previousViewport)
  if (viewportMoving && !admitTier(lookAheadCardIds)) return plan()
  if (!admitTier(preloadCardIds)) return plan()
  if (previousPassiveCardIds?.size) {
    const retained = new Set(retentionCardIds)
    if (!admitTier([...previousPassiveCardIds].filter((cardId) => retained.has(cardId)))) return plan()
  }
  return plan()
}
