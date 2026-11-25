import type { Card, CardKind } from './types'

const ORDINARY_CARD_FOOTPRINT = Object.freeze({ width: 260, height: 180 })
const GROUP_CARD_FOOTPRINT = Object.freeze({ width: 360, height: 360 })
const TITLE_CARD_FOOTPRINT = Object.freeze({ width: 320, height: 82 })

export const CARD_FRAME_ARRANGEMENT_LIMITS = Object.freeze({
  maxCards: 100,
  maxAbsoluteCoordinate: 1_000_000,
  maxDimension: 1_000_000,
})

export type CardFrameArrangement = Readonly<{
  cardId: string
  position: Readonly<{ x: number; y: number }>
  size?: Readonly<{ width: number; height: number }>
}>

export type CardFrameArrangementResult =
  | Readonly<{ ok: true; cards: Card[] }>
  | Readonly<{ ok: false; reason: 'invalid' }>
  | Readonly<{ ok: false; reason: 'card-not-found'; cardId: string }>

export type CardLayerDirection = 'front' | 'back'

export type GroupMembershipPlanResult =
  | Readonly<{ ok: true; cards: Card[] }>
  | Readonly<{ ok: false; reason: 'invalid' }>
  | Readonly<{ ok: false; reason: 'card-not-found'; cardId: string }>
  | Readonly<{ ok: false; reason: 'group-not-found'; groupId: string }>

const GROUP_FRAME_LAYOUT = Object.freeze({
  horizontalPadding: 28,
  topPadding: 46,
  bottomPadding: 30,
  minimumWidth: 320,
  minimumHeight: 220,
})

type GroupBounds = Readonly<{
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  area: number
  boardOrder: number
}>

export function defaultCardFootprint(
  kind: CardKind,
): Readonly<{ width: number; height: number }> {
  if (kind === 'group') return { ...GROUP_CARD_FOOTPRINT }
  if (kind === 'title') return { ...TITLE_CARD_FOOTPRINT }
  return { ...ORDINARY_CARD_FOOTPRINT }
}

export function cardFootprint(card: Card): Readonly<{ width: number; height: number }> {
  return card.size ? { ...card.size } : defaultCardFootprint(card.kind)
}

export function canJoinGroup(card: Card): boolean {
  return card.kind !== 'group' && card.kind !== 'title'
}

export function reconcileGroupMembership(cards: readonly Card[]): Card[] {
  const groups = groupBounds(cards)
  return cards.map((card) => {
    const nextGroupId = canJoinGroup(card) ? groupForCard(groups, card) : undefined
    if (card.groupId === nextGroupId) return card
    if (nextGroupId !== undefined) return { ...card, groupId: nextGroupId }
    const { groupId: _groupId, ...ungrouped } = card
    return ungrouped
  })
}

/**
 * Applies a bounded set of absolute Card frames as one graph operation. All
 * requested geometry exists before the single global membership reconciliation,
 * so request ordering cannot create intermediate Group semantics.
 */
export function planCardFrameArrangement(
  cards: readonly Card[],
  frames: readonly CardFrameArrangement[],
): CardFrameArrangementResult {
  if (!validFrameSet(frames)) return { ok: false, reason: 'invalid' }

  const cardsById = new Map(cards.map((card) => [card.id, card] as const))
  for (const frame of frames) {
    if (!cardsById.has(frame.cardId)) {
      return { ok: false, reason: 'card-not-found', cardId: frame.cardId }
    }
  }

  const framesById = new Map(frames.map((frame) => [frame.cardId, frame] as const))
  const framedCards = cards.map((card) => {
    const frame = framesById.get(card.id)
    if (!frame) return card
    const samePosition = card.position.x === frame.position.x
      && card.position.y === frame.position.y
    const sameSize = frame.size === undefined
      || (card.size?.width === frame.size.width && card.size?.height === frame.size.height)
    if (samePosition && sameSize) return card
    return {
      ...card,
      position: { ...frame.position },
      ...(frame.size === undefined ? {} : { size: { ...frame.size } }),
    }
  })

  return { ok: true, cards: reconcileGroupMembership(framedCards) }
}

/**
 * Plans a stable front/back move inside the renderer-safe Group and ordinary
 * Card classes. Only classes named by the request are normalized, Board array
 * order is untouched, and stored ranks remain uncapped graph data.
 */
export function planCardLayerOrder(
  cards: readonly Card[],
  cardIds: readonly string[],
  direction: CardLayerDirection,
): Card[] {
  const selectedIds = new Set(cardIds)
  const selectedClasses = new Set(
    cards
      .filter((card) => selectedIds.has(card.id))
      .map(cardLayerClass),
  )
  if (selectedClasses.size === 0) return cards.slice()

  const plannedLayers = new Map<string, number>()
  for (const layerClass of selectedClasses) {
    const ordered = cards
      .map((card, boardOrder) => ({ card, boardOrder }))
      .filter(({ card }) => cardLayerClass(card) === layerClass)
      .sort((left, right) => (
        storedLayer(left.card, left.boardOrder) - storedLayer(right.card, right.boardOrder)
        || left.boardOrder - right.boardOrder
      ))
      .map(({ card }) => card)
    const selected = ordered.filter((card) => selectedIds.has(card.id))
    const rest = ordered.filter((card) => !selectedIds.has(card.id))
    const nextOrder = direction === 'front'
      ? [...rest, ...selected]
      : [...selected, ...rest]
    nextOrder.forEach((card, index) => plannedLayers.set(card.id, index))
  }

  return cards.map((card) => {
    const zIndex = plannedLayers.get(card.id)
    if (zIndex === undefined || card.zIndex === zIndex) return card
    return { ...card, zIndex }
  })
}

/**
 * Plans the GUI-equivalent explicit Group membership operation. Adding first
 * reframes the target Group around its existing members and the requested Card,
 * then runs one geometric reconciliation. Removing deliberately clears only
 * the saved membership: unchanged geometry means a later arrangement or other
 * geometric reconciliation may attach the Card again.
 */
export function planGroupMembership(
  cards: readonly Card[],
  cardId: string,
  groupId: string | null,
): GroupMembershipPlanResult {
  if (!nonEmptyString(cardId)
    || (groupId !== null && !nonEmptyString(groupId))) {
    return { ok: false, reason: 'invalid' }
  }

  const card = cards.find((candidate) => candidate.id === cardId)
  if (!card) return { ok: false, reason: 'card-not-found', cardId }
  if (!canJoinGroup(card)) return { ok: false, reason: 'invalid' }

  if (groupId === null) {
    return {
      ok: true,
      cards: cards.map((candidate) => {
        if (candidate.id !== cardId || candidate.groupId === undefined) return candidate
        const { groupId: _groupId, ...ungrouped } = candidate
        return ungrouped
      }),
    }
  }

  const group = cards.find((candidate) => candidate.id === groupId)
  if (!group) return { ok: false, reason: 'group-not-found', groupId }
  if (group.kind !== 'group') return { ok: false, reason: 'invalid' }

  const existingMembers = cards.filter((candidate) => (
    candidate.id !== cardId
    && candidate.groupId === groupId
    && canJoinGroup(candidate)
  ))
  const frame = enclosingGroupFrame([...existingMembers, card])
  const framedCards = cards.map((candidate) => {
    if (candidate.id === cardId) return { ...candidate, groupId }
    if (candidate.id === groupId) {
      return {
        ...candidate,
        position: frame.position,
        size: frame.size,
      }
    }
    return candidate
  })
  return { ok: true, cards: reconcileGroupMembership(framedCards) }
}

function groupBounds(cards: readonly Card[]): GroupBounds[] {
  return cards
    .flatMap((card, boardOrder): GroupBounds[] => {
      if (card.kind !== 'group') return []
      const size = cardFootprint(card)
      return [{
        id: card.id,
        x1: card.position.x,
        y1: card.position.y,
        x2: card.position.x + size.width,
        y2: card.position.y + size.height,
        area: size.width * size.height,
        boardOrder,
      }]
    })
    .sort((left, right) => left.area - right.area || left.boardOrder - right.boardOrder)
}

function groupForCard(groups: readonly GroupBounds[], card: Card): string | undefined {
  const size = cardFootprint(card)
  const center = {
    x: card.position.x + size.width / 2,
    y: card.position.y + size.height / 2,
  }
  return groups.find((group) => (
    center.x >= group.x1
    && center.x <= group.x2
    && center.y >= group.y1
    && center.y <= group.y2
  ))?.id
}

function enclosingGroupFrame(cards: readonly Card[]): Readonly<{
  position: Card['position']
  size: NonNullable<Card['size']>
}> {
  const minX = Math.min(...cards.map((card) => card.position.x))
  const minY = Math.min(...cards.map((card) => card.position.y))
  const maxX = Math.max(...cards.map((card) => card.position.x + cardFootprint(card).width))
  const maxY = Math.max(...cards.map((card) => card.position.y + cardFootprint(card).height))
  return {
    position: {
      x: minX - GROUP_FRAME_LAYOUT.horizontalPadding,
      y: minY - GROUP_FRAME_LAYOUT.topPadding,
    },
    size: {
      width: Math.max(
        GROUP_FRAME_LAYOUT.minimumWidth,
        maxX - minX + GROUP_FRAME_LAYOUT.horizontalPadding * 2,
      ),
      height: Math.max(
        GROUP_FRAME_LAYOUT.minimumHeight,
        maxY - minY + GROUP_FRAME_LAYOUT.topPadding + GROUP_FRAME_LAYOUT.bottomPadding,
      ),
    },
  }
}

function validFrameSet(frames: readonly CardFrameArrangement[]): boolean {
  if (!Array.isArray(frames)
    || frames.length === 0
    || frames.length > CARD_FRAME_ARRANGEMENT_LIMITS.maxCards) {
    return false
  }
  const cardIds = new Set<string>()
  for (const frame of frames) {
    if (!frame
      || typeof frame.cardId !== 'string'
      || frame.cardId.length === 0
      || cardIds.has(frame.cardId)
      || !boundedCoordinate(frame.position?.x)
      || !boundedCoordinate(frame.position?.y)
      || (frame.size !== undefined
        && (!frame.size
          || !boundedDimension(frame.size.width)
          || !boundedDimension(frame.size.height)))) {
      return false
    }
    cardIds.add(frame.cardId)
  }
  return true
}

function boundedCoordinate(candidate: number): boolean {
  return Number.isFinite(candidate)
    && Math.abs(candidate) <= CARD_FRAME_ARRANGEMENT_LIMITS.maxAbsoluteCoordinate
}

function boundedDimension(candidate: number): boolean {
  return Number.isFinite(candidate)
    && candidate > 0
    && candidate <= CARD_FRAME_ARRANGEMENT_LIMITS.maxDimension
}

function nonEmptyString(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0
}

export function storedLayer(card: Card, fallback: number): number {
  return typeof card.zIndex === 'number' && Number.isFinite(card.zIndex)
    ? card.zIndex
    : fallback
}

function cardLayerClass(card: Card): 'group' | 'ordinary' {
  return card.kind === 'group' ? 'group' : 'ordinary'
}
